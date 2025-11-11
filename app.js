// app.js — smooth crossfade (A/B video layers), adjustable timing, speed control, and transition settings
// - Two stacked <video> elements for seamless fades
// - User controls for hold duration, crossfade speed, and transition style

// ---- Tunables ---------------------------------------------------------------
const MANIFEST_URL = 'manifest.json';
let EXIT_LEAD_S = 1.5;            // start slowing this many seconds before end
let HOLD_LAST_MS = Number(localStorage.getItem('holdMs')) || 3000;
let CROSSFADE_MS = Number(localStorage.getItem('fadeMs')) || 700;
const INTER_CLIP_DELAY_MS = 0;
const SLOW_INTERVAL_MS = 120;
const MIN_SLOW_RATE = 0.5;
const PAUSE_EPS = 0.05;

// ---- IDs in the page --------------------------------------------------------
const STAGE_ID = 'stage';
const BADGE_ID = 'badge';
const OVERLAY_ID = 'overlay';
const DIAG_ID = 'diag';

const ORIENT = { PORTRAIT: 'portrait', LANDSCAPE: 'landscape', SQUARE: 'square' };
const ASPECT_TOL = 0.08;

const state = {
  items: [],
  buckets: { portrait: [], landscape: [], square: [] },
  lastPick: { portrait: null, landscape: null, square: null },
  initialized: false,
  exiting: false,
  playbackRate: 1.0,
  activeId: 'A',
  holdEnabled: JSON.parse(localStorage.getItem('holdEnabled') ?? 'true'),
  transition: localStorage.getItem('transition') || 'crossfade', // crossfade | cut | fade | slide
};

const $ = (id) => document.getElementById(id);
const screenOrientation = () => (window.innerHeight > window.innerWidth ? ORIENT.PORTRAIT : ORIENT.LANDSCAPE);

function ensureLayers() {
  const stage = $(STAGE_ID);
  if (!stage) throw new Error('[APP] #stage not found');
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
}

function getActiveVideo() { return state.activeId === 'A' ? $('playerA') : $('playerB'); }
function getIdleVideo() { return state.activeId === 'A' ? $('playerB') : $('playerA'); }
function swapActive() { state.activeId = state.activeId === 'A' ? 'B' : 'A'; }

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
  state.exiting = false;
  await loadInto(idle, item);
  if (INTER_CLIP_DELAY_MS) await new Promise(r => setTimeout(r, INTER_CLIP_DELAY_MS));

  if (state.transition === 'crossfade') {
    idle.style.transition = `opacity ${CROSSFADE_MS}ms ease`;
    active.style.transition = `opacity ${CROSSFADE_MS}ms ease`;
    idle.style.opacity = '1';
    active.style.opacity = '0';
    await new Promise(r => setTimeout(r, CROSSFADE_MS));
  } else if (state.transition === 'fade') {
    active.style.opacity = '0';
    await new Promise(r => setTimeout(r, CROSSFADE_MS / 2));
    idle.style.opacity = '1';
  } else if (state.transition === 'cut') {
    active.style.opacity = '0'; idle.style.opacity = '1';
  }
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
            if (state.holdEnabled) setTimeout(async () => { await rotate(); }, HOLD_LAST_MS); else await rotate();
          } else {
            v.playbackRate = Math.max(MIN_SLOW_RATE, v.playbackRate - 0.05);
          }
        }, SLOW_INTERVAL_MS);
      }
    });
  };
  watch();
}

