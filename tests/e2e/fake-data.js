// In-memory stand-in for src/data.js, served to the page by the E2E tests.
// Same exports as the real module, so dashboard.js cannot tell the difference.
// It records every write in window.__nailit.writes so tests can assert on exactly
// what would have gone to Firebase. What the real module sends to Firebase is checked by
// tests/unit/data.test.js, and who may do what by tests/rules/.
//
// Seed (window.__seed), all optional:
//   sites       { siteId: { name, location, buildingType, ... } }
//   materials   { materialId: { name, quantity, units, updatedAt?, lastUpdated?, minLevel?, siteId } }  (flat; filed under its site)
//   movements   { movementId: { siteId, materialId, materialName, units, delta, type, byUid, byEmail, at, note? } }  (flat; filed under its site)
//   roles       { siteId: "owner" | "storekeeper" | "viewer" }  the signed-in user's role, default "owner"
//   members     { siteId: [{ uid, role, email }] }              default: just the signed-in user
//   siteInvites { siteId: [{ key, email, role }] }              pending invites, as the owner sees them
//   invites     { siteId: { role, siteName, invitedBy } }       invitations waiting for the signed-in user
//   hiddenSites [siteId]                                        exist, but the user is not in them yet (invited)
import { buildSiteDeleteUpdates } from "/src/logic.js";
import { emailFromKey } from "/src/roles.js";
import {
    buildMovementUpdates,
    buildAddMaterialUpdates,
    buildRemoveMaterialUpdates,
    buildRestoreMaterialUpdates,
    buildEditMaterialUpdates,
    sortMovements,
} from "/src/movements.js";

const seed = window.__seed || {};
const me = () => (window.__auth && window.__auth.user) || { uid: "u1", email: "foreman@example.com" };

function fileBySite(flat) {
    const bySite = {};
    for (const [id, value] of Object.entries(flat || {})) {
        const { siteId, ...rest } = structuredClone(value);
        (bySite[siteId] ||= {})[id] = rest;
    }
    return bySite;
}

const db = {
    sites: structuredClone(seed.sites || {}),
    materials: fileBySite(seed.materials),
    movements: fileBySite(seed.movements),
    roles: structuredClone(seed.roles || {}),
    members: structuredClone(seed.members || {}),
    siteInvites: structuredClone(seed.siteInvites || {}),
    invites: structuredClone(seed.invites || {}),
    hidden: [...(seed.hiddenSites || [])],
};
const writes = [];
const listeners = new Set();
const everSubscribed = [];
const pendingAcks = [];
const heldSnapshots = [];
let counter = 0;

function nextId() {
    counter += 1;
    // Sorts after the seed ids m1..m3, like a newer push id.
    return `nfake${String(counter).padStart(3, "0")}`;
}

const roleOf = (siteId) => db.roles[siteId] || "owner";
const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

function snapshotFor(listener) {
    if (listener.kind === "sites") {
        return Object.fromEntries(Object.entries(db.sites)
            .filter(([id]) => !db.hidden.includes(id))
            .map(([id, site]) => [id, { ...site, role: roleOf(id) }]));
    }
    if (listener.kind === "materials") {
        // Like a push-id keyed node: ties come back in key order.
        return Object.fromEntries(Object.entries(db.materials[listener.siteId] || {}).sort(byKey));
    }
    if (listener.kind === "movements") {
        let list = Object.entries(db.movements[listener.siteId] || {}).map(([id, movement]) => ({ id, ...movement }));
        if (listener.materialId) {
            list = list.filter((movement) => movement.materialId === listener.materialId);
        }
        return sortMovements(list).slice(-listener.limit);
    }
    if (listener.kind === "members") {
        const members = db.members[listener.siteId]
            || [{ uid: me().uid, role: roleOf(listener.siteId), email: me().email }];
        return {
            members,
            invites: listener.withInvites ? (db.siteInvites[listener.siteId] || []) : [],
        };
    }
    return db.invites; // kind "invites"
}

function emit(listener) {
    listener.onData(structuredClone(snapshotFor(listener)));
}

// With holdSnapshots on, subscribers hear nothing until releaseSnapshots(): the loading state.
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
    // The server checks membership when the listen request arrives, not when data is ready.
    // Listening to a site the user is not in yet is refused, and a refused listener is cancelled:
    // it does not start working when the membership is written a moment later.
    if (listener.kind === "materials" && db.hidden.includes(listener.siteId)) {
        setTimeout(() => listener.onError(new Error("permission_denied")), 0);
        return () => {};
    }
    listeners.add(listener);
    setTimeout(() => deliver(listener), 0);
    return () => listeners.delete(listener);
}

