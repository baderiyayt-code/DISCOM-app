/* --- js/2_db_sync.js --- */

window.initPersistence = async function() {
    try {
        await localforage.ready();
        const savedState = await localforage.getItem('discom_app_state');
        if (savedState) {
            appState = savedState;
            if(!appState.feeders) appState.feeders = {};
            if(!appState.gssNodes) appState.gssNodes = {};
            if(!appState.settings) appState.settings = { unit: 'm', language: 'en', theme: 'light', liveSync: true };
            if(!appState.filters) appState.filters = { lines11: true, linesLT: true, poles: true, dts: true, consumers: true };
            if(!appState.lastModified) appState.lastModified = 0;
            if(!appState.photos) appState.photos = {};
        } else {
            appState = { user: { isLoggedIn: false, email: '', name: '' }, currentFeederCode: null, gssNodes: {}, feeders: {}, filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true }, settings: { unit: 'm', language: 'en', theme: 'light', liveSync: true }, lastModified: 0, photos: {} };
        }
        window.deduplicateNetworkData();
    } catch (err) { console.error("LocalForage Init Error:", err); }
};

window.deduplicateNetworkData = function() {
    if(!appState || !appState.feeders) return;
    Object.keys(appState.feeders).forEach(fCode => {
        const net = appState.feeders[fCode];
        if(!net.dts) net.dts = []; if(!net.poles) net.poles = []; if(!net.lines) net.lines = []; if(!net.consumers) net.consumers = [];

        const uniqueDTs = new Map(); net.dts.forEach(d => { if(d && d.code) uniqueDTs.set(String(d.code).trim(), d); }); net.dts = Array.from(uniqueDTs.values());
        const uniquePoles = new Map(); net.poles.forEach(p => { if(p && p.poleNo) uniquePoles.set(String(p.poleNo).trim(), p); }); net.poles = Array.from(uniquePoles.values());
        const uniqueCons = new Map(); net.consumers.forEach(c => { if(c && c.kno) uniqueCons.set(String(c.kno).trim(), c); }); net.consumers = Array.from(uniqueCons.values());
        const uniqueLines = new Map(); net.lines.forEach(l => { if(l && l.fromNode && l.toNode) uniqueLines.set(`${l.fromNode}_${l.toNode}_${l.type}`, l); }); net.lines = Array.from(uniqueLines.values());
    });
};

window.triggerPersistence = async function() {
    try {
        appState.lastModified = Date.now(); 
        window.deduplicateNetworkData(); 
        await localforage.setItem('discom_app_state', appState);
        if (appState.user && appState.user.isLoggedIn && appState.settings && appState.settings.liveSync !== false) {
            window.syncToSupabase(true);
        }
    } catch (err) { console.error("Persistence Error:", err); }
};

window.getActiveNetwork = function() {
    if (!appState || !appState.feeders) return null;
    if (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) { const keys = Object.keys(appState.feeders); if (keys.length > 0) appState.currentFeederCode = keys[0]; else return null; }
    return appState.feeders[appState.currentFeederCode];
};

let isSyncing = false;
window.syncToSupabase = async function(isSilent = false) {
    if (!appState || !appState.user || !appState.user.isLoggedIn) { if (!isSilent) alert("Please log in first to sync!"); return; }
    if (isSyncing) return; isSyncing = false; 

    const indicator = document.getElementById('sync-indicator'); if (indicator) indicator.classList.add('fa-spin');
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            appState.lastModified = Date.now();
            const stateToSync = JSON.parse(JSON.stringify(appState));
            delete stateToSync.photos; 

            const { error } = await supabaseClient.from('discom_surveys').upsert({ user_email: appState.user.email, state_data: stateToSync, updated_at: new Date() }, { onConflict: 'user_email' });
            if (error) throw error;
        }
        if (!isSilent && window.showToast) window.showToast("Cloud Sync Successful! ☁️");
    } catch (err) {
        console.error("Cloud Sync Error:", err);
        if (!isSilent && window.showToast) window.showToast("Sync offline / saved locally");
    } finally { if (indicator) indicator.classList.remove('fa-spin'); }
};

