// The real src/data.js reading a report's movements, with the Firebase SDK replaced by the recording stub.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/sdk-loader.mjs", import.meta.url);
const data = await import("../../src/data.js");
const sdk = globalThis.__sdk;

const calls = (name) => sdk.calls.filter((c) => c.name === name);

beforeEach(() => {
    sdk.calls.length = 0;
    sdk.getValue = null;
    sdk.getValues = {};
    sdk.hangGet = false;
});

test("fetchMovementsBetween reads the site's movements in one query on time, both ends included, oldest first", async () => {
    sdk.getValue = { z: { at: 300, delta: 1 }, y: { at: 100, delta: 2 } };
    const list = await data.fetchMovementsBetween("A", 100, 300);
    assert.equal(calls("get").length, 1);
    const target = calls("get")[0].args[0];
    assert.equal(target.base.path, "movements/A");
    assert.deepEqual(target.constraints, [
        { constraint: "orderByChild", field: "at" },
        { constraint: "startAt", value: 100 },
        { constraint: "endAt", value: 300 },
    ]);
    assert.deepEqual(list, [{ id: "y", at: 100, delta: 2 }, { id: "z", at: 300, delta: 1 }]);
});

test("fetchMovementsBetween with nothing there is an empty list, and with no signal it gives up", async () => {
    sdk.getValue = null;
    assert.deepEqual(await data.fetchMovementsBetween("A", 1, 2), []);
    sdk.hangGet = true;
    await assert.rejects(data.fetchMovementsBetween("A", 1, 2, { timeoutMs: 20 }), /Could not reach the database/);
});
