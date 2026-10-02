const DB_KEY = "DISCOM_ENTERPRISE_DB";

const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
let supabaseClient = null;
const ADMIN_EMAIL = 'admin@discom.com';

let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', theme: 'light' },
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: "1",
    gssNodes: {}, feeders: {},  
    orphanPoleIds: new Set(), activeMove: null, placementType: null, photos: []
};
let historyStack = [];
let map = null; let tileLayers = {}; let currentTileIndex = 0; let layerKeys = []; let featureGroups = {};

const i18n = {
    en: { appLanguage: "App Language", distUnit: "Distance Unit", theme: "Theme Mode", settings: "Settings", save: "Save", edit: "Edit", delete: "Delete", mapSetup: "Network Setup Required", htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", permReq: "Permissions Required", permDesc: "This app strictly requires <b>Location, Camera</b> and <b>Storage</b> permissions to function.", grantPerm: "Grant Permissions" },
    hi: { appLanguage: "ऐप की भाषा", distUnit: "दूरी की इकाई", theme: "थीम मोड", settings: "सेटिंग्स", save: "सेव करें", edit: "बदलें", delete: "डिलीट", mapSetup: "नेटवर्क सेटअप ज़रूरी है", htPole: "HT पोल", ltPole: "LT पोल", line: "लाइन", dt: "डी.टी", consumer: "कंज्यूमर", permReq: "अनुमति आवश्यक है", permDesc: "इस ऐप को चलाने के लिए <b>Location, Camera</b> और <b>Storage</b> की अनुमति देना अनिवार्य है।", grantPerm: "अनुमति दें" }
};

function applyTranslations() {
    const lang = appState.settings.language || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(i18n[lang] && i18n[lang][key]) {
            if(el.tagName === 'INPUT' && el.type === 'text') el.placeholder = i18n[lang][key];
            else el.innerHTML = i18n[lang][key];
        }
    });
}

function applyTheme() {
    if(appState.settings.theme === 'dark') document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
}

function initMapLayers() {
    if (typeof L === 'undefined') return; 
    map = L.map('map', { 
        zoomControl: false, attributionControl: false, preferCanvas: true, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0,
        zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false
    }).setView([26.9150, 75.7830], 16);

    map.on('zoomend', updateMapZoomClasses); 
    map.on('move', () => { const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; });

    tileLayers = { 
        hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
        street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) },
        osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) }
    };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    featureGroups = { 
        gss: L.featureGroup().addTo(map), lines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map),
        poles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) 
    };
}

function updateMapZoomClasses() {
    if(!map) return;
    const z = map.getZoom(); const mapEl = document.getElementById('map');
    mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-dt', 'hide-gss');
    if (z <= 20) mapEl.classList.add('hide-consumers'); if (z <= 19) mapEl.classList.add('hide-lt-poles'); if (z <= 18) mapEl.classList.add('hide-lt-lines'); if (z <= 17) mapEl.classList.add('hide-ht-poles'); if (z <= 16) mapEl.classList.add('hide-dt'); if (z <= 15) mapEl.classList.add('hide-gss');
}

window.toggleMapLayer = function() { 
    if(!map) return;
    map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; 
    tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name;
}

window.updateFeederDropdown = function() {
    const header = document.getElementById('feederSelectHeader');
    if(!header) return;
    const keys = Object.keys(appState.feeders || {});
    if(keys.length === 0) { header.innerHTML = '<option value="">No Feeder</option>'; return; }
    header.innerHTML = keys.map(code => `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${appState.feeders[code].feeder.name}</option>`).join('');
};

function getActiveNetwork() {
    let keys = Object.keys(appState.feeders || {});
    if (keys.length > 0 && !appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = keys[0];
    let net = appState.feeders[appState.currentFeederCode];
    if (!net) return null; 
    if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

function showToast(msg) {
    const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg');
    if (!toast || !msgElem) return; msgElem.innerText = msg;
    toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
}

function setSyncStatus(status) {
    const ind = document.getElementById('sync-indicator'); if(!navigator.onLine) status = 'offline';
    if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>';
    else if(status === 'synced') ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success"></i>';
    else ind.innerHTML = '<i class="fa-solid fa-cloud-xmark sync-error"></i>';
}

function syncToSupabase() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; setSyncStatus('syncing');
    const dataToSync = JSON.parse(JSON.stringify(appState)); delete dataToSync.user; delete dataToSync.orphanPoleIds; delete dataToSync.photos; 
    supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: dataToSync, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .then(({error}) => { 
        if(error) { setSyncStatus('offline'); return; }
        if (appState.photos && appState.photos.length > 0) {
            const unsyncedPhotos = appState.photos.filter(p => !p.synced);
            if (unsyncedPhotos.length > 0) {
                const photoPayload = unsyncedPhotos.map(p => ({ user_id: appState.user.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url }));
                supabaseClient.from('object_photos').insert(photoPayload).then(({error: photoErr}) => {
                    if (!photoErr) { unsyncedPhotos.forEach(p => p.synced = true); if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState); }
                });
            }
        }
        setSyncStatus('synced'); 
    }).catch(() => setSyncStatus('offline'));
}

