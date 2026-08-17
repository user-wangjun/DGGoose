# 鹅厂出逃记 GOOSE ESCAPE PROJECT 编码实施计划

> **For Claude:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 按任务逐项实施本计划。

**Goal:** 按 PRD（`goose-escape-prd/GOOSE-ESCAPE-PRD.md`）实现《鹅厂出逃记》可玩 MVP：面向手机/平板横屏的 2D 横版剧情 + 轻解谜 HTML5 游戏，包含 7 章节主线、12 个功能模块、双结局与 7 枚东莞印记收集。桌面浏览器仅保留开发回退，不纳入产品验收。

**Architecture:** 原生 Canvas 2D + ES Modules，零游戏框架、零运行时 CDN。分层：`core`（引擎：主循环/场景管理/输入抽象/序列帧动画/资源/存储）→ `scenes`（场景状态机，每章一个场景对象）→ `ui`（DOM 组件）→ `data`（对话/章节 JSON 驱动）。输入统一抽象为"方向向量 + 动作事件"，触控行为一致。

**Tech Stack:** JavaScript (ES Modules)、Canvas 2D、Vite（dev 固定端口 5173）、Vitest（TDD）。

**文档来源:** PRD v0.1（功能需求 §5、技术方案 §6、资源清单 §7）。技术选型建议以原生 Canvas 为准，如确认改用 TS/框架需同步更新本计划与 PROJECT_RULES。

---

## 里程碑总览

| 里程碑 | 内容 | 对应 PRD | 产出验证 |
| --- | --- | --- | --- |
| M0 脚手架 | 项目结构、引擎骨架、存储、配置 | §6 | 空场景跑通主循环，`vitest run` 通过 |
| M1 核心系统 | 输入/摇杆/序列帧/角色控制/横屏/音频 | §6.2 | 摇杆可移动角色，帧动画播放 |
| M2 UI 系统 | 主菜单/对话/章节图/存档/设置/印记 | §5 F1/F3/F4/F10/F11/F12 | 全 UI 流程可交互 |
| M3 章节玩法 | 序章 + 5 正章 + 终章全部玩法 | §5 F5-F9 + §4 | ✅ 已完成：全流程 7 章节可玩，双结局可达，312 测试通过 |
| M4 打磨验收 | 音效/特效/性能/移动端横屏验收/打包 | §6.3 | ✅ 已完成：音效/特效全接入，335 测试通过，包体 144.86 kB，离线可玩 |
| M5 剧情分支改造 | 伞形多结局：场景抉择/结局 CG/印记扩展 | 剧情分支设计 v4 | ✅ 已完成：6 个结局可达，388 测试通过，抉择唯一性正确 |

> 每个 Task 遵循 TDD：**先写失败测试 → 运行确认失败（RED）→ 最小实现 → 运行确认通过（GREEN）→ 提交**。测试命令统一为 `npx vitest run`。

---

## M0 脚手架与基础架构

### Task 0.1 初始化项目
- **文件**: `goose-escape-game/package.json`、`vite.config.js`、`.gitignore`、`index.html`
- **操作**: 创建
- **要点**:
  ```json
  {
    "name": "goose-escape-game",
    "type": "module",
    "scripts": {
      "dev": "vite --port 5173 --strictPort",
      "build": "vite build",
      "preview": "vite preview",
      "test": "vitest run"
    }
  }
  ```
  `index.html` 挂载 `<canvas id="game">` 与 `<div id="ui-root">`（UI 层）；`vite.config.js` 配置 base 相对路径、端口 5173。
- **验证**: `npm install && npm run dev` 打开 http://localhost:5173 显示空白画布；`npm test` 报 "no test files" 即正常。

### Task 0.2 建立目录骨架与占位
- **文件**: `src/main.js`、`src/config.js`、`src/core/`、`src/scenes/`、`src/ui/`、`src/data/`、`tests/`、`assets/`（含 `sprites/bg/ui/audio` 占位与 `.gitkeep`）
- **操作**: 创建
- **要点**: 目录结构与 `PROJECT_RULES.md` §2 一致；`config.js` 导出 `GAME`（宽高/帧率目标）、`CHAPTERS`（7 章元数据）、`BADGES`（7 印记）、`SETTINGS_DEFAULTS`。
- **验证**: `npx vitest run` 通过（0 测试）；`npm run build` 产出 `dist/`。

