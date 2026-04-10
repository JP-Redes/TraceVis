'use strict';
/* global __TAURI__ */
const { invoke } = window.__TAURI__.tauri;
const { listen }  = window.__TAURI__.event;

// ─── i18n ─────────────────────────────────────────────────────────────────────
const LANGS = {
  en: {
    trace:'Trace', stop:'Stop', resolve_dns:'Resolve DNS',
    ready:'Ready', tracing:'Tracing…', complete:'Complete', error:'Error',
    route_analysis:'Route Analysis', hops:'Hops', countries:'Countries',
    max_rtt:'Max RTT', avg_rtt:'Avg RTT', loss:'Loss',
    hint_text:'Enter a domain or IP (v4/v6) above<br>and press <strong>Trace</strong> to visualise the route',
    empty_label:'Enter a domain or IP address<br>and press Trace to begin',
    timed_out:'Request timed out', unknown:'Unknown',
    hop_label:'HOP', ip_address:'IP Address', location:'Location',
    isp_org:'ISP / Org', asn:'ASN', hostname:'Hostname',
    timeout_str:'Timeout', rtt_profile:'RTT Profile',
    open_whois:'Open WHOIS', copy_ip:'Copy IP', copied:'Copied!',
    copy_report:'Copy Report', export_json:'JSON', export_csv:'CSV',
    filter_placeholder:'Filter hops…',
    history_title:'Recent Traces', no_history:'No recent traces', clear_history:'Clear',
    report_copied:'Report copied to clipboard!', no_hops:'No hops to export',
    summary:'Summary', total_hops:'Total hops', timeouts:'Timeouts',
    shortcuts_title:'Keyboard Shortcuts', whois:'WHOIS',
  },
  pt: {
    trace:'Rastrear', stop:'Parar', resolve_dns:'Resolver DNS',
    ready:'Pronto', tracing:'Rastreando…', complete:'Concluído', error:'Erro',
    route_analysis:'Análise de Rota', hops:'Saltos', countries:'Países',
    max_rtt:'RTT Máx', avg_rtt:'RTT Méd', loss:'Perda',
    hint_text:'Digite um domínio ou IP (v4/v6) acima<br>e pressione <strong>Rastrear</strong> para visualizar a rota',
    empty_label:'Digite um domínio ou endereço IP<br>e pressione Rastrear para iniciar',
    timed_out:'Solicitação esgotou o tempo', unknown:'Desconhecido',
    hop_label:'SALTO', ip_address:'Endereço IP', location:'Localização',
    isp_org:'ISP / Org', asn:'ASN', hostname:'Hostname',
    timeout_str:'Timeout', rtt_profile:'Perfil de RTT',
    open_whois:'Abrir WHOIS', copy_ip:'Copiar IP', copied:'Copiado!',
    copy_report:'Copiar Relatório', export_json:'JSON', export_csv:'CSV',
    filter_placeholder:'Filtrar saltos…',
    history_title:'Rastreamentos Recentes', no_history:'Sem rastreamentos recentes', clear_history:'Limpar',
    report_copied:'Relatório copiado!', no_hops:'Nenhum salto para exportar',
    summary:'Resumo', total_hops:'Total de saltos', timeouts:'Timeouts',
    shortcuts_title:'Atalhos de Teclado', whois:'WHOIS',
  },
};
let lang = 'en';
const t = k => LANGS[lang][k] || LANGS.en[k] || k;

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (k === 'hint_text' || k === 'empty_label') el.innerHTML = t(k);
    else el.textContent = t(k);
  });
  document.getElementById('lang-toggle').textContent = lang === 'en' ? 'PT' : 'EN';
  document.getElementById('trace-btn').textContent = isRunning ? t('stop') : t('trace');
  buildShortcutList();
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Estado ────────────────────────────────────────────────────────────────────
let isDark      = true;
let isRunning   = false;
let hops        = [];
let mapMarkers  = [];
let mapLines    = [];
let selected    = null;
let map         = null;
let tileLayerDark  = null;
let tileLayerLight = null;
let filterText  = '';
let traceTarget = '';
let exportVisible = false;
let filterVisible = false;

// Funções de unlisten do Tauri (guardam a Promise<UnlistenFn> retornada por listen())
let unlistenHop      = null;
let unlistenComplete = null;
let unlistenError    = null;

// ─── Histórico ────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'tv_trace_history_v2';
let traceHistory = [];
try { traceHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(_) {}

function saveHistory(t_) {
  traceHistory = [t_, ...traceHistory.filter(x => x !== t_)].slice(0, 12);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(traceHistory)); } catch(_) {}
}

