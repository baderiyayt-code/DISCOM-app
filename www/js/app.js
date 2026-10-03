/* --- PART 1 --- */
const DB_KEY = "DISCOM_ENTERPRISE_DB";

const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
let supabaseClient = null;
const ADMIN_EMAIL = 'admin@discom.com';

let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', theme: 'light', liveSync: true }, 
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: null,
    gssNodes: {}, feeders: {},  
    orphanPoleIds: new Set(), activeMove: null, placementType: null, photos: [],
    deletedObjectIds: [], deletedFeederCodes: []
};

let historyStack = [];
let map = null; let tileLayers = {}; let currentTileIndex = 0; let layerKeys = []; let featureGroups = {};
window.isSetupModalOpen = false; window.tempPhotoUrl = null;

// EXPANDED TRANSLATIONS FOR FULL APP
const i18n = {
    en: { 
        appLanguage: "Language", distUnit: "Distance Unit", theme: "Theme", settings: "Settings", save: "Save", edit: "Edit", delete: "Delete", 
        mapSetup: "Network Setup Required", htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", 
        permReq: "Permissions Required", permDesc: "This app requires Location, Camera and Storage permissions.", grantPerm: "Grant Permissions",
        kpi11: "11 KV LINE", kpiLT: "LT LINE", kpi3Ph: "3-PH DT", kpi1Ph: "1-PH DT", kpiCons: "CONSUMERS", searchPla: "Search Consumer, DT, Pole..."
    },
    hi: { 
        appLanguage: "ऐप की भाषा", distUnit: "दूरी की इकाई", theme: "थीम मोड", settings: "सेटिंग्स", save: "सेव करें", edit: "बदलें", delete: "डिलीट", 
        mapSetup: "नेटवर्क सेटअप ज़रूरी है", htPole: "HT पोल", ltPole: "LT पोल", line: "लाइन", dt: "डी.टी", consumer: "कंज्यूमर", 
        permReq: "अनुमति आवश्यक है", permDesc: "इस ऐप को चलाने के लिए Location, Camera और Storage की अनुमति दें।", grantPerm: "अनुमति दें",
        kpi11: "11 KV लाइन", kpiLT: "LT लाइन", kpi3Ph: "3-फेज़ DT", kpi1Ph: "1-फेज़ DT", kpiCons: "कंज्यूमर", searchPla: "सर्च करें: पोल, डी.टी, उपभोक्ता..."
    }
};

function applyTranslations() {
    const lang = appState.settings.language || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(i18n[lang] && i18n[lang][key]) { if(el.tagName === 'INPUT' && el.type === 'text') el.placeholder = i18n[lang][key]; else el.innerHTML = i18n[lang][key]; }
    });
    const t = i18n[lang];
    if(document.getElementById('kpi11Label')) document.getElementById('kpi11Label').innerText = t.kpi11;
    if(document.getElementById('kpiLTLabel')) document.getElementById('kpiLTLabel').innerText = t.kpiLT;
    if(document.getElementById('kpi3PhLabel')) document.getElementById('kpi3PhLabel').innerText = t.kpi3Ph;
    if(document.getElementById('kpi1PhLabel')) document.getElementById('kpi1PhLabel').innerText = t.kpi1Ph;
    if(document.getElementById('kpiConsLabel')) document.getElementById('kpiConsLabel').innerText = t.kpiCons;
    if(document.getElementById('appSearchBar')) document.getElementById('appSearchBar').placeholder = t.searchPla;
}

function applyTheme() {
    if(appState.settings.theme === 'dark') document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
}

window.getDistStr = (lat, lng) => {
    if(!lat || !lng || isNaN(lat)) return '';
    if(!map) return ''; const c = map.getCenter();
    return window.formatDistance(window.calcDistance(c.lat, c.lng, lat, lng));
};

function initMapLayers() {
    if (typeof L === 'undefined') return; 
    map = L.map('map', { 
        zoomControl: false, attributionControl: false, preferCanvas: false, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0,
        zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false
    }).setView([26.9150, 75.7830], 16);

    map.on('zoomend', updateMapZoomClasses); 
    
    map.on('move', () => { 
        const c = map.getCenter(); 
        document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        if (appState.placementType && document.getElementById('center-placement-pin').style.display === 'block') {
            const net = getActiveNetwork();
            if (net) {
                let nearestDist = Infinity; let nearestName = 'None';
                const checkNode = (lat, lng, name) => {
                    if(lat && lng && !isNaN(lat) && !isNaN(lng)) {
                        const d = window.calcDistance(c.lat, c.lng, lat, lng);
                        if(d < nearestDist) { nearestDist = d; nearestName = name; }
                    }
                };
                net.poles.forEach(p => checkNode(p.lat, p.lng, `Pole ${p.poleNo}`));
                net.dts.forEach(d => checkNode(d.lat, d.lng, `DT ${d.code}`));
                const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null;
                if(gss) checkNode(gss.lat, gss.lng, 'GSS');
                const ind = document.getElementById('live-distance-indicator');
                if (nearestDist === Infinity) { ind.style.display = 'none'; } 
                else { ind.style.display = 'block'; ind.innerText = `Nearest: ${nearestName} (${window.formatDistance(nearestDist)})`; }
            }
        }
    });

    tileLayers = { 
        osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) },
        hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
        street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) }
    };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    featureGroups = { 
        gss: L.featureGroup().addTo(map), lines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map),
        poles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) 
    };
    
    // Inject Live Search Icon Button Top Right
    const headerActions = document.querySelector('.header-actions');
    if(headerActions) {
        const searchBtn = document.createElement('button');
        searchBtn.className = 'action-btn-sm';
        searchBtn.innerHTML = '<i class="fa-solid fa-search"></i>';
        searchBtn.onclick = window.toggleSearchBox;
        headerActions.insertBefore(searchBtn, headerActions.firstChild);
    }
}

function updateMapZoomClasses() {
    if(!map) return;
    const z = map.getZoom(); const mapEl = document.getElementById('map');
    mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-ht-lines', 'hide-dt', 'hide-gss');
    if (z <= 18) mapEl.classList.add('hide-consumers'); 
    if (z <= 17) mapEl.classList.add('hide-lt-poles'); 
    if (z <= 16) mapEl.classList.add('hide-lt-lines'); 
    if (z <= 15) mapEl.classList.add('hide-ht-poles'); 
    if (z <= 14) mapEl.classList.add('hide-ht-lines'); 
    if (z <= 13) mapEl.classList.add('hide-dt'); 
    if (z <= 12) mapEl.classList.add('hide-gss'); 
}

window.toggleMapLayer = function() { 
    if(!map) return; map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; 
    tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name;
}

window.updateFeederDropdown = function() {
    const header = document.getElementById('activeFeederLabel'); if(!header) return;
    const keys = Object.keys(appState.feeders || {});
    if(keys.length === 0) { header.innerText = 'No Feeder'; appState.currentFeederCode = null; } 
    else {
        if(!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) { appState.currentFeederCode = keys[0]; }
        const currentFeeder = appState.feeders[appState.currentFeederCode];
        header.innerText = (currentFeeder && currentFeeder.feeder && currentFeeder.feeder.name) ? currentFeeder.feeder.name : 'Unnamed Feeder';
    }
};

window.switchFeeder = function(code) { 
    if (appState.feeders[code]) { appState.currentFeederCode = code; window.updateFeederDropdown(); renderEntireNetwork(); triggerPersistence(); centerMapOnGSS(); window.toggleSidebar(false); } 
}

function getActiveNetwork() {
    let keys = Object.keys(appState.feeders || {});
    if (keys.length > 0 && (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode])) appState.currentFeederCode = keys[0];
    let net = appState.feeders[appState.currentFeederCode]; if (!net) return null; 
    if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

function showToast(msg) { const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg'); if (!toast || !msgElem) return; msgElem.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
function setSyncStatus(status) { const ind = document.getElementById('sync-indicator'); if(!navigator.onLine) status = 'offline'; if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>'; else if(status === 'synced') ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success"></i>'; else ind.innerHTML = '<i class="fa-solid fa-cloud-xmark sync-error"></i>'; }
function getPhotoUrl(objId) { if(!appState.photos) return null; const p = appState.photos.find(x => x.object_id === objId); return p ? p.photo_url : null; }

function updateUnsyncedBadge() {
    let unsyncCount = 0;
    if(appState.photos) unsyncCount += appState.photos.filter(p => !p.synced).length;
    for(let fCode in appState.feeders) {
        let f = appState.feeders[fCode];
        if(f.poles) unsyncCount += f.poles.filter(p => !p.synced).length;
        if(f.lines) unsyncCount += f.lines.filter(l => !l.synced).length;
        if(f.dts) unsyncCount += f.dts.filter(d => !d.synced).length;
        if(f.consumers) unsyncCount += f.consumers.filter(c => !c.synced).length;
    }
    let badge = document.getElementById('unsync-badge');
    const syncBtn = document.getElementById('sync-indicator');
    if(!badge && syncBtn) {
        badge = document.createElement('div'); badge.id = 'unsync-badge';
        badge.style.cssText = 'position:absolute; top:-5px; right:-5px; background:#ef4444; color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; border:2px solid white; z-index:10; pointer-events:none;';
        syncBtn.style.position = 'relative'; syncBtn.appendChild(badge);
    }
    if(badge) { badge.innerText = unsyncCount; badge.style.display = unsyncCount > 0 ? 'block' : 'none'; }
}

/* ====== RELATIONAL DATABASE SYNC LOGIC ====== */
window.syncToSupabase = async function() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; setSyncStatus('syncing');
    try {
        if (appState.deletedObjectIds && appState.deletedObjectIds.length > 0) {
            await supabaseClient.from('object_photos').delete().in('object_id', appState.deletedObjectIds);
            await supabaseClient.from('survey_objects').delete().in('id', appState.deletedObjectIds);
            appState.deletedObjectIds = []; 
        }
        if (appState.deletedFeederCodes && appState.deletedFeederCodes.length > 0) {
            await supabaseClient.from('feeders').delete().in('code', appState.deletedFeederCodes);
            appState.deletedFeederCodes = []; 
        }

        const metaData = { settings: appState.settings, filters: appState.filters, currentFeederCode: appState.currentFeederCode, gssNodes: appState.gssNodes };
        const { error: metaErr } = await supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: metaData, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
        if(metaErr) { alert("Survey Data Error: " + metaErr.message); throw metaErr; }

        let feedersPayload = []; let objectsPayload = [];
        for (let fCode in appState.feeders) {
            let f = appState.feeders[fCode]; let gCode = f.feeder.parentGss || 'UNKNOWN';
            feedersPayload.push({ code: fCode, user_id: appState.user.id, gss_code: gCode, name: f.feeder.name, details: f.feeder });

            f.poles.filter(p=>!p.synced).forEach(p => objectsPayload.push({ id: p.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'POLE', details: p }));
            f.dts.filter(d=>!d.synced).forEach(d => objectsPayload.push({ id: d.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'DT', details: d }));
            f.lines.filter(l=>!l.synced).forEach(l => objectsPayload.push({ id: l.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'LINE', details: l }));
            f.consumers.filter(c=>!c.synced).forEach(c => objectsPayload.push({ id: c.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'CONSUMER', details: c }));
        }

        if (feedersPayload.length > 0) {
            const { error: feedErr } = await supabaseClient.from('feeders').upsert(feedersPayload, { onConflict: 'code' });
            if(feedErr) { alert("Feeder Save Error: " + feedErr.message); throw feedErr; }
        }

        if (objectsPayload.length > 0) {
            for (let i = 0; i < objectsPayload.length; i += 200) {
                const { error: objErr } = await supabaseClient.from('survey_objects').upsert(objectsPayload.slice(i, i + 200), { onConflict: 'id' });
                if(objErr) { alert("Objects Save Error: " + objErr.message); throw objErr; }
            }
            for (let fCode in appState.feeders) {
                appState.feeders[fCode].poles.forEach(p => p.synced = true);
                appState.feeders[fCode].dts.forEach(d => d.synced = true);
                appState.feeders[fCode].lines.forEach(l => l.synced = true);
                appState.feeders[fCode].consumers.forEach(c => c.synced = true);
            }
        }

        if (appState.photos && appState.photos.length > 0) {
            const unsyncedPhotos = appState.photos.filter(p => !p.synced);
            if (unsyncedPhotos.length > 0) {
                const photoPayload = unsyncedPhotos.map(p => ({ id: p.id, user_id: appState.user.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url }));
                for(let i=0; i<photoPayload.length; i+=5) {
                    const { error: photoErr } = await supabaseClient.from('object_photos').upsert(photoPayload.slice(i, i+5), { onConflict: 'id' });
                    if(photoErr) { alert("Photo Save Error: " + photoErr.message); throw photoErr; }
                }
                unsyncedPhotos.forEach(p => p.synced = true); 
            }
        }

        if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState);
        setSyncStatus('synced'); updateUnsyncedBadge();
    } catch (err) { console.warn("Sync error", err); setSyncStatus('offline'); updateUnsyncedBadge(); }
}

