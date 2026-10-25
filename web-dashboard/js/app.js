/**
 * AquaGuard IoT — Main Application Controller (100% Live Real Hardware & Firebase)
 * Coordinates real telemetry data flow, UI states, settings, and logs without fake data.
 */

class AppController {
  constructor() {
    this.mode = 'live'; // Exclusively 100% Live Real Hardware
    
    // Config defaults
    this.config = this.loadConfig();

    // DOM Elements
    this.dataModeBadge = document.getElementById('dataModeBadge');
    this.dataModeText = document.getElementById('dataModeText');
    this.esp32StatusBadge = document.getElementById('esp32StatusBadge');
    this.esp32StatusText = document.getElementById('esp32StatusText');
    this.liveClock = document.getElementById('liveClock');
    this.safetyBanner = document.getElementById('safetyBanner');
    this.safetyBannerText = document.getElementById('safetyBannerText');
    this.dismissBannerBtn = document.getElementById('dismissBannerBtn');
    this.logFeed = document.getElementById('logFeed');

    // Metrics DOM
    this.valPercentage = document.getElementById('valPercentage');
    this.waterLevelBar = document.getElementById('waterLevelBar');
    this.tankStateBadge = document.getElementById('tankStateBadge');
    this.valWaterCm = document.getElementById('valWaterCm');
    this.valDistanceCm = document.getElementById('valDistanceCm');
    this.valTankHeight = document.getElementById('valTankHeight');
    this.valVolumeLiters = document.getElementById('valVolumeLiters');
    this.valFreeVolumeLiters = document.getElementById('valFreeVolumeLiters');
    this.valTotalCapacity = document.getElementById('valTotalCapacity');
    this.valSafeRange = document.getElementById('valSafeRange');
    this.valLastActivity = document.getElementById('valLastActivity');

    // Settings Modal DOM
    this.settingsModal = document.getElementById('settingsModal');
    this.openSettingsBtn = document.getElementById('openSettingsBtn');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    this.tankSettingsForm = document.getElementById('tankSettingsForm');
    this.firebaseSettingsForm = document.getElementById('firebaseSettingsForm');
    this.btnResetSettings = document.getElementById('btnResetSettings');
    this.btnDisconnectFirebase = document.getElementById('btnDisconnectFirebase');

    // Settings Inputs
    this.inputTankHeight = document.getElementById('inputTankHeight');
    this.inputSensorOffset = document.getElementById('inputSensorOffset');
    this.inputLowThreshold = document.getElementById('inputLowThreshold');
    this.inputFullThreshold = document.getElementById('inputFullThreshold');
    this.inputCapacity = document.getElementById('inputCapacity');
    this.inputHysteresis = document.getElementById('inputHysteresis');

    this.inputFbDatabaseUrl = document.getElementById('inputFbDatabaseUrl');
    this.inputFbApiKey = document.getElementById('inputFbApiKey');
    this.inputFbProjectId = document.getElementById('inputFbProjectId');
    this.checkEnableLiveFirebase = document.getElementById('checkEnableLiveFirebase');

    // Theme Switcher DOM
    this.themeToggleBtn = document.getElementById('themeToggleBtn');
    this.themeIconSun = document.getElementById('themeIconSun');
    this.themeIconMoon = document.getElementById('themeIconMoon');
    this.currentTheme = localStorage.getItem('aquaguard_theme') || 'light';

    this.init();
  }

