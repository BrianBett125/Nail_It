// Stock movements. Pure: no DOM, no Firebase, so the rules of stock run in Node tests.
//
// The idea: nobody types a quantity. Stock changes only by recording what moved, and the
// quantity on a material is always the sum of its movements. database.rules.json refuses any
// write that would break that; the builders below produce exactly the writes the rules accept.
//
// A movement lives at /movements/<siteId>/<movementId>:
//   { materialId, materialName, units, delta, type, byUid, byEmail, at, note? }
//   delta   signed: + when stock comes in, - when it goes out
//   type    "opening" (a material is first added, or restored by Undo)
//           "received" (+), "used" (-), "removed" (the material was deleted, takes the rest out)
//   at      the server's clock, so a phone with a wrong date cannot write wrong history
// materialName and units are copied in, so history still reads right after the material is
// renamed or deleted.

export const MOVEMENT_TYPES = ["opening", "received", "used", "removed"];
export const TYPE_LABELS = {
    opening: "Opening balance",
    received: "Received",
    used: "Used",
    removed: "Removed",
};
// The two things a foreman can record. The other types are written by the app itself.
export const ACTIONS = ["received", "used"];

export const MAX_QUANTITY = 1_000_000_000;
export const MAX_NOTE_LENGTH = 200;
export const MAX_DECIMALS = 3;
// Differences smaller than this are float noise, not stock (the smallest amount is 0.001).
const DUST = 1e-9;

export const AMOUNT_MESSAGE = "Enter an amount greater than zero";
export const DECIMALS_MESSAGE = `Use at most ${MAX_DECIMALS} decimal places`;
export const NOTE_MESSAGE = `A note can be at most ${MAX_NOTE_LENGTH} characters`;
export const ACTION_MESSAGE = "Choose Received or Used";

// Numbers as people read them: no float noise (0.1 + 0.2), no trailing zeros, no exponent.
export function formatQuantity(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "0";
    }
    const rounded = Math.round(value * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS;
    return rounded.toLocaleString("en-US", { maximumFractionDigits: MAX_DECIMALS, useGrouping: false });
}

// "+20" / "-5", for a column of movements.
export function formatDelta(delta) {
    return `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${formatQuantity(Math.abs(delta))}`;
}

function decimalPlaces(raw) {
    const match = /^[+-]?\d*(?:\.(\d*))?$/.exec(raw.trim());
    return match && match[1] ? match[1].length : 0;
}

// Typed amount to a number greater than zero, or null. Number("") is 0 and Number("1e3") is
// 1000: the first is a blank field, the second is not something to type on a phone.
export function parseAmount(raw) {
    let value;
    if (typeof raw === "number") {
        value = raw;
    } else if (typeof raw === "string" && /^[+]?(\d+\.?\d*|\.\d+)$/.test(raw.trim())) {
        value = Number(raw);
    } else {
        return null;
    }
    return Number.isFinite(value) && value > 0 && value <= MAX_QUANTITY ? value : null;
}

export function normalizeNote(raw) {
    return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
}

// What the foreman typed in the Received / Used dialog, checked against the material as it is
// now. On success: { type, delta, note? }, ready for buildMovementUpdates.
export function planMovement({ action, amount, note }, material) {
    if (!ACTIONS.includes(action)) {
        return { ok: false, error: ACTION_MESSAGE };
    }
    const value = parseAmount(amount);
    if (value === null) {
        return { ok: false, error: AMOUNT_MESSAGE };
    }
    if (typeof amount === "string" && decimalPlaces(amount) > MAX_DECIMALS) {
        return { ok: false, error: DECIMALS_MESSAGE };
    }
    const cleanNote = normalizeNote(note);
    if (cleanNote.length > MAX_NOTE_LENGTH) {
        return { ok: false, error: NOTE_MESSAGE };
    }
    const inStock = material && typeof material.quantity === "number" ? material.quantity : 0;
    // The page shows the stock to three decimals. An amount that equals what is shown IS all the
    // stock, even when the stored number carries float noise (0.1 + 0.2 = 0.30000000000000004).
    const takesAll = action === "used" && Math.abs(inStock - value) < DUST;
    if (action === "used" && value > inStock && !takesAll) {
        return {
            ok: false,
            error: `Only ${formatQuantity(inStock)} ${material.units} in stock. You cannot use ${formatQuantity(value)}.`,
        };
    }
    const delta = action === "received" ? value : -(takesAll ? inStock : value);
    const movement = { type: action, delta };
    if (cleanNote) {
        movement.note = cleanNote;
    }
    return { ok: true, value: movement };
}

