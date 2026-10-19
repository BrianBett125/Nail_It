// What the blind critic of the Phase 4 screens asked for: a way out of an empty result, a short wrapping
// attention strip on phones, materials before the activity feed on phones, an action on the empty overview,
// a caption on the overview bar, and ages that read as ages.
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

const MATERIALS = {
    m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
    m2: { name: "Sand", quantity: 10, units: "tonnes", minLevel: 10, updatedAt: now - 3 * DAY, siteId: "sA" },
    m4: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
    m5: { name: "Paint", quantity: 0, units: "litres", minLevel: 3, updatedAt: now - 5 * DAY, siteId: "sA" },
    m6: { name: "Glass", quantity: 1, units: "sheets", minLevel: 4, updatedAt: now - 6 * DAY, siteId: "sA" },
    m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
};
const MOVEMENTS = {
    mv1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR },
};
const SEEDED = { ...SEED, materials: MATERIALS, movements: MOVEMENTS };

// A browser host whose pages are a 375px touch phone, for the shared harness.
function phone() {
    return {
        newContext: () => browser.newContext({
            viewport: { width: 375, height: 700 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        }),
    };
}

async function open(seed = SEEDED) {
    const opened = await openDashboard(browser, baseUrl, seed);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand", "Bricks", "Paint", "Glass"]);
    return opened;
}

describe("a way out of an empty result", () => {
    it("a search with no match says so in a card with a button that brings everything back", async () => {
        const { context, page } = await open();
        const clear = page.locator("#clearView");
        assert.equal(await clear.isVisible(), false, "no button while there is something to see");
        await page.fill("#materialSearch", "zzz");
        await waitForRows(page, []);
        assert.equal(await clear.isVisible(), true);
        assert.equal(await page.locator("#materialsStatus").evaluate((el) => el.classList.contains("status-card")), true);
        assert.ok((await clear.boundingBox()).height >= 44, "a thumb-sized button");
        await clear.click();
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint", "Glass"]);
        assert.equal(await page.inputValue("#materialSearch"), "");
        assert.equal(await page.getAttribute("#filterAll", "aria-pressed"), "true");
        assert.equal(await clear.isVisible(), false);
        await context.close();
    });

    it("also clears the Low filter when nothing is low", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, SEEDED);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.click("#filterLow");
        await waitForRows(page, []);
        assert.equal(await page.locator("#clearView").isVisible(), true);
        await page.click("#clearView");
        await waitForRows(page, ["Nails"]);
        await context.close();
    });

    it("is not shown for a site with no materials at all", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEED, materials: {} });
        await selectSite(page, "Mombasa");
        await page.waitForFunction(() => /No materials yet/.test(document.querySelector("#materialsStatus").textContent));
        assert.equal(await page.locator("#clearView").isVisible(), false);
        await context.close();
    });
});

describe("on a phone", () => {
    it("the attention strip wraps to at most three pills and '+N more', and never scrolls sideways", async () => {
        const { context: ctx, page } = await openOnPhone();
        const pills = page.locator("#attentionList li");
        assert.equal(await pills.count(), 4, "three pills and the more button for 4 low materials");
        assert.equal(await page.locator("#attentionList .attention-more").textContent(), "+1 more");
        const geometry = await page.evaluate(() => {
            const list = document.querySelector("#attentionList");
            return { scrollWidth: list.scrollWidth, clientWidth: list.clientWidth, overflowX: getComputedStyle(list).overflowX };
        });
        assert.ok(geometry.scrollWidth <= geometry.clientWidth, "nothing hidden off the right edge");
        assert.notEqual(geometry.overflowX, "auto");
        await page.click("#attentionList .attention-more");
        await waitForRows(page, ["Cement", "Sand", "Paint", "Glass"]);
        await ctx.close();
    });

    it("the materials come before the activity feed", async () => {
        const { context: ctx, page } = await openOnPhone();
        const tops = await page.evaluate(() => ({
            table: document.querySelector("#materialsTable").getBoundingClientRect().top,
            feed: document.querySelector("#activityPanel").getBoundingClientRect().top,
        }));
        assert.ok(tops.table < tops.feed, `the list at ${tops.table}px, the feed at ${tops.feed}px`);
        await ctx.close();
    });

    it("the empty-result button fits and is reachable at 375px", async () => {
        const { context: ctx, page } = await openOnPhone();
        await page.fill("#materialSearch", "zzz");
        await page.waitForFunction(() => !document.querySelector("#clearView").hidden);
        const box = await page.locator("#clearView").boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 375, "inside the screen");
        assert.ok(box.height >= 44);
        await ctx.close();
    });
});

