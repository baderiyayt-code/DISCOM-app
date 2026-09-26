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
    currentFeederCode: null, 
    gssNodes: {}, feeders: {}, 
    dirtyItems: { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] }, 
    deletedItems: { gss: [], feeders: [], objects: [] }, 
    orphanPoleIds: new Set(), activeMove: null, placementType: null, unsyncedCount: 0
};

let historyStack = []; let map = null;
window.haptic = function(pattern) { if (window.cordova && navigator.vibrate) navigator.vibrate(pattern); };

// ==== 🚀 ANIMATED POLE LOADER ====
window.showLoader = function(text = "Syncing Data...") {
    let loader = document.getElementById('discom-global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'discom-global-loader';
        loader.innerHTML = `
            <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                <svg width="200" height="100" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">
                    <rect x="20" y="30" width="6" height="50" rx="2" fill="#94a3b8" />
                    <rect x="70" y="30" width="6" height="50" rx="2" fill="#94a3b8" />
                    <rect x="120" y="30" width="6" height="50" rx="2" fill="#94a3b8" />
                    <rect x="170" y="30" width="6" height="50" rx="2" fill="#94a3b8" />
                    <path d="M 23 30 Q 45 55 73 30 Q 95 55 123 30 Q 145 55 173 30" fill="none" stroke="#eab308" stroke-width="3" stroke-linecap="round" stroke-dasharray="250" stroke-dashoffset="250">
                        <animate attributeName="stroke-dashoffset" values="250;0" dur="1.5s" repeatCount="indefinite" />
                    </path>
                    <circle cx="23" cy="30" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0s"/></circle>
                    <circle cx="73" cy="30" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.4s"/></circle>
                    <circle cx="123" cy="30" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.8s"/></circle>
                    <circle cx="173" cy="30" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1.2s"/></circle>
                </svg>
                <div id="loader-text" style="color:#fff; font-weight:700; margin-top:20px; font-size:1.1rem;">${text}</div>
            </div>`;
        document.body.appendChild(loader);
    } else {
        document.getElementById('loader-text').innerText = text;
        loader.style.display = 'flex';
    }
};

window.hideLoader = function() { const l = document.getElementById('discom-global-loader'); if (l) l.style.display = 'none'; };
window.safeSetDisplay = function(id, val) { const el = document.getElementById(id); if (el) el.style.display = val; };

window.calculateUnsynced = function() {
    let count = 0;
    if(appState.dirtyItems) Object.values(appState.dirtyItems).forEach(arr => count += arr.length);
    if(appState.deletedItems) Object.values(appState.deletedItems).forEach(arr => count += arr.length);
    appState.unsyncedCount = count;
    const badge = document.getElementById('sync-badge');
    if(badge) { badge.innerText = count; badge.style.display = count > 0 ? 'block' : 'none'; }
};

const i18n = {
    en: { line11: "11 KV Line", lineLT: "LT Line", dt3ph: "3-Ph DT", dt1ph: "1-Ph DT", totalCons: "Consumers", addFeeder: "Add Feeder", manageFdr: "Manage Feeders", gssMgmt: "GSS Management", exportJson: "Backup Data", settings: "Settings", logout: "Logout Securely", saveFeeder: "Save Feeder", addNewGss: "Add New GSS" },
    hi: { line11: "11 केवी लाइन", lineLT: "एलटी लाइन", dt3ph: "3-फेज डीटी", dt1ph: "1-फेज डीटी", totalCons: "उपभोक्ता", addFeeder: "फीडर जोड़ें", manageFdr: "फीडर सेटिंग्स", gssMgmt: "जीएसएस प्रबंधन", exportJson: "बैकअप बनाएं", settings: "सेटिंग्स", logout: "लॉगआउट करें", saveFeeder: "फीडर सेव करें", addNewGss: "नया जीएसएस जोड़ें" }
};

function t(key) { const lang = appState.settings.language || 'en'; return (i18n[lang] && i18n[lang][key]) ? i18n[lang][key] : (i18n['en'][key] || key); }
function translateApp() { document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if (el.tagName.toLowerCase() === 'input') el.placeholder = t(key); else el.innerHTML = t(key); }); }

