// ===============================================
// === ODOO-API.JS - CONNESSIONE ODOO ============
// ===============================================
// Modulo per comunicare con Odoo via XML-RPC
// Gestisce autenticazione e chiamate ai modelli MRP

const xmlrpc = require('xmlrpc');
require('dotenv').config();

// --- CONFIGURAZIONE DA .env ---
const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

// Estraggo host e porta dall'URL
const urlParts = new URL(ODOO_URL);
const isSecure = urlParts.protocol === 'https:';
const host = urlParts.hostname;
const port = urlParts.port || (isSecure ? 443 : 80);

// --- CLIENTS XML-RPC ---
// Client per autenticazione
const commonClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/common' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/common' });

// Client per operazioni sui modelli
const objectClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/object' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/object' });

// --- CACHE UID ---
let cachedUid = null;

// ===============================================
// === FUNZIONI HELPER ===========================
// ===============================================

/**
 * Esegue autenticazione e ritorna UID utente
 * Usa cache per evitare autenticazioni ripetute
 */
async function authenticate() {
    // Se ho già l'UID in cache, lo riuso
    if (cachedUid) {
        return cachedUid;
    }

    return new Promise((resolve, reject) => {
        console.log('[ODOO] Autenticazione in corso...');
        
        commonClient.methodCall(
            'authenticate',
            [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}],
            (error, uid) => {
                if (error) {
                    console.error('[ODOO] Errore autenticazione:', error.message);
                    reject(new Error(`Autenticazione fallita: ${error.message}`));
                    return;
                }
                
                if (!uid) {
                    reject(new Error('Autenticazione fallita: credenziali non valide'));
                    return;
                }

                console.log(`[ODOO] Autenticato con UID: ${uid}`);
                cachedUid = uid;
                resolve(uid);
            }
        );
    });
}

/**
 * Esegue una chiamata al modello Odoo
 * @param {string} model - Nome del modello (es. 'mrp.workcenter')
 * @param {string} method - Metodo da chiamare (es. 'search_read')
 * @param {Array} args - Argomenti posizionali
 * @param {Object} kwargs - Argomenti keyword
 */
async function executeKw(model, method, args = [], kwargs = {}) {
    const uid = await authenticate();

    return new Promise((resolve, reject) => {
        objectClient.methodCall(
            'execute_kw',
            [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs],
            (error, result) => {
                if (error) {
                    console.error(`[ODOO] Errore ${model}.${method}:`, error.message);
                    reject(error);
                    return;
                }
                resolve(result);
            }
        );
    });
}

// ===============================================
// === FUNZIONI PUBBLICHE ========================
// ===============================================

/**
 * Test connessione a Odoo
 * @returns {Promise<number>} UID dell'utente autenticato
 */
async function testConnection() {
    cachedUid = null; // Forza nuova autenticazione
    return await authenticate();
}

/**
 * Recupera tutti i centri di lavoro attivi
 * @returns {Promise<Array>} Lista di workcenters
 */
async function getWorkcenters() {
    console.log('[ODOO] Recupero centri di lavoro...');
    
    const workcenters = await executeKw(
        'mrp.workcenter',
        'search_read',
        [[['active', '=', true]]], // Domain: solo attivi
        {
            fields: ['id', 'name', 'code', 'color', 'working_state'],
            order: 'sequence, name'
        }
    );

    return workcenters;
}

/**
 * Recupera work orders pronti per un centro di lavoro
 * In Odoo 17+ i campi date sono cambiati:
 * - date_planned_start -> date_start (o scheduled_date_start)
 * - date_planned_finished -> date_finished
 * @param {number} workcenterId - ID del centro di lavoro
 * @returns {Promise<Array>} Lista di work orders in stato 'ready'
 */
async function getReadyWorkorders(workcenterId) {
    console.log(`[ODOO] Recupero work orders pronti per workcenter ${workcenterId}...`);
    
    const workorders = await executeKw(
        'mrp.workorder',
        'search_read',
        [[
            ['workcenter_id', '=', workcenterId],
            ['state', '=', 'ready'] // Solo ordini pronti
        ]],
        {
            // Campi compatibili con Odoo 17+
            // Rimuoviamo i campi date problematici per ora
            fields: [
                'id',
                'name',
                'display_name',
                'production_id',    // Ordine di produzione padre
                'product_id',       // Prodotto da realizzare
                'qty_producing',    // Quantità in produzione
                'qty_produced',     // Quantità già prodotta
                'qty_remaining',    // Quantità rimanente
                'state',
                'duration_expected' // Durata prevista in minuti
            ],
            // Ordiniamo solo per ID per evitare errori su campi non esistenti
            order: 'id'
        }
    );

    return workorders;
}

/**
 * Avvia un work order (porta da 'ready' a 'progress')
 * Chiama il metodo button_start di Odoo
 * @param {number} workorderId - ID del work order da avviare
 * @returns {Promise<boolean>} true se avviato con successo
 */
async function startWorkorder(workorderId) {
    console.log(`[ODOO] Avvio work order ${workorderId}...`);
    
    // In Odoo, per avviare un work order si usa button_start
    const result = await executeKw(
        'mrp.workorder',
        'button_start',
        [[workorderId]] // Lista di ID
    );

    console.log(`[ODOO] Work order ${workorderId} avviato`);
    return result;
}

// ===============================================
// === EXPORTS ===================================
// ===============================================
module.exports = {
    testConnection,
    getWorkcenters,
    getReadyWorkorders,
    startWorkorder
};
