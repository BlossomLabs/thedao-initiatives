// Submit-page helper: copy the AI drafting guide (/llms.txt) to the clipboard.
// Lives in a static file because the CSP is script-src 'self' (no inline JS).
(function () {
  "use strict";
  var btn = document.getElementById("copy-guide");
  if (!btn) return;
  var original = btn.textContent;
  btn.addEventListener("click", function () {
    fetch("/llms.txt")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (text) { return navigator.clipboard.writeText(text); })
      .then(function () {
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = original; }, 2500);
      })
      .catch(function () {
        btn.textContent = "Copy failed — open /llms.txt";
        setTimeout(function () { btn.textContent = original; }, 4000);
      });
  });
})();
