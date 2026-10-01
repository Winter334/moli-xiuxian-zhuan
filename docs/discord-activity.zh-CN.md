# Discord Activity 接入

更新：2026-10-01。

## 范围与当前状态

游戏展示名现为“茉莉修仙传”；英文政策使用拼音标识 `Moli Xiuxian Zhuan` 并保留中文名。
界面与网页标题同步改名，应用 ID、数据库及本地保存标识不随展示名变化。

用户确认以 Discord Activity 上线，本轮实施第一批：SDK 启动、真实授权与身份核实、
账号对应角色及本人头像/名字展示。代码已接，实际登录由用户测试；原本机隧道测试
尚未完成配置。用户计划改用有 Docker 的 VPS，由该机 Agent 部署，服务器入口仍待适配；
不能把代码检查或政策文档完成写成登录、部署成功。
图片补齐由另一会话推进，本批不修改美术文件或映射。

本批不包含正式部署、应用验证/Discovery、指定社群成员限制、玩家位置同步或组队；
不扩做寄售/轮回的真实双端联调，不改榜单的开发身份集合。
客户端结算与离线边界仍见[客户端结算](client-settlement.zh-CN.md)。

## 本批工作默认与实现

- 前端等待 SDK `ready`，只申请 `identify`，使用 S256 PKCE；后端以应用密钥交换授权码，
  再请求 Discord `/users/@me` 核实身份。不接受前端提交的用户 ID 作为账号依据。
- 一个应用内，同一 Discord 用户 ID 对应同一角色；频道、服务器及 Activity 实例不参与
  角色分配。不同测试/正式应用 ID 分开，不自动继承开发人物。
- 名字采用 Discord `global_name`，缺失时用 `username`，不是服务器专属昵称。
  左侧身份区与我方战斗卡显示已核实的名字、头像；无头像或图片失败时用通用用户图标。
  未登录的本机开发与隔离预览仍保留原占位，不伪造 Discord 身份。
- 自有游戏会话采用随机 Bearer 令牌，后端只存 SHA-256 摘要；有效期最多4小时，且不超过
  本次 Discord 授权有效期。Discord 令牌、自有会话令牌只留浏览器内存，不写角色存档。
  临近过期或收到401时重新授权，同页若账号/角色改变则拒绝继续向新身份提交旧角色。
  不保存 Discord refresh token，也不依赖跨站 Cookie。
- 本地存档及 Web Lock 使用 `moli.discord-save.v1:<应用ID>:<用户ID>`；读取前确认角色 ID
  与已认证账号相符，错误身份不推进、不覆盖。原 `moli.client-save.v1` 不读取或搬入。
  存档封装与角色版本未改；跨设备冲突选择界面仍在后续批次。
- Activity 使用独立本地数据库/角色 `moli_activity`，内部仍是 `moli_client` schema；
  `002_discord.sql` 只新增账号/会话表，不转换角色数据。`moli_dev`、`moli_test` 各自保留。
- `pnpm dev:activity` 构建网页后，启动回环地址的静态资源/API一体入口，默认5180，
  被占用时选用随后空闲端口。只公开 `dist/web`，不公开 Vite 源码、参考工程或本机文件。
  写请求来源必须是本应用的 `https://<应用ID>.discordsays.com`，不信任转发头中的身份。
  Activity 模式不接受开发 Cookie，不提供匿名建角。
- 构建版必须从 Discord 启动；浏览器直接打开会提示返回 Discord。
  本批入口仅用于开发隧道联调，生产模式继续拒绝启动；不是公开发布方案。
  Activity 每次启动须联网认证，已打开后的本地运行与断网保存沿用现有客户端。

主要入口：`src/ActivityApp.tsx`、`src/discord-activity.ts`、
`server/client/discord-auth.ts`、`tools/activity.ts`。

## 配置与启动

### 1. Discord 应用后台

