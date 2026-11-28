/**
 * FinDependence India — "When Can I Retire?" 5-Step Planner & Expense Analyzer
 * User personal inputs (age, health cover, assets, income, SIPs, expenses, goals) are NOT prefilled.
 * Only configuration items (tax drag, lifestyle inflation, plan until age, rebalance, shocks) have defaults.
 */

const state = {
  step: 1,
  current_age: null,
  has_medical_insurance: null,

  // Step 2: Individual Asset Class Values in Lakhs (Not prefilled)
  equity_lakhs: 0,
  fixed_income_lakhs: 0,
  real_estate_lakhs: 0,
  cash_lakhs: 0,
  corpus_lakhs: 0,
  equity_pct: 0,
  fixed_income_pct: 0,
  property_pct: 0,
  cash_pct: 0,

  // Step 3: Income Categories (Not prefilled)
  job_monthly_income: 0,
  job_income_years: 0,
  job_income_until_age: null,
  job_income_growth_pct: 5,
  job_income_growth_max_pct: 5,
  job_income_growth_range: '5',
  rental_monthly_income: 0,
  other_passive_monthly_income: 0,
  passive_income_inflation_interval_years: 3,

  // Step 4: Ongoing Monthly SIPs (Not prefilled; automatically continue until end of income)
  equity_sip_monthly: 0,
  equity_sip_stepup_pct: 0,
  fixed_income_sip_monthly: 0,
  fixed_income_sip_stepup_pct: 0,
  sip_years: 0,

  // Step 5: Living Expenses & Planned Future Expenses (Not prefilled)
  expense_frequency: 'monthly',
  expense_amount: 0,
  expense_variance_pct: 10.0,
  selected_goal_quick_label: '',
  goal_form_is_recurring: false,
  known_future_expenses: [],

  // Configuration Settings (Prefilled)
  life_expectancy: 90,
  target_success_rate_pct: 85,
  lifestyle_inflation_rate: 0.5,
  tax_drag_rate: 10.0,
  global_variance_pct: 10.0,
  rebalance_enabled: true,
  rebalance_frequency_years: 2,
  random_expense_enabled: true,
  random_expense_base_inr: 200000,
  random_expense_variance_pct: 10.0,
  random_expense_annual_probability_pct: 15.0,
  property_mode: 'liquidate_fallback',
  sampling_method: 'iid_bootstrap',
  num_simulations: 2500,
  chart_scale: 'real',
  curve_focus: 'both',
  selected_retirement_age: null,
  result: null,
};

const charts = {
  assetPie: null,
  spaghetti: null,
};

