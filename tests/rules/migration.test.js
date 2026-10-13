// The real migration (scripts/migrate-lib.js) run on the emulator against legacy data that
// includes the junk the old bugs left behind, then checked against the REAL database rules.
// This is the closest thing to the production run that can happen before the production run.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    startEnv, raw, as, anonymous, ref, get, set, update, assertSucceeds, assertFails,
} from "./helpers.js";
import { runMigration } from "../../scripts/migrate-lib.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });

const BOSS = { uid: "boss", email: "boss@example.com" };

// What production looks like today: flat, with the leftovers of the Phase 0 bugs.
const LEGACY = {
    sites: {
        sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", date: "2024-05-01" },
        sB: { name: "  cape town ", location: "Bellville", buildingType: "commercial", date: "2024-05-02" },
        sC: { name: "Kisumu", location: "Lake", buildingType: "Warehouse", date: "05/03/2024" },
        sD: { name: "After Phase 1", location: "Eldoret", buildingType: "Industrial", createdAt: 1730000000000 },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
        m2: { name: "Sand", quantity: "10", units: "tonnes", lastUpdated: "2024-05-04", siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
        m4: { name: "Gravel", quantity: -3, units: "tonnes", lastUpdated: "2024-05-05", siteId: "sB" },
        m5: { name: "Orphan", quantity: 1, units: "bags", lastUpdated: "2024-05-05", siteId: "deleted-site" },
        m6: { name: "Bricks", quantity: 500, units: "pieces", lastUpdated: "03/05/2024", siteId: "sC" },
        m7: { name: "Paint", quantity: 3, units: "litres", lastUpdated: "2024-06-01", siteId: "sD" },
        "-NjunkKey": { name: "Cement", quantity: 8, units: "bags", lastUpdated: "2024-05-03" },
    },
};

const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "nailit-mig-emu-"));
const quiet = () => {};

// The legacy rules were open, so the migration runs with the rules switched off, as it will in production.
async function migrate({ apply, dir = outDir() }) {
    let result;
    await env.withSecurityRulesDisabled(async (context) => {
        result = await runMigration({ db: context.database(), ref, get, update, user: BOSS, apply, outDir: dir, log: quiet });
    });
    return result;
}

async function seedLegacy() {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async (context) => {
        await set(ref(context.database()), LEGACY);
    });
}

const boss = () => as(env, "boss", { email: "boss@example.com", email_verified: true });
const rootNow = () => raw(env, "/");

