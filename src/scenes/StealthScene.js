import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { StealthLogic } from '../core/StealthLogic.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

// ==================== 场景布局常量 ====================

/** 玩家起点（左下角，店门入口侧） */
const PLAYER_START_X = 160;
const PLAYER_START_Y = 580;

/** 老板巡逻 Y 坐标（画布中部偏上） */
const BOSS_Y = 380;

/** 烧鹅台位置与判定半径（右上方吊架） */
const GOOSE_TABLE = { x: 1080, y: 240, radius: 42 };

/** 3 个掩体：桌底 / 木桶 / 门帘，分布在玩家前往烧鹅台的路径上 */
const COVERS = [
  { x: 340, y: 540, name: '桌底' },
  { x: 660, y: 560, name: '木桶' },
  { x: 920, y: 470, name: '门帘' },
];

/** 警戒区半径（px），玩家与老板距离小于此值视为在老板视野内 */
const DANGER_RADIUS = 210;

/** 被抓复位时间（秒），对应 PRD F6 */
const CAUGHT_RESET_TIME = 1.6;

/** 逃跑出口判定：玩家 X 小于此值视为逃出店门 */
const EXIT_X = 120;

/** 资源尚未完成加载时的兼容性占位尺寸；正常绘制使用 GooseSprite */
const PLAYER_SIZE = 40;
const BOSS_SIZE = 44;

/** 偷尝成功后发放的印记 id（对应 BADGES.roast_goose） */
const BADGE_ID = 'roast_goose';

/** 逃跑成功后切换的目标章节 */
const NEXT_CHAPTER = 'ch4';

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 逃出烧鹅店后弹出，玩家可选"留下做烧鹅"进入烧鹅传人结局分支，或继续前行。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch3',
  nextChapter: 'ch4',
  title: '老板追到门口却笑了',
  stayLabel: '留下做烧鹅',
  continueLabel: '继续前行',
};

/**
 * 烧鹅店潜行场景（对应 PRD §5 F6 + Task 3.5）
 *
 * 职责分工：
 * - Canvas 层：绘制烧鹅店背景（暖黄+深褐）、老板巡逻、莞小鹅核心序列帧、3 个掩体、烧鹅台、警觉度条
 * - DOM 层：顶部方向控制提示条
 * - 逻辑层：委托 StealthLogic 处理纯潜行逻辑
 *
 * 流程状态机：
 * 1. intro → 播放 ch3 前 5 行对话
 * 2. stealth → 对话结束触发潜行，玩家移动躲藏前往烧鹅台
 * 3. escaping → 到达烧鹅台偷尝后，带着烧鹅逃回左侧店门
 * 4. caught → 警觉度满值被抓获，1.6s 后复位到起点
 * 5. outro → 逃出后播放 ch3 后 5 行对话
 * 6. done → 发放印记 roast_goose，切换到 ch4
 */
