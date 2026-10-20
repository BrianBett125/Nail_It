// Phase 2: what each role is offered, the members dialog, and invitations.
// The database rules are the real enforcement (tests/rules/); these tests prove the page
// offers each role exactly what it may do, and that every action goes where it should.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    startServer,
    launchBrowser,
    openDashboard,
    selectSite,
    siteLink,
    toastLocator,
    waitForRows,
    wrote,
    dbState,
    materialsTouched,
    restoresOf,
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

const withRoles = (roles, extra = {}) => ({ ...SEED, roles, ...extra });
const editBtn = (page, name) =>
    page.locator("#materialTableBody tr", { hasText: name }).locator("button[aria-label='Edit material']");
const deleteBtn = (page, name) =>
    page.locator("#materialTableBody tr", { hasText: name }).locator("button[aria-label='Delete material']");
const siteDeleteBtn = (page, name) =>
    page.locator("#siteList li", { hasText: name }).locator(".delete-site-btn");

describe("owner", () => {
    it("is offered everything on their site", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#roleBadge").textContent(), "Your role: Owner");
        assert.equal(await page.locator("#addMaterialButton").isVisible(), true);
        assert.equal(await editBtn(page, "Cement").count(), 1);
        assert.equal(await deleteBtn(page, "Cement").count(), 1);
        assert.equal(await siteDeleteBtn(page, "Mombasa").count(), 1);
        assert.equal(await page.locator("#membersButton").isVisible(), true);
        assert.equal(await page.locator("#siteList .role-tag").count(), 0, "owners get no role tag in the list");
        await context.close();
    });
});

describe("storekeeper", () => {
    const seed = () => withRoles({ sA: "storekeeper", sB: "owner" });

    it("can add, edit and delete materials, but not delete the site", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#roleBadge").textContent(), "Your role: Storekeeper");
        assert.equal(await page.locator("#addMaterialButton").isVisible(), true);
        assert.equal(await editBtn(page, "Cement").count(), 1);
        assert.equal(await deleteBtn(page, "Cement").count(), 1);
        assert.equal(await siteDeleteBtn(page, "Mombasa").count(), 0, "no delete button on a site they do not own");
        assert.equal(await siteDeleteBtn(page, "Cape Town").count(), 1, "but their own site has one");
        await context.close();
    });

    it("shows the role next to the site name without changing the link text", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await siteLink(page, "Mombasa").waitFor();
        assert.equal(await siteLink(page, "Mombasa").textContent(), "Mombasa");
        assert.equal(await page.locator("#siteList li", { hasText: "Mombasa" }).locator(".role-tag").textContent(), "Storekeeper");
        await context.close();
    });

    it("an edit writes to the site's own path", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await editBtn(page, "Cement").click();
        await page.fill("#uMinLevel", "9");
        await page.click("#update-material-btn");
        await page.waitForFunction(() => window.__nailit.writes.length === 1);
        assert.deepEqual(materialsTouched((await wrote(page))[0]), ["materials/sA/m1"]);
        await context.close();
    });
});

