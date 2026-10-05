/* --- js/4_ui_forms.js --- */

window.tempPhotoUrl = null;
window.currentSelectedObj = null;

// ==========================================
// CAMERA & PHOTO CAPTURE LOGIC
// ==========================================
window.captureTempPhoto = function() {
    if (typeof navigator !== 'undefined' && navigator.camera) {
        navigator.camera.getPicture((imgData) => {
            window.tempPhotoUrl = "data:image/jpeg;base64," + imgData;
            const imgEl = document.getElementById('formTempPhoto');
            if(imgEl) { imgEl.src = window.tempPhotoUrl; imgEl.style.display = 'block'; }
        }, (err) => { alert("Camera error: " + err); }, {
            quality: 40, destinationType: 0, targetWidth: 800, targetHeight: 800, correctOrientation: true
        });
    } else {
        let input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
        input.onchange = e => {
            let file = e.target.files[0]; if(!file) return; let reader = new FileReader();
            reader.onload = ev => {
                window.tempPhotoUrl = ev.target.result;
                const imgEl = document.getElementById('formTempPhoto');
                if(imgEl) { imgEl.src = window.tempPhotoUrl; imgEl.style.display = 'block'; }
            }; reader.readAsDataURL(file);
        }; input.click();
    }
};

window.captureObjectPhoto = function() {
    if(!window.currentSelectedObj) return alert("Error: Object not selected!");
    const id = window.currentSelectedObj.id;
    
    const processPhoto = (base64Data) => {
        if(window.savePhotoData) window.savePhotoData(id, base64Data);
        const imgEl = document.getElementById('objPhotoImg');
        const placeholderEl = document.getElementById('objPhotoPlaceholder');
        if(imgEl && placeholderEl) { imgEl.src = base64Data; imgEl.style.display = 'block'; placeholderEl.style.display = 'none'; }
        if(window.showToast) window.showToast("Photo Saved Successfully!");
    };

    if (typeof navigator !== 'undefined' && navigator.camera) {
        navigator.camera.getPicture((imgData) => { processPhoto("data:image/jpeg;base64," + imgData); }, 
        (err) => { alert("Camera error: " + err); }, { quality: 40, destinationType: 0, targetWidth: 800, targetHeight: 800, correctOrientation: true });
    } else {
        let input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
        input.onchange = e => {
            let file = e.target.files[0]; if(!file) return; let reader = new FileReader();
            reader.onload = ev => processPhoto(ev.target.result); reader.readAsDataURL(file);
        }; input.click();
    }
};

// ==========================================
// FULL SCREEN PHOTO LOGIC
// ==========================================
window.openFullScreenPhoto = function(src) {
    if(!src || src === '' || src === window.location.href) return;
    const viewer = document.getElementById('full-photo-viewer');
    const img = document.getElementById('full-photo-img');
    if(viewer && img) { img.src = src; viewer.style.display = 'flex'; }
};
window.closeFullScreenPhoto = function() {
    const viewer = document.getElementById('full-photo-viewer');
    if(viewer) viewer.style.display = 'none';
};

window.openModal = function(html) { 
    document.getElementById('modalSheetContent').innerHTML = html; 
    document.getElementById('formModalOverlay').classList.add('open'); 
    window.tempPhotoUrl = null; 
}
window.closeModal = function() { 
    document.getElementById('formModalOverlay').classList.remove('open'); 
    const distInd = document.getElementById('live-distance-indicator'); if(distInd) distInd.style.display='none'; 
    if(appState.user && appState.user.isLoggedIn) { setTimeout(() => { if(typeof window.checkOnboardingFlow === 'function') window.checkOnboardingFlow(); }, 400); } 
}

window.isSavingData = false; 
window.executeSafeSave = function(actionFn) {
    if(window.isSavingData) return; window.isSavingData = true;
    let hasError = false; const origAlert = window.alert;
    window.alert = function(msg) { hasError = true; origAlert(msg); };
    try { const result = actionFn(); if(result === false) hasError = true; } catch(e) { hasError = true; console.error("Save Error:", e); }
    window.alert = origAlert;
    if(!hasError) { 
        window.closeModal(); 
        try { if(window.renderEntireNetwork) window.renderEntireNetwork(); } catch(e){ console.error(e); }
        try { if(window.triggerPersistence) window.triggerPersistence(); } catch(e){ console.error(e); }
    }
    setTimeout(() => { window.isSavingData = false; }, 800); 
};

window.toggleSpeedDial = function(e) { 
    if(e) { e.preventDefault(); e.stopPropagation(); } 
    const dial = document.getElementById('speed-dial-menu'); const fab = document.getElementById('mainFabBtn'); 
    if (!dial || !fab) return; 
    const isOpen = !dial.classList.contains('active'); 
    dial.classList.toggle('active', isOpen); fab.classList.toggle('open', isOpen); 
}
document.addEventListener('click', function(e) { 
    const dial = document.getElementById('speed-dial-menu'); const fab = document.getElementById('mainFabBtn'); 
    if (dial && dial.classList.contains('active')) { if (!dial.contains(e.target) && !fab.contains(e.target)) { dial.classList.remove('active'); fab.classList.remove('open'); } } 
});

window.toggleSidebar = function(open) { 
    document.getElementById('sidebar-drawer').classList.toggle('open', open); document.getElementById('sidebarBackdrop').classList.toggle('open', open); 
    if(open) { window.renderGssSidebarList(); window.renderFeederSidebarList(); } 
}

window.toggleGssFolder = function() { const content = document.getElementById('gssFolderContent'), icon = document.getElementById('gssFolderIcon'); if (!content || !icon) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderGssSidebarList(); };
window.toggleFeederFolder = function() { const content = document.getElementById('feederFolderContent'), icon = document.getElementById('feederFolderIcon'); if (!content || !icon) return; const isHidden = content.style.display === 'none'; content.style.display = isHidden ? 'block' : 'none'; icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; if (isHidden) window.renderFeederSidebarList(); };

