// The Content-Security-Policy in vercel.json, run in real Chrome. The public pages and the sign-in call
// the REAL Firebase endpoints (sign-in with an account that does not exist: it fails, and that failure is
// what proves the policy lets the request out). The signed-in pages run on the fake data layer, which
// proves our own code never needs an inline script or style.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../../scripts/serve.mjs";
import { launchBrowser } from "./helpers.js";

let real;
let fake;
let realUrl;
let fakeUrl;
let browser;

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

before(async () => {
    real = await createServer({ fake: false });
    fake = await createServer({ fake: true });
    realUrl = await listen(real);
    fakeUrl = await listen(fake);
    browser = await launchBrowser();
});

after(async () => {
    await browser.close();
    real.close();
    fake.close();
});

// Opens a page that records every policy violation and every failed request.
async function watched(url) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const seen = { violations: [], consoleErrors: [], failed: [], requests: [], responses: new Map() };
    await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener("securitypolicyviolation", (event) => {
            window.__csp.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
    });
    page.on("console", (message) => {
        if (message.type() === "error") {
            seen.consoleErrors.push(message.text());
        }
    });
    page.on("requestfailed", (request) => seen.failed.push(`${request.url()} ${request.failure() && request.failure().errorText}`));
    page.on("request", (request) => seen.requests.push(request.url()));
    page.on("response", (response) => seen.responses.set(response.url(), response));
    const response = await page.goto(url);
    seen.main = response;
    return { context, page, seen };
}

const violations = (page) => page.evaluate(() => window.__csp);

describe("the headers arrive", () => {
    it("every page is served with the security headers", async () => {
        for (const file of ["index.html", "about-us.html", "login.html", "dashboard.html", "overview.html"]) {
            const { context, seen } = await watched(`${realUrl}/${file}`);
            const headers = seen.main.headers();
            assert.match(headers["content-security-policy"], /default-src 'self'/, file);
            assert.equal(headers["x-content-type-options"], "nosniff", file);
            assert.equal(headers["x-frame-options"], "DENY", file);
            assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin", file);
            assert.ok(headers["permissions-policy"], file);
            assert.ok(headers["strict-transport-security"], file);
            await context.close();
        }
    });

    it("pictures are cached for a week", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const response = await page.request.get(`${realUrl}/assets/database.webp`);
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["cache-control"], "public, max-age=604800");
        assert.equal(response.headers()["content-type"], "image/webp");
        await context.close();
    });
});

describe("the public pages run under the policy", () => {
    for (const file of ["index.html", "about-us.html", "login.html"]) {
        it(`${file} loads with no policy violation and no failed request`, async () => {
            const { context, page, seen } = await watched(`${realUrl}/${file}`);
            await page.waitForLoadState("networkidle");
            assert.deepEqual(await violations(page), []);
            assert.deepEqual(seen.failed, []);
            assert.deepEqual(seen.consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e)), []);
            await context.close();
        });
    }

    it("no page asks any host other than this one and Firebase's for anything", async () => {
        const allowed = /^(http:\/\/127\.0\.0\.1|https:\/\/www\.gstatic\.com\/|data:|blob:)/;
        for (const file of ["index.html", "about-us.html", "login.html"]) {
            const { context, page, seen } = await watched(`${realUrl}/${file}`);
            await page.waitForLoadState("networkidle");
            assert.deepEqual(seen.requests.filter((url) => !allowed.test(url)), [], file);
            await context.close();
        }
    });
});

describe("Firebase works under the policy", () => {
    it("sign-in reaches Google's sign-in endpoint and shows the answer (an account that does not exist)", async () => {
        const { context, page, seen } = await watched(`${realUrl}/login.html`);
        await page.fill("#email", "nobody-at-all@example.com");
        await page.fill("#password", "not-a-real-password");
        await page.click("#authSubmit");
        // Not waitForFunction: Playwright runs that as a string of script, which the policy rightly refuses.
        await page.locator("#authMessage:not([hidden])").waitFor({ timeout: 20000 });
        const message = (await page.textContent("#authMessage")).trim();
        assert.ok(message.length > 5, message);
        assert.ok(seen.requests.some((url) => url.startsWith("https://identitytoolkit.googleapis.com/")), "the sign-in request went out");
        assert.deepEqual(await violations(page), []);
        assert.doesNotMatch(message, /not set up|network|connect/i, `the answer came from Google, not from a blocked request: ${message}`);
        await context.close();
    });

    it("the Firebase modules load from gstatic and the app starts", async () => {
        const { context, page, seen } = await watched(`${realUrl}/login.html`);
        await page.waitForLoadState("networkidle");
        assert.ok(seen.requests.some((url) => url.startsWith("https://www.gstatic.com/firebasejs/")), "the SDK was fetched");
        assert.deepEqual(await violations(page), []);
        await context.close();
    });
});

describe("the policy is really enforced", () => {
    it("an inline script, an inline style block and a foreign script are all refused", async () => {
        const { context, page } = await watched(`${realUrl}/about-us.html`);
        await page.evaluate(() => {
            const inline = document.createElement("script");
            inline.textContent = "window.__inline = 1";
            document.head.append(inline);
            const style = document.createElement("style");
            style.textContent = "body { outline: 9px solid red }";
            document.head.append(style);
            const foreign = document.createElement("script");
            foreign.src = "https://example.com/x.js";
            document.head.append(foreign);
        });
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => window.__inline), undefined);
        const blocked = await violations(page);
        assert.ok(blocked.some((v) => v.startsWith("script-src-elem") || v.startsWith("script-src")), JSON.stringify(blocked));
        assert.ok(blocked.some((v) => v.startsWith("style-src")), JSON.stringify(blocked));
        assert.ok(blocked.some((v) => /example\.com/.test(v)), JSON.stringify(blocked));
        await context.close();
    });

    it("the page cannot be framed", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const violationsSeen = [];
        page.on("console", (m) => violationsSeen.push(m.text()));
        await page.setContent(`<iframe id="f" src="${realUrl}/login.html"></iframe>`);
        await page.waitForTimeout(500);
        const framed = await page.frames().find((f) => f.url().startsWith(realUrl));
        assert.ok(!framed || (await framed.evaluate(() => document.body.children.length).catch(() => 0)) === 0, "the framed page did not render");
        await context.close();
    });
});

describe("the signed-in pages run under the policy", () => {
    it("the dashboard, its sheets and the overview raise no policy violation", async () => {
        const { context, page, seen } = await watched(`${fakeUrl}/dashboard.html?site=sA`);
        await page.waitForSelector("#materialTableBody tr");
        await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-use").click();
        await page.waitForSelector("#movementContainer", { state: "visible" });
        await page.keyboard.press("Escape");
        await page.locator("#materialTableBody tr", { hasText: "Cement" }).locator(".btn-history").click();
        await page.waitForSelector("#historyContainer", { state: "visible" });
        await page.keyboard.press("Escape");
        await page.click("#filterLow");
        assert.deepEqual(await violations(page), []);
        assert.deepEqual(seen.consoleErrors, []);
        await page.goto(`${fakeUrl}/overview.html`);
        await page.waitForSelector("#overviewList li.overview-site");
        assert.deepEqual(await violations(page), []);
        await context.close();
    });
});
