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
        } else {
            appState = { user: { isLoggedIn: false, email: '', name: '' }, currentFeederCode: null, gssNodes: {}, feeders: {}, filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true }, settings: { unit: 'm', language: 'en', theme: 'light', liveSync: true } };
        }
        
        // APP LOAD HOTE HI SAARE DUPLICATES CLEAN KAREGA
        window.deduplicateNetworkData();

    } catch (err) { console.error("LocalForage Init Error:", err); }
};

// --- STRICT AUTO-CLEANER (Destroys Duplicates) ---
window.deduplicateNetworkData = function() {
    if(!appState || !appState.feeders) return;
    
    Object.keys(appState.feeders).forEach(fCode => {
        const net = appState.feeders[fCode];
        
        if(net.dts) {
            const unique = []; const seen = new Set();
            net.dts.forEach(d => { const code = String(d.code).trim(); if(!seen.has(code)) { seen.add(code); unique.push(d); } });
            net.dts = unique;
        }
        if(net.poles) {
            const unique = []; const seen = new Set();
            net.poles.forEach(p => { const pno = String(p.poleNo).trim(); if(!seen.has(pno)) { seen.add(pno); unique.push(p); } });
            net.poles = unique;
        }
        if(net.consumers) {
            const unique = []; const seen = new Set();
            net.consumers.forEach(c => { const kno = String(c.kno).trim(); if(!seen.has(kno)) { seen.add(kno); unique.push(c); } });
            net.consumers = unique;
        }
        if(net.lines) {
            const unique = []; const seen = new Set();
            net.lines.forEach(l => { const key = `${l.fromNode}_${l.toNode}_${l.type}`; if(!seen.has(key)) { seen.add(key); unique.push(l); } });
            net.lines = unique;
        }
    });
};

window.triggerPersistence = async function() {
    try {
        window.deduplicateNetworkData(); // Save karne se pehle bhi clean karega
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
            const { error } = await supabaseClient.from('discom_surveys').upsert({ user_email: appState.user.email, state_data: appState, updated_at: new Date() }, { onConflict: 'user_email' });
            if (error) throw error;
        }
        if (!isSilent && window.showToast) window.showToast("Cloud Sync Successful! ☁️");
    } catch (err) {
        console.error("Cloud Sync Error:", err);
        if (!isSilent && window.showToast) window.showToast("Sync offline / saved locally");
    } finally { if (indicator) indicator.classList.remove('fa-spin'); }
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
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password }); if (error) throw error;
                appState.user = { isLoggedIn: true, email: email, name: data.user.user_metadata?.full_name || name };
                const { data: cloudData } = await supabaseClient.from('discom_surveys').select('state_data').eq('user_email', email).single();
                
                // DATA MERGE LOGIC (Online aur Offline data jode ga, delete nahi karega)
                if (cloudData && cloudData.state_data) {
                    const cState = cloudData.state_data;
                    if(!appState.feeders) appState.feeders = {};
                    Object.keys(cState.feeders || {}).forEach(k => {
                        if(!appState.feeders[k]) appState.feeders[k] = cState.feeders[k];
                        else {
                            appState.feeders[k].poles.push(...cState.feeders[k].poles);
                            appState.feeders[k].dts.push(...cState.feeders[k].dts);
                            appState.feeders[k].consumers.push(...cState.feeders[k].consumers);
                            appState.feeders[k].lines.push(...cState.feeders[k].lines);
                        }
                    });
                    appState.gssNodes = { ...cState.gssNodes, ...appState.gssNodes };
                }
                
                await window.triggerPersistence();
                if(loader) loader.style.display = 'none'; document.getElementById('auth-screen').style.display = 'none';
                if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.showToast) window.showToast("Logged in successfully!");
            }
        } else {
            appState.user = { isLoggedIn: true, email: email, name: name }; await window.triggerPersistence();
            if(loader) loader.style.display = 'none'; document.getElementById('auth-screen').style.display = 'none';
            if(window.renderEntireNetwork) window.renderEntireNetwork(); if(window.showToast) window.showToast("Offline Logged In!");
        }
    } catch(err) { alert("Auth failed: " + err.message); if(loader) loader.style.display = 'none'; } finally { if(spinner) spinner.style.display = 'none'; }
};

window.handleSupabaseLogout = async function() {
    if(confirm("Logout and clear local data?")) {
        try { if (typeof supabaseClient !== 'undefined' && supabaseClient) await supabaseClient.auth.signOut(); } catch(e) { console.error(e); }
        appState.user = { isLoggedIn: false, email: '', name: '' }; await localforage.removeItem('discom_app_state'); window.location.reload();
    }
};

window.checkOnboardingFlow = function() {
    const overlay = document.getElementById('onboarding-overlay'); if(!overlay) return;
    if (Object.keys(appState.gssNodes || {}).length === 0) { document.getElementById('onboarding-title').innerText = "Add Your First GSS"; document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openAddGssModal(); }; overlay.style.display = 'flex'; } 
    else if (Object.keys(appState.feeders || {}).length === 0) { document.getElementById('onboarding-title').innerText = "Create Your First Feeder"; document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openFeederConfigModal(); }; overlay.style.display = 'flex'; } 
    else { overlay.style.display = 'none'; }
};
