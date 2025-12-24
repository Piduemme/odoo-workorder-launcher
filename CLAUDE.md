# CLAUDE.md - Guida per Claude Code

Questo file contiene istruzioni per Claude Code quando lavora su questo progetto.

## Panoramica Progetto

**odoo-workorder-launcher** è un'interfaccia web touch-friendly per gestire work orders Odoo MRP su tablet in produzione. Integra anche un editor completo per le schede tecniche dei prodotti.

## Stack Tecnologico

- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JS vanilla (no framework)
- **API Odoo**: XML-RPC (libreria `xmlrpc`)
- **PWA**: Service Worker per funzionalità offline

## Struttura File Principali

```
odoo-workorder-launcher/
├── server.js          # Server Express + endpoint REST + cache
├── odoo-api.js        # Tutte le chiamate XML-RPC verso Odoo
├── cache.js           # (non usato, cache integrata in server.js)
├── public/
│   ├── index.html     # UI principale
│   ├── app.js         # Logica frontend (~1600 righe)
│   ├── style.css      # Stili (~1700 righe)
│   ├── sw.js          # Service Worker
│   └── manifest.json  # PWA manifest
├── .env               # Credenziali Odoo (NON versionato)
└── .env.example       # Template credenziali
```

## Modelli Odoo Utilizzati

### Work Orders
- `mrp.workorder` - Work orders
- `mrp.workcenter` - Centri di lavoro
- `mrp.workcenter.tag` - Tag workcenter
- `mrp.workcenter.productivity` - Log tempi
- `mrp.production` - Manufacturing Orders (MO)

### Schede Tecniche
- `machine.type` - Tipi macchina (Estrusione, Saldatura, Stampa)
- `machine.type.key` - Chiavi specifiche (Peso, Metri, Numero bobine, etc.)
- `machine.type.product` - Valori specifiche per prodotto
- `mrp.bom` - Bill of Materials
- `mrp.bom.line` - Righe BOM (componenti)
- `product.product` - Prodotti

## Endpoint API Principali

### Work Orders
- `GET /api/workcenters` - Lista centri (cache 30 min)
- `GET /api/workorders` - Work orders ready/progress (cache 15 sec)
- `GET /api/workorders/search?q=` - Ricerca
- `POST /api/workorders/:id/start` - Avvia
- `POST /api/workorders/:id/pause` - Pausa
- `POST /api/workorders/:id/complete` - Completa

### Schede Tecniche
- `GET /api/workorders/:id/specs` - Dati completi scheda tecnica
- `POST /api/workorders/:id/specs` - Salva modifiche
- `GET /api/products/search?q=` - Ricerca prodotti
- `GET /api/machine-types` - Lista tipi macchina
- `GET /api/spec-keys` - Lista chiavi specifiche

## Pattern di Codice

### Frontend State Management
```javascript
// Stato globale applicazione
const state = {
    workcenters: [],
    selectedWorkcenter: null,
    workorders: { ready: [], active: [] },
    // ...
};

// Stato editor schede tecniche
const specsState = {
    specs: [],
    specsModified: [],
    specsDeleted: [],
    specsNew: [],
    // ...
};
```

### Chiamate Odoo (odoo-api.js)
```javascript
// Pattern standard per nuove funzioni
async function nuovaFunzione(param) {
    console.log(`[ODOO] Descrizione...`);
    return withRetry(async () => {
        const uid = await authenticate();
        return await executeKw('model.name', 'method', [args], {kwargs});
    }, 'model.method');
}
```

### Cache Server (server.js)
```javascript
// Cache con TTL configurabile
const cache = {
    chiave: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }
};
```

## Comandi Utili

```bash
# Avvia server
node server.js

# Testa connessione Odoo
curl http://localhost:3000/api/test

# Stato cache
curl http://localhost:3000/api/cache/status

# Invalida cache
curl -X POST http://localhost:3000/api/cache/invalidate
```

## Note Importanti

1. **Credenziali**: Sempre in `.env`, mai hardcoded
2. **Cache**: Invalidare dopo operazioni di scrittura
3. **Error handling**: `withRetry()` gestisce errori di rete automaticamente
4. **UI**: Touch-friendly, minimo 220px per card
5. **Specifiche tecniche**: Il totale BOM è visibile solo se `hasEstrusione: true`

## Relazione con odoo-modifiche-schede

L'editor schede tecniche è stato portato da `odoo-modifiche-schede` (Google Apps Script) a questo progetto Node.js. La logica è simile ma usa XML-RPC invece di JSON-RPC.
