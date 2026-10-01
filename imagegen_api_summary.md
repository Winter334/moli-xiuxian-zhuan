# gateway.agentsky.dev — 生图 API 总结

采集日期: 2026-09-30 · 全程未鉴权只读（目录端点公开），$0 消耗
原始数据: `gw_providers.json` / `gw_models.json` / `gw_endpoints.json` / `api_openapi.json`（本目录）
目录现状: 20 provider · 105 run capability · 56 聊天面模型（较 09-22 的 47 capability 已扩容）

## 0. 两条生图通道

1. **Run API**（capability 面）: `POST https://gateway.agentsky.dev/v1/run`，按 provider+endpoint 分发，共 10 个生图端点 + 1 个抠图端点。
2. **聊天面**（模型面）: `meta/muse-image-1.0`，走 OpenAI wire 的 `/v1/responses`（Responses API）。

### Run API 通用信封

```bash
POST https://gateway.agentsky.dev/v1/run
Authorization: Bearer ast_***
Content-Type: application/json
Idempotency-Key: <任意唯一值>

{"provider":"<p>","endpoint":"<e>","input":{<端点参数>}}
```

- 响应为 run 对象: `{runId, status, price, billing{calculatedCost,actualCost,reportedCost}, output, error, providerResponse, createdAt, startedAt, completedAt}`（见 evidence/runs_raw_e002 样本）。
- 轮询 `GET /v1/run/{runId}`（未鉴权 520；runs 列表端点按 E-007 观测 404 无法收尸）。
- 计费注意（E-002/005）: 字符串校验层拒绝 $0；被上游接受的取回尝试**即使挂起也计费**；结算为时点批量扣款非实时。

## 1. Run API 生图端点（10 + 1）

### 1.1 google.image ×5 — Gemini 系文生图

计价: token（目录未挂单价，pricing_available=true，实价随 run 返回）

| endpoint | aspect_ratio | resolution | timeout |
|---|---|---|---|
| google/gemini-2.5-flash-image | 1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9 | 仅 1K | 300s |
| google/gemini-3-pro-image | 上 10 种 + 1:4,4:1,1:8,8:1（14 种） | 1K/2K/4K | 540s |
| google/gemini-3-pro-image-preview | 仅 1:1 | 1K/2K/4K | 540s |
| google/gemini-3.1-flash-image | 14 种（同 3-pro） | 1K/2K/4K | 540s |
| google/gemini-3.1-flash-image-preview | 仅 1:1 | 1K/2K/4K | 540s |

参数（5 端点同构，仅 required=prompt）:
- `prompt`* string — 自然语言描述
- `aspect_ratio` string — 缺省方形
- `resolution` string — 缺省 1K

输出: `run.output.candidates[].content.parts[].inlineData`（`.data` base64 + `.mimeType`）；其余 part 可能是文本。
请求上限 1MiB。`additionalProperties: true`（未声明的 input 字段会透传上游）。

### 1.2 openai/gpt-image-2 — gptimage.generate

计价: token（未挂单价；quality 不影响计费路由——"All qualities use the canonical GPT Image 2 billing route"）

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt`* | string ≤32000 | 描述 |
| `aspect_ratio` | string | 1:1；quality=medium 时另接受 3:2 / 2:3 |
| `resolution` | string | 仅 1K |
| `quality` | enum low/medium/high | 默认 medium |

timeout 300s, 请求 1MiB。输出: `run.output.data[0].b64_json`。

### 1.3 openai/gpt-image-2.5-{flare,sunburst} — openai.image-2.5（功能最全，生图+编辑）

计价: token（未挂单价）。timeout 630s，**请求上限 32MiB**。两变体参数完全相同。

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt`* | string ≤32000 | 描述或编辑指令 |
| `images` | array 1–16 | 编辑用参考图；元素含 `image_url`（HTTP(S) 或 data URL）或 `b64`；单张远程 ≤50MiB |
| `mask` | object | 编辑蒙版（image_url 或 b64）；必须 PNG 带透明通道、尺寸匹配首图 |
| `n` | int 1–10 | 默认 1 |
| `size` | string | `auto` 或 `宽x高`：边长 16 倍数、最长边 ≤3840、比例 ≤3:1、总像素 655360–8294400；>2560x1440 为实验性 |
| `quality` | enum low/medium/high/xhigh/max/auto | 默认 auto；高档消耗更多 output token |
| `output_format` | enum png/jpeg/webp | 默认 png |
| `output_compression` | int 0–100 | 仅 jpeg/webp |
| `moderation` | enum auto/low | 默认 auto |
| `background` | enum auto/opaque | 不支持 transparent |
| `input_fidelity` | enum high | 固定 high |
| `response_format` | enum b64_json | 仅 base64 |
| `stream` | bool | 仅生图（要求 n=1 且无 images）；SSE 带 validated 预览 + run.completed/failed 终事件；编辑流式被上游拒 |
| `partial_images` | int 0–3 | 预览帧数，需 stream=true；预览不单独计费 |

