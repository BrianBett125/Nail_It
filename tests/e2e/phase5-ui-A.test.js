// Phase 5, variant A ("Drawer"): what the frozen contract files (dialogs, phone, a11y) do not pin down.
//   - the drawer: Close, the dimmed area, Escape, one place for Add Site, the trash can in the drawer
//   - the delete-site dialog on a phone, reached the way a person reaches it (through the drawer)
//   - every dialog field has a real label
//   - the page does not jump while the site loads (CLS)
//   - a drag that ends on the dimmed area does not close a sheet
//   - the same page resized from phone to desktop puts Add Site back in the sidebar
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
    startServer, launchBrowser, openDashboard, selectSite, waitForRows, SEED,
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
const now = Date.now();
const SEEDED = {
    ...SEED,
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", updatedAt: now - 3 * HOUR, siteId: "sA" },
    },
    invites: { sC: { role: "viewer", siteName: "Kisumu Depot", invitedBy: "boss@example.com" } },
};

const host = (width, height = 700) => ({
    newContext: () => browser.newContext({
        viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1, isMobile: width < 600, hasTouch: width < 600,
    }),
});

async function phoneOnSite(seed = SEEDED, width = 375) {
    const opened = await openDashboard(host(width), baseUrl, seed);
    await opened.page.click("#sitePickerButton");
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand"]);
    return opened;
}

const expanded = (page) => page.getAttribute("#sitePickerButton", "aria-expanded");
const activeId = (page) => page.evaluate(() => document.activeElement.id);

describe("the drawer on a phone", () => {
    it("the Close button folds it away and focus returns to the picker", async () => {
        const { context, page } = await phoneOnSite();
        await page.click("#sitePickerButton");
        assert.equal(await expanded(page), "true");
        await page.click("#siteDrawerClose");
        assert.equal(await expanded(page), "false");
        assert.equal(await activeId(page), "sitePickerButton");
        await context.close();
    });

    it("a tap on the dimmed page folds it away", async () => {
        const { context, page } = await phoneOnSite();
        await page.click("#sitePickerButton");
        await page.mouse.click(187, 690);
        assert.equal(await expanded(page), "false");
        await context.close();
    });

    it("the page does not scroll behind the open drawer", async () => {
        const { context, page } = await phoneOnSite();
        await page.click("#sitePickerButton");
        const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
        assert.equal(overflow, "hidden");
        await context.close();
    });

    it("invitations are in the drawer, above the sites", async () => {
        const { context, page } = await phoneOnSite();
        await page.click("#sitePickerButton");
        const invites = await page.locator("#invitesPanel").boundingBox();
        const list = await page.locator("#siteList").boundingBox();
        assert.ok(invites && list && invites.y < list.y, "Invitations sit above the site list");
        await context.close();
    });

    it("Add Site is in the site bar, usable with the drawer shut, and opening its dialog folds the drawer", async () => {
        const { context, page } = await phoneOnSite();
        assert.equal(await page.evaluate(() => document.getElementById("addSiteButton").parentElement.id), "siteBar");
        await page.click("#sitePickerButton");
        await page.click("#addSiteButton");
        assert.equal(await expanded(page), "false");
        assert.equal(await page.evaluate(() => document.getElementById("siteFormContainer").open), true);
        await page.keyboard.press("Escape");
        assert.equal(await activeId(page), "addSiteButton");
        await context.close();
    });

    it("the site bar shows the role next to the picker, and a long site name stays inside the screen", async () => {
        const seed = { ...SEEDED, sites: { ...SEED.sites, sA: { ...SEED.sites.sA, name: "Mombasa Heights Phase Two and the Very Long Name" } }, roles: { sA: "storekeeper" } };
        const { context, page } = await phoneOnSite(seed, 320);
        assert.equal((await page.textContent("#siteBarRole")).trim(), "Storekeeper");
        const facts = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
            bar: document.getElementById("siteBar").getBoundingClientRect().height,
        }));
        assert.ok(facts.scroll <= facts.client, `${facts.scroll} > ${facts.client}`);
        assert.ok(facts.bar <= 90, `the site bar is ${facts.bar}px tall`);
        await context.close();
    });

    it("no sideways scroll at 320 and 768 with the drawer open", async () => {
        for (const width of [320, 768]) {
            const { context, page } = await phoneOnSite(SEEDED, width);
            await page.click("#sitePickerButton");
            const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
            assert.ok(scroll <= client, `${width}px: ${scroll} > ${client}`);
            await context.close();
        }
    });
});

describe("the delete-site dialog, reached through the drawer on a phone", () => {
    it("opens, is named, takes the typed name, and Escape gives focus back to the picker", async () => {
        const { context, page } = await phoneOnSite();
        await page.click("#sitePickerButton");
        await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
        assert.equal(await expanded(page), "false", "the drawer folds away behind the dialog");
        assert.equal(await activeId(page), "siteDeleteInput");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true);
        await page.fill("#siteDeleteInput", "Mombasa");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), false);
        await page.keyboard.press("Escape");
        assert.equal(await page.evaluate(() => document.getElementById("siteDeleteContainer").open), false);
        assert.equal(await activeId(page), "sitePickerButton");
        await page.click("#sitePickerButton");
        await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
        assert.equal(await page.inputValue("#siteDeleteInput"), "", "the typed name is gone after closing");
        await context.close();
    });

    it("axe finds nothing in it, with the drawer open behind and with the dialog open", async () => {
        const { context, page } = await phoneOnSite();
        await page.addScriptTag({ path: AXE });
        const run = () => page.evaluate(async () => (await window.axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
        })).violations.map((v) => `${v.impact} ${v.id} ${v.nodes[0].target.join(" ")}`));
        await page.click("#sitePickerButton");
        assert.deepEqual(await run(), [], "drawer open");
        await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
        await page.waitForTimeout(300); // the sheet slides up
        assert.deepEqual(await run(), [], "delete dialog open");
        await context.close();
    });
});

