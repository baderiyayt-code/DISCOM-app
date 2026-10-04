/* --- js/2_db_sync.js --- */

// ==========================================
// LOCALFORAGE & SUPABASE SYNC MANAGEMENT
// ==========================================

window.initPersistence = async function() {
    try {
        await localforage.ready();
        const savedState = await localforage.getItem('discom_app_state');
        if (savedState) {
            appState = savedState;
            // Ensure mandatory keys exist
            if(!appState.feeders) appState.feeders = {};
            if(!appState.gssNodes) appState.gssNodes = {};
            if(!appState.settings) appState.settings = { unit: 'm', language: 'en', theme: 'light', liveSync: true };
            if(!appState.filters) appState.filters = { lines11: true, linesLT: true, poles: true, dts: true, consumers: true };
        } else {
            // Default Initial State
            appState = {
                user: { isLoggedIn: false, email: '', name: '' },
                currentFeederCode: null,
                gssNodes: {},
                feeders: {},
                filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
                settings: { unit: 'm', language: 'en', theme: 'light', liveSync: true }
            };
        }
        
        // --- DE-DUPLICATION CHECK ON LOAD ---
        window.deduplicateNetworkData();

    } catch (err) {
        console.error("LocalForage Init Error:", err);
    }
};

// --- STRICT UNIQUE ID MERGE (PREVENTS LOCAL/ONLINE DUPLICATES) ---
window.deduplicateNetworkData = function() {
    if(!appState || !appState.feeders) return;
    
    Object.keys(appState.feeders).forEach(fCode => {
        const net = appState.feeders[fCode];
        
        // 1. Deduplicate DTs by Code
        if(net.dts) {
            const dtMap = new Map();
            net.dts.forEach(d => dtMap.set(String(d.code), d));
            net.dts = Array.from(dtMap.values());
        }
        
        // 2. Deduplicate Poles by poleNo
        if(net.poles) {
            const poleMap = new Map();
            net.poles.forEach(p => poleMap.set(String(p.poleNo), p));
            net.poles = Array.from(poleMap.values());
        }
        
        // 3. Deduplicate Consumers by K-Number (kno)
        if(net.consumers) {
            const consMap = new Map();
            net.consumers.forEach(c => {
                const key = String(c.kno || c.id);
                consMap.set(key, c);
            });
            net.consumers = Array.from(consMap.values());
        }
        
        // 4. Deduplicate Lines by From-To nodes
        if(net.lines) {
            const lineMap = new Map();
            net.lines.forEach(l => {
                const key = `${l.fromNode}_${l.toNode}_${l.type}`;
                lineMap.set(key, l);
            });
            net.lines = Array.from(lineMap.values());
        }
    });
};

window.triggerPersistence = async function() {
    try {
        // Run deduplication before saving locally
        window.deduplicateNetworkData();
        await localforage.setItem('discom_app_state', appState);
        
        // Trigger background cloud sync if logged in and live sync is enabled
        if (appState.user && appState.user.isLoggedIn && appState.settings && appState.settings.liveSync !== false) {
            window.syncToSupabase(true); // Silent sync
        }
    } catch (err) {
        console.error("Persistence Error:", err);
    }
};

window.getActiveNetwork = function() {
    if (!appState || !appState.feeders) return null;
    if (!appState.currentFeederCode || !appState.feeders[appState.currentFeederCode]) {
        const keys = Object.keys(appState.feeders);
        if (keys.length > 0) appState.currentFeederCode = keys[0];
        else return null;
    }
    return appState.feeders[appState.currentFeederCode];
};

// ==========================================
// SUPABASE CLOUD SYNC
// ==========================================
let isSyncing = false;

