// 应用入口：布局、路由、会话管理
import { session, api } from './api.js';
import { h, toast, avatar, modal, formDialog, confirmDialog } from './ui.js';
import * as authView from './views/auth.js';
import * as marketView from './views/market.js';
import * as sellerView from './views/seller.js';
import * as orderView from './views/orders.js';
import * as reviewView from './views/reviews.js';
import * as profileView from './views/profile.js';
import * as adminView from './views/admin.js';

const app = document.getElementById('app');
export let META = { categories: [], qualities: [], orderStatus: [], auditStatus: [], announcements: [] };

// ---------- 路由表 ----------
const ROUTES = [
  { path: '/home', view: marketView.render, nav: 'home', title: '二手集市' },
  { path: '/goods/:id', view: marketView.renderDetail, nav: 'home' },
  { path: '/publish', view: sellerView.renderPublish, nav: 'publish', auth: true },
  { path: '/my-goods', view: sellerView.renderMine, nav: 'my-goods', auth: true },
  { path: '/orders', view: orderView.render, nav: 'orders', auth: true },
  { path: '/reviews', view: reviewView.render, nav: 'reviews', auth: true },
  { path: '/profile', view: profileView.render, nav: 'profile', auth: true },
  { path: '/admin', view: adminView.renderDashboard, nav: 'admin-dash', auth: true },
  { path: '/admin/audit', view: adminView.renderAudit, nav: 'admin-audit', auth: true },
  { path: '/admin/users', view: adminView.renderUsers, nav: 'admin-users', auth: true },
  { path: '/admin/announcements', view: adminView.renderAnnouncements, nav: 'admin-ann', auth: true },
  { path: '/admin/reports', view: adminView.renderReports, nav: 'admin-reports', auth: true },
  { path: '/admin/logs', view: adminView.renderLogs, nav: 'admin-logs', auth: true },
];

const USER_NAV = [
  { nav: 'home', href: '#/home', label: '二手集市' },
  { nav: 'publish', href: '#/publish', label: '发布闲置' },
  { nav: 'my-goods', href: '#/my-goods', label: '我的商品' },
  { nav: 'orders', href: '#/orders', label: '我的订单' },
  { nav: 'reviews', href: '#/reviews', label: '评价中心' },
];
const ADMIN_NAV = [
  { nav: 'admin-dash', href: '#/admin', label: '数据看板' },
  { nav: 'admin-audit', href: '#/admin/audit', label: '商品审核' },
  { nav: 'admin-users', href: '#/admin/users', label: '用户管理' },
  { nav: 'admin-ann', href: '#/admin/announcements', label: '公告管理' },
  { nav: 'admin-reports', href: '#/admin/reports', label: '举报处理' },
  { nav: 'admin-logs', href: '#/admin/logs', label: '审计日志' },
];

function matchRoute(hash) {
  const path = (hash || '#/home').replace(/^#/, '') || '/home';
  const segs = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].startsWith(':')) params[rs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return { route: ROUTES[0], params: {} };
}

export const go = (hash) => { window.location.hash = hash; };