describe("dialog fields", () => {
    it("every control in every dialog has a real label or an aria-label", async () => {
        const { context, page } = await phoneOnSite();
        const unlabelled = await page.evaluate(() => [...document.querySelectorAll("dialog input, dialog select")]
            .filter((el) => el.type !== "hidden")
            .filter((el) => !document.querySelector(`label[for="${el.id}"]`) && !el.getAttribute("aria-label"))
            .map((el) => el.id || el.outerHTML.slice(0, 60)));
        assert.deepEqual(unlabelled, []);
        await context.close();
    });

    it("the sheets are bottom sheets on a phone and centred cards on a desktop", async () => {
        const phone = await phoneOnSite();
        await phone.page.click("#addMaterialButton");
        await phone.page.waitForTimeout(300); // the sheet slides up
        const sheet = await phone.page.evaluate(() => {
            const r = document.querySelector("#materialFormContainer .sheet").getBoundingClientRect();
            return { bottom: r.bottom, vh: innerHeight, width: r.width, vw: innerWidth };
        });
        assert.ok(Math.abs(sheet.bottom - sheet.vh) <= 1, "the sheet sits on the bottom edge");
        assert.ok(sheet.width >= sheet.vw - 1, "and fills the width");
        await phone.context.close();
        const desk = await openDashboard(host(1280, 800), baseUrl, SEEDED);
        await selectSite(desk.page, "Mombasa");
        await desk.page.click("#addMaterialButton");
        await desk.page.waitForTimeout(300);
        const card = await desk.page.evaluate(() => {
            const r = document.querySelector("#materialFormContainer .sheet").getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
        });
        assert.ok(Math.abs((card.left + card.right) / 2 - card.vw / 2) <= 1, "centred across");
        assert.ok(card.top > 20 && card.bottom < card.vh - 20, "centred down, not on an edge");
        await desk.context.close();
    });

    it("the buttons stay pinned while a tall form scrolls (Members with many people)", async () => {
        const members = Array.from({ length: 14 }, (_, i) => ({ uid: `u${i + 10}`, role: "viewer", email: `person${i}@example.com` }));
        const seed = { ...SEEDED, members: { sA: [{ uid: "u1", role: "owner", email: "foreman@example.com" }, ...members] } };
        const { context, page } = await phoneOnSite(seed);
        await page.click("#membersButton");
        await page.locator("#memberList li").nth(10).waitFor();
        await page.waitForTimeout(400); // the sheet slides up first
        const facts = await page.evaluate(() => {
            const close = document.getElementById("membersClose").getBoundingClientRect();
            const body = document.querySelector("#membersContainer .sheet-body");
            return { closeBottom: close.bottom, vh: innerHeight, scrolls: body.scrollHeight > body.clientHeight };
        });
        assert.equal(facts.scrolls, true, "the body scrolls");
        assert.ok(facts.closeBottom <= facts.vh, "Close is on the screen without scrolling");
        await context.close();
    });
});

describe("a sheet and the dimmed area", () => {
    it("a press inside the sheet that ends on the dimmed area does not close it", async () => {
        const { context, page } = await phoneOnSite();
        await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-use").click();
        const box = await page.locator("#movementAmount").boundingBox();
        await page.mouse.move(box.x + 20, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(5, 5);
        await page.mouse.up();
        assert.equal(await page.evaluate(() => document.getElementById("movementContainer").open), true);
        await context.close();
    });
});

describe("the page does not jump while it loads", () => {
    it("layout shift on the dashboard is under 0.05 on a phone", async () => {
        const opened = await openDashboard(host(412, 823), baseUrl, SEEDED, {
            beforeLoad: () => {
                window.__cls = 0;
                new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            window.__cls += entry.value;
                        }
                    }
                }).observe({ type: "layout-shift", buffered: true });
                try { localStorage.setItem("nailit.lastSite", "sA"); } catch { /* none */ }
            },
        });
        await waitForRows(opened.page, ["Cement", "Sand"]);
        await opened.page.waitForTimeout(500);
        const cls = await opened.page.evaluate(() => window.__cls);
        assert.ok(cls < 0.05, `CLS ${cls}`);
        await opened.context.close();
    });
});

describe("one Add Site button, in the right place at each size", () => {
    it("resizing from a phone to a desktop moves it back under the sidebar heading, and back again", async () => {
        const { context, page } = await openDashboard(host(375), baseUrl, SEEDED);
        const where = () => page.evaluate(() => document.getElementById("addSiteButton").parentElement.id);
        assert.equal(await where(), "siteBar");
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => document.getElementById("addSiteButton").parentElement.id === "siteDrawer");
        assert.equal(await where(), "siteDrawer");
        assert.equal(await page.locator("#sitePickerButton").isVisible(), false);
        assert.equal(await page.locator("#addSiteButton").isVisible(), true);
        await page.setViewportSize({ width: 375, height: 700 });
        await page.waitForFunction(() => document.getElementById("addSiteButton").parentElement.id === "siteBar");
        assert.equal(await where(), "siteBar");
        await context.close();
    });
});
