import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { resolveEnding } from '../core/SongshanLogic.js';
import { drawSceneObjects, loadSceneObjectAssets } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { EndingCG } from '../ui/EndingCG.js';

const SONGSHAN_BACKGROUND_URL = new URL('../../assets/bg/scene-08-songshan-lake-sunset.png', import.meta.url).href;

/**
 * 余烬粒子数量，覆盖画面下半区营造黄昏氛围
 */
const EMBER_COUNT = 35;

/** 余烬粒子最大存活时长（秒），到期后从底部重生 */
const EMBER_MAX_LIFE = 4.0;

/** 余烬粒子最小半径（像素） */
const EMBER_MIN_SIZE = 1.5;

/** 余烬粒子最大半径（像素） */
const EMBER_MAX_SIZE = 3.5;

/**
 * 走马灯对话（finale 前 10 行，最后一行触发 choice:resolve 事件）
 * 包含共同叙述 + 各场景高光回放 + 结算分支触发
 */
const MONTAGE_LINES = DIALOGUES.finale.slice(0, 10);

/**
 * 松山湖终章场景 · 走马灯 + 结算分支（对应 PRD §5 F9 + §4.5 + 剧情分支设计 v4 §4 + Task 5.5）
 *
 * 职责分工：
 * - Canvas 层：松山湖黄昏背景图、余烬粒子动画、结尾角色锚点
 * - DOM 层：EndingCG 结局面板（由 EndingCG 组件渲染）
 *
 * 伞形多结局流程：
 * 1. 进入 → 播放走马灯对话（finale 前 10 行，含各场景高光回放 + choice:resolve）
 * 2. 走马灯结束 → 调用 resolveEnding(choice) 判定结局
 * 3. 有 choice → 广播 EVENT.ENDING_CG 触发对应场景结局 CG
 * 4. 无 choice → 广播 EVENT.ENDING_CG 触发真结局（介绍东莞）CG
 * 5. EndingCG 组件展示结局标题/文案/成就/印记，提供"返回主菜单"入口
 */
