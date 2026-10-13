// ---------------------------------------------------------------------
// SIDEBAR (mobile off-canvas drawer + real section switching)
// ---------------------------------------------------------------------
(function setupSidebar() {
  const sidebarEl = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const menuBtn = document.getElementById("menu-btn");
  const closeBtn = document.getElementById("sidebar-close");
  if (!sidebarEl) return;

  function openSidebar() {
    sidebarEl.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
  }
  function closeSidebar() {
    sidebarEl.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  }

  if (menuBtn) menuBtn.addEventListener("click", openSidebar);
  if (closeBtn) closeBtn.addEventListener("click", closeSidebar);
  if (backdrop) backdrop.addEventListener("click", closeSidebar);

  const navLinks = Array.from(document.querySelectorAll("#tabs [data-nav-link]"));
  const sections = Array.from(document.querySelectorAll(".portal-section"));

  // Single source of truth: shows exactly one section and keeps the
  // sidebar highlight in sync with it. Replaces the old scroll-spy
  // (IntersectionObserver) approach, which just scrolled to an anchor
  // while every section stayed visible on one long page.
  function activateSection(id) {
    sections.forEach((s) => s.classList.toggle("active", s.id === id));
    navLinks.forEach((l) => l.classList.toggle("active", l.getAttribute("href") === `#${id}`));
    const main = document.querySelector(".main-wrap");
    if (main) main.scrollTo({ top: 0, behavior: "auto" });
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const id = link.getAttribute("href").slice(1);
      activateSection(id);
      closeSidebar();
    });
  });

  // Quick-action buttons (e.g. on the Overview tab) jump to a section the
  // same way sidebar links do — just add data-goto-section="some-id".
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-goto-section]");
    if (!trigger) return;
    activateSection(trigger.dataset.gotoSection);
  });

  // Land on whichever section is marked active in the HTML (Overview by
  // default), falling back to the first section if none is marked.
  const initial = sections.find((s) => s.classList.contains("active")) || sections[0];
  if (initial) activateSection(initial.id);
})();

const header = document.getElementById("tenant-header");
const pendingNotice = document.getElementById("pending-notice");
const paymentForm = document.getElementById("payment-form");
const submitBtn = document.getElementById("submit-payment-btn");
const errorBox = document.getElementById("payment-error");
const successBox = document.getElementById("payment-success");
const historyCard = document.getElementById("history-card");
const rentStatusCard = document.getElementById("rent-status-card");
const leaseDepositCard = document.getElementById("lease-deposit-card");
const maintenanceList = document.getElementById("maintenance-list");
const maintenanceForm = document.getElementById("maintenance-form");
const maintenanceSubmitBtn = document.getElementById("submit-maintenance-btn");
const maintenanceError = document.getElementById("maintenance-error");
const maintenanceSuccess = document.getElementById("maintenance-success");

let tenantProfile = null;
let landlordProfile = null;
let unitProfile = null;

// Tracks which maintenance request threads are currently expanded so they
// stay open across re-renders of the list (e.g. when a status changes).
const expandedThreads = new Set();

