#!/usr/bin/env node
// A small static server that behaves like Vercel for the one thing the pages depend on, the response
// headers in vercel.json (the Content-Security-Policy above all), so the policy can be tested in a real
// browser before it ships.
//
//   node scripts/serve.mjs [--port 5173] [--fake]
//
// --fake serves the in-memory data layer and sign-in the browser tests use (tests/e2e/fake-data.js and
// fake-auth.js, filled from scripts/fake-seed.js) instead of Firebase, so every signed-in page can be opened,
// audited with Lighthouse or looked at by hand with no account and no network. Never use it for anything else.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

// Vercel's `source` is a path pattern: "/(.*)" is everything, "/assets/(.*)" is one folder.
export function sourceMatches(source, urlPath) {
    const pattern = source
        .split("(.*)")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    return new RegExp(`^${pattern}$`).test(urlPath);
}

// The headers vercel.json says this path gets, in order, later rules winning on the same key.
export function headersFor(config, urlPath) {
    const headers = {};
    for (const rule of config.headers || []) {
        if (sourceMatches(rule.source, urlPath)) {
            for (const { key, value } of rule.headers) {
                headers[key] = value;
            }
        }
    }
    return headers;
}

const FAKE_FILES = {
    "/src/data.js": "tests/e2e/fake-data.js",
    "/src/auth.js": "tests/e2e/fake-auth.js",
};

export async function createServer({ fake = false } = {}) {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    const { default: seed } = fake ? await import(pathToFileURL(path.join(ROOT, "scripts/fake-seed.js")).href) : { default: null };

    return http.createServer((req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        const headers = headersFor(config, urlPath);
        const send = (status, type, body) => {
            res.writeHead(status, { ...headers, "content-type": type });
            res.end(body);
        };

        if (fake && urlPath === "/__seed.js") {
            return send(200, TYPES[".js"], `window.__seed = ${JSON.stringify(seed)};`);
        }
        const fakeFile = fake ? FAKE_FILES[urlPath] : null;
        const file = fakeFile
            ? path.join(ROOT, fakeFile)
            : path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            return send(404, "text/plain", "not found");
        }
        let body = fs.readFileSync(file);
        if (fake && file.endsWith(".html")) {
            // The seed is an external script, so the Content-Security-Policy needs no inline exception.
            body = body.toString("utf8").replace("<head>", '<head>\n    <script src="/__seed.js"></script>');
        }
        send(200, TYPES[path.extname(file)] || "application/octet-stream", body);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    const argv = process.argv.slice(2);
    const port = Number(argv[argv.indexOf("--port") + 1]) || 5173;
    const server = await createServer({ fake: argv.includes("--fake") });
    server.listen(port, "127.0.0.1", () => {
        console.log(`Serving ${ROOT} at http://127.0.0.1:${port}${argv.includes("--fake") ? " with the FAKE data layer and sign-in" : ""}`);
    });
}
