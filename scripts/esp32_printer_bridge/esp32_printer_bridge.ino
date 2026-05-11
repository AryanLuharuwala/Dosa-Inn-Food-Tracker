// ESP32 BLE cat-printer bridge.
// Implements the iPrint / SC03h wire protocol directly — same framing as
// catPrinter.ts in the web app. No third-party printer library needed.
//
// Server contract:
//   GET  /api/print/jobs/next?device=<id>   Auth: Bearer <token>
//        → 204 no job | 200 { id, width:384, height, bitmap_b64, feed_lines }
//   POST /api/print/jobs/<id>/ack           Auth: Bearer <token>
//        body: { "status": "ok" | "error" }

#include <vector>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_eap_client.h>
#include <ArduinoJson.h>
#include <mbedtls/base64.h>
#include <BLEDevice.h>
#include <BLEClient.h>
#include <BLEScan.h>

// ─── DEBUG ───────────────────────────────────────────────────────────────────
// Uncomment to skip WiFi/server and just test BLE printing.
// Upload → open Serial Monitor at 115200 → watch it scan and print a test page.
// Press Enter in Serial Monitor to print again. Comment out before deploying.
#define DEBUG_PRINT_TEST

// ─── CONFIG ──────────────────────────────────────────────────────────────────
static const char* WIFI_SSID     = "GUEST_SECURED";
static const char* WIFI_IDENTITY = "21MI31032";
static const char* WIFI_USERNAME = "21MI31032";
static const char* WIFI_PASSWORD = "$tandard4B";

static const char* SERVER_BASE  = "http://pollys.food";
static const char* DEVICE_ID    = "printer-01";
static const char* DEVICE_TOKEN = "paste-long-random-secret-here";

// Let's Encrypt ISRG Root X1 (valid until 2035-06-04).
static const char* TLS_CA_CERT = R"(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoBggIBAK3oJHP0FDfzm54rVygc
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

static const uint32_t POLL_INTERVAL_MS          = 1500;
static const uint32_t POLL_BACKOFF_MAX           = 20000;
static const uint32_t PRINTER_CHECK_INTERVAL_MS  = 20000;

// ─── STATE ───────────────────────────────────────────────────────────────────
static uint32_t backoffMs          = POLL_INTERVAL_MS;
static uint32_t lastPrinterCheckMs = 0;

// ─── CAT-PRINTER PROTOCOL ─────────────────────────────────────────────────────
// Mirrors catPrinter.ts exactly: same UUIDs, same framing, same command bytes,
// same warmup/preamble/postamble sequence from the Wireshark capture.

static const char* CAT_SVC = "0000ae30-0000-1000-8000-00805f9b34fb";
static const char* CAT_TX  = "0000ae01-0000-1000-8000-00805f9b34fb";
static const char* CAT_RX  = "0000ae02-0000-1000-8000-00805f9b34fb";
static const char* CAT_RX2 = "0000ae04-0000-1000-8000-00805f9b34fb";
static const char* CAT_RX3 = "0000ae05-0000-1000-8000-00805f9b34fb";

static const uint16_t PAPER_WIDTH   = 384;
static const uint16_t BYTES_PER_ROW = 48;   // 384 / 8

enum CatCmd : uint8_t {
    CMD_GET_INFO     = 0xa8,
    CMD_GET_STATE    = 0xa3,
    CMD_SET_DPI      = 0xa4,
    CMD_LATTICE      = 0xa6,
    CMD_FEED         = 0xa1,
    CMD_SPEED        = 0xbd,
    CMD_ENERGY       = 0xaf,
    CMD_APPLY_ENERGY = 0xbe,
    CMD_BITMAP       = 0xa2,
    CMD_WARMUP       = 0xbb,
};

static const uint8_t  LATTICE_START[11] = {0xaa,0x55,0x17,0x38,0x44,0x5f,0x5f,0x5f,0x44,0x38,0x2c};
static const uint8_t  LATTICE_END[11]   = {0xaa,0x55,0x17,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x17};
static const uint8_t  DEF_SPEED         = 30;      // 0x1E — from Wireshark capture
static const uint16_t DEF_ENERGY        = 12000;   // 0x2EE0 — from Wireshark capture
static const uint16_t FEED_LINES        = 48;      // 0x30, sent twice in postamble

// ── CRC-8 (polynomial 0x07, init 0x00) ──────────────────────────────────────
static uint8_t crc8(const uint8_t* data, size_t len) {
    uint8_t crc = 0;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++)
            crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) : (crc << 1);
    }
    return crc;
}

