// Exercises the REAL src/data.js with the Firebase SDK replaced by a recording stub.
// The E2E suite swaps data.js for a fake, so this file is what proves the production
// module asks Firebase for the right operations, at the right paths.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./helpers/sdk-loader.mjs", import.meta.url);
const data = await import("../../src/data.js");
const { firebaseConfig } = await import("../../src/firebase-config.js");
const sdk = globalThis.__sdk;

const calls = (name) => sdk.calls.filter((c) => c.name === name);
const initCalls = [...calls("initializeApp")];
const paths = (name) => calls(name).map((c) => c.args[0].path);
const listener = (path) => sdk.listeners.find((l) => l.target.path === path);
const snapshot = (value) => ({ val: () => value });

beforeEach(() => {
    sdk.calls.length = 0;
    sdk.listeners.length = 0;
    sdk.getValue = null;
    sdk.getValues = {};
    sdk.hangGet = false;
    sdk.setError = null;
});

test("the app points at the new project's database, and is created once", () => {
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].args[0], firebaseConfig);
    assert.equal(firebaseConfig.projectId, "nail-it-6b883");
    assert.equal(
        firebaseConfig.databaseURL,
        "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app/",
    );
    assert.equal(firebaseConfig.authDomain, "nail-it-6b883.firebaseapp.com");
});

// ---- sites -------------------------------------------------------------------------

test("B4: deleteSiteCascade reads members and invites, then makes exactly one update and no removes", async () => {
    sdk.getValues = {
        "members/A": { u1: "owner", u2: "viewer" },
        "siteInvites/A": { "sam@x,com": "viewer" },
    };
    await data.deleteSiteCascade("A");

    assert.deepEqual(paths("get").sort(), ["members/A", "siteInvites/A"]);
    assert.equal(calls("remove").length, 0, "no separate remove() calls");
    const updates = calls("update");
    assert.equal(updates.length, 1, "exactly one update()");
    assert.deepEqual(updates[0].args[0], { kind: "ref", path: "" }, "update is applied at the database root");
    assert.deepEqual(updates[0].args[1], {
        "sites/A": null,
        "materials/A": null,
        "memberInfo/A": null,
        "siteInvites/A": null,
        "members/A/u1": null,
        "userSites/u1/A": null,
        "members/A/u2": null,
        "userSites/u2/A": null,
        "userInvites/sam@x,com/A": null,
    });
});

test("B4: deleteSiteCascade of a site nobody else is in still removes everything of its own", async () => {
    sdk.getValues = { "members/A": { u1: "owner" } };
    await data.deleteSiteCascade("A");
    assert.deepEqual(Object.keys(calls("update")[0].args[1]).sort(), [
        "materials/A", "memberInfo/A", "members/A/u1", "siteInvites/A", "sites/A", "userSites/u1/A",
    ]);
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

test("addSite creates the site, the owner membership, the site list entry and the member info in one update", async () => {
    const { id, done } = data.addSite(
        { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 5 },
        { uid: "u1", email: "sam@example.com" },
    );
    await done;

    assert.match(id, /^-Nstub/);
    assert.deepEqual(calls("push").map((c) => [c.args[0].path, c.args[1]]), [["sites", undefined]], "push only makes the key");
    const updates = calls("update");
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].args[0], { kind: "ref", path: "" });
    assert.deepEqual(updates[0].args[1], {
        [`sites/${id}`]: { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 5, ownerUid: "u1" },
        [`members/${id}/u1`]: "owner",
        [`userSites/u1/${id}`]: "owner",
        [`memberInfo/${id}/u1`]: { email: "sam@example.com" },
    });
});

test("addSite takes the owner from the signed-in user, never from the site data", () => {
    const { id } = data.addSite({ name: "x", ownerUid: "attacker" }, { uid: "u1", email: "a@b.co" });
    assert.equal(calls("update")[0].args[1][`sites/${id}`].ownerUid, "u1");
});

test("subscribeSites lists /userSites/<uid>, reads each site, and merges the role in", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});

    assert.deepEqual(paths("onValue"), ["userSites/u1"]);
    listener("userSites/u1").onData(snapshot({ A: "owner", B: "viewer" }));
    assert.deepEqual(paths("onValue"), ["userSites/u1", "sites/A", "sites/B"]);
    assert.deepEqual(seen, [], "nothing is shown until every listed site has been read");

    listener("sites/A").onData(snapshot({ name: "Mombasa" }));
    assert.deepEqual(seen, []);
    listener("sites/B").onData(snapshot({ name: "Cape Town" }));
    assert.deepEqual(seen, [{
        A: { name: "Mombasa", role: "owner" },
        B: { name: "Cape Town", role: "viewer" },
    }]);
});

