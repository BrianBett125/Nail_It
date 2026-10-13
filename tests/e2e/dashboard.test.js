import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer,
    launchBrowser,
    openDashboard,
    selectSite,
    siteLink,
    waitForRows,
    rowTexts,
    wrote,
    dbState,
    junkPaths,
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

async function fillSiteForm(page, name) {
    await page.click("#addSiteButton");
    await page.fill("#siteName", name);
    await page.fill("#siteLocation", "Nairobi");
    await page.fill("#buildingType", "Residential");
    await page.fill("#metadataDate", "2024-06-01");
    await page.click("#add-site-btn");
}

async function fillMaterialForm(page, { name, quantity }) {
    await page.click("#addMaterialButton");
    await page.fill("#materialsName", name);
    await page.fill("#mQuantity", quantity);
    await page.fill("#mUnits", "bags");
    await page.fill("#mLastUpdated", "2024-06-02");
    await page.click("#material-btn");
}

function editButton(page, material) {
    return page.locator("#materialTableBody tr", { hasText: material }).locator("button[aria-label='Edit material']");
}

function deleteMaterialButton(page, material) {
    return page.locator("#materialTableBody tr", { hasText: material }).locator("button[aria-label='Delete material']");
}

describe("dashboard core behavior (Phase 0)", () => {
    it("B1: editing a material makes exactly one write, at its own path", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);

        await editButton(page, "Cement").click();
        await page.fill("#uQuantity", "8");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => document.querySelector("#updateFormContainer").style.display === "none");

        const writes = await wrote(page);
        assert.equal(writes.length, 1, `expected one write, got ${JSON.stringify(writes)}`);
        assert.equal(writes[0].path, "materials/m1");
        assert.equal(writes[0].value.quantity, 8);
        assert.equal(typeof writes[0].value.quantity, "number");
        assert.deepEqual(junkPaths(writes), []);
        assert.deepEqual(Object.keys((await dbState(page)).materials).sort(), ["m1", "m2", "m3"]);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("B1: a second edit after the first still writes once, to the right material", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);

        await editButton(page, "Cement").click();
        await page.fill("#uQuantity", "6");
        await page.click("#update-material-btn");
        await editButton(page, "Sand").click();
        await page.fill("#uQuantity", "11");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length >= 2);

        const writes = await wrote(page);
        assert.deepEqual(writes.map((w) => w.path), ["materials/m1", "materials/m2"]);
        await context.close();
    });

    it("B2: adding a site does not reload the page, and the selected site stays selected", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__marker = "same-page"; });

        await fillSiteForm(page, "Kisumu");
        await siteLink(page, "Kisumu").waitFor();

        assert.equal(await page.evaluate(() => window.__marker), "same-page", "page reloaded");
        assert.equal(await siteLink(page, "Mombasa").getAttribute("class"), "active");
        assert.deepEqual(await rowTexts(page), ["Cement", "Sand"]);
        assert.equal(await page.inputValue("#siteName"), "", "form should be cleared after a successful add");
        assert.ok(state.dialogs.includes("Added successfully!"));
        await context.close();
    });

    it("B2: adding a material does not reload the page and shows the new row", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__marker = "same-page"; });

        await fillMaterialForm(page, { name: "Gravel", quantity: "3" });
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);

        assert.equal(await page.evaluate(() => window.__marker), "same-page", "page reloaded");
        assert.equal(await siteLink(page, "Mombasa").getAttribute("class"), "active");
        await context.close();
    });

    it("B3: switching sites leaves one materials listener and no stale rows", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);

        const listeners = await page.evaluate(() => window.__nailit.activeListeners());
        assert.deepEqual(listeners.filter((l) => l.kind === "materials"), [{ kind: "materials", siteId: "sB" }]);

        // Somebody else adds stock to the site we left. Our table must not change.
        await page.evaluate(() => window.__nailit.externalSetMaterial("m9", {
            name: "Bricks", quantity: 1, units: "pieces", lastUpdated: "2024-06-03", siteId: "sA",
        }));
        await page.waitForTimeout(100);
        assert.deepEqual(await rowTexts(page), ["Nails"]);
        await context.close();
    });

    it("S2: a site named with HTML renders as text and runs nothing", async () => {
        const payload = '<img src=x onerror="window.__xss=1">';
        const seed = {
            sites: { sX: { name: payload, location: "l", buildingType: "t", date: "2024-01-01" } },
            materials: {},
        };
        const { context, page, state } = await openDashboard(browser, baseUrl, seed);
        await page.waitForTimeout(200);

        assert.equal(await page.locator("#siteList img").count(), 0);
        assert.equal(await page.locator("#siteList a").textContent(), payload);
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("S2: a name typed into the Add Site form is stored and shown as text", async () => {
        const payload = "<b onmouseover=alert(1)>x</b>";
        const { context, page } = await openDashboard(browser, baseUrl);
        await fillSiteForm(page, payload);
        await siteLink(page, "onmouseover").waitFor();

        assert.equal(await page.locator("#siteList b").count(), 0);
        assert.equal((await wrote(page))[0].value.name, payload);
        await context.close();
    });

    it("B4: deleting a site is one write that covers the site and only its materials", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);

        await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
        await page.waitForFunction(() => window.__nailit.writes.length > 0);
        await waitForRows(page, []);

        const writes = await wrote(page);
        assert.equal(writes.length, 1, "cascade must be a single write");
        assert.equal(writes[0].op, "multi");
        assert.deepEqual(Object.keys(writes[0].paths).sort(), ["materials/m1", "materials/m2", "sites/sA"]);
        assert.ok(Object.values(writes[0].paths).every((v) => v === null));

        const db = await dbState(page);
        assert.deepEqual(Object.keys(db.sites), ["sB"]);
        assert.deepEqual(Object.keys(db.materials), ["m3"]);
        assert.equal(await page.locator("#siteList a.active").count(), 0, "deleted site must not stay selected");
        await context.close();
    });

    it("B4: clicking the trash icon itself (not just the button edge) deletes the right site", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await siteLink(page, "Cape Town").waitFor();
        // The Font Awesome kit is stubbed out here, so the <i> has no size and cannot be
        // clicked with the mouse. A DOM click on it has the same event.target a real tap has.
        await page.locator("#siteList li", { hasText: "Cape Town" })
            .locator(".delete-site-btn i")
            .evaluate((icon) => icon.click());
        await page.waitForFunction(() => window.__nailit.writes.length > 0);
        const writes = await wrote(page);
        assert.deepEqual(Object.keys(writes[0].paths).sort(), ["materials/m3", "sites/sB"]);
        await context.close();
    });

    it("B5: every id on the dashboard is unique", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        const duplicates = await page.evaluate(() => {
            const seen = new Map();
            document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1));
            return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
        });
        assert.deepEqual(duplicates, []);
        await context.close();
    });

    it("B9: adding a material with no site selected says 'Select a site first' and writes nothing", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await fillMaterialForm(page, { name: "Cement", quantity: "5" });
        await page.waitForFunction(() => true);

        assert.deepEqual(state.dialogs, ["Select a site first"]);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("B8: quantity is stored as a number", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await fillMaterialForm(page, { name: "Gravel", quantity: "12.5" });
        await waitForRows(page, ["Cement", "Sand", "Gravel"]);

        const [write] = await wrote(page);
        assert.strictEqual(write.value.quantity, 12.5);
        assert.equal(write.value.siteId, "sA");
        await context.close();
    });

    it("B8: a negative quantity is rejected even if browser validation is bypassed", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { document.getElementById("materialForm").noValidate = true; });
        await fillMaterialForm(page, { name: "Gravel", quantity: "-5" });
        await page.waitForFunction(() => true);

        assert.deepEqual(state.dialogs, ["Quantity must be a number, zero or more"]);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("B8: a negative quantity is stopped by the browser form before any write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await fillMaterialForm(page, { name: "Gravel", quantity: "-5" });
        await page.waitForTimeout(100);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("deleting a material uses the confirm modal and removes only that row", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);

        await deleteMaterialButton(page, "Cement").click();
        await page.click("#delCancelButton");
        assert.deepEqual(await wrote(page), [], "cancel must not delete");

        await deleteMaterialButton(page, "Cement").click();
        await page.click("#del-yes-btn");
        await waitForRows(page, ["Sand"]);
        assert.deepEqual((await wrote(page)).map((w) => w.path), ["materials/m1"]);
        await context.close();
    });
});

