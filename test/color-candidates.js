// 从候选色中为每个不达标组合挑选满足 WCAG 阈值的最优解（保留品牌色调，只调深度）
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const lum = ({ r, g, b }) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const la = lum(hex(a)), lb = lum(hex(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const W = '#ffffff', CANVAS = '#f5f7fa';

console.log('\n============ 色彩修正候选评估（保留色相，仅调明度）============\n');

const groups = [
  {
    name: '① 三级文本 tertiary（用于元信息、说明文字）· 目标 ≥4.5（白底与页底）',
    cands: ['#8a94a6', '#7c8798', '#75808f', '#6f7a8b', '#6b7686', '#66707f', '#5f6979'],
  },
  {
    name: '② 主按钮底色（白字）· 目标 ≥4.5',
    cands: ['#0e9f8e', '#0b8174', '#0a7268', '#096a5f', '#086055'],
  },
  {
    name: '③ 强调文字 / 链接（青底浅色 teal-50 #e6f6f4 之上）· 目标 ≥4.5',
    cands: ['#0e9f8e', '#0b8174', '#0a7268', '#096a5f'],
  },
  {
    name: '④ 信息色 info（浅蓝底 blue-50 #eaf1fe 之上）· 目标 ≥4.5',
    cands: ['#3b6fd4', '#3566c9', '#2f5cb8', '#2a53a8'],
  },
  {
    name: '⑤ 危险按钮底色（白字）· 目标 ≥4.5',
    cands: ['#e5484d', '#cf3b40', '#c0343a', '#b42318'],
  },
  {
    name: '⑥ 强调/次要动作按钮底色（白字）· 目标 ≥4.5',
    cands: ['#f2994a', '#e0862f', '#d97706', '#c2410c', '#b45309', '#a34700'],
  },
  {
    name: '⑦ 价格数字（白底）· 目标 ≥4.5',
    cands: ['#e5484d', '#cf3b40', '#c0343a', '#b42318', '#a81f24'],
  },
  {
    name: '⑧ 星级评分（白底，图形元素）· 目标 ≥3.0',
    cands: ['#ffb400', '#e8a300', '#d99a00', '#c98a00', '#bf8200', '#b37800'],
  },
  {
    name: '⑨ 表单控件边框（白底，UI 边界）· 目标 ≥3.0',
    cands: ['#dde3ea', '#c4ccd8', '#b4bdc9', '#a3adbc', '#98a3b3', '#8a94a6'],
  },
];

for (const g of groups) {
  console.log(g.name);
  for (const c of g.cands) {
    const onWhite = ratio(c, W);
    const onCanvas = ratio(c, CANVAS);
    const onTealSoft = ratio(c, '#e6f6f4');
    const onBlueSoft = ratio(c, '#eaf1fe');
    // 白字在该色上的对比度（用于实底按钮）
    const whiteOn = ratio('#ffffff', c);
    const markWhite = g.name.includes('按钮底色') ? (whiteOn >= 4.5 ? ' ✅' : '  ') : '';
    console.log(
      `   ${c}  白底 ${onWhite.toFixed(2).padStart(5)}  页底 ${onCanvas.toFixed(2).padStart(5)}` +
      `  青浅底 ${onTealSoft.toFixed(2).padStart(5)}  蓝浅底 ${onBlueSoft.toFixed(2).padStart(5)}` +
      `  |  白字置其上 ${whiteOn.toFixed(2).padStart(5)}${markWhite}`
    );
  }
  console.log('');
}
