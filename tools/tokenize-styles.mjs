// 样式令牌化改造（codemod）
// 把 public/styles.css 中的硬编码取值替换为设计令牌引用，并把旧 :root 改写为
// 「导入令牌 + 兼容别名」两块，使既有 var(--brand) 等旧变量自动指向新语义令牌。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
const FILE = path.join(APP, 'public/styles.css');
let css = fs.readFileSync(FILE, 'utf8');
const before = css;

const counts = {};
const hit = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

/* ---------- 1. 旧 :root → 导入令牌 + 兼容别名 ---------- */
const ROOT_RE = /:root\s*\{[\s\S]*?\n\}/;
const ALIAS_BLOCK = `/* ==========================================================================
   样式入口：颜色/字体/间距/圆角/阴影/动效一律引用设计令牌，不出现裸值。
   令牌真源见 /design-system/tokens.css
   ========================================================================== */
@import url('/design-system/tokens.css');

:root {
  /* ---- 兼容别名：旧变量名 → 语义令牌 ---- */
  --brand: var(--color-action-primary);
  --brand-dark: var(--color-action-primary-hover);
  --brand-soft: var(--color-action-primary-subtle);
  --accent: var(--color-action-accent);
  --danger: var(--color-danger);
  --danger-soft: var(--color-danger-bg);
  --ok: var(--color-success);
  --ok-soft: var(--color-success-bg);
  --warn: var(--color-warning);
  --warn-soft: var(--color-warning-bg);
  --info: var(--color-info);
  --info-soft: var(--color-info-bg);
  --ink: var(--color-text-primary);
  --ink-2: var(--color-text-secondary);
  --ink-3: var(--color-text-tertiary);
  --line: var(--color-border-default);
  --bg: var(--color-bg-canvas);
  --card: var(--color-bg-surface);
  --radius: var(--radius-14);
  --shadow-sm: var(--shadow-1);
  --shadow-md: var(--shadow-2);
  --shadow-lg: var(--shadow-3);
}`;
if (ROOT_RE.test(css)) { css = css.replace(ROOT_RE, ALIAS_BLOCK); hit('旧 :root 块改写为令牌导入 + 别名'); }
else throw new Error('未找到 :root 块');

/* ---------- 2. 颜色：按属性分组的精确映射 ---------- */
const BG = {
  '#fff': 'var(--color-bg-surface)',
  '#ffffff': 'var(--color-bg-surface)',
  '#eef1f5': 'var(--color-bg-muted)',
  '#fafbfc': 'var(--color-bg-subtle)',
  '#f8fafc': 'var(--color-bg-subtle)',
  '#fafcfd': 'var(--color-bg-subtle)',
  '#b9ece6': 'var(--teal-100)',
  '#e0862f': 'var(--color-action-accent-hover)',
  '#cf3b40': 'var(--color-danger)',
  '#fffaf2': 'var(--color-warning-bg-soft)',
  '#fff7f7': 'var(--color-danger-bg-soft)',
  '#f5fcf6': 'var(--color-success-bg-soft)',
};
const FG = {
  '#fff': 'var(--color-text-inverse)',
  '#ffffff': 'var(--color-text-inverse)',
  '#1c7a2e': 'var(--color-success-fg)',
  '#ffb400': 'var(--color-rating)',
  '#dde3ea': 'var(--color-rating-off)',
  '#b4bdc9': 'var(--color-text-placeholder)',
  '#b42318': 'var(--color-danger-fg)',
  '#8a5200': 'var(--color-warning-fg)',
};
const BORDER = {
  '#c3e6c8': 'var(--color-success-border)',
  '#d5dde6': 'var(--card-border-hover)',
  '#f7c9c9': 'var(--color-danger-border)',
  '#cfe0fb': 'var(--color-info-border)',
};

