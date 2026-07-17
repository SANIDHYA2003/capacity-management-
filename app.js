// Application State
let storeData = [];
let activeView = 'overall';
let selectedCity = '';
let selectedStoreId = '';
let activeRegions = ["Delhi", "Gurgaon", "Noida", "Faridabad", "Pune", "Navi Mumbai", "Mumbai"];
let globalRgEnabled = true;
let customHubs = [];
let sandboxModeActive = false;
let activeTempReliefStores = new Set();

// Helper to check if relief is active for a store (global toggle, custom sandbox hub coverage, or temporary active reliever)
function isReliefActiveForStore(s) {
  const nameClean = s.storeName.trim().toLowerCase();
  const isCoveredByCustomHub = customHubs.some(hub => hub.members.includes(nameClean));
  const hasTempRelief = activeTempReliefStores.has(nameClean);
  return globalRgEnabled || isCoveredByCustomHub || hasTempRelief;
}

// Sales Slabs Configuration & Requirements Mapping
const slabsConfig = {
  "<2L":    { x: 100, standard: 2, threshold: 1.5, bareMinimum: 1.0 },
  "2-5L":   { x: 195, standard: 3, threshold: 2.0, bareMinimum: 1.0 },
  "5-8L":   { x: 290, standard: 5, threshold: 3.0, bareMinimum: 2.0 },
  "8-13L":  { x: 385, standard: 6, threshold: 4.0, bareMinimum: 3.0 },
  "13-18L": { x: 480, standard: 8, threshold: 6.0, bareMinimum: 4.5 },
  "18-23L": { x: 575, standard: 9, threshold: 7.0, bareMinimum: 5.0 },
  "23L+":   { x: 670, standard: 10, threshold: 8.0, bareMinimum: 6.0 }
};

// Convert manpower value to Y coordinate in SVG (0 to 16 scale)
function manpowerToY(val) {
  const chartHeight = 360;
  const paddingBottom = 410;
  return paddingBottom - (val / 16) * chartHeight;
}

// Map a store's actual manpower to its operational health status and compromises description
function getStoreStatus(store) {
  return getStoreStatusForCrew(store.actual, store);
}

function getStoreStatusForCrew(crew, store) {
  const std = store.standard;
  const avgStandard = 6.7;
  const avgThreshold = 5.4;
  const avgBareMin = 4.3;

  if (crew === 0) return { key: 'closed', label: 'Store Closed', color: 'var(--status-closed)', comp: 'Store Closed' };
  if (crew < avgBareMin) return { key: 'critical', label: 'Critical / Bare Min', color: 'var(--status-critical)', comp: 'G&T (Griller & Timing Closed)' };
  if (crew < avgThreshold) return { key: 'threshold', label: 'Threshold Reached', color: 'var(--status-threshold)', comp: 'G (Griller Closed)' };
  if (crew < avgStandard) return { key: 'pressure', label: 'Pressure Zone', color: 'var(--status-pressure)', comp: 'Ops Metrics (Workload)' };
  return { key: 'standard', label: 'Standard Operations', color: 'var(--status-standard)', comp: '0 / Roster (Optimal)' };
}

// Compute financial savings vs revenue loss for understaffed stores
function calculateFinancials(s) {
  const std = s.standard;
  const act = s.actual;
  const th = s.threshold;
  const bm = s.bareMinimum;
  const sales = s.juneSales || 1000000; // default 10L if missing

  // Determine regional salary in range 15k-25k
  let salaryRate = 20000; // default
  if (s.city === "Mumbai") salaryRate = 24000;
  else if (s.city === "Delhi" || s.city === "Gurgaon") salaryRate = 22000;
  else if (s.city === "Noida") salaryRate = 21000;
  else if (s.city === "Navi Mumbai") salaryRate = 20000;
  else if (s.city === "Faridabad") salaryRate = 18000;
  else if (s.city === "Pune") salaryRate = 16000;

  // Pro-rated accommodation cost per person (₹20,000 for full flat, shared among 12-15 relievers)
  const proRatedAccCost = 1500;
  const rgCost = salaryRate + proRatedAccCost;

  // Weekly off roster math:
  // Every employee works 6 days/week. Without RGs, active daily crew is act - 1 (min 0)
  const activeCrewNoRG = Math.max(0, act - 1);
  // With RG covering off, active crew is act
  const activeCrewWithRG = act;

  // Loss percentage calculation based on company-wide averages to align with the visual chart bands
  const avgStandard = 6.7;
  const avgThreshold = 5.4;
  const avgBareMin = 4.3;

  function getLossPercentAndStatus(crew) {
    if (crew === 0) return { loss: 1.0, label: "Store Closed" };
    if (crew < avgBareMin) return { loss: 0.35, label: "Critical / Bare Min (G&T)" };
    if (crew < avgThreshold) return { loss: 0.15, label: "Threshold Reached (G)" };
    if (crew < avgStandard) return { loss: 0.05, label: "Pressure Zone (Ops)" };
    return { loss: 0.0, label: "Standard Operations" };
  }

  const statusNoRGObj = getLossPercentAndStatus(activeCrewNoRG);
  const statusWithRGObj = getLossPercentAndStatus(activeCrewWithRG);

  // Revenue loss in Rupees
  const revenueLossNoRG = Math.round(sales * statusNoRGObj.loss);
  const revenueLossWithRG = Math.round(sales * statusWithRGObj.loss);

  // Revenue protected (recovered) by deploying RG relief roster
  const salesProtected = Math.max(0, revenueLossNoRG - revenueLossWithRG);
  const dailyProtected = Math.round(salesProtected / 30);

  // Net P&L ROI: protected sales minus RG cost
  // If the store is already fully staffed (no deficit), salesProtected is 0
  const netBenefit = salesProtected - (act < std ? rgCost : 0);

  return {
    activeCrewNoRG,
    activeCrewWithRG,
    lossPercentNoRG: statusNoRGObj.loss,
    lossPercentWithRG: statusWithRGObj.loss,
    revenueLossNoRG,
    revenueLossWithRG,
    salesProtected,
    dailyProtected,
    rgCost: act < std ? rgCost : 0,
    netBenefit,
    statusNoRG: statusNoRGObj.label,
    statusWithRG: statusWithRGObj.label
  };
}

// Update the live system time display
function updateLiveTime() {
  const liveTimeEl = document.getElementById('live-time');
  if (!liveTimeEl) return;
  const now = new Date();
  const options = { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: true 
  };
  liveTimeEl.innerHTML = `<span class="pulse-dot"></span> System Live: ${now.toLocaleDateString('en-US', options)}`;
}

// Initialize Page Controls
window.addEventListener('DOMContentLoaded', () => {
  updateLiveTime();
  setInterval(updateLiveTime, 1000);
  
  // Load data.json
  fetch('data.json')
    .then(response => {
      if (!response.ok) throw new Error('Data file failed to load');
      return response.json();
    })
    .then(data => {
      storeData = data;
      calculateAndRender();
      setupEventListeners();
      initLeafletMap();
    })
    .catch(err => {
      console.error(err);
      alert('Error loading dashboard data. Please make sure data.json is in the directory.');
    });
});

// Primary calculation and view rendering hub
function calculateAndRender() {
  computeSummaryCards();
  renderOverallView();
  renderCityView();
  renderStoreView();
  renderAllStoresView();
  renderScatterPlot();
}

// Compute Company-wide KPI Numbers
function computeSummaryCards() {
  const totalStores = storeData.length;
  const totalStandard = storeData.reduce((acc, s) => acc + s.standard, 0);
  const totalActual = storeData.reduce((acc, s) => acc + s.actual, 0);
  const totalRg = storeData.reduce((acc, s) => acc + s.rgRequired, 0);
  
  let belowThresholdCount = 0;
  let bareMinCount = 0;

  storeData.forEach(s => {
    const status = getStoreStatus(s);
    if (status.key === 'critical' || status.key === 'baremin' || status.key === 'closed') {
      belowThresholdCount++;
    }
    if (status.key === 'baremin') {
      bareMinCount++;
    }
  });

  document.querySelector('#kpi-stores .kpi-value').textContent = totalStores;
  document.querySelector('#kpi-standard .kpi-value').textContent = totalStandard;
  document.querySelector('#kpi-actual .kpi-value').textContent = totalActual;
  document.querySelector('#kpi-rg .kpi-value').textContent = totalRg;
  document.querySelector('#kpi-critical .kpi-value').textContent = belowThresholdCount;
  document.querySelector('#kpi-baremin .kpi-value').textContent = bareMinCount;

  // Dynamically compute and display overall manpower shortage
  const shortage = totalStandard - totalActual;
  const shortagePercent = ((shortage / totalStandard) * 100).toFixed(1);
  const shortageEl = document.getElementById('kpi-shortage-badge');
  if (shortageEl) {
    shortageEl.textContent = `Shortage: -${shortage} (${shortagePercent}%)`;
  }
}

