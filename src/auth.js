// Firebase Auth, email and password. dashboard.js and login.js talk only to this module, so
// E2E tests can swap it for tests/e2e/fake-auth.js and never reach Firebase.
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    signOut as firebaseSignOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "./firebase-app.js";
import { isConfigured } from "./firebase-config.js";
import { NOT_CONFIGURED_MESSAGE, isSilentResetError } from "./auth-errors.js";

const auth = getAuth(app);

function toUser(firebaseUser) {
    return firebaseUser
        ? { uid: firebaseUser.uid, email: firebaseUser.email, emailVerified: firebaseUser.emailVerified }
        : null;
}

function requireConfigured() {
    if (!isConfigured()) {
        throw new Error(NOT_CONFIGURED_MESSAGE);
    }
}

// callback(user) with { uid, email, emailVerified }, or null when signed out. Fires once at
// load with the saved session, then on every sign-in and sign-out. Returns the unsubscribe.
export function onUser(callback) {
    return onAuthStateChanged(auth, (firebaseUser) => callback(toUser(firebaseUser)));
}

export async function signIn(email, password) {
    requireConfigured();
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    return toUser(user);
}

// Creates the account and sends the verification email. An unverified address can use the
// app but cannot accept an invitation: database.rules.json refuses until it is verified.
export async function signUp(email, password) {
    requireConfigured();
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user).catch(() => {
        // The account exists; the user can press "Send again". Do not fail the sign-up.
    });
    return toUser(user);
}

export async function resetPassword(email) {
    requireConfigured();
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        if (!isSilentResetError(error)) {
            throw error;
        }
    }
}

export function signOut() {
    return firebaseSignOut(auth);
}

export async function resendVerification() {
    if (!auth.currentUser) {
        throw new Error("Sign in first.");
    }
    await sendEmailVerification(auth.currentUser);
}

// After the user clicks the link in the email, the open page still holds the old token.
// Reload the account and fetch a fresh token so the database rules see email_verified.
export async function refreshUser() {
    if (!auth.currentUser) {
        return null;
    }
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    return toUser(auth.currentUser);
}
