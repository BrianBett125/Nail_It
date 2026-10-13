// The REAL src/auth.js against the recording Firebase stub, plus the pure error messages.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/sdk-loader.mjs", import.meta.url);
const auth = await import("../../src/auth.js");
const { firebaseConfig, isConfigured } = await import("../../src/firebase-config.js");
const errors = await import("../../src/auth-errors.js");
const sdk = globalThis.__sdk;
const state = globalThis.__authState;

const calls = (name) => sdk.calls.filter((c) => c.name === name);

beforeEach(() => {
    sdk.calls.length = 0;
    sdk.authError = null;
    sdk.verificationError = null;
    state.auth.currentUser = null;
    state.listeners.length = 0;
    firebaseConfig.apiKey = "configured-key";
});

test("with no real API key, sign-in says 'not set up' and sends nothing", async () => {
    firebaseConfig.apiKey = "REPLACE_WITH_WEB_API_KEY";
    assert.equal(isConfigured(), false);
    for (const attempt of [
        () => auth.signIn("a@b.co", "secret1"),
        () => auth.signUp("a@b.co", "secret1"),
        () => auth.resetPassword("a@b.co"),
    ]) {
        await assert.rejects(attempt(), { message: errors.NOT_CONFIGURED_MESSAGE });
    }
    assert.equal(calls("signIn").length + calls("createUser").length + calls("sendPasswordResetEmail").length, 0, "no request leaves the page");
});

test("isConfigured needs a real key", () => {
    assert.equal(isConfigured({ apiKey: "" }), false);
    assert.equal(isConfigured({ apiKey: "REPLACE_ME" }), false);
    assert.equal(isConfigured({}), false);
    assert.equal(isConfigured({ apiKey: "AIzaSy-real" }), true);
});

test("onUser reports the user as { uid, email, emailVerified }, and null when signed out", () => {
    const seen = [];
    auth.onUser((u) => seen.push(u));
    state.listeners[0]({ uid: "u1", email: "sam@example.com", emailVerified: true, extra: "ignored", getIdToken: () => {} });
    state.listeners[0](null);
    assert.deepEqual(seen, [{ uid: "u1", email: "sam@example.com", emailVerified: true }, null]);
});

test("signIn passes the credentials through and returns the plain user", async () => {
    const user = await auth.signIn("sam@example.com", "secret1");
    assert.deepEqual(calls("signIn")[0].args, ["sam@example.com", "secret1"]);
    assert.deepEqual(user, { uid: "u1", email: "sam@example.com", emailVerified: false });
});

test("signIn failures reach the caller with their Firebase code", async () => {
    sdk.authError = Object.assign(new Error("x"), { code: "auth/invalid-credential" });
    await assert.rejects(auth.signIn("a@b.co", "bad"), { code: "auth/invalid-credential" });
});

test("signUp creates the account and sends the verification email", async () => {
    const user = await auth.signUp("sam@example.com", "secret1");
    assert.deepEqual(calls("createUser")[0].args, ["sam@example.com", "secret1"]);
    assert.deepEqual(calls("sendEmailVerification").map((c) => c.args[0]), ["sam@example.com"]);
    assert.equal(user.emailVerified, false);
});

test("signUp still succeeds when only the verification email could not be sent", async () => {
    sdk.verificationError = new Error("quota");
    const user = await auth.signUp("sam@example.com", "secret1");
    assert.equal(user.uid, "u1");
});

test("signUp with an address already in use fails with the Firebase code", async () => {
    sdk.authError = Object.assign(new Error("x"), { code: "auth/email-already-in-use" });
    await assert.rejects(auth.signUp("a@b.co", "secret1"), { code: "auth/email-already-in-use" });
    assert.equal(calls("sendEmailVerification").length, 0);
});

test("resetPassword sends the email, and does not reveal that an address has no account", async () => {
    await auth.resetPassword("sam@example.com");
    assert.deepEqual(calls("sendPasswordResetEmail")[0].args, ["sam@example.com"]);

    sdk.authError = Object.assign(new Error("x"), { code: "auth/user-not-found" });
    await assert.doesNotReject(auth.resetPassword("nobody@example.com"));

    sdk.authError = Object.assign(new Error("x"), { code: "auth/too-many-requests" });
    await assert.rejects(auth.resetPassword("a@b.co"), { code: "auth/too-many-requests" });
});

test("signOut signs out", async () => {
    state.auth.currentUser = { uid: "u1" };
    await auth.signOut();
    assert.equal(calls("signOut").length, 1);
});

test("resendVerification needs a signed-in user", async () => {
    await assert.rejects(auth.resendVerification(), { message: "Sign in first." });
    await auth.signIn("sam@example.com", "secret1");
    sdk.calls.length = 0;
    await auth.resendVerification();
    assert.equal(calls("sendEmailVerification").length, 1);
});

test("refreshUser reloads the account and forces a new token, so the rules see the verified email", async () => {
    assert.equal(await auth.refreshUser(), null, "nobody signed in");
    await auth.signIn("sam@example.com", "secret1");
    sdk.calls.length = 0;
    state.auth.currentUser.emailVerified = true;
    const user = await auth.refreshUser();
    assert.deepEqual(sdk.calls.map((c) => c.name), ["user.reload", "user.getIdToken"]);
    assert.equal(calls("user.getIdToken")[0].args[0], true, "force refresh");
    assert.equal(user.emailVerified, true);
});

test("friendlyAuthError speaks plainly for each common failure", () => {
    const say = (code) => errors.friendlyAuthError({ code });
    assert.equal(say("auth/invalid-credential"), "Wrong email or password.");
    assert.equal(say("auth/wrong-password"), "Wrong email or password.");
    assert.equal(say("auth/user-not-found"), "Wrong email or password.", "same words as a wrong password: no account lookup");
    assert.match(say("auth/email-already-in-use"), /already exists/);
    assert.match(say("auth/weak-password"), /at least 6/);
    assert.match(say("auth/network-request-failed"), /No connection/);
    assert.match(say("auth/too-many-requests"), /Wait a few minutes/);
    assert.match(say("auth/operation-not-allowed"), /not turned on/);
    assert.match(say("auth/invalid-api-key"), /not set up/);
});

test("friendlyAuthError never leaks a raw code or message", () => {
    assert.equal(errors.friendlyAuthError({ code: "auth/something-new", message: "internal detail" }), errors.GENERIC_AUTH_MESSAGE);
    assert.equal(errors.friendlyAuthError(new Error("boom")), errors.GENERIC_AUTH_MESSAGE);
    assert.equal(errors.friendlyAuthError(undefined), errors.GENERIC_AUTH_MESSAGE);
    assert.equal(errors.friendlyAuthError(new Error("API key not valid")), errors.NOT_CONFIGURED_MESSAGE);
});
