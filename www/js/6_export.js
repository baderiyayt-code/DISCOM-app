/* --- js/6_export.js --- */

// ==========================================
// UNIVERSAL NATIVE FILE DOWNLOADER (FOR APK & WEB)
// ==========================================
window.downloadFileNative = function(blob, filename) {
    if (typeof cordova !== 'undefined' && cordova.file) {
        const storageLocation = cordova.file.externalRootDirectory + 'Download/';
        window.resolveLocalFileSystemURL(storageLocation, function(dirEntry) {
            dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = function() {
                        if(window.showToast) window.showToast(`Saved to Downloads: ${filename}`);
                        window.closeModal();
                    };
                    fileWriter.onerror = function(e) { alert("Write error: " + JSON.stringify(e)); };
                    fileWriter.write(blob);
                }, function(err){ alert("Writer creation error: " + JSON.stringify(err)); });
            }, function(err){ alert("File creation error: " + JSON.stringify(err)); });
        }, function(err) {
            alert("Storage access error! Please check permissions. " + JSON.stringify(err));
        });
    } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if(window.showToast) window.showToast("File Downloaded!");
        window.closeModal();
    }
};

// ==========================================
// 1. GENERATE PROFESSIONAL SLD PDF (BLACK SMALL LINE TEXT & BALANCED DT)
// ==========================================
window.generateCadSLDPdf = function() {
    const net = window.getActiveNetwork();
    if(!net) return alert("No active network to export!");
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        
        const pageWidth = 297, pageHeight = 210, margin = 10;
        const cw = pageWidth - 2 * margin, ch = pageHeight - 2 * margin;

        // Draw Grid
        doc.setDrawColor(235, 240, 245); doc.setLineWidth(0.2);
        for(let i = margin; i <= pageWidth - margin; i += 5) doc.line(i, margin, i, pageHeight - margin);
        for(let j = margin; j <= pageHeight - margin; j += 5) doc.line(margin, j, pageWidth - margin, j);

        doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.rect(margin, margin, cw, ch);

        const fName = (net.feeder && net.feeder.name) ? net.feeder.name : 'UNNAMED FEEDER';
        doc.setFontSize(10); doc.setTextColor(0, 0, 0);
        doc.text(`SLD: ${fName.toUpperCase()} (DISCOM PRO)`, margin + 2, margin + 5);

        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity, nodes = [];
        const pGss = (net.feeder && net.feeder.parentGss) ? appState.gssNodes[net.feeder.parentGss] : null;
        if(pGss) nodes.push({id: 'GSS_'+pGss.code, type: 'GSS', lat: pGss.lat, lng: pGss.lng, data: pGss});
        
        (net.poles||[]).forEach(p => { if(!isNaN(p.lat) && p.lineType !== 'LT') nodes.push({id: 'POLE_'+p.poleNo, type: 'POLE', lat: p.lat, lng: p.lng, data: p}); });
        (net.dts||[]).forEach(d => { if(!isNaN(d.lat)) nodes.push({id: 'DT_'+d.code, type: 'DT', lat: d.lat, lng: d.lng, data: d}); });

        if(nodes.length === 0) return alert("No network elements to draw!");

        nodes.forEach(n => {
            if(n.lat < minLat) minLat = n.lat; if(n.lat > maxLat) maxLat = n.lat;
            if(n.lng < minLng) minLng = n.lng; if(n.lng > maxLng) maxLng = n.lng;
        });

        if(maxLat === minLat) { maxLat += 0.001; minLat -= 0.001; } if(maxLng === minLng) { maxLng += 0.001; minLng -= 0.001; }
        const padLat = (maxLat - minLat) * 0.15; const padLng = (maxLng - minLng) * 0.15;
        minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
        const dLat = maxLat - minLat, dLng = maxLng - minLng;

        // AUTO-ROTATE SCALING
        const scaleNormal = Math.min(cw / dLng, ch / dLat);
        const scaleRotated = Math.min(cw / dLat, ch / dLng);
        const isRotated = scaleRotated > scaleNormal;
        const scale = isRotated ? scaleRotated : scaleNormal;
        
        const eW = isRotated ? dLat : dLng, eH = isRotated ? dLng : dLat;
        const xOffset = margin + (cw - (eW * scale)) / 2, yOffset = margin + (ch - (eH * scale)) / 2;

        const mapToPdf = (lat, lng) => {
            if(isRotated) return { x: xOffset + ((lat - minLat) * scale), y: yOffset + ((lng - minLng) * scale) };
            else return { x: xOffset + ((lng - minLng) * scale), y: yOffset + ch - ((lat - minLat) * scale) };
        };

        if(isRotated) { doc.setFontSize(6); doc.setTextColor(100, 100, 100); doc.text("Note: Diagram Auto-Rotated 90° for optimal fit", margin + 2, margin + 8); }

        let totalHT = 0;
        (net.lines||[]).forEach(l => {
            const spec = window.getLineSpec(l.type, l.phase, l.conductor);
            if(spec.name.includes('LT')) return; 
            
            totalHT += (l.distanceMeters || 0);
            const n1 = window.getNodeCoords(l.fromNode), n2 = window.getNodeCoords(l.toNode);
            if(n1 && n2 && !isNaN(n1.lat) && !isNaN(n2.lat)) {
                const p1 = mapToPdf(n1.lat, n1.lng), p2 = mapToPdf(n2.lat, n2.lng);
                doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.6); doc.line(p1.x, p1.y, p2.x, p2.y);
                const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
                let angleDeg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
                if(angleDeg > 90 || angleDeg < -90) angleDeg += 180; 
                
                // --- LINE TEXT: SMALL (2.8) & BLACK COLOR ---
                doc.setFontSize(2); 
                doc.setTextColor(0, 0, 0); 
                const roundedDist = Math.round(l.distanceMeters || 0);
                doc.text(`${roundedDist} M`, midX, midY - 0.4, { angle: -angleDeg, align: 'center' });
            }
        });

        nodes.forEach(n => {
            const pos = mapToPdf(n.lat, n.lng);
            if(n.type === 'GSS') {
                doc.setFillColor(220, 38, 38); doc.setDrawColor(0,0,0); doc.setLineWidth(0.2); doc.rect(pos.x - 3, pos.y - 2, 6, 4, 'FD'); doc.setFontSize(4.5); doc.setTextColor(255,255,255); doc.text("GSS", pos.x, pos.y + 1, { align: 'center' }); doc.setTextColor(0,0,0); doc.setFontSize(4); doc.text(n.data.name || "Substation", pos.x, pos.y - 3, { align: 'center' });
            } else if(n.type === 'DT') {
                // --- DT BOX & FONT MATCHED PROPORTIONATELY ---
                doc.setFillColor(249, 115, 22); doc.setDrawColor(0,0,0); doc.setLineWidth(0.10); 
                doc.rect(pos.x - 1.25, pos.y - 1.25, 2, 2, 'FD'); 
                doc.setFontSize(3); doc.setTextColor(0,0,0); 
                const rating = String(n.data.rating).replace(/[^0-9]/g, ''); 
                doc.text(rating, pos.x, pos.y, { align: 'center' });
            } else if(n.type === 'POLE') {
                doc.setFillColor(100, 116, 139); doc.circle(pos.x, pos.y, 0.5, 'F');
            }
        });

        doc.setFillColor(255, 255, 255); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3); doc.rect(pageWidth - margin - 45, pageHeight - margin - 12, 43, 10, 'FD'); doc.setFontSize(6); doc.setTextColor(0, 0, 0); doc.text(`Feeder Name: ${fName}`, pageWidth - margin - 43, pageHeight - margin - 8.5); doc.text(`Total HT Length: ${(totalHT/1000).toFixed(3)} km`, pageWidth - margin - 43, pageHeight - margin - 5.5); doc.text(`Total DTs: ${(net.dts||[]).length}`, pageWidth - margin - 43, pageHeight - margin - 2.5);

        const pdfBlob = doc.output('blob');
        window.downloadFileNative(pdfBlob, `${fName.replace(/\s+/g, '_')}_SLD.pdf`);
        
    } catch(err) {
        console.error("PDF Gen Error:", err); alert("Error generating PDF. Wait for libraries to load.");
    }
}

