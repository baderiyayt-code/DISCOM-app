// App State and Database Logic
let appState = {
    settings: { checkOrphanNode: true, unit: 'm' },
    user: { isLoggedIn: false, name: "", email: "", id: null },
    filters: { lines11: true, linesLT: true, poles: true, dts: true, consumers: true },
    currentFeederCode: "1",
    gssNodes: { "1": { code: "1", name: "132/33 kV Substation", lat: 26.9150, lng: 75.7830 } },
    feeders: { 
        "1": { feeder: { name: "11 kV Feeder-01", code: "1", parentGss: "1" }, poles: [], dts: [], lines: [], consumers: [] } 
    },
    orphanPoleIds: new Set(), activeMove: null, placementType: null
};

let historyStack = [];

// BUG FIX: Generate Unique IDs for every object to prevent overwriting
function generateUUID() {
    return 'ID-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
}

function getActiveNetwork() {
    if (!appState.feeders[appState.currentFeederCode]) appState.currentFeederCode = Object.keys(appState.feeders)[0] || "1";
    let net = appState.feeders[appState.currentFeederCode];
    if (!net.poles) net.poles = []; if (!net.lines) net.lines = []; 
    if (!net.dts) net.dts = []; if (!net.consumers) net.consumers = [];
    return net;
}

// Memory Leak Fix: Use JSON Stringify for snapshot to keep RAM usage low
function saveSnapshot() {
    const net = getActiveNetwork();
    historyStack.push(JSON.stringify({ poles: net.poles, lines: net.lines, dts: net.dts, consumers: net.consumers }));
    if (historyStack.length > 10) historyStack.shift(); // Max 10 undos
}

function undoLastAction() {
    if (historyStack.length === 0) return showToast("No actions to Undo!");
    const prevState = JSON.parse(historyStack.pop());
    const net = getActiveNetwork();
    net.poles = prevState.poles; net.lines = prevState.lines; net.dts = prevState.dts; net.consumers = prevState.consumers;
    renderEntireNetwork(); triggerPersistence(); showToast("Undo Successful ↺");
}

function triggerPersistence() { 
    localforage.setItem(CONFIG.DB_KEY, appState).catch(() => localStorage.setItem(CONFIG.DB_KEY, JSON.stringify(appState)));
    syncToSupabase(); 
}

// Authentication Logic
async function handleSupabaseAuth(mode) {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const name = document.getElementById('authName').value.trim();
    if(!email || !password) return alert("Email and Password required");

    let response;
    if (mode === 'signup') {
        if(!name) return alert("Please enter Full Name");
        response = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name } } });
    } else {
        response = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (response.error) alert(response.error.message);
    else if (response.data.user) {
        appState.user.isLoggedIn = true;
        appState.user.email = response.data.user.email;
        appState.user.id = response.data.user.id;
        appState.user.name = response.data.user.user_metadata?.full_name || email.split('@')[0];
        
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        pullFromSupabase();
    }
}

async function handleSupabaseLogout() {
    await supabaseClient.auth.signOut();
    await localforage.clear();
    location.reload();
}

// Sync Logic
function syncToSupabase() {
    if (!appState.user.isLoggedIn) return;
    const dataToSync = JSON.parse(JSON.stringify(appState));
    delete dataToSync.user; delete dataToSync.orphanPoleIds;
    
    supabaseClient.from('survey_data').upsert(
        { user_id: appState.user.id, data: dataToSync, updated_at: new Date().toISOString() }, 
        { onConflict: 'user_id' }
    ).then(({error}) => {
        document.getElementById('sync-indicator').innerHTML = error ? '❌☁️' : '✅☁️';
    });
}

function pullFromSupabase() {
    if (!appState.user.id) return;
    supabaseClient.from('survey_data').select('data').eq('user_id', appState.user.id)
    .then(({ data, error }) => {
        if (data && data.length > 0) {
            const cloudData = data[0].data;
            appState.feeders = cloudData.feeders || appState.feeders;
            appState.gssNodes = cloudData.gssNodes || appState.gssNodes;
            renderEntireNetwork();
        }
    });
}
