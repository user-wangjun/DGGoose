/**
 * 东莞印记正式美术资源映射。
 * 结局印记复用对应旅途印记的主题图，避免为同一文化主题重复打包素材。
 */
function createBadgeAsset(name) {
  return {
    color: new URL(`../../assets/ui/badges/badge_${name}_color.png`, import.meta.url).href,
    gray: new URL(`../../assets/ui/badges/badge_${name}_gray.png`, import.meta.url).href,
  };
}

const BADGE_ART = {
  factory: createBadgeAsset('factory'),
  basketball: createBadgeAsset('basketball'),
  lychee: createBadgeAsset('lychee'),
  roastGoose: createBadgeAsset('roast_goose'),
  technology: createBadgeAsset('technology'),
  campus: createBadgeAsset('campus'),
  freedom: createBadgeAsset('freedom'),
};

/** 数据层印记 id 到正式图像资源的映射。 */
export const BADGE_ASSET_MAP = {
  factory_cert: BADGE_ART.factory,
  basketball: BADGE_ART.basketball,
  lychee: BADGE_ART.lychee,
  roast_goose: BADGE_ART.roastGoose,
  industrial: BADGE_ART.technology,
  campus: BADGE_ART.campus,
  training_camp: BADGE_ART.basketball,
  lychee_gardener: BADGE_ART.lychee,
  goose_chef: BADGE_ART.roastGoose,
  developer: BADGE_ART.technology,
  student: BADGE_ART.campus,
  lake: BADGE_ART.freedom,
};

/**
 * 根据解锁状态取得正式徽章图。
 * 未知 id 返回空字符串，让调用方走显式降级而不是错误请求。
 * @param {string} id - 印记 id
 * @param {boolean} unlocked - 是否已获得
 * @returns {string}
 */
export function getBadgeAssetUrl(id, unlocked) {
  const assets = BADGE_ASSET_MAP[id];
  if (!assets) return '';
  return unlocked ? assets.color : assets.gray;
}

