// Runs the migration against a database. The Firebase functions are passed in, so the same code
// runs from the command line (scripts/migrate.mjs) and against the emulator in tests.
//
// Order of events, as the backfill rules in CLAUDE.md require:
//   1. read everything the plan could touch
//   2. save a snapshot of it to outDir, before any write
//   3. plan, and write the before/after CSV
//   4. only with apply: write one update per site, logging progress as it goes
//   5. read back and check the result against the plan
import fs from "node:fs";
import path from "node:path";
import { planMigration, reportCsv } from "./migration-plan.js";

// Firebase hands objects back with their keys sorted, so compare by content, not by key order.
function canonical(value) {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
}

export const sameData = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const stamp = (now) => new Date(now).toISOString().replaceAll(":", "-").replace(/\..*$/, "");

// db, ref, get, update: the Firebase Realtime Database functions and instance.
// user: { uid, email }. apply: false is a dry run and writes nothing to the database.
export async function runMigration({ db, ref, get, update, user, apply = false, outDir, now = Date.now(), log = console.log }) {
    fs.mkdirSync(outDir, { recursive: true });
    const progressFile = path.join(outDir, "progress.log");
    const say = (line) => {
        const text = `[${new Date().toISOString()}] ${line}`;
        fs.appendFileSync(progressFile, `${text}\n`);
        log(text);
    };

    say(`Nail It migration: reading sites and materials as ${user.email}`);
    const [sitesSnap, materialsSnap] = await Promise.all([get(ref(db, "sites")), get(ref(db, "materials"))]);
    const legacy = { sites: sitesSnap.val(), materials: materialsSnap.val() };

    const snapshotFile = path.join(outDir, `snapshot-${stamp(now)}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify(legacy, null, 2));
    say(`Snapshot saved: ${snapshotFile}`);

    const { updates, report } = planMigration(legacy, { ownerUid: user.uid, ownerEmail: user.email, now });
    const csvFile = path.join(outDir, `report-${stamp(now)}.csv`);
    fs.writeFileSync(csvFile, reportCsv(report));
    say(`Plan: ${JSON.stringify(report.counts)}`);
    say(`Before/after report: ${csvFile}`);

    const result = { applied: false, report, updates, snapshotFile, csvFile, verified: null };
    if (!apply) {
        say("DRY RUN: nothing was written. Run again with --apply to write the plan.");
        return result;
    }

    // One update per site: a site and its materials move together or not at all.
    const bySite = new Map();
    for (const [pathName, value] of Object.entries(updates)) {
        const siteId = pathName.startsWith("userSites/") ? pathName.split("/")[2] : pathName.split("/")[1];
        if (!bySite.has(siteId)) {
            bySite.set(siteId, {});
        }
        bySite.get(siteId)[pathName] = value;
    }
    let done = 0;
    for (const [siteId, siteUpdates] of bySite) {
        await update(ref(db), siteUpdates);
        done += 1;
        say(`Nail It migration: ${Math.round((done / bySite.size) * 100)}% (${done}/${bySite.size} sites), site ${siteId}, ${Object.keys(siteUpdates).length} paths`);
    }
    result.applied = true;

    // Read back and compare with the plan, so "it worked" is a measured claim.
    const failures = [];
    for (const [pathName, expected] of Object.entries(updates)) {
        const actual = (await get(ref(db, pathName))).val();
        if (!sameData(actual, expected)) {
            failures.push({ path: pathName, expected, actual });
        }
    }
    result.verified = failures.length === 0;
    result.failures = failures;
    say(result.verified
        ? `VERIFIED: all ${Object.keys(updates).length} written paths read back exactly as planned.`
        : `NOT VERIFIED: ${failures.length} paths differ. First: ${JSON.stringify(failures[0])}`);
    return result;
}
