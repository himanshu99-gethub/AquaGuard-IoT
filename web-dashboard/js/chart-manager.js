/**
 * AquaGuard IoT — Realtime Chart Manager (Chart.js)
 * Visualizes water level percentage over time with motor event markers.
 * Designed with the 5-color palette:
 *   #2b6777 (Dark Teal), #c8d8e4 (Ice Mist), #ffffff (White), #f2f2f2 (Slate), #52ab98 (Seafoam)
 */

class ChartManager {
  constructor() {
    this.canvas = document.getElementById('waterLevelChart');
    this.chart = null;
    this.maxPoints = 30; // Default window
    this.previousMotorState = null;

    this.initChart();
  }

  getThemeColors() {
    const isDark = document.body.classList.contains('dark-theme');
    return {
      lineColor: isDark ? '#52ab98' : '#2b7a6c',
      fillStart: isDark ? 'rgba(82, 171, 152, 0.45)' : 'rgba(82, 171, 152, 0.35)',
      fillEnd: isDark ? 'rgba(43, 103, 119, 0.02)' : 'rgba(200, 216, 228, 0.05)',
      pointBorder: isDark ? '#15323a' : '#ffffff',
      gridColor: isDark ? 'rgba(200, 216, 228, 0.12)' : 'rgba(43, 103, 119, 0.12)',
      ticksColor: isDark ? '#c8d8e4' : '#2c545e',
      tooltipBg: isDark ? 'rgba(21, 50, 58, 0.96)' : 'rgba(10, 33, 40, 0.96)',
      tooltipBorder: '#2b7a6c'
    };
  }

  initChart() {
    if (!this.canvas || typeof Chart === 'undefined') return;

    const ctx = this.canvas.getContext('2d');
    const colors = this.getThemeColors();

    // Subtle gradient fill under water line using seafoam to ice mist
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, colors.fillStart);
    gradient.addColorStop(1, colors.fillEnd);

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Water Level (%)',
          data: [],
          borderColor: colors.lineColor,
          borderWidth: 2.8,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: (ctx) => {
            const val = ctx.raw;
            return (val && val.isEvent) ? 6.5 : 2.5;
          },
          pointBackgroundColor: (ctx) => {
            const val = ctx.raw;
            if (val && val.isEvent) {
              return val.eventColor || '#52ab98';
            }
            return '#52ab98';
          },
          pointBorderColor: colors.pointBorder,
          pointBorderWidth: 1.8,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300,
          easing: 'easeOutQuad'
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: colors.tooltipBg,
            titleColor: '#c8d8e4',
            bodyColor: '#ffffff',
            borderColor: colors.tooltipBorder,
            borderWidth: 1.5,
            padding: 11,
            displayColors: false,
            callbacks: {
              label: (context) => {
                const item = context.raw;
                let text = `Level: ${typeof item === 'object' ? item.y : item}%`;
                if (item && item.isEvent) {
                  text += ` (${item.eventLabel})`;
                }
                return text;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: colors.gridColor,
              drawBorder: false
            },
            ticks: {
              color: colors.ticksColor,
              font: {
                family: "'JetBrains Mono', monospace",
                size: 11
              },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6
            }
          },
          y: {
            min: 0,
            max: 100,
            grid: {
              color: colors.gridColor,
              drawBorder: false
            },
            ticks: {
              color: colors.ticksColor,
              stepSize: 20,
              font: {
                family: "'JetBrains Mono', monospace",
                size: 11
              },
              callback: (val) => `${val}%`
            }
          }
        }
      }
    });
  }

  /**
   * Called when theme changes (light/dark) to update chart styling
   */
  updateTheme() {
    if (!this.chart) return;
    const ctx = this.canvas.getContext('2d');
    const colors = this.getThemeColors();

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, colors.fillStart);
    gradient.addColorStop(1, colors.fillEnd);

    const ds = this.chart.data.datasets[0];
    ds.backgroundColor = gradient;
    ds.pointBorderColor = colors.pointBorder;

    this.chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
    this.chart.options.scales.x.grid.color = colors.gridColor;
    this.chart.options.x = this.chart.options.scales.x;
    this.chart.options.scales.x.ticks.color = colors.ticksColor;
    this.chart.options.scales.y.grid.color = colors.gridColor;
    this.chart.options.scales.y.ticks.color = colors.ticksColor;

    this.chart.update();
  }

  /**
   * Append a new live telemetry point
   */
  addDataPoint(levelPct, motorRunning) {
    if (!this.chart) return;

    const now = new Date();
    const timeLabel = now.toTimeString().split(' ')[0]; // HH:MM:SS

    let isEvent = false;
    let eventLabel = '';
    let eventColor = '#52ab98';

    // Detect Motor State Change Events
    if (this.previousMotorState !== null && this.previousMotorState !== motorRunning) {
      isEvent = true;
      if (motorRunning) {
        eventLabel = 'Motor Started';
        eventColor = '#52ab98'; // Fresh Seafoam
      } else {
        eventLabel = 'Motor Stopped';
        eventColor = '#e11d48'; // Alert Red
      }
    }
    this.previousMotorState = motorRunning;

    const dataObj = {
      x: timeLabel,
      y: +levelPct.toFixed(1),
      isEvent,
      eventLabel,
      eventColor
    };

    const dataset = this.chart.data.datasets[0];
    this.chart.data.labels.push(timeLabel);
    dataset.data.push(dataObj);

    // Maintain max points window
    if (this.chart.data.labels.length > this.maxPoints) {
      this.chart.data.labels.shift();
      dataset.data.shift();
    }

    this.chart.update('none'); // Update without full redraw glitch
  }

  setMaxPoints(num) {
    this.maxPoints = num;
    const dataset = this.chart.data.datasets[0];
    while (this.chart.data.labels.length > this.maxPoints) {
      this.chart.data.labels.shift();
      dataset.data.shift();
    }
    this.chart.update();
  }

  clear() {
    if (!this.chart) return;
    this.chart.data.labels = [];
    this.chart.data.datasets[0].data = [];
    this.previousMotorState = null;
    this.chart.update();
  }
}

// Export singleton instance
window.chartManager = new ChartManager();
