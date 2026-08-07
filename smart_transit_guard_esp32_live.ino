/* =================================================================
   SMART TRANSIT GUARD — ESP32 + Neo-6M GPS Firmware
   (Live Render Backend Version)
   ------------------------------------------------------------------
   What this does:
   1. Reads live GPS coordinates from the Neo-6M module
   2. Runs a rough on-device safe-zone check (a simple circle) as a
      backup — the WEBSITE does the real, authoritative check using
      your custom-drawn polygon via Turf.js, so this is just a
      sanity-check flag, not the final word
   3. Sends the latest coordinates to your LIVE Render backend over
      HTTPS — the same server your website's Live Mode connects to

   ------------------------------------------------------------------
   LIBRARIES YOU NEED (Arduino IDE > Library Manager):
     - TinyGPS++   by Mikal Hart
     (WiFi.h, WiFiClientSecure.h, and HTTPClient.h come built-in
      once you've installed the "esp32 by Espressif Systems" board
      package — no extra install needed for those three)

   ------------------------------------------------------------------
   WIRING (Neo-6M to ESP32):
     Neo-6M TX  -> ESP32 GPIO 16 (RX)
     Neo-6M RX  -> ESP32 GPIO 17 (TX)
     Neo-6M VCC -> 3.3V or 5V (check your module's label)
     Neo-6M GND -> GND
   ================================================================= */

#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

/* =================================================================
   1. EDIT THESE — your WiFi network details
   ================================================================= */
#define WIFI_SSID       "YOUR_WIFI_NAME"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

/* =================================================================
   2. YOUR LIVE BACKEND — already set to your real Render URL.
   ------------------------------------------------------------------
   This is a real HTTPS server, so the ESP32 needs a SECURE client
   to reach it (see WiFiClientSecure below) — a plain WiFiClient,
   which only speaks HTTP, cannot connect to it.
   ================================================================= */
#define BACKEND_HOST    "smart-transit-guard-backend.onrender.com"
#define BACKEND_PATH    "/api/tracker"

/* =================================================================
   3. EDIT THESE — your safe zone center + radius (real coordinates!)
   ------------------------------------------------------------------
   This is only used for the ESP32's own backup check — your website
   is the one that does the REAL geofence math, against whatever
   polygon you've drawn on the map.
   ================================================================= */
const double SAFE_LAT           = 13.0827;
const double SAFE_LNG           = 80.2707;
const double SAFE_RADIUS_METERS = 200.0;

/* =================================================================
   Internal setup — you shouldn't need to edit below this line
   ================================================================= */
TinyGPSPlus gps;
HardwareSerial gpsSerial(1); // ESP32 UART1

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL_MS = 3000; // send an update every 3 seconds

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17); // RX=16, TX=17

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. ESP32's own IP: " + WiFi.localIP().toString());
  Serial.println("Will send data to: https://" + String(BACKEND_HOST) + String(BACKEND_PATH));
  Serial.println("Waiting for GPS fix...");
}

void loop() {
  // Feed every incoming byte from the GPS module into the parser
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Only proceed once we have a valid, updated GPS location
  if (gps.location.isValid() && gps.location.isUpdated()) {

    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
      lastSendTime = millis();

      double currentLat = gps.location.lat();
      double currentLng = gps.location.lng();

      // On-device backup check (simple circle) — just a sanity flag
      double distance = TinyGPSPlus::distanceBetween(
        currentLat, currentLng, SAFE_LAT, SAFE_LNG
      );
      bool roughBreachGuess = (distance > SAFE_RADIUS_METERS);

      Serial.printf("Lat: %.6f  Lng: %.6f  (rough guess: %s)\n",
                    currentLat, currentLng, roughBreachGuess ? "outside" : "inside");

      sendToBackend(currentLat, currentLng, roughBreachGuess);
    }
  }
}

// Sends one reading to the LIVE Render backend over HTTPS
void sendToBackend(double lat, double lng, bool roughBreachGuess) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected — skipping this send.");
    return;
  }

  // Render serves HTTPS, so we need a SECURE client, not a plain WiFiClient.
  // setInsecure() skips certificate verification — fine for a school
  // project demo; a production app would pin the real certificate instead.
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = "https://" + String(BACKEND_HOST) + String(BACKEND_PATH);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");

  // Build the JSON body by hand — keeps this sketch dependency-free.
  // NOTE: timestamp here is "milliseconds since the ESP32 turned on" —
  // see the NTP upgrade note at the bottom of this file for real time.
  String jsonBody = "{";
  jsonBody += "\"latitude\":"   + String(lat, 6) + ",";
  jsonBody += "\"longitude\":"  + String(lng, 6) + ",";
  jsonBody += "\"isBreached\":" + String(roughBreachGuess ? "true" : "false") + ",";
  jsonBody += "\"timestamp\":"  + String((unsigned long long) millis());
  jsonBody += "}";

  int responseCode = http.POST(jsonBody);

  if (responseCode > 0) {
    Serial.printf("Sent successfully! Server responded with code: %d\n", responseCode);
  } else {
    Serial.printf("Send FAILED: %s\n", http.errorToString(responseCode).c_str());
    Serial.println("Check: correct WiFi? Is the Render backend awake? (free tier sleeps after ~15 min idle — the first request after sleeping can take 30-60s to respond)");
  }

  http.end();
}

/* =================================================================
   OPTIONAL UPGRADE — accurate real-world timestamps via NTP
   ------------------------------------------------------------------
   Add this near the top of setup(), after WiFi.begin() succeeds:

     configTime(19800, 0, "pool.ntp.org");   // 19800 = IST offset (+5:30)
                                              // use 0 for UTC, or your
                                              // own timezone offset in seconds

   Then replace the "timestamp" line in sendToBackend() with:

     time_t now;
     time(&now);
     jsonBody += "\"timestamp\":" + String((unsigned long long) now * 1000ULL);

   This gives you the real calendar date + time instead of just
   "milliseconds since the ESP32 turned on."
   ================================================================= */
