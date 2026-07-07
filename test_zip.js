const archiver = require('archiver');
const fs = require('fs');

try {
    const output = fs.createWriteStream(__dirname + '/test.zip');
    const archive = new archiver.ZipArchive({ zlib: { level: 1 } });

    
    archive.on('error', function(err) {
      throw err;
    });

    archive.pipe(output);
    archive.append('string data!', { name: 'file1.txt' });
    archive.finalize().then(() => console.log('Finalized')).catch(e => console.error(e));
} catch(e) {
    console.error("Caught error:", e);
}
