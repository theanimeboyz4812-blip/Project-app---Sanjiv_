// ============================================
//  LIVE BACKEND CONFIGURATION (Render)
// ============================================
const BACKEND_URL = "https://smart-transit-guard-backend.onrender.com";

// ============================================
//  TAB NAVIGATION — Main / How It Works / Features / Team
// ============================================

const tabButtons   = document.querySelectorAll('.tab-btn');
const tabIndicator = document.getElementById('tabIndicator');
let activePanel     = document.querySelector('.tab-panel.active');

// Moves the sliding indicator bar to sit under the given tab button
function moveIndicator(tabButton) {
  if (!tabButton || !tabIndicator) return;
  tabIndicator.style.width     = tabButton.offsetWidth + 'px';
  tabIndicator.style.transform = `translateX(${tabButton.offsetLeft}px)`;
}

// Switches to a new tab by its data-tab value (e.g. "features")
function switchTab(tabKey) {
  const targetButton = document.querySelector(`.tab-btn[data-tab="${tabKey}"]`);
  const targetPanel  = document.getElementById('panel-' + tabKey);

  if (!targetButton || !targetPanel || targetPanel === activePanel) return;

  tabButtons.forEach(btn => btn.classList.remove('active'));
  targetButton.classList.add('active');
  moveIndicator(targetButton);

  if (activePanel) {
    activePanel.classList.remove('visible');
  }

  setTimeout(function () {
    if (activePanel) {
      activePanel.classList.remove('active');
    }

    targetPanel.classList.add('active');    
    void targetPanel.offsetWidth;           
    targetPanel.classList.add('visible');   

    activePanel = targetPanel;

    // Leaflet computes its size when the map div becomes visible again —
    // without this, the map looks broken/grey after switching tabs away and back
    if (tabKey === 'main' && typeof geofenceMap !== 'undefined' && geofenceMap) {
      geofenceMap.invalidateSize();
    }
  }, 300);
}

tabButtons.forEach(function (btn) {
  btn.addEventListener('click', function () {
    switchTab(btn.dataset.tab);
  });
});

const seeHowBtn = document.getElementById('seeHowItWorksBtn');
if (seeHowBtn) {
  seeHowBtn.addEventListener('click', function () {
    switchTab('how-it-works');
  });
}

window.addEventListener('load', function () {
  const activeBtn = document.querySelector('.tab-btn.active');
  if (activeBtn) {
    moveIndicator(activeBtn);
  }
});

// ============================================
//  HIDE HEADER ON SCROLL
// ============================================

const headerEl = document.querySelector('header');

window.addEventListener('scroll', function () {
  if (!headerEl) return;
  const scrolled      = window.scrollY;
  const scrollableMax = document.documentElement.scrollHeight - window.innerHeight;

  const scrollFraction = scrollableMax > 0 ? (scrolled / scrollableMax) : 0;

  if (scrollFraction > 0.2) {
    headerEl.classList.add('header-hidden');
  } else {
    headerEl.classList.remove('header-hidden');
  }
});

// ============================================
//  WEB NOTIFICATIONS
// ============================================

window.addEventListener('load', function () {
  if ('Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } else {
    console.log('This browser does not support desktop notifications.');
  }
});

function showBreachNotification() {
  const popup = document.getElementById('fakeNotification');
  if (!popup) return;

  popup.classList.add('show');

  clearTimeout(window.notifTimeout);
  window.notifTimeout = setTimeout(function () {
    popup.classList.remove('show');
  }, 4000);
}

// ============================================
//  LOCATION + TIMESTAMP READOUT
// ============================================

const SAFE_ZONE_CENTER_LAT = 13.0827;
const SAFE_ZONE_CENTER_LNG = 80.2707;

const coordValueEl     = document.getElementById('coordValue');
const timeValueEl      = document.getElementById('timeValue');
const popupCoordTimeEl = document.getElementById('popupCoordTime');

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function clearBreachReadout() {
  if (coordValueEl) coordValueEl.textContent = '— , —';
  if (timeValueEl) timeValueEl.textContent = '--:--:--';
  if (popupCoordTimeEl) popupCoordTimeEl.textContent = '';
}