function getActiveNetwork() {
    const fKeys = Object.keys(appState.feeders);
    if (fKeys.length === 0) return null; 
    if (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = fKeys[0];
    let net = appState.feeders[appState.currentFeederCode];
    if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

function showToast(msg) {
    const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg');
    if (!toast || !msgElem) return; msgElem.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
}

function setSyncStatus(status) {
    const ind = document.getElementById('sync-indicator'); if (!ind) return;
    if(!navigator.onLine) status = 'offline';
    let h = '';
    if(status === 'syncing') h = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>';
    else if(status === 'synced') h = '<i class="fa-solid fa-cloud-check sync-success"></i>';
    else h = '<i class="fa-solid fa-cloud-xmark sync-error"></i>';
    ind.innerHTML = h + `<span class="sync-badge" id="sync-badge" style="display:${appState.unsyncedCount > 0 ? 'block' : 'none'};">${appState.unsyncedCount}</span>`;
}

window.markDirty = function(type, id) {
    if (!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
    if (!appState.dirtyItems[type]) appState.dirtyItems[type] = [];
    if (!appState.dirtyItems[type].includes(id)) { appState.dirtyItems[type].push(id); window.calculateUnsynced(); }
};

window.markDeleted = function(cat, id) {
    if (!appState.deletedItems) appState.deletedItems = { gss: [], feeders: [], objects: [] };
    if (!appState.deletedItems[cat]) appState.deletedItems[cat] = [];
    if (!appState.deletedItems[cat].includes(id)) { appState.deletedItems[cat].push(id); window.calculateUnsynced(); }
};

const checkDirty = (type, id) => { return appState.dirtyItems && appState.dirtyItems[type] && appState.dirtyItems[type].includes(id); };

window.addEventListener('online', async () => {
    setSyncStatus('syncing'); showToast("Online! Auto-syncing...");
    const hasD = Object.values(appState.dirtyItems).some(a => a.length > 0) || Object.values(appState.deletedItems).some(a => a.length > 0);
    if (hasD) { await window.syncToSupabase(false); setTimeout(() => { pullFromSupabase(true); }, 3000); } 
    else { pullFromSupabase(true); }
});
window.addEventListener('offline', () => { setSyncStatus('offline'); showToast("Offline Mode. Data saved locally."); });

function cleanData(arr) { return arr.map(obj => { let cl = {}; for(let k in obj) { if(obj[k] !== undefined && obj[k] !== null) cl[k] = obj[k]; } return cl; }); }

// ==== 🚀 SYNC TO SUPABASE (UPSERT & DELETE) ====
window.syncToSupabase = async function(manual = false) {
    if (manual) window.haptic(15);
    if (!navigator.onLine) { setSyncStatus('offline'); if(manual) showToast("Saved Locally! Will sync online."); return; }
    if (!appState.user.isLoggedIn || !supabaseClient) return; 
    
    const hasD = Object.values(appState.dirtyItems).some(a => a.length > 0) || Object.values(appState.deletedItems).some(a => a.length > 0);
    if(!hasD) { setSyncStatus('synced'); return; }

    window.isSyncingLocal = true; setSyncStatus('syncing'); if(manual) window.showLoader("Syncing Cloud...");

    try {
        const uid = appState.user.id; let gssP = [], fdrP = [], objP = [], photoP = [];

        Object.values(appState.gssNodes).forEach(g => {
            if(g && g.code && checkDirty('GSS', g.code)) { gssP.push({ gss_code: String(g.code), gss_name: g.name, lat: g.lat, lng: g.lng, user_id: uid }); }
        });

        Object.keys(appState.feeders).forEach(fCode => {
            const net = appState.feeders[fCode];
            if(net && net.feeder && checkDirty('FEEDER', fCode)) { fdrP.push({ feeder_code: String(fCode), gss_code: String(net.feeder.parentGss), feeder_name: net.feeder.name, user_id: uid }); }
            
            const processNode = (p, type) => {
                if(checkDirty(type, p.id)) {
                    let copy = { ...p };
                    if(copy.photo && copy.photo.startsWith('data:image')) { photoP.push({ parent_id: String(p.id), image_data: copy.photo, user_id: uid }); copy.hasPhoto = true; } else { copy.hasPhoto = !!copy.hasPhoto; }
                    delete copy.photo; objP.push({ id: String(p.id), feeder_code: String(fCode), type: type, data: copy, user_id: uid }); 
                }
            };
            if(Array.isArray(net.poles)) net.poles.forEach(p => processNode(p, 'POLE'));
            if(Array.isArray(net.dts)) net.dts.forEach(d => processNode(d, 'DT'));
            if(Array.isArray(net.lines)) net.lines.forEach(l => processNode(l, 'LINE'));
            if(Array.isArray(net.consumers)) net.consumers.forEach(c => processNode(c, 'CONSUMER'));
        });

        if (gssP.length > 0) await supabaseClient.from('gss_records').upsert(cleanData(gssP));
        if (fdrP.length > 0) await supabaseClient.from('feeder_records').upsert(cleanData(fdrP));
        if (objP.length > 0) await supabaseClient.from('network_objects').upsert(JSON.parse(JSON.stringify(cleanData(objP))));
        if (photoP.length > 0) await supabaseClient.from('object_photos').upsert(photoP);

        if (appState.deletedItems.gss.length > 0) await supabaseClient.from('gss_records').delete().eq('user_id', uid).in('gss_code', appState.deletedItems.gss.map(String));
        if (appState.deletedItems.feeders.length > 0) await supabaseClient.from('feeder_records').delete().eq('user_id', uid).in('feeder_code', appState.deletedItems.feeders.map(String));
        if (appState.deletedItems.objects.length > 0) {
            const ids = appState.deletedItems.objects.map(String);
            await supabaseClient.from('network_objects').delete().eq('user_id', uid).in('id', ids);
            await supabaseClient.from('object_photos').delete().eq('user_id', uid).in('parent_id', ids);
        }

        appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
        appState.deletedItems = { gss: [], feeders: [], objects: [] }; window.calculateUnsynced();
        setSyncStatus('synced');
    } catch (err) { console.error("Sync Err:", err); setSyncStatus('offline'); } 
    finally { if(manual) window.hideLoader(); setTimeout(() => { window.isSyncingLocal = false; }, 1500); }
}

// ==== 🚀 PULL FROM SUPABASE (LATEST TIMESTAMP WINS) ====
async function pullFromSupabase(isBackground = true) {
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    if (!appState.user.isLoggedIn || !supabaseClient) return; 
    if(!isBackground) { setSyncStatus('syncing'); window.showLoader("Merging Map Data..."); }
    
    try {
        const uid = appState.user.id;
        const [gssRes, fdrRes, objRes] = await Promise.all([
            supabaseClient.from('gss_records').select('*').eq('user_id', uid),
            supabaseClient.from('feeder_records').select('*').eq('user_id', uid),
            supabaseClient.from('network_objects').select('*').eq('user_id', uid)
        ]);

        const isCloudEmpty = (!gssRes.data || gssRes.data.length === 0) && (!objRes.data || objRes.data.length === 0);
        let hasLocalData = false;
        if(appState.feeders) { Object.keys(appState.feeders).forEach(fCode => { if (appState.feeders[fCode].poles.length > 0) hasLocalData = true; }); }

        if (isCloudEmpty && hasLocalData) { window.hideLoader(); setTimeout(() => { window.syncToSupabase(false); }, 1500); return; }

        let newGss = {}, newFeeders = {}; const oldF = appState.feeders; 

        if (gssRes.data) gssRes.data.forEach(g => { if (!checkDirty('GSS', g.gss_code)) { newGss[g.gss_code] = { code: g.gss_code, name: g.gss_name, lat: g.lat, lng: g.lng }; } });
        if (fdrRes.data) fdrRes.data.forEach(f => { if (!checkDirty('FEEDER', f.feeder_code)) { newFeeders[f.feeder_code] = { feeder: { code: f.feeder_code, name: f.feeder_name, parentGss: f.gss_code, subdivCode: "SD-01" }, poles: [], dts: [], lines: [], consumers: [] }; } });

        Object.keys(appState.feeders).forEach(fc => { if(!newFeeders[fc]) newFeeders[fc] = { feeder: appState.feeders[fc].feeder, poles: [], dts: [], lines: [], consumers: [] }; });

        const injectDirty = (type, arrName) => {
            if(appState.dirtyItems[type]) {
                appState.dirtyItems[type].forEach(id => {
                    Object.keys(oldF).forEach(fCode => {
                        let item = oldF[fCode][arrName].find(x => x.id === id);
                        if(item) {
                            if(!newFeeders[fCode]) newFeeders[fCode] = { feeder: { code: fCode, name: "Feeder "+fCode, parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] };
                            if(!newFeeders[fCode][arrName].some(x => x.id === id)) newFeeders[fCode][arrName].push(item);
                        }
                    });
                });
            }
        };
        injectDirty('POLE', 'poles'); injectDirty('DT', 'dts'); injectDirty('LINE', 'lines'); injectDirty('CONSUMER', 'consumers');

        if (objRes.data) {
            objRes.data.forEach(obj => {
                const fc = String(obj.feeder_code);
                if(!newFeeders[fc]) newFeeders[fc] = { feeder: { code: fc, name: "Feeder "+fc, parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] };
                
                let d = obj.data; if(!d) return; d.id = obj.id; d.feederCode = fc; 
                let localObj = null;
                try {
                    if(oldF[fc]) {
                        let oldArr = obj.type === 'POLE' ? oldF[fc].poles : obj.type === 'DT' ? oldF[fc].dts : obj.type === 'CONSUMER' ? oldF[fc].consumers : obj.type === 'LINE' ? oldF[fc].lines : null;
                        if(oldArr) localObj = oldArr.find(x => x.id === d.id);
                    }
                } catch(e){}

                const cTime = d.updatedAt || 0; const lTime = localObj ? (localObj.updatedAt || 0) : 0;

                if (localObj && lTime > cTime) { window.markDirty(obj.type, d.id); d = localObj; } 
                else if (localObj && localObj.photo && !d.hasPhoto) { d.photo = localObj.photo; }

                const arrName = obj.type === 'POLE' ? 'poles' : obj.type === 'DT' ? 'dts' : obj.type === 'LINE' ? 'lines' : 'consumers';
                if(!newFeeders[fc][arrName].some(x => x.id === d.id)) newFeeders[fc][arrName].push(d);
            });
        }

        appState.gssNodes = { ...newGss, ...appState.gssNodes }; appState.feeders = newFeeders;
        const validFeeders = Object.keys(appState.feeders);
        if(validFeeders.length === 0) appState.currentFeederCode = null; else if(!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = validFeeders[0];
        
        window.calculateUnsynced(); getActiveNetwork(); 
        if (typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState);
        
        renderEntireNetwork(); 
        if(map && !isBackground) { setTimeout(() => { map.invalidateSize(); }, 300); }
        if(!isBackground) centerMapOnGSS(); setSyncStatus('synced'); 

        const hasD = Object.values(appState.dirtyItems).some(a => a.length > 0) || Object.values(appState.deletedItems).some(a => a.length > 0);
        if(hasD) { setTimeout(() => { window.syncToSupabase(false); }, 2000); }
    } catch (err) { console.error("Pull error:", err); setSyncStatus('offline'); }
    finally { if(!isBackground) window.hideLoader(); }
}

function triggerPersistence(inc = true) { 
    if(typeof localforage !== 'undefined') {
        localforage.setItem(DB_KEY, appState).then(() => { if(navigator.onLine) syncToSupabase(false); else showToast("Saved Locally! App is Offline."); })
        .catch(() => { localStorage.setItem(DB_KEY, JSON.stringify(appState)); if(navigator.onLine) syncToSupabase(false); });
    } else {
        localStorage.setItem(DB_KEY, JSON.stringify(appState)); if(navigator.onLine) syncToSupabase(false);
    }
}

// ==== AUTHENTICATION ====
let authMode = 'login';
window.toggleAuthMode = function() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    window.safeSetDisplay('loginBtn', authMode === 'login' ? 'inline-block' : 'none');
    window.safeSetDisplay('signupBtn', authMode === 'signup' ? 'inline-block' : 'none');
    window.safeSetDisplay('signupNameField', authMode === 'signup' ? 'block' : 'none');
    const txt = document.getElementById('authToggleText'); if(txt) txt.innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login";
}

function applyAuthUIVisuals() {
    window.safeSetDisplay('auth-screen', 'none'); window.safeSetDisplay('app-container', 'flex');
    const uN = document.getElementById('userNameDisplay'); if(uN) uN.innerText = appState.user.name; 
    const uE = document.getElementById('userEmailDisplay'); if(uE) uE.innerText = appState.user.email;
    window.safeSetDisplay('adminPasswordCard', (appState.user.email === ADMIN_EMAIL) ? 'block' : 'none');
    if(map) setTimeout(() => { map.invalidateSize(); }, 300);
}

window.handleSupabaseAuth = async function(mode) {
    if(!navigator.onLine) return alert("You need internet connection to Login/Signup.");
    if(!supabaseClient) return alert("Network Error: Supabase connection failed.");
    const email = document.getElementById('authEmail').value.trim(), password = document.getElementById('authPassword').value.trim(), name = document.getElementById('authName').value.trim();
    if(!email || !password) return alert("Email and Password required"); showToast("Processing..."); window.showLoader("Authenticating..."); let response;
    
    try {
        if (mode === 'signup') { 
            if(!name) return alert("Enter Full Name"); 
            response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } }); 
        } else { response = await supabaseClient.auth.signInWithPassword({ email, password }); }

        if (response.error) { alert(response.error.message); } 
        else if (response.data.user) {
            if (appState.user.id && appState.user.id !== response.data.user.id) {
                appState.gssNodes = {}; appState.feeders = {}; appState.currentFeederCode = null;
                appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] }; appState.deletedItems = { gss: [], feeders: [], objects: [] };
                if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.removeItem(DB_KEY);
            }
            appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
            appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
            
            applyAuthUIVisuals(); 
            const hasD = Object.values(appState.dirtyItems).some(a => a.length > 0) || Object.values(appState.deletedItems).some(a => a.length > 0);
            if (hasD) { await window.syncToSupabase(false); setTimeout(() => { pullFromSupabase(false); }, 3000); } 
            else { await pullFromSupabase(false); }
            showToast("Login Successful!");
        }
    } finally { window.hideLoader(); }
}

