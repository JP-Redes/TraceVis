'use strict';

// ─── i18n ────────────────────────────────────────
const LANGS = {
  en: {
    trace:          'Trace',
    stop:           'Stop',
    resolve_dns:    'Resolve DNS',
    ready:          'Ready',
    tracing:        'Tracing…',
    complete:       'Complete',
    error:          'Error',
    route_analysis: 'Route Analysis',
    hops:           'Hops',
    countries:      'Countries',
    max_rtt:        'Max RTT',
    hint_text:      'Enter a domain or IP (v4/v6) above<br>and press <strong>Trace</strong> to visualise the route',
    empty_label:    'Enter a domain or IP address<br>and press Trace to begin',
    timed_out:      'Request timed out',
    unknown:        'Unknown',
    local_net:      'Local Network',
    private:        'Private',
    hop_label:      'HOP',
    ip_address:     'IP Address',
    location:       'Location',
    isp_org:        'ISP / Org',
    asn:            'ASN',
    timeout_str:    'Timeout',
    ip_version:     'Version',
  },
  pt: {
    trace:          'Rastrear',
    stop:           'Parar',
    resolve_dns:    'Resolver DNS',
    ready:          'Pronto',
    tracing:        'Rastreando…',
    complete:       'Concluído',
    error:          'Erro',
    route_analysis: 'Análise de Rota',
    hops:           'Saltos',
    countries:      'Países',
    max_rtt:        'RTT Máx',
    hint_text:      'Digite um domínio ou IP (v4/v6) acima<br>e pressione <strong>Rastrear</strong> para visualizar',
    empty_label:    'Digite um domínio ou endereço IP<br>e pressione Rastrear para iniciar',
    timed_out:      'Solicitação esgotou o tempo',
    unknown:        'Desconhecido',
    local_net:      'Rede Local',
    private:        'Privado',
    hop_label:      'SALTO',
    ip_address:     'Endereço IP',
    location:       'Localização',
    isp_org:        'ISP / Org',
    asn:            'ASN',
    timeout_str:    'Timeout',
    ip_version:     'Versão',
  }
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
  // Trace button text depends on running state
  const btn = document.getElementById('trace-btn');
  if (btn) btn.textContent = isRunning ? t('stop') : t('trace');
  // Lang button shows opposite
  const lb = document.getElementById('lang-toggle');
  if (lb) lb.textContent = currentLang === 'en' ? 'PT' : 'EN';
}

// ─── State ───────────────────────────────────────
let hops       = [];
let mapMarkers = [];
let mapLines   = [];
let selected   = null;
let isRunning  = false;
let isDark     = true;
let map        = null;
let tileLayerDark  = null;
let tileLayerLight = null;

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

function isIPv6(ip) {
  return ip && ip.includes(':');
}

// ─── Great-circle arc ────────────────────────────
function gcArc(latlng1, latlng2, pts = 80) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const la1 = toRad(latlng1[0]), lo1 = toRad(latlng1[1]);
  const la2 = toRad(latlng2[0]), lo2 = toRad(latlng2[1]);
  const d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((la2-la1)/2),2) + Math.cos(la1)*Math.cos(la2)*Math.pow(Math.sin((lo2-lo1)/2),2)
  ));
  if (d < 0.0001) return [latlng1, latlng2];
  const result = [];
  for (let i = 0; i <= pts; i++) {
    const ti = i/pts;
    const A = Math.sin((1-ti)*d)/Math.sin(d), B = Math.sin(ti*d)/Math.sin(d);
    const x = A*Math.cos(la1)*Math.cos(lo1) + B*Math.cos(la2)*Math.cos(lo2);
    const y = A*Math.cos(la1)*Math.sin(lo1) + B*Math.cos(la2)*Math.sin(lo2);
    const z = A*Math.sin(la1) + B*Math.sin(la2);
    result.push([toDeg(Math.atan2(z,Math.sqrt(x*x+y*y))), toDeg(Math.atan2(y,x))]);
  }
  return result;
}

// ─── Map init ────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [20, 0], zoom: 2,
    zoomControl: false, attributionControl: false,
    minZoom: 1, maxZoom: 18, worldCopyJump: true
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
  return L.divIcon({ html, className: '', iconSize:[16,16], iconAnchor:[8,8], tooltipAnchor:[12,0] });
}

