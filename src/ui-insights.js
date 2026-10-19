// The Phase 4 dashboard controls: the site summary tiles, the "Needs attention" strip, and the
// search box, filter chips and sort menu above the materials. DOM code only. What counts as low,
// how a list is searched and sorted, and the wording of the summary all come from src/insights.js.
//
// Layout, "At a glance": three big tiles (materials, low on stock, last activity), the low tile
// loud when something is low and calm green when nothing is; under it the low materials as
// tappable pills; under that one row of search, chips and sort. The figures on the tiles are for
// the eye (aria-hidden); the same facts are also in .summary-* spans as plain sentences.
//
// Everything that comes from the database (material names) goes in with textContent, never innerHTML.
import {
    visibleMaterials,
    summarizeSite,
    summaryText,
    ageLabel,
    overviewRow,
    SORTS,
    DEFAULT_SORT,
} from "./insights.js";

const CLOCK_MS = 60_000;      // "1h ago" is re-worded once a minute
const MAX_PILLS = 6;          // more than this and the strip says "+N more" and opens the Low filter
const MAX_PILLS_PHONE = 3;    // on a phone the strip wraps instead of scrolling sideways, so it stays short
const FLASH_MS = 2200;        // how long a row stays highlighted after its pill was tapped

const $ = (id) => document.getElementById(id);

const set = (parent, selector, text) => {
    parent.querySelector(selector).textContent = text;
};

