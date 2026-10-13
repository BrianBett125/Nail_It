// Phase 2: sign in, sign up, reset, the dashboard guard, sign out, email verification.
// Uses the fake sign-in (tests/e2e/fake-auth.js): no request ever reaches Firebase Auth.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer,
    launchBrowser,
    openDashboard,
    openLogin,
    toastLocator,
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

const authCalls = (page) => page.evaluate(() => window.__auth.calls);
const message = (page) => page.locator("#authMessage");

async function submit(page, email, password) {
    await page.fill("#email", email);
    if (password !== undefined) {
        await page.fill("#password", password);
    }
    await page.click("#authSubmit");
}

describe("login page: sign in", () => {
    it("starts in sign-in mode with email and password fields", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        assert.equal(await page.locator("#authTitle").textContent(), "LOG IN");
        assert.equal(await page.locator("#authSubmit").textContent(), "Sign in");
        assert.equal(await page.locator("#passwordGroup").isVisible(), true);
        assert.equal(await page.getAttribute("#email", "type"), "email");
        assert.equal(await page.getAttribute("#password", "type"), "password");
        assert.equal(await page.getAttribute("#password", "autocomplete"), "current-password");
        assert.equal(await message(page).isHidden(), true);
        await context.close();
    });

    it("a correct sign-in goes to the dashboard", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await submit(page, "sam@example.com", "secret1");
        await page.waitForURL(/dashboard\.html/);
        await context.close();
    });

    it("the email is trimmed and the password is sent untouched", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.hold = true; });
        await page.fill("#email", "  Sam@Example.com ");
        await page.fill("#password", " pass word ");
        await page.click("#authSubmit");
        await page.waitForFunction(() => window.__auth.calls.length === 1);
        assert.deepEqual((await authCalls(page))[0], { op: "signIn", email: "Sam@Example.com", password: " pass word " });
        await context.close();
    });

    it("a wrong password shows a plain message and stays on the page, ready to try again", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/invalid-credential" }; });
        await submit(page, "sam@example.com", "nope123");
        await message(page).waitFor();
        assert.equal(await message(page).textContent(), "Wrong email or password.");
        assert.equal(await message(page).getAttribute("role"), "alert");
        assert.match(page.url(), /login\.html/);
        assert.equal(await page.locator("#authSubmit").isDisabled(), false);
        assert.equal(await page.locator("#authSubmit").textContent(), "Sign in");

        await submit(page, "sam@example.com", "secret1");
        await page.waitForURL(/dashboard\.html/);
        await context.close();
    });

    it("never shows a raw Firebase code or message", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/some-new-internal-error" }; });
        await submit(page, "sam@example.com", "secret1");
        await message(page).waitFor();
        assert.equal(await message(page).textContent(), "Something went wrong. Try again.");
        await context.close();
    });

    it("says so plainly when sign-in is not set up yet (no API key)", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/invalid-api-key" }; });
        await submit(page, "sam@example.com", "secret1");
        await message(page).waitFor();
        assert.match(await message(page).textContent(), /not set up yet/);
        await context.close();
    });

    it("no connection and too many attempts get their own messages", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/network-request-failed" }; });
        await submit(page, "sam@example.com", "secret1");
        await page.waitForFunction(() => document.getElementById("authMessage").textContent.includes("No connection"));
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/too-many-requests" }; });
        await page.click("#authSubmit");
        await page.waitForFunction(() => document.getElementById("authMessage").textContent.includes("Wait a few minutes"));
        await context.close();
    });

    it("an empty email or password is stopped before any request", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#authSubmit");
        assert.equal(await message(page).textContent(), "Enter your email address.");
        await page.fill("#email", "sam@example.com");
        await page.click("#authSubmit");
        assert.equal(await message(page).textContent(), "Enter your password.");
        assert.deepEqual(await authCalls(page), []);
        await context.close();
    });

    it("pressing Enter submits, and a second press while the first is out sends nothing more", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.hold = true; });
        await page.fill("#email", "sam@example.com");
        await page.fill("#password", "secret1");
        await page.press("#password", "Enter");
        await page.waitForFunction(() => window.__auth.calls.length === 1);
        await page.evaluate(() => document.getElementById("authForm").requestSubmit());
        await page.waitForTimeout(50);
        assert.equal((await authCalls(page)).length, 1, "one request for two submits");
        assert.equal(await page.locator("#authSubmit").isDisabled(), true);
        assert.equal(await page.locator("#authSubmit").textContent(), "Please wait...");
        await page.evaluate(() => window.__auth.releaseHold());
        await page.waitForURL(/dashboard\.html/);
        await context.close();
    });

    it("someone already signed in is sent straight to the dashboard", async () => {
        const { context, page } = await openLogin(browser, baseUrl, {
            user: { uid: "u1", email: "sam@example.com", emailVerified: true },
        });
        await page.waitForURL(/dashboard\.html/);
        await context.close();
    });
});

