import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
  || join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'bg-wallpaper', 'panel', 'data');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  enabled: true,
  mode: 'preset',
  presetId: 'aurora',
  imagePath: '',
  uploadedFile: '',
  opacity: 0.65,
  blur: 4,
  surfaceOpacity: 62,
  fit: 'cover',
};

const PRESETS = {
  aurora: 'radial-gradient(ellipse at 18% 20%, rgba(56,189,248,0.68) 0%, transparent 50%), radial-gradient(ellipse at 82% 28%, rgba(168,85,247,0.68) 0%, transparent 52%), radial-gradient(ellipse at 50% 88%, rgba(16,185,129,0.52) 0%, transparent 55%), linear-gradient(135deg, #0b1020 0%, #17153b 50%, #0f172a 100%)',
  sunset: 'radial-gradient(circle at 75% 22%, rgba(251,146,60,0.7) 0%, transparent 45%), radial-gradient(ellipse at 25% 78%, rgba(236,72,153,0.58) 0%, transparent 52%), linear-gradient(145deg, #1b1124 0%, #2d1436 48%, #14121d 100%)',
  nebula: 'radial-gradient(circle at 25% 30%, rgba(99,102,241,0.68) 0%, transparent 48%), radial-gradient(circle at 78% 72%, rgba(14,165,233,0.55) 0%, transparent 48%), linear-gradient(160deg, #090d16 0%, #111827 60%, #0b1120 100%)',
  forest: 'radial-gradient(ellipse at 20% 25%, rgba(52,211,153,0.52) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(6,182,212,0.48) 0%, transparent 50%), linear-gradient(140deg, #071917 0%, #0f2922 50%, #0a1419 100%)',
};

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

const app = new SidecarApp();
const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

app.page('/', () => readLocal('index.html'));
app.page('/app.js', () => readLocal('app.js'));
app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css' }), 'GET');

let lastCdpStatus = { connected: false, port: null, pages: 0, error: null };

function getDevToolsPortFile() {
  const candidates = [
    join(os.homedir(), '.config', 'Antigravity', 'DevToolsActivePort'),
    join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
    join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort'),
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

function getDevToolsPort() {
  const f = getDevToolsPortFile();
  if (!f) return null;
  try {
    const firstLine = readFileSync(f, 'utf8').trim().split(/\r?\n/)[0].trim();
    const port = Number(firstLine);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch (_) {
    return null;
  }
}

function cdpEval(wsUrl, expression, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (_) {}
        reject(new Error('CDP eval timeout'));
      }
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data));
        if (msg.id === 1 && !settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.result?.value);
        }
      } catch (_) {}
    };
    ws.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('WebSocket error'));
      }
    };
  });
}

