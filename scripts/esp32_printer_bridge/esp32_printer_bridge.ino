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

// Declared up here so Arduino's auto-generated prototypes (which are emitted
// at the top of the file before the BUZZER section) can see BuzzMode.
enum BuzzMode {
    BUZZ_OFF,
    BUZZ_PRESS,
    BUZZ_RING,
    BUZZ_OK,
    BUZZ_ERROR,
    BUZZ_WIFI_DISC,
    BUZZ_BLE_DISC,
};

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Compiled-in defaults. At boot, ESP loads values from NVS and falls back to
// these if the NVS slot is empty. After BLE-config writes new values, they
// persist to NVS and survive reboots.

static const char* DEF_WIFI_SSID     = "GUEST_SECURED";
static const char* DEF_WIFI_IDENTITY = "21MI31032";// empty for plain WPA2
static const char* DEF_WIFI_USERNAME = "21MI31032";
static const char* DEF_WIFI_PASSWORD = "$tandard4B";

static const char* DEF_SERVER_BASE  = "https://pollys.food";
static const char* DEF_DEVICE_ID    = "printer";
static const char* DEF_DEVICE_TOKEN = "PG82uQl3hbqvK8AIcYg_boIRbEhlBO6_Y6fWJ4yrSHA";

// Live, in-RAM config (loaded from NVS at boot). All read paths use these.
static String gWifiSsid, gWifiIdentity, gWifiUsername, gWifiPassword;
static String gServerBase, gDeviceId, gDeviceToken;

// Server-pushed runtime settings (refreshed on every long-poll response).
static uint8_t  gSpeed     = 34;
static uint16_t gEnergy    = 13500;
// New-order tone behaviour. true = short (single chime then silence),
// false = long (chime loops until silenced by a button press).
static bool     gRingShort = true;

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
}

// Trust anchors for pollys.food, now fronted by a cloudflared tunnel whose
// edge cert is issued by Google Trust Services:
//   leaf CN=pollys.food  →  intermediate CN=WE1  →  root CN=GTS Root R4
// We pin BOTH the GTS Root R4 root AND the WE1 intermediate as anchors. The
// leaf rotates every ~90 days but always under WE1 (valid to 2029-02), and R4
// covers the standard path (valid to 2036-06) — either anchor validates the
// leaf, so a routine renewal can't break us. Re-export from Chrome
// (about:certificate) and replace these if GTS ever moves the chain.
// Verified: `openssl verify -CAfile root -untrusted intermediate leaf` → OK.
static const char* TLS_CA_CERT = R"(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICnzCCAiWgAwIBAgIQf/MZd5csIkp2FV0TttaF4zAKBggqhkjOPQQDAzBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjQwHhcNMjMxMjEzMDkwMDAwWhcNMjkwMjIwMTQw
MDAwWjA7MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVR29vZ2xlIFRydXN0IFNlcnZp
Y2VzMQwwCgYDVQQDEwNXRTEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARvzTr+
Z1dHTCEDhUDCR127WEcPQMFcF4XGGTfn1XzthkubgdnXGhOlCgP4mMTG6J7/EFmP
LCaY9eYmJbsPAvpWo4H+MIH7MA4GA1UdDwEB/wQEAwIBhjAdBgNVHSUEFjAUBggr
BgEFBQcDAQYIKwYBBQUHAwIwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU
kHeSNWfE/6jMqeZ72YB5e8yT+TgwHwYDVR0jBBgwFoAUgEzW63T/STaj1dj8tT7F
avCUHYwwNAYIKwYBBQUHAQEEKDAmMCQGCCsGAQUFBzAChhhodHRwOi8vaS5wa2ku
Z29vZy9yNC5jcnQwKwYDVR0fBCQwIjAgoB6gHIYaaHR0cDovL2MucGtpLmdvb2cv
ci9yNC5jcmwwEwYDVR0gBAwwCjAIBgZngQwBAgEwCgYIKoZIzj0EAwMDaAAwZQIx
AOcCq1HW90OVznX+0RGU1cxAQXomvtgM8zItPZCuFQ8jSBJSjz5keROv9aYsAm5V
sQIwJonMaAFi54mrfhfoFNZEfuNMSQ6/bIBiNLiyoX46FohQvKeIoJ99cx7sUkFN
7uJW
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

// ─── BUZZER + BUTTONS (non-blocking state machine) ───────────────────────────
//
// Pins:
//   GPIO 15        — piezo buzzer (PWM tone)
//   GPIO 14/9/22   — momentary action buttons (LOW = pressed)
//
// Buzzer modes:
//   BUZZ_PRESS     — short button-press click
//   BUZZ_RING      — looping C-E-G chime, used when a new print job arrived;
//                    stops on any button press
//   BUZZ_OK        — two-note success ding after a print
//   BUZZ_ERROR     — two-note descending sad-trombone after a print failure
//   BUZZ_WIFI_DISC — periodic low beep while WiFi is down
//   BUZZ_BLE_DISC  — periodic mid beep while the printer link is down

