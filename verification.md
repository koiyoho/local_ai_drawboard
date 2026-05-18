# Verification

日期：2026-04-26  
执行者：Codex

## Commands

- `npm run db:generate`：通过，生成 Prisma Client。
- `npm run db:init`：通过，创建 `prisma/dev.db`。
- `npm run lint`：通过。
- `npm run build`：通过，Next.js 16 生产构建成功。
- `node scripts/smoke-home.mjs`，环境变量 `SMOKE_BASE_URL=http://localhost:3011`：通过，首页 H1 为 `AI Board`，截图写入 `tmp/home.png`。
- `node scripts/smoke-board.mjs cmoffw0ta0000lclwf7iiy5mb`，环境变量 `SMOKE_BASE_URL=http://localhost:3011`：通过，画板 H1 为 `Smoke board`，截图写入 `tmp/board.png`。
- `curl.exe -X POST http://localhost:3011/api/assets ...`：通过，本地图片上传写入数据库和 `public/uploads`。
- `PUT /api/boards/:boardId/snapshot`：通过，返回 `{ "ok": true, "version": 1 }`。
- `POST /api/generation-jobs` 未配置 `OPENAI_API_KEY`：返回明确错误 `OPENAI_API_KEY is not configured`，符合本地未配置密钥状态。
- `npm run lint`：通过，扩展 gpt-image-2 常用尺寸列表后无 ESLint 错误。
- `npm run build`：通过，后端 Images API 调用已在 API 边界处理 SDK 尺寸类型滞后问题。
- Playwright 访问 `http://localhost:3011/boards/cmofnagm70000bglwc3ekh6rj`：通过，AI 面板显示 `比例` 与 `分辨率` 控件；分辨率按比例过滤：自动为 `自动分辨率`；方图为 `1024x1024`、`2048x2048`；横图为 `1536x1024`、`2048x1152`、`3840x2160`；竖图为 `1024x1536`、`2160x3840`。
- `npm run lint`：通过，首页画板管理功能无 ESLint 错误。
- `npm run build`：通过，新增 `DELETE /api/boards/:boardId` 和 `POST /api/boards/:boardId/duplicate` 路由进入 Next.js 构建产物。
- Playwright 访问 `http://localhost:3011`：通过，首页画板卡片显示 `重命名`、`复制`、`删除`、`打开` 四个操作。
- API 烟测：复制空画板后删除副本，通过。
- API 烟测：复制带 3 个素材的画板后删除副本，通过，副本素材数为 3，删除后本地上传目录不存在。
- `npm run lint`：通过，画布 API 面板无 ESLint 错误。
- `npm run build`：通过，新增 tldraw 选区、导出、组合、视图定位调用均通过 TypeScript 检查。
- Playwright 访问临时画板：通过，画布 API 面板显示 `全选`、`取消选择`、`复制选区`、`删除选区`、`组合`、`解除组合`、`定位选区`、`适应全部`、`导出 PNG`、`导出 SVG`、`选区存为参考图`；空画板状态下相关按钮禁用。
- `npm run lint`：通过，补充右键 AI 图片菜单、选区生成、整图编辑、生成记录 shape 后无 ESLint 错误。
- `npm run build`：通过，右键菜单覆盖、透明整图 mask 编辑、生成历史文本 shape 均通过 TypeScript 检查。
- Playwright 访问临时画板：通过，画布 API 面板包含 `用选区生成`；右键菜单显示 `局部重绘`、`图生图`、`生成变体`、`删除背景`。
- `npm run lint`：通过，新增 `ai-mask-brush` tldraw 自定义工具后无 ESLint 错误。
- `npm run build`：通过，蒙版画笔工具、源图像素坐标蒙版和侧栏预览均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- `node scripts/smoke-home.mjs`，环境变量 `SMOKE_BASE_URL=http://localhost:3011`：通过，首页 H1 为 `AI Board`。
- `node scripts/smoke-board.mjs cmofqltts0001v0lwhoiqcb63`，环境变量 `SMOKE_BASE_URL=http://localhost:3011`：通过，画板 H1 为 `未命名画板`。
- Playwright 访问 `http://localhost:3011/boards/cmofqltts0001v0lwhoiqcb63`：通过，侧栏显示 `画布蒙版笔`，点击后状态切换为 `蒙版笔已启用：在画布图片上拖拽涂抹`。
- `npm run lint`：通过，修复蒙版工具坐标取值并增加画布持久蒙版 overlay 后无 ESLint 错误。
- `npm run build`：通过，`currentPagePoint`、`pageToViewport` 和前景 SVG overlay 均通过 TypeScript 检查。
- 已再次重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 实际拖拽 `画布蒙版笔`：通过，拖拽后状态为 `已添加画布蒙版，可继续涂抹或点击局部重绘`，右侧 tldraw 图片上存在 `.mask-canvas-overlay polyline`，截图写入 `tmp/mask-overlay-fixed.png`。
- `npm run lint`：通过，新增蒙版持久化、撤销、笔刷大小和生成记录 metadata 后无 ESLint 错误。
- `npm run build`：通过，包装式快照 `{ tldraw, app }`、旧快照兼容加载、生成记录 text shape metadata 均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 调整蒙版笔刷大小：通过，range 从 `35` 调整到 `60`。
- Playwright 实际拖拽后撤销蒙版：通过，拖拽后 overlay 数量为 `1`，点击 `撤销` 后 overlay 数量为 `0`。
- Playwright 蒙版持久化：通过，设置笔刷为 `52` 并绘制蒙版，等待自动保存后刷新页面，overlay 数量仍为 `1`，笔刷值恢复为 `52`。
- `npm run lint`：通过，蒙版 overlay 改为订阅 tldraw camera / viewport / image shape 变化后无 ESLint 错误。
- `npm run build`：通过，显式加入 `@tldraw/state-react` 并使用 `useValue` 后通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 验证蒙版 overlay 响应 camera/page 变化：通过，`data-overlay-version` 会随相机变化更新；已确认 overlay 中心仍位于图片 bounds 内。
- `npm run lint`：通过，补充层级、锁定、翻转、对齐、分布、堆叠、整理、拉伸和 Frame 选区操作后无 ESLint 错误。
- `npm run build`：通过，新增 tldraw Editor API 调用均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmoft80l70000fclwwjj993in`：通过，画布 API 面板显示 `置顶`、`置底`、`上移一层`、`下移一层`、`锁定选区`、`选区成框`、`水平翻转`、`垂直翻转`、`左对齐`、`水平居中`、`顶对齐`、`垂直居中`、`水平分布`、`垂直分布`、`横向堆叠`、`纵向堆叠`、`网格整理`、`横向拉伸`、`纵向拉伸`；测试后已删除该临时画板。
- `npm run lint`：通过，将左侧重复的 `画布 API` 面板迁移为画布顶部/底部浮动工具条后无 ESLint 错误。
- `npm run build`：通过，浮动工具条、左栏收敛和样式调整均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmoftscor0000oklwcvz4dtir`：通过，左侧不再出现 `画布 API`；画布顶部 `AI 画布快捷工具` 与底部 `选区排版快捷工具` 均可见；顶部显示 `参考图`、`选区生成`、`复用记录`、`PNG`、`SVG`、`蒙版笔`；测试后已删除该临时画板。
- `npm run lint`：通过，隐藏 tldraw 默认 `Toolbar`、`StylePanel`、`QuickActions`、`NavigationPanel`、`ActionsMenu` 后无 ESLint 错误。
- `npm run build`：通过，自定义工具条承接绘制工具、样式、撤销重做和缩放导航后通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofu9nra0000y8lwbouguqyk`：通过，默认可见 `.tlui-toolbar` 数量为 `0`；自定义工具条包含 `撤销`、`重做`、`选择`、`平移画布`、`自由绘制`、`擦除对象`、`箭头`、`直线`、`文本`、`便签`、`矩形`、`圆形`、`Frame`、`高亮笔`、`缩小`、`重置缩放`、`放大`；点击 `矩形` 和 `颜色 红` 后按钮 active 状态正常；测试后已删除临时画板。
- `npm run lint`：通过，补充页面管理、`.tldr` 导入导出、复制删除组合解组后无 ESLint 错误。
- `npm run build`：通过，新增页面 API、文件导入导出和基础编辑按钮均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofuivkk0004eclwsb0lm2m0`：通过，自定义工具条显示 `新建页面`、`复制当前页`、`重命名当前页`、`删除当前页`、`导出 .tldr`、`导入 .tldr`、`全选`、`取消选择`、`复制选区`、`删除选区`、`组合`、`解除组合`；点击 `新建页面` 后页面数从 1 变为 2；导出文件名为 `未命名画板.tldr`；测试后已删除临时画板。
- Playwright 新建临时画板 `cmofujj4r0009eclwbyqldur5`：通过，导出 1 页 `.tldr` 后新建第 2 页，再导入刚才的 `.tldr`，页面数从 2 恢复为 1；测试后已删除临时画板与临时导出文件。
- `npm run lint`：通过，补充多参考图角色、局部替换模式、蒙版羽化后无 ESLint 错误。
- `npm run build`：通过，前端替换工作流和后端 `referenceAssetIds` 多图编辑请求均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofv177l0000golwjo0cw9ao`：通过，侧栏显示 `参考图替换` 面板；包含 `替换手中商品`、`替换上衣`、`替换整套穿搭`、`替换配饰`、`替换背景`；参考角色包含 `主体人物`、`商品参考`、`服装参考`、`风格参考`、`背景参考`；`按参考图局部替换` 按钮存在；`边缘羽化` 默认值为 `12`；测试后已删除临时画板。
- `npm run lint`：通过，补充多候选生成数量后无 ESLint 错误。
- `npm run build`：通过，前端候选数量持久化、后端 Images API `n` 参数和多结果插入均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofvb2ce0000yglw9q6wzrd6`：通过，画板页显示 `候选数量` 控件；选择值从默认切换为 `3` 后保持为 `3`；`参考图替换` 与 `按参考图局部替换` 入口仍可见；测试后已删除临时画板。
- `npm run lint`：通过，补充局部替换的 `保留强度` 与 `参考贴合` 控制后无 ESLint 错误。
- `npm run build`：通过，替换控制持久化、`.tldr` 导入恢复和提示词拼接均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofviaes000084lwslwtgqit`：通过，`参考图替换` 面板显示 `保留强度` 与 `参考贴合`；`保留强度` 可切换到 `严格保留主体`，`参考贴合` 可切换到 `严格贴合参考`；测试后已删除临时画板。
- `npm run lint`：通过，将右侧参数式 UI 收敛为 `AI 改图` 四步主流程后无 ESLint 错误。
- `npm run build`：通过，源图上传、参考图上传、涂抹区域、主生成按钮和折叠高级设置均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofwhb5d0002wclwlq8unfwn`：通过，右侧显示 `AI 改图`、`源图`、`参考图`、`编辑区域`、`涂抹区域`、主生成按钮；展开 `高级设置` 后可见 `候选数量` 与 `参考贴合`；测试后已删除临时画板。
- `npm run lint`：通过，补充 `用提示词生成源图` 与顶部可配置工具栏后无 ESLint 错误。
- `npm run build`：通过，工具栏分组持久化、顶部收拢、选区工具折叠和源图生成入口均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofwty3a0000dglwbge5pd15`：通过，右侧源图区域显示 `用提示词生成源图`；画布工具栏只保留顶部入口；点击 `显示工具` 并勾选 `页面` 后显示页面选择器；`更多工具` 可展开选区工具；页面不存在 `.canvas-toolbar-bottom`；测试后已删除临时画板。
- `npm run lint`：通过，补充独立 `源图提示词` 输入和参考区域裁切后无 ESLint 错误。
- `npm run build`：通过，源图提示词生成、参考图选区保存修正、按选区 bounds 裁切参考区域均通过 TypeScript 检查。
- 已重启 `http://localhost:3011`，当前监听进程为 `next start --port 3011`。
- Playwright 新建临时画板 `cmofx4gh30000vslwz9anrax7`：通过，右侧显示 `源图提示词`；填写后 `用提示词生成源图` 按钮可用；参考图步骤显示 `选区设为参考区域` 与 `选区存为参考图`；测试后已删除临时画板。
- 2026-04-26 Codex：审核 AI 改图操作链路后修正主生成入口。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `11048`；Playwright 打开真实画板 `cmofwj4hv0003wclwmx8fnb37` 验证：已设置参考图但未标记区域时状态为 `已设置参考图，请标记要替换的区域`，`生成新图片` 按钮禁用，避免再次静默走整图图生图。
- 2026-04-27 Codex：根据“涂抹或选区不应强制，可直接通过关键词修改”的反馈调整主流程。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `31752`；Playwright 打开真实画板 `cmofwj4hv0003wclwmx8fnb37` 验证：无涂抹区域时状态为 `将使用 1 张参考图按关键词整图修改`，输入提示词后 `生成新图片` 按钮从禁用变为可用，编辑区域文案显示 `编辑区域（可选）`。
- 2026-04-27 Codex：去除 AI 生图区域下方的 `高级设置`，为 `用提示词生成源图` 与 `生成新图片` 分别补充 `源图规格`、`新图规格` 选择器。规格选项按 `gpt-image-2` 兼容网关文档补齐：`auto`、`1024x1024`、`2048x2048`、`1536x1024`、`2048x1152`、`3840x2160`、`1024x1536`、`2160x3840` 与自定义规格；自定义规格限制为最长边不超过 `3840`、宽高为 `16` 的倍数、比例不超过 `3:1`、总像素 `655360` 到 `8294400`。参考来源：OpenAI Images API 公开文档 `https://platform.openai.com/docs/api-reference/images/overview`，APIYI gpt-image-2 兼容文档 `https://docs.apiyi.com/en/api-capabilities/gpt-image-2/overview`。
- 2026-04-27 Codex：`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `32264`。Playwright 打开真实画板 `cmofwj4hv0003wclwmx8fnb37` 验证：页面不包含 `高级设置`；存在 `源图规格` 与 `新图规格`；两个下拉都包含全部预设与 `自定义规格`；切换自定义后宽高输入出现，`min=16`、`max=3840`、`step=16`；输入 `3840x2160` 后保持为合法自定义规格。
- 2026-04-27 Codex：补充常见自媒体图片规格到 `源图规格` 与 `新图规格`：包括 1:1 方图、4:5 图文竖图、3:4 封面、2:3 海报、9:16 竖屏封面、16:9 视频封面、4:3 横图、21:9 横幅、2:1 头图、1:2 长图等。由于 `1080x1920`、`1080x1350` 不是 16 的倍数，选择器提供 API 合法近似规格 `1088x1920`、`1088x1360`、`1920x1088`。本地校验 32 个内置规格全部满足 gpt-image-2 尺寸规则；`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `37232`；Playwright 验证两个规格下拉各有 33 个选项且新增自媒体规格均存在。
- 2026-04-27 Codex：补充最近素材双用途选择与清除重选。最近素材中每张图都提供 `源图` 与 `参考` 按钮，源图/参考图预览卡均可清除；清除源图会同步清空蒙版区域，避免旧区域误用到新源图。顶部工具栏改为单行结构，`更多工具` 被移入主工具栏末尾并以浮层展开，不再作为独立第二排工具栏。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `7616`；Playwright 临时画板验证：2 个最近素材均可设为源图/参考图，清除后文案恢复；`.canvas-toolbar > .canvas-toolbar-more` 数量为 1，`.canvas-toolbar.canvas-toolbar-more` 数量为 0，更多工具浮层可见。
- 2026-04-27 Codex：排查用户最新生成记录 `cmog3ht1b0007vklwo1eyw8tq`，确认前端在“无涂抹区域但有参考图”的整图关键词编辑场景上传了全透明 mask。该 mask 的透明像素比例为 `1.0`，等于告诉图像接口整张源图都是可编辑区域，同时提示词仍包含 `only modify transparent/marked mask areas`，导致参考替换目标不明确，模型容易复刻源图。已修复：无涂抹/无选区时不再创建或上传整图透明 mask，后端 `images.edit` 允许不带 `mask`；只有真实涂抹局部时才上传 mask。无 mask 场景的提示词改为“根据用户指令识别目标对象并用参考图替换，不要原样复刻源图”。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `33808`；Playwright 拦截式验证确认请求体不再包含 `maskAssetId`，点击生成期间没有新的 `/api/assets` mask 上传。
- 2026-04-27 Codex：执行 `$check`。项目没有 `.trellis/spec`，无法执行 Trellis 规范索引步骤；改按项目现有验证链路执行。发现并处理 `.next` 静态 chunk 500 导致客户端事件不生效的问题：停止服务、删除 `.next`、重新 `npm run build` 并启动。复验通过：最近素材 `源图` 按钮能更新预览和状态；无涂抹的源图+参考图关键词编辑请求中 `maskAssetId` 不存在，`referenceAssetIds.length = 1`，点击生成未上传 mask 资产，提示词包含 `No mask is provided`。`npm run lint` 通过，`npm run build` 通过；当前 `http://localhost:3011` 监听进程为 `33860`。
- 2026-04-28 Codex：复现“生图后返回 404/错误页”。通过 Playwright 拦截 `/api/generation-jobs` 模拟生成成功后，页面进入错误边界，控制台报错 `ValidationError: At shape(type = text).meta: Expected json serializable value, got object`。根因是 `insertGenerationHistory` 创建 AI 生成记录文本 shape 时，把 `maskAssetId`、`sourceAssetId` 等可选字段以 `undefined` 写入 tldraw `meta`，而 tldraw 要求 `meta` 必须严格 JSON 可序列化。已修复为只写入有值字段。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `29736`。复验：模拟生成成功后页面仍停留在画板，`.canvas-toolbar` 存在，未出现 `This page couldn’t load`/`404`，无 page error。复验产生的测试快照已回滚到用户生成后的 `BoardSnapshot` version 8。
- 2026-04-28 Codex：补齐源图生成位置的参考图上传与多参考图链路。源图区域新增/确认 `上传源图参考图` 支持一次选择多张；参考图状态改为最多 8 张列表，预览可逐张移除和清空；最近素材 `参考` 会累加而不是覆盖。`用提示词生成源图` 现在会把当前参考图列表作为 `referenceAssetIds` 传给 `/api/generation-jobs`；后端在 `text_to_image` 且存在参考图时改走 `images.edit` 多图输入，否则仍走纯文生图 `images.generate`。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `10820`。Playwright 新建临时画板 `cmoi4kpwm0000cklwvpz5q7ji` 验证：源图参考上传 input 带 `multiple`，一次上传 2 张后出现 2 张参考图预览，点击 `用提示词生成源图` 的请求体为 `mode: text_to_image` 且 `referenceAssetIds.length = 2`；验证后已删除该临时画板。
- 2026-04-28 Codex：将生成的 UI 界面稿写入 `docs/ai-image-workbench-plan.md`，界面图片为 `docs/assets/ai-image-workbench-ui.png`；方案补充工作台结构、数据接口、实施步骤、验收点和后续增强边界。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `20384`。Playwright 新建临时画板 `cmoi5pb6j0004q8lw9d3s8rwh` 验证：页面显示 `AI 图片工作台`、`AI 生图`、`AI 改图`、`当前素材`、`生成历史`；上传 2 张参考图后预览数量为 2；将第一张角色设为 `Logo 参考` 后点击 `生成图片`，拦截到 `/api/generation-jobs` 请求体为 `mode: text_to_image`，`referenceAssetIds.length = 2`，`referenceItems.length = 2`，其中一项包含 `role: logo`；验证后已删除临时画板。
- 2026-04-28 Codex：继续缩小当前前端与界面稿差距。工作台标题改为固定 `AI 图片工作台`；侧栏分区改为编号卡片；参考图预览改成小卡片网格；画布右侧新增 `参考图角色` 浮层；AI 改图区域新增并上移 `图片规格` 选择框。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `41188`。Playwright 新建临时画板 `cmoi6032w0007s4lwgaw8ddn7` 验证：`1. AI 生图`、`2. AI 改图`、`3. 当前素材`、`4. 生成历史` 可见；页面存在两个 `图片规格` 选择器；上传 2 张参考图后右侧 `.reference-drawer` 显示 2 条角色项。调整后截图为 `tmp/current-workbench-after.png`；验证后已删除临时画板。
- 2026-04-28 Codex：针对“当前前端与图片 UI 仍差距很大，尤其工具栏和左侧区域”的反馈继续调整。左侧参考图预览改为 3 张缩略图 + 添加卡片，角色下拉从左侧移入右侧参考图抽屉；清空参考图改为轻量按钮；AI 改图区源图预览、上传/选中按钮、规格选择和提示词输入全部压缩；当前素材改为 6 列缩略图，源图/参考操作仅悬停显示；顶部工具栏左移，顺序调整为 `撤销`、`重做`、`选择`、`手型`、`画笔`、`文本`、`矩形`、`蒙版笔`、`导出`、`更多工具`。`npm run lint` 通过，`npm run build` 通过；`http://localhost:3011` 监听进程为 `20784`。Playwright 临时画板验证：上传 3 张参考图和 1 张源图后，左侧 4 个分区标题在 1800x950 首屏出现，顶部工具栏宽度 621px 且无横向溢出；截图为 `tmp/current-workbench-final-ui-6.png`；验证后已删除临时画板。
- 2026-04-28 Codex：顶部工具栏改为可配置的单工具固定模型，`更多工具` 浮层支持把任意隐藏工具 `拉出` 到首行，也支持把首行工具 `收回`；首行最多 14 个工具，配置字段为 `toolbarPinnedActionIds` 并随画板快照保存。旧 `toolbarVisibleGroups` 分组模型和旧 CSS 强制隐藏规则已移除；SVG 导出被重新接入更多工具。`npm run lint` 通过，`npm run build` 通过；Playwright 打开真实画板 `cmoi62bvt000as4lwdt8b8i1w` 验证：默认首行为 `撤销/重做/选择/手型/画笔/文本/矩形/蒙版笔/导出`，展开 `更多工具` 后隐藏工具数量为 41，将 `橡皮` 拉出后出现在首行，再收回后从首行移除；点击 `保存` 后拦截到 `PUT /api/boards/:boardId/snapshot` 且请求体包含 `toolbarPinnedActionIds`。截图为 `tmp/toolbar-customize-smoke.png`。
- 2026-04-28 Codex：后端对接检查完成。AI 生图、源图参考生成、AI 改图、局部替换、选区生成、图生图、生成变体、删除背景都通过 `POST /api/generation-jobs` 进入后端；上传源图/参考图/蒙版/选区参考图通过 `POST /api/assets`；画板状态、蒙版、参考图状态和工具栏配置通过 `PUT /api/boards/:boardId/snapshot` 保存；画板刷新通过 `GET /api/boards/:boardId`。绘制、选择、页面、样式、导出 PNG/SVG 是 tldraw 前端操作，其中画布状态靠快照持久化，导出是浏览器本地下载，不需要单独后端。
- 2026-04-28 Codex：将底部缩放悬浮工具条贴到画布右下角，背景改为不透明并提高到 `z-index: 10000`，用于覆盖 `Get a license for production` 提示位置。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `8976`。Playwright 验证 `.canvas-zoom-controls` 与 `Get a license` 文案边界重叠，截图为 `tmp/zoom-controls-cover-license-final.png`。
- 2026-04-28 Codex：将 `更多工具` 编辑页面从文字按钮改为角标操作。已显示工具右上角显示 `X` 表示移除，隐藏工具右上角显示 `+` 表示添加；界面不再出现 `收回` / `拉出` 文案。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `34088`。Playwright 验证：展开 `更多工具` 后无 `收回` / `拉出` 文案，存在 9 个 `X` 和 41 个 `+`；点击 `+` 后 `橡皮` 出现在首行，点击 `X` 后从首行移除。截图为 `tmp/toolbar-corner-actions.png`。
- 2026-04-28 Codex：统一保存和下载图片文件名规则为 `项目名_YYYYMMDDHHmmssSSS`，多图同批次追加 `_01`、`_02`。覆盖范围包括：导出 PNG/SVG、选区保存为参考图、选区作为源图生成、用户上传进入本地资产库、AI 生成结果后端保存；资产文件接口增加 `Content-Disposition`，下载/另存使用同一文件名。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `24136`。API 烟测验证上传保存路径为 `uploads/.../命名测试项目_20260428123456789.png`，文件接口返回匹配的 `Content-Disposition`；Playwright 导出 PNG 的建议文件名为 `未命名画板_20260428144942752.png`。
- 2026-04-28 Codex：补齐当前素材的显式图片下载入口，避免浏览器右键图片另存时退回 `/file` 这类 URL 文件名。新增 `下载` 按钮会读取资产接口 `Content-Disposition` 并通过 `link.download` 触发下载。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `7508`。Playwright 临时画板验证：上传 `下载命名测试_20260428150102003.png` 后点击当前素材 `下载`，浏览器建议文件名严格等于 `下载命名测试_20260428150102003.png`；验证后已删除临时画板。
- 2026-04-28 Codex：补齐图片保存到项目本地目录。新增 `/api/exports` 与 `src/lib/local-export.ts`，导出 PNG/SVG、当前素材下载、选区存参考、选区参考裁切和 AI 生成结果都会额外写入 `E:\github\tldraw-ai-board\local-exports\<项目名>\`；该目录已加入 `.gitignore`。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `33492`。Playwright 验证当前素材 `下载` 后，本地文件存在于 `E:\github\tldraw-ai-board\local-exports\本地目录测试\本地目录测试_20260428152030456.png`，文件大小 68 bytes；验证后删除临时画板。界面状态文案已改为显示保存到的相对路径。
- 2026-04-28 Codex：在 AI 生图和 AI 改图的 `图片规格` 下方增加 `生成数量` 选择器，可选 1、2、3 张；该设置共用同一个 `generationCount`，任一处修改都会影响同一组提示词的生成数量。后端 `/api/generation-jobs` 的 `count` 校验上限同步改为 3。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `33496`。Playwright 验证两个选择器均只有 `1/2/3`，选择 `3` 后拦截到的生成请求体包含 `count: 3`；验证后删除临时画板。
- 2026-04-28 Codex：修复同步生成 3 张只显示 1 张的问题。后端按 `count` 拆成多次 `n=1` 的 Images 请求，避免兼容网关忽略 `n > 1`；前端批量插入时将候选图压缩为最多 300px 宽并横向排列。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `25832`。Playwright 拦截式验证：选择 `3 张` 后请求体 `count = 3`，接口返回 3 张假图，画板内出现 3 个可见图片 shape，位置分别为 `x=120`、`x=444`、`x=768`，截图为 `.codex/multi-image-smoke.png`。
- 2026-04-28 Codex：调整同批多图的生成记录展示。生成成功后不再对每张候选图创建画布文字 shape；打开旧画板时会自动清理历史遗留的 `AI 生成记录` 文字 shape 并保存快照；右侧浮层改为卡片栈，在 `参考图角色` 下方显示单条 `AI 生成记录` 卡片，记录模式、模型、尺寸、参考图数量、状态和提示词，并支持复用该组提示词。`npm run lint` 通过，`npm run build` 通过；已重启 `http://localhost:3011`，当前监听进程为 `38340`。Playwright 验证：种入 1 条 3 结果生成记录后右侧只显示 1 张生成记录卡；再次拦截 3 张生成后，画布插入 3 个图片 shape，`.tl-shape` 中 `AI 生成记录` 文本数量为 0，页面总 `AI 生成记录` 文本数量为 1，截图为 `.codex/generation-record-drawer-smoke.png`。

