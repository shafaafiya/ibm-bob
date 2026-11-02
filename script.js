/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  MindMetrics Dashboard — Main Script                        ║
 * ║  Loads data.json, handles filtering, renders all Chart.js   ║
 * ║  visualizations, and updates KPIs dynamically.              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *  1. DATA LOADING     — fetch data.json
 *  2. STATE            — active filter values
 *  3. KPI RENDERING    — update 4 KPI cards with animated counters
 *  4. CHART RENDERING  — initialize or update 10 Chart.js charts
 *  5. FILTER LOGIC     — read filter selects → update state → re-render
 *  6. UTILITIES        — color palettes, helpers
 *  7. BOOTSTRAP        — entry point called after data loads
 */

'use strict';

/* ══════════════════════════════════════════
   1. GLOBAL STATE
══════════════════════════════════════════ */

/** Holds the raw JSON data loaded from data.json */
let DATA = null;

/** Active filter state — updated whenever a filter changes */
const FILTERS = {
  program : 'All',
  semester: 'All',
  emotion : 'All',
  period  : 'All',
};

/** Registry of all Chart.js instances so we can destroy & recreate */
const CHARTS = {};

/* ══════════════════════════════════════════
   2. COLOR PALETTES  (theme-aligned)
══════════════════════════════════════════ */

const PALETTE = {
  sage     : '#5fa076',
  sageLight: '#bdd9c8',
  lavender : '#8b5cf6',
  lavLight : '#ddd6fe',
  sky      : '#38bdf8',
  skyLight : '#bae6fd',
  peach    : '#fb923c',
  peachLt  : '#fed7aa',
  rose     : '#f43f5e',
  roseLt   : '#fecdd3',
  slate    : '#64748b',
  slateLt  : '#cbd5e1',
};

/** Multi-series color set for line/bar charts */
const SERIES_COLORS = [
  '#8b5cf6', // lavender
  '#38bdf8', // sky
  '#5fa076', // sage
  '#fb923c', // peach
  '#f43f5e', // rose
  '#14b8a6', // teal
];

/** Emotional category colors */
const EMOTION_COLORS = {
  'Stable'           : '#5fa076',
  'Mild Distress'    : '#fb923c',
  'Moderate Distress': '#f59e0b',
  'Severe Distress'  : '#f43f5e',
};

/** Scatter plot colors per program */
const SCATTER_COLORS = {
  'Psychology'             : 'rgba(139, 92, 246, 0.70)',
  'Computer Science'       : 'rgba(56, 189, 248, 0.70)',
  'Business Administration': 'rgba(95, 160, 118, 0.70)',
  'Medicine'               : 'rgba(244, 63, 94, 0.70)',
  'Engineering'            : 'rgba(251, 146, 60, 0.70)',
  'Education'              : 'rgba(20, 184, 166, 0.70)',
};

/* ══════════════════════════════════════════
   3. SHARED CHART.JS DEFAULTS
══════════════════════════════════════════ */

/**
 * Returns a base Chart.js options object with consistent fonts,
 * grid styling, and tooltip appearance.
 */
function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: extra.legend ?? false,
        position: extra.legendPos ?? 'top',
        labels: {
          font: { family: "'Inter', sans-serif", size: 11 },
          color: '#475569',
          boxWidth: 10,
          boxHeight: 10,
          padding: 12,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        titleFont : { family: "'Inter', sans-serif", size: 12, weight: '600' },
        bodyFont  : { family: "'Inter', sans-serif", size: 11 },
        padding   : 10,
        cornerRadius: 8,
        titleColor  : '#f1f5f9',
        bodyColor   : '#cbd5e1',
        borderColor : 'rgba(255,255,255,0.08)',
        borderWidth : 1,
      },
    },
    scales: {
      x: {
        grid : { color: 'rgba(226,232,240,0.6)', drawBorder: false },
        ticks: { font: { family: "'Inter', sans-serif", size: 10 }, color: '#94a3b8' },
        border: { display: false },
      },
      y: {
        grid : { color: 'rgba(226,232,240,0.6)', drawBorder: false },
        ticks: { font: { family: "'Inter', sans-serif", size: 10 }, color: '#94a3b8' },
        border: { display: false },
      },
    },
    ...extra,
  };
}

/* ══════════════════════════════════════════
   4. UTILITY HELPERS
══════════════════════════════════════════ */

/**
 * Destroys an existing Chart.js instance (if any) before creating a new one.
 * This prevents "Canvas is already in use" errors on filter updates.
 */
function destroyChart(id) {
  if (CHARTS[id]) {
    CHARTS[id].destroy();
    delete CHARTS[id];
  }
}

/**
 * Animated counter — smoothly updates a KPI value element over ~600ms.
 * @param {HTMLElement} el   - the DOM element displaying the number
 * @param {number}      end  - target numeric value
 * @param {number}      dec  - decimal places to display
 */
function animateCounter(el, end, dec = 0) {
  const start   = parseFloat(el.textContent.replace(/,/g, '')) || 0;
  const duration = 600; // ms
  const startTime = performance.now();

  function step(now) {
    const elapsed  = Math.min(now - startTime, duration);
    const progress = elapsed / duration;
    // Ease-out cubic
    const eased    = 1 - Math.pow(1 - progress, 3);
    const current  = start + (end - start) * eased;
    el.textContent = current.toFixed(dec);
    if (elapsed < duration) requestAnimationFrame(step);
    else el.textContent = end.toFixed(dec);
  }
  requestAnimationFrame(step);
}

/**
 * Calculates a weighted average of a numeric array.
 */
function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/* ══════════════════════════════════════════
   5. KPI RENDERING
══════════════════════════════════════════ */

/**
 * Updates the four KPI cards based on current filter state.
 * If a specific period is selected, uses per-period KPI data.
 * Otherwise, aggregates across periods.
 */
