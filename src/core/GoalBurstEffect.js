/**
 * 篮球馆正式进球光效。
 *
 * 主效果使用一张 3 帧透明 RGBA 图集，动画由场景 update(deltaTime) 驱动，
 * 不创建定时器，也不依赖粒子系统或其它场景状态。
 */

export const GOAL_BURST_SHEET_URL = new URL(
  '../../assets/effects/basketball/goal-burst-sheet.png',
  import.meta.url,
).href;

export const GOAL_BURST_FRAME_WIDTH = 256;
export const GOAL_BURST_FRAME_HEIGHT = 256;
export const GOAL_BURST_FRAME_COUNT = 3;
export const GOAL_BURST_FRAME_DURATIONS = Object.freeze([0.1, 0.14, 0.16]);
export const GOAL_BURST_DURATION = GOAL_BURST_FRAME_DURATIONS.reduce((sum, duration) => sum + duration, 0);
export const GOAL_BURST_DISPLAY_SIZE = 176;

const SECONDARY_RING_DELAY = 0.05;
const SECONDARY_RING_DURATION = 0.28;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * 只负责一条当前进球光效；下一次 play 会替换已经结束或异常残留的状态。
 */
export class GoalBurstEffect {
  /**
   * @param {Object} [options]
   * @param {Object} [options.assetLoader] - 共享 AssetLoader，供真实运行时复用图片缓存
   * @param {HTMLImageElement|Object|null} [options.image] - 测试或预览时直接注入已加载图片
   */
  constructor({ assetLoader = null, image = null } = {}) {
    this.assetLoader = assetLoader;
    this.image = image;
    this.loadPromise = null;
    this.activeBurst = null;
    this.playCount = 0;
    this.lastDrawFrame = -1;

    if (!this.image) {
      this.load();
    }
  }

  /** 当前是否有仍在播放的非循环效果。 */
  get isActive() {
    return this.activeBurst !== null;
  }

  /** 当前活动效果的只读快照，便于运行时诊断和单元测试。 */
  get snapshot() {
    if (!this.activeBurst) return null;
    return { ...this.activeBurst, frameIndex: this.getFrameIndex() };
  }

  /**
   * 异步预加载主图集；失败时不抛到游戏主循环，调用方仍可安全清理效果状态。
   * @returns {Promise<HTMLImageElement|Object|null>}
   */
  load() {
    if (this.image) return Promise.resolve(this.image);
    if (this.loadPromise) return this.loadPromise;

    if (this.assetLoader?.loadImage) {
      this.loadPromise = this.assetLoader.loadImage(GOAL_BURST_SHEET_URL)
        .then((image) => {
          this.image = image || null;
          return this.image;
        })
        .catch(() => null);
      return this.loadPromise;
    }

    if (typeof Image === 'undefined') {
      this.loadPromise = Promise.resolve(null);
      return this.loadPromise;
    }

    this.loadPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        this.image = image;
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = GOAL_BURST_SHEET_URL;
    });
    return this.loadPromise;
  }

  /**
   * 启动一次新的非循环进球效果。
   * @param {Object} burst
   * @param {number} burst.x - 进球瞬间保存的篮筐中心 X
   * @param {number} burst.y - 进球瞬间保存的篮筐中心 Y
   * @param {boolean} [burst.enhanced=false] - 第 5 球的增强表现
   * @returns {boolean} 坐标有效且已启动时返回 true
   */
  play({ x, y, enhanced = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    this.activeBurst = {
      x,
      y,
      elapsed: 0,
      enhanced: Boolean(enhanced),
    };
    this.playCount += 1;
    this.lastDrawFrame = -1;
    return true;
  }

  /**
   * 使用场景现有 update(deltaTime) 推进动画；播放结束后自动释放当前状态。
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (!this.activeBurst) return;

    const safeDelta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    this.activeBurst.elapsed += safeDelta;
    if (this.activeBurst.elapsed >= GOAL_BURST_DURATION) {
      this.activeBurst = null;
      this.lastDrawFrame = -1;
    }
  }

  /** 当前帧索引，未播放时返回 -1。 */
  getFrameIndex() {
    if (!this.activeBurst) return -1;

    let elapsed = this.activeBurst.elapsed;
    for (let index = 0; index < GOAL_BURST_FRAME_DURATIONS.length; index += 1) {
      const duration = GOAL_BURST_FRAME_DURATIONS[index];
      if (elapsed < duration) return index;
      elapsed -= duration;
    }
    return GOAL_BURST_FRAME_COUNT - 1;
  }

  /**
   * 绘制一次主图集帧，并在第 5 球为主光效外围叠加一条更弱的二次光环。
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx || !this.activeBurst) return;

    const burst = this.activeBurst;
    const frameIndex = this.getFrameIndex();
    const displaySize = GOAL_BURST_DISPLAY_SIZE * (burst.enhanced ? 1.2 : 1);

    ctx.save();
    ctx.translate(burst.x, burst.y);

    if (burst.enhanced) {
      this._drawSecondaryRing(ctx, burst.elapsed, displaySize);
    }

    if (this.image) {
      // 图集第 3 帧已经包含碎光衰减，这里只补一个轻微的尾帧透明度变化。
      const frameAlpha = frameIndex === 2
        ? 0.92 - clamp((burst.elapsed - 0.24) / 0.16, 0, 1) * 0.18
        : 1;
      ctx.globalAlpha = frameAlpha;
      ctx.drawImage(
        this.image,
        frameIndex * GOAL_BURST_FRAME_WIDTH,
        0,
        GOAL_BURST_FRAME_WIDTH,
        GOAL_BURST_FRAME_HEIGHT,
        -displaySize / 2,
        -displaySize / 2,
        displaySize,
        displaySize,
      );
      this.lastDrawFrame = frameIndex;
    }

    ctx.restore();
  }

  /**
   * 第 5 球的弱二次光环只存在于主动画前半段，不产生新的粒子或计分路径。
   * @private
   */
  _drawSecondaryRing(ctx, elapsed, displaySize) {
    const progress = clamp(
      (elapsed - SECONDARY_RING_DELAY) / SECONDARY_RING_DURATION,
      0,
      1,
    );
    if (progress <= 0) return;

    const radius = displaySize * (0.18 + progress * 0.42);
    const alpha = (1 - progress) * 0.28;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FFD45C';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 场景退出、重开和销毁时调用，确保没有跨场景绘制状态。 */
  clear() {
    this.activeBurst = null;
    this.lastDrawFrame = -1;
  }
}
