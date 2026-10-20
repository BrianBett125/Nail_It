// Phase 5: "every page works at 375px". The checks are the ones a person with a phone and dirty hands would
// fail: the page slides sideways, a button is too small to hit, the site list takes the whole screen, a dialog
// does not fit. Any layout that passes these is fine; how it looks is the builder's to decide.
//
// The site picker, at 768px and below (the sidebar becomes a drawer):
//   #sitePickerButton   shows the open site's name ("Choose a site" with none), aria-expanded, aria-controls
//                       the drawer; pressing it opens and closes the drawer
//   the drawer          is the .sidebar nav; its links stay `#siteList a`; picking a site closes it and updates
//                       the button; Escape closes it and returns focus to the button; closed, its links cannot be tabbed to
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer, launchBrowser, openDashboard, openOverview, openLogin, selectSite, waitForRows, SEED,
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
const SEEDED = {
    ...SEED,
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", minLevel: 10, updatedAt: now - 3 * DAY, siteId: "sA" },
        m3: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
        m4: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
    movements: {
        v1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR },
    },
};

function host(width, height = 700) {
    return {
        newContext: () => browser.newContext({
            viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 800, hasTouch: width < 800,
        }),
    };
}

async function openOnSite(width, seed = SEEDED) {
    const opened = await openDashboard(host(width), baseUrl, seed);
    // With a picker (768px and below) the site links are in the drawer: open it first.
    if (await opened.page.locator("#sitePickerButton").isVisible()) {
        await opened.page.click("#sitePickerButton");
    }
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand", "Bricks"]);
    return opened;
}

const sideways = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

describe("no page slides sideways, at any common phone width", () => {
    for (const width of [320, 360, 375, 414, 768]) {
        it(`public pages and sign-in at ${width}px`, async () => {
            for (const file of ["index.html", "about-us.html"]) {
                const context = await host(width).newContext();
                const page = await context.newPage();
                await page.goto(`${baseUrl}/${file}`);
                const { scroll, client } = await sideways(page);
                assert.ok(scroll <= client, `${file} is ${scroll}px wide on a ${client}px screen`);
                await context.close();
            }
            const login = await openLogin(host(width), baseUrl);
            const { scroll, client } = await sideways(login.page);
            assert.ok(scroll <= client, `login is ${scroll}px wide on a ${client}px screen`);
            await login.context.close();
        });

        it(`the dashboard and the overview at ${width}px`, async () => {
            const { context, page } = await openOnSite(width);
            let { scroll, client } = await sideways(page);
            assert.ok(scroll <= client, `dashboard is ${scroll}px wide on a ${client}px screen`);
            await page.click("#filterLow");
            ({ scroll, client } = await sideways(page));
            assert.ok(scroll <= client, `dashboard (Low filter) is ${scroll}px wide`);
            await context.close();
            const overview = await openOverview(host(width), baseUrl, SEEDED);
            await overview.page.locator("#overviewList li.overview-site").first().waitFor();
            ({ scroll, client } = await sideways(overview.page));
            assert.ok(scroll <= client, `overview is ${scroll}px wide on a ${client}px screen`);
            await overview.context.close();
        });
    }
});

