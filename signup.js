const form = document.getElementById("signup-form");
const errorBox = document.getElementById("signup-error");
const signupBtn = document.getElementById("signup-btn");
const landlordSearch = document.getElementById("landlord-search");
const landlordIdInput = document.getElementById("landlord-id-input");
const landlordResults = document.getElementById("landlord-results");
const unitSelect = document.getElementById("unit-select");

let allUnits = []; // { id, houseNumber, propertyName, landlordId, landlordName, occupancy, claimed }
let searchIndex = []; // combined, deduplicated list of things a tenant might search by

// Load landlords + units + tenants once up front, then build one
// combined search index covering BOTH landlord names and property names
// — a tenant might know either one, not necessarily both.
//
// Bug fix: the unit dropdown used to list every unit under a property
// regardless of whether it was already occupied, so two tenants could
// both select and register for the same unit. Units are now annotated
// with two signals so selectItem() can filter properly:
//   - occupancy: the units.occupancy field staff set/toggle directly,
//     or that approveTenant() (dashboard.js) sets to "occupied" once a
//     tenant is approved.
//   - claimed: whether ANY tenant doc (pending or active) already
//     points at this unit. This closes the gap where a tenant has
//     signed up and picked a unit, but staff haven't approved them yet
//     — occupancy is still "vacant" at that point, so relying on
//     occupancy alone would still let a second tenant claim the same
//     unit during the pending window.
//
// Security rules change: this page runs before the tenant has an
// account, so it can no longer read the tenants collection (that would
// expose every tenant's name, phone and email). "claimed" now comes from
// units.claimedBy, which signup sets on the unit when the account is made.
Promise.all([
  db.collection("landlords").orderBy("name").get(),
  db.collection("units").get()
]).then(([landlordSnap, unitSnap]) => {
  const landlordsById = {};
  landlordSnap.docs.forEach((doc) => { landlordsById[doc.id] = doc.data().name; });

  allUnits = unitSnap.docs.map((doc) => {
    const u = doc.data();
    return {
      id: doc.id,
      houseNumber: u.houseNumber,
      propertyName: u.propertyName || "",
      landlordId: u.landlordId,
      landlordName: landlordsById[u.landlordId] || "Unknown",
      occupancy: u.occupancy || "vacant",
      claimed: !!u.claimedBy
    };
  });

  // One entry per landlord (matches by landlord/owner name)...
  const items = landlordSnap.docs.map((doc) => ({
    type: "landlord",
    landlordId: doc.id,
    label: doc.data().name,
    sublabel: "Owner / Agent"
  }));

  // ...plus one entry per DISTINCT property name (matches by building
  // name), so a landlord who owns multiple named buildings shows each
  // one separately, and a tenant who only knows "Green View Apartments"
  // can still find it without knowing who owns it.
  const seenPropertyNames = new Set();
  allUnits.forEach((u) => {
    if (!u.propertyName) return;
    const key = u.landlordId + "::" + u.propertyName.toLowerCase();
    if (seenPropertyNames.has(key)) return;
    seenPropertyNames.add(key);
    items.push({
      type: "property",
      landlordId: u.landlordId,
      propertyName: u.propertyName,
      label: u.propertyName,
      sublabel: "Managed by " + u.landlordName
    });
  });

  searchIndex = items;
  landlordSearch.placeholder = items.length
    ? "Search by property name or landlord..."
    : "No properties available yet";
}).catch((err) => {
  console.error(err);
  landlordSearch.placeholder = "Couldn't load properties";
});

function renderResults(query) {
  const q = query.trim().toLowerCase();
  const matches = q
    ? searchIndex.filter((item) => item.label.toLowerCase().includes(q))
    : searchIndex;

  if (matches.length === 0) {
    landlordResults.innerHTML = `<div class="search-no-results">No matching property or landlord found. Ask the office for the exact name.</div>`;
  } else {
    landlordResults.innerHTML = matches
      .slice(0, 50) // cap rendered rows; the results panel itself scrolls
      .map((item, i) => `
        <div class="search-result-row" data-index="${searchIndex.indexOf(item)}">
          ${escapeHTML(item.label)}
          <div style="font-size:11.5px; color:var(--ink-soft);">${escapeHTML(item.sublabel)}</div>
        </div>`)
      .join("");
  }
  landlordResults.style.display = "block";

  landlordResults.querySelectorAll(".search-result-row").forEach((row) => {
    row.addEventListener("click", () => selectItem(searchIndex[Number(row.dataset.index)]));
  });
}

