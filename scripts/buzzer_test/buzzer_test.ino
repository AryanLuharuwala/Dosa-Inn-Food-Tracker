// Buzzer test — GPIO 15.
// Cycles through three patterns so you can identify both the wiring and the
// buzzer type. If only one pattern makes noise, you know which kind you have:
//
//   1. ACTIVE buzzer (built-in oscillator) → reacts to plain HIGH/LOW
//   2. PASSIVE buzzer (just a piezo)        → reacts to tone() PWM frequency
//   3. Either                                → reacts to a slow pulse
//
// Open Serial Monitor at 115200 to see which pattern is running.

#define BUZZER_PIN 15

void setup() {
    Serial.begin(115200);
    delay(300);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
    Serial.println("\n--- buzzer test on GPIO 15 ---");
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// 1. Slow pulse — works on both active and passive buzzers (you may hear
//    clicks on a passive one).
static void pulseSlow() {
    Serial.println("[1/3] slow pulse — HIGH 250ms / LOW 250ms × 4");
    for (int i = 0; i < 4; i++) {
        digitalWrite(BUZZER_PIN, HIGH); delay(250);
        digitalWrite(BUZZER_PIN, LOW);  delay(250);
    }
}

// 2. ACTIVE buzzer: 3 short pulses ~80ms — should sound like a doorbell.
//    Passive buzzers may be silent here.
static void activeBeeps() {
    Serial.println("[2/3] active-buzzer beeps — 3× 80ms HIGH");
    for (int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH); delay(80);
        digitalWrite(BUZZER_PIN, LOW);  delay(120);
    }
}

// 3. PASSIVE buzzer: musical tones. Silent on active buzzers (or just clicks).
static void passiveTones() {
    Serial.println("[3/3] passive-buzzer tones — C5, E5, G5, C6");
    const int notes[]    = { 523, 659, 784, 1047 }; // Hz
    const int durations  = 180;
    for (int n : notes) {
        tone(BUZZER_PIN, n, durations);
        delay(durations + 40);
    }
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
}

void loop() {
    pulseSlow();    delay(600);
    activeBeeps();  delay(600);
    passiveTones(); delay(1500);
}