输出: `run.output.data[].b64_json` + usage（text/image input、cached input、image output token 数）。
2026-10-01 鉴权调用补记：纯生图不传 `background`；网关将它与 `mask`、
`input_fidelity` 一并判为需要 `images` 的编辑参数，否则返回
`invalid_input: mask, input_fidelity and background require images`（本次返回标价 $0）。
注意 `images[].image_url` 是**吃外部 URL 的取回口**（302 跳转不再校验，E-002 同型面）。

### 1.4 wan.image ×2 — 唯一挂明价/张的生图

| endpoint | 单价 | size | 其余参数 |
|---|---|---|---|
| wan/wan2.7-image | **$0.03/张** | 1K/2K（默认 2K） | prompt ≤5000（中英）*, n 1–4（默认 1） |
| wan/wan2.7-image-pro | **$0.075/张** | 1K/2K/4K（默认 2K） | 同上 |

timeout 300s, 1MiB。输出: 临时 URL 在 `run.output.output.choices[].message.content[].image`，张数 `run.output.usage.image_count`；**URL 为临时，需及时下载；产物带水印**。
按张计费 = 挂起也烧钱（E-002 同型：取回尝试被接受即计费）。

### 1.5 rembg/remove-background（图像编辑, 非生成）

| 参数 | 说明 |
|---|---|
| `image`* | 公网图片 URL 或 data URI |

计价: 按张、目录未挂价（pricing_available=false）。timeout 120s，请求 14MiB。
输出: 生成 PNG 的 URL（临时）。`image` 同样是取回口。

## 2. 聊天面: meta/muse-image-1.0

- `type: image`，input=text，output=text+image；56 个聊天模型中唯一的生图模型。
- wire: `openai`，native operation `POST /v1/responses`（Responses API），`input` 必填。
- addons 可用: max_output_tokens / temperature / top_p / response_format 等。
- 目录 pricing: None（动态计价，实价随响应）。
- 别名: `muse-image-1.0`。

## 3. 生图相邻（吃图片输入但输出非图）

- 视频类（图片输入）: bytedance/seedance-2.0/-2.0-fast/-2.5（token 计价）、minimax/MiniMax-H3（$0.08/s，E-003 目录价）、wan/wan2.6-i2v-flash、wan/wan2.7-i2v（$0.1/s，E-002）、wan/wan2.7-t2v、happyhorse ×2。
- 图片理解: ocr/mistral（按张）、各聊天多模态模型（image input）。
- 抠图: rembg（见 §1.5）。

## 4. 速查：最便宜生图组合

| 需求 | 选 | 价格 |
|---|---|---|
| 明价最低 | wan/wan2.7-image 1K n=1 | $0.03/张 |
| 明价最高质量 | wan/wan2.7-image-pro 4K | $0.075/张 |
| token 计价（事前无价） | gemini-2.5-flash-image / gpt-image-2 | 随 run 返回 |
| 批量多图 | gpt-image-2.5 n≤10 | token |
| 免费试错 | 无（生图无免费档；抓取类才有） | — |
