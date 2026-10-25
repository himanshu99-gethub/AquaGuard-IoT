/**
 * AquaGuard IoT — Tank Visualizer Component
 * Controls the animated water level, sinusoidal waves, inflow pipe stream,
 * dynamic color shifts, and threshold markers.
 */

class TankVisualizer {
  constructor() {
    // DOM Elements
    this.waterContainer = document.getElementById('waterContainer');
    this.tankCenterPct = document.getElementById('tankCenterPct');
    this.tankCenterCm = document.getElementById('tankCenterCm');
    this.inflowPipe = document.getElementById('inflowPipe');
    this.ultrasonicWaves = document.getElementById('ultrasonicWaves');
    this.markerCutoff = document.getElementById('markerCutoff');
    this.markerLow = document.getElementById('markerLow');

    this.currentLevel = 0;
  }

  /**
   * Update the graphical tank visualization based on telemetry
   */
  update(telemetry, config) {
    if (!telemetry) return;

    const levelPct = Math.max(0, Math.min(100, Number(telemetry.level_pct || 0)));
    this.currentLevel = levelPct;

    // 1. Animate Water Height
    if (this.waterContainer) {
      this.waterContainer.style.height = `${levelPct}%`;

      // Color Theme based on level
      this.waterContainer.classList.remove('state-low', 'state-full');
      if (levelPct <= (config?.lowThreshold || 20)) {
        this.waterContainer.classList.add('state-low');
      } else if (levelPct >= (config?.fullThreshold || 100)) {
        this.waterContainer.classList.add('state-full');
      }
    }

    // 2. Center Readout
    if (this.tankCenterPct) {
      this.tankCenterPct.textContent = `${levelPct.toFixed(1)}%`;
    }
    if (this.tankCenterCm) {
      const waterCm = Number(telemetry.water_cm || 0).toFixed(1);
      this.tankCenterCm.textContent = `${waterCm} cm depth`;
    }

    // 3. Inflow Stream Animation (Active when pump is ON)
    if (this.inflowPipe) {
      if (telemetry.motor_running) {
        this.inflowPipe.classList.add('flowing');
      } else {
        this.inflowPipe.classList.remove('flowing');
      }
    }

    // 4. Ultrasonic Sensor Animation
    if (this.ultrasonicWaves) {
      if (telemetry.sensor_error) {
        this.ultrasonicWaves.style.opacity = '0.2';
      } else {
        this.ultrasonicWaves.style.opacity = '1';
      }
    }

    // 5. Update Threshold Marker Positions from Config
    if (config) {
      if (this.markerCutoff && config.fullThreshold) {
        this.markerCutoff.style.bottom = `${config.fullThreshold}%`;
        const label = this.markerCutoff.querySelector('.marker-label');
        if (label) label.textContent = `CUTOFF (${config.fullThreshold}%)`;
      }
      if (this.markerLow && config.lowThreshold) {
        this.markerLow.style.bottom = `${config.lowThreshold}%`;
        const label = this.markerLow.querySelector('.marker-label');
        if (label) label.textContent = `LOW (${config.lowThreshold}%)`;
      }
    }
  }
}

// Export singleton instance
window.tankVisualizer = new TankVisualizer();
