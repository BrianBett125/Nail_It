import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseAmount,
    planMovement,
    normalizeNote,
    formatQuantity,
    formatDelta,
    buildMovementUpdates,
    buildAddMaterialUpdates,
    buildRemoveMaterialUpdates,
    buildRestoreMaterialUpdates,
    buildEditMaterialUpdates,
    sortMovements,
    movementsFromObject,
    withRunningBalance,
    reconciles,
    whoLabel,
    describeMovement,
    timeAgo,
    formatDate,
    formatDateTime,
    lastUpdatedLabel,
    AMOUNT_MESSAGE,
    DECIMALS_MESSAGE,
    NOTE_MESSAGE,
    ACTION_MESSAGE,
} from "../../src/movements.js";

const TS = { ".sv": "timestamp" };
const sv = { timestamp: () => TS, increment: (n) => ({ ".sv": { increment: n } }) };
const USER = { uid: "u1", email: "brian@example.com" };
const CEMENT = { name: "Cement", units: "bags", quantity: 50 };

// ---- parseAmount ----------------------------------------------------------------------

test("parseAmount accepts positive numbers as typed on a phone", () => {
    assert.equal(parseAmount("20"), 20);
    assert.equal(parseAmount(" 20 "), 20);
    assert.equal(parseAmount("0.5"), 0.5);
    assert.equal(parseAmount(".5"), 0.5);
    assert.equal(parseAmount("5."), 5);
    assert.equal(parseAmount("+3"), 3);
    assert.equal(parseAmount(7), 7);
});