describe("viewer (engineer, QS, architect)", () => {
    const seed = () => withRoles({ sA: "viewer", sB: "owner" });

    it("reads the materials but is offered no way to change them", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#roleBadge").textContent(), "Your role: Viewer");
        assert.equal(await page.locator("#addMaterialButton").isHidden(), true);
        assert.equal(await page.locator("#materialTableBody button:not(.btn-history)").count(), 0);
        assert.equal(await siteDeleteBtn(page, "Mombasa").count(), 0);
        assert.equal(await page.locator("#materialTableBody td:nth-child(6)").first().isHidden(), true, "the Edit column is hidden");
        assert.equal(await page.locator("#materialsTable thead th:nth-child(6)").isHidden(), true);
        // Phase 3: column 5 (Stock) stays for a viewer, and holds History and nothing else.
        assert.equal(await page.locator("#materialsTable thead th:nth-child(5)").isVisible(), true);
        assert.equal(await page.locator("#materialTableBody td:nth-child(5) button").count(), 2);
        assert.equal(await page.locator("#materialTableBody td:nth-child(5) button.btn-history").count(), 2);
        await context.close();
    });

    it("sees the numbers: name, quantity, units, date", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        const row = await page.locator("#materialTableBody tr").first().locator("td:visible").allTextContents();
        assert.deepEqual(row.slice(0, 4), ["Cement", "5", "bags", "2024-05-03"]);
        assert.equal(row[4].trim(), "History", "Phase 3: the only other thing in the row is the History button");
        assert.equal(row.length, 5);
        await context.close();
    });

    it("an empty site says nothing is recorded, without inviting the viewer to add", async () => {
        const seed2 = withRoles({ sA: "viewer" }, { materials: {} });
        const { context, page } = await openDashboard(browser, baseUrl, seed2);
        await selectSite(page, "Mombasa");
        await page.waitForFunction(() => document.getElementById("materialsStatus").textContent === "No materials recorded in this site yet.");
        await context.close();
    });

    it("can still add their own site, and be its owner", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await page.click("#addSiteButton");
        await page.fill("#siteName", "My yard");
        await page.fill("#siteLocation", "Nairobi");
        await page.selectOption("#buildingType", "Other");
        await page.click("#add-site-btn");
        await siteLink(page, "My yard").waitFor();
        await page.waitForFunction(() => document.getElementById("roleBadge").textContent === "Your role: Owner");
        assert.equal(await page.locator("#addMaterialButton").isVisible(), true);
        await context.close();
    });

    it("cannot be tricked into a write by submitting a hidden form", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        // No edit modal was ever opened for this viewer, so a forged submit has nothing to write.
        await page.evaluate(() => document.getElementById("updateForm").requestSubmit());
        await page.waitForTimeout(50);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("switching between a viewer site and an owner site switches what is offered", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#addMaterialButton").isHidden(), true);
        await selectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        assert.equal(await page.locator("#addMaterialButton").isVisible(), true);
        assert.equal(await deleteBtn(page, "Nails").count(), 1);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#materialTableBody button:not(.btn-history)").count(), 0);
        await context.close();
    });
});

describe("a role that changes while the page is open", () => {
    it("demoted to viewer: the buttons disappear at once, without a reload", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__marker = "same-page"; });
        await page.evaluate(() => window.__nailit.externalSetRole("sA", "viewer"));
        await page.waitForFunction(() => document.getElementById("roleBadge").textContent === "Your role: Viewer");
        assert.equal(await page.locator("#materialTableBody button:not(.btn-history)").count(), 0);
        assert.equal(await page.locator("#addMaterialButton").isHidden(), true);
        assert.equal(await page.evaluate(() => window.__marker), "same-page");
        await context.close();
    });

    it("promoted to storekeeper: the edit buttons appear", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, withRoles({ sA: "viewer" }));
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        assert.equal(await page.locator("#materialTableBody button:not(.btn-history)").count(), 0);
        await page.evaluate(() => window.__nailit.externalSetRole("sA", "storekeeper"));
        // Phase 3: per row, History + Receive + Use for stock, Edit + Delete for the material (5 x 2 rows).
        await page.waitForFunction(() => document.querySelectorAll("#materialTableBody button").length === 10);
        assert.equal(await page.locator("#materialTableBody .btn-edit, #materialTableBody .btn-delete").count(), 4);
        assert.equal(await page.locator("#materialTableBody .btn-receive, #materialTableBody .btn-use").count(), 4);
        assert.equal(await page.locator("#addMaterialButton").isVisible(), true);
        await context.close();
    });

    it("Undo after being demoted does not write, and says why", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await deleteBtn(page, "Cement").click();
        await waitForRows(page, ["Sand"]);
        await page.evaluate(() => window.__nailit.externalSetRole("sA", "viewer"));
        await page.waitForFunction(() => document.getElementById("roleBadge").textContent === "Your role: Viewer");
        await page.locator(".toast-action").click();
        await toastLocator(page, "no longer edit this site").waitFor();
        assert.equal(restoresOf(await wrote(page), "materials/sA/m1").length, 0);
        await context.close();
    });
});

// The modals cover the sidebar, so a mouse cannot reach it. A script, a keyboard shortcut or a
// late event can, and that is the case being tested: click the link from the DOM.
const domSelectSite = (page, name) => page.evaluate((siteName) => {
    [...document.querySelectorAll("#siteList a")].find((a) => a.textContent === siteName).click();
}, name);

