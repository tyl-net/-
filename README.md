# 校园集市 · 校园二手交易平台

《软件需求规格说明书》《系统设计说明书》的配套**可运行实现**。零外部依赖（仅需 Node.js ≥ 22.5，使用内置 `node:sqlite` / `node:crypto` / `node:http`），开箱即跑。

---

## 一、快速开始

```bash
cd app
npm start            # 等价于 node --no-warnings server.js
```

浏览器打开 **http://127.0.0.1:3000**（端口可用环境变量 `PORT` 覆盖）。

Windows 用户也可双击 **`启动.bat`**。

首次启动会自动创建 SQLite 数据库 `工作区/.data/market.db`（在项目目录**之外**，部署时不会随代码上传）并灌入演示数据。
如需重置为初始状态：`npm run reset`（或手动删除 `.data/market.db*`）后重启即可。

### 演示账号（密码均为 `123456`）

| 角色 | 账号 | 说明 |
| --- | --- | --- |
| 买家 / 卖家 | `241603010213` | 谭以勒，已实名，信用分 108，同时有买入与卖出的历史订单 |
| 卖家 | `241603010301` | 李思远，有多件在售商品与评价 |
| 普通用户（未实名）| `241603010607` | 赵一鸣，用于演示"未实名不能发布商品" |
| 已禁用用户 | `241603010718` | 周未然，用于演示"禁用账号无法登录" |
| 超级管理员 | `admin` | 平台超级管理员 |
| 普通管理员 | `auditor` | 内容审核员 |

---

## 二、功能实现对照

需求规格说明书中的五大功能模块全部落地：

| 模块 | 已实现功能 |
| --- | --- |
| **用户管理** | 学号注册、登录（连续 5 次失败锁定 10 分钟）、JWT 登录态（2 小时）、个人资料维护、实名认证提交与管理员复核、修改密码 |
| **商品管理** | 发布（需实名，进入待审核）、按发布时间倒序分页浏览、类别筛选、关键词 + 类别 + 价格区间组合搜索、商品详情与浏览量、编辑重审、下架/重新上架、举报 |
| **交易管理** | 在线下单、支付（货款平台托管）、卖家发货、确认收货并自动结算、订单跟踪与状态机校验、订单取消、买卖双方双视角订单列表 |
| **评价管理** | 订单完成后评价（1~5 分，一单一评）、**追加评价**（评价后可补充一次使用感受）、商品/卖家历史评价展示、卖家回复评价、信用分按评分加权自动更新 |
| **系统管理** | 运营数据统计看板（用户/商品/订单/成交额/举报 + 近 7 日趋势 + 类别分布）、商品审核（通过/驳回/强制下架）、用户查询与禁用启用、实名复核、公告发布/撤回/删除、举报处理并联动处置、审计日志 |

### 关键业务规则（与文档一致）

- **订单状态机**：待支付(0) → 待发货(1) → 待收货(2) → 已完成(3)；任一环节可取消进入终态"已取消(4)"。非法状态跃迁一律被服务端拒绝。
- **取消必填原因**：取消订单必须填写原因（1~200 字），与取消操作人一起落库并展示给对方，同时记入审计日志。
- **追加评价限一次**：评价发表后，作者可追加一次使用感受（不影响原评分与信用分）；追加内容随原评价在商品详情、卖家主页与评价中心展示。
- **货款托管**：支付后资金由平台托管，买家确认收货才结算给卖家（结算写入审计日志）。
- **审核前置**：商品发布后 `audit_status=0`，仅管理员审核通过才在集市可见。
- **实名前置**：`is_verified != 1` 的用户无法发布商品。
- **信用分规则**：以 3 分为中性，每高 1 分 +4、每低 1 分 -4，区间 [0,150]。

---

## 三、技术实现

### 分层结构

```
app/
├── server.js                 # HTTP 入口：路由装配、静态资源、全局异常处理
├── src/
│   ├── db.js                 # 建表 + 种子数据（对应设计文档 4.2 逻辑结构）
│   ├── auth.js               # scrypt 密码哈希 + JWT(HS256) 签发校验
│   ├── util.js               # 统一响应、请求体解析、路由匹配、分页
│   └── routes/
│       ├── user.js           # 用户管理模块
│       ├── goods.js          # 商品管理模块
│       ├── order.js          # 交易管理模块
│       ├── review.js         # 评价管理模块
│       └── admin.js          # 系统管理模块（管理员）
├── public/                   # 前端（原生 ES Module，无构建步骤）
│   ├── index.html
│   ├── styles.css
│   └── js/{api,ui,app}.js + js/views/*.js
├── test/
│   ├── smoke.js              # 全链路接口冒烟测试（39 项断言）
│   └── scan.js               # 括号平衡自检脚本
└── (运行数据在项目外的 .data/ 目录，自动生成、不入库不上传)
```

