# 《鹅厂出逃记》TODO

> 这是当前唯一的任务入口，只分为“编码”和“美术”两类。测试、构建、浏览器/手机验收属于对应任务的完成条件，不再单独拆分类别。详细背景、文件索引和生成提示词见 [HANDOFF.md](./HANDOFF.md)。

## 编码

### C0 · 接手后先建立基线

- [ ] 安装依赖并记录当前结果：`npm install`、`npm test`、`npm run build`、`npm run preview`。
- [ ] 用浏览器走一遍主菜单、序章、章节选择、存档、设置、分支选择和结局入口，记录真实阻塞，不把旧文档中的测试数字当作当前结果。
- [ ] 确认手机/平板横屏、触摸摇杆、键盘回退和断网运行的现状。
- 参考：`PROJECT_RULES.md`、`docs/checklist.md`、`src/main.js`、`src/core/ViewportAdapter.js`、`src/ui/VirtualJoystick.js`。

### C1 · 修正运行时资源和生产构建

- [ ] 修改 `vite.config.js`，让生产构建复制所有运行时需要的 SFX WAV，不只复制 BGM MP3。
- [ ] 修正 `src/config.js` 的 NPC portrait 路径，或补齐对应文件；对话过程中不得请求不存在的头像。
- [ ] 检查所有场景、角色、音频和 UI 的路径，生产构建后不出现 404 或静默缺资源。
- [ ] 补齐 `favicon.ico` 或移除无效引用。
- 参考：`vite.config.js`、`src/config.js`、`src/core/AssetLoader.js`、`src/core/AudioManager.js`、`assets/audio/README.md`。

### C2 · 完成共享俯视地图基础

- [ ] 建立可复用的地图数据结构：背景层、可行走区域、碰撞/阻挡层、前景遮挡层、互动点和出口。
- [ ] 先以荔枝园跑通闭环：婆婆对话 → 移动摘取 → 回婆婆交付 → 出口推进。
- [ ] 地图中的互动点、碰撞边界和剧情事件必须由数据/逻辑驱动，不继续堆叠单场景临时坐标。
- [ ] 再把相同结构推广到篮球馆、烧鹅店、工业园区、校园和松山湖。
- 参考：`docs/plans/2026-08-08-topdown-scene-revision.md`、`src/scenes/LycheeScene.js`、`src/core/SceneManager.js`、`src/core/PlayerController.js`。

### C3 · 接入正式场景和角色的运行时接口

- [ ] 为正式背景、前景遮挡、NPC、动作图集和头像定义稳定的加载、缩放、锚点、脚底线、绘制层级和降级规则。
- [ ] 替换场景中的 Canvas 色块/几何占位，但保留玩法碰撞与互动逻辑。
- [ ] 接入 NPC 的对话头像、场景立绘、巡逻/被抓状态和朝向切换。
- [ ] 接入莞小鹅 `interact`、`eat`、`throw`、`scared`、`hide`、`caught`、`celebrate`、`sit` 等动作的播放入口。
- 参考：`src/core/GooseSprite.js`、`src/core/SpriteAnimation.js`、`src/core/AssetLoader.js`、`docs/character-action-frames/action-manifest.json`。

### C4 · 完成全流程与移动端交付

- [ ] 确认 7 个章节、存档/读档、设置、印记、五个场景抉择、六个结局和章节地图联动没有断点。
- [ ] 完成手机/平板横屏、safe-area、单拇指操作、竖屏提示、低帧率降级和断网包检查。
- [ ] 按 `PROJECT_RULES.md` 优化生产包；如仍超过 `<5 MB`，明确记录压缩方案或豁免原因。
- [ ] 每完成一个编码任务，补充对应测试和 `docs/checklist.md` 结果；未实测的项目保持未勾选。
- 参考：`docs/checklist.md`、`src/core/SaveSystem.js`、`src/ui/ChapterMap.js`、`src/core/ViewportAdapter.js`、`PROJECT_RULES.md`。

