// Phase 5: every dialog on the dashboard is a native <dialog> opened with showModal(), which gives, for free
// and the same everywhere: a focus trap, Escape to close, an inert page behind it and a modal role for screen
// readers. This is the contract: any markup and styling that keeps these ids and these behaviors passes.
//
//   id                    opener                       first focus         closes with
//   siteFormContainer     #addSiteButton               #siteName           #cancelButton
//   materialFormContainer #addMaterialButton           #materialsName      #materialCancelButton
//   updateFormContainer   row .btn-edit                #uMaterialName      #updateCancelButton
//   siteDeleteContainer   a site's .delete-site-btn    #siteDeleteInput    #siteDeleteCancel
//   membersContainer      #membersButton               #membersClose       #membersClose
//   movementContainer     row .btn-use                 #movementAmount     #movementCancel
//   historyContainer      row .btn-history             #historyClose       #historyClose
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer, launchBrowser, openDashboard, selectSite, waitForRows, wrote, SEED,
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
const now = Date.now();
const SEEDED = {
    ...SEED,
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", updatedAt: now - 3 * HOUR, siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
    movements: {
        v1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -5, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR },
    },
};

// On a phone the site list lives in the drawer, so a person reaches the trash can by opening the drawer first.
async function openSiteDelete(page) {
    const picker = page.locator("#sitePickerButton");
    if (await picker.isVisible()) await picker.click();
    await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
}

const row = (page, name) => page.locator("#materialTableBody tr", { hasText: name });

// id, how to open it, the element that has focus first, and what closes it.
const DIALOGS = [
    { id: "siteFormContainer", focus: "#siteName", close: "#cancelButton", open: (page) => page.click("#addSiteButton") },
    { id: "materialFormContainer", focus: "#materialsName", close: "#materialCancelButton", open: (page) => page.click("#addMaterialButton") },
    { id: "updateFormContainer", focus: "#uMaterialName", close: "#updateCancelButton", open: (page) => row(page, "Cement").locator(".btn-edit").click(), opener: (page) => row(page, "Cement").locator(".btn-edit") },
    { id: "siteDeleteContainer", focus: "#siteDeleteInput", close: "#siteDeleteCancel", open: openSiteDelete, opener: (page) => page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn"), phoneFoldsOpener: true },
    { id: "membersContainer", focus: "#membersClose", close: "#membersClose", open: (page) => page.click("#membersButton") },
    { id: "movementContainer", focus: "#movementAmount", close: "#movementCancel", open: (page) => row(page, "Cement").locator(".btn-use").click(), opener: (page) => row(page, "Cement").locator(".btn-use") },
    { id: "historyContainer", focus: "#historyClose", close: "#historyClose", open: (page) => row(page, "Cement").locator(".btn-history").click(), opener: (page) => row(page, "Cement").locator(".btn-history") },
];

async function open(viewport) {
    const host = {
        newContext: () => browser.newContext({
            viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600,
        }),
    };
    const opened = await openDashboard(host, baseUrl, SEEDED);
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, ["Cement", "Sand"]);
    return opened;
}

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).open === true, id);
const inside = (page, id) => page.evaluate((i) => document.getElementById(i).contains(document.activeElement), id);

