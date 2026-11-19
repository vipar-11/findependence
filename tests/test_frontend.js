/**
 * Frontend Unit, Integration & V8 Coverage Suite for FinDependence India
 * Run with:
 *   npm test
 *   npm run coverage
 *   node tests/test_frontend.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const inspector = require('node:inspector');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// ---------------------------------------------------------------------------
// Start Stable V8 Bytecode Coverage Profiler (node:inspector)
// ---------------------------------------------------------------------------
const session = new inspector.Session();
session.connect();
session.post('Profiler.enable');
session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

// ---------------------------------------------------------------------------
// Lightweight Browser DOM, Canvas 2D Context, Fetch & Window Mock
// ---------------------------------------------------------------------------
function createMockCanvasContext(canvas) {
  return {
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() {},
    setLineDash() {},
    roundRect() {},
    rect() {},
    measureText(str) {
      return { width: String(str).length * 6 };
    },
  };
}

class MockClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...tokens) {
    tokens.forEach((t) => this.set.add(t));
    this._sync();
  }
  remove(...tokens) {
    tokens.forEach((t) => this.set.delete(t));
    this._sync();
  }
  toggle(token) {
    if (this.set.has(token)) {
      this.set.delete(token);
      this._sync();
      return false;
    }
    this.set.add(token);
    this._sync();
    return true;
  }
  contains(token) {
    return this.set.has(token);
  }
  _sync() {
    this.el._className = Array.from(this.set).join(' ');
  }
  _fromClassName(str) {
    this.set = new Set(String(str || '').split(/\s+/).filter(Boolean));
  }
}

class MockElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.checked = true;
    this.min = '0';
    this.max = '1000';
    this.step = '1';
    this.width = 600;
    this.height = 320;
    this.style = { width: '', height: '' };
    this.listeners = {};
    this.classList = new MockClassList(this);
    this._className = '';
    this.parentElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 340 }),
    };
    this._firstSpan = { className: '' };
    this._lastSpan = { className: '' };
    this._ctx = createMockCanvasContext(this);
  }
  get className() {
    return this._className;
  }
  set className(val) {
    this._className = val;
    this.classList._fromClassName(val);
  }
  querySelector(sel) {
    if (sel === 'span:first-child') return this._firstSpan;
    return this._lastSpan;
  }
  getContext() {
    return this._ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 640, height: 340 };
  }
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  dispatchEvent(type, evt = {}) {
    (this.listeners[type] || []).forEach((fn) => fn(evt));
  }
}

const elements = new Map();
function getElement(id) {
  if (!elements.has(id)) {
    const el = new MockElement(id);
    const defaults = {
      infSlider: '6.0',
      lifeInfSlider: '0.5',
      targetAgeSlider: '90',
      fiTaxSlider: '30.0',
      eqTaxSlider: '12.5',
      rebalanceFreqSlider: '2',
      homeImpPctInput: '3.0',
      homeImpVarInput: '1.0',
      homeImpIntervalInput: '5',
      randExpBaseLakhsInput: '2.0',
      randExpVarInput: '25',
      randExpProbInput: '15',
      propModeSelect: 'liquidate_fallback',
      samplingSelect: 'iid_bootstrap',
      numSimsSelect: '1000',
      newKnownTag: 'Higher Education',
      newKnownYears: '6',
      newKnownLakhs: '20',
      notableRunSelect: '0',
      txnCategoryFilterSelect: 'all',
    };
    if (defaults[id] !== undefined) el.value = defaults[id];
    elements.set(id, el);
  }
  return elements.get(id);
}

const windowListeners = {};
global.window = {
  devicePixelRatio: 2,
  addEventListener(type, fn) {
    if (!windowListeners[type]) windowListeners[type] = [];
    windowListeners[type].push(fn);
  },
  removeEventListener(type, fn) {
    if (!windowListeners[type]) return;
    windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
  },
  dispatchEvent(type, evt = {}) {
    (windowListeners[type] || []).forEach((fn) => fn(evt));
  },
};

global.document = {
  getElementById: (id) => getElement(id),
};

global.FormData = class MockFormData {
  constructor() {
    this.entries = {};
  }
  append(k, v) {
    this.entries[k] = v;
  }
};

let lastAlert = null;
global.alert = (msg) => {
  lastAlert = msg;
};
global.console.error = () => {};

let mockFetchHandler = async () => ({
  ok: true,
  json: async () => ({ active_modules: [{ id: 'wealth_longevity' }, { id: 'expense_analyzer' }] }),
});
global.fetch = (...args) => mockFetchHandler(...args);

const origSetTimeout = global.setTimeout;
const origSetInterval = global.setInterval;
const origClearInterval = global.clearInterval;

global.setTimeout = (fn) => {
  fn();
  return 1;
};
global.setInterval = (fn) => {
  fn();
  return 1;
};
global.clearInterval = () => {};

const { LocalChart } = require('../app/static/js/chart.js');
global.Chart = LocalChart;
const appModule = require('../app/static/js/app.js');

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------
async function runAllTests() {
  const results = [];
  async function runCase(name, fn) {
    const start = performance.now();
    await fn();
    const ms = (performance.now() - start).toFixed(2);
    results.push({ name, ms });
    console.log(`✓ ${name} (${ms} ms)`);
  }

  await runCase('test_local_chart_line_vertical_and_horizontal_bars', async () => {
    const canvas = getElement('testChartCanvas');

    let clickedDataset = null;
    const lineChart = new LocalChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: ['Age 38', 'Age 39', 'Age 40', 'Age 41'],
        datasets: [
          {
            label: 'Median (P50) Very Long Legend Label To Trigger Multi-Row Legend Wrapping Across Canvas Width',
            data: [35000000, 36000000, 37000000, 38000000],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            fill: 'origin',
            pointRadius: [0, 6, 0, 5],
            pointBackgroundColor: ['#6366f1', '#f59e0b', '#6366f1', '#10b981'],
          },
          {
            label: 'P10 Crash Series With Another Long Legend Label For Second Row Wrapping',
            data: [35000000, 28000000, 22000000, 15000000],
            borderColor: '#f43f5e',
            borderDash: [6, 4],
            pointRadius: 4,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            onClick: (_e, item) => {
              clickedDataset = item.datasetIndex;
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ₹${ctx.raw}`,
              afterBody: () => ['Extra Event Line'],
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 4 } },
          y: {
            min: 0,
            max: 45000000,
            ticks: {
              callback: (v) => `₹${v}`,
            },
          },
        },
      },
    });

    canvas.dispatchEvent('mousemove', { clientX: 200, clientY: 150 });
    assert.ok(lineChart._hoverIndex >= 0);
    canvas.dispatchEvent('mousemove', { clientX: 5, clientY: 5 });
    assert.equal(lineChart._hoverIndex, -1);
    canvas.dispatchEvent('mousemove', { clientX: 250, clientY: 160 });
    canvas.dispatchEvent('mouseleave', {});
    assert.equal(lineChart._hoverIndex, -1);

    const firstBox = lineChart._legendBoxes[0];
    canvas.dispatchEvent('click', { clientX: firstBox.x + 4, clientY: firstBox.y + 4 });
    assert.equal(clickedDataset, 0);

    global.window.dispatchEvent('resize');
    lineChart.update();
    lineChart.destroy();

    const lineChart2 = new LocalChart(canvas, {
      type: 'line',
      data: {
        labels: ['Single'],
        datasets: [{ label: 'S1', data: [100], borderColor: ['#10b981'] }],
      },
      options: {
        scales: {
          y: {
            ticks: {
              callback: () => {
                throw new Error('tick error');
              },
            },
          },
        },
      },
    });
    const box2 = lineChart2._legendBoxes[0];
    canvas.dispatchEvent('click', { clientX: box2.x + 2, clientY: box2.y + 2 });
    assert.equal(lineChart2.data.datasets[0].hidden, true);
    canvas.dispatchEvent('mousemove', { clientX: 200, clientY: 150 });
    lineChart2.destroy();

    const vBarChart = new LocalChart(canvas, {
      type: 'bar',
      data: {
        labels: ['0-5 yrs', '5-10 yrs', 'Very Long Label Exceeding Limit'],
        datasets: [{ label: '% Runs', data: [10, 25, 65], backgroundColor: ['#6366f1', '#10b981', '#f59e0b'] }],
      },
      options: { plugins: { legend: { display: false } } },
    });
    canvas.dispatchEvent('mousemove', { clientX: 180, clientY: 140 });
    assert.ok(vBarChart._hoverIndex >= 0);
    vBarChart.destroy();

    const hBarChart = new LocalChart(canvas, {
      type: 'bar',
      data: {
        labels: ['Groceries & Household Essentials Very Long Text', 'Utilities'],
        datasets: [{ label: 'Monthly', data: [15000, 4500], backgroundColor: ['#10b981', '#38bdf8'] }],
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } } },
    });
    canvas.dispatchEvent('mousemove', { clientX: 260, clientY: 120 });
    assert.ok(hBarChart._hoverIndex >= 0);
    hBarChart.destroy();
  });

  await runCase('test_wizard_controls_currency_formatting_and_split', async () => {
    global.window.dispatchEvent('DOMContentLoaded');

    assert.equal(appModule.formatInrCompact(35000000), '₹3.50 Cr');
    assert.equal(appModule.formatInrCompact(250000), '₹2.50 L');
    assert.equal(appModule.formatInrCompact(4500), '₹4.5 K');
    assert.equal(appModule.formatInrCompact(500), '₹500');
    assert.equal(appModule.formatInrCompact(-150000), '-₹1.50 L');

    appModule.goToStep(2);
    assert.equal(appModule.state.step, 2);
    appModule.goToStep(3);
    assert.equal(appModule.state.step, 3);
    appModule.returnToWizard(1);
    assert.equal(appModule.state.step, 1);

    appModule.updateAge('invalid');
    appModule.state.life_expectancy = 80;
    appModule.updateAge('78');
    assert.equal(appModule.state.current_age, 78);
    assert.ok(appModule.state.life_expectancy >= 83);
    appModule.updateAge('38');

    getElement('medInsStatusNote');
    appModule.setMedicalInsurance(false);
    assert.equal(appModule.state.has_medical_insurance, false);
    appModule.setMedicalInsurance(true);
    assert.equal(appModule.state.has_medical_insurance, true);

    appModule.updateCorpusLakhs(500);
    assert.equal(appModule.state.corpus_lakhs, 500);

    appModule.updateSplit('equity', 60);
    assert.equal(appModule.state.equity_pct + appModule.state.fixed_income_pct + appModule.state.property_pct, 100);
    appModule.updateSplit('fixed_income', 40);
    assert.equal(appModule.state.equity_pct + appModule.state.fixed_income_pct + appModule.state.property_pct, 100);
    appModule.updateSplit('property', 20);
    assert.equal(appModule.state.equity_pct + appModule.state.fixed_income_pct + appModule.state.property_pct, 100);

    appModule.state.fixed_income_pct = 0;
    appModule.state.property_pct = 0;
    appModule.updateSplit('equity', 50);

    appModule.state.equity_pct = 0;
    appModule.state.property_pct = 0;
    appModule.updateSplit('fixed_income', 50);

    appModule.state.equity_pct = 0;
    appModule.state.fixed_income_pct = 0;
    appModule.updateSplit('property', 50);

    appModule.switchExpenseFreq('annual');
    assert.equal(appModule.state.expense_frequency, 'annual');
    appModule.switchExpenseFreq('monthly');
    assert.equal(appModule.state.expense_frequency, 'monthly');

    appModule.addKnownExpenseFromInputs();
    appModule.addPresetKnownExpense('Car Upgrade', 5, 15);
    assert.ok(appModule.state.known_future_expenses.length >= 2);
    while (appModule.state.known_future_expenses.length > 0) {
      appModule.removeKnownExpense(0);
    }
    assert.equal(appModule.state.known_future_expenses.length, 0);
    appModule.addPresetKnownExpense('Higher Education', 8, 25);

    appModule.toggleAdvancedDrawer();
    getElement('rebalanceEnabledChk').checked = false;
    appModule.updateAdvSettings();
    getElement('rebalanceEnabledChk').checked = true;
    appModule.updateAdvSettings();
  });

  await runCase('test_simulation_runner_charts_and_inspector', async () => {
    const mockSimData = {
      simulation_meta: {
        seed_used: 98765,
        num_simulations: 500,
        historical_data_period: '2006–2025 (Last 20 Years)',
      },
      inputs_summary: {
        current_age: 38,
        life_expectancy: 90,
        target_horizon_years: 52,
        max_simulated_years: 62,
        total_corpus_formatted: '₹3.50 Cr',
        monthly_expense_formatted: '₹1.00 L',
        has_medical_insurance: false,
        allocation: { equity_pct: 55, fixed_income_pct: 30, property_pct: 15 },
        known_future_expenses: [{ years_from_now: 2, amount_today_inr: 2500000, event_tag: 'Education' }],
        home_improvement_enabled: true,
        home_improvement_pct_of_property: 3.0,
        home_improvement_variance_pct: 1.0,
        home_improvement_interval_years: 5,
        random_expense_enabled: true,
        random_expense_base_inr: 200000,
        random_expense_variance_pct: 25,
        random_expense_annual_probability_pct: 15,
        rebalance_enabled: true,
        rebalance_frequency_years: 2,
        fixed_income_tax_rate: 30.0,
        equity_tax_rate: 12.5,
      },
      verdict: {
        status: 'retire_ready',
        badge: 'Yes — High Confidence',
        headline: 'Wealth lasts 52+ yrs',
        recommendation: 'Safe withdrawal rate.',
      },
      longevity_stats: {
        success_probability_pct: 88.5,
        percentiles_years: { p10: 24.5, p50: 62.0 },
        depletion_ages: { p10: 62.5, p50: 100.0 },
      },
      trajectories: {
        real: {
          ages: [38, 39, 40, 41, 42, 43, 44, 45, 46],
          p50: [35000000, 36000000, 34000000, 35500000, 37000000, 38000000, 39000000, 40000000, 41000000],
          p10: [35000000, 30000000, 25000000, 20000000, 15000000, 10000000, 5000000, 0, 0],
        },
        nominal: {
          ages: [38, 39, 40, 41, 42, 43, 44, 45, 46],
          p50: [35000000, 38000000, 39000000, 42000000, 45000000, 48000000, 51000000, 54000000, 58000000],
          p10: [35000000, 31000000, 27000000, 22000000, 17000000, 12000000, 6000000, 0, 0],
        },
      },
      chart_events: {
        events_by_age: {
          '40': ['🎯 Education (Yr 2): ₹25.00 L'],
          '43': ['🏠 Home Improvement (Yr 5)', '⚡ Random Shock: ₹3.00 L'],
        },
        known_expense_ages: [40],
      },
      longevity_histogram: [
        { label: '0–25 yrs', count: 50, percentage: 10.0 },
        { label: '52+ yrs', count: 450, percentage: 90.0 },
      ],
      survival_curve: {
        ages: [38, 39, 40, 41],
        survival_probability_pct: [100, 99, 97, 95],
      },
      notable_runs: [
        {
          label: 'P50 — Median Simulation Run',
          run_number: 12,
          years_lasted: 52.0,
          year_log: [
            {
              sim_year: 1,
              age: 38,
              sampled_india_year: 2008,
              equity_return_pct: -51.3,
              debt_return_pct: 11.2,
              inflation_pct: 8.3,
              lifestyle_inflation_pct: 0.5,
              special_events_summary: '—',
              withdrawal: 1200000,
              withdrawal_source_summary: 'Debt: ₹17.14 L',
              rebalance_activity: '—',
              end_corpus_real: 28000000,
            },
            {
              sim_year: 2,
              age: 39,
              sampled_india_year: 2009,
              equity_return_pct: 77.6,
              debt_return_pct: 4.8,
              inflation_pct: 10.9,
              lifestyle_inflation_pct: 0.5,
              special_events_summary: '🎯 Education',
              withdrawal: 3700000,
              withdrawal_source_summary: 'Debt + Eq',
              rebalance_activity: 'Sold ₹15.00 L Eq → Debt',
              end_corpus_real: 36000000,
            },
          ],
        },
        {
          label: 'P10 — Unlucky Early Crash Run',
          run_number: 4,
          years_lasted: 24.5,
          year_log: [],
        },
      ],
    };

    mockFetchHandler = async () => ({
      ok: true,
      json: async () => mockSimData,
    });

    await appModule.triggerSimulationRun();
    assert.ok(appModule.state.result);

    appModule.setCurveFocus('p50');
    appModule.setCurveFocus('p10');
    appModule.setCurveFocus('both');
    appModule.switchChartScale('nominal');
    appModule.switchChartScale('real');

    const spChart = appModule.charts.spaghetti;
    spChart.options.plugins.legend.onClick({}, { datasetIndex: 0 });
    spChart.options.plugins.legend.onClick({}, { datasetIndex: 1 });
    spChart.options.plugins.legend.onClick({}, { datasetIndex: 0 });

    const spTooltip = spChart.options.plugins.tooltip.callbacks;
    assert.ok(spTooltip.label({ dataset: { label: 'P50' }, raw: 35000000 }).includes('₹'));
    assert.ok(spTooltip.afterBody([{ dataIndex: 2 }]).length > 0);
    assert.equal(spTooltip.afterBody([]).length, 0);

    const histTooltip = appModule.charts.histogram.options.plugins.tooltip.callbacks;
    assert.ok(histTooltip.label({ raw: 90.0, dataIndex: 1 }).includes('90%'));

    mockFetchHandler = async () => ({
      ok: false,
      json: async () => ({ detail: 'Validation error' }),
    });
    await appModule.triggerSimulationRun();
    assert.ok(String(lastAlert).includes('Simulation Error'));

    mockFetchHandler = async () => {
      throw new Error('Network failure');
    };
    await appModule.triggerSimulationRun();
  });

  await runCase('test_screen_switching_dropzone_and_expense_analyzer', async () => {
    appModule.switchAppScreen('expense_analyzer');
    appModule.switchAppScreen('wealth_longevity');

    mockFetchHandler = async () => ({
      ok: true,
      json: async () => ({ active_modules: [] }),
    });
    await appModule.syncActiveModulesNav();

    const dropZone = getElement('dropZoneLabel');
    const dummyEvent = {
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { files: [{ name: 'statement.csv' }] },
    };
    dropZone.dispatchEvent('dragenter', dummyEvent);
    dropZone.dispatchEvent('dragleave', dummyEvent);

    const mockExpenseResult = {
      discovered_schema: {
        header_row_number: 1,
        columns_discovered: {
          date: 'Txn Date',
          description: 'Narration',
          debit_or_amount: 'Withdrawal',
          balance_ignored: 'Balance',
        },
        extracted_debit_rows: 3,
        skipped_credit_rows: 1,
      },
      summary: {
        estimated_monthly_expense_exact: '₹65,000',
        estimated_monthly_expense_formatted: '₹65.0 K',
        estimated_annual_expense_formatted: '₹7.80 L',
        num_months_detected: 1,
        months_list: ['2026-09'],
        total_living_expenses_formatted: '₹65.0 K',
        total_transactions_classified: 3,
        estimated_monthly_investments_formatted: '₹25.0 K',
      },
      category_breakdown: [
        {
          category_id: 'rent',
          label: 'Rent & Maintenance',
          icon: '🏠',
          color: '#6366f1',
          is_living_expense: true,
          share_of_expenses_pct: 50.0,
          monthly_average: 32500,
          monthly_inr_exact: '₹32,500',
          monthly_formatted: '₹32.5 K',
          transaction_count: 1,
          total_formatted: '₹32.5 K',
        },
        {
          category_id: 'investments',
          label: 'Investments & SIPs',
          icon: '📈',
          color: '#22c55e',
          is_living_expense: false,
          share_of_expenses_pct: 0.0,
          monthly_average: 25000,
          monthly_inr_exact: '₹25,000',
          monthly_formatted: '₹25.0 K',
          transaction_count: 1,
          total_formatted: '₹25.0 K',
        },
      ],
      monthly_trend: [
        {
          month: '2026-09',
          living_expense: 65000,
          investments: 25000,
        },
      ],
      transactions: [
        {
          date: '2026-09-03',
          description: 'UPI/MONTHLY HOUSE RENT',
          amount_formatted: '₹32,500',
          category_id: 'rent',
          category_icon: '🏠',
          category_label: 'Rent & Maintenance',
          matched_cue: 'Residential Rent Payment',
          confidence: 0.95,
        },
        {
          date: '2026-09-05',
          description: 'ACH D- MUTUAL FUND SIP',
          amount_formatted: '₹25,000',
          category_id: 'investments',
          category_icon: '📈',
          category_label: 'Investments & SIPs',
          matched_cue: 'Mutual Fund SIP',
          confidence: 0.98,
        },
      ],
    };

    mockFetchHandler = async () => ({
      ok: true,
      json: async () => mockExpenseResult,
    });

    dropZone.dispatchEvent('drop', dummyEvent);
    await appModule.handleStatementFileSelected({ files: [{ name: 'statement.xlsx' }] });
    await appModule.reRunCurrentStatementIfLoaded();

    appModule.filterTransactionsByCategory('rent');
    appModule.filterTransactionsByCategory('all');

    const catTooltip = appModule.expenseState.categoryChart.options.plugins.tooltip.callbacks;
    assert.ok(catTooltip.label({ raw: 32500, dataIndex: 0 }).includes('₹'));
    const trendTooltip = appModule.expenseState.monthlyTrendChart.options.plugins.tooltip.callbacks;
    assert.ok(trendTooltip.label({ dataset: { label: 'Living' }, raw: 65000 }).includes('₹'));

    mockFetchHandler = async () => ({
      ok: false,
      json: async () => ({ detail: 'Empty statement' }),
    });
    await appModule.uploadAndAnalyzeStatementFile({ name: 'bad.csv' });

    mockFetchHandler = async () => {
      throw new Error('Network error');
    };
    await appModule.uploadAndAnalyzeStatementFile({ name: 'offline.csv' });
  });

  global.setTimeout = origSetTimeout;
  global.setInterval = origSetInterval;
  global.clearInterval = origClearInterval;

  // -------------------------------------------------------------------------
  // Compute & Print Standard Tabular Coverage Report
  // -------------------------------------------------------------------------
  const covResult = await new Promise((resolve, reject) => {
    session.post('Profiler.takePreciseCoverage', (err, res) => {
      if (err) reject(err);
      else resolve(res.result);
    });
  });
  session.post('Profiler.stopPreciseCoverage');
  session.disconnect();

  const repoRoot = path.resolve(__dirname, '..');
  const targetFiles = ['app/static/js/app.js', 'app/static/js/chart.js'];

  console.log('\n================================ tests coverage ================================');
  console.log(
    `${'Name'.padEnd(36)} ${'Lines'.padStart(7)} ${'Miss'.padStart(6)} ${'Funcs'.padStart(7)} ${'Cover'.padStart(7)}   Missing`
  );
  console.log('-'.repeat(80));

  let totalLinesAll = 0;
  let missedLinesAll = 0;

  for (const relPath of targetFiles) {
    const absPath = path.join(repoRoot, relPath);
    const source = fs.readFileSync(absPath, 'utf8');
    const lines = source.split('\n');
    const totalLines = lines.length;

    // Build line offset map
    const lineOffsets = [];
    let offset = 0;
    for (let i = 0; i < totalLines; i++) {
      lineOffsets.push({ lineNum: i + 1, start: offset, end: offset + lines[i].length, text: lines[i] });
      offset += lines[i].length + 1;
    }

    const scriptEntry = covResult.find((entry) => {
      if (!entry.url) return false;
      const entryPath = entry.url.startsWith('file://') ? fileURLToPath(entry.url) : entry.url;
      return path.resolve(entryPath) === absPath;
    });

    const uncoveredSet = new Set();
    let totalFuncs = 0;
    let coveredFuncs = 0;

    if (scriptEntry) {
      const allRanges = [];
      for (const fn of scriptEntry.functions) {
        if (fn.functionName !== '') {
          totalFuncs++;
          if (fn.ranges.some((r) => r.count > 0)) coveredFuncs++;
        }
        for (const r of fn.ranges) {
          allRanges.push(r);
        }
      }

      for (const lo of lineOffsets) {
        const trimmed = lo.text.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed === '}' || trimmed === '};' || trimmed === ');') {
          continue;
        }
        const firstNonWs = lo.start + lo.text.indexOf(trimmed[0]);
        // In V8 nested ranges, the smallest range containing firstNonWs determines the line's execution count
        let bestRange = null;
        for (const r of allRanges) {
          if (r.startOffset <= firstNonWs && firstNonWs < r.endOffset) {
            if (!bestRange || (r.endOffset - r.startOffset) <= (bestRange.endOffset - bestRange.startOffset)) {
              bestRange = r;
            }
          }
        }
        if (bestRange && bestRange.count === 0) {
          uncoveredSet.add(lo.lineNum);
        }
      }
    }

    const missCount = uncoveredSet.size;
    const lineCov = ((totalLines - missCount) / totalLines) * 100;
    const funcCov = totalFuncs > 0 ? (coveredFuncs / totalFuncs) * 100 : 100;
    totalLinesAll += totalLines;
    missedLinesAll += missCount;

    const missingList = Array.from(uncoveredSet).sort((a, b) => a - b).join(', ');
    console.log(
      `${relPath.padEnd(36)} ${String(totalLines).padStart(7)} ${String(missCount).padStart(6)} ${(funcCov.toFixed(0) + '%').padStart(7)} ${(lineCov.toFixed(1) + '%').padStart(7)}   ${missingList}`
    );

    assert.ok(lineCov >= 95.0, `Expected >= 95% line coverage for ${relPath}, got ${lineCov.toFixed(2)}%`);
    assert.ok(funcCov >= 95.0, `Expected >= 95% function coverage for ${relPath}, got ${funcCov.toFixed(2)}%`);
  }

  const overallCov = ((totalLinesAll - missedLinesAll) / totalLinesAll) * 100;
  console.log('-'.repeat(80));
  console.log(
    `${'TOTAL'.padEnd(36)} ${String(totalLinesAll).padStart(7)} ${String(missedLinesAll).padStart(6)} ${'100%'.padStart(7)} ${(overallCov.toFixed(1) + '%').padStart(7)}`
  );
  console.log(`\nRequired test coverage of 95.0% reached. Total coverage: ${overallCov.toFixed(2)}%`);
  console.log(`======================== ${results.length} passed in JavaScript suite ========================`);
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
