import { NPC_ACTION_SPECS } from '../data/npcActionAssets.js';
import { FrameActionSprite } from './FrameActionSprite.js';

/**
 * 通用透明 NPC 绘制器。
 * 统一动作名称、资源加载、脚底锚点和缺动作回退，场景只负责把角色绑定到语义位置。
 */
export class NpcSprite extends FrameActionSprite {
  /**
   * @param {Object} options
   * @param {string} options.character - NPC 配置键
   * @param {Object<string, {src:string, config:Object}>} [options.specs] - 测试或特殊角色的覆盖清单
   * @param {import('./AssetLoader.js').AssetLoader} [options.assetLoader]
   * @param {number} [options.width=140] - 游戏内完整帧显示宽度
   * @param {number} [options.height=140] - 游戏内完整帧显示高度
   */
  constructor({ character, specs = null, assetLoader = null, width = 140, height = 140 } = {}) {
    const resolvedSpecs = specs || NPC_ACTION_SPECS[character] || {};
    super({
      assetLoader,
      width,
      height,
      defaultState: 'idle',
      specs: resolvedSpecs,
    });
    this.character = character || null;
  }

  /**
   * 判断动作是否同时存在于清单和动画定义中。
   * 只检查 Map 会漏掉“资源键存在但动作名缺失”的配置错误。
   * @param {string} name
   * @returns {boolean}
   * @private
   */
  _hasAction(name) {
    return Boolean(name && this.animations.get(name)?.sheet.animations[name]);
  }

  /**
   * 立即进入 idle 核心状态，保证缺失动作回退后本帧即可绘制，而不是等下一帧才出现。
   * @param {number} facing
   * @private
   */
  _fallbackToIdle(facing = 1) {
    this.clearAction();
    this.currentState = this.defaultState;
    const idleAnimation = this.animations.get(this.defaultState);
    if (!idleAnimation || !this._hasAction(this.defaultState)) return false;
    if (!idleAnimation.currentName) idleAnimation.play(this.defaultState);
    idleAnimation.setFlip(facing < 0);
    return true;
  }

  /**
   * 播放临时动作；不存在或配置不完整时安全回退到 idle。
   * @param {string} name
   * @param {Object} [options]
   * @returns {boolean}
   */
  playAction(name, options = {}) {
    if (!this._hasAction(name) || name === this.defaultState) {
      return this._fallbackToIdle(options.facing ?? 1);
    }
    return super.playAction(name, options);
  }

  /** 推进 NPC 核心状态；未知状态自动按 idle 处理。 */
  update(deltaTime, state = this.defaultState, facing = 1) {
    const nextState = this._hasAction(state) ? state : this.defaultState;
    super.update(deltaTime, nextState, facing);
  }

  /**
   * NPC 动作不放大临时动作，确保 interact/专属动作与 idle 共享同一脚底线和比例。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {Object} [options]
   * @returns {boolean}
   */
  draw(ctx, x, y, { alpha = 1, width = null, height = null, flipX = null } = {}) {
    return super.draw(ctx, x, y, {
      alpha,
      width: width ?? this.width,
      height: height ?? this.height,
      flipX,
    });
  }
}
