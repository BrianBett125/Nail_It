import * as data from "./src/data.js";
import * as auth from "./src/auth.js";
import {
    validateSite,
    validateMaterial,
    validateMaterialEdit,
    suggestNames,
    deletePhrase,
    phraseMatches,
    BUILDING_TYPES,
    UNITS,
    NO_SITE_MESSAGE,
} from "./src/logic.js";
import {
    INVITE_ROLES,
    canWriteMaterials,
    canManageSite,
    roleLabel,
    emailKey,
    validateInvite,
} from "./src/roles.js";
import { lastUpdatedLabel } from "./src/movements.js";
import { icon } from "./src/icons.js";
import { showToast } from "./src/toast.js";
import { createMovementsUI } from "./src/ui-movements.js";
import { createInsightsUI } from "./src/ui-insights.js";
import { createDrawer } from "./src/ui-drawer.js";
import { openDialog, closeDialog, closeOnBackdrop } from "./src/dialog.js";
import { visibleMaterials, stockState, lowLabel, lowDetail } from "./src/insights.js";

// DOM Elements
const addSiteBtn = document.getElementById('addSiteButton');
const addSiteContainer = document.getElementById('siteFormContainer');
const siteForm = document.getElementById('siteForm');
const siteCancelBtn = document.getElementById('cancelButton');
const siteList = document.getElementById('siteList');
const sitesStatus = document.getElementById('sitesStatus');
const materialsStatus = document.getElementById('materialsStatus');
const materialsTable = document.getElementById('materialsTable');
const materialContainer = document.getElementById('materialFormContainer');
const materialForm = document.getElementById('materialForm');
const addMaterialButton = document.getElementById('addMaterialButton');
const materialCancelButton = document.getElementById('materialCancelButton');
const materialNameInput = document.getElementById('materialsName');
const materialNames = document.getElementById('materialNames');
const tableBody = document.getElementById("materialTableBody");
const updateContainer = document.getElementById('updateFormContainer');
const updateForm = document.getElementById('updateForm');
const updateCancelButton = document.getElementById('updateCancelButton');
const updateSubmitBtn = document.getElementById('update-material-btn');
const siteDeleteContainer = document.getElementById('siteDeleteContainer');
const siteDeleteForm = document.getElementById('siteDeleteForm');
const siteDeletePhraseEl = document.getElementById('siteDeletePhrase');
const siteDeleteInput = document.getElementById('siteDeleteInput');
const siteDeleteCancel = document.getElementById('siteDeleteCancel');
const siteDeleteConfirm = document.getElementById('siteDeleteConfirm');
const userEmailEl = document.getElementById('userEmail');
const signOutButton = document.getElementById('signOutButton');
const verifyBanner = document.getElementById('verifyBanner');
const verifyEmailEl = document.getElementById('verifyEmail');
const resendVerificationBtn = document.getElementById('resendVerification');
const checkVerifiedBtn = document.getElementById('checkVerified');
const invitesPanel = document.getElementById('invitesPanel');
const inviteList = document.getElementById('inviteList');
const roleBadge = document.getElementById('roleBadge');
const membersButton = document.getElementById('membersButton');
const membersContainer = document.getElementById('membersContainer');
const memberList = document.getElementById('memberList');
const inviteSection = document.getElementById('inviteSection');
const inviteForm = document.getElementById('inviteForm');
const inviteEmailInput = document.getElementById('inviteEmail');
const inviteRoleSelect = document.getElementById('inviteRole');
const inviteSubmit = document.getElementById('inviteSubmit');
const pendingInviteList = document.getElementById('pendingInviteList');
const leaveSiteButton = document.getElementById('leaveSiteButton');
const membersClose = document.getElementById('membersClose');
const mainContent = document.querySelector('.main-content');
const drawerAccount = document.getElementById('drawerAccount');
const siteNameInput = document.getElementById('siteName');

// State. The ids live here and are read at submit time, never captured in a handler
// that gets added more than once.
let currentUser = null;              // { uid, email, emailVerified }, null until Firebase answers
let sessionStarted = false;
let stopInvites = null;
let currentSiteId = null;
let unsubscribeMaterials = null;
let editingMaterialId = null;
let editingSiteId = null;            // the site the edit form was opened for, even if the user moves on
let editingLegacyUnit = null;        // the unit a legacy material had, if it is not in the dropdown
let deletingSiteId = null;
let deletingSite = false;            // the cascade delete is in flight
let sitesById = {};                  // latest sites snapshot, each with the user's role
const pendingSiteLabels = new Map(); // name of a site just added, until its first snapshot arrives
let currentMaterials = {};           // latest materials snapshot of the selected site
let sitesLoaded = false;
let materialsLoaded = false;
let sitesError = null;
let materialsError = null;
let restoredLastSite = false;
let stopMembers = null;
let membersSiteId = null;
let leaveArmed = false;              // the first tap on "Leave site" arms it, the second leaves
let leaveTimer = null;
const unconfirmedSites = new Set();  // sites we just added or joined whose first snapshot has not arrived
const savingMaterials = new Set();   // ids with an edit sent but not yet acknowledged

