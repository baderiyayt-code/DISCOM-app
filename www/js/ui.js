// UI, Forms, Modals and Export Logic

function showToast(msg) {
    const toast = document.getElementById('app-toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.add('show'); 
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function toggleSpeedDial(force) {
    const dial = document.getElementById('speed-dial-menu');
    const fab = document.getElementById('mainFabBtn');
    const isOpen = force !== undefined ? force : !dial.classList.contains('active');
    dial.classList.toggle('active', isOpen);
    fab.classList.toggle('open', isOpen);
}

function toggleSidebar(open) { 
    document.getElementById('sidebar-drawer').classList.toggle('open', open); 
    document.getElementById('sidebarBackdrop').classList.toggle('open', open); 
}

function openModal(html) { 
    document.getElementById('modalSheetContent').innerHTML = html; 
    document.getElementById('formModalOverlay').classList.add('open'); 
}
function closeModal() { document.getElementById('formModalOverlay').classList.remove('open'); }

// Crosshairs / Location Picker Logic
function openAddForm(type) {
    toggleSpeedDial(false); 
    appState.placementType = type; 
    document.getElementById('center-placement-pin').style.display = 'block'; 
    document.getElementById('bottom-single-action').style.display = 'none'; 
    document.getElementById('placement-confirm-bar').style.display = 'flex';
}

function cancelPlacement() { 
    document.getElementById('center-placement-pin').style.display = 'none'; 
    document.getElementById('placement-confirm-bar').style.display = 'none'; 
    document.getElementById('bottom-single-action').style.display = 'block'; 
}

function confirmPlacement() {
    cancelPlacement();
    const center = map.getCenter();
    const lat = center.lat.toFixed(6);
    const lng = center.lng.toFixed(6);
    
    // Show respective form based on type
    if(appState.placementType === 'POLE') {
        openModal(`
            <div class="sheet-head">Add HT Pole <i class="fa-solid fa-xmark" onclick="closeModal()"></i></div>
            <input type="number" id="inpPoleNo" class="form-input" placeholder="Pole Number">
            <button class="btn-action-primary" onclick="saveNewPole('${lat}', '${lng}')">Save HT Pole</button>
        `);
    } else if (appState.placementType === 'LTPOLE') {
        openModal(`
            <div class="sheet-head">Add LT Pole <i class="fa-solid fa-xmark" onclick="closeModal()"></i></div>
            <input type="number" id="inpPoleNo" class="form-input" placeholder="LT Pole Number">
            <button class="btn-action-primary" onclick="saveNewLTPole('${lat}', '${lng}')">Save LT Pole</button>
        `);
    } else if (appState.placementType === 'DT') {
        openModal(`
            <div class="sheet-head">Add DT <i class="fa-solid fa-xmark" onclick="closeModal()"></i></div>
            <input type="number" id="inpDTCode" class="form-input" placeholder="DT Code">
            <input type="number" id="inpDTRating" class="form-input" placeholder="Rating (kVA)" value="25">
            <button class="btn-action-primary" onclick="saveNewDT('${lat}', '${lng}')">Save DT</button>
        `);
    }
}

// Save Data logic using Secure UUID
function saveNewPole(lat, lng) {
    const no = document.getElementById('inpPoleNo').value;
    if(!no) return alert("Enter pole number");
    saveSnapshot();
    getActiveNetwork().poles.push({ id: generateUUID(), poleNo: no, lineType: 'HT', lat: parseFloat(lat), lng: parseFloat(lng) });
    closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Pole Added!");
}

function saveNewLTPole(lat, lng) {
    const no = document.getElementById('inpPoleNo').value;
    if(!no) return alert("Enter LT pole number");
    saveSnapshot();
    getActiveNetwork().poles.push({ id: generateUUID(), poleNo: no, lineType: 'LT', lat: parseFloat(lat), lng: parseFloat(lng) });
    closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("LT Pole Added!");
}

function saveNewDT(lat, lng) {
    const code = document.getElementById('inpDTCode').value;
    const rating = document.getElementById('inpDTRating').value;
    if(!code) return alert("Enter DT code");
    saveSnapshot();
    getActiveNetwork().dts.push({ id: generateUUID(), code: code, rating: rating, lat: parseFloat(lat), lng: parseFloat(lng) });
    closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT Added!");
}

function deleteEntity(type, id) {
    if(!confirm("Delete this item?")) return;
    saveSnapshot();
    const net = getActiveNetwork();
    if (type === 'pole') net.poles = net.poles.filter(x => x.id !== id);
    if (type === 'dt') net.dts = net.dts.filter(x => x.id !== id);
    renderEntireNetwork(); triggerPersistence(); map.closePopup(); showToast("Deleted!");
}

// BUG FIX: Secure Export for Mobile (Web Share API)
async function exportDataToCSV() {
    toggleSidebar(false);
    const net = getActiveNetwork();
    let csv = "WKT,Name,Type\n";
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})",Pole ${p.poleNo},POLE\n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})",DT ${d.code},DT\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})",${c.name},CONSUMER\n`);
    
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const filename = `${net.feeder.name.replace(/\s+/g, '_')}_Data.csv`;
    const file = new File([blob], filename, { type: "text/csv" });

    // Native Mobile Share Dialog (Avoids Android 11 Scoped Storage Issue)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: filename, files: [file] }).catch(()=>{});
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        a.click(); URL.revokeObjectURL(url);
    }
    showToast("Export Triggered");
}

function generateCadSLDPdf() {
    toggleSidebar(false);
    showToast("PDF Exporting... (Not implemented in this demo script yet, use logic from original)");
    // Add your original jsPDF logic here
}

// Boot up App
document.addEventListener('DOMContentLoaded', () => {
    localforage.getItem(CONFIG.DB_KEY).then(data => {
        if(data) appState = data;
        document.getElementById('splash-screen').classList.add('hidden');
        if (appState.user && appState.user.isLoggedIn) {
            document.getElementById('app-container').style.display = 'flex';
            document.getElementById('userNameDisplay').innerText = appState.user.name;
            document.getElementById('userEmailDisplay').innerText = appState.user.email;
            renderEntireNetwork();
        } else {
            document.getElementById('auth-screen').style.display = 'flex';
        }
    });
});
