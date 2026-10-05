/* --- js/5_crud_actions.js --- */

window.savePhotoData = function(id, base64) {
    if(!appState.photos) appState.photos = {};
    appState.photos[id] = base64;
    window.triggerPersistence();
    if(window.syncPhotosToCloud) {
        window.syncPhotosToCloud(id, base64);
    }
};

window.getPhotoUrl = function(id) {
    return (appState.photos && appState.photos[id]) ? appState.photos[id] : null;
};

/* --- Replace checkAndSplitLineOnPoleInsert inside js/5_crud_actions.js --- */

window.checkAndSplitLineOnPoleInsert = function(net, newPole) {
    if(!net || !net.lines || !net.poles) return;
    
    let targetLineIndex = -1;
    let matchedLine = null;

    // Search for the exact line segment that the new pole is intersecting
    for (let i = 0; i < net.lines.length; i++) {
        const l = net.lines[i];
        const n1 = window.getNodeCoords(l.fromNode);
        const n2 = window.getNodeCoords(l.toNode);
        
        if (n1 && n2) {
            // Check perpendicular distance to the line segment (Strictly within 4 meters)
            const distToSegment = window.calculatePointToSegmentDistance(
                { lat: newPole.lat, lng: newPole.lng },
                { lat: n1.lat, lng: n1.lng },
                { lat: n2.lat, lng: n2.lng }
            );

            // Verify the pole lies strictly between the segment endpoints
            const isBetweenEndpoints = window.isPointOnSegment(
                { lat: newPole.lat, lng: newPole.lng },
                { lat: n1.lat, lng: n1.lng },
                { lat: n2.lat, lng: n2.lng }
            );

            if (distToSegment <= 4.0 && isBetweenEndpoints) {
                targetLineIndex = i;
                matchedLine = l;
                break; // Stop at the first exact intersected line
            }
        }
    }

    if (matchedLine && targetLineIndex !== -1) {
        const originalFrom = matchedLine.fromNode;
        const originalTo = matchedLine.toNode;
        const lineType = matchedLine.type;
        const linePhase = matchedLine.phase;
        const lineCond = matchedLine.conductor;

        // 1. Remove the old single line securely
        net.lines.splice(targetLineIndex, 1);

        const newPoleNodeId = 'POLE_' + newPole.poleNo;

        // Prevent self-loops or duplicate segments
        if (originalFrom !== newPoleNodeId && originalTo !== newPoleNodeId) {
            // 2. Create Segment 1: Original From -> New Pole
            const segment1 = {
                id: 'LINE_' + Date.now() + '_1',
                type: lineType,
                phase: linePhase,
                conductor: lineCond,
                fromNode: originalFrom,
                toNode: newPoleNodeId
            };

            // 3. Create Segment 2: New Pole -> Original To
            const segment2 = {
                id: 'LINE_' + Date.now() + '_2',
                type: lineType,
                phase: linePhase,
                conductor: lineCond,
                fromNode: newPoleNodeId,
                toNode: originalTo
            };

            net.lines.push(segment1);
            net.lines.push(segment2);

            // Run network deduplication to ensure no overlapping lines exist
            if(window.deduplicateNetworkData) {
                window.deduplicateNetworkData();
            }

            if(window.showToast) {
                window.showToast(`✨ Magic Pole Split Successful via Pole ${newPole.poleNo}`);
            }
        }
    }
};


window.isPointOnSegment = function(p, a, b) {
    const dxy = Math.hypot(b.lat - a.lat, b.lng - a.lng);
    const dap = Math.hypot(p.lat - a.lat, p.lng - a.lng);
    const dbp = Math.hypot(p.lat - b.lat, p.lng - b.lng);
    return (dap + dbp) >= (dxy - 0.0001) && (dap + dbp) <= (dxy + 0.0001);
};

window.calculatePointToSegmentDistance = function(p, a, b) {
    const R = 6371000; 
    const rad = Math.PI / 180;
    
    const x = p.lng * Math.cos(a.lat * rad) * R * rad;
    const y = p.lat * R * rad;
    const x1 = a.lng * Math.cos(a.lat * rad) * R * rad;
    const y1 = a.lat * R * rad;
    const x2 = b.lng * Math.cos(a.lat * rad) * R * rad;
    const y2 = b.lat * R * rad;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    let dot = A * C + B * D;
    let len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
};

