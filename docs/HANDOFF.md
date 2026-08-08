# 《鹅厂出逃记》项目交接文档

> 交接版本：2026-08-08（Asia/Shanghai）  
> 检查范围：代码结构、运行时资源、美术参考、音频、构建配置和交接风险；**测试/验收由下一位接收者执行**。  
> 当前结论：**核心玩法代码和 M5 剧情分支已经形成；正式场景美术、NPC/动作资源接入、移动端全流程验收和发布打包仍未完成。**
> 当前 TODO 统一整理在本文第 5 节，只分为“编码”和“美术”。仓库外的三个 TODO 页面继续保留为美术细目、音频细目和提示词参考，不再新增第三套任务清单。

## 1. 先看这里：交接结论

### 已确认可以交给下一位开发者的部分

- 项目是原生 Canvas 2D + DOM UI + Vite + Vitest，无外部 CDN 依赖。
- 主菜单、序章对话和工厂移动流程的入口代码已存在；是否能启动、是否能走通由下一位接收者确认。
- 代码测试、生产构建、浏览器冒烟、美术验收和真机验收均不作为本交接的已完成项，命令与验收条件保留在第 12 节。
- M0-M5 的核心系统、章节流程、存档、设置、印记、结局分支和测试已经存在。
- 主菜单背景、主菜单莞小鹅、核心 idle/walk/run 序列帧和 BGM 文件已经在当前工作区出现；实际显示、比例、性能和授权由接收者复核。
- 当前 Git 分支为 `feat/mobile-landscape-scope`，HEAD 为 `caf70ad`；但工作树存在大量未提交修改和未跟踪文件，**不能直接把当前状态当成已发布提交**。

### 必须在交接后继续处理的部分

1. 正式场景背景和俯视地图没有接入运行时。当前篮球馆、荔枝园、烧鹅店、工业园区、校园等场景仍主要由 Canvas 色块、线条和几何占位绘制。
2. NPC 三视图和动作帧目前是参考/独立帧资源，不是已接入的透明运行时角色；烧鹅店老板在实际场景中仍是红色色块占位。
3. `vite.config.js` 只复制 BGM 到生产 `dist/assets/audio/`，SFX WAV 没有被复制；发布构建中的 SFX 请求会失败并静默降级。
4. `src/config.js` 中教练、果农阿婆、老板、学长、学姐的 portrait 路径已配置，但对应文件当前不存在；NPC 对话头像需要补齐或改为已存在的资源。
5. 资源体积超过项目规则：当前 `dist/` 约 **11.28 MB**，而 `PROJECT_RULES.md` 目标是总资源 `<5 MB`；源 `assets/` 约 **32.31 MB**。
6. `docs/plans/2026-08-08-topdown-scene-revision.md` 已确认俯视改造方向，但清单仍未完成；需要先做共享地图/碰撞/互动层，再逐章替换占位背景。
7. 尚未完成真实手机/平板横屏、触摸摇杆、全流程、断网包和 `npm run preview` 的最终验收。
8. 本地开发时浏览器有 `favicon.ico` 404；不阻塞玩法，但发布前应补图标或移除引用。

## 2. 当前仓库与版本状态

### Git 状态

- 仓库根目录：`goose-escape-game/`
- 当前分支：`feat/mobile-landscape-scope`
- 当前 HEAD：`caf70ad refactor: 移除 CHOICE_LOCK 僵尸事件`
- `main` 与当前分支当前指向同一个 HEAD。
- 本地没有配置 Git remote；当前尚未与 GitHub 仓库关联。
- 初始检查时已有 34 个已跟踪文件被修改，并有大量美术、音频、测试、截图和临时文件未跟踪。交接前请先区分“应提交源文件”和“仅用于审查的产物”。

### 建议上传 GitHub 的边界

建议上传：

