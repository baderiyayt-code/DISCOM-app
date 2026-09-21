const DB_KEY = "DISCOM_ENTERPRISE_DB";

// ======== SUPABASE INITIALIZATION ========
const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
let supabaseClient = null;
if (typeof supabase !== 'undefined') { supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
const ADMIN_EMAIL = 'admin@discom.com';

let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', darkMode: false },
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: "1",
    gssNodes: { "1": { code: "1", name: "132/33 kV Substation", lat: 26.9150, lng: 75.7830 } },
    feeders: { "1": { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] } },
    orphanPoleIds: new Set(), activeMove: null, placementType: null, unsyncedCount: 0,
    adminMode: false, adminStore: {}, tempGssNodes: {} // New Admin Powers
};

let historyStack = []; let map = null;

window.haptic = function(pattern) { if (window.cordova && navigator.vibrate) { navigator.vibrate(pattern); } }

function updateSyncUI() {
    const badge = document.getElementById('sync-badge');
    if(appState.unsyncedCount > 0 && !appState.adminMode) { badge.innerText = appState.unsyncedCount; badge.style.display = 'block'; } 
    else { badge.style.display = 'none'; }
}

const i18n = {
    en: { 
        line11: "11 KV Line", lineLT: "LT Line", dt3ph: "3-Ph DT", dt1ph: "1-Ph DT", totalCons: "Consumers",
        gssMgmt: "GSS Management", addNewGss: "Add New GSS", manageFdr: "Manage Feeders", 
        export: "Export Data", exportPdf: "Export SLD PDF", exportDxf: "Export DXF", exportKml: "Export KML", exportCsv: "Export CSV", 
        importLabel: "Backup & Restore", exportJson: "Export Backup", importJson: "Import Backup", system: "System", settings: "Settings", about: "About App",
        appLanguage: "Language", distUnit: "Distance Unit", gpsInterval: "GPS Polling", gpsAcc: "GPS Accuracy", resetData: "Reset App Data",
        confirmLoc: "Confirm Map Center Location", confirmHere: "Confirm Here", cancel: "Cancel", setNewLoc: "Set New Location", target: "Target",
        toastSettings: "Settings Saved!", toastDel: "Deleted Successfully!", toastImport: "Imported Successfully!",
        addFeeder: "Add Feeder", saveFeeder: "Save Feeder", searchObj: "Search K-No, Name...",
        htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", logout: "Logout"
    }
};

function t(key) { const lang = appState.settings.language || 'en'; return (i18n[lang] && i18n[lang][key]) ? i18n[lang][key] : (i18n['en'][key] || key); }
function translateApp() { document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if (el.tagName.toLowerCase() === 'input' && el.type === 'text') el.placeholder = t(key); else el.innerHTML = t(key); }); }

function getActiveNetwork() {
    if (!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = Object.keys(appState.feeders)[0] || "1";
    let net = appState.feeders[appState.currentFeederCode];
    if (!net) { net = { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] }; appState.feeders[appState.currentFeederCode] = net; }
    if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

// ==== ADMIN UNIFIED RENDER ENGINE ====
function getRenderNetwork() {
    if (!appState.adminMode) return getActiveNetwork();
    let flat = { feeder: {name: "Global Master View", code: "ALL", parentGss: "ALL"}, poles: [], dts: [], lines: [], consumers: [] };
    appState.tempGssNodes = {};
    Object.keys(appState.adminStore).forEach(uid => {
        const uData = appState.adminStore[uid];
        if (uData.gssNodes) Object.assign(appState.tempGssNodes, uData.gssNodes);
        if (uData.feeders) {
            Object.values(uData.feeders).forEach(f => {
                flat.poles.push(...(f.poles||[])); flat.dts.push(...(f.dts||[]));
                flat.lines.push(...(f.lines||[])); flat.consumers.push(...(f.consumers||[]));
            });
        }
    });
    return flat;
}

function getEntityContext(type, id) {
    if (!appState.adminMode) {
        return { obj: type==='GSS' ? appState.gssNodes[id] : (type==='POLE'||type==='LTPOLE' ? getActiveNetwork().poles : getActiveNetwork()[type.toLowerCase()+'s']).find(x=>x.id===id), net: getActiveNetwork(), ownerId: appState.user.id, gssRef: appState.gssNodes };
    } else {
        for (let uid of Object.keys(appState.adminStore)) {
            const uData = appState.adminStore[uid];
            if (type === 'GSS' && uData.gssNodes && uData.gssNodes[id]) return { obj: uData.gssNodes[id], net: null, ownerId: uid, gssRef: uData.gssNodes };
            for (let fCode of Object.keys(uData.feeders || {})) {
                const f = uData.feeders[fCode]; let list = [];
                if(type==='POLE' || type==='LTPOLE') list = f.poles; else if(type==='DT') list = f.dts; else if(type==='CONSUMER') list = f.consumers; else if(type==='LINE') list = f.lines;
                const obj = (list||[]).find(x=>x.id===id); if(obj) return { obj, net: f, ownerId: uid, gssRef: uData.gssNodes };
            }
        }
    } return null;
}

async function syncAdminEdit(ownerId) {
    if(!appState.adminMode) return;
    await supabaseClient.from('survey_data').update({ data: appState.adminStore[ownerId], updated_at: new Date().toISOString() }).eq('user_id', ownerId);
    showToast("Live Cloud Updated!");
}

function showToast(msg) {
    const toast = document.getElementById('app-toast'); document.getElementById('toast-msg').innerText = msg;
    toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
}

function setSyncStatus(status) {
    const ind = document.getElementById('sync-indicator');
    if(appState.adminMode) { ind.innerHTML = '<i class="fa-solid fa-user-shield" style="color:#3b82f6;"></i>'; return; }
    if(!navigator.onLine) status = 'offline';
    if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>';
    else if(status === 'synced') { ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success"></i>'; appState.unsyncedCount = 0; updateSyncUI(); triggerPersistence(false); }
    else ind.innerHTML = `<i class="fa-solid fa-cloud-xmark sync-error"></i><span class="sync-badge" id="sync-badge" style="display:${appState.unsyncedCount>0?'block':'none'};">${appState.unsyncedCount}</span>`;
}

window.syncToSupabase = function(manual = false) {
    if(appState.adminMode) { fetchMasterDataForAdmin(); return; }
    if (manual) window.haptic(15);
    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; setSyncStatus('syncing');
    const dataToSync = JSON.parse(JSON.stringify(appState)); delete dataToSync.user; delete dataToSync.orphanPoleIds;
    supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: dataToSync, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).then(({error}) => { if(error) setSyncStatus('offline'); else setSyncStatus('synced'); }).catch(() => setSyncStatus('offline'));
}

async function pullFromSupabase() {
    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; setSyncStatus('syncing');
    if (appState.user.email === ADMIN_EMAIL) { await fetchMasterDataForAdmin(); return; }
    try {
        const { data, error } = await supabaseClient.from('survey_data').select('data').eq('user_id', appState.user.id); if (error) throw error;
        if (data && data.length > 0) {
            const cloudData = data[0].data; appState.feeders = cloudData.feeders || appState.feeders; appState.gssNodes = cloudData.gssNodes || appState.gssNodes; appState.currentFeederCode = cloudData.currentFeederCode || appState.currentFeederCode; appState.unsyncedCount = cloudData.unsyncedCount || 0;
            if (typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState);
            renderEntireNetwork(); setSyncStatus('synced'); centerMapOnGSS(); updateSyncUI();
        }
    } catch (err) { setSyncStatus('offline'); }
}

async function fetchMasterDataForAdmin() {
    showToast("Loading entire city map..."); appState.adminMode = true; appState.adminStore = {};
    const { data, error } = await supabaseClient.from('survey_data').select('*');
    if (error) { alert("Admin Fetch Error: " + error.message); return; }
    data.forEach(row => { appState.adminStore[row.user_id] = row.data; });
    renderEntireNetwork();
}

function triggerPersistence(incrementSync = true) { 
    if(appState.adminMode) return; // Admins save straight to cloud
    if(incrementSync) { appState.unsyncedCount = (appState.unsyncedCount || 0) + 1; updateSyncUI(); }
    if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState).catch(() => localStorage.setItem(DB_KEY, JSON.stringify(appState))); else localStorage.setItem(DB_KEY, JSON.stringify(appState)); syncToSupabase(); 
}

function applyAuthUIVisuals() {
    document.getElementById('auth-screen').style.display = 'none'; document.getElementById('app-container').style.display = 'flex';
    document.getElementById('userNameDisplay').innerText = appState.user.name; document.getElementById('userEmailDisplay').innerText = appState.user.email;
    if(appState.user.email === ADMIN_EMAIL) { document.getElementById('feederSelectHeader').style.display = 'none'; }
}

window.handleSupabaseAuth = async function(mode) {
    if(!supabaseClient) return alert("Network Error"); const email = document.getElementById('authEmail').value.trim(), password = document.getElementById('authPassword').value.trim();
    if(!email || !password) return alert("Required"); showToast("Authenticating..."); let response;
    if (mode === 'signup') { const name = document.getElementById('authName').value.trim(); response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } }); } else response = await supabaseClient.auth.signInWithPassword({ email, password });
    if (response.error) alert(response.error.message);
    else if (response.data.user) {
        appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
        applyAuthUIVisuals(); setupRealtimeListeners(); pullFromSupabase(); showToast("Logged In!");
    }
}
window.handleSupabaseLogout = async function() { await supabaseClient.auth.signOut(); if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.clear(); location.reload(); }