window.handleSupabaseLogout = async function() { 
    if(supabaseClient) await supabaseClient.auth.signOut(); 
    if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.clear(); location.reload(); 
}

let featureGroups = {}; let tileLayers = {}; let layerKeys = []; let currentTileIndex = 0;
window.followLiveLocation = false;

window.capturePhoto = function(targetId) {
    if (window.cordova && navigator.camera) {
        navigator.camera.getPicture(
            function(imageData) { const b64 = "data:image/jpeg;base64," + imageData; document.getElementById(targetId).value = b64; const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = b64; prev.style.display = 'block'; } }, 
            function(err) { showToast("Camera canceled."); }, 
            { quality: 40, destinationType: navigator.camera.DestinationType.DATA_URL, targetWidth: 600, targetHeight: 600, correctOrientation: true }
        );
    } else {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
        input.onchange = e => { const file = e.target.files[0]; const reader = new FileReader(); reader.onload = ev => { const res = ev.target.result; document.getElementById(targetId).value = res; const prev = document.getElementById(targetId + '_preview'); if(prev) { prev.src = res; prev.style.display = 'block'; } }; if(file) reader.readAsDataURL(file); };
        input.click();
    }
}

// ==== 🚀 RENDER ENGINE ====
function initMapSystem() {
    if(map) return; 
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([26.9150, 75.7830], 16);
    map.on('click', () => window.closeObjectSheet()); map.on('dragstart', () => { window.followLiveLocation = false; });

    function updateMapZoomClasses() {
        if(!map) return; const z = map.getZoom(); const mapEl = document.getElementById('map');
        if(mapEl) mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-dt', 'hide-gss-square');
        map.removeLayer(featureGroups.consumers); map.removeLayer(featureGroups.consumerLines); map.removeLayer(featureGroups.ltPoles); map.removeLayer(featureGroups.ltLines); map.removeLayer(featureGroups.htPoles); map.removeLayer(featureGroups.dts); map.removeLayer(featureGroups.gss);
        
        if (z > 18) { map.addLayer(featureGroups.consumerLines); map.addLayer(featureGroups.consumers); }
        if (z > 17) { map.addLayer(featureGroups.ltPoles); } if (z > 16) { map.addLayer(featureGroups.ltLines); }
        if (z > 15) { map.addLayer(featureGroups.htPoles); } if (z > 14) { map.addLayer(featureGroups.dts); }
        if (z > 10) { map.addLayer(featureGroups.gss); } 
        if (z <= 13 && mapEl) mapEl.classList.add('hide-gss-square'); else if(mapEl) mapEl.classList.remove('hide-gss-square');
    }
    map.on('zoomend', updateMapZoomClasses); 

    tileLayers = { 
        hybrid: { name: 'Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
        street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) }
    };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

    window.toggleMapLayer = function() { window.haptic(15); map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); const li = document.getElementById('layer-indicator'); if(li) li.innerText = tileLayers[layerKeys[currentTileIndex]].name; }

    featureGroups = { gss: L.featureGroup().addTo(map), htLines: L.featureGroup().addTo(map), ltLines: L.featureGroup().addTo(map), consumerLines: L.featureGroup().addTo(map), htPoles: L.featureGroup().addTo(map), ltPoles: L.featureGroup().addTo(map), dts: L.featureGroup().addTo(map), consumers: L.featureGroup().addTo(map) };
    
    map.on('move', () => { 
        const c = map.getCenter(); const rc = document.getElementById('reticle-coordinates'); if(rc) rc.innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        const pin = document.getElementById('center-placement-pin');
        
        if (pin && pin.style.display === 'block') {
            const net = getActiveNetwork();
            if(net) {
                let nodes = [...net.poles, ...net.dts];
                if(net.feeder && net.feeder.parentGss && appState.gssNodes[net.feeder.parentGss]) nodes.push(appState.gssNodes[net.feeder.parentGss]);
                if(nodes.length > 0) {
                    let nearest = nodes[0]; let minDist = window.calcDistance(c.lat, c.lng, nearest.lat, nearest.lng);
                    for(let n of nodes) { 
                        if(n.lat && n.lng) {
                            let d = window.calcDistance(c.lat, c.lng, n.lat, n.lng); 
                            if(d < minDist) { minDist = d; nearest = n; }
                        }
                    }
                    const distEl = document.getElementById('live-distance-meter'); 
                    if(distEl) { distEl.innerText = `Nearest Node: ${window.formatDistance(minDist)}`; distEl.style.display = 'block'; }
                }
            }
        } else { window.safeSetDisplay('live-distance-meter', 'none'); }
    });
    setTimeout(updateMapZoomClasses, 100);
}

