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
    gssNodes: {}, feeders: {},
    dirtyItems: { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] }, 
    deletedItems: [], 
    orphanPoleIds: new Set(), activeMove: null, placementType: null, unsyncedCount: 0
};

let historyStack = []; let map = null;
window.haptic = function(pattern) { if (window.cordova && navigator.vibrate) navigator.vibrate(pattern); };

function updateSyncUI() {
    const badge = document.getElementById('sync-badge');
    if(appState.unsyncedCount > 0) { badge.innerText = appState.unsyncedCount; badge.style.display = 'block'; } 
    else { badge.style.display = 'none'; }
}

const i18n = {
    en: { 
        line11: "11 KV Line", lineLT: "LT Line", dt3ph: "3-Ph DT", dt1ph: "1-Ph DT", totalCons: "Consumers",
        gssMgmt: "GSS Management", addNewGss: "Add New GSS", manageFdr: "Manage Feeders", 
        export: "Export Data (Downloads)", exportPdf: "Export SLD PDF", exportDxf: "Export DXF", exportKml: "Export KML", exportCsv: "Export CSV", 
        importLabel: "Backup & Restore", exportJson: "Export Backup (JSON)", importJson: "Import Backup (JSON)", system: "System", settings: "Settings", about: "About App",
        appLanguage: "App Language", distUnit: "Distance Unit", gpsInterval: "GPS Polling Interval", gpsAcc: "GPS Accuracy", resetData: "Reset App Data",
        confirmLoc: "Confirm Map Center Location", confirmHere: "Confirm Here", cancel: "Cancel", setNewLoc: "Set New Location", target: "Target",
        toastSettings: "Settings Saved!", toastDel: "Deleted Successfully!", toastImport: "Imported Successfully!",
        addFeeder: "Add Feeder", saveFeeder: "Save Feeder", searchObj: "Search K-No, Name, DT Code...",
        htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", logout: "Logout Securely"
    }
};

function t(key) { return (i18n['en'][key] || key); }
function translateApp() { document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if (el.tagName.toLowerCase() === 'input' && el.type === 'text') el.placeholder = t(key); else el.innerHTML = t(key); }); }

function getActiveNetwork() {
    if (!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = Object.keys(appState.feeders)[0] || "1";
    let net = appState.feeders[appState.currentFeederCode];
    if (!net) { 
        net = { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] }; 
        appState.feeders["1"] = net; 
        appState.gssNodes["1"] = { code: "1", name: "132/33 kV Substation", lat: 26.9150, lng: 75.7830 };
        appState.currentFeederCode = "1";
    }
    if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

function showToast(msg) {
    const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg');
    if (!toast || !msgElem) return; msgElem.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
}

function setSyncStatus(status) {
    const ind = document.getElementById('sync-indicator');
    if (!ind) return;
    if(!navigator.onLine) status = 'offline';
    
    let iconHtml = '';
    if(status === 'syncing') iconHtml = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>';
    else if(status === 'synced') iconHtml = '<i class="fa-solid fa-cloud-check sync-success"></i>';
    else iconHtml = '<i class="fa-solid fa-cloud-xmark sync-error"></i>';
    
    ind.innerHTML = iconHtml + `<span class="sync-badge" id="sync-badge" style="display:${appState.unsyncedCount > 0 ? 'block' : 'none'};">${appState.unsyncedCount}</span>`;
    if (status === 'synced') { appState.unsyncedCount = 0; updateSyncUI(); }
}

// ==== UNIVERSAL TRACKERS ====
window.markDirty = function(type, id) {
    if (!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
    if (!appState.dirtyItems[type]) appState.dirtyItems[type] = [];
    if (!appState.dirtyItems[type].includes(id)) { appState.dirtyItems[type].push(id); }
};

window.markDeleted = function(id) {
    if (!appState.deletedItems) appState.deletedItems = [];
    if (!appState.deletedItems.includes(id)) appState.deletedItems.push(id);
};

// FIX: Added missing function that was crashing renderEntireNetwork()
window.updateOrphanStatus = function() {
    if (!appState.orphanPoleIds) appState.orphanPoleIds = new Set();
    appState.orphanPoleIds.clear();
};

let realtimeChannel = null;
window.setupRealtimeSync = function() {
    if (!supabaseClient || !appState.user.isLoggedIn) return;
    if (realtimeChannel) return;
    realtimeChannel = supabaseClient.channel('discom-live-sync', { config: { broadcast: { ack: false } } });
    realtimeChannel.on('broadcast', { event: 'db-updated' }, (payload) => {
        if(window.isSyncingLocal || appState.unsyncedCount > 0) return; 
        clearTimeout(window.rtDebounce);
        window.rtDebounce = setTimeout(() => { showToast("Live Update Received! 🔄"); pullFromSupabase(true); }, 800);
    }).subscribe();
};

function cleanData(arr) {
    return arr.map(obj => {
        let cleaned = {};
        for(let key in obj) { if(obj[key] !== undefined) cleaned[key] = obj[key]; }
        return cleaned;
    });
}

// ==== 🚀 HIERARCHICAL CLOUD SYNC (Delta Push) ====
window.syncToSupabase = async function(manual = false) {
    if (manual) window.haptic(15);
    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; 
    
    if(!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
    if(!appState.deletedItems) appState.deletedItems = [];
    
    const isDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
    const isDeleted = appState.deletedItems.length > 0;
    
    if(!isDirty && !isDeleted) { setSyncStatus('synced'); return; }

    window.isSyncingLocal = true; setSyncStatus('syncing');

    try {
        const uid = appState.user.id;
        let gssPayload = [], fdrPayload = [], objPayload = [], photoPayload = [];
        let dirty = appState.dirtyItems;

        Object.values(appState.gssNodes).forEach(g => {
            if(g && g.code && dirty['GSS'].includes(g.code)) {
                gssPayload.push({ gss_code: g.code, gss_name: g.name, lat: g.lat, lng: g.lng, user_id: uid });
            }
        });

        Object.keys(appState.feeders).forEach(fCode => {
            const net = appState.feeders[fCode];
            if(net && net.feeder && net.feeder.code && dirty['FEEDER'].includes(fCode)) {
                fdrPayload.push({ feeder_code: fCode, gss_code: net.feeder.parentGss, feeder_name: net.feeder.name, user_id: uid });
            }
            
            const processNode = (p, type) => {
                if(dirty[type].includes(p.id)) {
                    let copy = { ...p };
                    if(copy.photo && copy.photo.startsWith('data:image')) { 
                        photoPayload.push({ parent_id: p.id, image_data: copy.photo, user_id: uid }); 
                        copy.hasPhoto = true; 
                    } else { copy.hasPhoto = !!copy.hasPhoto; }
                    delete copy.photo; 
                    objPayload.push({ id: p.id, feeder_code: fCode, type: type, data: copy, user_id: uid }); 
                }
            };

            net.poles.forEach(p => processNode(p, 'POLE'));
            net.dts.forEach(d => processNode(d, 'DT'));
            net.lines.forEach(l => processNode(l, 'LINE'));
            net.consumers.forEach(c => processNode(c, 'CONSUMER'));
        });

        // FIX: Proper Error throwing to catch silent fails
        if (gssPayload.length > 0) { const { error } = await supabaseClient.from('gss_records').upsert(cleanData(gssPayload)); if(error) throw error; }
        if (fdrPayload.length > 0) { const { error } = await supabaseClient.from('feeder_records').upsert(cleanData(fdrPayload)); if(error) throw error; }
        if (objPayload.length > 0) { const { error } = await supabaseClient.from('network_objects').upsert(JSON.parse(JSON.stringify(cleanData(objPayload)))); if(error) throw error; }
        if (photoPayload.length > 0) { const { error } = await supabaseClient.from('object_photos').upsert(photoPayload); if(error) throw error; }

        // FIX: Handled prefixed ID deletion ('GSS_1', 'FDR_1') properly
        if (appState.deletedItems.length > 0) {
            let delGss = [], delFdr = [], delObj = [];
            appState.deletedItems.forEach(id => {
                if(id.startsWith('GSS_')) delGss.push(id.replace('GSS_', ''));
                else if(id.startsWith('FDR_')) delFdr.push(id.replace('FDR_', ''));
                else delObj.push(id);
            });

            if (delGss.length > 0) { const { error } = await supabaseClient.from('gss_records').delete().eq('user_id', uid).in('gss_code', delGss); if(error) throw error; }
            if (delFdr.length > 0) { const { error } = await supabaseClient.from('feeder_records').delete().eq('user_id', uid).in('feeder_code', delFdr); if(error) throw error; }
            if (delObj.length > 0) {
                const { error: e1 } = await supabaseClient.from('network_objects').delete().eq('user_id', uid).in('id', delObj); if(e1) throw e1;
                const { error: e2 } = await supabaseClient.from('object_photos').delete().eq('user_id', uid).in('parent_id', delObj); if(e2) throw e2;
            }
            appState.deletedItems = []; 
        }

        appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
        if (realtimeChannel) realtimeChannel.send({ type: 'broadcast', event: 'db-updated', payload: { timestamp: Date.now() } });
        setSyncStatus('synced');
    } catch (err) { console.error("Sync Error:", err); setSyncStatus('offline'); } 
    finally { setTimeout(() => { window.isSyncingLocal = false; }, 1500); }
}

// ==== 🚀 HIERARCHICAL CLOUD PULL ====
async function pullFromSupabase(isBackground = false) {
    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; 
    if(!isBackground) setSyncStatus('syncing');
    
    try {
        const uid = appState.user.id;
        
        const [gssRes, fdrRes, objRes] = await Promise.all([
            supabaseClient.from('gss_records').select('*').eq('user_id', uid),
            supabaseClient.from('feeder_records').select('*').eq('user_id', uid),
            supabaseClient.from('network_objects').select('*').eq('user_id', uid)
        ]);
        
        // FIX: Proper error handling for pulls
        if(gssRes.error) throw gssRes.error;
        if(fdrRes.error) throw fdrRes.error;
        if(objRes.error) throw objRes.error;

        let newGss = {}, newFeeders = {};

        if (gssRes.data && gssRes.data.length > 0) {
            gssRes.data.forEach(g => {
                newGss[g.gss_code] = { code: g.gss_code, name: g.gss_name, lat: g.lat, lng: g.lng };
            });
        }

        if (fdrRes.data && fdrRes.data.length > 0) {
            fdrRes.data.forEach(f => {
                newFeeders[f.feeder_code] = { feeder: { code: f.feeder_code, name: f.feeder_name, parentGss: f.gss_code, subdivCode: "SD-01" }, poles: [], dts: [], lines: [], consumers: [] };
            });
        }

        if (objRes.data && objRes.data.length > 0) {
            objRes.data.forEach(obj => {
                const fc = obj.feeder_code;
                if(!newFeeders[fc]) {
                    newFeeders[fc] = { feeder: { code: fc, name: "Feeder "+fc, parentGss: "1", subdivCode: "SD-01" }, poles: [], dts: [], lines: [], consumers: [] };
                }
                
                // FIX: Fallback parsing logic for strings inside JSONB to avoid rendering format breaks
                let d = obj.data;
                if (typeof d === 'string') {
                    try { d = JSON.parse(d); } catch(e) { console.error("JSON parse failed for", d); }
                }
                
                try {
                    let oldNet = appState.feeders[fc];
                    if(oldNet) {
                        let oldArr = obj.type === 'POLE' ? oldNet.poles : obj.type === 'DT' ? oldNet.dts : obj.type === 'CONSUMER' ? oldNet.consumers : null;
                        if(oldArr) { let localObj = oldArr.find(x => x.id === d.id); if(localObj && localObj.photo) d.photo = localObj.photo; }
                    }
                } catch(e){}

                if (obj.type === 'POLE') newFeeders[fc].poles.push(d);
                if (obj.type === 'DT') newFeeders[fc].dts.push(d);
                if (obj.type === 'LINE') newFeeders[fc].lines.push(d);
                if (obj.type === 'CONSUMER') newFeeders[fc].consumers.push(d);
            });
        }

        if(Object.keys(newGss).length === 0) newGss["1"] = { code: "1", name: "132/33 kV Substation", lat: 26.9150, lng: 75.7830 };
        if(Object.keys(newFeeders).length === 0) newFeeders["1"] = { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] };

        appState.gssNodes = newGss; appState.feeders = newFeeders;
        if(!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = Object.keys(newFeeders)[0] || "1";
        appState.unsyncedCount = 0;
        
        getActiveNetwork(); 
        if (typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState);
        renderEntireNetwork(); 
        if(map && !isBackground) { setTimeout(() => { map.invalidateSize(); }, 300); }
        if(!isBackground) centerMapOnGSS(); 
        setSyncStatus('synced'); 
    } catch (err) { console.error("Pull error:", err); setSyncStatus('offline'); }
}

function triggerPersistence(incrementSync = true) { 
    if(incrementSync) { appState.unsyncedCount = (appState.unsyncedCount || 0) + 1; updateSyncUI(); }
    if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState).catch(() => localStorage.setItem(DB_KEY, JSON.stringify(appState))); 
    else localStorage.setItem(DB_KEY, JSON.stringify(appState)); syncToSupabase(); 
}

let authMode = 'login';
window.toggleAuthMode = function() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    document.getElementById('loginBtn').style.display = authMode === 'login' ? 'inline-block' : 'none';
    document.getElementById('signupBtn').style.display = authMode === 'signup' ? 'inline-block' : 'none';
    document.getElementById('signupNameField').style.display = authMode === 'signup' ? 'block' : 'none';
    document.getElementById('authToggleText').innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login";
}

function applyAuthUIVisuals() {
    document.getElementById('auth-screen').style.display = 'none'; 
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('userNameDisplay').innerText = appState.user.name; 
    document.getElementById('userEmailDisplay').innerText = appState.user.email;
    const adminCard = document.getElementById('adminPasswordCard'); 
    if (adminCard) adminCard.style.display = (appState.user.email === ADMIN_EMAIL) ? 'block' : 'none';
    window.setupRealtimeSync();
    if(map) setTimeout(() => { map.invalidateSize(); }, 300);
}

window.handleSupabaseAuth = async function(mode) {
    if(!supabaseClient) return alert("Network Error: Supabase connection failed.");
    const email = document.getElementById('authEmail').value.trim(), password = document.getElementById('authPassword').value.trim(), name = document.getElementById('authName').value.trim();
    if(!email || !password) return alert("Email and Password required"); showToast("Processing..."); let response;
    if (mode === 'signup') { if(!name) return alert("Enter Full Name"); response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } }); } else response = await supabaseClient.auth.signInWithPassword({ email, password });
    if (response.error) alert(response.error.message);
    else if (response.data.user) {
        appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
        appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
        applyAuthUIVisuals(); pullFromSupabase(); showToast("Login Successful!");
    }
}
window.changeAdminPassword = async function() {
    if(!supabaseClient) return; const newPass = document.getElementById('newAdminPassword').value.trim();
    if (!newPass || newPass.length < 6) return alert("Password must be at least 6 characters.");
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) alert("Error updating password: " + error.message); else { alert("Admin password updated successfully!"); document.getElementById('newAdminPassword').value = ''; }
}
window.handleSupabaseLogout = async function() { if(supabaseClient) await supabaseClient.auth.signOut(); if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.removeItem(DB_KEY); location.reload(); }

