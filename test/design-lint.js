// 设计规范一致性检查（design lint）
// 断言产品样式与视图中不再出现裸露的设计取值，必须引用设计令牌。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');

const TARGETS = ['public/styles.css'];
const TOKEN_FILE = 'public/design-system/tokens.css';

// 许可证：这些属性不受令牌约束（尺寸/定位/边框粗细等结构值）
const FREE_PROPS = new Set([
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'flex', 'flex-basis',
  'top', 'right', 'bottom', 'left', 'inset', 'border-width', 'border-top-width', 'border-bottom-width',
  'border-left-width', 'border-right-width', 'border', 'border-top', 'border-bottom', 'border-left',
  'border-right', 'outline', 'outline-offset', 'font-size-adjust', 'letter-spacing', 'opacity',
  'transform', 'translate', 'background-size', 'background-position', 'grid-template-columns',
  'aspect-ratio', 'stroke-width', 'tab-size', 'text-underline-offset', 'order', 'z-index',
]);

const errors = [];
const warns = [];
const stats = { declarations: 0, tokenized: 0, allowed: 0 };

function checkCss(rel) {
  const file = path.join(APP, rel);
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  // 去掉 var() 内部内容，只留字面量
  const noVars = raw.replace(/var\([^()]*\)/g, 'TOKEN');

  for (const m of noVars.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    const prop = m[1].trim();
    const value = m[2].trim();
    const line = raw.slice(0, m.index).split('\n').length;
    if (!value || value === 'TOKEN') continue;
    stats.declarations++;

    // 颜色类属性
    if (/(^|-)color$/.test(prop) || prop === 'background' || prop === 'box-shadow' || prop === 'fill' || prop === 'border-color') {
      const bad = value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bwhite\b|\bblack\b/);
      if (bad && bad[0] !== 'transparent') {
        errors.push(`${rel}:${line}  ${prop}: ${value}  → 含裸色值 "${bad[0]}"，应引用 --color-* / --overlay-* / --shadow-* 令牌`);
      } else stats.tokenized++;
      continue;
    }

    if (FREE_PROPS.has(prop)) { stats.allowed++; continue; }

    // 字号
    if (prop === 'font-size') {
      if (value !== 'inherit' && /\d/.test(value)) {
        errors.push(`${rel}:${line}  font-size: ${value}  → 应引用 --font-size-* 令牌`);
      } else stats.tokenized++;
      continue;
    }

    // 圆角
    if (prop === 'border-radius') {
      if (/\d+\s*(px|%)/.test(value)) {
        errors.push(`${rel}:${line}  border-radius: ${value}  → 应引用 --radius-* 令牌`);
      } else stats.tokenized++;
      continue;
    }

    // 间距
    if (/^(padding|margin|gap|row-gap|column-gap)(-top|-bottom|-left|-right)?$/.test(prop)) {
      const stripped = value.replace(/\b(auto|0)\b/g, '').trim();
      if (/\d+\s*(px|em|rem)/.test(stripped)) {
        errors.push(`${rel}:${line}  ${prop}: ${value}  → 应引用 --space-* 令牌`);
      } else stats.tokenized++;
      continue;
    }

    // 字重 / 行高 / 过渡
    if (prop === 'font-weight' && /\d/.test(value)) {
      errors.push(`${rel}:${line}  font-weight: ${value}  → 应引用 --font-weight-* 令牌`);
      continue;
    }
    if (prop === 'line-height' && /[\d.]/.test(value)) {
      errors.push(`${rel}:${line}  line-height: ${value}  → 应引用 --line-height-* 令牌`);
      continue;
    }
    if (prop === 'transition' && /\d/.test(value)) {
      errors.push(`${rel}:${line}  transition: ${value}  → 应引用 --duration-* / --ease-* 令牌`);
      continue;
    }
    stats.tokenized++;
  }
}

// 检查视图内联样式里的裸色与裸尺寸（style 对象与渐变）
function checkInline() {
  const dir = path.join(APP, 'public/js');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const SP_PROPS = 'padding|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap';
  for (const f of walk(dir)) {
    if (!f.endsWith('.js')) continue;
    const rel = path.relative(APP, f).replace(/\\/g, '/');
    if (rel.includes('design-system')) continue;
    const raw = fs.readFileSync(f, 'utf8');
    const lineOf = (i) => raw.slice(0, i).split('\n').length;

    // 颜色
    for (const m of raw.matchAll(/(?:background|color|borderColor|from|to)\s*:\s*['"`]([^'"`]*#[0-9a-fA-F]{3,8}[^'"`]*)['"`]/g)) {
      errors.push(`${rel}:${lineOf(m.index)}  内联样式含裸色值 "${m[1]}"，应引用 --viz-* / --color-* 令牌`);
    }
    // 间距 / 字号 / 圆角（仅静态字符串值；含变量拼接的动态值豁免）
    for (const m of raw.matchAll(new RegExp(`\\b(${SP_PROPS})\\s*:\\s*'([^']*\\d+px[^']*)'`, 'g'))) {
      errors.push(`${rel}:${lineOf(m.index)}  ${m[1]}: '${m[2]}' 含裸尺寸，应引用 --space-* 令牌`);
    }
    for (const m of raw.matchAll(/\bfontSize\s*:\s*'([\d.]+px)'/g)) {
      errors.push(`${rel}:${lineOf(m.index)}  fontSize: '${m[1]}' 含裸字号，应引用 --font-size-* 令牌`);
    }
    for (const m of raw.matchAll(/\bborderRadius\s*:\s*'([\d.]+px)'/g)) {
      errors.push(`${rel}:${lineOf(m.index)}  borderRadius: '${m[1]}' 含裸圆角，应引用 --radius-* 令牌`);
    }
  }
}

checkCss(TARGETS[0]);
checkInline();

console.log('\n============ 设计规范一致性检查 ============\n');
console.log(`扫描声明数：${stats.declarations}`);
console.log(`已令牌化 / 豁免结构值：${stats.tokenized + stats.allowed}`);
console.log(`违规项：${errors.length}\n`);
if (errors.length) {
  console.log('违规明细（最多显示 40 条）：');
  errors.slice(0, 40).forEach((e) => console.log('  ❌ ' + e));
  if (errors.length > 40) console.log(`  … 其余 ${errors.length - 40} 条省略`);
} else {
  console.log('✅ 全部设计取值均已令牌化，无裸值。');
}
if (warns.length) warns.forEach((w) => console.log('  ⚠️ ' + w));
console.log('');
process.exit(errors.length ? 1 : 0);
