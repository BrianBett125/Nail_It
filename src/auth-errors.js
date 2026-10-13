// Turns Firebase Auth error codes into sentences a foreman can act on. Pure, so it is unit tested.

const MESSAGES = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "Wrong email or password.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your signal and try again.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/operation-not-allowed": "Email sign-in is not turned on for this project yet.",
    "auth/invalid-api-key": "Sign-in is not set up yet (missing Firebase web API key).",
    "auth/api-key-not-valid": "Sign-in is not set up yet (missing Firebase web API key).",
};

export const NOT_CONFIGURED_MESSAGE = "Sign-in is not set up yet (missing Firebase web API key).";
export const GENERIC_AUTH_MESSAGE = "Something went wrong. Try again.";
export const RESET_SENT_MESSAGE = "If an account exists for that email, a reset link is on its way.";

export function friendlyAuthError(error) {
    const code = error && typeof error.code === "string" ? error.code : "";
    // Firebase also reports a bad key inside the message of a generic error.
    if (!code && error && /api[-_ ]?key/i.test(String(error.message))) {
        return NOT_CONFIGURED_MESSAGE;
    }
    return MESSAGES[code] || GENERIC_AUTH_MESSAGE;
}

// A reset link must not reveal whether an address has an account: "user not found" is
// reported as success, like every other address.
export function isSilentResetError(error) {
    return Boolean(error) && error.code === "auth/user-not-found";
}