// Fills the readout boxes + popup using a REAL lat/lng pair
// (used by both the simulate button and the live feed)
function showReadoutFromPoint(lat, lng) {
  const now = new Date();
  const timeStr = formatTime(now);
  const latStr = lat.toFixed(6);
  const lngStr = lng.toFixed(6);

  if (coordValueEl) coordValueEl.textContent = `${latStr}, ${lngStr}`;
  if (timeValueEl) timeValueEl.textContent = timeStr;
  if (popupCoordTimeEl) popupCoordTimeEl.textContent = `📍 ${latStr}, ${lngStr}  •  🕒 ${timeStr}`;
}

// ============================================
//  GEOFENCE MAP (Leaflet + Leaflet.draw + Turf.js)
//  Draw a polygon on the map (or drag its corners) to set a
//  custom safe zone. Every position update — simulated or live —
//  is checked against whatever polygon currently exists here,
//  using turf.booleanPointInPolygon for the real breach result.
// ============================================

let geofenceMap      = null;  // the Leaflet map instance
let trackerMarker    = null;  // the dot showing the tracker's current position
let drawnItems        = null;  // the layer group holding the current geofence shape
let geofencePolygon   = null;  // the current geofence, as GeoJSON (what Turf reads)

function initGeofenceMap() {
  const mapEl = document.getElementById('geofenceMap');
  if (!mapEl || typeof L === 'undefined' || typeof turf === 'undefined') return;

  geofenceMap = L.map('geofenceMap').setView([SAFE_ZONE_CENTER_LAT, SAFE_ZONE_CENTER_LNG], 16);

  // Dark map tiles so it matches the site's dark theme
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 20
  }).addTo(geofenceMap);

  // This group holds whichever geofence shape currently exists —
  // Leaflet.draw's edit/delete tools only work on layers inside it
  drawnItems = new L.FeatureGroup();
  geofenceMap.addLayer(drawnItems);

  // Give the map a default circular safe zone (~150m) so there's always
  // something valid to check breaches against, even before you draw your own
  const defaultCircle = turf.circle(
    [SAFE_ZONE_CENTER_LNG, SAFE_ZONE_CENTER_LAT], // Turf uses [lng, lat] order
    0.15,
    { steps: 32, units: 'kilometers' }
  );
  drawnItems.addLayer(L.geoJSON(defaultCircle).getLayers()[0]);
  geofencePolygon = defaultCircle;

  // The dot that represents the tracker's live position
  trackerMarker = L.circleMarker([SAFE_ZONE_CENTER_LAT, SAFE_ZONE_CENTER_LNG], {
    radius: 8,
    color: '#3ddc84',
    fillColor: '#3ddc84',
    fillOpacity: 1,
    weight: 2
  }).addTo(geofenceMap);

  // Drawing toolbar — only polygon drawing + editing/deleting are enabled
  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawnItems },
    draw: {
      polygon: { shapeOptions: { color: '#ff0033' } },
      marker: false,
      circle: false,
      circlemarker: false,
      polyline: false,
      rectangle: false
    }
  });
  geofenceMap.addControl(drawControl);

  // Drawing a NEW polygon replaces whatever geofence existed before
  // (keeps things simple — only one active safe zone at a time)
  geofenceMap.on(L.Draw.Event.CREATED, function (e) {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    geofencePolygon = e.layer.toGeoJSON();
  });

  // Dragging the polygon's corners updates the geofence Turf checks against
  geofenceMap.on(L.Draw.Event.EDITED, function (e) {
    e.layers.eachLayer(function (layer) {
      geofencePolygon = layer.toGeoJSON();
    });
  });

  // Deleting the polygon falls back to the default circle again
  geofenceMap.on(L.Draw.Event.DELETED, function () {
    if (drawnItems.getLayers().length === 0) {
      drawnItems.addLayer(L.geoJSON(defaultCircle).getLayers()[0]);
      geofencePolygon = defaultCircle;
    }
  });
}

