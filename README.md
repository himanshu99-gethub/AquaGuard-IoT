# AquaGuard IoT — Smart Water Tank & Motor Controller

![AquaGuard IoT Banner](web-dashboard/css/styles.css)

An enterprise-grade, edge-resilient Smart Water Tank Monitoring and Autonomous Pump Controller powered by **ESP32**, **Firebase Realtime Database**, and a modern **Glassmorphism Web Dashboard**.

---

## 🌟 Key Features

* **Universal Tank Capacity:** Calibrate for any tank volume (1L test bench, 500L, 1000L, 2000L rooftop tanks) with real-time Liter calculations.
* **Autonomous Edge Intelligence:** Autonomous pump control (<20% auto-fill, brim cutoff at 100%) runs locally on ESP32 even if Wi-Fi or Internet disconnects.
* **Acoustic Wave & Ripple Filtering:** 3-sample median filter + 2-consecutive sustained full checks eliminate false cutoffs caused by water splashes and waves.
* **Remote Manual Control:** Instant START / STOP motor override from the web dashboard with real-time mode switching (`AUTO` / `MANUAL`).
* **Dry-Run & Overflow Failsafe:** 15-minute maximum motor runtime watchdog prevents pump burnout if pipes leak or dry-run occurs.
* **Zero-Credential Leaks:** Fully protected by `.gitignore`, `.env`, and `secrets.h` templates so private Wi-Fi and Firebase keys are never exposed on GitHub.
* **Mobile-Responsive Glassmorphism UI:** Responsive layout with 2x2 metric tiles, animated SVG water tank, telemetry diagnostics, and dark mode.

---

## 🛠️ Hardware Wiring & Pinout

| ESP32 Pin | Component | Module Pin | Notes |
| :--- | :--- | :--- | :--- |
| **GPIO 5** | Ultrasonic Sensor (HC-SR04) | **TRIG** | 3.3V Output Trigger Pulse |
| **GPIO 18** | Ultrasonic Sensor (HC-SR04) | **ECHO** | **Must use Voltage Divider (1kΩ + 2kΩ)** to step down 5V echo to 3.3V |
| **GPIO 26** | Relay Module | **IN** | Active LOW relay trigger |
| **VIN / 5V** | Power Rail | **VCC** | 5V supply for HC-SR04 & Relay |
| **GND** | Common Ground | **GND** | Common ground across all modules |

> ⚠️ **IMPORTANT (Voltage Divider on ECHO):** HC-SR04 outputs a 5V logic signal on the ECHO pin. Connect a 1kΩ resistor between ECHO and GPIO 18, and a 2kΩ resistor between GPIO 18 and GND to safely protect the ESP32 3.3V pin.

---

## 📁 Repository Structure

```text
AquaGuard-IoT/
├── .env.example                     # Environment template for cloud/server
├── .gitignore                       # Multi-tier git exclusion rules
├── FIREBASE_INTEGRATION_GUIDE.md    # Comprehensive Firebase setup instructions
├── README.md                        # Documentation & setup guide
├── esp32-firmware/
│   ├── esp32_water_tank.ino         # Production Arduino firmware for ESP32
│   ├── secrets.example.h            # Template for Wi-Fi & Firebase credentials
│   └── secrets.h                    # (Git-ignored) Local private credentials
└── web-dashboard/
    ├── index.html                   # Mobile-responsive web dashboard
    ├── css/
    │   ├── styles.css               # Core design tokens, layout & typography
    │   └── components.css           # Glassmorphism cards, tank SVG & animations
    └── js/
        ├── app.js                   # UI controller, state sync & event handlers
        ├── firebase-config.example.js# Template for web client Firebase config
        ├── firebase-config.js       # (Git-ignored) Local Firebase credentials
        └── firebase-service.js      # Real-time WebSocket listener & command dispatcher
```

---

## 🚀 Quick Start Guide

### 1. Clone the Repository
```bash
git clone https://github.com/himanshu99-gethub/AquaGuard-IoT.git
cd AquaGuard-IoT
```

### 2. Configure ESP32 Firmware
1. Open the [`esp32-firmware`](esp32-firmware/) directory.
2. Copy `secrets.example.h` to `secrets.h`:
   ```bash
   cp esp32-firmware/secrets.example.h esp32-firmware/secrets.h
   ```
3. Open `secrets.h` and enter your Wi-Fi and Firebase credentials:
   ```cpp
   #define WIFI_SSID     "Your_WiFi_SSID"
   #define WIFI_PASSWORD "Your_WiFi_Password"
   #define API_KEY      "Your_Firebase_Web_API_Key"
   #define DATABASE_URL "https://your-project-rtdb.firebaseio.com"
   #define USER_EMAIL    "user@example.com"
   #define USER_PASSWORD "YourPassword"
   ```
4. In Arduino IDE, install required libraries via Library Manager:
   * **Firebase ESP Client** (by Mobizt)
   * **WiFiManager** (by tzapu)
5. Select Board **ESP32 Dev Module** and set **Upload Speed: 115200**. Click **Upload**.

### 3. Configure Web Dashboard
1. Copy `firebase-config.example.js` to `firebase-config.js`:
   ```bash
   cp web-dashboard/js/firebase-config.example.js web-dashboard/js/firebase-config.js
   ```
2. Enter your Firebase project credentials in `web-dashboard/js/firebase-config.js`.
3. Open `web-dashboard/index.html` in any modern web browser or serve via GitHub Pages.

---

## 🔒 Security Best Practices

* Sensitive files (`.env`, `secrets.h`, and `firebase-config.js`) are permanently excluded by `.gitignore`.
* Firebase Realtime Database rules should be secured with Email/Password authentication or restricted path rules.

---

## 📜 License

This project is licensed under the MIT License — see the LICENSE file for details.
