# 鹅厂出逃记 · 项目开发规则（PROJECT RULES）

> 本文件为 `goose-escape-game` 游戏项目的开发规则，所有开发成员（含 AI 代理）必须遵守。随项目演进逐步完善。

## 1. 技术栈与约束

| 项 | 约定 |
| --- | --- |
| 语言 | JavaScript（ES Modules），可选 TypeScript（需团队确认） |
| 渲染 | 原生 Canvas 2D，不引入游戏框架（Phaser 等） |
| 目标平台 | 手机 / 平板横屏 Web；桌面浏览器仅保留开发回退，不作为产品验收目标 |
| 运行时依赖 | 零外部 CDN（所有资源本地化，离线可玩） |
| 构建/开发 | Vite；dev server 固定端口 **5173**，绑定后不变 |
| 测试 | Vitest（TDD：先写测试，RED-GREEN-REFACTOR） |
| 存储 | localStorage（存档 ≤8KB/槽、设置项） |
| 包体 | 总资源 <5MB，图集单张 ≤1024px |

## 2. 目录结构

```
goose-escape-game/
├── index.html
├── package.json
├── vite.config.js
├── PROJECT_RULES.md
├── docs/
│   └── plans/                # 实施计划
├── assets/                   # 美术/音频资源（命名见 PRD §7.9）
│   ├── sprites/              # 莞小鹅图集
│   ├── bg/                   # 场景背景
│   ├── ui/                   # UI 素材
│   └── audio/                # BGM/SFX
├── src/
│   ├── main.js               # 入口
│   ├── config.js             # 全局常量
│   ├── core/                 # 引擎层（Game/SceneManager/Input/动画/资源/存储）
│   ├── scenes/               # 场景层（主菜单/各章节/结算）
│   ├── ui/                   # UI 组件（对话/菜单/摇杆/面板）
│   └── data/                 # 数据层（对话/章节/印记 JSON）
└── tests/                    # 单元测试（与 src 镜像结构）
```

## 3. 编码规范

- 函数、变量采用**驼峰命名**，命名有意义、避免缩写（约定俗成除外，如 `i`）。
- **函数级中文注释**：注释解释"为什么"而非"做什么"。
- 保持函数创建与调用一致性：创建时指定全部参数，调用时传递全部参数，函数名一致。
- 避免多层嵌套，提前返回；避免不必要的对象复制；对可并行任务做并发处理（多阶段时给出完成占比）。
- 所有界面与注释使用中文。

## 4. 开发流程（强制）

1. **superpowers 七阶段工作流**：头脑风暴 → Git 工作树 → 编写计划 → 子代理开发 → TDD → 代码审查 → 分支收尾。
2. **TDD 强制**：任何生产代码前先写失败测试；每个功能提交前测试必须通过。
3. **分支规范**：不在主分支直接开发，功能分支命名 `feat/<功能名>`。
4. **提交规范**：`feat|fix|refactor|docs: 中文说明`。
5. **完成标准**：测试通过 + 代码审查无关键问题 + 符合 PRD。

## 5. 资源命名（对齐 PRD §7.9）

```
角色_动作_序号   →  gxe_walk_01.png   （gxe = 莞小鹅）
场景_名称        →  bg_factory_cn.png
物件_名称_章节   →  obj_hoop_ch1.png
印记_名称        →  badge_lychee.png
UI_组件_状态     →  ui_btn_start_normal.png
音频_类型_名称   →  bgm_menu.mp3 / sfx_goal.mp3
```

## 6. 端口约定

- 网页端 dev server 固定端口 **5173**；绑定后除用户主动要求外不得更改。

## 7. 待确认事项（影响开发）

- 渲染技术选型：确认按本规则（原生 Canvas 2D）执行。
- 语言：JS（默认）或 TS。
- 莞小鹅官方形象素材授权（美术依赖）。
