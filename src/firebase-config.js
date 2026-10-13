// Firebase web app configuration. None of this is secret: it identifies the project, it does not
// grant access (database.rules.json and Firebase Auth do that). Safe to commit.
//
// apiKey: Firebase console > Project settings > General > Your apps > Web app > apiKey.
// Until it is filled in, sign-in shows "not set up yet" instead of failing in a confusing way.
export const firebaseConfig = {
    apiKey: "REPLACE_WITH_WEB_API_KEY",
    authDomain: "nail-it-8f766.firebaseapp.com",
    databaseURL: "https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "nail-it-8f766",
};

export function isConfigured(config = firebaseConfig) {
    return typeof config.apiKey === "string" && config.apiKey.length > 0 && !config.apiKey.startsWith("REPLACE");
}
