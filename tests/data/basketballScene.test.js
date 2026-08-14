import { describe, expect, it } from 'vitest';
import {
  BASKETBALL_COLLIDERS,
  BASKETBALL_INTERACTIONS,
  createBasketballMap,
} from '../../src/data/basketballScene.js';

describe('篮球馆正式地图配置', () => {
  it('所有实体障碍都使用归一化 solid 矩形，且不把球场线/篮网加入碰撞层', () => {
    expect(BASKETBALL_COLLIDERS.length).toBeGreaterThanOrEqual(9);
    expect(BASKETBALL_COLLIDERS.every((collider) => collider.kind === 'solid')).toBe(true);
    expect(BASKETBALL_COLLIDERS.some((collider) => collider.id.includes('bleacher'))).toBe(true);
    expect(BASKETBALL_COLLIDERS.some((collider) => collider.id.includes('backboard'))).toBe(true);
    expect(BASKETBALL_COLLIDERS.some((collider) => collider.id.includes('equipment'))).toBe(true);
    expect(BASKETBALL_COLLIDERS.every((collider) => Object.values(collider)
      .filter((value) => typeof value === 'number')
      .every((value) => value >= 0 && value <= 1))).toBe(true);
  });

  it('篮筐和教练只作为 interaction zone，不会被转换为 solid 障碍', () => {
    expect(BASKETBALL_INTERACTIONS.map((target) => target.id)).toEqual(['coach', 'shooting-spot']);
    expect(BASKETBALL_INTERACTIONS.every((target) => target.kind === 'interaction')).toBe(true);
  });

  it('按逻辑画布尺寸转换后，边界、障碍和交互点保持与背景同一坐标系', () => {
    const map = createBasketballMap({ width: 1280, height: 720 });

    expect(map.bounds.left).toBeGreaterThan(0);
    expect(map.bounds.right).toBeLessThan(1280);
    expect(map.bounds.top).toBeGreaterThan(0);
    expect(map.bounds.bottom).toBeLessThan(720);
    expect(map.obstacles.find((obstacle) => obstacle.id === 'right-hoop-backboard')).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
    const shootingSpot = map.interactables.find((target) => target.id === 'shooting-spot');
    // 互动点必须位于篮板外侧的可达球场位置，而不是嵌在实体篮板里。
    expect(shootingSpot.x).toBeGreaterThan(980);
    expect(shootingSpot.x).toBeLessThan(1065);
    expect(shootingSpot.y).toBeGreaterThan(380);
    expect(shootingSpot.y).toBeLessThan(430);
  });
});
