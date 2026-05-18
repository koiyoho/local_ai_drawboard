# AI 画板桌面端 UI 重构预览设计

日期：2026-05-14

## 目标

为当前 AI Board 项目生成一张桌面端 UI 重构预览图，用于后续前端改版参考。预览图应基于现有功能，不改变产品定位：这是一个本地优先的 AI 图片画板，核心体验是自由画布、AI 生图、AI 改图、素材管理、图层管理和生成历史。

最终效果应是一款时尚、专业、偏创作工具气质的 AI 画板，不是营销落地页，也不是普通管理后台。

## 产品功能基线

预览图需要体现以下真实功能：

- 自由画布：支持图片、文本、形状、路径、选择、移动、缩放、适应画布、撤销、重做、导出。
- AI 生图：输入提示词，选择画幅比例、清晰度、画风、生成数量，支持提示词优化。
- AI 改图：选择源图，输入修改要求，支持局部涂抹蒙版、整图改图、生成变体、删除背景。
- 参考图：最多 8 张参考图，可标记主体人物、商品、服装、Logo、风格、背景等角色。
- 素材库：展示当前画板最近素材、生成图片、上传图片、源图、蒙版；支持预览、设为源图、加入参考图、下载、删除、反推提示词。
- 图层面板：显示图片、路径、矩形、文本图层，支持重命名、隐藏、锁定、上下移动、删除。
- 画板管理：切换画板、创建画板、保存、同步、返回管理入口。
- 生成状态：显示当前生成任务、等待状态、成功/失败反馈和历史记录。

## 设计定位

视觉 thesis：深色创作工作台搭配高亮青绿与暖白画布，整体像高级数字影棚中的 AI 创意控制台，信息密度高但层级清楚。

内容 plan：左侧为主工具栏和画板导航，中间为大画布与浮动编辑工具，右侧为 AI 生图/改图控制台，底部或右下角展示素材胶片与生成历史，图层面板作为右侧可收起抽屉。

交互 plan：面板切换使用轻微滑入和淡入；生成按钮与生成状态带柔和脉冲光；素材拖入画布时出现吸附高亮和阴影预览。

## 画面规格

- 只生成一张桌面端应用界面预览图。
- 推荐画幅：16:9。
- 推荐尺寸：1920 x 1080。
- 视角：正面桌面软件截图风格，轻微景深可以有，但界面必须清晰可读。
- 页面类型：实际可用的 Web App 工作台首屏，不要做 landing page。
- 文本语言：中文为主，少量英文作为品牌与技术标签。

## 整体布局

### 顶部栏

顶部栏高度约 56px，横跨全屏。

需要包含：

- 左侧品牌：AI Board / 智能画板，配一个简洁几何图标。
- 当前画板名：例如「春季新品视觉稿」。
- 状态信息：已保存、同步成功、最近生成 12 张。
- 右侧操作：保存、同步、导出、图层、画板管理、头像或账号菜单。

顶部栏应轻薄，不要像传统后台导航。使用半透明深色玻璃质感，下面有细线分割。

### 左侧工具栏

左侧为窄工具栏，宽度约 72px。

工具图标从上到下：

- 选择
- 图片上传
- 画笔 / 蒙版
- 矩形 / 形状
- 文本
- 适应画布
- 撤销
- 重做
- 导出

图标按钮使用方形或轻微圆角，当前工具用青绿色高亮描边。不要把工具按钮做成大块文字按钮。

### 中央画布

中央区域是最大视觉主体，占据约 60% 到 65% 宽度。

画布表现：

- 暖白或淡灰画布面板，带细点阵网格。
- 画布中放置 4 到 6 个创作元素：一张主商品图、一张人物参考图、一个生成结果、几段文本标注、一个半透明蒙版涂抹区域。
- 选中的图片应有蓝绿色控制框、角点、旋转手柄。
- 画布上方或下方有浮动快捷工具条：缩放百分比、锁定、复制、删除、生成变体、局部重绘、删除背景。
- 画布边缘留出空间，能看出这是可拖拽无限画布，而不是单张静态海报。

画布不应过度装饰。核心是让用户一眼知道这里可以编辑图片、摆放素材、框选对象、进行 AI 改图。

### 右侧 AI 控制台

右侧固定面板宽度约 420px，是第二视觉重心。

顶部使用分段标签：

- AI 生图
- AI 改图
- 素材
- 历史

当前选中「AI 生图」或「AI 改图」均可。推荐预览图选中「AI 改图」，因为它更能展示源图、参考图、蒙版和生成控制。

AI 改图面板需要包含：

- 源图预览卡片，显示一张已选图片和「已选源图」状态。
- 修改要求输入框，示例文案：「将手中的包替换为银色金属香水瓶，保持人物姿势和光线」。
- 改图模式：整图改图 / 局部涂抹 / 生成变体。
- 蒙版控制：笔触大小、羽化强度，两条滑杆。
- 保留强度：严格保留主体 / 平衡保留 / 自然融合。
- 参考图区域：横向小缩略图，带角色标签，如「商品」「风格」「背景」。
- 主要按钮：开始 AI 改图。
- 生成状态：正在生成 00:18、预计输出 2 张。

如果选中「AI 生图」，则需要展示提示词、画幅比例、清晰度、画风、数量、参考图和提示词优化。两种状态二选一即可，不要同时堆满。

### 素材胶片与历史

在画布底部或右侧面板下半部分展示素材胶片。

需要包含：

