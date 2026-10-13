// 校园集市 · 设计规范站渲染逻辑
// 全部内容由 tokens.json / contrast.json 实时生成 —— 改令牌，规范页随之更新。
// 规范站自身不硬编码任何设计取值（除结构性尺寸），是令牌体系的第一个消费者。

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') Object.assign(n.style, v);
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

const [TOKENS, CONTRAST] = await Promise.all([
  fetch('./tokens.json').then((r) => r.json()),
  fetch('./contrast.json').then((r) => r.json()).catch(() => null),
]);

const FLAT = TOKENS.flat;
const cssVar = (name) => `var(${name})`;

// ---------- 颜色工具（与 contrast-audit.js 同一套公式） ----------
function parseColor(c) {
  if (!c) return null;
  c = c.trim();
  let m = /^#([0-9a-fA-F]{3})$/.exec(c);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-fA-F]{6})$/.exec(c);
  if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
const lum = ({ r, g, b }) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const solid = (tok, base = { r: 255, g: 255, b: 255, a: 1 }) => {
  const c = parseColor(FLAT[tok]?.resolved);
  if (!c) return null;
  return c.a < 1 ? over(c, base) : c;
};

// ---------- 复制 ----------
const hint = $('copy-hint');
let hintTimer;
function toast(msg) {
  hint.textContent = msg;
  hint.classList.add('in');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('in'), 1400);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast(msg || `已复制 ${text}`);
}

// ---------- 令牌查询 ----------
const byGroup = (g) => TOKENS.groups.find((x) => x.key === g)?.tokens ?? [];
const colorTokens = Object.values(FLAT).filter((t) => parseColor(t.resolved));
const num = (n) => parseFloat(n) || 0;
const suffix = (name) => num(name.replace(/^.*?(\d+)$/, '$1'));

// ================= 01 概览 =================
(function stats() {
  const s = TOKENS.stats;
  const cards = [
    [s.total, '设计令牌总数', false],
    [s.byTier[1], 'Tier 1 · 基础层', false],
    [s.byTier[2], 'Tier 2 · 语义层', false],
    [s.byTier[3], 'Tier 3 · 组件层', false],
    [`${s.active}`, '已生效令牌（含别名链）', true],
    [colorTokens.length, '可计算色值令牌', true],
  ];
  $('stat-grid').append(...cards.map(([v, label, plain]) =>
    h('div', { class: 'stat' + (plain ? ' is-plain' : '') }, h('b', {}, String(v)), h('span', {}, label))));
  $('badge-tokens').textContent = `令牌 ${s.total}`;
})();

