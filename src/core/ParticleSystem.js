/**
 * 可复用粒子系统（对应 PRD §7.7 特效资源 + Task 4.2）
 *
 * 提供四种预设特效：dust（奔跑尘土）、sparkle（进球光效）、
 * ember（黄昏余烬）、flash（印记收集闪光）。
 * 支持 FPS 降级：帧率低于阈值时跳过新粒子生成，避免低端设备卡顿。
 *
 * 使用方式：
 *   const ps = new ParticleSystem({ getFps: () => game.fps });
 *   ps.emit(x, y, 'sparkle');      // 发射粒子
 *   ps.update(deltaTime);           // 每帧更新
 *   ps.draw(ctx);                   // 每帧渲染
 *   ps.clear();                     // 场景退出时清理
 */

/** 粒子特效预设配置（对应 PRD §7.7 特效清单） */
export const PARTICLE_PRESETS = {
  /** 奔跑尘土：棕色粒子向后方散开，受重力下落与摩擦力衰减 */
  dust: {
    count: 6,
    speed: 60,
    life: 0.5,
    size: 3,
    color: '#a8a29e',
    gravity: 200,
    friction: 0.92,
    spread: Math.PI * 0.5,
    direction: Math.PI,
  },
  /** 进球光效：金色粒子径向爆发，无重力，快速消散 */
  sparkle: {
    // 正式三帧图集承担主视觉；这里只保留少量外围碎光，避免双重爆炸感。
    count: 6,
    speed: 150,
    life: 0.6,
    size: 2.5,
    color: '#fbbf24',
    gravity: 0,
    friction: 0.94,
    spread: Math.PI * 2,
    direction: 0,
  },
  /** 黄昏余烬：金色小点向上飘散，无重力，长生命周期 */
  ember: {
    count: 8,
    speed: 30,
    life: 3.5,
    size: 2.5,
    color: '#f59e0b',
    gravity: 0,
    friction: 0.99,
    spread: Math.PI * 0.3,
    direction: -Math.PI / 2,
  },
  /** 印记收集闪光：白色粒子爆发，极短生命周期 */
  flash: {
    count: 18,
    speed: 220,
    life: 0.35,
    size: 5,
    color: '#ffffff',
    gravity: 0,
    friction: 0.88,
    spread: Math.PI * 2,
    direction: 0,
  },
};

/** FPS 降级阈值，低于此值时跳过新粒子发射 */
const FPS_DEGRADATION_THRESHOLD = 30;

/**
 * 粒子系统，管理粒子的发射、更新与渲染。
 */
export class ParticleSystem {
  /**
   * @param {Object} [options] - 初始化选项
   * @param {Function} [options.getFps] - FPS 获取函数，返回当前帧率；未提供时默认 60
   */
  constructor({ getFps } = {}) {
    /** @type {Array<Object>} 活跃粒子列表 */
    this.particles = [];
    /** @type {Function} FPS 获取函数 */
    this._getFps = getFps || (() => 60);
    /** @type {number} FPS 降级阈值 */
    this.fpsThreshold = FPS_DEGRADATION_THRESHOLD;
  }

  /**
   * 当前活跃粒子数量
   * @returns {number}
   */
  get count() {
    return this.particles.length;
  }

  /**
   * 动态设置 FPS 来源（如切换场景后更新引用）
   * @param {Function} getFps - 返回当前 FPS 的函数
   */
  setFpsProvider(getFps) {
    this._getFps = getFps || (() => 60);
  }

  /**
   * 在指定位置发射一批粒子
   * FPS 低于阈值时跳过发射以保护帧率（对应 PRD §6.3 移动端降级）
   * @param {number} x - 发射中心 X 坐标
   * @param {number} y - 发射中心 Y 坐标
   * @param {string} presetName - 预设名称（dust/sparkle/ember/flash）
   */
  emit(x, y, presetName) {
    // FPS 降级：低于阈值时跳过新粒子生成
    if (this._getFps() < this.fpsThreshold) return;

    const preset = PARTICLE_PRESETS[presetName];
    if (!preset) return;

    for (let i = 0; i < preset.count; i++) {
      this.particles.push(this._createParticle(x, y, preset));
    }
  }

  /**
   * 根据预设创建单个粒子
   * 速度方向在预设 direction ± spread/2 范围内随机分布
   * @param {number} x - 发射中心 X
   * @param {number} y - 发射中心 Y
   * @param {Object} preset - 预设配置
   * @returns {Object} 粒子对象
   * @private
   */
  _createParticle(x, y, preset) {
    // 在预设方向 ± spread/2 范围内随机取角度
    const halfSpread = preset.spread / 2;
    const angle = preset.direction + (Math.random() - 0.5) * 2 * halfSpread;
    // 速度大小随机化（50%~100% 预设速度），使粒子有层次感
    const speed = preset.speed * (0.5 + Math.random() * 0.5);

    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: preset.life,
      maxLife: preset.life,
      size: preset.size * (0.7 + Math.random() * 0.6),
      color: preset.color,
      gravity: preset.gravity,
      friction: preset.friction,
    };
  }

  /**
   * 每帧更新所有粒子：移动、施加重力与摩擦力、移除生命耗尽的粒子
   * 从尾部向前遍历以安全删除元素
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // 生命衰减
      p.life -= deltaTime;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // 位置更新
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;

      // 重力影响垂直速度
      if (p.gravity) {
        p.vy += p.gravity * deltaTime;
      }

      // 摩擦力衰减速度
      if (p.friction && p.friction < 1) {
        p.vx *= p.friction;
        p.vy *= p.friction;
      }
    }
  }

  /**
   * 渲染所有粒子：透明度随剩余生命递减
   * @param {CanvasRenderingContext2D} ctx - 2D 绘图上下文
   */
  draw(ctx) {
    if (!ctx || this.particles.length === 0) return;

    ctx.save();
    for (const p of this.particles) {
      // 透明度按剩余生命比例递减，实现淡出效果
      const alpha = Math.min(1, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 清空所有粒子（场景退出时调用）
   */
  clear() {
    this.particles = [];
  }
}