function setupRealtimeListeners() {
    if (!supabaseClient || appState.adminMode) return; // Surveyors receive real-time push from admins
    supabaseClient.channel('custom-all-channel')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'survey_data', filter: `user_id=eq.${appState.user.id}` }, (payload) => {
        const newData = payload.new.data;
        if(newData) {
            appState.feeders = newData.feeders || appState.feeders;
            appState.gssNodes = newData.gssNodes || appState.gssNodes;
            if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState);
            renderEntireNetwork(); window.haptic([50,50,50]); showToast("Admin updated your map live!");
        }
    }).subscribe();
}

let featureGroups = {}; let tileLayers = {}; let layerKeys = []; let currentTileIndex = 0;

window.capturePhoto = function(targetId) {
    if (window.cordova && navigator.camera) {
        navigator.camera.getPicture(function(imageData) { const b64 = "data:image/jpeg;base64," + imageData; document.getElementById(targetId).value = b64; const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = b64; prev.style.display = 'block'; } }, function(err) { showToast("Camera canceled."); }, { quality: 40, destinationType: navigator.camera.DestinationType.DATA_URL, targetWidth: 600, targetHeight: 600, correctOrientation: true });
    } else {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
        input.onchange = e => { const file = e.target.files[0]; const reader = new FileReader(); reader.onload = ev => { const res = ev.target.result; document.getElementById(targetId).value = res; const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = res; prev.style.display = 'block'; } }; if(file) reader.readAsDataURL(file); }; input.click();
    }
}

function initMapSystem() {
    if(map) return; 
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([26.9150, 75.7830], 16);
    map.on('click', () => window.closeObjectSheet()); 

    function updateMapZoomClasses() {
        if(!map) return; const z = map.getZoom(); const mapEl = document.getElementById('map');
        mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-dt', 'hide-gss-square');
        map.removeLayer(featureGroups.consumers); map.removeLayer(featureGroups.consumerLines); map.removeLayer(featureGroups.ltPoles); map.removeLayer(featureGroups.ltLines); map.removeLayer(featureGroups.htPoles); map.removeLayer(featureGroups.dts); map.removeLayer(featureGroups.gss);
        if (z > 18) { map.addLayer(featureGroups.consumerLines); map.addLayer(featureGroups.consumers); }
        if (z > 17) { map.addLayer(featureGroups.ltPoles); }
        if (z > 16) { map.addLayer(featureGroups.ltLines); }
        if (z > 15) { map.addLayer(featureGroups.htPoles); }
        if (z > 14) { map.addLayer(featureGroups.dts); map.addLayer(featureGroups.gss); }
        if (z <= 13) mapEl.classList.add('hide-gss-square'); else mapEl.classList.remove('hide-gss-square');
    }
    map.on('zoomend', updateMapZoomClasses); 

    tileLayers = { hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, street: { name: 'Google Street', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) } };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    window.toggleMapLayer = function() { window.haptic(15); map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name; }

    featureGroups = { gss: L.featureGroup().addTo(map), htLines: L.featureGroup().addTo(map), ltLines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map), htPoles: L.featureGroup().addTo(map), ltPoles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) };
    
    map.on('move', () => { 
        const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        if (document.getElementById('center-placement-pin').style.display === 'block') {
            const net = getRenderNetwork(); const gssMap = appState.adminMode ? appState.tempGssNodes : appState.gssNodes;
            let nodes = [...net.poles, ...net.dts]; if(!appState.adminMode && gssMap[net.feeder.parentGss]) nodes.push(gssMap[net.feeder.parentGss]);
            if(nodes.length > 0) {
                let nearest = nodes[0]; let minDist = window.calcDistance(c.lat, c.lng, nearest.lat, nearest.lng);
                for(let n of nodes) { let d = window.calcDistance(c.lat, c.lng, n.lat, n.lng); if(d < minDist) { minDist = d; nearest = n; } }
                const distEl = document.getElementById('live-distance-meter'); distEl.innerText = `Nearest Node: ${window.formatDistance(minDist)}`; distEl.style.display = 'block';
            }
        } else { document.getElementById('live-distance-meter').style.display = 'none'; }
    });
    setTimeout(updateMapZoomClasses, 100);
}

function centerMapOnGSS() { if(!map || appState.adminMode) return; const net = getActiveNetwork(); const gss = appState.gssNodes[net.feeder.parentGss]; setTimeout(() => { map.invalidateSize(); }, 200); if (gss && typeof gss.lat === 'number') map.setView([gss.lat, gss.lng], 16); }

