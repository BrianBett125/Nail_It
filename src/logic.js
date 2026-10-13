// Pure helpers for the dashboard. No DOM, no Firebase, so they run in Node tests.

export const NO_SITE_MESSAGE = "Select a site first";
export const REQUIRED_MESSAGE = "Please fill in all required fields";
export const QUANTITY_MESSAGE = "Quantity must be a number, zero or more";

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

export function validateSite(input) {
    const value = {
        name: clean(input.name),
        location: clean(input.location),
        buildingType: clean(input.buildingType),
        date: clean(input.date),
    };
    if (!value.name || !value.location || !value.buildingType || !value.date) {
        return { ok: false, error: REQUIRED_MESSAGE };
    }
    return { ok: true, value };
}

// siteId may be null: the caller has not selected a site yet. That is a different
// problem from an empty field, so it gets its own message.
export function validateMaterial(input, siteId) {
    if (!siteId) {
        return { ok: false, error: NO_SITE_MESSAGE };
    }
    const name = clean(input.name);
    const units = clean(input.units);
    const lastUpdated = clean(input.lastUpdated);
    if (!name || !units || !lastUpdated) {
        return { ok: false, error: REQUIRED_MESSAGE };
    }
    const quantity = parseQuantity(input.quantity);
    if (quantity === null) {
        return { ok: false, error: QUANTITY_MESSAGE };
    }
    return { ok: true, value: { name, quantity, units, lastUpdated, siteId } };
}

// Same checks as validateMaterial without the site: an edit keeps its siteId.
export function validateMaterialEdit(input) {
    const result = validateMaterial(input, "edit");
    if (!result.ok) {
        return result;
    }
    const { siteId, ...value } = result.value;
    return { ok: true, value };
}

// One multi-path update that removes a site and every material belonging to it.
// Applied with a single update(), so it either all happens or none of it does.
export function buildSiteDeleteUpdates(siteId, materials) {
    const updates = { [`sites/${siteId}`]: null };
    for (const [materialId, material] of Object.entries(materials || {})) {
        if (material && material.siteId === siteId) {
            updates[`materials/${materialId}`] = null;
        }
    }
    return updates;
}
