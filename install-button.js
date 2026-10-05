// install-button.js
// Adds an "Install App" button to the header (next to the bell / Log Out).
// Android/Chrome/Edge: triggers the real install prompt.
// iPhone/iPad (Safari): shows "Share -> Add to Home Screen" instructions.
// Hidden automatically once the app is installed / opened in standalone mode.
(function () {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let deferredPrompt = null;
  let btn = null;

  function ensureButton() {
    if (btn) return btn;
    const host = document.querySelector(".header-actions");
    if (!host) return null;

    btn = document.createElement("button");
    btn.id = "install-btn";
    btn.type = "button";
    btn.className = "logout-btn"; // reuse your existing header button style
    btn.style.display = "none";
    btn.style.marginRight = "8px";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'style="vertical-align:-2px;margin-right:6px">' +
      '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Install App';
    host.insertBefore(btn, host.querySelector("#logout-btn"));
    btn.addEventListener("click", onClick);
    return btn;
  }

  async function onClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.style.display = "none";
    } else if (isIOS) {
      showIOSHelp();
    }
  }

  function showIOSHelp() {
    if (document.getElementById("ios-install-help")) return;
    const box = document.createElement("div");
    box.id = "ios-install-help";
    box.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;" +
      "display:flex;align-items:flex-end;justify-content:center;padding:16px;";
    box.innerHTML =
      '<div style="background:#fff;color:#222;border-radius:14px;padding:20px;' +
      'max-width:380px;width:100%;font:15px/1.5 system-ui,sans-serif;">' +
      '<strong style="font-size:17px">Install Sanefi Rent</strong>' +
      '<ol style="margin:12px 0 16px;padding-left:20px">' +
      "<li>Tap the <b>Share</b> button in Safari's toolbar.</li>" +
      "<li>Scroll and tap <b>Add to Home Screen</b>.</li>" +
      "<li>Tap <b>Add</b>.</li></ol>" +
      '<button id="ios-help-close" style="width:100%;padding:10px;border:0;' +
      'border-radius:8px;background:#1a73e8;color:#fff;font-size:15px">Got it</button></div>';
    document.body.appendChild(box);
    const close = () => box.remove();
    box.addEventListener("click", (e) => { if (e.target === box) close(); });
    box.querySelector("#ios-help-close").addEventListener("click", close);
  }

  // Android / desktop Chrome & Edge
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const b = ensureButton();
    if (b) b.style.display = "";
  });

  // Hide after a successful install
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    if (btn) btn.style.display = "none";
  });

  // iOS never fires beforeinstallprompt, so show the button with instructions
  if (isIOS) {
    const show = () => { const b = ensureButton(); if (b) b.style.display = ""; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
    else show();
  }
})();
