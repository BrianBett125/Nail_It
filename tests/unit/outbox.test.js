// Phase 7: the durable queue itself, with no browser and no Firebase anywhere.
//
// This is the file that holds src/outbox.js to its promises: a movement is on the device before the
// database is asked, it leaves as soon as the server confirms it, a movement the server refuses is
// dropped rather than promised forever, and one that already landed is never sent a second time. That
// last one is the whole reason the queue is safe: the increment on the material is not idempotent, so
// sending a landed movement again would count the same stock twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutbox, OUTBOX_KEY } from "../../src/outbox.js";

const AT = 1714521600000; // the moment the reading was made, which a replay is stamped with
const ENTRY = {
    siteId: "sA",
    materialId: "m1",
    movementId: "mf1",
    movement: { type: "used", delta: -3 },
    material: { name: "Cement", units: "bags" },
    user: { uid: "u1", email: "foreman@example.com" },
    at: AT,
};
const entry = (over) => ({ ...ENTRY, ...over });

// A storage stand-in that behaves like localStorage, plus the two things a test needs to look at:
// what is really in there, and what the queue stored when it wrote.
function fakeStorage(initial) {
    const map = new Map(initial === undefined ? [] : [[OUTBOX_KEY, initial]]);
    return {
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => {
            map.set(key, String(value));
        },
        entries: () => JSON.parse(map.get(OUTBOX_KEY) || "[]"),
    };
}

const refusal = () => Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" });

// Wraps the two things data.js hands in, and records the order of everything that happened.
function harness({
    landedValue = false,
    landedError = null,
    writeError = null,
    throwOnWrite = false,
    storage = fakeStorage(),
} = {}) {
    const seen = [];
    const box = createOutbox({
        storage,
        write: (item, { replay }) => {
            seen.push({ what: "write", movementId: item.movementId, replay, at: item.at });
            if (throwOnWrite) {
                throw new Error("boom");
            }
            return writeError ? Promise.reject(writeError) : Promise.resolve();
        },
        landed: (item) => {
            seen.push({ what: "landed", movementId: item.movementId });
            if (landedError) {
                return Promise.reject(landedError);
            }
            return Promise.resolve(landedValue);
        },
    });
    return { box, seen, storage };
}

const writes = (seen) => seen.filter((step) => step.what === "write");

// ---- recording ------------------------------------------------------------------------

test("a movement is on the device before the database is asked, and gone once the server confirms it", async () => {
    const storage = fakeStorage();
    const { box, seen } = harness({ storage });

    const { id, done } = box.record(entry());
    assert.equal(id, "mf1");
    // The write has not even been given a chance to run, and the movement is already durable: that is
    // the ordering the whole module exists for.
    assert.deepEqual(storage.entries(), [entry()]);
    assert.equal(box.count(), 1);
    await done;

    assert.deepEqual(
        writes(seen).map((w) => w.replay),
        [false],
        "the first send is not a replay",
    );
    assert.deepEqual(storage.entries(), [], "the confirmation cleared it");
    assert.equal(box.count(), 0);
});

test("a movement that could not be sent stays on the device, and a reload finds it", async () => {
    const storage = fakeStorage();
    const { box } = harness({ storage, writeError: new Error("network unreachable") });

    await assert.rejects(box.record(entry()).done, (error) => {
        assert.equal(error.message, "network unreachable");
        assert.equal(error.queued, true, "the caller is told the movement is still here");
        return true;
    });

    // What a reload sees: a brand new queue over the same storage.
    const afterReload = harness({ storage });
    assert.equal(afterReload.box.count(), 1);
    assert.deepEqual(afterReload.box.pending(), [entry()]);
});

test("a movement the database will never take is dropped, and the caller is told it is not waiting", async () => {
    const storage = fakeStorage();
    const { box } = harness({ storage, writeError: refusal() });

    await assert.rejects(box.record(entry()).done, (error) => {
        assert.equal(error.code, "PERMISSION_DENIED", "the code is passed through");
        assert.equal(error.queued, false, "keeping it would mean a queue that never drains");
        return true;
    });
    assert.deepEqual(storage.entries(), []);
    assert.equal(box.count(), 0);
});

test("a write that throws straight away is a failed write like any other", async () => {
    const { box } = harness({ throwOnWrite: true });
    await assert.rejects(box.record(entry()).done, (error) => {
        assert.equal(error.message, "boom");
        assert.equal(error.queued, true);
        return true;
    });
    assert.equal(box.count(), 1);
});

