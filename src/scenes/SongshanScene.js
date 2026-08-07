import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { resolveEnding } from '../core/SongshanLogic.js';
import { EndingCG } from '../ui/EndingCG.js';

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

/** 湖面地平线 Y 坐标比例，上半为天空、下半为湖面 */
const HORIZON_RATIO = 0.52;

/** 芦苇数量，沿湖岸均匀分布 */
const REED_COUNT = 16;

/**
 * 松山湖终章场景 · 走马灯 + 结算分支（对应 PRD §5 F9 + §4.5 + 剧情分支设计 v4 §4 + Task 5.5）
 *
 * 职责分工：
 * - Canvas 层：黄昏渐变背景、落日、湖面倒影、芦苇、余烬粒子动画
 * - DOM 层：EndingCG 结局面板（由 EndingCG 组件渲染）
 *
 * 伞形多结局流程：
 * 1. 进入 → 播放走马灯对话（finale 前 10 行，含各场景高光回放 + choice:resolve）
 * 2. 走马灯结束 → 调用 resolveEnding(choice) 判定结局
 * 3. 有 choice → 广播 EVENT.ENDING_CG 触发对应场景结局 CG
 * 4. 无 choice → 广播 EVENT.ENDING_CG 触发真结局（介绍东莞）CG
 * 5. EndingCG 组件展示结局标题/文案/成就/印记，提供"再选一次"回到走马灯前
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
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, container, getFps, getChoice }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.container = container;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);
    /** 读取当前 choice 的回调（用于结算判定，返回场景 id 或 null） */
    this.getChoice = getChoice || (() => null);

    /** 场景阶段：idle | montage | endingShown */
    this.phase = 'idle';

    /** 标记是否已广播过 chapter:complete，防止重复触发 */
    this.chapterCompleted = false;

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
    this._onRetry = this._onRetry.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化粒子系统、创建结局CG、注册对话事件、播放走马灯
   * @param {*} [params] - 切换场景时传入的参数（本场景忽略）
   */
  onEnter(_params) {
    this.phase = 'montage';
    this.animTime = 0;
    this.chapterCompleted = false;
    this._initParticles();
    this.effectParticles = new ParticleSystem({ getFps: this.getFps });

    // 创建结局 CG 组件，设置"再选一次"回调
    this.endingCG = new EndingCG({
      eventBus: this.eventBus,
      container: this.container,
      badgeSystem: this.badgeSystem,
    });
    this.endingCG.onRetry = this._onRetry;

    // 监听对话推进/结束事件，用于走马灯结束后结算
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);

    // 播放走马灯对话（finale 前 10 行，含高光回放 + choice:resolve）
    this.dialogueBox.show(MONTAGE_LINES);
  }

  /**
   * 每帧更新：累加动画时间、更新粒子、推进对话
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    this.animTime += deltaTime;
    this._updateParticles(deltaTime);
    if (this.effectParticles) this.effectParticles.update(deltaTime);

    // 对话阶段需要逐帧推进逐字显示
    if (this.phase === 'montage') {
      this.dialogueBox.update(deltaTime);
    }
  }

  /**
   * 绘制：在 Canvas 上渲染黄昏松山湖场景
   * 渲染顺序：背景渐变 → 落日 → 湖面倒影 → 芦苇 → 余烬粒子
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSun(ctx);
    this._drawLake(ctx);
    this._drawReeds(ctx);
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
    this.phase = 'idle';
    this.chapterCompleted = false;
    this.animTime = 0;
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

  /**
   * "再选一次"回调：隐藏结局 CG，重置状态后重新播放走马灯
   * 由 EndingCG 组件的"再选一次"按钮触发
   * @private
   */
  _onRetry() {
    // 隐藏结局 CG 覆盖层
    if (this.endingCG) {
      this.endingCG.hide();
    }
    // 重置章节完成标记，允许重新结算
    this.chapterCompleted = false;
    // 重新进入走马灯阶段
    this.phase = 'montage';
    this.dialogueBox.show(MONTAGE_LINES);
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
   * 绘制黄昏渐变背景：深紫（天顶）→ 橙红（落日带）→ 湖青（湖面）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    const horizonY = GAME.HEIGHT * HORIZON_RATIO;
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#1e1b4b');
    gradient.addColorStop(0.2, '#4c1d95');
    gradient.addColorStop(0.4, '#c2410c');
    gradient.addColorStop(0.5, '#f59e0b');
    gradient.addColorStop(horizonY, '#fb923c');
    gradient.addColorStop(horizonY + 0.01, '#0e7490');
    gradient.addColorStop(1, '#164e63');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /**
   * 绘制落日：带光晕的橙黄色圆盘，位于地平线上方
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawSun(ctx) {
    const sunX = GAME.WIDTH * 0.5;
    const sunY = GAME.HEIGHT * HORIZON_RATIO - 20;
    const sunRadius = 55;

    ctx.save();

    // 外层光晕（大范围柔和扩散）
    const glow = ctx.createRadialGradient(sunX, sunY, sunRadius * 0.5, sunX, sunY, sunRadius * 4);
    glow.addColorStop(0, 'rgba(251, 191, 36, 0.35)');
    glow.addColorStop(0.5, 'rgba(251, 146, 60, 0.12)');
    glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 太阳圆盘（中心亮、边缘暖橙）
    const sunGradient = ctx.createRadialGradient(sunX, sunY - 5, 0, sunX, sunY, sunRadius);
    sunGradient.addColorStop(0, '#fef3c7');
    sunGradient.addColorStop(0.4, '#fcd34d');
    sunGradient.addColorStop(0.8, '#fbbf24');
    sunGradient.addColorStop(1, '#f59e0b');
    ctx.fillStyle = sunGradient;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 绘制湖面倒影：湖面渐变 + 落日倒影 + 波纹涟漪
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawLake(ctx) {
    const horizonY = GAME.HEIGHT * HORIZON_RATIO;
    const sunX = GAME.WIDTH * 0.5;

    ctx.save();

    // 湖面渐变（近岸深、远岸亮）
    const lakeGradient = ctx.createLinearGradient(0, horizonY, 0, GAME.HEIGHT);
    lakeGradient.addColorStop(0, 'rgba(14, 116, 144, 0.7)');
    lakeGradient.addColorStop(0.5, 'rgba(15, 118, 110, 0.8)');
    lakeGradient.addColorStop(1, 'rgba(22, 78, 99, 0.9)');
    ctx.fillStyle = lakeGradient;
    ctx.fillRect(0, horizonY, GAME.WIDTH, GAME.HEIGHT - horizonY);

    // 落日倒影（从地平线向下延伸的柱状光带）
    const reflGradient = ctx.createLinearGradient(sunX, horizonY, sunX, horizonY + 120);
    reflGradient.addColorStop(0, 'rgba(251, 191, 36, 0.35)');
    reflGradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = reflGradient;
    ctx.fillRect(sunX - 50, horizonY, 100, 120);

    // 波纹涟漪（横向虚线，随时间偏移）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const y = horizonY + 25 + i * 32;
      const offset = Math.sin(this.animTime * 0.6 + i * 0.8) * 8;
      ctx.beginPath();
      ctx.moveTo(0, y + offset);
      ctx.lineTo(GAME.WIDTH, y + offset);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制芦苇：湖岸边垂直线条，随时间轻微摆动
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawReeds(ctx) {
    const baseY = GAME.HEIGHT * 0.88;

    ctx.save();
    ctx.strokeStyle = 'rgba(30, 58, 95, 0.6)';
    ctx.lineWidth = 2;

    for (let i = 0; i < REED_COUNT; i++) {
      const x = (i / (REED_COUNT - 1)) * GAME.WIDTH;
      const height = 55 + Math.sin(i * 2.3) * 18;
      const sway = Math.sin(this.animTime * 0.8 + i * 0.5) * 7;

      ctx.beginPath();
      ctx.moveTo(x, baseY);
      // 二次贝塞尔曲线模拟芦苇弯曲
      ctx.quadraticCurveTo(x + sway * 0.5, baseY - height * 0.5, x + sway, baseY - height);
      ctx.stroke();

      // 芦苇顶部小穗
      ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.beginPath();
      ctx.arc(x + sway, baseY - height, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
