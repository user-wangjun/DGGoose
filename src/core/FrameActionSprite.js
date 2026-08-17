import { SpriteAnimation } from './SpriteAnimation.js';

/**
 * 独立动作序列帧播放器。
 *
 * core 状态（idle / walk / run 或 patrol）与临时动作共用同一套帧播放器，
 * 但动作资源仍按动作组分别加载。临时动作结束后自动回到 core 状态；
 * hold=true 时停在动作最后一帧，交由场景显式 clearAction()。
 */
export class FrameActionSprite {
  /**
   * @param {Object} options
   * @param {Object<string, {src:string, config:Object}>} options.specs
   * @param {string} [options.defaultState]
   * @param {Object} [options.assetLoader]
   * @param {number} [options.width=124]
   * @param {number} [options.height=124]
   */
  constructor({ specs, defaultState, assetLoader = null, width = 124, height = 124 }) {
    this.specs = specs || {};
    this.defaultState = defaultState || Object.keys(this.specs)[0] || null;
    this.assetLoader = assetLoader;
    this.width = width;
    this.height = height;
    this.images = new Map();
    this.animations = new Map(
      Object.entries(this.specs).map(([name, spec]) => [name, new SpriteAnimation(spec.config)]),
    );
    this.currentState = this.defaultState;
    this.currentAction = null;
    this.actionElapsed = 0;
    this.actionHold = false;
    this.actionResetCoreFrame = false;
    this.actionFinished = false;
    this.ready = false;
    this.loadError = null;
    this.loadPromise = null;
    this.stateLoadPromises = new Map();
    this.failedStates = new Set();
  }

  /**
   * 预加载指定动作图集；默认只加载待机图，其他动作在真正使用时再加载。
   * 移动端不能在首屏同时解码所有角色动作，否则会挤压场景背景的解码内存。
   * @param {string|string[]} [states]
   * @param {{retry?: boolean}} [options]
   */
  load(states = [this.defaultState], { retry = false } = {}) {
    const requestedStates = (Array.isArray(states) ? states : [states])
      .filter((name) => typeof name === 'string' && this.specs[name]);

    this.loadPromise = Promise.all(
      requestedStates.map((name) => this.loadState(name, { retry })),
    ).then(() => {
      this.ready = true;
      return this;
    });

    return this.loadPromise;
  }

  /** 按需加载一个动作图集；同一动作的并发调用共享同一 Promise。 */
  loadState(name, { retry = false } = {}) {
    const spec = this.specs[name];
    if (!spec) return Promise.resolve(null);
    if (this.images.has(name)) return Promise.resolve(this.images.get(name));
    if (retry) this.failedStates.delete(name);
    if (this.failedStates.has(name)) return Promise.resolve(null);
    if (this.stateLoadPromises.has(name)) return this.stateLoadPromises.get(name);

    const promise = (async () => {
      try {
        const image = this.assetLoader
          ? await this.assetLoader.loadImage(spec.src)
          : await this._loadImage(spec.src);
        this.images.set(name, image);
        this.failedStates.delete(name);
        return image;
      } catch (error) {
        this.loadError = this.loadError || error;
        this.images.delete(name);
        this.failedStates.add(name);
        return null;
      }
    })();

    this.stateLoadPromises.set(name, promise);
    promise.then(
      () => {
        if (this.stateLoadPromises.get(name) === promise) this.stateLoadPromises.delete(name);
      },
      () => {
        if (this.stateLoadPromises.get(name) === promise) this.stateLoadPromises.delete(name);
      },
    );
    return promise;
  }

  /** 运行时切换状态时才请求对应图集，避免无意义的移动端解码。 */
  _requestStateLoad(name) {
    if (this.ready || this.assetLoader || this.loadPromise) {
      this.loadState(name);
    }
  }

  /**
   * 开始一个临时动作。
   * @param {string} name
   * @param {Object} [options]
     * @param {number} [options.facing=1]
     * @param {boolean} [options.hold=false]
     * @param {boolean} [options.restart=false]
     * @param {boolean} [options.resetCoreFrame=false] - 动作结束后将 core 状态重置到第 0 帧
     * @returns {boolean}
     */
  playAction(name, {
    facing = 1,
    hold = false,
    restart = false,
    resetCoreFrame = false,
  } = {}) {
    const animation = this.animations.get(name);
    if (!animation) return false;

    this._requestStateLoad(name);

    if (!restart && this.currentAction === name) {
      this.actionHold = this.actionHold || hold;
      return true;
    }

    this.currentAction = name;
    this.actionElapsed = 0;
    this.actionHold = hold;
    this.actionResetCoreFrame = resetCoreFrame;
    this.actionFinished = false;
    animation.play(name);
    animation.setFlip(facing < 0);
    return true;
  }

