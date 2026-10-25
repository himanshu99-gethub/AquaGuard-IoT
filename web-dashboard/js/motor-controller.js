/**
 * AquaGuard IoT — Motor Controller Component
 * Manages mode toggles, Start/Stop buttons, interlock validation,
 * and safety latch states.
 */

class MotorController {
  constructor() {
    // DOM Elements
    this.btnModeAuto = document.getElementById('btnModeAuto');
    this.btnModeManual = document.getElementById('btnModeManual');
    this.btnStartMotor = document.getElementById('btnStartMotor');
    this.btnStopMotor = document.getElementById('btnStopMotor');
    this.startBtnHint = document.getElementById('startBtnHint');
    this.stopBtnHint = document.getElementById('stopBtnHint');

    // Pump Metric Card Elements
    this.pumpPill = document.getElementById('pumpPill');
    this.pumpIconCircle = document.getElementById('pumpIconCircle');
    this.pumpStatusLarge = document.getElementById('pumpStatusLarge');
    this.pumpRuntimeText = document.getElementById('pumpRuntimeText');

    // Safety Rules Elements
    this.ruleCutoff = document.getElementById('ruleCutoff');
    this.ruleCutoffVal = document.getElementById('ruleCutoffVal');
    this.ruleManualLatch = document.getElementById('ruleManualLatch');
    this.ruleManualLatchText = document.getElementById('ruleManualLatchText');

    this.currentMode = 'auto';
    this.isMotorRunning = false;
    this.manualStopLatched = false;
    this.currentLevelPct = 0;

    this.initEventListeners();
  }

  initEventListeners() {
    // Mode toggles
    if (this.btnModeAuto) {
      this.btnModeAuto.addEventListener('click', () => this.handleModeChange('auto'));
    }
    if (this.btnModeManual) {
      this.btnModeManual.addEventListener('click', () => this.handleModeChange('manual'));
    }

    // Motor Actions
    if (this.btnStartMotor) {
      this.btnStartMotor.addEventListener('click', () => this.handleStartClick());
    }
    if (this.btnStopMotor) {
      this.btnStopMotor.addEventListener('click', () => this.handleStopClick());
    }
  }

  /**
   * Update controller UI based on telemetry state
   */
  update(telemetry, config) {
    if (!telemetry) return;

    this.currentMode = telemetry.mode || 'auto';
    this.isMotorRunning = Boolean(telemetry.motor_running);
    this.manualStopLatched = Boolean(telemetry.manual_stop_latched);
    this.currentLevelPct = Number(telemetry.level_pct || 0);

    const fullCutoff = config?.fullThreshold || 100;

    // 1. Update Mode Toggle Active State
    if (this.btnModeAuto && this.btnModeManual) {
      if (this.currentMode === 'auto') {
        this.btnModeAuto.classList.add('active');
        this.btnModeManual.classList.remove('active');
      } else {
        this.btnModeAuto.classList.remove('active');
        this.btnModeManual.classList.add('active');
      }
    }

    // 2. Update Pump Metric Indicator Card
    if (this.pumpPill && this.pumpIconCircle && this.pumpStatusLarge) {
      if (this.isMotorRunning) {
        this.pumpPill.textContent = 'RUNNING';
        this.pumpPill.className = 'pump-indicator-pill running';
        this.pumpIconCircle.className = 'pump-icon-circle spinning';
        this.pumpStatusLarge.textContent = 'MOTOR ACTIVE';
        this.pumpStatusLarge.style.color = 'var(--palette-seafoam)';
      } else {
        this.pumpPill.textContent = 'STOPPED';
        this.pumpPill.className = 'pump-indicator-pill';
        this.pumpIconCircle.className = 'pump-icon-circle';
        this.pumpStatusLarge.textContent = 'MOTOR OFF';
        this.pumpStatusLarge.style.color = 'var(--text-heading)';
      }
    }

    // 3. Format Runtime
    if (this.pumpRuntimeText) {
      const sec = telemetry.pump_runtime_sec || 0;
      const hrs = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const secs = String(sec % 60).padStart(2, '0');
      this.pumpRuntimeText.textContent = this.isMotorRunning
        ? `Runtime: ${hrs}:${mins}:${secs}`
        : `Idle: ${hrs}:${mins}:${secs}`;
    }

    // 4. Update Button Interlocks & States
    this.updateButtonInterlocks(fullCutoff);

    // 5. Update Safety Rules Checklist
    if (this.ruleCutoffVal) {
      this.ruleCutoffVal.textContent = `${fullCutoff}%`;
    }

    if (this.ruleManualLatch) {
      if (this.manualStopLatched) {
        this.ruleManualLatch.className = 'rule-item active-warning';
        this.ruleManualLatchText.innerHTML = `<strong>Manual Stop Latched:</strong> Auto-start paused until you resume.`;
      } else {
        this.ruleManualLatch.className = 'rule-item passed';
        this.ruleManualLatchText.textContent = `Manual stop latch: Ready for automatic operation`;
      }
    }
  }

