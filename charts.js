/* PriceTrail charts.js — native SVG price-history chart, no libraries.
   Builds an SVG line chart from chronological price records, with:
   - minimal gridlines and readable date labels
   - lowest-price point highlighted
   - dashed target-price reference line when a target is set
   - hover tooltip showing store, price and date
   Returns a DOM element (a <div> wrapping the SVG + tooltip). */

'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

function elNS(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  }
  return el;
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* records: price records sorted chronologically (oldest first).
   opts: { targetMinor, currency, formatMoney } */
function buildPriceChart(records, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const fmt = opts.formatMoney;
  const currency = opts.currency;

  if (!records || records.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No prices recorded yet. Add a price to see the chart.';
    wrap.appendChild(p);
    return wrap;
  }

  const W = 640;
  const H = 260;
  const PAD_L = 64;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 32;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  let min = Infinity;
  let max = -Infinity;
  for (const r of records) {
    if (r.priceMinor < min) min = r.priceMinor;
    if (r.priceMinor > max) max = r.priceMinor;
  }
  if (typeof opts.targetMinor === 'number' && opts.targetMinor > 0) {
    min = Math.min(min, opts.targetMinor);
    max = Math.max(max, opts.targetMinor);
  }
  if (min === max) {
    min = Math.max(0, min - 100);
    max = max + 100;
  }
  const span = max - min;
  const pad = span * 0.12;
  min -= pad;
  max += pad;

  const xFor = (i) => PAD_L + (records.length === 1 ? innerW / 2 : (i / (records.length - 1)) * innerW);
  const yFor = (v) => PAD_T + innerH - ((v - min) / (max - min)) * innerH;

  const svg = elNS('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    role: 'img',
    'aria-label': 'Price history chart with ' + records.length + ' recorded prices',
  });
  svg.classList.add('price-chart');

  // Horizontal gridlines + y labels (4 lines).
  for (let g = 0; g <= 3; g++) {
    const v = min + ((max - min) * g) / 3;
    const y = yFor(v);
    const line = elNS('line', { x1: PAD_L, x2: W - PAD_R, y1: y, y2: y, class: 'grid-line' });
    svg.appendChild(line);
    const label = elNS('text', { x: PAD_L - 8, y: y + 4, class: 'axis-label', 'text-anchor': 'end' });
    label.textContent = fmt(Math.round(v), currency);
    svg.appendChild(label);
  }

  // Target-price reference line.
  if (typeof opts.targetMinor === 'number' && opts.targetMinor > 0) {
    const y = yFor(opts.targetMinor);
    const tline = elNS('line', {
      x1: PAD_L,
      x2: W - PAD_R,
      y1: y,
      y2: y,
      class: 'target-line',
    });
    svg.appendChild(tline);
    const tlabel = elNS('text', { x: W - PAD_R, y: y - 6, class: 'target-label', 'text-anchor': 'end' });
    tlabel.textContent = 'Target ' + fmt(opts.targetMinor, currency);
    svg.appendChild(tlabel);
  }

  // Line path.
  const points = records.map((r, i) => [xFor(i), yFor(r.priceMinor)]);
  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  svg.appendChild(elNS('path', { d: pathD, class: 'chart-line', fill: 'none' }));

  // Lowest point index.
  let lowestIdx = 0;
  records.forEach((r, i) => {
    if (r.priceMinor < records[lowestIdx].priceMinor) lowestIdx = i;
  });

  // X labels: first, middle, last.
  const labelIdx = [...new Set([0, Math.floor((records.length - 1) / 2), records.length - 1])];
  for (const i of labelIdx) {
    const t = elNS('text', { x: points[i][0], y: H - 8, class: 'axis-label', 'text-anchor': 'middle' });
    t.textContent = shortDate(records[i].date);
    svg.appendChild(t);
  }

  // Points.
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  wrap.appendChild(svg);
  wrap.appendChild(tooltip);

  records.forEach((r, i) => {
    const isLowest = i === lowestIdx;
    const dot = elNS('circle', {
      cx: points[i][0],
      cy: points[i][1],
      r: isLowest ? 6 : 4,
      class: isLowest ? 'chart-point chart-point-lowest' : 'chart-point',
    });
    const title = elNS('title');
    title.textContent = r.store + ' — ' + fmt(r.priceMinor, currency) + ' on ' + r.date;
    dot.appendChild(title);
    dot.addEventListener('mouseenter', (ev) => {
      tooltip.textContent =
        r.store + ' · ' + fmt(r.priceMinor, currency) + ' · ' + shortDate(r.date) + (isLowest ? ' · lowest' : '');
      tooltip.hidden = false;
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = Math.min(Math.max(ev.clientX - rect.left + 10, 0), rect.width - 160) + 'px';
      tooltip.style.top = Math.max(ev.clientY - rect.top - 34, 0) + 'px';
    });
    dot.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    });
    dot.addEventListener('click', (ev) => {
      tooltip.textContent =
        r.store + ' · ' + fmt(r.priceMinor, currency) + ' · ' + shortDate(r.date) + (isLowest ? ' · lowest' : '');
      tooltip.hidden = false;
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = Math.min(Math.max(ev.clientX - rect.left + 10, 0), rect.width - 160) + 'px';
      tooltip.style.top = Math.max(ev.clientY - rect.top - 34, 0) + 'px';
    });
    dot.addEventListener('focus', () => {
      tooltip.textContent = r.store + ' · ' + fmt(r.priceMinor, currency) + ' · ' + shortDate(r.date);
      tooltip.hidden = false;
      tooltip.style.left = '8px';
      tooltip.style.top = '8px';
    });
    dot.addEventListener('blur', () => {
      tooltip.hidden = true;
    });
    dot.setAttribute('tabindex', '0');
    svg.appendChild(dot);
  });

  return wrap;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPriceChart };
}
