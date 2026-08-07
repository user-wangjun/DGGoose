import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { Toast } from '../ui/Toast.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

/** 正确点触序列（0 基索引），对应 1 基序列 3→1→4→2 */
const CORRECT_SEQUENCE = [2, 0, 3, 1];

/** 栅栏门动画时长（秒） */
const GATE_OPEN_DURATION = 1.0;

/** 错误晃动动画时长（秒） */
const SHAKE_DURATION = 0.5;

/** 树热区尺寸（像素），满足 ≥44px 拇指触控要求 */
const HOT_ZONE_SIZE = 80;

/**
 * 荔枝树数据：5 棵树均匀分布在画布中部，编号 1-5
 * x/y 为树冠中心的逻辑坐标，label 为指示牌上的编号
 */
const TREE_DATA = [
  { x: 220, y: 380, label: '1' },
  { x: 420, y: 420, label: '2' },
  { x: 620, y: 380, label: '3' },
  { x: 820, y: 420, label: '4' },
  { x: 1020, y: 380, label: '5' },
];

/** 栅栏门初始位置（画布右侧） */
const GATE_X = 1140;
const GATE_Y = 340;

/** 指示牌位置（画布左下角） */
const SIGN_X = 100;
const SIGN_Y = 520;

/** 玩家初始位置（场景入口） */
const PLAYER_START_X = 120;
const PLAYER_START_Y = 560;

/** 资源尚未完成加载时的兼容性占位尺寸；正常绘制使用 GooseSprite */
const PLAYER_SIZE = 48;

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 解谜完成后弹出，玩家可选"留下种荔枝"进入荔枝传人结局分支，或继续探寻。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch2',
  nextChapter: 'ch3',
  title: '阿婆笑眯眯地看着你',
  stayLabel: '留下种荔枝',
  continueLabel: '继续探寻',
};

/**
 * 第二章场景 · 荔枝园序列解谜（对应 PRD §5 F7 + 计划 Task 3.4）
 *
 * 职责分工：
 * - Canvas 层：绘制荔枝园背景（绿色调）、5 棵荔枝树、栅栏门、指示牌、莞小鹅核心序列帧
 * - DOM 层：树的热区点击区域（≥44px 适配拇指）
 *
 * 解谜流程：
 * 1. 进入 → 播放对话 ch2 前 4 行（含 puzzle:start）
 * 2. 对话结束 → 显示 5 棵树和指示牌，玩家开始点触
 * 3. 正确 → 锁定高亮该树，推进到下一步
 * 4. 错误 → 全部重置 + 晃动 + Toast 提示
 * 5. 四步全对 → 栅栏门动画
 * 6. 门开 → 播放对话 ch2 后 4 行（含 puzzle:solved、badge:unlock、chapter:next）
 * 7. 对话结束 → 发放印记 lychee → 切换到第三章
 */