/* ====== BOTTOM SHEET UI LOGIC ====== */
window.openObjectSheet = function(type, id) {
    window.haptic(15); const ctx = getEntityContext(type, id); if(!ctx) return;
    const obj = ctx.obj; let title = '', subtitle = '', details = '', photo = obj.photo, actions = '';
    
    if (type === 'POLE') {
        let displayNo = obj.poleNo; if (obj.lineType === 'LT' && String(obj.poleNo).includes('-')) displayNo = String(obj.poleNo).split('-')[1];
        title = `Pole: ${displayNo}`; subtitle = `${obj.lineType || 'HT'} Line Pole`;
        details = `<div class="info-grid"><div class="info-item"><span>Parent Node</span><b>${obj.dtCode || 'Feeder'}</b></div><div class="info-item"><span>Structure</span><b>${obj.structure || 'Single'}</b></div><div class="info-item"><span>Condition</span><b style="color:${(obj.condition==='Tilted'||obj.condition==='Damaged')?'#ef4444':'var(--text-main)'}">${obj.condition || 'OK'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('${obj.lineType === 'LT' ? 'LTPOLE' : 'POLE'}','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('POLE','${obj.id}','${obj.poleNo}')"><i class="fa-solid fa-up-down-left-right"></i> Move</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('pole','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    } else if (type === 'DT') {
        title = obj.name || `DT Code: ${obj.code}`; subtitle = `Code: ${obj.code} | ${obj.rating} kVA`;
        details = `<div class="info-grid"><div class="info-item"><span>Mounted On</span><b>${obj.mountedOn || 'Single Pole'}</b></div><div class="info-item"><span>Sr No.</span><b>${obj.srNo || 'N/A'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('dt','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('dt','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    } else if (type === 'CONSUMER') {
        title = `${obj.name}`; subtitle = `${obj.conType || 'DS'} | Load: ${obj.load || '1'}kW`;
        details = `<div class="info-grid"><div class="info-item"><span>K-Number</span><b>${obj.kno}</b></div><div class="info-item"><span>Connected To</span><b>${obj.parentRef}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('consumer','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('CONSUMER','${obj.id}','${obj.name}')"><i class="fa-solid fa-up-down-left-right"></i> Move</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('consumer','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    } else if (type === 'LINE') {
        let spec = getLineSpec(obj.type); title = `${spec.name}`; subtitle = `${obj.phaseType || 'Single Phase'}`;
        details = `<div class="info-grid"><div class="info-item"><span>Distance</span><b>${window.formatDistance(obj.distanceMeters||0)}</b></div><div class="info-item"><span>Crossing</span><b>${obj.hasCrossing? (obj.crossingRemark||'Yes') : 'None'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('line','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('line','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    } else if (type === 'GSS') {
        title = `${obj.name}`; subtitle = `Substation Source`;
        details = `<div class="info-grid"><div class="info-item"><span>Code</span><b>${obj.code}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('gss','${obj.code}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('GSS','${obj.code}','${obj.code}')"><i class="fa-solid fa-up-down-left-right"></i> Relocate</button>`;
    }
    
    document.getElementById('obj-sheet-content').innerHTML = `${photo ? `<img src="${photo}" class="sheet-photo">` : ''}<h3 class="sheet-obj-title">${title}</h3><p class="sheet-obj-subtitle">${subtitle}</p>${details}<div class="sheet-actions-row">${actions}</div>`;
    document.getElementById('bottom-info-sheet').classList.add('open');
};
window.closeObjectSheet = function() { window.haptic(15); document.getElementById('bottom-info-sheet').classList.remove('open'); };

function calculateParallelCoords(p1, p2, offsetMeters) {
    const R = 6378137; const lat1 = p1.lat * Math.PI/180, lng1 = p1.lng * Math.PI/180; const lat2 = p2.lat * Math.PI/180, lng2 = p2.lng * Math.PI/180;
    const bearing = Math.atan2(Math.sin(lng2-lng1)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(lng2-lng1));
    const angle = bearing + Math.PI/2; 
    const dLat = (offsetMeters / R) * Math.cos(angle) * (180/Math.PI); const dLng = (offsetMeters / (R * Math.cos(lat1))) * Math.sin(angle) * (180/Math.PI);
    return [ [p1.lat + dLat, p1.lng + dLng], [p2.lat + dLat, p2.lng + dLng] ];
}

function renderEntireNetwork() {
    if(!map) return;
    try {
        updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers()); 
        const net = getRenderNetwork(), f = appState.filters;
        const gssMap = appState.adminMode ? appState.tempGssNodes : appState.gssNodes;

        Object.values(gssMap).forEach(activeGss => {
            if (activeGss && activeGss.lat && !(appState.activeMove && appState.activeMove.id === activeGss.code)) {
                const svg = `<svg width="44" height="48" viewBox="0 0 44 48" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><rect x="6" y="10" width="32" height="16" rx="6" fill="#ef4444" opacity="0.4"/><text x="22" y="30" font-size="12" font-weight="900" font-family="Inter" fill="#fff" text-anchor="middle">GSS</text></svg>`;
                L.marker([activeGss.lat, activeGss.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [44,48], iconAnchor: [22,48] }), zIndexOffset: 95000 }).addTo(featureGroups.gss).on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('GSS', activeGss.code); });
            }
        });

        if (f.poles) {
            net.poles.forEach(p => {
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                const isLT = p.lineType === 'LT'; let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];
                const color = isLT ? '#10b981' : '#fde047'; const isAlert = (p.condition === 'Tilted' || p.condition === 'Damaged'); const strokeColor = isAlert ? '#ef4444' : '#0f172a';
                let svg = ''; let w = 34, h = 48, ax = 17, ay = 48;
                const badge = isAlert ? `<circle cx="${w-5}" cy="14" r="5" fill="#ef4444" stroke="#fff" stroke-width="1.5"/><text x="${w-5}" y="17.5" font-size="9" fill="#fff" font-weight="900" text-anchor="middle">!</text>` : '';
                const grad = `<defs><linearGradient id="g${p.id}"><stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="100%" stop-color="${color}"/></linearGradient></defs>`;

                if (p.structure === 'Double') { w = 40; ax = 20; svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${grad}<rect x="10" y="16" width="6" height="${h-16}" fill="url(#g${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="24" y="16" width="6" height="${h-16}" fill="url(#g${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="5" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="20" y="10" font-size="9" font-weight="900" fill="#0f172a" text-anchor="middle">${displayNo}</text>${badge}</svg>`; }
                else { svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${grad}<rect x="14" y="16" width="6" height="${h-16}" fill="url(#g${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="2" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="17" y="10" font-size="9" font-weight="900" fill="#0f172a" text-anchor="middle">${displayNo}</text>${badge}</svg>`; }

                L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [w, h], iconAnchor: [ax, ay] }), zIndexOffset: isLT?1000:2000 }).addTo(isLT?featureGroups.ltPoles:featureGroups.htPoles).on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('POLE', p.id); });
            });
        }

        if (f.dts) {
            net.dts.forEach(d => {
                if (d.lat && d.lng) {
                    const numRating = String(d.rating).replace(/[^0-9]/g, ''); let svg = '';
                    if(d.phase === 'Single Phase') {
                        svg = `<svg width="100%" height="100%" viewBox="0 0 28 46" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><g stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"><line x1="14" y1="14" x2="14" y2="4"/><polygon points="14,2 10,5 18,5" fill="#e2e8f0"/><polygon points="14,5 8,9 20,9" fill="#e2e8f0"/><polygon points="14,9 6,13 22,13" fill="#e2e8f0"/></g><rect x="2" y="14" width="24" height="4" rx="1" fill="#475569" stroke="#0f172a" stroke-width="1.5"/><rect x="4" y="18" width="20" height="24" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><rect x="2" y="42" width="24" height="4" rx="1" fill="#475569" stroke="#0f172a" stroke-width="1.5"/><text x="14" y="35" font-size="11" font-weight="900" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [20, 33], iconAnchor: [10, 16.5] }), zIndexOffset: 90000 }).addTo(featureGroups.dts).on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('DT', d.id); });
                    } else {
                        svg = `<svg width="100%" height="100%" viewBox="0 0 40 46" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><g stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"><line x1="10" y1="14" x2="10" y2="4"/><polygon points="10,2 7,5 13,5" fill="#e2e8f0"/><polygon points="10,5 6,9 14,9" fill="#e2e8f0"/><polygon points="10,9 4,13 16,13" fill="#e2e8f0"/><line x1="20" y1="14" x2="20" y2="4"/><polygon points="20,2 17,5 23,5" fill="#e2e8f0"/><polygon points="20,5 16,9 24,9" fill="#e2e8f0"/><polygon points="20,9 14,13 26,13" fill="#e2e8f0"/><line x1="30" y1="14" x2="30" y2="4"/><polygon points="30,2 27,5 33,5" fill="#e2e8f0"/><polygon points="30,5 26,9 34,9" fill="#e2e8f0"/><polygon points="30,9 24,13 36,13" fill="#e2e8f0"/></g><rect x="2" y="14" width="36" height="4" rx="1" fill="#475569" stroke="#0f172a" stroke-width="1.5"/><rect x="4" y="18" width="32" height="24" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><rect x="2" y="42" width="36" height="4" rx="1" fill="#475569" stroke="#0f172a" stroke-width="1.5"/><text x="20" y="35" font-size="12" font-weight="900" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [28, 33], iconAnchor: [14, 16.5] }), zIndexOffset: 90000 }).addTo(featureGroups.dts).on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('DT', d.id); });
                    }
                }
            });
        }

        net.lines.forEach(line => {
            const c1 = getNodeCoords(line.fromNode, net, gssMap), c2 = getNodeCoords(line.toNode, net, gssMap); 
            if (c1 && c2) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = getLineSpec(line.type); if (!f[spec.filterKey]) return;
            const lineGrp = spec.name.includes('LT') ? featureGroups.ltLines : featureGroups.htLines;
            
            let linesToDraw = [];
            if(line.phaseType === 'Three Phase' && !line.type.includes('UG CABLE')) {
                linesToDraw.push({ coords: calculateParallelCoords({lat:c1.lat, lng:c1.lng}, {lat:c2.lat, lng:c2.lng}, -1.5), color: '#ef4444' }); 
                linesToDraw.push({ coords: line.coords, color: '#eab308' }); 
                linesToDraw.push({ coords: calculateParallelCoords({lat:c1.lat, lng:c1.lng}, {lat:c2.lat, lng:c2.lng}, 1.5), color: '#3b82f6' }); 
            } else { linesToDraw.push({ coords: line.coords, color: spec.color }); }

            linesToDraw.forEach(ld => {
                const hitPoly = L.polyline(ld.coords, { color: 'transparent', weight: 20 }).addTo(lineGrp);
                L.polyline(ld.coords, { color: ld.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', interactive: false, className: spec.lineClass }).addTo(lineGrp);
                hitPoly.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('LINE', line.id); });
            });
        });

        if (f.consumers) {
            net.consumers.forEach(c => {
                if (appState.activeMove && appState.activeMove.id === c.id) return; 
                let bgColor = '#10b981'; if(c.status === 'DC') bgColor = '#facc15'; else if(c.status === 'PDC') bgColor = '#ef4444'; else if(c.conType === 'NDS') bgColor = '#3b82f6';
                let faIcon = '&#xf015;'; if(c.conType === 'NDS') faIcon = '&#xf1ad;'; else if(c.conType === 'AG') faIcon = '&#xf4d8;'; 
                const svg = `<svg width="26" height="34" viewBox="0 0 26 34" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="13" cy="30" rx="6" ry="2" fill="rgba(0,0,0,0.3)"/><path d="M13 22 L13 30" stroke="#0f172a" stroke-width="2"/><circle cx="13" cy="11" r="10" fill="${bgColor}" stroke="white" stroke-width="1.5"/><text x="13" y="15" font-size="10" font-weight="900" font-family="'Font Awesome 6 Free', sans-serif" fill="white" text-anchor="middle" class="fa-svg-icon">${faIcon}</text></svg>`;
                L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [26,34], iconAnchor: [13,34] }), zIndexOffset: 100 }).addTo(featureGroups.consumers).on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('CONSUMER', c.id); });
            });
        }
        
        // Recompute Dashboard KPIs
        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; 
        net.lines.forEach(l => { if (getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); });
        net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        if(document.getElementById('kpi11')) document.getElementById('kpi11').innerText = window.formatDistance(t11);
        if(document.getElementById('kpiLT')) document.getElementById('kpiLT').innerText = window.formatDistance(tLT);
        if(document.getElementById('kpi3Ph')) document.getElementById('kpi3Ph').innerText = dt3ph; 
        if(document.getElementById('kpi1Ph')) document.getElementById('kpi1Ph').innerText = dt1ph;
        if(document.getElementById('kpiCons')) document.getElementById('kpiCons').innerText = net.consumers.length;
        
    } catch(err) { console.error("Rendering error:", err); }
}