async function pullFromSupabase() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; setSyncStatus('syncing');
    const isAdmin = appState.user.email === ADMIN_EMAIL; let query = supabaseClient.from('survey_data').select('data');
    if (!isAdmin) query = query.eq('user_id', appState.user.id);
    try {
        const { data, error } = await query; if (error) throw error;
        if (data && data.length > 0) {
            if (isAdmin) {
                appState.feeders = {}; appState.gssNodes = {};
                data.forEach(row => { const cloudData = row.data; if (cloudData.gssNodes) Object.assign(appState.gssNodes, cloudData.gssNodes); if (cloudData.feeders) { Object.keys(cloudData.feeders).forEach(fCode => { appState.feeders[fCode] = cloudData.feeders[fCode]; }); } });
            } else {
                const cloudData = data[0].data; 
                if(cloudData.feeders) appState.feeders = cloudData.feeders; 
                if(cloudData.gssNodes) appState.gssNodes = cloudData.gssNodes; 
                if(cloudData.currentFeederCode) appState.currentFeederCode = cloudData.currentFeederCode;
                if(cloudData.photos) appState.photos = cloudData.photos;
                if(cloudData.settings) appState.settings = { ...appState.settings, ...cloudData.settings };
            }
            if(typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState); else localStorage.setItem(DB_KEY, JSON.stringify(appState));
            
            applyTranslations(); applyTheme();
            if(map) map.invalidateSize();
            
            renderEntireNetwork(); setSyncStatus('synced'); centerMapOnGSS(); checkOnboardingFlow();
        } else {
            setSyncStatus('synced');
            if(map) map.invalidateSize();
            checkOnboardingFlow();
        }
    } catch (err) { 
        console.error("Sync error:", err); setSyncStatus('offline'); 
        if(map) map.invalidateSize(); checkOnboardingFlow();
    }
}

function triggerPersistence() { 
    if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState).catch(() => localStorage.setItem(DB_KEY, JSON.stringify(appState))); 
    else localStorage.setItem(DB_KEY, JSON.stringify(appState));
    syncToSupabase(); 
}

/* ====== ONBOARDING & AUTH ====== */
let authMode = 'login';
window.toggleAuthMode = function() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    document.getElementById('loginBtn').style.display = authMode === 'login' ? 'inline-block' : 'none'; document.getElementById('signupBtn').style.display = authMode === 'signup' ? 'inline-block' : 'none'; document.getElementById('signupNameField').style.display = authMode === 'signup' ? 'block' : 'none'; document.getElementById('authToggleText').innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login";
}

function applyAuthUIVisuals() {
    document.getElementById('auth-screen').style.display = 'none'; 
    document.getElementById('app-container').style.display = 'flex';
    setTimeout(() => { if(map) map.invalidateSize(); }, 100);
    document.getElementById('userNameDisplay').innerText = appState.user.name; 
    document.getElementById('userEmailDisplay').innerText = appState.user.email;
}

window.checkOnboardingFlow = function() {
    if(Object.keys(appState.gssNodes || {}).length === 0) {
        document.getElementById('onboarding-overlay').style.display = 'flex';
        document.getElementById('onboarding-title').innerText = "Network Setup Required";
        document.getElementById('onboarding-desc').innerText = "Please add your first GSS to begin mapping.";
        document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; window.openAddGssModal(); };
    } else if (Object.keys(appState.feeders || {}).length === 0) {
        document.getElementById('onboarding-overlay').style.display = 'flex';
        document.getElementById('onboarding-title').innerText = "Create Feeder";
        document.getElementById('onboarding-desc').innerText = "You must create a Feeder linked to your GSS to continue.";
        document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; window.openFeederConfigModal(); };
    } else {
        document.getElementById('onboarding-overlay').style.display = 'none';
        renderEntireNetwork();
    }
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
window.handleSupabaseLogout = async function() { if(supabaseClient) await supabaseClient.auth.signOut(); if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.removeItem(DB_KEY); location.reload(); }

