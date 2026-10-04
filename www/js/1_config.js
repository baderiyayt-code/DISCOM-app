const DB_KEY = "DISCOM_ENTERPRISE_DB";
const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
let supabaseClient = null; 
const ADMIN_EMAIL = 'admin@discom.com';

let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en', theme: 'light', liveSync: true }, 
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: null, gssNodes: {}, feeders: {}, orphanPoleIds: new Set(), activeMove: null, placementType: null, photos: [], deletedObjectIds: [], deletedFeederCodes: []
};

let historyStack = []; 
let map = null; 
let tileLayers = {}; 
let currentTileIndex = 0; 
let layerKeys = []; 
let featureGroups = {}; 
window.isSetupModalOpen = false; 
window.tempPhotoUrl = null;
window.currentSelectedObj = null;
window.liveTrackingId = null; 
window.liveUserMarker = null; 
window.isFirstLocationLock = true;

const i18n = {
    en: { appLanguage: "Language", distUnit: "Distance Unit", theme: "Theme", settings: "Settings", save: "Save", edit: "Edit", delete: "Delete", mapSetup: "Network Setup Required", htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer", permReq: "Permissions Required", permDesc: "This app requires Location, Camera and Storage permissions.", grantPerm: "Grant Permissions", kpi11: "11 KV LINE", kpiLT: "LT LINE", kpi3Ph: "3-PH DT", kpi1Ph: "1-PH DT", kpiCons: "CONSUMERS", searchPla: "Search Consumer, DT, Pole..." },
    hi: { appLanguage: "ऐप की भाषा", distUnit: "दूरी की इकाई", theme: "थीम मोड", settings: "सेटिंग्स", save: "सेव करें", edit: "बदलें", delete: "डिलीट", mapSetup: "नेटवर्क सेटअप ज़रूरी है", htPole: "HT पोल", ltPole: "LT पोल", line: "लाइन", dt: "डी.टी", consumer: "कंज्यूमर", permReq: "अनुमति आवश्यक है", permDesc: "इस ऐप को चलाने के लिए Location, Camera और Storage की अनुमति दें।", grantPerm: "अनुमति दें", kpi11: "11 KV लाइन", kpiLT: "LT लाइन", kpi3Ph: "3-फेज़ DT", kpi1Ph: "1-फेज़ DT", kpiCons: "कंज्यूमर", searchPla: "सर्च करें: पोल, डी.टी, उपभोक्ता..." }
};

function applyTranslations() {
    const lang = appState.settings.language || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.getAttribute('data-i18n'); if(i18n[lang] && i18n[lang][key]) { if(el.tagName === 'INPUT' && el.type === 'text') el.placeholder = i18n[lang][key]; else el.innerHTML = i18n[lang][key]; } });
    const t = i18n[lang];
    if(document.getElementById('kpi11Label')) document.getElementById('kpi11Label').innerText = t.kpi11; if(document.getElementById('kpiLTLabel')) document.getElementById('kpiLTLabel').innerText = t.kpiLT;
    if(document.getElementById('kpi3PhLabel')) document.getElementById('kpi3PhLabel').innerText = t.kpi3Ph; if(document.getElementById('kpi1PhLabel')) document.getElementById('kpi1PhLabel').innerText = t.kpi1Ph;
    if(document.getElementById('kpiConsLabel')) document.getElementById('kpiConsLabel').innerText = t.kpiCons; if(document.getElementById('appSearchBar')) document.getElementById('appSearchBar').placeholder = t.searchPla;
}

function applyTheme() { if(appState.settings.theme === 'dark') document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode'); }
