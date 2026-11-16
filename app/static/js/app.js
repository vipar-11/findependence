/**
 * FinDependence India — Simple Step-by-Step Wizard & Random Historical Simulation Runner
 */

const state = {
  step: 1,
  current_age: 38,
  life_expectancy: 90,
  has_medical_insurance: true,
  corpus_lakhs: 350, // ₹3.50 Cr
  equity_pct: 55,
  fixed_income_pct: 30,
  property_pct: 15,
  expense_frequency: 'monthly',
  expense_amount: 100000,
  base_inflation_rate: 6.0,
  lifestyle_inflation_rate: 0.5,
  fixed_income_tax_rate: 30.0,
  equity_tax_rate: 12.5,
  rebalance_enabled: true,
  rebalance_frequency_years: 2,
  home_improvement_enabled: true,
  home_improvement_interval_years: 5,
  home_improvement_pct_of_property: 3.0,
  home_improvement_variance_pct: 1.0,
  random_expense_enabled: true,
  random_expense_base_inr: 200000, // ₹2.0 Lakhs
  random_expense_variance_pct: 25.0,
  random_expense_annual_probability_pct: 15.0,
  known_future_expenses: [
    { years_from_now: 8, amount_today_inr: 2500000, event_tag: 'Higher Education' },
    { years_from_now: 14, amount_today_inr: 3500000, event_tag: 'Marriage' },
  ],
  property_mode: 'liquidate_fallback',
  sampling_method: 'iid_bootstrap',
  num_simulations: 1000,
  chart_scale: 'real', // 'real' or 'nominal'
  curve_focus: 'both', // 'both', 'p50', or 'p10'
  result: null,
};

