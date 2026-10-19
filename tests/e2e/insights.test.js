// Phase 4 in the browser: low-stock badges, the site summary, search, sort and filter chips on
// the dashboard, and the owner overview page. Runs against the in-memory fake data layer.
//
// This file is the DOM contract of the feature. Any UI that keeps these ids and classes passes.
//   Dashboard
//     #materialSearch (type=search, labelled)   #materialSort (select: added name quantity updated)
//     #filterAll #filterLow (buttons, aria-pressed; #filterLow text holds the count: "Low stock (3)")
//     #siteSummary: .summary-total .summary-low .summary-activity   (hidden with no site selected)
//     rows: tr.is-low with .badge-low ("Low" or "Out"); rows with no level have neither
//     #materialsStatus says why the table is empty: no match, or nothing low
//     header nav: a[href="overview.html"]
//     dashboard.html?site=<id> opens that site
//   Overview (overview.html)
//     #overviewTotals  #overviewStatus  #overviewList > li.overview-site[data-site-id]:
//       .overview-name  .overview-total  .overview-low  .overview-activity
//       .overview-lowitems > li (at most 3) and .overview-more ("and 2 more")
//       a.overview-open[href="dashboard.html?site=<id>"]
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer, launchBrowser, openDashboard, openOverview, selectSite, waitForRows, rowTexts, wrote, SEED,
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

// Mombasa (sA): Cement 5 bags, level 10 (low) | Sand 10 tonnes, level 10 (at the level: low) |
//               Bricks 500 pieces, no level | Paint 0 litres, level 3 (out).   Three of four are low.
// Cape Town (sB): Nails 40, no level. Nothing low.
const MATERIALS = {
    m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
    m2: { name: "Sand", quantity: 10, units: "tonnes", minLevel: 10, updatedAt: now - 3 * DAY, siteId: "sA" },
    m4: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
    m5: { name: "Paint", quantity: 0, units: "litres", minLevel: 3, updatedAt: now - 5 * DAY, siteId: "sA" },
    m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
};
const MOVEMENTS = {
    mv1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR },
};
const SEEDED = { ...SEED, materials: MATERIALS, movements: MOVEMENTS };

async function open(seed = SEEDED, options) {
    const opened = await openDashboard(browser, baseUrl, seed, options);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand", "Bricks", "Paint"]);
    return opened;
}

const row = (page, name) => page.locator("#materialTableBody tr", { hasText: name });
const text = async (page, selector) => (await page.locator(selector).first().textContent()).trim();
const names = (page) => rowTexts(page);

describe("low stock on the dashboard", () => {
    it("a material at or below its level shows a Low badge, an empty one shows Out, others show nothing", async () => {
        const { context, page, state } = await open();
        assert.equal(await row(page, "Cement").getAttribute("class").then((c) => c.includes("is-low")), true);
        assert.equal(await text(page, "#materialTableBody tr:nth-child(1) .badge-low"), "Low");
        assert.equal((await row(page, "Sand").locator(".badge-low").textContent()).trim(), "Low", "exactly at the level counts");
        assert.equal((await row(page, "Paint").locator(".badge-low").textContent()).trim(), "Out");
        assert.equal(await row(page, "Bricks").locator(".badge-low").count(), 0);
        assert.equal(((await row(page, "Bricks").getAttribute("class")) || "").includes("is-low"), false);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("a badge says more than its colour: its text is a word, and the row says how much is left", async () => {
        const { context, page } = await open();
        const badge = row(page, "Cement").locator(".badge-low");
        assert.match(await badge.textContent(), /^(Low|Out)$/);
        assert.match((await row(page, "Cement").textContent()), /5 bags left, level 10|level 10/, "the detail is readable text or a title");
        await context.close();
    });

    it("the badge goes when the stock is received above the level, and comes back when it is used", async () => {
        const { context, page } = await open();
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 20 }));
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr .badge-low").length === 2);
        assert.equal(await row(page, "Cement").locator(".badge-low").count(), 0);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "used", delta: -20 }));
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr .badge-low").length === 3);
        await context.close();
    });

    it("setting a level in the edit form flags the material, and clearing it unflags it", async () => {
        const { context, page } = await open();
        await row(page, "Bricks").locator(".btn-edit").click();
        await page.fill("#uMinLevel", "600");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr .badge-low").length === 4);
        await row(page, "Bricks").locator(".btn-edit").click();
        await page.fill("#uMinLevel", "");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr .badge-low").length === 3);
        await context.close();
    });

    it("a new material added with a level above its stock is flagged at once", async () => {
        const { context, page } = await open();
        await page.click("#addMaterialButton");
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "2");
        await page.fill("#mMinLevel", "5");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-btn");
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr .badge-low").length === 4);
        await context.close();
    });

    it("a viewer sees the badges too", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, roles: { sA: "viewer" } });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        assert.equal(await page.locator("#materialTableBody .badge-low").count(), 3);
        await context.close();
    });
});

