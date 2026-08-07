/* ==========================================================================
   SMART TRANSIT GUARD - COMPLETE APPLICATION SCRIPT
   Features: Web Serial API, Leaflet Map, Turf.js Geofence, Google Auth,
             Browser Notifications, and Simulation Controls.
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. GLOBAL CONFIGURATION & STATE
// --------------------------------------------------------------------------

// ⚠️ REPLACE THIS WITH YOUR GOOGLE CLIENT ID FROM GOOGLE CLOUD CONSOLE
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

// Default Starting Center (Chennai, India)
const DEFAULT_LAT = 13.0827;
const DEFAULT_LNG = 80.2707;

// Geofence Boundary Coordinates (Turf.js Polygon format: [lng, lat])
// Creates a safe box around the initial location
const SAFE_ZONE_POLYGON = turf.polygon([[
  [80.2600, 13.0900],
  [80.2850, 13.0900],
  [80.2850, 13.0750],
  [80.2600, 13.0750],
  [80.2600, 13.0900] // Closed ring (first and last point match)
]]);

// Application State Variables
let map, vehicleMarker, geofenceLayer;
let serialPort = null;
let serialWriter = null;
let isCurrentBreach = false;

// --------------------------------------------------------------------------
// 2. INITIALIZATION ON PAGE LOAD
// --------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initMap();
  initGoogleAuth();
  requestNotificationPermission();
});

// --------------------------------------------------------------------------
// 3. LEAFLET MAP & TURF.JS GEOFENCE LOGIC
// --------------------------------------------------------------------------
function initMap() {
  // Initialize Leaflet Map
  map = L.map("map").setView([DEFAULT_LAT, DEFAULT_LNG], 14);

  // Add OpenStreetMap Tile Layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  // Render Geofence Boundary Polygon on Map (Green Box)
  geofenceLayer = L.geoJSON(SAFE_ZONE_POLYGON, {
    style: {
      color: "#10b981",
      weight: 2,
      fillColor: "#10b981",
      fillOpacity: 0.15
    }
  }).addTo(map);

  // Create Vehicle Marker
  vehicleMarker = L.marker([DEFAULT_LAT, DEFAULT_LNG]).addTo(map)
    .bindPopup("<b>Smart Transit Guard</b><br>Vehicle Tracker")
    .openPopup();

  // Perform initial position check
  updateVehiclePosition(DEFAULT_LAT, DEFAULT_LNG);
}

// Update Marker Position and Check Geofence
function updateVehiclePosition(lat, lng) {
  // 1. Move Marker & Pan Map Smoothly
  const newLatLng = new L.LatLng(lat, lng);
  vehicleMarker.setLatLng(newLatLng);
  map.panTo(newLatLng);

  // 2. Update Coordinate Displays in DOM
  const latEl = document.getElementById("latDisplay");
  const lngEl = document.getElementById("lngDisplay");
  if (latEl) latEl.innerText = lat.toFixed(6);
  if (lngEl) lngEl.innerText = lng.toFixed(6);

  // 3. Turf.js Geofence Check (Note: Turf uses [lng, lat])
  const currentPoint = turf.point([lng, lat]);
  const isInside = turf.booleanPointInPolygon(currentPoint, SAFE_ZONE_POLYGON);

  // 4. Update Status UI & Trigger Alerts
  const statusBadge = document.getElementById("statusBadge");
  const zoneDisplay = document.getElementById("zoneDisplay");

  if (isInside) {
    if (statusBadge) {
      statusBadge.className = "status-card status-safe";
      statusBadge.innerText = "✅ VEHICLE SAFE";
    }
    if (zoneDisplay) zoneDisplay.innerText = "Inside Safe Zone";
    
    // Reset breach flag if vehicle returns to safe area
    if (isCurrentBreach) {
      isCurrentBreach = false;
      sendSerialCommand("SAFE");
    }
  } else {
    if (statusBadge) {
      statusBadge.className = "status-card status-breach";
      statusBadge.innerText = "🚨 GEOFENCE BREACH DETECTED";
    }
    if (zoneDisplay) zoneDisplay.innerText = "⚠️ OUTSIDE SAFE ZONE";

    // Trigger Breach Alerts only on status transition to prevent spam
    if (!isCurrentBreach) {
      isCurrentBreach = true;
      triggerAppNotification(lat, lng);
      sendSerialCommand("BREACH"); // Tells ESP32 to trigger SMS via SIM800L
    }
  }
}

// --------------------------------------------------------------------------
// 4. WEB SERIAL API INTEGRATION (ESP32 LIVE STREAM)
// --------------------------------------------------------------------------
async function connectESP32() {
  if (!("serial" in navigator)) {
    alert("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
    return;
  }

  try {
    // Prompt user to select ESP32 COM Port
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    // Set up Writable Stream for sending commands to ESP32
    const textEncoder = new TextEncoderStream();
    textEncoder.readable.pipeTo(serialPort.writable);
    serialWriter = textEncoder.writable.getWriter();

    // Update UI Button status
    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) {
      connectBtn.innerText = "⚡ ESP32 Connected";
      connectBtn.style.backgroundColor = "#10b981";
    }

    // Set up Readable Stream to process incoming ESP32 JSON data
    const textDecoder = new TextDecoderStream();
    serialPort.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();

    let stringBuffer = "";

    // Read stream continuously
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      if (value) {
        stringBuffer += value;
        // Split buffered string by newline characters
        let lines = stringBuffer.split("\n");
        // Keep unfinished last line in buffer
        stringBuffer = lines.pop();

        for (let line of lines) {
          line = line.trim();
          if (line.startsWith("{") && line.endsWith("}")) {
            try {
              const telemetry = JSON.parse(line);
              if (telemetry.lat && telemetry.lng) {
                updateVehiclePosition(telemetry.lat, telemetry.lng);
              }
            } catch (err) {
              console.warn("Partial JSON chunk skipped:", line);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Serial connection error:", err);
    alert("Failed to connect to ESP32: " + err.message);
  }
}

// Send ASCII command string to ESP32 over Web Serial
async function sendSerialCommand(command) {
  if (serialWriter) {
    try {
      await serialWriter.write(command + "\n");
      console.log(`Sent command to ESP32: ${command}`);
    } catch (err) {
      console.error("Failed to write to Serial port:", err);
    }
  }
}

// --------------------------------------------------------------------------
// 5. BROWSER NOTIFICATION SYSTEM
// --------------------------------------------------------------------------
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

function triggerAppNotification(lat, lng) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("🚨 SMART TRANSIT GUARD ALERT!", {
      body: `Geofence Breach Detected at Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}!`,
      icon: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
      requireInteraction: true
    });
  }
}

// --------------------------------------------------------------------------
// 6. GOOGLE AUTHENTICATION SYSTEM
// --------------------------------------------------------------------------
function initGoogleAuth() {
  if (typeof google !== "undefined" && google.accounts) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse
    });

    const googleBtnContainer = document.getElementById("googleBtn");
    if (googleBtnContainer) {
      google.accounts.id.renderButton(googleBtnContainer, {
        theme: "outline",
        size: "medium",
        shape: "pill"
      });
    }
  }
  checkExistingSession();
}

function handleCredentialResponse(response) {
  const payload = parseJwt(response.credential);
  const userName = payload.name;
  const userPicture = payload.picture;

  document.getElementById("userName").innerText = userName;
  document.getElementById("userAvatar").src = userPicture;

  document.getElementById("googleBtn").classList.add("hidden");
  document.getElementById("userProfile").classList.remove("hidden");

  localStorage.setItem("userLoggedIn", "true");
  localStorage.setItem("userName", userName);
  localStorage.setItem("userAvatar", userPicture);
}

function parseJwt(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    window.atob(base64)
      .split("")
      .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(jsonPayload);
}

function handleSignOut() {
  localStorage.clear();
  document.getElementById("googleBtn").classList.remove("hidden");
  document.getElementById("userProfile").classList.add("hidden");
}

function checkExistingSession() {
  if (localStorage.getItem("userLoggedIn") === "true") {
    setTimeout(() => {
      const name = localStorage.getItem("userName");
      const avatar = localStorage.getItem("userAvatar");
      if (name && avatar) {
        document.getElementById("userName").innerText = name;
        document.getElementById("userAvatar").src = avatar;
        document.getElementById("googleBtn").classList.add("hidden");
        document.getElementById("userProfile").classList.remove("hidden");
      }
    }, 300);
  }
}

// --------------------------------------------------------------------------
// 7. DASHBOARD SIMULATION BUTTON HANDLERS
// --------------------------------------------------------------------------
function simulateSafeLocation() {
  // Move to coordinates inside the safe zone polygon
  updateVehiclePosition(13.0827, 80.2707);
}

function simulateBreachLocation() {
  // Move to coordinates well outside the safe zone polygon
  updateVehiclePosition(13.1100, 80.3000);
}
