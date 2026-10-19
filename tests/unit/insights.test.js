import { test } from "node:test";
import assert from "node:assert/strict";
import {
    stockState,
    isLow,
    lowLabel,
    lowDetail,
    filterMaterials,
    sortMaterials,
    visibleMaterials,
    updatedAtOf,
    lastActivityAt,
    summarizeSite,
    summaryText,
    overviewRow,
    sortOverview,
    overviewTotals,
    lowCount,
    ageLabel,
    isStale,
    SORTS,
    DEFAULT_SORT,
} from "../../src/insights.js";

const T = 2_000_000_000_000; // a real-looking server time, later than any typed legacy date
const M = (name, quantity, extra = {}) => ({ name, quantity, units: "bags", ...extra });

// ---- what is low ----------------------------------------------------------------------

test("a material is low when the stock is at or below its level", () => {
    assert.equal(stockState(M("Cement", 10, { minLevel: 10 })), "low", "at the level counts");
    assert.equal(stockState(M("Cement", 3, { minLevel: 10 })), "low");
    assert.equal(stockState(M("Cement", 11, { minLevel: 10 })), "ok");
});

test("zero stock with a level is 'out', and the level 0 flags only an empty shelf", () => {
    assert.equal(stockState(M("Sand", 0, { minLevel: 5 })), "out");
    assert.equal(stockState(M("Sand", 0, { minLevel: 0 })), "out");
    assert.equal(stockState(M("Sand", 1, { minLevel: 0 })), "ok");
});

test("without a level nothing is flagged, even at zero: the level is how a material is watched", () => {
    assert.equal(stockState(M("Sand", 0)), "ok");
    assert.equal(stockState(M("Sand", 0, { minLevel: undefined })), "ok");
    assert.equal(stockState(M("Sand", 0, { minLevel: null })), "ok");
    assert.equal(stockState(M("Sand", 0, { minLevel: "5" })), "ok", "a text level is not a level");
});

test("odd records do not throw", () => {
    assert.equal(stockState(undefined), "ok");
    assert.equal(stockState(null), "ok");
    assert.equal(stockState({}), "ok");
    assert.equal(stockState({ minLevel: 5 }), "out", "a missing quantity is zero");
    assert.equal(isLow({ minLevel: 5, quantity: "3" }), true, "a text quantity counts as zero, not as 3");
});

test("one of a unit reads singular: '1 piece left', not '1 pieces left'", () => {
    assert.equal(lowDetail(M("Rebar", 1, { minLevel: 5, units: "pieces" })), "1 piece left, level 5");
    assert.equal(lowDetail(M("Glue", 1, { minLevel: 5, units: "litres" })), "1 litre left, level 5");
    assert.equal(lowDetail(M("Nails", 1, { minLevel: 5, units: "kg" })), "1 kg left, level 5");
    assert.equal(lowDetail(M("Nails", 1, { minLevel: 5, units: "kgs" })), "1 kgs left, level 5", "an old free-text unit is left alone");
    assert.equal(lowDetail(M("Sand", 1.5, { minLevel: 5, units: "tonnes" })), "1.5 tonnes left, level 5");
    assert.equal(lowDetail(M("Sand", 0, { minLevel: 5, units: "tonnes" })), "0 tonnes left, level 5");
});

test("the badge is a word and the detail says how much is left", () => {
    assert.equal(lowLabel(M("Cement", 3, { minLevel: 10 })), "Low");
    assert.equal(lowLabel(M("Cement", 0, { minLevel: 10 })), "Out");
    assert.equal(lowLabel(M("Cement", 30, { minLevel: 10 })), "");
    assert.equal(lowDetail(M("Cement", 3, { minLevel: 10 })), "3 bags left, level 10");
    assert.equal(lowDetail(M("Cement", 2.5, { minLevel: 10, units: "tonnes" })), "2.5 tonnes left, level 10");
    assert.equal(lowDetail(M("Cement", 30, { minLevel: 10 })), "");
});

// ---- search, filter, sort -------------------------------------------------------------

const ENTRIES = [
    ["a", M("Cement", 3, { minLevel: 10, updatedAt: T + 300 })],
    ["b", M("sand", 40, { updatedAt: T + 100 })],
    ["c", M("Nails", 0, { minLevel: 1, updatedAt: T + 200 })],
    ["d", M("Cement mix", 50, { minLevel: 10, lastUpdated: "2024-05-04" })],
];
const ids = (list) => list.map(([id]) => id);

test("search matches the name anywhere in it, ignoring case and extra spaces", () => {
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "cem" })), ["a", "d"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "  CEMENT   mix " })), ["d"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "AND" })), ["b"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "zzz" })), []);
});

test("an empty or blank search shows everything", () => {
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "" })), ["a", "b", "c", "d"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "   " })), ["a", "b", "c", "d"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES)), ["a", "b", "c", "d"]);
});

