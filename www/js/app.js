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

// ==== 🚀 BEAUTIFUL DOMAIN-SPECIFIC LOADER ====
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
                <div id="loader-text" style="color:#fff; font-family:sans-serif; margin-top:20px; font-weight:700; letter-spacing:1px; font-size:1.1rem;">${text}</div>
            </div>`;
        document.body.appendChild(loader);
    } else {
        document.getElementById('loader-text').innerText = text;
        loader.style.display = 'flex';
    }
};

window.hideLoader = function() {
    const loader = document.getElementById('discom-global-loader');
    if (loader) loader.style.display = 'none';
};

window.safeSetDisplay = function(elementId, displayValue) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = displayValue;
};

function updateSyncUI() {
    const badge = document.getElementById('sync-badge');
    if (!badge) return;
    if (appState.unsyncedCount > 0) { badge.innerText = appState.unsyncedCount; badge.style.display = 'block'; } 
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
    },
    hi: {
        line11: "11 केवी लाइन", lineLT: "एलटी लाइन", dt3ph: "3-फेज डीटी", dt1ph: "1-फेज डीटी", totalCons: "उपभोक्ता",
        gssMgmt: "जीएसएस प्रबंधन", addNewGss: "नया जीएसएस जोड़ें", manageFdr: "फीडर सेटिंग्स", 
        export: "डेटा एक्सपोर्ट", exportPdf: "PDF एक्सपोर्ट", exportDxf: "DXF एक्सपोर्ट", exportKml: "KML एक्सपोर्ट", exportCsv: "CSV एक्सपोर्ट", 
        importLabel: "बैकअप और रिस्टोर", exportJson: "बैकअप बनाएं", importJson: "बैकअप डालें", system: "सिस्टम", settings: "सेटिंग्स", about: "ऐप के बारे में",
        appLanguage: "ऐप की भाषा", distUnit: "दूरी इकाई", gpsInterval: "GPS अंतराल", gpsAcc: "GPS सटीकता", resetData: "डेटा रीसेट करें",
        confirmLoc: "लोकेशन सेट करें", confirmHere: "कन्फर्म करें", cancel: "रद्द", setNewLoc: "नया लोकेशन सेट करें", target: "लक्ष्य",
        toastSettings: "सेटिंग्स सेव हो गईं!", toastDel: "सफलतापूर्वक डिलीट हुआ!", toastImport: "सफलतापूर्वक इम्पोर्ट हुआ!",
        addFeeder: "फीडर जोड़ें", saveFeeder: "फीडर सेव करें", searchObj: "सर्च करें (K-No, नाम, DT)...",
        htPole: "HT पोल", ltPole: "LT पोल", line: "लाइन", dt: "ट्रांसफार्मर", consumer: "उपभोक्ता", logout: "लॉगआउट करें"
    }
};

function t(key) { const lang = appState.settings.language || 'en'; return (i18n[lang] && i18n[lang][key]) ? i18n[lang][key] : (i18n['en'][key] || key); }
function translateApp() { document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if (el.tagName.toLowerCase() === 'input' && el.type === 'text') el.placeholder = t(key); else el.innerHTML = t(key); }); }

function getActiveNetwork() {
    const fKeys = Object.keys(appState.feeders);
    if (fKeys.length === 0) return null; 
    if (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) { appState.currentFeederCode = fKeys[0]; }
    let net = appState.feeders[appState.currentFeederCode];
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
    if(status === 'syncing') iconHtml = '<i class="fa-solid fa-cloud-arrow-up sync-active" title="Syncing in background..."></i>';
    else if(status === 'synced') iconHtml = '<i class="fa-solid fa-cloud-check sync-success" title="All data safely on cloud"></i>';
    else iconHtml = '<i class="fa-solid fa-cloud-xmark sync-error" title="Offline - Data saved locally"></i>';
    ind.innerHTML = iconHtml + `<span class="sync-badge" id="sync-badge" style="display:${appState.unsyncedCount > 0 ? 'block' : 'none'};">${appState.unsyncedCount}</span>`;
    if (status === 'synced') { appState.unsyncedCount = 0; updateSyncUI(); }
}

window.markDirty = function(type, id) {
    if (!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
    if (!appState.dirtyItems[type]) appState.dirtyItems[type] = [];
    if (!appState.dirtyItems[type].includes(id)) { appState.dirtyItems[type].push(id); }
};

window.markDeleted = function(tableCategory, id) {
    if (!appState.deletedItems) appState.deletedItems = { gss: [], feeders: [], objects: [] };
    if (!appState.deletedItems[tableCategory]) appState.deletedItems[tableCategory] = [];
    if (!appState.deletedItems[tableCategory].includes(id)) { appState.deletedItems[tableCategory].push(id); }
};

const checkDirty = (type, id) => { return appState.dirtyItems && appState.dirtyItems[type] && appState.dirtyItems[type].includes(id); };

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

// ==== 🚀 SMART BACKGROUND NETWORK WATCHER ====
window.addEventListener('online', async () => {
    setSyncStatus('syncing');
    showToast("Internet Connected! Auto-syncing...");
    
    const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
    const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
    
    if (hasDirty || hasDeleted) {
        await window.syncToSupabase(false);
        // Delay Pull by 3s so Cloud Replication completes (Prevents wiping local offline items)
        setTimeout(() => { pullFromSupabase(true); }, 3000); 
    } else {
        pullFromSupabase(true);
    }
});
window.addEventListener('offline', () => {
    setSyncStatus('offline');
    showToast("Offline Mode Active. Data saved locally.");
});

function cleanData(arr) {
    return arr.map(obj => { let cleaned = {}; for(let key in obj) { if(obj[key] !== undefined && obj[key] !== null) cleaned[key] = obj[key]; } return cleaned; });
}

// ==== 🚀 OFFLINE-FIRST SYNC UPSERT (NO LOCAL WIPE) ====
window.syncToSupabase = async function(manual = false) {
    if (manual) window.haptic(15);
    
    if (!navigator.onLine) {
        setSyncStatus('offline');
        if(manual) showToast("Saved Locally! Will sync when online.");
        return; 
    }

    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; 
    if(!appState.dirtyItems) appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
    if(!appState.deletedItems) appState.deletedItems = { gss: [], feeders: [], objects: [] };
    
    const isDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
    const isDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
    if(!isDirty && !isDeleted) { setSyncStatus('synced'); return; }

    window.isSyncingLocal = true; setSyncStatus('syncing'); 
    if(manual) window.showLoader("Syncing to Cloud...");

    try {
        const uid = appState.user.id;
        let gssPayload = [], fdrPayload = [], objPayload = [], photoPayload = [];

        Object.values(appState.gssNodes).forEach(g => {
            if(g && g.code && checkDirty('GSS', g.code)) { gssPayload.push({ gss_code: String(g.code), gss_name: g.name, lat: g.lat, lng: g.lng, user_id: uid }); }
        });

        Object.keys(appState.feeders).forEach(fCode => {
            const net = appState.feeders[fCode];
            if(net && net.feeder && net.feeder.code && checkDirty('FEEDER', fCode)) { fdrPayload.push({ feeder_code: String(fCode), gss_code: String(net.feeder.parentGss), feeder_name: net.feeder.name, user_id: uid }); }
            
            const processNode = (p, type) => {
                if(checkDirty(type, p.id)) {
                    let copy = { ...p };
                    if(copy.photo && copy.photo.startsWith('data:image')) { photoPayload.push({ parent_id: String(p.id), image_data: copy.photo, user_id: uid }); copy.hasPhoto = true; } else { copy.hasPhoto = !!copy.hasPhoto; }
                    delete copy.photo; objPayload.push({ id: String(p.id), feeder_code: String(fCode), type: type, data: copy, user_id: uid }); 
                }
            };
            if(Array.isArray(net.poles)) net.poles.forEach(p => processNode(p, 'POLE'));
            if(Array.isArray(net.dts)) net.dts.forEach(d => processNode(d, 'DT'));
            if(Array.isArray(net.lines)) net.lines.forEach(l => processNode(l, 'LINE'));
            if(Array.isArray(net.consumers)) net.consumers.forEach(c => processNode(c, 'CONSUMER'));
        });

        if (gssPayload.length > 0) await supabaseClient.from('gss_records').upsert(cleanData(gssPayload));
        if (fdrPayload.length > 0) await supabaseClient.from('feeder_records').upsert(cleanData(fdrPayload));
        if (objPayload.length > 0) await supabaseClient.from('network_objects').upsert(JSON.parse(JSON.stringify(cleanData(objPayload))));
        if (photoPayload.length > 0) await supabaseClient.from('object_photos').upsert(photoPayload);

        if (appState.deletedItems.gss && appState.deletedItems.gss.length > 0) await supabaseClient.from('gss_records').delete().eq('user_id', uid).in('gss_code', appState.deletedItems.gss.map(String));
        if (appState.deletedItems.feeders && appState.deletedItems.feeders.length > 0) await supabaseClient.from('feeder_records').delete().eq('user_id', uid).in('feeder_code', appState.deletedItems.feeders.map(String));
        if (appState.deletedItems.objects && appState.deletedItems.objects.length > 0) {
            const strIds = appState.deletedItems.objects.map(String);
            await supabaseClient.from('network_objects').delete().eq('user_id', uid).in('id', strIds);
            await supabaseClient.from('object_photos').delete().eq('user_id', uid).in('parent_id', strIds);
        }

        // Successfully pushed to cloud. We can safely clear dirty queues.
        appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] };
        appState.deletedItems = { gss: [], feeders: [], objects: [] };
        if (realtimeChannel) realtimeChannel.send({ type: 'broadcast', event: 'db-updated', payload: { timestamp: Date.now() } });
        setSyncStatus('synced');
    } catch (err) { console.error("Sync Error:", err); setSyncStatus('offline'); } 
    finally { if(manual) window.hideLoader(); setTimeout(() => { window.isSyncingLocal = false; }, 1500); }
}

// ==== 🚀 OFFLINE-FIRST NON-DESTRUCTIVE PULL ====
async function pullFromSupabase(isBackground = true) {
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    if (!appState.user.isLoggedIn || !appState.user.id || !supabaseClient) return; 
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
        if(appState.feeders) { Object.keys(appState.feeders).forEach(fCode => { if (appState.feeders[fCode].poles.length > 0 || appState.feeders[fCode].dts.length > 0) hasLocalData = true; }); }

        if (isCloudEmpty && hasLocalData) {
            window.hideLoader();
            setTimeout(() => { window.syncToSupabase(false); }, 1500);
            return;
        }

        let newGss = {}, newFeeders = {};
        const oldFeeders = appState.feeders; 

        if (gssRes.data) gssRes.data.forEach(g => { if (!checkDirty('GSS', g.gss_code)) { newGss[g.gss_code] = { code: g.gss_code, name: g.gss_name, lat: g.lat, lng: g.lng }; } });
        if (fdrRes.data) fdrRes.data.forEach(f => { if (!checkDirty('FEEDER', f.feeder_code)) { if(!newFeeders[f.feeder_code]) newFeeders[f.feeder_code] = { feeder: {}, poles: [], dts: [], lines: [], consumers: [] }; newFeeders[f.feeder_code].feeder = { code: f.feeder_code, name: f.feeder_name, parentGss: f.gss_code, subdivCode: "SD-01" }; } });

        Object.keys(appState.feeders).forEach(fc => { if(!newFeeders[fc]) newFeeders[fc] = { feeder: appState.feeders[fc].feeder, poles: [], dts: [], lines: [], consumers: [] }; });

        const injectDirty = (type, arrName) => {
            if(appState.dirtyItems && appState.dirtyItems[type]) {
                appState.dirtyItems[type].forEach(id => {
                    Object.keys(oldFeeders).forEach(fCode => {
                        let item = oldFeeders[fCode][arrName].find(x => x.id === id);
                        if(item) {
                            if(!newFeeders[fCode]) newFeeders[fCode] = { feeder: { code: fCode, name: "Feeder "+fCode, parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] };
                            newFeeders[fCode][arrName].push(item);
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
                
                if (!checkDirty(obj.type, obj.id)) {
                    let d = obj.data; if(!d) return; d.id = obj.id; d.feederCode = fc; 
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
                }
            });
        }

        appState.gssNodes = { ...newGss, ...appState.gssNodes }; 
        appState.feeders = newFeeders;
        
        const validFeeders = Object.keys(appState.feeders);
        if(validFeeders.length === 0) appState.currentFeederCode = null;
        else if(!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = validFeeders[0];
        
        appState.unsyncedCount = 0;
        
        getActiveNetwork(); 
        if (typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState);
        renderEntireNetwork(); 
        if(map && !isBackground) { setTimeout(() => { map.invalidateSize(); }, 300); }
        if(!isBackground) centerMapOnGSS(); 
        setSyncStatus('synced'); 

        const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
        const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
        if(hasDirty || hasDeleted) { setTimeout(() => { window.syncToSupabase(false); }, 2000); }

    } catch (err) { console.error("Pull error:", err); setSyncStatus('offline'); }
    finally { if(!isBackground) window.hideLoader(); }
}

function triggerPersistence(incrementSync = true) { 
    if(incrementSync) { appState.unsyncedCount = (appState.unsyncedCount || 0) + 1; updateSyncUI(); }
    
    // INSTANT LOCAL SAVE (No Network Wait)
    if(typeof localforage !== 'undefined') {
        localforage.setItem(DB_KEY, appState).then(() => {
            if(navigator.onLine) syncToSupabase(false);
            else showToast(t("toastSavedLocal") || "Saved Locally! App is Offline.");
        }).catch(() => {
            localStorage.setItem(DB_KEY, JSON.stringify(appState));
            if(navigator.onLine) syncToSupabase(false);
        });
    } else {
        localStorage.setItem(DB_KEY, JSON.stringify(appState)); 
        if(navigator.onLine) syncToSupabase(false);
    }
}

let authMode = 'login';
window.toggleAuthMode = function() {
    authMode = authMode === 'login' ? 'signup' : 'login';
    window.safeSetDisplay('loginBtn', authMode === 'login' ? 'inline-block' : 'none');
    window.safeSetDisplay('signupBtn', authMode === 'signup' ? 'inline-block' : 'none');
    window.safeSetDisplay('signupNameField', authMode === 'signup' ? 'block' : 'none');
    const toggleTxt = document.getElementById('authToggleText');
    if (toggleTxt) toggleTxt.innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login";
}

function applyAuthUIVisuals() {
    window.safeSetDisplay('auth-screen', 'none');
    window.safeSetDisplay('app-container', 'flex');
    const uName = document.getElementById('userNameDisplay'); if(uName) uName.innerText = appState.user.name; 
    const uEmail = document.getElementById('userEmailDisplay'); if(uEmail) uEmail.innerText = appState.user.email;
    window.safeSetDisplay('adminPasswordCard', (appState.user.email === ADMIN_EMAIL) ? 'block' : 'none');
    window.setupRealtimeSync();
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
        } else {
            response = await supabaseClient.auth.signInWithPassword({ email, password });
        }

        if (response.error) { alert(response.error.message); } 
        else if (response.data.user) {
            if (appState.user.id && appState.user.id !== response.data.user.id) {
                appState.gssNodes = {}; appState.feeders = {}; appState.currentFeederCode = null;
                appState.dirtyItems = { GSS: [], FEEDER: [], POLE: [], DT: [], LINE: [], CONSUMER: [] }; 
                appState.deletedItems = { gss: [], feeders: [], objects: [] };
                if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.removeItem(DB_KEY);
            }
            appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
            appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
            
            applyAuthUIVisuals(); 
            
            const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
            const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
            if (hasDirty || hasDeleted) { 
                await window.syncToSupabase(false); 
                setTimeout(() => { pullFromSupabase(false); }, 3000);
            } else {
                await pullFromSupabase(false); 
            }
            showToast("Login Successful!");
        }
    } finally { window.hideLoader(); }
}

window.changeAdminPassword = async function() {
    if(!supabaseClient) return; const newPass = document.getElementById('newAdminPassword').value.trim();
    if (!newPass || newPass.length < 6) return alert("Password must be at least 6 characters.");
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) alert("Error updating password: " + error.message); else { alert("Admin password updated successfully!"); document.getElementById('newAdminPassword').value = ''; }
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
        street: { name: 'Google Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) },
        osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) }
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
    let targetGss = null;
    const net = getActiveNetwork();
    if (net && net.feeder && appState.gssNodes[net.feeder.parentGss]) {
        targetGss = appState.gssNodes[net.feeder.parentGss];
    } else if (Object.keys(appState.gssNodes).length > 0) {
        targetGss = appState.gssNodes[Object.keys(appState.gssNodes)[0]];
    }
    
    if (targetGss && typeof targetGss.lat !== 'undefined') {
        setTimeout(() => { map.invalidateSize(); map.setView([parseFloat(targetGss.lat), parseFloat(targetGss.lng)], 16); }, 200);
    }
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
            if(navigator.onLine) {
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
            } else {
                photoHtml = `<div style="text-align:center; padding:20px; background:#1e293b; color:#fff; border-radius:12px; margin-bottom:15px;"><i class="fa-solid fa-wifi" style="color:#ef4444; font-size:1.5rem; margin-bottom:10px;"></i><br>Go online to view HD Photo</div>`;
            }
        }
    } else if (obj && obj.photo) {
        photoHtml = `<img src="${obj.photo}" class="sheet-photo">`;
    }

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

function renderEntireNetwork() {
    if(!map) return;
    try {
        const fSelect = document.getElementById('feederSelectHeader');
        if (fSelect) {
            if (Object.keys(appState.feeders).length > 0) {
                fSelect.innerHTML = Object.keys(appState.feeders).map(code => {
                    const name = appState.feeders[code]?.feeder?.name || `Feeder ${code}`;
                    return `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${name}</option>`;
                }).join('');
            } else {
                fSelect.innerHTML = '<option value="">No Feeder Available</option>';
            }
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

        updateOrphanStatus(); 
        Object.values(featureGroups).forEach(g => g.clearLayers()); 
        const f = appState.filters || { lines11: true, linesLT: true, poles: true, dts: true, consumers: true };

        Object.values(appState.gssNodes).forEach(gss => {
            try {
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
            } catch(e) { console.warn("Failed to render GSS", e); }
        });

        if (f.poles && Array.isArray(net.poles)) {
            net.poles.forEach(p => {
                try {
                    const lat = parseFloat(p.lat); const lng = parseFloat(p.lng);
                    if(isNaN(lat) || isNaN(lng)) return; 

                    const isOrphan = appState.orphanPoleIds.has(p.id), isLT = p.lineType === 'LT';
                    if (appState.activeMove && appState.activeMove.id === p.id) return;
                    let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];

                    const color = isLT ? '#10b981' : '#fde047'; const isAlert = (p.condition === 'Tilted' || p.condition === 'Damaged'); const strokeColor = isAlert ? '#ef4444' : '#0f172a';
                    const dynZ = Math.floor(-lat * 10000); const zOff = (isLT ? 100000 : 200000) + dynZ;
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
                    const m = L.marker([lat, lng], { icon: L.divIcon({ className: 'svg-marker-wrapper' + (isOrphan ? ' orphan-pulse' : ''), html: svg, iconSize: [w, h], iconAnchor: [ax, ay] }), zIndexOffset: zOff }).addTo(targetGrp);
                    m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('POLE', p.id); });
                } catch(e) { console.warn("Failed to render POLE", e); }
            });
        }

        if (f.dts && Array.isArray(net.dts)) {
            let dtGroups = {};
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => String(x.poleNo) === String(d.parentPole)); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng) { let key = `${d.lat}_${d.lng}`; if (!dtGroups[key]) dtGroups[key] = []; dtGroups[key].push(d.id); }
            });

            net.dts.forEach(d => {
                try {
                    const lat = parseFloat(d.lat); const lng = parseFloat(d.lng);
                    if(isNaN(lat) || isNaN(lng)) return; 

                    const isOrphan = appState.orphanPoleIds.has(d.id); const numRating = String(d.rating).replace(/[^0-9]/g, '');
                    const dynZ = Math.floor(-lat * 10000); let key = `${d.lat}_${d.lng}`; let dtIndex = dtGroups[key].indexOf(d.id);
                    let dx = 0, dy = 0;
                    if (dtIndex === 1) { dx = -22; dy = 14; } else if (dtIndex === 2) { dx = 22; dy = 14; } else if (dtIndex >= 3) { dx = 0; dy = 28 + ((dtIndex-3)*14); }
                    
                    let svg = ''; let iconAnc = [0, 0]; let iconSz = [0, 0];
                    if(d.phase === 'Single Phase') {
                        svg = `<svg width="22" height="30" viewBox="0 0 22 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="14" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="11" y1="8" x2="11" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="11" cy="3" r="2" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><text x="11" y="22" font-size="9" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        iconAnc = [11 + dx, -6 + dy]; iconSz = [22, 30];
                    } else {
                        svg = `<svg width="34" height="30" viewBox="0 0 34 30" class="isometric-marker" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="8" width="30" height="20" rx="3" fill="#f59e0b" stroke="#0f172a" stroke-width="1.5"/><line x1="7" y1="8" x2="7" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="7" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><line x1="17" y1="8" x2="17" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="17" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><line x1="27" y1="8" x2="27" y2="3" stroke="#0f172a" stroke-width="1.5"/><circle cx="27" cy="3" r="1.5" fill="#ef4444" stroke="#0f172a" stroke-width="1"/><text x="17" y="22" font-size="10" font-weight="900" font-family="Inter" fill="#fff" stroke="#000" stroke-width="0.5" text-anchor="middle">${numRating}</text></svg>`;
                        iconAnc = [17 + dx, -6 + dy]; iconSz = [34, 30];
                    }
                    const m = L.marker([lat, lng], { icon: L.divIcon({ className: 'svg-marker-wrapper' + (isOrphan ? ' orphan-pulse' : ''), html: svg, iconSize: iconSz, iconAnchor: iconAnc }), zIndexOffset: 900000 + dynZ + (dtIndex * 10) }).addTo(featureGroups.dts);
                    m.on('click', (e) => { L.DomEvent.stopPropagation(e); window.openObjectSheet('DT', d.id); });
                } catch(e) { console.warn("Failed to render DT", e); }
            });
        }

        if (Array.isArray(net.lines)) {
            net.lines.forEach(line => {
                try {
                    const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
                    if (!c1 || !c2) return; 
                    
                    const lat1 = parseFloat(c1.lat), lng1 = parseFloat(c1.lng);
                    const lat2 = parseFloat(c2.lat), lng2 = parseFloat(c2.lng);
                    if(isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return;

                    line.coords = [[lat1, lng1], [lat2, lng2]]; 
                    line.distanceMeters = window.calcDistance(lat1, lng1, lat2, lng2); 
                    
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
                } catch(e) { console.warn("Failed to render LINE", e); }
            });
        }

        if (f.consumers && Array.isArray(net.consumers)) {
            net.consumers.forEach(c => {
                try {
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
                } catch(e) { console.warn("Failed to render CONSUMER", e); }
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

function updateOrphanStatus() {
    appState.orphanPoleIds.clear(); 
    const net = getActiveNetwork(); 
    if(!net || !net.feeder) return;
    
    try {
        const adj = {};
        const gssCode = net.feeder.parentGss;
        const gssId = 'GSS_' + gssCode;
        adj[gssId] = [];

        if(Array.isArray(net.poles)) net.poles.forEach(p => adj['POLE_' + p.poleNo] = []);
        if(Array.isArray(net.dts)) net.dts.forEach(d => adj['DT_' + d.code] = []);

        if(Array.isArray(net.dts)) net.dts.forEach(d => {
            if(d.parentPole) {
                const pId = 'POLE_' + d.parentPole;
                if (!adj[pId]) adj[pId] = [];
                adj[pId].push('DT_' + d.code);
                if (!adj['DT_' + d.code]) adj['DT_' + d.code] = [];
                adj['DT_' + d.code].push(pId);
            }
        });

        if(Array.isArray(net.lines)) net.lines.forEach(l => {
            const u = String(l.fromNode), v = String(l.toNode);
            if (!adj[u]) adj[u] = [];
            if (!adj[v]) adj[v] = [];
            adj[u].push(v);
            adj[v].push(u);
        });

        const visited = new Set([gssId]);
        const queue = [gssId];

        while (queue.length > 0) {
            const curr = queue.shift();
            (adj[curr] || []).forEach(neighbor => {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            });
        }

        if(Array.isArray(net.poles)) net.poles.forEach(p => {
            if (!visited.has('POLE_' + p.poleNo)) appState.orphanPoleIds.add(p.id);
        });
        if(Array.isArray(net.dts)) net.dts.forEach(d => {
            if (!visited.has('DT_' + d.code)) appState.orphanPoleIds.add(d.id);
        });
    } catch(e) { console.warn("Orphan logic bypassed temporarily", e); }
}

window.runOrphanNodeChecker = function() {
    updateOrphanStatus(); const net = getActiveNetwork(); if(!net) return;
    const orphanCount = appState.orphanPoleIds.size;
    if (orphanCount === 0) return showToast("No orphan poles or nodes found! Network is fully connected.");
    let html = `<div class="sheet-head"><div class="sheet-title" style="color:#d97706;"><i class="fa-solid fa-network-wired"></i> Orphan Nodes Found (${orphanCount})</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>`;
    html += `<div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">`;
    net.poles.forEach(p => { if (appState.orphanPoleIds.has(p.id)) { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:#fef3c7; padding:10px; border-radius:8px;"><div><b>Pole: ${p.poleNo}</b><br><small>Type: ${p.lineType || 'HT'}</small></div><button class="action-btn-sm bg" onclick="window.zoomToEntity('${p.lat}', '${p.lng}')">Zoom</button></div>`; } }); html += `</div>`; openModal(html);
};

window.zoomToEntity = function(lat, lng) { window.closeModal(); map.flyTo([parseFloat(lat), parseFloat(lng)], 19, { duration: 1 }); };

window.toggleGssFolder = function() {
    window.haptic(15); const content = document.getElementById('gssFolderContent'), icon = document.getElementById('gssFolderIcon');
    if (!content || !icon) return; const isHidden = content.style.display === 'none'; window.safeSetDisplay('gssFolderContent', isHidden ? 'block' : 'none'); 
    icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderGssSidebarList();
};

window.renderGssSidebarList = function() {
    const container = document.getElementById('gssListContainer'); if (!container) return; let html = '';
    Object.values(appState.gssNodes).forEach(gss => {
        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-base); padding:8px; border-radius:6px; margin-top:6px; border:1px solid var(--border);"><div><b style="font-size:0.85rem;">${gss.name}</b><br><small style="color:var(--text-sub);">Code: ${gss.code}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="window.relocateGss('${gss.code}')" title="Relocate GSS"><i class="fa-solid fa-location-crosshairs"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="window.deleteGssAndFeederStrict('${gss.code}')" title="Strict Delete"><i class="fa-solid fa-trash"></i></button></div></div>`;
    }); container.innerHTML = html;
};

window.deleteEntity = function(type, id) {
    window.haptic([50,50,50]); const net = getActiveNetwork(); if(!confirm(t("confDel"))) return; saveSnapshot();
    
    if (type === 'line') { 
        window.markDeleted('objects', id); 
        net.lines = net.lines.filter(x => x.id !== id); 
    } 
    else if (type === 'consumer') { 
        window.markDeleted('objects', id); 
        net.consumers = net.consumers.filter(x => x.id !== id); 
    } 
    else if (type === 'dt') {
        const d = net.dts.find(x => x.id === id); if(!d) return;
        const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code)), ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)), ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn);
        net.lines.forEach(l => { if (l.fromNode === ('DT_' + d.code) || l.toNode === ('DT_' + d.code) || ltPoleNodeIds.includes(String(l.fromNode)) || ltPoleNodeIds.includes(String(l.toNode))) window.markDeleted('objects', l.id); });
        net.lines = net.lines.filter(l => l.fromNode !== ('DT_' + d.code) && l.toNode !== ('DT_' + d.code) && !ltPoleNodeIds.includes(String(l.fromNode)) && !ltPoleNodeIds.includes(String(l.toNode)));
        net.consumers.forEach(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); if(isDirectToDT || isOnRemovedLTPole) window.markDeleted('objects', c.id); });
        net.consumers = net.consumers.filter(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); return !(isDirectToDT || isOnRemovedLTPole); });
        ltPolesToRemove.forEach(p => window.markDeleted('objects', p.id));
        net.poles = net.poles.filter(p => !ltPoleIds.includes(String(p.poleNo)));
        window.markDeleted('objects', id); 
        net.dts = net.dts.filter(x => x.id !== id);
    }
    else if (type === 'pole') {
        const p = net.poles.find(x => x.id === id);
        if (p) { 
            if (p.lineType === 'LT') {
                net.consumers.forEach(c => { if(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo)) window.markDeleted('objects', c.id); });
                net.consumers = net.consumers.filter(c => !(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo)));
                net.lines.forEach(l => { if(String(l.fromNode) === ('POLE_'+p.poleNo) || String(l.toNode) === ('POLE_'+p.poleNo)) window.markDeleted('objects', l.id); });
                net.lines = net.lines.filter(l => String(l.fromNode) !== ('POLE_'+p.poleNo) && String(l.toNode) !== ('POLE_'+p.poleNo));
                window.markDeleted('objects', p.id); 
                net.poles = net.poles.filter(x => x.id !== p.id);
            } 
            else { 
                const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); 
                dtsOnPole.forEach(dt => window.deleteEntity('dt', dt.id)); 
                net.lines.forEach(l => { if(l.fromNode === ('POLE_'+p.poleNo) || l.toNode === ('POLE_'+p.poleNo)) window.markDeleted('objects', l.id); });
                net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); 
                window.markDeleted('objects', id); 
                net.poles = net.poles.filter(x => x.id !== id); 
            } 
        }
    } 
    else if (type === 'gss') { 
        if (appState.gssNodes[id]) { 
            window.markDeleted('gss', id); 
            delete appState.gssNodes[id]; 
        } 
    }
    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast(t("toastDel"));
}

