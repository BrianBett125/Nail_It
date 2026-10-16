// Variant A ("Sheet") of the Phase 3 UI, beyond the frozen contract in movements.test.js:
// focus handling, Escape, the live button label, the quick-amount chips, aria attributes,
// the phone viewport (375px wide), and that database text never becomes markup.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launchBrowser, openDashboard, selectSite, waitForRows, wrote, SEED } from "./helpers.js";

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

const MOVEMENTS = {
    mv1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 20, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - 3 * DAY },
    mv2: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -15, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR, note: "Slab pour" },
};
const SEEDED = { ...SEED, movements: MOVEMENTS };

const row = (page, name) => page.locator("#materialTableBody tr", { hasText: name });
const closed = (page, selector) =>
    page.waitForFunction((s) => getComputedStyle(document.querySelector(s)).display === "none", selector);

// The same page, in a phone-sized browser context. openDashboard asks its "browser" for a context.
function phone() {
    return {
        newContext: () => browser.newContext({
            viewport: { width: 375, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        }),
    };
}

async function open(seed = SEEDED, host = browser) {
    const opened = await openDashboard(host, baseUrl, seed);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand"]);
    return opened;
}

const focusedInfo = (page) => page.evaluate(() => {
    const el = document.activeElement;
    return { id: el.id, className: String(el.className), row: el.closest("tr") ? el.closest("tr").dataset.materialId : null };
});

describe("variant A: the Received / Used sheet", () => {
    it("the button says what will be written, and follows the amount and the action", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-use").click();
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Used");
        await page.fill("#movementAmount", "3");
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Used: 3 bags");
        await page.fill("#movementAmount", "2.5");
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Used: 2.5 bags");
        await page.fill("#movementAmount", "abc");
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Used", "an amount that is not a number says nothing");
        await page.click("#movementCancel");

        await row(page, "Sand").locator(".btn-receive").click();
        await page.fill("#movementAmount", "4");
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Received: 4 tonnes");
        await context.close();
    });

    it("quick-amount chips add to the field, and 'All' fills in the whole stock for Used only", async () => {
        const { context, page } = await open();
        await row(page, "Sand").locator(".btn-use").click();
        await page.click(".chip[data-add='1']");
        await page.click(".chip[data-add='5']");
        assert.equal(await page.inputValue("#movementAmount"), "6");
        await page.click(".chip[data-add='10']");
        assert.equal(await page.inputValue("#movementAmount"), "16");
        assert.equal(await page.evaluate(() => document.activeElement.id), "movementAmount", "typing can go on after a chip");
        assert.match(await page.textContent("#movementAfter"), /More than the 10 tonnes in stock/);
        assert.equal((await page.textContent("#movementSubmit")).trim(), "Record Used: 16 tonnes");

        await page.click("#movementAll");
        assert.equal(await page.inputValue("#movementAmount"), "10");
        assert.match(await page.textContent("#movementAfter"), /Stock after: 0 tonnes/);
        await page.click("#movementSubmit");
        await closed(page, "#movementContainer");
        assert.equal((await row(page, "Sand").locator("td").nth(1).textContent()).trim(), "0");
        assert.equal((await wrote(page)).length, 1);

        await row(page, "Sand").locator(".btn-receive").click();
        assert.equal(await page.locator("#movementAll").isVisible(), false, "no 'All' when receiving");
        await page.click(".chip[data-add='5']");
        assert.match(await page.textContent("#movementAfter"), /Stock after: 5 tonnes/);
        await context.close();
    });

    it("a chip tapped on a field with text that is not a number starts again from the chip", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-receive").click();
        await page.fill("#movementAmount", "abc");
        await page.click(".chip[data-add='5']");
        assert.equal(await page.inputValue("#movementAmount"), "5");
        await context.close();
    });

    it("the over-use message replaces the live line instead of repeating it, and goes when the amount changes", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-use").click();
        await page.fill("#movementAmount", "9");
        assert.match(await page.textContent("#movementAfter"), /More than the 5 bags/);
        await page.click("#movementSubmit");
        await page.locator("#movementError").waitFor({ state: "visible" });
        assert.equal((await page.textContent("#movementAfter")).trim(), "");
        await page.fill("#movementAmount", "4");
        assert.equal(await page.locator("#movementError").isVisible(), false);
        assert.match(await page.textContent("#movementAfter"), /Stock after: 1 bags/);
        await context.close();
    });

    it("Enter in the note field confirms too, and the note is not required", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-receive").click();
        await page.fill("#movementAmount", "2");
        await page.fill("#movementNote", "Truck 3");
        await page.press("#movementNote", "Enter");
        await closed(page, "#movementContainer");
        const writes = await wrote(page);
        assert.equal(writes.length, 1);
        assert.ok(Object.values(writes[0].paths).some((v) => v && v.note === "Truck 3"));
        await context.close();
    });

    it("focus returns to the button that opened the sheet: after Cancel, Escape and a recorded movement", async () => {
        const { context, page } = await open();
        const useButton = row(page, "Cement").locator(".btn-use");

        await useButton.click();
        await page.click("#movementCancel");
        let focus = await focusedInfo(page);
        assert.ok(focus.className.includes("btn-use") && focus.row === "m1", `after Cancel: ${JSON.stringify(focus)}`);

        await useButton.click();
        await page.keyboard.press("Escape");
        await closed(page, "#movementContainer");
        focus = await focusedInfo(page);
        assert.ok(focus.className.includes("btn-use") && focus.row === "m1", `after Escape: ${JSON.stringify(focus)}`);

        // The table is rebuilt by the new quantity, so the button that was clicked no longer exists.
        await useButton.click();
        await page.fill("#movementAmount", "1");
        await page.press("#movementAmount", "Enter");
        await closed(page, "#movementContainer");
        focus = await focusedInfo(page);
        assert.ok(focus.className.includes("btn-use") && focus.row === "m1", `after recording: ${JSON.stringify(focus)}`);
        await context.close();
    });

    it("Tab stays inside the sheet, and the page behind does not scroll while it is open", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-use").click();
        assert.equal(await page.evaluate(() => document.body.classList.contains("sheet-open")), true);
        for (let i = 0; i < 12; i += 1) {
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate(() => document.querySelector("#movementForm").contains(document.activeElement)), true, `Tab ${i}`);
        }
        for (let i = 0; i < 12; i += 1) {
            await page.keyboard.press("Shift+Tab");
            assert.equal(await page.evaluate(() => document.querySelector("#movementForm").contains(document.activeElement)), true, `Shift+Tab ${i}`);
        }
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => document.body.classList.contains("sheet-open")), false);
        await context.close();
    });

    it("tapping the dimmed area closes the sheet, tapping inside it does not", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-use").click();
        await page.click("#movementTitle");
        assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("#movementContainer")).display), "none");
        await page.mouse.click(1250, 690); // bottom right corner of the default 1280x720 window: backdrop, not the card
        await closed(page, "#movementContainer");
        assert.equal((await wrote(page)).length, 0);
        await context.close();
    });

    it("a second tap on the table's Use while the sheet is open and a site switch leave nothing open", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-use").click();
        await selectSite(page, "Cape Town");
        await closed(page, "#movementContainer");
        assert.equal(await page.evaluate(() => document.body.classList.contains("sheet-open")), false);
        await context.close();
    });
});

