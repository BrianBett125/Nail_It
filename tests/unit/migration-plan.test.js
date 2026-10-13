import { test } from "node:test";
import assert from "node:assert/strict";
import { planMigration, reportCsv } from "../../scripts/migration-plan.js";

const NOW = Date.parse("2026-10-14T09:30:00Z");
const OWNER = { ownerUid: "boss", ownerEmail: "boss@example.com", now: NOW };

const legacy = () => ({
    sites: {
        sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", date: "2024-05-01" },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
    },
});

test("a clean legacy site becomes an owned site with createdAt from its old date, and no date field", () => {
    const { updates, report } = planMigration(legacy(), OWNER);
    assert.deepEqual(updates["sites/sA"], {
        name: "Mombasa",
        location: "Nyali",
        buildingType: "Residential",
        createdAt: Date.parse("2024-05-01T00:00:00Z"),
        ownerUid: "boss",
    });
    assert.equal("date" in updates["sites/sA"], false);
    assert.equal(report.sites[0].action, "migrate");
});

test("the owner entries are written for every site: members, site list, member info", () => {
    const { updates } = planMigration(legacy(), OWNER);
    assert.equal(updates["members/sA/boss"], "owner");
    assert.equal(updates["userSites/boss/sA"], "owner");
    assert.deepEqual(updates["memberInfo/sA/boss"], { email: "boss@example.com" });
});

