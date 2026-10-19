// The owner overview: every site the person can see, with its low-stock count and last activity,
// so the business owner does not have to open each site. Read only: this page writes nothing.
//
// Per site there is one materials listener and one listener for the newest movement. Both stop
// when the site disappears from the list or the page is left. What a row says (low items, totals,
// order) comes from src/insights.js, the same wording as the dashboard.
//
// Site and material names are other people's text: textContent only, never innerHTML.
import * as data from "./src/data.js";
import * as auth from "./src/auth.js";
import { isStale, overviewRow, sortOverview, overviewTotals, summaryText } from "./src/insights.js";
import { roleLabel } from "./src/roles.js";
import { showToast } from "./src/toast.js";

const MAX_LOW_ITEMS = 3;          // "Paint, Cement, Sand and 2 more"
const CLOCK_MS = 60_000;          // "1h ago" is re-worded once a minute

const userEmailEl = document.getElementById("userEmail");
const signOutButton = document.getElementById("signOutButton");
const totalsEl = document.getElementById("overviewTotals");
const statusEl = document.getElementById("overviewStatus");
const listEl = document.getElementById("overviewList");

let currentUser = null;
let sessionStarted = false;
let stopSites = null;
let sites = {};                       // latest sites snapshot, each with the person's role
let sitesLoaded = false;
let sitesError = null;
// siteId -> { stopMaterials, stopMovements, materials, lastMovementAt, materialsState, movementsState }
const watches = new Map();
let renderQueued = false;

function reportError(error) {
    showToast(error && error.message ? error.message : String(error), { kind: "error" });
}

// ---- Session --------------------------------------------------------------------------

auth.onUser((user) => {
    if (!user) {
        location.replace("login.html"); // signed out here or in another tab: nothing to show
        return;
    }
    if (sessionStarted && currentUser && currentUser.uid !== user.uid) {
        location.reload(); // a different account signed in: start clean
        return;
    }
    currentUser = user;
    userEmailEl.textContent = user.email || "";
    if (!sessionStarted) {
        sessionStarted = true;
        stopSites = data.subscribeSites(user.uid, onSites, (error) => {
            sitesError = error;
            queueRender();
            reportError(error);
        });
    }
});

signOutButton.addEventListener("click", () => {
    Promise.resolve().then(() => auth.signOut()).catch(reportError);
});

// ---- Listeners: a materials and a movements listener per site -------------------------------

function onSites(snapshot) {
    sites = snapshot;
    sitesLoaded = true;
    sitesError = null;
    for (const siteId of [...watches.keys()]) {
        if (!sites[siteId]) {
            stopWatching(siteId);
        }
    }
    for (const siteId of Object.keys(sites)) {
        if (!watches.has(siteId)) {
            startWatching(siteId);
        }
    }
    queueRender();
}

function startWatching(siteId) {
    const watch = {
        stopMaterials: null,
        stopMovements: null,
        materials: {},
        lastMovementAt: 0,
        materialsState: "loading",
        movementsState: "loading",
    };
    watches.set(siteId, watch);
    // A callback from a listener that was stopped, or from a site that was replaced, is ignored.
    const current = () => watches.get(siteId) === watch;
    watch.stopMaterials = data.subscribeMaterials(siteId, (materials) => {
        if (current()) {
            watch.materials = materials || {};
            watch.materialsState = "ready";
            queueRender();
        }
    }, () => {
        if (current()) {
            watch.materialsState = "error";
            queueRender();
        }
    });
    watch.stopMovements = data.subscribeMovements(siteId, { limit: 1 }, (movements) => {
        if (current()) {
            const newest = movements[movements.length - 1];
            watch.lastMovementAt = newest ? newest.at : 0;
            watch.movementsState = "ready";
            queueRender();
        }
    }, () => {
        if (current()) {
            watch.movementsState = "error"; // the card still shows the stock; only the movement time is missing
            queueRender();
        }
    });
}

function stopWatching(siteId) {
    const watch = watches.get(siteId);
    if (!watch) {
        return;
    }
    watches.delete(siteId);
    watch.stopMaterials();
    watch.stopMovements();
}

window.addEventListener("pagehide", () => {
    if (stopSites) {
        stopSites();
        stopSites = null;
    }
    [...watches.keys()].forEach(stopWatching);
});

// ---- Drawing --------------------------------------------------------------------------

// Many listeners answer at about the same moment when the page opens. One redraw per burst.
function queueRender() {
    if (renderQueued) {
        return;
    }
    renderQueued = true;
    setTimeout(() => {
        renderQueued = false;
        render();
    }, 0);
}

const settled = (watch) => watch.materialsState !== "loading" && watch.movementsState !== "loading";

function setStatus(text, { action = false } = {}) {
    statusEl.textContent = text;
    statusEl.hidden = text === "";
    document.getElementById("overviewAddSite").hidden = !action;
}

