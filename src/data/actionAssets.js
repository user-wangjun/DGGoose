const FRAME_SIZE = 384;

function createSpec(name, src, frames, fps, loop = false, anchorY = 0.93) {
  return {
    src,
    config: {
      atlas: {
        src,
        frameW: FRAME_SIZE,
        frameH: FRAME_SIZE,
        columns: frames,
        rows: 1,
      },
      animations: {
        [name]: {
          row: 0,
          frames,
          fps,
          loop,
          anchorX: 0.5,
          anchorY,
          columns: frames,
        },
      },
    },
  };
}

/** 莞小鹅独立动作组；每组保持单独运行时图集，不跨动作合并。 */
export const GXE_ACTION_SPECS = {
  interact: createSpec(
    'interact',
    new URL('../../assets/characters/actions/gxe/gxe_interact_sheet.png', import.meta.url).href,
    4,
    8,
  ),
  eat: createSpec(
    'eat',
    new URL('../../assets/characters/actions/gxe/gxe_eat_sheet.png', import.meta.url).href,
    6,
    8,
  ),
  throw: createSpec(
    'throw',
    new URL('../../assets/characters/actions/gxe/gxe_throw_sheet.png', import.meta.url).href,
    6,
    12,
  ),
  scared: createSpec(
    'scared',
    new URL('../../assets/characters/actions/gxe/gxe_scared_sheet.png', import.meta.url).href,
    4,
    10,
  ),
  hide: createSpec(
    'hide',
    new URL('../../assets/characters/actions/gxe/gxe_hide_sheet.png', import.meta.url).href,
    2,
    8,
  ),
  caught: createSpec(
    'caught',
    new URL('../../assets/characters/actions/gxe/gxe_caught_sheet.png', import.meta.url).href,
    4,
    10,
  ),
  jump: createSpec(
    'jump',
    new URL('../../assets/characters/actions/gxe/gxe_jump_sheet.png', import.meta.url).href,
    4,
    10,
  ),
  celebrate: createSpec(
    'celebrate',
    new URL('../../assets/characters/actions/gxe/gxe_celebrate_sheet.png', import.meta.url).href,
    6,
    10,
  ),
  sit: createSpec(
    'sit',
    new URL('../../assets/characters/actions/gxe/gxe_sit_sheet.png', import.meta.url).href,
    4,
    6,
  ),
};

/** 烧鹅店老板动作组；巡逻循环与抓捕动作保持独立。 */
export const BOSS_ACTION_SPECS = {
  patrol: createSpec(
    'patrol',
    new URL('../../assets/characters/actions/boss/boss_patrol_sheet.png', import.meta.url).href,
    4,
    8,
    true,
    0.94,
  ),
  caught: createSpec(
    'caught',
    new URL('../../assets/characters/actions/boss/boss_caught_sheet.png', import.meta.url).href,
    2,
    8,
    false,
    0.94,
  ),
};

