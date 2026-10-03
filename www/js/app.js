const DB_KEY = "DISCOM_ENTERPRISE_DB";

const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
let supabaseClient = null;

// RELATIONAL LOCAL DATABASE STRUCTURE
let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', theme: 'light', liveSync: false }, 
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: null,
    gssNodes: {}, 
    feeders: {}, // { 'F-01': { name: 'Main', parentGss: '132' } }
    objects: [], // Flat relational array: [{id, feeder_code, object_type, details, sync_status}]
    photos: [], // Kept isolated for performance
    deleted_objects: [], // Tracks IDs to delete online
    orphanPoleIds: new Set()
};

let historyStack = []; let map = null; let tileLayers = {}; let currentTileIndex = 0; let layerKeys = []; let featureGroups = {};
window.isSetupModalOpen = false; window.tempPhotoUrl = null;

const i18n = {
    en: { appLanguage: "App Language", distUnit: "Distance Unit", theme: "Theme Mode", settings: "Settings", save: "Save", edit: "Edit", delete: "Delete", mapSetup: "Network Setup Required" },
    hi: { appLanguage: "ऐप की भाषा", distUnit: "दूरी की इकाई", theme: "थीम मोड", settings: "सेटिंग्स", save: "सेव करें", edit: "बदलें", delete: "डिलीट", mapSetup: "नेटवर्क सेटअप ज़रूरी है" }
};

function applyTranslations() { const lang = appState.settings.language || 'en'; document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if(i18n[lang] && i18n[lang][key]) { if(el.tagName === 'INPUT' && el.type === 'text') el.placeholder = i18n[lang][key]; else el.innerHTML = i18n[lang][key]; } }); }
function applyTheme() { if(appState.settings.theme === 'dark') document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode'); }

window.getDistStr = (lat, lng) => { if(!lat || !lng || isNaN(lat)) return ''; if(!map) return ''; const c = map.getCenter(); return window.formatDistance(window.calcDistance(c.lat, c.lng, lat, lng)); };

function initMapLayers() {
    if (typeof L === 'undefined') return; 
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: false, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([26.9150, 75.7830], 16);
    map.on('zoomend', updateMapZoomClasses); 
    map.on('move', () => { 
        const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        if (appState.placementType && document.getElementById('center-placement-pin').style.display === 'block') {
            const net = getActiveNetwork();
            if (net) {
                let nearestDist = Infinity; let nearestName = 'None';
                const checkNode = (lat, lng, name) => { if(lat && lng && !isNaN(lat) && !isNaN(lng)) { const d = window.calcDistance(c.lat, c.lng, lat, lng); if(d < nearestDist) { nearestDist = d; nearestName = name; } } };
                net.poles.forEach(p => checkNode(p.lat, p.lng, `Pole ${p.poleNo}`)); net.dts.forEach(d => checkNode(d.lat, d.lng, `DT ${d.code}`));
                const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if(gss) checkNode(gss.lat, gss.lng, 'GSS');
                const ind = document.getElementById('live-distance-indicator');
                if (nearestDist === Infinity) { ind.style.display = 'none'; } else { ind.style.display = 'block'; ind.innerText = `Nearest: ${nearestName} (${window.formatDistance(nearestDist)})`; }
            }
        }
    });

    tileLayers = { osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) }, hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) } };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    featureGroups = { gss: L.featureGroup().addTo(map), lines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map), poles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) };
}

function updateMapZoomClasses() {
    if(!map) return; const z = map.getZoom(); const mapEl = document.getElementById('map');
    mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-ht-lines', 'hide-dt', 'hide-gss');
    if (z <= 18) mapEl.classList.add('hide-consumers'); if (z <= 17) mapEl.classList.add('hide-lt-poles'); if (z <= 16) mapEl.classList.add('hide-lt-lines'); if (z <= 15) mapEl.classList.add('hide-ht-poles'); if (z <= 14) mapEl.classList.add('hide-ht-lines'); if (z <= 13) mapEl.classList.add('hide-dt'); if (z <= 12) mapEl.classList.add('hide-gss'); 
}

window.toggleMapLayer = function() { if(!map) return; map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name; }

window.updateFeederDropdown = function() {
    const header = document.getElementById('activeFeederLabel'); if(!header) return;
    const keys = Object.keys(appState.feeders || {});
    if(keys.length === 0) { header.innerText = 'No Feeder'; appState.currentFeederCode = null; } 
    else {
        if(!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) { appState.currentFeederCode = keys[0]; }
        const f = appState.feeders[appState.currentFeederCode]; header.innerText = f ? f.name : 'Unnamed Feeder';
    }
};

window.switchFeeder = function(code) { if (appState.feeders[code]) { appState.currentFeederCode = code; window.updateFeederDropdown(); renderEntireNetwork(); triggerPersistence(); centerMapOnGSS(); window.toggleSidebar(false); } }