describe("an edit never lands in the wrong site", () => {
    it("moving to another site closes the edit form, so a late submit writes nothing", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await editBtn(page, "Cement").click();
        await domSelectSite(page, "Cape Town");
        await page.waitForFunction(() => !document.getElementById("updateFormContainer").open);
        await page.evaluate(() => document.getElementById("updateForm").requestSubmit());
        await page.waitForTimeout(50);
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("an edit sent from one site is filed under that site even if the user has moved on", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.evaluate(() => { window.__nailit.holdAcks = true; });
        await editBtn(page, "Cement").click();
        await page.fill("#uMinLevel", "8");
        await page.click("#update-material-btn");
        await domSelectSite(page, "Cape Town");
        await waitForRows(page, ["Nails"]);
        const [write] = await wrote(page);
        assert.deepEqual(materialsTouched(write), ["materials/sA/m1"]);
        assert.equal((await dbState(page)).materials.sB.m3.name, "Nails", "Cape Town untouched");
        await context.close();
    });
});

describe("members dialog: owner", () => {
    const members = {
        sA: [
            { uid: "u1", role: "owner", email: "foreman@example.com" },
            { uid: "u2", role: "storekeeper", email: "kip@example.com" },
            { uid: "u3", role: "viewer", email: null },
        ],
    };
    const seed = (extra = {}) => ({
        ...SEED,
        members,
        siteInvites: { sA: [{ key: "ann@mail,example,com", email: "ann@mail.example.com", role: "viewer" }] },
        ...extra,
    });

    async function open(page) {
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.click("#membersButton");
        await page.locator("#memberList li").first().waitFor();
    }

    it("lists everyone with their role, marks the owner's own row, and shows pending invitations", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        const names = await page.locator("#memberList .member-name").allTextContents();
        assert.deepEqual(names, ["foreman@example.com (you)", "kip@example.com", `User u3`]);
        assert.equal(await page.locator("#memberList li").first().locator(".member-role").textContent(), "Owner");
        assert.equal(await page.locator("#memberList select").count(), 2, "role selects for the two non-owners");
        assert.equal(await page.locator("#memberList li", { hasText: "kip@example.com" }).locator("select").inputValue(), "storekeeper");
        assert.equal(await page.locator("#inviteSection").isVisible(), true);
        assert.equal(await page.locator("#leaveSiteButton").isHidden(), true, "the owner cannot leave");
        assert.deepEqual(await page.locator("#pendingInviteList .member-name").allTextContents(), ["ann@mail.example.com"]);
        await context.close();
    });

    it("invites by email: one write with the lower-cased key, the site name, the inviter and the role", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.fill("#inviteEmail", "  Sam.W@Mail.Example.com ");
        await page.selectOption("#inviteRole", "storekeeper");
        await page.click("#inviteSubmit");
        await toastLocator(page, "Invite saved for sam.w@mail.example.com").waitFor();

        const writes = await wrote(page);
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0], {
            op: "invite",
            siteId: "sA",
            siteName: "Mombasa",
            invitedBy: "foreman@example.com",
            key: "sam,w@mail,example,com",
            role: "storekeeper",
        });
        assert.equal(await page.inputValue("#inviteEmail"), "", "the form is cleared");
        await page.locator("#pendingInviteList li", { hasText: "sam.w@mail.example.com" }).waitFor();
        assert.deepEqual(state.dialogs, []);
        await context.close();
    });

    it("the invite confirmation says nothing was emailed, so the owner knows to tell them", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.fill("#inviteEmail", "sam@example.com");
        await page.click("#inviteSubmit");
        const toast = toastLocator(page, "Invite saved");
        await toast.waitFor();
        assert.match(await toast.textContent(), /Ask them to sign in with that email/);
        await context.close();
    });

    it("the role list offers storekeeper and viewer, never owner", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        const options = await page.locator("#inviteRole option").evaluateAll((o) => o.map((x) => [x.value, x.textContent]));
        assert.deepEqual(options, [["storekeeper", "Storekeeper"], ["viewer", "Viewer"]]);
        await context.close();
    });

    it("refuses a bad email and the owner's own email, with no write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.evaluate(() => { document.getElementById("inviteForm").noValidate = true; });
        await page.fill("#inviteEmail", "not-an-email");
        await page.click("#inviteSubmit");
        await toastLocator(page, "Enter a valid email address").waitFor();
        await page.fill("#inviteEmail", "Foreman@Example.com");
        await page.click("#inviteSubmit");
        await toastLocator(page, "your own email").waitFor();
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("revokes a pending invitation", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.locator("#pendingInviteList li", { hasText: "ann@mail.example.com" }).locator(".revoke-invite").click();
        await page.waitForFunction(() => document.querySelector("#pendingInviteList .member-name") === null);
        assert.deepEqual((await wrote(page))[0], { op: "revoke", siteId: "sA", key: "ann@mail,example,com" });
        assert.equal(await page.locator("#pendingInviteList").textContent(), "No pending invitations.");
        await context.close();
    });

    it("changes a member's role in one write, and says so", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.locator("#memberList li", { hasText: "kip@example.com" }).locator("select").selectOption("viewer");
        await toastLocator(page, "kip@example.com is now Viewer").waitFor();
        assert.deepEqual(await wrote(page), [{ op: "role", siteId: "sA", uid: "u2", role: "viewer" }]);
        await context.close();
    });

    it("removes a member in one write", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.locator("#memberList li", { hasText: "kip@example.com" }).locator(".remove-member").click();
        await toastLocator(page, "Removed kip@example.com").waitFor();
        assert.deepEqual(await wrote(page), [{ op: "removeMember", siteId: "sA", uid: "u2" }]);
        await page.waitForFunction(() => document.querySelectorAll("#memberList li").length === 2);
        await context.close();
    });

    it("emails and invitation text are shown as text, never as HTML", async () => {
        const evil = "<img src=x onerror=window.__pwned=1>@x.co";
        const s = seed({
            members: { sA: [{ uid: "u1", role: "owner", email: "foreman@example.com" }, { uid: "u9", role: "viewer", email: evil }] },
            siteInvites: { sA: [{ key: "k", email: evil, role: "viewer" }] },
        });
        const { context, page } = await openDashboard(browser, baseUrl, s);
        await open(page);
        assert.equal(await page.locator("#memberList img, #pendingInviteList img").count(), 0);
        assert.equal(await page.locator("#memberList .member-name").nth(1).textContent(), evil);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        await context.close();
    });

    it("Close hides the dialog and stops listening to the members", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        assert.equal((await page.evaluate(() => window.__nailit.activeListeners())).filter((l) => l.kind === "members").length, 1);
        await page.click("#membersClose");
        assert.equal(await page.locator("#membersContainer").evaluate((el) => el.open), false);
        assert.equal((await page.evaluate(() => window.__nailit.activeListeners())).filter((l) => l.kind === "members").length, 0);
        await context.close();
    });

    it("switching site closes the dialog, so it never shows one site's members over another", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, seed());
        await open(page);
        await page.evaluate(() => document.querySelector("#siteList li:nth-child(2) a").click());
        await page.waitForFunction(() => !document.getElementById("membersContainer").open);
        await context.close();
    });
});

