// Phase 4: "are we running out of anything?" Pure: no DOM, no Firebase, so the rules of what counts
// as low stock, how a list is searched, filtered and sorted, and how a site is summarised run in
// Node tests and say the same thing on every page.
//
// A material is low when it has a low-stock level (minLevel) and the stock is at or below it.
// Without a level nothing is flagged: the level is how somebody says "watch this one".
import { nameKey } from "./logic.js";
import { formatQuantity, timeAgo } from "./movements.js";

export const SORTS = [
    { id: "added", label: "Added" },
    { id: "name", label: "Name" },
    { id: "quantity", label: "Stock, lowest first" },
    { id: "updated", label: "Updated, newest first" },
];
export const DEFAULT_SORT = "added";
export const FILTERS = ["all", "low"];

const hasLevel = (material) => Boolean(material) && typeof material.minLevel === "number" && Number.isFinite(material.minLevel);
const stockOf = (material) => (material && typeof material.quantity === "number" ? material.quantity : 0);

// "ok", "low" (at or below the level) or "out" (nothing left, and a level is set).
export function stockState(material) {
    if (!hasLevel(material) || stockOf(material) > material.minLevel) {
        return "ok";
    }
    return stockOf(material) <= 0 ? "out" : "low";
}

export const isLow = (material) => stockState(material) !== "ok";

// The word on the badge. A word, so colour is never the only cue.
export function lowLabel(material) {
    const state = stockState(material);
    return state === "out" ? "Out" : state === "low" ? "Low" : "";
}

// The dropdown units are plural; one of them is singular ("1 piece left", not "1 pieces left").
const SINGULAR = { tonnes: "tonne", bags: "bag", pieces: "piece", metres: "metre", litres: "litre", bundles: "bundle", sheets: "sheet" };
export const unitFor = (units, quantity) => (quantity === 1 && SINGULAR[units]) || units;

// "3 bags left, level 10": what a person wants to read next to the badge.
export function lowDetail(material) {
    if (!isLow(material)) {
        return "";
    }
    const quantity = stockOf(material);
    const units = material.units ? ` ${unitFor(material.units, quantity)}` : "";
    return `${formatQuantity(quantity)}${units} left, level ${formatQuantity(material.minLevel)}`;
}

// Entries are [materialId, material] pairs, in the order the database gave them.
// query: matched against the name, ignoring case and extra spaces. filter: "all" or "low".
export function filterMaterials(entries, { query = "", filter = "all" } = {}) {
    const needle = nameKey(query);
    return entries.filter(([, material]) =>
        (!needle || nameKey(material && material.name).includes(needle))
        && (filter !== "low" || isLow(material)));
}

// When the material last changed: the server time, else the date typed before Phase 3 (older records).
export function updatedAtOf(material) {
    if (material && typeof material.updatedAt === "number") {
        return material.updatedAt;
    }
    const typed = material && typeof material.lastUpdated === "string" ? Date.parse(material.lastUpdated) : NaN;
    return Number.isFinite(typed) ? typed : 0;
}

// A new array. "added" keeps the database order. Ties fall back to the name, so the order is stable.
export function sortMaterials(entries, sort = DEFAULT_SORT) {
    const byName = ([, a], [, b]) => nameKey(a && a.name).localeCompare(nameKey(b && b.name));
    const list = [...entries];
    switch (sort) {
        case "name":
            return list.sort(byName);
        case "quantity":
            return list.sort((a, b) => (stockOf(a[1]) - stockOf(b[1])) || byName(a, b));
        case "updated":
            return list.sort((a, b) => (updatedAtOf(b[1]) - updatedAtOf(a[1])) || byName(a, b));
        default:
            return list;
    }
}

// Search, filter, then sort: what the table shows.
export function visibleMaterials(materials, { query = "", filter = "all", sort = DEFAULT_SORT } = {}) {
    return sortMaterials(filterMaterials(Object.entries(materials || {}), { query, filter }), sort);
}

// The newest sign of life on a site: the latest movement, or the latest change to any material
// (a delete leaves no material behind, but it leaves its movement).
export function lastActivityAt({ materials = {}, lastMovementAt = 0 } = {}) {
    const latestChange = Object.values(materials || {}).reduce((latest, material) => Math.max(latest, updatedAtOf(material)), 0);
    return Math.max(latestChange, typeof lastMovementAt === "number" ? lastMovementAt : 0);
}

export function summarizeSite({ materials = {}, lastMovementAt = 0 } = {}) {
    const entries = Object.entries(materials || {}).filter(([, material]) => material && typeof material === "object");
    const lowEntries = entries.filter(([, material]) => isLow(material));
    return {
        total: entries.length,
        low: lowEntries.length,
        lowEntries,
        lastActivity: lastActivityAt({ materials, lastMovementAt }) || null,
    };
}

const DAY = 86_400_000;

// "5 min ago", "2h ago", "3 days ago", then "3 weeks ago", "5 months ago", "2 years ago": a stale site reads
// as stale, not as a bare date next to "2h ago". `now` is a parameter for tests.
export function ageLabel(at, now = Date.now()) {
    const age = now - at;
    if (!Number.isFinite(age) || age < 7 * DAY) {
        return timeAgo(at, now);
    }
    const days = Math.floor(age / DAY);
    if (days < 60) {
        const weeks = Math.floor(days / 7);
        return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
    }
    if (days < 365) {
        return `${Math.floor(days / 30)} months ago`;
    }
    const years = Math.floor(days / 365);
    return years === 1 ? "1 year ago" : `${years} years ago`;
}

// More than a month without a sign of life.
export const isStale = (at, now = Date.now()) => Number.isFinite(at) && now - at > 30 * DAY;

// The three phrases of the site summary header, the same wording on the dashboard and the overview.
export function summaryText(summary, now = Date.now()) {
    return {
        total: summary.total === 0 ? "No materials yet" : `${summary.total} ${summary.total === 1 ? "material" : "materials"}`,
        low: summary.low === 0 ? "Nothing low on stock" : `${summary.low} low on stock`,
        activity: summary.lastActivity ? `Last activity ${ageLabel(summary.lastActivity, now)}` : "No activity yet",
    };
}

// One line per site for the owner overview. `site` is the site record with its role.
export function overviewRow({ siteId, site, materials, lastMovementAt }) {
    const summary = summarizeSite({ materials, lastMovementAt });
    return {
        siteId,
        name: String((site && site.name) ?? "").trim() || "(unnamed site)",
        location: (site && site.location) || "",
        ...summary,
        lowItems: summary.lowEntries
            .map(([id, material]) => ({ id, name: material.name, label: lowLabel(material), detail: lowDetail(material), quantity: stockOf(material) }))
            .sort((a, b) => (a.quantity - b.quantity) || String(a.name).localeCompare(String(b.name))),
    };
}

// Sites with the most trouble first, then by most recent activity, then by name.
export function sortOverview(rows) {
    return [...rows].sort((a, b) =>
        (b.low - a.low)
        || ((b.lastActivity || 0) - (a.lastActivity || 0))
        || a.name.localeCompare(b.name));
}

export function overviewTotals(rows) {
    const low = rows.reduce((sum, row) => sum + row.low, 0);
    const sites = rows.length;
    return {
        sites,
        low,
        text: `${sites} ${sites === 1 ? "site" : "sites"}, ${low === 0 ? "nothing low on stock" : `${low} low on stock`}`,
    };
}

// How many materials the "Low stock" filter chip should say it holds.
export function lowCount(materials) {
    return Object.values(materials || {}).filter(isLow).length;
}
