import { describe, it, expect, beforeEach } from 'vitest';
import { FactoryPhysics } from '../../src/core/FactoryPhysics.js';

/** 创建带固定方向向量的输入桩，模拟键盘或摇杆输出。 */
function createInput(vector) {
  return {
    getVector: () => ({ ...vector }),
  };
}

const idleInput = createInput({ x: 0, y: 0, run: false });
const rightInput = createInput({ x: 1, y: 0, run: false });
const leftInput = createInput({ x: -1, y: 0, run: false });
const jumpInput = createInput({ x: 0, y: -1, run: false });
const downInput = createInput({ x: 0, y: 1, run: false });

describe('FactoryPhysics 鹅厂侧视物理约束', () => {
  let physics;

  beforeEach(() => {
    physics = new FactoryPhysics({
      groundY: 540,
      leftBound: 60,
      wallX: 1080,
      playerRadius: 30,
      gravity: 1500,
      jumpVelocity: -500,
    });
    physics.setPosition(180, 540);
  });

  it('角色初始落在地面，向下输入不会把角色压入地板', () => {
    physics.update(0.2, downInput);

    expect(physics.y).toBe(540);
    expect(physics.isGrounded).toBe(true);
    expect(physics.velocity.y).toBe(0);
  });

  it('向上输入只触发跳跃，不再把角色当作自由二维移动', () => {
    physics.update(0.016, jumpInput);

    expect(physics.y).toBeLessThan(540);
    expect(physics.velocity.y).toBeLessThan(0);
    expect(physics.isGrounded).toBe(false);
  });

  it('松开再按向上键才能再次跳跃，按住不会落地瞬间重复起跳', () => {
    physics.update(0.016, jumpInput);

    // 整个过程中保持按住向上键，角色应正常落地并保持在地面。
    for (let i = 0; i < 60; i += 1) {
      physics.update(0.016, jumpInput);
    }
    expect(physics.isGrounded).toBe(true);
    expect(physics.y).toBe(540);

    physics.update(0.016, jumpInput);
    expect(physics.isGrounded).toBe(true);
    expect(physics.y).toBe(540);

    // 释放后重新按下，才允许下一次跳跃。
    physics.update(0.016, idleInput);
    physics.update(0.016, jumpInput);
    expect(physics.isGrounded).toBe(false);
    expect(physics.y).toBeLessThan(540);
  });

  it('重力让空中的角色最终回到地面并清零垂直速度', () => {
    physics.setPosition(300, 300);

    for (let i = 0; i < 60; i += 1) {
      physics.update(0.016, idleInput);
    }

    expect(physics.y).toBe(540);
    expect(physics.isGrounded).toBe(true);
    expect(physics.velocity.y).toBe(0);
  });

  it('角色不能穿过鹅厂右侧实体围墙', () => {
    physics.setPosition(1030, 540);
    physics.update(1, rightInput);

    expect(physics.x).toBe(1050);
    expect(physics.x + 30).toBeLessThanOrEqual(1080);
  });

  it('角色不能越过左侧场景边界', () => {
    physics.setPosition(80, 540);
    physics.update(1, leftInput);

    expect(physics.x).toBe(60);
  });
});
