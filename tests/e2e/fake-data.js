// In-memory stand-in for src/data.js, served to the page by the E2E tests.
// Same exports as the real module, so dashboard.js cannot tell the difference.
// It records every write in window.__nailit.writes so tests can assert on exactly
// what would have gone to Firebase.
import { buildSiteDeleteUpdates } from "/src/logic.js";

const seed = window.__seed || {};
const db = {
    sites: structuredClone(seed.sites || {}),
    materials: structuredClone(seed.materials || {}),
};
const writes = [];
const listeners = new Set();
const everSubscribed = [];
const pendingAcks = [];
let counter = 0;

function nextId() {
    counter += 1;
    return `-Nfake${counter}`;
}

function emit(listener) {
    const snapshot = listener.kind === "sites"
        ? structuredClone(db.sites)
        : Object.fromEntries(
            Object.entries(db.materials).filter(([, m]) => m && m.siteId === listener.siteId),
        );
    listener.onData(structuredClone(snapshot));
}

function notify() {
    for (const listener of [...listeners]) {
        setTimeout(() => {
            if (listeners.has(listener)) {
                emit(listener);
            }
        }, 0);
    }
}

function subscribe(listener) {
    everSubscribed.push(listener);
    listeners.add(listener);
    setTimeout(() => {
        if (listeners.has(listener)) {
            emit(listener);
        }
    }, 0);
    return () => listeners.delete(listener);
}

window.__nailit = {
    db,
    writes,
    activeListeners: () => [...listeners].map((l) => ({ kind: l.kind, siteId: l.siteId })),
    // A change made by somebody else, not through this page's own data layer.
    externalSetMaterial(id, material) {
        db.materials[id] = material;
        notify();
    },
    releaseAcks() {
        pendingAcks.splice(0).forEach((resolve) => resolve());
    },
    externalRemoveMaterial(id) {
        delete db.materials[id];
        notify();
    },
    // Firebase can deliver a callback that was already in flight when its listener was
    // removed. Replay every unsubscribed listener to prove the page ignores them.
    replayUnsubscribed() {
        for (const listener of everSubscribed) {
            if (!listeners.has(listener)) {
                emit(listener);
            }
        }
    },
};

export function subscribeSites(onData, onError) {
    return subscribe({ kind: "sites", onData, onError });
}

export function subscribeMaterials(siteId, onData, onError) {
    return subscribe({ kind: "materials", siteId, onData, onError });
}

export function addSite(site) {
    const id = nextId();
    writes.push({ op: "push", path: "sites", id, value: site });
    db.sites[id] = site;
    notify();
    return { id, done: Promise.resolve() };
}

export function addMaterial(material) {
    const id = nextId();
    writes.push({ op: "push", path: "materials", id, value: material });
    db.materials[id] = material;
    notify();
    return { id, done: Promise.resolve() };
}

export function updateMaterial(materialId, fields) {
    if (window.__nailit.throwOnWrite) {
        throw new Error("boom");
    }
    writes.push({ op: "update", path: `materials/${materialId}`, value: fields });
    // Like Firebase, update() on a path that does not exist creates it. That is how the
    // old double-click bug left junk nodes behind.
    db.materials[materialId] = { ...(db.materials[materialId] || {}), ...fields };
    notify();
    // A slow or offline server: the write is queued but not acknowledged yet.
    return ack();
}

// With holdAcks on, writes stay unacknowledged until releaseAcks() resolves them all.
function ack() {
    if (window.__nailit.holdAcks) {
        return new Promise((resolve) => { pendingAcks.push(resolve); });
    }
    return Promise.resolve();
}

export function removeMaterial(materialId) {
    writes.push({ op: "remove", path: `materials/${materialId}` });
    delete db.materials[materialId];
    notify();
    return ack();
}

export async function deleteSiteCascade(siteId) {
    const paths = buildSiteDeleteUpdates(siteId, db.materials);
    writes.push({ op: "multi", paths });
    for (const path of Object.keys(paths)) {
        const [collection, id] = path.split("/");
        delete db[collection][id];
    }
    notify();
}