test("a material is copied under its site, without the siteId, and the flat node is not touched", () => {
    const { updates } = planMigration(legacy(), OWNER);
    assert.deepEqual(updates["materials/sA/m1"], { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" });
    assert.equal("materials/m1" in updates, false, "the old flat node is left alone, so the old app keeps working");
    assert.ok(Object.values(updates).every((value) => value !== null), "the plan never deletes anything");
});

test("every written path is one the new database rules accept", () => {
    const { updates } = planMigration(legacy(), OWNER);
    for (const path of Object.keys(updates)) {
        assert.match(path, /^(sites\/[^/]+|members\/[^/]+\/[^/]+|userSites\/[^/]+\/[^/]+|memberInfo\/[^/]+\/[^/]+|materials\/[^/]+\/[^/]+)$/, path);
    }
});

test("site fields are repaired, and each repair is reported with before and after", () => {
    const data = {
        sites: {
            sB: { name: "  cape   town ", location: "", buildingType: "commercial", date: "garbage" },
            sC: { name: "", location: "x", buildingType: "Castle", date: "2024-02-30" },
        },
        materials: {},
    };
    const { updates, report } = planMigration(data, OWNER);
    assert.deepEqual(updates["sites/sB"], { name: "cape town", location: "Unknown", buildingType: "Commercial", createdAt: NOW, ownerUid: "boss" });
    assert.deepEqual(updates["sites/sC"], { name: "(unnamed site)", location: "x", buildingType: "Other", createdAt: NOW, ownerUid: "boss" });
    const fields = (id) => report.sites.find((s) => s.id === id).changes.map((c) => c.field);
    assert.deepEqual(fields("sB"), ["name", "location", "buildingType", "createdAt", "date"]);
    assert.deepEqual(fields("sC"), ["name", "buildingType", "createdAt", "date"]);
});

test("a site made since Phase 1 keeps its own createdAt (it has no date to read)", () => {
    const data = { sites: { s: { name: "New", location: "l", buildingType: "Other", createdAt: 1730000000000 } }, materials: {} };
    const { updates, report } = planMigration(data, OWNER);
    assert.equal(updates["sites/s"].createdAt, 1730000000000);
    assert.equal(report.sites[0].changes.some((c) => c.field === "createdAt"), false);
    assert.deepEqual(Object.keys(updates["sites/s"]).sort(), ["buildingType", "createdAt", "location", "name", "ownerUid"]);
});

test("a site with both a createdAt and a stale date keeps createdAt and drops the date", () => {
    const data = { sites: { s: { name: "Both", location: "l", buildingType: "Other", createdAt: 1730000000000, date: "2020-01-01" } }, materials: {} };
    const { updates } = planMigration(data, OWNER);
    assert.equal(updates["sites/s"].createdAt, 1730000000000);
    assert.equal("date" in updates["sites/s"], false);
});

test("an impossible date (February 30) is not turned into a date", () => {
    const { updates } = planMigration({ sites: { s: { name: "a", location: "b", buildingType: "Other", date: "2024-02-30" } }, materials: {} }, OWNER);
    assert.equal(updates["sites/s"].createdAt, NOW);
});

test("long names are cut to the length the rules allow, and reported", () => {
    const data = { sites: { s: { name: "n".repeat(150), location: "l".repeat(200), buildingType: "Other", date: "2024-01-01" } }, materials: {} };
    const { updates, report } = planMigration(data, OWNER);
    assert.equal(updates["sites/s"].name.length, 100);
    assert.equal(updates["sites/s"].location.length, 120);
    assert.ok(report.sites[0].changes.some((c) => c.field === "name" && /shortened/.test(c.why)));
});

test("a quantity written as text is converted, and the conversion is reported", () => {
    const data = legacy();
    data.materials.m1.quantity = "12.5";
    const { updates, report } = planMigration(data, OWNER);
    assert.strictEqual(updates["materials/sA/m1"].quantity, 12.5);
    assert.deepEqual(report.materials[0].changes, [{ field: "quantity", before: "12.5", after: 12.5, why: "text converted to a number" }]);
});

test("a material with an unusable quantity is NOT migrated and NOT altered: it is skipped with the reason", () => {
    const bad = ["-5", -5, "lots", "", null, NaN, Infinity, 1e12];
    for (const quantity of bad) {
        const data = legacy();
        data.materials.m1.quantity = quantity;
        const { updates, report } = planMigration(data, OWNER);
        assert.equal("materials/sA/m1" in updates, false, String(quantity));
        assert.equal(report.materials[0].action, "skipped");
        assert.match(report.materials[0].reason, /quantity/);
    }
});

test("units: a legacy value like 'kgs' is kept, an empty or over-long one is skipped", () => {
    const data = legacy();
    data.materials.m1.units = "kgs";
    assert.equal(planMigration(data, OWNER).updates["materials/sA/m1"].units, "kgs");
    for (const units of ["", "   ", "x".repeat(21), undefined]) {
        const d = legacy();
        d.materials.m1.units = units;
        const { updates, report } = planMigration(d, OWNER);
        assert.equal("materials/sA/m1" in updates, false);
        assert.match(report.materials[0].reason, /units/);
    }
});

test("a material without a name is skipped", () => {
    const data = legacy();
    data.materials.m1.name = "   ";
    assert.match(planMigration(data, OWNER).report.materials[0].reason, /no name/);
});

test("dates: ISO kept, a time of day removed, anything else (including 03/05/2024) replaced and reported, never guessed", () => {
    const cases = [
        ["2024-05-03", "2024-05-03", null],
        ["2024-05-03T10:15:00", "2024-05-03", "time of day removed"],
        ["03/05/2024", "2026-10-14", "no usable date, set to the migration day"],
        ["", "2026-10-14", "no usable date, set to the migration day"],
        [undefined, "2026-10-14", "no usable date, set to the migration day"],
        ["2024-13-45", "2026-10-14", "no usable date, set to the migration day"],
    ];
    for (const [input, expected, why] of cases) {
        const data = legacy();
        data.materials.m1.lastUpdated = input;
        const { updates, report } = planMigration(data, OWNER);
        assert.equal(updates["materials/sA/m1"].lastUpdated, expected, String(input));
        const change = report.materials[0].changes.find((c) => c.field === "lastUpdated");
        assert.equal(change ? change.why : null, why, String(input));
    }
});

test("an orphan material (its site is gone) is skipped and listed, not invented a home", () => {
    const data = legacy();
    data.materials.m9 = { name: "Sand", quantity: 1, units: "bags", lastUpdated: "2024-05-03", siteId: "deleted" };
    const { updates, report } = planMigration(data, OWNER);
    assert.equal(Object.keys(updates).some((p) => p.includes("m9")), false);
    const orphan = report.materials.find((m) => m.id === "m9");
    assert.equal(orphan.action, "skipped");
    assert.match(orphan.reason, /no longer exists/);
});

test("junk from the old bugs (no siteId) is listed as junk and never copied", () => {
    const data = legacy();
    data.materials["[object PointerEvent]"] = { name: "Cement", quantity: 8, units: "bags", lastUpdated: "2024-05-03" };
    data.materials.stray = "not even an object";
    data.materials.nul = null;
    const { updates, report } = planMigration(data, OWNER);
    assert.deepEqual(report.skipped.map((j) => j.path).sort(), ["materials/[object PointerEvent]", "materials/nul", "materials/stray"]);
    assert.equal(Object.keys(updates).some((p) => p.includes("object PointerEvent")), false);
});

test("an empty database plans nothing, and does not fail", () => {
    for (const empty of [{ sites: null, materials: null }, { sites: {}, materials: {} }, {}]) {
        const { updates, report } = planMigration(empty, OWNER);
        assert.deepEqual(updates, {});
        assert.deepEqual(report.counts, {
            sitesToMigrate: 0, sitesAlreadyMigrated: 0, sitesSkipped: 0,
            materialsToCopy: 0, materialsAlreadyMigrated: 0, materialsSkipped: 0, junkNodes: 0,
        });
    }
});

test("running it a second time changes nothing that was edited since: owned sites are not rewritten", () => {
    const first = planMigration(legacy(), OWNER);
    // The database after the first run, then the owner renamed the site and edited a material in the new app.
    const after = {
        sites: { sA: { ...first.updates["sites/sA"], name: "Mombasa North" } },
        materials: {
            m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
            sA: { m1: { name: "Cement", quantity: 99, units: "bags", lastUpdated: "2024-06-01" } },
        },
    };
    const second = planMigration(after, OWNER);
    assert.equal("sites/sA" in second.updates, false, "the renamed site is not overwritten");
    assert.equal("materials/sA/m1" in second.updates, false, "the edited material is not overwritten");
    assert.equal(second.report.sites[0].action, "already migrated");
    assert.equal(second.report.materials[0].action, "already migrated");
});

test("a site owned by another account is left alone, with its materials", () => {
    const data = legacy();
    data.sites.sA.ownerUid = "someone-else";
    const { updates, report } = planMigration(data, OWNER);
    assert.deepEqual(updates, {});
    assert.equal(report.sites[0].action, "skipped");
    assert.match(report.sites[0].reason, /another account/);
    assert.match(report.materials[0].reason, /another account/);
});

test("materials already in the new layout are not mistaken for junk or re-copied", () => {
    const data = {
        sites: { sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 1, ownerUid: "boss" } },
        materials: { sA: { m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" } } },
    };
    const { updates, report } = planMigration(data, OWNER);
    assert.equal(report.counts.junkNodes, 0);
    assert.equal(report.counts.materialsToCopy, 0);
    assert.equal("materials/sA/m1" in updates, false);
});

test("the counts add up to what was found", () => {
    const data = legacy();
    data.sites.sB = { name: "B", location: "b", buildingType: "Other", date: "2024-01-01" };
    data.materials.m2 = { name: "Sand", quantity: -1, units: "bags", lastUpdated: "2024-05-03", siteId: "sB" };
    data.materials.m3 = { name: "Gravel", quantity: 1, units: "bags", lastUpdated: "2024-05-03", siteId: "gone" };
    data.materials.junk = { name: "x" };
    const { report } = planMigration(data, OWNER);
    assert.deepEqual(report.counts, {
        sitesToMigrate: 2, sitesAlreadyMigrated: 0, sitesSkipped: 0,
        materialsToCopy: 1, materialsAlreadyMigrated: 0, materialsSkipped: 2, junkNodes: 1,
    });
});

test("planMigration needs to know the owner", () => {
    assert.throws(() => planMigration(legacy(), { ownerUid: "", ownerEmail: "a@b.co" }), /owner's uid and email/);
    assert.throws(() => planMigration(legacy(), { ownerUid: "u", ownerEmail: "" }), /owner's uid and email/);
});

test("the CSV has one row per decision and quotes commas, quotes and newlines", () => {
    const data = legacy();
    data.sites.sA.name = 'Hill, "North"\nsite';
    data.materials.junk = { name: "x" };
    const csv = reportCsv(planMigration(data, OWNER).report);
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], "kind,id,site,name,action,field,before,after,why");
    assert.match(csv, /"Hill, ""North""\nsite"/);
    assert.match(csv, /junk,materials\/junk/);
    assert.ok(csv.endsWith("\n"));
});

test("the CSV is readable on a clean run: sites and materials with their actions", () => {
    const csv = reportCsv(planMigration(legacy(), OWNER).report);
    assert.match(csv, /site,sA,,Mombasa,migrate,createdAt,2024-05-01,1714521600000,from the old date/);
    assert.match(csv, /material,m1,sA,Cement,copy,,,,/);
});
