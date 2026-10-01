# 茉莉修仙传：修仙 RPG

代码仓库：[Winter334/moli-xiuxian-zhuan](https://github.com/Winter334/moli-xiuxian-zhuan)，
主分支为 `main`。公共仓库的首次推送已由用户手动完成；
VPS 拉取方式见[Activity接入](docs/discord-activity.zh-CN.md#代码仓库与vps拉取)。

公开政策（中英双语）：[隐私政策](PRIVACY.md) · [服务条款](TERMS.md)。
运营资料及 Gist 互链已填写；公开地址与部署前核对事项见[Activity接入](docs/discord-activity.zh-CN.md#公开政策文档与部署准备)。

## 当前入口

当前处于正式UI重建阶段，三栏第二稿已接入：左侧角色与快捷消耗品、中央完整系统、右侧筛选日志。
行囊、炉鼎两轮改造已获用户认可；最新修行页改为独立功法条目，设置弹窗新增日志展示条数
（50/100/200），核心日志上限升至200条，击杀与用物消息区分进账与封顶溢出并附境界差描述，
以上批次待用户体验确认。游历采用可拖动缩放的分级地图，点击地点直接到达；
战斗卡采用紧凑填充，撤退/战败后可直接再探；履历中的敌人图鉴只显示实际遭遇过的敌人。
角色版本`neko-character-9`，旧角色8拒读，不迁移或自动处置实际存档。
先体验调整UI，美术清理旧稿后按小样确认分步重做；桌面和手机横屏共用宽屏布局，
竖屏只显示转向提示。

### 设计预览

只启动前端，不需要数据库或后端：

```powershell
pnpm dev:web
```

打开开发地址的`/?preview=ui`（通常为`http://127.0.0.1:5173/?preview=ui`，端口以输出为准）。
预览只操作内存角色，不读写角色存档、不请求云端；寄售与榜单明确未联网。
音乐已接原作26首并按区域切曲；旧美术已退役，当前使用UI占位，音效未接。
详见[UI重建记录](docs/ui-rebuild.zh-CN.md)、[当前阶段](docs/current-phase.zh-CN.md)
和[推进总表](docs/project-roadmap.zh-CN.md)。

### 正常运行

正常游戏路径为`/`，沿用客户端结算、本地自动保存和低频云备份；统一公共历法，
页面关闭/挂起不补算战斗、训练、采矿，安全地点离线休整保留。
寄售与轮回的真实数据库/HTTP联调尚未完成，必须先明确独立验证环境和数据边界；
旧格式拒读，不自动迁移或处置实际角色。Discord Activity第一批身份代码已接、
真实登录待测，正式部署与发布未完成。

### Discord Activity 登录测试

配置本机 `.env` 的 `DISCORD_CLIENT_ID`、`DISCORD_CLIENT_SECRET` 后，
启动现有 Docker 引擎，运行 `pnpm db:up` 和 `pnpm dev:activity`。
使用独立 `moli_activity` 数据库，默认测试端口5180；不绑定或搬入原开发角色。
完整应用后台设置、HTTPS隧道和登录测试步骤见[Activity接入](docs/discord-activity.zh-CN.md)。

### VPS 测试部署

独立部署入口与 Docker 配置已补齐，供 VPS Agent 配置域名、密钥后部署；
当前仍是邀请测试，不代表正式运营，运营安排本批暂缓。
使用`compose.activity.yaml`及仓库外的真实配置，不使用本机开发 Compose 或示例口令。
支持可选 Caddy HTTPS，也可接现有反代；数据库使用独立持久化卷。
首次部署、更新与登录验收见[部署步骤](docs/discord-activity.zh-CN.md#vps测试部署)。

## 启动

需要 Node.js 22.12+、pnpm，以及正在运行的 Docker 引擎。

```powershell
pnpm install
pnpm db:up
pnpm play
```

默认地址：<http://127.0.0.1:5173>，端口以启动输出为准。`pnpm play` 使用 `moli_client`
schema 与 `moli_client_session` Cookie，服务端细节见[客户端结算](docs/client-settlement.zh-CN.md)。
数据库首次启动创建独立的 `moli_dev`、`moli_test` 与 `moli_activity`；API 启动自动初始化对应结构，
`pnpm db:down` 只停止数据库、不删除卷。`.env.example` 提供本机开发设置，本地示例口令
不能用于公开部署。PostgreSQL 使用 Amazon ECR 公开镜像副本（固定17.6摘要），
是本机 Docker Hub 网络超时的绕行安排。

网页通过开发 Cookie 对应一条 PostgreSQL 角色存档；相同浏览器刷新或重启服务不会重建角色，
清除 Cookie 或使用另一浏览器会创建另一名本地开发角色，目前没有账号恢复功能。
本机服务只监听回环地址；`DEV_AUTH` 须明确开启，生产模式拒绝开发身份入口。
不要将开发端口直接公开；VPS 使用上方专用部署入口。

## 验证

以下仅列出可用命令，不是每次改动的必跑清单。是否测试及执行范围遵循[项目规则](AGENTS.md)，
只在确有必要时选择最少的相关用例；不主动执行全量回归。

```powershell
pnpm typecheck
pnpm test
pnpm test:integration   # 需要 TEST_DATABASE_URL，会清空专用测试库角色
pnpm test:e2e           # 使用 moli_test，自动启动隔离服务
pnpm build
pnpm balance            # 同规则数值运行器，另有 balance:* 细分
```

两组数据库测试不要同时运行；纯规则测试不需要数据库。

## 模块与记录

| 目录 | 职责 |
| --- | --- |
| `core/` | 独立规则、确定性随机、十进制计算与版本化内容配置（`core/content/`） |
| `shared/` | 服务和界面共享的命令、展示契约 |
| `server/` | Fastify、本机开发身份、PostgreSQL 迁移与事务，见[server/README.md](server/README.md) |
| `src/` | React 界面、客户端结算与本地保存 |
| `docs/` | 阶段与专题文档，入口见[当前阶段](docs/current-phase.zh-CN.md) |
| `tools/` | 本地启动、数据库准备与同规则数值运行器 |

- 长期数值以十进制字符串传输；内容/规则/存档版本不匹配时拒绝推进，不做自动跨版本迁移。
- `references/NekoRPG` 始终只读，且不纳入本项目 Git；`keys.txt`、`.env`、
  本地生成任务记录、依赖与构建结果均被忽略。
- 美术相关：[素材清单](docs/asset-manifest.zh-CN.md)。生图接口说明与调用脚本仅保留在
  本机忽略目录`.local/imagegen/`，不随游戏代码发布或部署。
  旧素材及设计已清理；新图按当轮授权分步制作并记录，不沿用旧批量计划。