// Build one frame: 51 78 cmd 00 lenLo lenHi payload... crc FF
// out must be at least 8 + payLen bytes.
static size_t buildFrame(uint8_t* out, uint8_t cmd, const uint8_t* payload, uint16_t payLen) {
    out[0] = 0x51; out[1] = 0x78; out[2] = cmd; out[3] = 0x00;
    out[4] = payLen & 0xFF; out[5] = payLen >> 8;
    if (payload && payLen) memcpy(out + 6, payload, payLen);
    out[6 + payLen] = crc8(payload, payLen);
    out[7 + payLen] = 0xFF;
    return 8 + payLen;
}

// Append one framed command to a vector (used to bundle multiple frames into
// one BLE write — the iPrint firmware drops frames that arrive with gaps).
static void appendFrame(std::vector<uint8_t>& out, uint8_t cmd,
                        const uint8_t* payload, uint16_t payLen) {
    size_t pos = out.size();
    out.resize(pos + 8 + payLen);
    buildFrame(out.data() + pos, cmd, payload, payLen);
}

// ── BLE state ────────────────────────────────────────────────────────────────
static BLEClient*               gClient    = nullptr;
static BLERemoteCharacteristic* gTxChar    = nullptr;
static bool                     gConnected = false;
static bool                     gWarmedUp  = false;
static BLEAddress*              gFoundAddr = nullptr;
static std::string              gFoundName;

class ScanCB : public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice dev) override {
        if (dev.haveServiceUUID() && dev.isAdvertisingService(BLEUUID(CAT_SVC))) {
            Serial.printf("BLE: found \"%s\" (%s)\n",
                dev.getName().c_str(), dev.getAddress().toString().c_str());
            BLEDevice::getScan()->stop();
            delete gFoundAddr;
            gFoundAddr = new BLEAddress(dev.getAddress());
            gFoundName = dev.getName();
        }
    }
} gScanCB;

// Chunked write — BLE MTU is often 20-185 bytes; 100-byte chunks match catPrinter.ts.
static bool bleWrite(const uint8_t* data, size_t len) {
    if (!gTxChar || !gClient || !gClient->isConnected()) return false;
    const size_t CHUNK = 100;
    for (size_t i = 0; i < len; i += CHUNK) {
        size_t n = (len - i < CHUNK) ? (len - i) : CHUNK;
        gTxChar->writeValue((uint8_t*)data + i, n, false); // writeWithoutResponse
    }
    return true;
}
static bool bleWriteVec(const std::vector<uint8_t>& v) { return bleWrite(v.data(), v.size()); }

bool catIsConnected() {
    return gConnected && gClient && gClient->isConnected() && gTxChar;
}

static void catDisconnect() {
    gWarmedUp = false; gConnected = false; gTxChar = nullptr;
    if (gClient && gClient->isConnected()) gClient->disconnect();
}

static bool catScanAndConnect() {
    delete gFoundAddr; gFoundAddr = nullptr;

    Serial.println("BLE: scanning for ae30 service (8s)...");
    BLEScan* scan = BLEDevice::getScan();
    scan->setAdvertisedDeviceCallbacks(&gScanCB, true);
    scan->setActiveScan(true);
    scan->start(8, false);
    scan->clearResults();

    if (!gFoundAddr) {
        Serial.println("BLE: no cat-printer found");
        return false;
    }

    // Fresh client each attempt for clean state
    if (gClient) {
        if (gClient->isConnected()) gClient->disconnect();
        delete gClient;
    }
    gClient = BLEDevice::createClient();

    Serial.printf("BLE: connecting to %s ...\n", gFoundAddr->toString().c_str());
    if (!gClient->connect(*gFoundAddr)) {
        Serial.println("BLE: connect failed");
        return false;
    }
    delay(200);

    BLERemoteService* svc = gClient->getService(BLEUUID(CAT_SVC));
    if (!svc) {
        Serial.println("BLE: ae30 service not found post-connect");
        gClient->disconnect(); return false;
    }

    gTxChar = svc->getCharacteristic(BLEUUID(CAT_TX));
    if (!gTxChar) {
        Serial.println("BLE: ae01 TX characteristic not found");
        gClient->disconnect(); return false;
    }

    // Subscribe to RX notifications before any write — iPrint firmware silently
    // drops writes if these aren't subscribed first (from Wireshark capture).
    const char* rxUUIDs[] = {CAT_RX, CAT_RX2, CAT_RX3};
    for (const char* uuid : rxUUIDs) {
        auto* rx = svc->getCharacteristic(BLEUUID(uuid));
        if (rx && (rx->canNotify() || rx->canIndicate()))
            rx->registerForNotify(nullptr);
    }

    gConnected = true; gWarmedUp = false;
    Serial.printf("BLE: connected to \"%s\"\n", gFoundName.c_str());
    return true;
}