- `package.json`、`package-lock.json`、`vite.config.js`、`index.html`
- `PROJECT_RULES.md`
- `src/`
- `tests/`
- `assets/` 中确认有授权且需要运行时使用的资源
- `docs/` 中的 PRD 补充、计划、验收清单和本交接文档

上传前确认或清理：

- `output/playwright/`：截图证据，可选；不是运行时资源。
- `.playwright-cli/`：浏览器快照/日志，不建议提交。
- `tmp/`：ImageGen 临时资源，不建议提交。
- `dummy-non-existing-folder/`：当前看起来是音频调试/误放目录，提交前需要人工确认用途。
- `dist/`：已被 `.gitignore` 忽略，按发布流程构建，不建议提交。
- `docs/scene-candidates/`、`docs/scene-templates/`、动作参考帧：若 GitHub 用于美术交接，应保留；若仓库只放代码，需要在 README 或素材仓库中补外链/归档位置。

## 3. 已完成内容（代码）

### 核心系统

- `src/core/Game.js`：主循环、deltaTime 钳制、启动/停止。
- `src/core/SceneManager.js`：场景注册、切换、返回历史。
- `src/core/EventBus.js`：`on/off/emit/once`。
- `src/core/InputManager.js`：键盘回退、动作事件、移动输入。
- `src/ui/VirtualJoystick.js`：触控摇杆逻辑和 8 方向输入测试。
- `src/core/PlayerController.js`：walk/run 速度、边界、朝向和动画状态。
- `src/core/SpriteAnimation.js`、`src/core/GooseSprite.js`：莞小鹅核心序列帧播放、翻转、翻墙姿态。
- `src/core/AssetLoader.js`：图片、JSON、音频的缓存/加载和失败降级。
- `src/core/StorageService.js`、`src/core/SaveSystem.js`：localStorage、三槽位、版本兼容、choice 字段。
- `src/core/SettingsService.js`、`src/ui/SettingsPanel.js`：BGM/SFX/文本速度/语言/震动设置。
- `src/core/AudioManager.js`：BGM/SFX 分流、音量联动和缺失音频静默降级。
- `src/core/ParticleSystem.js`：尘土、进球、结局等粒子基础能力。
- `src/core/ViewportAdapter.js`：横竖屏判断、画布适配和旋转提示基础能力。

### 游戏流程和数据

- 主菜单：开始新游戏、继续游戏、操作说明、设置、无存档置灰、加载反馈。
- 序章工厂：对话 → 移动 → 靠近围墙 → 空格翻墙 → 发放出厂印记。
- 篮球馆：蓄力投篮、抛物线、篮圈浮动、进球判定、失败重试/领取纪念。
- 荔枝园：`3 → 1 → 4 → 2` 顺序解谜、错误反馈、开门和印记。
- 烧鹅店：老板巡逻、方向性警戒区、警觉度、掩体、被抓复位、偷尝和逃跑。
- 工业园区：互动点、齿轮收集/组合和安检流程。
- DGUT 校园：三个观赏互动点、查看进度和继续前行。
- 松山湖：走马灯、结局判定、Ending CG 组件和再选一次。
- M5 伞形多结局：五个场景的“留下/继续”抉择、全程唯一留下、结局印记和章节地图联动。
- 数据文件：`src/data/chapters.js`、`badges.js`、`dialogues.js`、`hotspots.js`、`endings.js`。

### UI 与测试

- `src/ui/DialogueBox.js`、`src/core/DialogueRunner.js`：逐字对话、补全、下一句、标签解析。
- `src/ui/ChoiceOverlay.js`：留下/继续按钮和置灰状态。
- `src/ui/ChapterMap.js`、`src/ui/BadgePanel.js`、`src/ui/SavePanel.js`。
- 测试目录与现有测试文件已保留；测试数量可能随接收者修改继续变化。

## 4. 已完成内容（美术与音频）

### 当前工作区已有且已经使用的资源

