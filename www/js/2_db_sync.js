window.toggleAuthMode = function() { 
    authMode = authMode === 'login' ? 'signup' : 'login'; 
    document.getElementById('loginBtn').style.display = authMode === 'login' ? 'inline-block' : 'none'; 
    document.getElementById('signupBtn').style.display = authMode === 'signup' ? 'inline-block' : 'none'; 
    document.getElementById('authName').style.display = authMode === 'signup' ? 'block' : 'none'; 
    document.getElementById('authToggleText').innerText = authMode === 'login' ? "Need an account? Sign Up" : "Already have an account? Login"; 
}

window.applyAuthUIVisuals = function() { 
    document.getElementById('auth-screen').style.display = 'none'; 
    document.getElementById('app-container').style.display = 'flex'; 
    setTimeout(() => { if(map) map.invalidateSize(); }, 100); 
    const uName = document.getElementById('userNameDisplay');
    if(uName) uName.innerText = appState.user.name || 'Admin User'; 
}

window.handleSupabaseAuth = async function(mode) {
    if(!supabaseClient) return alert("Network/Supabase Error. Supabase initialize nahi hua hai.");
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const name = document.getElementById('authName').value.trim();
    
    if(!email || !password) return alert("Email aur Password bharna zaroori hai!"); 
    window.showToast("Processing..."); 
    
    try {
        let response;
        if (mode === 'signup') { 
            if(!name) return alert("Sign Up ke liye Full Name zaroori hai!"); 
            response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } }); 
            if(response.error) { alert("Signup Error: " + response.error.message); } 
            else { alert("Account Created Successfully! Ab aap Login kar sakte hain."); window.toggleAuthMode(); }
        } else { 
            response = await supabaseClient.auth.signInWithPassword({ email, password }); 
            if (response.error) { alert("Login Error: " + response.error.message); } 
            else if (response.data.user) { 
                appState.user.isLoggedIn = true; 
                appState.user.email = response.data.user.email; 
                appState.user.id = response.data.user.id; 
                appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0]; 
                window.applyAuthUIVisuals(); 
                await window.pullFromSupabase(); 
                window.showToast("Login Successful!"); 
            }
        }
    } catch(err) { console.error("Auth Exception:", err); alert("Connection error: " + err.message); }
}

window.handleSupabaseLogout = async function() { if(supabaseClient) await supabaseClient.auth.signOut(); if(typeof localforage !== 'undefined') await localforage.clear(); localStorage.clear(); location.reload(); }

window.setSyncStatus = function(status) { 
    const ind = document.getElementById('sync-indicator'); if(!ind) return;
    if(!navigator.onLine) status = 'offline'; 
    if(status === 'syncing') ind.innerHTML = '<i class="fa-solid fa-cloud-arrow-up sync-active"></i>'; 
    else if(status === 'synced') ind.innerHTML = '<i class="fa-solid fa-cloud-check sync-success"></i>'; 
    else ind.innerHTML = '<i class="fa-solid fa-cloud-xmark sync-error"></i>'; 
}

window.updateUnsyncedBadge = function() {
    let unsyncCount = 0; if(appState.photos) unsyncCount += appState.photos.filter(p => !p.synced).length;
    for(let fCode in appState.feeders) { let f = appState.feeders[fCode]; if(f.poles) unsyncCount += f.poles.filter(p => !p.synced).length; if(f.lines) unsyncCount += f.lines.filter(l => !l.synced).length; if(f.dts) unsyncCount += f.dts.filter(d => !d.synced).length; if(f.consumers) unsyncCount += f.consumers.filter(c => !c.synced).length; }
    let badge = document.getElementById('unsync-badge'); const syncBtn = document.getElementById('sync-indicator');
    if(!badge && syncBtn) { badge = document.createElement('div'); badge.id = 'unsync-badge'; badge.style.cssText = 'position:absolute; top:-5px; right:-5px; background:#ef4444; color:white; font-size:10px; font-weight:900; padding:2px 6px; border-radius:10px; border:2px solid white; z-index:10; pointer-events:none;'; syncBtn.style.position = 'relative'; syncBtn.appendChild(badge); }
    if(badge) { badge.innerText = unsyncCount; badge.style.display = unsyncCount > 0 ? 'block' : 'none'; }
}