function renderKPIs() {
  const { program, period } = FILTERS;

  let total      = 0;
  let wellbeing  = 0;
  let stress     = 0;
  let stability  = 0;

  if (period !== 'All') {
    // Use exact per-period KPI data
    const kpi = DATA.kpi_by_period[period];
    total     = kpi.total_respondents;
    wellbeing = kpi.avg_wellbeing;
    stress    = kpi.avg_stress;
    stability = kpi.emotional_stability;
  } else {
    // Aggregate all periods
    const periods = DATA.meta.survey_periods;
    let tw = 0, sw = 0, ew = 0;
    periods.forEach(p => {
      const kpi = DATA.kpi_by_period[p];
      total     += kpi.total_respondents;
      tw        += kpi.avg_wellbeing     * kpi.total_respondents;
      sw        += kpi.avg_stress        * kpi.total_respondents;
      ew        += kpi.emotional_stability * kpi.total_respondents;
    });
    wellbeing = tw / total;
    stress    = sw / total;
    stability = ew / total;
  }

  // Adjust slightly if a specific program is selected (program-level scores exist)
  if (program !== 'All') {
    const pIdx = DATA.psych_condition_per_program.labels.indexOf(program);
    if (pIdx >= 0) {
      wellbeing = DATA.psych_condition_per_program.wellbeing_score[pIdx];
      stress    = DATA.psych_condition_per_program.stress_score[pIdx];
      stability = DATA.psych_condition_per_program.resilience_score[pIdx] * 0.9; // proxy
    }
  }

  // Animate the counters
  animateCounter(document.getElementById('kpi-total'),     total,     0);
  animateCounter(document.getElementById('kpi-wellbeing'), wellbeing, 1);
  animateCounter(document.getElementById('kpi-stress'),    stress,    2);
  animateCounter(document.getElementById('kpi-stability'), stability, 1);

  // Update sub-labels
  document.getElementById('kpi-total-sub').textContent     = program === 'All' ? 'Across all programs' : program;
  document.getElementById('kpi-wellbeing-sub').textContent = period !== 'All' ? `Period: ${period}` : 'All survey periods';
  document.getElementById('kpi-stress-sub').textContent    = 'Scale 1–10';
  document.getElementById('kpi-stability-sub').textContent = 'Out of 100 points';
}

/* ══════════════════════════════════════════
   6. CHART RENDERING FUNCTIONS
══════════════════════════════════════════ */

/**
 * CHART 1 — Psychological Wellbeing Trend (Line Chart)
 * Shows average wellbeing score across survey periods.
 * Adapts to selected program filter.
 */
function renderWellbeingTrend() {
  destroyChart('wellbeing-trend');
  const ctx = document.getElementById('chart-wellbeing-trend').getContext('2d');

  const labels = DATA.wellbeing_trend.labels;
  const { program } = FILTERS;

  // If a specific program is selected, show that program vs All
  const datasets = [];
  if (program === 'All') {
    // Show all programs as thin lines + bold "All" line
    Object.entries(DATA.wellbeing_trend.datasets).forEach(([name, values], i) => {
      if (name === 'All') {
        datasets.unshift({
          label      : 'All Programs (Avg)',
          data       : values,
          borderColor: PALETTE.sage,
          backgroundColor: PALETTE.sageLight + '30',
          borderWidth: 3,
          pointRadius: 5,
          pointBackgroundColor: PALETTE.sage,
          tension    : 0.4,
          fill       : true,
          order      : 0,
        });
      } else {
        datasets.push({
          label      : name,
          data       : values,
          borderColor: SERIES_COLORS[i % SERIES_COLORS.length] + 'aa',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 3,
          tension    : 0.4,
          borderDash : [4, 4],
          fill       : false,
          order      : 1,
        });
      }
    });
  } else {
    // Show selected program vs All
    datasets.push({
      label      : program,
      data       : DATA.wellbeing_trend.datasets[program],
      borderColor: PALETTE.lavender,
      backgroundColor: PALETTE.lavLight + '30',
      borderWidth: 3,
      pointRadius: 5,
      pointBackgroundColor: PALETTE.lavender,
      tension    : 0.4,
      fill       : true,
    });
    datasets.push({
      label      : 'All Programs (Avg)',
      data       : DATA.wellbeing_trend.datasets['All'],
      borderColor: PALETTE.slateLt,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 3,
      borderDash : [5, 5],
      tension    : 0.4,
      fill       : false,
    });
  }

  const opts = baseOptions({ legend: true, legendPos: 'top' });
  opts.scales.y.min = 50;
  opts.scales.y.max = 80;
  opts.scales.y.title = {
    display: true,
    text: 'Wellbeing Score',
    font: { size: 10, family: "'Inter', sans-serif" },
    color: '#94a3b8',
  };

  CHARTS['wellbeing-trend'] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: opts,
  });
}

/**
 * CHART 2 — Emotional Level Distribution (Doughnut Chart)
 * Shows proportion of emotional categories.
 * Adapts to selected program filter.
 */
