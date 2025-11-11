// app.js — robust screensaver bootstrap
// - Fixes syntax error in probeVideo()
// - Adds clear init flow with logging + diagnostics overlay
// - Buckets videos by orientation (portrait/landscape/square)
// - Keyboard shortcuts: F (fullscreen), N (next), Shift+A (admin overlay)
// - SW registration with logs

const MANIFEST_URL = 'manifest.json';
const PLAYER_ID = 'player';
const BADGE_ID = 'badge';
const OVERLAY_ID = 'overlay';
const DIAG_ID = 'diag';

const ORIENT = { PORTRAIT: 'portrait', LANDSCAPE: 'landscape', SQUARE: 'square' };
const ASPECT_TOL = 0.08; // square if within ±8%

const state = {
  items: [], // { url, title, width, height, orientation }
  buckets: { portrait: [], landscape: [], square: [] },
  current: null,
  lastPick: { portrait: null, landscape: null, square: null },
  initialized: false,
};

function screenOrientation() {
  return window.innerHeight > window.innerWidth ? ORIENT.PORTRAIT : ORIENT.LANDSCAPE;
}

async function fetchJSON(url) {
  console.log('[APP] Fetching JSON:', url);
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`[APP] Fetch failed ${r.status} ${r.statusText}`);
  return r.json();
}

function filenameFromUrl(u) {
  try {
    const p = new URL(u, location.href).pathname.split('/');
    return decodeURIComponent(p[p.length - 1]);
  } catch {
    const p = (u || '').split('/');
    return decodeURIComponent(p[p.length - 1] || u);
  }
}

function inferOrientationFromAspect(w, h) {
  if (!w || !h) return ORIENT.SQUARE;
  const r = w / h;
  if (Math.abs(r - 1) <= ASPECT_TOL) return ORIENT.SQUARE;
  return r > 1 ? ORIENT.LANDSCAPE : ORIENT.PORTRAIT;
}

function probeVideo(url, timeoutMs = 8000) {
  // Resolves metadata: { width, height, orientation }
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    const onLoaded = () => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('error', onError);
      clearTimeout(to);
      const w = v.videoWidth, h = v.videoHeight;
      const orientation = inferOrientationFromAspect(w, h);
      console.log('[APP] Probed video:', { url, w, h, orientation });
      resolve({ width: w, height: h, orientation });
    };

    const onError = (e) => {
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('error', onError);
      clearTimeout(to);
      console.warn('[APP] Probe error, defaulting to square:', url, e?.message || e);
      resolve({ width: 0, height: 0, orientation: ORIENT.SQUARE });
    };

    const to = setTimeout(() => {
      console.warn('[APP] Probe timeout, defaulting to square:', url);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('error', onError);
      resolve({ width: 0, height: 0, orientation: ORIENT.SQUARE });
    }, timeoutMs);

    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('error', onError);
  });
}

function $(id) { return document.getElementById(id); }

function updateBadge(text) {
  const el = $(BADGE_ID);
  if (el) el.textContent = text ?? '';
}

function setDiag(obj) {
  const el = $(DIAG_ID);
  if (!el) return;
  try {
    el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  } catch {
    el.textContent = String(obj);
  }
}

function toggleOverlay(force) {
  const wrap = $(OVERLAY_ID);
  if (!wrap) return;
  wrap.classList.toggle('k', force);
}

function pickNextFor(orient) {
  const b = state.buckets[orient] ?? [];
  if (!b.length) return null;
  if (b.length === 1) return b[0];
  let pick;
  const last = state.lastPick[orient];
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * b.length);
    pick = b[idx];
    if (!last || last.url !== pick.url) break;
  }
  state.lastPick[orient] = pick;
  return pick;
}

async function play(item) {
  const v = $(PLAYER_ID);
  if (!v || !item) return;
  state.current = item;
  console.log('[APP] Playing:', item.url);
  v.src = item.url;
  v.loop = false;
  updateBadge(item.title || filenameFromUrl(item.url));
  try { await v.play(); } catch (e) { console.warn('[APP] Autoplay blocked?', e); }
}

async function rotate() {
  const orient = screenOrientation();
  const candidate = pickNextFor(orient) || pickNextFor(ORIENT.SQUARE) || state.items[0];
  await play(candidate);
}

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      const el = document.fullscreenElement ? document : document.documentElement;
      if (document.fullscreenElement) el.exitFullscreen?.();
      else el.requestFullscreen?.();
    } else if (e.key === 'n' || e.key === 'N') {
      rotate();
    } else if (e.key.toLowerCase() === 'a' && e.shiftKey) {
      toggleOverlay();
    }
  });
}

const v = document.getElementById(PLAYER_ID);
if (v) {
  v.loop = false; // make sure
  v.addEventListener('ended', () => {
    console.log('[APP] ended → rotate()');
    rotate();
  });
  v.addEventListener('error', (e) => {
    console.warn('[APP] video error → rotate()', e);
    rotate();
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.log('[APP] SW not supported');
    return;
  }
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('[APP] SW registered:', reg.scope))
    .catch(err => console.error('[APP] SW registration failed:', err));
}

async function bootstrap() {
  console.log('[APP] Booting screensaver…');
  // Basic DOM references ensure ids exist
  if (!$(PLAYER_ID) || !$(BADGE_ID) || !$(OVERLAY_ID) || !$(DIAG_ID)) {
    console.error('[APP] Missing required DOM elements (player/badge/overlay/diag).');
  }

  registerSW();
  wireShortcuts();

  let manifest;
  try {
    manifest = await fetchJSON(MANIFEST_URL);
  } catch (e) {
    console.error('[APP] Manifest load failed:', e);
    setDiag({ error: 'Manifest load failed', detail: String(e) });
    return;
  }

  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  if (!videos.length) {
    console.warn('[APP] No videos in manifest');
    setDiag({ warning: 'No videos in manifest' });
    return;
  }

  // Probe all videos in parallel
  const probed = await Promise.all(videos.map(async (it) => {
    const meta = await probeVideo(it.url);
    return { url: it.url, title: it.title || filenameFromUrl(it.url), ...meta };
  }));

  // Fill state + buckets
  state.items = probed;
  state.buckets = { portrait: [], landscape: [], square: [] };
  for (const it of probed) {
    (state.buckets[it.orientation] ||= []).push(it);
  }
  console.log('[APP] Buckets:', state.buckets);
  setDiag({
    orientation: screenOrientation(),
    counts: {
      portrait: state.buckets.portrait.length,
      landscape: state.buckets.landscape.length,
      square: state.buckets.square.length,
      total: state.items.length,
    },
    items: state.items.map(x => ({ url: x.url, o: x.orientation, w: x.width, h: x.height })),
  });

  state.initialized = true;
  await rotate();

  // Re-rotate on orientation/resize changes after settling
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      console.log('[APP] Resize/orientation change');
      if (state.initialized) rotate();
    }, 200);
  });
}

// Ensure DOM is ready before booting
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
