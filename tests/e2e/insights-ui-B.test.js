// Variant B ("At a glance") of the Phase 4 UI: what the person sees and does, beyond the frozen
// contract in insights.test.js. Phone width, tap targets, focus during live updates, ARIA, the
// stat tiles and the Needs attention pills, the overview with many sites, and text-only rendering.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer, launchBrowser, openDashboard, openOverview, selectSite, waitForRows, SEED,
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
const PHONE = { width: 375, height: 700 };

const MATERIALS = {
    m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
    m2: { name: "Sand", quantity: 10, units: "tonnes", minLevel: 10, updatedAt: now - 3 * DAY, siteId: "sA" },
    m4: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
    m5: { name: "Paint", quantity: 0, units: "litres", minLevel: 3, updatedAt: now - 5 * DAY, siteId: "sA" },
    m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
};
const SEEDED = {
    ...SEED,
    materials: MATERIALS,
    movements: { mv1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR } },
};

async function open(seed = SEEDED, { phone = false } = {}) {
    const opened = await openDashboard(browser, baseUrl, seed);
    if (phone) {
        await opened.page.setViewportSize(PHONE);
    }
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand", "Bricks", "Paint"]);
    return opened;
}

const row = (page, name) => page.locator("#materialTableBody tr", { hasText: name });
const text = async (page, selector) => (await page.locator(selector).first().textContent()).trim();
const sidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- the dashboard on a phone ----------------------------------------------------------------

describe("the dashboard at 375px", () => {
    it("never scrolls sideways, with or without the Low filter and a long search", async () => {
        const { context, page } = await open(SEEDED, { phone: true });
        assert.ok(await sidewaysScroll(page) <= 0, "plain");
        await page.click("#filterLow");
        assert.ok(await sidewaysScroll(page) <= 0, "low filter");
        await page.fill("#materialSearch", "a very long search text that goes on and on and on");
        assert.ok(await sidewaysScroll(page) <= 0, "long search");
        await context.close();
    });

    it("search, chips, sort, the low tile and the pills are all at least 44px tall and wide", async () => {
        const { context, page } = await open(SEEDED, { phone: true });
        const targets = ["#materialSearch", "#filterAll", "#filterLow", "#materialSort", "#summaryLowTile", ".attention-pill"];
        for (const selector of targets) {
            const box = await page.locator(selector).first().boundingBox();
            assert.ok(box.height >= 44, `${selector} is ${box.height}px tall`);
            assert.ok(box.width >= 44, `${selector} is ${box.width}px wide`);
        }
        await context.close();
    });

    it("the Phase 3 phone cards keep their big buttons, and a low card shows its badge and detail", async () => {
        const { context, page } = await open(SEEDED, { phone: true });
        const receive = await row(page, "Cement").locator(".btn-receive").boundingBox();
        assert.ok(receive.height >= 52, `Receive is ${receive.height}px`);
        const card = row(page, "Cement");
        assert.equal(await card.locator(".badge-low").isVisible(), true);
        assert.match(await card.locator(".low-detail").innerText(), /5 bags left, level 10/);
        // The card is tinted and has a strong left edge: the accent is a border, not only a colour on text.
        const border = await card.evaluate((tr) => parseFloat(getComputedStyle(tr).borderLeftWidth));
        assert.ok(border >= 6, `left accent ${border}px`);
        await context.close();
    });

    it("the summary and the first low material are in the first screens, not far below", async () => {
        const { context, page } = await open(SEEDED, { phone: true });
        const tile = await page.locator("#summaryLowTile").boundingBox();
        assert.ok(tile.y + tile.height <= PHONE.height, "the low tile is on the first screen");
        const pill = await page.locator(".attention-pill").first().boundingBox();
        assert.ok(pill.y + pill.height <= PHONE.height, "the first low material is named on the first screen");
        await context.close();
    });
});

// ---- the stat tiles and the Needs attention strip --------------------------------------------

