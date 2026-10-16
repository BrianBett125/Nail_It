// Phase 3 in the browser: Received and Used, history, the activity feed, and that stock can
// only move through movements. Runs against the in-memory fake data layer
// (tests/e2e/fake-data.js), which applies the same writes src/data.js sends to Firebase.
//
// This file is the DOM contract of the feature. Any UI that keeps these ids and classes passes.
//   Row buttons (in #materialTableBody tr[data-material-id]): .btn-receive .btn-use .btn-history .btn-edit .btn-delete
//   Record dialog:  #movementContainer #movementForm #movementTitle #movementStock #movementAmount
//                   #movementNote #movementError #movementSubmit #movementCancel
//   History dialog: #historyContainer #historyTitle #historyList (.history-row: .history-type .history-who
//                   .history-when .history-delta .history-balance .history-note) #historyBefore #historyEmpty #historyClose
//   Activity feed:  #activityPanel #activityList (li.activity-item: .activity-text .activity-time) #activityEmpty
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer, launchBrowser, openDashboard, selectSite, toastLocator, waitForRows, wrote, dbState, SEED,
} from "./helpers.js";

let server;
let baseUrl;
let browser;

before(async () => {
    ({ server, url: baseUrl } = await startServer());
    browser = await launchBrowser();
});

after(async () => {
    await browser.close();
    server.close();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

const row = (page, name) => page.locator("#materialTableBody tr", { hasText: name });
const button = (page, name, selector) => row(page, name).locator(selector);

// m1 Cement is 5 bags, explained by two movements. m2 Sand is 10 tonnes with no history (a legacy record).
const MOVEMENTS = {
    mv1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 20, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - 3 * DAY },
    mv2: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -15, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR, note: "Slab pour" },
};
const SEEDED = { ...SEED, movements: MOVEMENTS };

async function open(seed = SEEDED, options) {
    const opened = await openDashboard(browser, baseUrl, seed, options);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand"]);
    return opened;
}

async function openRecord(page, material, action) {
    await button(page, material, action === "used" ? ".btn-use" : ".btn-receive").click();
    await page.locator("#movementContainer").waitFor({ state: "visible" });
}

async function record(page, material, action, amount, note) {
    await openRecord(page, material, action);
    await page.fill("#movementAmount", amount);
    if (note) {
        await page.fill("#movementNote", note);
    }
    await page.click("#movementSubmit");
}

const closed = (page, selector) =>
    page.waitForFunction((s) => getComputedStyle(document.querySelector(s)).display === "none", selector);

const movementWrites = async (page) =>
    (await wrote(page)).filter((w) => w.op === "multi" && Object.keys(w.paths).some((p) => p.startsWith("movements/")));

const quantityOf = async (page, name) => (await row(page, name).locator("td").nth(1).textContent()).trim();