function saveSnapshot() { const net = getActiveNetwork(); historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers }))); if (historyStack.length > 15) historyStack.shift(); }
window.undoLastAction = function() { window.haptic(15); if (historyStack.length === 0) return showToast("No actions to Undo!"); const prevState = historyStack.pop(), net = getActiveNetwork(); net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers; renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺"); }
window.openFilterModal = function() { window.haptic(15); const f = appState.filters; openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-filter" style="color:#d97706;"></i> Object Filter</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div style="display:flex; flex-direction:column; gap:12px;"><div style="display:flex; justify-content:space-between; align-items:center;"><b>11 KV Line</b><label><input type="checkbox" id="flt11" ${f.lines11?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>LT Line</b><label><input type="checkbox" id="fltLT" ${f.linesLT?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>Poles</b><label><input type="checkbox" id="fltPoles" ${f.poles?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>DT</b><label><input type="checkbox" id="fltDTs" ${f.dts?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>Consumers</b><label><input type="checkbox" id="fltCons" ${f.consumers?'checked':''}></label></div></div><button class="btn-action-primary" onclick="window.saveFilters()">Apply</button>`); }
window.saveFilters = function() { appState.filters.lines11 = document.getElementById('flt11').checked; appState.filters.linesLT = document.getElementById('fltLT').checked; appState.filters.poles = document.getElementById('fltPoles').checked; appState.filters.dts = document.getElementById('fltDTs').checked; appState.filters.consumers = document.getElementById('fltCons').checked; window.closeModal(); renderEntireNetwork(); showToast("Filters Updated"); }
window.autoSaveSettings = function() { appState.settings.unit = document.getElementById('setUnit').value; appState.settings.gpsInterval = parseFloat(document.getElementById('setGpsInterval').value); appState.settings.gpsAccuracy = parseFloat(document.getElementById('setGpsAccuracy').value); appState.settings.language = document.getElementById('setLanguage').value; appState.settings.darkMode = document.getElementById('setTheme').value === 'dark'; document.documentElement.setAttribute('data-theme', appState.settings.darkMode ? 'dark' : 'light'); triggerPersistence(false); translateApp(); renderEntireNetwork(); showToast(t("toastSettings"));  }
window.toggleSpeedDial = function(force) { window.haptic(15); const dial = document.getElementById('speed-dial-menu'), fab = document.getElementById('mainFabBtn'); if (!dial || !fab) return; const isOpen = force !== undefined ? force : !dial.classList.contains('active'); dial.classList.toggle('active', isOpen); fab.classList.toggle('open', isOpen); }
window.toggleSidebar = function(open) { window.haptic(15); document.getElementById('sidebar-drawer').classList.toggle('open', open); document.getElementById('sidebarBackdrop').classList.toggle('open', open); if(open) window.renderGssSidebarList(); }
window.openModal = function(html) { document.getElementById('modalSheetContent').innerHTML = html; document.getElementById('formModalOverlay').classList.add('open'); translateApp(); }
window.closeModal = function() { document.getElementById('formModalOverlay').classList.remove('open'); }
window.openSettingsPage = function() { window.toggleSidebar(false); document.getElementById('setUnit').value = appState.settings.unit || 'm'; document.getElementById('setGpsInterval').value = appState.settings.gpsInterval || 3; document.getElementById('setGpsAccuracy').value = appState.settings.gpsAccuracy || 10; document.getElementById('setLanguage').value = appState.settings.language || 'en'; document.getElementById('setTheme').value = appState.settings.darkMode ? 'dark' : 'light'; document.getElementById('settings-page').classList.add('open');  }
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }
window.switchFeeder = function(code) { if (appState.feeders[code]) { appState.currentFeederCode = code; renderEntireNetwork(); triggerPersistence(false); centerMapOnGSS(); } }
window.calcDistance = function(lat1, lon1, lat2, lon2) { const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }

function getLineSpec(type) { const t = (type || '').toUpperCase(); if (t.includes('UG CABLE')) return { name: '11 KV UG CABLE', color: '#000000', weight: 3.5, dash: undefined, filterKey: 'lines11', lineClass: 'ug-cable-line' }; if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 2.2, dash: undefined, filterKey: 'linesLT', lineClass: 'isometric-line' }; return { name: '11 KV LINE', color: '#2563eb', weight: 3.5, dash: undefined, filterKey: 'lines11', lineClass: 'isometric-line' }; }

function getNodeCoords(nodeId, renderNet, renderGssMap) { 
    const net = renderNet || getActiveNetwork(); const gssMap = renderGssMap || appState.gssNodes;
    const idStr = String(nodeId);
    if (idStr.startsWith('GSS_')) { const code = idStr.replace('GSS_', ''); if (gssMap[code]) return { lat: gssMap[code].lat, lng: gssMap[code].lng }; }
    if (idStr.startsWith('DT_')) { const code = idStr.replace('DT_', ''), d = net.dts.find(x => String(x.code) === code); if (d) return { lat: d.lat, lng: d.lng }; }
    if (idStr.startsWith('POLE_')) { const code = idStr.replace('POLE_', ''), p = net.poles.find(x => String(x.poleNo) === code); if (p) return { lat: p.lat, lng: p.lng }; }
    const p = net.poles.find(x => String(x.poleNo) === idStr); if (p) return { lat: p.lat, lng: p.lng };
    const d = net.dts.find(x => String(x.code) === idStr); if (d) return { lat: d.lat, lng: d.lng };
    if (gssMap[idStr]) return { lat: gssMap[idStr].lat, lng: gssMap[idStr].lng };
    if (!appState.adminMode && idStr === 'GSS' || idStr === net.feeder.code) { const g = gssMap[net.feeder.parentGss]; if(g) return { lat: g.lat, lng: g.lng }; }
    return null; 
}

window.openAddForm = function(type) {
    window.toggleSpeedDial(false); 
    if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { appState.placementType = type; document.getElementById('center-placement-pin').style.display = 'block'; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'flex'; } 
    else window.showFormModal(type, null, null);
}
window.confirmPlacement = function() { window.haptic(30); document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; const center = map.getCenter(); window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6))); }
window.cancelPlacement = function() { window.haptic(15); document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; }