- 8 到 12 张缩略图，类型混合：上传、生成、源图、蒙版。
- 每张缩略图有轻量标签：生成、上传、源图、收藏。
- 当前选中素材有高亮边框。
- 历史项可显示简短提示词和状态，例如「已完成」「失败」「可复用」。

素材区要像创作者的素材盘，不能像文件管理器表格。

### 图层抽屉

右侧或画布右上方可出现一个半展开图层浮层，宽度约 280px。

图层项示例：

- 商品主图，图片，已选中。
- 蒙版笔触，路径，锁定。
- 标题文案，文本。
- 背景色块，矩形，隐藏按钮。

每行有类型图标、名称、可见性、锁定、上下移动控件。图层面板应薄而专业，像设计软件的一部分。

## 色彩与材质

推荐主色调：

- 背景：深墨蓝黑 `#10141F` 或炭黑 `#111318`。
- 主面板：石墨灰 `#181D29`。
- 画布：暖白 `#F6F2E8` 或浅雾灰 `#F5F7FA`。
- 主强调：电光青绿 `#35E0B8`。
- 次强调：柔和钴蓝 `#4E7BFF`。
- 警示/失败：低饱和珊瑚红 `#F06A7A`。
- 成功：青绿色 `#44D7A8`。
- 文本：近白 `#F4F7FB`、次级灰 `#A9B0C3`。

材质建议：

- 深色面板使用轻微玻璃感和 1px 半透明描边。
- 主画布保持干净，不使用强渐变背景。
- 高亮状态可以有细腻外发光，但不要出现大面积紫蓝 AI 光球。
- 阴影要短而克制，突出层级，不要做厚重卡片堆叠。

## 字体与图标

- 中文界面建议使用现代无衬线风格，类似 Noto Sans SC / PingFang SC 的清晰字形。
- 英文品牌和数字状态可使用 Sora / Geist / Space Grotesk 风格。
- 标题 16 到 20px，面板标签 12 到 14px，按钮 13 到 15px。
- 图标风格应统一为线性图标，类似 lucide-react。
- 不要使用夸张 3D 图标、卡通贴纸或过大的装饰图形。

## 关键视觉细节

- 当前生成任务在右侧按钮附近显示微弱流光，表达 AI 正在处理。
- 画布中的选中图片显示控制点，表达这是可编辑对象。
- 蒙版涂抹区域使用半透明青绿色或珊瑚色覆盖在源图局部。
- 参考图缩略图有角色标签，体现多图参考能力。
- 右键菜单或浮动操作条可展示「局部重绘」「图生图」「生成变体」「删除背景」。
- 画布底部显示缩放 84%、对象 6、选中 1、自动保存成功。

## 生图工具提示词

可直接复制以下提示词生成 UI 预览图：

```text
Create a premium desktop web app UI mockup for an AI image board called "AI Board 智能画板". One single 16:9 screenshot-style interface, 1920x1080. The product is a fashionable AI creative canvas for image generation, image editing, local inpainting, reference images, asset management, generation history, and layer control.

Layout: dark professional creator workspace. Thin translucent top bar with brand, current board name "春季新品视觉稿", saved/synced status, export, layers, board management, user avatar. Narrow left vertical toolbar with line icons for select, upload image, mask brush, shapes, text, fit canvas, undo, redo, export. Large central warm-white canvas with subtle dot grid, several editable image objects, one selected product image with turquoise bounding box and resize handles, a person reference image, one generated result, short annotation text, and a semi-transparent local mask brush area. Floating canvas toolbar with zoom, duplicate, delete, generate variation, local repaint, remove background.

Right side AI control panel about 420px wide, selected tab "AI 改图" with tabs "AI 生图 / AI 改图 / 素材 / 历史". Include source image preview, prompt textarea containing Chinese prompt text, edit mode segmented control, sliders for brush size and feather, preservation strength selector, horizontal reference image thumbnails with role chips 商品 / 风格 / 背景, primary button "开始 AI 改图", and live generation status "正在生成 00:18". Bottom or lower-right asset filmstrip with 10 thumbnails labeled 生成, 上传, 源图, 蒙版, 收藏. Include a slim layer drawer with rows for 商品主图, 蒙版笔触, 标题文案, 背景色块, with visibility and lock icons.

Visual style: sophisticated dark graphite panels, clean warm canvas, electric mint accent #35E0B8, cobalt blue accent #4E7BFF, subtle 1px translucent borders, restrained glow only on active states, crisp Chinese typography, lucide-style line icons, dense but readable professional creative-tool layout. No landing page, no marketing hero, no purple blob background, no oversized cards, no cartoon style. The UI must look like a real production-grade desktop image editing and AI generation app.
```

## 反向约束

生成图中不要出现：

- 落地页 hero、宣传文案大标题或 CTA 区块。
- 纯聊天机器人界面。
- 与画板无关的数据看板、表格后台、CRM 风格布局。
- 大面积紫色渐变、漂浮光球、抽象 3D 球体。
- 过度圆角、厚重阴影、卡片套卡片。
- 无法辨认的乱码文本充满界面。
- 移动端界面或平板界面。

## 验收标准

预览图合格时，应能一眼看出：

- 这是一个桌面端 AI 图片画板，而不是普通图片库或聊天应用。
- 中央画布是主工作区，右侧 AI 控制台是生成和改图入口。
- 画布对象可被选择、编辑、导出和 AI 处理。
- 参考图、源图、素材、图层和生成历史都在同一个工作流中。
- 整体风格足够时尚，但仍然像可落地的生产级 Web App。