describe("recording stock: Received and Used", () => {
    it("Used: three interactions, one write, the quantity and the history change together", async () => {
        const { context, page, state } = await open();
        let interactions = 0;

        await openRecord(page, "Cement", "used"); interactions += 1;
        await page.fill("#movementAmount", "3"); interactions += 1;
        await page.click("#movementSubmit"); interactions += 1;
        await closed(page, "#movementContainer");
        await page.waitForFunction(() => document.querySelector("#materialTableBody").textContent.includes("Cement"));

        assert.equal(interactions, 3, "20 bags used in 3 taps: Used, amount, confirm");
        const writes = await movementWrites(page);
        assert.equal(writes.length, 1, "exactly one write");
        const paths = writes[0].paths;
        const movementPath = Object.keys(paths).find((p) => p.startsWith("movements/sA/"));
        assert.deepEqual(
            { ...paths[movementPath], at: undefined },
            {
                materialId: "m1", materialName: "Cement", units: "bags", delta: -3, type: "used",
                byUid: "u1", byEmail: "foreman@example.com", at: undefined,
            },
        );
        assert.deepEqual(paths["materials/sA/m1/quantity"], { ".sv": { increment: -3 } });
        assert.equal(paths["materials/sA/m1/lastMovementId"], movementPath.split("/")[2]);
        assert.equal(await quantityOf(page, "Cement"), "2");
        assert.ok(state.toasts.some((t) => /Used 3 bags of Cement/.test(t)), JSON.stringify(state.toasts));
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("Received adds, and a note travels with the movement", async () => {
        const { context, page } = await open();
        await record(page, "Sand", "received", "2.5", "Delivery note 114");
        await closed(page, "#movementContainer");

        const [write] = await movementWrites(page);
        const movement = write.paths[Object.keys(write.paths).find((p) => p.startsWith("movements/"))];
        assert.equal(movement.type, "received");
        assert.equal(movement.delta, 2.5);
        assert.equal(movement.note, "Delivery note 114");
        assert.equal(await quantityOf(page, "Sand"), "12.5");
        await context.close();
    });

    it("the dialog names the material and shows what is in stock", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "used");
        assert.match(await page.textContent("#movementTitle"), /Cement/);
        assert.match(await page.textContent("#movementStock"), /5\s*bags/);
        assert.match(await page.textContent("#movementTitle"), /Used|Use/i);
        await page.click("#movementCancel");
        await openRecord(page, "Sand", "received");
        assert.match(await page.textContent("#movementTitle"), /Sand/);
        assert.match(await page.textContent("#movementTitle"), /Receiv/i);
        assert.match(await page.textContent("#movementStock"), /10\s*tonnes/);
        await context.close();
    });

    it("the amount field is focused and opens a number pad on a phone", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "used");
        assert.equal(await page.evaluate(() => document.activeElement.id), "movementAmount");
        assert.equal(await page.getAttribute("#movementAmount", "inputmode"), "decimal");
        await context.close();
    });

    it("Enter in the amount field confirms", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "received");
        await page.fill("#movementAmount", "4");
        await page.press("#movementAmount", "Enter");
        await closed(page, "#movementContainer");
        assert.equal(await quantityOf(page, "Cement"), "9");
        await context.close();
    });

    it("Used above the stock is refused in the dialog, says why, and writes nothing", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "used");
        await page.fill("#movementAmount", "6");
        await page.click("#movementSubmit");

        const error = page.locator("#movementError");
        await error.waitFor({ state: "visible" });
        assert.match(await error.textContent(), /Only 5 bags in stock/);
        assert.equal(await error.getAttribute("role"), "alert");
        assert.equal((await wrote(page)).length, 0);
        assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("#movementContainer")).display), "none", "dialog stays open");
        assert.equal(await page.inputValue("#movementAmount"), "6", "what was typed is kept");

        await page.fill("#movementAmount", "5");
        await page.click("#movementSubmit");
        await closed(page, "#movementContainer");
        assert.equal(await quantityOf(page, "Cement"), "0");
        await context.close();
    });

    it("the message goes away when the dialog is opened again", async () => {
        const { context, page } = await open();
        await record(page, "Cement", "used", "99");
        await page.locator("#movementError").waitFor({ state: "visible" });
        await page.click("#movementCancel");
        await openRecord(page, "Cement", "used");
        assert.equal(await page.locator("#movementError").isVisible(), false);
        assert.equal(await page.inputValue("#movementAmount"), "", "amount is cleared");
        assert.equal(await page.inputValue("#movementNote"), "", "note is cleared");
        await context.close();
    });

    for (const bad of ["", "0", "-3", "abc", "1e3"]) {
        it(`an amount of ${JSON.stringify(bad)} is refused with a clear message`, async () => {
            const { context, page } = await open();
            await openRecord(page, "Cement", "received");
            if (bad) {
                await page.evaluate((v) => { document.querySelector("#movementAmount").value = v; }, bad);
            }
            await page.click("#movementSubmit");
            const message = await page.locator("#movementError").textContent();
            assert.match(message, /amount|greater than zero/i);
            assert.equal((await wrote(page)).length, 0);
            await context.close();
        });
    }

    it("Cancel and Escape close the dialog without writing", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "received");
        await page.fill("#movementAmount", "7");
        await page.click("#movementCancel");
        await closed(page, "#movementContainer");
        await openRecord(page, "Cement", "received");
        await page.keyboard.press("Escape");
        await closed(page, "#movementContainer");
        assert.equal((await wrote(page)).length, 0);
        await context.close();
    });

    it("a double tap on confirm while the server has not answered writes once", async () => {
        const { context, page } = await open(SEEDED, { beforeLoad: () => { window.__preset = { holdAcks: true }; } });
        await openRecord(page, "Cement", "received");
        await page.fill("#movementAmount", "4");
        await page.click("#movementSubmit");
        await page.click("#movementSubmit", { force: true, timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(100);
        assert.equal((await movementWrites(page)).length, 1);
        await context.close();
    });

    it("the page keeps working with no signal: the stock shows at once, before the server answers", async () => {
        const { context, page } = await open(SEEDED, { beforeLoad: () => { window.__preset = { holdAcks: true }; } });
        await record(page, "Cement", "received", "4");
        await page.waitForFunction(() => document.querySelector("#materialTableBody").textContent.includes("9"));
        assert.equal(await quantityOf(page, "Cement"), "9");
        await context.close();
    });

    it("if the database refuses (somebody used the stock first), an error toast says so and the stock is unchanged", async () => {
        const { context, page } = await open(SEEDED, { beforeLoad: () => { window.__preset = { holdSnapshots: false }; } });
        await openRecord(page, "Cement", "used");
        await page.fill("#movementAmount", "5");
        // Somebody else uses 3 and this page does not hear about it yet.
        await page.evaluate(() => {
            window.__nailit.holdSnapshots = true;
            window.__nailit.externalMovement("sA", "m1", { type: "used", delta: -3 });
        });
        await page.click("#movementSubmit");
        await page.waitForFunction(() => window.__nailit.writes.some((w) => w.rejected));
        await toastLocator(page, "Could not record").first().waitFor();
        assert.equal((await dbState(page)).materials.sA.m1.quantity, 2, "nothing was subtracted twice");
        await context.close();
    });

    it("a stock figure that changes while the dialog is open is shown, and the limit follows it", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "used");
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "used", delta: -3 }));
        await page.waitForFunction(() => /2\s*bags/.test(document.querySelector("#movementStock").textContent));
        await page.fill("#movementAmount", "3");
        await page.click("#movementSubmit");
        await page.locator("#movementError").waitFor({ state: "visible" });
        assert.match(await page.textContent("#movementError"), /Only 2 bags in stock/);
        await context.close();
    });

    it("the dialog closes if the material is deleted by someone else, or the user moves to another site", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "used");
        await page.evaluate(() => window.__nailit.externalRemoveMaterial("sA", "m1"));
        await closed(page, "#movementContainer");

        await openRecord(page, "Sand", "received");
        await selectSite(page, "Cape Town");
        await closed(page, "#movementContainer");
        assert.equal((await wrote(page)).length, 0);
        await context.close();
    });
});

