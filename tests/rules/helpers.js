// Shared setup for the rules tests. They run the real database.rules.json on the Firebase
// Realtime Database emulator: `npm run test:rules` starts the emulator and runs them.
import fs from "node:fs";
import path from "node:path";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { ref, get, set, update, remove } from "firebase/database";

export { ref, get, set, update, remove, assertSucceeds, assertFails };

export const RULES_PATH = path.resolve(import.meta.dirname, "../../database.rules.json");

export const SITE = { name: "Mombasa", location: "Nyali", buildingType: "Residential", createdAt: 1700000000000, ownerUid: "owner1" };
export const MATERIAL = { name: "Cement", quantity: 5, units: "bags", lastUpdated: "2024-05-03" };

// Site s1: owner1 (owner), keeper1 (storekeeper), viewer1 (viewer). Site s2 belongs to somebody else.
export const FIXTURE = {
    sites: {
        s1: SITE,
        s2: { ...SITE, name: "Other site", ownerUid: "owner2" },
    },
    members: {
        s1: { owner1: "owner", keeper1: "storekeeper", viewer1: "viewer" },
        s2: { owner2: "owner" },
    },
    userSites: {
        owner1: { s1: "owner" },
        keeper1: { s1: "storekeeper" },
        viewer1: { s1: "viewer" },
        owner2: { s2: "owner" },
    },
    memberInfo: {
        s1: {
            owner1: { email: "owner1@example.com" },
            keeper1: { email: "keeper1@example.com" },
            viewer1: { email: "viewer1@example.com" },
        },
    },
    materials: {
        s1: { m1: MATERIAL },
        s2: { m2: { ...MATERIAL, name: "Sand" } },
    },
};

export async function startEnv() {
    return initializeTestEnvironment({
        projectId: "demo-nailit",
        database: { host: "127.0.0.1", port: 9000, rules: fs.readFileSync(RULES_PATH, "utf8") },
    });
}

export async function reset(env, data = FIXTURE) {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async (context) => {
        await set(ref(context.database()), data);
    });
}

export async function raw(env, pathName) {
    let value;
    await env.withSecurityRulesDisabled(async (context) => {
        value = (await get(ref(context.database(), pathName))).val();
    });
    return value;
}

// email_verified defaults to true: a real account has verified its address before it can claim an invite.
export function as(env, uid, claims = {}) {
    return env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true, ...claims }).database();
}

export function anonymous(env) {
    return env.unauthenticatedContext().database();
}