test("with site data blocked the queue still works for this page, and says the movement is not safe", async () => {
    const blocked = {
        getItem: () => {
            throw new Error("blocked");
        },
        setItem: () => {
            throw new Error("blocked");
        },
    };
    const landed = harness({ storage: blocked });
    await landed.box.record(entry()).done;
    assert.equal(
        landed.box.count(),
        0,
        "a confirmed movement is gone even with nowhere to keep it",
    );

    const failed = harness({ storage: blocked, writeError: new Error("no signal") });
    await assert.rejects(failed.box.record(entry()).done, (error) => {
        // Nothing on disk means it does not survive a reload, so promising it would be a lie.
        assert.equal(error.queued, false);
        return true;
    });
});

test("no storage at all is not a crash: writes still go, and nothing is promised", async () => {
    const { box } = harness({ storage: null, writeError: new Error("no signal") });
    await assert.rejects(box.record(entry()).done, { queued: false });
    assert.equal(box.count(), 1, "still held for as long as this page lives");
});

test("a queue that cannot be read starts empty rather than refusing to work", async () => {
    const { box } = harness({ storage: fakeStorage("{not json at all") });
    assert.equal(box.count(), 0);
    await box.record(entry()).done;
    assert.equal(box.count(), 0);
});

test("junk in the queue is dropped rather than sent to the database", async () => {
    const storage = fakeStorage(
        JSON.stringify([
            entry(),
            null,
            "a string",
            { movementId: "mf2" }, // half an entry
            entry({ movementId: "mf3", movement: { type: "used" } }), // no delta
            entry({ movementId: "mf4", at: "yesterday" }),
        ]),
    );
    const { box } = harness({ storage });
    assert.deepEqual(
        box.pending().map((item) => item.movementId),
        ["mf1"],
    );
});

// ---- replaying ------------------------------------------------------------------------

test("replay sends what is queued, oldest first, and empties the queue", async () => {
    const storage = fakeStorage(
        JSON.stringify([
            entry(),
            entry({ movementId: "mf2", movement: { type: "received", delta: 4 } }),
        ]),
    );
    const { box, seen } = harness({ storage });

    const result = await box.replay();
    assert.deepEqual(result, { sent: 2, landed: 0, refused: 0, stopped: false });
    assert.deepEqual(
        writes(seen).map((w) => w.movementId),
        ["mf1", "mf2"],
    );
    assert.ok(
        writes(seen).every((w) => w.replay === true),
        "a replay says so, so it can be stamped with when it happened",
    );
    assert.deepEqual(storage.entries(), []);
});

test("a movement that already landed is dropped without being sent: the stock is never counted twice", async () => {
    const storage = fakeStorage(JSON.stringify([entry()]));
    const { box, seen } = harness({ storage, landedValue: true });

    const result = await box.replay();
    assert.deepEqual(result, { sent: 0, landed: 1, refused: 0, stopped: false });
    assert.deepEqual(writes(seen), [], "the increment must not go up a second time");
    assert.equal(box.count(), 0, "and the queue is clean");
});

test("with no signal the replay stops at the first movement and keeps everything for the next try", async () => {
    const storage = fakeStorage(JSON.stringify([entry(), entry({ movementId: "mf2" })]));
    const { box, seen } = harness({ storage, landedError: new Error("no signal") });

    const result = await box.replay();
    assert.deepEqual(result, { sent: 0, landed: 0, refused: 0, stopped: true });
    assert.deepEqual(writes(seen), []);
    assert.deepEqual(
        box.pending().map((item) => item.movementId),
        ["mf1", "mf2"],
    );
    assert.equal(storage.entries().length, 2, "still durable");
});

test("a write with no signal stops the replay instead of pushing on through the queue", async () => {
    const storage = fakeStorage(JSON.stringify([entry(), entry({ movementId: "mf2" })]));
    const { box, seen } = harness({ storage, writeError: new Error("network unreachable") });

    const result = await box.replay();
    assert.equal(result.stopped, true);
    assert.deepEqual(
        writes(seen).map((w) => w.movementId),
        ["mf1"],
        "the second is not attempted",
    );
    assert.equal(box.count(), 2);
});

