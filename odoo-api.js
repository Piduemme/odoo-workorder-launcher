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
                    // Gestisco il caso speciale di "cannot marshal None"
                    // Questo succede quando Odoo ritorna None (es. button_start)
                    // In questo caso l'operazione è andata a buon fine
                    if (error.message && error.message.includes('cannot marshal None')) {
                        console.log(`[ODOO] ${model}.${method} completato (ritorno None)`);
                        resolve(true);
                        return;
                    }
                    
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

// --- Campi standard per i work orders ---
const WORKORDER_FIELDS = [
    'id',
    'name',
    'display_name',
    'production_id',    // Ordine di produzione padre
    'product_id',       // Prodotto da realizzare
    'workcenter_id',    // Centro di lavoro assegnato
    'qty_producing',    // Quantità in produzione
    'qty_produced',     // Quantità già prodotta
    'qty_remaining',    // Quantità rimanente
    'state',
    'duration_expected' // Durata prevista in minuti
];

/**
 * Recupera work orders pronti per un centro di lavoro
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
            ['state', '=', 'ready']
        ]],
        {
            fields: WORKORDER_FIELDS,
            order: 'id'
        }
    );

    return workorders;
}

/**
 * Recupera work orders attivi (in progress) per un centro di lavoro
 * @param {number} workcenterId - ID del centro di lavoro
 * @returns {Promise<Array>} Lista di work orders in stato 'progress'
 */
async function getActiveWorkorders(workcenterId) {
    console.log(`[ODOO] Recupero work orders attivi per workcenter ${workcenterId}...`);
    
    const workorders = await executeKw(
        'mrp.workorder',
        'search_read',
        [[
            ['workcenter_id', '=', workcenterId],
            ['state', '=', 'progress']
        ]],
        {
            fields: WORKORDER_FIELDS,
            order: 'id'
        }
    );

    return workorders;
}

/**
 * Recupera tutti i work orders per un centro di lavoro (ready + progress)
 * @param {number} workcenterId - ID del centro di lavoro
 * @returns {Promise<Object>} Oggetto con { ready: [...], active: [...] }
 */
async function getWorkordersForWorkcenter(workcenterId) {
    console.log(`[ODOO] Recupero tutti i work orders per workcenter ${workcenterId}...`);
    
    const [ready, active] = await Promise.all([
        getReadyWorkorders(workcenterId),
        getActiveWorkorders(workcenterId)
    ]);
    
    return { ready, active };
}

/**
 * Cerca work orders per nome/prodotto (tutti i centri di lavoro)
 * @param {string} searchTerm - Termine di ricerca
 * @param {number} limit - Numero massimo di risultati (default 50)
 * @returns {Promise<Array>} Lista di work orders che matchano la ricerca
 */
async function searchWorkorders(searchTerm, limit = 50) {
    console.log(`[ODOO] Ricerca work orders: "${searchTerm}"...`);
    
    // Cerco nei work orders in stato ready o progress
    // Il termine può essere nel nome del workorder, del prodotto o della produzione
    const workorders = await executeKw(
        'mrp.workorder',
        'search_read',
        [[
            ['state', 'in', ['ready', 'progress']],
            '|', '|',
            ['name', 'ilike', searchTerm],
            ['display_name', 'ilike', searchTerm],
            ['product_id.name', 'ilike', searchTerm]
        ]],
        {
            fields: WORKORDER_FIELDS,
            order: 'state desc, id', // Prima i progress, poi i ready
            limit: limit
        }
    );

    return workorders;
}

/**
 * Recupera lo stato attuale di un work order
 * @param {number} workorderId - ID del work order
 * @returns {Promise<Object>} Work order con stato e workcenter
 */
async function getWorkorderInfo(workorderId) {
    const result = await executeKw(
        'mrp.workorder',
        'search_read',
        [[['id', '=', workorderId]]],
        { fields: ['state', 'workcenter_id'] }
    );
    
    return result.length > 0 ? result[0] : null;
}