// The site picker and the drawer it opens on a phone live in src/ui-drawer.js.
const drawer = createDrawer();

// Search, filter chips, sort, the summary tiles and the Needs attention strip live in
// src/ui-insights.js. This file draws the rows from whatever view it says is chosen.
const insightsUI = createInsightsUI({ onViewChange: () => renderRows() });
let visibleCount = 0;                // rows the current search, filter and sort leave

// Received / Used, history and the activity feed live in src/ui-movements.js. They ask for the
// current site, materials and role at the moment of each action, never a copy.
const movementsUI = createMovementsUI({
    // The activity feed already listens to the site's movements. The summary borrows its newest
    // line ("last activity") instead of opening a second listener on the same data.
    data: {
        ...data,
        subscribeMovements: (siteId, options, onData, onError) => data.subscribeMovements(siteId, options, (movements) => {
            if (!options || !options.materialId) {
                const newest = movements[movements.length - 1];
                insightsUI.setLastMovement(siteId, newest ? newest.at : 0);
            }
            onData(movements);
        }, onError),
    },
    getContext: () => ({ siteId: currentSiteId, materials: currentMaterials, role: currentRole(), user: currentUser }),
    showToast,
    reportError,
});

const UNNAMED_SITE = "(unnamed site)";
const LAST_SITE_KEY = "nailit.lastSite";
const NAMES_KEY = "nailit.materialNames";
const MAX_REMEMBERED_NAMES = 200;
const UNDO_MS = 8000;
const LEAVE_ARM_MS = 4000;

// localStorage can throw or be missing (private window, blocked site data). Every use
// goes through these, and the app works the same without it.
function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // not remembered, nothing else changes
    }
}

function storageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // see storageSet
    }
}

function rememberedNames() {
    try {
        const list = JSON.parse(storageGet(NAMES_KEY) || "[]");
        return Array.isArray(list) ? list.filter((name) => typeof name === "string") : [];
    } catch {
        return [];
    }
}

function rememberName(name) {
    const list = suggestNames([name, ...rememberedNames()]).slice(0, MAX_REMEMBERED_NAMES);
    storageSet(NAMES_KEY, JSON.stringify(list));
}

// Names on the selected site first, then names typed in the past on any site.
function knownMaterialNames() {
    return suggestNames([
        ...Object.values(currentMaterials).map((material) => material && material.name),
        ...rememberedNames(),
    ]);
}

// A legacy site may have no name, or only spaces: either would render an invisible link.
function siteLabel(site) {
    return String(site.name ?? "").trim() || UNNAMED_SITE;
}

function reportError(error) {
    showToast(error && error.message ? error.message : String(error), { kind: "error" });
}

// The role of the signed-in user in the selected site, or undefined with no site selected.
function currentRole() {
    const site = sitesById[currentSiteId];
    return site ? site.role : undefined;
}

// label turns a stored value into the text shown ("storekeeper" -> "Storekeeper").
function fillOptions(select, values, placeholder, label = (value) => value) {
    select.replaceChildren();
    if (placeholder) {
        const first = document.createElement('option');
        first.value = '';
        first.textContent = placeholder;
        select.appendChild(first);
    }
    for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label(value);
        select.appendChild(option);
    }
}

// The dropdown lists come from src/logic.js and src/roles.js, the same lists validation checks against.
fillOptions(document.getElementById('buildingType'), BUILDING_TYPES, 'Choose type');
fillOptions(document.getElementById('mUnits'), UNITS, 'Choose unit');
fillOptions(document.getElementById('uUnits'), UNITS, 'Choose unit');
fillOptions(inviteRoleSelect, INVITE_ROLES, null, roleLabel);

function refreshNameSuggestions() {
    materialNames.replaceChildren();
    for (const name of knownMaterialNames()) {
        const option = document.createElement('option');
        option.value = name;
        materialNames.appendChild(option);
    }
}

// Empty and loading states. One place decides what the two status lines say.
function renderStatus() {
    const siteCount = Object.keys(sitesById).length;
    if (sitesError) {
        sitesStatus.textContent = "Could not load sites.";
    } else if (!sitesLoaded) {
        sitesStatus.textContent = "Loading sites...";
    } else if (siteCount === 0) {
        sitesStatus.textContent = "No sites yet. Add your first site.";
    } else {
        sitesStatus.textContent = "";
    }
    sitesStatus.hidden = sitesStatus.textContent === "";

    const rows = Object.keys(currentMaterials).length;
    const canWrite = canWriteMaterials(currentRole());
    if (!currentSiteId) {
        if (sitesError) {
            materialsStatus.textContent = "";
        } else if (!sitesLoaded) {
            materialsStatus.textContent = "Loading...";
        } else if (siteCount === 0) {
            materialsStatus.textContent = "No sites yet. Add your first site to start tracking materials.";
        } else {
            materialsStatus.textContent = "Select a site to see its materials.";
        }
    } else if (materialsError) {
        materialsStatus.textContent = "Could not load materials for this site.";
    } else if (!materialsLoaded) {
        materialsStatus.textContent = "Loading materials...";
    } else if (rows === 0) {
        materialsStatus.textContent = canWrite
            ? "No materials yet. Add your first material."
            : "No materials recorded in this site yet.";
    } else if (visibleCount === 0) {
        materialsStatus.textContent = insightsUI.emptyMessage(); // the search or filter leaves nothing: say why
    } else {
        materialsStatus.textContent = "";
    }
    materialsStatus.hidden = materialsStatus.textContent === "";
    // An empty result is a dead end unless there is a way out: one button, back to everything.
    const emptyResult = Boolean(currentSiteId) && materialsLoaded && rows > 0 && visibleCount === 0 && insightsUI.isNarrowed();
    materialsStatus.classList.toggle('status-card', emptyResult);
    document.getElementById('clearView').hidden = !emptyResult;
    materialsTable.hidden = !currentSiteId || !materialsLoaded || rows === 0 || visibleCount === 0;
    materialsTable.classList.toggle('readonly', !canWrite);
}