document.getElementById("logout-btn").addEventListener("click", () => auth.signOut().then(() => window.location.href = "login.html"));

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function pillFor(status) {
  const map = { pending: "Pending Review", verified: "Verified", rejected: "Rejected" };
  return `<span class="pill pill-${status}">${map[status] || status}</span>`;
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

// ---------------------------------------------------------------------
// RENT STATUS SUMMARY
// ---------------------------------------------------------------------
async function renderRentStatus(uid) {
  if (!unitProfile) {
    rentStatusCard.innerHTML = "";
    return;
  }

  const dueDay = Number(tenantProfile.rentDueDay) || 5;
  const now = new Date();
  const { start, end } = currentMonthRange();

  if (tenantProfile.leaseStartDate) {
    const leaseStart = new Date(tenantProfile.leaseStartDate);
    if (!isNaN(leaseStart) && leaseStart > now) {
      rentStatusCard.innerHTML = `
        <div class="card rent-status-card">
          <div class="card-title">Lease Starts ${leaseStart.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}</div>
          <div class="card-sub">Nothing is due yet.</div>
        </div>`;
      return;
    }
  }

  const paidSnap = await db.collection("payments")
    .where("tenantId", "==", uid)
    .where("status", "==", "verified")
    .where("submittedAt", ">=", start)
    .where("submittedAt", "<", end)
    .get();

  const paidThisMonth = !paidSnap.empty;
  const rentAmount = Number(unitProfile.rentAmount || 0);

  let dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  let statusClass = "is-paid";
  let statusLine = "";

  if (paidThisMonth) {
    dueDate = new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
    statusClass = "is-paid";
    statusLine = `<span class="pill pill-verified">Paid for this month</span>`;
  } else if (now > dueDate) {
    statusClass = "is-overdue";
    statusLine = `<span class="pill pill-rejected">Overdue</span>`;
  } else {
    statusClass = "is-due";
    statusLine = `<span class="pill pill-pending">Due Soon</span>`;
  }

  rentStatusCard.innerHTML = `
    <div class="card rent-status-card ${statusClass}">
      <div class="card-sub">${paidThisMonth ? "Next Payment Due" : "Amount Due"}</div>
      <div class="rent-status-amount">KSh ${rentAmount.toLocaleString()}</div>
      <div class="rent-status-due">Due ${dueDate.toLocaleDateString("en-KE", { day: "numeric", month: "long" })}</div>
      <div style="margin-top:10px;">${statusLine}</div>
    </div>`;
}

// ---------------------------------------------------------------------
// LEASE & DEPOSIT INFO
// ---------------------------------------------------------------------
async function renderLeaseDeposit() {
  if (!unitProfile) {
    leaseDepositCard.innerHTML = "";
    return;
  }

  let depositHTML = `<div class="card-sub">No deposit on record yet.</div>`;
  if (tenantProfile.unitId) {
    const depositSnap = await db.collection("deposits")
      .where("unitId", "==", tenantProfile.unitId)
      .orderBy("paidAt", "desc")
      .limit(1)
      .get();
    if (!depositSnap.empty) {
      const d = depositSnap.docs[0].data();
      const refunded = d.status === "refunded";
      depositHTML = `
        <div class="card-sub">Deposit Paid: KSh ${Number(d.amountPaid || 0).toLocaleString()} on ${d.paidAt || ""}</div>
        <div style="margin-top:6px;"><span class="pill ${refunded ? "pill-verified" : "pill-pending"}">${refunded ? "Refunded" : "Held"}</span></div>
        ${refunded ? `<div class="card-sub" style="margin-top:6px;">Refunded Amount: KSh ${Number(d.amountRefundable || 0).toLocaleString()}</div>` : ""}`;
    }
  }

  const leaseStartLine = tenantProfile.leaseStartDate
    ? new Date(tenantProfile.leaseStartDate).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })
    : "Not on record";

  leaseDepositCard.innerHTML = `
    <div class="card">
      <div class="card-title">Lease & Deposit</div>
      <div class="card-sub">Unit: ${escapeHTML(unitProfile.houseNumber || "")} ${unitProfile.propertyName ? "&middot; " + escapeHTML(unitProfile.propertyName) : ""}</div>
      <div class="card-sub">Monthly Rent: KSh ${Number(unitProfile.rentAmount || 0).toLocaleString()}</div>
      <div class="card-sub">Lease Start: ${leaseStartLine}</div>
      <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">${depositHTML}</div>
    </div>`;
}

