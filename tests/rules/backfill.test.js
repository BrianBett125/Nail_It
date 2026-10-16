// The Phase 3 backfill run on the emulator against the real rules, with a snapshot of what a
// production-like database looks like before it: materials with stock and no movements.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    startEnv, reset, raw, as, ref, get, update, push, assertSucceeds, assertFails, SV, FIXTURE, MATERIAL, receive, newId,
} from "./helpers.js";
import { runBackfill } from "../../scripts/backfill-lib.js";
import { reconciles, movementsFromObject } from "../../src/movements.js";

let env;
before(async () => { env = await startEnv(); });
after(async () => { await env.cleanup(); });

const OWNER = { uid: "owner1", email: "owner1@example.com" };
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "nailit-backfill-emu-"));
const quiet = () => {};

const FILLED = {
    ...FIXTURE,
    materials: {
        s1: {
            m1: MATERIAL,                                                       // 5 bags, no history
            m2: { name: "Sand", quantity: 10, units: "tonnes", lastUpdated: "2024-05-04" },
            m3: { name: "Empty", quantity: 0, units: "bags", lastUpdated: "2024-05-04" },
        },
        s2: { m9: { ...MATERIAL, name: "Somebody else's" } },
    },
};

beforeEach(async () => { await reset(env, FILLED); });

const backfill = (db, user, apply, dir = outDir()) =>
    runBackfill({ db, ref, get, update, push, user, sv: SV, apply, outDir: dir, log: quiet });

describe("backfill on the emulator", () => {
    it("a dry run changes nothing and says what it would do", async () => {
        const before = await raw(env, "/");
        const result = await backfill(as(env, "owner1"), OWNER, false);
        assert.equal(result.applied, false);
        assert.deepEqual(await raw(env, "/"), before);
        assert.deepEqual(result.plan.counts, { backfill: 2, skipped: 1 });
    });

    it("apply: every material with stock gets one opening movement, the quantity does not change", async () => {
        const result = await backfill(as(env, "owner1"), OWNER, true);
        assert.equal(result.verified, true, JSON.stringify(result.failures));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
        assert.equal((await raw(env, "materials/s1/m2")).quantity, 10);
        const movements = movementsFromObject(await raw(env, "movements/s1"));
        assert.equal(movements.length, 2);
        for (const movement of movements) {
            assert.equal(movement.type, "opening");
            assert.equal(movement.byUid, "owner1");
            assert.match(movement.note, /Opening balance/);
        }
        assert.equal(reconciles(movements.filter((m) => m.materialId === "m1"), 5), true);
        assert.equal(reconciles(movements.filter((m) => m.materialId === "m2"), 10), true);
    });

    it("an empty material and another site's material are left alone", async () => {
        await backfill(as(env, "owner1"), OWNER, true);
        assert.equal((await raw(env, "materials/s1/m3")).lastMovementId, undefined);
        assert.equal(await raw(env, "movements/s2"), null);
    });

    it("running it twice changes nothing the second time", async () => {
        await backfill(as(env, "owner1"), OWNER, true);
        const before = await raw(env, "/");
        const second = await backfill(as(env, "owner1"), OWNER, true);
        assert.deepEqual(second.plan.counts, { backfill: 0, skipped: 3 });
        assert.deepEqual(await raw(env, "/"), before);
    });

    it("a storekeeper can run it for their site", async () => {
        const result = await backfill(as(env, "keeper1"), { uid: "keeper1", email: "keeper1@example.com" }, true);
        assert.equal(result.verified, true);
    });

    it("a viewer's site is skipped, and nothing is written", async () => {
        const before = await raw(env, "/");
        const result = await backfill(as(env, "viewer1"), { uid: "viewer1", email: "viewer1@example.com" }, true);
        assert.deepEqual(result.plan.counts, { backfill: 0, skipped: 0 });
        assert.deepEqual(await raw(env, "/"), before);
    });

    it("writes the snapshot BEFORE any write, a CSV, and a progress log", async () => {
        const dir = outDir();
        await backfill(as(env, "owner1"), OWNER, true, dir);
        const files = fs.readdirSync(dir);
        const snapshot = files.find((f) => /^snapshot-.*\.json$/.test(f));
        assert.ok(snapshot);
        assert.ok(files.some((f) => /^report-.*\.csv$/.test(f)));
        assert.match(fs.readFileSync(path.join(dir, "progress.log"), "utf8"), /VERIFIED/);
        const saved = JSON.parse(fs.readFileSync(path.join(dir, snapshot), "utf8"));
        assert.equal(saved.s1.movements && Object.keys(saved.s1.movements).length, 0, "the snapshot is the state before");
        assert.equal(saved.s1.materials.m1.quantity, 5);
    });
});

describe("the rules around the backfill", () => {
    const openingFor = (db, uid, materialId, material, overrides = {}) => {
        const id = newId(db, "s1");
        return update(ref(db), {
            [`movements/s1/${id}`]: {
                materialId, materialName: material.name, units: material.units, delta: material.quantity, type: "opening",
                byUid: uid, byEmail: `${uid}@example.com`, at: SV.timestamp(), ...overrides,
            },
            [`materials/s1/${materialId}/lastMovementId`]: id,
        });
    };

    it("explaining existing stock works once", async () => {
        await assertSucceeds(openingFor(as(env, "owner1"), "owner1", "m1", MATERIAL));
    });

    it("an opening for the wrong amount is refused", async () => {
        await assertFails(openingFor(as(env, "owner1"), "owner1", "m1", MATERIAL, { delta: 6 }));
        await assertFails(openingFor(as(env, "owner1"), "owner1", "m1", MATERIAL, { delta: 4 }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("an opening that also changes the quantity is refused (no creating stock out of thin air)", async () => {
        const db = as(env, "owner1");
        const id = newId(db, "s1");
        await assertFails(update(ref(db), {
            [`movements/s1/${id}`]: {
                materialId: "m1", materialName: "Cement", units: "bags", delta: 5, type: "opening",
                byUid: "owner1", byEmail: "owner1@example.com", at: SV.timestamp(),
            },
            "materials/s1/m1/quantity": 10,
            "materials/s1/m1/lastMovementId": id,
        }));
        assert.equal((await raw(env, "materials/s1/m1")).quantity, 5);
    });

    it("a second opening is refused once the material has a movement", async () => {
        await openingFor(as(env, "owner1"), "owner1", "m1", MATERIAL);
        await assertFails(openingFor(as(env, "owner1"), "owner1", "m1", MATERIAL));
    });

    it("an opening is refused after a received/used movement has already happened", async () => {
        await receive(as(env, "keeper1"), "keeper1", "s1", "m1", MATERIAL, { type: "received", delta: 1 });
        await assertFails(openingFor(as(env, "owner1"), "owner1", "m1", { ...MATERIAL, quantity: 6 }));
    });

    it("a viewer cannot", async () => {
        await assertFails(openingFor(as(env, "viewer1"), "viewer1", "m1", MATERIAL));
    });

    it("an opening for a material with no stock is refused (delta must be positive and equal the quantity)", async () => {
        await assertFails(openingFor(as(env, "owner1"), "owner1", "m3", { name: "Empty", units: "bags", quantity: 0 }));
    });
});
