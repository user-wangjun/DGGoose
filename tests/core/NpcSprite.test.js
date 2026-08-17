import { describe, expect, it } from 'vitest';
import { NPC_ACTION_SPECS } from '../../src/data/npcActionAssets.js';
import { NpcSprite } from '../../src/core/NpcSprite.js';

const NPC_ACTIONS = {
  coach: 'signal',
  farmer: 'lychee',
  engineer: 'inspect',
  industrialWorker: 'work',
  dgutSenior: 'guide',
  dgutSeniorFemale: 'bookmark',
};

describe('NpcSprite 透明动作接入层', () => {
  it('为每个已批准 NPC 提供 idle、interact、walk 和专属动作', () => {
    for (const [character, exclusiveAction] of Object.entries(NPC_ACTIONS)) {
      const specs = NPC_ACTION_SPECS[character];
      expect(specs).toBeDefined();
      expect(specs).toEqual(expect.objectContaining({
        idle: expect.any(Object),
        interact: expect.any(Object),
        walk: expect.any(Object),
        [exclusiveAction]: expect.any(Object),
      }));
    }
  });

  it('动作不存在时回退到 idle，不抛错也不保留临时动作', () => {
    const sprite = new NpcSprite({ character: 'farmer' });

    expect(sprite.playAction('not-provided')).toBe(true);
    expect(sprite.currentAction).toBeNull();
    expect(sprite.currentState).toBe('idle');
    expect(sprite.animations.get('idle').currentName).toBe('idle');
  });

  it('不传尺寸时动作帧与 idle 使用相同显示尺寸，并沿脚底锚点绘制', () => {
    const sprite = new NpcSprite({ character: 'farmer', width: 140, height: 140 });
    const image = {};
    sprite.images.set('idle', image);
    sprite.animations.get('idle').play('idle');
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      scale() {},
      drawImage: (...args) => { ctx.drawArgs = args; },
      globalAlpha: 1,
    };

    expect(sprite.draw(ctx, 220, 390)).toBe(true);
    expect(ctx.drawArgs).toEqual([image, 0, 0, 384, 384, -70, -140 * 0.94, 140, 140]);
  });
});
