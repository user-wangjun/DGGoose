import { describe, expect, it, vi } from 'vitest';
import { MAP_TRANSITION_ASSETS, MapTransitionOverlay } from '../../src/core/MapTransitionOverlay.js';
import transitionRouteData from '../../assets/transition/transition_tips.json';

const routeData = {
  nodes: [
    { id: 'toy-factory', anchor: { x: 100, y: 100 }, color: '#F0A343' },
    { id: 'campus', anchor: { x: 900, y: 500 }, color: '#8AC16B' },
  ],
  route: {
    order: ['toy-factory', 'campus'],
    segments: [
      {
        from: 'toy-factory',
        to: 'campus',
        controlPoints: [{ x: 350, y: 120 }, { x: 650, y: 480 }],
      },
    ],
  },
  tips: [
    { id: 'city-01', category: '城市', text: '城市会慢慢展开。' },
    { id: 'campus-01', category: '校园', text: '树荫和绿道，陪你慢慢逛校园。' },
  ],
};

const tipRefreshRouteData = {
  ...routeData,
  tips: [
    ...routeData.tips,
    { id: 'campus-02', category: '校园', text: '校园里的风会把脚步放慢。' },
  ],
};

describe('MapTransitionOverlay 城市地图转场', () => {
  it('默认转场资源使用可被 Vite 追踪的模块 URL', () => {
    expect(MAP_TRANSITION_ASSETS.map).toContain('assets/transition/city_map_base.png');
    expect(MAP_TRANSITION_ASSETS.marker).toContain('assets/transition/gxe_map_marker.png');
    expect(MAP_TRANSITION_ASSETS.data).toContain('assets/transition/transition_tips.json');
    expect(MAP_TRANSITION_ASSETS.map).not.toBe('assets/transition/city_map_base.png');
  });

  it('转场期间创建覆盖整个视口的遮罩，避免超宽横屏露出底层 UI', () => {
    const context = { scale: vi.fn() };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const transition = new MapTransitionOverlay({ routeData });
    const gameCanvas = document.createElement('canvas');
    gameCanvas.width = 1280;
    gameCanvas.height = 720;
    document.body.appendChild(gameCanvas);

    transition.mount(gameCanvas);

    const backdrop = document.querySelector('[data-map-transition-backdrop]');
    expect(backdrop).not.toBeNull();
    expect(backdrop.style.position).toBe('fixed');
    expect(backdrop.style.inset).toMatch(/^0(?:px)?$/);
    expect(backdrop.style.zIndex).toBe('19');
    expect(backdrop.style.display).toBe('none');

    transition.start({ toName: 'ch5' });
    expect(backdrop.style.display).toBe('block');

    transition.update(3.6);
    expect(backdrop.style.display).toBe('none');

    transition.start({ toName: 'ch5' });
    expect(backdrop.style.display).toBe('block');

    transition.stop();
    expect(backdrop.style.display).toBe('none');

    transition.destroy();
    expect(document.querySelector('[data-map-transition-backdrop]')).toBeNull();
    gameCanvas.remove();
    getContext.mockRestore();
  });

  it('按时间线推进地图、路线、胸前徽章和 Tip，并在结束时停用', () => {
    const transition = new MapTransitionOverlay({ routeData });

    expect(transition.start({ toName: 'ch5' })).toBe(true);
    expect(transition.getState()).toMatchObject({
      active: true,
      mapAlpha: 0,
      routeProgress: 0,
      markerVisible: false,
      tipAlpha: 1,
      markerAsset: MAP_TRANSITION_ASSETS.marker,
    });

    transition.update(0.35);
    expect(transition.getState().tipAlpha).toBe(1);

    transition.update(0.5);
    const midState = transition.getState();
    expect(midState.mapAlpha).toBe(1);
    expect(midState.routeProgress).toBeGreaterThan(0);
    expect(midState.markerVisible).toBe(true);
    expect(midState.markerRouteProgress).toBeGreaterThan(0);
    expect(midState.tipAlpha).toBe(1);

    transition.update(2.749);
    expect(transition.getState()).toMatchObject({ active: true, tipAlpha: 1 });

    transition.update(0.001);
    expect(transition.getState()).toMatchObject({ active: false, fadeAlpha: 0, tipAlpha: 0 });
  });

  it('目标节点没有映射时不启动徽章式地图转场', () => {
    const transition = new MapTransitionOverlay({ routeData });

    expect(transition.start({ toName: 'chapterSelect' })).toBe(false);
    expect(transition.getState().active).toBe(false);
  });

  it('始终使用胸前徽章作为移动标记，不读取场景印记', () => {
    const transition = new MapTransitionOverlay({ routeData });

    expect(transition.start({ fromName: 'prologue', toName: 'ch5' })).toBe(true);
    expect(transition.getState()).toMatchObject({
      markerAsset: MAP_TRANSITION_ASSETS.marker,
      markerVisible: false,
    });
    transition.update(0.8);
    expect(transition.getState().markerVisible).toBe(true);
    expect(transition.badgeImage).toBeUndefined();
    expect('badgeId' in transition.getState()).toBe(false);
  });

  it('底图缩放时，动态路线层复用底图的同一变换', () => {
    const transition = new MapTransitionOverlay({ routeData });
    const transform = transition._getMapTransform({ mapScale: 1.04, mapTranslateY: 10 });

    expect(transform.scale).toBe(1.04);
    expect(transform.x).toBeCloseTo(-25.6, 6);
    expect(transform.y).toBeCloseTo(-4.4, 6);
  });

  it('徽章按目标节点在实际路线弧长上的位置停靠，而不是按节点序号估算', () => {
    const unequalRoute = {
      nodes: [
        { id: 'toy-factory', anchor: { x: 0, y: 0 } },
        { id: 'basketball', anchor: { x: 100, y: 0 } },
        { id: 'lychee-orchard', anchor: { x: 100, y: 900 } },
      ],
      route: {
        order: ['toy-factory', 'basketball', 'lychee-orchard'],
        segments: [
          { from: 'toy-factory', to: 'basketball', controlPoints: [{ x: 33, y: 0 }, { x: 66, y: 0 }] },
          { from: 'basketball', to: 'lychee-orchard', controlPoints: [{ x: 100, y: 300 }, { x: 100, y: 600 }] },
        ],
      },
    };
    const transition = new MapTransitionOverlay({ routeData: unequalRoute });
    transition.start({ toName: 'ch1' });

    // 第一段约 100px、第二段约 900px，目标应在全路程约 10% 处，而不是 50% 处。
    expect(transition._getTargetRouteProgress()).toBeCloseTo(0.1, 2);
    expect(transition._getTargetRouteProgress()).not.toBeCloseTo(0.5, 2);
    const targetPoint = transition._getRoutePoint(transition._getTargetRouteProgress());
    expect(targetPoint.x).toBeCloseTo(100, 0);
    expect(targetPoint.y).toBeCloseTo(0, 0);
  });

  it('正式城市地图数据中篮球馆目标点与路线节点重合', () => {
    const transition = new MapTransitionOverlay({ routeData: transitionRouteData });
    transition.start({ toName: 'ch1' });

    const target = transitionRouteData.nodes.find((node) => node.id === 'basketball');
    const targetPoint = transition._getRoutePoint(transition._getTargetRouteProgress());

    expect(target).toBeDefined();
    expect(targetPoint.x).toBeCloseTo(target.anchor.x, 0);
    expect(targetPoint.y).toBeCloseTo(target.anchor.y, 0);
  });

  it('Tip 从数据中按目标类型选择，并可由 draw 读取当前内容', () => {
    const transition = new MapTransitionOverlay({ routeData });

    transition.start({ toName: 'ch5' });
    expect(transition.getState().tip.text).toBe('树荫和绿道，陪你慢慢逛校园。');
  });

  it('显式 refresh() 只轮换 Tip，不暴露跳过入口', () => {
    const transition = new MapTransitionOverlay({ routeData: tipRefreshRouteData });

    transition.start({ toName: 'ch5' });
    expect('skip' in transition).toBe(false);
    transition.update(1.49);
    const beforeRefresh = transition.getState();

    expect(transition.refresh()).toBe(true);
    expect(transition.getState()).toMatchObject({
      active: true,
      elapsedMs: beforeRefresh.elapsedMs,
      tipAlpha: 1,
      refreshCount: 1,
    });
  });

  it('单击只轮换 Tip，不重置地图转场进度', () => {
    const transition = new MapTransitionOverlay({ routeData: tipRefreshRouteData });

    transition.start({ toName: 'ch5' });
    transition.update(1.49);
    const beforeClick = transition.getState();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    transition._onRefreshPointerDown(event);

    const afterClick = transition.getState();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(afterClick.active).toBe(true);
    expect(afterClick.elapsedMs).toBe(beforeClick.elapsedMs);
    expect(afterClick.transitionProgress).toBe(beforeClick.transitionProgress);
    expect(afterClick.mapAlpha).toBe(beforeClick.mapAlpha);
    expect(afterClick.routeProgress).toBe(beforeClick.routeProgress);
    expect(afterClick.refreshCount).toBe(1);
    expect(afterClick.tip.id).not.toBe(beforeClick.tip.id);
  });
});
