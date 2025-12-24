// ===============================================
// === SERVER.JS - v2.3 ==========================
// === Cache lato server =========================
// ===============================================

const express = require("express");
const path = require("path");
const odooApi = require("./odoo-api");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===============================================
// === CACHE SYSTEM ==============================
// ===============================================

/**
 * Cache in memoria con TTL configurabile
 * Ogni entry ha: { data, timestamp, ttl }
 */
const cache = {
  // Workcenters: cambiano raramente (1-2 volte l'anno)
  workcenters: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 minuti

  // Tags: quasi mai modificati
  tags: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 }, // 1 ora

  // Work orders: cambiano spesso
  workorders: { data: null, timestamp: 0, ttl: 15 * 1000 }, // 15 secondi

  // Machine types: cambiano raramente
  machineTypes: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 minuti

  // Spec keys: cambiano raramente
  specKeys: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 minuti
};

/**
 * Verifica se una cache entry è valida
 */
function isCacheValid(key) {
  const entry = cache[key];
  if (!entry || !entry.data) return false;
  const age = Date.now() - entry.timestamp;
  return age < entry.ttl;
}

/**
 * Ottiene l'età della cache in secondi
 */
function getCacheAge(key) {
  const entry = cache[key];
  if (!entry || !entry.timestamp) return -1;
  return Math.floor((Date.now() - entry.timestamp) / 1000);
}

/**
 * Salva dati in cache
 */
function setCache(key, data) {
  if (cache[key]) {
    cache[key].data = data;
    cache[key].timestamp = Date.now();
    console.log(`[CACHE] Salvato ${key} (TTL: ${cache[key].ttl / 1000}s)`);
  }
}

/**
 * Invalida una cache
 */
function invalidateCache(key) {
  if (cache[key]) {
    cache[key].data = null;
    cache[key].timestamp = 0;
    console.log(`[CACHE] Invalidato ${key}`);
  }
}

/**
 * Invalida tutte le cache
 */
function invalidateAllCaches() {
  Object.keys(cache).forEach((key) => invalidateCache(key));
}

/**
 * Aggiunge header cache info alla risposta
 */
function addCacheHeaders(res, key, isHit) {
  const entry = cache[key];
  const age = getCacheAge(key);
  const ttl = entry ? Math.floor(entry.ttl / 1000) : 0;

  res.set("X-Cache-Status", isHit ? "HIT" : "MISS");
  res.set("X-Cache-Age", age >= 0 ? age.toString() : "0");
  res.set("X-Cache-TTL", ttl.toString());
}

// ===============================================
// === API ENDPOINTS =============================
// ===============================================

