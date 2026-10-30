/**
 * ระบบข้อมูลแหล่งแม่น้ำกก อ.แม่อาย
 * ฐานข้อมูลแหล่งน้ำ 147 บ่อ (สสอ.แม่อาย) และระบบคัดกรองสารหนู (Env-As-01 รวมรายชื่อซ้ำ 243 ราย / เก็บปัสสาวะ รายชื่อขั้น 2 / คัดกรอง 2Q)
 * พื้นที่ ต.ท่าตอน และ ต.แม่นาวาง อ.แม่อาย จ.เชียงใหม่
 */

// ลิงก์ Google Apps Script Web App URL เริ่มต้น (สามารถกดปุ่มฝังลิงก์ลงไฟล์ app.js ถาวรได้จากหน้าตั้งค่า)
const DEFAULT_GAS_URL = '';

const STORAGE_KEY_WELLS = 'ARSENIC_GIS_WELLS_147_V5_SOURCE69_V1';
const STORAGE_KEY_RESPONDENTS = 'ARSENIC_GIS_RESPONDENTS_TN283_V7_SOURCE69_V1';
const STORAGE_KEY_ENV_AS02 = 'ARSENIC_GIS_ENV_AS02_TN283_V7_SOURCE69_V1';
const STORAGE_KEY_WATER_LABS = 'ARSENIC_GIS_WATER_LABS_V1_SOURCE69_V1';
const STORAGE_KEY_KNOWLEDGE_DOCS = 'ARSENIC_GIS_KNOWLEDGE_DOCS_V1';
const STORAGE_KEY_GAS_URL = 'ARSENIC_GIS_GAS_URL_V1';
const STORAGE_KEY_GAS_URL_BACKUP = 'MAEAI_KOK_GAS_URL_PERMANENT';
const STORAGE_KEY_USER = 'ARSENIC_GIS_USER_V1';

let state = {
  wells: [],
  respondents: [],
  envAs02: [],
  waterLabs: [],
  knowledgeDocs: [],
  currentUser: null,
  gasUrl: '',
  gasUnlocked: false,
  map: null,
  baseLayers: {},
  weatherRadarLayer: null,
  markersLayer: null,
  linksLayer: null,
  pickingMode: null,
  currentWellAttachments: []
};

// ==================== UI HELPERS FOR SCROLLING, "OTHER" DROPDOWNS & CHECKBOXES ====================
function scrollToModalSection(modalBodyId, sectionId) {
  const bodyEl = document.getElementById(modalBodyId);
  const secEl = document.getElementById(sectionId);
  if (bodyEl && secEl) {
    const topPos = secEl.offsetTop - bodyEl.offsetTop - 10;
    bodyEl.scrollTo({ top: Math.max(0, topPos), behavior: 'smooth' });
  }
}

function toggleOtherInput(selectEl, wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  if (selectEl.value === 'OTHER') {
    wrap.style.display = 'block';
    const inp = wrap.querySelector('input');
    if (inp) inp.focus();
  } else {
    wrap.style.display = 'none';
  }
}

function getSelectOrOther(selectId, otherInputId) {
  const sel = document.getElementById(selectId);
  const oth = document.getElementById(otherInputId);
  if (!sel) return '';
  if (sel.value === 'OTHER') {
    return (oth && oth.value.trim()) ? oth.value.trim() : 'อื่นๆ';
  }
  return sel.value;
}

function setSelectOrOther(selectId, otherWrapId, otherInputId, value, defaultVal = '') {
  const sel = document.getElementById(selectId);
  const wrap = document.getElementById(otherWrapId);
  const oth = document.getElementById(otherInputId);
  if (!sel) return;
  const valStr = String(value || defaultVal).trim();
  const hasOption = Array.from(sel.options).some(opt => opt.value === valStr && opt.value !== 'OTHER');
  if (hasOption) {
    sel.value = valStr;
    if (wrap) wrap.style.display = 'none';
    if (oth) oth.value = '';
  } else if (valStr !== '') {
    const hasOtherOpt = Array.from(sel.options).some(opt => opt.value === 'OTHER');
    if (hasOtherOpt) {
      sel.value = 'OTHER';
      if (wrap) wrap.style.display = 'block';
      if (oth) oth.value = valStr;
    } else {
      sel.selectedIndex = 0;
    }
  } else {
    sel.selectedIndex = 0;
    if (wrap) wrap.style.display = 'none';
    if (oth) oth.value = '';
  }
}

function syncAs01Checkboxes(chkClass, targetInputId, flagSelectId = null) {
  const checkedVals = Array.from(document.querySelectorAll('.' + chkClass + ':checked')).map(c => c.value);
  const targetInput = document.getElementById(targetInputId);
  if (targetInput) {
    targetInput.value = checkedVals.join(', ');
  }
  if (flagSelectId) {
    const flagSel = document.getElementById(flagSelectId);
    if (flagSel) {
      if (checkedVals.length > 0) {
        flagSel.value = flagSel.options[1] ? flagSel.options[1].value : 'ใช่';
      }
    }
  }
}

function populateCheckboxesFromString(chkClass, strVal) {
  const s = String(strVal || '');
  document.querySelectorAll('.' + chkClass).forEach(chk => {
    const cleanVal = chk.value.replace(/^\d+[\)\.]\s*/, '').trim();
    chk.checked = s.includes(chk.value) || (cleanVal.length > 2 && s.includes(cleanVal));
  });
}

// ค่าน้ำหนักแบบฟอร์ม Env-As-01 ส่วนที่ 4 (11 ข้อ คะแนนเต็ม 30.5)
const ENV_WEIGHTS = {
  q1: 5.0,
  q2: 5.0,
  q3: 5.0,
  q4: 1.5,
  q5: 1.5,
  q6: 1.0,
  q7: 1.0,
  q8: 4.0,
  q9: 4.0,
  q10: 1.0,
  q11: 1.5
};

// ==================== UTM ZONE 47N <-> WGS84 LAT/LNG CONVERTER ====================
function utm47NToLatLng(easting, northing) {
  const a = 6378137.0;
  const f = 1.0 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = 99.0 * Math.PI / 180.0;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1.0 - e2);
  const e1 = (1.0 - Math.sqrt(1.0 - e2)) / (1.0 + Math.sqrt(1.0 - e2));

  const x = easting - 500000.0;
  const y = northing;

  const M = y / k0;
  const mu = M / (a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0));

  const phi1 = mu + (3.0 * e1 / 2.0 - 27.0 * Math.pow(e1, 3) / 32.0) * Math.sin(2.0 * mu)
                  + (21.0 * e1 * e1 / 16.0 - 55.0 * Math.pow(e1, 4) / 32.0) * Math.sin(4.0 * mu)
                  + (151.0 * Math.pow(e1, 3) / 96.0) * Math.sin(6.0 * mu)
                  + (1097.0 * Math.pow(e1, 4) / 512.0) * Math.sin(8.0 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1.0 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = a * (1.0 - e2) / Math.pow(1.0 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const latRad = phi1 - (N1 * tanPhi1 / R1) * (D * D / 2.0
                - (5.0 + 3.0 * T1 + 10.0 * C1 - 4.0 * C1 * C1 - 9.0 * ep2) * Math.pow(D, 4) / 24.0
                + (61.0 + 90.0 * T1 + 298.0 * C1 + 45.0 * T1 * T1 - 252.0 * ep2 - 3.0 * C1 * C1) * Math.pow(D, 6) / 720.0);

  const lonRad = lon0 + (D - (1.0 + 2.0 * T1 + C1) * Math.pow(D, 3) / 6.0
                + (5.0 - 2.0 * C1 + 28.0 * T1 - 3.0 * C1 * C1 + 8.0 * ep2 + 24.0 * T1 * T1) * Math.pow(D, 5) / 120.0) / cosPhi1;

  return {
    lat: Number((latRad * 180.0 / Math.PI).toFixed(6)),
    lng: Number((lonRad * 180.0 / Math.PI).toFixed(6))
  };
}

function convertModalUtmToLatLng() {
  const utmE = parseFloat(document.getElementById('well-utm-e').value);
  const utmN = parseFloat(document.getElementById('well-utm-n').value);
  if (!isNaN(utmE) && !isNaN(utmN) && utmE > 100000 && utmN > 1000000) {
    const res = utm47NToLatLng(utmE, utmN);
    document.getElementById('well-lat').value = res.lat;
    document.getElementById('well-lng').value = res.lng;
  }
}

// ==================== INITIALIZATION & DATA SANITIZATION ====================
window.addEventListener('DOMContentLoaded', () => {
  loadLocalData();
  checkSavedSession();
});

function inferHealthCenterByTambonMoo(tambon, moo) {
  const t = String(tambon || 'ท่าตอน').trim();
  const m = Number(moo) || 0;
  if (t === 'แม่นาวาง') return 'รพ.สต.บ้านแม่เมืองน้อย';
  if ([4, 6, 7, 8].includes(m)) return 'รพ.สต.บ้านท่ามะแกง';
  if ([5, 11, 12, 13].includes(m)) return 'รพ.สต.บ้านเมืองงาม';
  return 'รพ.สต.บ้านท่าตอน';
}

function extractNumericYears(val, fallbackVal) {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const m = String(val).match(/(\d+(\.\d+)?)/);
    if (m) return Number(m[1]);
  }
  if (fallbackVal !== undefined && fallbackVal !== null && String(fallbackVal).trim() !== '') {
    const m2 = String(fallbackVal).match(/(\d+(\.\d+)?)/);
    if (m2) return Number(m2[1]);
  }
  return '';
}

function getCookieGasUrl() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)MAEAI_KOK_GAS_URL=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (e) {
    return '';
  }
}

function saveGasUrlToIndexedDB(url) {
  try {
    if (!window.indexedDB) return;
    const req = indexedDB.open('MaeAiKokRiverConfigDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(url, 'gasUrl');
    };
  } catch (e) {}
}

function restoreGasUrlFromIndexedDB() {
  try {
    if (!window.indexedDB) return;
    const req = indexedDB.open('MaeAiKokRiverConfigDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readonly');
      const getReq = tx.objectStore('settings').get('gasUrl');
      getReq.onsuccess = () => {
        const idbUrl = (getReq.result || '').trim();
        if (idbUrl && !state.gasUrl) {
          applyRestoredGasUrl(idbUrl, false);
        }
      };
    };
  } catch (e) {}
}

function persistGasUrlEverywhere(url) {
  const cleanUrl = (url || '').trim();
  state.gasUrl = cleanUrl;
  try {
    localStorage.setItem(STORAGE_KEY_GAS_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEY_GAS_URL_BACKUP, cleanUrl);
  } catch (e) {}
  try {
    document.cookie = `MAEAI_KOK_GAS_URL=${encodeURIComponent(cleanUrl)}; max-age=315360000; path=/; SameSite=Lax`;
  } catch (e) {}
  saveGasUrlToIndexedDB(cleanUrl);
}

function applyRestoredGasUrl(url, autoPull = false) {
  const cleanUrl = (url || '').trim();
  if (!cleanUrl) return;
  state.gasUrl = cleanUrl;
  try {
    localStorage.setItem(STORAGE_KEY_GAS_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEY_GAS_URL_BACKUP, cleanUrl);
  } catch (e) {}

  const gasInput = document.getElementById('gas-url-input');
  if (gasInput) {
    gasInput.value = cleanUrl;
    // ล็อกช่องอัตโนมัติเมื่อมีลิงก์ที่บันทึกไว้แล้ว เพื่อไม่ให้เผลอลบ
    state.gasUnlocked = false;
    gasInput.readOnly = true;
    gasInput.style.background = '#e2e8f0';
    gasInput.style.cursor = 'not-allowed';
    const unlockBtn = document.getElementById('btn-unlock-gas');
    if (unlockBtn) unlockBtn.innerHTML = `<i class="fa-solid fa-key"></i> ปลดล็อกแก้ไขลิงก์ (เฉพาะ Admin)`;
  }
  updateSyncBadge(true);
  logCloudMessage(`เชื่อมต่อลิงก์ Google Sheets ที่บันทึกไว้เรียบร้อยแล้ว: ${cleanUrl}`);
  if (false && autoPull) {
    pullFromGoogleSheets(true);
  }
}

function checkSavedSession() {
  try {
    const savedUser = sessionStorage.getItem(STORAGE_KEY_USER);
    if (savedUser) {
      state.currentUser = JSON.parse(savedUser);
    } else {
      state.currentUser = {
        username: 'admin',
        displayName: 'ผู้ดูแลระบบ (Admin สสอ.)',
        role: 'admin'
      };
      sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(state.currentUser));
    }
  } catch (e) {
    state.currentUser = {
      username: 'admin',
      displayName: 'ผู้ดูแลระบบ (Admin สสอ.)',
      role: 'admin'
    };
  }
  enterApplication();
}

function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errEl = document.getElementById('login-error');

  const validAccounts = {
    admin: { pass: '1234', displayName: 'ผู้ดูแลระบบ (Admin สสอ.)', role: 'admin' },
    staff: { pass: '1234', displayName: 'เจ้าหน้าที่ รพ.สต. (Staff)', role: 'staff' },
    maeai: { pass: '1234', displayName: 'สาธารณสุขอำเภอแม่อาย', role: 'admin' }
  };

  if (validAccounts[username] && validAccounts[username].pass === password) {
    errEl.style.display = 'none';
    state.currentUser = {
      username,
      displayName: validAccounts[username].displayName,
      role: validAccounts[username].role
    };
    try {
      sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(state.currentUser));
    } catch (err) {}
    enterApplication();
  } else {
    errEl.style.display = 'block';
  }
}

function handleLogout() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_USER);
  } catch (err) {}
  state.currentUser = null;
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function enterApplication() {
  const loginEl = document.getElementById('login-screen');
  const appEl = document.getElementById('app-container');
  if (loginEl) loginEl.style.display = 'none';
  if (appEl) appEl.style.display = 'block';
  if (state.currentUser && document.getElementById('current-user-display')) {
    document.getElementById('current-user-display').textContent = state.currentUser.displayName;
  }

  refreshAllViews();

  if (!state.map && typeof L !== 'undefined') {
    try {
      initMap();
      fetchLocalWeather();
    } catch (err) {
      console.warn('Map init warning:', err);
    }
  }
}

// ==================== NAVIGATION TABS ====================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  const btn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');

  if (tabId === 'tab-map' && state.map) {
    setTimeout(() => {
      state.map.invalidateSize();
    }, 150);
  }
}

function switchScreeningSubTab(mode) {
  const sub1 = document.getElementById('subview-as01');
  const sub2 = document.getElementById('subview-as02');
  const sub3 = document.getElementById('subview-2q');
  const btn1 = document.getElementById('btn-subtab-as01');
  const btn2 = document.getElementById('btn-subtab-as02');
  const btn3 = document.getElementById('btn-subtab-2q');

  if (sub1) sub1.style.display = mode === 'as01' ? 'block' : 'none';
  if (sub2) sub2.style.display = mode === 'as02' ? 'block' : 'none';
  if (sub3) sub3.style.display = mode === '2q' ? 'block' : 'none';

  if (btn1) btn1.className = mode === 'as01' ? 'btn btn-primary' : 'btn btn-outline';
  if (btn2) btn2.className = mode === 'as02' ? 'btn btn-primary' : 'btn btn-outline';
  if (btn3) btn3.className = mode === '2q' ? 'btn btn-primary' : 'btn btn-outline';
}

function filterRespondentsByBreakdown(tambon, hc, moo, tabMode) {
  switchTab('tab-respondents');
  const tabSel = document.getElementById('resp-filter-tab');
  const tamSel = document.getElementById('resp-filter-tambon');
  const hcSel = document.getElementById('resp-filter-hc');
  const searchInp = document.getElementById('resp-search');

  if (tabSel) tabSel.value = tabMode || 'ALL';
  if (tamSel) tamSel.value = tambon || 'ALL';
  if (hcSel) hcSel.value = hc || 'ALL';
  if (searchInp) searchInp.value = moo ? `ม.${moo}` : '';
  renderRespondentsTable();
}

function format2QBadge(status) {
  const s = String(status || 'ยังไม่คัดกรอง');
  if (s.includes('พบความเสี่ยง') || s.includes('Positive')) {
    return `<span class="badge-2q-pos"><i class="fa-solid fa-triangle-exclamation"></i> พบความเสี่ยง 2Q</span>`;
  }
  if (s.includes('ปกติ')) {
    return `<span class="badge-2q-neg"><i class="fa-solid fa-circle-check"></i> ปกติ (ไม่เสี่ยง)</span>`;
  }
  return `<span class="badge-2q-none"><i class="fa-regular fa-clock"></i> รอคัดกรอง 2Q</span>`;
}

function filterWellsFromDashboard(mode) {
  switchTab('tab-wells');
  const typeSel = document.getElementById('well-filter-type');
  const distSel = document.getElementById('well-filter-dist');
  if (mode === 'SAMPLE' && typeSel) {
    typeSel.value = 'SAMPLE_ONLY';
    distSel.value = 'ALL';
  } else if (mode === 'NEAR100' && distSel) {
    typeSel.value = 'ALL';
    distSel.value = 'ไม่เกิน 100 เมตร';
  }
  renderWellsTable();
}

function filterByRiskFromKpi(riskLevel) {
  switchTab('tab-respondents');
  const riskSelect = document.getElementById('resp-filter-risk');
  if (riskSelect) {
    riskSelect.value = riskLevel === 'ปานกลาง-มาก' ? 'ปานกลาง' : riskLevel;
    renderRespondentsTable();
  }
}

// ==================== MAP & WEATHER RADAR (LEAFLET) ====================
function initMap() {
  state.map = L.map('map-canvas', {
    center: [20.0560, 99.4150],
    zoom: 13
  });

  const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
  });
  const esriLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });
  const satelliteHybrid = L.layerGroup([esriSat, esriLabels]);

  const topoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });

  const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  state.baseLayers = {
    satellite: satelliteHybrid,
    terrain: topoLayer,
    street: streetLayer
  };

  state.baseLayers.satellite.addTo(state.map);

  state.linksLayer = L.layerGroup().addTo(state.map);
  state.markersLayer = L.layerGroup().addTo(state.map);

  state.map.on('click', (e) => {
    if (!state.pickingMode) return;
    const lat = Number(e.latlng.lat.toFixed(6));
    const lng = Number(e.latlng.lng.toFixed(6));

    if (state.pickingMode === 'well') {
      document.getElementById('well-lat').value = lat;
      document.getElementById('well-lng').value = lng;
      document.getElementById('well-modal').style.display = 'flex';
    } else if (state.pickingMode === 'respondent') {
      document.getElementById('resp-lat').value = lat;
      document.getElementById('resp-lng').value = lng;
      document.getElementById('respondent-modal').style.display = 'flex';
    }

    state.pickingMode = null;
    document.getElementById('map-Pick-hint').style.display = 'none';
  });
}

function setBaseMap(mode) {
  if (!state.map) return;
  Object.values(state.baseLayers).forEach(layer => state.map.removeLayer(layer));
  if (state.baseLayers[mode]) {
    state.baseLayers[mode].addTo(state.map);
  }

  document.getElementById('btn-layer-sat').classList.toggle('active', mode === 'satellite');
  document.getElementById('btn-layer-terrain').classList.toggle('active', mode === 'terrain');
  document.getElementById('btn-layer-street').classList.toggle('active', mode === 'street');
}

async function toggleWeatherRadar(enabled) {
  if (!state.map) return;
  if (!enabled) {
    if (state.weatherRadarLayer) {
      state.map.removeLayer(state.weatherRadarLayer);
      state.weatherRadarLayer = null;
    }
    return;
  }

  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
      const latest = data.radar.past[data.radar.past.length - 1];
      const tileUrl = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
      if (state.weatherRadarLayer) state.map.removeLayer(state.weatherRadarLayer);
      state.weatherRadarLayer = L.tileLayer(tileUrl, {
        opacity: 0.65,
        zIndex: 400,
        attribution: 'Weather Radar &copy; RainViewer'
      }).addTo(state.map);
    }
  } catch (err) {
    console.warn('RainViewer radar load warning:', err);
  }
}

async function fetchLocalWeather() {
  const boxBody = document.getElementById('weather-box-body');
  if (!boxBody) return;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=20.055&longitude=99.400&current=temperature_2m,relative_humidity_2m,precipitation,rain,wind_speed_10m&timezone=Asia%2FBangkok';
    const res = await fetch(url);
    const data = await res.json();
    const cur = data.current;
    boxBody.innerHTML = `
      <div class="weather-metrics">
        <div class="weather-metric-item">🌡️ อุณหภูมิ: <b>${cur.temperature_2m} °C</b></div>
        <div class="weather-metric-item">💧 ความชื้น: <b>${cur.relative_humidity_2m} %</b></div>
        <div class="weather-metric-item">🌧️ ปริมาณฝน: <b>${cur.precipitation} มม.</b></div>
        <div class="weather-metric-item">💨 ลม: <b>${cur.wind_speed_10m} กม./ชม.</b></div>
      </div>
      <div style="margin-top:6px; font-size:11px; color:#0369a1;">
        พิกัดอ้างอิง: ลุ่มน้ำกก ต.ท่าตอน - ต.แม่นาวาง อ.แม่อาย จ.เชียงใหม่
      </div>
    `;
  } catch (err) {
    boxBody.innerHTML = `<span>พร้อมแสดงชั้นข้อมูลภูมิประเทศและดาวเทียม (เชื่อมต่ออินเทอร์เน็ตเพื่อดูเรดาร์อากาศสด)</span>`;
  }
}