let featureGroups = {}; let tileLayers = {}; let layerKeys = []; let currentTileIndex = 0;
window.followLiveLocation = false;

window.capturePhoto = function(targetId) {
    if (window.cordova && navigator.camera) {
        navigator.camera.getPicture(
            function(imageData) {
                const b64 = "data:image/jpeg;base64," + imageData; document.getElementById(targetId).value = b64;
                const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = b64; prev.style.display = 'block'; }
            }, 
            function(err) { showToast("Camera canceled."); }, 
            { quality: 40, destinationType: navigator.camera.DestinationType.DATA_URL, targetWidth: 600, targetHeight: 600, correctOrientation: true }
        );
    } else {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0]; const reader = new FileReader();
            reader.onload = ev => { const res = ev.target.result; document.getElementById(targetId).value = res; const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = res; prev.style.display = 'block'; } };
            if(file) reader.readAsDataURL(file);
        };
        input.click();
    }
}

function initMapSystem() {
    if(map) return; 
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([26.9150, 75.7830], 16);
    map.on('click', () => window.closeObjectSheet()); map.on('dragstart', () => { window.followLiveLocation = false; });

    function updateMapZoomClasses() {
        if(!map) return; const z = map.getZoom(); const mapEl = document.getElementById('map');
        mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-dt', 'hide-gss-square');
        map.removeLayer(featureGroups.consumers); map.removeLayer(featureGroups.consumerLines); map.removeLayer(featureGroups.ltPoles); map.removeLayer(featureGroups.ltLines); map.removeLayer(featureGroups.htPoles); map.removeLayer(featureGroups.dts); map.removeLayer(featureGroups.gss);
        
        if (z > 18) { map.addLayer(featureGroups.consumerLines); map.addLayer(featureGroups.consumers); }
        if (z > 17) { map.addLayer(featureGroups.ltPoles); } if (z > 16) { map.addLayer(featureGroups.ltLines); }
        if (z > 15) { map.addLayer(featureGroups.htPoles); } if (z > 14) { map.addLayer(featureGroups.dts); }
        if (z > 11) { map.addLayer(featureGroups.gss); } 
        if (z <= 13) mapEl.classList.add('hide-gss-square'); else mapEl.classList.remove('hide-gss-square');
    }
    map.on('zoomend', updateMapZoomClasses); 

    tileLayers = { 
        hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
        street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) },
        osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) }
    };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    window.toggleMapLayer = function() { window.haptic(15); map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name; }

    featureGroups = { gss: L.featureGroup().addTo(map), htLines: L.featureGroup().addTo(map), ltLines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map), htPoles: L.featureGroup().addTo(map), ltPoles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) };
    
    map.on('move', () => { 
        const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        if (document.getElementById('center-placement-pin').style.display === 'block' && appState.feeders[appState.currentFeederCode]) {
            const net = getActiveNetwork(); let nodes = [...net.poles, ...net.dts];
            if(appState.gssNodes[net.feeder.parentGss]) nodes.push(appState.gssNodes[net.feeder.parentGss]);
            if(nodes.length > 0) {
                let nearest = nodes[0]; let minDist = window.calcDistance(c.lat, c.lng, nearest.lat, nearest.lng);
                for(let n of nodes) { let d = window.calcDistance(c.lat, c.lng, n.lat, n.lng); if(d < minDist) { minDist = d; nearest = n; } }
                const distEl = document.getElementById('live-distance-meter'); distEl.innerText = `Nearest Node: ${window.formatDistance(minDist)}`; distEl.style.display = 'block';
            }
        } else { document.getElementById('live-distance-meter').style.display = 'none'; }
    });
    setTimeout(updateMapZoomClasses, 100);
}

function centerMapOnGSS() {
    if(!map) return; const net = getActiveNetwork(); const gss = appState.gssNodes[net.feeder.parentGss]; setTimeout(() => { map.invalidateSize(); }, 200);
    if (gss && typeof gss.lat === 'number') map.setView([gss.lat, gss.lng], 16);
}

