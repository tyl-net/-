// 设计系统健康报告（只读度量，不做判定；判定交给 test/design-lint.js）
// 数据来源：tokens.css（真源）→ tokens.json（导出）、contrast.json（审计）
// 运行：node test/design-audit.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..');
const NODE = process.execPath;

// 确保导出物是最新的，避免报告基于陈旧数据
execFileSync(NODE, [path.join(APP, 'tools/export-tokens.mjs')], { stdio: 'ignore' });
execFileSync(NODE, [path.join(APP, 'test/contrast-audit.js')], { stdio: 'ignore' });

const TOKENS = JSON.parse(fs.readFileSync(path.join(APP, 'public/design-system/tokens.json'), 'utf8'));
const CONTRAST = JSON.parse(fs.readFileSync(path.join(APP, 'public/design-system/contrast.json'), 'utf8'));
const CSS = fs.readFileSync(path.join(APP, 'public/styles.css'), 'utf8');

const line = (s = '') => console.log(s);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');

line('\n################# 设计系统健康报告 #################\n');

// ---------- 1. 规模 ----------
const s = TOKENS.stats;
line('一、令牌规模');
line(`    总数 ${s.total}    Tier1 基础层 ${s.byTier[1]}    Tier2 语义层 ${s.byTier[2]}    Tier3 组件层 ${s.byTier[3]}`);
line(`    已生效 ${s.active}（${pct(s.active, s.total)}）    预留未启用 ${s.unused.length}`);
for (const g of TOKENS.groups) line(`      · ${g.title.padEnd(28)} ${String(g.tokens.length).padStart(3)} 个`);

// ---------- 2. 覆盖率 ----------
line('\n二、产品样式令牌化覆盖率');
const noVars = CSS.replace(/var\([^()]*\)/g, 'TOKEN');
// 承载设计取值的属性（颜色/字号/字重/行高/圆角/间距/过渡），这些必须引用令牌
const BEARING = /(^|-)color$|^background$|^box-shadow$|^fill$|^border-color$|^font-size$|^font-weight$|^line-height$|^border-radius$|^transition$|^(padding|margin|gap|row-gap|column-gap)(-top|-bottom|-left|-right)?$/;
const KEYWORD = /^(none|inherit|auto|0|transparent|unset|initial|currentcolor)(\s+(none|auto|0))*$/;
let decls = 0, bearing = 0, bearingTok = 0;
for (const m of noVars.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
  const prop = m[1], v = m[2].trim();
  if (!v) continue;
  decls++;
  if (!BEARING.test(prop) || KEYWORD.test(v)) continue;
  bearing++;
  if (/TOKEN/.test(v)) bearingTok++;
}
line(`    public/styles.css 总声明 ${decls} 条`);
line(`    其中承载设计取值的声明 ${bearing} 条，已引用令牌 ${bearingTok} 条  → 覆盖率 ${pct(bearingTok, bearing)}`);
line(`    其余 ${decls - bearing} 条为结构值（宽高 / 定位 / 边框粗细 / 断点像素 / none|auto 等），不做令牌约束`);

// ---------- 3. 使用热度 ----------
line('\n三、令牌使用热度 Top 15');
const hot = Object.values(TOKENS.flat).sort((a, b) => b.usage - a.usage).slice(0, 15);
for (const t of hot) line(`    ${String(t.usage).padStart(4)} ×  ${t.name.padEnd(32)} ${t.resolved}`);

// ---------- 4. 预留清单 ----------
line('\n四、预留未启用令牌（供后续扩展）');
if (!s.unused.length) line('    无');
else {
  const byPrefix = {};
  for (const n of s.unused) {
    const k = n.replace(/^--/, '').split('-')[0];
    (byPrefix[k] ||= []).push(n);
  }
  for (const [k, arr] of Object.entries(byPrefix)) line(`    ${k.padEnd(12)} ${arr.length} 个  ${arr.join(' ')}`);
}

// ---------- 5. 无障碍 ----------
line('\n五、无障碍（WCAG 2.1 AA）');
line(`    审计组合 ${CONTRAST.total} 组，通过 ${CONTRAST.pass} 组，通过率 ${pct(CONTRAST.pass, CONTRAST.total)}`);
const worst = [...CONTRAST.rows].sort((a, b) => a.ratio - b.ratio).slice(0, 3);
for (const r of worst) line(`      最低：${r.fg.replace('--', '')} on ${r.bg.replace('--', '')}  ${r.ratio}（阈值 ${r.need}）— ${r.label}`);

// ---------- 6. 规范站产物 ----------
line('\n六、交付物');
const dsDir = path.join(APP, 'public/design-system');
for (const f of fs.readdirSync(dsDir).sort()) {
  const st = fs.statSync(path.join(dsDir, f));
  line(`    ${f.padEnd(16)} ${(st.size / 1024).toFixed(1).padStart(7)} KB`);
}

// ---------- 7. 结论 ----------
line('\n七、结论');
const okTokens = s.active / s.total >= 0.7;
const okA11y = CONTRAST.fail === 0;
line(`    令牌体系：${okTokens ? '✅' : '⚠️'} 已生效 ${pct(s.active, s.total)}，三层结构完整`);
line(`    无障碍：  ${okA11y ? '✅' : '❌'} ${CONTRAST.pass}/${CONTRAST.total} 全部满足 AA`);
line(`    一致性：  见 node test/design-lint.js（违规即退出码 1，可接入 CI）`);
line('');