test("search treats regex characters as text and does not match units", () => {
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: ".*" })), []);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { query: "bags" })), []);
    assert.deepEqual(ids(filterMaterials([["x", M("C++ (2x4)", 1)]], { query: "(2x4)" })), ["x"]);
});

test("the Low filter keeps only low and out materials, and combines with search", () => {
    assert.deepEqual(ids(filterMaterials(ENTRIES, { filter: "low" })), ["a", "c"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { filter: "low", query: "cem" })), ["a"]);
    assert.deepEqual(ids(filterMaterials(ENTRIES, { filter: "all", query: "cem" })), ["a", "d"]);
});

test("a record with no name is never a match, and never throws", () => {
    assert.deepEqual(ids(filterMaterials([["x", { quantity: 1 }]], { query: "a" })), []);
    assert.deepEqual(ids(filterMaterials([["x", { quantity: 1 }]], { query: "" })), ["x"]);
});

test("sort 'added' keeps the database order; other sorts return a new array", () => {
    assert.equal(DEFAULT_SORT, "added");
    assert.deepEqual(ids(sortMaterials(ENTRIES, "added")), ["a", "b", "c", "d"]);
    assert.deepEqual(ids(sortMaterials(ENTRIES, "nonsense")), ["a", "b", "c", "d"]);
    const copy = [...ENTRIES];
    sortMaterials(ENTRIES, "name");
    assert.deepEqual(ENTRIES, copy, "the input is not reordered");
});

test("sort by name ignores case", () => {
    assert.deepEqual(ids(sortMaterials(ENTRIES, "name")), ["a", "d", "c", "b"]);
});

test("sort by stock puts the lowest first, ties by name", () => {
    assert.deepEqual(ids(sortMaterials(ENTRIES, "quantity")), ["c", "a", "b", "d"]);
    const tied = [["x", M("b", 5)], ["y", M("a", 5)]];
    assert.deepEqual(ids(sortMaterials(tied, "quantity")), ["y", "x"]);
});

test("sort by updated puts the newest first, falls back to the typed date, and old records last", () => {
    assert.deepEqual(ids(sortMaterials(ENTRIES, "updated")), ["a", "c", "b", "d"]);
    assert.equal(updatedAtOf(M("x", 1, { lastUpdated: "2024-05-04" })), Date.parse("2024-05-04"));
    assert.equal(updatedAtOf(M("x", 1, { updatedAt: 5, lastUpdated: "2024-05-04" })), 5, "the server time wins");
    assert.equal(updatedAtOf(M("x", 1)), 0);
    assert.equal(updatedAtOf(M("x", 1, { lastUpdated: "garbage" })), 0);
    assert.equal(updatedAtOf(undefined), 0);
});

test("visibleMaterials is search, then filter, then sort, over the database object", () => {
    const materials = Object.fromEntries(ENTRIES);
    assert.deepEqual(ids(visibleMaterials(materials, { query: "cem", filter: "low", sort: "name" })), ["a"]);
    assert.deepEqual(ids(visibleMaterials(materials, { sort: "quantity" })), ["c", "a", "b", "d"]);
    assert.deepEqual(visibleMaterials(null), []);
    assert.deepEqual(visibleMaterials({}, { query: "x" }), []);
});

test("the sort list has the four ids the page offers", () => {
    assert.deepEqual(SORTS.map((s) => s.id), ["added", "name", "quantity", "updated"]);
    assert.ok(SORTS.every((s) => s.label));
});

// ---- the site summary -----------------------------------------------------------------

test("summarizeSite counts materials and low ones, and finds the last activity", () => {
    const summary = summarizeSite({ materials: Object.fromEntries(ENTRIES), lastMovementAt: T + 250 });
    assert.equal(summary.total, 4);
    assert.equal(summary.low, 2);
    assert.deepEqual(summary.lowEntries.map(([id]) => id), ["a", "c"]);
    assert.equal(summary.lastActivity, T + 300);
});

test("last activity is the newest of the latest movement and every material's update", () => {
    assert.equal(lastActivityAt({ materials: { a: M("a", 1, { updatedAt: T + 100 }) }, lastMovementAt: T + 500 }), T + 500);
    assert.equal(lastActivityAt({ materials: { a: M("a", 1, { updatedAt: T + 900 }) }, lastMovementAt: T + 500 }), T + 900);
    assert.equal(lastActivityAt({ materials: {}, lastMovementAt: 0 }), 0);
    assert.equal(lastActivityAt({}), 0);
    assert.equal(lastActivityAt({ materials: null, lastMovementAt: "x" }), 0);
});

test("an empty or missing site summarises to nothing, without throwing", () => {
    for (const input of [undefined, {}, { materials: null }, { materials: {} }]) {
        const summary = summarizeSite(input);
        assert.deepEqual([summary.total, summary.low, summary.lastActivity], [0, 0, null]);
    }
    assert.equal(summarizeSite({ materials: { x: null, y: "junk", z: M("z", 1) } }).total, 1, "junk entries are not materials");
});

