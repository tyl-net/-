// 卖家：发布闲置 / 我的商品
import { api, session } from '../api.js';
import {
  h, yuan, timeAgo, toast, cover, badge, empty, loading, confirmDialog, formDialog, modal,
  imagePicker, parseImages, MAX_PICK_IMAGES,
} from '../ui.js';
import { go, META } from '../app.js';

// ---------------- 发布闲置 ----------------
export async function renderPublish(root) {
  const me = session.user;
  const form = h('div', { class: 'form' });
  const t = (p) => h('input', { type: 'text', placeholder: p });
  const title = t('例如：《软件工程》张海藩 第5版 教材');
  const price = h('input', { type: 'number', placeholder: '0.00', step: '0.01', min: '0.01' });
  const category = h('select', {}, ...META.categories.map((c) => h('option', { value: c, text: c })));
  const quality = h('select', {}, ...META.qualities.map((c) => h('option', { value: c, text: c })));
  const desc = h('textarea', { rows: 5, placeholder: '描述商品成色、使用情况、瑕疵、交易方式等，不少于 10 个字效果更好' });
  const picker = imagePicker({ max: MAX_PICK_IMAGES });
  const submit = h('button', { class: 'btn btn-primary', style: { padding: 'var(--space-10) var(--space-28)' }, text: '提交发布' });

  form.append(
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '商品名称', h('i', { class: 'req', text: '*' })), title),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-14)' } },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, '类别', h('i', { class: 'req', text: '*' })), category),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, '出售价格（元）', h('i', { class: 'req', text: '*' })), price),
      h('label', { class: 'field' }, h('span', { class: 'field-label', text: '成色' }), quality)
    ),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '商品描述', h('i', { class: 'req', text: '*' })), desc,
      h('span', { class: 'field-hint', text: '支持 ```js 代码块：买家可在商品详情页的在线编辑器中修改并运行 JavaScript 代码' })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '商品图片' }),
      picker.el,
      h('span', { class: 'field-hint', text: '点击「上传图片」从本地选择，最多 3 张、第一张作为封面；也可留空，系统将按类别生成默认封面图' })
    ),
    h('div', { class: 'flex-gap' }, submit, h('button', { class: 'btn btn-ghost', text: '清空', onClick: () => { title.value = ''; price.value = ''; desc.value = ''; picker.setImages([]); } }))
  );

  const notice = me.is_verified === 1
    ? h('div', { class: 'notice notice-ok' }, h('span', { text: '✔' }), h('span', { text: '已完成实名认证，可以发布商品；发布后需管理员审核通过才会展示在集市中。' }))
    : h('div', { class: 'notice' }, h('span', { text: '⚠️' }), h('span', { text: '你还未完成实名认证，请先前往「个人中心」提交实名信息。' }),
        h('button', { class: 'btn btn-ghost btn-sm', text: '去认证', onClick: () => go('#/profile') }));

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title', text: '发布闲置' }), h('p', { class: 'page-desc', text: '填写商品信息后提交，管理员审核通过即上架展示' }))),
    notice,
    h('div', { class: 'card mt-16', style: { maxWidth: '820px' } }, form)
  );

  if (me.is_verified !== 1) submit.disabled = true;

  submit.onclick = async () => {
    if (title.value.trim().length < 2) return toast('请填写商品名称（至少 2 个字）', 'error');
    if (!(Number(price.value) > 0)) return toast('请填写正确的价格', 'error');
    if (desc.value.trim().length < 4) return toast('请填写商品描述', 'error');
    submit.disabled = true; submit.textContent = '提交中…';
    try {
      await api.post('/api/goods', {
        title: title.value.trim(), category: category.value, price: Number(price.value),
        quality: quality.value, description: desc.value.trim(),
        images: picker.getImages(),
      });
      toast('发布成功，等待管理员审核', 'success');
      go('#/my-goods');
    } catch (e) {
      toast(e.message, 'error');
      submit.disabled = false; submit.textContent = '提交发布';
    }
  };
}