export class StealthScene {
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
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, getFps, getChoice, gooseSprite }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.gooseSprite = gooseSprite || null;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);
    /** 读取已记录抉择的回调（用于判断"留下"按钮是否置灰，伞形多结局仅允许一次留下） */
    this.getChoice = getChoice || (() => null);

    /** 潜行纯逻辑实例 */
    this.logic = null;
    /** 当前阶段：idle / intro / stealth / escaping / caught / outro / done */
    this.phase = 'idle';
    /** 被抓复位倒计时（秒） */
    this.caughtTimer = 0;
    /** 是否已偷尝烧鹅 */
    this.hasStolen = false;
    /** 标记是否已触发场景切换，防止重复调用 */
    this.transitioning = false;
    /** DOM 提示元素引用 */
    this.hintElement = null;
    /** 奔跑尘土粒子系统 */
    this.particles = null;
    /** 尘土发射累计计时（秒），控制发射频率 */
    this._dustTimer = 0;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;

    // 绑定回调，便于 onExit 精确移除
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化潜行逻辑、设置玩家起点、注册事件、播放前 5 行对话
   */
  onEnter() {
    this.phase = 'intro';
    this.caughtTimer = 0;
    this.hasStolen = false;
    this.transitioning = false;
    this._dustTimer = 0;

    // 初始化奔跑尘土粒子系统
    this.particles = new ParticleSystem({ getFps: this.getFps });

    // 创建潜行逻辑实例，注入 PRD F6 数值
    this.logic = new StealthLogic({
      canvasWidth: GAME.WIDTH,
      canvasHeight: GAME.HEIGHT,
      patrolSpeed: 92,
      alertRate: 45,
      alertDecay: 20,
      alertMax: 100,
      coverThreshold: 26,
      bossY: BOSS_Y,
      gooseTable: GOOSE_TABLE,
    });

    // 设置玩家起点
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 注册对话结束事件，用于阶段推进
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 构建 DOM 提示
    this._buildHint();

    // 播放 ch3 前 5 行对话（引导潜行）
    this.dialogueBox.show(DIALOGUES.ch3.slice(0, 5));
  }

  /**
   * 每帧更新：推进对话逐字、按阶段分发潜行逻辑
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 始终推进对话框逐字显示（对话不可见时为空操作）
    this.dialogueBox.update(deltaTime);
    if (this.gooseSprite) {
      this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    }

    // 对话阶段不处理潜行逻辑
    if (this.phase === 'intro' || this.phase === 'outro' || this.phase === 'done') {
      return;
    }

    // 被抓复位阶段：倒计时，到时复位
    if (this.phase === 'caught') {
      this.caughtTimer += deltaTime;
      if (this.caughtTimer >= CAUGHT_RESET_TIME) {
        this._onCaughtReset();
      }
      return;
    }

    // 潜行与逃跑阶段：更新老板巡逻、玩家移动、警觉度、目标检测
    if (this.phase === 'stealth' || this.phase === 'escaping') {
      this._updateStealth(deltaTime);
    }

    // 更新粒子系统
    if (this.particles) this.particles.update(deltaTime);
  }

  /**
   * 潜行阶段核心更新：老板巡逻、玩家移动、警戒区与掩体判定、警觉度、目标检测
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateStealth(deltaTime) {
    // 更新老板巡逻位置
    this.logic.updateBoss(deltaTime);

    // 玩家移动（输入由 PlayerController 读取）
    this.player.update(deltaTime, this.input);

    // 奔跑时发射尘土粒子（对应 PRD §7.7 奔跑尘土）
    if (this.particles && this.player.animState === 'run') {
      this._dustTimer += deltaTime;
      if (this._dustTimer >= 0.08) {
        this._dustTimer = 0;
        this.particles.emit(this.player.x, this.player.y + PLAYER_SIZE / 2, 'dust');
      }
    }

    // 计算玩家是否在老板警戒区（面朝方向的视野范围内）
    // 老板视野为方向性扇形：仅检测面朝方向半圆内的玩家
    const boss = this.logic.getBossPosition();
    const dx = this.player.x - boss.x;
    const dy = this.player.y - boss.y;
    const distToBoss = Math.sqrt(dx * dx + dy * dy);
    // 玩家必须在老板面朝方向（direction=1 向右 → dx>0；direction=-1 向左 → dx<0）
    const inFrontOfBoss = (boss.direction === 1 && dx > 0) || (boss.direction === -1 && dx < 0);
    const inDangerZone = inFrontOfBoss && distToBoss < DANGER_RADIUS;

    // 检测玩家是否近掩体（已藏好）
    const isHidden = this.logic.isNearCover(this.player.x, this.player.y, COVERS);

    // 更新警觉度
    this.logic.updateAlert(deltaTime, inDangerZone, isHidden);

    // 检测被抓：警觉度满值
    if (this.logic.isCaught()) {
      this._onCaught();
      return;
    }

    if (this.phase === 'stealth') {
      // 潜行阶段：检测到达烧鹅台 → 偷尝
      if (this.logic.isAtGooseTable(this.player.x, this.player.y)) {
        this._onSteal();
      }
    } else if (this.phase === 'escaping') {
      // 逃跑阶段：检测逃到左侧店门
      if (this.player.x < EXIT_X) {
        this._onEscape();
      }
    }
  }

  /**
   * Canvas 渲染：背景 + 掩体 + 烧鹅台 + 老板 + 玩家 + 警觉度条
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawCovers(ctx);
    this._drawGooseTable(ctx);
    this._drawBoss(ctx);
    this._drawPlayer(ctx);
    // 尘土粒子渲染在角色之上
    if (this.particles) this.particles.draw(ctx);
    // 警觉度条仅在潜行相关阶段显示
    if (this.phase === 'stealth' || this.phase === 'escaping' || this.phase === 'caught') {
      this._drawAlertBar(ctx);
    }
  }

  /**
   * 场景退出：移除事件监听、隐藏对话框、移除 DOM、释放逻辑实例
   */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }
    this._removeHint();
    // 移除抉择覆盖层
    this._hideChoiceOverlay();
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
    this.logic = null;
    this.phase = 'idle';
    this.transitioning = false;
  }

  // ==================== 对话阶段处理 ====================

  /**
   * 对话推进事件处理：仅在整段对话结束时推进阶段
   * @param {Object} data - 事件数据，finished 为 true 表示对话全部结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'intro') {
      // 前 5 行对话结束 → 触发 stealth:start，进入潜行
      this.phase = 'stealth';
      this._updateHint();
      return;
    }

    if (this.phase === 'outro') {
      // 后 5 行对话结束 → 发放印记 → 切换 ch4
      this._onOutroComplete();
      return;
    }
  }

  // ==================== 潜行事件处理 ====================

  /**
   * 偷尝烧鹅：标记已偷尝，切换到逃跑阶段
   * @private
   */
  _onSteal() {
    this.hasStolen = true;
    this.phase = 'escaping';
    // 偷尝音效（对应 PRD §7.8 SFX 偷吃）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'steal' });
    this._updateHint();
  }

  /**
   * 成功逃出店门：播放 ch3 后 5 行对话
   * @private
   */
  _onEscape() {
    this.phase = 'outro';
    this._updateHint();
    this.dialogueBox.show(DIALOGUES.ch3.slice(5, 10));
  }

  /**
   * 被抓获：进入复位阶段，启动 1.6s 倒计时
   * @private
   */
  _onCaught() {
    this.phase = 'caught';
    this.caughtTimer = 0;
    // 被抓音效（对应 PRD §7.8 SFX 被抓）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'caught' });
    this._updateHint();
  }

  /**
   * 被抓复位完成：玩家回到起点、警觉度归零，按是否已偷尝回到对应阶段
   * @private
   */
  _onCaughtReset() {
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);
    this.logic.resetAlert();
    // 已偷尝则继续逃跑，否则继续潜行
    this.phase = this.hasStolen ? 'escaping' : 'stealth';
    this._updateHint();
  }

  /**
   * 尾声对话完成：发放印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    this.badgeSystem.unlock(BADGE_ID);
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch3' });
    // 发放沿途印记后弹出抉择，玩家选择"留下"或"继续前行"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下做烧鹅"或"继续前行"
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

  // ==================== DOM 提示层 ====================

  /**
   * 构建顶部方向控制提示条
   * @private
   */
  _buildHint() {
    this.hintElement = document.createElement('div');
    this.hintElement.setAttribute('data-stealth-hint', '');
    this.hintElement.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: 6000; padding: 8px 22px; border-radius: 8px;
      background: rgba(0,0,0,0.6); color: #fbbf24; font-size: 15px;
      font-family: inherit; pointer-events: none; user-select: none;
      max-width: 80vw; text-align: center;
    `;
    this.container.appendChild(this.hintElement);
    this._updateHint();
  }

  /**
   * 根据当前阶段刷新提示文本
   * @private
   */
  _updateHint() {
    if (!this.hintElement) return;
    let text = '';
    if (this.phase === 'stealth') {
      text = '躲开老板视线，靠近掩体藏好，前往右上烧鹅台偷尝（WASD/方向键移动）';
    } else if (this.phase === 'escaping') {
      text = '得手了！带着烧鹅逃回左侧店门！';
    } else if (this.phase === 'caught') {
      text = '被发现了！1.6 秒后复位……';
    }
    this.hintElement.textContent = text;
    this.hintElement.style.display = text ? 'block' : 'none';
  }

  /**
   * 移除 DOM 提示元素
   * @private
   */
  _removeHint() {
    if (this.hintElement && this.hintElement.parentNode) {
      this.hintElement.parentNode.removeChild(this.hintElement);
    }
    this.hintElement = null;
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制烧鹅店背景：暖黄+深褐渐变、顶部挂架横梁、木质地面
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    // 暖黄到深褐渐变，营造烧鹅店暖色氛围
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#5c3a1e');
    gradient.addColorStop(0.55, '#3d2412');
    gradient.addColorStop(1, '#241208');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 顶部挂架横梁（烧鹅吊架）
    ctx.fillStyle = '#4a2d14';
    ctx.fillRect(0, 120, GAME.WIDTH, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 134, GAME.WIDTH, 4);

    // 木质地面
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(0, GAME.HEIGHT - 90, GAME.WIDTH, 90);
    // 地板纹理线
    ctx.strokeStyle = 'rgba(255,200,120,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < GAME.WIDTH; x += 70) {
      ctx.beginPath();
      ctx.moveTo(x, GAME.HEIGHT - 90);
      ctx.lineTo(x, GAME.HEIGHT);
      ctx.stroke();
    }

    // 左侧店门出口标识（逃跑阶段高亮）
    if (this.phase === 'escaping') {
      ctx.save();
      ctx.fillStyle = 'rgba(251,191,36,0.18)';
      ctx.fillRect(0, GAME.HEIGHT - 300, 90, 300);
      ctx.fillStyle = 'rgba(251,191,36,0.85)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('出口', 45, GAME.HEIGHT - 310);
      ctx.restore();
    }
  }

  /**
   * 绘制 3 个掩体：桌底（长桌）、木桶（圆形）、门帘（竖条纹）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawCovers(ctx) {
    ctx.save();

    // 桌底：棕色长方形桌面 + 桌腿
    const table = COVERS[0];
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(table.x - 60, table.y - 16, 120, 12);
    ctx.fillStyle = '#4a2d14';
    ctx.fillRect(table.x - 54, table.y - 4, 8, 40);
    ctx.fillRect(table.x + 46, table.y - 4, 8, 40);
    // 桌底阴影（藏匿区暗示）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(table.x - 50, table.y + 24, 100, 6);

    // 木桶：棕色圆形
    const barrel = COVERS[1];
    ctx.fillStyle = '#7a4a1f';
    ctx.beginPath();
    ctx.arc(barrel.x, barrel.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a2d14';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 木桶箍纹
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(barrel.x, barrel.y, 18, 0, Math.PI * 2);
    ctx.stroke();

    // 门帘：竖条纹布帘
    const curtain = COVERS[2];
    ctx.fillStyle = '#8a4a2a';
    ctx.fillRect(curtain.x - 30, curtain.y - 60, 60, 120);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(curtain.x + i * 12, curtain.y - 60);
      ctx.lineTo(curtain.x + i * 12, curtain.y + 60);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制烧鹅台：右上吊架 + 烧鹅占位（偷尝后显示空架）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawGooseTable(ctx) {
    const table = GOOSE_TABLE;
    ctx.save();

    // 吊架挂钩
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(table.x, 134);
    ctx.lineTo(table.x, table.y - 30);
    ctx.stroke();

    // 台面底座
    ctx.fillStyle = '#5a3818';
    ctx.fillRect(table.x - 50, table.y - 20, 100, 16);

    if (!this.hasStolen) {
      // 烧鹅占位：金黄色椭圆（未偷尝时显示）
      ctx.fillStyle = '#d97706';
      ctx.beginPath();
      ctx.ellipse(table.x, table.y, 36, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.stroke();
      // 烧鹅光泽
      ctx.fillStyle = 'rgba(255,220,120,0.5)';
      ctx.beginPath();
      ctx.ellipse(table.x - 8, table.y - 6, 14, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // 潜行阶段显示提示
      if (this.phase === 'stealth') {
        ctx.fillStyle = 'rgba(251,191,36,0.85)';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('偷尝烧鹅', table.x, table.y - 36);
      }
    } else {
      // 偷尝后：空架提示
      ctx.fillStyle = 'rgba(180,180,180,0.4)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('（空）', table.x, table.y);
    }

    ctx.restore();
  }

  /**
   * 绘制老板：红色方块占位 + 朝向眼睛 + 警戒区半透明圆
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBoss(ctx) {
    const boss = this.logic.getBossPosition();
    const half = BOSS_SIZE / 2;

    ctx.save();

    // 警戒区范围（潜行/逃跑阶段显示半透明红色半圆，仅覆盖老板面朝方向）
    if (this.phase === 'stealth' || this.phase === 'escaping') {
      ctx.fillStyle = 'rgba(239,68,68,0.08)';
      ctx.strokeStyle = 'rgba(239,68,68,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // direction=1 向右：右半圆（-π/2 到 π/2）；direction=-1 向左：左半圆（π/2 到 3π/2）
      const startAngle = boss.direction === 1 ? -Math.PI / 2 : Math.PI / 2;
      const endAngle = boss.direction === 1 ? Math.PI / 2 : (Math.PI * 3) / 2;
      ctx.arc(boss.x, boss.y, DANGER_RADIUS, startAngle, endAngle);
      ctx.lineTo(boss.x, boss.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 老板色块（红色方块占位）
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(boss.x - half, boss.y - half, BOSS_SIZE, BOSS_SIZE);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(boss.x - half, boss.y - half, BOSS_SIZE, BOSS_SIZE);

    // 眼睛（根据朝向偏移）
    ctx.fillStyle = '#1a1a2e';
    const eyeOffset = boss.direction === 1 ? 4 : -4;
    ctx.fillRect(boss.x + eyeOffset - 7, boss.y - 12, 5, 5);
    ctx.fillRect(boss.x + eyeOffset + 3, boss.y - 12, 5, 5);

    // 被抓阶段闪烁警告
    if (this.phase === 'caught') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('！', boss.x, boss.y - half - 8);
    }

    ctx.restore();
  }

  /**
   * 绘制莞小鹅：橙色烧鹅造型色块 + 朝向眼睛，藏好时半透明
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawPlayer(ctx) {
    // 对话期间用独立立绘承担角色表现，隐藏场景内的小角色，避免两套形象重叠。
    if (this.dialogueBox?.visible) return;

    const half = PLAYER_SIZE / 2;
    const isHidden = this.phase === 'stealth' || this.phase === 'escaping'
      ? this.logic.isNearCover(this.player.x, this.player.y, COVERS)
      : false;

    const spriteDrawn = this.gooseSprite?.draw(ctx, this.player.x, this.player.y, {
      alpha: isHidden ? 0.45 : 1,
    }) ?? false;
    if (!spriteDrawn) {
      ctx.save();
      ctx.globalAlpha = isHidden ? 0.45 : 1;
      ctx.fillStyle = '#d97706';
      ctx.fillRect(this.player.x - half, this.player.y - half, PLAYER_SIZE, PLAYER_SIZE);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.player.x - half, this.player.y - half, PLAYER_SIZE, PLAYER_SIZE);
      ctx.fillStyle = '#1a1a2e';
      const eyeOffset = this.player.facing === 1 ? 5 : -5;
      ctx.fillRect(this.player.x + eyeOffset - 6, this.player.y - 14, 5, 5);
      ctx.fillRect(this.player.x + eyeOffset + 4, this.player.y - 14, 5, 5);
      ctx.restore();
    }

    // 藏好提示
    if (isHidden) {
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.9)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已藏好', this.player.x, this.player.y - half - 10);
      ctx.restore();
    }
  }

  /**
   * 绘制警觉度条：顶部居中，按警觉度分段着色
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawAlertBar(ctx) {
    const alert = this.logic.getAlert();
    const percent = alert / 100;
    const barWidth = 300;
    const barHeight = 18;
    const barX = (GAME.WIDTH - barWidth) / 2;
    const barY = 20;

    ctx.save();

    // 背景框
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);

    // 警觉度填充：按分段着色（低绿/中黄/高红）
    let fillColor;
    if (percent < 0.4) {
      fillColor = '#22c55e';
    } else if (percent < 0.7) {
      fillColor = '#eab308';
    } else {
      fillColor = '#ef4444';
    }
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, barWidth * percent, barHeight);

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`警觉度 ${Math.round(alert)}%`, GAME.WIDTH / 2, barY + barHeight / 2);

    ctx.restore();
  }
}
