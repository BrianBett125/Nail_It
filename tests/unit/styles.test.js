// The design system's own gate: what styles/tokens.css promises, checked against every other
// stylesheet. The refresh this guards against is a real one: the app used to run two palettes and
// four type systems, and it drifted there one stylesheet at a time with nothing to stop it.
//
// Read straight from the files, no browser needed. Each of these is a same-input-same-output check,
// so it is a gate test and runs on every commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STYLES = path.join(ROOT, "styles");
const TOKENS = "tokens.css";
const files = fs.readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const read = (file) => fs.readFileSync(path.join(STYLES, file), "utf8");

test("tokens.css is the only place a colour is written down", () => {
    // A page stylesheet gets its colour from a token or it does not get one. This is the rule that
    // keeps a button in a dialog and a button in a card from becoming two different buttons.
    const hex = /#[0-9a-fA-F]{3,8}\b/;
    const fn = /\b(?:rgba?|hsla?)\s*\(/;
    // The trailing guard is load-bearing: white-space, grayscale and blacklist are not colours.
    const keyword = /(?:^|[\s:,(])(?:white|black|silver|gray|grey|maroon|navy|teal|olive)(?![\w-])/i;
    for (const file of files) {
        if (file === TOKENS) continue;
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
        assert.doesNotMatch(css, hex, `${file} writes a raw hex colour`);
        assert.doesNotMatch(css, fn, `${file} writes a raw rgb/hsl colour`);
        assert.doesNotMatch(css, keyword, `${file} writes a raw colour keyword`);
    }
});

test("tokens.css is the first stylesheet every page loads", () => {
    // Load order is what makes the rest work: a page that loads a token file second still gets the
    // right values, but a page that forgets it renders with every variable undefined.
    for (const page of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
        const links = [...fs.readFileSync(path.join(ROOT, page), "utf8")
            .matchAll(/<link[^>]+href="styles\/([^"]+)"/g)].map((m) => m[1]);
        assert.equal(links[0], TOKENS, `${page} loads ${links[0]} before ${TOKENS}`);
    }
});

test("every custom property the stylesheets read is declared", () => {
    // An undefined token makes the whole declaration invalid, so it is dropped in silence: the page
    // renders without that border or background and nothing anywhere reports it. --accent is the
    // one that is declared on purpose outside tokens.css (on .sheet, so the movement sheet can
    // carry its own accent), which is why this reads every file rather than only the token file.
    const declared = new Set();
    for (const file of files) {
        for (const match of read(file).matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
            declared.add(match[1]);
        }
    }
    for (const file of files) {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
            const [, name, next] = match;
            // A fallback is a deliberate answer for a property that is legitimately absent
            // (--vh comes from the script that measures the phone viewport).
            if (next === ",") continue;
            assert.ok(declared.has(name), `${file} reads ${name}, which no stylesheet declares`);
        }
    }
});

test("nothing transitions or animates for longer than the motion budget", () => {
    // tokens.css states the rule: motion is decoration and 200ms is the ceiling. A highlight that
    // is meant to stay put is a state, not motion, so it belongs on a class the script adds and
    // removes, never on a CSS duration.
    const durations = /(\d+(?:\.\d+)?)(ms|s)\b/g;
    for (const file of files) {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of css.matchAll(/(?:^|[\s;{])(transition|animation)\s*:\s*([^;}]+)/g)) {
            const [, prop, value] = match;
            for (const time of value.matchAll(durations)) {
                const ms = Number(time[1]) * (time[2] === "s" ? 1000 : 1);
                assert.ok(ms <= 200, `${file} has ${prop}: ${value.trim()} (${ms}ms)`);
            }
        }
    }
});

// Every px value in a spacing declaration that sits outside any parentheses. A value wrapped in
// var() or calc() is already reaching for something; a bare number is the one that can be invented
// on the spot, which is how the site bar grew a 68px reserve that nothing else in the app agreed
// with. Parens are counted rather than pattern-matched because the calc()s here nest.
function barePixels(value) {
    const found = [];
    let depth = 0;
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === "(") depth += 1;
        else if (value[i] === ")") depth -= 1;
        else if (depth === 0 && value.startsWith("px", i)) {
            const digits = /(\d+(?:\.\d+)?)$/.exec(value.slice(0, i));
            if (digits) found.push(Number(digits[1]));
        }
    }
    return found;
}

test("structural spacing reads the scale instead of a raw pixel", () => {
    // --sp-N is N quarters: 4/8/12/16/20/24/32/40/48/64/80. Below 16 the half steps (2, 6, 10, 14)
    // are optical nudges tuned to the type they sit with, not rhythm, so a raw one is allowed to
    // stay. At 18 and above there is nothing left but rhythm, so a bare number there is a value
    // somebody made up. This is the gap that was left open in the refresh: the palette, the type
    // and the motion are all closed, and spacing is the one that was still hand-written in places.
    for (const file of files) {
        const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of css.matchAll(/(?:^|[\s;{])(padding|margin|gap)(-[a-z]+)?\s*:\s*([^;}]+)/g)) {
            const [, prop, suffix, value] = match;
            for (const px of barePixels(value)) {
                assert.ok(px < 18, `${file} has ${prop}${suffix ?? ""}: ${value.trim()} (${px}px is a raw size)`);
            }
        }
    }
});