window.liveTrackingId = null; window.liveUserMarker = null;
window.toggleLiveTracking = function() {
    window.haptic(15); if (!map) return; if (!navigator.geolocation) return alert("Geolocation API not found.");
    if (window.liveTrackingId) {
        if (!window.followLiveLocation) { window.followLiveLocation = true; if (window.liveUserMarker) map.setView(window.liveUserMarker.getLatLng(), 19); showToast("Map re-centered to location"); } 
        else { navigator.geolocation.clearWatch(window.liveTrackingId); window.liveTrackingId = null; if (window.liveUserMarker) { map.removeLayer(window.liveUserMarker); window.liveUserMarker = null; } document.getElementById('liveTrackBtn').style.color = '#ef4444'; window.followLiveLocation = false; showToast("Live tracking disabled."); }
    } else {
        showToast("Fetching location..."); window.followLiveLocation = true;
        window.liveTrackingId = navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (!window.liveUserMarker) { const humanIcon = L.divIcon({ className: 'live-human-icon', html: '', iconSize: [24,24], iconAnchor: [12,12] }); window.liveUserMarker = L.marker([lat, lng], {icon: humanIcon, zIndexOffset: 5000}).addTo(map); } 
            else window.liveUserMarker.setLatLng([lat, lng]);
            if (window.followLiveLocation) map.setView([lat, lng], 19);
            document.getElementById('liveTrackBtn').style.color = '#10b981';
        }, (err) => alert("GPS Error."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }
}

