// Firebase web app configuration. None of this is secret: it identifies the project, it does not
// grant access (database.rules.json and Firebase Auth do that). Safe to commit.
export const firebaseConfig = {
    apiKey: "AIzaSyDx3xUBW1XjIE10vnrvab9mh4kcFwbBVBU",
    authDomain: "nail-it-6b883.firebaseapp.com",
    databaseURL: "https://nail-it-6b883-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "nail-it-6b883",
};

// A placeholder key (the old "REPLACE_..." value) counts as not configured, so sign-in says
// "not set up yet" instead of failing in a confusing way.
export function isConfigured(config = firebaseConfig) {
    return typeof config.apiKey === "string" && config.apiKey.length > 0 && !config.apiKey.startsWith("REPLACE");
}
