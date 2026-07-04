/* Admin: deploy a per-RFP Gnosis Safe from the connected wallet.
 * The server supplies the exact factory calldata (fixed signers + threshold)
 * and independently verifies the deployed Safe on-chain before storing it. */
(function () {
  "use strict";
  var box = document.getElementById("safe-deploy");
  if (!box) return;
  var rfpId = box.dataset.rfp;
  var elStatus = document.getElementById("safe-deploy-status");

  function status(kind, html) {
    elStatus.hidden = false;
    elStatus.className = "status " + kind;
    elStatus.innerHTML = html;
  }

  function chainHex(id) { return "0x" + Number(id).toString(16); }

  function explorer(chain) {
    return chain === "sepolia" ? "https://sepolia.etherscan.io"
                               : "https://etherscan.io";
  }

  function ensureChain(eth, chainId) {
    var want = chainHex(chainId);
    return eth.request({ method: "eth_chainId" }).then(function (id) {
      if (id === want) return true;
      return eth.request({
        method: "wallet_switchEthereumChain", params: [{ chainId: want }]
      });
    });
  }

  function deploy(chainName) {
    var eth = window.ethereum;
    if (!eth) {
      status("err", "No wallet in this browser. Open this page in the browser with your wallet extension.");
      return;
    }
    status("wait", "Fetching deploy parameters…");
    fetch("/api/admin/rfps/" + rfpId + "/safe-deploy-params?chain=" + chainName)
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p.enabled) throw new Error(p.reason || "deployment disabled");
        status("wait", "Check your wallet: switching to " + p.chain + "…");
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
                   "<a class=\"m\" target=\"_blank\" rel=\"noopener\" href=\"" +
                   explorer(chainName) + "/tx/" + txHash + "\">" +
                   txHash.slice(0, 10) + "…</a>");
            confirmLoop(txHash, chainName, 0);
          });
      })
      .catch(function (e) {
        var m = (e && e.code === 4001) ? "you rejected the request in the wallet."
              : String((e && e.message) || e).slice(0, 200);
        status("err", "Deploy not completed: " + m);
      });
  }

  function confirmLoop(txHash, chainName, attempt) {
    fetch("/api/admin/rfps/" + rfpId + "/safe-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_hash: txHash, chain: chainName })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.status === "ok") {
          var link = "<a class=\"m\" target=\"_blank\" rel=\"noopener\" href=\"" +
                     explorer(chainName) + "/address/" + res.address + "\">" +
                     res.address + "</a>";
          if (res.stored) {
            status("ok", "✅ Safe deployed, verified, and saved: " + link +
                   "<br>Donations to this address now count for this RFP. Reloading…");
            setTimeout(function () { window.location.reload(); }, 2500);
          } else {
            status("ok", "✅ Test deploy verified on Sepolia (not saved): " + link +
                   "<br>The real thing will work exactly like this. " +
                   "Deploy on mainnet when ready.");
          }
        } else if (res.status === "pending" && attempt < 60) {
          setTimeout(function () { confirmLoop(txHash, chainName, attempt + 1); }, 5000);
        } else {
          status("err", "Verification problem: " + (res.detail || "unknown") +
                 (res.status === "pending" ? " (still pending, keep this page open)" : ""));
          if (res.status === "pending") {
            setTimeout(function () { confirmLoop(txHash, chainName, attempt + 1); }, 10000);
          }
        }
      })
      .catch(function () {
        setTimeout(function () { confirmLoop(txHash, chainName, attempt + 1); }, 6000);
      });
  }

  var btnMain = document.getElementById("safe-deploy-mainnet");
  var btnSep = document.getElementById("safe-deploy-sepolia");
  if (btnMain) btnMain.addEventListener("click", function () {
    if (window.confirm("Deploy this RFP's donation Safe on Ethereum MAINNET? " +
                       "This costs real gas from your wallet.")) deploy("mainnet");
  });
  if (btnSep) btnSep.addEventListener("click", function () { deploy("sepolia"); });
})();