describe("members dialog: storekeeper and viewer", () => {
    for (const role of ["storekeeper", "viewer"]) {
        it(`${role}: sees who is in the site, but cannot invite, change roles or remove anyone`, async () => {
            const seed = {
                ...SEED,
                roles: { sA: role },
                members: { sA: [
                    { uid: "u9", role: "owner", email: "boss@example.com" },
                    { uid: "u1", role, email: "foreman@example.com" },
                ] },
            };
            const { context, page } = await openDashboard(browser, baseUrl, seed);
            await selectSite(page, "Mombasa");
            await waitForRows(page, ["Cement", "Sand"]);
            await page.click("#membersButton");
            await page.locator("#memberList li").first().waitFor();
            assert.deepEqual(await page.locator("#memberList .member-name").allTextContents(), ["boss@example.com", "foreman@example.com (you)"]);
            assert.equal(await page.locator("#inviteSection").isHidden(), true);
            assert.equal(await page.locator("#memberList select").count(), 0);
            assert.equal(await page.locator("#memberList button").count(), 0);
            assert.equal(await page.locator("#leaveSiteButton").isVisible(), true);
            const kinds = (await page.evaluate(() => window.__nailit.activeListeners())).filter((l) => l.kind === "members");
            assert.equal(kinds.length, 1);
            await context.close();
        });
    }

    it("leaving takes two taps, and the first one writes nothing", async () => {
        const seed = { ...SEED, roles: { sA: "viewer" } };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.click("#membersButton");
        await page.click("#leaveSiteButton");
        assert.equal(await page.locator("#leaveSiteButton").textContent(), "Tap again to leave");
        assert.deepEqual(await wrote(page), []);

        await page.click("#leaveSiteButton");
        await toastLocator(page, "You left Mombasa").waitFor();
        assert.deepEqual(await wrote(page), [{ op: "removeMember", siteId: "sA", uid: "u1" }]);
        // The site drops out of the list, the selection and the dialog go with it.
        await page.waitForFunction(() => document.querySelectorAll("#siteList li").length === 1);
        assert.equal(await page.locator("#siteList a.active").count(), 0);
        assert.equal(await page.locator("#membersContainer").evaluate((el) => el.open), false);
        await context.close();
    });

    it("the armed button disarms itself after a few seconds", async () => {
        const seed = { ...SEED, roles: { sA: "viewer" } };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.click("#membersButton");
        await page.click("#leaveSiteButton");
        await page.waitForFunction(() => document.getElementById("leaveSiteButton").textContent === "Leave site", null, { timeout: 6000 });
        assert.deepEqual(await wrote(page), []);
        await context.close();
    });

    it("closing and reopening the dialog starts disarmed", async () => {
        const seed = { ...SEED, roles: { sA: "viewer" } };
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await selectSite(page, "Mombasa");
        await waitForRows(page, ["Cement", "Sand"]);
        await page.click("#membersButton");
        await page.click("#leaveSiteButton");
        await page.click("#membersClose");
        await page.click("#membersButton");
        assert.equal(await page.locator("#leaveSiteButton").textContent(), "Leave site");
        await context.close();
    });
});