static const uint8_t BUZZER_PIN     = 15;
static const uint8_t BTN_TOGGLES[]  = { 14, 9, 22 };
static const size_t  N_TOGGLES      = sizeof(BTN_TOGGLES) / sizeof(BTN_TOGGLES[0]);
// Onboard green LED on ESP32-C6 DevKitC. Toggled on every button-press
// detection so we can visually verify the chip is registering presses even
// when the buzzer is silent (e.g. after wake, while debugging).
static const uint8_t ONBOARD_LED    = 8;
static bool          gLedState      = false;

static void toggleOnboardLed() {
    gLedState = !gLedState;
    digitalWrite(ONBOARD_LED, gLedState ? HIGH : LOW);
}

static BuzzMode  gBuzzMode      = BUZZ_OFF;
static uint32_t  gBuzzStart     = 0;

// For disconnect alarms — we only start them after the device has been down
// for a few seconds, so a quick blip doesn't trigger noise.
static uint32_t  gWifiDownSince = 0;
static uint32_t  gBleDownSince  = 0;

static void buzzerSilence() {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
}

static void setBuzz(BuzzMode m) {
    gBuzzMode  = m;
    gBuzzStart = millis();
    if (m == BUZZ_OFF) buzzerSilence();
}

static void buzzerInit() {
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
}

/** Drive the buzzer non-blockingly based on current mode. Must be called
 *  every loop iteration. */
static void buzzerTick() {
    const uint32_t elapsed = millis() - gBuzzStart;
    switch (gBuzzMode) {
        case BUZZ_OFF:
            break;
        case BUZZ_PRESS:
            if (elapsed < 80) tone(BUZZER_PIN, 1500); else setBuzz(BUZZ_OFF);
            break;
        case BUZZ_RING: {
            // Ascending C-E-G chime. If gRingShort, play exactly once and
            // stop. If long, loop with a ~1.9s rest between cycles until a
            // button press silences it.
            const uint32_t t = gRingShort ? elapsed : (elapsed % 3000);
            int hz = 0;
            if      (t < 240)              hz = 523;
            else if (t >= 320 && t < 560)  hz = 659;
            else if (t >= 640 && t < 1100) hz = 784;
            if (hz) tone(BUZZER_PIN, hz); else buzzerSilence();
            // Short mode: after the chime finishes (~1.1s), terminate.
            if (gRingShort && elapsed >= 1200) setBuzz(BUZZ_OFF);
            break;
        }
        case BUZZ_OK:
            if      (elapsed < 90)  tone(BUZZER_PIN, 1047);          // C6
            else if (elapsed < 110) buzzerSilence();
            else if (elapsed < 240) tone(BUZZER_PIN, 1568);          // G6
            else                    setBuzz(BUZZ_OFF);
            break;
        case BUZZ_ERROR:
            if      (elapsed < 200) tone(BUZZER_PIN, 392);           // G4
            else if (elapsed < 230) buzzerSilence();
            else if (elapsed < 580) tone(BUZZER_PIN, 311);           // Eb4
            else                    setBuzz(BUZZ_OFF);
            break;
        case BUZZ_WIFI_DISC: {
            // Tiny click every 5s — present but not annoying.
            const uint32_t phase = elapsed % 5000;
            if (phase < 15) tone(BUZZER_PIN, 400); else buzzerSilence();
            break;
        }
        case BUZZ_BLE_DISC: {
            // Tiny click every 5s, different pitch from wifi.
            const uint32_t phase = elapsed % 5000;
            if (phase < 15) tone(BUZZER_PIN, 700); else buzzerSilence();
            break;
        }
    }
}

static bool isAlarmActive() {
    return gBuzzMode == BUZZ_RING || gBuzzMode == BUZZ_WIFI_DISC || gBuzzMode == BUZZ_BLE_DISC;
}

// ── Synchronous transition beeps ─────────────────────────────────────────────
// Short blocking patterns used at one-shot state changes (power-on, wifi up,
// ble scan, ble up). These bypass the state machine because the events
// happen on code paths that are themselves blocking anyway.

// IO-task pause flag — declared here (before blockingChord uses it). The
// ioTask polls this each iteration; while true the task skips its work, so
// the main thread can call tone() without racing.
static volatile bool gIoTaskPaused = false;

static void blockingChord(const int* notes, const int* durs, size_t n) {
    // Pause the IO task so it doesn't simultaneously call tone() and corrupt
    // the LEDC channel state. Restore the previous pause state at the end so
    // nested callers (that already paused it) don't unpause prematurely.
    const bool wasPaused = gIoTaskPaused;
    gIoTaskPaused = true;
    delay(20);   // let the IO task land on its vTaskDelay

    setBuzz(BUZZ_OFF);
    for (size_t i = 0; i < n; i++) {
        if (notes[i] > 0) tone(BUZZER_PIN, notes[i]);
        else              noTone(BUZZER_PIN);
        delay(durs[i]);
    }
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);

    gIoTaskPaused = wasPaused;
}