window.deleteGssAndFeederStrict = function(code) {
    window.haptic([50,50,50]);
    const conf1 = confirm(`WARNING: You are about to delete GSS ${code} and ALL its associated feeders and network data! This cannot be undone. Continue?`);
    if (!conf1) return; const conf2 = prompt(`To strictly confirm deletion, please type the GSS code "${code}" below:`);
    if (conf2 !== code) return alert("Deletion cancelled: GSS code did not match.");

    if (appState.gssNodes[code]) { window.markDeleted('gss', code); delete appState.gssNodes[code]; }
    const feedersToDelete = []; Object.keys(appState.feeders).forEach(fCode => { if (appState.feeders[fCode].feeder.parentGss === code) feedersToDelete.push(fCode); });
    feedersToDelete.forEach(fCode => { window.markDeleted('feeders', fCode); delete appState.feeders[fCode]; });
    
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
    if (Object.keys(appState.gssNodes).length === 0) return alert("Please add a GSS (Substation) first before creating a feeder!");
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
    window.toggleSidebar(false); const net = getActiveNetwork(); if(!net) return;
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}" ${net.feeder.parentGss==g.code?'selected':''}>${g.code} - ${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-tower-broadcast"></i> <span data-i18n="manageFdr">Manage Feeders</span></div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Name</label><input type="text" id="cfgFeederName" class="form-input" value="${net.feeder.name}"></div><div class="form-row"><label>Parent GSS Source</label><select id="cfgParentGss" class="form-select">${gssOpts}</select></div><button class="btn-action-primary" onclick="window.saveFeederConfiguration()">Save Config</button>`);
}
window.saveFeederConfiguration = function() {
    window.haptic(30); const net = getActiveNetwork(); if(!net) return; net.feeder.name = document.getElementById('cfgFeederName').value; net.feeder.parentGss = document.getElementById('cfgParentGss').value; 
    window.markDirty('FEEDER', net.feeder.code); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(t("toastSettings"));
}

window.openAddForm = function(type) {
    window.toggleSpeedDial(false); 
    if (type !== 'GSS' && type !== 'FEEDER') {
        const net = getActiveNetwork();
        if (!net) return alert("Please create a GSS and Feeder first!");
    }
    if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { appState.placementType = type; window.safeSetDisplay('center-placement-pin', 'block'); window.safeSetDisplay('bottom-single-action', 'none'); window.safeSetDisplay('placement-confirm-bar', 'flex'); } 
    else window.showFormModal(type, null, null);
}

window.confirmPlacement = function() { 
    window.haptic(30); 
    window.safeSetDisplay('center-placement-pin', 'none'); window.safeSetDisplay('placement-confirm-bar', 'none'); window.safeSetDisplay('bottom-single-action', 'block'); 
    let center = {lat:26.9, lng:75.7}; if(map) center = map.getCenter();
    window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6))); 
}
window.cancelPlacement = function() { window.haptic(15); window.safeSetDisplay('center-placement-pin', 'none'); window.safeSetDisplay('placement-confirm-bar', 'none'); window.safeSetDisplay('bottom-single-action', 'block'); }

function getSafeCoords() {
    let lat = parseFloat(document.getElementById('inpLat')?.value);
    let lng = parseFloat(document.getElementById('inpLng')?.value);
    if(isNaN(lat) || isNaN(lng)) {
        if(map) { const c = map.getCenter(); lat = parseFloat(c.lat.toFixed(6)); lng = parseFloat(c.lng.toFixed(6)); }
        else { lat = 26.9150; lng = 75.7830; } 
    }
    return {lat, lng};
}

window.showFormModal = function(type, snapLat, snapLng, editId = null) {
    if(map) map.closePopup();
    const net = getActiveNetwork(); let center = { lat: 26.9150, lng: 75.7830 }; if(map) center = map.getCenter(); 
    snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6));
    
    let isEdit = editId !== null; let existingObj = {};
    if(isEdit && net) {
        if(type === 'POLE' || type === 'LTPOLE') existingObj = net.poles.find(x => x.id === editId) || {};
        else if(type === 'LINE') existingObj = net.lines.find(x => x.id === editId) || {};
        else if(type === 'DT') existingObj = net.dts.find(x => x.id === editId) || {};
        else if(type === 'CONSUMER') existingObj = net.consumers.find(x => x.id === editId) || {};
    }

    const formLat = isEdit ? (existingObj.lat || snapLat) : snapLat; const formLng = isEdit ? (existingObj.lng || snapLng) : snapLng;

    if (type === 'GSS') {
        const g = appState.gssNodes[editId]; if (!g) return;
        openModal(`<div class="sheet-head"><div class="sheet-title">Edit GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>GSS Name*</label><input type="text" id="editGssName" class="form-input" value="${g.name}"></div><button class="btn-action-primary" onclick="window.saveEditedGss('${g.code}')">Save Changes</button>`);
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
                <div id="polePhotoDiv" style="display:${showPhoto}; margin-bottom:12px;"><button class="btn-camera" onclick="window.capturePhoto('inpPolePhoto')"><i class="fa-solid fa-camera"></i> Capture Pole Issue</button><input type="hidden" id="inpPolePhoto" value="${photoB64}"><img id="inpPolePhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}"></div>
            </div>
            <input type="hidden" id="inpPoleCategory" value="HT"><input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.savePoleData('${editId || ''}')">Save HT Pole</button>`);
    } 
    else if (type === 'LTPOLE') {
        if (!isEdit && net.dts.length === 0) return alert("You must add a DT first before adding an LT Pole!");
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}" ${existingObj.dtCode===String(d.id)?'selected':''}>DT: ${d.id} (${window.formatDistance(window.calcDistance(snapLat, snapLng, d.lat, d.lng))})</option>`).join('');
        const selStruct = s => (existingObj.structure === s) ? 'selected' : ''; const selCond = c => (existingObj.condition === c) ? 'selected' : '';
        const photoB64 = existingObj.photo || ''; const showPhoto = (existingObj.condition==='Tilted'||existingObj.condition==='Damaged') ? 'block' : 'none';

        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit LT Pole':'Add LT Pole'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            ${isEdit ? `<div class="form-row"><label>Pole Number</label><input type="text" id="inpPoleNo" class="form-input" value="${existingObj.poleNo}" disabled style="background:var(--bg-base);"></div>` : ''}
            <div class="form-row"><label>Associated DT*</label><select id="inpLTPoleDT" class="form-select" ${isEdit?'disabled style="background:var(--bg-base);"':''}>${dtOpts}</select></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-row"><label>Pole Structure</label><select id="inpPoleStruct" class="form-select"><option value="Single" ${selStruct('Single')}>Single Pole</option><option value="Double" ${selStruct('Double')}>Double Pole</option><option value="Rail Pole" ${selStruct('Rail Pole')}>Rail Pole</option></select></div>
                <div class="form-row"><label>Condition</label><select id="inpPoleCond" class="form-select" onchange="document.getElementById('polePhotoDiv').style.display = (this.value==='Tilted'||this.value==='Damaged')?'block':'none'"><option value="OK" ${selCond('OK')}>OK</option><option value="Tilted" ${selCond('Tilted')}>Tilted</option><option value="Damaged" ${selCond('Damaged')}>Damaged</option></select></div>
                <div id="polePhotoDiv" style="display:${showPhoto}; margin-bottom:12px;"><button class="btn-camera" onclick="window.capturePhoto('inpPolePhoto')"><i class="fa-solid fa-camera"></i> Capture Pole Issue</button><input type="hidden" id="inpPolePhoto" value="${photoB64}"><img id="inpPolePhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}"></div>
            </div>
            <input type="hidden" id="inpPoleCategory" value="LT"><input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.savePoleData('${editId || ''}')">Save LT Pole</button>`);
    } 
    else if (type === 'LINE') {
        if (!isEdit && net.poles.length === 0) return alert("Add at least one pole first!");
        const selType = t => (existingObj.type && existingObj.type.includes(t)) ? 'selected' : '';
        const selPhase = p => (existingObj.phaseType === p) ? 'selected' : '';
        
        window.filterLineNodes = function() {
            const type = document.getElementById('inpLineType').value, n = getActiveNetwork(), fromSel = document.getElementById('inpFromNode'), dtSelectorBox = document.getElementById('ltLineDTSelector');
            let defaultFrom = isEdit ? existingObj.fromNode : String(document.getElementById('inpDefaultFrom').value); const ctr = map ? map.getCenter() : {lat:26.9, lng:75.7}; let nodes = [];
            if (type.includes('LT')) {
                dtSelectorBox.style.display = 'block'; const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? targetDTElem.value : ''; if(!selectedDT) return;
                nodes = n.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const dtObj = n.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
            } else {
                dtSelectorBox.style.display = 'none'; nodes = n.poles.filter(p => p.lineType !== 'LT').map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[n.feeder.parentGss]; 
                if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, ctr.lat, ctr.lng); if (!defaultFrom && nodes.length > 0) defaultFrom = nodes[0].id;
            fromSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title} (${window.formatDistance(window.calcDistance(ctr.lat, ctr.lng, n.lat, n.lng))})</option>`).join('');
            window.syncLineToSelect();
        };
        window.syncLineToSelect = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), fromVal = fromSel && fromSel.options.length > 0 ? String(fromSel.value) : '';
            const toSel = document.getElementById('inpToNode'), n = getActiveNetwork(), ctr = map ? map.getCenter() : {lat:26.9, lng:75.7}; let nodes = [];
            if (type.includes('LT')) {
                const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? String(targetDTElem.value) : '';
                nodes = n.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === selectedDT && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                if(selectedDT && ('DT_'+selectedDT) !== fromVal) { const dtObj = n.dts.find(d => String(d.code) === selectedDT); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng}); }
            } else {
                nodes = n.poles.filter(p => p.lineType !== 'LT' && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[n.feeder.parentGss]; 
                if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, ctr.lat, ctr.lng); 
            let defTo = isEdit ? existingObj.toNode : '';
            toSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defTo ? 'selected' : ''}>${n.title} (${window.formatDistance(window.calcDistance(ctr.lat, ctr.lng, n.lat, n.lng))})</option>`).join(''); 
        };
        const htNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, lat: p.lat, lng: p.lng}));
        const feederGss = appState.gssNodes[net.feeder.parentGss]; if(feederGss) htNodes.push({id: 'GSS_'+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
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
        let parentNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng})); const feederGss = appState.gssNodes[net.feeder.parentGss]; if(feederGss) parentNodes.push({id: feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}" ${existingObj.parentPole===String(p.id)?'selected':''}>${p.title} (${window.formatDistance(window.calcDistance(snapLat, snapLng, p.lat, p.lng))})</option>`).join('');
        const selMount = m => (existingObj.mountedOn === m) ? 'selected' : ''; const selPhase = p => (existingObj.phase === p) ? 'selected' : '';
        const photoB64 = existingObj.photo || ''; const titleText = isEdit ? (existingObj.name || `DT: ${existingObj.code}`) : 'Add DT';

        openModal(`<div class="sheet-head"><div class="sheet-title">${titleText}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Connected To (HT Node)*</label><select id="inpDTParent" class="form-select" onchange="window.autoUpdateDTMount()" ${isEdit?'disabled':''}>${parentOpts}</select></div>
            <div class="form-row"><label>DT Name / Location</label><input type="text" id="inpDTName" class="form-input" value="${existingObj.name||''}" placeholder="e.g. Subhash Chowk Transformer"></div>
            <div class="form-grid-2"><div class="form-row"><label>DT Code*</label><input type="number" id="inpDTCode" class="form-input" value="${existingObj.code || Math.floor(Math.random()*9000)}" ${isEdit?'disabled':''}></div><div class="form-row"><label>Rating (kVA)*</label><select id="inpDTRating" class="form-select"></select></div></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-grid-2"><div class="form-row"><label>Phase*</label><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating', '${existingObj.rating||''}')"><option value="Three Phase" ${selPhase('Three Phase')}>Three Phase</option><option value="Single Phase" ${selPhase('Single Phase')}>Single Phase</option></select></div><div class="form-row"><label>Mounted On</label><select id="inpDTMount" class="form-select"><option value="Double Pole Structure" ${selMount('Double Pole Structure')}>Double Pole Structure</option><option value="Single Pole" ${selMount('Single Pole')}>Single Pole</option></select></div></div>
                <div class="form-grid-2"><div class="form-row"><label>Sr. No</label><input type="text" id="inpDTSrNo" class="form-input" value="${existingObj.srNo||''}"></div><div class="form-row"><label>TN Number</label><input type="text" id="inpDTTN" class="form-input" value="${existingObj.tn||''}"></div></div>
                <div style="margin-bottom:12px;"><button class="btn-camera" onclick="window.capturePhoto('inpDTPhoto')"><i class="fa-solid fa-camera"></i> Capture DT Photo</button><input type="hidden" id="inpDTPhoto" value="${photoB64}"><img id="inpDTPhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}"></div>
            </div>
            <input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.saveDTData('${editId || ''}')">Save DT</button>`);
        setTimeout(() => { window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating', existingObj.rating); if(!isEdit) window.autoUpdateDTMount(); }, 30);
    } 
    else if (type === 'CONSUMER') {
        if (!isEdit && net.dts.length === 0) return alert("Must have at least one DT to connect Consumer!"); 
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); 
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join('');
        const selType = t => (existingObj.conType === t) ? 'selected' : ''; const selStat = s => (existingObj.status === s) ? 'selected' : '';
        const photoB64 = existingObj.photo || '';

        openModal(`<div class="sheet-head"><div class="sheet-title">${isEdit?'Edit Consumer':'Add Consumer'}</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="form-row"><label>Select Parent DT*</label><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()" ${isEdit?'disabled':''}>${dtOpts}</select></div>
            <div class="form-row"><label>Connects To (LT Pole / DT)*</label><select id="inpConsParent" class="form-select" ${isEdit?'disabled':''}></select></div>
            <div class="form-row"><label>Consumer Name*</label><input type="text" id="inpConsName" class="form-input" value="${existingObj.name||''}"></div>
            <div class="form-grid-2"><div class="form-row"><label>K-Number (12 Digits)*</label><input type="text" id="inpConsKno" class="form-input" value="${existingObj.kno||''}" maxlength="12" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,12);"></div><div class="form-row"><label>A/C No. (8 Digits)*</label><input type="text" id="inpConsAcNo" class="form-input" value="${existingObj.acNo||''}" maxlength="8" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,8);"></div></div>
            <div class="adv-toggle-btn" onclick="document.getElementById('advDetailsDiv').style.display='block'; this.style.display='none';">Show Advanced Details ▼</div>
            <div id="advDetailsDiv" style="display:${isEdit?'block':'none'};">
                <div class="form-grid-2"><div class="form-row"><label>Consumer Type</label><select id="inpConsType" class="form-select"><option value="DS" ${selType('DS')}>DS</option><option value="NDS" ${selType('NDS')}>NDS</option><option value="AG" ${selType('AG')}>AG</option><option value="SIP/MIP" ${selType('SIP/MIP')}>SIP/MIP</option><option value="PHED" ${selType('PHED')}>PHED</option><option value="Other" ${selType('Other')}>Other</option></select></div><div class="form-row"><label>Status</label><select id="inpConsStatus" class="form-select"><option value="Regular" ${selStat('Regular')}>Regular</option><option value="DC" ${selStat('DC')}>DC</option><option value="PDC" ${selStat('PDC')}>PDC</option></select></div></div>
                <div class="form-grid-2"><div class="form-row"><label>Meter No.</label><input type="text" id="inpConsMeter" class="form-input" value="${existingObj.meterNo||''}"></div><div class="form-row"><label>Load (kW)</label><input type="number" id="inpConsLoad" class="form-input" value="${existingObj.load||'1'}"></div></div>
                <div style="margin-bottom:12px;"><button class="btn-camera" onclick="window.capturePhoto('inpConsPhoto')"><i class="fa-solid fa-camera"></i> Capture Premises</button><input type="hidden" id="inpConsPhoto" value="${photoB64}"><img id="inpConsPhoto_preview" class="photo-preview" src="${photoB64}" style="display:${photoB64?'block':'none'}"></div>
            </div>
            <input type="hidden" id="inpLat" value="${formLat}"><input type="hidden" id="inpLng" value="${formLng}">
            <button class="btn-action-primary" onclick="window.saveConsumerData('${editId || ''}')">Save Consumer</button>`);
        setTimeout(() => { if(isEdit) { let pDT = existingObj.parentType === 'DT' ? existingObj.parentRef : net.poles.find(p=>p.poleNo==existingObj.parentRef)?.dtCode; if(pDT) document.getElementById('inpConsDT').value = pDT; } window.filterConsumerPoles(existingObj.parentRef); }, 30);
    }
}

