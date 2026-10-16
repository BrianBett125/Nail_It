// Phase 3: stock only changes by recording a movement, and the quantity is always the sum of
// the movements. These tests send the exact writes src/movements.js builds to the real
// database.rules.json, and then try every way around them.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    startEnv, reset, raw, as, anonymous, ref, get, set, update, remove, push, increment, serverTimestamp,
    assertSucceeds, assertFails, MATERIAL, SV, receive, addMaterial, removeMaterial, restoreMaterial,
    editMaterial, newId, userOf,
} from "./helpers.js";
import { buildMovementUpdates } from "../../src/movements.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await reset(env); });

const keeper = () => as(env, "keeper1");
const owner = () => as(env, "owner1");
const viewer = () => as(env, "viewer1");

// m1 is a record from before Phase 3: 5 bags, no movements, a typed date.
const LEGACY = { ...MATERIAL, quantity: 5 };

const movementsOf = async (siteId = "s1") => Object.values((await raw(env, `movements/${siteId}`)) || {});
const sumFor = (list, materialId) => list.filter((m) => m.materialId === materialId).reduce((s, m) => s + m.delta, 0);

// One raw movement update, to break one thing at a time. Starts from what the page would write.
function build(db, overrides = {}, movement = { type: "received", delta: 3 }, material = LEGACY) {
    const id = newId(db, "s1");
    const updates = buildMovementUpdates({
        siteId: "s1", materialId: "m1", movementId: id, material, movement, user: userOf("keeper1"), sv: SV,
    });
    return { id, updates: overrides.edit ? overrides.edit(updates, id) : updates };
}

describe("receiving and using stock", () => {
    it("a storekeeper receives: the quantity goes up and the movement is written, together", async () => {
        await assertSucceeds(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 3, note: "Delivery 114" }));
        const material = await raw(env, "materials/s1/m1");
        assert.equal(material.quantity, 8);
        assert.equal(typeof material.updatedAt, "number");
        const [movement] = await movementsOf();
        assert.equal(movement.delta, 3);
        assert.equal(movement.type, "received");
        assert.equal(movement.byUid, "keeper1");
        assert.equal(movement.byEmail, "keeper1@example.com");
        assert.equal(movement.note, "Delivery 114");
        assert.equal(movement.materialName, "Cement");
        assert.equal(movement.at, material.updatedAt, "one server time for both");
        assert.equal(material.lastMovementId, Object.keys(await raw(env, "movements/s1"))[0]);
    });

    it("the owner uses stock", async () => {
        await assertSucceeds(receive(owner(), "owner1", "s1", "m1", LEGACY, { type: "used", delta: -2 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 3);
    });

    it("cannot use more than there is: the quantity would go below zero", async () => {
        await assertFails(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "used", delta: -6 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
        assert.deepEqual(await movementsOf(), []);
    });

    it("can use exactly what there is", async () => {
        await assertSucceeds(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "used", delta: -5 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 0);
    });

    it("two people recording at once both count (increments, not overwrites)", async () => {
        await Promise.all([
            receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 2 }),
            receive(owner(), "owner1", "s1", "m1", LEGACY, { type: "received", delta: 4 }),
        ]);
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 11);
        assert.equal((await movementsOf()).length, 2);
    });

    it("a stale phone that thinks there are 5 still adds to what the server has", async () => {
        await receive(owner(), "owner1", "s1", "m1", LEGACY, { type: "received", delta: 10 });
        await assertSucceeds(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "used", delta: -12 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 3);
    });

    it("works on decimals", async () => {
        await assertSucceeds(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 0.25 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5.25);
    });
});

