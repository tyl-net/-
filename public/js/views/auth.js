// 登录 / 注册页
import { api, session } from '../api.js';
import { h, toast } from '../ui.js';

export function render() {
  let tab = 'login';       // login | register
  // 预选身份：从「管理后台」入口进入时直接选中管理员页签（一次性提示）
  const hint = sessionStorage.getItem('cm_login_role');
  let role = hint === 'admin' ? 'admin' : 'user';
  sessionStorage.removeItem('cm_login_role');

  const panel = h('div', { class: 'auth-box' });
  const wrap = h('div', { class: 'auth-wrap' },
    h('aside', { class: 'auth-hero' },
      h('h1', {}, '校园闲置，', h('br'), '在这里流转起来'),
      h('p', { text: '面向在校师生的校园二手交易平台，提供商品发布、浏览搜索、在线下单、平台托管支付与信用评价一站式服务。' }),
      h('div', { class: 'auth-feats' },
        feat('🛡️', '实名认证 · 信用体系', '校园卡实名后发布商品，交易后互评累积信用分'),
        feat('💰', '货款平台托管', '确认收货后自动结算，保障买卖双方权益'),
        feat('🔍', '组合检索', '关键词、类别、价格区间精确匹配心仪闲置')
      )
    ),
    h('section', { class: 'auth-panel' }, panel)
  );

  function feat(icon, title, desc) {
    return h('div', { class: 'auth-feat' },
      h('div', { class: 'auth-feat-icon', text: icon }),
      h('div', {}, h('b', { text: title }), h('span', { text: desc }))
    );
  }

  function draw() {
    const tabs = h('div', { class: 'auth-tabs' },
      ['login', 'register'].map((t) =>
        h('button', {
          class: tab === t ? 'active' : '', text: t === 'login' ? '登录' : '注册',
          onClick: () => { tab = t; draw(); },
        })
      )
    );

    const body = h('div', { class: 'form' });
    if (tab === 'login') {
      const acc = h('input', { type: 'text', placeholder: role === 'admin' ? '请输入管理员账号' : '请输入学号' });
      const pwd = h('input', { type: 'password', placeholder: '请输入密码' });
      acc.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      pwd.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

      body.append(
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: role === 'admin' ? '管理员账号' : '学号' }), acc),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '密码' }), pwd)
      );

      const btn = h('button', { class: 'btn btn-primary btn-block', text: '登 录', onClick: submit });
      async function submit() {
        if (!acc.value.trim() || !pwd.value) return toast('请填写完整账号与密码', 'error');
        btn.disabled = true; btn.textContent = '登录中…';
        try {
          const data = role === 'admin'
            ? await api.post('/api/admin/login', { account: acc.value.trim(), password: pwd.value }, { auth: false })
            : await api.post('/api/user/login', { student_no: acc.value.trim(), password: pwd.value }, { auth: false });
          const user = role === 'admin' ? data.admin : data.user;
          session.save(data.token, user, role);
          toast('登录成功，欢迎回来', 'success');
          window.location.hash = role === 'admin' ? '#/admin' : '#/home';
        } catch (e) {
          toast(e.message, 'error');
          btn.disabled = false; btn.textContent = '登 录';
        }
      }

      body.append(btn);
      body.append(h('div', { class: 'row-between small' },
        h('button', { class: 'btn-link', text: role === 'admin' ? '← 我是普通用户' : '管理员登录 →', onClick: () => { role = role === 'admin' ? 'user' : 'admin'; draw(); } })
      ));
      body.append(h('div', { class: 'auth-tip', html:
        role === 'admin'
          ? '管理员演示账号：<code>admin</code> / <code>123456</code>（超级管理员）<br>普通管理员：<code>auditor</code> / <code>123456</code>'
          : '学生演示账号（密码均为 <code>123456</code>）：<br>买家/卖家 <code>241603010213</code>（谭以勒）<br>卖家 <code>241603010301</code>（李思远）'
      }));
      body.append(h('div', { style: { textAlign: 'center', marginTop: 'var(--space-14)' } },
        h('button', { class: 'btn-link', text: '先去逛逛 · 返回集市首页 →', onClick: () => { window.location.hash = '#/home'; } })
      ));
    } else {
      const no = h('input', { type: 'text', placeholder: '如 241603010213' });
      const nick = h('input', { type: 'text', placeholder: '2~20 个字符' });
      const phone = h('input', { type: 'tel', placeholder: '选填，用于交易沟通' });
      const pwd = h('input', { type: 'password', placeholder: '至少 6 位' });
      const pwd2 = h('input', { type: 'password', placeholder: '再次输入密码' });
      body.append(
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '学号', h('i', { class: 'req', text: '*' })), no),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '昵称', h('i', { class: 'req', text: '*' })), nick),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: '手机号' }), phone),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '密码', h('i', { class: 'req', text: '*' })), pwd),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, '确认密码', h('i', { class: 'req', text: '*' })), pwd2)
      );
      const btn = h('button', { class: 'btn btn-primary btn-block', text: '注 册', onClick: submit });
      async function submit() {
        if (!/^\d{6,20}$/.test(no.value.trim())) return toast('学号应为 6~20 位数字', 'error');
        if (nick.value.trim().length < 2) return toast('昵称至少 2 个字符', 'error');
        if (pwd.value.length < 6) return toast('密码至少 6 位', 'error');
        if (pwd.value !== pwd2.value) return toast('两次输入的密码不一致', 'error');
        btn.disabled = true; btn.textContent = '注册中…';
        try {
          await api.post('/api/user/register', { student_no: no.value.trim(), nickname: nick.value.trim(), phone: phone.value.trim(), password: pwd.value }, { auth: false });
          toast('注册成功，请登录', 'success');
          tab = 'login'; draw();
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          btn.disabled = false; btn.textContent = '注 册';
        }
      }
      body.append(btn);
      body.append(h('div', { class: 'auth-tip', text: '注册后需在「个人中心」完成实名认证，方可发布商品。' }));
      body.append(h('div', { style: { textAlign: 'center', marginTop: 'var(--space-14)' } },
        h('button', { class: 'btn-link', text: '先去逛逛 · 返回集市首页 →', onClick: () => { window.location.hash = '#/home'; } })
      ));
    }

    panel.replaceChildren(h('div', { class: 'logo', style: { marginBottom: 'var(--space-22)' } },
      h('div', { class: 'logo-mark', text: '集' }),
      h('div', { class: 'logo-text', text: '校园集市' })
    ), tabs, body);
  }

  draw();
  return wrap;
}