  /** 清除临时动作并回到 core 状态。 */
  clearAction() {
    if (this.currentAction) {
      this.animations.get(this.currentAction)?.stop();
    }
    this.currentAction = null;
    this.actionElapsed = 0;
    this.actionHold = false;
    this.actionResetCoreFrame = false;
    this.actionFinished = false;
  }

  /** @returns {boolean} 是否正在播放指定动作或任意临时动作 */
  isActionActive(name = null) {
    return name ? this.currentAction === name : this.currentAction !== null;
  }

  /**
   * 推进动作；没有临时动作时推进默认 core 状态。
   * @param {number} deltaTime
   * @param {string} [state]
   * @param {number} [facing=1]
   */
  update(deltaTime, state = this.defaultState, facing = 1) {
    let actionResetCoreFrame = false;
    if (this.currentAction) {
      const animation = this.animations.get(this.currentAction);
      const definition = animation?.sheet.animations[this.currentAction];
      if (!animation || !definition) {
        this.clearAction();
      } else {
        animation.update(deltaTime);
        if (!definition.loop && !this.actionFinished) {
          this.actionElapsed += Math.max(0, deltaTime);
          if (this.actionElapsed >= definition.frames / definition.fps) {
            animation.frameIndex = definition.frames - 1;
            animation.elapsed = 0;
            if (this.actionHold) {
              this.actionFinished = true;
            } else {
              actionResetCoreFrame = this.actionResetCoreFrame;
              this.clearAction();
            }
          }
        }
        if (this.currentAction) return;
      }
    }

    const nextState = this.animations.has(state) ? state : this.defaultState;
    if (!nextState) return;
    const animation = this.animations.get(nextState);
    if (actionResetCoreFrame) {
      this.currentState = nextState;
      this._requestStateLoad(nextState);
      animation.play(nextState);
      animation.setFlip(facing < 0);
      // 保证动作结束这一帧就显示 core 的第 0 帧，而不是被同一帧 deltaTime 推进。
      return;
    }
    if (nextState !== this.currentState) {
      this.currentState = nextState;
      this._requestStateLoad(nextState);
      animation.play(nextState);
    } else if (!animation.currentName) {
      this._requestStateLoad(nextState);
      animation.play(nextState);
    }
    animation.setFlip(facing < 0);
    animation.update(deltaTime);
  }

  /**
   * 绘制当前帧。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {Object} [options]
   * @returns {boolean}
   */
  draw(ctx, x, y, { alpha = 1, width = null, height = null, flipX = null } = {}) {
    const state = this.currentAction || this.currentState;
    const animation = this.animations.get(state);
    const image = this.images.get(state);
    const frame = animation?.getCurrentFrame();
    if (!ctx || !image || !frame) return false;

    const defaultSize = this.currentAction ? 1.45 : 1;
    const drawWidth = width ?? this.width * defaultSize;
    const drawHeight = height ?? this.height * defaultSize;
    const shouldFlip = flipX === null ? animation.flipX : flipX;
    const definition = animation.sheet.animations[state];
    const motion = definition?.motion;
    const hasMotion = motion && definition.frames > 1 && Number.isFinite(definition.fps);
    const fractionalFrame = hasMotion
      ? animation.frameIndex + (animation.elapsed * definition.fps)
      : 0;
    const phase = hasMotion
      ? (fractionalFrame / definition.frames) * Math.PI * 2
      : 0;
    const facingSign = shouldFlip ? -1 : 1;
    const offsetX = hasMotion ? Math.sin(phase) * (Number(motion.sway) || 0) * facingSign : 0;
    const offsetY = hasMotion ? Math.sin(phase * 2) * (Number(motion.bob) || 0) : 0;
    const rotation = hasMotion ? Math.sin(phase) * (Number(motion.tilt) || 0) : 0;
    const squash = hasMotion ? Math.cos(phase * 2) * (Number(motion.squash) || 0) : 0;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x + offsetX, y + offsetY);
    if (rotation && typeof ctx.rotate === 'function') ctx.rotate(rotation);
    const scaleX = (shouldFlip ? -1 : 1) * (1 + squash);
    const scaleY = 1 - squash;
    if ((scaleX !== 1 || scaleY !== 1) && typeof ctx.scale === 'function') {
      ctx.scale(scaleX, scaleY);
    }
    ctx.drawImage(
      image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      -drawWidth * frame.anchorX,
      -drawHeight * frame.anchorY,
      drawWidth,
      drawHeight,
    );
    ctx.restore();
    return true;
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`动作序列帧加载失败: ${src}`));
      image.src = src;
    });
  }
}
