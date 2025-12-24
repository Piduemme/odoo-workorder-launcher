// ===============================================
// === ODOO-API.JS - CONNESSIONE ODOO v2.2 =======
// ===============================================
// FIX: Gestione errori robusta, timeout, retry,
// invalidazione cache sessione

const xmlrpc = require("xmlrpc");
require("dotenv").config();

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

// ===============================================
// === CONFIGURAZIONE ============================
// ===============================================

const CONFIG = {
  // Timeout per le chiamate XML-RPC (ms)
  REQUEST_TIMEOUT: 30000,

  // Durata cache sessione (ms) - 1 ora
  SESSION_CACHE_TTL: 60 * 60 * 1000,

  // Retry automatici su errori di rete
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // ms, raddoppia ad ogni retry

  // Errori che triggerano un retry
  RETRYABLE_ERRORS: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "socket hang up",
  ],
};

// ===============================================
// === CLIENT SETUP ==============================
// ===============================================

const urlParts = new URL(ODOO_URL);
const isSecure = urlParts.protocol === "https:";
const host = urlParts.hostname;
const port = urlParts.port || (isSecure ? 443 : 80);

// Factory per creare client con timeout
function createClient(path) {
  const options = {
    host,
    port,
    path,
    timeout: CONFIG.REQUEST_TIMEOUT,
  };
  return isSecure
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);
}

// ===============================================
// === SESSION CACHE CON TTL =====================
// ===============================================

let sessionCache = {
  uid: null,
  timestamp: 0,
};

/**
 * Verifica se la sessione cachata è ancora valida
 */
function isSessionValid() {
  if (!sessionCache.uid) return false;
  const age = Date.now() - sessionCache.timestamp;
  return age < CONFIG.SESSION_CACHE_TTL;
}

/**
 * Invalida la sessione (forza re-auth al prossimo call)
 */
function invalidateSession() {
  console.log("[ODOO] Sessione invalidata");
  sessionCache = { uid: null, timestamp: 0 };
}

// ===============================================
// === RETRY LOGIC ===============================
// ===============================================

/**
 * Verifica se un errore è recuperabile con retry
 */
function isRetryableError(error) {
  if (!error) return false;
  const msg = error.message || error.code || "";
  return CONFIG.RETRYABLE_ERRORS.some((e) => msg.includes(e));
}

/**
 * Sleep helper per retry delay
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Esegue una funzione con retry automatico
 */
