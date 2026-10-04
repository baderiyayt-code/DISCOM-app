// USING 'var' TO MAKE VARIABLES GLOBALLY ACCESSIBLE ACROSS ALL 7 JS FILES
var DB_KEY = "DISCOM_ENTERPRISE_DB";
var SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
var supabaseClient = null; 
var ADMIN_EMAIL = 'admin@discom.com';

var appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', theme: 'light', liveSync: true }, 
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: null, gssNodes: {}, feeders: {}, orphanPoleIds: new Set(), activeMove: null, placementType: null, photos: [], deletedObjectIds: [], deletedFeederCodes: []
};

var historyStack = []; 
var map = null; 
var tileLayers = {}; 
var currentTileIndex = 0; 
var layerKeys = []; 
var featureGroups = {}; 
var isSetupModalOpen = false; 
var tempPhotoUrl = null;
var currentSelectedObj = null;
var liveTrackingId = null; 
var liveUserMarker = null; 
var isFirstLocationLock = true;
var authMode = 'login'; 

const i18n = {
    en: { appLanguage: "Language", distUnit: "Distance Unit", theme: "Theme", settings: "Settings", save: "Save", edit: "Edit", delete: "Delete", mapSetup: "Network Setup Required", htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", permReq: "Permissions Required", permDesc: "This app requires Location, Camera and Storage permissions.", grantPerm: "Grant Permissions", kpi11: "11 KV LINE", kpiLT: "LT LINE", kpi3Ph: "3-PH DT", kpi1Ph: "1-PH DT", kpiCons: "CONSUMERS", searchPla: "Search Consumer, DT, Pole..." },
    hi: { appLanguage: "ऐप की भाषा", distUnit: "दूरी की इकाई", theme: "थीम मोड", settings: "सेटिंग्स", save: "सेव करें", edit: "बदलें", delete: "डिलीट", mapSetup: "नेटवर्क सेटअप ज़रूरी है", htPole: "HT पोल", ltPole: "LT पोल", line: "लाइन", dt: "डी.टी", consumer: "कंज्यूमर", permReq: "अनुमति आवश्यक है", permDesc: "इस ऐप को चलाने के लिए Location, Camera और Storage की अनुमति दें।", grantPerm: "अनुमति दें", kpi11: "11 KV लाइन", kpiLT: "LT लाइन", kpi3Ph: "3-फेज़ DT", kpi1Ph: "1-फेज़ DT", kpiCons: "कंज्यूमर", searchPla: "सर्च करें: पोल, डी.टी, उपभोक्ता..." }
};

window.applyTranslations = function() {
    const lang = appState.settings.language || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if(i18n[lang] && i18n[lang][key]) { if(el.tagName === 'INPUT' && el.type === 'text') el.placeholder = i18n[lang][key]; else el.innerHTML = i18n[lang][key]; } });
    const t = i18n[lang];
    if(document.getElementById('kpi11Label')) document.getElementById('kpi11Label').innerText = t.kpi11; if(document.getElementById('kpiLTLabel')) document.getElementById('kpiLTLabel').innerText = t.kpiLT;
    if(document.getElementById('kpi3PhLabel')) document.getElementById('kpi3PhLabel').innerText = t.kpi3Ph; if(document.getElementById('kpi1PhLabel')) document.getElementById('kpi1PhLabel').innerText = t.kpi1Ph;
    if(document.getElementById('kpiConsLabel')) document.getElementById('kpiConsLabel').innerText = t.kpiCons; if(document.getElementById('appSearchBar')) document.getElementById('appSearchBar').placeholder = t.searchPla;
}
window.applyTheme = function() { if(appState.settings.theme === 'dark') document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode'); }
window.getDistStr = (lat, lng) => { if(!lat || !lng || isNaN(lat)) return ''; if(!map) return ''; const c = map.getCenter(); return window.formatDistance(window.calcDistance(c.lat, c.lng, lat, lng)); };
window.showToast = function(msg) { const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg'); if (!toast || !msgElem) return; msgElem.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
window.getActiveNetwork = function() { let keys = Object.keys(appState.feeders || {}); if (keys.length > 0 && (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode])) appState.currentFeederCode = keys[0]; let net = appState.feeders[appState.currentFeederCode]; if (!net) return null; if (!Array.isArray(net.poles)) net.poles = []; if (!Array.isArray(net.lines)) net.lines = []; if (!Array.isArray(net.dts)) net.dts = []; if (!Array.isArray(net.consumers)) net.consumers = []; return net; }
window.getPhotoUrl = function(objId) { if(!appState.photos) return null; const p = appState.photos.find(x => x.object_id === objId); return p ? p.photo_url : null; }
