// Phase 7 in the browser: the app with no signal.
//
// Two halves, because the app answers that question in two different ways.
//
// 1. The service worker, run here on the REAL files. This is the only file in the suite that lets service
//    workers run: everywhere else they are blocked (tests/e2e/helpers.js), because Playwright cannot route
//    a request a worker answers and the fake data layer would never be called. Nothing is faked here.
// 2. The offline indicator, on the fake data layer, where Firebase's connection flag can be flipped.
//
// "No signal" is made real by shutting the test server down, not by context.setOffline(). Playwright's
// setOffline does not reach a service worker: the worker's own fetches are made on the worker's target,
// which keeps its network. A page would then look offline while the worker went on talking to the server,
// and these tests would pass with the cache empty. With the server gone the only thing left that can answer
// is the Cache API, so a 200 here is a 200 the worker served out of it.
//
// The one thing no test here reaches is Firebase itself. The offline write path does not need it: the
// app keeps its own queue (src/outbox.js), which the fake data layer wires to the browser's localStorage,
// so "recorded with no signal, survives a reload, sent on reconnect" runs end to end here against the
// fake database. Only what the REAL src/data.js sends to the REAL SDK is out of reach, and that is
// checked in tests/unit/data.test.js; docs/PHASE7-DEPLOY.md has the two-minute procedure for a phone.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CACHE_NAME, SHELL_ASSETS } from "../../src/sw-cache.js";
import { OUTBOX_KEY } from "../../src/outbox.js";
import {
    startServer,
    launchBrowser,
    openDashboard,
    selectSite,
    waitForRows,
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

const BANNER = "#offlineBanner";

// A page where service workers run and nothing is faked.
async function shell() {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    return { context, page, errors };
}

// Opens index.html and waits for the worker to be in control with the whole shell in its cache. index.html
// is the page to use: it needs no data and no SDK, so the only thing under test is the shell itself.
async function offlineReady(page, url) {
    await page.goto(`${url}/index.html`);
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).length >= 40;
    }, CACHE_NAME);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
        timeout: 15000,
    });
}

// The server goes away for good: nothing can be fetched from it again, and the sockets the browser is
// already holding are cut, so the next request fails at once instead of hanging.
function cutTheCable(testServer) {
    return new Promise((resolve) => {
        testServer.close(resolve);
        testServer.closeAllConnections();
    });
}

describe("the app shell opens with no signal", () => {
    it("the worker caches the whole shell, and with the server gone every file of it is still served", async () => {
        const { server: site, url } = await startServer();
        const { context, page, errors } = await shell();
        await offlineReady(page, url);

        const missing = await page.evaluate(async (assets) => {
            const lost = [];
            for (const asset of assets) {
                if (!(await caches.match(asset))) {
                    lost.push(asset);
                }
            }
            return lost;
        }, SHELL_ASSETS);
        assert.deepEqual(missing, [], "the worker's cache holds every file of the shell");

        await cutTheCable(site);
        const heading = await page.textContent("h1");
        await page.reload();
        assert.equal(
            await page.textContent("h1"),
            heading,
            "the page came back with nothing to fetch",
        );

        // Every request from here goes through the worker, and the worker has nothing but its cache.
        const statuses = await page.evaluate(async (assets) => {
            const seen = {};
            for (const asset of assets) {
                try {
                    seen[asset] = (await fetch(asset)).status;
                } catch (error) {
                    seen[asset] = `failed: ${error.message}`;
                }
            }
            return seen;
        }, SHELL_ASSETS);
        assert.deepEqual(
            Object.entries(statuses).filter(([, status]) => status !== 200),
            [],
        );
        assert.deepEqual(errors, []);
        await context.close();
    });

    it("the worker leaves everything that is not the app's own shell alone", async () => {
        const { server: site, url } = await startServer();
        const { context, page, errors } = await shell();
        await offlineReady(page, url);
        await cutTheCable(site);

        // These two are this site's and are not part of the shell, so the worker must not answer for them:
        // with nothing to fetch the request has to fail rather than come back as a cached page. A worker
        // that intercepted everything would answer 200 here, and the database would be next.
        const answered = await page.evaluate(async () => {
            const seen = {};
            for (const url of ["/package.json", "/sw.js"]) {
                try {
                    seen[url] = (await fetch(url)).status;
                } catch {
                    seen[url] = "failed";
                }
            }
            return seen;
        });
        assert.deepEqual(answered, { "/package.json": "failed", "/sw.js": "failed" });
        assert.deepEqual(errors, []);
        await context.close();
    });

    it("a link the app does not have still opens the app rather than an error page", async () => {
        const { server: site, url } = await startServer();
        const { context, page } = await shell();
        await offlineReady(page, url);
        await cutTheCable(site);

        await page.goto(`${url}/a-page-that-was-renamed.html`);
        assert.match(
            await page.textContent("h1"),
            /\S/,
            "the worker's fallback is the app's own page",
        );
        await context.close();
    });
});

