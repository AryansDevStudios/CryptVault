const express = require('express');
const app = express();
app.get('/api/download/:uuid', (req, res) => res.send('download'));
app.get('/api/download-multiple', (req, res) => res.send('multiple'));
app.listen(3001, () => {
    fetch('http://localhost:3001/api/download-multiple').then(r=>r.text()).then(console.log).then(()=>process.exit());
});