describe("stat tiles", () => {
    it("the low tile is loud with a number when something is low, calm and inert when nothing is", async () => {
        const { context, page } = await open();
        const tile = page.locator("#summaryLowTile");
        assert.equal(await tile.evaluate((el) => el.classList.contains("is-alert")), true);
        assert.equal((await tile.locator(".stat-num").textContent()).trim(), "3");
        assert.equal(await tile.isDisabled(), false);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        assert.equal(await tile.evaluate((el) => el.classList.contains("is-calm")), true);
        assert.match(await tile.locator(".stat-label").textContent(), /All stocked/);
        assert.equal(await tile.isDisabled(), true);
        assert.equal(await page.locator("#needsAttention").isVisible(), false);
        await context.close();
    });

    it("tapping the low tile turns the Low filter on, and tapping it again turns it off", async () => {
        const { context, page } = await open();
        await page.click("#summaryLowTile");
        await waitForRows(page, ["Cement", "Sand", "Paint"]);
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "true");
        assert.equal(await page.getAttribute("#summaryLowTile", "aria-pressed"), "true");
        await page.click("#summaryLowTile");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "false");
        await context.close();
    });

    it("the tile figures are decoration: the facts are also sentences for a screen reader", async () => {
        const { context, page } = await open();
        assert.equal(await page.locator("#siteSummary .stat-num").first().getAttribute("aria-hidden"), "true");
        assert.equal(await text(page, "#siteSummary .summary-low"), "3 low on stock");
        await context.close();
    });

    it("the last activity counts a movement even when no material shows it (a delete leaves only the movement)", async () => {
        const old = { ...MATERIALS, m1: { ...MATERIALS.m1, updatedAt: now - 9 * DAY }, m2: { ...MATERIALS.m2, updatedAt: now - 9 * DAY }, m4: { ...MATERIALS.m4, updatedAt: now - 9 * DAY }, m5: { ...MATERIALS.m5, updatedAt: now - 9 * DAY } };
        const seed = { ...SEEDED, materials: old, movements: { mv1: { ...SEEDED.movements.mv1, at: now - 10 * 60_000 } } };
        const { context, page } = await open(seed);
        await page.waitForFunction(() => document.querySelector("#siteSummary .summary-activity").textContent.trim() === "Last activity 10 min ago");
        await context.close();
    });

    it("the page opens one movements listener for the site, shared by the feed and the summary", async () => {
        const { context, page } = await open();
        const count = await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "movements").length);
        assert.equal(count, 1);
        await context.close();
    });
});

describe("Needs attention", () => {
    it("names each low material, emptiest first, with its word and detail", async () => {
        const { context, page } = await open();
        const pills = await page.locator(".attention-pill").allTextContents();
        assert.equal(pills.length, 3);
        assert.match(pills[0], /Paint.*Out.*0 litres left, level 3/);
        assert.match(pills[1], /Cement.*Low.*5 bags left, level 10/);
        assert.match(pills[2], /Sand/);
        await context.close();
    });

    it("tapping a pill scrolls to the row, highlights it and moves focus to it", async () => {
        const { context, page } = await open();
        await page.locator(".attention-pill", { hasText: "Paint" }).click();
        await page.waitForFunction(() => document.querySelector("#materialTableBody tr.row-flash"));
        assert.match(await text(page, "#materialTableBody tr.row-flash td"), /Paint/);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.materialId), "m5");
        await context.close();
    });

    it("a pill clears a search that hides its row", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "bricks");
        await waitForRows(page, ["Bricks"]);
        await page.locator(".attention-pill", { hasText: "Cement" }).click();
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        assert.equal(await page.inputValue("#materialSearch"), "");
        await context.close();
    });

    it("with more than six low materials the strip says how many more and opens the Low filter", async () => {
        const many = {};
        for (let i = 1; i <= 9; i++) {
            many[`x${i}`] = { name: `Item ${i}`, quantity: i, units: "pieces", minLevel: 50, updatedAt: now - i * HOUR, siteId: "sA" };
        }
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEED, materials: many });
        await selectSite(page, "Mombasa");
        await page.locator("#attentionList li").first().waitFor();
        assert.equal(await page.locator("#attentionList li").count(), 7);
        assert.equal((await text(page, ".attention-more")), "+3 more");
        await page.click(".attention-more");
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "true");
        await context.close();
    });

    it("shows names as text only (S2)", async () => {
        const evil = "<img src=x onerror=window.__pwned=1>";
        const seed = { ...SEED, materials: { e1: { name: evil, quantity: 0, units: "bags", minLevel: 5, updatedAt: now, siteId: "sA" } } };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await page.locator(".attention-pill").first().waitFor();
        assert.equal(await page.locator("#attentionList img, #materialTableBody img, #insights img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.ok((await text(page, ".attention-pill .pill-name")).includes(evil));
        await context.close();
    });
});

