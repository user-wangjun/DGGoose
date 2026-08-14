import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CampusScene,
  CAMPUS_BACKGROUND_URL,
  CAMPUS_CHARACTER_SCALE,
} from '../../src/scenes/CampusScene.js';
import { getHotspotsByScene } from '../../src/data/hotspots.js';
import { circleOverlapsRect, resolveTopdownMovement } from '../../src/core/TopdownController.js';

function createScene() {
  return new CampusScene({
    sceneManager: { change: vi.fn() },
    eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    badgeSystem: { unlockOrReveal: vi.fn() },
    dialogueRunner: null,
    dialogueBox: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
    input: null,
    player: null,
    container: null,
  });
}

function walkToTarget(from, target, movementOptions) {
  let position = { ...from };
  let blockedFrames = 0;

  for (let frame = 0; frame < 2400; frame += 1) {
    const distance = Math.hypot(target.x - position.x, target.y - position.y);
    if (distance < 10) {
      return { position, distance, blockedFrames };
    }

    const step = Math.min(150 / 60, distance);
    const desired = {
      x: position.x + ((target.x - position.x) / distance) * step,
      y: position.y + ((target.y - position.y) / distance) * step,
    };
    const next = resolveTopdownMovement(position, desired, movementOptions);
    if (Math.hypot(next.x - position.x, next.y - position.y) < 0.001) {
      blockedFrames += 1;
      if (blockedFrames >= 10) {
        return {
          position,
          distance: Math.hypot(target.x - position.x, target.y - position.y),
          blockedFrames,
        };
      }
    } else {
      blockedFrames = 0;
    }
    position = next;
  }

  return { position, distance: Math.hypot(target.x - position.x, target.y - position.y), blockedFrames };
}

function permutations(items) {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) => (
    permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map((rest) => [item, ...rest])
  ));
}

describe('CampusScene 正式校园地图契约', () => {
  it('使用 DGUT 图书馆正门参考重绘底图，并保留紧凑互动前场', () => {
    expect(CAMPUS_BACKGROUND_URL).toContain('bg_campus_dgut_library_illustrated_v9_1280.png');
    expect(CAMPUS_CHARACTER_SCALE).toBeCloseTo(1.12);
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    expect(fs.existsSync(path.join(projectRoot, 'assets/bg/bg_campus_dgut_library_illustrated_v9_1280.png'))).toBe(true);

    const scene = createScene();
    scene.hotspots = getHotspotsByScene('ch5');
    const obstacles = scene._getObstacles();
    const interactionPoints = [
      ...scene.hotspots,
      { x: 640, y: 680 },
    ];

    for (const point of interactionPoints) {
      expect(obstacles.some((obstacle) => circleOverlapsRect(point, obstacle, 20))).toBe(false);
    }
    expect(obstacles).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'building' }),
      expect.objectContaining({ kind: 'flower-bed' }),
    ]));
    expect(scene.hotspots.find((spot) => spot.id === 'campus_library')).toMatchObject({ x: 520, y: 470 });
    expect(scene.hotspots.find((spot) => spot.id === 'campus_path')).toMatchObject({ x: 640, y: 520 });
    expect(scene.hotspots.find((spot) => spot.id === 'campus_study_window')).toMatchObject({ x: 1060, y: 480 });
  });

  it('为建筑、绿化岛、树木和长椅提供 solid 碰撞层，且不把中央前场声明为障碍', () => {
    const scene = createScene();
    const obstacles = scene._getObstacles();
    const kinds = new Set(obstacles.map((obstacle) => obstacle.kind));

    expect([...kinds]).toEqual(expect.arrayContaining(['building', 'flower-bed', 'tree', 'bench']));
    expect(obstacles.every(({ x, y, width, height }) => (
      Number.isFinite(x)
      && Number.isFinite(y)
      && width > 0
      && height > 0
    ))).toBe(true);
    expect(kinds.has('road')).toBe(false);
  });

  it('观察点和出口是可通行的 interaction zone，不被实体碰撞矩形占住', () => {
    const scene = createScene();
    scene.hotspots = getHotspotsByScene('ch5');
    const interactables = scene._getInteractables();
    const obstacles = scene._getObstacles();

    for (const target of interactables) {
      expect(obstacles.some((obstacle) => circleOverlapsRect(target, obstacle, 20))).toBe(false);
    }
  });

  it('图书馆前场中央步道可移动，建筑主体会阻挡玩家穿越', () => {
    const scene = createScene();
    const movementOptions = {
      bounds: { left: 28, top: 70, right: 1252, bottom: 680 },
      obstacles: scene._getObstacles(),
      radius: 20,
    };

    const roadMove = resolveTopdownMovement(
      { x: 640, y: 610 },
      { x: 640, y: 590 },
      movementOptions,
    );
    expect(roadMove).toEqual({ x: 640, y: 590 });

    const buildingMove = resolveTopdownMovement(
      { x: 150, y: 420 },
      { x: 150, y: 250 },
      movementOptions,
    );
    expect(buildingMove.x).toBe(150);
    expect(buildingMove.y).toBeGreaterThanOrEqual(380);
  });

  it('三个观察点无论访问顺序如何都能沿碰撞层返回图书馆前场出口', () => {
    const scene = createScene();
    scene.hotspots = getHotspotsByScene('ch5');
    const movementOptions = {
      bounds: { left: 28, top: 70, right: 1252, bottom: 680 },
      obstacles: scene._getObstacles(),
      radius: 20,
    };

    for (const order of permutations(scene.hotspots)) {
      let position = { x: 640, y: 610 };
      for (const target of [...order, { x: 640, y: 680 }]) {
        const result = walkToTarget(position, target, movementOptions);
        expect(result.blockedFrames).toBeLessThan(10);
        expect(result.distance).toBeLessThan(10);
        position = result.position;
      }
    }
  });

  it('完成三个观察点后才开放校园出口', () => {
    const scene = createScene();
    scene.phase = 'explore';
    scene.hotspots = getHotspotsByScene('ch5');
    scene.topdown = {
      setProgress: vi.fn(),
      setMovementLocked: vi.fn(),
      setSceneInfo: vi.fn(),
      setExitStatus: vi.fn(),
    };

    const before = scene._getInteractables().find((target) => target.isExit);
    expect(before.available()).toBe(false);

    for (const hotspot of scene.hotspots) scene._observeHotspot(hotspot);

    const after = scene._getInteractables().find((target) => target.isExit);
    expect(scene.phase).toBe('exitReady');
    expect(after.available()).toBe(true);
  });
});
