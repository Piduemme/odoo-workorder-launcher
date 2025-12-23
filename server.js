// ===============================================
// === SERVER.JS - v2.1 ==========================
// ===============================================

const express = require('express');
const path = require('path');
const odooApi = require('./odoo-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// === API ENDPOINTS =============================
// ===============================================

// GET /api/tags - Lista tag (Estrusione, Saldatura, Stampa)
app.get('/api/tags', async (req, res) => {
    try {
        const tags = await odooApi.getWorkcenterTags();
        res.json(tags);
    } catch (error) {
        console.error('[API] Errore tags:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workcenters - Con tag e machine_type
app.get('/api/workcenters', async (req, res) => {
    try {
        console.log('[API] Richiesta workcenters...');
        const workcenters = await odooApi.getWorkcenters();
        console.log(`[API] ${workcenters.length} workcenters`);
        res.json(workcenters);
    } catch (error) {
        console.error('[API] Errore workcenters:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders - Tutti con operation_type
app.get('/api/workorders', async (req, res) => {
    try {
        console.log('[API] Richiesta workorders...');
        const workorders = await odooApi.getAllWorkorders();
        console.log(`[API] ${workorders.ready.length} pronti, ${workorders.active.length} attivi`);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore workorders:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/search?q=...
app.get('/api/workorders/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        if (q.length < 2) return res.json([]);
        
        const workorders = await odooApi.searchWorkorders(q);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore search:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/details
app.get('/api/workorders/:id/details', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const details = await odooApi.getWorkorderDetails(id);
        if (!details) return res.status(404).json({ error: 'Non trovato' });
        res.json(details);
    } catch (error) {
        console.error('[API] Errore details:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/timetracking
app.get('/api/workorders/:id/timetracking', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const logs = await odooApi.getWorkorderTimeTracking(id);
        res.json(logs);
    } catch (error) {
        console.error('[API] Errore timetracking:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/start
app.post('/api/workorders/:id/start', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const targetWcId = req.body.targetWorkcenterId ? parseInt(req.body.targetWorkcenterId) : null;
        
        console.log(`[API] Start WO ${id}, target WC: ${targetWcId || 'nessuno'}`);
        const result = await odooApi.startWorkorder(id, targetWcId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore start:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/pause
app.post('/api/workorders/:id/pause', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await odooApi.pauseWorkorder(id);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore pause:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/complete
app.post('/api/workorders/:id/complete', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await odooApi.completeWorkorder(id);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore complete:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/test
app.get('/api/test', async (req, res) => {
    try {
        const uid = await odooApi.testConnection();
        res.json({ success: true, uid });
    } catch (error) {
        console.error('[API] Errore test:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===============================================
// === START =====================================
// ===============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===============================================');
    console.log('  ODOO WORKORDER LAUNCHER v2.1');
    console.log('  + Filtro operazioni compatibili');
    console.log('===============================================');
    console.log(`  http://0.0.0.0:${PORT}`);
    console.log(`  Odoo: ${process.env.ODOO_URL}`);
    console.log('===============================================');
    console.log('');
});
