// 设计令牌导出：从 tokens.css（唯一真源）解析出机器可读的 tokens.json
// 用途：规范页动态渲染、跨端（Web / 小程序 / 原生）共享同一份令牌定义。
// 运行：node tools/export-tokens.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
const TOKENS_CSS = path.join(APP, 'public/design-system/tokens.css');
const OUT_JSON = path.join(APP, 'public/design-system/tokens.json');
const PRODUCT_CSS = path.join(APP, 'public/styles.css');
const PRODUCT_JS_DIR = path.join(APP, 'public/js');

// ---------- 1. 解析 tokens.css ----------
// 注意：同一行可能存在多条声明（如 --viz-book-1 / --viz-book-2），取值也可能跨行
//（如 --font-family-sans）。因此先按偏移量屏蔽注释，再全局扫描声明，最后回填同行注释。
const raw = fs.readFileSync(TOKENS_CSS, 'utf8');
const masked = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const decls = []; // { name, value, comment }
for (const m of masked.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
  const name = m[1];
  if (name.startsWith('--bp-')) continue;
  const value = m[2].replace(/\s+/g, ' ').trim();
  const after = m.index + m[0].length;
  const nl = raw.indexOf('\n', after);
  const rest = raw.slice(after, nl === -1 ? raw.length : nl);
  const cm = rest.match(/\/\*([\s\S]*?)\*\//);
  decls.push({ name, value, comment: cm ? cm[1].trim() : '' });
}
const byName = Object.fromEntries(decls.map((d) => [d.name, d]));

// 解析 var() 引用链 → 最终字面量
const resolveCache = new Map();
function resolve(name, depth = 0) {
  if (resolveCache.has(name)) return resolveCache.get(name);
  if (depth > 12) return '…';
  const d = byName[name];
  if (!d) return null;
  const out = d.value.replace(/var\((--[\w-]+)(?:\s*,[^)]*)?\)/g, (mm, ref) => resolve(ref, depth + 1) ?? mm);
  resolveCache.set(name, out);
  return out;
}

// ---------- 2. 统计产品源码中的引用次数（体现代币是否"活的"） ----------
function collectJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? collectJsFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const sources = [];
if (fs.existsSync(PRODUCT_CSS)) sources.push(fs.readFileSync(PRODUCT_CSS, 'utf8'));
if (fs.existsSync(PRODUCT_JS_DIR)) {
  for (const f of collectJsFiles(PRODUCT_JS_DIR)) {
    if (f.endsWith('.js')) sources.push(fs.readFileSync(f, 'utf8'));
  }
}
const usage = {};
for (const name of Object.keys(byName)) usage[name] = 0;
for (const src of sources) {
  for (const m of src.matchAll(/var\((--[\w-]+)/g)) {
    if (usage[m[1]] !== undefined) usage[m[1]]++;
  }
}

// 依赖传播：若令牌 X 被产品启用，则 X 依赖的所有底层令牌同样视为启用
const deps = {}; // name -> [它依赖的令牌]
for (const d of decls) {
  if (!d.value.includes('var(')) continue;
  deps[d.name] = [...d.value.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
}
const active = new Set(Object.keys(usage).filter((n) => usage[n] > 0));
const queue = [...active];
while (queue.length) {
  const cur = queue.pop();
  for (const dep of deps[cur] || []) {
    if (byName[dep] && !active.has(dep)) { active.add(dep); queue.push(dep); }
  }
}

// ---------- 3. 分组 / 分层 ----------
const PRIMITIVE_COLOR = /^--(teal|slate|red|green|amber|blue|orange|gold|violet|pink|indigo|slate-viz|viz)-/;
const TYPO = /^--(font-family|font-size|font-weight|line-height|letter-spacing)/;

function classify(name) {
  if (name.startsWith('--color-')) return { tier: 2, group: 'color-semantic' };
  if (TYPO.test(name)) return { tier: 1, group: 'typography' };
  if (name.startsWith('--space-')) return { tier: 1, group: 'space' };
  if (name.startsWith('--radius-')) return { tier: 1, group: 'radius' };
  if (name.startsWith('--shadow-') || name.startsWith('--overlay-')) return { tier: 1, group: 'elevation' };
  if (name.startsWith('--duration-') || name.startsWith('--ease-')) return { tier: 1, group: 'motion' };
  if (name.startsWith('--z-')) return { tier: 1, group: 'z-index' };
  if (PRIMITIVE_COLOR.test(name)) return { tier: 1, group: 'color-primitive' };
  return { tier: 3, group: 'component' };
}

const GROUP_TITLE = {
  'color-primitive': '基础色板 Primitive Color',
  'color-semantic': '语义色 Semantic Color',
  typography: '字体排印 Typography',
  space: '间距 Spacing',
  radius: '圆角 Radius',
  elevation: '阴影与层级 Elevation',
  motion: '动效 Motion',
  'z-index': '层叠顺序 Z-index',
  component: '组件令牌 Component',
};
const GROUP_ORDER = ['color-primitive', 'color-semantic', 'typography', 'space', 'radius', 'elevation', 'motion', 'z-index', 'component'];

const groups = new Map();
const flat = {};
for (const d of decls) {
  const { tier, group } = classify(d.name);
  const resolved = resolve(d.name);
  const entry = { name: d.name, value: d.value, resolved, alias: d.value.includes('var('), comment: d.comment, usage: usage[d.name] || 0, active: active.has(d.name) };
  flat[d.name] = { ...entry, tier, group };
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(entry);
}

const groupList = GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({
  key: g,
  title: GROUP_TITLE[g],
  tier: classify(groups.get(g)[0].name).tier,
  tokens: groups.get(g),
}));

const byTier = { 1: 0, 2: 0, 3: 0 };
for (const v of Object.values(flat)) byTier[v.tier]++;

const out = {
  meta: {
    name: '校园集市 · 设计令牌',
    version: '1.0.0',
    baseline: '2026-10-10',
    source: 'public/design-system/tokens.css',
    generatedAt: new Date().toISOString(),
    description: '三层令牌体系：Tier1 基础层 / Tier2 语义层 / Tier3 组件层。产品代码只应引用 Tier2，需要微调时经 Tier3 别名。',
  },
  breakpoints: [
    { name: 'bp-sm', value: '620px', usage: '手机（单列）' },
    { name: 'bp-md', value: '900px', usage: '平板（内容收窄）' },
    { name: 'bp-lg', value: '1180px', usage: '桌面内容区最大宽度' },
    { name: 'bp-xl', value: '1280px', usage: '宽屏' },
  ],
  stats: {
    total: decls.length,
    byTier,
    groups: groupList.length,
    referenced: Object.values(flat).filter((t) => t.usage > 0).length,
    active: active.size,
    unused: Object.values(flat).filter((t) => !t.active).map((t) => t.name),
  },
  groups: groupList,
  flat,
};

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');

console.log('\n============ 设计令牌导出 ============\n');
console.log(`来源：${out.meta.source}`);
console.log(`输出：${path.relative(APP, OUT_JSON).replace(/\\/g, '/')}`);
console.log(`令牌总数：${out.stats.total}  （Tier1 ${byTier[1]} / Tier2 ${byTier[2]} / Tier3 ${byTier[3]}）`);
console.log(`直接引用：${out.stats.referenced} 个｜经别名链生效：${out.stats.active} / ${out.stats.total}`);
if (out.stats.unused.length) console.log(`备用未启用：${out.stats.unused.length} 个（预留色阶 / 刻度，供扩展）`);
console.log('');
