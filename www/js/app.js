const DB_KEY = "DISCOM_ENTERPRISE_DB";

// ======== SUPABASE INITIALIZATION ========
const SUPABASE_URL = 'https://sxfyeublvtisndnzycib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZnlldWJsdnRpc25kbnp5Y2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMjkzOTEsImV4cCI6MjEwNDgwNTM5MX0.FENa8zOaDzlYZJI_HfWtallAkWukxSiM52-RGQ-CUmA';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ADMIN_EMAIL = 'admin@discom.com';

let appState = {
    settings: { checkOrphanNode: true, unit: 'm', gpsInterval: 3, gpsAccuracy: 10, language: 'en' },
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: "1",
    gssNodes: { "1": { code: "1", name: "132/33 kV Substation", lat: 26.9150, lng: 75.7830 } },
    feeders: { 
        "1": { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] } 
    },
    orphanPoleIds: new Set(), activeMove: null, placementType: null
};

let historyStack = [];

const i18n = {
    en: { 
        hybridMap: "Hybrid Map", htPole: "HT Pole", ltPole: "LT Pole", line: "Line", dt: "DT", consumer: "Consumer",
        line11: "11 KV Line", lineLT: "LT Line", dt3ph: "3-Ph DT", dt1ph: "1-Ph DT", totalCons: "Consumers",
        gssMgmt: "GSS Management", addNewGss: "Add New GSS", manageFdr: "Manage Feeders", 
        export: "Export (Save to Device)", exportPdf: "Export SLD PDF", exportDxf: "Export DXF", exportKml: "Export styled KML", exportCsv: "Export CSV", 
        import: "Import", importData: "Import App Data", system: "System", settings: "Settings", about: "About App",
        appLanguage: "App Language", distUnit: "Distance Unit", gpsInterval: "GPS Polling Interval", gpsAcc: "GPS Accuracy", resetData: "Reset App Data",
        confirmLoc: "Confirm Location", confirmHere: "Confirm Here", cancel: "Cancel", setNewLoc: "Set New Location",
        toastSettings: "Settings Saved!", toastDel: "Deleted Successfully!", toastImport: "Imported Successfully!"
    }
};

function translateApp() {
    const lang = appState.settings.language || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if(i18n[lang] && i18n[lang][key]) el.innerHTML = i18n[lang][key];
    });
}

function getActiveNetwork() {
    if (!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = Object.keys(appState.feeders)[0] || "1";
    let net = appState.feeders[appState.currentFeederCode];
    if (!net) { 
        net = { feeder: { name: "11 kV Feeder-01", code: "1", subdivCode: "SD-01", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] }; 
        appState.feeders[appState.currentFeederCode] = net; 
    }
    if (!Array.isArray(net.poles)) net.poles = []; 
    if (!Array.isArray(net.lines)) net.lines = []; 
    if (!Array.isArray(net.dts)) net.dts = []; 
    if (!Array.isArray(net.consumers)) net.consumers = [];
    return net;
}

function showToast(msg) {
    const toast = document.getElementById('app-toast'); const msgElem = document.getElementById('toast-msg');
    if (!toast || !msgElem) return; msgElem.innerText = msg;
    toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ====== SYNC & ADMIN DATA LOGIC ====== */
function setSyncStatus(status) {
    const ind = document.getElementById('sync-indicator');
    if(!navigator.onLine) status = 'offline';
    if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>';
    else if(status === 'synced') ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success"></i>';
    else ind.innerHTML = '<i class="fa-solid fa-cloud-xmark sync-error"></i>';
}

function syncToSupabase() {
    if (!appState.user.isLoggedIn || !appState.user.id) return;
    setSyncStatus('syncing');
    const dataToSync = JSON.parse(JSON.stringify(appState));
    delete dataToSync.user; delete dataToSync.orphanPoleIds;
    
    supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: dataToSync, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .then(({error}) => { if(error) setSyncStatus('offline'); else setSyncStatus('synced'); }).catch(() => setSyncStatus('offline'));
}

async function pullFromSupabase() {
    if (!appState.user.isLoggedIn || !appState.user.id) return;
    setSyncStatus('syncing');
    const isAdmin = appState.user.email === ADMIN_EMAIL;
    let query = supabaseClient.from('survey_data').select('data');
    if (!isAdmin) query = query.eq('user_id', appState.user.id);
    
    try {
        const { data, error } = await query;
        if (error) throw error;
        if (data && data.length > 0) {
            if (isAdmin) {
                appState.feeders = {}; appState.gssNodes = {};
                data.forEach(row => {
                    const cloudData = row.data;
                    if (cloudData.gssNodes) Object.assign(appState.gssNodes, cloudData.gssNodes);
                    if (cloudData.feeders) { Object.keys(cloudData.feeders).forEach(fCode => { appState.feeders[fCode] = cloudData.feeders[fCode]; }); }
                });
            } else {
                const cloudData = data[0].data;
                appState.feeders = cloudData.feeders || appState.feeders;
                appState.gssNodes = cloudData.gssNodes || appState.gssNodes;
                appState.currentFeederCode = cloudData.currentFeederCode || appState.currentFeederCode;
            }
            await localforage.setItem(DB_KEY, appState);
            renderEntireNetwork(); 
            setSyncStatus('synced');
            centerMapOnGSS();
        }
    } catch (err) { console.error("Sync error:", err); setSyncStatus('offline'); }
}

function triggerPersistence() { 
    localforage.setItem(DB_KEY, appState).catch(() => localStorage.setItem(DB_KEY, JSON.stringify(appState)));
    syncToSupabase(); 
}

/* ====== AUTHENTICATION & ADMIN PASSWORD CHANGE ====== */
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
}

window.handleSupabaseAuth = async function(mode) {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const name = document.getElementById('authName').value.trim();
    if(!email || !password) return alert("Email and Password required");

    showToast("Processing..."); let response;
    if (mode === 'signup') {
        if(!name) return alert("Enter Full Name");
        response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
    } else {
        response = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (response.error) alert(response.error.message);
    else if (response.data.user) {
        appState.user.isLoggedIn = true; appState.user.email = response.data.user.email; appState.user.id = response.data.user.id;
        appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
        applyAuthUIVisuals(); pullFromSupabase(); showToast("Login Successful!");
    }
}

window.changeAdminPassword = async function() {
    const newPass = document.getElementById('newAdminPassword').value.trim();
    if (!newPass || newPass.length < 6) return alert("Password must be at least 6 characters.");
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) alert("Error updating password: " + error.message);
    else { alert("Admin password updated successfully!"); document.getElementById('newAdminPassword').value = ''; }
}

window.handleSupabaseLogout = async function() {
    await supabaseClient.auth.signOut(); await localforage.clear(); localStorage.removeItem(DB_KEY); location.reload();
}

/* ====== MAP LAYER SETUP ====== */
const map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0 }).setView([26.9150, 75.7830], 16);