test("subscribeSites with no sites reports {} at once, and a null snapshot is the same", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});
    listener("userSites/u1").onData(snapshot(null));
    assert.deepEqual(seen, [{}]);
    assert.deepEqual(paths("onValue"), ["userSites/u1"], "no site listeners");
});

test("subscribeSites drops a site that leaves the list and stops listening to it", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});
    listener("userSites/u1").onData(snapshot({ A: "owner", B: "viewer" }));
    listener("sites/A").onData(snapshot({ name: "Mombasa" }));
    listener("sites/B").onData(snapshot({ name: "Cape Town" }));
    seen.length = 0;
    const before = calls("unsubscribe").length;

    listener("userSites/u1").onData(snapshot({ A: "owner" }));
    assert.equal(calls("unsubscribe").length, before + 1, "the listener for B is removed");
    assert.deepEqual(seen, [{ A: { name: "Mombasa", role: "owner" } }]);
});

test("subscribeSites shows a role change without re-reading the site", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});
    listener("userSites/u1").onData(snapshot({ A: "viewer" }));
    listener("sites/A").onData(snapshot({ name: "Mombasa" }));
    seen.length = 0;
    const listening = paths("onValue").length;

    listener("userSites/u1").onData(snapshot({ A: "storekeeper" }));
    assert.equal(paths("onValue").length, listening, "no new listener");
    assert.deepEqual(seen, [{ A: { name: "Mombasa", role: "storekeeper" } }]);
});

test("subscribeSites leaves out a listed site that cannot be read, and shows the rest", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});
    listener("userSites/u1").onData(snapshot({ A: "owner", B: "viewer" }));
    listener("sites/A").onData(snapshot({ name: "Mombasa" }));
    listener("sites/B").onError(new Error("permission_denied"));
    assert.deepEqual(seen, [{ A: { name: "Mombasa", role: "owner" } }]);
});

test("subscribeSites leaves out a listed site that has no data (deleted)", () => {
    const seen = [];
    data.subscribeSites("u1", (sites) => seen.push(sites), () => {});
    listener("userSites/u1").onData(snapshot({ A: "owner" }));
    listener("sites/A").onData(snapshot(null));
    assert.deepEqual(seen, [{}]);
});

test("subscribeSites unsubscribe stops the list and every site", () => {
    const stop = data.subscribeSites("u1", () => {}, () => {});
    listener("userSites/u1").onData(snapshot({ A: "owner", B: "viewer" }));
    const before = calls("unsubscribe").length;
    stop();
    assert.equal(calls("unsubscribe").length - before, 3);
});

test("subscribeSites hands the error callback to the SDK so permission errors are reported", () => {
    const onError = () => {};
    data.subscribeSites("u1", () => {}, onError);
    assert.equal(listener("userSites/u1").onError, onError);
});

// ---- materials ---------------------------------------------------------------------

test("B3: subscribeMaterials listens on one site's node and returns the SDK's unsubscribe function", () => {
    const seen = [];
    const onError = () => {};
    const unsubscribe = data.subscribeMaterials("A", (m) => seen.push(m), onError);

    assert.deepEqual(paths("onValue"), ["materials/A"]);
    assert.equal(sdk.listeners[0].onError, onError);
    unsubscribe();
    assert.equal(calls("unsubscribe").length, 1);

    sdk.listeners[0].onData(snapshot({ m1: { name: "Cement" } }));
    sdk.listeners[0].onData(snapshot(null));
    assert.deepEqual(seen, [{ m1: { name: "Cement" } }, {}], "null snapshots become {}");
});

