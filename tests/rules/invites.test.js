// Invite flow. The owner types an email and a role. Whoever signs in with that verified
// email can accept, once. Invites are stored under the email with '.' written as ','.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    startEnv, reset, raw, as, anonymous, ref, get, set, update, assertSucceeds, assertFails,
} from "./helpers.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await reset(env); });

const EMAIL = "sam.w.mwangi@mail.example.com";
const KEY = "sam,w,mwangi@mail,example,com";
const sam = (claims = {}) => as(env, "sam", { email: EMAIL, ...claims });

// The invitee cannot read the site, so the invite carries what they need to recognise it.
const inviteRecord = (role) => ({ role, siteName: "Mombasa", invitedBy: "owner1@example.com" });
const invite = (role = "viewer", siteId = "s1") => ({
    [`userInvites/${KEY}/${siteId}`]: inviteRecord(role),
    [`siteInvites/${siteId}/${KEY}`]: role,
});
const accept = (role = "viewer", siteId = "s1") => ({
    [`members/${siteId}/sam`]: role,
    [`userSites/sam/${siteId}`]: role,
    [`userInvites/${KEY}/${siteId}`]: null,
    [`siteInvites/${siteId}/${KEY}`]: null,
});

async function ownerInvites(role = "viewer", siteId = "s1") {
    await assertSucceeds(update(ref(as(env, "owner1")), invite(role, siteId)));
}

describe("sending an invite", () => {
    it("the owner invites by email with the storekeeper or the viewer role", async () => {
        await ownerInvites("viewer");
        await ownerInvites("storekeeper");
        assert.equal(await raw(env, `siteInvites/s1/${KEY}`), "storekeeper");
    });
    it("the owner can see the pending invites of the site, and take one back", async () => {
        await ownerInvites();
        await assertSucceeds(get(ref(as(env, "owner1"), "siteInvites/s1")));
        await assertSucceeds(update(ref(as(env, "owner1")), { [`userInvites/${KEY}/s1`]: null, [`siteInvites/s1/${KEY}`]: null }));
        assert.equal(await raw(env, `userInvites/${KEY}/s1`), null);
    });
    it("cannot invite as owner (one owner per site)", async () => {
        await assertFails(update(ref(as(env, "owner1")), invite("owner")));
    });
    it("the invite carries the site name and the inviter, and nothing else", async () => {
        await ownerInvites("viewer");
        assert.deepEqual(await raw(env, `userInvites/${KEY}/s1`), inviteRecord("viewer"));
        const base = inviteRecord("viewer");
        for (const bad of [
            { ...base, siteName: "" }, { ...base, siteName: "x".repeat(101) }, { ...base, invitedBy: "" },
            { ...base, admin: true }, { role: "viewer" }, { ...base, role: "owner" }, "viewer",
        ]) {
            await assertFails(update(ref(as(env, "owner1")), { [`userInvites/${KEY}/s1`]: bad }));
        }
    });
    it("cannot invite with an invalid role", async () => {
        await assertFails(update(ref(as(env, "owner1")), invite("admin")));
        await assertFails(update(ref(as(env, "owner1")), invite(true)));
    });
    it("storekeeper, viewer and stranger cannot invite", async () => {
        for (const uid of ["keeper1", "viewer1", "stranger"]) {
            await assertFails(update(ref(as(env, uid)), invite("viewer")));
        }
        assert.equal(await raw(env, `siteInvites/s1/${KEY}`), null);
    });
    it("the owner of site 1 cannot invite people into site 2", async () => {
        await assertFails(update(ref(as(env, "owner1")), invite("viewer", "s2")));
    });
});