const tileLayers = { 
    hybrid: { name: 'Hybrid Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
    osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }) }
};
let currentTileIndex = 0; const layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

window.toggleMapLayer = function() { 
    map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; 
    tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name;
}

const featureGroups = { 
    gss: L.layerGroup().addTo(map), lines: L.layerGroup().addTo(map), consumerLines: L.layerGroup().addTo(map),
    poles: L.markerClusterGroup({ disableClusteringAtZoom: 18, maxClusterRadius: 50 }).addTo(map), 
    dts: L.markerClusterGroup({ disableClusteringAtZoom: 17, maxClusterRadius: 50 }).addTo(map), 
    consumers: L.markerClusterGroup({ disableClusteringAtZoom: 19, maxClusterRadius: 40 }).addTo(map) 
};

map.on('move', () => { 
    const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
});

function centerMapOnGSS() {
    const net = getActiveNetwork(); const gss = appState.gssNodes[net.feeder.parentGss];
    setTimeout(() => { map.invalidateSize(); }, 200);
    if (gss && typeof gss.lat === 'number' && typeof gss.lng === 'number') map.setView([gss.lat, gss.lng], 16);
}

// LIVE TRACKING FIX
let liveTrackMarker = null, liveTrackingId = null;
window.toggleLiveTracking = function() {
    const btn = document.getElementById('liveTrackBtn');
    if (liveTrackingId) {
        navigator.geolocation.clearWatch(liveTrackingId); liveTrackingId = null;
        if (liveTrackMarker) { map.removeLayer(liveTrackMarker); liveTrackMarker = null; }
        btn.style.background = 'var(--bg-sheet)'; btn.style.color = 'var(--text-main)';
        showToast("Live tracking stopped");
    } else {
        btn.style.background = '#ef4444'; btn.style.color = 'white'; showToast("Starting live tracking...");
        liveTrackingId = navigator.geolocation.watchPosition(pos => {
            const lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (!liveTrackMarker) {
                liveTrackMarker = L.marker([lat, lng], {
                    icon: L.divIcon({ className: 'custom-live-location', html: '<div class="live-location-pulse"></div>', iconSize: [26, 26], iconAnchor: [13, 13] })
                }).addTo(map);
                map.setView([lat, lng], 19);
            } else { liveTrackMarker.setLatLng([lat, lng]); }
        }, err => console.error(err), { enableHighAccuracy: true });
    }
}

// FIX: Perfect Map Vector Anchoring
function renderEntireNetwork() {
    try {
        updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers());
        const net = getActiveNetwork(), f = appState.filters;

        // Render GSS
        Object.values(appState.gssNodes).forEach(gss => {
            if (typeof gss.lat === 'number') {
                if (appState.activeMove && appState.activeMove.id === gss.code) return; 
                // Exactly matched to CSS 32x32 center
                const gssIcon = L.divIcon({ className: 'gss-square-icon', html: `<span>GSS</span>`, iconSize: [32,32], iconAnchor: [16,16] });
                const m = L.marker([gss.lat, gss.lng], { icon: gssIcon });
                m.on('click', (e) => {
                    const html = `<div style="padding:4px;"><b style="color:#b91c1c; font-size:1.1rem;">${gss.name}</b><br><small>Code: ${gss.code}</small><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:8px; background:#fef3c7; border:none; border-radius:6px;" onclick="window.relocateGss('${gss.code}')">Relocate</button></div></div>`;
                    L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
                });
                featureGroups.gss.addLayer(m);
            }
        });

        // Render Lines
        const spanBuckets = {};
        net.lines.forEach(line => {
            const c1 = getNodeCoords(line.fromNode), c2 = getNodeCoords(line.toNode); 
            if (c1 && c2) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = getLineSpec(line.type); if (!f[spec.filterKey]) return;
            const spanKey = [String(line.fromNode), String(line.toNode)].sort().join('<-->'); 
            if (!spanBuckets[spanKey]) spanBuckets[spanKey] = []; spanBuckets[spanKey].push(line);
        });

        Object.keys(spanBuckets).forEach(spanKey => {
            const linesInSpan = spanBuckets[spanKey], totalInSpan = linesInSpan.length;
            linesInSpan.forEach((line, idx) => {
                const spec = getLineSpec(line.type); let offsetMeters = (totalInSpan > 1) ? (idx - (totalInSpan - 1) / 2) * 3.2 : 0;
                const shiftedCoords = computeParallelOffset(line.coords, offsetMeters);
                
                const hitPoly = L.polyline(shiftedCoords, { color: 'transparent', weight: 25 }).addTo(featureGroups.lines);
                L.polyline(shiftedCoords, { color: spec.color, weight: spec.weight, dashArray: spec.dash, lineCap: 'round', interactive: false }).addTo(featureGroups.lines);
                hitPoly.on('click', (e) => {
                    const html = `<div style="padding:4px;"><b style="color:${spec.color};">${spec.name}</b><p style="margin:4px 0;">From-To: <b>${line.fromNode} ➔ ${line.toNode}</b></p><p style="margin:4px 0;">Distance: <b>${window.formatDistance(line.distanceMeters||0)}</b></p><button style="width:100%; padding:8px; background:#fee2e2; color:#dc2626; border:none; border-radius:6px; font-weight:700;" onclick="window.deleteEntity('line','${line.id}')">Delete</button></div>`;
                    L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
                });
            });
        });

        const poleMarkers = [], dtMarkers = [], consMarkers = [];

        // Render Poles (Perfect anchored)
        if (f.poles) {
            net.poles.forEach(p => {
                const isOrphan = appState.orphanPoleIds.has(p.id), isLT = p.lineType === 'LT';
                if (appState.activeMove && appState.activeMove.id === p.id) return;

                const iconClass = isLT ? 'lt-pole-icon' : 'pole-marker-icon';
                const mSize = isLT ? [24, 24] : [28, 28]; // Mapped identically to CSS
                const mAnchor = isLT ? [12, 12] : [14, 14]; // Perfect geometric centers

                let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];

                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: iconClass + (isOrphan ? ' orphan-pulse' : ''), html: `<span>${displayNo}</span>`, iconSize: mSize, iconAnchor: mAnchor }) });
                m.on('click', (e) => {
                    const html = `<div style="padding:4px;"><b>Pole: ${p.poleNo} (${p.lineType || 'HT'})</b><p style="margin:4px 0; font-size:0.8rem;">Parent: ${p.dtCode || 'Feeder'}</p><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:8px; background:#eff6ff; border:none; border-radius:6px;" onclick="window.openEditModal('pole','${p.id}')">Edit</button><button style="flex:1; padding:8px; background:#fef3c7; border:none; border-radius:6px;" onclick="window.startObjectMove('POLE','${p.id}','${p.poleNo}')">Move</button><button style="flex:1; padding:8px; background:#fee2e2; color:#dc2626; border:none; border-radius:6px;" onclick="window.deleteEntity('pole','${p.id}')">Delete</button></div></div>`;
                    L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
                });
                poleMarkers.push(m);
            });
        }

        if (f.dts) {
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => x.poleNo == d.parentPole); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng) {
                    const isOrphan = appState.orphanPoleIds.has(d.id);
                    // Mapped to exact CSS size (24x24) for drift elimination
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'dt-square-icon' + (isOrphan ? ' orphan-pulse' : ''), html: `${d.rating}`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
                    
                    m.on('click', (e) => {
                        const locTitle = d.location ? d.location : `DT Code: ${d.code}`;
                        const html = `<div style="padding:6px;"><b style="color:#d97706; font-size:1.05rem;"><i class="fa-solid fa-location-dot"></i> ${locTitle}</b><p style="margin:6px 0; font-size:0.9rem; line-height:1.4;">Rating: <b>${d.rating} kVA</b><br>Type: <b>${d.phase || 'Three Phase'}</b></p><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:6px; background:#eff6ff; border:none; border-radius:6px;" onclick="window.openEditModal('dt','${d.id}')">Edit</button><button style="flex:1; padding:6px; background:#fee2e2; color:#dc2626; border:none; border-radius:6px;" onclick="window.deleteEntity('dt','${d.id}')">Delete</button></div></div>`;
                        L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
                    });
                    dtMarkers.push(m);
                }
            });
        }

        if (f.consumers) {
            net.consumers.forEach(c => {
                if (appState.activeMove && appState.activeMove.id === c.id) return; 
                // Exact CSS matching
                const m = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'consumer-marker-icon', html: `<i class="fa-solid fa-house"></i>`, iconSize: [18,18], iconAnchor: [9,9] }) });
                m.on('click', (e) => {
                    const html = `<div style="padding:4px;"><b>${c.name}</b><p style="color:#64748b; margin:4px 0;">K-No: ${c.kno} | Connected to: ${c.parentRef}</p><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:6px; background:#eff6ff; border:none; border-radius:6px;" onclick="window.openEditModal('consumer','${c.id}')">Edit</button><button style="flex:1; padding:6px; background:#fef3c7; border:none; border-radius:6px;" onclick="window.startObjectMove('CONSUMER','${c.id}','${c.name}')">Move</button><button style="flex:1; padding:6px; background:#fee2e2; color:#dc2626; border:none; border-radius:6px;" onclick="window.deleteEntity('consumer','${c.id}')">Delete</button></div></div>`;
                    L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
                });
                consMarkers.push(m);
            });
        }

        featureGroups.poles.addLayers(poleMarkers);
        featureGroups.dts.addLayers(dtMarkers);
        featureGroups.consumers.addLayers(consMarkers);

        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; 
        net.lines.forEach(l => { if (getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); });
        net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        
        if(document.getElementById('kpi11')) document.getElementById('kpi11').innerText = window.formatDistance(t11);
        if(document.getElementById('kpiLT')) document.getElementById('kpiLT').innerText = window.formatDistance(tLT);
        document.getElementById('kpi3Ph').innerText = dt3ph; document.getElementById('kpi1Ph').innerText = dt1ph;
        document.getElementById('kpiCons').innerText = net.consumers.length;
        document.getElementById('feederSelectHeader').innerHTML = Object.keys(appState.feeders).map(code => `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${appState.feeders[code].feeder.name}</option>`).join('');

    } catch(err) { console.error("Rendering error:", err); }
}

