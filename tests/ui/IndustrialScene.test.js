import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { getHotspotsByScene } from '../../src/data/hotspots.js';
import {
  ASSEMBLY_STATION,
  GEAR_POSITIONS,
  SECURITY_GATE,
  IndustrialScene,
} from '../../src/scenes/IndustrialScene.js';

const GAME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function createScene({ assetLoader = null } = {}) {
  const player = {
    x: 130,
    y: 600,
    facing: 1,
    animState: 'idle',
    get position() { return { x: this.x, y: this.y }; },
    setPosition(x, y) { this.x = x; this.y = y; },
    update: vi.fn(),
  };
  const input = {
    getVector: () => ({ x: 0, y: 0, run: false }),
    onAction: vi.fn(),
    offAction: vi.fn(),
    setJoystickVector: vi.fn(),
  };
  const scene = new IndustrialScene({
    sceneManager: { change: vi.fn() },
    eventBus: new EventBus(),
    badgeSystem: { unlockOrReveal: vi.fn() },
    dialogueRunner: {},
    dialogueBox: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
    input,
    player,
    container: document.createElement('div'),
    getChoice: () => null,
    assetLoader,
    gooseSprite: { update: vi.fn(), draw: vi.fn().mockReturnValue(true), playAction: vi.fn() },
    engineerSprite: { update: vi.fn(), draw: vi.fn().mockReturnValue(true), playAction: vi.fn(), clearAction: vi.fn() },
    industrialWorkerSprite: { update: vi.fn(), draw: vi.fn().mockReturnValue(true), playAction: vi.fn(), clearAction: vi.fn() },
  });
  scene.hotspots = getHotspotsByScene('ch4');
  return { scene, player };
}

function readPngSize(filePath) {
  const data = fs.readFileSync(filePath);
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe('第四章·工业园区正式场景', () => {
  afterEach(() => vi.useRealTimers());

  it('交付 16:9 正式地图底图，并由场景绘制而非临时几何/文字回退', async () => {
    const relativePath = 'assets/bg/industrial_park_map.png';
    expect(readPngSize(path.join(GAME_ROOT, relativePath))).toEqual({ width: 1280, height: 720 });

    const backgroundImage = { width: 1280, height: 720 };
    const assetLoader = { loadImage: vi.fn().mockResolvedValue(backgroundImage) };
    const { scene } = createScene({ assetLoader });
    scene.onEnter();
    await scene.backgroundPromise;

    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() };
    scene._drawMap(ctx);

    expect(ctx.drawImage).toHaveBeenCalledWith(backgroundImage, 0, 0, 1280, 720);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fillText).not.toHaveBeenCalled();
    scene.onExit();
  });

  it('把厂房、围栏、设备、仓库、墙体和未开放安检门定义为 solid 碰撞', () => {
    const { scene } = createScene();
    const obstacles = scene._getObstacles();
    const interactables = scene._getInteractables();

    expect(obstacles.length).toBeGreaterThan(8);
    expect(obstacles.every((obstacle) => obstacle.solid === true)).toBe(true);
    for (const id of ['research-building', 'factory-hall', 'warehouse', 'equipment-fence', 'yard-equipment', 'security-gate']) {
      expect(obstacles.some((obstacle) => obstacle.id === id)).toBe(true);
    }
    expect(interactables.filter((target) => target.isGear)).toHaveLength(3);
    expect(interactables.filter((target) => target.isGear).every((target) => target.zoneType === 'interaction')).toBe(true);
    expect(interactables.find((target) => target.id === ASSEMBLY_STATION.id).zoneType).toBe('interaction');
    expect(interactables.filter((target) => target.isHotspot).every((target) => target.zoneType === 'interaction')).toBe(true);
    expect(interactables.find((target) => target.id === 'industrial_worker_silhouette')).toEqual(
      expect.objectContaining({ isCharacter: true, zoneType: 'interaction' }),
    );

    // 碰撞框按底图的落地边缘校准：左侧楼体不能漏到外墙，右侧厂房/设备不能缩在贴图内部。
    expect(obstacles.find((obstacle) => obstacle.id === 'research-wall')).toEqual(
      expect.objectContaining({ x: 0, y: 286, width: 158, height: 190 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'glasshouse-wall')).toEqual(
      expect.objectContaining({ x: 264, y: 488, width: 144, height: 94 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'factory-pipe-wall')).toEqual(
      expect.objectContaining({ x: 1120, y: 48, width: 96, height: 272 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'yard-equipment')).toEqual(
      expect.objectContaining({ x: 640, y: 448, width: 72, height: 44 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'equipment-fence')).toEqual(
      expect.objectContaining({ x: 612, y: 416, width: 120, height: 44 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'equipment-fence-right')).toEqual(
      expect.objectContaining({ x: 850, y: 416, width: 264, height: 32 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'security-gate')).toEqual(
      expect.objectContaining({ x: 1148, y: 302, width: 92, height: 30 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'warehouse')).toEqual(
      expect.objectContaining({ x: 878, y: 420, width: 178, height: 180 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'yard-machines')).toEqual(
      expect.objectContaining({ x: 1040, y: 402, width: 80, height: 192 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'yard-crates')).toEqual(
      expect.objectContaining({ x: 778, y: 414, width: 100, height: 100 }),
    );
    expect(obstacles.find((obstacle) => obstacle.id === 'equipment-wall')).toEqual(
      expect.objectContaining({ x: 610, y: 616, width: 502, height: 42 }),
    );
  });

  it('组装访客徽章后只移除安检门碰撞，并开放出口 interaction zone', () => {
    const { scene } = createScene();
    const closedObstacles = scene._getObstacles();
    scene.gateOpen = true;
    const openObstacles = scene._getObstacles();
    const exitZone = scene._getInteractables().find((target) => target.isExit);

    expect(closedObstacles.some((obstacle) => obstacle.id === 'security-gate')).toBe(true);
    expect(openObstacles.some((obstacle) => obstacle.id === 'security-gate')).toBe(false);
    expect(exitZone.zoneType).toBe('interaction');
    expect(exitZone.isExit).toBe(true);
    expect(SECURITY_GATE.isExit).toBe(true);
  });

  it('走通观察→收集三齿轮→装配→安检门的完整流程', () => {
    vi.useFakeTimers();
    const { scene } = createScene();
    scene.onEnter();
    expect(scene.industrialWorkerSprite.playAction).toHaveBeenCalledWith('work', { facing: -1, restart: true });
    scene._onDialogueNext({ finished: true });

    for (const hotspot of scene.hotspots) scene._onInteract({ ...hotspot, isHotspot: true });
    expect(scene.industrialWorkerSprite.playAction).toHaveBeenCalledWith('interact', { facing: -1, restart: true });
    vi.advanceTimersByTime(320);
    expect(scene.phase).toBe('collect');

    for (const gear of GEAR_POSITIONS) scene._onInteract({ ...gear, isGear: true });
    expect(scene.collectedGears.size).toBe(3);
    scene._onInteract({ ...ASSEMBLY_STATION });
    expect(scene.phase).toBe('assembling');

    vi.advanceTimersByTime(1400);
    expect(scene.phase).toBe('exitReady');
    expect(scene.gateOpen).toBe(true);
    expect(scene._getObstacles().some((obstacle) => obstacle.id === 'security-gate')).toBe(false);

    scene._onInteract({ ...SECURITY_GATE });
    expect(scene.phase).toBe('outro');
    scene._onDialogueNext({ finished: true });
    expect(scene.phase).toBe('choice');
    scene.onExit();
  });
});