// Render Overall View: Distribution Charts and Regional Summaries
function renderOverallView() {
  // Count states & calculate financials
  const counts = { standard: 0, pressure: 0, threshold: 0, critical: 0, baremin: 0, closed: 0 };
  let totalRevenueProtected = 0;

  storeData.forEach(s => {
    // Determine store status based on active relief status
    const active = isReliefActiveForStore(s);
    const effectiveCrew = active ? s.actual : Math.max(0, s.actual - 1);
    
    // We compute status for counts based on effective crew size!
    const avgStandard = 6.7;
    const avgThreshold = 5.4;
    const avgBareMin = 4.3;
    let statusKey = 'critical';
    if (effectiveCrew >= avgStandard) statusKey = 'standard';
    else if (effectiveCrew >= avgThreshold) statusKey = 'pressure';
    else if (effectiveCrew >= avgBareMin) statusKey = 'threshold';
    counts[statusKey]++;

    // Financials
    const fin = calculateFinancials(s);
    totalRevenueProtected += active ? fin.salesProtected : 0;
  });

  const total = storeData.length || 1;

  // Update counts
  document.getElementById('count-standard').textContent = counts.standard;
  document.getElementById('count-pressure').textContent = counts.pressure;
  document.getElementById('count-threshold').textContent = counts.threshold;
  document.getElementById('count-critical').textContent = counts.critical;
  document.getElementById('count-baremin').textContent = counts.baremin;
  document.getElementById('count-closed').textContent = counts.closed;

  // Update bar widths
  document.getElementById('bar-standard').style.width = `${(counts.standard / total) * 100}%`;
  document.getElementById('bar-pressure').style.width = `${(counts.pressure / total) * 100}%`;
  document.getElementById('bar-threshold').style.width = `${(counts.threshold / total) * 100}%`;
  document.getElementById('bar-critical').style.width = `${(counts.critical / total) * 100}%`;
  document.getElementById('bar-baremin').style.width = `${(counts.baremin / total) * 100}%`;
  document.getElementById('bar-closed').style.width = `${(counts.closed / total) * 100}%`;

  // Update Financial Audit numbers in UI
  let totalRgCost = 0;
  storeData.forEach(s => {
    let salaryRate = 20000;
    if (s.city === "Mumbai") salaryRate = 24000;
    else if (s.city === "Delhi" || s.city === "Gurgaon") salaryRate = 22000;
    else if (s.city === "Noida") salaryRate = 21000;
    else if (s.city === "Navi Mumbai") salaryRate = 20000;
    else if (s.city === "Faridabad") salaryRate = 18000;
    else if (s.city === "Pune") salaryRate = 16000;
    
    // Add cost only if relief is active for this store!
    if (isReliefActiveForStore(s)) {
      totalRgCost += s.rgRequired * (salaryRate + 1500); // salary + 1.5k pro-rated accommodation
    }
  });

  // Add rent cost for custom sandbox hubs (₹20,000 per hub)
  const customHubsCost = customHubs.length * 20000;
  const showCost = totalRgCost + customHubsCost;
  const showProtected = totalRevenueProtected;
  const showROI = showProtected - showCost;

  document.getElementById('fin-salaries-saved').textContent = `₹${(showCost / 100000).toFixed(2)}L`;
  document.getElementById('fin-salaries-saved').className = `val ${showCost > 0 ? 'text-danger' : 'text-green'}`;
  document.getElementById('fin-salaries-saved').nextElementSibling.textContent = showCost > 0 ? "Roster + accommodation cost active" : "Program cost saved";

  document.getElementById('fin-revenue-lost').textContent = `${showProtected > 0 ? '+' : ''}₹${(showProtected / 100000).toFixed(2)}L`;
  document.getElementById('fin-revenue-lost').className = `val ${showProtected > 0 ? 'text-green' : 'text-danger'}`;
  document.getElementById('fin-revenue-lost').nextElementSibling.textContent = showProtected > 0 ? "Revenue protected by RGs" : "Revenue leakage active!";
  
  const netImpactEl = document.getElementById('fin-net-impact');
  netImpactEl.textContent = `${showROI < 0 ? '-' : '+'}₹${(Math.abs(showROI) / 100000).toFixed(2)}L`;
  if (showROI < 0) {
    netImpactEl.className = "val text-danger text-bold";
    netImpactEl.nextElementSibling.textContent = "Company-wide sales loss";
  } else {
    netImpactEl.className = "val text-green text-bold";
    netImpactEl.nextElementSibling.textContent = "Net protected profit / benefit";
  }

  // Render Regional Table
  const regions = {};
  storeData.forEach(s => {
    if (!regions[s.city]) {
      regions[s.city] = { count: 0, std: 0, act: 0, rg: 0, deficit: 0 };
    }
    regions[s.city].count++;
    regions[s.city].std += s.standard;
    regions[s.city].act += s.actual;
    regions[s.city].rg += s.rgRequired;
  });

  const tbody = document.querySelector('#table-overall-cities tbody');
  tbody.innerHTML = '';

  Object.keys(regions).sort().forEach(cityName => {
    const r = regions[cityName];
    const percentage = r.std > 0 ? Math.round((r.act / r.std) * 100) : 100;
    
    let statusText = 'Optimal';
    let badgeClass = 'standard';
    if (percentage < 60) {
      statusText = 'Critical';
      badgeClass = 'baremin';
    } else if (percentage < 85) {
      statusText = 'Understaffed';
      badgeClass = 'critical';
    } else if (percentage < 100) {
      statusText = 'Pressure';
      badgeClass = 'pressure';
    }

    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.innerHTML = `
      <td><strong>${cityName}</strong></td>
      <td>${r.count}</td>
      <td>${r.std}</td>
      <td>${r.act}</td>
      <td><span class="${r.rg > 0 ? 'text-yellow' : ''}">${r.rg}</span></td>
      <td><span class="status-badge ${badgeClass}">${statusText} (${percentage}%)</span></td>
    `;
    
    // Quick-link: click row to load city view for that city
    tr.addEventListener('click', () => {
      selectedCity = cityName;
      document.getElementById('city-select').value = cityName;
      document.querySelector('[data-view="city"]').click();
      renderCityView();
    });

    tbody.appendChild(tr);
  });
}

// Render City View
function renderCityView() {
  const citySelect = document.getElementById('city-select');
  
  // Fill dropdown with unique cities if empty
  if (citySelect.children.length === 0) {
    const uniqueCities = [...new Set(storeData.map(s => s.city))].sort();
    uniqueCities.forEach(city => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      citySelect.appendChild(opt);
    });
    if (uniqueCities.length > 0) {
      selectedCity = uniqueCities[0];
    }
  }

  if (!selectedCity) return;

  const cityStores = storeData.filter(s => s.city === selectedCity);
  const totalStores = cityStores.length;
  const totalStd = cityStores.reduce((acc, s) => acc + s.standard, 0);
  const totalAct = cityStores.reduce((acc, s) => acc + s.actual, 0);
  const totalRg = cityStores.reduce((acc, s) => acc + s.rgRequired, 0);

  // Update city summary text
  document.getElementById('city-summary-title').textContent = `${selectedCity} Regional Overview`;
  document.getElementById('city-stat-stores').textContent = totalStores;
  document.getElementById('city-stat-std').textContent = totalStd;
  document.getElementById('city-stat-act').textContent = totalAct;
  document.getElementById('city-stat-rg').textContent = totalRg;

  // City Health rating description
  const ratio = totalStd > 0 ? (totalAct / totalStd) * 100 : 100;
  let healthDesc = '';
  if (ratio >= 95) {
    healthDesc = `🟢 Region operating optimally at ${Math.round(ratio)}% standard capability.`;
  } else if (ratio >= 85) {
    healthDesc = `🟡 Staffing pressure active. Running at ${Math.round(ratio)}% standard manpower.`;
  } else if (ratio >= 70) {
    healthDesc = `🟠 Understaffing detected. Stores require relief. Running at ${Math.round(ratio)}% standard capacity.`;
  } else {
    healthDesc = `🔴 Critical personnel deficit: running at ${Math.round(ratio)}% headcount. Direct revenue risk!`;
  }
  document.getElementById('city-health-desc').textContent = healthDesc;

  // Render Outlet Table
  const tbody = document.querySelector('#table-city-stores tbody');
  tbody.innerHTML = '';

  cityStores.sort((a,b) => a.storeName.localeCompare(b.storeName)).forEach(s => {
    const status = getStoreStatus(s);
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.innerHTML = `
      <td><strong>${s.storeName}</strong></td>
      <td>${s.salesSlab}</td>
      <td>${s.standard}</td>
      <td>${s.actual}</td>
      <td><span class="${s.rgRequired > 0 ? 'text-yellow' : ''}">${s.rgRequired}</span></td>
      <td><span class="status-badge ${status.key}">${status.label}</span></td>
    `;

    // Click row to open specific store in store view
    tr.addEventListener('click', () => {
      selectedStoreId = `${s.city}::${s.storeName}`;
      document.getElementById('store-select').value = selectedStoreId;
      document.querySelector('[data-view="store"]').click();
      renderStoreView();
    });

    tbody.appendChild(tr);
  });
}

