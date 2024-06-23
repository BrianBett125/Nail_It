import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, push, update, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase configuration
const appSettings = {
    databaseURL: "https://nail-it-8f766-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = initializeApp(appSettings);
const db = getDatabase(app);

const sitesRef = ref(db, 'sites');
const materialsRef = ref(db, 'materials');

// DOM Elements
const addSiteBtn = document.getElementById('addSiteButton');
const addSiteForm = document.getElementById('siteFormContainer');
const siteCancelBtn = document.getElementById('cancelButton');
const addSiteFormBtn = document.getElementById('add-site-btn');
const siteList = document.getElementById('siteList');
const materialForm = document.getElementById('materialFormContainer');
const addMaterialButton = document.getElementById('addMaterialButton');
const materialCancelButton = document.getElementById('materialCancelButton');
const materialBtn = document.getElementById('material-btn');
const tableBody = document.getElementById("materialTableBody");
const delForm = document.getElementById('deleteFormContainer');
const delCancelButton = document.getElementById('delCancelButton');
const delYesBtn = document.getElementById('del-yes-btn');
const updateForm = document.getElementById('updateFormContainer');
const updateCancelButton = document.getElementById('updateCancelButton');
const updateBtn = document.getElementById('update-material-btn');

let currentSiteId = null;

// Event Listeners
addSiteBtn.addEventListener('click', () => {
    addSiteForm.style.display = 'block';
});

siteCancelBtn.addEventListener('click', () => {
    addSiteForm.style.display = 'none';
});

addSiteFormBtn.addEventListener('click', getNewSiteData);

addMaterialButton.addEventListener('click', () => {
    materialForm.style.display = 'block';
});

materialCancelButton.addEventListener('click', () => {
    materialForm.style.display = 'none';
});

materialBtn.addEventListener('click', addNewMaterial);

delCancelButton.addEventListener('click', () => {
    delForm.style.display = 'none';
});

updateCancelButton.addEventListener('click', () => {
    updateForm.style.display = 'none';
});

updateBtn.addEventListener('click', updateMaterial);

// Function to add new site data to Firebase
function getNewSiteData() {
    const siteName = document.getElementById('siteName').value;
    const siteLocation = document.getElementById('siteLocation').value;
    const buildingType = document.getElementById('buildingType').value;
    const date = document.getElementById('metadataDate').value;
    if (siteName && siteLocation && buildingType && date) {
        push(sitesRef, { name: siteName, location: siteLocation, buildingType: buildingType, date: date });
        alert('Added successfully!');
        addSiteForm.style.display = 'none';
    } else {
        alert('Please fill in all required fields');
    }
}

// Function to add a new material to Firebase
function addNewMaterial() {
    const materialName = document.getElementById('materialsName').value;
    const quantity = document.getElementById('mQuantity').value;
    const units = document.getElementById('mUnits').value;
    const lastUpdated = document.getElementById('mLastUpdated').value;

    if (materialName && quantity && units && lastUpdated && currentSiteId) {
        const newMaterialRef = push(materialsRef);
        update(newMaterialRef, { name: materialName, quantity, units, lastUpdated, siteId: currentSiteId });
        alert("Material added successfully!");
        materialForm.style.display = 'none';
    } else {
        alert("Please fill in all required fields");
    }
}

// Fetch and display sites in the sidebar
onValue(sitesRef, (snapshot) => {
    siteList.innerHTML = '';
    const sitesData = snapshot.val();
    if (sitesData) {
        for (const siteId in sitesData) {
            const site = sitesData[siteId];
            const siteElement = document.createElement('li');
            siteElement.innerHTML = `<a href="#" data-site-id="${siteId}">${site.name}</a> <button class="delete-site-btn" data-site-id="${siteId}"><i class='fas fa-trash-alt'></i></button>`;
            siteList.appendChild(siteElement);
        }
    }
    attachSiteEventListeners();
});

// Attach event listeners to each site link and delete button in the sidebar
function attachSiteEventListeners() {
    const siteLinks = siteList.querySelectorAll('a');
    const deleteSiteButtons = siteList.querySelectorAll('.delete-site-btn');
    
    siteLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            siteLinks.forEach(link => link.classList.remove('active')); // Remove 'active' class from all links
            event.target.classList.add('active'); // Add 'active' class to the selected link
            currentSiteId = event.target.dataset.siteId;
            fetchAndDisplayMaterials(currentSiteId);
        });
    });

    deleteSiteButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent triggering the site link click event
            const siteId = event.target.dataset.siteId;
            showDeleteSiteConfirmation(siteId);
        });
    });
}