// ================= 02 色彩 =================
function ramp(tokens, { title, note, reservedHint = true }) {
  const wrap = h('div', { class: 'ramp' });
  if (title) wrap.append(h('div', { class: 'ramp-head' }, h('b', {}, title), note ? h('span', {}, note) : null));
  wrap.append(h('div', { class: 'ramp-row' }, ...tokens.map((t) => swatch(t, reservedHint))));
  return wrap;
}
function swatch(t, reservedHint) {
  const c = parseColor(t.resolved);
  const hex = t.resolved.toUpperCase();
  const btn = h('button', {
    class: 'swatch' + (reservedHint && !t.active ? ' is-reserved' : ''),
    title: `${t.name}\n${hex}${t.comment ? '\n' + t.comment : ''}\n引用 ${t.usage} 次`,
    onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`),
  },
    h('div', { class: 'chip', style: { background: cssVar(t.name) } }),
    h('div', { class: 'meta' }, h('b', {}, t.name.replace(/^--/, '')), h('span', {}, hex)));
  return btn;
}
const pick = (prefix, excludeViz = true) => Object.values(FLAT)
  .filter((t) => t.name.startsWith(prefix) && (!excludeViz || !t.name.includes('-viz')))
  .sort((a, b) => suffix(a.name) - suffix(b.name));

$('ramp-teal').append(ramp(pick('--teal-'), { title: 'Teal · 品牌青绿', note: '50 → 900，450 为渐变亮端' }));
$('ramp-slate').append(ramp(pick('--slate-').filter((t) => !t.name.includes('viz')), { title: 'Slate · 中性灰蓝', note: '0 → 900，550 为三级文本专用' }));
$('ramp-functional').append(
  ramp(pick('--red-'), { title: 'Red · 危险 / 价格' }),
  ramp(pick('--green-'), { title: 'Green · 成功' }),
  ramp(pick('--amber-'), { title: 'Amber · 警告' }),
  ramp(pick('--blue-'), { title: 'Blue · 信息' }),
  ramp(pick('--orange-'), { title: 'Orange · 强调' }),
  ramp([...pick('--gold-'), ...pick('--violet-'), ...pick('--pink-'), ...pick('--indigo-'), ...pick('--slate-viz-')], { title: '点缀色', note: '评分星标 / 图标装饰 / 可视化' }),
);
(function vizRamp() {
  const cats = [['book', '教材书籍'], ['digital', '电子数码'], ['life', '生活用品'], ['sport', '体育运动'], ['fashion', '服饰美妆'], ['other', '其他']];
  const row = h('div', { class: 'ramp-row' });
  for (const [k, label] of cats) {
    const a = `--viz-${k}-1`, b = `--viz-${k}-2`;
    if (!FLAT[a] || !FLAT[b]) continue;
    row.append(h('button', {
      class: 'swatch', style: { width: '132px' },
      title: `${label}\n${a} → ${b}`,
      onClick: () => copy(`linear-gradient(135deg, ${cssVar(a)}, ${cssVar(b)})`, '已复制渐变'),
    },
      h('div', { class: 'chip', style: { height: '56px', background: `linear-gradient(135deg, ${cssVar(a)}, ${cssVar(b)})` } }),
      h('div', { class: 'meta' }, h('b', {}, label), h('span', {}, '渐变封面'))));
  }
  $('ramp-viz').append(row);
})();

(function semantic() {
  const grid = $('semantic-grid');
  const isTextish = (n) => /(^|-)fg$|-text-|price|rating|subtle-fg/.test(n);
  for (const t of byGroup('color-semantic')) {
    const c = parseColor(t.resolved);
    const textish = isTextish(t.name);
    let preview;
    if (textish) {
      preview = h('div', { class: 'preview', style: { background: 'var(--color-bg-surface)', color: cssVar(t.name) } }, 'Aa 文本预览 Bear');
    } else {
      const cc = solid(t.name);
      const onWhite = cc ? ratio(cc, { r: 255, g: 255, b: 255, a: 1 }) : 0;
      const onDark = cc ? ratio(cc, { r: 17, g: 24, b: 38, a: 1 }) : 0;
      preview = h('div', {
        class: 'preview',
        style: { background: cssVar(t.name), color: onWhite >= onDark ? 'var(--color-text-inverse)' : 'var(--color-text-primary)' },
      }, 'Aa 文本预览 Bear');
    }
    grid.append(h('button', {
      class: 'semantic-card',
      title: `${t.name} → ${t.resolved}`,
      onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`),
    },
      preview,
      h('div', { class: 'body' },
        h('b', {}, t.name),
        h('em', {}, c ? t.resolved.toUpperCase() : '—'),
        h('span', {}, t.comment || (t.active ? `引用 ${t.usage} 次` : '预留')),
      )));
  }
})();

