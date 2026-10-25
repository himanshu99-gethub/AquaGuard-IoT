#include <WiFi.h>
#include <WiFiManager.h>
#include <Firebase_ESP_Client.h>

#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// ==================================================================================
// 1. FIREBASE & WI-FI CREDENTIALS
// Stored securely in secrets.h (git-ignored) to prevent leaking on GitHub.
// ==================================================================================
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #include "secrets.example.h"
#endif

// ==================================================================================
// 2. HARDWARE GPIO PIN SETTINGS
// ==================================================================================
#define TRIG_PIN  5    // HC-SR04 Trigger (Output 3.3V)
#define ECHO_PIN  18   // HC-SR04 Echo (Input via 1k+2k resistor divider)
#define RELAY_PIN 26   // Motor Relay Module Pin

// Relay Polarity: true = Active LOW (LOW=ON, HIGH=OFF), false = Active HIGH
#define RELAY_ACTIVE_LOW true

// ==================================================================================
// 3. TANK CALIBRATION & SAFETY PARAMETERS (Universal for any tank size)
// ==================================================================================
float TANK_HEIGHT_CM       = 15.0; // Total height from base to ultrasonic sensor face
float SENSOR_OFFSET_CM     = 2.0;  // Deadzone clearance (e.g. 2cm brim margin)
float TANK_CAPACITY_LITERS = 1.0;  // Universal Tank Capacity (e.g. 1L, 20L, 500L, 1000L)
float LOW_LEVEL_PERCENT    = 20.0; // Auto-start pump when water level falls below this %
float FULL_LEVEL_PERCENT   = 100.0; // Full cutoff at 100%

// Dry-run / overflow max motor safety runtime cutoff (15 minutes)
const unsigned long MAX_MOTOR_RUNTIME_MS = 15UL * 60UL * 1000UL;

// ==================================================================================
// 4. GLOBAL OBJECTS & STATE VARIABLES
// ==================================================================================
FirebaseData fbdoData;    // Dedicated for telemetry upload (/tank)
FirebaseData fbdoCmd;     // Shared for commands (/control) & periodic config sync (/config) to save RAM
FirebaseAuth auth;
FirebaseConfig config;

float distanceCm        = 0.0;
float waterLevelCm      = 0.0;
float waterPercent      = 0.0;
float volumeLiters      = 0.0;
float freeVolumeLiters  = 0.0;

bool motorOn            = false;
bool manualStopLatched  = false; // True if user pressed STOP in AUTO mode
bool sensorError        = false;
int  sensorFailures     = 0;

String mode        = "AUTO"; // "AUTO" or "MANUAL"
String lastCommand = "";
double lastProcessedCommandTime = 0.0; // Timestamp tracker for reliable remote clicks

unsigned long lastSensorRead     = 0;
unsigned long lastFirebaseUpload = 0;
unsigned long lastCommandCheck   = 0;
unsigned long lastConfigCheck    = 0;
unsigned long motorStartTime     = 0;

// ==================================================================================
// 5. HARDWARE CONTROL FUNCTIONS
// ==================================================================================

/**
 * Control motor relay with active LOW / HIGH polarity safety
 */
void setMotor(bool turnOn, const char* reason = "") {
  if (motorOn == turnOn) return; // State unchanged

  motorOn = turnOn;

  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, turnOn ? LOW : HIGH);
  } else {
    digitalWrite(RELAY_PIN, turnOn ? HIGH : LOW);
  }

  if (turnOn) {
    motorStartTime = millis();
    Serial.print(">>> [PUMP ON] Reason: ");
  } else {
    motorStartTime = 0;
    Serial.print(">>> [PUMP OFF] Reason: ");
  }
  Serial.println(reason);
}

/**
 * Single ultrasonic pulse measurement (with 25ms timeout)
 */
float singlePingCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 25ms timeout = ~4.2 meters max distance
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 25000);
  if (duration == 0) return -1.0;

  float d = (duration * 0.0343) / 2.0;
  if (d < 2.0 || d > 400.0) return -1.0;
  return d;
}

/**
 * Robust 3-sample median filter to eliminate ultrasonic noise/ripples
 */
bool readDistanceFiltered(float &result) {
  float samples[3];
  int validCount = 0;

  for (int i = 0; i < 3; i++) {
    float reading = singlePingCm();
    if (reading > 0) {
      samples[validCount++] = reading;
    }
    delay(12); // Short gap between acoustic bursts
  }

  if (validCount == 0) return false;

  // Simple sorting for median
  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (samples[i] > samples[j]) {
        float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }

  // Median value
  result = samples[validCount / 2];
  return true;
}

