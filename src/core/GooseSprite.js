import { SpriteAnimation } from './SpriteAnimation.js';
import idleConfig from '../../assets/characters/gxe/gxe_idle.json';
import walkConfig from '../../assets/characters/gxe/gxe_walk.json';
import runConfig from '../../assets/characters/gxe/gxe_run.json';

/**
 * 莞小鹅核心序列帧资源清单。
 * 通过 import.meta.url 让 Vite 在开发与生产构建中都能正确收集 PNG 资源。
 */
export const GXE_SPRITE_SPECS = {
  idle: {
    config: idleConfig,
    src: new URL('../../assets/characters/gxe/gxe_idle_sheet.png', import.meta.url).href,
  },
  walk: {
    config: walkConfig,
    src: new URL('../../assets/characters/gxe/gxe_walk_sheet.png', import.meta.url).href,
  },
  run: {
    config: runConfig,
    src: new URL('../../assets/characters/gxe/gxe_run_sheet.png', import.meta.url).href,
  },
};

/** 叙事过场专用姿态，不参与常规 idle / walk / run 状态机。 */
export const GXE_CINEMATIC_SPECS = {
  climb: {
    src: new URL('../../assets/characters/gxe/gxe_climb_pose.png', import.meta.url).href,
    anchorX: 0.5,
    anchorY: 0.82,
  },
};

/**
 * 游戏内莞小鹅绘制器。
 * 角色逻辑仍由 PlayerController 负责，绘制器只负责资源加载、动画帧推进与朝向翻转。
 */
export class GooseSprite {
  /**
   * @param {Object} [options]
   * @param {import('./AssetLoader.js').AssetLoader} [options.assetLoader]
   * @param {number} [options.width=124] - 游戏内显示宽度
   * @param {number} [options.height=124] - 游戏内显示高度
   */
  constructor({ assetLoader = null, width = 124, height = 124 } = {}) {
    this.assetLoader = assetLoader;
    this.width = width;
    this.height = height;
    this.images = new Map();
    this.actionImages = new Map();
    this.animations = new Map(
      Object.entries(GXE_SPRITE_SPECS).map(([name, spec]) => [name, new SpriteAnimation(spec.config)]),
    );
    this.currentState = 'idle';
    this.ready = false;
    this.loadError = null;
    this.loadPromise = null;
    this.actionLoadPromise = null;
  }

  /**
   * 预加载三组核心动画，单次调用共享 Promise，避免场景切换重复请求。
   * @returns {Promise<GooseSprite>}
   */
  async load() {
    if (this.loadPromise) return this.loadPromise;

    // 过场姿态与核心序列帧并行加载；过场资源失败不影响常规移动动画。
    this.actionLoadPromise = Promise.all(
      Object.entries(GXE_CINEMATIC_SPECS).map(async ([name, spec]) => {
        try {
          const image = this.assetLoader
            ? await this.assetLoader.loadImage(spec.src)
            : await this._loadImage(spec.src);
          this.actionImages.set(name, image);
        } catch (error) {
          // 过场资源允许降级为常规序列帧，不阻断游戏启动。
          this.actionImages.delete(name);
          this.loadError = this.loadError || error;
        }
      }),
    );

    this.loadPromise = Promise.all(
      Object.entries(GXE_SPRITE_SPECS).map(async ([name, spec]) => {
        const image = this.assetLoader
          ? await this.assetLoader.loadImage(spec.src)
          : await this._loadImage(spec.src);
        this.images.set(name, image);
      }),
    )
      .then(() => {
        this.ready = true;
        return this;
      })
      .catch((error) => {
        this.loadError = error;
        return this;
      });

    return this.loadPromise;
  }

  /**
   * 绘制叙事过场姿态。
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} actionName - cinematic action 名称
   * @param {number} x - 逻辑锚点 X
   * @param {number} y - 逻辑锚点 Y
   * @param {Object} [options]
   * @param {number} [options.alpha=1]
   * @param {number} [options.width=this.width * 2.2]
   * @param {number} [options.height=this.height * 2.2]
   * @param {boolean} [options.flipX=false]
   * @returns {boolean}
   */
  drawAction(ctx, actionName, x, y, {
    alpha = 1,
    width = this.width * 2.2,
    height = this.height * 2.2,
    flipX = false,
  } = {}) {
    const spec = GXE_CINEMATIC_SPECS[actionName];
    const image = this.actionImages.get(actionName);
    if (!ctx || !spec || !image) return false;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(
      image,
      -width * spec.anchorX,
      -height * spec.anchorY,
      width,
      height,
    );
    ctx.restore();
    return true;
  }

  /**
   * 推进当前状态的动画并同步玩家朝向。
   * @param {number} deltaTime - 帧间隔（秒）
   * @param {string} [state='idle'] - idle / walk / run
   * @param {number} [facing=1] - 1 向右，-1 向左
   */
  update(deltaTime, state = 'idle', facing = 1) {
    const nextState = this.animations.has(state) ? state : 'idle';
    const animation = this.animations.get(nextState);
    if (nextState !== this.currentState) {
      this.currentState = nextState;
      animation.play(nextState);
    } else if (!animation.currentName) {
      animation.play(nextState);
    }
    animation.setFlip(facing < 0);
    animation.update(deltaTime);
  }

  /**
   * 绘制角色。资源尚未完成加载时返回 false，由场景保留兼容性占位绘制。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 角色锚点 X
   * @param {number} y - 角色脚底附近的逻辑锚点 Y
   * @param {Object} [options]
   * @param {number} [options.alpha=1] - 透明度，用于躲藏状态
   * @param {number} [options.width=this.width]
   * @param {number} [options.height=this.height]
   * @returns {boolean}
   */
  draw(ctx, x, y, { alpha = 1, width = this.width, height = this.height } = {}) {
    const animation = this.animations.get(this.currentState);
    const image = this.images.get(this.currentState);
    const frame = animation?.getCurrentFrame();
    if (!ctx || !image || !frame) return false;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (animation.flipX) ctx.scale(-1, 1);
    ctx.drawImage(
      image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      -width * frame.anchorX,
      -height * frame.anchorY,
      width,
      height,
    );
    ctx.restore();
    return true;
  }

  /**
   * 使用原生 Image 作为没有 AssetLoader 注入时的轻量回退。
   * @param {string} src
   * @returns {Promise<HTMLImageElement>}
   * @private
   */
  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`莞小鹅序列帧加载失败: ${src}`));
      image.src = src;
    });
  }
}
