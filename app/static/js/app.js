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
  job_income_growth_pct: 0,
  job_income_growth_max_pct: 0,
  job_income_growth_range: '',
  rental_monthly_income: 0,
  other_passive_monthly_income: 0,
  passive_income_inflation_interval_years: 1,

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
  selected_goal_quick_label: 'Education',
  goal_form_is_recurring: false,
  known_future_expenses: [],

  // Configuration Settings (Prefilled)
  life_expectancy: 90,
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
  retirementAge: null,
  spaghetti: null,
  survival: null,
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
      indEl.className = 'text-left p-3 rounded-xl border transition border-indigo-500 bg-indigo-500/10';
      indEl.querySelector('span:first-child').className = 'text-[11px] font-bold uppercase tracking-wider text-indigo-400 block';
      indEl.querySelector('span:last-child').className = 'text-xs font-semibold text-white';
    } else {
      stepEl.classList.add('hidden');
      indEl.className = 'text-left p-3 rounded-xl border transition border-slate-800 bg-slate-900/60 hover:border-slate-700';
      indEl.querySelector('span:first-child').className = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 block';
      indEl.querySelector('span:last-child').className = 'text-xs font-semibold text-slate-300';
    }
  });
  if (stepNum === 2) {
    renderSplitUI();
  } else if (stepNum === 5) {
    syncGoalFormDefaults();
    updateGoalRepeatPreview();
  }
}