/**
 * Calculate water height in cm, percentage, and Liters (Universal for any tank)
 */
void calculateWaterLevel() {
  float usableHeight = TANK_HEIGHT_CM - SENSOR_OFFSET_CM;
  if (usableHeight <= 0) {
    waterLevelCm = 0;
    waterPercent = 0;
    volumeLiters = 0;
    freeVolumeLiters = TANK_CAPACITY_LITERS;
    return;
  }

  // Height of water column
  waterLevelCm = usableHeight - (distanceCm - SENSOR_OFFSET_CM);

  // Clamp water level between 0 and usable height
  if (waterLevelCm < 0) waterLevelCm = 0;
  if (waterLevelCm > usableHeight) waterLevelCm = usableHeight;

  // Percentage (0.0% to 100.0%)
  waterPercent = (waterLevelCm / usableHeight) * 100.0;
  if (waterPercent < 0)   waterPercent = 0;
  if (waterPercent > 100) waterPercent = 100;

  // Universal Volume in Liters
  volumeLiters = (waterPercent / 100.0) * TANK_CAPACITY_LITERS;
  freeVolumeLiters = TANK_CAPACITY_LITERS - volumeLiters;
  if (freeVolumeLiters < 0) freeVolumeLiters = 0;
}

// ==================================================================================
// 6. AUTOMATIC CONTROLLER & SAFETY INTERLOCKS
// ==================================================================================

void executePumpLogic() {
  // --- 1. HARD CRITICAL SAFETY CUTOFFS ---
  if (sensorError) {
    if (motorOn) setMotor(false, "SENSOR FAULT CUTOFF");
    return;
  }

  // Sustained Full Tank Cutoff (Requires 2 consecutive readings to prevent premature cutoff from ripples)
  static int fullTankCounter = 0;
  bool isAtBrimDistance = (distanceCm > 0.0 && distanceCm <= SENSOR_OFFSET_CM);
  bool isAtFullPercent  = (waterPercent >= FULL_LEVEL_PERCENT);

  if (isAtBrimDistance || isAtFullPercent) {
    fullTankCounter++;
    if (fullTankCounter >= 2) {
      if (motorOn) setMotor(false, "FULL TANK CUTOFF (Reached Brim ~2cm)");
      return;
    }
  } else {
    fullTankCounter = 0;
  }

  // Max runtime watchdog (prevents dry running if pipe bursts)
  if (motorOn && (millis() - motorStartTime > MAX_MOTOR_RUNTIME_MS)) {
    setMotor(false, "SAFETY MAX RUNTIME EXCEEDED (15 MIN)");
    manualStopLatched = true;
    return;
  }

  // --- 2. AUTOMATIC MODE LOGIC ---
  if (mode == "AUTO") {
    // If user clicked STOP, latch remains until water drops or user starts
    if (manualStopLatched) {
      if (motorOn) setMotor(false, "MANUAL STOP LATCHED");
      return;
    }

    // Auto Start when water level is critically low
    if (waterPercent <= LOW_LEVEL_PERCENT) {
      if (!motorOn) setMotor(true, "AUTO LOW-LEVEL START (<20%)");
    }
  }
}

// ==================================================================================
// 7. FIREBASE REALTIME DATABASE SYNC
// ==================================================================================

/**
 * Push latest telemetry packet to /tank
 */
void uploadTelemetry() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  FirebaseJson json;
  json.set("distance_cm", (double)distanceCm);
  json.set("water_level_cm", (double)waterLevelCm);
  json.set("water_level_percent", (double)waterPercent);
  json.set("volume_liters", (double)volumeLiters);
  json.set("free_volume_liters", (double)freeVolumeLiters);
  json.set("capacity_liters", (double)TANK_CAPACITY_LITERS);
  json.set("motor_status", motorOn ? "ON" : "OFF");
  json.set("mode", mode);
  json.set("esp32_online", true);
  json.set("sensor_error", sensorError);
  json.set("last_updated/.sv", "timestamp"); // Atomic UTC server timestamp

  if (Firebase.RTDB.updateNode(&fbdoData, "/tank", &json)) {
    Serial.println("✓ Telemetry pushed to Firebase [/tank]");
  } else {
    Serial.print("✗ Firebase update failed: ");
    Serial.println(fbdoData.errorReason());
  }
}