window.showFormModal = function(type, snapLat, snapLng, editId = null) {
    if(map) map.closePopup();
    const center = map.getCenter(); snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6));
    
    let isEdit = editId !== null;
    let existingObj = {}, ctx = null, net = getActiveNetwork(), gssDict = appState.gssNodes;
    if(isEdit) {
        ctx = getEntityContext(type, editId); if(!ctx) return;
        existingObj = ctx.obj; net = ctx.net; gssDict = ctx.gssRef;
    }

    const formLat = isEdit ? (existingObj.lat || snapLat) : snapLat; const formLng = isEdit ? (existingObj.lng || snapLng) : snapLng;

    if (type === 'GSS') {
        const g = gssDict[editId]; if (!g) return;
        openModal(`<div class="sheet-head"><div class="sheet-title">Edit GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="form-row"><label>GSS Name*</label><input type="text" id="editGssName" class="form-input" value="${g.name}"></div>
        <button class="btn-action-primary" onclick="window.saveEditedGss('${g.code}')">Save Changes</button>`);
    }
    else if (type === 'POLE') {
        const nextNo = isEdit ? existingObj.poleNo : (net.poles.filter(p => p.lineType !== 'LT').length + 1);
        const selStruct = s => (existingObj.structure === s) ? 'selected' : ''; const selCond = c => (existingObj.condition === c) ? 'selected' : '';
        const photoB64 = existingObj.photo || ''; const showPhoto = (existingObj.condition==='Tilted'||existingObj.condition==='Damaged') ? 'block' : 'none';
        
        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit HT Pole':'Add HT Pole'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Pole Number*</label><input type="number" id="inpPoleNo" class="form-input" value="${nextNo}" ${isEdit?'readonly disabled style="background:var(--bg-base);"':''}></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-row"><label>Pole Structure</label><select id="inpPoleStruct" class="form-select"><option value="Single" ${selStruct('Single')}>Single Pole</option><option value="Double" ${selStruct('Double')}>Double Pole</option><option value="Lattice Tower" ${selStruct('Lattice Tower')}>Lattice Tower</option><option value="Rail Pole" ${selStruct('Rail Pole')}>Rail Pole</option></select></div>
                <div class="form-row"><label>Condition</label><select id="inpPoleCond" class="form-select" onchange="document.getElementById('polePhotoDiv').style.display = (this.value==='Tilted'||this.value==='Damaged')?'block':'none'"><option value="OK" ${selCond('OK')}>OK</option><option value="Tilted" ${selCond('Tilted')}>Tilted</option><option value="Damaged" ${selCond('Damaged')}>Damaged</option></select></div>
                <div id="polePhotoDiv" style="display:${showPhoto}; margin-bottom:12px;">
                    <button class="btn-camera" onclick="window.capturePhoto('inpPolePhoto')"><i class="fa-solid fa-camera"></i> Capture Pole Issue</button>
                    <input type="hidden" id="inpPolePhoto" value="${photoB64}"><img id="inpPolePhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}">
                </div>
            </div>
            <input type="hidden" id="inpPoleCategory" value="HT"><input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.savePoleData('${editId || ''}')">Save HT Pole</button>`);
    } 
    else if (type === 'LTPOLE') {
        if (!isEdit && net.dts.length === 0) return alert("You must add a DT first!");
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}" ${existingObj.dtCode===String(d.id)?'selected':''}>DT: ${d.id} (${window.formatDistance(window.calcDistance(snapLat, snapLng, d.lat, d.lng))})</option>`).join('');
        const selStruct = s => (existingObj.structure === s) ? 'selected' : ''; const selCond = c => (existingObj.condition === c) ? 'selected' : ''; const photoB64 = existingObj.photo || ''; const showPhoto = (existingObj.condition==='Tilted'||existingObj.condition==='Damaged') ? 'block' : 'none';

        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit LT Pole':'Add LT Pole'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            ${isEdit ? `<div class="form-row"><label>Pole Number</label><input type="text" id="inpPoleNo" class="form-input" value="${existingObj.poleNo}" disabled style="background:var(--bg-base);"></div>` : ''}
            <div class="form-row"><label>Associated DT*</label><select id="inpLTPoleDT" class="form-select" ${isEdit?'disabled style="background:var(--bg-base);"':''}>${dtOpts}</select></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-row"><label>Pole Structure</label><select id="inpPoleStruct" class="form-select"><option value="Single" ${selStruct('Single')}>Single Pole</option><option value="Double" ${selStruct('Double')}>Double Pole</option><option value="Rail Pole" ${selStruct('Rail Pole')}>Rail Pole</option></select></div>
                <div class="form-row"><label>Condition</label><select id="inpPoleCond" class="form-select" onchange="document.getElementById('polePhotoDiv').style.display = (this.value==='Tilted'||this.value==='Damaged')?'block':'none'"><option value="OK" ${selCond('OK')}>OK</option><option value="Tilted" ${selCond('Tilted')}>Tilted</option><option value="Damaged" ${selCond('Damaged')}>Damaged</option></select></div>
                <div id="polePhotoDiv" style="display:${showPhoto}; margin-bottom:12px;">
                    <button class="btn-camera" onclick="window.capturePhoto('inpPolePhoto')"><i class="fa-solid fa-camera"></i> Capture Pole Issue</button>
                    <input type="hidden" id="inpPolePhoto" value="${photoB64}"><img id="inpPolePhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}">
                </div>
            </div>
            <input type="hidden" id="inpPoleCategory" value="LT"><input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.savePoleData('${editId || ''}')">Save LT Pole</button>`);
    } 
    else if (type === 'LINE') {
        if (!isEdit && net.poles.length === 0) return alert("Add at least one pole first!");
        const selType = t => (existingObj.type && existingObj.type.includes(t)) ? 'selected' : ''; const selPhase = p => (existingObj.phaseType === p) ? 'selected' : '';
        
        window.filterLineNodes = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), dtSelectorBox = document.getElementById('ltLineDTSelector');
            let defaultFrom = isEdit ? existingObj.fromNode : String(document.getElementById('inpDefaultFrom').value); let nodes = [];
            if (type.includes('LT')) {
                dtSelectorBox.style.display = 'block'; const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? targetDTElem.value : ''; if(!selectedDT) return;
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
            } else {
                dtSelectorBox.style.display = 'none'; nodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = gssDict[net.feeder.parentGss]; if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, center.lat, center.lng); if (!defaultFrom && nodes.length > 0) defaultFrom = nodes[0].id;
            fromSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title} (${window.formatDistance(window.calcDistance(center.lat, center.lng, n.lat, n.lng))})</option>`).join('');
            window.syncLineToSelect();
        };
        window.syncLineToSelect = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), fromVal = fromSel && fromSel.options.length > 0 ? String(fromSel.value) : '';
            const toSel = document.getElementById('inpToNode'); let nodes = [];
            if (type.includes('LT')) {
                const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? String(targetDTElem.value) : '';
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === selectedDT && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                if(selectedDT && ('DT_'+selectedDT) !== fromVal) { const dtObj = net.dts.find(d => String(d.code) === selectedDT); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng}); }
            } else {
                nodes = net.poles.filter(p => p.lineType !== 'LT' && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = gssDict[net.feeder.parentGss]; if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, center.lat, center.lng); let defTo = isEdit ? existingObj.toNode : '';
            toSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defTo ? 'selected' : ''}>${n.title} (${window.formatDistance(window.calcDistance(center.lat, center.lng, n.lat, n.lng))})</option>`).join(''); 
        };
        const htNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, lat: p.lat, lng: p.lng}));
        const feederGss = gssDict[net.feeder.parentGss]; if(feederGss) htNodes.push({id: 'GSS_'+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        let sortedHT = window.sortByDistance(htNodes, snapLat, snapLng); let initialDefaultFrom = sortedHT.length > 0 ? sortedHT[0].id : '';

        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit Line':'Add Line'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Line Type*</label><select id="inpLineType" class="form-select" onchange="window.filterLineNodes()"><option value="11 KV LINE" ${selType('11 KV LINE')}>11 KV Line</option><option value="11 KV UG CABLE" ${selType('UG CABLE')}>11 KV UG CABLE</option><option value="LT LINE" ${selType('LT LINE')}>LT Line</option></select></div>
            <div id="ltLineDTSelector" style="display:none; background:#f1f5f9; padding:8px; border-radius:8px; margin-bottom:12px;"><label style="font-size:0.75rem; font-weight:700;">Select DT for LT Line Routing*</label><select id="inpTargetDT" class="form-select" onchange="window.filterLineNodes()"></select></div>
            <input type="hidden" id="inpDefaultFrom" value="${initialDefaultFrom}">
            <div class="form-grid-2"><div class="form-row"><label>From Node*</label><select id="inpFromNode" class="form-select" onchange="window.syncLineToSelect()" ${isEdit?'disabled':''}></select></div><div class="form-row"><label>To Node*</label><select id="inpToNode" class="form-select" ${isEdit?'disabled':''}></select></div></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-grid-2"><div class="form-row"><label>Phase Type</label><select id="inpLinePhase" class="form-select"><option value="Three Phase" ${selPhase('Three Phase')}>Three Phase</option><option value="Single Phase" ${selPhase('Single Phase')}>Single Phase</option></select></div><div class="form-row"><label style="margin-top:10px;"><input type="checkbox" id="inpLineCrossing" onchange="document.getElementById('crossRemarkDiv').style.display=this.checked?'block':'none'" ${existingObj.hasCrossing?'checked':''}> Has Crossing?</label></div></div>
                <div class="form-row" id="crossRemarkDiv" style="display:${existingObj.hasCrossing?'block':'none'};"><label>Crossing Remark</label><input type="text" id="inpLineCrossRemark" class="form-input" value="${existingObj.crossingRemark || ''}" placeholder="e.g. NH-8 Crossing"></div>
            </div>
            <button class="btn-action-primary" onclick="window.saveLineData('${editId || ''}')">Save Line</button>`);
        setTimeout(() => { let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); document.getElementById('inpTargetDT').innerHTML = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join(''); window.filterLineNodes(); }, 30);
    } 
    else if (type === 'DT') {
        let parentNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng})); const feederGss = gssDict[net.feeder.parentGss]; if(feederGss) parentNodes.push({id: feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}" ${existingObj.parentPole===String(p.id)?'selected':''}>${p.title} (${window.formatDistance(window.calcDistance(snapLat, snapLng, p.lat, p.lng))})</option>`).join('');
        
        const selMount = m => (existingObj.mountedOn === m) ? 'selected' : ''; const selPhase = p => (existingObj.phase === p) ? 'selected' : ''; const photoB64 = existingObj.photo || '';
        const titleText = isEdit ? (existingObj.name || `DT: ${existingObj.code}`) : 'Add DT';

        openModal(`<div class="sheet-head"><div class="sheet-title">${titleText}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Connected To (HT Node)*</label><select id="inpDTParent" class="form-select" ${isEdit?'disabled':''}>${parentOpts}</select></div>
            <div class="form-row"><label>DT Name / Location</label><input type="text" id="inpDTName" class="form-input" value="${existingObj.name||''}" placeholder="e.g. Subhash Chowk Transformer"></div>
            <div class="form-grid-2"><div class="form-row"><label>DT Code*</label><input type="number" id="inpDTCode" class="form-input" value="${existingObj.code || Math.floor(Math.random()*9000)}" ${isEdit?'disabled':''}></div><div class="form-row"><label>Rating (kVA)*</label><select id="inpDTRating" class="form-select"></select></div></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-grid-2"><div class="form-row"><label>Phase*</label><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating', '${existingObj.rating||''}')"><option value="Three Phase" ${selPhase('Three Phase')}>Three Phase</option><option value="Single Phase" ${selPhase('Single Phase')}>Single Phase</option></select></div><div class="form-row"><label>Mounted On</label><select id="inpDTMount" class="form-select"><option value="Double Pole Structure" ${selMount('Double Pole Structure')}>Double Pole Structure</option><option value="Single Pole" ${selMount('Single Pole')}>Single Pole</option></select></div></div>
                <div class="form-grid-2"><div class="form-row"><label>Sr. No</label><input type="text" id="inpDTSrNo" class="form-input" value="${existingObj.srNo||''}"></div><div class="form-row"><label>TN Number</label><input type="text" id="inpDTTN" class="form-input" value="${existingObj.tn||''}"></div></div>
                <div style="margin-bottom:12px;">
                    <button class="btn-camera" onclick="window.capturePhoto('inpDTPhoto')"><i class="fa-solid fa-camera"></i> Capture DT Photo</button>
                    <input type="hidden" id="inpDTPhoto" value="${photoB64}"><img id="inpDTPhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}">
                </div>
            </div>
            <input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.saveDTData('${editId || ''}')">Save DT</button>`);
        setTimeout(() => window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating', existingObj.rating), 30);
    } 
    else if (type === 'CONSUMER') {
        if (!isEdit && net.dts.length === 0) return alert("Must have at least one DT to connect Consumer!"); 
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join('');
        const selType = t => (existingObj.conType === t) ? 'selected' : ''; const selStat = s => (existingObj.status === s) ? 'selected' : ''; const photoB64 = existingObj.photo || '';

        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit Consumer':'Add Consumer'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Select Parent DT*</label><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()" ${isEdit?'disabled':''}>${dtOpts}</select></div>
            <div class="form-row"><label>Connects To (LT Pole / DT)*</label><select id="inpConsParent" class="form-select" ${isEdit?'disabled':''}></select></div>
            <div class="form-row"><label>Consumer Name*</label><input type="text" id="inpConsName" class="form-input" value="${existingObj.name||''}"></div>
            <div class="form-grid-2"><div class="form-row"><label>K-Number (12 Digits)*</label><input type="text" id="inpConsKno" class="form-input" value="${existingObj.kno||''}" maxlength="12" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,12);"></div><div class="form-row"><label>A/C No. (8 Digits)*</label><input type="text" id="inpConsAcNo" class="form-input" value="${existingObj.acNo||''}" maxlength="8" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,8);"></div></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-grid-2"><div class="form-row"><label>Consumer Type</label><select id="inpConsType" class="form-select"><option value="DS" ${selType('DS')}>DS</option><option value="NDS" ${selType('NDS')}>NDS</option><option value="AG" ${selType('AG')}>AG</option><option value="SIP/MIP" ${selType('SIP/MIP')}>SIP/MIP</option><option value="PHED" ${selType('PHED')}>PHED</option><option value="Other" ${selType('Other')}>Other</option></select></div><div class="form-row"><label>Status</label><select id="inpConsStatus" class="form-select"><option value="Regular" ${selStat('Regular')}>Regular</option><option value="DC" ${selStat('DC')}>DC</option><option value="PDC" ${selStat('PDC')}>PDC</option></select></div></div>
                <div class="form-grid-2"><div class="form-row"><label>Meter No.</label><input type="text" id="inpConsMeter" class="form-input" value="${existingObj.meterNo||''}"></div><div class="form-row"><label>Load (kW)</label><input type="number" id="inpConsLoad" class="form-input" value="${existingObj.load||'1'}"></div></div>
                <div style="margin-bottom:12px;">
                    <button class="btn-camera" onclick="window.capturePhoto('inpConsPhoto')"><i class="fa-solid fa-camera"></i> Capture Premises</button>
                    <input type="hidden" id="inpConsPhoto" value="${photoB64}"><img id="inpConsPhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}">
                </div>
            </div>
            <input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.saveConsumerData('${editId || ''}')">Save Consumer</button>`);
        setTimeout(() => {
            if(isEdit) { let pDT = existingObj.parentType === 'DT' ? existingObj.parentRef : net.poles.find(p=>p.poleNo==existingObj.parentRef)?.dtCode; if(pDT) document.getElementById('inpConsDT').value = pDT; }
            window.filterConsumerPoles(existingObj.parentRef);
        }, 30);
    }
}

