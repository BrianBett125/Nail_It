// Who can read and write what: logged out, stranger, viewer, storekeeper, owner.
import { describe, it, before, after, beforeEach } from "node:test";
import {
    startEnv, reset, raw, as, anonymous, ref, get, set, update, remove, assertSucceeds, assertFails, MATERIAL, SITE,
} from "./helpers.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await reset(env); });

describe("logged-out visitor gets nothing", () => {
    const paths = [
        "/", "sites", "sites/s1", "members/s1", "materials/s1", "materials/s1/m1",
        "userSites/owner1", "memberInfo/s1", "userInvites/someone@example,com", "siteInvites/s1",
    ];
    for (const p of paths) {
        it(`cannot read ${p}`, async () => {
            await assertFails(get(ref(anonymous(env), p)));
        });
    }
    it("cannot write a material", async () => {
        await assertFails(set(ref(anonymous(env), "materials/s1/m9"), MATERIAL));
    });
    it("cannot create a site", async () => {
        await assertFails(set(ref(anonymous(env), "sites/s9"), { ...SITE, ownerUid: "x" }));
    });
    it("cannot delete anything", async () => {
        await assertFails(remove(ref(anonymous(env), "materials/s1/m1")));
        await assertFails(remove(ref(anonymous(env), "sites/s1")));
    });
});

describe("a signed-in stranger (member of no site) cannot see another site", () => {
    for (const p of ["sites/s1", "members/s1", "materials/s1", "materials/s1/m1", "memberInfo/s1", "siteInvites/s1", "userSites/owner1"]) {
        it(`cannot read ${p}`, async () => {
            await assertFails(get(ref(as(env, "stranger"), p)));
        });
    }
    it("cannot read the whole database or the list of all sites", async () => {
        await assertFails(get(ref(as(env, "stranger"), "/")));
        await assertFails(get(ref(as(env, "stranger"), "sites")));
        await assertFails(get(ref(as(env, "stranger"), "materials")));
    });
    it("cannot write a material, edit the site, or add themselves as a member", async () => {
        const db = as(env, "stranger");
        await assertFails(set(ref(db, "materials/s1/m9"), MATERIAL));
        await assertFails(set(ref(db, "sites/s1/name"), "Hijacked"));
        await assertFails(set(ref(db, "members/s1/stranger"), "viewer"));
        await assertFails(set(ref(db, "members/s1/stranger"), "owner"));
        await assertFails(set(ref(db, "userSites/stranger/s1"), "viewer"));
    });
    it("can read their own (empty) site list", async () => {
        await assertSucceeds(get(ref(as(env, "stranger"), "userSites/stranger")));
    });
});

describe("a member of site 1 has no reach into site 2", () => {
    for (const uid of ["owner1", "keeper1", "viewer1"]) {
        it(`${uid} cannot read or write site 2`, async () => {
            const db = as(env, uid);
            await assertFails(get(ref(db, "sites/s2")));
            await assertFails(get(ref(db, "materials/s2")));
            await assertFails(set(ref(db, "materials/s2/m9"), MATERIAL));
            await assertFails(set(ref(db, "materials/s2/m2/quantity"), 0));
        });
    }
});

describe("viewer (engineer, QS, architect): read only", () => {
    it("reads the site, its members, its materials and their own site list", async () => {
        const db = as(env, "viewer1");
        await assertSucceeds(get(ref(db, "sites/s1")));
        await assertSucceeds(get(ref(db, "members/s1")));
        await assertSucceeds(get(ref(db, "memberInfo/s1")));
        await assertSucceeds(get(ref(db, "materials/s1")));
        await assertSucceeds(get(ref(db, "userSites/viewer1")));
    });
    it("cannot read another user's site list or the invites", async () => {
        const db = as(env, "viewer1");
        await assertFails(get(ref(db, "userSites/owner1")));
        await assertFails(get(ref(db, "siteInvites/s1")));
    });
    it("cannot add, edit or delete a material", async () => {
        const db = as(env, "viewer1");
        await assertFails(set(ref(db, "materials/s1/m9"), MATERIAL));
        await assertFails(update(ref(db, "materials/s1/m1"), { quantity: 99 }));
        await assertFails(remove(ref(db, "materials/s1/m1")));
        await assertFails(remove(ref(db, "materials/s1")));
    });
    it("cannot edit or delete the site, or change anyone's role", async () => {
        const db = as(env, "viewer1");
        await assertFails(update(ref(db, "sites/s1"), { name: "x" }));
        await assertFails(remove(ref(db, "sites/s1")));
        await assertFails(set(ref(db, "members/s1/viewer1"), "storekeeper"));
        await assertFails(set(ref(db, "members/s1/keeper1"), "viewer"));
        await assertFails(set(ref(db, "userSites/viewer1/s1"), "storekeeper"));
    });
    it("cannot invite anybody", async () => {
        const db = as(env, "viewer1");
        await assertFails(set(ref(db, "userInvites/new@example,com/s1"), "viewer"));
        await assertFails(set(ref(db, "siteInvites/s1/new@example,com"), "viewer"));
    });
    it("did not change any data while failing", async () => {
        const db = as(env, "viewer1");
        await assertFails(update(ref(db, "materials/s1/m1"), { quantity: 99 }));
        const { default: assert } = await import("node:assert/strict");
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });
});

