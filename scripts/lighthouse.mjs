#!/usr/bin/env node
// Plan.md Phase 5, "Done when": a Lighthouse mobile run scores 90 or more on performance and accessibility,
// on every page. This runs it: it serves the site with the security headers and the fake data layer (so the
// signed-in pages can be audited with no account), runs Lighthouse's mobile preset on each page, prints a table
// and exits 1 if any page is below the bar.
//
//   node scripts/lighthouse.mjs            # all pages
//   node scripts/lighthouse.mjs index.html # one page
//
// Lighthouse is fetched on demand (npx, pinned), not added to package.json. Needs Chrome: set CHROME_PATH
// if it is not /usr/bin/google-chrome.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "./serve.mjs";

const LIGHTHOUSE = "lighthouse@12.2.1";
const BAR = 90;
const GATED = ["performance", "accessibility"];
const PAGES = ["index.html", "about-us.html", "login.html", "dashboard.html?site=sA", "overview.html"];

const only = process.argv.slice(2);
const pages = only.length > 0 ? only : PAGES;
const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const server = await createServer({ fake: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailit-lighthouse-"));

const rows = [];
for (const page of pages) {
    const file = path.join(outDir, `${page.replace(/[^a-z0-9]+/gi, "-")}.json`);
    // Async, not spawnSync: this process is also the web server Lighthouse is loading the page from.
    const run = await new Promise((resolve) => {
        const child = spawn("npx", [
            "--yes", LIGHTHOUSE, `${base}/${page}`,
            "--only-categories=performance,accessibility,best-practices",
            `--chrome-path=${chrome}`, "--chrome-flags=--headless=new --no-sandbox",
            "--form-factor=mobile", "--output=json", `--output-path=${file}`, "--quiet",
        ]);
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => child.kill(), 240_000);
        child.on("close", (status) => { clearTimeout(timer); resolve({ status, stderr }); });
    });
    if (run.status !== 0 || !fs.existsSync(file)) {
        console.error(`Lighthouse failed on ${page}: ${run.stderr || run.error}`);
        rows.push({ page, failed: true });
        continue;
    }
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    const score = (id) => Math.round(report.categories[id].score * 100);
    rows.push({
        page,
        performance: score("performance"),
        accessibility: score("accessibility"),
        bestPractices: score("best-practices"),
        lcp: Math.round(report.audits["largest-contentful-paint"].numericValue),
        cls: Number(report.audits["cumulative-layout-shift"].numericValue.toFixed(3)),
        tbt: Math.round(report.audits["total-blocking-time"].numericValue),
    });
}
server.close();

console.log("\nLighthouse, mobile preset (the bar is 90 for performance and accessibility)\n");
console.log("page".padEnd(26), "perf", "a11y", "best", "LCP ms", "CLS", "TBT ms");
for (const row of rows) {
    if (row.failed) {
        console.log(row.page.padEnd(26), "FAILED TO RUN");
        continue;
    }
    console.log(row.page.padEnd(26), String(row.performance).padEnd(4), String(row.accessibility).padEnd(4), String(row.bestPractices).padEnd(4), String(row.lcp).padEnd(6), String(row.cls).padEnd(5), row.tbt);
}
const below = rows.filter((row) => row.failed || GATED.some((key) => row[key] < BAR));
if (below.length > 0) {
    console.error(`\nBelow ${BAR}: ${below.map((row) => row.page).join(", ")}`);
    process.exit(1);
}
console.log(`\nAll pages are at ${BAR} or above.`);
process.exit(0);