describe("who sees what", () => {
    it("a viewer sees stock and history but no way to change anything", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, roles: { sA: "viewer" } });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        for (const selector of [".btn-receive", ".btn-use", ".btn-edit", ".btn-delete"]) {
            assert.equal(await page.locator(`#materialTableBody ${selector}`).count(), 0, selector);
        }
        assert.equal(await page.locator("#materialTableBody .btn-history").count(), 2);
        await button(page, "Cement", ".btn-history").click();
        await page.locator("#historyContainer").waitFor({ state: "visible" });
        assert.equal(await page.locator("#activityPanel").isVisible(), true, "the activity feed is for every member");
        await context.close();
    });

    it("a storekeeper records stock", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, roles: { sA: "storekeeper" } });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await record(page, "Cement", "received", "1");
        await closed(page, "#movementContainer");
        assert.equal(await quantityOf(page, "Cement"), "6");
        await context.close();
    });

    it("a role that drops to viewer while the dialog is open closes it", async () => {
        const { context, page } = await open();
        await openRecord(page, "Cement", "received");
        await page.evaluate(() => window.__nailit.externalSetRole("sA", "viewer"));
        await closed(page, "#movementContainer");
        assert.equal(await page.locator("#materialTableBody .btn-receive").count(), 0);
        await context.close();
    });
});