static bool ensurePrinter() {
    if (catIsConnected()) return true;
    gConnected = false; gTxChar = nullptr;
    return catScanAndConnect();
}

// ── Print sequence (mirrors catPrinter.ts catPrint()) ────────────────────────

static void catWarmup() {
    if (gWarmedUp) return;
    uint8_t z = 0x00, w = 0x01;
    // Bundle A: GetDeviceInfo + GetDeviceState — one combined write like iPrint
    std::vector<uint8_t> a;
    appendFrame(a, CMD_GET_INFO,  &z, 1);
    appendFrame(a, CMD_GET_STATE, &z, 1);
    bleWriteVec(a);
    delay(50);
    // Bundle B: 0xBB warmup
    std::vector<uint8_t> b;
    appendFrame(b, CMD_WARMUP, &w, 1);
    bleWriteVec(b);
    delay(100);
    gWarmedUp = true;
}

static void catPreamble() {
    uint8_t z = 0x00, dpi = 0x33, ae = 0x00, spd = DEF_SPEED;
    uint8_t energy[2] = { (uint8_t)(DEF_ENERGY & 0xFF), (uint8_t)(DEF_ENERGY >> 8) };
    // All six preamble commands bundled into one write
    std::vector<uint8_t> p;
    appendFrame(p, CMD_GET_STATE,    &z,            1);
    appendFrame(p, CMD_SET_DPI,      &dpi,          1);
    appendFrame(p, CMD_LATTICE,      LATTICE_START, 11);
    appendFrame(p, CMD_ENERGY,       energy,         2);
    appendFrame(p, CMD_APPLY_ENERGY, &ae,            1);
    appendFrame(p, CMD_SPEED,        &spd,           1);
    bleWriteVec(p);
    delay(50);
}

static void catPostamble() {
    uint8_t s19 = 0x19, z = 0x00;
    uint8_t feed[2] = { (uint8_t)(FEED_LINES & 0xFF), (uint8_t)(FEED_LINES >> 8) };
    std::vector<uint8_t> p;
    appendFrame(p, CMD_SPEED,     &s19,         1);
    appendFrame(p, CMD_FEED,      feed,          2);
    appendFrame(p, CMD_FEED,      feed,          2);  // sent twice in capture
    appendFrame(p, CMD_SPEED,     &s19,         1);
    appendFrame(p, CMD_LATTICE,   LATTICE_END,  11);
    appendFrame(p, CMD_GET_STATE, &z,            1);
    bleWriteVec(p);
    delay(500);
}

static bool catPrint(const uint8_t* bmp, uint16_t height) {
    if (!catIsConnected()) return false;
    catWarmup();
    catPreamble();
    uint8_t row[8 + BYTES_PER_ROW];
    for (uint16_t y = 0; y < height; y++) {
        buildFrame(row, CMD_BITMAP, bmp + (uint32_t)y * BYTES_PER_ROW, BYTES_PER_ROW);
        if (!bleWrite(row, sizeof(row))) {
            Serial.printf("BLE write failed at row %u\n", y);
            catDisconnect();
            return false;
        }
        if (y < height - 1) delay(10);
    }
    catPostamble();
    return true;
}