function centerMapOnGSS() {
    if(!map) return; 
    let targetGss = null; const net = getActiveNetwork();
    if (net && net.feeder && appState.gssNodes[net.feeder.parentGss]) targetGss = appState.gssNodes[net.feeder.parentGss];
    else if (Object.keys(appState.gssNodes).length > 0) targetGss = appState.gssNodes[Object.keys(appState.gssNodes)[0]];
    if (targetGss && typeof targetGss.lat !== 'undefined') { setTimeout(() => { map.invalidateSize(); map.setView([parseFloat(targetGss.lat), parseFloat(targetGss.lng)], 16); }, 200); }
}

window.liveTrackingId = null; window.liveUserMarker = null;
window.toggleLiveTracking = function() {
    window.haptic(15); if (!map) return; if (!navigator.geolocation) return alert("Geolocation API not found.");
    if (window.liveTrackingId) {
        if (!window.followLiveLocation) { window.followLiveLocation = true; if (window.liveUserMarker) map.setView(window.liveUserMarker.getLatLng(), 19); showToast("Map re-centered to location"); } 
        else { navigator.geolocation.clearWatch(window.liveTrackingId); window.liveTrackingId = null; if (window.liveUserMarker) { map.removeLayer(window.liveUserMarker); window.liveUserMarker = null; } const tb = document.getElementById('liveTrackBtn'); if(tb) tb.style.color = '#ef4444'; window.followLiveLocation = false; showToast("Live tracking disabled."); }
    } else {
        showToast("Fetching location..."); window.followLiveLocation = true;
        window.liveTrackingId = navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (!window.liveUserMarker) { const humanIcon = L.divIcon({ className: 'live-human-icon', html: '', iconSize: [24,24], iconAnchor: [12,12] }); window.liveUserMarker = L.marker([lat, lng], {icon: humanIcon, zIndexOffset: 5000}).addTo(map); } 
            else window.liveUserMarker.setLatLng([lat, lng]);
            if (window.followLiveLocation) map.setView([lat, lng], 19);
            const tb = document.getElementById('liveTrackBtn'); if(tb) tb.style.color = '#10b981';
        }, (err) => alert("GPS Error."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }
}