在 [Developer Portal](https://discord.com/developers/applications) 创建开发测试应用：

1. 在 General Information / OAuth2 获取 Application / Client ID 与 Client Secret。
   密钥只放运行服务的机器配置中，不要发送到聊天、提交仓库或使用 `VITE_` 前缀。
2. OAuth2 Redirects 添加 `https://127.0.0.1`，供 SDK 授权使用；
   本批没有独立网页回调，也不需要 Bot Token。
3. 保留所需的 Installation Contexts；开发测试可以使用默认 Launch Entry Point，
   不必先制作常驻机器人或自定义启动命令。
4. URL Mappings 填入下方隧道地址后启用 Activities，勾选实际测试平台。
   手机仅横屏，可在后台设置默认 Landscape；完整移动端安全区/PIP验收留后续批次。

### 2. 本机设置

`.env` 增加如下字段，示例见根目录 `.env.example`：

```dotenv
DISCORD_CLIENT_ID=<应用ID>
DISCORD_CLIENT_SECRET=<应用密钥>
ACTIVITY_PORT=5180
ACTIVITY_DATABASE_URL=postgres://moli_activity:moli_activity_local_only@127.0.0.1:54329/moli_activity
```

启动现有 Docker 引擎，在仓库根目录依次运行：

```powershell
pnpm db:up
pnpm dev:activity
```

`db:up` 会在已有本地 PostgreSQL 中补建独立 `moli_activity` 数据库/角色，
不删除原数据库或卷。Activity 首次启动初始化该库的表；
首次成功授权才创建此账号的角色，重新登录复用原角色。
端口以启动输出为准；这里的本地口令不能用于正式服务器。

### 3. HTTPS 隧道与映射

本机安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)，
或使用已有的等价 HTTPS 隧道工具。另开终端，连接上一步实际端口：

```powershell
cloudflared tunnel --url http://127.0.0.1:5180
```

假设输出 `https://example.trycloudflare.com`，在 Activities → URL Mappings 配置：

| Prefix | Target |
| --- | --- |
| `/` | `example.trycloudflare.com` |

Target 不含 `https://`，不指向 `index.html`；API与素材同走此映射，无需再映射 `/api`。
不要启用 Application URL Override，本批来源检查只支持通过 Discord 代理运行。
隧道重启若换地址，必须更新映射；不再使用时移除临时映射，避免留给后来的域名使用者。

### 4. 登录测试

启用 Discord Developer Mode，在开发者或受邀 App Tester 账号下启动应用。
当前官方未验证 Activity 限制为成员少于25人的服务器；先用小型测试服务器。

只需确认首次授权后名字/头像正确、能够进入角色；做一次普通操作后关闭再开，
确认同一角色和本地进度仍在、没有重新抽取开局气运。
拒绝授权后应停留在登录提示并能重试；换账号不得读取前一个人的存档。
暂不以此轮登录测试验证寄售、榜单、公平性或全流程内容。

## 公开政策文档与部署准备

公开文档位于仓库根目录：[隐私政策](../PRIVACY.md)、[服务条款](../TERMS.md)。
它们是面向玩家的政策正文，按用户确认采用英文在前、简体中文在后，并提供语言跳转；
两版条款与运营信息对应，不设英文优先解释条款，后续修改须同步两版。
本节仅维护发布流程，不复制政策细节。
游戏代码可以继续私有，将这两份文档分别放入 Public Gist 或单独的公开文档仓库；
用户若选择整个项目公开，公开本身不构成代码或第三方素材的开源授权。

用户已确认运营者、联系邮箱、托管提供方、数据地区、日志期限和不开数据库备份的安排，
已同步填写中英两版并移除资料待填写提示；这些公开参数以隐私政策顶部为单一来源。
这只是按用户确认填写政策，不代表本会话已核实或配置 VPS。
部署前须落实声明的日志期限、到期清理及安全措施；
不开数据库备份不等于关闭游戏云存档，但服务器数据丢失时没有独立数据库备份可恢复。
实际部署必须能履行政策：配置私密请求渠道、人工身份核实与删除流程、
必要记录的清理方式，不把 OAuth 会话到期或撤销授权视为已经删除账号数据。
目前尚未实施该运营流程，没有自助删除入口，也没有承诺已通过合规或平台审核。

使用 Gist 时，每份文件分别创建一个 Public Gist，中英两版仍在同一文件内；
Developer Portal 填写不带固定修订号的 Gist 页面链接，后续编辑原 Gist 保持地址稳定。
当前两个 Gist 的文件名均为 `gistfile1.txt`，发布完整正文时分别改为 `PRIVACY.md`
和 `TERMS.md`，以获得 Markdown 排版和标题锚点。
用户提供的公开入口：