### Task 0.3 Game 主类（主循环）
- **文件**: `src/core/Game.js`；测试 `tests/core/Game.test.js`
- **操作**: 创建 + TDD
- **要点**: `start()/stop()`；rAF 主循环 `update(deltaTime)` + `render(ctx)`；`deltaTime` 钳制 ≤0.05s；暴露 `setScene(scene)` 转交 SceneManager。
- **验证**: 测试断言 `start()` 后 `update` 被调用（用 stub 场景），`stop()` 后停止。

### Task 0.4 SceneManager（场景状态机）
- **文件**: `src/core/SceneManager.js`；测试 `tests/core/SceneManager.test.js`
- **操作**: 创建 + TDD
- **要点**: 场景注册 `register(name, scene)`；切换 `change(name, params)` 执行 退出→进入 生命周期（`onEnter/update/draw/onExit`）；保存历史栈支持返回。
- **验证**: 测试：切换场景后旧场景 `onExit` 与新场景 `onEnter` 被调用且顺序正确。

### Task 0.5 EventBus（事件总线）
- **文件**: `src/core/EventBus.js`；测试 `tests/core/EventBus.test.js`
- **操作**: 创建 + TDD
- **要点**: `on/off/emit/once`；解绑不泄漏；事件名常量统一放 `config.js`（如 `EVENT.SCORE`、`EVENT.BADGE_GET`）。
- **验证**: 测试：emit 触发订阅、off 后不再触发、once 只触发一次。

### Task 0.6 StorageService（本地存储）
- **文件**: `src/core/StorageService.js`；测试 `tests/core/StorageService.test.js`
- **操作**: 创建 + TDD
- **要点**: `get(key)/set(key,val)/remove(key)`（JSON 序列化）；写入失败（超限）回滚并抛错；key 统一前缀 `gxe:`；单槽容量 ≤8KB 校验。
- **验证**: 测试（jsdom 环境）：写入读取一致、损坏 JSON 返回默认值、超限抛错。

### Task 0.7 配置与常量
- **文件**: `src/data/chapters.js`、`src/data/badges.js`、`src/data/dialogues.js`（首章占位）
- **操作**: 创建
- **要点**: 章节数据含 `id/name/tag/badge/time`（对应 PRD §4.2 总表）；印记含 `id/name/desc/chapter/how`（对应 §5 F10 表）；对话 JSON 结构 `{ who, txt, tags[] }`。
- **验证**: 新增测试断言章节数 =7、印记数 =7，字段齐全。

---

## M1 核心系统

### Task 1.1 InputManager（输入抽象层）
- **文件**: `src/core/InputManager.js`；测试 `tests/core/InputManager.test.js`
- **操作**: 创建 + TDD
- **要点**: 虚拟摇杆注入统一 `getVector() -> {x,y,run}` 通道；保留键盘映射（WSAD/方向键、Shift、空格、Esc）作为开发回退；支持挂载/卸载（避免 demo 冲突）。
- **验证**: 测试：按键组合→方向向量断言（含 8 方向归一化、Shift 置 run、松开归零）。

### Task 1.2 VirtualJoystick（虚拟摇杆）
- **文件**: `src/ui/VirtualJoystick.js`；测试 `tests/ui/VirtualJoystick.test.js`
- **操作**: 创建 + TDD
- **要点**: Pointer Events（down/move/up + capture）；偏移量→向量（半径截断 R=34px）；输出 `{x,y}` 归一化；拉满判定 run（>0.92R）；触屏才显示。
- **验证**: 测试：逻辑函数（偏移→向量→截断→归一化）纯函数断言；DOM 挂载冒烟测试。

### Task 1.3 SpriteAnimation（序列帧动画系统）
- **文件**: `src/core/SpriteAnimation.js`、`src/core/SpriteSheet.js`；测试 `tests/core/SpriteAnimation.test.js`
- **操作**: 创建 + TDD
- **要点**: 读 JSON 动画配置（帧坐标/帧数/FPS/循环/锚点）；`play(name)/pause/resume/stop`；帧索引按动画 FPS 推进（与渲染帧率解耦）；水平翻转（scaleX）；状态机辅助 `switchAnim(current,next)`。
- **验证**: 测试：帧推进速率正确、循环取模、翻转到下一动画重置帧号、锚点计算正确。