## 美术

### A1 · 正式场景背景

- [ ] 为每个可玩章节产出并筛选正式背景，统一镜头、画幅、光照、色彩和莞小鹅的可识别度。
- [ ] 每张背景明确可行走区域、主地标、互动点预留、出口位置和前景遮挡需求。
- [ ] 输出可被代码接入的背景/前景资源，不把带设定图背景的候选图直接当运行时素材。
- 参考：`docs/scene-templates/s1/`、`docs/scene-candidates/s2/`、`docs/plans/2026-08-08-topdown-scene-revision.md`、`HANDOFF.md` 第 9 节场景提示词。

### A2 · NPC、莞小鹅动作和运行时透明资源

- [ ] 将 NPC 三视图重绘/裁切为透明运行时资源，保留统一比例、脚底线、朝向和安全边距。
- [ ] 补齐教练、果农阿婆、烧鹅店老板、学长、学姐的对话头像。
- [ ] 制作莞小鹅剧情/玩法动作，以及老板巡逻、发现、被抓等动作；不得继续使用红色色块或带背景参考图。
- [ ] 输出可用的透明 PNG/图集和对应帧规格，确认没有白底、灰底、裁切残影或角色身份漂移。
- 参考：`assets/characters/gxe/ANCHOR.md`、`assets/characters/gxe/`、`assets/characters/npcs/`、`docs/character-action-refs/`、`docs/character-action-frames/`。

### A3 · 场景物件和互动反馈

- [ ] 补齐篮架/篮球、荔枝树/栅栏、桌底/木桶/门帘、安检门/无人机/齿轮、校园物件、松山湖长椅/芦苇等关键物件。
- [ ] 让物件能表达玩法状态：可互动、已完成、阻挡、可躲藏、目标和出口必须一眼可区分。
- [ ] 补齐进球、收集、翻墙、被抓、结局和转场等关键反馈素材。
- 参考：`docs/scene-templates/s1/`、`assets/transition/`、`HANDOFF.md` 第 9 节场景提示词。

### A4 · UI、印记和结局 CG

- [ ] 制作 7/12 印记图标及灰态、收集闪光和章节地图节点视觉资源。
- [ ] 制作对话框、虚拟摇杆、设置面板、章节地图、转场遮罩等正式 UI 美术。
- [ ] 将六套 Ending CG 从“场景定格 + 文案 + 色调”首版替换或提升为可发布的结局画面。
- [ ] 统一主菜单、章节地图、对话、按钮、提示和结局的字体、边框、色板与层级。
- 参考：`src/ui/`、`src/data/badges.js`、`src/ui/EndingCG.js`、`docs/character-action-refs/`、`HANDOFF.md` 第 9 节。

### A5 · 音频和资源交付

- [ ] 试听并确认现有 BGM/SFX 的情绪、音量、循环、文件命名和来源/授权记录。
- [ ] 补齐仍缺失或效果不足的潜行、烤鹅、按钮、打字、收集、转场、结局等 SFX，并与代码事件对应。
- [ ] 清理重复 JPG/PNG、调试图和无效资源；将菜单背景、BGM、头像和重复图集压缩到合理体积。
- [ ] 为最终资源记录来源、生成日期、版本和 SHA-256；没有授权依据的素材不要进入发布包。
- 参考：`assets/audio/README.md`、`assets/audio/`、`art-audio-todo/art-audio-todo.html`、`art-resource-todo/art-resource-todo.html`。

### A6 · 美术完成定义

- [ ] 资源已经放入正确目录并被运行时实际引用。
- [ ] 透明边缘、比例、脚底线、画面构图、颜色对比和不同屏幕尺寸均已人工确认。
- [ ] 代码不再依赖关键色块、文字或带背景设定图作为最终视觉资源。
- [ ] 交接文档只把“文件存在”标为资源准备，不把它标为“已完成接入”。
