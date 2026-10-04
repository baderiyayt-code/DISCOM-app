/* --- js/3_map_render.js (Ultra Stable Mode) --- */

window.initMapLayers = function() {
    if (typeof L === 'undefined') return; 
    
    // PERFECTLY STABLE MAP CONFIGURATION FOR MOBILE
    map = L.map('map', { 
        zoomControl: false, 
        attributionControl: false, 
        preferCanvas: true, // IMPORTANT: Forces objects to render fast on mobile
        zoomAnimation: true, 
        markerZoomAnimation: true, 
        fadeAnimation: true 
    }).setView([26.9150, 75.7830], 16);

    map.on('zoomend', window.updateMapZoomClasses); 
    map.on('move', () => { 
        const c = map.getCenter(); 
        const rc = document.getElementById('reticle-coordinates');
        if(rc) rc.innerHTML = `<i class="fa-solid fa-satellite"></i> ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        
        if (appState.placementType && document.getElementById('center-placement-pin').style.display === 'block') {
            const net = window.getActiveNetwork();
            if (net) {
                let nearestDist = Infinity; let nearestName = 'None';
                const checkNode = (lat, lng, name) => { if(lat && lng && !isNaN(lat) && !isNaN(lng)) { const d = window.calcDistance(c.lat, c.lng, lat, lng); if(d < nearestDist) { nearestDist = d; nearestName = name; } } };
                net.poles.forEach(p => checkNode(p.lat, p.lng, `Pole ${p.poleNo}`)); net.dts.forEach(d => checkNode(d.lat, d.lng, `DT ${d.code}`));
                const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if(gss) checkNode(gss.lat, gss.lng, 'GSS');
                const ind = document.getElementById('live-distance-indicator');
                if(ind) {
                    if (nearestDist === Infinity) { ind.style.display = 'none'; } 
                    else { ind.style.display = 'block'; ind.innerText = `Nearest: ${nearestName} (${window.formatDistance(nearestDist)})`; }
                }
            }
        }
    });

    tileLayers = { 
        osm: { name: '<i class="fa-solid fa-map"></i> OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }) }, 
        hybrid: { name: '<i class="fa-solid fa-satellite-dish"></i> Google Hybrid', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
        street: { name: '<i class="fa-solid fa-map-location-dot"></i> Street Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 22 }) } 
    };
    layerKeys = Object.keys(tileLayers); tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);
    
    featureGroups = { 
        gss: L.featureGroup().addTo(map), 
        lines: L.featureGroup().addTo(map), 
        consumerLines: L.featureGroup().addTo(map), 
        poles: L.featureGroup().addTo(map), 
        dts: L.featureGroup().addTo(map), 
        consumers: L.featureGroup().addTo(map) 
    };
    
    const pcb = document.getElementById('placement-confirm-bar'); if(pcb && L.DomEvent) { L.DomEvent.disableClickPropagation(pcb); L.DomEvent.disableScrollPropagation(pcb); }
    const bsa = document.getElementById('bottom-single-action'); if(bsa && L.DomEvent) { L.DomEvent.disableClickPropagation(bsa); L.DomEvent.disableScrollPropagation(bsa); }
    const headerActions = document.querySelector('.header-actions'); 
    if(headerActions) { const searchBtn = document.createElement('button'); searchBtn.className = 'action-btn-sm'; searchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>'; searchBtn.onclick = window.toggleSearchBox; headerActions.insertBefore(searchBtn, headerActions.firstChild); }
}

window.updateMapZoomClasses = function() {
    if(!map) return; const z = map.getZoom(); const mapEl = document.getElementById('map'); if(!mapEl) return;
    mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-ht-lines', 'hide-dt', 'hide-gss');
    if (z <= 18) mapEl.classList.add('hide-consumers'); if (z <= 17) mapEl.classList.add('hide-lt-poles'); if (z <= 16) mapEl.classList.add('hide-lt-lines'); if (z <= 15) mapEl.classList.add('hide-ht-poles'); if (z <= 14) mapEl.classList.add('hide-ht-lines'); if (z <= 13) mapEl.classList.add('hide-dt'); if (z <= 12) mapEl.classList.add('hide-gss'); 
}

window.toggleMapLayer = function() { 
    if(!map) return; map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; 
    tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerHTML = tileLayers[layerKeys[currentTileIndex]].name; 
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

window.switchFeeder = function(code) { if (appState.feeders[code]) { appState.currentFeederCode = code; window.updateFeederDropdown(); window.renderEntireNetwork(); window.triggerPersistence(); window.centerMapOnGSS(); window.toggleSidebar(false); } }
window.centerMapOnGSS = function() { if(!map) return; map.invalidateSize(); const net = window.getActiveNetwork(); if(!net) return; const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if (gss && typeof gss.lat === 'number' && !isNaN(gss.lat)) map.setView([gss.lat, gss.lng], 16, {animate: false}); }

window.calcDistance = function(lat1, lon1, lat2, lon2) { const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }
window.getOffsetCoords = function(coords, offsetMeters) { if(!coords || !coords[0] || !coords[1]) return coords; const lat1 = coords[0][0], lng1 = coords[0][1]; const lat2 = coords[1][0], lng2 = coords[1][1]; const dx = (lng2 - lng1) * 111139 * Math.cos(lat1 * Math.PI / 180); const dy = (lat2 - lat1) * 111139; const len = Math.sqrt(dx * dx + dy * dy); if (len === 0) return coords; const nx = -dy / len; const ny = dx / len; const dLng = (nx * offsetMeters) / (111139 * Math.cos(lat1 * Math.PI / 180)); const dLat = (ny * offsetMeters) / 111139; return [[lat1 + dLat, lng1 + dLng], [lat2 + dLat, lng2 + dLng]]; };
window.getNodeCoords = function(nodeId) { 
    const net = window.getActiveNetwork(); if(!net) return null; const idStr = String(nodeId); 
    if (idStr.startsWith('GSS_')) { const code = idStr.replace('GSS_', ''); if (appState.gssNodes[code]) return { lat: appState.gssNodes[code].lat, lng: appState.gssNodes[code].lng }; } 
    if (idStr.startsWith('DT_')) { const code = idStr.replace('DT_', ''); const d = net.dts.find(x => String(x.code) === code); if (d) return { lat: d.lat, lng: d.lng }; } 
    if (idStr.startsWith('POLE_')) { const code = idStr.replace('POLE_', ''); const p = net.poles.find(x => String(x.poleNo) === code); if (p) return { lat: p.lat, lng: p.lng }; } 
    const p = net.poles.find(x => String(x.poleNo) === idStr); if (p) return { lat: p.lat, lng: p.lng }; 
    const d = net.dts.find(x => String(x.code) === idStr); if (d) return { lat: d.lat, lng: d.lng }; 
    if (appState.gssNodes[idStr]) return { lat: appState.gssNodes[idStr].lat, lng: appState.gssNodes[idStr].lng }; 
    if (idStr === 'GSS' || (net.feeder && idStr === net.feeder.code)) { const g = appState.gssNodes[net.feeder.parentGss]; if(g) return { lat: g.lat, lng: g.lng }; } 
    return null; 
}

window.toggleLiveTracking = function() {
    if (!navigator.geolocation) return alert("Geolocation API not found.");
    if (liveTrackingId) { 
        navigator.geolocation.clearWatch(liveTrackingId); liveTrackingId = null; 
        if (liveUserMarker && map) { map.removeLayer(liveUserMarker); liveUserMarker = null; } 
        document.getElementById('liveTrackBtn').style.color = 'var(--text-main)'; window.showToast("Live tracking disabled."); 
    } else { 
        window.showToast("Fetching location..."); isFirstLocationLock = true; 
        liveTrackingId = navigator.geolocation.watchPosition((pos) => { 
            const lat = pos.coords.latitude, lng = pos.coords.longitude; if(!map) return; 
            if (!liveUserMarker) { 
                const humanIcon = L.divIcon({ className: 'live-human-icon', html: '🚶‍♂️', iconSize: [44,44] }); 
                liveUserMarker = L.marker([lat, lng], {icon: humanIcon, zIndexOffset: 1000}).addTo(map); 
            } else liveUserMarker.setLatLng([lat, lng]); 
            if (isFirstLocationLock) { map.setView([lat, lng], 18); isFirstLocationLock = false; } 
            document.getElementById('liveTrackBtn').style.color = '#10b981'; 
        }, (err) => alert("GPS Error."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); 
    }
}

const C_YELLOW = '#facc15'; const W_BASE = '#ffffff';
window.getPoleSVG = function(type, config, isOrphan) {
    const fill = isOrphan ? 'url(#orphanGrad)' : 'url(#poleGrad)';
    const defs = `<defs><linearGradient id="poleGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#fbbf24" /><stop offset="50%" stop-color="#f59e0b" /><stop offset="100%" stop-color="#d97706" /></linearGradient><linearGradient id="orphanGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#f87171" /><stop offset="100%" stop-color="#dc2626" /></linearGradient></defs>`;
    if(type === 'TOWER') return `<svg viewBox="0 0 60 80" style="width:36px;height:54px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6));">${defs}<path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/><path d="M 30 10 L 10 75 M 30 10 L 50 75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><line x1="18" y1="40" x2="42" y2="40" stroke="#0f172a" stroke-width="5"/><line x1="12" y1="60" x2="48" y2="60" stroke="#0f172a" stroke-width="5"/><circle cx="30" cy="5" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/></svg>`;
    if(type === 'RAIL POLE') return `<svg viewBox="0 0 40 80" style="width:24px;height:54px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6));">${defs}<rect x="12" y="10" width="16" height="65" fill="${fill}" stroke="#0f172a" stroke-width="3" rx="2"/><line x1="5" y1="20" x2="35" y2="20" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/><circle cx="12" cy="15" r="3" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.5"/><circle cx="28" cy="15" r="3" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.5"/></svg>`;
    if(type === 'PCC' && config === 'Double Pole') return `<svg viewBox="0 0 70 80" style="width:40px;height:54px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6));">${defs}<line x1="20" y1="15" x2="20" y2="75" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/><line x1="20" y1="15" x2="20" y2="75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><line x1="50" y1="15" x2="50" y2="75" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/><line x1="50" y1="15" x2="50" y2="75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><line x1="10" y1="25" x2="60" y2="25" stroke="#0f172a" stroke-width="6" stroke-linecap="round"/><line x1="10" y1="45" x2="60" y2="45" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/><circle cx="15" cy="18" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/><circle cx="35" cy="18" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/><circle cx="55" cy="18" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/></svg>`;
    return `<svg viewBox="0 0 50 80" style="width:30px;height:54px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6));">${defs}<line x1="25" y1="20" x2="25" y2="75" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/><line x1="25" y1="20" x2="25" y2="75" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><path d="M 8 15 L 25 25 L 42 15" fill="none" stroke="#0f172a" stroke-width="6" stroke-linejoin="round"/><circle cx="8" cy="10" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/><circle cx="42" cy="10" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/><circle cx="25" cy="14" r="4" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/></svg>`;
}

window.getDTSVG = function(phase, rating) {
    const numRating = String(rating).replace(/[^0-9]/g, ''); const lightOrange = '#f97316';
    const defs = `<defs><linearGradient id="dtGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f97316" /><stop offset="100%" stop-color="#c2410c" /></linearGradient></defs>`;
    if(phase === 'Single Phase') return `<svg viewBox="0 0 50 60" style="width:24px;height:30px; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));">${defs}<rect x="22" y="0" width="6" height="10" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5" rx="1"/><rect x="8" y="10" width="34" height="42" rx="4" fill="url(#dtGrad)" stroke="#0f172a" stroke-width="2.5"/><text x="25" y="38" font-size="16" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Inter, sans-serif">${numRating}</text></svg>`;
    return `<svg viewBox="0 0 70 70" style="width:36px;height:36px; filter:drop-shadow(0 6px 12px rgba(0,0,0,0.6));">${defs}<rect x="18" y="2" width="6" height="14" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5" rx="1"/><rect x="32" y="2" width="6" height="14" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5" rx="1"/><rect x="46" y="2" width="6" height="14" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5" rx="1"/><rect x="10" y="16" width="50" height="46" rx="4" fill="url(#dtGrad)" stroke="#0f172a" stroke-width="3"/><text x="35" y="47" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Inter, sans-serif">${numRating}</text></svg>`;
}
window.getConsumerSVG = function(cType, status) {
    let iconClass = 'fa-house'; if(cType === 'NonDomestic') iconClass = 'fa-building'; else if(cType === 'Agriculture') iconClass = 'fa-leaf'; else if(cType === 'SIP MIP') iconClass = 'fa-industry'; else if(cType === 'Other') iconClass = 'fa-house';
    let bgColor = 'linear-gradient(135deg, #10b981, #059669)'; if(status === 'DC') bgColor = 'linear-gradient(135deg, #facc15, #eab308)'; else if(status === 'PDC') bgColor = 'linear-gradient(135deg, #ef4444, #b91c1c)'; const iconColor = status === 'DC' ? '#0f172a' : '#ffffff';
    return `<div style="position:relative; width:30px; height:30px; display:flex; align-items:center; justify-content:center;"><div style="background:${bgColor}; border:2.5px solid #ffffff; border-radius:50%; width:100%; height:100%; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 12px rgba(0,0,0,0.5); z-index:2;"><i class="fa-solid ${iconClass}" style="color:${iconColor}; font-size:13px;"></i></div><div style="position:absolute; bottom:-6px; width:0; height:0; border-left:7px solid transparent; border-right:7px solid transparent; border-top:10px solid ${status==='PDC'?'#b91c1c':(status==='DC'?'#eab308':'#059669')}; z-index:1; filter:drop-shadow(0 2px 2px rgba(0,0,0,0.4));"></div></div>`;
}

window.getLineSpec = function(type, phase, conductor) {
    const t = (type || '').toUpperCase(); const cond = (conductor || '').toUpperCase();
    if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 4, dash: null, filterKey: 'linesLT', lineClass: 'lt-line-path', strokeColor: '#0f172a' };
    let lineClass = 'ht-line-path'; let color = '#3b82f6'; let weight = 4; let strokeColor = '#ffffff';
    if (cond.includes('UNDERGROUND') || cond.includes('UG')) { color = '#0f172a'; weight = 5; strokeColor = 'transparent'; lineClass = 'ug-line-path'; } 
    else if (phase === 'Three Phase') { lineClass = 'ryb-line-path'; color = '#3b82f6'; }
    return { name: '11 KV LINE', color: color, weight: weight, dash: null, filterKey: 'lines11', lineClass: lineClass, strokeColor: strokeColor };
}

window.updateOrphanStatus = function() {
    if(!appState.orphanPoleIds) appState.orphanPoleIds = new Set();
    appState.orphanPoleIds.clear(); 
    if (appState.settings && appState.settings.checkOrphanNode === false) return; 
    
    const net = window.getActiveNetwork(); if(!net) return; 
    const gssCode = (net.feeder && net.feeder.parentGss) ? net.feeder.parentGss : 'UNKNOWN';
    const gssId = 'GSS_' + gssCode; 
    const adj = {}; adj[gssId] = [];
    
    net.poles.forEach(p => adj['POLE_' + p.poleNo] = []); 
    net.dts.forEach(d => adj['DT_' + d.code] = []);
    net.dts.forEach(d => { if(d.parentPole) { const pId = 'POLE_' + d.parentPole; if (!adj[pId]) adj[pId] = []; adj[pId].push('DT_' + d.code); adj['DT_' + d.code].push(pId); } });
    net.lines.forEach(l => { const u = String(l.fromNode), v = String(l.toNode); if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
    
    const visited = new Set([gssId]), queue = [gssId];
    while (queue.length > 0) { const curr = queue.shift(); (adj[curr] || []).forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } }); }
    net.poles.forEach(p => { if (!visited.has('POLE_' + p.poleNo)) appState.orphanPoleIds.add(p.id); }); 
    net.dts.forEach(d => { if (!visited.has('DT_' + d.code)) appState.orphanPoleIds.add(d.id); });
}

