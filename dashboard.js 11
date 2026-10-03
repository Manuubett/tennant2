const statRow = document.getElementById("stat-row");
const tabsBox = document.getElementById("tabs");
const contentBox = document.getElementById("tab-content");
const pageTitle = document.getElementById("page-title");

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

document.getElementById("logout-btn").addEventListener("click", () => auth.signOut().then(() => window.location.href = "login.html"));

let activeTab = "overview";
let landlordsCache = [];
let unitsCache = [];
let tenantsCache = [];
let viewingTenantId = null;
let overviewCharts = {};

// Tracks which maintenance request threads are currently expanded on the
// tenant-profile view, so they stay open across re-renders (e.g. after
// marking a request resolved). Mirrors the same pattern in portal.js.
const expandedThreads = new Set();

// Bug fix: onSnapshot listeners (Payments, Deposits tabs) were never
// unsubscribed when switching tabs, so navigating back and forth stacked
// up duplicate listeners. Every listener-based tab pushes its unsubscribe
// function here, and renderActiveTab() clears them all before rendering
// whichever tab is now active.
let activeListeners = [];
function clearActiveListeners() {
  activeListeners.forEach((unsub) => {
    try { unsub(); } catch (e) { /* already detached */ }
  });
  activeListeners = [];
}

// Single source of truth for chart colors — canvas rendering can't read
// CSS custom properties directly, so these mirror the values in style.css.
const COLORS = {
  pink: "#e6007e",
  pinkSoft: "rgba(230,0,126,.12)",
  green: "#1e9e5a",
  greenTint: "#e8f7ee",
  amber: "#a9760a",
  amberTint: "#fdf3e0",
  red: "#b42323",
  redTint: "rgba(180,35,35,.10)",
  ink: "#10233f",
  inkSoft: "#4b5c72",
  inkFaint: "#8c99ac",
  border: "#e4e9f0",
  surface: "#ffffff"
};

const money = (n) => `KSh ${Number(n || 0).toLocaleString()}`;

// Hides and removes the full-screen splash (logo + spinner) shown while
// the dashboard's first data load is in flight. Called once the stat
// row and initial tab have actually been rendered — see the
// startLiveCaches(...) callback at the bottom of this file.
function hideLoadingOverlay() {
  const overlay = document.getElementById("app-loading-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
    setTimeout(() => overlay.remove(), 400);
  }
}

// Applied once so every chart on the page shares consistent typography
// and grid styling instead of Chart.js defaults.
(function configureChartDefaults() {
  if (typeof Chart === "undefined") return;
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  Chart.defaults.font.size = 12.5;
  Chart.defaults.color = COLORS.inkSoft;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "circle";
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Chart.defaults.plugins.tooltip.backgroundColor = COLORS.ink;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12.5 };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 12.5 };
})();

// Minimal line-icon set (Feather-style, 1.75 stroke) so each section reads at a glance in the sidebar
const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>',
  tenants: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  landlords: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6h6v6"/></svg>',
  units: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg>',
  deposits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11Z"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>'
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "payments", label: "Payments" },
  { key: "tenants", label: "Tenants" },
  { key: "landlords", label: "Landlords" },
  { key: "units", label: "Units" },
  { key: "deposits", label: "Deposits" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" }
];

function renderTabs() {
  tabsBox.innerHTML = TABS.map((t) => `
    <button class="tab-btn ${activeTab === t.key ? "active" : ""}" data-tab="${t.key}">${ICONS[t.key] || ""}<span>${t.label}</span></button>
  `).join("");
  if (pageTitle) {
    const current = TABS.find((t) => t.key === activeTab);
    pageTitle.textContent = current ? current.label : "";
  }
  tabsBox.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      viewingTenantId = null;
      renderTabs();
      renderActiveTab();
    });
  });
}

// ---------------------------------------------------------------------
// LIVE CACHES (landlords / units / tenants)
// ---------------------------------------------------------------------
// These three collections used to be re-fetched in full — three
// complete collection reads — on every single tab click, including
// clicking back to a tab you were already on a second ago. Firestore's
// onSnapshot already solves exactly this: it delivers one full snapshot
// up front, then pushes only the documents that actually changed after
// that. So these are now set up ONCE for the life of the page, and every
// tab render just reads whatever's currently sitting in the cache
// instead of awaiting a fresh fetch. As a bonus, changes another staff
// member makes now show up here live, without anyone needing to switch
// tabs to trigger a refetch.
let cachesReady = { landlords: false, units: false, tenants: false };
let liveCachesStarted = false;

function allCachesReady() {
  return cachesReady.landlords && cachesReady.units && cachesReady.tenants;
}

function startLiveCaches(onFirstReady) {
  if (liveCachesStarted) return;
  liveCachesStarted = true;
  let notifiedFirstReady = false;

  function handleUpdate(key) {
    cachesReady[key] = true;
    if (!notifiedFirstReady) {
      if (allCachesReady()) {
        notifiedFirstReady = true;
        if (onFirstReady) onFirstReady();
      }
      return;
    }
    // Caveat: like the existing Payments/Deposits onSnapshot handlers,
    // this re-renders whichever tab is currently open in full. If staff
    // have an "Add X" panel open with unsaved text when someone else's
    // change comes in, that in-progress input gets cleared — the same
    // tradeoff those two tabs already accept today.
    renderActiveTab();
  }

  db.collection("landlords").orderBy("name").onSnapshot((snap) => {
    landlordsCache = snap.docs;
    handleUpdate("landlords");
  });
  db.collection("units").onSnapshot((snap) => {
    unitsCache = snap.docs;
    handleUpdate("units");
  });
  db.collection("tenants").orderBy("name").onSnapshot((snap) => {
    tenantsCache = snap.docs;
    handleUpdate("tenants");
  });
}

function landlordName(id) {
  const doc = landlordsCache.find((d) => d.id === id);
  return doc ? doc.data().name : "Unknown";
}
function unitLabel(id) {
  const doc = unitsCache.find((d) => d.id === id);
  return doc ? doc.data().houseNumber : "Unknown unit";
}
function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}
async function getPaidUnitIdsThisMonth() {
  const { start, end } = currentMonthRange();
  const snap = await db.collection("payments")
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();
  return new Set(snap.docs.map((d) => d.data().unitId));
}
function isOverdue(tenant, paidUnitIds) {
  if (!tenant.unitId || paidUnitIds.has(tenant.unitId)) return false;
  if (tenant.leaseStartDate) {
    const leaseStart = new Date(tenant.leaseStartDate);
    if (!isNaN(leaseStart) && leaseStart > new Date()) return false;
  }
  const dueDay = Number(tenant.rentDueDay) || 5;
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  return now > dueDate;
}

function renderActiveTab() {
  clearActiveListeners();
  // Caches are kept live by startLiveCaches() (see above) — this only
  // waits on the very first load, before any snapshot has arrived yet.
  if (!allCachesReady()) {
    contentBox.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;
    return;
  }
  if (activeTab === "overview") renderOverviewTab();
  else if (activeTab === "payments") renderPaymentsTab();
  else if (activeTab === "tenants") renderTenantsTab();
  else if (activeTab === "landlords") renderLandlordsTab();
  else if (activeTab === "units") renderUnitsTab();
  else if (activeTab === "deposits") renderDepositsTab();
  else if (activeTab === "reports") renderReportsTab();
  else if (activeTab === "settings") renderSettingsTab();
}

// ---------------------------------------------------------------------
// COLLAPSIBLE "ADD / RECORD" PANEL HELPER
// ---------------------------------------------------------------------
// Wraps a form (or any block) in a collapsed-by-default panel with a
// toggle header, and returns the HTML string. Used so "Add Landlord",
// "Add Unit" and "Record Deposit" sit above their tables instead of
// buried below a long list, and can be tucked away when not needed.
// Call wireCollapsePanel(id) after inserting the HTML to hook up the
// toggle button; pass startOpen: true to render it expanded (e.g. when
// editing an existing record).
function collapsePanelHTML({ id, title, collapsedLabel, expandedLabel, bodyHTML, startOpen = false }) {
  return `
    <div class="card collapse-panel${startOpen ? " open" : ""}" id="${id}">
      <button type="button" class="collapse-panel-toggle" data-collapse-toggle="${id}" style="display:flex; align-items:center; justify-content:space-between; width:100%; background:none; border:none; cursor:pointer; padding:0; text-align:left;">
        <span class="card-title" id="${id}-title" style="margin:0;">${startOpen ? expandedLabel : collapsedLabel}</span>
        <svg class="collapse-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="flex-shrink:0; transition:transform .15s ease; transform:rotate(${startOpen ? "180" : "0"}deg);"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="collapse-panel-body" id="${id}-body" style="margin-top:${startOpen ? "14px" : "0"}; max-height:${startOpen ? "none" : "0"}; overflow:${startOpen ? "visible" : "hidden"};">
        ${bodyHTML}
      </div>
    </div>`;
}

function wireCollapsePanel(id, { expandedLabel, collapsedLabel } = {}) {
  const panel = document.getElementById(id);
  const body = document.getElementById(`${id}-body`);
  const titleEl = document.getElementById(`${id}-title`);
  if (!panel || !body) return;
  const toggleBtn = panel.querySelector(`[data-collapse-toggle="${id}"]`);
  const chevron = panel.querySelector(".collapse-chevron");

  function setOpen(open) {
    panel.classList.toggle("open", open);
    body.style.maxHeight = open ? "none" : "0";
    body.style.overflow = open ? "visible" : "hidden";
    body.style.marginTop = open ? "14px" : "0";
    if (chevron) chevron.style.transform = `rotate(${open ? 180 : 0}deg)`;
    if (titleEl && expandedLabel && collapsedLabel) {
      titleEl.textContent = open ? expandedLabel : collapsedLabel;
    }
  }

  toggleBtn.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  panel._setOpen = setOpen; // exposed so callers (e.g. "Edit") can force it open
}