async function pullFromSupabase() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; setSyncStatus('syncing');
    try {
        const { data: metaData } = await supabaseClient.from('survey_data').select('data').eq('user_id', appState.user.id);
        if(metaData && metaData.length > 0) {
            const cd = metaData[0].data;
            appState.gssNodes = cd.gssNodes || {};
            appState.settings = { ...appState.settings, ...(cd.settings || {}) };
            appState.filters = cd.filters || appState.filters;
            appState.currentFeederCode = cd.currentFeederCode || null;
        }

        const { data: feedersData } = await supabaseClient.from('feeders').select('*').eq('user_id', appState.user.id);
        appState.feeders = {};
        if(feedersData) { feedersData.forEach(f => { appState.feeders[f.code] = { feeder: f.details, poles: [], dts: [], lines: [], consumers: [] }; }); }

        const { data: objData } = await supabaseClient.from('survey_objects').select('*').eq('user_id', appState.user.id);
        if(objData) {
            objData.forEach(row => {
                const fCode = row.feeder_code;
                if(appState.feeders[fCode]) {
                    row.details.synced = true;
                    if(row.object_type === 'POLE') appState.feeders[fCode].poles.push(row.details);
                    if(row.object_type === 'DT') appState.feeders[fCode].dts.push(row.details);
                    if(row.object_type === 'LINE') appState.feeders[fCode].lines.push(row.details);
                    if(row.object_type === 'CONSUMER') appState.feeders[fCode].consumers.push(row.details);
                }
            });
        }

        const { data: photoData } = await supabaseClient.from('object_photos').select('id, object_type, object_id, photo_url').eq('user_id', appState.user.id);
        if(photoData) { appState.photos = photoData.map(p => ({ id: p.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url, synced: true })); } else appState.photos = [];

        if(typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState); 
        applyTranslations(); applyTheme(); if(map) map.invalidateSize();
        renderEntireNetwork(); window.updateFeederDropdown(); setSyncStatus('synced'); centerMapOnGSS(); checkOnboardingFlow(); updateUnsyncedBadge();
    } catch (err) { console.error("Sync error:", err); setSyncStatus('offline'); if(map) map.invalidateSize(); checkOnboardingFlow(); updateUnsyncedBadge(); }
}

function triggerPersistence() { 
    try {
        if(typeof localforage !== 'undefined') { localforage.setItem(DB_KEY, appState).catch((err) => console.log("LocalForage Error:", err)); } 
        else { localStorage.setItem(DB_KEY, JSON.stringify(appState)); }
        updateUnsyncedBadge();
        if(appState.settings && appState.settings.liveSync) { window.syncToSupabase(); }
    } catch(err) { console.error("Persistence Error:", err); }
}

/* --- PART 2 --- */
let authMode = 'login';
window.toggleAuthMode = function() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    document.getElementById('loginBtn').style.display = authMode === 'login' ? 'inline-block' : 'none'; document.getElementById('signupBtn').style.display = authMode === 'signup' ? 'inline-block' : 'none'; document.getElementById('signupNameField').style.display = authMode === 'signup' ? 'block' : 'none'; document.getElementById('authToggleText').innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login";
}

function applyAuthUIVisuals() {
    document.getElementById('auth-screen').style.display = 'none'; document.getElementById('app-container').style.display = 'flex';
    setTimeout(() => { if(map) map.invalidateSize(); }, 100); document.getElementById('userNameDisplay').innerText = appState.user.name; 
}

window.checkOnboardingFlow = function() {
    if(window.isSetupModalOpen) return;
    if(Object.keys(appState.gssNodes || {}).length === 0) {
        document.getElementById('onboarding-overlay').style.display = 'flex';
        document.getElementById('onboarding-title').innerText = "Network Setup Required";
        document.getElementById('onboarding-desc').innerText = "Please add your first GSS to begin mapping.";
        document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; window.isSetupModalOpen = true; window.openAddGssModal(); };
    } else if (Object.keys(appState.feeders || {}).length === 0) {
        document.getElementById('onboarding-overlay').style.display = 'flex';
        document.getElementById('onboarding-title').innerText = "Create Feeder";
        document.getElementById('onboarding-desc').innerText = "You must create a Feeder linked to your GSS to continue.";
        document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; window.isSetupModalOpen = true; window.openFeederConfigModal(); };
    } else { document.getElementById('onboarding-overlay').style.display = 'none'; renderEntireNetwork(); }
};

window.handleSupabaseAuth = async function(mode) {
    if(!supabaseClient) return alert("Network Error. Supabase not initialized.");
    const email = document.getElementById('authEmail').value.trim(), password = document.getElementById('authPassword').value.trim(), name = document.getElementById('authName').value.trim();
    if(!email || !password) return alert("Email and Password required"); showToast("Processing..."); let response;
    if (mode === 'signup') { if(!name) return alert("Enter Full Name"); response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } }); } else response = await supabaseClient.auth.signInWithPassword({ email, password });
    if (response.error) alert(response.error.message);
    else if (response.data.user) {
        appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
        appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
        applyAuthUIVisuals(); await pullFromSupabase(); showToast("Login Successful!");
    }
}
window.handleSupabaseLogout = async function() { if(supabaseClient) await supabaseClient.auth.signOut(); if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.clear(); location.reload(); }

window.openResetConfirmationModal = function() {
    window.toggleSidebar(false); window.closeSettingsPage();
    openModal(`<div class="sheet-head"><div class="sheet-title" style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Factory Reset</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <p style="font-size:0.9rem; color:var(--text-main); margin-bottom:15px; line-height:1.5;">This will permanently wipe all local database records, logs, and settings. This action cannot be undone.</p>
        <div class="form-row"><label>Type "RESET" to confirm</label><input type="text" id="inpResetConfirm" class="form-input" placeholder="Type RESET here"></div>
        <button class="btn-action-primary" style="background:#ef4444;" onclick="window.executeFactoryReset()">Erase All Data</button>`);
};
window.executeFactoryReset = async function() {
    const val = document.getElementById('inpResetConfirm').value;
    if(val !== 'RESET') return alert("Confirmation text does not match 'RESET'.");
    showToast("Erasing all data...");
    if(supabaseClient) await supabaseClient.auth.signOut();
    if(typeof localforage !== 'undefined') await localforage.clear();
    localStorage.clear(); setTimeout(() => location.reload(), 1000);
}

function centerMapOnGSS() {
    if(!map) return; map.invalidateSize();
    const net = getActiveNetwork(); if(!net) return;
    const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null;
    if (gss && typeof gss.lat === 'number' && !isNaN(gss.lat)) map.setView([gss.lat, gss.lng], 16, {animate: false});
}

window.liveTrackingId = null; window.liveUserMarker = null; window.isFirstLocationLock = true;
window.toggleLiveTracking = function() {
    if (!navigator.geolocation) return alert("Geolocation API not found.");
    if (window.liveTrackingId) {
        navigator.geolocation.clearWatch(window.liveTrackingId); window.liveTrackingId = null;
        if (window.liveUserMarker && map) { map.removeLayer(window.liveUserMarker); window.liveUserMarker = null; }
        document.getElementById('liveTrackBtn').style.color = '#ef4444'; showToast("Live tracking disabled.");
    } else {
        showToast("Fetching location..."); window.isFirstLocationLock = true; 
        window.liveTrackingId = navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude; if(!map) return;
            if (!window.liveUserMarker) {
                const humanIcon = L.divIcon({ className: 'live-human-icon', html: '🚶‍♂️', iconSize: [44,44] });
                window.liveUserMarker = L.marker([lat, lng], {icon: humanIcon, zIndexOffset: 1000}).addTo(map);
            } else window.liveUserMarker.setLatLng([lat, lng]);
            if (window.isFirstLocationLock) { map.setView([lat, lng], 18); window.isFirstLocationLock = false; }
            document.getElementById('liveTrackBtn').style.color = '#10b981';
        }, (err) => alert("GPS Error."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }
}

document.getElementById('formModalOverlay').addEventListener('click', function(e) { if(e.target === this) { window.closeModal(); } });
window.toggleSpeedDial = function(e) { if(e) { e.preventDefault(); e.stopPropagation(); } const dial = document.getElementById('speed-dial-menu'); const fab = document.getElementById('mainFabBtn'); if (!dial || !fab) return; const isOpen = !dial.classList.contains('active'); dial.classList.toggle('active', isOpen); fab.classList.toggle('open', isOpen); }
document.addEventListener('click', function(e) { const dial = document.getElementById('speed-dial-menu'); const fab = document.getElementById('mainFabBtn'); if (dial && dial.classList.contains('active')) { if (!dial.contains(e.target) && !fab.contains(e.target)) { dial.classList.remove('active'); fab.classList.remove('open'); } } });