window.updateDTRatingDropdowns = function(phaseId, ratingId, existingVal) { const phase = document.getElementById(phaseId).value, ratingSel = document.getElementById(ratingId); let opts = ''; if(phase === 'Single Phase') opts = `<option value="5">5 kVA</option><option value="10">10 kVA</option><option value="16" selected>16 kVA</option><option value="25">25 kVA</option>`; else opts = `<option value="10">10 kVA</option><option value="16">16 kVA</option><option value="25" selected>25 kVA</option><option value="63">63 kVA</option><option value="100">100 kVA</option><option value="160">160 kVA</option><option value="250">250 kVA</option><option value="315">315 kVA</option><option value="500">500 kVA</option>`; ratingSel.innerHTML = opts; if(existingVal) ratingSel.value = existingVal; }
window.filterConsumerPoles = function(existingParentRef) {
    const ctx = appState.adminMode ? getEntityContext('CONSUMER', existingParentRef) : null;
    const net = ctx ? ctx.net : getActiveNetwork();
    const selectedDT = document.getElementById('inpConsDT').value, centerLat = parseFloat(document.getElementById('inpLat').value), centerLng = parseFloat(document.getElementById('inpLng').value);
    let nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: p.poleNo}));
    const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: selectedDT, title: 'Direct to DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
    nodes = window.sortByDistance(nodes, centerLat, centerLng); document.getElementById('inpConsParent').innerHTML = nodes.map(n => `<option value="${n.id}" ${existingParentRef===String(n.id)?'selected':''}>${n.title} (${window.formatDistance(window.calcDistance(centerLat, centerLng, n.lat, n.lng))})</option>`).join('');
}

window.saveEditedGss = function(code) {
    window.haptic(30); saveSnapshot(); 
    const ctx = getEntityContext('GSS', code); if(!ctx) return;
    ctx.obj.name = document.getElementById('editGssName').value.trim(); 
    window.closeModal(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ctx.ownerId); else triggerPersistence(); 
    showToast("GSS Updated"); 
}

window.savePoleData = function(editId) { 
    window.haptic(30); saveSnapshot(); 
    const category = document.getElementById('inpPoleCategory').value;
    const lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    const structure = document.getElementById('inpPoleStruct').value, condition = document.getElementById('inpPoleCond').value, photo = document.getElementById('inpPolePhoto').value;
    let no = ''; const noElem = document.getElementById('inpPoleNo'); if (noElem) no = noElem.value.trim();
    
    let net = getActiveNetwork(); let ownerId = null;

    if (editId) {
        const ctx = getEntityContext(category === 'LT' ? 'LTPOLE' : 'POLE', editId); if(!ctx) return;
        net = ctx.net; ownerId = ctx.ownerId;
        if (!no) return alert(t("errReq"));
        if (net.poles.some(p => p.id !== editId && String(p.poleNo) === no)) return alert(t("alertExists"));
        let p = ctx.obj; p.poleNo = no; p.structure = structure; p.condition = condition; p.photo = photo;
    } else {
        if(appState.adminMode) { alert("Admin must edit existing, use surveyor app to drop new assets."); window.closeModal(); return; }
        let dtCode = category === 'LT' ? document.getElementById('inpLTPoleDT').value : undefined;
        if (category === 'LT' && !no) { const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); no = `${dtCode}-${existingLTPoles.length + 1}`; }
        if (!no) return alert(t("errReq"));
        if (net.poles.some(p => String(p.poleNo) === no)) return alert(t("alertExists"));
        net.poles.push({ id: 'P_'+Date.now(), poleNo: no, lineType: category, structure, condition, photo, dtCode, lat, lng }); 
    }
    window.closeModal(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveLineData = function(editId) {
    window.haptic(30); saveSnapshot(); const from = document.getElementById('inpFromNode').value, to = document.getElementById('inpToNode').value, type = document.getElementById('inpLineType').value; 
    const phaseType = document.getElementById('inpLinePhase').value; const hasCrossing = document.getElementById('inpLineCrossing').checked; const crossingRemark = document.getElementById('inpLineCrossRemark').value.trim();
    if (from === to) return alert("Cannot connect node to itself!"); if (!to) return alert("Please select a target node!");
    const spec = getLineSpec(type); let net = getActiveNetwork(); let ownerId = null;
    
    if(editId) {
        const ctx = getEntityContext('LINE', editId); if(!ctx) return; net = ctx.net; ownerId = ctx.ownerId;
        if(net.lines.find(l => l.id !== editId && ((l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from)))) return alert("A line already exists between these two nodes!");
        let l = ctx.obj; l.type = spec.name; l.phaseType = phaseType; l.hasCrossing = hasCrossing; l.crossingRemark = crossingRemark;
    } else {
        if(appState.adminMode) { alert("Admin must edit existing, use surveyor app to drop new assets."); window.closeModal(); return; }
        if(net.lines.find(l => ((l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from)))) return alert("A line already exists between these two nodes!");
        const c1 = getNodeCoords(from), c2 = getNodeCoords(to); if(!c1 || !c2) return alert("Invalid node coordinates!"); const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); 
        net.lines.push({ id: 'LN_'+Date.now(), type: spec.name, phaseType, hasCrossing, crossingRemark, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] }); 
    }
    window.closeModal(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveDTData = function(editId) {
    window.haptic(30); saveSnapshot(); const parentRef = document.getElementById('inpDTParent').value, code = document.getElementById('inpDTCode').value.trim(), rating = parseFloat(document.getElementById('inpDTRating').value), phase = document.getElementById('inpDTPhase').value;
    const name = document.getElementById('inpDTName').value.trim(), srNo = document.getElementById('inpDTSrNo').value.trim(), tn = document.getElementById('inpDTTN').value.trim(), mountedOn = document.getElementById('inpDTMount').value, photo = document.getElementById('inpDTPhoto').value;
    if (!code) return alert(t("errReq")); let net = getActiveNetwork(); let ownerId = null;
    
    if(editId) {
        const ctx = getEntityContext('DT', editId); if(!ctx) return; net = ctx.net; ownerId = ctx.ownerId;
        if (net.dts.some(d => d.id !== editId && String(d.code) === code)) return alert(t("alertExists"));
        let d = ctx.obj; d.code = code; d.name = name; d.rating = rating; d.phase = phase; d.srNo = srNo; d.tn = tn; d.mountedOn = mountedOn; d.photo = photo;
    } else {
        if(appState.adminMode) { alert("Admin must edit existing, use surveyor app to drop new assets."); window.closeModal(); return; }
        if (net.dts.some(d => String(d.code) === code)) return alert(t("alertExists"));
        const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); let lat = net.feeder.lat, lng = net.feeder.lng; if (p) { lat = p.lat; lng = p.lng; }
        net.dts.push({ id: 'DT_'+Date.now(), parentPole: parentRef, code, name, rating, phase, srNo, tn, mountedOn, photo, lat, lng });
    }
    window.closeModal(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveConsumerData = function(editId) {
    window.haptic(30); saveSnapshot(); const parentRef = document.getElementById('inpConsParent').value, kno = document.getElementById('inpConsKno').value.trim(), acNo = document.getElementById('inpConsAcNo').value.trim(), name = document.getElementById('inpConsName').value.trim();
    const meterNo = document.getElementById('inpConsMeter').value.trim(), conType = document.getElementById('inpConsType').value, status = document.getElementById('inpConsStatus').value, load = document.getElementById('inpConsLoad').value.trim(), photo = document.getElementById('inpConsPhoto').value;
    if (!name || !kno || !acNo) return alert(t("errReq")); 
    if(kno.length !== 12) return alert("K-Number must be exactly 12 digits!");
    if(acNo.length !== 8) return alert("A/C No. must be exactly 8 digits!");
    let net = getActiveNetwork(); let ownerId = null;

    if(editId) {
        const ctx = getEntityContext('CONSUMER', editId); if(!ctx) return; net = ctx.net; ownerId = ctx.ownerId;
        if(net.consumers.some(c => c.id !== editId && String(c.kno) === String(kno))) return alert("K-Number already exists!");
        let c = ctx.obj; c.kno = kno; c.acNo = acNo; c.name = name; c.meterNo = meterNo; c.conType = conType; c.status = status; c.load = load; c.photo = photo;
    } else {
        if(appState.adminMode) { alert("Admin must edit existing, use surveyor app to drop new assets."); window.closeModal(); return; }
        if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number already exists in this feeder!");
        let parentType = 'POLE'; const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); if (!p) parentType = 'DT';
        const lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value);
        net.consumers.push({ id: 'CS_'+Date.now(), parentRef, parentType, kno, acNo, meterNo, conType, status, name, load, photo, lat, lng }); 
    }
    window.closeModal(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.openEditModal = function(type, id) { window.showFormModal(type.toUpperCase(), null, null, id); }

function deleteDTLogic(dtId, net) {
    const d = net.dts.find(x => x.id === dtId); if(!d) return;
    const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code)), ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)), ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn);
    net.lines = net.lines.filter(l => l.fromNode !== ('DT_' + d.code) && l.toNode !== ('DT_' + d.code) && !ltPoleNodeIds.includes(String(l.fromNode)) && !ltPoleNodeIds.includes(String(l.toNode)));
    net.consumers = net.consumers.filter(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); return !(isDirectToDT || isOnRemovedLTPole); });
    net.poles = net.poles.filter(p => !ltPoleIds.includes(String(p.poleNo))); net.dts = net.dts.filter(x => x.id !== dtId);
}
function deleteLTPoleLogic(p, net) { net.consumers = net.consumers.filter(c => !(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo))); net.lines = net.lines.filter(l => String(l.fromNode) !== ('POLE_'+p.poleNo) && String(l.toNode) !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== p.id); }