window.openObjectSheet = function(type, id) {
    window.haptic(15); const net = getActiveNetwork(); if(!net && type !== 'GSS') return;
    let obj = null, title = '', subtitle = '', details = '', actions = '';
    
    // UI Builder Logic...
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
    
    let photoHtml = '';
    if(obj && obj.hasPhoto) {
        if(obj.photo && obj.photo.startsWith('data:image')) {
            photoHtml = `<img src="${obj.photo}" class="sheet-photo">`;
        } else {
            const idStr = obj.id || obj.code;
            photoHtml = `<img src="" id="async-photo-${idStr}" class="sheet-photo" style="display:none; background:#1e293b; object-fit:contain;">
                         <div id="photo-loader-${idStr}" style="text-align:center; padding:30px 10px; color:var(--text-sub); font-size:0.85rem; background:var(--bg-base); border-radius:12px; margin-bottom:16px;">
                            <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem; color:var(--accent); margin-bottom:8px;"></i><br>Loading Photo...
                         </div>`;
            if(navigator.onLine) {
                supabaseClient.from('object_photos').select('image_data').eq('parent_id', idStr).single().then(({data}) => {
                    if(data && data.image_data) {
                        obj.photo = data.image_data;
                        const imgEl = document.getElementById(`async-photo-${idStr}`); const loaderEl = document.getElementById(`photo-loader-${idStr}`);
                        if(imgEl) { imgEl.src = obj.photo; imgEl.style.display = 'block'; } if(loaderEl) loaderEl.style.display = 'none';
                        if (typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState);
                    } else { const loaderEl = document.getElementById(`photo-loader-${idStr}`); if(loaderEl) loaderEl.innerHTML = '<i class="fa-solid fa-image-slash" style="font-size:1.5rem; margin-bottom:8px;"></i><br>Photo not found'; }
                });
            } else { photoHtml = `<div style="text-align:center; padding:20px; background:#1e293b; color:#fff; border-radius:12px; margin-bottom:15px;"><i class="fa-solid fa-wifi" style="color:#ef4444; font-size:1.5rem; margin-bottom:10px;"></i><br>Go online to view HD Photo</div>`; }
        }
    } else if (obj && obj.photo) { photoHtml = `<img src="${obj.photo}" class="sheet-photo">`; }

    const osc = document.getElementById('obj-sheet-content');
    if(osc) osc.innerHTML = `${photoHtml}<h3 class="sheet-obj-title">${title}</h3><p class="sheet-obj-subtitle">${subtitle}</p>${details}<div class="sheet-actions-row">${actions}</div>`;
    const bis = document.getElementById('bottom-info-sheet'); if(bis) bis.classList.add('open');
};
window.closeObjectSheet = function() { window.haptic(15); const bis = document.getElementById('bottom-info-sheet'); if(bis) bis.classList.remove('open'); };

function calculateParallelCoords(p1, p2, offsetMeters) {
    const R = 6378137, lat1 = p1.lat * Math.PI/180, lng1 = p1.lng * Math.PI/180, lat2 = p2.lat * Math.PI/180, lng2 = p2.lng * Math.PI/180;
    const bearing = Math.atan2(Math.sin(lng2-lng1)*Math.cos(lat2), Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(lng2-lng1));
    const angle = bearing + Math.PI/2, dLat = (offsetMeters / R) * Math.cos(angle) * (180/Math.PI), dLng = (offsetMeters / (R * Math.cos(lat1))) * Math.sin(angle) * (180/Math.PI);
    return [ [p1.lat + dLat, p1.lng + dLng], [p2.lat + dLat, p2.lng + dLng] ];
}

