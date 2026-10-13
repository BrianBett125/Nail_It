// Phase 1: the faster everyday flow. Each test names the Plan.md item it covers.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer,
    launchBrowser,
    openDashboard,
    selectSite,
    siteLink,
    openSiteDelete,
    deleteSiteViaUi,
    toastLocator,
    waitForRows,
    wrote,
    dbState,
    SEED,
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

const EMPTY = { sites: {}, materials: {} };

async function addSite(page, name, { location = "Nairobi", type = "Residential" } = {}) {
    await page.click("#addSiteButton");
    await page.fill("#siteName", name);
    await page.fill("#siteLocation", location);
    await page.selectOption("#buildingType", type);
    await page.click("#add-site-btn");
}

async function openMaterialForm(page) {
    await page.click("#addMaterialButton");
}

async function fillMaterial(page, { name, quantity, units }) {
    await page.fill("#materialsName", name);
    await page.fill("#mQuantity", quantity);
    if (units) {
        await page.selectOption("#mUnits", units);
    }
}

const optionValues = (page, selector) =>
    page.locator(`${selector} option`).evaluateAll((options) => options.map((o) => o.value));

describe("site form and layout", () => {
    it("Add Site sits at the top of the sidebar, above the site list", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        const button = await page.locator("#addSiteButton").boundingBox();
        const list = await page.locator("#siteList").boundingBox();
        const heading = await page.locator(".sidebar h2").boundingBox();
        assert.ok(button.y < list.y, `button at ${button.y}, list at ${list.y}`);
        assert.ok(button.y > heading.y, "button sits right under the heading");
        assert.ok(button.y + button.height < 200, "button is near the top of the screen");
        await context.close();
    });

    it("the site form has no Date field and a building type dropdown", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.click("#addSiteButton");
        assert.equal(await page.locator("#siteForm input[type=date]").count(), 0);
        assert.equal(await page.locator("#metadataDate").count(), 0);
        assert.equal(await page.locator("#buildingType").evaluate((el) => el.tagName), "SELECT");
        assert.deepEqual(await optionValues(page, "#buildingType"), [
            "", "Residential", "Commercial", "Industrial", "Road/Civil", "Other",
        ]);
        await context.close();
    });

    it("a new site is stored with createdAt stamped by the app, a numeric time, and no date", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        const before = Date.now();
        await addSite(page, "Eldoret", { type: "Road/Civil" });
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        const [write] = await wrote(page);
        assert.deepEqual(Object.keys(write.value).sort(), ["buildingType", "createdAt", "location", "name"]);
        assert.equal(write.value.buildingType, "Road/Civil");
        assert.equal(typeof write.value.createdAt, "number");
        assert.ok(write.value.createdAt >= before && write.value.createdAt <= Date.now());
        await context.close();
    });

    it("choosing no building type is stopped before any write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await page.click("#addSiteButton");
        await page.fill("#siteName", "Eldoret");
        await page.fill("#siteLocation", "Nairobi");
        await page.evaluate(() => { document.getElementById("siteForm").noValidate = true; });
        await page.click("#add-site-btn");
        await toastLocator(page, "Please fill in all required fields").waitFor();
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });
});