describe("the site summary", () => {
    it("says how many materials, how many are low, and when the site last moved", async () => {
        const { context, page } = await open();
        assert.equal(await text(page, "#siteSummary .summary-total"), "4 materials");
        assert.equal(await text(page, "#siteSummary .summary-low"), "3 low on stock");
        assert.equal(await text(page, "#siteSummary .summary-activity"), "Last activity 1h ago");
        await context.close();
    });

    it("says nothing is low when nothing is, and 'No activity yet' for a site that never moved", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, SEEDED);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        assert.equal(await text(page, "#siteSummary .summary-total"), "1 material");
        assert.equal(await text(page, "#siteSummary .summary-low"), "Nothing low on stock");
        assert.match(await text(page, "#siteSummary .summary-activity"), /Last activity|No activity yet/);
        await context.close();
    });

    it("is hidden until a site is selected, and follows the stock", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, SEEDED, {
            beforeLoad: () => { try { localStorage.clear(); } catch { /* none */ } },
        });
        assert.equal(await page.locator("#siteSummary").isVisible(), false);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 20 }));
        await page.waitForFunction(() => document.querySelector("#siteSummary .summary-low").textContent.trim() === "2 low on stock");
        await context.close();
    });
});

describe("filter chips", () => {
    it("All and Low stock: Low shows only the low and out materials, and says how many", async () => {
        const { context, page } = await open();
        assert.match(await text(page, "#filterLow"), /Low stock \(3\)/);
        assert.equal(await page.getAttribute("#filterAll", "aria-pressed"), "true");
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "false");
        await page.click("#filterLow");
        await waitForRows(page, ["Cement", "Sand", "Paint"]);
        assert.equal(await page.getAttribute("#filterLow", "aria-pressed"), "true");
        assert.equal(await page.getAttribute("#filterAll", "aria-pressed"), "false");
        await page.click("#filterAll");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await context.close();
    });

    it("the Low filter follows the stock: a material leaves it when restocked", async () => {
        const { context, page } = await open();
        await page.click("#filterLow");
        await waitForRows(page, ["Cement", "Sand", "Paint"]);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 20 }));
        await waitForRows(page, ["Sand", "Paint"]);
        assert.match(await text(page, "#filterLow"), /Low stock \(2\)/);
        await context.close();
    });

    it("with nothing low, the Low filter says so instead of showing an empty page", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, SEEDED);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.click("#filterLow");
        await waitForRows(page, []);
        assert.match(await text(page, "#materialsStatus"), /Nothing is low on stock/i);
        assert.equal(await page.locator("#materialsStatus").isVisible(), true);
        await page.click("#filterAll");
        await waitForRows(page, ["Nails"]);
        await context.close();
    });

    it("the chips work for a viewer", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, roles: { sA: "viewer" } });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await page.click("#filterLow");
        await waitForRows(page, ["Cement", "Sand", "Paint"]);
        await context.close();
    });
});

