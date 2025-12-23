// ===============================================
// === SERVER.JS - SERVER PRINCIPALE =============
// ===============================================
// Server Express che espone API REST per l'interfaccia
// e si connette a Odoo via XML-RPC

// --- IMPORTS ---
const express = require('express');
const path = require('path');
const odooApi = require('./odoo-api');
require('dotenv').config();

// --- CONFIGURAZIONE EXPRESS ---
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware per parsing JSON
app.use(express.json());

// Serve file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// ===============================================
// === API ENDPOINTS =============================
// ===============================================

// ----------------------------------------------
// GET /api/workcenters
// Recupera tutti i centri di lavoro attivi
// ----------------------------------------------
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

// ----------------------------------------------
// GET /api/workorders/:workcenterId
// Recupera tutti i work orders (ready + active) per un centro di lavoro
// ----------------------------------------------
app.get('/api/workorders/:workcenterId', async (req, res) => {
    try {
        const workcenterId = parseInt(req.params.workcenterId);
        console.log(`[API] Richiesta work orders per workcenter ID: ${workcenterId}`);
        
        const workorders = await odooApi.getWorkordersForWorkcenter(workcenterId);
        console.log(`[API] Trovati ${workorders.ready.length} pronti, ${workorders.active.length} attivi`);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore recupero workorders:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------
// GET /api/workorders/search?q=termine
// Cerca work orders per nome/prodotto (tutti i centri)
// ----------------------------------------------
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

// ----------------------------------------------
// POST /api/workorders/:workorderId/start
// Avvia un work order (porta da ready a progress)
// Body opzionale: { targetWorkcenterId: number }
// Se targetWorkcenterId è diverso dal workcenter attuale,
// prima riassegna il work order al nuovo centro
// ----------------------------------------------
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

// ----------------------------------------------
// GET /api/test
// Test connessione a Odoo
// ----------------------------------------------
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
    console.log('  ODOO WORKORDER LAUNCHER');
    console.log('===============================================');
    console.log(`  Server avviato su http://0.0.0.0:${PORT}`);
    console.log(`  Odoo: ${process.env.ODOO_URL}`);
    console.log(`  Database: ${process.env.ODOO_DB}`);
    console.log('===============================================');
    console.log('');
});