function renderEmotionalDist() {
  destroyChart('emotional-dist');
  const ctx = document.getElementById('chart-emotional-dist').getContext('2d');

  const { program } = FILTERS;
  const distData = DATA.emotional_distribution[program] || DATA.emotional_distribution['All'];

  // If emotion filter is active, highlight that slice
  const labels = Object.keys(distData);
  const values = Object.values(distData);
  const colors = labels.map(l => EMOTION_COLORS[l] || PALETTE.slate);

  CHARTS['emotional-dist'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data            : values,
        backgroundColor : colors.map(c => c + 'dd'),
        borderColor     : colors,
        borderWidth     : 2,
        hoverOffset     : 8,
      }],
    },
    options: {
      responsive        : true,
      maintainAspectRatio: false,
      cutout            : '62%',
      plugins: {
        legend: { display: false }, // we use custom legend below
        tooltip: baseOptions().plugins.tooltip,
      },
    },
  });

  // Render custom legend
  const legendEl = document.getElementById('legend-emotional-dist');
  legendEl.innerHTML = '';
  labels.forEach((label, i) => {
    const pct = ((values[i] / values.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
    legendEl.innerHTML += `
      <span class="legend-item">
        <span class="legend-dot" style="background:${colors[i]}"></span>
        ${label} <strong>(${pct}%)</strong>
      </span>`;
  });
}

/**
 * CHART 3 — Stress Level per Semester (Bar Chart)
 * Shows average stress (1–10) by semester.
 * Adapts to selected program filter.
 */
function renderStressSemester() {
  destroyChart('stress-semester');
  const ctx = document.getElementById('chart-stress-semester').getContext('2d');

  const { program } = FILTERS;
  const key    = program === 'All' ? 'All' : program;
  const values = DATA.stress_per_semester[key] || DATA.stress_per_semester['All'];
  const labels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5','Sem 6','Sem 7','Sem 8'];

  // Color bars by severity: green → yellow → orange → red
  const barColors = values.map(v => {
    if (v < 5)  return PALETTE.sage + 'cc';
    if (v < 6)  return '#facc15cc';
    if (v < 7)  return PALETTE.peach + 'cc';
    return PALETTE.rose + 'cc';
  });

  const opts = baseOptions();
  opts.scales.y.min = 0;
  opts.scales.y.max = 10;
  opts.scales.y.title = { display: true, text: 'Stress Level (1–10)', font: { size: 10 }, color: '#94a3b8' };
  opts.plugins.tooltip.callbacks = {
    label: ctx => ` Stress Level: ${ctx.raw.toFixed(1)} / 10`,
  };

  CHARTS['stress-semester'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label          : 'Avg Stress Level',
        data           : values,
        backgroundColor: barColors,
        borderColor    : barColors.map(c => c.replace('cc', 'ff')),
        borderWidth    : 0,
        borderRadius   : 8,
        borderSkipped  : false,
      }],
    },
    options: opts,
  });
}

/**
 * CHART 4 — Psychological Condition per Study Program (Radar Chart)
 * Shows wellbeing, stress-inverse, and resilience as a radar.
 * Note: this chart always shows all programs (no program filter — it IS the program chart).
 */
function renderPsychProgram() {
  destroyChart('psych-program');
  const ctx = document.getElementById('chart-psych-program').getContext('2d');

  const d = DATA.psych_condition_per_program;

  CHARTS['psych-program'] = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: d.labels,
      datasets: [
        {
          label          : 'Wellbeing Score',
          data           : d.wellbeing_score,
          backgroundColor: PALETTE.sage + '30',
          borderColor    : PALETTE.sage,
          borderWidth    : 2,
          pointBackgroundColor: PALETTE.sage,
          pointRadius    : 4,
        },
        {
          label          : 'Stress Score (inverted)',
          // Invert stress for radar: higher = worse, so we display (10 - stress) * 10
          data           : d.stress_score.map(s => (10 - s) * 10),
          backgroundColor: PALETTE.peach + '20',
          borderColor    : PALETTE.peach,
          borderWidth    : 2,
          pointBackgroundColor: PALETTE.peach,
          pointRadius    : 4,
        },
        {
          label          : 'Resilience Score',
          data           : d.resilience_score,
          backgroundColor: PALETTE.lavender + '20',
          borderColor    : PALETTE.lavender,
          borderWidth    : 2,
          pointBackgroundColor: PALETTE.lavender,
          pointRadius    : 4,
        },
      ],
    },
    options: {
      responsive         : true,
      maintainAspectRatio: false,
      plugins: {
        legend : {
          display: true,
          position: 'top',
          labels : {
            font     : { family: "'Inter', sans-serif", size: 10 },
            color    : '#475569',
            boxWidth : 8,
            boxHeight: 8,
            padding  : 10,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: baseOptions().plugins.tooltip,
      },
      scales: {
        r: {
          min        : 40,
          max        : 80,
          ticks      : {
            stepSize : 10,
            font     : { size: 9, family: "'Inter', sans-serif" },
            color    : '#94a3b8',
            backdropColor: 'transparent',
          },
          grid       : { color: 'rgba(226,232,240,0.7)' },
          angleLines : { color: 'rgba(226,232,240,0.8)' },
          pointLabels: { font: { size: 10, family: "'Inter', sans-serif" }, color: '#475569' },
        },
      },
    },
  });
}

/**
 * CHART 5 — Emotional State Distribution (Horizontal Bar Chart)
 * Shows top reported emotions.
 * Adapts to selected period filter.
 */
function renderEmotionalState() {
  destroyChart('emotional-state');
  const ctx = document.getElementById('chart-emotional-state').getContext('2d');

  const { period } = FILTERS;
  const key        = period !== 'All' ? period : 'All';
  const src        = DATA.emotional_state_distribution[key] || DATA.emotional_state_distribution['All'];

  // Sort descending by value
  const paired = src.labels.map((l, i) => ({ label: l, value: src.data[i] }))
    .sort((a, b) => b.value - a.value);

  const labels = paired.map(p => p.label);
  const values = paired.map(p => p.value);

  // Gradient-like color: lavender shades from dark to light
  const colors = values.map((_, i) => {
    const alpha = 0.9 - i * 0.07;
    return `rgba(139,92,246,${Math.max(alpha, 0.3)})`;
  });

  const opts = baseOptions();
  delete opts.scales.x;
  delete opts.scales.y;
  opts.indexAxis = 'y';
  opts.scales = {
    x: {
      grid : { color: 'rgba(226,232,240,0.6)' },
      ticks: { font: { size: 10 }, color: '#94a3b8' },
      border: { display: false },
    },
    y: {
      grid : { display: false },
      ticks: { font: { size: 10 }, color: '#475569' },
      border: { display: false },
    },
  };
  opts.plugins.tooltip.callbacks = {
    label: ctx => ` ${ctx.raw} students`,
  };

  CHARTS['emotional-state'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label          : 'Students',
        data           : values,
        backgroundColor: colors,
        borderWidth    : 0,
        borderRadius   : 6,
        borderSkipped  : false,
      }],
    },
    options: opts,
  });
}

/**
 * CHART 6 — Academic Stress Factors (Horizontal Bar Chart)
 * Shows main stress sources.
 * Adapts to selected program filter.
 */
