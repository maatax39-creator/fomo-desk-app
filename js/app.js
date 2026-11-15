/* FOMO Desk · app v2. Plain JS, no frameworks, no CDNs.
   Config comes only from the URL fragment, then localStorage.
   FOMO URLs are taken from the published JSON as-is and never rebuilt here.
   Only real desk data is shown; nothing is simulated. */
(function () {
  "use strict";

  var DEFAULT_SUPABASE = "https://latlkpoibmnqveeonxhx.supabase.co";
  var POLL_MS = 15000;
  var STALE_MS = 150000;
  var TZ = "Europe/Zagreb";
  var STORAGE_KEY = "desk.cfg";
  var SEEN_KEY = "desk.seenActivity";
  var TOAST_KEY = "desk.toastId";
  var ATH_KEY = "desk.ath";
  var MILES_KEY = "desk.milesSeen";
  var RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  var AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  var AGENT_TITLE = {
    scanner: "Scanner", auditor: "Auditor", analyst: "Analyst",
    executor: "Executor", risk: "Risk", devwatch: "Dev Watch"
  };
  var AGENT_EMOJI = {
    scanner: "📡", auditor: "🔬", analyst: "👾", executor: "⚙️", risk: "🛡️", devwatch: "👀"
  };
  var C = { green: "#4ADE80", red: "#F87171", blue: "#3B82F6", grey: "#8a8a8a", amber: "#FBBF24", cyan: "#67E8F9" };
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- config (fragment → localStorage) ---------- */

  function readFragment() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return {};
    var out = {};
    raw.split("&").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) { if (part) out[decodeURIComponent(part)] = ""; return; }
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    });
    return out;
  }

  function loadStored() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {}; } catch (e) { return {}; }
  }

  function saveStored(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ t: cfg.t || "", d: cfg.d || "", u: cfg.u || "" }));
  }

  function bootConfig() {
    var frag = readFragment();
    var stored = loadStored();
    var cfg = {
      t: frag.t || stored.t || "",
      d: frag.d || stored.d || "",
      u: (frag.u || frag.s || stored.u || DEFAULT_SUPABASE).replace(/\/$/, "")
    };
    if (location.hash) {
      if (cfg.t && cfg.d) saveStored(cfg);
      // iPhone: "Add to Home Screen" saves the current URL, and the home-screen
      // app does not share Safari's storage. So keep the fragment while running
      // in a browser tab; strip it only inside the installed (standalone) app.
      // The fragment is never sent to any server.
      var standalone = window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
      if (standalone) history.replaceState(null, "", location.pathname + location.search);
    }
    return cfg;
  }

  var CFG = bootConfig();

  function dataUrl(rel) {
    return CFG.u + "/storage/v1/object/public/desk/d/" + CFG.d + "/" + rel + "?t=" + Date.now();
  }

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function fmtUsd(n, digits) {
    if (n == null || isNaN(n)) return "n/a";
    var d = digits == null ? 2 : digits;
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(Number(n));
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtPct(n, digits) {
    if (n == null || isNaN(n)) return "n/a";
    var d = digits == null ? 2 : digits;
    var v = Number(n);
    return (v > 0 ? "+" : "") + v.toFixed(d) + "%";
  }

  function fmtMult(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toFixed(2) + "x";
  }

  function fmtAge(min) {
    if (min == null || isNaN(min)) return "";
    var m = Math.max(0, Math.round(Number(min)));
    if (m < 60) return m + "m old";
    var h = Math.floor(m / 60);
    if (h < 48) return h + "h old";
    return Math.floor(h / 24) + "d old";
  }

  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtTime(iso) {
    var d = toDate(iso);
    if (!d) return "";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  }

  function fmtTimeZ(iso) {
    var d = toDate(iso);
    if (!d) return "";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ, timeZoneName: "short" });
  }

  function fmtTimeFull(iso) {
    var d = toDate(iso);
    if (!d) return "";
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
  }

  function fmtWhen(iso) {
    var d = toDate(iso);
    if (!d) return "";
    var today = new Date().toLocaleDateString("en-GB", { timeZone: TZ });
    var day = d.toLocaleDateString("en-GB", { timeZone: TZ });
    return day === today ? fmtTime(iso) : fmtTimeFull(iso);
  }

  function shortUsd(n) {
    if (n == null || isNaN(n)) return "n/a";
    var a = Math.abs(Number(n));
    var sign = n < 0 ? "-" : "";
    if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
    return fmtUsd(n, a >= 100 ? 0 : 2);
  }

  function classifyVal(text) {
    if (text == null) return "";
    var t = String(text).trim();
    if (/^skipped/i.test(t)) return "skip";
    if (t.charAt(0) === "+" || t.charAt(0) === "▲") return "up";
    if (t.charAt(0) === "-" || t.charAt(0) === "▼" || t.indexOf("-$") === 0) return "down";
    return "";
  }

  function isIso(s) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s || "")); }

  function reduced() { return REDUCE; }

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  /* ---------- data store ---------- */

  var state = {
    boot: true, ready: false, offline: false, retryIn: 0, lastOk: null, lastError: null,
    range: "LIVE", tab: "home", screen: "home", mint: null, query: "",
    data: { state: null, charts: {}, activity: null, account: null, settings: null, recap: null, decisions: {}, coins: {}, audits: {} }
  };

  function mode() {
    var s = state.data.state;
    return String((s && s.mode) || (state.data.account && state.data.account.mode) || "PAPER").toUpperCase();
  }

  function isPaper() { return mode() !== "LIVE"; }

  function deskFresh() {
    var s = state.data.state;
    var d = s && toDate(s.ts);
    if (!d || state.offline) return false;
    return (Date.now() - d.getTime()) < STALE_MS;
  }

  function agentAlive(a) {
    if (!a || a.status !== "running") return false;
    var d = toDate(a.heartbeat);
    return !!d && (Date.now() - d.getTime()) < STALE_MS && !state.offline;
  }

  function startStack() {
    var acc = state.data.account || {};
    if (acc.stack != null && !isNaN(acc.stack)) return Number(acc.stack);
    var st = state.data.state || {};
    if (st.multiplier && st.balance != null) return Number(st.balance) / Number(st.multiplier);
    return null;
  }

  function openCount() {
    var r = ((state.data.state && state.data.state.agents) || []).filter(function (a) { return a.name === "risk"; })[0];
    return (r && r.open_positions) || 0;
  }

  /* ---------- fetch ---------- */

  function getJson(rel) {
    return fetch(dataUrl(rel), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  function pullCore() {
    return Promise.all([
      getJson("state.json"),
      getJson("chart-" + state.range + ".json").catch(function () { return getJson("chart.json"); }),
      getJson("activity.json"),
      getJson("account.json"),
      getJson("settings.json"),
      getJson("recap.json").catch(function () { return null; })
    ]).then(function (arr) {
      state.data.state = arr[0];
      state.data.charts[state.range] = arr[1];
      state.data.activity = arr[2];
      state.data.account = arr[3];
      state.data.settings = arr[4];
      if (arr[5]) state.data.recap = arr[5];
      state.offline = false;
      state.lastOk = new Date();
      state.lastError = null;
      state.ready = true;
      state.retryIn = 0;
    });
  }

  function pullDecisions() {
    return Promise.all(AGENTS.map(function (n) {
      return getJson("agents/" + n + "/decisions.json").then(function (j) { state.data.decisions[n] = j; }).catch(function () {});
    }));
  }

  function pullMint(mint) {
    if (!mint) return Promise.resolve();
    return Promise.all([
      getJson("coin/" + mint + ".json").then(function (j) { state.data.coins[mint] = j; }).catch(function () {}),
      getJson("audit/" + mint + ".json").then(function (j) { state.data.audits[mint] = j; }).catch(function () {})
    ]);
  }

  var retryTimer = 0;
  var pollTimer = 0;

  function scheduleRetry() {
    state.retryIn = Math.max(state.retryIn > 0 ? Math.min(state.retryIn * 2, 60) : 5, 5);
    clearInterval(retryTimer);
    var left = state.retryIn;
    retryTimer = setInterval(function () {
      left -= 1;
      state.retryIn = left;
      paintBannerOnly();
      if (left <= 0) { clearInterval(retryTimer); refresh(); }
    }, 1000);
    paint();
  }

  function refresh() {
    if (!CFG.t || !CFG.d) return Promise.resolve();
    return pullCore().then(function () {
      var extra = [pullDecisions()];
      if (state.mint) extra.push(pullMint(state.mint));
      return Promise.all(extra);
    }).then(function () {
      state.boot = false;
      detectEvents();
      paint();
    }).catch(function (err) {
      state.offline = true;
      state.lastError = String((err && err.message) || err);
      state.boot = false;
      if (!state.ready) paint();
      scheduleRetry();
    });
  }

  /* ---------- events: toasts + confetti (real data only) ---------- */

  function detectEvents() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var maxId = 0;
    rows.forEach(function (r) { if ((r.id || 0) > maxId) maxId = r.id; });
    var lastToast = Number(lsGet(TOAST_KEY, "-1"));
    if (lastToast < 0) {
      lsSet(TOAST_KEY, maxId); /* first run: baseline, no backlog toasts */
    } else if (maxId > lastToast) {
      rows.filter(function (r) {
        return r.id > lastToast && /^(bought|sold|stopped)$/i.test(r.kind || "");
      }).sort(function (a, b) { return a.id - b.id; }).slice(-3).forEach(function (r, i) {
        setTimeout(function () { toastRow(r); }, i * 1400);
      });
      lsSet(TOAST_KEY, maxId);
    }

    var st = state.data.state || {};
    var bal = Number(st.balance);
    var start = startStack();
    if (!isNaN(bal)) {
      var athRaw = lsGet(ATH_KEY, "");
      if (athRaw === "") lsSet(ATH_KEY, bal);
      else if (bal > Number(athRaw) + 0.005) {
        lsSet(ATH_KEY, bal);
        if (start != null && bal > start) {
          confetti();
          toast({ kind: "ath", title: "New all-time high", sub: fmtUsd(bal) + " · " + fmtMult(st.multiplier), val: "" });
        }
      }
    }
    var miles = ((state.data.recap && state.data.recap.milestones_hit) || []).map(function (m) {
      return String(m && m.multiple != null ? m.multiple : m);
    });
    var seenRaw = lsGet(MILES_KEY, "");
    var seen = seenRaw ? seenRaw.split(",") : null;
    if (seen === null) lsSet(MILES_KEY, miles.join(","));
    else {
      var fresh = miles.filter(function (m) { return seen.indexOf(m) === -1; });
      if (fresh.length) {
        confetti();
        toast({ kind: "mile", title: "Milestone " + fresh[fresh.length - 1] + "x", sub: "Stack hit " + fresh[fresh.length - 1] + "x the start", val: "" });
        lsSet(MILES_KEY, miles.join(","));
      }
    }
  }

  var toastHost = null;
  function ensureToastHost() {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "toasts";
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }

  function toastRow(r) {
    var parts = String(r.value || "").split(" · ");
    var sub = r.subtitle && !isIso(r.subtitle) ? r.subtitle : (r.agent ? AGENT_TITLE[r.agent] || r.agent : "");
    toast({ kind: (r.kind || "").toLowerCase(), title: r.title || "", sub: [sub].concat(parts.slice(1)).filter(Boolean).join(" · "), val: parts[0] || "" });
  }

  function toast(t) {
    var host = ensureToastHost();
    var el = document.createElement("div");
    var vc = classifyVal(t.val);
    el.className = "toast-card k-" + esc(t.kind || "info");
    el.innerHTML = '<img class="toast-ic" src="icons/icon-192.png" alt="">' +
      '<div class="toast-txt"><div class="toast-t">' + esc(t.title) + "</div>" +
      (t.sub ? '<div class="toast-s">' + esc(t.sub) + "</div>" : "") + "</div>" +
      '<div class="toast-r"><span class="toast-now">now</span>' +
      (t.val ? '<span class="toast-v ' + vc + '">' + esc(t.val) + "</span>" : "") + "</div>";
    host.appendChild(el);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add("in"); }); });
    el.addEventListener("click", function () { el.classList.remove("in"); });
    setTimeout(function () {
      el.classList.remove("in");
      setTimeout(function () { el.remove(); }, 450);
    }, 4200);
  }

  function confetti() {
    if (reduced()) return;
    var cv = document.createElement("canvas");
    cv.className = "confetti";
    document.body.appendChild(cv);
    var dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    var cols = [C.green, C.blue, "#fff", C.amber, C.red, "#A78BFA"];
    var ps = [];
    for (var i = 0; i < 140; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      var sp = 7 + Math.random() * 9;
      ps.push({ x: W / 2, y: H * 0.32, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.4, w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, c: cols[i % cols.length] });
    }
    var t0 = performance.now();
    (function frame(now) {
      var el = now - t0;
      ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - el / 2600);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (el < 2600) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  /* ---------- navigation ---------- */

  function go(screen, opt) {
    opt = opt || {};
    state.screen = screen;
    if (screen === "home" || screen === "agents" || screen === "activity" || screen === "account") state.tab = screen;
    if (opt.mint) state.mint = opt.mint;
    if (screen === "activity") markActivitySeen();
    paint(true);
    if (opt.mint) pullMint(opt.mint).then(function () { paint(); });
  }

  function openRow(row) {
    if (!row || !row.mint) return;
    var agent = (row.agent || "").toLowerCase();
    var kind = (row.kind || "").toLowerCase();
    if (agent === "auditor" || agent === "analyst" || kind === "rejected") go("audit", { mint: row.mint });
    else go("coin", { mint: row.mint });
  }

  function unreadCount() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var seen = Number(lsGet(SEEN_KEY, 0));
    var n = 0;
    for (var i = 0; i < rows.length; i++) if ((rows[i].id || 0) > seen) n++;
    return n;
  }

  function markActivitySeen() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var max = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].id > max) max = rows[i].id;
    lsSet(SEEN_KEY, max);
  }

  /* ---------- icons ---------- */

  function ico(name) {
    var s = 'xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
    if (name === "home") return '<svg ' + s + '><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>';
    if (name === "agents") return '<svg ' + s + '><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M3 13v2M21 13v2"/></svg>';
    if (name === "activity") return '<svg ' + s + '><path d="M4 12h3.2l2.1-6 3.4 12 2.2-6H20"/></svg>';
    if (name === "account") return '<svg ' + s + '><circle cx="12" cy="9" r="3"/><path d="M6 19c.8-2.8 3-4.2 6-4.2s5.2 1.4 6 4.2"/></svg>';
    if (name === "search") return '<svg ' + s + '><circle cx="11" cy="11" r="6"/><path d="M16 16.5 20 20.5"/></svg>';
    if (name === "bell") return '<svg ' + s + '><path d="M6.5 16h11v-5.2a5.5 5.5 0 0 0-11 0z"/><path d="M10 16v.8a2 2 0 0 0 4 0V16"/></svg>';
    if (name === "back") return '<svg ' + s + '><path d="M15 5 8 12l7 7"/></svg>';
    if (name === "buy") return '<svg ' + s + '><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    if (name === "sell") return '<svg ' + s + '><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
    if (name === "stop") return '<svg ' + s + '><path d="M7 7l10 10M17 7 7 17"/></svg>';
    if (name === "skip") return '<svg ' + s + '><path d="M5 12h14"/></svg>';
    return "";
  }

  /* ---------- balance count-up ---------- */

  var balShown = null;
  var balAnim = 0;

  function animateBalance(target) {
    var el = document.getElementById("bal-num");
    if (!el || target == null || isNaN(target)) return;
    target = Number(target);
    if (balShown == null || reduced() || Math.abs(balShown - target) < 0.005) {
      balShown = target;
      el.textContent = fmtUsd(target);
      return;
    }
    var from = balShown, t0 = performance.now(), dur = 900;
    cancelAnimationFrame(balAnim);
    var up = target > from;
    el.classList.remove("tick-up", "tick-down");
    void el.offsetWidth;
    el.classList.add(up ? "tick-up" : "tick-down");
    (function step(now) {
      var u = Math.min(1, (now - t0) / dur);
      var v = from + (target - from) * (1 - Math.pow(1 - u, 3));
      var cur = document.getElementById("bal-num");
      if (cur) cur.textContent = fmtUsd(v);
      balShown = v;
      if (u < 1) balAnim = requestAnimationFrame(step); else balShown = target;
    })(t0);
  }

  /* ---------- canvas: equity chart ---------- */

  var chartIntro = { range: null, start: 0 };

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function markStyle(m) {
    var k = String(m.kind || "").toLowerCase();
    if (k === "bought") return { col: C.blue, text: "Buy" + (m.value != null ? " " + fmtUsd(m.value) : "") };
    if (k === "stopped") return { col: C.red, text: m.label || "Stop" };
    var v = Number(m.value);
    return { col: v < 0 ? C.red : C.green, text: m.label || "Sell" };
  }

  function drawLineChart(canvas, chart) {
    if (!canvas || !chart) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 390;
    var cssH = canvas.clientHeight || 210;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var pts = (chart.points || []).map(function (p) { return { t: toDate(p.t), v: Number(p.v) }; })
      .filter(function (p) { return p.t && !isNaN(p.v); });
    var marks = chart.marks || [];
    var startVal = chart.start_value != null ? Number(chart.start_value) : (pts[0] ? pts[0].v : 0);
    var padL = 12, padR = 14, padT = 34, padB = 14;
    var w = cssW - padL - padR, h = cssH - padT - padB;

    var vals = pts.map(function (p) { return p.v; }).concat([startVal]);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < Math.max(0.02, Math.abs(max) * 0.004)) { var mid = (max + min) / 2, pad = Math.max(0.5, Math.abs(mid) * 0.04); min = mid - pad; max = mid + pad; }
    else { var sp = max - min; min -= sp * 0.08; max += sp * 0.12; }
    function yAt(v) { return padT + (1 - (v - min) / (max - min)) * h; }

    var tMin = pts.length ? pts[0].t.getTime() : Date.now();
    var tMax = pts.length ? pts[pts.length - 1].t.getTime() : Date.now();
    marks.forEach(function (m) { var d = toDate(m.t); if (d) { tMin = Math.min(tMin, d.getTime()); tMax = Math.max(tMax, d.getTime()); } });
    function xAt(t) { return tMax === tMin ? padL + w : padL + ((t - tMin) / (tMax - tMin)) * w; }

    var last = pts.length ? pts[pts.length - 1].v : startVal;
    var col = last < startVal - 0.0001 ? C.red : C.green;
    var rgb = col === C.red ? "248,113,113" : "74,222,128";

    /* intro sweep */
    var prog = 1;
    if (!reduced()) {
      if (chartIntro.range !== chart.range) chartIntro = { range: chart.range, start: performance.now() };
      prog = easeOut(Math.min(1, (performance.now() - chartIntro.start) / 700));
    }

    /* baseline */
    var y0 = yAt(startVal);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + w, y0); ctx.stroke();
    ctx.restore();

    var line = pts.length === 1 ? [{ x: padL, y: yAt(pts[0].v) }, { x: padL + w, y: yAt(pts[0].v) }]
      : pts.map(function (p) { return { x: xAt(p.t.getTime()), y: yAt(p.v) }; });
    if (!line.length) line = [{ x: padL, y: y0 }, { x: padL + w, y: y0 }];

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, padL + w * prog + 2, cssH); ctx.clip();
    /* fill */
    ctx.beginPath();
    line.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.lineTo(line[line.length - 1].x, padT + h + padB);
    ctx.lineTo(line[0].x, padT + h + padB);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, cssH);
    grad.addColorStop(0, "rgba(" + rgb + ",0.32)");
    grad.addColorStop(0.6, "rgba(" + rgb + ",0.07)");
    grad.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = grad; ctx.fill();
    /* glow line */
    ctx.beginPath();
    line.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(" + rgb + ",0.9)"; ctx.shadowBlur = 12;
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    /* end dot */
    if (prog >= 1) {
      var e = line[line.length - 1];
      var pulse = reduced() ? 0.5 : (Math.sin(performance.now() / 380) + 1) / 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, 7 + pulse * 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + rgb + "," + (0.18 - pulse * 0.1) + ")"; ctx.fill();
      ctx.beginPath(); ctx.arc(e.x, e.y, 3.6, 0, Math.PI * 2);
      ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
    }

    /* marker pills, stacked so they do not overlap */
    var used = [];
    var font = "700 10.5px " + getComputedStyle(document.body).fontFamily;
    marks.forEach(function (m) {
      var d = toDate(m.t);
      if (!d) return;
      var ms = markStyle(m);
      var mx = xAt(d.getTime());
      var my = pts.length ? yAt(nearestVal(pts, d.getTime())) : y0;
      ctx.font = font;
      var tw = ctx.measureText(ms.text).width + 16, ph = 18;
      var lx = Math.max(2, Math.min(mx - tw / 2, cssW - tw - 2));
      var ty = Math.max(2, my - ph - 10);
      var guard = 0;
      while (guard++ < 6 && used.some(function (u) { return !(lx + tw < u.x || lx > u.x + u.w) && Math.abs(u.y - ty) < ph + 2; })) ty -= ph + 3;
      ty = Math.max(2, ty);
      used.push({ x: lx, w: tw, y: ty });
      ctx.globalAlpha = prog;
      ctx.strokeStyle = ms.col; ctx.globalAlpha = prog * 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, ty + ph); ctx.lineTo(mx, my); ctx.stroke();
      ctx.globalAlpha = prog;
      ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.fillStyle = ms.col; ctx.fill();
      roundRect(ctx, lx, ty, tw, ph, 9);
      ctx.shadowColor = ms.col; ctx.shadowBlur = 10;
      ctx.fillStyle = ms.col; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = ms.col === C.blue ? "#fff" : "#04110a";
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(ms.text, lx + tw / 2, ty + ph / 2 + 0.5);
      ctx.globalAlpha = 1; ctx.textAlign = "start";
    });
  }

  function nearestVal(pts, tm) {
    var best = pts[0].v, bd = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(pts[i].t.getTime() - tm);
      if (d < bd) { bd = d; best = pts[i].v; }
    }
    return best;
  }

  var chartLoop = 0;
  function runChartLoop() {
    cancelAnimationFrame(chartLoop);
    if (reduced()) return;
    var last = 0;
    (function loop(now) {
      var hc = document.getElementById("home-chart");
      if (!hc || state.screen !== "home") return;
      if (now - last > (now - chartIntro.start < 800 ? 30 : 110)) { drawLineChart(hc, state.data.charts[state.range]); last = now; }
      chartLoop = requestAnimationFrame(loop);
    })(performance.now());
  }
  /* ---------- canvas: candles ---------- */

  function drawCandles(canvas, coin) {
    if (!canvas || !coin) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 390;
    var cssH = canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var bars = coin.candles || [];
    var padL = 16, padR = 16, padT = 12, volH = 36, padB = 8;
    var h = cssH - padT - padB - volH - 6;
    var w = cssW - padL - padR;
    if (!bars.length) {
      ctx.fillStyle = "#8a8a8a";
      ctx.font = "13px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "center";
      ctx.fillText("Waiting for prices", cssW / 2, cssH / 2);
      return;
    }
    var highs = bars.map(function (b) { return b.h; });
    var lows = bars.map(function (b) { return b.l; });
    var lines = coin.exit_lines || {};
    if (lines.stop != null) { highs.push(lines.stop); lows.push(lines.stop); }
    if (lines.trail != null) { highs.push(lines.trail); lows.push(lines.trail); }
    var min = Math.min.apply(null, lows);
    var max = Math.max.apply(null, highs);
    if (min === max) { min -= min * 0.01 || 0.0001; max += max * 0.01 || 0.0001; }
    function yAt(v) { return padT + (1 - (v - min) / (max - min)) * h; }
    var gap = w / bars.length;
    var bw = Math.max(1, gap * 0.62);
    bars.forEach(function (b, i) {
      var x = padL + i * gap + gap / 2;
      var up = b.c >= b.o;
      ctx.strokeStyle = ctx.fillStyle = up ? "#4ADE80" : "#F87171";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yAt(b.h));
      ctx.lineTo(x, yAt(b.l));
      ctx.stroke();
      var y1 = yAt(Math.max(b.o, b.c));
      var y2 = yAt(Math.min(b.o, b.c));
      var bh = Math.max(1, y2 - y1);
      ctx.fillRect(x - bw / 2, y1, bw, bh);
    });
    var exit = lines.trail != null ? lines.trail : lines.stop;
    if (exit != null) {
      var ye = yAt(Number(exit));
      ctx.save();
      ctx.strokeStyle = "#FBBF24";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, ye);
      ctx.lineTo(padL + w, ye);
      ctx.stroke();
      ctx.restore();
    }
    var vols = bars.map(function (b) { return Math.abs(b.volume || 0); });
    var vmax = Math.max.apply(null, vols.concat([0]));
    var base = padT + h + 8 + volH;
    bars.forEach(function (b, i) {
      var x = padL + i * gap + gap / 2;
      var vh = vmax ? (Math.abs(b.volume || 0) / vmax) * volH : 0;
      ctx.fillStyle = (b.c >= b.o) ? "rgba(74,222,128,0.55)" : "rgba(248,113,113,0.55)";
      ctx.fillRect(x - bw / 2, base - vh, bw, vh);
    });
  }

  /* ---------- canvas: score ring ---------- */

  function drawRing(canvas, score, minScore) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 112;
    var cssH = canvas.clientHeight || 112;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var cx = cssW / 2, cy = cssH / 2, r = Math.min(cssW, cssH) / 2 - 8;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f1f1f";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (score == null || isNaN(score)) {
      ctx.fillStyle = "#fff";
      ctx.font = "650 22px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("—", cx, cy);
      return;
    }
    var s = Math.max(0, Math.min(100, Number(score)));
    var col = s >= (minScore || 70) ? "#4ADE80" : "#FBBF24";
    if (s < 40) col = "#F87171";
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (s / 100) * Math.PI * 2, false);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 26px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(s)), cx, cy - 2);
  }

  /* ---------- auditor discs + beam ---------- */

  var beam = { mint: null, layer: 0, phase: "beam", started: 0, revealed: 0 };

  function resetBeam(mint) {
    beam = { mint: mint, layer: 0, phase: "beam", started: performance.now(), revealed: 0 };
  }

  function drawDiscs(canvas, audit) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 390;
    var cssH = canvas.clientHeight || 268;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var layers = (audit && audit.layers) || [];
    var n = 8;
    var cx = cssW / 2;
    var r = Math.min(84, cssW * 0.22);
    var top = 28, bottom = cssH - 16;
    var gap = (bottom - top - 16) / (n - 1);

    if (beam.mint !== (audit && audit.mint)) resetBeam(audit && audit.mint);
    var now = performance.now();
    if (!reduced()) {
      if (beam.phase === "beam") {
        var need = layers[beam.layer] && layers[beam.layer].checked;
        if (need || (layers[beam.layer] && layers[beam.layer].value && layers[beam.layer].value !== "not checked")) {
          if (now - beam.started >= 350) {
            beam.phase = "lock";
            beam.started = now;
          }
        }
      } else if (beam.phase === "lock") {
        if (now - beam.started >= 150) {
          beam.revealed = beam.layer + 1;
          if (beam.layer < 7) {
            beam.layer += 1;
            beam.phase = "beam";
            beam.started = now;
          } else {
            beam.phase = "done";
            beam.revealed = 8;
          }
        }
      }
    } else {
      beam.revealed = 8;
      beam.phase = "done";
    }

    for (var i = 0; i < n; i++) {
      var y = top + i * gap;
      var ly = layers[i] || {};
      var shown = i < beam.revealed;
      var passing = shown && ly.checked && ly.pass === true;
      var failing = shown && ly.checked && ly.pass === false;
      ctx.beginPath();
      ctx.ellipse(cx, y, r, 11, 0, 0, Math.PI * 2);
      if (passing) ctx.fillStyle = "rgba(74,222,128,0.85)";
      else if (failing) ctx.fillStyle = "rgba(248,113,113,0.85)";
      else ctx.fillStyle = "#1f1f1f";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (shown && (passing || failing)) {
        ctx.fillStyle = "#000";
        ctx.font = "700 11px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(passing ? "✓" : "✕", cx, y);
      }
    }

    if (beam.phase !== "done") {
      var yb;
      if (beam.phase === "beam") {
        var t = Math.min(1, (now - beam.started) / 350);
        var yA = top + beam.layer * gap;
        var yB = top + Math.min(7, beam.layer) * gap;
        /* stay on this layer while waiting; only travel onto it */
        yb = yA;
        if (t < 1 && beam.layer > 0) {
          var yPrev = top + (beam.layer - 1) * gap;
          yb = lerp(yPrev, yA, easeOut(t));
        }
      } else {
        yb = top + beam.layer * gap;
      }
      ctx.save();
      ctx.strokeStyle = "#67E8F9";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(cx - r - 18, yb);
      ctx.lineTo(cx + r + 18, yb);
      ctx.stroke();
      ctx.restore();
      requestAnimationFrame(function () {
        if (state.screen === "audit") drawDiscs(canvas, audit);
      });
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- chrome ---------- */

  function statusPill() {
    var st = state.data.state || {};
    var fresh = deskFresh();
    var cls, label;
    if (state.offline) { cls = "off"; label = "Offline"; }
    else if (!fresh) { cls = "stale"; label = "Offline"; }
    else if (isPaper()) { cls = "live"; label = "PAPER"; }
    else { cls = "real"; label = "LIVE"; }
    var when = st.ts ? fmtTimeZ(st.ts) : "";
    return '<div class="status"><span class="st-pill ' + cls + '"><i></i>' + label + "</span>" +
      '<span class="st-time">' + esc(when ? "updated " + when : "waiting") + "</span></div>";
  }

  function header() {
    var n = openCount();
    return '<header class="hdr">' +
      '<button class="hdr-id" data-go="account" aria-label="Account"><img class="app-ic" src="icons/icon-192.png" alt=""></button>' +
      '<div class="hdr-title"><div class="hdr-name">FOMO Desk</div>' +
      '<div class="hdr-sub">⚡ fomo • ' + n + " open</div></div>" +
      '<button class="ic-btn" data-go="search" aria-label="Search">' + ico("search") + "</button>" +
      '<button class="ic-btn" data-go="notifs" aria-label="Notifications">' + ico("bell") +
      '<span class="bell-dot' + (unreadCount() ? " on" : "") + '"></span></button>' +
      '<div id="hdr-status">' + statusPill() + "</div>" +
      "</header>";
  }

  function navbarPush(title, extra) {
    return '<header class="hdr push-hdr">' +
      '<button class="ic-btn" data-act="back" aria-label="Back">' + ico("back") + "</button>" +
      '<div class="hdr-title"><div class="hdr-name">' + esc(title) + (extra || "") + "</div></div>" +
      "</header>";
  }

  function paperBadge() {
    return isPaper() ? '<span class="badge-paper">PAPER</span>' : "";
  }

  function bannerHtml() {
    if (!state.offline) return "";
    var last = state.lastOk ? fmtTimeFull(state.lastOk.toISOString()) : "never";
    var n = Math.max(0, state.retryIn || 0);
    return '<div class="banner">Desk offline · retrying in ' + n + "s · last update " + esc(last) + "</div>";
  }

  function tabbar() {
    var tabs = [["home", "Home"], ["agents", "Agents"], ["activity", "Activity"], ["account", "Account"]];
    var hide = state.screen === "coin" || state.screen === "audit" || state.screen === "search" || state.screen === "notifs";
    if (hide) return "";
    return '<nav class="tabbar">' + tabs.map(function (t) {
      return '<button data-go="' + t[0] + '" class="' + (state.tab === t[0] ? "on" : "") + '">' +
        ico(t[0]) + "<span>" + t[1] + "</span></button>";
    }).join("") + "</nav>";
  }

  function skeletonHome() {
    return header() + '<div class="screen with-tabs">' +
      '<div class="skl skl-balance"></div><div class="skl skl-meta"></div>' +
      '<div class="skl skl-chart"></div><div class="skl skl-ranges"></div>' +
      '<div class="skl skl-card"></div><div class="skl skl-card"></div>' +
      "</div>" + tabbar();
  }

  function lockScreen() {
    return '<div class="lock"><img class="lock-ic" src="icons/icon-192.png" alt="">' +
      "<h1>FOMO Desk</h1><p>Open the link from Telegram</p>" +
      '<p class="lock-or">Or copy the desk link from Telegram and paste it here</p>' +
      '<input id="lock-link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste desk link">' +
      '<button type="button" class="lock-btn" onclick="window.__deskConnect()">Connect</button>' +
      '<p id="lock-msg"></p></div>';
  }

  window.__deskConnect = function () {
    var el = document.getElementById("lock-link");
    var raw = (el && el.value || "").trim();
    var i = raw.indexOf("#");
    var frag = i >= 0 ? raw.slice(i + 1) : raw;
    var out = {};
    frag.split("&").forEach(function (part) {
      var j = part.indexOf("=");
      if (j > 0) out[decodeURIComponent(part.slice(0, j))] = decodeURIComponent(part.slice(j + 1));
    });
    var msg = document.getElementById("lock-msg");
    if (!out.t || !out.d) { if (msg) msg.textContent = "That link is missing its key. Copy the whole link."; return; }
    saveStored({ t: out.t, d: out.d, u: (out.u || out.s || DEFAULT_SUPABASE).replace(/\/$/, "") });
    location.replace(location.pathname + location.search);
  };

  /* ---------- agents ---------- */

  function agentSummary(a) {
    var n = a.name, sub = "", metric = "", mcls = "";
    if (n === "scanner") {
      var f = (a.feed || [])[0];
      sub = f ? (f.name || "") + (f.verdict === "pass" ? " → Auditor" : " · " + (f.reason || "killed")) : "Listening for new pools";
      metric = Number(a.count || 0).toLocaleString("en-US") + " pools";
      if (a.passed) { metric += " · " + a.passed + " ✓"; }
    } else if (n === "auditor") {
      var ly = (a.last && a.last.layers) || [];
      var bad = ly.filter(function (x) { return x.pass === false && x.value !== "not checked"; })[0];
      sub = a.last ? (bad ? "Rejected · " + bad.value : "8/8 passed → Executor") : "Waiting for a coin to take apart";
      metric = (a.count || 0) + " audited";
    } else if (n === "analyst") {
      sub = "Min score " + (a.min_score != null ? a.min_score : "—") + (a.mode ? " · " + a.mode : "");
      metric = a.score == null ? "no score" : "score " + a.score;
      mcls = a.score != null && a.score >= (a.min_score || 70) ? "g" : "";
    } else if (n === "executor") {
      sub = a.last_size_usd != null ? "Last " + fmtUsd(a.last_size_usd) + " · " + a.stack_pct + "% of stack" : "Waiting for a signal · " + a.stack_pct + "% sizing";
      metric = (a.count || 0) + " trades";
    } else if (n === "risk") {
      sub = (a.headline || "Guarding") + " · stop −" + a.stop_pct + "% · trail " + a.trail_pct + "%";
      metric = (a.open_positions || 0) + " open";
      mcls = a.open_positions ? "g" : "";
    } else {
      sub = a.headline || "";
      metric = a.count != null ? String(a.count) : "";
    }
    return { sub: sub, metric: metric, mcls: mcls };
  }

  function agentRow(a) {
    var s = agentSummary(a);
    var alive = agentAlive(a);
    var stCls = alive ? "on" : (a.status === "paused" ? "paused" : "down");
    return '<button class="ag-row" data-go-agent="' + esc(a.name) + '">' +
      '<span class="ag-ic">' + (AGENT_EMOJI[a.name] || "🤖") + '<i class="ag-dot ' + stCls + '"></i></span>' +
      '<span class="ag-mid"><span class="ag-name">' + esc(AGENT_TITLE[a.name] || a.name) + "</span>" +
      '<span class="ag-sub">' + esc(s.sub) + "</span></span>" +
      '<span class="ag-metric ' + s.mcls + '">' + esc(s.metric) + "</span></button>";
  }

  function agentsCard(agents) {
    var running = agents.filter(agentAlive).length;
    var html = '<div class="sec-h"><h2>Agents</h2><span class="sec-r ' + (running ? "g" : "") + '">' + running + " running</span></div>";
    html += '<div class="card list-card">';
    if (!agents.length) html += '<div class="empty">No agents reported yet</div>';
    agents.forEach(function (a) { html += agentRow(a); });
    html += "</div>";
    return html;
  }

  function agentDetail(a) {
    var name = a.name;
    var html = "";
    if (name === "scanner") {
      var feed = a.feed || [];
      html += '<div class="kpis"><span><b>' + (a.count || 0) + "</b> pools</span><span><b class=\"g\">" + (a.passed || 0) +
        "</b> passed</span><span><b class=\"r\">" + (a.killed || 0) + "</b> killed</span></div>";
      if (!feed.length) html += '<div class="muted">Listening for new pools</div>';
      else {
        html += '<ul class="feed">';
        feed.slice(0, 12).forEach(function (f) {
          var kill = f.verdict !== "pass";
          html += '<li class="' + (kill ? "kill" : "pass") + '" data-coin="' + esc(f.mint) + '">' +
            '<span class="nm">' + esc(f.name || f.title || "") + (f.source ? ' <em>' + esc(f.source) + "</em>" : "") + "</span>" +
            '<span class="why">' + esc(kill ? (f.reason || "") : "→ auditor") + "</span></li>";
        });
        html += "</ul>";
      }
    } else if (name === "auditor") {
      if (!a.count) html += '<div class="muted">No coin taken apart yet</div>';
      else {
        var layers = (a.last && a.last.layers) || [];
        html += '<div class="layers-grid">';
        for (var i = 1; i <= 8; i++) {
          var ly = layers.filter(function (x) { return x.n === i; })[0];
          var cls = !ly || ly.value === "not checked" || ly.pass == null ? "wait" : (ly.pass ? "ok" : "bad");
          html += '<div class="layer-strip ' + cls + '"><span class="mark">' + (cls === "ok" ? "✓" : cls === "bad" ? "✕" : "") + "</span>" +
            esc((ly && ly.name) || ("Layer " + i)) + "</div>";
        }
        html += "</div>";
        if (a.rejected) html += '<div class="muted" style="margin-top:8px">' + a.rejected + " rejected tonight</div>";
      }
    } else if (name === "analyst") {
      html += '<div class="score-row"><canvas class="score-ring" data-score="' + (a.score == null ? "" : a.score) +
        '" data-min="' + (a.min_score || 70) + '"></canvas><div><div class="big-sub">Last score</div><div class="muted">min ' +
        esc(String(a.min_score || 70)) + (a.mode ? " · " + esc(a.mode) : "") + "</div></div></div>";
    } else if (name === "executor") {
      var sz = a.last_size_usd;
      html += '<div class="exec-line">' + (sz != null ? esc(fmtUsd(sz)) + " · " + esc(String(a.stack_pct)) + "% of stack" : "No fills yet") + "</div>";
      if (sz != null) html += '<div class="exec-ok">✓ Filled (paper)</div>';
    } else if (name === "risk") {
      html += '<div class="pills"><span class="pill red">stop −' + esc(String(a.stop_pct)) + '%</span><span class="pill green">trail ' +
        esc(String(a.trail_pct)) + '%</span><span class="pill">' + (a.open_positions || 0) + " open</span></div>";
    }
    return html;
  }

  /* ---------- live feed (real decisions) ---------- */

  var AG_TAG = { scanner: "SCAN", auditor: "AUDIT", analyst: "ANLST", executor: "EXEC", risk: "RISK" };

  function liveLines(limit) {
    var lines = [];
    var seen = {};
    AGENTS.forEach(function (n) {
      (((state.data.decisions[n] && state.data.decisions[n].decisions) || [])).forEach(function (d) {
        var k = n + d.mint + d.ts;
        if (seen[k]) return; seen[k] = 1;
        lines.push({ agent: n, ts: d.ts, mint: d.mint, name: d.name, verdict: d.verdict, reason: d.reason });
      });
    });
    var sc = ((state.data.state && state.data.state.agents) || []).filter(function (a) { return a.name === "scanner"; })[0];
    ((sc && sc.feed) || []).forEach(function (f) {
      var k = "scanner" + f.mint + f.ts;
      if (seen[k]) return; seen[k] = 1;
      lines.push({ agent: "scanner", ts: f.ts, mint: f.mint, name: f.name, verdict: f.verdict, reason: f.reason });
    });
    lines.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    return lines.slice(0, limit || 14);
  }

  var liveSeen = {};
  function liveFeedCard() {
    var lines = liveLines(14);
    var html = '<div class="sec-h"><h2>Live feed</h2><span class="sec-r live-tag"><i></i>Live</span></div>';
    html += '<div class="card term"><div class="term-top"><span class="tdots"><i></i><i></i><i></i></span><span>desk decisions · ' +
      esc(isPaper() ? "paper" : "live") + "</span></div>";
    if (!lines.length) {
      html += '<div class="term-body"><div class="tl idle">&gt; waiting for the first coin<span class="caret"></span></div></div>';
    } else {
      html += '<div class="term-body">';
      lines.forEach(function (l) {
        var ok = l.verdict === "pass";
        var key = l.agent + l.mint + l.ts;
        var isNew = state.ready && Object.keys(liveSeen).length && !liveSeen[key];
        html += '<div class="tl' + (isNew ? " new" : "") + '" data-coin="' + esc(l.mint) + '" data-agent-link="' + esc(l.agent) + '">' +
          '<span class="tt">' + esc(fmtTime(l.ts)) + "</span>" +
          '<span class="ta">' + esc(AG_TAG[l.agent] || l.agent) + "</span>" +
          '<span class="tn">' + esc(l.name || (l.mint || "").slice(0, 6)) + "</span>" +
          '<span class="tv ' + (ok ? "ok" : "no") + '">' + (ok ? "✓ passed" : "✕ " + esc(l.reason || "killed")) + "</span></div>";
      });
      html += '<div class="tl idle">&gt; scanning<span class="caret"></span></div></div>';
      lines.forEach(function (l) { liveSeen[l.agent + l.mint + l.ts] = 1; });
    }
    html += "</div>";
    return html;
  }

  /* ---------- activity rows ---------- */

  function rowKind(r) {
    var k = String(r.kind || "").toLowerCase();
    if (k === "bought") return { cls: "buy", ic: "buy" };
    if (k === "stopped") return { cls: "loss", ic: "stop" };
    if (k === "sold") return classifyVal(r.value) === "down" ? { cls: "loss", ic: "sell" } : { cls: "win", ic: "sell" };
    if (k === "rejected") return { cls: "skip", ic: "skip" };
    return { cls: "skip", ic: "skip" };
  }

  function renderRows(rows) {
    var html = '<div class="card list-card">';
    rows.forEach(function (r) {
      var rk = rowKind(r);
      var parts = String(r.value || "").split(" · ");
      var vc = classifyVal(parts[0]);
      if (rk.cls === "buy") vc = "b";
      var agent = AGENT_TITLE[(r.agent || "").toLowerCase()] || r.agent || "";
      var sub = r.subtitle && !isIso(r.subtitle) ? r.subtitle : (r.kind === "bought" ? "buy" : "");
      if (sub.indexOf(agent) === 0) sub = sub.slice(agent.length).replace(/^\s*(\(\w+\))?\s*·\s*/, "");
      var details = [agent, sub, fmtWhen(r.ts)].filter(Boolean).join(" · ");
      html += '<button class="act-row" data-row-mint="' + esc(r.mint || "") + '" data-row-agent="' + esc(r.agent || "") +
        '" data-row-kind="' + esc(r.kind || "") + '">' +
        '<span class="act-ic ' + rk.cls + '">' + ico(rk.ic) + "</span>" +
        '<span class="act-mid"><span class="act-t">' + esc(r.title || "") + '</span><span class="act-s">' + esc(details) + "</span></span>" +
        '<span class="act-r"><span class="act-v ' + vc + '">' + esc(parts[0] || "") + "</span>" +
        (parts.length > 1 ? '<span class="act-v2">' + esc(parts.slice(1).join(" · ")) + "</span>" : "") + "</span></button>";
    });
    html += "</div>";
    return html;
  }

  function emptyCard(title, sub, emoji) {
    return '<div class="card empty-card"><div class="em-ic">' + (emoji || "🌙") + '</div><div class="em-t">' + esc(title) +
      '</div><div class="em-s">' + esc(sub) + "</div></div>";
  }

  /* ---------- recap ---------- */

  function renderRecap() {
    var r = state.data.recap || {};
    var net = r.net_pnl_usd;
    var netCls = net > 0 ? "g" : net < 0 ? "r" : "";
    var bw = r.biggest_win, bb = r.biggest_buy;
    var miles = (r.milestones_hit || []).map(function (m) { return (m && m.multiple != null ? m.multiple : m) + "x"; });
    var html = '<div class="sec-h"><h2>Session recap</h2><span class="sec-r">' + esc(r.since ? "since " + fmtWhen(r.since) : "") + "</span></div>";
    html += '<div class="card recap-grid">';
    html += tile("Trades", String(r.trades || 0));
    html += tile("Win rate", (r.win_rate == null ? 0 : r.win_rate) + "%");
    html += tile("Stop rate", (r.stop_rate == null ? 0 : r.stop_rate) + "%");
    html += tile("Net after fees", net == null ? "$0.00" : (net >= 0 ? "+$" : "-$") + Math.abs(Number(net)).toFixed(2), netCls);
    html += tile("Biggest win", bw && bw.pnl_usd != null ? ((bw.pnl_usd >= 0 ? "+$" : "-$") + Math.abs(bw.pnl_usd).toFixed(2) + (bw.multiple ? " · " + Number(bw.multiple).toFixed(1) + "x" : "")) : "—", bw ? "g" : "");
    html += tile("Biggest buy", bb && bb.size_usd != null ? "$" + Number(bb.size_usd).toFixed(2) : "—");
    html += '<div class="miles"><span class="lbl">Milestones</span>' + ["2x", "5x", "10x"].map(function (x) {
      return '<span class="mile' + (miles.indexOf(x) !== -1 ? " hit" : "") + '">' + x + "</span>";
    }).join("") + "</div>";
    html += "</div>";
    return html;
  }

  function tile(k, v, cls) {
    return '<div class="tile"><div class="tk">' + esc(k) + '</div><div class="tv ' + (cls || "") + '">' + esc(v) + "</div></div>";
  }

  /* ---------- pages ---------- */

  function pageHome() {
    var st = state.data.state || {};
    var chart = state.data.charts[state.range] || {};
    var marks = chart.marks || [];
    var bal = Number(st.balance);
    var start = startStack();
    var diff = start != null && !isNaN(bal) ? bal - start : null;
    var pct = start ? (diff / start) * 100 : null;
    var cls = diff > 0.004 ? "up" : diff < -0.004 ? "down" : "flat";
    var arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "•";
    var mult = st.multiplier;
    var html = header() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<section class="hero">';
    html += '<div class="bal-row"><div class="bal" id="bal-num">' + esc(fmtUsd(balShown != null ? balShown : bal)) + "</div>" +
      '<span class="mult ' + (mult > 1.0001 ? "up" : mult < 0.9999 ? "down" : "") + '">' + esc(fmtMult(mult)) + "</span></div>";
    html += '<div class="chg ' + cls + '">' + arrow + " " + esc(diff == null ? "$0.00" : fmtUsd(Math.abs(diff))) +
      " (" + esc(pct == null ? "0.00%" : Math.abs(pct).toFixed(2) + "%") + ')<span class="chg-note"> vs start ' +
      esc(start != null ? fmtUsd(start) : "") + "</span></div>";
    html += '<div class="chg-today">Today ' + esc(st.today_pct == null ? "0.00%" : fmtPct(st.today_pct)) + (isPaper() ? " · paper stack" : "") + "</div>";
    html += "</section>";
    html += '<div class="chart-wrap"><canvas id="home-chart"></canvas>' +
      (!marks.length ? '<div class="chart-empty">No trades in this range yet · watching the market</div>' : "") + "</div>";
    html += '<div class="ranges">' + RANGES.map(function (r) {
      return '<button data-range="' + r + '" class="' + (state.range === r ? "on" : "") + '">' + (r === "LIVE" ? "<i></i>" : "") + r + "</button>";
    }).join("") + "</div>";
    html += agentsCard(st.agents || []);
    html += liveFeedCard();
    var all = (state.data.activity && state.data.activity.rows) || [];
    html += '<div class="sec-h"><h2>Activity</h2><button class="sec-r link" data-go="activity">See all</button></div>';
    var rows = all.slice(0, 5);
    if (!rows.length) html += emptyCard("Nothing yet tonight", "Buys, sells and stops show up here the moment they happen.", "🌙");
    else html += renderRows(rows);
    html += renderRecap();
    html += '<div class="foot">Real desk data · ' + esc(isPaper() ? "PAPER mode, no real money" : "LIVE") + "</div>";
    html += "</div>" + tabbar();
    return html;
  }

  function pageAgents() {
    var st = state.data.state || {};
    var agents = st.agents || [];
    var running = agents.filter(agentAlive).length;
    var html = header() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="page-h"><h1>Agents</h1><span class="sec-r ' + (running ? "g" : "") + '">' + running + " running</span></div>";
    agents.forEach(function (a) {
      var s = agentSummary(a);
      var alive = agentAlive(a);
      html += '<article class="card ag-card" id="agent-' + esc(a.name) + '">';
      html += '<div class="ag-row static"><span class="ag-ic">' + (AGENT_EMOJI[a.name] || "🤖") + '<i class="ag-dot ' + (alive ? "on" : (a.status === "paused" ? "paused" : "down")) + '"></i></span>' +
        '<span class="ag-mid"><span class="ag-name">' + esc(AGENT_TITLE[a.name] || a.name) + '</span><span class="ag-sub">' +
        esc((a.status || "") + (a.heartbeat ? " · beat " + fmtTime(a.heartbeat) : "")) + '</span></span><span class="ag-metric ' + s.mcls + '">' + esc(s.metric) + "</span></div>";
      html += '<div class="ag-body">' + agentDetail(a);
      if (a.name === "risk" && a.open_positions > 0) html += '<div class="tg-note">Risk is locked while a position is open. Change in Telegram: <code class="cmd">/pause risk</code></div>';
      else html += '<div class="tg-note">Pause or resume in Telegram: <code class="cmd">/' + (a.status === "paused" ? "resume" : "pause") + " " + esc(a.name) + "</code></div>";
      html += '<div class="tg-note">Settings: <code class="cmd">/set ' + esc(a.name) + ".</code></div>";
      var dec = (state.data.decisions[a.name] && state.data.decisions[a.name].decisions) || [];
      if (dec.length) {
        html += '<div class="mini-h">Recent decisions</div><ul class="feed">';
        dec.slice(0, 20).forEach(function (d) {
          html += '<li class="' + (d.verdict === "pass" ? "pass" : "kill") + '" data-coin="' + esc(d.mint) + '" data-agent-link="' + esc(a.name) + '">' +
            '<span class="nm">' + esc(fmtTime(d.ts) + " · " + (d.name || "")) + "</span>" +
            '<span class="why">' + esc((d.verdict || "") + (d.reason ? " · " + d.reason : "")) + "</span></li>";
        });
        html += "</ul>";
      }
      html += "</div></article>";
    });
    if (!agents.length) html += emptyCard("No agents yet", "The desk hasn't published agent status.", "🤖");
    html += "</div>" + tabbar();
    return html;
  }

  function pageActivity() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var html = header() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="page-h"><h1>Activity</h1><span class="sec-r">' + rows.length + " events</span></div>";
    if (!rows.length) html += emptyCard("Nothing yet tonight", "Buys, sells, stops and skips show up here.", "🌙");
    else html += renderRows(rows);
    html += "</div>" + tabbar();
    return html;
  }

  var openGroups = {};
  /* settings meta */
  var SETTING_META = {
    "scanner.min_liquidity_usd": { min: 1000, max: 500000, step: 500 },
    "scanner.max_top10_pct": { min: 1, max: 100, step: 1 },
    "scanner.max_h1_change_pct": { min: 1, max: 500, step: 1 },
    "scanner.poll_s": { min: 5, max: 300, step: 1 },
    "scanner.min_pool_age_min": { min: 0, max: 240, step: 1 },
    "scanner.max_wait_min": { min: 1, max: 360, step: 1 },
    "scanner.runner_h24_pct": { min: 10, max: 2000, step: 10 },
    "scanner.max_dex_req_per_min": { min: 10, max: 1000, step: 10 },
    "scanner.ws_silence_s": { min: 10, max: 600, step: 5 },
    "scanner.rate_limit_wait_s": { min: 1, max: 120, step: 1 },
    "auditor.enabled": { type: "bool" },
    "auditor.max_dev_pct": { min: 0, max: 50, step: 0.5 },
    "auditor.max_top10_pct": { min: 1, max: 100, step: 1 },
    "auditor.min_lp_locked_pct": { min: 0, max: 100, step: 1 },
    "auditor.min_pool_age_min": { min: 0, max: 240, step: 1 },
    "auditor.max_bundled": { min: 0, max: 50, step: 1 },
    "auditor.max_delegated_accounts": { min: 0, max: 100, step: 1 },
    "auditor.retries": { min: 0, max: 10, step: 1 },
    "auditor.bundled_min_wallets": { min: 1, max: 20, step: 1 },
    "auditor.max_liq_drop_pct": { min: 1, max: 100, step: 1 },
    "auditor.retry_gap_s": { min: 1, max: 30, step: 1 },
    "analyst.mode": { type: "enum", options: ["rules", "jev"] },
    "analyst.min_alive_6h": { min: 0, max: 1, step: 0.01 },
    "analyst.min_organic": { min: 0, max: 1, step: 0.01 },
    "analyst.max_chase": { min: 0, max: 1, step: 0.01 },
    "analyst.min_score": { min: 0, max: 100, step: 1 },
    "analyst.timeout_s": { min: 1, max: 60, step: 1 },
    "analyst.alive_volume_h1": { min: 0, max: 500000, step: 500 },
    "analyst.organic_buys_h1": { min: 0, max: 2000, step: 5 },
    "analyst.bundled_penalty": { min: 0, max: 2, step: 0.05 },
    "analyst.flush_drop_m5_pct": { min: 0, max: 50, step: 0.5 },
    "analyst.chase_h1_pct": { min: 1, max: 500, step: 1 },
    "analyst.max_state_chars": { min: 200, max: 20000, step: 100 },
    "analyst.retry_gap_s": { min: 1, max: 30, step: 1 },
    "analyst.rate_limit_queue_s": { min: 5, max: 300, step: 5 },
    "executor.stack_pct": { min: 0.5, max: 50, step: 0.5 },
    "executor.max_pool_pct": { min: 0.1, max: 20, step: 0.1 },
    "executor.min_ticket_usd": { min: 1, max: 1000, step: 0.5 },
    "executor.below_min": { type: "enum", options: ["bump", "skip"] },
    "executor.recheck_liq_drop_pct": { min: 1, max: 80, step: 1 },
    "executor.recheck_price_up_pct": { min: 1, max: 80, step: 1 },
    "executor.confirm_window_min": { min: 1, max: 60, step: 1 },
    "risk.poll_s": { min: 5, max: 120, step: 1 },
    "risk.stop_pct": { min: 1, max: 40, step: 0.5 },
    "risk.trail_start_pct": { min: 1, max: 80, step: 0.5 },
    "risk.trail_pct": { min: 1, max: 40, step: 0.5 },
    "risk.timeout_h": { min: 0.5, max: 24, step: 0.5 },
    "risk.timeout_min_gain_pct": { min: 0, max: 50, step: 0.5 },
    "risk.confirm_window_min": { min: 1, max: 30, step: 1 },
    "risk.no_price_polls": { min: 1, max: 20, step: 1 },
    "risk.rate_limit_wait_s": { min: 1, max: 120, step: 1 },
    "desk.mode": { type: "enum", options: ["PAPER", "LIVE"] },
    "desk.paper_start_stack": { min: 10, max: 100000, step: 10 },
    "desk.report_time": { type: "time" },
    "desk.notifier": { type: "enum", options: ["telegram", "webpush"] },
    "desk.rpc_url": { type: "text", redact: true },
    "desk.push_rejects": { type: "bool" },
    "desk.fees_ref_discount": { min: 0, max: 0.5, step: 0.01 },
    "desk.fomo_handle": { type: "text" },
    "desk.publish_s": { min: 5, max: 60, step: 1 }
  };

  function settingControl(key, value) {
    var meta = SETTING_META[key] || { type: "text" };
    var label = key.split(".").slice(1).join(".") || key;
    if (meta.redact && value) {
      value = String(value).replace(/(api-key=)[^&]+/i, "$1***");
    }
    var html = '<div class="setting"><div class="sk"><span class="n">' + esc(label) + "</span>";
    if (meta.type === "bool") {
      var on = String(value).toLowerCase() === "true" || value === true || value === "1";
      html += '<span class="switch' + (on ? " on" : "") + '" aria-disabled="true"><i></i></span></div>';
    } else if (meta.type === "enum") {
      html += "</div><div class=\"seg\">";
      (meta.options || []).forEach(function (o) {
        html += '<button type="button" class="' + (String(value) === String(o) ? "on" : "") + '" disabled>' + esc(o) + "</button>";
      });
      html += "</div>";
    } else if (meta.type === "time" || meta.type === "text") {
      html += '<input type="' + (meta.type === "time" ? "time" : "text") + '" value="' + esc(value == null ? "" : value) + '" disabled></div>';
    } else {
      var num = value == null ? "" : value;
      html += '<input type="number" value="' + esc(num) + '" disabled></div>';
      html += '<input type="range" min="' + (meta.min || 0) + '" max="' + (meta.max || 100) +
        '" step="' + (meta.step || 1) + '" value="' + esc(num) + '" disabled>';
    }
    html += '<div class="tg-note">Change in Telegram: <code class="cmd">/set ' + esc(key) + " " + esc(value == null ? "" : value) + "</code></div>";
    html += "</div>";
    return html;
  }

  function pageAccount() {
    var acc = state.data.account || {};
    var stg = (state.data.settings && state.data.settings.settings) || {};
    var html = header() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="page-h"><h1>Account</h1><span class="sec-r">' + esc(acc.fomo_handle || "") + "</span></div>";
    html += '<div class="card acct-hero"><img class="app-ic lg" src="icons/icon-192.png" alt=""><div><div class="ah-k">' +
      esc(isPaper() ? "Paper stack" : "Stack") + '</div><div class="ah-v">' + esc(fmtUsd(acc.balance != null ? acc.balance : acc.stack)) +
      '</div><div class="ah-s">started at ' + esc(fmtUsd(acc.stack)) + "</div></div>" + paperBadge() + "</div>";
    html += '<div class="list">';
    html += '<div class="list-row"><span class="lbl">Mode</span><div class="seg">' +
      '<button class="' + (mode() === "PAPER" ? "on" : "") + '" disabled>PAPER</button>' +
      '<button class="' + (mode() === "LIVE" ? "on" : "") + '" disabled>LIVE</button></div></div>';
    html += '<div class="list-row"><span class="lbl">Stack</span><span class="val num">' + esc(fmtUsd(acc.stack)) + "</span></div>";
    html += "</div>";
    html += '<div class="tg-note" style="padding:8px 16px 0">Change in Telegram: <code class="cmd">/mode LIVE</code> or <code class="cmd">/set desk.paper_start_stack ' +
      esc(acc.stack == null ? "" : acc.stack) + "</code>. Switching to LIVE needs a full PAPER night and you typing LIVE.</div>";

    html += renderRecap();
    html += '<div class="mini-h pad">Profile &amp; settings · change in Telegram</div>';
    html += '<div class="group"><div class="group-title">FOMO</div><div class="list">';
    if (acc.profile_url) {
      html += '<a class="list-row" href="' + esc(acc.profile_url) + '" rel="noopener" target="_blank"><span class="lbl">Your FOMO profile</span><span class="val">' +
        esc(acc.fomo_handle || "") + ' <span class="chev">›</span></span></a>';
    } else {
      html += '<div class="list-row"><span class="lbl">Your FOMO profile</span><span class="val">not set</span></div>';
    }
    html += '<button class="list-row" data-act="invite"><span class="lbl">Invite a friend</span><span class="val chev">›</span></button>';
    html += "</div></div>";

    html += '<div class="group"><div class="group-title">Alerts</div><div class="list">';
    html += '<div class="list-row"><span class="lbl">Telegram</span><span class="val">' +
      (acc.notifier === "telegram" || !acc.notifier ? "connected" : "not") + "</span></div>";
    html += '<div class="list-row"><span class="lbl">Send test push</span><span class="val">Telegram</span></div>';
    html += "</div><div class=\"tg-note\" style=\"padding:8px 16px 0\">Change in Telegram: <code class=\"cmd\">/test</code>. Web push isn’t available on this setup. Alerts go through Telegram.</div></div>";

    var groups = [
      ["scanner", "Scanner"], ["auditor", "Auditor"], ["analyst", "Analyst"],
      ["executor", "Executor"], ["risk", "Risk"], ["devwatch", "Dev Watch"], ["exits", "Exits"], ["milestones", "Milestones"], ["xscout", "X scout"], ["desk", "Desk"]
    ];
    groups.forEach(function (g) {
      var keys = Object.keys(stg).sort().filter(function (k) { return k.split(".")[0] === g[0]; });
      if (!keys.length) return;
      html += '<details class="group set-group"' + (openGroups[g[0]] ? " open" : "") + ' data-group="' + g[0] + '"><summary class="group-title">' + g[1] +
        '<span class="cnt">' + keys.length + "</span></summary><div class=\"list\">";
      keys.forEach(function (k) { html += settingControl(k, stg[k]); });
      html += "</div></details>";
    });
    html += "</div>" + tabbar();
    return html;
  }

  function pageCoin() {
    var mint = state.mint;
    var coin = state.data.coins[mint];
    var audit = state.data.audits[mint];
    var title = (coin && (coin.name || coin.symbol)) || "Coin";
    var extra = isPaper() ? " " + paperBadge() : "";
    var html = navbarPush(title, extra) + bannerHtml() + '<div class="screen push">';
    if (!coin) {
      html += '<div class="skl skl-meta"></div><div class="skl skl-chart"></div><div class="skl skl-row"></div></div>';
      return html;
    }
    var age = fmtAge(coin.age_min);
    var passed = audit && audit.passed;
    var checked = audit && audit.layers ? audit.layers.filter(function (l) { return l.checked; }).length : 0;
    var shieldCls = !audit ? "na" : (passed ? "" : "bad");
    var shieldTxt = !audit ? "—" : (checked + "/8");
    html += '<div class="coin-sub">' + esc((coin.symbol || "") + " · Solana" + (age ? " · " + age : "")) +
      ' <span class="shield ' + shieldCls + '">' + esc(shieldTxt) + "</span></div>";
    html += '<div class="price-lg">' + (coin.price == null ? "—" : esc(fmtUsd(coin.price, coin.price < 1 ? 6 : 2))) + "</div>";
    if (coin.since_entry_pct != null && coin.position && !coin.position.closed_at) {
      var up = coin.since_entry_pct >= 0;
      html += '<div class="entry-delta ' + (up ? "up" : "down") + '" style="color:var(--' + (up ? "green" : "red") + ')">' +
        (up ? "▲ " : "▼ ") + esc(fmtPct(Math.abs(coin.since_entry_pct))) + " since entry</div>";
    }
    html += '<div class="candles"><canvas id="coin-chart"></canvas></div>';
    html += '<div class="stats">';
    html += stat("Market cap", shortUsd(coin.market_cap));
    html += stat("Liquidity", shortUsd(coin.liquidity_usd));
    html += stat("24h volume", shortUsd(coin.volume_h24));
    html += stat("Holders", coin.holders == null ? "n/a" : String(coin.holders));
    html += "</div>";
    var pos = coin.position;
    var openPos = pos && (pos.status === "open" || pos.status === "exiting" || (!pos.closed_at && pos.entry_price));
    if (openPos) {
      html += '<div class="pos-card"><div class="ph">Your position · Executor</div><div class="pb">' +
        esc(fmtUsd(pos.size_usd)) + " in</div></div>";
    }
    if (openPos && coin.exit_lines) {
      var el = coin.exit_lines;
      html += '<div class="exit-card">';
      html += '<div class="val-row"><span class="vn">Stop line</span><span class="vv">' + esc(el.stop != null ? String(el.stop) : "—") +
        (el.stop_pct != null ? " · −" + Number(el.stop_pct).toFixed(2) + "%" : "") + "</span></div>";
      html += '<div class="val-row"><span class="vn">Trail line</span><span class="vv">' +
        esc(el.trail != null ? String(el.trail) : (el.trail_active ? "—" : "not active")) +
        (el.trail_pct != null ? " · " + Number(el.trail_pct).toFixed(2) + "%" : "") + "</span></div>";
      var left = el.timeout_left_h;
      html += '<div class="val-row"><span class="vn">Time left</span><span class="vv">' +
        (left == null ? "—" : Number(left).toFixed(2) + "h") + "</span></div>";
      html += "</div>";
    }
    if (coin.coin_url) {
      var label = openPos ? "Sell on FOMO" : "Buy on FOMO";
      html += '<a class="cta' + (openPos ? " sell" : "") + '" href="' + esc(coin.coin_url) + '" rel="noopener" target="_blank">' + label + "</a>";
    }
    html += "</div>";
    return html;
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="stat-val">' + esc(v) + "</div></div>";
  }

  function pageAudit() {
    var mint = state.mint;
    var audit = state.data.audits[mint];
    var coin = state.data.coins[mint];
    var title = (audit && audit.name) || (coin && coin.name) || "Auditor";
    var html = navbarPush(title) + bannerHtml() + '<div class="screen push">';
    if (!audit) {
      html += '<div class="empty">No coin taken apart yet</div></div>';
      return html;
    }
    var checked = audit.layers.filter(function (l) { return l.checked; });
    var waiting = checked.length < 8 && !audit.passed && !audit.reason;
    html += '<div class="stack-wrap"><canvas id="audit-stack"></canvas></div>';
    if (audit.passed) {
      html += '<div class="audit-status ok"><div class="big">Cleared · 8/8 parts</div>' +
        '<div class="sub">Sent to Executor' +
        (state.data.state && execSize() ? " · " + esc(fmtUsd(execSize())) : "") +
        "</div></div>";
    } else if (audit.reason && checked.length) {
      html += '<div class="audit-status bad"><div class="big">Rejected · ' + esc(audit.reason) + "</div>" +
        '<div class="sub">The desk won\'t buy ' + esc(audit.name || "") + "</div></div>";
    } else {
      html += '<div class="audit-status"><div class="big">taking apart...</div></div>';
    }
    html += '<div class="val-rows">';
    audit.layers.forEach(function (ly) {
      var cls = !ly.checked ? "" : (ly.pass ? "ok" : "bad");
      html += '<div class="val-row ' + cls + '"><span class="vn">' + esc(ly.name) + '</span><span class="vv">' +
        esc(ly.value || (ly.checked ? "" : "…")) + "</span></div>";
    });
    html += "</div>";
    var enabled = true;
    var stg = (state.data.settings && state.data.settings.settings) || {};
    if (stg["auditor.enabled"] != null) enabled = String(stg["auditor.enabled"]).toLowerCase() !== "false";
    html += '<div class="list" style="margin-top:16px"><div class="list-row"><span class="lbl">Take apart before buying</span>' +
      '<span class="switch' + (enabled ? " on" : "") + '"><i></i></span></div></div>';
    html += '<div class="tg-note" style="padding:8px 16px 0">Turning this off asks twice, in Telegram: <code class="cmd">/set auditor.enabled off</code></div>';
    if (audit.coin_url) {
      html += '<a class="cta" href="' + esc(audit.coin_url) + '" rel="noopener" target="_blank">Open on FOMO</a>';
    }
    html += "</div>";
    return html;
  }

  function execSize() {
    var a = ((state.data.state && state.data.state.agents) || []).filter(function (x) { return x.name === "executor"; })[0];
    return a && a.last_size_usd;
  }

  function pageSearch() {
    var q = (state.query || "").trim().toLowerCase();
    var hits = searchCoins(q);
    var html = '<div class="overlay"><div class="bar">' +
      '<input id="search-in" type="search" placeholder="Name, symbol or mint" value="' + esc(state.query || "") + '" autofocus>' +
      '<button class="cancel" data-act="back">Cancel</button></div>';
    if (!q) html += '<div class="empty">Search by name, symbol or mint</div>';
    else if (!hits.length) html += '<div class="empty">No matches</div>';
    else {
      html += '<div class="rows">';
      hits.forEach(function (h) {
        html += '<button class="row" data-coin="' + esc(h.mint) + '"><div class="t">' + esc(h.name) + "</div>" +
          '<div class="v"></div><div class="s">' + esc(h.mint) + "</div></button>";
      });
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function searchCoins(q) {
    var map = {};
    function add(mint, name) {
      if (!mint) return;
      if (!map[mint]) map[mint] = { mint: mint, name: name || mint.slice(0, 6) };
      else if (name && map[mint].name === map[mint].mint.slice(0, 6)) map[mint].name = name;
    }
    ((state.data.state && state.data.state.agents) || []).forEach(function (a) {
      (a.feed || []).forEach(function (f) { add(f.mint, f.name); });
      if (a.last && a.last.mint) add(a.last.mint);
    });
    (((state.data.activity && state.data.activity.rows) || [])).forEach(function (r) { add(r.mint, r.title); });
    AGENTS.forEach(function (n) {
      (((state.data.decisions[n] && state.data.decisions[n].decisions) || [])).forEach(function (d) { add(d.mint, d.name); });
    });
    Object.keys(state.data.coins).forEach(function (m) {
      var c = state.data.coins[m];
      add(m, (c && (c.name || c.symbol)) || m);
    });
    var all = Object.keys(map).map(function (k) { return map[k]; });
    if (!q) return all.slice(0, 20);
    return all.filter(function (h) {
      return (h.name || "").toLowerCase().indexOf(q) !== -1 || h.mint.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 40);
  }

  function pageNotifs() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var html = '<div class="overlay"><div class="bar"><button class="cancel" data-act="back">Close</button></div>';
    html += '<div class="sheet-h">Notifications</div>';
    if (!rows.length) html += '<div class="empty">Nothing yet tonight</div>';
    else html += renderRows(rows);
    html += "</div>";
    return html;
  }

  /* ---------- paint ---------- */

  var root = document.getElementById("app");
  var lastScreen = null;
  var scrollMem = {};

  function paint(nav) {
    if (!CFG.t || !CFG.d) { root.innerHTML = lockScreen(); return; }
    if (state.boot && !state.ready) { root.innerHTML = skeletonHome(); bind(); return; }
    var sc = root.querySelector(".screen");
    if (sc && lastScreen) scrollMem[lastScreen] = sc.scrollTop;
    var html;
    if (state.screen === "home") html = pageHome();
    else if (state.screen === "agents") html = pageAgents();
    else if (state.screen === "activity") html = pageActivity();
    else if (state.screen === "account") html = pageAccount();
    else if (state.screen === "coin") html = pageCoin();
    else if (state.screen === "audit") html = pageAudit();
    else if (state.screen === "search") html = pageSearch();
    else if (state.screen === "notifs") html = pageNotifs();
    else html = pageHome();
    root.innerHTML = html;
    var sc2 = root.querySelector(".screen");
    if (sc2) {
      if (nav === true) { sc2.classList.add("enter"); if (state.screen !== lastScreen) scrollMem[state.screen] = 0; }
      sc2.scrollTop = scrollMem[state.screen] || 0;
    }
    bind();
    afterPaint();
    lastScreen = state.screen;
  }

  function paintBannerOnly() {
    var b = root.querySelector(".banner");
    var html = bannerHtml();
    if (!html) { if (b) b.remove(); return; }
    if (b) b.outerHTML = html;
    else { var nav = root.querySelector(".hdr"); if (nav) nav.insertAdjacentHTML("afterend", html); }
    var hs = document.getElementById("hdr-status");
    if (hs) hs.innerHTML = statusPill();
  }

  function afterPaint() {
    var st = state.data.state || {};
    if (state.screen === "home") {
      animateBalance(st.balance);
      var hc = root.querySelector("#home-chart");
      if (hc && state.data.charts[state.range]) { drawLineChart(hc, state.data.charts[state.range]); runChartLoop(); }
    }
    root.querySelectorAll("canvas.score-ring").forEach(function (c) {
      var s = c.getAttribute("data-score");
      drawRing(c, s === "" ? null : Number(s), Number(c.getAttribute("data-min") || 70));
    });
    var cc = root.querySelector("#coin-chart");
    if (cc && state.data.coins[state.mint]) drawCandles(cc, state.data.coins[state.mint]);
    var ac = root.querySelector("#audit-stack");
    if (ac && state.data.audits[state.mint]) {
      if (lastScreen !== "audit" || beam.mint !== state.mint) resetBeam(state.mint);
      drawDiscs(ac, state.data.audits[state.mint]);
    }
    var si = root.querySelector("#search-in");
    if (si) { si.focus(); var val = si.value; si.selectionStart = si.selectionEnd = val.length; }
  }

  function bind() {
    root.querySelectorAll("[data-go]").forEach(function (el) {
      el.addEventListener("click", function () { go(el.getAttribute("data-go")); });
    });
    root.querySelectorAll("[data-act='back']").forEach(function (el) {
      el.addEventListener("click", function () { go(state.tab || "home"); });
    });
    root.querySelectorAll("[data-range]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.range = el.getAttribute("data-range");
        paint();
        getJson("chart-" + state.range + ".json").then(function (j) { state.data.charts[state.range] = j; paint(); }).catch(function () {});
      });
    });
    root.querySelectorAll("[data-go-agent]").forEach(function (el) {
      el.addEventListener("click", function () {
        var name = el.getAttribute("data-go-agent");
        go("agents");
        var card = document.getElementById("agent-" + name);
        if (card) card.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      });
    });
    root.querySelectorAll("[data-row-mint]").forEach(function (el) {
      el.addEventListener("click", function () {
        openRow({ mint: el.getAttribute("data-row-mint"), agent: el.getAttribute("data-row-agent"), kind: el.getAttribute("data-row-kind") });
      });
    });
    root.querySelectorAll("[data-coin]").forEach(function (el) {
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var mint = el.getAttribute("data-coin");
        if (!mint) return;
        var agent = el.getAttribute("data-agent-link") || "";
        if (agent === "auditor" || agent === "analyst") go("audit", { mint: mint });
        else go("coin", { mint: mint });
      });
    });
    root.querySelectorAll("details.set-group").forEach(function (el) {
      el.addEventListener("toggle", function () { openGroups[el.getAttribute("data-group")] = el.open; });
    });
    root.querySelectorAll("[data-act='invite']").forEach(function (el) { el.addEventListener("click", invite); });
    var si = root.querySelector("#search-in");
    if (si) si.addEventListener("input", function () { state.query = si.value; paint(); });
  }

  function invite() {
    var url = state.data.account && state.data.account.signup_url;
    if (!url) return;
    if (navigator.share) navigator.share({ title: "FOMO", url: url }).catch(function () { copyLink(url); });
    else copyLink(url);
  }

  function copyLink(url) {
    function done() { toast({ kind: "info", title: "Link copied", sub: "", val: "" }); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(function () { fallback(url, done); });
    else fallback(url, done);
  }

  function fallback(url, done) {
    var ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    done();
  }

  /* ---------- start ---------- */

  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { refresh(); }, POLL_MS);
  }

  window.addEventListener("resize", function () { afterPaint(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && CFG.t && CFG.d) refresh(); });
  setInterval(function () {
    var hs = document.getElementById("hdr-status");
    if (hs) hs.innerHTML = statusPill();
  }, 10000);

  if (!CFG.t || !CFG.d) { paint(); return; }
  paint();
  refresh().then(startPoll);
})();
