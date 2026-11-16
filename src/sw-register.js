// Phase 7: registers the service worker (sw.js at the root of the site) that lets the app open with no
// signal. Every page loads this file, so wherever somebody lands, the app ends up on their device.
//
// Registration is allowed to fail: a private window, an old browser, blocked site data. The app works
// exactly as it did before without one, it just needs the network. Nothing is reported to the person,
// because there is nothing they could do about it and nothing they lose.
//
// `type: "module"` because sw.js imports the caching policy in src/sw-cache.js. Registering after `load`
// keeps the download off the critical path of the first paint.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js", { type: "module" }).catch(() => {});
    });
}
