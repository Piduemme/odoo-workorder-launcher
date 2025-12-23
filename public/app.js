// ===============================================
// === APP.JS - v2.1 =============================
// === + Filtro operazioni compatibili ===========
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
    filterCompatible: true,  // NUOVO: filtro compatibilità
    refreshTimer: null,
    elapsedTimers: {}
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

/**
 * Normalizza il tipo operazione per confronto
 * es. "Estrusione" -> "estrusione"
 */
const normalizeOpType = type => (type || '').toLowerCase().trim();

/**
 * Verifica se un work order è compatibile con un workcenter
 */
const isCompatible = (wo, wc) => {
    if (!wo || !wc) return true;
    
    const woType = normalizeOpType(wo.operation_type);
    const wcType = normalizeOpType(wc.operation_type);
    
    // Se uno dei due non ha tipo, considera compatibile
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
    
    // Filtro compatibile default true
    state.filterCompatible = localStorage.getItem('filterCompatible') !== 'false';
    $('filterCompatible').checked = state.filterCompatible;
}

// ===============================================
// === AUTO-REFRESH ==============================
// ===============================================

function startAutoRefresh() {
    stopAutoRefresh();
    if (state.autoRefresh && state.selectedWorkcenter) {
        state.refreshTimer = setInterval(() => loadAllWorkorders(), state.refreshInterval * 1000);
    }
}

function stopAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
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
// === ELAPSED TIMERS ============================
// ===============================================

function startElapsedTimers() {
    Object.values(state.elapsedTimers).forEach(t => clearInterval(t));
    state.elapsedTimers = {};
    state.workorders.active.forEach(wo => {
        if (wo.date_start) {
            updateElapsedTime(wo.id, wo.date_start);
            state.elapsedTimers[wo.id] = setInterval(() => updateElapsedTime(wo.id, wo.date_start), 60000);
        }
    });
}