### 安全设计落地

- 密码 **scrypt + 随机盐** 哈希存储，校验使用 `timingSafeEqual` 防时序攻击；
- **JWT** HS256 签名，含 `exp` 有效期，服务端逐请求验签；
- **RBAC**：`requireUser` / `requireAdmin` 两级拦截，管理员接口独立鉴权；
- **双会话**：学生身份存 localStorage（跨标签页共享、持久），管理员身份存 sessionStorage（每个标签页独立）——可在两个页面分别登录学生与管理员，互不干扰；401 时只清除对应身份的会话；
- 所有用户输入**前后端双重校验**；前端统一用 `textContent` 渲染，防 XSS；
- **全局异常处理器**捕获未预期异常，返回统一错误码，不暴露内部堆栈；
- 下单/支付/收货/评价等关键写操作使用**事务**，失败自动回滚；
- 关键操作全部写入 **审计日志**。

### 数据库表

`t_user`、`t_goods`、`t_order`、`t_review`、`t_admin`（与设计文档表 1~表 5 字段一致），
另按功能需要补充 `t_announcement`（公告）、`t_report`（举报）、`t_audit_log`（审计日志）。

---

## 四、接口一览

统一响应格式：`{ "code": 0, "message": "success", "data": {...} }`，`code != 0` 即失败。

| 接口 | 方法 | 路径 |
| --- | --- | --- |
| 用户注册 | POST | `/api/user/register` |
| 用户登录 | POST | `/api/user/login` |
| 当前用户资料 | GET | `/api/user/profile` |
| 修改资料 / 密码 | PUT / POST | `/api/user/profile` · `/api/user/password` |
| 实名认证提交 | POST | `/api/user/verify` |
| 卖家主页 | GET | `/api/user/:id` |
| 商品发布 | POST | `/api/goods` |
| 商品浏览 | GET | `/api/goods` |
| 商品搜索 | GET | `/api/goods/search` |
| 我的商品 | GET | `/api/goods/mine` |
| 商品详情 / 评价 | GET | `/api/goods/:id` · `/api/goods/:id/reviews` |
| 编辑 / 下架 / 上架 | PUT | `/api/goods/:id` · `/api/goods/:id/offline` · `/api/goods/:id/online` |
| 创建订单 | POST | `/api/order` |
| 订单支付 | POST | `/api/order/pay` |
| 卖家发货 | PUT | `/api/order/ship` |
| 确认收货 | PUT | `/api/order/confirm` |
| 取消订单 | PUT | `/api/order/cancel` |
| 订单列表 / 详情 | GET | `/api/order` · `/api/order/:id` |
| 发表评价 | POST | `/api/review` |
| 追加评价 | PUT | `/api/review/:id/additional` |
| 卖家回复评价 | POST | `/api/review/:id/reply` |
| 我的评价 | GET | `/api/review/mine` |
| 举报 | POST | `/api/report` |
| 管理员登录 | POST | `/api/admin/login` |
| 数据统计 | GET | `/api/admin/stats` |
| 商品审核 / 下架 | PUT | `/api/admin/goods/audit` · `/api/admin/goods/offline` |
| 用户管理 | GET / PUT | `/api/admin/users` · `/api/admin/users/status` · `/api/admin/users/verify` |
| 公告管理 | GET/POST/PUT/DELETE | `/api/admin/announcements` |
| 举报处理 | GET / PUT | `/api/admin/reports` · `/api/admin/reports/handle` |
| 审计日志 | GET | `/api/admin/logs` |
| 公共元数据 / 公告 / 概览 | GET | `/api/meta` · `/api/announcements` · `/api/stats/overview` |

---

## 五、测试

启动服务后依次执行（均为零依赖脚本）：

```bash
node --no-warnings test/smoke.js          # 接口全链路：39 项断言
node --no-warnings test/browser-check.js  # 真实浏览器端到端：39 项断言（需本机已装 Chrome）
node --no-warnings test/admin-guard.js    # 管理员越权防护：18 项（401/403 语义 + 前端守卫）
node --no-warnings test/order-review-v11.js  # v1.1 回归：取消必填原因 + 追加评价（22 项）
node --no-warnings test/auth-channels.js  # 鉴权多通道容错：6 项
node --no-warnings test/write-check.js    # 数据写入与约束：6 项
node --no-warnings test/scan.js <file>    # 括号平衡自检（辅助定位语法错误）
```

`smoke.js` 串联完整业务链路：注册 → 登录 → 发布 → 审核 → 搜索 → 下单 → 支付 → 发货 →
确认收货 → 评价 → 回复 → 统计 → 用户禁用 → 公告 → 举报处理 → 审计日志，
并包含权限拦截、状态机拦截、重复下单、一单一评等**负向用例**。

