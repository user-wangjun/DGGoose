import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GOAL_BURST_DURATION,
  GOAL_BURST_DISPLAY_SIZE,
  GOAL_BURST_FRAME_COUNT,
  GOAL_BURST_FRAME_DURATIONS,
  GOAL_BURST_SHEET_URL,
  GoalBurstEffect,
} from '../../src/core/GoalBurstEffect.js';

const SHEET_PATH = path.resolve(process.cwd(), 'assets/effects/basketball/goal-burst-sheet.png');

function createContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    set globalAlpha(value) { this._globalAlpha = value; },
    get globalAlpha() { return this._globalAlpha ?? 1; },
    set strokeStyle(value) { this._strokeStyle = value; },
    get strokeStyle() { return this._strokeStyle; },
    set lineWidth(value) { this._lineWidth = value; },
    get lineWidth() { return this._lineWidth; },
  };
}

describe('GoalBurstEffect', () => {
  it('资源路径存在、图集规格为 3 帧且总播放时长约 0.4 秒', async () => {
    expect(fs.existsSync(SHEET_PATH)).toBe(true);
    expect(GOAL_BURST_SHEET_URL).toContain('goal-burst-sheet.png');
    expect(GOAL_BURST_FRAME_COUNT).toBe(3);
    expect(GOAL_BURST_FRAME_DURATIONS).toEqual([0.1, 0.14, 0.16]);
    expect(GOAL_BURST_DURATION).toBeCloseTo(0.4, 6);
    expect(GOAL_BURST_DISPLAY_SIZE).toBeGreaterThanOrEqual(150);
    expect(GOAL_BURST_DISPLAY_SIZE).toBeLessThanOrEqual(190);
  });

  it('按 update 推进三帧并在非循环动画结束后自动清理', () => {
    const effect = new GoalBurstEffect({ image: { width: 768, height: 256 } });

    expect(effect.play({ x: 1030, y: 226 })).toBe(true);
    expect(effect.snapshot).toMatchObject({ x: 1030, y: 226, enhanced: false, frameIndex: 0 });

    effect.update(0.1);
    expect(effect.getFrameIndex()).toBe(1);
    effect.update(0.14);
    expect(effect.getFrameIndex()).toBe(2);

    effect.update(0.16);
    expect(effect.isActive).toBe(false);
    expect(effect.snapshot).toBeNull();
  });

  it('绘制时使用图集对应帧和保存的逻辑坐标', () => {
    const image = { width: 768, height: 256 };
    const effect = new GoalBurstEffect({ image });
    const ctx = createContext();

    effect.play({ x: 1030, y: 226 });
    effect.update(0.241);
    effect.draw(ctx);

    expect(ctx.translate).toHaveBeenCalledWith(1030, 226);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      512,
      0,
      256,
      256,
      -GOAL_BURST_DISPLAY_SIZE / 2,
      -GOAL_BURST_DISPLAY_SIZE / 2,
      GOAL_BURST_DISPLAY_SIZE,
      GOAL_BURST_DISPLAY_SIZE,
    );
  });

  it('第 5 球使用约 1.2 倍尺寸并绘制一次弱二次光环', () => {
    const image = { width: 768, height: 256 };
    const effect = new GoalBurstEffect({ image });
    const ctx = createContext();

    effect.play({ x: 1030, y: 150, enhanced: true });
    effect.update(0.1);
    effect.draw(ctx);

    expect(effect.snapshot).toMatchObject({ x: 1030, y: 150, enhanced: true });
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      256,
      0,
      256,
      256,
      -(GOAL_BURST_DISPLAY_SIZE * 1.2) / 2,
      -(GOAL_BURST_DISPLAY_SIZE * 1.2) / 2,
      GOAL_BURST_DISPLAY_SIZE * 1.2,
      GOAL_BURST_DISPLAY_SIZE * 1.2,
    );
  });

  it('无效坐标不会启动效果，clear 可立即清除当前播放', () => {
    const effect = new GoalBurstEffect({ image: { width: 768, height: 256 } });

    expect(effect.play({ x: Number.NaN, y: 226 })).toBe(false);
    expect(effect.isActive).toBe(false);

    effect.play({ x: 100, y: 200 });
    effect.clear();
    expect(effect.isActive).toBe(false);
  });
});