function renderMapMarkers() {
  if (!state.map || !state.markersLayer || !state.linksLayer) return;
  state.markersLayer.clearLayers();
  state.linksLayer.clearLayers();

  const showWells = document.getElementById('chk-show-wells').checked;
  const showPeople = document.getElementById('chk-show-people').checked;
  const showLinks = document.getElementById('chk-show-links').checked;

  const tambonFilter = document.getElementById('map-filter-tambon').value;
  const wellTypeFilter = document.getElementById('map-filter-welltype') ? document.getElementById('map-filter-welltype').value : 'ALL';
  const distFilter = document.getElementById('map-filter-dist') ? document.getElementById('map-filter-dist').value : 'ALL';
  const wellFilter = document.getElementById('map-filter-well').value;
  const riskFilter = document.getElementById('map-filter-risk').value;

  const wellMap = {};
  state.wells.forEach(w => { wellMap[w.well_id] = w; });

  if (showWells) {
    state.wells.forEach(well => {
      if (tambonFilter !== 'ALL' && well.tambon !== tambonFilter) return;
      if (wellFilter !== 'ALL' && well.well_id !== wellFilter) return;
      if (wellTypeFilter === 'SAMPLE_ONLY' && !well.sample_code) return;
      if (wellTypeFilter !== 'ALL' && wellTypeFilter !== 'SAMPLE_ONLY' && well.well_type !== wellTypeFilter) return;
      if (distFilter !== 'ALL' && well.distance_band !== distFilter) return;

      const lat = parseFloat(well.latitude);
      const lng = parseFloat(well.longitude);
      if (isNaN(lat) || isNaN(lng)) return;

      const linkedUsers = state.respondents.filter(r => r.well_id === well.well_id);
      let bg = '#0284c7';
      if (well.sample_code) {
        bg = '#e11d48';
      } else if (well.well_type === 'บ่อน้ำตื้น' || Number(well.distance_river_m) <= 100) {
        bg = '#eab308';
      }

      const wellIcon = L.divIcon({
        className: 'custom-well-icon',
        html: `<div style="background:${bg}; color:#fff; width:28px; height:28px; border-radius:6px; border:2px solid #fff; box-shadow:0 2px 5px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">
                 ${well.sample_code ? well.sample_code : '<i class="fa-solid fa-faucet-drip"></i>'}
               </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const userNamesHtml = linkedUsers.slice(0, 5).map(u => `<li>${u.full_name} (${u.code || '-'}) - คะแนน ${u.total_score}</li>`).join('');
      const moreCount = linkedUsers.length > 5 ? `<li>...และอีก ${linkedUsers.length - 5} ราย</li>` : '';
      const attCount = Array.isArray(well.attachments) ? well.attachments.length : 0;

      const popupHtml = `
        <div style="min-width:265px; font-family:'Sarabun',sans-serif;">
          <div style="font-weight:700; font-size:14px; color:#0f766e; margin-bottom:4px;">
            🚰 [${well.well_id}] ${well.well_name}
          </div>
          <div style="font-size:12.5px; line-height:1.45;">
            <b>ประเภท:</b> ${well.well_type} ${well.sample_code ? `<span style="background:#ffe4e6;color:#be123c;padding:1px 6px;border-radius:4px;font-weight:700;">ส่งตรวจ ${well.sample_code}</span>` : ''}<br/>
            <b>ที่ตั้ง:</b> บ้านเลขที่ ${well.house_no || '-'} หมู่ ${well.moo} ต.${well.tambon}<br/>
            <b>พิกัด UTM:</b> E ${well.utm_e || '-'}, N ${well.utm_n || '-'}<br/>
            <b>พิกัด Lat/Lng:</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br/>
            <b>ห่างแม่น้ำกก:</b> <b>${well.distance_river_m} เมตร</b> (${well.distance_band})<br/>
            <b>การใช้น้ำ:</b> ${well.usage_type || '-'} (${well.user_count || 1} คน)<br/>
            <b>รพ.สต.:</b> ${well.health_center || '-'}<br/>
            <b>รูปภาพ/เอกสารแนบ:</b> <b>${attCount} / 5 ไฟล์</b>
          </div>
          <hr style="margin:6px 0; border:none; border-top:1px solid #e2e8f0;"/>
          <div style="font-size:12px;">
            <b>👥 กลุ่มเป้าหมายที่เชื่อมโยงกับบ่อนี้ (${linkedUsers.length} ราย):</b>
            <ul style="padding-left:16px; margin:4px 0;">${userNamesHtml || '<li>ยังไม่มีรายชื่อผูกตรง</li>'}${moreCount}</ul>
          </div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <button onclick="openWellModal('${well.well_id}')" style="padding:4px 8px; background:#0f766e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">แก้ไข/เพิ่มรูป</button>
            <button onclick="openWellGalleryModal('${well.well_id}')" style="padding:4px 8px; background:#0369a1; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">📷 รูปภาพ (${attCount})</button>
            <button onclick="filterPeopleByWell('${well.well_id}')" style="padding:4px 8px; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">ดูผู้ใช้น้ำ</button>
          </div>
        </div>
      `;

      L.marker([lat, lng], { icon: wellIcon })
        .bindPopup(popupHtml)
        .addTo(state.markersLayer);
    });
  }

  const filteredPeople = state.respondents.filter(r => {
    if (tambonFilter !== 'ALL' && r.tambon !== tambonFilter) return false;
    if (wellFilter !== 'ALL' && r.well_id !== wellFilter) return false;
    if (riskFilter !== 'ALL' && r.risk_level !== riskFilter) return false;
    return true;
  });

  filteredPeople.forEach(person => {
    const lat = parseFloat(person.latitude);
    const lng = parseFloat(person.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const linkedWell = wellMap[person.well_id];

    if (showLinks && linkedWell) {
      const wLat = parseFloat(linkedWell.latitude);
      const wLng = parseFloat(linkedWell.longitude);
      if (!isNaN(wLat) && !isNaN(wLng)) {
        L.polyline([[lat, lng], [wLat, wLng]], {
          color: person.risk_level === 'มาก' ? '#ef4444' : (person.risk_level === 'ปานกลาง' ? '#f97316' : '#38bdf8'),
          weight: 1.5,
          dashArray: '4, 4',
          opacity: 0.7
        }).addTo(state.linksLayer);
      }
    }

    if (showPeople) {
      let fillColor = '#22c55e';
      if (person.risk_level === 'ปานกลาง') fillColor = '#f97316';
      if (person.risk_level === 'มาก') fillColor = '#dc2626';

      const marker = L.circleMarker([lat, lng], {
        radius: person.risk_level === 'มาก' ? 9 : 6.5,
        fillColor: fillColor,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.92
      });

      const popupHtml = `
        <div style="min-width:250px; font-family:'Sarabun',sans-serif;">
          <div style="font-weight:700; font-size:14px; color:#0f172a;">
            👤 ${person.full_name} <span style="color:#0284c7;">(${person.code || '-'})</span>
          </div>
          <div style="font-size:12.5px; margin-top:4px; line-height:1.45;">
            <b>แท็บข้อมูล:</b> ${person.is_urine_target ? '<span style="color:#15803d;font-weight:700;">รายชื่อเก็บปัสสาวะ (รายชื่อขั้น 2)</span>' : '<span style="color:#0369a1;font-weight:700;">การตอบกลับ (ขั้นแรก)</span>'}<br/>
            <b>อายุ/เพศ:</b> ${person.age || '-'} ปี (${person.gender})<br/>
            <b>ที่อยู่:</b> บ้านเลขที่ ${person.house_no || '-'} หมู่ ${person.moo} ต.${person.tambon}<br/>
            <b>รพ.สต.:</b> ${person.health_center || '-'}<br/>
            <b>ระยะเวลาที่สัมผัส:</b> <b>${person.exposure_years !== '' && person.exposure_years !== undefined ? person.exposure_years + ' ปี' : '-'}</b><br/>
            <b>ผลคัดกรอง 2Q:</b> ${format2QBadge(person.status_2q)}<br/>
            <b>แหล่งน้ำที่เชื่อมโยง:</b> <span style="color:#0f766e; font-weight:600;">[${person.well_id}] ${linkedWell ? linkedWell.well_name : ''}</span>
          </div>
          <div style="margin-top:6px; padding:6px 8px; background:#f1f5f9; border-radius:6px; font-size:12.5px;">
            คะแนนความเสี่ยง: <b>${person.total_score}</b> คะแนน &rarr; 
            <b style="color:${fillColor}">ระดับ${person.risk_level}</b>
          </div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <button onclick="openRespondentModal('${person.id}')" style="padding:4px 8px; background:#16a34a; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">
              แก้ไข Env-As-01
            </button>
            <button onclick="open2QModal('${person.id}')" style="padding:4px 8px; background:#7c3aed; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">
              🧠 คัดกรอง 2Q
            </button>
            <button onclick="openEnvAs02ForRespondent('${person.id}')" style="padding:4px 8px; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;">
              Env-As-02
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml).addTo(state.markersLayer);
    }
  });
}

function zoomToAllMarkers() {
  if (!state.map) return;
  const coords = [];
  state.wells.forEach(w => {
    if (w.latitude && w.longitude) coords.push([parseFloat(w.latitude), parseFloat(w.longitude)]);
  });
  if (coords.length > 0) {
    state.map.fitBounds(coords, { padding: [35, 35] });
  }
}

function locateUserOnMap() {
  if (!navigator.geolocation) {
    alert('เบราว์เซอร์ของคุณไม่รองรับการดึงพิกัด GPS');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.map.setView([latitude, longitude], 16);
      L.popup()
        .setLatLng([latitude, longitude])
        .setContent(`<b>📍 พิกัดปัจจุบันของคุณ</b><br/>Lat: ${latitude.toFixed(6)}<br/>Lng: ${longitude.toFixed(6)}`)
        .openOn(state.map);
    },
    () => alert('ไม่สามารถดึงพิกัด GPS ได้ กรุณาอนุญาตการเข้าถึงตำแหน่งที่ตั้งของเบราว์เซอร์')
  );
}

function pickLocationOnMap(targetType) {
  state.pickingMode = targetType;
  if (targetType === 'well') {
    document.getElementById('well-modal').style.display = 'none';
  } else {
    document.getElementById('respondent-modal').style.display = 'none';
  }
  switchTab('tab-map');
  document.getElementById('map-Pick-hint').style.display = 'inline-block';
}

// ==================== REFRESH ALL UI VIEWS & DASHBOARDS ====================
function refreshAllViews() {
  updateKpiCards();
  renderExecutiveDashboard();
  renderScreeningDashboardAndTables();
  populateWellDropdowns();
  renderWellsTable();
  renderWaterLabDashboardAndTable();
  renderRespondentsTable();
  renderKnowledgeDocs();
  renderPivotSummary();
  renderMapMarkers();
}

function renderDashboard() {
  renderExecutiveDashboard();
}

// ==================== SCREENING TAB (ENV-AS-01, ENV-AS-02 & 2Q DASHBOARD + CRUD) ====================
function recalcModalAs01_2Q() {
  const q1 = document.getElementById('resp-q2-1')?.value || 'ไม่ใช่';
  const q2 = document.getElementById('resp-q2-2')?.value || 'ไม่ใช่';
  const stEl = document.getElementById('resp-status-2q');
  if (!stEl) return;
  if (q1 === 'ใช่' || q2 === 'ใช่') {
    stEl.value = 'พบความเสี่ยง (Positive 2Q)';
  } else if (stEl.value === 'พบความเสี่ยง (Positive 2Q)') {
    stEl.value = 'ปกติ (ไม่พบความเสี่ยง)';
  }
}

function recalcModalAs02_2Q() {
  const q1 = document.getElementById('as02-q2-1')?.value || 'ไม่ใช่';
  const q2 = document.getElementById('as02-q2-2')?.value || 'ไม่ใช่';
  const stEl = document.getElementById('as02-status-2q');
  if (!stEl) return;
  if (q1 === 'ใช่' || q2 === 'ใช่') {
    stEl.value = 'พบความเสี่ยง (Positive 2Q)';
  } else if (stEl.value === 'พบความเสี่ยง (Positive 2Q)') {
    stEl.value = 'ปกติ (ไม่พบความเสี่ยง)';
  }
}

