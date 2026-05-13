// ESP32 BLE cat-printer bridge.
// Polls the server for print jobs and prints them via BLE (cat-printer / iPrint
// wire protocol). Same framing as lib/catPrinter.ts in the web app.
//
//   GET  /api/print/jobs/next?device=<id>   Auth: Bearer <token>
//        → 204 no job | 200 { id, width:384, height, bitmap_b64 }
//   POST /api/print/jobs/<id>/ack           Auth: Bearer <token>
//        body: { "status": "ok" | "error" }

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <NimBLEServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_eap_client.h>
#include <ArduinoJson.h>
#include <mbedtls/base64.h>
#include <Preferences.h>

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Compiled-in defaults. At boot, ESP loads values from NVS and falls back to
// these if the NVS slot is empty. After BLE-config writes new values, they
// persist to NVS and survive reboots.

static const char* DEF_WIFI_SSID     = "boom";
static const char* DEF_WIFI_IDENTITY = "";       // empty for plain WPA2
static const char* DEF_WIFI_USERNAME = "boom";
static const char* DEF_WIFI_PASSWORD = "boombaam";

static const char* DEF_SERVER_BASE  = "https://pollys.food";
static const char* DEF_DEVICE_ID    = "printer";
static const char* DEF_DEVICE_TOKEN = "9X-rFxcsCzHqoHtMS3UbIM4gpLyvXSrKpM4G0auw9uQ";

// Live, in-RAM config (loaded from NVS at boot). All read paths use these.
static String gWifiSsid, gWifiIdentity, gWifiUsername, gWifiPassword;
static String gServerBase, gDeviceId, gDeviceToken;

// Server-pushed runtime settings (refreshed on every long-poll response).
static uint8_t  gSpeed  = 34;
static uint16_t gEnergy = 13500;

static Preferences gPrefs;
#define NVS_NS "pcfg"

static void loadConfig() {
    gPrefs.begin(NVS_NS, true /*readonly*/);
    gWifiSsid     = gPrefs.getString("wifi_ssid",     DEF_WIFI_SSID);
    gWifiIdentity = gPrefs.getString("wifi_identity", DEF_WIFI_IDENTITY);
    gWifiUsername = gPrefs.getString("wifi_username", DEF_WIFI_USERNAME);
    gWifiPassword = gPrefs.getString("wifi_password", DEF_WIFI_PASSWORD);
    gServerBase   = gPrefs.getString("server_base",   DEF_SERVER_BASE);
    gDeviceId     = gPrefs.getString("device_id",     DEF_DEVICE_ID);
    gDeviceToken  = gPrefs.getString("device_token",  DEF_DEVICE_TOKEN);
    gPrefs.end();

    // Migration: pollys.food is HTTPS-only on Vercel — silently upgrade any
    // stale http:// URL stored in NVS so the device self-heals after a re-flash
    // without needing manual re-provisioning over BLE.
    if (gServerBase.startsWith("http://")) {
        gServerBase = "https://" + gServerBase.substring(7);
        gPrefs.begin(NVS_NS, false /*rw*/);
        gPrefs.putString("server_base", gServerBase);
        gPrefs.end();
        Serial.printf("cfg: migrated server URL to %s\n", gServerBase.c_str());
    }

    Serial.printf("cfg: ssid=%s server=%s id=%s tokenLen=%u\n",
        gWifiSsid.c_str(), gServerBase.c_str(), gDeviceId.c_str(),
        (unsigned)gDeviceToken.length());
}

/** Save a single key (BLE config writes one field at a time). */
static void saveConfigField(const char* key, const String& val) {
    gPrefs.begin(NVS_NS, false /*rw*/);
    gPrefs.putString(key, val);
    gPrefs.end();
    Serial.printf("cfg: saved %s (len=%u)\n", key, (unsigned)val.length());
}

// Let's Encrypt ISRG Root X1 (valid until 2035-06-04).
static const char* TLS_CA_CERT = R"(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)";

