// The pure part of the Phase 3 backfill: which materials get an opening movement. The run against
// the real rules is in tests/rules/backfill.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBackfill, backfillCsv } from "../../scripts/backfill-lib.js";

const SITES = {
    s1: {
        materials: {
            m1: { name: "Cement", quantity: 5, units: "bags" },
            m2: { name: "Sand", quantity: 0, units: "tonnes" },
            m3: { name: "Nails", quantity: 40, units: "kg", lastMovementId: "mv9" },
            m4: { name: "Paint", quantity: 3, units: "litres" },
            m5: { name: "Bricks", quantity: "12", units: "pieces" },
        },
        movements: { mv1: { materialId: "m4", delta: 3 } },
    },
    s2: { materials: { m6: { name: "Gravel, coarse", quantity: 2.5, units: "tonnes" } } },
    s3: {},
};

const byId = (plan) => Object.fromEntries(plan.items.map((i) => [i.materialId, i]));

test("a material with stock and no history gets a backfill", () => {
    const plan = byId(planBackfill(SITES));
    assert.equal(plan.m1.action, "backfill");
    assert.equal(plan.m6.action, "backfill");
    assert.equal(plan.m6.siteId, "s2");
});

test("materials that need nothing are skipped, each with its reason", () => {
    const plan = byId(planBackfill(SITES));
    assert.deepEqual([plan.m2.action, plan.m2.reason], ["skip", "no stock, nothing to explain"]);
    assert.deepEqual([plan.m3.action, plan.m3.reason], ["skip", "already has movements"]);
    assert.deepEqual([plan.m4.action, plan.m4.reason], ["skip", "already has movements"], "a movement exists even without the pointer");
    assert.equal(plan.m5.action, "skip", "a text quantity is not touched, it is not a number");
});

test("counts add up, and running the plan on an empty or null database is a no-op", () => {
    assert.deepEqual(planBackfill(SITES).counts, { backfill: 2, skipped: 4 });
    assert.deepEqual(planBackfill({}).items, []);
    assert.deepEqual(planBackfill(null).items, []);
    assert.deepEqual(planBackfill({ s1: { materials: null, movements: null } }).items, []);
});

test("the CSV has one line per material, shows the history sum before and after, and quotes commas", () => {
    const csv = backfillCsv(planBackfill(SITES).items).trim().split("\n");
    assert.equal(csv[0], "site,material,name,quantity,action,reason,movements_sum_before,movements_sum_after");
    assert.equal(csv.length, 1 + 6);
    assert.ok(csv.includes("s1,m1,Cement,5,backfill,,0,5"));
    assert.ok(csv.includes('s2,m6,"Gravel, coarse",2.5,backfill,,0,2.5'));
    assert.ok(csv.includes("s1,m2,Sand,0,skip,\"no stock, nothing to explain\",,"));
});