// RELATIONAL TO HIERARCHICAL CONVERTER FOR RENDERING
function getActiveNetwork() {
    const fCode = appState.currentFeederCode;
    if (!fCode || !appState.feeders[fCode]) return null;
    let net = { feeder: { ...appState.feeders[fCode], code: fCode }, poles: [], lines: [], dts: [], consumers: [] };
    appState.objects.forEach(obj => {
        if (obj.feeder_code === fCode) {
            if (obj.object_type === 'POLE') net.poles.push(obj.details);
            else if (obj.object_type === 'DT') net.dts.push(obj.details);
            else if (obj.object_type === 'LINE') net.lines.push(obj.details);
            else if (obj.object_type === 'CONSUMER') net.consumers.push(obj.details);
        }
    });
    return net;
}

function showToast(msg) { const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg'); if (!toast || !msgElem) return; msgElem.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
function setSyncStatus(status) { 
    const ind = document.getElementById('sync-indicator'); if(!navigator.onLine) status = 'offline'; 
    if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active" style="color:#facc15;"></i>'; 
    else if(status === 'synced') ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success" style="color:#10b981;"></i>'; 
    else ind.innerHTML = '<i class="fa-solid fa-cloud-xmark sync-error" style="color:#ef4444;"></i>'; 
}

function getPhotoUrl(objId) { if(!appState.photos) return null; const p = appState.photos.find(x => x.object_id === objId); return p ? p.photo_url : null; }

/* ====== NEW MANUAL RELATIONAL SYNC LOGIC ====== */
window.manualSync = async function() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return showToast("Login Required for Sync");
    if (!navigator.onLine) return showToast("No Internet Connection!");
    setSyncStatus('syncing'); showToast("Syncing Database...");

    try {
        // 1. DELETE FROM ONLINE
        if (appState.deleted_objects.length > 0) {
            await supabaseClient.from('survey_objects').delete().in('id', appState.deleted_objects);
            await supabaseClient.from('object_photos').delete().in('object_id', appState.deleted_objects);
            appState.deleted_objects = [];
        }

        // 2. UPSERT FEEDERS
        for(let code in appState.feeders) {
            let f = appState.feeders[code];
            await supabaseClient.from('feeders').upsert({ feeder_code: code, gss_code: f.parentGss, feeder_name: f.name, user_id: appState.user.id });
        }

        // 3. UPSERT PENDING OBJECTS
        const pendingObjects = appState.objects.filter(o => o.sync_status === 'PENDING');
        if (pendingObjects.length > 0) {
            const objPayload = pendingObjects.map(o => ({ id: o.id, feeder_code: o.feeder_code, object_type: o.object_type, details: o.details, user_id: appState.user.id, sync_status: 'SYNCED' }));
            for (let i = 0; i < objPayload.length; i += 100) { await supabaseClient.from('survey_objects').upsert(objPayload.slice(i, i + 100)); }
            appState.objects.forEach(o => { if(o.sync_status === 'PENDING') o.sync_status = 'SYNCED'; });
        }

        // 4. UPSERT PENDING PHOTOS
        const pendingPhotos = appState.photos.filter(p => !p.synced);
        if (pendingPhotos.length > 0) {
            const photoPayload = pendingPhotos.map(p => ({ id: p.id, object_id: p.object_id, object_type: p.object_type, photo_url: p.photo_url, user_id: appState.user.id }));
            for(let i=0; i<photoPayload.length; i+=5) { await supabaseClient.from('object_photos').upsert(photoPayload.slice(i, i+5)); }
            appState.photos.forEach(p => p.synced = true);
        }

        // 5. UPDATE GSS & SETTINGS
        const meta = { gssNodes: appState.gssNodes, settings: appState.settings };
        await supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: meta, updated_at: new Date().toISOString() });

        triggerPersistence(); setSyncStatus('synced'); showToast("Sync Complete!");
    } catch (err) { console.error("Sync error", err); setSyncStatus('offline'); showToast("Sync Failed!"); }
};

// Listen to Sync Button Click
document.addEventListener("DOMContentLoaded", () => {
    const syncBtn = document.getElementById('sync-indicator');
    if(syncBtn) syncBtn.addEventListener('click', window.manualSync);
});

