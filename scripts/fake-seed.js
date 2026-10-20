// The data `node scripts/serve.mjs --fake` opens the app with: three sites, some low stock, some history.
// Same shape as the seeds in tests/e2e (see the header of tests/e2e/fake-data.js).
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

export default {
    user: { uid: "u1", email: "foreman@example.com", emailVerified: true },
    sites: {
        sA: { name: "Mombasa Heights", location: "Nyali", buildingType: "Residential", createdAt: now - 90 * DAY, ownerUid: "u1" },
        sB: { name: "Cape Town Depot", location: "Bellville", buildingType: "Commercial", createdAt: now - 60 * DAY, ownerUid: "u1" },
        sC: { name: "Kisumu Bridge", location: "Lake road", buildingType: "Road/Civil", createdAt: now - 30 * DAY, ownerUid: "u1" },
    },
    materials: {
        m1: { name: "Cement", quantity: 5, units: "bags", minLevel: 10, updatedAt: now - 2 * HOUR, siteId: "sA" },
        m2: { name: "Sand", quantity: 10, units: "tonnes", minLevel: 10, updatedAt: now - 3 * DAY, siteId: "sA" },
        m3: { name: "Bricks", quantity: 500, units: "pieces", updatedAt: now - HOUR, siteId: "sA" },
        m4: { name: "Paint", quantity: 0, units: "litres", minLevel: 3, updatedAt: now - 5 * DAY, siteId: "sA" },
        m5: { name: "Nails", quantity: 40, units: "kg", updatedAt: now - 9 * DAY, siteId: "sB" },
        m6: { name: "Rebar", quantity: 1, units: "pieces", minLevel: 50, updatedAt: now - 30 * 60_000, siteId: "sC" },
    },
    movements: {
        v1: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: 20, type: "opening", byUid: "u9", byEmail: "boss@example.com", at: now - 3 * DAY },
        v2: { siteId: "sA", materialId: "m1", materialName: "Cement", units: "bags", delta: -15, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 2 * HOUR, note: "Slab pour" },
        v3: { siteId: "sC", materialId: "m6", materialName: "Rebar", units: "pieces", delta: -9, type: "used", byUid: "u1", byEmail: "foreman@example.com", at: now - 30 * 60_000 },
    },
};
