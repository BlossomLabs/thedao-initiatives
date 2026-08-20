// Community Questions & Suggestions (SPEC-community-qa v1).
// CSP-safe: no inline handlers, no external requests, all user text rendered
// via textContent so bodies stay plain text and URLs stay dead (spec §0.4).
(function () {
  "use strict";
  var root = document.getElementById("qa");
  if (!root) return;

  var slug = root.dataset.slug;
  var isOpen = root.dataset.open === "1";
  var isAdmin = root.dataset.admin === "1";
  var csrf = root.dataset.csrf || "";
  var PAGE = 20;

  var state = {
    entries: [], canVote: false, roles: [], filter: "all", shown: PAGE,
    account: null, sort: "top",
  };

  var listEl = document.getElementById("qa-list");
  var emptyEl = document.getElementById("qa-empty");
  var countEl = document.getElementById("qa-count");
  var moreBtn = document.getElementById("qa-more");
  var filtersEl = document.getElementById("qa-filters");
  var composerEl = document.getElementById("qa-composer");
  var sortBar = null;

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function sha256hex(text) {
    var buf = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", buf).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  function sigMessage(action, content, ts) {
    return "TheDAO Security Fund\naction:" + action + "\ninitiative:" + slug +
      "\ncontent:" + content + "\nts:" + ts;
  }

  function signAction(action, content) {
    // The signing prompt appears only after the user acts (spec §6/§9B).
    var w = window.rfpsWallet;
    var acct = w && w.account();
    var prov = w && w.provider();
    if (!acct || !prov) return Promise.reject(new Error("no wallet"));
    var ts = Math.floor(Date.now() / 1000);
    var message = sigMessage(action, content, ts);
    return prov.request({
      method: "personal_sign", params: [message, acct],
    }).then(function (sig) { return { signature: sig, ts: ts, account: acct }; });
  }

  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "request failed");
        return d;
      });
    });
  }

  // ---- claim tokens (author-only pending view, spec §10)
  function myTokens() {
    try {
      return JSON.parse(localStorage.getItem("thedao:qa:" + slug) || "[]");
    } catch (e) { return []; }
  }
  function rememberToken(tok) {
    if (!tok) return;
    var t = myTokens();
    if (t.indexOf(tok) === -1) t.push(tok);
    try { localStorage.setItem("thedao:qa:" + slug, JSON.stringify(t.slice(-20))); } catch (e) {}
  }

  function ensName(span, addr, avatarImg) {
    // Display name for a commenter's address: registered nickname wins, then
    // the primary ENS name; otherwise the shortened 0x address already shown.
    // Also upgrades the avatar from the default to a chosen pfp if one is set.
    span.classList.add("ens-addr");
    span.dataset.addr = addr;
    fetch("/api/nickname/" + addr).then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.pfp && avatarImg && window.rfpsAvatarSrc)
          avatarImg.src = window.rfpsAvatarSrc(addr, d.pfp);
        if (d.nickname) { span.textContent = d.nickname; return; }
        fetch("/api/ens-name/" + addr).then(function (r) { return r.json(); })
          .then(function (e) { if (e.name) span.textContent = e.name; })
          .catch(function () {});
      }).catch(function () {});
  }

  function avatarFor(address, seed) {
    return window.rfpsAvatar ? window.rfpsAvatar(address || seed, "", 24)
                             : el("span");
  }

  // Role chips, priority order, at most two shown (spec §5): TheDAO team,
  // Curator, ETHSecurity Badgeholder, Donor. Roles are a per-initiative
  // snapshot from the server.
  var ROLE_TAGS = [
    ["ADMIN", "team", "TheDAO team"],
    ["CURATOR", "curator", "Curator"],
    ["EXPERT", "expert", "ETHSecurity Badgeholder"],
    ["DONOR", "donor", "Donor"]
  ];
  function roleTags(wrap, roles) {
    var shown = 0;
    ROLE_TAGS.forEach(function (t) {
      if (shown < 2 && roles.indexOf(t[0]) >= 0) {
        wrap.appendChild(el("span", "rtag " + t[1], t[2]));
        shown++;
      }
    });
  }

  function identitySpan(c) {
    var wrap = el("span", "qa-ident");
    if (c.address) {
      var av = avatarFor(c.address);   // default avatar now, upgraded by ensName
      wrap.appendChild(av);
      var a = el("span", "nick clickable", c.address.slice(0, 6) + "…" + c.address.slice(-4));
      ensName(a, c.address, av);   // upgrades label + avatar if a pfp/nick is set
      a.title = "Click to show address";
      var addrSpan = el("span", "qa-addr m");
      addrSpan.hidden = true;
      a.addEventListener("click", function () {
        addrSpan.hidden = !addrSpan.hidden;
        addrSpan.textContent = addrSpan.hidden ? "" : c.address;
      });
      wrap.appendChild(a);
      wrap.appendChild(addrSpan);
    } else {
      var label = c.roles.indexOf("ADMIN") >= 0 ? "TheDAO team"
        : (c.display_name || "Anonymous");
      wrap.appendChild(avatarFor("", label));
      wrap.appendChild(el("span", "nick qa-unverified", label));
    }
    roleTags(wrap, c.roles);
    return wrap;
  }

  var HELD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // Inline SVG icons (stroke = currentColor) for the v2 button/vote design.
  var I = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
    reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4h14l-3 4 3 4H4"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.09 4.26L19 8l-3.5 3.4L16.2 16 12 13.8 7.8 16l.7-4.6L5 8l4.91-.74z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7l2-3h11l2 3"/><circle cx="16.5" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>'
  };
  // Button with a leading inline-SVG icon and a text label. The label is always
  // a static string (never user input), so setting innerHTML for the icon is safe.
  function iconBtn(cls, icon, label) {
    var b = document.createElement("button");
    b.type = "button"; b.className = cls;
    b.innerHTML = icon + "<span>" + label + "</span>";
    return b;
  }

  // Reddit-style vote widget: up arrow, net score, down arrow. Voting is gated
  // server-side (badge holders + $20 donors); when the viewer can't vote the
  // arrows are disabled with a lock hint. Same direction clicked twice clears.
  function voteBox(c) {
    var vb = el("div", "votebox");
    var up = document.createElement("button");
    up.type = "button"; up.className = "vbtn up" + (c.myvote === 1 ? " on" : "");
    up.innerHTML = I.up; up.setAttribute("aria-label", "upvote");
    var sc = el("div", "vscore" + (c.myvote === 1 ? " active-up" : ""), String(c.votes));
    var dn = document.createElement("button");
    dn.type = "button"; dn.className = "vbtn down" + (c.myvote === -1 ? " on" : "");
    dn.innerHTML = I.down; dn.setAttribute("aria-label", "downvote");
    vb.appendChild(up); vb.appendChild(sc); vb.appendChild(dn);
    function cast(dir) {
      var word = dir === 1 ? "up" : "down";
      signAction("vote", c.id + ":" + word).then(function (s) {
        return api("/api/comments/" + c.id + "/vote",
          { dir: word, signature: s.signature, ts: s.ts });
      }).then(function (d) {
        c.votes = d.votes; c.myvote = d.myvote;
        sc.textContent = String(d.votes);
        sc.classList.toggle("active-up", d.myvote === 1);
        up.classList.toggle("on", d.myvote === 1);
        dn.classList.toggle("on", d.myvote === -1);
      }).catch(function (e) { flash(vb, e.message); });
    }
    if (state.canVote) {
      up.addEventListener("click", function () { cast(1); });
      dn.addEventListener("click", function () { cast(-1); });
    } else {
      up.disabled = dn.disabled = true;
      up.title = dn.title = state.account
        ? "Voting needs the ETHSecurity badge or a $20+ donation here"
        : "Connect a wallet to vote";
      vb.appendChild(el("div", "lockhint",
        state.account ? "Badge or $20+" : "Connect to vote"));
    }
    return vb;
  }

  function renderEntry(c) {
    var box = el("div", "qa-entry" + (c.featured ? " featured" : ""));
    box.id = "qa-" + c.id;
    var row = el("div", "qa-row");
    row.appendChild(voteBox(c));
    var main = el("div", "qa-main");
    row.appendChild(main);
    box.appendChild(row);

    if (c.featured) {
      var flagRow = el("div", "featured-flag");
      flagRow.appendChild(el("span", "qa-chip feat", "Featured"));
      flagRow.appendChild(el("span", "hint", "Pinned by an administrator"));
      main.appendChild(flagRow);
    }

    var head = el("div", "qa-head");
    head.appendChild(identitySpan(c));
    if (c.type === "question" && c.answered)
      head.appendChild(el("span", "qa-chip state", "answered ✓"));
    if (c.type === "suggestion" && c.reviewed)
      head.appendChild(el("span", "qa-chip state", "reviewed"));
    main.appendChild(head);

    var body = el("div", "qa-body");
    c.body.split("\n").forEach(function (line, i) {
      if (i) body.appendChild(document.createElement("br"));
      body.appendChild(document.createTextNode(line));
    });
    main.appendChild(body);

    (c.replies || []).forEach(function (rep) {
      var rbox = el("div", "qa-reply");
      var rhead = el("div", "qa-head");
      rhead.appendChild(el("span", "qa-replymark", "└"));
      rhead.appendChild(identitySpan(rep));
      rbox.appendChild(rhead);
      var rbody = el("div", "qa-body");
      rep.body.split("\n").forEach(function (line, i) {
        if (i) rbody.appendChild(document.createElement("br"));
        rbody.appendChild(document.createTextNode(line));
      });
      rbox.appendChild(rbody);
      main.appendChild(rbox);
    });

    var foot = el("div", "qa-foot");
    // Replies are role-only (spec §1/§4): only the team, curators, and
    // ETHSecurity badge holders get a Reply button. The server enforces it too.
    var canReply = isAdmin || (state.roles || []).some(function (r) {
      return r === "ADMIN" || r === "CURATOR" || r === "EXPERT";
    });
    if (canReply) {
      var rbtn = iconBtn("qa-link", I.reply, "Reply");
      rbtn.addEventListener("click", function () { openReply(main, c); });
      foot.appendChild(rbtn);
    }
    // Report just flags for an admin (increments a counter, never hides the
    // comment). Reported entries sort to the top of the admin moderation queue.
    var flag = iconBtn("qa-link report", I.report, "Report");
    flag.addEventListener("click", function () {
      api("/api/comments/" + c.id + "/report", {}).then(function () {
        flag.innerHTML = I.report + "<span>Reported</span>"; flag.disabled = true;
      }).catch(function (e) { flash(main, e.message); });
    });
    foot.appendChild(flag);
    if (isAdmin) {
      foot.appendChild(el("span", "qa-spacer"));
      foot.appendChild(adminActions(c, main));
    }
    main.appendChild(foot);
    return box;
  }

  // Per-entry admin controls (spec §9D). Session-authed form POSTs with the
  // page CSRF token; the server re-checks @admin_required.
  function adminActions(c, box) {
    var wrap = el("span", "qa-admin");
    wrap.appendChild(el("span", "qa-admin-label", "Admin"));
    function action(label, act, icon, variant, confirmMsg) {
      var b = iconBtn("qa-link " + (variant || "admin"), icon, label);
      b.addEventListener("click", function () {
        if (confirmMsg && !window.confirm(confirmMsg)) return;
        var f = document.createElement("form");
        f.method = "post";
        f.action = "/admin/comments/" + c.id + "/" + act;
        var t = document.createElement("input");
        t.type = "hidden"; t.name = "_csrf"; t.value = csrf;
        var back = document.createElement("input");
        back.type = "hidden"; back.name = "back";
        back.value = location.pathname + "#qa-" + c.id;
        f.appendChild(t); f.appendChild(back);
        document.body.appendChild(f);
        f.submit();
      });
      wrap.appendChild(b);
    }
    if (c.type === "suggestion" && !c.reviewed) action("Mark reviewed", "review", I.check, "admin");
    if (c.featured !== 1) action("Feature", "feature", I.star, "admin", "Feature this comment? It pins to the top of the thread.");
    if (c.featured) action("Unfeature", "unfeature", I.star, "admin", "Unfeature this comment?");
    action("Discard", "discard", I.trash, "danger", "Discard this comment? It will be removed from the forum.");
    return wrap;
  }

  function flash(box, text) {
    var f = el("p", "qa-flash", text);
    box.appendChild(f);
    setTimeout(function () { f.remove(); }, 6000);
  }

  function openReply(box, c) {
    if (box.querySelector(".qa-replyform")) return;
    var form = el("div", "qa-replyform");
    var ta = document.createElement("textarea");
    ta.maxLength = 2000;
    ta.placeholder = "Write a reply";
    form.appendChild(ta);
    var acct = window.rfpsWallet && window.rfpsWallet.account();
    var nameIn = null;
    if (isAdmin || !acct) {
      nameIn = document.createElement("input");
      nameIn.maxLength = 60;
      nameIn.placeholder = isAdmin ? "Display name (optional)"
        : "Your name (required without a wallet)";
      if (isAdmin) {
        try { nameIn.value = localStorage.getItem("thedao:qa:adminname") || ""; } catch (e) {}
      }
      form.appendChild(nameIn);
    }
    var send = el("button", "btn sm", "Post reply");
    send.type = "button";
    var note = el("p", "qa-note");
    send.addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text) { note.textContent = "Write something first."; return; }
      var done = function (d) {
        c.replies = c.replies || [];
        c.replies.push(d.reply);
        if (c.type === "question") c.answered = true;
        draw();
      };
      // Panel admins reply via their session, regardless of a connected wallet.
      if (isAdmin) {
        var nm = nameIn ? nameIn.value.trim() : "";
        try { localStorage.setItem("thedao:qa:adminname", nm); } catch (e) {}
        api("/api/comments/" + c.id + "/reply",
          { body: text, name: nm, _csrf: csrf }).then(done)
          .catch(function (e) { note.textContent = e.message; });
        return;
      }
      // Anyone can reply: a connected wallet signs; otherwise a name-only reply.
      if (acct) {
        sha256hex(text).then(function (h) {
          return signAction("reply", c.id + ":" + h);
        }).then(function (s) {
          return api("/api/comments/" + c.id + "/reply",
            { body: text, signature: s.signature, ts: s.ts });
        }).then(done).catch(function (e) {
          note.textContent = e.message || "Signature was cancelled.";
        });
      } else {
        var nm2 = nameIn ? nameIn.value.trim() : "";
        if (!nm2) { note.textContent = "Add your name, or connect a wallet."; return; }
        api("/api/comments/" + c.id + "/reply", { body: text, name: nm2 })
          .then(done).catch(function (e) { note.textContent = e.message; });
      }
    });
    form.appendChild(send);
    form.appendChild(note);
    box.appendChild(form);
    ta.focus();
  }

  // ---------------------------------------------------------- composer

  // One generic comment box (reddit-style). The Suggestion/Question type
  // buttons looked cluttered in the UI, so they are dropped again (Zep
  // 2026-08-19); posts default to type "other". The backend still supports
  // the full type set if it is ever reinstated.
  function buildComposer() {
    composerEl.innerHTML = "";
    composerEl.hidden = false;
    if (!isOpen) return;
    var formWrap = el("div", "qa-form");
    composerEl.appendChild(formWrap);

    formWrap.appendChild(el("div", "qa-form-title", "Join the discussion"));

    var ta = document.createElement("textarea");
    ta.maxLength = 2000;
    ta.placeholder = "Add a comment";
    formWrap.appendChild(ta);

    // honeypot: real users never see or fill this
    var hp = document.createElement("input");
    hp.name = "website"; hp.className = "qa-hp";
    hp.tabIndex = -1; hp.autocomplete = "off";
    formWrap.appendChild(hp);

    var ident = el("div", "qa-identbox");
    var connected = window.rfpsWallet && window.rfpsWallet.account();
    var nameIn = document.createElement("input");
    nameIn.maxLength = 60;
    nameIn.placeholder = "Your name (required without a wallet)";
    var hint = el("span", "qa-composer-hint",
      "Connect your wallet to post as a verified participant.");
    ident.appendChild(connected ? hint : nameIn);

    var btns = el("div", "qa-buttons");
    var walletBtn = iconBtn("qa-wallet", I.wallet,
      connected ? "Signing as " + connected.slice(0, 6) + "…" + connected.slice(-4)
                : "Connect & sign");
    var post = iconBtn("qa-post", I.send, "Comment");
    btns.appendChild(walletBtn); btns.appendChild(post);
    ident.appendChild(btns);
    formWrap.appendChild(ident);

    walletBtn.addEventListener("click", function () {
      window.rfpsWallet && window.rfpsWallet.connect(function () {
        var a = window.rfpsWallet.account();
        if (a) {
          walletBtn.querySelector("span").textContent =
            "Signing as " + a.slice(0, 6) + "…" + a.slice(-4);
          if (nameIn.parentNode) ident.replaceChild(hint, nameIn);
        }
      });
    });

    var note = el("p", "qa-note");
    formWrap.appendChild(note);

    post.addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text) { note.textContent = "Write something first."; return; }
      var payload = { type: "other", topic: "", body: text,
        name: nameIn.value.trim(), email: "", website: hp.value };
      post.disabled = true;
      var send = function () {
        api("/api/initiative/" + slug + "/comments", payload)
          .then(function (d) {
            post.disabled = false;
            if (d.status === "published" && d.entry) {
              state.entries.unshift(d.entry); ta.value = ""; note.textContent = ""; draw();
            } else {
              rememberToken(d.claim_token); ta.value = ""; loadMine();
              note.textContent = "Thanks, your comment is in review.";
            }
          })
          .catch(function (e) { post.disabled = false; note.textContent = e.message; });
      };
      var acct = window.rfpsWallet && window.rfpsWallet.account();
      if (acct) {
        window.rfpsWallet.ensureName(function () {
          sha256hex(text).then(function (h) {
            return signAction("post", h);
          }).then(function (s) {
            payload.signature = s.signature; payload.ts = s.ts; send();
          }).catch(function () {
            post.disabled = false;
            note.textContent = "Signature was cancelled. Post with just a " +
              "name instead, or try signing again.";
          });
        });
      } else if (!payload.name) {
        post.disabled = false;
        note.textContent = "Add your name, or connect a wallet.";
      } else { send(); }
    });
  }

  // ------------------------------------------------------------- render

  function visibleEntries() {
    var list = state.entries.filter(function (c) {
      return state.filter === "all" || c.type === state.filter;
    });
    // "Top score" is the ranking signal (net votes, newest breaks ties);
    // "Newest" is by id. Featured entries always float to the top.
    list.sort(function (a, b) {
      if (!!b.featured !== !!a.featured) return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      // Among featured, the most recently featured floats highest (Zep 2026-08-19):
      // feature a second comment and it lands above the first.
      if (a.featured && b.featured) return (b.featured_at || 0) - (a.featured_at || 0);
      return state.sort === "new" ? b.id - a.id : (b.votes - a.votes) || (b.id - a.id);
    });
    return list;
  }

  function draw() {
    var list = visibleEntries();
    listEl.querySelectorAll(".qa-entry, .qa-held").forEach(function (n) { n.remove(); });
    emptyEl.hidden = state.entries.length > 0;
    countEl.textContent = state.entries.length ? "(" + state.entries.length + ")" : "";
    if (filtersEl) filtersEl.hidden = state.entries.length < 2;
    if (sortBar) sortBar.hidden = state.entries.length < 2;
    list.slice(0, state.shown).forEach(function (c) {
      listEl.appendChild(renderEntry(c));
    });
    moreBtn.hidden = list.length <= state.shown;
    drawHeld();
  }

  var heldRows = [];
  function drawHeld() {
    listEl.querySelectorAll(".qa-held").forEach(function (n) { n.remove(); });
    heldRows.forEach(function (h) {
      var box = el("div", "qa-entry qa-held");
      var head = el("div", "qa-head");
      var hicon = el("span", "qa-icon"); hicon.innerHTML = HELD_ICON; head.appendChild(hicon);
      head.appendChild(el("span", "qa-chip state", "waiting for review"));
      box.appendChild(head);
      var body = el("div", "qa-body", h.body);
      box.appendChild(body);
      box.appendChild(el("p", "small dim",
        "Thanks. Your comment is waiting for review and is only " +
        "visible to you."));
      listEl.appendChild(box);
    });
  }

  function loadMine() {
    var toks = myTokens();
    if (!toks.length) return;
    fetch("/api/comments/mine?tokens=" + toks.join(","))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        heldRows = (d.held || []).filter(function (h) {
          return state.entries.every(function (c) { return c.id !== h.id; });
        });
        drawHeld();
      }).catch(function () {});
  }

  function load() {
    var acct = window.rfpsWallet && window.rfpsWallet.account();
    var url = "/api/initiative/" + slug + "/comments" +
      (acct ? "?viewer=" + acct : "");
    fetch(url).then(function (r) { return r.json(); })
      .then(function (d) {
        state.entries = d.entries || [];
        state.canVote = !!d.viewer_can_vote;
        state.roles = d.viewer_roles || [];
        state.account = acct;
        draw();
        loadMine();
      }).catch(function () {});
  }

  if (filtersEl) filtersEl.addEventListener("click", function (ev) {
    var b = ev.target.closest(".qa-filter");
    if (!b) return;
    state.filter = b.dataset.f;
    state.shown = PAGE;
    filtersEl.querySelectorAll(".qa-filter").forEach(function (x) {
      x.classList.toggle("on", x === b);
    });
    draw();
  });
  moreBtn.addEventListener("click", function () {
    state.shown += PAGE;
    draw();
  });
  document.addEventListener("rfps:wallet", function () { load(); buildComposer(); });

  // Ranking-signal sort toggle, inserted above the thread list.
  (function buildSortBar() {
    if (!listEl || !listEl.parentNode) return;
    sortBar = el("div", "qa-sortbar");
    sortBar.hidden = true;
    [["top", "Top score"], ["new", "Newest"]].forEach(function (o) {
      var b = el("button", "qa-sort" + (o[0] === state.sort ? " on" : ""), o[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        state.sort = o[0]; state.shown = PAGE;
        sortBar.querySelectorAll(".qa-sort").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        draw();
      });
      sortBar.appendChild(b);
    });
    listEl.parentNode.insertBefore(sortBar, listEl);
  })();

  buildComposer();
  load();
})();