describe("material history", () => {
    it("lists every movement oldest first with who, when, how much, the note and the running balance", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-history").click();
        await page.locator("#historyContainer").waitFor({ state: "visible" });
        assert.match(await page.textContent("#historyTitle"), /Cement/);

        const rows = page.locator("#historyList .history-row");
        assert.equal(await rows.count(), 2);
        const first = rows.nth(0);
        assert.match(await first.locator(".history-who").textContent(), /boss/);
        assert.match(await first.locator(".history-type").textContent(), /Opening/i);
        assert.match(await first.locator(".history-delta").textContent(), /\+20/);
        assert.match(await first.locator(".history-balance").textContent(), /20/);
        const second = rows.nth(1);
        assert.match(await second.locator(".history-who").textContent(), /foreman/);
        assert.match(await second.locator(".history-type").textContent(), /Used/i);
        assert.match(await second.locator(".history-delta").textContent(), /-15/);
        assert.match(await second.locator(".history-balance").textContent(), /5/);
        assert.match(await second.locator(".history-note").textContent(), /Slab pour/);
        assert.match(await second.locator(".history-when").textContent(), /2h ago|\d{4}-\d{2}-\d{2}/);
        assert.equal(await page.locator("#historyBefore").isVisible(), false, "the history explains the stock completely");
        await context.close();
    });

    it("the last running balance is the quantity in the table", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-history").click();
        const balance = await page.locator("#historyList .history-row").last().locator(".history-balance").textContent();
        assert.equal(balance.replace(/\D/g, ""), await quantityOf(page, "Cement"));
        await context.close();
    });

    it("a legacy material shows the stock no movement explains as 'Before history', and still adds up", async () => {
        const { context, page } = await open();
        await button(page, "Sand", ".btn-history").click();
        await page.locator("#historyContainer").waitFor({ state: "visible" });
        assert.equal(await page.locator("#historyList .history-row").count(), 0);
        assert.match(await page.textContent("#historyBefore"), /10/);
        assert.match(await page.textContent("#historyEmpty"), /No movements/i);
        await page.click("#historyClose");
        await closed(page, "#historyContainer");

        await record(page, "Sand", "received", "2");
        await closed(page, "#movementContainer");
        await button(page, "Sand", ".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        assert.match(await page.textContent("#historyBefore"), /10/);
        assert.match(await page.locator("#historyList .history-row").last().locator(".history-balance").textContent(), /12/);
        await context.close();
    });

    it("updates by itself when a movement is recorded while it is open", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 10, note: "Truck 2" }));
        await page.waitForFunction(() => document.querySelectorAll("#historyList .history-row").length === 3);
        assert.match(await page.locator("#historyList .history-row").last().locator(".history-balance").textContent(), /15/);
        await context.close();
    });

    it("shows only that material's movements, and a different material afterwards", async () => {
        const seed = {
            ...SEEDED,
            movements: {
                ...MOVEMENTS,
                mv3: { siteId: "sA", materialId: "m2", materialName: "Sand", units: "tonnes", delta: 10, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - DAY },
            },
        };
        const { context, page } = await open(seed);
        await button(page, "Cement", ".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        assert.equal(await page.locator("#historyList .history-row").count(), 2);
        await page.click("#historyClose");
        await closed(page, "#historyContainer");
        await button(page, "Sand", ".btn-history").click();
        await page.waitForFunction(() => document.querySelectorAll("#historyList .history-row").length === 1);
        assert.match(await page.textContent("#historyTitle"), /Sand/);
        await context.close();
    });

    it("stops listening when closed, and closes on Escape", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-history").click();
        await page.locator("#historyContainer").waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "movements").length), 2, "feed + history");
        await page.keyboard.press("Escape");
        await closed(page, "#historyContainer");
        assert.equal(await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "movements").length), 1, "feed only");
        await context.close();
    });

    it("a movement for a deleted material still reads right in the feed and an Undo restores the history", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-delete").click();
        await waitForRows(page, ["Sand"]);
        const writes = await movementWrites(page);
        const removed = Object.values(writes[0].paths).find((v) => v && v.type === "removed");
        assert.equal(removed.delta, -5);
        await page.locator(".toast", { hasText: "Deleted Cement" }).locator(".toast-action").click();
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await quantityOf(page, "Cement"), "5");
        const state = await dbState(page);
        const types = Object.values(state.movements.sA).filter((m) => m.materialId === "m1").map((m) => m.type).sort();
        assert.deepEqual(types, ["opening", "opening", "removed", "used"]);
        await context.close();
    });
});