// ---------------------------------------------------------------------
// PAYMENT HISTORY + RECEIPTS
// ---------------------------------------------------------------------
function openReceipt(payment) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow pop-ups to view the receipt.");
    return;
  }
  const paidOn = payment.submittedAt && payment.submittedAt.toDate
    ? payment.submittedAt.toDate().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })
    : (payment.paidAtRaw || "");

  win.document.write(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>Receipt</title>
    <link rel="stylesheet" href="app-style.css"></head>
    <body>
      <div class="receipt-page">
        <div class="receipt-card">
          <div class="receipt-brand">Sanefi Rent</div>
          <div class="receipt-sub">Official Payment Receipt</div>
          <div class="receipt-row"><span class="label">Tenant</span><span class="value">${escapeHTML(tenantProfile.name || "")}</span></div>
          <div class="receipt-row"><span class="label">Unit</span><span class="value">${escapeHTML(unitProfile ? unitProfile.houseNumber : "")}</span></div>
          <div class="receipt-row"><span class="label">Landlord</span><span class="value">${escapeHTML(landlordProfile ? landlordProfile.name : "")}</span></div>
          <div class="receipt-row"><span class="label">Transaction Code</span><span class="value">${escapeHTML(payment.transactionCode || "Manual")}</span></div>
          <div class="receipt-row"><span class="label">Date Paid</span><span class="value">${escapeHTML(paidOn)}</span></div>
          <div class="receipt-row"><span class="label">Status</span><span class="value">Verified</span></div>
          <div class="receipt-total"><span>Amount</span><span>KSh ${Number(payment.amount || 0).toLocaleString()}</span></div>
          <button class="btn btn-primary receipt-print-btn" onclick="window.print()">Print / Save as PDF</button>
        </div>
      </div>
    </body></html>`);
  win.document.close();
}

function loadHistory(uid) {
  db.collection("payments")
    .where("tenantId", "==", uid)
    .orderBy("submittedAt", "desc")
    .onSnapshot((snapshot) => {
      renderRentStatus(uid);

      if (snapshot.empty) {
        historyCard.innerHTML = `<p class="empty-state">No payments submitted yet.</p>`;
        return;
      }
      historyCard.innerHTML = snapshot.docs.map((doc) => {
        const p = doc.data();
        const receiptBtn = p.status === "verified"
          ? `<button class="btn-link" data-receipt-id="${doc.id}" style="margin-top:6px;">Download Receipt</button>`
          : "";
        // Rejected payments show the office's reason. Payments rejected
        // before reasons existed have none, so fall back to a nudge to ask.
        const rejectionHTML = p.status === "rejected"
          ? `<div style="margin-top:8px; padding:8px 10px; border-left:3px solid #b42323; background:rgba(180,35,35,.08); border-radius:6px; font-size:13px; line-height:1.4;">
               <strong style="color:#b42323;">Why it was rejected</strong><br>
               ${escapeHTML(p.rejectionReason || "The office didn't leave a reason. Please contact them for details.")}
             </div>`
          : "";
        return `
          <div class="payment-row">
            <div>
              <div class="amount">KSh ${Number(p.amount || 0).toLocaleString()}</div>
              <div class="meta">${p.paidAtRaw || ""} &middot; ${p.transactionCode || ""}</div>
              ${receiptBtn}
              ${rejectionHTML}
            </div>
            ${pillFor(p.status)}
          </div>`;
      }).join("");

      historyCard.querySelectorAll("[data-receipt-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const doc = snapshot.docs.find((d) => d.id === btn.dataset.receiptId);
          if (doc) openReceipt(doc.data());
        });
      });
    }, (err) => {
      console.error(err);
      historyCard.innerHTML = `<p class="empty-state">Couldn't load payment history.</p>`;
    });
}

paymentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.style.display = "none";
  successBox.style.display = "none";

  const rawMessage = new FormData(paymentForm).get("message");
  const parsed = parsePayment(rawMessage);

  if (!parsed.success) {
    errorBox.textContent = parsed.error;
    errorBox.style.display = "block";
    // Keep messages we couldn't read so a new format can be added to the
    // parser later. Best effort only: never block the tenant on this.
    if (parsed.unparsed && String(rawMessage || "").trim() && auth.currentUser) {
      db.collection("unparsedMessages").add({
        rawMessage: String(rawMessage).trim(),
        tenantId: auth.currentUser.uid,
        unitId: tenantProfile ? tenantProfile.unitId || null : null,
        landlordId: tenantProfile ? tenantProfile.landlordId || null : null,
        source: "tenant_submit",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    // Tenants can't search every payment (that would expose other
    // tenants' data), so duplicates are caught with a small paymentCodes
    // marker per M-Pesa code instead.
    const codeRef = db.collection("paymentCodes").doc(String(parsed.mpesaRef).replace(/\//g, "_"));
    const dupe = await codeRef.get();
    if (dupe.exists) {
      errorBox.textContent = "This payment has already been submitted.";
      errorBox.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Payment";
      return;
    }

    // "You have received..." messages are what the landlord's account
    // gets, not what a tenant is sent after paying. A tenant has no
    // legitimate reason to paste one, so it is never treated as a match.
    const recipientMatch = (landlordProfile && parsed.perspective !== "receiver")
      ? checkRecipientMatch(parsed, landlordProfile)
      : false;

    // Bug fix / feature: the new payment doc's own id wasn't captured
    // before, so the "payment_submitted" notification had no way to
    // reference which payment it was about. Capturing the ref here lets
    // reply.js (click-to-navigate) send staff straight to this tenant.
    const paymentRef = db.collection("payments").doc();
    const submitBatch = db.batch();
    // Creating the marker and the payment together means a failed
    // submission never leaves a code "used" without a payment behind it.
    submitBatch.set(codeRef, {
      tenantId: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    submitBatch.set(paymentRef, {
      tenantId: auth.currentUser.uid,
      unitId: tenantProfile.unitId,
      landlordId: tenantProfile.landlordId,
      rawMessage: parsed.rawMessage,
      method: parsed.method,
      // transactionCode keeps holding the M-Pesa ref so existing
      // reports, search and duplicate checks keep working.
      transactionCode: parsed.mpesaRef,
      amount: parsed.amount,
      paidAtRaw: parsed.paidAtRaw || null,
      paidAt: parsed.paidAt ? firebase.firestore.Timestamp.fromDate(new Date(parsed.paidAt)) : null,
      dateInferred: !!parsed.dateInferred,
      provider: parsed.provider || null,
      perspective: parsed.perspective || null,
      payerName: parsed.payerName || null,
      accountRef: parsed.accountRef || null,
      recipientName: parsed.recipientName || null,
      recipientPhone: parsed.recipientPhone || null,
      needsReview: !!parsed.needsReview || parsed.perspective === "receiver",
      warnings: parsed.warnings || [],
      recipientMatch,
      status: "pending",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await submitBatch.commit();

    addNotification("staff", "payment_submitted", `${tenantProfile.name} submitted a payment of KSh ${Number(parsed.amount || 0).toLocaleString()}.`, { tenantId: auth.currentUser.uid, paymentId: paymentRef.id });

    successBox.textContent = "Payment submitted! It will show as verified once the office confirms it.";
    successBox.style.display = "block";
    paymentForm.reset();
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't submit: " + err.message;
    errorBox.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Payment";
  }
});

// ---------------------------------------------------------------------
// MAINTENANCE REQUESTS
// ---------------------------------------------------------------------
// Status lifecycle: open -> in_progress -> resolved -> closed
// "resolved" is a staff claim, not a fact — the tenant gets the final
// word. From "resolved" they either confirm (-> closed, done) or say
// it's still broken (-> back to open).
//
// Every request also has a maintenanceRequests/{id}/comments subcollection
// for the ongoing back-and-forth, so nothing gets silently overwritten
// the way the old single staffNote/tenantNote fields used to.
function maintenancePillFor(status) {
  const map = { open: "pill-pending", in_progress: "pill-pending", resolved: "pill-awaiting", closed: "pill-verified" };
  const label = { open: "Open", in_progress: "In Progress", resolved: "Awaiting Your Confirmation", closed: "Closed" };
  return `<span class="pill ${map[status] || "pill-pending"}">${label[status] || status}</span>`;
}

function commentBubbleHTML(c) {
  const isStaff = c.author === "staff";
  const when = c.createdAt && c.createdAt.toDate
    ? c.createdAt.toDate().toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return `
    <div class="comment-bubble ${isStaff ? "comment-staff" : "comment-tenant"}">
      <div class="comment-author">${escapeHTML(c.authorName || (isStaff ? "Office" : "You"))}</div>
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
      <textarea id="comment-input-${id}" placeholder="Write a message to the office..."></textarea>
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
      author: "tenant",
      authorName: tenantProfile.name,
      message,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    addNotification("staff", "maintenance_comment", `${tenantProfile.name} sent a message about their maintenance request.`, { tenantId: auth.currentUser.uid, maintenanceRequestId: id });
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

function maintenanceCardHTML(doc) {
  const m = doc.data();
  const when = m.submittedAt && m.submittedAt.toDate ? m.submittedAt.toDate().toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "";

  const confirmBlockHTML = m.status === "resolved" ? `
    <div class="maintenance-confirm">
      <div class="card-sub"><strong>The office marked this as resolved.</strong> Is it fixed?</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-primary" data-mtn-confirm-fixed="${doc.id}">Yes, it's fixed</button>
        <button class="btn btn-outline" data-mtn-reopen-toggle="${doc.id}">Still broken</button>
      </div>
      <div class="maintenance-reopen-form" id="reopen-form-${doc.id}" style="display:none;">
        <div class="field">
          <label>What's still wrong? (optional)</label>
          <textarea id="reopen-note-${doc.id}" placeholder="e.g. still leaking, just slower now"></textarea>
        </div>
        <button class="btn btn-outline" data-mtn-reopen-submit="${doc.id}">Send Back to Office</button>
      </div>
    </div>` : "";

  // Bug fix: the office note used to stay visible forever, even after the
  // tenant reopened the request and the note no longer reflected reality.
  // It now only shows while the request is genuinely in "resolved" state.
  const staffNoteHTML = (m.staffNote && m.status === "resolved")
    ? `<div class="card-sub" style="margin-top:6px;"><strong>Office note:</strong> ${escapeHTML(m.staffNote)}</div>`
    : "";

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <span class="chip">${escapeHTML(m.category || "Other")}</span>
          <div class="card-sub" style="margin-top:8px;">${escapeHTML(m.description || "")}</div>
          <div class="card-sub" style="margin-top:4px;">Reported ${when}</div>
          ${staffNoteHTML}
        </div>
        ${maintenancePillFor(m.status)}
      </div>
      ${confirmBlockHTML}
      <button class="comment-toggle" data-thread-toggle="${doc.id}">View Conversation</button>
      <div class="comment-panel" id="thread-${doc.id}" style="display:none;"></div>
    </div>`;
}

function loadMaintenance(uid) {
  db.collection("maintenanceRequests")
    .where("tenantId", "==", uid)
    .orderBy("submittedAt", "desc")
    .onSnapshot((snapshot) => {
      if (snapshot.empty) {
        maintenanceList.innerHTML = `<p class="empty-state">No maintenance requests yet.</p>`;
        return;
      }
      maintenanceList.innerHTML = snapshot.docs.map(maintenanceCardHTML).join("");

      maintenanceList.querySelectorAll("[data-mtn-confirm-fixed]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.mtnConfirmFixed;
          btn.disabled = true;
          try {
            await db.collection("maintenanceRequests").doc(id).update({
              status: "closed",
              closedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (err) {
            alert("Couldn't update: " + err.message);
            btn.disabled = false;
          }
        });
      });

      maintenanceList.querySelectorAll("[data-mtn-reopen-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.mtnReopenToggle;
          const form = document.getElementById(`reopen-form-${id}`);
          if (form) form.style.display = form.style.display === "none" ? "block" : "none";
        });
      });

      // Reopening now posts the tenant's note into the shared comment
      // thread (instead of a standalone field), so staff actually see it
      // and it doesn't go stale once the status changes again.
      maintenanceList.querySelectorAll("[data-mtn-reopen-submit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.mtnReopenSubmit;
          const noteField = document.getElementById(`reopen-note-${id}`);
          const note = noteField ? noteField.value.trim() : "";
          btn.disabled = true;
          try {
            const doc = snapshot.docs.find((d) => d.id === id);
            const m = doc ? doc.data() : {};

            await db.collection("maintenanceRequests").doc(id).update({
              status: "open",
              reopenedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            if (note) {
              await db.collection("maintenanceRequests").doc(id).collection("comments").add({
                author: "tenant",
                authorName: tenantProfile.name,
                message: note,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            }

            addNotification("staff", "maintenance_reopened", `${tenantProfile.name} says the ${(m.category || "").toLowerCase() || "reported"} issue isn't fixed${unitProfile ? " at " + unitProfile.houseNumber : ""}.`, { tenantId: auth.currentUser.uid, maintenanceRequestId: id });
            expandedThreads.add(id);
          } catch (err) {
            alert("Couldn't send: " + err.message);
            btn.disabled = false;
          }
        });
      });

      maintenanceList.querySelectorAll("[data-thread-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.threadToggle;
          if (expandedThreads.has(id)) closeThread(id); else openThread(id);
        });
      });

      // Re-expand any threads the tenant already had open before this
      // re-render (e.g. triggered by a status change elsewhere).
      expandedThreads.forEach((id) => {
        if (document.getElementById(`thread-${id}`)) openThread(id);
      });
    }, (err) => {
      console.error(err);
      maintenanceList.innerHTML = `<p class="empty-state">Couldn't load maintenance requests.</p>`;
    });
}

maintenanceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  maintenanceError.style.display = "none";
  maintenanceSuccess.style.display = "none";

  const data = new FormData(maintenanceForm);
  const category = data.get("category");
  const description = data.get("description");

  maintenanceSubmitBtn.disabled = true;
  maintenanceSubmitBtn.textContent = "Submitting...";

  try {
    // Bug fix / feature: the new request's own id wasn't captured
    // before, so the "maintenance_submitted" notification had no way to
    // reference which request it was about. Capturing the ref lets
    // reply.js send staff straight to this tenant's expanded thread.
    const reqRef = await db.collection("maintenanceRequests").add({
      tenantId: auth.currentUser.uid,
      unitId: tenantProfile.unitId,
      landlordId: tenantProfile.landlordId,
      category,
      description,
      status: "open",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    addNotification("staff", "maintenance_submitted", `${tenantProfile.name} reported a ${category.toLowerCase()} issue${unitProfile ? " at " + unitProfile.houseNumber : ""}.`, { tenantId: auth.currentUser.uid, maintenanceRequestId: reqRef.id });

    maintenanceSuccess.textContent = "Request submitted. The office will follow up.";
    maintenanceSuccess.style.display = "block";
    maintenanceForm.reset();
  } catch (err) {
    console.error(err);
    maintenanceError.textContent = "Couldn't submit: " + err.message;
    maintenanceError.style.display = "block";
  } finally {
    maintenanceSubmitBtn.disabled = false;
    maintenanceSubmitBtn.textContent = "Submit Request";
  }
});

// ---------------------------------------------------------------------
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const { role, profile } = await getCurrentUserRole(user);
  if (role !== "tenant") {
    window.location.href = role === "staff" ? "dashboard.html" : "login.html";
    return;
  }

  tenantProfile = profile;
  header.textContent = `Hi, ${profile.name.split(" ")[0]}`;

  if (profile.status === "pending") {
    pendingNotice.innerHTML = `<p class="alert alert-error">Your account is pending verification by the office. You can still submit payments, but let the office know you've registered.</p>`;
  }

  if (profile.landlordId) {
    db.collection("landlords").doc(profile.landlordId).get().then((doc) => {
      if (doc.exists) landlordProfile = doc.data();
    });
  }

  if (profile.unitId) {
    const unitDoc = await db.collection("units").doc(profile.unitId).get();
    if (unitDoc.exists) unitProfile = unitDoc.data();
  }

  renderLeaseDeposit();
  loadHistory(user.uid);
  loadMaintenance(user.uid);

  const notifBtn = document.getElementById("notif-btn");
  const notifPanel = document.getElementById("notif-panel");
  wireNotificationToggle(notifBtn, notifPanel);
  attachNotificationBell(notifBtn, notifPanel, user.uid);
});