describe("who may record", () => {
    it("a viewer cannot", async () => {
        await assertFails(receive(viewer(), "viewer1", "s1", "m1", LEGACY, { type: "received", delta: 1 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
        assert.deepEqual(await movementsOf(), []);
    });
    it("a stranger cannot", async () => {
        await assertFails(receive(as(env, "stranger"), "stranger", "s1", "m1", LEGACY, { type: "received", delta: 1 }));
    });
    it("a logged-out visitor cannot", async () => {
        await assertFails(receive(anonymous(env), "nobody", "s1", "m1", LEGACY, { type: "received", delta: 1 }));
    });
    it("a storekeeper of site 1 cannot record in site 2", async () => {
        const db = keeper();
        const id = newId(db, "s2");
        await assertFails(update(ref(db), buildMovementUpdates({
            siteId: "s2", materialId: "m2", movementId: id, material: { name: "Sand", units: "bags" },
            movement: { type: "received", delta: 1 }, user: userOf("keeper1"), sv: SV,
        })));
        assert.equal((await raw(env, "materials/s2/m2")).quantity, 5);
    });
    it("a viewer who is promoted can record at once", async () => {
        await raw(env, "members/s1/viewer1"); // sanity: exists
        await update(ref(owner()), { "members/s1/viewer1": "storekeeper", "userSites/viewer1/s1": "storekeeper" });
        await assertSucceeds(receive(viewer(), "viewer1", "s1", "m1", LEGACY, { type: "received", delta: 1 }));
    });
});

describe("reading history", () => {
    beforeEach(async () => {
        await receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 3 });
    });
    it("every member reads the movements of their site", async () => {
        for (const uid of ["owner1", "keeper1", "viewer1"]) {
            await assertSucceeds(get(ref(as(env, uid), "movements/s1")));
        }
    });
    it("a stranger, a member of another site and a logged-out visitor cannot", async () => {
        await assertFails(get(ref(as(env, "stranger"), "movements/s1")));
        await assertFails(get(ref(as(env, "owner2"), "movements/s1")));
        await assertFails(get(ref(anonymous(env), "movements/s1")));
        await assertFails(get(ref(as(env, "stranger"), "movements")));
        await assertFails(get(ref(as(env, "owner1"), "movements")));
    });
});

describe("the quantity cannot move without a matching movement", () => {
    it("direct writes to the quantity fail, for everyone who can write", async () => {
        for (const db of [keeper(), owner()]) {
            await assertFails(set(ref(db, "materials/s1/m1/quantity"), 99));
            await assertFails(update(ref(db, "materials/s1/m1"), { quantity: 99 }));
            await assertFails(update(ref(db, "materials/s1/m1"), { quantity: 0 }));
            await assertFails(update(ref(db), { "materials/s1/m1/quantity": increment(5) }));
        }
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("replacing the whole material with another quantity fails", async () => {
        await assertFails(set(ref(owner(), "materials/s1/m1"), { ...LEGACY, quantity: 50 }));
    });

    it("replacing the whole material with the same quantity is fine (edit, undo of nothing)", async () => {
        await assertSucceeds(set(ref(owner(), "materials/s1/m1"), { ...LEGACY, name: "Cement 42.5" }));
    });

    it("a movement whose delta does not match the quantity change fails", async () => {
        const { updates } = build(keeper(), { edit: (u) => ({ ...u, "materials/s1/m1/quantity": increment(5) }) });
        await assertFails(update(ref(keeper()), updates));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("a movement with no quantity change fails (history that adds up to nothing)", async () => {
        const { updates } = build(keeper(), {
            edit: (u) => { delete u["materials/s1/m1/quantity"]; return u; },
        });
        await assertFails(update(ref(keeper()), updates));
        assert.deepEqual(await movementsOf(), []);
    });

    it("a quantity change that points at a movement that already exists fails (no reusing history)", async () => {
        await receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 3 });
        const [first] = Object.keys(await raw(env, "movements/s1"));
        await assertFails(update(ref(keeper()), {
            "materials/s1/m1/quantity": increment(3),
            "materials/s1/m1/lastMovementId": first,
        }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 8);
    });

    it("a quantity change on one material cannot hide behind a movement for another", async () => {
        await update(ref(owner()), { "materials/s1/m2": { name: "Sand", quantity: 0, units: "tonnes" } });
        const db = keeper();
        const id = newId(db, "s1");
        const mine = buildMovementUpdates({
            siteId: "s1", materialId: "m1", movementId: id, material: LEGACY,
            movement: { type: "received", delta: 3 }, user: userOf("keeper1"), sv: SV,
        });
        await assertFails(update(ref(db), {
            ...mine,
            "materials/s1/m2/quantity": increment(3),       // m2 also grows, citing m1's movement
            "materials/s1/m2/lastMovementId": id,
        }));
        assert.equal((await raw(env, "materials/s1/m2")).quantity, 0);
    });

    it("received must be positive and used must be negative", async () => {
        await assertFails(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: -1 }));
        await assertFails(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "used", delta: 1 }));
        await assertFails(receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 0 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });
});

describe("a movement cannot lie about who or when", () => {
    const tamper = (field, value) => async () => {
        const db = keeper();
        const { updates, id } = build(db, {
            edit: (u, mid) => { u[`movements/s1/${mid}`] = { ...u[`movements/s1/${mid}`], [field]: value }; return u; },
        });
        await assertFails(update(ref(db), updates));
        assert.equal(await raw(env, `movements/s1/${id}`), null);
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    };
    it("as somebody else (byUid)", tamper("byUid", "owner1"));
    it("with somebody else's email", tamper("byEmail", "owner1@example.com"));
    it("with a time in the past", tamper("at", 1700000000000));
    it("with a time in the future", tamper("at", Date.now() + 86_400_000));
    it("with an unknown type", tamper("type", "adjustment"));
    it("with a note over 200 characters", tamper("note", "x".repeat(201)));
    it("with an extra field", tamper("approved", true));
    it("with a text delta", tamper("delta", "3"));
    it("with an empty material name", tamper("materialName", ""));
    it("with a huge delta", tamper("delta", 1e12));
});

describe("movements are history: nobody edits or deletes one", () => {
    let movementId;
    beforeEach(async () => {
        await receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 3 });
        movementId = Object.keys(await raw(env, "movements/s1"))[0];
    });
    it("not the owner, not the author", async () => {
        for (const db of [owner(), keeper()]) {
            await assertFails(remove(ref(db, `movements/s1/${movementId}`)));
            await assertFails(set(ref(db, `movements/s1/${movementId}/delta`), 30));
            await assertFails(set(ref(db, `movements/s1/${movementId}/note`), "changed"));
            await assertFails(set(ref(db, `movements/s1/${movementId}`), {
                materialId: "m1", materialName: "Cement", units: "bags", delta: 99, type: "received",
                byUid: "owner1", byEmail: "owner1@example.com", at: serverTimestamp(),
            }));
        }
        assert.equal((await movementsOf())[0].delta, 3);
    });
    it("the owner cannot wipe a site's history while the site exists", async () => {
        await assertFails(remove(ref(owner(), "movements/s1")));
        await assertFails(remove(ref(keeper(), "movements/s1")));
        assert.equal((await movementsOf()).length, 1);
    });
    it("a movement cannot be written under a material that does not exist, as a made-up record", async () => {
        const db = keeper();
        await assertFails(set(ref(db, "movements/s1/fake"), {
            materialId: "nope", materialName: "Ghost", units: "kg", delta: 5, type: "received",
            byUid: "keeper1", byEmail: "keeper1@example.com", at: serverTimestamp(),
        }));
    });
});

