// .validate: types, lengths, quantity >= 0, no unknown fields. Run as the owner, so only the
// validation can be what rejects the write.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    startEnv, reset, raw, as, ref, set, update, assertSucceeds, assertFails, MATERIAL, SITE,
} from "./helpers.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await reset(env); });

const owner = () => as(env, "owner1");
// A new material starts at zero: stock arrives through movements (tests/rules/movements.test.js).
const newMaterial = (patch) => ({ ...MATERIAL, quantity: 0, ...patch });

describe("material validation", () => {
    it("accepts a normal material, with or without minLevel, with or without the old typed date", async () => {
        await assertSucceeds(set(ref(owner(), "materials/s1/a"), newMaterial()));
        await assertSucceeds(set(ref(owner(), "materials/s1/b"), newMaterial({ minLevel: 10 })));
        await assertSucceeds(set(ref(owner(), "materials/s1/c"), newMaterial({ minLevel: 0 })));
        await assertSucceeds(set(ref(owner(), "materials/s1/d"), newMaterial({ minLevel: 12.5 })));
        await assertSucceeds(set(ref(owner(), "materials/s1/e"), { name: "Sand", quantity: 0, units: "tonnes" }));
    });

    const bad = {
        "quantity as a string": { quantity: "5" },
        "negative quantity": { quantity: -1 },
        "absurd quantity": { quantity: 1e12 },
        "quantity null": { quantity: null },
        "empty name": { name: "" },
        "name as a number": { name: 5 },
        "name over 100 characters": { name: "x".repeat(101) },
        "empty units": { units: "" },
        "units over 20 characters": { units: "x".repeat(21) },
        "date in the wrong format": { lastUpdated: "03/05/2024" },
        "date as a number": { lastUpdated: 20240503 },
        "date with trailing text": { lastUpdated: "2024-05-03T00:00" },
        "negative minLevel": { minLevel: -5 },
        "minLevel as a string": { minLevel: "5" },
        "an unknown field": { color: "red" },
        "the old siteId field": { siteId: "s1" },
        "an updatedAt that is not the server's time": { updatedAt: 1700000000000 },
        "a starting quantity with no movement behind it": { quantity: 5 },
        "a lastMovementId that points at nothing": { quantity: 5, lastMovementId: "nothing" },
    };
    for (const [label, patch] of Object.entries(bad)) {
        it(`rejects ${label}`, async () => {
            await assertFails(set(ref(owner(), "materials/s1/x"), newMaterial(patch)));
            assert.equal(await raw(env, "materials/s1/x"), null);
        });
    }

    it("rejects a material missing a required field", async () => {
        for (const field of ["name", "quantity", "units"]) {
            const { [field]: _removed, ...rest } = newMaterial();
            await assertFails(set(ref(owner(), "materials/s1/x"), rest));
        }
    });

    it("rejects a bad edit as well as a bad create", async () => {
        await assertFails(update(ref(owner(), "materials/s1/m1"), { quantity: -3 }));
        await assertFails(update(ref(owner(), "materials/s1/m1"), { quantity: "lots" }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("a storekeeper is held to the same validation", async () => {
        await assertFails(set(ref(as(env, "keeper1"), "materials/s1/x"), newMaterial({ quantity: -1 })));
    });

    it("accepts the migrated legacy unit 'kgs' (free text up to 20 characters)", async () => {
        await assertSucceeds(set(ref(owner(), "materials/s1/legacy"), newMaterial({ units: "kgs" })));
    });
});

describe("site validation", () => {
    const create = (patch, id = "n1") => set(ref(as(env, "newbie"), `sites/${id}`), { ...SITE, ownerUid: "newbie", ...patch });
    const createAtomic = (patch, id = "n1") => update(ref(as(env, "newbie")), {
        [`sites/${id}`]: { ...SITE, ownerUid: "newbie", ...patch },
        [`members/${id}/newbie`]: "owner",
        [`userSites/newbie/${id}`]: "owner",
    });

    it("accepts every building type in the dropdown", async () => {
        let i = 0;
        for (const buildingType of ["Residential", "Commercial", "Industrial", "Road/Civil", "Other"]) {
            i += 1;
            await assertSucceeds(createAtomic({ buildingType }, `ok${i}`));
        }
    });

    const bad = {
        "an unknown building type": { buildingType: "Castle" },
        "an empty name": { name: "" },
        "a name over 100 characters": { name: "x".repeat(101) },
        "an empty location": { location: "" },
        "createdAt as a string": { createdAt: "2024-01-01" },
        "createdAt of zero": { createdAt: 0 },
        "the legacy date field": { date: "2024-05-01" },
        "an unknown field": { color: "red" },
    };
    for (const [label, patch] of Object.entries(bad)) {
        it(`rejects ${label}`, async () => {
            await assertFails(createAtomic(patch));
            assert.equal(await raw(env, "sites/n1"), null);
        });
    }

    it("rejects a site missing a required field", async () => {
        for (const field of ["name", "location", "buildingType", "createdAt", "ownerUid"]) {
            const site = { ...SITE, ownerUid: "newbie" };
            delete site[field];
            await assertFails(update(ref(as(env, "newbie")), {
                "sites/n1": site, "members/n1/newbie": "owner", "userSites/newbie/n1": "owner",
            }));
        }
    });

    it("rejects an owner editing a site into an invalid state", async () => {
        await assertFails(update(ref(owner(), "sites/s1"), { buildingType: "Castle" }));
        await assertFails(update(ref(owner(), "sites/s1"), { name: "" }));
        assert.equal((await raw(env, "sites/s1")).name, "Mombasa");
    });

    it("a bare site write without the owner membership is refused (create is atomic only)", async () => {
        await assertFails(create({}));
    });
});

describe("role value validation", () => {
    it("rejects a role that is not one of the three", async () => {
        await assertFails(update(ref(owner()), { "members/s1/viewer1": "admin", "userSites/viewer1/s1": "admin" }));
        await assertFails(set(ref(owner(), "members/s1/viewer1"), true));
        await assertFails(set(ref(owner(), "members/s1/viewer1"), 5));
    });
    it("never lets the owner role go to anyone but the site's ownerUid", async () => {
        await assertFails(update(ref(owner()), { "members/s1/viewer1": "owner", "userSites/viewer1/s1": "owner" }));
        assert.equal(await raw(env, "members/s1/viewer1"), "viewer");
    });
});
