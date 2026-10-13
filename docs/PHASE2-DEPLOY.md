# Phase 2 deployment: new Firebase project, accounts, roles, locked-down data

The app moves to a **new Firebase project** (`nail-it-6b883`). The old project (`nail-it-8f766`) has no sign-in and open rules: anyone on the internet can read and write it. Its data (sites and materials) is **copied** into the new project, as your own account, under the new rules. The old project is only ever read, so the live Phase 1 app keeps working until the switch.

The migration script and the rules were tested on the Firebase emulator with realistic old-format data, including the copy into an empty project with the rules active (`npm run test:rules`). The console, `curl` and Vercel steps could not be run without your accounts, so they are written from the Firebase documentation and are untested.

**Do not merge the Phase 2 pull request before step 7.** Until then the live site keeps using the old project, which is what you want.

## What changes

| Before | After |
|---|---|
| Anyone with the URL can read and write everything | Nobody can read or write without signing in |
| `/materials/<id>` with a `siteId` field | `/materials/<siteId>/<id>`, readable only by members of that site |
| No users | Email and password accounts. Each site has an owner, who can invite storekeepers and viewers |
| Project `nail-it-8f766` | Project `nail-it-6b883` |

## Steps

### 1. Set up the new project in the Firebase console (you)

Sign in at https://console.firebase.google.com with the account that owns `nail-it-6b883`, and open that project.

1. **Build > Realtime Database > Create Database.** Pick a location (`europe-west1` is the closest of the three choices to East Africa; `asia-southeast1` is what the old one used). Choose **Start in locked mode**. When it is created, copy the database URL shown at the top of the **Data** tab. It looks like `https://nail-it-6b883-default-rtdb.<region>.firebasedatabase.app`, or `https://nail-it-6b883-default-rtdb.firebaseio.com` for `us-central1`.
2. **Realtime Database > Rules tab:** delete what is there, paste the whole content of `database.rules.json` from this repository, and click **Publish**. The import in step 4 only works once these rules are live.
3. **Build > Authentication > Get started > Sign-in method > Email/Password:** switch the first toggle on, leave "Email link" off, **Save**.
4. **Authentication > Settings > Authorized domains:** add `nail-it-brianbett125s-projects.vercel.app` (and any custom domain). Password-reset and verification links need it.
5. **Project settings (gear icon) > General > Your apps:** if there is no web app, click the `</>` icon, name it "Nail It", and register it. Copy the `apiKey` (starts with `AIza`; it is public by design).
6. **Authentication > Users > Add user:** create your own account with the email you want to own the sites, and a password. Keep the password to yourself.

### 2. Put the project's settings in the code

In `src/firebase-config.js`: `apiKey`, `authDomain` (`nail-it-6b883.firebaseapp.com`), `databaseURL` (from step 1.1) and `projectId` (`nail-it-6b883`). Commit it on the Phase 2 branch. (Ask Claude to do it: it only needs the `apiKey` and the database URL.)

### 3. Dry run the copy (you)

```
npm install
NAILIT_EMAIL='you@example.com' NAILIT_PASSWORD='your password' \
NAILIT_SOURCE_DB_URL='https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app' \
node scripts/migrate.mjs
```

(Follow it with `tail -f /tmp/nailit-migration/progress.log` in a second terminal.) It reads the old database, saves a snapshot of it to `/tmp/nailit-migration/snapshot-<time>.json`, and writes `/tmp/nailit-migration/report-<time>.csv`. **It writes nothing.** Open the CSV (it opens in Excel):

* `migrate` / `copy`: what will be copied, with every field that is being repaired (`before` and `after` columns).
* `skipped`: things that cannot be copied cleanly (a negative quantity, a material whose site was deleted, a material with no name). They are **not guessed at**. They stay in the old project; fix them by hand if they matter.
* `junk`: leftovers of the old double-click bug (a node with no `siteId`). Not copied.

At the time of writing the old database has 3 sites and 7 materials, all well formed.

### 4. Apply the copy (you)

Run the same command with `--apply` added at the end. It creates each site and its owner entries (one update, which the rules need), then its materials (a second update), and finally reads everything back. The last line must say `VERIFIED: all N written paths read back exactly as planned.` If it says `NOT VERIFIED`, stop and send the log. It is safe to run again: it copies only what is new and never overwrites an edit made in the new project.

### 5. Check the preview (you)

Open the Vercel preview of the Phase 2 pull request, sign in with the account from step 1.6. You should see your 3 sites and 7 materials with `Your role: Owner`. Add a material, delete it, press Undo. This runs against the **new** project only; the live site is untouched.

### 6. Invite people (optional, you)

Open a site, **Members**, enter an email and a role. Nothing is emailed from the app: tell them to sign up with that email, verify it, and press **Accept** under Invitations.

### 7. Switch over (you)

1. Run the copy once more (step 4) to pick up anything entered in the live app since step 4. It only adds what is new.
2. Merge the pull request. Vercel deploys, and from that moment the live site uses the new project.
3. Prove the new database is locked. Both commands must return an error saying `Permission denied`, and no data (use the URL from step 1.1):
   ```
   curl -s <databaseURL>/sites.json
   curl -s <databaseURL>/materials.json
   ```
   Then open the site in a private window: it must send you to the login page.

### 8. Close the old project (you)

The old database is still open to the world. After step 7, lock or delete it:

* **Quickest:** in the old project's console, **Realtime Database > Rules**, replace the rules with `{ "rules": { ".read": false, ".write": false } }` and **Publish**. Check that `curl -s https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/sites.json` now says `Permission denied`.
* **Or** delete the old project from its **Project settings** once you have kept the snapshot file from step 4 and are sure nothing else uses it.

If you cannot sign in to the old project (you do not remember which Google account made it), you can still do the first thing later: find it under the other Google accounts you own at https://console.firebase.google.com, or leave it. Until it is locked its data stays public.

## Rolling back

* **Anything looks wrong before step 7.2:** do nothing. The live site is still on the old project and still works.
* **After step 7.2, the new app misbehaves:** revert the merge on GitHub. The live site returns to the old project. Anything entered in the new app in the meantime lives only in the new project.
* **Data damaged in the new project:** the snapshot from step 4 holds the old data exactly; run the copy again into a fresh database.

## After it is live

* **Roles:** Owner (everything, one per site), Storekeeper (add, edit and delete materials), Viewer (read only). The database enforces this; the page only hides what would be refused.
* **Rules:** change `database.rules.json` only together with `tests/rules/`, and run `npm run test:rules` before publishing it (needs Java 17 or newer; the first run downloads the emulator).