window.syncToSupabase = async function() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; window.setSyncStatus('syncing');
    try {
        if (appState.deletedObjectIds && appState.deletedObjectIds.length > 0) { await supabaseClient.from('object_photos').delete().in('object_id', appState.deletedObjectIds); await supabaseClient.from('survey_objects').delete().in('id', appState.deletedObjectIds); appState.deletedObjectIds = []; }
        if (appState.deletedFeederCodes && appState.deletedFeederCodes.length > 0) { await supabaseClient.from('feeders').delete().in('code', appState.deletedFeederCodes); appState.deletedFeederCodes = []; }
        const metaData = { settings: appState.settings, filters: appState.filters, currentFeederCode: appState.currentFeederCode, gssNodes: appState.gssNodes };
        const { error: metaErr } = await supabaseClient.from('survey_data').upsert({ user_id: appState.user.id, data: metaData, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); if(metaErr) throw metaErr;
        let feedersPayload = []; let objectsPayload = [];
        for (let fCode in appState.feeders) {
            let f = appState.feeders[fCode]; let gCode = f.feeder.parentGss || 'UNKNOWN'; feedersPayload.push({ code: fCode, user_id: appState.user.id, gss_code: gCode, name: f.feeder.name, details: f.feeder });
            f.poles.filter(p=>!p.synced).forEach(p => objectsPayload.push({ id: p.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'POLE', details: p }));
            f.dts.filter(d=>!d.synced).forEach(d => objectsPayload.push({ id: d.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'DT', details: d }));
            f.lines.filter(l=>!l.synced).forEach(l => objectsPayload.push({ id: l.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'LINE', details: l }));
            f.consumers.filter(c=>!c.synced).forEach(c => objectsPayload.push({ id: c.id, user_id: appState.user.id, gss_code: gCode, feeder_code: fCode, object_type: 'CONSUMER', details: c }));
        }
        if (feedersPayload.length > 0) await supabaseClient.from('feeders').upsert(feedersPayload, { onConflict: 'code' });
        if (objectsPayload.length > 0) {
            for (let i = 0; i < objectsPayload.length; i += 200) await supabaseClient.from('survey_objects').upsert(objectsPayload.slice(i, i + 200), { onConflict: 'id' });
            for (let fCode in appState.feeders) { appState.feeders[fCode].poles.forEach(p => p.synced = true); appState.feeders[fCode].dts.forEach(d => d.synced = true); appState.feeders[fCode].lines.forEach(l => l.synced = true); appState.feeders[fCode].consumers.forEach(c => c.synced = true); }
        }
        if (appState.photos && appState.photos.length > 0) {
            const unsyncedPhotos = appState.photos.filter(p => !p.synced);
            if (unsyncedPhotos.length > 0) {
                const photoPayload = unsyncedPhotos.map(p => ({ id: p.id, user_id: appState.user.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url }));
                for(let i=0; i<photoPayload.length; i+=5) await supabaseClient.from('object_photos').upsert(photoPayload.slice(i, i+5), { onConflict: 'id' });
                unsyncedPhotos.forEach(p => p.synced = true); 
            }
        }
        if(typeof localforage !== 'undefined') localforage.setItem(DB_KEY, appState); window.setSyncStatus('synced'); window.updateUnsyncedBadge();
    } catch (err) { console.warn("Sync error", err); window.setSyncStatus('offline'); window.updateUnsyncedBadge(); }
}