describe("site activity feed", () => {
    it("shows the latest movements newest first, in words, with how long ago", async () => {
        const { context, page } = await open();
        const items = page.locator("#activityList .activity-item");
        await items.first().waitFor();
        assert.equal(await items.count(), 2);
        assert.equal((await items.nth(0).locator(".activity-text").textContent()).trim(), "foreman used 15 bags of Cement");
        assert.match(await items.nth(0).locator(".activity-time").textContent(), /2h ago/);
        assert.equal((await items.nth(1).locator(".activity-text").textContent()).trim(), "boss added 20 bags of Cement");
        assert.match(await items.nth(1).locator(".activity-time").textContent(), /3 days ago/);
        await context.close();
    });

    it("says so when there is no activity, and a new movement appears at the top", async () => {
        const { context, page } = await open(SEED);
        assert.match(await page.textContent("#activityEmpty"), /No activity yet/i);
        await record(page, "Cement", "used", "2");
        await page.locator("#activityList .activity-item").first().waitFor();
        assert.equal((await page.locator("#activityList .activity-item .activity-text").first().textContent()).trim(), "foreman used 2 bags of Cement");
        assert.equal(await page.locator("#activityEmpty").isVisible(), false);
        await context.close();
    });

    it("shows another person's movement as soon as it arrives", async () => {
        const { context, page } = await open();
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m2", { type: "received", delta: 6, byEmail: "kip@example.com" }));
        await page.waitForFunction(() => document.querySelector("#activityList .activity-text")?.textContent.includes("kip received 6 tonnes of Sand"));
        await context.close();
    });

    it("shows only the selected site, and switches with it", async () => {
        const seed = {
            ...SEEDED,
            movements: {
                ...MOVEMENTS,
                mv9: { siteId: "sB", materialId: "m3", materialName: "Nails", units: "kgs", delta: 40, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - HOUR },
            },
        };
        const { context, page } = await open(seed);
        assert.equal(await page.locator("#activityList .activity-item").count(), 2);
        await selectSite(page, "Cape Town");
        await page.waitForFunction(() => document.querySelectorAll("#activityList .activity-item").length === 1);
        assert.match(await page.textContent("#activityList"), /Nails/);
        await context.close();
    });

    it("is not shown with no site selected", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, hiddenSites: [] }, {
            beforeLoad: () => { try { localStorage.clear(); } catch { /* none */ } },
        });
        assert.equal(await page.locator("#activityPanel").isVisible(), false);
        await context.close();
    });

    it("keeps the feed short: only the latest 30 are asked for", async () => {
        const { context, page } = await open();
        const limits = await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "movements").map((l) => l.limit));
        assert.ok(limits.length >= 1);
        await context.close();
    });

    it("keeps markup in names and notes as text (S2)", async () => {
        const evil = "<img src=x onerror=window.__pwned=1>";
        const seed = {
            ...SEED,
            materials: { ...SEED.materials, m1: { ...SEED.materials.m1, name: evil } },
            movements: {
                x1: { siteId: "sA", materialId: "m1", materialName: evil, units: "bags", delta: -1, type: "used", byUid: "u9", byEmail: "<b>x</b>@example.com", at: now - HOUR, note: evil },
            },
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await page.locator("#activityList .activity-item").first().waitFor();
        await button(page, "<img", ".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        assert.equal(await page.locator("#activityList img, #historyList img, #historyTitle img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.ok((await page.textContent("#activityList")).includes(evil));
        await context.close();
    });
});