describe("hardening: gaps found by the cold critic", () => {
    it("B3: a late callback from a site we left is ignored", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);

        await page.evaluate(() => window.__nailit.replayUnsubscribed());
        await page.waitForTimeout(100);
        assert.deepEqual(await rowTexts(page), ["Nails"]);
        await context.close();
    });

    it("S2: material name, units and date render as text, never as HTML", async () => {
        const payload = '<img src=x onerror="window.__xss=1">';
        const seed = {
            sites: { sA: SEED.sites.sA },
            materials: {
                m1: { name: payload, quantity: payload, units: payload, lastUpdated: payload, siteId: "sA" },
            },
        };
        const { context, page, state } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await page.locator("#materialTableBody tr").first().waitFor();

        assert.equal(await page.locator("#materialTableBody img").count(), 0);
        const cells = await page.locator("#materialTableBody tr td").allTextContents();
        assert.deepEqual(cells.slice(0, 4), [payload, payload, payload, payload]);
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("S2: a site name cannot break out of an attribute", async () => {
        const name = '" onfocus="window.__xss=1" autofocus x="';
        const seed = {
            sites: { sX: { name, location: "l", buildingType: "t", date: "2024-01-01" } },
            materials: {},
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#siteList li").first().waitFor();

        const extra = await page.evaluate(() => [...document.querySelectorAll("#siteList *")]
            .flatMap((el) => [...el.attributes].map((a) => a.name))
            .filter((n) => n.startsWith("on") || n === "autofocus" || n === "x"));
        assert.deepEqual(extra, []);
        assert.equal(
            await page.locator(".delete-site-btn").getAttribute("aria-label"),
            `Delete site ${name}`,
        );
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        await context.close();
    });

    it("deleting the selected site drops the materials listener and empties the table", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".delete-site-btn").click();
        await waitForRows(page, []);
        await page.waitForTimeout(50);

        const listeners = await page.evaluate(() => window.__nailit.activeListeners());
        assert.deepEqual(listeners.filter((l) => l.kind === "materials"), []);
        await context.close();
    });

    it("cancelling the delete confirmation forgets the material", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await deleteMaterialButton(page, "Cement").click();
        await page.click("#delCancelButton");
        // Fire Yes while the modal is hidden, as a stray event or a script would.
        await page.evaluate(() => document.getElementById("del-yes-btn").click());
        await page.waitForTimeout(50);

        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("a legacy site with no name still has a visible, labelled link", async () => {
        const seed = {
            sites: { sN: { location: "l", buildingType: "t", date: "2024-01-01" } },
            materials: {},
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#siteList a").waitFor();

        assert.equal(await page.locator("#siteList a").textContent(), "(unnamed site)");
        assert.equal(await page.locator(".delete-site-btn").getAttribute("aria-label"), "Delete site (unnamed site)");
        await context.close();
    });

    it("an edit modal closes when its material is removed by someone else, and writes nothing", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await editButton(page, "Cement").click();
        await page.evaluate(() => window.__nailit.externalRemoveMaterial("m1"));
        await waitForRows(page, ["Sand"]);

        await page.waitForFunction(() => document.querySelector("#updateFormContainer").style.display === "none");
        await page.evaluate(() => document.getElementById("updateForm").requestSubmit());
        await page.waitForTimeout(50);
        assert.deepEqual(await wrote(page), [], "update() on a missing path would create an orphan node");
        await context.close();
    });

    it("a delete confirmation closes when its material is already gone", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await deleteMaterialButton(page, "Cement").click();
        await page.evaluate(() => window.__nailit.externalRemoveMaterial("m1"));
        await waitForRows(page, ["Sand"]);

        await page.waitForFunction(() => document.querySelector("#deleteFormContainer").style.display === "none");
        await context.close();
    });

    it("pressing Update again before the server answers does not send the edit twice", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await editButton(page, "Cement").click();
        await page.fill("#uQuantity", "9");

        await page.evaluate(() => {
            const form = document.getElementById("updateForm");
            form.requestSubmit();
            form.requestSubmit();
            form.requestSubmit();
        });
        await page.waitForTimeout(50);
        assert.equal((await wrote(page)).length, 1);

        await page.evaluate(() => window.__nailit.releaseAcks());
        await page.waitForFunction(() => !document.getElementById("update-material-btn").disabled);
        await context.close();
    });
});

