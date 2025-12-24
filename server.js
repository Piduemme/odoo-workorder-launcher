// ===============================================
// === SERVER.JS - v2.3 ==========================
// === Cache lato server =========================
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
// === CACHE SYSTEM ==============================
// ===============================================

/**
 * Cache in memoria con TTL configurabile
 * Ogni entry ha: { data, timestamp, ttl }
 */
const cache = {
    // Workcenters: cambiano raramente (1-2 volte l'anno)
    workcenters: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 },  // 30 minuti
    
    // Tags: quasi mai modificati
    tags: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 },  // 1 ora
    
    // Work orders: cambiano spesso
    workorders: { data: null, timestamp: 0, ttl: 15 * 1000 },  // 15 secondi
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
    Object.keys(cache).forEach(key => invalidateCache(key));
}

/**
 * Aggiunge header cache info alla risposta
 */
function addCacheHeaders(res, key, isHit) {
    const entry = cache[key];
    const age = getCacheAge(key);
    const ttl = entry ? Math.floor(entry.ttl / 1000) : 0;
    
    res.set('X-Cache-Status', isHit ? 'HIT' : 'MISS');
    res.set('X-Cache-Age', age >= 0 ? age.toString() : '0');
    res.set('X-Cache-TTL', ttl.toString());
}

// ===============================================
// === API ENDPOINTS =============================
// ===============================================

// GET /api/tags - Lista tag (con cache 1 ora)
app.get('/api/tags', async (req, res) => {
    try {
        const cacheKey = 'tags';
        
        if (isCacheValid(cacheKey)) {
            console.log('[API] Tags da cache');
            addCacheHeaders(res, cacheKey, true);
            return res.json(cache[cacheKey].data);
        }
        
        console.log('[API] Tags da Odoo...');
        const tags = await odooApi.getWorkcenterTags();
        setCache(cacheKey, tags);
        addCacheHeaders(res, cacheKey, false);
        res.json(tags);
    } catch (error) {
        console.error('[API] Errore tags:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workcenters - Con cache 30 minuti
app.get('/api/workcenters', async (req, res) => {
    try {
        const cacheKey = 'workcenters';
        const forceRefresh = req.query.refresh === 'true';
        
        if (!forceRefresh && isCacheValid(cacheKey)) {
            console.log('[API] Workcenters da cache');
            addCacheHeaders(res, cacheKey, true);
            return res.json(cache[cacheKey].data);
        }
        
        console.log('[API] Workcenters da Odoo...');
        const workcenters = await odooApi.getWorkcenters();
        console.log(`[API] ${workcenters.length} workcenters caricati`);
        setCache(cacheKey, workcenters);
        addCacheHeaders(res, cacheKey, false);
        res.json(workcenters);
    } catch (error) {
        console.error('[API] Errore workcenters:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders - Con cache 15 secondi
app.get('/api/workorders', async (req, res) => {
    try {
        const cacheKey = 'workorders';
        const forceRefresh = req.query.refresh === 'true';
        
        if (!forceRefresh && isCacheValid(cacheKey)) {
            console.log('[API] Workorders da cache');
            addCacheHeaders(res, cacheKey, true);
            return res.json(cache[cacheKey].data);
        }
        
        console.log('[API] Workorders da Odoo...');
        const workorders = await odooApi.getAllWorkorders();
        console.log(`[API] ${workorders.ready.length} pronti, ${workorders.active.length} attivi`);
        setCache(cacheKey, workorders);
        addCacheHeaders(res, cacheKey, false);
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore workorders:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/search?q=... (no cache, sempre fresh)
app.get('/api/workorders/search', async (req, res) => {
    try {
        const q = req.query.q || '';
        if (q.length < 2) return res.json([]);
        
        console.log(`[API] Ricerca: "${q}"`);
        const workorders = await odooApi.searchWorkorders(q);
        
        // No cache per ricerche
        res.set('X-Cache-Status', 'BYPASS');
        res.json(workorders);
    } catch (error) {
        console.error('[API] Errore search:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/details (no cache)
app.get('/api/workorders/:id/details', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const details = await odooApi.getWorkorderDetails(id);
        if (!details) return res.status(404).json({ error: 'Non trovato' });
        
        res.set('X-Cache-Status', 'BYPASS');
        res.json(details);
    } catch (error) {
        console.error('[API] Errore details:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/workorders/:id/timetracking (no cache)
app.get('/api/workorders/:id/timetracking', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const logs = await odooApi.getWorkorderTimeTracking(id);
        
        res.set('X-Cache-Status', 'BYPASS');
        res.json(logs);
    } catch (error) {
        console.error('[API] Errore timetracking:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/start (invalida cache workorders)
app.post('/api/workorders/:id/start', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const targetWcId = req.body.targetWorkcenterId ? parseInt(req.body.targetWorkcenterId) : null;
        
        console.log(`[API] Start WO ${id}, target WC: ${targetWcId || 'nessuno'}`);
        const result = await odooApi.startWorkorder(id, targetWcId);
        
        // Invalida cache workorders dopo azione
        invalidateCache('workorders');
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore start:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/pause (invalida cache workorders)
app.post('/api/workorders/:id/pause', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await odooApi.pauseWorkorder(id);
        
        // Invalida cache workorders dopo azione
        invalidateCache('workorders');
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore pause:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/workorders/:id/complete (invalida cache workorders)
app.post('/api/workorders/:id/complete', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await odooApi.completeWorkorder(id);
        
        // Invalida cache workorders dopo azione
        invalidateCache('workorders');
        
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Errore complete:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/test (no cache, test connessione)
app.get('/api/test', async (req, res) => {
    try {
        const uid = await odooApi.testConnection();
        res.json({ success: true, uid });
    } catch (error) {
        console.error('[API] Errore test:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/cache/invalidate - Invalida cache manualmente
app.post('/api/cache/invalidate', (req, res) => {
    const key = req.body.key;
    if (key && cache[key]) {
        invalidateCache(key);
        res.json({ success: true, invalidated: key });
    } else if (!key) {
        invalidateAllCaches();
        res.json({ success: true, invalidated: 'all' });
    } else {
        res.status(400).json({ error: 'Cache key non valida' });
    }
});

// GET /api/cache/status - Stato cache
app.get('/api/cache/status', (req, res) => {
    const status = {};
    Object.keys(cache).forEach(key => {
        const entry = cache[key];
        status[key] = {
            hasData: !!entry.data,
            age: getCacheAge(key),
            ttl: Math.floor(entry.ttl / 1000),
            valid: isCacheValid(key)
        };
    });
    res.json(status);
});

// ===============================================
// === START =====================================
// ===============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===============================================');
    console.log('  ORDINI DI LAVORO - PIDUEMME v2.3');
    console.log('  + Cache lato server');
    console.log('===============================================');
    console.log(`  http://0.0.0.0:${PORT}`);
    console.log(`  Odoo: ${process.env.ODOO_URL}`);
    console.log('');
    console.log('  Cache TTL:');
    console.log(`    - Workcenters: ${cache.workcenters.ttl / 1000}s`);
    console.log(`    - Tags: ${cache.tags.ttl / 1000}s`);
    console.log(`    - Workorders: ${cache.workorders.ttl / 1000}s`);
    console.log('===============================================');
    console.log('');
});
