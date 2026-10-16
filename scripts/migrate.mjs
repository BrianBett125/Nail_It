#!/usr/bin/env node
// One-time move of the live data to the Phase 2 layout. READ docs/PHASE2-DEPLOY.md first.
//
//   NAILIT_EMAIL=you@example.com NAILIT_PASSWORD=... \
//   NAILIT_SOURCE_DB_URL=https://OLD-PROJECT-default-rtdb.REGION.firebasedatabase.app \
//   node scripts/migrate.mjs [--apply]
//
// Without --apply it is a dry run and writes nothing. The password comes from the environment,
// never from the command line (it would land in the shell history and in `ps`). The account must
// already exist in the NEW project (Firebase console > Authentication > Add user), and it becomes
// the owner of every site that is copied.
//
// Copy mode (NAILIT_SOURCE_DB_URL set): the old database is read over its public URL, which only
// works while its rules are still open, and everything is written to the project in
// src/firebase-config.js, which must already have database.rules.json deployed. The old database
// is only ever read.
//
// In place (no NAILIT_SOURCE_DB_URL): migrates the project in src/firebase-config.js itself. Run
// it BEFORE the new rules are deployed: they do not allow reading the old flat layout.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, get, update, serverTimestamp, increment } from "firebase/database";
import { firebaseConfig, isConfigured } from "../src/firebase-config.js";
import { runMigration } from "./migrate-lib.js";

const apply = process.argv.includes("--apply");
const email = process.env.NAILIT_EMAIL;
const password = process.env.NAILIT_PASSWORD;
const outDir = process.env.NAILIT_OUT_DIR || "/tmp/nailit-migration";
const sourceUrl = (process.env.NAILIT_SOURCE_DB_URL || "").replace(/\/+$/, "");

// The old database answered anyone without a login, so a plain GET reads it. That also means a
// refusal here is meaningful: the old rules have been closed.
async function readOldDatabase() {
    const read = async (node) => {
        const response = await fetch(`${sourceUrl}/${node}.json`);
        if (!response.ok) {
            throw new Error(`could not read ${sourceUrl}/${node}.json (HTTP ${response.status}). The old database may already be locked.`);
        }
        return response.json();
    };
    return { sites: await read("sites"), materials: await read("materials") };
}

if (!isConfigured()) {
    console.error("src/firebase-config.js still has the placeholder apiKey. Fill it in first.");
    process.exit(1);
}
if (!email || !password) {
    console.error("Set NAILIT_EMAIL and NAILIT_PASSWORD in the environment.");
    process.exit(1);
}

const app = initializeApp(firebaseConfig);
try {
    const { user } = await signInWithEmailAndPassword(getAuth(app), email, password);
    console.log(`Signed in as ${user.email} (uid ${user.uid}).`);
    console.log(`Follow the log:  tail -f ${outDir}/progress.log`);
    const result = await runMigration({
        db: getDatabase(app),
        ref,
        get,
        update,
        sv: { timestamp: serverTimestamp, increment },
        user: { uid: user.uid, email: user.email },
        apply,
        outDir,
        readSource: sourceUrl ? readOldDatabase : null,
    });
    process.exitCode = result.applied && !result.verified ? 2 : 0;
} catch (error) {
    console.error(`Migration stopped: ${error.code || ""} ${error.message}`);
    process.exitCode = 1;
}
process.exit(process.exitCode);