function saveSnapshot() {
    const net = getActiveNetwork(); historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers })));
    if (historyStack.length > 15) historyStack.shift();
}

window.undoLastAction = function() {
    if (historyStack.length === 0) return showToast("No actions to Undo!");
    const prevState = historyStack.pop(); const net = getActiveNetwork();
    net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers;
    renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺");
}

/* ====== UI MENUS & UTILITIES ====== */
window.openFilterModal = function() {
    const f = appState.filters;
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-filter" style="color:#d97706;"></i> Object Filter</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>
        <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center;"><b>11 KV Line</b><label><input type="checkbox" id="flt11" ${f.lines11?'checked':''}></label></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><b>LT Line</b><label><input type="checkbox" id="fltLT" ${f.linesLT?'checked':''}></label></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><b>Poles</b><label><input type="checkbox" id="fltPoles" ${f.poles?'checked':''}></label></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><b>DT</b><label><input type="checkbox" id="fltDTs" ${f.dts?'checked':''}></label></div>
            <div style="display:flex; justify-content:space-between; align-items:center;"><b>Consumers</b><label><input type="checkbox" id="fltCons" ${f.consumers?'checked':''}></label></div>
        </div><button class="btn-action-primary" onclick="window.saveFilters()">Apply</button>`);
}
window.saveFilters = function() {
    appState.filters.lines11 = document.getElementById('flt11').checked; appState.filters.linesLT = document.getElementById('fltLT').checked;
    appState.filters.poles = document.getElementById('fltPoles').checked; appState.filters.dts = document.getElementById('fltDTs').checked; appState.filters.consumers = document.getElementById('fltCons').checked;
    window.closeModal(); renderEntireNetwork(); showToast("Filters Updated");
}

window.autoSaveSettings = function() { 
    appState.settings.unit = document.getElementById('setUnit').value;
    appState.settings.gpsInterval = parseFloat(document.getElementById('setGpsInterval').value);
    appState.settings.gpsAccuracy = parseFloat(document.getElementById('setGpsAccuracy').value);
    appState.settings.language = document.getElementById('setLanguage').value;
    triggerPersistence(); translateApp(); renderEntireNetwork(); showToast(i18n[appState.settings.language].toastSettings); 
}

window.toggleSpeedDial = function(force) {
    const dial = document.getElementById('speed-dial-menu'), fab = document.getElementById('mainFabBtn');
    if (!dial || !fab) return; const isOpen = force !== undefined ? force : !dial.classList.contains('active');
    dial.classList.toggle('active', isOpen); fab.classList.toggle('open', isOpen);
}

window.toggleSidebar = function(open) { 
    document.getElementById('sidebar-drawer').classList.toggle('open', open); document.getElementById('sidebarBackdrop').classList.toggle('open', open); 
    if(open) window.renderGssSidebarList();
}

window.openModal = function(html) { document.getElementById('modalSheetContent').innerHTML = html; document.getElementById('formModalOverlay').classList.add('open'); translateApp(); }
window.closeModal = function() { document.getElementById('formModalOverlay').classList.remove('open'); }

window.openSettingsPage = function() { 
    window.toggleSidebar(false); 
    document.getElementById('setUnit').value = appState.settings.unit || 'm';
    document.getElementById('setGpsInterval').value = appState.settings.gpsInterval || 3;
    document.getElementById('setGpsAccuracy').value = appState.settings.gpsAccuracy || 10;
    document.getElementById('setLanguage').value = appState.settings.language || 'en';
    document.getElementById('settings-page').classList.add('open'); 
}
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }

window.switchFeeder = function(code) { 
    if (appState.feeders[code]) { appState.currentFeederCode = code; renderEntireNetwork(); triggerPersistence(); centerMapOnGSS(); } 
}

window.calcDistance = function(lat1, lon1, lat2, lon2) {
    const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }

function getLineSpec(type) {
    const t = (type || '').toUpperCase();
    if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 2.2, dash: null, filterKey: 'linesLT' };
    return { name: '11 KV LINE', color: '#2563eb', weight: 3.5, dash: null, filterKey: 'lines11' };
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

function computeParallelOffset(coords, offsetMeters) { return coords; }

function updateOrphanStatus() {
    appState.orphanPoleIds.clear();
    const net = getActiveNetwork(), adj = {}, gssCode = net.feeder.parentGss, gssId = 'GSS_' + gssCode;
    adj[gssId] = [];

    net.poles.forEach(p => adj['POLE_' + p.poleNo] = []);
    net.dts.forEach(d => adj['DT_' + d.code] = []);

    net.dts.forEach(d => {
        if(d.parentPole) {
            const pId = 'POLE_' + d.parentPole;
            if (!adj[pId]) adj[pId] = [];
            adj[pId].push('DT_' + d.code); adj['DT_' + d.code].push(pId);
        }
    });

    net.lines.forEach(l => {
        const u = String(l.fromNode), v = String(l.toNode);
        if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = [];
        adj[u].push(v); adj[v].push(u);
    });

    const visited = new Set([gssId]), queue = [gssId];
    while (queue.length > 0) {
        const curr = queue.shift();
        (adj[curr] || []).forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } });
    }

    net.poles.forEach(p => { if (!visited.has('POLE_' + p.poleNo)) appState.orphanPoleIds.add(p.id); });
    net.dts.forEach(d => { if (!visited.has('DT_' + d.code)) appState.orphanPoleIds.add(d.id); });
}

window.handleSearch = function(e) {
    const query = e.target.value.toLowerCase().trim(), suggPanel = document.getElementById('searchSuggestions'), clearBtn = document.getElementById('clearSearchBtn');
    if(query.length === 0) { suggPanel.classList.remove('active'); clearBtn.style.display = 'none'; return; }
    clearBtn.style.display = 'block'; const net = getActiveNetwork(); let results = [];

    net.consumers.forEach(c => { if (String(c.kno).toLowerCase().includes(query) || (c.name && c.name.toLowerCase().includes(query))) results.push({ type: 'CONSUMER', id: c.id, title: c.name, desc: `K-No: ${c.kno} | Connected to: ${c.parentRef}` }); });
    net.dts.forEach(d => { if (String(d.code).toLowerCase().includes(query) || String(d.rating).includes(query) || (d.location && d.location.toLowerCase().includes(query))) results.push({ type: 'DT', id: d.id, title: `DT Code: ${d.code}`, desc: `Rating: ${d.rating} kVA | Loc: ${d.location || 'N/A'}` }); });

    if (results.length > 0) {
        suggPanel.innerHTML = results.slice(0, 15).map(r => `<div class="suggestion-item" onclick="window.selectSearchResult('${r.type}', '${r.id}')"><div class="sugg-title"><span>${r.type === 'CONSUMER' ? '<i class="fa-solid fa-house" style="color:#3b82f6;"></i>' : '<i class="fa-solid fa-bolt" style="color:#f59e0b;"></i>'} ${r.title}</span></div><div class="sugg-desc">${r.desc}</div></div>`).join('');
        suggPanel.classList.add('active');
    } else {
        suggPanel.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#64748b;">No results found</div>`; suggPanel.classList.add('active');
    }
}
window.clearSearch = function() { document.getElementById('appSearchBar').value = ''; document.getElementById('searchSuggestions').classList.remove('active'); document.getElementById('clearSearchBtn').style.display = 'none'; }
window.selectSearchResult = function(type, id) {
    const net = getActiveNetwork(); window.clearSearch(); let target = null, popupHtml = '';
    if(type === 'CONSUMER') {
        target = net.consumers.find(c => c.id === id);
        if(target) popupHtml = `<div style="padding:4px;"><b>${target.name}</b><p style="color:#64748b; margin:4px 0;">K-No: ${target.kno} | Connected to: ${target.parentRef}</p><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:6px; background:#eff6ff; border:none; border-radius:6px;" onclick="window.openEditModal('consumer','${target.id}')">Edit</button></div></div>`;
    } else if(type === 'DT') {
        target = net.dts.find(d => d.id === id);
        if(target) popupHtml = `<div style="padding:4px;"><b style="color:#d97706;">DT: ${target.code}</b><p style="margin:4px 0;">Rating: ${target.rating} kVA<br>Loc: ${target.location || 'N/A'}</p><div style="display:flex; gap:6px; margin-top:8px;"><button style="flex:1; padding:8px; background:#eff6ff; border:none; border-radius:6px;" onclick="window.openEditModal('dt','${target.id}')">Edit</button></div></div>`;
    }
    if(target && target.lat) { map.flyTo([target.lat, target.lng], 19, { duration: 1 }); setTimeout(() => { L.popup().setLatLng([target.lat, target.lng]).setContent(popupHtml).openOn(map); }, 1000); }
}

