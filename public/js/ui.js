// UI 基础工具：元素创建、转义、提示、弹窗、格式化、封面渲染
export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
};

/** 防 XSS：所有用户可控文本必须经此转义 */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const yuan = (n) => '¥' + Number(n || 0).toFixed(2);

export const timeAgo = (t) => {
  if (!t) return '';
  const d = new Date(String(t).replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
  return String(t).slice(0, 10);
};

export const fmtTime = (t) => (t ? String(t).slice(0, 16) : '—');

// ---------- 提示 ----------
export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const icons = { info: 'ℹ️', success: '✅', error: '⚠️' };
  const el = h('div', { class: `toast toast-${type}` },
    h('span', { class: 'toast-icon', text: icons[type] || 'ℹ️' }),
    h('span', { text: message })
  );
  root.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}

// ---------- 弹窗 ----------
export function modal({ title, body, footer, width = 520, onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => { mask.classList.add('out'); setTimeout(() => { mask.remove(); onClose && onClose(); }, 180); };
  const dialog = h('div', { class: 'modal', style: { maxWidth: width + 'px' } },
    h('div', { class: 'modal-head' },
      h('h3', { text: title }),
      h('button', { class: 'icon-btn', title: '关闭', onClick: close, html: '&times;' })
    ),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null
  );
  const mask = h('div', { class: 'modal-mask', onClick: (e) => { if (e.target === mask) close(); } }, dialog);
  root.append(mask);
  requestAnimationFrame(() => mask.classList.add('in'));
  return { close };
}

export function confirmDialog(message, { title = '请确认', okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    const okBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okText });
    const cancelBtn = h('button', { class: 'btn btn-ghost', text: '取消' });
    const m = modal({
      title, body: h('p', { class: 'confirm-text', text: message }),
      footer: [cancelBtn, okBtn], width: 420,
      onClose: () => resolve(false),
    });
    let done = false;
    okBtn.onclick = () => { done = true; m.close(); resolve(true); };
    cancelBtn.onclick = () => { done = true; m.close(); resolve(false); };
  });
}

/** 表单弹窗：fields 描述 → 返回 Promise<数据|null> */
export function formDialog({ title, fields, okText = '提交', width = 520, values = {} }) {
  return new Promise((resolve) => {
    const inputs = {};
    const body = h('div', { class: 'form' });
    fields.forEach((f) => {
      let input;
      const val = values[f.name] ?? f.value ?? '';
      if (f.type === 'textarea') {
        input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = val;
      } else if (f.type === 'select') {
        input = h('select', {});
        f.options.forEach((o) => {
          const opt = h('option', { value: o.value, text: o.label });
          if (String(o.value) === String(val)) opt.selected = true;
          input.append(opt);
        });
      } else if (f.type === 'images') {
        // 图片选择器：getImages() 返回 data URI 数组
        input = imagePicker({ value: val, max: f.max || MAX_PICK_IMAGES });
      } else {
        input = h('input', { type: f.type || 'text', placeholder: f.placeholder || '' });
        input.value = val;
      }
      inputs[f.name] = input;
      body.append(h('label', { class: 'field' },
        h('span', { class: 'field-label' }, f.label, f.required ? h('i', { class: 'req', text: '*' }) : null),
        input.el || input,
        f.hint ? h('span', { class: 'field-hint', text: f.hint }) : null
      ));
    });
    const okBtn = h('button', { class: 'btn btn-primary', text: okText });
    const cancelBtn = h('button', { class: 'btn btn-ghost', text: '取消' });
    const m = modal({ title, body, footer: [cancelBtn, okBtn], width, onClose: () => resolve(null) });
    cancelBtn.onclick = () => m.close();
    okBtn.onclick = () => {
      const data = {};
      for (const f of fields) {
        let v;
        if (f.type === 'images') {
          v = inputs[f.name].getImages();
        } else {
          v = inputs[f.name].value;
          if (f.type === 'number') v = v === '' ? '' : Number(v);
        }
        if (f.required && (v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0))) {
          toast(`请填写「${f.label}」`, 'error');
          if (!f.type || f.type !== 'images') inputs[f.name].focus();
          return;
        }
        data[f.name] = v;
      }
      m.close();
      resolve(data);
    };
  });
}

// ---------- 商品封面 ----------
// 品类表达色一律引用 --viz-* 令牌（见 design-system/tokens.css），不在此处写裸色值
const CATEGORY_STYLE = {
  教材书籍: { icon: '📚', from: 'var(--viz-book-1)', to: 'var(--viz-book-2)' },
  电子数码: { icon: '💻', from: 'var(--viz-digital-1)', to: 'var(--viz-digital-2)' },
  生活用品: { icon: '🧺', from: 'var(--viz-life-1)', to: 'var(--viz-life-2)' },
  体育运动: { icon: '⚽', from: 'var(--viz-sport-1)', to: 'var(--viz-sport-2)' },
  服饰美妆: { icon: '👗', from: 'var(--viz-fashion-1)', to: 'var(--viz-fashion-2)' },
  其他: { icon: '📦', from: 'var(--viz-other-1)', to: 'var(--viz-other-2)' },
};