window.pullFromSupabase = async function() {
    if (!supabaseClient || !appState.user.isLoggedIn || !appState.user.id) return; window.setSyncStatus('syncing');
    try {
        const { data: metaData } = await supabaseClient.from('survey_data').select('data').eq('user_id', appState.user.id);
        if(metaData && metaData.length > 0) { const cd = metaData[0].data; appState.gssNodes = cd.gssNodes || {}; appState.settings = { ...appState.settings, ...(cd.settings || {}) }; appState.filters = cd.filters || appState.filters; appState.currentFeederCode = cd.currentFeederCode || null; }
        const { data: feedersData } = await supabaseClient.from('feeders').select('*').eq('user_id', appState.user.id); appState.feeders = {};
        if(feedersData) { feedersData.forEach(f => { appState.feeders[f.code] = { feeder: f.details, poles: [], dts: [], lines: [], consumers: [] }; }); }
        const { data: objData } = await supabaseClient.from('survey_objects').select('*').eq('user_id', appState.user.id);
        if(objData) { objData.forEach(row => { const fCode = row.feeder_code; if(appState.feeders[fCode]) { row.details.synced = true; if(row.object_type === 'POLE') appState.feeders[fCode].poles.push(row.details); if(row.object_type === 'DT') appState.feeders[fCode].dts.push(row.details); if(row.object_type === 'LINE') appState.feeders[fCode].lines.push(row.details); if(row.object_type === 'CONSUMER') appState.feeders[fCode].consumers.push(row.details); } }); }
        const { data: photoData } = await supabaseClient.from('object_photos').select('id, object_type, object_id, photo_url').eq('user_id', appState.user.id);
        if(photoData) { appState.photos = photoData.map(p => ({ id: p.id, object_type: p.object_type, object_id: p.object_id, photo_url: p.photo_url, synced: true })); } else appState.photos = [];
        if(typeof localforage !== 'undefined') await localforage.setItem(DB_KEY, appState); 
        window.applyTranslations(); window.applyTheme(); if(map) map.invalidateSize(); window.renderEntireNetwork(); window.updateFeederDropdown(); window.setSyncStatus('synced'); window.centerMapOnGSS(); window.checkOnboardingFlow(); window.updateUnsyncedBadge();
    } catch (err) { console.error("Sync error:", err); window.setSyncStatus('offline'); if(map) map.invalidateSize(); window.checkOnboardingFlow(); window.updateUnsyncedBadge(); }
}

window.triggerPersistence = function() { 
    try { if(typeof localforage !== 'undefined') { localforage.setItem(DB_KEY, appState).catch((err) => console.log("LocalForage Error:", err)); } else { localStorage.setItem(DB_KEY, JSON.stringify(appState)); } window.updateUnsyncedBadge(); if(appState.settings && appState.settings.liveSync) { window.syncToSupabase(); } } catch(err) { console.error("Persistence Error:", err); }
}

window.checkOnboardingFlow = function() {
    if(isSetupModalOpen) return;
    if(Object.keys(appState.gssNodes || {}).length === 0) { document.getElementById('onboarding-overlay').style.display = 'flex'; document.getElementById('onboarding-title').innerText = "Network Setup Required"; document.getElementById('onboarding-desc').innerText = "Please add your first GSS to begin mapping."; document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; isSetupModalOpen = true; window.openAddGssModal(); }; } 
    else if (Object.keys(appState.feeders || {}).length === 0) { document.getElementById('onboarding-overlay').style.display = 'flex'; document.getElementById('onboarding-title').innerText = "Create Feeder"; document.getElementById('onboarding-desc').innerText = "You must create a Feeder linked to your GSS to continue."; document.getElementById('onboarding-btn').onclick = function() { document.getElementById('onboarding-overlay').style.display = 'none'; isSetupModalOpen = true; window.openFeederConfigModal(); }; } 
    else { document.getElementById('onboarding-overlay').style.display = 'none'; window.renderEntireNetwork(); }
};
