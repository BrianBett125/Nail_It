// runMigration against a tiny in-memory database: dry run, apply, per-site updates, logging,
// and what happens when the database does not store what was written.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigration, sameData } from "../../scripts/migrate-lib.js";

function memoryDb(initial, { dropPath } = {}) {
    const root = structuredClone(initial);
    const writes = [];
    const read = (p) => p.split("/").filter(Boolean).reduce((node, part) => (node == null ? undefined : node[part]), root);
    const write = (p, value) => {
        const parts = p.split("/");
        const last = parts.pop();
        let node = root;
        for (const part of parts) {
            node = node[part] ??= {};
        }
        node[last] = value;
    };
    return {
        root,
        writes,
        db: {},
        ref: (_db, p = "") => ({ path: p }),
        get: async (r) => ({ val: () => (read(r.path) === undefined ? null : structuredClone(read(r.path))) }),
        update: async (r, updates) => {
            writes.push(Object.keys(updates));
            for (const [p, value] of Object.entries(updates)) {
                if (p !== dropPath) {
                    write(p, structuredClone(value));
                }
            }
        },
    };
}

const LEGACY = {
    sites: {
        sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", date: "2024-05-01" },
        sB: { name: "Cape Town", location: "Bellville", buildingType: "Commercial", date: "2024-05-02" },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", lastUpdated: "2024-05-04", siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
};
const USER = { uid: "boss", email: "boss@example.com" };
const outDirFor = () => fs.mkdtempSync(path.join(os.tmpdir(), "nailit-mig-"));
const quiet = () => {};

test("a dry run writes nothing to the database, but saves the snapshot and the report", async () => {
    const mem = memoryDb(LEGACY);
    const outDir = outDirFor();
    const result = await runMigration({ ...mem, user: USER, apply: false, outDir, log: quiet });

    assert.equal(result.applied, false);
    assert.deepEqual(mem.writes, []);
    assert.deepEqual(mem.root, LEGACY);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.snapshotFile, "utf8")), LEGACY, "the snapshot is the database as it was");
    assert.match(fs.readFileSync(result.csvFile, "utf8"), /^kind,id,site,name,action/);
    assert.match(fs.readFileSync(path.join(outDir, "progress.log"), "utf8"), /DRY RUN: nothing was written/);
});

test("the snapshot is written BEFORE the first write", async () => {
    const mem = memoryDb(LEGACY);
    const outDir = outDirFor();
    const events = [];
    const update = mem.update;
    mem.update = async (...args) => {
        events.push(fs.readdirSync(outDir).some((f) => f.startsWith("snapshot-")) ? "snapshot-present" : "no-snapshot");
        return update(...args);
    };
    await runMigration({ ...mem, user: USER, apply: true, outDir, log: quiet });
    assert.ok(events.length > 0);
    assert.ok(events.every((e) => e === "snapshot-present"));
});

test("apply writes one update per site, each holding that site and its materials together", async () => {
    const mem = memoryDb(LEGACY);
    const result = await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });

    assert.equal(result.applied, true);
    assert.equal(mem.writes.length, 2, "two sites, two updates");
    for (const paths of mem.writes) {
        const sites = new Set(paths.map((p) => (p.startsWith("userSites/") ? p.split("/")[2] : p.split("/")[1])));
        assert.equal(sites.size, 1, `an update mixes sites: ${paths}`);
    }
    const sA = mem.writes.find((paths) => paths.includes("sites/sA"));
    assert.deepEqual([...sA].sort(), [
        "materials/sA/m1", "materials/sA/m2", "memberInfo/sA/boss", "members/sA/boss", "sites/sA", "userSites/boss/sA",
    ]);
});

test("after apply the new layout is in place, the old materials are untouched, and it is verified", async () => {
    const mem = memoryDb(LEGACY);
    const result = await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });

    assert.equal(result.verified, true);
    assert.equal(mem.root.sites.sA.ownerUid, "boss");
    assert.equal("date" in mem.root.sites.sA, false);
    assert.deepEqual(mem.root.materials.sA.m1, { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" });
    assert.deepEqual(mem.root.materials.m1, LEGACY.materials.m1, "the old flat node is still there");
    assert.equal(mem.root.members.sB.boss, "owner");
    assert.equal(mem.root.userSites.boss.sA, "owner");
});

test("progress is logged with a percentage, and the file matches what was printed", async () => {
    const mem = memoryDb(LEGACY);
    const outDir = outDirFor();
    const printed = [];
    await runMigration({ ...mem, user: USER, apply: true, outDir, log: (line) => printed.push(line) });
    const file = fs.readFileSync(path.join(outDir, "progress.log"), "utf8").trimEnd().split("\n");
    assert.deepEqual(file, printed);
    assert.ok(printed.some((l) => /Nail It migration: 50% \(1\/2 sites\)/.test(l)));
    assert.ok(printed.some((l) => /Nail It migration: 100% \(2\/2 sites\)/.test(l)));
    assert.ok(printed.every((l) => /^\[\d{4}-\d{2}-\d{2}T/.test(l)), "every line is timestamped");
});

test("a database that does not store what was written is reported as NOT verified", async () => {
    const mem = memoryDb(LEGACY, { dropPath: "materials/sA/m2" });
    const result = await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });
    assert.equal(result.verified, false);
    assert.deepEqual(result.failures.map((f) => f.path), ["materials/sA/m2"]);
});

test("an empty database is a clean no-op", async () => {
    const mem = memoryDb({});
    const result = await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });
    assert.deepEqual(mem.writes, []);
    assert.equal(result.verified, true);
});

test("running twice leaves the database as the first run left it", async () => {
    const mem = memoryDb(LEGACY);
    await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });
    const afterFirst = structuredClone(mem.root);
    mem.root.materials.sA.m1.quantity = 77; // an edit made in the new app between the runs
    afterFirst.materials.sA.m1.quantity = 77;
    await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });
    assert.deepEqual(mem.root, afterFirst);
});

test("sameData compares content, not key order (Firebase returns keys sorted)", () => {
    assert.equal(sameData({ b: 1, a: { d: 2, c: 3 } }, { a: { c: 3, d: 2 }, b: 1 }), true);
    assert.equal(sameData({ a: 1 }, { a: 2 }), false);
    assert.equal(sameData({ a: 1 }, { a: 1, b: undefined }), true, "an absent key and an undefined one are the same to the database");
    assert.equal(sameData({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(sameData("owner", "owner"), true);
    assert.equal(sameData(null, { a: 1 }), false);
    assert.equal(sameData(5, "5"), false);
});

test("a database that returns the keys in another order still verifies", async () => {
    const mem = memoryDb(LEGACY);
    const get = mem.get;
    mem.get = async (r) => {
        const snapshot = await get(r);
        const value = snapshot.val();
        const reversed = value && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).reverse()) : value;
        return { val: () => reversed };
    };
    const result = await runMigration({ ...mem, user: USER, apply: true, outDir: outDirFor(), log: quiet });
    assert.equal(result.verified, true);
});
