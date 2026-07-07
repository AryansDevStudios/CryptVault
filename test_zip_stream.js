const archiver = require('archiver');
const fs = require('fs');
const { PassThrough } = require('stream');

try {
    const output = fs.createWriteStream(__dirname + '/test2.zip');
    const archive = new archiver.ZipArchive({ zlib: { level: 1 } });
    
    archive.on('error', function(err) {
      console.error("Archiver error:", err);
    });

    archive.pipe(output);
    
    const pt = new PassThrough();
    archive.append(pt, { name: 'test_stream.txt' });
    
    pt.write('hello from stream');
    pt.end();
    
    archive.finalize().then(() => console.log('Finalized')).catch(e => console.error("Finalize error:", e));
} catch(e) {
    console.error("Caught error:", e);
}