// ---- the writes -------------------------------------------------------------------------
// Each builder returns ONE multi-path update, applied with update(ref(db), ...). The material and
// its movement are written together, so they cannot disagree. `sv` is how the caller says what a
// server timestamp and an increment look like ({ timestamp: serverTimestamp, increment }), which
// keeps this file free of the Firebase SDK.

function movementRecord({ materialId, material, user, sv }, { type, delta, note }) {
    const record = {
        materialId,
        materialName: material.name,
        units: material.units,
        delta,
        type,
        byUid: user.uid,
        byEmail: user.email,
        at: sv.timestamp(),
    };
    if (note) {
        record.note = note;
    }
    return record;
}

// Received or Used on an existing material. The quantity is an increment, not a number the
// phone computed, so two people recording at the same moment (or offline) both count.
export function buildMovementUpdates({ siteId, materialId, movementId, material, movement, user, sv }) {
    return {
        [`movements/${siteId}/${movementId}`]: movementRecord({ materialId, material, user, sv }, movement),
        [`materials/${siteId}/${materialId}/quantity`]: sv.increment(movement.delta),
        [`materials/${siteId}/${materialId}/lastMovementId`]: movementId,
        [`materials/${siteId}/${materialId}/updatedAt`]: sv.timestamp(),
    };
}

// A new material. With a starting quantity it gets an "opening" movement, so history starts
// complete. `material` is { name, units, quantity, minLevel? }.
export function buildAddMaterialUpdates({ siteId, materialId, movementId, material, user, sv, note }) {
    const { quantity, ...rest } = material;
    const stored = { ...rest, quantity, updatedAt: sv.timestamp() };
    const updates = { [`materials/${siteId}/${materialId}`]: stored };
    if (quantity > 0) {
        stored.lastMovementId = movementId;
        updates[`movements/${siteId}/${movementId}`] = movementRecord(
            { materialId, material, user, sv },
            { type: "opening", delta: quantity, note },
        );
    }
    return updates;
}

// Deleting a material takes its remaining stock out in a "removed" movement, so the history of
// the site still adds up and Undo has something to undo.
export function buildRemoveMaterialUpdates({ siteId, materialId, movementId, material, user, sv }) {
    const updates = { [`materials/${siteId}/${materialId}`]: null };
    if (material.quantity > 0) {
        updates[`movements/${siteId}/${movementId}`] = movementRecord(
            { materialId, material, user, sv },
            { type: "removed", delta: -material.quantity },
        );
    }
    return updates;
}

// Undo of a delete: the material comes back at its old key with its old quantity, with an
// "opening" movement that says so.
export function buildRestoreMaterialUpdates({ siteId, materialId, movementId, material, user, sv }) {
    const { name, units, quantity, minLevel } = material;
    const restored = { name, units, quantity };
    if (typeof minLevel === "number") {
        restored.minLevel = minLevel;
    }
    return buildAddMaterialUpdates({
        siteId, materialId, movementId, material: restored, user, sv, note: "Restored after delete",
    });
}

// Editing name, unit or low-stock level never touches the quantity.
export function buildEditMaterialUpdates({ siteId, materialId, fields, sv }) {
    const updates = { [`materials/${siteId}/${materialId}/updatedAt`]: sv.timestamp() };
    for (const [key, value] of Object.entries(fields)) {
        if (key === "quantity" || key === "lastMovementId") {
            throw new Error("Quantity changes go through movements");
        }
        updates[`materials/${siteId}/${materialId}/${key}`] = value;
    }
    return updates;
}