// Render Store View
function renderStoreView() {
  const storeSelect = document.getElementById('store-select');
  
  // Fill store selector with all 100 stores sorted alphabetically
  if (storeSelect.children.length === 0) {
    // Sort all stores by name
    const sortedStores = [...storeData].sort((a, b) => a.storeName.localeCompare(b.storeName));
    sortedStores.forEach(s => {
      const id = `${s.city}::${s.storeName}`;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${s.storeName} (${s.city})`;
      storeSelect.appendChild(opt);
    });
  }

  const container = document.getElementById('store-details-container');
  const placeholder = document.getElementById('store-view-placeholder');

  if (!selectedStoreId) {
    container.classList.add('hidden');
    placeholder.classList.remove('hidden');
    return;
  }

  placeholder.classList.add('hidden');
  container.classList.remove('hidden');

  // Find selected store
  const [city, name] = selectedStoreId.split('::');
  const store = storeData.find(s => s.city === city && s.storeName === name);

  if (!store) return;

  // Read toggle simulator checkbox (synced with sandbox hub coverage)
  const toggleEl = document.getElementById('toggle-rg-sim');
  if (toggleEl) {
    toggleEl.checked = isReliefActiveForStore(store);
  }
  const simEnabled = isReliefActiveForStore(store);

  // Determine active crew based on simulation toggle
  const displayedCrew = simEnabled ? store.actual : Math.max(0, store.actual - 1);
  const status = getStoreStatusForCrew(displayedCrew, store);

  // Update profile headers
  document.getElementById('store-name-display').textContent = store.storeName;
  document.getElementById('store-city-display').textContent = `Region: ${store.city}`;
  
  const badge = document.getElementById('store-status-badge');
  badge.className = `status-badge ${status.key}`;
  badge.textContent = status.label;

  // Stats
  document.getElementById('store-slab-display').textContent = store.salesSlab;
  document.getElementById('store-hours-display').textContent = store.operatingTime || "9:00 AM TO 4:00 AM";
  document.getElementById('store-rg-display').textContent = store.rgRequired;

  // Gauge configurations
  document.getElementById('store-val-std').textContent = store.standard;
  document.getElementById('store-val-th').textContent = store.threshold;
  document.getElementById('store-val-bm').textContent = store.bareMinimum;

  const std = store.standard || 1;
  const thPercent = (store.threshold / std) * 100;
  const bmPercent = (store.bareMinimum / std) * 100;
  const actPercent = Math.min((displayedCrew / std) * 100, 100);

  document.getElementById('marker-bm').style.left = `${bmPercent}%`;
  document.getElementById('marker-th').style.left = `${thPercent}%`;
  
  const fill = document.getElementById('gauge-actual-fill');
  fill.style.width = `${actPercent}%`;
  
  // Set gauge color based on status
  fill.style.backgroundColor = `var(--status-${status.key})`;

  const valTag = document.getElementById('gauge-actual-val-tag');
  valTag.style.left = `${actPercent}%`;
  valTag.textContent = simEnabled ? `Actual: ${displayedCrew}` : `Daily Active: ${displayedCrew} (No Relief)`;

  // Build Checklist
  const list = document.getElementById('compromises-checklist');
  list.innerHTML = '';

  const checklistItems = getCompromiseChecklist(status.key);
  checklistItems.forEach(item => {
    const li = document.createElement('li');
    li.className = `checklist-item ${item.isCompromised ? 'active' : 'good'}`;
    li.innerHTML = `
      <span class="check-icon">${item.isCompromised ? '✕' : '✓'}</span>
      <span class="check-text">${item.text}</span>
    `;
    list.appendChild(li);
  });

  // Populate Store Revenue Protection Calculator
  const fin = calculateFinancials(store);
  const deficit = Math.max(0, store.standard - store.actual);
  
  if (simEnabled) {
    // RG Enabled: Show protected numbers
    document.getElementById('calc-active-no-rg').innerHTML = `<strong>${fin.activeCrewNoRG} head</strong> <span style="color: #dc2626; font-size: 11px; font-weight: 700">(${fin.statusNoRG})</span>`;
    document.getElementById('calc-active-with-rg').innerHTML = `<span style="color: #10b981; font-weight: 700">${store.actual < store.standard ? "+1 Reliever" : "0 (Fully Staffed)"}</span>`;
    document.getElementById('calc-compromise-level').innerHTML = `<strong>${store.actual} / ${store.standard} (Std)</strong> <span style="color: #10b981; font-size: 11px; font-weight: 700">(Current Position after RG)</span>`;
    
    document.getElementById('calc-daily-protected').textContent = `+₹${fin.dailyProtected.toLocaleString('en-IN')}/day`;
    document.getElementById('calc-sales-leakage').textContent = `+₹${fin.salesProtected.toLocaleString('en-IN')}/month`;
    document.getElementById('calc-salary-saved').textContent = `₹${fin.rgCost.toLocaleString('en-IN')}`;
    
    const storeNetImpactEl = document.getElementById('calc-net-impact');
    storeNetImpactEl.textContent = `${fin.netBenefit < 0 ? '-' : '+'}₹${Math.abs(fin.netBenefit).toLocaleString('en-IN')}/month`;
    storeNetImpactEl.className = fin.netBenefit < 0 ? "text-bold text-red" : "text-bold text-green";

    const recBox = document.getElementById('calc-recommendation-box');
    if (deficit > 0) {
      recBox.className = "calc-recommendation active green";
      recBox.style.display = "block";
      recBox.innerHTML = `
        <strong>RG Relief Active:</strong> Deploying 1 RG to cover weekly offs (Cost: <strong>₹${fin.rgCost.toLocaleString('en-IN')}</strong>: regional salary + ₹1.5k accommodation) protects the daily store crew from dropping below Threshold. This recovers <strong>₹${fin.salesProtected.toLocaleString('en-IN')}</strong> in monthly sales, yielding a net protected profit of <strong>₹${(fin.netBenefit).toLocaleString('en-IN')}/month</strong>!
      `;
    } else {
      recBox.className = "calc-recommendation green";
      recBox.style.display = "block";
      recBox.innerHTML = `
        <strong>Roster Optimal:</strong> Store is fully staffed. Weekly offs are covered, and daily active crew remains at Standard. No revenue leakage is active.
      `;
    }
  } else {
    // RG Disabled: Show leakage numbers
    document.getElementById('calc-active-no-rg').innerHTML = `<strong>${fin.activeCrewNoRG} head</strong> <span style="color: #dc2626; font-size: 11px; font-weight: 700">(${fin.statusNoRG})</span>`;
    document.getElementById('calc-active-with-rg').innerHTML = `<span style="color: #64748b; font-weight: 700">0 (Disabled)</span>`;
    document.getElementById('calc-compromise-level').innerHTML = `<strong>${fin.activeCrewNoRG} / ${store.standard} (Std)</strong> <span style="color: #dc2626; font-size: 11px; font-weight: 700">(Relief Disabled)</span>`;
    
    document.getElementById('calc-daily-protected').textContent = `₹0/day`;
    document.getElementById('calc-sales-leakage').textContent = `₹0/month`;
    document.getElementById('calc-salary-saved').textContent = `₹0 (Cost Saved)`;
    
    const storeNetImpactEl = document.getElementById('calc-net-impact');
    storeNetImpactEl.textContent = `₹0`;
    storeNetImpactEl.className = "text-bold text-red";

    const recBox = document.getElementById('calc-recommendation-box');
    if (deficit > 0) {
      recBox.className = "calc-recommendation active";
      recBox.style.display = "block";
      recBox.innerHTML = `
        <strong>⚠️ Relief Disabled Warning:</strong> Operating without relief cover drops your daily crew size to <strong>${fin.activeCrewNoRG} head</strong>. This triggers a monthly sales leakage of <strong>-₹${fin.salesProtected.toLocaleString('en-IN')}</strong> to save only <strong>₹${fin.rgCost.toLocaleString('en-IN')}</strong> in roster costs, causing a net monthly business leakage of <strong>-₹${Math.abs(fin.netBenefit).toLocaleString('en-IN')}/month</strong>!
      `;
    } else {
      recBox.className = "calc-recommendation green";
      recBox.style.display = "block";
      recBox.innerHTML = `
        <strong>Roster Optimal:</strong> Store is fully staffed. Disabling simulated cover has no impact because the base roster already satisfies standard requirements.
      `;
    }
  }
}

// Generate the operational compromise checklist items depending on store status
function getCompromiseChecklist(statusKey) {
  const standardPositive = [
    { text: "Roster / 0: Full operating capability (Grillers active, full menu online)", isCompromised: false },
    { text: "Standard transaction speeds (0% wait time compromise)", isCompromised: false },
    { text: "Standard operating hours (full opening cycle active)", isCompromised: false },
    { text: "Zero employee burn-out roster buffer online", isCompromised: false }
  ];

  const pressureCompromise = [
    { text: "Ops Metrics: Employee roster buffer compromised (cashiers multitasking)", isCompromised: true },
    { text: "Ops Metrics: Roster overtime active", isCompromised: true },
    { text: "Full menu and food preparation lines still maintained", isCompromised: false },
    { text: "Standard operating hours active", isCompromised: false }
  ];

  const thresholdCompromise = [
    { text: "G: Kitchen Griller removed from assembly station", isCompromised: true },
    { text: "G: Food production capacities decreased (longer prep delays)", isCompromised: true },
    { text: "G: Peak wait times increased for delivery and walk-ins", isCompromised: true },
    { text: "Full menu still active with increased wait bottlenecks", isCompromised: false }
  ];

  const criticalCompromise = [
    { text: "G: Griller closed. Wraps and grilled products marked sold out", isCompromised: true },
    { text: "G: Menu restrictions active (up to 30% of core menu offline)", isCompromised: true },
    { text: "G: Extended wait times causing delivery order cancellations", isCompromised: true },
    { text: "Direct store revenue leakage starting", isCompromised: true }
  ];

  const bareminCompromise = [
    { text: "G & T: Store Operating Timing reduced (outlet forced to close in off-peaks)", isCompromised: true },
    { text: "G & T: Severe menu restrictions (only Biryani and basic products online)", isCompromised: true },
    { text: "G & T: Extreme wait times (exceeding 20 minutes)", isCompromised: true },
    { text: "G & T: Immediate Relieving Group (RG) deployment required to prevent closure", isCompromised: true },
    { text: "Significant store revenue leakage in progress", isCompromised: true }
  ];

  const closedCompromise = [
    { text: "Store Closed: Manpower headcount at zero", isCompromised: true },
    { text: "Zero sales volume generated", isCompromised: true }
  ];

  switch(statusKey) {
    case 'standard': return standardPositive;
    case 'pressure': return pressureCompromise;
    case 'threshold': return thresholdCompromise;
    case 'critical': return criticalCompromise;
    case 'baremin': return bareminCompromise;
    case 'closed': return closedCompromise;
    default: return standardPositive;
  }
}

// Render All Stores Table View
function renderAllStoresView() {
  const tbody = document.querySelector('#table-all-stores tbody');
  const tfoot = document.getElementById('allstores-tfoot');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Sort stores alphabetically by city then store name
  const sorted = [...storeData].sort((a, b) => {
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.storeName.localeCompare(b.storeName);
  });

  let totalStd = 0, totalAct = 0, totalTh = 0, totalBm = 0, totalRg = 0;

  sorted.forEach((s, idx) => {
    const status = getStoreStatus(s);
    totalStd += s.standard;
    totalAct += s.actual;
    totalTh += s.threshold;
    totalBm += s.bareMinimum;
    totalRg += s.rgRequired;

    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${s.storeName}</strong></td>
      <td>${s.city}</td>
      <td>${s.standard}</td>
      <td><strong>${s.actual}</strong></td>
      <td>${s.threshold}</td>
      <td>${s.bareMinimum}</td>
      <td><span class="${s.rgRequired > 0 ? 'text-yellow' : ''}">${s.rgRequired}</span></td>
      <td><span class="status-badge ${status.key}">${status.label}</span></td>
    `;
    tr.addEventListener('click', () => {
      selectedStoreId = `${s.city}::${s.storeName}`;
      document.getElementById('store-select').value = selectedStoreId;
      document.querySelector('[data-view="store"]').click();
      renderStoreView();
    });
    tbody.appendChild(tr);
  });

  // Fill summary chips
  const deficit = totalStd - totalAct;
  document.getElementById('all-total-stores').textContent = sorted.length;
  document.getElementById('all-total-std').textContent = totalStd;
  document.getElementById('all-total-act').textContent = totalAct;
  document.getElementById('all-total-deficit').textContent = deficit;
  document.getElementById('all-total-rg').textContent = totalRg;

  // Footer totals row
  if (tfoot) {
    tfoot.innerHTML = `
      <tr class="totals-row">
        <td></td>
        <td><strong>TOTAL</strong></td>
        <td>${sorted.length} stores</td>
        <td><strong>${totalStd}</strong></td>
        <td><strong>${totalAct}</strong></td>
        <td><strong>${totalTh}</strong></td>
        <td><strong>${totalBm}</strong></td>
        <td><strong>${totalRg}</strong></td>
        <td><span class="status-badge ${deficit > 0 ? 'critical' : 'standard'}">Deficit: ${deficit}</span></td>
      </tr>
    `;
  }
}
function renderScatterPlot() {
  const svg = document.getElementById('scatter-chart');
  if (!svg) return;
  svg.innerHTML = '';

  // Chart dimensions
  const W = 800, H = 500;
  const PAD_L = 55, PAD_R = 175, PAD_T = 25, PAD_B = 65; // Expanded PAD_R for interactive legend
  const plotL = PAD_L, plotR = W - PAD_R, plotT = PAD_T, plotB = H - PAD_B;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  // Y-axis range 0..12
  const yMax = 12;
  function yScale(val) { return plotB - (val / yMax) * plotH; }

  // X-axis range 0..45L (4,500,000 Rupees)
  const xMax = 4500000;
  function xScale(val) { return plotL + (val / xMax) * plotW; }

  // Region colors mapping
  const regionColors = {
    "Delhi": "#3b82f6",
    "Gurgaon": "#10b981",
    "Noida": "#8b5cf6",
    "Faridabad": "#64748b",
    "Pune": "#f59e0b",
    "Navi Mumbai": "#ec4899",
    "Mumbai": "#14b8a6"
  };

  // Calculate dynamic company-wide averages
  const n = storeData.length || 1;
  const avgStandard = storeData.reduce((a, s) => a + s.standard, 0) / n;
  const avgThreshold = storeData.reduce((a, s) => a + s.threshold, 0) / n;
  const avgBareMin = storeData.reduce((a, s) => a + s.bareMinimum, 0) / n;

  const stdY = yScale(avgStandard);
  const thY = yScale(avgThreshold);
  const bmY = yScale(avgBareMin);

  // ── 1. Zone background bands (full width of plot area) ──
  // Green zone: above Standard line → top of chart
  drawRect(svg, plotL, plotT, plotW, stdY - plotT, '#e6f9f0');
  // Yellow zone: between Standard and Threshold
  drawRect(svg, plotL, stdY, plotW, thY - stdY, '#fef9e7');
  // Orange zone: between Threshold and Bare Min
  drawRect(svg, plotL, thY, plotW, bmY - thY, '#fef3e2');
  // Red zone: below Bare Min → bottom
  drawRect(svg, plotL, bmY, plotW, plotB - bmY, '#fde8e8');

  // ── 2. Horizontal gridlines & Y ticks ──
  for (let v = 0; v <= yMax; v++) {
    const y = yScale(v);
    svg.appendChild(createSVG('line', { x1: plotL, y1: y, x2: plotR, y2: y, stroke: '#e2e8f0', 'stroke-width': 0.5 }));
    // Y-axis tick label
    const lbl = createSVG('text', { x: plotL - 8, y: y + 4, 'text-anchor': 'end', fill: '#64748b', 'font-size': '11px', 'font-weight': '500' });
    lbl.textContent = v;
    svg.appendChild(lbl);
  }

  // ── 3. Vertical gridlines & X ticks (every 5L) ──
  for (let s = 500000; s <= xMax; s += 500000) {
    const x = xScale(s);
    svg.appendChild(createSVG('line', { x1: x, y1: plotT, x2: x, y2: plotB, stroke: '#e2e8f0', 'stroke-width': 0.5, 'stroke-dasharray': '3,3' }));
    
    // X tick mark
    svg.appendChild(createSVG('line', { x1: x, y1: plotB, x2: x, y2: plotB + 5, stroke: '#94a3b8', 'stroke-width': 1.5 }));
    
    // X tick label (e.g. 5L, 10L)
    const lbl = createSVG('text', { x: x, y: plotB + 20, 'text-anchor': 'middle', fill: '#475569', 'font-size': '11px', 'font-weight': '600' });
    lbl.textContent = `${s / 100000}L`;
    svg.appendChild(lbl);
  }

  // ── 4. Axis lines ──
  svg.appendChild(createSVG('line', { x1: plotL, y1: plotT, x2: plotL, y2: plotB, stroke: '#94a3b8', 'stroke-width': 1.5 }));
  svg.appendChild(createSVG('line', { x1: plotL, y1: plotB, x2: plotR, y2: plotB, stroke: '#94a3b8', 'stroke-width': 1.5 }));

  // Axis titles
  const yTitle = createSVG('text', { x: 14, y: plotT + plotH / 2, 'text-anchor': 'middle', fill: '#0f172a', 'font-size': '12px', 'font-weight': '700', transform: `rotate(-90, 14, ${plotT + plotH/2})` });
  yTitle.textContent = 'Manpower (Headcount)';
  svg.appendChild(yTitle);
  const xTitle = createSVG('text', { x: plotL + plotW / 2, y: H - 8, 'text-anchor': 'middle', fill: '#0f172a', 'font-size': '12px', 'font-weight': '700' });
  xTitle.textContent = 'Monthly Store Sales (Rupees in Lakhs)';
  svg.appendChild(xTitle);

  // ── 5. Three horizontal reference lines ──
  // Standard line (green, solid)
  svg.appendChild(createSVG('line', { x1: plotL, y1: stdY, x2: plotR, y2: stdY, stroke: '#10b981', 'stroke-width': 2.5 }));
  // Threshold line (orange, dashed)
  svg.appendChild(createSVG('line', { x1: plotL, y1: thY, x2: plotR, y2: thY, stroke: '#ea580c', 'stroke-width': 2.5, 'stroke-dasharray': '8,5' }));
  // Bare Minimum line (red, dashed)
  svg.appendChild(createSVG('line', { x1: plotL, y1: bmY, x2: plotR, y2: bmY, stroke: '#dc2626', 'stroke-width': 2.5, 'stroke-dasharray': '4,4' }));

  // ── 6. Line labels (aligned near right side of plot area) ──
  function addLineLabel(y, text, color) {
    const bg = createSVG('rect', { x: plotR - 165, y: y - 11, width: 160, height: 16, rx: 3, fill: '#ffffff', 'fill-opacity': 0.95 });
    svg.appendChild(bg);
    const t = createSVG('text', { x: plotR - 5, y: y + 3, 'text-anchor': 'end', fill: color, 'font-size': '10px', 'font-weight': '700' });
    t.textContent = text;
    svg.appendChild(t);
  }
  addLineLabel(stdY, `Std — Roster / 0 (${avgStandard.toFixed(1)})`, '#047857');
  addLineLabel(thY, `Threshold — G (${avgThreshold.toFixed(1)})`, '#ea580c');
  addLineLabel(bmY, `Bare Min — G&T (${avgBareMin.toFixed(1)})`, '#dc2626');

  // ── 7. Zone labels (left side inside bands) ──
  function addZoneLabel(y, text, color) {
    const t = createSVG('text', { x: plotL + 6, y: y, fill: color, 'font-size': '9px', 'font-weight': '700', opacity: 0.5 });
    t.textContent = text;
    svg.appendChild(t);
  }
  addZoneLabel((plotT + stdY) / 2 + 4, '🟢 Standard Zone — Full Menu, Optimal Speed', '#047857');
  addZoneLabel((stdY + thY) / 2 + 4, '🟡 Pressure Zone — Employee Multitasking', '#b45309');
  addZoneLabel((thY + bmY) / 2 + 4, '🟠 Threshold Zone — Griller Closed (G)', '#c2410c');
  addZoneLabel((bmY + plotB) / 2 + 4, '🔴 Critical / Bare Min — timing closed & G&T', '#991b1b');

  // ── 8. Draw interactive legend checkboxes on the far right ──
  const legendX = plotR + 20;
  const regionsList = ["Delhi", "Gurgaon", "Noida", "Faridabad", "Pune", "Navi Mumbai", "Mumbai"];
  
  // Legend Header
  const lHeader = createSVG('text', { x: legendX, y: plotT + 12, fill: '#0f172a', 'font-size': '11px', 'font-weight': '700' });
  lHeader.textContent = 'FILTER BY REGION:';
  svg.appendChild(lHeader);

  regionsList.forEach((r, idx) => {
    const y = plotT + 32 + idx * 24;
    const isChecked = activeRegions.includes(r);
    
    // Checkbox Group wrapper
    const g = createSVG('g', { class: 'legend-toggle-item', cursor: 'pointer' });
    
    // Checkbox box
    const box = createSVG('rect', { x: legendX, y: y - 10, width: 14, height: 14, rx: 3, fill: isChecked ? regionColors[r] : '#f1f5f9', stroke: '#cbd5e1', 'stroke-width': 1 });
    g.appendChild(box);

    // Check indicator
    if (isChecked) {
      const check = createSVG('path', { d: `M ${legendX+3} ${y-4} L ${legendX+6} ${y-1} L ${legendX+11} ${y-7}`, fill: 'none', stroke: '#ffffff', 'stroke-width': 2 });
      g.appendChild(check);
    }

    // Label text
    const label = createSVG('text', { x: legendX + 22, y: y + 1, fill: isChecked ? '#1e293b' : '#64748b', 'font-size': '11px', 'font-weight': '600' });
    label.textContent = r;
    g.appendChild(label);

    // Toggle event listener
    g.addEventListener('click', () => {
      if (activeRegions.includes(r)) {
        activeRegions = activeRegions.filter(x => x !== r);
      } else {
        activeRegions.push(r);
      }
      renderScatterPlot();
    });

    svg.appendChild(g);
  });

  // ── 8b. Draw Capability Compromises Key on the right ──
  const compYStart = plotT + 225;
  
  const cHeader = createSVG('text', { x: legendX, y: compYStart, fill: '#0f172a', 'font-size': '11px', 'font-weight': '700' });
  cHeader.textContent = 'OPS COMPROMISE DIRECTORY:';
  svg.appendChild(cHeader);

  const compromises = [
    {
      title: "🟢 Standard (Crew ≥ 6.7)",
      bullets: ["• None (Full Menu, Max Speed)", "• Optimal Employee Stress"]
    },
    {
      title: "🟡 Pressure (Crew 5.4 - 6.7)",
      bullets: ["• Employee Stress & Fatigue", "• Peak Hour Wait Time Pressure"]
    },
    {
      title: "🟠 Threshold (Crew 4.3 - 5.4)",
      bullets: ["• Griller Closed (No Wraps/Grills)", "• 15% Sales Loss & Brand Leak"]
    },
    {
      title: "🔴 Bare Min / Critical (< 4.3)",
      bullets: ["• Active Store Timings Slashed", "• 35% Sales Leakage", "• Severe Burnout & Attrition"]
    }
  ];

  let currentY = compYStart + 16;
  compromises.forEach(c => {
    // Title
    const t = createSVG('text', { x: legendX, y: currentY, fill: '#1e293b', 'font-size': '10px', 'font-weight': '700' });
    t.textContent = c.title;
    svg.appendChild(t);
    currentY += 12;

    // Bullets
    c.bullets.forEach(b => {
      const bEl = createSVG('text', { x: legendX + 4, y: currentY, fill: '#64748b', 'font-size': '9px', 'font-weight': '500' });
      bEl.textContent = b;
      svg.appendChild(bEl);
      currentY += 11;
    });
    
    currentY += 4;
  });

  // ── 9. Plot store dots ──
  let tooltipTimeout;

  storeData.forEach(s => {
    // Only plot if store region is active
    if (!activeRegions.includes(s.city)) return;

    const cx = xScale(s.juneSales);
    const displayedCrew = isReliefActiveForStore(s) ? s.actual : Math.max(0, s.actual - 1);
    const cy = yScale(displayedCrew);
    const fillColor = regionColors[s.city] || '#64748b';
    const status = getStoreStatus(s);
    const fin = calculateFinancials(s);

    const dot = createSVG('circle', { 
      cx, 
      cy, 
      r: 7.5, 
      fill: fillColor, 
      stroke: '#ffffff', 
      'stroke-width': 1.5, 
      cursor: 'pointer',
      'data-store-id': `${s.city}::${s.storeName}`
    });
    dot.classList.add('store-dot');

    // Tooltip on hover
    dot.addEventListener('mouseover', () => {
      clearTimeout(tooltipTimeout);
      const tooltip = document.getElementById('chart-tooltip');
      
      // Position tooltip near the dot (slightly overlapping to prevent mouseout gaps)
      tooltip.style.left = `${cx + 10}px`;
      tooltip.style.top = `${cy - 10}px`;
      tooltip.classList.remove('hidden');

      // Populate tooltip HTML and bind events
      renderTooltipContent(s, fillColor, cx, cy);
    });

    dot.addEventListener('mouseout', () => {
      const tooltip = document.getElementById('chart-tooltip');
      tooltipTimeout = setTimeout(() => {
        tooltip.classList.add('hidden');
      }, 500);
    });

    dot.addEventListener('click', () => {
      selectedStoreId = `${s.city}::${s.storeName}`;
      document.getElementById('store-select').value = selectedStoreId;
      document.querySelector('[data-view="store"]').click();
      renderStoreView();
    });

    svg.appendChild(dot);
  });

  // Ensure tooltip stays open when hovered and closes when mouse leaves
  const tooltipEl = document.getElementById('chart-tooltip');
  if (tooltipEl) {
    tooltipEl.addEventListener('mouseover', () => {
      clearTimeout(tooltipTimeout);
    });
    tooltipEl.addEventListener('mouseleave', () => {
      tooltipEl.classList.add('hidden');
    });
  }
}

// Render dynamic tooltip template and bind its inner simulator switch
function renderTooltipContent(s, fillColor, cx, cy) {
  const tooltip = document.getElementById('chart-tooltip');
  const fin = calculateFinancials(s);
  const active = isReliefActiveForStore(s);
  
  let crewBreakdownHTML = '';
  let financialsHTML = '';

  if (active) {
    crewBreakdownHTML = `
      <div class="tooltip-row">
        <span>Base Daily Crew (No RG):</span>
        <span><strong>${fin.activeCrewNoRG} head</strong> <span style="color: #dc2626; font-size: 10px; font-weight: 700">(${fin.statusNoRG})</span></span>
      </div>
      <div class="tooltip-row">
        <span>RG Cover:</span>
        <span style="color: #10b981; font-weight: 700">${s.actual < s.standard ? "+1 Reliever" : "0 (Fully Staffed)"}</span>
      </div>
      <div class="tooltip-row">
        <span>Effective Daily Crew:</span>
        <span><strong>${s.actual} / ${s.standard} (Std)</strong> <span style="color: #10b981; font-size: 10px; font-weight: 700">(Current Position after RG)</span></span>
      </div>
    `;

    financialsHTML = `
      <div class="tooltip-row text-green"><span>Daily Protected Sales:</span><span>+₹${fin.dailyProtected.toLocaleString('en-IN')}/day</span></div>
      <div class="tooltip-row text-green"><span>Monthly Protected:</span><span>+₹${fin.salesProtected.toLocaleString('en-IN')}/month</span></div>
      <div class="tooltip-row text-red"><span>RG Relief Cost:</span><span>-₹${fin.rgCost.toLocaleString('en-IN')}</span></div>
      <div class="tooltip-status" style="background:#ecfdf5; color:#047857; border:1px solid #10b98120; margin-top:6px; font-weight: 700">
        Net ROI: +₹${fin.netBenefit.toLocaleString('en-IN')}/month
      </div>
    `;
  } else {
    // Disabled state: show real leakage numbers instead of 0!
    crewBreakdownHTML = `
      <div class="tooltip-row">
        <span>Base Daily Crew (No RG):</span>
        <span><strong>${fin.activeCrewNoRG} head</strong> <span style="color: #dc2626; font-size: 10px; font-weight: 700">(${fin.statusNoRG})</span></span>
      </div>
      <div class="tooltip-row">
        <span>RG Cover:</span>
        <span style="color: #64748b; font-weight: 700">0 (Disabled)</span>
      </div>
      <div class="tooltip-row">
        <span>Effective Daily Crew:</span>
        <span><strong>${fin.activeCrewNoRG} / ${s.standard} (Std)</strong> <span style="color: #dc2626; font-size: 10px; font-weight: 700">(Relief Disabled)</span></span>
      </div>
    `;

    financialsHTML = `
      <div class="tooltip-row text-red"><span>Daily Sales Leakage:</span><span>-₹${fin.dailyProtected.toLocaleString('en-IN')}/day</span></div>
      <div class="tooltip-row text-red"><span>Monthly Sales Leakage:</span><span>-₹${fin.salesProtected.toLocaleString('en-IN')}/month</span></div>
      <div class="tooltip-row text-green"><span>RG Cost Saved:</span><span>+₹${fin.rgCost.toLocaleString('en-IN')}</span></div>
      <div class="tooltip-status" style="background:#fef2f2; color:#991b1b; border:1px solid #dc262620; margin-top:6px; font-weight: 700">
        Net Leakage: -₹${Math.abs(fin.netBenefit).toLocaleString('en-IN')}/month
      </div>
    `;
  }

  tooltip.innerHTML = `
    <div class="tooltip-header" style="border-bottom: 2px solid ${fillColor}">${s.storeName}</div>
    <div class="tooltip-row"><span>Region:</span><span>${s.city}</span></div>
    <div class="tooltip-row"><span>June Sales:</span><span>₹${s.juneSales.toLocaleString('en-IN')}</span></div>
    
    <div style="border-top:1px solid #e2e8f0; margin-top:8px; padding-top:6px">
      ${crewBreakdownHTML}
    </div>
    
    <div style="border-top:1px dashed #cbd5e1; margin-top:8px; padding-top:6px">
      ${financialsHTML}
    </div>

    <div class="tooltip-row" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 11px; font-weight: 700; color: var(--accent-color);">Relief Cover (Simulate)</span>
      <label class="switch" style="transform: scale(0.95); cursor: pointer;">
        <input type="checkbox" id="toggle-tooltip-rg" ${active ? 'checked' : ''}>
        <span class="slider round"></span>
      </label>
    </div>
  `;

  // Bind change event inside the tooltip checkbox
  const cb = document.getElementById('toggle-tooltip-rg');
  if (cb) {
    cb.addEventListener('change', (e) => {
      globalRgEnabled = e.target.checked;
      
      // Update other switch controls checked states
      const globalCb = document.getElementById('toggle-global-rg');
      if (globalCb) globalCb.checked = globalRgEnabled;
      
      const storeCb = document.getElementById('toggle-rg-sim');
      if (storeCb) storeCb.checked = globalRgEnabled;

      // Update dots on SVG chart (Trigger the CSS transition animation!)
      const svg = document.getElementById('scatter-chart');
      const yMax = 12;
      const PAD_T = 25, PAD_B = 65;
      const H = 500;
      const plotH = H - PAD_B - PAD_T;
      function yScale(val) { return (H - PAD_B) - (val / yMax) * plotH; }

      storeData.forEach(st => {
        const circle = svg.querySelector(`circle[data-store-id="${st.city}::${st.storeName}"]`);
        if (circle) {
          const crew = globalRgEnabled ? st.actual : Math.max(0, st.actual - 1);
          circle.setAttribute('cy', yScale(crew));
        }
      });

      // Refresh other dashboard metrics
      renderOverallView();
      renderStoreView();

      // Refresh tooltip HTML content in-place (keeps tooltip open)
      renderTooltipContent(s, fillColor, cx, cy);
    });
  }
}

// ── SVG helpers ──
function createSVG(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function drawLine(svg, x1, y1, x2, y2, className) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  if (className) line.setAttribute('class', className);
  svg.appendChild(line);
}

function drawRect(svg, x, y, w, h, fill) {
  const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', x); r.setAttribute('y', y);
  r.setAttribute('width', w); r.setAttribute('height', h);
  r.setAttribute('fill', fill);
  svg.appendChild(r);
}

function drawText(svg, x, y, text, className, textAnchor) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('x', x); el.setAttribute('y', y);
  el.setAttribute('text-anchor', textAnchor || 'start');
  if (className) el.setAttribute('class', className);
  el.textContent = text;
  svg.appendChild(el);
}

