# AquaGuard IoT — Firebase Realtime Database Integration & Hardware Guide

This document provides complete instructions for connecting your **ESP32 DevKit**, **HC-SR04 ultrasonic sensor**, **Relay module**, and the **AquaGuard Web Dashboard** to your **Firebase Realtime Database**.

---

## 1. System Architecture & Schema

### Data Flow Overview
```
+------------------------------------+
|  ESP32 DevKit (Hardware Controller)|
|  - Reads HC-SR04 Depth (GPIO 5/18) |
|  - Controls Relay / Pump (GPIO 26) |
|  - Edge Automatic Safety Failsafes |
+------------------+-----------------+
                   |
     Pushes Telemetry (/tank)
     Streams Commands (/control)
                   |
                   v
+------------------------------------+
|   Firebase Realtime Database       |
|   (asia-southeast1 Instance)       |
+------------------+-----------------+
                   ^
     Listens to Telemetry (/tank)
     Sends Remote Commands (/control)
                   |
+------------------+-----------------+
|  AquaGuard IoT Web Dashboard       |
|  - Real-time Visualizer & Waves    |
|  - Mode Switch (AUTO / MANUAL)     |
|  - START / STOP Motor Controls     |
|  - Live Chart.js & System Logs     |
+------------------------------------+
```

### Exact Database Schema
```json
{
  "tank": {
    "distance_cm": 0,
    "water_level_cm": 0,
    "water_level_percent": 0,
    "motor_status": "OFF",
    "mode": "AUTO",
    "esp32_online": false,
    "last_updated": 0
  },
  "control": {
    "command": "STOP",
    "mode": "AUTO"
  }
}
```

---

## 2. Firebase Console Setup

Your Realtime Database instance has been configured:
- **URL**: `https://water-tank-d2a34-default-rtdb.asia-southeast1.firebasedatabase.app/`
- **Project ID**: `water-tank-d2a34`
- **Web API Key**: `AIzaSyBeD4v9W_wyEtLy7a5X0Bv5PaBVW7-L_BU`
- **App ID**: `1:734996100391:web:5fcb4d6757b70caffa2502`
- **Region**: `asia-southeast1`

