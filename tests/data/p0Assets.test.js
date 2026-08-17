import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIO_MANIFEST } from '../../src/config.js';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readPngSize(filePath) {
  const data = fs.readFileSync(filePath);
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
  };
}

describe('P0 美术资源交付契约', () => {
  it('包含 8 首 BGM 与 12 条 SFX，且文件均存在', () => {
    const bgm = AUDIO_MANIFEST.filter((item) => item.url.includes('/bgm_'));
    const sfx = AUDIO_MANIFEST.filter((item) => item.url.includes('/sfx_'));

    expect(bgm).toHaveLength(8);
    expect(sfx).toHaveLength(12);
    for (const item of AUDIO_MANIFEST) {
      expect(fs.existsSync(path.join(GAME_ROOT, item.url))).toBe(true);
    }
  });

  it('核心动画图集为透明 PNG，尺寸不超过 1024px', () => {
    const expected = [
      ['assets/characters/gxe/gxe_idle_sheet.png', 1024, 512],
      ['assets/characters/gxe/gxe_walk_sheet.png', 1024, 1024],
      ['assets/characters/gxe/gxe_run_sheet.png', 1024, 1024],
      ['assets/characters/gxe/gxe_climb_pose.png', 768, 768],
    ];

    for (const [relativePath, width, height] of expected) {
      const size = readPngSize(path.join(GAME_ROOT, relativePath));
      expect(size).toMatchObject({ width, height, colorType: 6 });
    }
  });

  it('主菜单背景为运行时可用的 1280x720 PNG', () => {
    const relativePath = 'assets/bg/bg_menu_cn.png';
    const size = readPngSize(path.join(GAME_ROOT, relativePath));

    expect(size).toMatchObject({ width: 1280, height: 720 });
  });

  it('主菜单正面莞小鹅贴图为带透明通道的 PNG', () => {
    const relativePath = 'assets/characters/gxe/gxe_menu_front.png';
    const size = readPngSize(path.join(GAME_ROOT, relativePath));

    expect(size.colorType).toBe(6);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  it('新增动作组均已转成独立透明运行时图集，帧数与清单一致', () => {
    const manifestPath = path.join(GAME_ROOT, 'assets/characters/actions/action-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.totalGroups).toBe(manifest.groups.length);
    expect(manifest.totalFrames).toBe(
      manifest.groups.reduce((total, group) => total + group.frames, 0),
    );

    const approvedNpcCharacters = new Set(['教练', '果农阿婆', '高新工程师', '学长', '学姐']);
    const npcCharacters = new Set(
      manifest.groups
        .filter((group) => group.characterType === 'npc' && group.status !== 'reference-only')
        .map((group) => group.character),
    );
    for (const character of approvedNpcCharacters) {
      expect(npcCharacters.has(character)).toBe(true);
    }
    const industrialWorkerGroups = manifest.groups.filter(
      (group) => group.character === '工业园工人',
    );
    expect(industrialWorkerGroups.length).toBeGreaterThan(0);
    expect(industrialWorkerGroups.every((group) => group.status !== 'reference-only')).toBe(true);

    for (const group of manifest.groups) {
      const relativePath = `assets/characters/actions/${group.sheet}`;
      const size = readPngSize(path.join(GAME_ROOT, relativePath));
      expect(size).toMatchObject({
        width: 384 * group.frames,
        height: 384,
        colorType: 6,
      });
    }
  });
});
