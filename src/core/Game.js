import { GAME } from '../config.js';

/**
 * 游戏主类，负责 requestAnimationFrame 主循环。
 * 采用 update(deltaTime) + render(ctx) 分离模式，deltaTime 钳制防止切后台后大跳跃。
 * 场景通过 setScene 注入，主循环只调用当前场景的 update/draw。
 */
export class Game {
  /**
   * @param {Object} options - 初始化选项
   * @param {CanvasRenderingContext2D} [options.ctx] - 2D 绘图上下文（可选，无则仅跑逻辑）
   */
  constructor({ ctx } = {}) {
    this.ctx = ctx || null;
    this.currentScene = null;
    this.running = false;
    this.lastTime = 0;
    this.rafId = null;
    /** @type {number} 当前帧率（每帧更新，供粒子系统降级使用） */
    this.fps = 60;
  }

  /**
   * 设置当前场景
   * 主循环不关心场景切换生命周期，SceneManager 负责调用 onEnter/onExit
   * @param {Object} scene - 场景对象，需实现 update(deltaTime) 与 draw(ctx)
   */
  setScene(scene) {
    this.currentScene = scene;
  }

  /**
   * 启动主循环
   * 记录起始时间，首次 rAF 触发后开始累计 deltaTime
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    // _loop 是箭头函数类字段，已绑定 this，无需额外 bind
    this.rafId = requestAnimationFrame(this._loop);
  }

  /**
   * 停止主循环
   * 取消待执行的 rAF，标记 running 为 false
   */
  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * 手动触发一次 update（测试用，不依赖 rAF）
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    if (this.currentScene && this.currentScene.update) {
      this.currentScene.update(deltaTime);
    }
  }

  /**
   * rAF 回调：计算 deltaTime、钳制、调用 update + draw，继续请求下一帧
   * 箭头函数绑定 this，避免每次 rAF 重新 bind
   * @param {number} timestamp - rAF 传入的高精度时间戳（毫秒）
   */
  _loop = (timestamp) => {
    if (!this.running) return;

    // 计算帧间隔并钳制，防止切后台后大跳跃
    let deltaTime = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    if (deltaTime > GAME.MAX_DELTA_TIME) {
      deltaTime = GAME.MAX_DELTA_TIME;
    }
    // 避免首帧负值
    if (deltaTime < 0) {
      deltaTime = 0;
    }

    // 实时帧率计算（供粒子系统 FPS 降级判断）
    if (deltaTime > 0) {
      this.fps = 1 / deltaTime;
    }

    this.update(deltaTime);
    this._render();

    this.rafId = requestAnimationFrame(this._loop);
  };

  /**
   * 渲染当前场景
   * 无场景时静默跳过；ctx 可能为 null（纯逻辑测试），场景自行判断是否绘制
   * @private
   */
  _render() {
    if (this.currentScene && this.currentScene.draw) {
      this.currentScene.draw(this.ctx);
    }
  }
}
