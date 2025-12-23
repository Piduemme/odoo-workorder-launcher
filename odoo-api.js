// ===============================================
// === ODOO-API.JS - CONNESSIONE ODOO v2.1 =======
// ===============================================
// Aggiunto supporto per tag/machine_type e filtro
// operazioni compatibili

const xmlrpc = require('xmlrpc');
require('dotenv').config();

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

const urlParts = new URL(ODOO_URL);
const isSecure = urlParts.protocol === 'https:';
const host = urlParts.hostname;
const port = urlParts.port || (isSecure ? 443 : 80);

const commonClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/common' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/common' });

const objectClient = isSecure
    ? xmlrpc.createSecureClient({ host, port, path: '/xmlrpc/2/object' })
    : xmlrpc.createClient({ host, port, path: '/xmlrpc/2/object' });

let cachedUid = null;

// ===============================================
// === HELPER FUNCTIONS ==========================
// ===============================================

async function authenticate() {
    if (cachedUid) return cachedUid;

    return new Promise((resolve, reject) => {
        console.log('[ODOO] Autenticazione...');
        commonClient.methodCall('authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}], (err, uid) => {
            if (err) {
                console.error('[ODOO] Errore auth:', err.message);
                reject(new Error(`Auth fallita: ${err.message}`));
                return;
            }
            if (!uid) {
                reject(new Error('Auth fallita: credenziali non valide'));
                return;
            }
            console.log(`[ODOO] UID: ${uid}`);
            cachedUid = uid;
            resolve(uid);
        });
    });
}

async function executeKw(model, method, args = [], kwargs = {}) {
    const uid = await authenticate();
    return new Promise((resolve, reject) => {
        objectClient.methodCall('execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs], (err, result) => {
            if (err) {
                if (err.message && err.message.includes('cannot marshal None')) {
                    resolve(true);
                    return;
                }
                console.error(`[ODOO] Errore ${model}.${method}:`, err.message);
                reject(err);
                return;
            }
            resolve(result);
        });
    });
}

// ===============================================
// === PUBLIC FUNCTIONS ==========================
// ===============================================

async function testConnection() {
    cachedUid = null;
    return await authenticate();
}

// Campi work order con operation_id per capire il tipo
const WORKORDER_FIELDS = [
    'id', 'name', 'display_name', 'production_id', 'product_id',
    'workcenter_id', 'qty_producing', 'qty_produced', 'qty_remaining',
    'state', 'duration_expected', 'duration', 'date_start', 'date_finished',
    'operation_id'  // <-- Questo ci dice se è Estrusione/Saldatura/Stampa
];

/**
 * Recupera i tag disponibili (Estrusione, Saldatura, Stampa)
 */
async function getWorkcenterTags() {
    console.log('[ODOO] Recupero tag workcenter...');
    const tags = await executeKw('mrp.workcenter.tag', 'search_read', [[]], {
        fields: ['id', 'name', 'color']
    });
    return tags;
}

/**
 * Recupera i machine types disponibili
 */
async function getMachineTypes() {
    console.log('[ODOO] Recupero machine types...');
    try {
        const types = await executeKw('machine.type', 'search_read', [[]], {
            fields: ['id', 'name']
        });
        return types;
    } catch (e) {
        console.log('[ODOO] Modello machine.type non disponibile');
        return [];
    }
}

/**
 * Recupera tutti i centri di lavoro con tag e machine_type
 */
async function getWorkcenters() {
    console.log('[ODOO] Recupero centri di lavoro...');
    
    const workcenters = await executeKw('mrp.workcenter', 'search_read', 
        [[['active', '=', true]]], 
        {
            fields: ['id', 'name', 'code', 'color', 'working_state', 'tag_ids', 'machine_type_id'],
            order: 'sequence, name'
        }
    );

    // Recupero i tag per avere i nomi
    const tags = await getWorkcenterTags();
    const tagMap = {};
    tags.forEach(t => tagMap[t.id] = t);

    // Arricchisco i workcenter con info tag
    for (const wc of workcenters) {
        // Conta work orders
        const readyCount = await executeKw('mrp.workorder', 'search_count', 
            [[['workcenter_id', '=', wc.id], ['state', '=', 'ready']]]
        );
        const progressCount = await executeKw('mrp.workorder', 'search_count', 
            [[['workcenter_id', '=', wc.id], ['state', '=', 'progress']]]
        );
        
        wc.ready_count = readyCount;
        wc.progress_count = progressCount;
        
        // Info sui tag
        wc.tags = (wc.tag_ids || []).map(tid => tagMap[tid]).filter(Boolean);
        wc.tag_names = wc.tags.map(t => t.name);
        
        // Machine type name
        wc.machine_type_name = wc.machine_type_id ? wc.machine_type_id[1] : null;
        
        // Tipo principale (per filtro) - uso machine_type o primo tag
        wc.operation_type = wc.machine_type_name || (wc.tag_names[0] || null);
    }

    return workcenters;
}

/**
 * Recupera TUTTI i work orders con info operazione
 */
