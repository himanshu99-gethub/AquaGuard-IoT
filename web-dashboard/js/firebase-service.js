/**
 * AquaGuard IoT — Firebase Realtime Database Service
 * 
 * Complies with user schema:
 * {
 *   "tank": {
 *     "distance_cm": 0,
 *     "water_level_cm": 0,
 *     "water_level_percent": 0,
 *     "motor_status": "OFF",
 *     "mode": "AUTO",
 *     "esp32_online": false,
 *     "last_updated": 0
 *   },
 *   "control": {
 *     "command": "STOP",
 *     "mode": "AUTO"
 *   }
 * }
 */

class FirebaseService {
  constructor() {
    this.app = null;
    this.db = null;
    this.auth = null;
    this.isConnected = false;
    this.telemetryListener = null;
    this.controlListener = null;
    this.heartbeatInterval = null;
    this.lastPacketTime = 0;
    this.latestTankData = null;
    this.subscribers = [];
    this.statusSubscribers = [];

    // Load credentials: fallback to window.FIREBASE_CONFIG then localStorage
    this.config = this.loadStoredConfig();
  }

  loadStoredConfig() {
    const defaultConfig = window.FIREBASE_CONFIG || {
      databaseURL: "https://water-tank-d2a34-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "water-tank-d2a34",
      apiKey: "",
      enabled: true
    };

    try {
      const stored = localStorage.getItem('aquaguard_firebase_config');
      if (stored) {
        return { ...defaultConfig, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Could not read firebase config from localStorage', e);
    }

    return defaultConfig;
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      localStorage.setItem('aquaguard_firebase_config', JSON.stringify(this.config));
    } catch (e) {
      console.error('Failed to save config to localStorage', e);
    }
  }

  /**
   * Initializes Firebase App, Auth & DB Connection
   */
  async initialize(customConfig = null) {
    if (customConfig) {
      this.saveConfig(customConfig);
    }

    if (!this.config.databaseURL) {
      this.disconnect();
      return false;
    }

    try {
      if (typeof firebase === 'undefined') {
        throw new Error('Firebase SDK scripts not loaded.');
      }

      // Initialize or reuse app
      const appName = 'aquaguard_firebase_app';
      let existingApp = null;
      for (const app of firebase.apps) {
        if (app.name === appName || app.name === '[DEFAULT]') {
          existingApp = app;
          break;
        }
      }

      if (!existingApp) {
        this.app = firebase.initializeApp({
          apiKey: this.config.apiKey,
          authDomain: this.config.authDomain || 'water-tank-d2a34.firebaseapp.com',
          databaseURL: this.config.databaseURL,
          projectId: this.config.projectId || 'water-tank-d2a34',
          storageBucket: this.config.storageBucket || 'water-tank-d2a34.firebasestorage.app',
          messagingSenderId: this.config.messagingSenderId || '734996100391',
          appId: this.config.appId || '1:734996100391:web:5fcb4d6757b70caffa2502',
          measurementId: this.config.measurementId || 'G-9LLM7XZX0L'
        }, appName);
      } else {
        this.app = existingApp;
      }

      // Optional Authentication
      if (firebase.auth && this.config.useAuth && this.config.apiKey) {
        this.auth = this.app.auth ? this.app.auth() : firebase.auth(this.app);
        try {
          if (this.config.authType === 'email' && this.config.authEmail && this.config.authPassword) {
            await this.auth.signInWithEmailAndPassword(this.config.authEmail, this.config.authPassword);
          } else {
            await this.auth.signInAnonymously();
          }
        } catch (authErr) {
          console.warn('Firebase Auth notice:', authErr.message);
        }
      }

      this.db = this.app.database ? this.app.database() : firebase.database(this.app);
      this.isConnected = true;
      this.notifyStatus(true, 'Connected to Firebase Realtime Database');

      // Start listening to the exact schema path: /tank
      this.listenToTank();

      // Start Heartbeat monitor
      this.startHeartbeatMonitor();

      return true;
    } catch (err) {
      console.error('Firebase initialization error:', err);
      this.isConnected = false;
      this.notifyStatus(false, err.message);
      return false;
    }
  }

  disconnect() {
    if (this.telemetryListener && this.db) {
      this.db.ref('tank').off('value', this.telemetryListener);
      this.telemetryListener = null;
    }
    if (this.controlListener && this.db) {
      this.db.ref('control').off('value', this.controlListener);
      this.controlListener = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.isConnected = false;
    this.notifyStatus(false, 'Disconnected');
  }

  /**
   * Realtime Listener for ESP32 Sensor Telemetry under /tank
   */
  listenToTank() {
    if (!this.db) return;

    const tankRef = this.db.ref('tank');
    this.telemetryListener = tankRef.on('value', (snapshot) => {
      const data = snapshot.val();
      
      // If database currently shows null
      if (data === null || typeof data !== 'object') {
        this.notifyStatus(true, 'Connected to Firebase. Database path "tank" is currently null. Waiting for ESP32...');
        return;
      }

      this.lastPacketTime = Date.now();
      this.latestTankData = data;

      // Extract values adhering to user specification
      const isMotorOn = (data.motor_status === 'ON' || data.motor_status === true || data.motor_running === true);
      const rawMode = (data.mode || 'AUTO').toUpperCase();
      const levelPct = Math.max(0, Math.min(100, Number(data.water_level_percent ?? data.level_pct ?? 0)));
      const waterCm = Number(data.water_level_cm ?? data.water_cm ?? 0);
      const distanceCm = Number(data.distance_cm ?? 0);
      const isEspOnline = Boolean(data.esp32_online);
      const lastUpdatedMs = Number(data.last_updated || Date.now());

      // Calculate tank volume according to configured tank capacity (Universal for any tank size)
      const capacityLiters = Number(data.capacity_liters) || window.app?.config?.capacityLiters || 1.0;
      const volumeLiters = (data.volume_liters !== undefined && data.volume_liters !== null)
        ? Number(Number(data.volume_liters).toFixed(2))
        : Number(((levelPct / 100) * capacityLiters).toFixed(2));
      const freeVolumeLiters = (data.free_volume_liters !== undefined && data.free_volume_liters !== null)
        ? Number(Number(data.free_volume_liters).toFixed(2))
        : Number(Math.max(0, capacityLiters - volumeLiters).toFixed(2));

      // Determine safety status
      let systemStatus = 'NORMAL';
      if (levelPct >= (window.app?.config?.fullThreshold || 100)) {
        systemStatus = 'CUTOFF';
      } else if (levelPct <= (window.app?.config?.lowThreshold || 20)) {
        systemStatus = 'LOW';
      }

      // Check for sensor error condition (e.g. distance = 0 or > 400 or flag)
      const sensorError = Boolean(data.sensor_error || (distanceCm === 0 && waterCm === 0 && levelPct === 0));

      const normalized = {
        level_pct: levelPct,
        water_cm: waterCm,
        distance_cm: distanceCm,
        volume_liters: volumeLiters,
        free_volume_liters: freeVolumeLiters,
        motor_running: isMotorOn,
        mode: rawMode.toLowerCase(), // 'auto' | 'manual'
        raw_mode: rawMode,           // 'AUTO' | 'MANUAL'
        manual_stop_latched: Boolean(data.manual_stop_latched),
        esp_online: isEspOnline,
        sensor_error: sensorError,
        system_status: systemStatus,
        pump_runtime_sec: Number(data.pump_runtime_sec ?? 0),
        last_activity: lastUpdatedMs,
        last_seen: Date.now()
      };

      this.notifyData(normalized);
    }, (error) => {
      console.error('Firebase /tank listener error:', error);
      const isPermDenied = error.code === 'PERMISSION_DENIED' || (error.message && error.message.toLowerCase().includes('permission_denied'));
      const friendlyMsg = isPermDenied 
        ? 'Firebase Database Rules Locked: Go to Firebase Console > Realtime Database > Rules and set ".read": true, ".write": true'
        : error.message;
      this.notifyStatus(false, friendlyMsg);
    });
  }

  /**
   * Send Motor Command to /control
   * schema: { "control": { "command": "START" | "STOP", "mode": "AUTO" | "MANUAL" } }
   */
  async sendMotorCommand(command) {
    if (!this.db || !this.isConnected) {
      throw new Error('Cannot send command: Firebase not connected.');
    }

    const controlRef = this.db.ref('control');
    const updateObj = {
      command: command, // "START" or "STOP"
      last_command_time: Date.now()
    };

    await controlRef.update(updateObj);
    return updateObj;
  }

  /**
   * Send Mode Command to /control
   */
  async sendModeCommand(mode) {
    if (!this.db || !this.isConnected) {
      throw new Error('Cannot send mode: Firebase not connected.');
    }

    const controlRef = this.db.ref('control');
    const updateObj = {
      mode: mode.toUpperCase(), // "AUTO" or "MANUAL"
      last_command_time: Date.now()
    };

    await controlRef.update(updateObj);
    return updateObj;
  }

  /**
   * Sync tank calibration settings to Firebase (/config)
   */
  async syncConfig(config) {
    if (!this.db || !this.isConnected) return;
    try {
      await this.db.ref('config').update({
        tank_height_cm: Number(config.tankHeight) || 15.0,
        sensor_offset_cm: Number(config.sensorOffset) || 2.0,
        low_threshold_pct: Number(config.lowThreshold) || 20,
        full_threshold_pct: Number(config.fullThreshold) || 100,
        capacity_liters: Number(config.capacityLiters) || 1.0,
        hysteresis_pct: Number(config.hysteresis) || 2.0,
        last_updated: Date.now()
      });
    } catch (err) {
      console.warn('Firebase config sync notice:', err.message);
    }
  }

  /**
   * Monitor Heartbeat:
   * Checks both the esp32_online flag and last_updated timestamp
   */
  startHeartbeatMonitor() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) return;

      const timeSinceLastPacket = Date.now() - this.lastPacketTime;
      // ESP32 is considered online if a packet was received within 12 seconds
      // AND latest data explicitly reports esp32_online !== false
      let isOnline = false;
      if (this.latestTankData) {
        const flagOnline = Boolean(this.latestTankData.esp32_online);
        const fresh = this.lastPacketTime > 0 && timeSinceLastPacket < 12000;
        isOnline = flagOnline && fresh;
      }

      this.statusSubscribers.forEach(cb => cb({
        firebaseConnected: this.isConnected,
        espOnline: isOnline,
        timeSinceLastPacket
      }));
    }, 2000);
  }

  // --- Subscription Management ---

  subscribeData(callback) {
    this.subscribers.push(callback);
  }

  subscribeStatus(callback) {
    this.statusSubscribers.push(callback);
  }

  notifyData(data) {
    this.subscribers.forEach(cb => cb(data));
  }

  notifyStatus(connected, message = '') {
    this.statusSubscribers.forEach(cb => cb({
      firebaseConnected: connected,
      espOnline: connected && Boolean(this.latestTankData?.esp32_online),
      message
    }));
  }
}

// Export singleton instance
window.firebaseService = new FirebaseService();