// With holdAcks on, writes stay unacknowledged until releaseAcks() resolves them all.
function ack() {
    if (window.__nailit.holdAcks) {
        return new Promise((resolve) => { pendingAcks.push(resolve); });
    }
    return Promise.resolve();
}

window.__nailit = {
    db,
    writes,
    activeListeners: () => [...listeners].map((l) => ({ kind: l.kind, siteId: l.siteId })),
    // A change made by somebody else, not through this page's own data layer.
    externalSetMaterial(siteId, id, material) {
        (db.materials[siteId] ||= {})[id] = material;
        notify();
    },
    externalRemoveMaterial(siteId, id) {
        delete (db.materials[siteId] || {})[id];
        notify();
    },
    externalRemoveSite(id) {
        delete db.sites[id];
        delete db.materials[id];
        delete db.movements[id];
        notify();
    },
    // Somebody else records a movement (their phone, not this page): quantity and history move together.
    externalMovement(siteId, materialId, { type, delta, note, byUid = "u2", byEmail = "other@example.com" }) {
        const material = db.materials[siteId][materialId];
        const id = nextId();
        const record = {
            materialId, materialName: material.name, units: material.units, delta, type, byUid, byEmail, at: clock(),
        };
        if (note) {
            record.note = note;
        }
        (db.movements[siteId] ||= {})[id] = record;
        material.quantity += delta;
        material.updatedAt = record.at;
        material.lastMovementId = id;
        notify();
        return id;
    },
    externalSetRole(siteId, role) {
        db.roles[siteId] = role;
        notify();
    },
    externalSetMembers(siteId, members) {
        db.members[siteId] = members;
        notify();
    },
    externalAddInvite(siteId, invite) {
        db.invites[siteId] = invite;
        notify();
    },
    releaseSnapshots() {
        window.__nailit.holdSnapshots = false;
        heldSnapshots.splice(0).forEach(deliver);
    },
    releaseAcks() {
        pendingAcks.splice(0).forEach((resolve) => resolve());
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

export function subscribeSites(uid, onData, onError) {
    return subscribe({ kind: "sites", uid, onData, onError });
}

export function subscribeMaterials(siteId, onData, onError) {
    return subscribe({ kind: "materials", siteId, onData, onError });
}

export function addSite(site, user) {
    const id = nextId();
    const value = { ...site, ownerUid: user.uid };
    writes.push({ op: "push", path: "sites", id, value, owner: { uid: user.uid, email: user.email } });
    db.sites[id] = value;
    db.roles[id] = "owner";
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

// ---- Stock: materials and movements ---------------------------------------------------
// Every write is built by the same functions src/data.js uses (src/movements.js), recorded as one
// multi-path update, then applied the way Firebase applies it: deep paths, null deletes, server
// timestamps and increments filled in. database.rules.json is tested on the emulator; the one
// rule the page must live with here is that stock can never go below zero.

const sv = {
    timestamp: () => ({ ".sv": "timestamp" }),
    increment: (n) => ({ ".sv": { increment: n } }),
};
const clock = () => (window.__nailit.now ? window.__nailit.now() : Date.now());

function fill(value, current) {
    if (value && typeof value === "object" && ".sv" in value) {
        if (value[".sv"] === "timestamp") {
            return clock();
        }
        return (typeof current === "number" ? current : 0) + value[".sv"].increment;
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, fill(v, current && current[key])]));
    }
    return value;
}

function walk(root, parts) {
    return parts.reduce((node, part) => (node == null ? undefined : node[part]), root);
}

function applyPaths(tree, updates) {
    for (const [path, value] of Object.entries(updates)) {
        const parts = path.split("/");
        const last = parts.pop();
        let node = tree;
        for (const part of parts) {
            node = node[part] ??= {};
        }
        if (value === null) {
            delete node[last];
        } else {
            node[last] = fill(value, node[last]);
        }
    }
}

// Applies the update the way the server would, or refuses the whole thing.
function writeStock(updates) {
    const tree = { materials: structuredClone(db.materials), movements: structuredClone(db.movements) };
    applyPaths(tree, updates);
    for (const materials of Object.values(tree.materials)) {
        for (const material of Object.values(materials || {})) {
            if (material && typeof material.quantity === "number" && material.quantity < 0) {
                writes.push({ op: "multi", paths: updates, rejected: true });
                return Promise.reject(new Error("PERMISSION_DENIED: stock cannot go below zero"));
            }
        }
    }
    writes.push({ op: "multi", paths: updates });
    db.materials = tree.materials;
    db.movements = tree.movements;
    notify();
    // A slow or offline server: the write is queued but not acknowledged yet.
    return ack();
}

export function addMaterial(siteId, material, user) {
    const id = nextId();
    const done = writeStock(buildAddMaterialUpdates({
        siteId, materialId: id, movementId: nextId(), material, user, sv,
    }));
    return { id, done };
}

