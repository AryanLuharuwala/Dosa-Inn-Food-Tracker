// Button + buzzer interaction test.
//
// Pins:
//   GPIO 14, 9, 8  — momentary buttons. Held LOW = active. Beep on press.
//   GPIO 7         — power toggle (each press flips the software "powered-on"
//                    state; we'll wire it to wifi/ble off + sleep in the main
//                    firmware).
//   GPIO 15        — buzzer.
//
// Buzzer behaviors (non-blocking state machine):
//   BUZZ_PRESS     — single short beep, used on every button press
//   BUZZ_RING      — melodic two-note pattern that loops until any button
//                    is pressed. Simulates "new order arrived".
//   BUZZ_WIFI_DISC — short low beep every 5 s. Simulated.
//   BUZZ_BLE_DISC  — short mid beep every 5 s. Simulated.
//
// Serial commands (paste single char):
//   r → start ring (simulate new order)
//   w → start wifi-disconnect alarm
//   b → start ble-disconnect alarm
//   x → silence all
//
// Any button press silences ring/alarms (because that's the production
// behavior we want).

#include <Arduino.h>

// Declared up here so Arduino's auto-generated prototypes can see it before
// any function signature mentions it.
enum BuzzMode {
    BUZZ_OFF,
    BUZZ_PRESS,
    BUZZ_RING,
    BUZZ_WIFI_DISC,
    BUZZ_BLE_DISC,
};

static const uint8_t BUZZER_PIN     = 15;
static const uint8_t BTN_POWER      = 7;
// Switches moved off GPIO 8 (onboard LED) and GPIO 13 (USB D+) to GPIO 22.
static const uint8_t BTN_TOGGLES[]  = { 14, 9, 22 };
static const size_t  N_TOGGLES      = sizeof(BTN_TOGGLES) / sizeof(BTN_TOGGLES[0]);

// Pins where the onboard user LED is wired to the same line as a switch.
// 255 is a sentinel meaning "none" (Arduino doesn't accept empty arrays).
static const uint8_t LED_SHARED_PINS[] = { 255 };

static bool isLedShared(uint8_t pin) {
    for (uint8_t p : LED_SHARED_PINS) if (p == pin) return true;
    return false;
}

/** Read a button. If the pin shares an LED, we briefly flip to INPUT_PULLUP,
 *  sample, then return to OUTPUT LOW so the LED stays dark. */
static bool readButton(uint8_t pin) {
    if (!isLedShared(pin)) return digitalRead(pin) == LOW;
    pinMode(pin, INPUT_PULLUP);
    delayMicroseconds(20);  // pullup settling
    const bool pressed = digitalRead(pin) == LOW;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    return pressed;
}

// ─── Buzzer state machine ────────────────────────────────────────────────────

static BuzzMode  buzzMode      = BUZZ_OFF;
static uint32_t  buzzModeStart = 0;

static void buzzerSilence() {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
}

static void setBuzz(BuzzMode m) {
    buzzMode      = m;
    buzzModeStart = millis();
    if (m == BUZZ_OFF) buzzerSilence();
}