/** Quick two-note rise — "wifi connected". */
static void beepWifiUp() {
    static const int n[] = {659, 0, 988};
    static const int d[] = { 70, 25, 100};
    blockingChord(n, d, 3);
}

/** Short single chirp — "starting BLE scan". */
static void beepBleScan() {
    static const int n[] = {1500};
    static const int d[] = {  40};
    blockingChord(n, d, 1);
}

/** Two-note success — "BLE printer connected". */
static void beepBleUp() {
    static const int n[] = {1047, 0, 1568};
    static const int d[] = {  60, 20,  100};
    blockingChord(n, d, 3);
}

static void onAnyButtonPressed() {
    // Any press silences a running alarm. Otherwise emit a short click.
    if (isAlarmActive()) setBuzz(BUZZ_OFF);
    else                 setBuzz(BUZZ_PRESS);
}

// Button-action flags cross thread boundaries: the IO task detects the press
// and sets a flag; the main loop services it so the heavy operations
// (catPrint, ESP.restart) don't run on the IO task's small stack.
static volatile bool gWantsReprint     = false;   // GPIO 14
static volatile bool gWantsTestPrint   = false;   // GPIO 9
static volatile bool gWantsStatus      = false;   // GPIO 22

// Cached bitmap of the most recently printed job. Used by the reprint button.
// One slot; previous content is freed when a new print succeeds.
static uint8_t* gLastBmp    = nullptr;
static uint16_t gLastHeight = 0;

// FreeRTOS task that runs buttonsTick() and buzzerTick() at ~60 Hz on its
// own stack. Keeps button feedback + alarms responsive even while the main
// loop is blocked inside HTTPClient on a long-poll.
//
// `gIoTaskPaused` (declared above) lets the main loop quiesce this task
// before fiddling with shared hardware (e.g. playing a synchronous beep that
// calls tone()).
static void ioTask(void* arg) {
    noTone(BUZZER_PIN);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    setBuzz(BUZZ_OFF);
    // First second: suppress phantom press feedback so switches already in
    // the LOW position at task start don't beep.
    const uint32_t silentUntil = millis() + 1000;

    for (;;) {
        if (!gIoTaskPaused) {
            const BuzzMode preTickMode = gBuzzMode;
            buttonsTick();
            if (millis() < silentUntil && gBuzzMode == BUZZ_PRESS && preTickMode != BUZZ_PRESS) {
                setBuzz(BUZZ_OFF);
            }
            buzzerTick();
        }
        vTaskDelay(pdMS_TO_TICKS(15));
    }
}

/** Reassert pullups on every input button. Arduino's pinMode(INPUT_PULLUP)
 *  doesn't always stick on ESP32-C6 — the IO-mux can come up in a state that
 *  leaves the pad floating. Calling the IDF gpio_set_pull_mode directly is
 *  the only reliable way. */
static void forceButtonPullups() {
    for (size_t i = 0; i < N_TOGGLES; i++) {
        gpio_set_direction((gpio_num_t)BTN_TOGGLES[i], GPIO_MODE_INPUT);
        gpio_set_pull_mode((gpio_num_t)BTN_TOGGLES[i], GPIO_PULLUP_ONLY);
    }
}

static TaskHandle_t gIoTaskHandle = NULL;

static void startIoTask() {
    if (gIoTaskHandle != NULL) return;
    xTaskCreate(ioTask, "io", 4096, NULL, 1, &gIoTaskHandle);
}

static void buttonsInit() {
    forceButtonPullups();
    pinMode(ONBOARD_LED, OUTPUT);
    digitalWrite(ONBOARD_LED, LOW);
    startIoTask();
}

/** Poll all action buttons. Toggle buttons fire on press-edge (with 20ms
 *  debounce).
 *
 *  On the first call after a (re)start, we ADOPT the current pin states as
 *  the baseline — so a toggle switch that's already in the LOW position
 *  doesn't generate a phantom press event. */
