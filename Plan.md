# Nail_It: Improvement Plan

Goal: turn Nail_It from "a form that stores rows" into a stock tool that people on a construction site actually use every day.

## Who uses it

| Role | What they do in the app | Needs most |
|---|---|---|
| **Foreman / storekeeper** | Receives and issues materials, many times a day, usually on a phone | Speed: 2 taps to record, works with bad signal |
| **Engineer** | Checks what is on site before planning work | Clear stock levels, low-stock warnings |
| **Quantity surveyor** | Reconciles usage against the bill of quantities | History of movements, export |
| **Architect** | Looks up what materials and quantities were used | Read-only view, clean reports |
| **Owner** | Oversees several sites, spots waste and shortages | Cross-site summary, who did what |

Design rule: the foreman's flow must be the fastest thing in the app. Everyone else is mostly reading.

## Principles

- Record **movements** (received / used), not edits. Quantity is derived from them.
- Phone first. Sites have gray weather, dirty hands and weak signal.
- Vanilla HTML/CSS/JS, no build step unless a phase clearly needs one.
- Every phase ships with tests for what it changes. One branch per phase, one PR per phase.
- Anything touching production data (rules deploy, migrations) starts with a JSON export from the Firebase console.

---

## Phase 0: Stop the bleeding (about 1 to 2 days)

Branch: `fix-core-bugs`

Do this before anything else. The app currently writes junk to the database and has an XSS hole.

- [ ] **Check Firebase rules in the console today.** If they are open test-mode rules, note it; Phase 2 fixes it.
- [ ] Export the current database to JSON as a rollback snapshot.
- [ ] **B1** Remove the duplicate click listener on the update button (it writes to `materials/[object PointerEvent]` and fires twice). Read an `editingId` variable at submit time instead.
- [ ] **B2** Use `form.addEventListener('submit', e => { e.preventDefault(); ... })` so the page stops reloading and the selected site stays selected.
- [ ] **B3** Keep one materials subscription. On site change, call the stored `unsubscribe()` first, then subscribe to the new site.
- [ ] **B4** Cascade delete as a single multi-path `update()` so a failure cannot leave orphans.
- [ ] **B5** Remove the unused second delete modal (duplicate ids).
- [ ] **B8** Store quantity as a number; reject NaN and negatives.
- [ ] **B9** Show a "Select a site first" message instead of the wrong "fill all fields" error.
- [ ] **S2** Build the site list with `createElement` and `textContent`, never `innerHTML` with user text.
- [ ] Delete the four unused Firebase 9.9.1 compat scripts from `dashboard.html`.
- [ ] Fix the manifest path (`/site.webmanifest`), icon paths, and fill in `name` and `short_name`.
- [ ] Soften the "Secure Storage" marketing line until Phase 2 ships.
- [ ] Add `rel="noopener noreferrer"` to `target="_blank"` links.
- [ ] Add `.kilo/` to `.gitignore`.

**Done when:** editing a material creates exactly one write, no junk keys exist, adding a site does not reload the page, a site named `<img src=x onerror=alert(1)>` shows as plain text.

**Tests:** a small Playwright suite covering B1, B2, B3, S2 (each fails before the fix, passes after).

---

## Phase 1: Faster everyday flow (about 2 to 3 days)

Branch: `streamline-flow`

Cut the 10-step walkthrough down. Target: add a site and its first material in under 30 seconds.

- [ ] **Move "Add Site" to the top of the sidebar**, not the bottom-left corner.
- [ ] **Auto-select a new site** after creating it, and remember the last-opened site (`localStorage`).
- [ ] Site form: drop the Date field (store `createdAt` automatically). Building type becomes a dropdown (residential, commercial, industrial, road/civil, other).
- [ ] Material form: units become a dropdown (kg, tonnes, bags, pieces, metres, litres, bundles, sheets).
- [ ] **Autocomplete material names** from past entries to stop "Cement" / "cement" / "Cemnt" duplicates.
- [ ] **"Add & another"** button so entering a delivery of 15 items does not mean reopening the form 15 times.
- [ ] Replace the material delete confirm with a **"Deleted. Undo"** toast.
- [ ] Site delete: keep a confirm, but require typing the site name.
- [ ] Replace `alert()` with toasts. Add empty states ("No sites yet. Add your first site.") and loading states.
- [ ] Rewrite the README usage steps to match the shorter flow.

