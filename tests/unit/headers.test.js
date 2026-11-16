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
    for (const urlPath of ["/", "/dashboard.html", "/overview.html", "/assets/sparks-800.webp", "/src/data.js", "/sw.js"]) {
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

test("scripts come from this site, Google's Firebase CDN and the project's RTDB host", () => {
    assert.deepEqual(directive("script-src"), [
        "'self'",
        "https://www.gstatic.com",
        "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app",
    ]);
    assert.deepEqual(directive("style-src"), ["'self'"]);
    assert.deepEqual(directive("object-src"), ["'none'"]);
    assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
    assert.deepEqual(directive("base-uri"), ["'self'"]);
    assert.deepEqual(directive("form-action"), ["'self'"]);
    assert.deepEqual(directive("default-src"), ["'self'"]);
});

// Phase 7. The worker is this site's own file, and it fetches the SDK from the CDN itself when it fills the
// cache, which is why www.gstatic.com has to be in connect-src as well as script-src.
test("only this site's own script may run as the service worker", () => {
    assert.deepEqual(directive("worker-src"), ["'self'"]);
});

test("the database, sign-in and token hosts the app really talks to are allowed to connect", () => {
    const connect = directive("connect-src");
    for (const host of [
        "https://*.firebasedatabase.app", "wss://*.firebasedatabase.app",
        "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com",
        "https://www.gstatic.com",
    ]) {
        assert.ok(connect.includes(host), `connect-src is missing ${host}`);
    }
    assert.ok(connect.includes("'self'"));
});

test("the project's own auth domain, and no other, may be framed", () => {
    assert.deepEqual(directive("frame-src"), [
        "'self'",
        "https://nail-it-6b883.firebaseapp.com",
        "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app",
    ]);
});

test("the pictures and the manifest are allowed, and nothing else is", () => {
    assert.deepEqual(directive("img-src"), ["'self'", "data:"]);
    assert.deepEqual(directive("manifest-src"), ["'self'"]);
    assert.deepEqual(directive("font-src"), ["'self'"]);
});

test("pictures are cached for a week, pages are not told to cache, and the worker is never cached", () => {
    assert.equal(headersFor(config, "/assets/sparks-800.webp")["Cache-Control"], "public, max-age=604800");
    assert.equal(headersFor(config, "/favicon/favicon.ico")["Cache-Control"], "public, max-age=604800");
    assert.equal(headersFor(config, "/dashboard.html")["Cache-Control"], undefined);
    // A cached sw.js is a worker that can never be replaced: the browser keeps checking for a new one only
    // if it is allowed to revalidate it.
    assert.match(headersFor(config, "/sw.js")["Cache-Control"], /no-cache|max-age=0/);
    // sw.js imports /src/sw-cache.js, and a worker's update check byte-compares its imports too, but it
    // fetches them through the HTTP cache. Leave that import cacheable and a changed policy can sit behind
    // a stale copy: the new worker looks identical to the old one and is never installed.
    assert.match(headersFor(config, "/src/sw-cache.js")["Cache-Control"], /no-cache|max-age=0/);
    assert.equal(headersFor(config, "/dashboard.js")["Cache-Control"], undefined, "only the worker and its import");
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

// Phase 7. What a browser insists on before it will offer to put the app on a home screen: a name, a start
// url, a scope, standalone display, and a 192 and a 512 icon. Miss any one and the install prompt simply
// never appears, with nothing on screen to say why.
test("the manifest carries what a browser needs to install the app on a home screen", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../favicon/site.webmanifest"), "utf8"));
    assert.equal(manifest.id, "/");
    assert.equal(manifest.start_url, "/dashboard.html", "the app opens where the work happens, not on the pitch page");
    assert.ok(fs.existsSync(path.resolve(import.meta.dirname, "../../", manifest.start_url.slice(1))), manifest.start_url);
    assert.equal(manifest.scope, "/", "an installed app cannot navigate outside its scope");
    assert.equal(manifest.display, "standalone", "in a browser tab it would not look installed");
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    const sizes = manifest.icons.map((icon) => icon.sizes);
    for (const needed of ["192x192", "512x512"]) {
        assert.ok(sizes.includes(needed), `no ${needed} icon`);
    }
    for (const icon of manifest.icons) {
        assert.equal(icon.type, "image/png");
        assert.match(icon.purpose || "any", /any|maskable/);
    }
    assert.ok(manifest.description && manifest.description.length > 40, "an install prompt shows this");
});