function renderStressFactors() {
  destroyChart('stress-factors');
  const ctx = document.getElementById('chart-stress-factors').getContext('2d');

  const { program } = FILTERS;
  const labels      = DATA.stress_factors['All'].labels;
  const values      = (DATA.stress_factors[program]?.data) || DATA.stress_factors['All'].data;

  // Sort descending
  const paired = labels.map((l, i) => ({ label: l, value: values[i] }))
    .sort((a, b) => b.value - a.value);

  const sl = paired.map(p => p.label);
  const sv = paired.map(p => p.value);

  const colors = sv.map((_, i) => {
    const alpha = 0.9 - i * 0.07;
    return `rgba(251,146,60,${Math.max(alpha, 0.3)})`;
  });

  const opts = baseOptions();
  opts.indexAxis = 'y';
  opts.scales = {
    x: {
      grid : { color: 'rgba(226,232,240,0.6)' },
      ticks: { font: { size: 10 }, color: '#94a3b8' },
      border: { display: false },
    },
    y: {
      grid : { display: false },
      ticks: { font: { size: 10 }, color: '#475569' },
      border: { display: false },
    },
  };
  opts.plugins.tooltip.callbacks = {
    label: ctx => ` ${ctx.raw} students`,
  };

  CHARTS['stress-factors'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sl,
      datasets: [{
        label          : 'Students',
        data           : sv,
        backgroundColor: colors,
        borderWidth    : 0,
        borderRadius   : 6,
        borderSkipped  : false,
      }],
    },
    options: opts,
  });
}

/**
 * CHART 7 — Coping Strategy Distribution (Polar Area Chart)
 * Shows how students manage stress.
 * Adapts to selected program filter.
 */
function renderCoping() {
  destroyChart('coping');
  const ctx = document.getElementById('chart-coping').getContext('2d');

  const { program } = FILTERS;
  const labels      = DATA.coping_strategies['All'].labels;
  const values      = (DATA.coping_strategies[program]?.data) || DATA.coping_strategies['All'].data;

  const polarColors = [
    '#5fa076cc','#8b5cf6cc','#38bdf8cc','#fb923ccc','#f43f5ecc',
    '#14b8a6cc','#facc15cc','#a78bfacc','#6ee7b7cc','#fca5a5cc',
  ];

  CHARTS['coping'] = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data           : values,
        backgroundColor: polarColors,
        borderColor    : polarColors.map(c => c.replace('cc','ff')),
        borderWidth    : 1.5,
      }],
    },
    options: {
      responsive         : true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display : true,
          position: 'right',
          labels  : {
            font      : { family: "'Inter', sans-serif", size: 9 },
            color     : '#475569',
            boxWidth  : 8,
            boxHeight : 8,
            padding   : 6,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: baseOptions().plugins.tooltip,
      },
      scales: {
        r: {
          ticks     : { display: false },
          grid      : { color: 'rgba(226,232,240,0.5)' },
          angleLines: { display: false },
        },
      },
    },
  });
}

/**
 * CHART 8 — Academic Workload vs Stress Level (Scatter Plot)
 * Shows correlation between perceived workload and stress.
 * Adapts to selected program filter (shows only selected program or all).
 */
function renderScatter() {
  destroyChart('scatter');
  const ctx = document.getElementById('chart-scatter').getContext('2d');

  const { program } = FILTERS;
  const datasets    = [];

  const programs = program === 'All'
    ? Object.keys(DATA.scatter_workload_stress)
    : [program];

  programs.forEach(prog => {
    const points = DATA.scatter_workload_stress[prog].map(([x, y]) => ({ x, y }));
    datasets.push({
      label          : prog,
      data           : points,
      backgroundColor: SCATTER_COLORS[prog] || 'rgba(100,116,139,0.6)',
      borderColor    : (SCATTER_COLORS[prog] || 'rgba(100,116,139,0.6)').replace('0.70', '1'),
      borderWidth    : 1.5,
      pointRadius    : 6,
      pointHoverRadius: 8,
    });
  });

  const opts = baseOptions({ legend: program === 'All' });
  opts.scales.x.title = { display: true, text: 'Perceived Workload (1–10)', font: { size: 10 }, color: '#94a3b8' };
  opts.scales.y.title = { display: true, text: 'Stress Level (1–10)',      font: { size: 10 }, color: '#94a3b8' };
  opts.scales.x.min = 1; opts.scales.x.max = 11;
  opts.scales.y.min = 2; opts.scales.y.max = 10;
  opts.plugins.tooltip.callbacks = {
    label: ctx => ` Workload: ${ctx.raw.x}, Stress: ${ctx.raw.y} (${ctx.dataset.label})`,
  };

  CHARTS['scatter'] = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: opts,
  });
}

/**
 * CHART 9 — Top 10 Most Common Emotional Challenges (Horizontal Bar Chart)
 * Adapts to selected period filter.
 */