// What the buttons around the table offer depends on the role. The database refuses the same
// writes anyway (database.rules.json); this only stops offering what would fail.
function applyRole() {
    const role = currentRole();
    // With no site selected the button stays so that pressing it can say "Select a site first".
    addMaterialButton.hidden = Boolean(currentSiteId) && !canWriteMaterials(role);
    membersButton.hidden = !currentSiteId;
    roleBadge.hidden = !currentSiteId;
    roleBadge.textContent = currentSiteId ? `Your role: ${roleLabel(role)}` : '';
    updateSiteBar();
}

// The picker on a phone: the open site's name and the person's role in it.
function updateSiteBar() {
    const site = sitesById[currentSiteId];
    const label = site ? siteLabel(site) : pendingSiteLabels.get(currentSiteId) || UNNAMED_SITE;
    drawer.setSite(currentSiteId ? label : null, currentSiteId ? roleLabel(currentRole()) : '');
}

// A material row's button, found again by id and class: the table is redrawn on every update, so the
// button that opened a dialog may be a new element by the time the dialog closes.
function rowButton(materialId, className) {
    const row = tableBody.querySelector(`tr[data-material-id="${CSS.escape(materialId)}"]`);
    return (row && (row.querySelector(`.${className}`) || row.querySelector('button'))) || null;
}

// The first of these that is still on the page and can take focus.
function usable(...candidates) {
    return candidates.find((el) => el && el.isConnected && (!el.checkVisibility || el.checkVisibility())) || null;
}

// ---- Session ------------------------------------------------------------------------

function renderUser() {
    userEmailEl.textContent = currentUser ? currentUser.email : '';
    drawerAccount.textContent = currentUser ? `Signed in as ${currentUser.email}` : '';
    const unverified = Boolean(currentUser) && !currentUser.emailVerified;
    verifyBanner.hidden = !unverified;
    verifyEmailEl.textContent = unverified ? currentUser.email : '';
}

// Invitations can only be read with a verified email (database.rules.json), so listen only then.
function syncInvites() {
    const wanted = Boolean(currentUser) && currentUser.emailVerified;
    if (wanted && !stopInvites) {
        stopInvites = data.subscribeInvites(emailKey(currentUser.email), renderInvites, reportError);
    } else if (!wanted && stopInvites) {
        stopInvites();
        stopInvites = null;
        renderInvites({});
    }
}

auth.onUser((user) => {
    if (!user) {
        location.replace('login.html'); // signed out here or in another tab: nothing to show
        return;
    }
    if (sessionStarted && currentUser && currentUser.uid !== user.uid) {
        location.reload(); // a different account signed in: start clean
        return;
    }
    currentUser = user;
    renderUser();
    syncInvites();
    if (!sessionStarted) {
        sessionStarted = true;
        // Fetch and display this user's sites in the sidebar
        data.subscribeSites(user.uid, renderSites, (error) => {
            sitesError = error;
            renderStatus();
            reportError(error);
        });
    }
});

signOutButton.addEventListener('click', () => {
    Promise.resolve().then(() => auth.signOut()).catch(reportError);
});

resendVerificationBtn.addEventListener('click', () => {
    Promise.resolve()
        .then(() => auth.resendVerification())
        .then(() => showToast(`Verification email sent to ${currentUser.email}`))
        .catch(reportError);
});

checkVerifiedBtn.addEventListener('click', () => {
    Promise.resolve()
        .then(() => auth.refreshUser())
        .then((user) => {
            if (!user) {
                return;
            }
            currentUser = user;
            renderUser();
            syncInvites();
            showToast(user.emailVerified ? "Email verified" : "Not verified yet. Open the link in the email first.");
        })
        .catch(reportError);
});

// ---- Invitations for this account ---------------------------------------------------

function renderInvites(invites) {
    inviteList.replaceChildren();
    const entries = Object.entries(invites);
    invitesPanel.hidden = entries.length === 0;
    for (const [siteId, invite] of entries) {
        const item = document.createElement('li');
        const text = document.createElement('span');
        // Names and emails are other people's text: textContent only.
        text.textContent = `${invite.invitedBy} invited you to ${invite.siteName} as ${roleLabel(invite.role)}`;
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.textContent = 'Accept';
        accept.addEventListener('click', () => {
            accept.disabled = true;
            acceptInvite(siteId, invite);
        });
        const decline = document.createElement('button');
        decline.type = 'button';
        decline.textContent = 'Decline';
        decline.addEventListener('click', () => {
            decline.disabled = true;
            Promise.resolve()
                .then(() => data.declineInvite(siteId, emailKey(currentUser.email)))
                .catch(reportError);
        });
        item.append(text, accept, decline);
        inviteList.appendChild(item);
    }
}