// ==================== INDIAN CURRENCY HELPERS ====================
function formatInrCompact(amount, decimals = 2) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 10000000) {
    return `${sign}₹${(abs / 10000000).toFixed(decimals)} Cr`;
  }
  if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(decimals)} L`;
  }
  if (abs >= 1000) {
    return `${sign}₹${(abs / 1000).toFixed(1)} K`;
  }
  return `${sign}₹${Math.round(abs)}`;
}

// ==================== 5-STEP WIZARD NAVIGATION ====================
function isStep1Complete() {
  const ageVal = state.current_age || parseInt((document.getElementById('ageInput') || {}).value, 10) || 0;
  if (ageVal >= 18) state.current_age = ageVal;
  return Boolean(state.current_age && state.current_age >= 18 && state.has_medical_insurance !== null);
}

function scrollToPageTop() {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (typeof document !== 'undefined') {
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }
}

function goToStep(stepNum) {
  if (stepNum > 1 && !isStep1Complete()) {
    const err1 = document.getElementById('step1ValidationError');
    if (err1) err1.classList.remove('hidden');
    stepNum = 1;
  }
  state.step = stepNum;
  [1, 2, 3, 4, 5].forEach((n) => {
    const stepEl = document.getElementById(`wizardStep${n}`);
    const indEl = document.getElementById(`stepIndicator${n}`);
    if (!stepEl || !indEl) return;
    if (n === stepNum) {
      stepEl.classList.remove('hidden');
      indEl.className = 'text-left p-2 sm:p-3 rounded-xl border transition border-indigo-500 bg-indigo-500/10';
      indEl.querySelector('span:first-child').className = 'text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-indigo-400 block';
      indEl.querySelector('span:last-child').className = 'text-[11px] sm:text-xs font-semibold text-white';
    } else {
      stepEl.classList.add('hidden');
      indEl.className = 'text-left p-2 sm:p-3 rounded-xl border transition border-slate-800 bg-slate-900/60 hover:border-slate-700';
      indEl.querySelector('span:first-child').className = 'text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 block';
      indEl.querySelector('span:last-child').className = 'text-[11px] sm:text-xs font-semibold text-slate-300';
    }
  });
  if (stepNum === 2) {
    renderSplitUI();
  } else if (stepNum === 5) {
    syncGoalFormDefaults();
    updateGoalRepeatPreview();
  }
  scrollToPageTop();
}

function returnToWizard(stepNum = 1) {
  document.getElementById('resultsContainer').classList.add('hidden');
  document.getElementById('simulationProgressBox').classList.add('hidden');
  document.getElementById('headerRestartBtn').classList.add('hidden');
  document.getElementById('wizardContainer').classList.remove('hidden');
  goToStep(stepNum);
}

// ==================== HIDDEN QA PERSONA AUTOFILL (6 VERDICT SCENARIOS) ====================
const QA_PERSONAS = {
  retired_strong: {
    label: '1. Strong (Retired, Well-Funded)',
    age: 60,
    medIns: true,
    equity: 250,
    fi: 250,
    re: 100,
    cash: 20,
    jobMo: 0,
    jobUntilAge: '',
    jobGrowth: '5',
    rentMo: 25000,
    passiveMo: 15000,
    eqSip: 0,
    eqSipStep: 0,
    fiSip: 0,
    fiSipStep: 0,
    expenseMo: 100000,
    goals: [
      {
        event_tag: 'Vacation',
        amount_today_inr: 300000,
        is_recurring: true,
        years_from_now: 1,
        start_year: 1,
        end_year: 15,
        start_age: 61,
        end_age: 75,
        every_n_years: 3,
        variance_pct: 10,
      },
    ],
  },
  working_retire_now: {
    label: '2. Financial Freedom (Working, Retire Today)',
    age: 45,
    medIns: true,
    equity: 350,
    fi: 200,
    re: 100,
    cash: 20,
    jobMo: 350000,
    jobUntilAge: '55',
    jobGrowth: '5',
    rentMo: 20000,
    passiveMo: 0,
    eqSip: 80000,
    eqSipStep: 10,
    fiSip: 40000,
    fiSipStep: 5,
    expenseMo: 110000,
    goals: [
      {
        event_tag: 'Education',
        amount_today_inr: 2500000,
        is_recurring: false,
        years_from_now: 5,
        start_year: 5,
        end_year: 5,
        start_age: 50,
        end_age: 50,
        every_n_years: 1,
        variance_pct: 0,
      },
    ],
  },
  working_retire_early: {
    label: '3. Ahead of Plan (Working, Retire Early)',
    age: 40,
    medIns: true,
    equity: 140,
    fi: 80,
    re: 50,
    cash: 15,
    jobMo: 350000,
    jobUntilAge: '52',
    jobGrowth: '6',
    rentMo: 0,
    passiveMo: 0,
    eqSip: 100000,
    eqSipStep: 10,
    fiSip: 50000,
    fiSipStep: 5,
    expenseMo: 100000,
    goals: [
      {
        event_tag: 'Education',
        amount_today_inr: 2000000,
        is_recurring: false,
        years_from_now: 8,
        start_year: 8,
        end_year: 8,
        start_age: 48,
        end_age: 48,
        every_n_years: 1,
        variance_pct: 0,
      },
    ],
  },
  working_on_track: {
    label: '4. On Track (Working, Planned Retirement)',
    age: 50,
    medIns: true,
    equity: 210,
    fi: 110,
    re: 0,
    cash: 15,
    jobMo: 450000,
    jobUntilAge: '54',
    jobGrowth: '5',
    rentMo: 0,
    passiveMo: 0,
    eqSip: 140000,
    eqSipStep: 10,
    fiSip: 70000,
    fiSipStep: 5,
    expenseMo: 100000,
    goals: [],
  },
  working_shortfall: {
    label: '5. Needs Attention (Working Shortfall)',
    age: 45,
    medIns: false,
    equity: 35,
    fi: 25,
    re: 0,
    cash: 5,
    jobMo: 150000,
    jobUntilAge: '52',
    jobGrowth: '5',
    rentMo: 0,
    passiveMo: 0,
    eqSip: 20000,
    eqSipStep: 5,
    fiSip: 10000,
    fiSipStep: 5,
    expenseMo: 120000,
    goals: [
      {
        event_tag: 'Marriage',
        amount_today_inr: 2000000,
        is_recurring: false,
        years_from_now: 5,
        start_year: 5,
        end_year: 5,
        start_age: 50,
        end_age: 50,
        every_n_years: 1,
        variance_pct: 0,
      },
    ],
  },
  retired_shortfall: {
    label: '6. Action Required (Retired Shortfall)',
    age: 62,
    medIns: false,
    equity: 40,
    fi: 50,
    re: 0,
    cash: 10,
    jobMo: 0,
    jobUntilAge: '',
    jobGrowth: '5',
    rentMo: 0,
    passiveMo: 0,
    eqSip: 0,
    eqSipStep: 0,
    fiSip: 0,
    fiSipStep: 0,
    expenseMo: 100000,
    goals: [],
  },
};

function toggleQaPersonaPanel() {
  const panel = document.getElementById('qaPersonaPanel');
  if (panel) panel.classList.toggle('hidden');
}

function applyQaPersona(personaKey) {
  const p = QA_PERSONAS[personaKey];
  if (!p) return;

  // Step 1: Age & Medical Insurance
  updateAge(p.age, true);
  setMedicalInsurance(p.medIns);

  // Step 2: Assets (in Lakhs)
  updateAssetValue('equity', p.equity);
  updateAssetValue('fixed_income', p.fi);
  updateAssetValue('real_estate', p.re);
  updateAssetValue('cash', p.cash);

  // Step 3: Income
  document.getElementById('jobIncomeInput').value = p.jobMo || '';
  document.getElementById('jobYearsInput').value = p.jobUntilAge;
  document.getElementById('jobGrowthInput').value = p.jobGrowth;
  document.getElementById('rentalIncomeInput').value = p.rentMo || '';
  document.getElementById('passiveIncomeInput').value = p.passiveMo || '';
  updateIncomeSettings();

  // Step 4: SIPs
  document.getElementById('eqSipInput').value = p.eqSip || '';
  document.getElementById('eqSipStepupInput').value = p.eqSipStep || '';
  document.getElementById('fiSipInput').value = p.fiSip || '';
  document.getElementById('fiSipStepupInput').value = p.fiSipStep || '';
  updateSipSettings();

  // Step 5: Living Expenses, Goals & Default Advanced Config
  state.expense_frequency = 'monthly';
  switchExpenseFreq('monthly');
  updateExpense(p.expenseMo);
  state.known_future_expenses = p.goals.map((g) => ({ ...g }));
  resetAdvSettings();

  const statusRow = document.getElementById('qaPersonaStatusRow');
  const statusEl = document.getElementById('qaPersonaStatus');
  if (statusRow) statusRow.classList.remove('hidden');
  if (statusEl) statusEl.textContent = `Loaded: ${p.label}`;
}

// ==================== STEP 1: AGE & MEDICAL INSURANCE (MANDATORY) ====================
function updateAge(val, commitToInput = false) {
  const rawStr = String(val !== undefined && val !== null ? val : '').trim();
  if (rawStr === '') {
    state.current_age = null;
    return;
  }
  const parsed = parseInt(rawStr, 10);
  if (isNaN(parsed)) return;

  // When typing a 2-digit age like '45' into the text input (commitToInput === false),
  // do NOT clamp the first keystroke '4' to 18 or overwrite ageInput.value while parsed < 18!
  if (!commitToInput && parsed > 0 && parsed < 18) {
    state.current_age = null;
    return;
  }

  const age = Math.max(18, Math.min(84, parsed));
  state.current_age = age;
  const ageInp = document.getElementById('ageInput');
  if (ageInp && (commitToInput || parsed >= 18)) {
    ageInp.value = age;
  }
  document.getElementById('ageSlider').value = Math.min(75, Math.max(20, age));

  if (isStep1Complete()) {
    const err1 = document.getElementById('step1ValidationError');
    if (err1) err1.classList.add('hidden');
  }

  if (state.life_expectancy <= state.current_age + 5) {
    state.life_expectancy = Math.min(105, state.current_age + 15);
    document.getElementById('targetAgeSlider').value = state.life_expectancy;
  }
  syncGoalFormDefaults(true);
  updateIncomeSettings();
  updateGoalRepeatPreview();
  updateAdvSettings();
}

function setMedicalInsurance(hasIns) {
  state.has_medical_insurance = Boolean(hasIns);
  const btnYes = document.getElementById('btnMedInsYes');
  const btnNo = document.getElementById('btnMedInsNo');
  const shockLakhsInput = document.getElementById('randExpBaseLakhsInput');

  if (isStep1Complete()) {
    const err1 = document.getElementById('step1ValidationError');
    if (err1) err1.classList.add('hidden');
  }

  if (state.has_medical_insurance) {
    btnYes.className = 'px-5 py-2 rounded-xl text-xs font-bold border-2 border-emerald-500 bg-emerald-500/20 text-emerald-300 transition';
    btnNo.className = 'px-5 py-2 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-400 hover:text-white transition';
    state.random_expense_base_inr = 200000;
    if (shockLakhsInput) shockLakhsInput.value = '2.0';
  } else {
    btnNo.className = 'px-5 py-2 rounded-xl text-xs font-bold border-2 border-rose-500 bg-rose-500/20 text-rose-300 transition';
    btnYes.className = 'px-5 py-2 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-400 hover:text-white transition';
    state.random_expense_base_inr = 500000;
    if (shockLakhsInput) shockLakhsInput.value = '5.0';
  }
}

// ==================== STEP 2: INDIVIDUAL ASSET VALUES, PIE CHART & LIQUIDITY (0-2 CR, CASH 0-20 L) ====================
function updateAssetValue(assetKey, rawVal) {
  const lakhs = Math.max(0, parseFloat(rawVal) || 0);
  if (assetKey === 'equity') {
    state.equity_lakhs = lakhs;
    document.getElementById('equityLakhsInput').value = lakhs || '';
    document.getElementById('equityLakhsSlider').value = Math.min(200, lakhs);
  } else if (assetKey === 'fixed_income') {
    state.fixed_income_lakhs = lakhs;
    document.getElementById('fiLakhsInput').value = lakhs || '';
    document.getElementById('fiLakhsSlider').value = Math.min(200, lakhs);
  } else if (assetKey === 'real_estate') {
    state.real_estate_lakhs = lakhs;
    document.getElementById('reLakhsInput').value = lakhs || '';
    document.getElementById('reLakhsSlider').value = Math.min(200, lakhs);
  } else if (assetKey === 'cash') {
    state.cash_lakhs = lakhs;
    document.getElementById('cashLakhsInput').value = lakhs || '';
    document.getElementById('cashLakhsSlider').value = Math.min(20, lakhs);
  }
  renderSplitUI();
}

function updateCorpusLakhs(val) {
  const lakhs = Math.max(1, parseFloat(val) || 50);
  if (state.corpus_lakhs > 0) {
    const ratio = lakhs / state.corpus_lakhs;
    state.equity_lakhs = Math.round(state.equity_lakhs * ratio);
    state.fixed_income_lakhs = Math.round(state.fixed_income_lakhs * ratio);
    state.real_estate_lakhs = Math.round(state.real_estate_lakhs * ratio);
    state.cash_lakhs = Math.max(0, lakhs - state.equity_lakhs - state.fixed_income_lakhs - state.real_estate_lakhs);
  } else {
    state.equity_lakhs = Math.round(lakhs * 0.55);
    state.fixed_income_lakhs = Math.round(lakhs * 0.30);
    state.real_estate_lakhs = Math.round(lakhs * 0.15);
    state.cash_lakhs = 0;
  }
  renderSplitUI();
}

function updateSplit(changedKey, rawVal) {
  const pct = Math.max(0, Math.min(100, parseFloat(rawVal) || 0));
  const total = Math.max(100, state.corpus_lakhs || 100);
  if (changedKey === 'equity') state.equity_lakhs = Math.round((total * pct) / 100);
  else if (changedKey === 'fixed_income') state.fixed_income_lakhs = Math.round((total * pct) / 100);
  else state.real_estate_lakhs = Math.round((total * pct) / 100);
  renderSplitUI();
}

function renderSplitUI() {
  const eqL = Math.max(0, Number(state.equity_lakhs) || 0);
  const fiL = Math.max(0, Number(state.fixed_income_lakhs) || 0);
  const reL = Math.max(0, Number(state.real_estate_lakhs) || 0);
  const caL = Math.max(0, Number(state.cash_lakhs) || 0);
  const sumL = eqL + fiL + reL + caL;

  state.corpus_lakhs = sumL;
  if (sumL > 0) {
    state.equity_pct = Number(((eqL / sumL) * 100).toFixed(1));
    state.fixed_income_pct = Number(((fiL / sumL) * 100).toFixed(1));
    state.property_pct = Number(((reL / sumL) * 100).toFixed(1));
    state.cash_pct = Number(((caL / sumL) * 100).toFixed(1));
  } else {
    state.equity_pct = 0;
    state.fixed_income_pct = 0;
    state.property_pct = 0;
    state.cash_pct = 0;
  }

  const liquidL = eqL + fiL + caL;
  const nonLiquidL = reL;
  const liquidPct = sumL > 0 ? ((liquidL / sumL) * 100).toFixed(1) : '0.0';
  const nonLiquidPct = sumL > 0 ? ((nonLiquidL / sumL) * 100).toFixed(1) : '0.0';

  document.getElementById('corpusFormattedBadge').textContent = formatInrCompact(sumL * 100000);

  document.getElementById('eqPctText').textContent = state.equity_pct.toFixed(1);
  document.getElementById('fiPctText').textContent = state.fixed_income_pct.toFixed(1);
  document.getElementById('propPctText').textContent = state.property_pct.toFixed(1);
  const cashPctEl = document.getElementById('cashPctText');
  if (cashPctEl) cashPctEl.textContent = state.cash_pct.toFixed(1);

  document.getElementById('eqAmtText').textContent = formatInrCompact(eqL * 100000);
  document.getElementById('fiAmtText').textContent = formatInrCompact(fiL * 100000);
  document.getElementById('propAmtText').textContent = formatInrCompact(reL * 100000);
  const cashAmtEl = document.getElementById('cashAmtText');
  if (cashAmtEl) cashAmtEl.textContent = formatInrCompact(caL * 100000);

  document.getElementById('barEquity').style.width = `${state.equity_pct}%`;
  document.getElementById('barDebt').style.width = `${state.fixed_income_pct}%`;
  const barCash = document.getElementById('barCash');
  if (barCash) barCash.style.width = `${state.cash_pct}%`;
  document.getElementById('barProp').style.width = `${state.property_pct}%`;

  const liqAmtEl = document.getElementById('liquidAmtText');
  const liqPctEl = document.getElementById('liquidPctText');
  const nonLiqAmtEl = document.getElementById('nonLiquidAmtText');
  const nonLiqPctEl = document.getElementById('nonLiquidPctText');
  if (liqAmtEl) liqAmtEl.textContent = formatInrCompact(liquidL * 100000);
  if (liqPctEl) liqPctEl.textContent = liquidPct;
  if (nonLiqAmtEl) nonLiqAmtEl.textContent = formatInrCompact(nonLiquidL * 100000);
  if (nonLiqPctEl) nonLiqPctEl.textContent = nonLiquidPct;

  renderAssetPieChart(eqL, fiL, reL, caL);
}

function renderAssetPieChart(eqL, fiL, reL, caL) {
  const pieEl = document.getElementById('assetPieChart');
  if (!pieEl) return;
  const ctx = pieEl.getContext('2d');
  if (charts.assetPie) charts.assetPie.destroy();

  charts.assetPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Equity', 'Fixed Income', 'Real Estate', 'Cash Balance'],
      datasets: [
        {
          label: 'Asset Value',
          data: [eqL * 100000, fiL * 100000, reL * 100000, caL * 100000],
          backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#0ea5e9'],
        },
      ],
    },
    options: {
      plugins: {
        tooltip: {
          callbacks: {
            label: (item) => `${formatInrCompact(item.raw)}`,
          },
        },
      },
    },
  });
}

// ==================== STEP 3: INCOME CATEGORIES ====================
function parseIncrementRange(rawStr) {
  const str = String(rawStr || '').trim();
  const matches = str.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return { minPct: 0, maxPct: 0, rangeStr: '' };
  }
  if (matches.length >= 2) {
    const a = parseFloat(matches[0]) || 0;
    const b = parseFloat(matches[1]) || 0;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.max(lo, Math.max(a, b));
    return { minPct: lo, maxPct: hi, rangeStr: `${lo}-${hi}` };
  }
  const single = Math.max(0, parseFloat(matches[0]) || 0);
  return { minPct: single, maxPct: single, rangeStr: `${single}` };
}

function updateIncomeSettings() {
  state.job_monthly_income = Math.max(0, parseFloat(document.getElementById('jobIncomeInput').value) || 0);
  const baseAge = state.current_age || parseInt((document.getElementById('ageInput') || {}).value, 10) || 38;
  const rawAgeOrYrs = parseInt(document.getElementById('jobYearsInput').value, 10);
  if (isNaN(rawAgeOrYrs) || rawAgeOrYrs <= 0) {
    state.job_income_until_age = null;
    state.job_income_years = 0;
  } else if (rawAgeOrYrs > baseAge) {
    state.job_income_until_age = rawAgeOrYrs;
    state.job_income_years = rawAgeOrYrs - baseAge;
  } else {
    state.job_income_years = rawAgeOrYrs;
    state.job_income_until_age = baseAge + rawAgeOrYrs;
  }

  const parsedGrowth = parseIncrementRange(document.getElementById('jobGrowthInput').value);
  state.job_income_growth_pct = parsedGrowth.minPct;
  state.job_income_growth_max_pct = parsedGrowth.maxPct;
  state.job_income_growth_range = parsedGrowth.rangeStr;

  state.rental_monthly_income = Math.max(0, parseFloat(document.getElementById('rentalIncomeInput').value) || 0);
  state.other_passive_monthly_income = Math.max(0, parseFloat(document.getElementById('passiveIncomeInput').value) || 0);

  const activeJobMo = state.job_income_years > 0 ? state.job_monthly_income : 0;
  const totalMo = activeJobMo + state.rental_monthly_income + state.other_passive_monthly_income;
  const badge = document.getElementById('incomeSummaryBadge');
  if (badge) {
    badge.textContent = `Total Monthly Income: ${formatInrCompact(totalMo)}/mo (${formatInrCompact(totalMo * 12)}/yr)`;
  }
}

// ==================== STEP 4: MONTHLY SIPS (CONTINUE UNTIL END OF INCOME) ====================
function updateSipSettings() {
  state.equity_sip_monthly = Math.max(0, parseFloat(document.getElementById('eqSipInput').value) || 0);
  state.equity_sip_stepup_pct = Math.max(0, parseFloat(document.getElementById('eqSipStepupInput').value) || 0);
  state.fixed_income_sip_monthly = Math.max(0, parseFloat(document.getElementById('fiSipInput').value) || 0);
  state.fixed_income_sip_stepup_pct = Math.max(0, parseFloat(document.getElementById('fiSipStepupInput').value) || 0);
  const hasPassive = state.rental_monthly_income > 0 || state.other_passive_monthly_income > 0;
  const planYrs = Math.max(0, (state.life_expectancy || 90) - (state.current_age || 38));
  state.sip_years = hasPassive ? planYrs : state.job_income_years;

  const totalSipMo = state.equity_sip_monthly + state.fixed_income_sip_monthly;
  const badge = document.getElementById('sipSummaryBadge');
  if (badge) {
    badge.textContent = `Total Monthly SIP: ${formatInrCompact(totalSipMo)}/mo`;
  }
}

// ==================== STEP 5: EXPENSES, FUTURE GOALS (ONE-OFF & RECURRING) & CONFIG ====================
function switchExpenseFreq(freq) {
  const prev = state.expense_frequency;
  state.expense_frequency = freq;
  const btnMo = document.getElementById('btnFreqMonthly');
  const btnYr = document.getElementById('btnFreqAnnual');

  if (freq === 'monthly') {
    btnMo.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    btnYr.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    if (prev === 'annual' && state.expense_amount > 0) {
      state.expense_amount = Math.round(state.expense_amount / 12);
    }
  } else {
    btnYr.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    btnMo.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    if (prev === 'monthly' && state.expense_amount > 0) {
      state.expense_amount = Math.round(state.expense_amount * 12);
    }
  }
  updateExpense(state.expense_amount);
}

function updateExpense(val) {
  const amt = Math.max(0, parseFloat(val) || 0);
  state.expense_amount = amt;
  const errEl = document.getElementById('expenseValidationError');
  if (amt > 0) {
    document.getElementById('expenseInput').value = amt;
    if (errEl) errEl.classList.add('hidden');
  } else {
    document.getElementById('expenseInput').value = '';
  }

  const mo = state.expense_frequency === 'monthly' ? amt : amt / 12;
  const yr = state.expense_frequency === 'annual' ? amt : amt * 12;
  document.getElementById('expenseSummaryBadge').textContent = `${formatInrCompact(mo)}/mo (${formatInrCompact(yr)}/yr)`;
}

function updateExpenseVariance(val) {
  const v = Math.max(0, Math.min(100, parseFloat(val) || 0));
  state.global_variance_pct = v;
  state.expense_variance_pct = v;
  state.random_expense_variance_pct = v;
  const gSlider = document.getElementById('globalVarianceSlider');
  if (gSlider) gSlider.value = v;
  updateExpense(state.expense_amount);
}

function _resolveInputToAge(rawVal, baseAge, defaultAge) {
  const str = String(rawVal !== undefined && rawVal !== null ? rawVal : '').trim();
  if (str === '') return defaultAge;
  const num = parseInt(str, 10);
  if (isNaN(num) || num < 0) return defaultAge;
  return num >= baseAge ? num : baseAge + num;
}

function syncGoalFormDefaults(forceStartToCurrentAge = false) {
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;
  const yEl = document.getElementById('newKnownYears');
  const sEl = document.getElementById('newKnownStartYear');
  const eEl = document.getElementById('newKnownEndYear');
  const nEl = document.getElementById('newKnownEveryNYears');

  if (yEl && (yEl.value === '' || forceStartToCurrentAge)) yEl.value = String(baseAge);
  if (sEl && (sEl.value === '' || forceStartToCurrentAge)) sEl.value = String(baseAge);
  if (eEl && (eEl.value === '' || parseInt(eEl.value, 10) < baseAge)) eEl.value = String(planEndAge);
  if (nEl && nEl.value === '') nEl.value = '3';
}

function computeGoalOccurrences(item) {
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;
  const planEndOffset = Math.max(1, planEndAge - baseAge);
  if (!item.is_recurring) {
    if (item.start_age !== undefined && item.start_age !== null) {
      return [Math.max(0, item.start_age - baseAge)];
    }
    return [item.years_from_now !== undefined ? item.years_from_now : item.start_year || 0];
  }
  const sAge =
    item.start_age !== undefined && item.start_age !== null
      ? Math.max(baseAge, parseInt(item.start_age, 10) || baseAge)
      : baseAge + Math.max(0, parseInt(item.start_year, 10) || 0);
  let eAge = planEndAge;
  if (item.end_age !== undefined && item.end_age !== null && item.end_age !== '') {
    eAge = Math.max(sAge, parseInt(item.end_age, 10) || planEndAge);
  } else if (item.end_year !== undefined && item.end_year !== null && item.end_year !== '') {
    const rawEYr = parseInt(item.end_year, 10);
    eAge = Math.max(sAge, rawEYr >= baseAge ? rawEYr : baseAge + Math.min(planEndOffset, rawEYr));
  }
  const step = Math.max(1, parseInt(item.every_n_years, 10) || 3);
  const yrs = [];
  for (let age = sAge; age <= eAge; age += step) {
    yrs.push(Math.max(0, age - baseAge));
  }
  return yrs;
}

function setGoalFormMode(isRecurring) {
  const prevRecurring = state.goal_form_is_recurring;
  state.goal_form_is_recurring = Boolean(isRecurring);
  const btnOne = document.getElementById('btnGoalModeOneOff');
  const btnRec = document.getElementById('btnGoalModeRecurring');
  const oneBox = document.getElementById('oneOffYearBox');
  const recBox = document.getElementById('recurringFieldsBox');
  const yEl = document.getElementById('newKnownYears');
  const sEl = document.getElementById('newKnownStartYear');

  // Carry over Start Age between One-Off and Recurring without resetting entered values
  if (!prevRecurring && state.goal_form_is_recurring && yEl && sEl && yEl.value !== '') {
    sEl.value = yEl.value;
  } else if (prevRecurring && !state.goal_form_is_recurring && yEl && sEl && sEl.value !== '') {
    yEl.value = sEl.value;
  }

  if (state.goal_form_is_recurring) {
    if (btnRec) btnRec.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    if (btnOne) btnOne.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    if (oneBox) oneBox.classList.add('hidden');
    if (recBox) recBox.classList.remove('hidden');
  } else {
    if (btnOne) btnOne.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    if (btnRec) btnRec.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    if (recBox) recBox.classList.add('hidden');
    if (oneBox) oneBox.classList.remove('hidden');
  }
  syncGoalFormDefaults();
  updateGoalRepeatPreview();
}

const QUICK_GOAL_LABELS = ['Education', 'Marriage', 'Vehicle', 'Home Improvement', 'Vacation'];

function selectGoalQuickLabel(tag, isRecurring, lakhs, variancePct, startYr, endYr, everyNYrs) {
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;
  state.selected_goal_quick_label = tag;
  document.getElementById('newKnownTag').value = tag;

  // Highlight the selected quick label chip; preserve any values already entered by the user
  QUICK_GOAL_LABELS.forEach((lbl) => {
    const chipEl = document.getElementById(`goalChip_${lbl}`);
    if (chipEl) {
      chipEl.className = lbl === tag ? 'goal-chip goal-chip-active' : 'goal-chip';
    }
  });

  if (lakhs !== undefined) document.getElementById('newKnownLakhs').value = lakhs;
  if (startYr !== undefined) {
    const resolvedStartAge = _resolveInputToAge(startYr, baseAge, baseAge);
    document.getElementById('newKnownYears').value = String(resolvedStartAge);
    const sEl = document.getElementById('newKnownStartYear');
    if (sEl) sEl.value = String(resolvedStartAge);
  }
  if (endYr !== undefined) {
    const resolvedEndAge = endYr !== '' ? _resolveInputToAge(endYr, baseAge, planEndAge) : planEndAge;
    const eEl = document.getElementById('newKnownEndYear');
    if (eEl) eEl.value = String(resolvedEndAge);
  }
  if (everyNYrs !== undefined) {
    const nEl = document.getElementById('newKnownEveryNYears');
    if (nEl) nEl.value = String(everyNYrs);
  }
  if (variancePct !== undefined && variancePct > 0) {
    state.global_variance_pct = variancePct;
  }
  const targetMode = typeof isRecurring === 'boolean' ? isRecurring : state.goal_form_is_recurring;
  setGoalFormMode(targetMode);
}

function updateGoalRepeatPreview() {
  const previewEl = document.getElementById('goalRepeatPreview');
  if (!previewEl) return;

  // IMPORTANT: Never overwrite Start Age / End Age inputs during oninput (fixes mobile editing!)
  const tag = (document.getElementById('newKnownTag').value || '').trim();
  const rawLakhs = parseFloat(document.getElementById('newKnownLakhs').value);
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;

  // Hide preview by default until both a label and a positive amount are entered
  if (!tag || isNaN(rawLakhs) || rawLakhs <= 0) {
    previewEl.textContent = '';
    previewEl.classList.add('hidden');
    return;
  }

  previewEl.classList.remove('hidden');
  const amtStr = formatInrCompact(rawLakhs * 100000);

  if (!state.goal_form_is_recurring) {
    const targetAge = _resolveInputToAge(document.getElementById('newKnownYears').value, baseAge, baseAge);
    const yrsFromNow = Math.max(0, targetAge - baseAge);
    const startDesc =
      yrsFromNow === 0
        ? `starts immediately at Age ${targetAge}`
        : `starts in ${yrsFromNow} ${yrsFromNow === 1 ? 'year' : 'years'} at Age ${targetAge}`;
    previewEl.textContent = `📌 ${tag}: One-off expense of ${amtStr} (today's ₹) — ${startDesc} (1 time). Click "+ Add Goal" to save.`;
  } else {
    const startAge = _resolveInputToAge((document.getElementById('newKnownStartYear') || {}).value, baseAge, baseAge);
    const endAge = Math.max(
      startAge,
      _resolveInputToAge((document.getElementById('newKnownEndYear') || {}).value, baseAge, planEndAge)
    );
    const step = Math.max(1, parseInt((document.getElementById('newKnownEveryNYears') || {}).value, 10) || 3);
    const yrs = computeGoalOccurrences({
      is_recurring: true,
      start_age: startAge,
      end_age: endAge,
      every_n_years: step,
    });
    const count = yrs.length;
    const yrsFromNow = Math.max(0, startAge - baseAge);
    const timingDesc =
      yrsFromNow === 0
        ? `starts immediately at Age ${startAge} and repeats between Age ${startAge} and Age ${endAge}`
        : `starts in ${yrsFromNow} ${yrsFromNow === 1 ? 'year' : 'years'} between Age ${startAge} and Age ${endAge}`;
    previewEl.textContent = `🔁 ${tag}: ${timingDesc}, every ${step} ${step === 1 ? 'year' : 'years'} (${count} ${count === 1 ? 'time' : 'times'} total) • ${amtStr} each time. Click "+ Add Goal" to save.`;
  }
}

