import {
  BASKETBALL_SCENE_BACKGROUND_URL,
  BASKETBALL_SHOOTING_BACKGROUND_URL,
  GAME,
  EVENT,
} from '../config.js';
import { BallPhysics } from '../core/BallPhysics.js';
import { ChargeMeter } from '../ui/ChargeMeter.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { GoalBurstEffect } from '../core/GoalBurstEffect.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';
import { applyButtonStyle } from '../ui/ButtonTheme.js';
import { DIALOGUES } from '../data/dialogues.js';
import { TopdownController } from '../core/TopdownController.js';
import { createBasketballMap } from '../data/basketballScene.js';
import { loadSceneObjectAssets, drawSceneObject } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';

/**
 * 投篮物理参数（来自 PRD §5 F5，与 BallPhysics 测试配置一致）
 */
// 侧视投篮目标使用与最初版本一致的固定 X 坐标；Y 轴做上下往返。
const HOOP_X = 1000;
/** 俯视球馆地图里的真实右侧篮架中心，和正式背景互动物件保持对齐。 */
const GRAVITY = 430;
const CHARGE_RATE = 65;
// 传统 BallPhysics 仍支持上下浮动篮筐；正式 Blumgi 投篮关卡使用
// 每关固定篮筐和平台布局，归一化坐标统一转换成逻辑像素。
const HOOP_RANGE_MIN = 0.10;
const HOOP_RANGE_MAX = 0.34;
/** 物理开口半宽：篮圈半宽 34 - 篮圈边缘 3 - 篮球半径 14。 */
const SCORE_WINDOW_HALF_WIDTH = 17;
/** 过关所需进球数；HUD、俯视任务提示和胜负判定统一使用同一目标。 */
const TARGET_SCORE = 5;
/** 投篮玩法中的脚底锚点，与 BallPhysics 的可配置起始点一致。 */
const GAMEPLAY_PLAYER_X = 320;
const GAMEPLAY_PLAYER_Y = 580;
/** 点击篮球的容错半径，让鼠标/手指不必精确命中篮球中心。 */
const AIM_HIT_PADDING = 44;
/** 触屏上手指会遮挡小球，允许从更大的可视邻域开始拖拽。 */
const AIM_HIT_RADIUS = 72;
/** 小于该距离的拖拽视为误触，不发射篮球。 */
const AIM_MIN_DRAG_DISTANCE = 18;

/**
 * Blumgi Ball 风格的 5 个短关卡：每次进球切换一个平台布局。
 * 场景仍使用项目自己的篮球、篮筐和莞小鹅 Sprite，不依赖第三方游戏资源。
 */
const BLUMGI_LEVELS = Object.freeze([
  {
    palette: ['#ffd7ad', '#f2a7b8'],
    start: { x: 320, y: 580 },
    hoop: { x: 1030, y: 226 },
    floorY: 620,
    platforms: [
      { x: 0, y: 620, width: 1280, height: 100 },
      { x: 470, y: 500, width: 220, height: 24 },
      { x: 820, y: 360, width: 220, height: 24 },
    ],
  },
  {
    palette: ['#c9e8ff', '#a9b8f4'],
    start: { x: 260, y: 560 },
    hoop: { x: 1080, y: 350 },
    floorY: 620,
    platforms: [
      { x: 0, y: 620, width: 1280, height: 100 },
      { x: 340, y: 470, width: 170, height: 24 },
      { x: 650, y: 560, width: 170, height: 24 },
      { x: 900, y: 430, width: 190, height: 24 },
    ],
  },
  {
    palette: ['#ffe2a8', '#f6a0a0'],
    start: { x: 220, y: 540 },
    hoop: { x: 970, y: 178 },
    floorY: 620,
    platforms: [
      { x: 0, y: 620, width: 1280, height: 100 },
      { x: 280, y: 430, width: 160, height: 24 },
      { x: 545, y: 520, width: 170, height: 24 },
      { x: 790, y: 330, width: 190, height: 24 },
    ],
  },
  {
    palette: ['#baf2d4', '#8dd3e8'],
    start: { x: 360, y: 580 },
    hoop: { x: 1080, y: 260 },
    floorY: 620,
    platforms: [
      { x: 0, y: 620, width: 1280, height: 100 },
      { x: 520, y: 430, width: 190, height: 24 },
      { x: 850, y: 520, width: 190, height: 24 },
      { x: 910, y: 290, width: 180, height: 24 },
    ],
  },
  {
    palette: ['#e4d1ff', '#f3a7cf'],
    start: { x: 240, y: 560 },
    hoop: { x: 1030, y: 150 },
    floorY: 620,
    platforms: [
      { x: 0, y: 620, width: 1280, height: 100 },
      { x: 330, y: 490, width: 180, height: 24 },
      { x: 615, y: 365, width: 180, height: 24 },
      { x: 900, y: 255, width: 180, height: 24 },
    ],
  },
]);
const BLUMGI_LEVEL_COUNT = BLUMGI_LEVELS.length;

/** 进球/未中反馈文本显示时长（秒） */
const FEEDBACK_DURATION = 1.5;

/** 开场对话取 ch1 前 4 行（最后一行带 minigame:start 事件） */
const OPENING_LINES = DIALOGUES.ch1.slice(0, 4);
/** 过关对话取 ch1 第 7~9 行（minigame:win → 感言 → chapter:next） */
const WIN_LINES = DIALOGUES.ch1.slice(6, 9);
/** 进球反馈文本（来自 ch1 第 5 行 minigame:score） */
const SCORE_FEEDBACK_TEXT = (DIALOGUES.ch1[4] && DIALOGUES.ch1[4].txt) || '好球！再来！';
/** 未中反馈文本（来自 ch1 第 6 行 minigame:miss） */
const MISS_FEEDBACK_TEXT = (DIALOGUES.ch1[5] && DIALOGUES.ch1[5].txt) || '差一点！调整力度再试试。';

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 发放沿途印记后弹出，玩家可选"留下训练"进入篮球人生结局分支，或继续探寻。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch1',
  nextChapter: 'ch2',
  title: '教练拍了拍莞小鹅的肩膀',
  stayLabel: '留下训练',
  continueLabel: '继续探寻',
};

/**
 * 投篮小游戏场景（对应 PRD §5 F5 + Task 3.3）
 *
 * 玩法流程：
 * 1. 进入场景 → 播放开场对话（ch1 前 4 行）
 * 2. 对话结束 → 触发 minigame:start → 玩家拖拽篮球瞄准并松手发射
 * 3. 60 秒内投进 5 球 → 播放过关对话 → 发放印记 "basketball" → 进入剧情抉择
 * 4. 时间到未进 5 球 → 可领取篮球纪念继续剧情，也可选择重试
 *
 * 分层渲染：
 * - Canvas 层：背景、篮筐、球、蓄力条（画布内）、计分、倒计时、反馈文本
 * - DOM 层：ChargeMeter（力度条 + 备用入口）、失败结算按钮
 *
 * 输入方式：
 * - 主路径：点击/触摸篮球，拖拽确定方向和力度，松手出手
 * - 备用路径：空格键或 ChargeMeter 备用按钮蓄力，释放出手
 */