function acceptInvite(siteId, invite) {
    unconfirmedSites.add(siteId);
    Promise.resolve()
        .then(() => data.acceptInvite(currentUser, siteId, emailKey(currentUser.email), invite.role))
        .then(() => {
            // Open the site only now. Listening to its materials before the membership is written
            // would be refused by the database, and a refused listener does not come back.
            // The site stays "unconfirmed" until its first snapshot arrives in renderSites.
            selectSite(siteId);
            showToast(`Joined ${invite.siteName} as ${roleLabel(invite.role)}`);
        })
        .catch((error) => {
            unconfirmedSites.delete(siteId);
            reportError(error);
        });
}

// ---- Event listeners ----------------------------------------------------------------

addSiteBtn.addEventListener('click', () => {
    drawer.close();
    openDialog(addSiteContainer, { focus: siteNameInput, opener: addSiteBtn });
});

siteCancelBtn.addEventListener('click', () => closeDialog(addSiteContainer));

siteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addNewSite();
});

addMaterialButton.addEventListener('click', () => {
    if (!currentSiteId) {
        showToast(NO_SITE_MESSAGE, { kind: "error" });
        return;
    }
    openMaterialForm();
});

materialCancelButton.addEventListener('click', () => closeDialog(materialContainer));

materialForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const another = Boolean(event.submitter && event.submitter.id === 'material-another-btn');
    addNewMaterial(another);
});

updateCancelButton.addEventListener('click', () => closeDialog(updateContainer));
// Escape, Cancel, a save and a site change all end here: the edit no longer names a material.
updateContainer.addEventListener('close', () => {
    if (!updateContainer.open) {
        endEdit();
    }
});

updateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!updateContainer.open) return;
    updateMaterial();
});

siteDeleteCancel.addEventListener('click', closeSiteDelete);
siteDeleteContainer.addEventListener('close', () => {
    if (!siteDeleteContainer.open) {
        resetSiteDelete();
    }
});

siteDeleteInput.addEventListener('input', refreshSiteDeleteButton);

siteDeleteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmSiteDelete();
});

document.getElementById('clearView').addEventListener('click', () => insightsUI.clearView());
membersButton.addEventListener('click', openMembers);
membersClose.addEventListener('click', closeMembers);
membersContainer.addEventListener('close', () => {
    if (!membersContainer.open) {
        resetMembers();
    }
});

inviteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendInvite();
});

leaveSiteButton.addEventListener('click', leaveSite);

function openMaterialForm() {
    refreshNameSuggestions();
    openDialog(materialContainer, { focus: materialNameInput, opener: addMaterialButton });
}

// Function to add new site data to Firebase, open it straight away and remember it.
function addNewSite() {
    const result = validateSite({
        name: document.getElementById('siteName').value,
        location: document.getElementById('siteLocation').value,
        buildingType: document.getElementById('buildingType').value,
    });
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    const { id, done } = data.addSite(result.value, currentUser);
    unconfirmedSites.add(id);
    pendingSiteLabels.set(id, result.value.name);
    Promise.resolve(done)
        .then(() => unconfirmedSites.delete(id))
        .catch((error) => {
            unconfirmedSites.delete(id);
            if (currentSiteId === id) {
                clearSelection();
            }
            reportError(error);
        });
    siteForm.reset();
    closeDialog(addSiteContainer);
    selectSite(id);
    showToast(`Site "${result.value.name}" added`);
}

// Function to add a new material to Firebase. `another` keeps the form open for the next one.
function addNewMaterial(another) {
    const result = validateMaterial({
        name: materialNameInput.value,
        quantity: document.getElementById('mQuantity').value,
        units: document.getElementById('mUnits').value,
        minLevel: document.getElementById('mMinLevel').value,
    }, currentSiteId, { knownNames: knownMaterialNames() });
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    data.addMaterial(currentSiteId, result.value, currentUser).done.catch(reportError);
    rememberName(result.value.name);
    showToast(`Added ${result.value.quantity} ${result.value.units} ${result.value.name}`);
    if (another) {
        // Keep the unit: a delivery is usually several items of the same kind.
        materialNameInput.value = '';
        document.getElementById('mQuantity').value = '';
        document.getElementById('mMinLevel').value = '';
        refreshNameSuggestions();
        materialNameInput.focus();
    } else {
        materialForm.reset();
        closeDialog(materialContainer);
    }
}

