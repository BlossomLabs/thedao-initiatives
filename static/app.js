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
      // Providers disagree on the shape: injected wallets return "0x1",
      // WalletConnect may hand back a number or decimal string. Normalize
      // before deciding to switch, so we never ask a mainnet wallet to
      // "switch" to mainnet (some reject that request outright).
      if (parseInt(id, 16) === 1 || parseInt(id, 10) === 1) return true;
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
  function requestProviders() {
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}
  }
  requestProviders();
  // Ask again once the DOM is ready: some extensions inject their EIP-6963
  // announcer after this script first runs, and would otherwise be missed.
  // Re-announcements are de-duplicated by uuid above, so this is idempotent.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", requestProviders);
  }

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

  // Rebuild every token dropdown to exactly the set the server will accept
  // (/api/donate/params drops tokens whose USD rate can't be priced, so the
  // server-rendered <option>s can otherwise offer a token donate() then can't
  // find). Preserves the current selection when it's still valid.
  function syncTokenOptions() {
    if (!params || !params.tokens) return;
    var syms = Object.keys(params.tokens);
    if (!syms.length) return;
    document.querySelectorAll(".dw-token").forEach(function (sel) {
      var have = Array.prototype.map.call(sel.options,
        function (o) { return o.value; });
      var same = have.length === syms.length && have.every(
        function (v, i) { return v === syms[i]; });
      if (!same) {
        var cur = sel.value;
        sel.innerHTML = "";
        syms.forEach(function (s) {
          var o = document.createElement("option");
          o.value = s; o.textContent = s;
          sel.appendChild(o);
        });
        if (syms.indexOf(cur) !== -1) sel.value = cur;
      }
    });
    annotateTokenSelects();
  }

  function annotateTokenSelects() {
    document.querySelectorAll(".dw-token option").forEach(function (o) {
      var b = balances[o.value];
      o.textContent = (typeof b === "number" && b > 0)
        ? o.value + " \u2713" : o.value;
    });
    // Default each select to a token the wallet actually holds \u2014 but never
    // override a token the donor picked themselves (dw-token[data-picked]).
    document.querySelectorAll(".dw-token").forEach(function (sel) {
      if (sel.dataset.picked) return;
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

  // WalletConnect (optional): mobile wallets + extension-less desktop browsers
  // connect by QR / deep link. Enabled only when the server rendered a project
  // id on the connect button; the ~1 MB bundle is fetched lazily on first use.
  // It yields a standard EIP-1193 provider, so it flows through the very same
  // donation code and server-side verification as an injected wallet.
  var wcProjectId = (navBtn && navBtn.dataset.wcProject) || "";
  var wcSrc = (navBtn && navBtn.dataset.wcSrc) || "";
  var wcProvider = null;
  var wcBundlePromise = null;

  function wcEnabled() { return !!(wcProjectId && wcSrc); }
  function hasInjected() { return !!(providers.length || window.ethereum); }

  function loadWcBundle() {
    if (wcBundlePromise) return wcBundlePromise;
    wcBundlePromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = wcSrc;
      s.async = true;
      s.onload = function () {
        var mod = window["@walletconnect/ethereum-provider"];
        if (mod && mod.EthereumProvider) resolve(mod.EthereumProvider);
        else reject(new Error("WalletConnect unavailable"));
      };
      s.onerror = function () { reject(new Error("WalletConnect unavailable")); };
      document.head.appendChild(s);
    });
    return wcBundlePromise;
  }

  var wcInitPromise = null;
  function wcInit() {
    if (wcInitPromise) return wcInitPromise;
    wcInitPromise = loadWcBundle().then(function (EthereumProvider) {
      // IMPORTANT: do NOT pass `methods:`/`events:` here. Those set the
      // session's REQUIRED capabilities, and any wallet that doesn't declare
      // one of them (e.g. wallet_switchEthereumChain, or a "disconnect"
      // event) rejects the whole connection. The provider's defaults require
      // only eth_sendTransaction + personal_sign and put everything else in
      // the optional set, which is what maximizes wallet compatibility.
      return EthereumProvider.init({
        projectId: wcProjectId,
        chains: [1],                 // Ethereum mainnet only
        showQrModal: true,
        rpcMap: { 1: "https://ethereum-rpc.publicnode.com" },
        metadata: {
          name: "TheDAO Security Fund",
          description: "Fund Ethereum security initiatives",
          url: location.origin,
          icons: [location.origin + "/static/dao-logo.svg"]
        }
      }).then(function (provider) {
        wcProvider = provider;
        watchProvider(provider);
        provider.on("disconnect", function () {
          if (activeProvider === provider) { activeProvider = null; disconnectUi(); }
        });
        return provider;
      });
    });
    wcInitPromise.catch(function () { wcInitPromise = null; });  // allow retry
    return wcInitPromise;
  }

  var wcConnectPromise = null;  // in-flight guard: no double modal on double click
  function connectWalletConnect() {
    if (wcConnectPromise) return wcConnectPromise;
    // Params first so the widget's token list is ready when the modal returns.
    wcConnectPromise = getParams().then(wcInit).then(function (provider) {
      return provider.enable().catch(function (e) {
        // A stale or corrupt persisted session is WalletConnect's classic
        // failure mode ("nothing happens" until the user clears site data).
        // Drop the session so the NEXT attempt starts a clean pairing.
        return Promise.resolve(provider.disconnect()).catch(function () {})
          .then(function () { throw e; });
      }).then(function (accounts) {   // enable() opens the QR modal
        if (!accounts || !accounts[0]) throw new Error("no account authorized");
        activeProvider = provider;
        setConnected(accounts[0]);
      });
    });
    var clear = function () { wcConnectPromise = null; };
    wcConnectPromise.then(clear, clear);
    return wcConnectPromise;
  }

  function hasWcSession() {
    // WalletConnect v2 persists sessions under "wc@2:*" keys. Only when one
    // exists do we spend the 1 MB bundle on a silent reconnect at page load.
    try {
      for (var i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).indexOf("wc@2") === 0) return true;
      }
    } catch (e) {}
    return false;
  }

  function resetConnectBtn(e) {
    navBtn.textContent = account ? short(account) : "Connect wallet";
    if (e && e.message === "no-wallet") {
      navBtn.textContent = "No wallet found";
      setTimeout(function () {
        if (!account) navBtn.textContent = "Connect wallet";
      }, 2500);
    }
  }

  var walletMenu = null;
  function closeWalletMenu() {
    if (walletMenu) { walletMenu.remove(); walletMenu = null; }
  }

  // One menu, two modes: pick a wallet to CONNECT, or switch while connected.
  function openWalletMenu(connected) {
    closeWalletMenu();
    walletMenu = document.createElement("div");
    walletMenu.className = "wallet-menu";
    function item(label, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", function () { closeWalletMenu(); fn(); });
      walletMenu.appendChild(b);
    }
    function connectInjected() {
      navBtn.textContent = "Connecting\u2026";
      connectWallet().catch(resetConnectBtn);
    }
    providers.forEach(function (p) {
      var dot = (activeProvider === p.provider ? "\u25cf " : "");
      item(dot + p.info.name, function () {
        activeProvider = p.provider;
        if (connected) switchWallet(p.provider).catch(function () {});
        else connectInjected();
      });
    });
    if (!providers.length && window.ethereum) {
      item("Browser wallet", function () {
        if (connected) switchWallet().catch(function () {});
        else connectInjected();
      });
    }
    if (wcEnabled()) {
      var wdot = (wcProvider && activeProvider === wcProvider ? "\u25cf " : "");
      item(wdot + "WalletConnect (mobile & more)", function () {
        navBtn.textContent = "Connecting\u2026";
        connectWalletConnect().catch(resetConnectBtn);
      });
    }
    if (connected) {
      item("Switch account\u2026", function () {
        switchWallet().catch(function () {});
      });
    }
    navBtn.parentNode.appendChild(walletMenu);
    // close on the next click outside the menu
    setTimeout(function () {
      document.addEventListener("click", function onDoc(ev) {
        if (walletMenu && !walletMenu.contains(ev.target) && ev.target !== navBtn) {
          closeWalletMenu();
          document.removeEventListener("click", onDoc);
        }
      });
    }, 0);
  }

  if (navBtn) {
    navBtn.addEventListener("click", function () {
      if (walletMenu) { closeWalletMenu(); return; }  // toggle closed
      if (account && eth()) {
        // connected: offer switching only if there's more than one way in
        if (providers.length > 1 || wcEnabled()) { openWalletMenu(true); return; }
        var prev = navBtn.textContent;
        navBtn.textContent = "Choose wallet…";
        switchWallet().catch(function () { navBtn.textContent = prev; });
        return;
      }
      // not connected: show the wallet chooser whenever there's more than one
      // way in. Several injected wallets (e.g. MetaMask + Rabby) count even
      // when WalletConnect is off — otherwise we'd silently bind to whichever
      // extension won the injection race (usually Rabby) and the donor could
      // never pick MetaMask. With a single option, connect it directly.
      var injected = providers.length || (window.ethereum ? 1 : 0);
      var options = injected + (wcEnabled() ? 1 : 0);
      if (options > 1) { openWalletMenu(false); return; }
      navBtn.textContent = "Connecting…";
      if (!injected && wcEnabled()) {
        connectWalletConnect().catch(resetConnectBtn);
        return;
      }
      connectWallet().catch(resetConnectBtn);
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
      } else if (wcEnabled() && hasWcSession()) {
        // A WalletConnect session survives reloads (persisted by the SDK).
        // Restore it silently so returning donors see themselves connected;
        // init() never opens the modal, it only resumes the stored session.
        wcInit().then(function (provider) {
          var a = provider.session && provider.accounts;
          if (a && a[0] && !account) {
            activeProvider = provider;
            getParams().then(function () { setConnected(a[0]); })
              .catch(function () {});
          }
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

  // ------------------------------------------------------------ celebration
  // Confetti + a short synthesized "you're a hero" fanfare on confirmed
  // donations. The AudioContext is created during the donor's click (armAudio)
  // because browsers only allow sound that originates from a user gesture.
  var audioCtx = null;

  function armAudio() {
    try {
      audioCtx = audioCtx ||
        new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }

  function heroFanfare() {
    if (!audioCtx) return;
    try {
      var t0 = audioCtx.currentTime + 0.05;
      // C5 E5 G5 C6: a snappy rising ta-da-da-DAA, about 0.7 seconds
      var notes = [[523.25, 0.00, 0.11], [659.25, 0.09, 0.11],
                   [783.99, 0.18, 0.14], [1046.50, 0.28, 0.42]];
      notes.forEach(function (n) {
        [["triangle", n[0], 0.22], ["square", n[0] / 2, 0.05]].forEach(
          function (voice) {
            var o = audioCtx.createOscillator();
            var g = audioCtx.createGain();
            o.type = voice[0];
            o.frequency.value = voice[1];
            g.gain.setValueAtTime(0.0001, t0 + n[1]);
            g.gain.exponentialRampToValueAtTime(voice[2], t0 + n[1] + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(t0 + n[1]);
            o.stop(t0 + n[1] + n[2] + 0.05);
          });
      });
    } catch (e) {}
  }

  function confettiBurst() {
    try {
      var c = document.createElement("canvas");
      var W = window.innerWidth, H = window.innerHeight;
      c.width = W; c.height = H;
      c.style.cssText = "position:fixed;inset:0;z-index:100;pointer-events:none";
      document.body.appendChild(c);
      var ctx = c.getContext("2d");
      var colors = ["#ff3b38", "#00ff88", "#5ac8fa", "#f0b429", "#ffffff", "#5cb75a"];
      var parts = [];
      for (var i = 0; i < 160; i++) {
        parts.push({
          x: W / 2 + (Math.random() - 0.5) * W * 0.3,
          y: H * 0.4,
          vx: (Math.random() - 0.5) * 16,
          vy: -(Math.random() * 14 + 6),
          w: 5 + Math.random() * 6,
          h: 8 + Math.random() * 8,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[i % colors.length]
        });
      }
      var frame = 0;
      (function tick() {
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = frame < 140 ? 1 : Math.max(0, 1 - (frame - 140) / 40);
        parts.forEach(function (p) {
          p.vy += 0.35;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        });
        frame++;
        if (frame < 180) requestAnimationFrame(tick);
        else c.remove();
      })();
    } catch (e) {}
  }

  function celebrate() {
    confettiBurst();
    heroFanfare();
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
      elToken.addEventListener("change", function () {
        elToken.dataset.picked = "1";  // stop auto-default from overriding
        updateConversion();
      });
    }
    // rates come with donate params; fetch eagerly so the line works
    // before any wallet is connected
    getParams().then(function () {
      syncTokenOptions();  // match dropdown to what the server accepts
      updateConversion();
    }).catch(function () {});

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
        var on = b.dataset.method === name;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      root.querySelectorAll(".dw-panel").forEach(function (p) {
        p.hidden = p.dataset.panel !== name;
      });
    }
    root.querySelectorAll(".dw-method").forEach(function (b) {
      b.addEventListener("click", function () { showMethod(b.dataset.method); });
    });
    // No wallet in this browser: lead with card if available, else exchange —
    // unless WalletConnect is enabled, in which case the wallet tab still
    // works (Donate opens the QR modal), so it stays the default.
    if (!eth() && !wcEnabled()) {
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
      armAudio();
      if (!/^0x[0-9a-fA-F]{40}$/.test(rfpAddress)) {
        status("err", "This RFP's donation address is not set up yet.");
        return;
      }
      if (!eth()) {
        // No injected wallet. WalletConnect (when enabled) IS the wallet path
        // for these donors — especially phones — so offer it before falling
        // back to the card/exchange tabs, and resume this donation once the
        // wallet is connected.
        if (wcEnabled()) {
          status("wait", "Opening WalletConnect… scan the QR with your " +
                 "phone's wallet (or approve in the wallet app).");
          setBusy(true, "Connecting…");
          connectWalletConnect().then(function () {
            setBusy(false);
            donate();  // account is set now; runs the normal wallet flow
          }).catch(function (e) {
            setBusy(false);
            status("err", "Not connected: " + msg(e));
          });
          return;
        }
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
        if (!tok) {
          // dropdown offered a token the server won't price right now
          syncTokenOptions();
          status("err", "That token isn't available to donate right now. " +
                 "Pick another from the list.");
          return;
        }
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
        // Enforce the server's minimums up front, so we never let a donor pay
        // gas for a transfer the server will reject as dust (ERC-20: ≥ 1 whole
        // token; native ETH: ≥ min_eth). Amounts are in dollars, so the floor
        // shows as its dollar cost for the chosen token.
        var qtyNum = parseFloat(qtyStr);
        if (isNative) {
          var minEth = (params.min_eth != null) ? params.min_eth : 0.0005;
          if (qtyNum < minEth) {
            status("err", "That is below the minimum ETH donation (" +
                   minEth + " ETH, about $" + (minEth * rate).toFixed(2) +
                   "). Enter a larger amount.");
            return;
          }
        } else if (qtyNum < (params.min_token_units || 1)) {
          status("err", "The minimum donation is 1 " + sym + " (about $" +
                 rate.toFixed(2) + "). Enter a larger amount.");
          return;
        }
        // balance guards (only assert what we actually know — a null balance
        // is still loading, not zero, so it must not read as "you hold none")
        var bal = balances[sym];
        if (typeof bal === "number" && bal <= 0) {
          var held = Object.keys(params.tokens).filter(function (s) {
            return (balances[s] || 0) > 0;
          });
          var stillChecking = Object.keys(params.tokens).some(function (s) {
            return balances[s] == null;  // null/undefined = not yet fetched
          });
          if (held.length) {
            status("err", "This wallet holds no " + sym + ". You do hold: " +
                   held.join(", ") + ".");
          } else if (stillChecking) {
            status("err", "This wallet holds no " + sym + " — still checking " +
                   "your other balances. Try another token from the list.");
          } else {
            status("err", "This wallet holds none of the accepted tokens (" +
                   Object.keys(params.tokens).join(", ") + "). Top it up, " +
                   "switch wallets (button top right), or use the card or " +
                   "exchange options.");
          }
          return;
        }
        if (typeof bal === "number" && bal < parseFloat(qtyStr)) {
          status("err", "Not enough " + sym + ": you hold " +
                 bal.toFixed(4) + ", this donation needs " + qtyStr + ".");
          return;
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
        // Show the token quantity in parens only when it isn't a 1:1 dollar
        // stable (rate != 1), so USDC reads "$100.00 in USDC" while ETH reads
        // "$100.00 (0.032 ETH)". Driven off the live rate, not a token list.
        var rate = params && params.rates && params.rates[res.token];
        var amt;
        if (res.amount_usd) {
          var dollars = "$" + Number(res.amount_usd).toFixed(2);
          amt = (rate && rate !== 1)
            ? dollars + " (" + res.amount + " " + res.token + ")"
            : dollars + " in " + res.token;
        } else {
          amt = res.amount + " " + res.token;
        }
        status("ok", "🦸 <b>" + amt + "</b> is now backing this RFP. " +
               "You're a hero. Refreshing…");
        celebrate();
        setTimeout(function () { window.location.reload(); }, 4000);
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
        armAudio();
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

  // ------------------------------------------------------------ ENS everywhere
  // Server-rendered addresses carry class="ens-addr" data-addr="0x…"; upgrade
  // them to primary ENS names asynchronously (server endpoint caches lookups).
  (function () {
    var els = document.querySelectorAll(".ens-addr[data-addr]");
    if (!els.length) return;
    var byAddr = {};
    els.forEach(function (el) {
      var a = (el.dataset.addr || "").toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(a)) (byAddr[a] = byAddr[a] || []).push(el);
    });
    Object.keys(byAddr).forEach(function (a) {
      fetch("/api/ens-name/" + a)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.name) byAddr[a].forEach(function (el) {
            el.textContent = d.name;
            el.title = a;
          });
        }).catch(function () {});
    });
  })();

  // ------------------------------------------------------------ hero counter
  var hero = document.getElementById("hero-raised");
  if (hero) {
    var target = parseFloat(hero.dataset.target || "0");
    var t0 = null;
    var dur = 1300;
    function fmt(v) {
      return "$" + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    // Screen readers announce the final total (not the mid-animation numbers).
    hero.setAttribute("aria-label", fmt(target) + " raised");
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      hero.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    if (target > 0) requestAnimationFrame(step); else hero.textContent = "$0";
  }

  // ------------------------------------------------------------ AI search
  // Describe what you want to fund; the server's LLM ranks the open RFPs and
  // the browser moves the best matches to the top of the grid. Local pins
  // only: nothing is stored, "show all" restores the normal board order.
  (function () {
    var form = document.getElementById("ai-search");
    var grid = document.querySelector(".rfp-grid");
    if (!form || !grid) return;
    var input = document.getElementById("ai-search-q");
    var note = document.getElementById("ai-search-note");
    var btn = form.querySelector("button");
    var originalOrder = Array.prototype.slice.call(grid.children);
    var idleLabel = btn.textContent;
    var busy = false;

    function say(html) { note.hidden = false; note.innerHTML = html; }

    function clearMatches() {
      grid.querySelectorAll(".ai-badge").forEach(function (b) { b.remove(); });
      originalOrder.forEach(function (card) {
        card.classList.remove("ai-top");
        grid.appendChild(card);  // re-append in saved order
      });
      note.hidden = true;
      input.value = "";
    }

    function applyMatches(ids) {
      grid.querySelectorAll(".ai-badge").forEach(function (b) { b.remove(); });
      originalOrder.forEach(function (c) { c.classList.remove("ai-top"); });
      var cards = ids.map(function (id) {
        return grid.querySelector('.rfp-card[data-rfp-id="' + id + '"]');
      }).filter(Boolean);
      for (var i = cards.length - 1; i >= 0; i--) {
        var badge = document.createElement("span");
        badge.className = "ai-badge";
        badge.textContent = cards.length > 1
          ? "Match #" + (i + 1) : "Best match";
        cards[i].classList.add("ai-top");
        cards[i].insertBefore(badge, cards[i].firstChild);
        grid.insertBefore(cards[i], grid.firstChild);
      }
      say("Your best match" + (cards.length > 1 ? "es are" : " is") +
          " on top. <button type=\"button\" class=\"linklike\" " +
          "id=\"ai-search-clear\">Show normal order</button>");
      var clear = document.getElementById("ai-search-clear");
      if (clear) clear.addEventListener("click", clearMatches);
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      var q = input.value.trim();
      if (q.length < 3) {
        say("Describe what you'd like to fund — a few words is plenty.");
        return;
      }
      busy = true;
      btn.disabled = true;
      btn.textContent = "Matching…";
      fetch("/api/ai-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q })
      }).then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.error) { say(res.error); return; }
          if (!res.matches || !res.matches.length) {
            say("No strong matches for that — but every RFP below funds " +
                "Ethereum security, so browse away.");
            return;
          }
          applyMatches(res.matches);
        })
        .catch(function () { say("Search is unavailable right now."); })
        .then(function () {
          busy = false;
          btn.disabled = false;
          btn.textContent = idleLabel;
        });
    });
  })();
})();