function renderKnownExpensesList() {
  const container = document.getElementById('knownExpensesList');
  if (!container) return;

  if (!state.known_future_expenses.length) {
    container.innerHTML = `<span class="text-[11px] text-slate-500 italic">No planned future expenses added yet (optional). Select a category above to add one.</span>`;
    return;
  }

  const baseAge = state.current_age || 38;
  container.innerHTML = state.known_future_expenses
    .map((item, idx) => {
      const occ = computeGoalOccurrences(item);
      const count = occ.length;
      if (item.is_recurring) {
        const sAge = baseAge + occ[0];
        const eAge = baseAge + occ[occ.length - 1];
        const yrsFromNow = Math.max(0, sAge - baseAge);
        const startText =
          yrsFromNow === 0
            ? `starts immediately at Age ${sAge} (Age ${sAge}–${eAge})`
            : `starts in ${yrsFromNow} ${yrsFromNow === 1 ? 'yr' : 'yrs'} between Age ${sAge} and Age ${eAge}`;
        return `
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs">
            <span class="font-bold text-emerald-300">🔁 ${item.event_tag}</span>
            <span class="text-slate-200 font-semibold">${startText}, every ${item.every_n_years} yrs (${count}x)</span>
            <span class="font-extrabold text-white">${formatInrCompact(item.amount_today_inr)} today</span>
            <button type="button" onclick="removeKnownExpense(${idx})"
              class="ml-1 text-slate-400 hover:text-rose-400 font-bold" title="Remove Goal">✕</button>
          </div>
        `;
      }
      const targetAge = item.start_age !== undefined && item.start_age !== null ? item.start_age : baseAge + (item.years_from_now || 0);
      const yrsFromNow = Math.max(0, targetAge - baseAge);
      const startText =
        yrsFromNow === 0
          ? `starts immediately at Age ${targetAge}`
          : `starts in ${yrsFromNow} ${yrsFromNow === 1 ? 'yr' : 'yrs'} at Age ${targetAge}`;
      return `
        <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-950/70 border border-indigo-500/40 text-xs">
          <span class="font-bold text-indigo-300">🎯 ${item.event_tag}</span>
          <span class="text-slate-300">${startText} (1x)</span>
          <span class="font-extrabold text-white">${formatInrCompact(item.amount_today_inr)} today</span>
          <button type="button" onclick="removeKnownExpense(${idx})"
            class="ml-1 text-slate-400 hover:text-rose-400 font-bold" title="Remove Goal">✕</button>
        </div>
      `;
    })
    .join('');
}