// ---------- 顶栏 ----------
function userMenu(u) {
  const wrap = h('div', { style: { position: 'relative' } });
  const chip = h('div', { class: 'userchip' },
    avatar(u, 30),
    h('div', { style: { lineHeight: '1.25' } },
      h('div', { class: 'userchip-name', text: u.nickname || u.name || u.account }),
      h('div', { class: 'userchip-sub', text: u.type === 'admin' ? (u.role === 2 ? '超级管理员' : '普通管理员') : `信用分 ${u.credit_score ?? '—'}` })
    )
  );
  chip.onclick = (e) => {
    e.stopPropagation();
    const menu = h('div', { class: 'card', style: { position: 'absolute', right: '0', top: '46px', width: '190px', padding: 'var(--space-8)', zIndex: 100, boxShadow: 'var(--shadow-lg)' } });
    const item = (label, fn, danger) => {
      const b = h('button', {
        class: 'btn btn-ghost', style: { width: '100%', justifyContent: 'flex-start', border: 'none', marginBottom: 'var(--space-2)', color: danger ? 'var(--danger)' : 'var(--ink-2)' },
        text: label, onClick: () => { menu.remove(); fn(); },
      });
      return b;
    };
    if (u.type !== 'admin') {
      menu.append(item('个人中心', () => go('#/profile')));
      menu.append(item('我的订单', () => go('#/orders')));
    } else {
      menu.append(item('数据看板', () => go('#/admin')));
    }
    // 退出只清除当前身份：管理员退出不影响其他标签页里的学生登录（反之亦然）
    menu.append(item('退出登录', () => {
      u.type === 'admin' ? session.clearAdmin() : session.clearUser();
      toast('已退出登录'); go('#/login'); render();
    }, true));
    wrap.append(menu);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  };
  wrap.append(chip);
  return wrap;
}

function topbar(activeNav, u) {
  const isAdmin = !!(u && u.type === 'admin');
  const isGuest = !u;
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;
  const nav = h('nav', { class: 'mainnav' },
    navItems.map((n) => h('a', { href: n.href, class: n.nav === activeNav ? 'active' : '', text: n.label }))
  );
  const right = h('div', { class: 'topbar-right' });
  if (isGuest) {
    // 游客：右上角提供登录入口；管理后台入口也可直接进
    right.append(h('button', { class: 'btn btn-ghost btn-sm', text: '管理后台', onClick: () => { sessionStorage.setItem('cm_login_role', 'admin'); go('#/admin'); }, title: '进入管理员视图' }));
    right.append(h('button', { class: 'btn btn-primary btn-sm', text: '登录', onClick: () => go('#/login') }));
  } else if (isAdmin) {
    right.append(h('button', { class: 'btn btn-ghost btn-sm', text: '返回前台', onClick: () => go('#/home'), title: '以管理员身份浏览集市（只读）' }));
    right.append(userMenu(u));
  } else {
    right.append(h('button', { class: 'btn btn-ghost btn-sm', text: '管理后台', onClick: () => { sessionStorage.setItem('cm_login_role', 'admin'); go('#/admin'); }, title: '进入管理员视图' }));
    right.append(userMenu(u));
  }
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('div', { class: 'logo', onClick: () => go(isAdmin ? '#/admin' : '#/home') },
        h('div', { class: 'logo-mark', text: '集' }),
        h('div', { class: 'logo-text', text: '校园集市' }),
        h('div', { class: 'logo-sub', text: '校园二手交易平台' })
      ),
      nav, right
    )
  );
}

