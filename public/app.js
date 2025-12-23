// ===============================================
// === APP.JS - v2.2 =============================
// === FIX: Race conditions, Memory leaks ========
// ===============================================

// ===============================================
// === REQUEST MANAGER ===========================
// === Previene race conditions ==================
// ===============================================

const RequestManager = {
    // Mappa delle richieste in corso per tipo
    pending: new Map(),
    
    // Contatore per identificare le richieste
    requestId: 0,
    
    /**
     * Esegue una richiesta cancellando eventuali richieste
     * precedenti dello stesso tipo
     */
    async execute(type, fn) {
        // Genera nuovo ID per questa richiesta
        const id = ++this.requestId;
        this.pending.set(type, id);
        
        try {
            const result = await fn();
            
            // Se nel frattempo è partita un'altra richiesta dello stesso tipo,
            // scarta questo risultato (è obsoleto)
            if (this.pending.get(type) !== id) {
                console.log(`[RequestManager] Risultato scartato per ${type} (obsoleto)`);
                return null;
            }
            
            return result;
        } catch (error) {
            // Propaga l'errore solo se questa richiesta è ancora quella attiva
            if (this.pending.get(type) === id) {
                throw error;
            }
            return null;
        }
    },
    
    /**
     * Cancella tutte le richieste pendenti di un tipo
     */
    cancel(type) {
        this.pending.delete(type);
    },
    
    /**
     * Verifica se c'è una richiesta in corso per un tipo
     */
    isPending(type) {
        return this.pending.has(type);
    }
};

// ===============================================
// === TIMER MANAGER =============================
// === Gestione centralizzata dei timer ==========
// ===============================================

const TimerManager = {
    // Timer per elapsed time dei work order
    elapsedTimers: new Map(),
    
    // Timer per auto-refresh
    autoRefreshTimer: null,
    
    // Stato visibilità pagina
    isPageVisible: true,
    
    /**
     * Inizializza il manager
     */
    init() {
        // Gestione visibilità pagina per risparmiare CPU/batteria
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
            
            if (this.isPageVisible) {
                console.log('[TimerManager] Pagina visibile, riprendo timer');
                this.resumeAll();
            } else {
                console.log('[TimerManager] Pagina nascosta, pauso timer');
                this.pauseAll();
            }
        });
        
        // Cleanup quando l'utente lascia la pagina
        window.addEventListener('beforeunload', () => {
            this.clearAll();
        });
    },
    
    /**
     * Avvia/aggiorna timer elapsed per un work order
     */
    startElapsedTimer(woId, startDate) {
        // Pulisci timer esistente per questo WO
        this.stopElapsedTimer(woId);
        
        if (!startDate || !this.isPageVisible) return;
        
        // Aggiorna subito
        this.updateElapsedDisplay(woId, startDate);
        
        // Poi aggiorna ogni minuto
        const timerId = setInterval(() => {
            if (this.isPageVisible) {
                this.updateElapsedDisplay(woId, startDate);
            }
        }, 60000);
        
        this.elapsedTimers.set(woId, { timerId, startDate });
    },
    
    /**
     * Ferma timer elapsed per un work order
     */
    stopElapsedTimer(woId) {
        const timer = this.elapsedTimers.get(woId);
        if (timer) {
            clearInterval(timer.timerId);
            this.elapsedTimers.delete(woId);
        }
    },
    
    /**
     * Pulisce TUTTI i timer elapsed
     */
    clearAllElapsedTimers() {
        for (const [woId, timer] of this.elapsedTimers) {
            clearInterval(timer.timerId);
        }
        this.elapsedTimers.clear();
    },
    
    /**
     * Aggiorna il display del tempo trascorso
     */
    updateElapsedDisplay(woId, startDate) {
        const el = document.querySelector(`.workorder-card[data-id="${woId}"] .card-timer`);
        if (el) {
            el.textContent = formatElapsedTime(startDate);
        }
    },
    
    /**
     * Sincronizza i timer con i work order attivi
     */
    syncWithWorkorders(activeWorkorders) {
        // Set di WO attivi correnti
        const activeIds = new Set(activeWorkorders.map(wo => wo.id));
        
        // Rimuovi timer per WO non più attivi
        for (const woId of this.elapsedTimers.keys()) {
            if (!activeIds.has(woId)) {
                this.stopElapsedTimer(woId);
            }
        }
        
        // Aggiungi/aggiorna timer per WO attivi
        for (const wo of activeWorkorders) {
            if (wo.date_start) {
                // Avvia solo se non esiste già
                if (!this.elapsedTimers.has(wo.id)) {
                    this.startElapsedTimer(wo.id, wo.date_start);
                }
            }
        }
    },
    
    /**
     * Avvia auto-refresh
     */
    startAutoRefresh(intervalSec, callback) {
        this.stopAutoRefresh();
        
        if (!this.isPageVisible) return;
        
        this.autoRefreshTimer = setInterval(() => {
            if (this.isPageVisible) {
                callback();
            }
        }, intervalSec * 1000);
    },
    
    /**
     * Ferma auto-refresh
     */
    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }
    },
    
    /**
     * Pausa tutti i timer (quando la pagina non è visibile)
     */
    pauseAll() {
        this.stopAutoRefresh();
        // Non fermiamo i timer elapsed, ma controlliamo isPageVisible prima di aggiornare
    },
    
    /**
     * Riprendi tutti i timer
     */
    resumeAll() {
        // Se auto-refresh era attivo, riavvialo
        if (state.autoRefresh && state.selectedWorkcenter) {
            this.startAutoRefresh(state.refreshInterval, () => loadAllWorkorders());
            // Refresh immediato quando si torna sulla pagina
            loadAllWorkorders();
        }
        
        // Aggiorna subito tutti i display elapsed
        for (const [woId, timer] of this.elapsedTimers) {
            this.updateElapsedDisplay(woId, timer.startDate);
        }
    },
    
    /**
     * Pulisce tutto
     */
    clearAll() {
        this.clearAllElapsedTimers();
        this.stopAutoRefresh();
    }
};