window.renderGssSidebarList = function() {
    const container = document.getElementById('gssListContainer'); if (!container) return; let html = '';
    Object.values(appState.gssNodes || {}).forEach(gss => { html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-glass); padding:8px; border-radius:6px; margin-top:6px; border:1px solid var(--border);"><div><b style="font-size:0.85rem;">${gss.name}</b><br><small style="color:var(--text-sub);">Code: ${gss.code}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="window.relocateGss('${gss.code}')" title="Relocate GSS"><i class="fa-solid fa-location-crosshairs"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="window.deleteGssAndFeederStrict('${gss.code}')" title="Strict Delete"><i class="fa-solid fa-trash"></i></button></div></div>`; }); container.innerHTML = html;
};

window.renderFeederSidebarList = function() {
    const container = document.getElementById('feederListContainer'); if (!container) return; let html = '';
    Object.keys(appState.feeders || {}).forEach(fCode => {
        const f = appState.feeders[fCode].feeder; const isActive = appState.currentFeederCode === fCode;
        const bgClass = isActive ? 'background:rgba(37,99,235,0.1); border-left:4px solid var(--accent);' : 'background:var(--bg-glass); border:1px solid var(--border);';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-radius:6px; margin-top:6px; ${bgClass}" onclick="window.switchFeeder('${fCode}')"><div style="cursor:pointer; width: 100%;"><b style="font-size:0.85rem; color:var(--text-main);">${f.name}</b><br><small style="color:var(--text-sub);">GSS: ${f.parentGss}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="event.stopPropagation(); window.openEditFeederModal('${fCode}')"><i class="fa-solid fa-pen"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="event.stopPropagation(); window.deleteFeederStrict('${fCode}')"><i class="fa-solid fa-trash"></i></button></div></div>`;
    }); container.innerHTML = html;
};

window.openFeederConfigModal = function() {
    window.toggleSidebar(false); const gssOpts = Object.values(appState.gssNodes || {}).map(g => `<option value="${g.code}">${g.name}</option>`).join('');
    window.openModal(`<div class="sheet-head"><div class="sheet-title">Add Feeder</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><select id="inpFeederGss" class="form-select">${gssOpts}</select><label>Select GSS*</label></div><div class="form-row"><input type="text" id="inpFeederCode" class="form-input" placeholder=" "><label>Feeder Code*</label></div><div class="form-row"><input type="text" id="inpFeederName" class="form-input" placeholder=" "><label>Feeder Name*</label></div><button class="btn-action-primary" onclick="window.saveNewFeeder()">Save Feeder</button>`);
};

window.saveNewFeeder = function() { 
    try {
        const gss = document.getElementById('inpFeederGss').value; const code = document.getElementById('inpFeederCode').value.trim(); const name = document.getElementById('inpFeederName').value.trim(); 
        if(!gss || !code || !name) return alert("All fields are required"); 
        if(!appState.feeders) appState.feeders = {}; 
        if(appState.feeders[code]) return alert("Feeder code already exists"); 
        
        appState.feeders[code] = { feeder: { name: name, code: code, subdivCode: "SD-01", parentGss: gss }, poles: [], dts: [], lines: [], consumers: [] }; 
        appState.currentFeederCode = code; 
        window.closeModal(); 
        
        setTimeout(() => {
            try { if(window.renderEntireNetwork) window.renderEntireNetwork(); } catch(e){}
            try { if(window.triggerPersistence) window.triggerPersistence(); } catch(e){}
            if(window.showToast) window.showToast("Feeder Added!"); 
        }, 100);
    } catch (e) { alert("Error saving feeder!"); }
};

window.openEditFeederModal = function(code) {
    window.toggleSidebar(false); window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit Feeder Name</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" class="form-input" value="${code}" disabled placeholder=" "><label>Feeder Code (Locked)</label></div><div class="form-row"><input type="text" id="editFeederName" class="form-input" placeholder=" " value="${appState.feeders[code].feeder.name}"><label>New Name*</label></div><button class="btn-action-primary" onclick="window.saveEditedFeeder('${code}')">Save Changes</button>`);
}
window.saveEditedFeeder = function(code) { 
    try { const newName = document.getElementById('editFeederName').value.trim(); if(!newName) return alert("Enter new name"); if(appState.feeders[code]) { appState.feeders[code].feeder.name = newName; if(window.triggerPersistence) window.triggerPersistence(); window.closeModal(); if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.showToast) window.showToast("Feeder Updated!"); } } catch (e) { console.error(e); }
}

window.deleteFeederStrict = function(code) { 
    try {
        if (!confirm(`WARNING: Deleting Feeder ${code} will destroy all data inside it. Continue?`)) return; if (prompt(`Type Feeder code "${code}" to confirm:`) !== code) return alert("Cancelled"); 
        if (appState.feeders[code]) { const f = appState.feeders[code]; const ids = [...(f.poles||[]), ...(f.lines||[]), ...(f.dts||[]), ...(f.consumers||[])].map(x=>x.id); if(!appState.deletedObjectIds) appState.deletedObjectIds = []; appState.deletedObjectIds.push(...ids); if(!appState.deletedFeederCodes) appState.deletedFeederCodes = []; appState.deletedFeederCodes.push(code); }
        delete appState.feeders[code]; if(appState.currentFeederCode === code) { const remaining = Object.keys(appState.feeders); appState.currentFeederCode = remaining.length > 0 ? remaining[0] : null; } 
        window.closeModal(); if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.triggerPersistence) window.triggerPersistence(); if(window.showToast) window.showToast("Feeder Deleted!"); if(window.checkOnboardingFlow) window.checkOnboardingFlow(); 
    } catch (e) { console.error(e); }
}

window.deleteGssAndFeederStrict = function(code) { 
    try {
        if (!confirm(`WARNING: You are about to delete GSS ${code} and ALL its associated feeders! Continue?`)) return; if (prompt(`Type GSS code "${code}" to confirm:`) !== code) return alert("Cancelled"); 
        if(window.saveSnapshot) window.saveSnapshot(); if (appState.gssNodes[code]) delete appState.gssNodes[code]; const feedersToDelete = []; Object.keys(appState.feeders || {}).forEach(fCode => { if (appState.feeders[fCode].feeder.parentGss === code) feedersToDelete.push(fCode); }); feedersToDelete.forEach(fCode => window.deleteFeederStrict(fCode)); 
        if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.triggerPersistence) window.triggerPersistence(); window.renderGssSidebarList(); window.showToast("Deleted completely!"); if(window.checkOnboardingFlow) window.checkOnboardingFlow(); 
    } catch (e) { console.error(e); }
}

