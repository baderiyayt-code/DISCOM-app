/* --- js/3_map_render.js --- */

window.calcDistance = function(lat1, lon1, lat2, lon2) { const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180, dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
window.formatDistance = function(m) { return (appState.settings.unit === 'km') ? (m / 1000).toFixed(3) + ' KM' : m.toFixed(1) + ' M'; }
window.sortByDistance = function(nodes, lat, lng) { return nodes.slice().sort((a, b) => window.calcDistance(lat, lng, a.lat, a.lng) - window.calcDistance(lat, lng, b.lat, b.lng)); }

window.getOffsetCoords = function(coords, offsetMeters) {
    if(!coords || !coords[0] || !coords[1]) return coords;
    const lat1 = coords[0][0], lng1 = coords[0][1]; const lat2 = coords[1][0], lng2 = coords[1][1];
    const dx = (lng2 - lng1) * 111139 * Math.cos(lat1 * Math.PI / 180); const dy = (lat2 - lat1) * 111139;
    const len = Math.sqrt(dx * dx + dy * dy); if (len === 0) return coords;
    const nx = -dy / len; const ny = dx / len;
    const dLng = (nx * offsetMeters) / (111139 * Math.cos(lat1 * Math.PI / 180)); const dLat = (ny * offsetMeters) / 111139;
    return [[lat1 + dLat, lng1 + dLng], [lat2 + dLat, lng2 + dLng]];
};

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

window.initMapLayers = function() {
    if (typeof L === 'undefined') return; 
    map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: false, rotate: true, touchRotate: true, shiftKeyRotate: true, bearing: 0, zoomAnimation: false, markerZoomAnimation: false, fadeAnimation: false }).setView([26.9150, 75.7830], 16);
    
    map.on('zoom', window.updateMapZoomClasses); 
    map.on('zoomend', window.updateMapZoomClasses); 
    
    map.on('move', () => { 
        const c = map.getCenter(); document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`; 
        if (appState.placementType && document.getElementById('center-placement-pin').style.display === 'block') {
            const net = window.getActiveNetwork();
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
    
    const pcb = document.getElementById('placement-confirm-bar'); if(pcb && typeof L !== 'undefined' && L.DomEvent) { L.DomEvent.disableClickPropagation(pcb); L.DomEvent.disableScrollPropagation(pcb); }
    const bsa = document.getElementById('bottom-single-action'); if(bsa && typeof L !== 'undefined' && L.DomEvent) { L.DomEvent.disableClickPropagation(bsa); L.DomEvent.disableScrollPropagation(bsa); }
}

window.updateMapZoomClasses = function() {
    if(!map) return; 
    const z = map.getZoom(); 
    const mapEl = document.getElementById('map'); 
    mapEl.classList.remove('hide-consumers', 'hide-lt-poles', 'hide-lt-lines', 'hide-ht-poles', 'hide-ht-lines', 'hide-dt', 'hide-gss');
    
    if (z <= 18) mapEl.classList.add('hide-consumers'); 
    if (z <= 17) mapEl.classList.add('hide-lt-poles'); 
    if (z <= 16) mapEl.classList.add('hide-lt-lines'); 
    if (z <= 15) mapEl.classList.add('hide-ht-poles'); 
    if (z <= 14) mapEl.classList.add('hide-ht-lines'); 
    if (z <= 13) mapEl.classList.add('hide-dt'); 
    if (z <= 12) mapEl.classList.add('hide-gss'); 
    
    let scale = 1;
    if (z < 19) {
        scale = Math.max(0.35, 1 - ((19 - z) * 0.15));
    } else if (z > 19) {
        scale = Math.min(1.5, 1 + ((z - 19) * 0.2));
    }
    
    document.documentElement.style.setProperty('--icon-scale', scale);
}

window.toggleMapLayer = function() { if(!map) return; map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); currentTileIndex = (currentTileIndex + 1) % layerKeys.length; tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name; }

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
    if (appState.feeders[code]) { 
        appState.currentFeederCode = code; 
        window.updateFeederDropdown(); 
        if(window.renderEntireNetwork) window.renderEntireNetwork(); 
        if(window.triggerPersistence) window.triggerPersistence(); 
        window.centerMapOnGSS(); 
        if(window.toggleSidebar) window.toggleSidebar(false); 
    } 
};

window.centerMapOnGSS = function() { 
    if(!map) return; map.invalidateSize(); 
    const net = window.getActiveNetwork(); if(!net) return; 
    const gss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; 
    if (gss && typeof gss.lat === 'number' && !isNaN(gss.lat)) map.setView([gss.lat, gss.lng], 16, {animate: false}); 
};

/* ==============================================================
   UNIFIED POLE + DT EMBEDDED RENDERER (NO DRIFT ON ZOOM OUT)
============================================================== */
window.getPoleWithDTHTML = function(p, associatedDTs, isOrphan) {
    const strokeC = isOrphan ? '#ef4444' : '#475569';
    const fillC = isOrphan ? '#fca5a5' : '#fb923c';
    let displayNo = p.poleNo; 
    if (p.lineType === 'LT' && String(p.poleNo).includes('-')) displayNo = String(p.poleNo).split('-')[1];

    let poleSvg = '';
    if(p.poleType === 'TOWER') {
        poleSvg = `<path d="M 40 10 L 20 95 M 40 10 L 60 95" stroke="${strokeC}" stroke-width="3"/><path d="M 33 35 L 47 35 M 29 55 L 51 55 M 24 75 L 56 75" stroke="${strokeC}" stroke-width="2"/><line x1="10" y1="35" x2="70" y2="35" stroke="${strokeC}" stroke-width="4"/><line x1="15" y1="55" x2="65" y2="55" stroke="${strokeC}" stroke-width="4"/><rect x="37" y="0" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/>`;
    } else if(p.poleType === 'RAIL POLE') {
        poleSvg = `<rect x="12" y="10" width="16" height="85" fill="${fillC}" stroke="${strokeC}" stroke-width="2"/><line x1="2" y1="20" x2="38" y2="20" stroke="${strokeC}" stroke-width="5"/><rect x="8" y="10" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/><rect x="26" y="10" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/>`;
    } else if(p.poleType === 'PCC' && p.poleConfig === 'Double Pole') {
        poleSvg = `<polygon points="16,15 24,15 26,95 14,95" fill="${fillC}" stroke="${strokeC}" stroke-width="1.5"/><polygon points="56,15 64,15 66,95 54,95" fill="${fillC}" stroke="${strokeC}" stroke-width="1.5"/><rect x="10" y="25" width="60" height="5" fill="${strokeC}"/><rect x="10" y="45" width="60" height="5" fill="${strokeC}"/><rect x="17" y="15" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/><rect x="37" y="15" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/><rect x="57" y="15" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/>`;
    } else {
        // Single Pole with V-Cross Arm
        poleSvg = `<path d="M 10 25 L 30 40 L 50 25" fill="none" stroke="${strokeC}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><polygon points="26,30 34,30 36,95 24,95" fill="${fillC}" stroke="${strokeC}" stroke-width="1.5"/><rect x="7" y="15" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/><rect x="47" y="15" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/><rect x="27" y="30" width="6" height="10" fill="#78350f" rx="2" stroke="#0f172a" stroke-width="1"/>`;
    }

    let dtSvgs = '';
    if(associatedDTs && associatedDTs.length > 0) {
        associatedDTs.forEach((d, idx) => {
            const numRating = String(d.rating).replace(/[^0-9]/g, '');
            const xOffset = idx === 0 ? -28 : (idx * 32); // Side-by-side positioning at bottom
            
            if(d.phase === 'Single Phase') {
                // Rectangular Single Phase DT [] with Bushing
                dtSvgs += `<g transform="translate(${15 + xOffset}, 50)">
                    <rect x="0" y="0" width="28" height="32" rx="2" fill="${fillC}" stroke="#0f172a" stroke-width="2"/>
                    <rect x="3" y="3" width="22" height="26" fill="#fdba74"/>
                    <polygon points="11,0 17,0 14,-8" fill="#78350f" stroke="#0f172a" stroke-width="1"/>
                    <rect x="12" y="-10" width="4" height="2" fill="#94a3b8"/>
                    <text x="14" y="21" font-size="14" font-weight="900" fill="#0f172a" text-anchor="middle" font-family="sans-serif">${numRating}</text>
                </g>`;
            } else {
                // Three Phase DT
                dtSvgs += `<g transform="translate(${10 + xOffset}, 45)">
                    <rect x="0" y="0" width="35" height="38" rx="3" fill="${fillC}" stroke="#0f172a" stroke-width="2"/>
                    <polygon points="8,0 12,0 10,-8" fill="#78350f" stroke="#0f172a" stroke-width="1"/>
                    <polygon points="17,0 21,0 19,-8" fill="#78350f" stroke="#0f172a" stroke-width="1"/>
                    <polygon points="26,0 30,0 28,-8" fill="#78350f" stroke="#0f172a" stroke-width="1"/>
                    <text x="17.5" y="25" font-size="12" font-weight="900" fill="#0f172a" text-anchor="middle" font-family="sans-serif">${numRating}</text>
                </g>`;
            }
        });
    }

    return `<svg viewBox="0 0 100 100" style="width:50px;height:70px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6)); overflow:visible;">
        <g transform="translate(20, 0)">${poleSvg}</g>
        ${dtSvgs}
        <text x="50" y="-5" font-size="12" font-weight="900" fill="var(--text-main)" text-anchor="middle" style="background:#fff; padding:2px;">${displayNo}</text>
    </svg>`;
}

