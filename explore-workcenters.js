// Script per esplorare i campi dei workcenter e le operazioni in Odoo
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

async function authenticate() {
    return new Promise((resolve, reject) => {
        commonClient.methodCall('authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}], (err, uid) => {
            if (err) reject(err);
            else resolve(uid);
        });
    });
}

async function executeKw(uid, model, method, args = [], kwargs = {}) {
    return new Promise((resolve, reject) => {
        objectClient.methodCall('execute_kw', [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs], (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

async function main() {
    try {
        console.log('Connessione a Odoo...');
        const uid = await authenticate();
        console.log('UID:', uid);
        
        // 1. Leggo i campi disponibili su mrp.workcenter
        console.log('\n=== CAMPI mrp.workcenter ===');
        const wcFields = await executeKw(uid, 'mrp.workcenter', 'fields_get', [], { attributes: ['string', 'type', 'relation'] });
        const relevantWcFields = Object.entries(wcFields)
            .filter(([name, info]) => 
                name.includes('operation') || 
                name.includes('type') || 
                name.includes('tag') ||
                name.includes('capab') ||
                name.includes('alternative') ||
                info.relation?.includes('routing')
            );
        console.log('Campi rilevanti:');
        relevantWcFields.forEach(([name, info]) => {
            console.log(`  - ${name}: ${info.string} (${info.type}${info.relation ? ' -> ' + info.relation : ''})`);
        });
        
        // 2. Leggo tutti i workcenter con tutti i campi
        console.log('\n=== WORKCENTERS COMPLETI ===');
        const workcenters = await executeKw(uid, 'mrp.workcenter', 'search_read', [[['active', '=', true]]], {});
        workcenters.slice(0, 3).forEach(wc => {
            console.log(`\n--- ${wc.name} (ID: ${wc.id}) ---`);
            Object.entries(wc).forEach(([key, value]) => {
                if (value !== false && value !== null && value !== '' && !key.startsWith('__')) {
                    console.log(`  ${key}: ${JSON.stringify(value)}`);
                }
            });
        });
        
        // 3. Cerco se esiste mrp.routing.workcenter (operazioni)
        console.log('\n=== CAMPI mrp.routing.workcenter (operazioni) ===');
        try {
            const opFields = await executeKw(uid, 'mrp.routing.workcenter', 'fields_get', [], { attributes: ['string', 'type', 'relation'] });
            console.log('Campi operazione:');
            Object.entries(opFields).forEach(([name, info]) => {
                if (name.includes('workcenter') || name.includes('name') || name.includes('type')) {
                    console.log(`  - ${name}: ${info.string} (${info.type}${info.relation ? ' -> ' + info.relation : ''})`);
                }
            });
            
            // Leggo alcune operazioni
            console.log('\n=== OPERAZIONI (prime 10) ===');
            const operations = await executeKw(uid, 'mrp.routing.workcenter', 'search_read', [[]], { limit: 10 });
            operations.forEach(op => {
                console.log(`  - ${op.name}: workcenter=${op.workcenter_id?.[1] || 'N/A'}`);
            });
        } catch (e) {
            console.log('Errore lettura operazioni:', e.message);
        }
        
        // 4. Verifico se ci sono tag sui workcenter
        console.log('\n=== VERIFICA TAG/CATEGORIE ===');
        try {
            const tagFields = await executeKw(uid, 'mrp.workcenter.tag', 'fields_get', [], {});
            console.log('Modello mrp.workcenter.tag esiste!');
            const tags = await executeKw(uid, 'mrp.workcenter.tag', 'search_read', [[]], {});
            console.log('Tags:', tags);
        } catch (e) {
            console.log('Modello mrp.workcenter.tag non esiste');
        }
        
        // 5. Verifico workcenter alternativi
        console.log('\n=== WORKCENTER ALTERNATIVI ===');
        const wcWithAlternative = await executeKw(uid, 'mrp.workcenter', 'search_read', 
            [[['active', '=', true]]], 
            { fields: ['name', 'alternative_workcenter_ids'] }
        );
        wcWithAlternative.forEach(wc => {
            if (wc.alternative_workcenter_ids && wc.alternative_workcenter_ids.length > 0) {
                console.log(`  ${wc.name} -> alternative: ${wc.alternative_workcenter_ids}`);
            }
        });
        
        // 6. Leggo i work orders per vedere operation_id
        console.log('\n=== WORK ORDERS CON OPERAZIONE ===');
        const workorders = await executeKw(uid, 'mrp.workorder', 'search_read', 
            [[['state', 'in', ['ready', 'progress']]]], 
            { fields: ['name', 'workcenter_id', 'operation_id'], limit: 10 }
        );
        workorders.forEach(wo => {
            console.log(`  ${wo.name}: workcenter=${wo.workcenter_id?.[1]}, operation=${wo.operation_id?.[1] || 'N/A'}`);
        });
        
    } catch (error) {
        console.error('Errore:', error);
    }
}

main();
