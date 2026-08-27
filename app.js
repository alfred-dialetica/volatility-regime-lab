(function () {
  "use strict";

  const payload = window.VOL_DATA;
  if (!payload || !payload.series || !payload.series.length) {
    document.body.innerHTML = '<main style="padding:40px;font:16px system-ui">Market data could not be loaded.</main>';
    return;
  }

  const rows = payload.series;
  const tooltip = document.getElementById("tooltip");
  const allowedViews = new Set(["regime", "curve", "diagnostics", "dispersion", "methodology"]);
  const requestedView = window.location.hash.slice(1);
  const state = { idx: rows.length - 1, range: 252, view: allowedViews.has(requestedView) ? requestedView : "regime" };
  const colors = { blue: "#0C4185", green: "#377E47", red: "#BF4242", amber: "#B7791F", muted: "#909BA6", grid: "#E1E6EA" };

  const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d);
  const signed = (v, d = 1) => v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`;
  const dateFmt = (iso, short = false) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-US", short ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" }).format(d);
  };
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function selectedWindow(maxLen) {
    const n = state.range === "max" ? state.idx + 1 : Number(state.range);
    const effective = maxLen ? Math.min(n, maxLen) : n;
    return rows.slice(Math.max(0, state.idx - effective + 1), state.idx + 1);
  }

  function historicalValues(key, lookback = 756) {
    return rows.slice(Math.max(0, state.idx - lookback + 1), state.idx + 1).map(r => r[key]).filter(v => v != null);
  }

  function percentile(key, invert = false) {
    const current = rows[state.idx][key];
    if (current == null) return null;
    const values = historicalValues(key).map(v => invert ? -v : v);
    const target = invert ? -current : current;
    return values.length ? values.filter(v => v <= target).length / values.length * 100 : null;
  }

  function metrics() {
    const r = rows[state.idx];
    const vixP = percentile("vix") || 0;
    const vvixP = percentile("vvix") || 0;
    const skewP = percentile("skew") || 0;
    const rvP = percentile("rv21") || 0;
    const inversionP = percentile("curve3m", true) || 0;
    const stress = clamp(Math.round(vixP * .35 + vvixP * .25 + skewP * .15 + rvP * .15 + inversionP * .10), 0, 100);
    let name = "Normal carry";
    let copy = "Implied volatility sits near its historical middle while the medium-horizon curve remains upward sloping.";
    let tone = "green";
    if (r.vix >= 30 || (vixP >= 90 && r.curve3m < 0)) {
      name = "Acute stress"; tone = "red";
      copy = "Near-term implied volatility is repricing sharply and the curve is inverted or close to inversion.";
    } else if (vixP >= 75 || vvixP >= 85) {
      name = "Elevated uncertainty"; tone = "amber";
      copy = "Volatility or vol-of-vol is elevated, but the curve still separates immediate stress from medium-horizon expectations.";
    } else if (vixP <= 25 && r.curve3m >= 2.5) {
      name = "Compressed carry"; tone = "blue";
      copy = "Front-end implied volatility is compressed relative to history while the curve pays a visible medium-horizon premium.";
    } else if (r.curve3m < 0) {
      name = "Event inversion"; tone = "red";
      copy = "The front of the curve trades above three-month volatility, signalling concentrated near-term event risk.";
    }
    return { r, vixP, vvixP, skewP, rvP, inversionP, stress, name, copy, tone };
  }

  function renderKpis() {
    const m = metrics();
    const r = m.r;
    const items = [
      { label: "VIX · 30D", value: fmt(r.vix, 2), foot: `${signed(r.vixChg, 2)} 1D · ${Math.round(m.vixP)}th pct`, tone: m.vixP > 80 ? "red" : "blue" },
      { label: "Realized · 21D", value: fmt(r.rv21, 2), foot: `${Math.round(m.rvP)}th pct · annualized`, tone: "green" },
      { label: "IV − RV21", value: signed(r.vrpVol, 2), foot: `${signed(r.vrpVar, 0)} variance pts`, tone: r.vrpVol >= 0 ? "green" : "red" },
      { label: "VVIX", value: fmt(r.vvix, 2), foot: `${Math.round(m.vvixP)}th pct · vol-of-vol`, tone: m.vvixP > 80 ? "red" : "blue" },
      { label: "SKEW", value: fmt(r.skew, 2), foot: `${Math.round(m.skewP)}th pct · tail repricing`, tone: m.skewP > 85 ? "amber" : "blue" },
      { label: "3M − 1M", value: signed(r.curve3m, 2), foot: r.curve3m >= 0 ? "Upward sloping" : "Inverted", tone: r.curve3m >= 0 ? "green" : "red" },
    ];
    document.getElementById("kpi-grid").innerHTML = items.map(i => `
      <article class="kpi">
        <div class="kpi__label"><span>${i.label}</span><i class="kpi__dot ${i.tone}"></i></div>
        <div class="kpi__value">${i.value}</div>
        <div class="kpi__foot">${i.foot}</div>
      </article>`).join("");
  }

  function renderRegime() {
    const m = metrics();
    const el = document.getElementById("regime-callout");
    el.style.borderLeftColor = colors[m.tone] || colors.green;
    document.getElementById("regime-name").textContent = m.name;
    document.getElementById("regime-copy").textContent = m.copy;
    document.getElementById("stress-score").textContent = `${m.stress}/100`;
  }

  function dispersionMetrics() {
    const r = rows[state.idx];
    const dspxP = percentile("dspx") || 0;
    const spreadP = percentile("constituentSpread") || 0;
    const corP = percentile("cor3m") || 0;
    const curveP = percentile("correlationSlope") || 0;
    let name = "Balanced relative vol";
    let copy = "The constituent-index variance gap and implied correlation are both near their rolling historical middle.";
    let hurdle = "MID";
    let tone = "blue";
    if (r.cor1m != null && r.cor1y != null && r.cor1m - r.cor1y > 4) {
      name = "Near-term correlation shock";
      copy = "Front-end implied correlation sits above the long end. The market is pricing a concentrated window of common-factor risk.";
      hurdle = "EVENT";
      tone = "red";
    } else if (dspxP >= 75 || corP <= 25) {
      name = "Single names priced rich";
      copy = "Options price a wide constituent-index variance gap and low average correlation. A long-dispersion book starts with a demanding embedded hurdle.";
      hurdle = "HIGH";
      tone = "red";
    } else if (dspxP <= 25 || corP >= 75) {
      name = "Index correlation priced rich";
      copy = "Expected co-movement is high relative to history and implied dispersion is compressed. Long dispersion starts cheaper, but correlation-gap risk is material.";
      hurdle = "LOW";
      tone = "green";
    }
    return { r, dspxP, spreadP, corP, curveP, name, copy, hurdle, tone };
  }

  function renderDispersionKpis() {
    const m = dispersionMetrics();
    const r = m.r;
    const items = [
      { label: "DSPX · 30D", value: fmt(r.dspx, 2), foot: `${Math.round(m.dspxP)}th pct · implied dispersion`, tone: m.dspxP > 75 ? "red" : "green" },
      { label: "VIXEQ", value: fmt(r.vixeq, 2), foot: "Constituent RMS implied vol", tone: "green" },
      { label: "VIX", value: fmt(r.vix, 2), foot: "SPX implied vol", tone: "blue" },
      { label: "VIXEQ − VIX", value: signed(r.constituentSpread, 2), foot: `${Math.round(m.spreadP)}th pct · vol points`, tone: m.spreadP > 75 ? "red" : "green" },
      { label: "COR3M", value: `${fmt(r.cor3m, 2)}%`, foot: `${Math.round(m.corP)}th pct · top 50 names`, tone: m.corP > 75 ? "red" : "blue" },
      { label: "COR 1Y − 1M", value: signed(r.correlationSlope, 2), foot: r.correlationSlope >= 0 ? "Upward sloping" : "Front-end premium", tone: r.correlationSlope >= 0 ? "green" : "red" },
    ];
    document.getElementById("dispersion-kpis").innerHTML = items.map(i => `
      <article class="kpi">
        <div class="kpi__label"><span>${i.label}</span><i class="kpi__dot ${i.tone}"></i></div>
        <div class="kpi__value">${i.value}</div>
        <div class="kpi__foot">${i.foot}</div>
      </article>`).join("");
  }

  function renderDispersionCallout() {
    const m = dispersionMetrics();
    const el = document.getElementById("dispersion-callout");
    el.style.borderLeftColor = colors[m.tone] || colors.blue;
    document.getElementById("dispersion-name").textContent = m.name;
    document.getElementById("dispersion-copy").textContent = m.copy;
    document.getElementById("dispersion-hurdle").textContent = m.hurdle;
  }

  function renderDispersionBridge() {
    const r = rows[state.idx];
    const constituentVar = r.vixeq == null ? null : r.vixeq * r.vixeq;
    const indexVar = r.vix == null ? null : r.vix * r.vix;
    const gapVar = constituentVar == null || indexVar == null ? null : Math.max(0, constituentVar - indexVar);
    const publishedVar = r.dspx == null ? null : r.dspx * r.dspx;
    const residual = gapVar == null || publishedVar == null ? null : gapVar - publishedVar;
    document.getElementById("dispersion-bridge").innerHTML = `
      <span class="dispersion-bridge__eyebrow">Variance decomposition</span>
      <h3>The 30-day bridge</h3>
      <div class="bridge-equation">
        <div><span>VIXEQ²</span><strong>${fmt(constituentVar, 0)}</strong><small>constituent variance</small></div>
        <i>−</i>
        <div><span>VIX²</span><strong>${fmt(indexVar, 0)}</strong><small>index variance</small></div>
        <i>≈</i>
        <div><span>DSPX²</span><strong>${fmt(publishedVar, 0)}</strong><small>dispersion variance</small></div>
      </div>
      <div class="bridge-residual"><span>Naive bridge residual</span><strong>${signed(residual, 1)} var pts</strong></div>
      <p>DSPX is built from selected constituent expected variance less VIX². Basket rules, index methodology and published precision make a simple VIXEQ reconstruction approximate.</p>`;
  }

  function svgLineChart(id, series, data, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const W = 820, H = opts.height || 310, L = 54, R = 20, T = 22, B = 36;
    const values = [];
    series.forEach(s => data.forEach(r => { if (r[s.key] != null) values.push(r[s.key]); }));
    if (!values.length) { el.innerHTML = '<div style="padding:32px;color:#6B7681">No observations in this window.</div>'; return; }
    let ymin = Math.min(...values), ymax = Math.max(...values);
    const pad = (ymax - ymin || 1) * .12; ymin -= pad; ymax += pad;
    const x = i => L + i / Math.max(1, data.length - 1) * (W - L - R);
    const y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B);
    const grid = Array.from({length:5}, (_,i) => {
      const val = ymax - i / 4 * (ymax - ymin), yy = y(val);
      return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-9}" y="${yy+3}" text-anchor="end">${fmt(val,1)}</text>`;
    }).join("");
    const paths = series.map(s => {
      let d = "", active = false;
      data.forEach((r,i) => {
        const v = r[s.key];
        if (v == null) { active = false; return; }
        d += `${active ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `; active = true;
      });
      return `<path class="line line--${s.tone}" d="${d}"/>`;
    }).join("");
    const labels = [0,.33,.66,1].map(q => {
      const i = Math.min(data.length-1, Math.round(q * (data.length-1)));
      return `<text x="${x(i)}" y="${H-12}" text-anchor="middle">${dateFmt(data[i].d,true)}</text>`;
    }).join("");
    const crossId = `${id}-cross`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g>${grid}${paths}${labels}</g><line id="${crossId}" class="crosshair" x1="0" x2="0" y1="${T}" y2="${H-B}" visibility="hidden"/><rect class="hit-area" x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}" tabindex="0"/></svg>`;
    const hit = el.querySelector(".hit-area"), cross = document.getElementById(crossId);
    const show = (clientX, clientY) => {
      const rect = hit.getBoundingClientRect();
      const q = clamp((clientX - rect.left) / rect.width, 0, 1);
      const i = Math.round(q * (data.length - 1)), row = data[i];
      const xx = x(i); cross.setAttribute("x1",xx); cross.setAttribute("x2",xx); cross.setAttribute("visibility","visible");
      tooltip.innerHTML = `<strong>${dateFmt(row.d)}</strong>${series.map(s => `<span>${s.label}: ${fmt(row[s.key],2)}</span>`).join("")}`;
      tooltip.style.left = `${Math.min(window.innerWidth-185,clientX)}px`; tooltip.style.top = `${clamp(clientY,70,window.innerHeight-70)}px`; tooltip.classList.add("is-visible");
    };
    hit.addEventListener("pointermove", e => show(e.clientX,e.clientY));
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility","hidden"); tooltip.classList.remove("is-visible"); });
    hit.addEventListener("focus", () => { const r = hit.getBoundingClientRect(); show(r.left+r.width*.8,r.top+r.height*.5); });
    hit.addEventListener("blur", () => { cross.setAttribute("visibility","hidden"); tooltip.classList.remove("is-visible"); });
  }

  function renderCurve(id, large = false) {
    const el = document.getElementById(id); if (!el) return;
    const cur = rows[state.idx], prev = rows[Math.max(0,state.idx-21)];
    const mats = [
      ["1D","vix1d"],["9D","vix9d"],["30D","vix"],["3M","vix3m"],["6M","vix6m"],["1Y","vix1y"]
    ];
    const W = 700, H = large ? 500 : 310, L=48,R=24,T=30,B=44;
    const vals = mats.flatMap(([,k]) => [cur[k],prev[k]]).filter(v => v != null);
    let lo=Math.min(...vals)-1, hi=Math.max(...vals)+1;
    const x=i=>L+i/(mats.length-1)*(W-L-R), y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
    const grid=Array.from({length:5},(_,i)=>{const v=hi-i/4*(hi-lo),yy=y(v);return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-8}" y="${yy+3}" text-anchor="end">${fmt(v,1)}</text>`}).join("");
    const pathFor=row=>mats.map(([,k],i)=>row[k]==null?null:[x(i),y(row[k])]).filter(Boolean).map((p,i)=>`${i?"L":"M"}${p[0]},${p[1]}`).join(" ");
    const points=mats.map(([label,k],i)=>cur[k]==null?"":`<circle class="point" cx="${x(i)}" cy="${y(cur[k])}" r="4" fill="${colors.blue}" stroke="white" stroke-width="2"><title>${label}: ${fmt(cur[k],2)}</title></circle><text x="${x(i)}" y="${y(cur[k])-11}" text-anchor="middle" fill="#0C4185">${fmt(cur[k],1)}</text>`).join("");
    const xlabels=mats.map(([label],i)=>`<text x="${x(i)}" y="${H-14}" text-anchor="middle">${label}</text>`).join("");
    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img">${grid}<path class="line line--muted" d="${pathFor(prev)}"/><path class="line line--blue" d="${pathFor(cur)}"/>${points}${xlabels}</svg>`;
  }

  function renderCorrelationCurve() {
    const el = document.getElementById("correlation-curve");
    if (!el) return;
    const cur = rows[state.idx], prev = rows[Math.max(0, state.idx - 21)];
    const mats = [["1M", "cor1m"], ["3M", "cor3m"], ["6M", "cor6m"], ["1Y", "cor1y"]];
    const W = 700, H = 330, L = 48, R = 24, T = 30, B = 44;
    const vals = mats.flatMap(([, key]) => [cur[key], prev[key]]).filter(v => v != null);
    if (!vals.length) {
      el.innerHTML = '<div style="padding:32px;color:#6B7681">No implied-correlation observations for this date.</div>';
      return;
    }
    const span = Math.max(...vals) - Math.min(...vals);
    const lo = Math.max(-5, Math.min(...vals) - Math.max(2, span * .25));
    const hi = Math.min(100, Math.max(...vals) + Math.max(2, span * .25));
    const x = i => L + i / (mats.length - 1) * (W - L - R);
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const grid = Array.from({ length: 5 }, (_, i) => {
      const v = hi - i / 4 * (hi - lo), yy = y(v);
      return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-8}" y="${yy+3}" text-anchor="end">${fmt(v, 1)}%</text>`;
    }).join("");
    const pathFor = row => mats.map(([, key], i) => row[key] == null ? null : [x(i), y(row[key])]).filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
    const points = mats.map(([label, key], i) => cur[key] == null ? "" : `<circle class="point" cx="${x(i)}" cy="${y(cur[key])}" r="4" fill="${colors.red}" stroke="white" stroke-width="2"><title>${label}: ${fmt(cur[key], 2)}%</title></circle><text x="${x(i)}" y="${y(cur[key])-12}" text-anchor="middle" fill="#BF4242">${fmt(cur[key], 1)}%</text>`).join("");
    const labels = mats.map(([label], i) => `<text x="${x(i)}" y="${H-14}" text-anchor="middle">${label}</text>`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}<path class="line line--muted" d="${pathFor(prev)}"/><path class="line line--red" d="${pathFor(cur)}"/>${points}${labels}</svg>`;
  }

  function renderDiagnostics() {
    const m = metrics();
    const items = [
      ["VIX",m.vixP,false],["VVIX",m.vvixP,m.vvixP>80],["SKEW",m.skewP,m.skewP>85],["RV21",m.rvP,m.rvP>80],["Curve inversion",m.inversionP,m.inversionP>80]
    ];
    document.getElementById("diagnostic-bars").innerHTML=items.map(([label,val,hot])=>`<div class="diagnostic-row"><span class="diagnostic-row__label">${label}</span><div class="diagnostic-row__track"><div class="diagnostic-row__fill ${hot?"red":val<30?"green":""}" style="width:${clamp(val,0,100)}%"></div></div><span class="diagnostic-row__value">${Math.round(val)}%</span></div>`).join("");
  }

  function renderScatter() {
    const el=document.getElementById("scatter-chart"), data=selectedWindow(252).filter(r=>r.vix!=null&&r.vvix!=null);
    const W=680,H=270,L=48,R=20,T=20,B=36;
    const xs=data.map(r=>r.vix),ys=data.map(r=>r.vvix),xmin=Math.min(...xs)-1,xmax=Math.max(...xs)+1,ymin=Math.min(...ys)-3,ymax=Math.max(...ys)+3;
    const x=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R),y=v=>T+(ymax-v)/(ymax-ymin)*(H-T-B);
    const points=data.map((r,i)=>`<circle cx="${x(r.vix)}" cy="${y(r.vvix)}" r="${i===data.length-1?5:2.5}" fill="${r.curve3m<0?colors.red:colors.blue}" opacity="${i===data.length-1?1:.28}" ${i===data.length-1?'stroke="white" stroke-width="2"':''}><title>${r.d} · VIX ${fmt(r.vix,1)} · VVIX ${fmt(r.vvix,1)}</title></circle>`).join("");
    const grids=Array.from({length:4},(_,i)=>{const xx=L+i/3*(W-L-R),yy=T+i/3*(H-T-B);return `<line class="grid-line" x1="${xx}" x2="${xx}" y1="${T}" y2="${H-B}"/><line class="grid-line" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/>`}).join("");
    el.innerHTML=`<svg viewBox="0 0 ${W} ${H}">${grids}${points}<text x="${W-R}" y="${H-11}" text-anchor="end">VIX →</text><text x="${L}" y="12">VVIX ↑</text></svg>`;
  }

  function renderCurveReadout() {
    const r=rows[state.idx];
    const stateLabel=r.curve3m<0?"Near-term inversion":r.curve3m>3?"Steep contango":"Moderate contango";
    document.getElementById("curve-readout").innerHTML=`
      <span class="curve-readout__eyebrow">Curve interpretation</span><h3>${stateLabel}</h3>
      <div class="curve-readout__metric"><span>9D → 30D</span><strong>${signed(r.frontSlope,2)}</strong></div>
      <div class="curve-readout__metric"><span>30D → 3M</span><strong>${signed(r.curve3m,2)}</strong></div>
      <div class="curve-readout__metric"><span>3M → 6M</span><strong>${signed(r.vix6m-r.vix3m,2)}</strong></div>
      <div class="curve-readout__metric"><span>6M → 1Y</span><strong>${signed(r.vix1y-r.vix6m,2)}</strong></div>
      <p>${r.curve3m<0?"Immediate risk is priced above the three-month horizon. The shape is consistent with concentrated event stress rather than a uniform rise in uncertainty.":"The curve compensates longer horizons above spot VIX. Compare the front-end kink with VVIX before reading this as simple carry."}</p>`;
  }

  function renderHeatmap() {
    const months=new Map();
    rows.slice(0,state.idx+1).forEach(r=>{if(r.curve3m==null)return;const k=r.d.slice(0,7);if(!months.has(k))months.set(k,[]);months.get(k).push(r.curve3m)});
    const vals=[...months.entries()].slice(-24).map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length]);
    const mix=(a,b,t)=>{const ah=parseInt(a.slice(1),16),bh=parseInt(b.slice(1),16);const ar=ah>>16,ag=ah>>8&255,ab=ah&255,br=bh>>16,bg=bh>>8&255,bb=bh&255;return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`};
    document.getElementById("curve-heatmap").innerHTML=vals.map(([k,v])=>{const bg=v<0?mix("#ECEFF2",colors.red,clamp(-v/5,0,1)):mix("#ECEFF2",colors.green,clamp(v/7,0,1));const text=Math.abs(v)<1.2?"#38404A":"#FFFFFF";return `<div class="heat-cell" style="background:${bg};color:${text}" title="${k}: ${signed(v,2)}"><span>${dateFmt(k+"-01",true)}</span><strong>${signed(v,1)}</strong></div>`}).join("");
  }

  function renderEvents() {
    const data=selectedWindow().filter(r=>r.vixChg!=null).sort((a,b)=>Math.abs(b.vixChg)-Math.abs(a.vixChg)).slice(0,10);
    document.getElementById("event-table").innerHTML=data.map(r=>{const s=r.curve3m<0?["Inversion","stress"]:r.curve3m>3?["Carry","carry"]:["Balanced",""];return `<tr><td>${dateFmt(r.d)}</td><td class="${r.vixChg>=0?"num-neg":"num-pos"}">${signed(r.vixChg,2)}</td><td>${fmt(r.vix,2)}</td><td class="${r.spRet>=0?"num-pos":"num-neg"}">${signed(r.spRet,2)}%</td><td>${signed(r.curve3m,2)}</td><td><span class="state-pill ${s[1]}">${s[0]}</span></td></tr>`}).join("");
  }

  function renderDual(id,leftKey,leftLabel,rightKey,rightLabel,leftTone="blue",rightTone="red") {
    const data=selectedWindow();
    const indexed=data.map((r,i)=>{const baseLeft=data.find(x=>x[leftKey]!=null)?.[leftKey],baseRight=data.find(x=>x[rightKey]!=null)?.[rightKey];return {...r,_left:r[leftKey]!=null&&baseLeft?100*r[leftKey]/baseLeft:null,_right:r[rightKey]!=null&&baseRight?100*r[rightKey]/baseRight:null}});
    svgLineChart(id,[{key:"_left",label:`${leftLabel} index`,tone:leftTone},{key:"_right",label:`${rightLabel} index`,tone:rightTone}],indexed);
  }

  function renderMeta() {
    const r=rows[state.idx];
    document.getElementById("as-of").textContent=`As of ${dateFmt(r.d)}`;
    document.getElementById("date-output").textContent=dateFmt(r.d,true);
    document.getElementById("data-status").textContent=`Verified through ${r.d}`;
    document.getElementById("revision").textContent=`Revision ${payload.meta.revision}`;
    document.getElementById("date-slider").value=state.idx;
  }

  function renderAll() {
    renderMeta(); renderKpis(); renderRegime(); renderDiagnostics(); renderDispersionKpis(); renderDispersionCallout(); renderDispersionBridge();
    const data=selectedWindow();
    svgLineChart("vol-chart",[{key:"vix",label:"VIX",tone:"blue"},{key:"rv21",label:"RV21",tone:"green"}],data);
    svgLineChart("constituent-chart",[{key:"vixeq",label:"VIXEQ",tone:"green"},{key:"vix",label:"VIX",tone:"blue"}],data);
    renderDual("dispersion-chart","dspx","DSPX","cor3m","COR3M","green","red");
    renderCurve("curve-chart"); renderCurve("curve-chart-large",true); renderCorrelationCurve(); renderScatter(); renderCurveReadout(); renderHeatmap(); renderEvents();
    renderDual("vvix-chart","vix","VIX","vvix","VVIX");
    renderDual("skew-chart","vix","VIX","skew","SKEW");
  }

  function activateView(view, updateHash = true) {
    if (!allowedViews.has(view)) return;
    state.view = view;
    document.querySelectorAll(".nav__item").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.dataset.viewPanel === view));
    if (updateHash && window.location.hash !== `#${view}`) window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".nav__item").forEach(btn => btn.addEventListener("click", () => activateView(btn.dataset.view)));
  window.addEventListener("hashchange", () => {
    const view = window.location.hash.slice(1);
    if (allowedViews.has(view)) activateView(view, false);
  });
  document.querySelectorAll("[data-range]").forEach(btn=>btn.addEventListener("click",()=>{
    state.range=btn.dataset.range==="max"?"max":Number(btn.dataset.range);
    document.querySelectorAll("[data-range]").forEach(b=>b.classList.toggle("is-active",b===btn)); renderAll();
  }));
  const slider=document.getElementById("date-slider"); slider.min=0;slider.max=rows.length-1;slider.value=state.idx;
  slider.addEventListener("input",()=>{state.idx=Number(slider.value);renderAll();});
  document.getElementById("reset-date").addEventListener("click",()=>{state.idx=rows.length-1;renderAll();});
  window.addEventListener("resize",()=>{ if(window.innerWidth<500) tooltip.classList.remove("is-visible"); });

  activateView(state.view, false);
  renderAll();
})();