test("parseAmount rejects blank, zero, negative, text, exponent, NaN and absurd values", () => {
    for (const bad of ["", "   ", "0", "0.0", "-5", "abc", "1e3", "1,5", "5 bags", "NaN", "Infinity", "--1", "1.2.3",
        null, undefined, NaN, Infinity, -1, 0, {}, [], true, "1000000001", 1_000_000_001]) {
        assert.equal(parseAmount(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
});

test("parseAmount accepts the largest allowed amount", () => {
    assert.equal(parseAmount("1000000000"), 1_000_000_000);
});

// ---- planMovement ---------------------------------------------------------------------

test("planMovement: Received is a positive delta, Used is a negative one", () => {
    assert.deepEqual(planMovement({ action: "received", amount: "20" }, CEMENT), { ok: true, value: { type: "received", delta: 20 } });
    assert.deepEqual(planMovement({ action: "used", amount: "20" }, CEMENT), { ok: true, value: { type: "used", delta: -20 } });
});

test("planMovement carries a trimmed note and leaves it out when empty", () => {
    const withNote = planMovement({ action: "used", amount: "2", note: "  Slab   pour,\n level 2 " }, CEMENT);
    assert.equal(withNote.value.note, "Slab pour, level 2");
    const without = planMovement({ action: "used", amount: "2", note: "   " }, CEMENT);
    assert.equal("note" in without.value, false);
});

test("planMovement blocks Used above the stock, with the numbers in the message", () => {
    const result = planMovement({ action: "used", amount: "51" }, CEMENT);
    assert.equal(result.ok, false);
    assert.equal(result.error, "Only 50 bags in stock. You cannot use 51.");
});

test("planMovement lets you use exactly what is there, and receive without limit", () => {
    assert.equal(planMovement({ action: "used", amount: "50" }, CEMENT).ok, true);
    assert.equal(planMovement({ action: "received", amount: "999999" }, CEMENT).ok, true);
});

test("planMovement: a material with no stock cannot be used, even for 0.001", () => {
    const empty = { name: "Sand", units: "tonnes", quantity: 0 };
    assert.equal(planMovement({ action: "used", amount: "0.001" }, empty).ok, false);
    assert.equal(planMovement({ action: "used", amount: "1" }, { ...empty, quantity: undefined }).ok, false);
});

test("planMovement: using what the page shows as the whole stock takes exactly all of it, no float dust left", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point. Using "0.3" must leave 0, not 5.5e-17 that shows
    // as "0" but can never be used up.
    const dusty = { name: "Paint", units: "litres", quantity: 0.1 + 0.2 };
    const result = planMovement({ action: "used", amount: "0.3" }, dusty);
    assert.equal(result.ok, true);
    assert.equal(dusty.quantity + result.value.delta, 0);
    // A real remainder is left alone.
    const partial = planMovement({ action: "used", amount: "0.25" }, dusty);
    assert.equal(partial.value.delta, -0.25);
    // And a typed amount that is genuinely more than the stock is still refused.
    assert.equal(planMovement({ action: "used", amount: "0.301" }, dusty).ok, false);
});

test("planMovement rejects a bad amount, too many decimals, a long note and an unknown action", () => {
    assert.deepEqual(planMovement({ action: "used", amount: "" }, CEMENT), { ok: false, error: AMOUNT_MESSAGE });
    assert.deepEqual(planMovement({ action: "used", amount: "-3" }, CEMENT), { ok: false, error: AMOUNT_MESSAGE });
    assert.deepEqual(planMovement({ action: "received", amount: "1.2345" }, CEMENT), { ok: false, error: DECIMALS_MESSAGE });
    assert.equal(planMovement({ action: "received", amount: "1.234" }, CEMENT).ok, true);
    assert.deepEqual(planMovement({ action: "received", amount: "1", note: "x".repeat(201) }, CEMENT), { ok: false, error: NOTE_MESSAGE });
    assert.equal(planMovement({ action: "received", amount: "1", note: "x".repeat(200) }, CEMENT).ok, true);
    assert.deepEqual(planMovement({ action: "removed", amount: "1" }, CEMENT), { ok: false, error: ACTION_MESSAGE });
    assert.deepEqual(planMovement({ amount: "1" }, CEMENT), { ok: false, error: ACTION_MESSAGE });
});

test("normalizeNote collapses whitespace and tolerates non-strings", () => {
    assert.equal(normalizeNote("  a \n\t b  "), "a b");
    assert.equal(normalizeNote(undefined), "");
    assert.equal(normalizeNote(5), "");
});

// ---- formatting -----------------------------------------------------------------------

test("formatQuantity hides float noise and trailing zeros", () => {
    assert.equal(formatQuantity(0.1 + 0.2), "0.3");
    assert.equal(formatQuantity(5), "5");
    assert.equal(formatQuantity(5.5), "5.5");
    assert.equal(formatQuantity(1234567.891), "1234567.891");
    assert.equal(formatQuantity(1e9), "1000000000");
    assert.equal(formatQuantity(0.0004), "0");
    assert.equal(formatQuantity(undefined), "0");
    assert.equal(formatQuantity(NaN), "0");
});

test("formatDelta shows the sign", () => {
    assert.equal(formatDelta(20), "+20");
    assert.equal(formatDelta(-0.5), "-0.5");
    assert.equal(formatDelta(0), "0");
});

// ---- the writes -----------------------------------------------------------------------

test("buildMovementUpdates: movement, increment, pointer and time, in one object", () => {
    const updates = buildMovementUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: CEMENT, user: USER, sv,
        movement: { type: "used", delta: -20, note: "Slab" },
    });
    assert.deepEqual(updates, {
        "movements/s1/mv1": {
            materialId: "m1", materialName: "Cement", units: "bags", delta: -20, type: "used",
            byUid: "u1", byEmail: "brian@example.com", at: TS, note: "Slab",
        },
        "materials/s1/m1/quantity": { ".sv": { increment: -20 } },
        "materials/s1/m1/lastMovementId": "mv1",
        "materials/s1/m1/updatedAt": TS,
    });
});

test("buildMovementUpdates: no note key when there is no note (the rules reject an empty one)", () => {
    const updates = buildMovementUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: CEMENT, user: USER, sv,
        movement: { type: "received", delta: 3 },
    });
    assert.equal("note" in updates["movements/s1/mv1"], false);
});

