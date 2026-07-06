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
    if (e && e.code === -32002)
      return "your wallet already has a request open. Open the wallet and " +
             "finish or dismiss it, then try again.";
    var raw = (e && (e.message || e.reason)) ? String(e.message || e.reason) : "";
    if (/insufficient funds/i.test(raw))
      return "the wallet does not have enough ETH to pay the network fee.";
    if (/user rejected|denied/i.test(raw))
      return "you rejected the request in the wallet.";
    return raw ? raw.slice(0, 200) : "unknown error";
  }

  function ensureMainnet(p) {
    return p.request({ method: "eth_chainId" }).then(function (id) {
      if (id === "0x1") return true;
      return p.request({
        method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }]
      }).then(function () { return true; });
    });
  }

  var navBtn = document.getElementById("nav-connect");

  // EIP-6963: discover every installed wallet instead of racing on
  // window.ethereum (MetaMask vs Rabby vs Coinbase extension).
  var providers = [];        // [{info: {uuid,name,icon}, provider}]
  var activeProvider = null;
  window.addEventListener("eip6963:announceProvider", function (ev) {
    try {
      var d = ev.detail;
      if (d && d.info && !providers.some(function (p) {
        return p.info.uuid === d.info.uuid;
      })) providers.push(d);
    } catch (e) {}
  });
  try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}

  function eth() {
    return activeProvider
      || (providers[0] && providers[0].provider)
      || window.ethereum || null;
  }

  function disconnectUi() {
    account = null;
    balances = {};
    if (navBtn) {
      navBtn.textContent = "Connect wallet";
      navBtn.classList.remove("connected");
      navBtn.title = "";
    }
    annotateTokenSelects();
  }

  function watchProvider(p) {
    if (!p || p.__thedaoWatched || typeof p.on !== "function") return;
    p.__thedaoWatched = true;
    p.on("accountsChanged", function (accounts) {
      if (accounts && accounts[0]) setConnected(accounts[0]);
      else disconnectUi();
    });
    p.on("chainChanged", function () {
      // per-transaction ensureMainnet() re-checks; balances are chain-specific
      refreshBalances();
    });
  }

  var balances = {};   // symbol -> float token balance (null = unknown)

  function setConnected(acct) {
    account = acct;
    balances = {};
    if (navBtn) {
      navBtn.textContent = short(acct);
      navBtn.classList.add("connected");
      navBtn.title = "Connected. Click to switch wallets.";
      fetch("/api/ens-name/" + acct)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.name && account === acct) navBtn.textContent = d.name;
        }).catch(function () {});
    }
    document.querySelectorAll("[data-donate]").forEach(function (el) {
      var b = el.querySelector(".dw-send");
      if (b) b.textContent = "Donate";
    });
    refreshBalances();
  }

  function refreshBalances() {
    var p = eth();
    if (!account || !params || !p) return;
    var acct = account;
    Object.keys(params.tokens).forEach(function (sym) {
      var tok = params.tokens[sym];
      var req = tok.address === "native"
        ? p.request({ method: "eth_getBalance",
                      params: [acct, "latest"] })
        : p.request({ method: "eth_call", params: [{
            to: tok.address, data: "0x70a08231" + pad32(acct) }, "latest"] });
      req.then(function (hex) {
        if (account !== acct) return;
        var v = (hex && hex !== "0x") ? BigInt(hex) : BigInt(0);
        balances[sym] = Number(v) / Math.pow(10, tok.decimals);
        annotateTokenSelects();
      }).catch(function () { balances[sym] = null; });
    });
  }

  function annotateTokenSelects() {
    document.querySelectorAll(".dw-token option").forEach(function (o) {
      var b = balances[o.value];
      o.textContent = (typeof b === "number" && b > 0)
        ? o.value + " \u2713" : o.value;
    });
    // default each select to a token the wallet actually holds
    document.querySelectorAll(".dw-token").forEach(function (sel) {
      if ((balances[sel.value] || 0) > 0) return;
      for (var i = 0; i < sel.options.length; i++) {
        if ((balances[sel.options[i].value] || 0) > 0) {
          sel.value = sel.options[i].value;
          return;
        }
      }
    });
  }

  function connectWallet() {
    var p = eth();
    if (!p) return Promise.reject(new Error("no-wallet"));
    watchProvider(p);
    return getParams()
      .then(function () { return ensureMainnet(p); })
      .then(function () { return p.request({ method: "eth_requestAccounts" }); })
      .then(function (accounts) {
        if (!accounts || !accounts[0]) throw new Error("no account authorized");
        setConnected(accounts[0]);
        return account;
      });
  }

  function switchWallet(p) {
    p = p || eth();
    watchProvider(p);
    // wallet_requestPermissions forces the account picker in MetaMask-style
    // wallets; fall back to a plain re-request where unsupported.
    return p.request({ method: "wallet_requestPermissions",
                       params: [{ eth_accounts: {} }] })
      .catch(function () { return null; })
      .then(function () { return p.request({ method: "eth_requestAccounts" }); })
      .then(function (accounts) {
        if (accounts && accounts[0]) setConnected(accounts[0]);
      });
  }

  var walletMenu = null;
  function toggleWalletMenu() {
    if (walletMenu) { walletMenu.remove(); walletMenu = null; return; }
    walletMenu = document.createElement("div");
    walletMenu.className = "wallet-menu";
    providers.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = (activeProvider === p.provider ? "\u25cf " : "") +
                      p.info.name;
      b.addEventListener("click", function () {
        activeProvider = p.provider;
        walletMenu.remove(); walletMenu = null;
        switchWallet(p.provider).catch(function () {});
      });
      walletMenu.appendChild(b);
    });
    var sw = document.createElement("button");
    sw.type = "button";
    sw.textContent = "Switch account\u2026";
    sw.addEventListener("click", function () {
      walletMenu.remove(); walletMenu = null;
      switchWallet().catch(function () {});
    });
    walletMenu.appendChild(sw);
    navBtn.parentNode.appendChild(walletMenu);
  }

  if (navBtn) {
    navBtn.addEventListener("click", function () {
      if (account && eth()) {
        if (providers.length > 1) { toggleWalletMenu(); return; }
        var prev = navBtn.textContent;
        navBtn.textContent = "Choose wallet…";
        switchWallet().catch(function () { navBtn.textContent = prev; });
        return;
      }
      navBtn.textContent = "Connecting…";
      connectWallet().catch(function (e) {
        navBtn.textContent = "Connect wallet";
        if (e && e.message === "no-wallet") {
          navBtn.textContent = "No wallet found";
          setTimeout(function () { navBtn.textContent = "Connect wallet"; }, 2500);
        }
      });
    });
    // reflect an already-authorized wallet without prompting (after 6963
    // announcements settle)
    setTimeout(function () {
      var p = eth();
      if (p && p.request) {
        watchProvider(p);
        p.request({ method: "eth_accounts" }).then(function (a) {
          if (a && a[0]) { getParams().then(function () { setConnected(a[0]); }).catch(function(){}); }
        }).catch(function () {});
      }
    }, 300);
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

  function tokenQty(usd, sym) {
    var tok = params.tokens[sym];
    var rate = (params.rates && params.rates[sym]) || 1;
    var prec = Math.min(tok.decimals, 8);
    return (usd / rate).toFixed(prec)
      .replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  function parseUsd(raw) {
    return /^\d+(\.\d+)?$/.test(String(raw).trim()) ? parseFloat(raw) : NaN;
  }
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
    var elConv = root.querySelector(".dw-conv");
    var chips = root.querySelectorAll(".dw-chip");

    function updateConversion() {
      if (!elConv) return;
      var sym = elToken ? elToken.value : "";
      if (!params || !params.tokens[sym]) { elConv.hidden = true; return; }
      var rate = (params.rates && params.rates[sym]) || 1;
      var usd = parseUsd(elAmount.value);
      if (!(usd > 0) || rate === 1) { elConv.hidden = true; return; }
      var rateStr = rate >= 10
        ? "$" + Math.round(rate).toLocaleString()
        : "$" + rate.toFixed(2);
      elConv.textContent = "\u2248 " + tokenQty(usd, sym) + " " + sym +
        " \u00b7 " + rateStr + " per " + sym;
      elConv.hidden = false;
    }

    chips.forEach(function (c) {
      c.addEventListener("click", function (ev) {
        ev.preventDefault();
        chips.forEach(function (x) { x.classList.remove("on"); });
        c.classList.add("on");
        elAmount.value = c.dataset.amount;
        updateConversion();
      });
    });
    if (elAmount) {
      elAmount.addEventListener("input", function () {
        chips.forEach(function (x) {
          x.classList.toggle("on", x.dataset.amount === elAmount.value);
        });
        updateConversion();
      });
    }
    if (elToken) {
      elToken.addEventListener("change", updateConversion);
    }
    // rates come with donate params; fetch eagerly so the line works
    // before any wallet is connected
    getParams().then(updateConversion).catch(function () {});

    function status(kind, html) {
      elStatus.hidden = false;
      elStatus.className = "dw-status status " + kind;
      elStatus.innerHTML = html;
    }

    function setBusy(busy, label) {
      if (!elSend) return;
      elSend.disabled = busy;
      elSend.textContent = busy ? (label || "Working\u2026") : "Donate";
    }

    // ---- method chooser: wallet / card / exchange -------------------
    function showMethod(name) {
      root.querySelectorAll(".dw-method").forEach(function (b) {
        b.classList.toggle("on", b.dataset.method === name);
      });
      root.querySelectorAll(".dw-panel").forEach(function (p) {
        p.hidden = p.dataset.panel !== name;
      });
    }
    root.querySelectorAll(".dw-method").forEach(function (b) {
      b.addEventListener("click", function () { showMethod(b.dataset.method); });
    });
    // no wallet in this browser: lead with card if available, else exchange
    if (!eth()) {
      showMethod(root.querySelector('[data-panel="card"]') ? "card" : "exchange");
    }

    root.querySelectorAll(".dw-copy").forEach(function (b) {
      b.addEventListener("click", function () {
        navigator.clipboard.writeText(rfpAddress).then(function () {
          b.textContent = "Copied ✓";
          setTimeout(function () { b.textContent = "Copy"; }, 2000);
        }).catch(function () {
          status("err", "Copy failed. The address is: " + rfpAddress);
        });
      });
    });

    var cardOpen = root.querySelector(".dw-card-open");
    if (cardOpen) {
      var urlTemplate = root.dataset.onramp || "";
      cardOpen.addEventListener("click", function () {
        var amt = (elAmount && elAmount.value) ? elAmount.value : "100";
        if (urlTemplate.indexOf("{AMT}") !== -1) {
          cardOpen.href = urlTemplate.replace("{AMT}",
                                              encodeURIComponent(amt));
        }
        status("wait", "Card checkout opened in a new tab. Your donation " +
               "appears here automatically once the USDC arrives " +
               "(typically a few minutes after the purchase).");
      });
    }

    function donate() {
      if (elSend && elSend.disabled) return;  // no double-submission
      if (!/^0x[0-9a-fA-F]{40}$/.test(rfpAddress)) {
        status("err", "This RFP's donation address is not set up yet.");
        return;
      }
      if (!eth()) {
        var hasCard = !!root.querySelector('[data-panel="card"]');
        showMethod(hasCard ? "card" : "exchange");
        status("wait", hasCard
          ? "No wallet detected in this browser, so we switched you to the " +
            "card option."
          : "No wallet detected in this browser. Send any accepted token to " +
            "this RFP's address (shown here) from an exchange or another " +
            "wallet and it is counted automatically.");
        return;
      }
      var pre = account ? Promise.resolve(account)
                        : (status("wait", "Connecting wallet…"), connectWallet());
      pre.then(function () {
        var sym = elToken.value;
        var tok = params.tokens[sym];
        var isNative = tok.address === "native";
        // amounts are entered in dollars for every token; convert to token
        // quantity with the server-provided USD rate (Chainlink for ETH/EURC/
        // ZCHF, 1.0 for the dollar stables)
        var rate = (params.rates && params.rates[sym]) || 1;
        var usd = parseUsd(elAmount.value);
        if (!(usd > 0)) {
          status("err", "Enter the amount in dollars, like 100 or 49.50.");
          return;
        }
        var qtyStr = tokenQty(usd, sym);
        var base = toBaseUnits(qtyStr, tok.decimals);
        if (base === null) {
          status("err", "That amount is too small for " + sym + ".");
          return;
        }
        // balance guards (skipped when the balance is still unknown)
        var bal = balances[sym];
        if (typeof bal === "number") {
          var held = Object.keys(params.tokens).filter(function (s) {
            return (balances[s] || 0) > 0;
          });
          if (bal <= 0 && held.length === 0) {
            status("err", "This wallet holds none of the accepted tokens (" +
                   Object.keys(params.tokens).join(", ") + "). Top it up, " +
                   "switch wallets (button top right), or use the card or " +
                   "exchange options.");
            return;
          }
          if (bal <= 0) {
            status("err", "This wallet holds no " + sym + ". You do hold: " +
                   held.join(", ") + ".");
            return;
          }
          if (bal < parseFloat(qtyStr)) {
            status("err", "Not enough " + sym + ": you hold " +
                   bal.toFixed(4) + ", this donation needs " + qtyStr + ".");
            return;
          }
        }
        var preview = (rate === 1)
          ? "<b>" + qtyStr + " " + sym + "</b>"
          : "<b>" + qtyStr + " " + sym + "</b> (about $" + usd + ")";
        status("wait", "Check your wallet to approve:<br>" + preview +
               " → <b>this RFP's Safe</b> " +
               "<span class=\"m dim\">(" + short(rfpAddress) + ")</span>");
        setBusy(true, "Confirm in wallet\u2026");
        return ensureMainnet(eth()).then(function () {
          var txp = isNative
            ? { from: account, to: rfpAddress,
                value: "0x" + base.toString(16) }
            : { from: account, to: tok.address, value: "0x0",
                data: transferCalldata(rfpAddress, base) };
          return eth().request({
            method: "eth_sendTransaction", params: [txp]
          });
        }).then(function (txHash) {
          setBusy(true, "Confirming\u2026");
          status("wait", "Sent. Waiting for mainnet confirmation…<br>" +
                 "<a class=\"m\" target=\"_blank\" rel=\"noopener\" " +
                 "href=\"https://etherscan.io/tx/" + txHash + "\">" +
                 short(txHash) + "</a>");
          confirmTx(txHash, 0);
        });
      }).catch(function (e) {
        setBusy(false);
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
      if (res.status === "failed" || res.status === "error" || attempt > 50) {
        setBusy(false);
      }
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
