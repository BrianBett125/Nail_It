import * as data from "./src/data.js";
import {
    validateSite,
    validateMaterial,
    validateMaterialEdit,
    suggestNames,
    todayISO,
    deletePhrase,
    phraseMatches,
    BUILDING_TYPES,
    UNITS,
    NO_SITE_MESSAGE,
} from "./src/logic.js";
import { showToast } from "./src/toast.js";

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

// State. The ids live here and are read at submit time, never captured in a handler
// that gets added more than once.
let currentSiteId = null;
let unsubscribeMaterials = null;
let editingMaterialId = null;
let editingLegacyUnit = null;        // the unit a legacy material had, if it is not in the dropdown
let deletingSiteId = null;
let deletingSite = false;            // the cascade delete is in flight
let sitesById = {};                  // latest sites snapshot
let currentMaterials = {};           // latest materials snapshot of the selected site
let sitesLoaded = false;
let materialsLoaded = false;
let sitesError = null;
let materialsError = null;
let restoredLastSite = false;
const unconfirmedSites = new Set();  // sites we just added whose first snapshot has not arrived
const savingMaterials = new Set();   // ids with an edit sent but not yet acknowledged

const UNNAMED_SITE = "(unnamed site)";
const LAST_SITE_KEY = "nailit.lastSite";
const NAMES_KEY = "nailit.materialNames";
const MAX_REMEMBERED_NAMES = 200;
const UNDO_MS = 8000;

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

function fillOptions(select, values, placeholder) {
    select.replaceChildren();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    }
}

// The dropdown lists come from src/logic.js, the same lists validation checks against.
fillOptions(document.getElementById('buildingType'), BUILDING_TYPES, 'Choose type');
fillOptions(document.getElementById('mUnits'), UNITS, 'Choose unit');
fillOptions(document.getElementById('uUnits'), UNITS, 'Choose unit');

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
        materialsStatus.textContent = "No materials yet. Add your first material.";
    } else {
        materialsStatus.textContent = "";
    }
    materialsStatus.hidden = materialsStatus.textContent === "";
    materialsTable.hidden = !currentSiteId || !materialsLoaded || rows === 0;
}

// Event Listeners
addSiteBtn.addEventListener('click', () => {
    addSiteContainer.style.display = 'block';
    document.getElementById('siteName').focus();
});

siteCancelBtn.addEventListener('click', () => {
    addSiteContainer.style.display = 'none';
});

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

materialCancelButton.addEventListener('click', () => {
    materialContainer.style.display = 'none';
});

materialForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const another = Boolean(event.submitter && event.submitter.id === 'material-another-btn');
    addNewMaterial(another);
});

updateCancelButton.addEventListener('click', () => {
    editingMaterialId = null;
    updateContainer.style.display = 'none';
    refreshModalButtons();
});

updateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateMaterial();
});

siteDeleteCancel.addEventListener('click', closeSiteDelete);

siteDeleteInput.addEventListener('input', refreshSiteDeleteButton);

siteDeleteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmSiteDelete();
});

// The date defaults to today, so a delivery entered on the day needs no date typing.
function openMaterialForm() {
    if (!document.getElementById('mLastUpdated').value) {
        document.getElementById('mLastUpdated').value = todayISO();
    }
    refreshNameSuggestions();
    materialContainer.style.display = 'block';
    materialNameInput.focus();
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
    const { id, done } = data.addSite(result.value);
    unconfirmedSites.add(id);
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
    addSiteContainer.style.display = 'none';
    selectSite(id);
    showToast(`Site "${result.value.name}" added`);
}