function loadSettings() {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function saveSettings(next) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function fileToDataUrl(filePath) {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const ext = extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || 'image/png';
    const buf = readFileSync(filePath);
    if (buf.length > 25 * 1024 * 1024) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function buildPayload(forceDisable = false) {
  const s = loadSettings();
  const active = !forceDisable && s.enabled !== false;
  let bgCssValue = PRESETS[s.presetId] || PRESETS.aurora;

  if (s.mode === 'uploaded' && s.uploadedFile) {
    const dataUrl = fileToDataUrl(join(DATA_DIR, s.uploadedFile));
    if (dataUrl) bgCssValue = `url("${dataUrl}")`;
  } else if (s.mode === 'file' && s.imagePath) {
    const resolved = s.imagePath.startsWith('~')
      ? join(os.homedir(), s.imagePath.slice(1))
      : s.imagePath;
    const dataUrl = fileToDataUrl(resolved);
    if (dataUrl) bgCssValue = `url("${dataUrl}")`;
  }

  return {
    active,
    bgCssValue,
    opacity: Math.min(Math.max(Number(s.opacity) || 0.65, 0.05), 1),
    blur: Math.min(Math.max(Number(s.blur) || 0, 0), 40),
    surfaceOpacity: Math.min(Math.max(Number(s.surfaceOpacity) || 62, 15), 95),
    fit: s.fit === 'contain' ? 'contain' : 'cover',
  };
}

function buildRendererScript(payload) {
  const jsonPayload = JSON.stringify(payload);
  return `
(function applyAgyBgWallpaper(cfg) {
  try {
    const STYLE_ID = 'agy-bg-wallpaper-style';
    const LAYER_ID = 'agy-bg-wallpaper-layer';
    const SCRIM_ID = 'agy-bg-wallpaper-scrim';
    const ROOT_ATTR = 'data-agy-bgwp-active';

    function removeWallpaper() {
      document.documentElement.removeAttribute(ROOT_ATTR);
      for (const id of [STYLE_ID, LAYER_ID, SCRIM_ID]) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
    }

    if (!cfg || !cfg.active) {
      removeWallpaper();
      return 'removed';
    }

    function captureOriginalTokens() {
      const wasActive = document.documentElement.hasAttribute(ROOT_ATTR);
      if (wasActive) document.documentElement.removeAttribute(ROOT_ATTR);
      const cs = getComputedStyle(document.documentElement);
      const tokens = ['background', 'content', 'sidebar', 'card', 'secondary', 'muted', 'sidebar-secondary', 'sidebar-muted'];
      for (const t of tokens) {
        const val = cs.getPropertyValue('--' + t).trim();
        if (val && !val.includes('transparent')) {
          document.documentElement.style.setProperty('--bgwp-orig-' + t, val);
        }
      }
      if (wasActive) document.documentElement.setAttribute(ROOT_ATTR, 'true');
    }

    if (!window.__AGY_BGWP_THEME_WATCHER__) {
      captureOriginalTokens();
      let timer = null;
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(captureOriginalTokens, 80);
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      window.__AGY_BGWP_THEME_WATCHER__ = obs;
    } else if (!document.documentElement.style.getPropertyValue('--bgwp-orig-background')) {
      captureOriginalTokens();
    }

    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      document.documentElement.prepend(layer);
    }

    let scrim = document.getElementById(SCRIM_ID);
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = SCRIM_ID;
      layer.insertAdjacentElement('afterend', scrim);
    }

    // Single-layer glass math: left sidebar, center chat & right sidebar match identically
    const scrimPct = Math.max(cfg.surfaceOpacity - 22, 0);
    const sidebarTintPct = Math.min(Math.max(Math.round(cfg.surfaceOpacity * 0.28), 8), 42);
    const cardTintPct = Math.min(Math.max(Math.round(cfg.surfaceOpacity * 0.62), 25), 76);
    const popoverTintPct = Math.min(Math.max(cfg.surfaceOpacity + 18, 78), 94);
    const blurPx = cfg.blur;
    const scale = blurPx > 0 ? (1 + blurPx * 0.004).toFixed(3) : '1';

    const css = \`
      #\${LAYER_ID} {
        position: fixed !important;
        inset: 0 !important;
        z-index: 0 !important;
        pointer-events: none !important;
        background-image: \${cfg.bgCssValue} !important;
        background-size: \${cfg.fit} !important;
        background-position: center center !important;
        background-repeat: no-repeat !important;
        opacity: \${cfg.opacity} !important;
        filter: blur(\${blurPx}px) !important;
        transform: scale(\${scale}) !important;
        transition: opacity 0.25s ease, filter 0.25s ease !important;
      }

      #\${SCRIM_ID} {
        position: fixed !important;
        inset: 0 !important;
        z-index: 0 !important;
        pointer-events: none !important;
        background-color: color-mix(in srgb, var(--bgwp-orig-background, #101010) \${scrimPct}%, transparent) !important;
        transition: background-color 0.2s ease !important;
      }

      html[\${ROOT_ATTR}="true"] {
        background-color: var(--bgwp-orig-background, #101010) !important;
        --background: color-mix(in srgb, var(--bgwp-orig-background, #101010) 14%, transparent) !important;
        --content: color-mix(in srgb, var(--bgwp-orig-content, var(--bgwp-orig-background, #101010)) 12%, transparent) !important;
        --sidebar: color-mix(in srgb, var(--bgwp-orig-sidebar, #161616) \${sidebarTintPct}%, transparent) !important;
        --sidebar-secondary: color-mix(in srgb, var(--bgwp-orig-sidebar-secondary, #222222) \${Math.min(sidebarTintPct + 14, 55)}%, transparent) !important;
        --sidebar-muted: color-mix(in srgb, var(--bgwp-orig-sidebar-muted, #1a1a1a) \${sidebarTintPct}%, transparent) !important;
        --card: color-mix(in srgb, var(--bgwp-orig-card, #181818) \${cardTintPct}%, transparent) !important;
      }

      html[\${ROOT_ATTR}="true"] body,
      html[\${ROOT_ATTR}="true"] #root,
      html[\${ROOT_ATTR}="true"] #root > div {
        position: relative !important;
        z-index: 1 !important;
        background-color: transparent !important;
      }

      /* Prevent nested .bg-sidebar elements (project headers/buttons) from stacking dark blocks */
      html[\${ROOT_ATTR}="true"] .bg-sidebar .bg-sidebar {
        background-color: transparent !important;
      }

      html[\${ROOT_ATTR}="true"] iframe {
        background-color: transparent !important;
      }

      /* Keep popups, menus & dialogs crisp and easy to read */
      html[\${ROOT_ATTR}="true"] [role="menu"],
      html[\${ROOT_ATTR}="true"] [role="dialog"],
      html[\${ROOT_ATTR}="true"] [role="listbox"],
      html[\${ROOT_ATTR}="true"] [data-radix-popper-content-wrapper] > div {
        background-color: color-mix(in srgb, var(--bgwp-orig-card, #1c1c22) \${popoverTintPct}%, transparent) !important;
        backdrop-filter: blur(16px) !important;
      }
    \`;

    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    document.documentElement.setAttribute(ROOT_ATTR, 'true');
    return 'applied';
  } catch (e) {
    return 'error:' + (e && e.message ? e.message : String(e));
  }
})(${jsonPayload});
`;
}

function buildIframeGlassScript(payload) {
  const jsonPayload = JSON.stringify({
    active: payload.active,
    surfaceOpacity: payload.surfaceOpacity,
    colorScheme: payload.colorScheme || 'dark',
  });
  return `
(function applyAgyBgWallpaperIframe(cfg) {
  try {
    const STYLE_ID = 'agy-bg-wallpaper-iframe-style';
    const existing = document.getElementById(STYLE_ID);
    if (!cfg || !cfg.active) {
      if (existing) existing.remove();
      return 'removed';
    }
    const panelTint = Math.min(Math.max(Math.round(cfg.surfaceOpacity * 0.28), 8), 42);
    const cardTint = Math.min(Math.max(Math.round(cfg.surfaceOpacity * 0.72), 38), 82);
    const baseColor = cfg.colorScheme === 'light' ? '#ffffff' : '#101016';
    const cardColor = cfg.colorScheme === 'light' ? '#f8fafc' : '#181822';
    const css = \`
      :root, html {
        color-scheme: \${cfg.colorScheme} !important;
        background: transparent !important;
        min-height: 100% !important;
      }
      body {
        background: color-mix(in srgb, \${baseColor} \${panelTint}%, transparent) !important;
        min-height: 100vh !important;
      }
      .card {
        background: color-mix(in srgb, \${cardColor} \${cardTint}%, transparent) !important;
        backdrop-filter: blur(12px) !important;
        border-color: color-mix(in srgb, var(--border, #3c3c4e) 65%, transparent) !important;
      }
      .dropzone, .preset-btn, .preview-box, .dict-item, input[type="text"], .select-box {
        background: color-mix(in srgb, \${baseColor} \${Math.min(cardTint + 10, 88)}%, transparent) !important;
      }
    \`;
    let styleEl = existing;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
    return 'applied-iframe:' + cfg.colorScheme;
  } catch (_) {
    return 'err';
  }
})(${jsonPayload});
`;
}

async function applyToMainWindows(forceDisable = false) {
  const port = getDevToolsPort();
  if (!port) {
    lastCdpStatus = { connected: false, port: null, pages: 0, error: '未检测到 DevToolsActivePort' };
    return lastCdpStatus;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await res.json();
    const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('devtools://'));
    const pluginIframes = targets.filter((t) => t.type === 'iframe' && t.webSocketDebuggerUrl && String(t.url || '').startsWith('plugin://'));

    const payload = buildPayload(forceDisable);
    const pageScript = buildRendererScript(payload);

    let detectedColorScheme = 'dark';
    for (const page of pages) {
      const cs = await cdpEval(page.webSocketDebuggerUrl, 'getComputedStyle(document.documentElement).colorScheme').catch(() => null);
      if (cs === 'light' || cs === 'dark') detectedColorScheme = cs;
      await cdpEval(page.webSocketDebuggerUrl, pageScript).catch(() => {});
    }

    const iframeScript = buildIframeGlassScript({ ...payload, colorScheme: detectedColorScheme });
    for (const ifr of pluginIframes) {
      await cdpEval(ifr.webSocketDebuggerUrl, iframeScript).catch(() => {});
    }

    lastCdpStatus = { connected: pages.length > 0, port, pages: pages.length, error: null };
    return lastCdpStatus;
  } catch (err) {
    lastCdpStatus = { connected: false, port, pages: 0, error: err.message };
    return lastCdpStatus;
  }
}

async function ensureInjectedLoop() {
  const port = getDevToolsPort();
  if (!port) return;
  try {
    const s = loadSettings();
    if (!s.enabled) return;
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await res.json();
    const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('devtools://'));
    const pluginIframes = targets.filter((t) => t.type === 'iframe' && t.webSocketDebuggerUrl && String(t.url || '').startsWith('plugin://'));

    let needApply = false;
    for (const page of pages) {
      const alive = await cdpEval(page.webSocketDebuggerUrl, 'Boolean(document.getElementById("agy-bg-wallpaper-layer"))').catch(() => false);
      if (!alive) { needApply = true; break; }
    }
    if (!needApply) {
      for (const ifr of pluginIframes) {
        const alive = await cdpEval(ifr.webSocketDebuggerUrl, 'Boolean(document.getElementById("agy-bg-wallpaper-iframe-style"))').catch(() => false);
        if (!alive) { needApply = true; break; }
      }
    }
    if (needApply) {
      await applyToMainWindows(false);
    }
    lastCdpStatus = { connected: pages.length > 0, port, pages: pages.length, error: null };
  } catch (_) {}
}