function returnToWizard(stepNum = 1) {
  document.getElementById('resultsContainer').classList.add('hidden');
  document.getElementById('simulationProgressBox').classList.add('hidden');
  document.getElementById('headerRestartBtn').classList.add('hidden');
  document.getElementById('wizardContainer').classList.remove('hidden');
  goToStep(stepNum);
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

// ==================== STEP 2: INDIVIDUAL ASSET VALUES, PIE CHART & LIQUIDITY (0-5 CR SLIDER SCALE) ====================
function updateAssetValue(assetKey, rawVal) {
  const lakhs = Math.max(0, parseFloat(rawVal) || 0);
  if (assetKey === 'equity') {
    state.equity_lakhs = lakhs;
    document.getElementById('equityLakhsInput').value = lakhs || '';
    document.getElementById('equityLakhsSlider').value = Math.min(500, lakhs);
  } else if (assetKey === 'fixed_income') {
    state.fixed_income_lakhs = lakhs;
    document.getElementById('fiLakhsInput').value = lakhs || '';
    document.getElementById('fiLakhsSlider').value = Math.min(500, lakhs);
  } else if (assetKey === 'real_estate') {
    state.real_estate_lakhs = lakhs;
    document.getElementById('reLakhsInput').value = lakhs || '';
    document.getElementById('reLakhsSlider').value = Math.min(500, lakhs);
  } else if (assetKey === 'cash') {
    state.cash_lakhs = lakhs;
    document.getElementById('cashLakhsInput').value = lakhs || '';
    document.getElementById('cashLakhsSlider').value = Math.min(500, lakhs);
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
  const slider = document.getElementById('expenseSlider');

  if (freq === 'monthly') {
    btnMo.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    btnYr.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    slider.min = 15000;
    slider.max = 500000;
    slider.step = 5000;
    if (prev === 'annual' && state.expense_amount > 0) {
      state.expense_amount = Math.round(state.expense_amount / 12);
    }
  } else {
    btnYr.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    btnMo.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    slider.min = 180000;
    slider.max = 6000000;
    slider.step = 50000;
    if (prev === 'monthly' && state.expense_amount > 0) {
      state.expense_amount = Math.round(state.expense_amount * 12);
    }
  }
  updateExpense(state.expense_amount);
}

function updateExpense(val) {
  const amt = Math.max(0, parseFloat(val) || 0);
  state.expense_amount = amt;
  const slider = document.getElementById('expenseSlider');
  const errEl = document.getElementById('expenseValidationError');
  if (amt > 0) {
    slider.value = Math.min(parseFloat(slider.max), amt);
    document.getElementById('expenseInput').value = amt;
    if (errEl) errEl.classList.add('hidden');
  } else {
    document.getElementById('expenseInput').value = '';
  }

  const mo = state.expense_frequency === 'monthly' ? amt : amt / 12;
  const yr = state.expense_frequency === 'annual' ? amt : amt * 12;
  const varNote = state.expense_variance_pct > 0 ? ` (±${state.expense_variance_pct}%)` : '';
  document.getElementById('expenseSummaryBadge').textContent = `${formatInrCompact(mo)}/mo (${formatInrCompact(yr)}/yr)${varNote}`;
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
  state.goal_form_is_recurring = Boolean(isRecurring);
  const btnOne = document.getElementById('btnGoalModeOneOff');
  const btnRec = document.getElementById('btnGoalModeRecurring');
  const oneBox = document.getElementById('oneOffYearBox');
  const recBox = document.getElementById('recurringFieldsBox');

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

  // Highlight the selected quick label chip; all quick labels work with both One-Off and Recurring
  QUICK_GOAL_LABELS.forEach((lbl) => {
    const chipEl = document.getElementById(`goalChip_${lbl}`);
    if (chipEl) {
      chipEl.className = lbl === tag ? 'goal-chip goal-chip-active' : 'goal-chip';
    }
  });

  if (lakhs !== undefined) document.getElementById('newKnownLakhs').value = lakhs;
  const resolvedStartAge = startYr !== undefined ? _resolveInputToAge(startYr, baseAge, baseAge) : baseAge;
  const resolvedEndAge =
    endYr !== undefined && endYr !== '' ? _resolveInputToAge(endYr, baseAge, planEndAge) : planEndAge;
  document.getElementById('newKnownYears').value = String(resolvedStartAge);
  const sEl = document.getElementById('newKnownStartYear');
  const eEl = document.getElementById('newKnownEndYear');
  const nEl = document.getElementById('newKnownEveryNYears');
  if (sEl) sEl.value = String(resolvedStartAge);
  if (eEl) eEl.value = String(resolvedEndAge);
  if (nEl) nEl.value = String(everyNYrs !== undefined ? everyNYrs : 3);
  if (variancePct !== undefined && variancePct > 0) {
    state.global_variance_pct = variancePct;
  }
  const targetMode = typeof isRecurring === 'boolean' ? isRecurring : state.goal_form_is_recurring;
  setGoalFormMode(targetMode);
}

function updateGoalRepeatPreview() {
  const previewEl = document.getElementById('goalRepeatPreview');
  if (!previewEl) return;

  syncGoalFormDefaults();
  const tag = (document.getElementById('newKnownTag').value || '').trim();
  const rawLakhs = parseFloat(document.getElementById('newKnownLakhs').value);
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;

  const displayTag = tag || state.selected_goal_quick_label || 'Planned Expense';
  const amtStr = !isNaN(rawLakhs) && rawLakhs > 0 ? formatInrCompact(rawLakhs * 100000) : 'entered amount';

  if (!state.goal_form_is_recurring) {
    const targetAge = _resolveInputToAge(document.getElementById('newKnownYears').value, baseAge, baseAge);
    const yrsFromNow = Math.max(0, targetAge - baseAge);
    const startDesc =
      yrsFromNow === 0
        ? `starts immediately at Age ${targetAge}`
        : `starts in ${yrsFromNow} ${yrsFromNow === 1 ? 'year' : 'years'} at Age ${targetAge}`;
    previewEl.textContent = `📌 ${displayTag}: One-off expense of ${amtStr} (today's ₹) — ${startDesc} (occurs 1 time).`;
  } else {
    const startAge = _resolveInputToAge((document.getElementById('newKnownStartYear') || {}).value, baseAge, baseAge);
    const endAge = Math.max(
      startAge,
      _resolveInputToAge((document.getElementById('newKnownEndYear') || {}).value, baseAge, planEndAge)
    );
    const step = Math.max(1, parseInt((document.getElementById('newKnownEveryNYears') || {}).value, 10) || 3);
    const varPct = state.global_variance_pct !== undefined ? state.global_variance_pct : 10;
    const varLabel = varPct > 0 ? ` (±${varPct}% global variance)` : '';
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
    previewEl.textContent = `🔁 ${displayTag}: ${timingDesc}, every ${step} ${step === 1 ? 'year' : 'years'} (${count} ${count === 1 ? 'time' : 'times'} total) • ${amtStr}${varLabel} each time.`;
  }
}

function renderKnownExpensesList() {
  const container = document.getElementById('knownExpensesList');
  if (!container) return;

  if (!state.known_future_expenses.length) {
    container.innerHTML = `<span class="text-[11px] text-slate-500 italic">No planned future expenses added yet (optional). Choose a quick label above (Education, Marriage, Vehicle, Home Improvement, Vacation) to add one.</span>`;
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
        const varTxt = item.variance_pct > 0 ? ` ±${item.variance_pct}%` : '';
        return `
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs">
            <span class="font-bold text-emerald-300">🔁 ${item.event_tag}</span>
            <span class="text-slate-200 font-semibold">${startText}, every ${item.every_n_years} yrs (${count}x)</span>
            <span class="font-extrabold text-white">${formatInrCompact(item.amount_today_inr)}${varTxt} today</span>
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
  syncGoalFormDefaults();
  const tag = (document.getElementById('newKnownTag').value || 'Planned Goal').trim();
  const lakhs = Math.max(0.1, parseFloat(document.getElementById('newKnownLakhs').value) || 5);
  const baseAge = state.current_age || 38;
  const planEndAge = state.life_expectancy || 90;

  if (!state.goal_form_is_recurring) {
    const targetAge = Math.max(baseAge, _resolveInputToAge(document.getElementById('newKnownYears').value, baseAge, baseAge));
    const years = Math.max(1, Math.min(75, targetAge - baseAge || 1));
    state.known_future_expenses.push({
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
    });
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
    state.known_future_expenses.push({
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
    });
  }
  state.known_future_expenses.sort((a, b) => (a.start_age || a.start_year || 0) - (b.start_age || b.start_year || 0));
  renderKnownExpensesList();
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
    state.passive_income_inflation_interval_years = Math.max(1, parseInt(passiveInfSlider.value, 10) || 1);
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
    property_rental_yield: 2.5,
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
}

function selectCandidateRetirementAge(age) {
  const numericAge = parseInt(age, 10);
  if (isNaN(numericAge) || !state.result) return;
  state.selected_retirement_age = numericAge;
  applyOutcomeViewForAge(numericAge);
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
    retire_ready: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    borderline: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    at_risk: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    shortfall: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  };
  badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${badgeStyle[verdict.status] || badgeStyle.borderline}`;

  const hasMultiAges =
    retirement_readiness &&
    Array.isArray(retirement_readiness.candidate_retirement_ages) &&
    retirement_readiness.candidate_retirement_ages.length > 1;
  document.getElementById('resSimCountLabel').textContent = hasMultiAges
    ? `Success Rate at Age ${age}: ${longevity_stats.success_probability_pct}% (Target: 85%)`
    : `Success Rate: ${longevity_stats.success_probability_pct}% (Target: 85%)`;
  document.getElementById('resHeadline').textContent = verdict.headline;
  document.getElementById('resRecommendation').textContent = verdict.recommendation;

  // Render Year-by-Year Retirement Age Finder Bar Chart
  renderRetirementAgeProgression(retirement_readiness);

  // Outcome Cards: MEDIAN CASE First, WORST CASE Second — Focus on Future Age ("Lasts past 90+", "Lasts until 78")
  const fmtAgePrimary = (y, a) =>
    y >= maxSimYrs - 0.5 ? `Lasts past ${inputs_summary.life_expectancy}+` : `Lasts until ${Math.round(a)}`;
  const fmtAgeSub = (y, a) =>
    y >= maxSimYrs - 0.5 ? `Sustains past Age ${inputs_summary.life_expectancy}` : `Funds run out at Age ${Math.round(a)}`;

  ['p50', 'p10'].forEach((k) => {
    const yrs = longevity_stats.percentiles_years[k];
    const ageVal = longevity_stats.depletion_ages[k];
    const upper = k.toUpperCase();
    const ageEl = document.getElementById(`card${upper}Age`);
    const yrsEl = document.getElementById(`card${upper}Yrs`);
    if (ageEl) ageEl.textContent = fmtAgePrimary(yrs, ageVal);
    if (yrsEl) yrsEl.textContent = fmtAgeSub(yrs, ageVal);
  });

  // Render Charts (Wealth Trajectory + Success Rate by Age) & Table for the selected retirement age
  renderSpaghettiAndPercentileChart();
  renderSurvivalChart(data);
  populateNotableRunsDropdown(data);
}

function renderRetirementAgeProgression(readiness) {
  const box = document.getElementById('retirementAgeProgressionBox');
  if (!box) return;

  if (!readiness || !Array.isArray(readiness.candidate_retirement_ages) || readiness.candidate_retirement_ages.length <= 1) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  const candidates = readiness.candidate_retirement_ages;
  const bestAge = readiness.can_retire_at_age;
  const fallbackAge = readiness.evaluated_retirement_age || candidates[candidates.length - 1].retirement_age;
  const recommendedAge = bestAge !== null && bestAge !== undefined ? bestAge : fallbackAge;
  const selectedAge = state.selected_retirement_age !== null ? state.selected_retirement_age : recommendedAge;

  const recBadge = document.getElementById('recommendedRetireAgeBadge');
  if (recBadge) {
    const recItem = candidates.find((c) => c.retirement_age === recommendedAge) || candidates[candidates.length - 1];
    if (bestAge !== null && bestAge !== undefined) {
      const yrText = recItem.retire_in_years === 0 ? 'Retire Today' : `in ${recItem.retire_in_years} yr${recItem.retire_in_years > 1 ? 's' : ''}`;
      recBadge.textContent = `★ Recommended Retirement Age: Age ${recommendedAge} (${yrText} • ${recItem.success_rate_pct}% Success Rate)`;
      recBadge.className = 'px-3 py-1 rounded-xl text-xs font-extrabold bg-emerald-500/20 border border-emerald-500/50 text-emerald-300';
    } else {
      recBadge.textContent = `Best Within Horizon: Age ${recommendedAge} (${recItem.success_rate_pct}% Success Rate — Below 85% Target)`;
      recBadge.className = 'px-3 py-1 rounded-xl text-xs font-extrabold bg-amber-500/20 border border-amber-500/50 text-amber-300';
    }
  }

  const selLabel = document.getElementById('selectedRetirementAgeLabel');
  if (selLabel) {
    if (selectedAge === recommendedAge) {
      selLabel.textContent = `Viewing: Age ${selectedAge} (Recommended)`;
    } else if (selectedAge < recommendedAge) {
      const diff = recommendedAge - selectedAge;
      selLabel.textContent = `Viewing: Age ${selectedAge} (${diff} yr${diff > 1 ? 's' : ''} earlier)`;
    } else {
      const diff = selectedAge - recommendedAge;
      selLabel.textContent = `Viewing: Age ${selectedAge} (+${diff} yr${diff > 1 ? 's' : ''} later)`;
    }
  }

  // Render Clean Retirement Age Finder Bar Chart (X-axis: Age, Y-axis: Success Rate, no redundant bar text)
  const chartEl = document.getElementById('retirementAgeChart');
  if (chartEl) {
    const ctx = chartEl.getContext('2d');
    if (charts.retirementAge) charts.retirementAge.destroy();

    const labels = candidates.map((item) => String(item.retirement_age));
    const values = candidates.map((item) => item.success_rate_pct);
    const bgColors = candidates.map((item) => {
      if (item.retirement_age === selectedAge) {
        return item.meets_target ? '#10b981' : '#6366f1';
      }
      if (item.retirement_age === bestAge) {
        return 'rgba(16, 185, 129, 0.75)';
      }
      return item.meets_target ? 'rgba(16, 185, 129, 0.45)' : 'rgba(99, 102, 241, 0.42)';
    });
    const borderColors = candidates.map((item) => {
      if (item.retirement_age === selectedAge) return '#ffffff';
      if (item.retirement_age === bestAge) return '#34d399';
      return 'transparent';
    });

    charts.retirementAge = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Success Rate (%)',
            data: values,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        targetLine: { value: 85, color: '#10b981', label: '85% Target' },
        onClick: (_e, elements) => {
          if (elements && elements.length > 0) {
            const clicked = candidates[elements[0].index];
            if (clicked) {
              selectCandidateRetirementAge(clicked.retirement_age);
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctxItem) => {
                const c = candidates[ctxItem.dataIndex];
                const recNote = c.retirement_age === bestAge ? ' (★ Recommended Age)' : '';
                return `Success Rate: ${c.success_rate_pct}%${recNote}`;
              },
              afterBody: (items) => {
                if (!items || !items.length) return [];
                const c = candidates[items[0].dataIndex];
                if (!c) return [];
                const lines = [];
                if (c.median_depletion_age !== undefined) {
                  lines.push(`Median Case: Lasts until Age ${Math.round(c.median_depletion_age)}`);
                }
                if (c.worst_case_depletion_age !== undefined) {
                  lines.push(`Worst Case: Lasts until Age ${Math.round(c.worst_case_depletion_age)}`);
                }
                lines.push('Click bar to inspect Median & Worst Case below');
                return lines;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Age', color: '#cbd5e1' },
            ticks: { color: '#e2e8f0' },
          },
          y: {
            min: 0,
            max: 100,
            title: { display: true, text: 'Success Rate', color: '#cbd5e1' },
            ticks: { color: '#94a3b8', callback: (v) => `${v}%` },
            grid: { color: 'rgba(51, 65, 85, 0.25)' },
          },
        },
      },
    });
  }
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

// ==================== CHART 1: MEDIAN CASE vs WORST CASE WITH SEPARATE TOOLTIPS ====================
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
  const knownAgesSet = new Set(chartEvents.known_expense_ages || []);

  const stripEl = document.getElementById('chartEventsStrip');
  if (stripEl) {
    const badges = [];
    const inp = data.inputs_summary || {};
    (inp.known_future_expenses || []).forEach((ev) => {
      if (ev.is_recurring) {
        badges.push(
          `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold">🔁 ${ev.event_tag}: ${formatInrCompact(ev.amount_today_inr)} every ${ev.every_n_years} yrs (Yr ${ev.start_year}–${ev.end_year})</span>`
        );
      } else {
        badges.push(
          `<span class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold">🎯 ${ev.event_tag}: ${formatInrCompact(ev.amount_today_inr)} today @ Age ${inp.current_age + ev.years_from_now}</span>`
        );
      }
    });
    if (inp.random_expense_enabled) {
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300">⚡ Random Shock: ${formatInrCompact(inp.random_expense_base_inr)} (±${inp.random_expense_variance_pct}%), ${inp.random_expense_annual_probability_pct}%/yr</span>`
      );
    }
    if (inp.rebalance_enabled) {
      const taxRate = inp.tax_drag_rate !== undefined ? inp.tax_drag_rate : inp.fixed_income_tax_rate;
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">⚖️ Rebalance: Every ${inp.rebalance_frequency_years} yrs (${taxRate}% Tax Drag)</span>`
      );
    }
    stripEl.innerHTML = badges.join('');
  }

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

  const pointRadiiP50 = agesSlice.map((age) => {
    if (knownAgesSet.has(age)) return 7;
    const evs = eventsByAgeP50[String(age)] || [];
    if (evs.some((e) => e.startsWith('🏠') || e.startsWith('⚡'))) return 5;
    return 0;
  });
  const pointColorsP50 = agesSlice.map((age) => {
    if (knownAgesSet.has(age)) return '#f59e0b';
    const evs = eventsByAgeP50[String(age)] || [];
    if (evs.some((e) => e.startsWith('🏠'))) return '#10b981';
    if (evs.some((e) => e.startsWith('⚡'))) return '#a855f7';
    return '#6366f1';
  });

  const pointRadiiP10 = agesSlice.map((age) => {
    if (knownAgesSet.has(age)) return 6;
    const evs = eventsByAgeP10[String(age)] || [];
    if (evs.some((e) => e.startsWith('⚡'))) return 5;
    return 0;
  });

  const visibleValues = [];
  if (showP50) visibleValues.push(...p50Slice);
  if (showP10) visibleValues.push(...p10Slice);
  const peakVal = Math.max(...visibleValues, 100000);
  const yAxisMax = Math.ceil((peakVal * 1.12) / 500000) * 500000;

  const datasets = [
    {
      label: 'Median Case (Typical Market)',
      caseKey: 'p50',
      data: p50Slice,
      hidden: !showP50,
      borderColor: '#6366f1',
      backgroundColor: showP10 ? 'rgba(99, 102, 241, 0.14)' : 'rgba(99, 102, 241, 0.18)',
      borderWidth: 3.5,
      pointRadius: pointRadiiP50,
      pointBackgroundColor: pointColorsP50,
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1.5,
      pointHoverRadius: 8,
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
      pointRadius: pointRadiiP10,
      pointBackgroundColor: '#f59e0b',
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
              const caseTitle = isP10 ? 'Worst Case' : 'Median Case';
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

// ==================== CHART 2: SUCCESS RATE BY AGE ====================
function renderSurvivalChart(data) {
  const survivalEl = document.getElementById('survivalChart');
  if (!survivalEl) return;
  const ctx = survivalEl.getContext('2d');
  const { ages, survival_probability_pct } = data.survival_curve;
  if (charts.survival) charts.survival.destroy();

  charts.survival = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ages.map((a) => `Age ${a}`),
      datasets: [
        {
          label: 'Success Rate (%)',
          data: survival_probability_pct,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          borderWidth: 2.5,
          fill: true,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8', maxTicksLimit: 9, font: { size: 10 } }, grid: { color: 'rgba(51, 65, 85, 0.2)' } },
        y: {
          min: 0,
          max: 100,
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => `${v}%` },
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
        },
      },
    },
  });
}