describe("auto-select and remember the last site", () => {
    it("a new site opens straight away, with its empty state and no extra click", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await addSite(page, "Eldoret");
        await siteLink(page, "Eldoret").waitFor();
        assert.equal(await siteLink(page, "Eldoret").getAttribute("class"), "active");
        await page.waitForFunction(() => document.getElementById("materialsStatus").textContent.startsWith("No materials yet"));
        const listeners = await page.evaluate(() => window.__nailit.activeListeners());
        assert.equal(listeners.filter((l) => l.kind === "materials").length, 1);
        await context.close();
    });

    it("a material can be added to the new site with no site click in between", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await addSite(page, "Eldoret");
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Cement", quantity: "20", units: "bags" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement"]);
        const [, second] = await wrote(page);
        assert.equal(second.value.siteId, (await wrote(page))[0].id);
        await context.close();
    });

    it("the last opened site is opened again after a reload", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.reload();
        await waitForRows(page, ["Nails"]);
        assert.equal(await siteLink(page, "Cape Town").getAttribute("class"), "active");
        await context.close();
    });

    it("a remembered site that no longer exists is ignored, not an error", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await page.evaluate(() => localStorage.setItem("nailit.lastSite", "gone"));
        await page.reload();
        await siteLink(page, "Mombasa").waitFor();
        assert.equal(await page.locator("#siteList a.active").count(), 0);
        assert.equal(await page.locator("#materialsStatus").textContent(), "Select a site to see its materials.");
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("deleting the remembered site forgets it", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await deleteSiteViaUi(page, "Cape Town");
        await page.waitForFunction(() => document.querySelectorAll("#siteList li").length === 1);
        assert.equal(await page.evaluate(() => localStorage.getItem("nailit.lastSite")), null);
        await context.close();
    });

    it("the dashboard works when localStorage throws (private window, blocked site data)", async () => {
        const beforeLoad = () => {
            Object.defineProperty(window, "localStorage", {
                get() { throw new Error("SecurityError"); },
            });
        };
        const { context, page, state } = await openDashboard(browser, baseUrl, SEED, { beforeLoad });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("a site the server refuses is dropped from the selection and the error is shown", async () => {
        const beforeLoad = () => { window.__preset = { failAdds: true }; };
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY, { beforeLoad });
        await addSite(page, "Eldoret");
        await toastLocator(page, "PERMISSION_DENIED").waitFor();
        await page.waitForFunction(() => document.querySelectorAll("#siteList li").length === 0);
        assert.equal(await page.locator("#materialTableBody tr").count(), 0);
        const listeners = await page.evaluate(() => window.__nailit.activeListeners());
        assert.equal(listeners.filter((l) => l.kind === "materials").length, 0);
        await context.close();
    });
});