// ─── BLE PROTOCOL ────────────────────────────────────────────────────────────
static const char* SVC_UUID = "0000ae30-0000-1000-8000-00805f9b34fb";
static const char* TX_UUID  = "0000ae01-0000-1000-8000-00805f9b34fb";
static const char* RX_UUIDS[] = {
    "0000ae02-0000-1000-8000-00805f9b34fb",
    "0000ae04-0000-1000-8000-00805f9b34fb",
    "0000ae05-0000-1000-8000-00805f9b34fb",
};
static const uint16_t BYTES_PER_ROW = 48;   // 384 px / 8

static const uint8_t LATTICE_START[11] = {0xaa,0x55,0x17,0x38,0x44,0x5f,0x5f,0x5f,0x44,0x38,0x2c};
static const uint8_t LATTICE_END[11]   = {0xaa,0x55,0x17,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x17};

// ─── STATE ───────────────────────────────────────────────────────────────────
static NimBLEClient*               gClient       = nullptr;
static NimBLEAdvertisedDevice*     gDev          = nullptr;
static NimBLERemoteCharacteristic* gTx           = nullptr;
static volatile bool               gBleConnected = false;
static size_t                      gChunkSize    = 20;
static uint32_t                    gLastBleCheck = 0;
static uint32_t                    gNextBleRetry = 0;

// ─── CAT-PRINTER FRAMING ─────────────────────────────────────────────────────
static uint8_t crc8(const uint8_t* data, size_t len) {
    uint8_t c = 0;
    for (size_t i = 0; i < len; i++) {
        c ^= data[i];
        for (int j = 0; j < 8; j++)
            c = (c & 0x80) ? ((c << 1) ^ 0x07) : (c << 1);
    }
    return c;
}

static size_t buildFrame(uint8_t* out, uint8_t cmd, const uint8_t* p, uint16_t n) {
    out[0]=0x51; out[1]=0x78; out[2]=cmd; out[3]=0x00;
    out[4]=n & 0xFF; out[5]=n >> 8;
    if (n) memcpy(out + 6, p, n);
    out[6 + n] = crc8(p, n);
    out[7 + n] = 0xFF;
    return 8 + n;
}

static bool sendBytes(const uint8_t* data, size_t len) {
    if (!gTx || !gBleConnected) return false;
    for (size_t i = 0; i < len; i += gChunkSize) {
        size_t n = (len - i < gChunkSize) ? (len - i) : gChunkSize;
        if (!gTx->writeValue(data + i, n, false)) return false;
    }
    return true;
}

static bool sendCmd(uint8_t cmd, const uint8_t* p, uint16_t n) {
    uint8_t buf[8 + 64];
    return sendBytes(buf, buildFrame(buf, cmd, p, n));
}

// ─── CAT-PRINTER PRINT SEQUENCE ──────────────────────────────────────────────
static bool catWarmup() {
    uint8_t z = 0x00, w = 0x01;
    sendCmd(0xa8, &z, 1);
    sendCmd(0xa3, &z, 1);
    delay(50);
    sendCmd(0xbb, &w, 1);
    delay(100);
    return gBleConnected;
}

static bool catPreamble() {
    uint8_t z = 0x00, dpi = 0x33;
    uint8_t spd = gSpeed;
    uint8_t energy[2] = { (uint8_t)(gEnergy & 0xFF), (uint8_t)(gEnergy >> 8) };
    sendCmd(0xa3, &z, 1);
    sendCmd(0xa4, &dpi, 1);
    sendCmd(0xa6, LATTICE_START, 11);
    sendCmd(0xaf, energy, 2);
    sendCmd(0xbe, &z, 1);
    sendCmd(0xbd, &spd, 1);
    delay(50);
    return gBleConnected;
}

static bool catPostamble() {
    uint8_t z = 0x00, s19 = 0x19;
    uint8_t feed[2] = {0x30, 0x00};     // 48 LE
    sendCmd(0xbd, &s19, 1);
    sendCmd(0xa1, feed, 2);
    sendCmd(0xa1, feed, 2);
    sendCmd(0xbd, &s19, 1);
    sendCmd(0xa6, LATTICE_END, 11);
    sendCmd(0xa3, &z, 1);
    return gBleConnected;
}

static bool catPrint(const uint8_t* bmp, uint16_t height) {
    if (!gBleConnected) return false;
    if (!catWarmup() || !catPreamble()) return false;
    for (uint16_t y = 0; y < height; y++) {
        if (!sendCmd(0xa2, bmp + (uint32_t)y * BYTES_PER_ROW, BYTES_PER_ROW)) return false;
        delay(8);
    }
    return catPostamble();
}