async function withRetry(fn, context = "operation") {
  let lastError;

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Se è un errore di sessione, invalida e riprova
      if (
        error.message?.includes("Session expired") ||
        error.message?.includes("Access Denied") ||
        error.faultCode === 3
      ) {
        console.log(`[ODOO] Sessione scaduta, re-auth...`);
        invalidateSession();
      }

      // Se non è un errore recuperabile, non ritentare
      if (!isRetryableError(error) && attempt > 1) {
        break;
      }

      if (attempt < CONFIG.MAX_RETRIES) {
        const delay = CONFIG.RETRY_DELAY * Math.pow(2, attempt - 1);
        console.log(
          `[ODOO] ${context} fallito (tentativo ${attempt}/${CONFIG.MAX_RETRIES}), retry in ${delay}ms...`,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ===============================================
// === XMLRPC CON TIMEOUT ========================
// ===============================================

/**
 * Chiamata XML-RPC con timeout e gestione errori
 */
function xmlrpcCall(client, method, params) {
  return new Promise((resolve, reject) => {
    // Timeout manuale (backup se il client non lo rispetta)
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout dopo ${CONFIG.REQUEST_TIMEOUT}ms`));
    }, CONFIG.REQUEST_TIMEOUT + 5000);

    client.methodCall(method, params, (err, result) => {
      clearTimeout(timeoutId);

      if (err) {
        // Normalizza errori XML-RPC
        const error = new Error(
          err.faultString || err.message || "Errore XML-RPC",
        );
        error.faultCode = err.faultCode;
        error.code = err.code;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

// ===============================================
// === AUTHENTICATION ============================
// ===============================================

async function authenticate() {
  // Usa cache se valida
  if (isSessionValid()) {
    return sessionCache.uid;
  }

  console.log("[ODOO] Autenticazione...");
  const client = createClient("/xmlrpc/2/common");

  const uid = await xmlrpcCall(client, "authenticate", [
    ODOO_DB,
    ODOO_USER,
    ODOO_API_KEY,
    {},
  ]);

  if (!uid) {
    throw new Error("Autenticazione fallita: credenziali non valide");
  }

  // Salva in cache con timestamp
  sessionCache = {
    uid,
    timestamp: Date.now(),
  };

  console.log(`[ODOO] Autenticato, UID: ${uid}`);
  return uid;
}

// ===============================================
// === EXECUTE_KW ================================
// ===============================================

async function executeKw(model, method, args = [], kwargs = {}) {
  return withRetry(async () => {
    const uid = await authenticate();
    const client = createClient("/xmlrpc/2/object");

    const result = await xmlrpcCall(client, "execute_kw", [
      ODOO_DB,
      uid,
      ODOO_API_KEY,
      model,
      method,
      args,
      kwargs,
    ]);

    return result;
  }, `${model}.${method}`);
}

// ===============================================
// === PUBLIC FUNCTIONS ==========================
// ===============================================

async function testConnection() {
  invalidateSession(); // Forza nuova auth per test
  return await authenticate();
}

const WORKORDER_FIELDS = [
  "id",
  "name",
  "display_name",
  "production_id",
  "product_id",
  "workcenter_id",
  "qty_producing",
  "qty_produced",
  "qty_remaining",
  "state",
  "duration_expected",
  "duration",
  "date_start",
  "date_finished",
  "operation_id",
];

async function getWorkcenterTags() {
  console.log("[ODOO] Recupero tag workcenter...");
  const tags = await executeKw("mrp.workcenter.tag", "search_read", [[]], {
    fields: ["id", "name", "color"],
  });
  return tags;
}

async function getMachineTypes() {
  console.log("[ODOO] Recupero machine types...");
  try {
    const types = await executeKw("machine.type", "search_read", [[]], {
      fields: ["id", "name"],
    });
    return types;
  } catch (e) {
    console.log("[ODOO] Modello machine.type non disponibile");
    return [];
  }
}

async function getWorkcenters() {
  console.log("[ODOO] Recupero centri di lavoro...");

  const workcenters = await executeKw(
    "mrp.workcenter",
    "search_read",
    [[["active", "=", true]]],
    {
      fields: [
        "id",
        "name",
        "code",
        "color",
        "working_state",
        "tag_ids",
        "machine_type_id",
      ],
      order: "sequence, name",
    },
  );

  const tags = await getWorkcenterTags();
  const tagMap = {};
  tags.forEach((t) => (tagMap[t.id] = t));

  for (const wc of workcenters) {
    const readyCount = await executeKw("mrp.workorder", "search_count", [
      [
        ["workcenter_id", "=", wc.id],
        ["state", "=", "ready"],
      ],
    ]);
    const progressCount = await executeKw("mrp.workorder", "search_count", [
      [
        ["workcenter_id", "=", wc.id],
        ["state", "=", "progress"],
      ],
    ]);

    wc.ready_count = readyCount;
    wc.progress_count = progressCount;
    wc.tags = (wc.tag_ids || []).map((tid) => tagMap[tid]).filter(Boolean);
    wc.tag_names = wc.tags.map((t) => t.name);
    wc.machine_type_name = wc.machine_type_id ? wc.machine_type_id[1] : null;
    wc.operation_type = wc.machine_type_name || wc.tag_names[0] || null;
  }

  return workcenters;
}

async function getAllWorkorders() {
  console.log("[ODOO] Recupero TUTTI i work orders...");

  const [ready, active] = await Promise.all([
    executeKw("mrp.workorder", "search_read", [[["state", "=", "ready"]]], {
      fields: WORKORDER_FIELDS,
      order: "workcenter_id, id",
    }),
    executeKw("mrp.workorder", "search_read", [[["state", "=", "progress"]]], {
      fields: WORKORDER_FIELDS,
      order: "workcenter_id, id",
    }),
  ]);

  const enrichWorkorder = (wo) => {
    wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
    wo.operation_name = wo.operation_type;
    return wo;
  };

  ready.forEach(enrichWorkorder);
  active.forEach(enrichWorkorder);

  console.log(`[ODOO] Trovati ${ready.length} pronti, ${active.length} attivi`);

  return { ready, active };
}

async function searchWorkorders(searchTerm, limit = 100) {
  console.log(`[ODOO] Ricerca: "${searchTerm}"...`);

  // NOTA: display_name è un campo computed e ilike NON funziona bene su di esso!
  // Il display_name è formato come "WH/MO/00127 - Estrusione"
  // ma il campo 'name' contiene solo "Estrusione"
  // Dobbiamo cercare su production_id.name per trovare "WH/MO/00127"
  const workorders = await executeKw(
    "mrp.workorder",
    "search_read",
    [
      [
        ["state", "in", ["ready", "progress"]],
        "|",
        "|",
        "|",
        ["production_id.name", "ilike", searchTerm], // WH/MO/00127
        ["name", "ilike", searchTerm], // Estrusione, Saldatura
        ["product_id.name", "ilike", searchTerm], // Nome prodotto
        ["product_id.default_code", "ilike", searchTerm], // Codice prodotto es. [SL_1234]
      ],
    ],
    {
      fields: WORKORDER_FIELDS,
      order: "state desc, production_id",
      limit,
    },
  );

  workorders.forEach((wo) => {
    wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
  });

  console.log(
    `[ODOO] Trovati ${workorders.length} risultati per "${searchTerm}"`,
  );
  return workorders;
}

async function getWorkorderDetails(workorderId) {
  console.log(`[ODOO] Dettagli WO ${workorderId}...`);

  const result = await executeKw(
    "mrp.workorder",
    "search_read",
    [[["id", "=", workorderId]]],
    {
      fields: [
        ...WORKORDER_FIELDS,
        "production_id",
        "qty_production",
        "operation_note",
      ],
    },
  );

  if (result.length > 0) {
    const wo = result[0];
    wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
    return wo;
  }
  return null;
}

async function getWorkorderInfo(workorderId) {
  const result = await executeKw(
    "mrp.workorder",
    "search_read",
    [[["id", "=", workorderId]]],
    { fields: ["state", "workcenter_id", "operation_id"] },
  );

  if (result.length > 0) {
    const wo = result[0];
    wo.operation_type = wo.operation_id ? wo.operation_id[1] : null;
    return wo;
  }
  return null;
}

async function changeWorkcenter(workorderId, newWorkcenterId) {
  console.log(`[ODOO] Cambio WC ${workorderId} -> ${newWorkcenterId}...`);
  await executeKw("mrp.workorder", "write", [
    [workorderId],
    { workcenter_id: newWorkcenterId },
  ]);
  return true;
}

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

  if (info.state === "progress") {
    return {
      success: true,
      newState: "progress",
      workcenterChanged,
      alreadyStarted: true,
    };
  }

  try {
    await executeKw("mrp.workorder", "button_start", [[workorderId]]);
  } catch (e) {
    if (!e.message?.includes("cannot marshal None")) throw e;
  }

  const updated = await getWorkorderInfo(workorderId);
  return {
    success: true,
    newState: updated?.state || "progress",
    workcenterChanged,
  };
}

async function pauseWorkorder(workorderId) {
  console.log(`[ODOO] Pausa WO ${workorderId}...`);

  const info = await getWorkorderInfo(workorderId);
  if (!info) throw new Error(`WO ${workorderId} non trovato`);
  if (info.state !== "progress")
    throw new Error(`WO non in progress (${info.state})`);

  try {
    await executeKw("mrp.workorder", "button_pending", [[workorderId]]);
  } catch (e) {
    if (!e.message?.includes("cannot marshal None")) throw e;
  }

  const updated = await getWorkorderInfo(workorderId);
  return { success: true, newState: updated?.state || "pending" };
}

async function completeWorkorder(workorderId) {
  console.log(`[ODOO] Completa WO ${workorderId}...`);

  const info = await getWorkorderInfo(workorderId);
  if (!info) throw new Error(`WO ${workorderId} non trovato`);
  if (info.state !== "progress")
    throw new Error(`WO non in progress (${info.state})`);

  try {
    await executeKw("mrp.workorder", "button_finish", [[workorderId]]);
  } catch (e) {
    if (!e.message?.includes("cannot marshal None")) throw e;
  }

  const updated = await getWorkorderInfo(workorderId);
  return { success: true, newState: updated?.state || "done" };
}

async function getWorkorderTimeTracking(workorderId) {
  console.log(`[ODOO] Time tracking WO ${workorderId}...`);

  const logs = await executeKw(
    "mrp.workcenter.productivity",
    "search_read",
    [[["workorder_id", "=", workorderId]]],
    {
      fields: [
        "date_start",
        "date_end",
        "duration",
        "user_id",
        "loss_id",
        "description",
      ],
      order: "date_start desc",
    },
  );

  return logs;
}

// ===============================================
// === SCHEDE TECNICHE (SPECS) ===================
// ===============================================

/**
 * Recupera le specifiche tecniche di un prodotto
 */
async function getProductSpecs(productId) {
  console.log(`[ODOO] Recupero specifiche prodotto ${productId}...`);

  const specs = await executeKw(
    "machine.type.product",
    "search_read",
    [[["product_id", "=", productId]]],
    {
      fields: ["id", "machine_type_id", "product_id", "key_id", "value"],
      order: "id asc",
    },
  );

  // Arricchisci con nomi leggibili
  return specs.map((s) => ({
    id: s.id,
    machine_type_id: s.machine_type_id ? s.machine_type_id[0] : null,
    machine_type_name: s.machine_type_id ? s.machine_type_id[1] : "",
    product_id: s.product_id ? s.product_id[0] : null,
    key_id: s.key_id ? s.key_id[0] : null,
    key_name: s.key_id ? s.key_id[1] : "",
    value: s.value || "",
  }));
}

/**
 * Aggiorna il valore di una specifica tecnica
 */
async function updateProductSpec(specId, value) {
  console.log(`[ODOO] Aggiorno specifica ${specId}...`);
  await executeKw("machine.type.product", "write", [[specId], { value }]);
  return true;
}

/**
 * Crea una nuova specifica tecnica
 */
async function createProductSpec(data) {
  console.log(`[ODOO] Creo specifica per prodotto ${data.product_id}...`);
  const id = await executeKw("machine.type.product", "create", [
    {
      machine_type_id: data.machine_type_id,
      product_id: data.product_id,
      key_id: data.key_id,
      value: data.value || "",
    },
  ]);
  return id;
}

/**
 * Elimina una specifica tecnica
 */
async function deleteProductSpec(specId) {
  console.log(`[ODOO] Elimino specifica ${specId}...`);
  await executeKw("machine.type.product", "unlink", [[specId]]);
  return true;
}

/**
 * Recupera tutte le chiavi disponibili per le specifiche
 */
async function getAllSpecKeys() {
  console.log("[ODOO] Recupero chiavi specifiche...");
  const keys = await executeKw("machine.type.key", "search_read", [[]], {
    fields: ["id", "name"],
    order: "name asc",
  });
  return keys;
}

/**
 * Cerca o crea una chiave per nome
 */
async function getOrCreateKey(keyName) {
  console.log(`[ODOO] Cerca/crea chiave "${keyName}"...`);

  // Cerca esistente
  const existing = await executeKw(
    "machine.type.key",
    "search_read",
    [[["name", "=", keyName]]],
    { fields: ["id", "name"], limit: 1 },
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Crea nuova
  const newId = await executeKw("machine.type.key", "create", [
    { name: keyName },
  ]);
  console.log(`[ODOO] Creata nuova chiave "${keyName}" con ID ${newId}`);
  return newId;
}

// ===============================================
// === BOM (DISTINTA BASE) =======================
// ===============================================

/**
 * Recupera i componenti BOM di un prodotto
 */
async function getBOMComponents(productId) {
  console.log(`[ODOO] Recupero BOM prodotto ${productId}...`);

  // Cerca BOM per product_id
  let boms = await executeKw(
    "mrp.bom",
    "search_read",
    [[["product_id", "=", productId]]],
    { fields: ["id", "product_id", "product_qty"], limit: 1 },
  );

  // Se non trovato, prova con product_tmpl_id
  if (!boms.length) {
    const productData = await executeKw("product.product", "read", [
      [productId],
      ["product_tmpl_id"],
    ]);

    if (productData.length > 0 && productData[0].product_tmpl_id) {
      const tmplId = productData[0].product_tmpl_id[0];
      boms = await executeKw(
        "mrp.bom",
        "search_read",
        [[["product_tmpl_id", "=", tmplId]]],
        {
          fields: ["id", "product_id", "product_tmpl_id", "product_qty"],
          limit: 1,
        },
      );
    }
  }

  if (!boms.length) {
    return { bom_id: null, components: [] };
  }

  const bom = boms[0];

  // Recupera linee BOM
  const lines = await executeKw(
    "mrp.bom.line",
    "search_read",
    [[["bom_id", "=", bom.id]]],
    {
      fields: ["id", "product_id", "product_qty", "product_uom_id"],
      order: "id asc",
    },
  );

  const components = lines.map((line) => ({
    id: line.id,
    product_id: line.product_id ? line.product_id[0] : null,
    product_name: line.product_id ? line.product_id[1] : "",
    qty: line.product_qty,
    uom: line.product_uom_id ? line.product_uom_id[1] : "",
  }));

  return { bom_id: bom.id, components };
}

/**
 * Aggiorna una riga BOM
 */
async function updateBOMLine(lineId, data) {
  console.log(`[ODOO] Aggiorno BOM line ${lineId}...`);
  const updateData = {};
  if (data.product_id !== undefined) updateData.product_id = data.product_id;
  if (data.qty !== undefined) updateData.product_qty = data.qty;

  await executeKw("mrp.bom.line", "write", [[lineId], updateData]);
  return true;
}

/**
 * Crea una nuova riga BOM
 */
async function createBOMLine(bomId, productId, qty) {
  console.log(`[ODOO] Creo BOM line per BOM ${bomId}...`);
  const id = await executeKw("mrp.bom.line", "create", [
    {
      bom_id: bomId,
      product_id: productId,
      product_qty: qty,
    },
  ]);
  return id;
}

/**
 * Elimina una riga BOM
 */
async function deleteBOMLine(lineId) {
  console.log(`[ODOO] Elimino BOM line ${lineId}...`);
  await executeKw("mrp.bom.line", "unlink", [[lineId]]);
  return true;
}

// ===============================================
// === PRODOTTI ==================================
// ===============================================

/**
 * Ricerca prodotti per nome o codice
 */
async function searchProducts(query, limit = 20) {
  console.log(`[ODOO] Ricerca prodotti "${query}"...`);

  const products = await executeKw(
    "product.product",
    "search_read",
    [["|", ["name", "ilike", query], ["default_code", "ilike", query]]],
    {
      fields: ["id", "name", "default_code"],
      limit,
      order: "name asc",
    },
  );

  return products.map((p) => ({
    id: p.id,
    name: p.default_code ? `[${p.default_code}] ${p.name}` : p.name,
    default_code: p.default_code || "",
  }));
}

// ===============================================
// === MANUFACTURING ORDER =======================
// ===============================================

/**
 * Recupera dati Manufacturing Order da workorder
 */
async function getProductionFromWorkorder(workorderId) {
  console.log(`[ODOO] Recupero MO da WO ${workorderId}...`);

  // Recupera il workorder con production_id
  const wo = await executeKw("mrp.workorder", "read", [
    [workorderId],
    ["production_id", "product_id", "name"],
  ]);

  if (!wo.length || !wo[0].production_id) {
    throw new Error(`Workorder ${workorderId} non trovato o senza MO`);
  }

  const productionId = wo[0].production_id[0];
  const productId = wo[0].product_id ? wo[0].product_id[0] : null;
  const operationName = wo[0].name || "";

  // Recupera dati MO
  const mo = await executeKw("mrp.production", "read", [
    [productionId],
    [
      "id",
      "name",
      "product_id",
      "product_qty",
      "product_uom_id",
      "state",
      "origin",
    ],
  ]);

  if (!mo.length) {
    throw new Error(`MO ${productionId} non trovato`);
  }

  const moData = mo[0];

  // Verifica se ha workorder Estrusione
  const extrusionCount = await executeKw("mrp.workorder", "search_count", [
    [
      ["production_id", "=", productionId],
      ["name", "ilike", "estrusione"],
    ],
  ]);

  return {
    production_id: moData.id,
    production_name: moData.name,
    product_id: moData.product_id ? moData.product_id[0] : null,
    product_name: moData.product_id ? moData.product_id[1] : "",
    product_qty: moData.product_qty,
    product_uom: moData.product_uom_id ? moData.product_uom_id[1] : "",
    state: moData.state,
    origin: moData.origin || "",
    hasEstrusione: extrusionCount > 0,
    workorder_operation: operationName,
  };
}

/**
 * Aggiorna dati MO (quantità) e/o prodotto (nome)
 */
async function updateProductionData(data) {
  console.log(`[ODOO] Aggiorno dati MO/Prodotto...`);

  if (data.production_id && data.product_qty !== undefined) {
    await executeKw("mrp.production", "write", [
      [data.production_id],
      { product_qty: data.product_qty },
    ]);
  }

  if (data.product_id && data.product_name !== undefined) {
    await executeKw("product.product", "write", [
      [data.product_id],
      { name: data.product_name },
    ]);
  }

  return true;
}

// ===============================================
// === EXPORTS ===================================
// ===============================================
module.exports = {
  // Workorder base
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
  getWorkorderTimeTracking,
  invalidateSession,

  // Schede tecniche (specs)
  getProductSpecs,
  updateProductSpec,
  createProductSpec,
  deleteProductSpec,
  getAllSpecKeys,
  getOrCreateKey,

  // BOM
  getBOMComponents,
  updateBOMLine,
  createBOMLine,
  deleteBOMLine,

  // Prodotti
  searchProducts,

  // Manufacturing Order
  getProductionFromWorkorder,
  updateProductionData,
};