const charts = {
  spaghetti: null,
  histogram: null,
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

// ==================== WIZARD NAVIGATION ====================
function goToStep(stepNum) {
  state.step = stepNum;
  [1, 2, 3].forEach((n) => {
    const stepEl = document.getElementById(`wizardStep${n}`);
    const indEl = document.getElementById(`stepIndicator${n}`);
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
}

function returnToWizard(stepNum = 1) {
  document.getElementById('resultsContainer').classList.add('hidden');
  document.getElementById('simulationProgressBox').classList.add('hidden');
  document.getElementById('headerRestartBtn').classList.add('hidden');
  document.getElementById('wizardContainer').classList.remove('hidden');
  goToStep(stepNum);
}

// ==================== STEP 1: AGE & MEDICAL INSURANCE ====================
function updateAge(val) {
  let age = parseInt(val, 10);
  if (isNaN(age)) return;
  age = Math.max(18, Math.min(84, age));
  state.current_age = age;
  document.getElementById('ageInput').value = age;
  document.getElementById('ageSlider').value = Math.min(75, Math.max(20, age));

  if (state.life_expectancy <= state.current_age + 5) {
    state.life_expectancy = Math.min(105, state.current_age + 15);
    document.getElementById('targetAgeSlider').value = state.life_expectancy;
    updateAdvSettings();
  }
}

function setMedicalInsurance(hasIns) {
  state.has_medical_insurance = Boolean(hasIns);
  const btnYes = document.getElementById('btnMedInsYes');
  const btnNo = document.getElementById('btnMedInsNo');
  const note = document.getElementById('medInsStatusNote');

  if (state.has_medical_insurance) {
    btnYes.className = 'px-4 py-2 rounded-xl text-xs font-bold border-2 border-emerald-500 bg-emerald-500/20 text-emerald-300 transition';
    btnNo.className = 'px-4 py-2 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-400 hover:text-white transition';
    if (note) {
      note.textContent = '✅ Covered: Standard annual shock probability applies.';
      note.className = 'text-[11px] text-emerald-400 font-medium';
    }
  } else {
    btnNo.className = 'px-4 py-2 rounded-xl text-xs font-bold border-2 border-rose-500 bg-rose-500/20 text-rose-300 transition';
    btnYes.className = 'px-4 py-2 rounded-xl text-xs font-bold border border-slate-700 bg-slate-900 text-slate-400 hover:text-white transition';
    if (note) {
      note.textContent = '⚠️ Uninsured: Higher probability & severity of random medical shock expenses in retirement.';
      note.className = 'text-[11px] text-rose-400 font-medium';
    }
  }
}

// ==================== STEP 2: CORPUS & SPLIT ====================
function updateCorpusLakhs(val) {
  const lakhs = Math.max(1, parseFloat(val) || 50);
  state.corpus_lakhs = lakhs;
  document.getElementById('corpusLakhsInput').value = lakhs;
  document.getElementById('corpusLakhsSlider').value = Math.min(2000, lakhs);
  document.getElementById('corpusFormattedBadge').textContent = formatInrCompact(lakhs * 100000);
  renderSplitUI();
}

function updateSplit(changedKey, rawVal) {
  const val = Math.max(0, Math.min(100, parseInt(rawVal, 10) || 0));
  const rem = 100 - val;

  if (changedKey === 'equity') {
    state.equity_pct = val;
    const other = state.fixed_income_pct + state.property_pct;
    if (other > 0) {
      state.fixed_income_pct = Math.round((state.fixed_income_pct / other) * rem);
      state.property_pct = rem - state.fixed_income_pct;
    } else {
      state.fixed_income_pct = rem;
      state.property_pct = 0;
    }
  } else if (changedKey === 'fixed_income') {
    state.fixed_income_pct = val;
    const other = state.equity_pct + state.property_pct;
    if (other > 0) {
      state.equity_pct = Math.round((state.equity_pct / other) * rem);
      state.property_pct = rem - state.equity_pct;
    } else {
      state.equity_pct = rem;
      state.property_pct = 0;
    }
  } else {
    state.property_pct = val;
    const other = state.equity_pct + state.fixed_income_pct;
    if (other > 0) {
      state.equity_pct = Math.round((state.equity_pct / other) * rem);
      state.fixed_income_pct = rem - state.equity_pct;
    } else {
      state.equity_pct = Math.round(rem * 0.6);
      state.fixed_income_pct = rem - state.equity_pct;
    }
  }
  renderSplitUI();
}

function renderSplitUI() {
  const totalInr = state.corpus_lakhs * 100000;
  document.getElementById('eqSlider').value = state.equity_pct;
  document.getElementById('fiSlider').value = state.fixed_income_pct;
  document.getElementById('propSlider').value = state.property_pct;

  document.getElementById('eqPctText').textContent = state.equity_pct;
  document.getElementById('fiPctText').textContent = state.fixed_income_pct;
  document.getElementById('propPctText').textContent = state.property_pct;

  document.getElementById('eqAmtText').textContent = formatInrCompact((totalInr * state.equity_pct) / 100);
  document.getElementById('fiAmtText').textContent = formatInrCompact((totalInr * state.fixed_income_pct) / 100);
  document.getElementById('propAmtText').textContent = formatInrCompact((totalInr * state.property_pct) / 100);

  document.getElementById('barEquity').style.width = `${state.equity_pct}%`;
  document.getElementById('barDebt').style.width = `${state.fixed_income_pct}%`;
  document.getElementById('barProp').style.width = `${state.property_pct}%`;
}

// ==================== STEP 3: EXPENSES, KNOWN FUTURE EVENTS & ADVANCED ====================
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
    if (prev === 'annual') state.expense_amount = Math.round(state.expense_amount / 12);
  } else {
    btnYr.className = 'px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white transition';
    btnMo.className = 'px-3 py-1 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition';
    slider.min = 180000;
    slider.max = 6000000;
    slider.step = 50000;
    if (prev === 'monthly') state.expense_amount = Math.round(state.expense_amount * 12);
  }
  updateExpense(state.expense_amount);
}

function updateExpense(val) {
  const amt = Math.max(1000, parseFloat(val) || 50000);
  state.expense_amount = amt;
  const slider = document.getElementById('expenseSlider');
  slider.value = Math.min(parseFloat(slider.max), amt);
  document.getElementById('expenseInput').value = amt;

  const mo = state.expense_frequency === 'monthly' ? amt : amt / 12;
  const yr = state.expense_frequency === 'annual' ? amt : amt * 12;
  document.getElementById('expenseSummaryBadge').textContent = `${formatInrCompact(mo)}/mo (${formatInrCompact(yr)}/yr)`;
}

function renderKnownExpensesList() {
  const container = document.getElementById('knownExpensesList');
  if (!container) return;

  if (!state.known_future_expenses.length) {
    container.innerHTML = `<span class="text-[11px] text-slate-500 italic">No planned future goal expenses configured. Add one above (e.g. Education, Marriage).</span>`;
    return;
  }

  container.innerHTML = state.known_future_expenses
    .map((item, idx) => {
      const targetAge = state.current_age + item.years_from_now;
      return `
        <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-950/70 border border-indigo-500/40 text-xs">
          <span class="font-bold text-indigo-300">🎯 ${item.event_tag}</span>
          <span class="text-slate-300">Yr ${item.years_from_now} (Age ${targetAge})</span>
          <span class="font-extrabold text-white">${formatInrCompact(item.amount_today_inr)} today</span>
          <button type="button" onclick="removeKnownExpense(${idx})"
            class="ml-1 text-slate-400 hover:text-rose-400 font-bold" title="Remove Event">✕</button>
        </div>
      `;
    })
    .join('');
}

function addKnownExpenseFromInputs() {
  const tagEl = document.getElementById('newKnownTag');
  const yrsEl = document.getElementById('newKnownYears');
  const lakhsEl = document.getElementById('newKnownLakhs');

  const tag = (tagEl.value || 'Planned Goal').trim();
  const years = Math.max(1, Math.min(60, parseInt(yrsEl.value, 10) || 5));
  const lakhs = Math.max(0.1, parseFloat(lakhsEl.value) || 10);

  state.known_future_expenses.push({
    years_from_now: years,
    amount_today_inr: Math.round(lakhs * 100000),
    event_tag: tag,
  });
  state.known_future_expenses.sort((a, b) => a.years_from_now - b.years_from_now);
  renderKnownExpensesList();
}

function addPresetKnownExpense(tag, years, lakhs) {
  state.known_future_expenses.push({
    years_from_now: years,
    amount_today_inr: Math.round(lakhs * 100000),
    event_tag: tag,
  });
  state.known_future_expenses.sort((a, b) => a.years_from_now - b.years_from_now);
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
  state.base_inflation_rate = parseFloat(document.getElementById('infSlider').value);
  state.lifestyle_inflation_rate = parseFloat(document.getElementById('lifeInfSlider').value);
  state.life_expectancy = Math.max(
    state.current_age + 5,
    parseInt(document.getElementById('targetAgeSlider').value, 10)
  );

  // Tax & Periodic Rebalancing
  state.fixed_income_tax_rate = parseFloat(document.getElementById('fiTaxSlider').value);
  state.equity_tax_rate = parseFloat(document.getElementById('eqTaxSlider').value);
  state.rebalance_enabled = document.getElementById('rebalanceEnabledChk').checked;
  state.rebalance_frequency_years = parseInt(document.getElementById('rebalanceFreqSlider').value, 10) || 2;

  // Home Improvement
  state.home_improvement_enabled = document.getElementById('homeImpEnabledChk').checked;
  state.home_improvement_pct_of_property = Math.max(0, parseFloat(document.getElementById('homeImpPctInput').value) || 0);
  state.home_improvement_variance_pct = Math.max(0, parseFloat(document.getElementById('homeImpVarInput').value) || 0);
  state.home_improvement_interval_years = Math.max(1, parseInt(document.getElementById('homeImpIntervalInput').value, 10) || 5);

  // Random Expense (Shock)
  state.random_expense_enabled = document.getElementById('randExpEnabledChk').checked;
  const randLakhs = Math.max(0, parseFloat(document.getElementById('randExpBaseLakhsInput').value) || 0);
  state.random_expense_base_inr = Math.round(randLakhs * 100000);
  state.random_expense_variance_pct = Math.max(0, parseFloat(document.getElementById('randExpVarInput').value) || 0);
  state.random_expense_annual_probability_pct = Math.max(
    0,
    Math.min(100, parseFloat(document.getElementById('randExpProbInput').value) || 0)
  );

  state.property_mode = document.getElementById('propModeSelect').value;
  state.sampling_method = document.getElementById('samplingSelect').value;
  state.num_simulations = parseInt(document.getElementById('numSimsSelect').value, 10);

  document.getElementById('infValText').textContent = state.base_inflation_rate.toFixed(1);
  document.getElementById('lifeInfValText').textContent = state.lifestyle_inflation_rate.toFixed(2);
  document.getElementById('targetAgeValText').textContent = state.life_expectancy;
  document.getElementById('fiTaxValText').textContent = state.fixed_income_tax_rate.toFixed(1);
  document.getElementById('eqTaxValText').textContent = state.equity_tax_rate.toFixed(1);
  document.getElementById('rebalanceFreqText').textContent = state.rebalance_frequency_years;

  document.getElementById('advSummaryFiTax').textContent = `${state.fixed_income_tax_rate.toFixed(1)}%`;
  document.getElementById('advSummaryEqTax').textContent = `${state.equity_tax_rate.toFixed(1)}%`;
  document.getElementById('advSummaryRebal').textContent = state.rebalance_enabled
    ? `Every ${state.rebalance_frequency_years} yrs`
    : 'Off';
  document.getElementById('advSummaryInf').textContent = `${state.base_inflation_rate.toFixed(1)}%`;
  document.getElementById('advSummaryLife').textContent = `+${state.lifestyle_inflation_rate.toFixed(2)}%`;

  renderKnownExpensesList();
}

// ==================== RUN RANDOM HISTORICAL SIMULATIONS ====================
async function triggerSimulationRun() {
  document.getElementById('wizardContainer').classList.add('hidden');
  document.getElementById('resultsContainer').classList.add('hidden');
  const progressBox = document.getElementById('simulationProgressBox');
  progressBox.classList.remove('hidden');

  const bar = document.getElementById('simProgressBar');
  const ticker = document.getElementById('simTickerYears');
  const title = document.getElementById('simProgressTitle');

  bar.style.width = '15%';
  title.textContent = `Running ${state.num_simulations.toLocaleString()} Simulations (2006–2025 Market Data)...`;

  // Animate random Indian historical years (2006–2025) being drawn while the simulation runs
  const sampleYearsPool = [
    2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015,
    2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
  ];
  let progressPct = 20;
  const animInterval = setInterval(() => {
    progressPct = Math.min(92, progressPct + 18);
    bar.style.width = `${progressPct}%`;
    const drawn = Array.from({ length: 6 }, () => sampleYearsPool[Math.floor(Math.random() * sampleYearsPool.length)]);
    ticker.textContent = `Sampling last 20 yrs of Indian market data: ${drawn.join(' → ')}...`;
  }, 110);

  const payload = {
    current_age: state.current_age,
    life_expectancy: state.life_expectancy,
    has_medical_insurance: state.has_medical_insurance,
    total_corpus: state.corpus_lakhs * 100000,
    equity_pct: state.equity_pct,
    fixed_income_pct: state.fixed_income_pct,
    property_pct: state.property_pct,
    expense_amount: state.expense_amount,
    expense_frequency: state.expense_frequency,
    base_inflation_rate: state.base_inflation_rate,
    lifestyle_inflation_rate: state.lifestyle_inflation_rate,
    post_retirement_expense_multiplier: 100.0,
    property_mode: state.property_mode,
    property_rental_yield: 2.5,
    property_liquidation_haircut: 10.0,
    fixed_income_tax_rate: state.fixed_income_tax_rate,
    equity_tax_rate: state.equity_tax_rate,
    rebalance_enabled: state.rebalance_enabled,
    rebalance_frequency_years: state.rebalance_frequency_years,
    home_improvement_enabled: state.home_improvement_enabled,
    home_improvement_interval_years: state.home_improvement_interval_years,
    home_improvement_pct_of_property: state.home_improvement_pct_of_property,
    home_improvement_variance_pct: state.home_improvement_variance_pct,
    random_expense_enabled: state.random_expense_enabled,
    random_expense_base_inr: state.random_expense_base_inr,
    random_expense_variance_pct: state.random_expense_variance_pct,
    random_expense_annual_probability_pct: state.random_expense_annual_probability_pct,
    known_future_expenses: state.known_future_expenses,
    num_simulations: state.num_simulations,
    sampling_method: state.sampling_method,
    use_historical_inflation_volatility: true,
    seed: null, // Always draw a fresh random seed!
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
      returnToWizard(3);
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
    returnToWizard(3);
  }
}

// ==================== RENDER VISUAL RESULTS ====================
function renderSimulationResults(data) {
  const { inputs_summary, verdict, longevity_stats, simulation_meta } = data;
  const maxSimYrs = inputs_summary.max_simulated_years;
  const targetYrs = inputs_summary.target_horizon_years;

  // Top summary pills
  document.getElementById('summaryPillAge').textContent = `Age ${inputs_summary.current_age} → ${inputs_summary.life_expectancy}`;
  document.getElementById('summaryPillCorpus').textContent = `Corpus: ${inputs_summary.total_corpus_formatted}`;
  document.getElementById('summaryPillSplit').textContent =
    `${inputs_summary.allocation.equity_pct}% Eq / ${inputs_summary.allocation.fixed_income_pct}% Debt / ${inputs_summary.allocation.property_pct}% Prop`;
  document.getElementById('summaryPillExpense').textContent = `${inputs_summary.monthly_expense_formatted}/mo`;

  const medPill = document.getElementById('summaryPillMedIns');
  if (medPill) {
    medPill.textContent = inputs_summary.has_medical_insurance ? '🏥 Med Ins: Yes' : '⚠️ Med Ins: No';
    medPill.className = inputs_summary.has_medical_insurance
      ? 'px-2.5 py-1 rounded-lg bg-slate-800 text-teal-300 font-semibold'
      : 'px-2.5 py-1 rounded-lg bg-rose-950 text-rose-300 border border-rose-500/30 font-semibold';
  }
  document.getElementById('summaryPillSeed').textContent = `Random Seed #${simulation_meta.seed_used}`;

  // Verdict & Headline
  const badge = document.getElementById('resVerdictBadge');
  badge.textContent = verdict.badge;
  const badgeStyle = {
    retire_ready: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    borderline: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    at_risk: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    shortfall: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  };
  badge.className = `px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${badgeStyle[verdict.status] || badgeStyle.borderline}`;

  document.getElementById('resSimCountLabel').textContent =
    `${simulation_meta.num_simulations.toLocaleString()} random simulations (${simulation_meta.historical_data_period || '2006–2025'}) • ${longevity_stats.success_probability_pct}% survived past Age ${inputs_summary.life_expectancy}`;
  document.getElementById('resHeadline').textContent = verdict.headline;
  document.getElementById('resRecommendation').textContent = verdict.recommendation;

  // Percentile Cards: Only P10 (Unlucky 10th) and P50 (Median)
  const fmtYrs = (y) => (y >= maxSimYrs - 0.5 ? `${targetYrs}+ yrs` : `${y.toFixed(1)} yrs`);
  const fmtAge = (y, a) => (y >= maxSimYrs - 0.5 ? `Age ${inputs_summary.life_expectancy}+ (Sustained)` : `Depletes at Age ${Math.round(a)}`);

  ['p10', 'p50'].forEach((k) => {
    const yrs = longevity_stats.percentiles_years[k];
    const age = longevity_stats.depletion_ages[k];
    const upper = k.toUpperCase();
    const yrsEl = document.getElementById(`card${upper}Yrs`);
    const ageEl = document.getElementById(`card${upper}Age`);
    if (yrsEl) yrsEl.textContent = fmtYrs(yrs);
    if (ageEl) ageEl.textContent = fmtAge(yrs, age);
  });

  // Render Charts
  renderSpaghettiAndPercentileChart();
  renderHistogramChart(data);
  renderSurvivalChart(data);
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

// ==================== CHART 1: MEDIAN (P50) & 10TH PERCENTILE (P10) WITH EVENT MARKERS & DYNAMIC AUTO-SCALING ====================
function renderSpaghettiAndPercentileChart() {
  const data = state.result;
  if (!data) return;

  const ctx = document.getElementById('spaghettiChart').getContext('2d');
  const isReal = state.chart_scale === 'real';
  const focus = state.curve_focus || 'both';
  const showP50 = focus === 'both' || focus === 'p50';
  const showP10 = focus === 'both' || focus === 'p10';

  const traj = isReal ? data.trajectories.real : data.trajectories.nominal;
  const chartEvents = data.chart_events || { events_by_age: {}, known_expense_ages: [] };
  const eventsByAge = chartEvents.events_by_age || {};
  const knownAgesSet = new Set(chartEvents.known_expense_ages || []);

  // Populate #chartEventsStrip above the chart canvas
  const stripEl = document.getElementById('chartEventsStrip');
  if (stripEl) {
    const badges = [];
    const inp = data.inputs_summary || {};
    (inp.known_future_expenses || []).forEach((ev) => {
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 font-semibold">🎯 ${ev.event_tag}: ${formatInrCompact(ev.amount_today_inr)} today @ Age ${inp.current_age + ev.years_from_now}</span>`
      );
    });
    if (inp.home_improvement_enabled && inp.allocation && inp.allocation.property_pct > 0) {
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">🏠 Home Improvement: ${inp.home_improvement_pct_of_property}% (±${inp.home_improvement_variance_pct}%) every ${inp.home_improvement_interval_years} yrs</span>`
      );
    }
    if (inp.random_expense_enabled) {
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300">⚡ Random Shock: ${formatInrCompact(inp.random_expense_base_inr)} (±${inp.random_expense_variance_pct}%), ${inp.random_expense_annual_probability_pct}%/yr</span>`
      );
    }
    if (inp.rebalance_enabled) {
      badges.push(
        `<span class="px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">⚖️ Rebalance: Every ${inp.rebalance_frequency_years} yrs (Debt Tax ${inp.fixed_income_tax_rate}%, Eq Tax ${inp.equity_tax_rate}%)</span>`
      );
    }
    stripEl.innerHTML = badges.join('');
  }

  if (charts.spaghetti) charts.spaghetti.destroy();

  // Determine optimal X-axis length based on the currently visible curve(s)
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

  // Build per-point marker styling so Known Expenses & Home Improvements stand out visibly on the chart curves
  const pointRadiiP50 = agesSlice.map((age) => {
    if (knownAgesSet.has(age)) return 7;
    const evs = eventsByAge[String(age)] || [];
    if (evs.some((e) => e.startsWith('🏠') || e.startsWith('⚡'))) return 5;
    return 0;
  });
  const pointColorsP50 = agesSlice.map((age) => {
    if (knownAgesSet.has(age)) return '#f59e0b'; // Amber gold for Known Tagged Events
    const evs = eventsByAge[String(age)] || [];
    if (evs.some((e) => e.startsWith('🏠'))) return '#10b981'; // Emerald for Home Improvement
    if (evs.some((e) => e.startsWith('⚡'))) return '#a855f7'; // Purple for Random Shock
    return '#6366f1';
  });

  const pointRadiiP10 = agesSlice.map((age) => (knownAgesSet.has(age) ? 6 : 0));

  // Dynamically compute Y-axis max strictly from the VISIBLE dataset(s) so P10 never looks flat
  const visibleValues = [];
  if (showP50) visibleValues.push(...p50Slice);
  if (showP10) visibleValues.push(...p10Slice);
  const peakVal = Math.max(...visibleValues, 100000);
  const yAxisMax = Math.ceil((peakVal * 1.12) / 500000) * 500000;

  const datasets = [
    {
      label: '50th Percentile (Median Outcome)',
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
      label: '10th Percentile (Unlucky Crash Outcome)',
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
      interaction: { mode: 'index', intersect: false },
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
              const dataIdx = items[0].dataIndex;
              const age = agesSlice[dataIdx];
              const evList = eventsByAge[String(age)] || [];
              if (!evList.length) return [];
              return ['', 'Events & Activity at Age ' + age + ':', ...evList.map((e) => `  • ${e}`)];
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

// ==================== CHART 2: LONGEVITY HISTOGRAM ====================
function renderHistogramChart(data) {
  const ctx = document.getElementById('histogramChart').getContext('2d');
  const hist = data.longevity_histogram;
  if (charts.histogram) charts.histogram.destroy();

  charts.histogram = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hist.map((b) => b.label),
      datasets: [
        {
          label: '% of Simulations',
          data: hist.map((b) => b.percentage),
          backgroundColor: hist.map((_, i) =>
            i === hist.length - 1 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(99, 102, 241, 0.75)'
          ),
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.raw}% of runs (${hist[item.dataIndex].count} simulations)`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (v) => `${v}%` },
          grid: { color: 'rgba(51, 65, 85, 0.2)' },
        },
      },
    },
  });
}

// ==================== CHART 3: SURVIVAL PROBABILITY ====================
function renderSurvivalChart(data) {
  const ctx = document.getElementById('survivalChart').getContext('2d');
  const { ages, survival_probability_pct } = data.survival_curve;
  if (charts.survival) charts.survival.destroy();

  charts.survival = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ages.map((a) => `Age ${a}`),
      datasets: [
        {
          label: 'Survival Probability (%)',
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

// ==================== INDIVIDUAL RANDOM RUN INSPECTOR ====================
function populateNotableRunsDropdown(data) {
  const select = document.getElementById('notableRunSelect');
  const runs = data.notable_runs || [];
  // Filter to only P10, P50 (Median), and Random Run #1 to avoid cognitive overload
  const filtered = runs
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.label.startsWith('P10') || r.label.startsWith('P50') || r.label.startsWith('Random'));

  select.innerHTML = filtered
    .map(
      ({ r, idx }) =>
        `<option value="${idx}" ${r.label.startsWith('P50') ? 'selected' : ''}>${r.label} — Run #${r.run_number} (Lasted ${r.years_lasted} yrs)</option>`
    )
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
      const hasSpecialEvent = row.special_events_summary && row.special_events_summary !== '—';
      const hasRebal = row.rebalance_activity && row.rebalance_activity !== '—';
      return `
        <tr class="hover:bg-slate-800/40">
          <td class="py-2 px-3 font-semibold text-white whitespace-nowrap">Year ${row.sim_year} (Age ${row.age})</td>
          <td class="py-2 px-3 font-mono text-indigo-300 font-bold whitespace-nowrap">${row.sampled_india_year}</td>
          <td class="py-2 px-3 whitespace-nowrap">
            <span class="font-bold ${eqColor}">${row.equity_return_pct >= 0 ? '+' : ''}${row.equity_return_pct}% Eq</span>
            <span class="text-slate-500 mx-1">/</span>
            <span class="text-emerald-300">+${row.debt_return_pct}% Debt</span>
          </td>
          <td class="py-2 px-3 text-amber-300 font-semibold whitespace-nowrap">${row.inflation_pct}%</td>
          <td class="py-2 px-3 text-amber-200 font-semibold whitespace-nowrap">+${row.lifestyle_inflation_pct}%</td>
          <td class="py-2 px-3 ${hasSpecialEvent ? 'text-amber-300 font-semibold' : 'text-slate-500'}">${row.special_events_summary || '—'}</td>
          <td class="py-2 px-3 text-slate-200">
            <div class="font-bold text-white">${formatInrCompact(row.withdrawal)}</div>
            <div class="text-[11px] text-slate-400">${row.withdrawal_source_summary || ''}</div>
          </td>
          <td class="py-2 px-3 ${hasRebal ? 'text-indigo-300 font-medium' : 'text-slate-500'}">${row.rebalance_activity || '—'}</td>
          <td class="py-2 px-3 font-bold text-white whitespace-nowrap">${formatInrCompact(row.end_corpus_real)}</td>
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

  // 1. Runtime Schema Discovery Banner
  const headerInfo = discovered_schema.header_row_number
    ? `Header Row #${discovered_schema.header_row_number}`
    : 'Headerless Grid';
  document.getElementById('schemaDiscoveryText').innerHTML =
    `<b>${headerInfo}</b> • Date: <code>${cols.date}</code> • Narration: <code>${cols.description}</code> • Outflow: <code>${cols.debit_or_amount}</code>` +
    (cols.balance_ignored ? ` • Ignored Balance: <code>${cols.balance_ignored}</code>` : '');

  document.getElementById('schemaRowsSummary').textContent =
    `${discovered_schema.extracted_debit_rows} outflows classified • ${discovered_schema.skipped_credit_rows} inflows skipped`;

  // 2. Hero Summary Tiles
  document.getElementById('expTileMonthly').textContent = `${summary.estimated_monthly_expense_exact} / mo`;
  document.getElementById('expTileAnnual').textContent =
    `Compact: ${summary.estimated_monthly_expense_formatted}/mo • Annualized: ${summary.estimated_annual_expense_formatted}/yr`;

  document.getElementById('expTileMonthsCount').textContent =
    `${summary.num_months_detected} ${summary.num_months_detected === 1 ? 'Month' : 'Months'} (${summary.months_list.join(', ')})`;
  document.getElementById('expTileTotalPeriod').textContent =
    `Total living spend across statement: ${summary.total_living_expenses_formatted} (${summary.total_transactions_classified} debits)`;

  document.getElementById('expTileInvestments').textContent =
    `${summary.estimated_monthly_investments_formatted} / mo`;

  // 3. Render Category Chart & Monthly Trend Chart
  renderExpenseCategoryChart(category_breakdown);
  renderExpenseMonthlyTrendChart(monthly_trend);

  // 4. Render Category Breakdown Cards
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

  // 5. Populate Category Filter Dropdown & Render Transaction Table
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
        <td class="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">${t.date}</td>
        <td class="py-2.5 px-3 text-white font-medium">${t.description}</td>
        <td class="py-2.5 px-3 text-right font-bold text-white whitespace-nowrap">${t.amount_formatted}</td>
        <td class="py-2.5 px-3 whitespace-nowrap">
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
  updateAdvSettings();
  setupDropZone();
  syncActiveModulesNav();
});