function drawPath(svg, d, className) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  if (className) p.setAttribute('class', className);
  svg.appendChild(p);
}

// Setup Event Listeners for Tab Navigation and Dropdown Filters
function setupEventListeners() {
  // Tab Click Handlers
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');

      // Hide all panels
      const panels = document.querySelectorAll('.view-panel');
      panels.forEach(p => p.classList.remove('active'));

      // Show selected panel
      activeView = e.target.getAttribute('data-view');
      document.getElementById(`panel-${activeView}`).classList.add('active');
    });
  });

  // City Selector Dropdown change listener
  document.getElementById('city-select').addEventListener('change', (e) => {
    selectedCity = e.target.value;
    renderCityView();
  });

  // Store Selector Dropdown change listener
  document.getElementById('store-select').addEventListener('change', (e) => {
    selectedStoreId = e.target.value;
    
    // Reset simulation toggle back to enabled on store selection change
    globalRgEnabled = true;
    const globalCb = document.getElementById('toggle-global-rg');
    if (globalCb) globalCb.checked = true;

    const toggleEl = document.getElementById('toggle-rg-sim');
    if (toggleEl) toggleEl.checked = true;

    // Slide dots dynamically
    animateDotsToCurrentState();

    renderStoreView();
  });

  // Simulate RG Relief cover change listener (Store View)
  const toggleEl = document.getElementById('toggle-rg-sim');
  if (toggleEl) {
    toggleEl.addEventListener('change', (e) => {
      globalRgEnabled = e.target.checked;
      
      const globalCb = document.getElementById('toggle-global-rg');
      if (globalCb) globalCb.checked = globalRgEnabled;

      // Slide dots dynamically
      animateDotsToCurrentState();

      // Refresh metrics
      renderOverallView();
      renderStoreView();
    });
  }

  // Simulate Global RG Relief cover change listener (Chart Card)
  const globalToggleEl = document.getElementById('toggle-global-rg');
  if (globalToggleEl) {
    globalToggleEl.addEventListener('change', (e) => {
      globalRgEnabled = e.target.checked;

      const storeCb = document.getElementById('toggle-rg-sim');
      if (storeCb) storeCb.checked = globalRgEnabled;

      // Slide dots dynamically
      animateDotsToCurrentState();

      // Refresh metrics
      renderOverallView();
      renderStoreView();
    });
  }

  // Sandbox Accommodation Hub placement controls
  const sandboxBtn = document.getElementById('btn-sandbox-hub');
  if (sandboxBtn) {
    sandboxBtn.addEventListener('click', () => {
      sandboxModeActive = !sandboxModeActive;
      if (sandboxModeActive) {
        sandboxBtn.style.background = '#ea580c'; // Highlight Orange
        sandboxBtn.style.boxShadow = '0 4px 6px rgba(234, 88, 12, 0.3)';
        sandboxBtn.firstElementChild.textContent = '📍 Click Map to Build Hub...';
        document.getElementById('store-map').style.cursor = 'crosshair';
      } else {
        sandboxBtn.style.background = '#2563eb';
        sandboxBtn.style.boxShadow = '0 4px 6px rgba(37, 99, 235, 0.2)';
        sandboxBtn.firstElementChild.textContent = '🏠 Place Accommodation Hub';
        document.getElementById('store-map').style.cursor = '';
      }
    });
  }

  const clearSandboxBtn = document.getElementById('btn-clear-sandbox');
  if (clearSandboxBtn) {
    clearSandboxBtn.addEventListener('click', () => {
      customHubs = [];
      clearSandboxBtn.style.display = 'none';
      replotLeafletMap();
      calculateAndRender();
    });
  }
}

