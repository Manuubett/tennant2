// ---------------------------------------------------------------------
// SEPARATE Firebase project for the Tenant Payment App.
// Do NOT reuse the Sanefi Consult website's project here — this keeps
// tenant/landlord/payment data isolated from the public website's Auth
// user pool, per the earlier decision.
//
// Firebase Console -> create a NEW project (e.g. "sanefi-rent-app")
// -> Project Settings -> General -> "Your apps" -> Web app
// -> paste the generated config object below.
// ---------------------------------------------------------------------
  const firebaseConfig = {
    apiKey: "AIzaSyDC2cVxi-rAzofaDghX_P14iAqukvoGYAc",
    authDomain: "sarefi-20d99.firebaseapp.com",
    projectId: "sarefi-20d99",
    storageBucket: "sarefi-20d99.firebasestorage.app",
    messagingSenderId: "837562607207",
    appId: "1:837562607207:web:806f22445431c5a0fd96c2",
    measurementId: "G-91H2H8X4J7"
  };

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Offline persistence — same reasoning as the main site: faster repeat
// loads, and works for a beat even if connectivity drops (useful for a
// mobile-wrapped app on a spotty connection).
db.enablePersistence().catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore persistence not supported in this browser.");
  }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  });
}
