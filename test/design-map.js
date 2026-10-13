// 列出所有"属性 → 硬编码值"组合，作为令牌映射表的编写依据
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

// 先把 var(...) 挖掉，只留字面量
const noVars = css.replace(/var\([^()]*\)/g, '§');
const decls = [...noVars.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)];

const colors = new Map(), sizes = new Map(), spaces = new Map(), radii = new Map(), others = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

for (const d of decls) {
  const prop = d[1].trim();
  const val = d[2].trim();
  if (!val || val.includes('§')) continue;

  if (/(^|-)color$/.test(prop) || prop === 'box-shadow' || prop === 'background' || prop === 'fill' || prop === 'outline') {
    if (/#[0-9a-fA-F]{3,8}|rgba?\(|\bwhite\b|\bblack\b/.test(val)) bump(colors, `${prop} → ${val}`);
  }
  if (prop === 'font-size') bump(sizes, `${prop} → ${val}`);
  if (prop === 'border-radius') bump(radii, `${prop} → ${val}`);
  if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) bump(spaces, `${prop} → ${val}`);
  if (['font-weight', 'line-height', 'transition', 'z-index', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'outline'].includes(prop)) {
    if (/\d/.test(val)) bump(others, `${prop} → ${val}`);
  }
}

const show = (title, m) => {
  console.log(`\n===== ${title}（${m.size} 种）=====`);
  [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}×  ${k}`));
};
show('颜色类声明', colors);
show('字号', sizes);
show('圆角', radii);
show('间距', spaces);
show('其他数值型声明', others);