async function pullFromSupabase() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; setSyncStatus('syncing');
    try {
        // PULL META
        const { data: metaData } = await supabaseClient.from('survey_data').select('data').eq('user_id', appState.user.id);
        if (metaData && metaData.length > 0) {
            appState.gssNodes = metaData[0].data.gssNodes || {}; 
            appState.settings = { ...appState.settings, ...(metaData[0].data.settings || {}) };
        }
        // PULL FEEDERS
        const { data: fData } = await supabaseClient.from('feeders').select('*').eq('user_id', appState.user.id);
        if (fData) { fData.forEach(f => { appState.feeders[f.feeder_code] = { name: f.feeder_name, parentGss: f.gss_code }; }); }
        // PULL OBJECTS
        const { data: oData } = await supabaseClient.from('survey_objects').select('*').eq('user_id', appState.user.id);
        if (oData) { appState.objects = oData.map(o => ({ id: o.id, feeder_code: o.feeder_code, object_type: o.object_type, details: o.details, sync_status: 'SYNCED' })); }
        // PULL PHOTOS
        const { data: pData } = await supabaseClient.from('object_photos').select('id, object_type, object_id, photo_url').eq('user_id', appState.user.id);
        if (pData) { appState.photos = pData.map(p => ({ id: p.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url, synced: true })); }

        triggerPersistence(); applyTranslations(); applyTheme(); if(map) map.invalidateSize();
        renderEntireNetwork(); window.updateFeederDropdown(); setSyncStatus('synced'); centerMapOnGSS(); checkOnboardingFlow();
    } catch (err) { console.error("Pull error:", err); setSyncStatus('offline'); checkOnboardingFlow(); }
}

function triggerPersistence() { 
    try {
        if(typeof localforage !== 'undefined') { localforage.setItem(DB_KEY, appState).catch((err) => console.log("LocalForage Error:", err)); } 
        else { localStorage.setItem(DB_KEY, JSON.stringify(appState)); }
    } catch(err) { console.error("Persistence Error:", err); }
}

window.closeModal = function() { 
    document.getElementById('formModalOverlay').classList.remove('open'); 
    window.isSetupModalOpen = false; 
    const distInd = document.getElementById('live-distance-indicator'); if (distInd) distInd.style.display = 'none'; 
    if(appState.user && appState.user.isLoggedIn) { setTimeout(window.checkOnboardingFlow, 400); } 
};

window.saveNewPole = function() { 
    try {
        const no = document.getElementById('inpPoleNo').value.trim(); const category = document.getElementById('inpPoleCategory').value;
        const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); 
        const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; 
        const condition = document.getElementById('inpPoleCondition').value;
        
        if (!no) return alert("Enter pole number"); 
        const net = getActiveNetwork(); if(!net) return alert("No active network!");
        if (net.poles.some(p => String(p.poleNo) === no)) return alert(`Pole exists!`); 
        
        const objId = 'P_'+Date.now();
        const details = { id: objId, poleNo: no, lineType: category, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng };
        appState.objects.push({ id: objId, feeder_code: appState.currentFeederCode, object_type: 'POLE', details: details, sync_status: 'PENDING' });
        
        attachTempPhoto('POLE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("HT Pole added!");
    } catch(err) { console.error(err); alert("Error saving pole: " + err.message); }
}

window.saveNewLTPole = function() {
    try {
        const dtCode = document.getElementById('inpLTPoleDT').value.replace('DT_', ''); 
        const category = document.getElementById('inpPoleCategory').value; const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); 
        const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; const condition = document.getElementById('inpPoleCondition').value;
        
        if (!dtCode) return alert("Select DT"); 
        const net = getActiveNetwork(); if(!net) return alert("No active network!");
        const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); 
        let maxId = 0; existingLTPoles.forEach(ep => { const parts = String(ep.poleNo).split('-'); if (parts.length > 1) { const num = parseInt(parts[parts.length - 1]); if (!isNaN(num) && num > maxId) maxId = num; } }); 
        const finalPoleNo = `${dtCode}-${maxId + 1}`;
        if (net.poles.some(p => String(p.poleNo) === String(finalPoleNo))) return alert(`Pole ${finalPoleNo} exists!`); 
        
        const objId = 'P_'+Date.now();
        const details = { id: objId, poleNo: finalPoleNo, lineType: category, dtCode: dtCode, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng };
        appState.objects.push({ id: objId, feeder_code: appState.currentFeederCode, object_type: 'POLE', details: details, sync_status: 'PENDING' });
        
        attachTempPhoto('POLE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("LT Pole added!");
    } catch(err) { console.error(err); alert("Error saving LT pole"); }
}

