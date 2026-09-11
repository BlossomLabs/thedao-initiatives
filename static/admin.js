/* Admin: deploy a per-RFP Gnosis Safe from the connected wallet.
 * The server supplies the exact factory calldata (fixed signers + threshold)
 * and independently verifies the deployed Safe on-chain before storing it. */
(function () {
  "use strict";

  // Confirm-before-submit for destructive buttons (CSP forbids inline
  // onclick, so the button carries data-confirm and we bind it here).
  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-confirm]");
    if (btn && !window.confirm(btn.dataset.confirm)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);

  // Manage form: only the fields for the chosen type are shown.
  var typeSel = document.querySelector('form.form select[name="type"]');
  var topupBox = document.querySelector('form.form input[name="topup"]');
  if (typeSel && topupBox) {
    var sync = function () {
      var grant = typeSel.value === "grant";
      document.querySelectorAll("[data-grant-only]").forEach(function (el) { el.hidden = !grant; });
      document.querySelectorAll("[data-topup-only]").forEach(function (el) { el.hidden = !(grant && topupBox.checked); });
    };
    typeSel.addEventListener("change", sync);
    topupBox.addEventListener("change", sync);
  }

  var box = document.getElementById("safe-deploy");
  if (!box) return;
  var rfpId = box.dataset.rfp;
  var elStatus = document.getElementById("safe-deploy-status");

  function status(kind, html) {
    elStatus.hidden = false;
    elStatus.className = "status " + kind;
    elStatus.innerHTML = html;
  }

  function ensureChain(eth, chainId) {
    var want = "0x" + Number(chainId).toString(16);
    return eth.request({ method: "eth_chainId" }).then(function (id) {
      if (id === want) return true;
      return eth.request({
        method: "wallet_switchEthereumChain", params: [{ chainId: want }]
      });
    });
  }

  function deploy() {
    var eth = window.ethereum;
    if (!eth) {
      status("err", "No wallet in this browser. Open this page in the browser with your wallet extension.");
      return;
    }
    status("wait", "Fetching deploy parameters…");
    fetch("/api/admin/rfps/" + rfpId + "/safe-deploy-params")
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p.enabled) throw new Error(p.reason || "deployment disabled");
        status("wait", "Check your wallet: switching to mainnet…");
        return ensureChain(eth, p.chain_id)
          .then(function () {
            return eth.request({ method: "eth_requestAccounts" });
          })
          .then(function (accounts) {
            status("wait", "Check your wallet to approve the deployment " +
                   "(one transaction to the Safe factory)…");
            return eth.request({
              method: "eth_sendTransaction",
              params: [{ from: accounts[0], to: p.factory, value: "0x0",
                         data: p.calldata }]
            });
          })
          .then(function (txHash) {
            status("wait", "Deploying… waiting for the transaction to mine.<br>" +
                   "<a class=\"m\" target=\"_blank\" rel=\"noopener\" " +
                   "href=\"https://etherscan.io/tx/" + txHash + "\">" +
                   txHash.slice(0, 10) + "…</a>");
            confirmLoop(txHash, 0);
          });
      })
      .catch(function (e) {
        var m = (e && e.code === 4001) ? "you rejected the request in the wallet."
              : String((e && e.message) || e).slice(0, 200);
        status("err", "Deploy not completed: " + m);
      });
  }

  function confirmLoop(txHash, attempt) {
    fetch("/api/admin/rfps/" + rfpId + "/safe-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_hash: txHash })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.status === "ok") {
          status("ok", "✅ Safe deployed, verified, and saved: " +
                 "<a class=\"m\" target=\"_blank\" rel=\"noopener\" " +
                 "href=\"https://etherscan.io/address/" + res.address + "\">" +
                 res.address + "</a><br>Donations to this address now count " +
                 "for this initiative. Reloading…");
          setTimeout(function () { window.location.reload(); }, 2500);
        } else if (res.status === "pending" && attempt < 60) {
          setTimeout(function () { confirmLoop(txHash, attempt + 1); }, 5000);
        } else {
          status("err", "Verification problem: " + (res.detail || "unknown") +
                 (res.status === "pending" ? " (still pending, keep this page open)" : ""));
          if (res.status === "pending") {
            setTimeout(function () { confirmLoop(txHash, attempt + 1); }, 10000);
          }
        }
      })
      .catch(function () {
        setTimeout(function () { confirmLoop(txHash, attempt + 1); }, 6000);
      });
  }

  var btn = document.getElementById("safe-deploy-mainnet");
  if (btn) btn.addEventListener("click", function () {
    if (window.confirm("Deploy this initiative's donation Safe on Ethereum mainnet? " +
                       "This costs real gas from your wallet.")) deploy();
  });
})();
