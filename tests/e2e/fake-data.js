// In-memory stand-in for src/data.js, served to the page by the E2E tests.
// Same exports as the real module, so dashboard.js cannot tell the difference.
// It records every write in window.__nailit.writes so tests can assert on exactly
// what would have gone to Firebase. What the real module sends to Firebase is checked by
// tests/unit/data.test.js, and who may do what by tests/rules/.
//
// Seed (window.__seed), all optional:
//   sites       { siteId: { name, location, buildingType, ... } }
//   materials   { materialId: { name, quantity, units, lastUpdated, siteId } }  (flat; filed under its site)
//   roles       { siteId: "owner" | "storekeeper" | "viewer" }  the signed-in user's role, default "owner"
//   members     { siteId: [{ uid, role, email }] }              default: just the signed-in user
//   siteInvites { siteId: [{ key, email, role }] }              pending invites, as the owner sees them
//   invites     { siteId: { role, siteName, invitedBy } }       invitations waiting for the signed-in user
//   hiddenSites [siteId]                                        exist, but the user is not in them yet (invited)
import { buildSiteDeleteUpdates } from "/src/logic.js";
import { emailFromKey } from "/src/roles.js";

const seed = window.__seed || {};
const me = () => (window.__auth && window.__auth.user) || { uid: "u1", email: "foreman@example.com" };

function fileMaterials(flat) {
    const bySite = {};
    for (const [id, material] of Object.entries(flat || {})) {
        const { siteId, ...rest } = structuredClone(material);
        (bySite[siteId] ||= {})[id] = rest;
    }
    return bySite;
}

const db = {
    sites: structuredClone(seed.sites || {}),
    materials: fileMaterials(seed.materials),
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
        notify();
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

export function addMaterial(siteId, material) {
    const id = nextId();
    writes.push({ op: "push", path: `materials/${siteId}`, id, value: material });
    (db.materials[siteId] ||= {})[id] = material;
    notify();
    return { id, done: ack() };
}

export function updateMaterial(siteId, materialId, fields) {
    if (window.__nailit.throwOnWrite) {
        throw new Error("boom");
    }
    writes.push({ op: "update", path: `materials/${siteId}/${materialId}`, value: fields });
    // Like Firebase, update() on a path that does not exist creates it. That is how the
    // old double-click bug left junk nodes behind.
    const materials = (db.materials[siteId] ||= {});
    materials[materialId] = { ...(materials[materialId] || {}), ...fields };
    notify();
    // A slow or offline server: the write is queued but not acknowledged yet.
    return ack();
}

export function restoreMaterial(siteId, materialId, material) {
    writes.push({ op: "set", path: `materials/${siteId}/${materialId}`, value: material });
    (db.materials[siteId] ||= {})[materialId] = structuredClone(material);
    notify();
    return ack();
}

export function removeMaterial(siteId, materialId) {
    if (window.__nailit.throwOnRemove) {
        throw new Error("remove denied");
    }
    writes.push({ op: "remove", path: `materials/${siteId}/${materialId}` });
    delete (db.materials[siteId] || {})[materialId];
    notify();
    return ack();
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