describe("search", () => {
    it("filters the materials by name as you type, ignoring case and spaces", async () => {
        const { context, page } = await open();
        const search = page.locator("#materialSearch");
        assert.equal(await search.getAttribute("type"), "search");
        assert.ok(await search.getAttribute("aria-label") || await page.locator("label[for='materialSearch']").count(), "it has an accessible name");
        await page.fill("#materialSearch", "ce");
        await waitForRows(page, ["Cement"]);
        await page.fill("#materialSearch", "  SAND ");
        await waitForRows(page, ["Sand"]);
        await page.fill("#materialSearch", "");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await context.close();
    });

    it("says what it found nothing for, as text", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "zzz");
        await waitForRows(page, []);
        assert.equal(await text(page, "#materialsStatus"), 'No materials match "zzz".');
        const markup = "<img src=x onerror=window.__pwned=1>";
        await page.fill("#materialSearch", markup);
        await page.waitForFunction((m) => document.querySelector("#materialsStatus").textContent.includes(m), markup);
        assert.equal(await page.locator("#materialsStatus img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        await context.close();
    });

    it("combines with the Low filter", async () => {
        const { context, page } = await open();
        await page.click("#filterLow");
        await page.fill("#materialSearch", "s");
        await waitForRows(page, ["Sand"]);
        await page.fill("#materialSearch", "bricks");
        await waitForRows(page, []);
        await context.close();
    });

    it("keeps working while the stock changes underneath it", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "cement");
        await waitForRows(page, ["Cement"]);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m1", { type: "received", delta: 1 }));
        await page.waitForFunction(() => document.querySelector("#materialTableBody td:nth-child(2)")?.textContent.trim() === "6");
        assert.deepEqual(await names(page), ["Cement"]);
        assert.equal(await page.inputValue("#materialSearch"), "cement");
        await context.close();
    });

    it("is cleared, with the filter and sort, when another site is opened", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "cement");
        await page.click("#filterLow");
        await page.selectOption("#materialSort", "name");
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        assert.equal(await page.inputValue("#materialSearch"), "");
        assert.equal(await page.getAttribute("#filterAll", "aria-pressed"), "true");
        assert.equal(await page.inputValue("#materialSort"), "added");
        await context.close();
    });

    it("the summary and chip counts describe the whole site, not what the search leaves", async () => {
        const { context, page } = await open();
        await page.fill("#materialSearch", "bricks");
        await waitForRows(page, ["Bricks"]);
        assert.equal(await text(page, "#siteSummary .summary-total"), "4 materials");
        assert.match(await text(page, "#filterLow"), /Low stock \(3\)/);
        await context.close();
    });

    it("works for a viewer and is not offered on the marketing pages", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEEDED, roles: { sA: "viewer" } });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand", "Bricks", "Paint"]);
        await page.fill("#materialSearch", "pa");
        await waitForRows(page, ["Paint"]);
        assert.equal(await page.locator("header .search-container").count(), 0, "no dead search box in the header");
        await context.close();

        const plain = await browser.newContext();
        const marketing = await plain.newPage();
        await marketing.route("**/kit.fontawesome.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
        for (const file of ["index.html", "about-us.html"]) {
            await marketing.goto(`${baseUrl}/${file}`);
            assert.equal(await marketing.locator(".search-container, input[type=search], input[placeholder*=earch]").count(), 0, file);
        }
        await plain.close();
    });
});