window.saveEditedGss = function(code) {
    window.haptic(30); saveSnapshot(); const g = appState.gssNodes[code]; 
    if (g) g.name = document.getElementById('editGssName').value.trim(); 
    window.markDirty('GSS', code); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("GSS Updated"); 
}

window.savePoleData = function(editId) { 
    window.haptic(30); saveSnapshot(); 
    const category = document.getElementById('inpPoleCategory').value;
    const {lat, lng} = getSafeCoords();

    const structure = document.getElementById('inpPoleStruct').value, condition = document.getElementById('inpPoleCond').value, photo = document.getElementById('inpPolePhoto').value;
    let no = ''; const noElem = document.getElementById('inpPoleNo'); if (noElem) { no = noElem.value.trim(); }
    const net = getActiveNetwork(); if(!net) return alert("Feeder not found!");
    const fc = appState.currentFeederCode;

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
        net.poles.push({ id: newId, feederCode: fc, poleNo: no, lineType: category, structure, condition, photo, dtCode, lat, lng }); 
        window.markDirty('POLE', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveLineData = function(editId) {
    window.haptic(30); saveSnapshot(); const from = document.getElementById('inpFromNode').value, to = document.getElementById('inpToNode').value, type = document.getElementById('inpLineType').value, phaseType = document.getElementById('inpLinePhase').value, hasCrossing = document.getElementById('inpLineCrossing').checked, crossingRemark = document.getElementById('inpLineCrossRemark').value.trim();
    if (from === to) return alert("Cannot connect node to itself!"); if (!to) return alert("Please select a target node!");
    const net = getActiveNetwork(); if(!net) return alert("Feeder not found!"); 
    const spec = getLineSpec(type);
    const fc = appState.currentFeederCode;

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
        net.lines.push({ id: newId, feederCode: fc, type: spec.name, phaseType, hasCrossing, crossingRemark, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] }); 
        window.markDirty('LINE', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveDTData = function(editId) {
    window.haptic(30); saveSnapshot(); 
    const parentRef = document.getElementById('inpDTParent').value, code = document.getElementById('inpDTCode').value.trim(), rating = parseFloat(document.getElementById('inpDTRating').value), phase = document.getElementById('inpDTPhase').value, name = document.getElementById('inpDTName').value.trim();
    const location = name, srNo = document.getElementById('inpDTSrNo').value.trim(), tn = document.getElementById('inpDTTN').value.trim(), mountedOn = document.getElementById('inpDTMount').value, photo = document.getElementById('inpDTPhoto').value;
    
    if (!code) return alert(t("errReq")); const net = getActiveNetwork(); if(!net) return alert("Feeder not found!");
    const fc = appState.currentFeederCode;

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
        const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); 
        const {lat, lng} = getSafeCoords();
        
        const newId = 'DT_'+Date.now();
        net.dts.push({ id: newId, feederCode: fc, parentPole: parentRef, code, name, rating, phase, srNo, tn, mountedOn, location, photo, lat, lng });
        window.markDirty('DT', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.saveConsumerData = function(editId) {
    window.haptic(30); saveSnapshot(); const parentRef = document.getElementById('inpConsParent').value, kno = document.getElementById('inpConsKno').value.trim(), acNo = document.getElementById('inpConsAcNo').value.trim(), name = document.getElementById('inpConsName').value.trim(), meterNo = document.getElementById('inpConsMeter').value.trim(), conType = document.getElementById('inpConsType').value, status = document.getElementById('inpConsStatus').value, load = document.getElementById('inpConsLoad').value.trim(), photo = document.getElementById('inpConsPhoto').value;
    if (!name || !kno || !acNo) return alert(t("errReq")); 
    if(kno.length !== 12) return alert("K-Number must be exactly 12 digits!"); if(acNo.length !== 8) return alert("A/C No. must be exactly 8 digits!");
    const net = getActiveNetwork(); if(!net) return alert("Feeder not found!");
    const fc = appState.currentFeederCode;

    if(editId) {
        if(net.consumers.some(c => c.id !== editId && String(c.kno) === String(kno))) return alert("K-Number already exists!");
        let c = net.consumers.find(x => x.id === editId); if(!c) return;
        c.kno = kno; c.acNo = acNo; c.name = name; c.meterNo = meterNo; c.conType = conType; c.status = status; c.load = load; c.photo = photo;
        window.markDirty('CONSUMER', editId);
    } else {
        if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number already exists in this feeder!");
        let parentType = 'POLE'; const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); if (!p) parentType = 'DT';
        const {lat, lng} = getSafeCoords();

        const newId = 'CS_'+Date.now();
        net.consumers.push({ id: newId, feederCode: fc, parentRef, parentType, kno, acNo, meterNo, conType, status, name, load, photo, lat, lng }); 
        window.markDirty('CONSUMER', newId);
    }
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast(editId ? "Updated Successfully" : t("toastAdded"));
}

window.openEditModal = function(type, id) { window.showFormModal(type.toUpperCase(), null, null, id); }

window.updateDTRatingDropdowns = function(phaseId, ratingId, existingVal) {
    const phase = document.getElementById(phaseId).value, ratingSel = document.getElementById(ratingId);
    let opts = '';
    if(phase === 'Single Phase') opts = `<option value="5">5 kVA</option><option value="10">10 kVA</option><option value="16" selected>16 kVA</option><option value="25">25 kVA</option>`;
    else opts = `<option value="10">10 kVA</option><option value="16">16 kVA</option><option value="25" selected>25 kVA</option><option value="40">40 kVA</option><option value="63">63 kVA</option><option value="100">100 kVA</option><option value="160">160 kVA</option><option value="250">250 kVA</option><option value="315">315 kVA</option><option value="500">500 kVA</option>`;
    if(ratingSel){ ratingSel.innerHTML = opts; if(existingVal) ratingSel.value = existingVal; }
}

window.filterConsumerPoles = function(existingParentRef) {
    const net = getActiveNetwork(); if(!net) return;
    const selectedDT = document.getElementById('inpConsDT').value;
    const {lat, lng} = getSafeCoords();
    let nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: p.poleNo}));
    const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: selectedDT, title: 'Direct to DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
    nodes = window.sortByDistance(nodes, lat, lng); 
    const cp = document.getElementById('inpConsParent');
    if(cp) cp.innerHTML = nodes.map(n => `<option value="${n.id}" ${existingParentRef===String(n.id)?'selected':''}>${n.title} (${window.formatDistance(window.calcDistance(lat, lng, n.lat, n.lng))})</option>`).join('');
}