function renderChallenges() {
  destroyChart('challenges');
  const ctx = document.getElementById('chart-challenges').getContext('2d');

  const { period } = FILTERS;
  const key        = period !== 'All' ? period : 'All';
  const labels     = DATA.emotional_challenges['All'].labels;
  const values     = (DATA.emotional_challenges[key]?.data) || DATA.emotional_challenges['All'].data;

  // Sort descending and take top 10
  const paired = labels.map((l, i) => ({ label: l, value: values[i] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const sl = paired.map(p => p.label);
  const sv = paired.map(p => p.value);

  const colors = sv.map((_, i) => {
    const alpha = 0.90 - i * 0.07;
    return `rgba(244,63,94,${Math.max(alpha, 0.3)})`;
  });

  const opts = baseOptions();
  opts.indexAxis = 'y';
  opts.scales = {
    x: {
      grid : { color: 'rgba(226,232,240,0.6)' },
      ticks: { font: { size: 10 }, color: '#94a3b8' },
      border: { display: false },
    },
    y: {
      grid : { display: false },
      ticks: { font: { size: 10 }, color: '#475569' },
      border: { display: false },
    },
  };
  opts.plugins.tooltip.callbacks = {
    label: ctx => ` ${ctx.raw} students`,
  };

  CHARTS['challenges'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sl,
      datasets: [{
        label          : 'Students',
        data           : sv,
        backgroundColor: colors,
        borderWidth    : 0,
        borderRadius   : 6,
        borderSkipped  : false,
      }],
    },
    options: opts,
  });
}

/**
 * CHART 10 — Psychological Wellbeing per Semester (Area Line Chart)
 * Shows wellbeing score across semesters 1–8.
 * Adapts to selected program filter.
 */
function renderWellbeingSemester() {
  destroyChart('wellbeing-semester');
  const ctx = document.getElementById('chart-wellbeing-semester').getContext('2d');

  const { program } = FILTERS;
  const labels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5','Sem 6','Sem 7','Sem 8'];

  const datasets = [];

  if (program === 'All') {
    // Show all programs as area lines
    Object.entries(DATA.wellbeing_per_semester).forEach(([name, values], i) => {
      if (name === 'All') {
        datasets.unshift({
          label           : 'All Programs (Avg)',
          data            : values,
          borderColor     : PALETTE.sage,
          backgroundColor : PALETTE.sageLight + '40',
          borderWidth     : 3,
          pointRadius     : 4,
          tension         : 0.4,
          fill            : true,
          order           : 0,
        });
      } else {
        datasets.push({
          label           : name,
          data            : values,
          borderColor     : SERIES_COLORS[i % SERIES_COLORS.length] + '99',
          backgroundColor : 'transparent',
          borderWidth     : 1.5,
          pointRadius     : 2,
          tension         : 0.4,
          borderDash      : [4, 3],
          fill            : false,
          order           : 1,
        });
      }
    });
  } else {
    // Show selected program + All as reference
    datasets.push({
      label           : program,
      data            : DATA.wellbeing_per_semester[program],
      borderColor     : PALETTE.lavender,
      backgroundColor : PALETTE.lavLight + '30',
      borderWidth     : 3,
      pointRadius     : 5,
      pointBackgroundColor: PALETTE.lavender,
      tension         : 0.4,
      fill            : true,
    });
    datasets.push({
      label           : 'All Programs (Avg)',
      data            : DATA.wellbeing_per_semester['All'],
      borderColor     : PALETTE.slateLt,
      backgroundColor : 'transparent',
      borderWidth     : 1.5,
      pointRadius     : 3,
      borderDash      : [5, 5],
      tension         : 0.4,
      fill            : false,
    });
  }

  const opts = baseOptions({ legend: true, legendPos: 'top' });
  opts.scales.y.min = 50;
  opts.scales.y.max = 75;
  opts.scales.y.title = { display: true, text: 'Wellbeing Score', font: { size: 10 }, color: '#94a3b8' };

  CHARTS['wellbeing-semester'] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: opts,
  });
}

/* ══════════════════════════════════════════
   7. FILTER MANAGEMENT
══════════════════════════════════════════ */

/**
 * Reads all filter select elements and updates the FILTERS state object.
 */
function readFilters() {
  FILTERS.program  = document.getElementById('filter-program').value;
  FILTERS.semester = document.getElementById('filter-semester').value;
  FILTERS.emotion  = document.getElementById('filter-emotion').value;
  FILTERS.period   = document.getElementById('filter-period').value;
}

/**
 * Renders active filter tags below the filter panel.
 * Shows a dismissable tag for each non-"All" filter.
 */
function renderFilterTags() {
  const container = document.getElementById('active-filter-tags');
  container.innerHTML = '';

  const activeFilters = [
    { key: 'program',  label: 'Program',  value: FILTERS.program,  selectId: 'filter-program'  },
    { key: 'semester', label: 'Semester', value: FILTERS.semester, selectId: 'filter-semester' },
    { key: 'emotion',  label: 'Emotion',  value: FILTERS.emotion,  selectId: 'filter-emotion'  },
    { key: 'period',   label: 'Period',   value: FILTERS.period,   selectId: 'filter-period'   },
  ].filter(f => f.value !== 'All');

  if (activeFilters.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  activeFilters.forEach(f => {
    const tag = document.createElement('span');
    tag.className = 'filter-tag';
    tag.innerHTML = `
      <strong>${f.label}:</strong> ${f.value}
      <button title="Remove filter" aria-label="Remove ${f.label} filter">✕</button>
    `;
    // Click on ✕ resets that individual filter
    tag.querySelector('button').addEventListener('click', () => {
      document.getElementById(f.selectId).value = 'All';
      FILTERS[f.key] = 'All';
      updateDashboard();
    });
    container.appendChild(tag);
  });
}

/**
 * Master update function — called whenever any filter changes.
 * Re-renders KPIs, all charts, and filter tags.
 */
function updateDashboard() {
  readFilters();
  renderFilterTags();
  renderKPIs();
  renderWellbeingTrend();
  renderEmotionalDist();
  renderStressSemester();
  renderPsychProgram();
  renderEmotionalState();
  renderStressFactors();
  renderCoping();
  renderScatter();
  renderChallenges();
  renderWellbeingSemester();
}

/**
 * Binds event listeners to all filter select elements and the reset button.
 */
function bindFilterEvents() {
  const selects = ['filter-program','filter-semester','filter-emotion','filter-period'];
  selects.forEach(id => {
    document.getElementById(id).addEventListener('change', updateDashboard);
  });

  // Reset all filters
  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    selects.forEach(id => {
      document.getElementById(id).value = 'All';
    });
    updateDashboard();
  });
}

/* ══════════════════════════════════════════
   8. BOOTSTRAP — Entry Point
══════════════════════════════════════════ */

/**
 * Hides the loading overlay with a fade-out transition.
 */
function hideLoader() {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('hidden');
  // Remove from DOM after transition to avoid any blocking
  setTimeout(() => overlay.remove(), 500);
}

/**
 * Main initialization function.
 * Loads data.json, sets up event listeners, and renders the initial dashboard.
 */
