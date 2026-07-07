const archiver = require('archiver');
const fs = require('fs');

try {
    const output = fs.createWriteStream(__dirname + '/test3.zip');
    const archive = new archiver.ZipArchive({ zlib: { level: 1 } });
    
    archive.on('error', function(err) {
      console.error("Archiver error:", err);
    });

    archive.pipe(output);
    archive.finalize().then(() => console.log('Finalized empty')).catch(e => console.error("Finalize error:", e));
} catch(e) {
    console.error("Caught error:", e);
}