// Function to add a new material to Firebase. `another` keeps the form open for the next one.
function addNewMaterial(another) {
    const result = validateMaterial({
        name: materialNameInput.value,
        quantity: document.getElementById('mQuantity').value,
        units: document.getElementById('mUnits').value,
        lastUpdated: document.getElementById('mLastUpdated').value,
    }, currentSiteId, { knownNames: knownMaterialNames() });
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    data.addMaterial(result.value).done.catch(reportError);
    rememberName(result.value.name);
    showToast(`Added ${result.value.quantity} ${result.value.units} ${result.value.name}`);
    if (another) {
        // Keep unit and date: a delivery is usually several items of the same kind, same day.
        materialNameInput.value = '';
        document.getElementById('mQuantity').value = '';
        refreshNameSuggestions();
        materialNameInput.focus();
    } else {
        materialForm.reset();
        materialContainer.style.display = 'none';
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
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-site-btn';
    deleteButton.dataset.siteId = siteId;
    deleteButton.setAttribute('aria-label', `Delete site ${siteLabel(site)}`);
    const icon = document.createElement('i');
    icon.className = 'fas fa-trash-alt';
    deleteButton.appendChild(icon);
    deleteButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent triggering the site link click event
        showDeleteSiteConfirmation(siteId);
    });

    item.append(link, ' ', deleteButton);
    return item;
}

// Render the sidebar. The selected site stays highlighted across re-renders.
function renderSites(sites) {
    sitesById = sites;
    sitesLoaded = true;
    sitesError = null;
    siteList.replaceChildren();
    for (const [siteId, site] of Object.entries(sites)) {
        unconfirmedSites.delete(siteId);
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
    if (!restoredLastSite) {
        restoredLastSite = true;
        const last = storageGet(LAST_SITE_KEY);
        if (!currentSiteId && last && sites[last]) {
            selectSite(last);
        }
    }
    renderStatus();
}

// Fetch and display sites in the sidebar
data.subscribeSites(renderSites, (error) => {
    sitesError = error;
    renderStatus();
    reportError(error);
});

function clearSelection() {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
        unsubscribeMaterials = null;
    }
    currentSiteId = null;
    currentMaterials = {};
    materialsLoaded = false;
    materialsError = null;
    tableBody.replaceChildren();
    closeMaterialModals();
    renderStatus();
}

// An edit names one material. When the material is gone (deleted by someone else, or its
// site was removed) the modal must close, or submitting it would make update() recreate
// the material as an orphan node with no siteId.
function closeMaterialModals() {
    editingMaterialId = null;
    updateContainer.style.display = 'none';
    refreshModalButtons();
}

// Select a site: drop the previous materials subscription before opening the next one.
function selectSite(siteId) {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
    }
    currentSiteId = siteId;
    storageSet(LAST_SITE_KEY, siteId);
    siteList.querySelectorAll('a').forEach(link => {
        link.classList.toggle('active', link.dataset.siteId === siteId);
    });
    tableBody.replaceChildren();
    currentMaterials = {};
    materialsLoaded = false;
    materialsError = null;
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
    tableBody.replaceChildren();
    for (const [materialId, material] of Object.entries(materials)) {
        addMaterialRow(materialId, material);
    }
    if (editingMaterialId && !materials[editingMaterialId]) {
        closeMaterialModals();
    }
    if (materialContainer.style.display === 'block') {
        refreshNameSuggestions();
    }
    renderStatus();
}

