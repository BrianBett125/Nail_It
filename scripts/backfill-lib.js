// One-time backfill for Phase 3: every material that has stock but no history gets ONE "opening"
// movement for the stock it holds, so its history starts complete and
// quantity = sum of movements holds for the old records too.
//
// Read first, plan, write only with apply (the order CLAUDE.md asks for any data-changing job):
//   1. read every site the signed-in owner has, with its materials and movements
//   2. save that to outDir as a snapshot, before any write
//   3. plan, and write a before/after CSV
//   4. only with apply: one update per material, progress logged
//   5. read back and check every material kept its quantity and now reconciles
//
// The quantity never changes. The movement is `delta = quantity`, and the rules accept it only
// for a material that has stock, has never had a movement, and where the quantity stays as it is.
import fs from "node:fs";
import path from "node:path";
import { buildAddMaterialUpdates } from "../src/movements.js";

export const BACKFILL_NOTE = "Opening balance (before movements were recorded)";

// sites: { siteId: { materials: { id: material }, movements: { id: movement } } }
// Pure: decides what to write, writes nothing.
export function planBackfill(sites) {
    const items = [];
    for (const [siteId, site] of Object.entries(sites || {})) {
        const { materials, movements } = site || {};
        const movedIds = new Set(Object.values(movements || {}).map((m) => m && m.materialId));
        for (const [materialId, material] of Object.entries(materials || {})) {
            const base = { siteId, materialId, name: material && material.name, quantity: material && material.quantity };
            if (!material || typeof material !== "object") {
                items.push({ ...base, action: "skip", reason: "not a material" });
            } else if (typeof material.quantity !== "number" || !(material.quantity > 0)) {
                items.push({ ...base, action: "skip", reason: "no stock, nothing to explain" });
            } else if (material.lastMovementId || movedIds.has(materialId)) {
                items.push({ ...base, action: "skip", reason: "already has movements" });
            } else {
                items.push({ ...base, action: "backfill", reason: "" });
            }
        }
    }
    const count = (action) => items.filter((i) => i.action === action).length;
    return { items, counts: { backfill: count("backfill"), skipped: count("skip") } };
}

const csvCell = (value) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// The before/after report: one line per material, the opening movement it gets, and its history
// sum before and after.
export function backfillCsv(items) {
    const header = ["site", "material", "name", "quantity", "action", "reason", "movements_sum_before", "movements_sum_after"];
    const rows = items.map((i) => [
        i.siteId, i.materialId, i.name, i.quantity, i.action, i.reason,
        i.action === "backfill" ? 0 : "", i.action === "backfill" ? i.quantity : "",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

// The Firebase functions are passed in, so the command line and the emulator tests run the same code.
// user: { uid, email }. sv: { timestamp, increment }.
export async function runBackfill({ db, ref, get, update, push, user, sv, apply = false, outDir, now = Date.now(), log = console.log }) {
    fs.mkdirSync(outDir, { recursive: true });
    const say = (line) => {
        const text = `[${new Date().toISOString()}] ${line}`;
        fs.appendFileSync(path.join(outDir, "progress.log"), `${text}\n`);
        log(text);
    };
    const stamp = new Date(now).toISOString().replaceAll(":", "-").replace(/\..*$/, "");

    say(`Nail It backfill: reading the sites of ${user.email}`);
    const listed = (await get(ref(db, `userSites/${user.uid}`))).val() || {};
    const sites = {};
    for (const [siteId, role] of Object.entries(listed)) {
        if (role !== "owner" && role !== "storekeeper") {
            say(`Skipping site ${siteId}: role ${role} cannot write`);
            continue;
        }
        const [materials, movements] = await Promise.all([
            get(ref(db, `materials/${siteId}`)),
            get(ref(db, `movements/${siteId}`)),
        ]);
        sites[siteId] = { materials: materials.val() || {}, movements: movements.val() || {} };
    }

    const snapshotFile = path.join(outDir, `snapshot-${stamp}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify(sites, null, 2));
    say(`Snapshot saved: ${snapshotFile}`);

    const plan = planBackfill(sites);
    const csvFile = path.join(outDir, `report-${stamp}.csv`);
    fs.writeFileSync(csvFile, backfillCsv(plan.items));
    say(`Plan: ${JSON.stringify(plan.counts)}`);
    say(`Before/after report: ${csvFile}`);

    const result = { applied: false, plan, snapshotFile, csvFile, verified: null, failures: [] };
    if (!apply) {
        say("DRY RUN: nothing was written. Run again with --apply to write the plan.");
        return result;
    }

    const todo = plan.items.filter((i) => i.action === "backfill");
    let done = 0;
    for (const item of todo) {
        const material = sites[item.siteId].materials[item.materialId];
        const movementId = push(ref(db, `movements/${item.siteId}`)).key;
        // Only the movement and the pointer: the material is explained, not changed.
        const built = buildAddMaterialUpdates({
            siteId: item.siteId, materialId: item.materialId, movementId, user, sv,
            material: { name: material.name, units: material.units, quantity: material.quantity },
            note: BACKFILL_NOTE,
        });
        await update(ref(db), {
            [`movements/${item.siteId}/${movementId}`]: built[`movements/${item.siteId}/${movementId}`],
            [`materials/${item.siteId}/${item.materialId}/lastMovementId`]: movementId,
        });
        done += 1;
        say(`Nail It backfill: ${Math.round((done / todo.length) * 100)}% (${done}/${todo.length}), ${item.siteId}/${item.materialId} ${item.name}`);
    }
    result.applied = true;

    for (const item of todo) {
        const material = (await get(ref(db, `materials/${item.siteId}/${item.materialId}`))).val();
        const movements = Object.values((await get(ref(db, `movements/${item.siteId}`))).val() || {})
            .filter((m) => m.materialId === item.materialId);
        const sum = movements.reduce((total, m) => total + m.delta, 0);
        if (!material || material.quantity !== item.quantity || sum !== item.quantity) {
            result.failures.push({ site: item.siteId, material: item.materialId, quantity: material && material.quantity, expected: item.quantity, sum });
        }
    }
    result.verified = result.failures.length === 0;
    say(result.verified
        ? `VERIFIED: ${todo.length} materials kept their quantity and now equal the sum of their movements.`
        : `NOT VERIFIED: ${result.failures.length} materials differ. First: ${JSON.stringify(result.failures[0])}`);
    return result;
}
