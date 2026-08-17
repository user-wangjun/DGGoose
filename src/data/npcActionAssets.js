const FRAME_SIZE = 384;

// 资源 URL 保持逐项静态声明，Vite 才能在开发与生产构建中追踪并复制每张 PNG。
const NPC_ASSET_URLS = {
  coach: {
    idle: new URL('../../assets/characters/actions/npc/coach/coach_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/coach/coach_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/coach/coach_interact_sheet.png', import.meta.url).href,
    signal: new URL('../../assets/characters/actions/npc/coach/coach_signal_sheet.png', import.meta.url).href,
  },
  farmer: {
    idle: new URL('../../assets/characters/actions/npc/farmer/farmer_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/farmer/farmer_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/farmer/farmer_interact_sheet.png', import.meta.url).href,
    lychee: new URL('../../assets/characters/actions/npc/farmer/farmer_lychee_sheet.png', import.meta.url).href,
  },
  engineer: {
    idle: new URL('../../assets/characters/actions/npc/engineer/engineer_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/engineer/engineer_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/engineer/engineer_interact_sheet.png', import.meta.url).href,
    inspect: new URL('../../assets/characters/actions/npc/engineer/engineer_inspect_sheet.png', import.meta.url).href,
  },
  industrialWorker: {
    idle: new URL('../../assets/characters/actions/npc/industrial_worker/industrial_worker_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/industrial_worker/industrial_worker_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/industrial_worker/industrial_worker_interact_sheet.png', import.meta.url).href,
    work: new URL('../../assets/characters/actions/npc/industrial_worker/industrial_worker_work_sheet.png', import.meta.url).href,
  },
  dgutSenior: {
    idle: new URL('../../assets/characters/actions/npc/dgut_senior/dgut_senior_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/dgut_senior/dgut_senior_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/dgut_senior/dgut_senior_interact_sheet.png', import.meta.url).href,
    guide: new URL('../../assets/characters/actions/npc/dgut_senior/dgut_senior_guide_sheet.png', import.meta.url).href,
  },
  dgutSeniorFemale: {
    idle: new URL('../../assets/characters/actions/npc/dgut_senior_female/dgut_senior_female_idle.png', import.meta.url).href,
    walk: new URL('../../assets/characters/actions/npc/dgut_senior_female/dgut_senior_female_walk_sheet.png', import.meta.url).href,
    interact: new URL('../../assets/characters/actions/npc/dgut_senior_female/dgut_senior_female_interact_sheet.png', import.meta.url).href,
    bookmark: new URL('../../assets/characters/actions/npc/dgut_senior_female/dgut_senior_female_bookmark_sheet.png', import.meta.url).href,
  },
};

function createSpec(name, src, frames = 4, fps = 8, loop = false, anchorY = 0.94) {
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

function createNpcSpecs(urls, exclusiveAction) {
  return {
    idle: createSpec('idle', urls.idle, 1, 6, true),
    interact: createSpec('interact', urls.interact),
    walk: createSpec('walk', urls.walk, 4, 8, true),
    [exclusiveAction]: createSpec(exclusiveAction, urls[exclusiveAction]),
  };
}

/**
 * NPC 动作清单。
 * 每个动作组独立引用透明 PNG；动作文件缺失时由 NpcSprite 统一回退到 idle，
 * 这样场景状态机可以统一传入 idle / walk / interact / 专属动作而不引入占位图。
 */
export const NPC_ACTION_SPECS = {
  coach: {
    idle: createSpec('idle', NPC_ASSET_URLS.coach.idle, 1, 6, true),
    walk: createSpec('walk', NPC_ASSET_URLS.coach.walk, 4, 8, true),
    interact: createSpec('interact', NPC_ASSET_URLS.coach.interact),
    signal: createSpec('signal', NPC_ASSET_URLS.coach.signal),
  },
  farmer: createNpcSpecs(NPC_ASSET_URLS.farmer, 'lychee'),
  engineer: createNpcSpecs(NPC_ASSET_URLS.engineer, 'inspect'),
  industrialWorker: createNpcSpecs(NPC_ASSET_URLS.industrialWorker, 'work'),
  dgutSenior: createNpcSpecs(NPC_ASSET_URLS.dgutSenior, 'guide'),
  dgutSeniorFemale: createNpcSpecs(NPC_ASSET_URLS.dgutSeniorFemale, 'bookmark'),
};

/** 与运行时 manifest 对齐的角色显示名，避免场景和资源清单各写一套中文名称。 */
export const NPC_CHARACTER_LABELS = Object.freeze({
  coach: '教练',
  farmer: '果农阿婆',
  engineer: '高新工程师',
  industrialWorker: '工业园工人',
  dgutSenior: '学长',
  dgutSeniorFemale: '学姐',
});