window.currentSelectedObj = null;
window.closeObjectSheet = function() { document.getElementById('object-bottom-sheet').classList.remove('open'); window.currentSelectedObj = null; };
window.openObjectSheet = function(type, id, title, detailsHtml) {
    window.currentSelectedObj = { type, id };
    document.getElementById('objSheetTitle').innerText = title; document.getElementById('objSheetDetails').innerHTML = detailsHtml;
    const photoUrl = getPhotoUrl(id); const imgEl = document.getElementById('objPhotoImg'); const placeholderEl = document.getElementById('objPhotoPlaceholder');
    if(photoUrl) { imgEl.src = photoUrl; imgEl.style.display = 'block'; placeholderEl.style.display = 'none'; } else { imgEl.style.display = 'none'; imgEl.src = ''; placeholderEl.style.display = 'block'; }
    document.getElementById('object-bottom-sheet').classList.add('open');
    document.getElementById('btnObjEdit').onclick = () => window.openEditModal(type.toLowerCase(), id);
    document.getElementById('btnObjDelete').style.display = (type === 'GSS') ? 'none' : 'block';
    document.getElementById('btnObjMove').style.display = (type === 'DT') ? 'none' : 'block';
    document.getElementById('btnObjMove').onclick = () => window.startObjectMove(type, id, title);
    document.getElementById('btnObjDelete').onclick = () => { window.deleteEntity(type.toLowerCase(), id); window.closeObjectSheet(); };
};

// FIX 1: Object Move Logic
window.startObjectMove = function(type, id, title) {
    window.closeObjectSheet();
    appState.activeMove = { type: type, id: id };
    document.getElementById('center-placement-pin').style.display = 'block';
    document.getElementById('bottom-single-action').style.display = 'none';
    
    let moveBar = document.getElementById('move-confirm-bar');
    if(!moveBar) {
        moveBar = document.createElement('div'); moveBar.id = 'move-confirm-bar';
        moveBar.style.cssText = 'position:absolute; bottom:20px; left:50%; transform:translateX(-50%); z-index:4000; display:flex; gap:10px; width:90%; max-width:400px;';
        moveBar.innerHTML = `<button class="btn-danger-outline" style="background:white;" onclick="window.cancelMove()">Cancel</button>
                             <button class="btn-action-primary" style="margin-top:0;" onclick="window.confirmMove()">Confirm Move</button>`;
        document.getElementById('app-container').appendChild(moveBar);
    }
    moveBar.style.display = 'flex';
    renderEntireNetwork(); 
}
window.cancelMove = function() {
    appState.activeMove = null;
    document.getElementById('center-placement-pin').style.display = 'none';
    const moveBar = document.getElementById('move-confirm-bar'); if(moveBar) moveBar.style.display = 'none';
    document.getElementById('bottom-single-action').style.display = 'block';
    renderEntireNetwork();
}
window.confirmMove = function() {
    if(!appState.activeMove) return;
    const net = getActiveNetwork(); const center = map.getCenter();
    const { type, id } = appState.activeMove;
    
    let objList = null;
    if(type === 'POLE') objList = net.poles;
    else if(type === 'DT') objList = net.dts;
    else if(type === 'CONSUMER') objList = net.consumers;
    else if(type === 'GSS') { if(appState.gssNodes[id]) { appState.gssNodes[id].lat = center.lat; appState.gssNodes[id].lng = center.lng; } }
    
    if(objList) {
        const obj = objList.find(x => x.id === id);
        if(obj) { obj.lat = center.lat; obj.lng = center.lng; obj.synced = false; }
    }
    saveSnapshot(); triggerPersistence(); window.cancelMove(); showToast("Location Updated!");
}

window.captureTempPhoto = function() {
    if (typeof navigator.camera === 'undefined') return alert("Camera plugin not found.");
    navigator.camera.getPicture(function(imageData) {
        window.tempPhotoUrl = "data:image/jpeg;base64," + imageData;
        document.getElementById('formTempPhoto').src = window.tempPhotoUrl;
        document.getElementById('formTempPhoto').style.display = 'block';
    }, function(err) { showToast("Camera cancelled"); }, { quality: 50, destinationType: Camera.DestinationType.DATA_URL, sourceType: Camera.PictureSourceType.CAMERA, saveToPhotoAlbum: false });
};

window.captureObjectPhoto = function() {
    if (!window.currentSelectedObj || !appState.user.isLoggedIn) return;
    if (typeof navigator.camera === 'undefined') return alert("Camera plugin not installed.");
    navigator.camera.getPicture(function(imageData) {
        showToast("Saving photo...");
        const base64Data = "data:image/jpeg;base64," + imageData;
        if(!appState.photos) appState.photos = [];
        appState.photos = appState.photos.filter(x => x.object_id !== window.currentSelectedObj.id);
        appState.photos.push({ id: 'PH_' + Date.now(), object_type: window.currentSelectedObj.type, object_id: window.currentSelectedObj.id, photo_url: base64Data, synced: false });
        const imgEl = document.getElementById('objPhotoImg'); const placeholderEl = document.getElementById('objPhotoPlaceholder');
        imgEl.src = base64Data; imgEl.style.display = 'block'; placeholderEl.style.display = 'none';
        triggerPersistence();
    }, function(message) { alert('Camera cancelled or failed: ' + message); }, { quality: 50, destinationType: Camera.DestinationType.DATA_URL, sourceType: Camera.PictureSourceType.CAMERA, saveToPhotoAlbum: false });
};

/* ====== THICKER REFINED REAL-LIFE SVGS ====== */
const C_YELLOW = '#facc15'; const W_BASE = '#ffffff';

function getPoleSVG(type, config, isOrphan) {
    const fill = isOrphan ? '#ef4444' : C_YELLOW;
    if(type === 'TOWER') return `<svg viewBox="0 0 60 80" style="width:36px;height:54px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="#1e293b" stroke-width="8" stroke-linecap="round"/><path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><line x1="18" y1="40" x2="42" y2="40" stroke="#1e293b" stroke-width="5"/><line x1="12" y1="60" x2="48" y2="60" stroke="#1e293b" stroke-width="5"/><circle cx="30" cy="5" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    if(type === 'RAIL POLE') return `<svg viewBox="0 0 40 80" style="width:24px;height:54px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><rect x="12" y="10" width="16" height="65" fill="${fill}" stroke="#1e293b" stroke-width="4"/><line x1="5" y1="20" x2="35" y2="20" stroke="#1e293b" stroke-width="5"/><circle cx="12" cy="15" r="3" fill="#fff" stroke="#000" stroke-width="1.5"/><circle cx="28" cy="15" r="3" fill="#fff" stroke="#000" stroke-width="1.5"/></svg>`;
    if(type === 'PCC' && config === 'Double Pole') return `<svg viewBox="0 0 70 80" style="width:40px;height:54px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><line x1="20" y1="15" x2="20" y2="75" stroke="#1e293b" stroke-width="8"/><line x1="20" y1="15" x2="20" y2="75" stroke="${fill}" stroke-width="5"/><line x1="50" y1="15" x2="50" y2="75" stroke="#1e293b" stroke-width="8"/><line x1="50" y1="15" x2="50" y2="75" stroke="${fill}" stroke-width="5"/><line x1="10" y1="25" x2="60" y2="25" stroke="#1e293b" stroke-width="6"/><line x1="10" y1="45" x2="60" y2="45" stroke="#1e293b" stroke-width="5"/><circle cx="15" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="35" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="55" cy="18" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
    return `<svg viewBox="0 0 50 80" style="width:30px;height:54px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.8));"><line x1="25" y1="20" x2="25" y2="75" stroke="#1e293b" stroke-width="8" stroke-linecap="round"/><line x1="25" y1="20" x2="25" y2="75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><path d="M 8 15 L 25 25 L 42 15" fill="none" stroke="#1e293b" stroke-width="6" stroke-linejoin="round"/><circle cx="8" cy="10" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="42" cy="10" r="4" fill="#fff" stroke="#000" stroke-width="2"/><circle cx="25" cy="14" r="4" fill="#fff" stroke="#000" stroke-width="2"/></svg>`;
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
                // FIX 3: Bottom Anchor for Poles (Makes them planted, lines drawn here natively stay at bottom)
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: `pole-marker-icon ${poleClass} ${isOrphan ? 'orphan-pulse' : ''}`, html: `${svgHtml}<span>${displayNo}</span>`, iconSize: [40, 56], iconAnchor: [20, 50] }), zIndexOffset: 200 });
                m.on('click', () => { window.openObjectSheet('POLE', p.id, `Pole ${p.poleNo}`, `Type: <b>${p.lineType || 'HT'}</b><br>Config: <b>${p.poleType || 'Standard'} ${p.poleConfig&&p.poleConfig!=='N/A'?'('+p.poleConfig+')':''}</b><br>Condition: <b>${p.condition||'Good'}</b><br>Parent: <b>${p.dtCode || 'Feeder'}</b>`); }); 
                featureGroups.poles.addLayer(m);
            });
        }
        if (f.dts) {
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => x.poleNo == d.parentPole); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng && !isNaN(d.lat)) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); const svgHtml = getDTSVG(d.phase, d.rating);
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: `dt-square-icon ${isOrphan ? 'orphan-pulse' : ''}`, html: svgHtml, iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 400 });
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

