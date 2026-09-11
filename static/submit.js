/* Suggest an initiative: the form (submission redesign, phase 2).
   Ported from docs/prototype/parts/p4_script.html. Vanilla JS, no libraries,
   a static file because the CSP is script-src 'self'.
     1. amount parsing (mirrored in draft.py)
     2. the paste splitter (mirrored in draft.py; the alias table is the contract with the guide)
     3. rendering: sections by type, backer rows, milestone rows, checks, page preview
     4. checks and error painting (the server runs the same rules again)
     5. wiring, autosave, submit
*/
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function v(id) { var n = document.getElementById(id); return n ? n.value : ""; }
  function setV(id, val) { var n = document.getElementById(id); if (n) { n.value = val; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function words(s) { var t = String(s || "").trim(); return t ? t.split(/\s+/).length : 0; }
  function nonEmpty(s) { return String(s || "").trim() !== ""; }
  function letter(i) { return String.fromCharCode(65 + (i % 26)); }
  function intOf(x) {
    var n = parseInt(String(x == null ? "" : x).replace(/[^0-9]/g, ""), 10);
    return isFinite(n) ? n : 0;
  }

  /* ---------------------------------------------------- 1. amounts */
  function parseAmount(raw) {
    var s = String(raw == null ? "" : raw).replace(/[^0-9.,]/g, "");
    if (!s) { return 0; }
    var last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    var n;
    if (last < 0) {
      n = parseFloat(s);
    } else if (/^\d{1,2}$/.test(s.slice(last + 1))) {
      n = parseFloat(s.slice(0, last).replace(/[.,]/g, "") + "." + s.slice(last + 1));
    } else {
      n = parseFloat(s.replace(/[.,]/g, ""));
    }
    return isFinite(n) ? n : 0;
  }
  function usd(n) {
    var x = Number(n) || 0;
    var cents = Math.abs(x % 1) > 0.004 ? 2 : 0;
    return "$" + x.toLocaleString("en-US", { minimumFractionDigits: cents, maximumFractionDigits: cents });
  }
  function money(n) { return n ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""; }

  /* ------------------------------------------------ 2. the splitter */
  var SECTIONS = {
    rfp: ["why", "in_scope", "out_scope", "existing", "who", "hard_req"],
    grant: ["why", "team", "why_grant", "in_scope", "out_scope", "commitments"]
  };
  var HEADINGS = {};
  all("#sections .fld").forEach(function (el) {
    HEADINGS[el.getAttribute("data-sec")] = el.querySelector(".eyebrow").textContent
      .replace(/^Renders as:\s*/, "").replace(/\s*Required\s*$/, "").trim();
  });

  function headingKey(rawName, type) {
    var n = String(rawName).toLowerCase().replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().replace(/[:.]+$/, "");
    if (n === "what already exists") { return type === "grant" ? "why_grant" : "existing"; }
    if (n === "the recipient" || n === "recipient team and why them") { return type === "grant" ? "team" : "who"; }
    var map = {
      "title": "title", "short summary": "summary", "summary": "summary",
      "funding goal": "goal", "funding goal (usd)": "goal", "budget": "goal", "funding": "goal",
      "expected duration": "duration", "expected duration (months)": "duration", "duration": "duration", "indicative duration": "duration",
      "recipient team": "recipient",
      "backers": "backers", "backers already committed": "backers", "already committed": "backers", "already committed (usd)": "backers",
      "links": "links", "link": "links",
      "who is likely to fund this": "funders", "who is likely to fund this?": "funders", "funders": "funders", "contact": "contact",
      "why this matters": "why", "in scope": "in_scope", "scope": "in_scope", "out of scope": "out_scope",
      "existing work": "existing", "prior art": "existing",
      "who we expect to do this": "who", "who we expect to do this work": "who",
      "hard requirements": "hard_req", "requirements": "hard_req",
      "the team": "team", "team": "team",
      "why a grant": "why_grant", "why a grant what already exists": "why_grant", "why a grant: what already exists": "why_grant",
      "commitments": "commitments",
      "milestones": "milestones", "milestones (draft)": "milestones", "draft milestones": "milestones", "milestone plan": "milestones",
      "what this actually pays for": "in_scope", "what this rfp actually pays for": "in_scope",
      "what this grant actually pays for": "in_scope", "what this pays for": "in_scope"
    };
    return map[n] || null;
  }
  var PAGE_KEYS = ["title", "summary", "goal", "duration", "recipient", "backers", "links", "funders", "contact"];

  function splitDraft(text, type) {
    var out = { page: {}, fields: {}, milestones: [], unsorted: "" };
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var buckets = {}, msLines = [], unsorted = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (h) {
        var level = h[1].length, name = h[2];
        if (level === 1 && !out.page.title) { out.page.title = name.replace(/^\s*(rfp|grant)\s*:\s*/i, "").trim(); cur = null; continue; }
        if (cur === "milestones" && level >= 3) { msLines.push(line); continue; }
        var key = headingKey(name, type);
        if (key) {
          cur = key;
          if (buckets[key] && buckets[key].length && key !== "milestones") { buckets[key].push("", "**" + name.trim() + "**"); }
          if (!buckets[key]) { buckets[key] = []; }
          continue;
        }
        if (cur && cur !== "milestones" && cur !== "unsorted" && level >= 3) { buckets[cur].push("**" + name + "**"); continue; }
        cur = "unsorted"; unsorted.push(line); continue;
      }
      if (cur === "milestones") { msLines.push(line); continue; }
      if (cur && cur !== "unsorted") { buckets[cur].push(line); continue; }
      unsorted.push(line);
    }
    Object.keys(buckets).forEach(function (k) {
      var t = buckets[k].join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (PAGE_KEYS.indexOf(k) >= 0) { out.page[k] = t; } else { out.fields[k] = t; }
    });
    out.milestones = parseMilestones(msLines, function (spill) { unsorted.push(spill); });
    out.unsorted = unsorted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return out;
  }

  function rowFromHeading(s) {
    var row = { name: "", amount: 0, adoption: false, done: false, link: "", month: "", criteria: [] };
    var t = String(s).trim();
    if (/\(adoption\)/i.test(t)) { row.adoption = true; t = t.replace(/\(adoption\)/ig, "").trim(); }
    if (/\(done\)/i.test(t)) { row.done = true; t = t.replace(/\(done\)/ig, "").trim(); }
    t = t.replace(/[*_`]/g, "").trim();
    var parts = t.split(/\s+-\s+/);
    if (parts.length >= 3 && parts[0].trim().length <= 3) {
      row.amount = parseAmount(parts[parts.length - 1]); row.name = parts.slice(1, -1).join(" - ").trim();
    } else if (parts.length >= 2 && parseAmount(parts[parts.length - 1]) > 0) {
      row.amount = parseAmount(parts[parts.length - 1]); row.name = parts.slice(0, -1).join(" - ").trim();
    } else { row.name = t; }
    return row;
  }

  function parseMilestones(lines, spill) {
    var rows = [], cur = null, preamble = [];
    lines.forEach(function (line) {
      var h = line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/);
      if (h) { cur = rowFromHeading(h[1]); rows.push(cur); return; }
      var t = line.trim();
      if (!t) { return; }
      if (!cur) { preamble.push(line); return; }
      var mm = t.match(/^target month:\s*(\d{4}-\d{2})\b/i);
      if (mm) { cur.month = mm[1]; return; }
      var dl = t.match(/^delivered:\s*(\S+)/i);
      if (dl) { cur.link = dl[1]; return; }
      var crit = t.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^\[[ xX]\]\s*/, "").trim();
      if (crit) { cur.criteria.push(crit); }
    });
    if (preamble.length && spill) { spill(preamble.join("\n").trim()); }
    return rows;
  }

  function parseBackers(text) {
    return String(text || "").split("\n").map(function (line) {
      return line.replace(/^[-*+]\s+/, "").trim();
    }).filter(function (line) { return line.indexOf("|") > 0; }).map(function (line) {
      var p = line.split("|");
      return { org: (p[0] || "").trim(), amount: parseAmount(p[1] || ""), url: (p[2] || "").trim() };
    });
  }

  /* ---------------------------------------------------- tiny markdown (preview only) */
  function mdInline(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function mdToHtml(src) {
    var out = [], para = [], list = null;
    function flushPara() { if (para.length) { out.push("<p>" + mdInline(para.join(" ")) + "</p>"); para = []; } }
    function flushList() {
      if (list) { out.push("<" + list.tag + ">" + list.items.map(function (x) { return "<li>" + mdInline(x) + "</li>"; }).join("") + "</" + list.tag + ">"); list = null; }
    }
    String(src || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      var t = line.trim();
      if (!t) { flushPara(); flushList(); return; }
      var ul = t.match(/^[-*+]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(ul[1].replace(/^\[[ xX]\]\s*/, "")); return; }
      if (ol) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(ol[1]); return; }
      flushList(); para.push(t);
    });
    flushPara(); flushList();
    return out.join("");
  }

  /* --------------------------------------------------------- state */
  var form = document.getElementById("submit-form");
  if (!form) { return; }
  var state = { type: "rfp", topup: false, milestones: [], backers: [], previewOpen: false, submitted: false };
  var AUTOSAVE_KEY = "thedao:submit-draft";

  function emptyMilestone() { return { name: "", amount: 0, adoption: false, done: false, link: "", month: "", criteria: [""] }; }
  function emptyBacker() { return { org: "", amount: 0, url: "", logoName: "", logoData: "" }; }
  function rulesKey() { return state.type === "grant" ? (state.topup ? "topup" : "grant") : "rfp"; }
  function goal() { return parseAmount(v("f-goal")); }
  function fieldText(k) { return v("s-" + k); }
  function msTotal() { return state.milestones.reduce(function (a, m) { return a + parseAmount(m.amount); }, 0); }
  function adoptionTotal() { return state.milestones.reduce(function (a, m) { return a + (m.adoption ? parseAmount(m.amount) : 0); }, 0); }
  function liveBackers() { return state.backers.filter(function (b) { return nonEmpty(b.org) || b.amount > 0; }); }
  function committedTotal() { return liveBackers().reduce(function (a, b) { return a + parseAmount(b.amount); }, 0); }
  function adoptionFloor(g) { var f = g / 3; if (g >= 300000) { f = Math.max(f, 100000); } return f; }

  /* ---------------------------------------------------- 3. rendering */
  function renderRules() {
    var key = rulesKey();
    all("[data-rules]").forEach(function (el) {
      var mine = el.getAttribute("data-rules") === key;
      el.hidden = !mine;
      if (mine) { el.open = true; }
    });
  }

  function renderSections() {
    var ids = SECTIONS[state.type], host = $("#sections");
    all("#sections .fld").forEach(function (el) { el.hidden = true; });
    ids.forEach(function (id, i) {
      var el = host.querySelector('.fld[data-sec="' + id + '"]');
      if (!el) { return; }
      el.hidden = false;
      el.querySelector(".eyebrow").classList.toggle("top", i === 0);
      host.appendChild(el); /* order of the type */
      updateWordCount(id);
    });
  }
  function updateWordCount(id) {
    var span = document.querySelector('[data-wc="' + id + '"]');
    if (span) { span.textContent = words(fieldText(id)) + " words"; }
  }

  function backerChip(b) {
    if (!nonEmpty(b.org) && !b.logoData) { return ""; }
    return '<div class="bk-chip"><span class="eyebrow sm">On the page it looks like this</span>' +
      '<div class="sponsors"><div class="sponsor-pill">' +
      (b.logoData ? '<img class="sponsor-logo" src="' + esc(b.logoData) + '" alt="' + esc(b.org || "Backer") + ' logo">' : "") +
      "<b>" + esc(b.org || "Unnamed backer") + "</b><span>" + usd(parseAmount(b.amount)) + "</span>" +
      '<small class="pledged">committed</small></div></div></div>';
  }
  /* rows are built once and updated in place, so a chosen logo file survives edits */
  function backerRowHtml(b, i) {
    var p = "bk-" + i + "-";
    return '<div class="row-head"><span class="row-k">Backer ' + (i + 1) + "</span>" +
      '<button type="button" class="btn ghost sm bk-del">Remove</button></div>' +
      '<div class="ms-grid">' +
        '<label class="ms-f grow"><span class="eyebrow sm">Organization</span>' +
          '<input type="text" id="' + p + 'org" name="bk_org" data-bk="org" value="' + esc(b.org) + '" placeholder="Who committed the money"></label>' +
        '<label class="ms-f amt"><span class="eyebrow sm">Amount committed (USD)</span>' +
          '<input type="text" class="money" inputmode="decimal" id="' + p + 'amount" name="bk_amount" data-bk="amount" value="' + esc(money(b.amount)) + '">' +
          '<span class="amt-echo">' + (b.amount ? usd(b.amount) : "") + "</span></label>" +
      "</div>" +
      '<label class="ms-f"><span class="eyebrow sm">Link</span>' +
        '<input type="text" id="' + p + 'url" name="bk_url" data-bk="url" placeholder="https://" value="' + esc(b.url) + '"></label>' +
      '<div class="ms-f"><span class="eyebrow sm">Logo file</span>' +
        '<input type="file" class="filein" id="' + p + 'logo" name="bk_logo" data-bk="logo" accept=".png,.jpg,.jpeg,.webp">' +
        '<p class="hint">Upload the organization\'s official logo file (from their press kit, brand page, or repository). PNG, JPG or WEBP under 1 MB. Never a redrawn or AI-made version.</p>' +
      "</div>" + backerChip(b);
  }
  function renderBackers() {
    var host = $("#bk-rows");
    host.innerHTML = "";
    if (!state.backers.length) {
      host.innerHTML = '<p class="emptyrow">No backers listed. Add one for every organization that has already committed money to this work.</p>';
      return;
    }
    state.backers.forEach(function (b, i) {
      var div = document.createElement("div");
      div.className = "bk-row"; div.setAttribute("data-i", i);
      div.innerHTML = backerRowHtml(b, i);
      host.appendChild(div);
    });
  }
  function renumberBackers() {
    all(".bk-row").forEach(function (row, i) {
      row.setAttribute("data-i", i);
      row.querySelector(".row-k").textContent = "Backer " + (i + 1);
      row.querySelectorAll("[data-bk]").forEach(function (inp) {
        var k = inp.getAttribute("data-bk");
        inp.id = "bk-" + i + "-" + k;
      });
    });
  }
  function renderBackerHead() {
    var live = liveBackers(), total = committedTotal(), g = goal();
    if (!live.length || total <= 0) {
      $("#bk-head").innerHTML = '<span class="dimline">Nothing committed yet, so this line stays off your page and your board card.</span>';
      return;
    }
    var line = usd(total) + " already committed by " + live.map(function (b) { return b.org || "an unnamed backer"; }).join(", ");
    if (state.topup && g > total) { line += "; this grant raises the remaining " + usd(g - total); }
    $("#bk-head").innerHTML = '<span class="okline">' + esc(line) + "</span>";
  }

  function renderMilestones() {
    if (!state.milestones.length) {
      $("#ms-rows").innerHTML = '<p class="emptyrow">No milestones yet. Add the first one, or paste a draft and we build the rows from it.</p>';
      return;
    }
    $("#ms-rows").innerHTML = state.milestones.map(function (m, i) {
      var p = "ms-" + i + "-";
      var crits = m.criteria.length ? m.criteria : [""];
      return '<div class="ms-row" data-i="' + i + '">' +
        '<div class="row-head"><span class="row-k">Milestone ' + letter(i) + "</span>" +
          '<button type="button" class="btn ghost sm ms-del" data-del="' + i + '">Remove</button></div>' +
        '<div class="ms-grid">' +
          '<label class="ms-f grow"><span class="eyebrow sm">Name <em class="reqtag sm">Required</em></span>' +
            '<input type="text" id="' + p + 'name" data-mk="name" value="' + esc(m.name) + '"></label>' +
          '<label class="ms-f amt"><span class="eyebrow sm">Amount (USD) <em class="reqtag sm">Required</em></span>' +
            '<input type="text" class="money" inputmode="decimal" id="' + p + 'amount" data-mk="amount" value="' + esc(money(m.amount)) + '">' +
            '<span class="amt-echo">' + (m.amount ? usd(m.amount) : "") + "</span></label>" +
        "</div>" +
        '<div class="ms-flags">' +
          '<label class="cbrow"><input type="checkbox" data-mk="adoption"' + (m.adoption ? " checked" : "") + "> <span>Adoption milestone</span></label>" +
          (state.topup ? '<label class="cbrow"><input type="checkbox" data-mk="done"' + (m.done ? " checked" : "") + "> <span>Already done</span></label>" : "") +
        "</div>" +
        (state.topup && m.done ? '<label class="ms-f"><span class="eyebrow sm">Link to the delivered work</span><input type="text" id="' + p + 'link" data-mk="link" placeholder="https://" value="' + esc(m.link) + '"></label>' : "") +
        (state.topup && !m.done ? '<label class="ms-f mth"><span class="eyebrow sm">Target month</span><input type="month" id="' + p + 'month" data-mk="month" value="' + esc(m.month) + '"></label>' : "") +
        '<div class="crit-block eb" id="' + p + 'crit">' +
          '<span class="eyebrow sm">Acceptance criteria, one per row <em class="reqtag sm">Required</em></span>' +
          '<div class="crit-list">' + crits.map(function (c, j) {
            return '<div class="crit"><span class="crit-box" aria-hidden="true"></span>' +
              '<textarea rows="2" id="' + p + "c" + j + '" data-mk="crit" data-ci="' + j + '" placeholder="One checkable outcome">' + esc(c) + "</textarea>" +
              '<button type="button" class="crit-del" data-cdel="' + j + '" title="Remove this criterion" aria-label="Remove this criterion">&#215;</button></div>';
          }).join("") + "</div>" +
          '<button type="button" class="linklike crit-add">Add criterion</button>' +
        "</div></div>";
    }).join("");
  }

  function renderTotals() {
    var sum = msTotal(), g = goal(), ad = adoptionTotal();
    var pct = g > 0 ? Math.round((ad / g) * 100) : 0;
    var okSum = state.milestones.length === 0 || Math.round(sum) === Math.round(g);
    $("#tot-line").innerHTML = '<span class="' + (okSum ? "okc" : "bad") + '">Milestones total ' + usd(sum) + " of " + usd(g) + " goal</span>";
    var floor = adoptionFloor(g), okAd = g > 0 && ad >= floor;
    $("#adopt-line").innerHTML = '<span class="' + (okAd ? "okc" : "bad") + '">Adoption-tied: ' + usd(ad) + " (" + pct + "%), minimum " + usd(floor) + "</span>";
  }
  function updateAmountEcho(el, n) {
    var echo = el.parentNode ? el.parentNode.querySelector(".amt-echo") : null;
    if (echo) { echo.textContent = n ? usd(n) : ""; }
  }
  function updateAmountEchoes() { var g = goal(); $("#echo-goal").textContent = g ? usd(g) : ""; }

  /* ------------------------------------------------------ 4. checks */
  var HEDGES = /\bas needed\b|\bwhere appropriate\b/i;
  function runChecks() {
    var errs = [], warns = [];
    function err(target, msg, text) { errs.push({ target: target, msg: msg, text: text || esc(msg), kind: "content" }); }
    function need(target, label, msg) { errs.push({ target: target, msg: msg, kind: "missing", text: "<b>" + esc(label) + "</b> is required. " + esc(msg) }); }
    function warn(target, msg, text, group) { warns.push({ target: target, msg: msg, text: text || esc(msg), group: group }); }

    if (v("f-title").trim().length < 8) { need("f-title", "Title", "Write the title, at least 8 characters, up to 140."); }
    if (v("f-summary").trim().length < 40) { need("f-summary", "Short summary", "Write the 2 to 4 sentences the board card shows (at least 40 characters)."); }
    if (goal() <= 0) { need("f-goal", "Funding goal", "Enter the goal in USD, one flat number."); }
    if (intOf(v("f-duration")) <= 0) { need("f-duration", "Expected duration", "Enter the number of months to the last milestone."); }
    if (state.type === "grant" && !nonEmpty(v("f-recipient"))) { need("f-recipient", "Recipient team", "Name the team that receives this grant."); }
    SECTIONS[state.type].forEach(function (id) {
      if (!nonEmpty(fieldText(id))) { need("s-" + id, HEADINGS[id] || id, "Answer the question above."); }
    });
    if (v("f-funders").trim().length < 10) { need("f-funders", "Who is likely to fund this", "Name at least one funder, one per line. Private, never published."); }
    if (!nonEmpty(v("f-contact"))) { need("f-contact", "Contact", "An email or handle, so we can ask about this submission."); }

    state.backers.forEach(function (b, i) {
      var p = "bk-" + i + "-";
      if (nonEmpty(b.org) && parseAmount(b.amount) <= 0) { err(p + "amount", "Add what " + b.org + " committed, or remove the row."); }
      if (!nonEmpty(b.org) && parseAmount(b.amount) > 0) { err(p + "org", "Name the organization that committed this amount, or remove the row."); }
    });
    if (state.topup && !liveBackers().length) {
      warn("bk-rows", "A top-up says the work is already funded by someone else. List that backer so the header can show the amount and the logo.");
    }
    if (!state.milestones.length) { need("ms-rows", "Milestones", "Add at least one milestone."); }
    state.milestones.forEach(function (m, i) {
      var p = "ms-" + i + "-", L = "Milestone " + letter(i);
      if (!nonEmpty(m.name)) { need(p + "name", L + " name", "Name this milestone."); }
      if (parseAmount(m.amount) <= 0) { need(p + "amount", L + " amount", "Enter what this milestone pays."); }
      if (!m.criteria.filter(nonEmpty).length) { need(p + "crit", L + " criteria", "Write at least one criterion a reviewer can check."); }
      if (state.topup && m.done && !nonEmpty(m.link)) { warn(p + "link", L + " is marked done with no link to the delivered work."); }
      if (state.topup && !m.done && !nonEmpty(m.month)) { warn(p + "month", L + " has no target month. Every remaining milestone needs one."); }
    });
    var sum = msTotal(), g = goal();
    if (state.milestones.length && g > 0 && Math.round(sum) !== Math.round(g)) {
      err("f-goal", "Milestone amounts total " + usd(sum) + " against a " + usd(g) + " goal. Change the goal or a milestone amount.",
        "Milestone amounts total <b>" + usd(sum) + "</b>, the funding goal is <b>" + usd(g) + "</b>. Change one of them before you submit.");
    }
    var exempt = state.topup && state.milestones.length > 0 && state.milestones.every(function (m) { return m.done; });
    var ad = adoptionTotal(), floor = adoptionFloor(g);
    if (g > 0 && state.milestones.length && !exempt) {
      if (ad === 0) { err("ms-rows", "No milestone is an adoption milestone. Flag at least one, worth " + usd(floor) + " or more."); }
      else if (ad < floor) { err("ms-rows", "Adoption milestones carry " + usd(ad) + ", which is " + Math.round((ad / g) * 100) + "% of the goal. Raise them to at least " + usd(floor) + "."); }
    }
    state.milestones.forEach(function (m, i) {
      m.criteria.forEach(function (c, j) {
        var t = String(c).trim();
        if (!t) { return; }
        var reasons = [];
        if (t.indexOf("[") >= 0) { reasons.push("an unresolved bracket"); }
        if (/\bTBD\b/i.test(t)) { reasons.push("TBD"); }
        if (/PLACEHOLDER/i.test(t)) { reasons.push("PLACEHOLDER"); }
        if (/\d+\s*-\s*\d+/.test(t)) { reasons.push("a range, pick the floor"); }
        if (HEDGES.test(t)) { reasons.push("a hedge"); }
        if (reasons.length) {
          warn("ms-" + i + "-c" + j, "Not checkable yet: " + reasons.join(", ") + ".",
            "<b>Milestone " + letter(i) + "</b> " + esc(t) + " <i>(" + esc(reasons.join(", ")) + ")</i>", "criteria");
        }
      });
    });
    return { errs: errs, warns: warns };
  }

  function renderChecks(res) {
    var show = state.submitted;
    var errs = show ? res.errs : res.errs.filter(function (e) { return e.kind !== "missing"; });
    var crit = res.warns.filter(function (w) { return w.group === "criteria"; });
    var other = res.warns.filter(function (w) { return w.group !== "criteria"; });
    var html = errs.map(function (e) { return '<div class="check err"><span class="k">Error</span><span class="t">' + e.text + "</span></div>"; }).join("") +
      other.map(function (w) { return '<div class="check warn"><span class="k">Warning</span><span class="t">' + w.text + "</span></div>"; }).join("");
    if (crit.length) {
      html += '<div class="check warn"><span class="k">Warning</span><span class="t">These acceptance criteria are not checkable yet:<ul><li>' +
        crit.map(function (w) { return w.text; }).join("</li><li>") + "</li></ul></span></div>";
    }
    if (!errs.length) {
      html = '<div class="check ok"><span class="k">Clear</span><span class="t">' +
        (show ? "Nothing blocks this submission" : "Nothing is wrong with what is filled in so far") +
        (res.warns.length ? ". You can submit past warnings, the reviewer sees them too." : ".") + "</span></div>" + html;
    }
    if (!show) {
      html += '<div class="check note"><span class="k">Note</span><span class="t">Required questions carry a Required marker. Press Submit for review and anything still missing shows up here and on the question itself.</span></div>';
    }
    $("#checks-list").innerHTML = html;
    $("#blockmsg").textContent = show && res.errs.length
      ? (res.errs.length === 1 ? "One thing needs fixing, marked above." : res.errs.length + " things need fixing, marked above.") : "";
  }

  function paintFindings(res) {
    all(".has-error,.has-warn").forEach(function (el) { el.classList.remove("has-error"); el.classList.remove("has-warn"); });
    all(".fld-msg").forEach(function (el) { el.parentNode.removeChild(el); });
    if (!state.submitted) { return null; }
    var first = null;
    res.errs.forEach(function (e) { if (mark(e, "has-error", "fld-err") && !first) { first = e.target; } });
    res.warns.forEach(function (w) { mark(w, "has-warn", "fld-warn"); });
    return first;
  }
  function mark(item, cls, msgCls) {
    if (!item.target || !item.msg) { return false; }
    var el = document.getElementById(item.target);
    if (!el || el.offsetParent === null) { return false; }
    el.classList.add(cls);
    var p = document.createElement("p");
    p.className = "fld-msg " + msgCls; p.textContent = item.msg;
    if (el.nextSibling) { el.parentNode.insertBefore(p, el.nextSibling); } else { el.parentNode.appendChild(p); }
    return true;
  }
  function bringIntoView(el) {
    if (!el) { return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(function () {
      var r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > (window.innerHeight || 0)) { el.scrollIntoView({ block: "center" }); }
    }, 700);
  }

  /* server-side findings (a failed POST) map onto the same elements */
  function serverTarget(field) {
    var map = { title: "f-title", summary: "f-summary", goal: "f-goal", duration_months: "f-duration",
                recipient_team: "f-recipient", funders: "f-funders", contact: "f-contact",
                milestones: "ms-rows", backers: "bk-rows", links: "f-links" };
    if (map[field]) { return map[field]; }
    var ms = field.match(/^ms_(\d+)_(name|amount|crit|link|month|c\d+)$/);
    if (ms) { return "ms-" + ms[1] + "-" + ms[2]; }
    var bk = field.match(/^bk_(org|amount)_(\d+)$/);
    if (bk) { return "bk-" + bk[2] + "-" + bk[1]; }
    if (SECTIONS.rfp.indexOf(field) >= 0 || SECTIONS.grant.indexOf(field) >= 0) { return "s-" + field; }
    return "";
  }

  /* --------------------------------------------- the page preview */
  function renderPreview() {
    var isGrant = state.type === "grant";
    var g = goal(), months = intOf(v("f-duration")), total = committedTotal(), live = liveBackers();
    var h = '<div class="preview-flag"><span>Preview</span><span>This is what the site publishes</span></div>';
    h += '<h1 class="rfp-title">' + esc(v("f-title") || "Untitled initiative") + "</h1>";
    h += '<p class="meta-line"><span class="type-badge inline t-' + state.type + '">' + (isGrant ? "Grant" : "RFP") + "</span>";
    if (isGrant && state.topup) { h += '<span class="chip static">top-up, work under way</span>'; }
    if (isGrant && nonEmpty(v("f-recipient"))) { h += '<span class="chip static">to ' + esc(v("f-recipient")) + "</span>"; }
    h += "</p>";
    h += '<p class="page-facts"><span><b>' + usd(g) + "</b> goal</span><span class=\"dur\">" + (months ? "About " + months + " month" + (months === 1 ? "" : "s") : "Duration not stated") + "</span>";
    if (live.length && total > 0) {
      h += '<span class="committed"><b>' + usd(total) + "</b> already committed by " + esc(live.map(function (b) { return b.org || "an unnamed backer"; }).join(", ")) +
        (state.topup && g > total ? "; this grant raises the remaining <b>" + usd(g - total) + "</b>" : "") + "</span>";
    }
    if (state.topup && nonEmpty(v("f-reviewer"))) { h += '<span class="reviewer">Milestone reviewer: ' + esc(v("f-reviewer")) + "</span>"; }
    h += "</p>";
    h += "<h2>Summary</h2>" + '<p class="body-text">' + esc(v("f-summary")) + "</p>";
    SECTIONS[state.type].forEach(function (id) {
      h += "<h2>" + esc(HEADINGS[id] || id) + "</h2>" + '<div class="body-text md">' + mdToHtml(fieldText(id)) + "</div>";
    });
    h += "<h2>" + (isGrant ? "Milestones" : "Milestones (draft)") + "</h2>" + '<div class="body-text md">';
    state.milestones.forEach(function (m, i) {
      h += "<h3>" + esc(letter(i) + " - " + (m.name || "Unnamed") + " - " + usd(parseAmount(m.amount))) +
        (m.adoption ? ' <span class="ms-flagtag">adoption milestone</span>' : "") + (state.topup && m.done ? ' <span class="ms-flagtag done">done</span>' : "") + "</h3>";
      if (state.topup && !m.done && nonEmpty(m.month)) { h += '<p class="small dim">Target month: ' + esc(m.month) + "</p>"; }
      h += '<ul class="task">' + m.criteria.filter(nonEmpty).map(function (c) { return "<li>" + mdInline(c) + "</li>"; }).join("") + "</ul>";
      if (state.topup && m.done && nonEmpty(m.link)) { h += '<p class="small"><a href="' + esc(m.link) + '" target="_blank" rel="noopener">Delivered work: ' + esc(m.link) + "</a></p>"; }
    });
    h += "</div>";
    var links = v("f-links").split("\n").filter(nonEmpty);
    if (links.length) { h += "<h2>Links</h2><ul class=\"body-text links\">" + links.map(function (l) { return '<li><a href="' + esc(l.trim()) + '" target="_blank" rel="noopener">' + esc(l.trim()) + "</a></li>"; }).join("") + "</ul>"; }
    if (live.length) {
      h += '<h2>Backers <span class="n">' + live.length + '</span></h2><div class="sponsors">' + live.map(function (b) {
        return '<div class="sponsor-pill">' + (b.logoData ? '<img class="sponsor-logo" src="' + esc(b.logoData) + '" alt="' + esc(b.org) + ' logo">' : "") +
          "<b>" + esc(b.org) + "</b><span>" + usd(parseAmount(b.amount)) + '</span><small class="pledged">committed</small></div>';
      }).join("") + "</div>";
    }
    var panel = document.querySelector('[data-rules="' + rulesKey() + '"]');
    if (panel) {
      h += '<section class="rules-panel"><h2>' + esc(panel.querySelector("summary span").textContent) + "</h2>" +
        panel.querySelector(".md").outerHTML + '<p class="small dim rules-version">' + esc(panel.querySelector(".rules-ver").textContent) + "</p></section>";
    }
    $("#preview").innerHTML = h;
  }

  /* ---------------------------------------------------- 5. wiring */
  function updateAll() {
    renderTotals(); renderBackerHead();
    var res = runChecks();
    renderChecks(res); paintFindings(res);
    if (state.previewOpen) { renderPreview(); }
    autosave();
  }

  function applySplit(silent) {
    var res = splitDraft(v("f-paste"), state.type), filled = 0, sections = 0;
    if (res.page.title) { setV("f-title", res.page.title); filled++; }
    if (res.page.summary) { setV("f-summary", res.page.summary); filled++; }
    if (res.page.goal) { setV("f-goal", money(parseAmount(res.page.goal))); filled++; }
    if (res.page.duration) { setV("f-duration", String(intOf(res.page.duration))); filled++; }
    if (res.page.links) { setV("f-links", res.page.links); filled++; }
    if (res.page.recipient) { setV("f-recipient", res.page.recipient); filled++; }
    if (res.page.funders) { setV("f-funders", res.page.funders); }
    if (res.page.contact) { setV("f-contact", res.page.contact); }
    var backers = res.page.backers ? parseBackers(res.page.backers) : [];
    if (backers.length) { state.backers = backers.map(function (b) { b.logoName = ""; b.logoData = ""; return b; }); filled++; }
    Object.keys(res.fields).forEach(function (k) {
      if (document.getElementById("s-" + k)) { setV("s-" + k, res.fields[k]); sections++; updateWordCount(k); }
    });
    if (res.milestones.length) { state.milestones = res.milestones; }
    setV("f-unsorted", res.unsorted);
    $("#unsorted").hidden = !nonEmpty(res.unsorted);
    renderSections(); renderBackers(); renderMilestones(); updateAmountEchoes(); updateAll();
    if (!silent) {
      $("#sort-note").innerHTML = '<span class="sorted-ok">Sorted:</span> ' + sections + " sections, " + res.milestones.length +
        " milestones, " + filled + " page fields" + (nonEmpty(res.unsorted) ? ", plus text nothing matched." : ".");
    }
  }
  function sortFromPaste() { applySplit(false); }

  function setType(type, topup) {
    state.type = type; state.topup = type === "grant" ? !!topup : false;
    $("#subopt").hidden = type !== "grant";
    $("#grant-only").hidden = type !== "grant";
    $("#reviewer-row").hidden = !(type === "grant" && state.topup);
    renderRules(); renderSections(); renderMilestones(); updateAll();
  }

  /* autosave to this browser only: a closed tab does not lose an hour of work */
  function snapshot() {
    var s = { type: state.type, topup: state.topup, milestones: state.milestones,
              backers: state.backers.map(function (b) { return { org: b.org, amount: b.amount, url: b.url }; }), page: {}, fields: {} };
    ["f-title", "f-summary", "f-goal", "f-duration", "f-recipient", "f-links", "f-funders", "f-contact", "f-reviewer"].forEach(function (id) { s.page[id] = v(id); });
    Object.keys(HEADINGS).forEach(function (k) { s.fields[k] = fieldText(k); });
    return s;
  }
  var saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot())); } catch (e) { /* storage blocked: fine */ }
    }, 400);
  }
  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return false; }
    if (!raw) { return false; }
    var s;
    try { s = JSON.parse(raw); } catch (e) { return false; }
    var any = Object.keys(s.page || {}).some(function (k) { return nonEmpty(s.page[k]); }) ||
              Object.keys(s.fields || {}).some(function (k) { return nonEmpty(s.fields[k]); });
    if (!any) { return false; }
    Object.keys(s.page || {}).forEach(function (id) { setV(id, s.page[id]); });
    Object.keys(s.fields || {}).forEach(function (k) { setV("s-" + k, s.fields[k]); });
    state.milestones = (s.milestones || []).length ? s.milestones : [emptyMilestone()];
    state.backers = (s.backers || []).map(function (b) { b.logoName = ""; b.logoData = ""; return b; });
    var tRadio = document.getElementById(s.type === "grant" ? "t-grant" : "t-rfp");
    if (tRadio) { tRadio.checked = true; }
    document.getElementById("f-topup").checked = !!s.topup;
    return true;
  }

  function boot() {
    var seed = {};
    try { seed = JSON.parse(form.getAttribute("data-state") || "{}"); } catch (e) { seed = {}; }
    var serverErrors = [], serverWarns = [];
    try { serverErrors = JSON.parse(form.getAttribute("data-errors") || "[]"); serverWarns = JSON.parse(form.getAttribute("data-warnings") || "[]"); } catch (e) { /* none */ }
    var failedPost = serverErrors.length > 0 || (seed.milestones && seed.milestones.length);
    if (failedPost) {
      state.milestones = (seed.milestones || []).map(function (m) { if (!m.criteria || !m.criteria.length) { m.criteria = [""]; } return m; });
      state.backers = (seed.backers || []).map(function (b) { b.logoName = ""; b.logoData = ""; return b; });
    } else if (!restore()) {
      state.milestones = [emptyMilestone()];
      state.backers = [];
    }
    if (!state.milestones.length) { state.milestones = [emptyMilestone()]; }
    var type = document.getElementById("t-grant").checked ? "grant" : "rfp";
    state.type = type; state.topup = type === "grant" && document.getElementById("f-topup").checked;
    $("#subopt").hidden = type !== "grant"; $("#grant-only").hidden = type !== "grant";
    $("#reviewer-row").hidden = !(type === "grant" && state.topup);
    renderRules(); renderSections(); renderBackers(); renderMilestones(); updateAmountEchoes();
    if (failedPost) {
      state.submitted = true;
      updateAll();
      /* paint the server's findings too (they use form field names) */
      var first = null;
      serverErrors.forEach(function (e) {
        var t = serverTarget(e.field || "");
        if (t && mark({ target: t, msg: e.msg }, "has-error", "fld-err") && !first) { first = t; }
      });
      serverWarns.forEach(function (w) { var t = serverTarget(w.field || ""); if (t) { mark({ target: t, msg: w.msg }, "has-warn", "fld-warn"); } });
      var el = first ? document.getElementById(first) : $("#server-errors");
      bringIntoView(el);
    } else {
      updateAll();
    }
  }

  /* copy the guide */
  var btn = document.getElementById("copy-guide");
  if (btn) {
    var original = btn.textContent;
    btn.addEventListener("click", function () {
      fetch("/llms.txt").then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (text) { return navigator.clipboard.writeText(text); })
        .then(function () { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = original; }, 2500); })
        .catch(function () { btn.textContent = "Copy failed: open /llms.txt"; setTimeout(function () { btn.textContent = original; }, 4000); });
    });
  }

  document.getElementById("t-rfp").addEventListener("change", function () { setType("rfp", false); });
  document.getElementById("t-grant").addEventListener("change", function () { setType("grant", document.getElementById("f-topup").checked); });
  document.getElementById("f-topup").addEventListener("change", function () { setType("grant", this.checked); });

  ["f-title", "f-summary", "f-goal", "f-duration", "f-recipient", "f-links", "f-funders", "f-contact", "f-reviewer"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.addEventListener("input", function () { if (id === "f-goal") { updateAmountEchoes(); } updateAll(); }); }
  });
  document.getElementById("f-goal").addEventListener("change", function () {
    var n = parseAmount(this.value); if (n) { this.value = money(n); } updateAmountEchoes(); updateAll();
  });

  $("#sections").addEventListener("input", function (e) {
    var k = e.target.getAttribute("data-k");
    if (!k) { return; }
    updateWordCount(k); updateAll();
  });
  $("#sections").addEventListener("click", function (e) {
    var b = e.target.closest(".ex-btn");
    if (!b) { return; }
    var box = document.getElementById("ex-" + b.getAttribute("data-ex"));
    var open = box.hidden; box.hidden = !open;
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.textContent = open ? "Hide example" : "Show example";
  });

  /* backer rows: update in place */
  function readBk(e) {
    var row = e.target.closest(".bk-row");
    if (!row) { return null; }
    var i = parseInt(row.getAttribute("data-i"), 10), b = state.backers[i], k = e.target.getAttribute("data-bk");
    if (!b || !k) { return null; }
    return { b: b, k: k, el: e.target, row: row, i: i };
  }
  function refreshBkChip(r) {
    var old = r.row.querySelector(".bk-chip");
    if (old) { old.parentNode.removeChild(old); }
    var chip = backerChip(r.b);
    if (chip) { r.row.insertAdjacentHTML("beforeend", chip); }
  }
  $("#bk-rows").addEventListener("input", function (e) {
    var r = readBk(e);
    if (!r) { return; }
    if (r.k === "amount") { r.b.amount = parseAmount(r.el.value); updateAmountEcho(r.el, r.b.amount); }
    else if (r.k !== "logo") { r.b[r.k] = r.el.value; }
    refreshBkChip(r); updateAll();
  });
  $("#bk-rows").addEventListener("change", function (e) {
    var r = readBk(e);
    if (!r) { return; }
    if (r.k === "amount" && r.b.amount) { r.el.value = money(r.b.amount); }
    if (r.k === "logo") {
      var f = r.el.files && r.el.files[0];
      if (!f) { r.b.logoName = ""; r.b.logoData = ""; refreshBkChip(r); updateAll(); return; }
      var reader = new FileReader();
      reader.onload = function () { r.b.logoName = f.name; r.b.logoData = String(reader.result); refreshBkChip(r); updateAll(); };
      reader.readAsDataURL(f);
      return;
    }
    updateAll();
  });
  $("#bk-rows").addEventListener("click", function (e) {
    var del = e.target.closest(".bk-del");
    if (!del) { return; }
    var row = del.closest(".bk-row"), i = parseInt(row.getAttribute("data-i"), 10);
    state.backers.splice(i, 1);
    row.parentNode.removeChild(row);
    if (!state.backers.length) { renderBackers(); } else { renumberBackers(); }
    updateAll();
  });
  $("#btn-add-bk").addEventListener("click", function () {
    var wasEmpty = !state.backers.length;
    state.backers.push(emptyBacker());
    if (wasEmpty) { renderBackers(); }
    else {
      var i = state.backers.length - 1, div = document.createElement("div");
      div.className = "bk-row"; div.setAttribute("data-i", i); div.innerHTML = backerRowHtml(state.backers[i], i);
      $("#bk-rows").appendChild(div);
    }
    updateAll();
    var rows = document.querySelectorAll('.bk-row input[data-bk="org"]');
    if (rows.length) { rows[rows.length - 1].focus(); }
  });

  /* milestone rows */
  function readRow(e) {
    var row = e.target.closest(".ms-row");
    if (!row) { return null; }
    var i = parseInt(row.getAttribute("data-i"), 10), m = state.milestones[i], k = e.target.getAttribute("data-mk");
    if (!m || !k) { return null; }
    return { m: m, k: k, el: e.target, i: i };
  }
  function readRowFromEl(el) {
    var row = el.closest(".ms-row");
    if (!row) { return null; }
    var i = parseInt(row.getAttribute("data-i"), 10);
    return { m: state.milestones[i], i: i };
  }
  function focusCrit(i, j) { var el = document.getElementById("ms-" + i + "-c" + j); if (el) { el.focus(); } }
  $("#ms-rows").addEventListener("input", function (e) {
    var r = readRow(e);
    if (!r) { return; }
    if (r.k === "crit") { r.m.criteria[parseInt(r.el.getAttribute("data-ci"), 10)] = r.el.value.replace(/[\r\n]+/g, " "); }
    else if (r.k === "amount") { r.m.amount = parseAmount(r.el.value); updateAmountEcho(r.el, r.m.amount); }
    else if (r.k !== "adoption" && r.k !== "done") { r.m[r.k] = r.el.value; }
    updateAll();
  });
  $("#ms-rows").addEventListener("change", function (e) {
    var r = readRow(e);
    if (!r) { return; }
    if (r.k === "adoption") { r.m.adoption = r.el.checked; }
    if (r.k === "done") { r.m.done = r.el.checked; renderMilestones(); }
    if (r.k === "amount" && r.m.amount) { r.el.value = money(r.m.amount); }
    updateAll();
  });
  $("#ms-rows").addEventListener("click", function (e) {
    var del = e.target.closest(".ms-del");
    if (del) { state.milestones.splice(parseInt(del.getAttribute("data-del"), 10), 1); renderMilestones(); updateAll(); return; }
    var cdel = e.target.closest(".crit-del");
    if (cdel) {
      var r1 = readRowFromEl(cdel);
      if (r1) { r1.m.criteria.splice(parseInt(cdel.getAttribute("data-cdel"), 10), 1); renderMilestones(); updateAll(); }
      return;
    }
    var add = e.target.closest(".crit-add");
    if (add) {
      var r2 = readRowFromEl(add);
      if (r2) { r2.m.criteria.push(""); renderMilestones(); updateAll(); focusCrit(r2.i, r2.m.criteria.length - 1); }
    }
  });
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") { return; }
    if (e.target.getAttribute("data-mk") === "crit") {  /* a criterion is one line: Enter starts the next one */
      e.preventDefault();
      var r = readRowFromEl(e.target);
      if (!r) { return; }
      var at = parseInt(e.target.getAttribute("data-ci"), 10) + 1;
      r.m.criteria.splice(at, 0, "");
      renderMilestones(); updateAll(); focusCrit(r.i, at);
      return;
    }
    if (e.target.tagName === "INPUT" && e.target.type !== "submit") { e.preventDefault(); }
  });
  $("#btn-add-ms").addEventListener("click", function () {
    state.milestones.push(emptyMilestone()); renderMilestones(); updateAll();
    var rows = document.querySelectorAll(".ms-row input[data-mk='name']");
    if (rows.length) { rows[rows.length - 1].focus(); }
  });

  /* paste, preview, submit */
  $("#f-paste").addEventListener("paste", function () { setTimeout(sortFromPaste, 0); });
  $("#btn-preview").addEventListener("click", function () {
    state.previewOpen = !state.previewOpen;
    $("#preview").hidden = !state.previewOpen;
    this.setAttribute("aria-expanded", state.previewOpen ? "true" : "false");
    this.textContent = state.previewOpen ? "Hide the page view" : "See it as a page";
    if (state.previewOpen) { renderPreview(); }
  });

  form.addEventListener("submit", function (e) {
    state.submitted = true;
    var res = runChecks();
    renderTotals(); renderBackerHead(); renderChecks(res);
    var first = paintFindings(res);
    if (res.errs.length) {
      e.preventDefault();
      var el = first ? document.getElementById(first) : null;
      if (el) { try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); } bringIntoView(el); }
      else { bringIntoView($("#checks")); }
      return;
    }
    /* clean: serialize the rows and let the real POST go through */
    document.getElementById("milestones-json").value = JSON.stringify(state.milestones.map(function (m) {
      return { name: m.name, amount: parseAmount(m.amount), adoption: !!m.adoption, done: !!m.done,
               link: m.link || "", month: m.month || "", criteria: m.criteria.filter(nonEmpty) };
    }));
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (err) { /* fine */ }
  });

  boot();
})();