// ─── BLE: scan / connect / discover / subscribe ──────────────────────────────
static void onNotify(NimBLERemoteCharacteristic* c, uint8_t* data, size_t len, bool isNotify) {
    // Cat-printer status frames arrive here. We don't need to act on them, but
    // they MUST be subscribed or the firmware drops our writes.
}

class ScanCB : public NimBLEScanCallbacks {
    void onResult(const NimBLEAdvertisedDevice* dev) override {
        std::string name = dev->getName();
        if (!gDev && name.find("SC03") != std::string::npos) {
            Serial.printf("BLE: matched \"%s\" %s\n",
                name.c_str(), dev->getAddress().toString().c_str());
            gDev = (NimBLEAdvertisedDevice*)dev;
            NimBLEDevice::getScan()->stop();
        }
    }
} gScanCB;

class ClientCB : public NimBLEClientCallbacks {
    void onConnect(NimBLEClient* c) override {
        Serial.println("BLE: link up");
        gBleConnected = true;
    }
    void onDisconnect(NimBLEClient* c, int reason) override {
        Serial.printf("BLE: link down (reason=%d)\n", reason);
        gBleConnected = false;
        gTx           = nullptr;
        gDev          = nullptr;             // force re-scan (RPA may rotate)
        gNextBleRetry = millis() + 2000;     // back off briefly before retry
    }
    void onConnectFail(NimBLEClient* c, int reason) override {
        Serial.printf("BLE: connect fail reason=%d\n", reason);
    }
} gClientCB;

static bool connectPrinter() {
    if (gBleConnected && gTx) return true;

    Serial.println("BLE: scanning 8s...");
    gDev = nullptr;
    auto scan = NimBLEDevice::getScan();
    scan->setScanCallbacks(&gScanCB, false);
    scan->setActiveScan(true);
    scan->setInterval(100);
    scan->setWindow(99);
    scan->start(8000, false);
    uint32_t t0 = millis();
    while (!gDev && millis() - t0 < 9000) delay(100);
    scan->stop();
    if (!gDev) { Serial.println("BLE: no SC03 found"); return false; }

    if (gClient) {
        if (gClient->isConnected()) gClient->disconnect();
        NimBLEDevice::deleteClient(gClient);
        gClient = nullptr;
    }
    gClient = NimBLEDevice::createClient();
    gClient->setClientCallbacks(&gClientCB, false);
    gClient->setConnectionParams(24, 24, 0, 500);
    gClient->setConnectTimeout(10 * 1000);

    Serial.println("BLE: connecting...");
    if (!gClient->connect(gDev)) {
        Serial.println("BLE: connect() returned false");
        return false;
    }

    // TARGETED service discovery — cat-printers drop the link during full
    // enumeration, but accept disc_svc_by_uuid for a single UUID.
    auto svc = gClient->getService(SVC_UUID);
    if (!svc) { Serial.println("BLE: svc not found"); gClient->disconnect(); return false; }
    gTx = svc->getCharacteristic(TX_UUID);
    if (!gTx) { Serial.println("BLE: TX not found"); gClient->disconnect(); return false; }

    // Subscribe to RX notifications BEFORE any write
    for (auto u : RX_UUIDS) {
        auto* rx = svc->getCharacteristic(u);
        if (rx && (rx->canNotify() || rx->canIndicate())) rx->subscribe(true, onNotify);
    }

    // MTU upgrade — NimBLE will already have negotiated during connect if we
    // asked for >23 at init. Read the actual MTU and size chunks accordingly.
    uint16_t mtu = gClient->getMTU();
    gChunkSize = (mtu > 3) ? (size_t)(mtu - 3) : 20;
    if (gChunkSize > 200) gChunkSize = 200;
    Serial.printf("BLE: ready. MTU=%u chunk=%u\n", mtu, (unsigned)gChunkSize);
    delay(100);
    return true;
}