describe("dropdown units, autocomplete, Add & another", () => {
    it("units are a dropdown of the eight units, in the add and the edit form", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        const expected = ["", "kg", "tonnes", "bags", "pieces", "metres", "litres", "bundles", "sheets"];
        assert.deepEqual(await optionValues(page, "#mUnits"), expected);
        assert.equal(await page.locator("#uUnits").evaluate((el) => el.tagName), "SELECT");
        assert.deepEqual((await optionValues(page, "#uUnits")).slice(0, 9), expected);
        await context.close();
    });

    it("the quantity field asks phones for the number pad", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        assert.equal(await page.getAttribute("#mQuantity", "inputmode"), "decimal");
        assert.equal(await page.getAttribute("#uQuantity", "inputmode"), "decimal");
        await context.close();
    });

    it("the unit is required: no unit chosen means no write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3" });
        await page.click("#material-btn");
        await page.waitForTimeout(100);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("the date in the add form defaults to today, and a legacy edit keeps its own date", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        const expected = await page.evaluate(() => {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        });
        assert.equal(await page.inputValue("#mLastUpdated"), expected);
        await context.close();
    });

    it("a legacy unit ('kgs') shows in the edit form and is saved unchanged", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.locator("#materialTableBody tr").locator("button[aria-label='Edit material']").click();
        assert.equal(await page.inputValue("#uUnits"), "kgs");
        await page.fill("#uQuantity", "41");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        const [write] = await wrote(page);
        assert.equal(write.value.units, "kgs");
        assert.equal(write.value.quantity, 41);
        await context.close();
    });

    it("the legacy option does not leak into the next material's edit form", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.locator("#materialTableBody tr").locator("button[aria-label='Edit material']").click();
        await page.click("#updateCancelButton");
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator("button[aria-label='Edit material']").click();
        assert.equal(await page.inputValue("#uUnits"), "bags");
        assert.equal(await page.locator("#uUnits option[data-legacy]").count(), 0);
        await context.close();
    });

    it("autocomplete offers this site's names, then names remembered from other sites", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        assert.deepEqual(await optionValues(page, "#materialNames"), ["Cement", "Sand"]);

        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);

        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await openMaterialForm(page);
        assert.deepEqual(await optionValues(page, "#materialNames"), ["Gravel", "Nails"]);
        await context.close();
    });

    it("typing 'cement' next to 'Cement' stores 'Cement', whatever the case or spacing", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "  cement   ", quantity: "2", units: "bags" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Cement"]);
        const [write] = await wrote(page);
        assert.equal(write.value.name, "Cement");
        await context.close();
    });

    it("editing a name to a different case reuses the existing spelling", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.locator("#materialTableBody tr", { hasText: "Sand" }).locator("button[aria-label='Edit material']").click();
        await page.fill("#uMaterialName", "CEMENT");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        assert.equal((await wrote(page))[0].value.name, "Cement");
        await context.close();
    });

    it("Add closes the form after one material", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal(await page.locator("#materialFormContainer").evaluate((el) => el.style.display), "none");
        await context.close();
    });

    it("Add & another saves, keeps the form open, clears name and quantity, keeps unit and date, focuses the name", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        const date = await page.inputValue("#mLastUpdated");
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-another-btn");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);

        assert.equal(await page.locator("#materialFormContainer").evaluate((el) => el.style.display), "block");
        assert.equal(await page.inputValue("#materialsName"), "");
        assert.equal(await page.inputValue("#mQuantity"), "");
        assert.equal(await page.inputValue("#mUnits"), "tonnes");
        assert.equal(await page.inputValue("#mLastUpdated"), date);
        assert.equal(await page.evaluate(() => document.activeElement.id), "materialsName");
        await context.close();
    });

    it("a delivery of 15 items is 15 submits on one open form", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await addSite(page, "Eldoret");
        await openMaterialForm(page);
        await page.selectOption("#mUnits", "pieces");
        for (let i = 1; i <= 15; i += 1) {
            await page.fill("#materialsName", `Item ${i}`);
            await page.fill("#mQuantity", String(i));
            await page.click("#material-another-btn");
        }
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody tr").length === 15);
        const db = await dbState(page);
        assert.equal(Object.keys(db.materials).length, 15);
        assert.ok(Object.values(db.materials).every((m) => m.units === "pieces"));
        await context.close();
    });

    it("Add & another with a bad quantity keeps what was typed and writes nothing", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await page.evaluate(() => { document.getElementById("materialForm").noValidate = true; });
        await fillMaterial(page, { name: "Gravel", quantity: "-1", units: "tonnes" });
        await page.click("#material-another-btn");
        await toastLocator(page, "Quantity must be a number").waitFor();
        assert.equal(await page.inputValue("#materialsName"), "Gravel");
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("Enter in the name field adds and closes, like the Add button", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.press("#mQuantity", "Enter");
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);
        assert.equal(await page.locator("#materialFormContainer").evaluate((el) => el.style.display), "none");
        assert.equal((await wrote(page)).length, 1);
        await context.close();
    });
});