- `assets/bg/bg_menu_cn.png`：主菜单背景，已有运行时引用。
- `assets/characters/gxe/gxe_menu_front.png`：主菜单莞小鹅，已有运行时引用。
- `assets/characters/gxe/gxe_idle_sheet.png` + `gxe_idle.json`
- `assets/characters/gxe/gxe_walk_sheet.png` + `gxe_walk.json`
- `assets/characters/gxe/gxe_run_sheet.png` + `gxe_run.json`
- `assets/characters/gxe/gxe_climb_pose.png`：翻墙关键姿态。
- `assets/ui/portraits/gxe_portrait_default.png`、`gxe_portrait_default_alpha.png`：主角对话头像资源。
- `assets/audio/bgm_*.mp3`：主菜单及七个章节的 8 首 BGM 文件存在。
- `assets/audio/sfx_*.wav`：当前工作区存在按钮、打字、投篮、潜行、收集、转场、结局、翻墙等音效文件。

### 已有但应视为“参考/待接入”的资源

- `assets/characters/gxe/gxe_character_anchor_3view.png`：角色身份锚定图，不是运行时贴图。
- `assets/characters/npcs/*_3view.png`：NPC 三视图设定图，带设定图背景，不应直接放进游戏。
- `docs/scene-templates/s1/*.png`：场景 S1 样板/方向参考。
- `docs/scene-candidates/s2/*.png`：场景 S2 候选图/构图参考，不等于最终可走地图。
- `docs/character-action-refs/`：动作参考图。
- `docs/character-action-frames/`：独立动作帧；`action-manifest.json` 明确标记 `runtimeAtlasGenerated: false`。
- `assets/transition/`：地图/转场相关素材，需要逐项确认是否已被运行时引用。

## 5. TODO（仅分编码与美术）

> 测试、构建、浏览器/手机验收不单独列类，而是每项编码或美术任务的完成条件。下面是下一位接收者真正需要继续处理的清单。

### 5.1 编码

- [ ] **建立接手基线**：执行并记录 `npm install`、`npm test`、`npm run build`、`npm run preview`；再走一遍主菜单、序章、章节选择、存档、设置、分支和结局入口。
- [ ] **修正运行时资源引用**：让 `vite.config.js` 复制全部 SFX WAV；修正 `src/config.js` 中不存在的 NPC portrait 路径；清理 `favicon.ico` 404 和其他资源 404。
- [ ] **完成共享俯视地图基础**：建立背景层、可行走/碰撞层、前景层、互动点和出口的数据结构；先跑通荔枝园“婆婆对话 → 摘取 → 交付 → 出口”闭环。
- [ ] **接入正式资源的运行时接口**：统一加载、缩放、锚点、脚底线、绘制层级和降级规则；接入正式场景、NPC 头像/立绘和莞小鹅动作入口，替换关键色块占位。
- [ ] **完成全流程交付**：确认 7 章、存档/设置、印记、五个场景抉择、六个结局和章节地图没有断点；完成横屏、safe-area、触摸摇杆、断网和低帧率检查。
- [ ] **包体与文档收尾**：按 `PROJECT_RULES.md` 优化 `<5 MB` 目标；首轮测试后更新 `docs/checklist.md`，只填写真实结果。

参考：`PROJECT_RULES.md`、`docs/checklist.md`、`docs/plans/2026-08-08-topdown-scene-revision.md`、`vite.config.js`、`src/config.js`、`src/core/AssetLoader.js`、`src/core/ViewportAdapter.js`、`src/ui/VirtualJoystick.js`、各章节 `src/scenes/*.js`。

### 5.2 美术

