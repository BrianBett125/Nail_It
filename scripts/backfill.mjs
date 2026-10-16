#!/usr/bin/env node
// One-time Phase 3 backfill: gives every material that has stock but no history one "opening"
// movement, so quantity = sum of movements holds for the records entered before movements.
// READ docs/PHASE3-DEPLOY.md first.
//
//   NAILIT_EMAIL=you@example.com NAILIT_PASSWORD=... node scripts/backfill.mjs [--apply]
//
// Without --apply it is a dry run and writes nothing. The password comes from the environment,
// never from the command line (it would land in the shell history and in `ps`). It handles the
// sites the signed-in account can write to (owner or storekeeper), against the project in
// src/firebase-config.js, which must already have the Phase 3 database.rules.json deployed.
// Safe to run twice: a material that already has a movement is skipped.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, get, update, push, serverTimestamp, increment } from "firebase/database";
import { firebaseConfig, isConfigured } from "../src/firebase-config.js";
import { runBackfill } from "./backfill-lib.js";

const apply = process.argv.includes("--apply");
const email = process.env.NAILIT_EMAIL;
const password = process.env.NAILIT_PASSWORD;
const outDir = process.env.NAILIT_OUT_DIR || "/tmp/nailit-backfill";

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
    const result = await runBackfill({
        db: getDatabase(app),
        ref,
        get,
        update,
        push,
        sv: { timestamp: serverTimestamp, increment },
        user: { uid: user.uid, email: user.email },
        apply,
        outDir,
    });
    process.exitCode = result.applied && !result.verified ? 2 : 0;
} catch (error) {
    console.error(`Backfill stopped: ${error.code || ""} ${error.message}`);
    process.exitCode = 1;
}
process.exit(process.exitCode);
