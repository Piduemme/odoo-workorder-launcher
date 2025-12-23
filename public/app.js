// ===============================================
// === APP.JS - FRONTEND APPLICATION v2.0 ========
// ===============================================

// --- STATO APPLICAZIONE ---
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
    refreshTimer: null,
    elapsedTimers: {}
};

// --- UTILITIES ---
const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(minutes) {
    if (!minutes) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatElapsedTime(startDate) {
    if (!startDate) return '-';
    const start = new Date(startDate);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatDateTime(isoDate) {
    if (!isoDate) return '-';
    return new Date(isoDate).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// --- UI FUNCTIONS ---
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

function setLoading(grid, msg = 'Caricamento...') {
    grid.innerHTML = `<div class="loading-placeholder"><div class="spinner"></div><p>${msg}</p></div>`;
}

function setEmpty(grid, icon, msg) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

// --- THEME & SETTINGS ---
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
}

// --- AUTO-REFRESH ---
function startAutoRefresh() {
    stopAutoRefresh();
    if (state.autoRefresh && state.selectedWorkcenter) {
        state.refreshTimer = setInterval(() => {
            console.log('[AUTO-REFRESH] Aggiornamento...');
            loadAllWorkorders();
        }, state.refreshInterval * 1000);
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
        showToast(`Auto-refresh attivato (ogni ${state.refreshInterval}s)`, 'info');
    } else {
        stopAutoRefresh();
        showToast('Auto-refresh disattivato', 'info');
    }
}

function changeRefreshInterval() {
    state.refreshInterval = parseInt($('refreshInterval').value);
    localStorage.setItem('refreshInterval', state.refreshInterval);
    if (state.autoRefresh) startAutoRefresh();
}

// --- ELAPSED TIMERS ---
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

function updateElapsedTime(workorderId, startDate) {
    const el = document.querySelector(`.workorder-card[data-id="${workorderId}"] .card-timer`);
    if (el) el.textContent = formatElapsedTime(startDate);
}

// --- RENDER ---
function renderWorkcenters() {
    const grid = $('workcenterGrid');
    if (state.workcenters.length === 0) {
        setEmpty(grid, '🏭', 'Nessun centro di lavoro trovato');
        return;
    }
    grid.innerHTML = state.workcenters.map(wc => `
        <div class="workcenter-card" data-id="${wc.id}" data-color="${wc.color || 0}" onclick="selectWorkcenter(${wc.id})">
            <div class="card-name">${escapeHtml(wc.name)}</div>
            ${wc.code ? `<div class="card-code">${escapeHtml(wc.code)}</div>` : ''}
            <div class="card-counts">
                <span class="count-badge active">🔄 ${wc.progress_count || 0}</span>
                <span class="count-badge ready">⏳ ${wc.ready_count || 0}</span>
            </div>
        </div>
    `).join('');
}

function renderWorkorderCard(wo) {
    const productName = wo.product_id ? wo.product_id[1] : '-';
    const workcenterName = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    const wcId = wo.workcenter_id ? wo.workcenter_id[0] : null;
    const isCurrent = state.selectedWorkcenter && wcId === state.selectedWorkcenter.id;
    
    if (state.filterCurrentWorkcenter && !isCurrent) return '';
    
    const classes = ['workorder-card'];
    if (wo.state === 'progress') classes.push('active');
    if (!isCurrent) classes.push('other-workcenter');
    
    const elapsed = wo.state === 'progress' && wo.date_start ? formatElapsedTime(wo.date_start) : null;
    
    return `
        <div class="${classes.join(' ')}" data-id="${wo.id}" onclick="selectWorkorder(${wo.id})">
            ${elapsed ? `<div class="card-timer">${elapsed}</div>` : ''}
            <div class="card-header">
                <div class="card-name">${escapeHtml(wo.display_name || wo.name)}</div>
                <div class="card-product">📦 ${escapeHtml(productName)}</div>
                <div class="card-workcenter ${isCurrent ? 'same' : 'different'}">🏭 ${escapeHtml(workcenterName)}${isCurrent ? '' : ' ⚠️'}</div>
            </div>
            <div class="card-details">
                <span>📊 Qtà: ${wo.qty_remaining || wo.qty_producing || '-'}</span>
                <span>⏱️ Previsto: ${formatDuration(wo.duration_expected)}</span>
            </div>
            <span class="card-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
        </div>
    `;
}

function renderWorkorders() {
    const activeGrid = $('activeWorkorderGrid');
    const readyGrid = $('readyWorkorderGrid');
    
    const sortFn = (a, b) => {
        const aOk = a.workcenter_id && state.selectedWorkcenter && a.workcenter_id[0] === state.selectedWorkcenter.id;
        const bOk = b.workcenter_id && state.selectedWorkcenter && b.workcenter_id[0] === state.selectedWorkcenter.id;
        return aOk === bOk ? 0 : aOk ? -1 : 1;
    };
    
    const activeFiltered = state.filterCurrentWorkcenter 
        ? state.workorders.active.filter(wo => wo.workcenter_id?.[0] === state.selectedWorkcenter?.id)
        : state.workorders.active;
    const readyFiltered = state.filterCurrentWorkcenter
        ? state.workorders.ready.filter(wo => wo.workcenter_id?.[0] === state.selectedWorkcenter?.id)
        : state.workorders.ready;
    
    $('countActive').textContent = activeFiltered.length;
    $('countReady').textContent = readyFiltered.length;
    $('activeInfoText').textContent = activeFiltered.length > 0 ? `${activeFiltered.length} lavorazioni in corso` : '';
    
    if (activeFiltered.length === 0) {
        setEmpty(activeGrid, '✨', 'Nessuna lavorazione attiva');
    } else {
        activeGrid.innerHTML = [...state.workorders.active].sort(sortFn).map(wo => renderWorkorderCard(wo)).join('');
    }
    
    if (readyFiltered.length === 0) {
        setEmpty(readyGrid, '📋', 'Nessun ordine pronto');
    } else {
        readyGrid.innerHTML = [...state.workorders.ready].sort(sortFn).map(wo => renderWorkorderCard(wo)).join('');
    }
    
    startElapsedTimers();
}

function renderSearchResults() {
    const list = $('searchResultsList');
    if (state.searchResults.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><p>Nessun risultato</p></div>';
        return;
    }
    list.innerHTML = state.searchResults.map(wo => `
        <div class="search-result-item" onclick="selectSearchResult(${wo.id})">
            <div class="search-result-name">${escapeHtml(wo.display_name || wo.name)}</div>
            <div class="search-result-details">
                <span>📦 ${escapeHtml(wo.product_id?.[1] || '-')}</span>
                <span>🏭 ${escapeHtml(wo.workcenter_id?.[1] || '-')}</span>
                <span class="search-result-state ${wo.state}">${wo.state === 'progress' ? 'In corso' : 'Pronto'}</span>
            </div>
        </div>
    `).join('');
}

// --- SEARCH ---
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

function showSearchResults() { $('searchResults').classList.remove('hidden'); }
function hideSearchResults() { $('searchResults').classList.add('hidden'); }
function clearSearch() { $('searchInput').value = ''; $('searchClear').classList.add('hidden'); hideSearchResults(); state.searchResults = []; }
function selectSearchResult(id) { const wo = state.searchResults.find(w => w.id === id); if (wo) { hideSearchResults(); state.selectedWorkorder = wo; showWorkorderModal(wo); } }

// --- TABS ---
function switchTab(tab) {
    state.activeTab = tab;
    $('tabActive').classList.toggle('active', tab === 'active');
    $('tabReady').classList.toggle('active', tab === 'ready');
    $('tabContentActive').classList.toggle('hidden', tab !== 'active');
    $('tabContentReady').classList.toggle('hidden', tab !== 'ready');
}

// --- DATA LOADING ---
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

// --- WORKCENTER SELECTION ---
async function selectWorkcenter(id) {
    state.selectedWorkcenter = state.workcenters.find(wc => wc.id === id);
    if (!state.selectedWorkcenter) { showToast('Centro non trovato', 'error'); return; }
    
    $('selectedWorkcenterName').textContent = state.selectedWorkcenter.name;
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
    loadWorkcenters(); // Ricarica contatori
}

// --- WORKORDER MODAL ---
function selectWorkorder(id) {
    const wo = state.workorders.ready.find(w => w.id === id) || state.workorders.active.find(w => w.id === id) || state.searchResults.find(w => w.id === id);
    if (!wo) { showToast('Work order non trovato', 'error'); return; }
    state.selectedWorkorder = wo;
    showWorkorderModal(wo);
}

function showWorkorderModal(wo) {
    $('modalTitle').textContent = wo.state === 'progress' ? 'Gestisci Lavorazione' : 'Avvia Lavorazione';
    $('modalWorkorderName').textContent = wo.display_name || wo.name;
    $('modalProductName').textContent = wo.product_id ? wo.product_id[1] : '-';
    $('modalQty').textContent = wo.qty_remaining || wo.qty_producing || '-';
    $('modalCurrentWorkcenter').textContent = wo.workcenter_id ? wo.workcenter_id[1] : '-';
    
    // Durata (solo per attivi)
    if (wo.state === 'progress' && wo.date_start) {
        $('modalDurationRow').classList.remove('hidden');
        $('modalDuration').textContent = formatElapsedTime(wo.date_start);
    } else {
        $('modalDurationRow').classList.add('hidden');
    }
    
    // Warning riassegnazione
    const wcId = wo.workcenter_id ? wo.workcenter_id[0] : null;
    const needsReassign = state.selectedWorkcenter && wcId !== state.selectedWorkcenter.id;
    if (needsReassign) {
        $('modalWorkcenterWarning').classList.remove('hidden');
        $('modalTargetWorkcenter').textContent = state.selectedWorkcenter.name;
    } else {
        $('modalWorkcenterWarning').classList.add('hidden');
    }
    
    // Pulsanti azione
    const actions = $('modalActions');
    if (wo.state === 'ready') {
        actions.innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Annulla</button>
            <button class="btn btn-info" onclick="showDetails(${wo.id})">📋 Dettagli</button>
            <button class="btn btn-success" onclick="confirmStart()">▶️ Avvia</button>
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

function closeModal() {
    $('modalOverlay').classList.add('hidden');
    state.selectedWorkorder = null;
}

// --- ACTIONS ---
async function confirmStart() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelector('.btn-success');
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
        if (result.workcenterChanged) msg += ` (riassegnato)`;
        showToast(msg, 'success');
        
        closeModal();
        clearSearch();
        await loadAllWorkorders();
    } catch (e) {
        showToast(`Errore: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '▶️ Avvia';
    }
}

async function confirmPause() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelector('.btn-warning');
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
    } finally {
        btn.disabled = false;
        btn.textContent = '⏸️ Pausa';
    }
}

async function confirmComplete() {
    if (!state.selectedWorkorder) return;
    const wo = state.selectedWorkorder;
    const btn = $('modalActions').querySelector('.btn-success');
    btn.disabled = true;
    btn.textContent = 'Completamento...';
    
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
        btn.textContent = '✅ Completa';
    }
}

// --- DETAILS MODAL ---
async function showDetails(workorderId) {
    $('detailsModalOverlay').classList.remove('hidden');
    $('detailsContent').innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
    $('timeTrackingList').innerHTML = '';
    
    try {
        const [detailsRes, timeRes] = await Promise.all([
            fetch(`/api/workorders/${workorderId}/details`),
            fetch(`/api/workorders/${workorderId}/timetracking`)
        ]);
        
        if (!detailsRes.ok) throw new Error();
        const details = await detailsRes.json();
        
        $('detailsContent').innerHTML = `
            <div class="modal-workorder-info">
                <div class="info-row"><span class="info-label">Work Order:</span><span class="info-value">${escapeHtml(details.display_name || details.name)}</span></div>
                <div class="info-row"><span class="info-label">Prodotto:</span><span class="info-value">${escapeHtml(details.product_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Produzione:</span><span class="info-value">${escapeHtml(details.production_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Centro:</span><span class="info-value">${escapeHtml(details.workcenter_id?.[1] || '-')}</span></div>
                <div class="info-row"><span class="info-label">Stato:</span><span class="info-value">${details.state}</span></div>
                <div class="info-row"><span class="info-label">Quantità:</span><span class="info-value">${details.qty_remaining || details.qty_producing || '-'}</span></div>
                <div class="info-row"><span class="info-label">Durata prevista:</span><span class="info-value">${formatDuration(details.duration_expected)}</span></div>
                <div class="info-row"><span class="info-label">Durata effettiva:</span><span class="info-value">${formatDuration(details.duration)}</span></div>
            </div>
            ${details.operation_note ? `<div class="modal-notes"><h4>Note:</h4><div class="notes-content">${escapeHtml(details.operation_note)}</div></div>` : ''}
        `;
        
        if (timeRes.ok) {
            const timeLogs = await timeRes.json();
            if (timeLogs.length > 0) {
                $('timeTrackingList').innerHTML = timeLogs.map(log => `
                    <div class="time-log-item">
                        <span class="time-log-date">${formatDateTime(log.date_start)} - ${formatDateTime(log.date_end)}</span>
                        <span class="time-log-duration">${formatDuration(log.duration)}</span>
                    </div>
                `).join('');
            } else {
                $('timeTrackingList').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Nessun log disponibile</p>';
            }
        }
    } catch {
        $('detailsContent').innerHTML = '<p style="color:var(--color-danger);">Errore caricamento dettagli</p>';
    }
}

function closeDetailsModal() {
    $('detailsModalOverlay').classList.add('hidden');
}

// --- FILTER HANDLERS ---
function toggleFilterCurrentWorkcenter() {
    state.filterCurrentWorkcenter = $('filterCurrentWorkcenter').checked;
    renderWorkorders();
}

function toggleCompactView() {
    state.compactView = $('filterCompactView').checked;
    $('stepWorkorders').classList.toggle('compact', state.compactView);
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadWorkcenters();
    
    // Toolbar
    $('btnRefresh').addEventListener('click', () => { if (state.selectedWorkcenter) loadAllWorkorders(); else loadWorkcenters(); });
    $('autoRefreshToggle').addEventListener('change', toggleAutoRefresh);
    $('refreshInterval').addEventListener('change', changeRefreshInterval);
    $('btnToggleTheme').addEventListener('click', toggleTheme);
    $('btnFullscreen').addEventListener('click', toggleFullscreen);
    
    // Search
    $('searchInput').addEventListener('input', handleSearchInput);
    $('searchClear').addEventListener('click', clearSearch);
    $('btnCloseSearch').addEventListener('click', hideSearchResults);
    
    // Navigation
    $('btnBack').addEventListener('click', goBack);
    
    // Tabs
    $('tabActive').addEventListener('click', () => switchTab('active'));
    $('tabReady').addEventListener('click', () => switchTab('ready'));
    
    // Filters
    $('filterCurrentWorkcenter').addEventListener('change', toggleFilterCurrentWorkcenter);
    $('filterCompactView').addEventListener('change', toggleCompactView);
    
    // Modal
    $('modalClose').addEventListener('click', closeModal);
    $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });
    
    // Details Modal
    $('detailsModalClose').addEventListener('click', closeDetailsModal);
    $('btnCloseDetails').addEventListener('click', closeDetailsModal);
    $('detailsModalOverlay').addEventListener('click', (e) => { if (e.target === $('detailsModalOverlay')) closeDetailsModal(); });
    
    // Click fuori ricerca
    document.addEventListener('click', (e) => { if (!$('toolbar').contains(e.target)) hideSearchResults(); });
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
