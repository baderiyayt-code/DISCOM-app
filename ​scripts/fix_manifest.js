module.exports = function(context) {
    var fs = require('fs');
    var path = require('path');

    // Cordova Android 13+ ke manifest paths
    var paths = [
        path.join(context.opts.projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
        path.join(context.opts.projectRoot, 'platforms', 'android', 'AndroidManifest.xml')
    ];

    paths.forEach(function(manifestPath) {
        if (fs.existsSync(manifestPath)) {
            var manifest = fs.readFileSync(manifestPath, 'utf8');
            var regex = /<uses-permission[^>]*android\.permission\.WRITE_EXTERNAL_STORAGE[^>]*>/gi;
            
            if (regex.test(manifest)) {
                console.log("🛠️ Cleaning duplicate WRITE_EXTERNAL_STORAGE permissions...");
                
                // 1. Delete all conflicting duplicates
                manifest = manifest.replace(regex, '');
                
                // 2. Insert exactly one clean permission at the end
                var cleanPermission = '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />\n</manifest>';
                manifest = manifest.replace('</manifest>', cleanPermission);
                
                fs.writeFileSync(manifestPath, manifest, 'utf8');
                console.log("✅ Manifest merged perfectly!");
            }
        }
    });
};