window.openObjectSheet = function(type, id) {
    window.haptic(15); const net = getActiveNetwork(); let obj = null, title = '', subtitle = '', details = '', actions = '';
    
    if (type === 'POLE' || type === 'LTPOLE') {
        obj = net.poles.find(x => x.id === id); if(!obj) return; let displayNo = obj.poleNo; if (obj.lineType === 'LT' && String(obj.poleNo).includes('-')) displayNo = String(obj.poleNo).split('-')[1];
        title = `Pole: ${displayNo}`; subtitle = `${obj.lineType || 'HT'} Line Pole`;
        details = `<div class="info-grid"><div class="info-item"><span>Parent Node</span><b>${obj.dtCode || 'Feeder'}</b></div><div class="info-item"><span>Structure</span><b>${obj.structure || 'Single'}</b></div><div class="info-item"><span>Condition</span><b style="color:${(obj.condition==='Tilted'||obj.condition==='Damaged')?'#ef4444':'var(--text-main)'}">${obj.condition || 'OK'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('${obj.lineType === 'LT' ? 'LTPOLE' : 'POLE'}','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('POLE','${obj.id}','${obj.poleNo}')"><i class="fa-solid fa-up-down-left-right"></i> Move</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('pole','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    } 
    else if (type === 'DT') {
        obj = net.dts.find(x => x.id === id); if(!obj) return; let dtNameStr = obj.name ? obj.name : `DT Code: ${obj.code}`;
        title = `${dtNameStr}`; subtitle = `Code: ${obj.code} | ${obj.rating} kVA | ${obj.phase || 'Three Phase'}`;
        let dtCons = net.consumers.filter(c => (c.parentType === 'DT' && String(c.parentRef) === String(obj.code)) || (c.parentType === 'POLE' && net.poles.find(p => String(p.poleNo) === String(c.parentRef) && String(p.dtCode) === String(obj.code))));
        let totCons = dtCons.length; let totLoad = dtCons.reduce((sum, c) => sum + (parseFloat(c.load) || 0), 0);
        details = `<div class="info-grid"><div class="info-item"><span>Mounted On</span><b>${obj.mountedOn || 'Single Pole'}</b></div><div class="info-item"><span>Total Consumers</span><b>${totCons}</b></div><div class="info-item"><span>Total Load</span><b>${totLoad.toFixed(2)} kW</b></div><div class="info-item"><span>Sr No.</span><b>${obj.srNo || 'N/A'}</b></div><div class="info-item"><span>TN No.</span><b>${obj.tn || 'N/A'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('dt','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('dt','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    }
    else if (type === 'CONSUMER') {
        obj = net.consumers.find(x => x.id === id); if(!obj) return;
        title = `${obj.name}`; subtitle = `${obj.conType || 'DS'} | ${obj.status || 'Regular'}`;
        details = `<div class="info-grid"><div class="info-item"><span>K-Number</span><b>${obj.kno}</b></div><div class="info-item"><span>A/C No.</span><b>${obj.acNo || 'N/A'}</b></div><div class="info-item"><span>Meter No.</span><b>${obj.meterNo || 'N/A'}</b></div><div class="info-item"><span>Load</span><b>${obj.load || '1 kW'}</b></div><div class="info-item"><span>Connected To</span><b>${obj.parentRef}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('consumer','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('CONSUMER','${obj.id}','${obj.name}')"><i class="fa-solid fa-up-down-left-right"></i> Move</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('consumer','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    }
    else if (type === 'LINE') {
        obj = net.lines.find(x => x.id === id); if(!obj) return; let spec = getLineSpec(obj.type);
        title = `${spec.name}`; subtitle = `${obj.phaseType || 'Single Phase'} Route`;
        details = `<div class="info-grid"><div class="info-item"><span>From ➔ To</span><b>${obj.fromNode} ➔ ${obj.toNode}</b></div><div class="info-item"><span>Distance</span><b>${window.formatDistance(obj.distanceMeters||0)}</b></div><div class="info-item"><span>Crossing</span><b style="color:${obj.hasCrossing?'#ef4444':'inherit'}">${obj.hasCrossing? (obj.crossingRemark||'Yes') : 'None'}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('line','${obj.id}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn delete" onclick="window.closeObjectSheet(); window.deleteEntity('line','${obj.id}')"><i class="fa-solid fa-trash"></i> Delete</button>`;
    }
    else if (type === 'GSS') {
        obj = appState.gssNodes[id]; if(!obj) return;
        title = `${obj.name}`; subtitle = `Source Substation`; details = `<div class="info-grid"><div class="info-item"><span>Code</span><b>${obj.code}</b></div></div>`;
        actions = `<button class="sheet-btn edit" onclick="window.closeObjectSheet(); window.openEditModal('gss','${obj.code}')"><i class="fa-solid fa-pen"></i> Edit</button><button class="sheet-btn move" onclick="window.closeObjectSheet(); window.startObjectMove('GSS','${obj.code}','${obj.code}')"><i class="fa-solid fa-up-down-left-right"></i> Relocate</button>`;
    }
    
    let idStr = obj ? (obj.id || obj.code) : 'unknown';
    let photoHtml = '';
    
    if(obj && obj.hasPhoto) {
        if(obj.photo && obj.photo.startsWith('data:image')) {
            photoHtml = `<img src="${obj.photo}" class="sheet-photo">`;
        } else {
            photoHtml = `<img src="" id="async-photo-${idStr}" class="sheet-photo" style="display:none; background:#1e293b; object-fit:contain;">
                         <div id="photo-loader-${idStr}" style="text-align:center; padding:30px 10px; color:var(--text-sub); font-size:0.85rem; background:var(--bg-base); border-radius:12px; margin-bottom:16px;">
                            <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent); margin-bottom:8px;"></i><br>Loading Photo...
                         </div>`;
                         
            supabaseClient.from('object_photos').select('image_data').eq('parent_id', idStr).single().then(({data}) => {
                if(data && data.image_data) {
                    obj.photo = data.image_data;
                    const imgEl = document.getElementById(`async-photo-${idStr}`);
                    const loaderEl = document.getElementById(`photo-loader-${idStr}`);
                    if(imgEl) { imgEl.src = obj.photo; imgEl.style.display = 'block'; }
                    if(loaderEl) loaderEl.style.display = 'none';
                    if (typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState);
                } else {
                    const loaderEl = document.getElementById(`photo-loader-${idStr}`);
                    if(loaderEl) loaderEl.innerHTML = '<i class="fa-solid fa-image-slash" style="font-size:1.5rem; margin-bottom:8px;"></i><br>Photo not found';
                }
            });
        }
    } else if (obj && obj.photo) {
        photoHtml = `<img src="${obj.photo}" class="sheet-photo">`;
    }

    document.getElementById('obj-sheet-content').innerHTML = `${photoHtml}<h3 class="sheet-obj-title">${title}</h3><p class="sheet-obj-subtitle">${subtitle}</p>${details}<div class="sheet-actions-row">${actions}</div>`;
    document.getElementById('bottom-info-sheet').classList.add('open');
};
window.closeObjectSheet = function() { window.haptic(15); document.getElementById('bottom-info-sheet').classList.remove('open'); };

function renderEntireNetwork() {
    if(!map) return;
    try {
        updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers()); const net = getActiveNetwork(), f = appState.filters;

        Object.values(appState.gssNodes).forEach(gss => {
            if (gss && gss.lat != null && gss.lng != null) {
                if (!(appState.activeMove && appState.activeMove.id === gss.code)) {
                    const lat = parseFloat(gss.lat); const lng = parseFloat(gss.lng);
                    const dynZGss = Math.floor(-lat * 10000);
                    const htmlIcon = `<svg width="44" height="48" viewBox="0 0 44 48" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="22" cy="44" rx="16" ry="4" fill="rgba(0,0,0,0.4)"/><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><rect x="6" y="10" width="32" height="16" rx="6" fill="#ef4444" opacity="0.4"/><text x="22" y="30" font-size="12" font-weight="900" font-family="Inter" fill="#fff" text-anchor="middle">GSS</text></svg>`;
                    const gssIcon = L.divIcon({ className: 'svg-marker-wrapper', html: htmlIcon, iconSize: [44,48], iconAnchor: [22,16] }); 
                    const m = L.marker([lat, lng], { icon: gssIcon, zIndexOffset: 950000 + dynZGss }).addTo(featureGroups.gss);
                    m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('GSS', gss.code); });
                }
            }
        });

        if (f.poles) {
            net.poles.forEach(p => {
                const isOrphan = appState.orphanPoleIds.has(p.id), isLT = p.lineType === 'LT';
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];

                const color = isLT ? '#10b981' : '#fde047'; const isAlert = (p.condition === 'Tilted' || p.condition === 'Damaged'); const strokeColor = isAlert ? '#ef4444' : '#0f172a';
                const dynZ = Math.floor(-p.lat * 10000); const zOff = (isLT ? 100000 : 200000) + dynZ;
                let svg = ''; let w = 34, h = 48, ax = 17, ay = 12; 
                const alertBadge = isAlert ? `<circle cx="${w-5}" cy="14" r="5" fill="#ef4444" stroke="#fff" stroke-width="1.5"/><text x="${w-5}" y="17.5" font-size="9" fill="#fff" font-weight="900" font-family="sans-serif" text-anchor="middle">!</text>` : '';
                const gradientDef = `<defs><linearGradient id="grad${p.id}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="100%" stop-color="${color}"/></linearGradient></defs>`;
                const groundShadow = `<ellipse cx="${ax}" cy="${h-3}" rx="${(w/2)-2}" ry="3" fill="rgba(0,0,0,0.4)"/>`;

                if (p.structure === 'Double') {
                    w = 40; ax = 20; ay = 12;
                    svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${gradientDef}<ellipse cx="${ax}" cy="${h-3}" rx="14" ry="3.5" fill="rgba(0,0,0,0.4)"/><rect x="10" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="24" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="6" y="24" width="28" height="4" fill="#cbd5e1" stroke="${strokeColor}" stroke-width="1" rx="1"/><rect x="5" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="20" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`;
                } else if (p.structure === 'Lattice Tower') {
                    w = 40; h = 48; ax = 20; ay = 12;
                    svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${ax}" cy="${h-3}" rx="15" ry="4" fill="rgba(0,0,0,0.4)"/><path d="M 16 16 L 8 48 M 24 16 L 32 48" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/><path d="M 16 16 L 8 48 M 24 16 L 32 48" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><path d="M 14 26 L 26 26 M 11 36 L 29 36" stroke="${strokeColor}" stroke-width="1.5"/><path d="M 16 16 L 26 26 M 24 16 L 14 26 M 14 26 L 29 36 M 26 26 L 11 36 M 11 36 L 32 48 M 29 36 L 8 48" stroke="${strokeColor}" stroke-width="1" opacity="0.6"/><rect x="5" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="20" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`;
                } else if (p.structure === 'Rail Pole') {
                    w = 34; h = 48; ax = 17; ay = 12;
                    svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${ax}" cy="${h-3}" rx="12" ry="3.5" fill="rgba(0,0,0,0.4)"/><path d="M 14 16 L 14 48 M 20 16 L 20 48" stroke="${strokeColor}" stroke-width="2.5"/><path d="M 14 16 L 14 48 M 20 16 L 20 48" stroke="${color}" stroke-width="1"/><path d="M 11 20 L 23 20 M 11 28 L 23 28 M 11 36 L 23 36 M 11 44 L 23 44" stroke="${strokeColor}" stroke-width="1.5"/><rect x="2" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="17" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`;
                } else {
                    w = 34; h = 48; ax = 17; ay = 12;
                    svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${gradientDef}${groundShadow}<rect x="14" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="6" y="22" width="22" height="3" fill="#cbd5e1" stroke="${strokeColor}" stroke-width="1" rx="1"/><circle cx="8" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><circle cx="17" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><circle cx="26" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><rect x="2" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="17" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`;
                }

                const targetGrp = isLT ? featureGroups.ltPoles : featureGroups.htPoles;
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper' + (isOrphan ? ' orphan-pulse' : ''), html: svg, iconSize: [w, h], iconAnchor: [ax, ay] }), zIndexOffset: zOff }).addTo(targetGrp);
                m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('POLE', p.id); });
            });
        }

        if (f.dts) {
            let dtGroups = {};
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => String(x.poleNo) === String(d.parentPole)); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng) { let key = `${d.lat}_${d.lng}`; if (!dtGroups[key]) dtGroups[key] = []; dtGroups[key].push(d.id); }
            });

            net.dts.forEach(d => {
                if (d.lat && d.lng) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); const numRating = String(d.rating).replace(/[^0-9]/g, '');
                    const dynZ = Math.floor(-d.lat * 10000); let key = `${d.lat}_${d.lng}`; let dtIndex = dtGroups[key].indexOf(d.id);
                    let dx = 0, dy = 0;
                    if (dtIndex === 1) { dx = -22; dy = 14; } else if (dtIndex === 2) { dx = 22; dy = 14; } else if (dtIndex >= 3) { dx = 0; dy = 28 + ((dtIndex-3)*14); }
                    
                    let svg = ''; let iconAnc = [0, 0]; let iconSz = [0, 0];
                    if(d.phase === 'Single Phase') {
                        svg = `<svg width="22" height="30" viewBox="0 0 22 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="14" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="11" y1="8" x2="11" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="11" cy="3" r="2" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><text x="11" y="22" font-size="9" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        iconAnc = [11 + dx, -6 + dy]; iconSz = [22, 30];
                    } else {
                        svg = `<svg width="34" height="30" viewBox="0 0 34 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="8" width="30" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="7" y1="8" x2="7" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="7" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1.5"/><line x1="17" y1="8" x2="17" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="17" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1.5"/><line x1="27" y1="8" x2="27" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="27" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1.5"/><text x="17" y="22" font-size="10" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        iconAnc = [17 + dx, -6 + dy]; iconSz = [34, 30];
                    }
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper' + (isOrphan ? ' orphan-pulse' : ''), html: svg, iconSize: iconSz, iconAnchor: iconAnc }), zIndexOffset: 900000 + dynZ + (dtIndex * 10) }).addTo(featureGroups.dts);
                    m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('DT', d.id); });
                }
            });
        }

        net.lines.forEach(line => {
            const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
            if (c1 && c2) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = getLineSpec(line.type); if (!f[spec.filterKey]) return;
            const lineGrp = spec.name.includes('LT') ? featureGroups.ltLines : featureGroups.htLines;
            let linesToDraw = [];
            
            if(line.phaseType === 'Three Phase' && !line.type.includes('UG CABLE') && !line.type.includes('LT')) {
                linesToDraw.push({ coords: calculateParallelCoords({lat:c1.lat, lng:c1.lng}, {lat:c2.lat, lng:c2.lng}, -1.5), color: '#ef4444' }); 
                linesToDraw.push({ coords: line.coords, color: '#eab308' }); 
                linesToDraw.push({ coords: calculateParallelCoords({lat:c1.lat, lng:c1.lng}, {lat:c2.lat, lng:c2.lng}, 1.5), color: '#3b82f6' }); 
            } else { linesToDraw.push({ coords: line.coords, color: spec.color }); }

            linesToDraw.forEach(ld => {
                const hitPoly = L.polyline(ld.coords, { color: 'transparent', weight: 20 }).addTo(lineGrp);
                L.polyline(ld.coords, { color: ld.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', interactive: false, className: spec.lineClass }).addTo(lineGrp);
                hitPoly.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('LINE', line.id); });
            });

            if(line.hasCrossing) {
                const midLat = (c1.lat + c2.lat) / 2, midLng = (c1.lng + c2.lng) / 2;
                const crossSvg = `<svg width="16" height="16" viewBox="0 0 16 16" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="2" x2="14" y2="14" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/><line x1="14" y1="2" x2="2" y2="14" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/></svg>`;
                L.marker([midLat, midLng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: crossSvg, iconSize: [16,16], iconAnchor: [8,8] }), zIndexOffset: 2500 }).addTo(lineGrp);
            }
        });

        if (f.consumers) {
            net.consumers.forEach(c => {
                if (appState.activeMove && appState.activeMove.id === c.id) return; 
                const dynZ = Math.floor(-c.lat * 10000); let bgColor = '#10b981'; 
                if(c.status === 'DC') bgColor = '#facc15'; else if(c.status === 'PDC') bgColor = '#ef4444'; else if(c.conType === 'NDS') bgColor = '#3b82f6';
                let faIcon = '&#xf015;'; if(c.conType === 'NDS') faIcon = '&#xf1ad;'; else if(c.conType === 'AG') faIcon = '&#xf4d8;'; else if(c.conType === 'SIP/MIP') faIcon = '&#xf275;'; else if(c.conType === 'PHED') faIcon = '&#xf043;'; 

                const svg = `<svg width="26" height="34" viewBox="0 0 26 34" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="13" cy="30" rx="9" ry="3.5" fill="rgba(0,0,0,0.4)"/><path d="M13 22 L13 30" stroke="#0f172a" stroke-width="2"/><circle cx="13" cy="11" r="10" fill="${bgColor}" stroke="white" stroke-width="1.5"/><text x="13" y="15" font-size="10" font-weight="900" font-family="'Font Awesome 6 Free', sans-serif" fill="white" text-anchor="middle" class="fa-svg-icon">${faIcon}</text></svg>`;
                const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [26,34], iconAnchor: [13,11] }), zIndexOffset: 300000 + dynZ }).addTo(featureGroups.consumers);
                m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('CONSUMER', c.id); });

                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = getNodeCoords(parentStr);
                if (pCoords) L.polyline([[c.lat, c.lng], [pCoords.lat, pCoords.lng]], { color: '#000000', weight: 1.2, dashArray: '4, 4', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
            });
        }

        map.fire('zoomend');
        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; 
        net.lines.forEach(l => { if (getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); });
        net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        
        if(document.getElementById('kpi11')) document.getElementById('kpi11').innerText = window.formatDistance(t11);
        if(document.getElementById('kpiLT')) document.getElementById('kpiLT').innerText = window.formatDistance(tLT);
        if(document.getElementById('kpi3Ph')) document.getElementById('kpi3Ph').innerText = dt3ph; 
        if(document.getElementById('kpi1Ph')) document.getElementById('kpi1Ph').innerText = dt1ph;
        if(document.getElementById('kpiCons')) document.getElementById('kpiCons').innerText = net.consumers.length;
        
        const fSelect = document.getElementById('feederSelectHeader');
        if (fSelect) fSelect.innerHTML = Object.keys(appState.feeders).map(code => `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${appState.feeders[code].feeder.name}</option>`).join('');

    } catch(err) { console.error("Rendering error:", err); }
}

function saveSnapshot() {
    const net = getActiveNetwork(); historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers })));
    if (historyStack.length > 15) historyStack.shift();
}
window.undoLastAction = function() {
    window.haptic(15); if (historyStack.length === 0) return showToast("No actions to Undo!"); 
    const prevState = historyStack.pop(), net = getActiveNetwork();
    net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers;
    renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺");
}

window.openFilterModal = function() {
    window.haptic(15); const f = appState.filters;
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-filter" style="color:#d97706;"></i> Object Filter</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div style="display:flex; flex-direction:column; gap:12px;"><div style="display:flex; justify-content:space-between; align-items:center;"><b>11 KV Line</b><label><input type="checkbox" id="flt11" ${f.lines11?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>LT Line</b><label><input type="checkbox" id="fltLT" ${f.linesLT?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>Poles</b><label><input type="checkbox" id="fltPoles" ${f.poles?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>DT</b><label><input type="checkbox" id="fltDTs" ${f.dts?'checked':''}></label></div><div style="display:flex; justify-content:space-between; align-items:center;"><b>Consumers</b><label><input type="checkbox" id="fltCons" ${f.consumers?'checked':''}></label></div></div><button class="btn-action-primary" onclick="window.saveFilters()">Apply</button>`);
}
window.saveFilters = function() {
    appState.filters.lines11 = document.getElementById('flt11').checked; appState.filters.linesLT = document.getElementById('fltLT').checked;
    appState.filters.poles = document.getElementById('fltPoles').checked; appState.filters.dts = document.getElementById('fltDTs').checked; appState.filters.consumers = document.getElementById('fltCons').checked;
    window.closeModal(); renderEntireNetwork(); showToast("Filters Updated");
}

window.autoSaveSettings = function() { 
    appState.settings.unit = document.getElementById('setUnit').value; appState.settings.gpsInterval = parseFloat(document.getElementById('setGpsInterval').value); appState.settings.gpsAccuracy = parseFloat(document.getElementById('setGpsAccuracy').value); appState.settings.language = document.getElementById('setLanguage').value; appState.settings.darkMode = document.getElementById('setTheme').value === 'dark';
    document.documentElement.setAttribute('data-theme', appState.settings.darkMode ? 'dark' : 'light');
    triggerPersistence(false); translateApp(); renderEntireNetwork(); showToast(t("toastSettings")); 
}

window.toggleSpeedDial = function(force) {
    window.haptic(15); const dial = document.getElementById('speed-dial-menu'), fab = document.getElementById('mainFabBtn'); if (!dial || !fab) return; 
    const isOpen = force !== undefined ? force : !dial.classList.contains('active'); dial.classList.toggle('active', isOpen); fab.classList.toggle('open', isOpen);
}
document.addEventListener('click', function(e) {
    const dial = document.getElementById('speed-dial-menu'); const fab = document.getElementById('mainFabBtn');
    if (dial && dial.classList.contains('active')) { if (!dial.contains(e.target) && !fab.contains(e.target)) { window.toggleSpeedDial(false); } }
});

window.toggleSidebar = function(open) { window.haptic(15); document.getElementById('sidebar-drawer').classList.toggle('open', open); document.getElementById('sidebarBackdrop').classList.toggle('open', open); if(open) window.renderGssSidebarList(); }
window.openModal = function(html) { document.getElementById('modalSheetContent').innerHTML = html; document.getElementById('formModalOverlay').classList.add('open'); translateApp(); }
window.closeModal = function() { document.getElementById('formModalOverlay').classList.remove('open'); }

window.openSettingsPage = function() { 
    window.toggleSidebar(false); 
    document.getElementById('setUnit').value = appState.settings.unit || 'm'; document.getElementById('setGpsInterval').value = appState.settings.gpsInterval || 3; document.getElementById('setGpsAccuracy').value = appState.settings.gpsAccuracy || 10; document.getElementById('setLanguage').value = appState.settings.language || 'en'; document.getElementById('setTheme').value = appState.settings.darkMode ? 'dark' : 'light';
    document.getElementById('settings-page').classList.add('open'); 
}
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }
window.switchFeeder = function(code) { if (appState.feeders[code]) { appState.currentFeederCode = code; renderEntireNetwork(); triggerPersistence(false); centerMapOnGSS(); } }

window.calcDistance = function(lat1, lon1, lat2, lon2) {
    const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }

function getLineSpec(type) {
    const t = (type || '').toUpperCase();
    if (t.includes('UG CABLE')) return { name: '11 KV UG CABLE', color: '#000000', weight: 3.5, dash: undefined, filterKey: 'lines11', lineClass: 'ug-cable-line' };
    if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 2.2, dash: undefined, filterKey: 'linesLT', lineClass: 'isometric-line' };
    return { name: '11 KV LINE', color: '#2563eb', weight: 3.5, dash: undefined, filterKey: 'lines11', lineClass: 'isometric-line' };
}

function getNodeCoords(nodeId) { 
    const net = getActiveNetwork(), idStr = String(nodeId);
    if (idStr.startsWith('GSS_')) { const code = idStr.replace('GSS_', ''); if (appState.gssNodes[code]) return { lat: appState.gssNodes[code].lat, lng: appState.gssNodes[code].lng }; }
    if (idStr.startsWith('DT_')) { const code = idStr.replace('DT_', ''), d = net.dts.find(x => String(x.code) === code); if (d) return { lat: d.lat, lng: d.lng }; }
    if (idStr.startsWith('POLE_')) { const code = idStr.replace('POLE_', ''), p = net.poles.find(x => String(x.poleNo) === code); if (p) return { lat: p.lat, lng: p.lng }; }
    const p = net.poles.find(x => String(x.poleNo) === idStr); if (p) return { lat: p.lat, lng: p.lng };
    const d = net.dts.find(x => String(x.code) === idStr); if (d) return { lat: d.lat, lng: d.lng };
    if (appState.gssNodes[idStr]) return { lat: appState.gssNodes[idStr].lat, lng: appState.gssNodes[idStr].lng };
    if (idStr === 'GSS' || idStr === net.feeder.code) { const g = appState.gssNodes[net.feeder.parentGss]; if(g) return { lat: g.lat, lng: g.lng }; }
    return null; 
}

window.runOrphanNodeChecker = function() {
    updateOrphanStatus(); const net = getActiveNetwork(), orphanCount = appState.orphanPoleIds.size;
    if (orphanCount === 0) return showToast("No orphan poles or nodes found! Network is fully connected.");
    let html = `<div class="sheet-head"><div class="sheet-title" style="color:#d97706;"><i class="fa-solid fa-network-wired"></i> Orphan Nodes Found (${orphanCount})</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>`;
    html += `<div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">`;
    net.poles.forEach(p => { if (appState.orphanPoleIds.has(p.id)) { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#fef3c7; padding:10px; border-radius:8px;"><div><b>Pole: ${p.poleNo}</b><br><small>Type: ${p.lineType || 'HT'}</small></div><button class="action-btn-sm bg" onclick="window.zoomToEntity('${p.lat}', '${p.lng}')">Zoom</button></div>`; } }); html += `</div>`; openModal(html);
};

window.zoomToEntity = function(lat, lng) { window.closeModal(); map.flyTo([parseFloat(lat), parseFloat(lng)], 19, { duration: 1 }); };

window.toggleGssFolder = function() {
    window.haptic(15); const content = document.getElementById('gssFolderContent'), icon = document.getElementById('gssFolderIcon');
    if (!content || !icon) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; 
    icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderGssSidebarList();
};

window.renderGssSidebarList = function() {
    const container = document.getElementById('gssListContainer'); if (!container) return; let html = '';
    Object.values(appState.gssNodes).forEach(gss => {
        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:8px; border-radius:6px; margin-top:6px; border:1px solid var(--border);"><div><b style="font-size:0.85rem;">${gss.name}</b><br><small style="color:var(--text-sub);">Code: ${gss.code}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="window.relocateGss('${gss.code}')" title="Relocate GSS"><i class="fa-solid fa-location-crosshairs"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="window.deleteGssAndFeederStrict('${gss.code}')" title="Strict Delete"><i class="fa-solid fa-trash"></i></button></div></div>`;
    }); container.innerHTML = html;
};

window.deleteGssAndFeederStrict = function(code) {
    window.haptic([50,50,50]);
    const conf1 = confirm(`WARNING: You are about to delete GSS ${code} and ALL its associated feeders and network data! This cannot be undone. Continue?`);
    if (!conf1) return; const conf2 = prompt(`To strictly confirm deletion, please type the GSS code "${code}" below:`);
    if (conf2 !== code) return alert("Deletion cancelled: GSS code did not match.");

    if (appState.gssNodes[code]) { window.markDeleted('GSS_' + code); delete appState.gssNodes[code]; }
    const feedersToDelete = []; Object.keys(appState.feeders).forEach(fCode => { if (appState.feeders[fCode].feeder.parentGss === code) feedersToDelete.push(fCode); });
    feedersToDelete.forEach(fCode => { window.markDeleted('FDR_' + fCode); delete appState.feeders[fCode]; });
    
    if (!appState.feeders[appState.currentFeederCode] || feedersToDelete.includes(appState.currentFeederCode)) {
        const remainingFeeders = Object.keys(appState.feeders);
        appState.currentFeederCode = remainingFeeders.length > 0 ? remainingFeeders[0] : null;
    }
    renderEntireNetwork(); triggerPersistence(); window.renderGssSidebarList(); showToast(t("toastDel"));
}

window.openAddGssModal = function() {
    window.toggleSidebar(false);
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> <span data-i18n="addNewGss">Add New GSS</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>GSS Code*</label><input type="text" id="inpGssCode" class="form-input" placeholder="e.g. 132"></div><div class="form-row"><label>GSS Name*</label><input type="text" id="inpGssName" class="form-input" placeholder="e.g. 132/33 kV Substation"></div><button class="btn-action-primary" onclick="window.saveNewGss()">Save GSS at Map Center</button>`);
};
window.saveNewGss = function() {
    window.haptic(30); const code = document.getElementById('inpGssCode').value.trim(), name = document.getElementById('inpGssName').value.trim();
    if (!code || !name) return alert("Enter GSS Code and Name"); if (appState.gssNodes[code]) return alert("GSS Code already exists!");
    const center = map.getCenter(); appState.gssNodes[code] = { code, name, lat: parseFloat(center.lat.toFixed(6)), lng: parseFloat(center.lng.toFixed(6)) };
    window.markDirty('GSS', code); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("New GSS added successfully!");
};
window.relocateGss = function(gssCode) { window.closeObjectSheet(); window.toggleSidebar(false); window.startObjectMove('GSS', gssCode, `GSS (${gssCode})`); };

window.openAddNewFeederModal = function() {
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}">${g.code} - ${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> <span data-i18n="addFeeder">Add Feeder</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Code (Numeric Only)*</label><input type="number" id="newFdrCode" class="form-input" value="${Object.keys(appState.feeders).length + 1}"></div><div class="form-row"><label>Feeder Name*</label><input type="text" id="newFdrName" class="form-input" placeholder="e.g. City Feed 11kV"></div><div class="form-row"><label>Parent GSS*</label><select id="newFdrGss" class="form-select">${gssOpts}</select></div><button class="btn-action-primary" onclick="window.createNewFeeder()" data-i18n="saveFeeder">Save Feeder</button>`);
}
window.createNewFeeder = function() {
    window.haptic(30); const code = document.getElementById('newFdrCode').value.trim(), name = document.getElementById('newFdrName').value.trim(), gss = document.getElementById('newFdrGss').value;
    if (!code || !name) return alert(t("errReq")); 
    appState.feeders[code] = { feeder: { name, code, subdivCode: "SD-01", parentGss: gss }, poles: [], dts: [], lines: [], consumers: [] };
    appState.currentFeederCode = code; window.markDirty('FEEDER', code); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(t("toastAdded"));
}

window.openFeederConfigModal = function() {
    window.toggleSidebar(false); const net = getActiveNetwork(); 
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}" ${net.feeder.parentGss==g.code?'selected':''}>${g.code} - ${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-tower-broadcast"></i> <span data-i18n="manageFdr">Manage Feeders</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Name</label><input type="text" id="cfgFeederName" class="form-input" value="${net.feeder.name}"></div><div class="form-row"><label>Parent GSS Source</label><select id="cfgParentGss" class="form-select">${gssOpts}</select></div><button class="btn-action-primary" onclick="window.saveFeederConfiguration()">Save Config</button>`);
}
window.saveFeederConfiguration = function() {
    window.haptic(30); const net = getActiveNetwork(); net.feeder.name = document.getElementById('cfgFeederName').value; net.feeder.parentGss = document.getElementById('cfgParentGss').value; 
    window.markDirty('FEEDER', net.feeder.code); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(t("toastSettings"));
}

window.openResetConfirmationModal = function() {
    window.closeSettingsPage(); window.toggleSidebar(false); 
    openModal(`<div class="sheet-head"><div class="sheet-title" style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Secure App Reset</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><p style="margin-bottom:12px; font-size:0.9rem; color:var(--text-sub);">This action will permanently wipe all survey data, feeders, and settings from your device. This cannot be undone.</p><div class="form-row"><label>Type <b>RESET</b> to confirm</label><input type="text" id="inpAppResetText" class="form-input" placeholder="Type RESET here"></div><button class="btn-action-primary" style="background:#dc2626;" onclick="window.executeSecureAppReset()">Permanently Delete All Data</button>`);
}
window.executeSecureAppReset = function() { 
    window.haptic([50,50,50]); const inputVal = document.getElementById('inpAppResetText').value.trim();
    if (inputVal !== "RESET") return alert("Confirmation failed. You must type 'RESET' exactly.");
    localforage.clear().then(() => { localStorage.clear(); location.reload(); });
}

function deleteDTLogic(dtId, net) {
    const d = net.dts.find(x => x.id === dtId); if(!d) return;
    const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code)), ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)), ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn);
    net.lines.forEach(l => { if (l.fromNode === ('DT_' + d.code) || l.toNode === ('DT_' + d.code) || ltPoleNodeIds.includes(String(l.fromNode)) || ltPoleNodeIds.includes(String(l.toNode))) window.markDeleted(l.id); });
    net.lines = net.lines.filter(l => l.fromNode !== ('DT_' + d.code) && l.toNode !== ('DT_' + d.code) && !ltPoleNodeIds.includes(String(l.fromNode)) && !ltPoleNodeIds.includes(String(l.toNode)));
    net.consumers.forEach(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); if(isDirectToDT || isOnRemovedLTPole) window.markDeleted(c.id); });
    net.consumers = net.consumers.filter(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); return !(isDirectToDT || isOnRemovedLTPole); });
    ltPolesToRemove.forEach(p => window.markDeleted(p.id));
    net.poles = net.poles.filter(p => !ltPoleIds.includes(String(p.poleNo)));
    window.markDeleted(dtId); net.dts = net.dts.filter(x => x.id !== dtId);
}

function deleteLTPoleLogic(p, net) {
    net.consumers.forEach(c => { if(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo)) window.markDeleted(c.id); });
    net.consumers = net.consumers.filter(c => !(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo)));
    net.lines.forEach(l => { if(String(l.fromNode) === ('POLE_'+p.poleNo) || String(l.toNode) === ('POLE_'+p.poleNo)) window.markDeleted(l.id); });
    net.lines = net.lines.filter(l => String(l.fromNode) !== ('POLE_'+p.poleNo) && String(l.toNode) !== ('POLE_'+p.poleNo));
    window.markDeleted(p.id); net.poles = net.poles.filter(x => x.id !== p.id);
}

window.deleteEntity = function(type, id) {
    window.haptic([50,50,50]); const net = getActiveNetwork(); if(!confirm(t("confDel"))) return; saveSnapshot();
    if (type === 'line') { window.markDeleted(id); net.lines = net.lines.filter(x => x.id !== id); } 
    else if (type === 'consumer') { window.markDeleted(id); net.consumers = net.consumers.filter(x => x.id !== id); } 
    else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole') {
        const p = net.poles.find(x => x.id === id);
        if (p) { 
            if (p.lineType === 'LT') deleteLTPoleLogic(p, net); 
            else { 
                const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); 
                dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); 
                net.lines.forEach(l => { if(l.fromNode === ('POLE_'+p.poleNo) || l.toNode === ('POLE_'+p.poleNo)) window.markDeleted(l.id); });
                net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); 
                window.markDeleted(id); net.poles = net.poles.filter(x => x.id !== id); 
            } 
        }
    } else if (type === 'gss') { if (appState.gssNodes[id]) { window.markDeleted('GSS_' + id); delete appState.gssNodes[id]; } }
    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast(t("toastDel"));
}

window.startObjectMove = function(type, id, title) {
    window.haptic(15); window.closeObjectSheet(); appState.activeMove = { type, id }; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'flex'; document.getElementById('moveTargetTitle').innerText = `Move: ${title}`;
    let target = null; let htmlContent = '';
    if(type === 'GSS') { target = appState.gssNodes[id]; htmlContent = `<svg width="44" height="48" viewBox="0 0 44 48" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><text x="22" y="30" font-size="12" font-weight="900" fill="#fff" text-anchor="middle">GSS</text></svg>`; } 
    else {
        const net = getActiveNetwork(); 
        if (type === 'POLE') { 
            target = net.poles.find(x => x.id === id); const isLT = target.lineType === 'LT'; let displayNo = target.poleNo; if (isLT && String(target.poleNo).includes('-')) displayNo = String(target.poleNo).split('-')[1]; 
            const color = isLT ? '#10b981' : '#fde047';
            htmlContent = `<svg width="30" height="44" viewBox="0 0 30 44" xmlns="http://www.w3.org/2000/svg"><path d="M 15 16 L 15 44" stroke="#0f172a" stroke-width="4"/><path d="M 15 16 L 15 44" stroke="${color}" stroke-width="2"/><rect x="0" y="0" width="30" height="14" rx="4" fill="${color}" stroke="#0f172a" stroke-width="1.5"/><text x="15" y="10" font-size="9" font-weight="900" fill="#0f172a" text-anchor="middle">${displayNo}</text></svg>`; 
        } 
        else if (type === 'CONSUMER') { target = net.consumers.find(x => x.id === id); htmlContent = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="11" r="10" fill="#10b981" stroke="white" stroke-width="1.5"/></svg>`; }
    }
    if (target && target.lat && map) { map.panTo([target.lat, target.lng]); const liveIconContainer = document.getElementById('live-move-icon'); liveIconContainer.innerHTML = htmlContent; liveIconContainer.style.display = 'block'; renderEntireNetwork(); }
}