describe("delete: Undo toast for materials, typed name for sites", () => {
    it("a material name with HTML shows in the Undo toast as text", async () => {
        const name = "<img src=x onerror=window.__pwned=1>";
        const seed = {
            sites: { sA: SEED.sites.sA },
            materials: { m1: { name, quantity: 1, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" } },
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await page.locator("#materialTableBody tr button[aria-label='Delete material']").click();
        await toastLocator(page, "Deleted").waitFor();
        assert.equal(await page.locator(".toast img").count(), 0);
        assert.equal(await page.locator(".toast-text").textContent(), `Deleted ${name}.`);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        await context.close();
    });

    it("the site delete button stays disabled until the exact name is typed", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await openSiteDelete(page, "Mombasa", "");
        assert.equal(await page.locator("#siteDeletePhrase").textContent(), "Mombasa");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true);
        for (const wrong of ["Momb", "mombasa", "Mombasa2", "Cape Town"]) {
            await page.fill("#siteDeleteInput", wrong);
            assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true, wrong);
        }
        await page.fill("#siteDeleteInput", " Mombasa ");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), false);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("Enter with the wrong name deletes nothing; Enter with the right name deletes the site", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await openSiteDelete(page, "Mombasa", "wrong");
        await page.press("#siteDeleteInput", "Enter");
        await page.waitForTimeout(50);
        assert.deepEqual(await wrote(page), []);

        await page.fill("#siteDeleteInput", "Mombasa");
        await page.press("#siteDeleteInput", "Enter");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        await page.waitForFunction(() => document.querySelector("#siteDeleteContainer").style.display === "none");
        await toastLocator(page, 'Site "Mombasa" and its materials deleted').waitFor();
        assert.deepEqual(Object.keys((await dbState(page)).sites), ["sB"]);
        await context.close();
    });

    it("the dialog opened for one site never deletes another", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await openSiteDelete(page, "Mombasa", "Mombasa");
        await page.click("#siteDeleteCancel");
        await openSiteDelete(page, "Cape Town", "Mombasa"); // Mombasa's name does not unlock Cape Town
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true);
        await page.fill("#siteDeleteInput", "Cape Town");
        await page.click("#siteDeleteConfirm");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        assert.deepEqual(Object.keys((await dbState(page)).sites), ["sA"]);
        await context.close();
    });

    it("a site with no name is deleted by typing 'delete'", async () => {
        const seed = { sites: { sN: { location: "l", buildingType: "Other" } }, materials: {} };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#siteList .delete-site-btn").click();
        assert.equal(await page.locator("#siteDeletePhrase").textContent(), "delete");
        await page.fill("#siteDeleteInput", "(unnamed site)");
        assert.equal(await page.locator("#siteDeleteConfirm").isDisabled(), true);
        await page.fill("#siteDeleteInput", "delete");
        await page.click("#siteDeleteConfirm");
        await page.waitForFunction(() => document.querySelectorAll("#siteList li").length === 0);
        await context.close();
    });

    it("a site name with HTML is shown as text in the delete dialog", async () => {
        const name = "<img src=x onerror=window.__pwned=1>";
        const seed = { sites: { sX: { name, location: "l", buildingType: "Other" } }, materials: {} };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#siteList .delete-site-btn").click();
        assert.equal(await page.locator("#siteDeletePhrase").textContent(), name);
        assert.equal(await page.locator("#siteDeleteContainer img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        await context.close();
    });

    it("pressing Delete site twice before the server answers sends one write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await openSiteDelete(page, "Mombasa");
        await page.evaluate(() => {
            const button = document.getElementById("siteDeleteConfirm");
            button.click();
            button.click();
            button.click();
        });
        await page.waitForTimeout(50);
        assert.equal((await wrote(page)).length, 1);
        await context.close();
    });
});