/* ====== CRUD LOGIC ====== */
window.openAddForm = function(type) {
    window.toggleSpeedDial(false); 
    if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { 
        appState.placementType = type; document.getElementById('center-placement-pin').style.display = 'block'; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'flex';
    } else window.showFormModal(type, null, null);
}
window.confirmPlacement = function() {
    document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block';
    const center = map.getCenter(); window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6)));
}
window.cancelPlacement = function() { document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('placement-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; }

window.showFormModal = function(type, snapLat, snapLng) {
    const net = getActiveNetwork(); const center = map.getCenter(); snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6));
    
    if (type === 'POLE') {
        const nextNo = net.poles.filter(p => p.lineType !== 'LT').length + 1;
        openModal(`<div class="sheet-head"><div class="sheet-title">Add HT Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Pole Number*</label><input type="number" id="inpPoleNo" class="form-input" value="${nextNo}"></div><input type="hidden" id="inpPoleCategory" value="HT"><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}"><button class="btn-action-primary" onclick="window.saveNewPole()">Save HT Pole</button>`);
    } else if (type === 'LTPOLE') {
        if (net.dts.length === 0) return alert("You must add a DT first before adding an LT Pole!");
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng);
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id} (${window.formatDistance(window.calcDistance(snapLat, snapLng, d.lat, d.lng))})</option>`).join('');
        openModal(`<div class="sheet-head"><div class="sheet-title">Add LT Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Associated DT*</label><select id="inpLTPoleDT" class="form-select">${dtOpts}</select></div><input type="hidden" id="inpPoleCategory" value="LT"><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}"><button class="btn-action-primary" onclick="window.saveNewLTPole()">Save LT Pole</button>`);
    } else if (type === 'LINE') {
        if (net.poles.length === 0) return alert("Add at least one pole first!");
        
        window.filterLineNodes = function() {
            const type = document.getElementById('inpLineType').value, net = getActiveNetwork(), fromSel = document.getElementById('inpFromNode'), dtSelectorBox = document.getElementById('ltLineDTSelector');
            let defaultFrom = ''; const defInput = document.getElementById('inpDefaultFrom'); if(defInput) defaultFrom = String(defInput.value);
            const center = map.getCenter(); let nodes = [];

            if (type.includes('LT')) {
                dtSelectorBox.style.display = 'block'; const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? targetDTElem.value : ''; 
                if(!selectedDT) return;
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(selectedDT)).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const dtObj = net.dts.find(d => String(d.code) === String(selectedDT)); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng});
            } else {
                dtSelectorBox.style.display = 'none';
                nodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[net.feeder.parentGss]; if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, center.lat, center.lng);
            if (!defaultFrom && nodes.length > 0) defaultFrom = nodes[0].id;
            let optsHtml = ''; nodes.forEach(n => { optsHtml += `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title} (${window.formatDistance(window.calcDistance(center.lat, center.lng, n.lat, n.lng))})</option>`; });
            fromSel.innerHTML = optsHtml; window.syncLineToSelect();
        };

        window.syncLineToSelect = function() {
            const type = document.getElementById('inpLineType').value, fromSel = document.getElementById('inpFromNode'), fromVal = fromSel && fromSel.options.length > 0 ? String(fromSel.value) : '';
            const toSel = document.getElementById('inpToNode'), net = getActiveNetwork(), center = map.getCenter(); let nodes = [];
            
            if (type.includes('LT')) {
                const targetDTElem = document.getElementById('inpTargetDT'), selectedDT = targetDTElem ? String(targetDTElem.value) : '';
                nodes = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === selectedDT && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'LT Pole: '+p.poleNo, id: 'POLE_' + p.poleNo}));
                if(selectedDT && ('DT_'+selectedDT) !== fromVal) { const dtObj = net.dts.find(d => String(d.code) === selectedDT); if(dtObj) nodes.push({id: 'DT_'+selectedDT, title: 'DT: '+selectedDT, lat: dtObj.lat, lng: dtObj.lng}); }
            } else {
                nodes = net.poles.filter(p => p.lineType !== 'LT' && ('POLE_'+p.poleNo) !== fromVal).map(p => ({...p, title: 'HT Pole '+p.poleNo, id: 'POLE_' + p.poleNo}));
                const parentGss = appState.gssNodes[net.feeder.parentGss]; if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
            }
            nodes = window.sortByDistance(nodes, center.lat, center.lng);
            toSel.innerHTML = nodes.map(n => `<option value="${n.id}">${n.title} (${window.formatDistance(window.calcDistance(center.lat, center.lng, n.lat, n.lng))})</option>`).join(''); 
        };

        const htNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, lat: p.lat, lng: p.lng}));
        const feederGss = appState.gssNodes[net.feeder.parentGss]; if(feederGss) htNodes.push({id: 'GSS_'+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        let sortedHT = window.sortByDistance(htNodes, snapLat, snapLng); let initialDefaultFrom = sortedHT.length > 0 ? sortedHT[0].id : '';

        openModal(`<div class="sheet-head"><div class="sheet-title">Add Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Line Type*</label><select id="inpLineType" class="form-select" onchange="window.filterLineNodes()"><option value="11 KV LINE" selected>11 KV Line</option><option value="LT LINE">LT Line</option></select></div><div id="ltLineDTSelector" style="display:none; background:#f1f5f9; padding:8px; border-radius:8px; margin-bottom:12px;"><label style="font-size:0.75rem; font-weight:700;">Select DT for LT Line Routing*</label><select id="inpTargetDT" class="form-select" onchange="window.filterLineNodes()"></select></div><input type="hidden" id="inpDefaultFrom" value="${initialDefaultFrom}"><div class="form-grid-2"><div class="form-row"><label>From Node*</label><select id="inpFromNode" class="form-select" onchange="window.syncLineToSelect()"></select></div><div class="form-row"><label>To Node*</label><select id="inpToNode" class="form-select"></select></div></div><button class="btn-action-primary" onclick="window.saveNewLine()">Save Line</button>`);
        setTimeout(() => { let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); document.getElementById('inpTargetDT').innerHTML = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id}</option>`).join(''); window.filterLineNodes(); }, 30);
    } else if (type === 'DT') {
        let parentNodes = net.poles.filter(p => p.lineType !== 'LT').map(p => ({id: p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng}));
        const feederGss = appState.gssNodes[net.feeder.parentGss]; if(feederGss) parentNodes.push({id: feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}">${p.title} (${window.formatDistance(window.calcDistance(snapLat, snapLng, p.lat, p.lng))})</option>`).join('');

        openModal(`<div class="sheet-head"><div class="sheet-title">Add DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Connected To (Parent HT Node)*</label><select id="inpDTParent" class="form-select">${parentOpts}</select></div><div class="form-grid-2"><div class="form-row"><label>DT Code*</label><input type="number" id="inpDTCode" class="form-input" value="${Math.floor(Math.random()*9000)}"></div><div class="form-row"><label>Phase*</label><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating')"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select></div></div><div class="form-row"><label>Rating (kVA)*</label><select id="inpDTRating" class="form-select"></select></div><div class="form-row"><label>Location / Landmark</label><input type="text" id="inpDTLocation" class="form-input" placeholder="e.g. Near Main Market"></div><button class="btn-action-primary" onclick="window.saveNewDT()">Save DT</button>`);
        setTimeout(() => window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating'), 30);
    } else if (type === 'CONSUMER') {
        if (net.dts.length === 0) return alert("Must have at least one DT to connect Consumer!");
        let sortedDTs = window.sortByDistance(net.dts.map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng);
        const dtOpts = sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id} (${window.formatDistance(window.calcDistance(snapLat, snapLng, d.lat, d.lng))})</option>`).join('');

        openModal(`<div class="sheet-head"><div class="sheet-title">Add Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Select Parent DT*</label><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()">${dtOpts}</select></div><div class="form-row"><label>Connects To (LT Pole / DT)*</label><select id="inpConsParent" class="form-select"></select></div><div class="form-grid-2"><div class="form-row"><label>K-Number*</label><input type="number" id="inpConsKno" class="form-input"></div><div class="form-row"><label>Load</label><input type="text" id="inpConsLoad" class="form-input" value="1 kW"></div></div><div class="form-row"><label>Consumer Name*</label><input type="text" id="inpConsName" class="form-input"></div><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}"><button class="btn-action-primary" onclick="window.saveNewConsumer()">Save Consumer</button>`);
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
    nodes = window.sortByDistance(nodes, centerLat, centerLng);
    document.getElementById('inpConsParent').innerHTML = nodes.map(n => `<option value="${n.id}">${n.title} (${window.formatDistance(window.calcDistance(centerLat, centerLng, n.lat, n.lng))})</option>`).join('');
}

window.saveNewPole = function() { 
    saveSnapshot(); const no = document.getElementById('inpPoleNo').value.trim(), category = document.getElementById('inpPoleCategory').value, lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    if (!no) return alert("Enter pole number"); const net = getActiveNetwork(); if (net.poles.some(p => String(p.poleNo) === no)) return alert(`Pole exists!`); 
    net.poles.push({ id: 'P_'+Date.now(), poleNo: no, lineType: category, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("HT Pole added successfully!");
}
window.saveNewLTPole = function() {
    saveSnapshot(); const dtCode = document.getElementById('inpLTPoleDT').value, category = document.getElementById('inpPoleCategory').value, lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    if (!dtCode) return alert("Select DT"); const net = getActiveNetwork(); const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); const finalPoleNo = `${dtCode}-${existingLTPoles.length + 1}`;
    if (net.poles.some(p => String(p.poleNo) === String(finalPoleNo))) return alert(`Pole ${finalPoleNo} exists!`); 
    net.poles.push({ id: 'P_'+Date.now(), poleNo: finalPoleNo, lineType: category, dtCode: dtCode, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("LT Pole added successfully!");
}
window.saveNewLine = function() { 
    saveSnapshot(); const from = document.getElementById('inpFromNode').value, to = document.getElementById('inpToNode').value, type = document.getElementById('inpLineType').value; 
    if (from === to) return alert("Cannot connect node to itself!"); if (!to) return alert("Please select a target node!");
    const net = getActiveNetwork(), spec = getLineSpec(type), existingLine = net.lines.find(l => (l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from));
    if(existingLine) return alert("A line already exists between these two nodes!");
    const c1 = getNodeCoords(from), c2 = getNodeCoords(to); if(!c1 || !c2) return alert("Invalid node coordinates!"); const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); 
    net.lines.push({ id: 'LN_'+Date.now(), type: spec.name, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]] }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line added successfully!");
}
window.saveNewDT = function() { 
    saveSnapshot(); const parentRef = document.getElementById('inpDTParent').value, code = document.getElementById('inpDTCode').value.trim(), rating = parseFloat(document.getElementById('inpDTRating').value), phase = document.getElementById('inpDTPhase').value, location = document.getElementById('inpDTLocation').value.trim();
    if (!code) return alert("Enter DT Code"); const net = getActiveNetwork(), p = net.poles.find(x => String(x.poleNo) === String(parentRef));
    let lat = net.feeder.lat, lng = net.feeder.lng; if (p) { lat = p.lat; lng = p.lng; }
    net.dts.push({ id: 'DT_'+Date.now(), parentPole: parentRef, code, rating, phase, location, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT added successfully!");
}
window.saveNewConsumer = function() { 
    saveSnapshot(); const parentRef = document.getElementById('inpConsParent').value, kno = document.getElementById('inpConsKno').value.trim(), name = document.getElementById('inpConsName').value.trim(), load = document.getElementById('inpConsLoad').value.trim(), lat = parseFloat(document.getElementById('inpLat').value), lng = parseFloat(document.getElementById('inpLng').value); 
    const net = getActiveNetwork(); if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number already exists in this feeder!");
    let parentType = 'POLE'; const p = net.poles.find(x => String(x.poleNo) === String(parentRef)); if (!p) parentType = 'DT';
    if (!name || !kno) return alert("Enter Consumer Name and K-No"); 
    net.consumers.push({ id: 'CS_'+Date.now(), parentRef, parentType, kno, name, load, lat, lng }); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer added successfully!");
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
    const net = getActiveNetwork(); if(!confirm("Are you sure you want to delete this item?")) return; saveSnapshot();
    if (type === 'line') net.lines = net.lines.filter(x => x.id !== id);
    else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id);
    else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole') {
        const p = net.poles.find(x => x.id === id);
        if (p) {
            if (p.lineType === 'LT') deleteLTPoleLogic(p, net);
            else { const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== id); }
        }
    }
    renderEntireNetwork(); triggerPersistence(); showToast("Deleted successfully!");
}

window.openEditModal = function(type, id) {
    map.closePopup(); const net = getActiveNetwork();
    if (type === 'pole') {
        const p = net.poles.find(x => x.id === id); if (!p) return;
        openModal(`<div class="sheet-head"><div class="sheet-title">Edit Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Pole Number (Locked)*</label><input type="text" id="editPoleNo" class="form-input" value="${p.poleNo}" readonly disabled style="background-color:#e2e8f0; cursor:not-allowed; opacity:0.8;"></div><button class="btn-action-primary" onclick="window.saveEditedPole('${p.id}')">Save Changes</button>`);
    } else if (type === 'dt') {
        const d = net.dts.find(x => x.id === id); if (!d) return; 
        openModal(`<div class="sheet-head"><div class="sheet-title">Edit DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>DT Code*</label><input type="number" id="editDTCode" class="form-input" value="${d.code}"></div><div class="form-row"><label>Location / Landmark</label><input type="text" id="editDTLocation" class="form-input" value="${d.location || ''}"></div><button class="btn-action-primary" onclick="window.saveEditedDT('${d.id}')">Save Changes</button>`);
    } else if (type === 'consumer') {
        const c = net.consumers.find(x => x.id === id); if (!c) return;
        openModal(`<div class="sheet-head"><div class="sheet-title">Edit Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Consumer Name*</label><input type="text" id="editConsName" class="form-input" value="${c.name}"></div><div class="form-row"><label>K-Number*</label><input type="number" id="editConsKno" class="form-input" value="${c.kno}"></div><button class="btn-action-primary" onclick="window.saveEditedConsumer('${c.id}')">Save Changes</button>`);
    }
}
window.saveEditedPole = function(id) { saveSnapshot(); window.closeModal(); showToast("Pole Settings Updated"); }
window.saveEditedDT = function(id) { saveSnapshot(); const net = getActiveNetwork(); const d = net.dts.find(x => x.id === id); if (!d) return; d.code = document.getElementById('editDTCode').value.trim(); d.location = document.getElementById('editDTLocation').value.trim(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Updated"); }
window.saveEditedConsumer = function(id) { saveSnapshot(); const net = getActiveNetwork(); const c = net.consumers.find(x => x.id === id); if (!c) return; c.name = document.getElementById('editConsName').value.trim(); c.kno = document.getElementById('editConsKno').value.trim(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Updated"); }

window.startObjectMove = function(type, id, title) {
    map.closePopup(); appState.activeMove = { type, id }; document.getElementById('bottom-single-action').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'flex'; document.getElementById('moveTargetTitle').innerText = `Move: ${title}`;
    let target = null; let htmlContent = '';
    if(type === 'GSS') { target = appState.gssNodes[id]; htmlContent = `<div class="gss-square-icon" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><span>GSS</span></div>`; } 
    else {
        const net = getActiveNetwork(); 
        if (type === 'POLE') {
            target = net.poles.find(x => x.id === id); const isLT = target.lineType === 'LT';
            let displayNo = target.poleNo; if (isLT && String(target.poleNo).includes('-')) displayNo = String(target.poleNo).split('-')[1];
            htmlContent = `<div class="${isLT ? 'lt-pole-icon' : 'pole-marker-icon'}" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><span>${displayNo}</span></div>`;
        } else if (type === 'CONSUMER') { target = net.consumers.find(x => x.id === id); htmlContent = `<div class="consumer-marker-icon" style="box-shadow: 0 10px 25px rgba(0,0,0,0.5);"><i class="fa-solid fa-house"></i></div>`; }
    }
    if (target && target.lat) { map.panTo([target.lat, target.lng]); const liveIconContainer = document.getElementById('live-move-icon'); liveIconContainer.innerHTML = htmlContent; liveIconContainer.style.display = 'block'; renderEntireNetwork(); }
}
window.confirmObjectMove = function() {
    if (!appState.activeMove) return; saveSnapshot();
    const c = map.getCenter(); const lat = parseFloat(c.lat.toFixed(6)), lng = parseFloat(c.lng.toFixed(6)), net = getActiveNetwork(); 
    if (appState.activeMove.type === 'GSS') {
        const gss = appState.gssNodes[appState.activeMove.id];
        if(gss) { 
            gss.lat = lat; gss.lng = lng; 
            net.lines.forEach(l => { 
                if (l.fromNode == gss.code) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } 
                if (l.toNode == gss.code) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } 
            });
        }
    } else {
        if (appState.activeMove.type === 'POLE') {
            const p = net.poles.find(x => x.id === appState.activeMove.id);
            if (p) {
                p.lat = lat; p.lng = lng;
                net.dts.forEach(d => { if (d.parentPole == p.poleNo) { d.lat = lat; d.lng = lng; } }); 
                net.lines.forEach(l => { if (l.fromNode == p.poleNo) { l.coords[0] = [lat, lng]; l.distanceMeters = window.calcDistance(lat, lng, l.coords[1][0], l.coords[1][1]); } if (l.toNode == p.poleNo) { l.coords[1] = [lat, lng]; l.distanceMeters = window.calcDistance(l.coords[0][0], l.coords[0][1], lat, lng); } });
            }
        } else if (appState.activeMove.type === 'CONSUMER') { const cons = net.consumers.find(x => x.id === appState.activeMove.id); if (cons) { cons.lat = lat; cons.lng = lng; } }
    }
    window.cancelObjectMove(); renderEntireNetwork(); triggerPersistence(); showToast("Location Updated!");
}
window.cancelObjectMove = function() { appState.activeMove = null; document.getElementById('live-move-icon').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; renderEntireNetwork(); }

window.openAddNewFeederModal = function() {
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}">${g.code} - ${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> New Feeder</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Code (Numeric Only)*</label><input type="number" id="newFdrCode" class="form-input" value="${Object.keys(appState.feeders).length + 1}"></div><div class="form-row"><label>Feeder Name*</label><input type="text" id="newFdrName" class="form-input" placeholder="e.g. City Feed 11kV"></div><div class="form-row"><label>Parent GSS*</label><select id="newFdrGss" class="form-select">${gssOpts}</select></div><button class="btn-action-primary" onclick="window.createNewFeeder()">Create Feeder</button>`);
}
window.createNewFeeder = function() {
    const code = document.getElementById('newFdrCode').value.trim(), name = document.getElementById('newFdrName').value.trim(), gss = document.getElementById('newFdrGss').value;
    if (!code || !name) return alert("Fill required fields"); 
    appState.feeders[code] = { feeder: { name, code, subdivCode: "SD-01", parentGss: gss }, poles: [], dts: [], lines: [], consumers: [] };
    appState.currentFeederCode = code; window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("New Feeder Created!");
}