/* ====== MAP TRACKING ====== */
function centerMapOnGSS() {
    if(!map) return; map.invalidateSize();
    const net = getActiveNetwork(); if(!net) return;
    const gss = appState.gssNodes[net.feeder.parentGss];
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

/* ====== BOTTOM SHEET & CAMERA ====== */
window.currentSelectedObj = null;
window.closeObjectSheet = function() { document.getElementById('object-bottom-sheet').classList.remove('open'); window.currentSelectedObj = null; };
window.openObjectSheet = function(type, id, title, detailsHtml) {
    window.currentSelectedObj = { type, id };
    document.getElementById('objSheetTitle').innerText = title; document.getElementById('objSheetDetails').innerHTML = detailsHtml;
    document.getElementById('object-bottom-sheet').classList.add('open');
    document.getElementById('btnObjEdit').onclick = () => window.openEditModal(type.toLowerCase(), id);
    document.getElementById('btnObjMove').onclick = () => window.startObjectMove(type, id, title);
    document.getElementById('btnObjDelete').onclick = () => { window.deleteEntity(type.toLowerCase(), id); window.closeObjectSheet(); };
};

window.captureObjectPhoto = function() {
    if (!window.currentSelectedObj || !appState.user.isLoggedIn) return;
    if (!navigator.camera) return alert("Camera plugin not available!");
    navigator.camera.getPicture(function(imageData) {
        showToast("Saving photo...");
        const base64Data = "data:image/jpeg;base64," + imageData;
        if(!appState.photos) appState.photos = [];
        appState.photos.push({ id: 'PH_' + Date.now(), object_type: window.currentSelectedObj.type, object_id: window.currentSelectedObj.id, photo_url: base64Data, synced: false });
        triggerPersistence();
        if (navigator.onLine && supabaseClient) { showToast("Photo saved! Syncing online..."); syncToSupabase(); } 
        else showToast("Photo saved locally. Will sync when online.");
    }, function(message) { alert('Camera failed: ' + message); }, { quality: 50, destinationType: Camera.DestinationType.DATA_URL, sourceType: Camera.PictureSourceType.CAMERA, saveToPhotoAlbum: false });
};

/* ====== CUSTOM POLE ICONS ====== */
function getPoleSVG(type, config) {
    const isDark = appState.settings.theme === 'dark';
    const fill = isDark ? '#e2e8f0' : '#0f172a';
    if(type === 'TOWER') return `<svg viewBox="0 0 24 24" style="width:24px;height:24px;"><path d="M12 2L6 22h2l1.5-5h5L16 22h2L12 2zM9.5 15l2.5-8 2.5 8h-5z" fill="${fill}"/><path d="M10 11l4 4M14 11l-4 4" stroke="${fill}" stroke-width="1.5"/></svg>`;
    if(type === 'RAIL POLE') return `<svg viewBox="0 0 24 24" style="width:20px;height:24px;"><path d="M6 2h12v3H6zM10 5h4v14h-4zM6 19h12v3H6z" fill="${fill}"/></svg>`;
    if(type === 'PCC' && config === 'Double Pole') return `<svg viewBox="0 0 24 24" style="width:24px;height:24px;"><path d="M6 4v16h3V4zm9 0v16h3V4z" fill="${fill}"/><path d="M4 6h16v3H4z" fill="#64748b"/><circle cx="5" cy="5" r="2" fill="#ef4444"/><circle cx="19" cy="5" r="2" fill="#ef4444"/></svg>`;
    return `<svg viewBox="0 0 24 24" style="width:24px;height:24px;"><path d="M10 4v16h4V4z" fill="${fill}"/><path d="M5 4l7 5 7-5" stroke="${fill}" stroke-width="2.5" fill="none"/><circle cx="5" cy="4" r="2" fill="#ef4444"/><circle cx="19" cy="4" r="2" fill="#ef4444"/></svg>`;
}

function renderEntireNetwork() {
    if(!map) return;
    window.updateFeederDropdown();
    try {
        updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers()); 
        
        Object.values(appState.gssNodes).forEach(gss => {
            if (typeof gss.lat === 'number' && !isNaN(gss.lat)) {
                if (appState.activeMove && appState.activeMove.id === gss.code) return; 
                const gssIcon = L.divIcon({ className: 'gss-square-icon', html: `<span>GSS</span>`, iconSize: [36,36], iconAnchor: [18,18] });
                const m = L.marker([gss.lat, gss.lng], { icon: gssIcon, zIndexOffset: 500 });
                m.on('click', () => { map.flyTo([gss.lat, gss.lng], 19); window.openObjectSheet('GSS', gss.code, gss.name, `Code: <b>${gss.code}</b>`); }); 
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
                const svgHtml = getPoleSVG(p.poleType, p.poleConfig);
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pole-marker-icon ' + (isLT ? 'lt-pole ' : 'ht-pole ') + (isOrphan ? 'orphan-pulse' : ''), html: `${svgHtml}<span>${displayNo}</span>`, iconSize: [30, 40], iconAnchor: [15, 20] }), zIndexOffset: 200 });
                m.on('click', () => { map.flyTo([p.lat, p.lng], 19); window.openObjectSheet('POLE', p.id, `Pole ${p.poleNo}`, `Type: <b>${p.lineType || 'HT'}</b><br>Config: <b>${p.poleType || 'Standard'} ${p.poleConfig&&p.poleConfig!=='N/A'?'('+p.poleConfig+')':''}</b><br>Condition: <b>${p.condition||'Good'}</b><br>Parent: <b>${p.dtCode || 'Feeder'}</b>`); }); 
                featureGroups.poles.addLayer(m);
            });
        }

        if (f.dts) {
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => x.poleNo == d.parentPole); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng && !isNaN(d.lat)) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); const numRating = String(d.rating).replace(/[^0-9]/g, '');
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'dt-square-icon' + (isOrphan ? ' orphan-pulse' : ''), html: `${numRating}`, iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: 400 });
                    m.on('click', () => { map.flyTo([d.lat, d.lng], 19); window.openObjectSheet('DT', d.id, `DT Code: ${d.code}`, `Rating: <b>${d.rating} kVA</b><br>Type: <b>${d.phase || 'Three Phase'}</b><br>Loc: <b>${d.location||'N/A'}</b>`); }); 
                    featureGroups.dts.addLayer(m);
                }
            });
        }

        net.lines.forEach(line => {
            const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
            if (c1 && c2 && !isNaN(c1.lat) && !isNaN(c2.lat)) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = getLineSpec(line.type); if (!f[spec.filterKey]) return;
            const hitPoly = L.polyline(line.coords, { color: 'transparent', weight: 25, className: spec.lineClass }).addTo(featureGroups.lines);
            L.polyline(line.coords, { color: spec.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', interactive: false, className: spec.lineClass }).addTo(featureGroups.lines);
            hitPoly.on('click', () => {
                const midLat = (c1.lat + c2.lat) / 2; const midLng = (c1.lng + c2.lng) / 2; map.flyTo([midLat, midLng], 19); 
                window.openObjectSheet('LINE', line.id, spec.name, `Conductor: <b>${line.conductor || 'Standard'}</b><br>From-To: <b>${line.fromNode} ➔ ${line.toNode}</b><br>Dist: <b>${window.formatDistance(line.distanceMeters||0)}</b>`);
            });
        });

        if (f.consumers) {
            net.consumers.forEach(c => {
                if (isNaN(c.lat) || isNaN(c.lng) || (appState.activeMove && appState.activeMove.id === c.id)) return; 
                const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'consumer-marker-icon', html: `<i class="fa-solid fa-house"></i>`, iconSize: [16,16], iconAnchor: [8,8] }), zIndexOffset: 100 });
                m.on('click', () => { map.flyTo([c.lat, c.lng], 19); window.openObjectSheet('CONSUMER', c.id, c.name, `Type: <b>${c.cType||'Domestic'}</b><br>Status: <b>${c.status||'Regular'}</b><br>K-No: <b>${c.kno}</b><br>Load: <b>${c.load||'N/A'}</b>`); }); 
                featureGroups.consumers.addLayer(m);
                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = getNodeCoords(parentStr);
                if (pCoords && !isNaN(pCoords.lat)) L.polyline([[c.lat, c.lng], [pCoords.lat, pCoords.lng]], { color: (appState.settings.theme==='dark'?'#f8fafc':'#000'), weight: 1.2, dashArray: '4, 4', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
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

/* ====== FILTERS ====== */
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

/* ====== SETTINGS ====== */
window.autoSaveSettings = function() { 
    appState.settings.unit = document.getElementById('setUnit').value; appState.settings.gpsInterval = parseFloat(document.getElementById('setGpsInterval').value); appState.settings.gpsAccuracy = parseFloat(document.getElementById('setGpsAccuracy').value); 
    appState.settings.language = document.getElementById('setLanguage').value; appState.settings.theme = document.getElementById('setTheme').value;
    applyTranslations(); applyTheme(); triggerPersistence(); renderEntireNetwork(); showToast("Settings Saved!"); 
}
window.openSettingsPage = function() { 
    window.toggleSidebar(false); document.getElementById('setUnit').value = appState.settings.unit || 'm'; document.getElementById('setGpsInterval').value = appState.settings.gpsInterval || 3; document.getElementById('setGpsAccuracy').value = appState.settings.gpsAccuracy || 10;
    document.getElementById('setLanguage').value = appState.settings.language || 'en'; document.getElementById('setTheme').value = appState.settings.theme || 'light'; document.getElementById('settings-page').classList.add('open'); 
}
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }

/* ====== OBJECT ADD FORMS (WITH NEW DROPDOWNS) ====== */
window.openAddForm = function(type) { window.toggleSpeedDial(false); if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { appState.placementType = type; document.getElementById('center-placement-pin').style.display = 'block'; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'flex'; } else window.showFormModal(type, null, null); }
window.confirmPlacement = function() { document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; const center = map.getCenter(); window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6))); }
window.cancelPlacement = function() { document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; }