// THE REAL BREACH CHECK — is this lat/lng inside the current geofence?
function isPointInsideGeofence(lat, lng) {
  if (!geofencePolygon) return true; // nothing drawn yet — assume safe
  const point = turf.point([lng, lat]); // Turf wants [lng, lat], not [lat, lng]
  return turf.booleanPointInPolygon(point, geofencePolygon);
}

// Moves the tracker dot to a new position on the map, and colors it
// green (safe) or red (breached) to match the rest of the dashboard
function updateTrackerMarker(lat, lng, breached) {
  if (!trackerMarker) return;
  trackerMarker.setLatLng([lat, lng]);
  trackerMarker.setStyle({
    color: breached ? '#ff0033' : '#3ddc84',
    fillColor: breached ? '#ff0033' : '#3ddc84'
  });
}

// A point guaranteed to sit inside the current geofence — used for
// the Simulate button's "safe" state. turf.pointOnFeature (not centroid!)
// guarantees the point actually lands inside, even for oddly-shaped polygons.
function getInsideGeofencePoint() {
  if (!geofencePolygon) return turf.point([SAFE_ZONE_CENTER_LNG, SAFE_ZONE_CENTER_LAT]);
  return turf.pointOnFeature(geofencePolygon);
}

// A point well outside the current geofence — used for the Simulate
// button's "breach" state. Projects outward from an inside point by a
// fixed real-world distance in a random direction.
function getOutsideGeofencePoint() {
  const insidePoint = getInsideGeofencePoint();
  const bearing      = Math.random() * 360;   // random compass direction
  const distanceKm   = 0.6;                   // far enough to clear most drawn shapes
  return turf.destination(insidePoint, distanceKm, bearing, { units: 'kilometers' });
}

window.addEventListener('load', initGeofenceMap);

// ============================================
//  LIVE HARDWARE FEED (Socket.io — real-time push)
//  Your backend already broadcasts a "trackerUpdate" event the
//  instant it receives new data from the ESP32 (see tracker.js).
//  This connects to that instead of polling on a timer — updates
//  arrive the moment they happen, with zero unnecessary requests.
// ============================================

let socket = null;
let previousBreachState = false;

// Shows/hides the "can't reach backend" banner in the sim card
function showConnectionAlert(show) {
  const alertEl = document.getElementById('connectionAlert');
  if (alertEl) alertEl.style.display = show ? 'block' : 'none';
}

// Takes one reading ({latitude, longitude, timestamp}) and updates
// every part of the dashboard to match it
function applyLiveReading(data) {
  if (!data || data.latitude === null || data.latitude === undefined) return;

  const lat = Number(data.latitude);
  const lng = Number(data.longitude);

  // Real breach calculation — checked against YOUR drawn/edited polygon
  // via Turf.js, instead of just trusting whatever the hardware sent
  const breached = !isPointInsideGeofence(lat, lng);

  updateTrackerMarker(lat, lng, breached);

  const timeStamp = data.timestamp ? new Date(data.timestamp) : new Date();
  const timeStr   = formatTime(timeStamp);
  const latStr    = lat.toFixed(6);
  const lngStr    = lng.toFixed(6);

  if (coordValueEl) coordValueEl.textContent = `${latStr}, ${lngStr}`;
  if (timeValueEl) timeValueEl.textContent  = timeStr;

  const simCard    = document.getElementById('simCard');
  const statusText = document.getElementById('statusText');

  if (breached) {
    if (simCard) simCard.classList.add('breached');
    if (statusText) statusText.textContent = 'Safe Zone Breached!';
    if (popupCoordTimeEl) popupCoordTimeEl.textContent = `📍 ${latStr}, ${lngStr}  •  🕒 ${timeStr}`;

    if (!previousBreachState) {
      showBreachNotification();
    }
  } else {
    if (simCard) simCard.classList.remove('breached');
    if (statusText) statusText.textContent = 'Inside Safe Zone';
  }

  previousBreachState = breached;
}