// ---------- 渲染 ----------
let currentCleanup = null;
async function render() {
  const { route, params } = matchRoute(window.location.hash);
  const onAdminRoute = route.path.startsWith('/admin');
  // 身份解析：管理路由用管理员会话；前台优先学生身份（游客 = 两者皆无）
  const u = onAdminRoute ? session.admin : (session.user || session.admin || null);
  const loggedIn = !!u;

  // 游客访问需要登录的前台页面（发布/我的商品/订单/评价/个人中心）→ 登录引导
  if (!onAdminRoute && route.auth && !loggedIn) {
    app.replaceChildren(topbar(route.nav, null), h('main', { class: 'page' },
      h('div', { class: 'card', style: { maxWidth: '560px', margin: 'var(--space-24) auto' } },
        h('h3', { class: 'card-title', text: '该功能需要登录' }),
        h('p', { class: 'muted', text: '登录后即可发布闲置、下单、评价与查看个人中心。游客仍可自由浏览集市。' }),
        h('div', { class: 'flex-gap mt-16' },
          h('button', { class: 'btn btn-primary', text: '去登录', onClick: () => go('#/login') }),
          h('button', { class: 'btn btn-ghost', text: '继续逛集市', onClick: () => go('#/home') })
        )
      )
    ));
    return;
  }

  // 登录页本身：已登录则回首页/看板；未登录正常渲染
  if (window.location.hash === '#/login') {
    if (loggedIn) { window.location.hash = u.type === 'admin' ? '#/admin' : '#/home'; return; }
    app.replaceChildren(authView.render());
    return;
  }
  // 管理路由但没有管理员身份
  if (onAdminRoute && (!u || u.type !== 'admin')) {
    const hasUser = !!session.user;
    app.replaceChildren(topbar(route.nav, session.admin || session.user || null), h('main', { class: 'page' },
      h('div', { class: 'card' },
        h('h3', { class: 'card-title', text: '需要管理员权限' }),
        h('p', { class: 'muted', text: hasUser
          ? '当前标签页尚未登录管理员。双会话设计下，学生与管理员登录互不影响——登录管理员不会退出你这名学生。'
          : '管理后台仅供管理员使用，请先登录管理员账号（演示账号 admin / 123456）。' }),
        h('div', { class: 'flex-gap mt-16' },
          h('button', { class: 'btn btn-primary', text: '去管理员登录', onClick: () => { sessionStorage.setItem('cm_login_role', 'admin'); go('#/login'); } }),
          h('button', { class: 'btn btn-ghost', text: '返回集市', onClick: () => go('#/home') })
        )
      )
    ));
    return;
  }
  // 学生专属页面：管理员身份（只读浏览）不参与实名认证与交易，直接给说明页
  if (route.auth && !onAdminRoute && u.type === 'admin') {
    app.replaceChildren(topbar(route.nav, u), h('main', { class: 'page' },
      h('div', { class: 'card', style: { maxWidth: '640px', margin: 'var(--space-24) auto' } },
        h('h3', { class: 'card-title', text: '该页面面向学生用户' }),
        h('p', { class: 'muted', text: '管理员账号不参与实名认证、商品发布与买卖交易，因此无需使用此页面。如需复核用户的实名信息，请前往「用户管理」。' }),
        h('div', { class: 'flex-gap mt-16' },
          h('button', { class: 'btn btn-primary', text: '返回数据看板', onClick: () => go('#/admin') }),
          h('button', { class: 'btn btn-ghost', text: '浏览二手集市', onClick: () => go('#/home') })
        )
      )
    ));
    return;
  }

  const main = h('main', { class: 'page' });
  app.replaceChildren(topbar(route.nav, u), main);

  try {
    const cleanup = await route.view(main, params);
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    if (err && err.status === 401) return; // 会话过期已由 api 层处理
    main.replaceChildren(h('div', { class: 'card' }, h('p', { text: '页面加载失败：' + (err.message || err) })));
  }
}

window.addEventListener('hashchange', () => { if (currentCleanup) { try { currentCleanup(); } catch {} currentCleanup = null; } render(); });
window.addEventListener('auth:expired', () => { toast('登录已过期，请重新登录', 'error'); window.location.hash = '#/login'; render(); });
window.addEventListener('admin:expired', () => { toast('管理员登录已过期，请重新登录', 'error'); window.location.hash = '#/login'; render(); });

/** 供视图在改动会话信息（昵称/头像等）后调用：整页重渲染，顶栏与内容区即时同步 */
export function rerender() { render(); }

// ---------- 启动 ----------
async function boot() {
  session.migrateLegacy(); // 旧版管理员会话迁移到本标签页的管理员槽位
  try { META = await api.get('/api/meta', { auth: false }); } catch {}
  if (!window.location.hash) {
    // 游客/学生默认进集市首页；仅管理员（且无学生会话）默认进数据看板
    window.location.hash = session.adminToken && !session.user ? '#/admin' : '#/home';
  }
  render();
}
boot();

export { modal, formDialog, confirmDialog, toast };
