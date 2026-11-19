// Phase 7: the service worker that lets the app open with no signal.
//
// This file is registered as `type: "module"` (src/sw-register.js), so it can import the policy in
// src/sw-cache.js and that policy can be tested in Node. Everything here is the thin part: it reads the
// request, asks src/sw-cache.js what to do, and does it with the Cache API.
//
// The database is never touched. The Firebase web SDK holds an unacknowledged write in memory and nothing
// more (there is no disk persistence on the web, unlike the mobile SDKs), so a movement recorded with no
// signal is gone the moment the page reloads. Closing that gap is not this worker's job: src/outbox.js
// keeps the movement on the device and replays it. All this worker has to do is make sure the app's own
// code is on the device, so the app can start with no signal and reach that queue.
import {
    CACHE_NAME,
    OFFLINE_FALLBACK,
    SDK_ASSETS,
    SHELL_ASSETS,
    STRATEGY,
    cachesToDelete,
    strategyFor,
} from "/src/sw-cache.js";

const origin = self.location.origin;

// Install: put the whole app shell in the cache before the worker takes over.
//
// The app's own files are required. If one of them cannot be fetched the install fails and the worker is
// not used, which is loud and correct: a shell missing a script opens to a blank page with no signal, and
// a blank page is worse than no offline support at all. tests/unit/sw-cache.test.js is what keeps the
// list honest, so this cannot fail in production because of a typo.
//
// The Firebase SDK comes from Google's CDN and is best effort: a CDN hiccup must not cost the app its
// offline shell. Whatever is missed here is fetched and cached by the fetch handler below on the first
// normal load, which is every load after this one.
self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(SHELL_ASSETS);
            await Promise.allSettled(SDK_ASSETS.map((url) => cache.add(url)));
            await self.skipWaiting();
        })(),
    );
});

// Activate: drop the caches of older versions of this worker, and take over the pages that are already
// open so the current visit is covered too, not just the next one.
self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(cachesToDelete(names).map((name) => caches.delete(name)));
            await self.clients.claim();
        })(),
    );
});

// Somewhere to put a fresh copy without making the page wait for it. Only a complete 200 is stored: a
// 206 (a ranged fetch) must not be cached, or a later load would be answered with a fragment of the
// file, and the Cache API refuses a 206 anyway. Anything else (a redirect, a 304, an error) is left out.
async function store(request, response) {
    if (!response || response.status !== 200) {
        return;
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
}

// The Firebase SDK: the URL carries the version, so a copy in the cache is always the right copy.
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }
    const response = await fetch(request);
    await store(request, response);
    return response;
}

// The app's own files: answer from the cache straight away, and fetch a fresh copy in the background so
// the next load has the new one. A page never waits on the network, and a deploy still lands.
function revalidate(event) {
    const refresh = fetch(event.request).then(async (response) => {
        await store(event.request, response);
        return response;
    });
    event.waitUntil(refresh.catch(() => {}));
    return caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || refresh);
}

// A page: the server's copy when it answers, the cached one when it does not. ignoreSearch matters here
// because the dashboard is opened as dashboard.html?site=<id>.
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        await store(request, response);
        return response;
    } catch {
        const cached =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(OFFLINE_FALLBACK));
        if (cached) {
            return cached;
        }
        throw new Error("no network and nothing cached");
    }
}

self.addEventListener("fetch", (event) => {
    const strategy = strategyFor({
        url: event.request.url,
        method: event.request.method,
        mode: event.request.mode,
        origin,
    });
    if (strategy === STRATEGY.IGNORE || strategy === STRATEGY.PASSTHROUGH) {
        return; // the database, sign-in, and writes: straight to the network, exactly as before
    }
    if (strategy === STRATEGY.NETWORK_FIRST) {
        event.respondWith(networkFirst(event.request));
    } else if (strategy === STRATEGY.REVALIDATE) {
        event.respondWith(revalidate(event));
    } else {
        event.respondWith(cacheFirst(event.request));
    }
});