// GET /api/tags - Lista tag (con cache 1 ora)
app.get("/api/tags", async (req, res) => {
  try {
    const cacheKey = "tags";

    if (isCacheValid(cacheKey)) {
      console.log("[API] Tags da cache");
      addCacheHeaders(res, cacheKey, true);
      return res.json(cache[cacheKey].data);
    }

    console.log("[API] Tags da Odoo...");
    const tags = await odooApi.getWorkcenterTags();
    setCache(cacheKey, tags);
    addCacheHeaders(res, cacheKey, false);
    res.json(tags);
  } catch (error) {
    console.error("[API] Errore tags:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workcenters - Con cache 30 minuti
app.get("/api/workcenters", async (req, res) => {
  try {
    const cacheKey = "workcenters";
    const forceRefresh = req.query.refresh === "true";

    if (!forceRefresh && isCacheValid(cacheKey)) {
      console.log("[API] Workcenters da cache");
      addCacheHeaders(res, cacheKey, true);
      return res.json(cache[cacheKey].data);
    }

    console.log("[API] Workcenters da Odoo...");
    const workcenters = await odooApi.getWorkcenters();
    console.log(`[API] ${workcenters.length} workcenters caricati`);
    setCache(cacheKey, workcenters);
    addCacheHeaders(res, cacheKey, false);
    res.json(workcenters);
  } catch (error) {
    console.error("[API] Errore workcenters:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workorders - Con cache 15 secondi
app.get("/api/workorders", async (req, res) => {
  try {
    const cacheKey = "workorders";
    const forceRefresh = req.query.refresh === "true";

    if (!forceRefresh && isCacheValid(cacheKey)) {
      console.log("[API] Workorders da cache");
      addCacheHeaders(res, cacheKey, true);
      return res.json(cache[cacheKey].data);
    }

    console.log("[API] Workorders da Odoo...");
    const workorders = await odooApi.getAllWorkorders();
    console.log(
      `[API] ${workorders.ready.length} pronti, ${workorders.active.length} attivi`,
    );
    setCache(cacheKey, workorders);
    addCacheHeaders(res, cacheKey, false);
    res.json(workorders);
  } catch (error) {
    console.error("[API] Errore workorders:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workorders/search?q=... (no cache, sempre fresh)
app.get("/api/workorders/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (q.length < 2) return res.json([]);

    console.log(`[API] Ricerca: "${q}"`);
    const workorders = await odooApi.searchWorkorders(q);

    // No cache per ricerche
    res.set("X-Cache-Status", "BYPASS");
    res.json(workorders);
  } catch (error) {
    console.error("[API] Errore search:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workorders/:id/details (no cache)
app.get("/api/workorders/:id/details", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const details = await odooApi.getWorkorderDetails(id);
    if (!details) return res.status(404).json({ error: "Non trovato" });

    res.set("X-Cache-Status", "BYPASS");
    res.json(details);
  } catch (error) {
    console.error("[API] Errore details:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/workorders/:id/timetracking (no cache)
app.get("/api/workorders/:id/timetracking", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const logs = await odooApi.getWorkorderTimeTracking(id);

    res.set("X-Cache-Status", "BYPASS");
    res.json(logs);
  } catch (error) {
    console.error("[API] Errore timetracking:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workorders/:id/start (invalida cache workorders)
app.post("/api/workorders/:id/start", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const targetWcId = req.body.targetWorkcenterId
      ? parseInt(req.body.targetWorkcenterId)
      : null;

    console.log(`[API] Start WO ${id}, target WC: ${targetWcId || "nessuno"}`);
    const result = await odooApi.startWorkorder(id, targetWcId);

    // Invalida cache workorders dopo azione
    invalidateCache("workorders");

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[API] Errore start:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workorders/:id/pause (invalida cache workorders)
app.post("/api/workorders/:id/pause", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await odooApi.pauseWorkorder(id);

    // Invalida cache workorders dopo azione
    invalidateCache("workorders");

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[API] Errore pause:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workorders/:id/complete (invalida cache workorders)
app.post("/api/workorders/:id/complete", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await odooApi.completeWorkorder(id);

    // Invalida cache workorders dopo azione
    invalidateCache("workorders");

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[API] Errore complete:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/test (no cache, test connessione)
app.get("/api/test", async (req, res) => {
  try {
    const uid = await odooApi.testConnection();
    res.json({ success: true, uid });
  } catch (error) {
    console.error("[API] Errore test:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cache/invalidate - Invalida cache manualmente
app.post("/api/cache/invalidate", (req, res) => {
  const key = req.body.key;
  if (key && cache[key]) {
    invalidateCache(key);
    res.json({ success: true, invalidated: key });
  } else if (!key) {
    invalidateAllCaches();
    res.json({ success: true, invalidated: "all" });
  } else {
    res.status(400).json({ error: "Cache key non valida" });
  }
});

// GET /api/cache/status - Stato cache
app.get("/api/cache/status", (req, res) => {
  const status = {};
  Object.keys(cache).forEach((key) => {
    const entry = cache[key];
    status[key] = {
      hasData: !!entry.data,
      age: getCacheAge(key),
      ttl: Math.floor(entry.ttl / 1000),
      valid: isCacheValid(key),
    };
  });
  res.json(status);
});

// ===============================================
// === SCHEDE TECNICHE (SPECS) ENDPOINTS =========
// ===============================================

// GET /api/workorders/:id/specs - Dati completi per editor scheda tecnica
app.get("/api/workorders/:id/specs", async (req, res) => {
  try {
    const workorderId = parseInt(req.params.id);
    console.log(`[API] Carico specs per WO ${workorderId}...`);

    // 1. Recupera dati MO dal workorder
    const moData = await odooApi.getProductionFromWorkorder(workorderId);

    // 2. Recupera specifiche tecniche
    const specs = await odooApi.getProductSpecs(moData.product_id);

    // 3. Recupera componenti BOM
    const bomData = await odooApi.getBOMComponents(moData.product_id);

    // 4. Recupera machine types e chiavi (con cache)
    const cacheKeyMT = "machineTypes";
    const cacheKeyKeys = "specKeys";

    let machineTypes, allKeys;

    if (isCacheValid(cacheKeyMT)) {
      machineTypes = cache[cacheKeyMT].data;
    } else {
      machineTypes = await odooApi.getMachineTypes();
      setCache(cacheKeyMT, machineTypes);
    }

    if (isCacheValid(cacheKeyKeys)) {
      allKeys = cache[cacheKeyKeys].data;
    } else {
      allKeys = await odooApi.getAllSpecKeys();
      setCache(cacheKeyKeys, allKeys);
    }

    res.set("X-Cache-Status", "BYPASS");
    res.json({
      workorder_id: workorderId,
      production_id: moData.production_id,
      production_name: moData.production_name,
      product_id: moData.product_id,
      product_name: moData.product_name,
      product_qty: moData.product_qty,
      product_uom: moData.product_uom,
      state: moData.state,
      origin: moData.origin,
      hasEstrusione: moData.hasEstrusione,
      workorder_operation: moData.workorder_operation,
      specs,
      bom_id: bomData.bom_id,
      components: bomData.components,
      machineTypes,
      allKeys,
    });
  } catch (error) {
    console.error("[API] Errore specs:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/workorders/:id/specs - Salva modifiche scheda tecnica
app.post("/api/workorders/:id/specs", async (req, res) => {
  try {
    const workorderId = parseInt(req.params.id);
    const modifiche = req.body;

    console.log(`[API] Salvo specs per WO ${workorderId}...`);

    const risultato = {
      specsAggiornate: 0,
      specsCreate: 0,
      specsEliminate: 0,
      componentiAggiornati: 0,
      componentiCreati: 0,
      componentiEliminati: 0,
      moAggiornato: false,
      errori: [],
    };

    // 1. Aggiorna dati MO/Prodotto se modificati
    if (modifiche.moModifiche) {
      try {
        await odooApi.updateProductionData(modifiche.moModifiche);
        risultato.moAggiornato = true;
      } catch (e) {
        risultato.errori.push(`Errore aggiornamento MO: ${e.message}`);
      }
    }

    // 2. Aggiorna specifiche esistenti
    if (
      modifiche.specsAggiornamenti &&
      modifiche.specsAggiornamenti.length > 0
    ) {
      for (const agg of modifiche.specsAggiornamenti) {
        try {
          await odooApi.updateProductSpec(agg.id, agg.value);
          risultato.specsAggiornate++;
        } catch (e) {
          risultato.errori.push(
            `Errore aggiornamento spec ${agg.id}: ${e.message}`,
          );
        }
      }
    }

    // 3. Crea nuove specifiche
    if (modifiche.specsNuove && modifiche.specsNuove.length > 0) {
      for (const nuova of modifiche.specsNuove) {
        try {
          // Cerca o crea la chiave
          const keyId = await odooApi.getOrCreateKey(nuova.key_name);
          await odooApi.createProductSpec({
            machine_type_id: nuova.machine_type_id,
            product_id: nuova.product_id,
            key_id: keyId,
            value: nuova.value,
          });
          risultato.specsCreate++;
        } catch (e) {
          risultato.errori.push(
            `Errore creazione spec "${nuova.key_name}": ${e.message}`,
          );
        }
      }
    }

    // 4. Elimina specifiche
    if (modifiche.specsEliminate && modifiche.specsEliminate.length > 0) {
      for (const specId of modifiche.specsEliminate) {
        try {
          await odooApi.deleteProductSpec(specId);
          risultato.specsEliminate++;
        } catch (e) {
          risultato.errori.push(
            `Errore eliminazione spec ${specId}: ${e.message}`,
          );
        }
      }
    }

    // 5. Aggiorna componenti BOM
    if (
      modifiche.componentiAggiornamenti &&
      modifiche.componentiAggiornamenti.length > 0
    ) {
      for (const agg of modifiche.componentiAggiornamenti) {
        try {
          await odooApi.updateBOMLine(agg.id, { qty: agg.qty });
          risultato.componentiAggiornati++;
        } catch (e) {
          risultato.errori.push(
            `Errore aggiornamento componente ${agg.id}: ${e.message}`,
          );
        }
      }
    }

    // 6. Crea nuovi componenti
    if (
      modifiche.componentiNuovi &&
      modifiche.componentiNuovi.length > 0 &&
      modifiche.bom_id
    ) {
      for (const nuovo of modifiche.componentiNuovi) {
        try {
          await odooApi.createBOMLine(
            modifiche.bom_id,
            nuovo.product_id,
            nuovo.qty,
          );
          risultato.componentiCreati++;
        } catch (e) {
          risultato.errori.push(`Errore creazione componente: ${e.message}`);
        }
      }
    }

    // 7. Elimina componenti
    if (
      modifiche.componentiEliminati &&
      modifiche.componentiEliminati.length > 0
    ) {
      for (const compId of modifiche.componentiEliminati) {
        try {
          await odooApi.deleteBOMLine(compId);
          risultato.componentiEliminati++;
        } catch (e) {
          risultato.errori.push(
            `Errore eliminazione componente ${compId}: ${e.message}`,
          );
        }
      }
    }

    const success = risultato.errori.length === 0;
    console.log(
      `[API] Specs salvate: ${success ? "OK" : "con errori"}`,
      risultato,
    );

    res.json({ success, risultato });
  } catch (error) {
    console.error("[API] Errore salvataggio specs:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/search?q=... - Ricerca prodotti
app.get("/api/products/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (q.length < 3) return res.json([]);

    console.log(`[API] Ricerca prodotti: "${q}"`);
    const products = await odooApi.searchProducts(q);

    res.set("X-Cache-Status", "BYPASS");
    res.json(products);
  } catch (error) {
    console.error("[API] Errore ricerca prodotti:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/machine-types - Lista machine types (con cache)
app.get("/api/machine-types", async (req, res) => {
  try {
    const cacheKey = "machineTypes";

    if (isCacheValid(cacheKey)) {
      console.log("[API] Machine types da cache");
      addCacheHeaders(res, cacheKey, true);
      return res.json(cache[cacheKey].data);
    }

    console.log("[API] Machine types da Odoo...");
    const types = await odooApi.getMachineTypes();
    setCache(cacheKey, types);
    addCacheHeaders(res, cacheKey, false);
    res.json(types);
  } catch (error) {
    console.error("[API] Errore machine types:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/spec-keys - Lista chiavi specifiche (con cache)
app.get("/api/spec-keys", async (req, res) => {
  try {
    const cacheKey = "specKeys";

    if (isCacheValid(cacheKey)) {
      console.log("[API] Spec keys da cache");
      addCacheHeaders(res, cacheKey, true);
      return res.json(cache[cacheKey].data);
    }

    console.log("[API] Spec keys da Odoo...");
    const keys = await odooApi.getAllSpecKeys();
    setCache(cacheKey, keys);
    addCacheHeaders(res, cacheKey, false);
    res.json(keys);
  } catch (error) {
    console.error("[API] Errore spec keys:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===============================================
// === START =====================================
// ===============================================
app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("===============================================");
  console.log("  ORDINI DI LAVORO - PIDUEMME v2.3");
  console.log("  + Cache lato server");
  console.log("===============================================");
  console.log(`  http://0.0.0.0:${PORT}`);
  console.log(`  Odoo: ${process.env.ODOO_URL}`);
  console.log("");
  console.log("  Cache TTL:");
  console.log(`    - Workcenters: ${cache.workcenters.ttl / 1000}s`);
  console.log(`    - Tags: ${cache.tags.ttl / 1000}s`);
  console.log(`    - Workorders: ${cache.workorders.ttl / 1000}s`);
  console.log("===============================================");
  console.log("");
});
