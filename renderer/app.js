'use strict';

// ─── i18n ────────────────────────────────────────
const LANGS = {
  en: {
    trace:              'Trace',
    stop:               'Stop',
    resolve_dns:        'Resolve DNS',
    ready:              'Ready',
    tracing:            'Tracing…',
    complete:           'Complete',
    error:              'Error',
    route_analysis:     'Route Analysis',
    hops:               'Hops',
    countries:          'Countries',
    max_rtt:            'Max RTT',
    avg_rtt:            'Avg RTT',
    loss:               'Loss',
    hint_text:          'Enter a domain or IP (v4/v6) above<br>and press <strong>Trace</strong> to visualise the route',
    empty_label:        'Enter a domain or IP address<br>and press Trace to begin',
    timed_out:          'Request timed out',
    unknown:            'Unknown',
    local_net:          'Local Network',
    private:            'Private',
    hop_label:          'HOP',
    ip_address:         'IP Address',
    location:           'Location',
    isp_org:            'ISP / Org',
    asn:                'ASN',
    hostname:           'Hostname',
    timeout_str:        'Timeout',
    ip_version:         'Version',
    rtt_profile:        'RTT Profile',
    whois:              'WHOIS',
    open_whois:         'Open WHOIS',
    copy_ip:            'Copy IP',
    copied:             'Copied!',
    copy_report:        'Copy Report',
    export_json:        'JSON',
    export_csv:         'CSV',
    export_toolbar:     'Export',
    filter_placeholder: 'Filter hops…',
    history_title:      'Recent Traces',
    no_history:         'No recent traces',
    clear_history:      'Clear',
    report_copied:      'Report copied to clipboard!',
    no_hops:            'No hops to export',
    summary:            'Summary',
    total_hops:         'Total hops',
    timeouts:           'Timeouts',
    shortcuts_title:    'Keyboard Shortcuts',
    shortcuts_hint:     'Esc · Stop trace',
  },
  pt: {
    trace:              'Rastrear',
    stop:               'Parar',
    resolve_dns:        'Resolver DNS',
    ready:              'Pronto',
    tracing:            'Rastreando…',
    complete:           'Concluído',
    error:              'Erro',
    route_analysis:     'Análise de Rota',
    hops:               'Saltos',
    countries:          'Países',
    max_rtt:            'RTT Máx',
    avg_rtt:            'RTT Méd',
    loss:               'Perda',
    hint_text:          'Digite um domínio ou IP (v4/v6) acima<br>e pressione <strong>Rastrear</strong> para visualizar a rota',
    empty_label:        'Digite um domínio ou endereço IP<br>e pressione Rastrear para iniciar',
    timed_out:          'Solicitação esgotou o tempo',
    unknown:            'Desconhecido',
    local_net:          'Rede Local',
    private:            'Privado',
    hop_label:          'SALTO',
    ip_address:         'Endereço IP',
    location:           'Localização',
    isp_org:            'ISP / Org',
    asn:                'ASN',
    hostname:           'Hostname',
    timeout_str:        'Timeout',
    ip_version:         'Versão',
    rtt_profile:        'Perfil de RTT',
    whois:              'WHOIS',
    open_whois:         'Abrir WHOIS',
    copy_ip:            'Copiar IP',
    copied:             'Copiado!',
    copy_report:        'Copiar Relatório',
    export_json:        'JSON',
    export_csv:         'CSV',
    export_toolbar:     'Exportar',
    filter_placeholder: 'Filtrar saltos…',
    history_title:      'Rastreamentos Recentes',
    no_history:         'Sem rastreamentos recentes',
    clear_history:      'Limpar',
    report_copied:      'Relatório copiado para a área de transferência!',
    no_hops:            'Nenhum salto para exportar',
    summary:            'Resumo',
    total_hops:         'Total de saltos',
    timeouts:           'Timeouts',
    shortcuts_title:    'Atalhos de Teclado',
    shortcuts_hint:     'Esc · Parar rastreamento',
  },
};

let currentLang = 'en';

function t(key) {
  return LANGS[currentLang][key] || LANGS['en'][key] || key;
}

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (key === 'hint_text' || key === 'empty_label') {
      el.innerHTML = t(key);
    } else {
      el.textContent = t(key);
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  const btn = document.getElementById('trace-btn');
  if (btn) btn.textContent = isRunning ? t('stop') : t('trace');
  const lb = document.getElementById('lang-toggle');
  if (lb) lb.textContent = currentLang === 'en' ? 'PT' : 'EN';
  buildShortcutList();
}

// ─── State ───────────────────────────────────────
let hops        = [];
let mapMarkers  = [];
let mapLines    = [];
let selected    = null;
let isRunning   = false;
let isDark      = true;
let map         = null;
let tileLayerDark  = null;
let tileLayerLight = null;
let filterText  = '';
let traceTarget = '';
let traceStartTs = null;
let exportVisible = false;
let filterVisible = false;

// ─── History ─────────────────────────────────────
const HISTORY_KEY = 'tv_trace_history_v2';
let traceHistory = [];
try { traceHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (_) {}

function saveHistory(target) {
  traceHistory = [target, ...traceHistory.filter(t => t !== target)].slice(0, 12);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(traceHistory)); } catch (_) {}
}