`browser-check.js` 通过 Chrome DevTools 协议逐页加载买家端／卖家端／管理后台全部 15 个页面，
断言关键内容渲染成功、验证搜索等交互生效，并捕获 JS 异常与 `console.error`，
同时把每个页面截图存到 `screenshots/`。

### 设计规范校验

```bash
node tools/export-tokens.mjs     # 令牌真源 tokens.css → tokens.json（机器可读）
node test/design-lint.js         # 一致性断言：源码中不得出现裸色值/裸字号/裸间距/裸圆角
node test/contrast-audit.js      # WCAG 2.1 对比度实算 → contrast.json
npm run check:design             # 以上三步串联
node test/shot-design-system.js  # 规范站分屏截图（需服务已启动）
```

`design-lint.js` 对 `public/styles.css` 的 **456 条声明**逐条判定，
并对 `public/js/` 内联样式做静态扫描；当前 **违规 0 条**。
`contrast-audit.js` 审计 **28 组关键前景/背景组合**，当前 **28/28 全部满足 AA**。

---

## 六、设计规范系统

规范站地址：`/design-system/`（随服务一起发布，与产品同源、同一批令牌）。

### 三层令牌

| 层 | 作用 | 目录 |
| --- | --- | --- |
| Tier 1 基础层 | 与业务无关的原始色板与刻度 | `public/design-system/tokens.css` |
| Tier 2 语义层 | 描述用途的角色变量，**产品代码只引用这一层** | 同上 |
| Tier 3 组件层 | 组件专属别名，便于单点微调 | 同上 |

共 **252 个令牌**（T1 161 / T2 48 / T3 43），其中 **205 个已生效**（含经别名链间接引用）。

### 目录结构

```
public/design-system/
├── tokens.css       ← 唯一真源（手写）
├── tokens.json      ← 机器可读导出（tools/export-tokens.mjs 生成）
├── contrast.json    ← 对比度审计结果（test/contrast-audit.js 生成）
├── index.html       ← 规范站：概览/色彩/排印/间距/圆角/阴影/动效/组件/无障碍/响应式/令牌索引
├── system.css       ← 规范站自身样式（同样只引用令牌，自我验证）
└── system.js        ← 从 tokens.json 实时渲染，改令牌即改规范页
```

### 规范站能力

- **11 个章节**，含组件库全状态（默认/悬停/聚焦/禁用）、数据展示、空状态与骨架屏；
- **对比度计算器**：任选前景/背景令牌，按 WCAG 公式实时算分并给出 AA / AA 大字 / AAA 判定；
- **令牌索引**：252 个令牌可搜索、可按层级筛选，点击任意行复制 `var(--name)`，
  “引用”列显示产品源码中的实际使用次数；
- **响应式实景**：内嵌真实产品页面，一键切换 390 / 768 / 1180 / 自适应；
- 解决的实际问题：审计发现 13 处对比度不达标（如主按钮白字青底仅 3.30:1）已全部修正，
  并将 106 处硬编码色值、19 处字号、54 处间距、15 处圆角全部收敛为令牌。

---

## 七、部署说明

已按云平台要求适配：

- 服务监听 `process.env.PORT`（默认 3000）并绑定 `0.0.0.0`；
- 存储使用随项目运行的 SQLite，无需外部数据库；若运行环境文件系统不可写，
  会自动回退到内存数据库（数据不持久化但不影响演示）；
- **鉴权通道容错**：部分云平台的反向代理会注入／覆写 `Authorization` 头，
  若只读该头会导致「刚登录就 401」。因此服务端会依次尝试
  `Authorization` → `X-Auth-Token` → `cm_token` Cookie → `?token=`，
  **取第一个验签通过的**；前端同时通过自定义头与 Cookie 发送令牌。
- `/api/diagnostics` 返回鉴权头到达情况与密钥指纹，便于排查部署环境问题。

---

## 八、与课程作业的对应

| 作业 | 文档 | 在本系统中的落点 |
| --- | --- | --- |
| 作业一 | 软件需求规格说明书 | 五大模块功能、性能与安全需求 → 全部实现 |
| 作业二 | 数据流图 / 用例图 / E-R 图 / 功能结构图 | 用例 → 前端页面与接口；E-R → 数据库表与联系；DFD → 各路由处理逻辑 |
| 作业三 | 系统设计说明书 | 五层架构 → 前后端分层；表 1~5 → SQLite 表结构；表 6 接口 → REST 路由；出错处理与安全设计 → 全局异常/事务/JWT/RBAC/审计日志 |
| 设计规范 | UI 设计规范 | 三层令牌体系 + 规范站 `/design-system/`；一致性由 lint 断言，无障碍由对比度审计实算 |
