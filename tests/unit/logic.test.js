import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseQuantity,
    validateSite,
    validateMaterial,
    validateMaterialEdit,
    buildSiteDeleteUpdates,
    normalizeName,
    nameKey,
    canonicalName,
    suggestNames,
    todayISO,
    deletePhrase,
    phraseMatches,
    BUILDING_TYPES,
    UNITS,
    NO_SITE_MESSAGE,
    REQUIRED_MESSAGE,
    QUANTITY_MESSAGE,
    BUILDING_TYPE_MESSAGE,
    UNITS_MESSAGE,
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

test("validateSite trims, stamps createdAt itself and has no date field", () => {
    const ok = validateSite({ name: "  Mombasa ", location: "Nyali", buildingType: "Residential" }, 1700000000000);
    assert.deepEqual(ok, {
        ok: true,
        value: { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 1700000000000 },
    });
    assert.equal("date" in ok.value, false);
    for (const field of ["name", "location", "buildingType"]) {
        const input = { name: "a", location: "b", buildingType: "Other", [field]: "   " };
        assert.deepEqual(validateSite(input), { ok: false, error: REQUIRED_MESSAGE }, `blank ${field}`);
    }
});

test("validateSite ignores a date the caller still sends", () => {
    const result = validateSite({ name: "a", location: "b", buildingType: "Other", date: "2024-01-01" }, 5);
    assert.deepEqual(result.value, { name: "a", location: "b", buildingType: "Other", createdAt: 5 });
});

test("validateSite accepts every dropdown building type and nothing else", () => {
    for (const buildingType of BUILDING_TYPES) {
        assert.equal(validateSite({ name: "a", location: "b", buildingType }).ok, true, buildingType);
    }
    assert.deepEqual(validateSite({ name: "a", location: "b", buildingType: "Castle" }), { ok: false, error: BUILDING_TYPE_MESSAGE });
    assert.deepEqual(BUILDING_TYPES, ["Residential", "Commercial", "Industrial", "Road/Civil", "Other"]);
});

test("validateSite keeps markup as text, it never interprets it (S2)", () => {
    const name = "<img src=x onerror=alert(1)>";
    const result = validateSite({ name, location: "l", buildingType: "Other" });
    assert.equal(result.value.name, name);
});

test("validateMaterial accepts every dropdown unit and rejects others", () => {
    const base = { name: "Cement", quantity: "1", lastUpdated: "2024-05-25" };
    assert.deepEqual(UNITS, ["kg", "tonnes", "bags", "pieces", "metres", "litres", "bundles", "sheets"]);
    for (const units of UNITS) {
        assert.equal(validateMaterial({ ...base, units }, "s").ok, true, units);
    }
    assert.deepEqual(validateMaterial({ ...base, units: "cubits" }, "s"), { ok: false, error: UNITS_MESSAGE });
});

test("validateMaterial lets an edit keep a legacy unit that is not in the dropdown", () => {
    const input = { name: "Nails", quantity: "4", units: "kgs", lastUpdated: "2024-05-25" };
    assert.equal(validateMaterialEdit(input).ok, false);
    assert.equal(validateMaterialEdit(input, { legacyUnit: "kgs" }).ok, true);
    assert.equal(validateMaterialEdit({ ...input, units: "cubits" }, { legacyUnit: "kgs" }).ok, false);
});

test("normalizeName trims and collapses inner whitespace, nameKey ignores case", () => {
    assert.equal(normalizeName("  Cement \t mix  "), "Cement mix");
    assert.equal(normalizeName(undefined), "");
    assert.equal(normalizeName(42), "");
    assert.equal(nameKey("  CEMENT   Mix"), nameKey("cement mix"));
    assert.notEqual(nameKey("Cement"), nameKey("Cemnt"));
});

