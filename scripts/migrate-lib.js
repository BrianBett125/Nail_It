// Runs the migration against a database. The Firebase functions are passed in, so the same code
// runs from the command line (scripts/migrate.mjs) and against the emulator in tests.
//
// Two ways to run it:
//   - in place: the old layout and the new one are in the same database (no readSource)
//   - copy: readSource() reads the OLD database (any project), the writes go to `db`, a different
//     and empty project that already has the new rules. The copy is done as the owner, so the
//     rules are what allow it. The target is read first so a re-run skips what is already there.
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

// What the owner already has in the target: their sites and those sites' materials.
async function readTargetExisting({ db, ref, get, uid }) {
    const listed = (await get(ref(db, `userSites/${uid}`))).val() || {};
    const existing = { sites: {}, materials: {} };
    for (const siteId of Object.keys(listed)) {
        const site = (await get(ref(db, `sites/${siteId}`))).val();
        if (site) {
            existing.sites[siteId] = site;
        }
        const materials = (await get(ref(db, `materials/${siteId}`))).val();
        if (materials) {
            existing.materials[siteId] = materials;
        }
    }
    return existing;
}

const stamp = (now) => new Date(now).toISOString().replaceAll(":", "-").replace(/\..*$/, "");

// db, ref, get, update: the Firebase Realtime Database functions and instance.
// user: { uid, email }. apply: false is a dry run and writes nothing to the database.
export async function runMigration({ db, ref, get, update, user, apply = false, outDir, now = Date.now(), log = console.log, readSource = null }) {
    fs.mkdirSync(outDir, { recursive: true });
    const progressFile = path.join(outDir, "progress.log");
    const say = (line) => {
        const text = `[${new Date().toISOString()}] ${line}`;
        fs.appendFileSync(progressFile, `${text}\n`);
        log(text);
    };

    say(`Nail It migration: reading sites and materials as ${user.email}`);
    let legacy;
    let snapshot;
    if (readSource) {
        const source = await readSource();
        const existing = await readTargetExisting({ db, ref, get, uid: user.uid });
        // What the target already holds wins: a site with an ownerUid there is "already migrated".
        legacy = {
            sites: { ...(source.sites || {}), ...existing.sites },
            materials: { ...(source.materials || {}), ...existing.materials },
        };
        snapshot = { source, existing };
        say(`Copy mode: ${Object.keys(source.sites || {}).length} sites and ${Object.keys(source.materials || {}).length} materials in the old database, ${Object.keys(existing.sites).length} sites already in the new one`);
    } else {
        const [sitesSnap, materialsSnap] = await Promise.all([get(ref(db, "sites")), get(ref(db, "materials"))]);
        legacy = { sites: sitesSnap.val(), materials: materialsSnap.val() };
        snapshot = legacy;
    }

    const snapshotFile = path.join(outDir, `snapshot-${stamp(now)}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
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

    // Two updates per site, in this order. First the site and its owner entries, which the rules
    // only accept together. Then the materials, which the rules only accept from a site's owner,
    // so the owner entry has to exist before them. A failure leaves a site without materials, never
    // materials without a site, and a re-run fills in what is missing.
    const bySite = new Map();
    for (const [pathName, value] of Object.entries(updates)) {
        const siteId = pathName.startsWith("userSites/") ? pathName.split("/")[2] : pathName.split("/")[1];
        if (!bySite.has(siteId)) {
            bySite.set(siteId, { site: {}, materials: {} });
        }
        bySite.get(siteId)[pathName.startsWith("materials/") ? "materials" : "site"][pathName] = value;
    }
    let done = 0;
    for (const [siteId, { site, materials }] of bySite) {
        if (Object.keys(site).length > 0) {
            await update(ref(db), site);
        }
        if (Object.keys(materials).length > 0) {
            await update(ref(db), materials);
        }
        done += 1;
        say(`Nail It migration: ${Math.round((done / bySite.size) * 100)}% (${done}/${bySite.size} sites), site ${siteId}, ${Object.keys(site).length + Object.keys(materials).length} paths`);
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