// Fetch and display materials for the selected site
function fetchAndDisplayMaterials(siteId) {
    onValue(materialsRef, (snapshot) => {
        const materialsData = snapshot.val();
        tableBody.innerHTML = '';
        if (materialsData) {
            for (const materialId in materialsData) {
                const material = materialsData[materialId];
                if (material.siteId === siteId) {
                    addMaterialRow(materialId, material);
                }
            }
        } else {
            console.log("No materials found!");
        }
    });
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
    updateCell.innerHTML = "<button><i class='fa-regular fa-pen-to-square'></i></button>";
    const deleteCell = document.createElement("td");
    deleteCell.innerHTML = "<button><i class='fas fa-trash-alt'></i></button>";

    const updateButton = updateCell.querySelector("button");
    updateButton.addEventListener("click", () => {
        showUpdateForm(materialId, materialData);
    });

    const deleteButton = deleteCell.querySelector("button");
    deleteButton.addEventListener("click", () => {
        showDeleteConfirmation(materialId);
    });

    newRow.appendChild(nameCell);
    newRow.appendChild(quantityCell);
    newRow.appendChild(unitsCell);
    newRow.appendChild(lastUpdatedCell);
    newRow.appendChild(updateCell);
    newRow.appendChild(deleteCell);
    tableBody.appendChild(newRow);
}

// Function to show the update form and populate it with material data
function showUpdateForm(materialId, materialData) {
    updateForm.style.display = 'block';
    const materialName = document.getElementById('uMaterialName');
    const quantity = document.getElementById('uQuantity');
    const units = document.getElementById('uUnits');
    const lastUpdated = document.getElementById('uLastUpdated');

    materialName.value = materialData.name;
    quantity.value = materialData.quantity;
    units.value = materialData.units;
    lastUpdated.value = materialData.lastUpdated;

    updateBtn.onclick = () => {
        updateMaterial(materialId);
    };
}

// Function to update material data in Firebase
function updateMaterial(materialId) {
    const materialName = document.getElementById('uMaterialName').value;
    const quantity = document.getElementById('uQuantity').value;
    const units = document.getElementById('uUnits').value;
    const lastUpdated = document.getElementById('uLastUpdated').value;
    const materialToUpdate = ref(db, 'materials/' + materialId);

    update(materialToUpdate, { name: materialName, quantity, units, lastUpdated })
        .then(() => {
            alert("Material Updated successfully!");
            updateForm.style.display = 'none';
        })
        .catch((error) => {
            alert(error.message);
        });
}

// Function to show delete confirmation
function showDeleteConfirmation(materialId) {
    delForm.style.display = 'block';
    delYesBtn.onclick = () => {
        deleteMaterial(materialId);
    };
}

// Function to delete material data from Firebase
function deleteMaterial(materialId) {
    const materialToDelete = ref(db, 'materials/' + materialId);
    remove(materialToDelete)
        .then(() => {
            alert("Material deleted successfully!");
            delForm.style.display = 'none';
        })
        .catch((error) => {
            alert(error.message);
        });
}

// Function to show delete site confirmation
function showDeleteSiteConfirmation(siteId) {
    if (confirm("Do you want to delete this site?")) {
        deleteSite(siteId);
    }
}

// Function to delete a site and its associated materials
function deleteSite(siteId) {
    const siteToDelete = ref(db, 'sites/' + siteId);

    // Remove the site
    remove(siteToDelete)
        .then(() => {
            // Remove materials associated with the site
            onValue(materialsRef, (snapshot) => {
                const materialsData = snapshot.val();
                if (materialsData) {
                    for (const materialId in materialsData) {
                        if (materialsData[materialId].siteId === siteId) {
                            const materialToDelete = ref(db, 'materials/' + materialId);
                            remove(materialToDelete);
                        }
                    }
                }
            });
            alert("Site and its materials deleted successfully!");
        })
        .catch((error) => {
            alert(error.message);
        });
}