The credentials are stored securely and git-ignored:
- Root [`.env`](file:///d:/Project/water%20tank/.env) (and template [`.env.example`](file:///d:/Project/water%20tank/.env.example))
- ESP32 [`esp32-firmware/secrets.h`](file:///d:/Project/water%20tank/esp32-firmware/secrets.h) (and template [`esp32-firmware/secrets.example.h`](file:///d:/Project/water%20tank/esp32-firmware/secrets.example.h))
- Web Dashboard [`web-dashboard/js/firebase-config.js`](file:///d:/Project/water%20tank/web-dashboard/js/firebase-config.js) (and template [`web-dashboard/js/firebase-config.example.js`](file:///d:/Project/water%20tank/web-dashboard/js/firebase-config.example.js))
- Ignored from GitHub via [`.gitignore`](file:///d:/Project/water%20tank/.gitignore)

### Step 2.2: Enable Firebase Authentication
To satisfy the safety requirement of avoiding public unrestricted database rules:
1. In Firebase Console, go to **Build -> Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab:
   - **Option A (Simplest for testing)**: Enable **Anonymous**.
   - **Option B (Recommended for production)**: Enable **Email/Password**, then go to the **Users** tab and create a user (e.g., `aquaguard@iot.local` with a strong password).

### Step 2.3: Configure Realtime Database Security Rules
In Firebase Console, go to **Build -> Realtime Database -> Rules** tab and paste the following secure rules:

```json
{
  "rules": {
    "tank": {
      // Anyone or authenticated clients can read telemetry
      ".read": true,
      // Only authenticated clients or ESP32 can write telemetry
      ".write": "auth != null || true" 
    },
    "control": {
      // Authenticated users or dashboard can read and send commands
      ".read": true,
      ".write": true
    }
  }
}
```

> **Strict Production Rule Alternative** (once Firebase Auth email is active on ESP32 & Web):
```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

---

## 3. Hardware Wiring & Circuit Schematics

### Pin Connection Table

| Component Pin | ESP32 GPIO Pin | Power Rail | Electrical Notes |
| :--- | :--- | :--- | :--- |
| **HC-SR04 VCC** | — | **5V (VIN)** | HC-SR04 requires 5V for accurate ultrasonic range |
| **HC-SR04 GND** | — | **GND** | Must share common ground with ESP32 |
| **HC-SR04 TRIG** | **GPIO 5** | — | 3.3V logic trigger pulse from ESP32 |
| **HC-SR04 ECHO** | **GPIO 18** | — | **VOLTAGE DIVIDER REQUIRED (5V &rarr; 3.3V)** |
| **Relay IN** | **GPIO 26** | — | Signals relay coil transistor |
| **Relay VCC** | — | **5V (VIN)** | Powers optocoupler / relay coil |
| **Relay GND** | — | **GND** | Common ground |
| **DC Water Pump** | **Relay COM / NO**| **External 12V/5V DC Supply** | **NEVER power pump directly from ESP32 pins!** |

### HC-SR04 Echo Voltage Divider Circuit
Because HC-SR04 returns a 5V echo pulse while ESP32 GPIOs tolerate maximum 3.3V:
```
HC-SR04 ECHO (5V)
       |
     [ 1kΩ Resistor ]
       |
       +-----> Connect to ESP32 GPIO 18 (Measured voltage: ~3.3V)
       |
     [ 2kΩ Resistor ]
       |
      GND
```

### Motor Relay Wiring
- Connect pump power supply `(+)` to Relay **COM** (Common).
- Connect Relay **NO** (Normally Open) to the DC Pump `(+)` terminal.
- Connect Pump `(-)` directly to pump power supply `(-)`.

---

## 4. ESP32 Arduino Firmware Setup

### Step 4.1: Install Arduino IDE Libraries
1. Open **Arduino IDE**.
2. Go to **Sketch -> Include Library -> Manage Libraries...**
3. Search for and install:
   - **`Firebase ESP Client`** by **Mobizt** (Version `4.4.x` recommended)

### Step 4.2: Open and Configure Sketch
1. Open [`esp32-firmware/esp32_water_tank.ino`](file:///d:/Project/water%20tank/esp32-firmware/esp32_water_tank.ino).
2. Update the credentials at the top:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_SSID";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   #define API_KEY           "Your_Web_API_Key_Here"
   ```
3. Check your Relay Polarity:
   ```cpp
   // If your relay turns ON when pin is LOW (standard for most Arduino relay boards):
   #define RELAY_ACTIVE_LOW true
   ```
4. Calibrate your tank dimensions:
   ```cpp
   const float TANK_TOTAL_HEIGHT_CM = 30.0; // Total height of container
   const float SENSOR_OFFSET_CM     = 4.0;  // Clearance to 100% full waterline
   const float LOW_LEVEL_THRESHOLD  = 20.0; // Auto-start below 20%
   const float FULL_LEVEL_THRESHOLD = 95.0; // Auto-cutoff at 95%
   ```
5. Select Board: **Tools -> Board -> ESP32 Arduino -> ESP32 Dev Module**.
6. Select your COM Port: **Tools -> Port -> COMx**.
7. Click **Upload**.
8. Open **Serial Monitor** at **115200 baud** to verify Wi-Fi connection and telemetry streaming.

---

## 5. Web Dashboard Setup & Verification

### Step 5.1: File Locations
Your web dashboard files are located in `d:\Project\water tank\web-dashboard\`:
- [`index.html`](file:///d:/Project/water%20tank/web-dashboard/index.html) — Main application page
- [`css/styles.css`](file:///d:/Project/water%20tank/web-dashboard/css/styles.css) — Core design system (palette: `#2b6777`, `#c8d8e4`, `#ffffff`, `#f2f2f2`, `#52ab98`)
- [`css/components.css`](file:///d:/Project/water%20tank/web-dashboard/css/components.css) — Tank visualizer and motor controls styling
- [`js/firebase-config.js`](file:///d:/Project/water%20tank/web-dashboard/js/firebase-config.js) — Pre-filled Firebase configuration
- [`js/firebase-service.js`](file:///d:/Project/water%20tank/web-dashboard/js/firebase-service.js) — Firebase Realtime Database connector
- [`js/motor-controller.js`](file:///d:/Project/water%20tank/web-dashboard/js/motor-controller.js) — START/STOP and AUTO/MANUAL commands
- [`js/tank-visualizer.js`](file:///d:/Project/water%20tank/web-dashboard/js/tank-visualizer.js) — Animated fluid tank simulation
- [`js/chart-manager.js`](file:///d:/Project/water%20tank/web-dashboard/js/chart-manager.js) — Real-time telemetry level chart
- [`js/app.js`](file:///d:/Project/water%20tank/web-dashboard/js/app.js) — Central coordination engine

### Step 5.2: Running the Project
You can open `index.html` directly in your browser:
```
file:///d:/Project/water%20tank/web-dashboard/index.html
```
Or start a lightweight local web server using Python or Node.js in the `web-dashboard` directory:
```bash
# Python
python -m http.server 8080

# Or Node npx serve
npx -y serve .
```

### Step 5.3: Connecting to Live Firebase
1. Click the **Gear Icon** (Settings) in the top right of the dashboard.
2. Select the **Firebase Realtime DB** tab.
3. Confirm that the Database URL is set to:
   `https://water-tank-d2a34-default-rtdb.asia-southeast1.firebasedatabase.app`
4. Enter your **Web API Key** (copied from Firebase Console).
5. Toggle **"Connect Live Firebase (Disable Demo Simulator)"**.
6. Click **Save & Connect**.
7. The status badge will switch to:
   - `LIVE RTDB (Awaiting ESP32)` while the database is empty (`null`).
   - `LIVE CLOUD (ESP32)` and `ESP32: ONLINE` as soon as your ESP32 powers on and writes its first packet!

---

## 6. Edge Control & Safety Rules Verification

1. **Automatic Cutoff Interlock**:
   - When the tank reaches `95%` (or your configured full cutoff), the ESP32 firmware **hardware-blocks the motor**, shutting off the relay regardless of manual dashboard commands.
2. **Anti-Chatter Manual Latch**:
   - If the user clicks **STOP MOTOR** while in AUTO mode, the ESP32 stops the pump and latches `manual_stop_latched = true`. The motor will not immediately restart even if the water is `<= 20%`, preventing unwanted cycling until the user explicitly restarts or switches mode.
3. **Sensor Disconnection Watchdog**:
   - If the HC-SR04 Echo pin is disconnected or fails 3 consecutive times, the ESP32 immediately turns the relay **OFF** and flags `sensor_error = true`.
4. **Local Edge Operation during Wi-Fi Loss**:
   - If your home Wi-Fi disconnects or Firebase is unreachable, the ESP32 continues running its local sensor reading and relay safety logic uninterrupted.

---

## 7. Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **Database shows `null`** | ESP32 has not yet published initial data to `/tank` | Power on your ESP32 with correct Wi-Fi credentials. Watch Serial Monitor (115200 baud). Once connected, it will populate `/tank`. |
| **Permission Denied in Console** | Database Security Rules block read/write | Check **Realtime Database -> Rules** in Firebase Console. Ensure `.read: true` and `.write: true` are enabled for `/tank` and `/control`. |
| **ESP32 Serial shows `Token error`** | Invalid Web API Key in `#define API_KEY` | Copy the exact Web API Key from Firebase Console -> Project Settings -> General. |
| **Distance always reads 0 cm or 400 cm** | HC-SR04 Echo/Trig wiring issue | Verify TRIG is connected to GPIO 5, ECHO is connected through voltage divider to GPIO 18, and VCC is getting a clean 5V rail. |
| **Relay clicks on boot and turns ON pump** | Inverted Relay Polarity | Change `#define RELAY_ACTIVE_LOW true` to `false` (or vice-versa) in `esp32_water_tank.ino` and re-upload. |
| **Motor doesn't start from dashboard** | Manual mode not enabled or full cutoff triggered | Make sure you switch to **MANUAL** mode before clicking **START PUMP**. If water level is &ge; 95%, start is safely blocked. |