window.openFeederConfigModal = function() {
    window.toggleSidebar(false); const net = getActiveNetwork(); 
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}" ${net.feeder.parentGss==g.code?'selected':''}>${g.code} - ${g.name}</option>`).join('');
    openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-tower-broadcast"></i> Feeder Config</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Name</label><input type="text" id="cfgFeederName" class="form-input" value="${net.feeder.name}"></div><div class="form-row"><label>Parent GSS Source</label><select id="cfgParentGss" class="form-select">${gssOpts}</select></div><button class="btn-action-primary" onclick="window.saveFeederConfiguration()">Save Config</button>`);
}
window.saveFeederConfiguration = function() {
    const net = getActiveNetwork(); net.feeder.name = document.getElementById('cfgFeederName').value; net.feeder.parentGss = document.getElementById('cfgParentGss').value; 
    window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Configuration Saved!");
}

window.openResetConfirmationModal = function() {
    window.closeSettingsPage(); window.toggleSidebar(false); 
    openModal(`<div class="sheet-head"><div class="sheet-title" style="color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Secure App Reset</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><p style="margin-bottom:12px; font-size:0.9rem; color:var(--text-sub);">This action will permanently wipe all survey data, feeders, and settings from your device. This cannot be undone.</p><div class="form-row"><label>Type <b>RESET</b> to confirm</label><input type="text" id="inpAppResetText" class="form-input" placeholder="Type RESET here"></div><button class="btn-action-primary" style="background:#dc2626;" onclick="window.executeSecureAppReset()">Permanently Delete All Data</button>`);
}
window.executeSecureAppReset = function() { 
    const inputVal = document.getElementById('inpAppResetText').value.trim();
    if (inputVal !== "RESET") return alert("Confirmation failed. You must type 'RESET' exactly.");
    localforage.clear().then(() => { localStorage.clear(); location.reload(); });
}