/** 容错解析 images 字段：接口返回数组、数据库存 JSON 数组字符串、历史逗号分隔均可 */
export function parseImages(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch { /* 落到逗号分隔兜底 */ }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function cover(goods, { height = 150, big = false } = {}) {
  const st = CATEGORY_STYLE[goods.category] || CATEGORY_STYLE['其他'];
  const first = parseImages(goods.images)[0];
  if (first) {
    return h('div', { class: 'cover', style: { height: height + 'px' } },
      h('img', { src: first, alt: goods.title, loading: 'lazy' }));
  }
  return h('div', {
    class: 'cover cover-art',
    style: { height: height + 'px', background: `linear-gradient(135deg, ${st.from}, ${st.to})` },
  },
    h('span', { class: 'cover-icon', style: { fontSize: (big ? 66 : 44) + 'px' }, text: st.icon }),
    h('span', { class: 'cover-cat', text: goods.category })
  );
}

/** 把用户选择的图片压缩为 data URI（最长边 ≤ 900px，JPEG 质量 0.72），控制体积 */
export const MAX_PICK_IMAGES = 3;

function compressImage(file, { maxSide = 900, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('请选择图片文件'));
    if (file.size > 8 * 1024 * 1024) return reject(new Error(`「${file.name}」超过 8MB，请先压缩`));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`「${file.name}」不是有效图片`));
      img.onload = () => {
        let { width: w, height: hgt } = img;
        const scale = Math.min(1, maxSide / Math.max(w, hgt));
        w = Math.max(1, Math.round(w * scale));
        hgt = Math.max(1, Math.round(hgt * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hgt;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, hgt);
        ctx.drawImage(img, 0, 0, w, hgt);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 商品图片选择器：本地预览 + 客户端压缩 + 增删。
 * 返回 { el, getImages() }，图片以 data URI 数组形式随商品一起提交。
 */
export function imagePicker({ value = [], max = MAX_PICK_IMAGES } = {}) {
  let images = parseImages(value);
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, style: { display: 'none' } });
  const grid = h('div', { class: 'img-grid' });
  const addTile = h('div', { class: 'img-add', title: '添加图片' },
    h('span', { class: 'img-add-icon', text: '＋' }),
    h('span', { class: 'img-add-text', text: '上传图片' })
  );
  const counter = h('div', { class: 'img-counter' });
  const root = h('div', { class: 'img-picker' }, grid, fileInput, counter);

  const render = () => {
    grid.replaceChildren(
      ...images.map((src, i) =>
        h('div', { class: 'img-cell' },
          h('img', { src, alt: `商品图片 ${i + 1}` }),
          h('button', {
            type: 'button', class: 'img-del', title: '移除该图',
            text: '×',
            onClick: () => { images.splice(i, 1); render(); },
          }),
          i === 0 ? h('span', { class: 'img-cover-tag', text: '封面' }) : null
        )
      ),
      images.length < max ? addTile : null
    );
    counter.textContent = `已上传 ${images.length}/${max} 张${images.length ? '（第一张作为封面）' : ''}`;
  };

  addTile.onclick = () => fileInput.click();
  root.addEventListener('click', (e) => { if (e.target === root) fileInput.click(); });

  fileInput.onchange = async () => {
    const files = [...(fileInput.files || [])];
    fileInput.value = '';
    if (!files.length) return;
    const room = max - images.length;
    if (files.length > room) toast(`最多上传 ${max} 张图片，本次仅添加前 ${room} 张`, 'error');
    const picking = files.slice(0, room);
    addTile.classList.add('loading');
    for (const f of picking) {
      try {
        images.push(await compressImage(f));
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    addTile.classList.remove('loading');
    render();
  };

  render();
  return { el: root, getImages: () => images.slice(), setImages: (v) => { images = parseImages(v); render(); } };
}


export const categoryIcon = (c) => (CATEGORY_STYLE[c] || CATEGORY_STYLE['其他']).icon;

// ---------- 状态徽章 ----------
export const AUDIT_BADGE = ['badge-warn', 'badge-ok', 'badge-danger'];
export const ORDER_BADGE = ['badge-warn', 'badge-info', 'badge-info', 'badge-ok', 'badge-muted'];

export function badge(text, cls) {
  return h('span', { class: `badge ${cls || ''}`, text });
}

export function empty(text = '暂无数据', hint = '') {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon', text: '🗂️' }),
    h('p', { class: 'empty-text', text }),
    hint ? h('p', { class: 'empty-hint', text: hint }) : null
  );
}

export function stars(score) {
  const s = Math.max(0, Math.min(5, Math.round(Number(score) || 0)));
  return h('span', { class: 'stars', html: '★'.repeat(s) + '<span class="star-off">' + '★'.repeat(5 - s) + '</span>' });
}

export function avatar(name, size = 36) {
  const n = String(name || '?');
  const palette = ['var(--viz-digital-1)', 'var(--viz-book-1)', 'var(--viz-life-1)', 'var(--viz-sport-1)', 'var(--viz-fashion-1)', 'var(--color-success)', 'var(--orange-600)'];
  let hash = 0;
  for (const ch of n) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return h('span', {
    class: 'avatar',
    style: { width: size + 'px', height: size + 'px', background: palette[hash % palette.length], fontSize: size * 0.42 + 'px' },
    text: n.slice(0, 1),
  });
}

export function loading(text = '加载中…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', { text }));
}