## Known Environment Issue

- `npx prisma migrate dev --name init` 和 `npx prisma db push` 在当前 Windows 环境返回空的 `Schema engine error`。
- 已保留 `prisma/schema.prisma` 和 Prisma Client，使用 `scripts/init-db.mjs` 作为本地 SQLite 初始化路径。

## Screenshots

- `tmp/home.png`
- `tmp/board.png`

## 2026-04-29 OpenSpec Proposal Verification

- 执行者：Codex
- 变更名称：`add-auth-and-provider-settings`
- 目标：为用户鉴权、OAuth 登录和用户级第三方 OpenAI 兼容 API 设置创建 OpenSpec 提案。
- 状态检查：`openspec status --change "add-auth-and-provider-settings"` 通过，显示 4/4 artifacts complete。
- 格式校验：`openspec validate "add-auth-and-provider-settings"` 通过，输出 `Change 'add-auth-and-provider-settings' is valid`。
- 生成文件：`openspec/changes/add-auth-and-provider-settings/proposal.md`、`design.md`、`tasks.md`、`specs/user-auth/spec.md`、`specs/provider-settings/spec.md`。
- 备注：本轮是提案与规范生成，未修改业务代码，因此未运行 `npm run lint` 或 `npm run build`。

## 2026-04-29 Auth and Provider Settings Implementation

