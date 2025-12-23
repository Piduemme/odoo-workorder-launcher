# Odoo Workorder Launcher

Interfaccia Kanban touch-friendly per avviare work orders in Odoo MRP.

## Funzionalità

- Visualizza centri di lavoro (workcenters) come card colorate
- Seleziona un centro per vedere i work orders pronti (`ready`)
- Click su un work order per avviarlo (porta in stato `progress`)
- Interfaccia ottimizzata per tablet in produzione

## Requisiti

- Node.js 18+
- Accesso API a Odoo Online (XML-RPC)

## Installazione

```bash
# Clona il repository
git clone https://github.com/tuouser/odoo-workorder-launcher.git
cd odoo-workorder-launcher

# Installa dipendenze
npm install

# Configura le credenziali Odoo
cp .env.example .env
# Modifica .env con i tuoi dati
```

## Configurazione

Modifica il file `.env`:

```env
ODOO_URL=https://tua-istanza.odoo.com
ODOO_DB=nome-database
ODOO_USER=email@esempio.com
ODOO_API_KEY=tua-api-key

PORT=3000
```

## Avvio

```bash
# Produzione
npm start

# Sviluppo (auto-reload)
npm run dev
```

L'app sarà disponibile su `http://localhost:3000`

## Struttura

```
odoo-workorder-launcher/
├── server.js          # Server Express + API REST
├── odoo-api.js        # Modulo connessione Odoo XML-RPC
├── public/
│   ├── index.html     # Pagina principale
│   ├── style.css      # Stili CSS (Kanban)
│   └── app.js         # Frontend JavaScript
├── .env               # Configurazione (non versionato)
├── .env.example       # Template configurazione
└── package.json
```

## API Endpoints

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/test` | Test connessione Odoo |
| GET | `/api/workcenters` | Lista centri di lavoro attivi |
| GET | `/api/workorders/:id` | Work orders pronti per un workcenter |
| POST | `/api/workorders/:id/start` | Avvia un work order |

## License

MIT