test("buildAddMaterialUpdates with stock: material at zero plus its opening movement, pointing at each other", () => {
    const updates = buildAddMaterialUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: { ...CEMENT, minLevel: 10 }, user: USER, sv,
    });
    assert.deepEqual(updates["materials/s1/m1"], {
        name: "Cement", units: "bags", minLevel: 10, quantity: 50, updatedAt: TS, lastMovementId: "mv1",
    });
    assert.equal(updates["movements/s1/mv1"].type, "opening");
    assert.equal(updates["movements/s1/mv1"].delta, 50);
    assert.equal(updates["movements/s1/mv1"].materialId, "m1");
    assert.deepEqual(Object.keys(updates).sort(), ["materials/s1/m1", "movements/s1/mv1"]);
});

test("buildAddMaterialUpdates with no stock writes no movement and no pointer", () => {
    const updates = buildAddMaterialUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: { ...CEMENT, quantity: 0 }, user: USER, sv,
    });
    assert.deepEqual(updates, { "materials/s1/m1": { name: "Cement", units: "bags", quantity: 0, updatedAt: TS } });
});

test("buildRemoveMaterialUpdates takes the remaining stock out, and an empty material needs no movement", () => {
    const withStock = buildRemoveMaterialUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: CEMENT, user: USER, sv,
    });
    assert.equal(withStock["materials/s1/m1"], null);
    assert.equal(withStock["movements/s1/mv1"].type, "removed");
    assert.equal(withStock["movements/s1/mv1"].delta, -50);

    const empty = buildRemoveMaterialUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", material: { ...CEMENT, quantity: 0 }, user: USER, sv,
    });
    assert.deepEqual(empty, { "materials/s1/m1": null });
});

test("buildRestoreMaterialUpdates puts the material back with an opening movement and drops legacy fields", () => {
    const updates = buildRestoreMaterialUpdates({
        siteId: "s1", materialId: "m1", movementId: "mv1", user: USER, sv,
        material: { ...CEMENT, minLevel: 4, lastUpdated: "2024-05-03", siteId: "old", updatedAt: 5, lastMovementId: "x" },
    });
    assert.deepEqual(updates["materials/s1/m1"], {
        name: "Cement", units: "bags", quantity: 50, minLevel: 4, updatedAt: TS, lastMovementId: "mv1",
    });
    assert.equal(updates["movements/s1/mv1"].note, "Restored after delete");
    assert.equal(updates["movements/s1/mv1"].type, "opening");
});

test("buildEditMaterialUpdates sets the fields and the time, and refuses to touch the quantity", () => {
    assert.deepEqual(buildEditMaterialUpdates({ siteId: "s1", materialId: "m1", fields: { name: "Cement 42.5", minLevel: null }, sv }), {
        "materials/s1/m1/updatedAt": TS,
        "materials/s1/m1/name": "Cement 42.5",
        "materials/s1/m1/minLevel": null,
    });
    assert.throws(() => buildEditMaterialUpdates({ siteId: "s1", materialId: "m1", fields: { quantity: 3 }, sv }), /movements/);
    assert.throws(() => buildEditMaterialUpdates({ siteId: "s1", materialId: "m1", fields: { lastMovementId: "x" }, sv }), /movements/);
});

// ---- history --------------------------------------------------------------------------

const M = (id, at, delta, extra = {}) => ({ id, at, delta, type: delta > 0 ? "received" : "used", ...extra });

test("sortMovements orders by time then id, and does not change its input", () => {
    const input = [M("b", 200, 1), M("c", 100, 1), M("a", 200, 1)];
    assert.deepEqual(sortMovements(input).map((m) => m.id), ["c", "a", "b"]);
    assert.deepEqual(input.map((m) => m.id), ["b", "c", "a"]);
});

test("movementsFromObject carries the ids and tolerates null", () => {
    assert.deepEqual(movementsFromObject({ x: { at: 2, delta: 1 }, y: { at: 1, delta: 2 } }), [
        { id: "y", at: 1, delta: 2 }, { id: "x", at: 2, delta: 1 },
    ]);
    assert.deepEqual(movementsFromObject(null), []);
});