test("canonicalName reuses the existing spelling", () => {
    assert.equal(canonicalName("cement", ["Sand", "Cement"]), "Cement");
    assert.equal(canonicalName("  CEMENT ", ["Cement"]), "Cement");
    assert.equal(canonicalName("Gravel", ["Cement"]), "Gravel");
    assert.equal(canonicalName("Gravel"), "Gravel");
    assert.equal(canonicalName("   ", ["Cement"]), "");
});

test("validateMaterial stores the canonical spelling of a known name", () => {
    const result = validateMaterial(
        { name: "cement", quantity: "2", units: "bags", lastUpdated: "2024-05-25" },
        "s",
        { knownNames: ["Cement"] },
    );
    assert.equal(result.value.name, "Cement");
});

test("suggestNames dedupes by key, keeps the first spelling and sorts", () => {
    assert.deepEqual(suggestNames(["sand", "Cement", "Sand", " cement ", "", "Nails"]), ["Cement", "Nails", "sand"]);
    assert.deepEqual(suggestNames([]), []);
});

test("todayISO is the local calendar date, zero padded", () => {
    assert.equal(todayISO(new Date(2024, 0, 5, 23, 59)), "2024-01-05");
    assert.equal(todayISO(new Date(2024, 11, 31, 0, 0)), "2024-12-31");
});

test("deletePhrase is the site name, or 'delete' when the name is blank", () => {
    assert.equal(deletePhrase({ name: "  Mombasa  Yard " }), "Mombasa Yard");
    assert.equal(deletePhrase({ name: "   " }), "delete");
    assert.equal(deletePhrase({}), "delete");
    assert.equal(deletePhrase(undefined), "delete");
});

test("phraseMatches needs the exact name, case included", () => {
    assert.equal(phraseMatches(" Mombasa ", "Mombasa"), true);
    assert.equal(phraseMatches("mombasa", "Mombasa"), false);
    assert.equal(phraseMatches("", "Mombasa"), false);
    assert.equal(phraseMatches("Momb", "Mombasa"), false);
});

test("validateMaterial without a selected site says so, not 'fill all fields' (B9)", () => {
    const filled = { name: "Cement", quantity: "5", units: "bags", lastUpdated: "2024-05-25" };
    assert.deepEqual(validateMaterial(filled, null), { ok: false, error: NO_SITE_MESSAGE });
    assert.deepEqual(validateMaterial(filled, ""), { ok: false, error: NO_SITE_MESSAGE });
    assert.deepEqual(validateMaterial(filled, undefined), { ok: false, error: NO_SITE_MESSAGE });
});

test("validateMaterial stores quantity as a number and leaves the siteId out (B8)", () => {
    const result = validateMaterial({ name: " Cement ", quantity: "5", units: "bags", lastUpdated: "2024-05-25" }, "site1");
    assert.deepEqual(result, {
        ok: true,
        value: { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-25" },
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

test("buildSiteDeleteUpdates is one object covering the site and everything under it (B4)", () => {
    assert.deepEqual(buildSiteDeleteUpdates("A", ["u1", "u2"], ["sam@x,com"]), {
        "sites/A": null,
        "materials/A": null,
        "memberInfo/A": null,
        "siteInvites/A": null,
        "members/A/u1": null,
        "userSites/u1/A": null,
        "members/A/u2": null,
        "userSites/u2/A": null,
        "userInvites/sam@x,com/A": null,
    });
});

test("buildSiteDeleteUpdates for a site with no members or invites still removes the site and its materials", () => {
    const expected = { "sites/A": null, "materials/A": null, "memberInfo/A": null, "siteInvites/A": null };
    assert.deepEqual(buildSiteDeleteUpdates("A"), expected);
    assert.deepEqual(buildSiteDeleteUpdates("A", [], []), expected);
});

test("buildSiteDeleteUpdates only ever deletes: every value is null, and nothing outside the site is named", () => {
    const updates = buildSiteDeleteUpdates("A", ["u1"], ["k"]);
    assert.ok(Object.values(updates).every((v) => v === null));
    assert.ok(Object.keys(updates).every((path) => path.split("/").includes("A")));
});