// ==== 🚀 FULLY OPTIMIZED RENDERER ====
function renderEntireNetwork() {
    if(!map) return;
    try {
        const fSelect = document.getElementById('feederSelectHeader');
        if (fSelect) {
            if (Object.keys(appState.feeders).length > 0) {
                fSelect.innerHTML = Object.keys(appState.feeders).map(code => { return `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${appState.feeders[code]?.feeder?.name || `Feeder ${code}`}</option>`; }).join('');
            } else { fSelect.innerHTML = '<option value="">No Feeder Available</option>'; }
        }

        const net = getActiveNetwork();
        
        if (!net) {
            const kp11 = document.getElementById('kpi11'); if(kp11) kp11.innerText = window.formatDistance(0);
            const kpLT = document.getElementById('kpiLT'); if(kpLT) kpLT.innerText = window.formatDistance(0);
            const kp3p = document.getElementById('kpi3Ph'); if(kp3p) kp3p.innerText = 0; 
            const kp1p = document.getElementById('kpi1Ph'); if(kp1p) kp1p.innerText = 0;
            const kpc = document.getElementById('kpiCons'); if(kpc) kpc.innerText = 0;
            Object.values(featureGroups).forEach(g => g.clearLayers()); 
            
            Object.values(appState.gssNodes).forEach(gss => {
                if (gss && gss.lat != null && gss.lng != null) {
                    if (!(appState.activeMove && appState.activeMove.id === gss.code)) {
                        const lat = parseFloat(gss.lat); const lng = parseFloat(gss.lng);
                        if(isNaN(lat) || isNaN(lng)) return; 
                        const dynZGss = Math.floor(-lat * 10000);
                        const htmlIcon = `<svg width="44" height="48" viewBox="0 0 44 48" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="22" cy="44" rx="16" ry="4" fill="rgba(0,0,0,0.4)"/><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><rect x="6" y="10" width="32" height="16" rx="6" fill="#ef4444" opacity="0.4"/><text x="22" y="30" font-size="12" font-weight="900" font-family="Inter" fill="#fff" text-anchor="middle">GSS</text></svg>`;
                        const gssIcon = L.divIcon({ className: 'svg-marker-wrapper', html: htmlIcon, iconSize: [44,48], iconAnchor: [22,16] }); 
                        const m = L.marker([lat, lng], { icon: gssIcon, zIndexOffset: 950000 + dynZGss }).addTo(featureGroups.gss);
                        m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('GSS', gss.code); });
                    }
                }
            });
            return; 
        }

        Object.values(featureGroups).forEach(g => g.clearLayers()); 
        const f = appState.filters || { lines11: true, linesLT: true, poles: true, dts: true, consumers: true };

        Object.values(appState.gssNodes).forEach(gss => {
            if (gss && gss.lat != null && gss.lng != null) {
                if (!(appState.activeMove && appState.activeMove.id === gss.code)) {
                    const lat = parseFloat(gss.lat); const lng = parseFloat(gss.lng);
                    if(isNaN(lat) || isNaN(lng)) return; 
                    const dynZGss = Math.floor(-lat * 10000);
                    const htmlIcon = `<svg width="44" height="48" viewBox="0 0 44 48" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="22" cy="44" rx="16" ry="4" fill="rgba(0,0,0,0.4)"/><rect x="6" y="10" width="32" height="32" rx="6" fill="#b91c1c" stroke="#fff" stroke-width="2"/><rect x="6" y="10" width="32" height="16" rx="6" fill="#ef4444" opacity="0.4"/><text x="22" y="30" font-size="12" font-weight="900" font-family="Inter" fill="#fff" text-anchor="middle">GSS</text></svg>`;
                    const gssIcon = L.divIcon({ className: 'svg-marker-wrapper', html: htmlIcon, iconSize: [44,48], iconAnchor: [22,16] }); 
                    const m = L.marker([lat, lng], { icon: gssIcon, zIndexOffset: 950000 + dynZGss }).addTo(featureGroups.gss);
                    m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('GSS', gss.code); });
                }
            }
        });

        if (f.poles && Array.isArray(net.poles)) {
            net.poles.forEach(p => {
                const lat = parseFloat(p.lat); const lng = parseFloat(p.lng);
                if(isNaN(lat) || isNaN(lng)) return; 
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                
                const isLT = p.lineType === 'LT'; let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];
                const color = isLT ? '#10b981' : '#fde047'; const isAlert = (p.condition === 'Tilted' || p.condition === 'Damaged'); const strokeColor = isAlert ? '#ef4444' : '#0f172a';
                const dynZ = Math.floor(-lat * 10000); const zOff = (isLT ? 100000 : 200000) + dynZ;
                let svg = ''; let w = 34, h = 48, ax = 17, ay = 12; 
                const alertBadge = isAlert ? `<circle cx="${w-5}" cy="14" r="5" fill="#ef4444" stroke="#fff" stroke-width="1.5"/><text x="${w-5}" y="17.5" font-size="9" fill="#fff" font-weight="900" font-family="sans-serif" text-anchor="middle">!</text>` : '';
                const gradientDef = `<defs><linearGradient id="grad${p.id}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="100%" stop-color="${color}"/></linearGradient></defs>`;
                const groundShadow = `<ellipse cx="${ax}" cy="${h-3}" rx="${(w/2)-2}" ry="3" fill="rgba(0,0,0,0.4)"/>`;

                if (p.structure === 'Double') { w = 40; ax = 20; ay = 12; svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${gradientDef}<ellipse cx="${ax}" cy="${h-3}" rx="14" ry="3.5" fill="rgba(0,0,0,0.4)"/><rect x="10" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="24" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="6" y="24" width="28" height="4" fill="#cbd5e1" stroke="${strokeColor}" stroke-width="1" rx="1"/><rect x="5" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="20" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`; } 
                else if (p.structure === 'Lattice Tower') { w = 40; h = 48; ax = 20; ay = 12; svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${ax}" cy="${h-3}" rx="15" ry="4" fill="rgba(0,0,0,0.4)"/><path d="M 16 16 L 8 48 M 24 16 L 32 48" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round"/><path d="M 16 16 L 8 48 M 24 16 L 32 48" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><path d="M 14 26 L 26 26 M 11 36 L 29 36" stroke="${strokeColor}" stroke-width="1.5"/><path d="M 16 16 L 26 26 M 24 16 L 14 26 M 14 26 L 29 36 M 26 26 L 11 36 M 11 36 L 32 48 M 29 36 L 8 48" stroke="${strokeColor}" stroke-width="1" opacity="0.6"/><rect x="5" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="20" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`; } 
                else if (p.structure === 'Rail Pole') { w = 34; h = 48; ax = 17; ay = 12; svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${ax}" cy="${h-3}" rx="12" ry="3.5" fill="rgba(0,0,0,0.4)"/><path d="M 14 16 L 14 48 M 20 16 L 20 48" stroke="${strokeColor}" stroke-width="2.5"/><path d="M 14 16 L 14 48 M 20 16 L 20 48" stroke="${color}" stroke-width="1"/><path d="M 11 20 L 23 20 M 11 28 L 23 28 M 11 36 L 23 36 M 11 44 L 23 44" stroke="${strokeColor}" stroke-width="1.5"/><rect x="2" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="17" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`; } 
                else { w = 34; h = 48; ax = 17; ay = 12; svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="isometric-marker" xmlns="http://www.w3.org/2000/svg">${gradientDef}${groundShadow}<rect x="14" y="16" width="6" height="${h-16}" fill="url(#grad${p.id})" stroke="${strokeColor}" stroke-width="1.5" rx="2"/><rect x="6" y="22" width="22" height="3" fill="#cbd5e1" stroke="${strokeColor}" stroke-width="1" rx="1"/><circle cx="8" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><circle cx="17" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><circle cx="26" cy="20" r="2" fill="#fff" stroke="${strokeColor}"/><rect x="2" y="0" width="30" height="14" rx="4" fill="${color}" stroke="${strokeColor}" stroke-width="1.5"/><text x="17" y="10" font-size="9" font-weight="900" font-family="Inter" fill="#0f172a" text-anchor="middle">${displayNo}</text>${alertBadge}</svg>`; }

                const targetGrp = isLT ? featureGroups.ltPoles : featureGroups.htPoles;
                const m = L.marker([lat, lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [w, h], iconAnchor: [ax, ay] }), zIndexOffset: zOff }).addTo(targetGrp);
                m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('POLE', p.id); });
            });
        }

        if (f.dts && Array.isArray(net.dts)) {
            let dtGroups = {};
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => String(x.poleNo) === String(d.parentPole)); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng) { let key = `${d.lat}_${d.lng}`; if (!dtGroups[key]) dtGroups[key] = []; dtGroups[key].push(d.id); }
            });

            net.dts.forEach(d => {
                const lat = parseFloat(d.lat); const lng = parseFloat(d.lng);
                if(isNaN(lat) || isNaN(lng)) return; 
                
                const numRating = String(d.rating).replace(/[^0-9]/g, '');
                const dynZ = Math.floor(-lat * 10000); let key = `${d.lat}_${d.lng}`; let dtIndex = dtGroups[key].indexOf(d.id);
                let dx = 0, dy = 0;
                if (dtIndex === 1) { dx = -22; dy = 14; } else if (dtIndex === 2) { dx = 22; dy = 14; } else if (dtIndex >= 3) { dx = 0; dy = 28 + ((dtIndex-3)*14); }
                
                let svg = ''; let iconAnc = [0, 0]; let iconSz = [0, 0];
                if(d.phase === 'Single Phase') { svg = `<svg width="22" height="30" viewBox="0 0 22 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="14" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="11" y1="8" x2="11" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="11" cy="3" r="2" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><text x="11" y="22" font-size="9" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`; iconAnc = [11 + dx, -6 + dy]; iconSz = [22, 30]; } 
                else { svg = `<svg width="34" height="30" viewBox="0 0 34 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="8" width="30" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="7" y1="8" x2="7" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="7" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><line x1="17" y1="8" x2="17" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="17" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><line x1="27" y1="8" x2="27" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="27" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><text x="17" y="22" font-size="10" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`; iconAnc = [17 + dx, -6 + dy]; iconSz = [34, 30]; }
                
                const m = L.marker([lat, lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: iconSz, iconAnchor: iconAnc }), zIndexOffset: 900000 + dynZ + (dtIndex * 10) }).addTo(featureGroups.dts);
                m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('DT', d.id); });
            });
        }

        if (Array.isArray(net.lines)) {
            net.lines.forEach(line => {
                const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
                if (!c1 || !c2) return; 
                
                const lat1 = parseFloat(c1.lat), lng1 = parseFloat(c1.lng); const lat2 = parseFloat(c2.lat), lng2 = parseFloat(c2.lng);
                if(isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return;

                line.coords = [[lat1, lng1], [lat2, lng2]]; line.distanceMeters = window.calcDistance(lat1, lng1, lat2, lng2); 
                const spec = getLineSpec(line.type); if (!f[spec.filterKey]) return;
                const lineGrp = spec.name.includes('LT') ? featureGroups.ltLines : featureGroups.htLines;
                let linesToDraw = [];
                
                if(line.phaseType === 'Three Phase' && !line.type.includes('UG CABLE') && !line.type.includes('LT')) {
                    linesToDraw.push({ coords: calculateParallelCoords({lat:lat1, lng:lng1}, {lat:lat2, lng:lng2}, -1.5), color: '#ef4444' }); 
                    linesToDraw.push({ coords: line.coords, color: '#eab308' }); 
                    linesToDraw.push({ coords: calculateParallelCoords({lat:lat1, lng:lng1}, {lat:lat2, lng:lng2}, 1.5), color: '#3b82f6' }); 
                } else { linesToDraw.push({ coords: line.coords, color: spec.color }); }

                linesToDraw.forEach(ld => {
                    const hitPoly = L.polyline(ld.coords, { color: 'transparent', weight: 20 }).addTo(lineGrp);
                    L.polyline(ld.coords, { color: ld.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', interactive: false, className: spec.lineClass }).addTo(lineGrp);
                    hitPoly.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('LINE', line.id); });
                });

                if(line.hasCrossing) {
                    const midLat = (lat1 + lat2) / 2, midLng = (lng1 + lng2) / 2;
                    const crossSvg = `<svg width="16" height="16" viewBox="0 0 16 16" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><line x1="2" y1="2" x2="14" y2="14" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/><line x1="14" y1="2" x2="2" y2="14" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/></svg>`;
                    L.marker([midLat, midLng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: crossSvg, iconSize: [16,16], iconAnchor: [8,8] }), zIndexOffset: 2500 }).addTo(lineGrp);
                }
            });
        }

        if (f.consumers && Array.isArray(net.consumers)) {
            net.consumers.forEach(c => {
                const lat = parseFloat(c.lat); const lng = parseFloat(c.lng);
                if(isNaN(lat) || isNaN(lng)) return;
                if (appState.activeMove && appState.activeMove.id === c.id) return; 

                const dynZ = Math.floor(-lat * 10000); let bgColor = '#10b981'; 
                if(c.status === 'DC') bgColor = '#facc15'; else if(c.status === 'PDC') bgColor = '#ef4444'; else if(c.conType === 'NDS') bgColor = '#3b82f6';
                let faIcon = '&#xf015;'; if(c.conType === 'NDS') faIcon = '&#xf1ad;'; else if(c.conType === 'AG') faIcon = '&#xf4d8;'; else if(c.conType === 'SIP/MIP') faIcon = '&#xf275;'; else if(c.conType === 'PHED') faIcon = '&#xf043;'; 

                const svg = `<svg width="26" height="34" viewBox="0 0 26 34" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><ellipse cx="13" cy="30" rx="9" ry="3.5" fill="rgba(0,0,0,0.4)"/><path d="M13 22 L13 30" stroke="#0f172a" stroke-width="2"/><circle cx="13" cy="11" r="10" fill="${bgColor}" stroke="white" stroke-width="1.5"/><text x="13" y="15" font-size="10" font-weight="900" font-family="'Font Awesome 6 Free', sans-serif" fill="white" text-anchor="middle" class="fa-svg-icon">${faIcon}</text></svg>`;
                const m = L.marker([lat, lng], { icon: L.divIcon({ className: 'svg-marker-wrapper', html: svg, iconSize: [26,34], iconAnchor: [13,11] }), zIndexOffset: 300000 + dynZ }).addTo(featureGroups.consumers);
                m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('CONSUMER', c.id); });

                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = getNodeCoords(parentStr);
                if (pCoords) {
                    const pLat = parseFloat(pCoords.lat); const pLng = parseFloat(pCoords.lng);
                    if(!isNaN(pLat) && !isNaN(pLng)) L.polyline([[lat, lng], [pLat, pLng]], { color: '#000000', weight: 1.2, dashArray: '4, 4', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
                }
            });
        }

        map.fire('zoomend');
        translateApp(); 

        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; 
        if (Array.isArray(net.lines)) net.lines.forEach(l => { if (getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); });
        if (Array.isArray(net.dts)) net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        
        const kp11 = document.getElementById('kpi11'); if(kp11) kp11.innerText = window.formatDistance(t11);
        const kpLT = document.getElementById('kpiLT'); if(kpLT) kpLT.innerText = window.formatDistance(tLT);
        const kp3p = document.getElementById('kpi3Ph'); if(kp3p) kp3p.innerText = dt3ph; 
        const kp1p = document.getElementById('kpi1Ph'); if(kp1p) kp1p.innerText = dt1ph;
        const kpc = document.getElementById('kpiCons'); if(kpc) kpc.innerText = Array.isArray(net.consumers) ? net.consumers.length : 0;
        
    } catch(err) { console.error("FATAL Rendering error:", err); }
}

