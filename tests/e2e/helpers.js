import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const FAKE_DATA = fs.readFileSync(path.join(import.meta.dirname, "fake-data.js"), "utf8");
const FAKE_AUTH = fs.readFileSync(path.join(import.meta.dirname, "fake-auth.js"), "utf8");

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
        sA: { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 1714521600000, ownerUid: "u1" },
        sB: { name: "Cape Town", location: "Bellville", buildingType: "Commercial", createdAt: 1714608000000, ownerUid: "u1" },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03", siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", lastUpdated: "2024-05-04", siteId: "sA" },
        m3: { name: "Nails", quantity: 40, units: "kgs", lastUpdated: "2024-05-05", siteId: "sB" },
    },
};

// Opens a page with the in-memory data layer and the fake sign-in. Any request to Firebase's CDN is
// recorded and blocked: the tests must never reach the real database or the real Auth service.
// options.beforeLoad runs in the page before any page script, for example to set flags the
// fake data layer reads or to break localStorage.
async function newPage(browser, seed, options) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = { dialogs: [], toasts: [], blocked: [], pageErrors: [] };

    await page.route("**/src/data.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: FAKE_DATA }));
    await page.route("**/src/auth.js", (route) =>
        route.fulfill({ contentType: "text/javascript", body: FAKE_AUTH }));
    await page.route("**/kit.fontawesome.com/**", (route) =>
        route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(/gstatic\.com|firebaseio\.com|firebasedatabase\.app|googleapis\.com|firebaseapp\.com/, (route) => {
        state.blocked.push(route.request().url());
        return route.abort();
    });

    // Toasts disappear on their own, so record each one the moment it is added to the page.
    await page.exposeFunction("__recordToast", (text) => state.toasts.push(text));
    await page.addInitScript(() => {
        const seen = new WeakSet();
        new MutationObserver(() => {
            document.querySelectorAll(".toast").forEach((toast) => {
                if (!seen.has(toast)) {
                    seen.add(toast);
                    window.__recordToast(toast.querySelector(".toast-text").textContent);
                }
            });
        }).observe(document, { childList: true, subtree: true });
    });

    page.on("dialog", (dialog) => {
        state.dialogs.push(dialog.message());
        dialog.accept();
    });
    page.on("pageerror", (error) => state.pageErrors.push(error.message));

    await page.addInitScript((s) => { window.__seed = s; }, seed);
    if (options.beforeLoad) {
        await page.addInitScript(options.beforeLoad);
    }
    return { context, page, state };
}

// Opens dashboard.html signed in (seed.user, default a verified foreman). With seed.user null the
// page redirects to login.html, and this waits for that instead.
export async function openDashboard(browser, baseUrl, seed = SEED, options = {}) {
    const opened = await newPage(browser, seed, options);
    const { page } = opened;
    await page.goto(`${baseUrl}/dashboard.html`);
    if ("user" in seed && seed.user === null) {
        await page.waitForURL(/login\.html/);
        return opened;
    }
    // Ready once dashboard.js has subscribed to sites; the seed may legitimately be empty.
    await page.waitForFunction(() =>
        window.__nailit && window.__nailit.activeListeners().some((l) => l.kind === "sites"));
    await page.waitForTimeout(20);
    return opened;
}

// Opens overview.html (the owner overview of every site) signed in, or signed out with seed.user null.
export async function openOverview(browser, baseUrl, seed = SEED, options = {}) {
    const opened = await newPage(browser, seed, options);
    const { page } = opened;
    await page.goto(`${baseUrl}/overview.html`);
    if ("user" in seed && seed.user === null) {
        await page.waitForURL(/login\.html/);
        return opened;
    }
    await page.waitForFunction(() =>
        window.__nailit && window.__nailit.activeListeners().some((l) => l.kind === "sites"));
    await page.waitForTimeout(20);
    return opened;
}

// Opens login.html, signed out unless seed.user says otherwise.
export async function openLogin(browser, baseUrl, seed = { user: null }, options = {}) {
    const opened = await newPage(browser, seed, options);
    await opened.page.goto(`${baseUrl}/login.html`);
    await opened.page.waitForFunction(() => window.__auth !== undefined);
    await opened.page.waitForTimeout(20);
    return opened;
}

export function siteLink(page, name) {
    return page.locator("#siteList a", { hasText: name });
}

export async function selectSite(page, name) {
    await siteLink(page, name).click();
}

// Opens the delete-site dialog for a site and types `typed` (default: its name) into it.
export async function openSiteDelete(page, siteName, typed = siteName) {
    await page.locator("#siteList li", { hasText: siteName }).locator(".delete-site-btn").click();
    await page.fill("#siteDeleteInput", typed);
}

export async function deleteSiteViaUi(page, siteName) {
    await openSiteDelete(page, siteName);
    await page.click("#siteDeleteConfirm");
}

export function toastLocator(page, text) {
    return page.locator(".toast", { hasText: text });
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

// Every path a write touches must be made of real-looking ids: no "[object PointerEvent]",
// no spaces, no empty segments. A push's path is its collection ("sites", "materials/<siteId>").
export function junkPaths(writeList) {
    const segment = /^[-A-Za-z0-9_@,+]+$/;
    const paths = writeList
        .filter((w) => w.path !== undefined || w.op === "multi")
        .flatMap((w) => (w.op === "multi" ? Object.keys(w.paths) : [w.path]));
    return paths.filter((p) => !p.split("/").every((part) => segment.test(part)));
}

// The material nodes (materials/<siteId>/<materialId>) a multi-path write touches, in order.
export function materialsTouched(write) {
    const nodes = Object.keys(write.paths || {})
        .filter((p) => p.startsWith("materials/"))
        .map((p) => p.split("/").slice(0, 3).join("/"));
    return [...new Set(nodes)];
}

// Writes that delete a material, or put one back (Undo): a multi-path update that sets the node itself.
export const deletesOf = (writes, node) => writes.filter((w) => w.op === "multi" && w.paths[node] === null);
export const restoresOf = (writes, node) =>
    writes.filter((w) => w.op === "multi" && w.paths[node] && typeof w.paths[node] === "object");