// ---- controls ---------------------------------------------------------------------------------

describe("search, chips and sort controls", () => {
    it("keep focus and the caret in the search box while the stock changes underneath", async () => {
        const { context, page } = await open();
        await page.click("#materialSearch");
        await page.keyboard.type("cem");
        await waitForRows(page, ["Cement"]);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 1 }));
        await page.waitForFunction(() => document.querySelector("#materialTableBody td:nth-child(2)")?.textContent.trim() === "6");
        assert.equal(await page.evaluate(() => document.activeElement.id), "materialSearch");
        await page.keyboard.type("e");
        assert.equal(await page.inputValue("#materialSearch"), "ceme", "typing carries on from where it was");
        await context.close();
    });

    it("are labelled and expose their state to assistive technology", async () => {
        const { context, page } = await open();
        assert.equal(await page.locator("label[for='materialSearch']").count(), 1);
        assert.equal(await page.locator("label[for='materialSort']").count(), 1);
        assert.equal(await page.getAttribute("#materialsStatus", "role"), "status");
        assert.equal(await page.getAttribute("#filterAll", "aria-pressed"), "true");
        await page.click("#filterLow");
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "true");
        assert.equal(await page.locator("#materialControls").getAttribute("role"), "search");
        await context.close();
    });

    it("the search box shows a visible focus ring", async () => {
        const { context, page } = await open();
        await page.keyboard.press("Tab");
        await page.focus("#materialSearch");
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        const outline = await page.locator("#materialSearch").evaluate((el) => getComputedStyle(el).outlineStyle);
        assert.notEqual(outline, "none");
        await context.close();
    });

    it("Enter in the search box closes the keyboard instead of submitting anything", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "san");
        await page.press("#materialSearch", "Enter");
        assert.notEqual(await page.evaluate(() => document.activeElement.id), "materialSearch");
        await waitForRows(page, ["Sand"]);
        await context.close();
    });

    it("an empty result with the Low filter and a search says which of the two found nothing", async () => {
        const { context, page } = await open();
        await page.click("#filterLow");
        await page.fill("#materialSearch", "bricks");
        await waitForRows(page, []);
        assert.equal(await text(page, "#materialsStatus"), 'No low-stock materials match "bricks".');
        await context.close();
    });

    it("a viewer sees the status column even though the Edit column is gone", async () => {
        const { context, page } = await open({ ...SEEDED, roles: { sA: "viewer" } });
        assert.equal(await row(page, "Cement").locator(".badge-low").isVisible(), true);
        assert.equal(await row(page, "Cement").locator(".cell-manage").isVisible(), false);
        await context.close();
    });

    it("the wide table does not outgrow the page", async () => {
        const { context, page } = await open();
        assert.ok(await sidewaysScroll(page) <= 0);
        const overflow = await page.evaluate(() => {
            const area = document.querySelector(".main-content");
            return area.scrollWidth - area.clientWidth;
        });
        assert.ok(overflow <= 0, `main content overflows by ${overflow}px`);
        await context.close();
    });
});

// ---- the overview -----------------------------------------------------------------------------

function manySites(count) {
    const sites = {};
    const materials = {};
    for (let i = 0; i < count; i++) {
        sites[`s${i}`] = { name: `Site ${i}`, location: `Place ${i}`, buildingType: "Other", createdAt: 1714521600000 + i, ownerUid: "u1" };
        materials[`a${i}`] = { name: "Cement", quantity: i % 3 === 0 ? 1 : 100, units: "bags", minLevel: 10, updatedAt: now - i * HOUR, siteId: `s${i}` };
        materials[`b${i}`] = { name: "Sand", quantity: 100, units: "tonnes", minLevel: 10, updatedAt: now - i * HOUR, siteId: `s${i}` };
    }
    return { sites, materials };
}

