// 管理后台：数据看板 / 商品审核 / 用户管理 / 公告管理 / 举报处理 / 审计日志
import { api } from '../api.js';
import { h, yuan, fmtTime, timeAgo, toast, cover, badge, empty, loading, confirmDialog, formDialog, modal, avatar } from '../ui.js';
import { go, META } from '../app.js';

const TITLE = (t, d) => h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title', text: t }), d ? h('p', { class: 'page-desc', text: d }) : null));

// ---------------- 数据看板 ----------------
export async function renderDashboard(root) {
  root.replaceChildren(loading());
  const d = await api.get('/api/admin/stats');
  const s = d.stats;
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.orders));
  const maxCat = Math.max(1, ...d.byCategory.map((c) => c.c));

  root.replaceChildren(
    TITLE('数据看板', '平台运营概览：用户、商品、交易与举报的实时统计'),
    h('div', { class: 'stat-grid' },
      stat('注册用户', s.userTotal, `已实名 ${s.userVerified} · 正常 ${s.userActive}`),
      stat('商品总数', s.goodsTotal, `在售 ${s.goodsOnSale} · 已售 ${s.goodsSold}`),
      stat('待审核商品', s.goodsPending, '需尽快处理', s.goodsPending ? 'danger' : ''),
      stat('订单总数', s.orderTotal, `进行中 ${s.orderPending} · 已完成 ${s.orderDone}`),
      stat('累计成交额', '¥' + Number(s.gmv).toFixed(2), `客单价 ¥${s.orderDone ? (s.gmv / s.orderDone).toFixed(2) : '0.00'}`, 'accent'),
      stat('评价总数', s.reviewTotal, `平均评分 ${s.avgScore} 分`),
      stat('待处理举报', s.reportPending, '举报处理队列', s.reportPending ? 'danger' : '')
    ),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--space-16)' }, class: 'mt-16' },
      h('div', { class: 'card' },
        h('h3', { class: 'card-title', text: '近 7 日成交趋势' }),
        d.trend.length
          ? h('div', {}, ...d.trend.map((t) =>
              h('div', { class: 'bar-row' },
                h('span', { class: 'bar-label', text: t.day.slice(5) }),
                h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: (t.orders / maxTrend * 100) + '%' } })),
                h('span', { class: 'bar-val', text: String(t.orders) })
              )))
          : h('p', { class: 'muted small' }, '近 7 日暂无成交数据')
      ),
      h('div', { class: 'card' },
        h('h3', { class: 'card-title', text: '在售商品类别分布' }),
        d.byCategory.length
          ? h('div', {}, ...d.byCategory.map((c) =>
              h('div', { class: 'bar-row' },
                h('span', { class: 'bar-label', text: c.category }),
                h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: (c.c / maxCat * 100) + '%', background: 'linear-gradient(90deg, var(--viz-life-1), var(--viz-life-2))' } })),
                h('span', { class: 'bar-val', text: String(c.c) })
              )))
          : h('p', { class: 'muted small' }, '暂无上架商品')
      )
    ),
    h('div', { class: 'card mt-16' },
      h('h3', { class: 'card-title', text: '快捷操作' }),
      h('div', { class: 'flex-gap', style: { flexWrap: 'wrap' } },
        h('button', { class: 'btn btn-primary', text: '商品审核', onClick: () => go('#/admin/audit') }),
        h('button', { class: 'btn btn-ghost', text: '用户管理', onClick: () => go('#/admin/users') }),
        h('button', { class: 'btn btn-ghost', text: '发布公告', onClick: () => go('#/admin/announcements') }),
        h('button', { class: 'btn btn-ghost', text: '处理举报', onClick: () => go('#/admin/reports') }),
        h('button', { class: 'btn btn-ghost', text: '查看审计日志', onClick: () => go('#/admin/logs') })
      )
    )
  );

  function stat(label, value, sub, cls) {
    return h('div', { class: 'stat' },
      h('div', { class: 'stat-label', text: label }),
      h('div', { class: `stat-value ${cls || ''}`, text: value }),
      h('div', { class: 'small muted', text: sub })
    );
  }
}