// ---------------------------------------------------------------------
// OVERVIEW TAB (charts + PDF export)
// ---------------------------------------------------------------------
async function renderOverviewTab() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  const sixMonthsAgoStart = months[0];

  // Arrears-by-month queries used to run one at a time in a for-loop
  // (six sequential round trips). They're independent of each other, so
  // running them together with the trend/this-month queries cuts load
  // time roughly in half.
  const [trendSnap, thisMonthSnap, arrearsSnaps] = await Promise.all([
    db.collection("payments").where("status", "==", "verified").where("submittedAt", ">=", sixMonthsAgoStart).get(),
    (() => {
      const { start, end } = currentMonthRange();
      return db.collection("payments").where("submittedAt", ">=", start).where("submittedAt", "<", end).get();
    })(),
    Promise.all(months.map((m) => {
      const start = m;
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      return db.collection("payments")
        .where("status", "==", "verified")
        .where("submittedAt", ">=", start)
        .where("submittedAt", "<", end)
        .get();
    }))
  ]);

  if (activeTab !== "overview") return;

  // Monthly collected totals (verified payments only)
  const monthlyTotals = months.map(() => 0);
  trendSnap.docs.forEach((doc) => {
    const p = doc.data();
    if (!p.submittedAt) return;
    const date = p.submittedAt.toDate();
    const idx = months.findIndex((m) => m.getFullYear() === date.getFullYear() && m.getMonth() === date.getMonth());
    if (idx !== -1) monthlyTotals[idx] += Number(p.amount || 0);
  });

  // This month's status breakdown (all statuses)
  const statusCounts = { verified: 0, pending: 0, rejected: 0 };
  thisMonthSnap.docs.forEach((doc) => {
    const s = doc.data().status;
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  // Arrears trend — occupied units with no verified payment that month.
  // Uses today's unit list for all 6 months since we don't track historical
  // occupancy changes; treat this as an approximation, not an exact record.
  const occupiedUnits = unitsCache.filter((u) => u.data().occupancy !== "vacant");
  const arrearsByMonth = arrearsSnaps.map((snap) => {
    const paidUnitIds = new Set(snap.docs.map((d) => d.data().unitId));
    return occupiedUnits.filter((u) => !paidUnitIds.has(u.id)).length;
  });

  const occupiedCount = occupiedUnits.length;
  const vacantCount = unitsCache.length - occupiedCount;
  const monthLabels = months.map((m) => m.toLocaleString("en-KE", { month: "short" }));

  contentBox.innerHTML = `
    <div class="overview-actions"><button class="btn btn-primary" id="btn-download-pdf">Download PDF Report</button></div>
    <div class="chart-card">
      <div class="card-title">Rent Collected — Last 6 Months</div>
      <div class="chart-canvas-wrap"><canvas id="chart-trend"></canvas></div>
    </div>
    <div class="chart-grid-2">
      <div class="chart-card">
        <div class="card-title">Payment Status — This Month</div>
        <div class="chart-canvas-wrap chart-canvas-wrap-sm"><canvas id="chart-status"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="card-title">Occupancy</div>
        <div class="chart-canvas-wrap chart-canvas-wrap-sm"><canvas id="chart-occupancy"></canvas></div>
      </div>
    </div>
    <div class="chart-card">
      <div class="card-title">Arrears Trend — Last 6 Months</div>
      <div class="chart-canvas-wrap"><canvas id="chart-arrears"></canvas></div>
    </div>`;

  Object.values(overviewCharts).forEach((c) => c.destroy());
  overviewCharts = {};

  overviewCharts.trend = new Chart(document.getElementById("chart-trend"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{
        label: "Rent Collected",
        data: monthlyTotals,
        backgroundColor: COLORS.pink,
        hoverBackgroundColor: "#c40068",
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 46
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => money(ctx.parsed.y) } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.border },
          border: { display: false },
          ticks: { callback: (v) => v >= 1000 ? `${v / 1000}k` : v }
        }
      }
    }
  });

  overviewCharts.status = new Chart(document.getElementById("chart-status"), {
    type: "doughnut",
    data: {
      labels: ["Verified", "Pending", "Rejected"],
      datasets: [{
        data: [statusCounts.verified, statusCounts.pending, statusCounts.rejected],
        backgroundColor: [COLORS.green, COLORS.amber, COLORS.red],
        borderColor: COLORS.surface,
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}` } }
      }
    }
  });

  overviewCharts.arrears = new Chart(document.getElementById("chart-arrears"), {
    type: "line",
    data: {
      labels: monthLabels,
      datasets: [{
        label: "Units in Arrears",
        data: arrearsByMonth,
        borderColor: COLORS.red,
        backgroundColor: COLORS.redTint,
        pointBackgroundColor: COLORS.red,
        pointBorderColor: COLORS.surface,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} unit${ctx.parsed.y === 1 ? "" : "s"}` } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 }, grid: { color: COLORS.border }, border: { display: false } }
      }
    }
  });

  overviewCharts.occupancy = new Chart(document.getElementById("chart-occupancy"), {
    type: "doughnut",
    data: {
      labels: ["Occupied", "Vacant"],
      datasets: [{
        data: [occupiedCount, vacantCount],
        backgroundColor: [COLORS.pink, COLORS.border],
        borderColor: COLORS.surface,
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}` } }
      }
    }
  });

  document.getElementById("btn-download-pdf").addEventListener("click", () => generateOverviewPDF({ occupiedCount, vacantCount, statusCounts }));
}

function generateOverviewPDF(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(230, 0, 126);
  doc.text("Sanefi Rent — Overview Report", 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(75, 92, 114);
  doc.text(`Generated ${new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}`, 14, 27);

  doc.setFontSize(12);
  doc.setTextColor(16, 35, 63);
  doc.text(`Occupied Units: ${data.occupiedCount}    Vacant Units: ${data.vacantCount}`, 14, 39);
  doc.text(`This Month — Verified: ${data.statusCounts.verified}, Pending: ${data.statusCounts.pending}, Rejected: ${data.statusCounts.rejected}`, 14, 46);

  const chartOrder = ["trend", "status", "arrears", "occupancy"];
  const titles = {
    trend: "Rent Collected — Last 6 Months",
    status: "Payment Status — This Month",
    arrears: "Arrears Trend — Last 6 Months",
    occupancy: "Occupancy"
  };

  chartOrder.forEach((key) => {
    const chart = overviewCharts[key];
    if (!chart) return;
    doc.addPage();
    doc.setFontSize(13);
    doc.setTextColor(16, 35, 63);
    doc.text(titles[key], 14, 20);
    doc.addImage(chart.toBase64Image(), "PNG", 14, 28, 180, 100);
  });

  doc.save(`sanefi-overview-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ---------------------------------------------------------------------
// PAYMENTS TAB (table view + Record Payment modal)
// ---------------------------------------------------------------------
function renderPaymentsTab() {
  const unsubscribe = db.collection("payments").orderBy("submittedAt", "desc").limit(100).onSnapshot((snapshot) => {
    if (activeTab !== "payments") return;

    function paymentRowHTML(doc) {
      const p = doc.data();
      const mismatchBadge = p.recipientMatch === false
        ? `<span class="pill pill-mismatch">Mismatch</span>` : "";
      const manualBadge = p.enteredByStaff
        ? `<span class="pill pill-neutral">Staff Entry</span>` : "";
      const actions = p.status === "pending"
        ? `
          <button class="btn-table-action" data-action="verify" data-id="${doc.id}">Verify</button>
          <button class="btn-table-action btn-table-action-danger" data-action="reject" data-id="${doc.id}">Reject</button>`
        : "";
      return `
        <tr>
          <td data-label="Amount"><div class="cell-title">${money(p.amount)}</div></td>
          <td data-label="Unit">${escapeHTML(unitLabel(p.unitId))}</td>
          <td data-label="Landlord">${escapeHTML(landlordName(p.landlordId))}</td>
          <td data-label="Reference">${escapeHTML(p.transactionCode || "Manual entry")}<div class="cell-muted" style="font-size:11.5px; margin-top:2px;">${escapeHTML(p.paidAtRaw || "")}</div></td>
          <td data-label="Status"><span class="pill pill-${p.status}">${p.status}</span> ${mismatchBadge}${manualBadge}</td>
          <td data-label="" class="table-actions">${actions}</td>
        </tr>`;
    }

    const rowsHTML = snapshot.docs.map(paymentRowHTML).join("");
    const unitOptions = unitsCache.map((doc) => `<option value="${doc.id}" data-landlord="${doc.data().landlordId}">${escapeHTML(doc.data().houseNumber)} — ${escapeHTML(landlordName(doc.data().landlordId))}</option>`).join("");

    contentBox.innerHTML = `
      ${collapsePanelHTML({
        id: "record-payment-panel",
        title: "Record Payment",
        collapsedLabel: "+ Record Payment",
        expandedLabel: "Record Payment on Behalf of a Tenant",
        bodyHTML: `
          <div class="card-sub" style="margin-bottom:14px;">Use this when a tenant forwarded their M-Pesa confirmation (e.g. via WhatsApp) instead of submitting it themselves through the app. Paste the exact message text below — it's parsed and counted toward commission the same as any tenant-submitted payment.</div>
          <form id="manual-payment-form">
            <div class="field"><label>Unit</label><select name="unitId" id="manual-unit-select" required>${unitOptions}</select></div>
            <div class="field"><label>M-Pesa Message</label><textarea name="message" placeholder="Paste the full confirmation message here..." required></textarea></div>
            <button type="submit" class="btn btn-primary">Record Payment</button>
            <p class="alert alert-error" id="manual-payment-error" style="display:none;"></p>
          </form>`
      })}
      <div class="table-toolbar">
        <div class="table-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="payment-search" placeholder="Search by unit, landlord or reference&hellip;">
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Amount</th><th>Unit</th><th>Landlord</th><th>Reference</th><th>Status</th><th></th></tr>
          </thead>
          <tbody id="payments-tbody">${rowsHTML}</tbody>
        </table>
        <p class="empty-state" id="payments-empty" style="display:${snapshot.empty ? "block" : "none"};">No payments submitted yet.</p>
      </div>`;

    wireCollapsePanel("record-payment-panel", { collapsedLabel: "+ Record Payment", expandedLabel: "Record Payment on Behalf of a Tenant" });

    // --- Client-side search over the already-loaded rows ---
    const tbody = document.getElementById("payments-tbody");
    const emptyState = document.getElementById("payments-empty");

    function paintRows(docs) {
      tbody.innerHTML = docs.map(paymentRowHTML).join("");
      emptyState.style.display = docs.length === 0 ? "block" : "none";
      emptyState.textContent = snapshot.empty ? "No payments submitted yet." : "No payments match your search.";
      wireRowActions();
    }

    document.getElementById("payment-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { paintRows(snapshot.docs); return; }
      const filteredDocs = snapshot.docs.filter((doc) => {
        const p = doc.data();
        return (unitLabel(p.unitId) || "").toLowerCase().includes(q)
          || (landlordName(p.landlordId) || "").toLowerCase().includes(q)
          || (p.transactionCode || "").toLowerCase().includes(q);
      });
      paintRows(filteredDocs);
    });

    function wireRowActions() {
      contentBox.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          const status = btn.dataset.action === "verify" ? "verified" : "rejected";
          const paymentDoc = snapshot.docs.find((d) => d.id === id);
          btn.disabled = true;
          try {
            await db.collection("payments").doc(id).update({ status });
            if (status === "verified" && paymentDoc && paymentDoc.data().tenantId) {
              const amt = Number(paymentDoc.data().amount || 0).toLocaleString();
              addNotification(paymentDoc.data().tenantId, "payment_verified", `Your payment of KSh ${amt} has been verified.`, { paymentId: id });
            }
          } catch (err) {
            alert("Couldn't update: " + err.message);
            btn.disabled = false;
          }
        });
      });
    }
    wireRowActions();

    const manualForm = document.getElementById("manual-payment-form");
    const manualError = document.getElementById("manual-payment-error");
    manualForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      manualError.style.display = "none";

      const data = new FormData(manualForm);
      const unitId = data.get("unitId");
      const rawMessage = data.get("message");
      const unitDoc = unitsCache.find((d) => d.id === unitId);
      const landlordId = unitDoc ? unitDoc.data().landlordId : null;

      const parsed = parseMpesaMessage(rawMessage);
      if (!parsed.success) {
        manualError.textContent = parsed.error;
        manualError.style.display = "block";
        return;
      }

      try {
        // Same duplicate check as the tenant portal — a message
        // shouldn't be recorded twice regardless of who enters it.
        const dupe = await db.collection("payments").where("transactionCode", "==", parsed.transactionCode).get();
        if (!dupe.empty) {
          manualError.textContent = "This payment has already been recorded.";
          manualError.style.display = "block";
          return;
        }

        const landlordDoc = landlordsCache.find((d) => d.id === landlordId);
        const recipientMatch = landlordDoc ? checkRecipientMatch(parsed, landlordDoc.data()) : false;

        await db.collection("payments").add({
          tenantId: null,
          unitId,
          landlordId,
          rawMessage: parsed.rawMessage,
          method: parsed.method,
          transactionCode: parsed.transactionCode,
          amount: parsed.amount,
          paidAtRaw: parsed.paidAtRaw,
          recipientName: parsed.recipientName || null,
          recipientMatch,
          enteredByStaff: true,
          status: "verified", // staff already reviewed the message before entering it
          submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        manualForm.reset();
        document.getElementById("record-payment-panel")._setOpen(false);
      } catch (err) {
        manualError.textContent = "Couldn't record payment: " + err.message;
        manualError.style.display = "block";
      }
    });
  });

  activeListeners.push(unsubscribe);
}