- [ ] **正式场景背景**：为每个可玩章节产出并筛选正式背景，明确可行走区域、主地标、互动点、出口和前景遮挡；不把带设定图背景的候选图直接当运行时素材。
- [ ] **NPC 与莞小鹅动作**：将三视图/独立动作帧转成透明运行时资源，统一比例、脚底线、朝向和安全边距；补齐 NPC 头像、老板巡逻/被抓和莞小鹅 `interact`、`eat`、`throw`、`scared`、`hide`、`caught`、`celebrate`、`sit`。
- [ ] **场景物件与反馈**：补齐篮架/篮球、荔枝树/栅栏、桌底/木桶/门帘、安检门/无人机/齿轮、校园物件、松山湖长椅/芦苇，以及进球、收集、翻墙、被抓、结局和转场反馈。
- [ ] **UI、印记和结局 CG**：补齐印记图标及灰态/收集反馈、章节地图节点、对话框、虚拟摇杆、设置面板、转场遮罩和六套正式 Ending CG。
- [ ] **音频与资源交付**：试听确认 BGM/SFX 的情绪、音量、循环、命名和授权；补缺失 SFX；清理重复/调试图；记录来源、生成日期、版本和 SHA-256。
- [ ] **美术完成条件**：资源已放入正确目录并被运行时实际引用；透明边缘、比例、构图、颜色对比和不同屏幕尺寸已人工确认；关键画面不再使用色块、文字或带背景设定图占位。

参考：`assets/characters/gxe/ANCHOR.md`、`assets/characters/gxe/`、`assets/characters/npcs/`、`assets/audio/`、`docs/scene-templates/s1/`、`docs/scene-candidates/s2/`、`docs/character-action-refs/`、`docs/character-action-frames/`、`assets/transition/`、本文第 9 节提示词，以及项目根目录下的 `art-resource-todo/`、`art-visual-todo/`、`art-audio-todo/`。

## 6. 代码重点文件索引

| 领域 | 入口/关键文件 |
| --- | --- |
| 应用启动 | `src/main.js`、`index.html` |
| 全局配置 | `src/config.js`、`vite.config.js` |
| 引擎 | `src/core/Game.js`、`SceneManager.js`、`EventBus.js`、`AssetLoader.js` |
| 输入/视口 | `src/core/InputManager.js`、`PlayerController.js`、`ViewportAdapter.js`、`src/ui/VirtualJoystick.js` |
| 角色 | `src/core/GooseSprite.js`、`SpriteAnimation.js`、`assets/characters/gxe/` |
| 章节 | `src/scenes/FactoryScene.js`、`BasketballScene.js`、`LycheeScene.js`、`StealthScene.js`、`IndustrialScene.js`、`CampusScene.js`、`SongshanScene.js` |
| 玩法逻辑 | `src/core/BallPhysics.js`、`StealthLogic.js`、`FactoryPhysics.js`、`SongshanLogic.js` |
| 剧情分支 | `src/ui/ChoiceOverlay.js`、`src/ui/EndingCG.js`、`src/data/endings.js`、`src/core/SaveSystem.js` |
| 数据 | `src/data/chapters.js`、`badges.js`、`dialogues.js`、`hotspots.js` |
| 验收 | `docs/checklist.md`、`tests/` |

## 7. 美术交接文件索引

### 仓库内

- 角色锚定：`assets/characters/gxe/ANCHOR.md`、`gxe_character_anchor_3view.png`
- 核心动画说明：`gxe-animation-assets/README.md`（仓库外参考副本）以及 `assets/characters/gxe/gxe_manifest.json`
- 场景样板：`docs/scene-templates/s1/`
- 场景候选：`docs/scene-candidates/s2/`
- 动作参考：`docs/character-action-refs/`
- 独立动作帧：`docs/character-action-frames/`
- 俯视改造说明：`docs/plans/2026-08-08-topdown-scene-revision.md`
- 主菜单和局部验收截图：`output/playwright/`

### 当前项目根目录下、但不在 `goose-escape-game` Git 仓库内

如果只把 `goose-escape-game` 上传 GitHub，下面文件不会自动包含在 GitHub 仓库中：

