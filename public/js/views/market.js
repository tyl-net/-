// 二手集市（浏览 / 搜索 / 商品详情）
import { api, session, qs } from '../api.js';
import { h, esc, yuan, timeAgo, toast, cover, parseImages, categoryIcon, badge, empty, loading, stars, avatar, modal, confirmDialog, formDialog } from '../ui.js';
import { go, META } from '../app.js';

// ---------------- 首页 ----------------
export async function render(root) {
  const state = { page: 1, size: 8, category: '', keyword: '', minPrice: '', maxPrice: '', total: 0, list: [] };

  const annBox = h('div', { style: { marginBottom: 'var(--space-18)' } });
  const chips = h('div', { class: 'chips' });
  const grid = h('div', { class: 'goods-grid' });
  const pagerBox = h('div');
  const minP = h('input', { type: 'number', placeholder: '最低价', style: { width: '92px' } });
  const maxP = h('input', { type: 'number', placeholder: '最高价', style: { width: '92px' } });
  const kw = h('input', { type: 'text', placeholder: '搜索教材、数码、生活用品…' });

  const search = () => {
    state.keyword = kw.value.trim();
    state.minPrice = minP.value;
    state.maxPrice = maxP.value;
    state.page = 1;
    load();
  };
  kw.addEventListener('keydown', (e) => e.key === 'Enter' && search());

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title', text: '二手集市' }), h('p', { class: 'page-desc', text: '浏览校园内在售的闲置好物，支持关键词、类别与价格区间组合检索' })),
      // 学生可发布；游客点击发布引导登录；管理员只读浏览显示徽章
      session.user
        ? h('button', { class: 'btn btn-primary', text: '＋ 发布闲置', onClick: () => go('#/publish') })
        : session.admin
          ? h('span', { class: 'badge badge-muted', text: '管理员浏览模式 · 不参与发布与交易' })
          : h('button', { class: 'btn btn-primary', text: '＋ 发布闲置', onClick: () => go('#/login') })
    ),
    annBox,
    h('div', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'search-box' }, kw, h('button', { class: 'btn btn-primary', text: '搜索', onClick: search })),
        h('div', { class: 'flex-gap' }, minP, h('span', { class: 'muted', text: '—' }), maxP),
        h('button', { class: 'btn btn-ghost', text: '重置', onClick: () => { kw.value = ''; minP.value = ''; maxP.value = ''; state.category = ''; state.keyword = ''; state.minPrice = ''; state.maxPrice = ''; state.page = 1; drawChips(); load(); } })
      ),
      chips,
      grid,
      pagerBox
    )
  );

  function drawChips() {
    chips.replaceChildren(
      h('div', { class: `chip ${state.category === '' ? 'active' : ''}`, text: '全部', onClick: () => { state.category = ''; state.page = 1; drawChips(); load(); } }),
      ...META.categories.map((c) =>
        h('div', { class: `chip ${state.category === c ? 'active' : ''}`, text: `${categoryIcon(c)} ${c}`, onClick: () => { state.category = c; state.page = 1; drawChips(); load(); } })
      )
    );
  }

  // 集市页只展示对买家有用的信息（公告）；平台运营统计在管理员「数据看板」查看
  async function loadAnnouncements() {
    try {
      const ann = await api.get('/api/announcements', { auth: false });
      annBox.replaceChildren(
        ann.list.length
          ? h('div', { class: 'ann-list' }, ...ann.list.slice(0, 3).map((a) =>
              h('div', { class: 'ann' }, h('b', { text: '📢 ' + a.title }), h('p', { text: a.content }), h('time', { text: timeAgo(a.created_at) }))))
          : null
      );
    } catch {}
  }

  async function load() {
    grid.replaceChildren(loading());
    pagerBox.replaceChildren();
    try {
      const q = qs({ keyword: state.keyword, category: state.category, minPrice: state.minPrice, maxPrice: state.maxPrice, page: state.page, size: state.size });
      const data = await api.get('/api/goods/search?' + q, { auth: false });
      state.total = data.total;
      state.list = data.list;
      if (!data.list.length) {
        grid.replaceChildren(empty('没有找到匹配的闲置物品', '换个关键词或调整筛选条件试试'));
        return;
      }
      grid.replaceChildren(...data.list.map(goodsCard));
      drawPager();
    } catch (e) {
      grid.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty-text', text: '加载失败：' + e.message })));
    }
  }

  function goodsCard(g) {
    return h('div', { class: 'goods-card', onClick: () => go('#/goods/' + g.goods_id) },
      cover(g),
      h('div', { class: 'goods-body' },
        h('div', { class: 'goods-title', text: g.title }),
        h('div', { class: 'goods-meta' },
          h('span', { class: 'price' }, h('small', { text: '¥' }), String(Number(g.price).toFixed(2))),
          g.quality ? badge(g.quality, 'badge-muted') : null
        ),
        h('div', { class: 'goods-foot' },
          h('div', { class: 'seller-mini' }, avatar(g.seller_name, 22), h('span', { text: g.seller_name }),
            g.seller_verified === 1 ? h('span', { title: '已实名认证', text: '✔' , style: { color: 'var(--brand)' } }) : null),
          h('span', { class: 'small muted', text: timeAgo(g.created_at) })
        )
      )
    );
  }

  function drawPager() {
    const pages = Math.ceil(state.total / state.size) || 1;
    if (pages <= 1) { pagerBox.replaceChildren(h('div', { class: 'pager-info', text: `共 ${state.total} 件商品`, style: { textAlign: 'center', marginTop: 'var(--space-18)' } })); return; }
    const btns = [
      h('button', { text: '‹', disabled: state.page === 1, onClick: () => { state.page--; load(); } }),
    ];
    for (let i = 1; i <= pages; i++) {
      if (pages > 7 && i > 3 && i < pages - 2 && Math.abs(i - state.page) > 1) {
        if (i === 4) btns.push(h('span', { class: 'pager-info', text: '…' }));
        continue;
      }
      btns.push(h('button', { class: i === state.page ? 'active' : '', text: String(i), onClick: () => { state.page = i; load(); } }));
    }
    btns.push(h('button', { text: '›', disabled: state.page === pages, onClick: () => { state.page++; load(); } }));
    pagerBox.replaceChildren(h('div', { class: 'pager' }, btns, h('span', { class: 'pager-info', text: `共 ${state.total} 件 / ${pages} 页` })));
  }

  drawChips();
  loadAnnouncements();
  load();
}