// ---------------------------------------------------------------------
// TENANTS TAB (searchable table + profile view)
// ---------------------------------------------------------------------
async function renderTenantsTab() {
  if (viewingTenantId) {
    renderTenantProfile(viewingTenantId);
    return;
  }

  const paidUnitIds = await getPaidUnitIdsThisMonth();
  if (activeTab !== "tenants" || viewingTenantId) return;

  const rowsData = tenantsCache.map((doc) => {
    const t = doc.data();
    return {
      id: doc.id,
      name: t.name || "",
      unit: t.unitId ? unitLabel(t.unitId) : "No unit assigned",
      landlord: t.landlordId ? landlordName(t.landlordId) : "—",
      status: t.status || "active",
      overdue: isOverdue(t, paidUnitIds)
    };
  });

  contentBox.innerHTML = `
    <div class="table-toolbar">
      <div class="table-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="tenant-search" placeholder="Search tenants by name, unit or landlord&hellip;">
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Tenant</th><th>Unit</th><th>Landlord</th><th>Status</th><th>Arrears</th><th></th></tr>
        </thead>
        <tbody id="tenants-tbody"></tbody>
      </table>
      <p class="empty-state" id="tenants-empty" style="display:none;">No tenants match your search.</p>
    </div>`;

  const tbody = document.getElementById("tenants-tbody");
  const emptyState = document.getElementById("tenants-empty");

  function paintRows(filter) {
    const q = (filter || "").trim().toLowerCase();
    const filtered = !q ? rowsData : rowsData.filter((r) =>
      r.name.toLowerCase().includes(q) || r.unit.toLowerCase().includes(q) || r.landlord.toLowerCase().includes(q)
    );

    if (rowsData.length === 0) {
      tbody.innerHTML = "";
      emptyState.style.display = "block";
      emptyState.textContent = "No tenants registered yet.";
      return;
    }
    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyState.style.display = "block";
      emptyState.textContent = "No tenants match your search.";
      return;
    }
    emptyState.style.display = "none";

    tbody.innerHTML = filtered.map((r) => `
      <tr>
        <td data-label="Tenant"><div class="cell-title">${escapeHTML(r.name)}</div></td>
        <td data-label="Unit">${escapeHTML(r.unit)}</td>
        <td data-label="Landlord">${escapeHTML(r.landlord)}</td>
        <td data-label="Status"><span class="pill ${r.status === "pending" ? "pill-pending" : "pill-verified"}">${escapeHTML(r.status)}</span></td>
        <td data-label="Arrears">${r.overdue ? `<span class="badge-arrears">Arrears</span>` : `<span class="cell-muted">&mdash;</span>`}</td>
        <td data-label="" class="table-actions">
          ${r.status === "pending" ? `<button class="btn-table-action" data-approve-tenant="${r.id}">Approve</button>` : ""}
          <button class="btn-table-action" data-view-tenant="${r.id}">View Details</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-view-tenant]").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewingTenantId = btn.dataset.viewTenant;
        renderTenantsTab();
      });
    });

    tbody.querySelectorAll("[data-approve-tenant]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await approveTenant(btn.dataset.approveTenant);
          renderActiveTab();
        } catch (err) {
          alert("Couldn't approve: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  paintRows("");
  document.getElementById("tenant-search").addEventListener("input", (e) => paintRows(e.target.value));
}

// Approves a tenant whose signup is pending review, so they can start
// using the portal normally. Called from the "Approve" button in the
// Tenants tab. Assumes tenant docs use status: "pending" -> "active"
// (matches the pill logic above: anything other than "pending" renders
// as pill-verified). Update the literal below if your signup flow uses
// a different status string.
async function approveTenant(tenantId) {
  // Bug fix: approving a tenant never touched their unit's `occupancy`
  // field, so a unit could have a real, active tenant assigned to it and
  // still show as "Vacant" in the Units tab forever, since nothing else
  // in the app writes to units.occupancy except the manual pill toggle.
  const tenantDoc = tenantsCache.find((d) => d.id === tenantId);
  const unitId = tenantDoc ? tenantDoc.data().unitId : null;

  await db.collection("tenants").doc(tenantId).update({ status: "active" });
  if (unitId) {
    await db.collection("units").doc(unitId).update({ occupancy: "occupied" });
  }
  addNotification(tenantId, "tenant_approved", "Your account has been approved.", {});
}

// Status lifecycle mirrors portal.js exactly: open -> in_progress ->
// resolved -> closed (or back to open if the tenant reopens it). "resolved"
// is a staff claim awaiting the tenant's confirmation, not a final state —
// "closed" is what the tenant actually confirming fixed looks like.
function maintenanceStatusPill(status) {
  const map = { open: "pill-pending", in_progress: "pill-pending", resolved: "pill-awaiting", closed: "pill-verified" };
  const label = { open: "Open", in_progress: "In Progress", resolved: "Awaiting Tenant Confirmation", closed: "Closed" };
  return `<span class="pill ${map[status] || "pill-pending"}">${label[status] || status}</span>`;
}

function commentBubbleHTML(c) {
  const isStaff = c.author === "staff";
  const when = c.createdAt && c.createdAt.toDate
    ? c.createdAt.toDate().toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return `
    <div class="comment-bubble ${isStaff ? "comment-staff" : "comment-tenant"}">
      <div class="comment-author">${escapeHTML(c.authorName || (isStaff ? "Office" : "Tenant"))}</div>
      <div class="comment-text">${escapeHTML(c.message)}</div>
      <div class="comment-time">${when}</div>
    </div>`;
}

async function refreshThread(id) {
  const container = document.getElementById(`thread-${id}`);
  if (!container) return;
  const snap = await db.collection("maintenanceRequests").doc(id).collection("comments").orderBy("createdAt", "asc").get();
  const messagesHTML = snap.empty
    ? `<p class="empty-state" style="padding:8px 0;">No messages yet — send one below.</p>`
    : snap.docs.map((d) => commentBubbleHTML(d.data())).join("");

  container.innerHTML = `
    <div class="comment-thread">${messagesHTML}</div>
    <div class="comment-input-row">
      <textarea id="comment-input-${id}" placeholder="Reply to the tenant..."></textarea>
      <button class="btn btn-outline" data-send-comment="${id}">Send</button>
    </div>`;

  container.querySelector(`[data-send-comment="${id}"]`).addEventListener("click", () => sendComment(id));
}

async function sendComment(id) {
  const input = document.getElementById(`comment-input-${id}`);
  const message = input ? input.value.trim() : "";
  if (!message) return;
  const sendBtn = document.querySelector(`[data-send-comment="${id}"]`);
  if (sendBtn) sendBtn.disabled = true;
  try {
    await db.collection("maintenanceRequests").doc(id).collection("comments").add({
      author: "staff",
      authorName: "Office",
      message,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Bug fix: staff replies never notified the tenant — only the
    // tenant->staff direction fired a notification, so a tenant had no
    // way to know the office had answered unless they checked back.
    const reqDoc = await db.collection("maintenanceRequests").doc(id).get();
    if (reqDoc.exists && reqDoc.data().tenantId) {
      addNotification(reqDoc.data().tenantId, "maintenance_comment", "The office replied to your maintenance request.", { maintenanceRequestId: id });
    }
    if (input) input.value = "";
    await refreshThread(id);
  } catch (err) {
    alert("Couldn't send: " + err.message);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function openThread(id) {
  expandedThreads.add(id);
  const container = document.getElementById(`thread-${id}`);
  const toggleBtn = document.querySelector(`[data-thread-toggle="${id}"]`);
  if (!container) return;
  container.style.display = "block";
  container.innerHTML = `<p class="empty-state" style="padding:8px 0;">Loading&hellip;</p>`;
  if (toggleBtn) toggleBtn.textContent = "Hide Conversation";
  refreshThread(id);
}

function closeThread(id) {
  expandedThreads.delete(id);
  const container = document.getElementById(`thread-${id}`);
  const toggleBtn = document.querySelector(`[data-thread-toggle="${id}"]`);
  if (container) container.style.display = "none";
  if (toggleBtn) toggleBtn.textContent = "View Conversation";
}

async function renderTenantProfile(tenantId) {
  const cachedDoc = tenantsCache.find((d) => d.id === tenantId);
  const tenantDoc = cachedDoc || await db.collection("tenants").doc(tenantId).get();

  // Bug fix: a doc fetched directly via .get() (i.e. not in the cache)
  // can come back non-existent — reading .data() on it used to throw.
  if (!tenantDoc.exists) {
    contentBox.innerHTML = `<p class="empty-state">This tenant could not be found. They may have been removed.</p>`;
    return;
  }

  const t = tenantDoc.data();
  const unitDoc = t.unitId ? unitsCache.find((d) => d.id === t.unitId) : null;

  const [depositSnap, paymentsSnap, maintenanceSnap] = await Promise.all([
    t.unitId ? db.collection("deposits").where("unitId", "==", t.unitId).orderBy("paidAt", "desc").limit(1).get() : Promise.resolve({ empty: true, docs: [] }),
    db.collection("payments").where("tenantId", "==", tenantId).orderBy("submittedAt", "desc").limit(15).get(),
    db.collection("maintenanceRequests").where("tenantId", "==", tenantId).orderBy("submittedAt", "desc").get()
  ]);

  if (activeTab !== "tenants" || viewingTenantId !== tenantId) return;

  // Deposit: split into a read-only summary of the latest deposit on
  // record for this tenant's unit, plus (below) an inline form so staff
  // can record/update that deposit right here instead of having to
  // switch to the separate Deposits tab. Both write to the same
  // `deposits` collection/fields the Deposits tab already uses, so a
  // deposit recorded from either place shows up correctly in both.
  const depositDoc = depositSnap.empty ? null : depositSnap.docs[0];
  const existingDeposit = depositDoc ? depositDoc.data() : null;
  const depositRefunded = !!(existingDeposit && existingDeposit.status === "refunded");

  const depositSummaryHTML = !existingDeposit
    ? `<p class="card-sub">No deposit on record.</p>`
    : `<div class="card-sub">${money(existingDeposit.amountPaid)} paid on ${existingDeposit.paidAt || ""}</div>
       <div style="margin-top:6px;"><span class="pill ${depositRefunded ? "pill-verified" : "pill-pending"}">${depositRefunded ? "Refunded" : "Held"}</span></div>`;

  const depositFormHTML = !t.unitId
    ? `<p class="card-sub" style="margin-top:10px;">Assign this tenant to a unit before recording a deposit.</p>`
    : depositRefunded
      ? `<p class="card-sub" style="margin-top:10px;">This deposit has been refunded. Manage further refunds from the Deposits tab.</p>`
      : `
      <form id="deposit-inline-form" style="margin-top:14px;">
        <div class="field"><label>Amount Paid (KSh)</label><input type="number" name="amountPaid" min="0" required value="${existingDeposit ? existingDeposit.amountPaid : ""}"></div>
        <div class="field"><label>Date Paid</label><input type="date" name="paidAt" required value="${existingDeposit ? existingDeposit.paidAt : ""}"></div>
        <button type="submit" class="btn btn-outline">${existingDeposit ? "Update Deposit" : "Record Deposit"}</button>
        <p class="alert alert-success" id="deposit-inline-success" style="display:none;">Saved.</p>
      </form>`;

  const paymentsHTML = paymentsSnap.empty ? `<p class="empty-state">No payments yet.</p>` : paymentsSnap.docs.map((doc) => {
    const p = doc.data();
    return `<div class="payment-row"><div><div class="amount">${money(p.amount)}</div><div class="meta">${p.paidAtRaw || ""}</div></div><span class="pill pill-${p.status}">${p.status}</span></div>`;
  }).join("");

  // Bug fix: action buttons used to be gated on `status !== "resolved"`,
  // which is also true for "closed" — so a request the tenant already
  // confirmed fixed still showed a "Mark Resolved" button. Buttons now
  // only appear while the request is actually actionable by staff
  // (open or in_progress); once it's resolved it's the tenant's turn,
  // and once it's closed there's nothing left to do.
  const maintenanceHTML = maintenanceSnap.empty ? `<p class="empty-state">No maintenance requests.</p>` : maintenanceSnap.docs.map((doc) => {
    const m = doc.data();
    const actions = (m.status === "open" || m.status === "in_progress") ? `
      ${m.status === "open" ? `<button class="btn btn-outline" style="width:auto; padding:7px 14px; font-size:12.5px;" data-mtn-action="in_progress" data-mtn-id="${doc.id}">Mark In Progress</button>` : ""}
      <button class="btn btn-primary" style="width:auto; padding:7px 14px; font-size:12.5px;" data-mtn-action="resolved" data-mtn-id="${doc.id}">Mark Resolved</button>` : "";
    return `
      <div class="card">
        <span class="chip">${escapeHTML(m.category || "Other")}</span>
        <div class="card-sub" style="margin-top:8px;">${escapeHTML(m.description || "")}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
          ${maintenanceStatusPill(m.status)}
          <div style="display:flex; gap:6px;">${actions}</div>
        </div>
        <button class="comment-toggle" data-thread-toggle="${doc.id}">View Conversation</button>
        <div class="comment-panel" id="thread-${doc.id}" style="display:none;"></div>
      </div>`;
  }).join("");

  contentBox.innerHTML = `
    <button class="btn-link" id="back-to-tenants" style="margin-bottom:14px;">&larr; Back to Tenants</button>
    <div class="card">
      <div class="card-title">${escapeHTML(t.name || "")}</div>
      <div class="card-sub">${unitDoc ? escapeHTML(unitDoc.data().houseNumber) : "No unit assigned"} ${t.landlordId ? "&middot; " + escapeHTML(landlordName(t.landlordId)) : ""}</div>
      <form id="lease-form" style="margin-top:14px;">
        <div class="field"><label>Lease Start Date</label><input type="date" name="leaseStartDate" value="${t.leaseStartDate || ""}"></div>
        <div class="field"><label>Rent Due Day (day of month)</label><input type="number" name="rentDueDay" min="1" max="28" value="${t.rentDueDay || 5}"></div>
        <button type="submit" class="btn btn-outline">Save Lease Info</button>
        <p class="alert alert-success" id="lease-save-success" style="display:none;">Saved.</p>
      </form>
    </div>
    <div class="card">
      <div class="card-title">Deposit</div>
      ${depositSummaryHTML}
      ${depositFormHTML}
    </div>
    <h3 style="margin-bottom:8px;">Payment History</h3>
    <div class="card">${paymentsHTML}</div>
    <h3 style="margin-bottom:8px;">Maintenance Requests</h3>
    ${maintenanceHTML}`;

  document.getElementById("back-to-tenants").addEventListener("click", () => {
    viewingTenantId = null;
    renderTenantsTab();
  });

  document.getElementById("lease-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      await db.collection("tenants").doc(tenantId).update({
        leaseStartDate: data.get("leaseStartDate") || null,
        rentDueDay: Number(data.get("rentDueDay")) || 5
      });
      document.getElementById("lease-save-success").style.display = "block";
    } catch (err) {
      alert("Couldn't save: " + err.message);
    }
  });

  // Inline Deposit form — writes to the same `deposits` collection/fields
  // as the Deposits tab. If a deposit already exists for this unit it's
  // updated in place instead of creating a duplicate. Not rendered at
  // all once the deposit has been refunded (see depositFormHTML above).
  const depositInlineForm = document.getElementById("deposit-inline-form");
  if (depositInlineForm) {
    depositInlineForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(depositInlineForm);
      const payload = {
        unitId: t.unitId,
        landlordId: t.landlordId || (unitDoc ? unitDoc.data().landlordId : null),
        tenantName: t.name || "",
        amountPaid: Number(data.get("amountPaid")) || 0,
        paidAt: data.get("paidAt")
      };
      const submitBtn = depositInlineForm.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;
      try {
        if (depositDoc) {
          await db.collection("deposits").doc(depositDoc.id).update(payload);
        } else {
          await db.collection("deposits").add({
            ...payload,
            status: "held",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        // Re-render the profile so the summary above and the "Update"
        // vs "Record" form state reflect what was just saved.
        renderTenantProfile(tenantId);
      } catch (err) {
        alert("Couldn't save deposit: " + err.message);
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  contentBox.querySelectorAll("[data-mtn-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.mtnId;
      const status = btn.dataset.mtnAction;
      let staffNote = "";
      if (status === "resolved") {
        staffNote = prompt("Add a note for the tenant (optional):", "") || "";
      }
      btn.disabled = true;
      try {
        await db.collection("maintenanceRequests").doc(id).update({
          status,
          staffNote: staffNote || null,
          resolvedAt: status === "resolved" ? firebase.firestore.FieldValue.serverTimestamp() : null
        });
        addNotification(tenantId, "maintenance_update", `Your maintenance request is now ${status === "in_progress" ? "in progress" : "resolved"}.`, { maintenanceRequestId: id });
        renderTenantProfile(tenantId);
      } catch (err) {
        alert("Couldn't update: " + err.message);
        btn.disabled = false;
      }
    });
  });

  contentBox.querySelectorAll("[data-thread-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.threadToggle;
      if (expandedThreads.has(id)) closeThread(id); else openThread(id);
    });
  });

  // Re-expand any threads staff already had open before this re-render
  // (e.g. triggered by marking a request resolved).
  expandedThreads.forEach((id) => {
    if (document.getElementById(`thread-${id}`)) openThread(id);
  });
}

// ---------------------------------------------------------------------
// LANDLORDS TAB (searchable table + edit/delete + add form)
// ---------------------------------------------------------------------
let editingLandlordId = null;

function landlordMethodDetail(l) {
  return l.paymentMethod === "paybill" ? `Paybill ${l.paybillNumber || ""} (Acc: ${l.accountHint || "any"})`
    : l.paymentMethod === "till" ? `Till ${l.tillNumber || ""} (${l.businessName || ""})`
    : `Phone ${l.phoneNumber || ""} (${l.registeredName || ""})`;
}

function renderLandlordsTab() {
  const rowsData = landlordsCache.map((doc) => {
    const l = doc.data();
    return { id: doc.id, name: l.name || "", detail: landlordMethodDetail(l), contact: l.contact || "—" };
  });

  contentBox.innerHTML = `
    ${collapsePanelHTML({
      id: "landlord-form-panel",
      title: "Add Landlord",
      collapsedLabel: "+ Add Landlord",
      expandedLabel: "Add Landlord",
      bodyHTML: `
        <form id="landlord-form">
          <div class="field"><label>Name</label><input type="text" name="name" required></div>
          <div class="field"><label>Contact</label><input type="text" name="contact"></div>
          <div class="field">
            <label>Payment Method</label>
            <select name="paymentMethod" id="ll-method">
              <option value="paybill">Paybill</option>
              <option value="till">Till Number</option>
              <option value="phone">Send Money (Phone)</option>
            </select>
          </div>
          <div id="ll-paybill-fields">
            <div class="field"><label>Paybill Number</label><input type="text" name="paybillNumber"></div>
            <div class="field"><label>Account Number (optional, for matching)</label><input type="text" name="accountHint"></div>
          </div>
          <div id="ll-till-fields" style="display:none;">
            <div class="field"><label>Till Number</label><input type="text" name="tillNumber"></div>
            <div class="field"><label>Business Name (as shown on M-Pesa)</label><input type="text" name="businessName"></div>
          </div>
          <div id="ll-phone-fields" style="display:none;">
            <div class="field"><label>Phone Number</label><input type="text" name="phoneNumber"></div>
            <div class="field"><label>Registered M-Pesa Name</label><input type="text" name="registeredName"></div>
          </div>
          <div style="display:flex; gap:10px;">
            <button type="submit" class="btn btn-primary" id="landlord-form-submit">Add Landlord</button>
            <button type="button" class="btn btn-outline" id="landlord-form-cancel" style="display:none;">Cancel</button>
          </div>
        </form>`
    })}
    <div class="table-toolbar">
      <div class="table-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="landlord-search" placeholder="Search landlords by name or contact&hellip;">
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Landlord</th><th>Payment Details</th><th>Contact</th><th></th></tr></thead>
        <tbody id="landlords-tbody"></tbody>
      </table>
      <p class="empty-state" id="landlords-empty" style="display:none;">No landlords match your search.</p>
    </div>`;

  wireCollapsePanel("landlord-form-panel", { collapsedLabel: "+ Add Landlord", expandedLabel: "Add Landlord" });

  const tbody = document.getElementById("landlords-tbody");
  const emptyState = document.getElementById("landlords-empty");

  function paintRows(filter) {
    const q = (filter || "").trim().toLowerCase();
    const filtered = !q ? rowsData : rowsData.filter((r) =>
      r.name.toLowerCase().includes(q) || r.contact.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q)
    );

    if (rowsData.length === 0) {
      tbody.innerHTML = "";
      emptyState.style.display = "block";
      emptyState.textContent = "No landlords added yet.";
      return;
    }
    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyState.style.display = "block";
      emptyState.textContent = "No landlords match your search.";
      return;
    }
    emptyState.style.display = "none";

    tbody.innerHTML = filtered.map((r) => `
      <tr>
        <td data-label="Landlord"><div class="cell-title">${escapeHTML(r.name)}</div></td>
        <td data-label="Payment Details">${escapeHTML(r.detail)}</td>
        <td data-label="Contact">${escapeHTML(r.contact)}</td>
        <td data-label="" class="table-actions">
          <button class="btn-table-action" data-view-landlord="${r.id}">View Details</button>
          <button class="btn-table-action" data-edit-landlord="${r.id}">Edit</button>
          <button class="btn-table-action btn-table-action-danger" data-delete-landlord="${r.id}">Delete</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-view-landlord]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const doc = landlordsCache.find((d) => d.id === btn.dataset.viewLandlord);
        if (!doc) return;
        const l = doc.data();
        alert(`${l.name}\n\n${landlordMethodDetail(l)}\nContact: ${l.contact || "—"}`);
      });
    });

    tbody.querySelectorAll("[data-edit-landlord]").forEach((btn) => {
      btn.addEventListener("click", () => beginEditLandlord(btn.dataset.editLandlord));
    });

    tbody.querySelectorAll("[data-delete-landlord]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const doc = landlordsCache.find((d) => d.id === btn.dataset.deleteLandlord);
        if (!doc) return;
        if (!confirm(`Delete ${doc.data().name}? This can't be undone.`)) return;
        try {
          await db.collection("landlords").doc(btn.dataset.deleteLandlord).delete();
          renderActiveTab();
        } catch (err) {
          alert("Couldn't delete: " + err.message);
        }
      });
    });
  }

  paintRows("");
  document.getElementById("landlord-search").addEventListener("input", (e) => paintRows(e.target.value));

  const methodSelect = document.getElementById("ll-method");
  const form = document.getElementById("landlord-form");
  const submitBtn = document.getElementById("landlord-form-submit");
  const cancelBtn = document.getElementById("landlord-form-cancel");
  const panel = document.getElementById("landlord-form-panel");
  const panelTitle = document.getElementById("landlord-form-panel-title");

  function toggleMethodFields() {
    document.getElementById("ll-paybill-fields").style.display = methodSelect.value === "paybill" ? "block" : "none";
    document.getElementById("ll-till-fields").style.display = methodSelect.value === "till" ? "block" : "none";
    document.getElementById("ll-phone-fields").style.display = methodSelect.value === "phone" ? "block" : "none";
  }
  methodSelect.addEventListener("change", toggleMethodFields);

  function beginEditLandlord(id) {
    const doc = landlordsCache.find((d) => d.id === id);
    if (!doc) return;
    const l = doc.data();
    editingLandlordId = id;
    form.name.value = l.name || "";
    form.contact.value = l.contact || "";
    form.paymentMethod.value = l.paymentMethod || "paybill";
    form.paybillNumber.value = l.paybillNumber || "";
    form.accountHint.value = l.accountHint || "";
    form.tillNumber.value = l.tillNumber || "";
    form.businessName.value = l.businessName || "";
    form.phoneNumber.value = l.phoneNumber || "";
    form.registeredName.value = l.registeredName || "";
    toggleMethodFields();
    if (panelTitle) panelTitle.textContent = `Edit ${l.name}`;
    submitBtn.textContent = "Save Changes";
    cancelBtn.style.display = "inline-block";
    panel._setOpen(true);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  cancelBtn.addEventListener("click", () => {
    editingLandlordId = null;
    form.reset();
    toggleMethodFields();
    if (panelTitle) panelTitle.textContent = "Add Landlord";
    submitBtn.textContent = "Add Landlord";
    cancelBtn.style.display = "none";
    panel._setOpen(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const payload = {
      name: data.get("name"),
      contact: data.get("contact"),
      paymentMethod: data.get("paymentMethod"),
      paybillNumber: data.get("paybillNumber") || null,
      accountHint: data.get("accountHint") || null,
      tillNumber: data.get("tillNumber") || null,
      businessName: data.get("businessName") || null,
      phoneNumber: data.get("phoneNumber") || null,
      registeredName: data.get("registeredName") || null
    };
    try {
      if (editingLandlordId) {
        await db.collection("landlords").doc(editingLandlordId).update(payload);
        editingLandlordId = null;
      } else {
        await db.collection("landlords").add(payload);
      }
      renderActiveTab();
    } catch (err) {
      alert("Couldn't save landlord: " + err.message);
    }
  });
}

// ---------------------------------------------------------------------
// UNITS TAB
// ---------------------------------------------------------------------
function renderUnitsTab() {
  const cards = unitsCache.map((doc) => {
    const u = doc.data();
    const vacant = u.occupancy === "vacant";
    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="card-title">${u.houseNumber} ${u.unitType ? "&middot; " + escapeHTML(u.unitType) : ""}</div>
            <div class="card-sub">${u.propertyName || ""} &middot; ${landlordName(u.landlordId)}</div>
            <div class="card-sub">Rent: ${money(u.rentAmount)}</div>
            <div class="card-sub">Water Meter: ${u.waterMeterNumber || "—"} &middot; Power Meter: ${u.powerMeterNumber || "—"}</div>
          </div>
          <span class="pill ${vacant ? "pill-rejected" : "pill-verified"}" data-toggle-occupancy="${doc.id}" style="cursor:pointer;">${vacant ? "Vacant" : "Occupied"}</span>
        </div>
      </div>`;
  }).join("") || `<p class="empty-state">No units added yet.</p>`;

  const landlordOptions = landlordsCache.map((doc) => `<option value="${doc.id}">${doc.data().name}</option>`).join("");

  contentBox.innerHTML = `
    ${collapsePanelHTML({
      id: "unit-form-panel",
      title: "Add Unit",
      collapsedLabel: "+ Add Unit",
      expandedLabel: "Add Unit",
      bodyHTML: `
        <form id="unit-form">
          <div class="field"><label>Landlord / Property</label><select name="landlordId" required>${landlordOptions}</select></div>
          <div class="field"><label>House / Unit Number</label><input type="text" name="houseNumber" placeholder="e.g. 3A" required></div>
          <div class="field"><label>Property Name</label><input type="text" name="propertyName" placeholder="e.g. E&amp;L Apartments"></div>
          <div class="field"><label>Unit Type</label><input type="text" name="unitType" placeholder="e.g. 2BR, Bedsitter, Single"></div>
          <div class="field"><label>Monthly Rent (KSh)</label><input type="number" name="rentAmount" min="0"></div>
          <div class="field"><label>Water Meter Number</label><input type="text" name="waterMeterNumber"></div>
          <div class="field"><label>Power Meter Number</label><input type="text" name="powerMeterNumber"></div>
          <button type="submit" class="btn btn-primary">Add Unit</button>
        </form>`
    })}
    ${cards}`;

  wireCollapsePanel("unit-form-panel", { collapsedLabel: "+ Add Unit", expandedLabel: "Add Unit" });

  contentBox.querySelectorAll("[data-toggle-occupancy]").forEach((pill) => {
    pill.addEventListener("click", async () => {
      const id = pill.dataset.toggleOccupancy;
      const doc = unitsCache.find((d) => d.id === id);
      const currentlyVacant = doc.data().occupancy === "vacant";
      try {
        await db.collection("units").doc(id).update({ occupancy: currentlyVacant ? "occupied" : "vacant" });
        renderActiveTab();
      } catch (err) {
        alert("Couldn't update: " + err.message);
      }
    });
  });

  document.getElementById("unit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      await db.collection("units").add({
        landlordId: data.get("landlordId"),
        houseNumber: data.get("houseNumber"),
        propertyName: data.get("propertyName") || "",
        unitType: data.get("unitType") || "",
        rentAmount: Number(data.get("rentAmount")) || 0,
        waterMeterNumber: data.get("waterMeterNumber") || "",
        powerMeterNumber: data.get("powerMeterNumber") || "",
        occupancy: "vacant"
      });
      renderActiveTab();
    } catch (err) {
      alert("Couldn't add unit: " + err.message);
    }
  });
}

// ---------------------------------------------------------------------
// DEPOSITS TAB
// ---------------------------------------------------------------------
function renderDepositsTab() {
  const unsubscribe = db.collection("deposits").orderBy("paidAt", "desc").onSnapshot((snapshot) => {
    if (activeTab !== "deposits") return;

    const rows = snapshot.empty ? `<p class="empty-state">No deposits recorded yet.</p>` : snapshot.docs.map((doc) => {
      const d = doc.data();
      const refunded = d.status === "refunded";
      return `
        <div class="card">
          <div class="card-title">${escapeHTML(d.tenantName)} &middot; ${unitLabel(d.unitId)}</div>
          <div class="card-sub">Paid: ${money(d.amountPaid)} on ${d.paidAt || ""}</div>
          ${refunded ? `<div class="card-sub">Refunded: ${money(d.amountRefundable)} (deductions: ${money(d.deductions)})</div>` : ""}
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
            <span class="pill ${refunded ? "pill-verified" : "pill-pending"}">${refunded ? "Refunded" : "Held"}</span>
            ${!refunded ? `<button class="btn btn-outline" style="width:auto; padding:8px 16px; font-size:13px;" data-action="refund" data-id="${doc.id}">Process Refund</button>` : ""}
          </div>
        </div>`;
    }).join("");

    const unitOptions = unitsCache.map((doc) => `<option value="${doc.id}">${escapeHTML(doc.data().houseNumber)} — ${escapeHTML(landlordName(doc.data().landlordId))}</option>`).join("");

    contentBox.innerHTML = `
      ${collapsePanelHTML({
        id: "deposit-form-panel",
        title: "Record a Deposit",
        collapsedLabel: "+ Record a Deposit",
        expandedLabel: "Record a Deposit",
        bodyHTML: `
          <form id="deposit-form">
            <div class="field"><label>Unit</label><select name="unitId" required>${unitOptions}</select></div>
            <div class="field"><label>Tenant Name</label><input type="text" name="tenantName" required></div>
            <div class="field"><label>Amount Paid (KSh)</label><input type="number" name="amountPaid" min="0" required></div>
            <div class="field"><label>Date Paid</label><input type="date" name="paidAt" required></div>
            <button type="submit" class="btn btn-primary">Record Deposit</button>
          </form>`
      })}
      ${rows}`;

    wireCollapsePanel("deposit-form-panel", { collapsedLabel: "+ Record a Deposit", expandedLabel: "Record a Deposit" });

    document.getElementById("deposit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const unitId = data.get("unitId");
      const unitDoc = unitsCache.find((d) => d.id === unitId);
      try {
        await db.collection("deposits").add({
          unitId,
          landlordId: unitDoc ? unitDoc.data().landlordId : null,
          tenantName: data.get("tenantName"),
          amountPaid: Number(data.get("amountPaid")) || 0,
          paidAt: data.get("paidAt"),
          status: "held",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        e.target.reset();
        document.getElementById("deposit-form-panel")._setOpen(false);
      } catch (err) {
        alert("Couldn't record deposit: " + err.message);
      }
    });

    contentBox.querySelectorAll("[data-action='refund']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const deductions = Number(prompt("Any deductions from the deposit? Enter 0 if none.", "0")) || 0;
        const doc = snapshot.docs.find((d) => d.id === btn.dataset.id);
        const amountRefundable = Number(doc.data().amountPaid || 0) - deductions;
        try {
          await db.collection("deposits").doc(btn.dataset.id).update({
            status: "refunded",
            deductions,
            amountRefundable,
            refundedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (err) {
          alert("Couldn't process refund: " + err.message);
        }
      });
    });
  });

  activeListeners.push(unsubscribe);
}

// ---------------------------------------------------------------------
// SETTINGS TAB
// ---------------------------------------------------------------------
async function renderSettingsTab() {
  const configDoc = await db.doc("settings/commission").get();
  const config = configDoc.exists ? configDoc.data() : { commissionRate: 0.06, cleaningFee: 2000 };

  contentBox.innerHTML = `
    <div class="card">
      <div class="card-title">Commission Settings</div>
      <div class="card-sub" style="margin-bottom:14px;">Applies the same way to every landlord's monthly commission statement.</div>
      <form id="settings-form">
        <div class="field"><label>Commission Rate (%)</label><input type="number" name="commissionRatePercent" step="0.1" min="0" max="100" value="${(config.commissionRate * 100).toFixed(1)}" required></div>
        <div class="field"><label>Cleaning Fee (KSh, flat per property per month)</label><input type="number" name="cleaningFee" min="0" value="${config.cleaningFee}" required></div>
        <button type="submit" class="btn btn-primary">Save Settings</button>
        <p class="alert alert-success" id="settings-success" style="display:none;">Saved.</p>
      </form>
    </div>`;

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    try {
      await db.doc("settings/commission").set({
        commissionRate: Number(data.get("commissionRatePercent")) / 100,
        cleaningFee: Number(data.get("cleaningFee"))
      });
      document.getElementById("settings-success").style.display = "block";
    } catch (err) {
      alert("Couldn't save: " + err.message);
    }
  });
}

// ---------------------------------------------------------------------
// REPORTS TAB
// ---------------------------------------------------------------------
function renderReportsTab() {
  const landlordOptions = `<option value="">All Landlords</option>` +
    landlordsCache.map((doc) => `<option value="${doc.id}">${doc.data().name}</option>`).join("");
  // The Word report is always for one specific property, so no "All" option here.
  const propertyOptions = landlordsCache.map((doc) => `<option value="${doc.id}">${doc.data().name}</option>`).join("");

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  contentBox.innerHTML = `
    ${collapsePanelHTML({
      id: "property-report-panel",
      title: "Monthly Property Report",
      collapsedLabel: "+ Monthly Property Report (Word)",
      expandedLabel: "Monthly Property Report (Word)",
      bodyHTML: `
        <div class="card-sub" style="margin-bottom:14px;">Generates the per-property monthly rent-roll statement — unit-by-unit rent, tenant, payment and arrears, plus a commission summary and deposit-refund table — as a downloadable Word document.</div>
        <form id="property-report-form">
          <div class="field"><label>Property / Landlord</label><select name="landlordId"><option value="">All Properties (one .docx per property, zipped)</option>${propertyOptions}</select></div>
          <div class="field"><label>Month</label><input type="month" name="month" value="${defaultMonth}" required></div>
          <div class="field"><label>Garbage Fee Collected This Month (KSh)</label><input type="number" name="garbageFee" min="0" value="0"><small>When generating for All Properties, this same figure is applied to every property — edit individual reports afterward if they actually differ.</small></div>
          <div class="field"><label>Recommendations</label><textarea name="recommendations" placeholder="e.g. We recommend reducing of the prices and repainting of the premises"></textarea><small>When generating for All Properties, this same note is applied to every property.</small></div>
          <button type="submit" class="btn btn-primary" id="property-report-submit">Generate Word Report</button>
          <p class="alert alert-error" id="property-report-error" style="display:none;"></p>
        </form>`
    })}
    <div class="card">
      <div class="field"><label>Filter by Landlord</label><select id="report-landlord">${landlordOptions}</select></div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-rent-roll" style="width:auto; padding:10px 16px;">Rent Roll (This Month)</button>
        <button class="btn btn-outline" id="btn-arrears" style="width:auto; padding:10px 16px;">Arrears</button>
        <button class="btn btn-outline" id="btn-commission" style="width:auto; padding:10px 16px;">Commission Statement</button>
        <button class="btn btn-outline" id="btn-export" style="width:auto; padding:10px 16px;">Export CSV</button>
      </div>
    </div>
    <div id="report-output"></div>`;

  wireCollapsePanel("property-report-panel", { collapsedLabel: "+ Monthly Property Report (Word)", expandedLabel: "Monthly Property Report (Word)" });

  document.getElementById("btn-rent-roll").addEventListener("click", showRentRoll);
  document.getElementById("btn-arrears").addEventListener("click", showArrears);
  document.getElementById("btn-commission").addEventListener("click", showCommissionStatement);
  document.getElementById("btn-export").addEventListener("click", exportCSV);

  const reportForm = document.getElementById("property-report-form");
  const reportError = document.getElementById("property-report-error");
  const reportSubmit = document.getElementById("property-report-submit");
  reportForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    reportError.style.display = "none";
    const data = new FormData(reportForm);
    const landlordId = data.get("landlordId");
    const month = data.get("month");
    const garbageFee = data.get("garbageFee");
    const recommendations = data.get("recommendations");
    reportSubmit.disabled = true;
    try {
      if (landlordId) {
        reportSubmit.textContent = "Generating...";
        await generatePropertyReportDocx(landlordId, month, garbageFee, recommendations);
      } else {
        await generateAllPropertyReportsZip(month, garbageFee, recommendations, (done, total) => {
          reportSubmit.textContent = `Generating ${done}/${total}...`;
        });
      }
    } catch (err) {
      reportError.textContent = "Couldn't generate report: " + err.message;
      reportError.style.display = "block";
    } finally {
      reportSubmit.disabled = false;
      reportSubmit.textContent = "Generate Word Report";
    }
  });
}

// ---------------------------------------------------------------------
// MONTHLY PROPERTY REPORT (Word/.docx)
// ---------------------------------------------------------------------
// Mirrors the paper rent-roll format: HSE NO / UNIT LABEL / UNITS /
// H2O METRES / RENT PAYABLE / NAME / CONTACT / <month> / DATE-T.CODE /
// ARR, a commission summary, a deposit-refund table, and a free-text
// recommendations line. Built client-side with the `docx` library
// (loaded globally as `window.docx` — see dashboard.html) and downloaded
// the same way exportCSV() already downloads a CSV, just as a .docx blob.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthRangeFromInput(monthStr) {
  // monthStr is "YYYY-MM" from <input type="month">
  const [y, m] = monthStr.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), year: y, monthIndex: m - 1 };
}

async function buildPropertyReportData(landlordId, monthStr, garbageFee) {
  const landlordDoc = landlordsCache.find((d) => d.id === landlordId);
  if (!landlordDoc) throw new Error("Please choose a property.");
  const { start, end, year, monthIndex } = monthRangeFromInput(monthStr);

  const propertyUnits = unitsCache
    .filter((d) => d.data().landlordId === landlordId)
    .sort((a, b) => (a.data().houseNumber || "").localeCompare(b.data().houseNumber || "", undefined, { numeric: true }));

  // Reuses the existing status+submittedAt composite index (same one
  // showRentRoll/showArrears/showCommissionStatement already rely on)
  // rather than requiring a new landlordId+status+submittedAt index —
  // filtering to this property's units happens client-side below.
  const paymentsSnap = await db.collection("payments")
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();

  const unitIds = new Set(propertyUnits.map((d) => d.id));
  const paymentsByUnit = {};
  paymentsSnap.docs.forEach((doc) => {
    const p = doc.data();
    if (!unitIds.has(p.unitId)) return;
    (paymentsByUnit[p.unitId] = paymentsByUnit[p.unitId] || []).push(p);
  });

  // Deposits has no per-landlord composite index either — it's a small
  // collection, so pulling it whole and filtering here avoids needing one.
  const depositsSnap = await db.collection("deposits").get();
  const allDeposits = depositsSnap.docs.map((d) => d.data());
  const depositsCollected = allDeposits.filter((d) => d.landlordId === landlordId && (d.paidAt || "").startsWith(monthStr));
  const depositsRefunded = allDeposits.filter((d) => d.landlordId === landlordId && d.status === "refunded"
    && d.refundedAt && d.refundedAt.toDate && d.refundedAt.toDate() >= start && d.refundedAt.toDate() < end);

  const configDoc = await db.doc("settings/commission").get();
  const config = configDoc.exists ? configDoc.data() : { commissionRate: 0.06, cleaningFee: 2000 };

  const rows = propertyUnits.map((doc, i) => {
    const u = doc.data();
    const vacant = u.occupancy === "vacant";
    const tenantDoc = !vacant ? tenantsCache.find((t) => t.data().unitId === doc.id) : null;
    const t = tenantDoc ? tenantDoc.data() : null;
    const unitPayments = paymentsByUnit[doc.id] || [];
    const totalPaid = unitPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    // NOTE: assumes tenant contact is stored as `contact`, `phone`, or
    // `phoneNumber` on the tenant doc — none of these fields appear in
    // portal.js/dashboard.js today, so confirm the real field name.
    const contact = t ? (t.contact || t.phone || t.phoneNumber || "—") : "—";
    const rentAmount = Number(u.rentAmount || 0);
    return {
      hseNo: i + 1,
      unitLabel: u.houseNumber || "",
      unitType: u.unitType || "",
      waterMeter: u.waterMeterNumber || "",
      rentAmount,
      name: vacant ? "V" : (t ? t.name || "—" : "—"),
      contact: vacant ? "V" : contact,
      monthCell: vacant ? "V" : (totalPaid > 0 ? totalPaid : "NP"),
      dateCode: unitPayments.map((p) => `${p.paidAtRaw || ""}/${p.transactionCode || "Manual"}`).join("\n"),
      arr: !vacant && totalPaid < rentAmount ? rentAmount - totalPaid : 0
    };
  });

  const totalRentPayable = rows.reduce((s, r) => s + r.rentAmount, 0);
  const totalCollected = rows.reduce((s, r) => s + (typeof r.monthCell === "number" ? r.monthCell : 0), 0);
  const commissionable = totalCollected;
  const commission = Math.round(commissionable * config.commissionRate);
  const cleaningFee = Number(config.cleaningFee || 0);

  return {
    landlordName: landlordDoc.data().name,
    propertyName: propertyUnits[0] ? propertyUnits[0].data().propertyName || "" : "",
    monthLabel: `${MONTH_NAMES[monthIndex]} ${year}`,
    monthShort: MONTH_NAMES[monthIndex].slice(0, 3).toUpperCase(),
    rows,
    totalRentPayable,
    totalCollected,
    garbageFee: Number(garbageFee || 0),
    totalDepositsCollected: depositsCollected.reduce((s, d) => s + Number(d.amountPaid || 0), 0),
    commissionable,
    commissionRate: config.commissionRate,
    commission,
    cleaningFee,
    totalAgentFees: commission + cleaningFee,
    depositsRefunded: depositsRefunded.map((d) => ({
      tenantName: d.tenantName || "",
      unitLabel: unitLabel(d.unitId),
      totalDeposit: Number(d.amountPaid || 0),
      deductions: Number(d.deductions || 0),
      amountRefundable: Number(d.amountRefundable || 0)
    }))
  };
}

// Builds the docx.Document object for one property's report from data
// already fetched by buildPropertyReportData(). Split out from the old
// single-property generatePropertyReportDocx() so the same document-
// building logic can be reused by the "All Properties" bulk generator
// below without duplicating ~140 lines of table-building code.
function buildPropertyReportDocument(data, recommendations) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, ShadingType, PageOrientation
  } = docx;

  const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: "999999" };
  const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  function headerCell(text, width) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders,
      shading: { type: ShadingType.CLEAR, fill: "F5F7FA" },
      children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: true, size: 18 })] })]
    });
  }
  function bodyCell(text, width, opts = {}) {
    const lines = String(text).split("\n");
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders,
      children: lines.map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 18, bold: !!opts.bold, color: opts.color })] }))
    });
  }

  const colWidths = [700, 1000, 900, 1100, 1200, 1800, 1300, 1100, 1800, 900];
  const headerRow = new TableRow({
    children: ["HSE NO", "UNIT LABEL", "UNITS", "H2O METRES", "RENT PAYABLE", "NAME", "CONTACT", data.monthShort, "DATE/T.CODE", "ARR"]
      .map((label, i) => headerCell(label, colWidths[i]))
  });
  const dataRows = data.rows.map((r) => new TableRow({
    children: [
      bodyCell(r.hseNo, colWidths[0]),
      bodyCell(r.unitLabel, colWidths[1]),
      bodyCell(r.unitType, colWidths[2]),
      bodyCell(r.waterMeter, colWidths[3]),
      bodyCell(money(r.rentAmount), colWidths[4]),
      bodyCell(r.name, colWidths[5]),
      bodyCell(r.contact, colWidths[6]),
      bodyCell(typeof r.monthCell === "number" ? money(r.monthCell) : r.monthCell, colWidths[7]),
      bodyCell(r.dateCode, colWidths[8]),
      bodyCell(r.arr ? money(r.arr) : "", colWidths[9], { color: "B42323", bold: true })
    ]
  }));
  const totalsRow = new TableRow({
    children: [
      headerCell("TOTAL", colWidths[0]), headerCell("", colWidths[1]), headerCell("", colWidths[2]), headerCell("", colWidths[3]),
      headerCell(money(data.totalRentPayable), colWidths[4]), headerCell("", colWidths[5]), headerCell("", colWidths[6]),
      headerCell(money(data.totalCollected), colWidths[7]), headerCell("", colWidths[8]), headerCell("", colWidths[9])
    ]
  });
  const mainTable = new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows, totalsRow]
  });

  function summaryRow(label, value, opts = {}) {
    return new TableRow({ children: [bodyCell(label, 4500, { bold: true }), bodyCell(value, 2500, opts)] });
  }
  const summaryTable = new Table({
    width: { size: 7000, type: WidthType.DXA },
    columnWidths: [4500, 2500],
    rows: [
      summaryRow("TOTAL RENT COLLECTED", money(data.totalCollected)),
      summaryRow("GARBAGE", money(data.garbageFee)),
      summaryRow("TOTAL DEPOSIT COLLECTED", money(data.totalDepositsCollected)),
      summaryRow("AMOUNT COMMISSIONABLE", money(data.commissionable)),
      summaryRow(`SANEFI COMMISSION (${(data.commissionRate * 100).toFixed(1)}%)`, money(data.commission)),
      summaryRow("CLEANING", money(data.cleaningFee)),
      summaryRow("AMOUNT DUE TO AGENT", money(data.totalAgentFees), { bold: true })
    ]
  });

  const refundColWidths = [1800, 1200, 1600, 1600, 1700];
  const refundHeader = new TableRow({
    children: ["TENANT NAME", "HSE NO", "TOTAL DEPOSIT PAID", "DEDUCTIONS", "AMOUNT REFUNDABLE"]
      .map((label, i) => headerCell(label, refundColWidths[i]))
  });
  const refundRows = data.depositsRefunded.length
    ? data.depositsRefunded.map((d) => new TableRow({
        children: [
          bodyCell(d.tenantName, refundColWidths[0]),
          bodyCell(d.unitLabel, refundColWidths[1]),
          bodyCell(money(d.totalDeposit), refundColWidths[2]),
          bodyCell(money(d.deductions), refundColWidths[3]),
          bodyCell(money(d.amountRefundable), refundColWidths[4])
        ]
      }))
    : [new TableRow({ children: [bodyCell("No deposit refunds processed this month.", refundColWidths.reduce((a, b) => a + b, 0))] })];
  const refundTable = new Table({
    width: { size: refundColWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: refundColWidths,
    rows: [refundHeader, ...refundRows]
  });

  return new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, orientation: PageOrientation.LANDSCAPE } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({
            text: `${data.landlordName}${data.propertyName ? " | " + data.propertyName : ""} | ${data.monthLabel.toUpperCase()} REPORT`,
            bold: true, size: 26
          })]
        }),
        mainTable,
        new Paragraph({ text: "", spacing: { after: 200 } }),
        summaryTable,
        new Paragraph({ text: "", spacing: { after: 200 } }),
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({ text: "KEY: H-HOUSE | W-WATER | LL-LANDLORD | NP-NOT PAID | V-VACANT", bold: true, underline: {}, color: "B42323", size: 18 })]
        }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "DEPOSIT REFUND", bold: true, size: 22 })] }),
        refundTable,
        new Paragraph({ text: "", spacing: { after: 240 } }),
        new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "RECOMMENDATIONS", bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: recommendations || "—", size: 20 })] })
      ]
    }]
  });
}

function checkDocxLoaded() {
  if (typeof docx === "undefined") {
    // Distinguishes "the script request itself failed" (network/ad-blocker/
    // extension — window.__docxLoadFailed is set by the <script onerror>
    // in dashboard.html) from "the script downloaded fine but never set
    // window.docx" (a CDN build issue), so the on-screen error actually
    // points at the right fix instead of a generic connectivity guess.
    const reason = window.__docxLoadFailed
      ? "The report generator script failed to download (check your internet connection, or an ad blocker / extension may be blocking cdn.jsdelivr.net)."
      : "The report generator script loaded but didn't set itself up correctly (this is a library/CDN issue, not your connection).";
    throw new Error(`${reason} Reload the page and try again; if it keeps happening, open the browser console for details.`);
  }
}

// Builds one property's report blob + suggested filename, without
// triggering any download itself — used by both the single-property
// download and the "All Properties" zip builder below.
async function buildPropertyReportBlob(landlordId, monthStr, garbageFee, recommendations) {
  const { Packer } = docx;
  const data = await buildPropertyReportData(landlordId, monthStr, garbageFee);
  const doc = buildPropertyReportDocument(data, recommendations);
  const blob = await Packer.toBlob(doc);
  const filename = `${data.landlordName.replace(/\s+/g, "_")}-${monthStr}-report.docx`;
  return { blob, filename, hadUnits: data.rows.length > 0 };
}

async function generatePropertyReportDocx(landlordId, monthStr, garbageFee, recommendations) {
  checkDocxLoaded();
  const { blob, filename } = await buildPropertyReportBlob(landlordId, monthStr, garbageFee, recommendations);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// "Generate All Properties": loops every landlord that actually has
// units, builds each one's report blob in turn (sequential, not
// parallel, so the progress callback can report N/total and so we don't
// fire dozens of simultaneous Firestore queries at once), and bundles
// them into a single .zip so the browser only triggers one download
// instead of one per property (which browsers/ad-blockers often block
// or prompt individually for).
async function generateAllPropertyReportsZip(monthStr, garbageFee, recommendations, onProgress) {
  checkDocxLoaded();
  if (typeof JSZip === "undefined") {
    throw new Error("The zip generator didn't load — check your internet connection and reload the page.");
  }
  const propertiesWithUnits = landlordsCache.filter((l) => unitsCache.some((u) => u.data().landlordId === l.id));
  if (propertiesWithUnits.length === 0) {
    throw new Error("No properties with units to report on.");
  }

  const zip = new JSZip();
  for (let i = 0; i < propertiesWithUnits.length; i++) {
    const landlordId = propertiesWithUnits[i].id;
    if (onProgress) onProgress(i, propertiesWithUnits.length);
    const { blob, filename } = await buildPropertyReportBlob(landlordId, monthStr, garbageFee, recommendations);
    zip.file(filename, blob);
  }
  if (onProgress) onProgress(propertiesWithUnits.length, propertiesWithUnits.length);

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `property-reports-${monthStr}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

async function showCommissionStatement() {
  const output = document.getElementById("report-output");
  output.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;
  const landlordId = document.getElementById("report-landlord").value;
  const { start, end } = currentMonthRange();

  const configDoc = await db.doc("settings/commission").get();
  const config = configDoc.exists ? configDoc.data() : { commissionRate: 0.06, cleaningFee: 2000 };

  const paymentsSnap = await db.collection("payments")
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();

  const relevantLandlords = landlordId ? landlordsCache.filter((l) => l.id === landlordId) : landlordsCache;

  const statements = relevantLandlords.map((l) => {
    // Every verified payment counts toward commission the same way,
    // whether the tenant submitted it themselves or staff entered it on
    // their behalf — money always lands in the landlord's own account
    // either way, and Sanefi's fee is for managing that collection.
    const collected = paymentsSnap.docs
      .filter((d) => d.data().landlordId === l.id)
      .reduce((sum, d) => sum + Number(d.data().amount || 0), 0);
    const commission = Math.round(collected * config.commissionRate);
    const totalFees = commission + config.cleaningFee;
    const dueToLandlord = collected - totalFees;
    return { name: l.data().name, collected, commission, cleaningFee: config.cleaningFee, totalFees, dueToLandlord };
  });

  output.innerHTML = `<div class="card"><div class="card-title">Commission Statement &mdash; ${start.toLocaleString("en-KE", { month: "long", year: "numeric" })}</div>` +
    statements.map((s) => `
      <div style="padding:12px 0; border-bottom:1px solid var(--border);">
        <div style="font-weight:700; margin-bottom:6px;">${escapeHTML(s.name)}</div>
        <div class="payment-row"><div>Rent Collected</div><span>${money(s.collected)}</span></div>
        <div class="payment-row"><div>Commission (${(config.commissionRate * 100).toFixed(1)}%)</div><span>${money(s.commission)}</span></div>
        <div class="payment-row"><div>Cleaning Fee</div><span>${money(s.cleaningFee)}</span></div>
        <div class="payment-row"><div><strong>Amount Due to Landlord</strong></div><span><strong>${money(s.dueToLandlord)}</strong></span></div>
      </div>`).join("") + `</div>`;
}

async function showRentRoll() {
  const output = document.getElementById("report-output");
  output.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;
  const landlordId = document.getElementById("report-landlord").value;
  const { start, end } = currentMonthRange();

  const relevantUnits = unitsCache.filter((u) => !landlordId || u.data().landlordId === landlordId);
  const paymentsSnap = await db.collection("payments")
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();

  const paidUnitIds = new Set(paymentsSnap.docs.map((d) => d.data().unitId));

  output.innerHTML = `<div class="card"><div class="card-title">Rent Roll &mdash; ${start.toLocaleString("en-KE", { month: "long", year: "numeric" })}</div>` +
    relevantUnits.map((u) => {
      const paid = paidUnitIds.has(u.id);
      return `<div class="payment-row"><div>${u.data().houseNumber} &middot; ${landlordName(u.data().landlordId)}</div>${paid ? `<span class="pill pill-verified">Paid</span>` : `<span class="pill pill-rejected">Unpaid</span>`}</div>`;
    }).join("") + `</div>`;
}

async function showArrears() {
  const output = document.getElementById("report-output");
  output.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;
  const landlordId = document.getElementById("report-landlord").value;
  const { start, end } = currentMonthRange();

  const relevantUnits = unitsCache.filter((u) => !landlordId || u.data().landlordId === landlordId);
  const paymentsSnap = await db.collection("payments")
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();
  const paidUnitIds = new Set(paymentsSnap.docs.map((d) => d.data().unitId));
  const overdue = relevantUnits.filter((u) => !paidUnitIds.has(u.id));

  output.innerHTML = `<div class="card"><div class="card-title">Arrears &mdash; ${overdue.length} unit(s) overdue this month</div>` +
    (overdue.length === 0 ? `<p class="empty-state">Everyone's paid up!</p>` :
      overdue.map((u) => `<div class="payment-row"><div>${u.data().houseNumber} &middot; ${landlordName(u.data().landlordId)}</div><span>${money(u.data().rentAmount)}</span></div>`).join("")
    ) + `</div>`;
}

// Bug fix: values (unit names, landlord names, transaction codes) were
// dropped into the CSV unquoted. A comma inside any of those fields
// used to silently shift every column after it. Each field is now
// quoted and internal quotes are escaped per the CSV spec.
function csvField(value) {
  const str = String(value == null ? "" : value);
  return `"${str.replace(/"/g, '""')}"`;
}

async function exportCSV() {
  const landlordId = document.getElementById("report-landlord").value;
  const snap = await db.collection("payments").where("status", "==", "verified").get();
  const rows = snap.docs
    .filter((d) => !landlordId || d.data().landlordId === landlordId)
    .map((d) => {
      const p = d.data();
      return [
        csvField(p.transactionCode),
        csvField(p.amount),
        csvField(unitLabel(p.unitId)),
        csvField(landlordName(p.landlordId)),
        csvField(p.method),
        csvField(p.paidAtRaw)
      ].join(",");
    });
  const header = ["Transaction Code", "Amount", "Unit", "Landlord", "Method", "Paid At"].map(csvField).join(",");
  const csv = header + "\n" + rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "payment-history.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  const { role } = await getCurrentUserRole(user);
  if (role !== "staff") {
    window.location.href = role === "tenant" ? "portal.html" : "login.html";
    return;
  }

  contentBox.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;

  // Bug fix: this used to run a second, separate .get() on
  // tenants/units just to compute the stat row, duplicating the exact
  // reads startLiveCaches() was about to make anyway. Now it waits for
  // the live caches' first snapshot and reads the same in-memory data.
  startLiveCaches(async () => {
    const [pendingSnap, paidUnitIds] = await Promise.all([
      db.collection("payments").where("status", "==", "pending").get(),
      getPaidUnitIdsThisMonth()
    ]);
    const overdueCount = tenantsCache.filter((d) => isOverdue(d.data(), paidUnitIds)).length;
    const occupiedCount = unitsCache.filter((d) => d.data().occupancy !== "vacant").length;
    const vacantCount = unitsCache.length - occupiedCount;

    statRow.innerHTML = `
      <div class="stat-box"><div class="num">${pendingSnap.size}</div><div class="label">Pending Payments</div></div>
      <div class="stat-box"><div class="num">${tenantsCache.length}</div><div class="label">Total Tenants</div></div>
      <div class="stat-box"><div class="num">${occupiedCount}</div><div class="label">Occupied Units</div></div>
      <div class="stat-box"><div class="num">${vacantCount}</div><div class="label">Vacant Units</div></div>
      <div class="stat-box"><div class="num">${overdueCount}</div><div class="label">Overdue This Month</div></div>`;

    renderTabs();
    renderActiveTab();
    hideLoadingOverlay();
  });

  const notifBtn = document.getElementById("notif-btn");
  const notifPanel = document.getElementById("notif-panel");
  wireNotificationToggle(notifBtn, notifPanel);
  attachNotificationBell(notifBtn, notifPanel, "staff");
});
