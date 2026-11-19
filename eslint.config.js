// ESLint flat config (ESLint 9). The site is plain ES modules with no build step, so this
// checks every script the browser loads plus the Node scripts and tests. Formatting is
// Prettier's job; ESLint only catches real mistakes.
import js from "@eslint/js";
import globals from "globals";

// The rules applied to every JavaScript file in the repo.
const shared = {
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    eqeqeq: ["error", "smart"],
    "no-var": "error",
    "prefer-const": "error",
};

export default [
    {
        ignores: ["node_modules/**", "assets/**", ".kilo/**"],
    },
    js.configs.recommended,
    {
        // The browser: the pages, the service worker and everything under src/.
        files: ["*.js", "src/**/*.js", "sw.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.browser, ...globals.serviceworker },
        },
        rules: shared,
    },
    {
        // Node: the repo scripts, the config files and the unit and rules tests.
        files: [
            "scripts/**/*.{js,mjs}",
            "tests/unit/**/*.{js,mjs}",
            "tests/rules/**/*.js",
            "*.config.js",
            "eslint.config.js",
        ],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: shared,
    },
    {
        // The end-to-end tests drive Chrome: the file itself is Node, but the callbacks
        // handed to page.evaluate run in the browser, so both sets of globals apply.
        files: ["tests/e2e/**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.node, ...globals.browser },
        },
        rules: shared,
    },
];
