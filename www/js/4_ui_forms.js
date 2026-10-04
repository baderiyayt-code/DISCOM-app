/* --- js/4_ui_forms.js --- */

window.openModal = function(html) { 
    document.getElementById('modalSheetContent').innerHTML = html; 
    document.getElementById('formModalOverlay').classList.add('open'); 
    tempPhotoUrl = null; 
}

window.closeModal = function() { 
    document.getElementById('formModalOverlay').classList.remove('open'); 
    isSetupModalOpen = false; 
    const distInd = document.getElementById('live-distance-indicator');
    if(distInd) distInd.style.display='none'; 
    if(appState.user && appState.user.isLoggedIn) { 
        setTimeout(() => {
            if(typeof window.checkOnboardingFlow === 'function') window.checkOnboardingFlow();
        }, 400); 
    } 
}

window.toggleSidebar = function(open) { 
    document.getElementById('sidebar-drawer').classList.toggle('open', open); 
    document.getElementById('sidebarBackdrop').classList.toggle('open', open); 
    if(open) { 
        window.renderGssSidebarList(); 
        window.renderFeederSidebarList(); 
    } 
}

window.toggleGssFolder = function() { 
    const content = document.getElementById('gssFolderContent'), icon = document.getElementById('gssFolderIcon'); 
    if (!content || !icon) return; 
    const isHidden = content.style.display === 'none'; 
    content.style.display = isHidden ? 'block' : 'none'; 
    icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; 
    if (isHidden) window.renderGssSidebarList(); 
};

window.toggleFeederFolder = function() { 
    const content = document.getElementById('feederFolderContent'), icon = document.getElementById('feederFolderIcon'); 
    if (!content || !icon) return; 
    const isHidden = content.style.display === 'none'; 
    content.style.display = isHidden ? 'block' : 'none'; 
    icon.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'; 
    if (isHidden) window.renderFeederSidebarList(); 
};

window.renderGssSidebarList = function() {
    const container = document.getElementById('gssListContainer'); if (!container) return; let html = '';
    Object.values(appState.gssNodes).forEach(gss => { 
        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-glass); padding:8px; border-radius:6px; margin-top:6px; border:1px solid var(--border);"><div><b style="font-size:0.85rem;">${gss.name}</b><br><small style="color:var(--text-sub);">Code: ${gss.code}</small></div><div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="window.relocateGss('${gss.code}')" title="Relocate GSS"><i class="fa-solid fa-location-crosshairs"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="window.deleteGssAndFeederStrict('${gss.code}')" title="Strict Delete"><i class="fa-solid fa-trash"></i></button></div></div>`; 
    }); 
    container.innerHTML = html;
};