function clearHistory() {
  traceHistory = [];
  try { localStorage.setItem(HISTORY_KEY, '[]'); } catch(_) {}
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
        <button id="history-clear-btn">${t('clear_history')}</button>
      </div>
      ${traceHistory.map(h => `
        <div class="history-item" data-target="${esc(h)}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${esc(h)}</span>
        </div>`).join('')}`;
    dd.querySelector('#history-clear-btn')?.addEventListener('click', e => { e.stopPropagation(); clearHistory(); });
    dd.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('target-input').value = el.dataset.target;
        closeHistoryDropdown();
        if (!isRunning) startTrace();
      });
    });
  }
}

function openHistoryDropdown()  { renderHistoryDropdown(); document.getElementById('history-dropdown')?.classList.remove('hidden'); }
function closeHistoryDropdown() { document.getElementById('history-dropdown')?.classList.add('hidden'); }

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 2800);
}

// ─── Cores RTT ────────────────────────────────────────────────────────────────
function rttHex(rtt) {
  if (rtt === null || rtt === undefined) return isDark ? '#334155' : '#94a3b8';
  if (rtt < 50)  return isDark ? '#22d3a0' : '#059669';
  if (rtt < 150) return isDark ? '#fbbf24' : '#d97706';
  return isDark ? '#f87171' : '#dc2626';
}
function rttBgColor(rtt) {
  if (rtt === null || rtt === undefined) return '';
  if (rtt < 50)  return 'var(--green-dim)';
  if (rtt < 150) return 'var(--yellow-dim)';
  return 'var(--red-dim)';
}
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '🌐';
  const b = 0x1F1E6;
  return cc.toUpperCase().split('').map(c => String.fromCodePoint(b + c.charCodeAt(0) - 65)).join('');
}
function validCoords(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
function isIPv6(ip) { return !!(ip && ip.includes(':')); }

// ─── Arco geodésico ───────────────────────────────────────────────────────────
function gcArc(a, b, pts = 80) {
  const r = d => d * Math.PI / 180, d2 = r => r * 180 / Math.PI;
  const la1=r(a[0]),lo1=r(a[1]),la2=r(b[0]),lo2=r(b[1]);
  const dist = 2*Math.asin(Math.sqrt(Math.pow(Math.sin((la2-la1)/2),2)+Math.cos(la1)*Math.cos(la2)*Math.pow(Math.sin((lo2-lo1)/2),2)));
  if (dist < 0.0001) return [a, b];
  const res = [];
  for (let i = 0; i <= pts; i++) {
    const ti = i/pts, A = Math.sin((1-ti)*dist)/Math.sin(dist), B = Math.sin(ti*dist)/Math.sin(dist);
    const x = A*Math.cos(la1)*Math.cos(lo1)+B*Math.cos(la2)*Math.cos(lo2);
    const y = A*Math.cos(la1)*Math.sin(lo1)+B*Math.cos(la2)*Math.sin(lo2);
    const z = A*Math.sin(la1)+B*Math.sin(la2);
    res.push([d2(Math.atan2(z, Math.sqrt(x*x+y*y))), d2(Math.atan2(y,x))]);
  }
  return res;
}

// ─── Mapa ─────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center:[20,0], zoom:2, zoomControl:false, attributionControl:false, minZoom:1, maxZoom:18, worldCopyJump:true });
  tileLayerDark  = L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
    { attribution:'©OpenStreetMap ©CARTO', subdomains:'abcd', maxZoom:19 });
  tileLayerLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution:'©OpenStreetMap ©CARTO', subdomains:'abcd', maxZoom:19 });
  tileLayerDark.addTo(map);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.control.attribution({ position:'bottomleft', prefix:'' }).addTo(map);
}

// ─── Marcador ─────────────────────────────────────────────────────────────────
function makeMarkerIcon(color, big) {
  const html = `<div class="tv-marker ${big?'':'small'}" style="--mc:${color}">
    <div class="tv-marker-core tv-marker-core-appear"></div>
    <div class="tv-marker-pulse"></div>
    ${big ? '<div class="tv-marker-pulse2"></div>' : ''}
  </div>`;
  return L.divIcon({ html, className:'', iconSize:[16,16], iconAnchor:[8,8], tooltipAnchor:[12,0] });
}

function tooltipHtml(hop) {
  const flag = flagEmoji(hop.geo?.country_code);
  const color = rttHex(hop.rtt);
  const rttStr = hop.rtt !== null && hop.rtt !== undefined ? `${hop.rtt.toFixed(1)} ms` : t('timeout_str');
  const city = hop.geo?.city || '';
  const country = hop.geo?.country || '';
  const loc = hop.geo ? `${flag} ${city}${country ? ', '+country : ''}` : '🌐 '+t('unknown');
  const v6 = isIPv6(hop.ip) ? `<span style="font-size:9px;background:rgba(59,130,246,0.2);color:#60a5fa;padding:1px 5px;border-radius:3px;margin-left:4px">IPv6</span>` : '';
  return `<div class="tv-tooltip">
    <div class="tt-hop-num">${t('hop_label')} ${hop.hop}${v6}</div>
    <div class="tt-ip">${esc(hop.ip || '* * *')}</div>
    <div class="tt-loc">${esc(loc)}</div>
    <div class="tt-rtt" style="color:${color}">${rttStr}</div>
    ${hop.geo?.isp ? `<div class="tt-isp">${esc(hop.geo.isp)}</div>` : ''}
  </div>`;
}

function addHopToMap(hop) {
  if (!hop.geo || !validCoords(hop.geo.lat, hop.geo.lon)) return;
  const pos = [hop.geo.lat, hop.geo.lon];
  const isOrigin = hop.hop === 1;
  const color = isOrigin ? (isDark ? '#22d3a0' : '#059669') : rttHex(hop.rtt);
  const marker = L.marker(pos, { icon: makeMarkerIcon(color, isOrigin), zIndexOffset: hop.hop }).addTo(map);
  marker.bindTooltip(tooltipHtml(hop), { className:'tv-tooltip-wrapper', sticky:false, direction:'right', offset:[10,0] });
  marker.on('click', () => selectHop(hop.hop));
  mapMarkers.push({ hopNum: hop.hop, leafletMarker: marker });

  const sorted = [...hops].filter(h => h.geo && validCoords(h.geo.lat, h.geo.lon)).sort((a,b) => a.hop-b.hop);
  const myIdx = sorted.findIndex(h => h.hop === hop.hop);
  if (myIdx > 0) {
    const prev = sorted[myIdx-1];
    const prevPos = [prev.geo.lat, prev.geo.lon];
    const lineColor = isDark ? '#00d4ff' : '#0057b8';
    const dist = Math.hypot(pos[0]-prevPos[0], pos[1]-prevPos[1]);
    const arcPts = dist > 1 ? gcArc(prevPos, pos) : [prevPos, pos];
    mapLines.push(L.polyline(arcPts, { color:lineColor, weight:2, opacity:0.65 }).addTo(map));
  }

  const pts = sorted.map(h => [h.geo.lat, h.geo.lon]);
  if (pts.length >= 2) map.fitBounds(pts, { padding:[60,60], maxZoom:9, animate:true });
  else if (pts.length === 1) map.setView(pts[0], 5, { animate:true });
}

// ─── Filtro ───────────────────────────────────────────────────────────────────
function hopMatchesFilter(hop, text) {
  if (!text) return true;
  const q = text.toLowerCase();
  return (hop.ip||'').toLowerCase().includes(q) ||
    (hop.hostname||'').toLowerCase().includes(q) ||
    (hop.geo?.city||'').toLowerCase().includes(q) ||
    (hop.geo?.country||'').toLowerCase().includes(q) ||
    (hop.geo?.isp||'').toLowerCase().includes(q) ||
    (hop.geo?.asn||'').toLowerCase().includes(q) ||
    (hop.timeout && 'timeout'.includes(q));
}

// ─── Linha de hop na sidebar ──────────────────────────────────────────────────
function buildHopItem(hop, idx) {
  const flag = flagEmoji(hop.geo?.country_code);
  const city = hop.geo?.city || t('unknown');
  const country = hop.geo?.country || '';
  const locStr = hop.geo ? `${flag} ${city}${country ? ', '+country : ''}` : '🌐 '+t('unknown');
  const rttCol = rttHex(hop.rtt);
  const rttBg  = rttBgColor(hop.rtt);
  const rttText = hop.rtt !== null && hop.rtt !== undefined ? `${hop.rtt.toFixed(1)} ms` : '* * *';
  const v6 = isIPv6(hop.ip) ? `<span class="ipv6-tag">v6</span>` : '';
  const ipDisplay = hop.ip || '* * *';

  const item = document.createElement('div');
  item.className = 'hop-item';
  item.dataset.hop = hop.hop;
  item.style.animationDelay = `${Math.min(idx * 18, 300)}ms`;
  item.innerHTML = `
    <div class="hop-badge">${hop.hop}</div>
    <div class="hop-meta">
      <div class="hop-ip ${hop.timeout ? 'timeout' : ''}">
        ${esc(ipDisplay)}${v6}
        ${hop.ip ? `<button class="hop-copy-btn" data-ip="${esc(hop.ip)}" title="${t('copy_ip')}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>` : ''}
      </div>
      <div class="hop-loc">${hop.timeout ? t('timed_out') : esc(locStr)}</div>
    </div>
    <div class="hop-rtt-badge" style="color:${rttCol};background:${rttBg}">${rttText}</div>`;

  item.addEventListener('click', e => {
    if (e.target.closest('.hop-copy-btn')) return;
    selectHop(hop.hop);
  });
  item.querySelector('.hop-copy-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    copyToClipboard(e.currentTarget.dataset.ip, t('copied'));
  });
  return item;
}

function rebuildSidebar() {
  const list = document.getElementById('hop-list');
  if (hops.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-label">${t('empty_label')}</div></div>`;
    return;
  }
  const sorted   = [...hops].sort((a,b) => a.hop - b.hop);
  const filtered = sorted.filter(h => hopMatchesFilter(h, filterText));
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-label">No hops match the filter</div></div>`;
    return;
  }
  filtered.forEach((hop, idx) => {
    const item = buildHopItem(hop, idx);
    if (hop.hop === selected) item.classList.add('active');
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

// ─── Selecionar hop ───────────────────────────────────────────────────────────
function selectHop(hopNum) {
  selected = hopNum;
  document.querySelectorAll('.hop-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.hop) === hopNum));
  document.querySelector(`.hop-item[data-hop="${hopNum}"]`)?.scrollIntoView({ block:'nearest', behavior:'smooth' });
  mapMarkers.forEach(({ hopNum:n, leafletMarker }) => {
    leafletMarker.getElement()?.querySelector('.tv-marker')?.classList.toggle('selected', n === hopNum);
  });
  const hop = hops.find(h => h.hop === hopNum);
  if (hop?.geo && validCoords(hop.geo.lat, hop.geo.lon))
    map.panTo([hop.geo.lat, hop.geo.lon], { animate:true, duration:0.5 });
  if (hop) renderDetail(hop);
}

// ─── Painel de detalhe ────────────────────────────────────────────────────────
function renderDetail(hop) {
  const panel = document.getElementById('hop-detail');
  panel.style.display = 'block';
  const flag = flagEmoji(hop.geo?.country_code);
  const rttStr = hop.rtt !== null && hop.rtt !== undefined ? hop.rtt.toFixed(1) : '—';
  const color = rttHex(hop.rtt);
  const city = hop.geo?.city || '?';
  const region = hop.geo?.region || '';
  const country = hop.geo?.country || '';
  const loc = hop.geo ? `${flag} ${city}${region ? ', '+region : ''} ${country}` : '—';
  const v6badge = isIPv6(hop.ip) ? `<span class="ipv6-tag" style="font-size:10px;padding:2px 6px;">IPv6</span>` : '';
  const hostname = hop.hostname && hop.hostname !== hop.ip ? hop.hostname : null;
  const whoisUrl = hop.ip ? `https://who.is/whois-ip/ip-address/${hop.ip}` : null;

  const sampleHtml = (hop.rtts || []).map((r, i) => `
    <div class="rtt-sample">
      <div class="rtt-sample-label">T${i+1}</div>
      <div class="rtt-sample-val" style="color:${rttHex(r)}">${r !== null ? r+'ms' : '*'}</div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="detail-toprow">
      <div>
        <div class="detail-hop-label">${t('hop_label')} ${hop.hop} ${v6badge}</div>
        <div class="detail-hostname mono">${esc(hostname || hop.ip || '—')}</div>
      </div>
      <div>
        <div class="detail-rtt-big" style="color:${color}">${rttStr}<span class="detail-rtt-unit"> ms</span></div>
        ${hop.ip ? `<div class="detail-actions">
          <button class="detail-action-btn" id="detail-copy-ip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>${t('copy_ip')}</span>
          </button>
          ${whoisUrl ? `<button class="detail-action-btn" id="detail-whois">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>${t('whois')}</span>
          </button>` : ''}
        </div>` : ''}
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-card"><div class="dc-label">${t('ip_address')}</div>
        <div class="dc-val mono" style="font-size:${isIPv6(hop.ip)?'10px':'11px'}">${esc(hop.ip||'—')}</div></div>
      <div class="detail-card"><div class="dc-label">${t('location')}</div>
        <div class="dc-val">${esc(loc)}</div></div>
      <div class="detail-card"><div class="dc-label">${t('isp_org')}</div>
        <div class="dc-val">${esc(hop.geo?.isp || hop.geo?.org || '—')}</div></div>
      <div class="detail-card"><div class="dc-label">${t('asn')}</div>
        <div class="dc-val mono">${esc(hop.geo?.asn || '—')}</div></div>
    </div>
    ${sampleHtml ? `<div class="rtt-samples-row">${sampleHtml}</div>` : ''}`;

  document.getElementById('detail-copy-ip')?.addEventListener('click', () => copyToClipboard(hop.ip, t('copied')));
  document.getElementById('detail-whois')?.addEventListener('click', () => {
    if (whoisUrl) invoke('open_external', { url: whoisUrl });
  });
}

// ─── Estatísticas ─────────────────────────────────────────────────────────────
function updateStats() {
  const countries = new Set(hops.filter(h => h.geo?.country && h.geo.country !== 'Private').map(h => h.geo.country));
  const rtts = hops.filter(h => h.rtt !== null && h.rtt !== undefined).map(h => h.rtt);
  const maxRtt = rtts.length ? Math.max(...rtts) : null;
  const avgRtt = rtts.length ? rtts.reduce((a,b) => a+b, 0)/rtts.length : null;
  const timeouts = hops.filter(h => h.timeout || h.rtt === null).length;
  const lossRatio = hops.length > 0 ? (timeouts / hops.length * 100) : 0;

  document.getElementById('stat-hops').textContent      = hops.length;
  document.getElementById('stat-countries').textContent = countries.size;
  document.getElementById('stat-rtt').textContent       = maxRtt !== null ? maxRtt.toFixed(0)+'ms' : '—';
  document.getElementById('stat-avg-rtt').textContent   = avgRtt !== null ? avgRtt.toFixed(0)+'ms' : '—';
  document.getElementById('stat-loss').textContent      = hops.length > 0 ? lossRatio.toFixed(0)+'%' : '—';
}

// ─── Gráfico RTT ──────────────────────────────────────────────────────────────
function updateRttChart() {
  const wrap = document.getElementById('rtt-chart-wrap');
  const svg  = document.getElementById('rtt-chart');
  if (!wrap || !svg) return;
  const hopsWithRtt = hops.filter(h => h.rtt !== null && h.rtt !== undefined);
  if (hopsWithRtt.length < 2) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const W=310, H=64, PAD={t:6,r:8,b:18,l:36};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const maxRtt = Math.max(...hopsWithRtt.map(h => h.rtt));
  const maxHop = Math.max(...hops.map(h => h.hop));
  const minHop = Math.min(...hops.map(h => h.hop));
  const hopRange = Math.max(maxHop-minHop, 1);
  const xp = hop => PAD.l + ((hop-minHop)/hopRange)*cW;
  const yp = rtt => PAD.t + cH - (rtt/(maxRtt||1))*cH;

  const sorted = [...hops].sort((a,b) => a.hop-b.hop);
  let pathD = ''; let first = true;
  for (const hop of sorted) {
    if (hop.rtt === null || hop.rtt === undefined) { first=true; continue; }
    const px=xp(hop.hop), py=yp(hop.rtt);
    pathD += first ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
    first = false;
  }
  const fv = sorted.find(h => h.rtt !== null && h.rtt !== undefined);
  const lv = [...sorted].reverse().find(h => h.rtt !== null && h.rtt !== undefined);
  const areaD = fv && lv ? pathD + ` L ${xp(lv.hop).toFixed(1)} ${(PAD.t+cH).toFixed(1)} L ${xp(fv.hop).toFixed(1)} ${(PAD.t+cH).toFixed(1)} Z` : '';

  const lc = isDark?'#00d4ff':'#0057b8', fc = isDark?'rgba(0,212,255,0.08)':'rgba(0,87,184,0.07)';
  const ac = isDark?'#1e3a5f':'#d1dde8', lab = isDark?'#334155':'#94a3b8';

  const dots = sorted.map(hop => {
    if (hop.rtt === null || hop.rtt === undefined) return `<circle cx="${xp(hop.hop).toFixed(1)}" cy="${(PAD.t+cH/2).toFixed(1)}" r="2.5" fill="none" stroke="${ac}" stroke-width="1" stroke-dasharray="2,2"/>`;
    const c = rttHex(hop.rtt);
    return `<circle cx="${xp(hop.hop).toFixed(1)}" cy="${yp(hop.rtt).toFixed(1)}" r="2.5" fill="${c}" stroke="${isDark?'#0d1b33':'#fff'}" stroke-width="1.2"/>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = '100%'; svg.style.height = `${H}px`;
  svg.innerHTML = `
    <path d="${areaD}" fill="${fc}"/>
    <path d="${pathD}" fill="none" stroke="${lc}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    <line x1="${PAD.l}" y1="${H-PAD.b}" x2="${W-PAD.r}" y2="${H-PAD.b}" stroke="${ac}" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${H-PAD.b}" stroke="${ac}" stroke-width="1"/>
    <text x="${PAD.l-4}" y="${PAD.t+4}" text-anchor="end" font-size="8" fill="${lab}" font-family="JetBrains Mono,monospace">${Math.round(maxRtt)}</text>
    <text x="${PAD.l-4}" y="${H-PAD.b+1}" text-anchor="end" font-size="8" fill="${lab}" font-family="JetBrains Mono,monospace">0</text>
    <text x="${PAD.l}" y="${H}" text-anchor="start" font-size="8" fill="${lab}" font-family="JetBrains Mono,monospace">${minHop}</text>
    <text x="${W-PAD.r}" y="${H}" text-anchor="end" font-size="8" fill="${lab}" font-family="JetBrains Mono,monospace">${maxHop}</text>`;
}

// ─── Barra de progresso ───────────────────────────────────────────────────────
function resetProgress()   { const b = document.getElementById('progress-bar'); if (b) { b.classList.remove('hidden'); b.style.width='0%'; } }
function setProgress(pct)  { const b = document.getElementById('progress-bar'); if (b) b.style.width = pct+'%'; }
function completeProgress(){ setProgress(100); setTimeout(() => document.getElementById('progress-bar')?.classList.add('hidden'), 700); }

function setStatus(state, key) {
  const pill = document.getElementById('status-pill');
  pill.className = `status-pill ${state}`;
  pill.querySelector('.status-text').textContent = t(key);
}

// ─── Clipboard ────────────────────────────────────────────────────────────────
function copyToClipboard(text, msg) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  });
  if (msg) showToast(msg, 'success');
}

// ─── Exportação ───────────────────────────────────────────────────────────────
function generateTextReport() {
  const sorted = [...hops].sort((a,b) => a.hop-b.hop);
  const rtts = sorted.filter(h => h.rtt !== null && h.rtt !== undefined).map(h => h.rtt);
  const maxRtt = rtts.length ? Math.max(...rtts).toFixed(1) : '—';
  const avgRtt = rtts.length ? (rtts.reduce((a,b)=>a+b,0)/rtts.length).toFixed(1) : '—';
  const timeouts = sorted.filter(h => h.timeout).length;
  const countries = [...new Set(sorted.filter(h=>h.geo?.country&&h.geo.country!=='Private').map(h=>h.geo.country))];
  const rows = sorted.map(h => {
    const ip = (h.ip||'* * *').padEnd(18);
    const loc = h.geo ? `${h.geo.city||'?'}, ${h.geo.country||'?'}`.slice(0,28).padEnd(28) : '—'.padEnd(28);
    const rtt = (h.rtt!==null&&h.rtt!==undefined?`${h.rtt.toFixed(1)}ms`:'*').padEnd(10);
    const isp = h.geo ? `${h.geo.isp||''} ${h.geo.asn||''}` : '';
    return `${String(h.hop).padStart(3)}  ${ip}  ${loc}  ${rtt}  ${isp}`;
  });
  return [
    `TraceVis Report — ${traceTarget||'—'} — ${new Date().toLocaleString()}`,
    '─'.repeat(80), ...rows, '',
    '─'.repeat(60),
    `Hops: ${sorted.length}    Countries: ${countries.length}    Max RTT: ${maxRtt}ms    Avg: ${avgRtt}ms    Timeouts: ${timeouts}`,
    `Countries: ${countries.join(', ')||'—'}`,
    '─'.repeat(60),
  ].join('\n');
}

function exportJSON() {
  if (!hops.length) { showToast(t('no_hops'),'error'); return; }
  const sorted = [...hops].sort((a,b)=>a.hop-b.hop);
  const rtts = sorted.filter(h=>h.rtt!==null&&h.rtt!==undefined).map(h=>h.rtt);
  const timeouts = sorted.filter(h=>h.timeout).length;
  const countries = [...new Set(sorted.filter(h=>h.geo?.country&&h.geo.country!=='Private').map(h=>h.geo.country))];
  const obj = {
    target: traceTarget, timestamp: new Date().toISOString(), hops: sorted,
    summary: {
      totalHops:   sorted.length,
      countries,
      maxRtt:      rtts.length ? Math.max(...rtts) : null,
      avgRtt:      rtts.length ? +(rtts.reduce((a,b)=>a+b,0)/rtts.length).toFixed(2) : null,
      timeouts,
      lossPercent: sorted.length>0 ? +(timeouts/sorted.length*100).toFixed(1) : 0,
    },
  };
  downloadFile(
    `tracevis-${(traceTarget||'trace').replace(/[^a-z0-9]/gi,'_')}.json`,
    JSON.stringify(obj,null,2),
    'application/json',
  );
}

function exportCSV() {
  if (!hops.length) { showToast(t('no_hops'),'error'); return; }
  const sorted = [...hops].sort((a,b)=>a.hop-b.hop);
  const lines = [
    'Hop,IP,Hostname,City,Region,Country,CountryCode,Lat,Lon,RTT_ms,ISP,Org,ASN,Timeout',
    ...sorted.map(h =>
      [h.hop, h.ip||'', h.hostname||'', h.geo?.city||'', h.geo?.region||'',
       h.geo?.country||'', h.geo?.country_code||'', h.geo?.lat??'', h.geo?.lon??'',
       h.rtt??'', h.geo?.isp||'', h.geo?.org||'', h.geo?.asn||'', h.timeout?1:0]
        .map(v=>`"${String(v).replace(/"/g,'""')}"`)
        .join(',')
    ),
  ];
  downloadFile(
    `tracevis-${(traceTarget||'trace').replace(/[^a-z0-9]/gi,'_')}.csv`,
    lines.join('\n'),
    'text/csv',
  );
}

function downloadFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content],{type:mime}));
  const a = Object.assign(document.createElement('a'), {href:url, download:name});
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();}, 1000);
}

