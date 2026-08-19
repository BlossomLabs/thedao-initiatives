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
  var nickname = null;   // registered display name for the connected wallet
  var myPfp = "";        // connected wallet's pfp value ("" = default)
  var ensCache = {};     // addr(lower) -> primary ENS name ("" = none)
  var paramsPromise = null;

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "Request failed.");
        return d;
      });
    });
  }
  // Render the connected identity into the nav button: avatar + name.
  function setNav(name) {
    if (!navBtn) return;
    navBtn.textContent = "";
    if (account) navBtn.appendChild(window.rfpsAvatar(account, myPfp, 20));
    navBtn.appendChild(document.createTextNode(name || ""));
  }

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
  // Tiny element helper (createElement + class + text), used by the nickname
  // modal. Mirrors the one in comments.js.
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

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
      })) { providers.push(d); tryRestore(false); }  // resume a prior explicit choice
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

  // Remember the wallet the donor explicitly chose, so a returning donor is
  // reconnected to THAT wallet instead of being re-prompted or silently bound
  // to whichever extension won the injection race. rdns is stable across
  // sessions; the EIP-6963 uuid is not, so never persist the uuid.
  function walletKey(info) { return (info && (info.rdns || info.name)) || ""; }
  function rememberWallet(info) {
    try { localStorage.setItem("thedao:wallet", walletKey(info)); } catch (e) {}
  }
  function forgetWallet() { try { localStorage.removeItem("thedao:wallet"); } catch (e) {} }
  function savedWalletId() {
    try { return localStorage.getItem("thedao:wallet") || ""; } catch (e) { return ""; }
  }
  function providerById(id) {
    if (!id) return null;
    for (var i = 0; i < providers.length; i++) {
      if (walletKey(providers[i].info) === id) return providers[i];
    }
    return null;
  }
  // Persist whichever announced wallet this provider object belongs to, so any
  // connect path (chooser, single-wallet auto-connect, Donate) is remembered.
  function rememberProvider(prov) {
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].provider === prov) { rememberWallet(providers[i].info); return; }
    }
  }

  // Silently reconnect on load — but ONLY to a wallet the donor chose before
  // We only ever silently reconnect to a wallet the donor EXPLICITLY chose
  // before (persisted on every successful connect). With no saved choice we
  // stay disconnected — so the first connect shows the chooser, we never
  // default to whoever won the injection race, and an explicit Disconnect
  // (which clears the saved choice) actually sticks across reloads.
  // allowSingle only gates the WalletConnect session resume (settled-DOM pass).
  function tryRestore(allowSingle) {
    if (account) return;
    var saved = providerById(savedWalletId());
    if (saved && saved.provider && saved.provider.request) {
      activeProvider = saved.provider;
      watchProvider(saved.provider);
      saved.provider.request({ method: "eth_accounts" }).then(function (a) {
        if (a && a[0] && !account) {
          getParams().then(function () { setConnected(a[0]); }).catch(function () {});
        } else if (activeProvider === saved.provider && !account) {
          activeProvider = null;  // saved wallet no longer authorized; don't pin it
        }
      }).catch(function () {
        if (activeProvider === saved.provider && !account) activeProvider = null;
      });
      return;
    }
    if (allowSingle && wcEnabled() && hasWcSession()) {
      // A WalletConnect session survives reloads (persisted by the SDK); resume
      // it silently — init() only resumes the stored session, never opens a modal.
      wcInit().then(function (provider) {
        var a = provider.session && provider.accounts;
        if (a && a[0] && !account) {
          activeProvider = provider;
          getParams().then(function () { setConnected(a[0]); }).catch(function () {});
        }
      }).catch(function () {});
    }
  }

  function disconnectUi() {
    account = null;
    nickname = null;
    balances = {};
    try { document.dispatchEvent(new CustomEvent("rfps:wallet", { detail: { account: null } })); } catch (e) {}
    forgetWallet();
    if (navBtn) {
      navBtn.textContent = "Connect wallet";
      navBtn.classList.remove("connected");
      navBtn.title = "";
    }
    annotateTokenSelects();
  }

  function disconnectWallet() {
    closeWalletMenu();
    var p = activeProvider;
    if (p && p === wcProvider) {
      // WalletConnect: actually tear the session down (also clears wc@2 storage).
      try { Promise.resolve(wcProvider.disconnect()).catch(function () {}); } catch (e) {}
    } else if (p && typeof p.request === "function") {
      // Injected wallets have no reliable programmatic disconnect; best-effort
      // revoke where supported (MetaMask), then drop our local connection.
      try {
        p.request({ method: "wallet_revokePermissions",
                    params: [{ eth_accounts: {} }] }).catch(function () {});
      } catch (e) {}
    }
    activeProvider = null;
    disconnectUi();  // clears account/balances, forgets the saved choice, resets the button
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
    nickname = null;
    try { document.dispatchEvent(new CustomEvent("rfps:wallet", { detail: { account: acct } })); } catch (e) {}
    if (navBtn) {
      navBtn.textContent = short(acct);
      navBtn.classList.add("connected");
      navBtn.title = "Connected. Click to switch wallets.";
      resolveIdentity(acct);
    }
    document.querySelectorAll("[data-donate]").forEach(function (el) {
      var b = el.querySelector(".dw-send");
      if (b) b.textContent = "Donate";
    });
    refreshBalances();
  }

  // -------- identity: nickname > ENS > short address ----------------------
  // On connect, show the wallet's chosen name. A registered nickname wins;
  // otherwise the primary ENS name; otherwise the shortened 0x address.
  function resolveIdentity(acct) {
    if (!acct) return;
    var low = acct.toLowerCase();
    myPfp = "";
    setNav(short(acct));   // default avatar + short address right away
    fetch("/api/nickname/" + acct).then(function (r) { return r.json(); })
      .then(function (d) {
        if (account !== acct) return;
        nickname = d.nickname || null;
        myPfp = d.pfp || "";
        setNav(nickname || short(acct));
        if (nickname) return;   // registered nickname wins; nothing else to do
        // No registered nickname: auto-detect the wallet's primary ENS / web3
        // name and display it. Never pop a prompt on connect (Griff: don't
        // force a name until someone engages, and skip the flow entirely if
        // they already have a primary name). Picking a nickname stays opt-in
        // via the wallet menu, and the composer takes a name at comment time.
        fetch("/api/ens-name/" + acct).then(function (r) { return r.json(); })
          .then(function (e) {
            if (account !== acct) return;
            ensCache[low] = e.name || "";
            if (e.name && !nickname) setNav(e.name);
          }).catch(function () {});
      }).catch(function () {});
  }

  function signNickname(nick) {
    return signProfile("nickname", nick);
  }
  // Generic wallet signature for a profile action (nickname / pfp). The signed
  // message matches the server's _sig_message(action, "", content, ts).
  function signProfile(action, content) {
    var p = eth();
    if (!p || !account) return Promise.reject(new Error("Connect a wallet first."));
    var ts = Math.floor(Date.now() / 1000);
    var msg = "TheDAO Security Fund\naction:" + action + "\ninitiative:\ncontent:" +
      content + "\nts:" + ts;
    return p.request({ method: "personal_sign", params: [msg, account] })
      .then(function (sig) { return { signature: sig, ts: ts }; });
  }

  // ---- Avatars: 10 gradient presets + a deterministic default per address --
  var PFP_COLORS = [
    ["#5cb75a", "#00ff88"], ["#2c5e86", "#5ac8fa"], ["#ff3b38", "#ffb03a"],
    ["#a06cff", "#5ac8fa"], ["#ff6ec7", "#ffb03a"], ["#00d2b8", "#5cb75a"],
    ["#ffcf3a", "#ff6b3a"], ["#6d8cff", "#a06cff"], ["#3ad1ff", "#2c5e86"],
    ["#ff8a5c", "#ff3b6b"]
  ];
  var PFP_GLYPHS = [
    '<circle cx="20" cy="20" r="8" fill="#fff" opacity=".85"/>',
    '<path d="M20 12 L28 28 L12 28 Z" fill="#fff" opacity=".85"/>',
    '<circle cx="20" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>',
    '<rect x="13" y="13" width="4" height="14" fill="#fff" opacity=".85"/><rect x="19" y="13" width="4" height="14" fill="#fff" opacity=".85"/><rect x="25" y="13" width="4" height="14" fill="#fff" opacity=".85"/>',
    '<path d="M20 11 L29 20 L20 29 L11 20 Z" fill="#fff" opacity=".85"/>',
    '<circle cx="15" cy="15" r="3" fill="#fff" opacity=".85"/><circle cx="25" cy="15" r="3" fill="#fff" opacity=".85"/><circle cx="15" cy="25" r="3" fill="#fff" opacity=".85"/><circle cx="25" cy="25" r="3" fill="#fff" opacity=".85"/>',
    '<path d="M11 22 Q15 15 20 22 T29 22" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>',
    '<path d="M20 11 L22.5 17 L29 17.5 L24 22 L25.5 28.5 L20 25 L14.5 28.5 L16 22 L11 17.5 L17.5 17 Z" fill="#fff" opacity=".85"/>',
    '<path d="M20 11 L28 15.5 L28 24.5 L20 29 L12 24.5 L12 15.5 Z" fill="#fff" opacity=".85"/>',
    '<rect x="17" y="12" width="6" height="16" fill="#fff" opacity=".85"/><rect x="12" y="17" width="16" height="6" fill="#fff" opacity=".85"/>'
  ];
  function presetSvg(i) {
    var c = PFP_COLORS[i] || PFP_COLORS[0];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/>' +
      '</linearGradient></defs><rect width="40" height="40" rx="20" fill="url(#g)"/>' +
      (PFP_GLYPHS[i] || "") + '</svg>';
  }
  function presetUri(i) { return "data:image/svg+xml," + encodeURIComponent(presetSvg(i)); }
  function addrHash(a) {
    var h = 5381, s = (a || "").toLowerCase();
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function pfpDefaultIndex(address) { return addrHash(address) % 10; }
  // Public: build an <img> avatar for an address given its pfp value ("" =
  // default from the address, "preset:N", or "upload:<file>").
  function avatarSrc(address, pfp) {
    if (pfp && pfp.indexOf("upload:") === 0) return "/uploads/pfp/" + pfp.slice(7);
    if (pfp && pfp.indexOf("preset:") === 0) return presetUri(parseInt(pfp.slice(7), 10) || 0);
    return presetUri(pfpDefaultIndex(address));
  }
  window.rfpsAvatar = function (address, pfp, size) {
    var img = document.createElement("img");
    img.className = "pfp"; img.alt = "";
    img.width = img.height = size || 26;
    img.src = avatarSrc(address, pfp);
    return img;
  };
  window.rfpsAvatarSrc = avatarSrc;
  window.rfpsPresetUri = presetUri;

  var nickOverlay = null;
  function closeNicknameModal() {
    if (nickOverlay) { nickOverlay.remove(); nickOverlay = null; }
  }
  function openNicknameModal(firstTime, prefill) {
    closeNicknameModal();
    closeWalletMenu();
    nickOverlay = document.createElement("div");
    nickOverlay.className = "nick-overlay";
    var box = document.createElement("div");
    box.className = "nick-modal";
    var stagedPfp = null;   // selected preset value, or null = unchanged
    var h = document.createElement("h3");
    h.textContent = firstTime ? "Set up your profile" : "Edit your profile";
    var p = document.createElement("p");
    p.textContent = "Shown on your posts instead of your address. A name ending " +
      "like .eth only works if your wallet owns it; a plain name just has to be free.";
    var input = document.createElement("input");
    input.maxLength = 40;
    input.placeholder = "Nickname, e.g. vitalik (optional)";
    input.value = prefill || "";

    var pfpLabel = document.createElement("p");
    pfpLabel.className = "nick-sub";
    pfpLabel.textContent = "Profile picture";
    var grid = document.createElement("div");
    grid.className = "pfp-grid";
    var chosenBtn = null;
    for (var gi = 0; gi < 10; gi++) (function (idx) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "pfp-opt";
      var im = document.createElement("img");
      im.src = window.rfpsPresetUri(idx); im.width = im.height = 40; im.alt = "";
      b.appendChild(im);
      b.addEventListener("click", function () {
        if (chosenBtn) chosenBtn.classList.remove("on");
        b.classList.add("on"); chosenBtn = b; stagedPfp = "preset:" + idx;
      });
      grid.appendChild(b);
    })(gi);

    // custom upload
    var upWrap = el("div", "pfp-up");
    var upBtn = el("button", "btn sm", "Upload your own");
    upBtn.type = "button";
    var fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "image/png,image/jpeg,image/webp";
    fileIn.className = "qa-hp";   // visually hidden; opened via the button
    // Preview of the picked image (data: URI, CSP-safe) so you see what you
    // uploaded. blob: URLs are blocked by the CSP, so use a FileReader.
    var upPreview = document.createElement("img");
    upPreview.className = "pfp-preview"; upPreview.alt = ""; upPreview.hidden = true;
    upBtn.addEventListener("click", function () { fileIn.click(); });
    fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { upPreview.src = reader.result; upPreview.hidden = false; };
      reader.readAsDataURL(f);
      err.textContent = ""; upBtn.disabled = true; upBtn.textContent = "Sign in wallet…";
      signProfile("pfp-upload", "upload").then(function (s) {
        var fd = new FormData();
        fd.append("image", f);
        fd.append("signature", s.signature);
        fd.append("ts", s.ts);
        return fetch("/api/pfp/upload", { method: "POST", body: fd });
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || "Upload failed.");
          return d;
        });
      }).then(function (d) {
        myPfp = d.pfp; stagedPfp = null;
        if (chosenBtn) { chosenBtn.classList.remove("on"); chosenBtn = null; }
        upBtn.disabled = false; upBtn.textContent = "Uploaded ✓";
      }).catch(function (e) {
        upBtn.disabled = false; upBtn.textContent = "Upload your own";
        err.textContent = e.message;
      });
    });
    upWrap.appendChild(upBtn); upWrap.appendChild(fileIn); upWrap.appendChild(upPreview);

    var err = document.createElement("p");
    err.className = "nick-err";
    var row = document.createElement("div");
    row.className = "nick-row";
    var save = document.createElement("button");
    save.className = "btn primary"; save.type = "button"; save.textContent = "Save";
    var skip = document.createElement("button");
    skip.className = "btn"; skip.type = "button";
    skip.textContent = firstTime ? "Not now" : "Cancel";
    skip.addEventListener("click", closeNicknameModal);
    save.addEventListener("click", function () {
      var nick = input.value.trim();
      if (!nick && !stagedPfp) { closeNicknameModal(); return; }
      save.disabled = true; err.textContent = ""; save.textContent = "Sign in wallet…";
      var seq = Promise.resolve();
      if (nick) {
        seq = seq.then(function () {
          return signProfile("nickname", nick).then(function (s) {
            return postJson("/api/nickname",
              { nickname: nick, signature: s.signature, ts: s.ts });
          }).then(function (d) { nickname = d.nickname; });
        });
      }
      if (stagedPfp) {
        seq = seq.then(function () {
          return signProfile("pfp", stagedPfp).then(function (s) {
            return postJson("/api/pfp",
              { pfp: stagedPfp, signature: s.signature, ts: s.ts });
          }).then(function (d) { myPfp = d.pfp; });
        });
      }
      seq.then(function () {
        setNav(nickname || (account ? short(account) : ""));
        try {
          document.dispatchEvent(new CustomEvent("rfps:wallet",
            { detail: { account: account } }));
        } catch (e) {}
        closeNicknameModal();
      }).catch(function (e) {
        save.disabled = false; save.textContent = "Save";
        err.textContent = e.message || "Could not save.";
      });
    });
    row.appendChild(save); row.appendChild(skip);
    box.appendChild(h); box.appendChild(p); box.appendChild(input);
    box.appendChild(pfpLabel); box.appendChild(grid); box.appendChild(upWrap);
    box.appendChild(err); box.appendChild(row);
    nickOverlay.appendChild(box);
    nickOverlay.addEventListener("click", function (ev) {
      if (ev.target === nickOverlay && !firstTime) closeNicknameModal();
    });
    document.body.appendChild(nickOverlay);
    input.focus();
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
        rememberProvider(p);  // remember so a returning donor reconnects to this wallet
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

  // WalletConnect brand glyph for the picker. A data: URI keeps it inside the
  // strict CSP (img-src allows data:); injected wallets bring their own icons
  // via the EIP-6963 announcement.
  var WC_ICON = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<rect width="40" height="40" rx="11" fill="#3396ff"/>' +
    '<path d="M12 16.5c4.4-4.3 11.6-4.3 16 0l.6.6-2.2 2.1-.5-.5c-3.1-3-8-3-11.1 0' +
    'l-.6.5-2.2-2.1zM8.6 20l2.1 2.1 3.9 3.8c1.8 1.7 4.9 1.7 6.7 0l3.9-3.8 2.1-2.1' +
    ' 2.2 2.1-2.2 2.2-3.9 3.8c-3 2.9-8 2.9-11 0l-3.9-3.8L6.4 22.1z" fill="#fff"/></svg>'
  );

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
    forgetWallet();  // switching to WC; its own session persistence takes over
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
    navBtn.textContent = account ? (nickname || short(account)) : "Connect wallet";
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
  // onConnected (connect mode only) runs once a wallet is connected, so a
  // caller like the Donate button can resume what the donor was doing.
  // Small monochrome glyphs (data: URIs, CSP-safe) for menu rows with no wallet
  // logo of their own, so they never render as a broken image box.
  function wmGlyph(inner, color) {
    return "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="' + (color || "#b8c4d0") + '" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>");
  }
  var WM_SWITCH = wmGlyph('<path d="M7 4 3 8l4 4"/><path d="M3 8h12a4 4 0 0 1 4 4"/>' +
    '<path d="M17 20l4-4-4-4"/><path d="M21 16H9a4 4 0 0 1-4-4"/>');
  var WM_EDIT = wmGlyph('<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M14 6l4 4"/>');
  var WM_POWER = wmGlyph('<path d="M12 3v9"/><path d="M6.5 7.5a8 8 0 1 0 11 0"/>', "#ff9a9a");

  function openWalletMenu(connected, onConnected) {
    closeWalletMenu();
    walletMenu = document.createElement("div");
    walletMenu.className = "wallet-menu";
    function item(label, fn, opts) {
      opts = opts || {};
      var b = document.createElement("button");
      b.type = "button";
      if (opts.active) b.classList.add("active");
      if (opts.klass) b.classList.add(opts.klass);
      // data: URIs (EIP-6963 wallet icons, WC glyph, our menu glyphs) pass
      // img-src. No icon: reserve the slot with a span, never a broken <img>.
      if (opts.icon) {
        var ic = document.createElement("img");
        ic.className = "wm-icon"; ic.alt = "";
        ic.src = opts.icon;
        b.appendChild(ic);
      } else {
        var ph = document.createElement("span");
        ph.className = "wm-icon wm-icon-ph";
        b.appendChild(ph);
      }
      var nm = document.createElement("span");
      nm.className = "wm-name";
      nm.textContent = label;
      b.appendChild(nm);
      b.addEventListener("click", function () { closeWalletMenu(); fn(); });
      walletMenu.appendChild(b);
    }
    function connectInjected() {
      navBtn.textContent = "Connecting\u2026";
      var pr = connectWallet();
      if (onConnected) pr = pr.then(function () { onConnected(); });
      pr.catch(resetConnectBtn);
    }
    providers.forEach(function (p) {
      item(p.info.name, function () {
        activeProvider = p.provider;
        rememberWallet(p.info);  // remember this explicit choice for next time
        if (connected) switchWallet(p.provider).catch(function () {});
        else connectInjected();
      }, { icon: p.info.icon, active: activeProvider === p.provider });
    });
    if (!providers.length && window.ethereum) {
      item("Browser wallet", function () {
        if (connected) switchWallet().catch(function () {});
        else connectInjected();
      });
    }
    if (wcEnabled()) {
      item("WalletConnect (mobile & more)", function () {
        navBtn.textContent = "Connecting\u2026";
        var pr = connectWalletConnect();
        if (onConnected && !connected) pr = pr.then(function () { onConnected(); });
        pr.catch(resetConnectBtn);
      }, { icon: WC_ICON, active: !!(wcProvider && activeProvider === wcProvider) });
    }
    if (connected) {
      item("Switch account\u2026", function () {
        switchWallet().catch(function () {});
      }, { klass: "wm-sep", icon: WM_SWITCH });
      item("Change nickname", function () {
        openNicknameModal(false, nickname || "");
      }, { icon: WM_EDIT });
      item("Disconnect", function () { disconnectWallet(); },
        { klass: "wm-danger", icon: WM_POWER });
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
        // connected: open the menu (switch wallet / switch account / disconnect)
        openWalletMenu(true);
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
    // reflect a previously-chosen wallet without prompting (once 6963
    // announcements settle); tryRestore(false) also runs as each wallet announces
    setTimeout(function () { tryRestore(true); }, 300);
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
        status("err", "This initiative's donation address is not set up yet.");
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
            "this initiative's address (shown here) from an exchange or another " +
            "wallet and it is counted automatically.");
        return;
      }
      if (!account) {
        // Not connected yet. If there's more than one way in (several injected
        // wallets, or an injected wallet plus WalletConnect), let the donor
        // pick instead of silently grabbing whichever extension won the
        // injection race — then resume this donation once they connect.
        var injected = providers.length || (window.ethereum ? 1 : 0);
        var options = injected + (wcEnabled() ? 1 : 0);
        if (options > 1) { openWalletMenu(false, donate); return; }
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
               " → <b>this initiative's Safe</b> " +
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
        status("ok", "🦸 <b>" + amt + "</b> is now backing this initiative. " +
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
            say("No strong matches for that — but every initiative below funds " +
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

  // Minimal bridge for comments.js (community Q&A): read the connected
  // account, get the active provider for personal_sign, and run the same
  // connect flow the navbar button uses (chooser included).
  window.rfpsWallet = {
    account: function () { return account; },
    provider: function () { return activeProvider || eth(); },
    connect: function (onConnected) {
      if (account && eth()) { if (onConnected) onConnected(); return; }
      var injected = providers.length || (window.ethereum ? 1 : 0);
      var options = injected + (wcEnabled() ? 1 : 0);
      if (options > 1) { openWalletMenu(false, onConnected); return; }
      if (!injected && wcEnabled()) {
        var pr = connectWalletConnect();
        if (onConnected) pr = pr.then(function () { onConnected(); });
        pr.catch(resetConnectBtn);
        return;
      }
      var pr2 = connectWallet();
      if (onConnected) pr2 = pr2.then(function () { onConnected(); });
      pr2.catch(resetConnectBtn);
    },
  };

  // Wallet-gated admin sign-in (only present on the /admin login page). Connect,
  // sign the admin-login message, hand the signature to the server for an admin
  // session. The server checks the signer is in ADMIN_ADDRESSES.
  var adminLoginBtn = document.getElementById("admin-wallet-login");
  if (adminLoginBtn) {
    var adminNote = document.getElementById("admin-wallet-note");
    var setNote = function (m) { if (adminNote) adminNote.textContent = m; };
    var doAdminSign = function () {
      setNote("Check your wallet to sign...");
      signProfile("admin-login", "").then(function (s) {
        return postJson("/admin/login-wallet", { signature: s.signature, ts: s.ts });
      }).then(function () {
        window.location.href = "/admin/dashboard";
      }).catch(function (e) { setNote((e && e.message) || "Sign-in failed."); });
    };
    adminLoginBtn.addEventListener("click", function () {
      if (account) { doAdminSign(); return; }
      setNote("Connecting wallet...");
      window.rfpsWallet.connect(function () {
        if (window.rfpsWallet.account()) doAdminSign();
        else setNote("Connect a wallet to continue.");
      });
    });
  }
})();