function startLiveFeed() {
  showConnectionAlert(false);

  socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', function () {
    console.log('Connected to backend:', BACKEND_URL);
    showConnectionAlert(false);
  });

  // Fires the instant the backend receives new data from the ESP32
  socket.on('trackerUpdate', function (data) {
    applyLiveReading(data);
  });

  socket.on('connect_error', function (err) {
    console.error('Could not connect to the backend server:', err);
    showConnectionAlert(true);
  });

  socket.on('disconnect', function () {
    showConnectionAlert(true);
  });

  // Also grab whatever reading is already saved, in case it arrived
  // before this page connected (Socket.io only pushes NEW events)
  fetch(`${BACKEND_URL}/api/tracker`)
    .then(res => res.json())
    .then(data => applyLiveReading(data))
    .catch(err => {
      console.log('No existing reading yet, or backend unreachable on first load.', err);
      showConnectionAlert(true);
    });
}

function stopLiveFeed() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  showConnectionAlert(false);
  clearBreachReadout();

  const simCard    = document.getElementById('simCard');
  const statusText = document.getElementById('statusText');

  if (simCard) simCard.classList.remove('breached');
  if (statusText) statusText.textContent = 'Inside Safe Zone';
  previousBreachState = false;

  // Put the marker back at a known-safe point, colored green again
  const safePoint = getInsideGeofencePoint();
  if (safePoint) {
    const [lng, lat] = safePoint.geometry.coordinates;
    updateTrackerMarker(lat, lng, false);
  }
}

// Mode Switch Handler
const modeToggle     = document.getElementById('modeToggle');
const modeCurrentTag = document.getElementById('modeCurrentTag');
const simToggleBtn   = document.getElementById('simToggleBtn');

if (modeToggle) {
  modeToggle.addEventListener('change', function () {
    const isLive = modeToggle.checked;

    if (simToggleBtn) simToggleBtn.disabled = isLive;

    if (isLive) {
      if (modeCurrentTag) {
        modeCurrentTag.textContent = 'Live Mode';
        modeCurrentTag.classList.add('is-live');
      }
      startLiveFeed();
    } else {
      if (modeCurrentTag) {
        modeCurrentTag.textContent = 'Demo Mode';
        modeCurrentTag.classList.remove('is-live');
      }
      stopLiveFeed();
    }
  });
}

// ============================================
//  SIMULATION TOGGLE LOGIC (Demo Mode)
// ============================================

const simCard    = document.getElementById('simCard');
const statusText = document.getElementById('statusText');
let isBreached   = false;

if (simToggleBtn) {
  simToggleBtn.addEventListener('click', function () {
    isBreached = !isBreached;

    // Pick a real point — either inside or outside the CURRENT geofence
    // (whatever you've drawn/edited on the map, or the default circle)
    const targetPoint = isBreached ? getOutsideGeofencePoint() : getInsideGeofencePoint();
    const [lng, lat]  = targetPoint.geometry.coordinates;

    // The REAL check — did that point actually land inside or outside?
    const actuallyBreached = !isPointInsideGeofence(lat, lng);

    updateTrackerMarker(lat, lng, actuallyBreached);

    if (actuallyBreached) {
      if (simCard) simCard.classList.add('breached');
      if (statusText) statusText.textContent = 'Safe Zone Breached!';
      simToggleBtn.textContent = 'Reset to Safe Zone';

      showReadoutFromPoint(lat, lng);
      showBreachNotification();
    } else {
      if (simCard) simCard.classList.remove('breached');
      if (statusText) statusText.textContent = 'Inside Safe Zone';
      simToggleBtn.textContent = 'Simulate Geofence Breach';

      clearBreachReadout();
    }
  });
}