describe("storekeeper (foreman): records stock, nothing else", () => {
    it("reads everything a member can", async () => {
        const db = as(env, "keeper1");
        await assertSucceeds(get(ref(db, "sites/s1")));
        await assertSucceeds(get(ref(db, "materials/s1")));
        await assertSucceeds(get(ref(db, "members/s1")));
    });
    it("adds, edits and deletes materials", async () => {
        const db = as(env, "keeper1");
        await assertSucceeds(set(ref(db, "materials/s1/m9"), { ...MATERIAL, name: "Sand" }));
        await assertSucceeds(update(ref(db, "materials/s1/m1"), { quantity: 9 }));
        await assertSucceeds(update(ref(db, "materials/s1/m1"), { minLevel: 2 }));
        await assertSucceeds(remove(ref(db, "materials/s1/m9")));
    });
    it("cannot delete all the materials of the site at once", async () => {
        await assertFails(remove(ref(as(env, "keeper1"), "materials/s1")));
    });
    it("cannot edit or delete the site", async () => {
        const db = as(env, "keeper1");
        await assertFails(update(ref(db, "sites/s1"), { name: "x" }));
        await assertFails(remove(ref(db, "sites/s1")));
    });
    it("cannot manage members or invites, or promote themselves", async () => {
        const db = as(env, "keeper1");
        await assertFails(set(ref(db, "members/s1/keeper1"), "owner"));
        await assertFails(set(ref(db, "members/s1/viewer1"), "storekeeper"));
        await assertFails(remove(ref(db, "members/s1/viewer1")));
        await assertFails(set(ref(db, "userInvites/new@example,com/s1"), "viewer"));
        await assertFails(get(ref(db, "siteInvites/s1")));
    });
});

describe("owner: everything on their own site", () => {
    it("reads all of it, including the pending invites", async () => {
        const db = as(env, "owner1");
        await assertSucceeds(get(ref(db, "sites/s1")));
        await assertSucceeds(get(ref(db, "members/s1")));
        await assertSucceeds(get(ref(db, "memberInfo/s1")));
        await assertSucceeds(get(ref(db, "materials/s1")));
        await assertSucceeds(get(ref(db, "siteInvites/s1")));
    });
    it("adds, edits and deletes materials, one or all", async () => {
        const db = as(env, "owner1");
        await assertSucceeds(set(ref(db, "materials/s1/m9"), MATERIAL));
        await assertSucceeds(update(ref(db, "materials/s1/m1"), { quantity: 0 }));
        await assertSucceeds(remove(ref(db, "materials/s1/m9")));
        await assertSucceeds(remove(ref(db, "materials/s1")));
    });
    it("edits the site's name, location and building type", async () => {
        const db = as(env, "owner1");
        await assertSucceeds(update(ref(db, "sites/s1"), { name: "Mombasa North", buildingType: "Commercial" }));
    });
    it("cannot hand the site to someone else by changing ownerUid", async () => {
        await assertFails(update(ref(as(env, "owner1"), "sites/s1"), { ownerUid: "keeper1" }));
    });
    it("cannot touch the owner of site 2", async () => {
        const db = as(env, "owner1");
        await assertFails(set(ref(db, "members/s2/owner2"), "viewer"));
        await assertFails(remove(ref(db, "sites/s2")));
    });
});
