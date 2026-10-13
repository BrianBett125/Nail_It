import * as data from "./src/data.js";
import { validateSite, validateMaterial, validateMaterialEdit } from "./src/logic.js";

// DOM Elements
const addSiteBtn = document.getElementById('addSiteButton');
const addSiteContainer = document.getElementById('siteFormContainer');
const siteForm = document.getElementById('siteForm');
const siteCancelBtn = document.getElementById('cancelButton');
const siteList = document.getElementById('siteList');
const materialContainer = document.getElementById('materialFormContainer');
const materialForm = document.getElementById('materialForm');
const addMaterialButton = document.getElementById('addMaterialButton');
const materialCancelButton = document.getElementById('materialCancelButton');
const tableBody = document.getElementById("materialTableBody");
const delForm = document.getElementById('deleteFormContainer');
const delCancelButton = document.getElementById('delCancelButton');
const delYesBtn = document.getElementById('del-yes-btn');
const updateContainer = document.getElementById('updateFormContainer');
const updateForm = document.getElementById('updateForm');
const updateCancelButton = document.getElementById('updateCancelButton');

const updateSubmitBtn = document.getElementById('update-material-btn');

// State. The ids live here and are read at submit time, never captured in a handler
// that gets added more than once.
let currentSiteId = null;
let unsubscribeMaterials = null;
let editingMaterialId = null;
let deletingMaterialId = null;
const savingMaterials = new Set();   // ids with an edit sent but not yet acknowledged
const removingMaterials = new Set(); // ids with a delete sent but not yet acknowledged

const UNNAMED_SITE = "(unnamed site)";

// A legacy site may have no name, or only spaces: either would render an invisible link.
function siteLabel(site) {
    return String(site.name ?? "").trim() || UNNAMED_SITE;
}

function reportError(error) {
    alert(error.message);
}

// Event Listeners
addSiteBtn.addEventListener('click', () => {
    addSiteContainer.style.display = 'block';
});

siteCancelBtn.addEventListener('click', () => {
    addSiteContainer.style.display = 'none';
});

siteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addNewSite();
});

addMaterialButton.addEventListener('click', () => {
    materialContainer.style.display = 'block';
});

materialCancelButton.addEventListener('click', () => {
    materialContainer.style.display = 'none';
});

materialForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addNewMaterial();
});

delCancelButton.addEventListener('click', () => {
    deletingMaterialId = null;
    delForm.style.display = 'none';
    refreshModalButtons();
});

