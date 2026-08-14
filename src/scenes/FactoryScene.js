import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { FactoryPhysics } from '../core/FactoryPhysics.js';
import { loadSceneObjectAssets, drawSceneObjects } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { drawCollisionDebug, isCollisionDebugEnabled } from '../core/SceneLayout.js';
import factoryMapSpec from '../../assets/bg/scene-01-toy-factory/scene-01-map-spec.json';

const FACTORY_BACKGROUND_URL = new URL('../../assets/bg/scene-01-toy-factory/scene-01-background.png', import.meta.url).href;
const FACTORY_COLLISION_URL = new URL('../../assets/bg/scene-01-toy-factory/scene-01-collision.png', import.meta.url).href;

const FACTORY_WALL = factoryMapSpec.obstacles.find((obstacle) => obstacle.id === 'factory-wall');
const FACTORY_CERTIFICATE = factoryMapSpec.interactables.find((item) => item.id === 'factory-certificate');
const FACTORY_EXIT = factoryMapSpec.interactables.find((item) => item.id === 'factory-exit');

/** 围墙左边缘；实际坐标来自场景 map-spec，而不是运行时猜值。 */
const WALL_X = FACTORY_WALL.x;
const WALL_RIGHT = FACTORY_WALL.x + FACTORY_WALL.width;

/** 玩家靠近围墙的判定阈值（像素），小于此距离视为"在墙边" */
const WALL_PROXIMITY = 106;

/** 玩家初始位置与地面高度来自地图规格。 */
const PLAYER_START_X = factoryMapSpec.spawn.x;
const PLAYER_START_Y = factoryMapSpec.spawn.y;
/** 翻墙后角色中心必须越过墙体和碰撞半径，才能落在墙后白色区域。 */
const CLIMB_LANDING_X = WALL_RIGHT + 30 + 4;
/** 左侧箱体是装饰障碍，出生点本身作为玩家可退回的最左活动边界。 */
const PLAYER_LEFT_BOUND = Math.max(60, PLAYER_START_X);

/** 翻墙剧情 CG 时长（秒）；只保留一段短而明确的出逃记忆点。 */
const CLIMB_DURATION = 2.6;

/** 翻墙关键姿态出现的区间，前后用常规奔跑帧衔接起跳与落地。 */
const CLIMB_POSE_START = 0.16;
const CLIMB_POSE_END = 0.86;
const CLIMB_POSE_WIDTH = 260;
const CLIMB_POSE_HEIGHT = 260;

/** 资源尚未完成加载时的兼容性占位尺寸；正常绘制使用 GooseSprite */
const PLAYER_SIZE = 48;

/** 角色中心距离墙边的安全半径，防止精灵视觉上穿进墙体。 */
const PLAYER_COLLISION_RADIUS = 30;

/**
 * 序章场景 · 生产线觉醒（对应 PRD §4.2 序章 + 计划 Task 3.2）
 *
 * 职责分工：
 * - Canvas 层：绘制正式背景、互动对象、莞小鹅与尘土
 * - DOM 层：依赖 DialogueBox 播放对话并锁定移动
 *
 * 教学引导流程：
 * 1. 进入 → 播放对话前 3 行（引导移动）
 * 2. 对话结束 → 玩家自由移动，向右走向围墙
 * 3. 靠近围墙 → 播放对话第 4-5 行（引导互动）
 * 4. 对话结束 → 玩家按空格翻墙（需在墙边）
 * 5. 翻墙落地 → 发现并收集合格证
 * 6. 收证后向右走进出口 → 播放尾声 → 切换到第一章
 */
