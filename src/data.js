// Firebase data layer. dashboard.js talks only to this module, so tests can swap it
// for an in-memory fake and never touch the production database.
//
// Layout (database.rules.json enforces who may touch what):
//   /sites/<siteId>                 { name, location, buildingType, createdAt, ownerUid }
//   /members/<siteId>/<uid>         "owner" | "storekeeper" | "viewer"
//   /userSites/<uid>/<siteId>       the same role, so a user can list their own sites
//   /memberInfo/<siteId>/<uid>      { email }, to show who is who
//   /materials/<siteId>/<materialId>  { name, units, quantity, minLevel?, updatedAt, lastMovementId }
//   /movements/<siteId>/<movementId>  { materialId, materialName, units, delta, type, byUid, byEmail, at, note? }
//   /userInvites/<emailKey>/<siteId>  { role, siteName, invitedBy }, read by the invited person
//   /siteInvites/<siteId>/<emailKey>  role, read by the owner
// Every change that spans several paths is ONE update(), so the rules can check the result as
// a whole and nothing is left half done.
import {
    getDatabase,
    ref,
    onValue,
    push,
    set,
    update,
    remove,
    get,
    query,
    orderByChild,
    equalTo,
    limitToLast,
    increment,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { app } from "./firebase-app.js";
import { buildSiteDeleteUpdates } from "./logic.js";
import {
    buildMovementUpdates,
    buildAddMaterialUpdates,
    buildRemoveMaterialUpdates,
    buildRestoreMaterialUpdates,
    buildEditMaterialUpdates,
    sortMovements,
} from "./movements.js";
import { emailFromKey } from "./roles.js";

const db = getDatabase(app);

// What a server timestamp and an increment are, for the pure builders in movements.js.
const sv = { timestamp: serverTimestamp, increment };

// A key for a movement, made on this device. It sorts by creation time and is unique, so the
// movement and the material that points at it can be written in one update before the server answers.
const newMovementId = (siteId) => push(ref(db, `movements/${siteId}`)).key;

// Each subscribe returns its unsubscribe function. Callers must keep it and call it
// before subscribing again, or listeners pile up.

// The sites this user belongs to: { siteId: { ...site, role } }. The list comes from
// /userSites/<uid>, then each site is read on its own, because the rules do not allow listing
// /sites. onData fires once everything listed has been read, and again on every change.
export function subscribeSites(uid, onData, onError) {
    const siteStops = new Map();   // siteId -> unsubscribe
    const sites = {};              // siteId -> site, once read
    const pending = new Set();     // siteIds listed but not read yet
    let roles = null;              // /userSites/<uid>, null until the first snapshot

    function emit() {
        if (roles === null || pending.size > 0) {
            return;
        }
        const result = {};
        for (const [siteId, role] of Object.entries(roles)) {
            if (sites[siteId]) {
                result[siteId] = { ...sites[siteId], role };
            }
        }
        onData(result);
    }

    function stopSite(siteId) {
        const stop = siteStops.get(siteId);
        if (stop) {
            stop();
        }
        siteStops.delete(siteId);
        pending.delete(siteId);
        delete sites[siteId];
    }

    function watchSite(siteId) {
        pending.add(siteId);
        const stop = onValue(ref(db, `sites/${siteId}`), (snapshot) => {
            pending.delete(siteId);
            sites[siteId] = snapshot.val();
            emit();
        }, () => {
            // A listed site that cannot be read (removed from under us): leave it out, keep going.
            // Firebase cancels a listener that was denied, so forget it and let a later list re-add it.
            siteStops.delete(siteId);
            pending.delete(siteId);
            delete sites[siteId];
            emit();
        });
        siteStops.set(siteId, stop);
    }

    const stopList = onValue(ref(db, `userSites/${uid}`), (snapshot) => {
        roles = snapshot.val() || {};
        for (const siteId of [...siteStops.keys()]) {
            if (!(siteId in roles)) {
                stopSite(siteId);
            }
        }
        for (const siteId of Object.keys(roles)) {
            if (!siteStops.has(siteId)) {
                watchSite(siteId);
            }
        }
        emit();
    }, onError);

    return () => {
        stopList();
        [...siteStops.keys()].forEach(stopSite);
    };
}

export function subscribeMaterials(siteId, onData, onError) {
    return onValue(ref(db, `materials/${siteId}`), (snapshot) => onData(snapshot.val() || {}), onError);
}

// Creates the site and makes `user` its owner in one update. push() makes the key on the
// client, so the id is known immediately. `done` settles when the server acknowledges the write.
export function addSite(site, user) {
    const id = push(ref(db, "sites")).key;
    const done = update(ref(db), {
        [`sites/${id}`]: { ...site, ownerUid: user.uid },
        [`members/${id}/${user.uid}`]: "owner",
        [`userSites/${user.uid}/${id}`]: "owner",
        [`memberInfo/${id}/${user.uid}`]: { email: user.email },
    });
    return { id, done };
}

// Every function below that changes stock is ONE multi-path update that writes the material and
// its movement together. database.rules.json refuses a quantity that no movement explains.
// `user` is { uid, email }, copied into the movement as who did it. `done` settles when the
// server acknowledges the write; the change shows locally at once.

// A new material. With a starting quantity it also gets an "opening" movement.
export function addMaterial(siteId, material, user) {
    const id = push(ref(db, `materials/${siteId}`)).key;
    const done = update(ref(db), buildAddMaterialUpdates({
        siteId, materialId: id, movementId: newMovementId(siteId), material, user, sv,
    }));
    return { id, done };
}

// Received (+) or Used (-). `movement` is { type, delta, note? } from movements.planMovement.
// `material` is the material as the page shows it: its name and units are copied into the history.
export function recordMovement(siteId, materialId, material, movement, user) {
    const id = newMovementId(siteId);
    const done = update(ref(db), buildMovementUpdates({
        siteId, materialId, movementId: id, material, movement, user, sv,
    }));
    return { id, done };
}

// Name, unit or low-stock level. The quantity cannot be set here.
export function updateMaterial(siteId, materialId, fields) {
    return update(ref(db), buildEditMaterialUpdates({ siteId, materialId, fields, sv }));
}

// Deleting takes the remaining stock out in a "removed" movement, so history still adds up.
export function removeMaterial(siteId, materialId, material, user) {
    return update(ref(db), buildRemoveMaterialUpdates({
        siteId, materialId, movementId: newMovementId(siteId), material, user, sv,
    }));
}

// Undo for a delete: the material comes back at its original key with its old quantity, and an
// "opening" movement says so, so nothing that pointed at the id loses its target.
export function restoreMaterial(siteId, materialId, material, user) {
    return update(ref(db), buildRestoreMaterialUpdates({
        siteId, materialId, movementId: newMovementId(siteId), material, user, sv,
    }));
}

// The latest `limit` movements, oldest first, each with its id. With materialId: that material's
// history. Without: the whole site, for the activity feed. Both lists are indexed in the rules.
export function subscribeMovements(siteId, { materialId = null, limit = 100 } = {}, onData, onError) {
    const base = ref(db, `movements/${siteId}`);
    const source = materialId
        ? query(base, orderByChild("materialId"), equalTo(materialId), limitToLast(limit))
        : query(base, orderByChild("at"), limitToLast(limit));
    return onValue(source, (snapshot) => {
        const list = [];
        snapshot.forEach((child) => {
            list.push({ id: child.key, ...child.val() }); // no return: a truthy return would stop forEach
        });
        onData(sortMovements(list));
    }, onError);
}

export const OFFLINE_MESSAGE = "Could not reach the database. Check your connection and try again.";

// get() waits for the server when the data is not cached, so with no signal it can wait
// forever. Give up after timeoutMs and write nothing, rather than hang silently.
function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(OFFLINE_MESSAGE)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Read who is in the site and which invites are pending, then one multi-path update that removes
// everything. If somebody joins between the read and the update, the rules refuse the whole
// update (a membership would be left behind), nothing is deleted, and the owner can try again.
export async function deleteSiteCascade(siteId, { timeoutMs = 10000 } = {}) {
    const [members, invites] = await withTimeout(Promise.all([
        get(ref(db, `members/${siteId}`)),
        get(ref(db, `siteInvites/${siteId}`)),
    ]), timeoutMs);
    return update(ref(db), buildSiteDeleteUpdates(
        siteId,
        Object.keys(members.val() || {}),
        Object.keys(invites.val() || {}),
    ));
}

// ---- Members and invites -------------------------------------------------------------

// Members of a site, with their emails, and (owners only) the pending invites:
// { members: [{ uid, role, email }], invites: [{ key, email, role }] }
export function subscribeMembers(siteId, { withInvites }, onData, onError) {
    const sources = [
        ["members", `members/${siteId}`],
        ["info", `memberInfo/${siteId}`],
    ];
    if (withInvites) {
        sources.push(["invites", `siteInvites/${siteId}`]);
    }
    const values = {};
    const stops = sources.map(([name, path]) => onValue(ref(db, path), (snapshot) => {
        values[name] = snapshot.val() || {};
        if (sources.every(([n]) => n in values)) {
            onData({
                members: Object.entries(values.members).map(([uid, role]) => ({
                    uid,
                    role,
                    email: (values.info[uid] && values.info[uid].email) || null,
                })),
                invites: Object.entries(values.invites || {}).map(([key, role]) => ({
                    key,
                    email: emailFromKey(key),
                    role,
                })),
            });
        }
    }, onError));
    return () => stops.forEach((stop) => stop());
}

// `invite` is the validated { key, role } from roles.validateInvite. The invitee reads their copy
// (/userInvites), the owner lists theirs (/siteInvites).
export function inviteMember(site, inviter, invite) {
    return update(ref(db), {
        [`userInvites/${invite.key}/${site.id}`]: { role: invite.role, siteName: site.name, invitedBy: inviter.email },
        [`siteInvites/${site.id}/${invite.key}`]: invite.role,
    });
}

export function revokeInvite(siteId, key) {
    return update(ref(db), {
        [`userInvites/${key}/${siteId}`]: null,
        [`siteInvites/${siteId}/${key}`]: null,
    });
}

export function changeRole(siteId, uid, role) {
    return update(ref(db), {
        [`members/${siteId}/${uid}`]: role,
        [`userSites/${uid}/${siteId}`]: role,
    });
}

// Removing a member and a member leaving are the same three deletes.
export function removeMember(siteId, uid) {
    return update(ref(db), {
        [`members/${siteId}/${uid}`]: null,
        [`userSites/${uid}/${siteId}`]: null,
        [`memberInfo/${siteId}/${uid}`]: null,
    });
}

// The invitations waiting for this email: { siteId: { role, siteName, invitedBy } }.
export function subscribeInvites(key, onData, onError) {
    return onValue(ref(db, `userInvites/${key}`), (snapshot) => onData(snapshot.val() || {}), onError);
}

// Join: membership, site list and the used-up invite in one update. The member info is a second,
// lesser write (the rules need the membership to exist first); if it fails the member list shows
// the uid instead of the email, which is not worth failing the join over.
export async function acceptInvite(user, siteId, key, role) {
    await update(ref(db), {
        [`members/${siteId}/${user.uid}`]: role,
        [`userSites/${user.uid}/${siteId}`]: role,
        [`userInvites/${key}/${siteId}`]: null,
        [`siteInvites/${siteId}/${key}`]: null,
    });
    await set(ref(db, `memberInfo/${siteId}/${user.uid}`), { email: user.email }).catch(() => {});
}

export function declineInvite(siteId, key) {
    return revokeInvite(siteId, key);
}
