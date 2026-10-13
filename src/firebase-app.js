// The one Firebase app. src/auth.js and src/data.js both import it, so there is one
// initializeApp() call, and E2E tests that replace those two modules never load the SDK.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