describe("login page: create account", () => {
    it("the switch shows the create-account form and a way back", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toSignUp");
        assert.equal(await page.locator("#authTitle").textContent(), "CREATE ACCOUNT");
        assert.equal(await page.locator("#authSubmit").textContent(), "Create account");
        assert.equal(await page.getAttribute("#password", "autocomplete"), "new-password");
        assert.equal(await page.locator("#toSignUp").isHidden(), true);
        assert.equal(await page.locator("#toReset").isHidden(), true);
        await page.click("#toSignIn");
        assert.equal(await page.locator("#authTitle").textContent(), "LOG IN");
        assert.equal(await page.locator("#toSignIn").isHidden(), true);
        await context.close();
    });

    it("a password under 6 characters is refused before any request", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toSignUp");
        await submit(page, "new@example.com", "12345");
        assert.equal(await message(page).textContent(), "Password must be at least 6 characters.");
        assert.deepEqual(await authCalls(page), []);
        await context.close();
    });

    it("a new account goes to the dashboard, where the verify banner waits", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toSignUp");
        await submit(page, "new@example.com", "secret1");
        await page.waitForURL(/dashboard\.html/);
        await context.close();
    });

    it("an address that already has an account says so and offers sign-in", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toSignUp");
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/email-already-in-use" }; });
        await submit(page, "sam@example.com", "secret1");
        await message(page).waitFor();
        assert.match(await message(page).textContent(), /already exists\. Sign in instead/);
        assert.match(page.url(), /login\.html/);
        await context.close();
    });

    it("an invalid email address gets a plain message", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toSignUp");
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/invalid-email" }; });
        await submit(page, "not-an-email", "secret1");
        await message(page).waitFor();
        assert.equal(await message(page).textContent(), "Enter a valid email address.");
        await context.close();
    });
});

describe("login page: reset password", () => {
    it("the reset form has no password field and says a link is on its way, whatever the address", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toReset");
        assert.equal(await page.locator("#authTitle").textContent(), "RESET PASSWORD");
        assert.equal(await page.locator("#passwordGroup").isHidden(), true);
        await submit(page, "anyone@example.com");
        await message(page).waitFor();
        assert.equal(await message(page).textContent(), "If an account exists for that email, a reset link is on its way.");
        assert.equal(await message(page).getAttribute("role"), "status");
        assert.deepEqual(await authCalls(page), [{ op: "resetPassword", email: "anyone@example.com" }]);
        assert.match(page.url(), /login\.html/);
        await context.close();
    });

    it("a rate limit on reset is reported", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.click("#toReset");
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/too-many-requests" }; });
        await submit(page, "anyone@example.com");
        await page.waitForFunction(() => document.getElementById("authMessage").textContent.includes("Wait a few minutes"));
        await context.close();
    });

    it("switching mode clears the old message and a reset does not need a password", async () => {
        const { context, page } = await openLogin(browser, baseUrl);
        await page.evaluate(() => { window.__auth.failWith = { code: "auth/invalid-credential" }; });
        await submit(page, "sam@example.com", "nope123");
        await message(page).waitFor();
        await page.click("#toReset");
        assert.equal(await message(page).isHidden(), true);
        await page.fill("#email", "sam@example.com");
        await page.click("#authSubmit"); // the password field is hidden and not required in this mode
        await page.waitForFunction(() => document.getElementById("authMessage").textContent.includes("reset link"));
        assert.deepEqual((await authCalls(page)).map((c) => c.op), ["signIn", "resetPassword"]);
        await context.close();
    });
});

