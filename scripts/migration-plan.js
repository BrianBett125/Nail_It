// Plans the one-time move from the old flat layout to the Phase 2 layout. Pure: it reads a
// snapshot of the database and returns the writes, so it runs in Node tests with no Firebase.
//
// Old layout:
//   /sites/<siteId>          { name, location, buildingType, date }
//   /materials/<materialId>  { name, quantity, units, lastUpdated, siteId }
// New layout (see src/data.js):
//   /sites/<siteId>                    { name, location, buildingType, createdAt, ownerUid }
//   /members/<siteId>/<uid>            "owner"
//   /userSites/<uid>/<siteId>          "owner"
//   /memberInfo/<siteId>/<uid>         { email }
//   /materials/<siteId>/<materialId>   { name, quantity, units, lastUpdated }
//
// The plan is ADDITIVE and safe to run twice:
//   - Sites are rewritten in place (same id). The old app only reads `name`, so it keeps working.
//   - Materials are COPIED under their site. The old flat nodes are not touched, so the old app
//     keeps working until the new one is deployed, and the snapshot is not the only way back.
//   - A site that already has an ownerUid is never rewritten, and a material that already exists in
//     its new place is never overwritten, so a second run cannot undo an edit made in the new app.
//   - Nothing that cannot be migrated cleanly is guessed at. It is left where it is and listed.
import { normalizeName, parseQuantity, BUILDING_TYPES, todayISO } from "../src/logic.js";

const MAX = { siteName: 100, location: 120, materialName: 100, units: 20, quantity: 1000000000 };
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isLegacyMaterial = (value) => isObject(value) && typeof value.siteId === "string" && value.siteId !== "";

// A node under /materials that is a per-site container written by the new app: every child is a material.
function isSiteContainer(value) {
    if (!isObject(value) || "siteId" in value) {
        return false;
    }
    const children = Object.values(value);
    return children.length > 0 && children.every(isObject);
}