describe("invitations for this account", () => {
    const invited = (extra = {}) => ({
        ...SEED,
        sites: { ...SEED.sites, sX: { name: "Kisumu", location: "Lake", buildingType: "Other", createdAt: 1, ownerUid: "boss" } },
        materials: { ...SEED.materials, m9: { name: "Bricks", quantity: 100, units: "pieces", lastUpdated: "2024-06-01", siteId: "sX" } },
        hiddenSites: ["sX"],
        invites: { sX: { role: "storekeeper", siteName: "Kisumu", invitedBy: "boss@example.com" } },
        ...extra,
    });

    it("shows who invited you, to what, and as what", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, invited());
        await page.locator("#invitesPanel").waitFor();
        assert.equal(await page.locator("#inviteList li span").textContent(), "boss@example.com invited you to Kisumu as Storekeeper");
        assert.equal(await siteLink(page, "Kisumu").count(), 0, "not in the site list until accepted");
        await context.close();
    });

    it("Accept joins with the invited role in one write, opens the site and clears the panel", async () => {
        const { context, page, state } = await openDashboard(browser, baseUrl, invited());
        await page.locator("#invitesPanel").waitFor();
        await page.getByRole("button", { name: "Accept" }).click();
        await toastLocator(page, "Joined Kisumu as Storekeeper").waitFor();

        assert.deepEqual(await wrote(page), [{ op: "accept", siteId: "sX", uid: "u1", key: "foreman@example,com", role: "storekeeper" }]);
        await waitForRows(page, ["Bricks"]);
        assert.equal(await siteLink(page, "Kisumu").getAttribute("class"), "active");
        assert.equal(await page.locator("#roleBadge").textContent(), "Your role: Storekeeper");
        assert.equal(await page.locator("#invitesPanel").isHidden(), true);
        assert.deepEqual(state.dialogs, []);
        await context.close();
    });

    it("the invitation cannot be accepted twice by tapping twice", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, invited());
        await page.locator("#invitesPanel").waitFor();
        await page.evaluate(() => {
            const accept = [...document.querySelectorAll("#inviteList button")].find((b) => b.textContent === "Accept");
            accept.click();
            accept.click();
        });
        await toastLocator(page, "Joined Kisumu").waitFor();
        assert.equal((await wrote(page)).filter((w) => w.op === "accept").length, 1);
        await context.close();
    });

    it("Decline deletes the invitation and does not join", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, invited());
        await page.locator("#invitesPanel").waitFor();
        await page.getByRole("button", { name: "Decline" }).click();
        await page.waitForFunction(() => document.getElementById("invitesPanel").hidden);
        assert.deepEqual(await wrote(page), [{ op: "decline", siteId: "sX", key: "foreman@example,com" }]);
        assert.equal(await siteLink(page, "Kisumu").count(), 0);
        await context.close();
    });

    it("a refused join shows the error, keeps the invitation, and opens nothing", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, invited(), {
            beforeLoad: () => { window.__preset = { failAccept: "permission_denied" }; },
        });
        await page.locator("#invitesPanel").waitFor();
        await page.getByRole("button", { name: "Accept" }).click();
        await toastLocator(page, "permission_denied").waitFor();
        assert.equal(await page.locator("#invitesPanel").isVisible(), true);
        assert.equal(await page.locator("#siteList a.active").count(), 0);
        assert.equal(await siteLink(page, "Kisumu").count(), 0);
        await context.close();
    });

    it("text in an invitation is shown as text", async () => {
        const evil = "<img src=x onerror=window.__pwned=1>";
        const seed = invited({ invites: { sX: { role: "viewer", siteName: evil, invitedBy: evil } } });
        const { context, page } = await openDashboard(browser, baseUrl, seed);
        await page.locator("#invitesPanel").waitFor();
        assert.equal(await page.locator("#invitesPanel img").count(), 0);
        assert.equal(await page.evaluate(() => window.__pwned), undefined);
        await context.close();
    });

    it("an invitation that arrives while the page is open appears without a reload", async () => {
        const { context, page } = await openDashboard(browser, baseUrl, { ...invited(), invites: {} });
        assert.equal(await page.locator("#invitesPanel").isHidden(), true);
        await page.evaluate(() => window.__nailit.externalAddInvite("sX", { role: "viewer", siteName: "Kisumu", invitedBy: "boss@example.com" }));
        await page.locator("#invitesPanel").waitFor();
        await context.close();
    });

    it("no invitations means no panel", async () => {
        const { context, page } = await openDashboard(browser, baseUrl);
        assert.equal(await page.locator("#invitesPanel").isHidden(), true);
        await context.close();
    });
});

