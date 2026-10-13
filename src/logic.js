// Pure helpers for the dashboard. No DOM, no Firebase, so they run in Node tests.

export const NO_SITE_MESSAGE = "Select a site first";
export const REQUIRED_MESSAGE = "Please fill in all required fields";
export const QUANTITY_MESSAGE = "Quantity must be a number, zero or more";
export const BUILDING_TYPE_MESSAGE = "Choose a building type from the list";
export const UNITS_MESSAGE = "Choose a unit from the list";

// The dropdown options. Stored values are exactly these strings.
export const BUILDING_TYPES = ["Residential", "Commercial", "Industrial", "Road/Civil", "Other"];
export const UNITS = ["kg", "tonnes", "bags", "pieces", "metres", "litres", "bundles", "sheets"];

// Returns a finite number >= 0, or null. Empty strings are rejected on purpose:
// Number("") is 0, which would silently record a blank field as zero stock.
export function parseQuantity(raw) {
    if (typeof raw === "number") {
        return Number.isFinite(raw) && raw >= 0 ? raw : null;
    }
    if (typeof raw !== "string" || raw.trim() === "") {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function clean(raw) {
    return typeof raw === "string" ? raw.trim() : "";
}

// "  cement   mix " -> "cement mix". Inner runs of whitespace collapse to one space.
export function normalizeName(raw) {
    return clean(raw).replace(/\s+/g, " ");
}

// Two names that differ only in case or spacing share a key.
export function nameKey(raw) {
    return normalizeName(raw).toLowerCase();
}

// Reuse the spelling already in the list, so "cement" typed next to "Cement" is
// stored as "Cement" and does not become a second material.
export function canonicalName(raw, knownNames = []) {
    const name = normalizeName(raw);
    const key = name.toLowerCase();
    const match = knownNames.find((known) => nameKey(known) === key);
    return match ? normalizeName(match) : name;
}

// One entry per name key, first spelling wins, sorted for the autocomplete list.
export function suggestNames(names) {
    const seen = new Map();
    for (const raw of names) {
        const name = normalizeName(raw);
        if (name && !seen.has(name.toLowerCase())) {
            seen.set(name.toLowerCase(), name);
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// Local calendar date as YYYY-MM-DD, for the date input default. Not toISOString():
// that is UTC and would show yesterday on a site east of Greenwich after midnight.
export function todayISO(now = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// What the user must type to delete a site: its name, or "delete" when the name is blank.
export function deletePhrase(site) {
    return normalizeName(site && site.name) || "delete";
}

export function phraseMatches(typed, phrase) {
    return normalizeName(typed) === phrase;
}

// createdAt is stamped here, not typed: `now` is a parameter so tests can fix it.
export function validateSite(input, now = Date.now()) {
    const value = {
        name: normalizeName(input.name),
        location: normalizeName(input.location),
        buildingType: clean(input.buildingType),
        createdAt: now,
    };
    if (!value.name || !value.location || !value.buildingType) {
        return { ok: false, error: REQUIRED_MESSAGE };
    }
    if (!BUILDING_TYPES.includes(value.buildingType)) {
        return { ok: false, error: BUILDING_TYPE_MESSAGE };
    }
    return { ok: true, value };
}

// siteId may be null: the caller has not selected a site yet. That is a different
// problem from an empty field, so it gets its own message. The material itself carries no
// siteId: it is stored under /materials/<siteId>/, and the database rules refuse the field.
// options.knownNames: names already on the site, to reuse their spelling.
// options.legacyUnit: a unit the material already has that is not in the dropdown
// (records from before the dropdown), so editing it does not force a change.
export function validateMaterial(input, siteId, options = {}) {
    if (!siteId) {
        return { ok: false, error: NO_SITE_MESSAGE };
    }
    const name = canonicalName(input.name, options.knownNames);
    const units = clean(input.units);
    const lastUpdated = clean(input.lastUpdated);
    if (!name || !units || !lastUpdated) {
        return { ok: false, error: REQUIRED_MESSAGE };
    }
    if (!UNITS.includes(units) && units !== options.legacyUnit) {
        return { ok: false, error: UNITS_MESSAGE };
    }
    const quantity = parseQuantity(input.quantity);
    if (quantity === null) {
        return { ok: false, error: QUANTITY_MESSAGE };
    }
    return { ok: true, value: { name, quantity, units, lastUpdated } };
}

// Same checks as validateMaterial, for a material that already lives in a site.
export function validateMaterialEdit(input, options = {}) {
    return validateMaterial(input, "edit", options);
}

// One multi-path update that removes a site and everything that hangs off it: its materials,
// its members, each member's entry in their own site list, the member info, and every pending
// invite (both copies). Applied with a single update(), so it all happens or none of it does,
// and the rules only accept it as a whole: the memberships must go in the same update as the site.
//   memberUids: every uid in members/<siteId>
//   inviteKeys: every email key in siteInvites/<siteId>
export function buildSiteDeleteUpdates(siteId, memberUids = [], inviteKeys = []) {
    const updates = {
        [`sites/${siteId}`]: null,
        [`materials/${siteId}`]: null,
        [`memberInfo/${siteId}`]: null,
        [`siteInvites/${siteId}`]: null,
    };
    for (const uid of memberUids) {
        updates[`members/${siteId}/${uid}`] = null;
        updates[`userSites/${uid}/${siteId}`] = null;
    }
    for (const key of inviteKeys) {
        updates[`userInvites/${key}/${siteId}`] = null;
    }
    return updates;
}
