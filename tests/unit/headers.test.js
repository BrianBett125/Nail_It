// vercel.json: the security headers every page is served with. The policy is also exercised in a real
// browser in tests/e2e/security.test.js; this is the part that needs no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sourceMatches, headersFor } from "../../scripts/serve.mjs";

const config = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../vercel.json"), "utf8"));
const csp = (urlPath = "/") => headersFor(config, urlPath)["Content-Security-Policy"];
const directive = (name) => (csp().split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || "").split(/\s+/).slice(1);

test("every path gets the full set of security headers", () => {
    for (const urlPath of ["/", "/dashboard.html", "/overview.html", "/assets/sparks-800.webp", "/src/data.js"]) {
        const headers = headersFor(config, urlPath);
        for (const key of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Strict-Transport-Security"]) {
            assert.ok(headers[key], `${urlPath} has no ${key}`);
        }
    }
    assert.equal(headersFor(config, "/")["X-Content-Type-Options"], "nosniff");
});

test("the policy has no 'unsafe-inline', 'unsafe-eval' or wildcard source", () => {
    const text = csp();
    assert.doesNotMatch(text, /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch(text, /(^|[ ;])\*([ ;]|$)/, "a bare * allows everything");
    assert.doesNotMatch(text, /(^|\s)https?:(\s|;|$)/, "a bare scheme allows every host");
});

test("scripts come from this site and Google's Firebase CDN only", () => {
    assert.deepEqual(directive("script-src"), ["'self'", "https://www.gstatic.com"]);
    assert.deepEqual(directive("style-src"), ["'self'"]);
    assert.deepEqual(directive("object-src"), ["'none'"]);
    assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
    assert.deepEqual(directive("base-uri"), ["'self'"]);
    assert.deepEqual(directive("form-action"), ["'self'"]);
    assert.deepEqual(directive("default-src"), ["'self'"]);
});

test("the database, sign-in and token hosts the app really talks to are allowed to connect", () => {
    const connect = directive("connect-src");
    for (const host of [
        "https://*.firebasedatabase.app", "wss://*.firebasedatabase.app",
        "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com",
    ]) {
        assert.ok(connect.includes(host), `connect-src is missing ${host}`);
    }
    assert.ok(connect.includes("'self'"));
});

test("the project's own auth domain, and no other, may be framed", () => {
    assert.deepEqual(directive("frame-src"), ["https://nail-it-6b883.firebaseapp.com"]);
});

test("the pictures and the manifest are allowed, and nothing else is", () => {
    assert.deepEqual(directive("img-src"), ["'self'", "data:"]);
    assert.deepEqual(directive("manifest-src"), ["'self'"]);
    assert.deepEqual(directive("font-src"), ["'self'"]);
});

test("pictures are cached for a week, pages are not told to cache", () => {
    assert.equal(headersFor(config, "/assets/sparks-800.webp")["Cache-Control"], "public, max-age=604800");
    assert.equal(headersFor(config, "/favicon/favicon.ico")["Cache-Control"], "public, max-age=604800");
    assert.equal(headersFor(config, "/dashboard.html")["Cache-Control"], undefined);
});

test("sourceMatches reads Vercel's path patterns", () => {
    assert.equal(sourceMatches("/(.*)", "/anything/at/all.html"), true);
    assert.equal(sourceMatches("/assets/(.*)", "/assets/a.webp"), true);
    assert.equal(sourceMatches("/assets/(.*)", "/src/assets/a.webp"), false);
    assert.equal(sourceMatches("/favicon/(.*)", "/favicon.ico"), false);
});

test("the manifest and every icon it names exist, with a name and a short name", () => {
    const dir = path.resolve(import.meta.dirname, "../../favicon");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "site.webmanifest"), "utf8"));
    assert.ok(manifest.name && manifest.short_name);
    for (const icon of manifest.icons) {
        assert.ok(fs.existsSync(path.join(dir, icon.src)), icon.src);
    }
});