window.saveNewLine = function() { 
    try {
        const from = document.getElementById('inpFromNode').value; const to = document.getElementById('inpToNode').value;
        const type = document.getElementById('inpLineType').value; const conductor = document.getElementById('inpConductor').value; 
        const phase = type === '11 KV LINE' ? document.getElementById('inpLinePhase').value : 'N/A';
        
        if (!from || !to) return alert("Select both From and To nodes!"); if (from === to) return alert("Cannot connect node to itself!");
        const net = getActiveNetwork(); if(!net) return alert("No active network!");
        const spec = getLineSpec(type, phase, conductor); const existingLine = net.lines.find(l => (l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from));
        if(existingLine) return alert("Line already exists!");
        
        const c1 = getNodeCoords(from); const c2 = getNodeCoords(to); 
        if(!c1 || !c2 || isNaN(c1.lat) || isNaN(c2.lat)) return alert("Invalid node coordinates!"); 
        
        const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); const objId = 'LN_'+Date.now();
        const details = { id: objId, type: spec.name, conductor: conductor, phase: phase, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] };
        appState.objects.push({ id: objId, feeder_code: appState.currentFeederCode, object_type: 'LINE', details: details, sync_status: 'PENDING' });
        
        attachTempPhoto('LINE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line added!");
    } catch(err) { console.error(err); alert("Error saving line"); }
}

window.saveNewDT = function() { 
    try {
        const parentRef = document.getElementById('inpDTParent').value; const code = document.getElementById('inpDTCode').value.trim();
        const mountedOn = document.getElementById('inpDTMounted').value; const rating = parseFloat(document.getElementById('inpDTRating').value);
        const phase = document.getElementById('inpDTPhase').value; const location = document.getElementById('inpDTLocation').value.trim();
        
        if (!code) return alert("Enter DT Code"); 
        const net = getActiveNetwork(); if(!net) return alert("No active network!");
        
        let rawParentRef = parentRef; if(parentRef.startsWith('POLE_')) rawParentRef = parentRef.replace('POLE_', ''); if(parentRef.startsWith('GSS_')) rawParentRef = parentRef.replace('GSS_', '');

        let lat = 0, lng = 0; const p = net.poles.find(x => String(x.poleNo) === String(rawParentRef)); 
        if (p && !isNaN(p.lat)) { lat = p.lat; lng = p.lng; } else { const gss = appState.gssNodes[rawParentRef]; if(gss && !isNaN(gss.lat)) { lat = gss.lat; lng = gss.lng; } else return alert("Parent node coordinates missing!"); }

        const objId = 'DT_' + Date.now();
        const details = { id: objId, parentPole: rawParentRef, mountedOn: mountedOn, code, rating, phase, location, lat: lat, lng: lng };
        appState.objects.push({ id: objId, feeder_code: appState.currentFeederCode, object_type: 'DT', details: details, sync_status: 'PENDING' });
        
        attachTempPhoto('DT', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT added!");
    } catch(err) { console.error(err); alert("Error saving DT"); }
}

window.saveNewConsumer = function() { 
    try {
        const parentRefRaw = document.getElementById('inpConsParent').value; const kno = document.getElementById('inpConsKno').value.trim();
        const name = document.getElementById('inpConsName').value.trim(); const load = document.getElementById('inpConsLoad').value.trim();
        const status = document.getElementById('inpConsStatus').value; const cType = document.getElementById('inpConsType').value; 
        const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); 
        
        const net = getActiveNetwork(); if(!net) return alert("No active network!");
        if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number exists!");
        
        let rawParentRef = parentRefRaw; if (rawParentRef.startsWith('POLE_')) rawParentRef = rawParentRef.replace('POLE_', ''); if (rawParentRef.startsWith('DT_')) rawParentRef = rawParentRef.replace('DT_', '');
        let parentType = parentRefRaw.startsWith('DT_') ? 'DT' : 'POLE';
        if (!name || !kno) return alert("Enter Name and K-No"); 
        
        const objId = 'CS_'+Date.now();
        const details = { id: objId, parentRef: rawParentRef, parentType, kno, name, load, status, cType, lat, lng };
        appState.objects.push({ id: objId, feeder_code: appState.currentFeederCode, object_type: 'CONSUMER', details: details, sync_status: 'PENDING' });
        
        attachTempPhoto('CONSUMER', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer added!");
    } catch(err) { console.error(err); alert("Error saving consumer"); }
}

window.attachTempPhoto = function(type, id) {
    if(window.tempPhotoUrl) {
        if(!appState.photos) appState.photos = [];
        appState.photos.push({ id: 'PH_' + Date.now(), object_type: type, object_id: id, photo_url: window.tempPhotoUrl, synced: false });
        window.tempPhotoUrl = null;
    }
};

/* ====== PERFECT RELATIONAL DELETION ====== */
function flagForDelete(id) {
    appState.objects = appState.objects.filter(o => o.id !== id);
    appState.deleted_objects.push(id);
    setSyncStatus('pending'); // Prompts user to sync
}

window.deleteEntity = function(type, id) {
    const net = getActiveNetwork(); if(!confirm(`Delete this ${type.toUpperCase()}?`)) return; 
    
    if (type === 'line' || type === 'consumer') { flagForDelete(id); }
    else if (type === 'dt') {
        const d = net.dts.find(x => x.id === id); if(!d) return;
        const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code));
        const ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)); const ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn);
        net.lines.filter(l => l.fromNode === ('DT_' + d.code) || l.toNode === ('DT_' + d.code) || ltPoleNodeIds.includes(String(l.fromNode)) || ltPoleNodeIds.includes(String(l.toNode))).forEach(l => flagForDelete(l.id));
        net.consumers.filter(c => (c.parentType === 'DT' && String(c.parentRef) === String(d.code)) || (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef)))).forEach(c => flagForDelete(c.id));
        ltPolesToRemove.forEach(p => flagForDelete(p.id));
        flagForDelete(id);
    } else if (type === 'pole') { 
        const p = net.poles.find(x => x.id === id); if (!p) return; 
        if (p.lineType === 'LT') {
            net.consumers.filter(c => c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo)).forEach(c => flagForDelete(c.id));
            net.lines.filter(l => String(l.fromNode) === ('POLE_'+p.poleNo) || String(l.toNode) === ('POLE_'+p.poleNo)).forEach(l => flagForDelete(l.id));
            flagForDelete(id);
        } else { 
            const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); 
            dtsOnPole.forEach(dt => window.deleteEntity('dt', dt.id)); 
            net.lines.filter(l => l.fromNode === ('POLE_'+p.poleNo) || l.toNode === ('POLE_'+p.poleNo)).forEach(l => flagForDelete(l.id));
            flagForDelete(id);
        } 
    } else if (type === 'gss') { 
        if (appState.gssNodes[id]) { delete appState.gssNodes[id]; setSyncStatus('pending'); }
    }
    
    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast("Deleted Locally. Click Cloud to Sync.");
}

