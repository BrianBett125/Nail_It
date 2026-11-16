// Phase 7: the durable queue behind a movement recorded with no signal.
//
// Why it exists. Firebase's browser SDK keeps an unacknowledged write in memory only: it has no disk
// persistence (its own source says "There is no persisted cache"), and unlike the mobile SDKs there is
// no enablePersistence call to turn on. Closing the tab, reloading, or the phone dying therefore loses
// the write, while the person who made it has already been told it was recorded. This file puts the
// movement somewhere that survives all three, and replays it the next time the app starts.
//
// What makes the replay safe is the database rule, not this file. database.rules.json only accepts a
// write to movements/<siteId>/<movementId> when !data.exists() && newData.exists(), and the movement
// and the increment on the material go up in ONE multi-path update. A movement that already landed is
// therefore refused whole, increment included, so replaying after an acknowledgement that never
// arrived cannot count the same stock twice. The read below notices that early and keeps the queue
// clean; it is not the thing that makes the replay safe.
//
// The shape matches the rest of src/: no DOM, no Firebase SDK, no globals. `write` and `landed` are
// handed in by src/data.js, which owns the SDK, storage is handed in by the caller and may be null
// (a private window, blocked site data), and tests/unit/outbox.test.js drives all of it with fakes.
//
// What this deliberately does not do is add the queued readings to the stock the page shows. While the
// page is open the database SDK already applies an unacknowledged write to its own local view, and
// adding these deltas on top would count the same stock twice. After a reload the SDK's view is gone
// and the figures are the server's again, which is what the banner is for: it says the reading has not
// been sent, and the numbers catch up on their own the moment it is.

export const OUTBOX_KEY = "nailit.outbox";

// A refusal is the database saying it will never take this write (the rules said no). That is a
// different thing from a write that has not arrived yet. The SDK puts it in `code`; a plain Error's
// message is read as well, because that is what the E2E fake and the tests produce.
const REFUSED = /permission_denied|permission denied/i;

function isRefusal(error) {
    const code = error && (error.code || error.message);
    return REFUSED.test(String(code || ""));
}

// The error is passed through unchanged in everything a caller reads (the message, the code), with one
// thing added: whether the movement is still on this device waiting to be sent.
function withQueued(error, queued) {
    const wrapped = new Error(error && error.message ? error.message : String(error));
    wrapped.name = (error && error.name) || "Error";
    if (error && error.code) {
        wrapped.code = error.code;
    }
    wrapped.queued = queued;
    wrapped.cause = error;
    return wrapped;
}

function isEntry(entry) {
    return Boolean(entry)
        && typeof entry.movementId === "string" && entry.movementId !== ""
        && typeof entry.siteId === "string" && entry.siteId !== ""
        && typeof entry.materialId === "string" && entry.materialId !== ""
        && typeof entry.at === "number" && Number.isFinite(entry.at)
        && Boolean(entry.movement) && typeof entry.movement.delta === "number" && Number.isFinite(entry.movement.delta)
        && typeof entry.movement.type === "string"
        && Boolean(entry.material) && typeof entry.material.name === "string" && typeof entry.material.units === "string"
        && Boolean(entry.user) && typeof entry.user.uid === "string" && typeof entry.user.email === "string";
}

// What a caller needs to send one entry back to the database: the same shape movements.js builds from,
// plus `at`, the moment the person made the reading. `at` stays in the queue and is not written into
// the movement: the database stamps `at` itself when the replay arrives (database.rules.json accepts
// no other value). Anything else in storage is somebody else's or a half-written entry, and is dropped
// rather than sent.
function parseEntry(raw) {
    return isEntry(raw) ? raw : null;
}