static void buttonsTick() {
    static bool     prevToggle[3]      = { false, false, false };
    static uint32_t lastToggleChange[3] = { 0, 0, 0 };
    static bool     initialized        = false;

    const uint32_t now = millis();
    if (!initialized) {
        for (size_t i = 0; i < N_TOGGLES; i++) {
            prevToggle[i] = digitalRead(BTN_TOGGLES[i]) == LOW;
            lastToggleChange[i] = now;
        }
        initialized = true;
    }

    const uint32_t DEBOUNCE_MS = 20;
    for (size_t i = 0; i < N_TOGGLES; i++) {
        const bool reading = digitalRead(BTN_TOGGLES[i]) == LOW;
        if (reading != prevToggle[i]) {
            if (now - lastToggleChange[i] >= DEBOUNCE_MS) {
                prevToggle[i] = reading;
                lastToggleChange[i] = now;
                if (reading) {        // transitioned to LOW = "pressed"
                    toggleOnboardLed();
                    onAnyButtonPressed();
                    // Map each toggle button to a specific action. Flag is
                    // set here (IO task); the main loop dispatches it so the
                    // heavy operations (catPrint, ESP.restart) don't run on
                    // the IO task's small stack.
                    switch (BTN_TOGGLES[i]) {
                        case 14: gWantsReprint   = true; break;
                        case  9: gWantsTestPrint = true; break;
                        case 22: gWantsStatus    = true; break;
                    }
                }
            }
        } else {
            lastToggleChange[i] = now;
        }
    }
}

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
            gDev = (NimBLEAdvertisedDevice*)dev;
            NimBLEDevice::getScan()->stop();
        }
    }
} gScanCB;

class ClientCB : public NimBLEClientCallbacks {
    void onConnect(NimBLEClient* c) override {
        gBleConnected = true;
    }
    void onDisconnect(NimBLEClient* c, int reason) override {
        Serial.printf("BLE: link down (reason=%d)\n", reason);
        gBleConnected = false;
        gTx           = nullptr;
        gDev          = nullptr;
        gNextBleRetry = millis() + 2000;
    }
    void onConnectFail(NimBLEClient* c, int reason) override {
        Serial.printf("BLE: connect fail (%d)\n", reason);
    }
} gClientCB;

static bool connectPrinter() {
    if (gBleConnected && gTx) return true;

    beepBleScan();
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
    if (!gDev) return false;

    if (gClient) {
        if (gClient->isConnected()) gClient->disconnect();
        NimBLEDevice::deleteClient(gClient);
        gClient = nullptr;
    }
    gClient = NimBLEDevice::createClient();
    gClient->setClientCallbacks(&gClientCB, false);
    gClient->setConnectionParams(24, 24, 0, 500);
    gClient->setConnectTimeout(10 * 1000);

    if (!gClient->connect(gDev)) return false;

    auto svc = gClient->getService(SVC_UUID);
    if (!svc) { gClient->disconnect(); return false; }
    gTx = svc->getCharacteristic(TX_UUID);
    if (!gTx) { gClient->disconnect(); return false; }

    for (auto u : RX_UUIDS) {
        auto* rx = svc->getCharacteristic(u);
        if (rx && (rx->canNotify() || rx->canIndicate())) rx->subscribe(true, onNotify);
    }

    uint16_t mtu = gClient->getMTU();
    gChunkSize = (mtu > 3) ? (size_t)(mtu - 3) : 20;
    if (gChunkSize > 200) gChunkSize = 200;
    Serial.printf("BLE: printer linked  MTU=%u\n", mtu);
    beepBleUp();
    if (gBuzzMode == BUZZ_BLE_DISC) setBuzz(BUZZ_OFF);
    delay(100);
    return true;
}

// ─── WIFI (WPA2-Enterprise or plain WPA2) ────────────────────────────────────
// Non-blocking: kicks off the connection and returns immediately. The IDF
// stack handles association in the background; we react via the WiFi event
// callback to play the "wifi up" tone and clear any disconnect alarm.
// Loop code never blocks on WiFi — it just checks WiFi.status() and skips
// HTTP work if down.

static volatile bool gWifiUpEvent = false;

static void onWifiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            gWifiUpEvent = true;
            break;
        default:
            break;
    }
}

static void connectWifi() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);
    // Cap WiFi TX power to tame the association inrush current — the spike at
    // WiFi.begin() is the single biggest brownout trigger. 8.5 dBm is fine for
    // a typical room; raise it if association becomes unreliable once the
    // device boots without resetting.
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);
    WiFi.onEvent(onWifiEvent);

    if (gWifiIdentity.length() > 0) {
        esp_eap_client_set_identity((uint8_t*)gWifiIdentity.c_str(), gWifiIdentity.length());
        esp_eap_client_set_username((uint8_t*)gWifiUsername.c_str(), gWifiUsername.length());
        esp_eap_client_set_password((uint8_t*)gWifiPassword.c_str(), gWifiPassword.length());
        esp_wifi_sta_enterprise_enable();
        WiFi.begin(gWifiSsid.c_str());
    } else {
        WiFi.begin(gWifiSsid.c_str(), gWifiPassword.c_str());
    }
    Serial.printf("WiFi: kicked off association to %s (non-blocking)\n",
                  gWifiSsid.c_str());
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

// DIAGNOSTIC: when defined, the TLS client accepts ANY certificate. Now that
// TLS_CA_CERT pins the real GTS Root R4 + WE1 chain, this is OFF so both GET
// and POST validate the server. Re-enable ONLY to debug a cert/path issue.
// #define TLS_INSECURE_DEBUG

