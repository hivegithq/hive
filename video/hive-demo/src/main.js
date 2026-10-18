// Hive demo: one paused GSAP timeline. Every visual is a function of time.
(function () {
  const H = window.HIVE;
  const ST = H.starts, LEAD = H.lead;
  const tl = gsap.timeline({ paused: true });
  const T = (n, t) => ST[n - 1] + t; // scene-local
  const V = (n, t) => ST[n - 1] + LEAD[n - 1] + t; // narration-local
  const $ = (s) => document.querySelector(s);
  const mk = (tag, cls, html, parent, style) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (style) e.setAttribute("style", style);
    if (parent) parent.appendChild(e);
    return e;
  };
  const show = (t, sel, d = 0.55, from = { y: 26 }) =>
    tl.fromTo(sel, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, scale: 1, duration: d, ease: "power3.out" }, t);
  const hide = (t, sel, d = 0.4) => tl.to(sel, { opacity: 0, duration: d, ease: "power2.in" }, t);
  const camXY = (cx, cy, s, W, Hh) => ({ x: W / 2 - cx * s, y: Hh / 2 - cy * s, scale: s });
  const camSet = (t, img, cx, cy, s, W = 1920, Hh = 1080) => tl.set(img, camXY(cx, cy, s, W, Hh), t);
  const cam = (t, img, d, cx, cy, s, W = 1920, Hh = 1080, ease = "power2.inOut") =>
    tl.to(img, { ...camXY(cx, cy, s, W, Hh), duration: d, ease }, t);
  // highlight a rect given in image coordinates under a fixed camera c = {l,t,W,H,cx,cy,s}
  const hl = (t, sel, d, rect, c, pad = 10) => {
    const [x, y, w, h] = rect;
    tl.set(sel, {
      left: c.l + c.W / 2 + (x - c.cx) * c.s - pad,
      top: c.t + c.H / 2 + (y - c.cy) * c.s - pad,
      width: w * c.s + 2 * pad,
      height: h * c.s + 2 * pad,
    }, t);
    tl.fromTo(sel, { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out", immediateRender: false }, t);
    tl.to(sel, { opacity: 0, duration: 0.3 }, t + d);
  };
  const tag = (t, sel, left, top, d) => {
    tl.set(sel, { left, top }, t);
    show(t, sel, 0.4, { y: 12 });
    if (d) hide(t + d, sel, 0.3);
  };
  const typeLine = (t, e, d) => tl.to(e, { width: e.dataset.w, duration: d, ease: `steps(${e.textContent.length})` }, t);
  const termLine = (box, text, cls = "") => {
    const e = mk("span", "tl " + cls, null, box);
    e.textContent = text;
    e.dataset.w = text.length + 0.5 + "ch";
    return e;
  };
  const counter = (t, e, to, d, fmt) => {
    const o = { v: 0 };
    tl.to(o, { v: to, duration: d, ease: "power2.out", onUpdate: () => { e.textContent = fmt(Math.round(o.v)); } }, t);
    tl.set(e, { textContent: fmt(0) }, Math.max(0, t - 0.01));
  };

  // ---------- deterministic swarm on a canvas ----------
  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function swarm(canvas, o) {
    const ctx = canvas.getContext("2d");
    const r = rng(o.seed);
    const cells = [];
    for (let q = -o.N; q <= o.N; q++)
      for (let s = -o.N; s <= o.N; s++) {
        if (Math.abs(q + s) > o.N) continue;
        const x = o.cx + o.size * Math.sqrt(3) * (q + s / 2);
        const y = o.cy + o.size * 1.5 * s;
        cells.push({ x, y, d: Math.hypot(x - o.cx, y - o.cy) + r() * o.size * 3, tone: 0.82 + r() * 0.18 });
      }
    cells.sort((a, b) => a.d - b.d);
    const outer = cells.map((c, i) => i).filter((i) => i > cells.length * 0.35);
    const red = new Set();
    while (red.size < o.nRed) red.add(outer[Math.floor(r() * outer.length)]);
    const live = cells.filter((c, i) => !red.has(i));
    const n = live.length;
    live.forEach((c, k) => {
      c.L = k === 0 ? o.first : o.first + 0.6 + (o.fill - o.first - 0.6) * Math.pow(k / (n - 1), o.pow);
      c.f = k === 0 ? 1.4 : 0.8 + r() * 0.9;
      c.sp = c.L - c.f;
      const side = r();
      c.sx = side < 0.7 ? -60 - r() * 120 : r() * 1920;
      c.sy = side < 0.7 ? r() * 1080 : side < 0.85 ? -60 : 1140;
      c.mx = (c.sx + c.x) / 2 + (r() - 0.5) * 500;
      c.my = (c.sy + c.y) / 2 + (r() - 0.5) * 500;
      c.ph = r() * 6.28;
    });
    cells.forEach((c, i) => (c.red = red.has(i)));
    const hexPath = (x, y, rad) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        ctx.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a));
      }
      ctx.closePath();
    };
    const pos = (c, p) => {
      const u = 1 - p;
      return [u * u * c.sx + 2 * u * p * c.mx + p * p * c.x, u * u * c.sy + 2 * u * p * c.my + p * p * c.y];
    };
    const ease = (p) => 1 - Math.pow(1 - p, 3);
    return function draw(t) {
      ctx.clearRect(0, 0, 1920, 1080);
      for (const c of cells) {
        hexPath(c.x, c.y, o.size * 0.9);
        if (c.red && t >= o.redAt) {
          const k = Math.min(1, (t - o.redAt) / 0.4);
          ctx.fillStyle = `rgba(240,96,93,${0.25 + 0.6 * (1 - k) + 0.15})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(240,96,93,.9)"; ctx.lineWidth = 1.5; ctx.stroke();
        } else if (!c.red && t >= c.L) {
          const k = Math.min(1, (t - c.L) / 0.35);
          const g = Math.round(173 + (255 - 173) * (1 - k)), b = Math.round(65 + (224 - 65) * (1 - k));
          ctx.fillStyle = `rgba(251,${g},${b},${c.tone})`;
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(125,141,161,.22)"; ctx.lineWidth = 1; ctx.stroke();
        }
      }
      for (const c of live) {
        if (t < c.sp || t >= c.L) continue;
        const p = ease((t - c.sp) / c.f);
        const [x, y] = pos(c, p);
        const [px, py] = pos(c, Math.max(0, p - 0.1));
        const grad = ctx.createLinearGradient(px, py, x, y);
        grad.addColorStop(0, "rgba(251,173,65,0)"); grad.addColorStop(1, "rgba(251,173,65,.55)");
        ctx.strokeStyle = grad; ctx.lineWidth = o.size * 0.18 + 1;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        const w = 3 + 3 * Math.abs(Math.sin(t * 70 + c.ph));
        const br = o.size * 0.42 + 2;
        ctx.fillStyle = "rgba(255,244,224,.55)";
        ctx.beginPath(); ctx.ellipse(x - br * 0.5, y - br * 0.9, w * (br / 6), br * 0.45, -0.4, 0, 6.29); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + br * 0.5, y - br * 0.9, w * (br / 6), br * 0.45, 0.4, 0, 6.29); ctx.fill();
        hexPath(x, y, br); ctx.fillStyle = "#fbad41"; ctx.fill();
      }
    };
  }
  const runCanvas = (draw, t0, t1) => {
    const o = { t: t0 };
    tl.fromTo(o, { t: t0 }, { t: t1, duration: t1 - t0, ease: "none", onUpdate: () => draw(o.t) }, t0);
  };

  // ---------- scene transitions: a bee flies across, revealing the next scene ----------
  const bee = (t, y = 520, d = 0.7) => {
    tl.set(["#xbee", "#xtrail"], { opacity: 1 }, t);
    tl.fromTo("#xbee", { x: -80, y: y - 32, rotation: 8 }, { x: 1940, y: y - 60, rotation: -6, duration: d, ease: "power2.inOut" }, t);
    tl.fromTo("#xtrail", { x: -420, y: y - 1, width: 360 }, { x: 1580, y: y - 29, duration: d, ease: "power2.inOut" }, t);
    tl.set(["#xbee", "#xtrail"], { opacity: 0 }, t + d);
  };
  tl.set(["#xbee", "#xtrail"], { opacity: 0 }, 0);
  for (let n = 2; n <= 11; n++) {
    const t0 = ST[n - 1] - 0.7;
    tl.fromTo(`#s${n}r`, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.7, ease: "power2.inOut" }, t0);
    bee(t0, 360 + ((n * 137) % 360));
  }

  // ---------- captions ----------
  const capBox = $("#caps");
  H.captions.forEach(([a, b, text]) => {
    const e = mk("div", "cap", null, capBox);
    e.textContent = text;
    tl.set(e, { opacity: 1 }, a);
    tl.set(e, { opacity: 0 }, b);
  });

  // =====================================================================
  // 1. Cold open
  // =====================================================================
  {
    const draw = swarm($("#swarm1"), { seed: 7, N: 12, size: 17, cx: 1260, cy: 540, first: 1.6, fill: 6.4, pow: 0.55, nRed: 13, redAt: 6.2 });
    runCanvas(draw, 0, 9.6);
    tl.fromTo("#s1plate", { scale: 1.12 }, { scale: 1.0, duration: 12, ease: "none" }, 0);
    show(V(1, 0.0), "#s1a", 0.4, { x: -40 });
    show(V(1, 1.9), "#s1b", 0.4, { x: -40 });
    show(V(1, 3.4), "#s1c", 0.4, { x: -40 });
    show(V(1, 4.7), "#s1d", 0.4, { y: 16 });
    hide(V(1, 5.9), "#s1a, #s1b, #s1c, #s1d", 0.35);
    tl.to("#swarm1", { x: -300, duration: 0.9, ease: "power2.inOut" }, V(1, 5.7));
    // match cut: the comb becomes the real 2,000-agent dashboard
    tl.set("#s1screen", { opacity: 0 }, 0);
    camSet(0, "#s1shot", 960, 250, 1.95);
    tl.to("#s1screen", { opacity: 1, duration: 0.6, ease: "power1.inOut" }, V(1, 6.5));
    tl.to("#swarm1", { opacity: 0, duration: 0.6 }, V(1, 6.6));
    cam(V(1, 6.9), "#s1shot", 1.8, 960, 540, 1.0);
    tl.set("#s1dim2", { opacity: 0 }, 0);
    tl.to("#s1dim2", { opacity: 1, duration: 0.5 }, V(1, 8.1));
    show(V(1, 8.2), "#s1title", 0.6, { y: 30 });
    hide(V(1, 10.3), "#s1title", 0.35);
    tl.to("#s1screen", { opacity: 0, duration: 0.5 }, V(1, 10.4));
    // what you'll see
    $("#s1count").innerHTML = [1, 2, 3, 4].map((i) => `<span class="abs pvc" id="pvc${i}">0${i} / 04</span>`).join("");
    show(V(1, 10.7), "#s1prevlabel", 0.4, { y: 16 });
    const pvT = [V(1, 12.2), V(1, 15.2), V(1, 18.3), V(1, 20.7), V(1, 22.9)];
    const pvCam = [
      [550, 250, 0.9, 0.96, 1100],
      [550, 760, 0.92, 1.0, 1100],
      [640, 900, 1.6, 1.75, 1920],
      [1610, 380, 1.6, 1.68, 1920],
    ];
    for (let i = 1; i <= 4; i++) {
      const a = pvT[i - 1], b = pvT[i];
      tl.set([`#pv${i}`, `#pvt${i}`, `#pvc${i}`], { opacity: 0 }, 0);
      const [cx, cy, s0, s1] = pvCam[i - 1];
      camSet(a, `#pv${i}i`, cx, cy, s0, 1000, 640);
      tl.to(`#pv${i}i`, { ...camXY(cx, cy, s1, 1000, 640), duration: b - a, ease: "none" }, a);
      show(a + 0.15, `#pv${i}`, 0.5, { x: 60 });
      show(a + 0.1, `#pvt${i}`, 0.45, { y: 18 });
      tl.set(`#pvc${i}`, { opacity: 1 }, a);
      if (i < 4) { hide(b - 0.1, [`#pv${i}`, `#pvt${i}`], 0.25); tl.set(`#pvc${i}`, { opacity: 0 }, b); }
      bee(a - 0.25, 300 + i * 110, 0.6);
    }
    hide(V(1, 22.6), "#s1prevlabel, #pv4, #pvt4", 0.3);
    show(V(1, 23.0), "#s1end", 0.5, { x: -40 });
  }

  // =====================================================================
  // 2. The problem
  // =====================================================================
  {
    tl.fromTo("#s2plate", { scale: 1.08 }, { scale: 1.0, duration: 22, ease: "none" }, T(2, -0.7));
    const glows = $("#s2glows");
    const spots = [[1123, 451], [1018, 480], [1142, 586], [974, 595]];
    spots.forEach(([x, y], i) => {
      mk("div", "abs", null, glows, `left:${x - 110}px; top:${y - 110}px; width:220px; height:220px; border-radius:50%; background:radial-gradient(circle, rgba(240,96,93,.75), rgba(240,96,93,0) 65%); opacity:0`).id = "glow" + i;
    });
    show(T(2, 0.3), "#s2h", 0.6);
    show(V(2, 4.4), "#s2h2", 0.4, { x: -30 });
    const qs = [
      ["Who is touching what, right now?", 9.8],
      ["Will two changes break each other, even on different lines?", 11.8],
      ["Should this one land?", 15.1],
      ["Why is the code like this?", 16.3],
    ];
    const box = $("#s2q");
    qs.forEach(([q, w], i) => {
      const row = mk("div", null, `<div class="hex" style="width:26px; height:30px; background:var(--alarm); flex:none; margin-top:6px"></div><div class="h3">${q}</div>`, box, "display:flex; gap:22px; margin-bottom:26px");
      show(V(2, w), row, 0.45, { x: -30 });
      tl.fromTo("#glow" + i, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1.1, duration: 0.35, ease: "power2.out" }, V(2, w));
      tl.to("#glow" + i, { opacity: 0.35, scale: 0.9, duration: 1.2, ease: "power1.inOut" }, V(2, w + 0.35));
    });
  }

  // =====================================================================
  // 3. The life of a change
  // =====================================================================
  {
    const nodes = [
      ["Goal", "A person or an agent describes an outcome.", "Dashboard · MCP · CLI", 0.3, false],
      ["Fork", "Every change gets its own repository.", "Artifacts", 1.9, true],
      ["Intent", "Files and functions, declared before code.", "Durable Objects", 6.5, true],
      ["Merge queue", "Rebase, typecheck, test, review.", "Workflows · Containers", 10.7, true],
      ["Clef", "Calibrated: land, bounce, or ask a person.", "Workers AI", 14.5, true],
      ["Trunk", "Plain git, every commit linked to why.", "Artifacts", 16.6, true],
    ];
    const xs = [200, 504, 808, 1112, 1416, 1720];
    const box = $("#s3nodes");
    tl.set("#s3token", { opacity: 0 }, 0);
    nodes.forEach(([title, desc, cf, w, isCf], i) => {
      const x = xs[i];
      const n = mk("div", "abs", null, box, `left:${x - 150}px; top:356px; width:300px; text-align:center`);
      mk("div", "hex", null, n, "position:relative; width:110px; height:127px; margin:0 auto; background:#fbad41");
      const inner = mk("div", "hex", `<span class="mono" style="font-size:30px; font-weight:600; color:var(--honey)">0${i + 1}</span>`, n.firstChild,
        "position:absolute; left:5px; top:5px; width:100px; height:117px; background:#141418; display:flex; align-items:center; justify-content:center");
      mk("div", "h3", title, n, "margin-top:22px");
      mk("p", "body", desc, n, "font-size:23px; margin:10px 10px 0");
      mk("div", null, `<span class="chip ${isCf ? "cf" : "steel"}">${cf}</span>`, n, "margin-top:16px");
      show(V(3, w), n, 0.5, { y: 30 });
      tl.to(inner, { backgroundColor: "#3a2a10", duration: 0.4 }, V(3, w));
      tl.to("#s3line", { attr: { "stroke-dashoffset": 1520 - (x - 200) }, duration: 0.6, ease: "power2.inOut" }, V(3, w) - 0.4);
      tl.to("#s3token", { opacity: 1, x: x - 17, y: 400, duration: 0.6, ease: "power2.inOut" }, V(3, w) - 0.4);
    });
    tl.set("#s3token", { x: 183, y: 400 }, 0);
    show(V(3, 17.6), "#s3ledger", 0.6, { y: 30 });
  }

  // =====================================================================
  // 4. A swarm, live
  // =====================================================================
  {
    const lanes = [
      ["Free shipping on orders over $50", "Kimi K2.7 Code", "checkout()"],
      ["Percentage discount codes", "GLM 5.3", "checkout() · applyDiscount"],
      ["Cart quantities", "DeepSeek V4 Pro", "Cart.add · Cart.setQuantity"],
      ["Format prices with thousands separators", "Kimi K2.7 Code", "formatPrice"],
      ["Accept euro-style decimals in parsePrice", "GLM 5.3", "parsePrice (new contract)"],
      ["Document the public API", "DeepSeek V4 Pro", "README examples → parsePrice"],
      ["Buy-two-get-one-free promotion", "race · 3 models", "promotionSavings · Receipt"],
    ];
    const svg = $("#s4svg");
    const NS = "http://www.w3.org/2000/svg";
    const ln = (attrs) => { const e = document.createElementNS(NS, "path"); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    const trunkY = 930;
    const trunk = ln({ d: `M120 ${trunkY} H1180`, stroke: "#fbad41", "stroke-width": 5, fill: "none", "stroke-dasharray": 1060, "stroke-dashoffset": 1060 });
    mk("div", "mono honey abs", "trunk", $("#s4lanes"), `left:120px; top:${trunkY + 14}px; font-size:21px`);
    tl.to(trunk, { attr: { "stroke-dashoffset": 0 }, duration: 0.8, ease: "power2.out" }, T(4, 0.1));
    const laneY = (i) => 185 + i * 98;
    const els = [];
    lanes.forEach(([goal, model, sym], i) => {
      const y = laneY(i), x0 = 150 + i * 26;
      const len = trunkY - y + 1000;
      const p = ln({ d: `M${x0} ${trunkY} V${y + 30} Q${x0} ${y} ${x0 + 30} ${y} H1240`, stroke: "#f6821f", "stroke-width": 3, fill: "none", "stroke-dasharray": len, "stroke-dashoffset": len, opacity: 0.85 });
      const label = mk("div", "abs", `<div style="font-size:24px; font-weight:500">${goal}</div><span class="chip steel" style="font-size:17px; margin-top:6px">${model}</span>`, $("#s4lanes"), `left:${x0 + 46}px; top:${y - 66}px`);
      const chip = mk("div", "abs chip", sym, $("#s4lanes"), `left:860px; top:${y - 54}px; font-size:18px`);
      const head = mk("div", "abs hex", null, $("#s4lanes"), `left:1228px; top:${y - 14}px; width:24px; height:28px; background:#f6821f`);
      els.push({ p, label, chip, head, y });
      const t = V(4, 1.6 + i * 0.5);
      tl.to(p, { attr: { "stroke-dashoffset": 0 }, duration: 0.9, ease: "power2.out" }, t);
      show(t + 0.2, label, 0.4, { x: -20 });
      show(t + 0.7, head, 0.3, { scale: 0.3 });
      show(V(4, 6.6 + i * 0.25), chip, 0.35, { y: 10 });
    });
    // structural overlap: two goals both change checkout()
    const arc1 = ln({ d: `M1190 ${laneY(0) - 40} C1260 ${laneY(0) - 20} 1260 ${laneY(1) - 60} 1190 ${laneY(1) - 40}`, stroke: "#f0605d", "stroke-width": 4, fill: "none", opacity: 0 });
    tl.to(arc1, { opacity: 1, duration: 0.3 }, V(4, 9.6));
    [0, 1].forEach((i) => tl.to(els[i].chip, { borderColor: "#f0605d", color: "#ffb0ae", backgroundColor: "rgba(240,96,93,.16)", duration: 0.3 }, V(4, 9.6)));
    tag(V(4, 9.8), "#s4ov1", 1290, laneY(0) - 40, 4.2);
    // referential overlap: parsePrice's contract vs code that uses it
    const arc2 = ln({ d: `M1190 ${laneY(4) - 40} C1260 ${laneY(4) - 20} 1260 ${laneY(5) - 60} 1190 ${laneY(5) - 40}`, stroke: "#fbad41", "stroke-width": 3, fill: "none", "stroke-dasharray": "8 8", opacity: 0 });
    tl.to(arc2, { opacity: 1, duration: 0.3 }, V(4, 14.3));
    tag(V(4, 14.5), "#s4ov2", 1290, laneY(4) - 40, 4.4);
    show(V(4, 19.1), "#s4merge", 0.45, { y: 20 });
    tl.set("#s4merge", { left: 1290, top: laneY(5) + 30 }, 0);
    hide(V(4, 22.4), "#s4merge", 0.3);
    tl.set("#s4clef", { left: 1290, top: laneY(5) + 30 }, 0);
    show(V(4, 22.6), "#s4clef", 0.45, { y: 20 });
    hide(V(4, 28.4), "#s4clef", 0.3);
    tl.to([arc1, arc2], { opacity: 0, duration: 0.3 }, V(4, 28.4));
    // landings: six disjoint changes land, one is held for a person
    const order = [3, 2, 6, 4, 5, 0];
    order.forEach((i, k) => {
      const t = V(4, 28.9 + k * 0.42);
      tl.to(els[i].p, { attr: { stroke: "#fbad41" }, duration: 0.2 }, t);
      tl.to(els[i].head, { y: trunkY - els[i].y, x: 560 + k * 70 - 1228, backgroundColor: "#fbad41", duration: 0.45, ease: "power2.in" }, t);
    });
    tl.to(els[1].p, { attr: { stroke: "#f0605d" }, duration: 0.3 }, V(4, 31.3));
    tl.to(els[1].head, { backgroundColor: "#f0605d", scale: 1.4, duration: 0.3 }, V(4, 31.3));
    const held = mk("div", "tag red", "needs a person", $("#s4lanes"), `left:1280px; top:${laneY(1) - 24}px`);
    show(V(4, 33.0), held, 0.35, { x: -10 });
    // the real dashboard
    tl.set(["#s4screen"], { opacity: 0 }, 0);
    camSet(0, "#s4shot", 960, 540, 1);
    const real = V(4, 37.0);
    tl.to("#s4screen", { opacity: 1, duration: 0.5 }, real);
    tl.to(["#s4svg", "#s4lanes", "#s4head"], { opacity: 0, duration: 0.3 }, real + 0.5);
    hl(real + 0.6, "#s4hl1", 2.3, [880, 175, 160, 135], { l: 0, t: 0, W: 1920, H: 1080, cx: 960, cy: 540, s: 1 });
    tag(real + 0.8, "#s4t1", 1100, 200, 2.2);
    cam(real + 3.0, "#s4shot", 1.0, 960, 880, 1.3);
    tag(real + 4.0, "#s4t2", 120, 140, 2.6);
    tl.set("#s4card", { opacity: 0 }, 0);
    camSet(0, "#s4ci", 550, 745, 1, 1100, 820);
    show(real + 6.7, "#s4card", 0.5, { y: 40 });
    hl(real + 7.4, "#s4hl2", 3.8, [8, 668, 1084, 150], { l: 410, t: 120, W: 1100, H: 820, cx: 550, cy: 745, s: 1 });
  }

  // =====================================================================
  // 5. Convergence
  // =====================================================================
  {
    const steps = $("#s5steps");
    const row = (name, cmd, color = "honey") =>
      mk("div", null, `<span class="mono ${color}" style="font-size:22px; width:130px; flex:none">${name}</span><span style="font-size:25px">${cmd}</span>`, steps, "display:flex; gap:18px; align-items:baseline; padding:14px 0; border-bottom:1px solid var(--line)");
    const r1 = row("merge", "Structural merge with mergiraf");
    const r2 = row("typecheck", "npm run -s typecheck");
    const r3 = row("test", "npm run -s test");
    const r4 = row("review", "85/100 · <span class='steel'>an opinion, not a test result</span>");
    const r5 = mk("div", null, `<div style="display:flex; gap:18px; align-items:baseline; padding:14px 0"><span class="mono honey" style="font-size:22px; width:130px">Clef</span><span style="font-size:25px">calibrated decision</span></div>`, steps);
    const bars = [["land", 94, "#fbad41"], ["bounce", 4, "#7d8da1"], ["escalate", 3, "#f0605d"]].map(([k, v, c]) => {
      const b = mk("div", null, `<span class="mono" style="font-size:20px; width:130px; display:inline-block; color:var(--mute)">${k}</span><span class="bar" style="display:inline-block; height:14px; width:0; background:${c}; border-radius:7px; vertical-align:middle"></span><span class="mono" style="font-size:20px; margin-left:14px">${v}%</span>`, r5, "margin:6px 0");
      return [b.querySelector(".bar"), v];
    });
    const r6 = mk("div", "h3 honey", "Landed on trunk.", steps, "margin-top:18px");
    const r7 = mk("div", null, `<span class="alarm h3" style="font-size:30px">Not sure? A person decides.</span>`, steps, "margin-top:10px");
    [[r1, 2.7], [r2, 5.4], [r3, 6.5], [r4, 7.3], [r5, 13.4], [r6, 17.8], [r7, 18.6]].forEach(([e, w]) => show(V(5, w), e, 0.4, { x: -20 }));
    bars.forEach(([b, v], i) => tl.to(b, { width: v * 3.4 + 4, duration: 0.8, ease: "power2.out" }, V(5, 14.6 + i * 0.15)));
    // the real drawer: GLM 5.3's change that won the race
    const C = (cx, cy, s) => ({ l: 860, t: 80, W: 1000, H: 860, cx, cy, s });
    tl.set("#s5b", { opacity: 0 }, 0);
    camSet(0, "#s5a", 550, 420, 0.9, 1000, 860);
    hl(V(5, 2.7), "#s5hl", 4.2, [8, 190, 1084, 355], C(550, 420, 0.9));
    hl(V(5, 7.3), "#s5hl", 4.0, [8, 572, 1084, 100], C(550, 420, 0.9));
    cam(V(5, 11.6), "#s5a", 1.2, 550, 760, 0.95, 1000, 860);
    hl(V(5, 13.4), "#s5hl", 5.0, [8, 690, 1084, 170], C(550, 760, 0.95));
    // a same-line conflict merged by a model in the queue
    const swap = V(5, 20.4);
    hide(swap, "#s5a", 0.4);
    hide(swap - 0.3, [r1, r2, r3, r4, r5, r6, r7], 0.3);
    const c1 = mk("div", null, `<div class="kicker">Same line, two agents</div><p class="h3" style="margin-top:14px">A model merges the conflict inside the queue.</p><p class="body" style="margin-top:14px">camelcheck · conflicts merged by DeepSeek V4 Pro, then typecheck and tests. Clef: land 0.90. Landed on its first attempt.</p>`, steps, "position:absolute; top:0; left:0; width:700px");
    show(swap + 0.3, c1, 0.5, { y: 20 });
    camSet(0, "#s5b", 550, 420, 0.9, 1000, 860);
    tl.to("#s5b", { opacity: 1, duration: 0.4 }, swap);
    hl(V(5, 21.3), "#s5hl", 2.6, [8, 222, 1084, 46], C(550, 420, 0.9));
    hl(V(5, 24.0), "#s5hl", 2.6, [8, 628, 1084, 160], C(550, 420, 0.9));
    // security
    const sec = V(5, 27.3);
    hide(sec - 0.2, ["#s5card", c1], 0.35);
    tl.set("#s5sec", { opacity: 0 }, 0);
    show(sec, "#s5sec", 0.5, { y: 30 });
    const c2 = mk("div", null, `<div class="kicker">Security is evidence too</div><p class="h3" style="margin-top:14px">Secret, dependency and code scanners on every batch.</p>`, steps, "position:absolute; top:0; left:0; width:700px");
    show(sec + 0.2, c2, 0.5, { y: 20 });
  }

  // =====================================================================
  // 6. A race
  // =====================================================================
  {
    const box = $("#s6lanes");
    const lanes = [["Kimi K2.7 Code", false], ["GLM 5.3", true], ["DeepSeek V4 Pro", false]];
    lanes.forEach(([m, win], i) => {
      const y = 330 + i * 165;
      const row = mk("div", "abs", `<div class="h3">${m}</div><div class="mono steel" style="font-size:19px; margin-top:6px">own fork · race lane ${i + 1}</div>`, box, `left:120px; top:${y}px; width:420px`);
      const track = mk("div", "abs", null, box, `left:560px; top:${y + 18}px; width:900px; height:22px; border-radius:11px; background:#1b1b20`);
      const fill = mk("div", null, null, track, "height:100%; width:0; border-radius:11px; background:#f6821f");
      const pass = mk("div", "abs chip", "tests passed", box, `left:1490px; top:${y + 10}px`);
      const res = mk("div", "abs tag " + (win ? "" : "ghost"), win ? "won · Clef land 0.94 · landed" : "lost the race · archived", box, `left:1490px; top:${y + 4}px`);
      show(V(6, 1.8 + i * 0.25), row, 0.4, { x: -20 });
      tl.to(fill, { width: "100%", duration: 2.0 - i * 0.2, ease: "power1.inOut" }, V(6, 1.9 + i * 0.1));
      show(V(6, 3.9), pass, 0.3, { y: 8 });
      hide(V(6, 6.9), pass, 0.2);
      show(V(6, 7.1 + (win ? 0 : 1.6)), res, 0.4, { x: -14 });
      tl.to(fill, { backgroundColor: win ? "#fbad41" : "#3a3f48", duration: 0.4 }, V(6, win ? 7.1 : 8.7));
      if (!win) tl.to(row, { opacity: 0.45, duration: 0.4 }, V(6, 8.7));
    });
    tl.set("#s6screen", { opacity: 0 }, 0);
    camSet(0, "#s6shot", 640, 900, 1.25);
    tl.to("#s6screen", { opacity: 1, duration: 0.5 }, V(6, 11.9));
    cam(V(6, 12.0), "#s6shot", 6, 640, 890, 1.6, 1920, 1080, "power1.inOut");
    tag(V(6, 12.4), "#s6t", 120, 80);
  }

  // =====================================================================
  // 7. You stay in charge
  // =====================================================================
  {
    const items = [["Comment on a line of the diff", 1.6], ["Ask why any line is here", 6.1], ["Rewind to any step, on any model", 13.1], ["Reviewers' asks become lessons", 18.6]];
    const list = $("#s7list");
    const rows = items.map(([txt], i) => mk("div", null, `<span class="mono honey" style="font-size:26px; width:52px; flex:none">0${i + 1}</span><span class="h3" style="font-size:34px">${txt}</span>`, list, "display:flex; gap:12px; align-items:baseline; margin-bottom:34px"));
    items.forEach(([, w], i) => {
      show(V(7, w), rows[i], 0.4, { x: -20 });
      if (i > 0) tl.to(rows[i - 1], { opacity: 0.4, duration: 0.3 }, V(7, w));
    });
    // 1: the diff, with a comment
    tl.set("#s7c1", { opacity: 0 }, 0);
    camSet(0, "#s7c1i", 550, 470, 0.89, 980, 760);
    show(V(7, 1.6), "#s7c1", 0.5, { x: 40 });
    tl.set("#s7bubble", { opacity: 0 }, 0);
    show(V(7, 2.6), "#s7bubble", 0.45, { y: 20, scale: 0.9 });
    hide(V(7, 5.8), "#s7bubble, #s7c1", 0.3);
    // 2: why is this line here?
    tl.set("#s7screen", { opacity: 0 }, 0);
    camSet(0, "#s7shot", 1700, 330, 1.7);
    tl.to("#s7screen", { opacity: 1, duration: 0.4 }, V(7, 6.0));
    cam(V(7, 6.2), "#s7shot", 6, 1710, 360, 1.85, 1920, 1080, "power1.inOut");
    const chain = $("#s7chain");
    [["line", 8.4], ["change", 8.9], ["goal", 9.8], ["intent", 10.6], ["proof", 11.4], ["decision", 12.1]].forEach(([w, t], i) => {
      if (i) mk("span", "mono honey", "→", chain, "font-size:26px").className += " s7arrow";
      const c = mk("span", "chip", w, chain, "font-size:24px; padding:10px 18px; background:rgba(13,13,15,.92)");
      show(V(7, t), c, 0.3, { y: 10 });
    });
    tl.set(".s7arrow", { opacity: 0 }, 0);
    tl.to(".s7arrow", { opacity: 1, duration: 0.2, stagger: 0.5 }, V(7, 8.7));
    hide(V(7, 12.9), "#s7screen, #s7chain", 0.3);
    // 3: rewind
    const svg = $("#s7rw");
    const NS = "http://www.w3.org/2000/svg";
    const dot = (x, y, fill) => { const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 13); c.setAttribute("fill", fill); svg.appendChild(c); return c; };
    const text = (x, y, s, fill, size = 20) => { const e = document.createElementNS(NS, "text"); e.setAttribute("x", x); e.setAttribute("y", y); e.setAttribute("fill", fill); e.setAttribute("font-family", "JetBrains Mono"); e.setAttribute("font-size", size); e.textContent = s; svg.appendChild(e); return e; };
    tl.set(svg, { opacity: 0 }, 0);
    tl.to(svg, { opacity: 1, duration: 0.3 }, V(7, 13.1));
    const dots = [];
    for (let i = 0; i < 12; i++) { dots.push(dot(60 + i * 78, 160, "#2a2a31")); text(52 + i * 78, 210, String(i + 1), "#7d8da1", 18); }
    text(40, 100, "attempt 1 · Kimi K2.7 Code", "#a9b2bf", 22);
    dots.forEach((d, i) => tl.to(d, { attr: { fill: "#f6821f" }, duration: 0.05 }, V(7, 13.2 + i * 0.07)));
    const back = text(60 + 6 * 78 - 40, 120, "◀ rewind to step 7", "#fbad41", 22);
    tl.set(back, { opacity: 0 }, 0);
    tl.to(back, { opacity: 1, duration: 0.3 }, V(7, 14.4));
    dots.slice(7).forEach((d) => tl.to(d, { attr: { fill: "#2a2a31" }, duration: 0.3 }, V(7, 14.5)));
    const br = document.createElementNS(NS, "path");
    br.setAttribute("d", `M${60 + 6 * 78} 160 C${60 + 6 * 78} 330 ${60 + 6 * 78 + 60} 360 ${60 + 6 * 78 + 140} 360 H940`);
    br.setAttribute("stroke", "#fbad41"); br.setAttribute("stroke-width", 4); br.setAttribute("fill", "none");
    br.setAttribute("stroke-dasharray", 700); br.setAttribute("stroke-dashoffset", 700); svg.appendChild(br);
    tl.to(br, { attr: { "stroke-dashoffset": 0 }, duration: 1.2, ease: "power2.out" }, V(7, 15.2));
    const t2 = text(60 + 6 * 78 + 150, 420, "attempt 2 · DeepSeek V4 Pro, told what went wrong", "#fbad41", 22);
    tl.set(t2, { opacity: 0 }, 0);
    tl.to(t2, { opacity: 1, duration: 0.4 }, V(7, 16.4));
    tl.to(svg, { opacity: 0, duration: 0.3 }, V(7, 18.3));
    tl.set("#s7lesson", { opacity: 0 }, 0);
    show(V(7, 18.6), "#s7lesson", 0.5, { y: 30 });
  }

  // =====================================================================
  // 8. Plans and scouts
  // =====================================================================
  {
    camSet(T(8, -0.7), "#s8shot", 640, 700, 1.4);
    cam(T(8, 0), "#s8shot", 8, 620, 710, 1.6, 1920, 1080, "power1.inOut");
    tl.set("#s8t1", { opacity: 0 }, 0);
    tag(V(8, 1.2), "#s8t1", 120, 70);
    tl.set("#s8scout", { opacity: 0 }, 0);
    tl.to("#s8scout", { opacity: 1, duration: 0.5 }, V(8, 8.0));
    const tree = $("#s8treel");
    const files = ["src/", "  orders.ts", "    findOrders()", "  invoice.ts", "  formula.ts", "  settings.ts", "test/", "  orders.test.ts"];
    const fl = files.map((f) => { const e = mk("div", null, null, tree, "white-space:pre; color:var(--mute)"); e.textContent = f; return e; });
    tl.set("#s8bee", { opacity: 0 }, 0);
    tl.set("#s8bee", { opacity: 1, x: 640, y: 380 }, V(8, 8.6));
    [2, 1, 7].forEach((k, i) => {
      tl.to("#s8bee", { x: 520, y: 442 + k * 41, duration: 0.6, ease: "power2.inOut" }, V(8, 9.0 + i * 0.9));
      tl.to(fl[k], { color: "#fff4e0", duration: 0.2 }, V(8, 9.5 + i * 0.9));
    });
    tl.to("#s8bee", { x: 840, y: 360, duration: 0.6, ease: "power2.inOut" }, V(8, 11.8));
    tl.to("#s8bee", { opacity: 0, duration: 0.2 }, V(8, 12.4));
    const bl = $("#s8bl");
    [["Where the change belongs", "findOrders() builds the SQL query"], ["What calls it", "every caller, from Hive's code graph"], ["What to mirror", "how the rest of the file does it"]].forEach(([k, v], i) => {
      const e = mk("div", null, `<div class="mono honey" style="font-size:20px">${k}</div><div style="font-size:30px; margin-top:4px">${v}</div>`, bl, "margin-top:22px");
      show(V(8, [12.2, 14.2, 15.4][i]), e, 0.4, { x: -16 });
    });
    tl.set("#s8brief", { opacity: 0 }, 0);
    show(V(8, 11.4), "#s8brief", 0.4, { y: 20 });
  }

  // =====================================================================
  // 9. Any agent, any model
  // =====================================================================
  {
    const lines = $("#s9lines");
    const L = [
      [termLine(lines, "# Claude Code, Codex, or any agent that speaks MCP", "out"), 1.0, 0.6],
      [termLine(lines, "$ claude mcp add --transport http hive https://hivegit.dev/mcp"), 1.7, 1.4],
      [termLine(lines, "# or the command line, declaring exactly what the diff changes", "out"), 5.0, 0.6],
      [termLine(lines, "$ hive claim <goal> && hive intent --from-diff"), 5.5, 1.0],
      [termLine(lines, "$ git clone <trunk> shop && git log -1 | grep Hive-", ""), 6.8, 1.2],
      [termLine(lines, "  Hive-Change-Id: c-5bf36b6a91", "out"), 8.1, 0.4],
    ];
    L.forEach(([e, w, d]) => typeLine(V(9, w), e, d));
    const m = $("#s9models");
    const g1 = mk("div", null, `<div class="kicker">Workers AI · no setup</div><div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:16px">${["Kimi K2.7 Code", "GLM 5.3", "DeepSeek V4 Pro", "gpt-oss 120B", "Qwen 3.8 27B", "qwen3-coder-30b"].map((x) => `<span class="chip cf">${x}</span>`).join("")}</div>`, m);
    const g2 = mk("div", null, `<div class="kicker">Bring your own · OpenAI-compatible</div><div style="margin-top:16px"><span class="chip">byo/&lt;your-model&gt;</span></div>`, m, "margin-top:40px");
    show(V(9, 8.8), g1, 0.45, { x: 30 });
    show(V(9, 10.8), g2, 0.45, { x: 30 });
    const c = $("#s9cost");
    c.innerHTML = `<div class="kicker">Every call priced · demo-shop</div>
      <div style="display:grid; grid-template-columns:1fr auto; gap:8px 30px; margin-top:16px; font-size:25px">
        <span>Buy-two-get-one-free promotion (race, 3 models)</span><span class="mono honey">$1.53</span>
        <span>Accept euro-style decimals in parsePrice</span><span class="mono honey">$0.10</span>
        <span>Cart quantities</span><span class="mono honey">$0.09</span>
      </div>
      <div style="margin-top:20px; display:flex; align-items:center; gap:18px"><span class="mono steel" style="font-size:20px">budget</span><div style="flex:1; height:14px; border-radius:7px; background:#1b1b20"><div id="s9bud" style="height:100%; width:0; border-radius:7px; background:var(--honey)"></div></div><span class="mono" style="font-size:20px">spending stops at the cap</span></div>`;
    tl.set(c, { opacity: 0 }, 0);
    show(V(9, 12.3), c, 0.45, { y: 24 });
    tl.to("#s9bud", { width: "40%", duration: 1.2, ease: "power2.out" }, V(9, 13.7));
  }

  // =====================================================================
  // 10. Two thousand agents
  // =====================================================================
  {
    const t0 = T(10, -0.7);
    const draw = swarm($("#swarm2"), { seed: 21, N: 20, size: 11, cx: 960, cy: 540, first: t0 + 0.4, fill: V(10, 4.0), pow: 0.6, nRed: 13, redAt: V(10, 3.6) });
    runCanvas(draw, t0, V(10, 5.2));
    tl.set("#s10screen", { opacity: 0 }, 0);
    camSet(0, "#s10shot", 960, 250, 2.05);
    tl.to("#s10screen", { opacity: 1, duration: 0.6 }, V(10, 4.3));
    tl.to("#swarm2", { opacity: 0, duration: 0.5 }, V(10, 4.5));
    cam(V(10, 4.4), "#s10shot", 1.6, 960, 420, 1.0);
    tl.set("#s10dim", { opacity: 0 }, 0);
    tl.to("#s10dim", { opacity: 0.88, duration: 0.5 }, V(10, 5.6));
    const st = $("#s10stats");
    st.setAttribute("style", st.getAttribute("style") + "; display:grid; grid-template-columns:repeat(4, 1fr); gap:22px");
    const tiles = [
      ["changes landed", 1987, (v) => v.toLocaleString("en-US"), 4.3, "honey", "from 2,000 agents, one repository"],
      ["minutes, end to end", 17, (v) => "~" + v, 6.4, "honey", "nobody touched anything"],
      ["landings a minute", 125, (v) => String(v), 7.4, "honey", "sustained · p50 submit → trunk 2.4 min"],
      ["sent to a person", 13, (v) => String(v), 9.4, "alarm", "exactly the 13 broken on purpose"],
    ];
    tiles.forEach(([k, v, fmt, w, color, sub]) => {
      const tile = mk("div", null, `<div class="h1 ${color}" style="font-size:110px">0</div><div class="h3" style="font-size:30px; margin-top:6px">${k}</div><div class="body" style="font-size:21px; margin-top:8px">${sub}</div>`, st, "padding:26px 28px; border-radius:16px; background:rgba(20,20,24,.9); border:1px solid var(--line)");
      show(V(10, w), tile, 0.45, { y: 30 });
      counter(V(10, w), tile.firstChild, v, 0.9, fmt);
    });
    const note = mk("div", "body", "Simulated agents. <span class='honey'>Real</span> forks, queue, merges and tests.", st, "grid-column:1 / span 4; margin-top:10px; font-size:30px; color:var(--wax)");
    show(V(10, 13.6), note, 0.4, { y: 14 });
    const lines = $("#s10lines");
    const L = [
      [termLine(lines, "$ git clone <scale2k trunk> && git log --oneline | wc -l"), 15.0, 1.1],
      [termLine(lines, "    1988", "out"), 16.3, 0.2],
      [termLine(lines, "$ npm test   # pass: every module, no broken code on trunk", "out"), 16.9, 1.0],
    ];
    tl.set("#s10term", { opacity: 0 }, 0);
    show(V(10, 14.8), "#s10term", 0.35, { y: 20 });
    L.forEach(([e, w, d]) => typeLine(V(10, w), e, d));
    const dep = $("#s10dep");
    dep.innerHTML = `<div class="kicker">Across hivegit.dev so far</div><div style="display:flex; gap:40px; margin-top:12px"><div><div class="h1 honey" style="font-size:72px" id="s10n1">0</div><div class="body" style="font-size:22px">changes landed</div></div><div><div class="h1 honey" style="font-size:72px" id="s10n2">0</div><div class="body" style="font-size:22px">repositories</div></div></div>`;
    tl.set(dep, { opacity: 0 }, 0);
    show(V(10, 19.0), dep, 0.45, { y: 20 });
    counter(V(10, 20.9), $("#s10n1"), 6140, 1.2, (v) => v.toLocaleString("en-US"));
    counter(V(10, 24.1), $("#s10n2"), 15, 0.5, String);
  }

  // =====================================================================
  // 11. The record, and close
  // =====================================================================
  {
    const log = $("#s11logl");
    const commits = [
      ["dc9381e", "Add buy-two-get-one-free promotion to checkout"],
      ["cd4e48d", "Add optional quantity to Cart.add and Cart.setQuantity"],
      ["e2317e2", "Format prices with thousands separators in formatPrice"],
      ["ae0a734", "Accept euro-style decimals in parsePrice"],
      ["34df587", "Apply free shipping when the discounted subtotal …"],
    ];
    mk("div", "honey", "$ git log --oneline", log);
    commits.forEach(([h, s]) => mk("div", null, `<span class="flare">${h}</span> ${s}`, log, "white-space:nowrap"));
    mk("div", "steel", "    Hive-Change-Id: c-843ac660db", log, "margin-top:10px");
    mk("div", "steel", "    Hive-Model: GLM 5.3", log);
    const led = $("#s11ledl");
    [["$ git clone <ledger> && tree shop.hive", "honey"], ["shop.hive/", ""], ["├── agents.json        # every agent, model, trust", ""], ["├── goals/g-….json      # goal, status", ""], ["├── changes/c-….json    # intent, evidence,", ""], ["│                       # decisions + probabilities", "steel"], ["└── transcripts/a-….json # the agent's full", ""], ["                        # conversation", "steel"]].forEach(([s, c]) => {
      const e = mk("div", c, null, led, "white-space:pre"); e.textContent = s;
    });
    tl.set(["#s11log", "#s11led", "#s11k1", "#s11k2", "#s11pr"], { opacity: 0 }, 0);
    show(T(11, 0), ["#s11log", "#s11k1"], 0.5, { y: 24 });
    show(V(11, 2.2), ["#s11led", "#s11k2"], 0.5, { y: 24 });
    show(V(11, 5.9), "#s11pr", 0.45, { y: 20 });
    const cf = $("#s11cf");
    [["Workers", 9.0], ["Durable Objects", 9.6], ["Workflows", 10.9], ["Containers", 11.5], ["Artifacts", 12.2], ["Workers AI", 13.1]].forEach(([p, w]) => {
      const c = mk("span", "chip cf", p, cf, "font-size:24px; padding:10px 18px");
      show(V(11, w), c, 0.3, { y: 12 });
    });
    tl.set("#s11end", { opacity: 0 }, 0);
    tl.to("#s11end", { opacity: 1, duration: 0.6 }, V(11, 14.0));
    tl.set(["#s11a", "#s11b", "#s11c"], { opacity: 0 }, 0);
    show(V(11, 15.0), "#s11c", 0.5, { y: 14 });
    show(V(11, 17.6), "#s11a", 0.5, { x: -30 });
    show(V(11, 19.2), "#s11b", 0.5, { x: -30 });
    // one last bee docks into the logo
    tl.set(["#xbee"], { opacity: 1 }, V(11, 15.6));
    tl.fromTo("#xbee", { x: -80, y: 700, rotation: 10 }, { x: 148, y: 298, rotation: 0, duration: 1.3, ease: "power3.out" }, V(11, 15.6));
    tl.to("#xbee", { opacity: 0, scale: 0.4, duration: 0.25 }, V(11, 16.9));
    tl.fromTo("#s11logo", { scale: 1 }, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, V(11, 16.9));
  }

  window.__timelines["main"] = tl;
})();
