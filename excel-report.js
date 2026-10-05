// =====================================================================
// excel-report.js  (v2 - Landlord / Deposit Refunds / Agent blocks)
//
// Generates the monthly property report as a real Excel (.xlsx) file
// laid out like the manual landlord sheet:
//
//  TOP     the tenant table: UNIT NUMBER | UNIT | PAYABLE RENT | WATER METER NO |
//          TENANT NAME | CONTACT | PREV ARR | <MONTH> | DATE/T.CODE | DEPOSITS |
//          ARREARS | PRV H2O READING | CURRENT READING | Units used
//  BELOW   three blocks side by side:
//          LANDLORD (left)  |  DEPOSIT REFUNDS (middle)  |  AGENT (right)
//
// Every total is a real Excel FORMULA, so it always adds up and recalculates
// if someone edits a cell. What differs between landlords (commission rate,
// rent tax rate, cleaning fee, repairs, penalties, water bill...) is entered in
// Reports > Statement Items and saved per landlord / per month.
//
// Load AFTER dashboard.js, and load ExcelJS first:
//   <script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
//   <script src="excel-report.js"></script>
//
// Firestore collections used (staff need read + write on all three):
//   meterReadings/{unitId}_{YYYY-MM}        water readings
//   statementItems/{landlordId}_{YYYY-MM}   rates, overrides and line items for one month
//   statementDefaults/{landlordId}          last-used rates, to pre-fill next month
//
// Uses these from dashboard.js:
//   db, landlordsCache, unitsCache, tenantsCache, buildPropertyReportData,
//   monthRangeFromInput, collapsePanelHTML, wireCollapsePanel, escapeHTML,
//   unitLabel, JSZip
// =====================================================================

const XL_COL_WIDTHS = [17, 9, 13, 15, 32, 28, 11, 13, 32, 11, 11, 14, 15, 11];
const XL_HEADERS = [
  "UNIT NUMBER", "UNIT", "PAYABLE RENT", "WATER METER NO", "TENANT NAME", "CONTACT",
  "PREV ARR", null /* month, filled per report */, "DATE/T.CODE", "DEPOSITS", "ARREARS",
  "PRV H2O READING", "CURRENT READING", "Units used"
];
const XL_FIRST_DATA_ROW = 7; // header on row 5, "RENT" sub-header on row 6 (same as the manual sheet)
const XL_MONEY_FMT = "#,##0";
const XL_MONEY_BLANK_ZERO = '#,##0;-#,##0;;@'; // zero shows as empty, like the manual sheet
const XL_DASH_FMT = '#,##0;-#,##0;"-"';        // zero shows as "-", like the landlord block