window.getConsumerSVG = function(cType, status) {
    let bgColor = '#10b981'; if(status === 'DC') bgColor = '#facc15'; else if(status === 'PDC') bgColor = '#ef4444'; 
    return `<div style="position:relative; width:34px; height:34px; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));"><svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M 10 50 L 50 15 L 90 50 L 80 50 L 80 90 L 20 90 L 20 50 Z" fill="${bgColor}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/><rect x="40" y="60" width="20" height="30" fill="#ffffff"/><rect x="25" y="55" width="10" height="15" fill="#e0f2fe"/><rect x="65" y="55" width="10" height="15" fill="#e0f2fe"/></svg></div>`;
}

window.getLineSpec = function(type, phase, conductor) {
    const t = (type || '').toUpperCase(); const cond = (conductor || '').toUpperCase();
    if (t.includes('LT')) return { name: 'LT LINE', color: '#10b981', weight: 3, dash: null, filterKey: 'linesLT', lineClass: 'lt-line-path', strokeColor: '#000000' };
    let lineClass = 'ht-line-path'; let color = '#2563eb'; let weight = 3; let strokeColor = '#ffffff';
    
    if (cond.includes('UNDERGROUND') || cond.includes('UG')) { color = '#000000'; weight = 5; strokeColor = 'transparent'; lineClass = 'ug-line-path'; } 
    else if (phase === 'Three Phase') { lineClass = 'ryb-line-path'; color = '#2563eb'; }
    return { name: '11 KV LINE', color: color, weight: weight, dash: null, filterKey: 'lines11', lineClass: lineClass, strokeColor: strokeColor };
}

