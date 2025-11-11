// Screensaver player with: orientation auto-detect, filename badge, cache-friendly fetches.


const MANIFEST_URL = 'manifest.json';
const PLAYER_ID = 'player';
const BADGE_ID = 'badge';
const OVERLAY_ID = 'overlay';
const DIAG_ID = 'diag';


const ORIENT = { PORTRAIT: 'portrait', LANDSCAPE: 'landscape', SQUARE: 'square' };
const ASPECT_TOL = 0.08; // "loosely" decide orientation: e.g., 16:9 => 1.78, square ~1.0


const state = {
  items: [], // { url, title, orientation }
  buckets: { portrait: [], landscape: [] },
  current: null,
  lastPick: { portrait: null, landscape: null },
};


function screenOrientation() {
  return window.innerHeight > window.innerWidth ? ORIENT.PORTRAIT : ORIENT.LANDSCAPE;
}


async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Manifest fetch failed');
  return r.json();
}


function filenameFromUrl(u) {
  try {
    const p = new URL(u).pathname.split('/');
    return decodeURIComponent(p[p.length - 1]);
  } catch {
    const p = (u||'').split('/');
    return decodeURIComponent(p[p.length - 1] || u);
  }
}


function inferOrientationFromAspect(w, h) {
  if (!w || !h) return ORIENT.SQUARE;
  const r = w / h;
  if (Math.abs(r - 1) <= ASPECT_TOL) return ORIENT.SQUARE;
  return r > 1 ? ORIENT.LANDSCAPE : ORIENT.PORTRAIT;
}


function probeVideo(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const done = () => {
      const w = v.videoWidth, h = v.videoHeight;
      resolve({ width: w, height: h, orientation: inferOrientationFromAspect(w, h) });
      main().catch(console.error);
      }
    })
}

