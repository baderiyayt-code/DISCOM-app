/* --- js/4_ui_forms.js --- */
/* --- Professional UI Update: Consistent Buttons, Improved DT Layout --- */

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
    
    const imgEl = document.getElementById('objPhotoImg'); 
    const placeholderEl = document.getElementById('objPhotoPlaceholder');
    
    const applyPhoto = (url) => {
        if(url) { 
            imgEl.src = url; 
            imgEl.style.display = 'block'; 
            placeholderEl.style.display = 'none'; 
        } else { 
            imgEl.style.display = 'none'; 
            imgEl.src = ''; 
            placeholderEl.style.display = 'flex'; 
        }
    };

    const photoUrl = window.getPhotoUrl ? window.getPhotoUrl(id) : null;
    if(photoUrl instanceof Promise) { 
        applyPhoto(null); 
        photoUrl.then(applyPhoto); 
    } else { 
        applyPhoto(photoUrl); 
    }
    
    document.getElementById('object-bottom-sheet').classList.add('open'); 
    
    // --- PROFESSIONAL BUTTON HANDLERS ---
    const btnEdit = document.getElementById('btnObjEdit');
    const btnDelete = document.getElementById('btnObjDelete');
    const btnMove = document.getElementById('btnObjMove');

    if(btnEdit) {
        btnEdit.style.display = 'block';
        btnEdit.innerText = "Edit " + type.toUpperCase(); // Consistent text
        btnEdit.onclick = () => window.openEditModal(type.toLowerCase(), id);
    }

    if(btnDelete) {
        btnDelete.style.display = (type === 'GSS') ? 'none' : 'block'; 
        btnDelete.innerText = "Delete " + type.toUpperCase(); // Consistent text
        btnDelete.onclick = () => { 
            if(window.deleteEntity) window.deleteEntity(type.toLowerCase(), id); 
            window.closeObjectSheet(); 
        };
    }

    if(btnMove) {
        btnMove.style.display = (type === 'GSS' || type === 'DT') ? 'none' : 'block'; 
        btnMove.innerText = "Move " + type.toUpperCase(); // Consistent text
        btnMove.onclick = () => { 
            if(window.startObjectMove) window.startObjectMove(type, id, title); 
        };
    }
};

// ==========================================
// DT DETAIL MODAL: PROFESSIONALIZED & CONSISTENT
// ==========================================
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
            if(pole && String(pole.dtCode) === String(d.code)) { isConnected = true;