// ---------------- 商品审核 ----------------
export async function renderAudit(root) {
  let filter = '0';
  const tabsBox = h('div', { class: 'tabs' });
  const listBox = h('div', {}, loading());
  root.append(TITLE('商品审核', '审核卖家提交的商品信息，违规商品可驳回或强制下架'), h('div', { class: 'card' }, tabsBox, listBox));

  const TABS = [{ k: '0', label: '待审核' }, { k: '1', label: '已通过' }, { k: '2', label: '已驳回' }, { k: '', label: '全部' }];
  function drawTabs() {
    tabsBox.replaceChildren(...TABS.map((t) => h('button', { class: filter === t.k ? 'active' : '', text: t.label, onClick: () => { filter = t.k; drawTabs(); load(); } })));
  }

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const q = filter !== '' ? '?audit_status=' + filter + '&size=50' : '?size=50';
      const d = await api.get('/api/admin/goods' + q);
      const list = d.list;
      if (!list.length) { listBox.replaceChildren(empty('该分类下暂无商品')); return; }
      listBox.replaceChildren(h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, ['商品', '卖家', '类别/成色', '价格', '提交时间', '状态', '操作'].map((t) => h('th', { text: t })))),
          h('tbody', {}, ...list.map(row))
        )
      ));
    } catch (e) { listBox.replaceChildren(h('p', { text: '加载失败：' + e.message })); }
  }

  function row(g) {
    const st = badge(['待审核', '审核通过', '审核驳回'][g.audit_status], ['badge-warn', 'badge-ok', 'badge-danger'][g.audit_status]);
    const actions = h('div', { class: 'td-actions' });
    if (g.audit_status === 0) {
      actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '通过', onClick: () => audit(g, 1, load) }));
      actions.append(h('button', { class: 'btn btn-danger btn-sm', text: '驳回', onClick: () => audit(g, 2, load) }));
    } else {
      if (g.goods_status === 1) actions.append(h('button', { class: 'btn btn-danger btn-sm', text: '强制下架', onClick: () => offline(g, load) }));
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '查看', onClick: () => go('#/goods/' + g.goods_id) }));
    }
    return h('tr', {},
      h('td', { style: { minWidth: '210px' } },
        h('div', { class: 'flex-gap' },
          h('div', { style: { width: '42px', height: '42px', borderRadius: 'var(--radius-8)', overflow: 'hidden', flexShrink: '0' } }, cover(g, { height: 42 })),
          h('div', {}, h('div', { class: 'cell-strong' }, g.title),
            g.audit_remark ? h('div', { class: 'cell-sub', text: '驳回原因：' + g.audit_remark }) : h('div', { class: 'cell-sub', text: (g.description || '').slice(0, 24) + ((g.description || '').length > 24 ? '…' : '') }))
        )
      ),
      h('td', {}, h('div', { class: 'cell-strong' }, g.seller_name), h('div', { class: 'cell-sub', text: g.seller_no })),
      h('td', {}, g.category, h('div', { class: 'cell-sub', text: g.quality || '—' })),
      h('td', { class: 'num' }, yuan(g.price)),
      h('td', { class: 'cell-sub' }, fmtTime(g.created_at)),
      h('td', {}, st),
      h('td', {}, actions)
    );
  }

  async function audit(g, status, reload) {
    if (status === 2) {
      const r = await formDialog({ title: '驳回商品', okText: '确认驳回', fields: [{ name: 'remark', label: '驳回原因', type: 'textarea', required: true, placeholder: '如：描述与实物不符、疑似违禁物品' }], width: 460 });
      if (!r) return;
      try { await api.put('/api/admin/goods/audit', { goods_id: g.goods_id, audit_status: 2, remark: r.remark }); toast('已驳回', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
      return;
    }
    const okc = await confirmDialog(`确认通过「${g.title}」的审核？通过后将上架展示。`, { title: '审核通过', okText: '确认通过' });
    if (!okc) return;
    try { await api.put('/api/admin/goods/audit', { goods_id: g.goods_id, audit_status: 1, remark: '内容合规' }); toast('已通过审核', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  async function offline(g, reload) {
    const okc = await confirmDialog(`确认强制下架「${g.title}」？该商品将立即从集市移除。`, { title: '强制下架', okText: '确认下架', danger: true });
    if (!okc) return;
    try { await api.put('/api/admin/goods/offline', { goods_id: g.goods_id }); toast('商品已强制下架', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }

  drawTabs(); load();
}

// ---------------- 用户管理 ----------------
export async function renderUsers(root) {
  const kw = h('input', { type: 'text', placeholder: '按学号 / 昵称 / 手机号搜索' });
  kw.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  const listBox = h('div', {}, loading());
  root.append(TITLE('用户管理', '查询平台用户，处理实名认证复核与违规账号禁用'), h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('div', { class: 'search-box' }, kw, h('button', { class: 'btn btn-primary', text: '搜索', onClick: () => load() }))),
    listBox
  ));

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const d = await api.get('/api/admin/users?keyword=' + encodeURIComponent(kw.value.trim()));
      if (!d.list.length) { listBox.replaceChildren(empty('没有匹配的用户')); return; }
      listBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['用户', '学号', '手机号', '信用分', '实名', '状态', '交易', '操作'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...d.list.map(row))
      )));
    } catch (e) { listBox.replaceChildren(h('p', { text: '加载失败：' + e.message })); }
  }

  function row(u) {
    const vBadge = [badge('未认证', 'badge-muted'), badge('已认证', 'badge-ok'), badge('待复核', 'badge-warn')][u.is_verified] || badge('未知');
    const actions = h('div', { class: 'td-actions' });
    if (u.is_verified === 2) {
      actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '通过实名', onClick: () => verify(u, true, load) }));
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '驳回', onClick: () => verify(u, false, load) }));
    }
    actions.append(h('button', {
      class: `btn ${u.status ? 'btn-danger' : 'btn-primary'} btn-sm`,
      text: u.status ? '禁用' : '启用',
      onClick: () => toggle(u, load),
    }));
    return h('tr', {},
      h('td', {}, h('div', { class: 'flex-gap' }, avatar(u, 32), h('span', { class: 'cell-strong' }, u.nickname))),
      h('td', { class: 'num' }, u.student_no),
      h('td', { class: 'cell-sub' }, u.phone || '—'),
      h('td', { class: 'num' }, h('b', { style: { color: 'var(--brand-dark)' }, text: u.credit_score })),
      h('td', {}, vBadge),
      h('td', {}, u.status ? badge('正常', 'badge-ok') : badge('已禁用', 'badge-danger')),
      h('td', { class: 'cell-sub' }, `发${u.goods_count} 买${u.buy_count} 卖${u.sell_count}`),
      h('td', {}, actions)
    );
  }

  async function toggle(u, reload) {
    const msg = u.status ? `确认禁用「${u.nickname}」？禁用后该账号将无法登录。` : `确认启用「${u.nickname}」？`;
    const okc = await confirmDialog(msg, { title: u.status ? '禁用账号' : '启用账号', okText: '确认', danger: !!u.status });
    if (!okc) return;
    try { await api.put('/api/admin/users/status', { user_id: u.user_id, status: u.status ? 0 : 1 }); toast('操作成功', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  async function verify(u, approve, reload) {
    try { await api.put('/api/admin/users/verify', { user_id: u.user_id, approve }); toast(approve ? '已通过实名认证' : '已驳回实名认证', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }

  load();
}

// ---------------- 公告管理 ----------------
export async function renderAnnouncements(root) {
  const listBox = h('div', {}, loading());
  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title', text: '公告管理' }), h('p', { class: 'page-desc', text: '发布平台公告，公告将展示在集市首页' })),
      h('button', { class: 'btn btn-primary', text: '＋ 发布公告', onClick: () => create(load) })
    ),
    h('div', { class: 'card' }, listBox)
  );

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const d = await api.get('/api/admin/announcements');
      if (!d.list.length) { listBox.replaceChildren(empty('暂无公告')); return; }
      listBox.replaceChildren(h('div', {}, ...d.list.map((a) =>
        h('div', { class: 'order-card' },
          h('div', { class: 'order-head' },
            a.status ? badge('发布中', 'badge-ok') : badge('已撤回', 'badge-muted'),
            h('span', { class: 'cell-strong', text: a.title }),
            h('span', { style: { marginLeft: 'auto' }, text: fmtTime(a.created_at) })
          ),
          h('div', { style: { padding: 'var(--space-14) var(--space-16)' } },
            h('p', { style: { color: 'var(--ink-2)' }, text: a.content }),
            h('div', { class: 'flex-gap mt-8' },
              h('button', { class: 'btn btn-ghost btn-sm', text: a.status ? '撤回' : '重新发布', onClick: () => toggleAnn(a, load) }),
              h('button', { class: 'btn btn-danger btn-sm', text: '删除', onClick: () => delAnn(a, load) })
            )
          )
        )
      )));
    } catch (e) { listBox.replaceChildren(h('p', { text: '加载失败：' + e.message })); }
  }

  async function create(reload) {
    const r = await formDialog({
      title: '发布公告', okText: '发布',
      fields: [
        { name: 'title', label: '公告标题', required: true },
        { name: 'content', label: '公告内容', type: 'textarea', required: true },
      ],
    });
    if (!r) return;
    try { await api.post('/api/admin/announcements', r); toast('公告已发布', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  async function toggleAnn(a, reload) {
    try { await api.put(`/api/admin/announcements/${a.id}/status`, { status: a.status ? 0 : 1 }); toast(a.status ? '公告已撤回' : '公告已重新发布', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  async function delAnn(a, reload) {
    const okc = await confirmDialog(`确认删除公告「${a.title}」？删除后不可恢复。`, { title: '删除公告', okText: '删除', danger: true });
    if (!okc) return;
    try { await api.del(`/api/admin/announcements/${a.id}`); toast('公告已删除', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }

  load();
}

// ---------------- 举报处理 ----------------
export async function renderReports(root) {
  const listBox = h('div', {}, loading());
  root.append(TITLE('举报处理', '受理用户对商品或用户的举报，举报成立将联动下架商品或禁用账号'), h('div', { class: 'card' }, listBox));

  async function load() {
    listBox.replaceChildren(loading());
    try {
      const d = await api.get('/api/admin/reports');
      if (!d.list.length) { listBox.replaceChildren(empty('暂无举报记录')); return; }
      listBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['举报人', '举报对象', '原因', '时间', '状态', '操作'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...d.list.map(row))
      )));
    } catch (e) { listBox.replaceChildren(h('p', { text: '加载失败：' + e.message })); }
  }

  function row(r) {
    const actions = h('div', { class: 'td-actions' });
    if (r.status === 0) {
      actions.append(h('button', { class: 'btn btn-primary btn-sm', text: '举报成立', onClick: () => handle(r, 1, load) }));
      actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '驳回', onClick: () => handle(r, 0, load) }));
    }
    if (r.target_type === 'goods') actions.append(h('button', { class: 'btn btn-ghost btn-sm', text: '查看商品', onClick: () => go('#/goods/' + r.target_id) }));
    return h('tr', {},
      h('td', { class: 'cell-strong' }, r.reporter_name),
      h('td', {}, h('span', { class: `badge ${r.target_type === 'goods' ? 'badge-info' : 'badge-warn'}`, text: r.target_type === 'goods' ? '商品' : '用户' }),
        h('div', { class: 'cell-sub', text: (r.target_name || '（已删除）').slice(0, 20) })),
      h('td', { style: { maxWidth: '260px' } }, r.reason,
        r.handle_remark ? h('div', { class: 'cell-sub', text: '处理说明：' + r.handle_remark }) : null),
      h('td', { class: 'cell-sub' }, fmtTime(r.created_at)),
      h('td', {}, r.status === 0 ? badge('待处理', 'badge-warn') : badge('已处理', 'badge-ok')),
      h('td', {}, actions)
    );
  }

  async function handle(r, status, reload) {
    const r2 = await formDialog({
      title: status ? '举报成立' : '驳回举报',
      okText: '确认',
      width: 460,
      fields: [{ name: 'remark', label: '处理说明', type: 'textarea', required: true, value: status ? '举报成立，已联动处置' : '经核查举报不成立' }],
    });
    if (!r2) return;
    try { await api.put('/api/admin/reports/handle', { id: r.id, status, remark: r2.remark }); toast('处理完成', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  }

  load();
}

// ---------------- 审计日志 ----------------
// 审计动作中文对照：动作列展示中文，原始代码保留为悬停提示与灰色小字，便于追溯
const ACTION_LABELS = {
  LOGIN: '登录',
  ADMIN_LOGIN: '管理员登录',
  LOGIN_LOCK: '登录锁定',
  REGISTER: '注册账号',
  CHANGE_PASSWORD: '修改密码',
  VERIFY_SUBMIT: '提交实名认证',
  VERIFY_PASS: '实名复核通过',
  VERIFY_REJECT: '实名复核驳回',
  GOODS_PUBLISH: '发布商品',
  GOODS_AUDIT: '商品审核',
  GOODS_OFFLINE: '强制下架',
  GOODS_DELETE: '删除商品',
  ORDER_CREATE: '创建订单',
  ORDER_PAY: '支付订单',
  ORDER_SHIP: '卖家发货',
  ORDER_CONFIRM: '确认收货',
  ORDER_SETTLE: '货款结算',
  ORDER_CANCEL: '取消订单',
  REVIEW_CREATE: '发表评价',
  REVIEW_ADDITIONAL: '追加评价',
  REPORT: '提交举报',
  REPORT_HANDLE: '处理举报',
  ANN_PUBLISH: '发布公告',
  ANN_ON: '上架公告',
  ANN_OFF: '下架公告',
  USER_ENABLE: '启用账号',
  USER_DISABLE: '禁用账号',
};

export async function renderLogs(root) {
  const listBox = h('div', {}, loading());
  root.append(TITLE('审计日志', '记录关键操作（登录、发布、审核、下单、结算等），供安全审计追溯'), h('div', { class: 'card' }, listBox));
  try {
    const d = await api.get('/api/admin/logs');
    if (!d.list.length) { listBox.replaceChildren(empty('暂无日志')); return; }
    listBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['时间', '操作者', '动作', '详情'].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...d.list.map((l) => h('tr', {},
        h('td', { class: 'cell-sub' }, fmtTime(l.created_at)),
        h('td', {},
          badge(l.actor_type === 'admin' ? '管理员' : l.actor_type === 'system' ? '系统' : '用户', l.actor_type === 'admin' ? 'badge-warn' : l.actor_type === 'system' ? 'badge-muted' : 'badge-info'),
          // 操作者展示真实身份：昵称/姓名 + 账号；身份已不存在的回退为 #ID
          l.actor_type !== 'system'
            ? h('span', {
                class: l.actor_name ? 'cell-strong' : 'cell-sub',
                style: { marginLeft: 'var(--space-6)' },
                text: l.actor_name
                  ? l.actor_name + (l.actor_account ? '（' + l.actor_account + '）' : '')
                  : '#' + (l.actor_id ?? '—'),
              })
            : null),
        h('td', {},
          h('span', { class: 'cell-strong', title: l.action, text: ACTION_LABELS[l.action] || l.action }),
          ACTION_LABELS[l.action] ? h('span', { class: 'cell-sub', style: { marginLeft: 'var(--space-6)' }, text: l.action }) : null),
        h('td', { class: 'cell-sub' }, l.detail || '—')
      )))
    )));
  } catch (e) { listBox.replaceChildren(h('p', { text: '加载失败：' + e.message })); }
}