window.openAddGssModal = function() { window.toggleSidebar(false); window.openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> Add New GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" id="inpGssCode" class="form-input" placeholder=" "><label>GSS Code*</label></div><div class="form-row"><input type="text" id="inpGssName" class="form-input" placeholder=" "><label>GSS Name*</label></div><button class="btn-action-primary" onclick="window.saveNewGss()">Save GSS</button>`); };

window.saveNewGss = function() { 
    try {
        const code = document.getElementById('inpGssCode').value.trim(); const name = document.getElementById('inpGssName').value.trim(); 
        if (!code || !name) return alert("Enter GSS Code and Name"); 
        if (!appState.gssNodes) appState.gssNodes = {}; 
        if (appState.gssNodes[code]) return alert("GSS Code already exists!"); 
        
        let centerLat = 26.9150; let centerLng = 75.7830; 
        if(typeof map !== 'undefined' && map) { const center = map.getCenter(); centerLat = parseFloat(center.lat.toFixed(6)); centerLng = parseFloat(center.lng.toFixed(6)); }
        
        appState.gssNodes[code] = { code: code, name: name, lat: centerLat, lng: centerLng }; 
        window.closeModal(); 
        
        setTimeout(() => {
            try { if(window.renderEntireNetwork) window.renderEntireNetwork(); } catch(e){}
            try { if(window.triggerPersistence) window.triggerPersistence(); } catch(e){}
            if(window.showToast) window.showToast("New GSS added!"); 
            if(window.checkOnboardingFlow) window.checkOnboardingFlow();
        }, 100);
    } catch(e) { alert("Error saving GSS!"); }
};

window.relocateGss = function(gssCode) { if(window.closeObjectSheet) window.closeObjectSheet(); window.toggleSidebar(false); if(window.startObjectMove) window.startObjectMove('GSS', gssCode, `GSS (${gssCode})`); };
window.autoSaveSettings = function() { appState.settings.unit = document.getElementById('setUnit').value; appState.settings.language = document.getElementById('setLanguage').value; appState.settings.theme = document.getElementById('setTheme').value; appState.settings.liveSync = document.getElementById('setLiveSync').checked; window.applyTranslations(); window.applyTheme(); window.triggerPersistence(); window.renderEntireNetwork(); window.showToast("Settings Saved!"); }
window.openSettingsPage = function() { window.toggleSidebar(false); document.getElementById('setUnit').value = appState.settings.unit || 'm'; document.getElementById('setLanguage').value = appState.settings.language || 'en'; document.getElementById('setTheme').value = appState.settings.theme || 'light'; document.getElementById('setLiveSync').checked = appState.settings.liveSync !== false; document.getElementById('settings-page').classList.add('open'); }
window.closeSettingsPage = function() { document.getElementById('settings-page').classList.remove('open'); }

window.openAboutModal = function() { window.toggleSidebar(false); window.openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-circle-info" style="color:#3b82f6;"></i> About App</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div style="text-align: center; padding: 10px 0 20px 0;"><div style="width: 64px; height: 64px; background: var(--accent); color: white; font-size: 32px; border-radius: 16px; display: flex; align-items:center; justify-content:center; margin: 0 auto 15px auto; box-shadow: 0 8px 20px rgba(37,99,235,0.3);"><i class="fa-solid fa-bolt"></i></div><h3 style="font-size: 1.2rem; font-weight: 900; color: var(--text-main); margin-bottom: 5px;">DISCOM Survey Pro</h3><p style="font-size: 0.85rem; color: var(--text-sub); margin-bottom: 20px;">Professional GIS-based field survey mobile application designed for electricity infrastructure mapping, asset tracking, and enterprise-grade data management.</p><div style="background: var(--bg-glass); border: 1px solid var(--border); padding: 12px; border-radius: 10px; text-align: left; margin-bottom: 20px;"><div style="font-size: 0.8rem; color: var(--text-sub);">Developed By</div><div style="font-size: 0.95rem; font-weight: 800; color: var(--text-main); margin-top: 2px;">Suraj Singh Mehta</div><div style="font-size: 0.75rem; color: var(--accent); margin-top: 4px;">Electrical Asset Management Specialist</div></div><div style="font-size: 0.75rem; color: var(--text-sub);">Version 2.5.0 (Enterprise Edition)</div></div>`); };

window.openFilterModal = function() { const f = appState.filters; window.openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-filter" style="color:#d97706;"></i> Object Filter</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="capsule-filter-group"><label class="capsule"><input type="checkbox" id="flt11" ${f.lines11?'checked':''}><span>11 KV Line</span></label><label class="capsule"><input type="checkbox" id="fltLT" ${f.linesLT?'checked':''}><span>LT Line</span></label><label class="capsule"><input type="checkbox" id="fltPoles" ${f.poles?'checked':''}><span>Poles</span></label><label class="capsule"><input type="checkbox" id="fltDTs" ${f.dts?'checked':''}><span>DT</span></label><label class="capsule"><input type="checkbox" id="fltCons" ${f.consumers?'checked':''}><span>Consumers</span></label></div><button class="btn-action-primary" onclick="window.saveFilters()" style="margin-top:20px;">Apply Filters</button>`); }
window.saveFilters = function() { appState.filters.lines11 = document.getElementById('flt11').checked; appState.filters.linesLT = document.getElementById('fltLT').checked; appState.filters.poles = document.getElementById('fltPoles').checked; appState.filters.dts = document.getElementById('fltDTs').checked; appState.filters.consumers = document.getElementById('fltCons').checked; window.closeModal(); window.renderEntireNetwork(); window.showToast("Filters Updated"); }

window.toggleSearchBox = function() { let box = document.getElementById('searchBoxOverlay'); if(!box) { box = document.createElement('div'); box.id = 'searchBoxOverlay'; box.style.cssText = 'position:absolute; top:65px; left:12px; right:12px; z-index:9000; background:var(--bg-glass); backdrop-filter:blur(10px); padding:10px; border-radius:12px; box-shadow:var(--shadow-md); display:flex; flex-direction:column; gap:10px; border:1px solid var(--border);'; box.innerHTML = `<div style="display:flex; gap:10px; align-items:center;"><input type="text" id="appSearchBar" class="search-input-full" placeholder="Search Consumer, DT, Pole..." onkeyup="window.handleSearch(event)"><button class="action-btn-sm" onclick="window.toggleSearchBox()"><i class="fa-solid fa-times"></i></button></div><div id="searchSuggestions" class="suggestions-panel" style="position:relative; box-shadow:none; border:none; top:0;"></div>`; document.getElementById('app-container').appendChild(box); } else { box.style.display = box.style.display === 'none' ? 'flex' : 'none'; if(box.style.display === 'none') window.clearSearch(); } if(box.style.display === 'flex') { document.getElementById('appSearchBar').focus(); if(window.applyTranslations) window.applyTranslations(); } }
window.handleSearch = function(e) { const query = e.target.value.toLowerCase().trim(), suggPanel = document.getElementById('searchSuggestions'); if(query.length === 0) { suggPanel.classList.remove('active'); return; } const net = window.getActiveNetwork(); if(!net) return; let results = []; (net.consumers||[]).forEach(c => { if (String(c.kno).toLowerCase().includes(query) || (c.name && c.name.toLowerCase().includes(query))) results.push({ type: 'CONSUMER', id: c.id, title: c.name, desc: `K-No: ${c.kno} | Connected to: ${c.parentRef}` }); }); (net.dts||[]).forEach(d => { if (String(d.code).toLowerCase().includes(query) || String(d.rating).includes(query) || (d.location && d.location.toLowerCase().includes(query))) results.push({ type: 'DT', id: d.id, title: `DT Code: ${d.code}`, desc: `Rating: ${d.rating} kVA | Loc: ${d.location || 'N/A'}` }); }); (net.poles||[]).forEach(p => { if (String(p.poleNo).toLowerCase().includes(query)) results.push({ type: 'POLE', id: p.id, title: `Pole: ${p.poleNo}`, desc: `Type: ${p.lineType} | ${p.poleType}` }); }); if (results.length > 0) { suggPanel.innerHTML = results.slice(0, 15).map(r => `<div class="suggestion-item" onclick="window.selectSearchResult('${r.type}', '${r.id}')"><div class="sugg-title"><span style="color:var(--accent); font-weight:800;">${r.title}</span></div><div class="sugg-desc" style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">${r.desc}</div></div>`).join(''); suggPanel.classList.add('active'); } else { suggPanel.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#64748b;">No results found</div>`; suggPanel.classList.add('active'); } }
window.clearSearch = function() { const bar = document.getElementById('appSearchBar'); if(bar) bar.value = ''; const sugg = document.getElementById('searchSuggestions'); if(sugg) sugg.classList.remove('active'); }
window.selectSearchResult = function(type, id) { const net = window.getActiveNetwork(); if(!net) return; window.clearSearch(); window.toggleSearchBox(); let target = null, popupHtml = ''; if(type === 'CONSUMER') { target = net.consumers.find(c => c.id === id); if(target) popupHtml = `K-No: <b>${target.kno}</b><br>Connected to: <b>${target.parentRef}</b>`; } else if(type === 'DT') { target = net.dts.find(d => d.id === id); if(target) popupHtml = `Rating: <b>${target.rating} kVA</b><br>Loc: <b>${target.location || 'N/A'}</b>`; } else if(type === 'POLE') { target = net.poles.find(p => p.id === id); if(target) popupHtml = `Type: <b>${target.lineType}</b><br>Condition: <b>${target.condition || 'Good'}</b>`; } if(target && target.lat) { if(map) map.flyTo([target.lat, target.lng], 19, { duration: 1 }); setTimeout(() => { if(window.openObjectSheet) window.openObjectSheet(type, id, type === 'CONSUMER' ? target.name : (type === 'DT' ? `DT: ${target.code}` : `Pole: ${target.poleNo}`), popupHtml); }, 1000); } }

window.closeObjectSheet = function() { document.getElementById('object-bottom-sheet').classList.remove('open'); window.currentSelectedObj = null; };

window.openObjectSheet = function(type, id, title, detailsHtml) {
    window.currentSelectedObj = { type, id }; 
    document.getElementById('objSheetTitle').innerText = title; 
    document.getElementById('objSheetDetails').innerHTML = detailsHtml;
    
    const imgEl = document.getElementById('objPhotoImg'); const placeholderEl = document.getElementById('objPhotoPlaceholder');
    const applyPhoto = (url) => { if(url) { imgEl.src = url; imgEl.style.display = 'block'; placeholderEl.style.display = 'none'; } else { imgEl.style.display = 'none'; imgEl.src = ''; placeholderEl.style.display = 'flex'; } };
    const photoUrl = window.getPhotoUrl ? window.getPhotoUrl(id) : null; if(photoUrl instanceof Promise) { applyPhoto(null); photoUrl.then(applyPhoto); } else { applyPhoto(photoUrl); }
    
    document.getElementById('object-bottom-sheet').classList.add('open'); 
    document.getElementById('btnObjEdit').onclick = () => window.openEditModal(type.toLowerCase(), id);
    document.getElementById('btnObjDelete').style.display = (type === 'GSS') ? 'none' : 'block'; 
    document.getElementById('btnObjMove').style.display = (type === 'DT') ? 'none' : 'block';
    document.getElementById('btnObjMove').onclick = () => { if(window.startObjectMove) window.startObjectMove(type, id, title); }; 
    document.getElementById('btnObjDelete').onclick = () => { if(window.deleteEntity) window.deleteEntity(type.toLowerCase(), id); window.closeObjectSheet(); };
};

window.openDTFromSVG = function(e, id) {
    if(e) e.stopPropagation(); 
    const net = window.getActiveNetwork(); if(!net) return;
    const d = (net.dts||[]).find(x => x.id === id);
    if(!d) return;

    window.currentSelectedObj = { type: 'DT', id: d.id };

    const connectedConsumers = [];
    (net.consumers||[]).forEach(c => {
        let isConnected = false;
        if(String(c.parentRef) === String(d.code) || String(c.parentRef) === String('DT_' + d.code)) {
            isConnected = true;
        } else {
            const pole = (net.poles||[]).find(p => String(p.poleNo) === String(c.parentRef) || String(p.id) === String('POLE_' + c.parentRef));
            if(pole && String(pole.dtCode) === String(d.code)) { isConnected = true; }
        }
        if(isConnected) { connectedConsumers.push(c); }
    });

    let totalLoadKW = 0;
    connectedConsumers.forEach(c => {
        const loadStr = String(c.load || '0'); 
        const numMatch = loadStr.match(/[\d.]+/); 
        if(numMatch) totalLoadKW += parseFloat(numMatch[0]) || 0;
    });

    let tableRowsHtml = '';
    if(connectedConsumers.length === 0) {
        tableRowsHtml = `<tr><td colspan="5" style="text-align:center; padding:12px; color:var(--text-sub); font-size:0.8rem;">No consumers connected to this DT yet.</td></tr>`;
    } else {
        connectedConsumers.forEach((c, index) => {
            tableRowsHtml += `
                <tr style="border-bottom: 1px solid var(--border);">
                    <td style="padding:6px 8px; font-size:0.75rem; text-align:center;">${index + 1}</td>
                    <td style="padding:6px 8px; font-size:0.75rem; font-weight:700;">${c.kno || 'N/A'}</td>
                    <td style="padding:6px 8px; font-size:0.75rem;">${c.name || 'Unknown'}</td>
                    <td style="padding:6px 8px; font-size:0.75rem;">${c.cType || 'Domestic'}</td>
                    <td style="padding:6px 8px; font-size:0.75rem; text-align:right;">${c.load || '1 kW'}</td>
                </tr>`;
        });
    }

    const photoUrl = window.getPhotoUrl ? window.getPhotoUrl(d.id) : null;

    window.openModal(`
        <div class="sheet-head">
            <div class="sheet-title"><i class="fa-solid fa-bolt" style="color:var(--accent);"></i> DT Details & Consumers</div>
            <button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        
        <div style="padding: 2px 0;">
            <!-- SIDE THUMBNAIL LAYOUT -->
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                <div style="position:relative; width:64px; height:64px; border-radius:10px; overflow:hidden; background:var(--bg-glass); border:1px solid var(--border); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
                    <div id="objPhotoPlaceholder" style="font-size:1.4rem; color:var(--text-sub); ${photoUrl ? 'display:none;' : 'display:flex;'}"><i class="fa-solid fa-camera"></i></div>
                    <img id="objPhotoImg" src="${photoUrl || ''}" onclick="window.openFullScreenPhoto(this.src)" style="width:100%; height:100%; object-fit:cover; cursor:pointer; ${photoUrl ? 'display:block;' : 'display:none;'}">
                </div>
                <div style="flex:1; display:grid; grid-template-columns: 1fr 1fr; gap:6px; background:var(--bg-glass); padding:8px; border-radius:10px; border:1px solid var(--border);">
                    <div><span style="font-size:0.65rem; color:var(--text-sub);">DT Code</span><div style="font-weight:900; font-size:0.85rem;">${d.code}</div></div>
                    <div><span style="font-size:0.65rem; color:var(--text-sub);">Rating</span><div style="font-weight:900; font-size:0.85rem; color:var(--accent);">${d.rating} kVA</div></div>
                    <div><span style="font-size:0.65rem; color:var(--text-sub);">Phase</span><div style="font-weight:700; font-size:0.75rem;">${d.phase || '3-Phase'}</div></div>
                    <div><span style="font-size:0.65rem; color:var(--text-sub);">Load</span><div style="font-weight:700; font-size:0.75rem; color:#10b981;">${totalLoadKW.toFixed(2)} kW</div></div>
                </div>
            </div>

            <div style="font-weight:800; font-size:0.8rem; margin-bottom:6px; color:var(--text-main);">Connected Consumers List</div>
            
            <div style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; background:var(--bg-base); margin-bottom: 12px;">
                <table style="width:100%; border-collapse: collapse; text-align:left;">
                    <thead>
                        <tr style="background:var(--bg-glass); border-bottom:2px solid var(--border); font-size:0.7rem; color:var(--text-sub);">
                            <th style="padding:6px 8px; text-align:center;">#</th>
                            <th style="padding:6px 8px;">K-No</th>
                            <th style="padding:6px 8px;">Name</th>
                            <th style="padding:6px 8px;">Category</th>
                            <th style="padding:6px 8px; text-align:right;">Load</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>

            <!-- ACTION BUTTONS -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                <button class="btn-action-primary" style="margin:0; background:#0f172a; font-size:0.8rem; padding:10px;" onclick="window.exportDtReportPdf('${d.id}')"><i class="fa-solid fa-file-pdf"></i> PDF Report</button>
                <button class="btn-action-primary" style="margin:0; background:var(--accent); font-size:0.8rem; padding:10px;" onclick="window.openEditModal('dt', '${d.id}')"><i class="fa-solid fa-pen"></i> Edit DT</button>
                <button class="btn-action-primary" style="margin:0; background:#ef4444; font-size:0.8rem; padding:10px;" onclick="if(confirm('Delete DT ${d.code}?')) { window.deleteEntity('dt', '${d.id}'); window.closeModal(); }"><i class="fa-solid fa-trash"></i> Delete DT</button>
                <button class="btn-action-primary" style="margin:0; background:#0f172a; color:#fff; font-size:0.8rem; padding:10px;" onclick="window.captureObjectPhoto()"><i class="fa-solid fa-camera"></i> Capture Photo</button>
            </div>
        </div>
    `);
};

const dtRatingOptionsHtml = `<option value="10">10 kVA</option><option value="16">16 kVA</option><option value="25" selected>25 kVA</option><option value="40">40 kVA</option><option value="63">63 kVA</option><option value="100">100 kVA</option><option value="160">160 kVA</option><option value="250">250 kVA</option><option value="315">315 kVA</option><option value="500">500 kVA</option>`;
window.togglePccConfig = function(id = 'inpMainPoleType', targetId = 'pccConfigDiv') { const pType = document.getElementById(id)?.value; const configDiv = document.getElementById(targetId); if(configDiv) configDiv.style.display = pType === 'PCC' ? 'block' : 'none'; };
window.toggleLineConductor = function(id = 'inpLineType', targetId = 'inpConductor') { const lType = document.getElementById(id)?.value; const sel = document.getElementById(targetId); if(!sel) return; if(lType === '11 KV LINE') { sel.innerHTML = `<option value="Weasel">Weasel</option><option value="Rabbit">Rabbit</option><option value="Dog">Dog</option><option value="Underground Cable">Underground Cable</option>`; if(document.getElementById('linePhaseRow')) document.getElementById('linePhaseRow').style.display = 'block'; } else { sel.innerHTML = `<option value="Single Phase">Single Phase</option><option value="Three Phase">Three Phase</option>`; if(document.getElementById('linePhaseRow')) document.getElementById('linePhaseRow').style.display = 'none'; } };
window.updateDTRatingDropdowns = function(phaseId, ratingId) { const phase = document.getElementById(phaseId)?.value; const ratingSel = document.getElementById(ratingId); if(!ratingSel) return; if(phase === 'Single Phase') ratingSel.innerHTML = `<option value="5">5 kVA</option><option value="10">10 kVA</option><option value="16" selected>16 kVA</option><option value="25">25 kVA</option>`; else ratingSel.innerHTML = dtRatingOptionsHtml; };

window.filterLineNodes = function() {
    const net = window.getActiveNetwork(); if(!net) return; const type = document.getElementById('inpLineType')?.value || ''; const fromSel = document.getElementById('inpFromNode'); const dtSelectorBox = document.getElementById('ltLineDTSelector'); if(!fromSel) return;
    let nodes = []; let center = map ? map.getCenter() : {lat:26.91, lng:75.78};
    if (type.includes('LT')) {
        if(dtSelectorBox) dtSelectorBox.style.display = 'block'; const selectedDT = document.getElementById('inpTargetDT')?.value || '';
        if(!selectedDT) { fromSel.innerHTML='<option value="">Select DT first</option>'; const toNode = document.getElementById('inpToNode'); if(toNode) toNode.innerHTML=''; return; }
        const cleanDT = selectedDT.replace('DT_', ''); nodes = (net.poles||[]).filter(p => p.lineType === 'LT' && String(p.dtCode) === String(cleanDT)).map(p => ({id: 'POLE_' + p.poleNo, title: 'LT Pole: '+p.poleNo, lat: p.lat, lng: p.lng}));
        const dtObj = (net.dts||[]).find(d => String(d.code) === String(cleanDT)); if(dtObj) nodes.push({id: 'DT_'+cleanDT, title: 'DT: '+cleanDT, lat: dtObj.lat, lng: dtObj.lng});
    } else {
        if(dtSelectorBox) dtSelectorBox.style.display = 'none'; nodes = (net.poles||[]).filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_' + p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng}));
        const parentGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if (parentGss) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
    }
    nodes = window.sortByDistance(nodes, center.lat, center.lng); let defaultFrom = nodes.length > 0 ? nodes[0].id : ''; fromSel.innerHTML = nodes.map(n => `<option value="${n.id}" ${n.id === defaultFrom ? 'selected' : ''}>${n.title} (${window.getDistStr(n.lat, n.lng)})</option>`).join(''); window.syncLineToSelect(); window.toggleLineConductor('inpLineType', 'inpConductor');
};
window.syncLineToSelect = function() {
    const net = window.getActiveNetwork(); if(!net) return; const type = document.getElementById('inpLineType')?.value || ''; const fromVal = document.getElementById('inpFromNode')?.value || ''; const toSel = document.getElementById('inpToNode'); if(!toSel) return;
    let nodes = []; let center = map ? map.getCenter() : {lat:26.91, lng:75.78};
    if (type.includes('LT')) {
        const selectedDT = document.getElementById('inpTargetDT') ? String(document.getElementById('inpTargetDT').value) : ''; const cleanDT = selectedDT.replace('DT_', '');
        nodes = (net.poles||[]).filter(p => p.lineType === 'LT' && String(p.dtCode) === cleanDT).map(p => ({id: 'POLE_' + p.poleNo, title: 'LT Pole: '+p.poleNo, lat: p.lat, lng: p.lng}));
        if(cleanDT) { const dtObj = (net.dts||[]).find(d => String(d.code) === cleanDT); if(dtObj) nodes.push({id: 'DT_'+cleanDT, title: 'DT: '+cleanDT, lat: dtObj.lat, lng: dtObj.lng}); }
    } else {
        nodes = (net.poles||[]).filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_' + p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng}));
        const parentGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if (parentGss && ('GSS_'+parentGss.code) !== fromVal) nodes.push({id: 'GSS_'+parentGss.code, title: 'GSS ('+parentGss.code+')', lat: parentGss.lat, lng: parentGss.lng});
    }
    nodes = nodes.filter(n => n.id !== fromVal); nodes = window.sortByDistance(nodes, center.lat, center.lng); toSel.innerHTML = nodes.map(n => `<option value="${n.id}">${n.title} (${window.getDistStr(n.lat, n.lng)})</option>`).join(''); 
};
window.filterConsumerPoles = function() {
    const net = window.getActiveNetwork(); if(!net) return; const dtNode = document.getElementById('inpConsDT'); if(!dtNode) return; const selectedDT = dtNode.value; if(!selectedDT) return; const cleanDT = selectedDT.replace('DT_', '');
    const centerLat = parseFloat(document.getElementById('inpLat').value), centerLng = parseFloat(document.getElementById('inpLng').value);
    let nodes = (net.poles||[]).filter(p => p.lineType === 'LT' && String(p.dtCode) === String(cleanDT)).map(p => ({id: 'POLE_' + p.poleNo, title: 'LT Pole: '+p.poleNo, lat: p.lat, lng: p.lng}));
    const dtObj = (net.dts||[]).find(d => String(d.code) === String(cleanDT)); if(dtObj) nodes.push({id: 'DT_' + cleanDT, title: 'Direct to DT: '+cleanDT, lat: dtObj.lat, lng: dtObj.lng});
    nodes = window.sortByDistance(nodes, centerLat, centerLng); document.getElementById('inpConsParent').innerHTML = nodes.map(n => `<option value="${n.id}">${n.title} (${window.getDistStr(n.lat, n.lng)})</option>`).join('');
};

window.getCameraFormHtml = () => `<div style="margin-top:20px; margin-bottom:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%;"><img id="formTempPhoto" src="" onclick="window.openFullScreenPhoto(this.src)" style="width:160px; height:160px; object-fit:cover; border-radius:12px; display:none; margin-bottom:15px; border:2px solid var(--accent); box-shadow:0 4px 8px rgba(0,0,0,0.15); cursor:pointer;"><button type="button" class="btn-action-primary" style="padding:12px 24px; background:#0f172a; margin:0; border-radius:8px; width:100%;" onclick="window.captureTempPhoto()"><i class="fa-solid fa-camera"></i> Capture Photo</button></div>`;

window.openAddForm = function(type) { 
    window.toggleSpeedDial(false); 
    if (type === 'POLE' || type === 'LTPOLE' || type === 'CONSUMER') { 
        appState.placementType = type; document.getElementById('center-placement-pin').style.display = 'block'; document.getElementById('bottom-single-action').style.display = 'none'; 
        let confirmBar = document.getElementById('placement-confirm-bar'); 
        if(!confirmBar) { confirmBar = document.createElement('div'); confirmBar.id = 'placement-confirm-bar'; confirmBar.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:9999999; display:flex; gap:10px; width:90%; max-width:400px; pointer-events:auto;'; confirmBar.innerHTML = `<button type="button" class="btn-danger-outline" style="background:white; margin-top:0; pointer-events:auto; flex:1; font-weight:800;" onpointerdown="event.stopPropagation();" onclick="window.cancelPlacement(event)">Cancel</button><button type="button" class="btn-action-primary" style="margin-top:0; pointer-events:auto; flex:1; font-weight:800;" onpointerdown="event.stopPropagation();" onclick="window.confirmPlacement(event)">Place Here</button>`; document.body.appendChild(confirmBar); if(typeof L !== 'undefined' && L.DomEvent) { L.DomEvent.disableClickPropagation(confirmBar); L.DomEvent.disableScrollPropagation(confirmBar); } }
        confirmBar.style.display = 'flex'; 
    } else { window.showFormModal(type, null, null); } 
}

window.confirmPlacement = function(e) { if(e){e.preventDefault(); e.stopPropagation();} document.getElementById('center-placement-pin').style.display = 'none'; const distInd = document.getElementById('live-distance-indicator'); if(distInd) distInd.style.display='none'; const confirmBar = document.getElementById('placement-confirm-bar'); if(confirmBar) confirmBar.style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; const center = map.getCenter(); window.showFormModal(appState.placementType, parseFloat(center.lat.toFixed(6)), parseFloat(center.lng.toFixed(6))); }
window.cancelPlacement = function(e) { if(e){e.preventDefault(); e.stopPropagation();} document.getElementById('center-placement-pin').style.display = 'none'; const distInd = document.getElementById('live-distance-indicator'); if(distInd) distInd.style.display='none'; const confirmBar = document.getElementById('placement-confirm-bar'); if(confirmBar) confirmBar.style.display = 'none'; document.getElementById('bottom-single-action').style.display = 'block'; }

window.showFormModal = function(type, snapLat, snapLng) {
    const net = window.getActiveNetwork(); if(!net) return; let center = { lat: 26.91, lng: 75.78 }; if(map) center = map.getCenter(); snapLat = snapLat || parseFloat(center.lat.toFixed(6)); snapLng = snapLng || parseFloat(center.lng.toFixed(6)); window.tempPhotoUrl = null;
    if (type === 'POLE' || type === 'LTPOLE') {
        const isHT = type === 'POLE'; let dtSelectHtml = ''; let nextNo = '';
        if(isHT) { let maxHtNo = 0; (net.poles||[]).filter(p => p.lineType !== 'LT').forEach(p => { const num = parseInt(p.poleNo); if(!isNaN(num) && num > maxHtNo) maxHtNo = num; }); nextNo = maxHtNo + 1; } 
        else { if ((net.dts||[]).length === 0) return alert("Add a DT first!"); let sortedDTs = window.sortByDistance((net.dts||[]).map(d=>({id: d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); dtSelectHtml = `<div class="form-row"><select id="inpLTPoleDT" class="form-select">${sortedDTs.map(d => `<option value="${d.id}">DT: ${d.id.replace('DT_','')} (${window.getDistStr(d.lat, d.lng)})</option>`).join('')}</select><label>Associated DT*</label></div>`; }
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Add ${isHT?'HT':'LT'} Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div>${dtSelectHtml}${isHT ? `<div class="form-row"><input type="number" id="inpPoleNo" class="form-input" placeholder=" " value="${nextNo}"><label>Pole Number*</label></div>` : ''}<div class="form-grid-2"><div class="form-row"><select id="inpMainPoleType" class="form-select" onchange="window.togglePccConfig('inpMainPoleType', 'pccConfigDiv')"><option value="PCC" selected>PCC</option><option value="TOWER">TOWER</option><option value="RAIL POLE">RAIL POLE</option></select><label>Pole Type*</label></div><div class="form-row"><select id="inpPoleCondition" class="form-select"><option value="Good" selected>Good</option><option value="Tilted">Tilted</option><option value="Damaged">Damaged</option></select><label>Condition</label></div></div><div class="form-row" id="pccConfigDiv" style="display:block;"><select id="inpPccConfig" class="form-select"><option value="Single Pole" selected>Single Pole</option><option value="Double Pole">Double Pole</option></select><label>PCC Configuration</label></div><input type="hidden" id="inpPoleCategory" value="${isHT?'HT':'LT'}"><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}">${window.getCameraFormHtml()}<button class="btn-action-primary" onclick="window.executeSafeSave(() => ${isHT?'window.saveNewPole()':'window.saveNewLTPole()'})">Save Pole</button>`);
    } else if (type === 'LINE') {
        if ((net.poles||[]).length === 0) return alert("Add at least one pole first!");
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Add Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-grid-2"><div class="form-row"><select id="inpLineType" class="form-select" onchange="window.filterLineNodes(); window.toggleLineConductor('inpLineType', 'inpConductor');"><option value="11 KV LINE" selected>11 KV (HT)</option><option value="LT LINE">LT Line</option></select><label>Voltage Type*</label></div><div class="form-row" id="linePhaseRow"><select id="inpLinePhase" class="form-select"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select><label>Phase Type (HT)*</label></div></div><div class="form-row"><select id="inpConductor" class="form-select"></select><label>Conductor*</label></div><div id="ltLineDTSelector" style="display:none; background:var(--bg-glass); padding:8px; border-radius:8px; margin-bottom:12px;"><label style="position:static; display:block; margin-bottom:5px;">Select DT for LT Route*</label><select id="inpTargetDT" class="form-select" onchange="window.filterLineNodes()"></select></div><div class="form-grid-2"><div class="form-row"><select id="inpFromNode" class="form-select" onchange="window.syncLineToSelect()"></select><label>From Node*</label></div><div class="form-row"><select id="inpToNode" class="form-select"></select><label>To Node*</label></div></div>${window.getCameraFormHtml()}<button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveNewLine())">Save Line</button>`);
        setTimeout(() => { let sortedDTs = window.sortByDistance((net.dts||[]).map(d=>({id: 'DT_'+d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); const targetDtSel = document.getElementById('inpTargetDT'); if(targetDtSel) targetDtSel.innerHTML = sortedDTs.map(d => `<option value="${d.id}">${d.id.replace('_', ': ')}</option>`).join(''); window.filterLineNodes(); window.toggleLineConductor('inpLineType', 'inpConductor'); }, 100);
    } else if (type === 'DT') {
        let parentNodes = (net.poles||[]).filter(p => p.lineType !== 'LT').map(p => ({id: 'POLE_'+p.poleNo, title: 'HT Pole '+p.poleNo, lat: p.lat, lng: p.lng})); const feederGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null; if(feederGss) parentNodes.push({id: 'GSS_'+feederGss.code, title: 'GSS '+feederGss.code, lat: feederGss.lat, lng: feederGss.lng});
        parentNodes = window.sortByDistance(parentNodes, snapLat, snapLng); const parentOpts = parentNodes.map(p => `<option value="${p.id}">${p.title} (${window.getDistStr(p.lat, p.lng)})</option>`).join('');
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Add DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><select id="inpDTParent" class="form-select">${parentOpts}</select><label>Connected To (HT Node)*</label></div><div class="form-row"><select id="inpDTMounted" class="form-select"><option value="Double Pole (DP)" selected>Double Pole (DP)</option><option value="Single Pole (SP)">Single Pole (SP)</option><option value="Plinth">Plinth</option></select><label>Mounted On*</label></div><div class="form-grid-2"><div class="form-row"><input type="number" id="inpDTCode" class="form-input" placeholder=" " value="${Math.floor(Math.random()*9000)}"><label>DT Code*</label></div><div class="form-row"><select id="inpDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating')"><option value="Three Phase" selected>Three Phase</option><option value="Single Phase">Single Phase</option></select><label>Phase*</label></div></div><div class="form-row"><select id="inpDTRating" class="form-select">${dtRatingOptionsHtml}</select><label>Rating (kVA)*</label></div><div class="form-row"><input type="text" id="inpDTLocation" class="form-input" placeholder=" "><label>Location / Landmark</label></div>${window.getCameraFormHtml()}<button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveNewDT())">Save DT</button>`);
        setTimeout(() => window.updateDTRatingDropdowns('inpDTPhase', 'inpDTRating'), 100);
    } else if (type === 'CONSUMER') {
        if ((net.dts||[]).length === 0) return alert("Must have at least one DT!"); let sortedDTs = window.sortByDistance((net.dts||[]).map(d=>({id: 'DT_'+d.code, lat: d.lat, lng: d.lng})), snapLat, snapLng); const dtOpts = sortedDTs.map(d => `<option value="${d.id}">${d.id.replace('_', ': ')} (${window.getDistStr(d.lat, d.lng)})</option>`).join('');
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Add Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-grid-2"><div class="form-row"><select id="inpConsDT" class="form-select" onchange="window.filterConsumerPoles()">${dtOpts}</select><label>Parent DT*</label></div><div class="form-row"><select id="inpConsParent" class="form-select"></select><label>Connects To*</label></div></div><div class="form-grid-2"><div class="form-row"><select id="inpConsStatus" class="form-select"><option value="Regular" selected>Regular</option><option value="DC">DC</option><option value="PDC">PDC</option></select><label>Status</label></div><div class="form-row"><select id="inpConsType" class="form-select"><option value="Domestic" selected>Domestic</option><option value="NonDomestic">NonDomestic</option><option value="Agriculture">Agriculture</option><option value="Govt.">Govt.</option><option value="SIP MIP">SIP MIP</option><option value="Other">Other</option></select><label>Type</label></div></div><div class="form-grid-2"><div class="form-row"><input type="number" id="inpConsKno" class="form-input" placeholder=" "><label>K-Number*</label></div><div class="form-row"><input type="text" id="inpConsLoad" class="form-input" placeholder=" " value="1 kW"><label>Load</label></div></div><div class="form-row"><input type="text" id="inpConsName" class="form-input" placeholder=" "><label>Consumer Name*</label></div><input type="hidden" id="inpLat" value="${snapLat}"><input type="hidden" id="inpLng" value="${snapLng}">${window.getCameraFormHtml()}<button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveNewConsumer())">Save Consumer</button>`);
        setTimeout(() => window.filterConsumerPoles(), 100);
    }
}

window.openEditModal = function(type, id) {
    window.closeObjectSheet(); 
    const net = window.getActiveNetwork();

    if (type === 'gss') {
        const gss = appState.gssNodes[id]; if(!gss) return;
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" class="form-input" placeholder=" " value="${gss.code}" disabled><label>GSS Code (Locked)</label></div><div class="form-row"><input type="text" id="editGssName" class="form-input" placeholder=" " value="${gss.name}"><label>GSS Name*</label></div><button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveEditedGss('${gss.code}'))">Save Changes</button>`);
        return;
    }
    
    if(!net) return;

    if (type === 'pole') { 
        const p = (net.poles||[]).find(x => x.id === id); if (!p) return; 
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit Pole</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" id="editPoleNo" class="form-input" placeholder=" " value="${p.poleNo}" disabled><label>Pole Number (Locked)</label></div><div class="form-grid-2"><div class="form-row"><select id="editMainPoleType" class="form-select" onchange="window.togglePccConfig('editMainPoleType', 'editPccConfigDiv')"><option value="PCC" ${p.poleType==='PCC'?'selected':''}>PCC</option><option value="TOWER" ${p.poleType==='TOWER'?'selected':''}>TOWER</option><option value="RAIL POLE" ${p.poleType==='RAIL POLE'?'selected':''}>RAIL POLE</option></select><label>Pole Type*</label></div><div class="form-row"><select id="editPoleCondition" class="form-select"><option value="Good" ${p.condition==='Good'?'selected':''}>Good</option><option value="Tilted" ${p.condition==='Tilted'?'selected':''}>Tilted</option><option value="Damaged" ${p.condition==='Damaged'?'selected':''}>Damaged</option></select><label>Condition</label></div></div><div class="form-row" id="editPccConfigDiv" style="display:${p.poleType==='PCC'?'block':'none'};"><select id="editPccConfig" class="form-select"><option value="Single Pole" ${p.poleConfig==='Single Pole'?'selected':''}>Single Pole</option><option value="Double Pole" ${p.poleConfig==='Double Pole'?'selected':''}>Double Pole</option></select><label>PCC Configuration</label></div><button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveEditedPole('${p.id}'))">Save Changes</button>`); 
    } else if (type === 'dt') { 
        const d = (net.dts||[]).find(x => x.id === id); if (!d) return; 
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit DT</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><select id="editDTMounted" class="form-select"><option value="Double Pole (DP)" ${d.mountedOn==='Double Pole (DP)'?'selected':''}>Double Pole (DP)</option><option value="Single Pole (SP)" ${d.mountedOn==='Single Pole (SP)'?'selected':''}>Single Pole (SP)</option><option value="Plinth" ${d.mountedOn==='Plinth'?'selected':''}>Plinth</option></select><label>Mounted On*</label></div><div class="form-grid-2"><div class="form-row"><input type="text" class="form-input" placeholder=" " value="${d.code}" disabled><label>DT Code (Locked)</label></div><div class="form-row"><select id="editDTPhase" class="form-select" onchange="window.updateDTRatingDropdowns('editDTPhase', 'editDTRating')"><option value="Three Phase" ${d.phase==='Three Phase'?'selected':''}>Three Phase</option><option value="Single Phase" ${d.phase==='Single Phase'?'selected':''}>Single Phase</option></select><label>Phase*</label></div></div><div class="form-row"><select id="editDTRating" class="form-select">${dtRatingOptionsHtml}</select><label>Rating (kVA)*</label></div><div class="form-row"><input type="text" id="editDTLocation" class="form-input" placeholder=" " value="${d.location || ''}"><label>Location</label></div><button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveEditedDT('${d.id}'))">Save Changes</button>`); setTimeout(() => { window.updateDTRatingDropdowns('editDTPhase', 'editDTRating'); document.getElementById('editDTRating').value = d.rating; }, 50); 
    } else if (type === 'consumer') { 
        const c = (net.consumers||[]).find(x => x.id === id); if (!c) return; 
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit Consumer</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" id="editConsName" class="form-input" placeholder=" " value="${c.name}"><label>Consumer Name*</label></div><div class="form-grid-2"><div class="form-row"><input type="number" class="form-input" placeholder=" " value="${c.kno}" disabled><label>K-Number (Locked)</label></div><div class="form-row"><input type="text" id="editConsLoad" class="form-input" placeholder=" " value="${c.load||''}"><label>Load</label></div></div><div class="form-grid-2"><div class="form-row"><select id="editConsStatus" class="form-select"><option value="Regular" ${c.status==='Regular'?'selected':''}>Regular</option><option value="DC" ${c.status==='DC'?'selected':''}>DC</option><option value="PDC" ${c.status==='PDC'?'selected':''}>PDC</option></select><label>Status</label></div><div class="form-row"><select id="editConsType" class="form-select"><option value="Domestic" ${c.cType==='Domestic'?'selected':''}>Domestic</option><option value="NonDomestic" ${c.cType==='NonDomestic'?'selected':''}>NonDomestic</option><option value="Agriculture" ${c.cType==='Agriculture'?'selected':''}>Agriculture</option><option value="Govt." ${c.cType==='Govt.'?'selected':''}>Govt.</option><option value="SIP MIP" ${c.cType==='SIP MIP'?'selected':''}>SIP MIP</option><option value="Other" ${c.cType==='Other'?'selected':''}>Other</option></select><label>Type</label></div></div><button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveEditedConsumer('${c.id}'))">Save Changes</button>`); 
    } else if (type === 'line') { 
        const l = (net.lines||[]).find(x => x.id === id); if (!l) return; 
        window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit Line</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><input type="text" class="form-input" placeholder=" " value="${l.type}" disabled><label>Voltage Type (Locked)</label></div><div class="form-row" id="editLinePhaseRow" style="display:${l.type.includes('11')?'block':'none'}"><select id="editLinePhase" class="form-select"><option value="Three Phase" ${l.phase==='Three Phase'?'selected':''}>Three Phase</option><option value="Single Phase" ${l.phase==='Single Phase'?'selected':''}>Single Phase</option></select><label>Phase Type (HT)*</label></div><div class="form-row"><select id="editLineConductor" class="form-select">${l.type.includes('11') ? `<option value="Weasel" ${l.conductor==='Weasel'?'selected':''}>Weasel</option><option value="Rabbit" ${l.conductor==='Rabbit'?'selected':''}>Rabbit</option><option value="Dog" ${l.conductor==='Dog'?'selected':''}>Dog</option><option value="Underground Cable" ${l.conductor==='Underground Cable'?'selected':''}>Underground Cable</option>` : `<option value="Single Phase" ${l.conductor==='Single Phase'?'selected':''}>Single Phase</option><option value="Three Phase" ${l.conductor==='Three Phase'?'selected':''}>Three Phase</option>`}</select><label>Conductor</label></div><button class="btn-action-primary" onclick="window.executeSafeSave(() => window.saveEditedLine('${l.id}'))">Save Changes</button>`); 
    }
}