async function getAllWorkorders() {
    console.log('[ODOO] Recupero TUTTI i work orders...');
    
    const [ready, active] = await Promise.all([
        executeKw('mrp.workorder', 'search_read', [[['state', '=', 'ready']]], {
            fields: WORKORDER_FIELDS,
            order: 'workcenter_id, id'
        }),
        executeKw('mrp.workorder', 'search_read', [[['state', '=', 'progress']]], {
            fields: WORKORDER_FIELDS,
            order: 'workcenter_id, id'
        })
    ]);
    
    // Arricchisco con operation_type
    const enrichWorkorder = (wo) => {
        // operation_id è [id, "Nome Operazione"] es. [123, "Estrusione"]
        wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
        wo.operation_name = wo.operation_type; // alias
        return wo;
    };
    
    ready.forEach(enrichWorkorder);
    active.forEach(enrichWorkorder);
    
    console.log(`[ODOO] Trovati ${ready.length} pronti, ${active.length} attivi`);
    
    return { ready, active };
}

/**
 * Cerca work orders
 */
async function searchWorkorders(searchTerm, limit = 50) {
    console.log(`[ODOO] Ricerca: "${searchTerm}"...`);
    
    const workorders = await executeKw('mrp.workorder', 'search_read', [[
        ['state', 'in', ['ready', 'progress']],
        '|', '|',
        ['name', 'ilike', searchTerm],
        ['display_name', 'ilike', searchTerm],
        ['product_id.name', 'ilike', searchTerm]
    ]], {
        fields: WORKORDER_FIELDS,
        order: 'state desc, id',
        limit
    });

    workorders.forEach(wo => {
        wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
    });

    return workorders;
}

/**
 * Dettagli work order
 */
async function getWorkorderDetails(workorderId) {
    console.log(`[ODOO] Dettagli WO ${workorderId}...`);
    
    const result = await executeKw('mrp.workorder', 'search_read', 
        [[['id', '=', workorderId]]], 
        { fields: [...WORKORDER_FIELDS, 'production_id', 'qty_production', 'operation_note'] }
    );
    
    if (result.length > 0) {
        const wo = result[0];
        wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
        return wo;
    }
    return null;
}

/**
 * Info base work order
 */
async function getWorkorderInfo(workorderId) {
    const result = await executeKw('mrp.workorder', 'search_read', 
        [[['id', '=', workorderId]]], 
        { fields: ['state', 'workcenter_id', 'operation_id'] }
    );
    
    if (result.length > 0) {
        const wo = result[0];
        wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
        return wo;
    }
    return null;
}

/**
 * Cambia workcenter
 */
async function changeWorkcenter(workorderId, newWorkcenterId) {
    console.log(`[ODOO] Cambio WC ${workorderId} -> ${newWorkcenterId}...`);
    await executeKw('mrp.workorder', 'write', [[workorderId], { workcenter_id: newWorkcenterId }]);
    return true;
}

/**
 * Avvia work order
 */
async function startWorkorder(workorderId, targetWorkcenterId = null) {
    console.log(`[ODOO] Avvio WO ${workorderId}...`);
    
    const info = await getWorkorderInfo(workorderId);
    if (!info) throw new Error(`WO ${workorderId} non trovato`);
    
    let workcenterChanged = false;
    const currentWcId = info.workcenter_id ? info.workcenter_id[0] : null;
    
    if (targetWorkcenterId && currentWcId !== targetWorkcenterId) {
        await changeWorkcenter(workorderId, targetWorkcenterId);
        workcenterChanged = true;
    }
    
    if (info.state === 'progress') {
        return { success: true, newState: 'progress', workcenterChanged, alreadyStarted: true };
    }
    
    try {
        await executeKw('mrp.workorder', 'button_start', [[workorderId]]);
    } catch (e) {
        if (!e.message?.includes('cannot marshal None')) throw e;
    }
    
    const updated = await getWorkorderInfo(workorderId);
    return { success: true, newState: updated?.state || 'progress', workcenterChanged };
}

/**
 * Pausa work order
 */
async function pauseWorkorder(workorderId) {
    console.log(`[ODOO] Pausa WO ${workorderId}...`);
    
    const info = await getWorkorderInfo(workorderId);
    if (!info) throw new Error(`WO ${workorderId} non trovato`);
    if (info.state !== 'progress') throw new Error(`WO non in progress (${info.state})`);
    
    try {
        await executeKw('mrp.workorder', 'button_pending', [[workorderId]]);
    } catch (e) {
        if (!e.message?.includes('cannot marshal None')) throw e;
    }
    
    const updated = await getWorkorderInfo(workorderId);
    return { success: true, newState: updated?.state || 'pending' };
}

/**
 * Completa work order
 */
async function completeWorkorder(workorderId) {
    console.log(`[ODOO] Completa WO ${workorderId}...`);
    
    const info = await getWorkorderInfo(workorderId);
    if (!info) throw new Error(`WO ${workorderId} non trovato`);
    if (info.state !== 'progress') throw new Error(`WO non in progress (${info.state})`);
    
    try {
        await executeKw('mrp.workorder', 'button_finish', [[workorderId]]);
    } catch (e) {
        if (!e.message?.includes('cannot marshal None')) throw e;
    }
    
    const updated = await getWorkorderInfo(workorderId);
    return { success: true, newState: updated?.state || 'done' };
}

/**
 * Time tracking
 */
async function getWorkorderTimeTracking(workorderId) {
    console.log(`[ODOO] Time tracking WO ${workorderId}...`);
    
    const logs = await executeKw('mrp.workcenter.productivity', 'search_read', 
        [[['workorder_id', '=', workorderId]]], 
        {
            fields: ['date_start', 'date_end', 'duration', 'user_id', 'loss_id', 'description'],
            order: 'date_start desc'
        }
    );
    
    return logs;
}

// ===============================================
// === EXPORTS ===================================
// ===============================================
module.exports = {
    testConnection,
    getWorkcenters,
    getWorkcenterTags,
    getMachineTypes,
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
