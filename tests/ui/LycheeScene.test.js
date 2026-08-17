import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { PlayerController } from '../../src/core/PlayerController.js';
import { findNearbyInteractable } from '../../src/core/TopdownController.js';
import { LycheeScene, LYCHEE_SEQUENCE, LYCHEE_TREES } from '../../src/scenes/LycheeScene.js';

function createScene({ assetLoader = null, player: providedPlayer = null } = {}) {
  const player = providedPlayer || {
    x: 120,
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
  const scene = new LycheeScene({
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
  });
  return { scene, player };
}

describe('荔枝园俯视流程', () => {
  afterEach(() => vi.useRealTimers());

  it('保留 3→1→4→2 顺序', () => {
    expect(LYCHEE_SEQUENCE).toEqual([3, 1, 4, 2]);
  });

  it('正式地图保留五棵树，并把树干、围栏、工作区和关门设为 solid 碰撞', () => {
    const { scene } = createScene();
    scene.phase = 'explore';
    const treeZones = scene._getInteractables().filter((target) => target.isTree);
    const obstacles = scene._getObstacles();

    expect(LYCHEE_TREES).toHaveLength(5);
    expect(treeZones).toHaveLength(5);
    expect(treeZones.every((target) => target.zoneType === 'interaction')).toBe(true);
    expect(treeZones.every((target) => target.radius >= 96)).toBe(true);
    const treeThree = treeZones.find((target) => target.label === '3');
    scene.phase = 'explore';
    expect(findNearbyInteractable({ x: treeThree.x, y: treeThree.y + 80 }, treeZones)).toBe(treeThree);
    expect(obstacles.every((obstacle) => obstacle.solid === true)).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.id === 'work-area')).toBe(true);
    expect(obstacles.some((obstacle) => obstacle.id === 'exit-gate')).toBe(true);
    expect(obstacles.filter((obstacle) => obstacle.id.startsWith('tree-trunk-'))).toHaveLength(5);
  });

  it('出口保持 interaction zone，开门后只移除大门碰撞', () => {
    const { scene } = createScene();
    const closedObstacles = scene._getObstacles();
    scene.exitOpen = true;
    const openObstacles = scene._getObstacles();
    const exitZone = scene._getInteractables().find((target) => target.isExit);

    expect(closedObstacles.some((obstacle) => obstacle.id === 'exit-gate')).toBe(true);
    expect(openObstacles.some((obstacle) => obstacle.id === 'exit-gate')).toBe(false);
    expect(exitZone.zoneType).toBe('interaction');
    expect(exitZone.isExit).toBe(true);
  });

  it('绘制正式地图资源，不再绘制临时地图文字或几何地面', async () => {
    const backgroundImage = { width: 1672, height: 941 };
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

  it('开门后切换到去除关门残影的出口底图', async () => {
    const closedBackground = { id: 'closed-background' };
    const openBackground = { id: 'open-background' };
    const assetLoader = {
      loadImage: vi.fn((url) => Promise.resolve(url.includes('map-open') ? openBackground : closedBackground)),
    };
    const { scene } = createScene({ assetLoader });
    scene.onEnter();
    await scene.backgroundPromise;

    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() };
    scene._drawMap(ctx);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(closedBackground, 0, 0, 1280, 720);

    scene.exitOpen = true;
    await scene._loadOpenBackground();
    scene._drawMap(ctx);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(openBackground, 0, 0, 1280, 720);
    scene.onExit();
  });

  it('正式底图不可用时仍绘制独立果园组件，避免只剩纯色兜底', () => {
    const treeImages = [
      ['treeA', { id: 'tree-a' }],
      ['treeB', { id: 'tree-b' }],
      ['treeC', { id: 'tree-c' }],
      ['treeD', { id: 'tree-d' }],
      ['treeE', { id: 'tree-e' }],
    ];
    const closedGate = { id: 'closed-gate' };
    const { scene } = createScene();
    scene.backgroundImage = null;
    scene.exitOpen = false;
    scene.objectImages = new Map([...treeImages, ['gateClosed', closedGate]]);

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };

    scene._drawMap(ctx);
    scene._drawSceneObjects(ctx);

    expect(ctx.drawImage).toHaveBeenCalledTimes(6);
    expect(ctx.drawImage.mock.calls.map(([image]) => image)).toEqual([
      ...treeImages.map(([, image]) => image),
      closedGate,
    ]);
  });

  it('正式底图就绪且栅栏关闭时不重复叠加树和关门组件', () => {
    const { scene } = createScene();
    scene.backgroundImage = { id: 'closed-background' };
    scene.exitOpen = false;
    scene.objectImages = new Map([
      ['treeA', { id: 'tree-a' }],
      ['treeB', { id: 'tree-b' }],
      ['treeC', { id: 'tree-c' }],
      ['treeD', { id: 'tree-d' }],
      ['treeE', { id: 'tree-e' }],
      ['gateClosed', { id: 'closed-gate' }],
    ]);

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };

    scene._drawSceneObjects(ctx);

    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('运行时组件层显示当前目标，并给已摘树留下可见状态', () => {
    const { scene } = createScene();
    scene.onEnter();
    scene._startExploration();
    scene.harvested = new Set(['tree-3']);
    scene.harvestStep = 1;
    scene.animTime = 0.4;

    const ctx = {
      canvas: {
        width: 1280,
        height: 720,
        getBoundingClientRect: () => ({ width: 640, height: 360 }),
      },
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      setLineDash: vi.fn(),
    };

    scene._drawTreeComponents(ctx);

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('✓ 已摘', 650, expect.any(Number));
    scene.onExit();
  });

  it('摘错只提示，不清空已完成进度', () => {
    const { scene } = createScene();
    scene.phase = 'explore';
    scene.harvestStep = 1;
    scene.harvested.add('tree-3');
    scene._onTreeInteract({ id: 'tree-2', label: '2' });

    expect(scene.harvested).toEqual(new Set(['tree-3']));
    expect(scene.harvestStep).toBe(1);
  });

  it('四次正确摘取后进入交付阶段，而不是直接打开出口', () => {
    vi.useFakeTimers();
    const { scene } = createScene();
    scene.onEnter();
    scene._startExploration();

    for (const label of LYCHEE_SEQUENCE) {
      scene._onTreeInteract({ id: `tree-${label}`, label: String(label) });
      vi.advanceTimersByTime(500);
    }

    expect(scene.phase).toBe('deliveryReady');
    expect(scene.exitOpen).toBe(false);
    expect(scene.harvested.size).toBe(4);
    scene.onExit();
  });

  it('交付对话完成后开放大门碰撞和出口互动', () => {
    const { scene } = createScene();
    scene.onEnter();
    scene._startExploration();
    scene.harvested = new Set(['tree-3', 'tree-1', 'tree-4', 'tree-2']);
    scene.harvestStep = LYCHEE_SEQUENCE.length;
    scene.phase = 'deliveryReady';

    scene._onGrandmaInteract();
    expect(scene.phase).toBe('outro');
    scene._onDialogueNext({ finished: true });
    expect(scene.phase).toBe('gateOpening');

    scene.update(1);

    const exitZone = scene._getInteractables().find((target) => target.isExit);
    expect(scene.phase).toBe('exitReady');
    expect(scene.exitOpen).toBe(true);
    expect(scene._getObstacles().some((obstacle) => obstacle.id === 'exit-gate')).toBe(false);
    expect(exitZone.available()).toBe(true);
    scene.onExit();
  });

  it('交付后点击右侧出口不会被上方树干的碰撞角卡在出口热区外', () => {
    const player = new PlayerController({
      x: 150,
      y: 610,
      bounds: { width: 1280, height: 720 },
    });
    const { scene } = createScene({ player });
    scene.onEnter();
    scene.phase = 'exitReady';
    scene.exitOpen = true;
    scene.topdown.setMap({ obstacles: scene._getObstacles() });
    scene.topdown.setMovementLocked(false);
    scene.topdown.setInteractionEnabled(true);
    scene.topdown.moveTarget = { x: 1188, y: 158 };

    for (let frame = 0; frame < 600; frame += 1) {
      scene.topdown.update(1 / 60);
    }

    expect(scene.topdown.activeInteractable?.id).toBe('exit');
    scene.onExit();
  });
});
