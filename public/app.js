// ===============================================
// === APP.JS - FRONTEND APPLICATION =============
// ===============================================
// Gestisce l'interfaccia utente e le chiamate API
// Flusso: Selezione workcenter → Vedi TUTTI i workorders → Avvio
// Include ricerca globale e riassegnazione workcenter

// --- STATO APPLICAZIONE ---
const state = {
    workcenters: [],           // Lista centri di lavoro
    selectedWorkcenter: null,  // Centro di lavoro selezionato
    workorders: {              // TUTTI i work orders (di qualsiasi centro)
        ready: [],
        active: []
    },
    selectedWorkorder: null,   // Work order da avviare (per modal)
    searchResults: [],         // Risultati ricerca
    activeTab: 'active'        // Tab attivo: 'active' o 'ready'
};

// --- ELEMENTI DOM ---
const elements = {
    // Status connessione
    connectionStatus: document.getElementById('connectionStatus'),
    statusDot: null,
    statusText: null,
    
    // Ricerca
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchResults: document.getElementById('searchResults'),
    searchResultsList: document.getElementById('searchResultsList'),
    btnCloseSearch: document.getElementById('btnCloseSearch'),
    
    // Sezioni
    stepWorkcenters: document.getElementById('stepWorkcenters'),
    stepWorkorders: document.getElementById('stepWorkorders'),
    
    // Griglie
    workcenterGrid: document.getElementById('workcenterGrid'),
    activeWorkorderGrid: document.getElementById('activeWorkorderGrid'),
    readyWorkorderGrid: document.getElementById('readyWorkorderGrid'),
    
    // Header workorders
    selectedWorkcenterName: document.getElementById('selectedWorkcenterName'),
    btnBack: document.getElementById('btnBack'),
    
    // Tabs
    tabActive: document.getElementById('tabActive'),
    tabReady: document.getElementById('tabReady'),
    tabContentActive: document.getElementById('tabContentActive'),
    tabContentReady: document.getElementById('tabContentReady'),
    countActive: document.getElementById('countActive'),
    countReady: document.getElementById('countReady'),
    
    // Modal
    modalOverlay: document.getElementById('modalOverlay'),
    modalWorkorderName: document.getElementById('modalWorkorderName'),
    modalWorkcenterWarning: document.getElementById('modalWorkcenterWarning'),
    modalCurrentWorkcenter: document.getElementById('modalCurrentWorkcenter'),
    modalTargetWorkcenter: document.getElementById('modalTargetWorkcenter'),
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
 * Formatta la durata da minuti a ore:minuti
 * @param {number} minutes - Durata in minuti
 * @returns {string} Durata formattata (es. "2h 30m")
 */
function formatDuration(minutes) {
    if (!minutes) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
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
// === RENDER FUNCTIONS ==========================
// ===============================================

/**
 * Renderizza la griglia dei centri di lavoro
 */
function renderWorkcenters() {
    if (state.workcenters.length === 0) {
        elements.workcenterGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏭</div>
                <p>Nessun centro di lavoro trovato</p>
            </div>
        `;
        return;
    }
    
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
 * Renderizza una card work order
 * @param {Object} wo - Work order
 */
function renderWorkorderCard(wo) {
    const productName = wo.product_id ? wo.product_id[1] : '-';
    const workcenterName = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    const workcenterIdOfWo = wo.workcenter_id ? wo.workcenter_id[0] : null;
    
    // Controlla se questo work order è del centro selezionato o di un altro
    const isCurrentWorkcenter = state.selectedWorkcenter && 
        workcenterIdOfWo === state.selectedWorkcenter.id;
    
    const cardClasses = ['workorder-card'];
    if (wo.state === 'progress') cardClasses.push('active');
    if (!isCurrentWorkcenter) cardClasses.push('other-workcenter');
    
    return `
        <div class="${cardClasses.join(' ')}" 
             data-id="${wo.id}"
             onclick="selectWorkorder(${wo.id}, '${wo.state}')">
            <div class="card-header">
                <div class="card-name">${escapeHtml(wo.display_name || wo.name)}</div>
                <div class="card-product">📦 ${escapeHtml(productName)}</div>
                <div class="card-workcenter ${isCurrentWorkcenter ? 'same' : 'different'}">
                    🏭 ${escapeHtml(workcenterName)}
                    ${isCurrentWorkcenter ? '' : ' ⚠️'}
                </div>
            </div>
            <div class="card-details">
                <div class="card-qty">
                    📊 Qtà: ${wo.qty_remaining || wo.qty_producing || '-'}
                </div>
                <div class="card-duration">
                    ⏱️ Durata: ${formatDuration(wo.duration_expected)}
                </div>
            </div>
            <span class="card-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
        </div>
    `;
}

/**
 * Renderizza i work orders nelle tab
 * Mostra TUTTI i work orders, evidenziando quelli del centro selezionato
 */
function renderWorkorders() {
    // Aggiorna contatori
    elements.countActive.textContent = state.workorders.active.length;
    elements.countReady.textContent = state.workorders.ready.length;
    
    // Ordina: prima quelli del centro selezionato, poi gli altri
    const sortByWorkcenter = (a, b) => {
        const aIsCurrent = a.workcenter_id && state.selectedWorkcenter && 
            a.workcenter_id[0] === state.selectedWorkcenter.id;
        const bIsCurrent = b.workcenter_id && state.selectedWorkcenter && 
            b.workcenter_id[0] === state.selectedWorkcenter.id;
        
        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;
        return 0;
    };
    
    // Tab Attivi
    if (state.workorders.active.length === 0) {
        elements.activeWorkorderGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">✨</div>
                <p>Nessuna lavorazione attiva</p>
            </div>
        `;
    } else {
        const sortedActive = [...state.workorders.active].sort(sortByWorkcenter);
        elements.activeWorkorderGrid.innerHTML = sortedActive
            .map(wo => renderWorkorderCard(wo))
            .join('');
    }
    
    // Tab Pronti
    if (state.workorders.ready.length === 0) {
        elements.readyWorkorderGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <p>Nessun ordine di lavoro pronto</p>
            </div>
        `;
    } else {
        const sortedReady = [...state.workorders.ready].sort(sortByWorkcenter);
        elements.readyWorkorderGrid.innerHTML = sortedReady
            .map(wo => renderWorkorderCard(wo))
            .join('');
    }
}

/**
 * Renderizza i risultati della ricerca
 */
function renderSearchResults() {
    if (state.searchResults.length === 0) {
        elements.searchResultsList.innerHTML = `
            <div class="empty-state" style="padding: 20px;">
                <p>Nessun risultato trovato</p>
            </div>
        `;
        return;
    }
    
    const html = state.searchResults.map(wo => {
        const productName = wo.product_id ? wo.product_id[1] : '-';
        const workcenterName = wo.workcenter_id ? wo.workcenter_id[1] : '-';
        
        return `
            <div class="search-result-item" onclick="selectSearchResult(${wo.id})">
                <div class="search-result-name">${escapeHtml(wo.display_name || wo.name)}</div>
                <div class="search-result-details">
                    <span>📦 ${escapeHtml(productName)}</span>
                    <span class="search-result-workcenter">🏭 ${escapeHtml(workcenterName)}</span>
                    <span class="search-result-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
                </div>
            </div>
        `;
    }).join('');
    
    elements.searchResultsList.innerHTML = html;
}

// ===============================================
// === SEARCH FUNCTIONS ==========================
// ===============================================

let searchTimeout = null;

/**
 * Gestisce l'input nella barra di ricerca
 */
function handleSearchInput() {
    const term = elements.searchInput.value.trim();
    
    // Mostra/nascondi pulsante clear
    elements.searchClear.classList.toggle('hidden', term.length === 0);
    
    // Aspetta che l'utente finisca di digitare
    clearTimeout(searchTimeout);
    
    if (term.length < 2) {
        hideSearchResults();
        return;
    }
    
    searchTimeout = setTimeout(() => performSearch(term), 300);
}

/**
 * Esegue la ricerca
 */
async function performSearch(term) {
    try {
        const response = await fetch(`/api/workorders/search?q=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error('Errore ricerca');
        
        state.searchResults = await response.json();
        renderSearchResults();
        showSearchResults();
        
    } catch (error) {
        console.error('Errore ricerca:', error);
        showToast('Errore nella ricerca', 'error');
    }
}

/**
 * Mostra il dropdown dei risultati
 */
function showSearchResults() {
    elements.searchResults.classList.remove('hidden');
}

/**
 * Nasconde il dropdown dei risultati
 */
function hideSearchResults() {
    elements.searchResults.classList.add('hidden');
}

/**
 * Pulisce la ricerca
 */
function clearSearch() {
    elements.searchInput.value = '';
    elements.searchClear.classList.add('hidden');
    hideSearchResults();
    state.searchResults = [];
}

/**
 * Seleziona un risultato dalla ricerca
 */
function selectSearchResult(workorderId) {
    const wo = state.searchResults.find(w => w.id === workorderId);
    if (!wo) return;
    
    hideSearchResults();
    
    // Apri il modal per questo work order
    state.selectedWorkorder = wo;
    showWorkorderModal(wo);
}

// ===============================================
// === TABS FUNCTIONS ============================
// ===============================================

/**
 * Cambia tab attivo
 */
function switchTab(tabName) {
    state.activeTab = tabName;
    
    // Aggiorna classi tab
    elements.tabActive.classList.toggle('active', tabName === 'active');
    elements.tabReady.classList.toggle('active', tabName === 'ready');
    
    // Mostra/nascondi contenuto
    elements.tabContentActive.classList.toggle('hidden', tabName !== 'active');
    elements.tabContentReady.classList.toggle('hidden', tabName !== 'ready');
}

// ===============================================
// === EVENT HANDLERS ============================
// ===============================================

/**
 * Carica TUTTI i work orders da Odoo
 */
async function loadAllWorkorders() {
    try {
        const response = await fetch('/api/workorders');
        if (!response.ok) throw new Error('Errore nel caricamento');
        
        state.workorders = await response.json();
        return state.workorders;
        
    } catch (error) {
        console.error('Errore caricamento workorders:', error);
        throw error;
    }
}

/**
 * Seleziona un centro di lavoro e mostra TUTTI i work orders
 */
async function selectWorkcenter(workcenterId) {
    state.selectedWorkcenter = state.workcenters.find(wc => wc.id === workcenterId);
    
    if (!state.selectedWorkcenter) {
        showToast('Centro di lavoro non trovato', 'error');
        return;
    }
    
    elements.selectedWorkcenterName.textContent = state.selectedWorkcenter.name;
    
    // Mostra loading
    elements.activeWorkorderGrid.innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner"></div>
            <p>Caricamento work orders...</p>
        </div>
    `;
    elements.readyWorkorderGrid.innerHTML = elements.activeWorkorderGrid.innerHTML;
    
    // Mostra sezione workorders
    elements.stepWorkcenters.classList.add('hidden');
    elements.stepWorkorders.classList.remove('hidden');
    
    // Carica TUTTI i work orders
    try {
        await loadAllWorkorders();
        renderWorkorders();
        
        // Se ci sono attivi, mostra quella tab, altrimenti mostra pronti
        if (state.workorders.active.length > 0) {
            switchTab('active');
        } else {
            switchTab('ready');
        }
        
    } catch (error) {
        showToast('Errore nel caricamento degli ordini', 'error');
    }
}

/**
 * Torna alla selezione del centro di lavoro
 */
function goBack() {
    state.selectedWorkcenter = null;
    state.workorders = { ready: [], active: [] };
    
    elements.stepWorkorders.classList.add('hidden');
    elements.stepWorkcenters.classList.remove('hidden');
}

/**
 * Mostra il modal per un work order
 */
function showWorkorderModal(wo) {
    elements.modalWorkorderName.textContent = wo.display_name || wo.name;
    
    // Controlla se il workcenter è diverso da quello selezionato
    const currentWcId = wo.workcenter_id ? wo.workcenter_id[0] : null;
    const currentWcName = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    const targetWcName = state.selectedWorkcenter ? state.selectedWorkcenter.name : '-';
    
    const needsReassignment = state.selectedWorkcenter && currentWcId !== state.selectedWorkcenter.id;
    
    if (needsReassignment) {
        elements.modalWorkcenterWarning.classList.remove('hidden');
        elements.modalCurrentWorkcenter.textContent = currentWcName;
        elements.modalTargetWorkcenter.textContent = targetWcName;
    } else {
        elements.modalWorkcenterWarning.classList.add('hidden');
    }
    
    // Mostra modal
    elements.modalOverlay.classList.remove('hidden');
}

/**
 * Seleziona un work order dalla griglia
 */
function selectWorkorder(workorderId, currentState) {
    // Cerca il work order nei dati
    let wo = state.workorders.ready.find(w => w.id === workorderId) ||
             state.workorders.active.find(w => w.id === workorderId) ||
             state.searchResults.find(w => w.id === workorderId);
    
    if (!wo) {
        showToast('Ordine di lavoro non trovato', 'error');
        return;
    }
    
    // Se è già in progress e nel workcenter giusto, non fare nulla
    if (wo.state === 'progress' && 
        state.selectedWorkcenter && 
        wo.workcenter_id && 
        wo.workcenter_id[0] === state.selectedWorkcenter.id) {
        showToast('Questa lavorazione è già attiva su questo centro', 'warning');
        return;
    }
    
    state.selectedWorkorder = wo;
    showWorkorderModal(wo);
}

/**
 * Chiude il modal
 */
function closeModal() {
    elements.modalOverlay.classList.add('hidden');
    state.selectedWorkorder = null;
}

/**
 * Conferma e avvia il work order
 */
async function confirmStart() {
    if (!state.selectedWorkorder) return;
    
    const workorderId = state.selectedWorkorder.id;
    const workorderName = state.selectedWorkorder.display_name || state.selectedWorkorder.name;
    const targetWorkcenterId = state.selectedWorkcenter ? state.selectedWorkcenter.id : null;
    
    elements.btnConfirm.disabled = true;
    elements.btnConfirm.textContent = 'Avvio...';
    
    try {
        const response = await fetch(`/api/workorders/${workorderId}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetWorkcenterId })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Errore durante l\'avvio');
        }
        
        const result = await response.json();
        
        // Messaggio di successo
        let message = `✓ Lavorazione avviata: ${workorderName}`;
        if (result.workcenterChanged) {
            message += ` (riassegnato a ${state.selectedWorkcenter.name})`;
        }
        showToast(message, 'success');
        
        closeModal();
        clearSearch();
        
        // Ricarica TUTTI i work orders
        await loadAllWorkorders();
        renderWorkorders();
        
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