function clearHistory() {
  traceHistory = [];
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(traceHistory)); } catch (_) {}
  renderHistoryDropdown();
}

function renderHistoryDropdown() {
  const dd = document.getElementById('history-dropdown');
  if (!dd) return;
  if (traceHistory.length === 0) {
    dd.innerHTML = `<div class="history-empty">${t('no_history')}</div>`;
  } else {
    dd.innerHTML = `
      <div class="history-header">
        <span>${t('history_title')}</span>
        <button class="history-clear-btn" id="history-clear-btn">${t('clear_history')}</button>
      </div>
      ${traceHistory.map(h => `
        <div class="history-item" data-target="${h}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${h}</span>
        </div>`).join('')}`;
    dd.querySelector('#history-clear-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearHistory();
    });
    dd.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const inp = document.getElementById('target-input');
        if (inp) inp.value = el.dataset.target;
        closeHistoryDropdown();
        if (!isRunning) startTrace();
      });
    });
  }
}

function openHistoryDropdown() {
  renderHistoryDropdown();
  document.getElementById('history-dropdown')?.classList.remove('hidden');
}

function closeHistoryDropdown() {
  document.getElementById('history-dropdown')?.classList.add('hidden');
}

// ─── Toast ───────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 2800);
}

// ─── Colours ─────────────────────────────────────
const RTT_THRESHOLDS = { good: 50, medium: 150 };

function rttBgColor(rtt) {
  if (rtt === null || rtt === undefined) return '';
  if (rtt < RTT_THRESHOLDS.good)   return 'var(--green-dim)';
  if (rtt < RTT_THRESHOLDS.medium) return 'var(--yellow-dim)';
  return 'var(--red-dim)';
}

function rttHex(rtt) {
  if (rtt === null) return isDark ? '#334155' : '#94a3b8';
  if (rtt < RTT_THRESHOLDS.good)   return isDark ? '#22d3a0' : '#059669';
  if (rtt < RTT_THRESHOLDS.medium) return isDark ? '#fbbf24' : '#d97706';
  return isDark ? '#f87171' : '#dc2626';
}

function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '🌐';
  const base = 0x1F1E6;
  return cc.toUpperCase().split('').map(c => String.fromCodePoint(base + c.charCodeAt(0) - 65)).join('');
}

function validCoords(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function isIPv6(ip) { return ip && ip.includes(':'); }

// ─── Great-circle arc ────────────────────────────
function gcArc(latlng1, latlng2, pts = 80) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const la1 = toRad(latlng1[0]), lo1 = toRad(latlng1[1]);
  const la2 = toRad(latlng2[0]), lo2 = toRad(latlng2[1]);
  const d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((la2 - la1) / 2), 2) +
    Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)
  ));
  if (d < 0.0001) return [latlng1, latlng2];
  const result = [];
  for (let i = 0; i <= pts; i++) {
    const ti = i / pts;
    const A = Math.sin((1 - ti) * d) / Math.sin(d), B = Math.sin(ti * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    result.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return result;
}

// ─── Map init ────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [20, 0], zoom: 2,
    zoomControl: false, attributionControl: false,
    minZoom: 1, maxZoom: 18, worldCopyJump: true,
  });

  tileLayerDark = L.tileLayer(
    'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
    { attribution: '©OpenStreetMap ©CARTO', subdomains: 'abcd', maxZoom: 19 }
  );

  tileLayerLight = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '©OpenStreetMap ©CARTO', subdomains: 'abcd', maxZoom: 19 }
  );

  tileLayerDark.addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: '' }).addTo(map);
}

