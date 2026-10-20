// Phase 6: reports people can send. Pure: no DOM, no Firebase, so what goes into a file or a message
// is decided here, in Node tests, and is the same on every device.
//
// CSV that opens in Excel without cleanup:
//   - a byte order mark first, so Excel reads the file as UTF-8 and names like "Ø16 bar" survive;
//   - comma separated, CRLF line ends, a cell quoted when it holds a comma, a quote or a line break;
//   - numbers written bare ("12.5", "-5"), never as text, so a column sums;
//   - dates as YYYY-MM-DD and times as HH:MM:SS in their own columns, which Excel reads as dates and times;
//   - text that starts with = + - @ gets a leading apostrophe, so a material called "=1+1" can never run as a formula.
import { nameKey } from "./logic.js";
import { stockState, lowDetail } from "./insights.js";
import { formatQuantity, formatDate, lastUpdatedLabel, TYPE_LABELS, sortMovements } from "./movements.js";

export const BOM = "﻿";
export const CSV_TYPE = "text/csv;charset=utf-8";
const EOL = "\r\n";

export const STOCK_COLUMNS = ["Site", "Material", "In stock", "Units", "Low-stock level", "Status", "Last updated"];
export const MOVEMENT_COLUMNS = ["Date", "Time", "Site", "Material", "Type", "Change", "Units", "By", "Note"];

const FORMULA_START = /^[=+\-@\t\r]/;

// One cell. A number is written as a number, anything else as text.
export function csvCell(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "number") {
        const written = formatQuantity(value);
        return written === "-0" ? "0" : written; // a tiny negative rounds to -0, which Excel shows as text
    }
    let text = String(value);
    if (FORMULA_START.test(text)) {
        text = `'${text}`;
    }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Rows (arrays of cells) to the text of a file, with the byte order mark and a closing line end.
export function toCsv(rows) {
    return BOM + rows.map((row) => row.map(csvCell).join(",")).join(EOL) + EOL;
}

const siteNameOf = (site) => String((site && site.name) ?? "").trim() || "(unnamed site)";

const STATUS = { ok: "OK", low: "Low", out: "Out" };

// Current stock of one site: one line per material, by name.
export function stockCsv({ site, materials }) {
    const entries = Object.values(materials || {}).filter((material) => material && typeof material === "object");
    entries.sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
    const siteName = siteNameOf(site);
    return toCsv([
        STOCK_COLUMNS,
        ...entries.map((material) => [
            siteName,
            material.name,
            typeof material.quantity === "number" ? material.quantity : 0,
            material.units || "",
            typeof material.minLevel === "number" ? material.minLevel : "",
            STATUS[stockState(material)],
            lastUpdatedLabel(material),
        ]),
    ]);
}

const pad = (n) => String(n).padStart(2, "0");

export function formatTime(at) {
    const date = new Date(at);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// The movements of one site, oldest first. `members` is { uid: { email } } for movements that
// carry no email of their own.
export function movementsCsv({ site, movements, members = {} }) {
    const siteName = siteNameOf(site);
    return toCsv([
        MOVEMENT_COLUMNS,
        ...sortMovements(movements || []).map((movement) => [
            formatDate(movement.at),
            formatTime(movement.at),
            siteName,
            movement.materialName,
            TYPE_LABELS[movement.type] || movement.type || "",
            typeof movement.delta === "number" ? movement.delta : 0,
            movement.units || "",
            movement.byEmail || (members[movement.byUid] && members[movement.byUid].email) || "",
            movement.note || "",
        ]),
    ]);
}

// ---- date range -------------------------------------------------------------------------

export const RANGE_MESSAGES = {
    missing: "Choose a start and an end date",
    backwards: "The start date is after the end date",
};

const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

// "2026-10-21" to the start of that day in the viewer's time zone, or null when it is not a real date.
function startOfDay(text) {
    const match = DATE_FORMAT.exec(text || "");
    if (!match) {
        return null;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

// From and To are whole days, both included: { from, to } in milliseconds (to is the last
// millisecond of the end day), or { error }.
export function dayRange(fromText, toText) {
    const start = startOfDay(fromText);
    const end = startOfDay(toText);
    if (!start || !end) {
        return { error: RANGE_MESSAGES.missing };
    }
    if (start > end) {
        return { error: RANGE_MESSAGES.backwards };
    }
    const after = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    return { from: start.getTime(), to: after.getTime() - 1 };
}

// The one-tap choices above the date fields. `now` is a parameter for tests.
export const PRESETS = [
    { id: "this-month", label: "This month" },
    { id: "last-month", label: "Last month" },
    { id: "last-7", label: "Last 7 days" },
];

export function presetDates(id, now = Date.now()) {
    const today = new Date(now);
    const iso = (date) => formatDate(date.getTime());
    switch (id) {
        case "last-month":
            return {
                from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
                to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
            };
        case "last-7":
            return { from: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), to: iso(today) };
        case "this-month":
        default:
            return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    }
}

// ---- file names and the message to share ----------------------------------------------------

export function slug(text) {
    const cleaned = String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return cleaned || "site";
}

export const stockFileName = (site, now = Date.now()) => `nail-it-${slug(siteNameOf(site))}-stock-${formatDate(now)}.csv`;

export const movementsFileName = (site, fromText, toText) =>
    `nail-it-${slug(siteNameOf(site))}-movements-${fromText}_to_${toText}.csv`;

const SHARE_LINES = 40; // a WhatsApp message should be readable: past this it says how many more

// Plain text for WhatsApp or email: the site, the date, anything low first, then the rest.
export function shareText({ site, materials, now = Date.now() }) {
    const entries = Object.values(materials || {}).filter((material) => material && typeof material === "object");
    entries.sort((a, b) =>
        (Number(stockState(b) !== "ok") - Number(stockState(a) !== "ok"))
        || nameKey(a.name).localeCompare(nameKey(b.name)));
    const lines = entries.slice(0, SHARE_LINES).map((material) => {
        const quantity = typeof material.quantity === "number" ? material.quantity : 0;
        const base = `${material.name}: ${formatQuantity(quantity)}${material.units ? ` ${material.units}` : ""}`;
        const detail = lowDetail(material);
        return detail ? `${base} (${stockState(material) === "out" ? "OUT" : "LOW"}, level ${formatQuantity(material.minLevel)})` : base;
    });
    if (entries.length > SHARE_LINES) {
        lines.push(`and ${entries.length - SHARE_LINES} more`);
    }
    const low = entries.filter((material) => stockState(material) !== "ok").length;
    const head = `${siteNameOf(site)}: stock on ${formatDate(now)}`;
    const summary = entries.length === 0
        ? "No materials yet"
        : `${entries.length} ${entries.length === 1 ? "material" : "materials"}, ${low === 0 ? "nothing low" : `${low} low`}`;
    return [head, summary, "", ...lines].join("\n").trimEnd();
}

// What the print view says under the site name: when it was printed and what the table is narrowed to.
export function printNote({ now = Date.now(), query = "", filter = "all" } = {}) {
    const narrowed = [];
    if (String(query).trim()) {
        narrowed.push(`matching "${String(query).trim()}"`);
    }
    if (filter === "low") {
        narrowed.push("low stock only");
    }
    return `Printed ${formatDate(now)}${narrowed.length ? `, showing ${narrowed.join(", ")}` : ""}`;
}