  loadConfig() {
    const saved = localStorage.getItem('aquaguard_tank_config');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      tankHeight: 15.0,
      sensorOffset: 2.0,
      lowThreshold: 20,
      fullThreshold: 100,
      capacityLiters: 1.0,
      hysteresis: 2.0
    };
  }

  async saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      localStorage.setItem('aquaguard_tank_config', JSON.stringify(this.config));
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }

    if (window.firebaseService && typeof window.firebaseService.syncConfig === 'function') {
      try {
        await window.firebaseService.syncConfig(this.config);
      } catch (err) {
        console.warn('Firebase config sync notice:', err);
      }
    }
    this.applyConfigToUI();
  }

  init() {
    // 1. Digital Clock & Theme Setup
    this.startClock();
    this.applyTheme(this.currentTheme);
    if (this.themeToggleBtn) {
      this.themeToggleBtn.addEventListener('click', () => {
        const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(nextTheme);
      });
    }

    // 2. Setup Settings Modal & Tabs
    this.setupSettingsModal();
    this.applyConfigToUI();

    // 3. Connect Telemetry Subscriptions to Real Firebase Stream
    window.firebaseService.subscribeData((data) => {
      this.handleTelemetryUpdate(data);
    });

    window.firebaseService.subscribeStatus((status) => {
      this.handleConnectionStatusUpdate(status);
    });

    // 4. Chart Time Window Controls
    this.setupChartControls();

    // 5. Alert Banner Dismiss
    if (this.dismissBannerBtn) {
      this.dismissBannerBtn.addEventListener('click', () => {
        this.safetyBanner.classList.add('hidden');
      });
    }

    // 6. Data Mode Badge Click (Opens Firebase Settings)
    if (this.dataModeBadge) {
      this.dataModeBadge.addEventListener('click', () => {
        this.openSettings(1); // Open Firebase tab
      });
    }

    // 7. Initialize Real Firebase Live Connection
    this.addLog('AquaGuard IoT Dashboard initialized. Fake data generator removed.', 'info');
    this.connectLiveFirebase();
  }

  async connectLiveFirebase() {
    if (this.dataModeText) this.dataModeText.textContent = 'CONNECTING TO FIREBASE...';
    
    const success = await window.firebaseService.initialize();
    if (success) {
      if (this.dataModeText) this.dataModeText.textContent = 'FIREBASE: CONNECTED';
      if (this.dataModeBadge) this.dataModeBadge.className = 'mode-badge live-active';
      this.addLog('Connected to Firebase Realtime Database: water-tank-d2a34', 'success');
      this.addLog('Listening for live ESP32 telemetry on /tank and streaming /control...', 'info');
    } else {
      if (this.dataModeText) this.dataModeText.textContent = 'FIREBASE: OFFLINE';
      if (this.dataModeBadge) this.dataModeBadge.className = 'mode-badge';
      this.addLog('Could not connect to Firebase. Check internet connection and settings.', 'danger');
    }
  }

  setTheme(themeName) {
    this.currentTheme = themeName;
    localStorage.setItem('aquaguard_theme', themeName);
    this.applyTheme(themeName);
    if (window.chartManager) {
      window.chartManager.updateTheme();
    }
    this.addLog(`Switched theme to ${themeName === 'dark' ? 'Deep Teal' : 'Clean Mist'} mode.`, 'info');
  }

  applyTheme(themeName) {
    if (themeName === 'dark') {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      if (this.themeIconSun) this.themeIconSun.classList.remove('hidden');
      if (this.themeIconMoon) this.themeIconMoon.classList.add('hidden');
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      if (this.themeIconSun) this.themeIconSun.classList.add('hidden');
      if (this.themeIconMoon) this.themeIconMoon.classList.remove('hidden');
    }
  }

  startClock() {
    const update = () => {
      const now = new Date();
      this.liveClock.textContent = now.toTimeString().split(' ')[0];
    };
    update();
    setInterval(update, 1000);
  }

  isLiveMode() {
    return true; // Always 100% Live
  }

  /**
   * Main Dispatcher for New Telemetry Data from Real ESP32 via Firebase (/tank)
   */
  handleTelemetryUpdate(data) {
    if (!data) return;

    // 1. Update Metrics Cards with Real Sensor Readings
    const levelPct = Math.max(0, Math.min(100, Number(data.level_pct || 0)));
    this.valPercentage.textContent = levelPct.toFixed(1);
    this.waterLevelBar.style.width = `${levelPct}%`;

    this.valWaterCm.textContent = Number(data.water_cm || 0).toFixed(1);
    this.valDistanceCm.textContent = Number(data.distance_cm || 0).toFixed(1);
    this.valVolumeLiters.textContent = Number(data.volume_liters || 0).toFixed(1);
    this.valFreeVolumeLiters.textContent = Number(data.free_volume_liters || 0).toFixed(1);

    // Update Status Pill
    this.updateStatusBadge(data.system_status, levelPct);

    // Update Last Activity
    if (data.last_activity) {
      const secAgo = Math.max(0, Math.floor((Date.now() - data.last_activity) / 1000));
      this.valLastActivity.textContent = secAgo < 5 ? 'Just now' : `${secAgo}s ago`;
    }

    // Update Hardware Telemetry Link info
    const lastPacketEl = document.getElementById('valLastPacketTime');
    if (lastPacketEl) {
      lastPacketEl.textContent = new Date().toLocaleTimeString();
    }
    const linkDescEl = document.getElementById('cloudLinkDesc');
    if (linkDescEl) {
      linkDescEl.textContent = 'ESP32 Streaming Live';
      linkDescEl.style.color = 'var(--palette-seafoam)';
    }

    // 2. Update Graphical Tank Visualizer
    window.tankVisualizer.update(data, this.config);

    // 3. Update Motor Control Panel
    window.motorController.update(data, this.config);

    // 4. Append to Realtime Chart
    window.chartManager.addDataPoint(levelPct, data.motor_running);

    // 5. Check Safety Alarm Callouts
    if (levelPct >= this.config.fullThreshold) {
      this.showSafetyBanner(`CRITICAL: Tank reached ${levelPct.toFixed(1)}%. Safety cutoff active. Motor stopped.`);
    } else if (data.sensor_error) {
      this.showSafetyBanner('SENSOR ERROR: Ultrasonic sensor timeout or disconnected. Motor locked.');
    } else {
      this.safetyBanner.classList.add('hidden');
    }
  }

  updateStatusBadge(status, levelPct) {
    let text = status || 'NORMAL';
    let className = 'metric-badge';

    if (text === 'ERROR') {
      className += ' danger';
    } else if (levelPct >= this.config.fullThreshold || text === 'FULL') {
      className += ' full';
      text = 'FULL';
    } else if (levelPct <= this.config.lowThreshold || text === 'LOW') {
      className += ' low';
      text = 'LOW';
    }

    this.tankStateBadge.textContent = text;
    this.tankStateBadge.className = className;
  }

  showSafetyBanner(message) {
    this.safetyBannerText.textContent = message;
    this.safetyBanner.classList.remove('hidden');
  }

  handleConnectionStatusUpdate(status) {
    if (status.message) {
      this.addLog(status.message, status.firebaseConnected ? 'info' : 'warning');
    }

    const descEl = document.getElementById('cloudLinkDesc');

    if (status.espOnline) {
      this.updateESP32Status(true);
      if (this.dataModeText) this.dataModeText.textContent = 'LIVE CLOUD (ESP32)';
      if (this.dataModeBadge) this.dataModeBadge.className = 'mode-badge live-active';
      if (descEl) {
        descEl.textContent = 'ESP32 Online & Transmitting';
        descEl.style.color = 'var(--palette-seafoam)';
      }
    } else {
      this.updateESP32Status(false);
      if (status.firebaseConnected) {
        if (this.dataModeText) this.dataModeText.textContent = 'LIVE RTDB (Awaiting ESP32)';
        if (this.dataModeBadge) this.dataModeBadge.className = 'mode-badge live-active';
        if (descEl) {
          descEl.textContent = 'Awaiting ESP32 transmission';
          descEl.style.color = 'var(--text-muted)';
        }
      }
    }
  }

  updateESP32Status(isOnline) {
    if (isOnline) {
      this.esp32StatusBadge.className = 'esp-status-badge online';
      this.esp32StatusText.textContent = 'ESP32: ONLINE';
    } else {
      this.esp32StatusBadge.className = 'esp-status-badge offline';
      this.esp32StatusText.textContent = 'ESP32: OFFLINE';
    }
  }

  /**
   * System Log Feed
   */
  addLog(message, type = 'info') {
    if (!this.logFeed) return;

    const time = new Date().toTimeString().split(' ')[0];
    const item = document.createElement('div');
    item.className = `log-entry ${type}`;
    item.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-msg">${message}</span>
    `;

    this.logFeed.prepend(item);

    // Limit log entries to 50
    while (this.logFeed.children.length > 50) {
      this.logFeed.removeChild(this.logFeed.lastChild);
    }
  }

  // --- Settings Modal & Tabs ---

  setupSettingsModal() {
    this.openSettingsBtn?.addEventListener('click', () => this.openSettings());
    this.closeSettingsBtn?.addEventListener('click', () => this.closeSettings());

    this.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeSettings();
    });

    const tabBtns = this.settingsModal.querySelectorAll('.tab-btn');
    const tabContents = this.settingsModal.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');
      });
    });

    // Tank Settings Form Submit
    this.tankSettingsForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const newConfig = {
          tankHeight: parseFloat(this.inputTankHeight.value) || 30.0,
          sensorOffset: parseFloat(this.inputSensorOffset.value) || 4.0,
          lowThreshold: parseFloat(this.inputLowThreshold.value) || 20,
          fullThreshold: parseFloat(this.inputFullThreshold.value) || 95,
          capacityLiters: parseFloat(this.inputCapacity.value) || 20.0,
          hysteresis: parseFloat(this.inputHysteresis.value) || 3.0
        };

        await this.saveConfig(newConfig);
        this.addLog(`Tank settings saved: Height ${newConfig.tankHeight}cm, Cap ${newConfig.capacityLiters}L`, 'success');
        this.closeSettings();
      } catch (err) {
        console.error('Error saving tank settings:', err);
        this.closeSettings();
      }
    });

    // Reset Defaults Button
    this.btnResetSettings?.addEventListener('click', () => {
      const defaults = {
        tankHeight: 15.0,
        sensorOffset: 2.0,
        lowThreshold: 20,
        fullThreshold: 100,
        capacityLiters: 1.0,
        hysteresis: 2.0
      };
      this.inputTankHeight.value = defaults.tankHeight;
      this.inputSensorOffset.value = defaults.sensorOffset;
      this.inputLowThreshold.value = defaults.lowThreshold;
      this.inputFullThreshold.value = defaults.fullThreshold;
      this.inputCapacity.value = defaults.capacityLiters;
      this.inputHysteresis.value = defaults.hysteresis;
      this.addLog('Reset calibration inputs to defaults (15cm height, 2cm offset, 100% full). Click Save to apply.', 'info');
    });

    // Firebase Settings Form Submit
    this.firebaseSettingsForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fbConfig = {
        databaseURL: this.inputFbDatabaseUrl.value.trim(),
        apiKey: this.inputFbApiKey.value.trim(),
        projectId: this.inputFbProjectId.value.trim(),
        enabled: true
      };

      window.firebaseService.saveConfig(fbConfig);
      await this.connectLiveFirebase();
      this.closeSettings();
    });

    // Disconnect Firebase Button
    this.btnDisconnectFirebase?.addEventListener('click', () => {
      window.firebaseService.disconnect();
      this.updateESP32Status(false);
      if (this.dataModeText) this.dataModeText.textContent = 'FIREBASE: DISCONNECTED';
      if (this.dataModeBadge) this.dataModeBadge.className = 'mode-badge';
      this.addLog('Disconnected from Firebase.', 'warning');
      this.closeSettings();
    });

    // Clear logs button
    document.getElementById('btnClearLogs')?.addEventListener('click', () => {
      this.logFeed.innerHTML = '';
      this.addLog('Log history cleared.', 'info');
    });
  }

  openSettings(tabIndex = 0) {
    this.populateSettingsInputs();
    const tabBtns = this.settingsModal.querySelectorAll('.tab-btn');
    if (tabBtns[tabIndex]) {
      tabBtns[tabIndex].click();
    }
    const modalBody = this.settingsModal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.settingsModal.classList.add('hidden');
  }

  populateSettingsInputs() {
    this.inputTankHeight.value = this.config.tankHeight;
    this.inputSensorOffset.value = this.config.sensorOffset;
    this.inputLowThreshold.value = this.config.lowThreshold;
    this.inputFullThreshold.value = this.config.fullThreshold;
    this.inputCapacity.value = this.config.capacityLiters;
    this.inputHysteresis.value = this.config.hysteresis;

    const fb = window.firebaseService.config;
    this.inputFbDatabaseUrl.value = fb.databaseURL || '';
    this.inputFbApiKey.value = fb.apiKey || '';
    this.inputFbProjectId.value = fb.projectId || '';
    this.checkEnableLiveFirebase.checked = true;
  }

  applyConfigToUI() {
    this.valTankHeight.textContent = this.config.tankHeight.toFixed(1);
    this.valTotalCapacity.textContent = this.config.capacityLiters.toFixed(1);
    this.valSafeRange.textContent = `${this.config.lowThreshold}% - ${this.config.fullThreshold}%`;
  }

  setupChartControls() {
    const filterBtns = document.querySelectorAll('.time-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const points = parseInt(btn.getAttribute('data-points'), 10);
        window.chartManager.setMaxPoints(points);
      });
    });

    document.getElementById('btnClearChart')?.addEventListener('click', () => {
      window.chartManager.clear();
      this.addLog('Chart history cleared.', 'info');
    });
  }
}

// Instantiate on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