const applyMap = (map, ref) => {
  for (const [lit, token] of Object.entries(map)) {
    const esc = lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${ref}\\s*:\\s*)${esc}\\b`, 'g');
    css = css.replace(re, (m, p1) => { hit(`颜色 ${ref}: ${lit}`); return p1 + token; });
  }
};
applyMap(BG, 'background(?:-color)?');
applyMap(FG, 'color');
applyMap(BORDER, 'border-color');

/* 渐变与自定义 rgba */
const GRADS = [
  ['linear-gradient(150deg, #0b8174 0%, #0e9f8e 45%, #34b8a5 100%)',
   'linear-gradient(150deg, var(--teal-600) 0%, var(--teal-500) 45%, var(--teal-400) 100%)', '品牌渐变'],
  ['linear-gradient(90deg, var(--brand), #4cc9b6)',
   'linear-gradient(90deg, var(--brand), var(--teal-450))', '数据条渐变'],
  ['linear-gradient(135deg, var(--brand), #4cc9b6)',
   'linear-gradient(135deg, var(--brand), var(--teal-450))', 'Logo 渐变'],
  ['linear-gradient(120deg, #fff5f5, #fff)',
   'linear-gradient(120deg, var(--red-25) 0%, var(--color-bg-surface) 100%)', '价格区渐变'],
];
for (const [from, to, name] of GRADS) {
  if (css.includes(from)) { css = css.split(from).join(to); hit(`渐变 ${name}`); }
}

const RGBA = [
  ['rgba(255,255,255,.92)', 'var(--overlay-glass)', '顶栏玻璃底'],
  ['rgba(255,255,255,.9)', 'var(--overlay-glass-soft)', '封面标签底'],
  ['rgba(255,255,255,.7)', 'var(--overlay-glass-soft2)', '浅底代码块'],
  ['rgba(255,255,255,.18)', 'var(--overlay-glass-line)', '特性图标底'],
  ['rgba(255,255,255,.09)', 'var(--overlay-glass-faint)', '装饰圆'],
  ['rgba(255,255,255,.07)', 'var(--overlay-glass-ghost)', '装饰圆'],
  ['rgba(20,32,51,.42)', 'var(--overlay-scrim)', '弹窗遮罩'],
  ['rgba(20, 32, 51, .42)', 'var(--overlay-scrim)', '弹窗遮罩'],
  ['rgba(0, 0, 0, .55)', 'var(--overlay-scrim-strong)', '图片查看遮罩'],
  ['rgba(14, 159, 142, .92)', 'var(--overlay-brand)', '轻提示气泡底'],
  ['rgba(14,159,142,.35)', 'var(--shadow-brand-md)', '阴影（并入阴影令牌）'],
  ['rgba(14,159,142,.3)', 'var(--shadow-brand-sm)', '阴影（并入阴影令牌）'],
  ['rgba(14,159,142,.28)', 'var(--shadow-brand-sm)', '阴影（并入阴影令牌）'],
  ['rgba(14,159,142,.25)', 'var(--shadow-brand-sm)', '阴影（并入阴影令牌）'],
  ['rgba(0,0,0,.18)', 'rgba(0, 0, 0, .18)', '图片投影（保留字面量，见 --shadow-icon）'],
];
for (const [from, to, name] of RGBA) {
  if (css.includes(from)) { css = css.split(from).join(to); hit(`视觉层 ${name}`); }
}

/* 完整 box-shadow 语句 → 阴影令牌 */
const SHADOWS = [
  ['box-shadow: 0 3px 10px var(--shadow-brand-md);', 'box-shadow: var(--shadow-brand-md);', '品牌光晕（大）'],
  ['box-shadow: 0 2px 8px var(--shadow-brand-sm);', 'box-shadow: var(--shadow-brand-sm);', '品牌光晕（小）'],
  ['box-shadow: 0 0 0 3px rgba(14,159,142,.13);', 'box-shadow: var(--shadow-focus);', '焦点环'],
];
for (const [from, to, name] of SHADOWS) {
  if (css.includes(from)) { css = css.split(from).join(to); hit(`阴影 ${name}`); }
}

/* ---------- 3. 字号 ---------- */
const FS = {
  '10.5px': 'var(--font-size-2xs)', '11px': 'var(--font-size-2xs)', '11.5px': 'var(--font-size-xs)',
  '12px': 'var(--font-size-xs)', '12.5px': 'var(--font-size-xs)', '13px': 'var(--font-size-sm)',
  '13.5px': 'var(--font-size-md)', '14px': 'var(--font-size-md)', '15px': 'var(--font-size-lg)',
  '16px': 'var(--font-size-lg)', '17px': 'var(--font-size-xl)', '18px': 'var(--font-size-xl)',
  '19px': 'var(--font-size-2xl)', '20px': 'var(--font-size-2xl)', '21px': 'var(--font-size-2xl)',
  '26px': 'var(--font-size-3xl)', '32px': 'var(--font-size-4xl)', '40px': 'var(--font-size-5xl)',
};
for (const [lit, token] of Object.entries(FS)) {
  const esc = lit.replace('.', '\\.');
  const re = new RegExp(`(font-size\\s*:\\s*)${esc}\\b`, 'g');
  css = css.replace(re, (m, p1) => { hit(`字号 ${lit} → ${token}`); return p1 + token; });
}

/* ---------- 4. 圆角 ---------- */
const RADII = {
  '2px': 'var(--radius-2)', '4px': 'var(--radius-4)', '7px': 'var(--radius-8)',
  '8px': 'var(--radius-8)', '9px': 'var(--radius-8)', '10px': 'var(--radius-10)',
  '11px': 'var(--radius-12)', '12px': 'var(--radius-12)', '14px': 'var(--radius-14)',
  '16px': 'var(--radius-16)', '999px': 'var(--radius-full)', '50%': 'var(--radius-circle)',
};
// 逐值替换（含多值简写），按长度倒序避免 10px 命中 110px 之类误伤
for (const [lit, token] of Object.entries(RADII).sort((a, b) => b[0].length - a[0].length)) {
  const esc = lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('%', '%');
  const re = new RegExp(`(border-radius\\s*:[^;}]*?)\\b${esc}\\b`, 'g');
  css = css.replace(re, (m, p1) => {
    if (m.includes('var(')) return m;
    hit(`圆角 ${lit} → ${token}`);
    return p1 + token;
  });
}

/* ---------- 5. 间距 ---------- */
const SP = {
  '1px': 'var(--space-1)', '2px': 'var(--space-2)', '3px': 'var(--space-4)', '4px': 'var(--space-4)',
  '5px': 'var(--space-6)', '6px': 'var(--space-6)', '7px': 'var(--space-8)', '8px': 'var(--space-8)',
  '9px': 'var(--space-10)', '10px': 'var(--space-10)', '11px': 'var(--space-12)', '12px': 'var(--space-12)',
  '13px': 'var(--space-14)', '14px': 'var(--space-14)', '15px': 'var(--space-16)', '16px': 'var(--space-16)',
  '17px': 'var(--space-18)', '18px': 'var(--space-18)', '19px': 'var(--space-20)', '20px': 'var(--space-20)',
  '21px': 'var(--space-22)', '22px': 'var(--space-22)', '24px': 'var(--space-24)', '28px': 'var(--space-28)',
  '32px': 'var(--space-32)', '34px': 'var(--space-32)', '40px': 'var(--space-40)', '48px': 'var(--space-48)',
  '56px': 'var(--space-56)', '60px': 'var(--space-64)', '64px': 'var(--space-64)',
};
const SP_PROPS = 'padding|padding-top|padding-bottom|padding-left|padding-right|margin|margin-top|margin-bottom|margin-left|margin-right|gap|row-gap|column-gap';
for (const [lit, token] of Object.entries(SP).sort((a, b) => parseInt(b[0]) - parseInt(a[0]))) {
  const esc = lit.replace('px', 'px');
  const re = new RegExp(`((?:^|[;{\\s])(?:${SP_PROPS})\\s*:[^;}]*?)\\b${esc}\\b`, 'g');
  css = css.replace(re, (m, p1) => { hit(`间距 ${lit} → ${token}`); return p1 + token; });
}

/* ---------- 6. 字重 / 行高 / 动效 / 层级 ---------- */
const MISC = [
  [/(\bfont-weight\s*:\s*)500\b/g, '$1var(--font-weight-medium)', '字重 500'],
  [/(\bfont-weight\s*:\s*)600\b/g, '$1var(--font-weight-semibold)', '字重 600'],
  [/(\bfont-weight\s*:\s*)700\b/g, '$1var(--font-weight-bold)', '字重 700'],
  [/(\bline-height\s*:\s*)1\.75\b/g, '$1var(--line-height-relaxed)', '行高 1.75'],
  [/(\bline-height\s*:\s*)1\.7\b/g, '$1var(--line-height-relaxed)', '行高 1.7'],
  [/(\bline-height\s*:\s*)1\.6\b/g, '$1var(--line-height-base)', '行高 1.6'],
  [/(\bline-height\s*:\s*)1\.5\b/g, '$1var(--line-height-snug)', '行高 1.5'],
  [/(\bline-height\s*:\s*)1\.45\b/g, '$1var(--line-height-snug)', '行高 1.45'],
  [/(\bline-height\s*:\s*)1\.35\b/g, '$1var(--line-height-tight)', '行高 1.35'],
  [/(\bline-height\s*:\s*)1\.3\b/g, '$1var(--line-height-tight)', '行高 1.3'],
  [/(\bline-height\s*:\s*)1(?=[;\s}])/g, '$1var(--line-height-none)', '行高 1'],
  [/(\btransition\s*:[^;}]*?)\ball\s+\.16s\b/g, '$1all var(--duration-fast) var(--ease-standard)', '过渡 all .16s'],
  [/(\btransition\s*:[^;}]*?)\ball\s+\.2s\b/g, '$1all var(--duration-normal) var(--ease-standard)', '过渡 all .2s'],
  [/(\btransition\s*:[^;}]*?)\bopacity\s+\.18s\b/g, '$1opacity var(--duration-normal) var(--ease-standard)', '过渡 opacity'],
  [/(\btransition\s*:[^;}]*?)\btransform\s+\.2s\b/g, '$1transform var(--duration-normal) var(--ease-standard)', '过渡 transform'],
  [/(\btransition\s*:\s*)\.16s\b/g, '$1var(--duration-fast) var(--ease-standard)', '过渡 .16s'],
  [/(\bz-index\s*:\s*)60\b/g, '$1var(--z-sticky)', '层级 60'],
  [/(\bz-index\s*:\s*)100\b/g, '$1var(--z-dropdown)', '层级 100'],
  [/(\bz-index\s*:\s*)150\b/g, '$1var(--z-overlay)', '层级 150'],
  [/(\bz-index\s*:\s*)200\b/g, '$1var(--z-toast)', '层级 200'],
  [/(\bz-index\s*:\s*)1(?=[;\s}])/g, '$1var(--z-raised)', '层级 1'],
];
for (const [re, to, name] of MISC) {
  const n = (css.match(re) || []).length;
  if (n) { css = css.replace(re, to); hit(name, n); }
}

fs.writeFileSync(FILE, css, 'utf8');

console.log('\n================ 样式令牌化改造报告 ================\n');
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`替换点合计：${total} 处\n`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}×  ${k}`);
}
console.log(`\n文件：${before.length} → ${css.length} 字节（${before.split('\n').length} → ${css.split('\n').length} 行）`);