describe("accepting an invite", () => {
    it("a verified invitee joins with the invited role, and the invite is used up", async () => {
        await ownerInvites("storekeeper");
        await assertSucceeds(update(ref(sam()), accept("storekeeper")));
        assert.equal(await raw(env, "members/s1/sam"), "storekeeper");
        assert.equal(await raw(env, "userSites/sam/s1"), "storekeeper");
        assert.equal(await raw(env, `userInvites/${KEY}/s1`), null);
        assert.equal(await raw(env, `siteInvites/s1/${KEY}`), null);
    });

    it("after joining, the roles take effect", async () => {
        await ownerInvites("viewer");
        await update(ref(sam()), accept("viewer"));
        await assertSucceeds(get(ref(sam(), "materials/s1")));
        await assertFails(set(ref(sam(), "materials/s1/m9"), { name: "x", quantity: 1, units: "kg", lastUpdated: "2024-01-01" }));
    });

    it("the invitee records their email in memberInfo after joining", async () => {
        await ownerInvites();
        await update(ref(sam()), accept());
        await assertSucceeds(set(ref(sam(), "memberInfo/s1/sam"), { email: EMAIL }));
    });

    it("an unverified email cannot accept (anyone can register someone else's address)", async () => {
        await ownerInvites();
        await assertFails(update(ref(sam({ email_verified: false })), accept()));
        assert.equal(await raw(env, "members/s1/sam"), null);
    });

    it("a different email cannot accept, even knowing the site id", async () => {
        await ownerInvites();
        const mallory = as(env, "mallory", { email: "mallory@evil.example.com" });
        await assertFails(update(ref(mallory), {
            "members/s1/mallory": "viewer", "userSites/mallory/s1": "viewer",
            [`userInvites/${KEY}/s1`]: null,
        }));
        assert.equal(await raw(env, "members/s1/mallory"), null);
    });

    it("cannot accept a higher role than was offered", async () => {
        await ownerInvites("viewer");
        await assertFails(update(ref(sam()), accept("storekeeper")));
        await assertFails(update(ref(sam()), accept("owner")));
    });

    it("cannot accept when nobody invited them", async () => {
        await assertFails(update(ref(sam()), accept("viewer")));
        await assertFails(update(ref(sam()), accept("viewer", "s2")));
    });

    it("cannot accept an invite to site 1 into site 2", async () => {
        await ownerInvites("viewer", "s1");
        await assertFails(update(ref(sam()), accept("viewer", "s2")));
    });

    it("must consume the invite in the same update (no reusable invite)", async () => {
        await ownerInvites("viewer");
        await assertFails(update(ref(sam()), { "members/s1/sam": "viewer", "userSites/sam/s1": "viewer" }));
        assert.equal(await raw(env, "members/s1/sam"), null);
    });

    it("an invite works once: after the owner removes the member it does not come back", async () => {
        await ownerInvites("viewer");
        await update(ref(sam()), accept("viewer"));
        await update(ref(as(env, "owner1")), { "members/s1/sam": null, "userSites/sam/s1": null });
        await assertFails(update(ref(sam()), accept("viewer")));
    });

    it("an email with a plus sign, digits and several dots works as a key", async () => {
        const email = "a.b+c.d9@sub.mail.example.org";
        const key = "a,b+c,d9@sub,mail,example,org";
        await assertSucceeds(update(ref(as(env, "owner1")), { [`userInvites/${key}/s1`]: inviteRecord("viewer"), [`siteInvites/s1/${key}`]: "viewer" }));
        const dot = as(env, "dot", { email });
        await assertSucceeds(update(ref(dot), {
            "members/s1/dot": "viewer", "userSites/dot/s1": "viewer",
            [`userInvites/${key}/s1`]: null, [`siteInvites/s1/${key}`]: null,
        }));
    });

    it("the match ignores upper case in the account email", async () => {
        await ownerInvites("viewer");
        const shouty = as(env, "sam", { email: EMAIL.toUpperCase() });
        await assertSucceeds(update(ref(shouty), accept("viewer")));
    });
});

describe("reading invites", () => {
    it("the invitee reads their own pending invites and nobody else's", async () => {
        await ownerInvites();
        await assertSucceeds(get(ref(sam(), `userInvites/${KEY}`)));
        await assertFails(get(ref(as(env, "mallory", { email: "mallory@evil.example.com" }), `userInvites/${KEY}`)));
        await assertFails(get(ref(as(env, "viewer1"), `userInvites/${KEY}`)));
        await assertFails(get(ref(anonymous(env), `userInvites/${KEY}`)));
        await assertFails(get(ref(sam(), "userInvites")));
    });
    it("an unverified email cannot even list its invites", async () => {
        await ownerInvites();
        await assertFails(get(ref(sam({ email_verified: false }), `userInvites/${KEY}`)));
    });
    it("the invitee cannot read the site's invite list", async () => {
        await ownerInvites();
        await assertFails(get(ref(sam(), "siteInvites/s1")));
    });
});

describe("declining an invite", () => {
    it("the invitee deletes it, and cannot create or change one", async () => {
        await ownerInvites("viewer");
        await assertSucceeds(update(ref(sam()), { [`userInvites/${KEY}/s1`]: null, [`siteInvites/s1/${KEY}`]: null }));
        await assertFails(update(ref(sam()), invite("storekeeper")));
        await assertFails(update(ref(sam()), invite("viewer")));
    });
    it("somebody else cannot delete it", async () => {
        await ownerInvites("viewer");
        await assertFails(update(ref(as(env, "mallory", { email: "mallory@evil.example.com" })), { [`userInvites/${KEY}/s1`]: null }));
        assert.equal((await raw(env, `userInvites/${KEY}/s1`)).role, "viewer");
    });
});