// APIs
app.api('/api/state', async () => {
  const settings = loadSettings();
  if (!lastCdpStatus.connected) {
    await applyToMainWindows(false);
  }
  return {
    settings,
    runtime: { hookActive: lastCdpStatus.connected, port: lastCdpStatus.port, pages: lastCdpStatus.pages },
  };
}, 'GET');

app.api('/api/settings', async (data) => {
  const current = loadSettings();
  const next = {
    ...current,
    ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
    ...(data.mode ? { mode: String(data.mode) } : {}),
    ...(data.presetId ? { presetId: String(data.presetId) } : {}),
    ...(data.imagePath !== undefined ? { imagePath: String(data.imagePath).trim() } : {}),
    ...(data.opacity !== undefined ? { opacity: Math.min(Math.max(Number(data.opacity), 0.05), 1) } : {}),
    ...(data.blur !== undefined ? { blur: Math.min(Math.max(Number(data.blur), 0), 40) } : {}),
    ...(data.surfaceOpacity !== undefined ? { surfaceOpacity: Math.min(Math.max(Number(data.surfaceOpacity), 15), 95) } : {}),
    ...(data.fit ? { fit: data.fit === 'contain' ? 'contain' : 'cover' } : {}),
  };

  if (next.mode === 'file' && next.imagePath) {
    const resolved = next.imagePath.startsWith('~')
      ? join(os.homedir(), next.imagePath.slice(1))
      : next.imagePath;
    if (!existsSync(resolved)) {
      return new Response(JSON.stringify({ error: `找不到本地图片文件: ${resolved}` }), {
        contentType: 'application/json',
        status: 400,
      });
    }
  }

  saveSettings(next);
  await applyToMainWindows(false);
  return { ok: true, settings: next };
});

app.api('/api/upload', async (data) => {
  const dataUrl = String(data.dataUrl ?? '');
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return new Response(JSON.stringify({ error: '无效的图片格式' }), {
      contentType: 'application/json',
      status: 400,
    });
  }
  const mime = match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 20 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '图片体积不能超过 20MB' }), {
      contentType: 'application/json',
      status: 400,
    });
  }
  const extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
  };
  const ext = extMap[mime] || extname(String(data.filename || '')) || '.png';
  const targetName = `wallpaper${ext}`;

  mkdirSync(DATA_DIR, { recursive: true });
  const current = loadSettings();
  if (current.uploadedFile && current.uploadedFile !== targetName) {
    try { unlinkSync(join(DATA_DIR, current.uploadedFile)); } catch (_) {}
  }

  writeFileSync(join(DATA_DIR, targetName), buf);
  const next = {
    ...current,
    enabled: true,
    mode: 'uploaded',
    uploadedFile: targetName,
  };
  saveSettings(next);
  await applyToMainWindows(false);
  return { ok: true, settings: next };
});

async function shutdown() {
  try { await applyToMainWindows(true); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.run();

setTimeout(() => { applyToMainWindows(false); }, 400);
setInterval(ensureInjectedLoop, 3000);