// ─── Tooltip ─────────────────────────────────────
function tooltipHtml(hop) {
  const flag   = flagEmoji(hop.geo?.countryCode);
  const color  = rttHex(hop.rtt);
  const rttStr = hop.rtt !== null ? `${hop.rtt.toFixed(1)} ms` : t('timeout_str');
  const loc    = hop.geo
    ? `${flag} ${hop.geo.city||'?'}${hop.geo.country ? ', '+hop.geo.country : ''}`
    : '🌐 ' + t('unknown');
  const v6badge = isIPv6(hop.ip) ? `<span style="font-size:9px;background:rgba(59,130,246,0.2);color:#60a5fa;padding:1px 5px;border-radius:3px;margin-left:4px;">IPv6</span>` : '';
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
  const pos = [hop.geo.lat, hop.geo.lon];
  const isOrigin = hop.hop === 1;
  const color = isOrigin ? (isDark ? '#22d3a0' : '#059669') : rttHex(hop.rtt);
  const marker = L.marker(pos, { icon: makeMarkerIcon(color, isOrigin), zIndexOffset: hop.hop }).addTo(map);
  marker.bindTooltip(tooltipHtml(hop), { className:'tv-tooltip-wrapper', sticky:false, direction:'right', offset:[10,0] });
  marker.on('click', () => selectHop(hop.hop));
  mapMarkers.push({ hopNum: hop.hop, leafletMarker: marker });

  const prevHop = [...hops].slice(0, hops.indexOf(hop)).reverse()
    .find(h => h.geo && validCoords(h.geo.lat, h.geo.lon));
  if (prevHop) {
    const prevPos = [prevHop.geo.lat, prevHop.geo.lon];
    const lineColor = isDark ? '#00d4ff' : '#0057b8';
    const dist = Math.hypot(pos[0]-prevPos[0], pos[1]-prevPos[1]);
    const arcPts = dist > 1 ? gcArc(prevPos, pos) : [prevPos, pos];
    mapLines.push(L.polyline(arcPts, { color:lineColor, weight:2, opacity:0.65 }).addTo(map));
  }

  const geoPoints = hops.filter(h => h.geo && validCoords(h.geo.lat, h.geo.lon)).map(h=>[h.geo.lat,h.geo.lon]);
  if (geoPoints.length >= 2) map.fitBounds(geoPoints, { padding:[60,60], maxZoom:9, animate:true });
  else if (geoPoints.length === 1) map.setView(geoPoints[0], 5, { animate:true });
}

// ─── Sidebar hop row ─────────────────────────────
function buildHopItem(hop) {
  const flag    = flagEmoji(hop.geo?.countryCode);
  const locStr  = hop.geo
    ? `${flag} ${hop.geo.city||t('unknown')}${hop.geo.country ? ', '+hop.geo.country : ''}`
    : '🌐 ' + t('unknown');
  const rttCol  = rttHex(hop.rtt);
  const rttBg   = rttBgColor(hop.rtt);
  const rttText = hop.rtt !== null ? `${hop.rtt.toFixed(1)} ms` : '* * *';
  const v6dot   = isIPv6(hop.ip) ? `<span class="ipv6-tag">v6</span>` : '';

  const item = document.createElement('div');
  item.className   = 'hop-item';
  item.dataset.hop = hop.hop;
  item.innerHTML = `
    <div class="hop-badge">${hop.hop}</div>
    <div class="hop-meta">
      <div class="hop-ip ${hop.timeout?'timeout':''}">${hop.ip||'* * *'}${v6dot}</div>
      <div class="hop-loc">${hop.timeout ? t('timed_out') : locStr}</div>
    </div>
    <div class="hop-rtt-badge" style="color:${rttCol};background:${rttBg}">${rttText}</div>`;
  item.addEventListener('click', () => selectHop(hop.hop));
  return item;
}