function saveSnapshot() { const net = getActiveNetwork(); if(!net) return; historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers }))); if (historyStack.length > 15) historyStack.shift(); }
window.undoLastAction = function() { if (historyStack.length === 0) return showToast("No actions to Undo!"); const prevState = historyStack.pop(), net = getActiveNetwork(); if(!net) return; net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers; renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺"); }

window.openFilterModal = function() {
    const f = appState.filters;
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-filter" style="color:#d97706;"></i> Object Filter</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="capsule-filter-group">
            <label class="capsule"><input type="checkbox" id="flt11" ${f.lines11?'checked':''}><span>11 KV Line</span></label>
            <label class="capsule"><input type="checkbox" id="fltLT" ${f.linesLT?'checked':''}><span>LT Line</span></label>
            <label class="capsule"><input type="checkbox" id="fltPoles" ${f.poles?'checked':''}><span>Poles</span></label>
            <label class="capsule"><input type="checkbox" id="fltDTs" ${f.dts?'checked':''}><span>DT</span></label>
            <label class="capsule"><input type="checkbox" id="fltCons" ${f.consumers?'checked':''}><span>Consumers</span></label>
        </div>
        <button class="btn-action-primary" onclick="window.saveFilters()" style="margin-top:20px;">Apply Filters</button>`);
}
window.saveFilters = function() { appState.filters.lines11 = document.getElementById('flt11').checked; appState.filters.linesLT = document.getElementById('fltLT').checked; appState.filters.poles = document.getElementById('fltPoles').checked; appState.filters.dts = document.getElementById('fltDTs').checked; appState.filters.consumers = document.getElementById('fltCons').checked; window.closeModal(); renderEntireNetwork(); showToast("Filters Updated"); }

window.toggleSidebar = function(open) { document.getElementById('sidebar-drawer').classList.toggle('open', open); document.getElementById('sidebarBackdrop').classList.toggle('open', open); if(open) { window.renderGssSidebarList(); window.renderFeederSidebarList(); } }

window.openModal = function(html) { document.getElementById('modalSheetContent').innerHTML = html; document.getElementById('formModalOverlay').classList.add('open'); window.tempPhotoUrl = null; }
window.closeModal = function() { document.getElementById('formModalOverlay').classList.remove('open'); window.isSetupModalOpen = false; document.getElementById('live-distance-indicator').style.display='none'; if(appState.user && appState.user.isLoggedIn) { setTimeout(window.checkOnboardingFlow, 400); } }

window.autoSaveSettings = function() { appState.settings.unit = document.getElementById('setUnit').value; appState.settings.language = document.getElementById('setLanguage').value; appState.settings.theme = document.getElementById('setTheme').value; appState.settings.liveSync = document.getElementById('setLiveSync').checked; applyTranslations(); applyTheme(); triggerPersistence(); renderEntireNetwork(); showToast("Settings Saved!"); }
window.openSettingsPage = function() { window.toggleSidebar(false); document.getElementById('setUnit').value = appState.settings.unit || 'm'; document.getElementById('setLanguage').value = appState.settings.language || 'en'; document.getElementById('setTheme').value = appState.settings.theme || 'light'; document.getElementById('setLiveSync').checked = appState.settings.liveSync !== false; document.getElementById('settings-page').classList.add('open'); }
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }

window.calcDistance = function(lat1, lon1, lat2, lon2) { const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }

function getNodeCoords(nodeId) { 
    const net = getActiveNetwork(); if(!net) return null; const idStr = String(nodeId);
    if (idStr.startsWith('GSS_')) { const code = idStr.replace('GSS_', ''); if (appState.gssNodes[code]) return { lat: appState.gssNodes[code].lat, lng: appState.gssNodes[code].lng }; }
    if (idStr.startsWith('DT_')) { const code = idStr.replace('DT_', ''); const d = net.dts.find(x => String(x.code) === code); if (d) return { lat: d.lat, lng: d.lng }; }
    if (idStr.startsWith('POLE_')) { const code = idStr.replace('POLE_', ''); const p = net.poles.find(x => String(x.poleNo) === code); if (p) return { lat: p.lat, lng: p.lng }; }
    const p = net.poles.find(x => String(x.poleNo) === idStr); if (p) return { lat: p.lat, lng: p.lng };
    const d = net.dts.find(x => String(x.code) === idStr); if (d) return { lat: d.lat, lng: d.lng };
    if (appState.gssNodes[idStr]) return { lat: appState.gssNodes[idStr].lat, lng: appState.gssNodes[idStr].lng };
    if (idStr === 'GSS' || idStr === net.feeder.code) { const g = appState.gssNodes[net.feeder.parentGss]; if(g) return { lat: g.lat, lng: g.lng }; }
    return null; 
}

window.runOrphanNodeChecker = function() {
    updateOrphanStatus(); const net = getActiveNetwork(); if(!net) return; const orphanCount = appState.orphanPoleIds.size;
    if (orphanCount === 0) return showToast("No orphan poles or nodes found! Network is fully connected.");
    let html = `<div class="sheet-head"><div class="sheet-title" style="color:#d97706;"><i class="fa-solid fa-network-wired"></i> Orphan Nodes Found (${orphanCount})</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>`;
    html += `<div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">`;
    net.poles.forEach(p => { if (appState.orphanPoleIds.has(p.id)) { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#fef3c7; padding:10px; border-radius:8px;"><div><b>Pole: ${p.poleNo}</b><br><small>Type: ${p.lineType || 'HT'}</small></div><button class="action-btn-sm bg" onclick="window.zoomToEntity('${p.lat}', '${p.lng}')">Zoom</button></div>`; } }); html += `</div>`; openModal(html);
};
window.zoomToEntity = function(lat, lng) { window.closeModal(); map.flyTo([parseFloat(lat), parseFloat(lng)], 19, { duration: 1 }); };

window.toggleGssFolder = function() { const content = document.getElementById('gssFolderContent'), icon = document.getElementById('gssFolderIcon'); if (!content || !icon) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderGssSidebarList(); };
window.toggleFeederFolder = function() { const content = document.getElementById('feederFolderContent'), icon = document.getElementById('feederFolderIcon'); if (!content || !icon) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderFeederSidebarList(); };

window.renderGssSidebarList = function() {
    const container = document.getElementById('gssListContainer'); if (!container) return; let html = '';
    Object.values(appState.gssNodes).forEach(gss => { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-glass); padding:8px; border-radius:6px; margin-top:6px; border:1px solid var(--border);"><div><b style="font-size:0.85rem;">${gss.name}</b><br><small style="color:var(--text-sub);">Code: ${gss.code}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="window.relocateGss('${gss.code}')" title="Relocate GSS"><i class="fa-solid fa-location-crosshairs"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="window.deleteGssAndFeederStrict('${gss.code}')" title="Strict Delete"><i class="fa-solid fa-trash"></i></button></div></div>`; }); container.innerHTML = html;
};

window.renderFeederSidebarList = function() {
    const container = document.getElementById('feederListContainer'); if (!container) return; let html = '';
    Object.keys(appState.feeders).forEach(fCode => {
        const f = appState.feeders[fCode].feeder; const isActive = appState.currentFeederCode === fCode;
        const bgClass = isActive ? 'background:rgba(37,99,235,0.1); border-left:4px solid var(--accent);' : 'background:var(--bg-glass); border:1px solid var(--border);';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-radius:6px; margin-top:6px; ${bgClass}" onclick="window.switchFeeder('${fCode}')">
            <div style="cursor:pointer; width: 100%;"><b style="font-size:0.85rem; color:var(--text-main);">${f.name}</b><br><small style="color:var(--text-sub);">GSS: ${f.parentGss}</small></div>
            <div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="event.stopPropagation(); window.openEditFeederModal('${fCode}')"><i class="fa-solid fa-pen"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="event.stopPropagation(); window.deleteFeederStrict('${fCode}')"><i class="fa-solid fa-trash"></i></button></div>
        </div>`;
    }); container.innerHTML = html;
};

window.openFeederConfigModal = function() {
    window.toggleSidebar(false); const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}">${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title">Add Feeder</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="form-row"><label>Select GSS*</label><select id="inpFeederGss" class="form-select">${gssOpts}</select></div>
        <div class="form-row"><label>Feeder Code*</label><input type="text" id="inpFeederCode" class="form-input" placeholder="e.g. F-01"></div>
        <div class="form-row"><label>Feeder Name*</label><input type="text" id="inpFeederName" class="form-input" placeholder="e.g. 11 kV Main Feeder"></div>
        <button class="btn-action-primary" onclick="window.saveNewFeeder()">Save Feeder</button>`);
};
window.saveNewFeeder = function() { const gss = document.getElementById('inpFeederGss').value; const code = document.getElementById('inpFeederCode').value.trim(); const name = document.getElementById('inpFeederName').value.trim(); if(!gss || !code || !name) return alert("All fields are required"); if(appState.feeders[code]) return alert("Feeder code already exists"); appState.feeders[code] = { feeder: { name: name, code: code, subdivCode: "SD-01", parentGss: gss }, poles: [], dts: [], lines: [], consumers: [] }; appState.currentFeederCode = code; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Feeder Added!"); };

window.openEditFeederModal = function(code) {
    window.toggleSidebar(false); openModal(`<div class="sheet-head"><div class="sheet-title">Edit Feeder Name</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="form-row"><label>Feeder Code (Locked)</label><input type="text" class="form-input" value="${code}" disabled></div>
        <div class="form-row"><label>New Name*</label><input type="text" id="editFeederName" class="form-input" value="${appState.feeders[code].feeder.name}"></div>
        <button class="btn-action-primary" onclick="window.saveEditedFeeder('${code}')">Save Changes</button>`);
}
window.saveEditedFeeder = function(code) { const newName = document.getElementById('editFeederName').value.trim(); if(!newName) return alert("Enter new name"); if(appState.feeders[code]) { appState.feeders[code].feeder.name = newName; triggerPersistence(); window.closeModal(); renderEntireNetwork(); showToast("Feeder Updated!"); } }

window.deleteFeederStrict = function(code) { 
    if(!confirm(`WARNING: Deleting Feeder ${code} will destroy all data inside it. Continue?`)) return; 
    if (appState.feeders[code]) {
        const f = appState.feeders[code];
        const ids = [...f.poles, ...f.lines, ...f.dts, ...f.consumers].map(x=>x.id);
        if(!appState.deletedObjectIds) appState.deletedObjectIds = [];
        appState.deletedObjectIds.push(...ids);
        if(!appState.deletedFeederCodes) appState.deletedFeederCodes = [];
        appState.deletedFeederCodes.push(code);
    }
    delete appState.feeders[code]; 
    if(appState.currentFeederCode === code) { const remaining = Object.keys(appState.feeders); appState.currentFeederCode = remaining.length > 0 ? remaining[0] : null; } window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Feeder Deleted!"); window.checkOnboardingFlow(); 
}
window.deleteGssAndFeederStrict = function(code) { 
    const conf1 = confirm(`WARNING: You are about to delete GSS ${code} and ALL its associated feeders! This cannot be undone. Continue?`); if (!conf1) return; const conf2 = prompt(`Type GSS code "${code}" to confirm:`); if (conf2 !== code) return alert("Cancelled"); saveSnapshot(); 
    if (appState.gssNodes[code]) delete appState.gssNodes[code]; 
    const feedersToDelete = []; Object.keys(appState.feeders).forEach(fCode => { if (appState.feeders[fCode].feeder.parentGss === code) feedersToDelete.push(fCode); }); 
    feedersToDelete.forEach(fCode => window.deleteFeederStrict(fCode)); 
    renderEntireNetwork(); triggerPersistence(); window.renderGssSidebarList(); showToast("Deleted completely!"); window.checkOnboardingFlow(); 
}

window.openAddGssModal = function() { window.toggleSidebar(false); openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> Add New GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>GSS Code*</label><input type="text" id="inpGssCode" class="form-input" placeholder="e.g. 132"></div><div class="form-row"><label>GSS Name*</label><input type="text" id="inpGssName" class="form-input" placeholder="e.g. 132/33 kV Substation"></div><button class="btn-action-primary" onclick="window.saveNewGss()">Save GSS at Map Center</button>`); };
window.saveNewGss = function() { const code = document.getElementById('inpGssCode').value.trim(), name = document.getElementById('inpGssName').value.trim(); if (!code || !name) return alert("Enter GSS Code and Name"); if (appState.gssNodes[code]) return alert("GSS Code already exists!"); const center = map.getCenter(); appState.gssNodes[code] = { code, name, lat: parseFloat(center.lat.toFixed(6)), lng: parseFloat(center.lng.toFixed(6)) }; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("New GSS added successfully!"); window.checkOnboardingFlow(); };
window.relocateGss = function(gssCode) { window.closeObjectSheet(); window.toggleSidebar(false); window.startObjectMove('GSS', gssCode, `GSS (${gssCode})`); };

function updateOrphanStatus() {
    appState.orphanPoleIds.clear(); const net = getActiveNetwork(); if(!net) return; 
    const adj = {}, gssCode = net.feeder.parentGss, gssId = 'GSS_' + gssCode; adj[gssId] = [];
    net.poles.forEach(p => adj['POLE_' + p.poleNo] = []); net.dts.forEach(d => adj['DT_' + d.code] = []);
    net.dts.forEach(d => { if(d.parentPole) { const pId = 'POLE_' + d.parentPole; if (!adj[pId]) adj[pId] = []; adj[pId].push('DT_' + d.code); adj['DT_' + d.code].push(pId); } });
    net.lines.forEach(l => { const u = String(l.fromNode), v = String(l.toNode); if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
    const visited = new Set([gssId]), queue = [gssId];
    while (queue.length > 0) { const curr = queue.shift(); (adj[curr] || []).forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } }); }
    net.poles.forEach(p => { if (!visited.has('POLE_' + p.poleNo)) appState.orphanPoleIds.add(p.id); });
    net.dts.forEach(d => { if (!visited.has('DT_' + d.code)) appState.orphanPoleIds.add(d.id); });
}

// FIX 5: Dynamic Top Layer Search Toggle
window.toggleSearchBox = function() {
    let box = document.getElementById('searchBoxOverlay');
    if(!box) {
        box = document.createElement('div'); box.id = 'searchBoxOverlay';
        box.style.cssText = 'position:absolute; top:65px; left:12px; right:12px; z-index:9000; background:var(--bg-glass); backdrop-filter:blur(10px); padding:10px; border-radius:12px; box-shadow:var(--shadow-md); display:flex; flex-direction:column; gap:10px; border:1px solid var(--border);';
        box.innerHTML = `
            <div style="display:flex; gap:10px; align-items:center;">
                <input type="text" id="appSearchBar" class="search-input-full" placeholder="Search Consumer, DT, Pole..." onkeyup="window.handleSearch(event)">
                <button class="action-btn-sm" onclick="window.toggleSearchBox()"><i class="fa-solid fa-times"></i></button>
            </div>
            <div id="searchSuggestions" class="suggestions-panel" style="position:relative; box-shadow:none; border:none; top:0;"></div>
        `;
        document.getElementById('app-container').appendChild(box);
    } else {
        box.style.display = box.style.display === 'none' ? 'flex' : 'none';
        if(box.style.display === 'none') window.clearSearch();
    }
    if(box.style.display === 'flex') { document.getElementById('appSearchBar').focus(); applyTranslations(); }
}

window.handleSearch = function(e) {
    const query = e.target.value.toLowerCase().trim(), suggPanel = document.getElementById('searchSuggestions');
    if(query.length === 0) { suggPanel.classList.remove('active'); return; }
    const net = getActiveNetwork(); if(!net) return; let results = [];
    net.consumers.forEach(c => { if (String(c.kno).toLowerCase().includes(query) || (c.name && c.name.toLowerCase().includes(query))) results.push({ type: 'CONSUMER', id: c.id, title: c.name, desc: `K-No: ${c.kno} | Connected to: ${c.parentRef}` }); });
    net.dts.forEach(d => { if (String(d.code).toLowerCase().includes(query) || String(d.rating).includes(query) || (d.location && d.location.toLowerCase().includes(query))) results.push({ type: 'DT', id: d.id, title: `DT Code: ${d.code}`, desc: `Rating: ${d.rating} kVA | Loc: ${d.location || 'N/A'}` }); });
    net.poles.forEach(p => { if (String(p.poleNo).toLowerCase().includes(query)) results.push({ type: 'POLE', id: p.id, title: `Pole: ${p.poleNo}`, desc: `Type: ${p.lineType} | ${p.poleType}` }); });
    if (results.length > 0) {
        suggPanel.innerHTML = results.slice(0, 15).map(r => `<div class="suggestion-item" onclick="window.selectSearchResult('${r.type}', '${r.id}')"><div class="sugg-title"><span style="color:var(--accent); font-weight:800;">${r.title}</span></div><div class="sugg-desc" style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">${r.desc}</div></div>`).join('');
        suggPanel.classList.add('active');
    } else { suggPanel.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#64748b;">No results found</div>`; suggPanel.classList.add('active'); }
}
window.clearSearch = function() { const bar = document.getElementById('appSearchBar'); if(bar) bar.value = ''; const sugg = document.getElementById('searchSuggestions'); if(sugg) sugg.classList.remove('active'); }
window.selectSearchResult = function(type, id) {
    const net = getActiveNetwork(); if(!net) return; window.clearSearch(); window.toggleSearchBox(); let target = null, popupHtml = '';
    if(type === 'CONSUMER') { target = net.consumers.find(c => c.id === id); if(target) popupHtml = `K-No: <b>${target.kno}</b><br>Connected to: <b>${target.parentRef}</b>`; } 
    else if(type === 'DT') { target = net.dts.find(d => d.id === id); if(target) popupHtml = `Rating: <b>${target.rating} kVA</b><br>Loc: <b>${target.location || 'N/A'}</b>`; }
    else if(type === 'POLE') { target = net.poles.find(p => p.id === id); if(target) popupHtml = `Type: <b>${target.lineType}</b><br>Condition: <b>${target.condition || 'Good'}</b>`; }
    if(target && target.lat) { map.flyTo([target.lat, target.lng], 19, { duration: 1 }); setTimeout(() => { window.openObjectSheet(type, id, type === 'CONSUMER' ? target.name : (type === 'DT' ? `DT: ${target.code}` : `Pole: ${target.poleNo}`), popupHtml); }, 1000); }
}

/* ====== ADD FORMS (RESTORED COMPLETELY) ====== */
const getCameraFormHtml = () => `
    <div style="margin-top:15px; margin-bottom:5px; padding:10px; background:var(--bg-glass); border-radius:12px; border:1px dashed var(--border); text-align:center;">
        <img id="formTempPhoto" src="" style="width:100%; height:120px; object-fit:cover; border-radius:8px; display:none; margin-bottom:8px;">
        <button type="button" class="btn-action-primary" style="padding:10px; width:100%; background:#0f172a; margin:0;" onclick="window.captureTempPhoto()">
            <i class="fa-solid fa-camera"></i> Capture Photo
        </button>
    </div>
`;

window.openAddForm = function(type) { window.toggleSpeedDial(false); if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { appState.placementType = type; document.getElementById('center-placement-pin').style.display = 'block'; document.getElementById('bottom-single-action').style.display = 'none'; const confirmBar = document.getElementById('placement-confirm-bar'); if(confirmBar) confirmBar.style.display = 'flex'; } else window.showFormModal(type, null, null); }

window.confirmPlacement = function() { document.getElementById('center-placement-pin').style.display = 'none'; const distInd = document.getElementById('live-distance-indicator'); if(distInd) distInd.style.display='none'; const confirmBar = document.getElementById('placement-confirm-bar'); if(confirmBar) confirmBar.style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; const center = map.getCenter(); window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6))); }

window.cancelPlacement = function() { document.getElementById('center-placement-pin').style.display = 'none'; const distInd = document.getElementById('live-distance-indicator'); if(distInd) distInd.style.display='none'; const confirmBar = document.getElementById('placement-confirm-bar'); if(confirmBar) confirmBar.style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; }

window.togglePccConfig = function(id = 'inpMainPoleType', targetId = 'pccConfigDiv') { const pType = document.getElementById(id).value; const configDiv = document.getElementById(targetId); if(pType === 'PCC') configDiv.style.display = 'block'; else configDiv.style.display = 'none'; };

window.toggleLineConductor = function(id = 'inpLineType', targetId = 'inpConductor') { 
    const lType = document.getElementById(id).value; const sel = document.getElementById(targetId); 
    if(lType === '11 KV LINE') {
        sel.innerHTML = `<option value="Weasel">Weasel</option><option value="Rabbit">Rabbit</option><option value="Dog">Dog</option><option value="Underground Cable">Underground Cable</option>`; 
        if(document.getElementById('linePhaseRow')) document.getElementById('linePhaseRow').style.display = 'block'; 
    } else {
        sel.innerHTML = `<option value="Single Phase">Single Phase</option><option value="Three Phase">Three Phase</option>`; 
        if(document.getElementById('linePhaseRow')) document.getElementById('linePhaseRow').style.display = 'none'; 
    }
};

window.showFormModal = function(type, snapLat, snapLng) {
    const net = getActiveNetwork(); if(!net) return; 
    let center = { lat: 26.91, lng: 75.78 }; if(map) center = map.getCenter();
    snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6));
    window.tempPhotoUrl = null;

    if (type === 'POLE' || type === 'LTPOLE') {
        const isHT = type === 'POLE';
        let dtSelectHtml = ''; let nextNo = '';
        if(isHT) { let maxHtNo = 0; net.poles.filter(p => p.lineType !== 'LT').forEach(p => { const num = parseInt(p.poleNo); if(!isNaN(num) && num > maxHtNo) maxHtNo = num; }); nextNo = maxHtNo + 1; } 
        else {
            if (net.dts.length === 0) return alert("Add a DT first!");
            let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
            dtSelectHtml = `<div class="form-row"><label>Associated DT*</label><select id="inpLTPoleDT" class="form-select">${sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id.replace('DT_','')} (${window.getDistStr(d.lat, d.lng)})</option>`).join('')}</select></div>`;
        }
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Add ${isHT?'HT':'LT'} Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            ${dtSelectHtml}
            ${isHT ? `<div class="form-row"><label>Pole Number*</label><input type="number" id="inpPoleNo" class="form-input" value="${nextNo}"></div>` : ''}
            <div class="form-grid-2">
                <div class="form-row"><label>Pole Type*</label><select id="inpMainPoleType" class="form-select" onchange="window.togglePccConfig('inpMainPoleType', 'pccConfigDiv')"><option value="PCC" selected>PCC</option><option value="TOWER">TOWER</option><option value="RAIL POLE">RAIL POLE</option></select></div>
                <div class="form-row"><label>Condition</label><select id="inpPoleCondition" class="form-select"><option value="Good" selected>Good</option><option value="Tilted">Tilted</option><option value="Damaged">Damaged</option></select></div>
            </div>
            <div class="form-row" id="pccConfigDiv" style="display:block;"><label>PCC Configuration</label><select id="inpPccConfig" class="form-select"><option value="Single Pole" selected>Single Pole</option><option value="Double Pole">Double Pole</option></select></div>
            <input type="hidden" id="inpPoleCategory" value="${isHT?'HT':'LT'}"><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}">
            ${getCameraFormHtml()}
            <button class="btn-action-primary" onclick="${isHT?'window.saveNewPole()':'window.saveNewLTPole()'}">Save Pole</button>`);
    } else if (type === 'LINE') {
        if (net.poles.length === 0) return alert("Add at least one pole first!");
        window.filterLineNodes = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), dtSelectorBox = document.getElementById('ltLineDTSelector');
            let nodes = [];
            if (type.includes('LT')) {
                dtSelectorBox.style.display = 'block'; const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? targetDTElem.value : ''; 
                if(!selectedDT) { fromSel.innerHTML=''; document.getElementById('inpToNode').innerHTML=''; return; }
                const cleanDT = selectedDT.replace('DT_', '');
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(cleanDT)).map(p => ({id: 'POLE_' + p.poleNo, title: 'LT Pole: '+p.poleNo, lat: p.lat, lng: p.lng}));
                const dtObj = net.dts.find(d => String(d.code) === String(cleanDT)); if(dtObj) nodes.push({id: 'DT_'+cleanDT, title: 'DT: '+cleanDT, lat: dtObj.lat, lng: dtObj.lng});
            } else {
                dtSelectorBox.style.display = 'none'; nodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_' + p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng}));
                const parentGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; 
                if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, map.getCenter().lat, map.getCenter().lng); let defaultFrom = nodes.length > 0 ? nodes[0].id : '';
            fromSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title} (${window.getDistStr(n.lat, n.lng)})</option>`).join(''); window.syncLineToSelect(); window.toggleLineConductor('inpLineType', 'inpConductor');
        };
        window.syncLineToSelect = function() {
            const type = document.getElementById('inpLineType').value, fromVal = document.getElementById('inpFromNode').value, toSel = document.getElementById('inpToNode'); let nodes = [];
            if (type.includes('LT')) {
                const selectedDT = document.getElementById('inpTargetDT') ? String(document.getElementById('inpTargetDT').value) : '';
                const cleanDT = selectedDT.replace('DT_', '');
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === cleanDT).map(p => ({id: 'POLE_' + p.poleNo, title: 'LT Pole: '+p.poleNo, lat: p.lat, lng: p.lng}));
                if(cleanDT) { const dtObj = net.dts.find(d => String(d.code) === cleanDT); if(dtObj) nodes.push({id: 'DT_'+cleanDT, title: 'DT: '+cleanDT, lat: dtObj.lat, lng: dtObj.lng}); }
            } else {
                nodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_' + p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng}));
                const parentGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; 
                if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = nodes.filter(n => n.id !== fromVal);
            nodes = window.sortByDistance(nodes, map.getCenter().lat, map.getCenter().lng); toSel.innerHTML = nodes.map(n => `<option value="${n.id}">${n.title} (${window.getDistStr(n.lat, n.lng)})</option>`).join(''); 
        };
        const htNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, lat: p.lat, lng: p.lng}));
        const feederGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; 
        if(feederGss) htNodes.push({id: 'GSS_'+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        let sortedHT = window.sortByDistance(htNodes, snapLat, snapLng); let initialDefaultFrom = sortedHT.length > 0 ? sortedHT[0].id : '';

        openModal(`<div class="sheet-head"><div class="sheet-title">Add Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-grid-2">
                <div class="form-row"><label>Voltage Type*</label><select id="inpLineType" class="form-select" onchange="window.filterLineNodes(); window.toggleLineConductor('inpLineType', 'inpConductor');"><option value="11 KV LINE" selected>11 KV (HT)</option><option value="LT LINE">LT Line</option></select></div>
                <div class="form-row" id="linePhaseRow"><label>Phase Type (HT)*</label><select id="inpLinePhase" class="form-select"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select></div>
            </div>
            <div class="form-row"><label>Conductor*</label><select id="inpConductor" class="form-select"></select></div>
            <div id="ltLineDTSelector" style="display:none; background:var(--bg-glass); padding:8px; border-radius:8px; margin-bottom:12px;"><label>Select DT for LT Route*</label><select id="inpTargetDT" class="form-select" onchange="window.filterLineNodes()"></select></div>
            <div class="form-grid-2"><div class="form-row"><label>From Node*</label><select id="inpFromNode" class="form-select" onchange="window.syncLineToSelect()"></select></div><div class="form-row"><label>To Node*</label><select id="inpToNode" class="form-select"></select></div></div>
            ${getCameraFormHtml()}
            <button class="btn-action-primary" onclick="window.saveNewLine()">Save Line</button>`);
        setTimeout(() => { let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: 'DT_'+d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); document.getElementById('inpTargetDT').innerHTML = sortedDTs.map(d => `<option value="${d.id}">${d.id.replace('_', ': ')}</option>`).join(''); window.filterLineNodes(); window.toggleLineConductor('inpLineType', 'inpConductor'); }, 30);
    } else if (type === 'DT') {
        let parentNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng})); 
        const feederGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; 
        if(feederGss) parentNodes.push({id: 'GSS_'+feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}">${p.title} (${window.getDistStr(p.lat, p.lng)})</option>`).join('');
        openModal(`<div class="sheet-head"><div class="sheet-title">Add DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Connected To (HT Node)*</label><select id="inpDTParent" class="form-select">${parentOpts}</select></div>
            <div class="form-row"><label>Mounted On (Structure)*</label><select id="inpDTMounted" class="form-select"><option value="Double Pole (DP)" selected>Double Pole (DP)</option><option value="Single Pole (SP)">Single Pole (SP)</option><option value="Plinth">Plinth</option></select></div>
            <div class="form-grid-2"><div class="form-row"><label>DT Code*</label><input type="number" id="inpDTCode" class="form-input" value="${Math.floor(Math.random()*9000)}"></div><div class="form-row"><label>Phase*</label><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating')"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select></div></div><div class="form-row"><label>Rating (kVA)*</label><select id="inpDTRating" class="form-select"></select></div><div class="form-row"><label>Location / Landmark</label><input type="text" id="inpDTLocation" class="form-input" placeholder="e.g. Near Main Market"></div>
            ${getCameraFormHtml()}
            <button class="btn-action-primary" onclick="window.saveNewDT()">Save DT</button>`);
        setTimeout(() => window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating'), 30);
    } else if (type === 'CONSUMER') {
        if (net.dts.length === 0) return alert("Must have at least one DT!"); let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: 'DT_'+d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); const dtOpts = sortedDTs.map(d => `<option value="${d.id}">${d.id.replace('_', ': ')} (${window.getDistStr(d.lat, d.lng)})</option>`).join('');
        openModal(`<div class="sheet-head"><div class="sheet-title">Add Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-grid-2"><div class="form-row"><label>Parent DT*</label><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()">${dtOpts}</select></div><div class="form-row"><label>Connects To*</label><select id="inpConsParent" class="form-select"></select></div></div>
            <div class="form-grid-2"><div class="form-row"><label>Status</label><select id="inpConsStatus" class="form-select"><option value="Regular" selected>Regular</option><option value="DC">DC</option><option value="PDC">PDC</option></select></div><div class="form-row"><label>Type</label><select id="inpConsType" class="form-select"><option value="Domestic" selected>Domestic</option><option value="NonDomestic">NonDomestic</option><option value="Agriculture">Agriculture</option><option value="Govt.">Govt.</option><option value="SIP MIP">SIP MIP</option><option value="Other">Other</option></select></div></div>
            <div class="form-grid-2"><div class="form-row"><label>K-Number*</label><input type="number" id="inpConsKno" class="form-input"></div><div class="form-row"><label>Load</label><input type="text" id="inpConsLoad" class="form-input" value="1 kW"></div></div><div class="form-row"><label>Consumer Name*</label><input type="text" id="inpConsName" class="form-input"></div><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}">
            ${getCameraFormHtml()}
            <button class="btn-action-primary" onclick="window.saveNewConsumer()">Save Consumer</button>`);
        setTimeout(() => window.filterConsumerPoles(), 30);
    }
}

