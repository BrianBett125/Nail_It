import * as auth from "./src/auth.js";
import { friendlyAuthError, RESET_SENT_MESSAGE } from "./src/auth-errors.js";

const form = document.getElementById('authForm');
const title = document.getElementById('authTitle');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const passwordGroup = document.getElementById('passwordGroup');
const message = document.getElementById('authMessage');
const submit = document.getElementById('authSubmit');
const toSignUp = document.getElementById('toSignUp');
const toReset = document.getElementById('toReset');
const toSignIn = document.getElementById('toSignIn');

const MODES = {
    signin: { title: 'LOG IN', button: 'Sign in', autocomplete: 'current-password', needsPassword: true },
    signup: { title: 'CREATE ACCOUNT', button: 'Create account', autocomplete: 'new-password', needsPassword: true },
    reset: { title: 'RESET PASSWORD', button: 'Send reset link', autocomplete: 'current-password', needsPassword: false },
};
const MIN_PASSWORD = 6;
const DASHBOARD = 'dashboard.html';

let mode = 'signin';
let busy = false;
let leaving = false; // a sign-in worked and the page is on its way to the dashboard

function show(text, kind) {
    message.textContent = text;
    message.hidden = text === '';
    message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    message.className = `auth-message ${kind || ''}`.trim();
}

function setMode(next) {
    mode = next;
    const config = MODES[mode];
    title.textContent = config.title;
    submit.textContent = config.button;
    passwordInput.autocomplete = config.autocomplete;
    passwordGroup.hidden = !config.needsPassword;
    passwordInput.required = config.needsPassword;
    toSignUp.hidden = mode !== 'signin';
    toReset.hidden = mode !== 'signin';
    toSignIn.hidden = mode === 'signin';
    show('');
}

function setBusy(value) {
    busy = value;
    submit.disabled = value;
    if (value) {
        submit.dataset.label = submit.textContent;
        submit.textContent = 'Please wait...';
    } else if (submit.dataset.label) {
        submit.textContent = submit.dataset.label;
    }
}

function goToDashboard() {
    leaving = true;
    location.replace(DASHBOARD);
}

toSignUp.addEventListener('click', () => setMode('signup'));
toReset.addEventListener('click', () => setMode('reset'));
toSignIn.addEventListener('click', () => setMode('signin'));

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) {
        return; // a second tap while the first request is still out
    }
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email) {
        show('Enter your email address.', 'error');
        return;
    }
    if (MODES[mode].needsPassword && !password) {
        show('Enter your password.', 'error');
        return;
    }
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
        show(`Password must be at least ${MIN_PASSWORD} characters.`, 'error');
        return;
    }

    setBusy(true);
    show('');
    try {
        if (mode === 'signin') {
            await auth.signIn(email, password);
            goToDashboard();
        } else if (mode === 'signup') {
            await auth.signUp(email, password);
            goToDashboard();
        } else {
            await auth.resetPassword(email);
            show(RESET_SENT_MESSAGE, 'ok');
        }
    } catch (error) {
        show(friendlyAuthError(error), 'error');
    } finally {
        if (!leaving) {
            setBusy(false);
        }
    }
});

// Already signed in (saved session): nothing to do here.
// Ignored while a sign-in or sign-up is running: Firebase reports the new user before the
// verification email is sent, and leaving the page then would cut that request off.
auth.onUser((user) => {
    if (user && !leaving && !busy) {
        goToDashboard();
    }
});

setMode('signin');