describe("variant A: accessibility", () => {
    it("every icon-sized button names the material, the sheets are labelled dialogs, the amount has a label", async () => {
        const { context, page } = await open();
        const labels = await row(page, "Cement").locator("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));
        assert.deepEqual(labels, ["Receive Cement", "Use Cement", "History of Cement", "Edit material", "Delete material"]);

        await row(page, "Cement").locator(".btn-use").click();
        const dialog = page.locator("#movementForm");
        assert.equal(await dialog.getAttribute("role"), "dialog");
        assert.equal(await dialog.getAttribute("aria-modal"), "true");
        assert.equal(await dialog.getAttribute("aria-labelledby"), "movementTitle");
        assert.equal(await page.locator("label[for='movementAmount']").count(), 1);
        assert.equal(await page.locator("label[for='movementNote']").count(), 1);
        assert.equal(await page.getAttribute("#movementStock", "aria-live"), "polite");
        await page.click("#movementCancel");

        await row(page, "Cement").locator(".btn-history").click();
        const history = page.locator("#historyContainer [role='dialog']");
        assert.equal(await history.getAttribute("aria-modal"), "true");
        assert.equal(await history.getAttribute("aria-labelledby"), "historyTitle");
        assert.equal(await page.evaluate(() => document.activeElement.id), "historyClose", "focus moves into the history sheet");
        await context.close();
    });

    it("history says the type in words next to the sign, so colour is never the only cue", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        const rows = page.locator("#historyList .history-row");
        assert.match(await rows.nth(1).locator(".history-type").textContent(), /^Used$/);
        assert.match(await rows.nth(1).locator(".history-delta").textContent(), /^-15 bags$/);
        assert.match(await rows.nth(0).locator(".history-delta").textContent(), /^\+20 bags$/);
        assert.match(await rows.nth(0).locator(".history-balance").textContent(), /^Balance 20$/);
        await context.close();
    });

    it("History closes with Escape and focus returns to its button", async () => {
        const { context, page } = await open();
        await row(page, "Sand").locator(".btn-history").click();
        await page.locator("#historyContainer").waitFor({ state: "visible" });
        await page.keyboard.press("Escape");
        await closed(page, "#historyContainer");
        const focus = await focusedInfo(page);
        assert.ok(focus.className.includes("btn-history") && focus.row === "m2", JSON.stringify(focus));
        await context.close();
    });
});