window.toggleSearchBox = function() {
    window.haptic(15); const box = document.getElementById('searchBoxOverlay');
    if (box && box.style.display === 'none') { window.safeSetDisplay('searchBoxOverlay', 'flex'); const sb = document.getElementById('appSearchBar'); if(sb) sb.focus(); } else { window.safeSetDisplay('searchBoxOverlay', 'none'); window.clearSearch(); }
}

window.handleSearch = function(e) {
    try {
        const query = e.target.value.toLowerCase().trim();
        const suggPanel = document.getElementById('searchSuggestions');
        if(!suggPanel) return;
        if(query.length === 0) { suggPanel.classList.remove('active'); suggPanel.style.display = 'none'; return; }
        
        const net = getActiveNetwork(); if(!net) return; let results = [];
        
        if(Array.isArray(net.consumers)) {
            net.consumers.forEach(c => { 
                if (String(c.kno).toLowerCase().includes(query) || (c.name && c.name.toLowerCase().includes(query))) 
                    results.push({ type: 'CONSUMER', id: c.id, title: c.name, desc: `K-No: ${c.kno} | Connected to: ${c.parentRef}`, lat: parseFloat(c.lat), lng: parseFloat(c.lng) }); 
            });
        }
        if(Array.isArray(net.dts)) {
            net.dts.forEach(d => { 
                if (String(d.code).toLowerCase().includes(query) || String(d.rating).includes(query) || (d.location && d.location.toLowerCase().includes(query)) || (d.name && d.name.toLowerCase().includes(query))) 
                    results.push({ type: 'DT', id: d.id, title: d.name ? d.name : `DT Code: ${d.code}`, desc: `Rating: ${d.rating} kVA | Loc: ${d.location || 'N/A'}`, lat: parseFloat(d.lat), lng: parseFloat(d.lng) }); 
            });
        }
        
        if (results.length > 0) {
            suggPanel.innerHTML = results.slice(0, 15).map(r => `<div class="suggestion-item" onclick="window.selectSearchResult('${r.type}', '${r.id}', ${r.lat}, ${r.lng})" style="padding:10px; border-bottom:1px solid #eee; cursor:pointer; background:#fff;"><div class="sugg-title" style="font-weight:bold; color:#0f172a;"><span>${r.type === 'CONSUMER' ? '<i class="fa-solid fa-house" style="color:#3b82f6;"></i>' : '<i class="fa-solid fa-bolt" style="color:#f59e0b;"></i>'} ${r.title}</span></div><div class="sugg-desc" style="font-size:0.8rem; color:#64748b;">${r.desc}</div></div>`).join('');
            suggPanel.classList.add('active');
            suggPanel.style.display = 'block';
        } else { 
            suggPanel.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#64748b; background:#fff;">No results found</div>`; 
            suggPanel.classList.add('active'); 
            suggPanel.style.display = 'block';
        }
    } catch(err) { console.error("Search failed:", err); }
}