// ---------------- 我的商品 ----------------
export async function renderMine(root) {
  let filter = '';
  const tabsBox = h('div', { class: 'tabs' });
  const listBox = h('div', {}, loading());

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title', text: '我的商品' }), h('p', { class: 'page-desc', text: '管理你发布的闲置商品，可编辑、下架或重新上架' })),
      h('button', { class: 'btn btn-primary', text: '＋ 发布闲置', onClick: () => go('#/publish') })
    ),
    tabsBox, listBox
  );

  const TABS = [
    { k: '', label: '全部' },
    { k: '1', label: '已通过' },
    { k: '0', label: '待审核' },
    { k: '2', label: '已驳回' },
  ];

  function drawTabs(counts = {}) {
    tabsBox.replaceChildren(...TABS.map((t) =>
      h('button', { class: filter === t.k ? 'active' : '', onClick: () => { filter = t.k; load(); } },
        t.label, counts[t.k] ? h('span', { class: 'tab-count', text: String(counts[t.k]) }) : null)
    ));
  }

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const d = await api.get('/api/goods/mine' + (filter !== '' ? '?audit_status=' + filter : ''));
      const all = await api.get('/api/goods/mine');
      const counts = { '0': 0, '1': 0, '2': 0 };
      all.list.forEach((g) => { counts[String(g.audit_status)] = (counts[String(g.audit_status)] || 0) + 1; });
      drawTabs(counts);

      if (!d.list.length) {
        listBox.replaceChildren(h('div', { class: 'card' }, empty('这里还没有商品', '点击右上角「发布闲置」卖出一件吧')));
        return;
      }
      listBox.replaceChildren(h('div', {}, ...d.list.map(goodsRow)));
    } catch (e) {
      listBox.replaceChildren(h('div', { class: 'card' }, h('p', { text: '加载失败：' + e.message })));
    }
  }

  function goodsRow(g) {
    const auditBadge = badge(['待审核', '审核通过', '审核驳回'][g.audit_status], ['badge-warn', 'badge-ok', 'badge-danger'][g.audit_status]);
    const statusBadge = g.goods_status === 2 ? badge('已售出', 'badge-muted') : g.goods_status === 0 ? badge('已下架', 'badge-muted') : badge('在售', 'badge-info');
    const imgCount = parseImages(g.images).length;
    const actions = h('div', { class: 'td-actions' });
    if (g.goods_status !== 2) {
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '编辑', onClick: () => editGoods(g, load) }));
      if (g.goods_status === 1) actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '下架', onClick: () => act(`/api/goods/${g.goods_id}/offline`, '已下架', load) }));
      else actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '重新上架', onClick: () => act(`/api/goods/${g.goods_id}/online`, '已重新上架', load) }));
    }
    actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '预览', onClick: () => go('#/goods/' + g.goods_id) }));
    actions.append(h('button', { class: 'btn btn-danger btn-sm', text: '删除', onClick: () => removeGoods(g, load) }));

    return h('div', { class: 'card', style: { padding: 'var(--space-14)', display: 'flex', gap: 'var(--space-14)', alignItems: 'center', flexWrap: 'wrap' } },
      h('div', { style: { width: '88px', height: '88px', borderRadius: 'var(--radius-12)', overflow: 'hidden', flexShrink: '0', border: '1px solid var(--line)' } }, cover(g, { height: 88 })),
      h('div', { class: 'grow', style: { minWidth: '200px' } },
        h('div', { class: 'flex-gap', style: { marginBottom: 'var(--space-6)', flexWrap: 'wrap' } }, auditBadge, statusBadge,
          h('span', { class: 'badge badge-muted', text: g.category }),
          imgCount ? h('span', { class: 'badge badge-info', text: `${imgCount} 张图` }) : null),
        h('div', { style: { fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-md)' } }, g.title),
        h('div', { class: 'price', style: { marginTop: 'var(--space-4)' } }, h('small', { text: '¥' }), String(Number(g.price).toFixed(2))),
        g.audit_status === 2 && g.audit_remark ? h('div', { class: 'small', style: { color: 'var(--danger)', marginTop: 'var(--space-6)' } }, '驳回原因：', g.audit_remark) : null
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div', { class: 'small muted', text: `浏览 ${g.view_count} · ${timeAgo(g.created_at)}` }),
        g.active_orders ? h('div', { class: 'small', style: { color: 'var(--accent)' }, text: `有 ${g.active_orders} 笔进行中订单` }) : null,
        h('div', { class: 'mt-8' }, actions)
      )
    );
  }

  /** 删除商品：存在进行中订单时不允许删除，其余情况软删除 */
  async function removeGoods(g, reload) {
    if (g.active_orders) {
      toast(`该商品还有 ${g.active_orders} 笔进行中的订单，请先完成或取消订单后再删除`, 'error');
      return;
    }
    const extra = g.total_orders
      ? `\n\n该商品已有 ${g.total_orders} 笔历史交易记录，删除后商品将从集市移除，但历史订单与评价会保留。`
      : '';
    const okc = await confirmDialog(
      `确认删除「${g.title}」？删除后该商品将从集市与「我的商品」中移除，操作不可撤销。${extra}`,
      { title: '删除商品', okText: '确认删除', danger: true }
    );
    if (!okc) return;
    try {
      await api.del('/api/goods/' + g.goods_id);
      toast('商品已删除', 'success');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  load();
}

async function act(path, msg, reload) {
  try { await api.put(path, {}); toast(msg, 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}

export async function editGoods(g, reload) {
  const d = await formDialog({
    title: '编辑商品',
    okText: '保存并重新送审',
    width: 560,
    values: g,
    fields: [
      { name: 'title', label: '商品名称', required: true, value: g.title },
      { name: 'category', label: '类别', type: 'select', required: true, value: g.category, options: META.categories.map((c) => ({ value: c, label: c })) },
      { name: 'price', label: '价格（元）', type: 'number', required: true, value: g.price },
      { name: 'quality', label: '成色', type: 'select', value: g.quality, options: META.qualities.map((c) => ({ value: c, label: c })) },
      { name: 'description', label: '商品描述', type: 'textarea', required: true, value: g.description },
      {
        name: 'images', label: '商品图片', type: 'images', max: MAX_PICK_IMAGES,
        value: parseImages(g.images),
        hint: '可增删图片，最多 3 张、第一张作为封面；全部删除后系统将按类别生成默认封面图',
      },
    ],
  });
  if (!d) return;
  try {
    await api.put('/api/goods/' + g.goods_id, d);
    toast('修改成功，已重新提交审核', 'success');
    reload();
  } catch (e) { toast(e.message, 'error'); }
}