static int httpGet(const String& path, String& out, uint32_t timeoutMs = 15000) {
    String url = forceHttps(gServerBase) + path;
    HTTPClient http;
    bool began;
    if (isHttps()) {
        WiFiClientSecure tls;
#ifdef TLS_INSECURE_DEBUG
        tls.setInsecure();   // accepts ANY cert — temporary diagnostic
#else
        tls.setCACert(TLS_CA_CERT);
#endif
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
        WiFiClientSecure tls;
#ifdef TLS_INSECURE_DEBUG
        tls.setInsecure();   // accepts ANY cert — matches httpGet so acks work
                             // over the cloudflared tunnel (LE/Google cert,
                             // not the pinned DigiCert root).
#else
        tls.setCACert(TLS_CA_CERT);
#endif
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

// ─── SELF-REGISTRATION (WPS-style pairing) ──────────────────────────────────
// Additive to the BLE config service above, not a replacement for it — that
// still exists for provisioning WiFi/server/token by hand. This path is for
// the token specifically: once WiFi is up, an ESP with no working token can
// ask the server to be paired without any Bluetooth step at all. The admin
// approves it once from /admin/print-devices ("Accept" button); this device
// picks the token up on its next poll here. No auth header on this request
// — that's the whole point, we don't have a token yet.
static int httpPostJsonGetBody(const String& path, const String& body, String& out, uint32_t timeoutMs = 15000) {
    String url = forceHttps(gServerBase) + path;
    HTTPClient http;
    WiFiClientSecure tls;
#ifdef TLS_INSECURE_DEBUG
    tls.setInsecure();
#else
    tls.setCACert(TLS_CA_CERT);
#endif
    if (!http.begin(tls, url)) { Serial.printf("HTTP begin failed: %s\n", url.c_str()); return -100; }
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(timeoutMs);
    int code = http.POST(body);
    if (code > 0) out = http.getString();
    else Serial.printf("HTTP err %d: %s (url=%s)\n", code, http.errorToString(code).c_str(), url.c_str());
    http.end();
    return code;
}

/** Ask the server to pair this device by its WiFi MAC. Returns true (and
 *  saves the new token to NVS) once an admin has pressed Accept; false
 *  means "still pending" or a transient error — the caller just retries. */
static bool tryRegister() {
    DynamicJsonDocument reqDoc(128);
    reqDoc["euid"] = WiFi.macAddress();
    String reqBody;
    serializeJson(reqDoc, reqBody);

    String respBody;
    int code = httpPostJsonGetBody("/api/print/devices/register", reqBody, respBody);
    if (code != 200) {
        Serial.printf("register: HTTP %d\n", code);
        return false;
    }

    DynamicJsonDocument doc(512);
    if (deserializeJson(doc, respBody)) {
        Serial.println("register: JSON parse error");
        return false;
    }

    const char* status = doc["status"] | "";
    if (strcmp(status, "approved") == 0) {
        const char* token = doc["token"] | "";
        if (!*token) { Serial.println("register: approved but no token in response"); return false; }
        gDeviceToken = String(token);
        saveConfigField("device_token", gDeviceToken);
        Serial.println("register: approved — token saved, resuming normal operation");
        return true;
    }

    Serial.println("register: still pending — waiting for admin to press Accept");
    return false;
}

static const uint32_t REGISTER_POLL_MS = 5000;

// ─── JOB LOOP ────────────────────────────────────────────────────────────────
// Long-poll the server. The endpoint always returns 200 with this shape:
//   { settings: { role, speed, energy }, job: null | { id, width, height, bitmap_b64 } }
// `settings` is refreshed every cycle so admin tweaks apply on the next print.
// Shortened from 25→10 because GUEST_SECURED kills idle TCP connections
// somewhere around 20-30s. Each long-poll completes well within the firewall's
// idle timeout, at the cost of ~3× more requests/min. Trade is fine.
static const uint32_t LONG_POLL_SEC     = 10;
static const uint32_t LONG_POLL_HTTP_MS = (LONG_POLL_SEC + 8) * 1000;
static bool processJob() {
    String body;
    uint32_t t0 = millis();
    int code = httpGet(
        String("/api/print/jobs/next?device=") + gDeviceId +
        "&wait=" + String(LONG_POLL_SEC),
        body, LONG_POLL_HTTP_MS);
    uint32_t dt = millis() - t0;

    if (code == 401) {
        // No working token (never paired, or revoked) — self-register
        // instead of hammering the jobs endpoint. Once tryRegister() saves
        // an approved token, the next loop iteration resumes normal polling
        // on its own; no separate mode flag needed.
        Serial.println("HTTP poll: 401 — no valid token, attempting self-registration");
        tryRegister();
        delay(REGISTER_POLL_MS);
        return false;
    }
    if (code != 200) { Serial.printf("HTTP poll: %d (%lums)\n", code, (unsigned long)dt); return false; }

    DynamicJsonDocument doc(96 * 1024);
    if (deserializeJson(doc, body)) { Serial.println("JSON parse error"); return false; }

    // Apply settings on every cycle — cheap, idempotent.
    if (doc["settings"].is<JsonObject>()) {
        uint8_t  newSpeed  = doc["settings"]["speed"]  | gSpeed;
        uint16_t newEnergy = doc["settings"]["energy"] | gEnergy;
        const char* newRing = doc["settings"]["ring"] | (gRingShort ? "short" : "long");
        const bool newRingShort = strcmp(newRing, "short") == 0;
        if (newSpeed != gSpeed || newEnergy != gEnergy || newRingShort != gRingShort) {
            Serial.printf("settings: speed %u→%u energy %u→%u ring=%s\n",
                          gSpeed, newSpeed, gEnergy, newEnergy, newRing);
            gSpeed     = newSpeed;
            gEnergy    = newEnergy;
            gRingShort = newRingShort;
        }
    }

    if (doc["job"].isNull() || !doc["job"].is<JsonObject>()) {
        return false;   // long-poll returned with no job — silent in prod
    }

    JsonObject job = doc["job"];
    const char* id     = job["id"]         | "";
    uint16_t    height = job["height"]     | 0;
    const char* bmpB64 = job["bitmap_b64"] | "";
    uint8_t     copies = job["copies"]     | 1;
    if (copies < 1) copies = 1;
    if (copies > 10) copies = 10;
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

    Serial.printf("Job %s: 384x%u × %u copies\n", id, height, copies);
    setBuzz(BUZZ_RING);   // new-order alert (short or long per settings)

    if (!connectPrinter()) {
        free(bmp);
        httpPostJson(String("/api/print/jobs/") + id + "/ack",
                     "{\"status\":\"error\",\"error\":\"printer_unavailable\"}");
        setBuzz(BUZZ_ERROR);
        return false;
    }

    // Print N copies from a single fetch. One ack at the end.
    bool ok = true;
    for (uint8_t c = 0; c < copies && ok; c++) {
        if (copies > 1) Serial.printf("  copy %u/%u\n", c + 1, copies);
        ok = catPrint(bmp, height);
        if (c + 1 < copies) delay(150);    // small gap between copies
    }
    if (ok) {
        // Transfer ownership to the reprint cache. Free any previously cached
        // bitmap; bmp will live on (referenced by gLastBmp) until the next
        // successful print replaces it.
        free(gLastBmp);
        gLastBmp    = bmp;
        gLastHeight = height;
        bmp = nullptr;        // don't double-free below
    }
    if (bmp) free(bmp);
    httpPostJson(String("/api/print/jobs/") + id + "/ack",
                 ok ? "{\"status\":\"ok\"}" : "{\"status\":\"error\",\"error\":\"print_failed\"}");
    Serial.printf("Job %s: %s\n", id, ok ? "printed" : "FAILED");
    if (!ok) setBuzz(BUZZ_ERROR);
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
        DynamicJsonDocument d(512);
        if (deserializeJson(d, raw)) return;
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
        if (!ok) return;

        saveConfigField(field, String(value));
        publishStatus();
    }
};

class CfgApplyCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
        std::string cmd = c->getValue();
        if (cmd == "reboot") {
            delay(1000);
            ESP.restart();
        } else if (cmd == "wifi") {
            loadConfig();
            connectWifi();
            publishStatus();
        } else if (cmd == "wipe") {
            // Factory reset: clear NVS so next boot uses compiled-in defaults.
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
// gpio_set_pull_mode / gpio_set_direction (used by forceButtonPullups above).
#include <driver/gpio.h>

// ─── Button action handlers (run from main loop) ─────────────────────────────

/** GPIO 14: reprint the last successfully-printed job from cached RAM. */
static void doReprint() {
    if (!gLastBmp || gLastHeight == 0) {
        Serial.println("reprint: nothing to reprint");
        setBuzz(BUZZ_ERROR);
        return;
    }
    Serial.printf("reprint: 384x%u\n", gLastHeight);
    if (!connectPrinter()) { setBuzz(BUZZ_ERROR); return; }
    bool ok = catPrint(gLastBmp, gLastHeight);
    setBuzz(ok ? BUZZ_OK : BUZZ_ERROR);
}

/** GPIO 9: print a built-in test pattern — no server / no font needed. */
static void doTestPrint() {
    const uint16_t H = 160;
    uint8_t* bmp = (uint8_t*)calloc(BYTES_PER_ROW * H, 1);
    if (!bmp) { Serial.println("test: OOM"); setBuzz(BUZZ_ERROR); return; }

    for (int y = 0; y < 8; y++)             // black header bar
        memset(bmp + y * BYTES_PER_ROW, 0xFF, BYTES_PER_ROW);
    for (int y = 24; y < 56; y++)            // horizontal stripes
        memset(bmp + y * BYTES_PER_ROW, (y & 1) ? 0xAA : 0x55, BYTES_PER_ROW);
    for (int y = 72; y < 120; y++)           // checkerboard
        for (int x = 0; x < BYTES_PER_ROW; x++)
            bmp[y * BYTES_PER_ROW + x] = ((y ^ x) & 1) ? 0xAA : 0x55;
    for (int y = H - 8; y < H; y++)          // black footer bar
        memset(bmp + y * BYTES_PER_ROW, 0xFF, BYTES_PER_ROW);

    Serial.println("test print: starting");
    if (!connectPrinter()) {
        Serial.println("test: no printer");
        free(bmp);
        setBuzz(BUZZ_ERROR);
        return;
    }
    bool ok = catPrint(bmp, H);
    free(bmp);
    Serial.printf("test print: %s\n", ok ? "OK" : "FAIL");
    setBuzz(ok ? BUZZ_OK : BUZZ_ERROR);
}

// ── Status-check tones ─────────────────────────────────────────────────────
// Each tone is shaped to be unambiguously distinguishable by ear.
//   ALL OK             : long ascending fanfare ending with a high accent
//   NO WIFI            : 3 LOW pulses (deep, slow)
//   SERVER UNREACHABLE : 4-note DESCENDING ramp
//   AUTH FAILURE       : 3 fast HIGH staccato pulses (same pitch)
//   BLE PRINTER DOWN   : 2-note wobble (mid pitch, alternating)

static void beepStatusOk() {
    static const int n[] = { 523, 659, 784, 1047, 0, 1568, 1318, 1047 };
    static const int d[] = {  60,  60,  60,   60, 30,  120,  100,  220 };
    blockingChord(n, d, 8);
}
static void beepStatusNoWifi() {
    static const int n[] = { 220, 0, 220, 0, 220 };
    static const int d[] = { 180,100, 180,100, 180 };
    blockingChord(n, d, 5);
}
static void beepStatusNoServer() {
    static const int n[] = { 784, 0, 587, 0, 392, 0, 261 };
    static const int d[] = { 100, 30, 100, 30, 100, 30, 220 };
    blockingChord(n, d, 7);
}
static void beepStatusAuth() {
    static const int n[] = { 1760, 0, 1760, 0, 1760 };
    static const int d[] = {   70, 50,   70, 50,   70 };
    blockingChord(n, d, 5);
}
static void beepStatusBleDown() {
    static const int n[] = { 880, 660, 880, 660 };
    static const int d[] = { 100, 100, 100, 200 };
    blockingChord(n, d, 4);
}

/** GPIO 22: probe device health and play a tune that says exactly what's
 *  wrong (or right). Order of severity:
 *    1. WiFi   — if down, nothing else matters
 *    2. Server — auth fail vs unreachable
 *    3. BLE printer — only checked if server is fine
 *    4. All good
 *  The body of the server response is inspected so a "server up but bogus
 *  reply" doesn't get treated as healthy. */
static void doStatus() {
    Serial.println();
    Serial.println("─── status check ───");
    setBuzz(BUZZ_OFF);

    // 1. WiFi
    if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("status: WiFi NOT connected (status=%d)\n", (int)WiFi.status());
        beepStatusNoWifi();
        return;
    }
    Serial.printf("status: WiFi OK  ssid=%s  ip=%s  rssi=%d\n",
                  gWifiSsid.c_str(),
                  WiFi.localIP().toString().c_str(),
                  WiFi.RSSI());

    // 2. Server probe — short wait, prove TLS+auth+endpoint shape are alive
    String body;
    const uint32_t t0 = millis();
    int code = httpGet(String("/api/print/jobs/next?device=") + gDeviceId + "&wait=0",
                       body, 8000);
    const uint32_t dt = millis() - t0;
    Serial.printf("status: HTTP %d in %lums  bodyLen=%u\n",
                  code, (unsigned long)dt, (unsigned)body.length());

    if (code == 401 || code == 403) {
        Serial.println("status: AUTH FAILURE — token rejected by server");
        beepStatusAuth();
        return;
    }
    if (code < 0) {
        Serial.printf("status: SERVER UNREACHABLE (httpcode=%d)\n", code);
        beepStatusNoServer();
        return;
    }
    if (code != 200 && code != 204) {
        Serial.printf("status: SERVER ERROR (HTTP %d)\n", code);
        beepStatusNoServer();
        return;
    }
    // Verify response shape — server might return 200 with garbage if there
    // is misconfiguration. A real shape has settings.role at minimum.
    if (code == 200) {
        if (body.indexOf("\"settings\"") < 0) {
            Serial.println("status: server replied 200 but body looks wrong — treating as server error");
            Serial.printf("  first 120 chars: %s\n", body.substring(0, 120).c_str());
            beepStatusNoServer();
            return;
        }
    }

    // 3. BLE printer link
    if (!gBleConnected) {
        Serial.println("status: BLE PRINTER NOT CONNECTED — server OK but no printer link");
        beepStatusBleDown();
        return;
    }

    // 4. Everything alive
    Serial.println("status: ALL GOOD ✓  (wifi + server + ble printer all healthy)");
    beepStatusOk();
}

/** Power-on startup chime — the fanfare you hear whenever the chip boots. */
static void beepPowerOn() {
    static const int n[] = { 392, 0, 587, 0, 784, 0, 1175 };  // G4, D5, G5, D6
    static const int d[] = {  70, 25,  70, 25,  70, 25,  140 };
    blockingChord(n, d, 7);
}

void setup() {
    Serial.begin(115200);
    delay(500);
    // Print the reset reason on every boot. If the device is "turning on and
    // off", read this: ESP_RST_BROWNOUT(=6) = supply sagged (power/cable),
    // ESP_RST_PANIC(=4) = a crash, ESP_RST_POWERON(=1) = clean boot.
    Serial.printf("\nESP32 cat-printer bridge  (reset reason=%d)\n",
                  (int)esp_reset_reason());

    buzzerInit();
    beepPowerOn();          // audible "I'm awake" the moment the chip starts
    buttonsInit();
    loadConfig();

    NimBLEDevice::init("ESP32-printer");
    // Lowered from P9 (max) to P3 to cut the BLE TX current spike — at max
    // power the WiFi+BLE inrush can brownout-reset a marginal charger/cable
    // into a boot loop. P3 is plenty for a printer on the same counter; bump
    // back up if you see BLE range problems once the device boots reliably.
    NimBLEDevice::setPower(ESP_PWR_LVL_P3);
    NimBLEDevice::setMTU(247);

    startConfigGattServer();
    connectWifi();
}

void loop() {
    // buttonsTick + buzzerTick run on the dedicated ioTask, so they stay
    // responsive even while we're blocked in HTTPClient.

    // Service button-action flags from the IO task. Each handler runs in
    // the main loop's context so heavy work (catPrint, WiFi teardown,
    // ESP.restart) doesn't run on the IO task's small stack.
    if (gWantsStatus) {
        gWantsStatus = false;
        doStatus();
    }
    if (gWantsReprint) {
        gWantsReprint = false;
        doReprint();
    }
    if (gWantsTestPrint) {
        gWantsTestPrint = false;
        doTestPrint();
    }

    // ── WiFi event service ───────────────────────────────────────────────────
    // beepWifiUp() is blocking; do it from the main loop (not the WiFi
    // event callback which runs in the event-loop task).
    const uint32_t now = millis();
    if (gWifiUpEvent) {
        gWifiUpEvent = false;
        Serial.printf("WiFi: connected  IP=%s  RSSI=%d\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        beepWifiUp();
        if (gBuzzMode == BUZZ_WIFI_DISC) setBuzz(BUZZ_OFF);
        gWifiDownSince = 0;
    }

    // ── WiFi / BLE disconnect alarms ─────────────────────────────────────────
    if (WiFi.status() != WL_CONNECTED) {
        // Auto-reconnect handles the actual retry in the background — we
        // don't call connectWifi() again here (that would re-trigger the
        // long blocking setup). Just track downtime + alarm and skip the
        // HTTP work for this loop iteration.
        if (!gWifiDownSince) gWifiDownSince = now;
        if (now - gWifiDownSince > 10000 && gBuzzMode == BUZZ_OFF) {
            setBuzz(BUZZ_WIFI_DISC);
        }
        delay(200);   // short yield, not the old 2-second blocker
        return;
    }
    // (WiFi up: alarm clearing is handled when gWifiUpEvent fires.)

    // BLE-printer disconnect alarm — only matters if we believe we should be
    // connected (we've successfully scanned/connected at least once). Tracked
    // via gBleConnected.
    if (!gBleConnected) {
        if (!gBleDownSince) gBleDownSince = now;
        if (now - gBleDownSince > 30000 && gBuzzMode == BUZZ_OFF) {
            setBuzz(BUZZ_BLE_DISC);
        }
    } else {
        if (gBleDownSince) {
            gBleDownSince = 0;
            if (gBuzzMode == BUZZ_BLE_DISC) setBuzz(BUZZ_OFF);
        }
    }

    // Keep BLE pre-connected so jobs print immediately. Throttle reconnect
    // attempts so we don't hammer the radio if the printer is off.
    if (!gBleConnected && now >= gNextBleRetry &&
        now - gLastBleCheck >= 5000) {
        gLastBleCheck = now;
        if (!connectPrinter()) gNextBleRetry = millis() + 5000;
    }

    // processJob() blocks for ~10s on a long-poll when idle, so no extra delay
    // is needed between iterations — we already throttle naturally.
    bool worked = processJob();
    // Refresh BLE status characteristic so any admin currently connected via
    // Web Bluetooth sees live IP / wifi state.
    publishStatus();
    if (worked) delay(200);
}
