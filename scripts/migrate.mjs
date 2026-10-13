#!/usr/bin/env node
// One-time migration of the live database to the Phase 2 layout. READ docs/PHASE2-DEPLOY.md first.
//
//   NAILIT_EMAIL=you@example.com NAILIT_PASSWORD=... node scripts/migrate.mjs           # dry run
//   NAILIT_EMAIL=you@example.com NAILIT_PASSWORD=... node scripts/migrate.mjs --apply   # writes
//
// The password comes from the environment, never from the command line (it would land in the
// shell history and in `ps`). The account must already exist (Firebase console > Authentication >
// Add user). It becomes the owner of every existing site.
//
// Run it BEFORE database.rules.json is deployed: the new rules do not allow anyone to read the
// old flat layout, which is exactly what this script reads.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, get, update } from "firebase/database";
import { firebaseConfig, isConfigured } from "../src/firebase-config.js";
import { runMigration } from "./migrate-lib.js";

const apply = process.argv.includes("--apply");
const email = process.env.NAILIT_EMAIL;
const password = process.env.NAILIT_PASSWORD;
const outDir = process.env.NAILIT_OUT_DIR || "/tmp/nailit-migration";

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
        user: { uid: user.uid, email: user.email },
        apply,
        outDir,
    });
    process.exitCode = result.applied && !result.verified ? 2 : 0;
} catch (error) {
    console.error(`Migration stopped: ${error.code || ""} ${error.message}`);
    process.exitCode = 1;
}
process.exit(process.exitCode);