function updateElapsedTime(id, startDate) {
    const el = document.querySelector(`.workorder-card[data-id="${id}"] .card-timer`);
    if (el) el.textContent = formatElapsedTime(startDate);
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
    
    // Verifica compatibilità
    const compatible = isCompatible(wo, state.selectedWorkcenter);
    
    // Se filtro attivo e non compatibile, nascondi
    if (state.filterCompatible && !compatible) return '';
    
    // Se filtro "solo questo centro" attivo
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
    
    // Filtra in base ai criteri attivi
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
    const totalReady = state.workorders.ready.length;
    
    // Info con conteggi filtrati vs totali
    let infoText = '';
    if (activeFiltered.length > 0) {
        infoText = `${activeFiltered.length} attive`;
        if (activeFiltered.length < totalActive) {
            infoText += ` (${totalActive - activeFiltered.length} nascoste)`;
        }
    }
    $('activeInfoText').textContent = infoText;
    
    // Ordina: prima quelli del centro selezionato
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
    
    startElapsedTimers();
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
// === SEARCH ====================================
// ===============================================

let searchTimeout = null;

function handleSearchInput() {
    const term = $('searchInput').value.trim();
    $('searchClear').classList.toggle('hidden', term.length === 0);
    clearTimeout(searchTimeout);
    if (term.length < 2) { hideSearchResults(); return; }
    searchTimeout = setTimeout(() => performSearch(term), 300);
}

async function performSearch(term) {
    try {
        const res = await fetch(`/api/workorders/search?q=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error();
        state.searchResults = await res.json();
        renderSearchResults();
        showSearchResults();
    } catch { showToast('Errore ricerca', 'error'); }
}

const showSearchResults = () => $('searchResults').classList.remove('hidden');
const hideSearchResults = () => $('searchResults').classList.add('hidden');
const clearSearch = () => { $('searchInput').value = ''; $('searchClear').classList.add('hidden'); hideSearchResults(); state.searchResults = []; };

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
// === DATA LOADING ==============================
// ===============================================

async function loadWorkcenters() {
    try {
        updateConnectionStatus('connecting', 'Connessione...');
        const test = await fetch('/api/test');
        if (!test.ok) throw new Error();
        updateConnectionStatus('connected', 'Connesso');
        const res = await fetch('/api/workcenters');
        if (!res.ok) throw new Error();
        state.workcenters = await res.json();
        renderWorkcenters();
    } catch {
        updateConnectionStatus('error', 'Errore');
        showToast('Connessione fallita', 'error');
        setEmpty($('workcenterGrid'), '⚠️', 'Errore connessione');
    }
}

async function loadAllWorkorders() {
    try {
        const res = await fetch('/api/workorders');
        if (!res.ok) throw new Error();
        state.workorders = await res.json();
        renderWorkorders();
    } catch { showToast('Errore caricamento', 'error'); }
}

// ===============================================
// === WORKCENTER SELECTION ======================
// ===============================================

async function selectWorkcenter(id) {
    state.selectedWorkcenter = state.workcenters.find(wc => wc.id === id);
    if (!state.selectedWorkcenter) { showToast('Centro non trovato', 'error'); return; }
    
    // Aggiorna header con nome e badge tipo
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
    stopAutoRefresh();
    Object.values(state.elapsedTimers).forEach(t => clearInterval(t));
    state.elapsedTimers = {};
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
    
    // Durata per work order attivi
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
    
    // Warning riassegnazione (giallo)
    const reassignWarning = $('modalWorkcenterWarning');
    if (needsReassign) {
        reassignWarning.classList.remove('hidden');
        $('modalTargetWorkcenter').textContent = state.selectedWorkcenter.name;
    } else {
        reassignWarning.classList.add('hidden');
    }
    
    // Warning INCOMPATIBILITÀ (rosso)
    const incompatWarning = $('modalIncompatibleWarning');
    if (!compatible && state.selectedWorkcenter) {
        incompatWarning.classList.remove('hidden');
        $('modalWoOpType').textContent = wo.operation_type || '?';
        $('modalWcOpType').textContent = state.selectedWorkcenter.operation_type || '?';
    } else {
        incompatWarning.classList.add('hidden');
    }
    
    // Pulsanti
    const actions = $('modalActions');
    if (wo.state === 'ready') {
        const btnClass = compatible ? 'btn-success' : 'btn-danger';
        const btnText = compatible ? '▶️ Avvia' : '⚠️ Avvia comunque';
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Annulla</button>
            <button class="btn btn-info" onclick="showDetails(${wo.id})">📋 Dettagli</button>
            <button class="btn ${btnClass}" onclick="confirmStart()">${btnText}</button>
        `;
    } else if (wo.state === 'progress') {
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Annulla</button>
            <button class="btn btn-info" onclick="showDetails(${wo.id})">📋 Dettagli</button>
            <button class="btn btn-warning" onclick="confirmPause()">⏸️ Pausa</button>
            <button class="btn btn-success" onclick="confirmComplete()">✅ Completa</button>
        `;
    }
    
    $('modalOverlay').classList.remove('hidden');
}

const closeModal = () => { $('modalOverlay').classList.add('hidden'); state.selectedWorkorder = null; };

// ===============================================
// === ACTIONS ===================================
// ===============================================

async function confirmStart() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelector('.btn-success, .btn-danger');
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
    } finally {
        btn.disabled = false;
    }
}

async function confirmPause() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelector('.btn-warning');
    btn.disabled = true;
    
    try {
        const res = await fetch(`/api/workorders/${wo.id}/pause`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(`⏸️ In pausa: ${wo.display_name || wo.name}`, 'success');
        closeModal();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function confirmComplete() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelectorAll('.btn-success')[0];
    btn.disabled = true;
    
    try {
        const res = await fetch(`/api/workorders/${wo.id}/complete`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast(`✅ Completato: ${wo.display_name || wo.name}`, 'success');
        closeModal();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
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
    loadSettings();
    loadWorkcenters();
    
    $('btnRefresh').addEventListener('click', () => state.selectedWorkcenter ? loadAllWorkorders() : loadWorkcenters());
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
