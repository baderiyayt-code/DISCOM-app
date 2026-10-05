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
    if (isSyncing) return; isSyncing = true; 

    const indicator = document.getElementById('sync-indicator'); if (indicator) indicator.classList.add('fa-spin');
    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            appState.lastModified = Date.now();
            const userEmail = appState.user.email;
            
            // 1. Sync Main Survey State Data
            const stateToSync = JSON.parse(JSON.stringify(appState));
            delete stateToSync.photos; // Photos ko alag table me sync karenge

            const { error: surveyErr } = await supabaseClient.from('discom_surveys').upsert({ user_email: userEmail, state_data: stateToSync, updated_at: new Date() }, { onConflict: 'user_email' });
            if (surveyErr) throw surveyErr;

            // 2. Background Sync Photos to object_photos table
            if(appState.photos) {
                for (const [objId, base64Val] of Object.entries(appState.photos)) {
                    if(base64Val) {
                        await supabaseClient.from('object_photos').upsert({
                            user_email: userEmail,
                            object_id: objId,
                            photo_data: base64Val
                        }, { onConflict: 'user_email,object_id' });
                    }
                }
            }

            // 3. Handle Deleted Object Photos Cleanup
            if(appState.deletedObjectIds && appState.deletedObjectIds.length > 0) {
                for(const delId of appState.deletedObjectIds) {
                    await supabaseClient.from('object_photos').delete().eq('user_email', userEmail).eq('object_id', delId);
                }
                appState.deletedObjectIds = []; // clear queue
            }
        }
        if (!isSilent && window.showToast) window.showToast("Cloud & Photos Sync Successful! ☁️");
    } catch (err) {
        console.error("Cloud Sync Error:", err);
        if (!isSilent && window.showToast) window.showToast("Sync offline / saved locally");
    } finally { 
        isSyncing = false;
        if (indicator) indicator.classList.remove('fa-spin'); 
    }
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
                
                // Fetch Survey Data
                const { data: cloudData } = await supabaseClient.from('discom_surveys').select('state_data, updated_at').eq('user_email', email).single();
                
                if (cloudData && cloudData.state_data) {
                    const cState = cloudData.state_data;
                    const localTime = appState.lastModified || 0;
                    const cloudTime = cState.lastModified || new Date(cloudData.updated_at).getTime() || 0;

                    if (cloudTime >= localTime) {
                        appState = cState;
                    } 
                }

                // Fetch Photos from object_photos table for this user
                const { data: cloudPhotos } = await supabaseClient.from('object_photos').select('object_id, photo_data').eq('user_email', email);
                if(cloudPhotos && Array.isArray(cloudPhotos)) {
                    if(!appState.photos) appState.photos = {};
                    cloudPhotos.forEach(p => {
                        if(p.object_id && p.photo_data) {
                            appState.photos[p.object_id] = p.photo_data;
                        }
                    });
                }

                if(!appState.feeders) appState.feeders = {};
                if(!appState.gssNodes) appState.gssNodes = {};

                appState.user = { isLoggedIn: true, email: email, name: data.user.user_metadata?.full_name || name };
                
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
    } catch(err) { 
        console.error("Auth Error:", err);
        alert("Login successful / Offline mode active");
        if(loader) loader.style.display = 'none';
        document.getElementById('auth-screen').style.display = 'none';
        if(window.renderEntireNetwork) window.renderEntireNetwork();
    } finally { if(spinner) spinner.style.display = 'none'; }
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
