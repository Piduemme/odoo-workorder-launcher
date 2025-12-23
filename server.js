// ===============================================
// === SERVER.JS - SERVER PRINCIPALE =============
// ===============================================
// Server Express che espone API REST per l'interfaccia
// e si connette a Odoo via XML-RPC

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

// GET /api/workcenters - Lista centri di lavoro con conteggi
app.get('/api/workcenters', async (req, res) => {
    try {
        console.log('[API] Richiesta centri di lavoro...');
        const workcenters = await odooApi.getWorkcenters();
        console.log(`[API] Trovati ${workcenters.length} centri di lavoro`);
        res.json(workcenters);
    } catch (error) {
        console.error('[API] Errore recupero workcenters:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders - TUTTI i work orders
app.get('/api/workorders', async (req, res) => {
    try {
        console.log(`[API] Richiesta TUTTI i work orders`);
        const workorders = await odooApi.getAllWorkorders();
        console.log(`[API] Trovati ${workorders.ready.length} pronti, ${workorders.active.length} attivi`);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore recupero workorders:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/search?q=termine - Ricerca
app.get('/api/workorders/search', async (req, res) => {
    try {
        const searchTerm = req.query.q || '';
        console.log(`[API] Ricerca work orders: "${searchTerm}"`);
        
        if (searchTerm.length < 2) {
            return res.json([]);
        }
        
        const workorders = await odooApi.searchWorkorders(searchTerm);
        console.log(`[API] Trovati ${workorders.length} work orders`);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore ricerca workorders:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/details - Dettagli work order
app.get('/api/workorders/:workorderId/details', async (req, res) => {
    try {
        const workorderId = parseInt(req.params.workorderId);
        console.log(`[API] Richiesta dettagli work order ${workorderId}`);
        
        const details = await odooApi.getWorkorderDetails(workorderId);
        if (!details) {
            return res.status(404).json({ error: 'Work order non trovato' });
        }
        
        res.json(details);
    } catch (error) {
        console.error('[API] Errore dettagli workorder:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/timetracking - Storico tempi
app.get('/api/workorders/:workorderId/timetracking', async (req, res) => {
    try {
        const workorderId = parseInt(req.params.workorderId);
        console.log(`[API] Richiesta time tracking work order ${workorderId}`);
        
        const timeLogs = await odooApi.getWorkorderTimeTracking(workorderId);
        res.json(timeLogs);
    } catch (error) {
        console.error('[API] Errore time tracking:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/start - Avvia work order
app.post('/api/workorders/:workorderId/start', async (req, res) => {
    try {
        const workorderId = parseInt(req.params.workorderId);
        const targetWorkcenterId = req.body.targetWorkcenterId ? parseInt(req.body.targetWorkcenterId) : null;
        
        console.log(`[API] Avvio work order ID: ${workorderId}, target workcenter: ${targetWorkcenterId || 'nessuno'}`);
        
        const result = await odooApi.startWorkorder(workorderId, targetWorkcenterId);
        console.log(`[API] Work order ${workorderId} avviato con successo`);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore avvio workorder:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/pause - Mette in pausa
app.post('/api/workorders/:workorderId/pause', async (req, res) => {
    try {
        const workorderId = parseInt(req.params.workorderId);
        console.log(`[API] Pausa work order ID: ${workorderId}`);
        
        const result = await odooApi.pauseWorkorder(workorderId);
        console.log(`[API] Work order ${workorderId} in pausa`);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore pausa workorder:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/complete - Completa
app.post('/api/workorders/:workorderId/complete', async (req, res) => {
    try {
        const workorderId = parseInt(req.params.workorderId);
        console.log(`[API] Completamento work order ID: ${workorderId}`);
        
        const result = await odooApi.completeWorkorder(workorderId);
        console.log(`[API] Work order ${workorderId} completato`);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore completamento workorder:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/test - Test connessione
app.get('/api/test', async (req, res) => {
    try {
        console.log('[API] Test connessione Odoo...');
        const uid = await odooApi.testConnection();
        res.json({ success: true, uid, message: 'Connessione a Odoo riuscita!' });
    } catch (error) {
        console.error('[API] Errore test connessione:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===============================================
// === AVVIO SERVER ==============================
// ===============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===============================================');
    console.log('  ODOO WORKORDER LAUNCHER v2.0');
    console.log('===============================================');
    console.log(`  Server avviato su http://0.0.0.0:${PORT}`);
    console.log(`  Odoo: ${process.env.ODOO_URL}`);
    console.log(`  Database: ${process.env.ODOO_DB}`);
    console.log('===============================================');
    console.log('');
});