// ==========================================
// POLE, DT, LINE & CONSUMER SAVE ACTIONS
// ==========================================
window.saveNewPole = function() {
    const net = window.getActiveNetwork(); if(!net) return false;
    const poleNo = document.getElementById('inpPoleNo').value.trim(), pType = document.getElementById('inpMainPoleType').value, pCond = document.getElementById('inpPoleCondition').value, pConf = document.getElementById('inpPccConfig').value;
    if(!poleNo) { alert("Pole Number is required!"); return false; }
    if((net.poles||[]).some(p => String(p.poleNo) === poleNo && p.lineType !== 'LT')) { alert("HT Pole Number already exists!"); return false; }
    
    if(window.saveSnapshot) window.saveSnapshot();
    const newObj = { 
        id: 'POLE_' + Date.now(), 
        poleNo: poleNo, 
        lineType: 'HT', 
        poleType: pType, 
        condition: pCond, 
        poleConfig: pConf, 
        lat: parseFloat(document.getElementById('inpLat').value), 
        lng: parseFloat(document.getElementById('inpLng').value) 
    };
    
    if(window.tempPhotoUrl) { 
        window.savePhotoData(newObj.id, window.tempPhotoUrl); 
        window.tempPhotoUrl = null; 
    }
    
    net.poles.push(newObj); 

    // TRIGGER MAGIC POLE SPLIT CHECK
    window.checkAndSplitLineOnPoleInsert(net, newObj);

    appState.placementType = null; 
    return true;
};

window.saveNewLTPole = function() {
    const net = window.getActiveNetwork(); if(!net) return false;
    const dt = document.getElementById('inpLTPoleDT').value, pType = document.getElementById('inpMainPoleType').value, pCond = document.getElementById('inpPoleCondition').value;
    if(!dt) { alert("Associated DT is required!"); return false; }
    
    let maxL = 0;
    (net.poles||[]).filter(p => p.lineType === 'LT' && String(p.dtCode) === dt.replace('DT_','')).forEach(p => { const pts = String(p.poleNo).split('-'); if(pts.length > 1) { const num = parseInt(pts[1]); if(!isNaN(num) && num > maxL) maxL = num; } });
    const poleNo = dt.replace('DT_','') + '-' + (maxL + 1);
    
    if(window.saveSnapshot) window.saveSnapshot();
    const newObj = { id: 'POLE_' + Date.now(), poleNo: poleNo, lineType: 'LT', dtCode: dt.replace('DT_',''), poleType: pType, condition: pCond, lat: parseFloat(document.getElementById('inpLat').value), lng: parseFloat(document.getElementById('inpLng').value) };
    if(window.tempPhotoUrl) { window.savePhotoData(newObj.id, window.tempPhotoUrl); window.tempPhotoUrl = null; }
    net.poles.push(newObj); appState.placementType = null; return true;
};

window.saveNewLine = function() {
    const net = window.getActiveNetwork(); if(!net) return false;
    const type = document.getElementById('inpLineType').value, phase = document.getElementById('inpLinePhase') ? document.getElementById('inpLinePhase').value : '', cond = document.getElementById('inpConductor').value, fNode = document.getElementById('inpFromNode').value, tNode = document.getElementById('inpToNode').value;
    if(!fNode || !tNode || fNode === tNode) { alert("Invalid From/To nodes!"); return false; }
    if((net.lines||[]).some(l => (l.fromNode === fNode && l.toNode === tNode) || (l.fromNode === tNode && l.toNode === fNode))) { alert("This line route already exists!"); return false; }

    if(window.saveSnapshot) window.saveSnapshot();
    const newObj = { id: 'LINE_' + Date.now(), type: type, phase: phase, conductor: cond, fromNode: fNode, toNode: tNode };
    if(window.tempPhotoUrl) { window.savePhotoData(newObj.id, window.tempPhotoUrl); window.tempPhotoUrl = null; }
    net.lines.push(newObj); return true;
};