// ---- reading history --------------------------------------------------------------------

// Oldest first. `at` is the server's time; ids (push ids) break ties in the order they were made.
export function sortMovements(list) {
    return [...list].sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// { id: movement } as the database returns it, to an array that carries each id.
export function movementsFromObject(object) {
    return sortMovements(Object.entries(object || {}).map(([id, movement]) => ({ id, ...movement })));
}

// Each movement with the balance right after it. The balance is worked back from the quantity
// the material has now, so the last line always matches the table even for a material whose
// first stock was entered before movements existed (the "Before history" line shows the gap).
// Returns { rows: [...movement, balance], before } oldest first; `before` is the stock that
// no movement explains (0 for any material created under the movement rules).
export function withRunningBalance(movements, currentQuantity) {
    const sorted = sortMovements(movements);
    const total = sorted.reduce((sum, m) => sum + m.delta, 0);
    const before = roundOff(currentQuantity - total);
    let balance = before;
    const rows = sorted.map((movement) => {
        balance = roundOff(balance + movement.delta);
        return { ...movement, balance };
    });
    return { rows, before };
}

// True when the movements explain the quantity exactly: the Phase 3 promise.
export function reconciles(movements, quantity) {
    return withRunningBalance(movements, quantity).before === 0;
}

// Rounds away float noise (0.1 + 0.2). `|| 0` turns -0 into 0, which deepEqual and === both care about.
function roundOff(value) {
    return (Math.round(value * 10 ** (MAX_DECIMALS + 3)) / 10 ** (MAX_DECIMALS + 3)) || 0;
}

// "Brian used 20 bags of cement" needs a name: the part of the email before the @.
export function whoLabel(movement, members = {}) {
    const email = (members[movement.byUid] && members[movement.byUid].email) || movement.byEmail || "";
    return email.split("@")[0] || "Someone";
}

// One line for the activity feed. Text only; the page puts it in the DOM with textContent.
export function describeMovement(movement, members = {}) {
    const who = whoLabel(movement, members);
    const quantity = `${formatQuantity(Math.abs(movement.delta))} ${movement.units}`;
    const amount = `${quantity} of ${movement.materialName}`;
    switch (movement.type) {
        case "received": return `${who} received ${amount}`;
        case "used": return `${who} used ${amount}`;
        case "opening": return `${who} added ${amount}`;
        case "removed": return `${who} deleted ${movement.materialName} (${quantity} left)`;
        default: return `${who} changed ${movement.materialName}`;
    }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "just now", "5 min ago", "2h ago", "3 days ago", then a date. `now` is a parameter for tests.
export function timeAgo(at, now = Date.now()) {
    const age = now - at;
    if (!Number.isFinite(age) || age < 0 || age < MINUTE) {
        return "just now";
    }
    if (age < HOUR) {
        return `${Math.floor(age / MINUTE)} min ago`;
    }
    if (age < DAY) {
        return `${Math.floor(age / HOUR)}h ago`;
    }
    if (age < 7 * DAY) {
        const days = Math.floor(age / DAY);
        return days === 1 ? "yesterday" : `${days} days ago`;
    }
    return formatDate(at);
}

// YYYY-MM-DD in the viewer's local time.
export function formatDate(at) {
    const date = new Date(at);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// YYYY-MM-DD HH:MM, for a history line.
export function formatDateTime(at) {
    const date = new Date(at);
    const pad = (n) => String(n).padStart(2, "0");
    return `${formatDate(at)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A material's "last updated": the server time when there is one, else the date that was typed
// before Phase 3 (older records only have that).
export function lastUpdatedLabel(material) {
    if (material && typeof material.updatedAt === "number") {
        return formatDate(material.updatedAt);
    }
    return (material && material.lastUpdated) || "";
}
