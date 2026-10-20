// Phase 6: what goes into a CSV file, a date range, a file name and a shared message.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BOM, csvCell, toCsv, stockCsv, movementsCsv, dayRange, presetDates, slug,
    stockFileName, movementsFileName, shareText, printNote, RANGE_MESSAGES,
} from "../../src/reports.js";

const lines = (csv) => csv.replace(BOM, "").split("\r\n");
const local = (y, m, d, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();

// ---- cells and the file ---------------------------------------------------------------

test("a cell with a comma, a quote or a line break is quoted, quotes are doubled", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell("cement, grade 42.5"), '"cement, grade 42.5"');
    assert.equal(csvCell('12" pipe'), '"12"" pipe"');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell("a\rb"), '"a\rb"');
});

test("numbers are written bare so a column sums: no float dust, no exponent, no grouping", () => {
    assert.equal(csvCell(12.5), "12.5");
    assert.equal(csvCell(-5), "-5");
    assert.equal(csvCell(0.1 + 0.2), "0.3");
    assert.equal(csvCell(1234567), "1234567");
    assert.equal(csvCell(0), "0");
    assert.equal(csvCell(-0), "0");
});

test("empty values are empty cells", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(""), "");
});

test("text that could run as a formula in Excel gets an apostrophe in front", () => {
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell("+44 700"), "'+44 700");
    assert.equal(csvCell("-2 rebar"), "'-2 rebar");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("\tcmd"), "'\tcmd");
    assert.equal(csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
    assert.equal(csvCell("Cement 42.5"), "Cement 42.5", "ordinary text is not touched");
    assert.equal(csvCell("5-inch nails"), "5-inch nails", "only a leading sign is a risk");
});

test("the file starts with a byte order mark and uses CRLF line ends, ending on one", () => {
    const csv = toCsv([["a", "b"], [1, "x"]]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv, `${BOM}a,b\r\n1,x\r\n`);
});

// ---- stock ----------------------------------------------------------------------------

