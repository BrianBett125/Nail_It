// Phase 7: the caching policy, checked without a browser.
//
// sw.js is the thin part that talks to the worker's globals and the Cache API; every decision it makes is
// in src/sw-cache.js, which is a plain module, so it is tested here the same way the rest of src/ is.
// tests/e2e/offline.test.js is what proves the worker really serves a page with the network cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    CACHE_NAME,
    CACHE_PREFIX,
    OFFLINE_FALLBACK,
    SDK_ASSETS,
    SHELL_ASSETS,
    STRATEGY,
    cachesToDelete,
    isSdkRequest,
    strategyFor,
} from "../../src/sw-cache.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const shell = new Set(SHELL_ASSETS);
const ORIGIN = "https://nail-it.example";
const ask = (url, over = {}) => strategyFor({ url, origin: ORIGIN, ...over });

// ---- the shell ----------------------------------------------------------------------

test("every file the worker precaches exists at the path a page asks for", () => {
    assert.ok(SHELL_ASSETS.length >= 40, `the shell looks too small: ${SHELL_ASSETS.length}`);
    assert.equal(new Set(SHELL_ASSETS).size, SHELL_ASSETS.length, "a file is listed twice");
    for (const asset of SHELL_ASSETS) {
        assert.ok(asset.startsWith("/"), `${asset} must be an absolute path`);
        const file = path.join(ROOT, asset);
        assert.ok(fs.existsSync(file), `${asset} is not in the repo`);
        assert.ok(fs.statSync(file).isFile(), `${asset} is a directory`);
    }
});

test("nothing a page loads is left out of the shell", () => {
    const pages = ["index.html", "dashboard.html", "overview.html", "login.html", "about-us.html"];
    const refs = /(?:href|src)="((?:styles|favicon|src|assets)\/[^"]+|[A-Za-z-]+\.js)"/g;
    let checked = 0;
    for (const page of pages) {
        for (const [, ref] of read(page).matchAll(refs)) {
            checked += 1;
            assert.ok(shell.has(`/${ref}`), `${page} loads ${ref}, which the shell does not cache`);
        }
    }
    assert.ok(
        checked > 20,
        `only ${checked} references were checked, the pattern must have stopped matching`,
    );
    for (const { src } of JSON.parse(read("favicon/site.webmanifest")).icons) {
        // The manifest lives in /favicon/, so its icon paths are relative to that folder.
        const iconPath = src.startsWith("/") ? src : `/favicon/${src}`;
        assert.ok(shell.has(iconPath), `the manifest names ${src}, which the shell does not cache`);
    }
});

test("every module src/ holds is in the shell, so a page cannot import one that is not cached", () => {
    for (const file of fs.readdirSync(path.join(ROOT, "src"))) {
        assert.ok(shell.has(`/src/${file}`), `src/${file} is not cached`);
    }
});

test("the page shown when a navigation misses the cache is itself cached", () => {
    assert.ok(shell.has(OFFLINE_FALLBACK), `${OFFLINE_FALLBACK} must be part of the shell`);
});

// ---- the SDK ------------------------------------------------------------------------

