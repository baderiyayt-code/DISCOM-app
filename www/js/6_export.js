window.smartExportFile = async function(filename, dataBlobOrText, mimeType) {
    try {
        window.showToast("Preparing file export..."); const blob = dataBlobOrText instanceof Blob ? dataBlobOrText : new Blob([dataBlobOrText], { type: mimeType });
        if (window.showSaveFilePicker) { try { const ext = filename.split('.').pop(); const fileHandle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Export', accept: { [mimeType]: ['.' + ext] } }] }); const writable = await fileHandle.createWritable(); await writable.write(blob); await writable.close(); window.showToast("File Saved Successfully!"); return; } catch (e) { console.warn("SaveFilePicker cancelled", e); } }
        if (window.cordova && cordova.file && cordova.file.externalRootDirectory) { window.resolveLocalFileSystemURL(cordova.file.externalRootDirectory + 'Download/', function(dirEntry) { dirEntry.getFile(filename, { create: true, exclusive: false }, function(fileEntry) { fileEntry.createWriter(function(fileWriter) { fileWriter.onwriteend = function() { window.showToast("Saved to Downloads folder!"); }; fileWriter.onerror = function(e) { window.fallbackDownload(blob, filename); }; fileWriter.write(blob); }, function() { window.fallbackDownload(blob, filename); }); }, function() { window.fallbackDownload(blob, filename); }); }, function() { window.fallbackDownload(blob, filename); }); return; }
        window.fallbackDownload(blob, filename);
    } catch (err) { alert("Export failed: " + err.message); }
}
window.fallbackDownload = function(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500); window.showToast("File Downloaded!"); }

window.exportFullJSONBackup = async function() { window.toggleSidebar(false); const backupData = JSON.stringify(appState); await window.smartExportFile(`DISCOM_Backup_${new Date().getTime()}.json`, backupData, "application/json"); }
window.handleImportChoice = function(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async function(event) { try { const content = event.target.result; const importedData = JSON.parse(content); if (importedData.feeders && importedData.gssNodes) { appState = importedData; window.triggerPersistence(); window.renderEntireNetwork(); window.showToast("Data Imported!"); } else alert("Invalid Backup Format!"); } catch (err) { alert("Error parsing file."); } }; reader.readAsText(file); e.target.value = ''; window.toggleSidebar(false); }
window.getCSVString = function() {
    const net = window.getActiveNetwork(); let csv = "\uFEFFWKT,Name,Type,ParentNode,Details\n"; 
    Object.values(appState.gssNodes).forEach(g => csv += `"POINT (${g.lng} ${g.lat})","${g.name}","GSS","","Code: ${g.code}"\n`);
    net.poles.forEach(p => csv += `"POINT (${p.lng} ${p.lat})","Pole ${p.poleNo}","POLE","${p.dtCode||p.poleNo}","Type: ${p.lineType} | Config: ${p.poleType} (${p.poleConfig})" \n`);
    net.dts.forEach(d => csv += `"POINT (${d.lng} ${d.lat})","DT ${d.code}","DT","${d.parentPole}","Rating: ${d.rating}kVA"\n`);
    net.consumers.forEach(c => csv += `"POINT (${c.lng} ${c.lat})","${c.name}","CONSUMER","${c.parentRef}","KNo: ${c.kno} | Load: ${c.load}"\n`);
    net.lines.forEach(l => { if (l.coords && l.coords.length === 2) csv += `"LINESTRING (${l.coords[0][1]} ${l.coords[0][0]}, ${l.coords[1][1]} ${l.coords[1][0]})","${l.type}","LINE","${l.fromNode} ➔ ${l.toNode}","Dist: ${(l.distanceMeters||0).toFixed(1)}m | Cond: ${l.conductor}"\n`; }); return csv;
}
window.exportDataToCSV = async function() { window.toggleSidebar(false); await window.smartExportFile(`${window.getActiveNetwork().feeder.name.replace(/\s+/g, '_')}_GE.csv`, window.getCSVString(), "text/csv;charset=utf-8;"); }
window.exportToAutoCAD_DXF = async function() { window.toggleSidebar(false); let dxf = "0\nSECTION\n2\nENTITIES\n"; window.getActiveNetwork().lines.forEach(l => { if (l.coords && l.coords[0] && l.coords[1]) dxf += `0\nLINE\n8\n${l.type.replace(/\s+/g,'_')}\n10\n${l.coords[0][1]}\n20\n${l.coords[0][0]}\n30\n0\n11\n${l.coords[1][1]}\n21\n${l.coords[1][0]}\n31\n0\n`; }); dxf += "0\nENDSEC\n0\nEOF\n"; await window.smartExportFile(`${window.getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.dxf`, dxf, "application/dxf"); }
window.exportToGoogleEarth_KML = async function() { window.toggleSidebar(false); const esc = u => u.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c])); const feederName = esc(window.getActiveNetwork().feeder.name); let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${feederName}</name>\n`; window.getActiveNetwork().lines.forEach(l => { if (l.coords) kml += `<Placemark><LineString><coordinates>${l.coords[0][1]},${l.coords[0][0]},0 ${l.coords[1][1]},${l.coords[1][0]},0</coordinates></LineString></Placemark>\n`; }); window.getActiveNetwork().dts.forEach(d => { if (d.lat) kml += `<Placemark><Point><coordinates>${d.lng},${d.lat},0</coordinates></Point></Placemark>\n`; }); kml += "</Document>\n</kml>"; await window.smartExportFile(`${window.getActiveNetwork().feeder.name.replace(/\s+/g, '_')}.kml`, kml, "application/vnd.google-earth.kml+xml"); }

window.generateCadSLDPdf = async function() { 
    window.toggleSidebar(false); const net = window.getActiveNetwork();
    if(!window.jspdf || !window.jspdf.jsPDF) return alert("PDF Generator library load error.");
    window.showToast("Generating A0 SLD PDF..."); const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' });
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180; const allPoints = [];
    if(appState.gssNodes[net.feeder.parentGss]) allPoints.push(appState.gssNodes[net.feeder.parentGss]);
    net.poles.forEach(p => { if(p.lineType !== 'LT') allPoints.push(p); }); net.dts.forEach(d => allPoints.push(d));
    if(allPoints.length === 0) return alert("No HT nodes found to plot!");
    allPoints.forEach(p => { if(p.lat < minLat) minLat = p.lat; if(p.lat > maxLat) maxLat = p.lat; if(p.lng < minLng) minLng = p.lng; if(p.lng > maxLng) maxLng = p.lng; });
    const margin = 50; const pdfW = 1189 - (margin * 2); const pdfH = 841 - (margin * 2); const latDiff = maxLat - minLat || 0.01; const lngDiff = maxLng - minLng || 0.01; const scaleX = pdfW / lngDiff; const scaleY = pdfH / latDiff; const scale = Math.min(scaleX, scaleY); const offsetX = margin + (pdfW - (lngDiff * scale)) / 2; const offsetY = margin + (pdfH - (latDiff * scale)) / 2;
    function getPt(lat, lng) { return { x: offsetX + (lng - minLng) * scale, y: 841 - (offsetY + (lat - minLat) * scale) }; }
    doc.setFontSize(10); doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5);
    net.lines.forEach(l => {
        if(!l.type.includes('11 KV')) return;
        const c1 = window.getNodeCoords(l.fromNode), c2 = window.getNodeCoords(l.toNode);
        if(c1 && c2 && !isNaN(c1.lat) && !isNaN(c2.lat)) {
            const pt1 = getPt(c1.lat, c1.lng), pt2 = getPt(c2.lat, c2.lng); doc.line(pt1.x, pt1.y, pt2.x, pt2.y);
            const dist = (l.distanceMeters || window.calcDistance(c1.lat, c1.lng, c2.lat, c2.lng)).toFixed(0);
            const midX = (pt1.x + pt2.x) / 2; const midY = (pt1.y + pt2.y) / 2; let angle = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * (180 / Math.PI); if (angle > 90 || angle < -90) angle += 180;
            doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.text(`${dist} M`, midX, midY - 2, { angle: angle, align: 'center' });
        }
    });
    allPoints.forEach(p => {
        if(isNaN(p.lat)) return;
        const pt = getPt(p.lat, p.lng);
        if(p.code && p.name && p.name.includes("Substation")) { doc.setFillColor(185, 28, 28); doc.rect(pt.x - 6, pt.y - 6, 12, 12, 'FD'); doc.setTextColor(255, 255, 255); doc.setFontSize(6); doc.text("GSS", pt.x, pt.y + 2, {align:'center'}); } 
        else if(p.rating) { doc.setFillColor(245, 158, 11); doc.rect(pt.x - 5, pt.y - 5, 10, 10, 'FD'); doc.setTextColor(0, 0, 0); doc.setFontSize(7); const numOnly = String(p.rating).replace(/[^0-9]/g, ''); doc.text(numOnly, pt.x, pt.y + 2.5, {align:'center'}); } 
        else if(p.lineType !== 'LT') { doc.setFillColor(253, 224, 71); doc.circle(pt.x, pt.y, 3, 'FD'); }
    });
    let t11 = 0, dt1ph = 0, dt3ph = 0; net.lines.forEach(l => { if(!l.type.includes('LT')) t11 += (l.distanceMeters||0); }); net.dts.forEach(d => { if(d.phase === 'Single Phase') dt1ph++; else dt3ph++; });
    doc.setFillColor(255, 255, 255); doc.setDrawColor(0,0,0); doc.setLineWidth(0.5); doc.rect(1189 - 160, 841 - 70, 150, 60, 'FD'); doc.setTextColor(0, 0, 0); doc.setFontSize(16); doc.text("DISCOM SLD REPORT", 1189 - 155, 841 - 55); doc.setFontSize(12); doc.text(`Feeder: ${net.feeder.name} (${net.feeder.code})`, 1189 - 155, 841 - 45); doc.text(`Total HT Line: ${(t11/1000).toFixed(3)} KM`, 1189 - 155, 841 - 35); doc.text(`1-Phase DTs: ${dt1ph}`, 1189 - 155, 841 - 25); doc.text(`3-Phase DTs: ${dt3ph}`, 1189 - 155, 841 - 15);
    await window.smartExportFile(`${net.feeder.name.replace(/\s+/g, '_')}_SLD.pdf`, doc.output('blob'), "application/pdf");
}
