window.requestAppPermissions = function() {
    if(window.cordova && cordova.plugins && cordova.plugins.permissions) {
        var permissions = cordova.plugins.permissions;
        var list = [ permissions.ACCESS_FINE_LOCATION, permissions.CAMERA, permissions.READ_EXTERNAL_STORAGE, 'android.permission.READ_MEDIA_IMAGES' ];
        permissions.requestPermissions(list, function(status) {
            permissions.checkPermission(permissions.ACCESS_FINE_LOCATION, function(locStatus) {
                if (locStatus.hasPermission) {
                    document.getElementById('permission-overlay').style.display = 'none'; window.initializeAppPostPermissions();
                } else { document.getElementById('permission-overlay').style.display = 'flex'; window.showToast("Location strictly required!"); }
            }, null);
        }, function() { document.getElementById('permission-overlay').style.display = 'flex'; });
    } else { document.getElementById('permission-overlay').style.display = 'none'; window.initializeAppPostPermissions(); }
}

window.initializeAppPostPermissions = async function() {
    try {
        window.initMapLayers();
        if (typeof supabase !== 'undefined') supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        let data = null; if (typeof localforage !== 'undefined') data = await localforage.getItem(DB_KEY); 
        if (!data) { const lsData = localStorage.getItem(DB_KEY); if (lsData) data = JSON.parse(lsData); }
        if (data && data.feeders) appState = data; 
        window.applyTranslations(); window.applyTheme();
        
        if (appState.user && appState.user.isLoggedIn) { 
            window.applyAuthUIVisuals(); setTimeout(() => { if(map) map.invalidateSize(); window.renderEntireNetwork(); window.centerMapOnGSS(); window.checkOnboardingFlow(); window.updateUnsyncedBadge(); }, 100);
        } else { document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; }
        
        if (supabaseClient) {
            supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    appState.user.isLoggedIn = true; appState.user.email = data.session.user.email; appState.user.id = data.session.user.id;
                    appState.user.name = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
                    window.applyAuthUIVisuals(); window.pullFromSupabase(); 
                }
            }).catch(err => console.log("Offline mode"));
        }
    } catch (e) { console.error("Init Error:", e); document.getElementById('app-container').style.display = 'none'; document.getElementById('auth-screen').style.display = 'flex'; window.showToast("Offline Mode / Load Error"); }
}

window.startAppStartupSequence = function() {
    setTimeout(() => {
        const loader = document.getElementById('erection-loader'); if(loader) loader.style.display = 'none';
        if(typeof navigator !== 'undefined' && navigator.splashscreen) navigator.splashscreen.hide();
        if(window.cordova && cordova.plugins && cordova.plugins.permissions) { window.requestAppPermissions(); } else window.initializeAppPostPermissions();
    }, 2000);
}

document.addEventListener('deviceready', window.startAppStartupSequence, false); 
if (!window.cordova) { window.addEventListener('DOMContentLoaded', window.startAppStartupSequence); }
/* ==========================================
   LIVE TRACKING WITH ACCURACY CIRCLE & KPI
========================================== */
let liveTrackWatchId = null;
let liveTrackMarker = null;
let liveTrackCircle = null;

window.toggleLiveTracking = function() {
    const btn = document.getElementById('liveTrackBtn');
    if (liveTrackWatchId) {
        navigator.geolocation.clearWatch(liveTrackWatchId);
        liveTrackWatchId = null;
        if (liveTrackMarker && typeof map !== 'undefined') map.removeLayer(liveTrackMarker);
        if (liveTrackCircle && typeof map !== 'undefined') map.removeLayer(liveTrackCircle);
        liveTrackMarker = null;
        liveTrackCircle = null;
        btn.style.color = '';
        if(window.showToast) window.showToast("Live Tracking Disabled");
    } else {
        btn.style.color = '#3b82f6'; 
        if(window.showToast) window.showToast("Live Tracking Enabled");
        
        liveTrackWatchId = navigator.geolocation.watchPosition((pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = pos.coords.accuracy; // Exact accuracy radius in meters
            
            if(!liveTrackMarker && typeof map !== 'undefined') {
                // 1. Solid Blue Dot
                liveTrackMarker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'live-gps-dot',
                        html: '<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.5);"></div>',
                        iconSize: [16,16],
                        iconAnchor: [8,8]
                    }), zIndexOffset: 9999
                }).addTo(map);
                
                // 2. Accuracy Light Blue Circle (Like Google Maps)
                liveTrackCircle = L.circle([lat, lng], {
                    radius: acc,
                    color: '#3b82f6',
                    weight: 1,
                    fillColor: '#3b82f6',
                    fillOpacity: 0.15
                }).addTo(map);
                
                map.setView([lat, lng], 19);
            } else if(liveTrackMarker && liveTrackCircle) {
                liveTrackMarker.setLatLng([lat, lng]);
                liveTrackCircle.setLatLng([lat, lng]);
                liveTrackCircle.setRadius(acc); // Auto expand/shrink radius based on signal
            }
        }, (err) => {
            console.error(err);
            if(window.showToast) window.showToast("GPS Error: " + err.message);
            btn.style.color = '';
            liveTrackWatchId = null;
        }, { enableHighAccuracy: true, maximumAge: 0 });
    }
};

window.toggleKPIBar = function() {
    const kpi = document.getElementById('kpi-container');
    const icon = document.getElementById('kpi-toggle-icon');
    if(!kpi || !icon) return;
    kpi.classList.toggle('collapsed');
    icon.className = kpi.classList.contains('collapsed') ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
};