delYesBtn.addEventListener('click', () => {
    if (deletingMaterialId && !removingMaterials.has(deletingMaterialId)) {
        deleteMaterial(deletingMaterialId);
    }
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

// Function to add new site data to Firebase
function addNewSite() {
    const result = validateSite({
        name: document.getElementById('siteName').value,
        location: document.getElementById('siteLocation').value,
        buildingType: document.getElementById('buildingType').value,
        date: document.getElementById('metadataDate').value,
    });
    if (!result.ok) {
        alert(result.error);
        return;
    }
    data.addSite(result.value).done.catch(reportError);
    siteForm.reset();
    alert('Added successfully!');
    addSiteContainer.style.display = 'none';
}

// Function to add a new material to Firebase
function addNewMaterial() {
    const result = validateMaterial({
        name: document.getElementById('materialsName').value,
        quantity: document.getElementById('mQuantity').value,
        units: document.getElementById('mUnits').value,
        lastUpdated: document.getElementById('mLastUpdated').value,
    }, currentSiteId);
    if (!result.ok) {
        alert(result.error);
        return;
    }
    data.addMaterial(result.value).done.catch(reportError);
    materialForm.reset();
    alert("Material added successfully!");
    materialContainer.style.display = 'none';
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
    siteList.replaceChildren();
    for (const [siteId, site] of Object.entries(sites)) {
        siteList.appendChild(buildSiteItem(siteId, site));
    }
    if (currentSiteId && !sites[currentSiteId]) {
        clearSelection();
    }
}

// Fetch and display sites in the sidebar
data.subscribeSites(renderSites, reportError);

function clearSelection() {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
        unsubscribeMaterials = null;
    }
    currentSiteId = null;
    tableBody.replaceChildren();
    closeMaterialModals();
}

// An edit or delete confirmation names one material. When the material is gone (deleted
// by someone else, or its site was removed) the modal must close, or submitting it would
// make update() recreate the material as an orphan node with no siteId.
function closeMaterialModals() {
    editingMaterialId = null;
    updateContainer.style.display = 'none';
    deletingMaterialId = null;
    delForm.style.display = 'none';
    refreshModalButtons();
}

// Select a site: drop the previous materials subscription before opening the next one.
function selectSite(siteId) {
    if (unsubscribeMaterials) {
        unsubscribeMaterials();
    }
    currentSiteId = siteId;
    siteList.querySelectorAll('a').forEach(link => {
        link.classList.toggle('active', link.dataset.siteId === siteId);
    });
    tableBody.replaceChildren();
    unsubscribeMaterials = data.subscribeMaterials(siteId, (materials) => {
        if (siteId === currentSiteId) { // ignore a late callback from a site we left
            renderMaterials(materials);
        }
    }, reportError);
}

function renderMaterials(materials) {
    tableBody.replaceChildren();
    for (const [materialId, material] of Object.entries(materials)) {
        addMaterialRow(materialId, material);
    }
    if ((editingMaterialId && !materials[editingMaterialId])
        || (deletingMaterialId && !materials[deletingMaterialId])) {
        closeMaterialModals();
    }
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
    deleteCell.querySelector("button").addEventListener("click", () => {
        showDeleteConfirmation(materialId);
    });

    newRow.append(nameCell, quantityCell, unitsCell, lastUpdatedCell, updateCell, deleteCell);
    tableBody.appendChild(newRow);
}

// Function to show the update form and populate it with material data
function showUpdateForm(materialId, materialData) {
    editingMaterialId = materialId;
    updateContainer.style.display = 'block';
    // ?? "" so a legacy record with a missing field shows an empty input, not the text "undefined".
    document.getElementById('uMaterialName').value = materialData.name ?? "";
    document.getElementById('uQuantity').value = materialData.quantity ?? "";
    document.getElementById('uUnits').value = materialData.units ?? "";
    document.getElementById('uLastUpdated').value = materialData.lastUpdated ?? "";
    refreshModalButtons();
}

// The Update and Yes buttons are locked per material while its write is unacknowledged
// (slow or no signal), so a repeated tap cannot send it twice. Another material is unaffected.
function refreshModalButtons() {
    const saving = savingMaterials.has(editingMaterialId);
    updateSubmitBtn.disabled = saving;
    updateSubmitBtn.textContent = saving ? 'Saving...' : 'Update';
    const removing = removingMaterials.has(deletingMaterialId);
    delYesBtn.disabled = removing;
    delYesBtn.textContent = removing ? 'Deleting...' : 'Yes';
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
    });
    if (!result.ok) {
        alert(result.error);
        return;
    }
    savingMaterials.add(materialId);
    refreshModalButtons();
    // Promise.resolve().then so a synchronous throw still reaches catch and finally.
    Promise.resolve()
        .then(() => data.updateMaterial(materialId, result.value))
        .then(() => {
            alert("Material Updated successfully!");
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

// Function to show delete confirmation
function showDeleteConfirmation(materialId) {
    deletingMaterialId = materialId;
    delForm.style.display = 'block';
    refreshModalButtons();
}

// Function to delete material data from Firebase
function deleteMaterial(materialId) {
    removingMaterials.add(materialId);
    refreshModalButtons();
    Promise.resolve()
        .then(() => data.removeMaterial(materialId))
        .then(() => {
            alert("Material deleted successfully!");
            if (deletingMaterialId === materialId) {
                deletingMaterialId = null;
                delForm.style.display = 'none';
            }
        })
        .catch(reportError)
        .finally(() => {
            removingMaterials.delete(materialId);
            refreshModalButtons();
        });
}

// Function to show delete site confirmation
function showDeleteSiteConfirmation(siteId) {
    if (confirm("Do you want to delete this site?")) {
        deleteSite(siteId);
    }
}

// Function to delete a site and its associated materials in one atomic write
function deleteSite(siteId) {
    data.deleteSiteCascade(siteId)
        .then(() => {
            alert("Site and its materials deleted successfully!");
        })
        .catch(reportError);
}