### Task 1.4 AssetLoader（资源加载）
- **文件**: `src/core/AssetLoader.js`；测试 `tests/core/AssetLoader.test.js`
- **操作**: 创建 + TDD
- **要点**: 预加载图集/JSON/音频；`loadManifest(list, onProgress)` 返回 Promise；缓存（同一资源只加载一次）；失败容错（跳过后告警）。
- **验证**: 测试：mock 加载器回调顺序、进度累计、重复请求命中缓存。

### Task 1.5 PlayerController（角色控制）
- **文件**: `src/core/PlayerController.js`；测试 `tests/core/PlayerController.test.js`
- **操作**: 创建 + TDD
- **要点**: 输入向量→位移（速度 walk=150 / run=260 px/s）；边界钳制；朝向（vx 符号）；动画状态联动（待机/行走/奔跑）；位置与速度只读暴露。
- **验证**: 测试：匀速位移、边界钳制、朝向翻转、速度档切换正确。

### Task 1.6 ViewportAdapter（移动端横屏适配）
- **文件**: `src/core/ViewportAdapter.js`；测试 `tests/core/ViewportAdapter.test.js`
- **操作**: 创建 + TDD
- **要点**: 横屏检测（`screen.orientation` + `window.orientation` 兜底）；竖屏时显示"请横屏游玩"遮罩（DOM）；画布按视口等比缩放（DPI 适配）；安全区 `env(safe-area-inset-*)` 应用于 UI 层。
- **验证**: 测试：orientation 值→横竖屏判定函数断言；DOM 遮罩切换冒烟。

### Task 1.7 AudioManager（音频）
- **文件**: `src/core/AudioManager.js`
- **操作**: 创建（音源资源后置，先接骨架）
- **要点**: BGM/SFX 播放、暂停、音量（联动设置 bgm/sfx）；预加载列表来自资源清单 §7.8；资源缺失时静默降级。
- **验证**: 手动：设置滑杆实时改音量；无音频文件时不报错。

---

## M2 UI 系统

### Task 2.1 主菜单场景（F1）
- **文件**: `src/scenes/MainMenuScene.js`、`src/ui/MenuOverlay.js`
- **操作**: 创建
- **要点**: 标题 + 4 按钮（开始/继续/说明/设置）；"继续游戏"显示 `第X章·章节名 进度%`（无存档置灰）；开始游戏 1.2s 加载条→进序章；有存档时开始前确认覆盖；说明/设置以覆盖层展开。
- **验证**: 手动冒烟：三种按钮状态、加载条、存档联动（配 F11 后）。

### Task 2.2 对话系统（F3）
- **文件**: `src/ui/DialogueBox.js`、`src/core/DialogueRunner.js`；测试 `tests/core/DialogueRunner.test.js`
- **操作**: 创建 + TDD
- **要点**: typewriter 逐字（默认 30 字/秒，设置可调）；点击：补全→下一行（120ms 防连点）；说话人/头像切换；表情标签 `[惊讶]` 解析→发事件切角色帧；长按跳过整段（首次确认）；对话期间锁移动输入。
- **验证**: 测试：逐字推进、补全逻辑、标签解析、跳段；DOM 冒烟打字效果。

### Task 2.3 章节地图（F4）
- **文件**: `src/ui/ChapterMap.js`、`src/scenes/ChapterSelectScene.js`
- **操作**: 创建
- **要点**: 横向时间轴 7 节点；解锁规则（完成上一章→解锁下一章）；未解锁点击仅提示不剧透；信息卡（玩法/印记/状态）；通关后全解锁（重新出发）。
- **验证**: 手动冒烟：锁定/当前/完成三态；点击各状态节点行为。

### Task 2.4 存档系统（F11）
- **文件**: `src/core/SaveSystem.js`、`src/ui/SavePanel.js`；测试 `tests/core/SaveSystem.test.js`
- **操作**: 创建 + TDD
- **要点**: 3 槽位；自动存档（章完成/小游戏过关→槽1）+ 手动存档；字段 `version/chapter/checkpoint/badges/settings/timestamp`；载入恢复进度；删除二次确认；版本不兼容拒绝载入。
- **验证**: 测试：自动/手动写入、载入恢复、损坏存档拒绝、version 校验。

### Task 2.5 设置系统（F12）
- **文件**: `src/ui/SettingsPanel.js`、`src/core/SettingsService.js`；测试 `tests/core/SettingsService.test.js`
- **操作**: 创建 + TDD
- **要点**: 字段 bgm/sfx/textSpeed/lang/shake；滑杆节流 150ms 写入；语言切换（首版简中，其余占位）；震动开关（支持 Vibration API 的手机/平板生效）；重置二次确认。
- **验证**: 测试：默认值、节流写入、持久化读取。

