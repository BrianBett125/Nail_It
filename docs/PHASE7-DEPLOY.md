# Phase 7 deployment: the app opens and works with no signal

Nothing in this phase touches the database, the rules or the stored data, so there is no backfill and no
Firebase console step. It changes how every page is served and adds one module that keeps a movement until
the server has it:

* **`sw.js`** (a service worker) caches the app's own files on the device, so the app starts with nothing to
  fetch. `src/sw-cache.js` holds the whole policy as a plain module.
* **`src/outbox.js`** keeps a movement recorded with no signal on the device and sends it when the connection
  returns. It is needed because the Firebase **web** SDK keeps an unacknowledged write in memory only: it has
  no disk persistence (unlike the mobile SDKs, there is no `enablePersistence` to turn on), so closing or
  reloading the page loses the write while the person has already been told it was saved.
* **`vercel.json`** adds `worker-src 'self'` to the Content-Security-Policy and an explicit `no-cache` for
  `/sw.js` **and** `/src/sw-cache.js` (the worker imports the policy, and a worker's own update check fetches
  its imports through the HTTP cache, so a cacheable import can pin a stale policy). The manifest in
  `favicon/site.webmanifest` is completed so the app installs on a home screen.

A wrong cache rule can leave a phone showing an old page, so read the check below before merging.

## What changes

| Before | After |
|---|---|
| No signal: the browser shows its own "no internet" page | The app opens from the files on the device |
| A movement recorded with no signal is lost when the tab closes | It is kept on the device and sent when the connection returns, whether or not the app stayed open |
| Nothing says why the screen is not updating | One banner at the top of the dashboard, with the number of changes still waiting |
| The app can only be opened in a browser tab | It installs on a phone home screen, opens full screen with its own icon |
| `/sw.js` would be cached like any file | `Cache-Control: no-cache`, so a new worker is always picked up |

## What works with no signal, and what does not

| | With no signal |
|---|---|
| The app opens (pages, styles, scripts, icons) | **Yes.** They are on the device. |
| The material list you already loaded, while the page stays open | **Yes.** It stays on screen until the page is reloaded. |
| The material list after a **reload** with no signal | **No.** The phone keeps the app, not the stock. The list is empty until the connection is back. |
| Recording **Received** / **Used** | **Yes**, while the dashboard is open. The movement is kept on the device and sends itself later. |
| A material's **History** and the site's **activity feed** | **No.** They read the newest entries from the server. Blank until the connection is back. |
| Signing in | **No.** It needs the network. |

The honest summary: the phone keeps the app and the movement you record; it does not keep the stock figures.
That is why the procedure below keeps the dashboard open and does not reload it.

## Check on a preview first (you)

1. Open the Vercel preview of the Phase 7 pull request in Chrome on the desktop. Open developer tools,
   **Application** tab, **Service Workers** on the left. `sw.js` must be **activated and running**. On the
   **Cache Storage** entry `nail-it-v1`, the count must be 40 or more (the app's own shell is 51 files, plus
   the Firebase SDK).
2. Open a site, press **Used** on a material and record 1, then press **History**. The console must show no
   "Refused to ..." or "Content Security Policy" message and no error from `sw.js`.
3. If the worker does not activate, the console names the reason. Send me the message; **do not merge** until
   it activates.

Prerequisites for the phone check below: Chrome on Android (or Safari on iOS), signed in as a member of the
site (owner or storekeeper, not a viewer), a **second** device or browser signed in as **another person in the
same site**, and the preview from this pull request.

## The two-minute proof on a real phone (this is the phase's "Done when")

Plan.md's test for this phase is that *a movement recorded in airplane mode appears for other users after
reconnecting*. There is no Firebase in the test suite, so do it on the preview once, on a phone. Each step
says what you should see.

1. On the phone, open the preview and sign in. On the second device, sign in as another member of the same
   site and open that site.
   *Expected:* the site and its materials show on both.
2. Turn on **airplane mode** (airplane mode, not just Wi-Fi off, or mobile data keeps the phone online).
   *Expected:* within a few seconds the banner reads **Offline. Changes will sync when the connection comes
   back.** **Do not reload the page** (see the matrix above: a reload with no signal empties the list).
3. Press **Used** on a material and record an amount. *Expected:* a "Used N ..." message appears, exactly as it
   does online, and the banner now counts it: **Offline. 1 change waiting to send.**
4. On the second device, that movement must **not** be there yet. *Expected:* it is not.
5. Turn airplane mode **off**. *Expected:* within a few seconds the movement appears on the second device with
   the right amount, the note and the right person, and the banner goes away on the phone.

If step 2 fails (the banner never appears), that is the connection flag, not the shell: send me the browser
and version. If step 5 fails (the movement never arrives), the queue never drained: send me what the second
device showed and anything in the phone's browser console. If the app does not open at all from a cold start
with no signal, that is the shell, and it is the one case to report with the phone model and browser.

## Rollback

Revert the merge on GitHub. Vercel redeploys the old pages in about a minute. A phone that already has the
worker keeps opening the cached app until it sees a new `/sw.js`; because it is served `no-cache` it
re-checks on the next visit, finds the reverted one, and drops the app cache. To remove the app, its worker
and its cache from one specific phone:

* **iOS Safari:** Settings, Safari, Advanced, Website Data, find the site, swipe to delete.
* **Android Chrome:** Chrome menu, Settings, Site settings, find the site, **Clear & reset** (or open
  `chrome://settings/siteData` in the address bar). `chrome://serviceworker-internals` only *unregisters* the
  worker; it does not clear the site's cache or data.

A reverted `vercel.json` alone (dropping only `worker-src` and the two `no-cache` rules) leaves the worker in
place and is not a rollback: the worker needs `worker-src 'self'` to register at all.

## How it is measured

| Measure | How to see it |
|---|---|
| Every file the app needs offline is cached, and all of them exist | `npm run test:unit` (`tests/unit/sw-cache.test.js`) |
| No write, and no Firebase traffic, is ever answered from a cache | `npm run test:unit` (`tests/unit/sw-cache.test.js`), the "ignore"/"passthrough" cases |
| The app opens with the server gone, and its files still load | `node --test tests/e2e/offline.test.js` (the server is shut down, so the cache is the only thing that can answer) |
| A movement recorded with no signal survives a reload and reaches the database on reconnect | `node --test tests/e2e/offline.test.js` (the fake connection and a real reload) |
| A replayed movement is stamped by the server, and a movement that already landed is refused | `npm run test:unit` (`tests/unit/data.test.js`) and `npm run test:rules` (`tests/rules/movements.test.js`) |
| The banner appears, counts, and goes away with the connection | `node --test tests/e2e/offline.test.js` |
| Every page registers the worker and links the manifest | `npm run test:unit` (`tests/unit/pages.test.js`) |
| Only this site's own script may run as the worker | `npm run test:unit` (`tests/unit/headers.test.js`) |

## Verification log

| Check | Expected | Observed |
|---|---|---|
| Unit, rules and E2E suites green | all pass | `npm run test:unit` 295/295, `npm run test:rules` 220/220, `npm run test:e2e` 518/518, 0 fail (2026-11-16) |
| Preview: worker activated, cache holds the shell | activated, 40+ entries | *to be filled on the preview* |
| Phone: movement recorded in airplane mode arrives on reconnect | arrives with the right amount, note and person | *to be filled on the phone* |