function toggleExportToolbar() {
  exportVisible = !exportVisible;
  document.getElementById('export-toolbar')?.classList.toggle('hidden', !exportVisible);
}

// ─── Atalhos de teclado ───────────────────────────────────────────────────────
const SHORTCUTS = [
  {keys:'Enter',   en:'Start / stop trace',    pt:'Iniciar / parar'},
  {keys:'Escape',  en:'Stop trace',             pt:'Parar rastreamento'},
  {keys:'Ctrl+L',  en:'Focus address input',   pt:'Focar campo de endereço'},
  {keys:'Ctrl+E',  en:'Toggle export panel',   pt:'Painel de exportação'},
  {keys:'Ctrl+F',  en:'Toggle hop filter',     pt:'Filtro de saltos'},
  {keys:'Ctrl+K',  en:'Show history',          pt:'Mostrar histórico'},
  {keys:'↑ / ↓',  en:'Navigate hops',         pt:'Navegar entre saltos'},
];

function buildShortcutList() {
  const el = document.getElementById('shortcut-list');
  if (!el) return;
  el.innerHTML = SHORTCUTS.map(s => `
    <div class="shortcut-row">
      <kbd class="shortcut-key">${s.keys}</kbd>
      <span class="shortcut-desc">${lang==='pt'?s.pt:s.en}</span>
    </div>`).join('');
}