describe("eval: the roles as one story", () => {
    it("owner invites, the invited storekeeper joins and records stock, a viewer only reads, nothing native pops up", async () => {
        // The owner's page
        const owner = await openDashboard(browser, baseUrl);
        await selectSite(owner.page, "Mombasa");
        await waitForRows(owner.page, ["Cement", "Sand"]);
        await owner.page.click("#membersButton");
        await owner.page.fill("#inviteEmail", "kip@example.com");
        await owner.page.selectOption("#inviteRole", "storekeeper");
        await owner.page.click("#inviteSubmit");
        await toastLocator(owner.page, "Invite saved for kip@example.com").waitFor();
        const invite = (await wrote(owner.page))[0];
        assert.equal(invite.role, "storekeeper");

        // The invited person's page: same data, their own account and the invitation the owner wrote
        const kip = await openDashboard(browser, baseUrl, {
            ...SEED,
            user: { uid: "u2", email: "kip@example.com", emailVerified: true },
            hiddenSites: ["sA"],
            invites: { sA: { role: invite.role, siteName: invite.siteName, invitedBy: invite.invitedBy } },
        });
        await kip.page.getByRole("button", { name: "Accept" }).click();
        await waitForRows(kip.page, ["Cement", "Sand"]);
        assert.equal(await kip.page.locator("#roleBadge").textContent(), "Your role: Storekeeper");
        await kip.page.locator("#materialTableBody tr", { hasText: "Cement" }).locator("button[aria-label='Edit material']").click();
        await kip.page.fill("#uMinLevel", "7");
        await kip.page.click("#update-material-btn");
        await kip.page.waitForFunction(() => window.__nailit.writes.some((w) => w.op === "multi"));

        // A viewer's page
        const viewer = await openDashboard(browser, baseUrl, { ...SEED, roles: { sA: "viewer" } });
        await selectSite(viewer.page, "Mombasa");
        await waitForRows(viewer.page, ["Cement", "Sand"]);
        assert.equal(await viewer.page.locator("#materialTableBody button:not(.btn-history)").count(), 0);

        for (const { state } of [owner, kip, viewer]) {
            assert.deepEqual(state.dialogs, []);
            assert.deepEqual(state.pageErrors, []);
            assert.deepEqual(state.blocked, []);
        }
        await owner.context.close();
        await kip.context.close();
        await viewer.context.close();
    });
});