- 执行者：Codex
- OpenSpec change：`add-auth-and-provider-settings`
- 实施结果：29/29 tasks complete，`openspec instructions apply --change "add-auth-and-provider-settings" --json` 返回 `state: "all_done"`，`openspec validate "add-auth-and-provider-settings"` 通过。
- 数据库：`npm run db:generate` 通过；`npm run db:init` 初次发现旧库迁移顺序问题，修复后复跑通过。旧本地 Board 会补到确定性的 `local-default-user`。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 本地 smoke：以临时 `AUTH_SECRET` / `AUTH_URL` 启动 `next start --port 3012`，执行 `SMOKE_BASE_URL=http://localhost:3012 node scripts/smoke-auth-provider.mjs` 通过，随后停止 3012 端口服务。
- 覆盖点：未登录 API 401、登录用户只看到自己的画板、创建画板绑定当前用户、跨用户更新返回 404、provider 设置读取脱敏、无效 provider 设置拒绝、无 provider 生成拒绝、配置 provider 后通过 fake OpenAI 兼容接口生成并记录 provider metadata 且不记录 API key。

## 2026-04-29 Local Username Password Auth Revision

- 执行者：Codex
- 变更原因：用户明确要求鉴权模式不使用 GitHub OAuth，改为本地存储用户名和密码登录。
- 实施结果：移除 `@auth/prisma-adapter`，新增 `bcryptjs`；`src/auth.ts` 改为 Auth.js Credentials provider + JWT session；`User` 增加 `username` 和 `passwordHash`；登录页提供登录和创建本地账号表单。
- 文档同步：README 与 OpenSpec change 已移除 GitHub/OAuth 配置说明，改为本地用户名密码登录说明。
- 质量检查：`npm run db:generate` 通过；`npm run db:init` 通过；`npm run lint` 通过；`npm run build` 通过。
- 本地 smoke：以临时 `AUTH_SECRET` / `AUTH_URL` 启动 `next start --port 3012`，执行 `SMOKE_BASE_URL=http://localhost:3012 node scripts/smoke-auth-provider.mjs` 通过，随后停止 3012 端口服务。
- 覆盖点：通过真实 `/login` 表单登录两个本地测试用户，验证未登录 API 401、用户画板隔离、跨用户更新 404、provider 设置脱敏、无 provider 生成拒绝，以及配置 provider 后通过 fake OpenAI 兼容接口生成。

