# Introduction

Nail_It is a construction site stock taking application, able to store materials record on site for different sites.

## Authors

* [Brian Bett] @BrianBett756@gmail.com
* [Njenga Mwangi] @wilsonnjenga799@gmail.com

## Link to Demo Web Application

 [Nail It](https://vercel.com/brianbett125s-projects/nail-it)

Hosted on Vercel at the moment.

## Usage

The dashboard is meant to be used without reading instructions. A site and three materials is 17 actions (clicks, typing, choosing from a list), counted by an automated test in `tests/e2e/streamline.test.js`.

1. Open the dashboard page. **Add Site** is at the top of the left sidebar.
2. Type the site name and location, pick the type of building from the list, and click **Add Site**. The new site opens by itself, and the dashboard opens the same site next time you come back.
3. Click **Add Material**. Type the name (names you used before are suggested, and "cement" is saved as "Cement" if that already exists), the quantity, and pick the unit from the list. The date is today unless you change it.
4. Click **Add** to save and close, or **Add & another** to save and keep the form open for the next item. The unit and date stay filled in, so a delivery of 15 items is 15 times name, quantity, **Add & another**.
5. To change a material, click the pen and paper icon on its row.
6. To delete a material, click the bin icon on its row. It goes at once and a **Deleted. Undo** message stays for 8 seconds. Click **Undo** to put it back.
7. To delete a whole site, click the bin icon next to its name and type the site name to confirm. The site and all its materials are removed together.

Messages (saved, deleted, errors) appear at the bottom of the screen and go away by themselves. Empty pages say what to do next.

## Development

The site is static, there is no build step. `package.json` only holds the test tooling.

```
npm install              # once; installs playwright-core
npm run test:unit        # pure logic, under a second, runs on every commit
npm run test:e2e         # drives dashboard.html in Chrome against an in-memory fake database
npm test                 # both
git config core.hooksPath .githooks   # run the unit tests before every commit
```

How it is laid out:

* `dashboard.js` wires the page. It talks to the database only through `src/data.js`.
* `src/data.js` is the only file that imports Firebase.
* `src/logic.js` holds validation, name normalization, the dropdown lists and the cascade-delete builder, with no DOM and no Firebase.
* `src/toast.js` shows the toast messages that replaced `alert()`.
* `tests/e2e/fake-data.js` replaces `src/data.js` during E2E tests, so the tests never touch the real database. The E2E suite fails if the page tries to reach Firebase.

What is stored: a site is `{ name, location, buildingType, createdAt }` (`createdAt` is stamped by the app, sites from before this change keep their old `date` field and still work). A material is `{ name, quantity, units, lastUpdated, siteId }`. The browser also keeps two small things in `localStorage`: the last opened site and the material names you typed before (for suggestions). Nothing breaks if `localStorage` is blocked.

The E2E tests use the system Chrome at `/usr/bin/google-chrome`. Set `CHROME_PATH` to use another one.

## Contributing

A huge shout out to my guy @willykar for the Javascript code and advise especially in utilising Firebase as a beginner friendly database.

## Licensing

MIT License:
Do whatever you like with the code, I embrace open-source as a way for the community to benefit at large. A shout-out too will be appreciated for the sleepless nights coming up with it.
