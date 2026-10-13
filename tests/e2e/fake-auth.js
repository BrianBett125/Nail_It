// In-memory stand-in for src/auth.js, served to the pages by the E2E tests.
// window.__seed.user is the signed-in account: omit it for a verified default user,
// set it to null to start signed out. window.__auth records every call and lets a test
// make the next one fail (failWith: { code }) or wait (hold).
const seed = window.__seed || {};
const DEFAULT_USER = { uid: "u1", email: "foreman@example.com", emailVerified: true };

let user = "user" in seed ? seed.user : DEFAULT_USER;
const listeners = new Set();
const calls = [];
let release = null;

function notify() {
    for (const listener of [...listeners]) {
        listener(user ? { ...user } : null);
    }
}

window.__auth = {
    calls,
    get user() { return user ? { ...user } : null; },
    setUser(next) { user = next; notify(); },
    failWith: null,   // { code } thrown by the next signIn / signUp / resetPassword
    hold: false,      // sign-in / sign-up wait until releaseHold()
    verifyOnRefresh: false,
    releaseHold() { if (release) { release(); release = null; } },
};

function maybeFail() {
    if (window.__auth.failWith) {
        const { code } = window.__auth.failWith;
        window.__auth.failWith = null;
        throw Object.assign(new Error("fake auth failure"), { code });
    }
}

async function maybeHold() {
    if (window.__auth.hold) {
        await new Promise((resolve) => { release = resolve; });
    }
}

export function onUser(callback) {
    listeners.add(callback);
    setTimeout(() => callback(user ? { ...user } : null), 0);
    return () => listeners.delete(callback);
}

export async function signIn(email, password) {
    calls.push({ op: "signIn", email, password });
    await maybeHold();
    maybeFail();
    user = { uid: "u1", email, emailVerified: true };
    notify();
    return { ...user };
}

export async function signUp(email, password) {
    calls.push({ op: "signUp", email, password });
    await maybeHold();
    maybeFail();
    user = { uid: "u2", email, emailVerified: false };
    notify();
    return { ...user };
}

export async function resetPassword(email) {
    calls.push({ op: "resetPassword", email });
    await maybeHold();
    maybeFail();
}

export async function signOut() {
    calls.push({ op: "signOut" });
    user = null;
    notify();
}

export async function resendVerification() {
    calls.push({ op: "resendVerification" });
    maybeFail();
}

export async function refreshUser() {
    calls.push({ op: "refreshUser" });
    if (user && window.__auth.verifyOnRefresh) {
        user = { ...user, emailVerified: true };
    }
    return user ? { ...user } : null;
}