export class LycheeScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI
   * @param {InputManager} deps.input - 输入管理器
   * @param {PlayerController} deps.player - 角色控制器
   * @param {HTMLElement} deps.container - UI 挂载容器
   * @param {import('../core/GooseSprite.js').GooseSprite} [deps.gooseSprite] - 莞小鹅序列帧绘制器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, getChoice, gooseSprite }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.gooseSprite = gooseSprite || null;
    /** 读取已记录抉择的回调（用于判断"留下"按钮是否置灰，伞形多结局仅允许一次留下） */
    this.getChoice = getChoice || (() => null);

    /** 当前阶段：idle / intro / puzzle / gate_opening / outro / done */
    this.phase = 'idle';
    /** 当前解谜步数（0-3），对应 CORRECT_SEQUENCE 的索引 */
    this.puzzleStep = 0;
    /** 栅栏门动画进度（0~1） */
    this.gateProgress = 0;
    /** 错误晃动剩余时间（秒），大于 0 时树晃动 */
    this.shakeTime = 0;
    /** 传送带动画累计时间（秒），用于环境装饰 */
    this.animTime = 0;
    /** 标记是否已触发场景切换 */
    this.transitioning = false;

    /** 树状态列表：每棵树的状态（normal / locked / shaking） */
    this.treeStates = [];
    /** DOM 根容器（树热区层） */
    this.domRoot = null;
    /** 树热区 DOM 元素列表 */
    this.treeHotZones = [];
    /** Toast 实例（错误提示用） */
    this.toast = null;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;

    // 绑定回调
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._resizeHandler = this._resizeHandler.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化状态、构建 DOM 热区、注册事件、开始对话
   */
  onEnter() {
    this.phase = 'intro';
    this.puzzleStep = 0;
    this.gateProgress = 0;
    this.shakeTime = 0;
    this.animTime = 0;
    this.transitioning = false;

    // 初始化所有树为正常状态
    this.treeStates = TREE_DATA.map(() => 'normal');

    // 设置玩家位置（场景入口）
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 创建 Toast（错误提示用）
    this.toast = new Toast({ container: this.container, duration: 2000 });

    // 构建 DOM 热区层
    this._buildDom();

    // 注册对话结束事件
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    // 窗口尺寸变化时重新定位热区
    window.addEventListener('resize', this._resizeHandler);

    // 播放 ch2 前 4 行对话
    this.dialogueBox.show(DIALOGUES.ch2.slice(0, 4));
  }

  /**
   * 每帧更新：推进对话、栅栏门动画、晃动计时
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 始终推进对话框逐字显示
    this.dialogueBox.update(deltaTime);
    if (this.gooseSprite) {
      this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    }
    this.animTime += deltaTime;

    // 栅栏门开启动画
    if (this.phase === 'gate_opening') {
      this.gateProgress += deltaTime / GATE_OPEN_DURATION;
      if (this.gateProgress >= 1) {
        this.gateProgress = 1;
        this._onGateOpenComplete();
      }
    }

    // 错误晃动计时
    if (this.shakeTime > 0) {
      this.shakeTime -= deltaTime;
      if (this.shakeTime <= 0) {
        this.shakeTime = 0;
        // 晃动结束后恢复所有树为正常状态
        this.treeStates = this.treeStates.map(() => 'normal');
      }
    }
  }

  /**
   * Canvas 渲染：荔枝园背景 + 树木 + 栅栏门 + 指示牌 + 角色
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSign(ctx);
    this._drawTrees(ctx);
    this._drawGate(ctx);
    this._drawPlayer(ctx);
  }

  /**
   * 场景退出：移除事件监听、销毁 DOM、清理 Toast
   */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    window.removeEventListener('resize', this._resizeHandler);

    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }

    this._destroyDom();

    // 移除抉择覆盖层
    this._hideChoiceOverlay();

    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    this.phase = 'idle';
    this.transitioning = false;
  }

  // ==================== 对话阶段处理 ====================

  /**
   * 对话推进事件处理：仅在整段对话结束时推进阶段
   * @param {Object} data - 事件数据
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'intro') {
      // 前 4 行对话结束 → 开始解谜
      this.phase = 'puzzle';
      return;
    }

    if (this.phase === 'outro') {
      // 后 4 行对话结束 → 发放印记 → 切场景
      this._onOutroComplete();
      return;
    }
  }

  // ==================== 解谜逻辑 ====================

  /**
   * 树点击处理：校验是否为当前步骤期望的树
   * @param {number} treeIndex - 被点击树的 0 基索引
   * @private
   */
  _onTreeClick(treeIndex) {
    // 仅在解谜阶段且未在晃动时响应
    if (this.phase !== 'puzzle') return;
    if (this.shakeTime > 0) return;

    const expectedTree = CORRECT_SEQUENCE[this.puzzleStep];

    if (treeIndex === expectedTree) {
      // 正确：锁定该树高亮
      this.treeStates[treeIndex] = 'locked';
      this.puzzleStep++;

      // 四步全对 → 栅栏门动画
      if (this.puzzleStep >= CORRECT_SEQUENCE.length) {
        this._onPuzzleSolved();
      }
    } else {
      // 错误：全部重置 + 晃动 + 提示
      this._onWrongTree();
    }
  }

  /**
   * 错误点击处理：所有树进入晃动状态，重置步数，显示提示
   * @private
   */
  _onWrongTree() {
    // 所有已锁定的树也重置为晃动
    this.treeStates = this.treeStates.map(() => 'shaking');
    this.shakeTime = SHAKE_DURATION;
    this.puzzleStep = 0;

    // 错误音效（对应 PRD §7.8 SFX 反馈）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'error' });

    // Toast 提示（使用 ch2 第 5 行的台词）
    this.toast.show('顺序不对……让我再看看指示牌。');
  }

  /**
   * 解谜完成：开始栅栏门开启动画
   * @private
   */
  _onPuzzleSolved() {
    this.phase = 'gate_opening';
    this.gateProgress = 0;
    // 开门音效（对应 PRD §7.8 SFX 栅栏开门）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'gate' });
  }

  /**
   * 栅栏门动画完成：播放后续对话（ch2 第 6-9 行）
   * @private
   */
  _onGateOpenComplete() {
    this.phase = 'outro';
    // 播放 ch2 后 4 行对话（含 puzzle:solved、badge:unlock、chapter:next）
    this.dialogueBox.show(DIALOGUES.ch2.slice(5, 9));
  }

  /**
   * 尾声对话完成：发放印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    this.badgeSystem.unlock('lychee');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch2' });
    // 发放沿途印记后弹出抉择，玩家选择"留下"或"继续探寻"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下种荔枝"或"继续探寻"
   * 若已在前序场景选过"留下"，则本场景"留下"按钮置灰（伞形多结局仅允许一次留下）
   * @private
   */
  _showChoice() {
    // 隐藏对话框，避免与抉择覆盖层重叠
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }
    // 已选过其他场景"留下"则置灰本场景"留下"按钮
    const existingChoice = this.getChoice();
    const stayDisabled = existingChoice !== null && existingChoice !== undefined;

    this.choiceOverlay = new ChoiceOverlay({ eventBus: this.eventBus, container: this.container });
    this.choiceOverlay.show({
      title: CHOICE_CONFIG.title,
      stayLabel: CHOICE_CONFIG.stayLabel,
      continueLabel: CHOICE_CONFIG.continueLabel,
      stayDisabled,
      sceneId: CHOICE_CONFIG.sceneId,
    });
  }

  /**
   * 玩家选"留下"：广播锁定事件（主循环负责记录 choice），然后推进到下一场景
   * 留下不影响流程推进，仅记录选择供终章松山湖结算
   * @param {Object} data - 事件数据，data.sceneId 为当前场景 id
   * @private
   */
  _onChoiceStay(data) {
    // 抉择覆盖层未显示或场景 id 不匹配则忽略，避免跨场景误触
    if (!this.choiceOverlay) return;
    if (!data || data.sceneId !== CHOICE_CONFIG.sceneId) return;
    // 留下选择由 main.js 的 CHOICE_STAY 监听写入存档，此处仅推进场景
    this._advanceToNextScene();
  }

  /**
   * 玩家选"继续"：直接推进到下一场景
   * @param {Object} data - 事件数据
   * @private
   */
  _onChoiceContinue(data) {
    if (!this.choiceOverlay) return;
    if (!data || data.sceneId !== CHOICE_CONFIG.sceneId) return;
    this._advanceToNextScene();
  }

  /**
   * 推进到下一场景：隐藏抉择覆盖层并切换场景
   * @private
   */
  _advanceToNextScene() {
    if (this.transitioning) return;
    this.transitioning = true;
    this._hideChoiceOverlay();
    this.sceneManager.change(CHOICE_CONFIG.nextChapter);
  }

  /**
   * 隐藏并销毁抉择覆盖层
   * @private
   */
  _hideChoiceOverlay() {
    if (this.choiceOverlay) {
      this.choiceOverlay.hide();
      this.choiceOverlay = null;
    }
  }

  // ==================== DOM 热区构建 ====================

  /**
   * 构建 DOM 热区层：5 棵树的可点击区域
   * 使用 canvas 的 boundingRect 精确定位，保证热区与 Canvas 绘制对齐
   * @private
   */
  _buildDom() {
    this.domRoot = document.createElement('div');
    this.domRoot.setAttribute('data-lychee-scene', '');
    this.domRoot.style.cssText = `
      position: fixed; z-index: 50; pointer-events: none;
    `;

    this.treeHotZones = [];
    for (let i = 0; i < TREE_DATA.length; i++) {
      const zone = document.createElement('div');
      zone.style.cssText = `
        position: absolute; pointer-events: auto; cursor: pointer;
        border-radius: 50%; display: none;
      `;
      // 闭包捕获索引，避免回调中 i 被覆盖
      const treeIndex = i;
      zone.addEventListener('click', () => this._onTreeClick(treeIndex));
      this.domRoot.appendChild(zone);
      this.treeHotZones.push(zone);
    }

    this.container.appendChild(this.domRoot);
    this._updateDomPosition();
  }

  /**
   * 根据 Canvas 显示区域更新热区位置和尺寸
   * 保证热区与 Canvas 绘制的树精确对齐
   * @private
   */
  _updateDomPosition() {
    const canvas = document.getElementById('game');
    if (!canvas || !this.domRoot) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME.WIDTH;
    const scaleY = rect.height / GAME.HEIGHT;

    // DOM 容器匹配 Canvas 显示区域
    this.domRoot.style.left = rect.left + 'px';
    this.domRoot.style.top = rect.top + 'px';
    this.domRoot.style.width = rect.width + 'px';
    this.domRoot.style.height = rect.height + 'px';

    for (let i = 0; i < TREE_DATA.length; i++) {
      const tree = TREE_DATA[i];
      const zone = this.treeHotZones[i];
      if (!zone) continue;

      // 热区尺寸按缩放比适配，但不小于 44px
      const zoneSize = Math.max(HOT_ZONE_SIZE * Math.min(scaleX, scaleY), 44);
      const centerX = tree.x * scaleX;
      const centerY = tree.y * scaleY;

      zone.style.width = zoneSize + 'px';
      zone.style.height = zoneSize + 'px';
      zone.style.left = centerX - zoneSize / 2 + 'px';
      zone.style.top = centerY - zoneSize / 2 + 'px';

      // 仅在解谜阶段显示热区
      zone.style.display = this.phase === 'puzzle' ? 'block' : 'none';
    }
  }

  /**
   * 窗口尺寸变化时重新定位热区
   * @private
   */
  _resizeHandler() {
    this._updateDomPosition();
  }

  /**
   * 销毁 DOM 热区层
   * @private
   */
  _destroyDom() {
    if (this.domRoot && this.domRoot.parentNode) {
      this.domRoot.parentNode.removeChild(this.domRoot);
    }
    this.domRoot = null;
    this.treeHotZones = [];
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制荔枝园背景：绿色调渐变 + 地面 + 远景树丛
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    // 绿色调渐变背景
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#1a3a1a');
    gradient.addColorStop(0.5, '#2d5a2d');
    gradient.addColorStop(1, '#1e3e1e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 远景树丛剪影
    ctx.fillStyle = 'rgba(20, 60, 20, 0.6)';
    for (let x = 0; x < GAME.WIDTH; x += 120) {
      ctx.beginPath();
      ctx.arc(x, 100, 60 + Math.sin(x * 0.01) * 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // 地面（草地）
    ctx.fillStyle = '#3a6a3a';
    ctx.fillRect(0, GAME.HEIGHT - 120, GAME.WIDTH, 120);

    // 草地纹理
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < GAME.WIDTH; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, GAME.HEIGHT - 120);
      ctx.lineTo(x, GAME.HEIGHT);
      ctx.stroke();
    }

    // 阳光光斑（模拟树荫斑驳光影）
    for (let i = 0; i < 6; i++) {
      const x = ((this.animTime * 10 + i * 220) % (GAME.WIDTH + 100)) - 50;
      const y = 200 + Math.sin(this.animTime * 0.5 + i) * 30;
      const alpha = 0.05 + Math.sin(this.animTime + i) * 0.02;
      ctx.fillStyle = `rgba(255, 255, 200, ${Math.max(0, alpha)})`;
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 绘制指示牌：显示正确序列 3→1→4→2
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawSign(ctx) {
    ctx.save();

    // 牌子背景
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(SIGN_X - 50, SIGN_Y - 40, 100, 70);

    // 牌子边框
    ctx.strokeStyle = '#5C2E0C';
    ctx.lineWidth = 3;
    ctx.strokeRect(SIGN_X - 50, SIGN_Y - 40, 100, 70);

    // 支柱
    ctx.fillStyle = '#5C2E0C';
    ctx.fillRect(SIGN_X - 5, SIGN_Y + 30, 10, 50);

    // 序列文字
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('3→1→4→2', SIGN_X, SIGN_Y - 5);

    // 标题
    ctx.fillStyle = '#f0e68c';
    ctx.font = '11px sans-serif';
    ctx.fillText('点树顺序', SIGN_X, SIGN_Y + 18);

    ctx.restore();
  }

  /**
   * 绘制 5 棵荔枝树：树冠 + 编号 + 状态高亮/晃动
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawTrees(ctx) {
    for (let i = 0; i < TREE_DATA.length; i++) {
      const tree = TREE_DATA[i];
      const state = this.treeStates[i] || 'normal';

      // 晃动偏移
      let shakeOffset = 0;
      if (state === 'shaking' && this.shakeTime > 0) {
        shakeOffset = Math.sin(this.shakeTime * 40) * 6;
      }

      const drawX = tree.x + shakeOffset;
      const drawY = tree.y;

      ctx.save();

      // 树干
      ctx.fillStyle = '#5C2E0C';
      ctx.fillRect(drawX - 8, drawY + 20, 16, 60);

      // 树冠颜色根据状态变化
      let canopyColor = '#2d7a2d';
      if (state === 'locked') {
        canopyColor = '#fbbf24';
      } else if (state === 'shaking') {
        canopyColor = '#ef4444';
      }

      // 树冠（多个圆形叠加模拟荔枝树冠）
      ctx.fillStyle = canopyColor;
      ctx.beginPath();
      ctx.arc(drawX, drawY, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(drawX - 25, drawY + 10, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(drawX + 25, drawY + 10, 28, 0, Math.PI * 2);
      ctx.fill();

      // 荔枝果实点缀（红色小圆点）
      ctx.fillStyle = state === 'locked' ? '#f97316' : '#dc2626';
      const fruitPositions = [
        { x: -15, y: -5 }, { x: 10, y: -15 }, { x: 20, y: 5 },
        { x: -10, y: 15 }, { x: 25, y: -5 }, { x: -25, y: 0 },
      ];
      for (const fp of fruitPositions) {
        ctx.beginPath();
        ctx.arc(drawX + fp.x, drawY + fp.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // 锁定状态发光效果
      if (state === 'locked') {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(drawX, drawY, 42, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 编号标签
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tree.label, drawX, drawY);

      ctx.restore();
    }
  }

  /**
   * 绘制栅栏门：根据 gateProgress 滑动开启
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawGate(ctx) {
    ctx.save();

    // 栅栏门滑动偏移（向右滑出）
    const slideOffset = this.gateProgress * 120;

    // 栅栏门框架
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(GATE_X + slideOffset, GATE_Y, 8, 200);
    ctx.fillRect(GATE_X + slideOffset + 30, GATE_Y, 8, 200);

    // 栅栏横条
    ctx.fillStyle = '#A0522D';
    for (let y = 0; y < 200; y += 30) {
      ctx.fillRect(GATE_X + slideOffset, GATE_Y + y, 38, 6);
    }

    // 栅栏门顶部装饰
    ctx.fillStyle = '#5C2E0C';
    ctx.fillRect(GATE_X + slideOffset - 2, GATE_Y - 10, 42, 10);

    ctx.restore();
  }

  /**
   * 绘制莞小鹅角色：站立在场景入口处
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawPlayer(ctx) {
    // 对话期间用独立立绘承担角色表现，隐藏场景内的小角色，避免两套形象重叠。
    if (this.dialogueBox?.visible) return;

    const drawX = this.player.x;
    const drawY = this.player.y;
    const spriteDrawn = this.gooseSprite?.draw(ctx, drawX, drawY) ?? false;
    if (!spriteDrawn) {
      const halfSize = PLAYER_SIZE / 2;
      ctx.save();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(drawX - 11, drawY - 14, 5, 5);
      ctx.fillRect(drawX - 1, drawY - 14, 5, 5);
      ctx.restore();
    }
  }
}