// ─── Marker ──────────────────────────────────────
function makeMarkerIcon(color, isOriginOrDest) {
  const html = `
    <div class="tv-marker ${isOriginOrDest ? '' : 'small'}" style="--mc:${color}">
      <div class="tv-marker-core tv-marker-core-appear"></div>
      <div class="tv-marker-pulse"></div>
      ${isOriginOrDest ? '<div class="tv-marker-pulse2"></div>' : ''}
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [16, 16], iconAnchor: [8, 8], tooltipAnchor: [12, 0] });
}

// ─── Tooltip ─────────────────────────────────────
function tooltipHtml(hop) {
  const flag   = flagEmoji(hop.geo?.countryCode);
  const color  = rttHex(hop.rtt);
  const rttStr = hop.rtt !== null ? `${hop.rtt.toFixed(1)} ms` : t('timeout_str');
  const loc    = hop.geo
    ? `${flag} ${hop.geo.city || '?'}${hop.geo.country ? ', ' + hop.geo.country : ''}`
    : '🌐 ' + t('unknown');
  const v6badge = isIPv6(hop.ip)
    ? `<span style="font-size:9px;background:rgba(59,130,246,0.2);color:#60a5fa;padding:1px 5px;border-radius:3px;margin-left:4px;">IPv6</span>`
    : '';
  return `
    <div class="tv-tooltip">
      <div class="tt-hop-num">${t('hop_label')} ${hop.hop}${v6badge}</div>
      <div class="tt-ip">${hop.ip || '* * *'}</div>
      <div class="tt-loc">${loc}</div>
      <div class="tt-rtt" style="color:${color}">${rttStr}</div>
      ${hop.geo?.isp ? `<div class="tt-isp">${hop.geo.isp}</div>` : ''}
    </div>`;
}

// ─── Add hop to map ──────────────────────────────
function addHopToMap(hop) {
  if (!hop.geo || !validCoords(hop.geo.lat, hop.geo.lon)) return;
  const pos      = [hop.geo.lat, hop.geo.lon];
  const isOrigin = hop.hop === 1;
  const color    = isOrigin ? (isDark ? '#22d3a0' : '#059669') : rttHex(hop.rtt);
  const marker   = L.marker(pos, { icon: makeMarkerIcon(color, isOrigin), zIndexOffset: hop.hop }).addTo(map);
  marker.bindTooltip(tooltipHtml(hop), { className: 'tv-tooltip-wrapper', sticky: false, direction: 'right', offset: [10, 0] });
  marker.on('click', () => selectHop(hop.hop));
  mapMarkers.push({ hopNum: hop.hop, leafletMarker: marker });

  const prevHop = [...hops].slice(0, hops.indexOf(hop)).reverse()
    .find(h => h.geo && validCoords(h.geo.lat, h.geo.lon));
  if (prevHop) {
    const prevPos  = [prevHop.geo.lat, prevHop.geo.lon];
    const lineColor = isDark ? '#00d4ff' : '#0057b8';
    const dist     = Math.hypot(pos[0] - prevPos[0], pos[1] - prevPos[1]);
    const arcPts   = dist > 1 ? gcArc(prevPos, pos) : [prevPos, pos];
    mapLines.push(L.polyline(arcPts, { color: lineColor, weight: 2, opacity: 0.65 }).addTo(map));
  }

  const geoPoints = hops
    .filter(h => h.geo && validCoords(h.geo.lat, h.geo.lon))
    .map(h => [h.geo.lat, h.geo.lon]);
  if (geoPoints.length >= 2) map.fitBounds(geoPoints, { padding: [60, 60], maxZoom: 9, animate: true });
  else if (geoPoints.length === 1) map.setView(geoPoints[0], 5, { animate: true });
}

// ─── Filter ──────────────────────────────────────
function hopMatchesFilter(hop, text) {
  if (!text) return true;
  const q = text.toLowerCase();
  return (
    (hop.ip       || '').toLowerCase().includes(q) ||
    (hop.hostname || '').toLowerCase().includes(q) ||
    (hop.geo?.city    || '').toLowerCase().includes(q) ||
    (hop.geo?.country || '').toLowerCase().includes(q) ||
    (hop.geo?.isp     || '').toLowerCase().includes(q) ||
    (hop.geo?.asn     || '').toLowerCase().includes(q) ||
    (hop.timeout && ('timeout'.includes(q) || 'timed out'.includes(q)))
  );
}

// ─── Sidebar hop row ─────────────────────────────
function buildHopItem(hop, idx) {
  const flag    = flagEmoji(hop.geo?.countryCode);
  const locStr  = hop.geo
    ? `${flag} ${hop.geo.city || t('unknown')}${hop.geo.country ? ', ' + hop.geo.country : ''}`
    : '🌐 ' + t('unknown');
  const rttCol  = rttHex(hop.rtt);
  const rttBg   = rttBgColor(hop.rtt);
  const rttText = hop.rtt !== null ? `${hop.rtt.toFixed(1)} ms` : '* * *';
  const v6dot   = isIPv6(hop.ip) ? `<span class="ipv6-tag">v6</span>` : '';
  const ipDisplay = hop.ip || '* * *';

  const item = document.createElement('div');
  item.className   = 'hop-item';
  item.dataset.hop = hop.hop;
  item.innerHTML = `
    <div class="hop-badge">${hop.hop}</div>
    <div class="hop-meta">
      <div class="hop-ip ${hop.timeout ? 'timeout' : ''}">
        ${ipDisplay}${v6dot}
        ${hop.ip ? `<button class="hop-copy-btn" data-ip="${hop.ip}" title="${t('copy_ip')}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>` : ''}
      </div>
      <div class="hop-loc">${hop.timeout ? t('timed_out') : locStr}</div>
    </div>
    <div class="hop-rtt-badge" style="color:${rttCol};background:${rttBg}">${rttText}</div>`;

  item.addEventListener('click', (e) => {
    if (e.target.closest('.hop-copy-btn')) return;
    selectHop(hop.hop);
  });

  // Copy IP button
  item.querySelector('.hop-copy-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const ip = e.currentTarget.dataset.ip;
    copyToClipboard(ip, t('copied'));
  });

  return item;
}

function rebuildSidebar() {
  const list = document.getElementById('hop-list');
  if (hops.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-label">${t('empty_label')}</div></div>`;
    return;
  }

  const sorted   = [...hops].sort((a, b) => a.hop - b.hop);
  const filtered = sorted.filter(h => hopMatchesFilter(h, filterText));

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-label">No hops match the filter</div></div>`;
    return;
  }

  filtered.forEach((hop, idx) => {
    const item = buildHopItem(hop, idx);
    item.style.animationDelay = `${Math.min(idx * 18, 300)}ms`;
    if (hop.hop === selected) item.classList.add('active');
    list.appendChild(item);
  });

  list.scrollTop = list.scrollHeight;
}

function addHopToSidebar(hop) {
  rebuildSidebar();
  updateProgress();
}