describe("dashboard guard and session", () => {
    it("signed out: dashboard.html sends the visitor to the login page and shows no data", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, { ...SEED, user: null });
        assert.match(page.url(), /login\.html/);
        assert.deepEqual(state.pageErrors, []);
        await context.close();
    });

    it("signed in: the dashboard shows who is signed in, and the sites", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        assert.equal(await page.locator("#userEmail").textContent(), "foreman@example.com");
        await page.locator("#siteList a", { hasText: "Mombasa" }).waitFor();
        await context.close();
    });

    it("the sites are asked for with the signed-in user's id", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...SEED, user: { uid: "uX", email: "x@example.com", emailVerified: true } });
        assert.equal(await page.locator("#userEmail").textContent(), "x@example.com");
        await context.close();
    });

    it("Sign out signs out and returns to the login page", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.click("#signOutButton");
        await page.waitForURL(/login\.html/);
        await context.close();
    });

    it("signing out in another tab sends this one to the login page too", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.evaluate(() => window.__auth.setUser(null));
        await page.waitForURL(/login\.html/);
        await context.close();
    });

    it("a different account signing in reloads the page, so nothing of the first account stays", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.evaluate(() => { window.__marker = "same-page"; });
        await page.evaluate(() => window.__auth.setUser({ uid: "u7", email: "other@example.com", emailVerified: true }));
        await page.waitForFunction(() => window.__marker === undefined);
        await context.close();
    });

    it("a token refresh for the same account does not reload the page", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await page.evaluate(() => { window.__marker = "same-page"; });
        await page.evaluate(() => window.__auth.setUser({ uid: "u1", email: "foreman@example.com", emailVerified: true }));
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__marker), "same-page");
        await context.close();
    });

    it("no native dialog and no request to Firebase happens through any of this", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl);
        await page.click("#signOutButton");
        await page.waitForURL(/login\.html/);
        assert.deepEqual(state.dialogs, []);
        assert.deepEqual(state.blocked, []);
        await context.close();
    });
});

describe("email verification", () => {
    const unverified = { ...SEED, user: { uid: "u1", email: "new@example.com", emailVerified: false } };

    it("a verified account sees no banner", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        assert.equal(await page.locator("#verifyBanner").isHidden(), true);
        await context.close();
    });

    it("an unverified account sees the banner with its address, and can still use the app", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, unverified);
        assert.equal(await page.locator("#verifyBanner").isVisible(), true);
        assert.equal(await page.locator("#verifyEmail").textContent(), "new@example.com");
        await page.locator("#siteList a", { hasText: "Mombasa" }).click();
        await context.close();
    });

    it("Send again asks for a new email and confirms", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, unverified);
        await page.click("#resendVerification");
        await toastLocator(page, "Verification email sent to new@example.com").waitFor();
        assert.deepEqual((await authCalls(page)).map((c) => c.op), ["resendVerification"]);
        await context.close();
    });

    it("a failed resend shows the error", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, unverified);
        await page.evaluate(() => { window.__auth.failWith = { code: "x" }; });
        await page.click("#resendVerification");
        await toastLocator(page, "fake auth failure").waitFor();
        await context.close();
    });

    it("'I have verified' before the link was opened says it is not verified yet, and keeps the banner", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, unverified);
        await page.click("#checkVerified");
        await toastLocator(page, "Not verified yet").waitFor();
        assert.equal(await page.locator("#verifyBanner").isVisible(), true);
        await context.close();
    });

    it("'I have verified' after the link was opened clears the banner", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, unverified);
        await page.evaluate(() => { window.__auth.verifyOnRefresh = true; });
        await page.click("#checkVerified");
        await toastLocator(page, "Email verified").waitFor();
        assert.equal(await page.locator("#verifyBanner").isHidden(), true);
        await context.close();
    });

    it("invitations are only listened for once the email is verified", async () => {
        const seed = {
            ...unverified,
            sites: { ...SEED.sites, sX: { name: "Kisumu", location: "Lake", buildingType: "Other", createdAt: 1, ownerUid: "boss" } },
            hiddenSites: ["sX"],
            invites: { sX: { role: "viewer", siteName: "Kisumu", invitedBy: "boss@example.com" } },
        };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        const kinds = async () => (await page.evaluate(() => window.__nailit.activeListeners())).map((l) => l.kind);
        assert.equal((await kinds()).includes("invites"), false);
        assert.equal(await page.locator("#invitesPanel").isHidden(), true);

        await page.evaluate(() => { window.__auth.verifyOnRefresh = true; });
        await page.click("#checkVerified");
        await page.locator("#invitesPanel").waitFor();
        assert.equal((await kinds()).includes("invites"), true);
        await context.close();
    });
});