async function openOnPhone() {
    const opened = await openDashboard(phone(), baseUrl, SEEDED);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand", "Bricks", "Paint", "Glass"]);
    return opened;
}

describe("the Low filter and the attention strip", () => {
    it("the strip hides while the Low filter shows the same list, and comes back with All", async () => {
        const { context, page } = await open();
        assert.equal(await page.locator("#needsAttention").isVisible(), true);
        await page.click("#filterLow");
        await waitForRows(page, ["Cement", "Sand", "Paint", "Glass"]);
        assert.equal(await page.locator("#needsAttention").isVisible(), false);
        await page.click("#filterAll");
        assert.equal(await page.locator("#needsAttention").isVisible(), true);
        await context.close();
    });
});

describe("the owner overview, polished", () => {
    const OVERVIEW = {
        sites: { ...SEED.sites },
        materials: MATERIALS,
        movements: MOVEMENTS,
    };

    it("says what the bar measures, in words", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW);
        await page.locator("#overviewList li.overview-site").first().waitFor();
        const caption = await page.locator("#overviewList li", { hasText: "Mombasa" }).locator(".overview-bar-caption").textContent();
        assert.equal(caption.trim(), "4 of 5 materials low");
        await context.close();
    });

    it("an old site reads as stale: weeks, months or years, with a class a style can use", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW);
        const capeTown = page.locator("#overviewList li", { hasText: "Cape Town" });
        await capeTown.waitFor();
        assert.match((await capeTown.locator(".overview-activity").textContent()).trim(), /^Last activity \d+ (months|years|year) ago$/);
        assert.equal(await capeTown.locator(".overview-activity").evaluate((el) => el.classList.contains("is-stale")), true);
        assert.equal((await capeTown.locator(".overview-stale-tag").textContent()).trim(), "No recent updates");
        const mombasa = page.locator("#overviewList li", { hasText: "Mombasa" });
        assert.equal(await mombasa.locator(".overview-activity").evaluate((el) => el.classList.contains("is-stale")), false);
        assert.equal(await mombasa.locator(".overview-stale-tag").count(), 0, "a site that moved today is not stale");
        await context.close();
    });

    it("the empty overview offers the next step, as a link to the dashboard", async () => {
        const { context, page } = await openOverview(browser, baseUrl, { sites: {}, materials: {} });
        await page.waitForFunction(() => /No sites yet/i.test(document.querySelector("#overviewStatus").textContent));
        const link = page.locator("#overviewAddSite");
        assert.equal(await link.isVisible(), true);
        assert.equal(await link.getAttribute("href"), "dashboard.html");
        await context.close();
    });

    it("the empty-state link is not there when there are sites", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW);
        await page.locator("#overviewList li.overview-site").first().waitFor();
        assert.equal(await page.locator("#overviewAddSite").isVisible(), false);
        await context.close();
    });
});

describe("the dashboard summary reads ages too", () => {
    it("the last-activity tile says weeks, months or years for an old site", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEED, materials: { m3: MATERIALS.m3 }, movements: {} });
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        assert.match((await page.locator("#siteSummary .summary-activity").textContent()).trim(), /^Last activity \d+ (months|years|year) ago$/);
        await context.close();
    });
});