function saveSnapshot() {
    const net = getActiveNetwork(); if(!net) return; historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers })));
    if (historyStack.length > 15) historyStack.shift();
}
window.undoLastAction = function() {
    window.haptic(15); if (historyStack.length === 0) return showToast("No actions to Undo!"); 
    const prevState = historyStack.pop(), net = getActiveNetwork(); if(!net) return;
    net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers;
    renderEntireNetwork(); triggerPersistence(false); showToast("Undo Successful ↺");
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

window.toggleSidebar = function(open) { window.haptic(15); const sd = document.getElementById('sidebar-drawer'); if(sd) sd.classList.toggle('open', open); const sb = document.getElementById('sidebarBackdrop'); if(sb) sb.classList.toggle('open', open); if(open) window.renderGssSidebarList(); }
window.openModal = function(html) { const msc = document.getElementById('modalSheetContent'); if(msc) msc.innerHTML = html; const fmo = document.getElementById('formModalOverlay'); if(fmo) fmo.classList.add('open'); translateApp(); }
window.closeModal = function() { const fmo = document.getElementById('formModalOverlay'); if(fmo) fmo.classList.remove('open'); }

window.openSettingsPage = function() { 
    window.toggleSidebar(false); 
    const u = document.getElementById('setUnit'); if(u) u.value = appState.settings.unit || 'm'; 
    const gi = document.getElementById('setGpsInterval'); if(gi) gi.value = appState.settings.gpsInterval || 3; 
    const ga = document.getElementById('setGpsAccuracy'); if(ga) ga.value = appState.settings.gpsAccuracy || 10; 
    const sl = document.getElementById('setLanguage'); if(sl) sl.value = appState.settings.language || 'en'; 
    const st = document.getElementById('setTheme'); if(st) st.value = appState.settings.darkMode ? 'dark' : 'light';
    const sp = document.getElementById('settings-page'); if(sp) sp.classList.add('open'); 
}
window.closeSettingsPage = function() { const sp = document.getElementById('settings-page'); if(sp) sp.classList.remove('open'); }
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
    const net = getActiveNetwork(); if(!net) return null;
    const idStr = String(nodeId);
    if (idStr.startsWith('GSS_')) { const code = idStr.replace('GSS_', ''); if (appState.gssNodes[code]) return { lat: appState.gssNodes[code].lat, lng: appState.gssNodes[code].lng }; }
    if (idStr.startsWith('DT_')) { const code = idStr.replace('DT_', ''), d = net.dts.find(x => String(x.code) === code); if (d) return { lat: d.lat, lng: d.lng }; }
    if (idStr.startsWith('POLE_')) { const code = idStr.replace('POLE_', ''), p = net.poles.find(x => String(x.poleNo) === code); if (p) return { lat: p.lat, lng: p.lng }; }
    const p = net.poles.find(x => String(x.poleNo) === idStr); if (p) return { lat: p.lat, lng: p.lng };
    const d = net.dts.find(x => String(x.code) === idStr); if (d) return { lat: d.lat, lng: d.lng };
    if (appState.gssNodes[idStr]) return { lat: appState.gssNodes[idStr].lat, lng: appState.gssNodes[idStr].lng };
    if (idStr === 'GSS' || idStr === net.feeder.code) { const g = appState.gssNodes[net.feeder.parentGss]; if(g) return { lat: g.lat, lng: g.lng }; }
    return null; 
}

