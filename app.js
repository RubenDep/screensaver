// app.js — smooth crossfade (A/B video layers), adjustable timing, and speed control
// - Two stacked <video> elements for seamless fades (no blackout layer)
// - Holds last frame for a configurable time, then crossfades to next
// - Gentle slowdown before the hold; playback speed adjustable via admin overlay

// ---- Tunables (easy to tweak) ----------------------------------------------
const MANIFEST_URL = 'manifest.json';
const EXIT_LEAD_S = 1.5;           // start slowing this many seconds before end
const HOLD_LAST_MS = 3000;         // keep the last frame visible before switching
const CROSSFADE_MS = 2000;          // duration of the fade between videos
const INTER_CLIP_DELAY_MS = 1000;     // extra delay between hold and starting the crossfade (usually 0)
const SLOW_INTERVAL_MS = 120;      // slowdown tick interval
const MIN_SLOW_RATE = 0.5;         // floor for slowdown
const PAUSE_EPS = 0.05;            // how close (seconds) to consider "at end"

// ---- IDs in the page --------------------------------------------------------
const STAGE_ID = 'stage';          // container that already exists in your HTML
const BADGE_ID = 'badge';
const OVERLAY_ID = 'overlay';
const DIAG_ID = 'diag';

// Orientation helpers
const ORIENT = { PORTRAIT: 'portrait', LANDSCAPE: 'landscape', SQUARE: 'square' };
const ASPECT_TOL = 0.08;

// Runtime state
const state = {
  items: [],                         // { url, title, width, height, orientation }
  buckets: { portrait: [], landscape: [], square: [] },
  lastPick: { portrait: null, landscape: null, square: null },
  initialized: false,
  exiting: false,                    // we're in the end-of-video sequence
  playbackRate: 1.0,
  activeId: 'A',                     // 'A' or 'B'
};

// ---- DOM utils --------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screenOrientation = () => (window.innerHeight > window.innerWidth ? ORIENT.PORTRAIT : ORIENT.LANDSCAPE);

function ensureLayers() {
  const stage = $(STAGE_ID);
  if (!stage) throw new Error('[APP] #stage not found');

  // Reuse existing #player as layer A if present
  let a = document.getElementById('playerA');
  let b = document.getElementById('playerB');

  if (!a) {
    const existing = document.getElementById('player');
    a = existing || document.createElement('video');
    a.id = 'playerA';
    a.muted = true; a.autoplay = true; a.playsInline = true; a.preload = 'auto'; a.loop = false;
    applyLayerStyles(a);
    if (!existing) stage.appendChild(a); else existing.id = 'playerA';
  }
  if (!b) {
    b = document.createElement('video');
    b.id = 'playerB';
    b.muted = true; b.autoplay = true; b.playsInline = true; b.preload = 'auto'; b.loop = false;
    applyLayerStyles(b);
    stage.appendChild(b);
  }
  // initial vis
  a.style.opacity = '1';
  b.style.opacity = '0';
  return { a, b };
}

function applyLayerStyles(v) {
  Object.assign(v.style, {
    position: 'absolute', inset: '0', width: '100vw', height: '100vh',
    objectFit: 'contain', background: '#000', opacity: '0',
    transition: `opacity ${CROSSFADE_MS}ms ease`,
  });
  v.classList.add('fade');
}

function getActiveVideo() { return state.activeId === 'A' ? $('playerA') : $('playerB'); }
function getIdleVideo() { return state.activeId === 'A' ? $('playerB') : $('playerA'); }
function swapActive() { state.activeId = state.activeId === 'A' ? 'B' : 'A'; }

// ---- Data helpers -----------------------------------------------------------
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`[APP] Fetch failed ${r.status}`);
  return r.json();
}

function filenameFromUrl(u) {
  try { const p = new URL(u, location.href).pathname.split('/'); return decodeURIComponent(p[p.length - 1]); }
  catch { const p = (u||'').split('/'); return decodeURIComponent(p[p.length - 1] || u); }
}

function inferOrientationFromAspect(w, h) {
  if (!w || !h) return ORIENT.SQUARE; const r = w / h;
  if (Math.abs(r - 1) <= ASPECT_TOL) return ORIENT.SQUARE;
  return r > 1 ? ORIENT.LANDSCAPE : ORIENT.PORTRAIT;
}

function probeVideo(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
    v.addEventListener('loadedmetadata', () => resolve({ width: v.videoWidth, height: v.videoHeight, orientation: inferOrientationFromAspect(v.videoWidth, v.videoHeight) }));
    v.addEventListener('error', () => resolve({ width: 0, height: 0, orientation: ORIENT.SQUARE }));
  });
}

function pickNextFor(orient) {
  const b = state.buckets[orient] ?? [];
  if (!b.length) return null; if (b.length === 1) return b[0];
  const last = state.lastPick[orient];
  for (let i = 0; i < 6; i++) {
    const pick = b[Math.floor(Math.random() * b.length)];
    if (!last || last.url !== pick.url) { state.lastPick[orient] = pick; return pick; }
  }
  return b[0];
}

function updateBadge(text) { const el = $(BADGE_ID); if (el) el.textContent = text ?? ''; }
function toggleOverlay(force) { const wrap = $(OVERLAY_ID); if (wrap) wrap.classList.toggle('k', force); }
function setDiag(obj) { const el = $(DIAG_ID); if (el) el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); }