function addKnownExpenseFromInputs() {
  const tag = (document.getElementById('newKnownTag').value || 'Planned Goal').trim();
  const lakhs = Math.max(0.1, parseFloat(document.getElementById('newKnownLakhs').value) || 5);
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;
  const dupWarn = document.getElementById('goalDuplicateWarning');
  if (dupWarn) dupWarn.classList.add('hidden');

  let newItem;
  if (!state.goal_form_is_recurring) {
    const targetAge = Math.max(baseAge, _resolveInputToAge(document.getElementById('newKnownYears').value, baseAge, baseAge));
    const years = Math.max(1, Math.min(75, targetAge - baseAge || 1));
    newItem = {
      event_tag: tag,
      amount_today_inr: Math.round(lakhs * 100000),
      is_recurring: false,
      years_from_now: years,
      start_year: years,
      end_year: years,
      start_age: targetAge,
      end_age: targetAge,
      every_n_years: 1,
      variance_pct: 0,
    };
  } else {
    const varPct = Math.max(0, Math.min(100, state.global_variance_pct !== undefined ? state.global_variance_pct : 10));
    const startAge = Math.max(baseAge, _resolveInputToAge((document.getElementById('newKnownStartYear') || {}).value, baseAge, baseAge));
    const endAge = Math.max(
      startAge,
      _resolveInputToAge((document.getElementById('newKnownEndYear') || {}).value, baseAge, planEndAge)
    );
    const step = Math.max(1, Math.min(30, parseInt((document.getElementById('newKnownEveryNYears') || {}).value, 10) || 3));
    const sYr = Math.max(1, Math.min(75, startAge - baseAge || 1));
    const eYr = Math.max(sYr, Math.min(75, endAge - baseAge || sYr));
    newItem = {
      event_tag: tag,
      amount_today_inr: Math.round(lakhs * 100000),
      is_recurring: true,
      years_from_now: sYr,
      start_year: sYr,
      end_year: eYr,
      start_age: startAge,
      end_age: endAge,
      every_n_years: step,
      variance_pct: varPct,
    };
  }

  // Warn and prevent adding duplicate future expenses
  const isDuplicate = state.known_future_expenses.some(
    (ex) =>
      String(ex.event_tag || '').trim().toLowerCase() === newItem.event_tag.toLowerCase() &&
      Boolean(ex.is_recurring) === Boolean(newItem.is_recurring) &&
      (ex.start_age || baseAge + (ex.start_year || 0)) === newItem.start_age
  );
  if (isDuplicate) {
    if (dupWarn) dupWarn.classList.remove('hidden');
    alert(`Duplicate goal detected: "${newItem.event_tag}" at Age ${newItem.start_age} is already added.`);
    return;
  }

  state.known_future_expenses.push(newItem);
  state.known_future_expenses.sort((a, b) => (a.start_age || a.start_year || 0) - (b.start_age || b.start_year || 0));
  renderKnownExpensesList();

  // Clear label, amount, chip highlight & preview after adding so user knows it was saved
  document.getElementById('newKnownTag').value = '';
  document.getElementById('newKnownLakhs').value = '';
  state.selected_goal_quick_label = '';
  QUICK_GOAL_LABELS.forEach((lbl) => {
    const chipEl = document.getElementById(`goalChip_${lbl}`);
    if (chipEl) chipEl.className = 'goal-chip';
  });
  updateGoalRepeatPreview();
}

function addPresetKnownExpense(tag, years, lakhs, isRecurring = false, variancePct = 0, endYear = null, everyNYears = 1) {
  state.known_future_expenses.push({
    event_tag: tag,
    amount_today_inr: Math.round(lakhs * 100000),
    is_recurring: Boolean(isRecurring),
    years_from_now: years,
    start_year: years,
    end_year: endYear || years,
    every_n_years: everyNYears,
    variance_pct: variancePct,
  });
  state.known_future_expenses.sort((a, b) => (a.start_year || a.years_from_now) - (b.start_year || b.years_from_now));
  renderKnownExpensesList();
}

function removeKnownExpense(index) {
  state.known_future_expenses.splice(index, 1);
  renderKnownExpensesList();
}

function toggleAdvancedDrawer() {
  const drawer = document.getElementById('advancedDrawer');
  const arrow = document.getElementById('advArrow');
  drawer.classList.toggle('hidden');
  arrow.classList.toggle('rotate-180');
}

function updateAdvSettings() {
  state.lifestyle_inflation_rate = parseFloat(document.getElementById('lifeInfSlider').value) || 0;
  const minPlanAge = (state.current_age || 38) + 5;
  state.life_expectancy = Math.max(
    minPlanAge,
    parseInt(document.getElementById('targetAgeSlider').value, 10) || 90
  );

  const taxSlider = document.getElementById('taxDragSlider');
  if (taxSlider) {
    state.tax_drag_rate = parseFloat(taxSlider.value) || 10.0;
  }
  const targetSrSlider = document.getElementById('targetSuccessRateSlider');
  if (targetSrSlider) {
    state.target_success_rate_pct = Math.max(50, Math.min(99, parseFloat(targetSrSlider.value) || 85));
  }
  const targetSrValEl = document.getElementById('targetSuccessRateValText');
  if (targetSrValEl) targetSrValEl.textContent = state.target_success_rate_pct;
  const globalVarSlider = document.getElementById('globalVarianceSlider');
  if (globalVarSlider && globalVarSlider.value !== '') {
    state.global_variance_pct = Math.max(0, Math.min(100, parseFloat(globalVarSlider.value) || 0));
  }
  state.expense_variance_pct = state.global_variance_pct;
  state.random_expense_variance_pct = state.global_variance_pct;
  state.known_future_expenses.forEach((ev) => {
    if (ev.is_recurring) ev.variance_pct = state.global_variance_pct;
  });

  state.rebalance_enabled = document.getElementById('rebalanceEnabledChk').checked;
  state.rebalance_frequency_years = parseInt(document.getElementById('rebalanceFreqSlider').value, 10) || 2;
  const passiveInfSlider = document.getElementById('passiveInfFreqSlider');
  if (passiveInfSlider) {
    state.passive_income_inflation_interval_years = Math.max(1, parseInt(passiveInfSlider.value, 10) || 3);
  }
  const passiveInfText = document.getElementById('passiveInfFreqText');
  if (passiveInfText) {
    passiveInfText.textContent = state.passive_income_inflation_interval_years;
  }

  state.random_expense_enabled = document.getElementById('randExpEnabledChk').checked;
  const randLakhs = Math.max(0, parseFloat(document.getElementById('randExpBaseLakhsInput').value) || 0);
  state.random_expense_base_inr = Math.round(randLakhs * 100000);
  state.random_expense_annual_probability_pct = Math.max(
    0,
    Math.min(100, parseFloat(document.getElementById('randExpProbInput').value) || 0)
  );

  const propModeEl = document.getElementById('propModeSelect');
  if (propModeEl && propModeEl.value) {
    state.property_mode = propModeEl.value;
  }
  state.sampling_method = document.getElementById('samplingSelect').value || 'iid_bootstrap';
  state.num_simulations = parseInt(document.getElementById('numSimsSelect').value, 10) || 2500;

  document.getElementById('lifeInfValText').textContent = state.lifestyle_inflation_rate.toFixed(2);
  document.getElementById('targetAgeValText').textContent = state.life_expectancy;
  const taxValEl = document.getElementById('taxDragValText');
  if (taxValEl) taxValEl.textContent = state.tax_drag_rate.toFixed(1);
  const gVarTextEl = document.getElementById('globalVarValText');
  if (gVarTextEl) gVarTextEl.textContent = state.global_variance_pct;
  const gVarTipEl = document.getElementById('globalVarTooltipPct');
  if (gVarTipEl) gVarTipEl.textContent = state.global_variance_pct;
  const advGVarEl = document.getElementById('advSummaryGlobalVar');
  if (advGVarEl) advGVarEl.textContent = `±${state.global_variance_pct}%`;
  document.getElementById('rebalanceFreqText').textContent = state.rebalance_frequency_years;

  const advTaxEl = document.getElementById('advSummaryTaxDrag');
  if (advTaxEl) advTaxEl.textContent = `${state.tax_drag_rate.toFixed(1)}%`;
  document.getElementById('advSummaryRebal').textContent = state.rebalance_enabled
    ? `Every ${state.rebalance_frequency_years} yrs`
    : 'Off';
  document.getElementById('advSummaryLife').textContent = `+${state.lifestyle_inflation_rate.toFixed(2)}%`;
  const advAgeEl = document.getElementById('advSummaryTargetAge');
  if (advAgeEl) advAgeEl.textContent = state.life_expectancy;

  syncGoalFormDefaults();
  renderKnownExpensesList();
  updateGoalRepeatPreview();
}

function resetAdvSettings() {
  const defaultTargetAge = Math.max(90, (state.current_age || 38) + 5);
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('taxDragSlider', '10.0');
  setVal('globalVarianceSlider', '10');
  const rebChk = document.getElementById('rebalanceEnabledChk');
  if (rebChk) rebChk.checked = true;
  setVal('rebalanceFreqSlider', '2');
  setVal('passiveInfFreqSlider', '3');
  setVal('lifeInfSlider', '0.5');
  setVal('targetAgeSlider', String(defaultTargetAge));
  setVal('targetSuccessRateSlider', '85');
  const randChk = document.getElementById('randExpEnabledChk');
  if (randChk) randChk.checked = true;
  setVal('randExpBaseLakhsInput', state.has_medical_insurance === false ? '5.0' : '2.0');
  setVal('randExpProbInput', '15');
  setVal('samplingSelect', 'iid_bootstrap');
  setVal('numSimsSelect', '2500');
  updateAdvSettings();
}