window.deleteEntity = function(type, id) {
    window.haptic([50,50,50]); if(!confirm("Are you sure you want to permanently delete this object?")) return; saveSnapshot();
    const ctx = getEntityContext(type.toUpperCase(), id); if(!ctx) return;
    let net = ctx.net; let ownerId = ctx.ownerId;
    
    if (type === 'line') net.lines = net.lines.filter(x => x.id !== id); 
    else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id); 
    else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole' || type === 'ltpole') {
        const p = ctx.obj;
        if (p.lineType === 'LT') deleteLTPoleLogic(p, net); else { const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== id); }
    } else if (type === 'gss') { if (ctx.gssRef[id]) delete ctx.gssRef[id]; }
    
    window.closeObjectSheet(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast("Object Deleted!");
}

window.startObjectMove = function(type, id, title) {
    window.haptic(15); window.closeObjectSheet(); appState.activeMove = { type, id }; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'flex'; document.getElementById('moveTargetTitle').innerText = `Move: ${title}`;
    let htmlContent = '';
    if(type === 'GSS') { htmlContent = `<svg width="44" height="48" viewBox="0 0 44 48" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><text x="22" y="30" font-size="12" font-weight="900" fill="#fff" text-anchor="middle">GSS</text></svg>`; } 
    else {
        const ctx = getEntityContext(type, id); if(!ctx) return; const target = ctx.obj;
        if (type === 'POLE' || type === 'LTPOLE') { const isLT = target.lineType === 'LT'; let displayNo = target.poleNo; if (isLT && String(target.poleNo).includes('-')) displayNo = String(target.poleNo).split('-')[1]; const color = isLT ? '#10b981' : '#fde047'; htmlContent = `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="14" width="6" height="28" fill="${color}" stroke="#0f172a" stroke-width="1.5"/><rect x="0" y="0" width="30" height="14" rx="4" fill="${color}" stroke="#0f172a" stroke-width="1.5"/><text x="15" y="10" font-size="9" font-weight="900" fill="#0f172a" text-anchor="middle">${displayNo}</text></svg>`; } 
        else if (type === 'CONSUMER') { htmlContent = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="11" r="10" fill="#10b981" stroke="white" stroke-width="1.5"/></svg>`; }
    }
    const targetObj = getEntityContext(type === 'LTPOLE' ? 'POLE' : type, id).obj;
    if (targetObj && targetObj.lat && map) { map.panTo([targetObj.lat, targetObj.lng]); const liveIconContainer = document.getElementById('live-move-icon'); liveIconContainer.innerHTML = htmlContent; liveIconContainer.style.display = 'block'; renderEntireNetwork(); }
}
window.confirmObjectMove = function() {
    window.haptic(30); if (!appState.activeMove) return; saveSnapshot(); const c = map.getCenter(); const lat = parseFloat(c.lat.toFixed(6)), lng = parseFloat(c.lng.toFixed(6)); 
    const ctx = getEntityContext(appState.activeMove.type === 'LTPOLE' ? 'POLE' : appState.activeMove.type, appState.activeMove.id); if(!ctx) return;
    const net = ctx.net; const ownerId = ctx.ownerId;
    
    if (appState.activeMove.type === 'GSS') {
        const gss = ctx.obj;
        if(gss) { gss.lat = lat; gss.lng = lng; if(net && net.lines) net.lines.forEach(l => { if (l.fromNode == gss.code) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode == gss.code) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } }); }
    } else {
        if (appState.activeMove.type === 'POLE' || appState.activeMove.type === 'LTPOLE') {
            const p = ctx.obj;
            if (p) { p.lat = lat; p.lng = lng; net.dts.forEach(d => { if (d.parentPole == p.poleNo) { d.lat = lat; d.lng = lng; } }); net.lines.forEach(l => { if (l.fromNode == p.poleNo) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode == p.poleNo) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } }); }
        } else if (appState.activeMove.type === 'CONSUMER') { const cons = ctx.obj; if (cons) { cons.lat = lat; cons.lng = lng; } }
    }
    window.cancelObjectMove(); renderEntireNetwork(); 
    if(appState.adminMode) syncAdminEdit(ownerId); else triggerPersistence(); showToast("Location Updated!");
}
window.cancelObjectMove = function() { window.haptic(15); appState.activeMove = null; document.getElementById('live-move-icon').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; renderEntireNetwork(); }

function getFormattedDateTime() { const d = new Date(); const pad = (n) => n.toString().padStart(2, '0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }

async function smartExportFile(filename, dataBlobOrText, mimeType) {
    try {
        showToast("Preparing file export..."); const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
        if (window.cordova && cordova.file) {
            const storageLocation = cordova.file.externalRootDirectory + 'Download/';
            window.resolveLocalFileSystemURL(storageLocation, function(dirEntry) { dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) { fileEntry.createWriter(function(fileWriter) { fileWriter.onwriteend = function() { showToast("File saved to Downloads!"); }; fileWriter.onerror = function(e) { showToast("File write error"); }; fileWriter.write(blob); }); }, err => { showToast("Error creating file"); }); }, err => { showToast("Error accessing Downloads"); });
        } else {
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500); showToast("File Downloaded!");
        }
    } catch (err) { alert("Export failed: " + err.message); }
}

window.exportFullJSONBackup = async function() { window.toggleSidebar(false); const backupData = JSON.stringify(appState.adminMode ? appState.adminStore : appState); await smartExportFile(`DISCOM_Backup_${getFormattedDateTime()}.json`, backupData, "application/json"); }
window.handleImportChoice = function(e) {
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const content = event.target.result; const importedData = JSON.parse(content);
            if (importedData.feeders && importedData.gssNodes) { appState = importedData; triggerPersistence(); renderEntireNetwork(); showToast("Data Imported Successfully!"); } 
            else alert("Invalid Backup Format! File missing core node structures.");
        } catch (err) { alert("Error parsing file."); }
    }; reader.readAsText(file); e.target.value = ''; window.toggleSidebar(false);
}

window.getCSVString = function() {
    const net = getRenderNetwork(); const gssMap = appState.adminMode ? appState.tempGssNodes : appState.gssNodes;
    let csv = "\uFEFFWKT,Name,Type,ParentNode,Details\n"; 
    Object.values(gssMap).forEach(g => csv += `"POINT (${g.lng} ${g.lat})","${g.name}","GSS","","Code: ${g.code}"\n`);
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})","Pole ${p.poleNo}","POLE","${p.dtCode||p.poleNo}","Type: ${p.lineType}"\n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})","DT ${d.code}","DT","${d.parentPole}","Rating: ${d.rating}kVA"\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})","${c.name}","CONSUMER","${c.parentRef}","KNo: ${c.kno}"\n`);
    net.lines.forEach(l => { if (l.coords && l.coords.length === 2) csv += `"LINESTRING (${l.coords[0][1]} ${l.coords[0][0]}, ${l.coords[1][1]} ${l.coords[1][0]})","${l.type}","LINE","${l.fromNode} ➔ ${l.toNode}","Dist: ${(l.distanceMeters||0).toFixed(1)}m"\n`; });
    return csv;
}
window.exportDataToCSV = async function() { window.toggleSidebar(false); await smartExportFile(`Network_${getFormattedDateTime()}.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.exportToAutoCAD_DXF = async function() { 
    window.toggleSidebar(false); let dxf = "0\nSECTION\n2\nENTITIES\n"; getRenderNetwork().lines.forEach(l => { if (l.coords && l.coords[0] && l.coords[1]) dxf += `0\nLINE\n8\n${l.type.replace(/\s+/g,'_')}\n10\n${l.coords[0][1]}\n20\n${l.coords[0][0]}\n30\n0\n11\n${l.coords[1][1]}\n21\n${l.coords[1][0]}\n31\n0\n`; }); dxf += "0\nENDSEC\n0\nEOF\n"; 
    await smartExportFile(`Lines_${getFormattedDateTime()}.dxf`, dxf, "application/dxf"); 
}
window.exportToGoogleEarth_KML = async function() { 
    window.toggleSidebar(false); const esc = u => u.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
    const net = getRenderNetwork(); let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>DISCOM Export</name>\n`; 
    net.lines.forEach(l => { if (l.coords) kml += `<Placemark><LineString><coordinates>${l.coords[0][1]},${l.coords[0][0]},0 ${l.coords[1][1]},${l.coords[1][0]},0</coordinates></LineString></Placemark>\n`; }); 
    net.dts.forEach(d => { if (d.lat) kml += `<Placemark><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>\n`; });
    kml += "</Document>\n</kml>"; await smartExportFile(`Network_${getFormattedDateTime()}.kml`, kml, "application/vnd.google-earth.kml+xml"); 
}

window.generateCadSLDPdf = async function() { 
    window.toggleSidebar(false); const net = getRenderNetwork(); const gssMap = appState.adminMode ? appState.tempGssNodes : appState.gssNodes;
    if(!window.jspdf || !window.jspdf.jsPDF) return alert("PDF Generator library load error.");
    showToast("Generating Auto-Fit SLD PDF...");
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' });
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180; const allPoints = [];
    Object.values(gssMap).forEach(g => allPoints.push(g)); net.dts.forEach(d => allPoints.push(d)); 
    if(allPoints.length === 0) return alert("No DT/GSS nodes found to plot!");
    
    allPoints.forEach(p => { if(p.lat < minLat) minLat = p.lat; if(p.lat > maxLat) maxLat = p.lat; if(p.lng < minLng) minLng = p.lng; if(p.lng > maxLng) maxLng = p.lng; });
    const latBuffer = (maxLat - minLat) * 0.20; const lngBuffer = (maxLng - minLng) * 0.20;
    minLat -= latBuffer; maxLat += latBuffer; minLng -= lngBuffer; maxLng += lngBuffer;
    const margin = 60; const pdfW = 1189 - (margin * 2); const pdfH = 841 - (margin * 2);
    const latDiff = maxLat - minLat || 0.0001; const lngDiff = maxLng - minLng || 0.0001;
    const needsRotation = latDiff > lngDiff; let scale, offsetX, offsetY;

    if (needsRotation) { scale = Math.min(pdfW / latDiff, pdfH / lngDiff) * 0.80; offsetX = margin + (pdfW - (latDiff * scale)) / 2; offsetY = margin + (pdfH - (lngDiff * scale)) / 2; } 
    else { scale = Math.min(pdfW / lngDiff, pdfH / latDiff) * 0.80; offsetX = margin + (pdfW - (lngDiff * scale)) / 2; offsetY = margin + (pdfH - (latDiff * scale)) / 2; }
    
    function getPt(lat, lng) { if (needsRotation) { return { x: offsetX + (lat - minLat) * scale, y: offsetY + (lng - minLng) * scale }; } else { return { x: offsetX + (lng - minLng) * scale, y: 841 - (offsetY + (lat - minLat) * scale) }; } }

    doc.setFontSize(10); doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5);
    net.lines.forEach(l => {
        if(l.type.includes('LT')) return; 
        const c1 = getNodeCoords(l.fromNode, net, gssMap), c2 = getNodeCoords(l.toNode, net, gssMap);
        if(c1 && c2) {
            const pt1 = getPt(c1.lat, c1.lng), pt2 = getPt(c2.lat, c2.lng);
            if (l.phaseType === 'Three Phase' && !l.type.includes('UG CABLE')) {
                const dx = pt2.x - pt1.x; const dy = pt2.y - pt1.y; const len = Math.sqrt(dx*dx + dy*dy) || 0.001; const nx = -dy/len; const ny = dx/len; const off = 1.5; 
                doc.setDrawColor(239, 68, 68); doc.setLineWidth(1.5); doc.line(pt1.x + nx*off, pt1.y + ny*off, pt2.x + nx*off, pt2.y + ny*off);
                doc.setDrawColor(234, 179, 8); doc.line(pt1.x, pt1.y, pt2.x, pt2.y);
                doc.setDrawColor(59, 130, 246); doc.line(pt1.x - nx*off, pt1.y - ny*off, pt2.x - nx*off, pt2.y - ny*off);
            } else if (l.type.includes('UG CABLE')) { doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.5); doc.line(pt1.x, pt1.y, pt2.x, pt2.y); } 
            else { doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5); doc.line(pt1.x, pt1.y, pt2.x, pt2.y); }
            if (l.hasCrossing) { const midX = (pt1.x + pt2.x) / 2; const midY = (pt1.y + pt2.y) / 2; doc.setDrawColor(239, 68, 68); doc.setLineWidth(1); doc.line(midX - 2, midY - 2, midX + 2, midY + 2); doc.line(midX - 2, midY + 2, midX + 2, midY - 2); }
        }
    });

    allPoints.forEach(p => {
        const pt = getPt(p.lat, p.lng);
        if(p.code && p.name && p.name.includes("Substation")) { doc.setFillColor(185, 28, 28); doc.rect(pt.x - 7, pt.y - 7, 14, 14, 'FD'); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.text("GSS", pt.x, pt.y + 2.5, {align:'center'}); } 
        else if(p.rating) { 
            const numOnly = String(p.rating).replace(/[^0-9]/g, '');
            if(p.phase === 'Single Phase') { doc.setFillColor(245, 158, 11); doc.triangle(pt.x, pt.y - 6, pt.x - 6, pt.y + 4, pt.x + 6, pt.y + 4, 'FD'); doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(6); doc.text(numOnly, pt.x, pt.y + 2.5, {align:'center'}); } 
            else { doc.setFillColor(245, 158, 11); doc.rect(pt.x - 4.5, pt.y - 4.5, 9, 9, 'FD'); doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.text(numOnly, pt.x, pt.y + 2.2, {align:'center'}); }
        }
    });

    let t11 = 0, dt1ph = 0, dt3ph = 0;
    net.lines.forEach(l => { if(!l.type.includes('LT')) t11 += (l.distanceMeters||0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
    
    doc.setFont("helvetica", "normal"); doc.setFillColor(255, 255, 255); doc.setDrawColor(0,0,0); doc.setLineWidth(0.5); doc.rect(1189 - 160, 841 - 70, 150, 60, 'FD');
    doc.setTextColor(0, 0, 0); doc.setFontSize(16); doc.text("DISCOM SLD REPORT", 1189 - 155, 841 - 55);
    doc.setFontSize(12); doc.text(`Scope: ${appState.adminMode ? 'Global Network' : net.feeder.name}`, 1189 - 155, 841 - 45); doc.text(`Total HT Line: ${(t11/1000).toFixed(3)} KM`, 1189 - 155, 841 - 35); doc.text(`1-Phase DTs: ${dt1ph}`, 1189 - 155, 841 - 25); doc.text(`3-Phase DTs: ${dt3ph}`, 1189 - 155, 841 - 15);
    await smartExportFile(`SLD_Export_${getFormattedDateTime()}.pdf`, doc.output('blob'), "application/pdf");
}

window.openAboutModal = function() {
    window.toggleSidebar(false);
    openModal(`
    <div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-circle-info"></i> <span data-i18n="about">About App</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
    <div style="text-align:center; padding: 20px 0;">
        <div class="auth-logo" style="color:var(--accent); font-size:3rem; margin-bottom:10px;"><i class="fa-solid fa-bolt-lightning"></i></div>
        <h2 style="font-size:1.4rem; font-weight:800; margin-bottom:5px;">DISCOM Survey Pro</h2>
        <p style="color:var(--text-sub); font-size:0.9rem; margin-bottom:20px;">Enterprise Survey App</p>
        <div style="background:var(--bg-base); padding:15px; border-radius:12px; border:1px solid var(--border);"><p style="font-weight:700; font-size:1rem; color:var(--text-main);">Developed by</p><p style="font-size:1.2rem; font-weight:900; color:var(--accent); margin-top:4px;">Suraj Singh Mehta</p></div>
    </div>`);
}

let appInitialized = false;

async function initializeApplication() {
    if(appInitialized) return; appInitialized = true;

    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const permissions = cordova.plugins.permissions;
        const reqList = [ permissions.ACCESS_FINE_LOCATION, permissions.ACCESS_COARSE_LOCATION, permissions.READ_EXTERNAL_STORAGE, permissions.WRITE_EXTERNAL_STORAGE, permissions.CAMERA ];
        permissions.hasPermission(reqList, function(status) { if (!status.hasPermission) { permissions.requestPermissions(reqList, function(status) { if(!status.hasPermission) showToast("Permissions required!"); }, function(){}); } });
    }
    
    try {
        document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex';
        if (typeof L !== 'undefined') initMapSystem();
        let data = null;
        if (typeof localforage !== 'undefined') { data = await localforage.getItem(DB_KEY); } else { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) appState = data; if (!appState.unsyncedCount) appState.unsyncedCount = 0;
        appState.adminMode = false; appState.adminStore = {}; // Reset admin powers on boot
        
        if(appState.settings.darkMode) document.documentElement.setAttribute('data-theme', 'dark');
        translateApp(); updateSyncUI();
        
        if (appState.user && appState.user.isLoggedIn) { applyAuthUIVisuals(); setupRealtimeListeners(); if(map) { renderEntireNetwork(); centerMapOnGSS(); } } 
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); setupRealtimeListeners(); pullFromSupabase(); 
                }
            });
        }
    } catch (e) { console.error("Initialization Error:", e); } 
    finally { if (navigator.splashscreen) setTimeout(() => { navigator.splashscreen.hide(); }, 500); }
}

document.addEventListener('deviceready', initializeApplication, false); 
window.addEventListener('DOMContentLoaded', () => { setTimeout(initializeApplication, 2500); });