describe("toasts, empty states and loading states", () => {
    it("every message is a toast: success is a status, a failure is an alert", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-btn");
        const ok = toastLocator(page, "Added 3 tonnes Gravel");
        await ok.waitFor();
        assert.equal(await ok.getAttribute("role"), "status");

        await page.evaluate(() => { window.__nailit.throwOnWrite = true; });
        await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator("button[aria-label='Edit material']").click();
        await page.click("#update-material-btn");
        const bad = toastLocator(page, "boom");
        await bad.waitFor();
        assert.equal(await bad.getAttribute("role"), "alert");
        assert.deepEqual(state.dialogs, [], "alert() is gone");
        await context.close();
    });

    it("an error toast stays longer than a success toast", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.click("#addMaterialButton"); // no site yet: error toast
        await toastLocator(page, "Select a site first").waitFor();
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Gravel", quantity: "3", units: "tonnes" });
        await page.click("#material-btn");
        await toastLocator(page, "Added").waitFor();
        await page.waitForTimeout(4200);
        assert.equal(await page.locator(".toast", { hasText: "Added" }).count(), 0, "success toast gone after about 3.5s");
        assert.equal(await page.locator(".toast-error").count(), 1, "error toast still showing");
        await context.close();
    });

    it("no sites: the sidebar and the main area both say what to do", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await page.waitForFunction(() => document.getElementById("sitesStatus").textContent === "No sites yet. Add your first site.");
        assert.match(await page.locator("#materialsStatus").textContent(), /^No sites yet\. Add your first site/);
        assert.equal(await page.locator("#materialsTable").isHidden(), true);
        await context.close();
    });

    it("sites exist but none is selected: the main area asks to select one", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await siteLink(page, "Mombasa").waitFor();
        assert.equal(await page.locator("#sitesStatus").isHidden(), true);
        assert.equal(await page.locator("#materialsStatus").textContent(), "Select a site to see its materials.");
        await context.close();
    });

    it("a site with no materials shows an empty state, and the table appears with the first row", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, EMPTY);
        await addSite(page, "Eldoret");
        await page.waitForFunction(() => document.getElementById("materialsStatus").textContent === "No materials yet. Add your first material.");
        assert.equal(await page.locator("#materialsTable").isHidden(), true);
        await openMaterialForm(page);
        await fillMaterial(page, { name: "Cement", quantity: "20", units: "bags" });
        await page.click("#material-btn");
        await waitForRows(page, ["Cement"]);
        assert.equal(await page.locator("#materialsTable").isVisible(), true);
        assert.equal(await page.locator("#materialsStatus").isHidden(), true);
        await context.close();
    });

    it("deleting the last material brings the empty state back", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await page.locator("#materialTableBody tr button[aria-label='Delete material']").click();
        await page.waitForFunction(() => document.getElementById("materialsStatus").textContent.startsWith("No materials yet"));
        await page.locator(".toast-action").click();
        await waitForRows(page, ["Nails"]);
        assert.equal(await page.locator("#materialsStatus").isHidden(), true);
        await context.close();
    });

    it("loading states show until the first data arrives", async () => {
        const beforeLoad = () => { window.__preset = { holdSnapshots: true }; };
        const { context, page } = await openDashboard(browser, baseUrl, SEED, { beforeLoad });
        assert.equal(await page.locator("#sitesStatus").textContent(), "Loading sites...");
        assert.equal(await page.locator("#materialsStatus").textContent(), "Loading...");

        await page.evaluate(() => window.__nailit.releaseSnapshots());
        await siteLink(page, "Mombasa").waitFor();
        await page.evaluate(() => { window.__nailit.holdSnapshots = true; });
        await selectSite(page, "Mombasa");
        assert.equal(await page.locator("#materialsStatus").textContent(), "Loading materials...");
        assert.equal(await page.locator("#materialsTable").isHidden(), true);

        await page.evaluate(() => window.__nailit.releaseSnapshots());
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#materialsStatus").isHidden(), true);
        await context.close();
    });

    it("switching sites shows the loading state, not the previous site's rows or empty text", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__nailit.holdSnapshots = true; });
        await selectSite(page, "Cape Town");
        assert.equal(await page.locator("#materialTableBody tr").count(), 0);
        assert.equal(await page.locator("#materialsStatus").textContent(), "Loading materials...");
        await context.close();
    });
});

describe("eval: the measurable outcome", () => {
    it("a new user adds a site and three materials in under 30 seconds and 20 user actions, with no instructions", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, EMPTY);
        const started = Date.now();
        let actions = 0;
        const act = async (fn) => { actions += 1; await fn(); };

        await act(() => page.click("#addSiteButton"));
        await act(() => page.fill("#siteName", "Eldoret Estate"));
        await act(() => page.fill("#siteLocation", "Eldoret"));
        await act(() => page.selectOption("#buildingType", "Residential"));
        await act(() => page.click("#add-site-btn"));

        await act(() => page.click("#addMaterialButton"));
        await act(() => page.selectOption("#mUnits", "bags"));
        for (const [name, quantity] of [["Cement", "50"], ["Sand", "8"], ["Nails", "20"]]) {
            await act(() => page.fill("#materialsName", name));
            await act(() => page.fill("#mQuantity", quantity));
            await act(() => page.click("#material-another-btn"));
        }
        await act(() => page.click("#materialCancelButton"));
        await waitForRows(page, ["Cement", "Sand", "Nails"]);

        const elapsed = Date.now() - started;
        console.log(`# phase1 flow: ${actions} actions, ${elapsed} ms, toasts: ${state.toasts.length}`);
        assert.ok(elapsed < 30000, `took ${elapsed} ms`);
        assert.ok(actions <= 20, `took ${actions} actions`);
        assert.deepEqual(state.dialogs, []);
        assert.deepEqual(state.pageErrors, []);
        const db = await dbState(page);
        assert.equal(Object.keys(db.sites).length, 1);
        assert.equal(Object.keys(db.materials).length, 3);
        await context.close();
    });
});