// ==================== RUN HISTORICAL SIMULATIONS (DECODE MY FINANCIAL OUTLOOK) ====================
async function triggerSimulationRun() {
  if (!isStep1Complete()) {
    const err1 = document.getElementById('step1ValidationError');
    if (err1) err1.classList.remove('hidden');
    alert('Please answer Current Age and Medical Insurance coverage in Step 1 before proceeding.');
    returnToWizard(1);
    return;
  }
  const effectiveAge = state.current_age;
  const effectiveMedIns = state.has_medical_insurance;
  const effectiveExpense = state.expense_amount || parseFloat(document.getElementById('expenseInput').value) || 0;
  if (effectiveExpense <= 0) {
    const errEl = document.getElementById('expenseValidationError');
    if (errEl) errEl.classList.remove('hidden');
    alert('Please enter your living expenses in Step 5 before running the simulation.');
    returnToWizard(5);
    return;
  }
  const totalLakhs = Math.max(0, state.corpus_lakhs);

  document.getElementById('wizardContainer').classList.add('hidden');
  document.getElementById('resultsContainer').classList.add('hidden');
  const progressBox = document.getElementById('simulationProgressBox');
  progressBox.classList.remove('hidden');

  const bar = document.getElementById('simProgressBar');
  const ticker = document.getElementById('simTickerYears');
  const title = document.getElementById('simProgressTitle');

  bar.style.width = '15%';
  title.textContent = `Decoding Your Financial Outlook Across ${state.num_simulations.toLocaleString()} Market Scenarios...`;

  const curYr = new Date().getFullYear() - 1;
  const sampleYearsPool = Array.from({ length: 20 }, (_, i) => curYr - 19 + i);

  let progressPct = 20;
  const animInterval = setInterval(() => {
    progressPct = Math.min(92, progressPct + 18);
    bar.style.width = `${progressPct}%`;
    const drawn = Array.from({ length: 6 }, () => sampleYearsPool[Math.floor(Math.random() * sampleYearsPool.length)]);
    ticker.textContent = `Sampling last 20 yrs of Indian market history: ${drawn.join(' → ')}...`;
  }, 110);

  const eqVal = Math.max(0, state.equity_lakhs * 100000);
  const fiVal = Math.max(0, state.fixed_income_lakhs * 100000);
  const reVal = Math.max(0, state.real_estate_lakhs * 100000);
  const caVal = Math.max(0, state.cash_lakhs * 100000);

  const payload = {
    current_age: effectiveAge,
    life_expectancy: Math.max(effectiveAge + 5, state.life_expectancy),
    target_success_rate_pct: state.target_success_rate_pct,
    has_medical_insurance: effectiveMedIns,
    equity_value: eqVal,
    fixed_income_value: fiVal,
    real_estate_value: reVal,
    cash_value: caVal,
    total_corpus: totalLakhs * 100000,
    job_monthly_income: state.job_monthly_income,
    job_income_years: state.job_income_years,
    job_income_until_age: state.job_income_until_age,
    job_income_growth_pct: state.job_income_growth_pct,
    job_income_growth_max_pct: state.job_income_growth_max_pct,
    job_income_growth_range: state.job_income_growth_range || null,
    rental_monthly_income: state.rental_monthly_income,
    other_passive_monthly_income: state.other_passive_monthly_income,
    passive_income_inflation_interval_years: state.passive_income_inflation_interval_years,
    equity_sip_monthly: state.equity_sip_monthly,
    equity_sip_stepup_pct: state.equity_sip_stepup_pct,
    fixed_income_sip_monthly: state.fixed_income_sip_monthly,
    fixed_income_sip_stepup_pct: state.fixed_income_sip_stepup_pct,
    sip_years: null,
    expense_amount: effectiveExpense,
    expense_frequency: state.expense_frequency,
    expense_variance_pct: state.global_variance_pct,
    global_variance_pct: state.global_variance_pct,
    lifestyle_inflation_rate: state.lifestyle_inflation_rate,
    post_retirement_expense_multiplier: 100.0,
    property_mode: state.property_mode,
    property_rental_yield: 0.0,
    property_liquidation_haircut: 10.0,
    tax_drag_rate: state.tax_drag_rate,
    rebalance_enabled: state.rebalance_enabled,
    rebalance_frequency_years: state.rebalance_frequency_years,
    random_expense_enabled: state.random_expense_enabled,
    random_expense_base_inr: state.random_expense_base_inr,
    random_expense_variance_pct: state.random_expense_variance_pct,
    random_expense_annual_probability_pct: state.random_expense_annual_probability_pct,
    known_future_expenses: state.known_future_expenses,
    num_simulations: state.num_simulations,
    sampling_method: state.sampling_method,
    use_historical_inflation_volatility: true,
    seed: null,
  };

  try {
    const [res] = await Promise.all([
      fetch('/api/v1/simulators/wealth-longevity/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      new Promise((resolve) => setTimeout(resolve, 480)),
    ]);

    clearInterval(animInterval);
    bar.style.width = '100%';

    if (!res.ok) {
      const err = await res.json();
      alert('Simulation Error: ' + JSON.stringify(err.detail || err));
      returnToWizard(5);
      return;
    }

    const data = await res.json();
    state.result = data;

    progressBox.classList.add('hidden');
    document.getElementById('resultsContainer').classList.remove('hidden');
    document.getElementById('headerRestartBtn').classList.remove('hidden');
    renderSimulationResults(data);
  } catch (e) {
    clearInterval(animInterval);
    console.error(e);
    returnToWizard(5);
  }
}

// ==================== RENDER VISUAL RESULTS ====================
function renderSimulationResults(data) {
  const { inputs_summary, simulation_meta, retirement_readiness } = data;

  document.getElementById('summaryPillAge').textContent = `Age ${inputs_summary.current_age} → ${inputs_summary.life_expectancy}`;
  document.getElementById('summaryPillCorpus').textContent = `Total Wealth: ${inputs_summary.total_corpus_formatted}`;
  const liqPct = inputs_summary.liquid_pct !== undefined ? inputs_summary.liquid_pct : (100 - inputs_summary.allocation.property_pct);
  document.getElementById('summaryPillSplit').textContent = `${liqPct}% Liquid / ${inputs_summary.allocation.property_pct}% Property`;
  document.getElementById('summaryPillExpense').textContent = `${inputs_summary.monthly_expense_formatted}/mo`;

  const medPill = document.getElementById('summaryPillMedIns');
  if (medPill) {
    medPill.textContent = inputs_summary.has_medical_insurance ? '🏥 Health Cover: Yes' : '⚠️ Health Cover: No';
    medPill.className = inputs_summary.has_medical_insurance
      ? 'px-2.5 py-1 rounded-lg bg-slate-800 text-teal-300 font-semibold'
      : 'px-2.5 py-1 rounded-lg bg-rose-950 text-rose-300 border border-rose-500/30 font-semibold';
  }
  document.getElementById('summaryPillSeed').textContent = `Sample #${simulation_meta.seed_used}`;

  const defaultSelectedAge =
    retirement_readiness && retirement_readiness.evaluated_retirement_age !== undefined
      ? retirement_readiness.evaluated_retirement_age
      : inputs_summary.current_age;
  state.selected_retirement_age = defaultSelectedAge;

  applyOutcomeViewForAge(defaultSelectedAge);
  scrollToPageTop();
}

function applyOutcomeViewForAge(age) {
  const data = state.result;
  if (!data) return;

  const { inputs_summary, retirement_readiness } = data;
  const maxSimYrs = inputs_summary.max_simulated_years;
  const targetYrs = inputs_summary.target_horizon_years;

  const outcomesMap = (retirement_readiness && retirement_readiness.outcomes_by_age) || {};
  const ageOutcome = outcomesMap[String(age)];

  if (ageOutcome) {
    data.verdict = ageOutcome.verdict || data.verdict;
    data.longevity_stats = ageOutcome.longevity_stats || data.longevity_stats;
    data.trajectories = ageOutcome.trajectories || data.trajectories;
    data.chart_events = ageOutcome.chart_events || data.chart_events;
    data.survival_curve = ageOutcome.survival_curve || data.survival_curve;
    data.notable_runs = ageOutcome.notable_runs || data.notable_runs;
  }

  const { verdict, longevity_stats } = data;

  // Verdict & Success Rate
  const badge = document.getElementById('resVerdictBadge');
  badge.textContent = verdict.badge;
  const badgeStyle = {
    strong: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    financial_freedom: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    ahead_of_plan: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    on_track: 'bg-sky-500/20 text-teal-300 border-emerald-500/40',
    needs_attention: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    action_required: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    retire_ready: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    borderline: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    at_risk: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    shortfall: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  };
  badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${badgeStyle[verdict.status] || badgeStyle.borderline}`;

  // Single Crisp Outcome Card + Status-Synced Chance Label (Consistent with Badge Color)
  const lifeExp = inputs_summary.life_expectancy;
  const cardTheme = {
    strong: { box: 'bg-emerald-500/15 border-2 border-emerald-500/50', label: 'text-emerald-300' },
    financial_freedom: { box: 'bg-emerald-500/15 border-2 border-emerald-500/50', label: 'text-emerald-300' },
    ahead_of_plan: { box: 'bg-emerald-500/15 border-2 border-emerald-500/50', label: 'text-emerald-300' },
    retire_ready: { box: 'bg-emerald-500/15 border-2 border-emerald-500/50', label: 'text-emerald-300' },
    on_track: { box: 'bg-sky-500/20 border-2 border-emerald-500/50', label: 'text-teal-300' },
    needs_attention: { box: 'bg-amber-500/15 border-2 border-amber-500/40', label: 'text-amber-300' },
    borderline: { box: 'bg-amber-500/15 border-2 border-amber-500/40', label: 'text-amber-300' },
    action_required: { box: 'bg-rose-950/30 border-2 border-rose-500/40', label: 'text-rose-300' },
    shortfall: { box: 'bg-rose-950/30 border-2 border-rose-500/40', label: 'text-rose-300' },
    at_risk: { box: 'bg-rose-950/30 border-2 border-rose-500/40', label: 'text-rose-300' },
  };
  const theme = cardTheme[verdict.status] || cardTheme.borderline;

  const simCountEl = document.getElementById('resSimCountLabel');
  if (simCountEl) {
    simCountEl.textContent = `${longevity_stats.success_probability_pct}% chance your wealth lasts to age ${lifeExp}`;
    simCountEl.className = `text-xs font-extrabold ${theme.label}`;
  }
  document.getElementById('resHeadline').textContent = verdict.headline;
  document.getElementById('resRecommendation').textContent = verdict.recommendation;

  const resolveVerdictAge = (k, rawAge) => {
    const verdictAge = k === 'p50' ? verdict.yy_age : verdict.zz_age;
    if (verdictAge !== undefined && verdictAge !== null && String(verdictAge).trim() !== '') {
      return String(verdictAge);
    }
    return rawAge > lifeExp ? `${lifeExp}+` : String(Math.round(rawAge));
  };

  const yyAge = resolveVerdictAge('p50', longevity_stats.depletion_ages.p50);
  const zzAge = resolveVerdictAge('p10', longevity_stats.depletion_ages.p10);

  const lonCard = document.getElementById('wealthLongevityCard');
  const lonLabel = document.getElementById('cardLongevityLabel');
  const lonAge = document.getElementById('cardLongevityAge');
  const lonSub = document.getElementById('cardLongevitySub');

  if (lonCard) {
    lonCard.className = `${theme.box} rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left`;
  }
  if (lonLabel) {
    lonLabel.className = `text-[11px] font-bold uppercase tracking-wider ${theme.label} block`;
  }
  if (lonAge) {
    lonAge.textContent = zzAge === yyAge ? `Age ${zzAge}` : `Age ${zzAge} – ${yyAge}`;
  }
  if (lonSub) {
    if (zzAge === yyAge && zzAge.endsWith('+')) {
      lonSub.textContent = 'Sustains past your plan horizon even in a downturn';
    } else if (zzAge === yyAge) {
      lonSub.textContent = '';
    } else {
      lonSub.textContent = '';
    }
  }

  // Render Wealth Trajectory Chart & Year-by-Year Table
  renderSpaghettiAndPercentileChart();
  populateNotableRunsDropdown(data);
}

function setCurveFocus(mode) {
  state.curve_focus = mode;
  const btnBoth = document.getElementById('btnFocusBoth');
  const btnP50 = document.getElementById('btnFocusP50');
  const btnP10 = document.getElementById('btnFocusP10');
  const activeCls = 'px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-600 text-white';
  const idleCls = 'px-2.5 py-1 text-xs font-semibold rounded-md text-slate-400 hover:text-white';

  if (btnBoth) btnBoth.className = mode === 'both' ? activeCls : idleCls;
  if (btnP50) btnP50.className = mode === 'p50' ? activeCls : idleCls;
  if (btnP10) btnP10.className = mode === 'p10' ? activeCls : idleCls;

  renderSpaghettiAndPercentileChart();
}

function switchChartScale(scale) {
  state.chart_scale = scale;
  const btnReal = document.getElementById('btnScaleReal');
  const btnNom = document.getElementById('btnScaleNom');
  if (scale === 'real') {
    btnReal.className = 'px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-600 text-white';
    btnNom.className = 'px-2.5 py-1 text-xs font-semibold rounded-md text-slate-400 hover:text-white';
  } else {
    btnNom.className = 'px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-600 text-white';
    btnReal.className = 'px-2.5 py-1 text-xs font-semibold rounded-md text-slate-400 hover:text-white';
  }
  renderSpaghettiAndPercentileChart();
}

// ==================== CHART 1: MOST LIKELY vs WORST CASE WITH SEPARATE TOOLTIPS ====================
function renderSpaghettiAndPercentileChart() {
  const data = state.result;
  if (!data) return;

  const ctx = document.getElementById('spaghettiChart').getContext('2d');
  const isReal = state.chart_scale === 'real';
  const focus = state.curve_focus || 'both';
  const showP50 = focus === 'both' || focus === 'p50';
  const showP10 = focus === 'both' || focus === 'p10';

  const traj = isReal ? data.trajectories.real : data.trajectories.nominal;
  const chartEvents = data.chart_events || { events_by_age: {}, events_by_age_p50: {}, events_by_age_p10: {}, known_expense_ages: [] };
  const eventsByAgeP50 = chartEvents.events_by_age_p50 || chartEvents.events_by_age || {};
  const eventsByAgeP10 = chartEvents.events_by_age_p10 || chartEvents.events_by_age || {};

  if (charts.spaghetti) charts.spaghetti.destroy();

  let endIdx = traj.ages.length;
  const findLastNonZeroIndex = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] > 100) return i;
    }
    return 0;
  };

  if (showP10 && !showP50) {
    const lastPos = findLastNonZeroIndex(traj.p10);
    endIdx = Math.min(traj.ages.length, Math.max(8, lastPos + 3));
  } else if (showP50 && !showP10) {
    const lastPos = findLastNonZeroIndex(traj.p50);
    endIdx = Math.min(traj.ages.length, Math.max(8, lastPos + 3));
  } else {
    const lastPos = Math.max(findLastNonZeroIndex(traj.p50), findLastNonZeroIndex(traj.p10));
    endIdx = Math.min(traj.ages.length, Math.max(8, lastPos + 3));
  }

  const agesSlice = traj.ages.slice(0, endIdx);
  const labels = agesSlice.map((a) => `Age ${a}`);
  const p50Slice = traj.p50.slice(0, endIdx);
  const p10Slice = traj.p10.slice(0, endIdx);

  const visibleValues = [];
  if (showP50) visibleValues.push(...p50Slice);
  if (showP10) visibleValues.push(...p10Slice);
  const peakVal = Math.max(...visibleValues, 100000);
  const yAxisMax = Math.ceil((peakVal * 1.12) / 500000) * 500000;

  const datasets = [
    {
      label: 'Most Likely (Typical Market)',
      caseKey: 'p50',
      data: p50Slice,
      hidden: !showP50,
      borderColor: '#6366f1',
      backgroundColor: showP10 ? 'rgba(99, 102, 241, 0.14)' : 'rgba(99, 102, 241, 0.18)',
      borderWidth: 3.5,
      pointRadius: 0,
      pointBackgroundColor: '#6366f1',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1.5,
      pointHoverRadius: 7,
      fill: showP10 ? '+1' : 'origin',
      tension: 0.25,
      order: 1,
    },
    {
      label: 'Worst Case',
      caseKey: 'p10',
      data: p10Slice,
      hidden: !showP10,
      borderColor: '#f43f5e',
      backgroundColor: 'rgba(244, 63, 94, 0.16)',
      borderWidth: 3.5,
      borderDash: showP50 ? [6, 4] : [],
      pointRadius: 0,
      pointBackgroundColor: '#f43f5e',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1.5,
      pointHoverRadius: 7,
      fill: 'origin',
      tension: 0.25,
      order: 1,
    },
  ];

  charts.spaghetti = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#e2e8f0',
            font: { size: 12, weight: '600' },
            usePointStyle: true,
          },
          onClick: (_e, legendItem) => {
            const idx = legendItem.datasetIndex;
            const curFocus = state.curve_focus || 'both';
            let p50Vis = curFocus === 'both' || curFocus === 'p50';
            let p10Vis = curFocus === 'both' || curFocus === 'p10';

            if (idx === 0) p50Vis = !p50Vis;
            if (idx === 1) p10Vis = !p10Vis;

            if (!p50Vis && !p10Vis) {
              if (idx === 0) p50Vis = true;
              else p10Vis = true;
            }

            if (p50Vis && p10Vis) setCurveFocus('both');
            else if (p50Vis) setCurveFocus('p50');
            else setCurveFocus('p10');
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          borderColor: '#334155',
          borderWidth: 1,
          callbacks: {
            label: (ctxItem) => `${ctxItem.dataset.label}: ${formatInrCompact(ctxItem.raw)}`,
            afterBody: (items) => {
              if (!items || !items.length) return [];
              const activeItem = items[0];
              const dataIdx = activeItem.dataIndex;
              const age = agesSlice[dataIdx];
              const isP10 = activeItem.dataset && activeItem.dataset.caseKey === 'p10';
              const evMap = isP10 ? eventsByAgeP10 : eventsByAgeP50;
              const caseTitle = isP10 ? 'Worst Case' : 'Most Likely';
              const evList = evMap[String(age)] || [];
              if (!evList.length) return [];
              return ['', `${caseTitle} Events at Age ${age}:`, ...evList.map((e) => `  • ${e}`)];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
          ticks: { color: '#94a3b8', maxTicksLimit: 12, font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          max: yAxisMax,
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (v) => formatInrCompact(v, 1),
          },
        },
      },
    },
  });
}

// ==================== YEAR-BY-YEAR RUN INSPECTOR (EVENTS COLUMN + ON-DEMAND FULL MATH AUDIT) ====================
function populateNotableRunsDropdown(data) {
  const select = document.getElementById('notableRunSelect');
  const runs = data.notable_runs || [];
  const inp = data.inputs_summary || {};
  const curAge = inp.current_age || 38;
  const targetAge = inp.life_expectancy || 90;
  const maxSimYrs = inp.max_simulated_years || 60;

  const filtered = runs
    .map((r, idx) => ({ r, idx }))
    .filter(
      ({ r }) =>
        r.case_key === 'p50' ||
        r.case_key === 'p10' ||
        r.case_key === 'random1' ||
        r.label.startsWith('P50') ||
        r.label.startsWith('P10') ||
        r.label.startsWith('Most Likely') ||
        r.label.startsWith('Worst Case') ||
        r.label.startsWith('Random')
    );

  select.innerHTML = filtered
    .map(({ r, idx }) => {
      const ageLabel =
        r.years_lasted >= maxSimYrs - 0.5
          ? `Lasts past ${targetAge}+`
          : `Lasts until ${Math.round(curAge + r.years_lasted)}`;
      const isDefault = r.case_key === 'p50' || r.label.startsWith('P50') || r.label.startsWith('Most Likely');
      return `<option value="${idx}" ${isDefault ? 'selected' : ''}>${r.label} (${ageLabel})</option>`;
    })
    .join('');
  renderRunInspectorTable();
}

function renderRunInspectorTable() {
  const data = state.result;
  if (!data || !data.notable_runs) return;

  const idx = parseInt(document.getElementById('notableRunSelect').value, 10) || 0;
  const run = data.notable_runs[idx];
  const tbody = document.getElementById('runInspectorTableBody');

  if (!run || !run.year_log) {
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = run.year_log
    .map((row, rowIdx) => {
      const startLiq = row.start_liquid_corpus !== undefined ? row.start_liquid_corpus : row.start_corpus || 0;
      const endLiq = row.end_liquid_corpus !== undefined ? row.end_liquid_corpus : row.end_corpus_nominal || row.end_corpus_real || 0;
      const endLiqReal = row.end_liquid_corpus_real !== undefined ? row.end_liquid_corpus_real : row.end_corpus_real || endLiq;

      const jobVal = row.job_income || 0;
      const rentVal = row.rental_income || 0;
      const passVal = row.passive_income || 0;
      const inflowsVal = row.inflows_total !== undefined ? row.inflows_total : row.income_received || 0;

      const baseExpVal = row.base_living_expense !== undefined ? row.base_living_expense : row.withdrawal || 0;
      const knownVal = row.known_event_expense || 0;
      const shockVal = row.random_shock_expense || 0;
      const homeImpVal = row.home_improvement_expense || 0;
      const sipVal = row.sip_contributed || 0;
      const taxVal = row.total_tax_paid !== undefined ? row.total_tax_paid : (row.withdrawal_tax_paid || 0) + (row.rebalance_tax_paid || 0);
      const outflowsVal =
        row.outflows_total !== undefined
          ? row.outflows_total
          : (row.withdrawal || baseExpVal) + sipVal + taxVal;

      const capGainVal = row.capital_gains_nominal || 0;
      const cgColor = capGainVal >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const cgSign = capGainVal >= 0 ? '+' : '';
      const propLiqVal = row.property_liquidated_inflow || 0;
      const eventsText = row.combined_events_summary || row.special_events_summary || '—';

      // Tooltip 1: Inflows Breakup
      const inflowLines = [];
      if (jobVal > 0) inflowLines.push(`Job / Business: ${formatInrCompact(jobVal)}`);
      if (rentVal > 0) inflowLines.push(`Rental Income: ${formatInrCompact(rentVal)}`);
      if (passVal > 0) inflowLines.push(`Other Passive: ${formatInrCompact(passVal)}`);
      if (!inflowLines.length) inflowLines.push('No active income this year');
      const inflowTip = `Inflows Breakup:\n${inflowLines.join('\n')}`;

      // Tooltip 2: Outflows Breakup (Expenses + SIPs + Tax Drag)
      const outflowLines = [`Living Expenses: ${formatInrCompact(baseExpVal)}`];
      if (knownVal > 0) outflowLines.push(`Planned Goals: ${formatInrCompact(knownVal)}`);
      if (shockVal > 0) outflowLines.push(`Emergency Shock: ${formatInrCompact(shockVal)}`);
      if (homeImpVal > 0) outflowLines.push(`Home Improvement: ${formatInrCompact(homeImpVal)}`);
      if (sipVal > 0) {
        outflowLines.push(`SIPs Invested: ${formatInrCompact(sipVal)}`);
      }
      if (taxVal > 0) {
        outflowLines.push(`Tax Drag Paid: ${formatInrCompact(taxVal)}`);
      }
      const outflowTip = `Outflows Breakup:\n${outflowLines.join('\n')}`;

      // Tooltip 3: Capital Gains (Unrealized Gains / Losses) & Market Returns Breakup
      const cgLines = [
        `Market Year: ${row.sampled_india_year}`,
        `Equity Return: ${row.equity_return_pct >= 0 ? '+' : ''}${row.equity_return_pct}%`,
        `Fixed Income Return: +${row.debt_return_pct}%`,
        `Inflation (CPI): ${row.inflation_pct}%`,
      ];
      if (row.rebalance_activity && row.rebalance_activity !== '—') {
        cgLines.push(`Rebalancing: ${row.rebalance_activity}`);
      }
      const cgTip = `Unrealized Gains / Losses:\n${cgLines.join('\n')}`;

      // Tooltip 4: Exact Step-by-Step Row Reconciliation Math (Start -> End Liquid Corpus)
      const mathLines = [
        `How Age ${row.age} Liquid Corpus Changed:`,
        `Start Liquid Corpus: ${formatInrCompact(startLiq)}`,
        `+ Inflows: +${formatInrCompact(inflowsVal)}`,
        `- Outflows (Exp + SIPs + Tax Drag): -${formatInrCompact(outflowsVal)}`,
      ];
      if (sipVal > 0) mathLines.push(`+ SIPs Added to Corpus: +${formatInrCompact(sipVal)}`);
      if (propLiqVal > 0) mathLines.push(`+ Property Liquidated: +${formatInrCompact(propLiqVal)}`);
      mathLines.push(`± Capital Gains: ${cgSign}${formatInrCompact(capGainVal)}`);
      mathLines.push(`= Ending Liquid Corpus: ${formatInrCompact(endLiq)}`);
      mathLines.push(`(In Today's ₹ Value: ${formatInrCompact(endLiqReal)})`);
      const rowMathTip = mathLines.join('\n');

      return `
        <tr class="hover:bg-slate-800/40" title="${rowMathTip.replace(/\n/g, ' | ')}">
          <td data-label="Age (Mkt Yr)" class="py-2.5 px-2.5">
            <span class="font-bold text-white">Age ${row.age}</span>
            <span class="text-[10px] font-mono text-indigo-300 block">Mkt Yr ${row.sampled_india_year}</span>
          </td>
          <td data-label="Starting Liquid Corpus" class="py-2.5 px-2.5 font-semibold text-slate-200">
            ${formatInrCompact(startLiq)}
          </td>
          <td data-label="Inflows" class="py-2.5 px-2.5">
            <span class="cell-tip-wrap ${inflowsVal > 0 ? 'text-emerald-300 font-semibold' : 'text-slate-500'}" tabindex="0">
              <span>${inflowsVal > 0 ? '+' + formatInrCompact(inflowsVal) : '₹0'}</span>
              <span class="cell-tip-box">${inflowTip}</span>
            </span>
          </td>
          <td data-label="Outflows" class="py-2.5 px-2.5">
            <span class="cell-tip-wrap text-amber-300 font-semibold" tabindex="0">
              <span>-${formatInrCompact(outflowsVal)}</span>
              <span class="cell-tip-box">${outflowTip}</span>
            </span>
          </td>
          <td data-label="Capital Gains" class="py-2.5 px-2.5">
            <span class="cell-tip-wrap font-bold ${cgColor}" tabindex="0">
              <span>${cgSign}${formatInrCompact(capGainVal)}</span>
              <span class="cell-tip-box">${cgTip}</span>
            </span>
          </td>
          <td data-label="Ending Liquid Corpus" class="py-2.5 px-2.5">
            <span class="cell-tip-wrap cell-tip-right font-extrabold text-white" tabindex="0">
              <span>${formatInrCompact(endLiq)}</span>
              <span class="text-[10px] text-indigo-300 font-normal">ⓘ</span>
              <span class="cell-tip-box">${rowMathTip}</span>
            </span>
          </td>
          <td data-label="Events" class="py-2.5 px-2.5 text-[11px] ${eventsText !== '—' ? 'text-amber-200 font-medium' : 'text-slate-500'}">
            ${eventsText}
          </td>
          <td data-label="Full Calculation" class="py-2.5 px-2.5">
            <button type="button" id="yearMathBtn_${rowIdx}" onclick="toggleYearMathRow(${rowIdx})"
              class="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/30 border border-indigo-500/40 text-[11px] font-bold text-indigo-300 transition">
              Math ▸
            </button>
          </td>
        </tr>
        <tr id="yearMathRow_${rowIdx}" class="hidden year-math-inline-row">
          <td colspan="8" class="p-3 sm:p-4 bg-slate-950/90">
            <div id="yearMathContent_${rowIdx}"></div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function buildYearMathHtml(row, rowIdx) {
  const startLiq = row.start_liquid_corpus !== undefined ? row.start_liquid_corpus : row.start_corpus || 0;
  const startCash = row.start_cash || 0;
  const startFi = row.start_fi || 0;
  const startEq = row.start_eq || 0;
  const endLiq = row.end_liquid_corpus !== undefined ? row.end_liquid_corpus : row.end_corpus_nominal || 0;
  const endLiqReal = row.end_liquid_corpus_real !== undefined ? row.end_liquid_corpus_real : row.end_corpus_real || endLiq;
  const endCash = row.end_cash || 0;
  const endFi = row.end_fi || 0;
  const endEq = row.end_eq || 0;

  const jobVal = row.job_income || 0;
  const rentVal = row.rental_income || 0;
  const passVal = row.passive_income || 0;
  const inflowsVal = row.inflows_total !== undefined ? row.inflows_total : row.income_received || 0;

  const baseExpVal = row.base_living_expense !== undefined ? row.base_living_expense : row.withdrawal || 0;
  const knownVal = row.known_event_expense || 0;
  const shockVal = row.random_shock_expense || 0;
  const homeImpVal = row.home_improvement_expense || 0;
  const totalExpenses = row.withdrawal !== undefined ? row.withdrawal : baseExpVal + knownVal + shockVal + homeImpVal;

  const cashReserve = row.cash_reserve_floor || 0;
  const bankPaid = row.bank_paid_expenses || 0;
  const fiGross = row.withdrawn_fi_gross || 0;
  const eqGross = row.withdrawn_eq_gross || 0;
  const wTax = row.withdrawal_tax_paid || 0;
  const rTax = row.rebalance_tax_paid || 0;
  const totTax = row.total_tax_paid !== undefined ? row.total_tax_paid : wTax + rTax;
  const eqSip = row.eq_sip || 0;
  const fiSip = row.fi_sip || 0;
  const sipVal = row.sip_contributed || 0;
  const outflowsVal = row.outflows_total !== undefined ? row.outflows_total : totalExpenses + sipVal + totTax;
  const propLiqVal = row.property_liquidated_inflow || 0;

  const liqBeforeRet = row.liquid_before_returns !== undefined ? row.liquid_before_returns : Math.max(0, endLiq - (row.capital_gains_nominal || 0));
  const eqCg = row.eq_cap_gains || 0;
  const fiCg = row.fi_cap_gains || 0;
  const cashCg = row.cash_cap_gains || 0;
  const capGainVal = row.capital_gains_nominal || 0;
  const cpiFactor = row.cumulative_cpi_factor || 1;
  const eventsText = row.combined_events_summary || 'No special events this year';

  const fmtSigned = (v) => `${v >= 0 ? '+' : ''}${formatInrCompact(v)}`;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-indigo-400 block">Full Calculation Audit</span>
          <span class="text-xs sm:text-sm font-extrabold text-white">Age ${row.age} • Year ${row.sim_year} (India Mkt Yr ${row.sampled_india_year})</span>
        </div>
        <button type="button" onclick="toggleYearMathRow(${rowIdx})"
          class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 hover:text-white shrink-0 transition">
          ✕ Collapse
        </button>
      </div>

      <div class="year-math-grid">
        <div class="year-math-card space-y-1.5">
          <div class="year-math-line border-b border-slate-800 pb-1">
            <span class="year-math-lbl font-bold text-indigo-300 uppercase text-[10px] tracking-wider">1. Opening Liquid Corpus</span>
            <span class="year-math-val font-extrabold text-white">${formatInrCompact(startLiq)}</span>
          </div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Bank Cash (Reserve: ${formatInrCompact(cashReserve)})</span><span class="year-math-val">${formatInrCompact(startCash)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Fixed Income</span><span class="year-math-val">${formatInrCompact(startFi)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Equity</span><span class="year-math-val">${formatInrCompact(startEq)}</span></div>
          <div class="year-math-line text-white font-bold pt-1 border-t border-slate-800/80"><span class="year-math-lbl">= Starting Liquid Corpus</span><span class="year-math-val">${formatInrCompact(startLiq)}</span></div>
        </div>

        <div class="year-math-card space-y-1.5">
          <div class="year-math-line border-b border-slate-800 pb-1">
            <span class="year-math-lbl font-bold text-emerald-400 uppercase text-[10px] tracking-wider">2. Inflows (To Bank)</span>
            <span class="year-math-val font-extrabold text-emerald-300">+${formatInrCompact(inflowsVal)}</span>
          </div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Job / Business Income</span><span class="year-math-val">+${formatInrCompact(jobVal)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Rental Income</span><span class="year-math-val">+${formatInrCompact(rentVal)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Other Passive Income</span><span class="year-math-val">+${formatInrCompact(passVal)}</span></div>
          <div class="year-math-line text-emerald-300 font-bold pt-1 border-t border-slate-800/80"><span class="year-math-lbl">= Total Inflows</span><span class="year-math-val">+${formatInrCompact(inflowsVal)}</span></div>
        </div>

        <div class="year-math-card space-y-1.5">
          <div class="year-math-line border-b border-slate-800 pb-1">
            <span class="year-math-lbl font-bold text-amber-400 uppercase text-[10px] tracking-wider">3. Outflows & Waterfall</span>
            <span class="year-math-val font-extrabold text-amber-300">-${formatInrCompact(outflowsVal)}</span>
          </div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Base Living Expenses</span><span class="year-math-val">${formatInrCompact(baseExpVal)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Planned Future Goals</span><span class="year-math-val">${formatInrCompact(knownVal)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Emergency Shock</span><span class="year-math-val">${formatInrCompact(shockVal)}</span></div>
          ${homeImpVal > 0 ? `<div class="year-math-line text-slate-300"><span class="year-math-lbl">Home Improvement</span><span class="year-math-val">${formatInrCompact(homeImpVal)}</span></div>` : ''}
          <div class="year-math-line text-slate-200 font-semibold pt-1 border-t border-slate-800/60"><span class="year-math-lbl">Subtotal: Expenses</span><span class="year-math-val">${formatInrCompact(totalExpenses)}</span></div>
          <div class="year-math-line text-slate-400"><span class="year-math-lbl">• Paid from Excess Bank Cash</span><span class="year-math-val">${formatInrCompact(bankPaid)}</span></div>
          <div class="year-math-line text-slate-400"><span class="year-math-lbl">• Fixed Income Redeemed (Gross)</span><span class="year-math-val">${formatInrCompact(fiGross)}</span></div>
          <div class="year-math-line text-slate-400"><span class="year-math-lbl">• Equity Redeemed (Gross)</span><span class="year-math-val">${formatInrCompact(eqGross)}</span></div>
          ${propLiqVal > 0 ? `<div class="year-math-line text-emerald-300"><span class="year-math-lbl">• Property Liquidated Inflow</span><span class="year-math-val">+${formatInrCompact(propLiqVal)}</span></div>` : ''}
          <div class="year-math-line text-slate-300 pt-1 border-t border-slate-800/60"><span class="year-math-lbl">SIPs from Excess Cash (Eq ${formatInrCompact(eqSip)} + FI ${formatInrCompact(fiSip)})</span><span class="year-math-val">${formatInrCompact(sipVal)}</span></div>
          <div class="year-math-line text-slate-300"><span class="year-math-lbl">Tax Drag (W/D ${formatInrCompact(wTax)} + Rebal ${formatInrCompact(rTax)})</span><span class="year-math-val">${formatInrCompact(totTax)}</span></div>
          <div class="year-math-line text-amber-300 font-bold pt-1 border-t border-slate-800/80"><span class="year-math-lbl">= Total Outflows</span><span class="year-math-val">-${formatInrCompact(outflowsVal)}</span></div>
        </div>

        <div class="space-y-2.5">
          <div class="year-math-card space-y-1.5">
            <div class="year-math-line border-b border-slate-800 pb-1">
              <span class="year-math-lbl font-bold text-emerald-400 uppercase text-[10px] tracking-wider">4. Market Returns (Capital Gains)</span>
              <span class="year-math-val font-extrabold ${capGainVal >= 0 ? 'text-emerald-300' : 'text-rose-400'}">${fmtSigned(capGainVal)}</span>
            </div>
            <div class="year-math-line text-slate-300"><span class="year-math-lbl">Remaining Corpus Before Returns</span><span class="year-math-val">${formatInrCompact(liqBeforeRet)}</span></div>
            <div class="year-math-line text-slate-300"><span class="year-math-lbl">Equity (${row.equity_return_pct >= 0 ? '+' : ''}${row.equity_return_pct}%)</span><span class="year-math-val">${fmtSigned(eqCg)}</span></div>
            <div class="year-math-line text-slate-300"><span class="year-math-lbl">Fixed Income (+${row.debt_return_pct}%)</span><span class="year-math-val">${fmtSigned(fiCg)}</span></div>
            <div class="year-math-line text-slate-300"><span class="year-math-lbl">Cash Inflation Adj (CPI ${row.inflation_pct}%)</span><span class="year-math-val">${fmtSigned(cashCg)}</span></div>
            <div class="year-math-line font-bold pt-1 border-t border-slate-800/80 ${capGainVal >= 0 ? 'text-emerald-300' : 'text-rose-400'}"><span class="year-math-lbl">= Capital Gains</span><span class="year-math-val">${fmtSigned(capGainVal)}</span></div>
          </div>

          <div class="year-math-card space-y-1">
            <span class="font-bold text-indigo-300 uppercase text-[10px] tracking-wider block">5. Events & Rebalancing</span>
            <div class="text-[11px] text-amber-200">${eventsText}</div>
          </div>
        </div>
      </div>

      <div class="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-3 space-y-1.5">
        <div class="year-math-line border-b border-indigo-500/30 pb-1">
          <span class="year-math-lbl font-bold text-white uppercase text-[10px] tracking-wider">6. Exact Reconciliation (Start → End)</span>
          <span class="year-math-val font-extrabold text-white">${formatInrCompact(endLiq)}</span>
        </div>
        <div class="year-math-line text-slate-200"><span class="year-math-lbl">Starting Liquid Corpus</span><span class="year-math-val">${formatInrCompact(startLiq)}</span></div>
        <div class="year-math-line text-emerald-300"><span class="year-math-lbl">+ Inflows</span><span class="year-math-val">+${formatInrCompact(inflowsVal)}</span></div>
        <div class="year-math-line text-amber-300"><span class="year-math-lbl">− Outflows (Exp + SIPs + Tax Drag)</span><span class="year-math-val">-${formatInrCompact(outflowsVal)}</span></div>
        ${sipVal > 0 ? `<div class="year-math-line text-indigo-300"><span class="year-math-lbl">+ SIPs Added to Eq/FI Corpus</span><span class="year-math-val">+${formatInrCompact(sipVal)}</span></div>` : ''}
        ${propLiqVal > 0 ? `<div class="year-math-line text-emerald-300"><span class="year-math-lbl">+ Property Liquidated</span><span class="year-math-val">+${formatInrCompact(propLiqVal)}</span></div>` : ''}
        <div class="year-math-line ${capGainVal >= 0 ? 'text-emerald-300' : 'text-rose-400'}"><span class="year-math-lbl">± Capital Gains</span><span class="year-math-val">${fmtSigned(capGainVal)}</span></div>
        <div class="year-math-line text-white font-extrabold pt-1 border-t border-indigo-500/40"><span class="year-math-lbl">= Ending Liquid Corpus (Cash ${formatInrCompact(endCash)} + FI ${formatInrCompact(endFi)} + Eq ${formatInrCompact(endEq)})</span><span class="year-math-val">${formatInrCompact(endLiq)}</span></div>
        <div class="year-math-line text-slate-400"><span class="year-math-lbl">In Today's ₹ (÷ ${cpiFactor.toFixed(2)}× inflation)</span><span class="year-math-val">${formatInrCompact(endLiqReal)}</span></div>
      </div>

      <div class="flex justify-end">
        <button type="button" onclick="toggleYearMathRow(${rowIdx})"
          class="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 hover:text-white transition">
          ▲ Collapse Age ${row.age} Math
        </button>
      </div>
    </div>
  `;
}

function toggleYearMathRow(rowIdx) {
  const data = state.result;
  if (!data || !data.notable_runs) return;
  const runIdx = parseInt(document.getElementById('notableRunSelect').value, 10) || 0;
  const run = data.notable_runs[runIdx];
  if (!run || !run.year_log || !run.year_log[rowIdx]) return;

  const detailRow = document.getElementById(`yearMathRow_${rowIdx}`);
  const contentEl = document.getElementById(`yearMathContent_${rowIdx}`);
  const btnEl = document.getElementById(`yearMathBtn_${rowIdx}`);
  if (!detailRow || !contentEl) return;

  const isCurrentlyHidden = detailRow.classList.contains('hidden');
  if (isCurrentlyHidden) {
    contentEl.innerHTML = buildYearMathHtml(run.year_log[rowIdx], rowIdx);
    detailRow.classList.remove('hidden');
    if (btnEl) btnEl.textContent = 'Hide ▾';
  } else {
    detailRow.classList.add('hidden');
    if (btnEl) btnEl.textContent = 'Math ▸';
  }
}

// ==================== MODULE / SCREEN SWITCHING ====================
const expenseState = {
  lastFile: null,
  result: null,
  activeCategoryFilter: 'all',
  categoryChart: null,
  monthlyTrendChart: null,
};

function switchAppScreen(screenId) {
  const wealthScreen = document.getElementById('screenWealthLongevity');
  const expenseScreen = document.getElementById('screenExpenseAnalyzer');
  const tabWealth = document.getElementById('navTabWealthLongevity');
  const tabExpense = document.getElementById('navTabExpenseAnalyzer');
  const restartBtn = document.getElementById('headerRestartBtn');

  const activeCls = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition bg-indigo-600 text-white shadow';
  const idleCls = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition text-slate-400 hover:text-white';

  if (screenId === 'expense_analyzer') {
    wealthScreen.classList.add('hidden');
    expenseScreen.classList.remove('hidden');
    tabWealth.className = idleCls;
    tabExpense.className = activeCls;
    restartBtn.classList.add('hidden');
  } else {
    expenseScreen.classList.add('hidden');
    wealthScreen.classList.remove('hidden');
    tabWealth.className = activeCls;
    tabExpense.className = idleCls;
    if (state.result && document.getElementById('wizardContainer').classList.contains('hidden')) {
      restartBtn.classList.remove('hidden');
    }
  }
}

async function syncActiveModulesNav() {
  try {
    const res = await fetch('/api/v1/modules');
    if (!res.ok) return;
    const data = await res.json();
    const activeIds = new Set((data.active_modules || []).map((m) => m.id));
    const tabWealth = document.getElementById('navTabWealthLongevity');
    const tabExpense = document.getElementById('navTabExpenseAnalyzer');
    if (tabWealth && !activeIds.has('wealth_longevity')) tabWealth.classList.add('hidden');
    if (tabExpense && !activeIds.has('expense_analyzer')) tabExpense.classList.add('hidden');
  } catch (e) {
    console.error('Could not sync active modules:', e);
  }
}

// ==================== SCREEN 2: BANK STATEMENT EXPENSE ANALYZER ====================
function setupDropZone() {
  const dropZone = document.getElementById('dropZoneLabel');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach((evtName) => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('border-indigo-500', 'bg-slate-900');
    });
  });

  ['dragleave', 'drop'].forEach((evtName) => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('border-indigo-500', 'bg-slate-900');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadAndAnalyzeStatementFile(files[0]);
    }
  });
}