// Helper to slide dots to their current crew positions (triggering CSS transitions)
function animateDotsToCurrentState() {
  const svg = document.getElementById('scatter-chart');
  if (!svg) return;
  const yMax = 12;
  const PAD_T = 25, PAD_B = 65;
  const H = 500;
  const plotH = H - PAD_B - PAD_T;
  function yScale(val) { return (H - PAD_B) - (val / yMax) * plotH; }

  storeData.forEach(st => {
    const circle = svg.querySelector(`circle[data-store-id="${st.city}::${st.storeName}"]`);
    if (circle) {
      const crew = globalRgEnabled ? st.actual : Math.max(0, st.actual - 1);
      circle.setAttribute('cy', yScale(crew));
    }
  });
  
  // Keep Leaflet Map markers in sync
  updateMapMarkers();
}

// ── Leaflet geographical store mapping & Shared Accommodation Clusters logic ──

// Global Map variables
let mapInstance;
let mapStoreMarkers = [];

// Coordinates directory mapping (Normalized keys)
const storeCoordinates = {
  "sector 27": { lat: 28.573477, lng: 77.325157 },
  "kalbadevi": { lat: 18.943487, lng: 72.82958 },
  "kalbadevi - mumbai": { lat: 18.943487, lng: 72.82958 },
  "office hazaribagh": { lat: 24.004474, lng: 85.348352 },
  "abhishek office test": { lat: 28.62620184, lng: 77.37224103 },
  "mulund": { lat: 19.181661, lng: 72.957614 },
  "knowledge park": { lat: 28.576547, lng: 77.439256 },
  "noida office": { lat: 28.6261748, lng: 77.3721633 },
  "cr park": { lat: 28.542804, lng: 77.248967 },
  "woh office": { lat: 28.6474801, lng: 77.1326367 },
  "wfh naini": { lat: 25.40473, lng: 81.834961 },
  "south city ii": { lat: 28.41929, lng: 77.047961 },
  "south city 2": { lat: 28.41929, lng: 77.047961 },
  "badshahpur": { lat: 28.388932, lng: 77.048613 },
  "najafgarh": { lat: 28.6090, lng: 76.9796 },
  "thane west": { lat: 19.2184, lng: 72.9781 },
  "noida sec 18": { lat: 28.5703, lng: 77.3218 },
  "mahipalpur": { lat: 28.5494, lng: 77.131487 },
  "jharsa": { lat: 28.440748, lng: 77.051003 },
  "dlf phase 5": { lat: 28.450942, lng: 77.094832 },
  "khera dewat road": { lat: 28.471688, lng: 77.023721 },
  "khara dawat": { lat: 28.471688, lng: 77.023721 },
  "bank colony deoli": { lat: 28.4981, lng: 77.2281 },
  "head office": { lat: 28.6139, lng: 77.2090 },
  "sector 86 noida": { lat: 28.5123, lng: 77.4021 },
  "sector 86": { lat: 28.5123, lng: 77.4021 },
  "elpro": { lat: 18.62801, lng: 73.783501 },
  "loni kalbhor": { lat: 18.4879, lng: 74.0182 },
  "loni kalbhor test": { lat: 18.4879, lng: 74.0182 },
  "lajpat nagar": { lat: 28.575304, lng: 77.241997 },
  "mukherjee nagar": { lat: 28.699113, lng: 77.208226 },
  "mukharjee nagar": { lat: 28.699113, lng: 77.208226 },
  "mayur vihar kondli": { lat: 28.606471, lng: 77.29359 },
  "mayur vihar": { lat: 28.606471, lng: 77.29359 },
  "sector 130 n": { lat: 28.494674, lng: 77.39191 },
  "sector 130": { lat: 28.494674, lng: 77.39191 },
  "indirapuram": { lat: 28.640188, lng: 77.377652 },
  "sector 66 noida": { lat: 28.6027871, lng: 77.3738387 },
  "sector 66": { lat: 28.6027871, lng: 77.3738387 },
  "dilshad garden": { lat: 28.684513, lng: 77.314178 },
  "titwala": { lat: 19.301609, lng: 73.21876 },
  "kalamboli": { lat: 19.041826, lng: 73.101517 },
  "dadar": { lat: 19.020672, lng: 72.852295 },
  "borivali": { lat: 19.217463, lng: 72.8451 },
  "hinjewadi phase 3": { lat: 18.583429, lng: 73.682205 },
  "alpha 1 noida": { lat: 28.473997, lng: 77.512606 },
  "alpha": { lat: 28.473997, lng: 77.512606 },
  "knowledge park 5": { lat: 28.576547, lng: 77.439256 },
  "badarpur": { lat: 28.498305, lng: 77.290231 },
  "rajouri garden": { lat: 28.648075, lng: 77.128839 },
  "saket": { lat: 28.523631, lng: 77.193386 },
  "ghorpadi pune": { lat: 18.518183, lng: 73.90686 },
  "ghorpadi": { lat: 18.518183, lng: 73.90686 },
  "upper thane": { lat: 19.2201, lng: 73.0112 },
  "charcoal eats - kharadi": { lat: 18.5604, lng: 73.9427 },
  "humayupur": { lat: 28.56241, lng: 77.196625 },
  "gaur city": { lat: 28.614367, lng: 77.423943 },
  "faridabad sector 81": { lat: 28.388696, lng: 77.348376 },
  "faridabad sec 81": { lat: 28.388696, lng: 77.348376 },
  "pimple saudagar pune": { lat: 18.596436, lng: 73.792831 },
  "pimple saudagar": { lat: 18.596436, lng: 73.792831 },
  "vishrantwadi": { lat: 18.597911, lng: 73.903721 },
  "manesar": { lat: 28.3512, lng: 76.9382 },
  "pashchim vihar (closed)": { lat: 28.6672, lng: 77.0912 },
  "faridabad 16a": { lat: 28.413735, lng: 77.319267 },
  "faridabad 16 a": { lat: 28.413735, lng: 77.319267 },
  "karol bagh": { lat: 28.646653, lng: 77.182912 },
  "rohini 24": { lat: 28.7354, lng: 77.1192 },
  "rohini 15": { lat: 28.731771, lng: 77.127574 },
  "pitampura": { lat: 28.696261, lng: 77.115515 },
  "dwarka mor": { lat: 28.619752, lng: 77.029375 },
  "janakpuri": { lat: 28.620471, lng: 77.082494 },
  "laxmi nagar": { lat: 28.641485, lng: 77.282775 },
  "sanjay nagar": { lat: 28.693117, lng: 77.449007 },
  "keshav nagar": { lat: 18.52877, lng: 73.94693 },
  "ulhas nagar": { lat: 19.207001, lng: 73.165013 },
  "andheri east": { lat: 19.123714, lng: 72.86393 },
  "pygciviloffice": { lat: 25.449638, lng: 81.824153 },
  "shahpur jat": { lat: 28.547255, lng: 77.214388 },
  "sector 85 g": { lat: 28.403126, lng: 76.949728 },
  "sector 85": { lat: 28.403126, lng: 76.949728 },
  "dwarka": { lat: 28.586666, lng: 77.04572 },
  "dwarka sec 11": { lat: 28.586666, lng: 77.04572 },
  "heera panna": { lat: 18.9762, lng: 72.8123 },
  "sector 49 noida": { lat: 28.568071, lng: 77.369052 },
  "sector 49": { lat: 28.568071, lng: 77.369052 },
  "baner": { lat: 18.55974, lng: 73.789993 },
  "nathupura": { lat: 28.478306, lng: 77.099983 },
  "nathupur": { lat: 28.478306, lng: 77.099983 },
  "bhandup west": { lat: 19.143486, lng: 72.930061 },
  "saki vihar": { lat: 19.115668, lng: 72.91823 },
  "palava city": { lat: 19.15763, lng: 73.07739 },
  "badlapur": { lat: 19.178401, lng: 73.222796 },
  "samta nagar": { lat: 19.207534, lng: 72.955474 },
  "majiwada": { lat: 19.229115, lng: 72.983331 },
  "nerul": { lat: 19.028152, lng: 73.016469 },
  "ulwe": { lat: 18.960714, lng: 73.020978 },
  "taloja": { lat: 19.073549, lng: 73.098129 },
  "mazgaon": { lat: 18.970284, lng: 72.841827 },
  "lower parel": { lat: 19.001087, lng: 72.82579 },
  "goregaon east": { lat: 19.17347, lng: 72.872849 },
  "kalina": { lat: 19.072531, lng: 72.869247 },
  "vidya vihar": { lat: 19.080027, lng: 72.888306 },
  "kharadi": { lat: 18.560457, lng: 73.942764 },
  "wagholi": { lat: 18.579819, lng: 73.979881 },
  "talegaon": { lat: 18.736521, lng: 73.671638 },
  "viman nagar": { lat: 18.560217, lng: 73.912651 },
  "phursungi": { lat: 18.485872, lng: 73.952454 },
  "katraj": { lat: 18.459265, lng: 73.846245 },
  "kandivali east": { lat: 19.20945, lng: 72.877426 },
  "vashi": { lat: 19.085651, lng: 73.002197 },
  "mira road": { lat: 19.30044, lng: 72.862648 },
  "shivaji nagar": { lat: 18.52994, lng: 73.826012 },
  "palam vihar": { lat: 28.515364, lng: 77.036623 },
  "dombivali": { lat: 19.204174, lng: 73.095356 },
  "kalyan": { lat: 19.243197, lng: 73.131681 },
  "chembur": { lat: 19.052739, lng: 72.902241 },
  "kharghar": { lat: 19.048161, lng: 73.065491 },
  "panvel": { lat: 18.990929, lng: 73.124641 },
  "malad west": { lat: 19.184938, lng: 72.843002 },
  "ramji market": { lat: 28.410252, lng: 77.092272 },
  "charkop": { lat: 19.206146, lng: 72.81913 },
  "virar": { lat: 19.466007, lng: 72.800018 },
  "nallasopara east": { lat: 19.403793, lng: 72.824181 },
  "vasai": { lat: 19.369469, lng: 72.813675 },
  "khar": { lat: 19.069345, lng: 72.839447 },
  "oshiwara": { lat: 19.146418, lng: 72.832497 },
  "dahisar": { lat: 19.25812, lng: 72.873901 },
  "kasarvadavli thane": { lat: 19.2612, lng: 72.9634 },
  "kasarvadavli": { lat: 19.2612, lng: 72.9634 },
  "versova": { lat: 19.128862, lng: 72.822319 },
  "wakad pune": { lat: 18.595018, lng: 73.760437 },
  "bhosari": { lat: 18.65484, lng: 73.844795 },
  "hinjewadi": { lat: 18.585268, lng: 73.730736 },
  "hinjewadi phase 1": { lat: 18.585268, lng: 73.730736 },
  "salunke vihar": { lat: 18.469172, lng: 73.900131 },
  "kothrud": { lat: 18.507801, lng: 73.803772 },
  "ravet pune": { lat: 18.654707, lng: 73.752937 },
  "nanded city": { lat: 18.456532, lng: 73.80217 },
  "airoli": { lat: 19.141335, lng: 72.996762 },
  "pune station": { lat: 18.5289, lng: 73.8744 },
  "dhanori": { lat: 18.5794, lng: 73.8967 }
};