/* ====== SILENT EXPORTS (NO SHARE INTENT) ====== */
window.smartExportFile = function(filename, dataBlobOrText, mimeType) {
    const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
    if (window.cordova && cordova.file) {
        const storageLocation = cordova.file.externalRootDirectory + 'Download/';
        window.resolveLocalFileSystemURL(storageLocation, function(dirEntry) {
            dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = function() { showToast("File saved to Downloads!"); };
                    fileWriter.onerror = function(e) { console.error(e); showToast("File write error"); };
                    fileWriter.write(blob);
                });
            }, err => console.error(err));
        }, err => console.error(err));
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = 'none'; a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
        showToast("File Downloaded!");
    }
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

window.exportDataToCSV = async function() { window.toggleSidebar(false); window.smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}_GE.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.exportToAutoCAD_DXF = async function() { 
    window.toggleSidebar(false); let dxf = "0\nSECTION\n2\nENTITIES\n"; getActiveNetwork().lines.forEach(l => { if (l.coords && l.coords[0] && l.coords[1]) dxf += `0\nLINE\n8\n${l.type.replace(/\s+/g,'_')}\n10\n${l.coords[0][1]}\n20\n${l.coords[0][0]}\n30\n0\n11\n${l.coords[1][1]}\n21\n${l.coords[1][0]}\n31\n0\n`; }); dxf += "0\nENDSEC\n0\nEOF\n"; 
    window.smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.dxf`, dxf, "application/dxf"); 
}
window.exportToGoogleEarth_KML = async function() { 
    window.toggleSidebar(false); const esc = u => u.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
    const feederName = esc(getActiveNetwork().feeder.name); let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${feederName}</name>\n`; 
    getActiveNetwork().lines.forEach(l => { if (l.coords) kml += `<Placemark><LineString><coordinates>${l.coords[0][1]},${l.coords[0][0]},0 ${l.coords[1][1]},${l.coords[1][0]},0</coordinates></LineString></Placemark>\n`; }); 
    getActiveNetwork().dts.forEach(d => { if (d.lat) kml += `<Placemark><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>\n`; });
    kml += "</Document>\n</kml>"; window.smartExportFile(`${getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.kml`, kml, "application/vnd.google-earth.kml+xml"); 
}