## 2026-04-29 Admin Review and API Authorization Revision

- 执行者：Codex
- 变更原因：注册和登录改为管理员审核模式；固定管理员 `koiyoho` 审核新用户，并在通过时决定是否允许用户使用管理员当前 API。
- 数据库：`npm run db:generate` 通过；`npm run db:init` 首次因旧 SQLite 表不能通过 `ALTER TABLE` 增加 `DEFAULT CURRENT_TIMESTAMP` 列失败，已改为先增加可空 `createdAt/updatedAt` 再回填，复跑通过。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- OpenSpec：已更新 `add-auth-and-provider-settings` 的 proposal/design/spec/tasks，移除“注册即登录”语义并补充 admin review/API authorization；`openspec validate "add-auth-and-provider-settings"` 通过。
- 本地 smoke：以临时 `AUTH_SECRET` / `AUTH_URL` 启动 `next start --port 3012`，执行 `SMOKE_BASE_URL=http://localhost:3012 node scripts/smoke-auth-provider.mjs` 通过，随后停止 3012 端口服务。
- 覆盖点：未登录 API 401；新用户注册后 pending 且不能登录；`koiyoho` 可看到审核区域；管理员审核通过并勾选 API 授权后，用户无需自配 API 即可通过管理员 provider 生成；审核通过但不勾选 API 授权后，用户登录成功但生成提示配置第三方 API 或联系管理员授权；拒绝用户不能登录；普通用户调用审核 API 返回 403；provider 设置 API 不返回明文 API key；生成任务 metadata 记录 `providerOwner = admin` 且不包含 API key。

## 2026-04-29 Auth Redirect Host Fix

- 执行者：Codex
- 变更原因：当前通过 `http://taki999.f3322.org:3333` 访问时，登录成功后跳转到了 `localhost:3333`。
- 根因：`src/app/auth-actions.ts` 使用 Auth.js `signIn("credentials", { redirectTo: "/" })`，绝对回调域名由 Auth.js 的 `AUTH_URL` 或请求 Host 推断；当前 `.env` 未配置 `AUTH_URL`。
- 修复：`.env` 补充 `AUTH_URL="http://taki999.f3322.org:3333"`；README 补充外网访问时 `AUTH_URL` 必须和浏览器入口一致的说明；3333 旧服务原启动命令显式设置了 `AUTH_URL=http://localhost:3333`，已停止旧进程并用正确外网域名重启。
- 质量检查：首次 `npm run lint` 因临时目录 `tmp/acme-webroot-server.js` 被扫描失败，已将 `tmp/**`、`local-exports/**`、`public/uploads/**` 加入 ESLint 忽略；复跑 `npm run lint` 通过；`npm run build` 通过。
- 本地和外网入口：`http://127.0.0.1:3333/login` 返回 200；`http://taki999.f3322.org:3333/login` 返回 200。
- 本地 smoke：执行 `SMOKE_BASE_URL=http://taki999.f3322.org:3333 node scripts/smoke-auth-provider.mjs` 通过，覆盖真实登录表单跳转、管理员审核、provider 脱敏和管理员 provider 生成链路。

## 2026-04-29 Admin API Authorization Card Visibility

- 执行者：Codex
- 变更原因：除管理员之外，已经授权使用当前 API 的普通用户不应再看到设置 API 的卡片。
- 修复：`src/app/page.tsx` 根据当前用户状态计算 `showProviderSettings = user.role === "admin" || !user.canUseAdminProvider`；`src/components/BoardList.tsx` 仅在该值为 true 时渲染 `ProviderSettingsForm`。
- 行为：管理员始终显示 API 设置卡片；已授权使用管理员当前 API 的普通用户隐藏 API 设置卡片；未获授权的普通用户继续显示 API 设置卡片，用于配置自己的第三方 API。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 本地 smoke：重启 `next start --port 3333` 后执行 `SMOKE_BASE_URL=http://taki999.f3322.org:3333 node scripts/smoke-auth-provider.mjs` 通过。烟测已断言管理员能看到 `#provider-settings`，已授权普通用户看不到，未授权普通用户能看到。

## 2026-04-29 Mobile UI Replication