- `../../goose-escape-prd/GOOSE-ESCAPE-PRD.md`
- `../../goose-escape-prd/goose-escape-prd.html`
- `../../art-resource-todo/art-resource-todo.html`
- `../../art-visual-todo/art-visual-todo.html`
- `../../art-audio-todo/art-audio-todo.html`
- `../../gxe-animation-assets/README.md`
- `../../gxe-animation-assets/gxe-animation-assets.design`

建议把这些文件复制/整理进 GitHub 的 `docs/reference/`，或在 GitHub README 明确它们属于同级资料包。当前三个美术 TODO 页面之间存在状态口径不一致，交接时以实际文件、运行时引用和人工验收为准。

## 8. 旧美术 TODO 页面状态对照（仅供参考）

> 当前执行以第 5.2 节“美术”为准；本节只用于对照旧页面状态，不再单独派生任务。

### `art-resource-todo.html`

- P0：核心序列帧、BGM、SFX 标记为已完成。
- P1 未开始：正式场景背景、莞小鹅剧情动画、印记图标、烧鹅店老板动画。
- P2 未开始：玩法动画、场景物件、NPC 头像/立绘、主菜单 UI 素材、对话框、虚拟摇杆、进球光效。
- P3 未开始：点缀动画、章节地图节点、设置面板、转场遮罩。

### `art-visual-todo.html`

- P0 只有核心序列帧标记为已完成。
- P1/P2/P3 视觉资源均标记为未开始。
- 页面本身定义了 S1 场景样板生成规则和以下提示词，已复制到本交接文档第 9 节。

### `art-audio-todo.html`

- 序章、篮球馆、荔枝园、烧鹅店、工业园区、DGUT BGM 标记为完成。
- 主菜单 BGM 和松山湖 BGM 标记为未开始，但页面又记录了已生成 v3/v2、待试听确认；因此这两首应标为“文件存在，最终试听未确认”。
- 11 类 SFX 均标记为未开始，但当前工作区已有 12 个 WAV 文件；应先做试听、版权/来源确认和生产构建接入，再更新 TODO 页面。

## 9. 可直接交给美术/生成工具的提示词

### 9.1 S1 场景样板执行提示词

```text
请执行《鹅厂出逃记》场景样板 S1。
使用下面的通用基准提示词和 8 个场景提示词，各生成若干候选；每个场景最终只保留 1 张候选。
要求统一镜头、画幅、角色站位空间、光照逻辑和卡通手绘风格。
输出：8 个场景各 1 张入选样板，并逐张说明可行走区域、主要地标、交互点预留和需要修改的问题。
停止条件：只完成样板生成与筛选，不进入正式背景、物件、NPC、序列帧或 CG 制作。
```

### 9.2 通用基准提示词

```text
《鹅厂出逃记》2D 横版叙事冒险游戏场景样板，目标画布 1280×720，16:9，横向可游玩空间，轻微俯视的三分之四视角，前景、中景、远景层次清楚；画面下方约 35% 保留连续、平整、可行走的地面，中央或一侧留出角色与互动点空间。卡通手绘风，简洁清晰的轮廓，温暖配色，轻微纸张与笔刷质感，与莞小鹅的棕黄、米白、红色角色配色协调。单张完整游戏背景图，不是分镜，不是拼贴，不是概念图集；缩小到游戏窗口后仍能辨认主要地标。不要绘制人物、动物、角色剪影、可读文字、品牌标志、水印、UI、对白框。
```

### 9.3 统一负面提示词

```text
写实照片，3D 渲染，像素画，纯正面平面插画，等距视角，过度倾斜的地平线，拥挤的前景，不可行走的障碍铺满道路，人物，动物，文字，乱码，品牌标志，校徽，水印，UI，分屏，边框，恐怖血腥，过度暗黑，过曝，漂浮物体，重复物件，透视错误
```

使用方式：通用基准提示词 + 一个场景提示词 + 统一负面提示词。生成结果出现人物、文字、Logo、水印或主通道被堵时直接淘汰，不进入正式制作。

