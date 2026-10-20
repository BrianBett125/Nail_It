// Phase 5: what every page has to be, read straight from the files: a phone-ready, accessible shell with
// nothing left over from before (the icon-font kit, a font that is never loaded, scripts that block rendering).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { icon, ICON_NAMES } from "../../src/icons.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PAGES = ["index.html", "about-us.html", "login.html", "dashboard.html", "overview.html"];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
// What a browser sees: a commented-out tag is not a tag.
const markup = (file) => read(file).replace(/<!--[\s\S]*?-->/g, "");

for (const page of PAGES) {
    test(`${page}: language, title, phone viewport, one main landmark and one h1`, () => {
        const html = markup(page);
        assert.match(html, /<html lang="en">/);
        assert.match(html, /<title>[^<]{3,}<\/title>/);
        assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1(\.0)?">/);
        assert.equal((html.match(/<main\b/g) || []).length, 1, "exactly one <main>");
        assert.equal((html.match(/<h1\b/g) || []).length, 1, "exactly one <h1>");
    });

    test(`${page}: no icon-font kit, no inline script or style, and no script that blocks rendering`, () => {
        const html = markup(page);
        assert.doesNotMatch(html, /fontawesome|font-awesome|class="fa[ s-]/i);
        assert.doesNotMatch(html, /<style\b|\sstyle="|\sonclick=|<script>[^<]/i);
        for (const tag of html.match(/<script\b[^>]*>/g) || []) {
            assert.ok(/type="module"/.test(tag) || /\bdefer\b/.test(tag), `a script that blocks rendering: ${tag}`);
        }
    });

    test(`${page}: every link that opens a new tab is noopener noreferrer`, () => {
        for (const tag of markup(page).match(/<a\b[^>]*target="_blank"[^>]*>/g) || []) {
            assert.match(tag, /rel="[^"]*noopener[^"]*noreferrer[^"]*"/, tag);
        }
    });

    test(`${page}: every image has alt text and a size`, () => {
        for (const tag of markup(page).match(/<img\b[^>]*>/g) || []) {
            assert.match(tag, /\balt="/, tag);
            assert.match(tag, /\bwidth="\d+"/, tag);
            assert.match(tag, /\bheight="\d+"/, tag);
        }
    });
}

test("no stylesheet or script names a font that is never loaded", () => {
    for (const file of fs.readdirSync(path.join(ROOT, "styles"))) {
        assert.doesNotMatch(read(`styles/${file}`), /Poppins|Font Awesome|FontAwesome/, file);
    }
    assert.doesNotMatch(read("dashboard.js") + read("overview.js"), /fa-|fas |fa-solid|fa-regular/);
});

test("every stylesheet and script a page names exists", () => {
    for (const page of PAGES) {
        for (const match of read(page).matchAll(/(?:href|src)="((?:styles|favicon|src|assets)\/[^"]+|[A-Za-z-]+\.js)"/g)) {
            assert.ok(fs.existsSync(path.join(ROOT, match[1])), `${page} names ${match[1]}, which does not exist`);
        }
    }
});

// ---- the inline icons --------------------------------------------------------------------

// A tiny stand-in for the DOM: enough for src/icons.js, which only creates elements and sets attributes.
function fakeDocument() {
    const make = (name) => {
        const node = { name, attrs: {}, children: [] };
        node.setAttribute = (key, value) => { node.attrs[key] = String(value); };
        node.appendChild = (child) => { node.children.push(child); return child; };
        return node;
    };
    return { createElementNS: (ns, name) => ({ ...make(name), ns }) };
}

test("each icon is an inline SVG that is decoration, takes the text colour, and is built without innerHTML", () => {
    globalThis.document = fakeDocument();
    try {
        assert.deepEqual(ICON_NAMES.sort(), ["pen", "trash"]);
        for (const name of ICON_NAMES) {
            const svg = icon(name);
            assert.equal(svg.name, "svg");
            assert.equal(svg.ns, "http://www.w3.org/2000/svg");
            assert.equal(svg.attrs["aria-hidden"], "true");
            assert.equal(svg.attrs.focusable, "false");
            assert.equal(svg.attrs.stroke, "currentColor");
            assert.equal(svg.attrs.viewBox, "0 0 24 24");
            assert.ok(svg.children.length >= 2 && svg.children.every((c) => c.name === "path" && /^M/.test(c.attrs.d)));
        }
        assert.throws(() => icon("fire"), /Unknown icon/);
    } finally {
        delete globalThis.document;
    }
});

test("the icons source never uses innerHTML", () => {
    const code = read("src/icons.js").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /innerHTML/);
});