window.confirmObjectMove = function() {
    window.haptic(30); if (!appState.activeMove) return; saveSnapshot(); const c = map.getCenter(); const lat = parseFloat(c.lat.toFixed(6)), lng = parseFloat(c.lng.toFixed(6)), net = getActiveNetwork(); 
    if (appState.activeMove.type === 'GSS') {
        const gss = appState.gssNodes[appState.activeMove.id];
        if(gss) { 
            gss.lat = lat; gss.lng = lng; window.markDirty('GSS', gss.code);
            net.lines.forEach(l => { 
                if (l.fromNode == gss.code) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); window.markDirty('LINE', l.id); } 
                if (l.toNode == gss.code) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); window.markDirty('LINE', l.id); } 
            }); 
        }
    } else {
        if (appState.activeMove.type === 'POLE') {
            const p = net.poles.find(x => x.id === appState.activeMove.id);
            if (p) { 
                p.lat = lat; p.lng = lng; window.markDirty('POLE', p.id);
                net.dts.forEach(d => { if (d.parentPole == p.poleNo) { d.lat = lat; d.lng = lng; window.markDirty('DT', d.id); } }); 
                net.lines.forEach(l => { 
                    if (l.fromNode == p.poleNo) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); window.markDirty('LINE', l.id); } 
                    if (l.toNode == p.poleNo) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); window.markDirty('LINE', l.id); } 
                }); 
            }
        } else if (appState.activeMove.type === 'CONSUMER') { const cons = net.consumers.find(x => x.id === appState.activeMove.id); if (cons) { cons.lat = lat; cons.lng = lng; window.markDirty('CONSUMER', cons.id); } }
    }
    window.cancelObjectMove(); renderEntireNetwork(); triggerPersistence(); showToast("Location Updated!");
}