describe("everything you press is big enough to hit (44px) on a 375px phone", () => {
    const TAP = "button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), a[href], summary, [role=button]";

    async function small(page, scope = "body") {
        return page.evaluate(({ selector, within }) => {
            const root = document.querySelector(within);
            const visible = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
            };
            return [...root.querySelectorAll(selector)]
                .filter((el) => visible(el) && !el.closest("[hidden], [inert]") && !el.closest("dialog:not([open])"))
                .filter((el) => !el.matches(".sr-only, [data-tap-exempt]") && !el.closest("p, li.activity-item, .overview-lowitems"))
                .map((el) => ({ el: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : ""}`, text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
                .filter((b) => b.w < 44 || b.h < 44);
        }, { selector: TAP, within: scope });
    }

    it("the dashboard", async () => {
        const { context, page } = await openOnSite(375);
        assert.deepEqual(await small(page), []);
        await context.close();
    });

    it("the dashboard as a viewer", async () => {
        const { context, page } = await openOnSite(375, { ...SEEDED, roles: { sA: "viewer" } });
        assert.deepEqual(await small(page), []);
        await context.close();
    });

    it("the overview", async () => {
        const { context, page } = await openOverview(host(375), baseUrl, SEEDED);
        await page.locator("#overviewList li.overview-site").first().waitFor();
        assert.deepEqual(await small(page), []);
        await context.close();
    });

    it("sign-in", async () => {
        const { context, page } = await openLogin(host(375), baseUrl);
        assert.deepEqual(await small(page), []);
        await context.close();
    });

    it("the home and about pages", async () => {
        for (const file of ["index.html", "about-us.html"]) {
            const context = await host(375).newContext();
            const page = await context.newPage();
            await page.goto(`${baseUrl}/${file}`);
            assert.deepEqual(await small(page, "header"), [], `${file} header`);
            await context.close();
        }
    });

    it("each dialog's buttons and fields", async () => {
        const { context, page } = await openOnSite(375);
        const steps = [
            ["siteFormContainer", () => page.click("#addSiteButton"), "#cancelButton"],
            ["materialFormContainer", () => page.click("#addMaterialButton"), "#materialCancelButton"],
            ["updateFormContainer", () => page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-edit").click(), "#updateCancelButton"],
            ["movementContainer", () => page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-use").click(), "#movementCancel"],
            ["historyContainer", () => page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-history").click(), "#historyClose"],
            ["membersContainer", () => page.click("#membersButton"), "#membersClose"],
        ];
        for (const [id, open, close] of steps) {
            await open();
            assert.deepEqual(await small(page, `#${id}`), [], id);
            await page.click(close);
        }
        await context.close();
    });
});

describe("the site picker (the sidebar as a drawer, at 768px and below)", () => {
    async function phone(seed = SEEDED) {
        const opened = await openDashboard(host(375), baseUrl, seed, {
            beforeLoad: () => { try { localStorage.clear(); } catch { /* none */ } },
        });
        return opened;
    }

    it("there is one button that names the open site, and the drawer is closed once a site is open", async () => {
        const { context, page } = await openOnSite(375);
        const button = page.locator("#sitePickerButton");
        assert.equal(await button.isVisible(), true);
        assert.match(await button.textContent(), /Mombasa/);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
        const drawer = await button.getAttribute("aria-controls");
        assert.ok(drawer, "aria-controls names the drawer");
        assert.equal(await page.locator("#siteList a").first().isVisible(), false, "the site links are folded away");
        await context.close();
    });

    it("pressing the button opens the drawer, picking a site closes it and the button follows", async () => {
        const { context, page } = await openOnSite(375);
        await page.click("#sitePickerButton");
        assert.equal(await page.getAttribute("#sitePickerButton", "aria-expanded"), "true");
        assert.equal(await page.locator("#siteList a", { hasText: "Cape Town" }).isVisible(), true);
        await page.locator("#siteList a", { hasText: "Cape Town" }).click();
        await waitForRows(page, ["Nails"]);
        assert.equal(await page.getAttribute("#sitePickerButton", "aria-expanded"), "false");
        assert.match(await page.textContent("#sitePickerButton"), /Cape Town/);
        assert.equal(await page.locator("#siteList a").first().isVisible(), false);
        await context.close();
    });

    it("Escape closes the drawer and focus goes back to the button; a second press of the button also closes it", async () => {
        const { context, page } = await openOnSite(375);
        await page.click("#sitePickerButton");
        await page.keyboard.press("Escape");
        assert.equal(await page.getAttribute("#sitePickerButton", "aria-expanded"), "false");
        assert.equal(await page.evaluate(() => document.activeElement.id), "sitePickerButton");
        await page.click("#sitePickerButton");
        await page.click("#sitePickerButton");
        assert.equal(await page.getAttribute("#sitePickerButton", "aria-expanded"), "false");
        await context.close();
    });

    it("a closed drawer's links cannot be reached with Tab", async () => {
        const { context, page } = await openOnSite(375);
        const reachable = await page.evaluate(() => {
            const links = [...document.querySelectorAll("#siteList a")];
            return links.filter((a) => a.offsetParent !== null || getComputedStyle(a).visibility === "visible").length;
        });
        assert.equal(reachable, 0, "hidden links must be display:none, visibility:hidden or inert, not just off screen");
        await context.close();
    });

    it("with no site open the picker says 'Choose a site' and the drawer is open, so the first thing to do is obvious", async () => {
        const { context, page } = await phone();
        assert.match(await page.textContent("#sitePickerButton"), /Choose a site/i);
        assert.equal(await page.locator("#siteList a", { hasText: "Mombasa" }).isVisible(), true);
        await context.close();
    });

    it("the picker follows a site that is added, renamed or removed", async () => {
        const { context, page } = await openOnSite(375);
        await page.evaluate(() => window.__nailit.externalRemoveSite("sA"));
        await page.waitForFunction(() => /Choose a site/i.test(document.getElementById("sitePickerButton").textContent));
        await context.close();
    });

    it("the materials start high on the screen, so the list is the first thing you see", async () => {
        const { context, page } = await openOnSite(375);
        const top = await page.locator("#materialTableBody tr").first().evaluate((el) => el.getBoundingClientRect().top);
        assert.ok(top < 560, `the first material starts ${top}px down a 700px screen`);
        await context.close();
    });

    it("on a desktop there is no picker button and the sidebar is just there", async () => {
        const { context, page } = await openDashboard(host(1280, 800), baseUrl, SEEDED);
        assert.equal(await page.locator("#sitePickerButton").isVisible(), false);
        assert.equal(await page.locator("#siteList a", { hasText: "Mombasa" }).isVisible(), true);
        await context.close();
    });

    it("the Add Site button is reachable on a phone", async () => {
        const { context, page } = await openOnSite(375);
        await page.click("#sitePickerButton");
        assert.equal(await page.locator("#addSiteButton").isVisible(), true);
        await context.close();
    });
});

describe("the dashboard on a phone", () => {
    it("is a stack of cards with big Receive and Use buttons, in a header that does not take the screen", async () => {
        const { context, page } = await openOnSite(375);
        const facts = await page.evaluate(() => {
            const header = document.querySelector("header").getBoundingClientRect();
            const use = document.querySelector("#materialTableBody .btn-use").getBoundingClientRect();
            const receive = document.querySelector("#materialTableBody .btn-receive").getBoundingClientRect();
            return { header: header.height, use: [use.width, use.height], receive: [receive.width, receive.height] };
        });
        assert.ok(facts.header <= 120, `the header is ${facts.header}px tall`);
        assert.ok(facts.use[0] >= 44 && facts.use[1] >= 44, `Use is ${facts.use}`);
        assert.ok(facts.receive[0] >= 44 && facts.receive[1] >= 44, `Receive is ${facts.receive}`);
        await context.close();
    });

    it("the same page still works at 768px (a small tablet) and at a landscape phone", async () => {
        for (const [width, height] of [[768, 1024], [667, 375]]) {
            const opened = await openDashboard(host(width, height), baseUrl, SEEDED);
            await opened.page.locator("#siteList a, #sitePickerButton").first().waitFor({ state: "attached" });
            const { scroll, client } = await sideways(opened.page);
            assert.ok(scroll <= client, `${width}x${height}: ${scroll} > ${client}`);
            await opened.context.close();
        }
    });
});