- 执行者：Codex
- 变更原因：按生成的四联移动端效果图复刻到移动端 UI，避免单页同时承载配置与画板造成移动端拥挤。
- 修复：`src/components/BoardWorkspace.tsx` 在移动端增加 `画板 / AI 生图 / AI 改图 / 素材` 四视图与底部导航；`src/app/globals.css` 增加移动端全屏视图、底部导航、素材 tabs、画板浮动生成按钮和短工具条样式。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 本地 smoke：复用 `http://localhost:3013` 开发服务，Playwright 使用 390x844 移动端视口，通过真实登录表单进入临时画板并截图验证四个移动端页面。临时用户和临时画板已删除。
- 截图：`tmp/mobile-ui-canvas.png`、`tmp/mobile-ui-generate.png`、`tmp/mobile-ui-edit.png`、`tmp/mobile-ui-assets.png`。
- 备注：开发模式的 Next overlay 会显示并拦截左下角点击；干净截图通过隐藏 `nextjs-portal` 验证。未发现页面运行时错误，仅有 tldraw 中文翻译缺失 warning。
- 补充修复：新增 `/mobile-preview/[boardId]`，桌面浏览器可通过 390px iframe 直接查看移动版布局；为画板内表单控件增加 hydration warning 抑制，避免浏览器提前注入 `caret-color` 后触发 React mismatch；补齐 `public/tldraw-translations/zh-cn.json` 缺失的 tldraw 翻译 key。
- 复测：`npm run lint` 通过；`npm run build` 通过；Playwright 打开 `http://localhost:3013/mobile-preview/codex-preview-debug-board`，iframe 画板加载成功，桌面控制台无 error/warning，截图为 `tmp/mobile-preview-url-final.png`。
- 1:1 复刻收敛：继续按四联效果图调整移动端密度和结构。顶部模拟 iPhone 状态栏和 Dynamic Island；AI 生图页补齐字符计数、五张参考图缩略条和启用态绿色主按钮；AI 改图页补齐源图、参考图、三段编辑模式、横向规格/数量区、修改要求字符计数；素材页补齐三列图卡和源图/参考/下载操作。
- 预览数据：为 `codex-preview-debug-board` 写入 8 个示例素材、5 个参考图、源图、source/edit prompt 和 3 条生成历史，用于稳定复现目标图里的非空状态。
- 复测：`npm run lint` 通过；`npm run build` 通过；Playwright 对桌面画板和移动预览采集 console warn/error，结果为 `[]`。
- 预览产物：四联确认图 `tmp/mobile-preview-composite-final.png`；单页图 `tmp/mobile-phone-canvas-final.png`、`tmp/mobile-phone-generate-final.png`、`tmp/mobile-phone-edit-final.png`、`tmp/mobile-phone-assets-final.png`。

## 2026-04-29 Mobile No Phone Chrome Revision

- 执行者：Codex
- 变更原因：用户要求去掉模拟手机外壳、顶部假胶囊、状态栏区域和顶部 `返回`，移动端只使用底部标签切换；所有图标改用 icon 包，不再用 CSS 绘制。
- 修复：`src/app/globals.css` 将 `.mobile-preview-frame` 收敛为无边框、无圆角、无手机黑框的 390x844 iframe；删除旧的移动端顶部 tab/panel 残留样式；隐藏 `details summary` 默认 marker，避免出现浏览器默认图标。
- 修复：`src/components/BoardWorkspace.tsx` 删除顶部 `返回` 链接和 `next/link` 依赖；移动端状态点使用 `lucide-react` 的 `Circle`，`更多工具` 使用 `Ellipsis`，底部导航继续使用 lucide 图标。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 浏览器复测：内置浏览器打开 `http://localhost:3013/boards/codex-preview-debug-board`，验证 `返回` 文本数量为 `0`，`.mobile-home-link/.mobile-canvas-back/.back-link/.desktop-back-link` 数量为 `0`，`.canvas-toolbar-more summary svg` 数量为 `1`；控制台 warn/error 为 `[]`。
- 移动预览复测：内置浏览器打开 `http://localhost:3013/mobile-preview/codex-preview-debug-board`，控制台 warn/error 为 `[]`。
- 截图：`tmp/mobile-board-direct-final-no-back.png`、`tmp/mobile-preview-wrapper-final-no-phone-chrome-and-back.png`。

## 2026-04-29 Mobile Login and Register Page

- 执行者：Codex
- 变更原因：用户要求增加一个风格一致的移动端登录和注册页面。
- 修复：`src/components/LoginPanel.tsx` 保留现有登录/注册 server actions，重排为 `已有账号 / 登录` 与 `新用户 / 注册` 两个卡片；用户名、密码、登录、注册和审核提示均使用 `lucide-react` 图标。
- 修复：`src/app/globals.css` 增加登录/注册页的响应式样式；移动端使用与工作台一致的浅色背景、绿色主按钮、8px 卡片圆角、紧凑输入框和审核提示。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 移动端复测：Playwright 使用未登录独立上下文打开 `http://localhost:3013/login`，390x844 视口下 `.login-card` 数量为 `2`、输入框数量为 `4`、svg 图标数量为 `10`，无横向溢出；控制台 warn/error 为 `[]`。
- 桌面复测：1365x900 视口打开 `http://localhost:3013/login`，控制台 warn/error 为 `[]`。
- 截图：`tmp/mobile-login-register-final-clean.png`、`tmp/desktop-login-register-final-clean.png`。

## 2026-04-29 Mobile Toolbar and Header Revision

- 执行者：Codex
- 变更原因：用户要求画板页工具栏放到标题栏下方，避免遮挡 `生成` 按钮；`更多` 按钮放在工具栏内；工具栏按钮增加间隔；四个 tab 标题栏增加返回设置页按钮。
- 修复：`src/components/BoardWorkspace.tsx` 在移动端标题栏加入 `返回` 链接，目标为 `/`；使用 `lucide-react` 的 `ArrowLeft` 图标。
- 修复：`src/app/globals.css` 将移动端 `.canvas-toolbar` 固定到 `var(--mobile-header-h)` 下方，画布顶部同步下移；工具栏 gap 调整为 8px；`更多工具` 作为工具栏内同级按钮展示，展开面板从工具栏下方弹出；右下角 `生成` 按钮保持独立。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 浏览器复测：内置浏览器打开 `http://localhost:3013/boards/codex-preview-debug-board`，画板页截图确认工具栏在标题栏下方且不遮挡右下角 `生成` 按钮；控制台 warn/error 为 `[]`。
- tab 复测：逐个切换 `AI 生图`、`AI 改图`、`素材`、`画板`，每个 tab 标题栏均有 1 个 `返回` 链接。
- 3333 复测：已重启 `next start --port 3333`，监听进程 `21516`；`http://127.0.0.1:3333/login` 和 `http://taki999.f3322.org:3333/login` 均返回 200。
- 截图：`tmp/mobile-toolbar-header-preview.png`、`tmp/mobile-toolbar-header-direct-canvas.png`。

## 2026-04-29 Mobile Toolbar More and Image Clear Revision

- 执行者：Codex
- 变更原因：用户反馈画板页 `更多` 无法唤起配置面板，AI 生图/改图图片缺少右上角清除入口，AI 改图局部操作需要在 `修改要求` 上方显示源图，画板页需要去掉浮动 `生成`。
- 修复：`src/components/BoardWorkspace.tsx` 删除 `.mobile-canvas-generate` 浮动按钮；参考图和源图清除入口改为 `lucide-react` 的 `X`；AI 改图点击 `涂抹区域` 或 `选区生成` 会展开 `.mobile-edit-source-workbench` 源图操作区。
- 修复：`src/app/globals.css` 调整移动端 `.canvas-toolbar-more-content` 为固定视口弹层，提高层级；允许 `.image-clear-button` 在移动端图片卡片右上角显示；新增源图操作区的完整宽度缩放样式。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 浏览器复测：内置浏览器打开 `http://localhost:3013/boards/codex-preview-debug-board`，`.mobile-canvas-generate` 数量为 `0`；`更多工具` 展开后可见并包含 `已显示工具` / `可添加工具`；AI 生图参考图清除按钮可见；AI 改图源图/参考图清除按钮可见；点击 `涂抹区域` 后源图操作区可见且位于 `修改要求` 前；控制台 warn/error 为 `[]`。
- 截图：`tmp/mobile-more-toolbar-open.png`、`tmp/mobile-edit-source-workbench.png`。

## 2026-04-29 Port 3333 Deployment

- 执行者：Codex
- 部署：停止旧 3333 监听进程 `21516`，以 `AUTH_URL=http://taki999.f3322.org:3333` 和运行期 `AUTH_SECRET` 启动 `next start --port 3333`。
- 当前监听：`33300`。
- 冒烟检查：`http://127.0.0.1:3333/login` 返回 `200`；`http://taki999.f3322.org:3333/login` 返回 `200`；未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 `307` 鉴权跳转。

## 2026-04-29 Mobile Toolbar Customization and Source Mask Controls