async function init() {
  try {
    // Fetch JSON data
    const response = await fetch('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Could not load data.json`);
    DATA = await response.json();

    // Small delay for perceived smoothness
    await new Promise(r => setTimeout(r, 400));

    // Bind filter events
    bindFilterEvents();

    // Bind comparison mode events
    bindComparisonEvents();

    // Render everything with default (All) filters
    updateDashboard();

    // Hide loading overlay
    hideLoader();

  } catch (err) {
    console.error('[MindMetrics] Failed to initialize dashboard:', err);
    // Show error in loading overlay instead of blank screen
    const overlay = document.getElementById('loading-overlay');
    overlay.innerHTML = `
      <div class="text-center px-6">
        <div class="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <p class="text-sm font-semibold text-slate-700">Failed to load dashboard data</p>
        <p class="text-xs text-slate-400 mt-1">Please make sure data.json is in the same directory and you are running via a local server.</p>
        <p class="text-xs text-rose-400 mt-2 font-mono">${err.message}</p>
      </div>`;
  }
}

// Start the application once the DOM is ready
document.addEventListener('DOMContentLoaded', init);


/* ══════════════════════════════════════════════════════════════
   9. COMPARISON MODE ENGINE
   ──────────────────────────────────────────────────────────────
   Allows side-by-side comparison of two Regions (Daerah) or
   two Survey Periods (Tahun) across 5 chart dimensions:
     · Wellbeing per Semester (Grouped Bar)
     · Stress per Semester    (Grouped Bar)
     · Emotional Distribution (Grouped Bar)
     · Stress Factors         (Horizontal Grouped Bar)
     · Coping Strategies      (Grouped Bar)
   Plus a delta KPI summary panel with animated progress bars.
══════════════════════════════════════════════════════════════ */

/** Comparison state */
const CMP = {
  active : false,   // is compare mode on?
  type   : 'region', // 'region' | 'period'
  selA   : '',
  selB   : '',
};

/** Color tokens for side A (lavender) and B (sky) */
const CMP_COLOR = {
  A_solid : '#8b5cf6',
  A_fill  : 'rgba(139,92,246,0.75)',
  A_light : 'rgba(139,92,246,0.20)',
  B_solid : '#38bdf8',
  B_fill  : 'rgba(56,189,248,0.75)',
  B_light : 'rgba(56,189,248,0.20)',
};

/* ── Helpers ── */

/**
 * Returns the comparison data record for a given type + key.
 * @param {'region'|'period'} type
 * @param {string} key  e.g. 'Jakarta' or '2023-S1'
 */
function getCmpData(type, key) {
  const bucket = type === 'region' ? 'by_region' : 'by_period';
  return DATA.comparison[bucket][key] || null;
}

/**
 * Returns the option list for the current comparison type.
 */
function getCmpOptions() {
  return CMP.type === 'region'
    ? DATA.regions
    : DATA.meta.survey_periods;
}

/* ── Populate dropdowns ── */

/**
 * Rebuilds both <select> dropdowns based on current CMP.type.
 * Preserves current selections where possible.
 */
function populateCmpSelects() {
  const opts    = getCmpOptions();
  const selectA = document.getElementById('cmp-select-a');
  const selectB = document.getElementById('cmp-select-b');

  const prevA = selectA.value;
  const prevB = selectB.value;

  // Build option HTML
  const optHtml = ['<option value="">— Choose —</option>',
    ...opts.map(o => `<option value="${o}">${o}</option>`)
  ].join('');

  selectA.innerHTML = optHtml;
  selectB.innerHTML = optHtml;

  // Restore previous values if still valid
  if (opts.includes(prevA)) selectA.value = prevA;
  if (opts.includes(prevB)) selectB.value = prevB;

  CMP.selA = selectA.value;
  CMP.selB = selectB.value;

  // Show mini-KPIs if a selection exists
  updateMiniKPI('a', CMP.selA);
  updateMiniKPI('b', CMP.selB);
  updateRunButton();
}

/* ── Mini KPI chips inside selector cards ── */

/**
 * Shows 4 mini KPI chips (Respondents, Wellbeing, Stress, Stability)
 * inside the selector card when a selection is made.
 * @param {'a'|'b'} side
 * @param {string}  key
 */
function updateMiniKPI(side, key) {
  const container = document.getElementById(`cmp-kpi-${side}`);
  if (!key) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const rec = getCmpData(CMP.type, key);
  if (!rec) { container.classList.add('hidden'); return; }

  const chips = [
    { label: 'Respondents', value: rec.total_respondents,   fmt: v => v.toFixed(0) },
    { label: 'Wellbeing',   value: rec.avg_wellbeing,       fmt: v => v.toFixed(1) },
    { label: 'Stress',      value: rec.avg_stress,          fmt: v => v.toFixed(1) },
    { label: 'Stability',   value: rec.emotional_stability, fmt: v => v.toFixed(1) },
  ];

  container.innerHTML = chips.map(c => `
    <div class="cmp-kpi-chip">
      <div class="chip-label">${c.label}</div>
      <div class="chip-value">${c.fmt(c.value)}</div>
    </div>`).join('');

  container.classList.remove('hidden');
}

/* ── Run button state ── */

function updateRunButton() {
  const btn  = document.getElementById('btn-run-compare');
  const canRun = CMP.selA && CMP.selB && CMP.selA !== CMP.selB;
  btn.disabled = !canRun;
}

/* ── Delta KPI Summary Panel ── */

/**
 * Renders the 4-card delta summary comparing recA vs recB.
 * Each card shows a horizontal bar race with animated bars.
 */
function renderDeltaPanel(labelA, labelB, recA, recB) {
  // Update badges
  document.getElementById('cmp-label-a-badge').textContent = labelA;
  document.getElementById('cmp-label-b-badge').textContent = labelB;

  const metrics = [
    {
      key  : 'Wellbeing Score',
      vA   : recA.avg_wellbeing,
      vB   : recB.avg_wellbeing,
      unit : '/100',
      max  : 100,
      higherBetter: true,
    },
    {
      key  : 'Stress Level',
      vA   : recA.avg_stress,
      vB   : recB.avg_stress,
      unit : '/10',
      max  : 10,
      higherBetter: false, // lower stress = better
    },
    {
      key  : 'Emotional Stability',
      vA   : recA.emotional_stability,
      vB   : recB.emotional_stability,
      unit : '/100',
      max  : 100,
      higherBetter: true,
    },
    {
      key  : 'Total Respondents',
      vA   : recA.total_respondents,
      vB   : recB.total_respondents,
      unit : '',
      max  : Math.max(recA.total_respondents, recB.total_respondents) * 1.1,
      higherBetter: null, // neutral
    },
  ];

  const container = document.getElementById('cmp-delta-cards');
  container.innerHTML = '';

  metrics.forEach(m => {
    const pctA = Math.round((m.vA / m.max) * 100);
    const pctB = Math.round((m.vB / m.max) * 100);

    // Determine winner
    let winner = 'tie';
    if (m.higherBetter === true)  winner = m.vA > m.vB ? 'a' : m.vB > m.vA ? 'b' : 'tie';
    if (m.higherBetter === false) winner = m.vA < m.vB ? 'a' : m.vB < m.vA ? 'b' : 'tie';

    const winnerLabel = winner === 'a' ? labelA : winner === 'b' ? labelB : 'Equal';
    const badgeCls    = winner === 'a' ? 'badge-a' : winner === 'b' ? 'badge-b' : 'badge-tie';

    const card = document.createElement('div');
    card.className = 'cmp-delta-card';
    card.innerHTML = `
      <div class="delta-metric">${m.key}</div>
      ${m.higherBetter !== null ? `<span class="cmp-winner-badge ${badgeCls}">▲ ${winnerLabel}</span>` : ''}
      <div class="cmp-delta-row">
        <span class="side-label" style="color:#8b5cf6" title="${labelA}">${labelA}</span>
        <div class="side-bar-wrap">
          <div class="side-bar side-bar-a" style="width:0%" data-target="${pctA}%"></div>
        </div>
        <span class="side-value">${m.vA.toFixed(m.unit ? 1 : 0)}${m.unit}</span>
      </div>
      <div class="cmp-delta-row">
        <span class="side-label" style="color:#0ea5e9" title="${labelB}">${labelB}</span>
        <div class="side-bar-wrap">
          <div class="side-bar side-bar-b" style="width:0%" data-target="${pctB}%"></div>
        </div>
        <span class="side-value">${m.vB.toFixed(m.unit ? 1 : 0)}${m.unit}</span>
      </div>`;
    container.appendChild(card);
  });

  // Animate bars after a short delay (allow DOM paint)
  setTimeout(() => {
    container.querySelectorAll('.side-bar[data-target]').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  }, 80);

  document.getElementById('cmp-kpi-delta').classList.remove('hidden');
}

/* ── Comparison Chart Renderers ── */

/** Shared grouped bar options */
function cmpBarOptions(yTitle = '') {
  const opts = baseOptions({ legend: true, legendPos: 'top' });
  if (yTitle) {
    opts.scales.y.title = { display: true, text: yTitle, font: { size: 10 }, color: '#94a3b8' };
  }
  opts.scales.x.ticks.maxRotation = 0;
  return opts;
}

/**
 * Renders all 5 comparison charts using recA and recB data.
 * Destroys previous comparison chart instances before re-creating.
 */
function renderComparisonCharts(labelA, labelB, recA, recB) {
  const semLabels = ['Sem 1','Sem 2','Sem 3','Sem 4','Sem 5','Sem 6','Sem 7','Sem 8'];
  const cmpIds = ['cmp-wellbeing','cmp-stress','cmp-emotion-dist','cmp-stress-factors','cmp-coping'];
  cmpIds.forEach(id => destroyChart(id));

  /* ── 1. Wellbeing per Semester ── */
  {
    const opts = cmpBarOptions('Wellbeing Score');
    opts.scales.y.min = 50; opts.scales.y.max = 75;
    CHARTS['cmp-wellbeing'] = new Chart(
      document.getElementById('cmp-chart-wellbeing').getContext('2d'), {
        type: 'bar',
        data: {
          labels: semLabels,
          datasets: [
            { label: labelA, data: recA.wellbeing_per_semester,
              backgroundColor: CMP_COLOR.A_fill, borderColor: CMP_COLOR.A_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
            { label: labelB, data: recB.wellbeing_per_semester,
              backgroundColor: CMP_COLOR.B_fill, borderColor: CMP_COLOR.B_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
          ],
        },
        options: opts,
      });
  }

  /* ── 2. Stress per Semester ── */
  {
    const opts = cmpBarOptions('Stress Level (1–10)');
    opts.scales.y.min = 0; opts.scales.y.max = 10;
    CHARTS['cmp-stress'] = new Chart(
      document.getElementById('cmp-chart-stress').getContext('2d'), {
        type: 'bar',
        data: {
          labels: semLabels,
          datasets: [
            { label: labelA, data: recA.stress_per_semester,
              backgroundColor: CMP_COLOR.A_fill, borderColor: CMP_COLOR.A_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
            { label: labelB, data: recB.stress_per_semester,
              backgroundColor: CMP_COLOR.B_fill, borderColor: CMP_COLOR.B_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
          ],
        },
        options: opts,
      });
  }

  /* ── 3. Emotional Distribution ── */
  {
    const emotionLabels = ['Stable', 'Mild Distress', 'Moderate Distress', 'Severe Distress'];
    const dA = emotionLabels.map(k => recA.emotional_dist[k] || 0);
    const dB = emotionLabels.map(k => recB.emotional_dist[k] || 0);
    const opts = cmpBarOptions('Students');
    CHARTS['cmp-emotion-dist'] = new Chart(
      document.getElementById('cmp-chart-emotion-dist').getContext('2d'), {
        type: 'bar',
        data: {
          labels: emotionLabels,
          datasets: [
            { label: labelA, data: dA,
              backgroundColor: CMP_COLOR.A_fill, borderColor: CMP_COLOR.A_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
            { label: labelB, data: dB,
              backgroundColor: CMP_COLOR.B_fill, borderColor: CMP_COLOR.B_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
          ],
        },
        options: opts,
      });
  }

  /* ── 4. Stress Factors (Horizontal Grouped Bar) ── */
  {
    const sfLabels = DATA.comparison.stress_factors_labels;
    const opts = cmpBarOptions('');
    opts.indexAxis = 'y';
    opts.scales = {
      x: { grid: { color: 'rgba(226,232,240,0.6)' }, ticks: { font: { size: 10 }, color: '#94a3b8' }, border: { display: false } },
      y: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#475569' }, border: { display: false } },
    };
    opts.plugins.legend.display = true;
    CHARTS['cmp-stress-factors'] = new Chart(
      document.getElementById('cmp-chart-stress-factors').getContext('2d'), {
        type: 'bar',
        data: {
          labels: sfLabels,
          datasets: [
            { label: labelA, data: recA.stress_factors,
              backgroundColor: CMP_COLOR.A_fill, borderColor: CMP_COLOR.A_solid,
              borderWidth: 1.5, borderRadius: 5, borderSkipped: false },
            { label: labelB, data: recB.stress_factors,
              backgroundColor: CMP_COLOR.B_fill, borderColor: CMP_COLOR.B_solid,
              borderWidth: 1.5, borderRadius: 5, borderSkipped: false },
          ],
        },
        options: opts,
      });
  }

  /* ── 5. Coping Strategies ── */
  {
    const copingLabels = DATA.comparison.coping_labels;
    const opts = cmpBarOptions('Students');
    CHARTS['cmp-coping'] = new Chart(
      document.getElementById('cmp-chart-coping').getContext('2d'), {
        type: 'bar',
        data: {
          labels: copingLabels,
          datasets: [
            { label: labelA, data: recA.coping_strategies,
              backgroundColor: CMP_COLOR.A_fill, borderColor: CMP_COLOR.A_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
            { label: labelB, data: recB.coping_strategies,
              backgroundColor: CMP_COLOR.B_fill, borderColor: CMP_COLOR.B_solid,
              borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
          ],
        },
        options: opts,
      });
  }

  // Show charts section
  document.getElementById('cmp-charts').classList.remove('hidden');

  // Smooth scroll to comparison charts
  document.getElementById('cmp-charts').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Run Comparison ── */

/**
 * Called when "Run Comparison" is clicked.
 * Fetches both records, renders delta panel and all 5 charts.
 */
function runComparison() {
  const labelA = CMP.selA;
  const labelB = CMP.selB;

  if (!labelA || !labelB || labelA === labelB) return;

  const recA = getCmpData(CMP.type, labelA);
  const recB = getCmpData(CMP.type, labelB);

  if (!recA || !recB) {
    console.warn('[Compare] Missing data for', labelA, 'or', labelB);
    return;
  }

  renderDeltaPanel(labelA, labelB, recA, recB);
  renderComparisonCharts(labelA, labelB, recA, recB);
}

/* ── Toggle Compare Mode ── */

/**
 * Shows or hides the comparison section and dims the main dashboard.
 */
function toggleCompareMode() {
  CMP.active = !CMP.active;

  const btn        = document.getElementById('btn-compare-toggle');
  const label      = document.getElementById('compare-toggle-label');
  const section    = document.getElementById('comparison-section');
  const mainDash   = document.getElementById('main-dashboard');

  if (CMP.active) {
    // Enter comparison mode
    btn.setAttribute('aria-pressed', 'true');
    label.textContent = 'Exit Compare';
    section.classList.remove('hidden');
    mainDash.classList.add('compare-active');

    // Populate selects for current type
    populateCmpSelects();

    // Scroll comparison section into view
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    // Exit comparison mode
    btn.setAttribute('aria-pressed', 'false');
    label.textContent = 'Compare Mode';
    section.classList.add('hidden');
    mainDash.classList.remove('compare-active');

    // Hide result panels
    document.getElementById('cmp-kpi-delta').classList.add('hidden');
    document.getElementById('cmp-charts').classList.add('hidden');

    // Destroy comparison charts to free memory
    ['cmp-wellbeing','cmp-stress','cmp-emotion-dist','cmp-stress-factors','cmp-coping']
      .forEach(destroyChart);

    // Reset state
    CMP.selA = '';
    CMP.selB = '';
  }
}

/* ── Bind Comparison Events ── */

/**
 * Attaches all event listeners for the comparison mode UI.
 * Called once from init() after DATA is loaded.
 */
function bindComparisonEvents() {
  // Toggle button in header
  document.getElementById('btn-compare-toggle').addEventListener('click', toggleCompareMode);

  // Type switch buttons (Region / Period)
  document.querySelectorAll('.cmp-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active styling
      document.querySelectorAll('.cmp-type-btn').forEach(b => b.classList.remove('cmp-type-active'));
      btn.classList.add('cmp-type-active');

      // Update state + rebuild selects
      CMP.type = btn.dataset.type;
      populateCmpSelects();

      // Hide old results
      document.getElementById('cmp-kpi-delta').classList.add('hidden');
      document.getElementById('cmp-charts').classList.add('hidden');
      ['cmp-wellbeing','cmp-stress','cmp-emotion-dist','cmp-stress-factors','cmp-coping']
        .forEach(destroyChart);
    });
  });

  // Select A change
  document.getElementById('cmp-select-a').addEventListener('change', e => {
    CMP.selA = e.target.value;
    updateMiniKPI('a', CMP.selA);
    updateRunButton();
  });

  // Select B change
  document.getElementById('cmp-select-b').addEventListener('change', e => {
    CMP.selB = e.target.value;
    updateMiniKPI('b', CMP.selB);
    updateRunButton();
  });

  // Run comparison button
  document.getElementById('btn-run-compare').addEventListener('click', runComparison);
}