window.saveNewDT = function() {
    const net = window.getActiveNetwork(); if(!net) return false;
    const parent = document.getElementById('inpDTParent').value, mountedOn = document.getElementById('inpDTMounted').value, code = document.getElementById('inpDTCode').value.trim(), phase = document.getElementById('inpDTPhase').value, rating = document.getElementById('inpDTRating').value, loc = document.getElementById('inpDTLocation').value;
    if(!parent || !code || !rating) { alert("Code, Parent and Rating required!"); return false; }
    if((net.dts||[]).some(d => String(d.code) === code)) { alert(`A DT with Code ${code} already exists!`); return false; }

    let lat = 0, lng = 0;
    if(document.getElementById('inpLat')) { lat = parseFloat(document.getElementById('inpLat').value); lng = parseFloat(document.getElementById('inpLng').value); }
    if(isNaN(lat) || lat === 0) { const pNode = window.getNodeCoords(parent); if(pNode) { lat = pNode.lat; lng = pNode.lng; } }

    if(window.saveSnapshot) window.saveSnapshot();
    const newObj = { id: 'DT_' + Date.now(), code: code, parentPole: parent.replace('POLE_','').replace('GSS_',''), mountedOn: mountedOn, phase: phase, rating: rating, location: loc, lat: lat, lng: lng };
    if(window.tempPhotoUrl) { window.savePhotoData(newObj.id, window.tempPhotoUrl); window.tempPhotoUrl = null; }
    net.dts.push(newObj); appState.placementType = null; return true;
};

window.saveNewConsumer = function() {
    const net = window.getActiveNetwork(); if(!net) return false;
    const dt = document.getElementById('inpConsDT').value, parent = document.getElementById('inpConsParent').value, status = document.getElementById('inpConsStatus').value, cType = document.getElementById('inpConsType').value, kno = document.getElementById('inpConsKno').value.trim(), load = document.getElementById('inpConsLoad').value, name = document.getElementById('inpConsName').value.trim();
    if(!dt || !parent || !kno || !name) { alert("Missing K-No or Name!"); return false; }
    if((net.consumers||[]).some(c => String(c.kno) === kno)) { alert(`Consumer K-Number ${kno} already exists!`); return false; }

    if(window.saveSnapshot) window.saveSnapshot();
    const newObj = { id: 'CONS_' + Date.now(), parentType: parent.startsWith('DT_') ? 'DT' : 'POLE', parentRef: parent.replace('POLE_','').replace('DT_',''), status: status, cType: cType, kno: kno, load: load, name: name, lat: parseFloat(document.getElementById('inpLat').value), lng: parseFloat(document.getElementById('inpLng').value) };
    if(window.tempPhotoUrl) { window.savePhotoData(newObj.id, window.tempPhotoUrl); window.tempPhotoUrl = null; }
    net.consumers.push(newObj); appState.placementType = null; return true;
};

window.saveEditedGss = function(code) { 
    const gss = appState.gssNodes[code]; if(!gss) return false;
    const newName = document.getElementById('editGssName').value.trim();
    if(!newName) { alert("Name is required"); return false; }
    if(window.saveSnapshot) window.saveSnapshot(); gss.name = newName; return true; 
};
window.saveEditedPole = function(id) { 
    const net = window.getActiveNetwork(); if(!net) return false; const p = (net.poles||[]).find(x => x.id === id); if(!p) return false; 
    if(window.saveSnapshot) window.saveSnapshot(); 
    p.poleType = document.getElementById('editMainPoleType').value; p.condition = document.getElementById('editPoleCondition').value; p.poleConfig = document.getElementById('editPccConfig') ? document.getElementById('editPccConfig').value : p.poleConfig; return true; 
};
window.saveEditedDT = function(id) { 
    const net = window.getActiveNetwork(); if(!net) return false; const d = (net.dts||[]).find(x => x.id === id); if(!d) return false; 
    if(window.saveSnapshot) window.saveSnapshot(); 
    d.mountedOn = document.getElementById('editDTMounted').value; d.phase = document.getElementById('editDTPhase').value; d.rating = document.getElementById('editDTRating').value; d.location = document.getElementById('editDTLocation').value; return true; 
};
window.saveEditedConsumer = function(id) { 
    const net = window.getActiveNetwork(); if(!net) return false; const c = (net.consumers||[]).find(x => x.id === id); if(!c) return false; 
    if(window.saveSnapshot) window.saveSnapshot(); 
    c.name = document.getElementById('editConsName').value.trim(); c.load = document.getElementById('editConsLoad').value; c.status = document.getElementById('editConsStatus').value; c.cType = document.getElementById('editConsType').value; if(!c.name) { alert("Name required"); return false; } return true; 
};
window.saveEditedLine = function(id) { 
    const net = window.getActiveNetwork(); if(!net) return false; const l = (net.lines||[]).find(x => x.id === id); if(!l) return false; 
    if(window.saveSnapshot) window.saveSnapshot(); 
    l.phase = document.getElementById('editLinePhase') ? document.getElementById('editLinePhase').value : l.phase; l.conductor = document.getElementById('editLineConductor').value; return true; 
};

