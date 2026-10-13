// Exercises the REAL src/data.js with the Firebase SDK replaced by a recording stub.
// The E2E suite swaps data.js for a fake, so this file is what proves the production
// module asks Firebase for the right operations.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/sdk-loader.mjs", import.meta.url);
const data = await import("../../src/data.js");
const sdk = globalThis.__sdk;

const calls = (name) => sdk.calls.filter((c) => c.name === name);
const initCalls = [...calls("initializeApp")];

beforeEach(() => {
    sdk.calls.length = 0;
    sdk.listeners.length = 0;
    sdk.getValue = null;
    sdk.hangGet = false;
});

const materialsBySite = (siteId) => ({
    kind: "query",
    base: { kind: "ref", path: "materials" },
    constraints: [
        { constraint: "orderByChild", field: "siteId" },
        { constraint: "equalTo", value: siteId },
    ],
});

test("the database URL is the one the app has always used", () => {
    assert.equal(initCalls.length, 1);
    assert.deepEqual(initCalls[0].args[0], {
        databaseURL: "https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/",
    });
});

test("B4: deleteSiteCascade reads the site's materials, then makes exactly one update and no removes", async () => {
    sdk.getValue = {
        m1: { siteId: "A", name: "Cement" },
        m2: { siteId: "A", name: "Sand" },
        m3: { siteId: "B", name: "Nails" },
    };
    await data.deleteSiteCascade("A");

    assert.deepEqual(calls("get").map((c) => c.args[0]), [materialsBySite("A")]);
    assert.equal(calls("remove").length, 0, "no separate remove() calls");
    const updates = calls("update");
    assert.equal(updates.length, 1, "exactly one update()");
    assert.deepEqual(updates[0].args[0], { kind: "ref", path: "" }, "update is applied at the database root");
    assert.deepEqual(updates[0].args[1], {
        "sites/A": null,
        "materials/m1": null,
        "materials/m2": null,
    });
});

test("B4: deleteSiteCascade on a site with no materials still removes the site in one update", async () => {
    sdk.getValue = null;
    await data.deleteSiteCascade("A");
    assert.deepEqual(calls("update").map((c) => c.args[1]), [{ "sites/A": null }]);
});

test("B4: with no signal deleteSiteCascade gives up with a clear message and writes nothing", async () => {
    sdk.hangGet = true;
    await assert.rejects(
        data.deleteSiteCascade("A", { timeoutMs: 20 }),
        { message: data.OFFLINE_MESSAGE },
    );
    assert.equal(calls("update").length, 0, "a half-known delete must not be sent");
    assert.equal(calls("remove").length, 0);
});

test("subscribe functions hand the error callback to the SDK so permission errors are reported", () => {
    const onError = () => {};
    data.subscribeSites(() => {}, onError);
    data.subscribeMaterials("A", () => {}, onError);
    assert.equal(sdk.listeners.length, 2);
    assert.ok(sdk.listeners.every((l) => l.onError === onError));
});

test("B3: subscribeMaterials queries one site and returns the SDK's unsubscribe function", () => {
    const seen = [];
    const unsubscribe = data.subscribeMaterials("A", (m) => seen.push(m), () => {});

    assert.deepEqual(calls("onValue").map((c) => c.args[0]), [materialsBySite("A")]);
    unsubscribe();
    assert.equal(calls("unsubscribe").length, 1);

    sdk.listeners[0].onData({ val: () => ({ m1: { name: "Cement" } }) });
    sdk.listeners[0].onData({ val: () => null });
    assert.deepEqual(seen, [{ m1: { name: "Cement" } }, {}], "null snapshots become {}");
});

test("subscribeSites listens on /sites and turns a null snapshot into {}", () => {
    const seen = [];
    data.subscribeSites((s) => seen.push(s), () => {});
    assert.deepEqual(calls("onValue").map((c) => c.args[0]), [{ kind: "ref", path: "sites" }]);
    sdk.listeners[0].onData({ val: () => null });
    assert.deepEqual(seen, [{}]);
});

test("addSite and addMaterial push to their collections and hand back the new key", async () => {
    const site = data.addSite({ name: "Mombasa" });
    const material = data.addMaterial({ name: "Cement", quantity: 5, siteId: "A" });

    assert.deepEqual(calls("push").map((c) => [c.args[0].path, c.args[1]]), [
        ["sites", { name: "Mombasa" }],
        ["materials", { name: "Cement", quantity: 5, siteId: "A" }],
    ]);
    assert.match(site.id, /^-Nstub/);
    assert.match(material.id, /^-Nstub/);
    await site.done;
    await material.done;
    assert.equal(typeof site.done.catch, "function");
});

test("B1: updateMaterial writes only the given fields to that material's path", async () => {
    await data.updateMaterial("m1", { quantity: 8 });
    assert.deepEqual(calls("update").map((c) => [c.args[0].path, c.args[1]]), [
        ["materials/m1", { quantity: 8 }],
    ]);
});

test("removeMaterial removes exactly that material", async () => {
    await data.removeMaterial("m1");
    assert.deepEqual(calls("remove").map((c) => c.args[0].path), ["materials/m1"]);
});

test("restoreMaterial writes the whole material back at its original key (Undo)", async () => {
    const material = { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "A" };
    await data.restoreMaterial("m1", material);
    assert.equal(calls("set").length, 1);
    assert.equal(calls("set")[0].args[0].path, "materials/m1");
    assert.deepEqual(calls("set")[0].args[1], material);
    assert.equal(calls("update").length, 0);
    assert.equal(calls("push").length, 0);
});
