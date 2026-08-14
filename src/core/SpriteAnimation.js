/**
 * 序列帧动画系统（对应 PRD §6.2 关键技术需求 2 + Task 1.3）
 * sprite sheet 图集 + JSON 配置，每动画独立帧率与循环模式。
 * 支持左右翻转（scaleX）与状态机切换，动画帧率与渲染帧率解耦。
 */

/**
 * 图集管理：从 JSON 配置构建帧坐标
 * JSON 结构: { atlas: { src, frameW, frameH }, animations: { name: { row, frames, fps, loop, frameAnchors? } } }
 */
export class SpriteSheet {
  /**
   * @param {Object} config - 动画 JSON 配置
   * @param {Object} config.atlas - 图集信息 { src, frameW, frameH }
   * @param {Object} config.animations - 动画定义 { name: { row, frames, fps, loop, anchorX?, anchorY?, frameAnchors? } }
   */
  constructor(config) {
    this.frameW = config.atlas.frameW;
    this.frameH = config.atlas.frameH;
    /** @type {number|null} 图集的列数；未声明时兼容旧版单行图集 */
    this.columns = config.atlas.columns ?? null;
    /** @type {number|null} 图集的行数，用于资源审计与调试 */
    this.rows = config.atlas.rows ?? null;
    this.animations = config.animations;
  }

  /**
   * 获取指定动画指定帧的图集坐标
   * @param {string} animName - 动画名
   * @param {number} frameIndex - 帧索引
   * @returns {{x: number, y: number, w: number, h: number, anchorX: number, anchorY: number}}
   */
  getFrame(animName, frameIndex) {
    const anim = this.animations[animName];
    if (!anim) {
      throw new Error(`动画不存在: ${animName}`);
    }

    // 帧索引取模循环
    const index = ((frameIndex % anim.frames) + anim.frames) % anim.frames;

    // 新版图集使用 columns 将帧排成多行，旧版未声明 columns 时仍按单行处理。
    const columns = anim.columns ?? this.columns;
    const column = columns ? index % columns : index;
    const row = (anim.row ?? 0) + (columns ? Math.floor(index / columns) : 0);
    const frameAnchor = anim.frameAnchors?.[index] || {};

    return {
      x: column * this.frameW,
      y: row * this.frameH,
      w: this.frameW,
      h: this.frameH,
      // 逐帧锚点优先，兼容没有逐帧对齐数据的旧图集。
      anchorX: frameAnchor.x ?? anim.anchorX ?? 0.5,
      anchorY: frameAnchor.y ?? anim.anchorY ?? 0.5,
    };
  }
}

/**
 * 动画播放器：按动画 FPS 推进帧索引，与渲染帧率解耦
 */
export class SpriteAnimation {
  /**
   * @param {Object} config - 动画 JSON 配置
   */
  constructor(config) {
    this.sheet = new SpriteSheet(config);
    /** @type {string|null} 当前播放的动画名 */
    this.currentName = null;
    /** @type {number} 当前帧索引 */
    this.frameIndex = 0;
    /** @type {number} 帧时间累计（秒） */
    this.elapsed = 0;
    /** @type {boolean} 是否暂停 */
    this.paused = false;
    /** @type {boolean} 水平翻转标记 */
    this.flipX = false;
  }

  /**
   * 播放指定动画，帧号归零
   * @param {string} name - 动画名
   */
  play(name) {
    this.currentName = name;
    this.frameIndex = 0;
    this.elapsed = 0;
    this.paused = false;
  }

  /**
   * 暂停播放
   */
  pause() {
    this.paused = true;
  }

  /**
   * 恢复播放
   */
  resume() {
    this.paused = false;
  }

  /**
   * 停止播放并清空状态
   */
  stop() {
    this.currentName = null;
    this.frameIndex = 0;
    this.elapsed = 0;
    this.paused = false;
  }

  /**
   * 切换动画（状态机辅助）
   * 相同动画不重置帧号，不同动画重置
   * @param {string} name - 目标动画名
   */
  switchAnim(name) {
    if (this.currentName === name) return;
    this.play(name);
  }

  /**
   * 设置水平翻转
   * @param {boolean} flip
   */
  setFlip(flip) {
    this.flipX = flip;
  }

  /**
   * 按帧时间推进动画
   * 帧率与渲染帧率解耦：按动画自身的 FPS 计算帧推进
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    if (!this.currentName || this.paused) return;

    const anim = this.sheet.animations[this.currentName];
    if (!anim) return;

    this.elapsed += deltaTime;
    const frameDuration = 1 / anim.fps;

    // 累计时间超过一帧 → 推进帧号
    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      this.frameIndex++;

      // 循环模式：取模回到开头
      if (this.frameIndex >= anim.frames) {
        if (anim.loop) {
          this.frameIndex = 0;
        } else {
          // 非循环：停在最后一帧
          this.frameIndex = anim.frames - 1;
          this.elapsed = 0;
          break;
        }
      }
    }
  }

  /**
   * 获取当前帧的图集坐标
   * @returns {{x: number, y: number, w: number, h: number}|null}
   */
  getCurrentFrame() {
    if (!this.currentName) return null;
    return this.sheet.getFrame(this.currentName, this.frameIndex);
  }
}