### Task 2.6 印记收集（F10）
- **文件**: `src/core/BadgeSystem.js`、`src/ui/BadgePanel.js`；测试 `tests/core/BadgeSystem.test.js`
- **操作**: 创建 + TDD
- **要点**: 7 印记定义（data/badges.js）；`unlock(id)` 校验、持久化、0.8s 收集动效事件；进度展示；全收集点亮成就"莞城通"。
- **验证**: 测试：解锁去重、进度计算、全收集成就事件。

### Task 2.7 通用 UI 组件
- **文件**: `src/ui/Toast.js`、`src/ui/Overlay.js`、`src/ui/Button.js`
- **操作**: 创建
- **要点**: Toast 提示（2s 自动消失）；覆盖层（半透明 + 关闭回调）；按钮三态（可用/置灰/按下）。
- **验证**: 手动冒烟：各组件在菜单/设置中正常渲染与交互。

---

## M3 章节玩法

### Task 3.1 剧情数据全量
- **文件**: `src/data/dialogues.js`（全 7 章对话）、`src/data/hotspots.js`（F8 互动点台词，见 PRD §5 F8 表）
- **操作**: 创建
- **要点**: 按 PRD §4.2/§5 F8 录入全部台词初稿；结构含说话人/文本/表情标签；章节与玩法触发点（如小游戏开始/印记发放）以事件名标注。
- **验证**: 测试：每章对话非空、事件标记引用合法。

### Task 3.2 序章·生产线觉醒
- **文件**: `src/scenes/FactoryScene.js`
- **操作**: 创建
- **要点**: 教学引导（移动→互动→跳→翻墙）；对话序列（觉醒 4 行）；机械臂/传送带装饰动画（占位）；翻墙事件→发放印记"出厂合格证"→进第一章。
- **验证**: 手动：教学步骤按序触发、印记发放、章节推进。

### Task 3.3 投篮小游戏（F5）
- **文件**: `src/scenes/BasketballScene.js`、`src/core/BallPhysics.js`、`src/ui/ChargeMeter.js`；测试 `tests/core/BallPhysics.test.js`
- **操作**: 创建 + TDD
- **要点**: 正式篮球馆使用拖拽瞄准、松手发射；传统蓄力接口仍保留（65 点/秒）作兼容路径。球按 `vy += 430*dt` 做抛物线运动；正式 Blumgi 关卡使用固定篮筐和平台布局；进球按扣除篮圈边缘与球半径后的约 `±17px` 有效开口判定，侧视横穿篮圈时下方最多容许 `16px`、上方仅保留 `2px` 离散误差；60s 倒计时、目标 5 球；失败/过关结算；过关发放印记"篮球徽章"+ 教练台词。
- **验证**: 测试：物理位移、边界、平台/篮板碰撞、有效开口边缘、侧视下缘容差、篮板回弹进球和计时归零；手动：从俯视篮球馆入口进入，拖拽出手，确认进球/投失反馈、Level 切换和投失自动复位。完整五球浏览器通关仍需单独留证。

### Task 3.4 荔枝园序列解谜（F7）
- **文件**: `src/scenes/LycheeScene.js`
- **操作**: 创建
- **要点**: 序列 `[3,1,4,2]`（0 基 [2,0,3,1]）；正确→锁定高亮；错误→重置+晃动+提示；全对→栅栏门动画+印记"妃子笑"+阿婆台词。
- **验证**: 手动：顺序正确/错误两路径；重复游玩重置正常。

### Task 3.5 烧鹅店潜行（F6）
- **文件**: `src/scenes/StealthScene.js`；测试（警觉度/判定逻辑抽纯函数）
- **操作**: 创建 + TDD
- **要点**: 老板匀速往返巡逻（92px/s，边界 40~W-40）；警戒区在面朝方向；警觉度（进入+45/s，离开/藏好-20/s，满值被抓）；掩体 3 个（桌底/木桶/门帘，近掩体<26px 算藏好）；烧鹅台→偷尝→冲出→印记"莞香烧鹅"；被抓 1.6s 复位。
- **验证**: 测试：警觉度增减、被抓触发、藏好判定；手动：完整通关路径。

