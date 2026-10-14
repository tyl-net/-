// 个人中心：资料维护、实名认证、修改密码
import { api, session } from '../api.js';
import { h, toast, badge, avatar, stars, timeAgo, empty, loading, formDialog, confirmDialog, fileToAvatarDataURI } from '../ui.js';
import { go } from '../app.js';

export async function render(root) {
  root.replaceChildren(loading());
  let d;
  try { d = await api.get('/api/user/profile'); }
  catch (e) { root.replaceChildren(h('div', { class: 'card' }, h('p', { text: '加载失败：' + e.message }))); return; }
  const u = d.user, s = d.stat;

  const verifyBox = u.is_verified === 1
    ? h('div', { class: 'notice notice-ok' }, h('span', { text: '✔' }), h('span', { text: '已完成实名认证，可以发布商品。' }))
    : u.is_verified === 2
      ? h('div', { class: 'notice notice-info' }, h('span', { text: '⏳' }), h('span', { text: '实名信息已提交，等待管理员复核。' }))
      : h('div', { class: 'notice' }, h('span', { text: '⚠️' }), h('span', { text: '尚未实名认证，认证通过后方可发布商品。' }),
          h('button', { class: 'btn btn-primary btn-sm', text: '立即认证', onClick: () => doVerify(load) }));

  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title', text: '个人中心' }), h('p', { class: 'page-desc', text: '维护个人资料、完成实名认证与管理账号安全' }))),
    h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: '信用分' }), h('div', { class: 'stat-value brand', text: u.credit_score })),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: '发布商品' }), h('div', { class: 'stat-value', text: s.goods_count })),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: '买到的订单' }), h('div', { class: 'stat-value', text: s.buy_count })),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: '卖出的订单' }), h('div', { class: 'stat-value', text: s.sell_count })),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: '平均评分' }), h('div', { class: 'stat-value accent', text: s.avg_score }))
    ),
    h('div', { class: 'mt-16' }, verifyBox),
    h('div', { class: 'card mt-16' },
      h('div', { class: 'flex-gap' },
        h('div', { class: 'avatar-wrap' },
          avatar(u, 62),
          h('button', { class: 'avatar-edit', title: '更换头像', onClick: () => changeAvatar(load) },
            h('span', { class: 'icon', text: '📷' }),
            h('span', { text: '更换头像' }))),
        h('div', { class: 'grow' },
          h('div', { style: { fontSize: 'var(--font-size-xl)', fontWeight: '700' } }, u.nickname,
            u.is_verified === 1 ? h('span', { class: 'badge badge-ok', style: { marginLeft: 'var(--space-8)' }, text: '已实名' }) : null),
          h('div', { class: 'small muted', text: `学号 ${u.student_no} · 注册于 ${String(u.created_at).slice(0, 10)}` })
        ),
        h('button', { class: 'btn btn-ghost', text: '编辑资料', onClick: () => edit(load) })
      ),
      h('div', { class: 'detail-attrs mt-16', style: { marginBottom: '0' } },
        attr('昵称', u.nickname), attr('学号', u.student_no), attr('手机号', u.phone || '未填写'),
        attr('邮箱', u.email || '未填写'), attr('真实姓名', u.real_name || '未认证'),
        attr('实名状态', ['未认证', '已认证', '待复核'][u.is_verified])
      )
    ),
    h('div', { class: 'card' },
      h('h3', { class: 'card-title', text: '账号安全' }),
      h('div', { class: 'row-between' },
        h('div', {}, h('div', { style: { fontWeight: '600' } }, '登录密码'), h('div', { class: 'small muted', text: '密码使用 BCrypt 级加密存储；修改后需重新登录' })),
        h('button', { class: 'btn btn-ghost', text: '修改密码', onClick: () => changePwd() })
      )
    )
  );

  function attr(k, v) { return h('div', { class: 'attr' }, h('div', { class: 'attr-k', text: k }), h('div', { class: 'attr-v', text: String(v) })); }

  async function load() { render(root); }

  // 更换头像：本地选图 → 居中裁方压缩 → 保存 → 同步本地会话
  function changeAvatar(reload) {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' } });
    document.body.append(input);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const dataURI = await fileToAvatarDataURI(file, 256);
        const res = await api.put('/api/user/profile', { avatar: dataURI });
        const cur = session.user;
        session.save(session.token, { ...cur, avatar: res.user.avatar }, cur.type);
        toast('头像已更新', 'success');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    };
    input.click();
  }

  async function edit(reload) {
    const r = await formDialog({
      title: '编辑个人资料', okText: '保存',
      values: u,
      fields: [
        { name: 'nickname', label: '昵称', required: true, value: u.nickname },
        { name: 'phone', label: '手机号', value: u.phone || '', placeholder: '用于交易沟通' },
        { name: 'email', label: '校园邮箱', value: u.email || '', placeholder: '选填' },
      ],
    });
    if (!r) return;
    try {
      const res = await api.put('/api/user/profile', r);
      // 同步本地会话
      const cur = session.user; session.save(session.token, { ...cur, ...res.user }, 'user');
      toast('资料已更新', 'success');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function changePwd() {
    const r = await formDialog({
      title: '修改密码', okText: '确认修改',
      fields: [
        { name: 'old_password', label: '原密码', required: true },
        { name: 'new_password', label: '新密码', required: true, hint: '至少 6 位' },
        { name: 'confirm', label: '确认新密码', required: true },
      ],
    });
    if (!r) return;
    if (r.new_password !== r.confirm) return toast('两次输入的新密码不一致', 'error');
    try {
      await api.post('/api/user/password', { old_password: r.old_password, new_password: r.new_password });
      toast('密码修改成功，请重新登录', 'success');
      setTimeout(() => { session.clear(); window.location.hash = '#/login'; }, 900);
    } catch (e) { toast(e.message, 'error'); }
  }
}

async function doVerify(reload) {
  const r = await formDialog({
    title: '实名认证', okText: '提交认证',
    fields: [
      { name: 'real_name', label: '真实姓名', required: true, placeholder: '需与校园卡一致' },
      { name: 'student_no', label: '校园卡学号', required: true, placeholder: '与注册学号一致以通过校验' },
    ],
    width: 460,
  });
  if (!r) return;
  try { await api.post('/api/user/verify', r); toast('实名信息已提交，等待管理员复核', 'success'); reload(); }
  catch (e) { toast(e.message, 'error'); }
}
