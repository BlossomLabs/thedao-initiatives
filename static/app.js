/* TheDAO RFP board — wallet + donation widgets.
 *
 * One shared wallet connection powers any number of donate widgets on the
 * page (cards on the board, the panel on a detail page). No libraries:
 * calldata is hand-encoded (mirrored + asserted in tests/test_core.py) and
 * the server independently re-verifies every donation from the chain.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ shared state
  var params = null;      // /api/donate/params result
  var account = null;
  var paramsPromise = null;

  function getParams() {
    if (paramsPromise) return paramsPromise;
    paramsPromise = fetch("/api/donate/params")
      .then(function (r) { return r.json(); })
      .then(function (p) {
        if (!p.enabled) throw new Error(p.reason || "donations unavailable");
        params = p;
        return p;
      });
    return paramsPromise;
  }

  function short(a) { return a.slice(0, 6) + "…" + a.slice(-4); }

  function msg(e) {
    if (e && e.code === 4001) return "you rejected the request in the wallet.";
    return (e && (e.message || e.reason))
      ? String(e.message || e.reason).slice(0, 200) : "unknown error";
  }

  function ensureMainnet(eth) {
    return eth.request({ method: "eth_chainId" }).then(function (id) {
      if (id === "0x1") return true;
      return eth.request({
        method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }]
      }).then(function () { return true; });
    });
  }

  var navBtn = document.getElementById("nav-connect");

  function setConnected(acct) {
    account = acct;
    if (navBtn) {
      navBtn.textContent = short(acct);
      navBtn.classList.add("connected");
      navBtn.disabled = true;
    }
    document.querySelectorAll("[data-donate]").forEach(function (el) {
      var b = el.querySelector(".dw-send");
      if (b) b.textContent = "Donate";
    });
  }

  function connectWallet() {
    var eth = window.ethereum;
    if (!eth) return Promise.reject(new Error("no-wallet"));
    return getParams()
      .then(function () { return ensureMainnet(eth); })
      .then(function () { return eth.request({ method: "eth_requestAccounts" }); })
      .then(function (accounts) {
        if (!accounts || !accounts[0]) throw new Error("no account authorized");
        setConnected(accounts[0]);
        return account;
      });
  }

  if (navBtn) {
    navBtn.addEventListener("click", function () {
      navBtn.textContent = "Connecting…";
      connectWallet().catch(function (e) {
        navBtn.textContent = "Connect wallet";
        if (e && e.message === "no-wallet") {
          navBtn.textContent = "No wallet found";
          setTimeout(function () { navBtn.textContent = "Connect wallet"; }, 2500);
        }
      });
    });
    // reflect an already-authorized wallet without prompting
    if (window.ethereum && window.ethereum.request) {
      window.ethereum.request({ method: "eth_accounts" }).then(function (a) {
        if (a && a[0]) { getParams().then(function () { setConnected(a[0]); }).catch(function(){}); }
      }).catch(function () {});
    }
  }

  // ------------------------------------------------------------ amounts

  function toBaseUnits(amountStr, decimals) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(amountStr).trim());
    if (!m) return null;
    var frac = m[2] || "";
    if (frac.length > decimals) return null;
    var whole = BigInt(m[1]);
    var fracPadded = BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
    var v = whole * (BigInt(10) ** BigInt(decimals)) + fracPadded;
    return v > BigInt(0) ? v : null;
  }

  function pad32(hex) { return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0"); }
  function transferCalldata(to, amountBig) {
    return "0xa9059cbb" + pad32(to) + pad32(amountBig.toString(16));
  }

  // ------------------------------------------------------------ widget

  function initWidget(root) {
    var slug = root.dataset.slug;
    var rfpAddress = root.dataset.address || "";
    var elToken = root.querySelector(".dw-token");
    var elAmount = root.querySelector(".dw-amount");
    var elSend = root.querySelector(".dw-send");
    var elStatus = root.querySelector(".dw-status");
    var chips = root.querySelectorAll(".dw-chip");

    chips.forEach(function (c) {
      c.addEventListener("click", function (ev) {
        ev.preventDefault();
        chips.forEach(function (x) { x.classList.remove("on"); });
        c.classList.add("on");
        elAmount.value = c.dataset.amount;
      });
    });
    if (elAmount) {
      elAmount.addEventListener("input", function () {
        chips.forEach(function (x) {
          x.classList.toggle("on", x.dataset.amount === elAmount.value);
        });
      });
    }

    function status(kind, html) {
      elStatus.hidden = false;
      elStatus.className = "dw-status status " + kind;
      elStatus.innerHTML = html;
    }

    function donate() {
      if (!/^0x[0-9a-fA-F]{40}$/.test(rfpAddress)) {
        status("err", "This RFP's donation address is not set up yet.");
        return;
      }
      if (!window.ethereum) {
        status("err",
          "No wallet detected in this browser. You can still donate from any " +
          "wallet or exchange: send an accepted stablecoin to this RFP's own " +
          "address <b class=\"m\">" + rfpAddress + "</b> and it is counted " +
          "automatically.");
        return;
      }
      var pre = account ? Promise.resolve(account)
                        : (status("wait", "Connecting wallet…"), connectWallet());
      pre.then(function () {
        var sym = elToken.value;
        var tok = params.tokens[sym];
        var base = toBaseUnits(elAmount.value, tok.decimals);
        if (base === null) {
          status("err", "Enter a valid amount (whole numbers or up to " +
                 tok.decimals + " decimals).");
          return;
        }
        status("wait", "Check your wallet to approve:<br><b>" +
               elAmount.value + " " + sym + "</b> → <b>this RFP's Safe</b> " +
               "<span class=\"m dim\">(" + short(rfpAddress) + ")</span>");
        return ensureMainnet(window.ethereum).then(function () {
          return window.ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: account, to: tok.address, value: "0x0",
                       data: transferCalldata(rfpAddress, base) }]
          });
        }).then(function (txHash) {
          status("wait", "Sent. Waiting for mainnet confirmation…<br>" +
                 "<a class=\"m\" target=\"_blank\" rel=\"noopener\" " +
                 "href=\"https://etherscan.io/tx/" + txHash + "\">" +
                 short(txHash) + "</a>");
          confirmTx(txHash, 0);
        });
      }).catch(function (e) {
        status("err", "Not sent: " + msg(e));
      });
    }

    function confirmTx(txHash, attempt) {
      fetch("/api/donate/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, tx_hash: txHash })
      }).then(function (r) { return r.json(); })
        .then(function (res) { handle(txHash, res, attempt); })
        .catch(function () { schedule(txHash, attempt); });
    }

    function poll(txHash, attempt) {
      fetch("/api/donate/status/" + txHash)
        .then(function (r) { return r.json(); })
        .then(function (res) { handle(txHash, res, attempt); })
        .catch(function () { schedule(txHash, attempt); });
    }

    function handle(txHash, res, attempt) {
      if (res.status === "confirmed") {
        status("ok", "🎉 Confirmed: <b>" + res.amount + " " + res.token +
               "</b> credited to this RFP. Thank you! Refreshing…");
        setTimeout(function () { window.location.reload(); }, 2200);
      } else if (res.status === "failed" || res.status === "error") {
        status("err", "Verification failed: " + (res.detail || "unknown reason"));
      } else if (attempt > 50) {
        status("wait", "Still pending. It will be credited automatically once " +
               "it confirms. You can close this page.");
      } else {
        schedule(txHash, attempt);
      }
    }

    function schedule(txHash, attempt) {
      setTimeout(function () { poll(txHash, attempt + 1); }, 6000);
    }

    if (elSend) elSend.addEventListener("click", donate);

    var manualBtn = root.querySelector(".dw-manual-btn");
    var manualHash = root.querySelector(".dw-manual-hash");
    if (manualBtn && manualHash) {
      manualBtn.addEventListener("click", function () {
        var h = (manualHash.value || "").trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(h)) {
          status("err", "That does not look like a transaction hash (0x + 64 hex characters).");
          return;
        }
        status("wait", "Verifying transaction on mainnet…");
        confirmTx(h.toLowerCase(), 0);
      });
    }
  }

  document.querySelectorAll("[data-donate]").forEach(initWidget);

  // expand/collapse card widgets
  document.querySelectorAll("[data-donate-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var card = btn.closest(".rfp-card");
      var panel = card && card.querySelector(".card-donate");
      if (!panel) return;
      var open = !panel.hidden;
      panel.hidden = open;
      btn.classList.toggle("open", !open);
      btn.textContent = open ? "Donate" : "Close";
    });
  });

  // ------------------------------------------------------------ hero counter
  var hero = document.getElementById("hero-raised");
  if (hero) {
    var target = parseFloat(hero.dataset.target || "0");
    var t0 = null;
    var dur = 1300;
    function fmt(v) {
      return "$" + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      hero.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    if (target > 0) requestAnimationFrame(step); else hero.textContent = "$0";
  }
})();