// ---------------- 商品详情 ----------------
export async function renderDetail(root, params) {
  const id = params.id;
  root.replaceChildren(loading('正在加载商品详情…'));
  let data;
  try {
    data = await api.get('/api/goods/' + id);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'card' }, h('p', { text: '商品不存在或已被删除' }), h('button', { class: 'btn btn-ghost mt-16', text: '返回集市', onClick: () => go('#/home') })));
    return;
  }
  const g = data.goods;
  const me = session.user;
  const adminBrowsing = !me && !!session.admin; // 管理员只读浏览
  const guest = !me && !adminBrowsing; // 游客：可浏览，操作需登录
  const mine = me && me.type === 'user' && me.user_id === g.seller_id;
  const canBuy = g.audit_status === 1 && g.goods_status === 1 && !mine && !adminBrowsing;

  const buyBtn = h('button', { class: 'btn btn-primary', style: { padding: 'var(--space-12) var(--space-32)', fontSize: 'var(--font-size-lg)' }, text: '立即购买' });
  buyBtn.disabled = !canBuy;
  if (canBuy) buyBtn.onclick = () => placeOrder(g);
  else if (adminBrowsing) { buyBtn.textContent = '管理员账号不可购买'; buyBtn.className = 'btn btn-ghost'; }
  else if (mine) { buyBtn.textContent = '这是我发布的商品'; buyBtn.className = 'btn btn-ghost'; }
  else if (g.goods_status === 2) { buyBtn.textContent = '已售出'; buyBtn.className = 'btn btn-ghost'; }
  else if (g.goods_status === 0) { buyBtn.textContent = '已下架'; buyBtn.className = 'btn btn-ghost'; }
  else if (g.audit_status === 0) { buyBtn.textContent = '审核中'; buyBtn.className = 'btn btn-ghost'; }
  else if (g.audit_status === 2) { buyBtn.textContent = '未通过审核'; buyBtn.className = 'btn btn-ghost'; }

  const imgs = parseImages(g.images);
  const mainBox = h('div', { class: 'detail-cover' }, cover(g, { height: 300, big: true }));
  const thumbs = imgs.length > 1
    ? h('div', { class: 'detail-thumbs' }, ...imgs.map((src, i) =>
        h('img', {
          src, alt: `${g.title} 图片 ${i + 1}`, class: i === 0 ? 'active' : '',
          onClick: (e) => {
            mainBox.replaceChildren(h('div', { class: 'cover', style: { height: '300px' } }, h('img', { src, alt: g.title })));
            [...e.currentTarget.parentNode.children].forEach((c) => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
          },
        })
      ))
    : null;

  root.replaceChildren(
    h('div', { class: 'row-between', style: { marginBottom: 'var(--space-16)' } },
      h('button', { class: 'btn btn-ghost btn-sm', text: '← 返回集市', onClick: () => history.length > 1 ? history.back() : go('#/home') }),
      h('div', { class: 'flex-gap' },
        h('span', { class: 'small muted', text: `浏览 ${g.view_count} 次` }),
        !mine ? h('button', { class: 'btn btn-ghost btn-sm', text: '举报', onClick: () => reportGoods(g) }) : null
      )
    ),
    h('div', { class: 'card' },
      h('div', { class: 'detail-top' },
        h('div', {}, mainBox, thumbs),
        h('div', {},
          h('div', { class: 'flex-gap', style: { marginBottom: 'var(--space-8)' } },
            badge(g.category, 'badge-info'),
            g.quality ? badge(g.quality, 'badge-muted') : null,
            g.goods_status === 1 && g.audit_status === 1 ? badge('在售', 'badge-ok') : badge(['待审核', '在售', '审核驳回'][g.audit_status] || (g.goods_status === 2 ? '已售出' : '已下架'), g.goods_status === 2 ? 'badge-muted' : 'badge-warn')
          ),
          h('h1', { class: 'detail-title', text: g.title }),
          h('div', { class: 'detail-price-box' },
            h('span', { class: 'price price-lg' }, h('small', { text: '¥' }), String(Number(g.price).toFixed(2))),
            h('span', { class: 'muted small', text: '  平台托管交易 · 确认收货后结算给卖家' })
          ),
          h('div', { class: 'detail-attrs' },
            attr('商品类别', g.category),
            attr('成色', g.quality || '未填写'),
            attr('发布时间', String(g.created_at).slice(0, 16)),
            attr('累计浏览', g.view_count + ' 次')
          ),
          h('div', { class: 'card', style: { padding: 'var(--space-14) var(--space-16)', boxShadow: 'none', background: 'var(--color-bg-subtle)' } },
            h('div', { class: 'flex-gap' },
              avatar(g.seller_name, 42),
              h('div', { class: 'grow' },
                h('div', { style: { fontWeight: '600' } }, g.seller_name,
                  g.seller_verified === 1 ? h('span', { class: 'badge badge-ok', style: { marginLeft: 'var(--space-8)' }, text: '已实名' }) : h('span', { class: 'badge badge-muted', style: { marginLeft: 'var(--space-8)' }, text: '未实名' })),
                h('div', { class: 'small muted' }, '卖家信用分 ', h('b', { style: { color: 'var(--brand-dark)' }, text: g.seller_credit }))
              ),
              h('button', { class: 'btn btn-ghost btn-sm', text: '查看主页', onClick: () => sellerHome(g.seller_id, g.seller_name) })
            )
          ),
          h('div', { class: 'mt-16' }, buyBtn)
        )
      )
    ),
    h('div', { class: 'card' },
      h('h3', { class: 'card-title', text: '商品描述' }),
      h('div', { class: 'detail-desc', text: g.description || '卖家暂未填写详细描述' })
    ),
    h('div', { class: 'card' },
      h('h3', { class: 'card-title', text: `交易评价（${data.reviews.length}）` }),
      data.reviews.length ? h('div', {}, ...data.reviews.map(reviewItem)) : empty('暂无评价', '完成交易后即可评价该商品')
    )
  );
}