/* ====== A0 PROFESSIONAL SLD GENERATION ====== */
window.generateCadSLDPdf = async function() { 
    window.toggleSidebar(false); 
    const net = getActiveNetwork();
    if(!window.jspdf || !window.jspdf.jsPDF) return alert("PDF Generator missing.");
    
    showToast("Generating A0 SLD...");
    const { jsPDF } = window.jspdf;
    
    // A0 Landscape dimensions: 1189 x 841 mm
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, hasCoords = false;
    net.lines.forEach(l => {
        if (l.coords && l.coords.length === 2) {
            hasCoords = true;
            minLat = Math.min(minLat, l.coords[0][0], l.coords[1][0]); maxLat = Math.max(maxLat, l.coords[0][0], l.coords[1][0]);
            minLng = Math.min(minLng, l.coords[0][1], l.coords[1][1]); maxLng = Math.max(maxLng, l.coords[0][1], l.coords[1][1]);
        }
    });

    if(!hasCoords) { 
        doc.text("No geospatial data to plot.", 50, 50); 
    } else {
        const padX = 50, padY = 50; 
        const plotWidth = pageWidth - 2 * padX;
        const plotHeight = pageHeight - 2 * padY - 80;
        
        const latDiff = maxLat - minLat || 0.0001;
        const lngDiff = maxLng - minLng || 0.0001;
        const scale = Math.min(plotWidth / lngDiff, plotHeight / latDiff);
        
        const getX = (lng) => padX + (lng - minLng) * scale;
        const getY = (lat) => pageHeight - padY - (lat - minLat) * scale;

        // Draw Lines and Distances
        net.lines.forEach(l => {
            if (l.coords && l.coords.length === 2) {
                const x1 = getX(l.coords[0][1]), y1 = getY(l.coords[0][0]);
                const x2 = getX(l.coords[1][1]), y2 = getY(l.coords[1][0]);
                
                doc.setDrawColor(37, 99, 235); // 11kV blue
                if (l.type.includes('LT')) doc.setDrawColor(16, 185, 129); // LT green
                doc.setLineWidth(1.5);
                doc.line(x1, y1, x2, y2);
                
                doc.setFontSize(8); doc.setTextColor(100, 100, 100);
                const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
                doc.text(`${(l.distanceMeters||0).toFixed(1)}m`, midX, midY - 2);
            }
        });

        // Draw DTs
        net.dts.forEach(d => {
            if (d.lat && d.lng) {
                const x = getX(d.lng), y = getY(d.lat);
                doc.setFillColor(245, 158, 11);
                doc.rect(x - 3, y - 3, 6, 6, 'F');
                doc.setFontSize(10); doc.setTextColor(0, 0, 0);
                doc.text(`${d.rating}kVA`, x + 5, y + 2);
            }
        });
        
        // Draw GSS
        Object.values(appState.gssNodes).forEach(g => {
            if (g.code == net.feeder.parentGss) {
                const x = getX(g.lng), y = getY(g.lat);
                doc.setFillColor(185, 28, 28);
                doc.rect(x - 5, y - 5, 10, 10, 'F');
                doc.setFontSize(12); doc.setTextColor(0,0,0); doc.setFont("helvetica", "bold");
                doc.text("GSS", x + 6, y + 3); doc.setFont("helvetica", "normal");
            }
        });
    }
    
    // Bottom-Right Title Block
    let totalHT = 0, dt1Ph = 0, dt3Ph = 0;
    net.lines.forEach(l => { if (!l.type.includes('LT')) totalHT += (l.distanceMeters || 0); });
    net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1Ph++; else dt3Ph++; });
    
    const blockW = 200, blockH = 80;
    const startX = pageWidth - blockW - 20, startY = pageHeight - blockH - 20;
    
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.5); doc.rect(startX, startY, blockW, blockH);
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(0,0,0);
    doc.text("SINGLE LINE DIAGRAM (SLD)", startX + 10, startY + 15);
    
    doc.setFont("helvetica", "normal"); doc.setFontSize(14);
    doc.text(`Feeder Name: ${net.feeder.name}`, startX + 10, startY + 30);
    doc.text(`Total HT Distance: ${(totalHT/1000).toFixed(3)} km`, startX + 10, startY + 45);
    doc.text(`Total 1-Phase DTs: ${dt1Ph}`, startX + 10, startY + 60);
    doc.text(`Total 3-Phase DTs: ${dt3Ph}`, startX + 10, startY + 75);

    window.smartExportFile(`${net.feeder.name.replace(/\s+/g, '_')}_A0_SLD.pdf`, doc.output('blob'), "application/pdf");
}

/* ====== INITIALIZATION & STARTUP ====== */
async function initializeApplication() {
    try {
        let data = await localforage.getItem(DB_KEY);
        if (!data) { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) appState = data;
        
        translateApp(); 
        if (appState.user && appState.user.isLoggedIn) {
            applyAuthUIVisuals(); renderEntireNetwork(); centerMapOnGSS();
        } else {
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
        }

        if (navigator.splashscreen) setTimeout(() => { navigator.splashscreen.hide(); }, 500);

        supabaseClient.auth.getSession().then(({ data }) => {
            if (data && data.session && data.session.user) {
                appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                applyAuthUIVisuals(); pullFromSupabase(); 
            }
        });
    } catch (e) {
        console.error("Initialization Error:", e);
        if (navigator.splashscreen) navigator.splashscreen.hide();
    }
}

document.addEventListener('deviceready', initializeApplication, false); 
if (!window.cordova) { window.addEventListener('DOMContentLoaded', initializeApplication); }