  updateButtonInterlocks(fullCutoff) {
    // START BUTTON LOGIC:
    // Only enabled in Manual Mode AND when motor is NOT running AND water is below cutoff
    if (this.btnStartMotor) {
      if (this.isMotorRunning) {
        this.btnStartMotor.disabled = true;
        this.startBtnHint.textContent = 'Motor is already running';
      } else if (this.currentLevelPct >= fullCutoff) {
        this.btnStartMotor.disabled = true;
        this.startBtnHint.textContent = `Blocked: Tank >= ${fullCutoff}%`;
      } else {
        this.btnStartMotor.disabled = false;
        this.startBtnHint.textContent = this.currentMode === 'auto' ? 'Manual start override' : 'Press to run pump';
      }
    }

    // STOP BUTTON LOGIC:
    // The user MUST be able to stop the pump at ANY time (even in auto mode or at 50%!)
    if (this.btnStopMotor) {
      if (!this.isMotorRunning) {
        this.btnStopMotor.disabled = true;
        this.stopBtnHint.textContent = 'Motor is already stopped';
      } else {
        this.btnStopMotor.disabled = false;
        this.stopBtnHint.textContent = 'Stop immediately at any level';
      }
    }
  }

  // --- Handlers ---

  async handleModeChange(targetMode) {
    const formatted = targetMode.toUpperCase(); // "AUTO" or "MANUAL"
    try {
      await window.firebaseService.sendModeCommand(formatted);
      window.app.addLog(`Remote command: Switch to ${formatted} sent to Firebase (/control/mode).`, 'info');
    } catch (err) {
      window.app.addLog(`Failed to change mode: ${err.message}`, 'danger');
    }
  }

  async handleStartClick() {
    if (this.btnStartMotor) {
      this.btnStartMotor.disabled = true;
      if (this.startBtnHint) this.startBtnHint.textContent = 'Command sent... Starting pump';
    }
    try {
      await window.firebaseService.sendMotorCommand('START');
      window.app.addLog('Remote command: START sent to Firebase (/control/command).', 'info');
    } catch (err) {
      window.app.addLog(`Failed to start motor: ${err.message}`, 'danger');
      if (this.btnStartMotor) this.btnStartMotor.disabled = false;
    }
  }

  async handleStopClick() {
    if (this.btnStopMotor) {
      this.btnStopMotor.disabled = true;
      if (this.stopBtnHint) this.stopBtnHint.textContent = 'Command sent... Stopping pump';
    }
    try {
      await window.firebaseService.sendMotorCommand('STOP');
      window.app.addLog('Remote command: STOP sent to Firebase (/control/command).', 'warning');
    } catch (err) {
      window.app.addLog(`Failed to stop motor: ${err.message}`, 'danger');
      if (this.btnStopMotor) this.btnStopMotor.disabled = false;
    }
  }
}

// Export singleton instance
window.motorController = new MotorController();
