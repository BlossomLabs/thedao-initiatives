/* Donation flow: connect injected wallet, send an ERC-20 transfer of a
 * verified stablecoin to the treasury (griff.eth), then have the server
 * verify the transaction on-chain and credit it to this RFP.
 *
 * No libraries. Calldata is encoded by hand and the encoding rules are
 * mirrored + asserted in the server test suite (tests/test_core.py).
 * The server re-verifies everything from the chain; nothing here is trusted.
 */
(function () {
  "use strict";
  var app = document.getElementById("donate-app");
  if (!app || app.dataset.enabled !== "1") return;

  var slug = app.dataset.slug;
  var $ = function (id) { return document.getElementById(id); };
  var elToken = $("d-token"), elAmount = $("d-amount"),
      elConnect = $("d-connect"), elSend = $("d-send"), elStatus = $("d-status"),
      elManualHash = $("d-manual-hash"), elManualBtn = $("d-manual-btn");

  var params = null;   // from /api/donate/params
  var account = null;

  function status(kind, html) {
    elStatus.hidden = false;
    elStatus.className = "status " + kind;
    elStatus.innerHTML = html;
  }

  function fetchParams() {
    return fetch("/api/donate/params/" + encodeURIComponent(slug))
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p.enabled) throw new Error(p.reason || "donations unavailable");
        params = p;
        return p;
      });
  }

  // ---- amount handling: decimal string -> base-unit BigInt (no floats) ----
  function toBaseUnits(amountStr, decimals) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(amountStr).trim());
    if (!m) return null;
    var frac = m[2] || "";
    if (frac.length > decimals) return null; // more precision than the token
    var whole = BigInt(m[1]);
    var fracPadded = BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
    var v = whole * (BigInt(10) ** BigInt(decimals)) + fracPadded;
    return v > BigInt(0) ? v : null;
  }

  // ---- calldata: transfer(address,uint256) = 0xa9059cbb + args ----
  function pad32(hex) { return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0"); }
  function transferCalldata(to, amountBig) {
    return "0xa9059cbb" + pad32(to) + pad32(amountBig.toString(16));
  }

  function ensureMainnet(eth) {
    return eth.request({ method: "eth_chainId" }).then(function (id) {
      if (id === "0x1") return true;
      return eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }]
      }).then(function () { return true; });
    });
  }

  function connect() {
    var eth = window.ethereum;
    if (!eth) {
      status("err",
        "No wallet detected in this browser. You can still donate: send an " +
        "accepted stablecoin to <b>griff.eth</b> from any wallet or exchange, " +
        "then paste the transaction hash under “Already sent it?” below.");
      return;
    }
    status("wait", "Connecting wallet…");
    fetchParams()
      .then(function () { return ensureMainnet(eth); })
      .then(function () {
        return eth.request({ method: "eth_requestAccounts" });
      })
      .then(function (accounts) {
        account = accounts && accounts[0];
        if (!account) throw new Error("no account authorized");
        elConnect.hidden = true;
        elSend.hidden = false;
        status("ok", "Connected as <span class=\"m\">" +
               account.slice(0, 6) + "…" + account.slice(-4) +
               "</span> on Ethereum mainnet.");
      })
      .catch(function (e) { status("err", "Could not connect: " + msg(e)); });
  }

  function donate() {
    var eth = window.ethereum;
    if (!eth || !account || !params) return;
    var sym = elToken.value;
    var tok = params.tokens[sym];
    if (!tok) { status("err", "Pick a token."); return; }
    var base = toBaseUnits(elAmount.value, tok.decimals);
    if (base === null) {
      status("err", "Enter a valid amount (up to " + tok.decimals +
             " decimal places).");
      return;
    }
    status("wait", "Confirm the transfer in your wallet… <br><span class=\"small dim\">" +
           "Sending " + elAmount.value + " " + sym + " to " +
           params.treasury_ens + " (" + params.treasury.slice(0, 8) + "…)</span>");
    ensureMainnet(eth).then(function () {
      return eth.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: tok.address,                       // the token contract
          value: "0x0",
          data: transferCalldata(params.treasury, base)
        }]
      });
    }).then(function (txHash) {
      status("wait", "Transaction sent. Waiting for mainnet confirmation…<br>" +
             "<a class=\"m\" target=\"_blank\" rel=\"noopener\" " +
             "href=\"https://etherscan.io/tx/" + txHash + "\">" + txHash.slice(0, 18) +
             "…</a>");
      confirmTx(txHash, 0);
    }).catch(function (e) { status("err", "Not sent: " + msg(e)); });
  }

  function confirmTx(txHash, attempt) {
    fetch("/api/donate/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: slug, tx_hash: txHash })
    }).then(function (r) { return r.json(); })
      .then(function (res) { handleVerify(txHash, res, attempt); })
      .catch(function () { schedulePoll(txHash, attempt); });
  }

  function pollStatus(txHash, attempt) {
    fetch("/api/donate/status/" + txHash)
      .then(function (r) { return r.json(); })
      .then(function (res) { handleVerify(txHash, res, attempt); })
      .catch(function () { schedulePoll(txHash, attempt); });
  }

  function handleVerify(txHash, res, attempt) {
    if (res.status === "confirmed") {
      status("ok", "🎉 Confirmed: <b>" + res.amount + " " + res.token +
             "</b> credited to this RFP. Reloading…");
      setTimeout(function () { window.location.reload(); }, 2500);
    } else if (res.status === "failed" || res.status === "error") {
      status("err", "Verification failed: " + (res.detail || "unknown reason"));
    } else if (attempt > 50) {
      status("wait", "Still pending after several minutes. Your donation will " +
             "be credited automatically once it confirms — you can close this page.");
    } else {
      schedulePoll(txHash, attempt);
    }
  }

  function schedulePoll(txHash, attempt) {
    setTimeout(function () { pollStatus(txHash, attempt + 1); }, 6000);
  }

  function manualVerify() {
    var h = (elManualHash.value || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
      status("err", "That does not look like a transaction hash (0x + 64 hex characters).");
      return;
    }
    status("wait", "Verifying transaction on-chain…");
    confirmTx(h.toLowerCase(), 0);
  }

  function msg(e) {
    if (e && e.code === 4001) return "you rejected the request in the wallet.";
    return (e && (e.message || e.reason)) ? String(e.message || e.reason).slice(0, 200)
                                          : "unknown error";
  }

  elConnect.addEventListener("click", connect);
  elSend.addEventListener("click", donate);
  elManualBtn.addEventListener("click", manualVerify);
  fetchParams().catch(function (e) { status("err", msg(e)); });
})();