window.updateOrphanStatus = function() {
    if(!appState.orphanPoleIds) appState.orphanPoleIds = new Set();
    appState.orphanPoleIds.clear(); const net = window.getActiveNetwork(); if(!net) return; 
    const adj = {}, gssCode = net.feeder.parentGss, gssId = 'GSS_' + gssCode; adj[gssId] = [];
    net.poles.forEach(p => adj['POLE_' + p.poleNo] = []); net.dts.forEach(d => adj['DT_' + d.code] = []);
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
                const gssSvg = `<div style="background:transparent; border:none; display:flex; justify-content:center; align-items:center; width:100%; height:100%;"><svg viewBox="0 0 100 50" style="width:60px;height:30px; filter:drop-shadow(0px 4px 6px rgba(0,0,0,0.6));"><rect x="2" y="2" width="96" height="46" rx="6" fill="#dc2626" stroke="#ffffff" stroke-width="4"/><text x="50" y="34" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="sans-serif">GSS</text></svg></div>`;
                const m = L.marker([gss.lat, gss.lng], { icon: L.divIcon({ className: 'gss-marker', html: gssSvg, iconSize: [60,30], iconAnchor: [30,15] }), zIndexOffset: 500 });
                m.on('click', () => { window.openObjectSheet('GSS', gss.code, gss.name, `Code: <b>${gss.code}</b>`); }); 
                featureGroups.gss.addLayer(m);
            }
        });

        const net = window.getActiveNetwork(); if(!net) return; const f = appState.filters;

        // Map DTs by their parent pole number for embedded rendering
        let poleDTMap = {};
        net.dts.forEach(d => {
            if(d.parentPole) {
                if(!poleDTMap[String(d.parentPole)]) poleDTMap[String(d.parentPole)] = [];
                poleDTMap[String(d.parentPole)].push(d);
            }
        });

        if (f.poles) {
            net.poles.forEach(p => {
                if(isNaN(p.lat) || isNaN(p.lng)) return;
                const isOrphan = appState.orphanPoleIds.has(p.id);
                if (appState.activeMove && appState.activeMove.id === p.id) return;
                
                const associatedDTs = poleDTMap[String(p.poleNo)] || [];
                const svgHtml = window.getPoleWithDTHTML(p, associatedDTs, isOrphan);
                
                // Anchor [25, 12] matches top cross-arm for line termination while embedding DT at bottom
                const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pole-marker-icon', html: svgHtml, iconSize: [50, 70], iconAnchor: [25, 12] }), zIndexOffset: 200 });
                
                m.on('click', () => { window.openObjectSheet('POLE', p.id, `Pole ${p.poleNo}`, `Type: <b>${p.lineType || 'HT'}</b><br>Config: <b>${p.poleType || 'Standard'}</b><br>Condition: <b>${p.condition||'Good'}</b>`); }); 
                featureGroups.poles.addLayer(m);
            });
        }
        
        // Standalone DTs (those without parent pole) still rendered via dts group
        if (f.dts) {
            net.dts.forEach(d => {
                if(!d.parentPole && d.lat && d.lng && !isNaN(d.lat)) {
                    const isOrphan = appState.orphanPoleIds.has(d.id); 
                    const svgHtml = window.getDTSVG(d.phase, d.rating);
                    const m = L.marker([d.lat, d.lng], { icon: L.divIcon({ className: `dt-square-icon ${isOrphan ? 'orphan-pulse' : ''}`, html: svgHtml, iconSize: [34, 40], iconAnchor: [17, 20] }), zIndexOffset: 400 });
                    m.on('click', () => { window.openObjectSheet('DT', d.id, `DT Code: ${d.code}`, `Rating: <b>${d.rating} kVA</b>`); }); 
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
                L.polyline(coordsR, { color: '#ef4444', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(line.coords, { color: '#facc15', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
                L.polyline(coordsB, { color: '#3b82f6', weight: 2, className: spec.lineClass, interactive: false }).addTo(featureGroups.lines); 
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
                const m = L.marker([c.lat + latOffset, c.lng + lngOffset], { icon: L.divIcon({ className: 'consumer-marker-icon', html: window.getConsumerSVG(c.cType, c.status), iconSize: [34,34], iconAnchor: [17, 17] }), zIndexOffset: 100 });
                m.on('click', () => { window.openObjectSheet('CONSUMER', c.id, c.name, `Type: <b>${c.cType||'Domestic'}</b><br>Status: <b>${c.status||'Regular'}</b><br>K-No: <b>${c.kno}</b><br>Load: <b>${c.load||'N/A'}</b>`); }); 
                featureGroups.consumers.addLayer(m);
                let parentStr = c.parentType === 'DT' ? `DT_${c.parentRef}` : `POLE_${c.parentRef}`; const pCoords = window.getNodeCoords(parentStr);
                if (pCoords && !isNaN(pCoords.lat)) L.polyline([[c.lat, c.lng], [pCoords.lat, pCoords.lng]], { color: '#000000', weight: 1.5, dashArray: '3, 5', interactive: false, className: 'consumer-line-path' }).addTo(featureGroups.consumerLines);
            });
        }
        
        window.updateMapZoomClasses();
        let t11 = 0, tLT = 0, dt3ph = 0, dt1ph = 0; net.lines.forEach(l => { if (window.getLineSpec(l.type).name.includes('LT')) tLT += (l.distanceMeters || 0); else t11 += (l.distanceMeters || 0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
        if(document.getElementById('kpi11')) document.getElementById('kpi11').innerText = window.formatDistance(t11); if(document.getElementById('kpiLT')) document.getElementById('kpiLT').innerText = window.formatDistance(tLT); document.getElementById('kpi3Ph').innerText = dt3ph; document.getElementById('kpi1Ph').innerText = dt1ph; document.getElementById('kpiCons').innerText = net.consumers.length;
    } catch(err) { console.error("Rendering error:", err); }
}

window.saveSnapshot = function() { 
    const net = window.getActiveNetwork(); if(!net) return; 
    historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers }))); 
    if (historyStack.length > 15) historyStack.shift(); 
}

window.undoLastAction = function() { 
    if (historyStack.length === 0) return window.showToast("No actions to Undo!"); 
    const prevState = historyStack.pop(), net = window.getActiveNetwork(); if(!net) return; 
    net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers; 
    window.renderEntireNetwork(); window.triggerPersistence(); window.showToast("Undo Successful ↺"); 
}
