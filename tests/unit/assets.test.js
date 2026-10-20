// Phase 5: the pictures. Nothing unreferenced, nothing missing, every file inside its weight budget, and the
// home page under the 250 KB image weight Plan.md asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const kb = (file) => fs.statSync(path.join(ROOT, file)).size / 1024;

const PAGES = ["index.html", "about-us.html", "login.html", "dashboard.html", "overview.html"];
const STYLES = fs.readdirSync(path.join(ROOT, "styles")).map((f) => `styles/${f}`);
const SOURCES = [...PAGES, ...STYLES];

// The files assets/ may hold, with the most each may weigh (KB). Plan.md: hero 200 or less, backgrounds 150 or less.
const BUDGET = {
    "sparks-1600.webp": 200,
    "sparks-800.webp": 80,
    "hammer-900.webp": 150,
    "architecture-1600.webp": 150,
    "architecture-800.webp": 70,
    "database.webp": 40,
    "stock.webp": 40,
    "storage.webp": 40,
};

const assetFiles = fs.readdirSync(path.join(ROOT, "assets"));

// Every assets/<file> a page or a stylesheet mentions.
function referenced() {
    const found = new Map(); // file -> [where]
    for (const source of SOURCES) {
        for (const match of read(source).matchAll(/assets\/([A-Za-z0-9_.-]+)/g)) {
            found.set(match[1], [...(found.get(match[1]) || []), source]);
        }
    }
    return found;
}

test("every file in assets/ is used by a page or a stylesheet, and is one we have a budget for", () => {
    const used = referenced();
    for (const file of assetFiles) {
        assert.ok(used.has(file), `assets/${file} is not used anywhere: delete it`);
        assert.ok(file in BUDGET, `assets/${file} has no weight budget in tests/unit/assets.test.js`);
    }
});

test("every picture a page or a stylesheet points at exists", () => {
    for (const [file, where] of referenced()) {
        assert.ok(assetFiles.includes(file), `assets/${file} is missing (used by ${where.join(", ")})`);
    }
});

test("every picture is inside its weight budget", () => {
    for (const file of assetFiles) {
        assert.ok(kb(`assets/${file}`) <= BUDGET[file], `assets/${file} is ${kb(`assets/${file}`).toFixed(0)} KB, budget ${BUDGET[file]} KB`);
    }
});

test("only WebP pictures: no jpg or png is left, and no file name has a typo", () => {
    assert.deepEqual(assetFiles.filter((f) => !f.endsWith(".webp")), []);
    assert.deepEqual(assetFiles.filter((f) => /architechture/.test(f)), []);
});

test("the home page loads under 250 KB of pictures, on a phone and on a desktop", () => {
    const home = read("index.html") + read("styles/index.css");
    const files = [...home.matchAll(/assets\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
    const features = [...new Set(files.filter((f) => ["database.webp", "stock.webp", "storage.webp"].includes(f)))];
    const desktop = kb("assets/sparks-1600.webp") + features.reduce((sum, f) => sum + kb(`assets/${f}`), 0);
    const phone = kb("assets/sparks-800.webp") + features.reduce((sum, f) => sum + kb(`assets/${f}`), 0);
    assert.ok(desktop < 250, `desktop ${desktop.toFixed(0)} KB`);
    assert.ok(phone < desktop && phone < 250, `phone ${phone.toFixed(0)} KB`);
});

test("phones get the smaller background where a page uses a big one", () => {
    for (const [css, small] of [["styles/index.css", "sparks-800.webp"], ["styles/login.css", "sparks-800.webp"], ["styles/about-us.css", "architecture-800.webp"]]) {
        const text = read(css);
        assert.match(text, new RegExp(`@media \\(max-width: 768px\\)[^}]*${small.replace(".", "\\.")}`), `${css} has no phone background`);
    }
});

test("pictures that sit in the page say how big they are, so the page does not jump while they load", () => {
    const html = read("index.html");
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(images.length >= 3);
    for (const image of images) {
        assert.match(image, /\bwidth="\d+"/, image);
        assert.match(image, /\bheight="\d+"/, image);
        assert.match(image, /\balt="[^"]+"/, image);
    }
});