window.cancelObjectMove = function() { window.haptic(15); appState.activeMove = null; document.getElementById('live-move-icon').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; renderEntireNetwork(); }

function getFormattedDateTime() { const d = new Date(); const pad = (n) => n.toString().padStart(2, '0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }

async function smartExportFile(filename, dataBlobOrText, mimeType) {
    try {
        showToast("Preparing file export..."); const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
        if (window.cordova && cordova.file) {
            const storageLocation = cordova.file.externalRootDirectory + 'Download/';
            window.resolveLocalFileSystemURL(storageLocation, function(dirEntry) {
                dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) { fileEntry.createWriter(function(fileWriter) { fileWriter.onwriteend = function() { showToast("File saved to Downloads!"); }; fileWriter.onerror = function(e) { console.error(e); showToast("File write error"); }; fileWriter.write(blob); }); }, err => { console.error(err); showToast("Error creating file"); });
            }, err => { console.error(err); showToast("Error accessing Downloads"); });
        } else {
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500); showToast("File Downloaded!");
        }
    } catch (err) { console.error("Export Error: ", err); alert("Export failed: " + err.message); }
}

window.exportFullJSONBackup = async function() { window.toggleSidebar(false); const backupData = JSON.stringify(appState); await smartExportFile(`DISCOM_Backup_${getFormattedDateTime()}.json`, backupData, "application/json"); }
window.handleImportChoice = function(e) {
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = async function(event) {
        try { const content = event.target.result; const importedData = JSON.parse(content); if (importedData.feeders && importedData.gssNodes) { appState = importedData; triggerPersistence(); renderEntireNetwork(); showToast("Data Imported Successfully!"); } else alert("Invalid Backup Format! File missing core node structures."); } catch (err) { alert("Error parsing file."); }
    };
    reader.readAsText(file); e.target.value = ''; window.toggleSidebar(false);
}