// ===============================================
// === DEBOUNCE/THROTTLE =========================
// ===============================================

/**
 * Debounce: esegue la funzione solo dopo che è passato
 * un certo tempo dall'ultima chiamata
 */
function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Throttle: esegue la funzione al massimo una volta
 * ogni `limit` millisecondi
 */
function throttle(fn, limit) {
    let inThrottle = false;
    let lastArgs = null;
    
    return function(...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
                if (lastArgs) {
                    fn.apply(this, lastArgs);
                    lastArgs = null;
                }
            }, limit);
        } else {
            lastArgs = args;
        }
    };
}

// ===============================================
// === STATE =====================================
// ===============================================

const state = {
    workcenters: [],
    selectedWorkcenter: null,
    workorders: { ready: [], active: [] },
    selectedWorkorder: null,
    searchResults: [],
    activeTab: 'active',
    autoRefresh: false,
    refreshInterval: 30,
    darkMode: false,
    compactView: false,
    filterCurrentWorkcenter: false,
    filterCompatible: true,
    
    // Flag per prevenire azioni multiple
    isLoading: false,
    isActionInProgress: false
};

const $ = id => document.getElementById(id);

// ===============================================
// === UTILITIES =================================
// ===============================================

const escapeHtml = text => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

const formatDuration = minutes => {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatElapsedTime = startDate => {
    if (!startDate) return '-';
    const diffMins = Math.floor((new Date() - new Date(startDate)) / 60000);
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const formatDateTime = iso => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const normalizeOpType = type => (type || '').toLowerCase().trim();

const isCompatible = (wo, wc) => {
    if (!wo || !wc) return true;
    const woType = normalizeOpType(wo.operation_type);
    const wcType = normalizeOpType(wc.operation_type);
    if (!woType || !wcType) return true;
    return woType === wcType;
};

// ===============================================
// === UI FUNCTIONS ==============================
// ===============================================

function updateConnectionStatus(status, message) {
    const el = $('connectionStatus');
    const dot = el.querySelector('.status-dot');
    const text = el.querySelector('.status-text');
    dot.className = 'status-dot' + (status === 'connected' ? ' connected' : status === 'error' ? ' error' : '');
    text.textContent = message;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    $('toastContainer').appendChild(toast);
    if (navigator.vibrate && (type === 'success' || type === 'error')) {
        navigator.vibrate(type === 'success' ? 100 : [100, 50, 100]);
    }
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

const setLoading = (grid, msg = 'Caricamento...') => {
    grid.innerHTML = `<div class="loading-placeholder"><div class="spinner"></div><p>${msg}</p></div>`;
};

const setEmpty = (grid, icon, msg) => {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
};

/**
 * Imposta stato di caricamento globale
 */
function setGlobalLoading(loading) {
    state.isLoading = loading;
    $('btnRefresh').disabled = loading;
    $('btnRefresh').textContent = loading ? '⏳' : '🔄';
}

// ===============================================
// === SETTINGS ==================================
// ===============================================

function toggleTheme() {
    state.darkMode = !state.darkMode;
    document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
    $('btnToggleTheme').textContent = state.darkMode ? '☀️' : '🌙';
    localStorage.setItem('darkMode', state.darkMode);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => showToast('Fullscreen non disponibile', 'warning'));
    } else {
        document.exitFullscreen();
    }
}

function loadSettings() {
    state.darkMode = localStorage.getItem('darkMode') === 'true';
    if (state.darkMode) {
        document.documentElement.setAttribute('data-theme', 'dark');
        $('btnToggleTheme').textContent = '☀️';
    }
    state.autoRefresh = localStorage.getItem('autoRefresh') === 'true';
    $('autoRefreshToggle').checked = state.autoRefresh;
    state.refreshInterval = parseInt(localStorage.getItem('refreshInterval') || '30');
    $('refreshInterval').value = state.refreshInterval;
    state.filterCompatible = localStorage.getItem('filterCompatible') !== 'false';
    $('filterCompatible').checked = state.filterCompatible;
}

// ===============================================
// === AUTO-REFRESH ==============================
// ===============================================

function startAutoRefresh() {
    if (state.autoRefresh && state.selectedWorkcenter) {
        TimerManager.startAutoRefresh(state.refreshInterval, () => loadAllWorkorders());
    }
}

function stopAutoRefresh() {
    TimerManager.stopAutoRefresh();
}

function toggleAutoRefresh() {
    state.autoRefresh = $('autoRefreshToggle').checked;
    localStorage.setItem('autoRefresh', state.autoRefresh);
    if (state.autoRefresh) {
        startAutoRefresh();
        showToast(`Auto-refresh ogni ${state.refreshInterval}s`, 'info');
    } else {
        stopAutoRefresh();
    }
}

function changeRefreshInterval() {
    state.refreshInterval = parseInt($('refreshInterval').value);
    localStorage.setItem('refreshInterval', state.refreshInterval);
    if (state.autoRefresh) startAutoRefresh();
}

// ===============================================
// === RENDER ====================================
// ===============================================

function renderWorkcenters() {
    const grid = $('workcenterGrid');
    if (state.workcenters.length === 0) {
        setEmpty(grid, '🏭', 'Nessun centro trovato');
        return;
    }
    
    grid.innerHTML = state.workcenters.map(wc => {
        const opType = normalizeOpType(wc.operation_type);
        const badgeClass = opType || '';
        
        return `
            <div class="workcenter-card" data-id="${wc.id}" data-color="${wc.color || 0}" onclick="selectWorkcenter(${wc.id})">
                <div class="card-name">${escapeHtml(wc.name)}</div>
                ${wc.code ? `<div class="card-code">${escapeHtml(wc.code)}</div>` : ''}
                ${wc.operation_type ? `<div class="operation-badge ${badgeClass}">${escapeHtml(wc.operation_type)}</div>` : ''}
                <div class="card-counts">
                    <span class="count-badge active">🔄 ${wc.progress_count || 0}</span>
                    <span class="count-badge ready">⏳ ${wc.ready_count || 0}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderWorkorderCard(wo) {
    const productName = wo.product_id ? wo.product_id[1] : '-';
    const workcenterName = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    const wcId = wo.workcenter_id ? wo.workcenter_id[0] : null;
    const isCurrent = state.selectedWorkcenter && wcId === state.selectedWorkcenter.id;
    
    const compatible = isCompatible(wo, state.selectedWorkcenter);
    
    if (state.filterCompatible && !compatible) return '';
    if (state.filterCurrentWorkcenter && !isCurrent) return '';
    
    const classes = ['workorder-card'];
    if (wo.state === 'progress') classes.push('active');
    if (!isCurrent) classes.push('other-workcenter');
    if (!compatible) classes.push('incompatible');
    
    const elapsed = wo.state === 'progress' && wo.date_start ? formatElapsedTime(wo.date_start) : null;
    const opType = normalizeOpType(wo.operation_type);
    
    return `
        <div class="${classes.join(' ')}" data-id="${wo.id}" onclick="selectWorkorder(${wo.id})">
            ${elapsed ? `<div class="card-timer">${elapsed}</div>` : ''}
            ${wo.operation_type ? `<span class="operation-badge ${opType}">${escapeHtml(wo.operation_type)}</span>` : ''}
            <div class="card-header" style="margin-top: ${wo.operation_type ? '20px' : '0'}">
                <div class="card-name">${escapeHtml(wo.display_name || wo.name)}</div>
                <div class="card-product">📦 ${escapeHtml(productName)}</div>
                <div class="card-workcenter ${isCurrent ? 'same' : 'different'}">🏭 ${escapeHtml(workcenterName)}${isCurrent ? '' : ' ⚠️'}</div>
            </div>
            <div class="card-details">
                <span>📊 Qtà: ${wo.qty_remaining || wo.qty_producing || '-'}</span>
                <span>⏱️ ${formatDuration(wo.duration_expected)}</span>
            </div>
            <span class="card-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
        </div>
    `;
}

function renderWorkorders() {
    const activeGrid = $('activeWorkorderGrid');
    const readyGrid = $('readyWorkorderGrid');
    
    const filterWo = wo => {
        const compatible = isCompatible(wo, state.selectedWorkcenter);
        const isCurrent = wo.workcenter_id?.[0] === state.selectedWorkcenter?.id;
        if (state.filterCompatible && !compatible) return false;
        if (state.filterCurrentWorkcenter && !isCurrent) return false;
        return true;
    };
    
    const activeFiltered = state.workorders.active.filter(filterWo);
    const readyFiltered = state.workorders.ready.filter(filterWo);
    
    $('countActive').textContent = activeFiltered.length;
    $('countReady').textContent = readyFiltered.length;
    
    const totalActive = state.workorders.active.length;
    
    let infoText = '';
    if (activeFiltered.length > 0) {
        infoText = `${activeFiltered.length} attive`;
        if (activeFiltered.length < totalActive) {
            infoText += ` (${totalActive - activeFiltered.length} nascoste)`;
        }
    }
    $('activeInfoText').textContent = infoText;
    
    const sortFn = (a, b) => {
        const aOk = a.workcenter_id?.[0] === state.selectedWorkcenter?.id;
        const bOk = b.workcenter_id?.[0] === state.selectedWorkcenter?.id;
        return aOk === bOk ? 0 : aOk ? -1 : 1;
    };
    
    if (activeFiltered.length === 0) {
        setEmpty(activeGrid, '✨', state.filterCompatible ? 'Nessuna lavorazione compatibile attiva' : 'Nessuna lavorazione attiva');
    } else {
        activeGrid.innerHTML = [...state.workorders.active].sort(sortFn).map(renderWorkorderCard).join('');
    }
    
    if (readyFiltered.length === 0) {
        setEmpty(readyGrid, '📋', state.filterCompatible ? 'Nessun ordine compatibile pronto' : 'Nessun ordine pronto');
    } else {
        readyGrid.innerHTML = [...state.workorders.ready].sort(sortFn).map(renderWorkorderCard).join('');
    }
    
    // Sincronizza timer con i WO attivi visualizzati
    TimerManager.syncWithWorkorders(state.workorders.active);
}

function renderSearchResults() {
    const list = $('searchResultsList');
    if (state.searchResults.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Nessun risultato</p></div>';
        return;
    }
    list.innerHTML = state.searchResults.map(wo => {
        const opType = normalizeOpType(wo.operation_type);
        return `
            <div class="search-result-item" onclick="selectSearchResult(${wo.id})">
                <div class="search-result-name">
                    ${wo.operation_type ? `<span class="operation-badge ${opType}" style="position:static;margin-right:6px;">${escapeHtml(wo.operation_type)}</span>` : ''}
                    ${escapeHtml(wo.display_name || wo.name)}
                </div>
                <div class="search-result-details">
                    <span>📦 ${escapeHtml(wo.product_id?.[1] || '-')}</span>
                    <span>🏭 ${escapeHtml(wo.workcenter_id?.[1] || '-')}</span>
                    <span class="search-result-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ===============================================
// === SEARCH (con debounce) =====================
// ===============================================

// Debounced search - aspetta 300ms dopo l'ultima digitazione
const debouncedSearch = debounce(async (term) => {
    try {
        const result = await RequestManager.execute('search', async () => {
            const res = await fetch(`/api/workorders/search?q=${encodeURIComponent(term)}`);
            if (!res.ok) throw new Error();
            return res.json();
        });
        
        // Se la richiesta è stata cancellata, result è null
        if (result !== null) {
            state.searchResults = result;
            renderSearchResults();
            showSearchResults();
        }
    } catch {
        showToast('Errore ricerca', 'error');
    }
}, 300);

function handleSearchInput() {
    const term = $('searchInput').value.trim();
    $('searchClear').classList.toggle('hidden', term.length === 0);
    
    if (term.length < 2) {
        RequestManager.cancel('search');
        hideSearchResults();
        return;
    }
    
    debouncedSearch(term);
}

const showSearchResults = () => $('searchResults').classList.remove('hidden');
const hideSearchResults = () => $('searchResults').classList.add('hidden');
const clearSearch = () => { 
    $('searchInput').value = ''; 
    $('searchClear').classList.add('hidden'); 
    hideSearchResults(); 
    state.searchResults = [];
    RequestManager.cancel('search');
};

function selectSearchResult(id) {
    const wo = state.searchResults.find(w => w.id === id);
    if (wo) { hideSearchResults(); state.selectedWorkorder = wo; showWorkorderModal(wo); }
}

// ===============================================
// === TABS ======================================
// ===============================================

function switchTab(tab) {
    state.activeTab = tab;
    $('tabActive').classList.toggle('active', tab === 'active');
    $('tabReady').classList.toggle('active', tab === 'ready');
    $('tabContentActive').classList.toggle('hidden', tab !== 'active');
    $('tabContentReady').classList.toggle('hidden', tab !== 'ready');
}

// ===============================================
// === DATA LOADING (con throttle) ===============
// ===============================================

// Throttled refresh - al massimo ogni 2 secondi
const throttledRefresh = throttle(async () => {
    if (state.selectedWorkcenter) {
        await loadAllWorkorders();
    } else {
        await loadWorkcenters();
    }
}, 2000);

async function loadWorkcenters() {
    if (state.isLoading) return;
    
    try {
        setGlobalLoading(true);
        updateConnectionStatus('connecting', 'Connessione...');
        
        const result = await RequestManager.execute('workcenters', async () => {
            const test = await fetch('/api/test');
            if (!test.ok) throw new Error('Test connessione fallito');
            
            const res = await fetch('/api/workcenters');
            if (!res.ok) throw new Error('Errore caricamento workcenters');
            return res.json();
        });
        
        if (result !== null) {
            updateConnectionStatus('connected', 'Connesso');
            state.workcenters = result;
            renderWorkcenters();
        }
    } catch (e) {
        updateConnectionStatus('error', 'Errore');
        showToast('Connessione fallita', 'error');
        setEmpty($('workcenterGrid'), '⚠️', 'Errore connessione');
    } finally {
        setGlobalLoading(false);
    }
}

async function loadAllWorkorders() {
    if (state.isLoading) return;
    
    try {
        setGlobalLoading(true);
        
        const result = await RequestManager.execute('workorders', async () => {
            const res = await fetch('/api/workorders');
            if (!res.ok) throw new Error('Errore caricamento workorders');
            return res.json();
        });
        
        if (result !== null) {
            state.workorders = result;
            renderWorkorders();
        }
    } catch {
        showToast('Errore caricamento', 'error');
    } finally {
        setGlobalLoading(false);
    }
}

// ===============================================
// === WORKCENTER SELECTION ======================
// ===============================================

async function selectWorkcenter(id) {
    state.selectedWorkcenter = state.workcenters.find(wc => wc.id === id);
    if (!state.selectedWorkcenter) { showToast('Centro non trovato', 'error'); return; }
    
    $('selectedWorkcenterName').textContent = state.selectedWorkcenter.name;
    const badge = $('workcenterTypeBadge');
    if (state.selectedWorkcenter.operation_type) {
        badge.textContent = state.selectedWorkcenter.operation_type;
        badge.className = 'workcenter-type-badge ' + normalizeOpType(state.selectedWorkcenter.operation_type);
    } else {
        badge.textContent = '';
        badge.className = 'workcenter-type-badge';
    }
    
    setLoading($('activeWorkorderGrid'));
    setLoading($('readyWorkorderGrid'));
    
    $('stepWorkcenters').classList.add('hidden');
    $('stepWorkorders').classList.remove('hidden');
    
    await loadAllWorkorders();
    switchTab(state.workorders.active.length > 0 ? 'active' : 'ready');
    startAutoRefresh();
}

function goBack() {
    state.selectedWorkcenter = null;
    state.workorders = { ready: [], active: [] };
    
    // Cleanup completo
    stopAutoRefresh();
    TimerManager.clearAllElapsedTimers();
    RequestManager.cancel('workorders');
    
    $('stepWorkorders').classList.add('hidden');
    $('stepWorkcenters').classList.remove('hidden');
    loadWorkcenters();
}

// ===============================================
// === WORKORDER MODAL ===========================
// ===============================================

function selectWorkorder(id) {
    const wo = state.workorders.ready.find(w => w.id === id) || 
               state.workorders.active.find(w => w.id === id) || 
               state.searchResults.find(w => w.id === id);
    if (!wo) { showToast('Work order non trovato', 'error'); return; }
    state.selectedWorkorder = wo;
    showWorkorderModal(wo);
}

function showWorkorderModal(wo) {
    $('modalTitle').textContent = wo.state === 'progress' ? 'Gestisci Lavorazione' : 'Avvia Lavorazione';
    $('modalWorkorderName').textContent = wo.display_name || wo.name;
    $('modalProductName').textContent = wo.product_id ? wo.product_id[1] : '-';
    $('modalOperationType').textContent = wo.operation_type || '-';
    $('modalQty').textContent = wo.qty_remaining || wo.qty_producing || '-';
    $('modalCurrentWorkcenter').textContent = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    
    const durationRow = $('modalDurationRow');
    if (wo.state === 'progress' && wo.date_start) {
        durationRow.classList.remove('hidden');
        $('modalDuration').textContent = formatElapsedTime(wo.date_start);
    } else {
        durationRow.classList.add('hidden');
    }
    
    const wcId = wo.workcenter_id ? wo.workcenter_id[0] : null;
    const needsReassign = state.selectedWorkcenter && wcId !== state.selectedWorkcenter.id;
    const compatible = isCompatible(wo, state.selectedWorkcenter);
    
    const reassignWarning = $('modalWorkcenterWarning');
    if (needsReassign) {
        reassignWarning.classList.remove('hidden');
        $('modalTargetWorkcenter').textContent = state.selectedWorkcenter.name;
    } else {
        reassignWarning.classList.add('hidden');
    }
    
    const incompatWarning = $('modalIncompatibleWarning');
    if (!compatible && state.selectedWorkcenter) {
        incompatWarning.classList.remove('hidden');
        $('modalWoOpType').textContent = wo.operation_type || '?';
        $('modalWcOpType').textContent = state.selectedWorkcenter.operation_type || '?';
    } else {
        incompatWarning.classList.add('hidden');
    }
    
    const actions = $('modalActions');
    if (wo.state === 'ready') {
        const btnClass = compatible ? 'btn-success' : 'btn-danger';
        const btnText = compatible ? '▶️ Avvia' : '⚠️ Avvia comunque';
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Annulla</button>
            <button class="btn btn-info" onclick="showDetails(${wo.id})">📋 Dettagli</button>
            <button class="btn ${btnClass}" id="btnConfirmStart" onclick="confirmStart()">${btnText}</button>
        `;
    } else if (wo.state === 'progress') {
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Annulla</button>
            <button class="btn btn-info" onclick="showDetails(${wo.id})">📋 Dettagli</button>
            <button class="btn btn-warning" id="btnConfirmPause" onclick="confirmPause()">⏸️ Pausa</button>
            <button class="btn btn-success" id="btnConfirmComplete" onclick="confirmComplete()">✅ Completa</button>
        `;
    }
    
    $('modalOverlay').classList.remove('hidden');
}

const closeModal = () => { 
    $('modalOverlay').classList.add('hidden'); 
    state.selectedWorkorder = null; 
    state.isActionInProgress = false;
};

// ===============================================
// === ACTIONS (con protezione doppio click) =====
// ===============================================

async function confirmStart() {
    if (!state.selectedWorkorder || state.isActionInProgress) return;
    
    state.isActionInProgress = true;
    const wo = state.selectedWorkorder;
    const btn = $('btnConfirmStart');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Avvio...';
    
    try {
        const res = await fetch(`/api/workorders/${wo.id}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetWorkcenterId: state.selectedWorkcenter?.id })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        const result = await res.json();
        
        let msg = `✓ Avviato: ${wo.display_name || wo.name}`;
        if (result.workcenterChanged) msg += ' (riassegnato)';
        showToast(msg, 'success');
        
        closeModal();
        clearSearch();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
        state.isActionInProgress = false;
    }
}

async function confirmPause() {
    if (!state.selectedWorkorder || state.isActionInProgress) return;
    
    state.isActionInProgress = true;
    const wo = state.selectedWorkorder;
    const btn = $('btnConfirmPause');
    btn.disabled = true;
    btn.textContent = 'Pausa...';
    
    try {
        const res = await fetch(`/api/workorders/${wo.id}/pause`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(`⏸️ In pausa: ${wo.display_name || wo.name}`, 'success');
        closeModal();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
        btn.disabled = false;
        btn.textContent = '⏸️ Pausa';
        state.isActionInProgress = false;
    }
}

async function confirmComplete() {
    if (!state.selectedWorkorder || state.isActionInProgress) return;
    
    state.isActionInProgress = true;
    const wo = state.selectedWorkorder;
    const btn = $('btnConfirmComplete');
    btn.disabled = true;
    btn.textContent = 'Completo...';
    
    try {
        const res = await fetch(`/api/workorders/${wo.id}/complete`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(`✅ Completato: ${wo.display_name || wo.name}`, 'success');
        closeModal();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
        btn.disabled = false;
        btn.textContent = '✅ Completa';
        state.isActionInProgress = false;
    }
}

// ===============================================
// === DETAILS MODAL =============================
// ===============================================

async function showDetails(id) {
    $('detailsModalOverlay').classList.remove('hidden');
    $('detailsContent').innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
    $('timeTrackingList').innerHTML = '';
    
    try {
        const [detailsRes, timeRes] = await Promise.all([
            fetch(`/api/workorders/${id}/details`),
            fetch(`/api/workorders/${id}/timetracking`)
        ]);
        
        if (!detailsRes.ok) throw new Error();
        const d = await detailsRes.json();
        
        $('detailsContent').innerHTML = `
            <div class="modal-workorder-info">
                <div class="info-row"><span class="info-label">Work Order:</span><span class="info-value">${escapeHtml(d.display_name || d.name)}</span></div>
                <div class="info-row"><span class="info-label">Prodotto:</span><span class="info-value">${escapeHtml(d.product_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Operazione:</span><span class="info-value">${escapeHtml(d.operation_type || '-')}</span></div>
                <div class="info-row"><span class="info-label">Produzione:</span><span class="info-value">${escapeHtml(d.production_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Centro:</span><span class="info-value">${escapeHtml(d.workcenter_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Stato:</span><span class="info-value">${d.state}</span></div>
                <div class="info-row"><span class="info-label">Quantità:</span><span class="info-value">${d.qty_remaining || d.qty_producing || '-'}</span></div>
                <div class="info-row"><span class="info-label">Durata prevista:</span><span class="info-value">${formatDuration(d.duration_expected)}</span></div>
                <div class="info-row"><span class="info-label">Durata effettiva:</span><span class="info-value">${formatDuration(d.duration)}</span></div>
            </div>
            ${d.operation_note ? `<div class="modal-notes"><h4>Note:</h4><div class="notes-content">${escapeHtml(d.operation_note)}</div></div>` : ''}
        `;
        
        if (timeRes.ok) {
            const logs = await timeRes.json();
            $('timeTrackingList').innerHTML = logs.length > 0 
                ? logs.map(l => `<div class="time-log-item"><span class="time-log-date">${formatDateTime(l.date_start)} - ${formatDateTime(l.date_end)}</span><span class="time-log-duration">${formatDuration(l.duration)}</span></div>`).join('')
                : '<p style="color:var(--text-muted);font-size:0.85rem;">Nessun log</p>';
        }
    } catch {
        $('detailsContent').innerHTML = '<p style="color:var(--color-danger);">Errore caricamento</p>';
    }
}

const closeDetailsModal = () => $('detailsModalOverlay').classList.add('hidden');

// ===============================================
// === FILTER HANDLERS ===========================
// ===============================================

function toggleFilterCompatible() {
    state.filterCompatible = $('filterCompatible').checked;
    localStorage.setItem('filterCompatible', state.filterCompatible);
    renderWorkorders();
}

function toggleFilterCurrentWorkcenter() {
    state.filterCurrentWorkcenter = $('filterCurrentWorkcenter').checked;
    renderWorkorders();
}

function toggleCompactView() {
    state.compactView = $('filterCompactView').checked;
    $('stepWorkorders').classList.toggle('compact', state.compactView);
}

// ===============================================
// === EVENT LISTENERS ===========================
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    // Inizializza TimerManager
    TimerManager.init();
    
    loadSettings();
    loadWorkcenters();
    
    // Usa throttledRefresh per il pulsante refresh
    $('btnRefresh').addEventListener('click', throttledRefresh);
    $('autoRefreshToggle').addEventListener('change', toggleAutoRefresh);
    $('refreshInterval').addEventListener('change', changeRefreshInterval);
    $('btnToggleTheme').addEventListener('click', toggleTheme);
    $('btnFullscreen').addEventListener('click', toggleFullscreen);
    
    $('searchInput').addEventListener('input', handleSearchInput);
    $('searchClear').addEventListener('click', clearSearch);
    $('btnCloseSearch').addEventListener('click', hideSearchResults);
    
    $('btnBack').addEventListener('click', goBack);
    $('tabActive').addEventListener('click', () => switchTab('active'));
    $('tabReady').addEventListener('click', () => switchTab('ready'));
    
    $('filterCompatible').addEventListener('change', toggleFilterCompatible);
    $('filterCurrentWorkcenter').addEventListener('change', toggleFilterCurrentWorkcenter);
    $('filterCompactView').addEventListener('change', toggleCompactView);
    
    $('modalClose').addEventListener('click', closeModal);
    $('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });
    
    $('detailsModalClose').addEventListener('click', closeDetailsModal);
    $('btnCloseDetails').addEventListener('click', closeDetailsModal);
    $('detailsModalOverlay').addEventListener('click', e => { if (e.target === $('detailsModalOverlay')) closeDetailsModal(); });
    
    document.addEventListener('click', e => { if (!$('toolbar').contains(e.target)) hideSearchResults(); });
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