function render() {
    const ids = Object.keys(sites);
    if (sitesError) {
        setStatus("Could not load your sites.");
        return clearList();
    }
    if (!sitesLoaded) {
        setStatus("Loading sites...");
        return clearList();
    }
    if (ids.length === 0) {
        setStatus("No sites yet. Add your first site on the dashboard, and it shows up here.", { action: true });
        return clearList();
    }
    // Every site is drawn together once all have answered, so the order never jumps while the
    // first answers arrive.
    if (ids.some((siteId) => !watches.has(siteId) || !settled(watches.get(siteId)))) {
        setStatus("Loading sites...");
        return clearList();
    }
    setStatus("");

    const rows = ids.map((siteId) => {
        const watch = watches.get(siteId);
        const row = overviewRow({ siteId, site: sites[siteId], materials: watch.materials, lastMovementAt: watch.lastMovementAt });
        row.role = sites[siteId].role;
        row.failed = watch.materialsState === "error";
        return row;
    });
    const sorted = sortOverview(rows.map((row) => (row.failed ? { ...row, low: 0 } : row)));
    const totals = overviewTotals(sorted);
    totalsEl.textContent = totals.text;
    totalsEl.hidden = false;
    totalsEl.classList.toggle("has-low", totals.low > 0);

    // The table is rebuilt on every update, so a focused link would be lost: look it up again.
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest("li.overview-site");
    const focusedId = focused && listEl.contains(focused) ? focused.dataset.siteId : null;
    listEl.replaceChildren(...sorted.map(buildCard));
    if (focusedId) {
        const link = listEl.querySelector(`li[data-site-id="${CSS.escape(focusedId)}"] a.overview-open`);
        if (link) {
            link.focus({ preventScroll: true });
        }
    }
}

function clearList() {
    listEl.replaceChildren();
    totalsEl.textContent = "";
    totalsEl.hidden = true;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

// One site. Troubled sites are warm and come first; healthy ones are quiet grey-green. The big
// figure is for the eye (aria-hidden); .overview-low carries the same fact as a sentence.
function buildCard(row) {
    const words = summaryText(row);
    const tone = row.failed ? "is-error" : row.total === 0 ? "is-empty" : row.low > 0 ? "is-trouble" : "is-calm";
    const card = el("li", `overview-site ${tone}`);
    card.dataset.siteId = row.siteId;

    const title = el("div", "overview-title");
    title.append(el("h2", "overview-name", row.name));
    if (row.location) {
        title.append(el("span", "overview-location", row.location));
    }
    if (row.role && row.role !== "owner") {
        title.append(el("span", "overview-role", roleLabel(row.role)));
    }

    const figure = el("div", "overview-figure");
    figure.setAttribute("aria-hidden", "true");
    if (row.failed) {
        figure.append(el("span", "overview-bignum", "?"), el("span", "overview-bigword", "no data"));
    } else if (row.total === 0) {
        figure.append(el("span", "overview-bignum", "-"), el("span", "overview-bigword", "no materials"));
    } else if (row.low > 0) {
        figure.append(el("span", "overview-bignum", String(row.low)), el("span", "overview-bigword", "low on stock"));
    } else {
        figure.append(el("span", "overview-bignum", "✓"), el("span", "overview-bigword", "all stocked"));
    }

    const top = el("div", "overview-top");
    top.append(title, figure);
    card.append(top, el("p", "overview-low sr-only", row.failed ? "Could not load the stock" : words.low));

    if (row.total > 0 && !row.failed) {
        const bar = el("div", "overview-bar");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", `${row.low} of ${row.total} materials low`);
        const fill = el("span", "overview-bar-fill");
        fill.style.setProperty("--share", `${Math.round((row.low / row.total) * 100)}%`);
        bar.append(fill);
        card.append(bar, el("p", "overview-bar-caption", `${row.low} of ${row.total} ${row.total === 1 ? "material" : "materials"} low`));
    }

    const meta = el("p", "overview-meta");
    const activity = el("span", `overview-activity${isStale(row.lastActivity) ? " is-stale" : ""}`, words.activity);
    meta.append(el("span", "overview-total", words.total), activity);
    if (isStale(row.lastActivity)) {
        // In words, not only in tone: "all stocked" on a site nobody has touched in months can mislead.
        meta.append(el("span", "overview-stale-tag", "No recent updates"));
    }
    card.append(meta);

    if (row.lowItems.length > 0 && !row.failed) {
        const items = el("ul", "overview-lowitems");
        for (const item of row.lowItems.slice(0, MAX_LOW_ITEMS)) {
            const li = el("li");
            li.append(
                el("span", "overview-item-name", item.name),
                " ",
                el("span", `badge-low${item.label === "Out" ? " badge-out" : ""}`, item.label),
                " ",
                el("span", "low-detail", item.detail),
            );
            items.append(li);
        }
        card.append(items);
        if (row.lowItems.length > MAX_LOW_ITEMS) {
            card.append(el("p", "overview-more", `and ${row.lowItems.length - MAX_LOW_ITEMS} more`));
        }
    }

    const open = el("a", "overview-open", "Open dashboard");
    open.href = `dashboard.html?site=${encodeURIComponent(row.siteId)}`;
    open.setAttribute("aria-label", `Open dashboard for ${row.name}`);
    card.append(open);
    return card;
}

// "1h ago" goes stale on a screen that stays open all day.
setInterval(() => {
    if (sitesLoaded) {
        render();
    }
}, CLOCK_MS);