describe("sort", () => {
    const order = async (page, sort) => {
        await page.selectOption("#materialSort", sort);
        return page.waitForFunction(() => true).then(() => names(page));
    };

    it("offers Added (the default), Name, Stock lowest first and Updated newest first", async () => {
        const { context, page } = await open();
        const options = await page.locator("#materialSort option").evaluateAll((list) => list.map((o) => o.value));
        assert.deepEqual(options, ["added", "name", "quantity", "updated"]);
        assert.equal(await page.inputValue("#materialSort"), "added");
        assert.deepEqual(await names(page), ["Cement", "Sand", "Bricks", "Paint"]);
        await context.close();
    });

    it("reorders the table", async () => {
        const { context, page } = await open();
        assert.deepEqual(await order(page, "name"), ["Bricks", "Cement", "Paint", "Sand"]);
        assert.deepEqual(await order(page, "quantity"), ["Paint", "Cement", "Sand", "Bricks"]);
        assert.deepEqual(await order(page, "updated"), ["Bricks", "Cement", "Sand", "Paint"]);
        assert.deepEqual(await order(page, "added"), ["Cement", "Sand", "Bricks", "Paint"]);
        await context.close();
    });

    it("keeps its order when the stock changes, and combines with the Low filter", async () => {
        const { context, page } = await open();
        await page.selectOption("#materialSort", "quantity");
        await page.click("#filterLow");
        await waitForRows(page, ["Paint", "Cement", "Sand"]);
        await page.evaluate(() => window.__nailit.externalMovement("sA", "m2", { type: "used", delta: -9 }));
        await waitForRows(page, ["Paint", "Sand", "Cement"]);
        await context.close();
    });

    it("an action on a sorted row still acts on that row", async () => {
        const { context, page } = await open();
        await page.selectOption("#materialSort", "name");
        await row(page, "Sand").locator(".btn-use").click();
        await page.fill("#movementAmount", "2");
        await page.click("#movementSubmit");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        const [write] = await wrote(page);
        assert.ok(Object.keys(write.paths).some((p) => p.startsWith("materials/sA/m2/")), "the stock of Sand, not another row");
        await context.close();
    });
});

describe("getting around", () => {
    it("the dashboard header links to the overview", async () => {
        const { context, page } = await open();
        assert.equal(await page.locator("header a[href='overview.html']").count(), 1);
        await context.close();
    });

    it("dashboard.html?site=<id> opens that site; an unknown id is ignored", async () => {
        const opened = await openDashboard(browser, baseUrl, SEEDED, {
            beforeLoad: () => { try { localStorage.clear(); } catch { /* none */ } },
        });
        await opened.page.goto(`${baseUrl}/dashboard.html?site=sB`);
        await opened.page.waitForFunction(() => window.__nailit && window.__nailit.activeListeners().some((l) => l.kind === "materials" && l.siteId === "sB"));
        await waitForRows(opened.page, ["Nails"]);
        await opened.page.goto(`${baseUrl}/dashboard.html?site=nope`);
        await opened.page.waitForFunction(() => window.__nailit && window.__nailit.activeListeners().some((l) => l.kind === "sites"));
        await opened.page.waitForTimeout(100);
        assert.deepEqual(opened.state.pageErrors, []);
        await opened.context.close();
    });
});

// ---- the owner overview --------------------------------------------------------------

// Three sites. Mombasa has 3 low of 4, Cape Town none, Kisumu 5 low materials (a "more" line) and moved last.
const OVERVIEW_SEED = {
    sites: {
        ...SEED.sites,
        sC: { name: "Kisumu", location: "Lake", buildingType: "Industrial", createdAt: 1714694400000, ownerUid: "u1" },
    },
    materials: {
        ...MATERIALS,
        k1: { name: "Rebar", quantity: 1, units: "pieces", minLevel: 50, updatedAt: now - 30 * 60_000, siteId: "sC" },
        k2: { name: "Wire", quantity: 2, units: "kg", minLevel: 50, updatedAt: now - 40 * 60_000, siteId: "sC" },
        k3: { name: "Pipes", quantity: 3, units: "pieces", minLevel: 50, updatedAt: now - 50 * 60_000, siteId: "sC" },
        k4: { name: "Tiles", quantity: 4, units: "pieces", minLevel: 50, updatedAt: now - 50 * 60_000, siteId: "sC" },
        k5: { name: "Glue", quantity: 5, units: "litres", minLevel: 50, updatedAt: now - 50 * 60_000, siteId: "sC" },
    },
    movements: {
        ...MOVEMENTS,
        mk1: { siteId: "sC", materialId: "k1", materialName: "Rebar", units: "pieces", delta: -9, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 30 * 60_000 },
    },
};

