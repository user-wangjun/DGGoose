import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpriteSheet, SpriteAnimation } from '../../src/core/SpriteAnimation.js';
import idleConfig from '../../assets/characters/gxe/gxe_idle.json';
import walkConfig from '../../assets/characters/gxe/gxe_walk.json';
import runConfig from '../../assets/characters/gxe/gxe_run.json';
import { GXE_SPRITE_SPECS } from '../../src/core/GooseSprite.js';

/**
 * SpriteAnimation + SpriteSheet 测试套件
 * 对应 PRD §6.2 关键技术需求 2 + Task 1.3：序列帧动画系统
 */

/** 模拟动画 JSON 配置（对应 PRD §7.2 规格约定） */
const MOCK_ANIM_CONFIG = {
  atlas: { src: 'gxe_idle.png', frameW: 128, frameH: 128 },
  animations: {
    idle: { row: 0, frames: 4, fps: 4, loop: true },
    walk: { row: 1, frames: 8, fps: 8, loop: true },
    run: { row: 2, frames: 8, fps: 12, loop: true },
    jump: { row: 3, frames: 4, fps: 10, loop: false },
  },
};

describe('SpriteSheet 图集', () => {
  it('从 JSON 配置构建帧坐标', () => {
    const sheet = new SpriteSheet(MOCK_ANIM_CONFIG);
    const frame = sheet.getFrame('idle', 0);
    expect(frame.x).toBe(0);
    expect(frame.y).toBe(0);
    expect(frame.w).toBe(128);
    expect(frame.h).toBe(128);
  });

  it('帧坐标包含锚点（默认 0.5, 0.5）', () => {
    const sheet = new SpriteSheet(MOCK_ANIM_CONFIG);
    const frame = sheet.getFrame('idle', 0);
    expect(frame.anchorX).toBe(0.5);
    expect(frame.anchorY).toBe(0.5);
  });

  it('自定义锚点从动画配置读取', () => {
    const config = {
      atlas: { frameW: 128, frameH: 128 },
      animations: {
        walk: { row: 0, frames: 4, fps: 8, loop: true, anchorX: 0.5, anchorY: 1.0 },
      },
    };
    const sheet = new SpriteSheet(config);
    const frame = sheet.getFrame('walk', 0);
    expect(frame.anchorX).toBe(0.5);
    expect(frame.anchorY).toBe(1.0);
  });

  it('第二帧 X 偏移 = frameW', () => {
    const sheet = new SpriteSheet(MOCK_ANIM_CONFIG);
    const frame = sheet.getFrame('idle', 1);
    expect(frame.x).toBe(128);
    expect(frame.y).toBe(0);
  });

  it('walk 动画第二行 Y 偏移 = frameH', () => {
    const sheet = new SpriteSheet(MOCK_ANIM_CONFIG);
    const frame = sheet.getFrame('walk', 0);
    expect(frame.y).toBe(128);
  });

  it('帧索引取模循环（超过帧数时回到开头）', () => {
    const sheet = new SpriteSheet(MOCK_ANIM_CONFIG);
    const frame = sheet.getFrame('idle', 4);
    expect(frame.x).toBe(0);
  });

  it('支持带列数的多行图集坐标', () => {
    const sheet = new SpriteSheet({
      atlas: { frameW: 256, frameH: 256, columns: 4, rows: 4 },
      animations: {
        walk: { row: 0, frames: 16, columns: 4, fps: 12, loop: true },
      },
    });

    expect(sheet.getFrame('walk', 3)).toMatchObject({ x: 768, y: 0 });
    expect(sheet.getFrame('walk', 4)).toMatchObject({ x: 0, y: 256 });
    expect(sheet.getFrame('walk', 15)).toMatchObject({ x: 768, y: 768 });
  });

  it('支持逐帧锚点，避免图集中角色内容漂移', () => {
    const sheet = new SpriteSheet({
      atlas: { frameW: 256, frameH: 256, columns: 2, rows: 1 },
      animations: {
        walk: {
          row: 0,
          frames: 2,
          columns: 2,
          fps: 8,
          loop: true,
          anchorX: 0.5,
          anchorY: 0.9,
          frameAnchors: [
            { x: 0.4, y: 0.8 },
            { x: 0.6, y: 0.95 },
          ],
        },
      },
    });

    expect(sheet.getFrame('walk', 0)).toMatchObject({ anchorX: 0.4, anchorY: 0.8 });
    expect(sheet.getFrame('walk', 1)).toMatchObject({ anchorX: 0.6, anchorY: 0.95 });
  });

  it('核心莞小鹅图集为每一帧提供统一落脚点锚点', () => {
    const configs = [
      [idleConfig, 'idle', 8],
      [walkConfig, 'walk', 16],
      [runConfig, 'run', 16],
    ];

    for (const [config, name, frameCount] of configs) {
      const animation = config.animations[name];
      expect(animation.frameAnchors).toHaveLength(frameCount);
      expect(animation.frameAnchors.every(({ x, y }) => (
        Number.isFinite(x)
        && Number.isFinite(y)
        && x >= 0
        && x <= 1
        && y >= 0
        && y <= 1
      ))).toBe(true);
    }
  });

  it('运行时奔跑状态使用真实双足交替的 walk atlas，并提高播放速度', () => {
    const run = GXE_SPRITE_SPECS.run;
    expect(run.src).toContain('gxe_walk_sheet');
    expect(run.config.animations.run.frames).toBe(16);
    expect(run.config.animations.run.fps).toBe(runConfig.animations.run.fps);
    expect(run.config.animations.run.frameAnchors).toEqual(walkConfig.animations.walk.frameAnchors);
  });
});