// ==========================================
// 2. EXPORT TO GOOGLE EARTH (KML)
// ==========================================
window.exportToGoogleEarth_KML = function() {
    const net = window.getActiveNetwork(); if(!net) return alert("No active network!");
    let kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${net.feeder.name || 'Feeder'} KML</name>`;
    kml += `<Style id="htLine"><LineStyle><color>ffeb6325</color><width>4</width></LineStyle></Style><Style id="dtIcon"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle></Style><Style id="poleIcon"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/shapes/open-diamond.png</href></Icon></IconStyle></Style>`;
    (net.poles||[]).forEach(p => { if(!isNaN(p.lat)) kml += `<Placemark><name>Pole ${p.poleNo}</name><styleUrl>#poleIcon</styleUrl><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`; });
    (net.dts||[]).forEach(d => { if(!isNaN(d.lat)) kml += `<Placemark><name>DT ${d.code} (${d.rating}kVA)</name><styleUrl>#dtIcon</styleUrl><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>`; });
    (net.lines||[]).forEach(l => { const n1 = window.getNodeCoords(l.fromNode); const n2 = window.getNodeCoords(l.toNode); if(n1 && n2 && !isNaN(n1.lat) && !isNaN(n2.lat)) { kml += `<Placemark><name>${l.type}</name><styleUrl>#htLine</styleUrl><LineString><coordinates>${n1.lng},${n1.lat},0 ${n2.lng},${n2.lat},0</coordinates></LineString></Placemark>`; } });
    kml += `</Document></kml>`;
    
    const blob = new Blob([kml], {type: "application/vnd.google-earth.kml+xml"});
    window.downloadFileNative(blob, `${(net.feeder.name || 'network').replace(/\s+/g, '_')}.kml`);
}