function open2QModal(respId = null) {
  const modal = document.getElementById('modal-2q');
  const sel = document.getElementById('q2-modal-resp-select');
  if (!modal || !sel) return;

  sel.innerHTML = `<option value="">-- เลือกรายชื่อผู้รับการคัดกรอง (จากทั้งหมด ${state.respondents.length} ราย) --</option>` +
    state.respondents.map(r =>
      `<option value="${r.id}">[${r.code}] ${r.full_name} (ม.${r.moo} ต.${r.tambon} - ${r.health_center}) [${r.status_2q || 'รอคัดกรอง'}]</option>`
    ).join('');

  document.getElementById('form-2q').reset();
  document.getElementById('q2-modal-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('q2-modal-assessor').value = state.currentUser ? state.currentUser.displayName : 'เจ้าหน้าที่สาธารณสุข อ.แม่อาย';

  const targetId = respId || (state.respondents[0] ? state.respondents[0].id : '');
  if (targetId) {
    sel.value = targetId;
    onSelect2QRespondent(targetId);
  }
  modal.style.display = 'flex';
}

function close2QModal() {
  const modal = document.getElementById('modal-2q');
  if (modal) modal.style.display = 'none';
}

function onSelect2QRespondent(respId) {
  const r = state.respondents.find(x => x.id === respId);
  const infoEl = document.getElementById('q2-modal-person-info');
  if (!r) {
    if (infoEl) infoEl.innerHTML = 'กรุณาเลือกรายชื่อผู้รับการคัดกรอง';
    return;
  }

  if (infoEl) {
    infoEl.innerHTML = `
      <div><b>ชื่อ-สกุล:</b> ${r.full_name} <span style="color:#7c3aed;font-weight:700;">(${r.code})</span> | <b>อายุ:</b> ${r.age || '-'} ปี</div>
      <div><b>ที่อยู่:</b> บ้านเลขที่ ${r.house_no || '-'} หมู่ที่ ${r.moo} ต.${r.tambon} | <b>รพ.สต.:</b> ${r.health_center || '-'}</div>
      <div><b>ระยะเวลาสัมผัส:</b> ${r.exposure_years !== '' && r.exposure_years !== undefined ? r.exposure_years + ' ปี' : '-'} | <b>ความเสี่ยงสารหนู:</b> ระดับ${r.risk_level} (${r.total_score} คะแนน)</div>
    `;
  }

  const r1Yes = document.querySelector('input[name="q2_r1"][value="ใช่"]');
  const r1No = document.querySelector('input[name="q2_r1"][value="ไม่ใช่"]');
  const r2Yes = document.querySelector('input[name="q2_r2"][value="ใช่"]');
  const r2No = document.querySelector('input[name="q2_r2"][value="ไม่ใช่"]');

  if (r.q2_1 === 'ใช่') { if (r1Yes) r1Yes.checked = true; } else { if (r1No) r1No.checked = true; }
  if (r.q2_2 === 'ใช่') { if (r2Yes) r2Yes.checked = true; } else { if (r2No) r2No.checked = true; }

  if (r.date_2q) document.getElementById('q2-modal-date').value = r.date_2q;
  if (r.assessor_2q) document.getElementById('q2-modal-assessor').value = r.assessor_2q;
  document.getElementById('q2-modal-note').value = r.note_2q || '';

  evaluate2QModalLive();
}

function evaluate2QModalLive() {
  const q1 = document.querySelector('input[name="q2_r1"]:checked')?.value || 'ไม่ใช่';
  const q2 = document.querySelector('input[name="q2_r2"]:checked')?.value || 'ไม่ใช่';
  const box = document.getElementById('q2-live-result-box');
  const badge = document.getElementById('q2-live-badge');
  const advice = document.getElementById('q2-live-advice');

  if (!box || !badge || !advice) return;
  if (q1 === 'ใช่' || q2 === 'ใช่') {
    box.style.background = '#fef2f2';
    box.style.borderColor = '#f87171';
    badge.className = 'risk-badge risk-high';
    badge.textContent = 'พบความเสี่ยงโรคซึมเศร้า (Positive 2Q)';
    advice.style.color = '#991b1b';
    advice.textContent = 'คำแนะนำ: ตอบ "ใช่" อย่างน้อย 1 ข้อ แนะนำให้ประเมินต่อด้วยแบบประเมินโรคซึมเศร้า 9 คำถาม (9Q) และให้คำปรึกษาทางสุขภาพจิต';
  } else {
    box.style.background = '#f0fdf4';
    box.style.borderColor = '#86efac';
    badge.className = 'risk-badge risk-low';
    badge.textContent = 'ปกติ (ไม่พบความเสี่ยงโรคซึมเศร้า)';
    advice.style.color = '#15803d';
    advice.textContent = 'คำแนะนำ: ตอบ "ไม่ใช่" ทั้ง 2 ข้อ สุขภาพจิตปกติ แนะนำให้ความรู้การดูแลสุขภาพและเฝ้าระวังต่อเนื่อง';
  }
}

async function handleSave2QModal(e) {
  e.preventDefault();
  const respId = document.getElementById('q2-modal-resp-select').value;
  if (!respId) {
    alert('กรุณาเลือกรายชื่อผู้รับการคัดกรองก่อนครับ');
    return;
  }

  const q1 = document.querySelector('input[name="q2_r1"]:checked')?.value || 'ไม่ใช่';
  const q2 = document.querySelector('input[name="q2_r2"]:checked')?.value || 'ไม่ใช่';
  const status2q = (q1 === 'ใช่' || q2 === 'ใช่') ? 'พบความเสี่ยง (Positive 2Q)' : 'ปกติ (ไม่พบความเสี่ยง)';
  const date2q = document.getElementById('q2-modal-date').value;
  const assessor2q = document.getElementById('q2-modal-assessor').value.trim();
  const note2q = document.getElementById('q2-modal-note').value.trim();

  const idx = state.respondents.findIndex(r => r.id === respId);
  if (idx >= 0) {
    state.respondents[idx].q2_1 = q1;
    state.respondents[idx].q2_2 = q2;
    state.respondents[idx].status_2q = status2q;
    state.respondents[idx].date_2q = date2q;
    state.respondents[idx].assessor_2q = assessor2q;
    state.respondents[idx].note_2q = note2q;

    const rRef = state.respondents[idx];
    const as02Idx = state.envAs02.findIndex(x => x.respondent_id === rRef.id);
    if (as02Idx >= 0) {
      state.envAs02[as02Idx].q2_1 = q1;
      state.envAs02[as02Idx].q2_2 = q2;
      state.envAs02[as02Idx].status_2q = status2q;
    }

    saveLocalData();
    close2QModal();
    await postToGoogleSheets({ action: 'saveRespondent', data: state.respondents[idx] });
  }
}

function populateAs02RespondentDropdown() {
  const sel = document.getElementById('as02-fill-from-resp');
  if (!sel) return;
  sel.innerHTML = `<option value="">-- เลือกเพื่อดึงข้อมูลส่วนบุคคลจาก Env-As-01 (${state.respondents.length} ราย) อัตโนมัติ --</option>` +
    state.respondents.map(r => `<option value="${r.id}">[${r.code}] ${r.full_name} (ม.${r.moo} ต.${r.tambon} - คะแนน ${r.total_score})</option>`).join('');
}

function autofillAs02FromRespondent(respId) {
  const r = state.respondents.find(x => x.id === respId);
  if (!r) return;
  document.getElementById('as02-name').value = r.full_name || '';
  document.getElementById('as02-age').value = r.age || '';
  setSelectOrOther('as02-gender', 'as02-gender-other-wrap', 'as02-gender-other', r.gender ?? '');
  document.getElementById('as02-cid').value = r.cid || '';
  document.getElementById('as02-house').value = r.house_no || '';
  document.getElementById('as02-moo').value = r.moo || '';
  setSelectOrOther('as02-tambon', 'as02-tambon-other-wrap', 'as02-tambon-other', r.tambon || 'ท่าตอน');
  setSelectOrOther('as02-marital', 'as02-marital-other-wrap', 'as02-marital-other', r.marital_status ?? '');
  setSelectOrOther('as02-edu', 'as02-edu-other-wrap', 'as02-edu-other', r.education ?? '');
  document.getElementById('as02-years').value = r.years_in_area || '';
  if (document.getElementById('as02-exposure-years')) {
    document.getElementById('as02-exposure-years').value = r.exposure_years !== undefined ? r.exposure_years : '';
  }
  document.getElementById('as02-well-id').value = r.well_id || '';
  document.getElementById('as02-within-1km').value = r.q6 == null ? '' : r.q6 ? '1.ใช่' : '2.ไม่ใช่';
  if (document.getElementById('as02-job-flag')) document.getElementById('as02-job-flag').value = r.risk_job_flag ?? '';
  document.getElementById('as02-job-type').value = r.risk_job_type || '';
  populateCheckboxesFromString('as02-occ-chk', r.risk_job_type);
  document.getElementById('as02-job-detail').value = `${r.job_detail || ''} ${r.job_duration ? '(' + r.job_duration + ')' : ''}`.trim();
  document.getElementById('as02-diseases').value = r.diseases ?? '';
  document.getElementById('as02-eat-river-veg').value = r.q11 == null ? '' : r.q11 ? '1.ใช่' : '2.ไม่ใช่';
  document.getElementById('as02-flood-5y').value = r.q10 == null ? '' : r.q10 ? '1.เคย' : '2.ไม่เคย';
  if (document.getElementById('as02-q2-1')) document.getElementById('as02-q2-1').value = r.q2_1 || '';
  if (document.getElementById('as02-q2-2')) document.getElementById('as02-q2-2').value = r.q2_2 || '';
  if (document.getElementById('as02-status-2q')) document.getElementById('as02-status-2q').value = r.status_2q || 'ยังไม่คัดกรอง';
}

function openEnvAs02ForRespondent(respId) {
  openEnvAs02Modal(null);
  document.getElementById('as02-fill-from-resp').value = respId;
  autofillAs02FromRespondent(respId);
}

function openDetailedEnvAs02(id = null) {
  populateAs02RespondentDropdown();
  const modal = document.getElementById('env-as02-modal');
  const title = document.getElementById('as02-modal-title');
  document.getElementById('env-as02-form').reset();
  document.querySelectorAll('#env-as02-form .other-input-wrap').forEach(w => { w.style.display = 'none'; });
  document.querySelectorAll('.as02-occ-chk, .as02-drk-chk, .as02-use-chk').forEach(c => { c.checked = false; });

  if (id) {
    const item = state.envAs02.find(x => x.id === id);
    if (!item) return;
    title.innerHTML = `<i class="fa-solid fa-vial-circle-check"></i> แก้ไขแบบฟอร์ม Env-As-02 (${item.form_no}: ${item.full_name})`;
    document.getElementById('as02-id').value = item.id;
    document.getElementById('as02-form-no').value = item.form_no ?? '';
    document.getElementById('as02-date').value = item.interview_date ?? '';
    document.getElementById('as02-well-id').value = item.well_id ?? '';
    document.getElementById('as02-name').value = item.full_name ?? '';
    document.getElementById('as02-age').value = item.age ?? '';
    document.getElementById('as02-phone').value = item.phone ?? '';
    document.getElementById('as02-cid').value = item.cid ?? '';
    setSelectOrOther('as02-gender', 'as02-gender-other-wrap', 'as02-gender-other', item.gender ?? '');
    document.getElementById('as02-weight').value = item.weight_kg ?? '';
    document.getElementById('as02-height').value = item.height_cm ?? '';
    document.getElementById('as02-house').value = item.house_no ?? '';
    document.getElementById('as02-moo').value = item.moo ?? '';
    setSelectOrOther('as02-tambon', 'as02-tambon-other-wrap', 'as02-tambon-other', item.tambon ?? '');
    setSelectOrOther('as02-marital', 'as02-marital-other-wrap', 'as02-marital-other', item.marital_status ?? '');
    setSelectOrOther('as02-edu', 'as02-edu-other-wrap', 'as02-edu-other', item.education ?? '');
    document.getElementById('as02-years').value = item.years_in_area ?? '';
    if (document.getElementById('as02-exposure-years')) {
      document.getElementById('as02-exposure-years').value = item.exposure_years !== undefined ? item.exposure_years : (item.years_in_area ?? '');
    }
    document.getElementById('as02-hours-home').value = item.hours_at_home ?? '';
    document.getElementById('as02-out-district').value = item.work_out_district ?? '';
    document.getElementById('as02-out-days').value = item.work_out_days ?? '';
    document.getElementById('as02-within-1km').value = item.within_1km_river ?? '';
    if (document.getElementById('as02-job-flag')) document.getElementById('as02-job-flag').value = item.risk_job_flag ?? '';
    document.getElementById('as02-job-type').value = item.risk_job_type ?? '';
    populateCheckboxesFromString('as02-occ-chk', item.risk_job_type);
    document.getElementById('as02-job-detail').value = item.job_detail ?? '';
    document.getElementById('as02-diseases').value = item.diseases ?? '';
    setSelectOrOther('as02-herb', 'as02-herb-other-wrap', 'as02-herb-other', item.herb_usage ?? '');
    document.getElementById('as02-herb-name').value = item.herb_name ?? '';
    setSelectOrOther('as02-smoking', 'as02-smoking-other-wrap', 'as02-smoking-other', item.smoking_status ?? '');
    if (document.getElementById('as02-smoking-detail')) document.getElementById('as02-smoking-detail').value = item.smoking_detail ?? '';
    setSelectOrOther('as02-alcohol', 'as02-alcohol-other-wrap', 'as02-alcohol-other', item.alcohol_status ?? '');
    document.getElementById('as02-seafood-freq').value = item.seafood_freq ?? '';
    document.getElementById('as02-seafood-3days').value = item.seafood_3days ?? '';
    document.getElementById('as02-drink-sources').value = item.drink_sources ?? '';
    populateCheckboxesFromString('as02-drk-chk', item.drink_sources);
    if (document.getElementById('as02-drink-years')) document.getElementById('as02-drink-years').value = item.drink_years ?? '';
    document.getElementById('as02-use-sources').value = item.use_sources ?? '';
    populateCheckboxesFromString('as02-use-chk', item.use_sources);
    if (document.getElementById('as02-use-years')) document.getElementById('as02-use-years').value = item.use_years ?? '';
    setSelectOrOther('as02-food-rice', 'as02-rice-other-wrap', 'as02-rice-other', item.food_rice ?? '');
    setSelectOrOther('as02-food-veg', 'as02-veg-other-wrap', 'as02-veg-other', item.food_veg ?? '');
    setSelectOrOther('as02-food-fish', 'as02-fish-other-wrap', 'as02-fish-other', item.food_fish ?? '');
    setSelectOrOther('as02-food-snail', 'as02-snail-other-wrap', 'as02-snail-other', item.food_snail ?? '');
    document.getElementById('as02-home-veg').value = item.home_grown_veg ?? '';
    setSelectOrOther('as02-home-water', 'as02-home-water-other-wrap', 'as02-home-water-other', item.home_grown_water ?? '');
    document.getElementById('as02-eat-river-veg').value = item.eat_river_veg_weekly ?? '';
    document.getElementById('as02-flood-5y').value = item.flood_5years ?? '';
    if (document.getElementById('as02-q2-1')) document.getElementById('as02-q2-1').value = item.q2_1 ?? '';
    if (document.getElementById('as02-q2-2')) document.getElementById('as02-q2-2').value = item.q2_2 ?? '';
    if (document.getElementById('as02-status-2q')) document.getElementById('as02-status-2q').value = item.status_2q ?? '';
    document.getElementById('as02-interviewer').value = item.interviewer_name ?? '';
    if (document.getElementById('as02-role')) document.getElementById('as02-role').value = item.interviewer_role ?? '';
    setSelectOrOther('as02-hc', 'as02-hc-other-wrap', 'as02-hc-other', item.health_center ?? '');
  } else {
    title.innerHTML = `<i class="fa-solid fa-vial-circle-check"></i> บันทึกแบบฟอร์ม Env-As-02 ใหม่ (ก่อนเก็บตัวอย่างทางชีวภาพ)`;
    const nextNum = state.envAs02.length + 1;
    document.getElementById('as02-id').value = `AS02-${String(nextNum).padStart(3, '0')}`;
    document.getElementById('as02-form-no').value = `69-${String(nextNum).padStart(4, '0')}`;
    document.getElementById('as02-date').value = new Date().toISOString().slice(0, 10);
    if (document.getElementById('as02-exposure-years')) document.getElementById('as02-exposure-years').value = '';
  }
  modal.style.display = 'flex';
  const bodyEl = document.getElementById('as02-modal-body');
  if (bodyEl) bodyEl.scrollTop = 0;
}

function closeEnvAs02Modal() {
  document.getElementById('env-as02-modal').style.display = 'none';
}

async function handleSaveEnvAs02(e) {
  e.preventDefault();
  const id = document.getElementById('as02-id').value;
  const expYears = document.getElementById('as02-exposure-years') ? document.getElementById('as02-exposure-years').value.trim() : '';
  const q21 = document.getElementById('as02-q2-1') ? document.getElementById('as02-q2-1').value : 'ไม่ใช่';
  const q22 = document.getElementById('as02-q2-2') ? document.getElementById('as02-q2-2').value : 'ไม่ใช่';
  let status2q = document.getElementById('as02-status-2q') ? document.getElementById('as02-status-2q').value : 'ยังไม่คัดกรอง';
  if (q21 === 'ใช่' || q22 === 'ใช่') status2q = 'พบความเสี่ยง (Positive 2Q)';

  const obj = {
    ...(state.envAs02.find(x => x.id === id) || {}),
    history_updated: true,
    history_complete: Boolean(document.getElementById('as02-date').value && document.getElementById('as02-interviewer').value.trim()),
    respondent_id: document.getElementById('as02-fill-from-resp').value || (state.envAs02.find(x => x.id === id)?.respondent_id || ''),
    id: id,
    form_no: document.getElementById('as02-form-no').value.trim(),
    well_id: document.getElementById('as02-well-id').value.trim(),
    full_name: document.getElementById('as02-name').value.trim(),
    age: document.getElementById('as02-age').value,
    phone: document.getElementById('as02-phone').value.trim(),
    cid: document.getElementById('as02-cid').value.trim(),
    gender: getSelectOrOther('as02-gender', 'as02-gender-other'),
    weight_kg: document.getElementById('as02-weight').value,
    height_cm: document.getElementById('as02-height').value,
    house_no: document.getElementById('as02-house').value.trim(),
    moo: document.getElementById('as02-moo').value,
    tambon: getSelectOrOther('as02-tambon', 'as02-tambon-other'),
    marital_status: getSelectOrOther('as02-marital', 'as02-marital-other'),
    education: getSelectOrOther('as02-edu', 'as02-edu-other'),
    amphoe: 'แม่อาย',
    province: 'เชียงใหม่',
    years_in_area: document.getElementById('as02-years').value,
    exposure_years: expYears !== '' ? Number(expYears) : '',
    hours_at_home: document.getElementById('as02-hours-home').value,
    work_out_district: document.getElementById('as02-out-district').value,
    work_out_days: document.getElementById('as02-out-days').value,
    within_1km_river: document.getElementById('as02-within-1km').value,
    risk_job_flag: document.getElementById('as02-job-flag') ? document.getElementById('as02-job-flag').value : 'ไม่ใช่',
    risk_job_type: document.getElementById('as02-job-type').value.trim(),
    job_detail: document.getElementById('as02-job-detail').value.trim(),
    diseases: document.getElementById('as02-diseases').value.trim(),
    herb_usage: getSelectOrOther('as02-herb', 'as02-herb-other'),
    herb_name: document.getElementById('as02-herb-name').value.trim(),
    smoking_status: getSelectOrOther('as02-smoking', 'as02-smoking-other'),
    smoking_detail: document.getElementById('as02-smoking-detail') ? document.getElementById('as02-smoking-detail').value.trim() : '',
    alcohol_status: getSelectOrOther('as02-alcohol', 'as02-alcohol-other'),
    seafood_freq: document.getElementById('as02-seafood-freq').value,
    seafood_3days: document.getElementById('as02-seafood-3days').value,
    drink_sources: document.getElementById('as02-drink-sources').value.trim(),
    drink_years: document.getElementById('as02-drink-years') ? document.getElementById('as02-drink-years').value.trim() : '',
    use_sources: document.getElementById('as02-use-sources').value.trim(),
    use_years: document.getElementById('as02-use-years') ? document.getElementById('as02-use-years').value.trim() : '',
    food_rice: getSelectOrOther('as02-food-rice', 'as02-rice-other'),
    food_veg: getSelectOrOther('as02-food-veg', 'as02-veg-other'),
    food_fish: getSelectOrOther('as02-food-fish', 'as02-fish-other'),
    food_snail: getSelectOrOther('as02-food-snail', 'as02-snail-other'),
    home_grown_veg: document.getElementById('as02-home-veg').value.trim(),
    home_grown_water: getSelectOrOther('as02-home-water', 'as02-home-water-other'),
    eat_river_veg_weekly: document.getElementById('as02-eat-river-veg').value,
    flood_5years: document.getElementById('as02-flood-5y').value,
    q2_1: q21,
    q2_2: q22,
    status_2q: status2q,
    interviewer_name: document.getElementById('as02-interviewer').value.trim(),
    interviewer_role: document.getElementById('as02-role') ? document.getElementById('as02-role').value.trim() : '',
    health_center: getSelectOrOther('as02-hc', 'as02-hc-other'),
    interview_date: document.getElementById('as02-date').value,
    updated_at: new Date().toLocaleString('th-TH')
  };

  const idx = state.envAs02.findIndex(x => x.id === id);
  if (idx >= 0) state.envAs02[idx] = obj;
  else state.envAs02.push(obj);

  saveLocalData();
  closeEnvAs02Modal();
  await postToGoogleSheets({ action: 'saveEnvAs02', data: obj });
}

async function deleteEnvAs02(id) {
  if (!confirm(`ยืนยันการลบข้อมูลแบบฟอร์ม Env-As-02 รหัส ${id} หรือไม่?`)) return;
  state.envAs02 = state.envAs02.filter(x => x.id !== id);
  saveLocalData();
  await postToGoogleSheets({ action: 'deleteEnvAs02', id: id });
}

function filterWellByTypeClick(typeName) {
  switchTab('tab-wells');
  document.getElementById('well-filter-type').value = typeName;
  renderWellsTable();
}

function filterWellByDistClick(distKey) {
  switchTab('tab-wells');
  document.getElementById('well-filter-dist').value = distKey;
  renderWellsTable();
}

function filterWellByHcClick(hcName) {
  switchTab('tab-wells');
  document.getElementById('well-filter-hc').value = hcName;
  renderWellsTable();
}

function populateWellDropdowns() {
  const mapWellSel = document.getElementById('map-filter-well');
  const respFilterWellSel = document.getElementById('resp-filter-well');
  const modalWellSel = document.getElementById('resp-well-id');
  const labFilterWellSel = document.getElementById('waterlab-filter-well');
  const labModalWellSel = document.getElementById('wlab-well-id');

  const currentMapVal = mapWellSel ? mapWellSel.value : 'ALL';
  const currentRespFilterVal = respFilterWellSel ? respFilterWellSel.value : 'ALL';
  const currentModalVal = modalWellSel ? modalWellSel.value : '';
  const currentLabFilterVal = labFilterWellSel ? labFilterWellSel.value : 'ALL';
  const currentLabModalVal = labModalWellSel ? labModalWellSel.value : '';

  const optionsHtml = state.wells.map(w =>
    `<option value="${w.well_id}">[${w.well_id}${w.sample_code ? ' / ' + w.sample_code : ''}] ${w.well_name} (ม.${w.moo} ต.${w.tambon})</option>`
  ).join('');

  if (mapWellSel) {
    mapWellSel.innerHTML = `<option value="ALL">-- ทุกจุดบ่อน้ำ (${state.wells.length} บ่อ) --</option>` + optionsHtml;
    mapWellSel.value = currentMapVal;
  }
  if (respFilterWellSel) {
    respFilterWellSel.innerHTML = `<option value="ALL">ทุกจุดบ่อน้ำ (${state.wells.length} บ่อ)</option>` + optionsHtml;
    respFilterWellSel.value = currentRespFilterVal;
  }
  if (modalWellSel) {
    modalWellSel.innerHTML = `<option value="">-- เลือกจุดบ่อน้ำในหมู่บ้าน --</option>` + optionsHtml;
    modalWellSel.value = currentModalVal;
  }
  if (labFilterWellSel) {
    labFilterWellSel.innerHTML = `<option value="ALL">ทุกจุดบ่อน้ำ (${state.wells.length} บ่อ)</option>` + optionsHtml;
    labFilterWellSel.value = currentLabFilterVal;
  }
  if (labModalWellSel) {
    labModalWellSel.innerHTML = '<option value="">-- ยังไม่ยืนยันการจับคู่ทะเบียน --</option>' + optionsHtml;
    if (currentLabModalVal) labModalWellSel.value = currentLabModalVal;
  }
}

// ==================== WATER WELLS TABLE, ATTACHMENTS & CRUD ====================
function handleWellFilesSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const currentCount = state.currentWellAttachments.length;
  if (currentCount + files.length > 5) {
    alert(`สามารถแนบรูปภาพหรือเอกสาร PDF ได้สูงสุดไม่เกิน 5 ไฟล์ต่อจุดแหล่งน้ำครับ (ปัจจุบันมีแล้ว ${currentCount} ไฟล์, ท่านเลือกเพิ่ม ${files.length} ไฟล์)`);
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
  const maxToAdd = Math.min(files.length, 5 - currentCount);

  Array.from(files).slice(0, maxToAdd).forEach(file => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (!isImage && !isPdf) {
      alert(`ไฟล์ "${file.name}" ไม่ใช่ไฟล์ JPG, PNG หรือ PDF ที่รองรับครับ`);
      return;
    }

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1000;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          state.currentWellAttachments.push({
            name: file.name,
            type: 'image',
            size_kb: Math.round(compressedDataUrl.length * 0.75 / 1024),
            dataUrl: compressedDataUrl,
            uploaded_at: new Date().toLocaleString('th-TH')
          });
          renderWellFilesPreview();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else if (isPdf) {
      if (file.size > 3.5 * 1024 * 1024) {
        alert(`ไฟล์ PDF "${file.name}" มีขนาดเกิน 3.5 MB กรุณาเลือกไฟล์ที่บีบอัดแล้ว`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        state.currentWellAttachments.push({
          name: file.name,
          type: 'pdf',
          size_kb: Math.round(file.size / 1024),
          dataUrl: e.target.result,
          uploaded_at: new Date().toLocaleString('th-TH')
        });
        renderWellFilesPreview();
      };
      reader.readAsDataURL(file);
    }
  });

  event.target.value = '';
}

function renderWellFilesPreview() {
  const container = document.getElementById('well-files-preview');
  const countEl = document.getElementById('well-files-count');
  if (!container) return;

  const count = state.currentWellAttachments.length;
  if (countEl) countEl.textContent = `แนบแล้ว ${count} / 5 ไฟล์`;

  if (count === 0) {
    container.innerHTML = '<span class="text-muted" style="font-size:12px;">ยังไม่มีไฟล์รูปภาพหรือ PDF ที่แนบ</span>';
    return;
  }

  container.innerHTML = state.currentWellAttachments.map((att, idx) => {
    if (att.type === 'image') {
      return `
        <div class="well-att-card">
          <img src="${att.dataUrl}" alt="${att.name}" onclick="window.open('${att.dataUrl}')" title="คลิกเพื่อดูภาพขนาดเต็ม">
          <button type="button" class="well-att-del" onclick="removeWellAttachment(${idx})" title="ลบไฟล์นี้">&times;</button>
          <div class="well-att-name" title="${att.name}">${att.name} (${att.size_kb} KB)</div>
        </div>
      `;
    } else {
      return `
        <div class="well-att-card">
          <div class="well-att-pdf-box" onclick="window.open('${att.dataUrl}')" title="คลิกเพื่อเปิดไฟล์ PDF">
            <i class="fa-solid fa-file-pdf"></i>
            <div>PDF</div>
          </div>
          <button type="button" class="well-att-del" onclick="removeWellAttachment(${idx})" title="ลบไฟล์นี้">&times;</button>
          <div class="well-att-name" title="${att.name}">${att.name} (${att.size_kb} KB)</div>
        </div>
      `;
    }
  }).join('');
}

function removeWellAttachment(idx) {
  state.currentWellAttachments.splice(idx, 1);
  renderWellFilesPreview();
}

function openWellGalleryModal(wellId) {
  const well = state.wells.find(w => w.well_id === wellId);
  if (!well) return;

  const modal = document.getElementById('well-gallery-modal');
  const title = document.getElementById('well-gallery-title');
  const body = document.getElementById('well-gallery-body');
  if (!modal || !body) return;

  const atts = Array.isArray(well.attachments) ? well.attachments : [];
  title.innerHTML = `<i class="fa-solid fa-images"></i> รูปภาพและเอกสารจุดแหล่งน้ำ: [${well.well_id}] ${well.well_name}`;

  if (atts.length === 0) {
    body.innerHTML = `
      <div style="text-align:center; padding:35px 20px; color:#64748b;">
        <i class="fa-regular fa-image" style="font-size:48px; opacity:0.4; margin-bottom:12px;"></i>
        <p>ยังไม่มีการแนบรูปภาพหรือเอกสารสำหรับจุดแหล่งน้ำนี้</p>
        <button class="btn btn-primary" onclick="closeWellGalleryModal(); openWellModal('${well.well_id}');" style="margin-top:10px;">
          <i class="fa-solid fa-upload"></i> คลิกที่นี่เพื่อเพิ่มรูปภาพ / PDF
        </button>
      </div>
    `;
  } else {
    body.innerHTML = `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:13px; color:#475569;">
          จุดบ่อน้ำ: <b>${well.well_name}</b> (ม.${well.moo} ต.${well.tambon}) | ไฟล์แนบทั้งหมด <b>${atts.length} ไฟล์</b>
        </div>
        <button class="btn btn-sm btn-outline" onclick="closeWellGalleryModal(); openWellModal('${well.well_id}');">
          <i class="fa-solid fa-pen"></i> แก้ไข/เพิ่มรูป
        </button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px;">
        ${atts.map((att, i) => {
          if (att.type === 'image') {
            return `
              <div style="background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:8px; display:flex; flex-direction:column;">
                <a href="${att.dataUrl}" target="_blank" download="${att.name}" title="คลิกเพื่อดูภาพเต็ม / ดาวน์โหลด">
                  <img src="${att.dataUrl}" alt="${att.name}" style="width:100%; height:160px; object-fit:cover; border-radius:6px; cursor:zoom-in;">
                </a>
                <div style="margin-top:6px; font-size:12px; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${att.name}</div>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">${att.uploaded_at || ''} (${att.size_kb || '-'} KB)</div>
                <div style="margin-top:6px; display:flex; gap:6px;">
                  <a href="${att.dataUrl}" target="_blank" class="btn btn-xs btn-outline" style="text-decoration:none; flex:1; text-align:center;">ดูรูปใหญ่</a>
                  <a href="${att.dataUrl}" download="${att.name}" class="btn btn-xs btn-primary" style="text-decoration:none; flex:1; text-align:center;">ดาวน์โหลด</a>
                </div>
              </div>
            `;
          } else {
            return `
              <div style="background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:8px; display:flex; flex-direction:column;">
                <div style="height:160px; background:#fef2f2; border:1px dashed #fca5a5; border-radius:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#dc2626;">
                  <i class="fa-solid fa-file-pdf" style="font-size:42px; margin-bottom:8px;"></i>
                  <span style="font-weight:700; font-size:13px;">เอกสาร PDF</span>
                </div>
                <div style="margin-top:6px; font-size:12px; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${att.name}</div>
                <div style="font-size:11px; color:#64748b; margin-top:2px;">${att.uploaded_at || ''} (${att.size_kb || '-'} KB)</div>
                <div style="margin-top:6px; display:flex; gap:6px;">
                  <a href="${att.dataUrl}" target="_blank" class="btn btn-xs btn-outline" style="text-decoration:none; flex:1; text-align:center;">เปิดอ่าน</a>
                  <a href="${att.dataUrl}" download="${att.name}" class="btn btn-xs btn-primary" style="text-decoration:none; flex:1; text-align:center;">ดาวน์โหลด</a>
                </div>
              </div>
            `;
          }
        }).join('')}
      </div>
    `;
  }

  modal.style.display = 'flex';
}

function closeWellGalleryModal() {
  const modal = document.getElementById('well-gallery-modal');
  if (modal) modal.style.display = 'none';
}

function filterPeopleByWell(wellId) {
  switchTab('tab-respondents');
  const sel = document.getElementById('resp-filter-well');
  if (sel) {
    sel.value = wellId;
    renderRespondentsTable();
  }
}

function focusOnMap(lat, lng) {
  switchTab('tab-map');
  if (state.map) {
    setTimeout(() => {
      state.map.invalidateSize();
      state.map.setView([lat, lng], 17);
    }, 150);
  }
}

function openWellModal(wellId = null) {
  const modal = document.getElementById('well-modal');
  const title = document.getElementById('well-modal-title');
  document.getElementById('well-form').reset();
  document.querySelectorAll('#well-form .other-input-wrap').forEach(w => { w.style.display = 'none'; });

  if (wellId) {
    const w = state.wells.find(item => item.well_id === wellId);
    if (!w) return;
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> แก้ไขข้อมูลแหล่งน้ำ (${w.well_id})`;
    document.getElementById('well-id').value = w.well_id;
    document.getElementById('well-id').readOnly = true;
    document.getElementById('well-sample-code').value = w.sample_code || '';
    document.getElementById('well-name').value = w.well_name;
    setSelectOrOther('well-type', 'well-type-other-wrap', 'well-type-other', w.well_type || 'บ่อบาดาล');
    if (document.getElementById('well-depth')) document.getElementById('well-depth').value = w.depth_meters || '';
    setSelectOrOther('well-hc', 'well-hc-other-wrap', 'well-hc-other', w.health_center ?? '');
    document.getElementById('well-lat').value = w.latitude;
    document.getElementById('well-lng').value = w.longitude;
    document.getElementById('well-utm-e').value = w.utm_e || '';
    document.getElementById('well-utm-n').value = w.utm_n || '';
    document.getElementById('well-house').value = w.house_no || '';
    document.getElementById('well-moo').value = w.moo || '';
    setSelectOrOther('well-tambon', 'well-tambon-other-wrap', 'well-tambon-other', w.tambon || 'ท่าตอน');
    document.getElementById('well-dist').value = w.distance_river_m !== undefined ? w.distance_river_m : 100;
    setSelectOrOther('well-usage-select', 'well-usage-other-wrap', 'well-usage', w.usage_type || 'ใช้อุปโภค');
    document.getElementById('well-user-count').value = w.user_count ?? '';
    document.getElementById('well-arsenic').value = w.arsenic_level !== undefined ? w.arsenic_level : '';
    setSelectOrOther('well-status-select', 'well-status-other-wrap', 'well-status', w.safety_status || w.arsenic_status || 'เฝ้าระวังตามระยะห่างแม่น้ำกก');
    document.getElementById('well-notes').value = w.notes || '';
    state.currentWellAttachments = Array.isArray(w.attachments) ? [...w.attachments] : [];
  } else {
    title.innerHTML = `<i class="fa-solid fa-faucet-drip"></i> เพิ่มจุดแหล่งน้ำใหม่`;
    const nextNum = state.wells.length + 1;
    document.getElementById('well-id').value = `W${String(nextNum).padStart(3, '0')}`;
    document.getElementById('well-id').readOnly = false;
    document.getElementById('well-lat').value = '';
    document.getElementById('well-lng').value = '';
    document.getElementById('well-dist').value = '';
    document.getElementById('well-user-count').value = '';
    state.currentWellAttachments = [];
  }

  renderWellFilesPreview();
  modal.style.display = 'flex';
  const bodyEl = document.getElementById('well-modal-body');
  if (bodyEl) bodyEl.scrollTop = 0;
}

function closeWellModal() {
  document.getElementById('well-modal').style.display = 'none';
}

function useCurrentGpsForWell() {
  if (!navigator.geolocation) return alert('เบราว์เซอร์ไม่รองรับ GPS');
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('well-lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('well-lng').value = pos.coords.longitude.toFixed(6);
  });
}

async function handleSaveWell(e) {
  e.preventDefault();
  const dist = optionalNumber(document.getElementById('well-dist').value);
  let distBand = 'มากกว่า 300 เมตร';
  if (dist === null) distBand = 'ไม่ระบุ';
  else if (dist <= 100) distBand = 'ไม่เกิน 100 เมตร';
  else if (dist <= 200) distBand = '101 - 200 เมตร';
  else if (dist <= 300) distBand = '201 - 300 เมตร';

  const pCode = document.getElementById('well-sample-code').value.trim();
  const wellId = document.getElementById('well-id').value.trim();
  const existing = state.wells.find(w => w.well_id === wellId);

  const wellObj = {
    ...(existing || {}),
    well_id: wellId,
    seq: existing ? existing.seq : state.wells.length + 1,
    sample_code: pCode,
    well_name: document.getElementById('well-name').value.trim(),
    owner_name: existing && existing.well_name === document.getElementById('well-name').value.trim() ? existing.owner_name : document.getElementById('well-name').value.trim(),
    well_type: getSelectOrOther('well-type', 'well-type-other'),
    depth_meters: document.getElementById('well-depth') ? document.getElementById('well-depth').value.trim() : '',
    health_center: getSelectOrOther('well-hc', 'well-hc-other'),
    latitude: parseFloat(document.getElementById('well-lat').value),
    longitude: parseFloat(document.getElementById('well-lng').value),
    utm_e: document.getElementById('well-utm-e').value || '',
    utm_n: document.getElementById('well-utm-n').value || '',
    house_no: document.getElementById('well-house').value.trim(),
    moo: Number(document.getElementById('well-moo').value),
    tambon: getSelectOrOther('well-tambon', 'well-tambon-other'),
    amphoe: 'แม่อาย',
    province: 'เชียงใหม่',
    distance_river_m: dist,
    distance_band: distBand,
    usage_type: getSelectOrOther('well-usage-select', 'well-usage'),
    user_count: optionalNumber(document.getElementById('well-user-count').value),
    arsenic_level: document.getElementById('well-arsenic').value,
    safety_status: getSelectOrOther('well-status-select', 'well-status') || (pCode ? `ส่งตรวจสารปนเปื้อน (${pCode})` : 'สำรวจแล้ว'),
    notes: document.getElementById('well-notes').value.trim(),
    attachments: [...state.currentWellAttachments],
    updated_at: new Date().toLocaleString('th-TH'),
    updated_by: state.currentUser ? state.currentUser.displayName : 'Admin'
  };

  const idx = state.wells.findIndex(w => w.well_id === wellObj.well_id);
  if (idx >= 0) {
    state.wells[idx] = wellObj;
  } else {
    state.wells.push(wellObj);
  }

  saveLocalData();
  closeWellModal();
  const lightWell = { ...wellObj, attachments_count: (wellObj.attachments || []).length, attachments: undefined };
  await postToGoogleSheets({ action: 'saveWell', data: lightWell });
}

function recalcScore() {
  let score = 0;
  for (let i = 1; i <= 11; i++) {
    const chk = document.getElementById(`env-q${i}`);
    if (chk && chk.checked) {
      score += ENV_WEIGHTS[`q${i}`];
    }
  }

  const scoreEl = document.getElementById('calc-total-score');
  const badgeEl = document.getElementById('calc-risk-badge');
  const measureEl = document.getElementById('calc-measure-text');
  if (scoreEl) scoreEl.textContent = score;

  const rLow = document.getElementById('criteria-row-low');
  const rMed = document.getElementById('criteria-row-med');
  const rHigh = document.getElementById('criteria-row-high');
  if (rLow) rLow.className = '';
  if (rMed) rMed.className = '';
  if (rHigh) rHigh.className = '';

  if (score > 20) {
    if (badgeEl) {
      badgeEl.className = 'risk-badge risk-high';
      badgeEl.textContent = 'สูง / มาก (คะแนน > 20)';
    }
    if (measureEl) measureEl.textContent = 'มาตรการ: ส่งพบแพทย์ตรวจร่างกาย ซักประวัติ Env-As-02 และเก็บปัสสาวะตรวจสารหนู';
    if (rHigh) rHigh.className = 'risk-criteria-row-active';
  } else if (score >= 10) {
    if (badgeEl) {
      badgeEl.className = 'risk-badge risk-med';
      badgeEl.textContent = 'ปานกลาง (คะแนน 10 - 20)';
    }
    if (measureEl) measureEl.textContent = 'มาตรการ: สื่อสารความเสี่ยง ซักประวัติ Env-As-02 และพิจารณาตรวจสารหนูในปัสสาวะ';
    if (rMed) rMed.className = 'risk-criteria-row-active';
  } else {
    if (badgeEl) {
      badgeEl.className = 'risk-badge risk-low';
      badgeEl.textContent = 'ต่ำ (คะแนน 0 - < 10)';
    }
    if (measureEl) measureEl.textContent = 'มาตรการ: สื่อสารความเสี่ยง ให้สุขศึกษา ติดตามเฝ้าระวังทุก 1 ปี';
    if (rLow) rLow.className = 'risk-criteria-row-active';
  }
  return score;
}

function useCurrentGpsForRespondent() {
  if (!navigator.geolocation) return alert('เบราว์เซอร์ไม่รองรับ GPS');
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('resp-lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('resp-lng').value = pos.coords.longitude.toFixed(6);
  });
}

function openDetailedRespondentModal(respId = null) {
  populateWellDropdowns();
  const modal = document.getElementById('respondent-modal');
  const title = document.getElementById('resp-modal-title');
  document.getElementById('respondent-form').reset();
  document.querySelectorAll('#respondent-form .other-input-wrap').forEach(w => { w.style.display = 'none'; });
  document.querySelectorAll('.as01-occ-chk, .as01-dis-chk, .as01-sym-chk').forEach(c => { c.checked = false; });

  if (respId) {
    const r = state.respondents.find(item => item.id === respId);
    if (!r) return;
    title.innerHTML = `<i class="fa-solid fa-user-pen"></i> แก้ไขแบบฟอร์ม Env-As-01: ${r.full_name} (${r.code})`;
    document.getElementById('resp-id').value = r.id;
    document.getElementById('resp-code').value = r.code || '';
    if (document.getElementById('resp-survey-date')) document.getElementById('resp-survey-date').value = r.survey_date || '';
    setSelectOrOther('resp-target-group', 'resp-target-other-wrap', 'resp-target-other', r.target_group || 'กลุ่มใหม่');
    document.getElementById('resp-cut-point').value = r.cut_point || '';
    document.getElementById('resp-well-id').value = r.well_id || '';
    setSelectOrOther('resp-hc', 'resp-hc-other-wrap', 'resp-hc-other', r.health_center || 'รพ.สต.บ้านท่าตอน');
    if (document.getElementById('resp-interviewer')) document.getElementById('resp-interviewer').value = r.interviewer_name || 'เจ้าหน้าที่สาธารณสุข อ.แม่อาย';

    document.getElementById('resp-name').value = r.full_name || '';
    document.getElementById('resp-age').value = r.age || '';
    setSelectOrOther('resp-gender', 'resp-gender-other-wrap', 'resp-gender-other', r.gender || '1) ชาย');
    document.getElementById('resp-cid').value = r.cid || '';
    if (document.getElementById('resp-no-cid')) document.getElementById('resp-no-cid').checked = Boolean(r.no_cid || r.cid === 'ไม่มีเลข 13 หลัก');
    document.getElementById('resp-house').value = r.house_no || '';
    document.getElementById('resp-moo').value = r.moo || '';
    setSelectOrOther('resp-tambon', 'resp-tambon-other-wrap', 'resp-tambon-other', r.tambon || 'ท่าตอน');
    setSelectOrOther('resp-marital', 'resp-marital-other-wrap', 'resp-marital-other', r.marital_status || '2) คู่');
    setSelectOrOther('resp-edu', 'resp-edu-other-wrap', 'resp-edu-other', r.education || '1) ไม่ได้เรียนหนังสือ');
    document.getElementById('resp-years-area').value = r.years_in_area || '';
    if (document.getElementById('resp-exposure-years')) document.getElementById('resp-exposure-years').value = r.exposure_years !== undefined ? r.exposure_years : '';
    document.getElementById('resp-lat').value = r.latitude ?? '';
    document.getElementById('resp-lng').value = r.longitude ?? '';

    document.getElementById('resp-job-flag').value = r.risk_job_flag || 'ไม่ใช่';
    document.getElementById('resp-job-type').value = r.risk_job_type || '';
    populateCheckboxesFromString('as01-occ-chk', r.risk_job_type);
    document.getElementById('resp-job-detail').value = r.job_detail || '';
    document.getElementById('resp-job-duration').value = r.job_duration || '';
    document.getElementById('resp-job-hours').value = r.job_hours || '';
    document.getElementById('resp-swim-duration').value = r.swim_duration || '';
    document.getElementById('resp-swim-hours').value = r.swim_hours || '';

    document.getElementById('resp-disease-flag').value = r.disease_flag || 'ไม่มี';
    document.getElementById('resp-diseases').value = r.diseases || '';
    populateCheckboxesFromString('as01-dis-chk', r.diseases);
    document.getElementById('resp-symptom-flag').value = r.symptom_flag || 'ไม่มี';
    document.getElementById('resp-symptoms').value = r.symptoms || '';
    populateCheckboxesFromString('as01-sym-chk', r.symptoms);

    if (document.getElementById('resp-q2-1')) document.getElementById('resp-q2-1').value = r.q2_1 || '';
    if (document.getElementById('resp-q2-2')) document.getElementById('resp-q2-2').value = r.q2_2 || '';
    if (document.getElementById('resp-status-2q')) document.getElementById('resp-status-2q').value = r.status_2q || 'ยังไม่คัดกรอง';

    for (let i = 1; i <= 11; i++) {
      document.getElementById(`env-q${i}`).checked = Boolean(Number(r[`q${i}`]));
    }
    recalcScore();
  } else {
    title.innerHTML = `<i class="fa-solid fa-file-medical"></i> บันทึกแบบฟอร์ม Env-As-01 ใหม่ (คัดกรองความเสี่ยงระดับบุคคล)`;
    const nextSeq = state.respondents.length + 1;
    document.getElementById('resp-id').value = `RESP-${String(nextSeq).padStart(3, '0')}`;
    document.getElementById('resp-code').value = `NM${String(nextSeq).padStart(3, '0')}`;
    if (document.getElementById('resp-survey-date')) document.getElementById('resp-survey-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('resp-lat').value = '';
    document.getElementById('resp-lng').value = '';
    if (document.getElementById('resp-exposure-years')) document.getElementById('resp-exposure-years').value = '';
    recalcScore();
  }

  modal.style.display = 'flex';
  const bodyEl = document.getElementById('resp-modal-body');
  if (bodyEl) bodyEl.scrollTop = 0;
}

function closeRespondentModal() {
  document.getElementById('respondent-modal').style.display = 'none';
}

async function handleSaveRespondent(e) {
  e.preventDefault();
  const totalScore = recalcScore();
  const riskLevel = totalScore > 20 ? 'มาก' : (totalScore >= 10 ? 'ปานกลาง' : 'ต่ำ');

  const id = document.getElementById('resp-id').value;
  const existing = state.respondents.find(item => item.id === id);
  const targetGroupVal = getSelectOrOther('resp-target-group', 'resp-target-other');
  const isTargetUrine = targetGroupVal !== 'ประชาชนทั่วไป (แท็บการตอบกลับ)';

  const expYears = document.getElementById('resp-exposure-years') ? document.getElementById('resp-exposure-years').value.trim() : '';
  const q21 = document.getElementById('resp-q2-1') ? document.getElementById('resp-q2-1').value : 'ไม่ใช่';
  const q22 = document.getElementById('resp-q2-2') ? document.getElementById('resp-q2-2').value : 'ไม่ใช่';
  let status2q = document.getElementById('resp-status-2q') ? document.getElementById('resp-status-2q').value : 'ยังไม่คัดกรอง';
  if (q21 === 'ใช่' || q22 === 'ใช่') status2q = 'พบความเสี่ยง (Positive 2Q)';

  const respObj = {
    id: id,
    seq: existing ? existing.seq : state.respondents.length + 1,
    code: document.getElementById('resp-code').value.trim(),
    is_urine_target: isTargetUrine,
    urine_seq: existing ? existing.urine_seq : (isTargetUrine ? state.respondents.filter(x => x.is_urine_target).length + 1 : null),
    source_tab: isTargetUrine ? 'รายชื่อเก็บปัสสาวะ (รายชื่อขั้น 2)' : 'การตอบกลับ (คัดกรองขั้นแรก)',
    survey_date: document.getElementById('resp-survey-date') ? document.getElementById('resp-survey-date').value : '2026-10-27',
    interviewer_name: document.getElementById('resp-interviewer') ? document.getElementById('resp-interviewer').value.trim() : 'เจ้าหน้าที่สาธารณสุข',
    health_center: getSelectOrOther('resp-hc', 'resp-hc-other'),
    well_id: document.getElementById('resp-well-id').value,
    target_group: targetGroupVal,
    cut_point: document.getElementById('resp-cut-point').value.trim(),
    full_name: document.getElementById('resp-name').value.trim(),
    age: document.getElementById('resp-age').value,
    gender: getSelectOrOther('resp-gender', 'resp-gender-other'),
    cid: document.getElementById('resp-cid').value.trim(),
    no_cid: document.getElementById('resp-no-cid') ? document.getElementById('resp-no-cid').checked : false,
    house_no: document.getElementById('resp-house').value.trim(),
    moo: document.getElementById('resp-moo').value,
    tambon: getSelectOrOther('resp-tambon', 'resp-tambon-other'),
    amphoe: 'แม่อาย',
    province: 'เชียงใหม่',
    marital_status: getSelectOrOther('resp-marital', 'resp-marital-other'),
    education: getSelectOrOther('resp-edu', 'resp-edu-other'),
    years_in_area: document.getElementById('resp-years-area').value,
    exposure_years: expYears !== '' ? Number(expYears) : '',
    risk_job_flag: document.getElementById('resp-job-flag').value,
    risk_job_type: document.getElementById('resp-job-type').value.trim(),
    job_detail: document.getElementById('resp-job-detail').value.trim(),
    job_duration: document.getElementById('resp-job-duration').value.trim(),
    job_hours: document.getElementById('resp-job-hours').value.trim(),
    swim_duration: document.getElementById('resp-swim-duration').value.trim(),
    swim_hours: document.getElementById('resp-swim-hours').value.trim(),
    disease_flag: document.getElementById('resp-disease-flag').value,
    diseases: document.getElementById('resp-diseases').value.trim(),
    symptom_flag: document.getElementById('resp-symptom-flag').value,
    symptoms: document.getElementById('resp-symptoms').value.trim(),
    q1: document.getElementById('env-q1').checked ? 1 : 0,
    q2: document.getElementById('env-q2').checked ? 1 : 0,
    q3: document.getElementById('env-q3').checked ? 1 : 0,
    q4: document.getElementById('env-q4').checked ? 1 : 0,
    q5: document.getElementById('env-q5').checked ? 1 : 0,
    q6: document.getElementById('env-q6').checked ? 1 : 0,
    q7: document.getElementById('env-q7').checked ? 1 : 0,
    q8: document.getElementById('env-q8').checked ? 1 : 0,
    q9: document.getElementById('env-q9').checked ? 1 : 0,
    q10: document.getElementById('env-q10').checked ? 1 : 0,
    q11: document.getElementById('env-q11').checked ? 1 : 0,
    total_score: totalScore,
    risk_level: riskLevel,
    q2_1: q21,
    q2_2: q22,
    status_2q: status2q,
    date_2q: existing ? existing.date_2q : '',
    assessor_2q: existing ? existing.assessor_2q : '',
    note_2q: existing ? existing.note_2q : '',
    latitude: parseFloat(document.getElementById('resp-lat').value),
    longitude: parseFloat(document.getElementById('resp-lng').value),
    updated_at: new Date().toLocaleString('th-TH'),
    updated_by: state.currentUser ? state.currentUser.displayName : 'Admin'
  };

  const idx = state.respondents.findIndex(item => item.id === id);
  if (idx >= 0) {
    state.respondents[idx] = respObj;
  } else {
    state.respondents.push(respObj);
  }

  saveLocalData();
  closeRespondentModal();
  await postToGoogleSheets({ action: 'saveRespondent', data: respObj });
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function downloadTemplateCsv(type) {
  if (type === 'wells') {
    const headers = ['well_id', 'sample_code', 'well_name', 'house_no', 'moo', 'tambon', 'well_type', 'depth_meters', 'utm_e', 'utm_n', 'latitude', 'longitude', 'distance_river_m', 'usage_type', 'user_count', 'health_center'];
    const sample1 = ['W148', 'P44', 'ศาลาหมู่บ้านตัวอย่าง', '10', '3', 'ท่าตอน', 'บ่อน้ำตื้น', '12', '538100', '2218000', '', '', '80', 'ใช้อุปโภค', '4', 'รพ.สต.บ้านท่าตอน'];
    const sample2 = ['W149', '', 'นายสมชาย ใจดี', '25', '14', 'แม่นาวาง', 'บ่อบาดาล', '45', '542500', '2216600', '', '', '220', 'ใช้อุปโภค', '2', 'รพ.สต.บ้านแม่เมืองน้อย'];
    downloadCsvFile('template_import_wells.csv', [headers.join(','), sample1.join(','), sample2.join(',')].join('\n'));
  } else if (type === 'waterlab') {
    const headers = ['well_id', 'sample_code', 'sample_date', 'lab_name', 'standard_type', 'ph', 'colour', 'turbidity', 'tds', 'hardness', 'fe', 'mn', 'cu', 'zn', 'pb', 'cr', 'cd', 'as_val', 'hg', 'so4', 'cl', 'no3', 'f', 'residual_cl', 'total_coliform', 'faecal_coliform', 'notes'];
    const sample1 = ['W001-P1', 'P1', '', 'ศูนย์วิทยาศาสตร์การแพทย์ที่ 1 เชียงใหม่', 'DOH_2543', '7.2', '5', '3.5', '280', '140', '0.18', '0.08', '0.05', '0.2', '0.002', '0.005', '0.0005', '0.004', '0.1', '45', '30', '8', '0.3', '', '0', '0', 'ตัวอย่างผลตรวจผ่านเกณฑ์ทุกพารามิเตอร์'];
    downloadCsvFile('template_import_water_lab_doh.csv', [headers.join(','), sample1.join(',')].join('\n'));
  } else if (type === 'as01') {
    const headers = ['code', 'full_name', 'age', 'gender', 'cid', 'house_no', 'moo', 'tambon', 'marital_status', 'education', 'years_in_area', 'risk_job_flag', 'risk_job_type', 'job_detail', 'job_duration', 'job_hours', 'disease_flag', 'diseases', 'symptom_flag', 'symptoms', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'target_group', 'well_id', 'survey_date', 'interviewer_name'];
    const sample1 = ['NM131', 'นายตัวอย่าง ทดสอบนำเข้า', '45', '1) ชาย', '1501000012345', '99', '5', 'ท่าตอน', '2) คู่', '2) ประถมศึกษา', '30', 'ใช่', '3) เกษตรกร', 'ทำสวนใกล้แม่น้ำกก', '10ปี', '6', 'ไม่มี', '', 'ไม่มี', '', '0', '1', '0', '0', '1', '1', '1', '0', '0', '0', '1', 'กลุ่มใหม่', 'W001-P1', '', 'เจ้าหน้าที่ รพ.สต.'];
    downloadCsvFile('template_import_env_as01.csv', [headers.join(','), sample1.join(',')].join('\n'));
  } else if (type === 'as02') {
    const headers = ['form_no', 'full_name', 'age', 'phone', 'gender', 'weight_kg', 'height_cm', 'cid', 'house_no', 'moo', 'tambon', 'within_1km_river', 'risk_job_type', 'diseases', 'herb_usage', 'smoking_status', 'alcohol_status', 'seafood_freq', 'seafood_3days', 'drink_sources', 'use_sources', 'food_rice', 'food_veg', 'eat_river_veg_weekly', 'flood_5years', 'interviewer_name', 'health_center', 'interview_date'];
    const sample1 = ['69-0050', 'นายตัวอย่าง ทดสอบนำเข้า', '45', '0812345678', '1) ชาย', '60', '165', '1501000012345', '99', '5', 'ท่าตอน', '1.ใช่', '3) เกษตรกร', 'ไม่มี', '5. ไม่ได้กิน', '1. ไม่สูบ', '1. ไม่ดื่ม', '4. เดือนละ 1-2 ครั้ง', 'ไม่ใช่', '1. บ่อน้ำตื้น (10 ปี)', '3. บ่อบาดาล (10 ปี)', '1. ปลูกเอง', '1. ปลูกเอง/หาเอง', '1.ใช่', '2.ไม่เคย', 'เจ้าหน้าที่สาธารณสุข', 'รพ.สต.บ้านท่าตอน', ''];
    downloadCsvFile('template_import_env_as02.csv', [headers.join(','), sample1.join(',')].join('\n'));
  }
}

function handleBulkImport(type) {
  const fileInputMap = {
    wells: 'import-file-wells',
    waterlab: 'import-file-waterlab',
    as01: 'import-file-as01',
    as02: 'import-file-as02'
  };
  const fileInput = document.getElementById(fileInputMap[type]);
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('กรุณาเลือกไฟล์ .CSV ที่ต้องการนำเข้าก่อนครับ');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) {
      alert('ไฟล์ CSV ไม่มีข้อมูลแถวสำหรับนำเข้า');
      return;
    }

    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 3) continue;

      if (type === 'wells') {
        const hasDepthCol = cols.length >= 16;
        const depthVal = hasDepthCol ? cols[7] : '';
        const offset = hasDepthCol ? 1 : 0;
        const utmE = parseFloat(cols[7 + offset]) || 538000;
        const utmN = parseFloat(cols[8 + offset]) || 2218000;
        let lat = parseFloat(cols[9 + offset]);
        let lng = parseFloat(cols[10 + offset]);
        if (isNaN(lat) || isNaN(lng)) {
          const conv = utm47NToLatLng(utmE, utmN);
          lat = conv.lat;
          lng = conv.lng;
        }
        const newWell = normalizeWellRecord({
          well_id: cols[0] || `W${String(state.wells.length + 1).padStart(3, '0')}`,
          seq: state.wells.length + 1,
          sample_code: cols[1] || '',
          well_name: cols[2] || 'จุดบ่อน้ำนำเข้า',
          owner_name: cols[2] || '',
          house_no: cols[3] || '',
          moo: Number(cols[4]) || 1,
          tambon: cols[5] || 'ท่าตอน',
          well_type: cols[6] || 'บ่อบาดาล',
          depth_meters: depthVal !== '' ? parseFloat(depthVal) : '',
          utm_e: utmE,
          utm_n: utmN,
          latitude: lat,
          longitude: lng,
          distance_river_m: parseFloat(cols[11 + offset]) || 100,
          usage_type: cols[12 + offset] || 'ใช้อุปโภค',
          user_count: Number(cols[13 + offset]) || 1,
          health_center: cols[14 + offset] || 'รพ.สต.บ้านท่าตอน',
          safety_status: cols[1] ? `ส่งตรวจสารปนเปื้อน (${cols[1]})` : 'สำรวจแล้ว'
        }, state.wells.length);
        state.wells.push(newWell);
        importedCount++;
      } else if (type === 'waterlab') {
        const labRec = {
          id: `WLAB-${String(state.waterLabs.length + 1).padStart(3, '0')}`,
          well_id: cols[0] || 'W001-P1',
          sample_code: cols[1] || `LAB-${state.waterLabs.length + 1}`,
          sample_date: cols[2] || new Date().toISOString().slice(0, 10),
          lab_name: cols[3] || 'ศูนย์วิทยาศาสตร์การแพทย์ที่ 1 เชียงใหม่',
          standard_type: cols[4] || 'DOH_2543',
          ph: cols[5] || '', colour: cols[6] || '', turbidity: cols[7] || '', tds: cols[8] || '',
          hardness: cols[9] || '', fe: cols[10] || '', mn: cols[11] || '', cu: cols[12] || '',
          zn: cols[13] || '', pb: cols[14] || '', cr: cols[15] || '', cd: cols[16] || '',
          as_val: cols[17] || '', hg: cols[18] || '', so4: cols[19] || '', cl: cols[20] || '',
          no3: cols[21] || '', f: cols[22] || '', residual_cl: cols[23] || '',
          total_coliform: cols[24] || '', faecal_coliform: cols[25] || '',
          notes: cols[26] || ''
        };
        const evalRes = evaluateWaterLabRecord(labRec);
        labRec.overall_status = evalRes.overallStatus;
        labRec.failed_params = evalRes.failedNames.join(', ');
        state.waterLabs.push(labRec);
        importedCount++;
      } else if (type === 'as01') {
        const qVals = [];
        for (let qIdx = 20; qIdx <= 30; qIdx++) {
          qVals.push(Number(cols[qIdx]) ? 1 : 0);
        }
        const score = qVals[0]*5 + qVals[1]*5 + qVals[2]*5 + qVals[3]*1.5 + qVals[4]*1.5 + qVals[5]*1 + qVals[6]*1 + qVals[7]*4 + qVals[8]*4 + qVals[9]*1 + qVals[10]*1.5;
        const wellId = cols[32] || (state.wells[0] ? state.wells[0].well_id : 'W001-P1');
        const wRef = state.wells.find(w => w.well_id === wellId) || state.wells[0];

        const newResp = normalizeRespondentRecord({
          id: `RESP-${String(state.respondents.length + 1).padStart(3, '0')}`,
          seq: state.respondents.length + 1,
          code: cols[0] || `NM${String(state.respondents.length + 1).padStart(3, '0')}`,
          full_name: cols[1] || '',
          age: cols[2] || '',
          gender: cols[3] || '1) ชาย',
          cid: cols[4] || '',
          house_no: cols[5] || '',
          moo: cols[6] || 1,
          tambon: cols[7] || 'ท่าตอน',
          marital_status: cols[8] || '2) คู่',
          education: cols[9] || '2) ประถมศึกษา',
          years_in_area: cols[10] || '',
          risk_job_flag: cols[11] || 'ไม่ใช่',
          risk_job_type: cols[12] || '',
          job_detail: cols[13] || '',
          job_duration: cols[14] || '',
          job_hours: cols[15] || '',
          disease_flag: cols[16] || 'ไม่มี',
          diseases: cols[17] || '',
          symptom_flag: cols[18] || 'ไม่มี',
          symptoms: cols[19] || '',
          q1: qVals[0], q2: qVals[1], q3: qVals[2], q4: qVals[3], q5: qVals[4],
          q6: qVals[5], q7: qVals[6], q8: qVals[7], q9: qVals[8], q10: qVals[9], q11: qVals[10],
          total_score: score,
          target_group: cols[31] || 'กลุ่มใหม่',
          well_id: wellId,
          survey_date: cols[33] || new Date().toISOString().slice(0, 10),
          interviewer_name: cols[34] || 'เจ้าหน้าที่สาธารณสุข',
          latitude: wRef ? wRef.latitude + 0.0002 : 20.056,
          longitude: wRef ? wRef.longitude + 0.0002 : 99.400
        }, state.respondents.length);
        state.respondents.push(newResp);
        importedCount++;
      } else if (type === 'as02') {
        state.envAs02.push({
          id: `AS02-${String(state.envAs02.length + 1).padStart(3, '0')}`,
          form_no: cols[0] || `69-${String(state.envAs02.length + 1).padStart(4, '0')}`,
          full_name: cols[1] || '',
          age: cols[2] || '',
          phone: cols[3] || '',
          gender: cols[4] || '1) ชาย',
          weight_kg: cols[5] || '',
          height_cm: cols[6] || '',
          cid: cols[7] || '',
          house_no: cols[8] || '',
          moo: cols[9] || '',
          tambon: cols[10] || 'ท่าตอน',
          within_1km_river: cols[11] || '1.ใช่',
          risk_job_type: cols[12] || '',
          diseases: cols[13] || '',
          herb_usage: cols[14] || '5. ไม่ได้กิน',
          smoking_status: cols[15] || '1. ไม่สูบ',
          alcohol_status: cols[16] || '1. ไม่ดื่ม',
          seafood_freq: cols[17] || '5. ไม่ได้กินเลย',
          seafood_3days: cols[18] || 'ไม่ใช่',
          drink_sources: cols[19] || '',
          use_sources: cols[20] || '',
          food_rice: cols[21] || '1. ปลูกเอง',
          food_veg: cols[22] || '1. ปลูกเอง/หาเอง',
          eat_river_veg_weekly: cols[23] || '2.ไม่ใช่',
          flood_5years: cols[24] || '2.ไม่เคย',
          interviewer_name: cols[25] || 'เจ้าหน้าที่สาธารณสุข',
          health_center: cols[26] || 'รพ.สต.บ้านท่าตอน',
          interview_date: cols[27] || new Date().toISOString().slice(0, 10)
        });
        importedCount++;
      }
    }

    saveLocalData();
    alert(`นำเข้าข้อมูลสำเร็จจำนวน ${importedCount} รายการ! แดชบอร์ดและแผนที่อัปเดตเรียบร้อยแล้ว`);
  };
  reader.readAsText(file, 'utf-8');
}

// ==================== GOOGLE SHEETS CLOUD SYNC & ADMIN LOCK ====================
function autoSaveGasUrlInput(val) {
  const url = (val || '').trim();
  if (url && url.startsWith('https://script.google.com/')) {
    persistGasUrlEverywhere(url);
    updateSyncBadge(true);
    logCloudMessage(`บันทึกลิงก์อัตโนมัติเรียบร้อยแล้ว: ${url}`);
  }
}

function toggleUnlockGasInput() {
  const input = document.getElementById('gas-url-input');
  const unlockBtn = document.getElementById('btn-unlock-gas');
  if (!input) return;

  if (!state.gasUnlocked) {
    if (state.currentUser && state.currentUser.role !== 'admin') {
      const pin = prompt('กรุณากรอกรหัสผ่านผู้ดูแลระบบ (Admin Password) เพื่อปลดล็อกแก้ไขลิงก์ Google Sheets:');
      if (pin !== '1234') {
        alert('รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง');
        return;
      }
    }
    state.gasUnlocked = true;
    input.readOnly = false;
    input.style.background = '#ffffff';
    input.style.cursor = 'text';
    input.focus();
    if (unlockBtn) unlockBtn.innerHTML = `<i class="fa-solid fa-lock"></i> ล็อกช่องลิงก์`;
  } else {
    state.gasUnlocked = false;
    input.readOnly = true;
    input.style.background = '#e2e8f0';
    input.style.cursor = 'not-allowed';
    if (unlockBtn) unlockBtn.innerHTML = `<i class="fa-solid fa-key"></i> ปลดล็อกแก้ไขลิงก์ (เฉพาะ Admin)`;
  }
}

function saveGasUrl() {
  const input = document.getElementById('gas-url-input');
  const url = input ? input.value.trim() : '';
  persistGasUrlEverywhere(url);
  updateSyncBadge(Boolean(url));
  logCloudMessage(`บันทึกและจำลิงก์ถาวรเรียบร้อยแล้ว: ${url || '(โหมดออฟไลน์)'}`);
  if (url && state.gasUnlocked) {
    toggleUnlockGasInput();
  }
  alert('บันทึกลิงก์ Google Sheets ไว้ในระบบถาวรเรียบร้อยแล้ว! เมื่อปิดและเปิดโปรแกรมใหม่ ระบบจะจำลิงก์นี้ให้อัตโนมัติครับ');
}

async function saveGasUrlToAppJsFile() {
  const input = document.getElementById('gas-url-input');
  const url = (input && input.value.trim()) ? input.value.trim() : state.gasUrl;
  if (!url) {
    alert('กรุณาวางลิงก์ Google Apps Script Web App URL ในช่องลิงก์ก่อนครับ');
    return;
  }
  persistGasUrlEverywhere(url);
  try {
    const res = await fetch('app.js');
    let code = await res.text();
    code = code.replace(/const DEFAULT_GAS_URL\s*=\s*'[^']*';/, `const DEFAULT_GAS_URL = '${url}';`);

    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'app.js',
        types: [{ description: 'JavaScript File', accept: { 'text/javascript': ['.js'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(code);
      await writable.close();
      alert('บันทึกฝังลิงก์ลงในไฟล์ app.js สำเร็จเรียบร้อยแล้ว! ทีนี้ไม่ว่าจะเปิดเครื่องไหนหรืออัปโหลดขึ้น GitHub ก็ไม่ต้องวางลิงก์ใหม่อีกเลยครับ');
    } else {
      const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'app.js';
      a.click();
      alert('ดาวน์โหลดไฟล์ app.js ที่ฝังลิงก์ถาวรแล้ว! นำไปวางทับไฟล์ app.js ในโฟลเดอร์โปรเจกต์ได้เลยครับ');
    }
  } catch (err) {
    alert('บันทึกลิงก์ไว้ในหน่วยความจำถาวรของเบราว์เซอร์เรียบร้อยแล้วครับ (หากต้องการให้ฝังลงไฟล์โค้ดโดยตรง สามารถส่งลิงก์ Web App URL มาในแชทเพื่อให้ระบบฝังลงไฟล์ให้ทันทีได้ครับ)');
  }
}

function updateSyncBadge(connected) {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (connected) {
    badge.className = 'badge badge-cloud';
    badge.innerHTML = `<i class="fa-solid fa-cloud-check"></i> เชื่อมต่อ Google Sheets แล้ว`;
  } else {
    badge.className = 'badge badge-local';
    badge.innerHTML = `<i class="fa-solid fa-database"></i> โหมดพร้อมใช้งาน (Local + Cloud)`;
  }
}

function logCloudMessage(msg) {
  const logEl = document.getElementById('cloud-sync-log');
  if (logEl) {
    logEl.textContent = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  }
}

function downloadCsvFile(filename, content) {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

const WATER_LAB_PARAMS = [
  { key: 'ph', seq: 1, name: 'ความเป็นกรด-ด่าง (pH)', unit: '-', whoLabel: '6.5-8.5', ruralLabel: '6.5-8.5', dohLabel: '6.5-8.5', type: 'range', WHO_1984: [6.5, 8.5], RURAL: [6.5, 8.5], DOH_2543: [6.5, 8.5], secId: 'wlab-sec-phys' },
  { key: 'colour', seq: 2, name: 'สี (Colour)', unit: 'แพลตตินัมโคบอลต์', whoLabel: '15', ruralLabel: '15', dohLabel: '15', type: 'max', WHO_1984: 15, RURAL: 15, DOH_2543: 15 },
  { key: 'turbidity', seq: 3, name: 'ความขุ่น (Turbidity)', unit: 'เอ็นทียู (NTU)', whoLabel: '5', ruralLabel: '10', dohLabel: '10', type: 'max', WHO_1984: 5, RURAL: 10, DOH_2543: 10 },
  { key: 'tds', seq: 4, name: 'ปริมาณสารละลายทั้งหมดที่เหลือจากการระเหย (TDS)', unit: 'มก./ล.', whoLabel: '1,000', ruralLabel: '1,000', dohLabel: '1,000', type: 'max', WHO_1984: 1000, RURAL: 1000, DOH_2543: 1000 },
  { key: 'hardness', seq: 5, name: 'ความกระด้าง (Hardness)', unit: 'มก./ล.', whoLabel: '500', ruralLabel: '300', dohLabel: '500', type: 'max', WHO_1984: 500, RURAL: 300, DOH_2543: 500 },
  { key: 'fe', seq: 6, name: 'เหล็ก (Fe)', unit: 'มก./ล.', whoLabel: '0.3', ruralLabel: '0.5', dohLabel: '0.5', type: 'max', WHO_1984: 0.3, RURAL: 0.5, DOH_2543: 0.5, secId: 'wlab-sec-metal' },
  { key: 'mn', seq: 7, name: 'แมงกานีส (Mn)', unit: 'มก./ล.', whoLabel: '0.1', ruralLabel: '0.3', dohLabel: '0.3', type: 'max', WHO_1984: 0.1, RURAL: 0.3, DOH_2543: 0.3 },
  { key: 'cu', seq: 8, name: 'ทองแดง (Cu)', unit: 'มก./ล.', whoLabel: '1.0', ruralLabel: '1.0', dohLabel: '1.0', type: 'max', WHO_1984: 1.0, RURAL: 1.0, DOH_2543: 1.0 },
  { key: 'zn', seq: 9, name: 'สังกะสี (Zn)', unit: 'มก./ล.', whoLabel: '5.0', ruralLabel: '5.0', dohLabel: '3.0', type: 'max', WHO_1984: 5.0, RURAL: 5.0, DOH_2543: 3.0 },
  { key: 'pb', seq: 10, name: 'ตะกั่ว (Pb)', unit: 'มก./ล.', whoLabel: '0.05', ruralLabel: '0.05', dohLabel: '0.03', type: 'max', WHO_1984: 0.05, RURAL: 0.05, DOH_2543: 0.03 },
  { key: 'cr', seq: 11, name: 'โครเมียม (Cr)', unit: 'มก./ล.', whoLabel: '0.05', ruralLabel: '0.05', dohLabel: '0.05', type: 'max', WHO_1984: 0.05, RURAL: 0.05, DOH_2543: 0.05 },
  { key: 'cd', seq: 12, name: 'แคดเมียม (Cd)', unit: 'มก./ล.', whoLabel: '0.005', ruralLabel: '0.005', dohLabel: '0.003', type: 'max', WHO_1984: 0.005, RURAL: 0.005, DOH_2543: 0.003 },
  { key: 'as_val', seq: 13, name: 'สารหนู (As) ⭐', unit: 'มก./ล.', whoLabel: '0.05', ruralLabel: '0.05', dohLabel: '0.01', type: 'max', WHO_1984: 0.05, RURAL: 0.05, DOH_2543: 0.01 },
  { key: 'hg', seq: 14, name: 'ปรอท (Hg)', unit: 'มคก./ล.', whoLabel: '1.0', ruralLabel: '1.0', dohLabel: '1.0', type: 'max', WHO_1984: 1.0, RURAL: 1.0, DOH_2543: 1.0 },
  { key: 'so4', seq: 15, name: 'ซัลเฟต (SO4 2-)', unit: 'มก./ล.', whoLabel: '400', ruralLabel: '400', dohLabel: '250', type: 'max', WHO_1984: 400, RURAL: 400, DOH_2543: 250, secId: 'wlab-sec-bact' },
  { key: 'cl', seq: 16, name: 'คลอไรด์ (Cl-)', unit: 'มก./ล.', whoLabel: '250', ruralLabel: '250', dohLabel: '250', type: 'max', WHO_1984: 250, RURAL: 250, DOH_2543: 250 },
  { key: 'no3', seq: 17, name: 'ไนเตรท (NO3- as N)', unit: 'มก./ล.', whoLabel: '10', ruralLabel: '10', dohLabel: '50', type: 'max', WHO_1984: 10, RURAL: 10, DOH_2543: 50 },
  { key: 'f', seq: 18, name: 'ฟลูออไรด์ (F-)', unit: 'มก./ล.', whoLabel: '1.5', ruralLabel: '1.0', dohLabel: '0.7', type: 'max', WHO_1984: 1.5, RURAL: 1.0, DOH_2543: 0.7 },
  { key: 'residual_cl', seq: 19, name: 'คลอรีนอิสระตกค้าง (Residual Free Chlorine)', unit: 'มก./ล.', whoLabel: '-', ruralLabel: '0.2-0.5', dohLabel: '0.2-0.5***', type: 'range_opt', WHO_1984: null, RURAL: [0.2, 0.5], DOH_2543: [0.2, 0.5] },
  { key: 'total_coliform', seq: 20, name: 'โคลิฟอร์มแบคทีเรีย (Total Coliform Bacteria)', unit: 'เอ็มพีเอ็น/100 มล.', whoLabel: '0', ruralLabel: '10', dohLabel: '0', type: 'max', WHO_1984: 0, RURAL: 10, DOH_2543: 0 },
  { key: 'faecal_coliform', seq: 21, name: 'ฟีคัลโคลิฟอร์มแบคทีเรีย (Faecal Coliform Bacteria)', unit: 'เอ็มพีเอ็น/100 มล.', whoLabel: '0', ruralLabel: '0', dohLabel: '0', type: 'max', WHO_1984: 0, RURAL: 0, DOH_2543: 0 }
];

const INITIAL_WATER_LABS = SOURCE_WATER_LABS;

const INITIAL_KNOWLEDGE_DOCS = [
  {
    id: 'DOC-001',
    title: 'แนวทางการเฝ้าระวังผลกระทบต่อสุขภาพประชาชน กรณีการปนเปื้อนสารหนูในสิ่งแวดล้อม (ฉบับสมบูรณ์ 58 หน้า)',
    category: 'แนวทางปฏิบัติ/คู่มือ',
    author: 'กองโรคจากการประกอบอาชีพและสิ่งแวดล้อม กรมควบคุมโรค (กันยายน 2569)',
    date: '2026-09-01',
    description: 'คู่มือปฏิบัติงานฉบับหลักสำหรับบุคลากรสาธารณสุข ครอบคลุมข้อมูลพิษวิทยาสารหนู การประเมินความเสี่ยง HRA (HQ & Cancer Risk) แนวทางเฝ้าระวังเชิงรับ-เชิงรุก รหัส ICD-10 (Z13.88, R82.6, T57) การสอบสวนโรค การเก็บปัสสาวะ และภาคผนวกแบบฟอร์ม Env-As-01, 02, 03 และแบบตรวจร่างกายโดยแพทย์',
    file_url: 'แนวทางการเฝ้าระวังผลกระทบต่อสุขภาพประชา.pdf',
    file_type: 'pdf',
    is_builtin: true
  },
  {
    id: 'DOC-002',
    title: 'ตารางเกณฑ์มาตรฐานคุณภาพน้ำบริโภค และน้ำประปา กรมอนามัย (21 พารามิเตอร์)',
    category: 'มาตรฐานคุณภาพน้ำ/สิ่งแวดล้อม',
    author: 'กรมอนามัย กระทรวงสาธารณสุข',
    date: '2026-05-01',
    description: 'ตารางเปรียบเทียบเกณฑ์มาตรฐานคุณภาพน้ำดื่มของ WHO (ปี 2527), เกณฑ์คุณภาพน้ำบริโภคในชนบท และเกณฑ์คุณภาพน้ำประปา กรมอนามัย (ปี 2543) ครบทั้ง 21 พารามิเตอร์ (กายภาพ เคมี โลหะหนัก สารหนู และแบคทีเรียโคลิฟอร์ม)',
    file_url: 'water-standard-doh.jpg',
    file_type: 'image',
    is_builtin: true
  },
  {
    id: 'DOC-003',
    title: 'แบบฟอร์ม Env-As-01: แบบคัดกรองและประเมินความเสี่ยงทางสุขภาพประชาชน ระดับบุคคล (ฉบับ อ.แม่อาย)',
    category: 'แบบฟอร์มคัดกรอง/สอบสวนโรค',
    author: 'กองโรคจากการประกอบอาชีพและสิ่งแวดล้อม กรมควบคุมโรค',
    date: '',
    description: 'ไฟล์ต้นฉบับ PDF แบบคัดกรองและประเมินความเสี่ยงการสัมผัสสารหนู ระดับบุคคล (ส่วนที่ 1-4 พร้อมตารางคำนวณคะแนนถ่วงน้ำหนัก 11 ข้อ คะแนนเต็ม 30.5 คะแนน)',
    file_url: 'Env-As-01_22.05.69(แม่อาย).pdf',
    file_type: 'pdf',
    is_builtin: true
  },
  {
    id: 'DOC-004',
    title: 'แบบฟอร์ม Env-As-02: แบบซักประวัติการสัมผัสสารหนูจากสิ่งแวดล้อม (ก่อนเก็บตัวอย่างชีวภาพ)',
    category: 'แบบฟอร์มคัดกรอง/สอบสวนโรค',
    author: 'กองโรคจากการประกอบอาชีพและสิ่งแวดล้อม กรมควบคุมโรค',
    date: '2026-04-29',
    description: 'ไฟล์ต้นฉบับ PDF แบบซักประวัติก่อนเก็บตัวอย่างปัสสาวะส่งตรวจทางห้องปฏิบัติการ (ปรับปรุง 29 เม.ย. 69) สำหรับประเมินแหล่งน้ำดื่ม น้ำใช้ อาหารทะเล และยาสมุนไพร',
    file_url: 'Env-As-02 (ปรับปรุง_290469).pdf',
    file_type: 'pdf',
    is_builtin: true
  }
];

function onWaterLabWellChange() {
  const wellId = document.getElementById('wlab-well-id')?.value;
  const w = state.wells.find(x => x.well_id === wellId);
  const codeInp = document.getElementById('wlab-sample-code');
  if (w && codeInp && !codeInp.value.trim()) {
    codeInp.value = w.sample_code || `LAB-${w.well_id}`;
  }
}

function openWaterLabForWell(wellId) {
  const existing = (state.waterLabs || []).find(l => l.well_id === wellId);
  if (existing) {
    openWaterLabModal(existing.id);
  } else {
    openWaterLabModal(null, wellId);
  }
}

function openWaterLabModal(labId = null, preselectWellId = null) {
  const modal = document.getElementById('water-lab-modal');
  const title = document.getElementById('water-lab-modal-title');
  document.getElementById('water-lab-form').reset();
  document.querySelectorAll('#water-lab-form .other-input-wrap').forEach(w => { w.style.display = 'none'; });
  populateWellDropdowns();

  if (labId) {
    const rec = state.waterLabs.find(x => x.id === labId);
    if (!rec) return;
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> แก้ไขผลตรวจวิเคราะห์คุณภาพน้ำ (${rec.sample_code || rec.id})`;
    document.getElementById('wlab-id').value = rec.id;
    document.getElementById('wlab-well-id').value = rec.well_id;
    document.getElementById('wlab-sample-code').value = rec.sample_code || '';
    document.getElementById('wlab-sample-date').value = rec.sample_date || new Date().toISOString().slice(0, 10);
    document.getElementById('wlab-standard-type').value = rec.standard_type || 'SOURCE_SSO';
    setSelectOrOther('wlab-lab-select', 'wlab-lab-other-wrap', 'wlab-lab-other', rec.lab_name || '');
    document.getElementById('wlab-collector').value = rec.collector || 'เจ้าหน้าที่สาธารณสุข';
    document.getElementById('wlab-notes').value = rec.notes || '';
    buildWaterLabParamsInputs(rec);
  } else {
    title.innerHTML = `<i class="fa-solid fa-flask-vial"></i> บันทึกผลตรวจวิเคราะห์คุณภาพน้ำใหม่ (ตามเกณฑ์กรมอนามัย 21 พารามิเตอร์)`;
    document.getElementById('wlab-id').value = '';
    if (preselectWellId) {
      document.getElementById('wlab-well-id').value = preselectWellId;
    }
    document.getElementById('wlab-sample-date').value = new Date().toISOString().slice(0, 10);
    onWaterLabWellChange();
    buildWaterLabParamsInputs(null);
  }

  modal.style.display = 'flex';
  const bodyEl = document.getElementById('waterlab-modal-body');
  if (bodyEl) bodyEl.scrollTop = 0;
}

function closeWaterLabModal() {
  document.getElementById('water-lab-modal').style.display = 'none';
}

async function handleSaveWaterLab(e) {
  e.preventDefault();
  const id = document.getElementById('wlab-id').value || `WLAB-${String(state.waterLabs.length + 1).padStart(3, '0')}`;
  const wellId = document.getElementById('wlab-well-id').value;

  const rec = {
    ...(state.waterLabs.find(x => x.id === id) || {}),
    id,
    well_id: wellId,
    match_status: wellId ? 'ผู้ใช้ยืนยันการจับคู่' : 'รอจับคู่ทะเบียน',
    sample_code: document.getElementById('wlab-sample-code').value.trim(),
    sample_date: document.getElementById('wlab-sample-date').value,
    standard_type: document.getElementById('wlab-standard-type').value,
    lab_name: getSelectOrOther('wlab-lab-select', 'wlab-lab-other'),
    collector: document.getElementById('wlab-collector').value.trim(),
    notes: document.getElementById('wlab-notes').value.trim(),
    updated_at: new Date().toLocaleString('th-TH')
  };

  WATER_LAB_PARAMS.forEach(p => {
    const inp = document.getElementById(`wlab-inp-${p.key}`);
    rec[p.key] = inp && inp.value.trim() !== '' ? inp.value.trim() : '';
  });

  const evalRes = evaluateWaterLabRecord(rec);
  rec.overall_status = evalRes.overallStatus;
  rec.failed_params = evalRes.failedNames.join(', ');

  const idx = state.waterLabs.findIndex(x => x.id === id);
  if (idx >= 0) state.waterLabs[idx] = rec;
  else state.waterLabs.unshift(rec);

  // อัปเดตค่าสารหนูและสถานะความปลอดภัยไปยังจุดบ่อน้ำที่เชื่อมโยงทันที
  const wIdx = state.wells.findIndex(w => w.well_id === wellId);
  if (wIdx >= 0) {
    if (rec.as_val !== '') {
      state.wells[wIdx].arsenic_level = rec.as_val;
    }
    state.wells[wIdx].safety_status = rec.overall_status === 'เกินเกณฑ์มาตรฐาน'
      ? `ผลตรวจเกินค่ามาตรฐาน (${rec.failed_params})`
      : rec.overall_status;
  }

  saveLocalData();
  closeWaterLabModal();
  await postToGoogleSheets({ action: 'saveWaterLab', data: rec });
}

async function deleteWaterLab(labId) {
  if (!confirm('ยืนยันการลบข้อมูลผลตรวจแล็บน้ำรายการนี้หรือไม่?')) return;
  state.waterLabs = state.waterLabs.filter(x => x.id !== labId);
  saveLocalData();
  await postToGoogleSheets({ action: 'deleteWaterLab', id: labId });
}

function openWaterStandardModal() {
  document.getElementById('water-std-modal').style.display = 'flex';
}

function closeWaterStandardModal() {
  document.getElementById('water-std-modal').style.display = 'none';
}

function renderKnowledgeDocs() {
  const grid = document.getElementById('kb-docs-grid');
  if (!grid) return;

  const q = (document.getElementById('kb-search')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('kb-filter-cat')?.value || 'ALL';

  const filtered = (state.knowledgeDocs || []).filter(doc => {
    if (cat !== 'ALL' && doc.category !== cat) return false;
    if (q) {
      const hay = `${doc.title} ${doc.category} ${doc.author} ${doc.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  grid.innerHTML = filtered.map(doc => {
    let iconClass = 'kb-icon-pdf';
    let iconTag = '<i class="fa-solid fa-file-pdf"></i>';
    if (doc.file_type === 'image' || /\.(jpg|jpeg|png|webp)$/i.test(doc.file_url || '')) {
      iconClass = 'kb-icon-img';
      iconTag = '<i class="fa-solid fa-file-image"></i>';
    } else if (doc.file_type === 'doc') {
      iconClass = 'kb-icon-doc';
      iconTag = '<i class="fa-solid fa-file-lines"></i>';
    }

    return `
      <div class="kb-card">
        <div>
          <div class="kb-card-top">
            <div class="kb-icon ${iconClass}">${iconTag}</div>
            <div>
              <span class="badge-pill" style="font-size:11px;">${doc.category || 'คู่มือแนวทาง'}</span>
              <h3 style="font-size:15px; margin-top:4px; line-height:1.35;">${doc.title}</h3>
            </div>
          </div>
          <p style="font-size:12.5px; color:#475569; margin-top:10px;">${doc.description || ''}</p>
          <div class="kb-meta">
            <div><i class="fa-solid fa-building-shield"></i> ${doc.author || '-'}</div>
            <div><i class="fa-regular fa-calendar"></i> วันที่อัปเดต: ${doc.date || '-'}</div>
          </div>
        </div>
        <div class="kb-actions">
          <button class="btn btn-sm btn-primary" onclick="previewKnowledgeDoc('${doc.id}')">
            <i class="fa-solid fa-book-open-reader"></i> เปิดอ่านในหน้าเว็บ
          </button>
          <a href="${doc.file_url || '#'}" target="_blank" download="${doc.file_name || ''}" class="btn btn-sm btn-outline" style="text-decoration:none;">
            <i class="fa-solid fa-download"></i> ดาวน์โหลด / เปิดแท็บใหม่
          </a>
          ${!doc.is_builtin ? `<button class="btn btn-sm btn-danger" onclick="deleteKnowledgeDoc('${doc.id}')" title="ลบเอกสาร"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function previewKnowledgeDoc(docId) {
  const doc = (state.knowledgeDocs || []).find(d => d.id === docId);
  if (!doc) return;

  const modal = document.getElementById('kb-viewer-modal');
  const titleEl = document.getElementById('kb-viewer-title');
  const bodyEl = document.getElementById('kb-viewer-body');
  const dlLink = document.getElementById('kb-viewer-download');

  titleEl.innerHTML = `<i class="fa-solid fa-book-open"></i> ${doc.title}`;
  dlLink.href = doc.file_url || '#';
  if (doc.file_name) dlLink.setAttribute('download', doc.file_name);

  const isImg = doc.file_type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(doc.file_url || '') || (doc.file_url && doc.file_url.startsWith('data:image/'));
  if (isImg) {
    bodyEl.innerHTML = `
      <div style="flex:1; overflow:auto; display:flex; align-items:center; justify-content:center; padding:20px;">
        <img src="${doc.file_url}" alt="${doc.title}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; background:#fff;" />
      </div>
    `;
  } else {
    bodyEl.innerHTML = `
      <iframe src="${doc.file_url}" style="width:100%; height:100%; border:none; flex:1; background:#fff;" title="${doc.title}"></iframe>
    `;
  }

  modal.style.display = 'flex';
}

function closeKnowledgeViewer() {
  const modal = document.getElementById('kb-viewer-modal');
  const bodyEl = document.getElementById('kb-viewer-body');
  if (bodyEl) bodyEl.innerHTML = '';
  if (modal) modal.style.display = 'none';
}

function openAddKnowledgeModal() {
  document.getElementById('kb-add-form').reset();
  document.getElementById('kb-cat-other-wrap').style.display = 'none';
  document.getElementById('kb-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('kb-add-modal').style.display = 'flex';
}

function closeAddKnowledgeModal() {
  document.getElementById('kb-add-modal').style.display = 'none';
}

async function handleSaveKnowledgeDoc(e) {
  e.preventDefault();
  const title = document.getElementById('kb-title').value.trim();
  const category = getSelectOrOther('kb-category', 'kb-cat-other');
  const author = document.getElementById('kb-author').value.trim();
  const date = document.getElementById('kb-date').value;
  const description = document.getElementById('kb-desc').value.trim();
  const fileInput = document.getElementById('kb-file-input');
  const urlInput = document.getElementById('kb-file-url').value.trim();

  let fileUrl = urlInput;
  let fileName = '';
  let fileType = 'pdf';

  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    fileName = file.name;
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) fileType = 'pdf';
    else fileType = 'doc';

    if (file.size <= 4.5 * 1024 * 1024) {
      fileUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
      });
    } else if (!fileUrl) {
      fileUrl = URL.createObjectURL(file);
      alert('หมายเหตุ: ไฟล์มีขนาดใหญ่เกิน 4.5 MB ระบบได้สร้างลิงก์เปิดดูสำหรับเซสชันนี้แล้ว หากต้องการให้เปิดได้ถาวรบน GitHub Pages แนะนำให้นำไฟล์ไปวางในโฟลเดอร์โปรเจกต์หรืออัปโหลดขึ้น Google Drive แล้ววางลิงก์ครับ');
    }
  } else if (fileUrl) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(fileUrl)) fileType = 'image';
  } else {
    alert('กรุณาเลือกไฟล์คู่มือจากเครื่อง หรือระบุชื่อไฟล์/ลิงก์เอกสารอย่างน้อย 1 ช่องครับ');
    return;
  }

  const newDoc = {
    id: `DOC-${String((state.knowledgeDocs || []).length + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`,
    title,
    category,
    author,
    date,
    description,
    file_url: fileUrl,
    file_name: fileName,
    file_type: fileType,
    is_builtin: false
  };

  state.knowledgeDocs.unshift(newDoc);
  saveLocalData();
  closeAddKnowledgeModal();
  await postToGoogleSheets({
    action: 'saveKnowledgeDoc',
    data: {
      ...newDoc,
      file_url: newDoc.file_url.startsWith('data:') ? `[ไฟล์แนบ: ${fileName}]` : newDoc.file_url
    }
  });
}

async function deleteKnowledgeDoc(docId) {
  if (!confirm('ยืนยันการลบเอกสารคู่มือรายการนี้ออกจากระบบหรือไม่?')) return;
  state.knowledgeDocs = state.knowledgeDocs.filter(d => d.id !== docId);
  saveLocalData();
  await postToGoogleSheets({ action: 'deleteKnowledgeDoc', id: docId });
}

// Source-grounded calculations, 2569 revision. Historical source rows remain separate by stage.
const DATA_VERSION = 'MAEAI_SOURCE_2569_20261029_V1';
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setText(id, value) { const el=document.getElementById(id); if(el) el.textContent=value; }
function setHtml(id, value) { const el=document.getElementById(id); if(el) el.innerHTML=value; }
function valueOrBlank(v) { return v === null || v === undefined || v === '' ? '' : v; }
function optionalNumber(v) { return v === null || v === undefined || String(v).trim()==='' || !Number.isFinite(Number(v)) ? null : Number(v); }
function distanceBand(d) { return d===null ? 'ไม่ระบุ' : d<=100 ? 'ไม่เกิน 100 เมตร' : d<=200 ? '101 - 200 เมตร' : d<=300 ? '201 - 300 เมตร' : 'มากกว่า 300 เมตร'; }
function normalizeWellRecord(w, idx) {
  const d=optionalNumber(w.distance_river_m);
  return {...w,seq:optionalNumber(w.seq)??idx+1,tambon:String(w.tambon||'').trim(),health_center:String(w.health_center||'').trim().replace(/^รพ\.สต\.ท่ามะแกง$/,'รพ.สต.บ้านท่ามะแกง'),distance_river_m:d,distance_band:distanceBand(d),user_count:optionalNumber(w.user_count),attachments:Array.isArray(w.attachments)?w.attachments:[]};
}
function normalizeRespondentRecord(r, idx) {
  return {...r,seq:optionalNumber(r.seq)??idx+1,total_score:optionalNumber(r.total_score),risk_level:r.risk_level||'ไม่ระบุ',source_tab:r.source_tab||'บันทึกเพิ่มเติมปี 69',survey_date:r.survey_date||'',health_center:r.health_center||'',q2_1:r.q2_1||'',q2_2:r.q2_2||'',status_2q:r.status_2q||'ยังไม่คัดกรอง'};
}
function hasCorruptedEncoding(arr) { return !Array.isArray(arr); }
function renderWellsTable() {
 const q=document.getElementById('well-search')?.value||'',t=document.getElementById('well-filter-tambon')?.value||'ALL',type=document.getElementById('well-filter-type')?.value||'ALL',dist=document.getElementById('well-filter-dist')?.value||'ALL',hc=document.getElementById('well-filter-hc')?.value||'ALL';
 const rows=state.wells.filter(w=>(t==='ALL'||w.tambon===t)&&(type==='ALL'||type==='SAMPLE_ONLY'&&w.sample_code||w.well_type===type)&&(dist==='ALL'||w.distance_band===dist)&&(hc==='ALL'||w.health_center===hc)&&(!q||[w.well_id,w.sample_code,w.well_name,w.owner_name,w.house_no,w.moo,w.tambon].join(' ').toLowerCase().includes(q.toLowerCase())));
 setHtml('wells-table-body',rows.map(w=>`<tr><td>${w.seq}</td><td>${esc(w.sample_code||'ไม่ระบุ')}</td><td>${esc(w.well_id)}</td><td>${esc(w.well_name)}${w.source_issues?.length?'<br><small>'+esc(w.source_issues.join('; '))+'</small>':''}</td><td>บ้าน ${esc(w.house_no||'ไม่ระบุ')} ม.${esc(w.moo)} ต.${esc(w.tambon)}</td><td>${esc(w.well_type)}${w.depth_meters?' ลึก '+esc(w.depth_meters)+' ม.':''}</td><td><a href="javascript:void(0)" onclick="focusOnMap(${Number(w.latitude)},${Number(w.longitude)})">${Number(w.latitude).toFixed(5)}, ${Number(w.longitude).toFixed(5)}</a><br><small>UTM ${esc(w.utm_e)}, ${esc(w.utm_n)}</small></td><td>${w.distance_river_m===null?'ไม่ระบุ':w.distance_river_m+' ม.'}<br><small>${esc(w.distance_band)}</small></td><td>${esc(w.usage_type||'ไม่ระบุ')}</td><td><button class="btn btn-sm btn-outline" onclick="openWellGalleryModal('${esc(w.well_id)}')">${(w.attachments||[]).length} ไฟล์</button></td><td>${w.user_count===null?'ไม่ระบุ':w.user_count+' คน'}</td><td>${esc(w.health_center||'ไม่ระบุ')}</td><td><button class="btn btn-sm btn-primary" onclick="openWellModal('${esc(w.well_id)}')">แก้ไข</button> <button class="btn btn-sm btn-outline" onclick="openWaterLabForWell('${esc(w.well_id)}')">ผลตรวจ</button> <button class="btn btn-sm btn-danger" onclick="deleteWell('${esc(w.well_id)}')">ลบ</button></td></tr>`).join('')||'<tr><td colspan="13">ไม่พบข้อมูล</td></tr>');
}
function loadLocalData() {
  state.loadWarnings=[];
  const read=(key,initial)=>{try { const raw=localStorage.getItem(key); if(raw===null) return JSON.parse(JSON.stringify(initial)); const rows=JSON.parse(raw); if(!Array.isArray(rows)) throw Error('รูปแบบข้อมูลไม่ถูกต้อง'); return rows; } catch(e) {state.loadWarnings.push(key+': '+e.message); return JSON.parse(JSON.stringify(initial));}};
  state.wells=read(STORAGE_KEY_WELLS,INITIAL_WELLS).map(normalizeWellRecord);
  state.respondents=read(STORAGE_KEY_RESPONDENTS,INITIAL_RESPONDENTS).map(normalizeRespondentRecord);
  state.envAs02=read(STORAGE_KEY_ENV_AS02,INITIAL_ENV_AS02);
  state.waterLabs=read(STORAGE_KEY_WATER_LABS,INITIAL_WATER_LABS);
  state.knowledgeDocs=read(STORAGE_KEY_KNOWLEDGE_DOCS,INITIAL_KNOWLEDGE_DOCS);
  try { const url=DEFAULT_GAS_URL||localStorage.getItem(STORAGE_KEY_GAS_URL)||localStorage.getItem(STORAGE_KEY_GAS_URL_BACKUP)||getCookieGasUrl(); if(url)applyRestoredGasUrl(url,false);else restoreGasUrlFromIndexedDB(); }catch(e) { state.loadWarnings.push(e.message); }
  state.gasUnlocked=!state.gasUrl;
}
function riskBars(rows) {
  return ['ต่ำ','ปานกลาง','มาก','ไม่ระบุ'].map((level,i)=>{const count=rows.filter(r=>(r.risk_level||'ไม่ระบุ')===level).length;if(!count&&level==='ไม่ระบุ')return '';const pct=rows.length?100*count/rows.length:0;return `<div class="bar-row"><div class="bar-label-line"><span>${level} (ตามต้นฉบับ)</span><strong>${count} รายการ (${pct.toFixed(1)}%)</strong></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${['#16a34a','#f97316','#dc2626','#64748b'][i]}"></div></div></div>`;}).join('');
}
function bars(items, denominator) {
 return items.map(([label,count,color])=>{const pct=denominator?count/denominator*100:0;return `<div class="bar-row"><div class="bar-label-line"><span>${esc(label)}</span><strong>${count} (${pct.toFixed(1)}%)</strong></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color||'#0284c7'}"></div></div></div>`;}).join('');
}
function updateKpiCards() {
 const a=state.respondents,b=state.envAs02,w=state.wells;
 setText('nav-well-count',w.length);setText('nav-resp-count',a.length);setText('nav-lab-count',state.waterLabs.length);
 setText('kpi-total-wells',w.length);setText('kpi-well-sub',`บาดาล ${w.filter(x=>x.well_type==='บ่อบาดาล').length} | น้ำตื้น ${w.filter(x=>x.well_type==='บ่อน้ำตื้น').length} | ประปาภูเขา ${w.filter(x=>x.well_type==='ประปาภูเขา').length}`);
 setText('kpi-sample-wells',w.filter(x=>x.sample_code).length);setText('kpi-near-wells',w.filter(x=>x.distance_river_m!==null&&x.distance_river_m<=100).length);
 setText('kpi-total-resp',`${a.length} / ${b.length}`);setText('kpi-tambon-sub','Env-As-01 / กลุ่มซักประวัติและเก็บปัสสาวะ (แยกขั้นตอน)');
 setText('kpi-risk-alert',a.filter(x=>['ปานกลาง','มาก'].includes(x.risk_level)).length);setText('kpi-risk-sub',['ต่ำ','ปานกลาง','มาก'].map(k=>`${k} ${a.filter(x=>x.risk_level===k).length}`).join(' | '));
 setText('dash-tab1-total',a.length);setText('dash-tab2-total',b.length);
 setText('dynamic-source-notice',`ต้นฉบับปี 2569: Env-As-01 ${a.length} รายการ → กลุ่ม Env-As-02/เก็บปัสสาวะ ${b.length} รายการ เป็นขั้นตอนติดตาม ไม่บวกเป็นจำนวนคนใหม่; ชื่อซ้ำภายในขั้นแรกเก็บตามแถวต้นฉบับเพื่อรอตรวจสอบ`);
}
function renderExecutiveDashboard() {
 const wells=state.wells,a=state.respondents,b=state.envAs02;
 setHtml('chart-well-types',bars(['บ่อน้ำตื้น','บ่อบาดาล','ประปาภูเขา'].map(k=>[k,wells.filter(x=>x.well_type===k).length]),wells.length));
 setHtml('chart-well-distance',bars(['ไม่เกิน 100 เมตร','101 - 200 เมตร','201 - 300 เมตร','มากกว่า 300 เมตร','ไม่ระบุ'].map(k=>[k,wells.filter(x=>x.distance_band===k).length]),wells.length));
 const hcs=[...new Set(wells.map(w=>w.health_center||'ไม่ระบุ'))];
 setHtml('chart-well-hc',bars(hcs.map(h=>[h,wells.filter(w=>(w.health_center||'ไม่ระบุ')===h).length]),wells.length));
 setHtml('chart-resp-tab1-risk',riskBars(a));setHtml('chart-resp-tab2-risk',riskBars(b));
 const counts=(rows)=>['ต่ำ','ปานกลาง','มาก'].map(k=>rows.filter(x=>x.risk_level===k).length);
 setHtml('dash-risk-matrix-tab1-body',['ต่ำ','ปานกลาง','มาก'].map(k=>`<tr><td>${k}</td><td>ตามต้นฉบับ</td><td>${a.filter(x=>x.risk_level===k&&x.tambon==='ท่าตอน').length}</td><td>${a.filter(x=>x.risk_level===k&&x.tambon==='แม่นาวาง').length}</td><td>${a.filter(x=>x.risk_level===k).length}</td><td>ติดตามตามผลประเมินต้นฉบับ</td></tr>`).join(''));
 setHtml('dash-pivot-tab2-body',['ต่ำ','ปานกลาง','มาก'].map(k=>`<tr><td>ความเสี่ยง${k} (ตามชีทเก็บเชียงใหม่ 69)</td><td>${b.filter(x=>x.risk_level===k&&x.tambon==='ท่าตอน').length}</td><td>${b.filter(x=>x.risk_level===k&&x.tambon==='แม่นาวาง').length}</td><td>${b.filter(x=>x.risk_level===k).length}</td></tr>`).join('')+`<tr><td>รวมขั้นตอน 2 (ยังไม่มีรายละเอียดแบบซักประวัติในต้นฉบับ)</td><td colspan="3">${b.length} รายการ</td></tr>`);
 const areas=[...new Set([...a,...b].map(x=>x.tambon))];
 setHtml('dash-resp-by-tambon-body',areas.map(t=>{const aa=a.filter(x=>x.tambon===t),bb=b.filter(x=>x.tambon===t);return `<tr><td>${esc(t)}</td>${[aa.length,...counts(aa),bb.length,...counts(bb)].map(v=>`<td>${v}</td>`).join('')}</tr>`;}).join(''));
 setHtml('dash-resp-by-hc-body',`<tr><td>ไม่ระบุ รพ.สต. ในชีทประเมิน/เก็บ</td><td>ไม่อนุมานจากหมู่</td><td>${a.length}</td>${counts(a).map(v=>`<td>${v}</td>`).join('')}<td>${b.length}</td>${counts(b).map(v=>`<td>${v}</td>`).join('')}</tr>`);
 const keys=[...new Set([...a,...b].map(x=>x.tambon+'|'+x.moo))].sort();
 setHtml('dash-resp-by-moo-body',keys.map(k=>{const aa=a.filter(x=>x.tambon+'|'+x.moo===k),bb=b.filter(x=>x.tambon+'|'+x.moo===k);const [t,m]=k.split('|');return `<tr><td>${esc(t)}</td><td>${esc(m)}</td><td>ไม่ระบุ</td>${[aa.length,...counts(aa),bb.length,...counts(bb)].map(v=>`<td>${v}</td>`).join('')}<td>ไม่มีข้อมูลระยะสัมผัส</td></tr>`;}).join(''));
 const wk=[...new Set(wells.map(x=>x.tambon+'|'+x.moo))].sort();
 setHtml('dash-moo-breakdown-body',wk.map(k=>{const group=wells.filter(x=>x.tambon+'|'+x.moo===k),known=group.filter(x=>x.user_count!==null),sum=known.reduce((v,x)=>v+x.user_count,0);const [t,m]=k.split('|');return `<tr><td>${esc(t)}</td><td>${esc(m)}</td>${['บ่อน้ำตื้น','บ่อบาดาล','ประปาภูเขา'].map(type=>`<td>${group.filter(x=>x.well_type===type).length}</td>`).join('')}<td>${group.length}</td><td>${group.filter(x=>x.sample_code).length}</td><td>${sum} คน (ระบุ ${known.length}/${group.length} แห่ง)</td></tr>`;}).join(''));
 const screened=a.filter(x=>x.status_2q&&x.status_2q!=='ยังไม่คัดกรอง');
 setHtml('chart-2q-overview',bars([['ยังไม่คัดกรอง',a.length-screened.length,'#64748b'],['มีผลบันทึก',screened.length,'#0284c7']],a.length));
 setHtml('dash-2q-hc-body',`<tr><td>ไม่ระบุ</td><td>${a.length}</td><td>${screened.length}</td><td>${a.filter(x=>String(x.status_2q).includes('ปกติ')).length}</td><td>${a.filter(x=>String(x.status_2q).includes('Positive')).length}</td><td>${a.length-screened.length}</td></tr>`);
}
function renderScreeningDashboardAndTables() {
 setText('scr-as01-count',state.respondents.length);setText('scr-as02-count',state.envAs02.length);
 setHtml('scr-chart-as01-risk',riskBars(state.respondents));
 setHtml('scr-chart-as01-questions','<p class="data-note">ต้นฉบับเป็นชีทสรุปคะแนน ไม่มีคำตอบรายข้อ จึงยังไม่สรุปพฤติกรรมเสี่ยงรายข้อ</p>');
 setHtml('scr-chart-as02-summary',riskBars(state.envAs02)+`<p class="data-note">มีรายละเอียดแบบซักประวัติที่บันทึกเพิ่มเติม ${state.envAs02.filter(x=>x.history_complete).length} รายการ; ข้อมูลที่ไม่มีไม่เติมเอง</p>`);
 setHtml('scr-chart-2q-summary','<p class="data-note">แสดงผล 2Q เฉพาะที่บันทึกเพิ่มเติม ต้นฉบับไม่มีคำตอบ 2Q</p>');
 renderScreeningAs01Table();renderScreeningAs02Table();renderScreening2QTable();
}
function sourceStageRows(mode) {
 return mode==='TARGET_90'||mode==='TARGET_130' ? state.envAs02 : state.respondents;
}
function sourceSearch(rows,q) { return rows.filter(r=>!q||[r.code,r.full_name,r.tambon,r.moo,r.source_tab,r.health_center].join(' ').toLowerCase().includes(q.toLowerCase())); }
function renderScreeningAs01Table() {
 const mode=document.getElementById('scr-as01-tab')?.value||'ALL',risk=document.getElementById('scr-as01-risk')?.value||'ALL';
 const rows=sourceSearch(sourceStageRows(mode),document.getElementById('scr-as01-search')?.value||'').filter(r=>risk==='ALL'||r.risk_level===risk);
 setHtml('scr-as01-tbody',rows.map(r=>`<tr><td>${esc(r.code)}<br><small>${esc(r.source_tab)}</small></td><td>${esc(r.survey_date||'ไม่ระบุ')}</td><td>${esc(r.full_name)}${r.same_name_candidates?.length?'<br><small>มีชื่อที่อาจตรงกันในต้นฉบับ</small>':''}</td><td>${esc(r.age||'ไม่ระบุ')} / ${esc(r.gender||'ไม่ระบุ')}</td><td>ม.${esc(r.moo)} ต.${esc(r.tambon)}</td><td>${esc(r.exposure_years||'ไม่ระบุ')}</td><td>${esc(r.risk_job_type||'ไม่ระบุ')}</td><td>${esc(r.diseases||'ไม่ระบุ')}</td><td>${r.total_score??'ไม่ระบุ'}</td><td>${esc(r.risk_level)}</td><td>${esc(r.status_2q||'ยังไม่คัดกรอง')}</td><td><button class="btn btn-sm btn-primary" onclick="${mode==='TARGET_90'?'openEnvAs02Modal':'openRespondentModal'}('${esc(r.id)}')">แก้ไข</button></td></tr>`).join('')||'<tr><td colspan="12">ไม่พบข้อมูล</td></tr>');
}
function renderScreeningAs02Table() {
 const rows=sourceSearch(state.envAs02,document.getElementById('scr-as02-search')?.value||'');
 setHtml('scr-as02-tbody',rows.map(r=>`<tr><td>${esc(r.code||r.form_no||r.id)}</td><td>${esc(r.interview_date||'ไม่ระบุ')}</td><td>${esc(r.full_name)}</td><td>${esc(r.age||'ไม่ระบุ')} / ${esc(r.gender||'ไม่ระบุ')}<br>นน. ${esc(valueOrBlank(r.weight_kg)||'ไม่ระบุ')} / สส. ${esc(valueOrBlank(r.height_cm)||'ไม่ระบุ')}</td><td>${esc(r.phone||'ไม่ระบุ')}</td><td>ม.${esc(r.moo)} ต.${esc(r.tambon)}</td><td>${esc(r.exposure_years||'ไม่ระบุ')}</td><td>${esc([r.herb_usage,r.smoking_status,r.alcohol_status].filter(Boolean).join(' / ')||'ไม่ระบุ')}</td><td>${esc(r.seafood_3days||'ไม่ระบุ')}</td><td>${esc(r.drink_sources||'ไม่ระบุ')}</td><td>${esc(r.use_sources||'ไม่ระบุ')}</td><td>คะแนน ${r.total_score??'ไม่ระบุ'} (${esc(r.risk_level||'ไม่ระบุ')})<br>${esc(r.respondent_id?'เชื่อมขั้นแรกแล้ว':r.link_status||'ยังไม่เชื่อมขั้นแรก')}</td><td>${r.history_complete?'บันทึกประวัติเพิ่มแล้ว':'มีรายชื่อ; รายละเอียดประวัติยังไม่บันทึก'}</td><td><button class="btn btn-sm btn-primary" onclick="openEnvAs02Modal('${esc(r.id)}')">แก้ไข/เชื่อมรายชื่อ</button></td></tr>`).join('')||'<tr><td colspan="14">ไม่พบข้อมูล</td></tr>');
}
function renderScreening2QTable() {
 const mode=document.getElementById('scr-2q-tab')?.value||'ALL',status=document.getElementById('scr-2q-status')?.value||'ALL',q=document.getElementById('scr-2q-search')?.value||'';
 const rows=sourceSearch(sourceStageRows(mode),q).filter(r=>status==='ALL'||r.status_2q===status||status==='POSITIVE'&&String(r.status_2q).includes('Positive')||status==='NEGATIVE'&&String(r.status_2q).includes('ปกติ')||status==='WAIT'&&r.status_2q==='ยังไม่คัดกรอง');
 setHtml('scr-2q-tbody',rows.map(r=>`<tr><td>${esc(r.code)}<br>${esc(r.source_tab)}</td><td>${esc(r.full_name)}</td><td>${esc(r.age||'ไม่ระบุ')} / ${esc(r.gender||'ไม่ระบุ')}</td><td>ม.${esc(r.moo)} ต.${esc(r.tambon)}</td><td>${esc(r.risk_level)}</td><td>${esc(r.q2_1||'ยังไม่บันทึก')}</td><td>${esc(r.q2_2||'ยังไม่บันทึก')}</td><td>${esc(r.status_2q||'ยังไม่คัดกรอง')}</td><td>${esc(r.date_2q||'ไม่ระบุ')}</td><td><button class="btn btn-sm btn-primary" onclick="${mode==='TARGET_90'?'open2QModalForAs02':'open2QModal'}('${esc(r.id)}')">บันทึก 2Q</button></td></tr>`).join('')||'<tr><td colspan="10">ไม่พบข้อมูล</td></tr>');
}
function syncCoordinatesFromSelectedWell() {
 // A water-use link does not establish a person's residence coordinate. Keep explicit GPS unchanged.
}
function open2QModalForAs02(id) {
 const r=state.envAs02.find(x=>x.id===id);if(!r)return;
 if(!r.respondent_id){alert('ยังไม่มีการยืนยันรายชื่อกับขั้นแรก กรุณาตรวจและเชื่อมรายชื่อก่อนบันทึกผล 2Q ร่วมกัน');showSourceEditor(id,2);return;}
 open2QModal(r.respondent_id);
}
function export2QCsv() {
 csvFile('2Q_recorded_2569.csv',['รหัส','ชื่อ','ข้อ 1','ข้อ 2','ผล 2Q','วันที่','ผู้ประเมิน'],state.respondents.map(r=>[r.code,r.full_name,r.q2_1,r.q2_2,r.status_2q,r.date_2q,r.assessor_2q]));
}
function renderRespondentsTable() {
 const rows=sourceSearch(sourceStageRows(document.getElementById('resp-filter-tab')?.value||'ALL'),document.getElementById('resp-search')?.value||'').filter(r=>{
  const t=document.getElementById('resp-filter-tambon')?.value||'ALL',risk=document.getElementById('resp-filter-risk')?.value||'ALL',well=document.getElementById('resp-filter-well')?.value||'ALL',hc=document.getElementById('resp-filter-hc')?.value||'ALL';return (t==='ALL'||r.tambon===t)&&(risk==='ALL'||r.risk_level===risk||risk==='ปานกลาง-มาก'&&['ปานกลาง','มาก'].includes(r.risk_level))&&(well==='ALL'||r.well_id===well)&&(hc==='ALL'||r.health_center===hc);
 });
 setHtml('respondents-table-body',rows.map(r=>`<tr><td>${r.seq}</td><td>${esc(r.code)}</td><td>${esc(r.full_name)}</td><td>${esc(r.age||'ไม่ระบุ')}</td><td>ม.${esc(r.moo)} ต.${esc(r.tambon)}</td><td>${esc(r.health_center||'ไม่ระบุ')}</td><td>${esc(r.well_id||'ยังไม่เชื่อมบ่อ')}</td><td>${r.total_score??'ไม่ระบุ'}</td><td>${esc(r.risk_level)}</td><td>${esc(r.source_tab)}</td><td>${esc(r.status_2q||'ยังไม่คัดกรอง')}</td><td><button class="btn btn-sm btn-primary" onclick="${r.dataset==='collection69'?'openEnvAs02Modal':'openRespondentModal'}('${esc(r.id)}')">แก้ไข</button></td></tr>`).join('')||'<tr><td colspan="12">ไม่พบข้อมูล</td></tr>');
}
function renderPivotSummary() {
 setHtml('pivot-summary-body',[['Env-As-01 ประเมินเชียงใหม่ 69',state.respondents],['Env-As-02 / เก็บเชียงใหม่ 69',state.envAs02]].map(([name,rows])=>`<tr><td>${esc(name)}</td><td>${rows.filter(x=>x.tambon==='ท่าตอน').length}</td><td>${rows.filter(x=>x.tambon==='แม่นาวาง').length}</td><td>${rows.length}</td></tr>`).join(''));
}
function showSourceEditor(id,stage) {
 const rows=stage===2?state.envAs02:state.respondents,r=rows.find(x=>x.id===id);if(!r)return;
 let modal=document.getElementById('source-record-modal');if(!modal){modal=document.createElement('div');modal.id='source-record-modal';modal.className='modal-backdrop';document.body.appendChild(modal);}
 modal.style.display='flex';modal.innerHTML=`<div class="modal-dialog"><div class="modal-header"><h3>แก้ไขทะเบียนขั้น ${stage}: ${esc(r.code)}</h3><button type="button" class="btn-close" onclick="document.getElementById('source-record-modal').style.display='none'">×</button></div><form onsubmit="saveSourceEditor(event,'${esc(id)}',${stage})"><div class="modal-body"><p class="data-note">ค่าตามชีท ${esc(r.source_tab)} แถว ${r.source?.row||'-'}; ชื่อซ้ำข้ามขั้นตอนเป็นการติดตาม ไม่ลบรายการอัตโนมัติ</p><div class="form-group"><label>ชื่อ–นามสกุล</label><input id="source-edit-name" required value="${esc(r.full_name)}"></div><div class="form-grid-2"><div class="form-group"><label>หมู่</label><input id="source-edit-moo" type="number" value="${esc(r.moo)}"></div><div class="form-group"><label>ตำบล</label><input id="source-edit-tambon" value="${esc(r.tambon)}"></div><div class="form-group"><label>คะแนนรวมตามต้นฉบับ</label><input id="source-edit-score" type="number" step="any" value="${esc(r.total_score)}"></div><div class="form-group"><label>ระดับความเสี่ยงตามต้นฉบับ</label><select id="source-edit-risk">${['ต่ำ','ปานกลาง','มาก','ไม่ระบุ'].map(v=>`<option ${v===r.risk_level?'selected':''}>${v}</option>`).join('')}</select></div></div>${stage===2?`<div class="form-group"><label>ยืนยันการเชื่อมกับผลคัดกรองขั้นแรก (ตรวจบุคคลก่อนเลือก)</label><select id="source-edit-link"><option value="">ยังไม่ยืนยันการจับคู่</option>${state.respondents.map(a=>`<option value="${esc(a.id)}" ${r.respondent_id===a.id?'selected':''}>${esc(a.code+' '+a.full_name+' ม.'+a.moo+' ต.'+a.tambon)}${r.candidate_respondent_ids?.includes(a.id)?' — ชื่อ/พื้นที่ตรงกัน':''}</option>`).join('')}</select></div><p>คะแนนของสองขั้นตอนเก็บแยกกัน ไม่เขียนทับกัน</p>`:''}</div><div class="modal-footer"><button class="btn btn-primary" type="submit">บันทึก</button>${stage===2?`<button class="btn btn-outline" type="button" onclick="document.getElementById('source-record-modal').style.display='none';openDetailedEnvAs02('${esc(id)}')">เพิ่ม/แก้รายละเอียดซักประวัติ</button>`:''}</div></form></div>`;
}
function saveSourceEditor(e,id,stage) {
 e.preventDefault();const rows=stage===2?state.envAs02:state.respondents,r=rows.find(x=>x.id===id);if(!r)return;
 r.full_name=document.getElementById('source-edit-name').value.trim();r.moo=optionalNumber(document.getElementById('source-edit-moo').value);r.tambon=document.getElementById('source-edit-tambon').value.trim();r.total_score=optionalNumber(document.getElementById('source-edit-score').value);r.risk_level=document.getElementById('source-edit-risk').value;
 if(stage===2){r.respondent_id=document.getElementById('source-edit-link').value;r.link_status=r.respondent_id?'ผู้ใช้ยืนยันการจับคู่':'ยังไม่ยืนยันการจับคู่';}
 r.updated_at=new Date().toISOString();saveLocalData();document.getElementById('source-record-modal').style.display='none';
}
function parseReportedValue(raw) {
 const s=String(raw??'').trim();if(!s)return {type:'missing'};
 if(/^(ND|Not\s*Detected|ไม่พบ.*)$/i.test(s))return {type:'nd'};
 const m=s.match(/^(<=|>=|<|>|≤|≥)?\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);if(!m)return {type:'invalid'};
 return {type:m[1]?'bound':'number',op:m[1]||'=',value:Number(m[2])};
}
function checkSingleParam(paramDef,rawVal,stdType) {
 const v=parseReportedValue(rawVal);if(v.type==='missing')return {status:'NA',label:'ไม่มีผลตรวจ'};
 if(v.type==='nd')return {status:'UNKNOWN',label:'ไม่พบตามรายงาน; ไม่ระบุขีดจำกัดการตรวจ'};
 if(v.type==='invalid')return {status:'UNKNOWN',label:'รูปแบบผลตรวจรอตรวจสอบ'};
 const threshold=stdType==='SOURCE_SSO'?({as_val:0.01,cd:0.003,pb:0.01,hg:0.001}[paramDef?.key]):paramDef?.[stdType||'DOH_2543'];
 if(threshold===null||threshold===undefined)return {status:'UNKNOWN',label:'ไม่มีเกณฑ์เปรียบเทียบในชุดนี้'};
 let status='UNKNOWN';
 if(Array.isArray(threshold)){if(v.type==='number')status=v.value>=threshold[0]&&v.value<=threshold[1]?'PASS':'FAIL';}
 else if(v.type==='number')status=v.value<=threshold?'PASS':'FAIL';
 else if(['<','<=','≤'].includes(v.op)&&v.value<=threshold)status='PASS';
 else if((v.op==='>'&&v.value>=threshold)||(['>=','≥'].includes(v.op)&&v.value>threshold))status='FAIL';
 return {status,label:status==='PASS'?'ไม่เกินเกณฑ์ที่เลือก':status==='FAIL'?'เกินเกณฑ์ที่เลือก':'ยังประเมินไม่ได้จากขอบเขตที่รายงาน'};
}
function evaluateWaterLabRecord(rec) {
 let testedCount=0,unknownCount=0,passCount=0;const failedNames=[];
 WATER_LAB_PARAMS.forEach(p=>{const out=checkSingleParam(p,rec[p.key],rec.standard_type||'DOH_2543');if(out.status!=='NA')testedCount++;if(out.status==='UNKNOWN')unknownCount++;if(out.status==='PASS')passCount++;if(out.status==='FAIL')failedNames.push(p.name);});
 const overallStatus=failedNames.length?'เกินเกณฑ์มาตรฐาน':testedCount===0?'ไม่มีผลตรวจ':unknownCount?'ยังสรุปไม่ได้ (มีผล ND/ข้อมูลไม่ครบ)':'ไม่เกินเกณฑ์เฉพาะรายการที่ประเมินได้';
 return {testedCount,unknownCount,passCount,failedNames,overallStatus};
}
function buildWaterLabParamsInputs(existingRecord=null) {
 const std=document.getElementById('wlab-standard-type')?.value||'SOURCE_SSO';
 const keys=std==='SOURCE_SSO'?['as_val','cd','pb','hg']:WATER_LAB_PARAMS.map(x=>x.key);
 setHtml('wlab-params-tbody',WATER_LAB_PARAMS.filter(p=>keys.includes(p.key)).map(p=>`<tr><td>${p.seq}</td><td>${esc(p.name)}</td><td>${std==='SOURCE_SSO'?'mg/kg (ตามชีท)':esc(p.unit)}</td><td>${std==='SOURCE_SSO'?'—':esc(p.whoLabel)}</td><td>${std==='SOURCE_SSO'?'—':esc(p.ruralLabel)}</td><td>${std==='SOURCE_SSO'?esc({as_val:'0.01',cd:'0.003',pb:'0.01',hg:'0.001'}[p.key]):esc(p.dohLabel)}</td><td><input type="text" class="lab-param-input" id="wlab-inp-${p.key}" value="${esc(existingRecord?.[p.key]??'')}" placeholder="เช่น ND, Not Detected, &lt;0.005, 0.001" oninput="evaluateAllWaterLabInputs()"></td><td id="wlab-badge-${p.key}"></td></tr>`).join(''));
 evaluateAllWaterLabInputs();
}
function evaluateAllWaterLabInputs() {
 const rec={standard_type:document.getElementById('wlab-standard-type')?.value||'SOURCE_SSO'};
 WATER_LAB_PARAMS.forEach(p=>{const inp=document.getElementById('wlab-inp-'+p.key);if(!inp)return;rec[p.key]=inp.value;const result=checkSingleParam(p,inp.value,rec.standard_type);setText('wlab-badge-'+p.key,result.label);});
 const e=evaluateWaterLabRecord(rec);setText('wlab-live-summary',`มีผล ${e.testedCount} รายการ | เกินเกณฑ์ ${e.failedNames.length} | ยังประเมินไม่ได้ ${e.unknownCount}`);setText('wlab-live-badge',e.overallStatus);
}
function saveLocalData() {
 try {localStorage.setItem(STORAGE_KEY_WELLS,JSON.stringify(state.wells));localStorage.setItem(STORAGE_KEY_RESPONDENTS,JSON.stringify(state.respondents));localStorage.setItem(STORAGE_KEY_ENV_AS02,JSON.stringify(state.envAs02));localStorage.setItem(STORAGE_KEY_WATER_LABS,JSON.stringify(state.waterLabs));localStorage.setItem(STORAGE_KEY_KNOWLEDGE_DOCS,JSON.stringify(state.knowledgeDocs));}catch(e){alert('บันทึกในเครื่องไม่สำเร็จ: '+e.message+' กรุณาส่งออกข้อมูลสำรองก่อนปิดหน้า');}
 refreshAllViews();
}
async function deleteWell(id) {
 const count=state.waterLabs.filter(r=>r.well_id===id).length;
 if(!confirm(`ลบทะเบียน ${id}? ผลตรวจที่เชื่อม ${count} รายการจะยังอยู่และเปลี่ยนเป็นรอจับคู่`))return;
 state.wells=state.wells.filter(w=>w.well_id!==id);
 state.waterLabs.forEach(r=>{if(r.well_id===id){r.well_id='';r.match_status='ทะเบียนบ่อถูกลบ รอจับคู่ใหม่';}});
 state.respondents.forEach(r=>{if(r.well_id===id)r.well_id='';});state.envAs02.forEach(r=>{if(r.well_id===id)r.well_id='';});saveLocalData();
}
async function deleteRespondent(id) {
 if(!confirm('ลบรายการขั้นแรกนี้? ผลติดตามขั้นสองจะยังอยู่และยกเลิกเฉพาะลิงก์ที่ยืนยันไว้'))return;
 state.respondents=state.respondents.filter(r=>r.id!==id);state.envAs02.forEach(r=>{if(r.respondent_id===id){r.respondent_id='';r.link_status='รายการขั้นแรกถูกลบ รอจับคู่ใหม่';}});saveLocalData();
}
function renderWaterLabDashboardAndTable() {
 const labs=state.waterLabs||[];labs.forEach(r=>{const e=evaluateWaterLabRecord(r);r.overall_status=e.overallStatus;r.failed_params=e.failedNames.join(', ');});
 const statuses=[...new Set(labs.map(r=>r.overall_status))];
 setHtml('chart-waterlab-status',bars(statuses.map(s=>[s,labs.filter(r=>r.overall_status===s).length,s==='เกินเกณฑ์มาตรฐาน'?'#dc2626':'#64748b']),labs.length));
 const rounds=[...new Set(labs.map(r=>r.sample_date))].sort();
 setHtml('chart-waterlab-params',bars(rounds.map(d=>[d+' (รอบตรวจ)',labs.filter(r=>r.sample_date===d).length]),labs.length)+`<p class="data-note">${labs.length} ตัวอย่างใน ${rounds.length} รอบ ไม่ใช่จำนวนบ่อไม่ซ้ำ; จับคู่ทะเบียนได้ ${labs.filter(r=>r.well_id).length} ตัวอย่าง / รอตรวจสอบ ${labs.filter(r=>!r.well_id).length} ตัวอย่าง<br>เทียบเกณฑ์ตามชีทต้นฉบับ หน่วย mg/kg; ไม่ใช่การรับรองน้ำดื่ม</p>`);
 renderWaterLabTable();
}
function renderWaterLabTable() {
 const q=document.getElementById('waterlab-search')?.value||'',well=document.getElementById('waterlab-filter-well')?.value||'ALL',result=document.getElementById('waterlab-filter-result')?.value||'ALL',std=document.getElementById('waterlab-filter-std')?.value||'ALL';
 const rows=state.waterLabs.filter(r=>(well==='ALL'||well==='UNMATCHED'&&!r.well_id||r.well_id===well)&&(result==='ALL'||r.overall_status===result)&&(std==='ALL'||r.standard_type===std)&&(!q||[r.point_name,r.sample_date,r.sample_code,r.well_id,r.notes].join(' ').toLowerCase().includes(q.toLowerCase())));
 const fmt=(r,k)=>{const v=r[k];return v===null||v===undefined||v===''?'ไม่ระบุ':esc(v);};
 setHtml('waterlab-table-body',rows.map(r=>{const w=state.wells.find(w=>w.well_id===r.well_id),e=evaluateWaterLabRecord(r);return `<tr><td>${esc(r.sample_code)}</td><td>${esc(r.sample_date)}<br><small>ต้นฉบับ ${esc(r.source_date||'')}</small></td><td>${esc(r.point_name||w?.well_name||'ไม่ระบุ')}<br><b>${esc(r.well_id||'รอจับคู่ทะเบียน')}</b><br><small>${esc(r.match_status||'')}</small></td><td>ม.${esc(r.moo??w?.moo)} ต.${esc(r.tambon||w?.tambon)}</td><td>${fmt(r,'as_val')}</td><td>${r.standard_type==='SOURCE_SSO'?'ไม่มีผลในชีทต้นฉบับ':fmt(r,'ph')+' / '+fmt(r,'turbidity')+' / '+fmt(r,'tds')}</td><td>${fmt(r,'fe')} / ${fmt(r,'mn')}</td><td>Pb ${fmt(r,'pb')}<br>Cd ${fmt(r,'cd')}<br>Hg ${fmt(r,'hg')}</td><td>${fmt(r,'total_coliform')} / ${fmt(r,'faecal_coliform')}</td><td>${e.testedCount} รายการ<br>${esc(r.source_unit||'ตามพารามิเตอร์')}<br><small>${esc(r.source?.sheet||'บันทึกเพิ่มเติม')} แถว ${r.source?.row||'-'}</small></td><td>${esc(e.overallStatus)}<br><small>ND ไม่ใช่ศูนย์; ประเมินเฉพาะรายการที่มีข้อมูล</small></td><td><button class="btn btn-sm btn-primary" onclick="openWaterLabModal('${esc(r.id)}')">แก้ไข/จับคู่</button></td></tr>`;}).join('')||'<tr><td colspan="12">ไม่พบข้อมูล</td></tr>');
}
function csvFile(filename,headers,rows) {
 const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';downloadCsvFile(filename,[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n'));
}
function exportRespondentsCsv() {
 csvFile('Env_As_01_2569.csv',['รหัส','ชื่อ','หมู่','ตำบล','คะแนน','ความเสี่ยง','ชีทต้นฉบับ','แถวต้นฉบับ','มีรายชื่อที่อาจตรงกันในขั้น 2','วันที่สำรวจ','พิกัดละติจูด','พิกัดลองจิจูด'],state.respondents.map(r=>[r.code,r.full_name,r.moo,r.tambon,r.total_score,r.risk_level,r.source_tab,r.source?.row,(r.as02_candidate_ids||[]).join(';'),r.survey_date,r.latitude,r.longitude]));
}
function exportEnvAs02Csv() {
 csvFile('Env_As_02_collection_2569.csv',['Lab Code','ชื่อ','หมู่','ตำบล','คะแนนตามชีทขั้น 2','ความเสี่ยง','ชีทต้นฉบับ','แถว','เชื่อมขั้นแรกที่ยืนยัน','รายชื่อที่อาจตรงกันขั้นแรก','สถานะรายละเอียดประวัติ','เบอร์โทร','น้ำหนัก','ส่วนสูง'],state.envAs02.map(r=>[r.code,r.full_name,r.moo,r.tambon,r.total_score,r.risk_level,r.source_tab,r.source?.row,r.respondent_id,(r.candidate_respondent_ids||[]).join(';'),r.history_complete?'บันทึกประวัติเพิ่มแล้ว':'ยังไม่มีรายละเอียด',r.phone,r.weight_kg,r.height_cm]));
}
function exportWellsCsv() {
 csvFile('water_wells_source_2569.csv',['รหัสบ่อ','ลำดับ','รหัสตัวอย่างตามทะเบียน','ชื่อ','บ้านเลขที่','บ้านเลขที่ดิบในต้นฉบับ','หมู่','ตำบล','ประเภท','UTM E','UTM N','Latitude','Longitude','สมมติฐานพิกัด','ระยะจากแม่น้ำ','จำนวนผู้ใช้ที่ระบุ','รพ.สต.','ข้อควรตรวจสอบ'],state.wells.map(w=>[w.well_id,w.seq,w.sample_code,w.owner_name,w.house_no,w.house_no_source,w.moo,w.tambon,w.well_type,w.utm_e,w.utm_n,w.latitude,w.longitude,w.coordinate_basis,w.distance_river_m,w.user_count,w.health_center,w.notes]));
}
function exportWaterLabCsv() {
 csvFile('community_water_labs_SSO_2569.csv',['รหัสตัวอย่างระบบ','วันที่','วันที่ตามต้นฉบับ','ชื่อจุด','รหัสบ่อที่เชื่อม','สถานะจับคู่','หน่วยตามต้นฉบับ','As','Cd','Pb','Hg','สรุปตามข้อมูลที่ประเมินได้','แหล่งที่มา','แถว','หมายเหตุ'],state.waterLabs.map(r=>[r.sample_code,r.sample_date,r.source_date,r.point_name,r.well_id,r.match_status,r.source_unit,r.as_val,r.cd,r.pb,r.hg,evaluateWaterLabRecord(r).overallStatus,r.source?.sheet,r.source?.row,r.notes]));
}
function downloadFullBackupJson() {
 const localCopies={};try{Object.keys(localStorage).filter(k=>/ARSENIC_GIS|MAEAI_KOK/.test(k)).forEach(k=>localCopies[k]=localStorage.getItem(k));}catch(e){}
 downloadCsvFile('maeai_2569_full_backup.json',JSON.stringify({data_version:DATA_VERSION,source_metadata:SOURCE_METADATA,wells:state.wells,respondents:state.respondents,envAs02:state.envAs02,waterLabs:state.waterLabs,knowledgeDocs:state.knowledgeDocs,localCopies},null,2));
}
function resetToSeedData() {
 if(!confirm('คืนข้อมูลรุ่นแก้ไขจากต้นฉบับปี 69? ระบบจะดาวน์โหลดสำรองข้อมูลปัจจุบันก่อน และไม่ลบข้อมูลแคชรุ่นเดิม'))return;
 downloadFullBackupJson();state.wells=JSON.parse(JSON.stringify(INITIAL_WELLS)).map(normalizeWellRecord);state.respondents=JSON.parse(JSON.stringify(INITIAL_RESPONDENTS)).map(normalizeRespondentRecord);state.envAs02=JSON.parse(JSON.stringify(INITIAL_ENV_AS02));state.waterLabs=JSON.parse(JSON.stringify(INITIAL_WATER_LABS));saveLocalData();
}
async function pullFromGoogleSheets(silent=false) {
 if(silent){logCloudMessage('พบลิงก์ฐานข้อมูลเดิม; ยังไม่ดึงทับข้อมูลต้นฉบับรุ่นแก้ไขอัตโนมัติ');return;}
 if(!state.gasUrl){alert('กรุณาตั้งค่าลิงก์ Apps Script ก่อน');return;}
 try {const response=await fetch(`${state.gasUrl}?action=getAll`);if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(data.status!=='success')throw Error('รูปแบบผลตอบกลับไม่ถูกต้อง');
 if(data.data_version!==DATA_VERSION){alert('ข้อมูลส่วนกลางยังเป็นรุ่นเดิม จึงยังไม่ดึงทับชุดแก้ไข กรุณาตรวจและปรับฐานข้อมูลกลางก่อน');return;}
 if(!['wells','respondents','envAs02','waterLabs'].every(k=>Array.isArray(data[k])))throw Error('ข้อมูลส่วนกลางไม่ครบชุด');
 downloadFullBackupJson();state.wells=data.wells.map(normalizeWellRecord);state.respondents=data.respondents.map(normalizeRespondentRecord);state.envAs02=data.envAs02;state.waterLabs=data.waterLabs;saveLocalData();logCloudMessage('ดึงข้อมูลส่วนกลางรุ่นตรงกันสำเร็จ');
 }catch(e){alert('ดึงข้อมูลไม่ได้: '+e.message);}
}
async function postToGoogleSheets(payload) {
 if(!state.gasUrl)return false;
 try {
  const version=await fetch(`${state.gasUrl}?action=getAll`);if(!version.ok)throw Error('อ่านรุ่นฐานข้อมูลไม่ได้');
  const old=await version.json();if(old.data_version!==DATA_VERSION){logCloudMessage('บันทึกในเครื่องแล้ว; ยังไม่ส่งทับฐานข้อมูลกลางรุ่นเดิม ต้องปรับระบบส่วนกลางให้รองรับชุดปี 69 ก่อน');return false;}
  const response=await fetch(state.gasUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,data_version:DATA_VERSION})});
  const result=await response.json();if(result.status!=='success')throw Error(result.message||'ส่วนกลางยังไม่ยืนยันการบันทึก');
  logCloudMessage('ส่วนกลางยืนยันการบันทึกแล้ว');return true;
 } catch(e) {logCloudMessage('ข้อมูลยังบันทึกในเครื่อง; ยังยืนยันการส่งส่วนกลางไม่ได้: '+e.message);return false;}
}
async function syncAllToGoogleSheets() {
 if(!state.gasUrl){alert('ยังไม่ได้ตั้งค่าฐานข้อมูลกลาง ข้อมูลบันทึกอยู่ในเครื่อง');return;}
 const ok=await postToGoogleSheets({action:'syncAll',wells:state.wells,respondents:state.respondents,envAs02:state.envAs02,waterLabs:state.waterLabs,knowledgeDocs:state.knowledgeDocs});
 alert(ok?'ส่วนกลางยืนยันการบันทึกครบชุดแล้ว':'ยังไม่ยืนยันการส่งส่วนกลาง ข้อมูลในเครื่องยังอยู่ กรุณาดูข้อความสถานะ');
}
async function copyAppsScriptCode() {
 alert('ชุดนี้มีไฟล์หน้าเว็บ 6 ไฟล์ ยังไม่มีโค้ดฐานข้อมูล Apps Script ฉบับเดิม จึงไม่สร้างหรือแทนส่วนกลางอัตโนมัติ กรุณาปรับส่วนกลางแยกก่อนเปิดการซิงค์');
}


function openRespondentModal(id=null) {
 const r=state.respondents.find(x=>x.id===id);
 if(r?.source_summary_only){showSourceEditor(id,1);return;}
 openDetailedRespondentModal(id);
}
function openEnvAs02Modal(id=null) {
 if(id&&state.envAs02.find(x=>x.id===id)?.source_summary_only){showSourceEditor(id,2);return;}
 openDetailedEnvAs02(id);
}
function filterRespondentsByTab(mode) {
 switchTab('tab-respondents');const sel=document.getElementById('resp-filter-tab');if(sel)sel.value=mode;renderRespondentsTable();
}
window.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('#env-as02-form select,#well-hc,#wlab-lab-select').forEach(select=>{if(!Array.from(select.options).some(x=>x.value===''))select.insertAdjacentHTML('afterbegin','<option value="">-- ยังไม่ระบุ --</option>');});
 const warn=document.getElementById('data-quality-details');
 if(warn)warn.innerHTML='<p>พิกัดแหล่งน้ำแปลงจาก X/Y โดยใช้ UTM 47N/WGS84 ตามระบบเดิม ต้นฉบับไม่ระบุ datum จึงควรยืนยันระบบพิกัดก่อนใช้ภาคสนาม</p><p>ทะเบียนมี 30 แห่งที่ไม่ระบุชื่อ และ 54 แห่งที่ไม่ระบุจำนวนผู้ใช้ เก็บไว้ครบ ไม่เติมจำนวนผู้ใช้เป็น 1</p><p>บ้านเลขที่ 2 รายการถูก Excel เก็บเป็นวันที่ จึงเก็บค่าดิบไว้รอยืนยัน ไม่ใช้เดาจับคู่ผลตรวจ</p><p>แคชรุ่นเดิมยังเก็บไว้ ดาวน์โหลดสำรองทั้งหมดได้จากเมนูตั้งค่า ฐานข้อมูลกลางยังไม่ดึงทับอัตโนมัติ</p>';
});