for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 375, height: 700 }]]) {
    for (const dialog of DIALOGS) {
        describe(`${dialog.id} on a ${name}`, () => {
            it("is a native <dialog>, closed at first, and opens as a modal", async () => {
                const { context, page } = await open(viewport);
                const facts = await page.evaluate((id) => {
                    const el = document.getElementById(id);
                    return { tag: el.tagName, open: el.open };
                }, dialog.id);
                assert.deepEqual(facts, { tag: "DIALOG", open: false });
                await dialog.open(page);
                assert.equal(await isOpen(page, dialog.id), true);
                assert.equal(await page.evaluate((id) => document.getElementById(id).matches(":modal"), dialog.id), true, "opened with showModal, so it is modal");
                await context.close();
            });

            it("has a name a screen reader can read", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                const name = await page.evaluate((id) => {
                    const el = document.getElementById(id);
                    const labelled = el.getAttribute("aria-labelledby");
                    const text = labelled ? labelled.split(/\s+/).map((i) => (document.getElementById(i) || {}).textContent || "").join(" ") : el.getAttribute("aria-label");
                    return (text || "").trim();
                }, dialog.id);
                assert.ok(name.length >= 3, `the dialog has no accessible name (aria-labelledby or aria-label): "${name}"`);
                await context.close();
            });

            it("puts focus inside, on the right control", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                assert.equal(await page.evaluate(() => document.activeElement.id), dialog.focus.slice(1));
                await context.close();
            });

            it("keeps Tab and Shift+Tab inside, and the page behind cannot be focused", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                for (let i = 0; i < 12; i += 1) {
                    await page.keyboard.press("Tab");
                    assert.equal(await inside(page, dialog.id), true, `Tab ${i + 1} left the dialog`);
                }
                for (let i = 0; i < 12; i += 1) {
                    await page.keyboard.press("Shift+Tab");
                    assert.equal(await inside(page, dialog.id), true, `Shift+Tab ${i + 1} left the dialog`);
                }
                await page.evaluate(() => {
                    const behind = document.querySelector("header a") || document.body;
                    behind.focus();
                });
                assert.equal(await inside(page, dialog.id), true, "something behind the dialog took focus");
                await context.close();
            });

            it("closes with Escape and gives focus back to what opened it", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                await page.keyboard.press("Escape");
                assert.equal(await isOpen(page, dialog.id), false);
                if (dialog.opener && !(dialog.phoneFoldsOpener && viewport.width < 600)) {
                    const returned = await dialog.opener(page).evaluate((el) => el === document.activeElement);
                    assert.equal(returned, true, "focus did not return to the button that opened the dialog");
                } else {
                    assert.notEqual(await page.evaluate(() => document.activeElement.tagName), "BODY", "focus was dropped on the page");
                }
                assert.deepEqual(await wrote(page), [], "closing writes nothing");
                await context.close();
            });

            it("closes with its own close button, and can be opened again", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                await page.click(dialog.close);
                assert.equal(await isOpen(page, dialog.id), false);
                await dialog.open(page);
                assert.equal(await isOpen(page, dialog.id), true);
                await context.close();
            });

            it("fits the screen: nothing pokes out of the sides, and it scrolls inside if it is tall", async () => {
                const { context, page } = await open(viewport);
                await dialog.open(page);
                const box = await page.evaluate((id) => {
                    const r = document.getElementById(id).getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
                }, dialog.id);
                assert.ok(box.left >= -1 && box.right <= box.vw + 1, `wider than the screen: ${JSON.stringify(box)}`);
                assert.ok(box.top >= -1 && box.bottom <= box.vh + 1, `taller than the screen: ${JSON.stringify(box)}`);
                await context.close();
            });
        });
    }
}

describe("the sheets close when the dimmed area is tapped", () => {
    for (const id of ["movementContainer", "historyContainer"]) {
        it(`${id}`, async () => {
            const { context, page } = await open({ width: 375, height: 700 });
            await DIALOGS.find((d) => d.id === id).open(page);
            await page.mouse.click(5, 5); // the backdrop, above the sheet
            assert.equal(await isOpen(page, id), false);
            await context.close();
        });
    }
});

describe("one dialog at a time, and the page does not scroll behind it", () => {
    it("the page behind a dialog does not scroll", async () => {
        const { context, page } = await open({ width: 375, height: 700 });
        await page.click("#addMaterialButton");
        const before = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.scrollY), before);
        await context.close();
    });

    it("opening a second dialog closes the first", async () => {
        const { context, page } = await open({ width: 1280, height: 800 });
        await page.evaluate(() => document.getElementById("addMaterialButton").click());
        await page.evaluate(() => document.getElementById("membersButton").click());
        const states = await page.evaluate(() => [...document.querySelectorAll("dialog")].filter((d) => d.open).map((d) => d.id));
        assert.ok(states.length <= 1, `open at once: ${states.join(", ")}`);
        await context.close();
    });
});

describe("what a dialog does is unchanged", () => {
    it("the add material dialog still saves, and closes", async () => {
        const { context, page } = await open({ width: 1280, height: 800 });
        await page.click("#addMaterialButton");
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "3");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal(await isOpen(page, "materialFormContainer"), false);
        await context.close();
    });

    it("Add & another keeps the dialog open", async () => {
        const { context, page } = await open({ width: 1280, height: 800 });
        await page.click("#addMaterialButton");
        await page.fill("#materialsName", "Gravel");
        await page.fill("#mQuantity", "3");
        await page.selectOption("#mUnits", "tonnes");
        await page.click("#material-another-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal(await isOpen(page, "materialFormContainer"), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), "materialsName");
        await context.close();
    });

    it("the site delete dialog stays disabled until the name is typed, then deletes", async () => {
        const { context, page } = await open({ width: 1280, height: 800 });
        await DIALOGS.find((d) => d.id === "siteDeleteContainer").open(page);
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true);
        await page.fill("#siteDeleteInput", "Mombasa");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), false);
        await page.click("#siteDeleteConfirm");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        assert.equal(await isOpen(page, "siteDeleteContainer"), false);
        await context.close();
    });

    it("a dialog that was open when its site disappeared closes by itself", async () => {
        const { context, page } = await open({ width: 1280, height: 800 });
        await DIALOGS.find((d) => d.id === "movementContainer").open(page);
        await page.evaluate(() => window.__nailit.externalRemoveSite("sA"));
        await page.waitForFunction(() => !document.getElementById("movementContainer").open);
        await context.close();
    });
});