// Build one sidebar entry. Site names are user text, so they only ever go through textContent.
function buildSiteItem(siteId, site) {
    const item = document.createElement('li');

    const link = document.createElement('a');
    link.href = '#';
    link.dataset.siteId = siteId;
    link.textContent = siteLabel(site);
    if (siteId === currentSiteId) {
        link.classList.add('active');
    }
    link.addEventListener('click', (event) => {
        event.preventDefault();
        selectSite(siteId);
        drawer.close({ focus: true }); // on a phone, picking a site folds the drawer away
    });
    item.append(link);

    if (site.role !== 'owner') {
        // Next to the link, not inside it, so the link text stays exactly the site name.
        const tag = document.createElement('span');
        tag.className = 'role-tag';
        tag.textContent = roleLabel(site.role);
        item.append(' ', tag);
    }

    if (canManageSite(site.role)) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-site-btn';
        deleteButton.dataset.siteId = siteId;
        deleteButton.setAttribute('aria-label', `Delete site ${siteLabel(site)}`);
        deleteButton.appendChild(icon('trash'));
        deleteButton.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent triggering the site link click event
            showDeleteSiteConfirmation(siteId, deleteButton);
        });
        item.append(' ', deleteButton);
    }
    return item;
}

// Render the sidebar. The selected site stays highlighted across re-renders.
function renderSites(sites) {
    const previousRole = currentRole();
    sitesById = sites;
    sitesLoaded = true;
    sitesError = null;
    siteList.replaceChildren();
    for (const [siteId, site] of Object.entries(sites)) {
        unconfirmedSites.delete(siteId);
        pendingSiteLabels.delete(siteId);
        siteList.appendChild(buildSiteItem(siteId, site));
    }
    // A site we just added may not be in this snapshot yet. Keep it selected until it is.
    if (currentSiteId && !sites[currentSiteId] && !unconfirmedSites.has(currentSiteId)) {
        if (storageGet(LAST_SITE_KEY) === currentSiteId) {
            storageRemove(LAST_SITE_KEY);
        }
        clearSelection();
    }
    if (deletingSiteId && !sites[deletingSiteId]) {
        closeSiteDelete();
    }
    if (membersSiteId && !sites[membersSiteId]) {
        closeMembers(); // removed from the site, or the site is gone
    }
    if (!restoredLastSite) {
        restoredLastSite = true;
        // dashboard.html?site=<id> (the link on the overview) beats the remembered site; an id this
        // account cannot see is ignored.
        const requested = new URLSearchParams(location.search).get('site');
        const last = storageGet(LAST_SITE_KEY);
        if (!currentSiteId && requested && sites[requested]) {
            selectSite(requested);
        } else if (!currentSiteId && last && sites[last]) {
            selectSite(last);
        }
    }
    if (currentSiteId && currentRole() !== previousRole && materialsLoaded) {
        renderMaterials(currentMaterials); // the role changed: show or hide the edit buttons
    }
    applyRole();
    renderStatus();
    drawer.sitesReady(); // with no site open on a phone, the list opens by itself
}

function clearSelection() {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
        unsubscribeMaterials = null;
    }
    currentSiteId = null;
    currentMaterials = {};
    materialsLoaded = false;
    materialsError = null;
    visibleCount = 0;
    insightsUI.setSite(null);
    tableBody.replaceChildren();
    closeMaterialModals();
    closeMembers();
    movementsUI.setSite(null);
    mainContent.classList.remove('is-ready');
    applyRole();
    renderStatus();
    if (sitesLoaded) {
        drawer.open(); // the open site is gone: pick another
    }
}

// An edit names one material in one site. When the material is gone (deleted by someone
// else, or its site was removed) or the user moves to another site, the modal must close, or
// submitting it would write into the wrong place.
function closeMaterialModals() {
    movementsUI.closeDialogs();
    closeDialog(updateContainer, { restore: false });
    endEdit();
}

// The edit form no longer names a material.
function endEdit() {
    editingMaterialId = null;
    editingSiteId = null;
    refreshModalButtons();
}

// Select a site: drop the previous materials subscription before opening the next one.
function selectSite(siteId) {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
    }
    const previousSiteId = currentSiteId;
    if (siteId !== currentSiteId) {
        closeMaterialModals();
        closeMembers();
    }
    currentSiteId = siteId;
    movementsUI.setSite(siteId);
    storageSet(LAST_SITE_KEY, siteId);
    siteList.querySelectorAll('a').forEach(link => {
        link.classList.toggle('active', link.dataset.siteId === siteId);
    });
    tableBody.replaceChildren();
    mainContent.classList.remove('is-ready');
    currentMaterials = {};
    materialsLoaded = false;
    materialsError = null;
    visibleCount = 0;
    if (siteId !== previousSiteId) {
        insightsUI.setSite(siteId); // search, filter and sort belong to one site
    }
    applyRole();
    renderStatus();
    unsubscribeMaterials = data.subscribeMaterials(siteId, (materials) => {
        if (siteId === currentSiteId) { // ignore a late callback from a site we left
            renderMaterials(materials);
        }
    }, (error) => {
        if (siteId === currentSiteId) {
            materialsError = error;
            renderStatus();
            reportError(error);
        }
    });
}