- 执行者：Codex
- 变更原因：用户反馈画板工具栏增减工具后首行不显示；AI 改图源图面板需要直接涂抹/圈出修改区域，并提供笔触大小、颜色盘和源图缩放控制。
- 修复：`src/app/globals.css` 删除移动端硬编码隐藏非固定工具的规则，首行 `.canvas-toolbar-group` 改为横向滚动，工具配置变更后立即反映到首行工具栏。
- 修复：`src/components/BoardWorkspace.tsx` 为源图操作区新增笔触大小滑杆、颜色盘、源图缩放滑杆和 SVG 涂抹层；指针拖动会把源图坐标写入现有 `maskState`，局部重绘继续使用既有蒙版生成链路。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 浏览器复测：内置浏览器打开 `http://localhost:3013/boards/codex-preview-debug-board`，添加 `橡皮` 后首行出现 `data-toolbar-action="eraser"`，移除后数量为 `0`；AI 改图点击 `涂抹区域` 后出现 `1` 个笔触滑杆、`5` 个颜色按钮、`1` 个缩放滑杆和 SVG 涂抹层，拖动源图后路径数量从 `0` 增至 `1`；控制台 warn/error 为 `[]`。
- 截图：`tmp/mobile-toolbar-custom-visible.png`、`tmp/mobile-source-mask-controls-top.png`、`tmp/mobile-source-mask-controls.png`。
- 3333 部署：停止旧监听进程 `33300`，以 `AUTH_URL=http://taki999.f3322.org:3333` 和运行期 `AUTH_SECRET` 启动 `next start --port 3333`；当前监听进程 `14876`。
- 3333 冒烟：`http://127.0.0.1:3333/login` 返回 `200`；`http://taki999.f3322.org:3333/login` 返回 `200`；未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 `307`。

## 2026-04-30 Mobile Generation Feedback, Asset Preview, and Mask Undo/Redo

- 执行者：Codex
- 变更原因：用户要求图片生成完成后在按钮下方提示成功/失败；素材 tab 点击图片直接弹窗预览并可缩放；AI 改图涂抹区域必须先点击颜色卡片才可对源图操作；源图放大后要能查看/操作超出屏幕区域；新增撤回、重做、重置笔触操作。
- 修复：`src/components/BoardWorkspace.tsx` 新增 `generationNotice`，AI 生图和 AI 改图主按钮下方按 scope 显示成功/失败提示；生成失败路径和常用图生图失败路径都会写入提示文本。
- 修复：`src/components/BoardWorkspace.tsx` 将素材图片改为 `.asset-preview-trigger`，点击打开 `.asset-preview-modal`；弹窗内提供关闭、缩小、放大、缩放滑杆和重置缩放，图片区域使用滚动容器查看放大后的细节。
- 修复：AI 改图源图工作区新增颜色选择门控。未选颜色时 `.mobile-edit-mask-layer` 不接收指针事件，源图容器保留 `pan-x pan-y` 滚动；选中颜色后才可涂抹，点击同一颜色可退出涂抹查看模式。新增 `撤回 / 重做 / 重置`，分别移除、恢复、清空当前源图的 `maskState.strokes`。
- 修复：补齐调试画板 `codex-preview-debug-board` 缺失的 4 张本地参考图文件，避免预览素材加载 404。
- 质量检查：`npm run lint` 通过；`npm run build` 通过。
- 浏览器复测：Playwright 以 390x844 移动视口打开 `http://localhost:3013/boards/codex-preview-debug-board`。素材预览缩放到 220% 后 `scrollWidth=781 > clientWidth=366`、`scrollHeight=1363 > clientHeight=712`；源图缩放到 250% 后 `scrollWidth=850 > clientWidth=340`、`scrollHeight=1500 > clientHeight=380`，且可设置 `scrollLeft=120`、`scrollTop=80`。
- 涂抹复测：未选择颜色时拖动源图，路径数量保持 `0`；选择颜色后拖动生成 `1` 条路径；点击 `撤回` 后为 `0`，点击 `重做` 后为 `1`，点击 `重置` 后为 `0`。
- 生成提示复测：拦截 `/api/generation-jobs` 返回本地 500，按钮下方 `.generation-result-hint.error` 显示 `测试生成失败提示`，未调用真实图片生成服务。
- 控制台与网络：排除故意拦截的生成 500 后，控制台 warn/error 为 `[]`，非预期 4xx/5xx 为 `[]`。
- 截图：`tmp/mobile-assets-preview-modal.png`、`tmp/mobile-mask-undo-redo-controls.png`。
- 3333 部署：停止旧监听进程 `14876`，以 `AUTH_URL=http://taki999.f3322.org:3333` 和运行期 `AUTH_SECRET` 启动 `next start --port 3333`；当前监听进程 `17856`。
- 3333 冒烟：`http://127.0.0.1:3333/login` 返回 `200`；`http://taki999.f3322.org:3333/login` 返回 `200`；未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 `307`。

## 2026-04-30 AI 改图网络错误与素材删除验证

- 执行者：Codex
- 静态检查：`npm run lint` 通过。
- 构建检查：首次 `npm run build` 暴露 tldraw 图片 shape 的 `props.assetId` 可为 `null`，补充显式非空收窄后复跑通过。
- 生成错误验证：Playwright 登录 3013，本地创建临时画板，上传源图和 mask 图，将 provider baseUrl 临时指向不可达地址后调用 `mode=inpaint` 的 `/api/generation-jobs`。接口返回 `500`，错误文案为 `无法连接图像生成服务，请检查第三方 API 地址、网络连接或服务可用性`，未再暴露 `fetch failed` 或 `Connection error`。
- 素材删除验证：同一临时画板上传素材后调用 `DELETE /api/assets/[assetId]`，确认 SQLite `Asset` 记录消失，`public/uploads/...` 下对应文件消失。
- 移动端 UI 验证：390x844 视口打开临时画板，切换到 `素材` tab 后确认 `.workspace-sidebar` 为 `mobile-view-assets`，当前素材卡显示 `删除` 按钮，按钮内有 `lucide-react` 生成的 `svg` 图标。

## 2026-04-30 生成后素材本地更新验证

- 执行者：Codex
- 根因：AI 改图生成接口已经成功返回图片时，前端仍等待 `refreshBoard()` 后才更新素材列表；如果这次刷新请求失败，会被外层 catch 当作生成失败处理，用户看到 `failed to fetch`，且移动端素材 tab 需要整页刷新才出现生成图。
- 修复：`BoardWorkspace` 新增生成结果本地合并逻辑，`generate` 与 `generateImageEdit` 在收到 `payload.results` 后立即合并进 `board.assets`，再插入画布；`refreshBoard()` 改为后台刷新，失败不再改变生成成功状态。
- 追加根因：继续检查后发现 `insertAsset()` 插入生成图到画布时仍等待 `saveSnapshot()`；当自动保存快照请求失败时，错误会冒泡到生成 catch，导致接口成功、图片已生成时仍显示 `无法连接当前服务`。
- 追加修复：`insertAsset()` 内部捕获自动保存快照失败，保留“自动保存失败，生成结果已保留”的局部状态，不再影响生成成功状态与素材本地更新。
- 再次追加修复：如果浏览器侧 `/api/generation-jobs` fetch 自身抛网络错误，但服务端已完成并记录成功生成，客户端会按本次 prompt 和开始时间轮询最新画板 jobs/assets，最多等待约 60 秒，恢复已生成结果并按成功状态更新素材区和画布。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过。
- 3333 部署检查：已重启生产预览服务；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200，未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 307。
- 清理检查：排查期间创建的 `Local Merge %` 临时画板已检查，无残留测试画板。

## 2026-04-30 移动端参考图角色标记验证

- 执行者：Codex
- 修复：移动端 AI 生图与 AI 改图参考图卡片复用同一渲染逻辑，每张参考图可选择“不标记角色/主体人物/商品参考/服装参考/Logo 参考/风格参考/背景参考”，并继续写入现有 `referenceItems`。
- 范围：未新增 public API、数据库字段或生成请求结构。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 3333 部署检查：已重启生产预览服务；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200，未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 307。

## 2026-04-30 桌面端与移动端工作流统一验证

- 执行者：Codex
- 修复：桌面端左侧工作区改为与移动端一致的 `画板 / AI 生图 / AI 改图 / 素材` 四页切换，避免桌面端同时展开全部配置导致操作路径与移动端割裂。
- 修复：桌面端 AI 生图和 AI 改图继续复用同一批参考图角色状态；AI 改图保留源图预览、颜色启用涂抹、笔触大小、源图缩放、撤回、重做和重置。
- 修复：桌面端素材区改为与移动端一致的 `当前素材 / 生成历史` 切换；画板右侧参考图/生成记录浮层仅在 `画板` 页展示，避免和 AI 页参考图角色控件重复。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `44748`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200，未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 307。
- 桌面端浏览器验证：Playwright 创建临时用户、画板、源图、2 张参考图和 1 条生成历史后登录 `http://taki999.f3322.org:3333`，依次切换 `画板 / AI 生图 / AI 改图 / 素材`；确认画板页显示右侧参考/生成记录浮层，AI 页隐藏该浮层并显示参考图角色选择，AI 改图显示源图涂抹工作区与笔触/缩放控件，素材页显示当前素材/生成历史切换。
- 截图：`tmp/desktop-unified-workflow.png`。

## 2026-04-30 移动端应用内下拉同步验证

