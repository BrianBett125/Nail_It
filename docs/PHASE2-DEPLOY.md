# Phase 2 deployment: accounts, roles and locked-down data

This is the order of steps to put Phase 2 live without downtime and without losing data. Steps marked **you** need your Firebase console, your Vercel account or your password, so nothing here is run for you. The migration script and the rules were tested on the Firebase emulator with realistic old-format data (`npm run test:rules`). The `firebase deploy`, `curl` and console steps could not be run without your project, so they are written from the Firebase documentation and are untested.

**Do not merge the Phase 2 pull request before step 5.** The new dashboard sends everyone who is not signed in to the login page, and sign-in does not work until steps 1 and 2 are done.

## What changes

| Before | After |
|---|---|
| Anyone with the URL can read and write everything | Nobody can read or write without signing in |
| `/materials/<id>` with a `siteId` field | `/materials/<siteId>/<id>`, readable only by members of that site |
| No users | Email and password accounts. Each site has an owner, and the owner can invite storekeepers and viewers |

## Steps

### 1. Firebase console (you)

1. **Authentication > Sign-in method:** turn on **Email/Password**.
2. **Authentication > Settings > Authorized domains:** make sure your Vercel domain is in the list (password reset and verification links need it).
3. **Project settings > General > Your apps > Web app:** copy the `apiKey`. This key is public by design (it names the project, the rules protect the data). Put it in `src/firebase-config.js` in place of `REPLACE_WITH_WEB_API_KEY` and commit it on the Phase 2 branch. If there is no web app yet, add one.
4. **Authentication > Users > Add user:** create your own account (email and a password). It becomes the owner of every existing site.
5. **Realtime Database > Data > Export JSON.** Keep the file. This is a second rollback copy on top of the snapshot the migration script saves.

### 2. Dry run the migration (you)

```
npm install
NAILIT_EMAIL=you@example.com NAILIT_PASSWORD='your password' node scripts/migrate.mjs
tail -f /tmp/nailit-migration/progress.log     # in a second terminal, to follow it
```

It reads the database, saves a snapshot to `/tmp/nailit-migration/snapshot-<time>.json`, and writes `/tmp/nailit-migration/report-<time>.csv`. **It writes nothing to the database.** Open the CSV (it opens in Excel) and read it:

* `migrate` / `copy`: what will be moved, with every field that is being repaired (`before` and `after` columns).
* `skipped`: things that cannot be migrated cleanly. They are **not guessed at**: a negative quantity, a material whose site was deleted, a material with no name. They stay where they are. Fix them by hand afterwards if they matter.
* `junk`: leftovers of the old double-click bug (a node with no `siteId`, for example `materials/[object PointerEvent]`). Safe to delete in the console later.

Stop here if anything in the report surprises you.

### 3. Apply the migration (you)

```
NAILIT_EMAIL=you@example.com NAILIT_PASSWORD='your password' node scripts/migrate.mjs --apply
```

It writes one update per site, so a site and its materials move together or not at all, and then reads everything back. The last line must say `VERIFIED: all N written paths read back exactly as planned.` If it says `NOT VERIFIED`, stop and send me the log.

The migration is **additive**: the old flat `/materials/<id>` nodes are left in place, and each site keeps its id. The current live app (Phase 1) keeps working exactly as before. Running it again changes nothing, and never overwrites an edit made in the new app.

Run this **before** the new rules are deployed: the new rules do not let anyone read the old flat layout, which is what the script reads.

### 4. Check the new build in a preview (you)

Open the Vercel preview of the Phase 2 pull request. Sign in with the account from step 1. You should see all your sites and their materials, with `Your role: Owner`. Add a material, then delete it and press Undo. Nothing is locked down yet at this point, so a problem here costs nothing.

### 5. Merge the pull request (you)

Merging deploys the new dashboard to production. It works with the migrated data and the still-open rules, so there is no gap.

### 6. Deploy the rules (you)

```
npx firebase login                      # once
npx firebase deploy --only database --project nail-it-8f766
```

This is the step that closes the database. From this moment the old pages (any tab still open on the old version) get permission errors, and the new app works for signed-in members only.

### 7. Prove it is locked (you)

Both of these must be refused:

```
curl -s https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/sites.json
curl -s https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/materials.json
```

Expected output for each: an error that says `Permission denied` (and no data). That is the measurable result of this phase: unauthenticated reads went from allowed to refused.

Then open the site in a private window: it must send you to the login page.

### 8. Clean up (you, optional)

In the console, delete the old flat nodes listed as `junk` or copied in the report: `/materials/<old id>` for every old material, and the junk keys. They are unreadable by everyone now and harmless, so this can wait.

## Rolling back

* **The app misbehaves after step 5, before step 6:** revert the merge on GitHub. The old app still works because the old data is untouched. Anything entered in the new app in the meantime lives only in the new layout and will not show in the old app.
* **Locked out after step 6:** deploy the old open rules again (`{"rules": {".read": true, ".write": true}}` in `database.rules.json`, then the deploy command above), or paste them in the console's Rules tab. Data is not affected by rules.
* **Data damaged:** restore the console export from step 1.5, or the snapshot file from step 3 (it is the exact content of `/sites` and `/materials` before the migration).

## After it is live

* **Inviting people:** the owner opens a site, clicks **Members**, enters an email and a role. **Nothing is emailed from the app.** The owner tells that person to sign up (or sign in) with that exact email, open the verification email Firebase sends, and click **Accept** under Invitations. An invitation can only be accepted by an account whose email is verified.
* **Roles:** Owner (everything, one per site), Storekeeper (add, edit and delete materials), Viewer (read only). The database enforces this, the page only hides what would be refused.
* **Rules:** change `database.rules.json` only together with `tests/rules/`, and run `npm run test:rules` before deploying (needs Java 17 or newer; the first run downloads the emulator).
