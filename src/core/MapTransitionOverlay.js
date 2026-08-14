import { GAME } from '../config.js';

/**
 * 地图转场默认资源。使用模块 URL 让 Vite 在生产构建时生成带哈希的资源地址；
 * 地图本身只承担静态环境，动态元素全部在运行时绘制。
 */
export const MAP_TRANSITION_ASSETS = {
  map: new URL('../../assets/transition/city_map_base.png', import.meta.url).href,
  marker: new URL('../../assets/transition/gxe_map_marker.png', import.meta.url).href,
  data: new URL('../../assets/transition/transition_tips.json', import.meta.url).href,
};

/** 场景 id 到城市地图节点 id 的映射。章节选择与主菜单不属于路线目标。 */
const SCENE_TO_NODE = {
  prologue: 'toy-factory',
  ch1: 'basketball',
  ch2: 'lychee-orchard',
  ch3: 'roast-goose-shop',
  ch4: 'high-tech-park',
  ch5: 'campus',
  finale: 'songshan-lake',
};

const TIMELINE = {
  durationMs: 3600,
  mapReveal: [0, 650],
  routeDraw: [300, 1500],
  markerTravel: [720, 2900],
  tip: [0, 3600],
  targetHighlight: [2300, 3050],
  fadeOut: [3200, 3600],
};

const NODE_TIP_CATEGORIES = {
  'lychee-orchard': '美食',
  'roast-goose-shop': '美食',
  campus: '校园',
};

const FALLBACK_TIP = {
  category: '城市',
  text: '沿着这条路，城市会慢慢展开。',
};

/** 将数值限制在指定区间，避免后台恢复时动画跳出可视范围。 */
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

/** 将时间映射到 0~1 区间；区间外保持边界值。 */
function timelineProgress(elapsedMs, [startMs, endMs]) {
  if (endMs <= startMs) return elapsedMs >= endMs ? 1 : 0;
  return clamp((elapsedMs - startMs) / (endMs - startMs));
}

/** 地图出现、路径绘制和目标高亮采用平滑的减速曲线。 */
function easeOutCubic(value) {
  const normalized = clamp(value);
  return 1 - ((1 - normalized) ** 3);
}

/** 计算三次贝塞尔曲线上的点，用于把 JSON 路线采样成可绘制折线。 */
function cubicPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return {
    x: (inverse ** 3 * start.x)
      + (3 * inverse ** 2 * t * controlA.x)
      + (3 * inverse * t ** 2 * controlB.x)
      + (t ** 3 * end.x),
    y: (inverse ** 3 * start.y)
      + (3 * inverse ** 2 * t * controlA.y)
      + (3 * inverse * t ** 2 * controlB.y)
      + (t ** 3 * end.y),
  };
}

