/**
 * 场景物件资源清单。
 * 图片只负责外观，坐标、锚点和碰撞仍由各场景的既有地图配置决定。
 */

function createAsset(src, kind, fallbackColor = '#64748b') {
  return Object.freeze({ src, kind, fallbackColor });
}

const FACTORY = {
  conveyor: createAsset(new URL('../../assets/objects/factory/factory-conveyor.png', import.meta.url).href, 'solid', '#334155'),
  robotArm: createAsset(new URL('../../assets/objects/factory/factory-robot-arm.png', import.meta.url).href, 'solid', '#475569'),
  gear: createAsset(new URL('../../assets/objects/factory/factory-gear.png', import.meta.url).href, 'interaction', '#9a6b2f'),
  certificate: createAsset(new URL('../../assets/objects/factory/factory-certificate.png', import.meta.url).href, 'interaction', '#d9b26f'),
};

const BASKETBALL = {
  ball: createAsset(new URL('../../assets/objects/basketball/basketball.png', import.meta.url).href, 'interaction', '#d97706'),
  hoop: createAsset(new URL('../../assets/objects/basketball/basketball-hoop.png', import.meta.url).href, 'interaction', '#475569'),
  shootingPoint: createAsset(new URL('../../assets/objects/basketball/shooting-point.png', import.meta.url).href, 'interaction', '#38bdf8'),
};

const LYCHEE = {
  treeA: createAsset(new URL('../../assets/objects/lychee/lychee-tree-a.png', import.meta.url).href, 'solid', '#3f6212'),
  treeB: createAsset(new URL('../../assets/objects/lychee/lychee-tree-b.png', import.meta.url).href, 'solid', '#3f6212'),
  treeC: createAsset(new URL('../../assets/objects/lychee/lychee-tree-c.png', import.meta.url).href, 'solid', '#3f6212'),
  treeD: createAsset(new URL('../../assets/objects/lychee/lychee-tree-d.png', import.meta.url).href, 'solid', '#3f6212'),
  treeE: createAsset(new URL('../../assets/objects/lychee/lychee-tree-e.png', import.meta.url).href, 'solid', '#3f6212'),
  treeHarvested: createAsset(new URL('../../assets/objects/lychee/lychee-tree-harvested.png', import.meta.url).href, 'solid', '#52733a'),
  fruit: createAsset(new URL('../../assets/objects/lychee/lychee-fruit.png', import.meta.url).href, 'interaction', '#b45309'),
  fence: createAsset(new URL('../../assets/objects/lychee/lychee-fence.png', import.meta.url).href, 'solid', '#8a5a2b'),
  gateClosed: createAsset(new URL('../../assets/objects/lychee/lychee-gate-closed.png', import.meta.url).href, 'solid', '#8a5a2b'),
  gateOpen: createAsset(new URL('../../assets/objects/lychee/lychee-gate-open.png', import.meta.url).href, 'solid', '#8a5a2b'),
};

const ROAST_GOOSE = {
  display: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-display.png', import.meta.url).href, 'solid', '#6b452c'),
  displayEmpty: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-display-empty.png', import.meta.url).href, 'solid', '#6b452c'),
  hanging: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-hanging.png', import.meta.url).href, 'interaction', '#9a4e25'),
  plate: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-plate.png', import.meta.url).href, 'interaction', '#9a4e25'),
  table: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-table.png', import.meta.url).href, 'solid', '#57351f'),
  barrel: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-barrel.png', import.meta.url).href, 'solid', '#70452b'),
  curtain: createAsset(new URL('../../assets/objects/roast-goose/roast-goose-curtain.png', import.meta.url).href, 'foreground', '#304c4a'),
};

const INDUSTRIAL = {
  gateClosed: createAsset(new URL('../../assets/objects/industrial/industrial-gate-closed.png', import.meta.url).href, 'solid', '#334155'),
  gateOpen: createAsset(new URL('../../assets/objects/industrial/industrial-gate-open.png', import.meta.url).href, 'solid', '#334155'),
  drone: createAsset(new URL('../../assets/objects/industrial/industrial-drone.png', import.meta.url).href, 'interaction', '#64748b'),
  gear: createAsset(new URL('../../assets/objects/industrial/industrial-gear.png', import.meta.url).href, 'interaction', '#b7791f'),
  assemblyTable: createAsset(new URL('../../assets/objects/industrial/industrial-assembly-table.png', import.meta.url).href, 'solid', '#2563eb'),
  assemblyComplete: createAsset(new URL('../../assets/objects/industrial/industrial-assembly-complete.png', import.meta.url).href, 'interaction', '#38bdf8'),
};

const CAMPUS_BENCH_URL = new URL('../../assets/objects/campus/campus-bench.png', import.meta.url).href;

const CAMPUS = {
  libraryEntrance: createAsset(new URL('../../assets/objects/campus/campus-library-entrance.png', import.meta.url).href, 'interaction', '#cbd5e1'),
  observationPoint: createAsset(new URL('../../assets/objects/campus/campus-observation-point.png', import.meta.url).href, 'interaction', '#38bdf8'),
  bench: createAsset(CAMPUS_BENCH_URL, 'foreground', '#7c4a2d'),
  signpost: createAsset(new URL('../../assets/objects/campus/campus-signpost.png', import.meta.url).href, 'foreground', '#8b7355'),
};

const SONGSHAN = {
  reeds: createAsset(new URL('../../assets/objects/songshan/songshan-reeds.png', import.meta.url).href, 'foreground', '#8a6a34'),
  bench: createAsset(CAMPUS_BENCH_URL, 'foreground', '#7c4a2d'),
  lakesideDecor: createAsset(new URL('../../assets/objects/songshan/songshan-lakeside-decor.png', import.meta.url).href, 'foreground', '#84735e'),
};

export const SCENE_OBJECT_ASSETS = Object.freeze({
  factory: Object.freeze(FACTORY),
  basketball: Object.freeze(BASKETBALL),
  lychee: Object.freeze(LYCHEE),
  roastGoose: Object.freeze(ROAST_GOOSE),
  industrial: Object.freeze(INDUSTRIAL),
  campus: Object.freeze(CAMPUS),
  songshan: Object.freeze(SONGSHAN),
});

/** 供按章节预加载和生产构建审计使用的去重图片清单。 */
export const SCENE_OBJECT_IMAGE_MANIFEST = Object.freeze(
  [...new Set(Object.values(SCENE_OBJECT_ASSETS).flatMap((assets) => Object.values(assets).map((asset) => asset.src)))]
    .map((url) => Object.freeze({ type: 'image', url })),
);

export const SCENE_OBJECT_PRELOAD = Object.freeze({
  prologue: Object.freeze(Object.values(FACTORY).map((asset) => ({ type: 'image', url: asset.src }))),
  ch1: Object.freeze(Object.values(BASKETBALL).map((asset) => ({ type: 'image', url: asset.src }))),
  ch2: Object.freeze(Object.values(LYCHEE).map((asset) => ({ type: 'image', url: asset.src }))),
  ch3: Object.freeze(Object.values(ROAST_GOOSE).map((asset) => ({ type: 'image', url: asset.src }))),
  ch4: Object.freeze(Object.values(INDUSTRIAL).map((asset) => ({ type: 'image', url: asset.src }))),
  ch5: Object.freeze(Object.values(CAMPUS).map((asset) => ({ type: 'image', url: asset.src }))),
  finale: Object.freeze(Object.values(SONGSHAN).map((asset) => ({ type: 'image', url: asset.src }))),
});