### Task 3.6 工业园区收集解谜 + 观赏互动（F8）
- **文件**: `src/scenes/IndustrialScene.js`
- **操作**: 创建
- **要点**: 高新园区/制造工厂双区域；互动点 3 个触发台词（科技兴国/工人阶级）；收集齿轮零件 ×3 组装访客徽章→过安检→印记"工业齿轮"。
- **验证**: 手动：互动点查看计数、收集组装流程。

### Task 3.7 DGUT 校园（F8）
- **文件**: `src/scenes/CampusScene.js`
- **操作**: 创建
- **要点**: 互动点 3 个（图书馆/自习室/校道台词）；全查看→"继续前行"；对话学长学姐→印记"校园书签"。
- **验证**: 手动：进度计数、印记发放。

### Task 3.8 松山湖终章（F9）
- **文件**: `src/scenes/SongshanScene.js`
- **操作**: 创建
- **要点**: 黄昏场景（落日/湖面/余烬粒子）；叙述→抉择按钮"留下/离开"；真结局（解锁印记"松山湖光"+成就"莞城居民"）与开放结局两套收尾文案；结局写入存档；"再选一次"回看；通关后主菜单出现"重新出发"。
- **验证**: 手动：双结局各走一遍，存档记录结局状态，印记/成就联动。

---

## M4 打磨与验收

### Task 4.1 音效接入
- **文件**: 各场景/UI 触发点 + `src/core/AudioManager.js`
- **操作**: 修改
- **要点**: 点击/打字/命中/投失/被抓/偷吃/收集/开门/过场/结局音效挂接；音量跟随设置。
- **验证**: 手动：全流程音效触发正确，设置静音生效。

### Task 4.2 特效补充
- **文件**: `src/core/ParticleSystem.js` + 场景接入
- **操作**: 创建 + 接入
- **要点**: 奔跑尘土、进球光效、印记收集闪光、黄昏余烬；帧率不足时降级（跳过粒子）。
- **验证**: 手动：各特效触发；低帧率下无卡顿。

### Task 4.3 性能与加载优化
- **文件**: `src/core/AssetLoader.js`、`src/config.js`
- **操作**: 修改
- **要点**: 按章节预加载清单（首屏仅主菜单资源）；图集合并 ≤1024px；总包体 <5MB 校验；首屏 <3s。
- **验证**: `npm run build` 后检查 dist 体积；DevTools 记录首屏时间。

### Task 4.4 移动端横屏全流程验收
- **文件**: `docs/checklist.md`（验收清单）
- **操作**: 创建
- **要点**: 手机/平板横屏（摇杆/点击、安全区、全屏、旋转提示）逐项过 PRD §5 十二模块与 §6 移动端横屏适配表；桌面浏览器仅用于开发回退检查。
- **验证**: 清单全部勾选；`npx vitest run` 全绿。

### Task 4.5 打包部署
- **文件**: `package.json`（build 脚本）、`vite.config.js`
- **操作**: 修改
- **要点**: `vite build` 产出相对路径资源（可放任意子目录/离线打开）；`vite preview` 验证产物；确认零外部请求。
- **验证**: `npm run build && npm run preview` 全流程可玩；断网可玩。

### Task 4.6 代码审查与收尾
- **操作**: superpowers 阶段 6/7
- **要点**: 规格合规审查（对照 PRD §5 十二模块）+ 质量审查（命名/注释/DRY/测试覆盖）；通过后合并分支、清理工作树。
- **验证**: 审查报告无 🔴 关键问题；测试全绿；PRD 功能点全实现。

---

## M5 剧情分支改造（伞形多结局 v4）

> 依据：`docs/plans/2026-08-07-story-branching-design.md`。将现有"单线 + 松山湖双结局"重构为"5 场景抉择 + 6 结局 CG"。设计要点：所有场景强制进入、全旅程只能留一个（留过后其余"留下"置灰）、松山湖走马灯后按选择结算。

### Task 5.1 数据层：抉择点与结局数据
- **文件**: `src/data/chapters.js`、`src/data/badges.js`、`src/data/dialogues.js`、`src/data/endings.js`（新增）
- **操作**: 修改 + 新增 + TDD
- **要点**: chapters.js 各章增加 `choice: { label, ending, badge }`；badges.js 新增 6 枚结局印记（训练营/荔枝园丁/烧鹅师傅/研发者/大学生/湖光）；dialogues.js 补各章抉择前后对话与 6 个结局 CG 文案；新增 endings.js 定义 6 结局元数据（标题/文案/印记/所属场景）。
- **验证**: 测试：每章有抉择点、结局印记唯一、CG 文案非空。