function setupSpeedUI() {
  const overlay = $(OVERLAY_ID); if (!overlay) return; if (document.getElementById('speedPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'speedPanel';
  panel.style.cssText = 'margin-top:8px;background:rgba(0,0,0,.4);padding:8px 10px;border-radius:8px;display:flex;flex-direction:column;gap:8px;';

  // Speed
  const speedRow = document.createElement('div'); speedRow.style.display = 'flex'; speedRow.style.alignItems = 'center'; speedRow.style.gap = '8px';
  const speedLbl = document.createElement('span'); speedLbl.textContent = `Speed: ${state.playbackRate.toFixed(2)}×`;
  const speedIn = document.createElement('input'); speedIn.type = 'range'; speedIn.min = '0.25'; speedIn.max = '1.25'; speedIn.step = '0.05'; speedIn.value = state.playbackRate;
  speedIn.oninput = () => { state.playbackRate = Number(speedIn.value); ['playerA','playerB'].forEach(id => { const v = $(id); if (v) v.playbackRate = state.playbackRate; }); speedLbl.textContent = `Speed: ${state.playbackRate.toFixed(2)}×`; };
  speedRow.append(speedLbl, speedIn);

  // Hold duration
  const holdRow = document.createElement('div'); holdRow.style.display = 'flex'; holdRow.style.alignItems = 'center'; holdRow.style.gap = '8px';
  const holdLbl = document.createElement('span'); holdLbl.textContent = `Hold: ${(HOLD_LAST_MS/1000).toFixed(1)}s`;
  const holdIn = document.createElement('input'); holdIn.type = 'range'; holdIn.min = '0'; holdIn.max = '10'; holdIn.step = '0.5'; holdIn.value = HOLD_LAST_MS / 1000;
  holdIn.oninput = () => { HOLD_LAST_MS = Number(holdIn.value) * 1000; localStorage.setItem('holdMs', HOLD_LAST_MS); holdLbl.textContent = `Hold: ${holdIn.value}s`; };
  holdRow.append(holdLbl, holdIn);

  // Crossfade duration
  const fadeRow = document.createElement('div'); fadeRow.style.display = 'flex'; fadeRow.style.alignItems = 'center'; fadeRow.style.gap = '8px';
  const fadeLbl = document.createElement('span'); fadeLbl.textContent = `Fade: ${(CROSSFADE_MS/1000).toFixed(1)}s`;
  const fadeIn = document.createElement('input'); fadeIn.type = 'range'; fadeIn.min = '0'; fadeIn.max = '5'; fadeIn.step = '0.1'; fadeIn.value = CROSSFADE_MS / 1000;
  fadeIn.oninput = () => { CROSSFADE_MS = Number(fadeIn.value) * 1000; localStorage.setItem('fadeMs', CROSSFADE_MS); fadeLbl.textContent = `Fade: ${fadeIn.value}s`; ['playerA','playerB'].forEach(v=>{if(v) v.style.transition=`opacity ${CROSSFADE_MS}ms ease`;}); };
  fadeRow.append(fadeLbl, fadeIn);

  // Transition style
  const styleRow = document.createElement('div'); styleRow.style.display = 'flex'; styleRow.style.alignItems = 'center'; styleRow.style.gap = '8px';
  const styleLbl = document.createElement('span'); styleLbl.textContent = 'Transition:';
  const styleSel = document.createElement('select');
  ['crossfade','cut','fade'].forEach(opt=>{const o=document.createElement('option');o.value=opt;o.textContent=opt[0].toUpperCase()+opt.slice(1);if(state.transition===opt)o.selected=true;styleSel.append(o);});
  styleSel.onchange = () => { state.transition = styleSel.value; localStorage.setItem('transition', state.transition); };
  styleRow.append(styleLbl, styleSel);

  panel.append(speedRow, holdRow, fadeRow, styleRow);
  overlay.append(panel);
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

async function bootstrap() {
  registerSW();
  wireShortcuts();
  setupSpeedUI();
  ensureLayers();
  const manifest = await fetchJSON(MANIFEST_URL).catch(e => { console.error(e); return null; });
  if (!manifest) return;
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  const probed = await Promise.all(videos.map(async it => ({ ...it, ...await probeVideo(it.url) })));
  state.items = probed; state.buckets = { portrait: [], landscape: [], square: [] };
  for (const it of probed) (state.buckets[it.orientation] ||= []).push(it);
  const start = pickNextFor(screenOrientation()) || pickNextFor(ORIENT.SQUARE) || state.items[0];
  const vActive = getActiveVideo();
  await loadInto(vActive, start);
  vActive.style.opacity = '1';
  attachEndHoldLogic();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else bootstrap();