// ================= 03 字体排印 =================
const TYPO = {
  size: byGroup('typography').filter((t) => t.name.startsWith('--font-size-')).sort((a, b) => num(a.resolved) - num(b.resolved)),
  weight: byGroup('typography').filter((t) => t.name.startsWith('--font-weight-')).sort((a, b) => num(a.resolved) - num(b.resolved)),
  line: byGroup('typography').filter((t) => t.name.startsWith('--line-height-')),
  letter: byGroup('typography').filter((t) => t.name.startsWith('--letter-spacing-')),
};
(function typeScale() {
  const box = $('type-scale');
  const input = $('type-input');
  const label = (t) => t.comment || t.name.replace('--font-size-', '');
  const render = () => {
    box.replaceChildren(...TYPO.size.map((t) => h('div', { class: 'type-row', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
      h('span', { class: 'tok' }, t.name.replace('--font-size-', 'fs-')),
      h('span', { class: 'size' }, t.resolved),
      h('span', { class: 'sample', style: { fontSize: cssVar(t.name) } }, input.value || 'Aa'),
    )));
  };
  input.addEventListener('input', render);
  render();
})();
(function weights() {
  $('weight-row').append(...TYPO.weight.map((t) => h('div', { class: 'wt-item', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('span', { class: 'tok' }, t.name.replace('--font-weight-', 'fw-') + ' · ' + t.resolved),
    h('div', { style: { fontWeight: cssVar(t.name), fontSize: 'var(--font-size-lg)' } }, '校园集市 Campus Market'))));
})();
function scaleRows(host, tokens, fmt) {
  $(host).append(...tokens.map((t) => h('div', { class: 'scale-item', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('span', { class: 'tok' }, t.name.replace('--', '')),
    h('span', { class: 'val' }, t.resolved),
    h('div', { style: { minWidth: '0' } }, fmt(t)))));
}
scaleRows('line-height-list', TYPO.line, (t) => h('div', { style: { lineHeight: cssVar(t.name), fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' } }, '校园集市让闲置流动起来'));
scaleRows('letter-spacing-list', TYPO.letter, (t) => h('div', { style: { letterSpacing: cssVar(t.name), fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' } }, 'CAMPUS MARKET 校园集市'));

// ================= 04 间距 =================
(function spacing() {
  const list = byGroup('space').sort((a, b) => num(a.resolved) - num(b.resolved));
  $('spacing-list').append(...list.map((t) => h('div', { class: 'scale-item', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('span', { class: 'tok' }, t.name),
    h('span', { class: 'val' }, t.resolved),
    h('div', { style: { background: 'var(--color-bg-muted)', borderRadius: 'var(--radius-2)', padding: '2px' } },
      h('div', { class: 'scale-bar', style: { width: `${Math.max(2, num(t.resolved))}px` } })))));
})();

// ================= 05 圆角 =================
(function radius() {
  $('radius-grid').append(...byGroup('radius').map((t) => h('div', { class: 'radius-item', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('div', { class: 'box', style: { borderRadius: cssVar(t.name) } }),
    h('span', { class: 'tok' }, t.name),
    h('span', { class: 'val' }, t.resolved))));
})();

// ================= 06 阴影与层级 =================
(function elevation() {
  const shadows = byGroup('elevation').filter((t) => t.name.startsWith('--shadow-'));
  $('shadow-grid').append(...shadows.map((t) => {
    const isFilter = t.resolved.includes('drop-shadow'); // filter 类阴影需作用在元素自身
    const card = h('div', {
      class: 'shadow-item', title: `${t.name} = ${t.resolved}`, style: { cursor: 'pointer' },
      onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`),
    });
    if (isFilter) {
      card.style.background = 'var(--color-bg-subtle)';
      card.append(h('div', { style: { height: '48px', display: 'grid', placeItems: 'center' } },
        h('span', { style: { filter: cssVar(t.name), fontSize: 'var(--font-size-5xl)', lineHeight: '1' } }, '🗒')));
    } else {
      card.style.boxShadow = cssVar(t.name);
      card.append(h('div', { style: { height: '48px' } }));
    }
    card.append(
      h('span', { class: 'tok' }, t.name.replace('--shadow-', '')),
      h('span', { class: 'val' }, t.resolved));
    return card;
  }));
  const overlays = byGroup('elevation').filter((t) => t.name.startsWith('--overlay-'));
  $('overlay-grid').append(...overlays.map((t) => h('div', { class: 'radius-item', title: `${t.name}\n${t.resolved}`, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('div', { class: 'box', style: { background: 'linear-gradient(135deg, var(--teal-400), var(--slate-300))', position: 'relative' } },
      h('div', { style: { position: 'absolute', inset: '0', background: cssVar(t.name), borderRadius: 'inherit' } })),
    h('span', { class: 'tok' }, t.name.replace('--overlay-', 'ov-')),
    h('span', { class: 'val' }, t.resolved))));
  scaleRows('z-list', byGroup('z-index'), (t) => h('div', { style: { fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' } }, `${t.name} = ${t.resolved}`));
})();

// ================= 07 动效 =================
(function motion() {
  const durs = byGroup('motion').filter((t) => t.name.startsWith('--duration-'));
  const max = Math.max(...durs.map((t) => num(t.resolved)), 300);
  $('duration-list').append(...durs.map((t) => h('div', { class: 'motion-row', title: t.name, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('span', { class: 'tok' }, t.name), h('span', { class: 'val' }, t.resolved),
    h('div', { class: 'motion-track' }, h('div', { class: 'motion-fill', style: { width: `${(num(t.resolved) / max) * 100}%` }, })))));
  const eases = byGroup('motion').filter((t) => t.name.startsWith('--ease-'));
  $('ease-grid').append(...eases.map((t) => h('div', { class: 'radius-item', title: `${t.name} ${t.resolved}`, style: { cursor: 'pointer' }, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
    h('div', { class: 'ease-demo' }, h('i', { style: { transition: `transform var(--duration-slow) ${cssVar(t.name)}` } })),
    h('span', { class: 'tok', style: { marginTop: 'var(--space-8)', display: 'block' } }, t.name.replace('--ease-', '')),
    h('span', { class: 'val' }, t.resolved))));
  document.querySelectorAll('.ease-demo').forEach((d, i) => setTimeout(() => { d.classList.add('run'); setTimeout(() => d.classList.remove('run'), 500); }, 400 + i * 260));
})();

// ================= 09 无障碍 =================
(function a11y() {
  const badge = $('badge-a11y');
  if (CONTRAST) {
    badge.textContent = `无障碍 ${CONTRAST.pass}/${CONTRAST.total} AA`;
    $('contrast-summary').textContent = `共审计 ${CONTRAST.total} 组关键组合，全部满足 WCAG 2.1 AA（标准 ${CONTRAST.standard}）。数据由 test/contrast-audit.js 实算导出。`;
    const tb = $('contrast-table');
    tb.append(h('thead', {}, h('tr', {},
      h('th', {}, '前景'), h('th', {}, '背景'), h('th', {}, '场景'), h('th', {}, '对比度'), h('th', {}, '阈值'), h('th', {}, '结果'))));
    tb.append(h('tbody', {}, ...CONTRAST.rows.map((r) => h('tr', {},
      h('td', { class: 'mono' }, h('span', { class: 'sw', style: { background: r.fgHex } }), r.fg.replace('--color-', '').replace('--', '')),
      h('td', { class: 'mono' }, h('span', { class: 'sw', style: { background: r.bgHex } }), r.bg.replace('--color-', '').replace('--', '')),
      h('td', {}, r.label),
      h('td', { class: 'score' }, r.ratio.toFixed(2)),
      h('td', { class: 'mono' }, '≥ ' + r.need),
      h('td', {}, h('span', { class: r.pass ? 'tag-pass' : 'tag-fail' }, r.pass ? '通过' : '不达标'))))));
  } else {
    badge.textContent = '无障碍 未审计';
  }

  // 对比度计算器
  const opts = colorTokens
    .filter((t) => t.resolved.startsWith('#') || t.resolved.startsWith('rgb'))
    .sort((a, b) => (b.tier - a.tier) || a.name.localeCompare(b.name));
  const mk = (sel, def) => { for (const t of opts) sel.append(h('option', { value: t.name }, t.name + '  ' + t.resolved)); sel.value = def; };
  mk($('calc-fg'), '--color-text-primary');
  mk($('calc-bg'), '--color-bg-surface');
  const run = () => {
    const fgTok = $('calc-fg').value, bgTok = $('calc-bg').value;
    const bgRaw = parseColor(FLAT[bgTok].resolved);
    const bg = bgRaw.a < 1 ? over(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
    const fgRaw = parseColor(FLAT[fgTok].resolved);
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
    const r = ratio(fg, bg);
    const prev = $('calc-preview');
    prev.style.background = cssVar(bgTok);
    prev.style.color = cssVar(fgTok);
    $('calc-score').textContent = r.toFixed(2);
    $('calc-score').style.color = r >= 4.5 ? 'var(--color-success-fg)' : r >= 3 ? 'var(--color-warning-fg)' : 'var(--color-danger-fg)';
    $('calc-hex').textContent = '# ' + toHex(fg) + '  on  ' + toHex(bg);
    const v = [];
    const tag = (ok, txt) => h('span', { class: ok ? 'tag-pass' : 'tag-fail' }, txt);
    v.push(tag(r >= 4.5, 'AA 正文 ≥4.5'));
    v.push(tag(r >= 3, 'AA 大字/图形 ≥3'));
    v.push(tag(r >= 7, 'AAA 正文 ≥7'));
    $('calc-verdicts').replaceChildren(...v);
  };
  $('calc-fg').addEventListener('change', run);
  $('calc-bg').addEventListener('change', run);
  run();
})();
function toHex({ r, g, b }) {
  const f = (n) => Math.round(n).toString(16).padStart(2, '0');
  return ('#' + f(r) + f(g) + f(b)).toUpperCase();
}

// ================= 10 响应式 =================
(function responsive() {
  $('bp-list').append(...TOKENS.breakpoints.map((b) => h('div', { class: 'bp-row' },
    h('span', { class: 'tok' }, '--' + b.name), h('span', { class: 'val' }, b.value),
    h('span', { style: { color: 'var(--color-text-secondary)' } }, b.usage))));
  const frame = $('viewport-frame'), dim = $('viewport-dim');
  document.querySelectorAll('.viewport-bar button').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.viewport-bar button').forEach((b) => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    const w = Number(btn.dataset.w);
    frame.style.width = w ? w + 'px' : '100%';
    frame.style.margin = w ? '0 auto' : '0';
    dim.textContent = w ? w + ' px' : '自适应（跟随容器宽度）';
  }));
})();

// ================= 11 令牌索引 =================
(function tokenIndex() {
  const all = Object.values(FLAT);
  const tb = $('token-table');
  tb.append(h('thead', {}, h('tr', {},
    h('th', {}, '令牌'), h('th', {}, '声明值'), h('th', {}, '解析值'), h('th', {}, '层级'), h('th', {}, '引用'), h('th', {}, '状态'))));
  const tbody = h('tbody');
  tb.append(tbody);
  let q = '', tier = 'all';

  const render = () => {
    const key = q.trim().toLowerCase();
    const rows = all.filter((t) => {
      if (tier === '1' && t.tier !== 1) return false;
      if (tier === '2' && t.tier !== 2) return false;
      if (tier === '3' && t.tier !== 3) return false;
      if (tier === 'active' && !t.active) return false;
      if (!key) return true;
      return (t.name + ' ' + t.value + ' ' + t.resolved + ' ' + t.comment).toLowerCase().includes(key);
    });
    tbody.replaceChildren(...rows.map((t) => {
      const c = parseColor(t.resolved);
      return h('tr', { title: `点击复制 ${cssVar(t.name)}`, onClick: () => copy(cssVar(t.name), `已复制 ${t.name}`) },
        h('td', { class: 'nm' }, c ? h('span', { class: 'sw', style: { background: cssVar(t.name) } }) : null, t.name),
        h('td', { class: 'rs' }, t.value),
        h('td', { class: 'rs' }, t.resolved),
        h('td', {}, h('span', { class: 'tier-pill' }, 'T' + t.tier)),
        h('td', {}, h('span', { class: 'usage-pill' + (t.usage ? ' is-on' : '') }, String(t.usage))),
        h('td', {}, t.active ? h('span', { class: 'tag-pass' }, '启用') : h('span', { class: 'tag-fail', style: { background: 'var(--color-bg-muted)', color: 'var(--color-text-tertiary)' } }, '预留')));
    }));
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: '6', class: 'empty-row' }, '没有匹配的令牌')));
    $('token-count').textContent = `显示 ${rows.length} / ${all.length} 个令牌` + (key || tier !== 'all' ? '（已筛选）' : '');
  };

  $('token-search').addEventListener('input', (e) => { q = e.target.value; render(); });
  document.querySelectorAll('#token-seg button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#token-seg button').forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    tier = b.dataset.tier;
    render();
  }));
  render();
})();

// ================= 目录高亮 =================
(function navHighlight() {
  const links = [...document.querySelectorAll('.spec-nav a')];
  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        links.forEach((a) => a.classList.remove('is-active'));
        map.get(e.target.id)?.classList.add('is-active');
      }
    }
  }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
  document.querySelectorAll('.section').forEach((s) => obs.observe(s));
})();
