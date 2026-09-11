// Submit-page helpers. Lives in a static file because the CSP is script-src
// 'self' (no inline JS).
//   1. copy the AI drafting guide (/llms.txt) to the clipboard
//   2. show the rules panel for the chosen type (RFP / grant / top-up grant)
//      and the top-up controls only for grants
(function () {
  "use strict";
  var btn = document.getElementById("copy-guide");
  if (btn) {
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
          btn.textContent = "Copy failed: open /llms.txt";
          setTimeout(function () { btn.textContent = original; }, 4000);
        });
    });
  }

  var form = document.getElementById("submit-form");
  if (!form) return;
  var topupRow = document.getElementById("topup-row");
  var topup = document.getElementById("f-topup");
  var reviewerRow = document.getElementById("reviewer-row");
  var panels = form.querySelectorAll("[data-rules]");

  function currentKind() {
    var type = form.querySelector('input[name="type"]:checked');
    var t = type ? type.value : "rfp";
    if (t === "grant" && topup && topup.checked) return "topup";
    return t;
  }

  function refresh() {
    var type = form.querySelector('input[name="type"]:checked');
    var isGrant = type && type.value === "grant";
    if (topupRow) topupRow.hidden = !isGrant;
    if (reviewerRow) reviewerRow.hidden = !(isGrant && topup && topup.checked);
    var kind = currentKind();
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute("data-rules") !== kind;
    }
  }

  var radios = form.querySelectorAll('input[name="type"]');
  for (var i = 0; i < radios.length; i++) radios[i].addEventListener("change", refresh);
  if (topup) topup.addEventListener("change", refresh);
  refresh();
})();