export class FactoryScene {
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
   * @param {import('../core/AssetLoader.js').AssetLoader} [deps.assetLoader] - 地图图层资源加载器
   * @param {Function} [deps.getFps] - FPS 获取函数（供粒子系统降级）
   * @param {import('../core/GooseSprite.js').GooseSprite} [deps.gooseSprite] - 莞小鹅序列帧绘制器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, assetLoader, getFps, gooseSprite }) {
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
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);

    /** 当前阶段：idle / intro / move / interact_dialogue / interact / climbing / certificate_dialogue / collect_certificate / certificate_badge_gate / certificate_collect_dialogue / move_to_exit / outro / done */
    this.phase = 'idle';
    /** 翻墙动画进度（0~1） */
    this.climbProgress = 0;
    /** 正式地图图层；背景与碰撞层分开加载。简陋前景层不参与运行时绘制。 */
    this.assets = {
      background: null,
      collision: null,
    };
    /** 地图资源加载 Promise；场景可先用极简回退色块，再无缝切换正式图层。 */
    this.assetsPromise = null;
    /** 新增透明物件层；图片加载失败时由渲染器只保留纯色块。 */
    this.objectImages = new Map();
    this.objectAssetsPromise = null;
    /** 合格证是否已经实际收集，出口只有在此状态后才会完成场景。 */
    this.certificateCollected = false;
    /** 防止靠近出口时每帧重复弹出尾声对话。 */
    this.exitDialogueStarted = false;
    /** 翻墙演出使用的起点和落点，不能在动画期间读取会变化的玩家位置。 */
    this.climbStartX = PLAYER_START_X;
    this.climbLandingX = CLIMB_LANDING_X;
    /** 标记是否已触发场景切换，防止重复调用 */
    this.transitioning = false;
    /** 奔跑尘土粒子系统 */
    this.particles = null;
    /** 尘土发射累计计时（秒），控制发射频率 */
    this._dustTimer = 0;
    /** 鹅厂专用侧视物理；其它俯视场景继续使用共享 PlayerController。 */
    this.factoryPhysics = null;
    this.debugCollision = isCollisionDebugEnabled();

    // 绑定回调，便于 onExit 时精确移除
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onAction = this._onAction.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化状态、设置玩家位置、注册事件、开始序章对话
   */
  onEnter(params = {}) {
    this.phase = 'intro';
    this.climbProgress = 0;
    this.transitioning = false;
    this._dustTimer = 0;
    this.certificateCollected = false;
    this.exitDialogueStarted = false;
    this.climbStartX = PLAYER_START_X;
    this.climbLandingX = CLIMB_LANDING_X;

    this._loadAssets();
    this._loadSceneObjects();

    // 初始化奔跑尘土粒子系统
    this.particles = new ParticleSystem({ getFps: this.getFps });

    // 这一章的 Y 轴是高度：传送带顶面为地面，不能沿 Y 轴自由漂移。
    this.factoryPhysics = new FactoryPhysics({
      groundY: PLAYER_START_Y,
      leftBound: PLAYER_LEFT_BOUND,
      wallX: WALL_X,
      wallRight: WALL_RIGHT,
      worldWidth: factoryMapSpec.canvas.width,
      playerRadius: PLAYER_COLLISION_RADIUS,
    });
    this.factoryPhysics.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 同步共享角色控制器的位置，保持场景切换和现有渲染接口不变。
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 注册对话结束事件，用于阶段推进
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 注册动作事件，用于检测空格翻墙
    this.input.onAction(this._onAction);

    // 播放序章前 3 行对话（引导移动）
    this.dialogueBox.show(DIALOGUES.prologue.slice(0, 3));
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回序章的剧情阶段、侧视物理和对话游标。 */
  getSaveState() {
    return {
      phase: this.phase,
      climbProgress: this.climbProgress,
      certificateCollected: this.certificateCollected,
      exitDialogueStarted: this.exitDialogueStarted,
      climbStartX: this.climbStartX,
      climbLandingX: this.climbLandingX,
      transitioning: this.transitioning,
      player: this.player?.getSaveState?.() || this.player?.position || null,
      factoryPhysics: this.factoryPhysics?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 在场景资源已重建后恢复序章，不重新播放开场对白。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'intro';
    this.climbProgress = Number.isFinite(state.climbProgress)
      ? Math.max(0, Math.min(1, state.climbProgress))
      : 0;
    this.certificateCollected = Boolean(state.certificateCollected);
    this.exitDialogueStarted = Boolean(state.exitDialogueStarted);
    if (Number.isFinite(state.climbStartX)) this.climbStartX = state.climbStartX;
    if (Number.isFinite(state.climbLandingX)) this.climbLandingX = state.climbLandingX;
    this.transitioning = Boolean(state.transitioning);
    this.factoryPhysics?.restoreSaveState?.(state.factoryPhysics);
    this.player?.restoreSaveState?.(state.player);
    if (state.player && !this.player?.restoreSaveState) {
      this.player?.setPosition?.(state.player.x, state.player.y);
    }
    if (state.dialogue) {
      this.dialogueBox?.restoreSaveState?.(state.dialogue);
    } else {
      this.dialogueBox?.hide?.();
    }
  }

  /**
   * 每帧更新：推进对话逐字、处理阶段逻辑（移动/翻墙动画）
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 始终推进对话框逐字显示（对话不可见时为空操作）
    this.dialogueBox.update(deltaTime);

    // 翻墙动画阶段：推进进度，到达 1 时触发翻墙完成
    if (this.phase === 'climbing') {
      this.climbProgress += deltaTime / CLIMB_DURATION;
      if (this.climbProgress >= 1) {
        this.climbProgress = 1;
        this._onClimbComplete();
      }
      this._updateGooseSprite(deltaTime);
      if (this.particles) this.particles.update(deltaTime);
      return;
    }

    // 印记核验覆盖层确认前暂停序章逻辑；确认后再播放收证对白。
    if (this.phase === 'certificate_badge_gate') {
      if (!this.sceneManager?.badgeGateActive) {
        this.phase = 'certificate_collect_dialogue';
        this.dialogueBox.show(DIALOGUES.prologue.slice(6, 7));
      }
      this._updateGooseSprite(deltaTime);
      if (this.particles) this.particles.update(deltaTime);
      return;
    }

    // 所有可移动阶段共用同一套侧视物理；墙前/墙后边界由 FactoryPhysics 状态决定。
    if (this._canMove()) {
      this._updateFactoryPhysics(deltaTime);
      this._emitDust(deltaTime);

      // 靠近围墙时触发互动引导对话
      if (this.phase === 'move' && this._isNearWall()) {
        this._startInteractDialogue();
      }

      // 收集合格证后，角色进入右侧出口范围即开始尾声，不再用墙前距离触发。
      if (this.phase === 'move_to_exit' && this._isNearExit()) {
        this._startExitDialogue();
      }
    }

    this._updateGooseSprite(deltaTime);

    // 更新粒子系统
    if (this.particles) this.particles.update(deltaTime);
  }

  /**
   * Canvas 渲染：工厂背景 + 传送带 + 围墙 + 角色
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSceneObjects(ctx);
    this._drawClimbCinematic(ctx);
    this._drawPlayer(ctx);
    // 尘土粒子渲染在角色之上
    if (this.particles) this.particles.draw(ctx);
    // 运行时提示属于 UI，确保始终位于角色和正式场景之上。
    this._drawPlayerHints(ctx);
    this._drawCollisionDebug(ctx);
  }

  /**
   * 场景退出：移除事件监听、隐藏对话框、重置状态
   */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.input.offAction(this._onAction);
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
    this.factoryPhysics = null;
    this.assetsPromise = null;
    this.objectAssetsPromise = null;
    this.objectImages = new Map();
    this.assets = {
      background: null,
      collision: null,
      interactables: null,
    };
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
      // 前 3 行对话结束 → 解锁移动
      this.phase = 'move';
      return;
    }

    if (this.phase === 'interact_dialogue') {
      // 第 4-5 行对话结束 → 解锁互动
      this.phase = 'interact';
      return;
    }

    if (this.phase === 'certificate_dialogue') {
      // 翻墙后的发现对白结束 → 开放合格证互动
      this.phase = 'collect_certificate';
      return;
    }

    if (this.phase === 'certificate_collect_dialogue') {
      // 合格证收集对白结束 → 开放右侧出口移动
      this.phase = 'move_to_exit';
      this.gooseSprite?.clearAction();
      return;
    }

    if (this.phase === 'outro') {
      // 到达右侧出口后的尾声对白结束 → 切换第一章
      this._onOutroComplete();
      return;
    }
  }

  /**
   * 开始互动引导对话（第 4-5 行）
   * @private
   */
  _startInteractDialogue() {
    if (this.phase !== 'move') return;
    this.phase = 'interact_dialogue';
    this.dialogueBox.show(DIALOGUES.prologue.slice(3, 5));
  }

  /** 进入出口范围后只触发一次尾声对白。 */
  _startExitDialogue() {
    if (this.phase !== 'move_to_exit' || this.exitDialogueStarted) return;
    this.exitDialogueStarted = true;
    this.phase = 'outro';
    this.dialogueBox.show(DIALOGUES.prologue.slice(7, 9));
  }

  // ==================== 翻墙交互 ====================

  /**
   * 动作事件处理：互动阶段按空格且靠近围墙时触发翻墙
   * @param {string} action - 动作名（interact / pause）
   * @private
   */
  _onAction(action) {
    if (action !== 'interact') return;

    // 翻墙 CG 播放到中段后允许空格/点击跳过，避免剧情过场阻断移动节奏。
    if (this.phase === 'climbing') {
      if (this.climbProgress > 0.28) {
        this.climbProgress = 1;
        this._onClimbComplete();
      }
      return;
    }

    if (this.phase === 'interact' && this._isNearWall()) {
      this._startClimb();
      return;
    }

    if (this.phase === 'collect_certificate' && this._isNearCertificate()) {
      this._collectCertificate();
      return;
    }

    if (this.phase === 'move_to_exit' && this._isNearExit()) {
      this._startExitDialogue();
    }
  }

  /**
   * 开始翻墙动画
   * @private
   */
  _startClimb() {
    if (!this.factoryPhysics?.isGrounded || this.factoryPhysics.wallCleared) return;
    this.phase = 'climbing';
    this.climbProgress = 0;
    this.climbStartX = this.player.x;
    this.climbLandingX = Math.max(CLIMB_LANDING_X, WALL_RIGHT + PLAYER_COLLISION_RADIUS + 4);
    this.gooseSprite?.playAction('jump', { facing: this.player.facing });
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'jump' });
  }

  /**
   * 翻墙动画完成：解除墙前物理边界，把角色放到墙后落地区。
   * @private
   */
  _onClimbComplete() {
    if (this.phase !== 'climbing' || !this.factoryPhysics) return;
    this.factoryPhysics.clearWall({ x: this.climbLandingX, y: PLAYER_START_Y });
    this.player.setPosition(this.factoryPhysics.x, this.factoryPhysics.y);
    this.gooseSprite?.clearAction();
    this.phase = 'certificate_dialogue';
    this.dialogueBox.show(DIALOGUES.prologue.slice(5, 6));
  }

  /** 合格证互动完成后解锁印记；场景完成仍需走到右侧出口。 */
  _collectCertificate() {
    if (this.certificateCollected) return;
    this.certificateCollected = true;

    const collected = this.badgeSystem.unlockOrReveal('factory_cert');
    this.gooseSprite?.playAction('celebrate', { facing: this.player.facing });

    // 首次收集或重玩时都等待 BadgeReveal 确认后再继续对白。
    if (collected && this.sceneManager?.badgeGateActive) {
      this.phase = 'certificate_badge_gate';
      return;
    }

    this.phase = 'certificate_collect_dialogue';
    this.dialogueBox.show(DIALOGUES.prologue.slice(6, 7));
  }

  /**
   * 尾声对话完成：发放印记并切换到第一章
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning || !this.certificateCollected) return;
    this.transitioning = true;
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'prologue' });
    this.sceneManager.change('ch1');
  }

  /**
   * 异步加载背景与碰撞图层；JSON 矩形负责确定性物理。
   * @returns {Promise<void>}
   * @private
   */
  _loadAssets() {
    if (this.assetsPromise) return this.assetsPromise;

    const entries = [
      ['background', FACTORY_BACKGROUND_URL],
      ['collision', FACTORY_COLLISION_URL],
    ];

    this.assetsPromise = Promise.all(
      entries.map(async ([key, url]) => [key, await this._loadImage(url)]),
    ).then((loadedEntries) => {
      for (const [key, image] of loadedEntries) {
        this.assets[key] = image;
      }
    }).catch(() => {
      // 背景加载失败时保留极简回退画面，逻辑和测试仍可继续运行。
    });

    return this.assetsPromise;
  }

  /** 加载工厂透明物件；不改变原有侧视物理与剧情状态机。 */
  _loadSceneObjects() {
    if (this.objectAssetsPromise) return this.objectAssetsPromise;
    this.objectAssetsPromise = loadSceneObjectAssets(this.assetLoader, {
      certificate: SCENE_OBJECT_ASSETS.factory.certificate,
    })
      .then((images) => {
        this.objectImages = images;
        return images;
      });
    return this.objectAssetsPromise;
  }

  /** 统一走 AssetLoader，测试或无浏览器环境下不强行访问 Image 全局对象。 */
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

  /** 当前阶段是否允许侧视物理接收移动输入。 */
  _canMove() {
    return [
      'move',
      'interact',
      'collect_certificate',
      'move_to_exit',
    ].includes(this.phase);
  }

  /** 奔跑时发射尘土，保持移动和表现由同一个物理状态驱动。 */
  _emitDust(deltaTime) {
    if (!this.particles || this.factoryPhysics?.animState !== 'run' || !this.factoryPhysics.isGrounded) return;

    this._dustTimer += deltaTime;
    if (this._dustTimer < 0.08) return;

    this._dustTimer = 0;
    this.particles.emit(this.player.x, this.player.y + 4, 'dust');
  }

  /** 墙前交互判定使用墙左边缘，避免把墙体中心误当成角色可站立点。 */
  _isNearWall() {
    return Boolean(
      this.factoryPhysics?.isGrounded
      && !this.factoryPhysics.wallCleared
      && this.player.x >= WALL_X - WALL_PROXIMITY,
    );
  }

  /** 合格证允许略高于角色脚底的拾取范围，适配证书在画面中的悬浮位置。 */
  _isNearCertificate() {
    if (!this.factoryPhysics?.isGrounded || this.certificateCollected) return false;
    const distance = Math.hypot(
      this.player.x - FACTORY_CERTIFICATE.x,
      this.player.y - FACTORY_CERTIFICATE.y,
    );
    return distance <= FACTORY_CERTIFICATE.radius + 16;
  }

  /** 出口判定必须发生在墙后且已经收集合格证之后。 */
  _isNearExit() {
    if (!this.factoryPhysics?.isGrounded || !this.factoryPhysics.wallCleared || !this.certificateCollected) {
      return false;
    }
    const distance = Math.hypot(
      this.player.x - FACTORY_EXIT.x,
      this.player.y - FACTORY_EXIT.y,
    );
    return distance <= FACTORY_EXIT.radius;
  }

  /**
   * 用鹅厂物理推进角色，再把结果同步给共享 PlayerController。
   * 共享控制器保留给其它场景使用，这里只借它的朝向和动画状态接口。
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateFactoryPhysics(deltaTime) {
    if (!this.factoryPhysics) return;

    const state = this.factoryPhysics.update(deltaTime, this.input);
    this.player.setPosition(state.x, state.y);
    this.player.update(0, {
      getVector: () => ({
        x: Math.sign(state.velocity.x),
        y: 0,
        run: state.animState === 'run',
      }),
    });
  }

  /** 让序列帧绘制器读取物理层的动画和朝向，避免出现位置与动作不同步。 */
  _updateGooseSprite(deltaTime) {
    if (!this.gooseSprite) return;

    const spriteState = this.phase === 'climbing'
      ? 'run'
      : this.factoryPhysics?.animState || this.player.animState;
    const facing = this.factoryPhysics?.facing || this.player.facing;
    this.gooseSprite.update(deltaTime, spriteState, facing);
  }

  // ==================== Canvas 绘制 ====================

  /** 绘制正式彩色背景；资源未就绪时只显示无文字回退色块。 */
  _drawBackground(ctx) {
    if (this.assets.background) {
      ctx.drawImage(this.assets.background, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }

    ctx.fillStyle = '#172735';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
    ctx.fillStyle = '#46515a';
    ctx.fillRect(0, PLAYER_START_Y - 48, GAME.WIDTH, 48);
    ctx.fillStyle = '#8b6a3f';
    ctx.fillRect(0, PLAYER_START_Y, GAME.WIDTH, GAME.HEIGHT - PLAYER_START_Y);
  }

  /** 正式背景已包含传送带、机械臂和箱体；这里只绘制可收集且会消失的合格证。 */
  _drawSceneObjects(ctx) {
    const objects = this.certificateCollected ? [] : [{
        assetKey: 'certificate',
        x: FACTORY_CERTIFICATE.x,
        y: FACTORY_CERTIFICATE.y + 8,
        width: 42,
        height: 56,
      }];
    const layoutObjects = objects
      .map((object) => ({
        ...object,
        id: object.assetKey,
        sortY: object.y,
        renderLayer: 'ground',
        fallbackColor: SCENE_OBJECT_ASSETS.factory[object.assetKey]?.fallbackColor,
      }));
    drawSceneObjects(ctx, this.objectImages, layoutObjects);
  }

  /** 侧视序章只在开发 query 下显示地图固体、玩家脚底圆和出口。 */
  _drawCollisionDebug(ctx) {
    if (!this.debugCollision) return;
    drawCollisionDebug(ctx, {
      obstacles: factoryMapSpec.obstacles.map((obstacle) => ({ ...obstacle, solid: true })),
      player: { x: this.player.x, y: this.player.y },
      playerRadius: PLAYER_COLLISION_RADIUS,
      spawn: { x: PLAYER_START_X, y: PLAYER_START_Y },
      exits: [{ id: 'factory-exit', x: FACTORY_EXIT.x, y: FACTORY_EXIT.y }],
    });
  }

  /**
   * 绘制翻墙剧情 CG 的镜头遮罩。
   * 背景保持工厂场景，动的只有莞小鹅；黑边和暖光负责把普通玩法切成剧情瞬间。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawClimbCinematic(ctx) {
    if (this.phase !== 'climbing') return;

    const t = this.climbProgress;
    const edgeFade = Math.min(1, t / 0.12, (1 - t) / 0.14);
    const wallFocusX = FACTORY_WALL.x + FACTORY_WALL.width / 2;
    const wallFocusY = FACTORY_WALL.y + FACTORY_WALL.height * 0.42;
    const vignette = ctx.createRadialGradient(wallFocusX, wallFocusY, 50, wallFocusX, wallFocusY, 460);
    vignette.addColorStop(0, `rgba(251, 191, 36, ${0.12 * edgeFade})`);
    vignette.addColorStop(1, `rgba(15, 23, 42, ${0.28 * edgeFade})`);

    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
    ctx.fillStyle = `rgba(8, 12, 24, ${0.82 * edgeFade})`;
    ctx.fillRect(0, 0, GAME.WIDTH, 42);
    ctx.fillRect(0, GAME.HEIGHT - 42, GAME.WIDTH, 42);
    ctx.restore();
  }

  /**
   * 绘制莞小鹅角色：常规帧负责助跑/落地，专用关键姿态负责越墙。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawPlayer(ctx) {
    // 对话期间用独立立绘承担角色表现，隐藏场景内的小角色，避免两套形象重叠。
    if (this.dialogueBox?.visible) return;

    let drawX = this.player.x;
    let drawY = this.player.y;

    // 翻墙剧情 CG：沿抛物线越过围墙。
    if (this.phase === 'climbing') {
      const t = this.climbProgress;
      // 垂直方向：正弦曲线模拟翻越弧线。
      const peakY = Math.max(180, FACTORY_WALL.y + Math.min(118, FACTORY_WALL.height * 0.44));
      drawX = this.climbStartX + (this.climbLandingX - this.climbStartX) * t;
      drawY = this.player.y + (peakY - this.player.y) * Math.sin(t * Math.PI);
    }
    this._lastPlayerDrawPosition = { x: drawX, y: drawY };

    // 保留落地点阴影，让越墙高度有参照，不会像俯视图那样漂浮。
    this._drawPlayerShadow(ctx, drawX, drawY);

    // 过场中段使用专用翻墙姿态；资源未加载时回退到放大的奔跑帧。
    const isClimbPoseWindow = this.phase === 'climbing'
      && this.climbProgress >= CLIMB_POSE_START
      && this.climbProgress <= CLIMB_POSE_END;
    const actionDrawn = isClimbPoseWindow && this.gooseSprite?.drawAction(ctx, 'climb', drawX, drawY, {
      width: CLIMB_POSE_WIDTH,
      height: CLIMB_POSE_HEIGHT,
      flipX: this.player.facing < 0,
    });

    const spriteDrawn = actionDrawn || (this.gooseSprite?.draw(ctx, drawX, drawY, {
      width: this.phase === 'climbing' ? 150 : undefined,
      height: this.phase === 'climbing' ? 150 : undefined,
    }) ?? false);
    if (!spriteDrawn) {
      const halfSize = PLAYER_SIZE / 2;
      ctx.save();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.fillStyle = '#1a1a2e';
      const eyeOffset = this.player.facing === 1 ? 5 : -5;
      ctx.fillRect(drawX + eyeOffset - 6, drawY - 14, 5, 5);
      ctx.fillRect(drawX + eyeOffset + 4, drawY - 14, 5, 5);
      ctx.restore();
    }

  }

  /** 绘制不应被前景机器层遮挡的运行时提示。 */
  _drawPlayerHints(ctx) {
    if (this.dialogueBox?.visible || !this._lastPlayerDrawPosition) return;

    const { x: drawX, y: drawY } = this._lastPlayerDrawPosition;
    const characterTopOffset = this.gooseSprite?.height
      ? this.gooseSprite.height * 0.92
      : PLAYER_SIZE / 2;

    if (this.phase === 'interact' && this._isNearWall()) {
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('按空格翻墙', drawX, drawY - characterTopOffset - 12);
      ctx.restore();
    }

    if (this.phase === 'collect_certificate' && this._isNearCertificate()) {
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('按空格收集合格证', drawX, drawY - characterTopOffset - 12);
      ctx.restore();
    }

    // 移动提示（移动阶段显示方向指引）
    if (this.phase === 'move' && !this._isNearWall()) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A/D 或 ←/→ 移动 · W/↑ 跳跃', drawX, drawY - characterTopOffset - 12);
      ctx.restore();
    }
  }

  /**
   * 绘制与地面高度绑定的角色阴影。
   * 阴影只表达垂直高度，不参与碰撞，避免把视觉效果混进物理规则。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @private
   */
  _drawPlayerShadow(ctx, x, y) {
    const groundY = PLAYER_START_Y;
    const height = Math.max(0, groundY - y);
    const scale = Math.max(0.45, 1 - height / 220);

    ctx.save();
    ctx.globalAlpha = Math.max(0.08, 0.26 - height / 900);
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.ellipse(x, groundY + 5, 31 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