function selectItem(item) {
  landlordSearch.value = item.label;
  landlordIdInput.value = item.landlordId;
  landlordResults.style.display = "none";

  // If they picked a specific property, only show units under that
  // property name; if they picked a landlord, show all of that
  // landlord's units regardless of which building they're in.
  const matchingUnits = allUnits.filter((u) => {
    if (u.landlordId !== item.landlordId) return false;
    if (item.type === "property") return u.propertyName === item.propertyName;
    return true;
  });

  // Bug fix: only offer units that are actually free — excludes units
  // staff have marked "occupied" AND units already claimed by another
  // tenant's signup (pending or approved), even before staff have had a
  // chance to flip that unit's occupancy field. See the comment on the
  // Promise.all(...) load above for why both checks are needed.
  const availableUnits = matchingUnits.filter((u) => u.occupancy !== "occupied" && !u.claimed);

  if (matchingUnits.length === 0) {
    unitSelect.innerHTML = `<option value="">No units listed here yet</option>`;
    unitSelect.disabled = true;
    return;
  }

  if (availableUnits.length === 0) {
    unitSelect.innerHTML = `<option value="">All units here are already taken — contact the office</option>`;
    unitSelect.disabled = true;
    return;
  }

  unitSelect.innerHTML = `<option value="">Select your unit</option>` +
    availableUnits.map((u) => `<option value="${u.id}">${escapeHTML(u.houseNumber)}${u.propertyName ? " — " + escapeHTML(u.propertyName) : ""}</option>`).join("");
  unitSelect.disabled = false;
}

landlordSearch.addEventListener("focus", () => renderResults(landlordSearch.value));
landlordSearch.addEventListener("input", () => {
  // Typing again invalidates any previously confirmed selection until
  // they click a result again.
  landlordIdInput.value = "";
  unitSelect.disabled = true;
  unitSelect.innerHTML = `<option value="">Choose a property first</option>`;
  renderResults(landlordSearch.value);
});

// Close the results panel when clicking anywhere outside the search box
// and the results panel itself.
//
// Bug fix: this used to bail out early unless the click landed inside
// SOME .field element on the page (`if (!e.target.closest(".field"))
// return;`), so clicking the page background, the header, a submit
// button, or anything else outside a .field wrapper left the dropdown
// open indefinitely — it only ever closed if the click happened to land
// on a different form field by coincidence. The check now does exactly
// what the comment always said: close on any click that isn't on the
// search input or the results panel.
document.addEventListener("click", (e) => {
  if (landlordSearch.contains(e.target) || landlordResults.contains(e.target)) return;
  landlordResults.style.display = "none";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.style.display = "none";

  if (!landlordIdInput.value) {
    errorBox.textContent = "Please choose your property from the list.";
    errorBox.style.display = "block";
    return;
  }

  const selectedUnit = allUnits.find((u) => u.id === unitSelect.value);
  if (unitSelect.value && selectedUnit && (selectedUnit.occupancy === "occupied" || selectedUnit.claimed)) {
    // Defends against the unit being claimed by someone else in the
    // (short) window between this page loading and this form being
    // submitted — the dropdown filter above handles the normal case,
    // this catches the race.
    errorBox.textContent = "That unit was just taken by another tenant. Please refresh and pick a different one, or contact the office.";
    errorBox.style.display = "block";
    return;
  }

  signupBtn.disabled = true;
  signupBtn.textContent = "Creating account...";

  const data = new FormData(form);
  const landlordId = landlordIdInput.value;
  const unitId = data.get("unitId");

  try {
    const cred = await auth.createUserWithEmailAndPassword(data.get("email"), data.get("password"));

    // Tenant profile starts "pending" — staff confirm they actually live
    // in the unit they selected before payments are trusted.
    // The profile and the unit claim are written together: if someone else
    // claimed the unit first, the whole write is refused.
    const batch = db.batch();
    batch.set(db.collection("tenants").doc(cred.user.uid), {
      name: data.get("name"),
      phone: data.get("phone"),
      email: data.get("email"),
      landlordId,
      unitId,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (unitId) {
      batch.update(db.collection("units").doc(unitId), { claimedBy: cred.user.uid });
    }
    try {
      await batch.commit();
    } catch (claimErr) {
      // Don't leave a login with no profile behind (it would block a retry
      // with the same email).
      await cred.user.delete().catch(() => {});
      throw new Error("That unit was just taken by another tenant. Please refresh and pick a different one, or contact the office.");
    }

    window.location.href = "portal.html";
  } catch (err) {
    console.error(err);
    errorBox.textContent = err.message;
    errorBox.style.display = "block";
    signupBtn.disabled = false;
    signupBtn.textContent = "Create Account";
  }
});

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
