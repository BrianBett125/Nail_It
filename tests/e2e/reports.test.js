// Phase 6: reports people can send. A stock CSV, a movements CSV for a range of days, a summary to
// share and a print view, all for the open site. Each download is read back and compared line by
// line with what Excel should see. What the files contain is also unit-tested (tests/unit/reports.test.js).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
    startServer, launchBrowser, openDashboard, selectSite, waitForRows, SEED,
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

const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();
const now = new Date();
const thisMonth = (d, h = 12) => at(now.getFullYear(), now.getMonth() + 1, d, h);
const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lastMonth = (d, h = 12) => at(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, d, h);
const pad = (n) => String(n).padStart(2, "0");
const day = (date, d) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(d)}`;

const SEEDED = {
    ...SEED,
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: thisMonth(1), siteId: "sA" },
        m2: { name: "Sand, coarse", quantity: 10, units: "tonnes", updatedAt: thisMonth(1), siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
    movements: {
        v1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 50, type: "opening", byUid: "u1", byEmail: "foreman@example.com", at: lastMonth(10, 8) },
        v2: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -45, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: thisMonth(1, 9), note: "Slab 1" },
        v3: { siteId: "sA", materialId: "m2", materialName: "Sand, coarse", units: "tonnes", delta: 10, type: "received", byUid: "u1", byEmail: "foreman@example.com", at: thisMonth(1, 10) },
        v4: { siteId: "sB", materialId: "m3", materialName: "Nails", units: "kgs", delta: 40, type: "opening", byUid: "u1", byEmail: "foreman@example.com", at: thisMonth(1, 11) },
    },
};

async function open(seed = SEEDED, viewport = { width: 1280, height: 800 }, rows = ["Cement", "Sand, coarse"]) {
    const host = { newContext: () => browser.newContext({ viewport, acceptDownloads: true }) };
    const opened = await openDashboard(host, baseUrl, seed);
    if (viewport.width <= 768) {
        await opened.page.click("#sitePickerButton"); // on a phone the sites are in the drawer
    }
    await selectSite(opened.page, "Mombasa");
    await waitForRows(opened.page, rows);
    return opened;
}

const fileLines = async (download) => {
    const text = fs.readFileSync(await download.path(), "utf8");
    assert.equal(text.charCodeAt(0), 0xfeff, "starts with the byte order mark so Excel reads UTF-8");
    assert.ok(text.endsWith("\r\n"), "ends on a line end");
    return text.slice(1).split("\r\n").slice(0, -1);
};

const downloadFrom = async (page, selector) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
    return download;
};

describe("the Reports button", () => {
    it("shows only with a site open, and opens a native dialog", async () => {
        const host = { newContext: () => browser.newContext() };
        const { context, page } = await openDashboard(host, baseUrl, SEEDED);
        assert.equal(await page.locator("#reportsButton").isVisible(), false, "nothing to report on before a site is chosen");
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand, coarse"]);
        assert.equal(await page.locator("#reportsButton").isVisible(), true);
        await page.click("#reportsButton");
        assert.equal(await page.evaluate(() => document.getElementById("reportsContainer").matches(":modal")), true);
        assert.equal(await page.textContent("#reportsSite"), "Mombasa");
        await context.close();
    });

    it("is there for a viewer too: reading is the point of a report", async () => {
        const { context, page } = await open({ ...SEEDED, roles: { sA: "viewer" } });
        await page.click("#reportsButton");
        const file = await downloadFrom(page, "#exportStock");
        assert.ok((await fileLines(file)).length > 1);
        await context.close();
    });
});

describe("stock CSV", () => {
    it("downloads this site's materials, by name, ready for Excel", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        const file = await downloadFrom(page, "#exportStock");
        assert.equal(file.suggestedFilename(), `nail-it-mombasa-stock-${day(now, now.getDate())}.csv`);
        assert.deepEqual(await fileLines(file), [
            "Site,Material,In stock,Units,Low-stock level,Status,Last updated",
            `Mombasa,Cement,5,bags,10,Low,${day(now, 1)}`,
            `Mombasa,"Sand, coarse",10,tonnes,,OK,${day(now, 1)}`,
        ]);
        await context.close();
    });

    it("an empty site still downloads a header, and says so", async () => {
        const { context, page } = await open({ ...SEEDED, materials: { m3: SEEDED.materials.m3 } }, undefined, []);
        await page.click("#reportsButton");
        const file = await downloadFrom(page, "#exportStock");
        assert.deepEqual(await fileLines(file), ["Site,Material,In stock,Units,Low-stock level,Status,Last updated"]);
        await context.close();
    });
});

describe("movements CSV", () => {
    it("starts on this month, with the quick ranges above the dates", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        assert.equal(await page.inputValue("#reportFrom"), day(now, 1));
        assert.equal(await page.inputValue("#reportTo"), day(now, now.getDate()));
        assert.equal(await page.getAttribute('#reportPresets [data-preset="this-month"]', "aria-pressed"), "true");
        await page.fill("#reportFrom", day(now, 1).slice(0, 8) + "01");
        await page.dispatchEvent("#reportFrom", "input");
        assert.equal(await page.getAttribute('#reportPresets [data-preset="this-month"]', "aria-pressed"), "false", "typing a date leaves the preset");
        await context.close();
    });

    it("this month: only this site's movements in the range, oldest first, signed, with who and why", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        const file = await downloadFrom(page, "#exportMovements");
        assert.equal(file.suggestedFilename(), `nail-it-mombasa-movements-${day(now, 1)}_to_${day(now, now.getDate())}.csv`);
        assert.deepEqual(await fileLines(file), [
            "Date,Time,Site,Material,Type,Change,Units,By,Note",
            `${day(now, 1)},09:00:00,Mombasa,Cement,Used,-45,bags,foreman@example.com,Slab 1`,
            `${day(now, 1)},10:00:00,Mombasa,"Sand, coarse",Received,10,tonnes,foreman@example.com,`,
        ]);
        await context.close();
    });

    it("last month: a different range gives a different file, and Cape Town's movements never leak in", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        await page.click('#reportPresets [data-preset="last-month"]');
        const file = await downloadFrom(page, "#exportMovements");
        const lines = await fileLines(file);
        assert.equal(lines.length, 2);
        assert.match(lines[1], new RegExp(`^${day(lastMonthDate, 10)},08:00:00,Mombasa,Cement,Opening balance,50,bags,`));
        assert.ok(!lines.join("\n").includes("Nails"));
        await context.close();
    });

    it("both end days are included, to the last second of the end day", async () => {
        const edge = {
            ...SEEDED,
            movements: {
                a: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 1, type: "received", byUid: "u1", byEmail: "x@example.com", at: at(2026, 5, 1, 0, 0, 0) },
                b: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 2, type: "received", byUid: "u1", byEmail: "x@example.com", at: at(2026, 5, 31, 23, 59, 59) },
                c: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 4, type: "received", byUid: "u1", byEmail: "x@example.com", at: at(2026, 6, 1, 0, 0, 0) },
                d: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 8, type: "received", byUid: "u1", byEmail: "x@example.com", at: at(2026, 4, 30, 23, 59, 59) },
            },
        };
        const { context, page } = await open(edge);
        await page.click("#reportsButton");
        await page.fill("#reportFrom", "2026-05-01");
        await page.fill("#reportTo", "2026-05-31");
        const lines = await fileLines(await downloadFrom(page, "#exportMovements"));
        assert.deepEqual(lines.slice(1).map((line) => line.split(",")[5]), ["1", "2"]);
        await context.close();
    });

    it("an empty range says so and downloads nothing", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        await page.fill("#reportFrom", "2020-01-01");
        await page.fill("#reportTo", "2020-01-31");
        let downloaded = false;
        page.on("download", () => { downloaded = true; });
        await page.click("#exportMovements");
        await page.locator("#reportError").waitFor();
        assert.match(await page.textContent("#reportError"), /No movements from 2020-01-01 to 2020-01-31/);
        assert.equal(downloaded, false);
        assert.equal(await page.isEnabled("#exportMovements"), true, "the button is usable again");
        await context.close();
    });

    it("a backwards or missing range is refused before anything is read", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        await page.fill("#reportFrom", "2026-10-31");
        await page.fill("#reportTo", "2026-10-01");
        await page.click("#exportMovements");
        assert.equal(await page.textContent("#reportError"), "The start date is after the end date");
        await page.fill("#reportFrom", "");
        await page.click("#exportMovements");
        assert.equal(await page.textContent("#reportError"), "Choose a start and an end date");
        await page.click('#reportPresets [data-preset="last-7"]');
        assert.equal(await page.isHidden("#reportError"), true, "choosing a range clears the message");
        await context.close();
    });

    it("a hostile material name is written as text, not as a formula", async () => {
        const seed = {
            ...SEEDED,
            materials: { m1: { name: "=cmd|' /C calc'!A0", quantity: 1, units: "kgs", siteId: "sA" } },
            movements: { a: { siteId: "sA", materialId: "m1", materialName: "=cmd|' /C calc'!A0", units: "kgs", delta: 1, type: "received", byUid: "u1", byEmail: "x@example.com", at: thisMonth(1) } },
        };
        const { context, page } = await open(seed, undefined, ["=cmd|' /C calc'!A0"]);
        await page.click("#reportsButton");
        const stock = await fileLines(await downloadFrom(page, "#exportStock"));
        assert.ok(stock[1].startsWith("Mombasa,'=cmd"), stock[1]);
        const moves = await fileLines(await downloadFrom(page, "#exportMovements"));
        assert.ok(moves[1].includes(",'=cmd"), moves[1]);
        await context.close();
    });
});

describe("share", () => {
    it("hands the summary to the phone's share sheet", async () => {
        const { context, page } = await open();
        // The button text is chosen when the page loads, so share has to exist before it does.
        await page.addInitScript(() => { navigator.share = async (payload) => { (window.__shared ||= []).push(payload); }; });
        await page.reload();
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand, coarse"]);
        await page.click("#reportsButton");
        assert.equal(await page.textContent("#reportShare"), "Share summary");
        await page.click("#reportShare");
        const shared = await page.evaluate(() => window.__shared);
        assert.equal(shared.length, 1);
        assert.equal(shared[0].title, "Mombasa stock");
        assert.match(shared[0].text, new RegExp(`^Mombasa: stock on ${day(now, now.getDate())}\\n2 materials, 1 low\\n\\nCement: 5 bags \\(LOW, level 10\\)\\nSand, coarse: 10 tonnes$`));
        await context.close();
    });

    it("closing the share sheet is not an error", async () => {
        const { context, page } = await open();
        await page.addInitScript(() => { navigator.share = async () => { throw new DOMException("closed", "AbortError"); }; });
        await page.reload();
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand, coarse"]);
        await page.click("#reportsButton");
        await page.click("#reportShare");
        await page.waitForTimeout(100);
        assert.equal(await page.locator(".toast-error").count(), 0);
        await context.close();
    });

    it("without Web Share (a desktop) the button copies the summary", async () => {
        const { context, page } = await open();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
            window.__copied = [];
            Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { window.__copied.push(text); } }, configurable: true });
        });
        await page.reload();
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand, coarse"]);
        await page.click("#reportsButton");
        assert.equal(await page.textContent("#reportShare"), "Copy summary");
        await page.click("#reportShare");
        const copied = await page.evaluate(() => window.__copied);
        assert.equal(copied.length, 1);
        assert.match(copied[0], /^Mombasa: stock on /);
        await context.close();
    });
});

describe("print", () => {
    it("on paper: the site, the date and the table; no buttons, no site list, no activity", async () => {
        const { context, page } = await open();
        await page.click("#reportsButton");
        await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
        await page.click("#reportsClose");
        await page.emulateMedia({ media: "print" });
        const facts = await page.evaluate(() => {
            const shown = (selector) => {
                const el = document.querySelector(selector);
                return Boolean(el) && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
            };
            return {
                header: shown("#printHeader"),
                site: document.getElementById("printSite").textContent,
                note: document.getElementById("printNote").textContent,
                table: shown("#materialsTable"),
                bar: shown(".site-bar"),
                buttons: shown(".content-header"),
                activity: shown("#activityPanel"),
                rowButtons: shown("#materialTableBody .row-btn"),
                topBar: shown("header"),
                heads: [...document.querySelectorAll("#materialsTable thead th")].filter((th) => getComputedStyle(th).display !== "none").map((th) => th.textContent.trim()),
            };
        });
        assert.equal(facts.header, true);
        assert.equal(facts.site, "Mombasa");
        assert.equal(facts.note, `Printed ${day(now, now.getDate())}`);
        assert.equal(facts.table, true);
        assert.equal(facts.bar, false);
        assert.equal(facts.buttons, false);
        assert.equal(facts.activity, false);
        assert.equal(facts.rowButtons, false);
        assert.equal(facts.topBar, false);
        assert.deepEqual(facts.heads, ["Material Name", "In stock", "Units", "Last Updated", "Status"]);
        const pdf = await page.pdf({ format: "A4" });
        assert.ok(pdf.subarray(0, 4).toString() === "%PDF" && pdf.length > 2000, "Save as PDF produces a PDF");
        await context.close();
    });

    it("the print heading is not on the screen", async () => {
        const { context, page } = await open();
        assert.equal(await page.locator("#printHeader").isVisible(), false);
        await context.close();
    });

    it("the Print button closes the dialog and prints, saying what the table is narrowed to", async () => {
        const { context, page } = await open();
        await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
        await page.click("#filterLow");
        await page.click("#reportsButton");
        await page.click("#reportPrint");
        await page.waitForFunction(() => window.__printed === 1);
        assert.equal(await page.evaluate(() => document.getElementById("reportsContainer").open), false);
        await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
        assert.equal(await page.textContent("#printNote"), `Printed ${day(now, now.getDate())}, showing low stock only`);
        await context.close();
    });
});

describe("the dialog on a phone", () => {
    it("fits at 375px: nothing sideways, every button on the sheet reachable", async () => {
        const { context, page } = await open(SEEDED, { width: 375, height: 700 });
        // On a phone the site is chosen from the drawer; open() already selected it.
        await page.click("#reportsButton");
        const facts = await page.evaluate(() => {
            const dialog = document.getElementById("reportsContainer");
            const body = dialog.querySelector(".sheet-body");
            const box = (id) => document.getElementById(id).getBoundingClientRect();
            return {
                sideways: document.documentElement.scrollWidth > innerWidth,
                bodyOverflow: body.scrollWidth > body.clientWidth,
                closeBottom: box("reportsClose").bottom,
                vh: innerHeight,
                tap: ["exportStock", "exportMovements", "reportShare", "reportPrint", "reportsClose", "reportFrom", "reportTo"].map((id) => [id, Math.round(box(id).height)]),
            };
        });
        assert.equal(facts.sideways, false);
        assert.equal(facts.bodyOverflow, false);
        await page.waitForTimeout(400);
        assert.ok(await page.evaluate(() => document.getElementById("reportsClose").getBoundingClientRect().bottom <= innerHeight), "Close is on the screen");
        for (const [id, height] of facts.tap) {
            assert.ok(height >= 44, `${id} is ${height}px tall, a thumb needs 44`);
        }
        await context.close();
    });
});