/**
 * Read control commands from /control
 */
void readDashboardCommands() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  // Fetch the entire /control node in 1 SSL request
  if (!Firebase.RTDB.getJSON(&fbdoCmd, "/control")) {
    return;
  }

  FirebaseJson &json = fbdoCmd.jsonObject();
  FirebaseJsonData jsonData;

  // 1. Check Mode: "AUTO" or "MANUAL"
  if (json.get(jsonData, "mode")) {
    String newMode = jsonData.stringValue;
    newMode.trim();
    newMode.toUpperCase();

    if ((newMode == "AUTO" || newMode == "MANUAL") && newMode != mode) {
      Serial.print(">>> Operating Mode Changed: ");
      Serial.print(mode);
      Serial.print(" -> ");
      Serial.println(newMode);
      mode = newMode;
      manualStopLatched = false;
    }
  }

  // 2. Check Command: "START" or "STOP"
  String cmd = "";
  if (json.get(jsonData, "command")) {
    cmd = jsonData.stringValue;
    cmd.trim();
    cmd.toUpperCase();
  }

  double incomingCmdTime = 0.0;
  if (json.get(jsonData, "last_command_time")) {
    incomingCmdTime = jsonData.doubleValue;
  }

  bool isFreshTimestamp = (incomingCmdTime > 0.0 && incomingCmdTime != lastProcessedCommandTime);
  bool isStateMismatch  = (cmd == "START" && !motorOn) || (cmd == "STOP" && motorOn);

  if ((isFreshTimestamp || isStateMismatch) && (cmd == "START" || cmd == "STOP")) {
    if (incomingCmdTime > 0.0) {
      lastProcessedCommandTime = incomingCmdTime;
    }
    lastCommand = cmd;

    Serial.print(">>> [REMOTE ACTION] Processing Command: ");
    Serial.println(cmd);

    if (cmd == "STOP") {
      manualStopLatched = true;
      setMotor(false, "USER DASHBOARD 'STOP' CLICKED");

      // Reset command in Firebase so it's ready for future clicks
      Firebase.RTDB.setString(&fbdoCmd, "/control/command", "IDLE");

      // Instantly upload state to Firebase so dashboard updates in real-time
      uploadTelemetry();

    } else if (cmd == "START") {
      manualStopLatched = false;

      // Safety checks before turning motor on
      if (sensorError) {
        Serial.println("⚠ Cannot start: Ultrasonic sensor fault/error!");
      } else if (waterPercent >= FULL_LEVEL_PERCENT) {
        Serial.println("⚠ Cannot start: Tank is already FULL (100%)!");
      } else if (distanceCm > 0.0 && distanceCm <= SENSOR_OFFSET_CM) {
        Serial.println("⚠ Cannot start: Water is at brim clearance limit!");
      } else {
        setMotor(true, "USER DASHBOARD 'START' CLICKED");

        // Reset command in Firebase so it's ready for future clicks
        Firebase.RTDB.setString(&fbdoCmd, "/control/command", "IDLE");

        // Instantly upload state to Firebase so dashboard updates in real-time
        uploadTelemetry();
      }
    }
  }
}

/**
 * Read calibration config from /config (reusing fbdoCmd to save heap)
 */
void readCalibrationConfig() {
  if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

  if (Firebase.RTDB.getJSON(&fbdoCmd, "/config")) {
    FirebaseJson &json = fbdoCmd.jsonObject();
    FirebaseJsonData d;

    if (json.get(d, "tank_height_cm")) {
      float h = d.floatValue;
      if (h >= 5.0 && h <= 1000.0) TANK_HEIGHT_CM = h;
    }
    if (json.get(d, "sensor_offset_cm")) {
      float o = d.floatValue;
      if (o >= 1.0 && o <= 50.0) SENSOR_OFFSET_CM = o;
    }
    if (json.get(d, "capacity_liters")) {
      float cap = d.floatValue;
      if (cap > 0.0 && cap <= 50000.0) TANK_CAPACITY_LITERS = cap;
    }
    if (json.get(d, "low_threshold_pct")) {
      float l = d.floatValue;
      if (l >= 5.0 && l <= 50.0) LOW_LEVEL_PERCENT = l;
    }
    if (json.get(d, "full_threshold_pct")) {
      float f = d.floatValue;
      if (f >= 50.0 && f <= 100.0) FULL_LEVEL_PERCENT = f;
    }
  }
}