function renderMaterials(materials) {
    currentMaterials = materials;
    materialsLoaded = true;
    materialsError = null;
    insightsUI.update(materials);
    drawRows();
    if (editingMaterialId && !materials[editingMaterialId]) {
        closeMaterialModals();
    }
    if (materialContainer.open) {
        refreshNameSuggestions();
    }
    movementsUI.refresh(); // an open Received / Used or history sheet follows the new stock
    renderStatus();
    // The tiles, the table and the activity feed appear together, in one frame: nothing that is on
    // screen while the site loads sits below them, so nothing is pushed down when they arrive.
    mainContent.classList.add('is-ready');
}

// Only the search, filter or sort changed: the rows are redrawn, nothing else is touched.
function renderRows() {
    if (!materialsLoaded) {
        return;
    }
    drawRows();
    renderStatus();
}

// The rows the chosen view shows, in its order. A row's buttons act on its own material id, so a
// sorted or filtered table still records stock against the right material.
function drawRows() {
    const editable = canWriteMaterials(currentRole());
    const shown = visibleMaterials(currentMaterials, insightsUI.view());
    visibleCount = shown.length;
    // The Status column header only shows while a row in view has something to say in it.
    materialsTable.classList.toggle('has-low', shown.some(([, material]) => stockState(material) !== 'ok'));
    tableBody.replaceChildren();
    for (const [materialId, material] of shown) {
        addMaterialRow(materialId, material, editable);
    }
}

// Function to add a material row to the table. Received and Used are for owners and storekeepers,
// History for every member, Edit and Delete for owners and storekeepers.
function addMaterialRow(materialId, materialData, editable) {
    const newRow = document.createElement("tr");
    newRow.dataset.materialId = materialId;

    const nameCell = document.createElement("td");
    nameCell.textContent = materialData.name;
    const quantityCell = document.createElement("td");
    quantityCell.textContent = materialData.quantity;
    const unitsCell = document.createElement("td");
    unitsCell.textContent = materialData.units;
    const lastUpdatedCell = document.createElement("td");
    lastUpdatedCell.textContent = lastUpdatedLabel(materialData);
    lastUpdatedCell.className = "cell-updated";

    // Low stock: a tinted row, and a word (never colour alone) with how much is left.
    const statusCell = document.createElement("td");
    statusCell.className = "cell-status";
    const state = stockState(materialData);
    if (state !== "ok") {
        newRow.classList.add("is-low", state === "out" ? "is-out" : "is-below");
        const detail = lowDetail(materialData);
        const badge = document.createElement("span");
        badge.className = `badge-low${state === "out" ? " badge-out" : ""}`;
        badge.textContent = lowLabel(materialData);
        badge.title = detail;
        const text = document.createElement("span");
        text.className = "low-detail";
        text.textContent = detail;
        statusCell.append(badge, text);
    }

    const stockCell = document.createElement("td");
    stockCell.className = "cell-stock";
    stockCell.append(movementsUI.buildStockActions(materialId, materialData, editable));

    const manageCell = document.createElement("td");
    manageCell.className = "cell-manage";
    if (editable) {
        const editButton = makeManageButton("btn-edit", "pen", "Edit", "Edit material");
        const deleteButton = makeManageButton("btn-delete", "trash", "Delete", "Delete material");
        editButton.addEventListener("click", () => {
            showUpdateForm(materialId, materialData);
        });
        deleteButton.addEventListener("click", (event) => {
            event.currentTarget.disabled = true; // a second tap before the row disappears does nothing
            deleteMaterial(materialId, materialData);
        });
        manageCell.append(editButton, deleteButton);
    }

    newRow.append(nameCell, quantityCell, unitsCell, lastUpdatedCell, stockCell, manageCell, statusCell);
    tableBody.appendChild(newRow);
}

// A text label next to the icon: the button reads without the picture, and the picture is decoration.
function makeManageButton(className, iconName, text, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.append(icon(iconName), ` ${text}`);
    return button;
}

// A material saved before the units dropdown may carry a unit that is not in the list
// ("kgs"). Show it as an extra option so opening and saving the edit does not change it.
function setEditUnits(units) {
    const select = document.getElementById('uUnits');
    select.querySelectorAll('option[data-legacy]').forEach((option) => option.remove());
    editingLegacyUnit = null;
    if (units && !UNITS.includes(units)) {
        const option = document.createElement('option');
        option.value = units;
        option.textContent = units;
        option.dataset.legacy = 'true';
        select.appendChild(option);
        editingLegacyUnit = units;
    }
    select.value = units ?? "";
}

// Function to show the update form and populate it with material data
function showUpdateForm(materialId, materialData) {
    editingMaterialId = materialId;
    editingSiteId = currentSiteId;
    refreshNameSuggestions();
    // ?? "" so a legacy record with a missing field shows an empty input, not the text "undefined".
    document.getElementById('uMaterialName').value = materialData.name ?? "";
    setEditUnits(materialData.units);
    document.getElementById('uMinLevel').value = materialData.minLevel ?? "";
    refreshModalButtons();
    openDialog(updateContainer, {
        focus: document.getElementById('uMaterialName'),
        opener: () => usable(rowButton(materialId, 'btn-edit'), addMaterialButton),
    });
}

// The Update button is locked per material while its write is unacknowledged
// (slow or no signal), so a repeated tap cannot send it twice. Another material is unaffected.
function refreshModalButtons() {
    const saving = savingMaterials.has(editingMaterialId);
    updateSubmitBtn.disabled = saving;
    updateSubmitBtn.textContent = saving ? 'Saving...' : 'Update';
}