window.syncToSupabase = async function(isSilent = false) {
    if (!appState || !appState.user || !appState.user.isLoggedIn) {
        if (!isSilent) alert("Please log in first to sync with cloud!");
        return;
    }
    
    if (isSyncing) return;
    isSyncing = false; // Reset lock safely

    const indicator = document.getElementById('sync-indicator');
    if (indicator) indicator.classList.add('fa-spin');

    try {
        // Simulated or real Supabase client sync check
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            const userId = appState.user.email;
            
            // Save state backup to Supabase table (discom_surveys)
            const { error } = await supabaseClient
                .from('discom_surveys')
                .upsert({ user_email: userId, state_data: appState, updated_at: new Date() }, { onConflict: 'user_email' });
            
            if (error) throw error;
        }

        if (!isSilent && window.showToast) window.showToast("Cloud Sync Successful! ☁️");
    } catch (err) {
        console.error("Cloud Sync Error:", err);
        if (!isSilent && window.showToast) window.showToast("Sync offline / saved locally");
    } finally {
        if (indicator) indicator.classList.remove('fa-spin');
    }
};

window.handleSupabaseAuth = async function(mode) {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const name = document.getElementById('authName') ? document.getElementById('authName').value.trim() : 'Surveyor';

    if(!email || !password) return alert("Email and Password are required!");

    // Loader on
    const loader = document.getElementById('erection-loader');
    const spinner = document.getElementById('appLoaderSpinner');
    if(loader) loader.style.display = 'flex';
    if(spinner) spinner.style.display = 'block';

    try {
        if (typeof supabaseClient !== 'undefined' && supabaseClient) {
            if (mode === 'signup') {
                const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
                if (error) throw error;
                alert("Account created successfully! You can now login.");
                toggleAuthMode();
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;
                
                appState.user = { isLoggedIn: true, email: email, name: data.user.user_metadata?.full_name || name };
                
                // Fetch existing cloud data if available
                const { data: cloudData, err: fetchErr } = await supabaseClient
                    .from('discom_surveys')
                    .select('state_data')
                    .eq('user_email', email)
                    .single();
                
                if (cloudData && cloudData.state_data) {
                    appState = cloudData.state_data;
                }

                await window.triggerPersistence();
                
                if(loader) loader.style.display = 'none';
                document.getElementById('auth-screen').style.display = 'none';
                if(window.renderEntireNetwork) window.renderEntireNetwork();
                if(window.showToast) window.showToast("Logged in successfully!");
                if(window.checkOnboardingFlow) window.checkOnboardingFlow();
            }
        } else {
            // Fallback offline login mode if Supabase not configured
            appState.user = { isLoggedIn: true, email: email, name: name };
            await window.triggerPersistence();
            if(loader) loader.style.display = 'none';
            document.getElementById('auth-screen').style.display = 'none';
            if(window.renderEntireNetwork) window.renderEntireNetwork();
            if(window.showToast) window.showToast("Offline Logged In!");
        }
    } catch(err) {
        console.error("Auth Error:", err);
        alert("Authentication failed: " + err.message);
        if(loader) loader.style.display = 'none';
    } finally {
        if(spinner) spinner.style.display = 'none';
    }
};

window.handleSupabaseLogout = async function() {
    if(confirm("Are you sure you want to logout?")) {
        try {
            if (typeof supabaseClient !== 'undefined' && supabaseClient) {
                await supabaseClient.auth.signOut();
            }
        } catch(e) { console.error(e); }
        
        appState.user = { isLoggedIn: false, email: '', name: '' };
        await localforage.removeItem('discom_app_state');
        window.location.reload();
    }
};

window.checkOnboardingFlow = function() {
    const overlay = document.getElementById('onboarding-overlay');
    if(!overlay) return;
    
    const gssKeys = Object.keys(appState.gssNodes || {});
    const feederKeys = Object.keys(appState.feeders || {});
    
    if (gssKeys.length === 0) {
        document.getElementById('onboarding-title').innerText = "Add Your First GSS";
        document.getElementById('onboarding-desc').innerText = "To begin electrical survey, please configure your parent GSS substation.";
        document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openAddGssModal(); };
        overlay.style.display = 'flex';
    } else if (feederKeys.length === 0) {
        document.getElementById('onboarding-title').innerText = "Create Your First Feeder";
        document.getElementById('onboarding-desc').innerText = "GSS added successfully! Now create an 11kV Feeder to start placing poles and DTs.";
        document.getElementById('onboarding-btn').onclick = () => { overlay.style.display = 'none'; window.openFeederConfigMap ? window.openFeederConfigMap() : window.openFeederConfigModal(); };
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
};