export function reviewItem(r) {
  return h('div', { class: 'review-item' },
    h('div', { class: 'review-head' },
      avatar({ nickname: r.buyer_name || r.nickname, avatar: r.buyer_avatar }, 32),
      h('div', {},
        h('div', { class: 'review-name', text: r.buyer_name || r.nickname }),
        stars(r.score)
      ),
      h('span', { class: 'review-time', text: timeAgo(r.created_at) })
    ),
    r.content ? h('div', { class: 'review-content', text: r.content }) : null,
    r.additional
      ? h('div', { class: 'review-additional' },
          h('div', {},
            h('b', { text: '追加评价' }),
            h('span', { class: 'small muted', style: { marginLeft: 'var(--space-6)' }, text: timeAgo(r.additional_at || r.created_at) })),
          h('div', { style: { marginTop: 'var(--space-4)' }, text: r.additional }))
      : null,
    r.reply ? h('div', { class: 'review-reply' }, h('b', { text: '卖家回复：' }), r.reply) : null
  );
}

function attr(k, v) {
  return h('div', { class: 'attr' }, h('div', { class: 'attr-k', text: k }), h('div', { class: 'attr-v', text: String(v) }));
}

async function placeOrder(g) {
  // 游客下单前先引导登录
  if (!session.user) {
    toast('请先登录后再下单', 'info');
    go('#/login');
    return;
  }
  const okc = await confirmDialog(`确认以 ${yuan(g.price)} 购买「${g.title}」？\n下单后请在「我的订单」中完成支付。`, { title: '确认下单', okText: '确认下单' });
  if (!okc) return;
  try {
    const d = await api.post('/api/order', { goods_id: g.goods_id });
    toast('下单成功，订单号 ' + d.order_no, 'success');
    go('#/orders');
  } catch (e) { toast(e.message, 'error'); }
}