describe("hardening round 2: slow or missing signal", () => {
    async function openMombasa() {
        const opened = await openDashboard(browser, baseUrl);
        await selectSite(opened.page, "Mombasa");
        await waitForRows(opened.page, ["Cement", "Sand"]);
        return opened;
    }

    it("a late ack for a finished edit does not close the modal of the next edit", async () => {
        const { context, page } = await openMombasa();
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await editButton(page, "Cement").click();
        await page.fill("#uQuantity", "9");
        await page.click("#update-material-btn");
        await page.click("#updateCancelButton");
        await editButton(page, "Sand").click();

        await page.evaluate(() => window.__nailit.releaseAcks());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.querySelector("#updateFormContainer").style.display), "block");

        await page.fill("#uQuantity", "12");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 2);
        assert.deepEqual((await wrote(page)).map((w) => w.path), ["materials/m1", "materials/m2"]);
        await context.close();
    });

    it("one unacknowledged edit does not block editing a different material", async () => {
        const { context, page } = await openMombasa();
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await editButton(page, "Cement").click();
        await page.click("#update-material-btn");
        await page.waitForFunction(() => document.getElementById("update-material-btn").textContent === "Saving...");
        await page.click("#updateCancelButton");

        await editButton(page, "Sand").click();
        assert.equal(await page.locator("#update-material-btn").isDisabled(), false);
        assert.equal(await page.locator("#update-material-btn").textContent(), "Update");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 2);
        await context.close();
    });

    it("pressing Yes again before the server answers does not delete twice", async () => {
        const { context, page } = await openMombasa();
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await deleteMaterialButton(page, "Cement").click();
        await page.evaluate(() => {
            const yes = document.getElementById("del-yes-btn");
            yes.click();
            yes.click();
            yes.click();
        });
        await page.waitForTimeout(50);
        assert.equal((await wrote(page)).filter((w) => w.op === "remove").length, 1);

        await page.evaluate(() => window.__nailit.releaseAcks());
        await page.waitForFunction(() => document.querySelector("#deleteFormContainer").style.display === "none");
        assert.equal(await page.locator("#del-yes-btn").textContent(), "Yes");
        assert.equal(await page.locator("#del-yes-btn").isDisabled(), false);
        await context.close();
    });

    it("a late delete ack does not close the confirmation of a different material", async () => {
        const { context, page } = await openMombasa();
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await deleteMaterialButton(page, "Cement").click();
        await page.click("#del-yes-btn");
        // Firebase applies the delete locally at once, so the Cement row and its modal go away
        // while the ack is still on its way. Open the next confirmation before the ack lands.
        await waitForRows(page, ["Sand"]);
        await deleteMaterialButton(page, "Sand").click();
        await page.evaluate(() => window.__nailit.releaseAcks());
        await page.waitForTimeout(100);

        assert.equal(await page.evaluate(() => document.querySelector("#deleteFormContainer").style.display), "block");
        await context.close();
    });

    it("after an ack the same material can be edited again (nothing stays stuck on 'Saving...')", async () => {
        const { context, page } = await openMombasa();
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await editButton(page, "Cement").click();
        await page.click("#update-material-btn");
        await page.evaluate(() => window.__nailit.releaseAcks());
        await page.waitForFunction(() => document.querySelector("#updateFormContainer").style.display === "none");

        await page.evaluate(() => { window.__nailit.holdAcks = false; });
        await editButton(page, "Cement").click();
        assert.equal(await page.locator("#update-material-btn").isDisabled(), false);
        assert.equal(await page.locator("#update-material-btn").textContent(), "Update");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 2);
        await context.close();
    });

    it("a data layer that throws straight away reports the error and leaves the form usable", async () => {
        const { context, page, state } = await openMombasa();
        await page.evaluate(() => { window.__nailit.throwOnWrite = true; });
        await editButton(page, "Cement").click();
        await page.click("#update-material-btn");
        await page.waitForFunction(() => !document.getElementById("update-material-btn").disabled);

        assert.ok(state.dialogs.includes("boom"), `dialogs: ${JSON.stringify(state.dialogs)}`);
        assert.equal(await page.locator("#update-material-btn").textContent(), "Update");

        await page.evaluate(() => { window.__nailit.throwOnWrite = false; });
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        await context.close();
    });

    it("cancelling the edit modal forgets the material", async () => {
        const { context, page } = await openMombasa();
        await editButton(page, "Cement").click();
        await page.click("#updateCancelButton");
        await page.evaluate(() => document.getElementById("updateForm").requestSubmit());
        await page.waitForTimeout(50);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("a legacy material with missing fields opens with empty inputs, not the text 'undefined'", async () => {
        const seed = {
            sites: { sA: SEED.sites.sA },
            materials: { m1: { name: "Old stock", siteId: "sA" } },
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Old stock"]);
        await editButton(page, "Old stock").click();

        for (const id of ["uQuantity", "uUnits", "uLastUpdated"]) {
            assert.equal(await page.inputValue(`#${id}`), "", id);
        }
        await context.close();
    });

    it("a site whose name is only spaces still gets a visible label", async () => {
        const seed = {
            sites: { sS: { name: "   ", location: "l", buildingType: "t", date: "2024-01-01" } },
            materials: {},
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#siteList a").waitFor();
        assert.equal(await page.locator("#siteList a").textContent(), "(unnamed site)");
        await context.close();
    });
});

describe("eval: README walkthrough end to end", () => {
    it("add site, add material, edit it, delete it, delete the site: clean database, no reloads, no errors", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, { sites: {}, materials: {} });
        await page.evaluate(() => { window.__marker = "same-page"; });

        await fillSiteForm(page, "Eldoret");
        await siteLink(page, "Eldoret").waitFor();
        await selectSite(page, "Eldoret");
        await fillMaterialForm(page, { name: "Cement", quantity: "20" });
        await waitForRows(page, ["Cement"]);

        await editButton(page, "Cement").click();
        await page.fill("#uQuantity", "15");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => document.querySelector("#materialTableBody td:nth-child(2)").textContent === "15");

        await deleteMaterialButton(page, "Cement").click();
        await page.click("#del-yes-btn");
        await waitForRows(page, []);

        await fillMaterialForm(page, { name: "Sand", quantity: "4" });
        await waitForRows(page, ["Sand"]);
        await page.locator("#siteList li", { hasText: "Eldoret" }).locator(".delete-site-btn").click();
        await page.waitForFunction(() => document.querySelectorAll("#siteList li").length === 0);

        const writes = await wrote(page);
        assert.deepEqual(junkPaths(writes), []);
        assert.equal(writes.filter((w) => w.op === "update").length, 1, "one edit, one update write");
        assert.deepEqual(await dbState(page), { sites: {}, materials: {} });
        assert.equal(await page.evaluate(() => window.__marker), "same-page");
        assert.deepEqual(state.pageErrors, []);
        assert.deepEqual(state.blocked, [], "the page tried to reach Firebase's CDN or database");
        await context.close();
    });
});

