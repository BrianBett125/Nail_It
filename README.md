# Introduction

Nail_It is a construction site stock taking application, able to store materials record on site for different sites.

## Authors

* [Brian Bett] @BrianBett756@gmail.com
* [Njenga Mwangi] @wilsonnjenga799@gmail.com

## Link to Demo Web Application

 [Nail It](https://vercel.com/brianbett125s-projects/nail-it)

Hosted on Vercel at the moment.

## Usage

# The web application is straight forwad and easy to use:
	1. Navigate to the dashboard page
	2. At the left bottomest part of the screen, click the Add Site button
	3. Fill in the displayed form including the Site Name, Site Location, Type of Building & Date and click Submit
	4. On the dashboard side, click on the site name (It should have a different background color from other sites i.e black)
	5. Once in the site choosen, click on the Add Material button on the right top part below the header to add the materials.
	6. Fill in with the desired material from the displayed form including the Material Name, Quantity, Units(kgs, number, metres etc), & Date and click Submit
	7. Now you can be able to see the materials. Go ahead and play with the application.
	8. At the same line of the material name, click the Pen & Paper icon to edit the material.
	9. Click on the Delete icon to delete the material.
	10. And if you want to delete the entire site find the Delete icon next to the sitename, click on it and confirm Yes to delete a site and associated materials.

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
* `src/logic.js` holds validation and the cascade-delete builder, with no DOM and no Firebase.
* `tests/e2e/fake-data.js` replaces `src/data.js` during E2E tests, so the tests never touch the real database. The E2E suite fails if the page tries to reach Firebase.

The E2E tests use the system Chrome at `/usr/bin/google-chrome`. Set `CHROME_PATH` to use another one.

## Contributing

A huge shout out to my guy @willykar for the Javascript code and advise especially in utilising Firebase as a beginner friendly database.

## Licensing

MIT License:
Do whatever you like with the code, I embrace open-source as a way for the community to benefit at large. A shout-out too will be appreciated for the sleepless nights coming up with it.
