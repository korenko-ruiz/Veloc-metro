/* =====================================================================
   VelociGPS — lógica de la app (vanilla JS, sin build tools)
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const appEl = $('app');

const state = {
  tracking: false,
  watchId: null,
  lastFix: null,          // {lat, lon, t}
  speedKmh: 0,
  maxSpeed: 0,
  distanceKm: 0,           // distancia del viaje actual
  totalOdometerKm: loadNum('totalOdometerKm', 0),
  startTime: null,
  elapsedSec: 0,
  timerInterval: null,
  theme: localStorage.getItem('theme') || 'auto',
  gaugeMode: localStorage.getItem('gaugeMode') || 'analog',
  split: false,
  wakeLock: null,
  alertEnabled: localStorage.getItem('alertEnabled') === 'true',
  alertLimit: loadNum('alertLimit', 110),
  flashOn: false,
  trips: JSON.parse(localStorage.getItem('trips') || '[]'),
  playlist: [],
  currentTrackIdx: -1,
  customApps: JSON.parse(localStorage.getItem('customApps') || '[]'),
};

function loadNum(key, fallback) {
  const v = parseFloat(localStorage.getItem(key));
  return Number.isFinite(v) ? v : fallback;
}
function saveState() {
  localStorage.setItem('totalOdometerKm', state.totalOdometerKm.toFixed(3));
  localStorage.setItem('trips', JSON.stringify(state.trips));
  localStorage.setItem('customApps', JSON.stringify(state.customApps));
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), 2500);
}
function getCSSVar(name) {
  return getComputedStyle(appEl).getPropertyValue(name).trim();
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtHHMMSS(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
/* ===================== TEMA (auto / día / noche) ===================== */
function applyTheme() {
  appEl.classList.remove('theme-auto', 'theme-day', 'theme-night');
  appEl.classList.add(`theme-${state.theme}`);
  const isDark = state.theme === 'night' ||
    (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark ? '#0A0A0B' : '#F2F2F3');
  $('themeIconSun').classList.toggle('hidden', state.theme !== 'day');
  $('themeIconMoon').classList.toggle('hidden', state.theme !== 'night');
  $('themeIconAuto').classList.toggle('hidden', state.theme !== 'auto');
  updateTileLayer(isDark);
  drawGauge(); // los colores del canvas dependen del tema
}
$('btnTheme').addEventListener('click', () => {
  const order = ['auto', 'day', 'night'];
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  localStorage.setItem('theme', state.theme);
  applyTheme();
  toast(state.theme === 'auto' ? 'Tema: automático' : state.theme === 'day' ? 'Tema: día' : 'Tema: noche');
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});

/* ===================== WAKE LOCK ===================== */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* silencioso: algunos navegadores lo niegan sin gesto del usuario */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (state.wakeLock === null || state.wakeLock?.released)) {
    requestWakeLock();
  }
});
document.addEventListener('pointerdown', function firstTouch() {
  requestWakeLock();
  document.removeEventListener('pointerdown', firstTouch);
}, { once: true });

/* ===================== VELOCÍMETRO ANALÓGICO (canvas) ===================== */
const canvas = $('analogGauge');
const ctx = canvas.getContext('2d');
const GAUGE_MAX = 220;
const START_ANGLE = 135 * Math.PI / 180;
const END_ANGLE = 405 * Math.PI / 180;

function speedToAngle(speed) {
  const t = Math.min(speed, GAUGE_MAX) / GAUGE_MAX;
  return START_ANGLE + t * (END_ANGLE - START_ANGLE);
}