static void buzzerTick() {
    const uint32_t now     = millis();
    const uint32_t elapsed = now - buzzModeStart;

    switch (buzzMode) {
        case BUZZ_OFF:
            break;

        case BUZZ_PRESS:
            // 80 ms of 1500 Hz, then silence
            if (elapsed < 80) tone(BUZZER_PIN, 1500);
            else { setBuzz(BUZZ_OFF); }
            break;

        case BUZZ_RING: {
            // Ascending C-major-triad chime with a long rest between cycles.
            // Sounds like a soft doorbell / iPhone "Bamboo" tone — pleasant
            // but still attention-grabbing because of the rising contour.
            //
            // 3000 ms cycle:
            //   0    – 240   : C5  (523 Hz)
            //   240  – 320   : silence
            //   320  – 560   : E5  (659 Hz)
            //   560  – 640   : silence
            //   640  – 1100  : G5  (784 Hz, longer — the "ring-out")
            //   1100 – 3000  : silence (1.9 s rest)
            const uint32_t cycle = 3000;
            const uint32_t t = elapsed % cycle;
            int hz = 0;
            if      (t < 240)              hz = 523;   // C5
            else if (t >= 320 && t < 560)  hz = 659;   // E5
            else if (t >= 640 && t < 1100) hz = 784;   // G5
            if (hz) tone(BUZZER_PIN, hz); else buzzerSilence();
            break;
        }

        case BUZZ_WIFI_DISC: {
            // 80 ms beep at 400 Hz every 5 s
            const uint32_t phase = elapsed % 5000;
            if (phase < 80) tone(BUZZER_PIN, 400); else buzzerSilence();
            break;
        }

        case BUZZ_BLE_DISC: {
            // 80 ms beep at 700 Hz every 5 s (distinct from wifi)
            const uint32_t phase = elapsed % 5000;
            if (phase < 80) tone(BUZZER_PIN, 700); else buzzerSilence();
            break;
        }
    }
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

static bool prevToggle[3] = { false, false, false };
static bool prevPower    = false;
static bool poweredOn    = true;

static bool isAlarmActive() {
    return buzzMode == BUZZ_RING || buzzMode == BUZZ_WIFI_DISC || buzzMode == BUZZ_BLE_DISC;
}

static void onAnyButtonPressed() {
    // Any press silences the ring/alarm. If nothing alarm-y, fire BUZZ_PRESS
    // as press feedback.
    if (isAlarmActive()) setBuzz(BUZZ_OFF);
    else setBuzz(BUZZ_PRESS);
}

static void onPowerToggle() {
    poweredOn = !poweredOn;
    Serial.printf("power → %s (TODO: WiFi/BLE off, enter sleep)\n",
                  poweredOn ? "ON" : "OFF");
}

// ─── Setup / loop ────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.println("\n--- button + buzzer test ---");
    Serial.println("Buttons: 14 9 8 momentary (LOW = pressed), 7 = power toggle");
    Serial.println("Serial: r=ring  w=wifi-disc  b=ble-disc  x=silence");

    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);

    pinMode(BTN_POWER, INPUT_PULLUP);
    for (size_t i = 0; i < N_TOGGLES; i++) {
        if (isLedShared(BTN_TOGGLES[i])) {
            // LED-shared pin: keep it driven LOW so the LED stays off.
            pinMode(BTN_TOGGLES[i], OUTPUT);
            digitalWrite(BTN_TOGGLES[i], LOW);
        } else {
            pinMode(BTN_TOGGLES[i], INPUT_PULLUP);
        }
    }
}

void loop() {
    // ── Serial: simulate trigger events ──────────────────────────────────────
    while (Serial.available()) {
        char c = Serial.read();
        switch (c) {
            case 'r': Serial.println("[sim] new order — ringing");          setBuzz(BUZZ_RING);      break;
            case 'w': Serial.println("[sim] wifi disconnected");             setBuzz(BUZZ_WIFI_DISC); break;
            case 'b': Serial.println("[sim] ble disconnected");              setBuzz(BUZZ_BLE_DISC);  break;
            case 'x': Serial.println("[sim] silenced");                       setBuzz(BUZZ_OFF);       break;
            default: break;
        }
    }

    // ── Read buttons ─────────────────────────────────────────────────────────
    // Toggles: edge-trigger on press (HIGH → LOW)
    for (size_t i = 0; i < N_TOGGLES; i++) {
        const bool pressed = readButton(BTN_TOGGLES[i]);
        if (pressed && !prevToggle[i]) {
            Serial.printf("toggle press: GPIO %u\n", BTN_TOGGLES[i]);
            onAnyButtonPressed();
        }
        prevToggle[i] = pressed;
    }

    // Power button: edge on press, toggles software power
    const bool powerPressed = readButton(BTN_POWER);
    if (powerPressed && !prevPower) {
        onPowerToggle();
        onAnyButtonPressed();
    }
    prevPower = powerPressed;

    // ── Run buzzer state machine ─────────────────────────────────────────────
    buzzerTick();

    delay(15);
}