const SITE = { name: "Mombasa" };
const MATERIALS = {
    m1: { name: "Sand", quantity: 10, units: "tonnes", updatedAt: local(2026, 10, 3, 9) },
    m2: { name: "cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: local(2026, 10, 20, 15) },
    m3: { name: 'Nails, 4"', quantity: 0, units: "kg", minLevel: 5, lastUpdated: "2024-05-05" },
    m4: { name: "Gravel", units: "tonnes" },
};

test("stock export: a header and one line per material, by name, with status and last updated", () => {
    assert.deepEqual(lines(stockCsv({ site: SITE, materials: MATERIALS })), [
        "Site,Material,In stock,Units,Low-stock level,Status,Last updated",
        "Mombasa,cement,5,bags,10,Low,2026-10-20",
        "Mombasa,Gravel,0,tonnes,,OK,",
        'Mombasa,"Nails, 4""",0,kg,5,Out,2024-05-05',
        "Mombasa,Sand,10,tonnes,,OK,2026-10-03",
        "",
    ]);
});

test("stock export of an empty site is just the header", () => {
    assert.deepEqual(lines(stockCsv({ site: SITE, materials: null })), ["Site,Material,In stock,Units,Low-stock level,Status,Last updated", ""]);
});

test("a site with no name still gets a label, and a hostile name is guarded", () => {
    assert.match(lines(stockCsv({ site: { name: "  " }, materials: { a: { name: "X", quantity: 1, units: "kg" } } }))[1], /^\(unnamed site\),/);
    assert.match(lines(stockCsv({ site: { name: "=evil()" }, materials: { a: { name: "@x", quantity: 1, units: "kg" } } }))[1], /^'=evil\(\),'@x,/);
});

// ---- movements --------------------------------------------------------------------------

const MOVEMENTS = [
    { id: "b", at: local(2026, 10, 5, 14, 30, 9), type: "used", delta: -20, units: "bags", materialName: "Cement", byUid: "u2", note: "Slab, level 2" },
    { id: "a", at: local(2026, 10, 1, 8, 0, 0), type: "opening", delta: 50, units: "bags", materialName: "Cement", byEmail: "sam@example.com" },
    { id: "c", at: local(2026, 10, 7, 7, 5, 0), type: "received", delta: 0.5, units: "tonnes", materialName: "Sand", byEmail: "ann@example.com" },
];

test("movements export: oldest first, date and time apart, signed change, who and why", () => {
    const csv = movementsCsv({ site: SITE, movements: MOVEMENTS, members: { u2: { email: "joy@example.com" } } });
    assert.deepEqual(lines(csv), [
        "Date,Time,Site,Material,Type,Change,Units,By,Note",
        "2026-10-01,08:00:00,Mombasa,Cement,Opening balance,50,bags,sam@example.com,",
        '2026-10-05,14:30:09,Mombasa,Cement,Used,-20,bags,joy@example.com,"Slab, level 2"',
        "2026-10-07,07:05:00,Mombasa,Sand,Received,0.5,tonnes,ann@example.com,",
        "",
    ]);
});

test("the Change column adds up to the stock change: what a QS reconciles", () => {
    const rows = lines(movementsCsv({ site: SITE, movements: MOVEMENTS })).slice(1, -1);
    const sum = rows.filter((row) => row.includes("Cement")).reduce((total, row) => total + Number(row.split(",")[5]), 0);
    assert.equal(sum, 30);
});

test("a movement with no known author or an odd type still exports", () => {
    const csv = movementsCsv({ site: SITE, movements: [{ id: "x", at: local(2026, 1, 2, 3, 4, 5), type: "mystery", delta: 1, units: "kg", materialName: "Z" }] });
    assert.equal(lines(csv)[1], "2026-01-02,03:04:05,Mombasa,Z,mystery,1,kg,,");
});

test("no movements: just the header", () => {
    assert.deepEqual(lines(movementsCsv({ site: SITE, movements: [] })), ["Date,Time,Site,Material,Type,Change,Units,By,Note", ""]);
});

// ---- date range -------------------------------------------------------------------------

test("a range covers whole days, both ends included", () => {
    const { from, to } = dayRange("2026-10-01", "2026-10-31");
    assert.equal(from, local(2026, 10, 1, 0, 0, 0));
    assert.equal(to, local(2026, 10, 31, 23, 59, 59) + 999);
    assert.ok(local(2026, 10, 31, 23, 59, 59) <= to, "a movement at 23:59:59 on the last day is in");
    assert.ok(local(2026, 11, 1) > to, "midnight after is out");
});

test("one day is a valid range", () => {
    const { from, to, error } = dayRange("2026-10-05", "2026-10-05");
    assert.equal(error, undefined);
    assert.equal(to - from, 24 * 3_600_000 - 1);
});

test("a range across a clock change is still whole local days", () => {
    const { from, to } = dayRange("2026-03-28", "2026-03-30");
    assert.equal(new Date(from).getDate(), 28);
    assert.equal(new Date(to).getDate(), 30);
    assert.equal(new Date(to + 1).getDate(), 31);
});

test("bad ranges say what is wrong", () => {
    assert.equal(dayRange("", "2026-10-31").error, RANGE_MESSAGES.missing);
    assert.equal(dayRange("2026-10-01", "").error, RANGE_MESSAGES.missing);
    assert.equal(dayRange("2026-02-30", "2026-03-01").error, RANGE_MESSAGES.missing, "not a real date");
    assert.equal(dayRange("10/01/2026", "2026-10-31").error, RANGE_MESSAGES.missing, "not the date input's format");
    assert.equal(dayRange("2026-10-31", "2026-10-01").error, RANGE_MESSAGES.backwards);
});

test("presets: this month, last month (also across New Year) and the last seven days", () => {
    const now = local(2026, 10, 21, 12);
    assert.deepEqual(presetDates("this-month", now), { from: "2026-10-01", to: "2026-10-21" });
    assert.deepEqual(presetDates("last-month", now), { from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(presetDates("last-month", local(2026, 1, 15)), { from: "2025-12-01", to: "2025-12-31" });
    assert.deepEqual(presetDates("last-7", now), { from: "2026-10-15", to: "2026-10-21" });
    assert.deepEqual(presetDates("last-month", local(2026, 3, 31)), { from: "2026-02-01", to: "2026-02-28" });
});

// ---- names ------------------------------------------------------------------------------

test("file names are safe and say what is inside", () => {
    const now = local(2026, 10, 21);
    assert.equal(slug("Mombasa Road / Phase 2"), "mombasa-road-phase-2");
    assert.equal(slug("***"), "site");
    assert.equal(slug(""), "site");
    assert.ok(slug("x".repeat(100)).length <= 40);
    assert.equal(stockFileName({ name: "Mombasa Road" }, now), "nail-it-mombasa-road-stock-2026-10-21.csv");
    assert.equal(movementsFileName({ name: "Mombasa Road" }, "2026-10-01", "2026-10-31"), "nail-it-mombasa-road-movements-2026-10-01_to_2026-10-31.csv");
    assert.equal(stockFileName(null, now), "nail-it-unnamed-site-stock-2026-10-21.csv");
});

// ---- the message to share -----------------------------------------------------------------

test("the shared summary leads with what is low", () => {
    const text = shareText({ site: SITE, materials: MATERIALS, now: local(2026, 10, 21) });
    assert.equal(text, [
        "Mombasa: stock on 2026-10-21",
        "4 materials, 2 low",
        "",
        "cement: 5 bags (LOW, level 10)",
        'Nails, 4": 0 kg (OUT, level 5)',
        "Gravel: 0 tonnes",
        "Sand: 10 tonnes",
    ].join("\n"));
});

test("the shared summary of an empty site, and of a long one", () => {
    assert.equal(shareText({ site: SITE, materials: {}, now: local(2026, 10, 21) }), "Mombasa: stock on 2026-10-21\nNo materials yet");
    const many = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`m${i}`, { name: `Item ${String(i).padStart(2, "0")}`, quantity: 1, units: "kg" }]));
    const text = shareText({ site: SITE, materials: many, now: local(2026, 10, 21) });
    assert.equal(text.split("\n").length, 3 + 40 + 1);
    assert.ok(text.endsWith("and 15 more"));
});

test("the print note says when, and what the table is narrowed to", () => {
    const now = local(2026, 10, 21);
    assert.equal(printNote({ now }), "Printed 2026-10-21");
    assert.equal(printNote({ now, filter: "low" }), "Printed 2026-10-21, showing low stock only");
    assert.equal(printNote({ now, query: " ce ", filter: "low" }), 'Printed 2026-10-21, showing matching "ce", low stock only');
});