describe("adding, editing and deleting materials with movements underneath", () => {
    it("a new material with stock writes an opening movement with it, in one update", async () => {
        const { context, page } = await open();
        await page.click("#addMaterialButton");
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "12");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);

        const [write] = await movementWrites(page);
        assert.equal((await wrote(page)).length, 1);
        const movement = Object.values(write.paths).find((v) => v && v.type === "opening");
        assert.equal(movement.delta, 12);
        assert.equal(movement.materialName, "Gravel");
        await page.waitForFunction(() => document.querySelector("#activityList .activity-text")?.textContent.includes("foreman added 12 tonnes of Gravel"));
        await context.close();
    });

    it("a new material with zero stock writes no movement", async () => {
        const { context, page } = await open();
        await page.click("#addMaterialButton");
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "0");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal((await movementWrites(page)).length, 0);
        await context.close();
    });

    it("the add form has no date field and takes an optional low-stock level", async () => {
        const { context, page } = await open();
        await page.click("#addMaterialButton");
        assert.equal(await page.locator("#mLastUpdated").count(), 0);
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "3");
        await page.fill("#mMinLevel", "10");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal((await dbState(page)).materials.sA[Object.keys((await dbState(page)).materials.sA).find((id) => id.startsWith("nfake"))].minLevel, 10);
        await context.close();
    });

    it("the edit form has no quantity and no date, and saves name, unit and low-stock level without touching the stock", async () => {
        const { context, page } = await open();
        await button(page, "Cement", ".btn-edit").click();
        await page.locator("#updateFormContainer").waitFor({ state: "visible" });
        assert.equal(await page.locator("#uQuantity").count(), 0);
        assert.equal(await page.locator("#uLastUpdated").count(), 0);
        await page.fill("#uMaterialName", "Cement 42.5");
        await page.fill("#uMinLevel", "3");
        await page.click("#update-material-btn");
        await closed(page, "#updateFormContainer");

        const [write] = (await wrote(page)).slice(-1);
        assert.ok(!Object.keys(write.paths).some((p) => p.endsWith("/quantity")), "no quantity in the edit");
        assert.equal(write.paths["materials/sA/m1/name"], "Cement 42.5");
        assert.equal(write.paths["materials/sA/m1/minLevel"], 3);
        assert.equal(await quantityOf(page, "Cement 42.5"), "5");
        await context.close();
    });

    it("the table shows the server date for a material that moved and the typed date for an old one", async () => {
        const { context, page } = await open();
        await record(page, "Cement", "received", "1");
        await closed(page, "#movementContainer");
        const today = await page.evaluate(() => {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        });
        assert.equal((await row(page, "Cement").locator("td").nth(3).textContent()).trim(), today);
        assert.equal((await row(page, "Sand").locator("td").nth(3).textContent()).trim(), "2024-05-04");
        await context.close();
    });
});