function handleStatementFileSelected(inputEl) {
  if (inputEl.files && inputEl.files.length > 0) {
    uploadAndAnalyzeStatementFile(inputEl.files[0]);
  }
}

function reRunCurrentStatementIfLoaded() {
  if (expenseState.lastFile) {
    uploadAndAnalyzeStatementFile(expenseState.lastFile);
  }
}

async function uploadAndAnalyzeStatementFile(file) {
  expenseState.lastFile = file;
  document.getElementById('selectedFileLabel').textContent = `Analyzing "${file.name}"...`;

  const errBox = document.getElementById('expenseUploadError');
  errBox.classList.add('hidden');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('include_emis_in_expenses', document.getElementById('chkIncludeEmis').checked);
  formData.append('include_investments_in_expenses', document.getElementById('chkIncludeInvestments').checked);

  try {
    const res = await fetch('/api/v1/analyzers/expense-analyzer/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.detail || 'Could not analyze bank statement.';
      errBox.classList.remove('hidden');
      document.getElementById('selectedFileLabel').textContent = 'Click to choose a Bank Statement or drag & drop here';
      return;
    }
    document.getElementById('selectedFileLabel').textContent = `Loaded: ${file.name} (Click or drop to upload another)`;
    expenseState.result = data;
    renderExpenseAnalysisResults(data);
  } catch (err) {
    errBox.textContent = `Upload failed: ${err.message}`;
    errBox.classList.remove('hidden');
  }
}