describe('SpriteAnimation 动画系统', () => {
  let anim;

  beforeEach(() => {
    anim = new SpriteAnimation(MOCK_ANIM_CONFIG);
  });

  it('初始状态：无动画播放', () => {
    expect(anim.currentName).toBeNull();
    expect(anim.frameIndex).toBe(0);
  });

  it('play(idle) → 设置当前动画，帧号归零', () => {
    anim.play('idle');
    expect(anim.currentName).toBe('idle');
    expect(anim.frameIndex).toBe(0);
  });

  it('帧推进：按 FPS 计算帧号', () => {
    anim.play('idle'); // fps=4 → 每 250ms 推进一帧
    anim.update(0.25); // 250ms
    expect(anim.frameIndex).toBe(1);

    anim.update(0.25);
    expect(anim.frameIndex).toBe(2);
  });

  it('循环动画：最后一帧后回到第一帧', () => {
    anim.play('idle'); // 4 帧，循环
    anim.update(1.0); // 4 帧 × 250ms = 1000ms → 推进 4 帧 → 回到 0
    expect(anim.frameIndex).toBe(0);
  });

  it('非循环动画：停在最后一帧', () => {
    anim.play('jump'); // 4 帧，不循环， fps=10 → 100ms/帧
    anim.update(0.4); // 4 帧 × 100ms = 400ms → 推进 4 帧
    expect(anim.frameIndex).toBe(3); // 停在最后一帧
  });

  it('暂停与恢复', () => {
    anim.play('idle');
    anim.update(0.25);
    expect(anim.frameIndex).toBe(1);

    anim.pause();
    anim.update(0.25);
    expect(anim.frameIndex).toBe(1); // 暂停后不推进

    anim.resume();
    anim.update(0.25);
    expect(anim.frameIndex).toBe(2); // 恢复后继续
  });

  it('stop → 停止并清空状态', () => {
    anim.play('idle');
    anim.update(0.5);
    anim.stop();
    expect(anim.currentName).toBeNull();
    expect(anim.frameIndex).toBe(0);
  });

  it('switchAnim 切换动画时重置帧号', () => {
    anim.play('idle');
    anim.update(0.5); // 推进到帧 2
    expect(anim.frameIndex).toBe(2);

    anim.switchAnim('walk'); // 切换到 walk，帧号归零
    expect(anim.currentName).toBe('walk');
    expect(anim.frameIndex).toBe(0);
  });

  it('switchAnim 相同动画不重置', () => {
    anim.play('idle');
    anim.update(0.5);
    const prevFrame = anim.frameIndex;
    anim.switchAnim('idle');
    expect(anim.frameIndex).toBe(prevFrame); // 不重置
  });

  it('水平翻转：setFlip(true) 设置 scaleX=-1', () => {
    anim.setFlip(true);
    expect(anim.flipX).toBe(true);
    anim.setFlip(false);
    expect(anim.flipX).toBe(false);
  });

  it('getCurrentFrame 返回当前帧坐标', () => {
    anim.play('walk');
    anim.update(0.125); // fps=8 → 125ms/帧 → 推进 1 帧
    const frame = anim.getCurrentFrame();
    expect(frame.x).toBe(128);
    expect(frame.y).toBe(128); // walk 第 1 行
  });
});