window.togglePccConfig = function() { const pType = document.getElementById('inpMainPoleType').value; const configDiv = document.getElementById('pccConfigDiv'); if(pType === 'PCC') configDiv.style.display = 'block'; else configDiv.style.display = 'none'; };
window.toggleLineConductor = function() {
    const lType = document.getElementById('inpLineType').value; const sel = document.getElementById('inpConductor');
    if(lType === '11 KV LINE') sel.innerHTML = `<option value="Weasel">Weasel</option><option value="Rabbit">Rabbit</option><option value="Dog">Dog</option><option value="Underground Cable">Underground Cable</option>`;
    else sel.innerHTML = `<option value="Single Phase">Single Phase</option><option value="Three Phase">Three Phase</option>`;
};

window.showFormModal = function(type, snapLat, snapLng) {
    const net = getActiveNetwork(); if(!net) return; 
    let center = { lat: 26.91, lng: 75.78 }; if(map) center = map.getCenter();
    snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6));
    
    if (type === 'POLE' || type === 'LTPOLE') {
        const isHT = type === 'POLE';
        let dtSelectHtml = ''; let nextNo = '';
        if(isHT) { let maxHtNo = 0; net.poles.filter(p => p.lineType !== 'LT').forEach(p => { const num = parseInt(p.poleNo); if(!isNaN(num) && num > maxHtNo) maxHtNo = num; }); nextNo = maxHtNo + 1; } 
        else {
            if (net.dts.length === 0) return alert("Add a DT first!");
            let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
            dtSelectHtml = `<div class="form-row"><label>Associated DT*</label><select id="inpLTPoleDT" class="form-select">${sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join('')}</select></div>`;
        }
        openModal(`
            <div class="sheet-head"><div class="sheet-title">Add ${isHT?'HT':'LT'} Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            ${dtSelectHtml}
            ${isHT ? `<div class="form-row"><label>Pole Number*</label><input type="number" id="inpPoleNo" class="form-input" value="${nextNo}"></div>` : ''}
            <div class="form-grid-2">
                <div class="form-row"><label>Pole Type*</label><select id="inpMainPoleType" class="form-select" onchange="window.togglePccConfig()"><option value="PCC" selected>PCC</option><option value="TOWER">TOWER</option><option value="RAIL POLE">RAIL POLE</option></select></div>
                <div class="form-row"><label>Condition</label><select id="inpPoleCondition" class="form-select"><option value="Good" selected>Good</option><option value="Tilted">Tilted</option><option value="Damaged">Damaged</option></select></div>
            </div>
            <div class="form-row" id="pccConfigDiv" style="display:block;"><label>PCC Configuration</label><select id="inpPccConfig" class="form-select"><option value="Single Pole" selected>Single Pole</option><option value="Double Pole">Double Pole</option></select></div>
            <input type="hidden" id="inpPoleCategory" value="${isHT?'HT':'LT'}"><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}">
            <button class="btn-action-primary" onclick="${isHT?'window.saveNewPole()':'window.saveNewLTPole()'}">Save Pole</button>`);
    } 
    else if (type === 'LINE') {
        if (net.poles.length === 0) return alert("Add at least one pole first!");
        window.filterLineNodes = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), dtSelectorBox = document.getElementById('ltLineDTSelector');
            let nodes = [];
            if (type.includes('LT')) {
                dtSelectorBox.style.display = 'block'; const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? targetDTElem.value : ''; if(!selectedDT) return;
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
            } else {
                dtSelectorBox.style.display = 'none'; nodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[net.feeder.parentGss]; if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, map.getCenter().lat, map.getCenter().lng); let defaultFrom = nodes.length > 0 ? nodes[0].id : '';
            fromSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title}</option>`).join(''); window.syncLineToSelect(); window.toggleLineConductor();
        };
        window.syncLineToSelect = function() {
            const type = document.getElementById('inpLineType').value, fromVal = document.getElementById('inpFromNode').value, toSel = document.getElementById('inpToNode'); let nodes = [];
            if (type.includes('LT')) {
                const selectedDT = document.getElementById('inpTargetDT') ? String(document.getElementById('inpTargetDT').value) : '';
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === selectedDT && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                if(selectedDT && ('DT_'+selectedDT) !== fromVal) { const dtObj = net.dts.find(d => String(d.code) === selectedDT); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng}); }
            } else {
                nodes = net.poles.filter(p => p.lineType !== 'LT' && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[net.feeder.parentGss]; if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, map.getCenter().lat, map.getCenter().lng); toSel.innerHTML = nodes.map(n => `<option value="${n.id}">${n.title}</option>`).join(''); 
        };
        openModal(`<div class="sheet-head"><div class="sheet-title">Add Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-grid-2">
                <div class="form-row"><label>Voltage Type*</label><select id="inpLineType" class="form-select" onchange="window.filterLineNodes()"><option value="11 KV LINE" selected>11 KV (HT)</option><option value="LT LINE">LT Line</option></select></div>
                <div class="form-row"><label>Conductor*</label><select id="inpConductor" class="form-select"></select></div>
            </div>
            <div id="ltLineDTSelector" style="display:none; background:var(--bg-glass); padding:8px; border-radius:8px; margin-bottom:12px;"><label>Select DT for LT Route*</label><select id="inpTargetDT" class="form-select" onchange="window.filterLineNodes()"></select></div>
            <div class="form-grid-2"><div class="form-row"><label>From Node*</label><select id="inpFromNode" class="form-select" onchange="window.syncLineToSelect()"></select></div><div class="form-row"><label>To Node*</label><select id="inpToNode" class="form-select"></select></div></div><button class="btn-action-primary" onclick="window.saveNewLine()">Save Line</button>`);
        setTimeout(() => { let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); document.getElementById('inpTargetDT').innerHTML = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join(''); window.filterLineNodes(); window.toggleLineConductor(); }, 30);
    } 
    else if (type === 'DT') {
        let parentNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng})); const feederGss = appState.gssNodes[net.feeder.parentGss]; if(feederGss) parentNodes.push({id: feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
        openModal(`<div class="sheet-head"><div class="sheet-title">Add DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Connected To (HT Node)*</label><select id="inpDTParent" class="form-select">${parentOpts}</select></div><div class="form-grid-2"><div class="form-row"><label>DT Code*</label><input type="number" id="inpDTCode" class="form-input" value="${Math.floor(Math.random()*9000)}"></div><div class="form-row"><label>Phase*</label><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating')"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select></div></div><div class="form-row"><label>Rating (kVA)*</label><select id="inpDTRating" class="form-select"></select></div><div class="form-row"><label>Location / Landmark</label><input type="text" id="inpDTLocation" class="form-input" placeholder="e.g. Near Main Market"></div><button class="btn-action-primary" onclick="window.saveNewDT()">Save DT</button>`);
        setTimeout(() => window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating'), 30);
    } 
    else if (type === 'CONSUMER') {
        if (net.dts.length === 0) return alert("Must have at least one DT!"); let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); const dtOpts = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join('');
        openModal(`<div class="sheet-head"><div class="sheet-title">Add Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-grid-2"><div class="form-row"><label>Parent DT*</label><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()">${dtOpts}</select></div><div class="form-row"><label>Connects To*</label><select id="inpConsParent" class="form-select"></select></div></div>
            <div class="form-grid-2"><div class="form-row"><label>Status</label><select id="inpConsStatus" class="form-select"><option value="Regular" selected>Regular</option><option value="DC">DC</option><option value="PDC">PDC</option></select></div><div class="form-row"><label>Type</label><select id="inpConsType" class="form-select"><option value="Domestic" selected>Domestic</option><option value="NonDomestic">NonDomestic</option><option value="Agriculture">Agriculture</option><option value="Govt.">Govt.</option><option value="SIP MIP">SIP MIP</option><option value="Other">Other</option></select></div></div>
            <div class="form-grid-2"><div class="form-row"><label>K-Number*</label><input type="number" id="inpConsKno" class="form-input"></div><div class="form-row"><label>Load</label><input type="text" id="inpConsLoad" class="form-input" value="1 kW"></div></div><div class="form-row"><label>Consumer Name*</label><input type="text" id="inpConsName" class="form-input"></div><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}"><button class="btn-action-primary" onclick="window.saveNewConsumer()">Save Consumer</button>`);
        setTimeout(() => window.filterConsumerPoles(), 30);
    }
}
window.updateDTRatingDropdowns = function(phaseId, ratingId) {
    const phase = document.getElementById(phaseId).value, ratingSel = document.getElementById(ratingId);
    if(phase === 'Single Phase') ratingSel.innerHTML = `<option value="5">5 kVA</option><option value="10">10 kVA</option><option value="16" selected>16 kVA</option><option value="25">25 kVA</option>`;
    else ratingSel.innerHTML = `<option value="10">10 kVA</option><option value="16">16 kVA</option><option value="25" selected>25 kVA</option><option value="63">63 kVA</option><option value="100">100 kVA</option><option value="160">160 kVA</option><option value="250">250 kVA</option><option value="315">315 kVA</option><option value="500">500 kVA</option>`;
}
window.filterConsumerPoles = function() {
    const net = getActiveNetwork(), selectedDT = document.getElementById('inpConsDT').value, centerLat = parseFloat(document.getElementById('inpLat').value), centerLng = parseFloat(document.getElementById('inpLng').value);
    let nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: p.poleNo}));
    const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: selectedDT, title: 'Direct to DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
    nodes = window.sortByDistance(nodes, centerLat, centerLng); document.getElementById('inpConsParent').innerHTML = nodes.map(n => `<option value="${n.id}">${n.title}</option>`).join('');
}
window.saveNewPole = function() { 
    saveSnapshot(); const no = document.getElementById('inpPoleNo').value.trim(), category = document.getElementById('inpPoleCategory').value, lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; const condition = document.getElementById('inpPoleCondition').value;
    if (!no) return alert("Enter pole number"); const net = getActiveNetwork(); if (net.poles.some(p => String(p.poleNo) === no)) return alert(`Pole exists!`); 
    net.poles.push({ id: 'P_'+Date.now(), poleNo: no, lineType: category, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("HT Pole added!");
}
window.saveNewLTPole = function() {
    saveSnapshot(); const dtCode = document.getElementById('inpLTPoleDT').value, category = document.getElementById('inpPoleCategory').value, lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; const condition = document.getElementById('inpPoleCondition').value;
    if (!dtCode) return alert("Select DT"); const net = getActiveNetwork(); const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); 
    let maxId = 0; existingLTPoles.forEach(ep => { const parts = String(ep.poleNo).split('-'); if (parts.length > 1) { const num = parseInt(parts[parts.length - 1]); if (!isNaN(num) && num > maxId) maxId = num; } }); const finalPoleNo = `${dtCode}-${maxId + 1}`;
    if (net.poles.some(p => String(p.poleNo) === String(finalPoleNo))) return alert(`Pole ${finalPoleNo} exists!`); 
    net.poles.push({ id: 'P_'+Date.now(), poleNo: finalPoleNo, lineType: category, dtCode: dtCode, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("LT Pole added!");
}
window.saveNewLine = function() { 
    saveSnapshot(); const from = document.getElementById('inpFromNode').value, to = document.getElementById('inpToNode').value, type = document.getElementById('inpLineType').value, conductor = document.getElementById('inpConductor').value; 
    if (from === to) return alert("Cannot connect node to itself!"); if (!to) return alert("Please select a target node!");
    const net = getActiveNetwork(), spec = getLineSpec(type), existingLine = net.lines.find(l => (l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from));
    if(existingLine) return alert("Line already exists!");
    const c1 = getNodeCoords(from), c2 = getNodeCoords(to); if(!c1 || !c2) return alert("Invalid node coordinates!"); const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); 
    net.lines.push({ id: 'LN_'+Date.now(), type: spec.name, conductor: conductor, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line added!");
}
window.saveNewDT = function() { 
    saveSnapshot(); const parentRef = document.getElementById('inpDTParent').value, code = document.getElementById('inpDTCode').value.trim(), rating = parseFloat(document.getElementById('inpDTRating').value), phase = document.getElementById('inpDTPhase').value, location = document.getElementById('inpDTLocation').value.trim();
    if (!code) return alert("Enter DT Code"); const net = getActiveNetwork(), p = net.poles.find(x => String(x.poleNo) === String(parentRef)); let lat = net.feeder.lat, lng = net.feeder.lng; if (p) { lat = p.lat; lng = p.lng; }
    net.dts.push({ id: 'DT_'+Date.now(), parentPole: parentRef, code, rating, phase, location, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT added!");
}
window.saveNewConsumer = function() { 
    saveSnapshot(); const parentRef = document.getElementById('inpConsParent').value, kno = document.getElementById('inpConsKno').value.trim(), name = document.getElementById('inpConsName').value.trim(), load = document.getElementById('inpConsLoad').value.trim();
    const status = document.getElementById('inpConsStatus').value, cType = document.getElementById('inpConsType').value; const lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    const net = getActiveNetwork(); if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number exists!");
    let parentType = 'POLE'; const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); if (!p) parentType = 'DT';
    if (!name || !kno) return alert("Enter Name and K-No"); 
    net.consumers.push({ id: 'CS_'+Date.now(), parentRef, parentType, kno, name, load, status, cType, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer added!");
}

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
    if (type === 'line') net.lines = net.lines.filter(x => x.id !== id); else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id); else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole') { const p = net.poles.find(x => x.id === id); if (p) { if (p.lineType === 'LT') deleteLTPoleLogic(p, net); else { const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== id); } } } 
    else if (type === 'gss') { if (appState.gssNodes[id]) delete appState.gssNodes[id]; }
    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast("Deleted!");
}
window.openEditModal = function(type, id) {
    window.closeObjectSheet(); const net = getActiveNetwork();
    if (type === 'pole') { const p = net.poles.find(x => x.id === id); if (!p) return; openModal(`<div class="sheet-head"><div class="sheet-title">Edit Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Pole Number (Locked)*</label><input type="text" id="editPoleNo" class="form-input" value="${p.poleNo}" readonly disabled style="background-color:var(--bg-glass); cursor:not-allowed; opacity:0.8;"></div><button class="btn-action-primary" onclick="window.saveEditedPole('${p.id}')">Save Changes</button>`); } 
    else if (type === 'dt') { const d = net.dts.find(x => x.id === id); if (!d) return; openModal(`<div class="sheet-head"><div class="sheet-title">Edit DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>DT Code*</label><input type="number" id="editDTCode" class="form-input" value="${d.code}"></div><div class="form-row"><label>Location</label><input type="text" id="editDTLocation" class="form-input" value="${d.location || ''}"></div><button class="btn-action-primary" onclick="window.saveEditedDT('${d.id}')">Save Changes</button>`); } 
    else if (type === 'consumer') { const c = net.consumers.find(x => x.id === id); if (!c) return; openModal(`<div class="sheet-head"><div class="sheet-title">Edit Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Consumer Name*</label><input type="text" id="editConsName" class="form-input" value="${c.name}"></div><div class="form-row"><label>K-Number*</label><input type="number" id="editConsKno" class="form-input" value="${c.kno}"></div><button class="btn-action-primary" onclick="window.saveEditedConsumer('${c.id}')">Save Changes</button>`); } 
    else if (type === 'gss') { const g = appState.gssNodes[id]; if (!g) return; openModal(`<div class="sheet-head"><div class="sheet-title">Edit GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>GSS Name*</label><input type="text" id="editGssName" class="form-input" value="${g.name}"></div><button class="btn-action-primary" onclick="window.saveEditedGss('${g.code}')">Save Changes</button>`); }
}
window.saveEditedPole = function(id) { saveSnapshot(); window.closeModal(); showToast("Pole Settings Updated"); }
window.saveEditedDT = function(id) { saveSnapshot(); const net = getActiveNetwork(); const d = net.dts.find(x => x.id === id); if (!d) return; d.code = document.getElementById('editDTCode').value.trim(); d.location = document.getElementById('editDTLocation').value.trim(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Updated"); }
window.saveEditedConsumer = function(id) { saveSnapshot(); const net = getActiveNetwork(); const c = net.consumers.find(x => x.id === id); if (!c) return; c.name = document.getElementById('editConsName').value.trim(); c.kno = document.getElementById('editConsKno').value.trim(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Updated"); }
window.saveEditedGss = function(code) { saveSnapshot(); const g = appState.gssNodes[code]; if (g) g.name = document.getElementById('editGssName').value.trim(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("GSS Updated"); }

window.startObjectMove = function(type, id, title) {
    window.closeObjectSheet(); appState.activeMove = { type, id }; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'flex'; document.getElementById('moveTargetTitle').innerText = `Move: ${title}`;
    let target = null; let htmlContent = '';
    if(type === 'GSS') { target = appState.gssNodes[id]; htmlContent = `<div class="gss-square-icon" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><span>GSS</span></div>`; } 
    else {
        const net = getActiveNetwork(); 
        if (type === 'POLE') { target = net.poles.find(x => x.id === id); htmlContent = `<div class="${target.lineType==='LT'?'lt-pole-icon':'pole-marker-icon'}" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);">${getPoleSVG(target.poleType, target.poleConfig)}</div>`; } 
        else if (type === 'DT') { target = net.dts.find(x => x.id === id); const numRating = String(target.rating).replace(/[^0-9]/g, ''); htmlContent = `<div class="dt-square-icon" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);">${numRating}</div>`; }
        else if (type === 'CONSUMER') { target = net.consumers.find(x => x.id === id); htmlContent = `<div class="consumer-marker-icon" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><i class="fa-solid fa-house"></i></div>`; }
    }
    if (target && target.lat && !isNaN(target.lat)) { map.panTo([target.lat, target.lng]); const liveIconContainer = document.getElementById('live-move-icon'); liveIconContainer.innerHTML = htmlContent; liveIconContainer.style.display = 'block'; renderEntireNetwork(); }
}
window.confirmObjectMove = function() {
    if (!appState.activeMove) return; saveSnapshot(); const c = map.getCenter(); const lat = parseFloat(c.lat.toFixed(6)), lng = parseFloat(c.lng.toFixed(6)), net = getActiveNetwork(); 
    if (appState.activeMove.type === 'GSS') {
        const gss = appState.gssNodes[appState.activeMove.id];
        if(gss) { gss.lat = lat; gss.lng = lng; const gssNodeId = 'GSS_' + gss.code; net.lines.forEach(l => { if (l.fromNode === gssNodeId) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode === gssNodeId) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } }); }
    } else {
        if (appState.activeMove.type === 'POLE') {
            const p = net.poles.find(x => x.id === appState.activeMove.id);
            if (p) { p.lat = lat; p.lng = lng; const poleNodeId = 'POLE_' + p.poleNo; net.dts.forEach(d => { if (d.parentPole == p.poleNo) { d.lat = lat; d.lng = lng; } }); net.lines.forEach(l => { if (l.fromNode === poleNodeId) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode === poleNodeId) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } }); }
        } else if (appState.activeMove.type === 'DT') {
            const d = net.dts.find(x => x.id === appState.activeMove.id);
            if (d) { d.lat = lat; d.lng = lng; const dtNodeId = 'DT_' + d.code; net.lines.forEach(l => { if (l.fromNode === dtNodeId) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode === dtNodeId) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } }); }
        } else if (appState.activeMove.type === 'CONSUMER') { const cons = net.consumers.find(x => x.id === appState.activeMove.id); if (cons) { cons.lat = lat; cons.lng = lng; } }
    }
    window.cancelObjectMove(); renderEntireNetwork(); triggerPersistence(); showToast("Location Updated!");
}
window.cancelObjectMove = function() { appState.activeMove = null; document.getElementById('live-move-icon').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; renderEntireNetwork(); }

/* ====== EXPORT LOGIC ====== */
async function smartExportFile(filename, dataBlobOrText, mimeType) {
    try {
        showToast("Preparing file export..."); const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
        if (window.showSaveFilePicker) { try { const ext = filename.split('.').pop(); const fileHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Export', accept: { [mimeType]: ['.' + ext] } }] }); const writable = await fileHandle.createWritable(); await writable.write(blob); await writable.close(); showToast("File Saved Successfully!"); return; } catch (e) { console.warn("SaveFilePicker cancelled", e); } }
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500); showToast("File Downloaded!");
    } catch (err) { alert("Export failed: " + err.message); }
}

window.exportFullJSONBackup = async function() { window.toggleSidebar(false); const backupData = JSON.stringify(appState); await smartExportFile(`DISCOM_Backup_${new Date().getTime()}.json`, backupData, "application/json"); }
window.handleImportChoice = function(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async function(event) { try { const content = event.target.result; const importedData = JSON.parse(content); if (importedData.feeders && importedData.gssNodes) { appState = importedData; triggerPersistence(); renderEntireNetwork(); showToast("Data Imported!"); } else alert("Invalid Backup Format!"); } catch (err) { alert("Error parsing file."); } }; reader.readAsText(file); e.target.value = ''; window.toggleSidebar(false); }

window.getCSVString = function() {
    const net = getActiveNetwork(); let csv = "\uFEFFWKT,Name,Type,ParentNode,Details\n"; 
    Object.values(appState.gssNodes).forEach(g => csv += `"POINT (${g.lng} ${g.lat})","${g.name}","GSS","","Code: ${g.code}"\n`);
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})","Pole ${p.poleNo}","POLE","${p.dtCode||p.poleNo}","Type: ${p.lineType} | Config: ${p.poleType} (${p.poleConfig})" \n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})","DT ${d.code}","DT","${d.parentPole}","Rating: ${d.rating}kVA"\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})","${c.name}","CONSUMER","${c.parentRef}","KNo: ${c.kno} | Load: ${c.load}"\n`);
    net.lines.forEach(l => { if (l.coords && l.coords.length === 2) csv += `"LINESTRING (${l.coords[0][1]} ${l.coords[0][0]}, ${l.coords[1][1]} ${l.coords[1][0]})","${l.type}","LINE","${l.fromNode} ➔ ${l.toNode}","Dist: ${(l.distanceMeters||0).toFixed(1)}m | Cond: ${l.conductor}"\n`; });
    return csv;
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
        var list = [ permissions.ACCESS_FINE_LOCATION, permissions.WRITE_EXTERNAL_STORAGE, permissions.READ_EXTERNAL_STORAGE, permissions.CAMERA ];
        permissions.requestPermissions(list, function(status) {
            if(!status.hasPermission) document.getElementById('permission-overlay').style.display = 'flex';
            else { document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions(); }
        }, function() { document.getElementById('permission-overlay').style.display = 'flex'; });
    } else {
        document.getElementById('permission-overlay').style.display = 'none';
        initializeAppPostPermissions(); 
    }
}