test("summaryText: the three phrases, singular and plural", () => {
    const now = 1_000_000_000;
    assert.deepEqual(summaryText({ total: 6, low: 2, lastActivity: now - 2 * 3_600_000 }, now), {
        total: "6 materials", low: "2 low on stock", activity: "Last activity 2h ago",
    });
    assert.deepEqual(summaryText({ total: 1, low: 0, lastActivity: null }, now), {
        total: "1 material", low: "Nothing low on stock", activity: "No activity yet",
    });
    assert.equal(summaryText({ total: 0, low: 0, lastActivity: null }, now).total, "No materials yet");
});

test("lowCount counts what the Low chip will show", () => {
    assert.equal(lowCount(Object.fromEntries(ENTRIES)), 2);
    assert.equal(lowCount({}), 0);
    assert.equal(lowCount(null), 0);
});

// ---- the owner overview ---------------------------------------------------------------

const siteRow = (siteId, name, materials, lastMovementAt = 0) =>
    overviewRow({ siteId, site: { name, location: "Nyali" }, materials, lastMovementAt });

test("overviewRow carries the counts, the activity and the low items, emptiest first", () => {
    const row = siteRow("s1", "Mombasa", Object.fromEntries(ENTRIES), T + 250);
    assert.equal(row.name, "Mombasa");
    assert.equal(row.location, "Nyali");
    assert.equal(row.total, 4);
    assert.equal(row.low, 2);
    assert.deepEqual(row.lowItems.map((i) => [i.name, i.label, i.detail]), [
        ["Nails", "Out", "0 bags left, level 1"],
        ["Cement", "Low", "3 bags left, level 10"],
    ]);
});

test("overviewRow gives a nameless site a label", () => {
    assert.equal(overviewRow({ siteId: "s", site: { name: "   " }, materials: {} }).name, "(unnamed site)");
    assert.equal(overviewRow({ siteId: "s", site: undefined, materials: undefined }).name, "(unnamed site)");
});

test("sortOverview: most low first, then most recent activity, then name; input untouched", () => {
    const rows = [
        siteRow("a", "Alpha", { x: M("x", 9) }, 100),
        siteRow("b", "Beta", { x: M("x", 1, { minLevel: 5 }) }, 50),
        siteRow("c", "Gamma", { x: M("x", 9) }, 900),
        siteRow("d", "Delta", { x: M("x", 9) }, 900),
        siteRow("e", "Epsilon", { x: M("x", 0, { minLevel: 5 }), y: M("y", 0, { minLevel: 5 }) }, 10),
    ];
    const copy = [...rows];
    assert.deepEqual(sortOverview(rows).map((r) => r.name), ["Epsilon", "Beta", "Delta", "Gamma", "Alpha"]);
    assert.deepEqual(rows, copy);
});

test("overviewTotals: how many sites and how much is low across all of them", () => {
    const rows = [siteRow("a", "A", { x: M("x", 1, { minLevel: 5 }) }), siteRow("b", "B", { x: M("x", 9) })];
    assert.deepEqual(overviewTotals(rows), { sites: 2, low: 1, text: "2 sites, 1 low on stock" });
    assert.equal(overviewTotals([rows[1]]).text, "1 site, nothing low on stock");
    assert.equal(overviewTotals([]).text, "0 sites, nothing low on stock");
});

// ---- honest ages ----------------------------------------------------------------------

test("ageLabel keeps the short words for a week, then says weeks, months and years", () => {
    const now = 1_800_000_000_000;
    const DAY = 86_400_000;
    const ago = (ms) => ageLabel(now - ms, now);
    assert.equal(ago(5 * 60_000), "5 min ago");
    assert.equal(ago(3 * DAY), "3 days ago");
    assert.equal(ago(6 * DAY + 3_600_000), "6 days ago");
    assert.equal(ago(7 * DAY), "1 week ago", "singular");
    assert.equal(ago(21 * DAY), "3 weeks ago");
    assert.equal(ago(59 * DAY), "8 weeks ago");
    assert.equal(ago(90 * DAY), "3 months ago");
    assert.equal(ago(364 * DAY), "12 months ago");
    assert.equal(ago(365 * DAY), "1 year ago");
    assert.equal(ago(800 * DAY), "2 years ago");
    assert.equal(ageLabel(undefined, now), "just now");
});

test("isStale is more than a month, and false for nothing", () => {
    const now = 1_800_000_000_000;
    assert.equal(isStale(now - 31 * 86_400_000, now), true);
    assert.equal(isStale(now - 29 * 86_400_000, now), false);
    assert.equal(isStale(null, now), false);
    assert.equal(isStale(undefined, now), false);
});

test("summaryText says how stale a site is, not a bare date", () => {
    const now = 1_800_000_000_000;
    assert.equal(summaryText({ total: 1, low: 0, lastActivity: now - 800 * 86_400_000 }, now).activity, "Last activity 2 years ago");
});
