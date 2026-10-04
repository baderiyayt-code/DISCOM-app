window.requestAppPermissions = function() {
    if(window.cordova && cordova.plugins && cordova.plugins.permissions) {
        var permissions = cordova.plugins.permissions;
        var list = [ permissions.ACCESS_FINE_LOCATION, permissions.CAMERA, permissions.READ_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ];
        permissions.requestPermissions(list, function(status) {
            permissions.checkPermission(permissions.ACCESS_FINE_LOCATION, function(locStatus) {
                if (locStatus.hasPermission) {
                    document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions();
                } else { document.getElementById('permission-overlay').style.display = 'flex'; showToast("Location strictly required!"); }
            }, null);
        }, function() { document.getElementById('permission-overlay').style.display = 'flex'; });
    } else { document.getElementById('permission-overlay').style.display = 'none'; initializeAppPostPermissions(); }
}

async function initializeAppPostPermissions() {
    try {
        initMapLayers();
        if (typeof supabase !== 'undefined') supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        let data = null; if (typeof localforage !== 'undefined') data = await localforage.getItem(DB_KEY); 
        if (!data) { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) appState = data; 
        applyTranslations(); applyTheme();
        
        if (appState.user && appState.user.isLoggedIn) { 
            applyAuthUIVisuals(); setTimeout(() => { if(map) map.invalidateSize(); renderEntireNetwork(); centerMapOnGSS(); checkOnboardingFlow(); updateUnsyncedBadge(); }, 100);
        } else { document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; }
        
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    applyAuthUIVisuals(); pullFromSupabase(); 
                }
            }).catch(err => console.log("Offline mode"));
        }
    } catch (e) { console.error("Init Error:", e); document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; showToast("Offline Mode / Load Error"); }
}

function startAppStartupSequence() {
    setTimeout(() => {
        const loader = document.getElementById('erection-loader'); if(loader) loader.style.display = 'none';
        if(navigator.splashscreen) navigator.splashscreen.hide();
        if(window.cordova && cordova.plugins && cordova.plugins.permissions) { window.requestAppPermissions(); } else initializeAppPostPermissions();
    }, 2000);
}

document.addEventListener('deviceready', startAppStartupSequence, false); 
if (!window.cordova) { window.addEventListener('DOMContentLoaded', startAppStartupSequence); }
