# Introduction

Nail_It is a construction site stock taking application, able to store materials record on site for different sites.

## Authors

* [Brian Bett] @BrianBett756@gmail.com
* [Njenga Mwangi] @wilsonnjenga799@gmail.com

## Link to Demo Web Application

 [Nail It](https://vercel.com/brianbett125s-projects/nail-it)

Hosted on Vercel at the moment.

## Accounts and roles

You sign in with an email and a password (the **Sign in** page; **Create an account** and **Forgot password?** are on it). Firebase sends a verification email: you can use the app straight away, but you can only accept an invitation once your email is verified.

Every site has people in it, each with one role:

| Role | Can do |
|---|---|
| **Owner** (whoever created the site) | Everything: record stock, add, edit and delete materials, delete the site, invite people, change roles, remove people |
| **Storekeeper** (foreman) | Record stock (Received, Used), add, edit and delete materials |
| **Viewer** (engineer, QS, architect) | Read the stock, every material's history and the site's activity. No buttons to change anything |

The page only shows what your role may do, and the database refuses the rest even if someone bypasses the page (`database.rules.json`).

**Inviting someone:** open the site, click **Members**, type their email, pick **Storekeeper** or **Viewer**, click **Send invite**. Nothing is emailed from the app: tell them to sign up or sign in with that email. They accept under **Invitations** in the sidebar. Non-owners can leave a site from the same dialog (two taps), and owners can change roles or remove people there.

## Usage

The dashboard is meant to be used without reading instructions. A site and three materials is 17 actions (clicks, typing, choosing from a list), counted by an automated test in `tests/e2e/streamline.test.js`.

1. Open the dashboard page and sign in (or create an account). **Add Site** is at the top of the left sidebar.
2. Type the site name and location, pick the type of building from the list, and click **Add Site**. The new site opens by itself, and the dashboard opens the same site next time you come back.
3. Click **Add Material**. Type the name (names you used before are suggested, and "cement" is saved as "Cement" if that already exists), the quantity you have on site now, and pick the unit from the list. The low-stock level is optional.
4. Click **Add** to save and close, or **Add & another** to save and keep the form open for the next item. The unit stays filled in, so a delivery of 15 items is 15 times name, quantity, **Add & another**.
5. **Record stock with Received and Used.** On a material's row press **Received** when a delivery arrives, or **Used** when it goes into the work. Type the amount, add a note if you like (a delivery note number, "slab pour level 2"), and confirm. That is 3 taps. You cannot use more than is in stock: the page says how much there is. Nobody types a quantity: the stock is always the sum of what was received and used.
6. **History.** Press **History** on a material to see every change with who made it, when, how much, the note and the stock after it. The site's recent activity ("brian used 20 bags of Cement, 2h ago") is under the table. Everyone in the site can read both.
7. **Spot what is running out.** Give a material a **low-stock level** (when you add it, or in its edit form). When the stock is at or below the level the row says **Low**, or **Out** at zero, with how much is left ("5 bags left, level 10"). At the top of the site, three tiles say how many materials there are, how many are low and when the site last moved; a **Needs attention** strip names the low ones, and tapping one jumps to its row. Nothing is flagged for a material with no level: the level is how you tell the app to watch it.
8. **Find things.** Type in the search box to filter the site's materials by name, tap **Low stock** to see only what is low, and sort by name, stock (lowest first) or last updated. Search, filter and sort start over when you open another site. If a search finds nothing, **Clear search and filter** brings everything back.
9. **Owner overview.** The **Overview** link in the header lists every site you belong to, the ones with the most low stock first: how many materials, how many low, which ones, and when it last moved (a site nobody has touched for a month says so). Tap **Open dashboard** to go to that site.
10. To change a material's name, unit or low-stock level, click the pen and paper icon on its row. The stock is not in that form on purpose.
11. To delete a material, click the bin icon on its row. It goes at once and a **Deleted. Undo** message stays for 8 seconds. Click **Undo** to put it back with the same stock. The deletion and the restore both show in the history.
12. To delete a whole site, click the bin icon next to its name and type the site name to confirm. The site, its materials and their history are removed together.

Messages (saved, deleted, errors) appear at the bottom of the screen and go away by themselves. Empty pages say what to do next.

## Development

The site is static, there is no build step. `package.json` only holds the test tooling.

```
npm install              # once; installs the test tooling
npm run test:unit        # pure logic, data layer, auth and migration planning, under a few seconds, runs on every commit
npm run test:rules       # the database rules, on the Firebase emulator (needs Java 17+; first run downloads the emulator)
npm run test:e2e         # drives the pages in Chrome against an in-memory fake database and fake sign-in
npm test                 # unit and e2e
npm run test:all         # unit, rules and e2e
git config core.hooksPath .githooks   # run the unit tests before every commit
node scripts/serve.mjs --fake         # open every page at http://127.0.0.1:5173 with fake data and a fake sign-in, no account needed
node scripts/lighthouse.mjs           # Lighthouse mobile on every page: performance and accessibility must be 90 or more
python3 scripts/optimize-images.py ORIGINALS assets   # rebuild the WebP pictures within their size budgets
```

How it is laid out:

* `dashboard.js` wires the page. It talks to the database only through `src/data.js`.
* `src/data.js` and `src/auth.js` are the only files that talk to Firebase (both use the one app made in `src/firebase-app.js`, configured in `src/firebase-config.js`).
* `src/roles.js` holds who may do what on the page, and the invite email keys. `src/auth-errors.js` turns Firebase Auth errors into plain sentences.
* `login.html` and `login.js` are the sign-in, sign-up and reset page. `dashboard.js` sends anyone who is not signed in there.
* `database.rules.json` is the real access control. `tests/rules/` checks it on the emulator: who can read and write what, validation, invites, creating and deleting a site, stock movements (the quantity cannot move without a matching movement, nobody edits history), the migration and the backfill.
* `scripts/` holds the one-time migration of the old data (`docs/PHASE2-DEPLOY.md` has the steps, including the ones only the project owner can do).
* `src/logic.js` holds validation, name normalization, the dropdown lists and the cascade-delete builder, with no DOM and no Firebase.
* `src/movements.js` holds everything about stock movements with no DOM and no Firebase: checking an amount, the multi-path writes the data layer sends, the running balance and the wording of the history and the activity feed.
* `src/insights.js` holds what counts as low stock, how a list is searched, filtered and sorted, and how a site and the overview are summarised, with no DOM and no Firebase. `src/ui-insights.js` is the dashboard's summary tiles, attention strip and controls; `overview.html` and `overview.js` are the owner overview. None of it adds data: it all reads what Phase 3 already stores.
* `scripts/backfill.mjs` is the one-time Phase 3 backfill (`docs/PHASE3-DEPLOY.md` has the steps).
* `src/toast.js` shows the toast messages that replaced `alert()`. `src/icons.js` draws the few icons as inline SVG (there is no icon font).
* `vercel.json` holds the security headers every page is served with, above all a strict Content-Security-Policy: no inline script or style, scripts only from this site and Google's Firebase CDN. `scripts/serve.mjs` serves the pages with the same headers, so `tests/e2e/security.test.js` can run the policy in real Chrome. `docs/PHASE5-DEPLOY.md` has the check to do on a Vercel preview.
* `src/dialog.js` opens every form and sheet as a native `<dialog>` (focus trap, Escape, a sheet that rides above the phone keyboard). `src/ui-drawer.js` turns the sidebar into a site picker drawer at 768px and below; `styles/dialogs.css` styles the dialogs as bottom sheets on a phone and cards on a desktop. On a phone the trash can for a site is inside the drawer.
* `tests/e2e/a11y.test.js` runs axe-core on every page and dialog, on a phone and on a desktop (zero serious or critical violations; `AXE_ALL=1` also fails on moderate ones). `tests/e2e/phone.test.js` and `tests/e2e/dialogs.test.js` hold the 375px and native `<dialog>` contract.
* `tests/e2e/fake-data.js` replaces `src/data.js` during E2E tests, so the tests never touch the real database. The E2E suite fails if the page tries to reach Firebase.

What is stored (everything is under a site, so one person's sites are never downloaded with another's):

```
/sites/<siteId>                    { name, location, buildingType, createdAt, ownerUid }
/members/<siteId>/<uid>            "owner" | "storekeeper" | "viewer"
/userSites/<uid>/<siteId>          the same role, so a user can list their own sites
/memberInfo/<siteId>/<uid>         { email }, to show who is who
/materials/<siteId>/<materialId>   { name, units, quantity, minLevel?, updatedAt, lastMovementId }
/movements/<siteId>/<movementId>   { materialId, materialName, units, delta, type, byUid, byEmail, at, note? }
/userInvites/<emailKey>/<siteId>   { role, siteName, invitedBy }, read by the invited person
/siteInvites/<siteId>/<emailKey>   role, read by the owner
```

`<emailKey>` is the email in lower case with each `.` written as `,` (keys cannot contain dots). The browser also keeps two small things in `localStorage`: the last opened site and the material names you typed before (for suggestions). Nothing breaks if `localStorage` is blocked.

The E2E tests use the system Chrome at `/usr/bin/google-chrome`. Set `CHROME_PATH` to use another one.

## Contributing

A huge shout out to my guy @willykar for the Javascript code and advise especially in utilising Firebase as a beginner friendly database.

## Licensing

MIT License:
Do whatever you like with the code, I embrace open-source as a way for the community to benefit at large. A shout-out too will be appreciated for the sleepless nights coming up with it.