describe("static page fixes", () => {
    it("dashboard.html loads no leftover Firebase 9.9.1 scripts", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
        assert.deepEqual(scripts.filter((s) => s.includes("gstatic.com")), []);
        await context.close();
    });

    it("every page's manifest link resolves, has a name, and its icons load", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.route("**/kit.fontawesome.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
        for (const file of ["index.html", "about-us.html", "dashboard.html"]) {
            await page.route("**/src/data.js", (r) => r.fulfill({ contentType: "text/javascript", body: "export const subscribeSites=()=>()=>{};" }));
            await page.goto(`${baseUrl}/${file}`);
            const href = await page.locator("link[rel=manifest]").getAttribute("href");
            const manifestUrl = new URL(href, page.url()).href;
            const response = await page.request.get(manifestUrl);
            assert.equal(response.status(), 200, `${file}: manifest ${manifestUrl}`);
            const manifest = await response.json();
            assert.ok(manifest.name && manifest.short_name, `${file}: manifest needs name and short_name`);
            for (const icon of manifest.icons) {
                const iconResponse = await page.request.get(new URL(icon.src, manifestUrl).href);
                assert.equal(iconResponse.status(), 200, `${file}: icon ${icon.src}`);
            }
        }
        await context.close();
    });

    it("external links open with noopener noreferrer", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.route("**/kit.fontawesome.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
        for (const file of ["index.html", "about-us.html"]) {
            await page.goto(`${baseUrl}/${file}`);
            const rels = await page.locator("a[target=_blank]").evaluateAll((links) => links.map((a) => a.rel));
            for (const rel of rels) {
                assert.ok(rel.includes("noopener") && rel.includes("noreferrer"), `${file}: rel="${rel}"`);
            }
        }
        await context.close();
    });

    it("the home page no longer claims 'Secure Storage'", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.route("**/kit.fontawesome.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
        await page.goto(`${baseUrl}/index.html`);
        const text = await page.locator("body").innerText();
        assert.ok(!/secure storage/i.test(text));
        assert.ok(!/securely/i.test(text));
        await context.close();
    });
});

it("seed sanity: the fixtures the tests rely on", () => {
    assert.deepEqual(Object.keys(SEED.sites), ["sA", "sB"]);
    assert.deepEqual(Object.keys(SEED.materials), ["m1", "m2", "m3"]);
});