test("the SDK files cached are the version the app really imports", () => {
    const sources = fs
        .readdirSync(path.join(ROOT, "src"))
        .map((file) => read(`src/${file}`))
        .join("\n");
    const versions = [...sources.matchAll(/firebasejs\/(\d+\.\d+\.\d+)\//g)].map(
        ([, version]) => version,
    );
    assert.ok(versions.length >= 3, "the SDK import must be there three times over");
    assert.deepEqual(
        [...new Set(versions)].length,
        1,
        `the app imports more than one SDK version: ${[...new Set(versions)].join(", ")}`,
    );
    for (const url of SDK_ASSETS) {
        assert.ok(
            url.includes(`/firebasejs/${versions[0]}/`),
            `the app imports the SDK ${versions[0]}, the worker caches ${url}`,
        );
    }
});

test("the SDK files are the app's three, and no two are the same", () => {
    const names = SDK_ASSETS.map((url) => url.split("/").pop());
    assert.deepEqual(names.sort(), ["firebase-app.js", "firebase-auth.js", "firebase-database.js"]);
});

test("only Google's own Firebase SDK counts as the SDK", () => {
    for (const url of SDK_ASSETS) {
        assert.equal(isSdkRequest(url), true, url);
    }
    assert.equal(
        isSdkRequest("https://www.gstatic.com/other/x.js"),
        false,
        "another file on the CDN is not ours",
    );
    assert.equal(
        isSdkRequest("https://evil.example/firebasejs/10.12.2/firebase-app.js"),
        false,
        "not Google's host",
    );
    assert.equal(
        isSdkRequest("https://www.gstatic.com.evil.example/firebasejs/x.js"),
        false,
        "a host that starts the same is not the host",
    );
    assert.equal(
        isSdkRequest("/firebasejs/10.12.2/firebase-app.js"),
        false,
        "a path of this site's is not the CDN",
    );
    assert.equal(isSdkRequest("not a url"), false);
});

// ---- what each request gets ----------------------------------------------------------

test("a write is never answered from a cache", () => {
    assert.equal(ask(`${ORIGIN}/index.html`, { method: "POST" }), STRATEGY.IGNORE);
    assert.equal(ask(`${ORIGIN}/index.html`, { method: "PUT", mode: "navigate" }), STRATEGY.IGNORE);
    assert.equal(ask(SDK_ASSETS[0], { method: "POST" }), STRATEGY.IGNORE);
});

test("a page is network-first, so a fresh deploy is what people see", () => {
    assert.equal(
        ask(`${ORIGIN}/dashboard.html?site=sA`, { mode: "navigate" }),
        STRATEGY.NETWORK_FIRST,
    );
    assert.equal(ask(`${ORIGIN}/`, { mode: "navigate" }), STRATEGY.NETWORK_FIRST);
    assert.equal(ask(`${ORIGIN}/anything-at-all`, { mode: "navigate" }), STRATEGY.NETWORK_FIRST);
});

test("the app's own files are revalidated, and anything else of this site's is left alone", () => {
    for (const asset of SHELL_ASSETS) {
        assert.equal(ask(`${ORIGIN}${asset}`), STRATEGY.REVALIDATE, asset);
    }
    assert.equal(ask(`${ORIGIN}/styles/not-a-file.css`), STRATEGY.PASSTHROUGH);
    assert.equal(ask(`${ORIGIN}/sw.js`), STRATEGY.PASSTHROUGH, "the worker does not cache itself");
});

test("the SDK is immutable: its URL carries the version", () => {
    for (const url of SDK_ASSETS) {
        assert.equal(ask(url), STRATEGY.IMMUTABLE, url);
    }
});

test("the database, sign-in and every other site are never intercepted", () => {
    for (const url of [
        "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app/materials/sA.json",
        "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app/.info/connected",
        "wss://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app/.ws?ns=nail-it-6b883",
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        "https://securetoken.googleapis.com/v1/token",
        "https://kit.fontawesome.com/a076d05399.js",
    ]) {
        assert.equal(ask(url), STRATEGY.PASSTHROUGH, url);
    }
    assert.equal(
        ask("http://127.0.0.1:5173/dashboard.html", { mode: "navigate" }),
        STRATEGY.PASSTHROUGH,
        "another origin serving the same paths is not ours",
    );
});

test("an address the worker cannot read is passed through rather than guessed at", () => {
    assert.equal(strategyFor({ url: "not a url", origin: ORIGIN }), STRATEGY.PASSTHROUGH);
    assert.equal(
        strategyFor({ url: "not a url", origin: ORIGIN, method: "GET" }),
        STRATEGY.PASSTHROUGH,
    );
});

// ---- housekeeping --------------------------------------------------------------------

test("a new worker drops its own older caches and nobody else's", () => {
    assert.deepEqual(
        cachesToDelete([
            `${CACHE_PREFIX}-v0`,
            CACHE_NAME,
            "workbox-precache-v2",
            `${CACHE_PREFIX}-other-app`,
        ]),
        [`${CACHE_PREFIX}-v0`, `${CACHE_PREFIX}-other-app`],
        "the current cache and other people's caches are kept",
    );
    assert.deepEqual(cachesToDelete([]), []);
    assert.deepEqual(cachesToDelete([CACHE_NAME]), []);
    assert.match(
        CACHE_NAME,
        new RegExp(`^${CACHE_PREFIX}-`),
        "the cache name carries the prefix it is found by",
    );
});