### 9.4 八个场景提示词

**01 · 序章 · 玩具工厂车间**

```text
灰蓝色玩具工厂车间，长条传送带从前景横向穿过，左侧堆放彩色玩具零件、木箱和可辨认但无文字的包装盒，中景有安全护栏、机械臂和工具台，远景是高挑厂房窗户、管线与层层钢结构；整体以灰蓝、深灰为主，少量橙色警示灯和暖色机械细节作为视觉焦点。画面下方形成一条连续的逃生动线，留出一个明显的出口方向；压抑但不恐怖，带有“想逃出去”的叙事感。
```

验收：传送带与机械臂不能堵住主通道；灰蓝底色下，莞小鹅的棕黄身体要能清楚识别。

**02 · 第一章 · 街头篮球馆**

```text
改造仓库式街头篮球馆，橙木色球场地板从前景延伸到中景，右侧或中右位置设置一个清晰的篮球架与篮筐，背景有围网、简洁看台、顶灯、墙面色块和少量无文字涂鸦；空间要开阔，球场中央保留投篮与移动区域，边缘放置篮球、长椅和可读的结构线。整体橙木色、深灰和少量活力蓝，阳光从高窗或顶灯落下，充满青春、运动和热血感，不出现任何队名、品牌和可读文字。
```

验收：篮筐要成为唯一主地标；球场中心必须足够空，方便后续放入投篮玩法。

**03 · 第二章 · 岭南荔枝园**

```text
东莞岭南荔枝园，成片荔枝树形成有节奏的中景层次，枝头挂着饱满的荔枝红果，前景是一条有苔痕的石板小路，旁边有木栅栏、竹筐和低矮果树；远景是柔和的岭南丘陵与明亮天空。画面靠近栅栏的位置预留一个小型解谜区域，放置四个形状不同、没有数字和文字的石块或木牌作为点触目标。荔枝绿、荔枝红与温暖阳光为主色，清新、田园、悠闲。
```

验收：四个解谜目标要彼此分开、容易点选；树冠不能压满整个画面。

**04 · 第三章 · 老字号烧鹅店**

```text
岭南老字号烧鹅店内部，暖黄色灯光照亮深褐色木质柜台和玻璃展示柜，后方可见挂炉、厨房帘子与传统餐馆结构；前景和中景安排几张桌子、木桶、门帘和矮柜，形成明确的躲藏点与狭窄但连续的潜行动线；右侧或中景设置醒目的烧鹅台和出餐区域。暖黄、深褐、暗红为主色，空气中有诱人的食物香气感，但不出现血腥，不出现人物、店名、招牌文字或真实品牌。
```

验收：桌底、木桶、门帘至少保留 3 个可视化掩体；烧鹅台要成为远端目标。

**05 · 第四章 · 高新工业园区**

```text
东莞高新工业园区的现代园区空间，蓝灰色玻璃研发楼、简洁的连廊、整齐的绿化、路灯和安检入口形成纵深；中景可有无人机停靠台、科技装置和发光的无文字指示面板，但不要出现任何可读文字。前景是一条宽阔的铺装步道，中央保留三个分散的观赏互动位置；科技蓝、银灰、少量青绿色为主色，氛围神秘、先进、带探索感。
```

验收：现代建筑不能变成抽象科幻城市；步道和 3 个互动点需要清楚分层。

**06 · 第四章 · 制造工厂**

```text
钢灰色制造工厂内部，粗大的生产设备、装配线、机械管道和高处检修平台构成空间层次，地面有清晰的暖橙色安全线和分区标记；画面一侧设置大型滑门或出口，另一侧有可观察的机械控制台。前景保留宽阔、连续、没有杂物的移动通道，背景用钢梁和局部暖橙灯光形成工业节奏。钢灰、炭黑、暖橙为主色，写实结构但保持卡通手绘和清晰轮廓。
```