// Background Photo Sync & Pull Function
window.syncPhotosToCloud = async function(objectId, base64Url, objectType = 'OBJECT') {
    if(!appState || !appState.user || !appState.user.isLoggedIn) return;
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            const userId = appState.user.email;
            await supabaseClient.from('object_photos').upsert({
                id: objectId,
                user_id: userId,
                object_type: objectType,
                object_id: objectId,
                photo_url: base64Url
            }, { onConflict: 'id' });
        }
    } catch(e) { console.error("Photo background sync error:", e); }
};

window.pullPhotosFromCloud = async function(userId) {
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            const { data, error } = await supabaseClient.from('object_photos').select('*').eq('user_id', userId);
            if(!error && data) {
                if(!appState.photos) appState.photos = {};
                data.forEach(row => {
                    if(row.object_id && row.photo_url) {
                        appState.photos[row.object_id] = row.photo_url;
                    }
                });
                await localforage.setItem('discom_app_state', appState);
            }
        }
    } catch(e) { console.error("Pull photos error:", e); }
};

window.deletePhotoFromCloud = async function(objectId) {
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            await supabaseClient.from('object_photos').delete().eq('id', objectId);
        }
    } catch(e) { console.error("Delete photo cloud error:", e); }
};

window.handleSupabaseAuth = async function(mode) {
    const email = document.getElementById('authEmail').value.trim(), password = document.getElementById('authPassword').value.trim(), name = document.getElementById('authName') ? document.getElementById('authName').value.trim() : 'Surveyor';
    if(!email || !password) return alert("Email and Password required!");
    const loader = document.getElementById('erection-loader'), spinner = document.getElementById('appLoaderSpinner');
    if(loader) loader.style.display = 'flex'; if(spinner) spinner.style.display = 'block';

    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            if (mode === 'signup') {
                const { error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
                if (error) throw error; alert("Account created! You can now login."); toggleAuthMode();
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password }); 
                if (error) throw error;
                
                const { data: cloudData } = await supabaseClient.from('discom_surveys').select('state_data, updated_at').eq('user_email', email).single();
                
                if (cloudData && cloudData.state_data) {
                    const cState = cloudData.state_data;
                    const localTime = appState.lastModified || 0;
                    const cloudTime = cState.lastModified || new Date(cloudData.updated_at).getTime() || 0;

                    if (cloudTime >= localTime) {
                        const localPhotos = appState.photos || {}; 
                        appState = cState;
                        appState.photos = localPhotos; 
                    } 
                }

                if(!appState.feeders) appState.feeders = {};
                if(!appState.gssNodes) appState.gssNodes = {};

                appState.user = { isLoggedIn: true, email: email, name: data.user.user_metadata?.full_name || name };
                
                // Pull photos associated with this user from Supabase object_photos table
                await window.pullPhotosFromCloud(email);

                await window.triggerPersistence();
                if(loader) loader.style.display = 'none'; document.getElementById('auth-screen').style.display = 'none';
                if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.showToast) window.showToast("Logged in successfully!");
                if(window.checkOnboardingFlow) window.checkOnboardingFlow();
            }
        } else {
            appState.user = { isLoggedIn: true, email: email, name: name }; await window.triggerPersistence();
            if(loader) loader.style.display = 'none'; document.getElementById('auth-screen').style.display = 'none';
            if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.showToast) window.showToast("Offline Logged In!");
            if(window.checkOnboardingFlow) window.checkOnboardingFlow();
        }
    } catch(err) { alert("Error: " + err.message); if(loader) loader.style.display = 'none'; } finally { if(spinner) spinner.style.display = 'none'; }
};

window.handleSupabaseLogout = async function() {
    if(confirm("Logout and clear local data?")) {
        try { if (typeof supabaseClient !== 'undefined' && supabaseClient) await supabaseClient.auth.signOut(); } catch(e) {}
        appState.user = { isLoggedIn: false, email: '', name: '' }; await localforage.removeItem('discom_app_state'); window.location.reload();
    }
};

window.checkOnboardingFlow = function() {
    const overlay = document.getElementById('onboarding-overlay'); if(!overlay) return;
    if (Object.keys(appState.gssNodes || {}).length === 0) { document.getElementById('onboarding-title').innerText = "Add Your First GSS"; document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openAddGssModal(); }; overlay.style.display = 'flex'; } 
    else if (Object.keys(appState.feeders || {}).length === 0) { document.getElementById('onboarding-title').innerText = "Create Your First Feeder"; document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openFeederConfigModal(); }; overlay.style.display = 'flex'; } 
    else { overlay.style.display = 'none'; }
};
