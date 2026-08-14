import { BOSS_ACTION_SPECS } from '../data/actionAssets.js';
import { FrameActionSprite } from './FrameActionSprite.js';

/** 烧鹅店老板的运行时动作绘制器。 */
export class BossSprite extends FrameActionSprite {
  constructor({ assetLoader = null, width = 118, height = 118 } = {}) {
    super({
      assetLoader,
      width,
      height,
      defaultState: 'patrol',
      specs: BOSS_ACTION_SPECS,
    });
  }
}

