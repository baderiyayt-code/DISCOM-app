window.saveNewPole = function() { 
    try {
        const no = document.getElementById('inpPoleNo').value.trim(); const category = document.getElementById('inpPoleCategory').value; const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; const condition = document.getElementById('inpPoleCondition').value;
        if (!no) return alert("Enter pole number"); const net = getActiveNetwork(); if(!net) return alert("No active network!"); if (net.poles.some(p => String(p.poleNo) === no)) return alert(`Pole exists!`); 
        saveSnapshot(); const objId = 'P_'+Date.now(); net.poles.push({ id: objId, poleNo: no, lineType: category, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng, synced: false }); 
        window.attachTempPhoto('POLE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("HT Pole added!");
    } catch(err) { console.error(err); alert("Error saving pole: " + err.message); }
}
window.saveNewLTPole = function() {
    try {
        const dtCodeRaw = document.getElementById('inpLTPoleDT').value; const dtCode = dtCodeRaw.replace('DT_', ''); const category = document.getElementById('inpPoleCategory').value; const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); const pType = document.getElementById('inpMainPoleType').value; const pConfig = pType === 'PCC' ? document.getElementById('inpPccConfig').value : 'N/A'; const condition = document.getElementById('inpPoleCondition').value;
        if (!dtCode) return alert("Select DT"); const net = getActiveNetwork(); if(!net) return alert("No active network!");
        const existingLTPoles = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(dtCode)); let maxId = 0; existingLTPoles.forEach(ep => { const parts = String(ep.poleNo).split('-'); if (parts.length > 1) { const num = parseInt(parts[parts.length - 1]); if (!isNaN(num) && num > maxId) maxId = num; } }); const finalPoleNo = `${dtCode}-${maxId + 1}`;
        if (net.poles.some(p => String(p.poleNo) === String(finalPoleNo))) return alert(`Pole ${finalPoleNo} exists!`); 
        saveSnapshot(); const objId = 'P_'+Date.now(); net.poles.push({ id: objId, poleNo: finalPoleNo, lineType: category, dtCode: dtCode, poleType: pType, poleConfig: pConfig, condition: condition, lat, lng, synced: false }); 
        window.attachTempPhoto('POLE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("LT Pole added!");
    } catch(err) { console.error(err); alert("Error saving LT pole: " + err.message); }
}
window.saveNewLine = function() { 
    try {
        const from = document.getElementById('inpFromNode').value; const to = document.getElementById('inpToNode').value; const type = document.getElementById('inpLineType').value; const conductor = document.getElementById('inpConductor').value; const phase = type === '11 KV LINE' ? document.getElementById('inpLinePhase').value : 'N/A';
        if (!from || !to) return alert("Please select both From and To nodes!"); if (from === to) return alert("Cannot connect node to itself!"); const net = getActiveNetwork(); if(!net) return alert("No active network!");
        const spec = getLineSpec(type, phase, conductor); const existingLine = net.lines.find(l => (l.fromNode === from && l.toNode === to) || (l.fromNode === to && l.toNode === from)); if(existingLine) return alert("Line already exists!");
        const c1 = getNodeCoords(from); const c2 = getNodeCoords(to); if(!c1 || !c2 || isNaN(c1.lat) || isNaN(c2.lat)) return alert("Invalid node coordinates! Check map placements."); 
        saveSnapshot(); const dist = window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng); const objId = 'LN_'+Date.now(); net.lines.push({ id: objId, type: spec.name, conductor: conductor, phase: phase, fromNode: from, toNode: to, distanceMeters: dist, coords: [[c1.lat, c1.lng], [c2.lat, c2.lng]], synced: false }); 
        window.attachTempPhoto('LINE', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line added!");
    } catch(err) { console.error(err); alert("Error saving line: " + err.message); }
}
window.saveNewDT = function() { 
    try {
        const parentRef = document.getElementById('inpDTParent').value; const code = document.getElementById('inpDTCode').value.trim(); const mountedOn = document.getElementById('inpDTMounted').value; const rating = parseFloat(document.getElementById('inpDTRating').value); const phase = document.getElementById('inpDTPhase').value; const location = document.getElementById('inpDTLocation').value.trim();
        if (!code) return alert("Enter DT Code"); const net = getActiveNetwork(); if(!net) return alert("No active network!");
        let rawParentRef = parentRef; if(parentRef.startsWith('POLE_')) rawParentRef = parentRef.replace('POLE_', ''); if(parentRef.startsWith('GSS_')) rawParentRef = parentRef.replace('GSS_', '');
        let lat = 0, lng = 0; const p = net.poles.find(x => String(x.poleNo) === String(rawParentRef)); if (p && !isNaN(p.lat)) { lat = p.lat; lng = p.lng; } else { const gss = appState.gssNodes[rawParentRef]; if(gss && !isNaN(gss.lat)) { lat = gss.lat; lng = gss.lng; } else return alert("Parent node coordinates missing!"); }
        saveSnapshot(); const objId = 'DT_' + Date.now(); net.dts.push({ id: objId, parentPole: rawParentRef, mountedOn: mountedOn, code, rating, phase, location, lat: lat, lng: lng, synced: false }); 
        window.attachTempPhoto('DT', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT added!");
    } catch(err) { console.error(err); alert("Error saving DT: " + err.message); }
}
window.saveNewConsumer = function() { 
    try {
        const parentRefRaw = document.getElementById('inpConsParent').value; const kno = document.getElementById('inpConsKno').value.trim(); const name = document.getElementById('inpConsName').value.trim(); const load = document.getElementById('inpConsLoad').value.trim(); const status = document.getElementById('inpConsStatus').value; const cType = document.getElementById('inpConsType').value; const lat = parseFloat(document.getElementById('inpLat').value); const lng = parseFloat(document.getElementById('inpLng').value); 
        const net = getActiveNetwork(); if(!net) return alert("No active network!"); if(net.consumers.some(c => String(c.kno) === String(kno))) return alert("K-Number exists!");
        let rawParentRef = parentRefRaw; if (rawParentRef.startsWith('POLE_')) rawParentRef = rawParentRef.replace('POLE_', ''); if (rawParentRef.startsWith('DT_')) rawParentRef = rawParentRef.replace('DT_', ''); let parentType = parentRefRaw.startsWith('DT_') ? 'DT' : 'POLE';
        if (!name || !kno) return alert("Enter Name and K-No"); 
        saveSnapshot(); const objId = 'CS_'+Date.now(); net.consumers.push({ id: objId, parentRef: rawParentRef, parentType, kno, name, load, status, cType, lat, lng, synced: false }); 
        window.attachTempPhoto('CONSUMER', objId); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer added!");
    } catch(err) { console.error(err); alert("Error saving consumer: " + err.message); }
}

window.saveEditedPole = function(id) { const net = getActiveNetwork(); const p = net.poles.find(x => x.id === id); if(!p) return; p.poleType = document.getElementById('editMainPoleType').value; p.poleConfig = p.poleType === 'PCC' ? document.getElementById('editPccConfig').value : 'N/A'; p.condition = document.getElementById('editPoleCondition').value; p.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Pole Settings Updated"); }
window.saveEditedDT = function(id) { const net = getActiveNetwork(); const d = net.dts.find(x => x.id === id); if (!d) return; d.phase = document.getElementById('editDTPhase').value; d.mountedOn = document.getElementById('editDTMounted').value; d.rating = parseFloat(document.getElementById('editDTRating').value); d.location = document.getElementById('editDTLocation').value.trim(); d.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("DT Updated"); }
window.saveEditedConsumer = function(id) { const net = getActiveNetwork(); const c = net.consumers.find(x => x.id === id); if (!c) return; c.name = document.getElementById('editConsName').value.trim(); c.load = document.getElementById('editConsLoad').value.trim(); c.status = document.getElementById('editConsStatus').value; c.cType = document.getElementById('editConsType').value; c.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Consumer Updated"); }
window.saveEditedLine = function(id) { const net = getActiveNetwork(); const l = net.lines.find(x => x.id === id); if (!l) return; if(l.type.includes('11')) l.phase = document.getElementById('editLinePhase').value; l.conductor = document.getElementById('editLineConductor').value; l.synced = false; saveSnapshot(); window.closeModal(); renderEntireNetwork(); triggerPersistence(); showToast("Line Updated"); }

function deleteDTLogic(dtId, net) { const d = net.dts.find(x => x.id === dtId); if(!d) return; const ltPolesToRemove = net.poles.filter(p => p.lineType === 'LT' && String(p.dtCode) === String(d.code)), ltPoleIds = ltPolesToRemove.map(p => String(p.poleNo)), ltPoleNodeIds = ltPoleIds.map(pn => 'POLE_' + pn); net.lines = net.lines.filter(l => l.fromNode !== ('DT_' + d.code) && l.toNode !== ('DT_' + d.code) && !ltPoleNodeIds.includes(String(l.fromNode)) && !ltPoleNodeIds.includes(String(l.toNode))); net.consumers = net.consumers.filter(c => { const isDirectToDT = (c.parentType === 'DT' && String(c.parentRef) === String(d.code)), isOnRemovedLTPole = (c.parentType === 'POLE' && ltPoleIds.includes(String(c.parentRef))); return !(isDirectToDT || isOnRemovedLTPole); }); net.poles = net.poles.filter(p => !ltPoleIds.includes(String(p.poleNo))); net.dts = net.dts.filter(x => x.id !== dtId); }
function deleteLTPoleLogic(p, net) { net.consumers = net.consumers.filter(c => !(c.parentType === 'POLE' && String(c.parentRef) === String(p.poleNo))); net.lines = net.lines.filter(l => String(l.fromNode) !== ('POLE_'+p.poleNo) && String(l.toNode) !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== p.id); }

window.deleteEntity = function(type, id) {
    const net = getActiveNetwork(); if(!confirm(`Delete this ${type.toUpperCase()}?`)) return; saveSnapshot();
    const beforeIds = [...net.poles, ...net.lines, ...net.dts, ...net.consumers].map(x=>x.id);
    if (type === 'line') net.lines = net.lines.filter(x => x.id !== id); else if (type === 'consumer') net.consumers = net.consumers.filter(x => x.id !== id); else if (type === 'dt') deleteDTLogic(id, net);
    else if (type === 'pole') { const p = net.poles.find(x => x.id === id); if (p) { if (p.lineType === 'LT') deleteLTPoleLogic(p, net); else { const dtsOnPole = net.dts.filter(d => String(d.parentPole) === String(p.poleNo)); dtsOnPole.forEach(dt => deleteDTLogic(dt.id, net)); net.lines = net.lines.filter(l => l.fromNode !== ('POLE_'+p.poleNo) && l.toNode !== ('POLE_'+p.poleNo)); net.poles = net.poles.filter(x => x.id !== id); } } } 
    else if (type === 'gss') { if (appState.gssNodes[id]) delete appState.gssNodes[id]; }
    const afterIds = new Set([...net.poles, ...net.lines, ...net.dts, ...net.consumers].map(x=>x.id));
    if(!appState.deletedObjectIds) appState.deletedObjectIds = []; beforeIds.forEach(bId => { if(!afterIds.has(bId)) appState.deletedObjectIds.push(bId); });
    window.closeObjectSheet(); renderEntireNetwork(); triggerPersistence(); showToast("Deleted!");
}

window.startObjectMove = function(type, id, title) {
    window.closeObjectSheet(); appState.activeMove = { type: type, id: id }; 
    const pin = document.getElementById('center-placement-pin'); if(pin) pin.style.display = 'block'; 
    const bsa = document.getElementById('bottom-single-action'); if(bsa) bsa.style.display = 'none';
    let moveBar = document.getElementById('move-confirm-bar');
    if(moveBar) moveBar.remove(); 
    moveBar = document.createElement('div'); moveBar.id = 'move-confirm-bar'; 
    moveBar.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:9999999; display:flex; gap:10px; width:90%; max-width:400px; pointer-events:auto;'; 
    moveBar.innerHTML = `<button type="button" class="btn-danger-outline" style="background:white; margin-top:0; pointer-events:auto; flex:1; font-weight:800;" onpointerdown="event.stopPropagation();" onclick="window.cancelMove(event)">Cancel</button><button type="button" class="btn-action-primary" style="margin-top:0; pointer-events:auto; flex:1; font-weight:800;" onpointerdown="event.stopPropagation();" onclick="window.confirmMove(event)">Confirm Move</button>`; 
    document.body.appendChild(moveBar); renderEntireNetwork(); 
}
window.cancelMove = function(e) { if(e){e.preventDefault(); e.stopPropagation();} appState.activeMove = null; const pin = document.getElementById('center-placement-pin'); if(pin) pin.style.display = 'none'; const moveBar = document.getElementById('move-confirm-bar'); if(moveBar) moveBar.remove(); const bsa = document.getElementById('bottom-single-action'); if(bsa) bsa.style.display = 'block'; renderEntireNetwork(); }
window.confirmMove = function(e) {
    if(e){e.preventDefault(); e.stopPropagation();}
    try {
        if(!appState.activeMove) return; const net = getActiveNetwork(); if(!net) return; const center = map.getCenter(); const { type, id } = appState.activeMove;
        let objList = null; if(type === 'POLE') objList = net.poles; else if(type === 'DT') objList = net.dts; else if(type === 'CONSUMER') objList = net.consumers; else if(type === 'GSS') { if(appState.gssNodes[id]) { appState.gssNodes[id].lat = center.lat; appState.gssNodes[id].lng = center.lng; } }
        if(objList) { const obj = objList.find(x => x.id === id); if(obj) { obj.lat = center.lat; obj.lng = center.lng; obj.synced = false; } }
        if(typeof saveSnapshot === 'function') saveSnapshot(); if(typeof triggerPersistence === 'function') triggerPersistence(); window.cancelMove(); showToast("Location Updated!");
    } catch(err) { console.error("Move Error:", err); alert("Move Error: " + err.message); }
}

window.attachTempPhoto = function(type, id) { if(window.tempPhotoUrl) { if(!appState.photos) appState.photos = []; appState.photos.push({ id: 'PH_' + Date.now(), object_type: type, object_id: id, photo_url: window.tempPhotoUrl, synced: false }); window.tempPhotoUrl = null; } };
window.captureTempPhoto = function() { if (typeof navigator.camera === 'undefined') return alert("Camera plugin not found."); navigator.camera.getPicture(function(imageData) { window.tempPhotoUrl = "data:image/jpeg;base64," + imageData; document.getElementById('formTempPhoto').src = window.tempPhotoUrl; document.getElementById('formTempPhoto').style.display = 'block'; }, function(err) { showToast("Camera cancelled"); }, { quality: 50, destinationType: Camera.DestinationType.DATA_URL, sourceType: Camera.PictureSourceType.CAMERA, saveToPhotoAlbum: false }); };
window.captureObjectPhoto = function() { if (!window.currentSelectedObj || !appState.user.isLoggedIn) return; if (typeof navigator.camera === 'undefined') return alert("Camera plugin not installed."); navigator.camera.getPicture(function(imageData) { showToast("Saving photo..."); const base64Data = "data:image/jpeg;base64," + imageData; if(!appState.photos) appState.photos = []; appState.photos = appState.photos.filter(x => x.object_id !== window.currentSelectedObj.id); appState.photos.push({ id: 'PH_' + Date.now(), object_type: window.currentSelectedObj.type, object_id: window.currentSelectedObj.id, photo_url: base64Data, synced: false }); const imgEl = document.getElementById('objPhotoImg'); const placeholderEl = document.getElementById('objPhotoPlaceholder'); imgEl.src = base64Data; imgEl.style.display = 'block'; placeholderEl.style.display = 'none'; triggerPersistence(); }, function(message) { alert('Camera cancelled or failed: ' + message); }, { quality: 50, destinationType: Camera.DestinationType.DATA_URL, sourceType: Camera.PictureSourceType.CAMERA, saveToPhotoAlbum: false }); };

function saveSnapshot() { const net = getActiveNetwork(); if(!net) return; historyStack.push(JSON.parse(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers }))); if (historyStack.length > 15) historyStack.shift(); }
window.undoLastAction = function() { if (historyStack.length === 0) return showToast("No actions to Undo!"); const prevState = historyStack.pop(), net = getActiveNetwork(); if(!net) return; net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers; renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺"); }
