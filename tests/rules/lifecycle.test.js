// Creating a site, managing members, leaving, deleting a site. Every change is a multi-path
// update, so the site, the members, the user's site index and the member info move together.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    startEnv, reset, raw, as, ref, get, set, update, remove, assertSucceeds, assertFails, MATERIAL, SITE,
} from "./helpers.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await reset(env); });

const siteFor = (uid) => ({ ...SITE, ownerUid: uid });
const createSite = (db, uid, id, extra = {}) => update(ref(db), {
    [`sites/${id}`]: siteFor(uid),
    [`members/${id}/${uid}`]: "owner",
    [`userSites/${uid}/${id}`]: "owner",
    [`memberInfo/${id}/${uid}`]: { email: `${uid}@example.com` },
    ...extra,
});

describe("creating a site", () => {
    it("any signed-in user can create a site they own, and then read and use it", async () => {
        const db = as(env, "newbie");
        await assertSucceeds(createSite(db, "newbie", "n1"));
        await assertSucceeds(get(ref(db, "sites/n1")));
        await assertSucceeds(get(ref(db, "userSites/newbie")));
        await assertSucceeds(set(ref(db, "materials/n1/m1"), { ...MATERIAL, quantity: 0 }));
        assert.equal(await raw(env, "members/n1/newbie"), "owner");
    });

    it("cannot create a site that names someone else as owner", async () => {
        await assertFails(update(ref(as(env, "newbie")), {
            "sites/n1": siteFor("owner1"), "members/n1/newbie": "owner", "userSites/newbie/n1": "owner",
        }));
        await assertFails(update(ref(as(env, "newbie")), {
            "sites/n1": siteFor("owner1"), "members/n1/owner1": "owner", "userSites/owner1/n1": "owner",
        }));
        assert.equal(await raw(env, "sites/n1"), null);
    });

    it("cannot create a site with no owner membership (it would be unreadable)", async () => {
        await assertFails(update(ref(as(env, "newbie")), { "sites/n1": siteFor("newbie") }));
        await assertFails(update(ref(as(env, "newbie")), { "sites/n1": siteFor("newbie"), "userSites/newbie/n1": "owner" }));
    });

    it("cannot make themselves owner of a site that does not exist", async () => {
        await assertFails(set(ref(as(env, "newbie"), "members/ghost/newbie"), "owner"));
        await assertFails(update(ref(as(env, "newbie")), { "members/ghost/newbie": "owner", "userSites/newbie/ghost": "owner" }));
    });

    it("cannot take over an existing site by re-creating it under its id", async () => {
        const db = as(env, "newbie");
        await assertFails(createSite(db, "newbie", "s1"));
        await assertFails(set(ref(db, "sites/s1"), siteFor("newbie")));
        assert.equal((await raw(env, "sites/s1")).ownerUid, "owner1");
        assert.equal(await raw(env, "members/s1/newbie"), null);
    });

    it("cannot add an extra owner to a site, even as the owner", async () => {
        await assertFails(update(ref(as(env, "owner1")), { "members/s1/keeper1": "owner", "userSites/keeper1/s1": "owner" }));
    });
});

describe("the site list (userSites) cannot be forged", () => {
    it("a user cannot list a site they are not a member of", async () => {
        await assertFails(set(ref(as(env, "stranger"), "userSites/stranger/s1"), "viewer"));
        await assertFails(set(ref(as(env, "stranger"), "userSites/stranger/s1"), "owner"));
    });
    it("cannot claim a higher role than their membership", async () => {
        await assertFails(set(ref(as(env, "viewer1"), "userSites/viewer1/s1"), "owner"));
        await assertFails(set(ref(as(env, "viewer1"), "userSites/viewer1/s1"), "storekeeper"));
    });
    it("cannot drop a site from the list while still a member (list and members must agree)", async () => {
        await assertFails(remove(ref(as(env, "viewer1"), "userSites/viewer1/s1")));
    });
    it("cannot write into somebody else's list", async () => {
        await assertFails(set(ref(as(env, "stranger"), "userSites/viewer1/s9"), "viewer"));
        await assertFails(set(ref(as(env, "viewer1"), "userSites/keeper1/s1"), "storekeeper"));
    });
});

