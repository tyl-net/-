// 简易 JS 括号平衡扫描：跳过字符串/模板串/注释/正则，报告首个不平衡点
import fs from 'node:fs';
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const stack = [];
let i = 0, line = 1;
const pairs = { ')': '(', ']': '[', '}': '{' };
const open = { '(': '(', '[': '[', '{': '{' };
const pos = (n) => {
  const before = src.slice(0, n).split('\n');
  return before.length + ':' + (before[before.length - 1].length + 1);
};
while (i < src.length) {
  const c = src[i], c2 = src.slice(i, i + 2);
  if (c === '\n') { line++; i++; continue; }
  if (c2 === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
  if (c2 === '/*') { i += 2; while (i < src.length && src.slice(i, i + 2) !== '*/') { if (src[i] === '\n') line++; i++; } i += 2; continue; }
  if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; } i++; continue; }
  if (c === '`') {
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '\n') line++;
      if (src.slice(i, i + 2) === '${') {
        // 递归处理 ${ } 内部：简单起见按深度跳过
        let depth = 1; i += 2;
        while (i < src.length && depth > 0) {
          const ch = src[i];
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          else if (ch === '\n') line++;
          else if (ch === "'" || ch === '"' || ch === '`') {
            const q = ch; i++;
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
          }
          i++;
        }
        continue;
      }
      i++;
    }
    i++; continue;
  }
  if (open[c]) { stack.push({ c, at: pos(i) }); i++; continue; }
  if (pairs[c]) {
    const top = stack.pop();
    if (!top || top.c !== pairs[c]) {
      console.log(`❌ 不匹配：第 ${pos(i)} 处 '${c}'，栈顶为 ${top ? `'${top.c}' (第 ${top.at} 处)` : '空'}`);
      process.exit(1);
    }
    i++; continue;
  }
  i++;
}
if (stack.length) {
  console.log('❌ 未闭合：', stack.map((s) => `'${s.c}' @ ${s.at}`).join(', '));
  process.exit(1);
}
console.log('✅ 括号平衡');