window.clearSearch = function() { 
    const sb = document.getElementById('appSearchBar'); if(sb) sb.value = ''; 
    const ss = document.getElementById('searchSuggestions'); if(ss) { ss.classList.remove('active'); ss.style.display = 'none'; } 
}

window.selectSearchResult = function(type, id, lat, lng) {
    if(!isNaN(lat) && !isNaN(lng) && map) { 
        window.clearSearch(); window.toggleSearchBox();
        map.flyTo([lat, lng], 19, { duration: 1 }); 
        setTimeout(() => { window.openObjectSheet(type, id); }, 1200);
    }
}

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

        translateApp(); updateSyncUI();
        
        // ==== 🚀 INSTANT OFFLINE RENDER ON STARTUP ====
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); 
            renderEntireNetwork(); 
            centerMapOnGSS(); 
            
            if(navigator.onLine) {
                const hasDirty = Object.values(appState.dirtyItems).some(arr => arr.length > 0);
                const hasDeleted = Object.values(appState.deletedItems).some(arr => arr.length > 0);
                if (hasDirty || hasDeleted) { 
                    await window.syncToSupabase(false); 
                    // Delay pull to let cloud catch up (avoids wipe)
                    setTimeout(() => { pullFromSupabase(true); }, 3000);
                } else {
                    pullFromSupabase(true); 
                }
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
                        if (hasDirty || hasDeleted) { 
                            await window.syncToSupabase(false); 
                            setTimeout(() => { pullFromSupabase(true); }, 3000);
                        } else {
                            pullFromSupabase(true); 
                        }
                    }
                }
            });
        }
    } catch (e) { console.error("Initialization Error:", e); } 
    finally { if (navigator.splashscreen) setTimeout(() => { navigator.splashscreen.hide(); }, 500); }
}

document.addEventListener('deviceready', initializeApplication, false); 
window.addEventListener('DOMContentLoaded', () => { setTimeout(initializeApplication, 2500); });