window.saveNewPole = function() { 
    try {
        const no = document.getElementById('inpPoleNo').value.trim();
        const category = document.getElementById('inpPoleCategory').value;
        const lat = parseFloat(document.getElementById('inpLat').value);
        const lng = parseFloat(document.getElementById('inpLng').value); 
        const pType = document.getElementById('inpMainPoleType').value; 
        const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; 
        const condition = document.getElementById('inpPoleCondition').value;
        
        if (!no) return alert("Enter pole number"); 
        const net = getActiveNetwork(); 
        if(!net) return alert("No active network!");
        if (net.poles.some(p => String(p.poleNo) === no)) return alert(`Pole exists!`); 
        
        saveSnapshot(); 
        const objId = 'P_'+Date.now();
        net.poles.push({ id: objId, poleNo: no, lineType: category, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng, synced: false }); 
        
        attachTempPhoto('POLE', objId);
        window.closeModal(); 
        renderEntireNetwork(); 
        triggerPersistence(); 
        showToast("HT Pole added!");
    } catch(err) { console.error(err); alert("Error saving pole: " + err.message); }
}

window.saveNewLTPole = function() {
    try {
        const dtCodeRaw = document.getElementById('inpLTPoleDT').value; 
        const dtCode = dtCodeRaw.replace('DT_', ''); 
        const category = document.getElementById('inpPoleCategory').value;
        const lat = parseFloat(document.getElementById('inpLat').value);
        const lng = parseFloat(document.getElementById('inpLng').value); 
        const pType = document.getElementById('inpMainPoleType').value; 
        const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; 
        const condition = document.getElementById('inpPoleCondition').value;
        
        if (!dtCode) return alert("Select DT"); 
        const net = getActiveNetwork(); 
        if(!net) return alert("No active network!");
        
        const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); 
        let maxId = 0; 
        existingLTPoles.forEach(ep => { const parts = String(ep.poleNo).split('-'); if (parts.length > 1) { const num = parseInt(parts[parts.length - 1]); if (!isNaN(num) && num > maxId) maxId = num; } }); 
        const finalPoleNo = `${dtCode}-${maxId + 1}`;
        if (net.poles.some(p => String(p.poleNo) === String(finalPoleNo))) return alert(`Pole ${finalPoleNo} exists!`); 
        
        saveSnapshot(); 
        const objId = 'P_'+Date.now();
        net.poles.push({ id: objId, poleNo: finalPoleNo, lineType: category, dtCode: dtCode, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng, synced: false }); 
        
        attachTempPhoto('POLE', objId);
        window.closeModal(); 
        renderEntireNetwork(); 
        triggerPersistence(); 
        showToast("LT Pole added!");
    } catch(err) { console.error(err); alert("Error saving LT pole: " + err.message); }
}

