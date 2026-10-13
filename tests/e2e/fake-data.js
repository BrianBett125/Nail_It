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
    return `nfake${String(counter).padStart(3, "0")}`; // sorts after the seed ids m1..m3, like a newer push id
}

function emit(listener) {
    const snapshot = listener.kind === "sites"
        ? structuredClone(db.sites)
        // Like orderByChild("siteId") + equalTo: ties come back in key order.
        : Object.fromEntries(
            Object.entries(db.materials)
                .filter(([, m]) => m && m.siteId === listener.siteId)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
    listener.onData(structuredClone(snapshot));
}

// With holdSnapshots on, subscribers hear nothing until releaseSnapshots(): the loading state.
const heldSnapshots = [];

function deliver(listener) {
    if (!listeners.has(listener)) {
        return;
    }
    if (window.__nailit.holdSnapshots) {
        heldSnapshots.push(listener);
        return;
    }
    emit(listener);
}

function notify() {
    for (const listener of [...listeners]) {
        setTimeout(() => deliver(listener), 0);
    }
}

function subscribe(listener) {
    everSubscribed.push(listener);
    listeners.add(listener);
    setTimeout(() => deliver(listener), 0);
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
    releaseSnapshots() {
        window.__nailit.holdSnapshots = false;
        heldSnapshots.splice(0).forEach(deliver);
    },
    externalRemoveSite(id) {
        delete db.sites[id];
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

// Flags a test set before load (window.__preset), for example holdSnapshots.
Object.assign(window.__nailit, window.__preset || {});

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
    // failAdds: the server refuses the write (permission denied). Firebase has already shown
    // the site locally by then, and then takes it back.
    if (window.__nailit.failAdds) {
        const done = Promise.reject(new Error("PERMISSION_DENIED"));
        done.catch(() => {
            delete db.sites[id];
            notify();
        });
        return { id, done };
    }
    return { id, done: ack() };
}

export function addMaterial(material) {
    const id = nextId();
    writes.push({ op: "push", path: "materials", id, value: material });
    db.materials[id] = material;
    notify();
    return { id, done: ack() };
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

export function restoreMaterial(materialId, material) {
    writes.push({ op: "set", path: `materials/${materialId}`, value: material });
    db.materials[materialId] = structuredClone(material);
    notify();
    return ack();
}

export function removeMaterial(materialId) {
    if (window.__nailit.throwOnRemove) {
        throw new Error("remove denied");
    }
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