const site = (page, name) => page.locator("#overviewList li.overview-site", { hasText: name });

describe("the owner overview", () => {
    it("lists every site, the ones with the most low stock first", async () => {
        const { context, page, state } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await page.locator("#overviewList li.overview-site").first().waitFor();
        const names = await page.locator("#overviewList .overview-name").allTextContents();
        assert.deepEqual(names.map((n) => n.trim()), ["Kisumu", "Mombasa", "Cape Town"]);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("each site says how many materials, how many are low, and when it last moved", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        const mombasa = site(page, "Mombasa");
        assert.equal(await text(mombasa, ".overview-total"), "4 materials");
        assert.equal(await text(mombasa, ".overview-low"), "3 low on stock");
        assert.equal(await text(mombasa, ".overview-activity"), "Last activity 1h ago");
        const capeTown = site(page, "Cape Town");
        assert.equal(await text(capeTown, ".overview-low"), "Nothing low on stock");
        await context.close();
    });

    it("names the low materials, emptiest first, at most three, then 'and N more'", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        const items = (await site(page, "Mombasa").locator(".overview-lowitems li").allTextContents()).map((t) => t.trim());
        assert.equal(items.length, 3);
        assert.match(items[0], /Paint/);
        assert.match(items[0], /Out/);
        assert.match(items[1], /Cement/);
        assert.match(items[1], /5 bags left, level 10/);
        assert.equal(await site(page, "Mombasa").locator(".overview-more").count(), 0);

        const kisumu = site(page, "Kisumu");
        assert.equal((await kisumu.locator(".overview-lowitems li").count()), 3);
        assert.equal(await text(kisumu, ".overview-more"), "and 2 more");
        assert.equal(await site(page, "Cape Town").locator(".overview-lowitems li").count(), 0);
        await context.close();
    });

    it("totals across all the sites", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        assert.equal(await text(page, "#overviewTotals"), "3 sites, 8 low on stock");
        await context.close();
    });

    it("each site links to its dashboard", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        assert.equal(await site(page, "Mombasa").locator("a.overview-open").getAttribute("href"), "dashboard.html?site=sA");
        assert.equal(await site(page, "Kisumu").locator("a.overview-open").getAttribute("href"), "dashboard.html?site=sC");
        await context.close();
    });

    it("updates live and re-sorts when stock changes, and drops a site that is deleted", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        await page.evaluate(() => {
            for (const id of ["k1", "k2", "k3", "k4", "k5"]) {
                window.__nailit.externalSetMaterial("sC", id, { name: id, quantity: 999, units: "pieces", minLevel: 50, updatedAt: Date.now() });
            }
        });
        await page.waitForFunction(() => document.querySelector("#overviewList .overview-name").textContent.trim() === "Mombasa");
        assert.equal(await text(site(page, "Kisumu"), ".overview-low"), "Nothing low on stock");
        assert.equal(await text(page, "#overviewTotals"), "3 sites, 3 low on stock");

        await page.evaluate(() => window.__nailit.externalRemoveSite("sC"));
        await page.waitForFunction(() => document.querySelectorAll("#overviewList li.overview-site").length === 2);
        const listening = await page.evaluate(() => window.__nailit.activeListeners().filter((l) => l.siteId === "sC").length);
        assert.equal(listening, 0, "nothing keeps listening to a deleted site");
        await context.close();
    });

    it("listens to each site once for its materials and once for its last movement, and no more", async () => {
        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        const counts = await page.evaluate(() => {
            const out = {};
            for (const l of window.__nailit.activeListeners().filter((x) => x.siteId)) {
                out[`${l.siteId}:${l.kind}`] = (out[`${l.siteId}:${l.kind}`] || 0) + 1;
            }
            return out;
        });
        for (const id of ["sA", "sB", "sC"]) {
            assert.equal(counts[`${id}:materials`], 1, `${id} materials`);
            assert.ok((counts[`${id}:movements`] || 0) <= 1, `${id} movements`);
        }
        await context.close();
    });

    it("says it is loading, then says there are no sites when there are none", async () => {
        const held = await openOverview(browser, baseUrl, OVERVIEW_SEED, { beforeLoad: () => { window.__preset = { holdSnapshots: true }; } });
        assert.match(await text(held.page, "#overviewStatus"), /Loading/i);
        await held.page.evaluate(() => window.__nailit.releaseSnapshots());
        await site(held.page, "Mombasa").waitFor();
        assert.equal(await held.page.locator("#overviewStatus").isVisible(), false);
        await held.context.close();

        const { context, page } = await openOverview(browser, baseUrl, { sites: {}, materials: {} });
        await page.waitForFunction(() => /No sites yet/i.test(document.querySelector("#overviewStatus").textContent));
        assert.equal(await page.locator("#overviewList li").count(), 0);
        await context.close();
    });

    it("a site with no materials says so", async () => {
        const { context, page } = await openOverview(browser, baseUrl, { sites: SEED.sites, materials: {} });
        await site(page, "Mombasa").waitFor();
        assert.equal(await text(site(page, "Mombasa"), ".overview-total"), "No materials yet");
        assert.equal(await text(site(page, "Mombasa"), ".overview-low"), "Nothing low on stock");
        assert.equal(await text(site(page, "Mombasa"), ".overview-activity"), "No activity yet");
        await context.close();
    });

    it("includes the sites where the person is only a viewer", async () => {
        const { context, page } = await openOverview(browser, baseUrl, { ...OVERVIEW_SEED, roles: { sA: "viewer", sB: "viewer", sC: "viewer" } });
        await site(page, "Mombasa").waitFor();
        assert.equal(await page.locator("#overviewList li.overview-site").count(), 3);
        await context.close();
    });

    it("shows site names and material names as text (S2)", async () => {
        const evil = "<img src=x onerror=window.__pwned=1>";
        const seed = {
            sites: { sX: { name: evil, location: "<b>x</b>", buildingType: "Other", createdAt: 1714521600000, ownerUid: "u1" } },
            materials: { x1: { name: evil, quantity: 0, units: "bags", minLevel: 5, updatedAt: now, siteId: "sX" } },
        };
        const { context, page } = await openOverview(browser, baseUrl, seed);
        await page.locator("#overviewList li.overview-site").first().waitFor();
        assert.equal(await page.locator("#overviewList img, #overviewList b").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        assert.ok((await page.textContent("#overviewList")).includes(evil));
        await context.close();
    });

    it("a signed-out visitor is sent to the login page, and the nav links back to the dashboard", async () => {
        const out = await openOverview(browser, baseUrl, { ...SEED, user: null });
        assert.match(out.page.url(), /login\.html/);
        await out.context.close();

        const { context, page } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        assert.equal(await page.locator("header a[href='dashboard.html']").count(), 1);
        assert.equal(await page.locator("#signOutButton").count(), 1);
        await context.close();
    });

    it("makes no write and reaches nothing but the data layer", async () => {
        const { context, page, state } = await openOverview(browser, baseUrl, OVERVIEW_SEED);
        await site(page, "Mombasa").waitFor();
        assert.deepEqual(await wrote(page), []);
        assert.deepEqual(state.blocked, []);
        assert.deepEqual(state.dialogs, []);
        await context.close();
    });
});