验收：大型设备只做边界，不要把下方可走区域切碎；暖橙色用于引导，不要满屏橙色。

**07 · 第五章 · DGUT 风格校园**

```text
东莞理工学院风格的温暖校园空间，米白色教学楼或图书馆、木色廊架、成排树木、长椅、公告栏和开阔的校园步道形成清晰的前中后景；画面预留 3 个可观赏互动点，例如书架窗口、树下长椅、校园雕塑，但不出现任何真实校徽、品牌标志、可读文字或校名。米白、木色、浅绿和柔和蓝天为主色，安静、青春、温暖，带有“短暂停留与回望”的情绪。
```

验收：校园氛围要真实亲切，不要生成欧式城堡或泛化大学；所有文字和校徽必须去掉。

**08 · 终章 · 松山湖黄昏**

```text
松山湖湖岸黄昏，前景是一条开阔的湖边步道与低矮草地，中景是平静的湖面、柔和的倒影、几棵被晚风吹动的树，远景有桥梁和低调的城市轮廓；天空从金橙过渡到橙紫，湖水保持清透的湖青色，夕阳位于偏右或偏中位置，画面中央留出可放置角色和结局文字的干净空间。整体治愈、自由、感动，不出现人物、文字、Logo 或过度戏剧化的光效。
```

验收：夕阳和湖面是情绪焦点，但不能让前景变黑；要保留角色落脚和结局 CG 合成空间。

### 9.5 俯视地图正式交付提示词

```text
基于《鹅厂出逃记》已选场景样板，制作可进入游戏的 2D 俯视/轻俯视地图资源，不改变原有色彩、地标和叙事氛围。输出同尺寸、同坐标系的 5 层文件：1）背景地面层；2）不可行走区域/碰撞遮罩；3）可独立定位的前景遮挡层；4）NPC、目标物、出口和互动点透明图层；5）坐标标注表。地图必须适配 1280×720、16:9 横屏，保留清晰的连续移动通道，顶部状态卡和底部触控提示不能挡住关键目标。不要把正面背景直接拉伸成俯视图；不要生成文字、Logo、校徽、水印、人物设定说明或 UI。
交付时同时说明：玩家出生点、出口、碰撞边界、每个互动点的 x/y/半径/名称/完成后状态、角色脚底线和建议缩放比例。
```

### 9.6 NPC 透明化与运行时动作提示词

```text
以当前《鹅厂出逃记》角色三视图/动作参考为唯一身份基准，保持脸型、发型、服装、围裙、配色、比例和轮廓一致。将角色从米白设定图背景中完整抠出，输出透明 PNG，不保留背景、文字、边框、阴影说明或其他视图。为游戏运行时制作统一脚底线、统一画布尺寸和朝向；每个动作帧保持角色在同一基准线上，避免漂浮、缩放跳变和脚底抖动。动作帧只保留一个角色，不添加多余道具；道具若是玩法必需，单独输出透明图层。
```

## 10. 参考：音频交接提示词/验收口径

> 音频任务已归入第 5.2 节“美术”；本节只保留生成方向和历史状态。

### BGM

| 文件 | 生成/验收方向 | 当前状态 |
| --- | --- | --- |
| `bgm_menu.mp3` | 轻快冒险感，大调上行，轻弹节奏，可有鹅叫/口哨趣味点缀；开场要体现莞小鹅活泼，不喧宾夺主 | v3 文件存在，页面记录待试听确认 |
| `bgm_factory.mp3` | 传送带/齿轮金属节奏，明亮大调，机械忙碌但有出逃期待 | 页面记录已验收 |
| `bgm_basketball.mp3` | 动感鼓点、篮球弹跳和球鞋摩擦的运动氛围 | 页面记录已验收 |
| `bgm_lychee.mp3` | 木吉他/尤克里里、鸟鸣和风吹树叶，清新田园 | 页面记录已验收 |
| `bgm_goose.mp3` | 紧张潜行与嘴馋诱惑并存，可有烤鹅滋滋声暗示 | 页面记录已验收，但仍应复听 |
| `bgm_industrial.mp3` | 科技电子、无人机嗡鸣、安检滴声，神秘探索感 | 页面记录已验收 |
| `bgm_campus.mp3` | 钢琴与弦乐，翻书声/课间铃声点缀，温暖青春 | 页面记录已验收 |
| `bgm_songshan.mp3` | 黄昏湖面、柔和毡音钢琴、空气感铺底，从舒缓渐强到自由感动 | v2 文件存在，页面记录待试听确认 |

