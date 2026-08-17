import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParticleSystem, PARTICLE_PRESETS } from '../../src/core/ParticleSystem.js';

/**
 * 粒子系统单元测试（对应 PRD §7.7 特效资源 + Task 4.2）
 * 验证粒子发射、更新、生命周期、FPS 降级与预设配置。
 */
describe('ParticleSystem', () => {
  let ps;

  beforeEach(() => {
    ps = new ParticleSystem();
  });

  // ==================== 基础功能 ====================

  it('新建实例时粒子数组为空', () => {
    expect(ps.count).toBe(0);
    expect(ps.particles).toEqual([]);
  });

  it('emit 使用有效预设时生成粒子', () => {
    ps.emit(100, 200, 'sparkle');
    expect(ps.count).toBe(PARTICLE_PRESETS.sparkle.count);
  });

  it('emit 使用未知预设时不生成粒子', () => {
    ps.emit(100, 200, 'unknown_preset');
    expect(ps.count).toBe(0);
  });

  it('emit 生成的粒子包含坐标、速度、生命值等字段', () => {
    ps.emit(50, 60, 'sparkle');
    const p = ps.particles[0];
    expect(p).toHaveProperty('x');
    expect(p).toHaveProperty('y');
    expect(p).toHaveProperty('vx');
    expect(p).toHaveProperty('vy');
    expect(p).toHaveProperty('life');
    expect(p).toHaveProperty('maxLife');
    expect(p).toHaveProperty('color');
    expect(p).toHaveProperty('size');
  });

  // ==================== 更新逻辑 ====================

  it('update 按速度移动粒子', () => {
    ps.emit(100, 100, 'sparkle');
    const p = ps.particles[0];
    const oldX = p.x;
    const oldY = p.y;
    const dt = 0.5;
    const expectedX = oldX + p.vx * dt;
    const expectedY = oldY + p.vy * dt;

    ps.update(dt);

    expect(p.x).toBeCloseTo(expectedX, 5);
    expect(p.y).toBeCloseTo(expectedY, 5);
  });

  it('update 生命耗尽的粒子被移除', () => {
    ps.emit(100, 100, 'sparkle');
    expect(ps.count).toBeGreaterThan(0);

    // 推进足够长时间让所有粒子生命耗尽
    ps.update(100);

    expect(ps.count).toBe(0);
  });

  it('update 多次小步推进后粒子生命正确递减', () => {
    ps.emit(0, 0, 'sparkle');
    const initialLife = ps.particles[0].life;

    ps.update(0.1);
    ps.update(0.1);

    expect(ps.particles[0].life).toBeCloseTo(initialLife - 0.2, 5);
  });

  it('update 应用重力影响垂直速度', () => {
    ps.emit(100, 100, 'dust');
    const p = ps.particles[0];
    const initialVy = p.vy;

    // 使用小于生命周期的 dt 确保粒子存活，验证重力加速效果
    ps.update(0.2);

    // dust 预设有重力，vy 应增加（向下加速）
    expect(p.vy).toBeGreaterThan(initialVy);
  });

  it('update 应用摩擦力衰减水平速度', () => {
    ps.emit(100, 100, 'dust');
    const p = ps.particles[0];
    const initialVxAbs = Math.abs(p.vx);

    ps.update(0.5);

    // dust 预设有摩擦力，vx 绝对值应减小
    expect(Math.abs(p.vx)).toBeLessThanOrEqual(initialVxAbs);
  });

  // ==================== 清理 ====================

  it('clear 清空所有粒子', () => {
    ps.emit(100, 100, 'sparkle');
    ps.emit(200, 200, 'ember');
    expect(ps.count).toBeGreaterThan(0);

    ps.clear();

    expect(ps.count).toBe(0);
    expect(ps.particles).toEqual([]);
  });

  // ==================== FPS 降级 ====================

  it('FPS 低于阈值时 emit 跳过粒子生成', () => {
    const lowFpsProvider = () => 20;
    const thresholdPs = new ParticleSystem({ getFps: lowFpsProvider });

    thresholdPs.emit(100, 100, 'sparkle');

    expect(thresholdPs.count).toBe(0);
  });

  it('FPS 等于阈值时仍可生成粒子', () => {
    const thresholdFpsProvider = () => 30;
    const thresholdPs = new ParticleSystem({ getFps: thresholdFpsProvider });

    thresholdPs.emit(100, 100, 'sparkle');

    expect(thresholdPs.count).toBe(PARTICLE_PRESETS.sparkle.count);
  });

  it('FPS 高于阈值时正常生成粒子', () => {
    const highFpsProvider = () => 60;
    const highFpsPs = new ParticleSystem({ getFps: highFpsProvider });

    highFpsPs.emit(100, 100, 'sparkle');

    expect(highFpsPs.count).toBe(PARTICLE_PRESETS.sparkle.count);
  });

  it('未提供 getFps 时默认允许生成粒子', () => {
    const defaultPs = new ParticleSystem();

    defaultPs.emit(100, 100, 'sparkle');

    expect(defaultPs.count).toBe(PARTICLE_PRESETS.sparkle.count);
  });

  // ==================== 预设配置 ====================

  it('PARTICLE_PRESETS 包含 dust/sparkle/ember/flash 四种预设', () => {
    expect(PARTICLE_PRESETS).toHaveProperty('dust');
    expect(PARTICLE_PRESETS).toHaveProperty('sparkle');
    expect(PARTICLE_PRESETS).toHaveProperty('ember');
    expect(PARTICLE_PRESETS).toHaveProperty('flash');
  });

  it('sparkle 只保留少量外围碎光，正式图集承担主效果', () => {
    expect(PARTICLE_PRESETS.sparkle.count).toBeLessThanOrEqual(6);
    expect(PARTICLE_PRESETS.sparkle.size).toBeLessThanOrEqual(3);
  });

  it('每个预设包含 count/speed/life/size/color 必要字段', () => {
    for (const [name, preset] of Object.entries(PARTICLE_PRESETS)) {
      expect(preset).toHaveProperty('count');
      expect(preset).toHaveProperty('speed');
      expect(preset).toHaveProperty('life');
      expect(preset).toHaveProperty('size');
      expect(preset).toHaveProperty('color');
      expect(preset.count).toBeGreaterThan(0);
      expect(preset.life).toBeGreaterThan(0);
    }
  });

  it('dust 预设有重力与摩擦力（模拟地面尘土）', () => {
    expect(PARTICLE_PRESETS.dust).toHaveProperty('gravity');
    expect(PARTICLE_PRESETS.dust.gravity).toBeGreaterThan(0);
    expect(PARTICLE_PRESETS.dust).toHaveProperty('friction');
    expect(PARTICLE_PRESETS.dust.friction).toBeLessThan(1);
  });

  it('ember 预设无重力（余烬向上飘散）', () => {
    expect(PARTICLE_PRESETS.ember).toHaveProperty('gravity');
    expect(PARTICLE_PRESETS.ember.gravity).toBe(0);
  });

  // ==================== 批量发射 ====================

  it('连续多次 emit 累加粒子数量', () => {
    ps.emit(100, 100, 'sparkle');
    ps.emit(200, 200, 'sparkle');
    ps.emit(300, 300, 'sparkle');

    expect(ps.count).toBe(PARTICLE_PRESETS.sparkle.count * 3);
  });

  it('混合预设发射后粒子数量正确', () => {
    ps.emit(100, 100, 'sparkle');
    ps.emit(200, 200, 'dust');

    expect(ps.count).toBe(
      PARTICLE_PRESETS.sparkle.count + PARTICLE_PRESETS.dust.count
    );
  });

  // ==================== setFpsProvider 动态设置 ====================

  it('setFpsProvider 可动态更新 FPS 来源', () => {
    ps.emit(100, 100, 'sparkle');
    expect(ps.count).toBe(PARTICLE_PRESETS.sparkle.count);

    ps.setFpsProvider(() => 10);
    ps.emit(100, 100, 'sparkle');

    // 第二次 emit 因低 FPS 被跳过，数量不变
    expect(ps.count).toBe(PARTICLE_PRESETS.sparkle.count);
  });

  // ==================== draw 冒烟测试 ====================

  it('draw 在无 ctx 时空操作不报错', () => {
    ps.emit(100, 100, 'sparkle');
    expect(() => ps.draw(null)).not.toThrow();
  });

  it('draw 在无粒子时不报错', () => {
    const ctxStub = {
      save() {}, restore() {}, fillRect() {},
      beginPath() {}, arc() {}, fill() {},
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set fillStyle(v) {}, get fillStyle() { return ''; },
    };
    expect(() => ps.draw(ctxStub)).not.toThrow();
  });
});