### Task 5.2 存档与选择状态
- **文件**: `src/core/SaveSystem.js`、`tests/core/SaveSystem.test.js`
- **操作**: 修改 + TDD
- **要点**: 存档增加 `choice` 字段（留下场景 id 或 null）；升级 version 并兼容旧存档（无 choice → 默认 null）；唯一留下校验（已选后不可再选）。
- **验证**: 测试：choice 写入/读取、旧存档兼容、唯一性约束。

### Task 5.3 通用抉择 UI 组件
- **文件**: `src/ui/ChoiceOverlay.js`、`tests/ui/ChoiceOverlay.test.js`
- **操作**: 新增 + TDD
- **要点**: 从松山湖现有抉择覆盖层抽取为通用组件：标题 + 两按钮（留下 / 继续探寻）；支持按钮置灰态（disabled）；emit 选择事件。
- **验证**: 测试：渲染两按钮、置灰不可点、点击回传选择；手动冒烟。

### Task 5.4 五个场景接入抉择点
- **文件**: `src/scenes/BasketballScene.js`、`LycheeScene.js`、`StealthScene.js`、`IndustrialScene.js`、`CampusScene.js`
- **操作**: 修改
- **要点**: 各场景玩法结算后弹出抉择：留下 → 记录 choice + 广播事件（后续场景"留下"置灰）；继续 → 推进下一场景。荔枝园剧情补"农民真伟大"台词。
- **验证**: 手动：五场景抉择均生效，置灰联动正确。

### Task 5.5 松山湖改造：走马灯 + 结算分支
- **文件**: `src/scenes/SongshanScene.js`、`tests/core/SongshanLogic.test.js`（新增）
- **操作**: 修改 + TDD
- **要点**: 移除原"留下/离开"选择；新增走马灯（回放各场景高光帧）；结算分支：有 choice → "决定去对应场景"触发结局 CG；无 choice → 介绍东莞 CG。结算判定抽为纯函数便于测试。
- **验证**: 测试：有/无 choice 两分支结算正确；手动：走马灯播放、两分支可达。

### Task 5.6 结局 CG 系统
- **文件**: `src/ui/EndingCG.js`、`src/data/endings.js`
- **操作**: 新增
- **要点**: 6 个结局 CG 首版以"场景定格 + 标题 + 文案 + 印记发放"实现，插画美术后置 `[待确认]`；显示对应结局印记与成就；保留"再选一次"。
- **验证**: 手动：6 结局各触发一次，印记/成就正确。

### Task 5.7 章节地图与收集联动
- **文件**: `src/ui/ChapterMap.js`、`src/scenes/ChapterSelectScene.js`
- **操作**: 修改
- **要点**: 显示已选"留下"的场景状态（高亮/灰）；结局印记纳入收集进度（收集口径更新）；展示各结局解锁状态。
- **验证**: 手动：地图状态正确；收集页显示结局印记。

### Task 5.8 测试与回归
- **文件**: 各测试文件
- **操作**: 修改 + 运行
- **要点**: 抉择唯一性、置灰、结算分支、结局印记发放的单元测试；全量回归。
- **验证**: `npx vitest run` 全绿（预计 380+）。

### Task 5.9 审查与验收
- **操作**: superpowers 阶段 6
- **要点**: 规格合规审查（对照剧情分支设计文档 v4）+ 质量审查；更新 `docs/checklist.md` 结局相关验收项；同步 PRD 与计划文档差异。
- **验证**: 审查无 🔴 关键问题；测试全绿；checklist 结局项更新。

---

## 技术选型待确认（阻塞项）

| 项 | 计划默认 | 说明 |
| --- | --- | --- |
| 语言 | JS (ES Modules) | 如需 TS 需确认，影响 M0 脚手架 |
| 渲染 | 原生 Canvas 2D | 符合 PRD "无外部 CDN" 约束 |
| dev 端口 | 5173（固定） | 绑定后不变 |
| 测试环境 | Vitest + jsdom | 纯逻辑单测为主，DOM 组件冒烟 |

## 里程碑完成占比预估（供进度汇报）

M0 脚手架 1/6 → M1 核心系统 2/6 → M2 UI 系统 3/6 → M3 章节玩法 4/6 → M4 打磨验收 5/6 → M5 剧情分支改造 6/6 ✅ 已完成

---

*计划文档 · GOOSE ESCAPE PROJECT · 对应 PRD v0.1 · 随实施更新*