export function recordMovement(siteId, materialId, material, movement, user) {
    if (window.__nailit.throwOnWrite) {
        throw new Error("boom");
    }
    const id = nextId();
    const done = writeStock(buildMovementUpdates({
        siteId, materialId, movementId: id, material, movement, user, sv,
    }));
    return { id, done };
}

export function updateMaterial(siteId, materialId, fields) {
    if (window.__nailit.throwOnWrite) {
        throw new Error("boom");
    }
    // Like Firebase, an update below a path that does not exist creates it. That is how the
    // old double-click bug left junk nodes behind.
    return writeStock(buildEditMaterialUpdates({ siteId, materialId, fields, sv }));
}

export function removeMaterial(siteId, materialId, material, user) {
    if (window.__nailit.throwOnRemove) {
        throw new Error("remove denied");
    }
    return writeStock(buildRemoveMaterialUpdates({
        siteId, materialId, movementId: nextId(), material, user, sv,
    }));
}

export function restoreMaterial(siteId, materialId, material, user) {
    return writeStock(buildRestoreMaterialUpdates({
        siteId, materialId, movementId: nextId(), material, user, sv,
    }));
}

// Every movement of the site inside [from, to], oldest first, as a report reads them.
export async function fetchMovementsBetween(siteId, from, to) {
    const all = Object.entries(db.movements[siteId] || {}).map(([id, movement]) => ({ id, ...structuredClone(movement) }));
    return sortMovements(all.filter((movement) => movement.at >= from && movement.at <= to));
}

export function subscribeMovements(siteId, { materialId = null, limit = 100 } = {}, onData, onError) {
    return subscribe({ kind: "movements", siteId, materialId, limit, onData, onError });
}

export async function deleteSiteCascade(siteId) {
    if (window.__nailit.failDeleteSite) {
        throw new Error(window.__nailit.failDeleteSite);
    }
    const members = db.members[siteId] || [{ uid: me().uid }];
    const invites = db.siteInvites[siteId] || [];
    const paths = buildSiteDeleteUpdates(siteId, members.map((m) => m.uid), invites.map((i) => i.key));
    writes.push({ op: "multi", paths });
    delete db.sites[siteId];
    delete db.materials[siteId];
    delete db.movements[siteId];
    delete db.members[siteId];
    delete db.siteInvites[siteId];
    notify();
}

// ---- Members and invites -----------------------------------------------------------

export function subscribeMembers(siteId, { withInvites }, onData, onError) {
    return subscribe({ kind: "members", siteId, withInvites, onData, onError });
}

function membersOf(siteId) {
    return (db.members[siteId] ||= [{ uid: me().uid, role: roleOf(siteId), email: me().email }]);
}

export function inviteMember(site, inviter, invite) {
    writes.push({
        op: "invite",
        siteId: site.id,
        siteName: site.name,
        invitedBy: inviter.email,
        key: invite.key,
        role: invite.role,
    });
    (db.siteInvites[site.id] ||= []).push({ key: invite.key, email: emailFromKey(invite.key), role: invite.role });
    notify();
    return ack();
}

export function revokeInvite(siteId, key) {
    writes.push({ op: "revoke", siteId, key });
    db.siteInvites[siteId] = (db.siteInvites[siteId] || []).filter((i) => i.key !== key);
    delete db.invites[siteId]; // if the invitee is the signed-in user
    notify();
    return ack();
}

export function changeRole(siteId, uid, role) {
    writes.push({ op: "role", siteId, uid, role });
    const member = membersOf(siteId).find((m) => m.uid === uid);
    if (member) {
        member.role = role;
    }
    notify();
    return ack();
}

export function removeMember(siteId, uid) {
    writes.push({ op: "removeMember", siteId, uid });
    db.members[siteId] = membersOf(siteId).filter((m) => m.uid !== uid);
    if (uid === me().uid) {
        db.hidden.push(siteId); // the user left: the site drops out of their list
    }
    notify();
    return ack();
}

export function subscribeInvites(key, onData, onError) {
    return subscribe({ kind: "invites", key, onData, onError });
}

export async function acceptInvite(user, siteId, key, role) {
    if (window.__nailit.failAccept) {
        throw new Error(window.__nailit.failAccept);
    }
    writes.push({ op: "accept", siteId, uid: user.uid, key, role });
    delete db.invites[siteId];
    db.hidden = db.hidden.filter((id) => id !== siteId);
    db.roles[siteId] = role;
    notify();
}

export function declineInvite(siteId, key) {
    writes.push({ op: "decline", siteId, key });
    delete db.invites[siteId];
    notify();
    return ack();
}
