/* Market regimes — charts drawn from a precomputed JSON.
 * No price prediction anywhere: the panels show volatility, drawdown and the
 * regime that was in force, plus what followed historically. */
(() => {
  const $ = (s) => document.querySelector(s);
  let DATA = null, cur = 0, H = 5;

  const REGIME_COLOR = (r, a = 0.16) => ({
    stressed: `rgba(168,69,63,${a})`,
    elevated: `rgba(162,128,58,${a})`,
    'calm-up': `rgba(74,122,92,${a})`,
    'calm-down': `rgba(90,110,140,${a})`,
  }[r] || 'transparent');

  const parse = (d) => new Date(d + 'T00:00:00Z').getTime();
  const fmtPct = (v, d = 1) => (v == null ? '—' : v.toFixed(d) + '%');

  /* ---------- theme ---------- */
  const savedTheme = localStorage.getItem('mr.theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#theme').onclick = () => {
    const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = n;
    localStorage.setItem('mr.theme', n);
    drawAll();
  };
  const bar = $('#progress');
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = Math.min(100, (scrollY / Math.max(1, h)) * 100) + '%';
  }, { passive: true });

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function prep(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 1200;
    // remember the intended logical height: reading getAttribute('height') after
    // the first scale returns the buffer size, so each redraw doubled it
    const h = +(canvas.dataset.h || canvas.getAttribute('height'));
    canvas.dataset.h = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // keep charts readable: bucket to ~500 columns
  function sample(A, target = 500) {
    const n = A.dates.length;
    const step = Math.max(1, Math.ceil(n / target));
    const idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    return idx;
  }

  function axisY(ctx, w, h, min, max, pad, labels) {
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = css('--muted');
    ctx.strokeStyle = css('--line');
    ctx.lineWidth = 1;
    for (let i = 0; i <= labels; i++) {
      const v = min + ((max - min) * i) / labels;
      const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 6, y); ctx.stroke();
      ctx.fillText(v.toFixed(0), 2, y + 3);
    }
  }

  function axisX(ctx, w, h, dates, idx, pad) {
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = css('--muted');
    const years = new Set();
    idx.forEach((i) => {
      const y = dates[i].slice(0, 4);
      if (!years.has(y)) { years.add(y); }
    });
    let lastX = -99;
    [...years].forEach((y) => {
      const i = dates.findIndex((d) => d.startsWith(y));
      if (i < 0) return;
      const x = pad + (i / (dates.length - 1)) * (w - pad - 6);
      if (x - lastX < 46) return;          // don't let year labels collide
      ctx.fillText(y, x, h - 2);
      lastX = x;
    });
  }

  /* ---------- price + regime ---------- */
  function drawPrice() {
    const a = DATA.assets[cur];
    const { ctx, w, h } = prep($('#priceChart'));
    const pad = 26, idx = sample(a), n = a.dates.length;
    const vals = idx.map((i) => a.close[i]);
    const min = Math.min(...vals) * 0.97, max = Math.max(...vals) * 1.03;
    const x = (i) => pad + (i / (n - 1)) * (w - pad - 6);
    const y = (v) => h - pad + 6 - ((v - min) / (max - min)) * (h - pad * 1.6);

    // Regime as a merged strip beneath the line. Filling the whole plot made
    // every regime flip a 1px stripe and turned the chart into noise.
    const stripY = h - pad - 2, stripH = 7;
    let runStart = 0;
    const regimeAt = idx.map((i) => a.regime[i]);
    for (let k = 1; k <= regimeAt.length; k++) {
      if (k === regimeAt.length || regimeAt[k] !== regimeAt[runStart]) {
        const r0 = regimeAt[runStart], x0 = x(idx[runStart]), x1 = x(idx[Math.min(k, idx.length - 1)]);
        if (r0 !== 'unknown') {
          ctx.fillStyle = REGIME_COLOR(r0, 0.95);
          ctx.fillRect(x0, stripY, Math.max(1, x1 - x0), stripH);
        }
        runStart = k;
      }
    }
    axisY(ctx, w, h, min, max, pad, 4);

    // price line
    ctx.beginPath();
    idx.forEach((i, k) => (k ? ctx.lineTo(x(i), y(a.close[i])) : ctx.moveTo(x(i), y(a.close[i]))));
    ctx.strokeStyle = css('--' + a.id.toLowerCase() === '--gold' ? '--gold' : a.id === 'GOLD' ? '--gold' : a.id === 'NIFTY' ? '--nifty' : '--spx');
    ctx.lineWidth = 1.6;
    ctx.stroke();

    axisX(ctx, w, h, a.dates, idx, pad);

    // last point
    const li = n - 1;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(x(li), y(a.close[li]), 3, 0, 6.283); ctx.fill();
  }

  /* ---------- volatility ---------- */
  function drawVol() {
    const a = DATA.assets[cur];
    const { ctx, w, h } = prep($('#volChart'));
    const pad = 26, idx = sample(a), n = a.dates.length;
    const series = idx.map((i) => a.rv[i]).filter((v) => v != null);
    const max = Math.max(...series) * 1.05, min = 0;
    const x = (i) => pad + (i / (n - 1)) * (w - pad - 6);
    const y = (v) => h - pad + 4 - (v / max) * (h - pad * 1.5);

    // last-year 20–80 percentile band
    const yr = a.rv.slice(-252).filter((v) => v != null).sort((p, q) => p - q);
    if (yr.length > 30) {
      const lo = yr[Math.floor(yr.length * 0.2)], hi = yr[Math.floor(yr.length * 0.8)];
      ctx.fillStyle = 'rgba(226,177,96,.10)';
      ctx.fillRect(pad, y(hi), w - pad - 6, y(lo) - y(hi));
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = css('--muted');
      ctx.fillText('20–80th pct, last year', pad + 6, y(hi) - 4);
    }

    axisY(ctx, w, h, min, max, pad, 4);

    ctx.beginPath();
    idx.forEach((i, k) => {
      const v = a.rv[i];
      if (v == null) return;
      k ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v));
    });
    ctx.strokeStyle = css('--nifty');
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // EWMA forecast on top, thinner and dashed
    ctx.beginPath();
    idx.forEach((i, k) => (k ? ctx.lineTo(x(i), y(a.vol[i])) : ctx.moveTo(x(i), y(a.vol[i]))));
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = css('--gold');
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);

    axisX(ctx, w, h, a.dates, idx, pad);
  }

  /* ---------- drawdown ---------- */
  function drawDD() {
    const a = DATA.assets[cur];
    const { ctx, w, h } = prep($('#ddChart'));
    const pad = 26, idx = sample(a), n = a.dates.length;
    const min = Math.min(...idx.map((i) => a.dd[i])) * 1.05;
    const x = (i) => pad + (i / (n - 1)) * (w - pad - 6);
    const y = (v) => 8 + (v / min) * (h - pad - 10);

    axisY(ctx, w, h, min, 0, pad, 3);

    ctx.beginPath();
    ctx.moveTo(x(idx[0]), y(0));
    idx.forEach((i) => ctx.lineTo(x(i), y(a.dd[i])));
    ctx.lineTo(x(idx[idx.length - 1]), y(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(168,69,63,.16)';
    ctx.fill();

    ctx.beginPath();
    idx.forEach((i, k) => (k ? ctx.lineTo(x(i), y(a.dd[i])) : ctx.moveTo(x(i), y(a.dd[i]))));
    ctx.strokeStyle = css('--stressed') || '#a8453f';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    axisX(ctx, w, h, a.dates, idx, pad);
  }

  function drawAll() { drawPrice(); drawVol(); drawDD(); }

  /* ---------- state cards ---------- */
  function drawStates() {
    $('#states').innerHTML = DATA.assets.map((a, i) => {
      const r = a.regime[a.regime.length - 1];
      const v = a.rv[a.rv.length - 1];
      const pct = a.volpct[a.volpct.length - 1];
      const col = r === 'stressed' ? 'var(--stressed)' : r === 'elevated' ? 'var(--elevated)' : 'var(--calm)';
      return `<button class="state" data-i="${i}" style="text-align:left;cursor:pointer;${i === cur ? 'border-color:var(--gold)' : ''}">
        <span class="nm">${a.name}</span>
        <div class="v" style="color:${col}">${r.replace('-', ' ')}</div>
        <div class="r">vol ${fmtPct(v)} · ${pct != null ? Math.round(pct * 100) + 'th pct' : '—'} · dd ${fmtPct(a.dd[a.dd.length - 1])}</div>
        <div class="bar"><i style="width:${Math.round((pct || 0) * 100)}%;background:${col}"></i></div>
      </button>`;
    }).join('');
    $('#states').querySelectorAll('.state').forEach((b) => b.onclick = () => {
      cur = +b.dataset.i; drawStates(); drawAll(); drawTabs();
    });
  }

  function drawTabs() {
    $('#assetTabs').innerHTML = DATA.assets.map((a, i) =>
      `<button class="tab ${i === cur ? 'on' : ''}" data-i="${i}">${a.id}</button>`).join('');
    $('#assetTabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => {
      cur = +b.dataset.i; drawTabs(); drawStates(); drawAll();
    });
    const a = DATA.assets[cur];
    $('#priceLegend').innerHTML = `
      <span><i style="background:${a.id === 'GOLD' ? css('--gold') : a.id === 'NIFTY' ? css('--nifty') : css('--spx')}"></i>${a.name} close</span>
      <span><i style="background:${REGIME_COLOR('calm-up', 0.7)}"></i>calm &amp; trending up</span>
      <span><i style="background:${REGIME_COLOR('calm-down', 0.7)}"></i>calm &amp; down</span>
      <span><i style="background:${REGIME_COLOR('elevated', 0.7)}"></i>elevated vol</span>
      <span><i style="background:${REGIME_COLOR('stressed', 0.7)}"></i>stressed</span>`;
  }

  /* ---------- forward returns ---------- */
  function drawForward() {
    const a = DATA.assets[cur];
    const rows = [];
    ['calm-up', 'calm-down', 'elevated', 'stressed'].forEach((r) => {
      const cells = [5, 20, 60].map((h) => a.fwd[h] && a.fwd[h][r]);
      if (!cells.some(Boolean)) return;
      rows.push(`<tr><td>${r.replace('-', ' ')}</td>${cells.map((c) => c
        ? `<td class="num ${c.median >= 0 ? 'pos' : 'neg'}">${c.median > 0 ? '+' : ''}${c.median}%</td>
           <td class="num" style="color:var(--muted)">${c.p25}…${c.p75}</td>
           <td class="num" style="color:var(--muted)">${c.positive}%</td>
           <td class="num" style="color:var(--muted)">${c.n}</td>`
        : '<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>').join('')}</tr>`);
    });
    $('#fwdTable').innerHTML = `<table>
      <thead><tr><th>regime</th>
        <th>5d median</th><th>5d p25–75</th><th>5d % up</th><th>n</th>
        <th>20d median</th><th>20d p25–75</th><th>20d % up</th><th>n</th>
        <th>60d median</th><th>60d p25–75</th><th>60d % up</th><th>n</th>
      </tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  /* ---------- boot ---------- */
  fetch('assets/data.json?v=' + Date.now())
    .then((r) => r.json())
    .then((d) => {
      DATA = d;
      if (!DATA.assets || !DATA.assets.length) throw new Error('no assets');
      $('#genAt').textContent = 'data ' + (d.generated || '').slice(0, 10);
      drawStates(); drawTabs(); drawAll(); drawForward();
      addEventListener('resize', drawAll);
    })
    .catch((e) => {
      $('#states').innerHTML = `<div class="state"><span class="nm">data missing</span><div class="r">${e.message} — run tools/build_data.py</div></div>`;
    });

  document.documentElement.dataset.ready = '1';
})();
