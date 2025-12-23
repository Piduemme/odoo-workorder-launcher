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
const commonClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/common' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/common' });

const objectClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/object' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/object' });

// --- CACHE UID ---
let cachedUid = null;

// ===============================================
// === FUNZIONI HELPER ===========================
// ===============================================

async function authenticate() {
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

async function executeKw(model, method, args = [], kwargs = {}) {
    const uid = await authenticate();

    return new Promise((resolve, reject) => {
        objectClient.methodCall(
            'execute_kw',
            [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs],
            (error, result) => {
                if (error) {
                    // Gestisco "cannot marshal None" come successo
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

async function testConnection() {
    cachedUid = null;
    return await authenticate();
}

// --- Campi standard per i work orders ---
const WORKORDER_FIELDS = [
    'id',
    'name',
    'display_name',
    'production_id',
    'product_id',
    'workcenter_id',
    'qty_producing',
    'qty_produced',
    'qty_remaining',
    'state',
    'duration_expected',
    'duration',           // Durata effettiva (minuti)
    'date_start',         // Data inizio lavorazione
    'date_finished',      // Data fine lavorazione
];

/**
 * Recupera tutti i centri di lavoro attivi CON conteggio work orders
 */
async function getWorkcenters() {
    console.log('[ODOO] Recupero centri di lavoro...');
    
    const workcenters = await executeKw(
        'mrp.workcenter',
        'search_read',
        [[['active', '=', true]]],
        {
            fields: ['id', 'name', 'code', 'color', 'working_state'],
            order: 'sequence, name'
        }
    );

    // Recupero conteggi per ogni workcenter
    console.log('[ODOO] Calcolo conteggi work orders per workcenter...');
    
    for (const wc of workcenters) {
        // Conta ready
        const readyCount = await executeKw(
            'mrp.workorder',
            'search_count',
            [[['workcenter_id', '=', wc.id], ['state', '=', 'ready']]]
        );
        
        // Conta progress
        const progressCount = await executeKw(
            'mrp.workorder',
            'search_count',
            [[['workcenter_id', '=', wc.id], ['state', '=', 'progress']]]
        );
        
        wc.ready_count = readyCount;
        wc.progress_count = progressCount;
    }

    return workcenters;
}

/**
 * Recupera TUTTI i work orders pronti
 */
async function getAllReadyWorkorders() {
    console.log(`[ODOO] Recupero TUTTI i work orders pronti...`);
    
    const workorders = await executeKw(
        'mrp.workorder',
        'search_read',
        [[['state', '=', 'ready']]],
        {
            fields: WORKORDER_FIELDS,
            order: 'workcenter_id, id'
        }
    );

    return workorders;
}

/**
 * Recupera TUTTI i work orders attivi
 */
async function getAllActiveWorkorders() {
    console.log(`[ODOO] Recupero TUTTI i work orders attivi...`);
    
    const workorders = await executeKw(
        'mrp.workorder',
        'search_read',
        [[['state', '=', 'progress']]],
        {
            fields: WORKORDER_FIELDS,
            order: 'workcenter_id, id'
        }
    );

    return workorders;
}

/**
 * Recupera TUTTI i work orders (ready + progress)
 */
async function getAllWorkorders() {
    console.log(`[ODOO] Recupero TUTTI i work orders...`);
    
    const [ready, active] = await Promise.all([
        getAllReadyWorkorders(),
        getAllActiveWorkorders()
    ]);
    
    console.log(`[ODOO] Trovati ${ready.length} pronti, ${active.length} attivi (totale)`);
    
    return { ready, active };
}

/**
 * Cerca work orders per nome/prodotto
 */
async function searchWorkorders(searchTerm, limit = 50) {
    console.log(`[ODOO] Ricerca work orders: "${searchTerm}"...`);
    
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
            order: 'state desc, id',
            limit: limit
        }
    );

    return workorders;
}

/**
 * Recupera dettagli completi di un work order
 */
async function getWorkorderDetails(workorderId) {
    console.log(`[ODOO] Recupero dettagli work order ${workorderId}...`);
    
    const result = await executeKw(
        'mrp.workorder',
        'search_read',
        [[['id', '=', workorderId]]],
        { 
            fields: [
                ...WORKORDER_FIELDS,
                'production_id',
                'qty_production',
                'company_id',
                'worksheet_type',
                'worksheet',
                'operation_note'
            ]
        }
    );
    
    return result.length > 0 ? result[0] : null;
}

/**
 * Recupera info base di un work order
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
 * Avvia un work order (ready -> progress)
 */
async function startWorkorder(workorderId, targetWorkcenterId = null) {
    console.log(`[ODOO] Avvio work order ${workorderId}...`);
    
    const workorderInfo = await getWorkorderInfo(workorderId);
    if (!workorderInfo) {
        throw new Error(`Work order ${workorderId} non trovato`);
    }
    
    let workcenterChanged = false;
    const currentWorkcenterId = workorderInfo.workcenter_id ? workorderInfo.workcenter_id[0] : null;
    
    // Cambio workcenter se necessario
    if (targetWorkcenterId && currentWorkcenterId !== targetWorkcenterId) {
        console.log(`[ODOO] Work order ${workorderId} è su workcenter ${currentWorkcenterId}, cambio a ${targetWorkcenterId}`);
        await changeWorkcenter(workorderId, targetWorkcenterId);
        workcenterChanged = true;
    }
    
    const stateBefore = workorderInfo.state;
    console.log(`[ODOO] Stato prima: ${stateBefore}`);
    
    if (stateBefore === 'progress') {
        console.log(`[ODOO] Work order ${workorderId} è già in progress`);
        return { success: true, newState: 'progress', workcenterChanged, alreadyStarted: true };
    }
    
    // Chiamo button_start
    try {
        await executeKw('mrp.workorder', 'button_start', [[workorderId]]);
    } catch (error) {
        if (!error.message || !error.message.includes('cannot marshal None')) {
            throw error;
        }
    }
    
    // Verifico stato dopo
    const updatedInfo = await getWorkorderInfo(workorderId);
    const stateAfter = updatedInfo ? updatedInfo.state : null;
    console.log(`[ODOO] Stato dopo: ${stateAfter}`);
    
    if (stateAfter === 'progress') {
        console.log(`[ODOO] Work order ${workorderId} avviato con successo`);
        return { success: true, newState: stateAfter, workcenterChanged };
    } else if (stateAfter === stateBefore) {
        throw new Error(`Lo stato non è cambiato (rimasto: ${stateAfter})`);
    } else {
        return { success: true, newState: stateAfter, workcenterChanged };
    }
}

/**
 * Mette in pausa un work order (progress -> pending)
 */
async function pauseWorkorder(workorderId) {
    console.log(`[ODOO] Pausa work order ${workorderId}...`);
    
    const workorderInfo = await getWorkorderInfo(workorderId);
    if (!workorderInfo) {
        throw new Error(`Work order ${workorderId} non trovato`);
    }
    
    if (workorderInfo.state !== 'progress') {
        throw new Error(`Work order non è in progress (stato: ${workorderInfo.state})`);
    }
    
    // button_pending mette in pausa
    try {
        await executeKw('mrp.workorder', 'button_pending', [[workorderId]]);
    } catch (error) {
        if (!error.message || !error.message.includes('cannot marshal None')) {
            throw error;
        }
    }
    
    const updatedInfo = await getWorkorderInfo(workorderId);
    console.log(`[ODOO] Work order ${workorderId} stato dopo pausa: ${updatedInfo?.state}`);
    
    return { success: true, newState: updatedInfo?.state || 'pending' };
}

/**
 * Completa un work order (progress -> done)
 */
async function completeWorkorder(workorderId) {
    console.log(`[ODOO] Completamento work order ${workorderId}...`);
    
    const workorderInfo = await getWorkorderInfo(workorderId);
    if (!workorderInfo) {
        throw new Error(`Work order ${workorderId} non trovato`);
    }
    
    if (workorderInfo.state !== 'progress') {
        throw new Error(`Work order non è in progress (stato: ${workorderInfo.state})`);
    }
    
    // button_finish completa il work order
    try {
        await executeKw('mrp.workorder', 'button_finish', [[workorderId]]);
    } catch (error) {
        if (!error.message || !error.message.includes('cannot marshal None')) {
            throw error;
        }
    }
    
    const updatedInfo = await getWorkorderInfo(workorderId);
    console.log(`[ODOO] Work order ${workorderId} stato dopo completamento: ${updatedInfo?.state}`);
    
    return { success: true, newState: updatedInfo?.state || 'done' };
}

/**
 * Recupera log/storico delle azioni (time tracking)
 */
async function getWorkorderTimeTracking(workorderId) {
    console.log(`[ODOO] Recupero time tracking per work order ${workorderId}...`);
    
    // mrp.workcenter.productivity traccia i tempi
    const timeLogs = await executeKw(
        'mrp.workcenter.productivity',
        'search_read',
        [[['workorder_id', '=', workorderId]]],
        {
            fields: ['date_start', 'date_end', 'duration', 'user_id', 'loss_id', 'description'],
            order: 'date_start desc'
        }
    );
    
    return timeLogs;
}

// ===============================================
// === EXPORTS ===================================
// ===============================================
module.exports = {
    testConnection,
    getWorkcenters,
    getAllReadyWorkorders,
    getAllActiveWorkorders,
    getAllWorkorders,
    searchWorkorders,
    getWorkorderDetails,
    getWorkorderInfo,
    startWorkorder,
    pauseWorkorder,
    completeWorkorder,
    changeWorkcenter,
    getWorkorderTimeTracking
};
