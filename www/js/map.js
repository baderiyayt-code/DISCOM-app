// Map Initialization (PERFORMANCE FIX: preferCanvas = true)
const map = L.map('map', { 
    zoomControl: false, 
    preferCanvas: true, // Crucial to prevent crash with 1000+ lines
    rotate: true, touchRotate: true 
}).setView([26.9150, 75.7830], 16);

const tileLayers = { 
    hybrid: { name: 'Hybrid Map', layer: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 22 }) }, 
    osm: { name: 'OpenStreetMap', layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }) }
};
let currentTileIndex = 0; const layerKeys = Object.keys(tileLayers); 
tileLayers[layerKeys[currentTileIndex]].layer.addTo(map);

function toggleMapLayer() { 
    map.removeLayer(tileLayers[layerKeys[currentTileIndex]].layer); 
    currentTileIndex = (currentTileIndex + 1) % layerKeys.length; 
    tileLayers[layerKeys[currentTileIndex]].layer.addTo(map); 
    document.getElementById('layer-indicator').innerText = tileLayers[layerKeys[currentTileIndex]].name;
}

const featureGroups = { 
    gss: L.layerGroup().addTo(map), 
    lines: L.layerGroup().addTo(map), 
    poles: L.markerClusterGroup({ disableClusteringAtZoom: 18, maxClusterRadius: 40 }).addTo(map), 
    dts: L.markerClusterGroup({ disableClusteringAtZoom: 17, maxClusterRadius: 40 }).addTo(map), 
    consumers: L.markerClusterGroup({ disableClusteringAtZoom: 19, maxClusterRadius: 30 }).addTo(map) 
};

map.on('move', () => { 
    const c = map.getCenter(); 
    document.getElementById('reticle-coordinates').innerText = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`; 
});

// PERFORMANCE FIX: Debounce rendering to avoid freezing UI on map drag/zoom
let renderTimer;
map.on('zoomend', () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderEntireNetwork, 200); });
map.on('moveend', () => { clearTimeout(renderTimer); renderTimer = setTimeout(renderEntireNetwork, 200); });

function renderEntireNetwork() {
    Object.values(featureGroups).forEach(g => g.clearLayers());
    const net = getActiveNetwork();
    const f = appState.filters;
    const currentZoom = map.getZoom();
    
    // Zoom limits to keep map fast
    const showConsumers = currentZoom >= 18 && f.consumers; 
    const showLTPoles = currentZoom >= 16 && f.poles;

    // Render GSS
    Object.values(appState.gssNodes).forEach(gss => {
        const m = L.marker([gss.lat, gss.lng], { 
            icon: L.divIcon({ className: 'gss-square-icon', html: `<span>GSS</span>`, iconSize: [32,32] }) 
        });
        featureGroups.gss.addLayer(m);
    });

    // Render Lines
    net.lines.forEach(line => {
        if(!line.coords || line.coords.length < 2) return;
        const isLT = line.type.includes('LT');
        if(isLT && !showLTPoles) return; // Don't show LT lines if zoomed out
        
        L.polyline(line.coords, { 
            color: isLT ? '#10b981' : '#2563eb', 
            weight: isLT ? 3 : 4 
        }).addTo(featureGroups.lines);
    });

    // Render Poles
    const poleMarkers = [];
    if(f.poles) {
        net.poles.forEach(p => {
            const isLT = p.lineType === 'LT';
            if (isLT && !showLTPoles) return;
            
            const m = L.marker([p.lat, p.lng], { 
                icon: L.divIcon({ className: isLT ? 'lt-pole-icon' : 'pole-marker-icon', html: `<span>${p.poleNo}</span>` }) 
            });
            m.on('click', (e) => {
                L.popup().setLatLng(e.latlng).setContent(`
                    <div style="padding:4px;"><b>Pole: ${p.poleNo} (${p.lineType})</b><br>
                    <button style="margin-top:5px; padding:5px 10px; background:#ef4444; color:white; border:none; border-radius:5px;" onclick="deleteEntity('pole','${p.id}')">Delete</button></div>
                `).openOn(map);
            });
            poleMarkers.push(m);
        });
        featureGroups.poles.addLayers(poleMarkers);
    }

    // Render DTs
    const dtMarkers = [];
    if(f.dts) {
        net.dts.forEach(d => {
            const m = L.marker([d.lat, d.lng], { 
                icon: L.divIcon({ className: 'dt-square-icon', html: `${d.rating}` }) 
            });
            dtMarkers.push(m);
        });
        featureGroups.dts.addLayers(dtMarkers);
    }

    // Render Consumers
    const consMarkers = [];
    if(showConsumers) {
        net.consumers.forEach(c => {
            const m = L.marker([c.lat, c.lng], { 
                icon: L.divIcon({ className: 'consumer-marker-icon', html: `<i class="fa-solid fa-house"></i>` }) 
            });
            consMarkers.push(m);
        });
        featureGroups.consumers.addLayers(consMarkers);
    }

    // Update KPI Dashboard
    document.getElementById('kpi3Ph').innerText = net.dts.length;
    document.getElementById('kpiCons').innerText = net.consumers.length;
    document.getElementById('feederSelectHeader').innerHTML = Object.keys(appState.feeders).map(code => 
        `<option value="${code}" ${code === appState.currentFeederCode ? 'selected':''}>${appState.feeders[code].feeder.name}</option>`
    ).join('');
}

function switchFeeder(code) { 
    appState.currentFeederCode = code; 
    renderEntireNetwork(); 
    triggerPersistence(); 
    const net = getActiveNetwork();
    const gss = appState.gssNodes[net.feeder.parentGss];
    if (gss) map.flyTo([gss.lat, gss.lng], 16); 
}