// Hub Accommodations definitions (Shared clusters)
const mapHubs = [
  {
    id: "hub-gurgaon",
    name: "Gurgaon Shared Accommodation Hub (DLF Phase 5)",
    coords: [28.450942, 77.094832],
    city: "Gurgaon",
    cost: 20000,
    rgs: 3,
    members: ["jharsa", "dlf phase 5", "khera dewat road", "khara dawat", "nathupura", "nathupur", "south city ii", "south city 2", "badshahpur", "sector 85 g", "sector 85", "palam vihar", "gurugram sector 92", "kadirpur", "ramji market"]
  },
  {
    id: "hub-noida",
    name: "Noida Shared Accommodation Hub (Sector 66 Noida)",
    coords: [28.6027871, 77.3738387],
    city: "Noida",
    cost: 20000,
    rgs: 3,
    members: ["sector 66 noida", "sector 66", "noida office", "sector 27", "sector 49 noida", "sector 49", "sector 130 n", "sector 130", "gaur city", "knowledge park", "knowledge park 5", "alpha 1 noida", "alpha", "faridabad sector 81", "faridabad sec 81", "faridabad 16a", "faridabad 16 a", "sanjay nagar", "indirapuram", "sector 86 noida", "sector 86"]
  },
  {
    id: "hub-delhi",
    name: "Delhi Central Shared Accommodation Hub (Lajpat Nagar)",
    coords: [28.575304, 77.241997],
    city: "Delhi",
    cost: 20000,
    rgs: 3,
    members: ["lajpat nagar", "cr park", "mukherjee nagar", "mukharjee nagar", "rohini 15", "rohini 24", "pitampura", "janakpuri", "dwarka mor", "dwarka", "dwarka sec 11", "rajouri garden", "saket", "humayupur", "karol bagh", "dilshad garden", "badarpur", "woh office", "mahipalpur", "bank colony deoli", "head office", "mayur vihar", "mayur vihar kondli", "laxmi nagar", "shahpur jat"]
  },
  {
    id: "hub-mumbai-west",
    name: "Mumbai West Shared Accommodation Hub (Dadar)",
    coords: [19.020672, 72.852295],
    city: "Mumbai",
    cost: 20000,
    rgs: 4,
    members: ["dadar", "lower parel", "kalbadevi", "kalbadevi - mumbai", "mazgaon", "kalina", "vidya vihar", "andheri east", "bhandup west", "saki vihar", "versova", "oshiwara", "khar", "chembur"]
  },
  {
    id: "hub-mumbai-east",
    name: "Thane & Navi Mumbai Shared Accommodation Hub (Vashi)",
    coords: [19.085651, 73.002197],
    city: "Navi Mumbai",
    cost: 20000,
    rgs: 4,
    members: ["vashi", "nerul", "ulwe", "taloja", "kharghar", "panvel", "majiwada", "thane west", "kasarvadavli thane", "kasarvadavli", "dombivali", "kalyan", "ulhas nagar", "mira road", "dahisar", "borivali", "mulund", "charkop", "malad west", "kandivali east", "samta nagar", "badlapur", "palava city", "titwala", "kalamboli", "nallasopara east", "vasai", "virar", "airoli"]
  },
  {
    id: "hub-pune",
    name: "Pune Shared Accommodation Hub (Hinjewadi)",
    coords: [18.585268, 73.730736],
    city: "Pune",
    cost: 20000,
    rgs: 3,
    members: ["hinjewadi", "hinjewadi phase 3", "hinjewadi phase 1", "wakad pune", "wakad", "baner", "kothrud", "shivaji nagar", "viman nagar", "kharadi", "charcoal eats - kharadi", "wagholi", "bhosari", "pimple saudagar pune", "pimple saudagar", "ghorpadi pune", "ghorpadi", "vishrantwadi", "elpro", "keshav nagar", "phursungi", "katraj", "salunke vihar", "nanded city", "ravet pune", "talegaon", "loni kalbhor", "loni kalbhor test"]
  }
];