// ─── Select hop ──────────────────────────────────
function selectHop(hopNum) {
  selected = hopNum;
  document.querySelectorAll('.hop-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.hop) === hopNum));
  document.querySelector(`.hop-item[data-hop="${hopNum}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  mapMarkers.forEach(({ hopNum: n, leafletMarker }) => {
    leafletMarker.getElement()
      ?.querySelector('.tv-marker')
      ?.classList.toggle('selected', n === hopNum);
  });
  const hop = hops.find(h => h.hop === hopNum);
  if (hop?.geo && validCoords(hop.geo.lat, hop.geo.lon))
    map.panTo([hop.geo.lat, hop.geo.lon], { animate: true, duration: 0.5 });
  if (hop) renderDetail(hop);
}

// ─── Detail panel ────────────────────────────────
function renderDetail(hop) {
  const panel = document.getElementById('hop-detail');
  panel.style.display = 'block';
  const flag   = flagEmoji(hop.geo?.countryCode);
  const rttStr = hop.rtt !== null ? hop.rtt.toFixed(1) : '—';
  const color  = rttHex(hop.rtt);
  const loc    = hop.geo
    ? `${flag} ${hop.geo.city || '?'}${hop.geo.region ? ', ' + hop.geo.region : ''} ${hop.geo.country || ''}`
    : '—';
  const v6badge = isIPv6(hop.ip)
    ? `<span class="ipv6-tag" style="font-size:10px;padding:2px 6px;">IPv6</span>`
    : '';

  const sampleHtml = (hop.rtts || []).map((r, i) => `
    <div class="rtt-sample">
      <div class="rtt-sample-label">T${i + 1}</div>
      <div class="rtt-sample-val" style="color:${rttHex(r)}">${r !== null ? r + 'ms' : '*'}</div>
    </div>`).join('');

  const whoisUrl  = hop.ip ? `https://who.is/whois-ip/ip-address/${hop.ip}` : null;
  const ripestats = hop.ip ? `https://stat.ripe.net/app/launchpad/${hop.ip}` : null;
  const hostname  = hop.hostname && hop.hostname !== hop.ip ? hop.hostname : null;

  panel.innerHTML = `
    <div class="detail-toprow">
      <div>
        <div class="detail-hop-label">${t('hop_label')} ${hop.hop} ${v6badge}</div>
        <div class="detail-hostname mono">${hostname || (hop.ip || '—')}</div>
      </div>
      <div>
        <div class="detail-rtt-big" style="color:${color}">${rttStr}<span class="detail-rtt-unit"> ms</span></div>
        ${hop.ip ? `<div class="detail-actions">
          <button class="detail-action-btn" id="detail-copy-ip" title="${t('copy_ip')}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>${t('copy_ip')}</span>
          </button>
          ${whoisUrl ? `<button class="detail-action-btn" id="detail-whois" title="${t('open_whois')}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>${t('whois')}</span>
          </button>` : ''}
        </div>` : ''}
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-card">
        <div class="dc-label">${t('ip_address')}</div>
        <div class="dc-val mono" style="word-break:break-all;font-size:${isIPv6(hop.ip) ? '10px' : '11px'}">${hop.ip || '—'}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('location')}</div>
        <div class="dc-val">${loc}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('isp_org')}</div>
        <div class="dc-val">${hop.geo?.isp || hop.geo?.org || '—'}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('asn')}</div>
        <div class="dc-val mono">${hop.geo?.asn || '—'}</div>
      </div>
    </div>
    ${sampleHtml ? `<div class="rtt-samples-row">${sampleHtml}</div>` : ''}`;

  // Bind detail action buttons
  document.getElementById('detail-copy-ip')?.addEventListener('click', () => {
    copyToClipboard(hop.ip, t('copied'));
  });
  document.getElementById('detail-whois')?.addEventListener('click', () => {
    if (whoisUrl) window.electronAPI?.openExternal(whoisUrl);
  });
}

// ─── Stats ───────────────────────────────────────
function updateStats() {
  const countries = new Set(
    hops.filter(h => h.geo?.country && h.geo.country !== 'Private').map(h => h.geo.country)
  );
  const rtts   = hops.filter(h => h.rtt !== null).map(h => h.rtt);
  const maxRtt = rtts.length ? Math.max(...rtts) : null;
  const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
  const timeouts  = hops.filter(h => h.timeout || h.rtt === null).length;
  const lossRatio = hops.length > 0 ? (timeouts / hops.length * 100) : 0;

  document.getElementById('stat-hops').textContent     = hops.length;
  document.getElementById('stat-countries').textContent = countries.size;
  document.getElementById('stat-rtt').textContent       = maxRtt !== null ? maxRtt.toFixed(0) + 'ms' : '—';
  document.getElementById('stat-avg-rtt').textContent   = avgRtt !== null ? avgRtt.toFixed(0) + 'ms' : '—';
  document.getElementById('stat-loss').textContent      = hops.length > 0 ? lossRatio.toFixed(0) + '%' : '—';
}

// ─── RTT Chart ───────────────────────────────────
function updateRttChart() {
  const wrap = document.getElementById('rtt-chart-wrap');
  const svg  = document.getElementById('rtt-chart');
  if (!wrap || !svg) return;

  const hopsWithRtt = hops.filter(h => h.rtt !== null);
  if (hopsWithRtt.length < 2) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const W = 310, H = 64;
  const PAD = { t: 6, r: 8, b: 18, l: 36 };
  const cW  = W - PAD.l - PAD.r;
  const cH  = H - PAD.t - PAD.b;

  const maxRtt = Math.max(...hopsWithRtt.map(h => h.rtt));
  const maxHop = Math.max(...hops.map(h => h.hop));
  const minHop = Math.min(...hops.map(h => h.hop));
  const hopRange = Math.max(maxHop - minHop, 1);

  const xp = (hop) => PAD.l + ((hop - minHop) / hopRange) * cW;
  const yp = (rtt) => PAD.t + cH - (rtt / (maxRtt || 1)) * cH;

  // Build path through hops with valid RTT
  let pathD = '';
  let first = true;
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  for (const hop of sorted) {
    if (hop.rtt === null) { first = true; continue; }
    const px = xp(hop.hop), py = yp(hop.rtt);
    pathD += first ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
    first = false;
  }

  // Area fill path
  const firstValid = sorted.find(h => h.rtt !== null);
  const lastValid  = [...sorted].reverse().find(h => h.rtt !== null);
  let areaD = '';
  if (firstValid && lastValid) {
    areaD = pathD + ` L ${xp(lastValid.hop).toFixed(1)} ${(PAD.t + cH).toFixed(1)} L ${xp(firstValid.hop).toFixed(1)} ${(PAD.t + cH).toFixed(1)} Z`;
  }

  const lineColor = isDark ? '#00d4ff' : '#0057b8';
  const fillColor = isDark ? 'rgba(0,212,255,0.08)' : 'rgba(0,87,184,0.07)';
  const axisColor = isDark ? '#1e3a5f' : '#d1dde8';
  const labelColor = isDark ? '#334155' : '#94a3b8';

  const dots = sorted.map(hop => {
    if (hop.rtt === null) {
      return `<circle cx="${xp(hop.hop).toFixed(1)}" cy="${(PAD.t + cH / 2).toFixed(1)}" r="2.5" fill="none" stroke="${axisColor}" stroke-width="1" stroke-dasharray="2,2"/>`;
    }
    const c = rttHex(hop.rtt);
    return `<circle cx="${xp(hop.hop).toFixed(1)}" cy="${yp(hop.rtt).toFixed(1)}" r="2.5" fill="${c}" stroke="${isDark ? '#0d1b33' : '#fff'}" stroke-width="1.2"/>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width  = '100%';
  svg.style.height = `${H}px`;
  svg.innerHTML = `
    <path d="${areaD}" fill="${fillColor}"/>
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <line x1="${PAD.l}" y1="${H - PAD.b}" x2="${W - PAD.r}" y2="${H - PAD.b}" stroke="${axisColor}" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${H - PAD.b}" stroke="${axisColor}" stroke-width="1"/>
    <text x="${PAD.l - 4}" y="${PAD.t + 4}" text-anchor="end" font-size="8" fill="${labelColor}" font-family="JetBrains Mono,monospace">${Math.round(maxRtt)}</text>
    <text x="${PAD.l - 4}" y="${H - PAD.b + 1}" text-anchor="end" font-size="8" fill="${labelColor}" font-family="JetBrains Mono,monospace">0</text>
    <text x="${PAD.l}" y="${H}" text-anchor="start" font-size="8" fill="${labelColor}" font-family="JetBrains Mono,monospace">${minHop}</text>
    <text x="${W - PAD.r}" y="${H}" text-anchor="end" font-size="8" fill="${labelColor}" font-family="JetBrains Mono,monospace">${maxHop}</text>`;
}

// ─── Progress bar ────────────────────────────────
function updateProgress() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  if (!isRunning) return;
  const pct = Math.min((hops.length / 30) * 100, 95);
  bar.style.width = pct + '%';
}

function setProgressComplete() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  bar.style.width = '100%';
  setTimeout(() => bar.classList.add('hidden'), 700);
}

function resetProgress() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  bar.classList.remove('hidden');
  bar.style.width = '0%';
}

// ─── Status ──────────────────────────────────────
function setStatus(state, key) {
  const pill = document.getElementById('status-pill');
  pill.className = `status-pill ${state}`;
  pill.querySelector('.status-text').textContent = t(key);
}

// ─── Copy to clipboard ───────────────────────────
function copyToClipboard(text, toastMsg = null) {
  navigator.clipboard.writeText(text).then(() => {
    if (toastMsg) showToast(toastMsg, 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    if (toastMsg) showToast(toastMsg, 'success');
  });
}

// ─── Export ──────────────────────────────────────
function generateTextReport() {
  const now = new Date().toLocaleString();
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  const rtts = sorted.filter(h => h.rtt !== null).map(h => h.rtt);
  const maxRtt = rtts.length ? Math.max(...rtts).toFixed(1) : '—';
  const avgRtt = rtts.length ? (rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(1) : '—';
  const timeouts = sorted.filter(h => h.timeout).length;
  const countries = [...new Set(sorted.filter(h => h.geo?.country && h.geo.country !== 'Private').map(h => h.geo.country))];

  const sep = '─'.repeat(100);
  const cols = ['HOP', 'IP ADDRESS', 'HOSTNAME', 'LOCATION', 'RTT', 'ISP / ASN'];
  const widths = [4, 18, 30, 28, 10, 0];

  const header = cols.map((c, i) => i < cols.length - 1 ? c.padEnd(widths[i]) : c).join('  ');
  const rows = sorted.map(hop => {
    const ip   = (hop.ip || '* * *').padEnd(widths[1]);
    const host = (hop.hostname && hop.hostname !== hop.ip ? hop.hostname : (hop.ip || '—')).slice(0, widths[2]).padEnd(widths[2]);
    const loc  = hop.geo
      ? `${hop.geo.city || '?'}, ${hop.geo.country || '?'}`.slice(0, widths[3]).padEnd(widths[3])
      : '—'.padEnd(widths[3]);
    const rtt  = (hop.rtt !== null ? `${hop.rtt.toFixed(1)}ms` : '*').padEnd(widths[4]);
    const isp  = hop.geo ? `${hop.geo.isp || ''}${hop.geo.asn ? ' ' + hop.geo.asn : ''}` : '';
    return `${String(hop.hop).padStart(3)}  ${ip}  ${host}  ${loc}  ${rtt}  ${isp}`;
  });

  return [
    `╔══ ${t('report_title') || 'TRACEVIS REPORT'} ══════════════════════════════════════════════════╗`,
    `  ${t('total_hops') || 'Target'}: ${traceTarget || '—'}    ${now}`,
    `╚${'═'.repeat(70)}╝`,
    '',
    header,
    sep.slice(0, header.length + 10),
    ...rows,
    '',
    sep.slice(0, 60),
    `  ${t('summary') || 'Summary'}`,
    `  ${t('hops')}: ${sorted.length}    ${t('countries') || 'Countries'}: ${countries.length}    Max RTT: ${maxRtt}ms    Avg RTT: ${avgRtt}ms    ${t('timeouts')}: ${timeouts}`,
    `  ${t('countries') || 'Countries'}: ${countries.join(', ') || '—'}`,
    sep.slice(0, 60),
  ].join('\n');
}

function exportJSON() {
  if (hops.length === 0) { showToast(t('no_hops'), 'error'); return; }
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  const rtts   = sorted.filter(h => h.rtt !== null).map(h => h.rtt);
  const timeouts = sorted.filter(h => h.timeout).length;
  const countries = [...new Set(sorted.filter(h => h.geo?.country && h.geo.country !== 'Private').map(h => h.geo.country))];

  const obj = {
    target: traceTarget,
    timestamp: new Date().toISOString(),
    hops: sorted,
    summary: {
      totalHops: sorted.length,
      countries,
      maxRtt: rtts.length ? Math.max(...rtts) : null,
      avgRtt: rtts.length ? +(rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(2) : null,
      timeouts,
      lossPercent: sorted.length > 0 ? +(timeouts / sorted.length * 100).toFixed(1) : 0,
    },
  };
  downloadFile(`tracevis-${(traceTarget || 'trace').replace(/[^a-z0-9]/gi, '_')}.json`,
    JSON.stringify(obj, null, 2), 'application/json');
}

function exportCSV() {
  if (hops.length === 0) { showToast(t('no_hops'), 'error'); return; }
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  const lines  = [
    'Hop,IP,Hostname,City,Region,Country,CountryCode,Lat,Lon,RTT_ms,RTT1,RTT2,RTT3,ISP,Org,ASN,Timeout',
    ...sorted.map(h => [
      h.hop, h.ip || '', h.hostname || '',
      h.geo?.city || '', h.geo?.region || '', h.geo?.country || '', h.geo?.countryCode || '',
      h.geo?.lat ?? '', h.geo?.lon ?? '',
      h.rtt ?? '', ...(h.rtts || [null, null, null]).map(r => r ?? ''),
      h.geo?.isp || '', h.geo?.org || '', h.geo?.asn || '',
      h.timeout ? 1 : 0,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ];
  downloadFile(`tracevis-${(traceTarget || 'trace').replace(/[^a-z0-9]/gi, '_')}.csv`,
    lines.join('\n'), 'text/csv');
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function toggleExportToolbar() {
  exportVisible = !exportVisible;
  document.getElementById('export-toolbar')?.classList.toggle('hidden', !exportVisible);
}

// ─── Shortcuts modal ─────────────────────────────
const SHORTCUTS = [
  { keys: 'Enter',          descEn: 'Start / stop trace',          descPt: 'Iniciar / parar rastreamento' },
  { keys: 'Escape',         descEn: 'Stop trace',                  descPt: 'Parar rastreamento' },
  { keys: 'Ctrl + L',       descEn: 'Focus address input',         descPt: 'Focar campo de endereço' },
  { keys: 'Ctrl + E',       descEn: 'Toggle export panel',         descPt: 'Abrir/fechar painel de exportação' },
  { keys: 'Ctrl + F',       descEn: 'Toggle hop filter',           descPt: 'Abrir/fechar filtro de saltos' },
  { keys: 'Ctrl + K',       descEn: 'Show history',                descPt: 'Mostrar histórico' },
  { keys: '↑ / ↓',          descEn: 'Previous / next hop',         descPt: 'Salto anterior / próximo' },
  { keys: 'Ctrl + C',       descEn: 'Copy selected hop IP',        descPt: 'Copiar IP do salto selecionado' },
];

function buildShortcutList() {
  const el = document.getElementById('shortcut-list');
  if (!el) return;
  el.innerHTML = SHORTCUTS.map(s => `
    <div class="shortcut-row">
      <kbd class="shortcut-key">${s.keys}</kbd>
      <span class="shortcut-desc">${currentLang === 'pt' ? s.descPt : s.descEn}</span>
    </div>`).join('');
}

// ─── Filter ──────────────────────────────────────
function toggleFilter() {
  filterVisible = !filterVisible;
  const row = document.getElementById('hop-filter-row');
  row?.classList.toggle('hidden', !filterVisible);
  if (filterVisible) {
    document.getElementById('hop-filter')?.focus();
  } else {
    filterText = '';
    document.getElementById('hop-filter').value = '';
    rebuildSidebar();
  }
}

// ─── Reset ───────────────────────────────────────
function resetTrace() {
  hops = []; selected = null;
  filterText = '';
  const hopFilter = document.getElementById('hop-filter');
  if (hopFilter) hopFilter.value = '';

  mapMarkers.forEach(({ leafletMarker }) => leafletMarker.remove());
  mapLines.forEach(l => l.remove());
  mapMarkers = []; mapLines = [];

  document.getElementById('hop-list').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🌐</div>
      <div class="empty-label">${t('empty_label')}</div>
    </div>`;
  document.getElementById('hop-detail').style.display = 'none';
  document.getElementById('stat-hops').textContent     = '0';
  document.getElementById('stat-countries').textContent = '0';
  document.getElementById('stat-rtt').textContent       = '—';
  document.getElementById('stat-avg-rtt').textContent   = '—';
  document.getElementById('stat-loss').textContent       = '—';
  document.getElementById('rtt-chart-wrap')?.classList.add('hidden');
  document.getElementById('export-btn')?.classList.add('hidden');
  document.getElementById('filter-btn')?.classList.add('hidden');
  document.getElementById('clear-btn')?.classList.add('hidden');
  document.getElementById('export-toolbar')?.classList.add('hidden');
  exportVisible = false;

  map.setView([20, 0], 2, { animate: true });
  document.getElementById('map-hint').classList.remove('hidden');

  window.electronAPI?.removeAll('hop-data');
  window.electronAPI?.removeAll('traceroute-complete');
  window.electronAPI?.removeAll('traceroute-error');
}

// ─── Start trace ─────────────────────────────────
async function startTrace() {
  const target = document.getElementById('target-input').value.trim();
  if (!target || isRunning) return;
  const resolveDns = document.getElementById('resolve-dns-cb').checked;

  traceTarget = target;
  resetTrace();
  saveHistory(target);

  isRunning = true;
  traceStartTs = Date.now();
  setStatus('running', 'tracing');

  const btn = document.getElementById('trace-btn');
  btn.textContent = t('stop');
  btn.classList.add('stopping');

  document.getElementById('map-hint').classList.add('hidden');
  resetProgress();

  window.electronAPI.onHopData(hop => {
    hops.push(hop);
    addHopToMap(hop);
    addHopToSidebar(hop);
    updateStats();
    updateRttChart();
  });
  window.electronAPI.onTracerouteComplete(() => finishTrace('complete', 'complete'));
  window.electronAPI.onTracerouteError(err => { console.error(err); finishTrace('error', 'error'); });

  await window.electronAPI.startTraceroute({ target, resolveDns });
}

function finishTrace(state, key) {
  isRunning = false;
  setStatus(state, key);
  setProgressComplete();

  const btn = document.getElementById('trace-btn');
  btn.textContent = t('trace');
  btn.classList.remove('stopping');

  // Show action buttons
  if (hops.length > 0) {
    document.getElementById('export-btn')?.classList.remove('hidden');
    document.getElementById('filter-btn')?.classList.remove('hidden');
    document.getElementById('clear-btn')?.classList.remove('hidden');
  }

  // Mark destination red
  const lastGeo = [...hops].reverse().find(h => h.geo && validCoords(h.geo.lat, h.geo.lon));
  if (lastGeo) {
    const obj = mapMarkers.find(m => m.hopNum === lastGeo.hop);
    if (obj) {
      const el     = obj.leafletMarker.getElement();
      const core   = el?.querySelector('.tv-marker-core');
      const pulses = el?.querySelectorAll('.tv-marker-pulse,.tv-marker-pulse2');
      const dc     = isDark ? '#f87171' : '#dc2626';
      if (core) { core.style.background = dc; core.style.boxShadow = `0 0 8px ${dc}`; }
      pulses?.forEach(p => p.style.borderColor = dc);
    }
  }

  window.electronAPI.removeAll('hop-data');
  window.electronAPI.removeAll('traceroute-complete');
  window.electronAPI.removeAll('traceroute-error');
}

async function stopTrace() {
  if (!isRunning) return;
  await window.electronAPI.stopTraceroute();
  finishTrace('idle', 'ready');
}

// ─── Theme ───────────────────────────────────────
function applyTileTheme() {
  if (isDark) {
    if (map.hasLayer(tileLayerLight)) tileLayerLight.remove();
    if (!map.hasLayer(tileLayerDark))  tileLayerDark.addTo(map);
  } else {
    if (map.hasLayer(tileLayerDark))   tileLayerDark.remove();
    if (!map.hasLayer(tileLayerLight)) tileLayerLight.addTo(map);
  }
}

function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('light', !isDark);
  document.getElementById('theme-toggle').textContent = isDark ? '🌙' : '☀️';
  applyTileTheme();
  const lc = isDark ? '#00d4ff' : '#0057b8';
  mapLines.forEach(l => l.setStyle({ color: lc }));
  updateRttChart();
}

// ─── Language ────────────────────────────────────
function toggleLang() {
  currentLang = currentLang === 'en' ? 'pt' : 'en';
  applyLang();
  rebuildSidebar();
}

// ─── Keyboard navigation ─────────────────────────
function selectAdjacentHop(delta) {
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  if (sorted.length === 0) return;
  const curIdx = selected !== null ? sorted.findIndex(h => h.hop === selected) : -1;
  const newIdx = Math.max(0, Math.min(sorted.length - 1, curIdx + delta));
  if (sorted[newIdx]) selectHop(sorted[newIdx].hop);
}

// ─── DOM ready ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setStatus('idle', 'ready');
  applyLang();
  buildShortcutList();

  // ── Trace button ──
  document.getElementById('trace-btn').addEventListener('click', async () => {
    if (isRunning) await stopTrace(); else await startTrace();
  });

  // ── Target input ──
  document.getElementById('target-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      closeHistoryDropdown();
      if (isRunning) await stopTrace(); else await startTrace();
    }
    if (e.key === 'Escape') closeHistoryDropdown();
  });

  // ── Clear button ──
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    resetTrace();
    setStatus('idle', 'ready');
  });

  // ── History ──
  document.getElementById('history-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('history-dropdown');
    if (dd.classList.contains('hidden')) openHistoryDropdown();
    else closeHistoryDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#input-group-wrap')) closeHistoryDropdown();
  });

  // ── Filter ──
  document.getElementById('filter-btn')?.addEventListener('click', toggleFilter);

  document.getElementById('hop-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value;
    rebuildSidebar();
  });

  document.getElementById('hop-filter-clear')?.addEventListener('click', () => {
    filterText = '';
    document.getElementById('hop-filter').value = '';
    rebuildSidebar();
    document.getElementById('hop-filter')?.focus();
  });

  // ── Export ──
  document.getElementById('export-btn')?.addEventListener('click', toggleExportToolbar);

  document.getElementById('btn-copy-report')?.addEventListener('click', () => {
    if (hops.length === 0) { showToast(t('no_hops'), 'error'); return; }
    copyToClipboard(generateTextReport(), t('report_copied'));
  });

  document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);

  // ── Shortcuts modal ──
  document.getElementById('shortcuts-btn')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.remove('hidden');
  });
  document.getElementById('shortcuts-close')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.add('hidden');
  });
  document.getElementById('shortcuts-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.add('hidden');
  });

  // ── Theme / Lang ──
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('lang-toggle').addEventListener('click', toggleLang);

  // ── Window controls ──
  document.getElementById('btn-close')?.addEventListener('click', () => window.electronAPI.close());
  document.getElementById('btn-min')?.addEventListener('click',   () => window.electronAPI.minimize());
  document.getElementById('btn-max')?.addEventListener('click',   () => window.electronAPI.maximize());

  // ── Global keyboard shortcuts ──
  document.addEventListener('keydown', async (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Escape — stop trace or close modals
    if (e.key === 'Escape') {
      if (!document.getElementById('shortcuts-modal')?.classList.contains('hidden')) {
        document.getElementById('shortcuts-modal').classList.add('hidden');
        return;
      }
      closeHistoryDropdown();
      if (filterVisible && filterText === '') toggleFilter();
      if (isRunning) { await stopTrace(); }
      return;
    }

    // Ctrl+L — focus input
    if (ctrl && e.key === 'l') {
      e.preventDefault();
      document.getElementById('target-input')?.focus();
      document.getElementById('target-input')?.select();
      return;
    }

    // Ctrl+E — toggle export
    if (ctrl && e.key === 'e') {
      e.preventDefault();
      if (hops.length > 0) toggleExportToolbar();
      return;
    }

    // Ctrl+F — toggle filter
    if (ctrl && e.key === 'f') {
      e.preventDefault();
      if (hops.length > 0) toggleFilter();
      return;
    }

    // Ctrl+K — history
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      openHistoryDropdown();
      return;
    }

    // Ctrl+C — copy selected hop IP (when not focusing text input)
    if (ctrl && e.key === 'c' && selected !== null &&
        document.activeElement !== document.getElementById('target-input') &&
        document.activeElement !== document.getElementById('hop-filter')) {
      const hop = hops.find(h => h.hop === selected);
      if (hop?.ip) copyToClipboard(hop.ip, t('copied'));
      return;
    }

    // Arrow Up / Down — navigate hops
    if (!ctrl && e.key === 'ArrowUp' && document.activeElement !== document.getElementById('target-input')) {
      e.preventDefault();
      selectAdjacentHop(-1);
      return;
    }
    if (!ctrl && e.key === 'ArrowDown' && document.activeElement !== document.getElementById('target-input')) {
      e.preventDefault();
      selectAdjacentHop(1);
      return;
    }
  });
});
