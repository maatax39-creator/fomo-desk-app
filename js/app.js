/* Grok Bot · STEP 8. Plain JS, no frameworks, no CDNs.
   Config comes only from the URL fragment, then localStorage.
   FOMO URLs are taken from JSON as-is and never rewritten. */
(function () {
  "use strict";

  var DEFAULT_SUPABASE = "https://latlkpoibmnqveeonxhx.supabase.co";
  var POLL_MS = 15000;
  var STORAGE_KEY = "desk.cfg";
  var SEEN_KEY = "desk.seenActivity";
  var RANGES = ["LIVE", "1H", "4H", "1D", "1W", "ALL"];
  var AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  var AGENT_TITLE = {
    scanner: "Scanner",
    auditor: "Auditor",
    analyst: "Analyst",
    executor: "Executor",
    risk: "Risk"
  };
  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- config (fragment → localStorage, then strip) ---------- */

  function readFragment() {
    var raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return {};
    var out = {};
    raw.split("&").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) {
        if (part) out[decodeURIComponent(part)] = "";
        return;
      }
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    });
    return out;
  }

  function loadStored() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
    } catch (e) {
      return {};
    }
  }

  function saveStored(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      t: cfg.t || "",
      d: cfg.d || "",
      u: cfg.u || ""
    }));
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
      history.replaceState(null, "", location.pathname + location.search);
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
    var sign = v > 0 ? "+" : v < 0 ? "" : "";
    return sign + v.toFixed(d) + "%";
  }

  function fmtMult(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toFixed(2) + "×";
  }

  function fmtAge(min) {
    if (min == null || isNaN(min)) return "";
    var m = Math.max(0, Math.round(Number(min)));
    if (m < 60) return m + "m old";
    var h = Math.floor(m / 60);
    if (h < 48) return h + "h old";
    return Math.floor(h / 24) + "d old";
  }

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" });
  }

  function fmtTimeFull(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "Europe/Berlin"
    });
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
    var t = String(text);
    if (/^[+\u25b2]/.test(t) || /\$\d/.test(t) && !t.startsWith("-")) {
      if (t.startsWith("+") || t.startsWith("▲")) return "up";
    }
    if (t.startsWith("-") || t.startsWith("▼") || t.indexOf("-$") !== -1) return "down";
    if (/skipped/i.test(t)) return "skip";
    return "";
  }

  function reduced() { return REDUCE; }

  /* ---------- data store ---------- */

  var state = {
    boot: true,
    ready: false,
    offline: false,
    retryIn: 0,
    lastOk: null,
    lastError: null,
    range: "LIVE",
    tab: "home",
    screen: "home", /* home|agents|activity|account|coin|audit|search|notifs */
    mint: null,
    query: "",
    data: {
      state: null,
      charts: {},
      activity: null,
      account: null,
      settings: null,
      decisions: {},
      coins: {},
      audits: {}
    }
  };

  function mode() {
    var s = state.data.state;
    return (s && s.mode) || (state.data.account && state.data.account.mode) || "PAPER";
  }

  function isPaper() { return String(mode()).toUpperCase() !== "LIVE"; }

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
      getJson("settings.json")
    ]).then(function (arr) {
      state.data.state = arr[0];
      state.data.charts[state.range] = arr[1];
      state.data.activity = arr[2];
      state.data.account = arr[3];
      state.data.settings = arr[4];
      state.offline = false;
      state.lastOk = new Date();
      state.lastError = null;
      state.ready = true;
      state.retryIn = 0;
    });
  }

  function pullDecisions() {
    return Promise.all(AGENTS.map(function (n) {
      return getJson("agents/" + n + "/decisions.json").then(function (j) {
        state.data.decisions[n] = j;
      }).catch(function () {});
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
      if (left <= 0) {
        clearInterval(retryTimer);
        refresh();
      }
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
      paint();
    }).catch(function (err) {
      state.offline = true;
      state.lastError = String((err && err.message) || err);
      state.boot = false;
      if (state.ready) {
        scheduleRetry();
      } else {
        paint();
        scheduleRetry();
      }
    });
  }

  /* ---------- navigation ---------- */

  function go(screen, opt) {
    opt = opt || {};
    state.screen = screen;
    if (screen === "home" || screen === "agents" || screen === "activity" || screen === "account") {
      state.tab = screen;
    }
    if (opt.mint) state.mint = opt.mint;
    if (screen === "activity") markActivitySeen();
    paint();
    if (opt.mint) pullMint(opt.mint).then(paint);
  }

  function openRow(row) {
    if (!row || !row.mint) return;
    var agent = (row.agent || "").toLowerCase();
    var kind = (row.kind || "").toLowerCase();
    if (agent === "auditor" || (kind === "rejected" && agent !== "analyst")) {
      go("audit", { mint: row.mint });
    } else if (agent === "analyst" && kind === "rejected") {
      go("audit", { mint: row.mint });
    } else {
      go("coin", { mint: row.mint });
    }
  }

  function unreadCount() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var seen = 0;
    try { seen = Number(localStorage.getItem(SEEN_KEY) || 0); } catch (e) {}
    var n = 0;
    for (var i = 0; i < rows.length; i++) if ((rows[i].id || 0) > seen) n++;
    return n;
  }

  function markActivitySeen() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var max = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].id > max) max = rows[i].id;
    try { localStorage.setItem(SEEN_KEY, String(max)); } catch (e) {}
  }

  /* ---------- icons (inline svg) ---------- */

  function ico(name) {
    var s = 'xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
    if (name === "home") return '<svg ' + s + '><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/></svg>';
    if (name === "agents") return '<svg ' + s + '><circle cx="7" cy="8" r="2.4"/><circle cx="17" cy="8" r="2.4"/><circle cx="12" cy="16" r="2.4"/><path d="M4.2 19c.6-2 2.1-3.2 3.8-3.2M16 15.8c1.7 0 3.2 1.2 3.8 3.2M12 11.2c1.7 0 3.1 1 3.7 2.6"/></svg>';
    if (name === "activity") return '<svg ' + s + '><path d="M4 12h3.2l2.1-6 3.4 12 2.2-6H20"/></svg>';
    if (name === "account") return '<svg ' + s + '><circle cx="12" cy="9" r="3"/><path d="M6 19c.8-2.8 3-4.2 6-4.2s5.2 1.4 6 4.2"/></svg>';
    if (name === "search") return '<svg ' + s + '><circle cx="11" cy="11" r="6"/><path d="M16 16.5 20 20.5"/></svg>';
    if (name === "bell") return '<svg ' + s + '><path d="M6.5 16h11v-5.2a5.5 5.5 0 0 0-11 0z"/><path d="M10 16v.8a2 2 0 0 0 4 0V16"/><path d="M12 4.5v1.3"/></svg>';
    if (name === "back") return '<svg ' + s + '><path d="M15 5 8 12l7 7"/></svg>';
    return "";
  }

  /* ---------- odometer ---------- */

  var lastOdo = null;

  function renderOdometer(value) {
    var text = fmtUsd(value, 2);
    var html = '<div class="odometer" aria-label="' + esc(text) + '">';
    var prev = lastOdo || text;
    if (prev.length !== text.length) prev = text;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (/\d/.test(ch)) {
        var from = /\d/.test(prev[i]) ? Number(prev[i]) : Number(ch);
        var to = Number(ch);
        var delay = reduced() ? 0 : (text.length - 1 - i) * 30;
        var fromY = from * -0.95;
        var toY = to * -0.95;
        html += '<span class="odo-col"><span class="odo-reel' + (reduced() ? "" : " roll") + '" data-to="' + toY + 'em" data-delay="' + delay + '" style="transform:translateY(' + fromY + 'em)">';
        for (var d = 0; d <= 9; d++) html += '<span class="d">' + d + "</span>";
        html += "</span></span>";
      } else {
        html += '<span class="sym">' + esc(ch) + "</span>";
      }
    }
    html += "</div>";
    lastOdo = text;
    return html;
  }

  function kickOdometer(root) {
    if (!root) return;
    var reels = root.querySelectorAll(".odo-reel.roll");
    reels.forEach(function (el) {
      var to = el.getAttribute("data-to");
      var delay = Number(el.getAttribute("data-delay") || 0);
      requestAnimationFrame(function () {
        setTimeout(function () { el.style.transform = "translateY(" + to + ")"; }, delay);
      });
    });
  }

  /* ---------- canvas: line chart ---------- */

  var chartAnim = { range: null, from: null, to: null, start: 0, marksOn: 0 };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function drawLineChart(canvas, chart, animate) {
    if (!canvas || !chart) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 390;
    var cssH = canvas.clientHeight || 196;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var pts = (chart.points || []).slice();
    var padL = 16, padR = 16, padT = 28, padB = 16;
    var w = cssW - padL - padR, h = cssH - padT - padB;
    var startVal = chart.start_value != null ? Number(chart.start_value) : (pts[0] ? Number(pts[0].v) : 0);
    var marks = chart.marks || [];
    var empty = marks.length === 0;

    var vals = pts.map(function (p) { return Number(p.v); });
    vals.push(startVal);
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;

    function xAt(i, n) {
      if (n <= 1) return padL + w / 2;
      return padL + (i / (n - 1)) * w;
    }
    function yAt(v) { return padT + (1 - (v - min) / span) * h; }

    /* dashed start line */
    var y0 = yAt(startVal);
    ctx.save();
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y0);
    ctx.lineTo(padL + w, y0);
    ctx.stroke();
    ctx.restore();

    if (empty && pts.length <= 2) {
      /* empty state: dashed start line only, caption is HTML */
      return;
    }

    /* slide last point */
    var drawPts = pts.map(function (p) { return { t: p.t, v: Number(p.v) }; });
    var tAnim = 1;
    if (animate && !reduced() && chartAnim.to && chartAnim.range === chart.range) {
      var u = Math.min(1, (performance.now() - chartAnim.start) / 250);
      tAnim = easeOut(u);
      if (chartAnim.from && chartAnim.from.length === drawPts.length - 1 && drawPts.length > 1) {
        var last = drawPts[drawPts.length - 1];
        var prev = drawPts[drawPts.length - 2];
        last._xMix = tAnim;
        last._from = prev;
      }
    }

    function ptX(i, n, p) {
      var x = xAt(i, n);
      if (p && p._xMix != null) {
        var x0 = xAt(i - 1, n);
        return lerp(x0, x, p._xMix);
      }
      return x;
    }

    var n = drawPts.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var x = ptX(i, n, drawPts[i]);
      var y = yAt(drawPts[i].v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    var lastX = n ? ptX(n - 1, n, drawPts[n - 1]) : padL;
    var lastY = n ? yAt(drawPts[n - 1].v) : y0;
    ctx.lineTo(lastX, padT + h);
    ctx.lineTo(padL, padT + h);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + h);
    grad.addColorStop(0, "rgba(0,211,90,0.28)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (var j = 0; j < n; j++) {
      var xj = ptX(j, n, drawPts[j]);
      var yj = yAt(drawPts[j].v);
      if (j === 0) ctx.moveTo(xj, yj); else ctx.lineTo(xj, yj);
    }
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    /* marks, no overlap: later mark moves up a row */
    var markAlpha = 1;
    if (animate && !reduced() && chartAnim.marksOn) {
      markAlpha = Math.min(1, (performance.now() - chartAnim.marksOn) / 200);
    }
    var times = pts.map(function (p) { return new Date(p.t).getTime(); });
    var t0 = times.length ? times[0] : 0;
    var t1 = times.length ? times[times.length - 1] : 1;
    var used = [];
    var rowH = 16;
    marks.forEach(function (m) {
      var tm = new Date(m.t).getTime();
      var mx;
      if (t1 === t0) mx = padL + w / 2;
      else mx = padL + ((tm - t0) / (t1 - t0)) * w;
      mx = Math.max(padL + 8, Math.min(padL + w - 8, mx));
      var my = yAt(pts.length ? nearestVal(pts, m.t) : startVal) - 12;
      var row = 0;
      var label = String(m.label || "");
      ctx.save();
      ctx.font = "600 11px " + getComputedStyle(document.body).fontFamily;
      var tw = ctx.measureText(label).width;
      var lx = Math.max(padL, Math.min(mx - tw / 2, padL + w - tw));
      function hits(r) {
        var top = my - 4 - r * rowH;
        for (var k = 0; k < used.length; k++) {
          var u = used[k];
          if (Math.abs(u.y - top) < rowH - 1 && !(lx + tw < u.x || lx > u.x + u.w)) return true;
        }
        return false;
      }
      while (hits(row) && row < 6) row++;
      var ty = my - 4 - row * rowH;
      used.push({ x: lx, w: tw, y: ty });
      ctx.globalAlpha = markAlpha;
      ctx.fillStyle = m.color || "#0a84ff";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, lx, ty);
      ctx.restore();
    });

    if (animate && !reduced()) {
      var more = (performance.now() - chartAnim.start) < 260 || (chartAnim.marksOn && performance.now() - chartAnim.marksOn < 210);
      if (more) requestAnimationFrame(function () { drawLineChart(canvas, chart, true); });
    }
  }

  function nearestVal(pts, t) {
    var tm = new Date(t).getTime();
    var best = pts[0].v, bd = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(new Date(pts[i].t).getTime() - tm);
      if (d < bd) { bd = d; best = pts[i].v; }
    }
    return Number(best);
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
      ctx.fillStyle = "rgba(235,235,245,0.6)";
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
      ctx.strokeStyle = ctx.fillStyle = up ? "#00d35a" : "#ff453a";
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
      ctx.strokeStyle = "#ff9f0a";
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
      ctx.fillStyle = (b.c >= b.o) ? "rgba(0,211,90,0.55)" : "rgba(255,69,58,0.55)";
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
    ctx.strokeStyle = "#2c2c2e";
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
    var col = s >= (minScore || 70) ? "#00d35a" : "#ff9f0a";
    if (s < 40) col = "#ff453a";
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
      if (passing) ctx.fillStyle = "rgba(0,211,90,0.85)";
      else if (failing) ctx.fillStyle = "rgba(255,69,58,0.85)";
      else ctx.fillStyle = "#2c2c2e";
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
      ctx.strokeStyle = "#64d2ff";
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

  /* ---------- chrome ---------- */

  function paperBadge() {
    return isPaper() ? '<span class="badge-paper">PAPER</span>' : "";
  }

  function navbarHome() {
    return '<header class="navbar">' +
      '<button class="nav-btn" data-go="account" aria-label="Account"><span class="avatar">G</span></button>' +
      '<div class="title">Grok Bot <span class="chev">›</span></div>' +
      '<button class="nav-btn" data-go="search" aria-label="Search">' + ico("search") + "</button>" +
      '<button class="nav-btn" data-go="notifs" aria-label="Notifications">' + ico("bell") +
        '<span class="bell-dot' + (unreadCount() ? " on" : "") + '"></span></button>' +
      "</header>";
  }

  function navbarPush(title, extra) {
    return '<header class="navbar">' +
      '<button class="nav-btn" data-act="back" aria-label="Back">' + ico("back") + "</button>" +
      '<div class="title">' + esc(title) + (extra || "") + "</div>" +
      "</header>";
  }

  function bannerHtml() {
    if (!state.offline) return "";
    var last = state.lastOk ? fmtTimeFull(state.lastOk.toISOString()) : "never";
    var n = Math.max(0, state.retryIn || 0);
    return '<div class="banner">Desk offline · retrying in ' + n + "s · last update " + esc(last) + "</div>";
  }

  function tabbar() {
    var tabs = [
      ["home", "Home", "home"],
      ["agents", "Agents", "agents"],
      ["activity", "Activity", "activity"],
      ["account", "Account", "account"]
    ];
    var hide = state.screen === "coin" || state.screen === "audit" || state.screen === "search" || state.screen === "notifs";
    if (hide) return "";
    return '<nav class="tabbar">' + tabs.map(function (t) {
      return '<button data-go="' + t[0] + '" class="' + (state.tab === t[0] ? "on" : "") + '">' +
        ico(t[2]) + "<span>" + t[1] + "</span></button>";
    }).join("") + "</nav>";
  }

  /* ---------- skeletons / lock ---------- */

  function skeletonHome() {
    return navbarHome() +
      '<div class="screen with-tabs">' +
      '<div class="skl skl-balance"></div><div class="skl skl-meta"></div>' +
      '<div class="skl skl-chart"></div><div class="skl skl-ranges"></div>' +
      '<div class="skl skl-card"></div>' +
      '<div class="skl skl-row"></div><div class="skl skl-row"></div><div class="skl skl-row"></div>' +
      "</div>" + tabbar();
  }

  function lockScreen() {
    return '<div class="lock"><h1>Grok Bot</h1><p>Open the link from Telegram</p></div>';
  }

  /* ---------- agent card body ---------- */

  function statusDot(st) {
    var s = st || "down";
    return '<span class="dot ' + esc(s) + '"></span>';
  }

  function agentCardInner(a, full) {
    var name = a.name;
    var html = '<div class="ac-top"><div class="ac-name">' + statusDot(a.status) + esc(AGENT_TITLE[name] || name) + "</div>";
    if (full) {
      html += '<span class="muted">' + esc(a.status || "") + "</span>";
    }
    html += "</div>";
    html += '<div class="ac-head">' + esc(a.headline || "") + "</div>";
    html += '<div class="ac-body">';
    if (name === "scanner") {
      var feed = a.feed || [];
      if (!feed.length) html += '<div class="muted">Listening for graduations</div>';
      else {
        html += '<ul class="feed">';
        feed.slice(0, full ? 12 : 7).forEach(function (f) {
          var kill = f.verdict !== "pass";
          html += '<li class="' + (kill ? "kill" : "pass") + '" data-coin="' + esc(f.mint) + '">' +
            '<span class="nm">' + esc(f.name || f.title || "") + "</span>" +
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
          var mark = cls === "ok" ? "✓" : cls === "bad" ? "✕" : "";
          html += '<div class="layer-strip ' + cls + '"><span class="mark">' + mark + "</span>" +
            esc((ly && ly.name) || ("Layer " + i)) + "</div>";
        }
        html += "</div>";
        if (a.last) {
          var allOk = layers.length === 8 && layers.every(function (x) { return x.pass && x.value !== "not checked"; });
          var reason = (layers.filter(function (x) { return x.pass === false && x.value !== "not checked"; })[0] || {}).value;
          html += '<div class="muted" style="margin-top:8px">' +
            (allOk ? "8/8 → Executor" : esc(reason || "taking apart...")) +
            (a.rejected ? " · " + a.rejected + " rejected" : "") + "</div>";
        } else html += '<div class="muted">taking apart...</div>';
      }
    } else if (name === "analyst") {
      html += '<div class="score-row"><canvas class="score-ring" data-score="' +
        (a.score == null ? "" : a.score) + '" data-min="' + (a.min_score || 70) + '"></canvas>' +
        '<div><div class="muted">min ' + esc(String(a.min_score || 70)) +
        (a.mode ? " · " + esc(a.mode) : "") + "</div></div></div>";
    } else if (name === "executor") {
      var sz = a.last_size_usd;
      html += '<div class="exec-line">' +
        (sz != null ? esc(fmtUsd(sz)) + " · " + esc(String(a.stack_pct)) + "% of stack" : "No fills yet") +
        "</div>";
      if (sz != null) html += '<div class="exec-ok">✓ Filled</div>';
    } else if (name === "risk") {
      html += '<div>' + esc(a.headline || "Guarding") + "</div>";
      html += '<div class="pills">' +
        '<span class="pill red">stop −' + esc(String(a.stop_pct)) + "%</span>" +
        '<span class="pill green">trail ' + esc(String(a.trail_pct)) + "%</span></div>";
    }
    html += "</div>";
    return html;
  }

  /* ---------- pages ---------- */

  function pageHome() {
    var st = state.data.state || {};
    var chart = state.data.charts[state.range] || {};
    var marks = chart.marks || [];
    var emptyChart = !marks.length;
    var today = st.today_pct;
    var cls = today > 0 ? "up" : today < 0 ? "down" : "flat";
    var running = (st.agents || []).filter(function (a) { return a.status === "running"; }).length;
    var html = navbarHome() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="balance-block"><div class="balance-row" id="bal-row">';
    html += renderOdometer(st.balance);
    html += paperBadge();
    html += "</div>";
    html += '<div class="meta-row"><span class="' + cls + '">' +
      (today > 0 ? "+" : "") + (today == null ? "0.00%" : Number(today).toFixed(2) + "%") +
      '</span><span class="mult-pill">' + esc(fmtMult(st.multiplier)) + "</span></div></div>";
    html += '<div class="chart-wrap"><canvas id="home-chart"></canvas>' +
      (emptyChart ? '<div class="chart-empty">Waiting for the first trade</div>' : "") + "</div>";
    html += '<div class="ranges">' + RANGES.map(function (r) {
      return '<button data-range="' + r + '" class="' + (state.range === r ? "on" : "") + '">' + r + "</button>";
    }).join("") + "</div>";
    html += '<div class="section-h"><h2>Agents <span class="sub">· ' + running + " running</span></h2></div>";
    html += '<div class="carousel">';
    (st.agents || []).forEach(function (a) {
      html += '<article class="agent-card" data-agent="' + esc(a.name) + '" data-go-agent="' + esc(a.name) + '">' +
        agentCardInner(a, false) + "</article>";
    });
    html += "</div>";
    html += '<div class="section-h"><h2>Activity</h2><button class="link" data-go="activity">See all</button></div>';
    var rows = ((state.data.activity && state.data.activity.rows) || []).slice(0, 5);
    if (!rows.length) html += '<div class="empty">Nothing yet tonight</div>';
    else html += renderRows(rows);
    html += "</div>" + tabbar();
    return html;
  }

  function renderRows(rows) {
    var html = '<div class="rows">';
    rows.forEach(function (r) {
      var vc = classifyVal(r.value);
      html += '<button class="row" data-row-mint="' + esc(r.mint || "") + '" data-row-agent="' + esc(r.agent || "") +
        '" data-row-kind="' + esc(r.kind || "") + '">' +
        '<div class="t">' + esc(r.title || "") + "</div>" +
        '<div class="v ' + vc + '">' + esc(r.value || "") + "</div>" +
        '<div class="s">' + esc(r.subtitle || "") + (r.ts ? " · " + fmtTime(r.ts) : "") + "</div>" +
        "</button>";
    });
    html += "</div>";
    return html;
  }

  function pageAgents() {
    var st = state.data.state || {};
    var html = navbarHome() + bannerHtml() + '<div class="screen with-tabs">';
    (st.agents || []).forEach(function (a) {
      html += '<article class="agent-card wide" data-agent="' + esc(a.name) + '">' + agentCardInner(a, true);
      var openPos = a.name === "risk" && a.open_positions > 0;
      if (openPos) {
        html += '<div class="tg-note">Risk is locked while a position is open. Change in Telegram: <code class="cmd">/pause risk</code></div>';
      } else {
        html += '<div class="tg-note">Pause or resume in Telegram: <code class="cmd">/' +
          (a.status === "paused" ? "resume" : "pause") + " " + esc(a.name) + "</code></div>";
      }
      html += '<div class="tg-note">Settings: <code class="cmd">/set ' + esc(a.name) + ".</code></div>";
      var dec = (state.data.decisions[a.name] && state.data.decisions[a.name].decisions) || [];
      if (dec.length) {
        html += '<ul class="feed" style="margin-top:10px">';
        dec.slice(0, 20).forEach(function (d) {
          html += '<li data-coin="' + esc(d.mint) + '" data-agent-link="' + esc(a.name) + '">' +
            '<span class="nm">' + esc(fmtTime(d.ts) + " · " + (d.name || "")) + "</span>" +
            '<span class="why">' + esc((d.verdict || "") + (d.reason ? " · " + d.reason : "")) + "</span></li>";
        });
        html += "</ul>";
      }
      html += "</article>";
    });
    html += "</div>" + tabbar();
    return html;
  }

  function pageActivity() {
    var rows = (state.data.activity && state.data.activity.rows) || [];
    var html = navbarHome() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="section-h"><h2>Activity</h2></div>';
    if (!rows.length) html += '<div class="empty">Nothing yet tonight</div>';
    else html += renderRows(rows);
    html += "</div>" + tabbar();
    return html;
  }

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
    var html = navbarHome() + bannerHtml() + '<div class="screen with-tabs">';
    html += '<div class="section-h"><h2>Account</h2></div>';
    html += '<div class="list">';
    html += '<div class="list-row"><span class="lbl">Mode</span><div class="seg">' +
      '<button class="' + (mode() === "PAPER" ? "on" : "") + '" disabled>PAPER</button>' +
      '<button class="' + (mode() === "LIVE" ? "on" : "") + '" disabled>LIVE</button></div></div>';
    html += '<div class="list-row"><span class="lbl">Stack</span><span class="val num">' + esc(fmtUsd(acc.stack)) + "</span></div>";
    html += "</div>";
    html += '<div class="tg-note" style="padding:8px 16px 0">Change in Telegram: <code class="cmd">/mode LIVE</code> or <code class="cmd">/set desk.paper_start_stack ' +
      esc(acc.stack == null ? "" : acc.stack) + "</code>. Switching to LIVE needs a full PAPER night and you typing LIVE.</div>";

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
      ["executor", "Executor"], ["risk", "Risk"], ["desk", "Desk"]
    ];
    groups.forEach(function (g) {
      html += '<div class="group"><div class="group-title">' + g[1] + "</div><div class=\"list\">";
      Object.keys(stg).sort().forEach(function (k) {
        if (k.split(".")[0] === g[0]) html += settingControl(k, stg[k]);
      });
      html += "</div></div>";
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
        '<div class="sub">Grok Bot won\'t buy ' + esc(audit.name || "") + "</div></div>";
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

  function paint() {
    if (!CFG.t || !CFG.d) {
      root.innerHTML = lockScreen();
      return;
    }
    if (state.boot && !state.ready) {
      root.innerHTML = skeletonHome();
      bind();
      return;
    }
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
    bind();
    afterPaint();
    lastScreen = state.screen;
  }

  function paintBannerOnly() {
    var b = root.querySelector(".banner");
    var html = bannerHtml();
    if (!html) {
      if (b) b.remove();
      return;
    }
    if (b) b.outerHTML = html;
    else {
      var nav = root.querySelector(".navbar");
      if (nav) nav.insertAdjacentHTML("afterend", html);
    }
  }

  function afterPaint() {
    kickOdometer(root.querySelector("#bal-row"));
    var hc = root.querySelector("#home-chart");
    if (hc) {
      var ch = state.data.charts[state.range];
      if (ch) {
        if (chartAnim.range !== state.range) {
          chartAnim = { range: state.range, from: null, to: ch.points, start: performance.now(), marksOn: performance.now() };
        } else {
          var prev = chartAnim.to;
          if (prev && ch.points && ch.points.length > prev.length) {
            chartAnim.from = prev;
            chartAnim.to = ch.points;
            chartAnim.start = performance.now();
            chartAnim.marksOn = performance.now();
          } else {
            chartAnim.to = ch.points;
          }
        }
        drawLineChart(hc, ch, true);
      }
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
    if (si) {
      si.focus();
      var val = si.value;
      si.selectionStart = si.selectionEnd = val.length;
    }
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
        getJson("chart-" + state.range + ".json").then(function (j) {
          state.data.charts[state.range] = j;
          paint();
        }).catch(function () {});
      });
    });
    root.querySelectorAll("[data-go-agent]").forEach(function (el) {
      el.addEventListener("click", function () { go("agents"); });
    });
    root.querySelectorAll("[data-row-mint]").forEach(function (el) {
      el.addEventListener("click", function () {
        openRow({
          mint: el.getAttribute("data-row-mint"),
          agent: el.getAttribute("data-row-agent"),
          kind: el.getAttribute("data-row-kind")
        });
      });
    });
    root.querySelectorAll("[data-coin]").forEach(function (el) {
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var mint = el.getAttribute("data-coin");
        var agent = el.getAttribute("data-agent-link") || "";
        if (agent === "auditor" || agent === "analyst") go("audit", { mint: mint });
        else go("coin", { mint: mint });
      });
    });
    root.querySelectorAll("[data-act='invite']").forEach(function (el) {
      el.addEventListener("click", invite);
    });
    var si = root.querySelector("#search-in");
    if (si) {
      si.addEventListener("input", function () {
        state.query = si.value;
        paint();
      });
    }
  }

  function invite() {
    var url = state.data.account && state.data.account.signup_url;
    if (!url) return;
    if (navigator.share) {
      navigator.share({ title: "FOMO", url: url }).catch(function () { copyLink(url); });
    } else copyLink(url);
  }

  function copyLink(url) {
    function toast() {
      var t = document.createElement("div");
      t.className = "toast";
      t.textContent = "Link copied";
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(toast).catch(function () { fallback(url, toast); });
    } else fallback(url, toast);
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

  window.addEventListener("resize", function () {
    afterPaint();
  });

  if (!CFG.t || !CFG.d) {
    paint();
    return;
  }
  paint();
  refresh().then(startPoll);
})();