async function loadWorkcenters() {
    try {
        updateConnectionStatus('connecting', 'Connessione a Odoo...');
        
        const testResponse = await fetch('/api/test');
        if (!testResponse.ok) throw new Error('Connessione a Odoo fallita');
        
        updateConnectionStatus('connected', 'Connesso');
        
        const response = await fetch('/api/workcenters');
        if (!response.ok) throw new Error('Errore nel caricamento');
        
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

// Navigazione
elements.btnBack.addEventListener('click', goBack);

// Tabs
elements.tabActive.addEventListener('click', () => switchTab('active'));
elements.tabReady.addEventListener('click', () => switchTab('ready'));

// Modal
elements.btnCancel.addEventListener('click', closeModal);
elements.btnConfirm.addEventListener('click', confirmStart);
elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
});

// Ricerca
elements.searchInput.addEventListener('input', handleSearchInput);
elements.searchClear.addEventListener('click', clearSearch);
elements.btnCloseSearch.addEventListener('click', hideSearchResults);

// Chiudi ricerca cliccando fuori
document.addEventListener('click', (e) => {
    const searchContainer = document.getElementById('searchBarContainer');
    if (!searchContainer.contains(e.target)) {
        hideSearchResults();
    }
});

// --- AVVIO ---
document.addEventListener('DOMContentLoaded', loadWorkcenters);