function rebuildSidebar() {
  const list = document.getElementById('hop-list');
  // Keep empty state if no hops
  if (hops.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><div class="empty-label">${t('empty_label')}</div></div>`;
    return;
  }
  // Sort hops by hop number, rebuild all items
  const sorted = [...hops].sort((a, b) => a.hop - b.hop);
  const activeHop = selected;
  list.innerHTML = '';
  sorted.forEach((hop, idx) => {
    const item = buildHopItem(hop);
    // Staggered animation only for new items
    item.style.animationDelay = `${Math.min(idx * 20, 250)}ms`;
    if (hop.hop === activeHop) item.classList.add('active');
    list.appendChild(item);
  });
  // Scroll to bottom to show latest
  list.scrollTop = list.scrollHeight;
}

function addHopToSidebar(hop) {
  rebuildSidebar();
}

// ─── Select hop ──────────────────────────────────
function selectHop(hopNum) {
  selected = hopNum;
  document.querySelectorAll('.hop-item').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.hop) === hopNum));
  // Scroll selected into view
  const activeEl = document.querySelector(`.hop-item[data-hop="${hopNum}"]`);
  activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  mapMarkers.forEach(({ hopNum:n, leafletMarker }) => {
    const el = leafletMarker.getElement();
    el?.querySelector('.tv-marker')?.classList.toggle('selected', n === hopNum);
  });
  const hop = hops.find(h => h.hop === hopNum);
  if (hop?.geo && validCoords(hop.geo.lat, hop.geo.lon))
    map.panTo([hop.geo.lat, hop.geo.lon], { animate:true, duration:0.5 });
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
    ? `${flag} ${hop.geo.city||'?'}${hop.geo.region ? ', '+hop.geo.region : ''} ${hop.geo.country||''}`
    : '—';
  const v6badge = isIPv6(hop.ip) ? `<span class="ipv6-tag" style="font-size:10px;padding:2px 6px;">IPv6</span>` : '';
  const sampleHtml = (hop.rtts||[]).map((r,i) => `
    <div class="rtt-sample">
      <div class="rtt-sample-label">T${i+1}</div>
      <div class="rtt-sample-val" style="color:${rttHex(r)}">${r !== null ? r+'ms' : '*'}</div>
    </div>`).join('');
  panel.innerHTML = `
    <div class="detail-toprow">
      <div>
        <div class="detail-hop-label">${t('hop_label')} ${hop.hop} ${v6badge}</div>
        <div class="detail-hostname mono">${hop.hostname !== hop.ip ? hop.hostname : (hop.ip||'—')}</div>
      </div>
      <div class="detail-rtt-big" style="color:${color}">${rttStr}<span class="detail-rtt-unit"> ms</span></div>
    </div>
    <div class="detail-grid">
      <div class="detail-card">
        <div class="dc-label">${t('ip_address')}</div>
        <div class="dc-val mono" style="word-break:break-all;font-size:${isIPv6(hop.ip)?'10px':'11px'}">${hop.ip||'—'}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('location')}</div>
        <div class="dc-val">${loc}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('isp_org')}</div>
        <div class="dc-val">${hop.geo?.isp||hop.geo?.org||'—'}</div>
      </div>
      <div class="detail-card">
        <div class="dc-label">${t('asn')}</div>
        <div class="dc-val mono">${hop.geo?.asn||'—'}</div>
      </div>
    </div>
    ${sampleHtml ? `<div class="rtt-samples-row">${sampleHtml}</div>` : ''}`;
}

// ─── Stats ───────────────────────────────────────
function updateStats() {
  const countries = new Set(hops.filter(h=>h.geo?.country && h.geo.country!=='Private').map(h=>h.geo.country));
  const rtts = hops.filter(h=>h.rtt!==null).map(h=>h.rtt);
  const maxRtt = rtts.length ? Math.max(...rtts) : null;
  document.getElementById('stat-hops').textContent      = hops.length;
  document.getElementById('stat-countries').textContent  = countries.size;
  document.getElementById('stat-rtt').textContent        = maxRtt !== null ? maxRtt.toFixed(0)+'ms' : '—';
}

// ─── Status ──────────────────────────────────────
function setStatus(state, key) {
  const pill = document.getElementById('status-pill');
  pill.className = `status-pill ${state}`;
  pill.querySelector('.status-text').textContent = t(key);
}

// ─── Reset ───────────────────────────────────────
function resetTrace() {
  hops = []; selected = null;
  mapMarkers.forEach(({leafletMarker}) => leafletMarker.remove());
  mapLines.forEach(l => l.remove());
  mapMarkers = []; mapLines = [];
  document.getElementById('hop-list').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🌐</div>
      <div class="empty-label">${t('empty_label')}</div>
    </div>`;
  document.getElementById('hop-detail').style.display = 'none';
  document.getElementById('stat-hops').textContent = '0';
  document.getElementById('stat-countries').textContent = '0';
  document.getElementById('stat-rtt').textContent = '—';
  map.setView([20,0], 2, { animate:true });
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

  resetTrace();
  isRunning = true;
  setStatus('running', 'tracing');
  const btn = document.getElementById('trace-btn');
  btn.textContent = t('stop');
  btn.classList.add('stopping');
  document.getElementById('map-hint').classList.add('hidden');

  window.electronAPI.onHopData(hop => {
    hops.push(hop);
    addHopToMap(hop);
    addHopToSidebar(hop);
    updateStats();
  });
  window.electronAPI.onTracerouteComplete(() => finishTrace('complete','complete'));
  window.electronAPI.onTracerouteError(err => { console.error(err); finishTrace('error','error'); });

  await window.electronAPI.startTraceroute({ target, resolveDns });
}

