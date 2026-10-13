// Recording stand-in for firebase-app.js and firebase-database.js. Every call lands in
// globalThis.__sdk.calls so tests can assert exactly what src/data.js asked Firebase to do.
const sdk = (globalThis.__sdk = { calls: [], getValue: null, listeners: [], keyCounter: 0 });

const record = (name, ...args) => sdk.calls.push({ name, args });

export function initializeApp(settings) {
    record("initializeApp", settings);
    return { kind: "app" };
}

export function getDatabase() {
    return { kind: "db" };
}

export function ref(_db, path = "") {
    return { kind: "ref", path };
}

export function orderByChild(field) {
    return { constraint: "orderByChild", field };
}

export function equalTo(value) {
    return { constraint: "equalTo", value };
}

export function query(base, ...constraints) {
    return { kind: "query", base, constraints };
}

export function onValue(target, onData, onError) {
    const unsubscribe = () => record("unsubscribe", target);
    sdk.listeners.push({ target, onData, onError, unsubscribe });
    record("onValue", target);
    return unsubscribe;
}

export function get(target) {
    record("get", target);
    if (sdk.hangGet) {
        return new Promise(() => {}); // the server never answers: no signal
    }
    // sdk.getValues maps a path to its value; anything else gets sdk.getValue.
    const value = sdk.getValues && target.path in sdk.getValues ? sdk.getValues[target.path] : sdk.getValue;
    return Promise.resolve({ val: () => value });
}

export function update(target, values) {
    record("update", target, values);
    return Promise.resolve();
}

export function set(target, value) {
    record("set", target, value);
    return sdk.setError ? Promise.reject(sdk.setError) : Promise.resolve();
}

export function remove(target) {
    record("remove", target);
    return Promise.resolve();
}

// Like the real push(): returns a thenable reference that already knows its key.
export function push(target, value) {
    sdk.keyCounter += 1;
    record("push", target, value);
    return Object.assign(Promise.resolve(), { key: `-Nstub${sdk.keyCounter}` });
}

// ---- firebase-auth.js -------------------------------------------------------------

// Each call is recorded; sdk.authError (an error to throw) and sdk.currentUser steer the next call.
const fakeUser = (extra = {}) => ({
    uid: "u1",
    email: "sam@example.com",
    emailVerified: false,
    reload: async () => { record("user.reload"); },
    getIdToken: async (force) => { record("user.getIdToken", force); return "token"; },
    ...extra,
});

const authState = (globalThis.__authState = { auth: { currentUser: null }, listeners: [] });

export function getAuth() {
    return authState.auth;
}

export function onAuthStateChanged(auth, callback) {
    authState.listeners.push(callback);
    record("onAuthStateChanged");
    return () => record("auth.unsubscribe");
}

async function maybeFail() {
    if (sdk.authError) {
        throw sdk.authError;
    }
}

export async function signInWithEmailAndPassword(auth, email, password) {
    record("signIn", email, password);
    await maybeFail();
    authState.auth.currentUser = fakeUser({ email });
    return { user: authState.auth.currentUser };
}

export async function createUserWithEmailAndPassword(auth, email, password) {
    record("createUser", email, password);
    await maybeFail();
    authState.auth.currentUser = fakeUser({ email });
    return { user: authState.auth.currentUser };
}

export async function sendEmailVerification(user) {
    record("sendEmailVerification", user.email);
    if (sdk.verificationError) {
        throw sdk.verificationError;
    }
}

export async function sendPasswordResetEmail(auth, email) {
    record("sendPasswordResetEmail", email);
    await maybeFail();
}

export async function signOut() {
    record("signOut");
    authState.auth.currentUser = null;
}