async function reportGoods(g) {
  const d = await formDialog({
    title: '举报商品',
    fields: [{ name: 'reason', label: '举报原因', type: 'textarea', required: true, placeholder: '请描述该商品存在的问题，如违禁物品、虚假描述等' }],
    okText: '提交举报',
  });
  if (!d) return;
  try { await api.post('/api/report', { target_type: 'goods', target_id: g.goods_id, reason: d.reason }); toast('举报已提交，管理员将尽快处理', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

export async function sellerHome(userId, name) {
  const box = h('div', {}, loading());
  const m = modal({ title: `${name} 的主页`, body: box, width: 560 });
  try {
    const d = await api.get('/api/user/' + userId, { auth: false });
    box.replaceChildren(
      h('div', { class: 'flex-gap', style: { marginBottom: 'var(--space-14)' } },
        avatar(d.user.nickname, 52),
        h('div', {},
          h('div', { style: { fontWeight: '700', fontSize: 'var(--font-size-lg)' } }, d.user.nickname,
            d.user.is_verified === 1 ? h('span', { class: 'badge badge-ok', style: { marginLeft: 'var(--space-8)' }, text: '已实名' }) : null),
          h('div', { class: 'small muted' }, `信用分 ${d.user.credit_score} · 平均评分 ${d.rating.s} 分（${d.rating.c} 条评价）`)
        )
      ),
      h('h4', { style: { marginBottom: 'var(--space-8)' } }, `在售商品（${d.goods.filter((x) => x.goods_status === 1).length}）`),
      d.goods.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-10)', marginBottom: 'var(--space-14)' } },
        ...d.goods.map((x) => h('div', {
          class: 'chip', style: { maxWidth: '100%' },
          onClick: () => { m.close(); go('#/goods/' + x.goods_id); },
        }, `${categoryIcon(x.category)} ${x.title} · ¥${Number(x.price).toFixed(2)}`))) : h('p', { class: 'muted small' }, '暂无在售商品'),
      h('h4', { style: { margin: 'var(--space-8) 0 var(--space-4)' } }, `收到的评价（${d.reviews.length}）`),
      d.reviews.length ? h('div', {}, ...d.reviews.slice(0, 5).map(reviewItem)) : h('p', { class: 'muted small' }, '暂无评价')
    );
  } catch (e) {
    box.replaceChildren(h('p', { class: 'muted', text: '加载失败：' + e.message }));
  }
}
