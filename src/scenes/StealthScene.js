import { GAME, EVENT, STEALTH_BACKGROUND_URL } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import {
  FLASHLIGHT_DEFAULT_HALF_ANGLE,
  FLASHLIGHT_DEFAULT_RANGE,
  StealthLogic,
} from '../core/StealthLogic.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';
import { TopdownController } from '../core/TopdownController.js';
// SceneObjectRenderer/SCENE_OBJECT_ASSETS remain part of the scene contract; this
// map intentionally requests no static PNG because every shop object is baked in.
import { drawSceneObjects, loadSceneObjectAssets } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { sortBySortY } from '../core/SceneLayout.js';
import stealthMapSpec from '../../assets/bg/scene-04-roast-goose-shop/scene-04-map-spec.json';

// ==================== 场景布局常量 ====================

/** 玩家起点（左下角，店门入口侧） */
const PLAYER_START_X = stealthMapSpec.spawn.x;
const PLAYER_START_Y = stealthMapSpec.spawn.y;

/** 老板巡逻 Y 坐标（画布中部偏上） */
const BOSS_Y = stealthMapSpec.boss.y;
/** 老板脚底碰撞半径；路线校验、调试圆和巡逻状态共用。 */
const BOSS_RADIUS = stealthMapSpec.boss.radius || 18;

/** 烧鹅台位置与判定半径（右上方吊架） */
const GOOSE_TABLE = {
  ...(stealthMapSpec.gooseTable.interaction || stealthMapSpec.gooseTable),
};

/** 3 个掩体：桌底 / 木桶 / 门帘，分布在玩家前往烧鹅台的路径上 */
const COVERS = stealthMapSpec.covers;

/** 手电筒光锥参数；逻辑检测和 Canvas 光效共用，避免“看得见但不报警”。 */
const FLASHLIGHT_RANGE = FLASHLIGHT_DEFAULT_RANGE;
const FLASHLIGHT_HALF_ANGLE = FLASHLIGHT_DEFAULT_HALF_ANGLE;

/** 被抓复位时间（秒），对应 PRD F6 */
const CAUGHT_RESET_TIME = 1.6;

