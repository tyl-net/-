// 评价中心：我发出的评价 / 我收到的评价（含卖家回复）
import { api } from '../api.js';
import { h, toast, badge, empty, loading, stars, avatar, timeAgo, formDialog, confirmDialog } from '../ui.js';
import { go } from '../app.js';

export async function render(root) {
  let role = 'written';
  const tabsBox = h('div', { class: 'tabs' });
  const body = h('div', {}, loading());

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title', text: '评价中心' }), h('p', { class: 'page-desc', text: '查看你发出的评价，或回复买家对你的评价；评分将累积为信用分' }))),
    h('div', { class: 'card' }, tabsBox, body)
  );

  function drawTabs() {
    tabsBox.replaceChildren(
      h('button', { class: role === 'written' ? 'active' : '', text: '✍️ 我发出的', onClick: () => { role = 'written'; drawTabs(); load(); } }),
      h('button', { class: role === 'received' ? 'active' : '', text: '📥 我收到的', onClick: () => { role = 'received'; drawTabs(); load(); } })
    );
  }

  async function load() {
    body.replaceChildren(loading());
    try {
      const d = await api.get('/api/review/mine?role=' + role);
      const head = role === 'written' && d.pending
        ? h('div', { class: 'notice', style: { marginBottom: 'var(--space-14)' } }, h('span', { text: '📝' }),
            h('span', { text: `你有 ${d.pending} 笔已完成交易待评价，及时评价可帮助卖家积累信用。` }),
            h('button', { class: 'btn btn-ghost btn-sm', text: '去评价', onClick: () => go('#/orders') }))
        : null;
      if (!d.list.length) {
        body.replaceChildren(head || '', empty(role === 'written' ? '你还没有发表过评价' : '你还没有收到评价', '完成交易后即可互相评价'));
        return;
      }
      body.replaceChildren(head || '', h('div', {}, ...d.list.map((r) => item(r, load))));
    } catch (e) {
      body.replaceChildren(h('p', { text: '加载失败：' + e.message }));
    }
  }

  function item(r, reload) {
    const isReceived = role === 'received';
    const who = isReceived ? r.buyer_name : r.seller_name;
    const actions = h('div', { class: 'flex-gap', style: { marginTop: 'var(--space-8)' } });
    if (isReceived && !r.reply) {
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '回复评价', onClick: () => reply(r, reload) }));
    }
    if (!isReceived && !r.additional) {
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '追加评价', onClick: () => appendAdditional(r, reload) }));
    }
    actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '查看商品', onClick: () => go('#/goods/' + r.goods_id) }));

    return h('div', { class: 'review-item' },
      h('div', { class: 'review-head' },
        avatar(who, 34),
        h('div', {},
          h('div', { class: 'review-name' }, who, h('span', { class: 'small muted', style: { fontWeight: '400', marginLeft: 'var(--space-8)' } }, isReceived ? '评价了你' : '你的评价')),
          stars(r.score)
        ),
        h('span', { class: 'review-time', text: timeAgo(r.created_at) })
      ),
      h('div', { class: 'small muted', style: { marginBottom: 'var(--space-6)' } }, '商品：', r.goods_title),
      r.content ? h('div', { class: 'review-content', text: r.content }) : h('div', { class: 'muted small', text: '（买家未填写文字评价）' }),
      r.additional
        ? h('div', { class: 'review-additional' },
            h('div', {},
              h('b', { text: '追加评价' }),
              h('span', { class: 'small muted', style: { marginLeft: 'var(--space-6)' }, text: timeAgo(r.additional_at || r.created_at) })),
            h('div', { style: { marginTop: 'var(--space-4)' }, text: r.additional }))
        : null,
      r.reply ? h('div', { class: 'review-reply' }, h('b', { text: '卖家回复：' }), r.reply) : null,
      actions
    );
  }

  async function reply(r, reload) {
    const d = await formDialog({ title: '回复评价', okText: '发布回复', fields: [{ name: 'reply', label: '回复内容', type: 'textarea', required: true, placeholder: '感谢支持，或对买家反馈作出说明' }] });
    if (!d) return;
    try { await api.post(`/api/review/${r.review_id}/reply`, { reply: d.reply }); toast('回复成功', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  }

  // 追加评价（仅评价作者本人，限一次）
  async function appendAdditional(r, reload) {
    const d = await formDialog({
      title: '追加评价',
      okText: '发表追加',
      fields: [{ name: 'content', label: '追加评价', type: 'textarea', required: true, rows: 3,
        placeholder: '使用一段时间后的补充感受，例如质量、耐用度；仅可追加一次' }],
    });
    if (!d) return;
    try { await api.put(`/api/review/${r.review_id}/additional`, { content: d.content }); toast('追加评价发表成功', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  }

  drawTabs(); load();
}