// ==========================================
// 3. EXPORT TO AUTOCAD (DXF)
// ==========================================
window.exportToAutoCAD_DXF = function() {
    const net = window.getActiveNetwork(); if(!net) return alert("No active network!");
    let dxf = "0\nSECTION\n2\nENTITIES\n";
    (net.lines||[]).forEach(l => { const n1 = window.getNodeCoords(l.fromNode); const n2 = window.getNodeCoords(l.toNode); if(n1 && n2 && !isNaN(n1.lat)) { dxf += `0\nLINE\n8\nLines\n10\n${n1.lng}\n20\n${n1.lat}\n11\n${n2.lng}\n21\n${n2.lat}\n`; } });
    (net.dts||[]).forEach(d => { if(!isNaN(d.lat)) dxf += `0\nPOINT\n8\nDTs\n10\n${d.lng}\n20\n${d.lat}\n`; });
    dxf += "0\nENDSEC\n0\nEOF\n";
    
    const blob = new Blob([dxf], {type: "application/dxf"});
    window.downloadFileNative(blob, `${(net.feeder.name || 'network').replace(/\s+/g, '_')}.dxf`);
}

// ==========================================
// 4. EXPORT TO CSV (DATA DUMP)
// ==========================================
window.exportDataToCSV = function() {
    const net = window.getActiveNetwork(); if(!net) return alert("No active network!");
    let csv = "Type,ID/Code,Lat,Lng,Details\n";
    (net.poles||[]).forEach(p => csv += `POLE,${p.poleNo},${p.lat},${p.lng},${p.lineType} - ${p.poleType}\n`);
    (net.dts||[]).forEach(d => csv += `DT,${d.code},${d.lat},${d.lng},${d.rating}kVA - ${d.phase}\n`);
    (net.lines||[]).forEach(l => csv += `LINE,${l.fromNode} to ${l.toNode},,,${l.type} - ${(l.distanceMeters||0).toFixed(1)}m\n`);
    (net.consumers||[]).forEach(c => csv += `CONSUMER,${c.kno},${c.lat},${c.lng},${c.name} - ${c.cType}\n`);

    const blob = new Blob([csv], {type: "text/csv"});
    window.downloadFileNative(blob, `${(net.feeder.name || 'network').replace(/\s+/g, '_')}_Data.csv`);
}

// ==========================================
// 5. JSON BACKUP & RESTORE
// ==========================================
window.exportFullJSONBackup = function() {
    if(!appState) return;
    const dataStr = JSON.stringify(appState, null, 2);
    const blob = new Blob([dataStr], {type: "application/json"});
    window.downloadFileNative(blob, `DISCOM_Survey_Backup_${new Date().getTime()}.json`);
}

window.handleImportChoice = function(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const importedData = JSON.parse(ev.target.result);
            if(!importedData.feeders || !importedData.gssNodes) return alert("Invalid Backup File!");
            appState = importedData;
            window.triggerPersistence(); window.renderEntireNetwork();
            alert("Backup Restored Successfully!"); window.closeModal();
        } catch(err) { alert("Error parsing JSON file!"); }
    };
    reader.readAsText(file);
}