describe("the offline indicator", () => {
    it("is out of the way while the database is reachable, and says what is happening when it is not", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, SEED);
        assert.equal(
            await page.locator(BANNER).isVisible(),
            false,
            "nothing to say while things are working",
        );

        await page.evaluate(() => window.__nailit.setConnected(false));
        await page.locator(BANNER).waitFor({ state: "visible" });
        assert.match(await page.textContent(BANNER), /offline/i);
        assert.match(
            await page.textContent(BANNER),
            /sync/i,
            "it has to say what happens next, not just that it is broken",
        );

        await page.evaluate(() => window.__nailit.setConnected(true));
        await page.locator(BANNER).waitFor({ state: "hidden" });
        await context.close();
    });

    it("a movement recorded with no signal is kept on the device, and nothing is reported as a failure", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, SEED);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => window.__nailit.setConnected(false));
        await page.locator(BANNER).waitFor({ state: "visible" });

        await page
            .locator("#materialTableBody tr", { hasText: "Cement" })
            .locator(".btn-use")
            .click();
        await page.locator("#movementContainer").waitFor({ state: "visible" });
        await page.fill("#movementAmount", "3");
        await page.click("#movementSubmit");

        // With no connection the movement has not reached the database, but it is on the device and the
        // person is told it will send, never that it failed. The banner counts the one waiting.
        await page.waitForFunction(() =>
            document.querySelector("#offlineMessage").textContent.includes("1 change"),
        );
        assert.equal(
            await page.evaluate(() => window.__nailit.db.materials.sA.m1.quantity),
            5,
            "the database has not seen it yet",
        );
        assert.ok(
            state.toasts.some((t) => /Used 3 bags of Cement/.test(t)),
            JSON.stringify(state.toasts),
        );
        assert.ok(
            !state.toasts.some((t) => /could not/i.test(t)),
            `nothing failed: ${JSON.stringify(state.toasts)}`,
        );

        // The connection comes back: the queued movement goes up on its own, once, and the banner clears.
        await page.evaluate(() => window.__nailit.setConnected(true));
        await page.waitForFunction(() =>
            Object.values(window.__nailit.db.movements.sA || {}).some((m) => m.delta === -3),
        );
        const landed = await page.evaluate(() => ({
            movements: Object.values(window.__nailit.db.movements.sA || {}),
            quantity: window.__nailit.db.materials.sA.m1.quantity,
        }));
        assert.equal(landed.movements.length, 1, "sent exactly once, not none and not twice");
        assert.equal(landed.quantity, 2, "counted once against the stock, 5 - 3");
        await page.locator(BANNER).waitFor({ state: "hidden" });
        await page.waitForTimeout(100);
        assert.ok(!state.toasts.some((t) => /could not/i.test(t)), JSON.stringify(state.toasts));
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("a movement recorded with no signal survives a reload and reaches the database on reconnect", async () => {
        // The page starts as a phone that was reloaded with no bars: window.__preset.offline is read by the
        // fake data layer, so it comes up with no connection, exactly as the real SDK's flag would report.
        const { context, page, state } = await openDashboard(browser, baseUrl, SEED, {
            beforeLoad: () => {
                window.__preset = { offline: true };
            },
        });
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);

        const queued = () =>
            page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key) || "[]").length,
                OUTBOX_KEY,
            );
        const movementCount = () =>
            page.evaluate(() => Object.keys(window.__nailit.db.movements.sA || {}).length);

        await page
            .locator("#materialTableBody tr", { hasText: "Cement" })
            .locator(".btn-use")
            .click();
        await page.locator("#movementContainer").waitFor({ state: "visible" });
        await page.fill("#movementAmount", "4");
        await page.click("#movementSubmit");
        await page.waitForFunction(
            (key) => JSON.parse(localStorage.getItem(key) || "[]").length === 1,
            OUTBOX_KEY,
        );
        assert.equal(await movementCount(), 0, "nothing reached the database with no signal");

        // The page is reloaded with the signal still gone. The queue lives on the device, not in the page,
        // so it is still there when the page comes back, and the reload alone does not send it.
        await page.reload();
        await page.waitForFunction(
            () =>
                window.__nailit &&
                window.__nailit.activeListeners().some((l) => l.kind === "sites"),
        );
        assert.equal(await queued(), 1, "the movement is still on the device after the reload");
        assert.equal(await movementCount(), 0, "a reload alone does not send it");

        // The signal comes back. The movement the earlier session could not send goes up on its own.
        await page.evaluate(() => window.__nailit.setConnected(true));
        await page.waitForFunction(() =>
            Object.values(window.__nailit.db.movements.sA || {}).some((m) => m.delta === -4),
        );
        const landed = await page.evaluate(() => ({
            movements: Object.values(window.__nailit.db.movements.sA || {}),
            quantity: window.__nailit.db.materials.sA.m1.quantity,
        }));
        assert.equal(landed.movements.length, 1, "the surviving movement was sent exactly once");
        assert.equal(landed.movements[0].type, "used");
        assert.equal(landed.quantity, 1, "5 - 4");
        assert.equal(await queued(), 0, "the queue is empty once the movement has landed");
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("when the flag cannot be read at all the banner is left as it was: the app does not guess", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, SEED);
        await page.evaluate(() => window.__nailit.failConnection("permission_denied"));
        await page.waitForTimeout(50);
        assert.equal(await page.locator(BANNER).isVisible(), false, "no claim either way");
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });
});