// `onViewChange()` is called when the search, filter or sort changed and the rows must be redrawn.
// The controls are static markup, never rebuilt, so a live stock change cannot take the keyboard
// away from the search box.
export function createInsightsUI({ onViewChange }) {
    const root = $("insights");
    const summaryEl = $("siteSummary");
    const totalTile = summaryEl.querySelector(".stat-total");
    const lowTile = $("summaryLowTile");
    const activityTile = summaryEl.querySelector(".stat-activity");
    const attention = $("needsAttention");
    const attentionList = $("attentionList");
    const controls = $("materialControls");
    const searchInput = $("materialSearch");
    const sortSelect = $("materialSort");
    const allChip = $("filterAll");
    const lowChip = $("filterLow");

    // The per-site view. Reset whenever another site opens.
    let siteId = null;
    let materials = null;           // null until the site's first snapshot
    let lastMovementAt = 0;
    let query = "";
    let filter = "all";
    let sort = DEFAULT_SORT;

    for (const { id, label } of SORTS) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = label;
        sortSelect.appendChild(option);
    }

    const view = () => ({ query, filter, sort });

    // ---- summary tiles ------------------------------------------------------------------------

    function renderSummary() {
        const summary = summarizeSite({ materials: materials || {}, lastMovementAt });
        const words = summaryText(summary);

        set(totalTile, ".stat-num", String(summary.total));
        set(totalTile, ".stat-label", summary.total === 1 ? "material" : "materials");
        set(totalTile, ".summary-total", words.total);

        const calm = summary.low === 0;
        lowTile.classList.toggle("is-alert", !calm);
        lowTile.classList.toggle("is-calm", calm && summary.total > 0);
        set(lowTile, ".stat-num", summary.total === 0 ? "-" : calm ? "✓" : String(summary.low));
        set(lowTile, ".stat-label", summary.total === 0 ? "nothing tracked" : calm ? "All stocked" : "low on stock");
        set(lowTile, ".summary-low", words.low);
        // The tile is a shortcut to the Low filter, so it only works when something is low.
        lowTile.disabled = calm;
        lowTile.setAttribute("aria-pressed", String(filter === "low"));
        lowTile.title = calm ? "" : filter === "low" ? "Show all materials" : "Show only the low materials";

        set(activityTile, ".stat-num", summary.lastActivity ? ageLabel(summary.lastActivity) : "-");
        set(activityTile, ".stat-label", summary.lastActivity ? "last activity" : "No activity yet");
        set(activityTile, ".summary-activity", words.activity);
    }

    // ---- the Needs attention strip ------------------------------------------------------------

    function renderAttention() {
        const row = overviewRow({ siteId, site: null, materials: materials || {}, lastMovementAt });
        const limit = window.matchMedia && window.matchMedia("(max-width: 700px)").matches ? MAX_PILLS_PHONE : MAX_PILLS;
        // With the Low filter on, the list below already is the low list: do not show it twice.
        attention.hidden = row.low === 0 || filter === "low";
        attentionList.replaceChildren();
        for (const item of row.lowItems.slice(0, limit)) {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = `attention-pill${item.label === "Out" ? " is-out" : ""}`;
            pill.dataset.materialId = item.id;
            pill.title = `Show ${item.name} in the list`;
            const name = document.createElement("span");
            name.className = "pill-name";
            name.textContent = item.name;
            const state = document.createElement("span");
            state.className = "pill-state";
            state.textContent = item.label;
            const detail = document.createElement("span");
            detail.className = "pill-detail";
            detail.textContent = item.detail;
            pill.append(name, state, detail);
            pill.addEventListener("click", () => jumpTo(item.id));
            const entry = document.createElement("li");
            entry.appendChild(pill);
            attentionList.appendChild(entry);
        }
        if (row.low > limit) {
            const more = document.createElement("button");
            more.type = "button";
            more.className = "attention-pill attention-more";
            more.textContent = `+${row.low - limit} more`;
            more.addEventListener("click", () => setFilter("low", { scroll: true }));
            const entry = document.createElement("li");
            entry.appendChild(more);
            attentionList.appendChild(entry);
        }
    }

    // Tapping a pill brings its row into view and lights it up for a moment. If the search or
    // filter is hiding the row, they are cleared first: the person asked to see that material.
    function jumpTo(materialId) {
        const shown = visibleMaterials(materials, view()).some(([id]) => id === materialId);
        if (!shown) {
            query = "";
            filter = "all";
            syncControls();
            onViewChange();
        }
        const row = document.querySelector(`#materialTableBody tr[data-material-id="${CSS.escape(materialId)}"]`);
        if (!row) {
            return;
        }
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        row.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        row.classList.remove("row-flash");
        void row.offsetWidth; // restart the animation if the same pill is tapped twice
        row.classList.add("row-flash");
        row.tabIndex = -1;
        row.focus({ preventScroll: true });
        setTimeout(() => row.classList.remove("row-flash"), FLASH_MS);
    }

    // ---- controls -----------------------------------------------------------------------------

    function syncControls() {
        if (searchInput.value !== query) {
            searchInput.value = query; // only when it differs: a live update must not disturb typing
        }
        sortSelect.value = sort;
        allChip.setAttribute("aria-pressed", String(filter === "all"));
        lowChip.setAttribute("aria-pressed", String(filter === "low"));
        lowTile.setAttribute("aria-pressed", String(filter === "low"));
    }

    function renderControls() {
        const low = summarizeSite({ materials: materials || {} }).low;
        lowChip.textContent = `Low stock (${low})`;
        controls.hidden = !materials || Object.keys(materials).length === 0;
        syncControls();
    }

    function setFilter(next, { scroll = false } = {}) {
        filter = next;
        syncControls();
        renderSummary();
        renderAttention();
        onViewChange();
        if (scroll) {
            const table = $("materialsTable");
            if (table) {
                table.scrollIntoView({ block: "start", behavior: "smooth" });
            }
        }
    }

    searchInput.addEventListener("input", () => {
        query = searchInput.value;
        onViewChange();
    });
    // The phone keyboard's search key closes the keyboard, so the results are in view.
    searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchInput.blur();
        }
    });
    sortSelect.addEventListener("change", () => {
        sort = sortSelect.value;
        onViewChange();
    });
    allChip.addEventListener("click", () => setFilter("all"));
    lowChip.addEventListener("click", () => setFilter("low"));
    lowTile.addEventListener("click", () => setFilter(filter === "low" ? "all" : "low", { scroll: filter !== "low" }));

    // "1h ago" goes stale on a screen that stays open on site all day.
    setInterval(() => {
        if (materials) {
            renderSummary();
        }
    }, CLOCK_MS);

    // ---- what dashboard.js calls --------------------------------------------------------------

    return {
        // Another site opened, or none: the search, filter and sort start over, and nothing shows until
        // the new site's materials arrive (so a "0 materials" flash never happens).
        setSite(nextSiteId) {
            siteId = nextSiteId;
            materials = null;
            lastMovementAt = 0;
            query = "";
            filter = "all";
            sort = DEFAULT_SORT;
            root.hidden = true;
            attentionList.replaceChildren();
            syncControls();
        },
        // The site's materials changed (also the first time). Search, filter and sort are untouched.
        update(nextMaterials) {
            materials = nextMaterials;
            root.hidden = false;
            renderSummary();
            renderAttention();
            renderControls();
        },
        // The newest movement of the open site, from the activity feed's own subscription.
        setLastMovement(movementSiteId, at) {
            if (movementSiteId !== siteId || typeof at !== "number" || at === lastMovementAt) {
                return;
            }
            lastMovementAt = at;
            if (materials) {
                renderSummary();
            }
        },
        view,
        // A search or a filter is narrowing the list.
        isNarrowed: () => query.trim() !== "" || filter !== "all",
        // Back to everything: the way out of an empty result.
        clearView() {
            query = "";
            filter = "all";
            syncControls();
            renderSummary();
            onViewChange();
        },
        // Why the table is empty when the site has materials but the view shows none. "" when it is not.
        emptyMessage() {
            const typed = query.trim();
            if (typed) {
                return filter === "low" ? `No low-stock materials match "${typed}".` : `No materials match "${typed}".`;
            }
            return filter === "low" ? "Nothing is low on stock." : "";
        },
    };
}