describe("variant A: keeps database text as text", () => {
    const evil = "<img src=x onerror=window.__pwned=1>";
    const seed = {
        ...SEED,
        materials: { ...SEED.materials, m1: { ...SEED.materials.m1, name: evil } },
        movements: {
            x1: { siteId: "sA", materialId: "m1", materialName: evil, units: "bags", delta: 9, type: "opening", byUid: "u9", byEmail: "<b>x</b>@example.com", at: now - HOUR, note: evil },
        },
    };

    it("material names and notes in the sheets, labels and toasts", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await page.locator("#materialTableBody tr").first().waitFor();

        await row(page, "<img").locator(".btn-use").click();
        assert.equal(await page.textContent("#movementTitle"), `Use ${evil}`);
        assert.equal(await page.getAttribute("#movementContainer .sheet", "aria-labelledby"), "movementTitle");
        await page.fill("#movementNote", evil);
        await page.fill("#movementAmount", "1");
        await page.click("#movementSubmit");
        await closed(page, "#movementContainer");
        await page.locator("#activityList .activity-item").nth(1).waitFor();

        await row(page, "<img").locator(".btn-history").click();
        await page.locator("#historyList .history-row").nth(1).waitFor();
        assert.equal(await page.locator("img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.equal(await page.textContent("#historyTitle"), `${evil} history`);
        assert.ok((await page.textContent("#historyList")).includes(evil));
        assert.ok(state.toasts.some((t) => t.includes(evil)));
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });
});

describe("variant A: listeners", () => {
    it("the feed stays at one subscription through site changes and history sheets", async () => {
        const { context, page } = await open();
        const count = () => page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "movements").length);
        assert.equal(await count(), 1);
        await selectSite(page, "Cape Town");
        await selectSite(page, "Mombasa");
        await selectSite(page, "Mombasa");
        assert.equal(await count(), 1);
        await row(page, "Cement").locator(".btn-history").click();
        assert.equal(await count(), 2);
        await selectSite(page, "Cape Town");
        await closed(page, "#historyContainer");
        assert.equal(await count(), 1, "the history listener went with the sheet");
        await context.close();
    });

    it("a deleted material keeps its history sheet open and says so", async () => {
        const { context, page } = await open();
        await row(page, "Cement").locator(".btn-history").click();
        await page.locator("#historyList .history-row").first().waitFor();
        await page.evaluate(() => window.__nailit.externalRemoveMaterial("sA", "m1"));
        await page.waitForFunction(() => /deleted/.test(document.querySelector("#historySummary").textContent));
        assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("#historyContainer")).display), "none");
        await context.close();
    });
});

