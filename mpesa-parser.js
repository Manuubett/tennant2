(function () {
// ---------------------------------------------------------------------
// mpesa-parser.js  (v2: provider registry)
//
// Parses pasted payment confirmation messages from several senders
// (classic M-Pesa SMS, Nawiri gateway, Equity Bank, Co-op Bank, ...)
// into ONE common shape, and checks the recipient against a landlord's
// registered payment profile.
//
// How it works:
//   1. Each message format is a small entry in PROVIDERS with
//        detect(text) -> cheap fingerprint test
//        parse(text)  -> { fields... } using that format's own regexes
//   2. parsePayment() normalizes whitespace, picks the first provider
//      whose detect() matches, and normalizes the result.
//   3. If nothing matches (or a provider matched but missed the amount
//      or the M-Pesa ref), a generic fallback extracts what it can and
//      sets needsReview = true.
//   4. If even that fails, the result has success:false and
//      unparsed:true so the caller can store the text in an
//      "unparsed messages" queue and you can add a new provider later.
//
// To support a new format: add one object to PROVIDERS (or call
// registerProvider). No other code changes.
//
// IMPORTANT: SMS text can be forged. Parsing only speeds up data
// entry; every result should still go to a pending/review queue.
// Dedupe on `mpesaRef`, it is present in every format.
//
// Common output shape:
//   success, provider, method ("paybill"|"till"|"phone"|"bank"|null),
//   perspective ("payer"|"receiver"), mpesaRef, amount, payerName,
//   recipientName, recipientPhone, accountRef, paidAt (ISO, +03:00),
//   paidAtRaw, dateInferred, needsReview, warnings[], rawMessage
//   (+ transactionCode, an alias of mpesaRef, for old callers)
// ---------------------------------------------------------------------

// ---------- helpers ----------

const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));