// ─── Filtro ───────────────────────────────────────────────────────────────────
function toggleFilter() {
  filterVisible = !filterVisible;
  document.getElementById('hop-filter-row')?.classList.toggle('hidden', !filterVisible);
  if (filterVisible) document.getElementById('hop-filter')?.focus();
  else { filterText = ''; document.getElementById('hop-filter').value = ''; rebuildSidebar(); }
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetTrace() {
  hops = []; selected = null; filterText = '';
  const fEl = document.getElementById('hop-filter');
  if (fEl) fEl.value = '';

  mapMarkers.forEach(({leafletMarker}) => leafletMarker.remove());
  mapLines.forEach(l => l.remove());
  mapMarkers = []; mapLines = [];

  document.getElementById('hop-list').innerHTML = `
    <div class="empty-state"><div class="empty-icon">🌐</div>
    <div class="empty-label">${t('empty_label')}</div></div>`;
  document.getElementById('hop-detail').style.display = 'none';
  ['stat-hops','stat-countries'].forEach(id => document.getElementById(id).textContent = '0');
  ['stat-rtt','stat-avg-rtt','stat-loss'].forEach(id => document.getElementById(id).textContent = '—');
  document.getElementById('rtt-chart-wrap')?.classList.add('hidden');
  document.getElementById('export-btn')?.classList.add('hidden');
  document.getElementById('filter-btn')?.classList.add('hidden');
  document.getElementById('clear-btn')?.classList.add('hidden');
  document.getElementById('export-toolbar')?.classList.add('hidden');
  exportVisible = false;
  map.setView([20,0], 2, {animate:true});
  document.getElementById('map-hint').classList.remove('hidden');
}

// ─── Gerenciamento de listeners ───────────────────────────────────────────────
// Bug corrigido: unlistenHop/Complete/Error guardam Promise<UnlistenFn>.
// stopListeners faz await na Promise para obter a função e então a chama.
// Isso é necessário porque listen() é assíncrono no Tauri v1.

async function stopListeners() {
  if (unlistenHop)      { try { (await unlistenHop)();      } catch(_) {} unlistenHop      = null; }
  if (unlistenComplete) { try { (await unlistenComplete)(); } catch(_) {} unlistenComplete = null; }
  if (unlistenError)    { try { (await unlistenError)();    } catch(_) {} unlistenError    = null; }
}

// ─── Iniciar trace ────────────────────────────────────────────────────────────
async function startTrace() {
  const target = document.getElementById('target-input').value.trim();
  if (!target || isRunning) return;
  const resolveDns = document.getElementById('resolve-dns-cb').checked;

  // Garante que não sobram listeners de um trace anterior
  await stopListeners();

  traceTarget = target;
  resetTrace();
  saveHistory(target);

  isRunning = true;
  setStatus('running', 'tracing');
  document.getElementById('trace-btn').textContent = t('stop');
  document.getElementById('trace-btn').classList.add('stopping');
  document.getElementById('map-hint').classList.add('hidden');
  resetProgress();

  // Registra listeners ANTES de invocar o comando para evitar race condition
  // onde o backend emite eventos antes do JS estar pronto.
  unlistenHop = listen('hop-data', ({ payload: hop }) => {
    hops.push(hop);
    addHopToMap(hop);
    rebuildSidebar();
    updateStats();
    updateRttChart();
    setProgress(Math.min((hops.length / 30) * 100, 92));
  });

  unlistenComplete = listen('traceroute-complete', () => finishTrace('complete', 'complete'));

  unlistenError = listen('traceroute-error', ({ payload: err }) => {
    console.error('traceroute-error:', err);
    showToast(`Error: ${err}`, 'error');
    finishTrace('error', 'error');
  });

  try {
    await invoke('start_traceroute', { params: { target, resolve_dns: resolveDns } });
  } catch(e) {
    showToast(`Error: ${e}`, 'error');
    finishTrace('error', 'error');
  }
}

function finishTrace(state, key) {
  // Guard: evita dupla chamada (ex.: conclusão natural + stopTrace em corrida)
  if (!isRunning) return;
  isRunning = false;

  setStatus(state, key);
  completeProgress();

  document.getElementById('trace-btn').textContent = t('trace');
  document.getElementById('trace-btn').classList.remove('stopping');

  if (hops.length > 0) {
    document.getElementById('export-btn')?.classList.remove('hidden');
    document.getElementById('filter-btn')?.classList.remove('hidden');
    document.getElementById('clear-btn')?.classList.remove('hidden');
  }

  // Marca o último hop com geo em vermelho (destino alcançado ou final conhecido)
  const lastGeo = [...hops].reverse().find(h => h.geo && validCoords(h.geo.lat, h.geo.lon));
  if (lastGeo) {
    const obj = mapMarkers.find(m => m.hopNum === lastGeo.hop);
    if (obj) {
      const el = obj.leafletMarker.getElement();
      const core   = el?.querySelector('.tv-marker-core');
      const pulses = el?.querySelectorAll('.tv-marker-pulse,.tv-marker-pulse2');
      const dc = isDark ? '#f87171' : '#dc2626';
      if (core) { core.style.background = dc; core.style.boxShadow = `0 0 8px ${dc}`; }
      pulses?.forEach(p => p.style.borderColor = dc);
    }
  }

  // Fire-and-forget: isRunning já é false, nenhum outro finishTrace pode correr
  stopListeners();
}

async function stopTrace() {
  if (!isRunning) return;
  // Cancela listeners ANTES do comando de stop para que o evento
  // 'traceroute-complete' emitido pelo backend não acione finishTrace novamente.
  await stopListeners();
  await invoke('stop_traceroute');
  finishTrace('idle', 'ready');
}

// ─── Tema ─────────────────────────────────────────────────────────────────────
function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('light', !isDark);
  document.getElementById('theme-toggle').textContent = isDark ? '🌙' : '☀️';
  if (isDark) {
    if (map.hasLayer(tileLayerLight)) tileLayerLight.remove();
    if (!map.hasLayer(tileLayerDark))  tileLayerDark.addTo(map);
  } else {
    if (map.hasLayer(tileLayerDark))  tileLayerDark.remove();
    if (!map.hasLayer(tileLayerLight)) tileLayerLight.addTo(map);
  }
  const lc = isDark ? '#00d4ff' : '#0057b8';
  mapLines.forEach(l => l.setStyle({ color: lc }));
  updateRttChart();
}

