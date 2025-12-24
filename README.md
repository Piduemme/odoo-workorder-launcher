# Ordini di Lavoro - Piduemme

Interfaccia web touch-friendly per gestire work orders Odoo MRP su tablet in produzione.

## Funzionalità

### Gestione Work Orders
- Visualizzazione centri di lavoro come card colorate
- Avvio, pausa e completamento work orders
- Riassegnazione dinamica a centri diversi
- Ricerca work orders per MO, prodotto, operazione
- Auto-refresh configurabile (10s, 30s, 1m)
- Filtri: solo compatibili, solo questo centro, vista compatta
- Dark mode

### Editor Schede Tecniche (v2.4)
- Modifica nome prodotto e quantità MO (click-to-edit)
- Gestione specifiche tecniche (aggiungi/modifica/elimina)
- Gestione componenti BOM con ricerca prodotti
- Validazione totale componenti (deve essere 100%)
- Salvataggio manuale con conferma modifiche

### PWA
- Installabile come app nativa
- Service Worker per caching assets
- Funziona offline (solo lettura)

## Requisiti

- Node.js 18+
- Accesso a istanza Odoo con modulo MRP
- Modelli custom: `machine.type`, `machine.type.key`, `machine.type.product`

## Installazione

```bash
# Clona repository
git clone https://github.com/Piduemme/odoo-workorder-launcher.git
cd odoo-workorder-launcher

# Installa dipendenze
npm install

# Configura credenziali
cp .env.example .env
# Modifica .env con le tue credenziali Odoo

# Avvia server
node server.js
```

## Configurazione

Crea un file `.env` con:

```env
ODOO_URL=https://tua-istanza.odoo.com
ODOO_DB=nome-database
ODOO_USER=email@esempio.com
ODOO_API_KEY=tua-api-key
PORT=3000
```

## Utilizzo

1. Apri `http://localhost:3000` su tablet o browser
2. Seleziona un centro di lavoro
3. Visualizza work orders pronti o attivi
4. Clicca su un work order per avviarlo/pausarlo/completarlo
5. Clicca "Dettagli" per aprire l'editor scheda tecnica

## API Endpoints

### Work Orders
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/workcenters` | Lista centri di lavoro |
| GET | `/api/workorders` | Work orders ready/progress |
| GET | `/api/workorders/search?q=` | Ricerca work orders |
| POST | `/api/workorders/:id/start` | Avvia work order |
| POST | `/api/workorders/:id/pause` | Pausa work order |
| POST | `/api/workorders/:id/complete` | Completa work order |

### Schede Tecniche
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/workorders/:id/specs` | Dati scheda tecnica |
| POST | `/api/workorders/:id/specs` | Salva modifiche |
| GET | `/api/products/search?q=` | Ricerca prodotti |
| GET | `/api/machine-types` | Lista tipi macchina |
| GET | `/api/spec-keys` | Lista chiavi specifiche |

### Cache
| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/cache/status` | Stato cache |
| POST | `/api/cache/invalidate` | Invalida cache |

## Cache TTL

- Workcenters: 30 minuti
- Tags: 1 ora
- Work orders: 15 secondi
- Machine types: 30 minuti
- Spec keys: 30 minuti

## Struttura Progetto

```
odoo-workorder-launcher/
├── server.js          # Server Express + API REST
├── odoo-api.js        # Client XML-RPC per Odoo
├── public/
│   ├── index.html     # UI principale
│   ├── app.js         # Logica frontend
│   ├── style.css      # Stili CSS
│   ├── sw.js          # Service Worker
│   └── manifest.json  # PWA manifest
├── .env.example       # Template configurazione
├── CLAUDE.md          # Guida per Claude Code
└── README.md          # Questa documentazione
```

## Changelog

### v2.4 (2024-12)
- Editor schede tecniche integrato nel modale dettagli
- Click-to-edit per nome prodotto e quantità
- Gestione specifiche tecniche e componenti BOM
- Ricerca prodotti con debounce e cache
- Porting da odoo-modifiche-schede (GAS)

### v2.3
- Cache lato server con TTL configurabile
- Stile Piduemme (verde #36a763)
- Rinominato in "Ordini di Lavoro"

### v2.2
- Gestione errori robusta con retry automatico
- Timeout e invalidazione sessione

### v2.1
- Filtro operazioni compatibili

### v2.0
- Auto-refresh, dark mode, filtri
- Pausa/completa work orders
- Timer elapsed time
- PWA con Service Worker

## Licenza

Proprietario: Piduemme S.r.l.