export class BasketballScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器（由 DialogueBox 内部使用）
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI（共享单例）
   * @param {InputManager} deps.input - 输入管理器
   * @param {HTMLElement} deps.container - UI 挂载容器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player = null, container, canvas = null, assetLoader = null, getFps, getChoice, gooseSprite = null, coachSprite = null, goalBurstEffect = null }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.gooseSprite = gooseSprite;
    this.coachSprite = coachSprite;
    this.container = container;
    this.canvas = canvas || (typeof document !== 'undefined' ? document.getElementById('game') : null);
    this.assetLoader = assetLoader;
    /** 俯视地图使用的正式篮球馆背景；加载失败时只显示纯色兜底。 */
    this.backgroundImage = null;
    /** 投篮阶段使用的移除静态右侧篮架背景，由 Canvas 绘制活动侧视篮筐。 */
    this.shootingBackgroundImage = null;
    this.backgroundLoadPromise = null;
    this.shootingBackgroundLoadPromise = null;
    this.objectImages = new Map();
    this.objectAssetsPromise = null;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);
    /** 读取已记录抉择的回调（用于判断"留下"按钮是否置灰，伞形多结局仅允许一次留下） */
    this.getChoice = getChoice || (() => null);

    /** 场景阶段：'idle' | 'dialogue' | 'playing' | 'winDialogue' | 'failed' | 'choice' */
    this.phase = 'idle';
    /** 物理引擎实例 */
    this.physics = null;
    /** 蓄力条 DOM 组件实例 */
    this.chargeMeter = null;
    /** 是否正在蓄力 */
    this.isCharging = false;
    /** 是否正在画布上拖拽瞄准 */
    this.isAiming = false;
    /** 当前瞄准指针 ID，避免多指触控重复出手 */
    this.aimPointerId = null;
    /** 当前拖拽终点（逻辑画布坐标） */
    this.aimPoint = null;
    /** 当前拖拽方向和距离，用于绘制弹弓辅助线 */
    this.aimVector = null;
    /** 当前拖拽映射出的物理速度 */
    this.aimVelocity = null;
    /** 进入投篮阶段前画布的 touch-action 样式，用于退出时恢复 */
    this.previousCanvasTouchAction = '';
    /** 标记上一帧球是否在飞行（用于检测球落地的时刻） */
    this.ballWasFlying = false;
    /** 飞行中的篮球残影位置，用于增强速度和出手方向感。 */
    this.ballTrail = [];
    this.ballSpin = 0;
    /** 反馈文本（"好球！"或"差一点！"） */
    this.feedbackText = '';
    /** 反馈文本剩余显示时间（秒） */
    this.feedbackTimer = 0;
    /** 计数器刚变化后的脉冲时间，用于让新增进球在紧凑 HUD 中可见。 */
    this.scorePulseTimer = 0;
    /** 最近一次已同步到任务 HUD 的得分，避免重复刷新 DOM。 */
    this.lastSyncedScore = 0;
    /** 防重复切换场景 */
    this.transitioning = false;
    /** 再来一局覆盖层 DOM */
    this.retryOverlay = null;
    /** 再来一局按钮 DOM */
    this.retryButton = null;
    /** 失败后领取篮球纪念并继续剧情的按钮 DOM */
    this.souvenirButton = null;
    /** 粒子系统（进球光效） */
    this.particles = null;
    /** 正式三帧进球光效；与外围粒子分离，使用场景 update 驱动生命周期。 */
    this.goalBurstEffect = goalBurstEffect;
    /** 最近一次已处理的得分，阻止同一进球事件重复启动主光效。 */
    this.lastGoalEffectScore = 0;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;
    /** 俯视球馆入口控制器；未注入玩家时保留逻辑测试兼容路径。 */
    this.topdown = null;
    this.topdownSpawn = null;
    /** 互动标记使用的场景时间，和 Canvas 逻辑坐标一样不受 CSS 缩放影响。 */
    this.animTime = 0;
    /** Blumgi 风格投篮阶段是否已启用；地图阶段仍保留正式球馆背景。 */
    this.blumgiMode = false;
    /** 当前短关卡索引，得分后推进到下一组平台/篮筐。 */
    this.blumgiLevelIndex = 0;
    /** 侧视玩法中莞小鹅的位置，与当前短关卡的篮球起点同步。 */
    this.gameplayPlayerPosition = { x: 320, y: 580 };
    this.gameplayPlayerFacing = 1;

    // 绑定事件处理器 this 指向
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onChargeStart = this._onChargeStart.bind(this);
    this._onChargeRelease = this._onChargeRelease.bind(this);
    this._onCanvasPointerDown = this._onCanvasPointerDown.bind(this);
    this._onCanvasPointerMove = this._onCanvasPointerMove.bind(this);
    this._onCanvasPointerUp = this._onCanvasPointerUp.bind(this);
    this._onCanvasPointerCancel = this._onCanvasPointerCancel.bind(this);
    this._onRetryClick = this._onRetryClick.bind(this);
    this._onFailureContinue = this._onFailureContinue.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：创建物理引擎、注册事件、播放开场对话
   * @param {*} [params] - 切换场景时传入的参数（本场景忽略）
   */
  onEnter(params = {}) {
    this._createPhysics();
    this._loadAssets();
    this._loadSceneObjects();
    this.gooseSprite?.load?.();
    this.coachSprite?.load?.();
    this.particles = new ParticleSystem({ getFps: this.getFps });
    if (!this.goalBurstEffect) {
      this.goalBurstEffect = new GoalBurstEffect({ assetLoader: this.assetLoader });
    }
    this.goalBurstEffect.load();
    this._createTopdown();

    // 监听对话结束事件，用于阶段切换
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);

    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 进入开场对话阶段
    this.phase = 'dialogue';
    this.dialogueBox.show(OPENING_LINES);
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回球馆地图、投篮物理、瞄准预览和对话的完整快照。 */
  getSaveState() {
    return {
      phase: this.phase,
      blumgiMode: this.blumgiMode,
      blumgiLevelIndex: this.blumgiLevelIndex,
      isCharging: this.isCharging,
      isAiming: this.isAiming,
      aimPoint: this.aimPoint ? { ...this.aimPoint } : null,
      aimVector: this.aimVector ? { ...this.aimVector } : null,
      aimVelocity: this.aimVelocity ? { ...this.aimVelocity } : null,
      gameplayPlayerPosition: { ...this.gameplayPlayerPosition },
      gameplayPlayerFacing: this.gameplayPlayerFacing,
      ballWasFlying: this.ballWasFlying,
      ballTrail: this.ballTrail.map((point) => ({ ...point })),
      ballSpin: this.ballSpin,
      feedbackText: this.feedbackText,
      feedbackTimer: this.feedbackTimer,
      scorePulseTimer: this.scorePulseTimer,
      lastSyncedScore: this.lastSyncedScore,
      transitioning: this.transitioning,
      physics: this.physics?.getSaveState?.() || null,
      topdown: this.topdown?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /**
   * 恢复球馆阶段。小游戏 UI 先按当前关卡重新挂载，再把物理快照写回，
   * 避免继续游戏时重新发球或把得分归零。
   */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    const phase = typeof state.phase === 'string' ? state.phase : 'dialogue';
    this.dialogueBox?.hide?.();
    this.blumgiLevelIndex = Number.isInteger(state.blumgiLevelIndex)
      ? Math.max(0, Math.min(BLUMGI_LEVEL_COUNT - 1, state.blumgiLevelIndex))
      : 0;
    this.gameplayPlayerPosition = Number.isFinite(state.gameplayPlayerPosition?.x)
      && Number.isFinite(state.gameplayPlayerPosition?.y)
      ? { ...state.gameplayPlayerPosition }
      : { ...this.gameplayPlayerPosition };
    this.gameplayPlayerFacing = state.gameplayPlayerFacing === -1 ? -1 : 1;
    this.ballWasFlying = Boolean(state.ballWasFlying);
    this.ballTrail = Array.isArray(state.ballTrail)
      ? state.ballTrail.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).map((point) => ({ ...point }))
      : [];
    this.ballSpin = Number.isFinite(state.ballSpin) ? state.ballSpin : 0;
    this.feedbackText = typeof state.feedbackText === 'string' ? state.feedbackText : '';
    this.feedbackTimer = Number.isFinite(state.feedbackTimer) ? state.feedbackTimer : 0;
    this.scorePulseTimer = Number.isFinite(state.scorePulseTimer) ? state.scorePulseTimer : 0;
    this.lastSyncedScore = Number.isFinite(state.lastSyncedScore) ? state.lastSyncedScore : 0;
    this.transitioning = Boolean(state.transitioning);

    if (phase === 'playing' || phase === 'loadingBackground') {
      // 继续游戏时允许先用兜底背景进入玩法，正式背景加载完成后会自然替换。
      this._enterPlaying();
      this._configureBlumgiLevel(this.blumgiLevelIndex);
      this.physics?.restoreSaveState?.(state.physics);
      this.blumgiMode = true;
      this.phase = 'playing';
      this.isCharging = false;
      if (this.chargeMeter) this.chargeMeter.update(this.physics?.getCharge?.() || 0);
      this._syncScoreProgress(true);
      this._restoreAimState(state);
    } else if (phase === 'failed') {
      this._enterPlaying();
      this._configureBlumgiLevel(this.blumgiLevelIndex);
      this.physics?.restoreSaveState?.(state.physics);
      this._onGameFailed();
    } else if (phase === 'winDialogue') {
      this._enterPlaying();
      this._configureBlumgiLevel(this.blumgiLevelIndex);
      this.physics?.restoreSaveState?.(state.physics);
      this._startWinDialogue();
    } else if (phase === 'choice') {
      this.phase = 'choice';
      this.transitioning = true;
      this.blumgiMode = false;
      this._setTopdownHudVisible(true);
      this._showChoice();
    } else if (phase === 'map') {
      this._startTopdownMap();
      this.phase = 'map';
    } else {
      this.phase = phase;
    }

    // 地图/抉择/对话阶段虽然不显示投篮画面，但快照仍要保留当前得分、
    // 篮球位置和倒计时；否则在这些阶段再次按 Esc 保存会把物理进度重置。
    if (state.physics
      && !['playing', 'loadingBackground', 'failed', 'winDialogue'].includes(phase)) {
      this.physics?.restoreSaveState?.(state.physics);
    }

    if (state.topdown && this.topdown) this.topdown.restoreSaveState(state.topdown);
    if (state.dialogue) this.dialogueBox?.restoreSaveState?.(state.dialogue);
    else if (phase !== 'choice' && phase !== 'failed') this.dialogueBox?.hide?.();
  }

  _restoreAimState(state) {
    this.isAiming = Boolean(state.isAiming);
    this.aimPointerId = null;
    this.aimPoint = state.aimPoint ? { ...state.aimPoint } : null;
    this.aimVector = state.aimVector ? { ...state.aimVector } : null;
    this.aimVelocity = state.aimVelocity ? { ...state.aimVelocity } : null;
  }

  /**
   * 每帧更新：按当前阶段分发到对应更新逻辑
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    this.animTime += Math.max(0, deltaTime);
    // 粒子系统始终更新（进球光效淡出动画）
    if (this.particles) this.particles.update(deltaTime);
    if (this.goalBurstEffect) this.goalBurstEffect.update(deltaTime);
    this.scorePulseTimer = Math.max(0, this.scorePulseTimer - Math.max(0, deltaTime));
    this.coachSprite?.update(deltaTime, 'idle', 1);

    switch (this.phase) {
      case 'dialogue':
        this.dialogueBox.update(deltaTime);
        break;
      case 'map':
        this.topdown?.update(deltaTime);
        if (this.gooseSprite) {
          this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
        }
        break;
      case 'playing':
        this._updatePlaying(deltaTime);
        if (this.gooseSprite) {
          this.gooseSprite.update(deltaTime, 'idle', this.blumgiMode
            ? this.gameplayPlayerFacing
            : (this.player?.facing || 1));
        }
        break;
      case 'winDialogue':
        this.dialogueBox.update(deltaTime);
        break;
      case 'failed':
        // 失败阶段无逐帧逻辑，等待玩家点击重试
        break;
      default:
        break;
    }
  }

  /**
   * 绘制：在 Canvas 上渲染背景、篮筐、球、蓄力条、计分、倒计时、反馈
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    if (this.phase === 'map' && this.topdown) {
      this._drawTopdownMap(ctx);
      return;
    }
    this._drawBackground(ctx);
    // 光效先画在游戏表现层，再画篮筐/篮球本体，保证反馈明显但不盖住关键交互对象。
    if (this.particles) this.particles.draw(ctx);
    if (this.goalBurstEffect) this.goalBurstEffect.draw(ctx);
    if (this.phase === 'playing') {
      this._drawHoop(ctx);
      this._drawGameplayPlayer(ctx);
    }
    this._drawTrajectoryGuide(ctx);
    this._drawBall(ctx);
    if (this.feedbackTimer > 0) {
      this._drawFeedback(ctx);
    }
    if (this.phase === 'playing' && this.blumgiMode) {
      this._drawBlumgiHud(ctx);
    }
  }

  /**
   * 场景退出：清理所有 DOM、事件监听、定时器
   */
  onExit() {
    // 移除事件总线监听
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 移除键盘监听
    this._removeKeyboardListeners();
    // 移除画布拖拽瞄准监听
    this._removeCanvasAimListeners();

    // 停止蓄力
    this.isCharging = false;
    this._setMobileActionVisible(true);
    this._setMobileActionLabel('互动');
    this.isAiming = false;
    this.aimPointerId = null;
    this.aimPoint = null;
    this.aimVector = null;
    this.aimVelocity = null;

    // 销毁蓄力条
    this._destroyChargeMeter();

    // 移除再来一局覆盖层
    this._removeRetryOverlay();

    // 移除抉择覆盖层
    this._hideChoiceOverlay();

    // 隐藏对话框（共享单例，仅隐藏不销毁）
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 重置状态
    this.physics = null;
    this.phase = 'idle';
    this.transitioning = false;
    this.feedbackText = '';
    this.feedbackTimer = 0;
    this.scorePulseTimer = 0;
    this.lastSyncedScore = 0;
    this.lastGoalEffectScore = 0;
    this.ballWasFlying = false;
    this.blumgiMode = false;
    this.blumgiLevelIndex = 0;
    this.gameplayPlayerPosition = { x: 320, y: 580 };
    this.gameplayPlayerFacing = 1;
    this.coachSprite?.clearAction();
    this.topdown?.destroy();
    this.topdown = null;
    this.topdownSpawn = null;
    this.backgroundImage = null;
    this.shootingBackgroundImage = null;
    this.backgroundLoadPromise = null;
    this.shootingBackgroundLoadPromise = null;
    this.objectAssetsPromise = null;
    this.objectImages = new Map();
    this.animTime = 0;
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
    if (this.goalBurstEffect) {
      this.goalBurstEffect.clear();
      this.goalBurstEffect = null;
    }
  }

  // ==================== 物理引擎创建 ====================

  /** 获取当前 Blumgi 风格短关卡配置。 */
  _getBlumgiLevel(index = this.blumgiLevelIndex) {
    return BLUMGI_LEVELS[Math.max(0, Math.min(index, BLUMGI_LEVEL_COUNT - 1))];
  }

  /**
   * 把当前物理引擎切换到参考版的固定篮筐/平台小关卡。
   * 总得分与倒计时保留在 BallPhysics 内，只替换本关的空间布局。
   * @param {number} index
   * @private
   */
  _configureBlumgiLevel(index = 0) {
    if (!this.physics) return;
    this.blumgiLevelIndex = Math.max(0, Math.min(index, BLUMGI_LEVEL_COUNT - 1));
    const level = this._getBlumgiLevel();
    this.physics.setLevel({
      ballStartX: level.start.x,
      ballStartY: level.start.y,
      hoopX: level.hoop.x,
      hoopY: level.hoop.y,
      floorY: level.floorY,
      hoopMotionEnabled: false,
      platforms: level.platforms,
    });
    this.gameplayPlayerPosition = {
      x: Math.max(72, level.start.x - 62),
      y: level.start.y,
    };
    this.gameplayPlayerFacing = 1;
    this.ballTrail = [];
    this.ballSpin = 0;
  }

  /**
   * 创建物理引擎实例（参数与 PRD §5 F5 及 BallPhysics 测试一致）
   * @private
   */
  _createPhysics() {
    this.physics = new BallPhysics({
      canvasWidth: GAME.WIDTH,
      canvasHeight: GAME.HEIGHT,
      hoopX: HOOP_X,
      gravity: GRAVITY,
      chargeRate: CHARGE_RATE,
      hoopRangeMin: HOOP_RANGE_MIN,
      hoopRangeMax: HOOP_RANGE_MAX,
      scoreThreshold: SCORE_WINDOW_HALF_WIDTH,
      ballStartX: GAMEPLAY_PLAYER_X,
      ballStartY: GAMEPLAY_PLAYER_Y,
      shotModel: 'sideview',
      scoreWindowHalfWidth: SCORE_WINDOW_HALF_WIDTH,
      hoopMotionEnabled: true,
    });
    this.ballTrail = [];
    this.ballSpin = 0;
    this.lastSyncedScore = 0;
    this.scorePulseTimer = 0;
    this.lastGoalEffectScore = 0;
  }

  /** 按需加载第一章地图与投篮背景，避免首屏加载整张章节美术。 */
  _loadAssets() {
    if (this.backgroundLoadPromise) return this.backgroundLoadPromise;

    this.backgroundLoadPromise = this._loadImage(BASKETBALL_SCENE_BACKGROUND_URL)
      .then((image) => {
        this.backgroundImage = image;
        return image;
      })
      .catch(() => null);

    return this.backgroundLoadPromise;
  }

  /** 投篮玩法的变体背景按需加载；加载期间继续使用标准球馆图。 */
  _loadShootingBackground() {
    if (this.shootingBackgroundImage) return Promise.resolve(this.shootingBackgroundImage);
    if (this.shootingBackgroundLoadPromise) return this.shootingBackgroundLoadPromise;

    this.shootingBackgroundLoadPromise = this._loadImage(BASKETBALL_SHOOTING_BACKGROUND_URL)
      .then((image) => {
        this.shootingBackgroundImage = image;
        return image;
      })
      .catch(() => null);

    return this.shootingBackgroundLoadPromise;
  }

  _loadSceneObjects() {
    if (this.objectAssetsPromise) return this.objectAssetsPromise;

    this.objectAssetsPromise = loadSceneObjectAssets(this.assetLoader, SCENE_OBJECT_ASSETS.basketball).then((images) => {
      this.objectImages = images;
      return images;
    });

    return this.objectAssetsPromise;
  }

  /** 统一通过共享 AssetLoader 加载，测试环境没有 Image 时安全降级。 */
  _loadImage(url) {
    if (this.assetLoader?.loadImage) {
      return this.assetLoader.loadImage(url);
    }

    if (typeof Image === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  // ==================== 游戏阶段更新 ====================

  /**
   * 游戏中阶段的逐帧更新
   * 顺序：篮筐浮动 → 蓄力 → 球物理 → 计时器 → 反馈 → 胜负判定
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updatePlaying(deltaTime) {
    // 先更新真实篮筐，再由 BallPhysics 用同一状态推进球和判定拦截。
    this.physics.updateHoop(deltaTime);

    // 蓄力：按住时持续增长
    if (this.isCharging && !this.physics.isBallFlying()) {
      this.physics.charge(deltaTime);
      this.chargeMeter.update(this.physics.getCharge());
    }

    // 球飞行物理更新
    if (this.physics.isBallFlying()) {
      this.physics.update(deltaTime);
      this.ballSpin += deltaTime * 8;
      this._recordBallTrail(this.physics.getBallPosition());
      // 物理层在穿筐当帧先递增分数，任务 HUD 立即读取同一个权威值。
      this._syncScoreProgress();
      if (this.physics.consumeScoreEvent()) {
        // 得分在穿过篮圈的当帧处理，不等待篮球落地或停止飞行。
        this.ballWasFlying = false;
        this._onBallScored();
      } else {
        this.ballWasFlying = true;
      }
    } else if (this.ballWasFlying) {
      // 球刚停止飞行（落地或出界），按投失处理；进球已在穿筐当帧处理。
      this.ballWasFlying = false;
      this._onBallLanded();
    }

    // 倒计时持续递减（失败判定会检查球未飞行，确保最后一球飞行中不被截断）
    this.physics.tickTimer(deltaTime);
    this._syncMiniGameHud();

    // 反馈文本倒计时
    if (this.feedbackTimer > 0) {
      this.feedbackTimer -= deltaTime;
    }

    // 胜利判定（优先于失败判定，确保最后一球进球算赢）
    if (this.physics.hasWon() && !this.transitioning) {
      this._startWinDialogue();
      return;
    }

    // 失败判定：时间到且球不在飞行中
    if (this.physics.isTimeUp() && !this.physics.isBallFlying() && !this.transitioning) {
      this._onGameFailed();
      return;
    }
  }

  // ==================== 阶段切换 ====================

  /**
   * 对话结束事件处理：根据当前阶段决定下一步
   * - dialogue 阶段结束 → 进入俯视球馆地图，等待靠近教练/投篮点互动
   * - winDialogue 阶段结束 → 发放印记 + 弹出剧情抉择
   * @param {Object} data - 事件数据，data.finished 为 true 表示整段对话结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'dialogue') {
      this._startTopdownMap();
    } else if (this.phase === 'winDialogue') {
      this._onWinDialogueFinished();
    }
  }

  /** 创建共享俯视入口；正式投篮仍在局部玩法层中运行。 */
  _createTopdown() {
    if (!this.player || !this.input?.getVector) return;
    const map = createBasketballMap();
    this.topdownSpawn = { ...map.playerStart };
    this.player.setPosition(map.playerStart.x, map.playerStart.y);
    this.topdown = new TopdownController({
      player: this.player,
      input: this.input,
      container: this.container,
      onInteract: (target) => this._onTopdownInteract(target),
      title: '第一章 · 篮球馆',
      objective: '靠近教练或投篮点，开始挑战',
    });
    this.topdown.setMap({
      ...map,
      interactables: map.interactables.map((target) => ({
        ...target,
        isCharacter: target.id === 'coach',
        hideMarker: target.id === 'shooting-spot',
        characterLabelOffset: target.id === 'coach' ? 112 : undefined,
        available: () => this.phase === 'map',
      })),
      playerRadius: 24,
    });
    this.topdown.mount();
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    this.topdown.setProgress(this._getScoreProgressText(0));
    this.topdown.setExitStatus('出口：完成挑战后继续');
  }

  /** 开场对话结束后开放自由移动，局部投篮仍通过互动进入。 */
  _startTopdownMap() {
    if (!this.topdown) {
      this._startMinigame();
      return;
    }
    this.phase = 'map';
    this.topdown.setSceneInfo('第一章 · 篮球馆', '靠近教练或投篮点，按互动开始投篮');
    this.topdown.setMovementLocked(false);
    this.topdown.setInteractionEnabled(true);
  }

  _onTopdownInteract(target) {
    if (this.phase !== 'map') return;
    if (target?.id === 'coach') {
      this.coachSprite?.playAction('signal', { facing: 1, restart: true });
    } else {
      this.coachSprite?.playAction('interact', { facing: 1, restart: true });
    }
    this._startMinigame();
  }

  /** 绘制正式篮球馆背景、真实教练和交互提示，不再绘制程序化球场占位。 */
  _drawTopdownMap(ctx) {
    this._drawBackground(ctx);
    // 球馆正式背景已经包含两侧篮架；自由移动阶段只保留透明互动热区，
    // 避免再叠加一张固定篮架或发光篮圈 PNG。
    this._drawCoach(ctx, 352, 396);
    // 资源未加载时不回退到椭圆人物；正式场景只允许真实角色贴图出现。
    this.gooseSprite?.draw(ctx, this.player.x, this.player.y);
    // 互动标签属于 UI，放在人物之后，避免被角色图层覆盖。
    this.topdown.drawInteractables(ctx, this.animTime);
    this.topdown.drawDebug(ctx, { spawn: this.topdownSpawn });
  }

  _drawCoach(ctx, x, y) {
    this.coachSprite?.draw(ctx, x, y, {
      width: 146,
      height: 146,
    });
  }

  /**
   * 启动小游戏：创建蓄力条、注册键盘监听、进入 playing 阶段
   * @private
   */
  _startMinigame() {
    this.topdown?.setMovementLocked(true);
    this.topdown?.setInteractionEnabled(false);
    this.transitioning = false;

    // 正式球馆图必须先完成加载，避免进入 60 秒投篮局后一直显示纯色兜底。
    if (this.backgroundLoadPromise && !this.backgroundImage) {
      this.phase = 'loadingBackground';
      this.backgroundLoadPromise.finally(() => {
        if (this.phase === 'loadingBackground') {
          this._enterPlaying();
        }
      });
      return;
    }

    this._enterPlaying();
  }

  /** 背景准备完成后真正开始投篮，保证小游戏首帧就有正式球馆画面。 */
  _enterPlaying() {
    // 投篮专用背景只在真正进入小游戏时加载，避免地图阶段同时解码两张大图。
    this._loadShootingBackground();
    this.phase = 'playing';
    this.blumgiMode = true;
    this._configureBlumgiLevel(0);
    this._setTopdownHudVisible(false);

    // 投篮阶段继续使用共享 HUD：左侧章节、中央当前目标、右侧进度/出口。
    // Canvas 不再另画一套左上计分板和右上倒计时，避免和共享 HUD 重叠。
    this.topdown?.setSceneInfo?.(
      '第一章 · 篮球馆',
      '投篮：拖拽篮球瞄准，松手发射；等待篮球落地后继续',
    );

    // 创建并挂载蓄力条
    this.chargeMeter = new ChargeMeter({
      onChargeStart: this._onChargeStart,
      onChargeRelease: this._onChargeRelease,
    });
    this.chargeMeter.mount(this.container);
    this.chargeMeter.update(0);
    // 保留旧组件实例，兼容失败后重试和旧测试；参考版画面不显示独立蓄力条。
    if (this.chargeMeter.element?.style) this.chargeMeter.element.style.display = 'none';
    this._syncScoreProgress(true);
    this._syncMiniGameHud();

    // 注册画布拖拽瞄准与空格键备用蓄力监听
    this._addCanvasAimListeners();
    this._addKeyboardListeners();
    // 投篮阶段必须由玩家拖拽篮球选择方向和力度。通用动作键不能调用
    // BallPhysics 的默认瞄准路线，否则手机上会变成“点一下就自动进球”。
    this._setMobileActionVisible(false);
  }

  /**
   * 开始过关对话：销毁游戏 UI、播放过关对话
   * @private
   */
  _startWinDialogue() {
    this.transitioning = true;
    this.phase = 'winDialogue';
    this.blumgiMode = false;
    this._setTopdownHudVisible(true);
    this.topdown?.setSceneInfo?.('第一章 · 篮球馆', '投篮完成，进入剧情对话');
    this.topdown?.setExitStatus?.('出口：章节完成');

    // 停止蓄力并清理游戏 UI
    this.isCharging = false;
    this._removeKeyboardListeners();
    this._removeCanvasAimListeners();
    this._setMobileActionVisible(true);
    this._setMobileActionLabel('互动');
    this._destroyChargeMeter();

    // 播放过关对话
    this.dialogueBox.show(WIN_LINES);
  }

  /**
   * 过关对话结束：发放印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onWinDialogueFinished() {
    this._completeChapter();
  }

  /**
   * 完成篮球馆章节：成功与失败后领取纪念共用同一条正式剧情出口。
   * 这样小游戏结果只影响挑战反馈，不会阻断章节完成、抉择或后续场景。
   * @private
   */
  _completeChapter() {
    this.transitioning = false;
    this.phase = 'choice';
    this.badgeSystem.unlockOrReveal('basketball');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch1' });
    // 发放沿途印记后弹出抉择，玩家选择"留下"或"继续探寻"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下训练"或"继续探寻"
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

  /**
   * 游戏失败：时间到未进 5 球。
   * 销毁游戏 UI，显示失败结算；玩家可以领取篮球纪念并继续正式剧情，
   * 也可以选择再来一局挑战 5 球目标。
   * @private
   */
  _onGameFailed() {
    this.transitioning = true;
    this.phase = 'failed';
    this.blumgiMode = false;
    this._setTopdownHudVisible(true);
    this.topdown?.setSceneInfo?.('第一章 · 篮球馆', '投篮挑战结束');
    this.topdown?.setExitStatus?.('出口：选择继续剧情或再来一局');

    this.isCharging = false;
    this._removeKeyboardListeners();
    this._removeCanvasAimListeners();
    this._setMobileActionVisible(true);
    this._setMobileActionLabel('互动');
    this._destroyChargeMeter();
    this._showRetryOverlay();
  }

  // ==================== 球落地处理 ====================

  /**
   * 球穿过篮圈后的即时反馈处理。
   * 物理引擎已在穿筐当帧递增得分，这里只负责反馈和复位篮球。
   * @private
   */
  _onBallScored() {
    if (!this.physics) return;
    const score = this.physics.getScore();
    // BallPhysics 已按飞行去重；场景侧再以权威得分做一道幂等保护，避免
    // 同一次穿筐事件被重复消费时重复播放音效、动作和视觉反馈。
    if (!Number.isFinite(score) || score <= this.lastGoalEffectScore) return;

    // 必须在切换 Blumgi 关卡前保存本次进球篮筐坐标；后续所有主效果都使用
    // 这份快照，不能读取 _advanceBlumgiLevel() 之后的新篮筐位置。
    const scoredHoop = { ...this.physics.getHoopPosition() };
    this.lastGoalEffectScore = score;
    this._syncScoreProgress();
    this.feedbackText = SCORE_FEEDBACK_TEXT;
    this.gooseSprite?.playAction('celebrate', { facing: 1 });
    // 进球音效 + 光效粒子（对应 PRD §7.7 进球光效）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'goal' });
    if (this.particles) {
      this.particles.emit(scoredHoop.x, scoredHoop.y, 'sparkle');
    }
    if (this.goalBurstEffect) {
      this.goalBurstEffect.play({
        x: scoredHoop.x,
        y: scoredHoop.y,
        enhanced: score >= TARGET_SCORE,
      });
    }
    this.feedbackTimer = FEEDBACK_DURATION;
    if (this.blumgiMode) {
      this._advanceBlumgiLevel();
    } else {
      this._resetBallAfterShot();
    }
  }

  /**
   * 球落地或出界后的投失反馈处理，并回到当前短关卡起点。
   * @private
   */
  _onBallLanded() {
    this.feedbackText = MISS_FEEDBACK_TEXT;
    // 投失音效
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'miss' });
    this.feedbackTimer = FEEDBACK_DURATION;
    this._resetBallAfterShot();
  }

  /** 进球后进入下一组平台/篮筐布局，最后一球仍由统一胜利判定收尾。 */
  _advanceBlumgiLevel() {
    if (!this.physics) return;
    const nextIndex = Math.min(this.physics.getScore(), BLUMGI_LEVEL_COUNT - 1);
    this._configureBlumgiLevel(nextIndex);
  }

  /**
   * 结束一轮投篮并把篮球放回起点，保证进球和投失走同一套复位流程。
   * @private
   */
  _resetBallAfterShot() {
    // BallPhysics.setLevel 已把当前小关卡起点写入 resetBall，投失后统一回到这里。
    this.physics.resetBall();
    this.ballTrail = [];
    this.ballSpin = 0;
    if (this.chargeMeter) {
      this.chargeMeter.update(0);
    }
  }

  /** 记录少量飞行位置，避免残影造成过多 Canvas 开销。 */
  _recordBallTrail(position) {
    if (!position) return;
    this.ballTrail.push({ x: position.x, y: position.y });
    if (this.ballTrail.length > 8) {
      this.ballTrail.shift();
    }
  }

  /** 生成统一的进球进度文本，避免不同 HUD 层出现不同步的计数。 */
  _getScoreProgressText(score = this.physics?.getScore?.() || 0) {
    return '挑战目标：进球 ' + Math.max(0, score) + ' / ' + TARGET_SCORE;
  }

  /**
   * 同步 Canvas 计分、俯视任务进度和变化反馈。
   * 计数只从 BallPhysics 读取，场景不再维护第二个可漂移的得分来源。
   * @param {boolean} force - 即使数值未变化也刷新一次任务提示
   */
  _syncScoreProgress(force = false) {
    if (!this.physics) return;
    const score = this.physics.getScore();
    if (!force && score === this.lastSyncedScore) return;

    if (score > this.lastSyncedScore) {
      this.scorePulseTimer = 0.8;
    }
    this.lastSyncedScore = score;
    this.topdown?.setProgress(this._getScoreProgressText(score));
  }

  /**
   * 将小游戏倒计时放入共享 HUD 的出口状态行，避免在 Canvas 右上角再画一层。
   * @private
   */
  _syncMiniGameHud() {
    if (!this.physics || !this.topdown?.setExitStatus) return;
    this.topdown.setExitStatus(
      '出口：完成挑战后继续 · 剩余 ' + Math.ceil(this.physics.getTimer()) + 's',
    );
  }

  /**
   * 投篮小游戏进入参考版的纯画布呈现时隐藏共享俯视 HUD；退出后恢复，
   * 让地图阶段继续使用项目原有的章节信息和出口提示。
   * @param {boolean} visible
   * @private
   */
  _setTopdownHudVisible(visible) {
    if (!this.topdown?.domRoot?.style) return;
    this.topdown.domRoot.style.display = visible ? '' : 'none';
  }

  // ==================== 拖拽瞄准与出手 ====================

  /**
   * 备用蓄力开始（空格 keydown 或 ChargeMeter 备用按钮 pointerdown 触发）。
   * 主路径是画布上的拖拽瞄准；键盘路径继续保留，方便桌面调试和无指针设备。
   * @private
   */
  _onChargeStart() {
    if (this.phase !== 'playing') return;
    if (!this.physics || this.physics.isBallFlying() || this.isAiming) return;
    this.isCharging = true;
    this.aimVelocity = null;
    this.aimPoint = null;
    this.aimVector = null;
  }

  /**
   * 备用蓄力释放出手（空格 keyup 或 ChargeMeter 备用按钮 pointerup 触发）。
   * @private
   */
  _onChargeRelease() {
    if (!this.isCharging) return;
    this.isCharging = false;
    this._shootBall();
  }

  /**
   * 统一出手入口：拖拽路径传入向量，备用路径不传则使用原有侧视模型。
   * @param {{vx:number,vy:number}|null} [velocity]
   * @returns {boolean} 是否真的发射
   * @private
   */
  _shootBall(velocity = null) {
    if (this.phase !== 'playing' || !this.physics || this.physics.isBallFlying()) return false;

    const customVelocity = velocity
      && Number.isFinite(velocity.vx)
      && Number.isFinite(velocity.vy)
      ? { vx: velocity.vx, vy: velocity.vy }
      : null;
    this.physics.throwBall(customVelocity ? { velocity: customVelocity } : undefined);
    this.ballTrail = [];
    this.ballSpin = 0;
    this.gooseSprite?.playAction('throw', {
      facing: 1,
      restart: true,
      resetCoreFrame: true,
    });

    if (this.chargeMeter) {
      this.chargeMeter.update(0);
    }
    return true;
  }

  /** 更新移动端动作键在对白/地图/投篮阶段的语义标签。 */
  _setMobileActionLabel(label) {
    const actionElement = this.container?.ownerDocument?.querySelector?.('[data-joystick-interact]');
    if (!actionElement) return;
    actionElement.textContent = label;
    actionElement.setAttribute('aria-label', label);
  }

  /**
   * 投篮阶段收起通用动作键，避免它绕过拖拽瞄准替玩家走预设路线。
   * VirtualJoystick 会读取这个标记；这里不直接依赖摇杆实例，兼容桌面端
   * 没有虚拟摇杆和单元测试只注入普通容器的场景。
   * @param {boolean} visible
   */
  _setMobileActionVisible(visible) {
    const actionElement = this.container?.ownerDocument?.querySelector?.('[data-joystick-interact]');
    if (!actionElement) return;
    if (visible) {
      actionElement.removeAttribute('data-joystick-action-suppressed');
      actionElement.hidden = false;
      actionElement.disabled = false;
      actionElement.setAttribute('aria-hidden', 'false');
      return;
    }
    actionElement.setAttribute('data-joystick-action-suppressed', '');
    actionElement.hidden = true;
    actionElement.disabled = true;
    actionElement.setAttribute('aria-hidden', 'true');
  }

  // ==================== 画布拖拽输入 ====================

  /** 注册拖拽瞄准事件；只在投篮阶段启用，退出时恢复原画布样式。 */
  _addCanvasAimListeners() {
    if (!this.canvas) return;
    this.canvas.addEventListener('pointerdown', this._onCanvasPointerDown);
    this.canvas.addEventListener('pointermove', this._onCanvasPointerMove);
    this.canvas.addEventListener('pointerup', this._onCanvasPointerUp);
    this.canvas.addEventListener('pointercancel', this._onCanvasPointerCancel);
    this.previousCanvasTouchAction = this.canvas.style?.touchAction || '';
    if (this.canvas.style) this.canvas.style.touchAction = 'none';
  }

  /** 移除拖拽瞄准事件，避免场景切换后旧场景继续响应指针。 */
  _removeCanvasAimListeners() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this._onCanvasPointerDown);
      this.canvas.removeEventListener('pointermove', this._onCanvasPointerMove);
      this.canvas.removeEventListener('pointerup', this._onCanvasPointerUp);
      this.canvas.removeEventListener('pointercancel', this._onCanvasPointerCancel);
      if (this.canvas.style) this.canvas.style.touchAction = this.previousCanvasTouchAction;
    }
    this._clearAimState();
  }

  /** 将浏览器 CSS 像素转换为 1280×720 逻辑坐标，兼容 DPR 与横屏缩放。 */
  _getCanvasPoint(event) {
    const rect = this.canvas?.getBoundingClientRect?.();
    const width = rect?.width || GAME.WIDTH;
    const height = rect?.height || GAME.HEIGHT;
    const left = rect?.left || 0;
    const top = rect?.top || 0;
    return {
      x: ((event.clientX - left) / width) * GAME.WIDTH,
      y: ((event.clientY - top) / height) * GAME.HEIGHT,
    };
  }

  /** 判断指针是否属于当前拖拽，避免多指/旧指针触发第二次释放。 */
  _isAimPointer(event) {
    return this.aimPointerId === null || event.pointerId === this.aimPointerId;
  }

  /** 从指针位置更新弹射向量、力度条和预览轨迹。 */
  _updateAimFromPoint(point) {
    if (!this.physics) return;
    const ball = this.physics.getBallPosition();
    const dx = point.x - ball.x;
    const dy = point.y - ball.y;
    const distance = Math.hypot(dx, dy);
    this.aimPoint = point;
    this.aimVector = { dx, dy, distance };

    if (distance < AIM_MIN_DRAG_DISTANCE) {
      this.aimVelocity = null;
      this.physics.setCharge(0);
      this.chargeMeter?.update(0);
      return;
    }

    this.aimVelocity = this.physics.getLaunchVelocityFromAim({ dx, dy });
    this.physics.setCharge(this.aimVelocity.power);
    this.chargeMeter?.update(this.aimVelocity.power);
  }

  /** 开始拖拽：必须从篮球附近按下，避免误触背景直接出手。 */
  _onCanvasPointerDown(event) {
    if (this.phase !== 'playing' || !this.physics || this.physics.isBallFlying()) return;
    const point = this._getCanvasPoint(event);
    const ball = this.physics.getBallPosition();
    const hitRadius = Math.max(AIM_HIT_RADIUS, this.physics.getBallRadius() + AIM_HIT_PADDING);
    if (Math.hypot(point.x - ball.x, point.y - ball.y) > hitRadius) return;

    event.preventDefault?.();
    this.isAiming = true;
    this.aimPointerId = event.pointerId ?? null;
    this.aimVelocity = null;
    this._updateAimFromPoint(point);
    try {
      this.canvas?.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // 某些测试/嵌入环境不支持 pointer capture，依赖画布和 window 的后续事件即可。
    }
  }

  /** 拖拽过程中实时更新方向、力度和预测轨迹。 */
  _onCanvasPointerMove(event) {
    if (!this.isAiming || !this._isAimPointer(event)) return;
    event.preventDefault?.();
    this._updateAimFromPoint(this._getCanvasPoint(event));
  }

  /** 松手发射；短距离释放视为取消，不消耗一次投篮。 */
  _onCanvasPointerUp(event) {
    if (!this.isAiming || !this._isAimPointer(event)) return;
    event.preventDefault?.();
    this._updateAimFromPoint(this._getCanvasPoint(event));
    const velocity = this.aimVector?.distance >= AIM_MIN_DRAG_DISTANCE ? this.aimVelocity : null;
    this._releaseCanvasPointer(event);
    this._clearAimState();
    if (velocity) this._shootBall(velocity);
  }

  /** 指针被系统打断时取消当前瞄准，不发射。 */
  _onCanvasPointerCancel(event) {
    if (!this.isAiming || !this._isAimPointer(event)) return;
    event.preventDefault?.();
    this._releaseCanvasPointer(event);
    this._clearAimState();
  }

  /** 释放 pointer capture（如果浏览器支持）。 */
  _releaseCanvasPointer(event) {
    try {
      this.canvas?.releasePointerCapture?.(event.pointerId);
    } catch (_error) {
      // pointer capture 不是所有运行环境都实现，清理监听状态即可。
    }
  }

  /** 清除当前拖拽状态，但不影响物理引擎已经发射的篮球。 */
  _clearAimState() {
    this.isAiming = false;
    this.aimPointerId = null;
    this.aimPoint = null;
    this.aimVector = null;
    this.aimVelocity = null;
    if (this.physics && !this.physics.isBallFlying()) {
      this.physics.setCharge(0);
      this.chargeMeter?.update(0);
    }
  }

  // ==================== 键盘监听 ====================

  /**
   * 注册空格键 keydown/keyup 监听
   * InputManager 仅在 keydown 时触发 interact，不提供 keyup，
   * 因此场景自行监听空格键的按下与释放以实现蓄力机制
   * @private
   */
  _addKeyboardListeners() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /**
   * 移除空格键监听
   * @private
   */
  _removeKeyboardListeners() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  /**
   * keydown：传统兼容路径使用空格蓄力；Blumgi 拖拽玩法仅阻止页面滚动。
   * e.repeat 防止按住时重复触发
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyDown(e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    // 阻止空格键滚动页面
    e.preventDefault();
    if (e.repeat) return;
    if (this.blumgiMode) return;
    this._onChargeStart();
  }

  /**
   * keyup：空格键释放出手
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyUp(e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    e.preventDefault();
    if (!this.blumgiMode) this._onChargeRelease();
  }

  // ==================== 蓄力条管理 ====================

  /**
   * 销毁蓄力条组件
   * @private
   */
  _destroyChargeMeter() {
    if (this.chargeMeter) {
      this.chargeMeter.destroy();
      this.chargeMeter = null;
    }
  }

  // ==================== 再来一局覆盖层 ====================

  /**
   * 显示失败结算覆盖层（DOM）
   * 包含篮球纪念领取按钮与可选的"再来一局"按钮
   * @private
   */
  _showRetryOverlay() {
    this.retryOverlay = document.createElement('div');
    this.retryOverlay.setAttribute('data-retry-overlay', '');
    this.retryOverlay.style.cssText = `
      position: fixed; inset: 0; z-index: 300;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 24px; background: rgba(0,0,0,0.75); pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = '时间到！';
    title.style.cssText = `
      font-size: 36px; color: #f87171; font-family: inherit; font-weight: bold;
    `;

    const subtitle = document.createElement('div');
    const score = this.physics ? this.physics.getScore() : 0;
    subtitle.textContent = '本轮进球 ' + score + ' / ' + TARGET_SCORE;
    subtitle.style.cssText = `
      font-size: 18px; color: #cbd5e1; font-family: inherit;
    `;

    const note = document.createElement('div');
    note.textContent = '没关系，教练把篮球场的纪念也送给你。';
    note.style.cssText = `
      font-size: 16px; color: #fcd34d; font-family: inherit;
    `;

    const actionRow = document.createElement('div');
    actionRow.style.cssText = `
      display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;
    `;

    this.souvenirButton = document.createElement('button');
    this.souvenirButton.setAttribute('data-souvenir-continue', '');
    this.souvenirButton.textContent = '收下纪念，继续剧情';
    applyButtonStyle(this.souvenirButton, { variant: 'primary', size: 'lg' });
    this.souvenirButton.addEventListener('click', this._onFailureContinue);

    this.retryButton = document.createElement('button');
    this.retryButton.setAttribute('data-retry-button', '');
    this.retryButton.textContent = '再来一局';
    applyButtonStyle(this.retryButton, { variant: 'secondary', size: 'lg' });
    this.retryButton.addEventListener('click', this._onRetryClick);

    this.retryOverlay.appendChild(title);
    this.retryOverlay.appendChild(subtitle);
    this.retryOverlay.appendChild(note);
    actionRow.appendChild(this.souvenirButton);
    actionRow.appendChild(this.retryButton);
    this.retryOverlay.appendChild(actionRow);

    this.container.appendChild(this.retryOverlay);
  }

  /**
   * 移除再来一局覆盖层
   * @private
   */
  _removeRetryOverlay() {
    if (this.souvenirButton) {
      this.souvenirButton.removeEventListener('click', this._onFailureContinue);
      this.souvenirButton = null;
    }
    if (this.retryButton) {
      this.retryButton.removeEventListener('click', this._onRetryClick);
      this.retryButton = null;
    }
    if (this.retryOverlay && this.retryOverlay.parentNode) {
      this.retryOverlay.parentNode.removeChild(this.retryOverlay);
    }
    this.retryOverlay = null;
  }

  /**
   * 再来一局按钮点击：移除覆盖层、重置游戏、重新进入 playing 阶段
   * @private
   */
  _onRetryClick() {
    // 防连点
    if (!this.transitioning) return;

    this._removeRetryOverlay();
    this.transitioning = false;

    // 重置物理引擎与游戏状态
    this._createPhysics();
    this.isCharging = false;
    this.ballWasFlying = false;
    this.feedbackText = '';
    this.feedbackTimer = 0;

    // 直接进入小游戏（不重播开场对话）
    this._startMinigame();
  }

  /**
   * 失败后领取篮球纪念并进入正式剧情。
   * @private
   */
  _onFailureContinue() {
    if (this.phase !== 'failed' || !this.transitioning) return;

    this._removeRetryOverlay();

    this.topdown?.destroy();
    this.topdown = null;
    this._completeChapter();
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制当前阶段的正式篮球馆背景；投篮阶段切换到移除静态右侧篮架的版本。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    if (this.phase === 'playing' && this.blumgiMode) {
      this._drawBlumgiArena(ctx);
      return;
    }

    const backgroundImage = this.phase === 'playing'
      ? (this.shootingBackgroundImage || this.backgroundImage)
      : this.backgroundImage;

    if (backgroundImage) {
      // 资源按逻辑画布完整绘制；CSS/DPR 缩放由 ViewportAdapter 统一处理。
      ctx.drawImage(backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 给顶部 HUD 留出稳定的深色可读区域，同时保留球馆灯光和墙面细节。
      const hudShade = ctx.createLinearGradient(0, 0, 0, 118);
      hudShade.addColorStop(0, 'rgba(5, 12, 24, .72)');
      hudShade.addColorStop(1, 'rgba(5, 12, 24, 0)');
      ctx.fillStyle = hudShade;
      ctx.fillRect(0, 0, GAME.WIDTH, 130);
      return;
    }

    // 这只是加载瞬间的纯色，不含任何地板、看台、篮架或人物占位。
    ctx.fillStyle = '#15243b';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /**
   * 绘制完整的投篮舞台：正式篮球馆底图 + Blumgi 风格平台关卡叠层。
   * 关卡几何来自 BLUMGI_LEVELS，和 BallPhysics 的平台碰撞共用同一份数据。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBlumgiArena(ctx) {
    const level = this._getBlumgiLevel();
    const backgroundImage = this.shootingBackgroundImage || this.backgroundImage;

    if (backgroundImage) {
      // 投篮阶段复用已验收的正式球馆图，平台和动态篮筐只作为玩法前景叠加。
      ctx.drawImage(backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 每关保留一点 Blumgi 的色彩变化，同时不盖住窗户、看台和木地板细节。
      const levelTint = [
        'rgba(255, 186, 140, 0.13)',
        'rgba(147, 197, 253, 0.12)',
        'rgba(253, 224, 71, 0.10)',
        'rgba(110, 231, 183, 0.11)',
        'rgba(216, 180, 254, 0.12)',
      ][this.blumgiLevelIndex % 5];
      ctx.fillStyle = levelTint;
      ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 顶部做一层很轻的暗角，保证白色关卡 HUD 在窗户和灯光上也清楚。
      const hudShade = ctx.createLinearGradient(0, 0, 0, 142);
      hudShade.addColorStop(0, 'rgba(8, 20, 34, 0.56)');
      hudShade.addColorStop(1, 'rgba(8, 20, 34, 0)');
      ctx.fillStyle = hudShade;
      ctx.fillRect(0, 0, GAME.WIDTH, 160);
    } else {
      // 图片加载失败时保留可玩的渐变兜底，不把背景加载问题变成纯黑画面。
      const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
      gradient.addColorStop(0, level.palette[0]);
      gradient.addColorStop(1, level.palette[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 仅在无正式球馆图时绘制云团，避免云朵盖在室内窗户和看台上。
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#fff7ed';
      for (const cloud of [
        { x: 120, y: 164, width: 160, height: 42 },
        { x: 720, y: 112, width: 210, height: 52 },
        { x: 1000, y: 520, width: 180, height: 38 },
      ]) {
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, cloud.width / 2, cloud.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    for (const [platformIndex, platform] of level.platforms.entries()) {
      const isGround = platform.y >= level.floorY;
      if (isGround) {
        this._drawBlumgiGround(ctx, platform);
      } else {
        // 浮台的顶部仍然严格落在 platform.y，和 BallPhysics 的顶面碰撞线保持一致。
        this._drawBlumgiObstacle(ctx, platform, platformIndex);
      }
    }

    // 底部保留一条半透明的水面/安全区，让篮球落地和浮台边界更容易辨认。
    ctx.fillStyle = backgroundImage ? 'rgba(30, 91, 119, 0.48)' : 'rgba(58, 139, 174, 0.34)';
    ctx.fillRect(0, level.floorY + 30, GAME.WIDTH, GAME.HEIGHT - level.floorY - 30);
    ctx.fillStyle = 'rgba(219, 245, 255, 0.18)';
    ctx.fillRect(0, level.floorY + 30, GAME.WIDTH, 4);
    ctx.strokeStyle = 'rgba(219, 245, 255, 0.52)';
    ctx.lineWidth = 2;
    for (let x = 24; x < GAME.WIDTH; x += 96) {
      ctx.beginPath();
      ctx.moveTo(x, level.floorY + 52);
      ctx.quadraticCurveTo(x + 24, level.floorY + 44, x + 48, level.floorY + 52);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 绘制 Blumgi 关卡里的浮动训练障碍物。
   * 这里只改变表现层，碰撞仍然使用 platform 的原始矩形顶边，不新增侧面碰撞。
   */
  _drawBlumgiObstacle(ctx, platform, obstacleIndex) {
    const radius = Math.min(10, platform.height / 2);
    const accents = [
      { main: '#fb7185', light: '#ffe4e6', dark: '#be123c' },
      { main: '#38bdf8', light: '#e0f2fe', dark: '#0369a1' },
      { main: '#a78bfa', light: '#ede9fe', dark: '#6d28d9' },
      { main: '#34d399', light: '#d1fae5', dark: '#047857' },
      { main: '#f59e0b', light: '#fef3c7', dark: '#b45309' },
    ];
    const accent = accents[(this.blumgiLevelIndex + obstacleIndex) % accents.length];
    const supportTop = platform.y + platform.height - 2;
    const supportBottom = supportTop + 34;
    const leftSupport = platform.x + Math.max(22, platform.width * 0.16);
    const rightSupport = platform.x + platform.width - Math.max(22, platform.width * 0.16);

    // 先画隐藏在台面下方的斜撑，让浮台看起来像训练馆里的可移动软垫平台。
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(15, 46, 68, 0.58)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(leftSupport, supportTop);
    ctx.lineTo(leftSupport + 17, supportBottom);
    ctx.moveTo(rightSupport, supportTop);
    ctx.lineTo(rightSupport - 17, supportBottom);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.54)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(leftSupport + 1, supportTop + 2);
    ctx.lineTo(leftSupport + 17, supportBottom - 2);
    ctx.moveTo(rightSupport - 1, supportTop + 2);
    ctx.lineTo(rightSupport - 17, supportBottom - 2);
    ctx.stroke();
    ctx.fillStyle = accent.dark;
    for (const supportX of [leftSupport + 17, rightSupport - 17]) {
      ctx.beginPath();
      ctx.arc(supportX, supportBottom, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 柔和投影把平台从正式球馆木地板中托出来。
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.34)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 8;
    this._roundedRectPath(ctx, platform.x, platform.y, platform.width, platform.height, radius);
    ctx.fillStyle = 'rgba(226, 244, 251, 0.98)';
    ctx.fill();
    ctx.restore();

    const bodyGradient = ctx.createLinearGradient(0, platform.y, 0, platform.y + platform.height);
    bodyGradient.addColorStop(0, '#f8fdff');
    bodyGradient.addColorStop(0.34, accent.light);
    bodyGradient.addColorStop(1, '#b6d9e8');
    this._roundedRectPath(ctx, platform.x, platform.y, platform.width, platform.height, radius);
    ctx.fillStyle = bodyGradient;
    ctx.fill();

    // 顶部软垫色带的第一条像素仍在 platform.y，正好对应物理顶面。
    const cushionGradient = ctx.createLinearGradient(0, platform.y, 0, platform.y + 8);
    cushionGradient.addColorStop(0, accent.light);
    cushionGradient.addColorStop(1, accent.main);
    this._roundedRectPath(ctx, platform.x, platform.y, platform.width, Math.min(9, platform.height), radius);
    ctx.fillStyle = cushionGradient;
    ctx.fill();

    // 前沿深色包边和中央面板，给窄平台增加厚度、分件和方向感。
    ctx.save();
    ctx.globalAlpha = 0.62;
    this._roundedRectPath(
      ctx,
      platform.x + 3,
      platform.y + platform.height - 6,
      Math.max(0, platform.width - 6),
      5,
      2,
    );
    ctx.fillStyle = accent.dark;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2;
    this._roundedRectPath(ctx, platform.x, platform.y, platform.width, platform.height, radius);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.74)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(platform.x + radius + 5, platform.y + 4);
    ctx.lineTo(platform.x + platform.width - radius - 5, platform.y + 4);
    ctx.stroke();

    const panelLeft = platform.x + platform.width * 0.30;
    const panelRight = platform.x + platform.width * 0.70;
    ctx.strokeStyle = 'rgba(28, 76, 101, 0.20)';
    ctx.lineWidth = 1;
    for (const panelX of [panelLeft, panelRight]) {
      ctx.beginPath();
      ctx.moveTo(panelX, platform.y + 10);
      ctx.lineTo(panelX, platform.y + platform.height - 8);
      ctx.stroke();
    }

    // 两枚彩色铆钉和一条小型训练馆警示条，避免所有障碍物变成同一块白色矩形。
    ctx.fillStyle = accent.main;
    for (const boltX of [platform.x + 13, platform.x + platform.width - 13]) {
      ctx.beginPath();
      ctx.arc(boltX, platform.y + platform.height / 2 + 1, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillRect(platform.x + platform.width / 2 - 20, platform.y + 11, 9, 3);
    ctx.fillRect(platform.x + platform.width / 2 - 7, platform.y + 11, 9, 3);
    ctx.fillRect(platform.x + platform.width / 2 + 6, platform.y + 11, 9, 3);
  }

  /** 绘制底部安全平台；它保持整段地面碰撞矩形，但视觉上与浮台统一。 */
  _drawBlumgiGround(ctx, platform) {
    const groundGradient = ctx.createLinearGradient(0, platform.y, 0, platform.y + platform.height);
    groundGradient.addColorStop(0, 'rgba(59, 130, 155, 0.88)');
    groundGradient.addColorStop(1, 'rgba(19, 65, 89, 0.82)');
    ctx.fillStyle = groundGradient;
    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);

    ctx.fillStyle = 'rgba(219, 245, 255, 0.72)';
    ctx.fillRect(platform.x, platform.y, platform.width, 7);
    ctx.fillStyle = 'rgba(9, 45, 67, 0.38)';
    ctx.fillRect(platform.x, platform.y + 7, platform.width, 4);
    ctx.strokeStyle = 'rgba(231, 250, 255, 0.72)';
    ctx.lineWidth = 2;
    ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);

    ctx.strokeStyle = 'rgba(186, 230, 253, 0.22)';
    ctx.lineWidth = 1;
    for (let x = platform.x + 36; x < platform.x + platform.width; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, platform.y + 16);
      ctx.lineTo(x, platform.y + platform.height - 8);
      ctx.stroke();
    }
  }

  /** 兼容 Canvas 2D 的圆角路径，避免依赖特定浏览器版本的 roundRect。 */
  _roundedRectPath(ctx, x, y, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  /** 绘制与物理篮圈同步的篮架；Blumgi 模式使用轻量矢量篮筐。 */
  _drawHoop(ctx) {
    if (!this.physics) return;

    if (this.blumgiMode) {
      this._drawBlumgiHoop(ctx);
      return;
    }

    const hoop = this.physics.getHoopPosition();
    drawSceneObject(ctx, this.objectImages.get('hoop'), {
      x: hoop.x,
      y: hoop.y + 190,
      width: 154,
      height: 282,
      anchorX: 0.5,
      anchorY: 1,
      alpha: 0.98,
    }, {
      fallbackColor: SCENE_OBJECT_ASSETS.basketball.hoop.fallbackColor,
    });
  }

  /**
   * 绘制完整的侧视篮架：篮板、篮板框、支柱、篮圈和篮网。
   * 所有关键坐标直接读取 BallPhysics 的碰撞几何，避免“看得到但撞不到”。
   */
  _drawBlumgiHoop(ctx) {
    const geometry = this.physics.getCollisionGeometry();
    const hoop = this.physics.getHoopPosition();
    const { backboard, rim } = geometry;
    const boardWidth = backboard.right - backboard.left;
    const boardHeight = backboard.bottom - backboard.top;
    const poleWidth = 24;
    const poleX = backboard.right + 34;
    const poleBottom = Math.min(geometry.floorY - 8, hoop.y + 330);

    ctx.save();

    // 支柱、底座和斜撑：先画在篮板后面，形成完整篮架的纵深关系。
    ctx.fillStyle = 'rgba(25, 38, 62, 0.36)';
    ctx.fillRect(poleX + 8, hoop.y + 18, poleWidth, Math.max(40, poleBottom - hoop.y - 18));
    ctx.fillStyle = '#334155';
    ctx.fillRect(poleX, hoop.y + 8, poleWidth, Math.max(40, poleBottom - hoop.y - 8));
    ctx.fillStyle = '#64748b';
    ctx.fillRect(poleX + 4, hoop.y + 12, 6, Math.max(32, poleBottom - hoop.y - 18));
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(poleX - 18, poleBottom - 2, poleWidth + 36, 14);

    ctx.strokeStyle = 'rgba(30, 41, 59, 0.86)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(poleX + 8, hoop.y + 42);
    ctx.lineTo(backboard.right + 2, hoop.y - 6);
    ctx.stroke();

    // 篮板阴影、面板和外框；物理碰撞矩形与这个面板完全重合。
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.fillRect(backboard.left + 8, backboard.top + 8, boardWidth, boardHeight);
    const boardGradient = ctx.createLinearGradient(backboard.left, 0, backboard.right, 0);
    boardGradient.addColorStop(0, '#f8fafc');
    boardGradient.addColorStop(0.5, '#dbeafe');
    boardGradient.addColorStop(1, '#94a3b8');
    ctx.fillStyle = boardGradient;
    ctx.fillRect(backboard.left, backboard.top, boardWidth, boardHeight);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.strokeRect(backboard.left, backboard.top, boardWidth, boardHeight);

    // 篮板上的小矩形目标框，让投向篮板的反弹路线更直观。
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(backboard.left - 5, hoop.y - 42, boardWidth + 10, 58);
    ctx.strokeStyle = 'rgba(255,255,255,0.84)';
    ctx.lineWidth = 1;
    ctx.strokeRect(backboard.left - 1, hoop.y - 38, boardWidth + 2, 50);

    // 篮圈使用外圈 + 高光两层线条，和物理 rim.front/back 两个碰撞点一致。
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rim.front.x, rim.front.y);
    ctx.lineTo(rim.back.x, rim.back.y);
    ctx.stroke();
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rim.front.x, rim.front.y - 1);
    ctx.lineTo(rim.back.x, rim.back.y - 1);
    ctx.stroke();

    // 篮网从两侧向下收口，避免只画一条弧线显得像悬空横杠。
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let index = 0; index <= 6; index += 1) {
      const ratio = index / 6;
      const topX = rim.front.x + (rim.back.x - rim.front.x) * ratio;
      const bottomX = hoop.x - 22 + 44 * ratio;
      ctx.beginPath();
      ctx.moveTo(topX, rim.front.y + 5);
      ctx.lineTo(bottomX, rim.front.y + 52);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(hoop.x - 22, rim.front.y + 52);
    ctx.quadraticCurveTo(hoop.x, rim.front.y + 62, hoop.x + 22, rim.front.y + 52);
    ctx.stroke();

    // 篮圈后侧的连接套筒，强化篮板与篮圈的装配关系。
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(backboard.left - 3, rim.front.y - 7, 12, 14);

    ctx.restore();
  }

  /**
   * 绘制投篮抛物线辅助：静止球/蓄力时显示蓝色虚线采样点，
   * 并在篮圈附近标出当前力度预计经过的位置。
   * 轨迹数据由 BallPhysics 计算，和真实出手共用重力与初速度公式。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawTrajectoryGuide(ctx) {
    if (!this.physics || this.phase !== 'playing' || this.physics.isBallFlying()) return;

    const ball = this.physics.getBallPosition();
    const hasAim = this.isAiming && this.aimVelocity && this.aimPoint;
    const hasFallbackCharge = this.isCharging;

    // 未按住篮球时只保留一个轻量的可交互提示，不让旧版固定抛物线抢走视觉焦点。
    if (!hasAim && !hasFallbackCharge) {
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.82)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, this.physics.getBallRadius() + 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 247, 237, 0.9)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('拖拽瞄准', ball.x + 24, ball.y - 18);
      ctx.restore();
      return;
    }

    const charge = this.physics.getCharge();
    const preview = this.physics.getTrajectoryPreview({
      power: charge,
      duration: 3.5,
      step: 0.06,
      maxPoints: 64,
      velocity: hasAim ? this.aimVelocity : null,
      origin: ball,
    });
    if (preview.points.length < 2) return;

    const hoop = preview.target || preview.hoop;
    const scoreWindow = this.physics.getScoreWindow(preview.interceptTime || 0);
    const nearestToHoop = preview.points.reduce((nearest, point) => {
      if (Math.abs(point.x - hoop.x) < Math.abs(nearest.x - hoop.x)) return point;
      return nearest;
    }, preview.points[0]);
    const verticalError = Math.abs(nearestToHoop.y - hoop.y);
    const targetColor = verticalError < 24 ? '#4ade80' : '#fbbf24';

    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(96, 165, 250, ${0.35 + charge / 250})`;
    ctx.beginPath();
    preview.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    // 采样点强化轨迹的方向感，避免在缩放画布上只看到一条模糊细线。
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(147, 197, 253, 0.7)';
    for (let i = 1; i < preview.points.length; i += 2) {
      const point = preview.points[i];
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blumgi Ball 式弹弓线：从篮球拉出方向和力度，松手时使用同一向量发射。
    if (hasAim) {
      const aimDistance = Math.max(0.001, this.aimVector?.distance || 0);
      const visualDistance = Math.min(aimDistance, 180);
      const unitX = this.aimVector.dx / aimDistance;
      const unitY = this.aimVector.dy / aimDistance;
      const aimEnd = {
        x: ball.x + unitX * visualDistance,
        y: ball.y + unitY * visualDistance,
      };
      const angle = Math.atan2(unitY, unitX);

      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(aimEnd.x, aimEnd.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(aimEnd.x, aimEnd.y);
      ctx.lineTo(
        aimEnd.x - Math.cos(angle - Math.PI / 6) * 13,
        aimEnd.y - Math.sin(angle - Math.PI / 6) * 13,
      );
      ctx.lineTo(
        aimEnd.x - Math.cos(angle + Math.PI / 6) * 13,
        aimEnd.y - Math.sin(angle + Math.PI / 6) * 13,
      );
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffedd5';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('力度 ' + Math.round(charge) + '%', aimEnd.x, aimEnd.y - 12);
    }

    // 目标窗口与物理判定共用有效开口，避免辅助线比真实可进区域更宽。
    ctx.strokeStyle = targetColor;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.ellipse(scoreWindow.left + scoreWindow.halfWidth, scoreWindow.y, scoreWindow.halfWidth, 9, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 轨迹从投掷点开始，给玩家一个明确的辅助提示。
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#bfdbfe';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(hasAim ? '松手发射' : '抛物线辅助', ball.x + 22, ball.y - 18);
    ctx.restore();
  }

  /** 投篮玩法中的莞小鹅：动作帧使用与篮球起点相同的脚部锚点。 */
  _drawGameplayPlayer(ctx) {
    if (!this.gooseSprite) return;
    const position = this.blumgiMode
      ? this.gameplayPlayerPosition
      : { x: GAMEPLAY_PLAYER_X, y: GAMEPLAY_PLAYER_Y };
    this.gooseSprite.draw(ctx, position.x, position.y, {
      width: this.blumgiMode ? 150 : 176,
      height: this.blumgiMode ? 150 : 176,
    });

  }

  /** 绘制篮球 PNG、地面投影和飞行残影。 */
  _drawBall(ctx) {
    if (!this.physics) return;
    const ball = this.physics.getBallPosition();
    const radius = this.physics.getBallRadius();
    const floorY = this.physics.getCollisionGeometry().floorY;

    const height = Math.max(0, floorY - ball.y);
    const shadowScale = Math.max(0.22, 1 - height / 260);
    ctx.save();
    ctx.fillStyle = `rgba(12, 18, 24, ${0.3 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(
      ball.x + Math.min(18, height * 0.06),
      floorY - 2,
      radius * (1.4 * shadowScale),
      radius * (0.38 * shadowScale),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    if (this.physics.isBallFlying() && this.ballTrail.length > 1) {
      this.ballTrail.forEach((trailPoint, index) => {
        const progress = (index + 1) / this.ballTrail.length;
        drawSceneObject(ctx, this.objectImages.get('ball'), {
          x: trailPoint.x,
          y: trailPoint.y,
          width: radius * (1.1 + progress * 0.55),
          height: radius * (1.1 + progress * 0.55),
          anchorX: 0.5,
          anchorY: 0.5,
          alpha: 0.04 + progress * 0.09,
        }, {
          fallbackColor: SCENE_OBJECT_ASSETS.basketball.ball.fallbackColor,
        });
      });
    }

    drawSceneObject(ctx, this.objectImages.get('ball'), {
      x: ball.x,
      y: ball.y,
      width: radius * 2.25,
      height: radius * 2.25,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: this.ballSpin,
    }, {
      fallbackColor: SCENE_OBJECT_ASSETS.basketball.ball.fallbackColor,
    });
  }

  /**
   * 绘制画布内蓄力条（球身旁边的迷你力度条）
   * 与 DOM ChargeMeter 同步显示蓄力值，提供游戏世界内的视觉反馈
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawChargeBar(ctx) {
    if (!this.physics) return;
    const charge = this.physics.getCharge();
    if (charge <= 0 && !this.isCharging) return;

    const ball = this.physics.getBallPosition();
    const barX = ball.x - 30;
    const barY = ball.y + 24;
    const barWidth = 60;
    const barHeight = 6;

    ctx.save();

    // 轨道
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // 填充（绿→红渐变，与 DOM 组件一致）
    const fillWidth = (charge / 100) * barWidth;
    const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.5, '#eab308');
    gradient.addColorStop(1, '#ef4444');
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, fillWidth, barHeight);

    // 边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    ctx.restore();
  }

  /**
   * 绘制 HUD：计分（左上）与倒计时（右上）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHud(ctx) {
    if (!this.physics) return;

    ctx.save();
    ctx.font = 'bold 24px sans-serif';
    ctx.textBaseline = 'top';

    // 计分（左上）：数字 + 5 个目标格，进球时短暂脉冲，玩家能快速确认是否真的记上了。
    const score = this.physics.getScore();
    const panelX = 20;
    const panelY = 16;
    const panelWidth = 238;
    const panelHeight = 58;
    const pulse = this.scorePulseTimer > 0
      ? 1 + Math.sin((0.8 - this.scorePulseTimer) * 30) * 0.05
      : 1;
    ctx.fillStyle = 'rgba(9, 16, 28, 0.78)';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);
    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'left';
    ctx.fillText('进球 ' + score + ' / ' + TARGET_SCORE, panelX + 12, panelY + 8);

    ctx.save();
    ctx.translate(panelX + 128, panelY + 29);
    ctx.scale(pulse, pulse);
    for (let index = 0; index < TARGET_SCORE; index += 1) {
      ctx.fillStyle = index < score ? '#4ade80' : 'rgba(226,232,240,0.28)';
      ctx.beginPath();
      ctx.arc(index * 19, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      if (index < score) {
        ctx.strokeStyle = 'rgba(220,252,231,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();

    // 倒计时（右上）
    const timer = Math.ceil(this.physics.getTimer());
    ctx.textAlign = 'right';
    // 时间不足 10 秒时变红警示
    ctx.fillStyle = timer <= 10 ? '#f87171' : '#f1f5f9';
    ctx.fillText(timer + 's', GAME.WIDTH - 24, 20);

    // 操作提示（底部中央，仅在游戏中显示）
    if (this.phase === 'playing') {
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#64748b';
      ctx.fillText('拖拽篮球瞄准，松手发射 · 拉得越远力度越大', GAME.WIDTH / 2, GAME.HEIGHT - 24);
    }

    ctx.restore();
  }

  /**
   * Blumgi 风格的极简关卡 HUD：左上关卡/进球，右上倒计时，底部只保留两个核心操作。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBlumgiHud(ctx) {
    if (!this.physics) return;
    const score = this.physics.getScore();
    const timer = Math.ceil(this.physics.getTimer());

    ctx.save();
    ctx.font = '700 20px Microsoft YaHei, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.shadowColor = 'rgba(62, 42, 91, 0.28)';
    ctx.shadowBlur = 5;
    ctx.fillText('LEVEL ' + (this.blumgiLevelIndex + 1) + ' / ' + BLUMGI_LEVEL_COUNT, 28, 24);
    ctx.font = '700 15px Microsoft YaHei, sans-serif';
    ctx.fillText('进球 ' + score + ' / ' + TARGET_SCORE, 30, 54);

    ctx.textAlign = 'right';
    ctx.font = '700 22px Microsoft YaHei, sans-serif';
    ctx.fillStyle = timer <= 10 ? '#fff1f2' : 'rgba(255, 255, 255, 0.94)';
    ctx.fillText(timer + 's', GAME.WIDTH - 30, 24);

    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.font = '700 15px Microsoft YaHei, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText('拖拽篮球瞄准 · 松手发射', GAME.WIDTH / 2, GAME.HEIGHT - 42);
    ctx.font = '600 13px Microsoft YaHei, sans-serif';
    ctx.fillStyle = 'rgba(255, 247, 237, 0.86)';
    ctx.fillText('投失落地后，篮球自动回到本关起点', GAME.WIDTH / 2, GAME.HEIGHT - 20);
    ctx.restore();
  }

  /**
   * 绘制反馈文本（进球/未中提示）
   * 文本随剩余时间淡出
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawFeedback(ctx) {
    if (!this.feedbackText) return;

    // 透明度随剩余时间递减，实现淡出效果
    const alpha = Math.min(1, this.feedbackTimer / 0.5);
    const isScore = this.feedbackText === SCORE_FEEDBACK_TEXT;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 进球绿色，未中橙色
    ctx.fillStyle = isScore ? '#4ade80' : '#fbbf24';
    ctx.fillText(this.feedbackText, GAME.WIDTH / 2, GAME.HEIGHT * 0.35);
    ctx.restore();
  }
}
