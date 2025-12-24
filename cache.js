// ===============================================
// === CACHE.JS - Sistema di caching in memoria ==
// ===============================================
// Gestione cache con TTL, invalidazione e headers

/**
 * Cache entry structure:
 * {
 *   data: any,           // I dati cachati
 *   timestamp: number,   // Quando è stata creata
 *   ttl: number          // Time-to-live in ms
 * }
 */

class CacheManager {
    constructor() {
        // Storage principale
        this.store = new Map();
        
        // Configurazione TTL di default per tipo di dato
        this.ttlConfig = {
            // Workcenters: cambiano raramente (1-2 volte l'anno)
            // Cache per 1 ora, tanto se cambiano basta riavviare il server
            workcenters: 60 * 60 * 1000,  // 1 ora
            
            // Tags e machine types: praticamente mai
            tags: 60 * 60 * 1000,         // 1 ora
            machineTypes: 60 * 60 * 1000, // 1 ora
            
            // Work orders: cambiano spesso, cache breve
            workorders: 15 * 1000,        // 15 secondi
            
            // Ricerche: cache breve per evitare ricerche ripetute
            search: 10 * 1000             // 10 secondi
        };
        
        // Statistiche
        this.stats = {
            hits: 0,
            misses: 0,
            invalidations: 0
        };
        
        console.log('[CACHE] Manager inizializzato');
    }
    
    /**
     * Genera una chiave univoca per la cache
     */
    makeKey(type, ...params) {
        return `${type}:${params.join(':')}`;
    }
    
    /**
     * Ottiene un valore dalla cache
     * @returns {object|null} { data, age, ttl, status } o null se non trovato/scaduto
     */
    get(key) {
        const entry = this.store.get(key);
        
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        
        const now = Date.now();
        const age = now - entry.timestamp;
        
        // Controlla se scaduto
        if (age > entry.ttl) {
            this.store.delete(key);
            this.stats.misses++;
            return null;
        }
        
        this.stats.hits++;
        
        return {
            data: entry.data,
            age: Math.round(age / 1000),      // Età in secondi
            ttl: Math.round(entry.ttl / 1000), // TTL in secondi
            remaining: Math.round((entry.ttl - age) / 1000), // Tempo rimanente
            status: 'HIT'
        };
    }
    
    /**
     * Salva un valore nella cache
     */
    set(key, data, ttlOverride = null) {
        // Determina TTL dal tipo o usa override
        const type = key.split(':')[0];
        const ttl = ttlOverride || this.ttlConfig[type] || 30000;
        
        this.store.set(key, {
            data,
            timestamp: Date.now(),
            ttl
        });
        
        console.log(`[CACHE] SET ${key} (TTL: ${ttl/1000}s)`);
        return data;
    }
    
    /**
     * Invalida una chiave specifica
     */
    invalidate(key) {
        if (this.store.has(key)) {
            this.store.delete(key);
            this.stats.invalidations++;
            console.log(`[CACHE] INVALIDATE ${key}`);
            return true;
        }
        return false;
    }
    
    /**
     * Invalida tutte le chiavi che iniziano con un prefisso
     */
    invalidateByPrefix(prefix) {
        let count = 0;
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
                count++;
            }
        }
        if (count > 0) {
            this.stats.invalidations += count;
            console.log(`[CACHE] INVALIDATE prefix "${prefix}" (${count} keys)`);
        }
        return count;
    }
    
    /**
     * Invalida la cache dei work orders
     */
    invalidateWorkorders() {
        return this.invalidateByPrefix('workorders');
    }
    
    /**
     * Invalida tutta la cache
     */
    clear() {
        const count = this.store.size;
        this.store.clear();
        console.log(`[CACHE] CLEAR (${count} keys)`);
        return count;
    }
    
    /**
     * Helper: wrappa una funzione con caching automatico
     */
    async wrap(key, fetchFn, ttlOverride = null) {
        // Prova a prendere dalla cache
        const cached = this.get(key);
        if (cached) {
            return {
                ...cached,
                fromCache: true
            };
        }
        
        // Cache miss: esegui la funzione
        const data = await fetchFn();
        this.set(key, data, ttlOverride);
        
        return {
            data,
            age: 0,
            ttl: Math.round((ttlOverride || this.ttlConfig[key.split(':')[0]] || 30000) / 1000),
            remaining: Math.round((ttlOverride || this.ttlConfig[key.split(':')[0]] || 30000) / 1000),
            status: 'MISS',
            fromCache: false
        };
    }
    
    /**
     * Restituisce statistiche della cache
     */
    getStats() {
        const totalRequests = this.stats.hits + this.stats.misses;
        return {
            entries: this.store.size,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: totalRequests > 0 
                ? Math.round((this.stats.hits / totalRequests) * 100) 
                : 0,
            invalidations: this.stats.invalidations
        };
    }
    
    /**
     * Genera headers HTTP per la risposta
     */
    generateHeaders(cacheResult) {
        return {
            'X-Cache-Status': cacheResult.status,
            'X-Cache-Age': cacheResult.age.toString(),
            'X-Cache-TTL': cacheResult.ttl.toString(),
            'X-Cache-Remaining': cacheResult.remaining.toString()
        };
    }
}

// Singleton
const cache = new CacheManager();

module.exports = cache;