// ==================== YEAR-BY-YEAR RUN INSPECTOR (8 REQUESTED COLUMNS, MEDIAN CASE PRIORITIZED) ====================
function populateNotableRunsDropdown(data) {
  const select = document.getElementById('notableRunSelect');
  const runs = data.notable_runs || [];
  const inp = data.inputs_summary || {};
  const curAge = inp.current_age || 38;
  const targetAge = inp.life_expectancy || 90;
  const maxSimYrs = inp.max_simulated_years || 60;

  const filtered = runs
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.label.startsWith('P50') || r.label.startsWith('P10') || r.label.startsWith('Random'));

  select.innerHTML = filtered
    .map(({ r, idx }) => {
      const ageLabel =
        r.years_lasted >= maxSimYrs - 0.5
          ? `Lasts past ${targetAge}+`
          : `Lasts until ${Math.round(curAge + r.years_lasted)}`;
      return `<option value="${idx}" ${r.label.startsWith('P50') ? 'selected' : ''}>${r.label} (${ageLabel})</option>`;
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
    .map((row) => {
      const eqColor = row.equity_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const incVal = row.income_received || 0;
      const sipVal = row.sip_contributed || 0;
      const expVal = row.base_living_expense !== undefined ? row.base_living_expense : row.withdrawal;
      const eventsText = row.combined_events_summary || row.special_events_summary || '—';
      const hasEvents = eventsText !== '—';

      return `
        <tr class="hover:bg-slate-800/40">
          <td data-label="Age" class="py-2 px-2.5 font-semibold text-white">Age ${row.age}</td>
          <td data-label="Market Year" class="py-2 px-2.5 font-mono text-indigo-300 font-bold">${row.sampled_india_year}</td>
          <td data-label="Returns & Inflation" class="py-2 px-2.5 mobile-col-span-2">
            <span class="font-bold ${eqColor}">${row.equity_return_pct >= 0 ? '+' : ''}${row.equity_return_pct}% Eq</span>
            <span class="text-slate-500 mx-1">/</span>
            <span class="text-emerald-300">+${row.debt_return_pct}% FD</span>
            <span class="text-slate-500 mx-1">/</span>
            <span class="text-amber-300">${row.inflation_pct}% Inf</span>
          </td>
          <td data-label="Income" class="py-2 px-2.5 ${incVal > 0 ? 'text-emerald-300 font-semibold' : 'text-slate-500'}">${incVal > 0 ? formatInrCompact(incVal) : '—'}</td>
          <td data-label="SIPs" class="py-2 px-2.5 ${sipVal > 0 ? 'text-indigo-300 font-semibold' : 'text-slate-500'}">${sipVal > 0 ? formatInrCompact(sipVal) : '—'}</td>
          <td data-label="Expenses" class="py-2 px-2.5 font-semibold text-white">${formatInrCompact(expVal)}</td>
          <td data-label="Events" class="py-2 px-2.5 mobile-col-span-2 ${hasEvents ? 'text-amber-300 font-medium' : 'text-slate-500'}">${eventsText}</td>
          <td data-label="Ending Wealth" class="py-2 px-2.5 font-bold text-white">${formatInrCompact(row.end_corpus_real)}</td>
        </tr>
      `;
    })
    .join('');
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
    triggerSimulationRun,
    renderSimulationResults,
    selectCandidateRetirementAge,
    applyOutcomeViewForAge,
    renderRetirementAgeProgression,
    setCurveFocus,
    switchChartScale,
    renderSpaghettiAndPercentileChart,
    renderSurvivalChart,
    populateNotableRunsDropdown,
    renderRunInspectorTable,
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
