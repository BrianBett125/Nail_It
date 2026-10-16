# Phase 3 deployment: stock movements

Stock stops being a number people type and becomes the sum of what was received and used. This changes the database rules, so the order of the steps matters. The rules, the backfill script and the app were tested on the Firebase emulator and in Chrome against an in-memory database (`npm run test:all`). The console, `node scripts/backfill.mjs` against the real project, and the Vercel steps need your accounts and were **not** run.

## What changes

| Before | After |
|---|---|
| The quantity is typed in the Edit form | The quantity changes only by **Received (+)** and **Used (-)**, each a recorded movement |
| "Last Updated" is a date someone types | It is the server's time, set by the database |
| No history | Every change has who, when, how much and an optional note; each material has a history with a running balance; the site has an activity feed |
| The database accepts any quantity | The rules refuse a quantity that no movement explains, a movement that does not match the quantity change, and a stock below zero |
| Edit changes name, quantity, unit, date | Edit changes name, unit and the low-stock level. Quantity is not in it |

New data under each site: `/movements/<siteId>/<movementId>`. Existing materials get a `lastMovementId` and `updatedAt` the first time they move. Nothing is renamed or removed; old records keep their typed `lastUpdated` and show it until they move.

## The order (you)

Both the old app and the new app need the matching rules, so do steps 3 and 4 within a minute of each other.

1. **Export the database.** Firebase console > Realtime Database > the three dots menu > **Export JSON**. Keep the file. This is the rollback for everything below.
2. **Dry run the backfill.** It reads, saves its own snapshot to `/tmp/nailit-backfill/snapshot-<time>.json`, writes a CSV, and writes nothing to the database:
   ```
   npm install
   NAILIT_EMAIL='you@example.com' NAILIT_PASSWORD='your password' node scripts/backfill.mjs
   ```
   (Follow it with `tail -f /tmp/nailit-backfill/progress.log`.) Open `/tmp/nailit-backfill/report-<time>.csv`: one line per material, `backfill` for the ones that have stock and no history, `skip` with the reason for the rest. This dry run works on the **old** rules too, because it only reads. Skip to step 3 if you like; the real run is step 5.
3. **Publish the rules.** Realtime Database > Rules tab > paste the whole content of `database.rules.json` > **Publish**.
4. **Merge the Phase 3 pull request.** Vercel deploys the app.
5. **Run the backfill for real**, right after step 4 and before anyone records stock:
   ```
   NAILIT_EMAIL='you@example.com' NAILIT_PASSWORD='your password' node scripts/backfill.mjs --apply
   ```
   Each material that has stock gets one `opening` movement for exactly that stock, so its history starts complete. The last line must say `VERIFIED: N materials kept their quantity and now equal the sum of their movements.` If it says `NOT VERIFIED`, stop and send the log. It is safe to run again (a material with a movement is skipped) and it never changes a quantity.
   Run it as the owner of the sites. It handles the sites the account can write to (owner or storekeeper) and skips the rest, so each owner runs it for their own sites.
6. **Check in the app.** Open a site, press **Received** on a material, enter 1, confirm: the stock goes up by 1, **History** shows the opening balance and the new line with the right running balance, and the site's activity feed shows it. Press **Used** and enter more than is in stock: it must be refused with the message.

If someone records a movement on an old material **before** step 5, the backfill skips that material (the rules close the backfill once a movement exists) and its history shows a line "Before history" with the stock no movement explains. The quantity is still right. Nothing else is affected.

## What to expect between steps 3 and 4

* The old app (Phase 2) cannot add a material with stock or change a quantity once the rules are published: the database refuses it and the page shows an error toast. Everything else works.
* The new app against the old rules shows an error on every Received, Used and new material with stock. Nothing is written.

Both are harmless and last until the other step is done.

## Rollback

* **The app only:** revert the merge on GitHub. The Phase 2 app works with the Phase 3 rules for everything except adding a material with stock and typing a new quantity.
* **The rules:** paste the Phase 2 `database.rules.json` (from the merged Phase 2 commit) and publish. The movements stay in the database and are ignored by the Phase 2 app.
* **The data:** import the export from step 1.

## Measuring it

The success measures in `Plan.md` move like this:

| Measure | How to see it |
|---|---|
| Quantity matches the sum of movements: always | The backfill's last line (`VERIFIED`), and `tests/rules/movements.test.js` ("the promise" test) |
| Taps to record "20 bags of cement used" | 3: **Used**, type 20, **Record** (`tests/e2e/movements.test.js`) |
| Every change shows who and when | **History** on any material; the activity feed on the site |