window.saveNewLine = function() { 
    try {
        const from = document.getElementById('inpFromNode').value;
        const to = document.getElementById('inpToNode').value;
        const type = document.getElementById('inpLineType').value;
        const conductor = document.getElementById('inpConductor').value; 
        const phase = type === '11 KV LINE' ? document.getElementById('inpLinePhase').value : 'N/A';
        
        if (!from || !to) return alert("Please select both From and To nodes!"); 
        if (from === to) return alert("Cannot connect node to itself!");
        const net = getActiveNetwork(); 
        if(!net) return alert("No active network!");
        
        const spec = getLineSpec(type, phase, conductor);
        const existingLine = net.lines.find(l => (l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from));
        if(existingLine) return alert("Line already exists!");
        
        const c1 = getNodeCoords(from);
        const c2 = getNodeCoords(to); 
        if(!c1 || !c2 || isNaN(c1.lat) || isNaN(c2.lat)) return alert("Invalid node coordinates! Check map placements."); 
        
        saveSnapshot(); 
        const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); 
        const objId = 'LN_'+Date.now();
        net.lines.push({ id: objId, type: spec.name, conductor: conductor, phase: phase, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]], synced: false }); 
        
        attachTempPhoto('LINE', objId);
        window.closeModal(); 
        renderEntireNetwork(); 
        triggerPersistence(); 
        showToast("Line added!");
    } catch(err) { console.error(err); alert("Error saving line: " + err.message); }
}

