import idleConfig from '../../assets/characters/gxe/gxe_idle.json';
import walkConfig from '../../assets/characters/gxe/gxe_walk.json';
import runConfig from '../../assets/characters/gxe/gxe_run.json';
import { GXE_ACTION_SPECS } from '../data/actionAssets.js';
import { FrameActionSprite } from './FrameActionSprite.js';

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
    // 当前 run 图集的独立帧主要是角色在格子内的位移，双足相位不够明显；
    // 运行时改用已有 walk 图集的真实交替迈步帧，并以 run FPS 播放，
    // 让奔跑状态在画面上明确表现为连续步态，而不是一组近似静态姿势。
    config: {
      atlas: walkConfig.atlas,
      animations: {
        run: {
          ...walkConfig.animations.walk,
          fps: runConfig.animations.run.fps,
          motion: runConfig.animations.run.motion,
        },
      },
    },
    src: new URL('../../assets/characters/gxe/gxe_walk_sheet.png', import.meta.url).href,
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
 * 角色逻辑仍由 PlayerController 负责；绘制器负责 core 移动动画、
 * 独立动作组、资源加载、动画帧推进与朝向翻转。
 */
export class GooseSprite extends FrameActionSprite {
  /**
   * @param {Object} [options]
   * @param {import('./AssetLoader.js').AssetLoader} [options.assetLoader]
   * @param {number} [options.width=124] - 游戏内显示宽度
   * @param {number} [options.height=124] - 游戏内显示高度
   */
  constructor({ assetLoader = null, width = 124, height = 124 } = {}) {
    super({
      assetLoader,
      width,
      height,
      defaultState: 'idle',
      specs: { ...GXE_SPRITE_SPECS, ...GXE_ACTION_SPECS },
    });
    this.actionImages = new Map();
    this.cinematicLoadPromise = null;
  }

  /** 预加载 core、独立动作组与过场姿态。 */
  async load() {
    if (this.cinematicLoadPromise) return this.cinematicLoadPromise;

    const spriteLoadPromise = super.load();
    this.cinematicLoadPromise = Promise.all([
      spriteLoadPromise,
      ...Object.entries(GXE_CINEMATIC_SPECS).map(async ([name, spec]) => {
        try {
          const image = this.assetLoader
            ? await this.assetLoader.loadImage(spec.src)
            : await this._loadImage(spec.src);
          this.actionImages.set(name, image);
        } catch (error) {
          // 过场资源允许降级为常规序列帧，不阻断动作资源使用。
          this.actionImages.delete(name);
          this.loadError = this.loadError || error;
        }
      }),
    ]).then(() => this);

    return this.cinematicLoadPromise;
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
}