- 执行者：Codex
- 修复：移动端 `画板 / AI 生图 / AI 改图 / 素材` 四页增加应用内下拉同步手势，触发后调用 `GET /api/boards/:boardId` 更新当前画板数据。
- 行为边界：不使用 `window.location.reload`，不触发路由跳转，不改变当前 tab，不清空提示词、源图、参考图、涂抹笔触或生成过程状态。
- 交互区分：移动端显示独立胶囊提示 `下拉同步 / 松开同步内容 / 正在同步 / 已同步 / 同步失败`；移动端容器增加 `overscroll-behavior-y: contain`，避免表现成浏览器原生下拉刷新。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 3333 部署检查：已重启生产预览服务，监听进程 `22924`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200，未登录访问 `http://127.0.0.1:3333/boards/codex-preview-debug-board` 返回 307。
- 移动端浏览器验证：Playwright 创建临时用户和画板后登录 `http://taki999.f3322.org:3333`，在 390x844 触摸视口依次对 `画板 / AI 生图 / AI 改图 / 素材` 执行下拉手势；每个 tab 都发起 1 次 board GET 请求，URL 不变，`.workspace-sidebar` 保持对应 `mobile-view-*` class，无浏览器级导航，控制台 warn/error 为空。
- 截图：`tmp/mobile-pull-refresh-smoke.png`。

## 2026-04-30 移动端标题栏同步按钮验证

- 执行者：Codex
- 修复：按用户最新反馈取消移动端下拉同步，删除下拉手势、同步胶囊和相关 overscroll 限制。
- 修复：移动端每个页面共用标题栏右侧，在保存按钮旁新增同步按钮，使用 `lucide-react` 的 `RefreshCw` 图标。
- 行为边界：同步按钮只调用 `GET /api/boards/:boardId` 更新当前画板数据，不触发浏览器刷新，不改变当前 tab，不清空提示词、源图、参考图、涂抹笔触或生成过程状态。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 3333 部署检查：已重启生产预览服务，监听进程 `20228`。
- 移动端浏览器验证：Playwright 创建临时用户和画板后登录 `http://taki999.f3322.org:3333`，在 390x844 移动视口依次点击 `画板 / AI 生图 / AI 改图 / 素材` 四页的同步按钮；每个 tab 都发起 1 次 board GET 请求，URL 不变，`.workspace-sidebar` 保持对应 `mobile-view-*` class，无浏览器级导航，`.mobile-pull-refresh-indicator` 数量为 0，控制台 warn/error 为空。
- 截图：`tmp/mobile-sync-button-smoke.png`。

## 2026-05-01 图片模型错误来源验证

- 执行者：Codex
- 排查结论：最近失败的 `GenerationJob.paramsJson` 记录显示本应用实际请求模型为 `gpt-image-2`；错误里的 `gpt-5.4-mini` 来自上游 OpenAI 兼容代理返回，不是本应用选择的图像模型。
- 上游进程：`127.0.0.1:8317` 监听进程为 `C:\Users\koiyo\Desktop\Ai工具\CLIProxyAPI\cli-proxy-api.exe`。
- 修复：`getImageModel` 空值兜底和 API 设置页默认图片模型统一为 `gpt-image-2`。
- 修复：`/api/generation-jobs` 失败信息现在包含本应用请求模型、接口展示名、Base URL 状态和上游原始错误，后续再出现代理内部模型名时可以直接区分来源。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `17800`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。

## 2026-05-01 桌面端标题栏功能补齐验证

- 执行者：Codex
- 修复：桌面端标题栏显示与移动端一致的返回、同步、保存入口，四个工作区 tab 共用，不再只在移动端可用。
- 修复：桌面端标题栏状态行恢复显示，AI 生图、AI 改图、素材页也能看到当前画板和操作状态。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `10452`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。
- 桌面端浏览器验证：Playwright 创建临时已审核用户和临时画板，登录 `http://taki999.f3322.org:3333` 后在 1366x900 桌面视口检查 `画板 / AI 生图 / AI 改图 / 素材` 四页；每页标题栏均显示返回、同步、保存和状态行，按钮未超出侧栏边界，点击同步后状态行更新为 `已同步最新内容`，控制台 warn/error 为空。
- 截图：`tmp/desktop-header-actions-smoke.png`。

## 2026-05-01 API 设置保存验证

- 执行者：Codex
- 修复：已有 API Key 的配置允许不重新输入 Key 直接修改并保存显示名称、Base URL、图片模型；后端保存时保留原 API Key。
- 边界：新建 API 设置仍然要求填写 API Key；响应继续只返回 `hasApiKey` 和脱敏预览，不返回明文 Key。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `38936`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。
- 回归脚本：`SMOKE_BASE_URL=http://taki999.f3322.org:3333 node --experimental-sqlite scripts/smoke-auth-provider.mjs` 通过，覆盖空 API Key 更新已有配置。
- 页面验证：Playwright 创建临时已审核管理员和已有 provider 设置，登录后在 API 设置卡片中保持 API Key 输入为空，只修改显示名称和图片模型，保存成功并显示 `API 设置已保存`；读取 `/api/provider-settings` 确认字段已更新且 `hasApiKey = true`，读取本地数据库确认原 API Key 未被覆盖。
- 截图：`tmp/provider-settings-update-without-key.png`。

## 2026-05-01 图片编辑 empty_stream 缓解验证

- 执行者：Codex
- 排查结论：最新失败记录实际请求 `Base URL = http://127.0.0.1:8317/v1`、模型 `gpt-image-2`，失败接口为 `CLIProxyAPI` 日志中的 `/v1/images/edits` multipart 请求。
- 根因判断：这不是 404 路由问题，也不是应用请求了错误模型；本地代理已接到图片编辑请求，但上游在第一段内容返回前断流。最近失败 job 的 `count = 2`，旧代码会并发提交两条图片编辑请求，容易放大本地代理和上游断流问题。
- 修复：`/api/generation-jobs` 的多张图片请求改为顺序执行，保留生成张数，但避免同一时间提交多条大体积图片编辑流。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `27408`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。
- 边界：未直接触发真实生图，避免消耗图片接口额度；若单张图片编辑仍返回同样 `empty_stream`，问题就收敛到 `CLIProxyAPI -> zhongyang 上游` 的服务稳定性或上游模型能力。

## 2026-05-01 单图 AI 改图 multipart 兼容验证

- 执行者：Codex
- 排查结论：用户复测后最新失败 job 是 `AI 改图` 单源图请求，`count = 1`，无蒙版、无参考图，仍失败在 `/v1/images/edits`。
- 修复：当图片编辑只有 1 张输入图时，后端传单文件 `image` 字段；只有多张源图/参考图时才传数组。该调整兼容只支持单图 `image`、不支持单元素 `image[]` 的 OpenAI 兼容接口。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `23672`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。

## 2026-05-01 生成图片画板排布验证

- 执行者：Codex
- 修复：生成结果插入画板时不再使用固定 `(120,120)` 起点；后端返回的图片在客户端插入时会根据当前页已有图片边界自动寻找右侧空位。
- 行为：AI 生图和 AI 改图共用 `insertAsset` 排布逻辑；AI 改图优先放在源图/选区右侧，连续生成会继续向右排布并保持 32px 间隔，避免移动端和桌面端堆叠。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `43268`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。

## 2026-05-01 管理员用户用量与限制验证

- 执行者：Codex
- 修复：用户表新增 `generationLimit`，空值表示不限量；数据库初始化脚本可为现有库自动补列。
- 新增：管理员首页显示“用户用量”，可查看各用户画板数、任务数、成功/失败任务数、生成图片数、最近生成图片，并可保存生成图片上限。
- 新增：`GET /api/admin/usage` 返回用量汇总，`PATCH /api/admin/usage` 更新指定用户生成图片上限。
- 限制：`POST /api/generation-jobs` 在创建任务和调用上游 API 前校验当前用户剩余额度；超过上限返回 429。
- 数据库检查：`npm run db:generate` 通过，`npm run db:init` 通过，确认本地 `User.generationLimit` 列存在。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 回归脚本：`SMOKE_BASE_URL=http://taki999.f3322.org:3333 node --experimental-sqlite scripts/smoke-auth-provider.mjs` 通过，覆盖管理员查看用量、设置上限、普通用户超限生成被拒绝且不调用上游图片 API。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `22800`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。

## 2026-05-01 管理员用量下拉选择与 5 小时限制验证

- 执行者：Codex
- 修复：管理员用户用量区域不再一次性展开完整用户列表，改为通过用户名称下拉框选择用户。
- 新增：选中用户后展示总任务、成功/失败任务、生成图片总数、最近 5 小时生成数、总剩余额度和 5 小时剩余额度。
- 新增：限制设置拆为“总生成图片上限”和“每 5 小时上限”，两个字段均可留空表示不限量。
- 新增：选中用户下方展示历史生成数据，按时间倒序显示最近 40 张成功生成图片，包含缩略图、画板、模式、时间和提示词。
- 限制：`POST /api/generation-jobs` 在创建任务前同时校验总量和最近 5 小时额度；任一额度不足都会返回 429，且不调用上游图片 API。
- 数据库检查：`npm run db:generate` 通过，`npm run db:init` 通过，确认本地 `User.generationFiveHourLimit` 列存在。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 回归脚本：`SMOKE_BASE_URL=http://taki999.f3322.org:3333 node --experimental-sqlite scripts/smoke-auth-provider.mjs` 通过，覆盖管理员查看用量、设置总量上限、设置 5 小时上限、普通用户超限生成被拒绝且不调用上游图片 API。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `26840`；`http://127.0.0.1:3333/login` 返回 200，`http://taki999.f3322.org:3333/login` 返回 200。