### SFX

按钮点击要短促清晰；打字音要轻且不能每字过响；收集印记要有水晶上升音阶和获得感；转场要有空间感；投篮命中要有“唰”和轻微欢呼，投失是篮球砸框但不丧；被抓可加入“嘎”或老板怒吼；偷吃要有诱人的食物反馈；开门要有机械/木门反馈；错误要短促提醒；结局要温暖、有余韵。

当前运行时文件以 `assets/audio/*.wav` 为主，`art-audio-todo.html` 记录的目标扩展名多为 MP3；下一位需统一格式、命名、版权和构建复制规则。

## 11. 推荐实施顺序（带停止条件）

1. **先整理 Git 边界**：确认哪些未跟踪资源应提交，建立 GitHub remote，单独提交交接文档和当前可运行代码。停止条件：`git status` 中没有无法解释的资源。
2. **修生产音频与 portrait 路径**：补 SFX 复制、修/补 NPC portrait。停止条件：`npm run build` 后 `dist` 中资源完整，浏览器 Network 无对应 404。
3. **做共享俯视地图能力**：地图背景、碰撞遮罩、前景遮挡、互动对象、靠近提示、目标/进度卡。停止条件：荔枝园完成“对话—移动—摘取—交付—出口”闭环。
4. **逐章接入背景与 NPC**：顺序建议荔枝园 → 烧鹅店 → 篮球馆 → 工业园区 → 校园 → 松山湖；工厂序章可暂时保留侧视。停止条件：每章有真实背景、可辨认地标、真实角色/物件和可复现的核心玩法。
5. **接入动作和 UI 美术**：动作图集、透明处理、脚底线、头像、徽章、摇杆、转场、Ending CG。停止条件：关键动作不再使用色块/文字占位。
6. **移动端验收与包体优化**：真实手机/平板横屏、safe-area、触控、离线、低帧率、包体。停止条件：`docs/checklist.md` 不再有关键 P0/P1 未勾选，且发布构建小于目标或已获得明确豁免。

## 12. 复现命令

```powershell
cd D:\CodeWorkspace\DGGoose\goose-escape-game
npm install
npm test
npm run build
npm run dev
```

- 开发端口固定为 `5173`。
- 接收者接手后的首轮验证建议执行：`npm test`、`npm run build`、`npm run preview`。
- 仍需人工验证：手机/平板真机、断网全流程、完整 7 章人工通关。

## 13. 参考文档

- [项目规则](../PROJECT_RULES.md)
- [验收清单](./checklist.md)
- [M0-M5 实施计划](./plans/2026-08-07-goose-escape-mvp.md)
- [剧情分支设计](./plans/2026-08-07-story-branching-design.md)
- [俯视场景改造说明](./plans/2026-08-08-topdown-scene-revision.md)
- [PRD（同级资料包）](../../goose-escape-prd/GOOSE-ESCAPE-PRD.md)
- [美术资源 TODO（同级资料包）](../../art-resource-todo/art-resource-todo.html)
- [视觉 TODO 与提示词（同级资料包）](../../art-visual-todo/art-visual-todo.html)
- [音频 TODO（同级资料包）](../../art-audio-todo/art-audio-todo.html)
- [核心动画说明（同级资料包）](../../gxe-animation-assets/README.md)
