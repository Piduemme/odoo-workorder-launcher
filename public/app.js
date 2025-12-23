// ===============================================
// === APP.JS - FRONTEND APPLICATION =============
// ===============================================
// Gestisce l'interfaccia utente e le chiamate API
// Flusso: Selezione workcenter → Lista workorders → Avvio

// --- STATO APPLICAZIONE ---
const state = {
    workcenters: [],           // Lista centri di lavoro
    selectedWorkcenter: null,  // Centro di lavoro selezionato
    workorders: [],            // Work orders del centro selezionato
    selectedWorkorder: null    // Work order da avviare (per modal)
};

// --- ELEMENTI DOM ---
const elements = {
    // Status connessione
    connectionStatus: document.getElementById('connectionStatus'),
    statusDot: null,
    statusText: null,
    
    // Sezioni
    stepWorkcenters: document.getElementById('stepWorkcenters'),
    stepWorkorders: document.getElementById('stepWorkorders'),
    
    // Griglie
    workcenterGrid: document.getElementById('workcenterGrid'),
    workorderGrid: document.getElementById('workorderGrid'),
    
    // Header workorders
    selectedWorkcenterName: document.getElementById('selectedWorkcenterName'),
    btnBack: document.getElementById('btnBack'),
    
    // Modal
    modalOverlay: document.getElementById('modalOverlay'),
    modalWorkorderName: document.getElementById('modalWorkorderName'),
    btnCancel: document.getElementById('btnCancel'),
    btnConfirm: document.getElementById('btnConfirm'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// Inizializza riferimenti status dot/text
elements.statusDot = elements.connectionStatus.querySelector('.status-dot');
elements.statusText = elements.connectionStatus.querySelector('.status-text');

// ===============================================
// === FUNZIONI UI ===============================
// ===============================================

/**
 * Aggiorna lo stato della connessione nell'header
 * @param {string} status - 'connecting' | 'connected' | 'error'
 * @param {string} message - Messaggio da mostrare
 */
function updateConnectionStatus(status, message) {
    elements.statusDot.className = 'status-dot';
    
    if (status === 'connected') {
        elements.statusDot.classList.add('connected');
    } else if (status === 'error') {
        elements.statusDot.classList.add('error');
    }
    
    elements.statusText.textContent = message;
}

/**
 * Mostra una notifica toast
 * @param {string} message - Messaggio
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    elements.toastContainer.appendChild(toast);
    
    // Rimuovi dopo 4 secondi
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Formatta una data ISO in formato leggibile
 * @param {string} isoDate - Data in formato ISO
 * @returns {string} Data formattata
 */
function formatDate(isoDate) {
    if (!isoDate) return '-';
    
    const date = new Date(isoDate);
    return date.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ===============================================
// === RENDER FUNCTIONS ==========================
// ===============================================

/**
 * Renderizza la griglia dei centri di lavoro
 */
function renderWorkcenters() {
    // Se non ci sono workcenters, mostra stato vuoto
    if (state.workcenters.length === 0) {
        elements.workcenterGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏭</div>
                <p>Nessun centro di lavoro trovato</p>
            </div>
        `;
        return;
    }
    
    // Genera HTML per ogni workcenter
    const html = state.workcenters.map(wc => `
        <div class="workcenter-card" 
             data-id="${wc.id}" 
             data-color="${wc.color || 0}"
             onclick="selectWorkcenter(${wc.id})">
            <div class="card-name">${escapeHtml(wc.name)}</div>
            ${wc.code ? `<div class="card-code">${escapeHtml(wc.code)}</div>` : ''}
        </div>
    `).join('');
    
    elements.workcenterGrid.innerHTML = html;
}

/**
 * Renderizza la griglia dei work orders
 */
function renderWorkorders() {
    // Se non ci sono workorders, mostra stato vuoto
    if (state.workorders.length === 0) {
        elements.workorderGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <p>Nessun ordine di lavoro pronto per questo centro</p>
            </div>
        `;
        return;
    }
    
    // Genera HTML per ogni workorder
    const html = state.workorders.map(wo => {
        // Estrai nome prodotto (è un array [id, name])
        const productName = wo.product_id ? wo.product_id[1] : '-';
        const productionName = wo.production_id ? wo.production_id[1] : '-';
        
        return `
            <div class="workorder-card" 
                 data-id="${wo.id}"
                 onclick="selectWorkorder(${wo.id})">
                <div class="card-header">
                    <div class="card-name">${escapeHtml(wo.display_name || wo.name)}</div>
                    <div class="card-product">📦 ${escapeHtml(productName)}</div>
                </div>
                <div class="card-details">
                    <div class="card-qty">
                        📊 Qtà: ${wo.qty_remaining || wo.qty_producing || '-'}
                    </div>
                    <div class="card-date">
                        📅 ${formatDate(wo.date_planned_start)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    elements.workorderGrid.innerHTML = html;
}

/**
 * Escape HTML per prevenire XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===============================================
// === EVENT HANDLERS ============================
// ===============================================

/**
 * Seleziona un centro di lavoro e carica i suoi work orders
 * @param {number} workcenterId - ID del workcenter
 */
async function selectWorkcenter(workcenterId) {
    // Trova il workcenter selezionato
    state.selectedWorkcenter = state.workcenters.find(wc => wc.id === workcenterId);
    
    if (!state.selectedWorkcenter) {
        showToast('Centro di lavoro non trovato', 'error');
        return;
    }
    
    // Aggiorna UI
    elements.selectedWorkcenterName.textContent = state.selectedWorkcenter.name;
    
    // Mostra loading
    elements.workorderGrid.innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner"></div>
            <p>Caricamento ordini di lavoro...</p>
        </div>
    `;
    
    // Mostra sezione workorders, nascondi workcenters
    elements.stepWorkcenters.classList.add('hidden');
    elements.stepWorkorders.classList.remove('hidden');
    
    // Carica work orders
    try {
        const response = await fetch(`/api/workorders/${workcenterId}`);
        
        if (!response.ok) {
            throw new Error('Errore nel caricamento');
        }
        
        state.workorders = await response.json();
        renderWorkorders();
        
    } catch (error) {
        console.error('Errore caricamento workorders:', error);
        showToast('Errore nel caricamento degli ordini', 'error');
        elements.workorderGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <p>Errore nel caricamento</p>
            </div>
        `;
    }
}

/**
 * Torna alla selezione del centro di lavoro
 */
function goBack() {
    state.selectedWorkcenter = null;
    state.workorders = [];
    
    elements.stepWorkorders.classList.add('hidden');
    elements.stepWorkcenters.classList.remove('hidden');
}

/**
 * Seleziona un work order e mostra modal di conferma
 * @param {number} workorderId - ID del workorder
 */
function selectWorkorder(workorderId) {
    state.selectedWorkorder = state.workorders.find(wo => wo.id === workorderId);
    
    if (!state.selectedWorkorder) {
        showToast('Ordine di lavoro non trovato', 'error');
        return;
    }
    
    // Aggiorna modal
    elements.modalWorkorderName.textContent = state.selectedWorkorder.display_name || state.selectedWorkorder.name;
    
    // Mostra modal
    elements.modalOverlay.classList.remove('hidden');
}

/**
 * Chiude il modal di conferma
 */
function closeModal() {
    elements.modalOverlay.classList.add('hidden');
    state.selectedWorkorder = null;
}

/**
 * Conferma e avvia il work order selezionato
 */
async function confirmStart() {
    if (!state.selectedWorkorder) return;
    
    const workorderId = state.selectedWorkorder.id;
    const workorderName = state.selectedWorkorder.display_name || state.selectedWorkorder.name;
    
    // Disabilita pulsante durante l'operazione
    elements.btnConfirm.disabled = true;
    elements.btnConfirm.textContent = 'Avvio...';
    
    try {
        const response = await fetch(`/api/workorders/${workorderId}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Errore durante l\'avvio');
        }
        
        // Successo!
        showToast(`✓ Lavorazione avviata: ${workorderName}`, 'success');
        
        // Chiudi modal
        closeModal();
        
        // Ricarica la lista (il work order avviato non sarà più "ready")
        await selectWorkcenter(state.selectedWorkcenter.id);
        
    } catch (error) {
        console.error('Errore avvio workorder:', error);
        showToast(`Errore: ${error.message}`, 'error');
    } finally {
        elements.btnConfirm.disabled = false;
        elements.btnConfirm.textContent = '✓ Avvia';
    }
}

// ===============================================
// === INIZIALIZZAZIONE ==========================
// ===============================================

/**
 * Carica i centri di lavoro all'avvio
 */
async function loadWorkcenters() {
    try {
        updateConnectionStatus('connecting', 'Connessione a Odoo...');
        
        // Prima testa la connessione
        const testResponse = await fetch('/api/test');
        if (!testResponse.ok) {
            throw new Error('Connessione a Odoo fallita');
        }
        
        updateConnectionStatus('connected', 'Connesso');
        
        // Poi carica i workcenters
        const response = await fetch('/api/workcenters');
        if (!response.ok) {
            throw new Error('Errore nel caricamento');
        }
        
        state.workcenters = await response.json();
        renderWorkcenters();
        
    } catch (error) {
        console.error('Errore inizializzazione:', error);
        updateConnectionStatus('error', 'Errore connessione');
        showToast('Impossibile connettersi a Odoo', 'error');
        
        elements.workcenterGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <p>Errore di connessione a Odoo</p>
                <p style="font-size: 0.9rem; margin-top: 8px;">Ricarica la pagina per riprovare</p>
            </div>
        `;
    }
}

// --- EVENT LISTENERS ---
elements.btnBack.addEventListener('click', goBack);
elements.btnCancel.addEventListener('click', closeModal);
elements.btnConfirm.addEventListener('click', confirmStart);

// Chiudi modal cliccando fuori
elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) {
        closeModal();
    }
});

// --- AVVIO ---
document.addEventListener('DOMContentLoaded', loadWorkcenters);