## 2026-05-01 用户默认额度、管理操作与命名规则验证

- 执行者：Codex
- 新增：新注册用户默认总生成图片上限为 30，最近 5 小时上限为 10。
- 新增：管理员在用户用量面板中可以对选中用户执行停用、启用、删除。
- 限制：停用用户后，后续 API 访问会被拒绝；启用后恢复访问；删除用户前会清理该用户画板下的本地素材目录，并通过数据库级联删除画板、素材、生成任务和会话。
- 限制：管理员接口禁止停用、启用或删除当前管理员以及其他 admin 用户。
- 修复：生成图片文件名改为 `用户名_项目名_年月日时分秒`，同批多图追加 `_01` 这类序号。
- 修复：Auth.js 配置启用 `trustHost`；本地 `.env` 补充运行期认证密钥和 trusted-host 开关，减少 127.0.0.1 / localhost / taki999.f3322.org 访问入口切换造成的重启配置问题。
- 数据库检查：`npm run db:generate` 通过，`npm run db:init` 通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 回归脚本：`SMOKE_BASE_URL=http://taki999.f3322.org:3333 node --experimental-sqlite scripts/smoke-auth-provider.mjs` 通过，覆盖默认额度、文件命名前缀、用户停用、启用、删除。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `25692`；`http://127.0.0.1:3333/login`、`http://localhost:3333/login`、`http://taki999.f3322.org:3333/login` 均返回 200。

## 2026-05-01 用户生成图片归档目录验证

- 执行者：Codex
- 新增：项目根目录增加 `generated-images/<用户名>/` 归档目录，用户每次成功生成图片后都会额外保存一份到自己的用户名子目录。
- 命名：归档文件沿用 `用户名_项目名_年月日时分秒` 规则，同批多图追加序号。
- 清理：管理员删除用户时会同步删除该用户的 `generated-images/<用户名>` 目录。
- 版本控制：`.gitignore` 已加入 `/generated-images`，避免生成图片进入代码仓库。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 回归脚本：`SMOKE_BASE_URL=http://taki999.f3322.org:3333 node --experimental-sqlite scripts/smoke-auth-provider.mjs` 通过，覆盖生成图片归档文件落盘。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `12268`；`http://127.0.0.1:3333/login`、`http://localhost:3333/login`、`http://taki999.f3322.org:3333/login` 均返回 200。

## 2026-05-01 提示词长度限制验证

- 执行者：Codex
- 修复：AI 生图提示词和 AI 改图修改要求的前端计数与输入限制从 500 调整为 2000。
- 说明：后端 `/api/generation-jobs` 的 `prompt` 校验已允许更长文本，本次主要统一前端输入限制和计数显示。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `5772`；`http://localhost:3333/login` 与 `http://taki999.f3322.org:3333/login` 均返回 200。

## 2026-05-01 管理设置落地页与 API 设置折叠验证

- 执行者：Codex
- 新增：管理员首页增加“管理中心”落地页，包含 API 设置、用户审核、用户管理三个入口，并展示当前配置/待审核/用户数量摘要。
- 修复：API 设置标题旁新增“展开 API 设置 / 收起 API 设置”按钮，控制 API 设置表单区域折叠或展开。
- 行为：已有启用 API 配置时默认收起，未配置时默认展开，避免新用户看不到必要配置。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。
- 3333 部署检查：已重启生产预览服务，监听进程 `40968`；`http://localhost:3333/login` 与 `http://taki999.f3322.org:3333/login` 均返回 200。

## 2026-05-01 用户用量折叠与响应式布局审核验证

- 执行者：Codex
- 修复：管理员“用户用量”默认折叠，标题区保留“同步”和“展开用户用量/收起用户用量”，折叠态展示用户数、生成图片数和生成任务数摘要，避免管理页过长。
- 修复：360px 宽移动预览页不再使用固定 390px iframe 和标题宽度，避免“打开桌面版”按钮与预览框横向溢出。
- 修复：901px 到 1180px 桌面画板顶部工具栏改为图标优先布局；移动端画板顶部工具栏收紧按钮宽度与间距，避免默认工具或“更多”面板按钮越界。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 布局审核：Playwright 登录管理员后检查管理首页、展开用户用量、画板页、打开“更多”工具配置、移动预览页；覆盖 1440x960、390x844、360x740、1024x760，均无页面横向滚动和可见按钮越界。
- 3333 部署检查：已重启生产预览服务，监听端口 `3333`；测试入口使用 `http://taki999.f3322.org:3333`。

## 2026-05-01 登录页预览稿落地验证

- 执行者：Codex
- 修改：真实登录页采用预览稿的左右分栏结构，左侧保留品牌、标题、登录表单、折叠注册入口和两个标签；右侧展示画板预览；移动端收敛为单列登录卡片。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check -- src/components/LoginPanel.tsx src/app/globals.css` 通过，仅有 Windows LF-to-CRLF 提示。
- 浏览器检查：Playwright 打开 `http://localhost:3333/login`，覆盖 1440x900、390x844、360x740，均无横向滚动、控制台无 error，注册折叠面板可展开。
- 截图留存：`tmp/login-implemented-desktop.png`、`tmp/login-implemented-mobile390.png`、`tmp/login-implemented-mobile360.png`。
- 3333 部署检查：已重启生产预览服务，监听进程 `38244`。

## 2026-05-01 登录后首页预览稿落地验证

- 执行者：Codex
- 修改：登录后首页按预览稿改为顶栏、项目工作台主区、右侧管理栏；保留新建画板、画板操作、API 设置、用户审核和用户用量功能。
- 修改：账号区改为账号胶囊和退出按钮，API 设置入口移动到右侧管理中心。
- 响应式：桌面维持主区 + 右栏，1024px 收敛为更窄双栏，900px 以下改为单列。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check -- src/components/BoardList.tsx src/components/AccountActions.tsx src/app/globals.css` 通过，仅有 Windows LF-to-CRLF 提示。
- 浏览器检查：Playwright 使用临时视觉账号打开 `http://taki999.f3322.org:3333/`，覆盖 1440x900、1024x760、390x844、360x740，均无横向滚动、控制台无 error。
- 截图留存：`tmp/logged-in-implemented-desktop.png`、`tmp/logged-in-implemented-tablet.png`、`tmp/logged-in-implemented-mobile390.png`、`tmp/logged-in-implemented-mobile360.png`。
- 清理：截图后已删除临时视觉账号和相关画板数据。
- 3333 部署检查：已重启生产预览服务，监听进程 `35960`。

## 2026-05-01 用户用量展开态布局验证

- 执行者：Codex
- 修改：用户用量卡片从右侧窄栏移动到首页底部横跨整页的位置，展开后不再挤压在管理栏内。
- 修改：展开态增加汇总区、用户选择区、用户详情区、额度设置区、历史记录区的分区布局；桌面/平板使用宽布局，移动端改为单列。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check -- src/components/AdminUsagePanel.tsx src/components/BoardList.tsx src/app/globals.css` 通过，仅有 Windows LF-to-CRLF 提示。
- 浏览器检查：Playwright 临时替换本地管理员 `koiyoho` 密码哈希后登录并展开 `#admin-usage`，覆盖 1440x1000、1024x900、390x900、360x820，均无 console error；移动端补充验证无横向滚动。验证后已恢复原管理员密码哈希。
- 截图留存：`tmp/admin-usage-expanded-desktop.png`、`tmp/admin-usage-expanded-tablet.png`、`tmp/admin-usage-expanded-mobile390.png`、`tmp/admin-usage-expanded-mobile360.png`。
- 3333 部署检查：已重启生产预览服务，监听进程 `37528`。

## 2026-05-01 提交前文档更新验证

- 执行者：Codex
- 文档：`README.md` 已更新当前登录页、首页、管理员用量、默认额度、生成图片归档、API 设置、提示词限制和桌面/移动工作台说明。
- 文档：`docs/ai-image-workbench-plan.md` 已补充当前状态，标记工作台结构已落地。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- Diff 检查：`git diff --check` 通过，仅有 Windows LF-to-CRLF 提示。

## 2026-05-08 细粒度参考图角色验证

- 执行者：Codex
- 修改：新增共享参考角色表，前端参考图角色和后端生成接口校验共用同一组角色。
- 修改：角色范围扩展到五官脸型、发型发色、妆容、身形、上衣、下装、连衣裙、鞋子、包包、帽子、配饰、场景、动作姿势、构图机位等。
- 修改：AI 生图和 AI 改图提示词增加角色外观、场景、动作、构图的分离约束，避免参考图的无关背景、服装、姿势或构图被误复制。
- 本地断言：`node scripts/verify-reference-roles.mjs` 通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 未执行真实生图：本次是角色 schema 与提示词链路调整，真实生成会消耗图片额度。