function renderExpenseAnalysisResults(data) {
  const container = document.getElementById('expenseResultsContainer');
  container.classList.remove('hidden');

  const { discovered_schema, summary, category_breakdown, monthly_trend } = data;
  const cols = discovered_schema.columns_discovered;

  const headerInfo = discovered_schema.header_row_number
    ? `Header Row #${discovered_schema.header_row_number}`
    : 'Headerless Grid';
  document.getElementById('schemaDiscoveryText').innerHTML =
    `<b>${headerInfo}</b> • Date: <code>${cols.date}</code> • Narration: <code>${cols.description}</code> • Outflow: <code>${cols.debit_or_amount}</code>` +
    (cols.balance_ignored ? ` • Ignored Balance: <code>${cols.balance_ignored}</code>` : '');

  document.getElementById('schemaRowsSummary').textContent =
    `${discovered_schema.extracted_debit_rows} outflows classified • ${discovered_schema.skipped_credit_rows} inflows skipped`;

  document.getElementById('expTileMonthly').textContent = `${summary.estimated_monthly_expense_exact} / mo`;
  document.getElementById('expTileAnnual').textContent =
    `Compact: ${summary.estimated_monthly_expense_formatted}/mo • Annualized: ${summary.estimated_annual_expense_formatted}/yr`;

  document.getElementById('expTileMonthsCount').textContent =
    `${summary.num_months_detected} ${summary.num_months_detected === 1 ? 'Month' : 'Months'} (${summary.months_list.join(', ')})`;
  document.getElementById('expTileTotalPeriod').textContent =
    `Total living spend across statement: ${summary.total_living_expenses_formatted} (${summary.total_transactions_classified} debits)`;

  document.getElementById('expTileInvestments').textContent =
    `${summary.estimated_monthly_investments_formatted} / mo`;

  renderExpenseCategoryChart(category_breakdown);
  renderExpenseMonthlyTrendChart(monthly_trend);

  const grid = document.getElementById('expenseCategoryCardsGrid');
  grid.innerHTML = category_breakdown
    .map((cat) => {
      const tagBadge = cat.is_living_expense
        ? `<span class="text-xs font-bold text-slate-300">${cat.share_of_expenses_pct}% of spend</span>`
        : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Investment / SIP</span>`;
      return `
        <button type="button" onclick="filterTransactionsByCategory('${cat.category_id}')"
          class="text-left bg-slate-950/80 hover:bg-slate-800/70 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-4 transition flex flex-col justify-between">
          <div class="flex items-center justify-between gap-2 w-full">
            <span class="text-xs font-bold text-white flex items-center gap-2">
              <span class="text-base">${cat.icon}</span>
              <span>${cat.label}</span>
            </span>
            ${tagBadge}
          </div>
          <div class="mt-3 flex items-baseline justify-between w-full">
            <div>
              <span class="text-lg font-extrabold text-white">${cat.monthly_inr_exact}<span class="text-xs font-normal text-slate-400">/mo</span></span>
            </div>
            <span class="text-[11px] text-slate-400">${cat.transaction_count} txns (${cat.total_formatted} total)</span>
          </div>
        </button>
      `;
    })
    .join('');

  const filterSelect = document.getElementById('txnCategoryFilterSelect');
  filterSelect.innerHTML =
    `<option value="all">All Categories (${data.transactions.length} lines)</option>` +
    category_breakdown
      .map(
        (c) =>
          `<option value="${c.category_id}">${c.icon} ${c.label} (${c.transaction_count} lines • ${c.monthly_formatted}/mo)</option>`
      )
      .join('');

  filterTransactionsByCategory('all');
}

function renderExpenseCategoryChart(categories) {
  const ctx = document.getElementById('expenseCategoryChart').getContext('2d');
  if (expenseState.categoryChart) expenseState.categoryChart.destroy();

  const livingCats = categories.filter((c) => c.is_living_expense);
  const displayCats = livingCats.length > 0 ? livingCats : categories;

  expenseState.categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: displayCats.map((c) => `${c.icon} ${c.label}`),
      datasets: [
        {
          label: 'Monthly Average (₹)',
          data: displayCats.map((c) => c.monthly_average),
          backgroundColor: displayCats.map((c) => c.color),
          borderRadius: 6,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `Monthly Avg: ${formatInrCompact(item.raw)} (${displayCats[item.dataIndex].share_of_expenses_pct}%)`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => formatInrCompact(v, 1) },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#f1f5f9', font: { size: 11, weight: '600' } },
        },
      },
    },
  });
}

function renderExpenseMonthlyTrendChart(monthlyTrend) {
  const ctx = document.getElementById('expenseMonthlyTrendChart').getContext('2d');
  if (expenseState.monthlyTrendChart) expenseState.monthlyTrendChart.destroy();

  expenseState.monthlyTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthlyTrend.map((m) => m.month),
      datasets: [
        {
          label: 'Living Expenses (₹)',
          data: monthlyTrend.map((m) => m.living_expense),
          backgroundColor: '#6366f1',
          borderRadius: 6,
        },
        {
          label: 'Investments / SIPs (₹)',
          data: monthlyTrend.map((m) => m.investments),
          backgroundColor: '#10b981',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatInrCompact(item.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => formatInrCompact(v, 1) },
        },
      },
    },
  });
}

function filterTransactionsByCategory(categoryId) {
  expenseState.activeCategoryFilter = categoryId;
  const select = document.getElementById('txnCategoryFilterSelect');
  if (select && select.value !== categoryId) {
    select.value = categoryId;
  }

  const data = expenseState.result;
  if (!data || !data.transactions) return;

  const filtered =
    categoryId === 'all'
      ? data.transactions
      : data.transactions.filter((t) => t.category_id === categoryId);

  const tbody = document.getElementById('expenseTransactionsTableBody');
  tbody.innerHTML = filtered
    .map(
      (t) => `
      <tr class="hover:bg-slate-800/40">
        <td class="py-2.5 px-3 font-mono text-slate-300">${t.date}</td>
        <td class="py-2.5 px-3 text-white font-medium">${t.description}</td>
        <td class="py-2.5 px-3 text-right font-bold text-white">${t.amount_formatted}</td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border border-slate-700 bg-slate-950 text-slate-200">
            <span>${t.category_icon}</span>
            <span>${t.category_label}</span>
          </span>
        </td>
        <td class="py-2.5 px-3 text-slate-400">
          <span>${t.matched_cue}</span>
          <span class="ml-1 text-[10px] font-mono text-indigo-400">(${Math.round(t.confidence * 100)}%)</span>
        </td>
      </tr>
    `
    )
    .join('');
}

window.addEventListener('DOMContentLoaded', () => {
  renderSplitUI();
  updateIncomeSettings();
  updateSipSettings();
  updateAdvSettings();
  setupDropZone();
  syncActiveModulesNav();
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    charts,
    expenseState,
    QA_PERSONAS,
    toggleQaPersonaPanel,
    applyQaPersona,
    formatInrCompact,
    isStep1Complete,
    syncGoalFormDefaults,
    goToStep,
    returnToWizard,
    updateAge,
    setMedicalInsurance,
    updateAssetValue,
    updateCorpusLakhs,
    updateSplit,
    renderSplitUI,
    renderAssetPieChart,
    updateIncomeSettings,
    parseIncrementRange,
    updateSipSettings,
    switchExpenseFreq,
    updateExpense,
    updateExpenseVariance,
    computeGoalOccurrences,
    setGoalFormMode,
    selectGoalQuickLabel,
    updateGoalRepeatPreview,
    renderKnownExpensesList,
    addKnownExpenseFromInputs,
    addPresetKnownExpense,
    removeKnownExpense,
    toggleAdvancedDrawer,
    updateAdvSettings,
    resetAdvSettings,
    triggerSimulationRun,
    renderSimulationResults,
    applyOutcomeViewForAge,
    setCurveFocus,
    switchChartScale,
    renderSpaghettiAndPercentileChart,
    populateNotableRunsDropdown,
    renderRunInspectorTable,
    buildYearMathHtml,
    toggleYearMathRow,
    switchAppScreen,
    syncActiveModulesNav,
    setupDropZone,
    handleStatementFileSelected,
    reRunCurrentStatementIfLoaded,
    uploadAndAnalyzeStatementFile,
    renderExpenseAnalysisResults,
    renderExpenseCategoryChart,
    renderExpenseMonthlyTrendChart,
    filterTransactionsByCategory,
  };
}