export function createOutbox({ storage, write, landed }) {
    let store = null;
    if (storage) {
        try {
            storage.setItem(OUTBOX_KEY, storage.getItem(OUTBOX_KEY) || "[]");
            store = storage;
        } catch {
            store = null; // blocked: the queue still works for the life of this page, nothing more
        }
    }

    let entries = read();
    let refused = [];
    const listeners = new Set();
    let replaying = null;

    function read() {
        if (!store) {
            return [];
        }
        try {
            const list = JSON.parse(store.getItem(OUTBOX_KEY) || "[]");
            return Array.isArray(list) ? list.map(parseEntry).filter(Boolean) : [];
        } catch {
            return []; // unreadable: start from empty rather than refuse to work
        }
    }

    function save() {
        if (!store) {
            return false;
        }
        try {
            store.setItem(OUTBOX_KEY, JSON.stringify(entries));
            return true;
        } catch {
            return false; // out of room, or site data turned off mid-session
        }
    }

    // localStorage is shared by every same-origin context, so a browser tab and the installed app
    // window can both be recording. Before this context writes, it folds in whatever is already on the
    // device, keyed by movementId, so a reading queued in the other context is not overwritten by this
    // one's copy of the list. Removals stay removals: the caller filters the id out after the fold, so a
    // movement that was just sent does not come back. (One the other context removed can be folded back
    // in, but the replay re-checks it with landed() and drops it, so nothing is ever sent twice.)
    function fold() {
        const onDevice = read();
        if (onDevice.length === 0) {
            return;
        }
        const byId = new Map();
        for (const entry of onDevice) {
            byId.set(entry.movementId, entry);
        }
        for (const entry of entries) {
            byId.set(entry.movementId, entry); // this context's copy wins if the id is in both
        }
        entries = [...byId.values()];
    }

    function snapshot() {
        return { pending: entries.length, refused: [...refused] };
    }

    // Told about every change to the queue: how many are waiting, and any movement the database
    // refused since the previous call. Refusals are handed over once, to whoever is listening.
    function changed() {
        const report = snapshot();
        refused = [];
        for (const listener of [...listeners]) {
            listener(report);
        }
    }

    // A movement is in the queue the moment it is written, before the database is asked, so a page that
    // is offline says "1 waiting to send" as soon as the person records something. On a page that is
    // online the entry is gone again as soon as the server answers, and the indicator ignores the
    // count while the connection is up, so nothing flashes.
    function add(entry) {
        fold();
        if (!entries.some((queuedEntry) => queuedEntry.movementId === entry.movementId)) {
            entries = [...entries, entry];
        }
        const saved = save();
        changed();
        return saved;
    }

    function remove(movementId) {
        fold();
        const left = entries.filter((entry) => entry.movementId !== movementId);
        if (left.length === entries.length) {
            return;
        }
        entries = left;
        save();
        changed();
    }

    // Received or Used. The movement is on the device before the database is asked, and stays there
    // until the server confirms it. The returned promise settles like any other write: it rejects when
    // the write failed, with `queued` saying whether the movement is still here to be sent later.
    function record(entry) {
        // On the device before the database is asked. `durable` is false when the browser refused to
        // keep it (private window, site data blocked), and then a failed write really is lost: the
        // caller is told the movement is not waiting rather than that it is safe.
        const durable = add(entry);
        let done;
        try {
            done = Promise.resolve(write(entry, { replay: false }));
        } catch (error) {
            done = Promise.reject(error); // a throw straight away is a failed write like any other
        }
        done = done
            .then(() => {
                remove(entry.movementId);
            })
            .catch((error) => {
                if (isRefusal(error)) {
                    // The database will never take this one. Keeping it would mean a queue that never
                    // drains and a message that never stops promising to sync.
                    remove(entry.movementId);
                }
                throw withQueued(error, durable && entries.some((e) => e.movementId === entry.movementId));
            });
        return { id: entry.movementId, done };
    }

    // Whether the movement is in the database, treating "cannot read it" as "not known to be there".
    async function existsNow(entry) {
        try {
            return await landed(entry);
        } catch {
            return false;
        }
    }

    // One entry: read whether it is already there, then send it if it is not. A movement that landed
    // during a write whose acknowledgement was lost is the case this handles, and dropping it here is
    // what keeps the stock from being counted twice.
    async function replayOne(entry) {
        let there;
        try {
            there = await landed(entry);
        } catch {
            return "stopped"; // the movement cannot be read: no signal. Everything stays for the next try.
        }
        if (there) {
            remove(entry.movementId);
            return "landed";
        }
        try {
            await write(entry, { replay: true });
        } catch (error) {
            if (isRefusal(error)) {
                // Two contexts can replay the same movement at once (a browser tab and the installed
                // app): both read "not there", one write wins, the other is refused because the
                // movement now exists. That is not a refusal the person should hear about, and telling
                // them to record it again would count the stock twice. Look once more: if it landed
                // while this attempt was in flight, it is sent.
                if (await existsNow(entry)) {
                    remove(entry.movementId);
                    return "landed";
                }
                refused = [...refused, { movementId: entry.movementId, message: error.message }];
                remove(entry.movementId);
                return "refused";
            }
            return "stopped"; // no signal: leave this one and the rest for the next reconnect
        }
        remove(entry.movementId);
        return "sent";
    }

    async function runReplay() {
        const result = { sent: 0, landed: 0, refused: 0, stopped: false };
        for (const entry of [...entries]) {
            const outcome = await replayOne(entry);
            if (outcome === "stopped") {
                result.stopped = true;
                break;
            }
            result[outcome] += 1;
        }
        return result;
    }

    // Sending the queue back. Two callers can ask at once (the sign-in and the connection both fire),
    // and the second must not send what the first is already sending.
    function replay() {
        if (!replaying) {
            replaying = runReplay().finally(() => {
                replaying = null;
            });
        }
        return replaying;
    }

    return {
        record,
        replay,
        pending: () => entries.map((entry) => ({ ...entry })),
        count: () => entries.length,
        snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