function drawGauge() {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 340;
  if (canvas.width !== size * dpr) {
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2, r = size / 2 - size * 0.06;
  const face = getCSSVar('--gauge-face') || '#0E141B';
  const tick = getCSSVar('--gauge-tick') || '#3A4653';
  const text = getCSSVar('--text') || '#EAF2EC';
  const accent = getCSSVar('--accent') || '#39FF6A';
  const amber = getCSSVar('--amber') || '#FFC533';
  const red = getCSSVar('--red') || '#FF3B3B';

  // Cara
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = tick;
  ctx.stroke();

  const limit = state.alertLimit;
  const warnStart = limit;
  const dangerStart = limit * 1.1;

  // Ticks (los dos últimos mayores se resaltan en verde, como acento fijo)
  ctx.fillStyle = text;
  ctx.font = `${Math.round(size * 0.045)}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 0; s <= GAUGE_MAX; s += 20) {
    const a = speedToAngle(s);
    const major = s % 40 === 0;
    const rOuter = r * 0.92;
    const rInner = r * (major ? 0.80 : 0.86);
    const highlight = major && s >= GAUGE_MAX - 60;
    ctx.strokeStyle = highlight ? accent : tick;
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + rInner * Math.cos(a), cy + rInner * Math.sin(a));
    ctx.lineTo(cx + rOuter * Math.cos(a), cy + rOuter * Math.sin(a));
    ctx.stroke();
    if (major) {
      const rLabel = r * 0.68;
      ctx.fillText(String(s), cx + rLabel * Math.cos(a), cy + rLabel * Math.sin(a));
    }
  }

  // Aguja
  const speed = state.speedKmh;
  const danger = state.alertEnabled && speed >= dangerStart;
  const warn = state.alertEnabled && speed >= warnStart && !danger;
  let needleColor = accent;
  if (warn) needleColor = amber;
  if (danger) needleColor = state.flashOn ? red : '#000000';

  const angle = speedToAngle(speed);
  const needleLen = r * 0.78;
  ctx.strokeStyle = needleColor;
  ctx.lineWidth = size * 0.018;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + needleLen * Math.cos(angle), cy + needleLen * Math.sin(angle));
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.035, 0, Math.PI * 2);
  ctx.fillStyle = needleColor;
  ctx.fill();

  // Lectura digital al centro
  ctx.fillStyle = text;
  ctx.font = `700 ${Math.round(size * 0.13)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(String(Math.round(speed)), cx, cy + r * 0.36);
  ctx.font = `${Math.round(size * 0.032)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = getCSSVar('--muted') || '#8E9196';
  ctx.fillText('k m / h', cx, cy + r * 0.48);
}

/* ===================== MODO ANALÓGICO / DIGITAL ===================== */
function applyGaugeMode() {
  const analog = state.gaugeMode === 'analog';
  $('analogGauge').classList.toggle('hidden', !analog);
  $('digitalGauge').classList.toggle('hidden', analog);
  $('gaugeModeLabel').textContent = analog ? 'Analógica' : 'Digital';
  drawGauge();
}
$('btnGaugeMode').addEventListener('click', () => {
  state.gaugeMode = state.gaugeMode === 'analog' ? 'digital' : 'analog';
  localStorage.setItem('gaugeMode', state.gaugeMode);
  applyGaugeMode();
});

/* ===================== BUCLE DE RENDER (independiente del GPS) ===================== */
let flashTimer = 0;
setInterval(() => {
  flashTimer++;
  state.flashOn = flashTimer % 2 === 0;

  const limit = state.alertLimit;
  const danger = state.alertEnabled && state.speedKmh >= limit * 1.1;
  const warn = state.alertEnabled && state.speedKmh >= limit && !danger;

  if (state.gaugeMode === 'analog') {
    drawGauge();
  } else {
    const el = $('digitalSpeedVal');
    el.textContent = Math.round(state.speedKmh);
    const wrap = $('digitalGauge');
    wrap.classList.toggle('warn', warn);
    wrap.classList.toggle('danger', danger && state.flashOn);
  }
  if (danger) beep();
}, 400);

/* ===================== BEEP (Web Audio, sin archivos) ===================== */
let audioCtx = null;
let lastBeep = 0;
function beep() {
  const now = Date.now();
  if (now - lastBeep < 1400) return;
  lastBeep = now;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.30;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
}

/* ===================== GPS ===================== */
function onPosition(pos) {
  const { latitude: lat, longitude: lon, speed, accuracy } = pos.coords;
  const now = pos.timestamp || Date.now();

  const gpsEl = $('gpsStatus');
  gpsEl.textContent = (typeof accuracy === 'number')
    ? `GPS: Activo · ±${Math.round(accuracy)}m`
    : 'GPS: Activo';

  let kmh = 0;
  if (typeof speed === 'number' && speed !== null && !Number.isNaN(speed)) {
    kmh = Math.max(0, speed * 3.6);
  } else if (state.lastFix) {
    const dt = (now - state.lastFix.t) / 1000;
    if (dt > 0) {
      const dKm = haversineKm(state.lastFix.lat, state.lastFix.lon, lat, lon);
      kmh = Math.max(0, (dKm / dt) * 3600);
    }
  }
  // Descarta saltos imposibles (ruido de GPS)
  if (kmh > 300) kmh = state.speedKmh;
  state.speedKmh = kmh;

  if (state.tracking && state.lastFix) {
    const dKm = haversineKm(state.lastFix.lat, state.lastFix.lon, lat, lon);
    if (dKm < 2) { // descarta saltos irreales
      state.distanceKm += dKm;
      state.totalOdometerKm += dKm;
    }
  }
  state.lastFix = { lat, lon, t: now };
  if (kmh > state.maxSpeed) state.maxSpeed = kmh;

  updateMaps(lat, lon);
  fetchWeatherIfNeeded(lat, lon);
  renderTripMetrics();
}
function onPositionError(err) {
  $('gpsStatus').textContent = 'GPS: Inactivo';
  if (err.code === err.PERMISSION_DENIED) {
    toast('Activa el permiso de ubicación para usar el GPS');
  }
}
function startGPSWatch() {
  if (state.watchId !== null) return;
  // Dentro del APK (Capacitor) se usa el plugin nativo @capacitor/geolocation,
  // que gestiona el permiso de Android automáticamente. En el navegador normal
  // (para probar antes de compilar) se usa la API web de geolocalización.
  const capGeo = window.Capacitor?.Plugins?.Geolocation;
  if (capGeo) {
    capGeo.requestPermissions().catch(() => {});
    capGeo.watchPosition({ enableHighAccuracy: true, timeout: 8000 }, (pos, err) => {
      if (err) { onPositionError(err); return; }
      if (pos) onPosition(pos);
    }).then(id => { state.watchId = id; });
  } else if ('geolocation' in navigator) {
    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 8000,
    });
  } else {
    toast('Este dispositivo no tiene GPS disponible');
  }
}
startGPSWatch(); // el GPS y el velocímetro siempre están activos

/* ===================== VIAJE (botón COMENZAR / FINALIZAR) ===================== */
function renderTripMetrics() {
  const [intPart, decPart] = state.totalOdometerKm.toFixed(1).split('.');
  $('odometerBig').textContent = intPart.padStart(6, '0');
  $('odometerDec').textContent = decPart;
  $('statDistance').textContent = state.distanceKm.toFixed(2);
  $('statMax').textContent = Math.round(state.maxSpeed);
  const hrs = state.elapsedSec / 3600;
  $('statAvg').textContent = hrs > 0 ? Math.round(state.distanceKm / hrs) : 0;
}
function resetTrip() {
  state.distanceKm = 0;
  state.maxSpeed = 0;
  if (state.tracking) state.startTime = Date.now();
  state.elapsedSec = 0;
  $('timerVal').textContent = '00:00:00';
  renderTripMetrics();
  toast('Viaje reiniciado');
}
$('btnReset').addEventListener('click', resetTrip);
function startTrip() {
  state.tracking = true;
  state.distanceKm = 0;
  state.maxSpeed = 0;
  state.startTime = Date.now();
  state.elapsedSec = 0;
  requestWakeLock();
  state.timerInterval = setInterval(() => {
    state.elapsedSec = (Date.now() - state.startTime) / 1000;
    $('timerVal').textContent = fmtHHMMSS(state.elapsedSec);
    renderTripMetrics();
  }, 1000);
  $('btnStart').classList.add('active');
  $('startLabel').textContent = 'FINALIZAR';
}
function stopTrip() {
  state.tracking = false;
  clearInterval(state.timerInterval);
  if (state.distanceKm > 0.05) {
    state.trips.unshift({
      id: Date.now(),
      dateISO: new Date().toISOString(),
      distanceKm: state.distanceKm,
      maxSpeed: state.maxSpeed,
      durationSec: state.elapsedSec,
    });
    saveState();
    toast('Viaje guardado en el historial');
  }
  $('btnStart').classList.remove('active');
  $('startLabel').textContent = 'COMENZAR';
  state.distanceKm = 0;
  state.maxSpeed = 0;
  state.elapsedSec = 0;
  $('timerVal').textContent = '00:00:00';
  renderTripMetrics();
}
$('btnStart').addEventListener('click', () => (state.tracking ? stopTrip() : startTrip()));

/* ===================== RELOJ ===================== */
function updateClock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}
updateClock();
setInterval(updateClock, 15000);

/* ===================== CLIMA (Open-Meteo, sin API key) ===================== */
let lastWeatherFetch = 0;
function fetchWeatherIfNeeded(lat, lon) {
  const now = Date.now();
  if (now - lastWeatherFetch < 15 * 60 * 1000) return;
  lastWeatherFetch = now;
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`)
    .then(r => r.json())
    .then(data => {
      const t = data?.current?.temperature_2m;
      if (typeof t === 'number') $('temp').textContent = `${Math.round(t)}°C`;
    })
    .catch(() => {});
}

/* ===================== MAPA (Leaflet, CARTO / ESRI, sin API key) ===================== */
let mapSplitInst = null, mapFullInst = null, markerSplit = null, markerFull = null;
let tileSplit = null, tileFull = null;

function tileUrl(dark) {
  return dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}
function makeMap(containerId) {
  const map = L.map(containerId, { zoomControl: false, attributionControl: false });
  map.setView([0, 0], 15);
  const tile = L.tileLayer(tileUrl(false), { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
  const marker = L.circleMarker([0, 0], { radius: 8, color: '#39FF6A', fillColor: '#39FF6A', fillOpacity: 1, weight: 2 }).addTo(map);
  return { map, tile, marker };
}
function updateTileLayer(dark) {
  [tileSplit, tileFull].forEach(t => { if (t) t.setUrl(tileUrl(dark)); });
  [mapSplitInst, mapFullInst].forEach(m => { if (m) m.getContainer().style.filter = dark ? 'brightness(0.92)' : 'none'; });
}
function updateMaps(lat, lon) {
  if (mapSplitInst) { markerSplit.setLatLng([lat, lon]); mapSplitInst.panTo([lat, lon], { animate: true }); }
  if (mapFullInst) { markerFull.setLatLng([lat, lon]); mapFullInst.panTo([lat, lon], { animate: true }); }
}
function ensureSplitMap() {
  if (mapSplitInst) return;
  const built = makeMap('map');
  mapSplitInst = built.map; tileSplit = built.tile; markerSplit = built.marker;
  const dark = appEl.classList.contains('theme-night') ||
    (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  updateTileLayer(dark);
  if (state.lastFix) updateMaps(state.lastFix.lat, state.lastFix.lon);
}
function ensureFullMap() {
  if (mapFullInst) return;
  const built = makeMap('mapFull');
  mapFullInst = built.map; tileFull = built.tile; markerFull = built.marker;
  const dark = appEl.classList.contains('theme-night') ||
    (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  updateTileLayer(dark);
  if (state.lastFix) updateMaps(state.lastFix.lat, state.lastFix.lon);
}

/* ---- Mapa en vivo en línea (antes "vista dividida"): sección con scroll, no escalado ---- */
function setSplitState(on) {
  state.split = on;
  $('btnSplit').classList.toggle('active', on);
  $('mapPane').classList.toggle('hidden', !on);
  if (on) {
    ensureSplitMap();
    setTimeout(() => {
      mapSplitInst && mapSplitInst.invalidateSize();
      $('mapPane').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }
}
$('btnSplit').addEventListener('click', () => setSplitState(!state.split));
$('btnCloseMapPane').addEventListener('click', () => setSplitState(false));

/* ---- Mapa en overlay completo ---- */
$('btnMap').addEventListener('click', () => {
  openOverlay('panelMap');
  ensureFullMap();
  setTimeout(() => mapFullInst && mapFullInst.invalidateSize(), 260);
});

/* ===================== OVERLAYS genéricos ===================== */
function openOverlay(id) { $(id).classList.remove('hidden'); }
function closeOverlay(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
});

/* ===================== MENÚ LATERAL ===================== */
$('btnMenu').addEventListener('click', () => openOverlay('drawer'));
$('drawerHistory').addEventListener('click', () => {
  closeOverlay('drawer');
  openOverlay('panelHistory');
  renderTripList();
});
$('drawerResetOdo').addEventListener('click', () => {
  closeOverlay('drawer');
  state.totalOdometerKm = 0;
  saveState();
  renderTripMetrics();
  toast('Odómetro total reiniciado');
});
$('drawerAbout').addEventListener('click', () => {
  closeOverlay('drawer');
  toast('VelociGPS — velocímetro GPS sin anuncios');
});

/* ===================== HISTORIAL ===================== */
$('btnHistory').addEventListener('click', () => { openOverlay('panelHistory'); renderTripList(); });
function renderTripList() {
  const filterVal = $('historyDateFilter').value;
  const list = $('tripList');
  list.innerHTML = '';
  const filtered = state.trips.filter(t => !filterVal || t.dateISO.slice(0, 10) === filterVal);
  $('tripEmpty').classList.toggle('hidden', filtered.length > 0);
  filtered.forEach(t => {
    const li = document.createElement('li');
    li.className = 'trip-item';
    const d = new Date(t.dateISO);
    li.innerHTML = `
      <div class="trip-meta">
        <span class="trip-date">${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="trip-stats mono">${t.distanceKm.toFixed(1)} km · máx ${Math.round(t.maxSpeed)} km/h · ${fmtHHMMSS(t.durationSec)}</span>
      </div>
      <button class="trip-delete" aria-label="Eliminar viaje">&times;</button>`;
    li.querySelector('.trip-delete').addEventListener('click', () => deleteTrip(t.id));
    list.appendChild(li);
  });
}
function deleteTrip(id) {
  const idx = state.trips.findIndex(t => t.id === id);
  if (idx === -1) return;
  const removed = state.trips.splice(idx, 1)[0];
  saveState();
  renderTripList();
  toast('Viaje eliminado');
}
$('historyDateFilter').addEventListener('change', renderTripList);
$('btnClearFilter').addEventListener('click', () => { $('historyDateFilter').value = ''; renderTripList(); });

/* ===================== ALERTA DE VELOCIDAD ===================== */
$('btnAlert').addEventListener('click', () => {
  $('alertEnabled').checked = state.alertEnabled;
  $('alertLimit').value = state.alertLimit;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.limit) === state.alertLimit));
  openOverlay('panelAlert');
});
$('alertEnabled').addEventListener('change', (e) => {
  state.alertEnabled = e.target.checked;
  localStorage.setItem('alertEnabled', state.alertEnabled);
});
$('alertLimit').addEventListener('input', (e) => {
  state.alertLimit = Number(e.target.value) || 110;
  localStorage.setItem('alertLimit', state.alertLimit);
});
document.querySelectorAll('.preset-btn').forEach(b => {
  b.addEventListener('click', () => {
    state.alertLimit = Number(b.dataset.limit);
    $('alertLimit').value = state.alertLimit;
    localStorage.setItem('alertLimit', state.alertLimit);
    document.querySelectorAll('.preset-btn').forEach(x => x.classList.toggle('active', x === b));
  });
});

/* ===================== WAZE ===================== */
$('btnWaze').addEventListener('click', () => {
  if (!state.lastFix) { toast('Esperando señal de GPS…'); return; }
  const { lat, lon } = state.lastFix;
  window.open(`https://www.waze.com/ul?ll=${lat}%2C${lon}&navigate=yes&zoom=17`, '_blank');
});

/* ===================== MÚSICA ===================== */
$('btnMusic').addEventListener('click', () => openOverlay('panelMusic'));
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('tabFiles').classList.toggle('hidden', btn.dataset.tab !== 'files');
    $('tabStreaming').classList.toggle('hidden', btn.dataset.tab !== 'streaming');
  });
});
$('btnAddFiles').addEventListener('click', () => $('filePicker').click());
$('filePicker').addEventListener('change', (e) => {
  Array.from(e.target.files).forEach(f => state.playlist.push({ name: f.name, url: URL.createObjectURL(f) }));
  renderPlaylist();
});
function renderPlaylist() {
  const ul = $('playlist');
  ul.innerHTML = '';
  state.playlist.forEach((track, i) => {
    const li = document.createElement('li');
    li.textContent = track.name;
    if (i === state.currentTrackIdx) li.classList.add('playing');
    li.addEventListener('click', () => playTrack(i));
    ul.appendChild(li);
  });
}
const audioEl = $('audioEl');
function playTrack(i) {
  state.currentTrackIdx = i;
  const track = state.playlist[i];
  audioEl.src = track.url;
  audioEl.play();
  $('playerBar').classList.remove('hidden');
  $('nowPlaying').textContent = track.name;
  $('iconPlay').innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
  renderPlaylist();
}
$('btnPlayPause').addEventListener('click', () => {
  if (!audioEl.src) return;
  if (audioEl.paused) { audioEl.play(); $('iconPlay').innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'; }
  else { audioEl.pause(); $('iconPlay').innerHTML = '<path d="M8 5v14l11-7z"/>'; }
});
audioEl.addEventListener('ended', () => {
  if (state.currentTrackIdx < state.playlist.length - 1) playTrack(state.currentTrackIdx + 1);
});
$('volumeSlider').addEventListener('input', (e) => { audioEl.volume = Number(e.target.value); });

const STREAMING_PRESETS = [
  { name: 'Spotify', url: 'https://open.spotify.com' },
  { name: 'YouTube Music', url: 'https://music.youtube.com' },
  { name: 'Apple Music', url: 'https://music.apple.com' },
  { name: 'Deezer', url: 'https://www.deezer.com' },
  { name: 'Amazon Music', url: 'https://music.amazon.com' },
  { name: 'SoundCloud', url: 'https://soundcloud.com' },
];
function renderStreamingPresets() {
  const grid = $('streamingPresets');
  grid.innerHTML = '';
  STREAMING_PRESETS.forEach(app => {
    const div = document.createElement('button');
    div.className = 'streaming-app';
    div.textContent = app.name;
    div.addEventListener('click', () => window.open(app.url, '_blank'));
    grid.appendChild(div);
  });
}
renderStreamingPresets();
function renderCustomApps() {
  const ul = $('customApps');
  ul.innerHTML = '';
  state.customApps.forEach((app, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${app.name}</span>`;
    const openBtn = document.createElement('button');
    openBtn.className = 'text-btn';
    openBtn.textContent = 'Abrir';
    openBtn.addEventListener('click', () => window.open(app.url, '_blank'));
    li.appendChild(openBtn);
    ul.appendChild(li);
  });
}
$('btnAddCustomApp').addEventListener('click', () => {
  const name = prompt('Nombre de la app (ej. YouTube Music ReVanced):');
  if (!name) return;
  const url = prompt('Enlace https:// o intent:// de la app:');
  if (!url) return;
  state.customApps.push({ name, url });
  saveState();
  renderCustomApps();
});
renderCustomApps();

/* ===================== INICIO ===================== */
applyTheme();
applyGaugeMode();
renderTripMetrics();
