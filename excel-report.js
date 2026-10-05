// =====================================================================
// excel-report.js
// Generates the monthly property report as a real Excel (.xlsx) file
// with the SAME columns as the manual sheet (e.g. MALAIKA_AUGUST_EXCEL):
//
//  UNIT NUMBER | UNIT | PAYABLE RENT | WATER METER NO | TENANT NAME |
//  CONTACT | PREV ARR | <MONTH> RENT | DATE/T.CODE | DEPOSITS |
//  ARREARS | PRV H2O READING | CURRENT READING | Units used
//
// Totals, arrears and "Units used" are real Excel FORMULAS, so they
// always add up correctly and recalculate if someone edits a cell.
//
// Load AFTER dashboard.js, and load ExcelJS first:
//   <script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
//   <script src="excel-report.js"></script>
//
// Uses these existing functions/vars from dashboard.js:
//   db, landlordsCache, unitsCache, tenantsCache, buildPropertyReportData,
//   monthRangeFromInput, collapsePanelHTML, wireCollapsePanel, escapeHTML,
//   unitLabel, MONTH_NAMES, JSZip
// =====================================================================

const XL_COL_WIDTHS = [13, 8, 13, 15, 32, 28, 11, 13, 32, 11, 11, 14, 15, 11];
const XL_HEADERS = [
  "UNIT NUMBER", "UNIT", "PAYABLE RENT", "WATER METER NO", "TENANT NAME", "CONTACT",
  "PREV ARR", null /* month, filled per report */, "DATE/T.CODE", "DEPOSITS", "ARREARS",
  "PRV H2O READING", "CURRENT READING", "Units used"
];
const XL_FIRST_DATA_ROW = 7; // header on row 5, "RENT" sub-header on row 6 (same as the manual sheet)
const XL_MONEY_FMT = "#,##0";
const XL_MONEY_BLANK_ZERO = '#,##0;-#,##0;;@'; // zero shows as empty, like the manual sheet

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
//    needs but the Word report never had (prev arrears, per-unit
//    deposits, water readings).
//    Requires one tiny change in dashboard.js: each row must carry
//    `unitId: doc.id` (see install notes).
// ---------------------------------------------------------------------
async function buildExcelReportData(landlordId, monthStr, garbageFeeOverride) {
  const data = await buildPropertyReportData(landlordId, monthStr, garbageFeeOverride);
  const prevStr = xlPreviousMonthStr(monthStr);
  const prevRange = monthRangeFromInput(prevStr);

  const [prevPaySnap, depSnap, readSnap] = await Promise.all([
    db.collection("payments")
      .where("status", "==", "verified")
      .where("submittedAt", ">=", prevRange.start)
      .where("submittedAt", "<", prevRange.end)
      .get(),
    db.collection("deposits").where("landlordId", "==", landlordId).get(),
    db.collection("meterReadings")
      .where("landlordId", "==", landlordId)
      .where("month", "in", [monthStr, prevStr])
      .get()
  ]);

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

  function put(cell, value, opts = {}) {
    cell.value = value;
    cell.font = { ...FONT, bold: !!opts.bold, italic: !!opts.italic, color: opts.color, size: opts.size || FONT.size };
    if (opts.border !== false) cell.border = BORDER;
    if (opts.fill) cell.fill = opts.fill;
    if (opts.numFmt) cell.numFmt = opts.numFmt;
    cell.alignment = { vertical: "top", wrapText: !!opts.wrap, horizontal: opts.align };
  }

  ws.columns = XL_COL_WIDTHS.map((w) => ({ width: w }));

  // Title
  const monthName = data.monthLabel.split(" ")[0].toUpperCase();
  ws.mergeCells("A2:N2");
  put(ws.getCell("A2"), `${data.landlordName}${data.propertyName ? " | " + data.propertyName : ""} | ${data.monthLabel.toUpperCase()} REPORT`,
    { bold: true, size: 13, border: false, align: "center" });

  // Header rows (5 and 6)
  XL_HEADERS.forEach((h, i) => {
    put(ws.getCell(5, i + 1), i === 7 ? monthName : h, { bold: true, fill: HEADER_FILL, align: "center", wrap: true });
  });
  for (let c = 1; c <= 14; c++) put(ws.getCell(6, c), c === 8 ? "RENT" : null, { bold: true, fill: HEADER_FILL, align: "center" });

  // Data rows
  const first = XL_FIRST_DATA_ROW;
  const last = first + data.rows.length - 1;
  const T = last + 1; // totals row

  // Excel recalculates formulas when the file is opened, but phone previews and
  // some viewers only show the saved result, so we store the result as well.
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
      { numFmt: XL_MONEY_BLANK_ZERO, color: { argb: "FFB42323" }, bold: true });
    put(ws.getCell(n, 12), r.prevReading);
    put(ws.getCell(n, 13), r.curReading);
    put(ws.getCell(n, 14), { formula: `IF(AND(ISNUMBER(L${n}),ISNUMBER(M${n})),M${n}-L${n},"")`, result: used });
  });

  // Totals row (real formulas)
  for (let c = 1; c <= 14; c++) put(ws.getCell(T, c), null, { bold: true, fill: HEADER_FILL });
  ws.getCell(T, 1).value = "TOTAL";
  [[3, "C"], [7, "G"], [8, "H"], [10, "J"], [11, "K"], [14, "N"]].forEach(([c, L]) => {
    const cell = ws.getCell(T, c);
    cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result: sums[L] };
    cell.numFmt = XL_MONEY_FMT;
  });

  // Summary block (labels merged A:C, values in D)
  let s = T + 2;
  const row = {};
  function summary(key, label, value, opts = {}) {
    ws.mergeCells(s, 1, s, 3);
    put(ws.getCell(s, 1), label, { bold: true });
    // Merged cells: style only, never assign a value (that would overwrite the label).
    ws.getCell(s, 2).border = BORDER; ws.getCell(s, 3).border = BORDER;
    put(ws.getCell(s, 4), value, { numFmt: opts.numFmt || XL_MONEY_FMT, bold: !!opts.bold, color: opts.input ? INPUT_BLUE : undefined });
    row[key] = s;
    s++;
  }
  const commissionAmt = Math.round(sums.H * data.commissionRate);
  summary("collected", "TOTAL RENT COLLECTED", { formula: `H${T}`, result: sums.H });
  summary("garbage", "GARBAGE", data.garbageFee, { input: true });
  summary("deposits", "TOTAL DEPOSIT COLLECTED", { formula: `J${T}`, result: sums.J });
  summary("commissionable", "AMOUNT COMMISSIONABLE", { formula: `H${T}`, result: sums.H });
  summary("rate", "COMMISSION RATE", data.commissionRate, { numFmt: "0.0%", input: true });
  summary("commission", "SANEFI COMMISSION", { formula: `ROUND(D${row.commissionable}*D${row.rate},0)`, result: commissionAmt });
  summary("cleaning", "CLEANING", data.cleaningFee, { input: true });
  summary("due", "AMOUNT DUE TO AGENT", { formula: `D${row.commission}+D${row.cleaning}`, result: commissionAmt + data.cleaningFee }, { bold: true });

  // Key + notes
  s++;
  ws.mergeCells(s, 1, s, 14);
  put(ws.getCell(s, 1), "KEY: H-HOUSE | W-WATER | LL-LANDLORD | NP-NOT PAID | V-VACANT",
    { bold: true, color: { argb: "FFB42323" }, border: false });
  s += 2;
  const notes = [
    "NOTES",
    "Blue numbers are typed-in values (garbage fee, commission rate, cleaning fee). Everything else is calculated or pulled from the system.",
    "PREV ARR = last month's unpaid rent (payable rent minus verified payments last month). Older arrears are not carried forward.",
    "ARREARS = PREV ARR + PAYABLE RENT - amount paid this month (never below 0). Vacant units are left blank.",
    "Units used = CURRENT READING - PRV H2O READING. Readings are entered in Reports > Water Readings.",
    "TOTAL PAYABLE RENT includes vacant units, as in the manual sheet."
  ];
  notes.forEach((t, i) => {
    ws.mergeCells(s, 1, s, 14);
    put(ws.getCell(s, 1), t, { bold: i === 0, italic: i > 0, border: false });
    s++;
  });

  // Second sheet: deposit refunds + recommendations
  const ws2 = wb.addWorksheet("Refunds & Recommendations");
  ws2.columns = [{ width: 32 }, { width: 12 }, { width: 20 }, { width: 14 }, { width: 20 }];
  ["TENANT NAME", "UNIT", "TOTAL DEPOSIT PAID", "DEDUCTIONS", "AMOUNT REFUNDABLE"].forEach((h, i) => {
    put(ws2.getCell(1, i + 1), h, { bold: true, fill: HEADER_FILL, align: "center", wrap: true });
  });
  if (data.depositsRefunded.length === 0) {
    ws2.mergeCells(2, 1, 2, 5);
    put(ws2.getCell(2, 1), "No deposit refunds processed this month.");
  } else {
    data.depositsRefunded.forEach((d, i) => {
      const n = 2 + i;
      put(ws2.getCell(n, 1), d.tenantName);
      put(ws2.getCell(n, 2), d.unitLabel);
      put(ws2.getCell(n, 3), d.totalDeposit, { numFmt: XL_MONEY_FMT });
      put(ws2.getCell(n, 4), d.deductions, { numFmt: XL_MONEY_FMT });
      put(ws2.getCell(n, 5), { formula: `C${n}-D${n}`, result: d.totalDeposit - d.deductions }, { numFmt: XL_MONEY_FMT });
    });
  }
  const rr = 2 + Math.max(data.depositsRefunded.length, 1) + 1;
  put(ws2.getCell(rr, 1), "RECOMMENDATIONS", { bold: true, border: false });
  ws2.mergeCells(rr + 1, 1, rr + 4, 5);
  put(ws2.getCell(rr + 1, 1), recommendations || "—", { wrap: true, border: false });

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

// Lets the same file be unit-tested in Node (no browser needed).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildPropertyWorkbook, xlPreviousMonthStr, xlFormatDateCode };
}
