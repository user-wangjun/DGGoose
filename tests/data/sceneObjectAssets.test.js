import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SCENE_OBJECT_ASSETS,
  SCENE_OBJECT_IMAGE_MANIFEST,
  SCENE_OBJECT_PRELOAD,
} from '../../src/data/sceneObjectAssets.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function assetFilePath(src) {
  if (src.startsWith('file:')) return fileURLToPath(src);
  if (src.startsWith('http:') || src.startsWith('https:')) {
    return path.join(PROJECT_ROOT, new URL(src).pathname.replace(/^\//, ''));
  }
  return path.join(PROJECT_ROOT, src.replace(/^\//, ''));
}

const EXPECTED_SCENES = {
  factory: ['conveyor', 'robotArm', 'gear', 'certificate'],
  basketball: ['ball', 'hoop', 'shootingPoint'],
  lychee: ['treeA', 'treeB', 'treeC', 'treeD', 'treeE', 'treeHarvested', 'fruit', 'fence', 'gateClosed', 'gateOpen'],
  roastGoose: ['display', 'displayEmpty', 'hanging', 'plate', 'table', 'barrel', 'curtain'],
  industrial: ['gateClosed', 'gateOpen', 'drone', 'gear', 'assemblyTable', 'assemblyComplete'],
  campus: ['libraryEntrance', 'observationPoint', 'bench', 'signpost'],
  songshan: ['reeds', 'bench', 'lakesideDecor'],
};

describe('统一场景物件资源契约', () => {
  it('每个场景都声明了需求中的资源、状态和物件分类', () => {
    for (const [sceneId, keys] of Object.entries(EXPECTED_SCENES)) {
      for (const key of keys) {
        expect(SCENE_OBJECT_ASSETS[sceneId][key], `${sceneId}.${key}`).toEqual(
          expect.objectContaining({
            src: expect.stringContaining('/assets/objects/'),
            kind: expect.stringMatching(/^(solid|interaction|foreground)$/),
            fallbackColor: expect.stringMatching(/^#/),
          }),
        );
      }
    }
    expect(SCENE_OBJECT_ASSETS.lychee.gateOpen.kind).toBe('solid');
    expect(SCENE_OBJECT_ASSETS.lychee.gateClosed.kind).toBe('solid');
    expect(SCENE_OBJECT_ASSETS.industrial.gateOpen.kind).toBe('solid');
    expect(SCENE_OBJECT_ASSETS.industrial.gateClosed.kind).toBe('solid');
    expect(SCENE_OBJECT_ASSETS.roastGoose.curtain.kind).toBe('foreground');
    expect(SCENE_OBJECT_ASSETS.songshan.reeds.kind).toBe('foreground');
  });

  it('每个配置 PNG 都存在、是 PNG，并被章节预加载清单覆盖', () => {
    const configuredUrls = [];
    for (const assets of Object.values(SCENE_OBJECT_ASSETS)) {
      for (const asset of Object.values(assets)) {
        const filePath = assetFilePath(asset.src);
        expect(fs.existsSync(filePath), filePath).toBe(true);
        const data = fs.readFileSync(filePath);
        expect(data.subarray(0, 8).toString('hex'), filePath).toBe('89504e470d0a1a0a');
        expect(data.readUInt32BE(16), filePath).toBeGreaterThan(0);
        expect(data.readUInt32BE(20), filePath).toBeGreaterThan(0);
        configuredUrls.push(asset.src);
      }
    }

    const manifestUrls = SCENE_OBJECT_IMAGE_MANIFEST.map((entry) => entry.url);
    expect(new Set(manifestUrls).size).toBe(manifestUrls.length);
    expect(new Set(manifestUrls)).toEqual(new Set(configuredUrls));
    for (const preload of Object.values(SCENE_OBJECT_PRELOAD)) {
      for (const entry of preload) expect(manifestUrls).toContain(entry.url);
    }
  });

  it('场景物件图层统一使用 SceneObjectRenderer，避免重新引入结构化占位几何', () => {
    const sceneFiles = [
      'FactoryScene.js',
      'BasketballScene.js',
      'LycheeScene.js',
      'StealthScene.js',
      'IndustrialScene.js',
      'CampusScene.js',
      'SongshanScene.js',
    ];
    for (const file of sceneFiles) {
      const source = fs.readFileSync(path.join(PROJECT_ROOT, 'src/scenes', file), 'utf8');
      expect(source, file).toContain('SceneObjectRenderer.js');
      expect(source, file).toContain('SCENE_OBJECT_ASSETS');
      expect(source, file).toContain('loadSceneObjectAssets');
    }
  });
});