describe("the owner manages members", () => {
    it("changes a member's role: members and the site list together", async () => {
        const db = as(env, "owner1");
        await assertSucceeds(update(ref(db), { "members/s1/viewer1": "storekeeper", "userSites/viewer1/s1": "storekeeper" }));
        await assertSucceeds(set(ref(as(env, "viewer1"), "materials/s1/m9"), { ...MATERIAL, quantity: 0 })); // new powers apply at once
    });

    it("refuses a role change that leaves the site list out of step", async () => {
        await assertFails(set(ref(as(env, "owner1"), "members/s1/viewer1"), "storekeeper"));
        assert.equal(await raw(env, "members/s1/viewer1"), "viewer");
    });

    it("removes a member completely, and they lose all access at once", async () => {
        await assertSucceeds(update(ref(as(env, "owner1")), {
            "members/s1/keeper1": null, "userSites/keeper1/s1": null, "memberInfo/s1/keeper1": null,
        }));
        await assertFails(get(ref(as(env, "keeper1"), "materials/s1")));
        await assertFails(set(ref(as(env, "keeper1"), "materials/s1/m9"), MATERIAL));
        await assertFails(get(ref(as(env, "keeper1"), "sites/s1")));
    });

    it("cannot remove themselves as owner while the site lives", async () => {
        await assertFails(update(ref(as(env, "owner1")), { "members/s1/owner1": null, "userSites/owner1/s1": null }));
        assert.equal(await raw(env, "members/s1/owner1"), "owner");
    });

    it("a member removed by the owner cannot write themselves back in", async () => {
        await update(ref(as(env, "owner1")), { "members/s1/keeper1": null, "userSites/keeper1/s1": null, "memberInfo/s1/keeper1": null });
        await assertFails(update(ref(as(env, "keeper1")), { "members/s1/keeper1": "storekeeper", "userSites/keeper1/s1": "storekeeper" }));
    });
});

describe("leaving a site", () => {
    it("a viewer or storekeeper can leave: members, site list and info together", async () => {
        for (const uid of ["viewer1", "keeper1"]) {
            await assertSucceeds(update(ref(as(env, uid)), {
                [`members/s1/${uid}`]: null, [`userSites/${uid}/s1`]: null, [`memberInfo/s1/${uid}`]: null,
            }));
            await assertFails(get(ref(as(env, uid), "materials/s1")));
        }
    });
    it("a member cannot remove somebody else", async () => {
        await assertFails(update(ref(as(env, "viewer1")), { "members/s1/keeper1": null, "userSites/keeper1/s1": null }));
        await assertFails(update(ref(as(env, "keeper1")), { "members/s1/viewer1": null, "userSites/viewer1/s1": null }));
    });
});

describe("member info (who is who)", () => {
    it("a member records their own email", async () => {
        await assertSucceeds(set(ref(as(env, "viewer1"), "memberInfo/s1/viewer1"), { email: "viewer1@example.com" }));
    });
    it("cannot record a different email than the one on their account", async () => {
        await assertFails(set(ref(as(env, "viewer1"), "memberInfo/s1/viewer1"), { email: "ceo@bigcorp.com" }));
    });
    it("cannot write info for somebody else, or as a non-member", async () => {
        await assertFails(set(ref(as(env, "viewer1"), "memberInfo/s1/keeper1"), { email: "keeper1@example.com" }));
        await assertFails(set(ref(as(env, "stranger"), "memberInfo/s1/stranger"), { email: "stranger@example.com" }));
    });
    it("rejects extra fields", async () => {
        await assertFails(set(ref(as(env, "viewer1"), "memberInfo/s1/viewer1"), { email: "viewer1@example.com", admin: true }));
    });
});

describe("deleting a site", () => {
    const cascade = {
        "sites/s1": null,
        "materials/s1": null,
        "members/s1/owner1": null, "members/s1/keeper1": null, "members/s1/viewer1": null,
        "userSites/owner1/s1": null, "userSites/keeper1/s1": null, "userSites/viewer1/s1": null,
        "memberInfo/s1": null,
        "siteInvites/s1": null,
    };

    it("the owner deletes the site and everything under it in one update", async () => {
        await assertSucceeds(update(ref(as(env, "owner1")), cascade));
        for (const p of ["sites/s1", "materials/s1", "members/s1", "memberInfo/s1", "userSites/owner1", "userSites/keeper1", "userSites/viewer1"]) {
            assert.equal(await raw(env, p), null, p);
        }
        assert.ok(await raw(env, "sites/s2"), "site 2 must be untouched");
        assert.ok(await raw(env, "materials/s2/m2"));
    });

    it("a storekeeper or viewer cannot delete it, and nothing is partly deleted", async () => {
        for (const uid of ["keeper1", "viewer1"]) {
            await assertFails(update(ref(as(env, uid)), cascade));
        }
        assert.ok(await raw(env, "sites/s1"));
        assert.ok(await raw(env, "materials/s1/m1"));
        assert.equal(await raw(env, "members/s1/owner1"), "owner");
    });

    it("a stranger cannot", async () => {
        await assertFails(update(ref(as(env, "stranger")), cascade));
        assert.ok(await raw(env, "sites/s1"));
    });

    it("a half-delete that leaves the owner membership behind is refused", async () => {
        await assertFails(update(ref(as(env, "owner1")), { "sites/s1": null, "materials/s1": null }));
        assert.ok(await raw(env, "sites/s1"), "the whole update must fail together");
    });

    it("the owner's own membership cannot be removed unless the site goes too", async () => {
        await assertFails(update(ref(as(env, "owner1")), { "members/s1/owner1": null, "userSites/owner1/s1": null }));
    });
});