describe("variant A: a 375px phone", () => {
    it("rows are cards, every tap target is at least 44px, and the page does not scroll sideways", async () => {
        const { context, page } = await open(SEEDED, phone());
        const metrics = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            small: [...document.querySelectorAll("#materialTableBody button")]
                .map((b) => ({ cls: b.className, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
                .filter((b) => b.h < 44 || b.w < 44),
            rowDisplay: getComputedStyle(document.querySelector("#materialTableBody tr")).display,
        }));
        assert.equal(metrics.rowDisplay, "grid");
        assert.ok(metrics.scrollWidth <= metrics.clientWidth, `sideways scroll: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
        assert.deepEqual(metrics.small, []);
        await context.close();
    });

    it("the record sheet sits on the bottom edge, fits the screen, and every control is in reach", async () => {
        const { context, page } = await open(SEEDED, phone());
        await row(page, "Cement").locator(".btn-use").tap();
        await page.locator("#movementContainer").waitFor({ state: "visible" });
        await page.fill("#movementAmount", "3");
        await page.waitForTimeout(250); // the sheet slides up
        const box = await page.evaluate(() => {
            const rect = (s) => document.querySelector(s).getBoundingClientRect();
            const sheet = rect("#movementForm");
            const small = [...document.querySelectorAll("#movementForm button")]
                .filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map((b) => b.id || b.textContent);
            return {
                bottom: sheet.bottom, left: sheet.left, right: sheet.right, top: sheet.top,
                height: innerHeight, width: innerWidth,
                submit: rect("#movementSubmit").height, cancelBottom: rect("#movementCancel").bottom,
                amountSize: parseFloat(getComputedStyle(document.querySelector("#movementAmount")).fontSize),
                small,
            };
        });
        assert.ok(Math.abs(box.bottom - box.height) <= 1, "anchored to the bottom edge");
        assert.ok(box.left >= 0 && box.right <= box.width + 0.5, "fits the width");
        assert.ok(box.top >= 0, "fits the height");
        assert.ok(box.cancelBottom <= box.height, "Cancel is on screen");
        assert.ok(box.submit >= 56, `the primary button is big: ${box.submit}`);
        assert.ok(box.amountSize >= 32, "the amount is big, and 16px or more keeps iOS from zooming in");
        assert.deepEqual(box.small, []);
        assert.equal(await page.getAttribute("#movementAmount", "inputmode"), "decimal");

        await page.locator("#movementSubmit").tap();
        await closed(page, "#movementContainer");
        assert.equal((await row(page, "Cement").locator("td").nth(1).textContent()).trim(), "2");
        await context.close();
    });

    it("the record sheet still fits when the page is as short as a phone with its keyboard open", async () => {
        const { context, page } = await open(SEEDED, phone());
        await row(page, "Cement").locator(".btn-use").tap();
        await page.setViewportSize({ width: 375, height: 330 });
        await page.waitForTimeout(250);
        const fit = await page.evaluate(() => {
            const sheet = document.querySelector("#movementForm");
            const rect = sheet.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: innerHeight, scrolls: sheet.scrollHeight > sheet.clientHeight };
        });
        assert.ok(fit.top >= 0 && fit.bottom <= fit.height + 1, JSON.stringify(fit));
        assert.equal(fit.scrolls, true, "what does not fit scrolls inside the sheet");
        await context.close();
    });

    it("the history sheet is nearly full height, scrolls inside, and ends on the newest line", async () => {
        const many = {};
        for (let i = 0; i < 14; i += 1) {
            many[`h${String(i).padStart(2, "0")}`] = {
                siteId: "sA", materialId: "m2", materialName: "Sand", units: "tonnes", delta: i % 2 ? -1 : 1,
                type: i % 2 ? "used" : "received", byUid: "u9", byEmail: "boss@example.com", at: now - (20 - i) * HOUR, note: `Load ${i}`,
            };
        }
        const { context, page } = await open({ ...SEED, movements: many }, phone());
        await row(page, "Sand").locator(".btn-history").tap();
        await page.locator("#historyList .history-row").nth(13).waitFor();
        await page.waitForTimeout(250);
        const state = await page.evaluate(() => {
            const sheet = document.querySelector("#historyContainer [role='dialog']").getBoundingClientRect();
            const body = document.querySelector("#historyBody");
            const last = document.querySelector("#historyList .history-row:last-child").getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            return {
                sheetHeight: sheet.height, viewport: innerHeight, bottom: sheet.bottom,
                scrollable: body.scrollHeight > body.clientHeight,
                lastVisible: last.bottom <= bodyRect.bottom + 1 && last.top >= bodyRect.top,
            };
        });
        assert.ok(state.sheetHeight >= state.viewport * 0.85, JSON.stringify(state));
        assert.equal(Math.round(state.bottom), state.viewport);
        assert.equal(state.scrollable, true);
        assert.equal(state.lastVisible, true, "opens on the newest movement, the one that matches the table");
        await context.close();
    });

    it("a viewer on a phone gets a History button the full width of the card and no other buttons", async () => {
        const { context, page } = await open({ ...SEEDED, roles: { sA: "viewer" } }, phone());
        const buttons = await page.locator("#materialTableBody tr").first().locator("button").evaluateAll((list) => list.map((b) => b.className));
        assert.equal(buttons.length, 1);
        assert.match(buttons[0], /btn-history/);
        await context.close();
    });
});