window.deleteEntity = function(type, id) {
    const net = window.getActiveNetwork(); if(!net) return;
    if(!confirm("Are you sure you want to delete this?")) return;
    if(window.saveSnapshot) window.saveSnapshot();
    if(!appState.deletedObjectIds) appState.deletedObjectIds = []; appState.deletedObjectIds.push(id);
    
    if (type === 'pole') net.poles = net.poles.filter(x => x.id !== id); 
    else if (type === 'dt') net.dts = net.dts.filter(x => x.id !== id); 
    else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id); 
    else if (type === 'line') net.lines = net.lines.filter(x => x.id !== id);
    
    if(appState.photos && appState.photos[id]) {
        delete appState.photos[id];
        if(window.deletePhotoFromCloud) {
            window.deletePhotoFromCloud(id);
        }
    }
    
    window.renderEntireNetwork(); window.triggerPersistence(); window.showToast("Deleted successfully");
};

window.startObjectMove = function(type, id, title) { appState.activeMove = { type, id }; document.getElementById('center-placement-pin').style.display = 'block'; window.closeObjectSheet(); let moveBar = document.getElementById('move-confirm-bar'); if(!moveBar) { moveBar = document.createElement('div'); moveBar.id = 'move-confirm-bar'; moveBar.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:9999999; display:flex; gap:10px; width:90%; max-width:400px; pointer-events:auto;'; moveBar.innerHTML = `<button class="btn-danger-outline" style="background:white; flex:1;" onclick="window.cancelMove()">Cancel</button><button class="btn-action-primary" style="flex:1;" onclick="window.confirmMove()">Set New Location</button>`; document.body.appendChild(moveBar); if(typeof L !== 'undefined' && L.DomEvent) { L.DomEvent.disableClickPropagation(moveBar); L.DomEvent.disableScrollPropagation(moveBar); } } moveBar.style.display = 'flex'; document.getElementById('bottom-single-action').style.display = 'none'; window.showToast("Pan map to new location..."); };
window.cancelMove = function() { appState.activeMove = null; document.getElementById('center-placement-pin').style.display = 'none'; document.getElementById('move-confirm-bar').style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; window.renderEntireNetwork(); };
window.confirmMove = function() { if(!appState.activeMove) return; const center = map.getCenter(); const net = window.getActiveNetwork(); if(window.saveSnapshot) window.saveSnapshot(); const { type, id } = appState.activeMove; if(type === 'GSS') { if(appState.gssNodes[id]) { appState.gssNodes[id].lat = center.lat; appState.gssNodes[id].lng = center.lng; } } else if(type === 'POLE' && net) { const p = (net.poles||[]).find(x => x.id === id); if(p) { p.lat = center.lat; p.lng = center.lng; } } else if(type === 'CONSUMER' && net) { const c = (net.consumers||[]).find(x => x.id === id); if(c) { c.lat = center.lat; c.lng = center.lng; } } window.cancelMove(); window.triggerPersistence(); window.showToast("Location Updated!"); };
