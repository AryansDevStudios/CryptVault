const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, 'public', 'lib');

// Ensure the destination directory exists
if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir, { recursive: true });
}

// Map of library files to copy from node_modules into public/lib/
const filesToCopy = [
    { src: ['node_modules', 'pdfjs-dist', 'build', 'pdf.min.mjs'], dest: 'pdf.min.mjs' },
    { src: ['node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'], dest: 'pdf.worker.min.mjs' },
    { src: ['node_modules', 'marked', 'marked.min.js'], dest: 'marked.min.js' },
    { src: ['node_modules', 'dompurify', 'dist', 'purify.min.js'], dest: 'purify.min.js' }
];

filesToCopy.forEach(file => {
    const srcPath = path.join(__dirname, ...file.src);
    const destPath = path.join(libDir, file.dest);
    
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`✅ Automatically copied ${file.dest} to public/lib/`);
    } else {
        console.warn(`⚠️ Warning: Could not find ${srcPath}. Make sure npm install ran successfully.`);
    }
});