test("a movement the database refuses during a replay is dropped, and reported once to whoever is listening", async () => {
    const storage = fakeStorage(JSON.stringify([entry(), entry({ movementId: "mf2" })]));
    const { box } = harness({ storage, writeError: refusal() });
    const reports = [];
    box.subscribe((report) => reports.push(report));

    const result = await box.replay();
    assert.deepEqual(result, { sent: 0, landed: 0, refused: 2, stopped: false });
    assert.equal(box.count(), 0, "a refusal must not leave a queue that never drains");
    // Nobody else will ever hear about these: the movement is gone, so this report is the only notice.
    assert.deepEqual(
        reports.filter((r) => r.refused.length).map((r) => r.refused),
        [
            [{ movementId: "mf1", message: "PERMISSION_DENIED" }],
            [{ movementId: "mf2", message: "PERMISSION_DENIED" }],
        ],
    );
});

// ---- more than one context on the same device ------------------------------------------
// A browser tab and the installed app window share one localStorage. These two cover what happens
// when both are recording: neither may overwrite the other's queued reading, and a movement one sends
// must not be reported to the other as a refusal just because it landed while the other was trying.

test("a movement queued in one context is not lost when another context records over the same storage", async () => {
    const storage = fakeStorage();
    const offline = new Error("network unreachable");
    const tab = harness({ storage, writeError: offline });
    const app = harness({ storage, writeError: offline }); // both start with the empty queue they read

    await assert.rejects(tab.box.record(entry()).done);
    await assert.rejects(app.box.record(entry({ movementId: "mf2" })).done);

    // Without folding what is already on the device in before writing, the second context's copy of the
    // list would replace the first's and mf1 would vanish, while its tab still showed it waiting.
    assert.deepEqual(
        storage.entries().map((item) => item.movementId),
        ["mf1", "mf2"],
    );
    assert.equal(app.box.count(), 2, "the second context sees both once it has written");
});

test("a replay refused because the movement just landed elsewhere is treated as sent, not reported", async () => {
    const storage = fakeStorage(JSON.stringify([entry()]));
    const attempts = [];
    let reads = 0;
    const box = createOutbox({
        storage,
        write: () => {
            attempts.push("write");
            return Promise.reject(refusal());
        },
        landed: () => {
            reads += 1;
            return Promise.resolve(reads > 1); // not there when checked, there once the race is lost
        },
    });
    const reports = [];
    box.subscribe((report) => reports.push(report));

    const result = await box.replay();
    assert.deepEqual(result, { sent: 0, landed: 1, refused: 0, stopped: false });
    assert.deepEqual(attempts, ["write"], "the write was still attempted");
    assert.deepEqual(storage.entries(), [], "the queue is clean");
    assert.deepEqual(
        reports.flatMap((report) => report.refused),
        [],
        "nobody is told to record it again: that would count the stock twice",
    );
});

test("two callers replaying at once send each movement once", async () => {
    const storage = fakeStorage(JSON.stringify([entry()]));
    const { box, seen } = harness({ storage });

    const first = box.replay();
    const second = box.replay();
    assert.equal(
        first,
        second,
        "the second caller waits on the first send rather than starting its own",
    );
    await Promise.all([first, second]);
    assert.equal(writes(seen).length, 1);
});

test("a replay with nothing queued asks the database for nothing", async () => {
    const { box, seen } = harness({ storage: fakeStorage() });
    assert.deepEqual(await box.replay(), { sent: 0, landed: 0, refused: 0, stopped: false });
    assert.deepEqual(seen, [], "no read, no write");
});

test("after a replay finishes the next one starts afresh rather than reusing the finished promise", async () => {
    const storage = fakeStorage(JSON.stringify([entry()]));
    const { box } = harness({ storage });
    await box.replay();
    const second = box.replay();
    assert.deepEqual(await second, { sent: 0, landed: 0, refused: 0, stopped: false });
});

// ---- what the page is told --------------------------------------------------------------

test("the count changes as the queue does, and an unsubscribed listener hears nothing more", async () => {
    const storage = fakeStorage();
    const { box } = harness({ storage, writeError: new Error("no signal") });
    const reports = [];
    const stop = box.subscribe((report) => reports.push(report));

    await assert.rejects(box.record(entry()).done);
    assert.deepEqual(reports, [{ pending: 1, refused: [] }]);

    stop();
    await assert.rejects(box.record(entry({ movementId: "mf2" })).done);
    assert.equal(reports.length, 1);
});

test("pending() hands out copies: a caller cannot reach in and change the queue", async () => {
    const storage = fakeStorage(JSON.stringify([entry()]));
    const { box } = harness({ storage });
    const pending = box.pending();
    pending[0].movementId = "tampered";
    assert.equal(box.count(), 1);
    assert.equal((await box.replay()).sent, 1, "the real entry, not the copy, went up");
});