// ---- Playback primitives ----------------------------------------------------
async function waitForPlaying(v, timeout = 5000) {
  return new Promise((resolve) => {
    let done = false; const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
    const onPlay = () => finish();
    const onTime = () => { if (v.currentTime > 0) finish(); };
    const to = setTimeout(finish, timeout);
    const cleanup = () => { v.removeEventListener('playing', onPlay); v.removeEventListener('timeupdate', onTime); clearTimeout(to); };
    v.addEventListener('playing', onPlay); v.addEventListener('timeupdate', onTime);
  });
}

async function loadInto(video, item) {
  video.loop = false; video.src = item.url; video.playbackRate = state.playbackRate;
  updateBadge(item.title || filenameFromUrl(item.url));
  try { await video.play(); } catch {}
  await waitForPlaying(video);
}

async function crossfadeTo(item) {
  const active = getActiveVideo();
  const idle = getIdleVideo();
  state.exiting = false; // reset exit state for new item

  // Prepare idle layer
  await loadInto(idle, item);
  if (INTER_CLIP_DELAY_MS) await new Promise(r => setTimeout(r, INTER_CLIP_DELAY_MS));

  // Crossfade
  idle.style.opacity = '1';
  active.style.opacity = '0';
  await new Promise(r => setTimeout(r, CROSSFADE_MS));

  // Cleanup: pause old, swap roles
  try { active.pause(); } catch {}
  swapActive();
}

async function rotate() {
  const orient = screenOrientation();
  const candidate = pickNextFor(orient) || pickNextFor(ORIENT.SQUARE) || state.items[0];
  if (!candidate) return;
  await crossfadeTo(candidate);
}

function attachEndHoldLogic() {
  const watch = () => {
    const v = getActiveVideo(); if (!v) return;
    let slowTimer = null; const clearSlow = () => { if (slowTimer) { clearInterval(slowTimer); slowTimer = null; } };

    v.addEventListener('timeupdate', function onTU() {
      if (state.exiting || !v.duration || isNaN(v.duration)) return;
      const remaining = v.duration - v.currentTime;
      if (remaining <= EXIT_LEAD_S) {
        state.exiting = true;
        v.playbackRate = Math.max(MIN_SLOW_RATE, Math.min(state.playbackRate, 0.7));
        slowTimer = setInterval(async () => {
          const rem = v.duration - v.currentTime;
          if (rem <= PAUSE_EPS) {
            clearSlow();
            try { v.pause(); } catch {}
            try { v.currentTime = Math.max(0, v.duration - 0.001); } catch {}
            setTimeout(async () => { await rotate(); }, HOLD_LAST_MS);
          } else {
            v.playbackRate = Math.max(MIN_SLOW_RATE, v.playbackRate - 0.05);
          }
        }, SLOW_INTERVAL_MS);
      }
    });

    v.addEventListener('ended', async () => {
      if (!state.exiting) await rotate();
    });
  };

  watch(); // attach to the initial active video
}

// ---- UI & SW ----------------------------------------------------------------
function setupSpeedUI() {
  const overlay = $(OVERLAY_ID); if (!overlay) return; if (document.getElementById('speedPanel')) return;
  const panel = document.createElement('div'); panel.id = 'speedPanel'; panel.style.cssText = 'margin-top:8px;background:rgba(0,0,0,.4);padding:8px 10px;border-radius:8px;display:inline-flex;align-items:center;gap:10px;';
  const label = document.createElement('span'); label.id = 'speedLabel'; label.textContent = 'Speed: 1.00×';
  const input = document.createElement('input'); input.type = 'range'; input.min = '0.25'; input.max = '1.25'; input.step = '0.05'; input.value = state.playbackRate;
  input.addEventListener('input', () => { state.playbackRate = Number(input.value); ['playerA','playerB'].forEach(id => { const v = $(id); if (v) v.playbackRate = state.playbackRate; }); label.textContent = `Speed: ${state.playbackRate.toFixed(2)}×`; });
  panel.append(label, input); overlay.append(panel);
}

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      const el = document.fullscreenElement ? document : document.documentElement;
      if (document.fullscreenElement) el.exitFullscreen?.(); else el.requestFullscreen?.();
    } else if (e.key === 'n' || e.key === 'N') {
      rotate();
    } else if (e.key.toLowerCase() === 'a' && e.shiftKey) {
      toggleOverlay();
    }
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(r => console.log('[APP] SW registered', r.scope)).catch(console.error);
}

// ---- Boot -------------------------------------------------------------------
async function bootstrap() {
  registerSW();
  wireShortcuts();
  setupSpeedUI();

  // Build A/B layers (reuse #player as A if present)
  ensureLayers();

  // Load manifest
  const manifest = await fetchJSON(MANIFEST_URL).catch(e => { console.error(e); return null; });
  if (!manifest) return;
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  const probed = await Promise.all(videos.map(async it => ({ ...it, ...await probeVideo(it.url) })));

  // Fill buckets
  state.items = probed;
  state.buckets = { portrait: [], landscape: [], square: [] };
  for (const it of probed) (state.buckets[it.orientation] ||= []).push(it);

  // Start with an initial clip on the active layer
  const start = pickNextFor(screenOrientation()) || pickNextFor(ORIENT.SQUARE) || state.items[0];
  const vActive = getActiveVideo();
  await loadInto(vActive, start);
  vActive.style.opacity = '1';

  // Attach end-hold logic to manage rotation
  attachEndHoldLogic();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else bootstrap();
