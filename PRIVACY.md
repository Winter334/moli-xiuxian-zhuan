# Moli Xiuxian Zhuan Privacy Policy / 茉莉修仙传隐私政策

[English](#english) | [简体中文](#简体中文)

## English

Last updated: October 1, 2026.

| Item | Details |
| --- | --- |
| Service name | Moli Xiuxian Zhuan (茉莉修仙传) |
| Operator | 流萤白沙 |
| Privacy contact email | [ws@lyrashore.com](mailto:ws@lyrashore.com) |
| Server hosting provider and primary data storage location | netup; United States |
| Retention period for server, reverse proxy, and security access logs | 3 months for all listed categories |
| Database backups | Not enabled |

This policy explains how the Moli Xiuxian Zhuan Discord Activity and its supporting game servers
process your information. "We" refers to the operator identified above.
This policy does not replace the privacy policies of Discord, the code repository platform,
or the server providers. For the rules governing use of the game, see our
[Terms of Service](https://gist.github.com/Winter334/19ec9f8a5fc4f18046a6f0732a0eecaa#english).

### 1. Information We Process

#### Discord Identity and Login Information

- With your authorization, we use Discord's `identify` permission to obtain your user ID,
  username, global display name, and avatar identifier. Your user ID links you to your game character;
  your name and avatar are displayed in your own character interface.
  If no global display name is available, we use your username. We do not retrieve server-specific nicknames.
- The server stores the Discord application ID, user ID, corresponding game character ID,
  and the time when the account link was created.
  Discord names, avatar identifiers, and avatar images are not currently written to the game's business database.
- Authorization codes, PKCE verification information, and Discord access tokens are used to complete login.
  These credentials are processed only in memory during login and while the application is running,
  and are not written to character saves. We do not currently persist Discord access or refresh tokens.
- Game session tokens remain only in the running client's memory.
  The server stores a one-way digest of each token, its account link, and its expiration time.
  A session is valid for at most four hours and may expire earlier, requiring reauthorization.
- Activity startup context, such as the instance, frame, and desktop or mobile platform,
  is used to establish the Discord SDK connection. It is not used to assign character ownership
  or track other players' locations.

The application does not ask you to provide your Discord password, account login token,
or payment information. It does not request permissions to read private messages, chat content,
voice, video, contacts, email addresses, or server member lists.

#### Game Data

- Character IDs, character state, cultivation realm and progression, equipment and items,
  in-game currency, current activities, in-game history, recent game records, and save times
  are used to run and restore the game.
- Cloud save versions, game timing, request IDs, and content digests are used to verify saves,
  handle duplicate requests, and prevent save conflicts.
- When you use available consignment or reincarnation features, we process the corresponding orders,
  changes to game assets, completed trade records, items or proceeds awaiting collection,
  and operation receipts to confirm outcomes and prevent duplicate settlement.
  These transactions involve only virtual in-game assets, not bank card or real-world payment data.

The application does not upload the entire combat process to the server every second,
and it does not collect Discord chat history as game history.

#### Local Storage

The game stores character progress, pending operations, and necessary synchronization state
in local storage on your device or in Discord's embedded browser.
Activity saves are separated by Discord application ID and user ID.
Interface preferences, such as music volume and log display settings, are also stored locally
and are not currently uploaded to the game server.

Local storage is used for game saves, not advertising tracking.
Activity authentication does not currently depend on cross-site cookies.
Clearing local storage does not automatically delete server-side accounts or cloud saves,
and progress that has not been uploaded may become unrecoverable.

#### Technical Information and Information You Provide

Providing network services necessarily involves connection and request information.
Discord proxies, server hosting, or reverse proxy infrastructure may process IP addresses,
browser or client types, request times, request paths, response statuses, and error information.
The game's business database does not currently maintain dedicated records of IP addresses or browser profiles.
Log retention periods for the actual deployment are listed at the beginning of this policy.
Operational logs should not record authorization codes, access tokens, game session tokens,
or complete save request bodies.

If you contact us by email, we process the email address, description, and necessary attachments
you provide solely to communicate with you, verify your request, and address it.
Please do not send passwords, tokens, identity documents, or personal information unrelated to the issue.

### 2. How We Use Information

We process necessary information only for the following purposes:

- Verify your Discord identity, connect you to your own character, and display your name and avatar.
- Provide local gameplay, cloud backups, character restoration, and game features that are actually available.
- Handle save conflicts, network retries, in-game asset settlement, and basic integrity checks.
- Troubleshoot problems, protect service security, prevent abuse, and respond to your requests.
- Meet obligations imposed by applicable law.

Where applicable law requires a legal basis, we process information as necessary to provide the service
you request, for legitimate interests in maintaining security, or to meet legal obligations.
If separate consent is required, we will seek it before processing.
We do not sell or rent your personal information or use it for targeted advertising,
profiling users' relationships, or training artificial intelligence models.
We have not currently integrated advertising, third-party user behavior analytics, or cross-site tracking tools.

### 3. Who May Access Information

- **Discord** provides authorization, the Activity container, network proxies, and avatar resources.
  We do not upload character saves to Discord's API as a game business function,
  but Activity webpages and game API communications may pass through Discord's proxy infrastructure.
  Discord's processing for these services is governed by its own
  [Privacy Policy](https://discord.com/privacy).
- **Infrastructure providers and necessary operations personnel** may process information
  only as needed for hosting, networking, backups, troubleshooting, or security maintenance.
  They must not use it for their own advertising or other unrelated purposes.
- **Recipients required by law** may receive necessary information when applicable law requires disclosure,
  with the scope of disclosure limited accordingly.

The application has not yet integrated verified Discord identities into public leaderboards
or consignment display names, and does not make complete saves available to other players.
If future features need to display your Discord name, avatar, or game information that can be linked
to your identity to other players, we will first update this policy, clearly explain the public fields
within those features, and obtain any required authorization.
Discord controls its own display of Activity participants.

Publishing code or policy documents does not mean publishing player data.
Account tables, actual saves, operational database backups, and logs containing player information
should not be committed to public repositories. If you visit the code repository website,
that website also processes visit information under its own policy.
Do not submit personal information, tokens, or complete saves in public issues.

### 4. Retention and Security

Account links and the latest cloud saves are retained for as long as necessary to provide account
and character services. We will promptly delete them upon a valid deletion request,
when the information is no longer necessary, or when the service ceases operation,
unless applicable law specifically requires retention of particular information.
Current cloud saves are not a complete version history.
In-game trade records and operation receipts may be stored separately to resolve pending operations,
duplicate requests, or disputes. They should be deleted or de-identified once their purpose is fulfilled
and no other lawful retention need remains.

Session expiration means the session can no longer authenticate requests;
it does not mean the corresponding digest record has automatically been removed from the database.
These records are retained only for authentication and necessary security checks,
and should be removed when they no longer serve a purpose.
Technical logs are retained for three months and then deleted.
Separate database backups are not enabled. Game cloud saves store current character data;
they are not historical database backups.
If server-side data is lost, no database backup is available for recovery.

Local saves normally remain until you clear the relevant storage or the client or operating system clears it.
We cannot directly remove every local copy on your devices.
Server-side deletion requests and local cleanup on your devices must be handled separately.

We use security measures appropriate to the scale of this service, including HTTPS transmission
for the deployed service, server-side identity verification, access restrictions, and storage of session digests.
We do not promise absolute security or that saves will never be lost.
If a security incident requires notification by law, we will notify affected users and relevant authorities
as required.

### 5. Your Choices and Requests

You may decline Discord authorization, stop using the game, and revoke authorization through
Discord's authorized application settings. Revocation is not itself a deletion request to us
and does not automatically clear local or server-side saves.

You may use the privacy contact email above to request information about, access to, correction of,
or deletion of information linked to you. Depending on applicable law, you may also have rights
to export information, restrict or object to processing, withdraw consent, and complain to a supervisory authority.
Withdrawal of consent applies to processing based on consent and does not affect lawful processing before withdrawal.

Please state the type of request and include your Discord user ID where needed.
To prevent someone else from deleting your character, we may require the minimum necessary verification
through the corresponding Discord account. We will not ask for account passwords, access tokens,
or unnecessary identity documents.
We will verify and handle requests within the time required by applicable law.
If any information must legally be retained, we will explain the reason and scope.
There is currently no self-service deletion interface; the operator handles deletion requests manually.

Deletion may make characters and progress unrecoverable.
Removing an account link or clearing a local save alone is not complete deletion.
If you request deletion of all linked data, we will check account links, sessions, cloud saves,
related receipts, and other necessary records, and address your identity information
in trade records involving other players.
Lawfully de-identified statistics or ledger entries that can no longer be linked to you
are not restorable personal saves.
Reauthorizing the service after deletion may create a new character.

### 6. Age Requirements and Data Locations

You must meet Discord's minimum age requirement in your region and the requirements of applicable law.
Where guardian consent is legally required, you must obtain it first.
We do not actively collect information from children below the minimum age.
If we discover such information, we will verify the circumstances and promptly handle or delete it
in accordance with applicable law.

The primary location of game data is listed at the beginning of this policy.
Discord and other necessary providers may process information in other regions.
Cross-region processing should comply with applicable data protection requirements.
We will update this policy when the actual providers or locations change materially;
using the game does not mean waiving applicable privacy rights.

### 7. Policy Updates and Contact

Updates will be published at the same public address, with the last updated date revised.
Material changes to processing purposes, public disclosure, or service providers will be announced
through available channels such as the game or official announcements.
Where renewed consent is required, continued use alone will not replace that consent.

For privacy questions, correction requests, or deletion requests, contact the operator
and privacy email listed at the beginning of this policy.

---

## 简体中文

最后更新：2026年10月1日。

| 项目 | 内容 |
| --- | --- |
| 服务名称 | 茉莉修仙传 |
| 运营者 | 流萤白沙 |
| 隐私联系邮箱 | [ws@lyrashore.com](mailto:ws@lyrashore.com) |
| 服务器托管提供方及主要数据存储地区 | netup；美国 |
| 服务器、反向代理及安全访问日志保留期限 | 均为3个月 |
| 数据库备份 | 不启用 |

本政策说明茉莉修仙传的 Discord Activity 及配套游戏服务器如何处理您的信息。
“我们”指上述运营者。本政策不替代 Discord、代码仓库平台或服务器提供方自己的隐私政策。
游戏使用规则请参阅[服务条款](https://gist.github.com/Winter334/19ec9f8a5fc4f18046a6f0732a0eecaa#简体中文)。

### 1. 我们处理哪些信息

#### Discord 身份及登录信息

- 经您授权，通过 Discord 的 `identify` 权限获取用户 ID、用户名、全局显示名及头像标识。
  用户 ID 用于对应您的游戏角色，名字和头像用于本人角色界面展示。
  全局显示名缺失时使用用户名，不读取服务器专属昵称。
- 服务器保存 Discord 应用 ID、用户 ID、对应的游戏角色 ID 及账号关联建立时间。
  当前不把 Discord 名字、头像标识或头像图片写入游戏业务数据库。
- 授权码、PKCE 校验信息及 Discord 访问令牌用于完成登录。
  这些凭据仅在登录流程及运行中的内存里处理，不写入角色存档；
  当前不持久保存 Discord 访问令牌或刷新令牌。
- 游戏会话令牌只保留在客户端运行内存中；服务器保存其不可直接还原的摘要、
  账号关联和失效时间。会话最多有效4小时，也可能更早失效，需要重新授权。
- Activity 实例、界面框架及桌面或手机平台等启动上下文用于建立 Discord SDK 连接，
  不用于决定您的角色归属或追踪其他玩家的位置。

本应用不要求您提供 Discord 密码、账号登录令牌或支付信息；
不申请读取私信、聊天内容、语音、视频、联系人、邮箱或服务器成员名单的权限。

#### 游戏数据

- 角色 ID、角色状态、境界与成长、装备和物品、游戏内货币、当前活动、
  游戏内履历、近况记录及保存时间等，用于运行和恢复游戏。
- 云存档版本、游戏计时、请求编号及内容摘要，用于核对保存、处理重复请求和防止存档冲突。
- 在实际使用已开放的寄售或轮回功能时，处理相应的订单、游戏资产变更、
  成交记录、待领取物品或货款及操作回执，用于确认结果和避免重复结算。
  这里的交易仅指游戏内虚拟交易，不涉及银行卡或现实支付数据。

本应用没有逐秒向服务器上传全部战斗过程，也没有收集 Discord 聊天历史作为游戏履历。

#### 本地存储

游戏在您的设备或 Discord 内嵌浏览器的本地存储中保存角色进度、待确认操作及必要的同步状态。
Activity 存档按 Discord 应用 ID 和用户 ID 区分；音乐音量、日志显示等界面偏好也保存在本地。
界面偏好当前不上传到游戏服务器。

本地存储用于游戏保存，不用于广告追踪。Activity 身份认证当前不依赖跨站 Cookie。
清除本地存储不会自动删除服务器上的账号或云存档，也可能使尚未上传的进度无法恢复。

#### 技术信息及您主动提供的信息

提供网络服务必然涉及连接和请求信息。Discord 代理、服务器托管或反向代理设施可能处理
IP 地址、浏览器或客户端类型、请求时间、访问路径、响应状态及错误信息。
当前游戏业务数据库不专门保存 IP 地址或浏览器画像；实际部署设施的日志期限见本政策顶部。
运营日志不应记录授权码、访问令牌、游戏会话令牌或完整存档请求正文。

如果您通过联系邮箱反馈问题，我们会处理您主动提供的邮箱、说明和必要附件，
仅用于沟通、核实和处理请求。请勿发送密码、令牌、身份证件或与问题无关的个人资料。

### 2. 信息用途

我们仅为以下目的处理必要的信息：

- 核实 Discord 身份，将您连接到自己的角色，并展示本人名字和头像。
- 提供本地游玩、云备份、角色恢复及实际开放的游戏内功能。
- 处理存档冲突、网络重试、游戏内资产结算和基础完整性检查。
- 排查故障、保护服务安全、防止滥用，以及答复您的请求。
- 履行适用法律规定的义务。

需要适用法律规定的处理依据时，我们依据提供您所请求服务的必要性、
维护安全的合法利益或法定义务处理信息；需要另行同意的事项会在处理前征求同意。
我们不出售或出租您的个人信息，不用于定向广告、用户关系画像或训练人工智能模型。
当前未接入广告、第三方用户行为分析或跨站追踪工具。

### 3. 谁可能接触信息

- **Discord**：提供授权、Activity 容器、网络代理和头像资源。
  业务上我们不向 Discord API 上传角色存档，但 Activity 网页与游戏 API 通信可能经过
  Discord 的代理设施。Discord 对这些服务的处理适用其自己的
  [隐私政策](https://discord.com/privacy)。
- **基础设施提供方及必要的运维人员**：仅在提供托管、网络、备份、
  故障排查或安全维护所必需的范围内处理信息，不得将这些信息用于自己的广告或其他无关目的。
- **法律要求的接收方**：在适用法律确实要求时提供必要信息，并限制披露范围。

当前本应用尚未将正式 Discord 身份接入公共榜单或寄售显示名，不向其他玩家开放完整存档。
如果后续功能需要向其他玩家展示您的 Discord 名字、头像或可关联身份的游戏信息，
我们会先更新本政策，并在相关功能中明确公开范围、取得适用要求的授权。
Discord 自身显示 Activity 参与者的行为由 Discord 控制。

公开代码或政策文档不等于公开玩家数据。账号表、真实存档、运营数据库备份和包含玩家信息的
运行日志不应提交到公开仓库。您若访问代码仓库网站，该网站还会按自己的政策处理访问信息；
请勿在公开 Issue 中提交个人资料、令牌或完整存档。

### 4. 保存期限及安全

账号关联与最新云存档在提供账号和角色服务所必要的期间保存，
在您提出有效删除请求、信息不再必要或服务停止运营时及时删除，
除非适用法律明确要求保留特定信息。
当前云存档不是完整版本历史；游戏内交易和操作回执可能独立保存，用于核对未结操作、
处理重复请求或争议，目的完成且无其他合法保留需要后应删除或去标识化。

会话到期意味着不能继续用于认证，不意味着相关摘要记录已自动从数据库清除。
这些记录只为认证和必要的安全核查保留，失去用途后应清理。
技术日志保留3个月，到期删除。
当前不启用独立数据库备份；游戏云存档保存当前角色数据，不是数据库历史备份。
服务器端数据丢失时，没有数据库备份可用于恢复。

本地存档通常保留到您清除相关存储，或客户端、操作系统清理它为止。
我们无法直接替您删除所有设备上的本地副本；服务器删除请求与设备本地清理需要分别处理。

我们采用与此服务规模相适应的安全措施，包括上线服务的 HTTPS 传输、
服务端身份核实、访问范围限制及会话摘要存储，但不承诺绝对安全或存档永不丢失。
若发生依法需要通知的信息安全事件，我们会按适用要求通知受影响用户及相关机构。

### 5. 您的选择及请求方式

您可以拒绝 Discord 授权、停止使用游戏，并通过 Discord 的已授权应用设置撤销授权。
撤销授权不等于已经向我们提出删除请求，也不会自动清除本地或服务器存档。

您可以通过顶部的隐私联系邮箱申请了解、获取、更正或删除与您关联的信息。
根据适用法律，您还可能享有导出、限制处理、反对处理、撤回同意及向监管机构投诉的权利；
撤回同意适用于以同意为依据的处理，不影响撤回前的合法处理。

请说明请求类型及必要的 Discord 用户 ID。为防止别人删除您的角色，
我们可能要求通过对应 Discord 账号作最小必要的身份确认；
不会要求提供账号密码、访问令牌或不必要的身份证明材料。
我们会在适用法律要求的期限内核实和处理请求；有依法需要保留的部分时说明理由及范围。
目前没有自助删除入口，删除请求由运营者人工处理。

删除可能导致角色和进度无法恢复。仅取消账号关联或清除本地存档不等于完整删除；
如您请求删除全部关联数据，我们会核对账号关联、会话、云存档、相关回执及其他必要记录，
并处理与其他玩家相关的交易记录中您的身份信息。
已依法去标识化且无法再关联到您的统计或账目不属于可恢复的个人存档。
删除完成后重新授权使用服务可能创建新角色。

### 6. 年龄要求及数据所在地

您必须达到 Discord 在您所在地区规定的最低使用年龄，并满足适用法律的要求；
依法需要监护人同意时，应先取得同意。
我们不主动向未达到最低年龄的儿童收集信息；
如发现此类信息，会核实并按适用法律及时处理或删除。

主要游戏数据存储地区见顶部。Discord 及其他必要提供方可能在其他地区处理信息。
跨地区处理应遵守适用的数据保护要求；实际提供方或地区发生重要变化时会更新本政策，
不能把使用游戏视为放弃适用的隐私权利。

### 7. 政策更新及联系

政策更新将在同一公开地址发布，并修改最后更新日期。
涉及处理目的、公开范围或服务提供方的重要变化，会通过游戏或官方公告等可用渠道提示；
需要重新取得同意的事项，不会仅以继续使用代替必要的同意。

任何隐私问题、信息更正或删除请求，请联系顶部列出的运营者和隐私联系邮箱。