window.renderEntireNetwork = function() {
    if(!map) return; window.updateFeederDropdown();
    try {
        window.updateOrphanStatus(); Object.values(featureGroups).forEach(g => g.clearLayers()); 
        
        Object.values(appState.gssNodes).forEach(gss => {
            if (typeof gss.lat === 'number' && !isNaN(gss.lat)) {
                if (appState.activeMove && appState.activeMove.id === gss.code) return; 
                const gssIcon = L.divIcon({ className: 'gss-square-icon', html: `<i class="fa-solid fa-bolt"></i> GSS`, iconSize: [44,24], iconAnchor: [22,12] });
                const m = L.marker([gss.lat, gss.lng], { icon: gssIcon, zIndexOffset: 500 });
                m.on('click', () => { window.openObjectSheet('GSS', gss.code, gss.name, `Code: <b>${gss.code}</b>`); }); 
                featureGroups.gss.addLayer(m);
            }
        });
        
        const net = window.getActiveNetwork(); if(!net) return; 
        const f = appState.filters || { lines11: true, linesLT: true, poles: true, dts: true, consumers: true };

        if (f.poles) {
            net.poles.forEach(p => {
                if(isNaN(p.lat) || isNaN(p.lng)) return;
                const isOrphan = appState.orphanPoleIds.has(p.id), isLT = p.lineType === 'LT';
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                let displayNo = p.poleNo; if (isLT && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];
                const svgHtml = window.getPoleSVG(p.poleType, p.poleConfig, isOrphan);
                const poleClass = isLT ? 'lt-pole' : 'ht-pole';
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: `pole-marker-icon ${poleClass} ${isOrphan ? 'orphan-pulse' : ''}`, html: `${svgHtml}<span>${displayNo}</span>`, iconSize: [40, 54], iconAnchor: [20, 27] }), zIndexOffset: 200 });
                m.on('click', () => { window.openObjectSheet('POLE', p.id, `Pole ${p.poleNo}`, `Type: <b>${p.lineType || 'HT'}</b><br>Config: <b>${p.poleType || 'Standard'} ${p.poleConfig&&p.poleConfig!=='N/A'?'('+p.poleConfig+')':''}</b><br>Condition: <b>${p.condition||'Good'}</b><br>Parent: <b>${p.dtCode || 'Feeder'}</b>`); }); 
                featureGroups.poles.addLayer(m);
            });
        }
        if (f.dts) {
            let dtGroups = {}; net.dts.forEach(d => { let pk = d.parentPole || `${d.lat},${d.lng}`; if(!dtGroups[pk]) dtGroups[pk] = []; dtGroups[pk].push(d); });
            net.dts.forEach(d => {
                if (!d.lat || !d.lng) { const p = net.poles.find(x => String(x.poleNo) === String(d.parentPole)); if (p) { d.lat = p.lat; d.lng = p.lng; } }
                if (d.lat && d.lng && !isNaN(d.lat)) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); const svgHtml = window.getDTSVG(d.phase, d.rating);
                    let pk = d.parentPole || `${d.lat},${d.lng}`; let sIdx = dtGroups[pk].findIndex(x => x.id === d.id);
                    let aX = 18; let aY = -15; if(d.phase === 'Single Phase') { aX = -12 - (sIdx * 25); aY = 20; } else { if(sIdx > 0) { aX = 18 - (sIdx * 40); } }
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: `dt-square-icon ${isOrphan ? 'orphan-pulse' : ''}`, html: svgHtml, iconSize: [36, 36], iconAnchor: [aX, aY] }), zIndexOffset: 400 });
                    m.on('click', () => { window.openObjectSheet('DT', d.id, `DT Code: ${d.code}`, `Rating: <b>${d.rating} kVA</b><br>Phase: <b>${d.phase || 'Three Phase'}</b><br>Mounted On: <b>${d.mountedOn || 'Double Pole (DP)'}</b><br>Loc: <b>${d.location||'N/A'}</b>`); }); 
                    featureGroups.dts.addLayer(m);
                }
            });
        }
        net.lines.forEach(line => {
            const c1 = window.getNodeCoords(line.fromNode), c2 = window.getNodeCoords(line.toNode); 
            if (c1 && c2 && !isNaN(c1.lat) && !isNaN(c2.lat)) { line.coords = [[c1.lat, c1.lng], [c2.lat, c2.lng]]; line.distanceMeters = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); } else return; 
            const spec = window.getLineSpec(line.type, line.phase, line.conductor); if (!f[spec.filterKey]) return;
            const hitPoly = L.polyline(line.coords, { color: 'transparent', weight: 35, className: spec.lineClass }).addTo(featureGroups.lines);
            
            if(spec.lineClass === 'ryb-line-path') { 
                const coordsR = window.getOffsetCoords(line.coords, 2); const coordsB = window.getOffsetCoords(line.coords, -2); 
                L.polyline(coordsR, { color: '#ef4444', weight: 2.5, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(line.coords, { color: '#facc15', weight: 2.5, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(coordsB, { color: '#3b82f6', weight: 2.5, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
            } else if (spec.lineClass === 'ug-line-path') {
                L.polyline(line.coords, { color: spec.color, weight: spec.weight, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
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
                const m = L.marker([c.lat + latOffset, c.lng + lngOffset], { icon: L.divIcon({ className: 'consumer-marker-icon', html: window.getConsumerSVG(c.cType, c.status), iconSize: [30,36], iconAnchor: [15, 18] }), zIndexOffset: 100 });
                m.on('click', () => { window.openObjectSheet('CONSUMER', c.id, c.name, `Type: <b>${c.cType||'Domestic'}</b><br>Status: <b>${c.status||'Regular'}</b><br>K-No: <b>${c.kno}</b><br>Load: <b>${c.load||'N/A'}</b>`); }); 
                featureGroups.consumers.addLayer(m);
                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = window.getNodeCoords(parentStr);
                if (pCoords && !isNaN(pCoords.lat)) L.polyline([[c.lat, c.lng], [pCoords.lat, pCoords.lng]], { color: '#0f172a', weight: 1.5, dashArray: '4, 4', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
            });
        }
        window.updateMapZoomClasses();
        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; net.lines.forEach(l => { if (window.getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        
        const elKpi11 = document.getElementById('kpi11'); if(elKpi11) elKpi11.innerText = window.formatDistance(t11); 
        const elKpiLT = document.getElementById('kpiLT'); if(elKpiLT) elKpiLT.innerText = window.formatDistance(tLT); 
        const elKpi3ph = document.getElementById('kpi3Ph'); if(elKpi3ph) elKpi3ph.innerText = dt3ph; 
        const elKpi1ph = document.getElementById('kpi1Ph'); if(elKpi1ph) elKpi1ph.innerText = dt1ph; 
        const elKpiCons = document.getElementById('kpiCons'); if(elKpiCons) elKpiCons.innerText = net.consumers.length;
    } catch(err) { console.error("Rendering error:", err); }
}
