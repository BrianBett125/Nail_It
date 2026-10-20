// Phase 5: accessibility, measured by axe-core in real Chrome, on every page and in every state that has a
// different screen: the phone and the desktop, the dialogs open, the empty and the busy dashboard, a viewer.
// The gate is the one in Plan.md: zero serious or critical violations. Moderate and minor findings are listed
// in the output (set AXE_ALL=1 to fail on them too) so they are seen, not ignored.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
    startServer, launchBrowser, openDashboard, openOverview, openLogin, selectSite, waitForRows, SEED,
} from "./helpers.js";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

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
    m3: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
    m4: { name: "Paint", quantity: 0, units: "litres", minLevel: 3, updatedAt: now - 5 * DAY, siteId: "sA" },
    m5: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
};
const MOVEMENTS = {
    v1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 20, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - 3 * DAY },
    v2: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -15, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR, note: "Slab pour" },
};
const SEEDED = { ...SEED, materials: MATERIALS, movements: MOVEMENTS };

const VIEWPORTS = {
    phone: { width: 375, height: 700 },
    desktop: { width: 1280, height: 800 },
};

// A browser host whose pages have the viewport (and, on a phone, touch), for the shared harness.
function host(viewport) {
    return {
        newContext: () => browser.newContext({
            viewport,
            deviceScaleFactor: viewport.width < 600 ? 2 : 1,
            isMobile: viewport.width < 600,
            hasTouch: viewport.width < 600,
        }),
    };
}

// Runs axe on the page as it is now. Returns the violations, each with the rule, the impact and where.
async function audit(page) {
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(async () => {
        const run = await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
            resultTypes: ["violations"],
        });
        return run.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")}  ${(n.failureSummary || "").split("\n").slice(1, 3).join(" ").trim()}`),
            count: v.nodes.length,
        }));
    });
    return result;
}

const SERIOUS = new Set(["serious", "critical"]);

function describeViolations(violations) {
    return violations.map((v) => `[${v.impact}] ${v.id} (${v.count}): ${v.help}\n      ${v.nodes.join("\n      ")}`).join("\n");
}

// The gate: no serious or critical violation. AXE_ALL=1 widens it to everything axe reports.
async function assertClean(page, label) {
    const violations = await audit(page);
    const gated = process.env.AXE_ALL ? violations : violations.filter((v) => SERIOUS.has(v.impact));
    const others = violations.filter((v) => !gated.includes(v));
    if (others.length > 0) {
        console.log(`# axe, ${label}, not gated:\n${describeViolations(others)}`);
    }
    assert.deepEqual(gated, [], `axe found problems on ${label}:\n${describeViolations(gated)}`);
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    describe(`accessibility on a ${name} (${viewport.width}px)`, () => {
        async function open(seed = SEEDED, site = "Mombasa", rows = ["Cement", "Sand", "Bricks", "Paint"]) {
            const opened = await openDashboard(host(viewport), baseUrl, seed);
            if (site) {
                await selectSite(opened.page, site);
                await waitForRows(opened.page, rows);
            }
            return opened;
        }

        for (const file of ["index.html", "about-us.html"]) {
            it(`${file}`, async () => {
                const context = await host(viewport).newContext();
                const page = await context.newPage();
                await page.goto(`${baseUrl}/${file}`);
                await assertClean(page, `${file} on a ${name}`);
                await context.close();
            });
        }

        it("login: sign in, create an account, reset password", async () => {
            const { context, page } = await openLogin(host(viewport), baseUrl);
            await assertClean(page, `login (sign in) on a ${name}`);
            await page.click("#toSignUp");
            await assertClean(page, `login (create an account) on a ${name}`);
            await page.click("#toSignIn");
            await page.click("#toReset");
            await assertClean(page, `login (reset) on a ${name}`);
            await context.close();
        });

        it("dashboard with no sites, and with no site selected", async () => {
            const empty = await open({ sites: {}, materials: {} }, null);
            await assertClean(empty.page, `dashboard (no sites) on a ${name}`);
            await empty.context.close();
            const none = await openDashboard(host(viewport), baseUrl, SEEDED, {
                beforeLoad: () => { try { localStorage.clear(); } catch { /* none */ } },
            });
            await assertClean(none.page, `dashboard (no site selected) on a ${name}`);
            await none.context.close();
        });

        it("dashboard with a site open: low stock, filter, no match", async () => {
            const { context, page } = await open();
            await assertClean(page, `dashboard (site open) on a ${name}`);
            await page.click("#filterLow");
            await assertClean(page, `dashboard (Low filter) on a ${name}`);
            await page.click("#filterAll");
            await page.fill("#materialSearch", "zzz");
            await assertClean(page, `dashboard (no match) on a ${name}`);
            await context.close();
        });

        it("dashboard as a viewer", async () => {
            const { context, page } = await open({ ...SEEDED, roles: { sA: "viewer" } });
            await assertClean(page, `dashboard (viewer) on a ${name}`);
            await context.close();
        });

        it("the Received / Used sheet and the history sheet", async () => {
            const { context, page } = await open();
            await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-use").click();
            await page.fill("#movementAmount", "40");
            await page.click("#movementSubmit");
            await assertClean(page, `record sheet (refused) on a ${name}`);
            await page.keyboard.press("Escape");
            await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-history").click();
            await assertClean(page, `history sheet on a ${name}`);
            await context.close();
        });

        it("the add site, add material, edit and delete site dialogs", async () => {
            const { context, page } = await open();
            await page.click("#addSiteButton");
            await assertClean(page, `add site dialog on a ${name}`);
            await page.click("#cancelButton");
            await page.click("#addMaterialButton");
            await assertClean(page, `add material dialog on a ${name}`);
            await page.click("#materialCancelButton");
            await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-edit").click();
            await assertClean(page, `edit dialog on a ${name}`);
            await page.click("#updateCancelButton");
            await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
            await assertClean(page, `delete site dialog on a ${name}`);
            await context.close();
        });

        it("the members dialog", async () => {
            const { context, page } = await open();
            await page.click("#membersButton");
            await assertClean(page, `members dialog on a ${name}`);
            await context.close();
        });

        it("the overview, with sites, calm and empty", async () => {
            const busy = await openOverview(host(viewport), baseUrl, SEEDED);
            await busy.page.locator("#overviewList li.overview-site").first().waitFor();
            await assertClean(busy.page, `overview on a ${name}`);
            await busy.context.close();
            const calm = await openOverview(host(viewport), baseUrl, { ...SEED, materials: { m5: MATERIALS.m5 } });
            await calm.page.locator("#overviewList li.overview-site").first().waitFor();
            await assertClean(calm.page, `overview (calm) on a ${name}`);
            await calm.context.close();
            const none = await openOverview(host(viewport), baseUrl, { sites: {}, materials: {} });
            await none.page.waitForFunction(() => /No sites yet/i.test(document.querySelector("#overviewStatus").textContent));
            await assertClean(none.page, `overview (empty) on a ${name}`);
            await none.context.close();
        });
    });
}