- Privacy Policy URL：[隐私政策 Gist](https://gist.github.com/Winter334/8ca7c46cc91721c4fba36c87dd9e19a0)。
- Terms of Service URL：[服务条款 Gist](https://gist.github.com/Winter334/19ec9f8a5fc4f18046a6f0732a0eecaa)。

本地文件的所有中英文互链已改为以上实际 Gist 页面地址，并保留对应语言锚点；
本批没有改写线上 Gist 正文，发布本地修订后须确认线上内容和语言锚点一致。
提交前使用未登录窗口确认无需账号或游戏授权即可阅读全文。
无需为 Markdown 文档单独部署页面，但仍须按 Discord 当时的后台校验与审核结果调整。
正式 Activity 还应提供易于访问的政策入口，此次仅增加仓库 README 入口，未改游戏界面。

首次公开推送前另行检查文件及已有提交历史中的密钥、真实存档、数据库备份、
玩家信息、素材授权和第三方许可；`.gitignore` 不能清除已经提交过的内容。
用户决定手动将下节的代码仓库转为公共，政策仍使用独立 Gist；
尚未审核整库素材的公开授权，公开前须确认音乐及第三方素材的授权范围。
服务器部署仍需独立补齐生产入口、固定 HTTPS 域名与数据库持久化，
不能直接把当前 `dev:activity` 当作正式生产入口。

2026-10-01完成两份政策及 README 入口，核对身份字段、令牌处理、本地/云保存和交易记录，
并参照 Discord 开发者条款确认公开访问与数据删除要求；已补齐完整英文译文、语言导航、
用户提供的运营资料和实际 Gist 互链，同步界面、登录提示与网页的游戏展示名。
已核对中英文各节、填写信息及链接，无旧名或待填写字段残留；
匿名访问两个 Gist 页面均返回200，确认其当前 `.txt` 文件还不提供所需语言锚点。
本批只改文本与链接，结果可控、可预测，未运行代码测试，线上 Gist 与 VPS 配置仍待同步核对。
官方要求见 [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)。

## 代码仓库与VPS拉取

代码仓库：[Winter334/moli-xiuxian-zhuan](https://github.com/Winter334/moli-xiuxian-zhuan)，
主分支为 `main`，本地远程名为 `origin`。创建时为私有，用户决定手动转为公共，
并手动完成首次推送；政策仍可独立使用公开 Gist，
创建代码仓库不代表 Gist 已同步、服务已部署或 Activity 已发布。

初始快照纳入当前源码、配置示例、专题文档、制作计划及已挂载的游戏美术和音乐。
`.env`、`keys.txt`、参考工程、依赖、构建产物、本地工作记录与临时数值报告不入库；
报告仅通过 `.gitignore` 排除，未删除本机文件。真实数据库由运行环境保存，不随代码推送。

改为公共仓库后，VPS Agent 可通过 HTTPS 免凭据读取，不需要配置 SSH Key。
首次拉取：

```sh
git clone https://github.com/Winter334/moli-xiuxian-zhuan.git
cd moli-xiuxian-zhuan
```

后续在服务器 checkout 内拉取更新：

```sh
git pull --ff-only origin main
```

服务器配置与持久数据库独立维护；拉取之后仍需按实际部署方式构建并重启服务。
现有生产入口限制见上节，不直接将开发命令当作生产部署。

2026-10-01初始化本地 Git `main` 并创建上述仓库，
核对入库清单、忽略规则及 GitHub 单文件大小限制，候选文本的常见凭据模式与本机配置密钥
比对未发现问题。首次整包上传超时，分批上传确认前三批后按用户要求停止，
远端尚无 `main`，只有临时默认分支 `codex-upload-bootstrap`；
完整本地提交保留，用户手动推送 `main` 后须将它设为默认分支，再删除临时分支。
仓库说明已按用户选择改为公共仓库与 HTTPS 拉取，未替用户修改可见性。
只调整忽略规则与仓库说明，未运行代码测试。

## 实际检查

2026-10-01接入上述第一批代码，新增稳定身份契约检查；六项定向用例通过，
覆盖服务端授权码/PKCE交换、只信任 Discord 用户身份、拒绝伪造身份/错误授权范围、
会话过期与应用隔离、Activity 来源检查，以及账号本地存档隔离/错误角色不覆盖。
`pnpm build` 类型检查与资源构建通过，保留已有 Zod 注释及构建块体积警告。
`pnpm dev:activity` 在缺少应用凭据时明确拒绝启动；真实 OAuth、数据库/HTTP和头像显示
未实测，当前等待服务器配置与用户登录测试。未新增真实验证角色。

## 后续批次

- 第二批：完善账号连接/恢复、换设备取档及冲突处理入口。
- 第三批：正式部署与备份配置，独立环境的寄售、轮回、榜单联调和正式身份展示。
- 第四批：桌面/横屏实际验收、发布资料、应用验证及按需要启用 Discovery。

官方依据：[首次接入](https://docs.discord.com/developers/activities/building-an-activity)、
[本地隧道与URL映射](https://docs.discord.com/developers/activities/development-guides/local-development)、
[网络与身份安全](https://docs.discord.com/developers/activities/development-guides/networking)、
[开发测试与发布限制](https://support-dev.discord.com/hc/en-us/articles/21204493235991-How-Can-Users-Discover-and-Play-My-Activity)。