/**
 * Cambia il centro di lavoro di un work order
 * @param {number} workorderId - ID del work order
 * @param {number} newWorkcenterId - ID del nuovo centro di lavoro
 * @returns {Promise<boolean>} true se l'operazione è riuscita
 */
async function changeWorkcenter(workorderId, newWorkcenterId) {
    console.log(`[ODOO] Cambio workcenter per work order ${workorderId} -> ${newWorkcenterId}...`);
    
    const result = await executeKw(
        'mrp.workorder',
        'write',
        [[workorderId], { workcenter_id: newWorkcenterId }]
    );
    
    console.log(`[ODOO] Workcenter cambiato per work order ${workorderId}`);
    return result;
}

/**
 * Avvia un work order (porta da 'ready' a 'progress')
 * Se il work order è assegnato a un altro centro, prima lo riassegna
 * 
 * @param {number} workorderId - ID del work order da avviare
 * @param {number} targetWorkcenterId - ID del centro di lavoro target (opzionale)
 * @returns {Promise<Object>} Oggetto con success, newState, workcenterChanged
 */
async function startWorkorder(workorderId, targetWorkcenterId = null) {
    console.log(`[ODOO] Avvio work order ${workorderId}...`);
    
    // Recupero info sul work order
    const workorderInfo = await getWorkorderInfo(workorderId);
    if (!workorderInfo) {
        throw new Error(`Work order ${workorderId} non trovato`);
    }
    
    let workcenterChanged = false;
    const currentWorkcenterId = workorderInfo.workcenter_id ? workorderInfo.workcenter_id[0] : null;
    
    // Se è specificato un target workcenter diverso da quello attuale, cambio
    if (targetWorkcenterId && currentWorkcenterId !== targetWorkcenterId) {
        console.log(`[ODOO] Work order ${workorderId} è su workcenter ${currentWorkcenterId}, cambio a ${targetWorkcenterId}`);
        await changeWorkcenter(workorderId, targetWorkcenterId);
        workcenterChanged = true;
    }
    
    // Salvo lo stato prima dell'operazione
    const stateBefore = workorderInfo.state;
    console.log(`[ODOO] Stato prima: ${stateBefore}`);
    
    // Se è già in progress, non faccio nulla
    if (stateBefore === 'progress') {
        console.log(`[ODOO] Work order ${workorderId} è già in progress`);
        return { success: true, newState: 'progress', workcenterChanged, alreadyStarted: true };
    }
    
    // Chiamo button_start - potrebbe "fallire" con None ma funziona
    try {
        await executeKw(
            'mrp.workorder',
            'button_start',
            [[workorderId]]
        );
    } catch (error) {
        // Se l'errore è "cannot marshal None", ignoriamo
        if (!error.message || !error.message.includes('cannot marshal None')) {
            throw error;
        }
        console.log(`[ODOO] button_start ritorna None (normale)`);
    }
    
    // Verifico lo stato dopo l'operazione
    const updatedInfo = await getWorkorderInfo(workorderId);
    const stateAfter = updatedInfo ? updatedInfo.state : null;
    console.log(`[ODOO] Stato dopo: ${stateAfter}`);
    
    // Verifico che lo stato sia cambiato a 'progress'
    if (stateAfter === 'progress') {
        console.log(`[ODOO] Work order ${workorderId} avviato con successo`);
        return { success: true, newState: stateAfter, workcenterChanged };
    } else if (stateAfter === stateBefore) {
        throw new Error(`Lo stato non è cambiato (rimasto: ${stateAfter})`);
    } else {
        console.log(`[ODOO] Work order ${workorderId} stato cambiato a: ${stateAfter}`);
        return { success: true, newState: stateAfter, workcenterChanged };
    }
}

// ===============================================
// === EXPORTS ===================================
// ===============================================
module.exports = {
    testConnection,
    getWorkcenters,
    getReadyWorkorders,
    getActiveWorkorders,
    getWorkordersForWorkcenter,
    searchWorkorders,
    startWorkorder,
    changeWorkcenter,
    getWorkorderInfo
};