**Done when:** a new user can add a site and three materials without reading instructions.

**Tests:** E2E for the full flow; unit tests for name normalization and validation.

---

## Phase 2: Accounts, roles and locked-down data (about 3 to 4 days)

Branch: `auth-roles-rules`

Needed before movements, because "who did this" requires knowing who they are.

- [ ] Firebase Auth with email/password. Wire up `login.html` (sign in, sign up, reset, sign out) and guard `dashboard.html`.
- [ ] **Roles** stored per site:

| Role | Can do |
|---|---|
| **Owner** | Everything, manage members, delete sites, see all their sites |
| **Storekeeper** (foreman) | Record movements, add materials, edit stock thresholds |
| **Viewer** (engineer, QS, architect) | Read stock, history and exports. No writes |

- [ ] Schema, flat by site so the sidebar does not download all materials:

```
/sites/{siteId}                       { name, location, buildingType, createdAt, ownerUid }
/members/{siteId}/{uid}               "owner" | "storekeeper" | "viewer"
/materials/{siteId}/{materialId}      { name, unit, quantity, minLevel, updatedAt }
/movements/{siteId}/{movementId}      { materialId, delta, type, note, byUid, at }
```

- [ ] Commit `database.rules.json`: auth required, role-based write rules, `.validate` on types, lengths, `quantity >= 0`.
- [ ] Invite flow: owner adds a member by email and picks a role (an invite code or link is fine for v1).
- [ ] One-time migration of existing sites to an owner uid, run only after the snapshot and with your go-ahead.
- [ ] Rules unit tests with `@firebase/rules-unit-testing` against the emulator: owner can write, viewer cannot, stranger cannot read, bad types rejected.

**Done when:** a logged-out visitor gets nothing, a viewer cannot write, and the rules tests pass.

---

## Phase 3: Stock movements and history (about 4 to 5 days)

Branch: `stock-movements`

The core shift: stop retyping quantities, start recording what moved.

- [ ] Each material row gets **Received (+)** and **Used (-)** buttons. Tap, enter an amount (number pad on mobile), optional note, confirm.
- [ ] Each action writes a movement `{ materialId, delta, type, note, byUid, at: serverTimestamp }` and updates the material's quantity **in one multi-path `update()`** so the two never disagree.
- [ ] Block "Used" amounts greater than current stock (with a clear message).
- [ ] **Material history view**: list of movements with who, when, how much, running balance.
- [ ] **Site activity feed**: latest movements across the site ("Brian used 20 bags of cement, 2h ago").
- [ ] Replace the typed "Last Updated" date with the server timestamp.
- [ ] Keep the pen-and-paper edit only for name, unit and threshold. Quantity changes go through movements.
- [ ] Opening-balance movement when a material is first added, so history starts complete.

**Done when:** quantity always equals the sum of its movements, and every change shows who made it and when.

**Tests:** unit tests for balance logic; E2E for receive, use, over-use rejection; rules test that viewers cannot create movements.

---

## Phase 4: Find things and spot problems (about 3 days)

Branch: `stock-insights`

- [ ] **Low-stock threshold** per material (`minLevel`), red highlight when at or below it.
- [ ] **Site summary header**: number of materials, number low on stock, last activity.
- [ ] Make the search box work: filter materials by name. Remove it from marketing pages.
- [ ] Sort by name, quantity, last updated. Filter chips: All / Low stock.
- [ ] **Owner overview page**: all sites with their low-stock counts and last activity, for the business owner who does not open each site.

**Done when:** an engineer can answer "are we running out of anything?" in one glance.

---

## Phase 5: Phone-ready (about 3 to 4 days)

Branch: `mobile-and-assets`

Site crews use phones, and the dashboard currently has zero media queries.