// House SVG Icon Helper (Hub Accommodation)
const houseSVG = `
  <svg viewBox="0 0 24 24" width="28" height="28" style="display: block; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.25));">
    <path d="M12 3L2 12h3v8h14v-8h3L12 3z" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" />
    <rect x="10" y="14" width="4" height="6" fill="#ffffff" />
    <path d="M17 5v4l2 2V5h-2z" fill="#1e3a8a" />
  </svg>
`;

// Store SVG Icon Helper (Outlets)
function getStoreSVG(color) {
  // Use CSS transition for path colors to make the state transition smooth!
  return `
    <svg viewBox="0 0 24 24" width="22" height="22" style="display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));">
      <path class="store-roof" d="M2 4h20v2H2z" fill="${color}" style="transition: fill 0.4s ease;" />
      <path class="store-flaps" d="M2 6l1 3h3l-1-3zm5 0l1 3h3l-1-3zm5 0l1 3h3l-1-3zm5 0l1 3h3l-1-3z" fill="${color}" opacity="0.9" style="transition: fill 0.4s ease;" />
      <path class="store-body" d="M4 9v11h16V9H4zm8 9H6v-5h6v5zm6 0h-4v-5h4v5z" fill="${color}" stroke="#ffffff" stroke-width="1.2" style="transition: fill 0.4s ease;" />
      <rect x="7" y="14" width="4" height="4" fill="#ffffff" opacity="0.8" />
    </svg>
  `;
}

// Initialize the Leaflet Map
function initLeafletMap() {
  const container = document.getElementById('store-map');
  if (!container) return;

  // Initialize Map center-focused on India
  mapInstance = L.map('store-map', {
    scrollWheelZoom: false
  }).setView([20.5937, 78.9629], 5);

  // Add CartoDB Positron Tile Layer (Premium Light Theme)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CartoDB</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(mapInstance);

  // Map click listener for sandbox mode
  mapInstance.on('click', (e) => {
    if (!sandboxModeActive) return;

    // Create new custom Hub at click coordinates
    const hubId = `hub-custom-${Date.now()}`;
    const newHub = {
      id: hubId,
      name: `Custom Hub Accommodation #${customHubs.length + 1}`,
      coords: [e.latlng.lat, e.latlng.lng],
      city: "Custom",
      cost: 20000,
      rgs: 3,
      members: []
    };

    // Associate member stores within 8km coverage
    storeData.forEach(s => {
      const nameClean = s.storeName.trim().toLowerCase();
      const coords = storeCoordinates[nameClean];
      if (!coords) return;

      const dist = mapInstance.distance(e.latlng, [coords.lat, coords.lng]);
      if (dist <= 8000) { // 8 km
        newHub.members.push(nameClean);
      }
    });

    customHubs.push(newHub);

    // Reset Sandbox state
    sandboxModeActive = false;
    document.getElementById('store-map').style.cursor = '';
    const btn = document.getElementById('btn-sandbox-hub');
    if (btn) {
      btn.style.background = '#2563eb';
      btn.style.boxShadow = '0 4px 6px rgba(37, 99, 235, 0.2)';
      btn.firstElementChild.textContent = '🏠 Place Accommodation Hub';
    }

    const clearBtn = document.getElementById('btn-clear-sandbox');
    if (clearBtn) {
      clearBtn.style.display = 'inline-block';
    }

    // Refresh map layers and recalculate financials
    replotLeafletMap();
    calculateAndRender();
  });

  // Fit bounds to cover all Hubs
  const hubCoords = mapHubs.map(h => h.coords);
  const bounds = L.latLngBounds(hubCoords);
  mapInstance.fitBounds(bounds, { padding: [50, 50] });

  // Initial plot of default layers
  replotLeafletMap();

  // Start travel animations loop
  startPeriodicTravelAnimations();
}