export class SongshanScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI（共享单例）
   * @param {InputManager} deps.input - 输入管理器
   * @param {HTMLElement} deps.container - UI 挂载容器
   * @param {Function} deps.getChoice - 读取当前 choice 的回调（返回场景 id 或 null）
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, container, assetLoader = null, getFps, getChoice, gooseSprite = null }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.container = container;
    this.assetLoader = assetLoader;
    /** 松山湖终章正式背景图。 */
    this.backgroundImage = null;
    this.backgroundLoadPromise = null;
    this.objectImages = new Map();
    this.objectAssetsPromise = null;
    this.gooseSprite = gooseSprite;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);
    /** 读取当前 choice 的回调（用于结算判定，返回场景 id 或 null） */
    this.getChoice = getChoice || (() => null);

    /** 场景阶段：idle | montage | endingShown */
    this.phase = 'idle';

    /** 标记是否已广播过 chapter:complete，防止重复触发 */
    this.chapterCompleted = false;
    /** 当前结局 id，和 EndingCG 保持双向可恢复引用 */
    this.endingId = null;

    /** 动画累计时间（秒），驱动芦苇摆动与湖面波纹 */
    this.animTime = 0;

    /** 余烬粒子数组 */
    this.particles = [];

    /** 事件粒子系统（结局闪光等，复用 ParticleSystem） */
    this.effectParticles = null;

    /** 结局 CG 组件实例（走马灯后展示结局） */
    this.endingCG = null;

    // 绑定事件处理器 this 指向，确保移除时引用一致
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onExitToMenu = this._onExitToMenu.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化粒子系统、创建结局CG、注册对话事件、播放走马灯
   * @param {*} [params] - 切换场景时传入的参数（本场景忽略）
   */
  onEnter(params = {}) {
    this.phase = 'montage';
    this.animTime = 0;
    this.chapterCompleted = false;
    this.endingId = null;
    this._loadBackground();
    this._loadSceneObjects();
    this.gooseSprite?.load?.();
    this.gooseSprite?.playAction('sit', { facing: 1, hold: true, restart: true });
    this._initParticles();
    this.effectParticles = new ParticleSystem({ getFps: this.getFps });

    // 创建结局 CG 组件，设置返回主菜单回调
    this.endingCG = new EndingCG({
      eventBus: this.eventBus,
      container: this.container,
      badgeSystem: this.badgeSystem,
    });
    this.endingCG.onExit = this._onExitToMenu;

    // 监听对话推进/结束事件，用于走马灯结束后结算
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);

    // 播放走马灯对话（finale 前 10 行，含高光回放 + choice:resolve）
    this.dialogueBox.show(MONTAGE_LINES);
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回终章走马灯游标或当前结局 CG 的恢复状态。 */
  getSaveState() {
    return {
      phase: this.phase,
      chapterCompleted: this.chapterCompleted,
      animTime: this.animTime,
      endingId: this.endingId || this.endingCG?.currentEndingId || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 恢复走马灯或结局 CG，不再次广播章节完成。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'montage';
    this.chapterCompleted = Boolean(state.chapterCompleted);
    this.animTime = Number.isFinite(state.animTime) ? Math.max(0, state.animTime) : 0;
    this.endingId = state.endingId || null;
    if (this.phase === 'endingShown' && this.endingId) {
      this.dialogueBox?.hide?.();
      this.endingCG?.show?.(this.endingId, { persist: false });
    } else if (state.dialogue) {
      this.dialogueBox?.restoreSaveState?.(state.dialogue);
    } else {
      this.dialogueBox?.hide?.();
    }
  }

  /**
   * 每帧更新：累加动画时间、更新粒子、推进对话
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    this.animTime += deltaTime;
    this._updateParticles(deltaTime);
    if (this.effectParticles) this.effectParticles.update(deltaTime);
    this.gooseSprite?.update(deltaTime, 'idle', 1);

    // 对话阶段需要逐帧推进逐字显示
    if (this.phase === 'montage') {
      this.dialogueBox.update(deltaTime);
    }
  }

  /**
   * 绘制：在 Canvas 上渲染松山湖黄昏场景
   * 渲染顺序：背景图 → 结尾角色锚点 → 余烬粒子 → 结局闪光
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSongshanObjects(ctx);
    this._drawGoose(ctx);
    this._drawSongshanForeground(ctx);
    this._drawParticles(ctx);
    // 事件粒子（结局闪光）渲染在余烬之上
    if (this.effectParticles) this.effectParticles.draw(ctx);
  }

  /**
   * 场景退出：移除事件监听、销毁结局CG、清理粒子、隐藏对话框、重置状态
   */
  onExit() {
    // 移除事件总线监听
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);

    // 销毁结局 CG 组件
    if (this.endingCG) {
      this.endingCG.hide();
      this.endingCG = null;
    }

    // 隐藏对话框（共享单例，仅隐藏不销毁）
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 重置状态
    this.particles = [];
    if (this.effectParticles) {
      this.effectParticles.clear();
      this.effectParticles = null;
    }
    this.gooseSprite?.clearAction();
    this.backgroundImage = null;
    this.backgroundLoadPromise = null;
    this.objectAssetsPromise = null;
    this.objectImages = new Map();
    this.phase = 'idle';
    this.chapterCompleted = false;
    this.endingId = null;
    this.animTime = 0;
  }

  /** 松山湖结局中的稳定坐姿，作为结局 CG 背后的角色锚点。 */
  _drawGoose(ctx) {
    this.gooseSprite?.draw(ctx, GAME.WIDTH / 2, GAME.HEIGHT - 92, {
      width: 188,
      height: 188,
      alpha: 0.96,
    });
  }

  /** 按需加载正式松山湖背景图；失败时只记录错误，不恢复临时几何绘制。 */
  _loadBackground() {
    if (this.backgroundLoadPromise) return this.backgroundLoadPromise;

    this.backgroundLoadPromise = this._loadImage(SONGSHAN_BACKGROUND_URL)
      .then((image) => {
        this.backgroundImage = image;
        return image;
      })
      .catch((error) => {
        console.warn('[鹅厂出逃记] 松山湖背景加载失败，终章背景暂不可用:', error);
        return null;
      });

    return this.backgroundLoadPromise;
  }

  _loadSceneObjects() {
    if (this.objectAssetsPromise) return this.objectAssetsPromise;

    // 松山湖背景已经包含两侧芦苇；只加载步道上的可独立变化/补充物件。
    this.objectAssetsPromise = loadSceneObjectAssets(this.assetLoader, {
      bench: SCENE_OBJECT_ASSETS.songshan.bench,
      lakesideDecor: SCENE_OBJECT_ASSETS.songshan.lakesideDecor,
    }).then((images) => {
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

  // ==================== 对话事件处理 ====================

  /**
   * 对话推进/结束事件处理：走马灯结束后触发结算
   * 仅当 data.finished 为 true（整段对话结束）时推进阶段
   * @param {Object} data - 事件数据，data.finished 为 true 表示对话结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    // 走马灯结束 → 调用 resolveEnding 判定结局并展示 CG
    if (this.phase === 'montage') {
      this._resolveAndShowEnding();
    }
  }

  // ==================== 结局结算 ====================

  /**
   * 走马灯结束后结算：根据 choice 判定结局，广播 ENDING_CG 并展示结局 CG
   * - 有 choice → 对应场景结局（如 ch1 → basketball_life）
   * - 无 choice → 真结局 intro_dongguan
   * @private
   */
  _resolveAndShowEnding() {
    this.phase = 'endingShown';

    // 读取当前 choice（由主循环通过 getChoice 回调注入）
    const choice = this.getChoice();
    // 纯函数结算判定，返回 { endingId, isTrueEnding }
    const { endingId } = resolveEnding(choice);
    this.endingId = endingId;

    // 隐藏对话框，避免与结局 CG 覆盖层重叠
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 印记收集闪光粒子（对应 PRD §7.7 印记收集闪光）
    if (this.effectParticles) {
      this.effectParticles.emit(GAME.WIDTH / 2, GAME.HEIGHT / 2, 'flash');
    }

    // 广播结局 CG 事件，供外部模块（存档、统计）响应
    this.eventBus.emit(EVENT.ENDING_CG, { endingId });

    // 通过 EndingCG 组件展示结局（内部解锁印记 + 播放音效 + 广播 CHAPTER_COMPLETE）
    if (this.endingCG) {
      this.endingCG.show(endingId);
    }
  }

  /** 结局 CG 的统一返回主菜单入口。 */
  _onExitToMenu() {
    if (this.endingCG) {
      this.endingCG.hide();
    }
    this.sceneManager.change('menu');
  }

  // ==================== 余烬粒子系统 ====================

  /**
   * 初始化余烬粒子数组，随机分布初始位置和生命值
   * @private
   */
  _initParticles() {
    this.particles = [];
    for (let i = 0; i < EMBER_COUNT; i++) {
      const particle = {};
      this._resetParticle(particle);
      // 首次初始化时随机生命值，使粒子不同步消失
      particle.life = Math.random() * EMBER_MAX_LIFE;
      this.particles.push(particle);
    }
  }

  /**
   * 重置单个粒子到初始状态（底部重生）
   * @param {Object} particle - 粒子对象
   * @private
   */
  _resetParticle(particle) {
    particle.x = Math.random() * GAME.WIDTH;
    particle.y = GAME.HEIGHT * 0.6 + Math.random() * GAME.HEIGHT * 0.4;
    particle.vx = (Math.random() - 0.5) * 20;
    particle.vy = -15 - Math.random() * 25;
    particle.life = EMBER_MAX_LIFE;
    particle.maxLife = EMBER_MAX_LIFE;
    particle.size = EMBER_MIN_SIZE + Math.random() * (EMBER_MAX_SIZE - EMBER_MIN_SIZE);
  }

  /**
   * 逐帧更新粒子：移动、衰减生命、到边界后重生
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateParticles(deltaTime) {
    for (const particle of this.particles) {
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      // 水平方向轻微随机漂移，模拟热气流扰动
      particle.vx += (Math.random() - 0.5) * 5 * deltaTime;
      particle.life -= deltaTime;

      // 生命耗尽或飘出画面顶部时从底部重生
      if (particle.life <= 0 || particle.y < 0) {
        this._resetParticle(particle);
      }
    }
  }

  /**
   * 绘制余烬粒子：金黄色小点，透明度随剩余生命递减
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawParticles(ctx) {
    ctx.save();
    for (const particle of this.particles) {
      const alpha = Math.min(1, particle.life / particle.maxLife) * 0.8;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制正式松山湖黄昏背景图；图片包含湖面、落日、城市轮廓、芦苇、步道与暖色倒影。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }
    ctx.fillStyle = '#5f4351';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  _drawSongshanObjects(ctx) {
    drawSceneObjects(ctx, this.objectImages, [
      {
        assetKey: 'bench',
        x: GAME.WIDTH / 2,
        y: GAME.HEIGHT - 76,
        width: 188,
        height: 128,
        anchorY: 1,
        fallbackColor: SCENE_OBJECT_ASSETS.songshan.bench.fallbackColor,
      },
      {
        assetKey: 'lakesideDecor',
        x: 300,
        y: 524,
        width: 142,
        height: 106,
        anchorY: 1,
        fallbackColor: SCENE_OBJECT_ASSETS.songshan.lakesideDecor.fallbackColor,
      },
      {
        assetKey: 'lakesideDecor',
        x: 1004,
        y: 500,
        width: 128,
        height: 96,
        anchorY: 1,
        flipX: true,
        fallbackColor: SCENE_OBJECT_ASSETS.songshan.lakesideDecor.fallbackColor,
      },
    ]);
  }

  _drawSongshanForeground(ctx) {
    // 芦苇属于正式背景的 baked-in 前景，不再额外叠加透明 PNG。
  }
}
