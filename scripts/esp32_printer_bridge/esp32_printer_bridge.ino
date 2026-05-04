// ESP32 BLE thermal-printer bridge.
//
// Joins a WPA2-Enterprise WiFi, polls the server for the next print job,
// and prints it on a BLE thermal printer (cat-printer / iPrint / Phomemo
// / Goojprt family) via Larry Bank's Thermal_Printer library, which
// already knows the per-model framing quirks:
//     https://github.com/bitbank2/Thermal_Printer
//
// Server contract (see PROMPT.md):
//   GET  /api/print/jobs/next?device=<id>          Auth: Bearer <token>
//        → 204 if no job, else 200 with JSON:
//          { "id":     "...",
//            "width":  384,        // px, 1-bit, MSB-first, padded to byte
//            "height": <int>,
//            "bitmap_b64": "<base64 of (width/8)*height bytes>",
//            "feed_lines": 32 }
//   POST /api/print/jobs/<id>/ack                  Auth: Bearer <token>
//        body: { "status": "ok" | "error", "error"?: "..." }
//
// Library deps (Arduino IDE → Library Manager):
//   - Thermal_Printer    (bitbank2)
//   - ArduinoJson        (Benoit Blanchon)
// Board: ESP32, Arduino-ESP32 core 2.x or 3.x.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_wpa2.h>
#include <ArduinoJson.h>
#include <Thermal_Printer.h>
#include <mbedtls/base64.h>

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// WPA2-Enterprise (PEAP-MSCHAPv2). For plain WPA2-PSK, use
// WiFi.begin(ssid, password) and skip the esp_wifi_sta_wpa2_* calls.
static const char* WIFI_SSID     = "EnterpriseSSID";
static const char* WIFI_IDENTITY = "user@example.edu"; // outer/anonymous identity
static const char* WIFI_USERNAME = "user@example.edu"; // inner identity
static const char* WIFI_PASSWORD = "your-password";

static const char* SERVER_BASE   = "https://your-app.vercel.app";
static const char* DEVICE_ID     = "printer-01";
static const char* DEVICE_TOKEN  = "paste-long-random-secret-here";
static const bool  TLS_INSECURE  = true;   // use setCACert() in production

// Empty = let Thermal_Printer auto-detect any supported printer in range.
// Set to a substring (e.g. "MXW01", "GB02", "Phomemo") to pin one model.
static const char* PRINTER_NAME_HINT = "";

static const uint32_t POLL_INTERVAL_MS = 3000;
static const uint32_t POLL_BACKOFF_MAX = 30000;

// ─── STATE ───────────────────────────────────────────────────────────────────

static uint32_t backoffMs = POLL_INTERVAL_MS;

// ─── WIFI ────────────────────────────────────────────────────────────────────

static void connectWifi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);

  esp_wifi_sta_wpa2_ent_set_identity((uint8_t*)WIFI_IDENTITY, strlen(WIFI_IDENTITY));
  esp_wifi_sta_wpa2_ent_set_username((uint8_t*)WIFI_USERNAME, strlen(WIFI_USERNAME));
  esp_wifi_sta_wpa2_ent_set_password((uint8_t*)WIFI_PASSWORD, strlen(WIFI_PASSWORD));
  esp_wifi_sta_wpa2_ent_enable();

  WiFi.begin(WIFI_SSID);
  Serial.printf("WiFi: joining %s ", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(500); Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi: %s  RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("WiFi: failed, will retry");
  }
}

// ─── PRINTER ─────────────────────────────────────────────────────────────────

static bool ensurePrinter() {
  if (tpIsConnected()) return true;
  Serial.println("BLE: scanning for thermal printer...");
  // 8-second active scan; PRINTER_NAME_HINT == "" matches first supported model.
  if (!tpScan(PRINTER_NAME_HINT, 8)) {
    Serial.println("BLE: no supported printer found");
    return false;
  }
  if (!tpConnect()) {
    Serial.println("BLE: connect failed");
    return false;
  }
  Serial.printf("BLE: connected to %s (%dpx wide)\n",
                tpGetName(), tpGetWidth());
  return true;
}

