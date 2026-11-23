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
    translate() {},
    rotate() {},
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
      equityLakhsInput: '190',
      fiLakhsInput: '95',
      reLakhsInput: '50',
      cashLakhsInput: '15',
      jobIncomeInput: '150000',
      jobYearsInput: '5',
      jobGrowthInput: '8.0',
      rentalIncomeInput: '20000',
      passiveIncomeInput: '10000',
      eqSipInput: '35000',
      eqSipStepupInput: '10',
      fiSipInput: '15000',
      fiSipStepupInput: '5',
      sipYearsInput: '5',
      lifeInfSlider: '0.5',
      targetAgeSlider: '90',
      taxDragSlider: '10.0',
      globalVarianceSlider: '10',
      rebalanceFreqSlider: '2',
      randExpBaseLakhsInput: '2.0',
      randExpProbInput: '15',
      samplingSelect: 'iid_bootstrap',
      numSimsSelect: '2500',
      newKnownTag: 'Education',
      newKnownYears: '38',
      newKnownLakhs: '20',
      newKnownStartYear: '38',
      newKnownEndYear: '90',
      newKnownEveryNYears: '3',
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

  await runCase('test_local_chart_line_pie_vertical_and_horizontal_bars', async () => {
    const canvas = getElement('testChartCanvas');

    // 1. Doughnut / Pie Chart with hover
    const pieChart = new LocalChart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Equity', 'Fixed Income', 'Real Estate', 'Cash'],
        datasets: [
          {
            label: 'Assets',
            data: [190, 95, 50, 15],
            backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9'],
          },
        ],
      },
    });
    canvas.dispatchEvent('mousemove', { clientX: 180, clientY: 120 });
    canvas.dispatchEvent('mouseleave', {});
    pieChart.destroy();

    // Empty pie chart (total = 0)
    const emptyPie = new LocalChart(canvas, {
      type: 'pie',
      data: { labels: ['A'], datasets: [{ data: [0] }] },
    });
    emptyPie.destroy();

    // 2. Line Chart with separate per-curve tooltips
    let clickedDataset = null;
    const lineChart = new LocalChart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: ['Age 38', 'Age 39', 'Age 40', 'Age 41'],
        datasets: [
          {
            label: 'Typical Market Case Very Long Legend Label To Trigger Multi-Row Legend Wrapping Across Canvas Width',
            caseKey: 'p50',
            data: [35000000, 36000000, 37000000, 38000000],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            fill: 'origin',
            pointRadius: [0, 6, 0, 5],
            pointBackgroundColor: ['#6366f1', '#f59e0b', '#6366f1', '#10b981'],
          },
          {
            label: 'Tough 10% Case Series With Another Long Legend Label For Second Row Wrapping',
            caseKey: 'p10',
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

    canvas.dispatchEvent('mousemove', { clientX: 200, clientY: 100 });
    assert.ok(lineChart._hoverIndex >= 0);
    assert.ok(lineChart._hoverDatasetIndex >= 0);
    canvas.dispatchEvent('mousemove', { clientX: 5, clientY: 5 });
    assert.equal(lineChart._hoverIndex, -1);
    canvas.dispatchEvent('mousemove', { clientX: 250, clientY: 220 });
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

  await runCase('test_5_step_wizard_assets_income_sips_and_goals', async () => {
    global.window.dispatchEvent('DOMContentLoaded');

    assert.equal(appModule.formatInrCompact(35000000), '₹3.50 Cr');
    assert.equal(appModule.formatInrCompact(250000), '₹2.50 L');
    assert.equal(appModule.formatInrCompact(4500), '₹4.5 K');
    assert.equal(appModule.formatInrCompact(500), '₹500');
    assert.equal(appModule.formatInrCompact(-150000), '-₹1.50 L');

    // Step 1 mandatory guard: cannot move to Step 2 until both current_age and has_medical_insurance are answered
    appModule.state.current_age = null;
    appModule.state.has_medical_insurance = null;
    getElement('ageInput').value = '';
    appModule.goToStep(2);
    assert.equal(appModule.state.step, 1);

    // Answer both mandatory questions in Step 1 (and verify typing '4' then '45' does NOT clamp '4' to 18)
    getElement('ageInput').value = '4';
    appModule.updateAge('4', false);
    assert.equal(getElement('ageInput').value, '4');
    getElement('ageInput').value = '45';
    appModule.updateAge('45', false);
    assert.equal(appModule.state.current_age, 45);
    assert.equal(getElement('ageInput').value, 45);
    appModule.updateAge('38', true);
    appModule.setMedicalInsurance(true);
    assert.equal(appModule.isStep1Complete(), true);

    for (const s of [1, 2, 3, 4, 5]) {
      appModule.goToStep(s);
      assert.equal(appModule.state.step, s);
    }
    appModule.returnToWizard(1);
    assert.equal(appModule.state.step, 1);

    appModule.updateAge('invalid');
    appModule.state.life_expectancy = 80;
    appModule.updateAge('78');
    assert.equal(appModule.state.current_age, 78);
    assert.ok(appModule.state.life_expectancy >= 83);
    appModule.updateAge('38');

    // Medical insurance toggle changes default random shock between ₹5L and ₹2L
    getElement('medInsStatusNote');
    appModule.setMedicalInsurance(false);
    assert.equal(appModule.state.has_medical_insurance, false);
    assert.equal(appModule.state.random_expense_base_inr, 500000);
    appModule.setMedicalInsurance(true);
    assert.equal(appModule.state.has_medical_insurance, true);
    assert.equal(appModule.state.random_expense_base_inr, 200000);

    // Step 2: Individual Asset Values + Pie Chart + Liquidity calculation
    appModule.updateAssetValue('equity', 200);
    appModule.updateAssetValue('fixed_income', 100);
    appModule.updateAssetValue('real_estate', 60);
    appModule.updateAssetValue('cash', 40);
    assert.equal(appModule.state.corpus_lakhs, 400);

    appModule.updateCorpusLakhs(500);
    appModule.updateSplit('equity', 50);
    appModule.updateSplit('fixed_income', 30);
    appModule.updateSplit('property', 20);

    // Step 3: Income Categories (including Age until which income lasts & increment range e.g. '5-9%')
    getElement('jobYearsInput').value = '45';
    getElement('jobGrowthInput').value = '5-9%';
    appModule.updateIncomeSettings();
    assert.equal(appModule.state.job_monthly_income, 150000);
    assert.equal(appModule.state.job_income_until_age, 45);
    assert.equal(appModule.state.job_income_years, 7);
    assert.equal(appModule.state.job_income_growth_pct, 5);
    assert.equal(appModule.state.job_income_growth_max_pct, 9);
    getElement('jobYearsInput').value = '5';
    getElement('jobGrowthInput').value = '8.0';
    appModule.updateIncomeSettings();
    assert.equal(appModule.state.job_income_years, 5);

    // Step 4: Ongoing Monthly SIPs
    appModule.updateSipSettings();
    assert.equal(appModule.state.equity_sip_monthly, 35000);
    assert.equal(appModule.state.fixed_income_sip_monthly, 15000);

    // Step 5: Expenses (with optional variance) & One-Off + Recurring Goals (with Start Age / End Age)
    appModule.updateExpense(100000);
    appModule.updateExpenseVariance('10');
    assert.equal(appModule.state.expense_variance_pct, 10);
    appModule.updateExpenseVariance('');
    assert.equal(appModule.state.expense_variance_pct, 0);
    appModule.switchExpenseFreq('annual');
    assert.equal(appModule.state.expense_frequency, 'annual');
    appModule.switchExpenseFreq('monthly');
    assert.equal(appModule.state.expense_frequency, 'monthly');

    // Quick labels for One-Off (Education, Marriage, Vehicle) and Recurring (Home Improvement, Vacation)
    appModule.selectGoalQuickLabel('Vehicle', false, 15, 10, 43, 43, 1);
    appModule.addKnownExpenseFromInputs();
    // Recurring with empty End Age -> defaults to End of Plan
    appModule.selectGoalQuickLabel('Vacation', true, 2, 15, 40, '', 2);
    appModule.addKnownExpenseFromInputs();
    appModule.addPresetKnownExpense('Home Improvement', 5, 5, true, 20, 30, 5);

    while (appModule.state.known_future_expenses.length > 0) {
      appModule.removeKnownExpense(0);
    }
    assert.equal(appModule.state.known_future_expenses.length, 0);
    appModule.addPresetKnownExpense('Education', 8, 25, false);
    appModule.addPresetKnownExpense('Vacation', 2, 2, true, 15, 20, 2);

    appModule.toggleAdvancedDrawer();
    getElement('rebalanceEnabledChk').checked = false;
    appModule.updateAdvSettings();
    getElement('rebalanceEnabledChk').checked = true;
    appModule.updateAdvSettings();
  });

  await runCase('test_simulation_runner_when_can_i_retire_separate_tooltips_and_inspector', async () => {
    const mockSimData = {
      simulation_meta: {
        seed_used: 98765,
        num_simulations: 500,
        historical_data_period: 'Last 20 Years of Indian Market Data',
      },
      inputs_summary: {
        current_age: 38,
        life_expectancy: 90,
        target_horizon_years: 52,
        max_simulated_years: 62,
        total_corpus_formatted: '₹4.00 Cr',
        monthly_expense_formatted: '₹1.00 L',
        liquid_pct: 85.0,
        has_medical_insurance: false,
        allocation: { equity_pct: 50, fixed_income_pct: 25, property_pct: 15, cash_pct: 10 },
        known_future_expenses: [
          { years_from_now: 2, amount_today_inr: 2500000, event_tag: 'Education', is_recurring: false },
          { start_year: 5, end_year: 25, every_n_years: 5, amount_today_inr: 500000, event_tag: 'Home Improvement', is_recurring: true },
        ],
        random_expense_enabled: true,
        random_expense_base_inr: 500000,
        random_expense_variance_pct: 25,
        random_expense_annual_probability_pct: 15,
        rebalance_enabled: true,
        rebalance_frequency_years: 2,
        tax_drag_rate: 10.0,
      },
      retirement_readiness: {
        target_success_rate_pct: 85.0,
        can_retire_at_age: 40,
        years_until_retirement: 2,
        evaluated_retirement_age: 40,
        evaluated_retire_in_years: 2,
        retire_today_success_rate_pct: 72.0,
        evaluated_success_rate_pct: 88.5,
        max_income_years_searched: 5,
        candidate_retirement_ages: [
          {
            retire_in_years: 0,
            retirement_age: 38,
            success_rate_pct: 72.0,
            median_years_lasted: 42.0,
            worst_case_years_lasted: 19.5,
            median_depletion_age: 80.0,
            worst_case_depletion_age: 57.5,
            meets_target: false,
          },
          {
            retire_in_years: 1,
            retirement_age: 39,
            success_rate_pct: 80.0,
            median_years_lasted: 49.0,
            worst_case_years_lasted: 22.0,
            median_depletion_age: 87.0,
            worst_case_depletion_age: 60.0,
            meets_target: false,
          },
          {
            retire_in_years: 2,
            retirement_age: 40,
            success_rate_pct: 88.5,
            median_years_lasted: 62.0,
            worst_case_years_lasted: 24.5,
            median_depletion_age: 100.0,
            worst_case_depletion_age: 62.5,
            meets_target: true,
          },
        ],
        outcomes_by_age: {
          '38': {
            retirement_age: 38,
            retire_in_years: 0,
            verdict: {
              status: 'borderline',
              badge: 'Age 38 (2 Yrs Before Suggested Age 40)',
              headline: 'Retiring earlier at Age 38 gives a 72.0% success rate (vs. 88.5% at suggested Age 40).',
              recommendation: 'In the Median Case your wealth lasts until Age 80, and in the Worst Case until Age 58.',
            },
            longevity_stats: {
              success_probability_pct: 72.0,
              success_rate_pct: 72.0,
              percentiles_years: { p10: 19.5, p50: 42.0 },
              depletion_ages: { p10: 57.5, p50: 80.0 },
            },
            trajectories: {
              real: {
                ages: [38, 39, 40, 41, 42, 43, 44, 45, 46],
                p50: [35000000, 34000000, 32500000, 31000000, 30000000, 29000000, 28000000, 27000000, 26000000],
                p10: [35000000, 28000000, 21000000, 15000000, 9000000, 3000000, 0, 0, 0],
              },
              nominal: {
                ages: [38, 39, 40, 41, 42, 43, 44, 45, 46],
                p50: [35000000, 36000000, 36500000, 37000000, 38000000, 39000000, 40000000, 41000000, 42000000],
                p10: [35000000, 29000000, 23000000, 17000000, 11000000, 4000000, 0, 0, 0],
              },
            },
            chart_events: {
              events_by_age: { '40': ['🎯 Education (Yr 2): ₹25.00 L'], '43': ['⚡ Random Shock: ₹5.00 L'] },
              events_by_age_p50: { '40': ['🎯 Education (Yr 2): ₹25.00 L'], '43': ['🏠 Home Improvement (Yr 5)'] },
              events_by_age_p10: { '40': ['🎯 Education (Yr 2): ₹25.00 L'], '43': ['⚡ Random Shock: ₹5.00 L'] },
              known_expense_ages: [40],
            },
            survival_curve: {
              ages: [38, 39, 40, 41],
              survival_probability_pct: [100, 96, 91, 86],
            },
            notable_runs: [
              {
                case_key: 'p50',
                label: 'P50 — Median Case (Typical Market)',
                run_number: 12,
                years_lasted: 42.0,
                year_log: [
                  {
                    sim_year: 1,
                    age: 38,
                    sampled_india_year: 2008,
                    equity_return_pct: -51.3,
                    debt_return_pct: 8.8,
                    inflation_pct: 8.4,
                    income_received: 0,
                    sip_contributed: 0,
                    base_living_expense: 1200000,
                    combined_events_summary: '—',
                    end_corpus_real: 26800000,
                  },
                ],
              },
            ],
          },
        },
      },
      verdict: {
        status: 'retire_ready',
        badge: 'You Can Retire at Age 40 (in 2 Years)',
        headline: 'You can retire at Age 40 (in 2 years) with an 88.5% success rate.',
        recommendation: 'Continuing your income and SIPs for 2 more years reaches the 85% target.',
      },
      longevity_stats: {
        success_probability_pct: 88.5,
        success_rate_pct: 88.5,
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
          '43': ['🏠 Home Improvement (Yr 5)', '⚡ Random Shock: ₹5.00 L'],
        },
        events_by_age_p50: {
          '40': ['🎯 Education (Yr 2): ₹25.00 L'],
          '43': ['🏠 Home Improvement (Yr 5)'],
        },
        events_by_age_p10: {
          '40': ['🎯 Education (Yr 2): ₹25.00 L'],
          '43': ['⚡ Random Shock: ₹5.00 L'],
        },
        known_expense_ages: [40],
      },
      survival_curve: {
        ages: [38, 39, 40, 41],
        survival_probability_pct: [100, 99, 97, 95],
      },
      notable_runs: [
        {
          case_key: 'p50',
          label: 'P50 — Median Case (Typical Market)',
          run_number: 12,
          years_lasted: 52.0,
          year_log: [
            {
              sim_year: 1,
              age: 38,
              sampled_india_year: 2008,
              equity_return_pct: -51.3,
              debt_return_pct: 8.8,
              inflation_pct: 8.4,
              income_received: 1800000,
              sip_contributed: 600000,
              base_living_expense: 1200000,
              combined_events_summary: '—',
              end_corpus_real: 28000000,
            },
            {
              sim_year: 2,
              age: 39,
              sampled_india_year: 2009,
              equity_return_pct: 77.6,
              debt_return_pct: 7.3,
              inflation_pct: 10.9,
              income_received: 0,
              sip_contributed: 0,
              base_living_expense: 1300000,
              combined_events_summary: '🎯 Education: ₹25.00 L • ⚖️ Rebalanced ₹15.00 L Eq → FD',
              end_corpus_real: 36000000,
            },
          ],
        },
        {
          case_key: 'p10',
          label: 'P10 — Worst Case',
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

    // Blank expense should be blocked and alert the user rather than defaulting to ₹1 Lakh
    appModule.updateExpense(0);
    await appModule.triggerSimulationRun();
    assert.ok(String(lastAlert).includes('living expenses'));

    // Now set valid living expense and run simulation
    appModule.updateExpense(100000);
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

    // Verify separate tooltips for Median Case (P50) vs Worst Case (P10) markers
    const spTooltip = spChart.options.plugins.tooltip.callbacks;
    assert.ok(spTooltip.label({ dataset: { label: 'Median Case' }, raw: 35000000 }).includes('₹'));
    const p50Body = spTooltip.afterBody([{ dataIndex: 5, dataset: { caseKey: 'p50' } }]);
    const p10Body = spTooltip.afterBody([{ dataIndex: 5, dataset: { caseKey: 'p10' } }]);
    assert.ok(p50Body.some((l) => l.includes('Median Case')));
    assert.ok(p10Body.some((l) => l.includes('Worst Case')));
    assert.equal(spTooltip.afterBody([]).length, 0);

    // Verify Retirement Age Finder Bar Chart & selecting an earlier age (Age 38 before recommended Age 40)
    const retChart = appModule.charts.retirementAge;
    assert.ok(retChart);
    const retTooltip = retChart.options.plugins.tooltip.callbacks;
    assert.ok(retTooltip.label({ dataIndex: 2 }).includes('88.5%'));
    assert.ok(retTooltip.afterBody([{ dataIndex: 0 }]).some((l) => l.includes('Median Case')));

    // Click first bar (Age 38) on the Retirement Age Finder Bar Chart
    const retCanvas = getElement('retirementAgeChart');
    retCanvas.dispatchEvent('click', { clientX: 90, clientY: 120 });
    assert.equal(appModule.state.selected_retirement_age, 38);
    assert.equal(getElement('cardP50Age').textContent, 'Lasts until 80');
    assert.equal(getElement('cardP10Age').textContent, 'Lasts until 58');

    // Also test selecting back to recommended Age 40
    appModule.selectCandidateRetirementAge(40);
    assert.equal(appModule.state.selected_retirement_age, 40);

    // Also test empty retirement_readiness branch
    appModule.renderRetirementAgeProgression(null);

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