describe("adding a material", () => {
    it("with a starting quantity writes an opening movement with it", async () => {
        await assertSucceeds(addMaterial(keeper(), "keeper1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 12 }));
        const material = await raw(env, "materials/s1/m9");
        assert.equal(material.quantity, 12);
        const movements = (await movementsOf()).filter((m) => m.materialId === "m9");
        assert.equal(movements.length, 1);
        assert.equal(movements[0].type, "opening");
        assert.equal(movements[0].delta, 12);
        assert.equal(sumFor(await movementsOf(), "m9"), material.quantity);
    });

    it("with zero stock needs no movement", async () => {
        await assertSucceeds(addMaterial(keeper(), "keeper1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 0 }));
        assert.deepEqual(await movementsOf(), []);
        assert.equal((await raw(env, "materials/s1/m9")).quantity, 0);
    });

    it("keeps the low-stock level", async () => {
        await assertSucceeds(addMaterial(keeper(), "keeper1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 4, minLevel: 2 }));
        assert.equal((await raw(env, "materials/s1/m9")).minLevel, 2);
    });

    it("a starting quantity written without a movement fails", async () => {
        await assertFails(set(ref(keeper(), "materials/s1/m9"), { name: "Sand", units: "tonnes", quantity: 12 }));
        await assertFails(set(ref(owner(), "materials/s1/m9"), { name: "Sand", units: "tonnes", quantity: 12, lastMovementId: "made-up" }));
        assert.equal(await raw(env, "materials/s1/m9"), null);
    });

    it("an opening movement whose delta is not the starting quantity fails", async () => {
        const db = keeper();
        const id = newId(db, "s1");
        const updates = {
            ...(await import("../../src/movements.js")).buildAddMaterialUpdates({
                siteId: "s1", materialId: "m9", movementId: id, user: userOf("keeper1"), sv: SV,
                material: { name: "Sand", units: "tonnes", quantity: 12 },
            }),
        };
        updates["materials/s1/m9"] = { ...updates["materials/s1/m9"], quantity: 20 };
        await assertFails(update(ref(db), updates));
    });

    it("an opening movement cannot be used to top up a material that already exists", async () => {
        const db = keeper();
        const id = newId(db, "s1");
        const { buildAddMaterialUpdates } = await import("../../src/movements.js");
        const updates = buildAddMaterialUpdates({
            siteId: "s1", materialId: "m1", movementId: id, user: userOf("keeper1"), sv: SV,
            material: { name: "Cement", units: "bags", quantity: 100 },
        });
        await assertFails(update(ref(db), updates));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("a viewer cannot add one", async () => {
        await assertFails(addMaterial(viewer(), "viewer1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 12 }));
        assert.equal(await raw(env, "materials/s1/m9"), null);
    });
});

describe("deleting and restoring a material", () => {
    it("takes the remaining stock out in a removed movement", async () => {
        await assertSucceeds(removeMaterial(keeper(), "keeper1", "s1", "m1", LEGACY));
        assert.equal(await raw(env, "materials/s1/m1"), null);
        const [movement] = await movementsOf();
        assert.equal(movement.type, "removed");
        assert.equal(movement.delta, -5);
    });

    it("a removed movement for the wrong amount fails, and nothing is deleted", async () => {
        const db = keeper();
        const id = newId(db, "s1");
        await assertFails(update(ref(db), {
            "materials/s1/m1": null,
            [`movements/s1/${id}`]: {
                materialId: "m1", materialName: "Cement", units: "bags", delta: -2, type: "removed",
                byUid: "keeper1", byEmail: "keeper1@example.com", at: serverTimestamp(),
            },
        }));
        assert.ok(await raw(env, "materials/s1/m1"));
    });

    it("a removed movement while the material stays fails", async () => {
        const db = keeper();
        const id = newId(db, "s1");
        await assertFails(update(ref(db), {
            [`movements/s1/${id}`]: {
                materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "removed",
                byUid: "keeper1", byEmail: "keeper1@example.com", at: serverTimestamp(),
            },
        }));
    });

    it("an empty material goes without any movement", async () => {
        await addMaterial(keeper(), "keeper1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 0 });
        await assertSucceeds(removeMaterial(keeper(), "keeper1", "s1", "m9", { name: "Sand", units: "tonnes", quantity: 0 }));
        assert.equal(await raw(env, "materials/s1/m9"), null);
    });

    it("Undo brings it back at the same key with the same quantity and says so in history", async () => {
        await removeMaterial(keeper(), "keeper1", "s1", "m1", LEGACY);
        await assertSucceeds(restoreMaterial(keeper(), "keeper1", "s1", "m1", LEGACY));
        const material = await raw(env, "materials/s1/m1");
        assert.equal(material.quantity, 5);
        assert.equal(material.name, "Cement");
        // m1 is a legacy record: its first 5 bags were never a movement. Removed (-5) and the
        // opening that Undo writes (+5) cancel out, and the 5 stays unexplained until a backfill.
        assert.equal(sumFor(await movementsOf(), "m1"), 0);
        const types = (await movementsOf()).map((m) => m.type).sort();
        assert.deepEqual(types, ["opening", "removed"]);
    });
});

describe("editing name, unit and low-stock level", () => {
    it("needs no movement and does not touch the quantity", async () => {
        await assertSucceeds(editMaterial(keeper(), "s1", "m1", { name: "Cement 42.5", units: "tonnes", minLevel: 2 }));
        const material = await raw(env, "materials/s1/m1");
        assert.equal(material.name, "Cement 42.5");
        assert.equal(material.units, "tonnes");
        assert.equal(material.minLevel, 2);
        assert.equal(material.quantity, 5);
        assert.equal(typeof material.updatedAt, "number");
    });
    it("clearing the low-stock level removes it", async () => {
        await editMaterial(keeper(), "s1", "m1", { minLevel: 2 });
        await assertSucceeds(editMaterial(keeper(), "s1", "m1", { minLevel: null }));
        assert.equal((await raw(env, "materials/s1/m1")).minLevel, undefined);
    });
    it("a viewer cannot edit", async () => {
        await assertFails(editMaterial(viewer(), "s1", "m1", { name: "Hijacked" }));
    });
    it("the update time must be the server's, not a typed value", async () => {
        await assertFails(update(ref(keeper(), "materials/s1/m1"), { updatedAt: 1700000000000 }));
        await assertSucceeds(update(ref(keeper(), "materials/s1/m1"), { updatedAt: serverTimestamp() }));
    });
    it("old records keep working without the typed date", async () => {
        await assertSucceeds(set(ref(owner(), "materials/s1/m1"), { name: "Cement", quantity: 5, units: "bags" }));
    });
});

describe("a site's history goes with the site", () => {
    it("deleting the site removes its movements in the same update", async () => {
        await receive(keeper(), "keeper1", "s1", "m1", LEGACY, { type: "received", delta: 3 });
        const { buildSiteDeleteUpdates } = await import("../../src/logic.js");
        await assertSucceeds(update(ref(owner()), buildSiteDeleteUpdates("s1", ["owner1", "keeper1", "viewer1"], [])));
        assert.equal(await raw(env, "movements/s1"), null);
        assert.equal(await raw(env, "sites/s1"), null);
    });
    it("another site's history is not touched", async () => {
        const db = as(env, "owner2");
        await assertSucceeds(addMaterial(db, "owner2", "s2", "m9", { name: "Sand", units: "tonnes", quantity: 2 }));
        const { buildSiteDeleteUpdates } = await import("../../src/logic.js");
        await update(ref(owner()), buildSiteDeleteUpdates("s1", ["owner1", "keeper1", "viewer1"], []));
        assert.equal(Object.keys(await raw(env, "movements/s2")).length, 1);
    });
});

describe("the promise: quantity equals the sum of movements", () => {
    it("holds after a long run of mixed, random operations by different people", async () => {
        const people = [["owner1", owner()], ["keeper1", keeper()]];
        const state = { name: "Rebar", units: "pieces", quantity: 0 };
        await assertSucceeds(addMaterial(owner(), "owner1", "s1", "rb", state));
        let expected = 0;
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let step = 0; step < 40; step += 1) {
            const [uid, db] = people[step % 2];
            const amount = Math.round(random() * 40) / 4 + 0.25; // quarters
            const useIt = random() < 0.5;
            const current = (await raw(env, "materials/s1/rb")).quantity;
            const movement = { type: useIt ? "used" : "received", delta: useIt ? -amount : amount };
            const material = { ...state, quantity: current };
            const attempt = receive(db, uid, "s1", "rb", material, movement);
            if (useIt && amount > current) {
                await assertFails(attempt);
            } else {
                await assertSucceeds(attempt);
                expected += movement.delta;
            }
            const now = await raw(env, "materials/s1/rb");
            assert.equal(now.quantity, expected);
            assert.equal(sumFor(await movementsOf(), "rb"), now.quantity, `after step ${step}`);
        }
    });
});