describe("the overview", () => {
    it("with 25 sites keeps one materials listener and at most one movements listener per site", async () => {
        const { context, page, state } = await openOverview(browser, baseUrl, manySites(25));
        await page.waitForFunction(() => document.querySelectorAll("#overviewList > li").length === 25);
        const counts = await page.evaluate(() => {
            const out = {};
            for (const l of window.__nailit.activeListeners().filter((x) => x.siteId)) {
                out[`${l.siteId}:${l.kind}`] = (out[`${l.siteId}:${l.kind}`] || 0) + 1;
            }
            return out;
        });
        for (let i = 0; i < 25; i++) {
            assert.equal(counts[`s${i}:materials`], 1, `s${i} materials`);
            assert.ok((counts[`s${i}:movements`] || 0) <= 1, `s${i} movements`);
        }
        assert.equal(await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.kind === "sites").length), 1);
        // Nine of 25 sites have a low material: they come first, and the total says so.
        assert.equal(await text(page, "#overviewTotals"), "25 sites, 9 low on stock");
        const tones = await page.locator("#overviewList > li").evaluateAll((list) => list.map((li) => li.classList.contains("is-trouble")));
        assert.deepEqual(tones, [...Array(9).fill(true), ...Array(16).fill(false)]);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("redraws once per burst: 25 sites arrive without 25 redraws of the list", async () => {
        const { context, page } = await openOverview(browser, baseUrl, manySites(25), {
            beforeLoad: () => {
                window.__listRewrites = 0;
                new MutationObserver(() => { window.__listRewrites += 1; }).observe(document, { childList: true, subtree: true });
            },
        });
        await page.waitForFunction(() => document.querySelectorAll("#overviewList > li").length === 25);
        await page.waitForTimeout(100);
        const rewrites = await page.evaluate(() => window.__listRewrites);
        assert.ok(rewrites < 10, `${rewrites} DOM mutation batches for one open`);
        await context.close();
    });

    it("at 375px the cards stack one per row, never scroll sideways, and the links are easy to hit", async () => {
        const { context, page } = await openOverview(browser, baseUrl, manySites(25));
        await page.setViewportSize(PHONE);
        await page.waitForFunction(() => document.querySelectorAll("#overviewList > li").length === 25);
        assert.ok(await sidewaysScroll(page) <= 0);
        const boxes = await page.locator("#overviewList > li").evaluateAll((list) => list.slice(0, 5).map((li) => {
            const r = li.getBoundingClientRect();
            return { x: r.x, width: r.width, y: r.y };
        }));
        assert.ok(boxes.every((b) => b.x === boxes[0].x), "one column");
        const link = await page.locator("a.overview-open").first().boundingBox();
        assert.ok(link.height >= 44, `Open link is ${link.height}px tall`);
        await context.close();
    });

    it("a troubled card has a big number, a proportion bar and the low items; a healthy one is calm", async () => {
        const { context, page } = await openOverview(browser, baseUrl, manySites(4));
        await page.waitForFunction(() => document.querySelectorAll("#overviewList > li").length === 4);
        const trouble = page.locator("#overviewList > li.is-trouble").first();
        assert.equal((await trouble.locator(".overview-bignum").textContent()).trim(), "1");
        assert.equal(await trouble.locator(".overview-bar").getAttribute("aria-label"), "1 of 2 materials low");
        assert.equal(await trouble.locator(".overview-bar-fill").evaluate((el) => el.style.getPropertyValue("--share")), "50%");
        assert.equal(await trouble.locator(".overview-lowitems li").count(), 1);
        const calm = page.locator("#overviewList > li.is-calm").first();
        assert.equal(await calm.locator(".overview-lowitems").count(), 0);
        assert.equal(await calm.locator(".overview-figure").getAttribute("aria-hidden"), "true");
        assert.equal(await text(calm, ".overview-low"), "Nothing low on stock");
        await context.close();
    });

    it("the Open link goes to that site's dashboard with its materials showing", async () => {
        const { context, page } = await openOverview(browser, baseUrl, { ...SEEDED, sites: SEED.sites });
        await page.locator("#overviewList > li", { hasText: "Mombasa" }).locator("a.overview-open").click();
        await page.waitForURL(/dashboard\.html\?site=sA/);
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await context.close();
    });

    it("keeps keyboard focus on the same Open link when the page updates live", async () => {
        const { context, page } = await openOverview(browser, baseUrl, SEEDED);
        const link = page.locator("#overviewList > li", { hasText: "Mombasa" }).locator("a.overview-open");
        await link.focus();
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 1 }));
        await page.waitForFunction(() => /6 bags left/.test(document.querySelector("#overviewList").textContent));
        assert.equal(await page.evaluate(() => document.activeElement.closest("li")?.dataset.siteId), "sA");
        await context.close();
    });
});