// ─── WIFI ────────────────────────────────────────────────────────────────────
static void connectWifi() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);
    esp_eap_client_set_identity((uint8_t*)WIFI_IDENTITY, strlen(WIFI_IDENTITY));
    esp_eap_client_set_username((uint8_t*)WIFI_USERNAME, strlen(WIFI_USERNAME));
    esp_eap_client_set_password((uint8_t*)WIFI_PASSWORD, strlen(WIFI_PASSWORD));
    esp_wifi_sta_enterprise_enable();
    WiFi.begin(WIFI_SSID);
    Serial.printf("WiFi: joining %s ", WIFI_SSID);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
        delay(500); Serial.print('.');
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("WiFi: connected  IP=%s  RSSI=%d\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    else
        Serial.println("WiFi: failed, will retry");
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
static int httpGet(const String& path, String& outBody) {
    WiFiClientSecure tls; tls.setCACert(TLS_CA_CERT);
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
    WiFiClientSecure tls; tls.setCACert(TLS_CA_CERT);
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
    int code = httpGet(String("/api/print/jobs/next?device=") + DEVICE_ID, body);
    if (code == 204) return false;
    if (code != 200) { Serial.printf("HTTP poll: %d\n", code); return false; }

    DynamicJsonDocument doc(96 * 1024);
    if (deserializeJson(doc, body)) { Serial.println("JSON parse error"); return false; }

    const char* id     = doc["id"]         | "";
    uint16_t    width  = doc["width"]      | 384;
    uint16_t    height = doc["height"]     | 0;
    const char* bmpB64 = doc["bitmap_b64"] | "";
    if (!*id || !*bmpB64 || height == 0) { Serial.println("Job: missing fields"); return false; }

    size_t expect = (size_t)((width + 7) / 8) * height;
    uint8_t* bmp = (uint8_t*)heap_caps_malloc(expect + 4, MALLOC_CAP_8BIT);
    if (!bmp) { Serial.println("OOM"); return false; }

    size_t binLen = 0;
    if (mbedtls_base64_decode(bmp, expect + 4, &binLen,
                              (const uint8_t*)bmpB64, strlen(bmpB64)) != 0 || binLen != expect) {
        Serial.printf("base64 error: got %u expected %u\n", (unsigned)binLen, (unsigned)expect);
        free(bmp); return false;
    }

    Serial.printf("Job %s: %ux%u px\n", id, width, height);
    if (!ensurePrinter()) {
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

// ─── DEBUG TEST ──────────────────────────────────────────────────────────────
#ifdef DEBUG_PRINT_TEST
static void debugPrintTest() {
    Serial.println("\n--- Cat-Printer Debug Test ---");
    if (!ensurePrinter()) return;

    // Geometric test pattern — no font rendering needed on ESP32.
    // Solid bars, diagonal stripes, checkerboard, and side borders let you
    // verify connection, print direction, and pixel accuracy at a glance.
    const uint16_t H = 200;
    uint8_t* bmp = (uint8_t*)calloc(BYTES_PER_ROW * H, 1); // all-white
    if (!bmp) { Serial.println("OOM"); return; }

    // Solid black header bar (rows 0–7)
    for (int y = 0; y < 8; y++)
        memset(bmp + y * BYTES_PER_ROW, 0xFF, BYTES_PER_ROW);

    // Alternating horizontal stripes (rows 16–31)
    for (int y = 16; y < 32; y++)
        memset(bmp + y * BYTES_PER_ROW, (y & 1) ? 0xAA : 0x55, BYTES_PER_ROW);

    // Checkerboard (rows 40–55) — proves pixel-level accuracy
    for (int y = 40; y < 56; y++)
        for (int x = 0; x < BYTES_PER_ROW; x++)
            bmp[y * BYTES_PER_ROW + x] = ((y ^ x) & 1) ? 0xAA : 0x55;

    // Left + right border pixels (rows 64–135)
    for (int y = 64; y < 136; y++) {
        bmp[y * BYTES_PER_ROW + 0]  = 0x80; // leftmost pixel
        bmp[y * BYTES_PER_ROW + 47] = 0x01; // rightmost pixel
    }

    // Solid black footer bar (rows 192–199)
    for (int y = H - 8; y < H; y++)
        memset(bmp + y * BYTES_PER_ROW, 0xFF, BYTES_PER_ROW);

    Serial.println("Sending test pattern...");
    bool ok = catPrint(bmp, H);
    free(bmp);
    Serial.printf("Result: %s\n", ok ? "OK — check the paper" : "FAILED");
}
#endif

// ─── ARDUINO ENTRY POINTS ────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(200);
    BLEDevice::init("ESP32-Printer");

#ifdef DEBUG_PRINT_TEST
    Serial.println("\n[DEBUG] BLE test — WiFi/server skipped");
    debugPrintTest();
    return;
#endif

    Serial.println("\nESP32 cat-printer bridge");
    connectWifi();
}

void loop() {
#ifdef DEBUG_PRINT_TEST
    if (Serial.available()) {
        while (Serial.available()) Serial.read();
        debugPrintTest();
    }
    delay(100);
    return;
#endif

    if (WiFi.status() != WL_CONNECTED) { connectWifi(); delay(2000); return; }

    // Proactive keepalive — keeps printer pre-connected so jobs print immediately
    uint32_t now = millis();
    if (now - lastPrinterCheckMs >= PRINTER_CHECK_INTERVAL_MS) {
        ensurePrinter();
        lastPrinterCheckMs = millis();
    }

    bool worked = processNextJob();
    if (worked) {
        backoffMs = POLL_INTERVAL_MS;
        lastPrinterCheckMs = millis();
    } else {
        delay(backoffMs);
        backoffMs = min<uint32_t>(backoffMs + 500, POLL_BACKOFF_MAX);
    }
}
