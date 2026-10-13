import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseQuantity,
    validateSite,
    validateMaterial,
    validateMaterialEdit,
    buildSiteDeleteUpdates,
    NO_SITE_MESSAGE,
    REQUIRED_MESSAGE,
    QUANTITY_MESSAGE,
} from "../../src/logic.js";

test("parseQuantity accepts zero and positive numbers as numbers (B8)", () => {
    assert.equal(parseQuantity("0"), 0);
    assert.equal(parseQuantity("12"), 12);
    assert.equal(parseQuantity("2.5"), 2.5);
    assert.equal(parseQuantity(" 7 "), 7);
    assert.equal(parseQuantity(3), 3);
    assert.equal(typeof parseQuantity("12"), "number");
});

test("parseQuantity rejects empty, negative, NaN and infinite input (B8)", () => {
    for (const bad of ["", "   ", "-1", "-0.5", "abc", "1,5", "Infinity", "-Infinity", "NaN", null, undefined, NaN, Infinity, -2, {}, []]) {
        assert.equal(parseQuantity(bad), null, `should reject ${String(bad)}`);
    }
});

test("validateSite trims and requires every field", () => {
    const ok = validateSite({ name: "  Mombasa ", location: "Nyali", buildingType: "Residential", date: "2024-05-25" });
    assert.deepEqual(ok, {
        ok: true,
        value: { name: "Mombasa", location: "Nyali", buildingType: "Residential", date: "2024-05-25" },
    });
    for (const field of ["name", "location", "buildingType", "date"]) {
        const input = { name: "a", location: "b", buildingType: "c", date: "2024-01-01", [field]: "   " };
        assert.deepEqual(validateSite(input), { ok: false, error: REQUIRED_MESSAGE }, `blank ${field}`);
    }
});

test("validateSite keeps markup as text, it never interprets it (S2)", () => {
    const name = "<img src=x onerror=alert(1)>";
    const result = validateSite({ name, location: "l", buildingType: "t", date: "2024-01-01" });
    assert.equal(result.value.name, name);
});

test("validateMaterial without a selected site says so, not 'fill all fields' (B9)", () => {
    const filled = { name: "Cement", quantity: "5", units: "bags", lastUpdated: "2024-05-25" };
    assert.deepEqual(validateMaterial(filled, null), { ok: false, error: NO_SITE_MESSAGE });
    assert.deepEqual(validateMaterial(filled, ""), { ok: false, error: NO_SITE_MESSAGE });
    assert.deepEqual(validateMaterial(filled, undefined), { ok: false, error: NO_SITE_MESSAGE });
});

test("validateMaterial stores quantity as a number and tags the site (B8)", () => {
    const result = validateMaterial({ name: " Cement ", quantity: "5", units: "bags", lastUpdated: "2024-05-25" }, "site1");
    assert.deepEqual(result, {
        ok: true,
        value: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-25", siteId: "site1" },
    });
});

test("validateMaterial separates a bad quantity from a missing field (B8)", () => {
    const base = { name: "Cement", units: "bags", lastUpdated: "2024-05-25" };
    assert.deepEqual(validateMaterial({ ...base, quantity: "-5" }, "s"), { ok: false, error: QUANTITY_MESSAGE });
    assert.deepEqual(validateMaterial({ ...base, quantity: "" }, "s"), { ok: false, error: QUANTITY_MESSAGE });
    assert.deepEqual(validateMaterial({ ...base, name: "", quantity: "5" }, "s"), { ok: false, error: REQUIRED_MESSAGE });
});

test("validateMaterialEdit never carries a siteId, so an edit cannot move a material", () => {
    const result = validateMaterialEdit({ name: "Cement", quantity: "9", units: "bags", lastUpdated: "2024-05-26" });
    assert.deepEqual(result, {
        ok: true,
        value: { name: "Cement", quantity: 9, units: "bags", lastUpdated: "2024-05-26" },
    });
    assert.equal(validateMaterialEdit({ name: "", quantity: "9", units: "u", lastUpdated: "d" }).ok, false);
    assert.equal(validateMaterialEdit({ name: "n", quantity: "-1", units: "u", lastUpdated: "d" }).ok, false);
});

test("buildSiteDeleteUpdates is one object covering the site and only its materials (B4)", () => {
    const materials = {
        m1: { siteId: "A", name: "Cement" },
        m2: { siteId: "B", name: "Sand" },
        m3: { siteId: "A", name: "Nails" },
    };
    assert.deepEqual(buildSiteDeleteUpdates("A", materials), {
        "sites/A": null,
        "materials/m1": null,
        "materials/m3": null,
    });
});

test("buildSiteDeleteUpdates copes with no materials and null entries (B4)", () => {
    assert.deepEqual(buildSiteDeleteUpdates("A", null), { "sites/A": null });
    assert.deepEqual(buildSiteDeleteUpdates("A", {}), { "sites/A": null });
    assert.deepEqual(buildSiteDeleteUpdates("A", { m1: null }), { "sites/A": null });
});