/** 与共享俯视控制器一致的角色碰撞半径。 */
const PLAYER_RADIUS = 20;
/** 复位节点位于店内中部通道，不堵住左侧店门出生点。 */
const CAUGHT_RESET_PATROL_NODE = 1;

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
 * 4. caught → 手电筒照中且未藏好时立即抓获，1.6s 后复位到起点
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
   * @param {import('../core/AssetLoader.js').AssetLoader} [deps.assetLoader] - 正式地图资源加载器
   * @param {import('../core/GooseSprite.js').GooseSprite} [deps.gooseSprite] - 莞小鹅序列帧绘制器
   * @param {import('../core/BossSprite.js').BossSprite} [deps.bossSprite] - 烧鹅店老板动作绘制器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, assetLoader, getFps, getChoice, gooseSprite, bossSprite }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.assetLoader = assetLoader || null;
    this.gooseSprite = gooseSprite || null;
    this.bossSprite = bossSprite || null;
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
    /** 上一帧警觉度，用于只触发一次惊吓动作 */
    this.lastAlert = 0;
    /** 标记是否已触发场景切换，防止重复调用 */
    this.transitioning = false;
    /** 奔跑尘土粒子系统 */
    this.particles = null;
    /** 尘土发射累计计时（秒），控制发射频率 */
    this._dustTimer = 0;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;
    /** 共享俯视移动/互动控制器 */
    this.topdown = null;
    /** 正式烧鹅店地图资源；角色与碰撞逻辑不依赖背景图片加载时序。 */
    this.assets = { background: null };
    this.assetsPromise = null;
    this.animTime = 0;

    // 绑定回调，便于 onExit 精确移除
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化潜行逻辑、设置玩家起点、注册事件、播放前 5 行对话
   */
  onEnter(params = {}) {
    this.phase = 'intro';
    this.caughtTimer = 0;
    this.hasStolen = false;
    this.lastAlert = 0;
    this.transitioning = false;
    this._dustTimer = 0;
    this.animTime = 0;

    this._loadAssets();

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
      patrolRoute: stealthMapSpec.patrolRoute,
      patrolObstacles: this._getObstacles(),
      bossRadius: BOSS_RADIUS,
    });

    // 设置玩家起点
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);

    this.topdown = new TopdownController({
      player: this.player,
      input: this.input,
      container: this.container,
      onInteract: (target) => this._onTopdownInteract(target),
      title: '第三章 · 烧鹅店',
      objective: '躲开老板视线，靠近掩体并前往烧鹅台',
    });
    this.topdown.setMap({
      bounds: { ...stealthMapSpec.bounds },
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
      playerRadius: PLAYER_RADIUS,
    });
    this.topdown.mount();
    this.topdown.setProgress('警觉度 0%');
    this.topdown.setExitStatus('出口：先拿到烧鹅');
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);

    // 注册对话结束事件，用于阶段推进
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 播放 ch3 前 5 行对话（引导潜行）
    this.dialogueBox.show(DIALOGUES.ch3.slice(0, 5));
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回潜行阶段、玩家位置、老板巡逻和警觉度的完整快照。 */
  getSaveState() {
    return {
      phase: this.phase,
      choiceVisible: Boolean(this.choiceOverlay),
      caughtTimer: this.caughtTimer,
      hasStolen: this.hasStolen,
      lastAlert: this.lastAlert,
      transitioning: this.transitioning,
      dustTimer: this._dustTimer,
      animTime: this.animTime,
      player: this.player?.getSaveState?.() || this.player?.position || null,
      logic: this.logic?.getSaveState?.() || null,
      topdown: this.topdown?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 恢复潜行、逃跑、被抓倒计时或尾声抉择，不重置老板巡逻。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'intro';
    if (state.choiceVisible && this.phase === 'outro') this.phase = 'choice';
    this.caughtTimer = Number.isFinite(state.caughtTimer) ? Math.max(0, state.caughtTimer) : 0;
    this.hasStolen = Boolean(state.hasStolen);
    this.lastAlert = Number.isFinite(state.lastAlert) ? state.lastAlert : 0;
    this.transitioning = Boolean(state.transitioning || state.choiceVisible);
    this._dustTimer = Number.isFinite(state.dustTimer) ? Math.max(0, state.dustTimer) : 0;
    this.animTime = Number.isFinite(state.animTime) ? Math.max(0, state.animTime) : 0;
    this.player?.restoreSaveState?.(state.player);
    if (state.player && !this.player?.restoreSaveState) {
      this.player?.setPosition?.(state.player.x, state.player.y);
    }
    this.logic?.restoreSaveState?.(state.logic);
    this._syncRestoredPhase();
    if (state.topdown) this.topdown?.restoreSaveState?.(state.topdown);
    if (this.phase === 'choice') this._showChoice();
    if (state.dialogue) this.dialogueBox?.restoreSaveState?.(state.dialogue);
    else this.dialogueBox?.hide?.();
  }

  _syncRestoredPhase() {
    if (!this.topdown) return;
    const alert = Math.round(this.logic?.getAlert?.() ?? this.lastAlert ?? 0);
    if (this.phase === 'stealth') {
      this.topdown.setSceneInfo('第三章 · 烧鹅店', '躲开老板视线，靠近掩体并前往烧鹅台');
      this.topdown.setExitStatus('出口：先拿到烧鹅');
      this.topdown.setProgress(`警觉度 ${alert}%`);
      this.topdown.setMovementLocked(false);
      this.topdown.setInteractionEnabled(true);
    } else if (this.phase === 'escaping') {
      this.topdown.setSceneInfo('第三章 · 烧鹅店', '带着烧鹅回到左侧店门，靠近出口后主动逃出');
      this.topdown.setProgress('目标：已拿到烧鹅');
      this.topdown.setExitStatus('出口：已开放');
      this.topdown.setMovementLocked(false);
      this.topdown.setInteractionEnabled(true);
    } else if (this.phase === 'caught') {
      this.topdown.setSceneInfo('第三章 · 烧鹅店', '被手电筒照到了！烧鹅掉回去了，等待老板复位');
      this.topdown.setProgress('警觉度 100% · 被发现');
      this.topdown.setMovementLocked(true);
      this.topdown.setInteractionEnabled(false);
    } else {
      this.topdown.setMovementLocked(true);
      this.topdown.setInteractionEnabled(false);
    }
  }

  /**
   * 每帧更新：推进对话逐字、按阶段分发潜行逻辑
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    this.animTime += deltaTime;
    // 始终推进对话框逐字显示（对话不可见时为空操作）
    this.dialogueBox.update(deltaTime);
    if (this.gooseSprite) {
      this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    }
    if (this.bossSprite && this.logic) {
      const boss = this.logic.getBossPosition();
      this.bossSprite.update(deltaTime, 'patrol', boss.direction);
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
      this.topdown?.update(deltaTime);
      this._updateStealth(deltaTime);
    }

    // 更新粒子系统
    if (this.particles) this.particles.update(deltaTime);
  }

  /**
   * 潜行阶段核心更新：老板巡逻、玩家移动、手电筒命中与掩体判定、警觉度、目标检测
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateStealth(deltaTime) {
    // 更新老板巡逻位置
    this.logic.updateBoss(deltaTime);

    // 奔跑时发射尘土粒子（对应 PRD §7.7 奔跑尘土）
    if (this.particles && this.player.animState === 'run') {
      this._dustTimer += deltaTime;
      if (this._dustTimer >= 0.08) {
        this._dustTimer = 0;
        this.particles.emit(this.player.x, this.player.y + PLAYER_RADIUS, 'dust');
      }
    }

    // 计算玩家是否在老板手电筒光锥内；路线转弯、光锥角度和障碍遮挡由逻辑层统一处理。
    const boss = this.logic.getBossPosition();
    const inDangerZone = this.logic.isInFlashlight(this.player.x, this.player.y, {
      range: FLASHLIGHT_RANGE,
      halfAngle: FLASHLIGHT_HALF_ANGLE,
    });

    // 检测玩家是否近掩体（已藏好）
    const isHidden = this.logic.isNearCover(this.player.x, this.player.y, COVERS);

    // 手电筒逻辑已经完成距离、角度和实体遮挡判定；实际照中且未藏好时直接抓捕。
    if (this.logic.markCaughtIfVisible(inDangerZone, isHidden)) {
      this._onCaught();
      return;
    }

    // 更新警觉度
    this.logic.updateAlert(deltaTime, inDangerZone, isHidden);
    const alert = this.logic.getAlert();
    this.topdown?.setProgress(`警觉度 ${Math.round(alert)}%`);

    // 掩体动作停在稳定躲藏姿态，离开掩体后恢复移动状态。
    if (isHidden) {
      this.gooseSprite?.playAction('hide', { facing: this.player.facing, hold: true });
    } else if (this.gooseSprite?.isActionActive('hide')) {
      this.gooseSprite.clearAction();
    }

    // 警觉度首次越过阈值时播放一次可爱的惊吓动作。
    if (!isHidden && alert >= 55 && this.lastAlert < 55) {
      this.gooseSprite?.playAction('scared', { facing: this.player.facing });
    }
    this.lastAlert = alert;

    // 兼容渐进警觉度达到满值的旧逻辑
    if (this.logic.isCaught()) {
      this._onCaught();
      return;
    }

    // 烧鹅台和店门都通过共享俯视控制器的主动互动触发，避免进入范围就跳过提示。
  }

  /**
   * Canvas 渲染：背景 + 掩体 + 烧鹅台 + 老板 + 玩家 + 警觉度条
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSceneObjects(ctx);
    const boss = this.logic?.getBossPosition();
    if (boss) this._drawFlashlight(ctx, boss);
    const actors = sortBySortY([
      boss ? { sortY: boss.y, draw: () => this._drawBoss(ctx) } : null,
      this.player ? { sortY: this.player.y, draw: () => this._drawPlayer(ctx) } : null,
    ].filter(Boolean));
    actors.forEach((actor) => actor.draw());
    this.topdown?.drawInteractables(ctx, this.animTime);
    // 尘土粒子渲染在角色之上
    if (this.particles) this.particles.draw(ctx);
    this.topdown?.drawDebug(ctx, {
      spawn: { x: PLAYER_START_X, y: PLAYER_START_Y },
      exits: [{ id: 'shop-exit', ...stealthMapSpec.exit }],
      patrolRoute: this.logic?.getPatrolRoute?.() || [],
      boss,
      bossRadius: BOSS_RADIUS,
    });
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
    this.topdown?.destroy();
    this.topdown = null;
    // 移除抉择覆盖层
    this._hideChoiceOverlay();
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
    this.gooseSprite?.clearAction();
    this.bossSprite?.clearAction();
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
      this.topdown?.setSceneInfo('第三章 · 烧鹅店', '躲开老板视线，靠近掩体并前往烧鹅台');
      this.topdown?.setMovementLocked(false);
      this.topdown?.setInteractionEnabled(true);
      this.topdown?.setExitStatus('出口：先拿到烧鹅');
      this.topdown?.setProgress(`警觉度 ${Math.round(this.logic?.getAlert?.() ?? 0)}%`);
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
    this.gooseSprite?.playAction('eat', { facing: this.player.facing });
    // 偷尝音效（对应 PRD §7.8 SFX 偷吃）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'steal' });
    this.topdown?.setSceneInfo('第三章 · 烧鹅店', '带着烧鹅回到左侧店门，靠近出口后主动逃出');
    this.topdown?.setProgress('目标：已拿到烧鹅');
    this.topdown?.setExitStatus('出口：已开放');
  }

  /**
   * 成功逃出店门：播放 ch3 后 5 行对话
   * @private
   */
  _onEscape() {
    this.phase = 'outro';
    this.topdown?.setMovementLocked(true);
    this.topdown?.setInteractionEnabled(false);
    this.dialogueBox.show(DIALOGUES.ch3.slice(5, 10));
  }

  /**
   * 被抓获：进入复位阶段，启动 1.6s 倒计时
   * @private
   */
  _onCaught() {
    // 烧鹅是本次潜行中的临时持有物；被抓后应掉回烧鹅台，不能带入下一次尝试。
    this.hasStolen = false;
    this.phase = 'caught';
    this.caughtTimer = 0;
    this.gooseSprite?.clearAction();
    this.gooseSprite?.playAction('caught', { facing: this.player.facing, hold: true });
    this.bossSprite?.playAction('caught', {
      facing: this.logic?.getBossPosition().direction || 1,
      hold: true,
    });
    this.topdown?.setMovementLocked(true);
    this.topdown?.setInteractionEnabled(false);
    this.topdown?.setProgress('警觉度 100% · 被发现');
    // 被抓音效（对应 PRD §7.8 SFX 被抓）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'caught' });
    this.topdown?.setSceneInfo('第三章 · 烧鹅店', '被手电筒照到了！烧鹅掉回去了，等待老板复位');
  }

  /**
   * 被抓复位完成：玩家回到起点、警觉度归零，重新开始本次潜行
   * @private
   */
  _onCaughtReset() {
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);
    this.logic.resetAlert();
    this.logic.resetPatrol({ index: CAUGHT_RESET_PATROL_NODE, travelDirection: 1 });
    this.lastAlert = 0;
    // 复位是一次新的潜行尝试，必须重新前往烧鹅台偷取。
    this.hasStolen = false;
    this.gooseSprite?.clearAction();
    this.bossSprite?.clearAction();
    this.phase = 'stealth';
    this.topdown?.setSceneInfo('第三章 · 烧鹅店', '躲开老板视线，靠近掩体并前往烧鹅台');
    this.topdown?.setMovementLocked(false);
    this.topdown?.setInteractionEnabled(true);
    this.topdown?.setExitStatus('出口：先拿到烧鹅');
    this.topdown?.setProgress(`警觉度 ${Math.round(this.logic?.getAlert?.() ?? 0)}%`);
  }

  /**
   * 尾声对话完成：发放印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    this.badgeSystem.unlockOrReveal(BADGE_ID);
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

  /** 统一的俯视互动入口：掩体、烧鹅台和店门都显示上下文提示后才触发。 */
  _onTopdownInteract(target) {
    if (target.id === 'goose-table' && this.phase === 'stealth') {
      this._onSteal();
      return;
    }
    if (target.id === 'shop-exit' && this.phase === 'escaping') {
      this._onEscape();
      return;
    }
    if (target.isCover && (this.phase === 'stealth' || this.phase === 'escaping')) {
      this.topdown?.setProgress(`警觉度 ${Math.round(this.logic?.getAlert?.() ?? 0)}% · 已接近掩体`);
    }
  }

  /** 只把地图规格中标记为 solid 的实体送入碰撞层；interaction zone 永远独立。 */
  _getObstacles() {
    return stealthMapSpec.obstacles
      .filter((obstacle) => obstacle.solid === true)
      .map((obstacle) => ({ ...obstacle }));
  }

  _getInteractables() {
    return [
      ...COVERS.map((cover, index) => ({
        id: `cover-${index}`,
        kind: 'interaction',
        solid: false,
        x: cover.x,
        y: cover.y,
        radius: cover.radius ?? 70,
        isCover: true,
        label: `${cover.name}掩体`,
        markerLabel: `${cover.name} · 可藏`,
        actionLabel: '躲藏',
        hideMarker: true,
        available: () => ['stealth', 'escaping'].includes(this.phase),
      })),
      {
        id: 'goose-table',
        kind: 'interaction',
        interactionZone: true,
        solid: false,
        ...GOOSE_TABLE,
        // 互动半径直接来自 map-spec，不能再用第二个更大的热区把玩家吸进展示台。
        radius: GOOSE_TABLE.radius,
        label: '烧鹅台',
        markerLabel: '烧鹅台 · 互动',
        actionLabel: '偷尝',
        hideMarker: true,
        available: () => this.phase === 'stealth',
      },
      {
        id: 'shop-exit',
        kind: 'interaction',
        solid: false,
        ...stealthMapSpec.exit,
        isExit: true,
        label: '店门出口',
        markerLabel: '出口 / 回到街上',
        actionLabel: '逃出',
        available: () => this.phase === 'escaping',
      },
    ];
  }

  /** 异步加载正式背景；碰撞与剧情不依赖图片加载完成。 */
  _loadAssets() {
    if (this.assetsPromise) return this.assetsPromise;

    this.assetsPromise = this._loadImage(STEALTH_BACKGROUND_URL).then((image) => {
      this.assets.background = image;
      return image;
    });

    return this.assetsPromise;
  }

  /** 统一走 AssetLoader，测试环境或无浏览器环境不强行访问 Image 全局对象。 */
  _loadImage(url) {
    if (this.assetLoader?.loadImage) {
      return this.assetLoader.loadImage(url).catch(() => null);
    }

    if (typeof Image === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制正式烧鹅店地图；墙体、柜台、桌子、木桶、门帘和后厨隔断
   * 只在 map-spec 中参与 solid 碰撞，背景本身不承担物理判定。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    if (this.assets.background) {
      ctx.drawImage(this.assets.background, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }
    ctx.fillStyle = '#4a3026';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /** 烧鹅店主要桌台、柜台、木桶和门帘均已烘焙进正式背景，只保留透明互动热区。 */
  _drawSceneObjects(_ctx) {}

  /**
   * 绘制老板：手电筒光锥 + 透明巡逻/抓捕 Sprite
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBoss(ctx) {
    const boss = this.logic.getBossPosition();

    ctx.save();

    const bossSpriteDrawn = this.bossSprite?.draw(ctx, boss.x, boss.y, {
      width: this.bossSprite.width,
      height: this.bossSprite.height,
      flipX: boss.direction < 0,
    }) ?? false;

    // 被抓阶段闪烁警告
    if (this.phase === 'caught' && bossSpriteDrawn) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      const warningOffset = this.bossSprite.height / 2;
      ctx.fillText('！', boss.x, boss.y - warningOffset - 8);
    }

    ctx.restore();
  }

  /**
   * 绘制带渐变、脉动和灯头辉光的手电筒光束。
   * 先裁剪到光锥再填充径向渐变，让光线有明显的中心亮度和边缘衰减。
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,angle:number,direction:number}} boss
   * @private
   */
  _drawFlashlight(ctx, boss) {
    if (!['stealth', 'escaping'].includes(this.phase)) return;
    if (typeof ctx.createRadialGradient !== 'function') return;

    // 光束长度保持固定，脉动只改变亮度；警觉度判定也使用同一个固定范围，
    // 避免玩家站在边界时出现“画面没照到但警觉度上涨”的偶发不同步。
    const pulse = 0.94 + Math.sin(this.animTime * 7) * 0.06;
    const range = FLASHLIGHT_RANGE;
    const angle = Number.isFinite(boss.flashlightAngle)
      ? boss.flashlightAngle
      : boss.direction < 0 ? Math.PI : 0;
    const origin = boss.flashlightOrigin || boss;
    const visibilityPoints = this._getFlashlightVisibilityPoints(origin, angle, range);

    ctx.save();
    ctx.globalAlpha *= pulse;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    visibilityPoints.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.clip();

    const beamGradient = ctx.createRadialGradient(origin.x, origin.y, 8, origin.x, origin.y, range);
    beamGradient.addColorStop(0, 'rgba(255, 246, 180, 0.30)');
    beamGradient.addColorStop(0.28, 'rgba(255, 224, 126, 0.16)');
    beamGradient.addColorStop(0.7, 'rgba(255, 196, 72, 0.07)');
    beamGradient.addColorStop(1, 'rgba(255, 196, 72, 0)');
    ctx.fillStyle = beamGradient;
    ctx.fillRect(origin.x - range, origin.y - range, range * 2, range * 2);
    ctx.restore();

    // 光锥边缘和灯头辉光提供方向感；警觉度升高时边缘偏红。
    ctx.save();
    ctx.globalAlpha *= pulse;
    ctx.strokeStyle = this.logic.getAlert() >= 55
      ? 'rgba(248, 113, 113, 0.48)'
      : 'rgba(255, 231, 150, 0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(visibilityPoints[0].x, visibilityPoints[0].y);
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(visibilityPoints[visibilityPoints.length - 1].x, visibilityPoints[visibilityPoints.length - 1].y);
    ctx.stroke();

    const lensGradient = ctx.createRadialGradient(origin.x, origin.y, 2, origin.x, origin.y, 28);
    lensGradient.addColorStop(0, 'rgba(255, 251, 214, 0.8)');
    lensGradient.addColorStop(0.35, 'rgba(255, 224, 126, 0.34)');
    lensGradient.addColorStop(1, 'rgba(255, 224, 126, 0)');
    ctx.fillStyle = lensGradient;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 用同一份 solid 矩形计算光锥每条采样射线的可见终点。
   * 这样画面上的光束会在柜台、桌子、展示台等实体前停止，
   * 与 StealthLogic.isInFlashlight 的遮挡判定保持一致。
   * @param {{x:number,y:number}} origin
   * @param {number} angle
   * @param {number} range
   * @returns {Array<{x:number,y:number}>}
   * @private
   */
  _getFlashlightVisibilityPoints(origin, angle, range) {
    const samples = 48;
    const halfAngle = FLASHLIGHT_HALF_ANGLE;
    const points = [];
    const obstacles = this._getObstacles();

    for (let index = 0; index <= samples; index += 1) {
      const rayAngle = angle - halfAngle + ((halfAngle * 2 * index) / samples);
      const directionX = Math.cos(rayAngle);
      const directionY = Math.sin(rayAngle);
      let distance = range;

      for (const obstacle of obstacles) {
        if (this._pointInsideRect(origin, obstacle)) continue;
        const hitDistance = this._rayRectDistance(origin, directionX, directionY, obstacle);
        if (hitDistance !== null && hitDistance < distance) distance = hitDistance;
      }

      points.push({
        x: origin.x + directionX * distance,
        y: origin.y + directionY * distance,
      });
    }

    return points;
  }

  /** 返回射线从 origin 到矩形边界的第一个正向交点距离。 */
  _rayRectDistance(origin, directionX, directionY, rect) {
    let near = -Infinity;
    let far = Infinity;

    const axes = [
      { origin: origin.x, direction: directionX, min: rect.x, max: rect.x + rect.width },
      { origin: origin.y, direction: directionY, min: rect.y, max: rect.y + rect.height },
    ];

    for (const axis of axes) {
      if (Math.abs(axis.direction) < 0.000001) {
        if (axis.origin < axis.min || axis.origin > axis.max) return null;
        continue;
      }

      const first = (axis.min - axis.origin) / axis.direction;
      const second = (axis.max - axis.origin) / axis.direction;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return null;
    }

    if (far < 0) return null;
    return near >= 0 ? near : far;
  }

  _pointInsideRect(point, rect) {
    return point.x >= rect.x
      && point.x <= rect.x + rect.width
      && point.y >= rect.y
      && point.y <= rect.y + rect.height;
  }

  /**
   * 绘制莞小鹅：使用真实透明序列帧，藏好时半透明
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawPlayer(ctx) {
    // 对话期间用独立立绘承担角色表现，隐藏场景内的小角色，避免两套形象重叠。
    if (this.dialogueBox?.visible) return;

    const isHidden = this.phase === 'stealth' || this.phase === 'escaping'
      ? this.logic.isNearCover(this.player.x, this.player.y, COVERS)
      : false;

    const spriteDrawn = this.gooseSprite?.draw(ctx, this.player.x, this.player.y, {
      alpha: isHidden ? 0.45 : 1,
    }) ?? false;
    if (!spriteDrawn) return;

    // 藏好提示
    if (isHidden) {
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.9)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已藏好', this.player.x, this.player.y - this.gooseSprite.height * 0.92 - 10);
      ctx.restore();
    }
  }

}
