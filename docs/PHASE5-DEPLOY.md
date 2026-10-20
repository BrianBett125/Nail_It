# Phase 5 deployment: phone-ready pages, lighter assets, security headers

Nothing in this phase touches the database, the rules or the data, so there is no backfill and no Firebase console step. The one change that can break a working site is the **Content-Security-Policy** in `vercel.json`: it tells the browser what the pages may load and connect to. It was tested in real Chrome against Firebase's real sign-in endpoint (`tests/e2e/security.test.js`), but **not** with a signed-in session against the real database, because that needs an account. So check it once on a Vercel preview before merging.

## What changes

| Before | After |
|---|---|
| About 7 MB of photos, one of them 3.8 MB and unused | WebP files, the home page loads 174 KB of pictures (79 KB less on a phone), unused files deleted |
| Font Awesome kit (a third-party script) for four icons | Inline SVG, no third-party script, no icon font |
| No security headers | A strict Content-Security-Policy, `nosniff`, no framing, referrer and permissions policy, HSTS, one week cache for pictures |
| Pages without a main landmark, two with failing contrast | Landmarks, one `h1` per page, buttons and links above 4.5:1 contrast |
| Hand-built overlays for forms | Native `<dialog>` for every form and sheet |
| Dashboard unusable below about 700px | Site picker, stacked cards, 44px tap targets, no sideways scroll from 320px |

## Check on a preview first (you)

1. Open the Vercel preview of the Phase 5 pull request.
2. Open the browser's developer tools, Console tab, and leave it open.
3. Sign in, open a site, press **Used** on a material and record 1, press **History**, open **Overview**, sign out.
4. The console must show **no** "Refused to ..." or "Content Security Policy" message. A working app with a CSP message still means something is blocked: send me the message.
5. If sign-in or the data fails and the console names the policy, **do not merge**. Send me the message; the fix is one host name in `vercel.json`.

## Rollback

Revert the merge on GitHub. Vercel redeploys the old pages in about a minute. To keep the rest and drop only the policy, delete the `Content-Security-Policy` entry in `vercel.json` and redeploy.

## How it is measured

| Measure | How to see it |
|---|---|
| Home page image weight under 250 KB | `npm run test:unit` (`tests/unit/assets.test.js`) |
| Every page 90 or more on Lighthouse mobile, performance and accessibility | `node scripts/lighthouse.mjs` (serves the site with the real headers and a fake data layer; needs Chrome) |
| Zero serious or critical accessibility violations | `node --test tests/e2e/a11y.test.js` (axe-core, every page and dialog, phone and desktop); `AXE_ALL=1` also fails on moderate findings |
| The policy lets Firebase work and blocks everything else | `node --test tests/e2e/security.test.js` |
| Every page works at 375px | `node --test tests/e2e/phone.test.js` and `tests/e2e/dialogs.test.js` |
