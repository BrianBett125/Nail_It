// Roles and invites. Pure: no DOM, no Firebase, so the rules of the app run in Node tests.
// database.rules.json is the real enforcement. These helpers only decide what the page
// shows, so a viewer is not offered buttons that the database would refuse anyway.

export const ROLES = ["owner", "storekeeper", "viewer"];
export const INVITE_ROLES = ["storekeeper", "viewer"];
export const ROLE_LABELS = { owner: "Owner", storekeeper: "Storekeeper", viewer: "Viewer" };

export const INVITE_EMAIL_MESSAGE = "Enter a valid email address";
export const INVITE_ROLE_MESSAGE = "Choose a role from the list";
export const INVITE_SELF_MESSAGE = "That is your own email, you already own this site";

// Add, edit and delete materials.
export function canWriteMaterials(role) {
    return role === "owner" || role === "storekeeper";
}

// Delete the site, invite people, change roles, remove members.
export function canManageSite(role) {
    return role === "owner";
}

export function roleLabel(role) {
    return ROLE_LABELS[role] || "No access";
}

export function normalizeEmail(raw) {
    return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

// Database keys cannot contain . # $ [ ] /. A comma is not valid in an email address, so
// swapping "." for "," is reversible, and it is the swap database.rules.json makes too.
const KEY_FORBIDDEN = /[\s#$\[\]\/,]/;

export function isValidEmail(raw) {
    const email = normalizeEmail(raw);
    if (!email || email.length > 254 || KEY_FORBIDDEN.test(email)) {
        return false;
    }
    const at = email.indexOf("@");
    if (at < 1 || at !== email.lastIndexOf("@")) {
        return false;
    }
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    return !local.startsWith(".") && !local.endsWith(".")
        && domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
        && !email.includes("..");
}

export function emailKey(raw) {
    return normalizeEmail(raw).replaceAll(".", ",");
}

export function emailFromKey(key) {
    return String(key).replaceAll(",", ".");
}

// What the owner typed in the invite form. ownEmail is the owner's, so nobody invites themselves.
export function validateInvite({ email, role }, ownEmail = "") {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
        return { ok: false, error: INVITE_EMAIL_MESSAGE };
    }
    if (normalized === normalizeEmail(ownEmail)) {
        return { ok: false, error: INVITE_SELF_MESSAGE };
    }
    if (!INVITE_ROLES.includes(role)) {
        return { ok: false, error: INVITE_ROLE_MESSAGE };
    }
    return { ok: true, value: { email: normalized, key: emailKey(normalized), role } };
}