// ==================================================================================
// 8. SETUP & INITIALIZATION
// ==================================================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize GPIO Pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);

  // Ensure relay starts firmly OFF (prevent boot click)
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, HIGH);
  } else {
    digitalWrite(RELAY_PIN, LOW);
  }
  motorOn = false;

  Serial.println("\n========================================================");
  Serial.println("   AquaGuard IoT — Smart Water Tank & Motor Controller   ");
  Serial.println("========================================================");

  // CRITICAL FIX 1: Turn OFF Wi-Fi modem sleep (prevents Wi-Fi drops and SSL timeouts)
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  Serial.println("Starting Wi-Fi setup via WiFiManager...");
  WiFiManager wm;

  // Try saved Wi-Fi credentials for 15s. If unavailable, open portal for 120s
  wm.setConnectTimeout(15);
  wm.setConfigPortalTimeout(120);

  Serial.println("Connecting to saved Wi-Fi... If setup needed, connect to hotspot: AquaGuard-Setup");
  bool wifiConnected = wm.autoConnect("AquaGuard-Setup");

  if (wifiConnected && WiFi.status() == WL_CONNECTED) {
    Serial.print("✓ Wi-Fi Connected! IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("✓ Signal Strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("⚠ Wi-Fi setup portal timed out. Background watchdog will auto-reconnect.");
  }

  // Configure Firebase Client
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Assign user credentials
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  // Assign token status callback
  config.token_status_callback = tokenStatusCallback;

  // Initialize Firebase
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // CRITICAL FIX 2: Optimized buffer sizes (only 2 objects, saves ~30KB RAM)
  fbdoData.setBSSLBufferSize(1024, 1024);
  fbdoData.setResponseSize(1024);
  fbdoCmd.setBSSLBufferSize(1024, 1024);
  fbdoCmd.setResponseSize(1024);

  Serial.println("✓ Firebase client initialized.");
  Serial.println("--------------------------------------------------------\n");

  // Read initial calibration config
  readCalibrationConfig();
}

// ==================================================================================
// 9. MAIN REAL-TIME LOOP
// ==================================================================================

void loop() {
  unsigned long now = millis();

  // 1. Read Ultrasonic Sensor & Run Control Logic every 500ms
  if (now - lastSensorRead >= 500) {
    lastSensorRead = now;

    float measuredDist = 0.0;
    if (readDistanceFiltered(measuredDist)) {
      distanceCm = measuredDist;
      sensorFailures = 0;
      sensorError = false;

      calculateWaterLevel();

      // Print clean diagnostics to Serial Monitor
      Serial.print("[SENS] Dist: ");
      Serial.print(distanceCm, 1);
      Serial.print("cm | Water: ");
      Serial.print(waterLevelCm, 1);
      Serial.print("cm (");
      Serial.print(waterPercent, 1);
      Serial.print("%) | Vol: ");
      Serial.print(volumeLiters, 2);
      Serial.print("L / ");
      Serial.print(TANK_CAPACITY_LITERS, 1);
      Serial.print("L | Motor: ");
      Serial.print(motorOn ? "ON" : "OFF");
      Serial.print(" | Mode: ");
      Serial.println(mode);

    } else {
      sensorFailures++;
      if (sensorFailures >= 3) {
        sensorError = true;
        Serial.println("⚠ [SENS ERROR] 3 consecutive reading failures! Motor halted.");
      }
    }

    // Execute pump control logic
    executePumpLogic();
  }

  // CRITICAL FIX 3: Read Remote Commands every 1200ms (Responsive & prevents SSL socket choking)
  if (now - lastCommandCheck >= 1200) {
    lastCommandCheck = now;
    readDashboardCommands();
  }

  // CRITICAL FIX 4: Upload Live Telemetry every 3.0 seconds (Stable & avoids quota saturation)
  if (now - lastFirebaseUpload >= 3000) {
    lastFirebaseUpload = now;
    uploadTelemetry();
  }

  // CRITICAL FIX 5: Sync Tank Calibration Config every 30 seconds
  if (now - lastConfigCheck >= 30000) {
    lastConfigCheck = now;
    readCalibrationConfig();
  }

  // CRITICAL FIX 6: Automatic Wi-Fi Watchdog: re-establish connection if router drops ESP32
  static unsigned long lastWifiRetry = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiRetry >= 8000) {
      lastWifiRetry = now;
      Serial.println("⚠ [WIFI] Connection lost! Reconnecting to Wi-Fi...");
      WiFi.reconnect();
    }
  }

  delay(10);
}
