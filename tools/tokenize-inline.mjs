// 视图内联样式令牌化：把 JS 里 style 对象的静态数值字面量替换为设计令牌引用
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');

const SP = {
  1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-4)', 4: 'var(--space-4)',
  5: 'var(--space-6)', 6: 'var(--space-6)', 7: 'var(--space-8)', 8: 'var(--space-8)',
  9: 'var(--space-10)', 10: 'var(--space-10)', 11: 'var(--space-12)', 12: 'var(--space-12)',
  13: 'var(--space-14)', 14: 'var(--space-14)', 15: 'var(--space-16)', 16: 'var(--space-16)',
  17: 'var(--space-18)', 18: 'var(--space-18)', 19: 'var(--space-20)', 20: 'var(--space-20)',
  21: 'var(--space-22)', 22: 'var(--space-22)', 24: 'var(--space-24)', 28: 'var(--space-28)',
  32: 'var(--space-32)', 34: 'var(--space-32)', 40: 'var(--space-40)', 48: 'var(--space-48)',
  56: 'var(--space-56)', 60: 'var(--space-64)', 64: 'var(--space-64)',
};
const FS = {
  10.5: 'var(--font-size-2xs)', 11: 'var(--font-size-2xs)', 11.5: 'var(--font-size-xs)',
  12: 'var(--font-size-xs)', 12.5: 'var(--font-size-xs)', 13: 'var(--font-size-sm)',
  13.5: 'var(--font-size-md)', 14: 'var(--font-size-md)', 15: 'var(--font-size-lg)',
  16: 'var(--font-size-lg)', 17: 'var(--font-size-xl)', 18: 'var(--font-size-xl)',
  19: 'var(--font-size-2xl)', 20: 'var(--font-size-2xl)', 21: 'var(--font-size-2xl)',
  26: 'var(--font-size-3xl)', 32: 'var(--font-size-4xl)', 40: 'var(--font-size-5xl)',
};
const RADIUS = {
  2: 'var(--radius-2)', 4: 'var(--radius-4)', 7: 'var(--radius-8)', 8: 'var(--radius-8)',
  9: 'var(--radius-8)', 10: 'var(--radius-10)', 11: 'var(--radius-12)', 12: 'var(--radius-12)',
  14: 'var(--radius-14)', 16: 'var(--radius-16)',
};

const SP_PROPS = 'padding|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap';
const tokenizeValue = (value, map) => value.replace(/(-?\d+(?:\.\d+)?)px\b/g, (m, num) => {
  const n = parseFloat(num);
  return map[n] !== undefined ? map[n] : m;
});

const counts = {};
let filesChanged = 0;

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
}

for (const file of walk(path.join(APP, 'public/js'))) {
  if (!file.endsWith('.js')) continue;
  const rel = path.relative(APP, file).replace(/\\/g, '/');
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // 间距：padding / margin / gap 的静态字符串值
  src = src.replace(new RegExp(`\\b(${SP_PROPS})\\s*:\\s*'(-?[\\d.]+px(?:\\s+-?[\\d.]+px){0,3})'`, 'g'),
    (m, prop, value) => {
      const out = tokenizeValue(value, SP);
      if (out !== value) counts[`${prop}: ${value} → ${out}`] = (counts[`${prop}: ${value} → ${out}`] || 0) + 1;
      return `${prop}: '${out}'`;
    });

  // 字号
  src = src.replace(/\bfontSize\s*:\s*'([\d.]+)px'/g, (m, v) => {
    const t = FS[parseFloat(v)];
    if (!t) return m;
    counts[`fontSize: ${v}px → ${t}`] = (counts[`fontSize: ${v}px → ${t}`] || 0) + 1;
    return `fontSize: '${t}'`;
  });

  // 圆角
  src = src.replace(/\bborderRadius\s*:\s*'([\d.]+)px'/g, (m, v) => {
    const t = RADIUS[parseFloat(v)];
    if (!t) return m;
    counts[`borderRadius: ${v}px → ${t}`] = (counts[`borderRadius: ${v}px → ${t}`] || 0) + 1;
    return `borderRadius: '${t}'`;
  });

  if (src !== before) { fs.writeFileSync(file, src, 'utf8'); filesChanged++; }
}

console.log('\n============ 视图内联样式令牌化 ============\n');
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`替换 ${total} 处，涉及 ${filesChanged} 个文件\n`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}×  ${k}`);
}