function normalizePhone(raw) {
  let digits = (raw || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  return digits;
}

// Day-first dates (10-10-2026, 10/10/26) and 24h or 12h times.
// Returns an ISO string in East Africa Time (+03:00), or null if invalid.
function toIso(dateStr, timeStr) {
  const d = (dateStr || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  const t = (timeStr || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!d || !t) return null;

  const day = +d[1];
  const month = +d[2];
  let year = +d[3];
  if (year < 100) year += 2000;

  let hour = +t[1];
  const min = +t[2];
  const sec = +(t[3] || 0);
  const ampm = t[4] && t[4].toUpperCase();
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || min > 59 || sec > 59) return null;

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const p = (n) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(min)}:${p(sec)}+03:00`;
}

// Finds "<date> at <time>" anywhere in the text.
function extractDate(text) {
  const m = text.match(
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)/i
  );
  if (!m) return {};
  return { paidAt: toIso(m[1], m[2]), paidAtRaw: `${m[1]} ${m[2]}` };
}

// ---------- provider registry ----------

const PROVIDERS = [
  // Nawiri gateway:
  // "MPESA payment accepted. Cust Ref: 2547... Amt KES: 5100 Trans ID: ...
  //  MPESA Ref: UJ71Y9GJ7K Recipient: 254720978519-NELSON MUNENE MUGOH"
  {
    name: "nawiri",
    detect: (t) => /Nawiri/i.test(t) && /MPESA payment accepted/i.test(t),
    parse: (t) => ({
      method: "phone",
      perspective: "payer",
      amount: num(t.match(/Amt\s*KES:?\s*([\d,]+(?:\.\d+)?)/i)?.[1]),
      accountRef: t.match(/Cust Ref:?\s*(\S+)/i)?.[1],
      mpesaRef: t.match(/MPESA Ref:?\s*([A-Z0-9]{10})\b/i)?.[1],
      recipientPhone: t.match(/Recipient:?\s*(\d{9,13})\s*-/i)?.[1],
      recipientName: t.match(/Recipient:?\s*\d+\s*-\s*(.+)$/i)?.[1],
      ...extractDate(t), // Nawiri has no date, finalize() will infer one
    }),
  },

  // Equity Bank (payer-side):
  // "Dear NAME, Your transaction of KES. 6,170.00 has successfully been
  //  deposited to Equity Account in favor of ORG Ref. Number UJ... on
  //  10-10-2026 at 23:46. Thank you."
  {
    name: "equity",
    detect: (t) => /deposited to Equity Account/i.test(t),
    parse: (t) => ({
      method: "bank",
      perspective: "payer",
      payerName: t.match(/Dear\s+(.+?),/i)?.[1],
      amount: num(t.match(/KES\.?\s*([\d,]+(?:\.\d+)?)/i)?.[1]),
      recipientName: t.match(/in favou?r of\s+(.+?)\s+Ref\.?\s*Number/i)?.[1],
      mpesaRef: t.match(/Ref\.?\s*Number\s+([A-Z0-9]{10})\b/i)?.[1],
      ...extractDate(t),
    }),
  },

  // Co-operative Bank (receiver-side, arrives on the landlord's phone):
  // "Dear NAME, you have received Ksh. 8200.0 from PAYER for 40001556 on
  //  10/10/2026 at 12:12:30. MPESA Ref. UJ..."
  {
    name: "cooperative",
    detect: (t) => /you have received Ksh/i.test(t) && /MPESA Ref/i.test(t),
    parse: (t) => ({
      method: "bank",
      perspective: "receiver",
      recipientName: t.match(/Dear\s+(.+?),/i)?.[1],
      amount: num(t.match(/Ksh\.?\s*([\d,]+(?:\.\d+)?)/i)?.[1]),
      payerName: t.match(/from\s+(.+?)\s+for\s+\S+\s+on/i)?.[1],
      accountRef: t.match(/from\s+.+?\s+for\s+(\S+)\s+on/i)?.[1],
      mpesaRef: t.match(/MPESA Ref\.?\s*([A-Z0-9]{10})\b/i)?.[1],
      ...extractDate(t),
    }),
  },

  // Classic M-Pesa SMS (your original three shapes).
  // "UJ12ABC3DE Confirmed. Ksh1,500.00 sent to ..." / "paid to ..."
  {
    name: "mpesa",
    detect: (t) => /^[A-Z0-9]{10}\s+Confirmed/i.test(t),
    parse: (t) => {
      const base = {
        perspective: "payer",
        mpesaRef: t.match(/^([A-Z0-9]{10})\s+Confirmed/i)?.[1],
        amount: num(t.match(/Ksh\.?\s?([\d,]+(?:\.\d{1,2})?)/i)?.[1]),
        ...extractDate(t),
      };

      // Paybill: "sent to BUSINESS for account ACC on ..."
      let m = t.match(/sent to\s+(.+?)\s+for account\s+(\S+)\s+on/i);
      if (m) {
        return { ...base, method: "paybill", recipientName: m[1], accountRef: m[2] };
      }

      // Send Money: "sent to NAME 07XXXXXXXX on ..."
      m = t.match(/sent to\s+(.+?)\s+(0\d{9}|\+?254\d{9})\s+on/i);
      if (m) {
        return { ...base, method: "phone", recipientName: m[1], recipientPhone: m[2] };
      }

      // Till / Buy Goods: "paid to MERCHANT. on ..."
      m = t.match(/paid to\s+(.+?)\.?\s+on/i);
      if (m) {
        return { ...base, method: "till", recipientName: m[1] };
      }

      return base; // method stays null, goes to review
    },
  },
];

// Lets you add a new format without touching this file's internals.
// Put specific providers before broad ones (default: front of the list).
function registerProvider(provider, { atEnd = false } = {}) {
  if (atEnd) PROVIDERS.push(provider);
  else PROVIDERS.unshift(provider);
}

// ---------- normalization ----------

function finalize(base, rawText, opts = {}) {
  const out = {
    success: false,
    provider: "unknown",
    method: null,
    perspective: "payer",
    mpesaRef: null,
    amount: null,
    payerName: null,
    recipientName: null,
    recipientPhone: null,
    accountRef: null,
    paidAt: null,
    paidAtRaw: null,
    dateInferred: false,
    needsReview: false,
    warnings: [],
    rawMessage: rawText,
  };

  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }

  if (out.mpesaRef) out.mpesaRef = out.mpesaRef.toUpperCase();
  if (out.recipientPhone) out.recipientPhone = normalizePhone(out.recipientPhone);
  if (out.recipientName) out.recipientName = out.recipientName.replace(/[\s.]+$/, "");
  if (out.payerName) out.payerName = out.payerName.replace(/[\s.]+$/, "");

  const missing = [];
  if (!out.mpesaRef) missing.push("M-Pesa reference");
  if (!(typeof out.amount === "number" && out.amount > 0)) missing.push("amount");
  if (missing.length) {
    out.error = `Could not find: ${missing.join(", ")}.`;
    return out; // success stays false
  }

  if (!out.paidAt) {
    out.paidAt = (opts.now ? new Date(opts.now) : new Date()).toISOString();
    out.dateInferred = true;
    out.needsReview = true;
    out.warnings.push("No valid date in message; used the time it was submitted.");
  }
  if (!out.method) {
    out.needsReview = true;
    out.warnings.push("Could not tell how the payment was made (paybill, till, phone or bank).");
  }
  if (!out.recipientName && !out.recipientPhone) {
    out.needsReview = true;
    out.warnings.push("No recipient found in message.");
  }

  out.transactionCode = out.mpesaRef; // alias for old callers
  out.success = true;
  return out;
}

// Last resort: pull out whatever we can find. Always needs review.
function genericFallback(text, opts = {}) {
  const ref = text.match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/)?.[0];
  const amount = num(text.match(/(?:KES|Ksh)\.?:?\s*([\d,]+(?:\.\d+)?)/i)?.[1]);

  const r = finalize(
    { provider: "unknown", mpesaRef: ref, amount, ...extractDate(text) },
    text,
    opts
  );
  r.needsReview = true;
  if (r.success) {
    r.warnings.unshift("Unrecognized message format; only basic fields were extracted.");
  } else {
    r.unparsed = true; // caller: store in "unparsed messages" queue
    r.error =
      "Couldn't recognize this message. It has been saved for review. " +
      "Please paste the full text exactly as received.";
  }
  return r;
}

// ---------- public API ----------

function parsePayment(rawMessage, opts = {}) {
  const text = (rawMessage || "").replace(/\s+/g, " ").trim();
  if (!text) return { success: false, error: "Message is empty.", unparsed: true };

  for (const provider of PROVIDERS) {
    if (!provider.detect(text)) continue;

    let fields = null;
    try {
      fields = provider.parse(text);
    } catch (e) {
      fields = null;
    }

    const result = fields ? finalize({ provider: provider.name, ...fields }, text, opts) : null;
    if (result && result.success) return result;

    // Provider matched but missed a required field: fall back, keep a note.
    const fb = genericFallback(text, opts);
    fb.warnings = fb.warnings || [];
    fb.warnings.unshift(`Looked like a ${provider.name} message but some fields were missing.`);
    return fb;
  }

  return genericFallback(text, opts);
}

// ---------- recipient matching ----------

function fuzzyNameMatch(a, b) {
  if (!a || !b) return false;
  const tokens = (s) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;

  // Order-independent: every word of the shorter name appears in the
  // longer one. Require 2+ words so "Peter" doesn't match every Peter.
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.length >= 2 && small.every((w) => big.includes(w));
}

// Cross-checks a parsed payment against a landlord's registered profile.
// Landlord fields used:
//   paymentMethod: "paybill" | "till" | "phone" | "bank"
//   name, businessName, registeredName, bankAccountName
//   accountHint (paybill), phoneNumber (phone)
// Returns true if it looks legitimate, false if it should be flagged.
function checkRecipientMatch(parsed, landlord) {
  if (!parsed || !parsed.success || !landlord) return false;

  const names = [
    landlord.name,
    landlord.businessName,
    landlord.registeredName,
    landlord.bankAccountName,
  ].filter(Boolean);
  const nameMatches = (n) => names.some((x) => fuzzyNameMatch(n, x));

  // Receiver-side messages (e.g. Co-op "you have received...") are
  // addressed to the account holder, so compare that name to the landlord.
  if (parsed.perspective === "receiver") {
    return nameMatches(parsed.recipientName);
  }

  switch (parsed.method) {
    case "paybill": {
      if (landlord.paymentMethod !== "paybill") return false;
      const accountMatches = !landlord.accountHint || parsed.accountRef === landlord.accountHint;
      return nameMatches(parsed.recipientName) && accountMatches;
    }
    case "till":
      return landlord.paymentMethod === "till" && nameMatches(parsed.recipientName);

    case "phone": {
      if (landlord.paymentMethod !== "phone") return false;
      const phoneMatches =
        !!landlord.phoneNumber &&
        normalizePhone(landlord.phoneNumber) === parsed.recipientPhone;
      return phoneMatches || nameMatches(parsed.recipientName);
    }
    case "bank":
      return landlord.paymentMethod === "bank" && nameMatches(parsed.recipientName);

    default:
      return false;
  }
}

const api = {
  parsePayment,
  parseMpesaMessage: parsePayment, // old name kept so existing callers keep working
  checkRecipientMatch,
  registerProvider,
  normalizePhone,
  fuzzyNameMatch,
  PROVIDERS,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
// In the browser, expose only the public functions as globals. Everything
// else stays private so it can't clash with other scripts on the page.
if (typeof window !== "undefined") Object.assign(window, api);
})();
