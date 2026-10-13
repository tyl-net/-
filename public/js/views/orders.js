// 我的订单（买家 / 卖家双视角）
import { api, session } from '../api.js';
import { h, yuan, fmtTime, toast, cover, badge, empty, loading, confirmDialog, formDialog, modal } from '../ui.js';
import { go, META } from '../app.js';

const ORDER_BADGE = ['badge-warn', 'badge-info', 'badge-info', 'badge-ok', 'badge-muted'];

export async function render(root) {
  let role = 'buyer';
  let status = '';
  const tabsBox = h('div', { class: 'tabs' });
  const statusBox = h('div', { class: 'chips' });
  const listBox = h('div', {}, loading());

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title', text: '我的订单' }), h('p', { class: 'page-desc', text: '跟踪交易进度：待支付 → 待发货 → 待收货 → 已完成' }))
    ),
    h('div', { class: 'card' },
      tabsBox, statusBox, listBox
    )
  );

  function drawTabs() {
    tabsBox.replaceChildren(
      h('button', { class: role === 'buyer' ? 'active' : '', text: '🛒 我买到的', onClick: () => { role = 'buyer'; drawTabs(); load(); } }),
      h('button', { class: role === 'seller' ? 'active' : '', text: '📦 我卖出的', onClick: () => { role = 'seller'; drawTabs(); load(); } })
    );
  }
  function drawStatus() {
    statusBox.replaceChildren(
      h('div', { class: `chip ${status === '' ? 'active' : ''}`, text: '全部', onClick: () => { status = ''; drawStatus(); load(); } }),
      ...META.orderStatus.map((s, i) =>
        h('div', { class: `chip ${String(status) === String(i) ? 'active' : ''}`, text: s, onClick: () => { status = i; drawStatus(); load(); } })
      )
    );
  }

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const d = await api.get(`/api/order?role=${role}${status !== '' ? '&status=' + status : ''}`);
      if (!d.list.length) {
        listBox.replaceChildren(empty(role === 'buyer' ? '还没有买到的订单' : '还没有卖出的订单', role === 'buyer' ? '去集市逛逛，找到心仪的闲置吧' : '发布闲置，等待买家下单'));
        return;
      }
      listBox.replaceChildren(...d.list.map(orderCard));
    } catch (e) {
      listBox.replaceChildren(h('p', { text: '加载失败：' + e.message }));
    }
  }

  function orderCard(o) {
    const actions = h('div', { class: 'order-actions' });
    if (role === 'buyer') {
      if (o.order_status === 0) {
        actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '去支付', onClick: () => payOrder(o, load) }));
        actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '取消订单', onClick: () => cancelOrder(o, load) }));
      } else if (o.order_status === 1) {
        actions.append(h('span', { class: 'small muted', text: '等待卖家发货' }));
        actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '取消订单', onClick: () => cancelOrder(o, load) }));
      } else if (o.order_status === 2) {
        actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '确认收货', onClick: () => confirmOrder(o, load) }));
      } else if (o.order_status === 3 && !o.reviewed) {
        actions.append(h('button', { class: 'btn btn-accent btn-sm', text: '评价交易', onClick: () => reviewOrder(o, load) }));
      } else if (o.order_status === 3 && o.reviewed) {
        actions.append(h('span', { class: 'badge badge-ok', text: '已评价' }));
      }
    } else {
      if (o.order_status === 0) {
        actions.append(h('span', { class: 'small muted', text: '等待买家支付' }));
        actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '取消订单', onClick: () => cancelOrder(o, load) }));
      } else if (o.order_status === 1) {
        actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '立即发货', onClick: () => shipOrder(o, load) }));
      } else if (o.order_status === 2) {
        actions.append(h('span', { class: 'badge badge-info', text: '已发货，待买家确认' }));
      }
    }
    actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '商品详情', onClick: () => go('#/goods/' + o.goods_id) }));

    const flow = ['待支付', '待发货', '待收货', '已完成', '已取消'][o.order_status];
    return h('div', { class: 'order-card' },
      h('div', { class: 'order-head' },
        badge(flow, ORDER_BADGE[o.order_status]),
        h('span', { class: 'order-no', text: '订单号 ' + o.order_no }),
        h('span', { style: { marginLeft: 'auto' }, text: '下单 ' + fmtTime(o.created_at) })
      ),
      h('div', { class: 'order-body' },
        h('div', { class: 'order-thumb' }, cover({ title: o.goods_title, images: o.goods_images, category: o.goods_category }, { height: 76 })),
        h('div', { class: 'order-main' },
          h('div', { style: { fontWeight: '600', marginBottom: 'var(--space-4)' } }, o.goods_title),
          h('div', { class: 'small muted' },
            role === 'buyer' ? '卖家：' + o.seller_name : '买家：' + o.buyer_name,
            ' · ', o.goods_category),
          h('div', { class: 'price', style: { marginTop: 'var(--space-6)' } }, h('small', { text: '¥' }), String(Number(o.amount).toFixed(2))),
          o.pay_time ? h('div', { class: 'small muted', text: `支付时间 ${fmtTime(o.pay_time)}` }) : null,
          o.finish_time ? h('div', { class: 'small muted', text: `完成时间 ${fmtTime(o.finish_time)}` }) : null
        ),
        actions
      )
    );
  }

  drawTabs(); drawStatus(); load();
}

async function payOrder(o, reload) {
  const okc = await confirmDialog(`本次支付 ${yuan(o.amount)}，货款将由平台托管，确认收货后结算给卖家。\n\n（演示环境：点击确定即模拟微信支付成功）`, { title: '模拟微信支付', okText: '确认支付' });
  if (!okc) return;
  try { await api.post('/api/order/pay', { order_id: o.order_id }); toast('支付成功，货款已托管', 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}
async function shipOrder(o, reload) {
  const okc = await confirmDialog(`确认已发出「${o.goods_title}」？\n发货后请提醒买家及时确认收货。`, { title: '确认发货', okText: '确认发货' });
  if (!okc) return;
  try { await api.put('/api/order/ship', { order_id: o.order_id }); toast('已发货', 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}
async function confirmOrder(o, reload) {
  const okc = await confirmDialog(`确认已收到「${o.goods_title}」？\n确认后平台将把 ${yuan(o.amount)} 结算给卖家，操作不可撤销。`, { title: '确认收货', okText: '确认收货' });
  if (!okc) return;
  try { await api.put('/api/order/confirm', { order_id: o.order_id }); toast('确认收货成功，货款已结算', 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}
async function cancelOrder(o, reload) {
  const okc = await confirmDialog('确认取消该订单？取消后不可恢复。', { title: '取消订单', okText: '确认取消', danger: true });
  if (!okc) return;
  try { await api.put('/api/order/cancel', { order_id: o.order_id }); toast('订单已取消', 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}
async function reviewOrder(o, reload) {
  const d = await formDialog({
    title: '评价本次交易',
    okText: '发表评价',
    fields: [
      { name: 'score', label: '交易评分', type: 'select', required: true, value: '5', options: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: '★'.repeat(n) + '☆'.repeat(5 - n) + `（${n} 分）` })) },
      { name: 'content', label: '评价内容', type: 'textarea', required: true, placeholder: '描述商品是否与描述一致、卖家的服务态度等' },
    ],
  });
  if (!d) return;
  try {
    await api.post('/api/review', { order_id: o.order_id, score: Number(d.score), content: d.content });
    toast('评价发表成功，感谢你的反馈', 'success');
    reload();
  } catch (e) { toast(e.message, 'error'); }
}