window.getCSVString = function() {
    const net = getActiveNetwork(); let csv = "\uFEFFWKT,Name,Type,ParentNode,Details\n"; 
    Object.values(appState.gssNodes).forEach(g => csv += `"POINT (${g.lng} ${g.lat})","${g.name}","GSS","","Code: ${g.code}"\n`);
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})","Pole ${p.poleNo}","POLE","${p.dtCode||p.poleNo}","Type: ${p.lineType}"\n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})","DT ${d.code}","DT","${d.parentPole}","Rating: ${d.rating}kVA"\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})","${c.name}","CONSUMER","${c.parentRef}","KNo: ${c.kno}"\n`);
    net.lines.forEach(l => { if (l.coords && l.coords.length === 2) csv += `"LINESTRING (${l.coords[0][1]} ${l.coords[0][0]}, ${l.coords[1][1]} ${l.coords[1][0]})","${l.type}","LINE","${l.fromNode} ➔ ${l.toNode}","Dist: ${(l.distanceMeters||0).toFixed(1)}m"\n`; });
    return csv;
}
window.exportDataToCSV = async function() { window.toggleSidebar(false); await smartExportFile(`Feeder_${getActiveNetwork().feeder.code}_${getFormattedDateTime()}.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.exportToAutoCAD_DXF = async function() { 
    window.toggleSidebar(false); let dxf = "0\nSECTION\n2\nENTITIES\n"; getActiveNetwork().lines.forEach(l => { if (l.coords && l.coords[0] && l.coords[1]) dxf += `0\nLINE\n8\n${l.type.replace(/\s+/g,'_')}\n10\n${l.coords[0][1]}\n20\n${l.coords[0][0]}\n30\n0\n11\n${l.coords[1][1]}\n21\n${l.coords[1][0]}\n31\n0\n`; }); dxf += "0\nENDSEC\n0\nEOF\n"; 
    await smartExportFile(`Feeder_${getActiveNetwork().feeder.code}_${getFormattedDateTime()}.dxf`, dxf, "application/dxf"); 
}
window.exportToGoogleEarth_KML = async function() { 
    window.toggleSidebar(false); const esc = u => u.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
    const feederName = esc(getActiveNetwork().feeder.name); let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${feederName}</name>\n`; 
    getActiveNetwork().lines.forEach(l => { if (l.coords) kml += `<Placemark><LineString><coordinates>${l.coords[0][1]},${l.coords[0][0]},0 ${l.coords[1][1]},${l.coords[1][0]},0</coordinates></LineString></Placemark>\n`; }); 
    getActiveNetwork().dts.forEach(d => { if (d.lat) kml += `<Placemark><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>\n`; });
    kml += "</Document>\n</kml>"; await smartExportFile(`Feeder_${getActiveNetwork().feeder.code}_${getFormattedDateTime()}.kml`, kml, "application/vnd.google-earth.kml+xml"); 
}

window.generateCadSLDPdf = async function() { 
    window.toggleSidebar(false); const net = getActiveNetwork(); if(!window.jspdf || !window.jspdf.jsPDF) return alert("PDF Generator library load error.");
    showToast("Generating Auto-Fit SLD PDF..."); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' });
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180; const allPoints = [];
    if(appState.gssNodes[net.feeder.parentGss]) allPoints.push(appState.gssNodes[net.feeder.parentGss]);
    net.dts.forEach(d => allPoints.push(d)); if(allPoints.length === 0) return alert("No DT/GSS nodes found to plot!");
    allPoints.forEach(p => { if(p.lat < minLat) minLat = p.lat; if(p.lat > maxLat) maxLat = p.lat; if(p.lng < minLng) minLng = p.lng; if(p.lng > maxLng) maxLng = p.lng; });
    const latBuffer = (maxLat - minLat) * 0.20; const lngBuffer = (maxLng - minLng) * 0.20; minLat -= latBuffer; maxLat += latBuffer; minLng -= lngBuffer; maxLng += lngBuffer;
    const margin = 60; const pdfW = 1189 - (margin * 2); const pdfH = 841 - (margin * 2); const latDiff = maxLat - minLat || 0.0001; const lngDiff = maxLng - minLng || 0.0001;
    const needsRotation = latDiff > lngDiff; let scale, offsetX, offsetY;
    if (needsRotation) { const scaleX = pdfW / latDiff; const scaleY = pdfH / lngDiff; scale = Math.min(scaleX, scaleY) * 0.80; offsetX = margin + (pdfW - (latDiff * scale)) / 2; offsetY = margin + (pdfH - (lngDiff * scale)) / 2; } 
    else { const scaleX = pdfW / lngDiff; const scaleY = pdfH / latDiff; scale = Math.min(scaleX, scaleY) * 0.80; offsetX = margin + (pdfW - (lngDiff * scale)) / 2; offsetY = margin + (pdfH - (latDiff * scale)) / 2; }
    function getPt(lat, lng) { if (needsRotation) { return { x: offsetX + (lat - minLat) * scale, y: offsetY + (lng - minLng) * scale }; } else { return { x: offsetX + (lng - minLng) * scale, y: 841 - (offsetY + (lat - minLat) * scale) }; } }

    doc.setFontSize(10); doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5);
    net.lines.forEach(l => {
        if(l.type.includes('LT')) return; 
        const c1 = getNodeCoords(l.fromNode), c2 = getNodeCoords(l.toNode);
        if(c1 && c2) {
            const pt1 = getPt(c1.lat, c1.lng), pt2 = getPt(c2.lat, c2.lng);
            if (l.phaseType === 'Three Phase' && !l.type.includes('UG CABLE')) {
                const dx = pt2.x - pt1.x; const dy = pt2.y - pt1.y; const len = Math.sqrt(dx*dx + dy*dy) || 0.001; const nx = -dy/len; const ny = dx/len; const off = 1.5; 
                doc.setDrawColor(239, 68, 68); doc.setLineWidth(1.5); doc.line(pt1.x + nx*off, pt1.y + ny*off, pt2.x + nx*off, pt2.y + ny*off); doc.setDrawColor(234, 179, 8); doc.line(pt1.x, pt1.y, pt2.x, pt2.y); doc.setDrawColor(59, 130, 246); doc.line(pt1.x - nx*off, pt1.y - ny*off, pt2.x - nx*off, pt2.y - ny*off);
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

    let t11 = 0, dt1ph = 0, dt3ph = 0; net.lines.forEach(l => { if(!l.type.includes('LT')) t11 += (l.distanceMeters||0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
    
    doc.setFont("helvetica", "normal"); doc.setFillColor(255, 255, 255); doc.setDrawColor(0,0,0); doc.setLineWidth(0.5); doc.rect(1189 - 160, 841 - 70, 150, 60, 'FD'); doc.setTextColor(0, 0, 0); doc.setFontSize(16); doc.text("DISCOM SLD REPORT", 1189 - 155, 841 - 55); doc.setFontSize(12); doc.text(`Feeder: ${net.feeder.name} (${net.feeder.code})`, 1189 - 155, 841 - 45); doc.text(`Total HT Line: ${(t11/1000).toFixed(3)} KM`, 1189 - 155, 841 - 35); doc.text(`1-Phase DTs: ${dt1ph}`, 1189 - 155, 841 - 25); doc.text(`3-Phase DTs: ${dt3ph}`, 1189 - 155, 841 - 15);
    await smartExportFile(`SLD_Feeder_${net.feeder.code}_${getFormattedDateTime()}.pdf`, doc.output('blob'), "application/pdf");
}

window.openAboutModal = function() {
    window.toggleSidebar(false); openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-circle-info"></i> <span data-i18n="about">About App</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div style="text-align:center; padding: 20px 0;"><div class="auth-logo" style="color:var(--accent); font-size:3rem; margin-bottom:10px;"><i class="fa-solid fa-bolt-lightning"></i></div><h2 style="font-size:1.4rem; font-weight:800; margin-bottom:5px;">DISCOM Survey Pro</h2><p style="color:var(--text-sub); font-size:0.9rem; margin-bottom:20px;">Enterprise Survey App</p><div style="background:var(--bg-base); padding:15px; border-radius:12px; border:1px solid var(--border);"><p style="font-weight:700; font-size:1rem; color:var(--text-main);">Developed by</p><p style="font-size:1.2rem; font-weight:900; color:var(--accent); margin-top:4px;">Suraj Singh Mehta</p></div><p style="font-size:0.75rem; color:var(--text-sub); margin-top:20px;">Version 1.0.0</p></div>`);
}

window.savePoleData = function(editId) { 
    window.haptic(30); saveSnapshot(); 
    const category = document.getElementById('inpPoleCategory').value, lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value), structure = document.getElementById('inpPoleStruct').value, condition = document.getElementById('inpPoleCond').value, photo = document.getElementById('inpPolePhoto').value;
    let no = ''; const noElem = document.getElementById('inpPoleNo'); if (noElem) { no = noElem.value.trim(); }
    const net = getActiveNetwork(); 
    if (editId) {
        if (!no) return alert(t("errReq"));
        if (net.poles.some(p => p.id !== editId && String(p.poleNo) === no)) return alert(t("alertExists"));
        let p = net.poles.find(x => x.id === editId); if(!p) return;
        p.poleNo = no; p.structure = structure; p.condition = condition; p.photo = photo;
        window.markDirty('POLE', editId);
    } else {
        let dtCode = category === 'LT' ? document.getElementById('inpLTPoleDT').value : undefined;
        if (category === 'LT' && !no) { const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); no = `${dtCode}-${existingLTPoles.length + 1}`; }
        if (!no) return alert(t("errReq"));
        if (net.poles.some(p => String(p.poleNo) === no)) return alert(t("alertExists"));
        const newId = 'P_'+Date.now();
        net.poles.push({ id: newId, poleNo: no, lineType: category, structure, condition, photo, dtCode, lat, lng }); 
        window.markDirty('POLE', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveLineData = function(editId) {
    window.haptic(30); saveSnapshot(); const from = document.getElementById('inpFromNode').value, to = document.getElementById('inpToNode').value, type = document.getElementById('inpLineType').value, phaseType = document.getElementById('inpLinePhase').value, hasCrossing = document.getElementById('inpLineCrossing').checked, crossingRemark = document.getElementById('inpLineCrossRemark').value.trim();
    if (from === to) return alert("Cannot connect node to itself!"); if (!to) return alert("Please select a target node!");
    const net = getActiveNetwork(), spec = getLineSpec(type);
    
    if (phaseType === 'Three Phase' && !String(from).startsWith('GSS')) {
        const connectedLines = net.lines.filter(l => (l.fromNode === from || l.toNode === from) && l.id !== editId);
        if (connectedLines.length > 0) {
            const hasThreePhase = connectedLines.some(l => l.phaseType === 'Three Phase');
            if (!hasThreePhase) { return alert("Error: Is Pole par peeche se aane wali koi Three Phase line nahi hai. Aap yahan se aage Three Phase line nahi jod sakte!"); }
        }
    }

    if(net.lines.find(l => l.id !== editId && ((l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from)))) return alert("A line already exists between these two nodes!");
    
    if(editId) {
        let l = net.lines.find(x => x.id === editId); if(!l) return;
        l.type = spec.name; l.phaseType = phaseType; l.hasCrossing = hasCrossing; l.crossingRemark = crossingRemark;
        window.markDirty('LINE', editId);
    } else {
        const c1 = getNodeCoords(from), c2 = getNodeCoords(to); if(!c1 || !c2) return alert("Invalid node coordinates!"); const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); 
        const newId = 'LN_'+Date.now();
        net.lines.push({ id: newId, type: spec.name, phaseType, hasCrossing, crossingRemark, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] }); 
        window.markDirty('LINE', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveDTData = function(editId) {
    window.haptic(30); saveSnapshot(); 
    const parentRef = document.getElementById('inpDTParent').value, code = document.getElementById('inpDTCode').value.trim(), rating = parseFloat(document.getElementById('inpDTRating').value), phase = document.getElementById('inpDTPhase').value, name = document.getElementById('inpDTName').value.trim();
    const location = name, srNo = document.getElementById('inpDTSrNo').value.trim(), tn = document.getElementById('inpDTTN').value.trim(), mountedOn = document.getElementById('inpDTMount').value, photo = document.getElementById('inpDTPhoto').value;
    
    if (!code) return alert(t("errReq")); const net = getActiveNetwork();

    const poleNodeId = 'POLE_' + parentRef;
    const htLinesOnPole = net.lines.filter(l => (l.fromNode === poleNodeId || l.toNode === poleNodeId) && l.type.includes('11 KV'));
    if (htLinesOnPole.length > 0) {
        const hasThreePhaseLine = htLinesOnPole.some(l => l.phaseType === 'Three Phase');
        if (!hasThreePhaseLine && phase === 'Three Phase') { return alert("Error: Is Pole par sirf Single Phase 11kV line judi hai. Aap yahan par Three Phase DT install nahi kar sakte!"); }
    }
    
    if(editId) {
        if (net.dts.some(d => d.id !== editId && String(d.code) === code)) return alert(t("alertExists"));
        let d = net.dts.find(x => x.id === editId); if(!d) return;
        d.code = code; d.name = name; d.rating = rating; d.phase = phase; d.location = location; d.srNo = srNo; d.tn = tn; d.mountedOn = mountedOn; d.photo = photo;
        window.markDirty('DT', editId);
    } else {
        if (net.dts.some(d => String(d.code) === code)) return alert(t("alertExists"));
        const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); let lat = net.feeder.lat, lng = net.feeder.lng; if (p) { lat = p.lat; lng = p.lng; }
        const newId = 'DT_'+Date.now();
        net.dts.push({ id: newId, parentPole: parentRef, code, name, rating, phase, srNo, tn, mountedOn, location, photo, lat, lng });
        window.markDirty('DT', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveConsumerData = function(editId) {
    window.haptic(30); saveSnapshot(); const parentRef = document.getElementById('inpConsParent').value, kno = document.getElementById('inpConsKno').value.trim(), acNo = document.getElementById('inpConsAcNo').value.trim(), name = document.getElementById('inpConsName').value.trim(), meterNo = document.getElementById('inpConsMeter').value.trim(), conType = document.getElementById('inpConsType').value, status = document.getElementById('inpConsStatus').value, load = document.getElementById('inpConsLoad').value.trim(), photo = document.getElementById('inpConsPhoto').value;
    if (!name || !kno || !acNo) return alert(t("errReq")); 
    if(kno.length !== 12) return alert("K-Number must be exactly 12 digits!"); if(acNo.length !== 8) return alert("A/C No. must be exactly 8 digits!");
    const net = getActiveNetwork();

    if(editId) {
        if(net.consumers.some(c => c.id !== editId && String(c.kno) === String(kno))) return alert("K-Number already exists!");
        let c = net.consumers.find(x => x.id === editId); if(!c) return;
        c.kno = kno; c.acNo = acNo; c.name = name; c.meterNo = meterNo; c.conType = conType; c.status = status; c.load = load; c.photo = photo;
        window.markDirty('CONSUMER', editId);
    } else {
        if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number already exists in this feeder!");
        let parentType = 'POLE'; const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); if (!p) parentType = 'DT';
        const lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value);
        const newId = 'CS_'+Date.now();
        net.consumers.push({ id: newId, parentRef, parentType, kno, acNo, meterNo, conType, status, name, load, photo, lat, lng }); 
        window.markDirty('CONSUMER', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

let appInitialized = false;
async function initializeApplication() {
    if(appInitialized) return; appInitialized = true;
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const p = cordova.plugins.permissions;
        p.requestPermission(p.ACCESS_FINE_LOCATION, function() { p.requestPermission(p.CAMERA, function() { p.requestPermissions([ p.READ_EXTERNAL_STORAGE, p.WRITE_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ], function(){}, function(){}); }, function(){}); }, function(){});
    }
    
    try {
        document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex';
        if (typeof L !== 'undefined') initMapSystem();

        let data = null;
        if (typeof localforage !== 'undefined') { data = await localforage.getItem(DB_KEY); } else { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) { appState = data; if (!appState.unsyncedCount) appState.unsyncedCount = 0; }
        if (!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
        if (!appState.deletedItems) appState.deletedItems = [];
        if(appState.settings.darkMode) document.documentElement.setAttribute('data-theme', 'dark');

        translateApp(); updateSyncUI();
        
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); 
            const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
            if (hasDirty || appState.deletedItems.length > 0) { await window.syncToSupabase(); }
            await pullFromSupabase(); 
        } 
        
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(async ({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); 
                    const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
                    if (hasDirty || appState.deletedItems.length > 0) { await window.syncToSupabase(); }
                    await pullFromSupabase(); 
                }
            });
        }
    } catch (e) { console.error("Initialization Error:", e); } 
    finally { if (navigator.splashscreen) setTimeout(() => { navigator.splashscreen.hide(); }, 500); }
}

document.addEventListener('deviceready', initializeApplication, false); 
window.addEventListener('DOMContentLoaded', () => { setTimeout(initializeApplication, 2500); });