async function initializeAppPostPermissions() {
    try {
        initMapLayers();
        if (typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        let data = null;
        if (typeof localforage !== 'undefined') data = await localforage.getItem(DB_KEY); 
        if (!data) { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        
        if (data && data.feeders) appState = data; 
        
        applyTranslations();
        applyTheme();
        
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); 
            // Fix 1 & 5: Ensure map sizes properly before drawing
            setTimeout(() => {
                if(map) map.invalidateSize();
                renderEntireNetwork(); 
                centerMapOnGSS(); 
                checkOnboardingFlow(); 
            }, 100);
        } else { 
            document.getElementById('app-container').style.display = 'none'; 
            document.getElementById('auth-screen').style.display = 'flex'; 
        }
        
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; 
                    appState.user.email = data.session.user.email; 
                    appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); 
                    pullFromSupabase(); 
                }
            }).catch(err => console.log("Offline mode"));
        }
    } catch (e) { 
        console.error("Init Error:", e); 
        document.getElementById('app-container').style.display = 'none'; 
        document.getElementById('auth-screen').style.display = 'flex'; 
        showToast("Offline Mode / Load Error");
    }
}

function startAppStartupSequence() {
    setTimeout(() => {
        const loader = document.getElementById('erection-loader');
        if(loader) loader.style.display = 'none';
        
        if(window.cordova && cordova.plugins && cordova.plugins.permissions) {
            var permissions = cordova.plugins.permissions;
            permissions.hasPermission(permissions.ACCESS_FINE_LOCATION, function(status) {
                if (status.hasPermission) {
                    initializeAppPostPermissions();
                } else {
                    document.getElementById('permission-overlay').style.display = 'flex';
                }
            }, function() {
                document.getElementById('permission-overlay').style.display = 'flex';
            });
        } else {
            initializeAppPostPermissions();
        }
    }, 2000);
}

document.addEventListener('deviceready', startAppStartupSequence, false); 
if (!window.cordova) { window.addEventListener('DOMContentLoaded', startAppStartupSequence); }