// Function to update material data in Firebase
function updateMaterial() {
    const materialId = editingMaterialId;
    const siteId = editingSiteId;
    if (!materialId || !siteId || savingMaterials.has(materialId)) {
        return;
    }
    const result = validateMaterialEdit({
        name: document.getElementById('uMaterialName').value,
        units: document.getElementById('uUnits').value,
        minLevel: document.getElementById('uMinLevel').value,
    }, { knownNames: knownMaterialNames(), legacyUnit: editingLegacyUnit });
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    savingMaterials.add(materialId);
    refreshModalButtons();
    // Promise.resolve().then so a synchronous throw still reaches catch and finally.
    Promise.resolve()
        .then(() => data.updateMaterial(siteId, materialId, result.value))
        .then(() => {
            rememberName(result.value.name);
            showToast("Material updated");
            // The ack can arrive after the user moved on to another material. Only close
            // the modal if it still belongs to the edit that was sent.
            if (editingMaterialId === materialId) {
                closeDialog(updateContainer);
            }
        })
        .catch(reportError)
        .finally(() => {
            savingMaterials.delete(materialId);
            refreshModalButtons();
        });
}

// Delete a material at once and offer Undo. The toast appears when the delete is sent, not
// when the server acknowledges it, so it is there with no signal too. Undo writes the whole
// material back under its old id.
function deleteMaterial(materialId, material) {
    const copy = structuredClone(material);
    const siteId = currentSiteId;
    const toast = showToast(`Deleted ${copy.name}.`, {
        actionLabel: "Undo",
        duration: UNDO_MS,
        onAction: () => undoDelete(materialId, copy, siteId),
    });
    Promise.resolve()
        .then(() => data.removeMaterial(siteId, materialId, copy, currentUser))
        .catch((error) => {
            toast.dismiss();
            reportError(error);
        });
}

function undoDelete(materialId, material, siteId) {
    // Restoring into a site that was deleted meanwhile would create an orphan, and a role that
    // dropped to viewer meanwhile cannot write.
    const site = sitesById[siteId];
    if (!site) {
        showToast("That site no longer exists, so the material was not restored.", { kind: "error" });
        return;
    }
    if (!canWriteMaterials(site.role)) {
        showToast("You can no longer edit this site, so the material was not restored.", { kind: "error" });
        return;
    }
    Promise.resolve()
        .then(() => data.restoreMaterial(siteId, materialId, material, currentUser))
        .catch(reportError);
    showToast(`Restored ${material.name}`);
}

// ---- Deleting a site ----------------------------------------------------------------

// The site name must be typed before the delete button works. Only the owner gets here.
function showDeleteSiteConfirmation(siteId, button) {
    const site = sitesById[siteId];
    if (!site || !canManageSite(site.role)) {
        return;
    }
    deletingSiteId = siteId;
    siteDeletePhraseEl.textContent = deletePhrase(site);
    siteDeleteInput.value = '';
    refreshSiteDeleteButton();
    drawer.close();
    openDialog(siteDeleteContainer, {
        focus: siteDeleteInput,
        // The trash can sits in the drawer on a phone, which is shut again by then: the picker takes the focus.
        opener: () => usable(button, document.getElementById('sitePickerButton'), addSiteBtn),
    });
}

function refreshSiteDeleteButton() {
    const site = sitesById[deletingSiteId];
    const matches = Boolean(site) && phraseMatches(siteDeleteInput.value, deletePhrase(site));
    siteDeleteConfirm.disabled = deletingSite || !matches;
    siteDeleteConfirm.textContent = deletingSite ? 'Deleting...' : 'Delete site';
}

function closeSiteDelete() {
    closeDialog(siteDeleteContainer);
    resetSiteDelete();
}

function resetSiteDelete() {
    deletingSiteId = null;
    siteDeleteInput.value = '';
    refreshSiteDeleteButton();
}

function confirmSiteDelete() {
    const site = sitesById[deletingSiteId];
    if (deletingSite || !site || !canManageSite(site.role)
        || !phraseMatches(siteDeleteInput.value, deletePhrase(site))) {
        return; // Enter in the input must not bypass the typed-name check
    }
    deleteSite(deletingSiteId, siteLabel(site));
}

// Function to delete a site and everything under it in one atomic write
function deleteSite(siteId, label) {
    deletingSite = true;
    refreshSiteDeleteButton();
    Promise.resolve()
        .then(() => data.deleteSiteCascade(siteId))
        .then(() => {
            showToast(`Site "${label}" and its materials deleted`);
            if (deletingSiteId === siteId) {
                closeSiteDelete();
            }
        })
        .catch(reportError) // the modal stays open so the user can retry
        .finally(() => {
            deletingSite = false;
            refreshSiteDeleteButton();
        });
}

// ---- Members ------------------------------------------------------------------------