// ==== APP BOOTSTRAP ====
let appInitialized = false;
async function initializeApplication() {
    if(appInitialized) return; appInitialized = true;
    if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
        const p = cordova.plugins.permissions;
        p.requestPermission(p.ACCESS_FINE_LOCATION, function() { p.requestPermission(p.CAMERA, function() { p.requestPermissions([ p.READ_EXTERNAL_STORAGE, p.WRITE_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ], function(){}, function(){}); }, function(){}); }, function(){});
    }
    
    try {
        window.safeSetDisplay('app-container', 'none'); 
        window.safeSetDisplay('auth-screen', 'flex');
        if (typeof L !== 'undefined') initMapSystem();

        let data = null;
        if (typeof localforage !== 'undefined') { data = await localforage.getItem(DB_KEY); } else { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) { 
            appState = data; 
            if (!appState.unsyncedCount) appState.unsyncedCount = 0; 
            if (!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
            if (!appState.deletedItems) appState.deletedItems = { gss: [], feeders: [], objects: [] };
        }
        
        if(appState.settings.darkMode) document.documentElement.setAttribute('data-theme', 'dark');

        translateApp(); 
        window.calculateUnsynced();
        
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); 
            renderEntireNetwork(); 
            centerMapOnGSS(); 
            
            if(navigator.onLine) {
                const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
                const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
                if (hasDirty || hasDeleted) { window.syncToSupabase(false); }
                setTimeout(() => { pullFromSupabase(true); }, 2000); 
            }
        } 
        else if (supabaseClient) {
            supabaseClient.auth.getSession().then(async ({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); 
                    renderEntireNetwork();
                    centerMapOnGSS();

                    if(navigator.onLine) {
                        const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
                        const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
                        if (hasDirty || hasDeleted) { window.syncToSupabase(false); }
                        setTimeout(() => { pullFromSupabase(true); }, 2000); 
                    }
                }
            });
        }
    } catch (e) { console.error("Initialization Error:", e); } 
    finally { if (navigator.splashscreen) setTimeout(() => { navigator.splashscreen.hide(); }, 500); }
}

document.addEventListener('deviceready', initializeApplication, false); 
window.addEventListener('DOMContentLoaded', () => { setTimeout(initializeApplication, 2500); });