function validCalendarDate(text) {
    if (!DATE_FORMAT.test(text)) {
        return false;
    }
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// Only a real ISO date ("2024-05-25", or "2024-05-25T10:00:00") counts. "03/05/2024" could be the
// 3rd of May or the 5th of March, and a migration must not guess: it is reported and replaced.
function parseIsoDate(raw) {
    if (typeof raw !== "string") {
        return null;
    }
    const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(raw.trim());
    return match && validCalendarDate(match[1]) ? match[1] : null;
}

function repairSite(site, now) {
    const changes = [];
    const note = (field, before, after, why) => changes.push({ field, before, after, why });

    let name = normalizeName(site.name).slice(0, MAX.siteName);
    if (!name) {
        name = "(unnamed site)";
        note("name", site.name, name, "was empty");
    } else if (name !== site.name) {
        note("name", site.name, name, "trimmed or shortened");
    }

    let location = normalizeName(site.location).slice(0, MAX.location);
    if (!location) {
        location = "Unknown";
        note("location", site.location, location, "was empty");
    } else if (location !== site.location) {
        note("location", site.location, location, "trimmed or shortened");
    }

    const typed = normalizeName(site.buildingType);
    const known = BUILDING_TYPES.find((type) => type.toLowerCase() === typed.toLowerCase());
    const buildingType = known || "Other";
    if (buildingType !== site.buildingType) {
        note("buildingType", site.buildingType, buildingType, known ? "fixed the capital letters" : "not in the new list");
    }

    // Sites made since Phase 1 already carry createdAt (and no date): keep it. Older ones have a date.
    const isoDate = parseIsoDate(site.date);
    const hasCreatedAt = typeof site.createdAt === "number" && Number.isFinite(site.createdAt) && site.createdAt > 0;
    const createdAt = hasCreatedAt ? site.createdAt : isoDate ? Date.parse(`${isoDate}T00:00:00Z`) : now;
    if (!hasCreatedAt) {
        note("createdAt", site.date, createdAt, isoDate ? "from the old date" : "no usable date, set to the migration time");
    }

    if ("date" in site) {
        note("date", site.date, undefined, "replaced by createdAt");
    }
    return { value: { name, location, buildingType, createdAt }, changes };
}

// Returns { value } or { skip: reason }. Stock numbers are never altered silently: text that is
// plainly a number is converted, anything else is left alone and listed.
function repairMaterial(material, now) {
    const changes = [];
    const name = normalizeName(material.name).slice(0, MAX.materialName);
    if (!name) {
        return { skip: "the material has no name" };
    }
    const quantity = parseQuantity(material.quantity);
    if (quantity === null || quantity > MAX.quantity) {
        return { skip: `the quantity is not a number from 0 to ${MAX.quantity} (${JSON.stringify(material.quantity)})` };
    }
    if (typeof material.quantity !== "number") {
        changes.push({ field: "quantity", before: material.quantity, after: quantity, why: "text converted to a number" });
    }
    const units = normalizeName(material.units);
    if (!units || units.length > MAX.units) {
        return { skip: `the units are empty or longer than ${MAX.units} characters (${JSON.stringify(material.units)})` };
    }
    let lastUpdated = typeof material.lastUpdated === "string" ? material.lastUpdated.trim() : "";
    if (!validCalendarDate(lastUpdated)) {
        const isoDate = parseIsoDate(lastUpdated);
        const repaired = isoDate || todayISO(new Date(now));
        changes.push({ field: "lastUpdated", before: material.lastUpdated, after: repaired, why: isoDate ? "time of day removed" : "no usable date, set to the migration day" });
        lastUpdated = repaired;
    }
    return { value: { name, quantity, units, lastUpdated }, changes };
}

// legacy: { sites, materials } exactly as read from the database (either may be null).
// owner: { uid, email } of the account that will own every site.
export function planMigration(legacy, { ownerUid, ownerEmail, now = Date.now() }) {
    if (!ownerUid || !ownerEmail) {
        throw new Error("planMigration needs the owner's uid and email");
    }
    const sites = isObject(legacy.sites) ? legacy.sites : {};
    const materialsRoot = isObject(legacy.materials) ? legacy.materials : {};
    const updates = {};
    const report = { sites: [], materials: [], skipped: [] };
    const takenSites = new Set();   // sites owned by somebody else: hands off, with their materials

    for (const [siteId, site] of Object.entries(sites)) {
        if (!isObject(site)) {
            report.skipped.push({ path: `sites/${siteId}`, reason: "not a site record" });
            continue;
        }
        if (site.ownerUid && site.ownerUid !== ownerUid) {
            takenSites.add(siteId);
            report.sites.push({ id: siteId, name: site.name, action: "skipped", reason: "already owned by another account", changes: [] });
            continue;
        }
        if (site.ownerUid === ownerUid) {
            report.sites.push({ id: siteId, name: site.name, action: "already migrated", changes: [] });
        } else {
            const { value, changes } = repairSite(site, now);
            updates[`sites/${siteId}`] = { ...value, ownerUid };
            report.sites.push({ id: siteId, name: value.name, action: "migrate", changes });
        }
        // Idempotent: the same owner entries every time.
        updates[`members/${siteId}/${ownerUid}`] = "owner";
        updates[`userSites/${ownerUid}/${siteId}`] = "owner";
        updates[`memberInfo/${siteId}/${ownerUid}`] = { email: ownerEmail };
    }

    for (const [key, value] of Object.entries(materialsRoot)) {
        if (isSiteContainer(value)) {
            continue; // already in the new layout
        }
        const path = `materials/${key}`;
        if (!isLegacyMaterial(value)) {
            report.skipped.push({ path, reason: "no siteId: junk left behind by an old bug, or not a material" });
            continue;
        }
        const siteId = value.siteId;
        if (!(siteId in sites) || !isObject(sites[siteId])) {
            report.materials.push({ id: key, siteId, name: value.name, action: "skipped", reason: "its site no longer exists", changes: [] });
            continue;
        }
        if (takenSites.has(siteId)) {
            report.materials.push({ id: key, siteId, name: value.name, action: "skipped", reason: "its site belongs to another account", changes: [] });
            continue;
        }
        if (isObject(materialsRoot[siteId]) && isObject(materialsRoot[siteId][key])) {
            report.materials.push({ id: key, siteId, name: value.name, action: "already migrated", changes: [] });
            continue;
        }
        const repaired = repairMaterial(value, now);
        if (repaired.skip) {
            report.materials.push({ id: key, siteId, name: value.name, action: "skipped", reason: repaired.skip, changes: [] });
            continue;
        }
        updates[`materials/${siteId}/${key}`] = repaired.value;
        report.materials.push({ id: key, siteId, name: repaired.value.name, action: "copy", changes: repaired.changes });
    }

    const count = (list, action) => list.filter((entry) => entry.action === action).length;
    report.counts = {
        sitesToMigrate: count(report.sites, "migrate"),
        sitesAlreadyMigrated: count(report.sites, "already migrated"),
        sitesSkipped: count(report.sites, "skipped"),
        materialsToCopy: count(report.materials, "copy"),
        materialsAlreadyMigrated: count(report.materials, "already migrated"),
        materialsSkipped: count(report.materials, "skipped"),
        junkNodes: report.skipped.length,
    };
    return { updates, report };
}

const csvCell = (value) => {
    const text = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// One row per decision, for the before/after file Brian reads and a QS can open in Excel.
export function reportCsv(report) {
    const rows = [["kind", "id", "site", "name", "action", "field", "before", "after", "why"]];
    const add = (kind, entry, extra = {}) => {
        const common = [kind, entry.id ?? entry.path, entry.siteId ?? "", entry.name ?? "", entry.action ?? "skipped"];
        if (entry.changes && entry.changes.length) {
            for (const change of entry.changes) {
                rows.push([...common, change.field, change.before, change.after, change.why]);
            }
        } else {
            rows.push([...common, "", "", "", entry.reason ?? extra.reason ?? ""]);
        }
    };
    report.sites.forEach((entry) => add("site", entry));
    report.materials.forEach((entry) => add("material", entry));
    report.skipped.forEach((entry) => add("junk", { id: entry.path, action: "skipped" }, { reason: entry.reason }));
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
