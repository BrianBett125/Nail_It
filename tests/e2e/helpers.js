import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const FAKE_DATA = fs.readFileSync(path.join(import.meta.dirname, "fake-data.js"), "utf8");

const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
};

// Plain static server over the repo root, the same shape Vercel serves.
export function startServer() {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404).end("not found");
            return;
        }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

export function launchBrowser() {
    return chromium.launch({
        executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
        headless: true,
        args: ["--no-sandbox"],
    });
}

export const SEED = {
    sites: {
        sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", date: "2024-05-01" },
        sB: { name: "Cape Town", location: "Bellville", buildingType: "Commercial", date: "2024-05-02" },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", lastUpdated: "2024-05-04", siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
};

// Opens dashboard.html with the in-memory data layer. Any request to Firebase's CDN is
// recorded and blocked: the tests must never reach the real database.
export async function openDashboard(browser, baseUrl, seed = SEED) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = { dialogs: [], blocked: [], pageErrors: [] };

    await page.route("**/src/data.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: FAKE_DATA }));
    await page.route("**/kit.fontawesome.com/**", (route) =>
        route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(/gstatic\.com|firebaseio\.com|firebasedatabase\.app/, (route) => {
        state.blocked.push(route.request().url());
        return route.abort();
    });

    page.on("dialog", (dialog) => {
        state.dialogs.push(dialog.message());
        dialog.accept();
    });
    page.on("pageerror", (error) => state.pageErrors.push(error.message));

    await page.addInitScript((s) => { window.__seed = s; }, seed);
    await page.goto(`${baseUrl}/dashboard.html`);
    // Ready once dashboard.js has subscribed to sites; the seed may legitimately be empty.
    await page.waitForFunction(() =>
        window.__nailit && window.__nailit.activeListeners().some((l) => l.kind === "sites"));
    await page.waitForTimeout(20);
    return { context, page, state };
}

export function siteLink(page, name) {
    return page.locator("#siteList a", { hasText: name });
}

export async function selectSite(page, name) {
    await siteLink(page, name).click();
}

export function rowTexts(page) {
    return page.locator("#materialTableBody tr td:first-child").allTextContents();
}

export async function waitForRows(page, names) {
    await page.waitForFunction(
        (expected) => {
            const actual = [...document.querySelectorAll("#materialTableBody tr td:first-child")]
                .map((td) => td.textContent);
            return JSON.stringify(actual) === JSON.stringify(expected);
        },
        names,
    );
}

export const wrote = (page) => page.evaluate(() => window.__nailit.writes);
export const dbState = (page) => page.evaluate(() => window.__nailit.db);

// Every write path must be sites/<id> or materials/<id> with a real-looking id.
export function junkPaths(writeList) {
    const valid = /^(sites|materials)\/[-A-Za-z0-9_]+$/;
    const paths = writeList.flatMap((w) => (w.op === "multi" ? Object.keys(w.paths) : [w.path]));
    return paths.filter((p) => p !== "sites" && p !== "materials" && !valid.test(p));
}