static bool printBitmap(const uint8_t* bmp, uint16_t w, uint16_t h, uint16_t feedLines) {
  if (!ensurePrinter()) return false;
  // Thermal_Printer expects a 1-bit, MSB-first, byte-padded bitmap.
  // tpPrintBuffer handles per-model framing/pacing internally.
  if (!tpPrintBuffer((uint8_t*)bmp, w, h)) {
    Serial.println("BLE: tpPrintBuffer failed");
    return false;
  }
  if (feedLines) tpFeed(feedLines);
  return true;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

static int httpGet(const String& path, String& outBody) {
  WiFiClientSecure tls;
  if (TLS_INSECURE) tls.setInsecure();
  HTTPClient http;
  if (!http.begin(tls, SERVER_BASE + path)) return -1;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.setTimeout(15000);
  int code = http.GET();
  if (code > 0) outBody = http.getString();
  http.end();
  return code;
}

static int httpPostJson(const String& path, const String& body) {
  WiFiClientSecure tls;
  if (TLS_INSECURE) tls.setInsecure();
  HTTPClient http;
  if (!http.begin(tls, SERVER_BASE + path)) return -1;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);
  int code = http.POST(body);
  http.end();
  return code;
}

// ─── JOB LOOP ────────────────────────────────────────────────────────────────

static bool processNextJob() {
  String body;
  String path = String("/api/print/jobs/next?device=") + DEVICE_ID;
  int code = httpGet(path, body);
  if (code == 204) return false;
  if (code != 200) { Serial.printf("HTTP poll: %d\n", code); return false; }

  // 16 KB doc covers a tall receipt (e.g. 384×1024 1-bit ≈ 49 KB base64).
  // For larger jobs, switch to DynamicJsonDocument or stream.
  DynamicJsonDocument doc(96 * 1024);
  DeserializationError err = deserializeJson(doc, body);
  if (err) { Serial.printf("JSON: %s\n", err.c_str()); return false; }

  const char* id        = doc["id"]         | "";
  uint16_t    width     = doc["width"]      | 384;
  uint16_t    height    = doc["height"]     | 0;
  const char* bmpB64    = doc["bitmap_b64"] | "";
  uint16_t    feedLines = doc["feed_lines"] | 32;
  if (!*id || !*bmpB64 || height == 0) { Serial.println("Job: missing fields"); return false; }

  size_t b64Len = strlen(bmpB64);
  size_t expect = ((width + 7) / 8) * (size_t)height;
  uint8_t* bmp  = (uint8_t*)heap_caps_malloc(expect + 4, MALLOC_CAP_8BIT);
  if (!bmp) { Serial.println("OOM"); return false; }
  size_t binLen = 0;
  if (mbedtls_base64_decode(bmp, expect + 4, &binLen,
                            (const uint8_t*)bmpB64, b64Len) != 0
      || binLen != expect) {
    Serial.printf("base64: got %u, expected %u\n", (unsigned)binLen, (unsigned)expect);
    free(bmp);
    return false;
  }

  Serial.printf("Job %s: %ux%u → printer\n", id, width, height);
  bool ok = printBitmap(bmp, width, height, feedLines);
  free(bmp);

  String ack = ok ? "{\"status\":\"ok\"}" : "{\"status\":\"error\",\"error\":\"print_failed\"}";
  int ackCode = httpPostJson(String("/api/print/jobs/") + id + "/ack", ack);
  Serial.printf("Job %s: %s (ack %d)\n", id, ok ? "printed" : "FAILED", ackCode);
  return true;
}

// ─── ARDUINO ENTRY POINTS ────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nESP32 thermal-printer bridge (bitbank2/Thermal_Printer)");
  connectWifi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); delay(2000); return; }

  bool worked = processNextJob();
  if (worked) {
    backoffMs = POLL_INTERVAL_MS;
  } else {
    delay(backoffMs);
    backoffMs = min<uint32_t>(backoffMs + 1000, POLL_BACKOFF_MAX);
  }
}
