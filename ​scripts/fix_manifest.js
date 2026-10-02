module.exports = function(context) {
    var fs = require('fs');
    var path = require('path');

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
                manifest = manifest.replace(regex, '');
                var cleanPermission = '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />\n</manifest>';
                manifest = manifest.replace('</manifest>', cleanPermission);
                fs.writeFileSync(manifestPath, manifest, 'utf8');
                console.log("✅ Manifest merged perfectly!");
            }
        }
    });
};