- [ ] Dashboard layout for 768px and below: sidebar becomes a top drawer or site picker, table becomes stacked cards, large tap targets for +/-.
- [ ] Forms and modals become native `<dialog>` (focus trap, Esc to close, `aria-modal` for free). Fix label `for` ids and add `aria-label` to icon buttons.
- [ ] Image diet: resize and convert to WebP (hero 200 KB or less, backgrounds 150 KB or less). Delete unreferenced `welder.jpg` and `test.txt`; check whether the two PNGs belong in the README first. Rename `architechture.jpg`.
- [ ] Replace the Font Awesome kit with a handful of inline SVG icons. Add `defer` to scripts, load Poppins or drop the reference.
- [ ] Contrast check on the tan buttons (white on `#d3a269` probably fails 4.5:1).
- [ ] `vercel.json` with CSP and security headers.

**Done when:** every page works at 375px and a Lighthouse mobile run scores 90+ on performance and accessibility.

**Tests:** Playwright at a mobile viewport; axe-core with zero serious or critical violations.

---

## Phase 6: Reports people can send (about 2 to 3 days)

Branch: `reports-export`

Site managers send reports to head office through email and WhatsApp. QS and owners need numbers they can reconcile.

- [ ] **CSV export** of current stock per site.
- [ ] **CSV export of movements** with a date range filter (for QS reconciliation against the bill of quantities).
- [ ] **Print-friendly view** (a print stylesheet) that also works as "Save as PDF" for architects and head office.
- [ ] "Share" button using the Web Share API on mobile, so a stock summary goes straight to WhatsApp.

**Done when:** a QS can export a month of movements and open them in Excel without cleanup.

---

## Phase 7: Works with bad signal (about 3 to 5 days)

Branch: `offline-pwa`

Likely your strongest differentiator for real site use.

- [ ] Service worker to cache the app shell so it opens with no signal.
- [ ] Enable Realtime Database offline persistence so writes queue locally and sync on reconnect.
- [ ] Visible "Offline, changes will sync" indicator.
- [ ] Decide how conflicts behave: movements are append-only deltas, so two people recording offline will not overwrite each other. This is another reason Phase 3 comes first.
- [ ] Complete the web manifest so the app can be installed on a phone home screen.

**Done when:** a movement recorded in airplane mode appears for other users after reconnecting.

---

## Phase 8: Housekeeping (ongoing)

- [ ] `package.json`, ESLint, Prettier, `npm test`.
- [ ] GitHub Actions: lint, unit tests, emulator E2E on each PR.
- [ ] Split `dashboard.js` into modules (data layer, rendering, forms) so logic is unit-testable.
- [ ] Shared header partial to remove the 4x duplication.
- [ ] README rewrite: live URL, setup, emulator usage, rules deployment, schema, screenshots.
- [ ] Add a short "how to use" section per role.

---

## Later, only if real users ask

- Delivery note photo upload
- Cost per unit and total stock value
- Transfers between sites
- Reorder requests with an approval step
- Link materials to a bill of quantities for planned vs actual

---

## Suggested order and timing

| Order | Phase | Rough time |
|---|---|---|
| 1 | Phase 0: Bugs and safety | 1 to 2 days |
| 2 | Phase 1: Faster flow | 2 to 3 days |
| 3 | Phase 2: Auth, roles, rules | 3 to 4 days |
| 4 | Phase 3: Movements and history | 4 to 5 days |
| 5 | Phase 4: Low stock, search, overview | 3 days |
| 6 | Phase 5: Mobile and assets | 3 to 4 days |
| 7 | Phase 6: Reports | 2 to 3 days |
| 8 | Phase 7: Offline | 3 to 5 days |
| Ongoing | Phase 8: Housekeeping | as you go |

Phases 0 to 4 give you a secure app with real stock logic. Phases 5 to 7 are what make it feel built for site conditions.

## Success measures

| Measure | Now | Target |
|---|---|---|
| Junk or orphaned database keys | present | 0 |
| Unauthenticated reads and writes | allowed (assumed) | 0 |
| Taps to record "20 bags of cement used" | about 8 | 3 |
| Time to add a site and first material | several minutes | under 30 seconds |
| Dashboard usable at 375px | no | yes |
| Home page image weight | about 0.9 MB | under 250 KB |
| Quantity matches sum of movements | n/a | always |

## Validate with real users

After Phase 3, put the app in front of one foreman and one QS for 10 minutes each. Watch them record a delivery and find last week's usage. Their confusion will tell you what to reorder in Phases 4 to 7 better than any plan.
