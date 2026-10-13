import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ROLES,
    INVITE_ROLES,
    canWriteMaterials,
    canManageSite,
    roleLabel,
    normalizeEmail,
    isValidEmail,
    emailKey,
    emailFromKey,
    validateInvite,
    INVITE_EMAIL_MESSAGE,
    INVITE_ROLE_MESSAGE,
    INVITE_SELF_MESSAGE,
} from "../../src/roles.js";

test("the role table: who may write materials and who may manage the site", () => {
    assert.deepEqual(ROLES.map(canWriteMaterials), [true, true, false]); // owner, storekeeper, viewer
    assert.deepEqual(ROLES.map(canManageSite), [true, false, false]);
    for (const nobody of [undefined, null, "", "admin", "OWNER"]) {
        assert.equal(canWriteMaterials(nobody), false, String(nobody));
        assert.equal(canManageSite(nobody), false, String(nobody));
    }
});

test("an invite can never grant the owner role", () => {
    assert.deepEqual(INVITE_ROLES, ["storekeeper", "viewer"]);
});

test("roleLabel gives a readable name, and a safe one for an unknown role", () => {
    assert.equal(roleLabel("storekeeper"), "Storekeeper");
    assert.equal(roleLabel("viewer"), "Viewer");
    assert.equal(roleLabel(undefined), "No access");
});

test("normalizeEmail trims and lower-cases, and survives non-strings", () => {
    assert.equal(normalizeEmail("  Sam.W@Mail.Example.COM "), "sam.w@mail.example.com");
    assert.equal(normalizeEmail(undefined), "");
    assert.equal(normalizeEmail(42), "");
});

test("emailKey swaps every dot for a comma, the same swap the database rules make", () => {
    assert.equal(emailKey("Sam.W.Mwangi@mail.example.com"), "sam,w,mwangi@mail,example,com");
    assert.equal(emailKey("a@b.co"), "a@b,co");
});

test("emailFromKey reverses emailKey for every valid email", () => {
    for (const email of ["sam@example.com", "a.b.c@mail.example.com", "x+tag@sub.example.org", "d9@e.io"]) {
        assert.equal(emailFromKey(emailKey(email)), email);
    }
});

test("emailKey never contains a character a database key cannot hold", () => {
    for (const email of ["sam.w@mail.example.com", "a+b@c.d.e"]) {
        assert.doesNotMatch(emailKey(email), /[.#$\[\]\/]/);
    }
});

test("isValidEmail accepts normal addresses", () => {
    for (const ok of ["a@b.co", "sam.w@mail.example.com", "x+tag@sub.example.org", " Sam@Example.com "]) {
        assert.equal(isValidEmail(ok), true, ok);
    }
});

test("isValidEmail rejects what cannot be an invite key or an address", () => {
    const bad = [
        "", "   ", "plain", "@b.co", "a@", "a@b", "a@@b.co", "a@b@c.co", "a b@c.co", "a@b .co",
        ".a@b.co", "a.@b.co", "a@.b.co", "a@b.co.", "a..b@c.co", "a@b..co",
        "a#b@c.co", "a$b@c.co", "a[b@c.co", "a]b@c.co", "a/b@c.co", "a,b@c.co",
        `${"x".repeat(250)}@b.co`, undefined, null, 5,
    ];
    for (const email of bad) {
        assert.equal(isValidEmail(email), false, String(email));
    }
});

test("validateInvite returns the normalized email, its key and the role", () => {
    assert.deepEqual(validateInvite({ email: " Sam.W@Mail.Example.com ", role: "viewer" }, "owner@example.com"), {
        ok: true,
        value: { email: "sam.w@mail.example.com", key: "sam,w@mail,example,com", role: "viewer" },
    });
});

test("validateInvite rejects a bad email, a bad role and the owner's own email", () => {
    assert.deepEqual(validateInvite({ email: "nope", role: "viewer" }), { ok: false, error: INVITE_EMAIL_MESSAGE });
    assert.deepEqual(validateInvite({ email: "a@b.co", role: "owner" }), { ok: false, error: INVITE_ROLE_MESSAGE });
    assert.deepEqual(validateInvite({ email: "a@b.co", role: "" }), { ok: false, error: INVITE_ROLE_MESSAGE });
    assert.deepEqual(validateInvite({ email: "A@B.co", role: "viewer" }, "a@b.CO"), { ok: false, error: INVITE_SELF_MESSAGE });
});
