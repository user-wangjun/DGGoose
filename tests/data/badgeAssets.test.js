import { describe, expect, it } from 'vitest';
import { BADGES } from '../../src/data/badges.js';
import { BADGE_ASSET_MAP, getBadgeAssetUrl } from '../../src/data/badgeAssets.js';

describe('印记正式资源映射', () => {
  it('每枚数据层印记都有彩色态与灰态本地资源', () => {
    for (const badge of BADGES) {
      const assets = BADGE_ASSET_MAP[badge.id];

      expect(assets, badge.id).toBeDefined();
      expect(assets.color, badge.id).toContain('badge_');
      expect(assets.color, badge.id).toContain('_color.png');
      expect(assets.gray, badge.id).toContain('_gray.png');
    }
  });

  it('已获得与未获得状态返回对应资源，不回退到 emoji', () => {
    expect(getBadgeAssetUrl('factory_cert', true)).toContain('badge_factory_color.png');
    expect(getBadgeAssetUrl('factory_cert', false)).toContain('badge_factory_gray.png');
    expect(getBadgeAssetUrl('lake', true)).toContain('badge_freedom_color.png');
    expect(getBadgeAssetUrl('lake', false)).toContain('badge_freedom_gray.png');
    expect(getBadgeAssetUrl('unknown_badge', true)).toBe('');
  });
});