// ─── WIFI (WPA2-Enterprise or plain WPA2) ────────────────────────────────────
static void connectWifi() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);
    if (gWifiIdentity.length() > 0) {
        // WPA2-Enterprise
        esp_eap_client_set_identity((uint8_t*)gWifiIdentity.c_str(), gWifiIdentity.length());
        esp_eap_client_set_username((uint8_t*)gWifiUsername.c_str(), gWifiUsername.length());
        esp_eap_client_set_password((uint8_t*)gWifiPassword.c_str(), gWifiPassword.length());
        esp_wifi_sta_enterprise_enable();
        WiFi.begin(gWifiSsid.c_str());
    } else {
        // Plain WPA2 — psk in gWifiPassword
        WiFi.begin(gWifiSsid.c_str(), gWifiPassword.c_str());
    }
    Serial.printf("WiFi: joining %s ", gWifiSsid.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30000) {
        delay(500); Serial.print('.');
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("WiFi: IP=%s RSSI=%d\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    else
        Serial.println("WiFi: failed, will retry");
}

// ─── HTTP / HTTPS ────────────────────────────────────────────────────────────
// Belt-and-suspenders: even if migration didn't run for some reason, never
// dial an http:// URL — pollys.food has nothing listening on port 80.
static String forceHttps(const String& in) {
    if (in.startsWith("http://"))  return "https://" + in.substring(7);
    if (in.startsWith("https://")) return in;
    return String("https://") + in;
}

static bool isHttps() {
    return true;  // we force https at the URL-build site below
}

static int httpGet(const String& path, String& out, uint32_t timeoutMs = 15000) {
    String url = forceHttps(gServerBase) + path;
    HTTPClient http;
    bool began;
    if (isHttps()) {
        WiFiClientSecure tls; tls.setCACert(TLS_CA_CERT);
        began = http.begin(tls, url);
        if (!began) { Serial.printf("HTTP begin failed: %s\n", url.c_str()); return -100; }
        http.addHeader("Authorization", String("Bearer ") + gDeviceToken);
        http.setTimeout(timeoutMs);
        int code = http.GET();
        if (code > 0) out = http.getString();
        else Serial.printf("HTTP err %d: %s (url=%s)\n", code, http.errorToString(code).c_str(), url.c_str());
        http.end();
        return code;
    } else {
        began = http.begin(url);
        if (!began) { Serial.printf("HTTP begin failed: %s\n", url.c_str()); return -100; }
        http.addHeader("Authorization", String("Bearer ") + gDeviceToken);
        http.setTimeout(timeoutMs);
        int code = http.GET();
        if (code > 0) out = http.getString();
        else Serial.printf("HTTP err %d: %s (url=%s)\n", code, http.errorToString(code).c_str(), url.c_str());
        http.end();
        return code;
    }
}

static int httpPostJson(const String& path, const String& body) {
    String url = forceHttps(gServerBase) + path;
    HTTPClient http;
    if (isHttps()) {
        WiFiClientSecure tls; tls.setCACert(TLS_CA_CERT);
        if (!http.begin(tls, url)) return -100;
        http.addHeader("Authorization", String("Bearer ") + gDeviceToken);
        http.addHeader("Content-Type", "application/json");
        http.setTimeout(15000);
        int code = http.POST(body);
        http.end();
        return code;
    } else {
        if (!http.begin(url)) return -100;
        http.addHeader("Authorization", String("Bearer ") + gDeviceToken);
        http.addHeader("Content-Type", "application/json");
        http.setTimeout(15000);
        int code = http.POST(body);
        http.end();
        return code;
    }
}

// ─── JOB LOOP ────────────────────────────────────────────────────────────────
// Long-poll the server. The endpoint always returns 200 with this shape:
//   { settings: { role, speed, energy }, job: null | { id, width, height, bitmap_b64 } }
// `settings` is refreshed every cycle so admin tweaks apply on the next print.
static const uint32_t LONG_POLL_SEC     = 25;
static const uint32_t LONG_POLL_HTTP_MS = (LONG_POLL_SEC + 10) * 1000;
static uint32_t       gPollTick         = 0;
static bool processJob() {
    String body;
    uint32_t t0 = millis();
    int code = httpGet(
        String("/api/print/jobs/next?device=") + gDeviceId +
        "&wait=" + String(LONG_POLL_SEC),
        body, LONG_POLL_HTTP_MS);
    uint32_t dt = millis() - t0;
    if (code != 200) { Serial.printf("HTTP poll: %d (%lums)\n", code, (unsigned long)dt); return false; }

    DynamicJsonDocument doc(96 * 1024);
    if (deserializeJson(doc, body)) { Serial.println("JSON parse error"); return false; }

    // Apply settings on every cycle — cheap, idempotent.
    if (doc["settings"].is<JsonObject>()) {
        uint8_t  newSpeed  = doc["settings"]["speed"]  | gSpeed;
        uint16_t newEnergy = doc["settings"]["energy"] | gEnergy;
        if (newSpeed != gSpeed || newEnergy != gEnergy) {
            Serial.printf("settings: speed %u→%u energy %u→%u\n",
                          gSpeed, newSpeed, gEnergy, newEnergy);
            gSpeed  = newSpeed;
            gEnergy = newEnergy;
        }
    }

    if (doc["job"].isNull() || !doc["job"].is<JsonObject>()) {
        if ((gPollTick++ % 4) == 0) Serial.printf("poll: no job (%lums)\n", (unsigned long)dt);
        return false;
    }

    JsonObject job = doc["job"];
    const char* id     = job["id"]         | "";
    uint16_t    height = job["height"]     | 0;
    const char* bmpB64 = job["bitmap_b64"] | "";
    if (!*id || !*bmpB64 || height == 0) { Serial.println("Job: missing fields"); return false; }

    size_t expect = BYTES_PER_ROW * (size_t)height;
    uint8_t* bmp = (uint8_t*)heap_caps_malloc(expect + 4, MALLOC_CAP_8BIT);
    if (!bmp) { Serial.println("OOM"); return false; }

    size_t n = 0;
    if (mbedtls_base64_decode(bmp, expect + 4, &n,
                              (const uint8_t*)bmpB64, strlen(bmpB64)) != 0 || n != expect) {
        Serial.printf("base64: got %u expected %u\n", (unsigned)n, (unsigned)expect);
        free(bmp); return false;
    }

    Serial.printf("Job %s: 384x%u\n", id, height);
    if (!connectPrinter()) {
        free(bmp);
        httpPostJson(String("/api/print/jobs/") + id + "/ack",
                     "{\"status\":\"error\",\"error\":\"printer_unavailable\"}");
        return false;
    }

    bool ok = catPrint(bmp, height);
    free(bmp);
    httpPostJson(String("/api/print/jobs/") + id + "/ack",
                 ok ? "{\"status\":\"ok\"}" : "{\"status\":\"error\",\"error\":\"print_failed\"}");
    Serial.printf("Job %s: %s\n", id, ok ? "printed" : "FAILED");
    return ok;
}

// ─── BLE CONFIG SERVICE (we are BOTH a BLE central for the printer and a
//      BLE peripheral that admins can connect to via Web Bluetooth) ──────────
//
// Service:    daa10001-1234-1234-1234-123456789abc  ("Dinn Admin Agent")
// Status R:   daa10002-...   JSON: {label, ip, rssi, wifiOk, fw, hasToken}
// Config W:   daa10003-...   write JSON: {field, value}
//                            field ∈ {wifi_ssid, wifi_identity, wifi_username,
//                                     wifi_password, server_base, device_id,
//                                     device_token}
//                            value: string
// Apply W:    daa10004-...   write "reboot" to commit & restart, or
//                            "wifi" to just retry wifi without reboot.
//
// Web Bluetooth admin flow: requestDevice({filters:[{services:[daa10001-...]}]})
// → write each field → write "reboot" to apply.

static const char* CFG_SVC = "daa10001-1234-1234-1234-123456789abc";
static const char* CFG_STATUS = "daa10002-1234-1234-1234-123456789abc";
static const char* CFG_WRITE  = "daa10003-1234-1234-1234-123456789abc";
static const char* CFG_APPLY  = "daa10004-1234-1234-1234-123456789abc";

static NimBLECharacteristic* gCfgStatus = nullptr;

static String buildStatusJson() {
    DynamicJsonDocument d(256);
    d["label"]    = gDeviceId;
    d["ip"]       = WiFi.localIP().toString();
    d["rssi"]     = (int)WiFi.RSSI();
    d["wifiOk"]   = WiFi.status() == WL_CONNECTED;
    d["fw"]       = __DATE__ " " __TIME__;
    d["hasToken"] = gDeviceToken.length() > 0;
    String out; serializeJson(d, out); return out;
}

static void publishStatus() {
    if (!gCfgStatus) return;
    String s = buildStatusJson();
    gCfgStatus->setValue(s);
    gCfgStatus->notify();
}

class CfgWriteCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
        std::string raw = c->getValue();
        Serial.printf("BLE-cfg write: %s\n", raw.c_str());
        DynamicJsonDocument d(512);
        if (deserializeJson(d, raw)) { Serial.println("BLE-cfg: bad JSON"); return; }
        const char* field = d["field"] | "";
        const char* value = d["value"] | "";
        if (!*field) return;

        // Allowlist of writeable fields → matches NVS keys
        static const char* ALLOWED[] = {
            "wifi_ssid", "wifi_identity", "wifi_username", "wifi_password",
            "server_base", "device_id", "device_token"
        };
        bool ok = false;
        for (auto k : ALLOWED) if (!strcmp(field, k)) { ok = true; break; }
        if (!ok) { Serial.printf("BLE-cfg: rejected field %s\n", field); return; }

        saveConfigField(field, String(value));
        publishStatus();
    }
};

class CfgApplyCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
        std::string cmd = c->getValue();
        Serial.printf("BLE-cfg apply: %s\n", cmd.c_str());
        if (cmd == "reboot") {
            Serial.println("BLE-cfg: rebooting in 1s...");
            delay(1000);
            ESP.restart();
        } else if (cmd == "wifi") {
            loadConfig();
            connectWifi();
            publishStatus();
        } else if (cmd == "wipe") {
            // Factory reset: clear all NVS keys so the next boot uses the
            // compiled-in DEF_* defaults. Useful when reflashing with new
            // defaults but NVS still has the old values.
            Serial.println("BLE-cfg: WIPING NVS — reboot in 1s");
            gPrefs.begin(NVS_NS, false);
            gPrefs.clear();
            gPrefs.end();
            delay(1000);
            ESP.restart();
        }
    }
};

static CfgWriteCB gCfgWriteCB;
static CfgApplyCB gCfgApplyCB;

static void startConfigGattServer() {
    NimBLEServer* server = NimBLEDevice::createServer();
    NimBLEService* svc = server->createService(CFG_SVC);

    gCfgStatus = svc->createCharacteristic(CFG_STATUS,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
    gCfgStatus->setValue(buildStatusJson());

    auto* writeChar = svc->createCharacteristic(CFG_WRITE, NIMBLE_PROPERTY::WRITE);
    writeChar->setCallbacks(&gCfgWriteCB);

    auto* applyChar = svc->createCharacteristic(CFG_APPLY, NIMBLE_PROPERTY::WRITE);
    applyChar->setCallbacks(&gCfgApplyCB);

    svc->start();

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(CFG_SVC);
    adv->setName("ESP32-printer-cfg");
    adv->start();
    Serial.println("BLE-cfg: advertising");
}

// ─── SETUP / LOOP ────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\nESP32 cat-printer bridge");

    loadConfig();

    NimBLEDevice::init("ESP32-printer");
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
    NimBLEDevice::setMTU(247);

    startConfigGattServer();
    connectWifi();
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWifi();
        delay(2000);
        return;
    }

    // Keep BLE pre-connected so jobs print immediately. Throttle reconnect
    // attempts so we don't hammer the radio if the printer is off.
    uint32_t now = millis();
    if (!gBleConnected && now >= gNextBleRetry &&
        now - gLastBleCheck >= 5000) {
        gLastBleCheck = now;
        if (!connectPrinter()) gNextBleRetry = millis() + 5000;
    }

    // processJob() blocks for ~25s on a long-poll when idle, so no extra delay
    // is needed between iterations — we already throttle naturally.
    bool worked = processJob();
    // Refresh BLE status characteristic so any admin currently connected via
    // Web Bluetooth sees live IP / wifi state.
    publishStatus();
    if (worked) delay(200);
}