window.saveNewDT = function() { 
    try {
        const parentRef = document.getElementById('inpDTParent').value; 
        const code = document.getElementById('inpDTCode').value.trim();
        const mountedOn = document.getElementById('inpDTMounted').value;
        const rating = parseFloat(document.getElementById('inpDTRating').value);
        const phase = document.getElementById('inpDTPhase').value;
        const location = document.getElementById('inpDTLocation').value.trim();
        
        if (!code) return alert("Enter DT Code"); 
        const net = getActiveNetwork();
        if(!net) return alert("No active network!");
        
        let rawParentRef = parentRef;
        if(parentRef.startsWith('POLE_')) rawParentRef = parentRef.replace('POLE_', '');
        if(parentRef.startsWith('GSS_')) rawParentRef = parentRef.replace('GSS_', '');

        let lat = 0, lng = 0;
        const p = net.poles.find(x => String(x.poleNo) === String(rawParentRef)); 
        if (p && !isNaN(p.lat)) { lat = p.lat; lng = p.lng; } 
        else { const gss = appState.gssNodes[rawParentRef]; if(gss && !isNaN(gss.lat)) { lat = gss.lat; lng = gss.lng; } else return alert("Parent node coordinates missing!"); }

        saveSnapshot(); 
        const objId = 'DT_' + Date.now();
        net.dts.push({ id: objId, parentPole: rawParentRef, mountedOn: mountedOn, code, rating, phase, location, lat: lat, lng: lng, synced: false }); 
        
        attachTempPhoto('DT', objId);
        window.closeModal(); 
        renderEntireNetwork(); 
        triggerPersistence(); 
        showToast("DT added!");
    } catch(err) { console.error(err); alert("Error saving DT: " + err.message); }
}

window.saveNewConsumer = function() { 
    try {
        const parentRefRaw = document.getElementById('inpConsParent').value;
        const kno = document.getElementById('inpConsKno').value.trim();
        const name = document.getElementById('inpConsName').value.trim();
        const load = document.getElementById('inpConsLoad').value.trim();
        const status = document.getElementById('inpConsStatus').value;
        const cType = document.getElementById('inpConsType').value; 
        const lat = parseFloat(document.getElementById('inpLat').value);
        const lng = parseFloat(document.getElementById('inpLng').value); 
        
        const net = getActiveNetwork(); 
        if(!net) return alert("No active network!");
        if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number exists!");
        
        let rawParentRef = parentRefRaw;
        if (rawParentRef.startsWith('POLE_')) rawParentRef = rawParentRef.replace('POLE_', '');
        if (rawParentRef.startsWith('DT_')) rawParentRef = rawParentRef.replace('DT_', '');

        let parentType = parentRefRaw.startsWith('DT_') ? 'DT' : 'POLE';
        if (!name || !kno) return alert("Enter Name and K-No"); 
        
        saveSnapshot(); 
        const objId = 'CS_'+Date.now();
        net.consumers.push({ id: objId, parentRef: rawParentRef, parentType, kno, name, load, status, cType, lat, lng, synced: false }); 
        
        attachTempPhoto('CONSUMER', objId);
        window.closeModal(); 
        renderEntireNetwork(); 
        triggerPersistence(); 
        showToast("Consumer added!");
    } catch(err) { console.error(err); alert("Error saving consumer: " + err.message); }
}

window.openEditModal = function(type, id) {
    window.closeObjectSheet(); const net = getActiveNetwork();
    if (type === 'pole') { 
        const p = net.poles.find(x => x.id === id); if (!p) return; 
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Edit Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Pole Number (Locked)</label><input type="text" id="editPoleNo" class="form-input" value="${p.poleNo}" disabled></div>
            <div class="form-grid-2"><div class="form-row"><label>Pole Type*</label><select id="editMainPoleType" class="form-select" onchange="window.togglePccConfig('editMainPoleType', 'editPccConfigDiv')"><option value="PCC" ${p.poleType==='PCC'?'selected':''}>PCC</option><option value="TOWER" ${p.poleType==='TOWER'?'selected':''}>TOWER</option><option value="RAIL POLE" ${p.poleType==='RAIL POLE'?'selected':''}>RAIL POLE</option></select></div><div class="form-row"><label>Condition</label><select id="editPoleCondition" class="form-select"><option value="Good" ${p.condition==='Good'?'selected':''}>Good</option><option value="Tilted" ${p.condition==='Tilted'?'selected':''}>Tilted</option><option value="Damaged" ${p.condition==='Damaged'?'selected':''}>Damaged</option></select></div></div>
            <div class="form-row" id="editPccConfigDiv" style="display:${p.poleType==='PCC'?'block':'none'};"><label>PCC Configuration</label><select id="editPccConfig" class="form-select"><option value="Single Pole" ${p.poleConfig==='Single Pole'?'selected':''}>Single Pole</option><option value="Double Pole" ${p.poleConfig==='Double Pole'?'selected':''}>Double Pole</option></select></div>
            <button class="btn-action-primary" onclick="window.saveEditedPole('${p.id}')">Save Changes</button>`); 
    } else if (type === 'dt') { 
        const d = net.dts.find(x => x.id === id); if (!d) return; 
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Edit DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Mounted On (Structure)*</label><select id="editDTMounted" class="form-select"><option value="Double Pole (DP)" ${d.mountedOn==='Double Pole (DP)'?'selected':''}>Double Pole (DP)</option><option value="Single Pole (SP)" ${d.mountedOn==='Single Pole (SP)'?'selected':''}>Single Pole (SP)</option><option value="Plinth" ${d.mountedOn==='Plinth'?'selected':''}>Plinth</option></select></div>
            <div class="form-grid-2"><div class="form-row"><label>DT Code (Locked)</label><input type="text" class="form-input" value="${d.code}" disabled></div><div class="form-row"><label>Phase*</label><select id="editDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('editDTPhase', 'editDTRating')"><option value="Three Phase" ${d.phase==='Three Phase'?'selected':''}>Three Phase</option><option value="Single Phase" ${d.phase==='Single Phase'?'selected':''}>Single Phase</option></select></div></div>
            <div class="form-row"><label>Rating (kVA)*</label><select id="editDTRating" class="form-select"><option value="${d.rating}" selected>${d.rating} kVA</option></select></div><div class="form-row"><label>Location</label><input type="text" id="editDTLocation" class="form-input" value="${d.location || ''}"></div><button class="btn-action-primary" onclick="window.saveEditedDT('${d.id}')">Save Changes</button>`); 
            setTimeout(() => window.updateDTRatingDropdowns('editDTPhase', 'editDTRating'), 30);
    } else if (type === 'consumer') { 
        const c = net.consumers.find(x => x.id === id); if (!c) return; 
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Edit Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Consumer Name*</label><input type="text" id="editConsName" class="form-input" value="${c.name}"></div>
            <div class="form-grid-2"><div class="form-row"><label>K-Number (Locked)</label><input type="number" class="form-input" value="${c.kno}" disabled></div><div class="form-row"><label>Load</label><input type="text" id="editConsLoad" class="form-input" value="${c.load||''}"></div></div>
            <div class="form-grid-2"><div class="form-row"><label>Status</label><select id="editConsStatus" class="form-select"><option value="Regular" ${c.status==='Regular'?'selected':''}>Regular</option><option value="DC" ${c.status==='DC'?'selected':''}>DC</option><option value="PDC" ${c.status==='PDC'?'selected':''}>PDC</option></select></div><div class="form-row"><label>Type</label><select id="editConsType" class="form-select"><option value="Domestic" ${c.cType==='Domestic'?'selected':''}>Domestic</option><option value="NonDomestic" ${c.cType==='NonDomestic'?'selected':''}>NonDomestic</option><option value="Agriculture" ${c.cType==='Agriculture'?'selected':''}>Agriculture</option><option value="Govt." ${c.cType==='Govt.'?'selected':''}>Govt.</option><option value="SIP MIP" ${c.cType==='SIP MIP'?'selected':''}>SIP MIP</option><option value="Other" ${c.cType==='Other'?'selected':''}>Other</option></select></div></div>
            <button class="btn-action-primary" onclick="window.saveEditedConsumer('${c.id}')">Save Changes</button>`); 
    } else if (type === 'line') { 
        const l = net.lines.find(x => x.id === id); if (!l) return; 
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Edit Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Voltage Type (Locked)</label><input type="text" class="form-input" value="${l.type}" disabled></div>
            <div class="form-row" id="editLinePhaseRow" style="display:${l.type.includes('11')?'block':'none'}"><label>Phase Type (HT)*</label><select id="editLinePhase" class="form-select"><option value="Three Phase" ${l.phase==='Three Phase'?'selected':''}>Three Phase</option><option value="Single Phase" ${l.phase==='Single Phase'?'selected':''}>Single Phase</option></select></div>
            <div class="form-row"><label>Conductor</label><select id="editLineConductor" class="form-select">${l.type.includes('11') ? `<option value="Weasel" ${l.conductor==='Weasel'?'selected':''}>Weasel</option><option value="Rabbit" ${l.conductor==='Rabbit'?'selected':''}>Rabbit</option><option value="Dog" ${l.conductor==='Dog'?'selected':''}>Dog</option><option value="Underground Cable" ${l.conductor==='Underground Cable'?'selected':''}>Underground Cable</option>` : `<option value="Single Phase" ${l.conductor==='Single Phase'?'selected':''}>Single Phase</option><option value="Three Phase" ${l.conductor==='Three Phase'?'selected':''}>Three Phase</option>`}</select></div>
            <button class="btn-action-primary" onclick="window.saveEditedLine('${l.id}')">Save Changes</button>`); 
    }
}
window.saveEditedPole = function(id) { const net = getActiveNetwork(); const p = net.poles.find(x => x.id === id); if(!p) return; p.poleType = document.getElementById('editMainPoleType').value; p.poleConfig = p.poleType === 'PCC' ? document.getElementById('editPccConfig').value : 'N/A'; p.condition = document.getElementById('editPoleCondition').value; p.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Pole Settings Updated"); }
window.saveEditedDT = function(id) { const net = getActiveNetwork(); const d = net.dts.find(x => x.id === id); if (!d) return; d.phase = document.getElementById('editDTPhase').value; d.mountedOn = document.getElementById('editDTMounted').value; d.rating = parseFloat(document.getElementById('editDTRating').value); d.location = document.getElementById('editDTLocation').value.trim(); d.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT Updated"); }
window.saveEditedConsumer = function(id) { const net = getActiveNetwork(); const c = net.consumers.find(x => x.id === id); if (!c) return; c.name = document.getElementById('editConsName').value.trim(); c.load = document.getElementById('editConsLoad').value.trim(); c.status = document.getElementById('editConsStatus').value; c.cType = document.getElementById('editConsType').value; c.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer Updated"); }
window.saveEditedLine = function(id) { const net = getActiveNetwork(); const l = net.lines.find(x => x.id === id); if (!l) return; if(l.type.includes('11')) l.phase = document.getElementById('editLinePhase').value; l.conductor = document.getElementById('editLineConductor').value; l.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line Updated"); }

function deleteDTLogic(dtId, net) {
    const d = net.dts.find(x => x.id === dtId); if(!d) return;
    const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code)), ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)), ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn);
    net.lines = net.lines.filter(l => l.fromNode !== ('DT_' + d.code) && l.toNode !== ('DT_' + d.code) && !ltPoleNodeIds.includes(String(l.fromNode)) && !ltPoleNodeIds.includes(String(l.toNode)));
    net.consumers = net.consumers.filter(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); return !(isDirectToDT || isOnRemovedLTPole); });
    net.poles = net.poles.filter(p => !ltPoleIds.includes(String(p.poleNo))); net.dts = net.dts.filter(x => x.id !== dtId);
}
function deleteLTPoleLogic(p, net) { net.consumers = net.consumers.filter(c => !(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo))); net.lines = net.lines.filter(l => String(l.fromNode) !== ('POLE_'+p.poleNo) && String(l.toNode) !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== p.id); }