// Re-plot Map Layers (clears overlays and redraws including custom hubs)
function replotLeafletMap() {
  if (!mapInstance) return;

  // Clear current markers, polylines, and circles
  mapInstance.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.Circle) {
      mapInstance.removeLayer(layer);
    }
  });

  mapStoreMarkers = [];
  const allHubs = [...mapHubs, ...customHubs];

  // 1. Draw Hubs and their Coverage Circles
  allHubs.forEach(hub => {
    const isCustom = hub.id.includes('custom');

    // Draw 8km coverage radius circle
    L.circle(hub.coords, {
      radius: 8000, // 8 km
      color: isCustom ? '#ea580c' : '#2563eb', // Orange for custom, blue for standard
      fillColor: isCustom ? '#ea580c' : '#3b82f6',
      fillOpacity: 0.04,
      weight: 1,
      dashArray: '3, 4'
    }).addTo(mapInstance);

    // Hub Custom Icon (Orange house for custom hubs!)
    const hubIconHTML = isCustom 
      ? houseSVG.replace('fill="#2563eb"', 'fill="#ea580c"').replace('fill="#1e3a8a"', 'fill="#c2410c"') 
      : houseSVG;

    const hubIcon = L.divIcon({
      html: `<div style="transform: translate(-5px, -5px);">${hubIconHTML}</div>`,
      className: 'map-hub-icon',
      iconSize: [28, 28]
    });

    const hubMarker = L.marker(hub.coords, {
      icon: hubIcon,
      zIndexOffset: 1000
    }).addTo(mapInstance);

    const hubPopupHTML = `
      <div style="font-family: 'Outfit', sans-serif; min-width: 210px; line-height: 1.45;">
        <strong style="font-size: 13px; color: ${isCustom ? '#c2410c' : '#1e3a8a'}; display: block; margin-bottom: 2px;">🏠 ${isCustom ? 'Custom Relief Hub' : 'Shared Accommodation Hub'}</strong>
        <span style="font-size: 11px; font-weight: 700; color: ${isCustom ? '#ea580c' : '#2563eb'};">${hub.name}</span>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 6px 0;"/>
        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <tr><td style="color: #64748b; padding: 2px 0;">Rent Cost:</td><td style="font-weight: 700; text-align: right;">₹20,000/mo</td></tr>
          <tr><td style="color: #64748b; padding: 2px 0;">Cost per Store:</td><td style="font-weight: 700; text-align: right; color: #047857;">~₹1,200 - ₹2,000/mo</td></tr>
          <tr><td style="color: #64748b; padding: 2px 0;">RGs Stationed:</td><td style="font-weight: 700; text-align: right;">${hub.rgs} Relievers</td></tr>
          <tr><td style="color: #64748b; padding: 2px 0;">Outlets Covered:</td><td style="font-weight: 700; text-align: right;">${hub.members.length} stores</td></tr>
        </table>
        <div style="background: ${isCustom ? '#fff7ed' : '#eff6ff'}; color: ${isCustom ? '#9a3412' : '#1e40af'}; border: 1px solid ${isCustom ? '#fed7aa' : '#bfdbfe'}; border-radius: 6px; padding: 6px 8px; margin-top: 8px; font-size: 10px; font-weight: 500;">
          💡 Shared geography allows relievers to travel rapidly, keeping store crew stable and preventing peak-hour menu closures.
         </div>
      </div>
    `;
    hubMarker.bindPopup(hubPopupHTML);
  });

  // 2. Draw Store markers and connection lines
  storeData.forEach(s => {
    const nameClean = s.storeName.trim().toLowerCase();
    const coords = storeCoordinates[nameClean];
    if (!coords) return; // Skip if no coords mapped

    // Find associated Hub
    const associatedHub = allHubs.find(hub => hub.members.includes(nameClean));
    if (associatedHub) {
      // Draw connection polyline - always blue to match the standard hubs
      L.polyline([associatedHub.coords, [coords.lat, coords.lng]], {
        color: '#3b82f6',
        weight: 1.25,
        dashArray: '3, 4',
        opacity: 0.5
      }).addTo(mapInstance);
    }

    // Determine color based on state
    const active = isReliefActiveForStore(s);
    const displayedCrew = active ? s.actual : Math.max(0, s.actual - 1);
    let color = '#dc2626'; // Red
    if (displayedCrew >= 6.7) color = '#059669'; // Green
    else if (displayedCrew >= 5.4) color = '#d97706'; // Yellow
    else if (displayedCrew >= 4.3) color = '#ea580c'; // Orange

    // Store Custom Icon using L.divIcon
    const storeIconId = `map-store-${s.city.replace(/\s+/g, '-')}-${s.storeName.replace(/\s+/g, '-')}`;
    const storeIcon = L.divIcon({
      html: `<div id="${storeIconId}" class="map-store-svg" style="transform: translate(-3px, -3px);">${getStoreSVG(color)}</div>`,
      className: 'map-store-icon',
      iconSize: [22, 22]
    });

    const marker = L.marker([coords.lat, coords.lng], {
      icon: storeIcon
    }).addTo(mapInstance);

    const popupHTML = `
      <div style="font-family: 'Outfit', sans-serif; line-height: 1.4;">
        <strong style="font-size: 13px; color: #0f172a; display: block;">🏪 ${s.storeName}</strong>
        <span style="color: #64748b; font-size: 10px;">Region: ${s.city} | Sales: ₹${s.juneSales.toLocaleString('en-IN')}</span>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 5px 0;"/>
        <div style="font-size: 11px;">
          Active Crew: <strong>${displayedCrew} / ${s.standard} (Std)</strong><br/>
          Operational Zone: <strong style="color: ${color};">${displayedCrew >= 6.7 ? 'Standard Operations' : displayedCrew >= 5.4 ? 'Pressure Zone' : displayedCrew >= 4.3 ? 'Threshold Zone' : 'Critical Staffing'}</strong>
        </div>
      </div>
    `;
    marker.bindPopup(popupHTML);

    mapStoreMarkers.push({ marker, store: s, coords });
  });
}

// Update Map markers dynamically when simulation is toggled (pure DOM modification for 60fps)
function updateMapMarkers() {
  if (!mapInstance) return;

  mapStoreMarkers.forEach(item => {
    const s = item.store;
    const active = isReliefActiveForStore(s);
    const displayedCrew = active ? s.actual : Math.max(0, s.actual - 1);
    
    let color = '#dc2626'; // Red
    let statusLabel = 'Critical Staffing';
    if (displayedCrew >= 6.7) { color = '#059669'; statusLabel = 'Standard Operations'; }
    else if (displayedCrew >= 5.4) { color = '#d97706'; statusLabel = 'Pressure Zone'; }
    else if (displayedCrew >= 4.3) { color = '#ea580c'; statusLabel = 'Threshold Zone'; }

    // Fast DOM injection directly into existing Leaflet marker DOM elements
    const storeIconId = `map-store-${s.city.replace(/\s+/g, '-')}-${s.storeName.replace(/\s+/g, '-')}`;
    const el = document.getElementById(storeIconId);
    if (el) {
      // Modify individual path elements instead of rewriting the entire innerHTML to trigger GPU rendering
      const paths = el.querySelectorAll('path');
      if (paths.length >= 3) {
        paths[0].setAttribute('fill', color);
        paths[1].setAttribute('fill', color);
        paths[2].setAttribute('fill', color);
      } else {
        el.innerHTML = getStoreSVG(color);
      }
    }

    const popupHTML = `
      <div style="font-family: 'Outfit', sans-serif; line-height: 1.4;">
        <strong style="font-size: 13px; color: #0f172a; display: block;">🏪 ${s.storeName}</strong>
        <span style="color: #64748b; font-size: 10px;">Region: ${s.city} | Sales: ₹${s.juneSales.toLocaleString('en-IN')}</span>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 5px 0;"/>
        <div style="font-size: 11px;">
          Active Crew: <strong>${displayedCrew} / ${s.standard} (Std)</strong><br/>
          Operational Zone: <strong style="color: ${color};">${statusLabel}</strong>
        </div>
      </div>
    `;
    item.marker.setPopupContent(popupHTML);
  });
}

// Animate a custom emoji character traveling along coordinates
function animateTravel(startCoords, endCoords, emoji, onArrival) {
  if (!mapInstance) return;

  const travelIcon = L.divIcon({
    html: `<div style="font-size: 16px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.35); text-align: center;">${emoji}</div>`,
    className: 'travel-icon-wrapper',
    iconSize: [20, 20]
  });

  const marker = L.marker(startCoords, { icon: travelIcon }).addTo(mapInstance);

  let steps = 50;
  let currentStep = 0;
  const interval = setInterval(() => {
    currentStep++;
    const progress = currentStep / steps;
    // Linear coordinate interpolation
    const lat = startCoords[0] + (endCoords[0] - startCoords[0]) * progress;
    const lng = startCoords[1] + (endCoords[1] - startCoords[1]) * progress;
    marker.setLatLng([lat, lng]);

    if (currentStep >= steps) {
      clearInterval(interval);
      mapInstance.removeLayer(marker);
      if (typeof onArrival === 'function') {
        onArrival();
      }
    }
  }, 35); // 1.75 seconds total travel animation time
}

// Periodically run travel animations on random active cluster links (60fps coordinate slide)
function startPeriodicTravelAnimations() {
  setInterval(() => {
    if (!mapInstance) return;

    // Default + custom hubs if global is enabled; otherwise only custom hubs trigger actions
    const activeHubs = globalRgEnabled ? [...mapHubs, ...customHubs] : customHubs;
    if (activeHubs.length === 0) return;

    // Pick a random hub
    const hub = activeHubs[Math.floor(Math.random() * activeHubs.length)];
    if (hub.members.length === 0) return;

    // Pick a random store in this hub's cluster
    const randomMemberName = hub.members[Math.floor(Math.random() * hub.members.length)];
    const storeMarkerObj = mapStoreMarkers.find(item => item.store.storeName.trim().toLowerCase() === randomMemberName);

    if (storeMarkerObj && storeMarkerObj.coords) {
      const storeCoords = [storeMarkerObj.coords.lat, storeMarkerObj.coords.lng];
      const s = storeMarkerObj.store;
      const nameClean = s.storeName.trim().toLowerCase();

      // Only animate if the store is not already permanently covered (to make the transition visible!)
      const alreadyCovered = globalRgEnabled || customHubs.some(h => h.members.includes(nameClean));
      
      // Dispatch reliever emoji (🚗) from Hub Accommodation to Store
      animateTravel(hub.coords, storeCoords, '🚗', () => {
        // Triggered upon reliever arrival: better the staffing situation temporarily!
        if (!alreadyCovered) {
          activeTempReliefStores.add(nameClean);
          
          // Re-render map marker colors (transitions from Red -> Orange / Orange -> Green!)
          updateMapMarkers();
          animateDotsToCurrentState();
          
          // Hold relief coverage for 4 seconds, then return to baseline state
          setTimeout(() => {
            activeTempReliefStores.delete(nameClean);
            updateMapMarkers();
            animateDotsToCurrentState();
          }, 4000);
        }
      });
    }
  }, 5000); // Trigger a new reliever travel journey every 5 seconds
}