/** 计算两点间距离，为路径进度和徽章位置提供统一的弧长基准。 */
function distanceBetween(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/**
 * 城市地图转场运行时叠加层。
 *
 * 设计边界：city_map_base.png 与 gxe_map_marker.png 是素材层；路线、节点、
 * 胸前徽章运动、路线进度、Tip、雾光和淡出均由这里独立绘制，避免把动态 UI 烘焙进背景图。
 */
export class MapTransitionOverlay {
  /**
   * @param {Object} [options]
   * @param {AssetLoader|null} [options.assetLoader] - 共享资源加载器
   * @param {Object} [options.assets] - 地图、胸前标记和 Tip 数据 URL
   * @param {Object|null} [options.routeData] - 测试或预览时直接注入的转场数据
   * @param {HTMLImageElement|null} [options.mapImage] - 已加载的地图图像
   * @param {HTMLImageElement|null} [options.markerImage] - 已加载的徽章图像
   * @param {number} [options.sampleSteps=24] - 每段贝塞尔曲线的采样密度
   */
  constructor({
    assetLoader = null,
    assets = MAP_TRANSITION_ASSETS,
    routeData = null,
    mapImage = null,
    markerImage = null,
    sampleSteps = 24,
  } = {}) {
    this.assetLoader = assetLoader;
    this.assets = { ...MAP_TRANSITION_ASSETS, ...assets };
    this.mapImage = mapImage;
    this.markerImage = markerImage;
    this.routeData = routeData;
    this.sampleSteps = Math.max(4, sampleSteps);

    this.nodesById = new Map();
    this.routeOrder = [];
    this.routePoints = [];
    this.routeCumulativeLengths = [];
    /** @type {Map<string, number>} 路线节点在实际弧长上的 0~1 进度 */
    this.routeNodeProgress = new Map();
    this.totalRouteLength = 0;

    this.active = false;
    this.elapsedMs = TIMELINE.durationMs;
    this.fromName = null;
    this.toName = null;
    this.targetNodeId = null;
    this.refreshCount = 0;
    this.tip = FALLBACK_TIP;
    this.loadError = null;

    /** @type {HTMLCanvasElement|null} 覆盖底层 DOM UI 的独立画布 */
    this.overlayCanvas = null;
    /** @type {CanvasRenderingContext2D|null} 独立转场画布上下文 */
    this.overlayContext = null;
    /** @type {HTMLCanvasElement|null} 游戏主画布，用于同步 CSS 适配尺寸 */
    this.gameCanvas = null;
    /** @type {HTMLDivElement|null} 遮挡画布两侧底层 UI 的全屏背板 */
    this.backdrop = null;
    /** @type {Window|null} 接收重播输入的窗口对象 */
    this.inputTarget = null;

    this._onRefreshKeyDown = this._onRefreshKeyDown.bind(this);
    this._onRefreshPointerDown = this._onRefreshPointerDown.bind(this);

    this._setRouteData(routeData);
  }

  /**
   * 挂载独立转场画布，使地图能覆盖对话框等 ui-root 内容。
   * @param {HTMLCanvasElement} gameCanvas - 游戏主画布
   * @param {HTMLElement} [container=document.body] - 挂载容器
   * @returns {HTMLCanvasElement|null} 转场画布
   */
  mount(gameCanvas, container = document.body) {
    if (!gameCanvas || !container || typeof document === 'undefined') return null;
    if (this.overlayCanvas) return this.overlayCanvas;

    this.gameCanvas = gameCanvas;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.setAttribute('data-map-transition-canvas', '');
    this.overlayCanvas.width = gameCanvas.width;
    this.overlayCanvas.height = gameCanvas.height;
    this.backdrop = document.createElement('div');
    this.backdrop.setAttribute('data-map-transition-backdrop', '');
    this.backdrop.style.cssText = `
      position: fixed;
      inset: 0;
      display: none;
      pointer-events: none;
      z-index: 19;
      background: #1a1a2e;
    `;
    this.overlayCanvas.style.cssText = `
      display: block;
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      margin: 0;
      pointer-events: none;
      z-index: 20;
      image-rendering: auto;
    `;
    this.overlayContext = this.overlayCanvas.getContext('2d');
    const dpr = Math.max(1, gameCanvas.width / GAME.WIDTH);
    this.overlayContext?.scale(dpr, dpr);
    container.appendChild(this.backdrop);
    container.appendChild(this.overlayCanvas);
    this._setBackdropVisible(this.active);
    this._syncOverlayLayout();
    this.inputTarget = typeof window !== 'undefined' ? window : null;
    this.inputTarget?.addEventListener('keydown', this._onRefreshKeyDown, true);
    this.inputTarget?.addEventListener('pointerdown', this._onRefreshPointerDown, true);
    return this.overlayCanvas;
  }

  /** 销毁独立转场画布，供页面重建或测试清理使用。 */
  destroy() {
    this.stop();
    if (this.backdrop?.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
    if (this.overlayCanvas?.parentNode) {
      this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    }
    this.overlayCanvas = null;
    this.overlayContext = null;
    this.gameCanvas = null;
    this.backdrop = null;
    this.inputTarget?.removeEventListener('keydown', this._onRefreshKeyDown, true);
    this.inputTarget?.removeEventListener('pointerdown', this._onRefreshPointerDown, true);
    this.inputTarget = null;
  }

  /**
   * 异步预加载地图、徽章和 Tip 数据；失败时保留绘制降级，不阻塞游戏启动。
   * @returns {Promise<boolean>} 是否至少成功取得一份动态转场数据
   */
  async load() {
    if (!this.assetLoader) {
      return Boolean(this.routeData || this.mapImage || this.markerImage);
    }

    try {
      const [mapImage, markerImage, routeData] = await Promise.all([
        this.mapImage ? Promise.resolve(this.mapImage) : this.assetLoader.loadImage(this.assets.map),
        this.markerImage ? Promise.resolve(this.markerImage) : this.assetLoader.loadImage(this.assets.marker),
        this.routeData ? Promise.resolve(this.routeData) : this.assetLoader.loadJson(this.assets.data),
      ]);

      this.mapImage = mapImage || this.mapImage;
      this.markerImage = markerImage || this.markerImage;
      if (routeData) {
        this._setRouteData(routeData);
      }
      return Boolean(this.mapImage && this.markerImage && this.routeData);
    } catch (error) {
      this.loadError = error;
      return false;
    }
  }

  /**
   * 开始一次目标章节地图转场。
   * 主菜单和章节选择没有路线目标，因此不会错误地显示徽章进度。
   * @param {Object} [options]
   * @param {string|null} [options.fromName]
   * @param {string|null} [options.toName]
   * @returns {boolean} 是否启动了转场
   */
  start({ fromName = null, toName = null } = {}) {
    const targetNodeId = SCENE_TO_NODE[toName];
    if (!targetNodeId) {
      this.stop();
      return false;
    }

    this.active = true;
    this.elapsedMs = 0;
    this.fromName = fromName;
    this.toName = toName;
    this.targetNodeId = targetNodeId;
    this.refreshCount = 0;
    this.tip = this._selectTip(targetNodeId, this.refreshCount);
    this._setBackdropVisible(true);
    return true;
  }

  /** 立即清理当前地图转场，仅供场景生命周期销毁使用；正常转场不可跳过。 */
  stop() {
    this.active = false;
    this.elapsedMs = TIMELINE.durationMs;
    this._setBackdropVisible(false);
  }

  /**
   * 刷新当前转场的 Tip，保留地图时间线进度，不会快进或跳过转场。
   * @returns {boolean} 是否刷新成功
   */
  refresh() {
    return this.refreshTip();
  }

  /**
   * 只轮换当前 Tip，保留地图、路线、标记和淡出动画的现有进度。
   * @returns {boolean} 是否刷新成功
   */
  refreshTip() {
    if (!this.active) return false;

    this.refreshCount += 1;
    this.tip = this._selectTip(this.targetNodeId, this.refreshCount);
    return true;
  }

  /** @private */
  _onRefreshKeyDown(event) {
    if (!this.active || event.repeat || (event.key !== ' ' && event.code !== 'Space')) return;

    event.preventDefault();
    event.stopPropagation();
    this.refreshTip();
  }

  /** @private */
  _onRefreshPointerDown(event) {
    if (!this.active) return;

    event.preventDefault();
    event.stopPropagation();
    this.refreshTip();
  }

  /**
   * 推进转场时间线。
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (!this.active) return;

    const safeDelta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    this.elapsedMs = Math.min(TIMELINE.durationMs, this.elapsedMs + safeDelta * 1000);
    if (this.elapsedMs >= TIMELINE.durationMs) {
      this.active = false;
      this._setBackdropVisible(false);
    }
  }

  /**
   * 获取当前动画状态，供单元测试与预览调试读取。
   * @returns {Object}
   */
  getState() {
    const mapAlpha = easeOutCubic(timelineProgress(this.elapsedMs, TIMELINE.mapReveal));
    const routeProgress = easeOutCubic(timelineProgress(this.elapsedMs, TIMELINE.routeDraw));
    const markerProgress = easeOutCubic(timelineProgress(this.elapsedMs, TIMELINE.markerTravel));
    const targetProgress = this._getTargetRouteProgress();
    const targetHighlight = easeOutCubic(timelineProgress(this.elapsedMs, TIMELINE.targetHighlight));
    const fadeAlpha = 1 - easeOutCubic(timelineProgress(this.elapsedMs, TIMELINE.fadeOut));
    const transitionProgress = timelineProgress(this.elapsedMs, [0, TIMELINE.durationMs]);

    return {
      active: this.active,
      elapsedMs: this.elapsedMs,
      transitionProgress,
      mapAlpha,
      mapScale: 1.04 - (mapAlpha * 0.04),
      mapTranslateY: 10 * (1 - mapAlpha),
      routeProgress,
      markerVisible: this.active && this.elapsedMs >= TIMELINE.markerTravel[0],
      markerProgress,
      markerRouteProgress: targetProgress * markerProgress,
      targetHighlight,
      targetScale: 1 + (0.08 * targetHighlight),
      markerAsset: this.assets.marker,
      tipAlpha: this.active ? 1 : 0,
      tip: this.tip,
      fadeAlpha,
      refreshCount: this.refreshCount,
      targetNodeId: this.targetNodeId,
    };
  }

  /**
   * 在当前场景画面之上绘制城市地图转场。
   * @param {CanvasRenderingContext2D|null} ctx
   */
  draw(ctx) {
    const renderContext = this.overlayContext || ctx;
    if (!renderContext) return;

    if (this.overlayCanvas) {
      this._syncOverlayLayout();
      this._clearOverlayCanvas();
    }
    if (!this.active) return;

    const state = this.getState();
    if (state.fadeAlpha <= 0) return;

    renderContext.save();
    renderContext.globalAlpha = state.fadeAlpha;
    renderContext.imageSmoothingEnabled = true;

    this._drawMap(renderContext, state);
    this._drawMist(renderContext, state);
    // 底图在转场前段会做同心缩放与垂直平移；路线、节点和徽章必须复用同一变换，
    // 否则缩放阶段动态元素会逐渐偏离底图中的实际地点。
    this._withMapTransform(renderContext, state, () => {
      this._drawRoute(renderContext, state.routeProgress);
      this._drawNodes(renderContext, state);
      this._drawMarker(renderContext, state);
    });
    this._drawProgressRail(renderContext, state);
    this._drawTip(renderContext, state);

    renderContext.restore();
  }

  /** @private */
  _setRouteData(routeData) {
    if (!routeData) return;

    this.routeData = routeData;
    this.nodesById = new Map((routeData.nodes || []).map((node) => [node.id, node]));
    this.routeOrder = Array.isArray(routeData.route?.order) ? routeData.route.order.slice() : [];
    this.routePoints = this._sampleRoute(routeData);
    this._rebuildRouteMetrics();
  }

  /** @private */
  _syncOverlayLayout() {
    if (!this.overlayCanvas || !this.gameCanvas) return;
    this.overlayCanvas.style.width = this.gameCanvas.style.width;
    this.overlayCanvas.style.height = this.gameCanvas.style.height;
  }

  /** @private */
  _setBackdropVisible(visible) {
    if (!this.backdrop) return;
    this.backdrop.style.display = visible ? 'block' : 'none';
  }

  /** @private */
  _clearOverlayCanvas() {
    if (!this.overlayContext || !this.overlayCanvas) return;
    this.overlayContext.save();
    this.overlayContext.setTransform(1, 0, 0, 1, 0, 0);
    this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.overlayContext.restore();
  }

  /**
   * 执行与城市底图完全一致的缩放/平移变换。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} state - 当前转场状态
   * @param {Function} draw - 地图坐标系内的绘制函数
   * @private
   */
  _withMapTransform(ctx, state, draw) {
    if (!ctx || typeof draw !== 'function') return;

    const transform = this._getMapTransform(state);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    draw();
    ctx.restore();
  }

  /**
   * 计算城市底图及其动态叠加层共用的变换参数。
   * @param {Object} state - 当前转场状态
   * @returns {{x:number,y:number,scale:number}}
   * @private
   */
  _getMapTransform(state) {
    const scale = Number.isFinite(state?.mapScale) ? state.mapScale : 1;
    const mapWidth = GAME.WIDTH * scale;
    const mapHeight = GAME.HEIGHT * scale;
    return {
      scale,
      x: (GAME.WIDTH - mapWidth) / 2,
      y: ((GAME.HEIGHT - mapHeight) / 2) + (Number.isFinite(state?.mapTranslateY) ? state.mapTranslateY : 0),
    };
  }

  /** @private */
  _sampleRoute(routeData) {
    const segments = routeData.route?.segments || [];
    const points = [];

    for (const segment of segments) {
      const start = this.nodesById.get(segment.from)?.anchor;
      const end = this.nodesById.get(segment.to)?.anchor;
      const controlPoints = segment.controlPoints || [];
      if (!start || !end || controlPoints.length < 2) continue;

      for (let index = 0; index <= this.sampleSteps; index++) {
        if (points.length > 0 && index === 0) continue;
        points.push(cubicPoint(start, controlPoints[0], controlPoints[1], end, index / this.sampleSteps));
      }
    }

    // 测试数据或未来路线未提供 segments 时，至少能按节点顺序绘制直线降级。
    if (points.length === 0) {
      for (const nodeId of this.routeOrder) {
        const anchor = this.nodesById.get(nodeId)?.anchor;
        if (anchor) points.push({ x: anchor.x, y: anchor.y });
      }
    }

    return points;
  }

  /** @private */
  _rebuildRouteMetrics() {
    this.routeCumulativeLengths = [0];
    this.routeNodeProgress = new Map();
    this.totalRouteLength = 0;

    for (let index = 1; index < this.routePoints.length; index++) {
      this.totalRouteLength += distanceBetween(this.routePoints[index - 1], this.routePoints[index]);
      this.routeCumulativeLengths.push(this.totalRouteLength);
    }

    // 节点序号不能代表真实路程比例：每一段贝塞尔路线长度不同。
    // 取每个节点锚点在采样路线上的精确最近点，得到与路线绘制一致的弧长进度。
    for (const nodeId of this.routeOrder) {
      const anchor = this.nodesById.get(nodeId)?.anchor;
      if (!anchor || this.routePoints.length === 0 || this.totalRouteLength <= 0) continue;

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.routePoints.length; index++) {
        const point = this.routePoints[index];
        const distance = distanceBetween(anchor, point);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      this.routeNodeProgress.set(
        nodeId,
        this.routeCumulativeLengths[nearestIndex] / this.totalRouteLength,
      );
    }
  }

  /** @private */
  _getTargetRouteProgress() {
    if (!this.targetNodeId || this.routeOrder.length < 2) return 0;
    const targetIndex = this.routeOrder.indexOf(this.targetNodeId);
    if (targetIndex < 0) return 0;
    if (this.routeNodeProgress.has(this.targetNodeId)) {
      return this.routeNodeProgress.get(this.targetNodeId);
    }
    return targetIndex / (this.routeOrder.length - 1);
  }

  /** @private */
  _getRoutePoint(progress) {
    if (this.routePoints.length === 0) return { x: GAME.WIDTH / 2, y: GAME.HEIGHT / 2 };
    if (progress <= 0 || this.totalRouteLength <= 0) return this.routePoints[0];
    if (progress >= 1) return this.routePoints[this.routePoints.length - 1];

    const targetLength = this.totalRouteLength * progress;
    for (let index = 1; index < this.routeCumulativeLengths.length; index++) {
      const currentLength = this.routeCumulativeLengths[index];
      if (currentLength < targetLength) continue;

      const previousLength = this.routeCumulativeLengths[index - 1];
      const segmentProgress = (targetLength - previousLength) / Math.max(1, currentLength - previousLength);
      const previousPoint = this.routePoints[index - 1];
      const currentPoint = this.routePoints[index];
      return {
        x: previousPoint.x + ((currentPoint.x - previousPoint.x) * segmentProgress),
        y: previousPoint.y + ((currentPoint.y - previousPoint.y) * segmentProgress),
      };
    }

    return this.routePoints[this.routePoints.length - 1];
  }

  /** @private */
  _selectTip(targetNodeId, cycleOffset = 0) {
    const tips = this.routeData?.tips || [];
    const category = NODE_TIP_CATEGORIES[targetNodeId] || '城市';
    const categoryTips = tips.filter((tip) => tip.category === category);
    if (categoryTips.length === 0) return tips[0] || FALLBACK_TIP;

    const targetIndex = Math.max(0, this.routeOrder.indexOf(targetNodeId)) + cycleOffset;
    return categoryTips[targetIndex % categoryTips.length];
  }

  /** @private */
  /** @private */
  _drawMap(ctx, state) {
    const transform = this._getMapTransform(state);
    const width = GAME.WIDTH * transform.scale;
    const height = GAME.HEIGHT * transform.scale;
    const previousAlpha = ctx.globalAlpha;

    ctx.globalAlpha = previousAlpha * state.mapAlpha;
    if (this.mapImage) {
      ctx.drawImage(this.mapImage, transform.x, transform.y, width, height);
    } else {
      // 素材加载稍慢时仍保持暖色地图底，不让转场闪出黑屏。
      ctx.fillStyle = '#D8B875';
      ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
    }
    ctx.globalAlpha = previousAlpha;
  }

  /** @private */
  _drawMist(ctx, state) {
    const drift = (state.elapsedMs / TIMELINE.durationMs) * GAME.WIDTH;
    const gradient = ctx.createLinearGradient(drift - 260, 0, drift + 260, 0);
    gradient.addColorStop(0, 'rgba(255, 247, 211, 0)');
    gradient.addColorStop(0.5, 'rgba(255, 247, 211, 0.12)');
    gradient.addColorStop(1, 'rgba(255, 247, 211, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /** @private */
  _drawRoute(ctx, progress) {
    if (progress <= 0 || this.routePoints.length < 2) return;

    this._drawProgressPath(ctx, progress, '#9D6944', 10);
    this._drawProgressPath(ctx, progress, '#F7C96B', 6);
  }

  /** @private */
  _drawProgressPath(ctx, progress, color, width) {
    const targetLength = this.totalRouteLength * clamp(progress);
    if (targetLength <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(this.routePoints[0].x, this.routePoints[0].y);

    for (let index = 1; index < this.routePoints.length; index++) {
      const currentLength = this.routeCumulativeLengths[index];
      if (currentLength <= targetLength) {
        ctx.lineTo(this.routePoints[index].x, this.routePoints[index].y);
        continue;
      }

      const previousLength = this.routeCumulativeLengths[index - 1];
      const segmentProgress = (targetLength - previousLength) / Math.max(1, currentLength - previousLength);
      const previousPoint = this.routePoints[index - 1];
      const currentPoint = this.routePoints[index];
      ctx.lineTo(
        previousPoint.x + ((currentPoint.x - previousPoint.x) * segmentProgress),
        previousPoint.y + ((currentPoint.y - previousPoint.y) * segmentProgress),
      );
      break;
    }

    ctx.stroke();
    ctx.restore();
  }

  /** @private */
  _drawNodes(ctx, state) {
    const nodeCount = this.routeOrder.length;
    if (nodeCount === 0) return;

    const routeProgress = state.routeProgress;
    for (let index = 0; index < nodeCount; index++) {
      const nodeId = this.routeOrder[index];
      const node = this.nodesById.get(nodeId);
      if (!node?.anchor) continue;

      const nodeProgress = index / Math.max(1, nodeCount - 1);
      const isReached = nodeProgress <= routeProgress + 0.02;
      const isTarget = nodeId === state.targetNodeId;
      const targetPulse = isTarget ? state.targetHighlight : 0;
      const radius = 7 + (targetPulse * 4);

      ctx.save();
      ctx.globalAlpha *= isReached ? 0.95 : 0.26;
      ctx.fillStyle = node.color || '#F7C96B';
      ctx.shadowColor = isTarget ? '#FFF4C6' : node.color || '#F7C96B';
      ctx.shadowBlur = isTarget ? 20 : 8;
      ctx.beginPath();
      ctx.arc(node.anchor.x, node.anchor.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** @private */
  _drawMarker(ctx, state) {
    if (!state.markerVisible) return;

    const point = this._getRoutePoint(state.markerRouteProgress);
    const bob = Math.sin((state.elapsedMs / 1000) * Math.PI * 2 * 2.2) * 3;
    const markerImage = this.markerImage;
    const size = 64 * state.targetScale;

    ctx.save();
    ctx.translate(point.x, point.y + bob);
    ctx.shadowColor = 'rgba(255, 220, 120, 0.9)';
    ctx.shadowBlur = 20;
    if (markerImage) {
      ctx.drawImage(markerImage, -size / 2, -size / 2, size, size);
    } else {
      this._drawFallbackMarker(ctx, size);
    }
    ctx.restore();
  }

  /** @private */
  _drawProgressRail(ctx, state) {
    const panelWidth = 650;
    const panelHeight = 62;
    const panelX = (GAME.WIDTH - panelWidth) / 2;
    const panelY = 22;
    const trackX = panelX + 116;
    const trackY = panelY + 27;
    const trackWidth = panelWidth - 150;
    const trackHeight = 10;
    const markerImage = this.markerImage;
    const markerSize = 54;
    const markerX = trackX + (trackWidth * state.transitionProgress);

    ctx.save();
    ctx.fillStyle = 'rgba(48, 34, 24, 0.82)';
    ctx.strokeStyle = 'rgba(247, 201, 107, 0.85)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, panelX, panelY, panelWidth, panelHeight, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFF4D6';
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('路线进度', panelX + 20, panelY + 31);

    ctx.fillStyle = 'rgba(255, 244, 214, 0.2)';
    this._roundRect(ctx, trackX, trackY, trackWidth, trackHeight, trackHeight / 2);
    ctx.fill();

    ctx.fillStyle = '#F7C96B';
    this._roundRect(
      ctx,
      trackX,
      trackY,
      Math.max(trackHeight, trackWidth * state.transitionProgress),
      trackHeight,
      trackHeight / 2,
    );
    ctx.fill();

    ctx.save();
    ctx.translate(markerX, trackY + (trackHeight / 2));
    ctx.shadowColor = 'rgba(255, 220, 120, 0.95)';
    ctx.shadowBlur = 18;
    if (markerImage) {
      ctx.drawImage(markerImage, -markerSize / 2, -markerSize / 2, markerSize, markerSize);
    } else {
      this._drawFallbackMarker(ctx, markerSize);
    }
    ctx.restore();
    ctx.restore();
  }

  /** @private */
  _drawFallbackMarker(ctx, size) {
    const half = size / 2;
    ctx.fillStyle = '#D94B3D';
    ctx.strokeStyle = '#F7C96B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(-half * 0.84, half * 0.22);
    ctx.lineTo(-half * 0.82, -half * 0.78);
    ctx.quadraticCurveTo(0, -half, half * 0.82, -half * 0.78);
    ctx.lineTo(half * 0.84, half * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** @private */
  _drawTip(ctx, state) {
    if (!state.tip || state.tipAlpha <= 0) return;

    const width = 600;
    const height = 72;
    const x = (GAME.WIDTH - width) / 2;
    const y = GAME.HEIGHT - 104;

    ctx.save();
    ctx.globalAlpha *= state.tipAlpha;
    ctx.fillStyle = 'rgba(50, 36, 24, 0.9)';
    ctx.strokeStyle = '#F7C96B';
    ctx.lineWidth = 2;
    this._roundRect(ctx, x, y, width, height, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F7C96B';
    this._roundRect(ctx, x + 18, y + 18, 70, 30, 10);
    ctx.fill();

    ctx.fillStyle = '#6B4028';
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.tip.category || 'Tip', x + 53, y + 33);

    ctx.fillStyle = '#FFF4D6';
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(state.tip.text, x + 108, y + 36);
    ctx.restore();
  }

  /** @private */
  _roundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

export { SCENE_TO_NODE, TIMELINE };
