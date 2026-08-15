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
    account: null,
  };

  var listEl = document.getElementById("qa-list");
  var emptyEl = document.getElementById("qa-empty");
  var countEl = document.getElementById("qa-count");
  var moreBtn = document.getElementById("qa-more");
  var filtersEl = document.getElementById("qa-filters");
  var composerEl = document.getElementById("qa-composer");

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

  function ensName(span, addr) {
    span.classList.add("ens-addr");
    span.dataset.addr = addr;
    fetch("/api/ens-name/" + addr).then(function (r) { return r.json(); })
      .then(function (d) { if (d.name) span.textContent = d.name; })
      .catch(function () {});
  }

  function identitySpan(c) {
    var wrap = el("span", "qa-ident");
    if (c.address) {
      var a = el("span", "", c.address.slice(0, 6) + "…" + c.address.slice(-4));
      ensName(a, c.address);
      wrap.appendChild(a);
      if (c.display_name) wrap.appendChild(el("span", "qa-typed", c.display_name));
    } else {
      var label = c.roles.indexOf("ADMIN") >= 0 ? "TheDAO team"
        : (c.display_name || "Anonymous");
      wrap.appendChild(el("span", "qa-unverified", label));
      if (c.roles.indexOf("ADMIN") >= 0 && c.display_name)
        wrap.appendChild(el("span", "qa-typed", c.display_name));
    }
    c.roles.slice(0, 2).forEach(function (t) {
      wrap.appendChild(el("span", "qa-chip role",
        t === "EXPERT" ? "ETHSECURITY EXPERT" : t));
    });
    return wrap;
  }

  var ICONS = { suggestion: "💡", question: "❓", other: "💬" };

  function renderEntry(c) {
    var box = el("div", "qa-entry" + (c.featured ? " featured" : ""));
    box.id = "qa-" + c.id;
    var head = el("div", "qa-head");
    if (c.featured) head.appendChild(el("span", "qa-chip feat", "★ FEATURED"));
    head.appendChild(el("span", "qa-icon", ICONS[c.type] || "💬"));
    head.appendChild(identitySpan(c));
    if (c.type === "question" && c.answered)
      head.appendChild(el("span", "qa-chip state", "answered ✓"));
    if (c.type === "suggestion" && c.accepted)
      head.appendChild(el("span", "qa-chip state ok", "accepted ✓"));
    else if (c.type === "suggestion" && c.reviewed)
      head.appendChild(el("span", "qa-chip state", "reviewed"));

    var vote = el("button", "qa-vote" + (c.voted ? " on" : ""), "▲ " + c.votes);
    vote.type = "button";
    if (state.canVote) {
      vote.addEventListener("click", function () {
        signAction("vote", String(c.id)).then(function (s) {
          return api("/api/comments/" + c.id + "/vote",
            { signature: s.signature, ts: s.ts });
        }).then(function (d) {
          c.votes = d.votes; c.voted = d.voted;
          vote.textContent = "▲ " + d.votes;
          vote.classList.toggle("on", d.voted);
        }).catch(function (e) { flash(box, e.message); });
      });
    } else {
      vote.disabled = true;
      vote.title = "Voting is for donors of $20+ to this initiative, " +
        "ETHSecurity badge holders, curators, and admins.";
    }
    head.appendChild(vote);
    box.appendChild(head);

    var body = el("div", "qa-body");
    c.body.split("\n").forEach(function (line, i) {
      if (i) body.appendChild(document.createElement("br"));
      body.appendChild(document.createTextNode(line));
    });
    box.appendChild(body);

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
      box.appendChild(rbox);
    });

    var foot = el("div", "qa-foot");
    var canReply = isAdmin ||
      state.roles.some(function (t) {
        return ["ADMIN", "CURATOR", "EXPERT"].indexOf(t) >= 0;
      });
    // A panel admin whose connected wallet holds a role signs; one without a
    // role still replies via the session path (handled in openReply).
    if (canReply) {
      var rbtn = el("button", "qa-link", "Reply");
      rbtn.type = "button";
      rbtn.addEventListener("click", function () { openReply(box, c); });
      foot.appendChild(rbtn);
    }
    var rep = el("button", "qa-link", "Report");
    rep.type = "button";
    rep.addEventListener("click", function () {
      api("/api/comments/" + c.id + "/report", {}).then(function () {
        rep.textContent = "Reported";
        rep.disabled = true;
      }).catch(function (e) { flash(box, e.message); });
    });
    foot.appendChild(rep);
    if (isAdmin) foot.appendChild(adminActions(c, box));
    box.appendChild(foot);
    return box;
  }

  // Per-entry admin controls (spec §9D). Session-authed form POSTs with the
  // page CSRF token; the server re-checks @admin_required.
  function adminActions(c, box) {
    var wrap = el("span", "qa-admin");
    function action(label, act) {
      var b = el("button", "qa-link admin", label);
      b.type = "button";
      b.addEventListener("click", function () {
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
    if (c.type === "suggestion" && !c.accepted) action("Accept", "accept");
    if (c.type === "suggestion" && !c.reviewed) action("Mark reviewed", "review");
    if (c.featured !== 1) action("Feature", "feature");
    if (c.featured !== 2) action("Feature on front page", "feature-front");
    if (c.featured) action("Unfeature", "unfeature");
    action("Discard", "discard");
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
    var nameIn = null;
    if (isAdmin) {
      nameIn = document.createElement("input");
      nameIn.placeholder = "Display name (optional)";
      try { nameIn.value = localStorage.getItem("thedao:qa:adminname") || ""; } catch (e) {}
      form.appendChild(nameIn);
    }
    var send = el("button", "btn sm", "Post reply");
    send.type = "button";
    send.addEventListener("click", function () {
      var text = ta.value.trim();
      if (!text) return;
      var done = function (d) {
        c.replies = c.replies || [];
        c.replies.push(d.reply);
        if (c.type === "question") c.answered = true;
        draw();
      };
      // Panel admins reply via their session (spec §9D "TheDAO team"),
      // regardless of whether a wallet is connected, so a role-less wallet
      // in the extension does not force the signature path and a 403.
      if (isAdmin) {
        var nm = nameIn ? nameIn.value.trim() : "";
        try { localStorage.setItem("thedao:qa:adminname", nm); } catch (e) {}
        api("/api/comments/" + c.id + "/reply",
          { body: text, name: nm, _csrf: csrf }).then(done)
          .catch(function (e) { flash(box, e.message); });
        return;
      }
      sha256hex(text).then(function (h) {
        return signAction("reply", c.id + ":" + h);
      }).then(function (s) {
        return api("/api/comments/" + c.id + "/reply",
          { body: text, signature: s.signature, ts: s.ts });
      }).then(done).catch(function (e) { flash(box, e.message); });
    });
    form.appendChild(send);
    box.appendChild(form);
    ta.focus();
  }

  // ---------------------------------------------------------- composer

  function buildComposer() {
    composerEl.innerHTML = "";
    composerEl.hidden = false;
    if (!isOpen) return;
    var picks = el("div", "qa-picks");
    var bSug = el("button", "btn qa-pick", "💡 Suggest a change");
    var bQ = el("button", "btn qa-pick", "❓ Ask a question");
    var bOther = el("button", "qa-link", "something else");
    bSug.type = bQ.type = bOther.type = "button";
    picks.appendChild(bSug);
    picks.appendChild(bQ);
    picks.appendChild(bOther);
    composerEl.appendChild(picks);
    var formWrap = el("div", "qa-form");
    formWrap.hidden = true;
    composerEl.appendChild(formWrap);
    bSug.addEventListener("click", function () { openForm("suggestion"); });
    bQ.addEventListener("click", function () { openForm("question"); });
    bOther.addEventListener("click", function () { openForm("other"); });

    function openForm(type) {
      formWrap.hidden = false;
      formWrap.innerHTML = "";
      var ta = document.createElement("textarea");
      ta.maxLength = 2000;
      ta.placeholder = type === "suggestion"
        ? "What should change, and why?"
        : type === "question"
          ? "What do you want to know? (scope, bidding, process...)"
          : "What's on your mind?";
      formWrap.appendChild(ta);

      var topic = document.createElement("select");
      [["", "Topic (optional)"], ["budget", "Budget"],
       ["milestones", "Milestones"], ["scope", "Scope"],
       ["process", "Process"], ["other", "Other"]].forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o[0];
        opt.textContent = o[1];
        topic.appendChild(opt);
      });
      formWrap.appendChild(topic);

      // honeypot: real users never see or fill this
      var hp = document.createElement("input");
      hp.name = "website";
      hp.className = "qa-hp";
      hp.tabIndex = -1;
      hp.autocomplete = "off";
      formWrap.appendChild(hp);

      var ident = el("div", "qa-identbox");
      ident.appendChild(el("div", "qa-identtitle", "Show who you are (optional)"));
      var connected = window.rfpsWallet && window.rfpsWallet.account();
      var walletBtn = el("button", "btn sm",
        connected ? "Signing as " + connected.slice(0, 6) + "…" + connected.slice(-4)
                  : "Connect & sign");
      walletBtn.type = "button";
      var walletNote = el("p", "small dim",
        "Sign with your wallet so your name and tags appear and your entry " +
        "can collect votes. Free, no transaction.");
      var nameIn = document.createElement("input");
      nameIn.maxLength = 60;
      nameIn.placeholder = "Your name (required without a wallet)";
      var emailIn = document.createElement("input");
      emailIn.maxLength = 200;
      emailIn.placeholder = "Email (optional)";
      var emailNote = el("p", "small dim",
        "Email stays private. We may use it later to notify you about replies.");
      ident.appendChild(walletNote);
      ident.appendChild(walletBtn);
      ident.appendChild(nameIn);
      ident.appendChild(emailIn);
      ident.appendChild(emailNote);
      formWrap.appendChild(ident);
      walletBtn.addEventListener("click", function () {
        window.rfpsWallet && window.rfpsWallet.connect(function () {
          var a = window.rfpsWallet.account();
          if (a) walletBtn.textContent =
            "Signing as " + a.slice(0, 6) + "…" + a.slice(-4);
        });
      });

      var post = el("button", "btn primary", "Post");
      post.type = "button";
      var note = el("p", "qa-note");
      formWrap.appendChild(post);
      formWrap.appendChild(note);

      post.addEventListener("click", function () {
        var text = ta.value.trim();
        if (!text) { note.textContent = "Write something first."; return; }
        var payload = {
          type: type, topic: topic.value, body: text,
          name: nameIn.value.trim(), email: emailIn.value.trim(),
          website: hp.value,
        };
        post.disabled = true;
        var send = function () {
          api("/api/initiative/" + slug + "/comments", payload)
            .then(function (d) {
              post.disabled = false;
              if (d.status === "published" && d.entry) {
                state.entries.unshift(d.entry);
                formWrap.hidden = true;
                ta.value = "";
                draw();
              } else {
                rememberToken(d.claim_token);
                formWrap.hidden = true;
                loadMine();
                note.textContent = "";
              }
            })
            .catch(function (e) { post.disabled = false; note.textContent = e.message; });
        };
        var acct = window.rfpsWallet && window.rfpsWallet.account();
        if (acct) {
          sha256hex(text).then(function (h) {
            return signAction("post", h);
          }).then(function (s) {
            payload.signature = s.signature;
            payload.ts = s.ts;
            send();
          }).catch(function () {
            post.disabled = false;
            note.textContent = "Signature was cancelled. Post with just a " +
              "name instead, or try signing again.";
          });
        } else if (!payload.name) {
          post.disabled = false;
          note.textContent = "Add your name, or connect a wallet.";
        } else {
          send();
        }
      });
    }
  }

  // ------------------------------------------------------------- render

  function visibleEntries() {
    return state.entries.filter(function (c) {
      return state.filter === "all" || c.type === state.filter;
    });
  }

  function draw() {
    var list = visibleEntries();
    listEl.querySelectorAll(".qa-entry, .qa-held").forEach(function (n) { n.remove(); });
    emptyEl.hidden = state.entries.length > 0;
    countEl.textContent = state.entries.length ? "(" + state.entries.length + ")" : "";
    filtersEl.hidden = state.entries.length < 2;
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
      head.appendChild(el("span", "qa-icon", ICONS[h.type] || "💬"));
      head.appendChild(el("span", "qa-chip state", "waiting for review"));
      box.appendChild(head);
      var body = el("div", "qa-body", h.body);
      box.appendChild(body);
      box.appendChild(el("p", "small dim",
        "Thanks. Your " + h.type + " is waiting for review and is only " +
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

  filtersEl.addEventListener("click", function (ev) {
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

  buildComposer();
  load();
})();