// ─── Navegação por teclado ────────────────────────────────────────────────────
function selectAdjacentHop(delta) {
  const sorted = [...hops].sort((a,b) => a.hop-b.hop);
  if (!sorted.length) return;
  const curIdx = selected !== null ? sorted.findIndex(h => h.hop === selected) : -1;
  const newIdx = Math.max(0, Math.min(sorted.length-1, curIdx+delta));
  if (sorted[newIdx]) selectHop(sorted[newIdx].hop);
}

// ─── DOM pronto ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setStatus('idle', 'ready');
  applyLang();

  document.getElementById('trace-btn').addEventListener('click', async () => {
    if (isRunning) await stopTrace(); else await startTrace();
  });

  document.getElementById('target-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter')  { closeHistoryDropdown(); if (isRunning) await stopTrace(); else await startTrace(); }
    if (e.key === 'Escape') closeHistoryDropdown();
  });

  document.getElementById('clear-btn')?.addEventListener('click', () => { resetTrace(); setStatus('idle','ready'); });

  document.getElementById('history-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('history-dropdown')?.classList.contains('hidden')
      ? openHistoryDropdown()
      : closeHistoryDropdown();
  });
  document.addEventListener('click', e => { if (!e.target.closest('#input-group-wrap')) closeHistoryDropdown(); });

  document.getElementById('filter-btn')?.addEventListener('click', toggleFilter);
  document.getElementById('hop-filter')?.addEventListener('input', e => { filterText = e.target.value; rebuildSidebar(); });
  document.getElementById('hop-filter-clear')?.addEventListener('click', () => {
    filterText = ''; document.getElementById('hop-filter').value = ''; rebuildSidebar();
    document.getElementById('hop-filter')?.focus();
  });

  document.getElementById('export-btn')?.addEventListener('click', toggleExportToolbar);
  document.getElementById('btn-copy-report')?.addEventListener('click', () => {
    if (!hops.length) { showToast(t('no_hops'),'error'); return; }
    copyToClipboard(generateTextReport(), t('report_copied'));
  });
  document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click',  exportCSV);

  document.getElementById('shortcuts-btn')?.addEventListener('click', () =>
    document.getElementById('shortcuts-modal')?.classList.remove('hidden'));
  document.getElementById('shortcuts-close')?.addEventListener('click', () =>
    document.getElementById('shortcuts-modal')?.classList.add('hidden'));
  document.querySelector('#shortcuts-modal .modal-backdrop')?.addEventListener('click', () =>
    document.getElementById('shortcuts-modal')?.classList.add('hidden'));

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('lang-toggle').addEventListener('click', () => {
    lang = lang==='en' ? 'pt' : 'en';
    applyLang();
    rebuildSidebar();
  });

  document.getElementById('btn-close')?.addEventListener('click', () => invoke('window_close'));
  document.getElementById('btn-min')?.addEventListener('click',   () => invoke('window_minimize'));
  document.getElementById('btn-max')?.addEventListener('click',   () => invoke('window_maximize'));

  document.addEventListener('keydown', async e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!document.getElementById('shortcuts-modal')?.classList.contains('hidden')) {
        document.getElementById('shortcuts-modal').classList.add('hidden');
        return;
      }
      closeHistoryDropdown();
      if (filterVisible && !filterText) toggleFilter();
      if (isRunning) await stopTrace();
      return;
    }
    if (ctrl && e.key === 'l') { e.preventDefault(); document.getElementById('target-input')?.focus(); document.getElementById('target-input')?.select(); return; }
    if (ctrl && e.key === 'e') { e.preventDefault(); if (hops.length) toggleExportToolbar(); return; }
    if (ctrl && e.key === 'f') { e.preventDefault(); if (hops.length) toggleFilter(); return; }
    if (ctrl && e.key === 'k') { e.preventDefault(); openHistoryDropdown(); return; }
    if (!ctrl && e.key === 'ArrowUp'   && document.activeElement !== document.getElementById('target-input')) { e.preventDefault(); selectAdjacentHop(-1); return; }
    if (!ctrl && e.key === 'ArrowDown' && document.activeElement !== document.getElementById('target-input')) { e.preventDefault(); selectAdjacentHop(1);  return; }
  });
});