window.renderFeederSidebarList = function() {
    const container = document.getElementById('feederListContainer'); if (!container) return; let html = '';
    Object.keys(appState.feeders).forEach(fCode => {
        const f = appState.feeders[fCode].feeder; const isActive = appState.currentFeederCode === fCode;
        const bgClass = isActive ? 'background:rgba(37,99,235,0.1); border-left:4px solid var(--accent);' : 'background:var(--bg-glass); border:1px solid var(--border);';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-radius:6px; margin-top:6px; ${bgClass}" onclick="window.switchFeeder('${fCode}')">
            <div style="cursor:pointer; width: 100%;"><b style="font-size:0.85rem; color:var(--text-main);">${f.name}</b><br><small style="color:var(--text-sub);">GSS: ${f.parentGss}</small></div>
            <div style="display:flex; gap:4px;"><button class="action-btn-sm bg" onclick="event.stopPropagation(); window.openEditFeederModal('${fCode}')"><i class="fa-solid fa-pen"></i></button><button class="action-btn-sm bg" style="color:#ef4444;" onclick="event.stopPropagation(); window.deleteFeederStrict('${fCode}')"><i class="fa-solid fa-trash"></i></button></div>
        </div>`;
    }); 
    container.innerHTML = html;
};

window.openFeederConfigModal = function() {
    window.toggleSidebar(false); 
    const gssOpts = Object.values(appState.gssNodes).map(g => `<option value="${g.code}">${g.name}</option>`).join('');
    window.openModal(`<div class="sheet-head"><div class="sheet-title">Add Feeder</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Select GSS*</label><select id="inpFeederGss" class="form-select">${gssOpts}</select></div><div class="form-row"><label>Feeder Code*</label><input type="text" id="inpFeederCode" class="form-input" placeholder="e.g. F-01"></div><div class="form-row"><label>Feeder Name*</label><input type="text" id="inpFeederName" class="form-input" placeholder="e.g. 11 kV Main Feeder"></div><button class="btn-action-primary" onclick="window.saveNewFeeder()">Save Feeder</button>`);
};

window.saveNewFeeder = function() { 
    try {
        const gss = document.getElementById('inpFeederGss').value; 
        const code = document.getElementById('inpFeederCode').value.trim(); 
        const name = document.getElementById('inpFeederName').value.trim(); 
        
        if(!gss || !code || !name) return alert("All fields are required"); 
        if(!appState.feeders) appState.feeders = {};
        if(appState.feeders[code]) return alert("Feeder code already exists"); 
        
        appState.feeders[code] = { feeder: { name: name, code: code, subdivCode: "SD-01", parentGss: gss }, poles: [], dts: [], lines: [], consumers: [] }; 
        appState.currentFeederCode = code; 
        
        window.closeModal(); 
        if(window.renderEntireNetwork) window.renderEntireNetwork(); 
        if(window.triggerPersistence) window.triggerPersistence(); 
        if(window.showToast) window.showToast("Feeder Added!"); 
    } catch (e) {
        console.error("Feeder Save Error:", e);
        alert("Error saving Feeder: " + e.message);
    }
};

window.openEditFeederModal = function(code) {
    window.toggleSidebar(false); 
    window.openModal(`<div class="sheet-head"><div class="sheet-title">Edit Feeder Name</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>Feeder Code (Locked)</label><input type="text" class="form-input" value="${code}" disabled></div><div class="form-row"><label>New Name*</label><input type="text" id="editFeederName" class="form-input" value="${appState.feeders[code].feeder.name}"></div><button class="btn-action-primary" onclick="window.saveEditedFeeder('${code}')">Save Changes</button>`);
}

window.saveEditedFeeder = function(code) { 
    try {
        const newName = document.getElementById('editFeederName').value.trim(); 
        if(!newName) return alert("Enter new name"); 
        if(appState.feeders[code]) { 
            appState.feeders[code].feeder.name = newName; 
            if(window.triggerPersistence) window.triggerPersistence(); 
            window.closeModal(); 
            if(window.renderEntireNetwork) window.renderEntireNetwork(); 
            if(window.showToast) window.showToast("Feeder Updated!"); 
        } 
    } catch (e) {
        console.error(e);
    }
}

window.deleteFeederStrict = function(code) { 
    try {
        if(!confirm(`WARNING: Deleting Feeder ${code} will destroy all data inside it. Continue?`)) return; 
        if (appState.feeders[code]) { 
            const f = appState.feeders[code]; 
            const ids = [...f.poles, ...f.lines, ...f.dts, ...f.consumers].map(x=>x.id); 
            if(!appState.deletedObjectIds) appState.deletedObjectIds = []; 
            appState.deletedObjectIds.push(...ids); 
            if(!appState.deletedFeederCodes) appState.deletedFeederCodes = []; 
            appState.deletedFeederCodes.push(code); 
        }
        delete appState.feeders[code]; 
        if(appState.currentFeederCode === code) { 
            const remaining = Object.keys(appState.feeders); 
            appState.currentFeederCode = remaining.length > 0 ? remaining[0] : null; 
        } 
        window.closeModal(); 
        if(window.renderEntireNetwork) window.renderEntireNetwork(); 
        if(window.triggerPersistence) window.triggerPersistence(); 
        if(window.showToast) window.showToast("Feeder Deleted!"); 
        if(window.checkOnboardingFlow) window.checkOnboardingFlow(); 
    } catch (e) { console.error(e); }
}

window.deleteGssAndFeederStrict = function(code) { 
    try {
        const conf1 = confirm(`WARNING: You are about to delete GSS ${code} and ALL its associated feeders! This cannot be undone. Continue?`); 
        if (!conf1) return; 
        const conf2 = prompt(`Type GSS code "${code}" to confirm:`); 
        if (conf2 !== code) return alert("Cancelled"); 
        if(window.saveSnapshot) window.saveSnapshot(); 
        if (appState.gssNodes[code]) delete appState.gssNodes[code]; 
        const feedersToDelete = []; 
        Object.keys(appState.feeders).forEach(fCode => { 
            if (appState.feeders[fCode].feeder.parentGss === code) feedersToDelete.push(fCode); 
        }); 
        feedersToDelete.forEach(fCode => window.deleteFeederStrict(fCode)); 
        if(window.renderEntireNetwork) window.renderEntireNetwork(); 
        if(window.triggerPersistence) window.triggerPersistence(); 
        window.renderGssSidebarList(); 
        if(window.showToast) window.showToast("Deleted completely!"); 
        if(window.checkOnboardingFlow) window.checkOnboardingFlow(); 
    } catch (e) { console.error(e); }
}

window.openAddGssModal = function() { 
    window.toggleSidebar(false); 
    window.openModal(`<div class="sheet-head"><div class="sheet-title"><i class="fa-solid fa-plus-circle"></i> Add New GSS</div><button class="sheet-close-btn" onclick="window.closeModal()"><i class="fa-solid fa-xmark"></i></button></div><div class="form-row"><label>GSS Code*</label><input type="text" id="inpGssCode" class="form-input" placeholder="e.g. 132"></div><div class="form-row"><label>GSS Name*</label><input type="text" id="inpGssName" class="form-input" placeholder="e.g. 132/33 kV Substation"></div><button class="btn-action-primary" onclick="window.saveNewGss()">Save GSS at Map Center</button>`); 
};

// FULLY ROBUST GSS SAVE FUNCTION WITH GLOBAL SCOPE HANDLING
window.saveNewGss = function() { 
    try {
        const code = document.getElementById('inpGssCode').value.trim();
        const name = document.getElementById('inpGssName').value.trim(); 
        
        if (!code || !name) return alert("Enter GSS Code and Name"); 
        if (!appState.gssNodes) appState.gssNodes = {};
        if (appState.gssNodes[code]) return alert("GSS Code already exists!"); 
        
        let centerLat = 26.9150;
        let centerLng = 75.7830;
        
        // Safe check for map before getting center
        if(typeof map !== 'undefined' && map) {
            const center = map.getCenter();
            centerLat = parseFloat(center.lat.toFixed(6));
            centerLng = parseFloat(center.lng.toFixed(6));
        }

        appState.gssNodes[code] = { 
            code: code, 
            name: name, 
            lat: centerLat, 
            lng: centerLng 
        }; 
        
        window.closeModal(); 
        if(typeof window.renderEntireNetwork === 'function') window.renderEntireNetwork(); 
        if(typeof window.triggerPersistence === 'function') window.triggerPersistence(); 
        if(typeof window.showToast === 'function') window.showToast("New GSS added successfully!"); 
        if(typeof window.checkOnboardingFlow === 'function') window.checkOnboardingFlow(); 
        
    } catch(e) {
        console.error("GSS Save Error:", e);
        alert("GSS Save Error: " + e.message);
    }
};

window.relocateGss = function(gssCode) { 
    if(window.closeObjectSheet) window.closeObjectSheet(); 
    window.toggleSidebar(false); 
    if(window.startObjectMove) window.startObjectMove('GSS', gssCode, `GSS (${gssCode})`); 
};

window.updateOrphanStatus = function() {
    if(!appState.orphanPoleIds) appState.orphanPoleIds = new Set();
    appState.orphanPoleIds.clear(); 
    const net = window.getActiveNetwork(); if(!net) return; 
    const adj = {}, gssCode = net.feeder.parentGss, gssId = 'GSS_' + gssCode; adj[gssId] = [];
    net.poles.forEach(p => adj['POLE_' + p.poleNo] = []); net.dts.forEach(d => adj['DT_' + d.code] = []);
    net.dts.forEach(d => { if(d.parentPole) { const pId = 'POLE_' + d.parentPole; if (!adj[pId]) adj[pId] = []; adj[pId].push('DT_' + d.code); adj['DT_' + d.code].push(pId); } });
    net.lines.forEach(l => { const u = String(l.fromNode), v = String(l.toNode); if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
    const visited = new Set([gssId]), queue = [gssId];
    while (queue.length > 0) { const curr = queue.shift(); (adj[curr] || []).forEach(neighbor => { if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } }); }
    net.poles.forEach(p => { if (!visited.has('POLE_' + p.poleNo)) appState.orphanPoleIds.add(p.id); }); 
    net.dts.forEach(d => { if (!visited.has('DT_' + d.code)) appState.orphanPoleIds.add(d.id); });
}

window.toggleSearchBox = function() {
    let box = document.getElementById('searchBoxOverlay');
    if(!box) { 
        box = document.createElement('div'); box.id = 'searchBoxOverlay'; 
        box.style.cssText = 'position:absolute; top:65px; left:12px; right:12px; z-index:9000; background:var(--bg-glass); backdrop-filter:blur(10px); padding:10px; border-radius:12px; box-shadow:var(--shadow-md); display:flex; flex-direction:column; gap:10px; border:1px solid var(--border);'; 
        box.innerHTML = `<div style="display:flex; gap:10px; align-items:center;"><input type="text" id="appSearchBar" class="search-input-full" placeholder="Search Consumer, DT, Pole..." onkeyup="window.handleSearch(event)"><button class="action-btn-sm" onclick="window.toggleSearchBox()"><i class="fa-solid fa-times"></i></button></div><div id="searchSuggestions" class="suggestions-panel" style="position:relative; box-shadow:none; border:none; top:0;"></div>`; 
        document.getElementById('app-container').appendChild(box); 
    } else { 
        box.style.display = box.style.display === 'none' ? 'flex' : 'none'; 
        if(box.style.display === 'none') window.clearSearch(); 
    }
    if(box.style.display === 'flex') { 
        document.getElementById('appSearchBar').focus(); 
        if(window.applyTranslations) window.applyTranslations(); 
    }
}

window.handleSearch = function(e) {
    const query = e.target.value.toLowerCase().trim(), suggPanel = document.getElementById('searchSuggestions'); 
    if(query.length === 0) { suggPanel.classList.remove('active'); return; } 
    const net = window.getActiveNetwork(); if(!net) return; let results = [];
    net.consumers.forEach(c => { if (String(c.kno).toLowerCase().includes(query) || (c.name && c.name.toLowerCase().includes(query))) results.push({ type: 'CONSUMER', id: c.id, title: c.name, desc: `K-No: ${c.kno} | Connected to: ${c.parentRef}` }); }); 
    net.dts.forEach(d => { if (String(d.code).toLowerCase().includes(query) || String(d.rating).includes(query) || (d.location && d.location.toLowerCase().includes(query))) results.push({ type: 'DT', id: d.id, title: `DT Code: ${d.code}`, desc: `Rating: ${d.rating} kVA | Loc: ${d.location || 'N/A'}` }); }); 
    net.poles.forEach(p => { if (String(p.poleNo).toLowerCase().includes(query)) results.push({ type: 'POLE', id: p.id, title: `Pole: ${p.poleNo}`, desc: `Type: ${p.lineType} | ${p.poleType}` }); });
    if (results.length > 0) { 
        suggPanel.innerHTML = results.slice(0, 15).map(r => `<div class="suggestion-item" onclick="window.selectSearchResult('${r.type}', '${r.id}')"><div class="sugg-title"><span style="color:var(--accent); font-weight:800;">${r.title}</span></div><div class="sugg-desc" style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">${r.desc}</div></div>`).join(''); 
        suggPanel.classList.add('active'); 
    } else { 
        suggPanel.innerHTML = `<div style="padding:10px 12px; font-size:0.8rem; color:#64748b;">No results found</div>`; 
        suggPanel.classList.add('active'); 
    }
}

window.clearSearch = function() { 
    const bar = document.getElementById('appSearchBar'); if(bar) bar.value = ''; 
    const sugg = document.getElementById('searchSuggestions'); if(sugg) sugg.classList.remove('active'); 
}

window.selectSearchResult = function(type, id) { 
    const net = window.getActiveNetwork(); if(!net) return; 
    window.clearSearch(); window.toggleSearchBox(); 
    let target = null, popupHtml = ''; 
    if(type === 'CONSUMER') { target = net.consumers.find(c => c.id === id); if(target) popupHtml = `K-No: <b>${target.kno}</b><br>Connected to: <b>${target.parentRef}</b>`; } 
    else if(type === 'DT') { target = net.dts.find(d => d.id === id); if(target) popupHtml = `Rating: <b>${target.rating} kVA</b><br>Loc: <b>${target.location || 'N/A'}</b>`; } 
    else if(type === 'POLE') { target = net.poles.find(p => p.id === id); if(target) popupHtml = `Type: <b>${target.lineType}</b><br>Condition: <b>${target.condition || 'Good'}</b>`; } 
    if(target && target.lat) { 
        if(map) map.flyTo([target.lat, target.lng], 19, { duration: 1 }); 
        setTimeout(() => { 
            if(window.openObjectSheet) window.openObjectSheet(type, id, type === 'CONSUMER' ? target.name : (type === 'DT' ? `DT: ${target.code}` : `Pole: ${target.poleNo}`), popupHtml); 
        }, 1000); 
    } 
}
