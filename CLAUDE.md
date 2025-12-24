# CLAUDE.md - Guida per Claude Code

Questo file contiene istruzioni per Claude Code quando lavora su questo progetto.

## Panoramica Progetto

**odoo-workorder-launcher** è un'interfaccia web touch-friendly per gestire work orders Odoo MRP su tablet in produzione. Integra anche un editor completo per le schede tecniche dei prodotti.

## Stack Tecnologico

- **Backend**: Node.js + Express
- **Frontend**: HTML/CSS/JS vanilla (no framework)
- **API Odoo**: XML-RPC (libreria `xmlrpc`)
- **PWA**: Service Worker per funzionalità offline
- **Scanner**: html5-qrcode per scansione barcode

## Struttura File Principali

```
odoo-workorder-launcher/
├── server.js          # Server Express HTTP/HTTPS + endpoint REST + cache
├── odoo-api.js        # Tutte le chiamate XML-RPC verso Odoo
├── public/
│   ├── index.html     # UI principale
│   ├── app.js         # Logica frontend (~2000 righe)
│   ├── style.css      # Stili (~1900 righe)
│   ├── sw.js          # Service Worker
│   └── manifest.json  # PWA manifest
├── certs/             # Certificati SSL (self-signed, non versionati)
│   ├── key.pem
│   └── cert.pem
├── .env               # Credenziali Odoo (NON versionato)
└── .env.example       # Template credenziali
```

## Server

Il server ascolta su due porte:
- **HTTP**: porta 3000 (default)
- **HTTPS**: porta 3443 (richiesto per scanner barcode su iOS)

Per rigenerare i certificati SSL:
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/C=IT/ST=Italy/L=Milan/O=Piduemme/CN=localhost"
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

// Cache pre-caricamento schede tecniche
const specsCache = {
    data: new Map(),  // workorderId -> { data, timestamp }
    TTL: 5 * 60 * 1000  // 5 minuti
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

### Centri di Lavoro Nascosti (odoo-api.js)
```javascript
// Centri di lavoro da nascondere
const HIDDEN_WORKCENTERS = [
    "fase di saldatura generica",
    "fase di estrusione generica",
];
```

## Funzionalità Principali

### Scanner Barcode
- Pulsante 📷 nella barra di ricerca
- Usa fotocamera posteriore del dispositivo
- Supporta: Code128, Code39, EAN, UPC, ITF, Codabar
- Richiede HTTPS su iOS

### Tab Work Orders
- **Attivi**: Solo WO del workcenter corrente
- **Pronti**: Tutti i WO pronti (filtro compatibilità attivo)

### Avvio da Ricerca
Quando si cerca un WO senza aver selezionato un workcenter:
- Click su "Avvia" mostra pulsanti per scegliere il workcenter
- Pulsanti colorati per tipo operazione
- Compatibili in verde, incompatibili in arancione

### Card Workcenter
Sfondo colorato in base al tipo operazione:
- **Estrusione**: verde
- **Saldatura**: arancione
- **Stampa**: blu

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
6. **HTTPS**: Richiesto per scanner barcode su iOS/Safari

## Relazione con odoo-modifiche-schede

L'editor schede tecniche è stato portato da `odoo-modifiche-schede` (Google Apps Script) a questo progetto Node.js. La logica è simile ma usa XML-RPC invece di JSON-RPC.