function openMembers() {
    const site = sitesById[currentSiteId];
    if (!site) {
        return;
    }
    stopMembersListener();
    membersSiteId = currentSiteId;
    const manage = canManageSite(site.role);
    inviteSection.hidden = !manage;
    leaveSiteButton.hidden = manage; // the owner cannot leave; they delete the site
    disarmLeave();
    memberList.replaceChildren();
    pendingInviteList.replaceChildren();
    openDialog(membersContainer, { focus: membersClose, opener: membersButton });
    stopMembers = data.subscribeMembers(membersSiteId, { withInvites: manage }, (state) => {
        if (membersSiteId) {
            renderMembers(state);
        }
    }, reportError);
}

function stopMembersListener() {
    if (stopMembers) {
        stopMembers();
        stopMembers = null;
    }
}

function closeMembers() {
    closeDialog(membersContainer);
    resetMembers();
}

function resetMembers() {
    stopMembersListener();
    membersSiteId = null;
    disarmLeave();
}

function shortUid(uid) {
    return `User ${String(uid).slice(0, 6)}`;
}

// Emails and ids are other people's text: textContent only.
function renderMembers({ members, invites }) {
    const site = sitesById[membersSiteId];
    const manage = Boolean(site) && canManageSite(site.role);
    memberList.replaceChildren();
    for (const member of members) {
        const item = document.createElement('li');
        item.dataset.uid = member.uid;
        const name = document.createElement('span');
        name.className = 'member-name';
        name.textContent = (member.email || shortUid(member.uid)) + (member.uid === currentUser.uid ? ' (you)' : '');
        item.appendChild(name);

        if (manage && member.role !== 'owner') {
            const select = document.createElement('select');
            select.setAttribute('aria-label', `Role of ${member.email || shortUid(member.uid)}`);
            fillOptions(select, INVITE_ROLES, null, roleLabel);
            select.value = member.role;
            select.addEventListener('change', () => {
                Promise.resolve()
                    .then(() => data.changeRole(membersSiteId, member.uid, select.value))
                    .then(() => showToast(`${member.email || shortUid(member.uid)} is now ${roleLabel(select.value)}`))
                    .catch((error) => {
                        select.value = member.role;
                        reportError(error);
                    });
            });
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'remove-member';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => {
                remove.disabled = true;
                Promise.resolve()
                    .then(() => data.removeMember(membersSiteId, member.uid))
                    .then(() => showToast(`Removed ${member.email || shortUid(member.uid)}`))
                    .catch((error) => {
                        remove.disabled = false;
                        reportError(error);
                    });
            });
            item.append(select, remove);
        } else {
            const role = document.createElement('span');
            role.className = 'member-role';
            role.textContent = roleLabel(member.role);
            item.appendChild(role);
        }
        memberList.appendChild(item);
    }

    pendingInviteList.replaceChildren();
    if (manage && invites.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'hint';
        empty.textContent = 'No pending invitations.';
        pendingInviteList.appendChild(empty);
    }
    for (const invite of manage ? invites : []) {
        const item = document.createElement('li');
        item.dataset.key = invite.key;
        const name = document.createElement('span');
        name.className = 'member-name';
        name.textContent = invite.email;
        const role = document.createElement('span');
        role.className = 'member-role';
        role.textContent = roleLabel(invite.role);
        const revoke = document.createElement('button');
        revoke.type = 'button';
        revoke.className = 'revoke-invite';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', () => {
            revoke.disabled = true;
            Promise.resolve()
                .then(() => data.revokeInvite(membersSiteId, invite.key))
                .catch((error) => {
                    revoke.disabled = false;
                    reportError(error);
                });
        });
        item.append(name, role, revoke);
        pendingInviteList.appendChild(item);
    }
}

function sendInvite() {
    const site = sitesById[membersSiteId];
    if (!site || !canManageSite(site.role)) {
        return;
    }
    const result = validateInvite({ email: inviteEmailInput.value, role: inviteRoleSelect.value }, currentUser.email);
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    inviteSubmit.disabled = true;
    Promise.resolve()
        .then(() => data.inviteMember({ id: membersSiteId, name: siteLabel(site) }, currentUser, result.value))
        .then(() => {
            inviteForm.reset();
            // Nothing is emailed from here. Say so, or the owner waits for a reply that cannot come.
            showToast(`Invite saved for ${result.value.email}. Ask them to sign in with that email.`);
        })
        .catch(reportError)
        .finally(() => { inviteSubmit.disabled = false; });
}

function disarmLeave() {
    leaveArmed = false;
    clearTimeout(leaveTimer);
    leaveSiteButton.textContent = 'Leave site';
}

// Two taps: the first arms the button, the second leaves. There is no Undo for this, because
// coming back needs a new invitation.
function leaveSite() {
    const siteId = membersSiteId;
    const site = sitesById[siteId];
    if (!site || canManageSite(site.role)) {
        return;
    }
    if (!leaveArmed) {
        leaveArmed = true;
        leaveSiteButton.textContent = 'Tap again to leave';
        leaveTimer = setTimeout(disarmLeave, LEAVE_ARM_MS);
        return;
    }
    disarmLeave();
    Promise.resolve()
        .then(() => data.removeMember(siteId, currentUser.uid))
        .then(() => showToast(`You left ${siteLabel(site)}`))
        .catch(reportError);
}