test("withRunningBalance: each line shows the stock after it, ending at the quantity now", () => {
    const { rows, before } = withRunningBalance(
        [M("1", 1, 50, { type: "opening" }), M("2", 2, -20), M("3", 3, 5)], 35,
    );
    assert.equal(before, 0);
    assert.deepEqual(rows.map((r) => r.balance), [50, 30, 35]);
});

test("withRunningBalance: a material with stock from before movements shows the gap as 'before'", () => {
    const { rows, before } = withRunningBalance([M("1", 1, -2), M("2", 2, 10)], 13);
    assert.equal(before, 5);
    assert.deepEqual(rows.map((r) => r.balance), [3, 13]);
});

test("withRunningBalance is exact on decimals", () => {
    const { rows, before } = withRunningBalance([M("1", 1, 0.1), M("2", 2, 0.2)], 0.3);
    assert.equal(before, 0);
    assert.equal(rows[1].balance, 0.3);
});

test("withRunningBalance with no movements: everything is 'before'", () => {
    assert.deepEqual(withRunningBalance([], 7), { rows: [], before: 7 });
});

test("reconciles is true only when the movements explain the quantity exactly", () => {
    assert.equal(reconciles([M("1", 1, 5, { type: "opening" }), M("2", 2, -2)], 3), true);
    assert.equal(reconciles([M("1", 1, 5, { type: "opening" })], 3), false);
    assert.equal(reconciles([], 0), true);
    assert.equal(reconciles([M("1", 1, 0.1), M("2", 2, 0.2)], 0.3), true);
});

// ---- wording --------------------------------------------------------------------------

const MV = { byUid: "u1", byEmail: "brian@example.com", units: "bags", materialName: "Cement", delta: -20, type: "used" };

test("whoLabel prefers the member list's email, then the movement's, then 'Someone'", () => {
    assert.equal(whoLabel(MV, { u1: { email: "boss@example.com" } }), "boss");
    assert.equal(whoLabel(MV, {}), "brian");
    assert.equal(whoLabel({ ...MV, byEmail: undefined }, {}), "Someone");
});

test("describeMovement reads like the example in the plan", () => {
    assert.equal(describeMovement(MV), "brian used 20 bags of Cement");
    assert.equal(describeMovement({ ...MV, type: "received", delta: 5 }), "brian received 5 bags of Cement");
    assert.equal(describeMovement({ ...MV, type: "opening", delta: 50 }), "brian added 50 bags of Cement");
    assert.equal(describeMovement({ ...MV, type: "removed", delta: -30 }), "brian deleted Cement (30 bags left)");
});

test("describeMovement is text only: markup in a name stays as text", () => {
    const text = describeMovement({ ...MV, materialName: "<img src=x onerror=alert(1)>" });
    assert.equal(text, "brian used 20 bags of <img src=x onerror=alert(1)>");
});

test("timeAgo", () => {
    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    const ago = (ms) => timeAgo(now - ms, now);
    assert.equal(ago(5_000), "just now");
    assert.equal(ago(-5_000), "just now", "a clock a little ahead of the server");
    assert.equal(ago(5 * 60_000), "5 min ago");
    assert.equal(ago(2 * 3_600_000 + 1), "2h ago");
    assert.equal(ago(26 * 3_600_000), "yesterday");
    assert.equal(ago(3 * 86_400_000), "3 days ago");
    assert.match(ago(30 * 86_400_000), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(timeAgo(undefined, now), "just now");
});

test("formatDate and formatDateTime use the local calendar", () => {
    const at = new Date(2026, 9, 16, 7, 5).getTime();
    assert.equal(formatDate(at), "2026-10-16");
    assert.equal(formatDateTime(at), "2026-10-16 07:05");
});

test("lastUpdatedLabel uses the server time, else the date typed before Phase 3", () => {
    const at = new Date(2026, 9, 16, 12).getTime();
    assert.equal(lastUpdatedLabel({ updatedAt: at, lastUpdated: "2024-01-01" }), "2026-10-16");
    assert.equal(lastUpdatedLabel({ lastUpdated: "2024-01-01" }), "2024-01-01");
    assert.equal(lastUpdatedLabel({}), "");
    assert.equal(lastUpdatedLabel(undefined), "");
});
