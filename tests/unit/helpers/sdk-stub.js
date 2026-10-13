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
    return Promise.resolve({ val: () => sdk.getValue });
}

export function update(target, values) {
    record("update", target, values);
    return Promise.resolve();
}

export function set(target, value) {
    record("set", target, value);
    return Promise.resolve();
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