test("addMaterial pushes into the site's node and hands back the new key", async () => {
    const material = data.addMaterial("A", { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" });
    assert.deepEqual(calls("push").map((c) => [c.args[0].path, c.args[1]]), [
        ["materials/A", { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" }],
    ]);
    assert.match(material.id, /^-Nstub/);
    await material.done;
    assert.equal(typeof material.done.catch, "function");
});

test("B1: updateMaterial writes only the given fields to that material's path", async () => {
    await data.updateMaterial("A", "m1", { quantity: 8 });
    assert.deepEqual(calls("update").map((c) => [c.args[0].path, c.args[1]]), [
        ["materials/A/m1", { quantity: 8 }],
    ]);
});

test("removeMaterial removes exactly that material", async () => {
    await data.removeMaterial("A", "m1");
    assert.deepEqual(paths("remove"), ["materials/A/m1"]);
});

test("restoreMaterial writes the whole material back at its original key (Undo)", async () => {
    const material = { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" };
    await data.restoreMaterial("A", "m1", material);
    assert.deepEqual(paths("set"), ["materials/A/m1"]);
    assert.deepEqual(calls("set")[0].args[1], material);
    assert.equal(calls("update").length, 0);
    assert.equal(calls("push").length, 0);
});

// ---- members and invites -----------------------------------------------------------

test("subscribeMembers merges roles with emails, and shows a member without info as email null", () => {
    const seen = [];
    data.subscribeMembers("A", { withInvites: false }, (m) => seen.push(m), () => {});
    assert.deepEqual(paths("onValue"), ["members/A", "memberInfo/A"], "a non-owner never asks for invites");

    listener("members/A").onData(snapshot({ u1: "owner", u2: "viewer" }));
    assert.deepEqual(seen, [], "waits for both");
    listener("memberInfo/A").onData(snapshot({ u1: { email: "sam@example.com" } }));
    assert.deepEqual(seen, [{
        members: [
            { uid: "u1", role: "owner", email: "sam@example.com" },
            { uid: "u2", role: "viewer", email: null },
        ],
        invites: [],
    }]);
});

test("subscribeMembers for an owner also lists pending invites with decoded emails", () => {
    const seen = [];
    const stop = data.subscribeMembers("A", { withInvites: true }, (m) => seen.push(m), () => {});
    assert.deepEqual(paths("onValue"), ["members/A", "memberInfo/A", "siteInvites/A"]);
    listener("members/A").onData(snapshot({ u1: "owner" }));
    listener("memberInfo/A").onData(snapshot(null));
    listener("siteInvites/A").onData(snapshot({ "sam,w@mail,example,com": "storekeeper" }));
    assert.deepEqual(seen.at(-1).invites, [{ key: "sam,w@mail,example,com", email: "sam.w@mail.example.com", role: "storekeeper" }]);
    stop();
    assert.equal(calls("unsubscribe").length, 3);
});

test("inviteMember writes the invitee's copy and the owner's copy in one update", async () => {
    await data.inviteMember({ id: "A", name: "Mombasa" }, { email: "owner@example.com" }, { key: "sam@x,com", role: "viewer" });
    assert.equal(calls("update").length, 1);
    assert.deepEqual(calls("update")[0].args[1], {
        "userInvites/sam@x,com/A": { role: "viewer", siteName: "Mombasa", invitedBy: "owner@example.com" },
        "siteInvites/A/sam@x,com": "viewer",
    });
});

test("revokeInvite and declineInvite delete both copies", async () => {
    await data.revokeInvite("A", "k");
    await data.declineInvite("A", "k");
    for (const call of calls("update")) {
        assert.deepEqual(call.args[1], { "userInvites/k/A": null, "siteInvites/A/k": null });
    }
    assert.equal(calls("update").length, 2);
});

test("changeRole updates the membership and the user's site list together", async () => {
    await data.changeRole("A", "u2", "storekeeper");
    assert.deepEqual(calls("update").map((c) => c.args[1]), [
        { "members/A/u2": "storekeeper", "userSites/u2/A": "storekeeper" },
    ]);
});

test("removeMember (and leaving) deletes membership, site list entry and member info together", async () => {
    await data.removeMember("A", "u2");
    assert.deepEqual(calls("update").map((c) => c.args[1]), [
        { "members/A/u2": null, "userSites/u2/A": null, "memberInfo/A/u2": null },
    ]);
});

test("subscribeInvites listens on the invitee's key and turns null into {}", () => {
    const seen = [];
    data.subscribeInvites("sam@x,com", (i) => seen.push(i), () => {});
    assert.deepEqual(paths("onValue"), ["userInvites/sam@x,com"]);
    listener("userInvites/sam@x,com").onData(snapshot({ A: { role: "viewer", siteName: "Mombasa", invitedBy: "o@x.co" } }));
    listener("userInvites/sam@x,com").onData(snapshot(null));
    assert.deepEqual(seen, [{ A: { role: "viewer", siteName: "Mombasa", invitedBy: "o@x.co" } }, {}]);
});

test("acceptInvite joins and uses up the invite in one update, then records the email", async () => {
    await data.acceptInvite({ uid: "u9", email: "sam@x.com" }, "A", "sam@x,com", "storekeeper");
    assert.deepEqual(calls("update").map((c) => c.args[1]), [{
        "members/A/u9": "storekeeper",
        "userSites/u9/A": "storekeeper",
        "userInvites/sam@x,com/A": null,
        "siteInvites/A/sam@x,com": null,
    }]);
    assert.deepEqual(calls("set").map((c) => [c.args[0].path, c.args[1]]), [["memberInfo/A/u9", { email: "sam@x.com" }]]);
    const order = sdk.calls.map((c) => c.name).filter((n) => n === "update" || n === "set");
    assert.deepEqual(order, ["update", "set"], "membership first: the rules need it before the info");
});

test("acceptInvite still succeeds when only the member info could not be written", async () => {
    sdk.setError = new Error("denied");
    await assert.doesNotReject(data.acceptInvite({ uid: "u9", email: "sam@x.com" }, "A", "k", "viewer"));
});
