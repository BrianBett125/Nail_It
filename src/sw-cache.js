// Phase 7: what the service worker caches, and which strategy every request gets.
//
// The decisions live here, in a plain module with no DOM, no `self` and no Cache API, so `node --test`
// can check them (tests/unit/sw-cache.test.js). sw.js is the thin part that talks to the worker's own
// globals and actually calls caches.match and fetch.
//
// Three kinds of request reach the worker:
//   1. a page (a navigation)        network-first: the server's copy when it answers, the cached one when it does not
//   2. the app's own static files   revalidate: the cached copy now, a fresh one fetched in the background for next time
//   3. the Firebase SDK on the CDN  immutable: the URL carries the version, so a cached copy is always the right one
// Everything else, above all the database and sign-in traffic, is left completely alone. The Firebase web
// SDK keeps an unacknowledged write in memory and nothing more (there is no disk persistence on the web),
// so this worker is only half of the offline story: it puts the app's own code on the device, so the app
// can start with no signal. Holding the movement itself until it reaches the database is src/outbox.js.

export const CACHE_PREFIX = "nail-it";
export const CACHE_VERSION = "v1";
export const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

// The page shown when a navigation is asked for and that page is not cached. Only reachable if the
// shell below is incomplete, because every real page of the app is in it.
export const OFFLINE_FALLBACK = "/index.html";

const SDK_HOST = "www.gstatic.com";
const SDK_PATH = "/firebasejs/";
const SDK_VERSION = "10.12.2";

// The Firebase SDK the app imports. These three files are the whole graph: on the CDN each one imports
// `firebase-app.js` and nothing else, and `firebase-app.js` imports nothing (checked against the CDN).
// They are not optional. dashboard.js imports src/data.js, which imports these, so without them the app
// cannot start at all with no signal.
export const SDK_ASSETS = [
    `https://${SDK_HOST}${SDK_PATH}${SDK_VERSION}/firebase-app.js`,
    `https://${SDK_HOST}${SDK_PATH}${SDK_VERSION}/firebase-database.js`,
    `https://${SDK_HOST}${SDK_PATH}${SDK_VERSION}/firebase-auth.js`,
];

// The app's own files: every page, stylesheet, script, icon and image a cold load of any page needs.
// tests/unit/sw-cache.test.js checks that each one exists and that the SDK version above matches the
// one the code really imports, so a renamed file or a version bump cannot quietly break offline.
export const SHELL_ASSETS = [
    "/index.html",
    "/dashboard.html",
    "/overview.html",
    "/login.html",
    "/about-us.html",
    "/dashboard.js",
    "/overview.js",
    "/login.js",
    "/styles/tokens.css",
    "/styles/index.css",
    "/styles/dashboard.css",
    "/styles/insights.css",
    "/styles/dialogs.css",
    "/styles/reports.css",
    "/styles/overview.css",
    "/styles/login.css",
    "/styles/about-us.css",
    "/styles/print.css",
    "/src/auth-errors.js",
    "/src/auth.js",
    "/src/data.js",
    "/src/dialog.js",
    "/src/firebase-app.js",
    "/src/firebase-config.js",
    "/src/icons.js",
    "/src/insights.js",
    "/src/logic.js",
    "/src/movements.js",
    "/src/outbox.js",
    "/src/reports.js",
    "/src/roles.js",
    "/src/sw-cache.js",
    "/src/sw-register.js",
    "/src/toast.js",
    "/src/ui-drawer.js",
    "/src/ui-insights.js",
    "/src/ui-movements.js",
    "/src/ui-reports.js",
    "/favicon/site.webmanifest",
    "/favicon/favicon.ico",
    "/favicon/favicon-16x16.png",
    "/favicon/favicon-32x32.png",
    "/favicon/apple-touch-icon.png",
    "/favicon/android-chrome-192x192.png",
    "/favicon/android-chrome-512x512.png",
    "/assets/architecture-800.webp",
    "/assets/architecture-1600.webp",
    "/assets/database.webp",
    "/assets/hammer-600.webp",
    "/assets/sparks-800.webp",
    "/assets/sparks-1600.webp",
    "/assets/stock.webp",
    "/assets/storage.webp",
];

export const STRATEGY = {
    IGNORE: "ignore",
    NETWORK_FIRST: "network-first",
    REVALIDATE: "revalidate",
    IMMUTABLE: "immutable",
    PASSTHROUGH: "passthrough",
};

// A file from the Firebase SDK on Google's CDN. Anything else on that host is not ours to cache.
export function isSdkRequest(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return parsed.host === SDK_HOST && parsed.pathname.startsWith(SDK_PATH);
}

// What to do with one request. `origin` is the worker's own origin, passed in rather than read from
// `self` so this stays a plain function.
export function strategyFor({ url, method = "GET", mode = "no-cors", origin }) {
    // A write (or a preflight for one) is not a thing to serve from a cache, ever.
    if (method !== "GET") {
        return STRATEGY.IGNORE;
    }
    if (isSdkRequest(url)) {
        return STRATEGY.IMMUTABLE;
    }
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return STRATEGY.PASSTHROUGH;
    }
    // The database, sign-in, or anything else that is not this site: never intercepted.
    if (parsed.origin !== origin) {
        return STRATEGY.PASSTHROUGH;
    }
    if (mode === "navigate") {
        return STRATEGY.NETWORK_FIRST;
    }
    if (SHELL_ASSETS.includes(parsed.pathname)) {
        return STRATEGY.REVALIDATE;
    }
    // Something of this site's that is not part of the shell (for example sw.js itself): untouched.
    return STRATEGY.PASSTHROUGH;
}

// The caches to drop when a new worker takes over: ours from an older version, and nothing else.
// Anything not carrying our prefix belongs to somebody else on the origin.
export function cachesToDelete(existingNames) {
    return existingNames.filter(
        (name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== CACHE_NAME,
    );
}