function finishTrace(state, key) {
  isRunning = false;
  setStatus(state, key);
  const btn = document.getElementById('trace-btn');
  btn.textContent = t('trace');
  btn.classList.remove('stopping');

  // Mark destination node red
  const lastGeo = [...hops].reverse().find(h => h.geo && validCoords(h.geo.lat, h.geo.lon));
  if (lastGeo) {
    const obj = mapMarkers.find(m => m.hopNum === lastGeo.hop);
    if (obj) {
      const el = obj.leafletMarker.getElement();
      const core = el?.querySelector('.tv-marker-core');
      const pulses = el?.querySelectorAll('.tv-marker-pulse,.tv-marker-pulse2');
      const dc = isDark ? '#f87171' : '#dc2626';
      if (core) { core.style.background=dc; core.style.boxShadow=`0 0 8px ${dc}`; }
      pulses?.forEach(p => p.style.borderColor=dc);
    }
  }

  window.electronAPI.removeAll('hop-data');
  window.electronAPI.removeAll('traceroute-complete');
  window.electronAPI.removeAll('traceroute-error');
}

async function stopTrace() {
  if (!isRunning) return;
  await window.electronAPI.stopTraceroute();
  finishTrace('idle','ready');
}

// ─── Theme ───────────────────────────────────────
function applyTileTheme() {
  if (isDark) {
    if (map.hasLayer(tileLayerLight)) tileLayerLight.remove();
    if (!map.hasLayer(tileLayerDark)) tileLayerDark.addTo(map);
  } else {
    if (map.hasLayer(tileLayerDark)) tileLayerDark.remove();
    if (!map.hasLayer(tileLayerLight)) tileLayerLight.addTo(map);
  }
}

function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('light', !isDark);
  document.getElementById('theme-toggle').textContent = isDark ? '🌙' : '☀️';
  applyTileTheme();
  const lc = isDark ? '#00d4ff' : '#0057b8';
  mapLines.forEach(l => l.setStyle({ color:lc }));
}

// ─── Language ────────────────────────────────────
function toggleLang() {
  currentLang = currentLang === 'en' ? 'pt' : 'en';
  applyLang();
  // Re-render hop list labels
  document.querySelectorAll('.hop-item .hop-loc').forEach(el => {
    const hopNum = parseInt(el.closest('.hop-item')?.dataset.hop);
    const hop = hops.find(h => h.hop === hopNum);
    if (hop) el.textContent = hop.timeout ? t('timed_out') : el.textContent;
  });
}

// ─── DOM ready ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setStatus('idle','ready');
  applyLang();

  document.getElementById('trace-btn').addEventListener('click', async () => {
    if (isRunning) await stopTrace(); else await startTrace();
  });
  document.getElementById('target-input').addEventListener('keydown', async e => {
    if (e.key === 'Enter') { if (isRunning) await stopTrace(); else await startTrace(); }
  });
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('lang-toggle').addEventListener('click', toggleLang);
  document.getElementById('btn-close')?.addEventListener('click',  () => window.electronAPI.close());
  document.getElementById('btn-min')?.addEventListener('click',    () => window.electronAPI.minimize());
  document.getElementById('btn-max')?.addEventListener('click',    () => window.electronAPI.maximize());
});