describe("migration on the emulator", () => {
    beforeEach(seedLegacy);

    it("a dry run changes nothing in the database", async () => {
        const before = await rootNow();
        const result = await migrate({ apply: false });
        assert.equal(result.applied, false);
        assert.deepEqual(await rootNow(), before);
        assert.equal(result.report.counts.sitesToMigrate, 4);
    });

    it("apply: every migratable site and material is in the new layout, and read back as planned", async () => {
        const result = await migrate({ apply: true });
        assert.equal(result.verified, true);
        assert.deepEqual(result.report.counts, {
            sitesToMigrate: 4, sitesAlreadyMigrated: 0, sitesSkipped: 0,
            materialsToCopy: 5, materialsAlreadyMigrated: 0, materialsSkipped: 2, junkNodes: 1, // m1 m2 m3 m6 m7 copied; m4 m5 skipped
        });
        assert.deepEqual(Object.keys(await raw(env, "materials/sA")).sort(), ["m1", "m2"]);
        assert.deepEqual(await raw(env, "materials/sB"), { m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05" } });
        assert.equal((await raw(env, "materials/sA/m2")).quantity, 10, "the text quantity became a number");
        assert.equal(await raw(env, "userSites/boss/sA"), "owner");
        assert.equal(await raw(env, "members/sD/boss"), "owner");
    });

    it("what could not be migrated cleanly is left alone and listed, never guessed", async () => {
        const result = await migrate({ apply: true });
        const skipped = Object.fromEntries(result.report.materials.filter((m) => m.action === "skipped").map((m) => [m.id, m.reason]));
        assert.match(skipped.m4, /quantity/);
        assert.match(skipped.m5, /no longer exists/);
        assert.deepEqual(result.report.skipped.map((j) => j.path), ["materials/-NjunkKey"]);
        for (const id of ["m4", "m5"]) {
            assert.equal(Object.values(await raw(env, "materials")).some((v) => v && v[id]), false, `${id} must not appear in any site`);
        }
    });

    it("the site data is repaired to what the rules accept, and sites made since Phase 1 keep their createdAt", async () => {
        await migrate({ apply: true });
        assert.deepEqual(await raw(env, "sites/sB"), {
            name: "cape town", location: "Bellville", buildingType: "Commercial",
            createdAt: Date.parse("2024-05-02T00:00:00Z"), ownerUid: "boss",
        });
        const kisumu = await raw(env, "sites/sC");
        assert.equal(kisumu.buildingType, "Other", "'Warehouse' is not in the new list");
        assert.ok(kisumu.createdAt > Date.parse("2026-01-01"), "an ambiguous date is replaced by the migration time, not guessed");
        assert.equal((await raw(env, "sites/sD")).createdAt, 1730000000000);
        assert.equal("date" in (await raw(env, "sites/sA")), false);
    });

    it("the old flat nodes are still there afterwards, so the old app keeps working until the new one ships", async () => {
        await migrate({ apply: true });
        assert.equal((await raw(env, "materials/m1")).siteId, "sA");
        assert.ok(await raw(env, "materials/-NjunkKey"));
    });

    it("running it again changes nothing, and does not overwrite an edit made in the new app", async () => {
        await migrate({ apply: true });
        await env.withSecurityRulesDisabled(async (context) => {
            await update(ref(context.database(), "materials/sA/m1"), { quantity: 99 });
            await update(ref(context.database(), "sites/sA"), { name: "Mombasa North" });
        });
        const before = await rootNow();
        const second = await migrate({ apply: true });
        assert.equal(second.verified, true);
        assert.deepEqual(await rootNow(), before);
        assert.equal((await raw(env, "materials/sA/m1")).quantity, 99);
    });

    it("writes the snapshot, the CSV and a progress log", async () => {
        const dir = outDir();
        const result = await migrate({ apply: true, dir });
        const files = fs.readdirSync(dir);
        assert.ok(files.some((f) => /^snapshot-.*\.json$/.test(f)));
        assert.ok(files.some((f) => /^report-.*\.csv$/.test(f)));
        assert.match(fs.readFileSync(path.join(dir, "progress.log"), "utf8"), /VERIFIED: all \d+ written paths/);
        assert.deepEqual(JSON.parse(fs.readFileSync(result.snapshotFile, "utf8")).sites.sA.date, "2024-05-01");
    });
});

describe("after the migration, under the real rules", () => {
    before(async () => {
        await seedLegacy();
        await migrate({ apply: true });
    });

    it("the owner reads their site list, every site, members and materials", async () => {
        const db = boss();
        await assertSucceeds(get(ref(db, "userSites/boss")));
        for (const id of ["sA", "sB", "sC", "sD"]) {
            await assertSucceeds(get(ref(db, `sites/${id}`)));
            await assertSucceeds(get(ref(db, `members/${id}`)));
            await assertSucceeds(get(ref(db, `materials/${id}`)));
        }
        assert.deepEqual(Object.keys((await get(ref(db, "userSites/boss"))).val()).sort(), ["sA", "sB", "sC", "sD"]);
    });

    it("every migrated record passes the rules' validation: the owner can write each one back unchanged", async () => {
        const db = boss();
        for (const id of ["sA", "sB", "sC", "sD"]) {
            await assertSucceeds(set(ref(db, `sites/${id}`), await raw(env, `sites/${id}`)));
            for (const [materialId, material] of Object.entries((await raw(env, `materials/${id}`)) || {})) {
                await assertSucceeds(set(ref(db, `materials/${id}/${materialId}`), material));
            }
        }
    });

    it("the migrated owner can use the app: edit stock, add stock, invite", async () => {
        const db = boss();
        await assertSucceeds(update(ref(db, "materials/sA/m1"), { quantity: 6 }));
        await assertSucceeds(set(ref(db, "materials/sA/new"), { name: "Gravel", quantity: 1, units: "tonnes", lastUpdated: "2026-10-14" }));
        await assertSucceeds(update(ref(db), {
            "userInvites/sam@example,com/sA": { role: "viewer", siteName: "Mombasa", invitedBy: "boss@example.com" },
            "siteInvites/sA/sam@example,com": "viewer",
        }));
    });

    it("logged-out visitors and strangers get nothing, old and new layout alike", async () => {
        for (const p of ["sites/sA", "materials/sA", "materials/sA/m1", "members/sA", "materials/m1", "materials", "sites"]) {
            await assertFails(get(ref(anonymous(env), p)));
            await assertFails(get(ref(as(env, "stranger"), p)));
        }
    });

    it("the old flat layout is unreadable and unwritable for everyone now (the leftovers are harmless, delete them in the console)", async () => {
        await assertFails(get(ref(boss(), "materials/m1")));
        await assertFails(set(ref(boss(), "materials/m1/quantity"), 1));
    });

    it("the old app's own query is refused, so it cannot read or write anything after the rules ship", async () => {
        await assertFails(get(ref(boss(), "materials")));
        await assertFails(get(ref(boss(), "sites")));
        await assertFails(set(ref(anonymous(env), "materials/oldapp"), { name: "x", quantity: 1, units: "y", lastUpdated: "2024-01-01", siteId: "sA" }));
    });
});
