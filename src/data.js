// Firebase data layer. dashboard.js talks only to this module, so tests can swap it
// for an in-memory fake and never touch the production database.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getDatabase,
    ref,
    onValue,
    push,
    set,
    update,
    remove,
    query,
    orderByChild,
    equalTo,
    get,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { buildSiteDeleteUpdates } from "./logic.js";

const appSettings = {
    databaseURL: "https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

const app = initializeApp(appSettings);
const db = getDatabase(app);

const sitesRef = ref(db, "sites");
const materialsRef = ref(db, "materials");

// Each subscribe returns its unsubscribe function. Callers must keep it and call it
// before subscribing again, or listeners pile up.
export function subscribeSites(onData, onError) {
    return onValue(sitesRef, (snapshot) => onData(snapshot.val() || {}), onError);
}

export function subscribeMaterials(siteId, onData, onError) {
    const siteMaterials = query(materialsRef, orderByChild("siteId"), equalTo(siteId));
    return onValue(siteMaterials, (snapshot) => onData(snapshot.val() || {}), onError);
}

// push() makes the key on the client, so the id is known immediately. `done` settles
// when the server acknowledges the write.
export function addSite(site) {
    const newRef = push(sitesRef, site);
    return { id: newRef.key, done: newRef };
}

export function addMaterial(material) {
    const newRef = push(materialsRef, material);
    return { id: newRef.key, done: newRef };
}

export function updateMaterial(materialId, fields) {
    return update(ref(db, `materials/${materialId}`), fields);
}

export function removeMaterial(materialId) {
    return remove(ref(db, `materials/${materialId}`));
}

// Undo for a delete: write the material back at its original key, so nothing that
// pointed at the id (Phase 3 movements) loses its target.
export function restoreMaterial(materialId, material) {
    return set(ref(db, `materials/${materialId}`), material);
}

export const OFFLINE_MESSAGE = "Could not reach the database. Check your connection and try again.";

// get() waits for the server when the site's materials are not cached, so with no signal it
// can wait forever. Give up after timeoutMs and write nothing, rather than hang silently.
function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(OFFLINE_MESSAGE)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Read, then one multi-path update. A material added to this site between the two calls
// is not in the update and stays behind as an orphan. Closing that gap needs database
// rules (Plan.md Phase 2), not client code.
export async function deleteSiteCascade(siteId, { timeoutMs = 10000 } = {}) {
    const siteMaterials = query(materialsRef, orderByChild("siteId"), equalTo(siteId));
    const snapshot = await withTimeout(get(siteMaterials), timeoutMs);
    return update(ref(db), buildSiteDeleteUpdates(siteId, snapshot.val()));
}