// Function to add a material row to the table
function addMaterialRow(materialId, materialData) {
    const newRow = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = materialData.name;
    const quantityCell = document.createElement("td");
    quantityCell.textContent = materialData.quantity;
    const unitsCell = document.createElement("td");
    unitsCell.textContent = materialData.units;
    const lastUpdatedCell = document.createElement("td");
    lastUpdatedCell.textContent = materialData.lastUpdated;

    const updateCell = document.createElement("td");
    updateCell.innerHTML = "<button aria-label='Edit material'><i class='fa-regular fa-pen-to-square'></i></button>";
    const deleteCell = document.createElement("td");
    deleteCell.innerHTML = "<button aria-label='Delete material'><i class='fas fa-trash-alt'></i></button>";

    updateCell.querySelector("button").addEventListener("click", () => {
        showUpdateForm(materialId, materialData);
    });
    deleteCell.querySelector("button").addEventListener("click", (event) => {
        event.currentTarget.disabled = true; // a second tap before the row disappears does nothing
        deleteMaterial(materialId, materialData);
    });

    newRow.append(nameCell, quantityCell, unitsCell, lastUpdatedCell, updateCell, deleteCell);
    tableBody.appendChild(newRow);
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
    updateContainer.style.display = 'block';
    refreshNameSuggestions();
    // ?? "" so a legacy record with a missing field shows an empty input, not the text "undefined".
    document.getElementById('uMaterialName').value = materialData.name ?? "";
    document.getElementById('uQuantity').value = materialData.quantity ?? "";
    setEditUnits(materialData.units);
    document.getElementById('uLastUpdated').value = materialData.lastUpdated ?? "";
    refreshModalButtons();
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
    if (!materialId || savingMaterials.has(materialId)) {
        return;
    }
    const result = validateMaterialEdit({
        name: document.getElementById('uMaterialName').value,
        quantity: document.getElementById('uQuantity').value,
        units: document.getElementById('uUnits').value,
        lastUpdated: document.getElementById('uLastUpdated').value,
    }, { knownNames: knownMaterialNames(), legacyUnit: editingLegacyUnit });
    if (!result.ok) {
        showToast(result.error, { kind: "error" });
        return;
    }
    savingMaterials.add(materialId);
    refreshModalButtons();
    // Promise.resolve().then so a synchronous throw still reaches catch and finally.
    Promise.resolve()
        .then(() => data.updateMaterial(materialId, result.value))
        .then(() => {
            rememberName(result.value.name);
            showToast("Material updated");
            // The ack can arrive after the user moved on to another material. Only close
            // the modal if it still belongs to the edit that was sent.
            if (editingMaterialId === materialId) {
                editingMaterialId = null;
                updateContainer.style.display = 'none';
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
        .then(() => data.removeMaterial(materialId))
        .catch((error) => {
            toast.dismiss();
            reportError(error);
        });
}

function undoDelete(materialId, material, siteId) {
    // Restoring into a site that was deleted meanwhile would create an orphan.
    if (!sitesById[siteId]) {
        showToast("That site no longer exists, so the material was not restored.", { kind: "error" });
        return;
    }
    Promise.resolve()
        .then(() => data.restoreMaterial(materialId, material))
        .catch(reportError);
    showToast(`Restored ${material.name}`);
}

// The site name must be typed before the delete button works.
function showDeleteSiteConfirmation(siteId) {
    const site = sitesById[siteId];
    if (!site) {
        return;
    }
    deletingSiteId = siteId;
    siteDeletePhraseEl.textContent = deletePhrase(site);
    siteDeleteInput.value = '';
    refreshSiteDeleteButton();
    siteDeleteContainer.style.display = 'block';
    siteDeleteInput.focus();
}

function refreshSiteDeleteButton() {
    const site = sitesById[deletingSiteId];
    const matches = Boolean(site) && phraseMatches(siteDeleteInput.value, deletePhrase(site));
    siteDeleteConfirm.disabled = deletingSite || !matches;
    siteDeleteConfirm.textContent = deletingSite ? 'Deleting...' : 'Delete site';
}

function closeSiteDelete() {
    deletingSiteId = null;
    siteDeleteInput.value = '';
    siteDeleteContainer.style.display = 'none';
    refreshSiteDeleteButton();
}

function confirmSiteDelete() {
    const site = sitesById[deletingSiteId];
    if (deletingSite || !site || !phraseMatches(siteDeleteInput.value, deletePhrase(site))) {
        return; // Enter in the input must not bypass the typed-name check
    }
    deleteSite(deletingSiteId, siteLabel(site));
}

// Function to delete a site and its associated materials in one atomic write
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
