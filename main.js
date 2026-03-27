const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path  = require('path');
const { spawn } = require('child_process');
const https = require('https');
const http  = require('http');
const dns   = require('dns').promises;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1100, minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
    frame: false,
    backgroundColor: '#070d1a',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Window controls ───────────────────────────────
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());

// ── External browser (WHOIS, etc.) ───────────────
const ALLOWED_EXTERNAL = /^https:\/\/(who\.is|www\.arin\.net|search\.arin\.net|stat\.ripe\.net|bgp\.he\.net|ipinfo\.io)/;
ipcMain.handle('open-external', (_, url) => {
  if (ALLOWED_EXTERNAL.test(url)) shell.openExternal(url);
});

// ── Caches ───────────────────────────────────────
const geoCache = new Map();
const dnsCache  = new Map();

// ── Private IP detection ─────────────────────────
function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(isNaN)) return false;
  return p[0] === 10 || p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127); // CGNAT
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  return lower === '::1' ||
    lower.startsWith('fe80') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('::ffff:') ||
    lower === '::';
}

function isPrivateIP(ip) {
  if (!ip) return true;
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

// ── HTTP helper ──────────────────────────────────
function httpRequest(url, isHttps = false, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Geo lookup ───────────────────────────────────
async function fetchGeo(ip) {
  if (!ip) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);

  if (isPrivateIP(ip)) {
    const local = {
      ip, city: 'Local Network', region: '', country: 'Private',
      countryCode: '', lat: null, lon: null,
      isp: 'Private Network', org: '', asn: '',
    };
    geoCache.set(ip, local);
    return local;
  }

  // Primary: ip-api.com
  try {
    const fields = 'status,country,countryCode,regionName,city,lat,lon,isp,org,as,query';
    const d = await httpRequest(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`);
    if (d.status === 'success') {
      const result = {
        ip: d.query || ip,
        city: d.city || 'Unknown',
        region: d.regionName || '',
        country: d.country || 'Unknown',
        countryCode: (d.countryCode || '').toUpperCase(),
        lat: d.lat, lon: d.lon,
        isp: d.isp || d.org || 'Unknown',
        org: d.org || '',
        asn: d.as || '',
      };
      geoCache.set(ip, result);
      return result;
    }
  } catch (_) {}

  // Fallback: ipinfo.io
  try {
    const d = await httpRequest(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, true);
    if (d && d.ip) {
      const [lat, lon] = (d.loc || '0,0').split(',').map(Number);
      const result = {
        ip: d.ip, city: d.city || 'Unknown', region: d.region || '',
        country: d.country || 'Unknown',
        countryCode: (d.country || '').toUpperCase(),
        lat, lon,
        isp: d.org || 'Unknown', org: d.org || '', asn: d.org || '',
      };
      geoCache.set(ip, result);
      return result;
    }
  } catch (_) {}

  const empty = { ip, city: 'Unknown', region: '', country: 'Unknown', countryCode: '', lat: null, lon: null, isp: 'Unknown', org: '', asn: '' };
  geoCache.set(ip, empty);
  return empty;
}

// ── DNS reverse lookup ───────────────────────────
async function resolveHostname(ip) {
  if (!ip || isPrivateIP(ip)) return null;
  if (dnsCache.has(ip)) return dnsCache.get(ip);
  try {
    const hostnames = await dns.reverse(ip);
    const name = hostnames[0] || null;
    dnsCache.set(ip, name);
    return name;
  } catch (_) {
    dnsCache.set(ip, null);
    return null;
  }
}

// ── IP extraction regexes ────────────────────────
const IPV6_RE            = /\[?([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7})\]?/;
const IPV4_RE            = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_IN_BRACKETS   = /\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/;
const IPV4_GENERAL       = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

function extractIP(token) {
  const bv4 = IPV4_IN_BRACKETS.exec(token);
  if (bv4) return bv4[1];
  if (IPV4_RE.test(token)) return token;
  const v6m = IPV6_RE.exec(token);
  if (v6m && v6m[1].includes(':')) return v6m[1];
  return null;
}

// ── Windows tracert parser ───────────────────────
function parseWindowsLine(line) {
  const trimmed = line.trim();
  const hopMatch = /^(\d+)/.exec(trimmed);
  if (!hopMatch) return null;
  const hop  = parseInt(hopMatch[1]);
  const rest = trimmed.substring(hopMatch[0].length).trim();

  if (/^\*\s+\*\s+\*/.test(rest) || /solicita.*esgotou/i.test(rest) || /timed out/i.test(rest) || /Timeout/i.test(rest)) {
    return { hop, rtt: null, ip: null, hostname: null, timeout: true, rtts: [null, null, null] };
  }

  const tokens = rest.split(/\s+/);
  const rtts = [];
  let ip = null, hostname = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '*') { rtts.push(null); continue; }
    if (t === 'ms' && i > 0) {
      const prev = tokens[i - 1];
      if (prev === '<1') rtts.push(0.5);
      else if (/^\d+$/.test(prev)) rtts.push(parseInt(prev));
      continue;
    }
    const extracted = extractIP(t);
    if (extracted) { ip = extracted; continue; }
    if (!ip && /^[a-zA-Z][\w\-\.]+$/.test(t) && t !== 'ms') hostname = t;
  }

  if (!ip) return null;
  if (!hostname) hostname = ip;
  const valid  = rtts.filter(r => r !== null);
  const avgRtt = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null;
  return { hop, rtt: avgRtt, ip, hostname, timeout: false, rtts };
}

// ── Unix traceroute parser ───────────────────────
function parseUnixLine(line) {
  const trimmed = line.trim();
  const hopMatch = /^(\d+)/.exec(trimmed);
  if (!hopMatch) return null;
  const hop  = parseInt(hopMatch[1]);
  const rest = trimmed.substring(hopMatch[0].length).trim();

  if (/^\*/.test(rest) || /^\* \* \*/.test(rest)) {
    return { hop, rtt: null, ip: null, hostname: null, timeout: true, rtts: [null, null, null] };
  }

  let ip = null, hostname = null;

  // Try to extract IPv6 first
  const v6m = IPV6_RE.exec(rest);
  if (v6m && v6m[1].includes(':')) ip = v6m[1];

  // Then IPv4
  if (!ip) {
    const v4m = IPV4_GENERAL.exec(rest);
    if (v4m) ip = v4m[1];
  }

  if (!ip) return null;

  // Extract hostname from "hostname (ip)" format
  const hostnameMatch = /^([^\s\(\*]+)\s*[\(\[]/.exec(rest);
  if (hostnameMatch && hostnameMatch[1] !== ip) hostname = hostnameMatch[1];
  else hostname = ip;

  const rttMatches = [...rest.matchAll(/(\d+\.?\d*)\s*ms/g)];
  const rtts = rttMatches.slice(0, 3).map(m => parseFloat(m[1]));
  while (rtts.length < 3) rtts.push(null);

  const valid  = rtts.filter(r => r !== null);
  const avgRtt = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10 : null;
  return { hop, rtt: avgRtt, ip, hostname, timeout: false, rtts };
}

function parseLine(line) {
  return process.platform === 'win32' ? parseWindowsLine(line) : parseUnixLine(line);
}

// ── Detect IPv6 target ───────────────────────────
function looksLikeIPv6(target) {
  return target.includes(':');
}

// ── Traceroute IPC ────────────────────────────────
let currentProc = null;
let traceStartTime = null;

ipcMain.handle('start-traceroute', async (event, { target, resolveDns }) => {
  if (currentProc) { try { currentProc.kill(); } catch (_) {} currentProc = null; }

  const isWin   = process.platform === 'win32';
  const isMac   = process.platform === 'darwin';
  const isIPv6t = looksLikeIPv6(target);
  let cmd, args;

  if (isWin) {
    cmd  = 'tracert';
    args = resolveDns
      ? ['-w', '3000', '-h', '30', target]
      : ['-d', '-w', '3000', '-h', '30', target];
  } else if (isMac && isIPv6t) {
    cmd  = 'traceroute6';
    args = ['-m', '30', '-w', '3', resolveDns ? '' : '-n', target].filter(Boolean);
  } else {
    cmd  = 'traceroute';
    args = ['-m', '30', '-w', '3',
      isIPv6t && !isMac ? '-6' : '',
      resolveDns ? '' : '-n',
      target
    ].filter(Boolean);
  }

  traceStartTime = Date.now();

  return new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, { shell: true });
      currentProc = proc;
      let buffer = '';
      const pendingHops = new Map();
      let nextExpected  = 1;

      async function flushQueue() {
        while (pendingHops.has(nextExpected)) {
          const hopData = await pendingHops.get(nextExpected);
          pendingHops.delete(nextExpected);
          nextExpected++;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hop-data', hopData);
          }
        }
      }

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString('latin1');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const parsed = parseLine(line);
          if (!parsed || parsed.hop < 1 || parsed.hop > 64) continue;

          const hopPromise = (async () => {
            let geo = null;
            let resolvedHostname = parsed.hostname;
            if (parsed.ip) {
              geo = await fetchGeo(parsed.ip);
              if (resolveDns && parsed.hostname === parsed.ip) {
                const resolved = await resolveHostname(parsed.ip);
                if (resolved) resolvedHostname = resolved;
              }
            }
            return { ...parsed, hostname: resolvedHostname, geo };
          })();

          pendingHops.set(parsed.hop, hopPromise);
          hopPromise.then(() => flushQueue()).catch(() => {});
        }
      });

      proc.stderr.on('data', () => {});
      proc.on('close', (code) => {
        currentProc = null;
        const duration = traceStartTime ? ((Date.now() - traceStartTime) / 1000).toFixed(1) : null;
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('traceroute-complete', { code, duration });
        resolve({ success: true });
      });
      proc.on('error', (err) => {
        currentProc = null;
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('traceroute-error', { message: err.message });
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('stop-traceroute', () => {
  if (currentProc) { try { currentProc.kill('SIGTERM'); } catch (_) {} currentProc = null; }
  return { success: true };
});