window.saveEditedPole = function(id) { const obj = appState.objects.find(x => x.id === id); if(!obj) return; obj.details.poleType = document.getElementById('editMainPoleType').value; obj.details.poleConfig = obj.details.poleType === 'PCC' ? document.getElementById('editPccConfig').value : 'N/A'; obj.details.condition = document.getElementById('editPoleCondition').value; obj.sync_status = 'PENDING'; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Pole Settings Updated"); setSyncStatus('pending'); }
window.saveEditedDT = function(id) { const obj = appState.objects.find(x => x.id === id); if (!obj) return; obj.details.phase = document.getElementById('editDTPhase').value; obj.details.mountedOn = document.getElementById('editDTMounted').value; obj.details.rating = parseFloat(document.getElementById('editDTRating').value); obj.details.location = document.getElementById('editDTLocation').value.trim(); obj.sync_status = 'PENDING'; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT Updated"); setSyncStatus('pending'); }
window.saveEditedConsumer = function(id) { const obj = appState.objects.find(x => x.id === id); if (!obj) return; obj.details.name = document.getElementById('editConsName').value.trim(); obj.details.load = document.getElementById('editConsLoad').value.trim(); obj.details.status = document.getElementById('editConsStatus').value; obj.details.cType = document.getElementById('editConsType').value; obj.sync_status = 'PENDING'; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer Updated"); setSyncStatus('pending'); }
window.saveEditedLine = function(id) { const obj = appState.objects.find(x => x.id === id); if (!obj) return; if(obj.details.type.includes('11')) obj.details.phase = document.getElementById('editLinePhase').value; obj.details.conductor = document.getElementById('editLineConductor').value; obj.sync_status = 'PENDING'; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line Updated"); setSyncStatus('pending'); }

/* ====== SVG & CORE RENDER LOGIC ====== */
const C_YELLOW = '#facc15'; const W_BASE = '#ffffff';
function getPoleSVG(type, config, isOrphan) {
    const fill = isOrphan ? '#ef4444' : C_YELLOW;
    if(type === 'TOWER') return `<svg viewBox="0 0 60 80" style="width:36px;height:48px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="#1e293b" stroke-width="6" stroke-linecap="round"/><path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="${fill}" stroke-width="4" stroke-linecap="round"/><line x1="18" y1="40" x2="42" y2="40" stroke="#1e293b" stroke-width="4"/><line x1="12" y1="60" x2="48" y2="60" stroke="#1e293b" stroke-width="4"/><circle cx="30" cy="5" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    if(type === 'RAIL POLE') return `<svg viewBox="0 0 40 80" style="width:24px;height:48px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><rect x="12" y="10" width="16" height="65" fill="${fill}" stroke="#1e293b" stroke-width="3"/><line x1="5" y1="20" x2="35" y2="20" stroke="#1e293b" stroke-width="4"/><circle cx="12" cy="15" r="3" fill="#fff" stroke="#000" stroke-width="1.5"/><circle cx="28" cy="15" r="3" fill="#fff" stroke="#000" stroke-width="1.5"/></svg>`;
    if(type === 'PCC' && config === 'Double Pole') return `<svg viewBox="0 0 70 80" style="width:40px;height:48px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><line x1="20" y1="15" x2="20" y2="75" stroke="#1e293b" stroke-width="6"/><line x1="20" y1="15" x2="20" y2="75" stroke="${fill}" stroke-width="4"/><line x1="50" y1="15" x2="50" y2="75" stroke="#1e293b" stroke-width="6"/><line x1="50" y1="15" x2="50" y2="75" stroke="${fill}" stroke-width="4"/><line x1="10" y1="25" x2="60" y2="25" stroke="#1e293b" stroke-width="5"/><line x1="10" y1="45" x2="60" y2="45" stroke="#1e293b" stroke-width="4"/><circle cx="15" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="35" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="55" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    return `<svg viewBox="0 0 50 80" style="width:30px;height:48px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><line x1="25" y1="20" x2="25" y2="75" stroke="#1e293b" stroke-width="6" stroke-linecap="round"/><line x1="25" y1="20" x2="25" y2="75" stroke="${fill}" stroke-width="4" stroke-linecap="round"/><path d="M 8 15 L 25 25 L 42 15" fill="none" stroke="#1e293b" stroke-width="5" stroke-linejoin="round"/><circle cx="8" cy="10" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="42" cy="10" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="25" cy="14" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
}
function getDTSVG(phase, rating) {
    const numRating = String(rating).replace(/[^0-9]/g, ''); const lightOrange = '#f97316';
    if(phase === 'Single Phase') return `<svg viewBox="0 0 50 60" style="width:24px;height:30px; filter:drop-shadow(0 4px 6px rgba(0,0,0,0.8));"><rect x="23" y="2" width="4" height="8" fill="#cbd5e1" stroke="#000" stroke-width="1"/><rect x="10" y="10" width="30" height="40" rx="2" fill="${lightOrange}" stroke="#0f172a" stroke-width="2"/><text x="25" y="35" font-size="14" font-weight="900" fill="#fff" text-anchor="middle" font-family="sans-serif">${numRating}</text></svg>`;
    return `<svg viewBox="0 0 70 70" style="width:32px;height:32px; filter:drop-shadow(0 4px 6px rgba(0,0,0,0.8));"><rect x="18" y="3" width="6" height="12" fill="#cbd5e1" stroke="#000" stroke-width="1" rx="1"/><rect x="32" y="3" width="6" height="12" fill="#cbd5e1" stroke="#000" stroke-width="1" rx="1"/><rect x="46" y="3" width="6" height="12" fill="#cbd5e1" stroke="#000" stroke-width="1" rx="1"/><rect x="12" y="15" width="46" height="45" rx="2" fill="${lightOrange}" stroke="#0f172a" stroke-width="2.5"/><text x="35" y="44" font-size="16" font-weight="900" fill="#fff" text-anchor="middle" font-family="sans-serif">${numRating}</text></svg>`;
}
function getConsumerSVG(cType, status) {
    let iconClass = 'fa-house'; 
    if(cType === 'NonDomestic') iconClass = 'fa-building'; else if(cType === 'Agriculture') iconClass = 'fa-leaf'; else if(cType === 'SIP MIP') iconClass = 'fa-industry'; else if(cType === 'Other') iconClass = 'fa-house';
    let bgColor = '#10b981'; if(status === 'DC') bgColor = '#facc15'; else if(status === 'PDC') bgColor = '#ef4444';
    const iconColor = status === 'DC' ? '#000' : '#fff';
    return `<div style="position:relative; width:26px; height:26px; display:flex; align-items:center; justify-content:center;"><div style="background:${bgColor}; border:2.5px solid #fff; border-radius:50%; width:100%; height:100%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(0,0,0,0.8); z-index:2;"><i class="fa-solid ${iconClass}" style="color:${iconColor}; font-size:12px;"></i></div><div style="position:absolute; bottom:-6px; width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:8px solid ${bgColor}; z-index:1; filter:drop-shadow(0 2px 2px rgba(0,0,0,0.4));"></div></div>`;
}
function getLineSpec(type, phase, conductor) {
    const t = (type || '').toUpperCase(); const cond = (conductor || '').toUpperCase();
    if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 3, dash: null, filterKey: 'linesLT', lineClass: 'lt-line-path', strokeColor: '#000000' };
    let lineClass = 'ht-line-path'; let color = '#2563eb'; let weight = 3; let strokeColor = '#ffffff';
    if (cond.includes('UNDERGROUND') || cond.includes('UG')) { color = '#000000'; weight = 5; strokeColor = '#ffffff'; lineClass = 'ug-line-path'; } 
    else if (phase === 'Three Phase') { lineClass = 'ryb-line-path'; color = '#2563eb'; }
    return { name: '11 KV LINE', color: color, weight: weight, dash: null, filterKey: 'lines11', lineClass: lineClass, strokeColor: strokeColor };
}
window.getOffsetCoords = function(coords, offsetMeters) {
    if(!coords || !coords[0] || !coords[1]) return coords;
    const lat1 = coords[0][0], lng1 = coords[0][1]; const lat2 = coords[1][0], lng2 = coords[1][1];
    const dx = (lng2 - lng1) * 111139 * Math.cos(lat1 * Math.PI / 180); const dy = (lat2 - lat1) * 111139;
    const len = Math.sqrt(dx * dx + dy * dy); if (len === 0) return coords;
    const nx = -dy / len; const ny = dx / len;
    const dLng = (nx * offsetMeters) / (111139 * Math.cos(lat1 * Math.PI / 180)); const dLat = (ny * offsetMeters) / 111139;
    return [[lat1 + dLat, lng1 + dLng], [lat2 + dLat, lng2 + dLng]];
};

function renderEntireNetwork() {
    if(!map) return; window.updateFeederDropdown();
    try {
        updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers()); 
        Object.values(appState.gssNodes).forEach(gss => {
            if (typeof gss.lat === 'number' && !isNaN(gss.lat)) {
                if (appState.activeMove && appState.activeMove.id === gss.code) return; 
                const gssIcon = L.divIcon({ className: 'gss-square-icon', html: `<span>GSS</span>`, iconSize: [36,36], iconAnchor: [18,18] });
                const m = L.marker([gss.lat, gss.lng], { icon: gssIcon, zIndexOffset: 500 });
                m.on('click', () => { window.openObjectSheet('GSS', gss.code, gss.name, `Code: <b>${gss.code}</b>`); }); 
                featureGroups.gss.addLayer(m);
            }
        });
        const net = getActiveNetwork(); if(!net) return; const f = appState.filters;

        if (f.poles) {
            net.poles.forEach(p => {
                if(isNaN(p.lat) || isNaN(p.lng)) return;
                const isOrphan = appState.orphanPoleIds.has(p.id), isLT = p.lineType === 'LT';
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];
                const svgHtml = getPoleSVG(p.poleType, p.poleConfig, isOrphan);
                const poleClass = isLT ? 'lt-pole' : 'ht-pole';
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: `pole-marker-icon ${poleClass} ${isOrphan ? 'orphan-pulse' : ''}`, html: `${svgHtml}<span>${displayNo}</span>`, iconSize: [40, 56], iconAnchor: [20, 10] }), zIndexOffset: 200 });
                m.on('click', () => { window.openObjectSheet('POLE', p.id, `Pole ${p.poleNo}`, `Type: <b>${p.lineType || 'HT'}</b><br>Config: <b>${p.poleType || 'Standard'} ${p.poleConfig&&p.poleConfig!=='N/A'?'('+p.poleConfig+')':''}</b><br>Condition: <b>${p.condition||'Good'}</b><br>Parent: <b>${p.dtCode || 'Feeder'}</b>`); }); 
                featureGroups.poles.addLayer(m);
            });
        }
        if (f.dts) {
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => x.poleNo == d.parentPole); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng && !isNaN(d.lat)) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); const svgHtml = getDTSVG(d.phase, d.rating);
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: `dt-square-icon ${isOrphan ? 'orphan-pulse' : ''}`, html: svgHtml, iconSize: [36, 36], iconAnchor: [18, 6] }), zIndexOffset: 400 });
                    m.on('click', () => { window.openObjectSheet('DT', d.id, `DT Code: ${d.code}`, `Rating: <b>${d.rating} kVA</b><br>Phase: <b>${d.phase || 'Three Phase'}</b><br>Mounted On: <b>${d.mountedOn || 'Double Pole (DP)'}</b><br>Loc: <b>${d.location||'N/A'}</b>`); }); 
                    featureGroups.dts.addLayer(m);
                }
            });
        }
        net.lines.forEach(line => {
            const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
            if (c1 && c2 && !isNaN(c1.lat) && !isNaN(c2.lat)) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = getLineSpec(line.type, line.phase, line.conductor); if (!f[spec.filterKey]) return;
            const hitPoly = L.polyline(line.coords, { color: 'transparent', weight: 35, className: spec.lineClass }).addTo(featureGroups.lines);
            
            if(spec.lineClass === 'ryb-line-path') { 
                const coordsR = window.getOffsetCoords(line.coords, 2); const coordsB = window.getOffsetCoords(line.coords, -2); 
                L.polyline(coordsR, { color: '#ef4444', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(line.coords, { color: '#facc15', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(coordsB, { color: '#3b82f6', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
            } else if (spec.lineClass === 'ug-line-path') {
                L.polyline(line.coords, { color: '#ffffff', weight: spec.weight + 4, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(line.coords, { color: spec.color, weight: spec.weight, dashArray: '8, 8', className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
            } else { 
                L.polyline(line.coords, { color: spec.strokeColor, weight: spec.weight + 4, opacity: 0.8, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(line.coords, { color: spec.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
            }
            hitPoly.on('click', () => { window.openObjectSheet('LINE', line.id, spec.name, `Phase: <b>${line.phase || 'N/A'}</b><br>Conductor: <b>${line.conductor || 'Standard'}</b><br>From-To: <b>${line.fromNode} ➔ ${line.toNode}</b><br>Dist: <b>${window.formatDistance(line.distanceMeters||0)}</b>`); });
        });
        if (f.consumers) {
            net.consumers.forEach(c => {
                if (isNaN(c.lat) || isNaN(c.lng) || (appState.activeMove && appState.activeMove.id === c.id)) return; 
                const latOffset = (Math.random() - 0.5) * 0.00003; const lngOffset = (Math.random() - 0.5) * 0.00003;
                const m = L.marker([c.lat + latOffset, c.lng + lngOffset], { icon: L.divIcon({ className: 'consumer-marker-icon', html: getConsumerSVG(c.cType, c.status), iconSize: [28,34], iconAnchor: [14, 17] }), zIndexOffset: 100 });
                m.on('click', () => { window.openObjectSheet('CONSUMER', c.id, c.name, `Type: <b>${c.cType||'Domestic'}</b><br>Status: <b>${c.status||'Regular'}</b><br>K-No: <b>${c.kno}</b><br>Load: <b>${c.load||'N/A'}</b>`); }); 
                featureGroups.consumers.addLayer(m);
                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = getNodeCoords(parentStr);
                if (pCoords && !isNaN(pCoords.lat)) L.polyline([[c.lat, c.lng], [pCoords.lat, pCoords.lng]], { color: '#000000', weight: 1.5, dashArray: '3, 5', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
            });
        }
        updateMapZoomClasses();
        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; 
        net.lines.forEach(l => { if (getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); });
        net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        if(document.getElementById('kpi11')) document.getElementById('kpi11').innerText = window.formatDistance(t11);
        if(document.getElementById('kpiLT')) document.getElementById('kpiLT').innerText = window.formatDistance(tLT);
        document.getElementById('kpi3Ph').innerText = dt3ph; document.getElementById('kpi1Ph').innerText = dt1ph;
        document.getElementById('kpiCons').innerText = net.consumers.length;
    } catch(err) { console.error("Rendering error:", err); }
}

/* ====== EXPORTS & STARTUP ====== */
window.exportDataToCSV = async function() { window.toggleSidebar(false); await smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}_GE.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.requestAppPermissions = function() {
    if(window.cordova && cordova.plugins && cordova.plugins.permissions) {
        var permissions = cordova.plugins.permissions;
        var list = [ permissions.ACCESS_FINE_LOCATION, permissions.CAMERA, permissions.READ_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ];
        permissions.requestPermissions(list, function(status) {
            permissions.checkPermission(permissions.ACCESS_FINE_LOCATION, function(locStatus) {
                if (locStatus.hasPermission) { document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions(); } 
                else { document.getElementById('permission-overlay').style.display = 'flex'; showToast("Location strictly required!"); }
            }, null);
        }, function() { document.getElementById('permission-overlay').style.display = 'flex'; });
    } else { document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions(); }
}
async function initializeAppPostPermissions() {
    try {
        initMapLayers();
        if (typeof supabase !== 'undefined') supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        let data = null; if (typeof localforage !== 'undefined') data = await localforage.getItem(DB_KEY); 
        if (!data) { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) appState = data; 
        applyTranslations(); applyTheme();
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); setTimeout(() => { if(map) map.invalidateSize(); renderEntireNetwork(); centerMapOnGSS(); checkOnboardingFlow(); }, 100);
        } else { document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; }
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); pullFromSupabase(); 
                }
            }).catch(err => console.log("Offline mode"));
        }
    } catch (e) { console.error("Init Error:", e); document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; showToast("Offline Mode / Load Error"); }
}
function startAppStartupSequence() {
    setTimeout(() => {
        const loader = document.getElementById('erection-loader'); if(loader) loader.style.display = 'none';
        if(navigator.splashscreen) navigator.splashscreen.hide();
        if(window.cordova && cordova.plugins && cordova.plugins.permissions) { window.requestAppPermissions(); } else initializeAppPostPermissions();
    }, 2000);
}
document.addEventListener('deviceready', startAppStartupSequence, false); 
if (!window.cordova) { window.addEventListener('DOMContentLoaded', startAppStartupSequence); }