window.deleteEntity = function(type, id) {
    const net = getActiveNetwork(); if(!confirm(`Delete this ${type.toUpperCase()}?`)) return; saveSnapshot();
    const beforeIds = [...net.poles, ...net.lines, ...net.dts, ...net.consumers].map(x=>x.id);

    if (type === 'line') net.lines = net.lines.filter(x => x.id !== id); 
    else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id); 
    else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole') { const p = net.poles.find(x => x.id === id); if (p) { if (p.lineType === 'LT') deleteLTPoleLogic(p, net); else { const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== id); } } } 
    else if (type === 'gss') { if (appState.gssNodes[id]) delete appState.gssNodes[id]; }
    
    const afterIds = new Set([...net.poles, ...net.lines, ...net.dts, ...net.consumers].map(x=>x.id));
    if(!appState.deletedObjectIds) appState.deletedObjectIds = [];
    beforeIds.forEach(bId => { if(!afterIds.has(bId)) appState.deletedObjectIds.push(bId); });

    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast("Deleted!");
}

async function smartExportFile(filename, dataBlobOrText, mimeType) {
    try {
        showToast("Preparing file export..."); const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
        if (window.showSaveFilePicker) { try { const ext = filename.split('.').pop(); const fileHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Export', accept: { [mimeType]: ['.' + ext] } }] }); const writable = await fileHandle.createWritable(); await writable.write(blob); await writable.close(); showToast("File Saved Successfully!"); return; } catch (e) { console.warn("SaveFilePicker cancelled", e); } }
        if (window.cordova && cordova.file && cordova.file.externalRootDirectory) { window.resolveLocalFileSystemURL(cordova.file.externalRootDirectory + 'Download/', function(dirEntry) { dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) { fileEntry.createWriter(function(fileWriter) { fileWriter.onwriteend = function() { showToast("Saved to Downloads folder!"); }; fileWriter.onerror = function(e) { fallbackDownload(blob, filename); }; fileWriter.write(blob); }, function() { fallbackDownload(blob, filename); }); }, function() { fallbackDownload(blob, filename); }); }, function() { fallbackDownload(blob, filename); }); return; }
        fallbackDownload(blob, filename);
    } catch (err) { alert("Export failed: " + err.message); }
}
function fallbackDownload(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500); showToast("File Downloaded!"); }

window.exportFullJSONBackup = async function() { window.toggleSidebar(false); const backupData = JSON.stringify(appState); await smartExportFile(`DISCOM_Backup_${new Date().getTime()}.json`, backupData, "application/json"); }
window.handleImportChoice = function(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async function(event) { try { const content = event.target.result; const importedData = JSON.parse(content); if (importedData.feeders && importedData.gssNodes) { appState = importedData; triggerPersistence(); renderEntireNetwork(); showToast("Data Imported!"); } else alert("Invalid Backup Format!"); } catch (err) { alert("Error parsing file."); } }; reader.readAsText(file); e.target.value = ''; window.toggleSidebar(false); }
window.getCSVString = function() {
    const net = getActiveNetwork(); let csv = "\uFEFFWKT,Name,Type,ParentNode,Details\n"; 
    Object.values(appState.gssNodes).forEach(g => csv += `"POINT (${g.lng} ${g.lat})","${g.name}","GSS","","Code: ${g.code}"\n`);
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})","Pole ${p.poleNo}","POLE","${p.dtCode||p.poleNo}","Type: ${p.lineType} | Config: ${p.poleType} (${p.poleConfig})" \n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})","DT ${d.code}","DT","${d.parentPole}","Rating: ${d.rating}kVA"\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})","${c.name}","CONSUMER","${c.parentRef}","KNo: ${c.kno} | Load: ${c.load}"\n`);
    net.lines.forEach(l => { if (l.coords && l.coords.length === 2) csv += `"LINESTRING (${l.coords[0][1]} ${l.coords[0][0]}, ${l.coords[1][1]} ${l.coords[1][0]})","${l.type}","LINE","${l.fromNode} ➔ ${l.toNode}","Dist: ${(l.distanceMeters||0).toFixed(1)}m | Cond: ${l.conductor}"\n`; }); return csv;
}
window.exportDataToCSV = async function() { window.toggleSidebar(false); await smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}_GE.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.exportToAutoCAD_DXF = async function() { window.toggleSidebar(false); let dxf = "0\nSECTION\n2\nENTITIES\n"; getActiveNetwork().lines.forEach(l => { if (l.coords && l.coords[0] && l.coords[1]) dxf += `0\nLINE\n8\n${l.type.replace(/\s+/g,'_')}\n10\n${l.coords[0][1]}\n20\n${l.coords[0][0]}\n30\n0\n11\n${l.coords[1][1]}\n21\n${l.coords[1][0]}\n31\n0\n`; }); dxf += "0\nENDSEC\n0\nEOF\n"; await smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.dxf`, dxf, "application/dxf"); }
window.exportToGoogleEarth_KML = async function() { window.toggleSidebar(false); const esc = u => u.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c])); const feederName = esc(getActiveNetwork().feeder.name); let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${feederName}</name>\n`; getActiveNetwork().lines.forEach(l => { if (l.coords) kml += `<Placemark><LineString><coordinates>${l.coords[0][1]},${l.coords[0][0]},0 ${l.coords[1][1]},${l.coords[1][0]},0</coordinates></LineString></Placemark>\n`; }); getActiveNetwork().dts.forEach(d => { if (d.lat) kml += `<Placemark><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>\n`; }); kml += "</Document>\n</kml>"; await smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.kml`, kml, "application/vnd.google-earth.kml+xml"); }

window.generateCadSLDPdf = async function() { 
    window.toggleSidebar(false); const net = getActiveNetwork();
    if(!window.jspdf || !window.jspdf.jsPDF) return alert("PDF Generator library load error.");
    showToast("Generating A0 SLD PDF..."); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' });
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180; const allPoints = [];
    if(appState.gssNodes[net.feeder.parentGss]) allPoints.push(appState.gssNodes[net.feeder.parentGss]);
    net.poles.forEach(p => { if(p.lineType !== 'LT') allPoints.push(p); }); net.dts.forEach(d => allPoints.push(d));
    if(allPoints.length === 0) return alert("No HT nodes found to plot!");
    allPoints.forEach(p => { if(p.lat < minLat) minLat = p.lat; if(p.lat > maxLat) maxLat = p.lat; if(p.lng < minLng) minLng = p.lng; if(p.lng > maxLng) maxLng = p.lng; });
    const margin = 50; const pdfW = 1189 - (margin * 2); const pdfH = 841 - (margin * 2); const latDiff = maxLat - minLat || 0.01; const lngDiff = maxLng - minLng || 0.01; const scaleX = pdfW / lngDiff; const scaleY = pdfH / latDiff; const scale = Math.min(scaleX, scaleY); const offsetX = margin + (pdfW - (lngDiff * scale)) / 2; const offsetY = margin + (pdfH - (latDiff * scale)) / 2;
    function getPt(lat, lng) { return { x: offsetX + (lng - minLng) * scale, y: 841 - (offsetY + (lat - minLat) * scale) }; }
    doc.setFontSize(10); doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5);
    net.lines.forEach(l => {
        if(!l.type.includes('11 KV')) return;
        const c1 = getNodeCoords(l.fromNode), c2 = getNodeCoords(l.toNode);
        if(c1 && c2 && !isNaN(c1.lat) && !isNaN(c2.lat)) {
            const pt1 = getPt(c1.lat, c1.lng), pt2 = getPt(c2.lat, c2.lng); doc.line(pt1.x, pt1.y, pt2.x, pt2.y);
            const dist = (l.distanceMeters || window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng)).toFixed(0);
            const midX = (pt1.x + pt2.x) / 2; const midY = (pt1.y + pt2.y) / 2; let angle = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * (180 / Math.PI); if (angle > 90 || angle < -90) angle += 180;
            doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.text(`${dist} M`, midX, midY - 2, { angle: angle, align: 'center' });
        }
    });
    allPoints.forEach(p => {
        if(isNaN(p.lat)) return;
        const pt = getPt(p.lat, p.lng);
        if(p.code && p.name && p.name.includes("Substation")) { doc.setFillColor(185, 28, 28); doc.rect(pt.x - 6, pt.y - 6, 12, 12, 'FD'); doc.setTextColor(255, 255, 255); doc.setFontSize(6); doc.text("GSS", pt.x, pt.y + 2, {align:'center'}); } 
        else if(p.rating) { doc.setFillColor(245, 158, 11); doc.rect(pt.x - 5, pt.y - 5, 10, 10, 'FD'); doc.setTextColor(0, 0, 0); doc.setFontSize(7); const numOnly = String(p.rating).replace(/[^0-9]/g, ''); doc.text(numOnly, pt.x, pt.y + 2.5, {align:'center'}); } 
        else if(p.lineType !== 'LT') { doc.setFillColor(253, 224, 71); doc.circle(pt.x, pt.y, 3, 'FD'); }
    });
    let t11 = 0, dt1ph = 0, dt3ph = 0; net.lines.forEach(l => { if(!l.type.includes('LT')) t11 += (l.distanceMeters||0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
    doc.setFillColor(255, 255, 255); doc.setDrawColor(0,0,0); doc.setLineWidth(0.5); doc.rect(1189 - 160, 841 - 70, 150, 60, 'FD'); doc.setTextColor(0, 0, 0); doc.setFontSize(16); doc.text("DISCOM SLD REPORT", 1189 - 155, 841 - 55); doc.setFontSize(12); doc.text(`Feeder: ${net.feeder.name} (${net.feeder.code})`, 1189 - 155, 841 - 45); doc.text(`Total HT Line: ${(t11/1000).toFixed(3)} KM`, 1189 - 155, 841 - 35); doc.text(`1-Phase DTs: ${dt1ph}`, 1189 - 155, 841 - 25); doc.text(`3-Phase DTs: ${dt3ph}`, 1189 - 155, 841 - 15);
    await smartExportFile(`${net.feeder.name.replace(/\s+/g, '_')}_SLD.pdf`, doc.output('blob'), "application/pdf");
}

/* ====== PERMISSIONS & STARTUP ====== */
window.requestAppPermissions = function() {
    if(window.cordova && cordova.plugins && cordova.plugins.permissions) {
        var permissions = cordova.plugins.permissions;
        var list = [ permissions.ACCESS_FINE_LOCATION, permissions.CAMERA, permissions.READ_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ];
        permissions.requestPermissions(list, function(status) {
            permissions.checkPermission(permissions.ACCESS_FINE_LOCATION, function(locStatus) {
                if (locStatus.hasPermission) {
                    document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions();
                } else { document.getElementById('permission-overlay').style.display = 'flex'; showToast("Location strictly required!"); }
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
            applyAuthUIVisuals(); setTimeout(() => { if(map) map.invalidateSize(); renderEntireNetwork(); centerMapOnGSS(); checkOnboardingFlow(); updateUnsyncedBadge(); }, 100);
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
