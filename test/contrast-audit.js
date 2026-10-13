// 无障碍对比度审计：解析 tokens.css 的 var() 链，按 WCAG 2.1 计算真实对比度
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(APP, 'public/design-system/tokens.css'), 'utf8');

// 1. 解析所有自定义属性
const vars = {};
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();

// 2. 解析 var() 链到最终字面量
function resolve(name, depth = 0) {
  if (depth > 12) return null;
  const raw = vars[name];
  if (raw === undefined) return null;
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(raw);
  if (m) return resolve(m[1], depth + 1) ?? (m[2] ? m[2].trim() : null);
  return raw;
}
const literal = (name) => {
  const v = name.startsWith('--') ? resolve(name) : name;
  return v;
};

// 3. 颜色解析 → {r,g,b,a}
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

// 4. 合成半透明色到不透明背景之上
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

// 5. WCAG 相对亮度与对比度
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// 6. 待检组合：文本色 × 背景色 × 应用场景（字号/字重决定 AA 阈值）
const PAIRS = [
  // 基础文本
  ['--color-text-primary',   '--color-bg-surface', '正文', 14, 400],
  ['--color-text-primary',   '--color-bg-canvas',  '正文/页底', 14, 400],
  ['--color-text-secondary', '--color-bg-surface', '次要文本', 13, 400],
  ['--color-text-secondary', '--color-bg-canvas',  '次要文本/页底', 13, 400],
  ['--color-text-secondary', '--color-bg-subtle',  '表头文字', 12, 600],
  ['--color-text-tertiary',  '--color-bg-surface', '三级文本（元信息）', 12, 400],
  ['--color-text-tertiary',  '--color-bg-canvas',  '三级文本/页底', 12, 400],
  ['--color-text-placeholder','--color-bg-surface', '占位符（辅助提示，按 3:1）', 0, 0],
  ['--color-text-inverse',   '--color-bg-inverse', '深底反白', 14, 400],

  // 主色
  ['--color-action-primary', '--slate-0', '主按钮文字（白字青底）', 14, 600],
  ['--color-action-primary-hover', '--slate-0', '主按钮 hover', 14, 600],
  ['--color-action-primary', '--slate-50', '选中 chip 青底与页底的分界（非文本 3:1）', 0, 0],
  ['--color-action-primary-subtle-fg', '--color-action-primary-subtle', '浅青底上的链接/强调文字', 13, 600],
  ['--color-action-primary-subtle-fg', '--slate-0', '强调文字（白底）', 13, 600],

  // 功能色（前景 + 浅底，即徽章/提示条的典型组合）
  ['--color-danger-fg',  '--color-danger-bg',  '危险徽章/提示', 11, 600],
  ['--color-danger-fg',  '--color-danger-bg-soft', '危险提示条', 13, 400],
  ['--color-success-fg', '--color-success-bg', '成功徽章', 11, 600],
  ['--color-success-fg', '--color-success-bg-soft', '成功提示条', 13, 400],
  ['--color-warning-fg', '--color-warning-bg', '警告徽章', 11, 600],
  ['--color-warning-fg', '--color-warning-bg-soft', '警告提示条', 13, 400],
  ['--color-info-fg',    '--color-info-bg',    '信息徽章 / 提示条', 11, 600],

  // 实底按钮与色块
  ['--slate-0', '--color-danger',  '危险按钮白字', 12, 600],
  ['--slate-0', '--color-action-accent', '强调按钮白字', 13, 600],
  ['--slate-0', '--slate-800', '深色块白字', 12, 600],

  // 价格与评分
  ['--color-price', '--color-bg-surface', '价格数字（白底）', 17, 700],
  ['--color-price', '--color-bg-canvas',  '价格数字（页底）', 17, 700],
  ['--color-rating', '--color-bg-surface', '星级评分（图形，需 3:1）', 0, 0],

  // 边框与分隔（非文本，需 3:1）
  ['--color-border-interactive', '--color-bg-surface', '表单控件边界（非文本 3:1）', 0, 0],
];

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

console.log('\n================ WCAG 2.1 对比度审计 ================\n');
console.log('令牌组合'.padEnd(30) + '场景'.padEnd(22) + '对比度'.padStart(8) + '  阈值  结果');
console.log('-'.repeat(84));

let pass = 0, fail = 0;
const failures = [];
const rows = [];

for (const [fgName, bgName, label, fs, fw] of PAIRS) {
  const bgRaw = parseColor(literal(bgName));
  const fgRaw = parseColor(literal(fgName));
  if (!fgRaw || !bgRaw) { console.log(`  ?? 无法解析 ${fgName} / ${bgName}`); continue; }
  const bg = bgRaw.a < 1 ? over(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
  const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;

  const r = ratio(fg, bg);
  const isLarge = fs === 0 ? false : (fs >= 24) || (fs >= 18.66 && fw >= 700);
  const need = fs === 0 ? AA_LARGE : (isLarge ? AA_LARGE : AA_NORMAL);
  const ok = r >= need;
  ok ? pass++ : fail++;
  const key = `${fgName.replace('--', '')} on ${bgName.replace('--', '')}`;
  if (!ok) failures.push({ key, label, r, need });
  rows.push({
    fg: fgName, bg: bgName, fgHex: literal(fgName), bgHex: literal(bgName), label,
    ratio: Number(r.toFixed(2)), need, large: isLarge, pass: ok,
  });
  console.log(
    key.padEnd(30) + label.padEnd(22) + r.toFixed(2).padStart(8) +
    `  ≥${need.toFixed(1)}  ` + (ok ? '✅ 通过' : '❌ 不达标')
  );
}

// 导出审计结果供规范页实时渲染（唯一真源：tokens.css）
fs.writeFileSync(
  path.join(APP, 'public/design-system/contrast.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), standard: 'WCAG 2.1 AA', total: rows.length, pass, fail, rows }, null, 2),
  'utf8'
);

console.log('-'.repeat(84));
console.log(`\n合计：通过 ${pass} 项，不达标 ${fail} 项`);
if (failures.length) {
  console.log('\n不达标明细与建议：');
  failures.forEach((f) => console.log(`  · ${f.key}（${f.label}）实测 ${f.r.toFixed(2)}，需 ≥${f.need} —— 建议加深前景色或提亮背景色`));
}
console.log('');
process.exit(fail ? 1 : 0);