// "19/9/26 4:21 PM/UIJLO7Z5IK" -> "19-09/UIJLO7Z5IK" (the manual sheet's style).
// Anything that doesn't match the pattern is left exactly as it was.
function xlFormatDateCode(text) {
  return String(text || "").split("\n").map((line) => {
    const m = line.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}[^\/]*\/(.+)$/);
    return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}/${m[3]}` : line;
  }).join("\n");
}

function xlPreviousMonthStr(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// 1. DATA: reuse buildPropertyReportData() and add what the Excel sheet
//    needs but the Word report never had.
//    Requires one tiny change in dashboard.js: each row must carry
//    `unitId: doc.id` (see install notes).
// ---------------------------------------------------------------------
async function buildExcelReportData(landlordId, monthStr, garbageFeeOverride) {
  const data = await buildPropertyReportData(landlordId, monthStr, garbageFeeOverride);
  const prevStr = xlPreviousMonthStr(monthStr);
  const prevRange = monthRangeFromInput(prevStr);
  const thisRange = monthRangeFromInput(monthStr);

  const [prevPaySnap, depSnap, readSnap, stmtSnap, defSnap] = await Promise.all([
    db.collection("payments")
      .where("status", "==", "verified")
      .where("submittedAt", ">=", prevRange.start)
      .where("submittedAt", "<", prevRange.end)
      .get(),
    db.collection("deposits").where("landlordId", "==", landlordId).get(),
    db.collection("meterReadings")
      .where("landlordId", "==", landlordId)
      .where("month", "in", [monthStr, prevStr])
      .get(),
    db.collection("statementItems").doc(`${landlordId}_${monthStr}`).get(),
    db.collection("statementDefaults").doc(landlordId).get()
  ]);

  // ---- previous arrears, per-unit deposits, water readings --------------
  const paidPrevByUnit = {};
  prevPaySnap.docs.forEach((d) => {
    const p = d.data();
    paidPrevByUnit[p.unitId] = (paidPrevByUnit[p.unitId] || 0) + Number(p.amount || 0);
  });

  const depositsByUnit = {};
  depSnap.docs.forEach((d) => {
    const dep = d.data();
    if ((dep.paidAt || "").startsWith(monthStr)) {
      depositsByUnit[dep.unitId] = (depositsByUnit[dep.unitId] || 0) + Number(dep.amountPaid || 0);
    }
  });

  const readings = {}; // unitId -> { cur, prev }
  readSnap.docs.forEach((d) => {
    const r = d.data();
    readings[r.unitId] = readings[r.unitId] || {};
    if (r.month === monthStr) readings[r.unitId].cur = Number(r.reading);
    if (r.month === prevStr) readings[r.unitId].prev = Number(r.reading);
  });

  data.rows = data.rows.map((r) => {
    const vacant = r.name === "V";
    const tenantDoc = tenantsCache.find((t) => t.data().unitId === r.unitId);
    const leaseStart = tenantDoc && tenantDoc.data().leaseStartDate ? new Date(tenantDoc.data().leaseStartDate) : null;
    // A tenant who moved in after last month ended can't owe last month's rent.
    const movedInThisMonth = leaseStart && !isNaN(leaseStart) && leaseStart >= prevRange.end;
    const prevArr = vacant || movedInThisMonth
      ? 0
      : Math.max(r.rentAmount - (paidPrevByUnit[r.unitId] || 0), 0);
    const rd = readings[r.unitId] || {};
    return {
      ...r,
      prevArr,
      deposit: depositsByUnit[r.unitId] || null,
      prevReading: rd.prev !== undefined ? rd.prev : null,
      curReading: rd.cur !== undefined ? rd.cur : null
    };
  });

  // ---- rates + statement items (month's own values win, then the landlord's
  //      last-used defaults, then the global settings) ---------------------
  const stmt = stmtSnap.exists ? stmtSnap.data() : {};
  const defs = defSnap.exists ? defSnap.data() : {};
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "");
  data.commissionRate = Number(pick(stmt.commissionRate, defs.commissionRate, data.commissionRate));
  data.taxRate = Number(pick(stmt.rentTaxRate, defs.rentTaxRate, 0));
  data.cleaningFee = Number(pick(stmt.cleaningFee, defs.cleaningFee, data.cleaningFee, 0));
  data.taxOverride = pick(stmt.rentTaxOverride) === undefined ? null : Number(stmt.rentTaxOverride);
  data.agentFeeOverride = pick(stmt.agentFeeOverride) === undefined ? null : Number(stmt.agentFeeOverride);
  data.items = Array.isArray(stmt.items) ? stmt.items : [];

  // ---- deposit refunds for this month, with the extra columns the manual sheet has
  data.refunds = depSnap.docs
    .map((d) => d.data())
    .filter((d) => d.status === "refunded" && d.refundedAt && d.refundedAt.toDate
      && d.refundedAt.toDate() >= thisRange.start && d.refundedAt.toDate() < thisRange.end)
    .map((d) => {
      const t = tenantsCache.find((x) => x.data().unitId === d.unitId);
      const td = t ? t.data() : null;
      return {
        houseNo: unitLabel(d.unitId),
        tenantName: d.tenantName || "",
        contact: td ? (td.contact || td.phone || td.phoneNumber || "") : "",
        amountPaid: Number(d.amountPaid || 0),
        deductions: Number(d.deductions || 0),
        depositRef: d.depositRef || "",
        refundRef: d.refundRef || ""
      };
    });

  return data;
}

// ---------------------------------------------------------------------
// 2. WORKBOOK BUILDER (pure: takes the ExcelJS library + data, returns a
//    workbook; no browser or Firebase access, so it can be tested alone)
// ---------------------------------------------------------------------
function buildPropertyWorkbook(ExcelJSLib, data, recommendations) {
  const wb = new ExcelJSLib.Workbook();
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 6 }] });
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const FONT = { name: "Arial", size: 10 };
  const thin = { style: "thin", color: { argb: "FF999999" } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
  const INPUT_BLUE = { argb: "FF0000FF" };
  const RED = { argb: "FFB42323" };

  function put(cell, value, opts = {}) {
    cell.value = value;
    cell.font = { ...FONT, bold: !!opts.bold, italic: !!opts.italic, color: opts.color, size: opts.size || FONT.size };
    if (opts.border !== false) cell.border = BORDER;
    if (opts.fill) cell.fill = opts.fill;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    cell.alignment = { vertical: "top", wrapText: !!opts.wrap, horizontal: opts.align };
  }
  // Merge across one row. Only the first cell may hold a value; the rest get style only.
  function mergeRow(r, c1, c2) {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    for (let c = c1 + 1; c <= c2; c++) ws.getCell(r, c).border = BORDER;
  }
  function blockHeader(r, c1, c2, text) {
    mergeRow(r, c1, c2);
    put(ws.getCell(r, c1), text, { bold: true, fill: HEADER_FILL, align: "center" });
    for (let c = c1 + 1; c <= c2; c++) ws.getCell(r, c).fill = HEADER_FILL;
  }

  ws.columns = XL_COL_WIDTHS.map((w) => ({ width: w }));

  // ================= TITLE + TENANT TABLE =================================
  const monthName = data.monthLabel.split(" ")[0].toUpperCase();
  ws.mergeCells("A2:N2");
  put(ws.getCell("A2"), `${data.landlordName}${data.propertyName ? " | " + data.propertyName : ""} | ${data.monthLabel.toUpperCase()} REPORT`,
    { bold: true, size: 13, border: false, align: "center" });

  XL_HEADERS.forEach((h, i) => {
    put(ws.getCell(5, i + 1), i === 7 ? monthName : h, { bold: true, fill: HEADER_FILL, align: "center", wrap: true });
  });
  for (let c = 1; c <= 14; c++) put(ws.getCell(6, c), c === 8 ? "RENT" : null, { bold: true, fill: HEADER_FILL, align: "center" });

  const first = XL_FIRST_DATA_ROW;
  const last = first + data.rows.length - 1;
  const T = last + 1; // totals row

  // Excel recalculates formulas when the file is opened, but phone previews and
  // some viewers only show the saved result, so every formula also carries its result.
  const sums = { C: 0, G: 0, H: 0, J: 0, K: 0, N: 0 };

  data.rows.forEach((r, i) => {
    const n = first + i;
    const vacant = r.name === "V";
    const paid = typeof r.monthCell === "number" ? r.monthCell : 0;
    const arrears = vacant ? null : Math.max((r.prevArr || 0) + r.rentAmount - paid, 0);
    const used = typeof r.prevReading === "number" && typeof r.curReading === "number" ? r.curReading - r.prevReading : "";
    sums.C += r.rentAmount; sums.G += r.prevArr || 0; sums.H += paid; sums.J += r.deposit || 0;
    sums.K += arrears || 0; sums.N += used === "" ? 0 : used;
    put(ws.getCell(n, 1), r.unitLabel);
    put(ws.getCell(n, 2), r.unitType);
    put(ws.getCell(n, 3), r.rentAmount, { numFmt: XL_MONEY_FMT });
    put(ws.getCell(n, 4), r.waterMeter ? String(r.waterMeter) : null);
    put(ws.getCell(n, 5), vacant ? "V" : String(r.name).toUpperCase(), { wrap: true });
    put(ws.getCell(n, 6), r.contact, { wrap: true });
    put(ws.getCell(n, 7), r.prevArr || null, { numFmt: XL_MONEY_BLANK_ZERO });
    put(ws.getCell(n, 8), r.monthCell, { numFmt: XL_MONEY_FMT, align: typeof r.monthCell === "number" ? undefined : "center" });
    put(ws.getCell(n, 9), vacant ? null : xlFormatDateCode(r.dateCode), { wrap: true });
    put(ws.getCell(n, 10), r.deposit, { numFmt: XL_MONEY_BLANK_ZERO });
    // ARREARS = what was owed before + this month's rent - what was paid.
    // N() turns the text "NP"/"V" into 0 so the formula never errors.
    put(ws.getCell(n, 11), vacant ? null : { formula: `MAX(G${n}+C${n}-N(H${n}),0)`, result: arrears },
      { numFmt: XL_MONEY_BLANK_ZERO, color: RED, bold: true });
    put(ws.getCell(n, 12), r.prevReading);
    put(ws.getCell(n, 13), r.curReading);
    put(ws.getCell(n, 14), { formula: `IF(AND(ISNUMBER(L${n}),ISNUMBER(M${n})),M${n}-L${n},"")`, result: used });
  });

  for (let c = 1; c <= 14; c++) put(ws.getCell(T, c), null, { bold: true, fill: HEADER_FILL });
  ws.getCell(T, 1).value = "TOTAL";
  [[3, "C"], [7, "G"], [8, "H"], [10, "J"], [11, "K"], [14, "N"]].forEach(([c, L]) => {
    const cell = ws.getCell(T, c);
    cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result: sums[L] };
    cell.numFmt = XL_MONEY_FMT;
  });

  // ================= THE THREE BLOCKS =====================================
  const S = T + 2;                              // first row of all three blocks
  const items = data.items || [];
  const num = (v) => Number(v) || 0;
  const byKind = (k) => items.filter((i) => i.kind === k);
  const total = (list) => list.reduce((s, i) => s + num(i.amount), 0);
  // One typed amount stays a plain number; several become e.g. =500+300 so the parts stay visible.
  const compose = (list) => list.length === 0 ? 0
    : list.length === 1 ? num(list[0].amount)
    : { formula: list.map((i) => num(i.amount)).join("+").replace(/\+-/g, "-"), result: total(list) };

  const repairs = byKind("repair");
  const penalties = byKind("penalty");
  const water = byKind("water");
  const others = byKind("other");

  const gross = sums.H;
  const commission = Math.round(gross * data.commissionRate);
  const taxAmount = data.taxOverride != null ? data.taxOverride : Math.round(gross * data.taxRate);
  const agentFee = data.agentFeeOverride != null ? data.agentFeeOverride : commission;
  const repairsTotal = total(repairs);

  // ---- AGENT block (columns L:N) -----------------------------------------
  const A_COMMISSIONABLE = S + 1, A_COMMISSION = S + 2, R_FIRST = S + 3, R_LAST = S + 2 + repairs.length, A_FEE = S + 3 + repairs.length;
  blockHeader(S, 12, 14, "AGENT");
  mergeRow(A_COMMISSIONABLE, 12, 13);
  put(ws.getCell(A_COMMISSIONABLE, 12), "Amount commissionable", { bold: true });
  put(ws.getCell(A_COMMISSIONABLE, 14), { formula: `H${T}`, result: gross }, { numFmt: XL_DASH_FMT });
  put(ws.getCell(A_COMMISSION, 12), "Commission amount", { bold: true, wrap: true });
  put(ws.getCell(A_COMMISSION, 13), data.commissionRate, { numFmt: "0.0%", color: INPUT_BLUE });
  put(ws.getCell(A_COMMISSION, 14), { formula: `ROUND(N${A_COMMISSIONABLE}*M${A_COMMISSION},0)`, result: commission }, { numFmt: XL_DASH_FMT });
  repairs.forEach((it, i) => {
    const rr = R_FIRST + i;
    mergeRow(rr, 12, 13);
    put(ws.getCell(rr, 12), `Repairs ${i + 1}  ${String(it.label || "").toUpperCase()}`, { wrap: true });
    put(ws.getCell(rr, 14), num(it.amount), { numFmt: XL_DASH_FMT, color: INPUT_BLUE });
  });
  mergeRow(A_FEE, 12, 13);
  put(ws.getCell(A_FEE, 12), "Fee:", { bold: true, align: "right" });
  put(ws.getCell(A_FEE, 14),
    { formula: repairs.length ? `N${A_COMMISSION}+SUM(N${R_FIRST}:N${R_LAST})` : `N${A_COMMISSION}`, result: commission + repairsTotal },
    { numFmt: XL_DASH_FMT, bold: true });
  const agentEnd = A_FEE;

  // ---- LANDLORD block (columns A:C) --------------------------------------
  let r = S;
  blockHeader(r, 1, 3, "LANDLORD"); r++;
  const G_ROW = r;
  function llRow(label, value, o = {}) {
    if (o.rate === undefined) { mergeRow(r, 1, 2); put(ws.getCell(r, 1), label, { bold: true, wrap: true }); }
    else {
      put(ws.getCell(r, 1), label, { bold: true });
      put(ws.getCell(r, 2), o.rate, { numFmt: "0.0%", color: INPUT_BLUE });
    }
    put(ws.getCell(r, 3), value, { numFmt: XL_DASH_FMT, color: o.blue ? INPUT_BLUE : undefined, bold: !!o.bold });
    r++;
  }
  llRow("Gross income", { formula: `H${T}`, result: gross });
  const FIRST_DEDUCTION = r;
  llRow("Rent tax",
    data.taxOverride != null ? data.taxOverride : { formula: `ROUND(C${G_ROW}*B${r},0)`, result: taxAmount },
    { rate: data.taxRate, blue: data.taxOverride != null });
  llRow("Penalties", compose(penalties), { blue: true });
  llRow("Agent fee", data.agentFeeOverride != null ? data.agentFeeOverride : { formula: `N${A_COMMISSION}`, result: commission },
    { blue: data.agentFeeOverride != null });
  llRow("Garbage collection", num(data.garbageFee), { blue: true });
  llRow("Cleaning fee", num(data.cleaningFee), { blue: true });
  llRow("Water bill", compose(water), { blue: true });
  others.forEach((it) => llRow(String(it.label || "Other"), num(it.amount), { blue: true }));
  llRow("Repairs", repairs.length ? { formula: `SUM(N${R_FIRST}:N${R_LAST})`, result: repairsTotal } : 0);
  const LAST_DEDUCTION = r - 1;
  const deductions = taxAmount + total(penalties) + agentFee + num(data.garbageFee) + num(data.cleaningFee)
    + total(water) + total(others) + repairsTotal;
  mergeRow(r, 1, 2);
  put(ws.getCell(r, 1), "Net income:", { bold: true });
  put(ws.getCell(r, 3), { formula: `C${G_ROW}-SUM(C${FIRST_DEDUCTION}:C${LAST_DEDUCTION})`, result: gross - deductions },
    { numFmt: XL_DASH_FMT, bold: true });
  const landlordEnd = r;

  // ---- DEPOSIT REFUNDS block (columns D:K) -------------------------------
  const refunds = data.refunds || [];
  let d = S;
  blockHeader(d, 4, 11, "DEPOSIT REFUNDS"); d++;
  ["HOUSE NO", "TENANT NAME", "CONTACT", "DEPOSIT PAID", "DEDUCTIONS", "DEPO/REF", "REFUND", "REF"].forEach((h, i) => {
    put(ws.getCell(d, 4 + i), h, { bold: true, fill: HEADER_FILL, align: "center", wrap: true });
  });
  d++;
  if (refunds.length === 0) {
    mergeRow(d, 4, 11);
    put(ws.getCell(d, 4), "No deposit refunds processed this month.", { italic: true });
    d++;
  } else {
    const rf = d;
    let refundTotal = 0;
    refunds.forEach((x) => {
      refundTotal += x.amountPaid - x.deductions;
      put(ws.getCell(d, 4), x.houseNo);
      put(ws.getCell(d, 5), String(x.tenantName).toUpperCase(), { wrap: true });
      put(ws.getCell(d, 6), x.contact ? String(x.contact) : null, { wrap: true });
      put(ws.getCell(d, 7), x.amountPaid, { numFmt: XL_DASH_FMT, color: INPUT_BLUE });
      put(ws.getCell(d, 8), x.deductions || null, { numFmt: XL_DASH_FMT, color: INPUT_BLUE });
      put(ws.getCell(d, 9), x.depositRef || null, { wrap: true });
      put(ws.getCell(d, 10), { formula: `G${d}-H${d}`, result: x.amountPaid - x.deductions }, { numFmt: XL_DASH_FMT });
      put(ws.getCell(d, 11), x.refundRef || null, { wrap: true });
      d++;
    });
    mergeRow(d, 4, 9);
    put(ws.getCell(d, 4), "TOTAL REFUNDS", { bold: true, fill: HEADER_FILL, align: "right" });
    put(ws.getCell(d, 10), { formula: `SUM(J${rf}:J${d - 1})`, result: refundTotal }, { numFmt: XL_DASH_FMT, bold: true, fill: HEADER_FILL });
    put(ws.getCell(d, 11), null, { fill: HEADER_FILL });
    d++;
  }
  const depositEnd = d - 1;

  // ================= FOOTER: KEY, NOTES, RECOMMENDATIONS ==================
  let s = Math.max(landlordEnd, depositEnd, agentEnd) + 2;
  ws.mergeCells(s, 1, s, 14);
  put(ws.getCell(s, 1), "KEY: H-HOUSE | W-WATER | LL-LANDLORD | NP-NOT PAID | V-VACANT",
    { bold: true, color: RED, border: false });
  s += 2;
  const notes = [
    "NOTES",
    "Blue numbers are typed in (rates, fees, repairs, penalties, water bill). Everything else is calculated or pulled from the system.",
    "PREV ARR = last month's unpaid rent (payable rent minus verified payments last month). Older arrears are not carried forward.",
    "ARREARS = PREV ARR + PAYABLE RENT - amount paid this month (never below 0). Vacant units are left blank.",
    "Rent tax = rate x gross income, unless an amount was typed in for this month. Agent fee (landlord block) = commission, unless an amount was typed in.",
    "Repairs are listed in the Agent block; the same total is deducted from the landlord. Agent Fee = commission + repairs.",
    "Units used = CURRENT READING - PRV H2O READING. Readings are entered in Reports > Water Readings.",
    "Rates, penalties, repairs and the water bill are entered in Reports > Statement Items."
  ];
  notes.forEach((t, i) => {
    ws.mergeCells(s, 1, s, 14);
    put(ws.getCell(s, 1), t, { bold: i === 0, italic: i > 0, border: false });
    s++;
  });
  s++;
  put(ws.getCell(s, 1), "RECOMMENDATIONS", { bold: true, border: false });
  s++;
  ws.mergeCells(s, 1, s + 2, 14);
  put(ws.getCell(s, 1), recommendations || "—", { wrap: true, border: false });

  return wb;
}

// ---------------------------------------------------------------------
// 3. DOWNLOAD HELPERS (same shape as the Word ones)
// ---------------------------------------------------------------------
function checkExcelJSLoaded() {
  if (typeof ExcelJS === "undefined") {
    throw new Error("The Excel generator script didn't load (check your internet connection or an ad blocker blocking cdn.jsdelivr.net), then reload the page.");
  }
}

async function buildPropertyXlsxBlob(landlordId, monthStr, garbageFeeOverride, recommendations) {
  const data = await buildExcelReportData(landlordId, monthStr, garbageFeeOverride);
  const wb = buildPropertyWorkbook(ExcelJS, data, recommendations);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filename = `${data.landlordName.replace(/\s+/g, "_")}-${monthStr}-report.xlsx`;
  return { blob, filename };
}

function xlDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function generatePropertyReportXlsx(landlordId, monthStr, garbageFeeOverride, recommendations) {
  checkExcelJSLoaded();
  const { blob, filename } = await buildPropertyXlsxBlob(landlordId, monthStr, garbageFeeOverride, recommendations);
  xlDownload(blob, filename);
}

async function generateAllPropertyReportsXlsxZip(monthStr, recommendations, onProgress) {
  checkExcelJSLoaded();
  if (typeof JSZip === "undefined") throw new Error("The zip generator didn't load — reload the page.");
  const props = landlordsCache.filter((l) => unitsCache.some((u) => u.data().landlordId === l.id));
  if (props.length === 0) throw new Error("No properties with units to report on.");
  const zip = new JSZip();
  for (let i = 0; i < props.length; i++) {
    if (onProgress) onProgress(i, props.length);
    const { blob, filename } = await buildPropertyXlsxBlob(props[i].id, monthStr, undefined, recommendations);
    zip.file(filename, blob);
  }
  if (onProgress) onProgress(props.length, props.length);
  xlDownload(await zip.generateAsync({ type: "blob" }), `property-reports-${monthStr}-excel.zip`);
}

// ---------------------------------------------------------------------
// 4. WATER READINGS PANEL (Reports tab)
//    Stores one doc per unit per month in a NEW collection:
//      meterReadings/{unitId}_{YYYY-MM} = { unitId, landlordId, month, reading }
// ---------------------------------------------------------------------
function waterReadingsPanelHTML(propertyOptions, defaultMonth) {
  return collapsePanelHTML({
    id: "water-readings-panel",
    title: "Water Readings",
    collapsedLabel: "+ Water Readings (for the Excel report)",
    expandedLabel: "Water Readings",
    bodyHTML: `
      <div class="card-sub" style="margin-bottom:14px;">Enter each unit's current water meter reading for the month. "Previous" is filled from last month's saved reading; for the very first month, type it in. These feed the PRV H2O READING, CURRENT READING and Units used columns of the Excel report.</div>
      <div class="field"><label>Property / Landlord</label><select id="wr-landlord"><option value="">Choose a property…</option>${propertyOptions}</select></div>
      <div class="field"><label>Month</label><input type="month" id="wr-month" value="${defaultMonth}"></div>
      <button type="button" class="btn btn-outline" id="wr-load" style="width:auto; padding:10px 16px;">Load Units</button>
      <div id="wr-table-wrap" style="margin-top:14px;"></div>`
  });
}

function wireWaterReadingsPanel() {
  wireCollapsePanel("water-readings-panel", { collapsedLabel: "+ Water Readings (for the Excel report)", expandedLabel: "Water Readings" });
  const wrap = document.getElementById("wr-table-wrap");

  document.getElementById("wr-load").addEventListener("click", async () => {
    const landlordId = document.getElementById("wr-landlord").value;
    const month = document.getElementById("wr-month").value;
    if (!landlordId || !month) { wrap.innerHTML = `<p class="alert alert-error">Choose a property and a month first.</p>`; return; }
    wrap.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;

    const prevMonth = xlPreviousMonthStr(month);
    const units = unitsCache
      .filter((d) => d.data().landlordId === landlordId)
      .sort((a, b) => (a.data().houseNumber || "").localeCompare(b.data().houseNumber || "", undefined, { numeric: true }));
    const snap = await db.collection("meterReadings")
      .where("landlordId", "==", landlordId)
      .where("month", "in", [month, prevMonth])
      .get();
    const cur = {}, prev = {};
    snap.docs.forEach((d) => {
      const r = d.data();
      if (r.month === month) cur[r.unitId] = r.reading;
      if (r.month === prevMonth) prev[r.unitId] = r.reading;
    });

    wrap.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Unit</th><th>Water Meter</th><th>Previous</th><th>Current</th></tr></thead>
        <tbody>${units.map((d) => {
          const u = d.data();
          return `<tr>
            <td data-label="Unit">${escapeHTML(u.houseNumber)}</td>
            <td data-label="Water Meter">${escapeHTML(u.waterMeterNumber || "—")}</td>
            <td data-label="Previous"><input type="number" min="0" step="any" style="width:100px;" data-wr-prev="${d.id}" value="${prev[d.id] ?? ""}"></td>
            <td data-label="Current"><input type="number" min="0" step="any" style="width:100px;" data-wr-cur="${d.id}" value="${cur[d.id] ?? ""}"></td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      <button type="button" class="btn btn-primary" id="wr-save" style="width:auto; padding:10px 18px; margin-top:12px;">Save Readings</button>
      <p class="alert alert-success" id="wr-saved" style="display:none;">Saved.</p>
      <p class="alert alert-error" id="wr-error" style="display:none;"></p>`;

    document.getElementById("wr-save").addEventListener("click", async () => {
      const saveBtn = document.getElementById("wr-save");
      saveBtn.disabled = true;
      document.getElementById("wr-saved").style.display = "none";
      document.getElementById("wr-error").style.display = "none";
      try {
        const batch = db.batch();
        units.forEach((d) => {
          const curVal = wrap.querySelector(`[data-wr-cur="${d.id}"]`).value;
          const prevVal = wrap.querySelector(`[data-wr-prev="${d.id}"]`).value;
          if (curVal !== "") {
            batch.set(db.collection("meterReadings").doc(`${d.id}_${month}`),
              { unitId: d.id, landlordId, month, reading: Number(curVal) });
          }
          if (prevVal !== "" && Number(prevVal) !== prev[d.id]) {
            batch.set(db.collection("meterReadings").doc(`${d.id}_${prevMonth}`),
              { unitId: d.id, landlordId, month: prevMonth, reading: Number(prevVal) });
          }
        });
        await batch.commit();
        document.getElementById("wr-saved").style.display = "block";
      } catch (err) {
        const e = document.getElementById("wr-error");
        e.textContent = "Couldn't save readings: " + err.message;
        e.style.display = "block";
      } finally {
        saveBtn.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------------
// 5. STATEMENT ITEMS PANEL (Reports tab)
//    What differs from landlord to landlord and month to month:
//    commission rate, rent tax rate, cleaning fee, plus a free list of
//    repairs / penalties / water bill / other deductions.
//      statementItems/{landlordId}_{YYYY-MM}  -> this month's values
//      statementDefaults/{landlordId}         -> last-used rates (pre-fill next month)
// ---------------------------------------------------------------------
const XL_ITEM_KINDS = [["repair", "Repair"], ["penalty", "Penalty"], ["water", "Water bill"], ["other", "Other deduction"]];

function statementItemsPanelHTML(propertyOptions, defaultMonth) {
  return collapsePanelHTML({
    id: "statement-items-panel",
    title: "Statement Items",
    collapsedLabel: "+ Statement Items (rates, tax, repairs, penalties, water bill)",
    expandedLabel: "Statement Items",
    bodyHTML: `
      <div class="card-sub" style="margin-bottom:14px;">What changes from one landlord or month to the next. Rates are remembered per landlord and pre-filled next month. Repairs appear in the Agent block and are deducted from the landlord; penalties, water bill and other deductions come off the landlord only.</div>
      <div class="field"><label>Property / Landlord</label><select id="si-landlord"><option value="">Choose a property…</option>${propertyOptions}</select></div>
      <div class="field"><label>Month</label><input type="month" id="si-month" value="${defaultMonth}"></div>
      <button type="button" class="btn btn-outline" id="si-load" style="width:auto; padding:10px 16px;">Load</button>
      <div id="si-wrap" style="margin-top:14px;"></div>`
  });
}

function wireStatementItemsPanel() {
  wireCollapsePanel("statement-items-panel", {
    collapsedLabel: "+ Statement Items (rates, tax, repairs, penalties, water bill)",
    expandedLabel: "Statement Items"
  });
  const wrap = document.getElementById("si-wrap");

  function rowHTML(it) {
    const opts = XL_ITEM_KINDS.map(([v, l]) => `<option value="${v}"${it.kind === v ? " selected" : ""}>${l}</option>`).join("");
    return `<div data-si-row style="display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; align-items:center;">
      <select data-si-kind style="width:150px;">${opts}</select>
      <input type="text" data-si-label placeholder="Description e.g. Gate chain" style="flex:1; min-width:150px;" value="${escapeHTML(it.label || "")}">
      <input type="number" data-si-amount placeholder="KSh" min="0" step="any" style="width:100px;" value="${it.amount === undefined || it.amount === null ? "" : it.amount}">
      <button type="button" class="btn-table-action btn-table-action-danger" data-si-remove>Remove</button>
    </div>`;
  }
  function readRows() {
    return [...wrap.querySelectorAll("[data-si-row]")].map((row) => ({
      kind: row.querySelector("[data-si-kind]").value,
      label: row.querySelector("[data-si-label]").value.trim(),
      amount: row.querySelector("[data-si-amount]").value
    }));
  }
  function paintRows(list) {
    document.getElementById("si-rows").innerHTML = list.map(rowHTML).join("");
    wrap.querySelectorAll("[data-si-remove]").forEach((btn, i) => {
      btn.addEventListener("click", () => { const cur = readRows(); cur.splice(i, 1); paintRows(cur); });
    });
  }

  document.getElementById("si-load").addEventListener("click", async () => {
    const landlordId = document.getElementById("si-landlord").value;
    const month = document.getElementById("si-month").value;
    if (!landlordId || !month) { wrap.innerHTML = `<p class="alert alert-error">Choose a property and a month first.</p>`; return; }
    wrap.innerHTML = `<p class="empty-state">Loading&hellip;</p>`;

    const [stmtSnap, defSnap, cfgSnap] = await Promise.all([
      db.collection("statementItems").doc(`${landlordId}_${month}`).get(),
      db.collection("statementDefaults").doc(landlordId).get(),
      db.doc("settings/commission").get()
    ]);
    const stmt = stmtSnap.exists ? stmtSnap.data() : {};
    const defs = defSnap.exists ? defSnap.data() : {};
    const cfg = cfgSnap.exists ? cfgSnap.data() : { commissionRate: 0.06, cleaningFee: 0 };
    const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== "");
    const pct = (x) => x === undefined ? "" : Math.round(x * 10000) / 100; // 0.07 -> 7
    const val = (x) => (x === undefined || x === null ? "" : x);

    wrap.innerHTML = `
      <div class="field"><label>Commission Rate (%)</label><input type="number" id="si-comm" step="0.01" min="0" max="100" value="${pct(pick(stmt.commissionRate, defs.commissionRate, cfg.commissionRate))}"></div>
      <div class="field"><label>Rent Tax Rate (%)</label><input type="number" id="si-tax" step="0.01" min="0" max="100" value="${pct(pick(stmt.rentTaxRate, defs.rentTaxRate, 0))}"></div>
      <div class="field"><label>Cleaning Fee (KSh)</label><input type="number" id="si-clean" min="0" value="${val(pick(stmt.cleaningFee, defs.cleaningFee, cfg.cleaningFee, 0))}"></div>
      <div class="field"><label>Rent Tax Amount (KSh) — optional</label><input type="number" id="si-tax-over" min="0" value="${val(stmt.rentTaxOverride)}"><small>Leave blank to calculate it from the rate. Fill it in only if the real figure differs.</small></div>
      <div class="field"><label>Agent Fee on Landlord Side (KSh) — optional</label><input type="number" id="si-fee-over" min="0" value="${val(stmt.agentFeeOverride)}"><small>Leave blank to use the commission amount. Fill it in only if the landlord is charged a different figure.</small></div>
      <h3 style="margin:14px 0 8px;">Repairs, penalties, water bill, other</h3>
      <div id="si-rows"></div>
      <button type="button" class="btn btn-outline" id="si-add" style="width:auto; padding:8px 14px; font-size:13px;">+ Add item</button>
      <div style="margin-top:14px;"><button type="button" class="btn btn-primary" id="si-save" style="width:auto; padding:10px 18px;">Save</button></div>
      <p class="alert alert-success" id="si-saved" style="display:none;">Saved.</p>
      <p class="alert alert-error" id="si-error" style="display:none;"></p>`;

    paintRows(Array.isArray(stmt.items) && stmt.items.length ? stmt.items : []);
    document.getElementById("si-add").addEventListener("click", () => {
      paintRows([...readRows(), { kind: "repair", label: "", amount: "" }]);
    });

    document.getElementById("si-save").addEventListener("click", async () => {
      const saveBtn = document.getElementById("si-save");
      const errBox = document.getElementById("si-error");
      document.getElementById("si-saved").style.display = "none";
      errBox.style.display = "none";
      const numOrNull = (id) => { const v = document.getElementById(id).value; return v === "" ? null : Number(v); };
      const commPct = numOrNull("si-comm"), taxPct = numOrNull("si-tax");
      if (commPct === null || commPct < 0 || commPct > 100) { errBox.textContent = "Enter a commission rate between 0 and 100."; errBox.style.display = "block"; return; }
      const itemsToSave = readRows()
        .filter((i) => i.label || i.amount !== "")
        .map((i) => ({ kind: i.kind, label: i.label, amount: Number(i.amount) || 0 }));
      const rates = {
        commissionRate: commPct / 100,
        rentTaxRate: (taxPct || 0) / 100,
        cleaningFee: numOrNull("si-clean") || 0
      };
      saveBtn.disabled = true;
      try {
        const batch = db.batch();
        batch.set(db.collection("statementItems").doc(`${landlordId}_${month}`), {
          landlordId, month, ...rates,
          rentTaxOverride: numOrNull("si-tax-over"),
          agentFeeOverride: numOrNull("si-fee-over"),
          items: itemsToSave
        });
        batch.set(db.collection("statementDefaults").doc(landlordId), rates);
        await batch.commit();
        document.getElementById("si-saved").style.display = "block";
      } catch (err) {
        errBox.textContent = "Couldn't save: " + err.message;
        errBox.style.display = "block";
      } finally {
        saveBtn.disabled = false;
      }
    });
  });
}

// Lets the same file be unit-tested in Node (no browser needed).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildPropertyWorkbook, xlPreviousMonthStr, xlFormatDateCode };
}
