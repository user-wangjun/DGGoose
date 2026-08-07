import { GAME, CHAPTERS, MAIN_MENU_BACKGROUND_URL, MAIN_MENU_GOOSE_URL } from '../config.js';
import { Button } from '../ui/Button.js';
import { applyButtonStyle } from '../ui/ButtonTheme.js';
import { Overlay } from '../ui/Overlay.js';
import { MenuOverlay } from '../ui/MenuOverlay.js';

/** 版本号显示文本，对应 PRD F1 右下角版本标识 */
const VERSION_TEXT = 'v0.1 BUILD 0807';

/** 加载条动画时长（毫秒），对应 PRD F1 "1.2s 加载条" */
const LOADING_DURATION = 1200;

/** 加载条 keyframes 样式注入标识，避免重复注入 */
const LOADING_STYLE_ID = 'main-menu-loading-keyframes';

/**
 * 主菜单场景（对应 PRD §5 F1）
 *
 * 职责分工：
 * - Canvas 层：绘制主菜单背景样板与标题文字（"鹅厂出逃记"）
 * - DOM 层：叠加 4 个按钮（开始新游戏 / 继续游戏 / 操作说明 / 设置）与版本号
 *
 * 交互流程：
 * - 开始新游戏：有存档→确认覆盖层→加载条→序章；无存档→直接加载条→序章
 * - 继续游戏：读取 slot1 存档，跳转对应章节
 * - 操作说明：弹出 MenuOverlay 展示手机/平板横屏操作指引
 * - 设置：弹出 SettingsPanel（依赖注入）
 */
export class MainMenuScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器，用于切换场景
   * @param {SaveSystem} deps.saveSystem - 存档系统，用于检测与读取存档
   * @param {SettingsPanel} deps.settingsPanel - 设置面板实例，点击设置时弹出
   * @param {AssetLoader} [deps.assetLoader] - 图片资源加载器，用于加载主菜单背景
   * @param {HTMLElement} deps.container - UI 挂载容器（通常为 #ui-root）
   */
  constructor({ sceneManager, saveSystem, settingsPanel, assetLoader, container }) {
    this.sceneManager = sceneManager;
    this.saveSystem = saveSystem;
    this.settingsPanel = settingsPanel;
    this.assetLoader = assetLoader || null;
    this.container = container;

    /** 主菜单 DOM 根容器（按钮组 + 版本号均挂载于此） */
    this.domRoot = null;
    /** 版本号元素引用 */
    this.versionElement = null;
    /** 所有 Button 实例，用于 onExit 统一销毁 */
    this.buttons = [];
    /** 继续游戏按钮引用，便于动态更新文本与禁用态 */
    this.continueButton = null;
    /** 缓存的 slot1 存档数据，避免 onEnter 与点击时重复 load */
    this.cachedSaveData = null;

    /** 当前活动覆盖层（确认 / 加载 / 操作说明），同一时间只允许一个 */
    this.activeOverlay = null;
    /** 加载条定时器 ID，onExit 时需清理以防切换后仍触发 */
    this.loadingTimer = null;
    /** 标记是否已触发场景切换，防止重复调用 sceneManager.change */
    this.transitioning = false;
    /** 已加载的主菜单背景图；加载失败时保留渐变回退 */
    this.backgroundImage = null;
    /** 主菜单背景加载 Promise，避免场景重进时重复发起请求 */
    this.backgroundLoadPromise = null;
    /** 主菜单正面莞小鹅贴图 */
    this.menuGooseImage = null;
    /** 主菜单正面莞小鹅加载 Promise，避免场景重进时重复请求 */
    this.menuGooseLoadPromise = null;
    /** 主菜单环境动效累计时间（秒） */
    this.motionTime = 0;
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：构建 DOM UI 并根据存档状态刷新继续游戏按钮
   * @param {*} [params] - 切换场景时传入的参数（主菜单忽略）
   */
  onEnter(params) {
    this._loadBackground();
    this._loadMenuGoose();
    this._buildDom();
    this._refreshContinueButton();
  }

  /**
   * 每帧更新
   * 主菜单本身无逐帧逻辑，预留扩展点（如背景粒子动画）
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    const safeDelta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    this.motionTime += safeDelta;
  }

  /**
   * 绘制：在 Canvas 上渲染深色渐变背景与标题文字
   * DOM 按钮层叠加在 Canvas 之上，由浏览器自动合成
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawAmbientMotion(ctx);
    this._drawTitle(ctx);
  }

  /**
   * 场景退出：取消定时器、关闭覆盖层、销毁按钮、移除 DOM
   */
  onExit() {
    // 取消未完成的加载定时器，避免切换后仍触发 sceneManager.change
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    // 关闭可能打开的覆盖层（确认 / 加载 / 操作说明）
    this._closeActiveOverlay();
    // 隐藏可能打开的设置面板（设置面板为共享单例，不销毁）
    if (this.settingsPanel) {
      this.settingsPanel.hide();
    }
    // 销毁所有按钮实例，移除事件监听
    this.buttons.forEach((btn) => btn.destroy());
    this.buttons = [];
    this.continueButton = null;
    // 移除主菜单 DOM 根
    if (this.domRoot && this.domRoot.parentNode) {
      this.domRoot.parentNode.removeChild(this.domRoot);
    }
    this.domRoot = null;
    this.versionElement = null;
    this.transitioning = false;
  }

  // ==================== DOM 构建 ====================

  /**
   * 构建主菜单 DOM 结构：按钮组 + 版本号
   * domRoot 设为 pointer-events: none，仅按钮组区域可交互
   * @private
   */
  _buildDom() {
    this.domRoot = document.createElement('div');
    this.domRoot.setAttribute('data-main-menu', '');
    this.domRoot.style.cssText = `
      position: fixed; top: 50%; left: 50%; z-index: 100;
      width: min(100vw, 177.7778vh); height: min(100vh, 56.25vw);
      transform: translate(-50%, -50%);
      pointer-events: none;
      display: flex; flex-direction: column;
      align-items: flex-end; justify-content: flex-end;
      padding: 0 4.5% clamp(44px, 7vh, 58px) 0;
    `;

    // 按钮组容器，开启 pointer-events 以接收点击
    const buttonGroup = document.createElement('div');
    buttonGroup.setAttribute('data-main-menu-buttons', '');
    buttonGroup.style.cssText = `
      display: flex; flex-direction: column; gap: clamp(8px, 2.2vh, 14px);
      align-items: stretch; min-width: clamp(160px, 18vw, 220px);
      pointer-events: auto;
    `;

    // 按显示顺序创建按钮：开始新游戏 / 继续游戏 / 操作说明 / 设置
    const newGameButton = this._createButton('开始新游戏', () => this._onNewGameClick(), 'primary');
    this.continueButton = this._createButton('继续游戏', () => this._onContinueClick(), 'primary');
    const helpButton = this._createButton('操作说明', () => this._onHelpClick(), 'secondary');
    const settingsButton = this._createButton('设置', () => this._onSettingsClick(), 'secondary');

    // 继续游戏按钮初始禁用，_refreshContinueButton 中按存档状态调整
    this.continueButton.setDisabled(true);

    buttonGroup.appendChild(newGameButton.create());
    buttonGroup.appendChild(this.continueButton.create());
    buttonGroup.appendChild(helpButton.create());
    buttonGroup.appendChild(settingsButton.create());

    this.domRoot.appendChild(buttonGroup);
    this.domRoot.appendChild(this._buildVersionLabel());

    this.container.appendChild(this.domRoot);
  }

  /**
   * 创建 Button 实例并登记到 buttons 数组，便于 onExit 统一销毁
   * @param {string} label - 按钮文本
   * @param {Function} onClick - 点击回调
   * @param {string} variant - 样式变体：'primary' | 'secondary'
   * @returns {Button}
   * @private
   */
  _createButton(label, onClick, variant) {
    const button = new Button({
      label,
      onClick,
      disabled: false,
      variant,
      size: variant === 'primary' ? 'lg' : 'md',
      width: 'full',
    });
    this.buttons.push(button);
    return button;
  }

  /**
   * 构建右下角版本号标签
   * @returns {HTMLElement}
   * @private
   */
  _buildVersionLabel() {
    const label = document.createElement('div');
    label.textContent = VERSION_TEXT;
    label.style.cssText = `
      position: absolute; right: 16px; bottom: 10px; z-index: 101;
      font-size: 12px; color: #64748b; font-family: monospace;
      pointer-events: none; user-select: none;
    `;
    return label;
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 异步加载主菜单背景，保留渐变回退以避免资源加载失败时画布变空。
   * @returns {Promise<HTMLImageElement|null>}
   * @private
   */
  _loadBackground() {
    if (this.backgroundLoadPromise) return this.backgroundLoadPromise;

    if (!this.assetLoader) {
      this.backgroundLoadPromise = Promise.resolve(null);
      return this.backgroundLoadPromise;
    }

    this.backgroundLoadPromise = this.assetLoader.loadImage(MAIN_MENU_BACKGROUND_URL)
      .then((image) => {
        this.backgroundImage = image;
        return image;
      })
      .catch((error) => {
        console.warn('[鹅厂出逃记] 主菜单背景加载失败，使用渐变回退:', error);
        return null;
      });

    return this.backgroundLoadPromise;
  }

  /**
   * 加载主菜单专用的正面莞小鹅贴图；失败时只关闭角色表现，不影响菜单可用性。
   * @returns {Promise<HTMLImageElement|null>}
   * @private
   */
  _loadMenuGoose() {
    if (this.menuGooseLoadPromise) return this.menuGooseLoadPromise;

    if (!this.assetLoader) {
      this.menuGooseLoadPromise = Promise.resolve(null);
      return this.menuGooseLoadPromise;
    }

    this.menuGooseLoadPromise = this.assetLoader.loadImage(MAIN_MENU_GOOSE_URL)
      .then((image) => {
        this.menuGooseImage = image;
        return image;
      })
      .catch((error) => {
        console.warn('[鹅厂出逃记] 主菜单正面莞小鹅加载失败，隐藏角色表现:', error);
        return null;
      });

    return this.menuGooseLoadPromise;
  }

  /**
   * 绘制主菜单背景图；图片尚未完成加载或加载失败时使用深色渐变回退。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#16213e');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /**
   * 绘制克制的环境微动：灯光呼吸、光尘漂浮、湖面短促反光，并把莞小鹅放到出发位置。
   * 所有动效都在背景上叠加低透明度图形，不改变原背景构图。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawAmbientMotion(ctx) {
    const pulse = 0.78 + Math.sin(this.motionTime * 1.8) * 0.12;
    this._drawLampGlow(ctx, 507, 334, 62, pulse);
    this._drawLampGlow(ctx, 1236, 318, 48, pulse * 0.82);

    ctx.save();

    // 门外光束中的少量尘埃，速度很慢，避免变成粒子特效层。
    for (let index = 0; index < 8; index += 1) {
      const drift = (this.motionTime * (7 + index * 0.7) + index * 83) % 520;
      const x = 596 + drift;
      const y = 270 + ((this.motionTime * 3 + index * 47) % 190);
      const alpha = 0.07 + (Math.sin(this.motionTime * 1.4 + index) + 1) * 0.035;
      ctx.fillStyle = `rgba(255, 237, 171, ${alpha})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // 湖面只保留几段水平闪光，强化“门外旅途”的呼吸感。
    for (let index = 0; index < 4; index += 1) {
      const shimmer = (this.motionTime * (18 + index * 4) + index * 91) % 340;
      const x = 684 + shimmer;
      const y = 384 + index * 7;
      const alpha = 0.08 + (Math.sin(this.motionTime * 1.7 + index) + 1) * 0.035;
      ctx.fillStyle = `rgba(255, 248, 205, ${alpha})`;
      ctx.fillRect(x, y, 30 + index * 8, 2);
    }

    ctx.restore();
    this._drawGoose(ctx);
  }

  /**
   * 在既有橙色灯具上叠加低强度呼吸光晕。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} intensity
   * @private
   */
  _drawLampGlow(ctx, x, y, radius, intensity) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255, 185, 63, ${0.16 * intensity})`);
    gradient.addColorStop(0.45, `rgba(255, 145, 32, ${0.07 * intensity})`);
    gradient.addColorStop(1, 'rgba(255, 145, 32, 0)');

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 绘制主菜单站位的莞小鹅，使用真实待机序列帧并保持朝向门外。
   * @param {CanvasRenderingContext2D} ctx
   * @returns {boolean} 是否绘制成功
   * @private
   */
  _drawGoose(ctx) {
    if (!this.menuGooseImage) return false;

    const x = GAME.WIDTH * 0.31;
    const y = GAME.HEIGHT * 0.9 + Math.sin(this.motionTime * 2.1) * 1.2;
    const width = 128;
    const height = 230;

    // 轻微接触阴影帮助角色落在工厂地面上，不增加额外 UI 感。
    ctx.save();
    ctx.fillStyle = 'rgba(20, 23, 24, 0.24)';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, width * 0.32, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 小幅左右摆动叠加上下呼吸，形成正面“摇头晃脑”的轻动感。
    const headSway = Math.sin(this.motionTime * 1.8) * 0.045
      + Math.sin(this.motionTime * 3.1) * 0.012;
    const breathing = 1 + Math.sin(this.motionTime * 2.3) * 0.012;
    const sourceWidth = this.menuGooseImage.naturalWidth || this.menuGooseImage.width;
    const sourceHeight = this.menuGooseImage.naturalHeight || this.menuGooseImage.height;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(headSway);
    ctx.scale(breathing, breathing);
    ctx.drawImage(
      this.menuGooseImage,
      0,
      0,
      sourceWidth,
      sourceHeight,
      -width / 2,
      -height,
      width,
      height,
    );
    ctx.restore();
    return true;
  }

  /**
   * 绘制标题文字"鹅厂出逃记"及英文副标题
   * 标题位于左上方的干净墙面区域，为门外道路与右下角按钮留出主视觉空间
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawTitle(ctx) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // 主标题
    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = '#fff1d2';
    ctx.fillText('鹅厂出逃记', GAME.WIDTH * 0.08, GAME.HEIGHT * 0.19);

    // 英文副标题
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#f4c77a';
    ctx.fillText('GOOSE ESCAPE', GAME.WIDTH * 0.08 + 4, GAME.HEIGHT * 0.19 + 56);

    ctx.restore();
  }

  // ==================== 按钮事件处理 ====================

  /**
   * 点击"开始新游戏"：有存档则弹出确认覆盖层，无存档直接进入加载
   * @private
   */
  _onNewGameClick() {
    if (this.transitioning) return;

    // 有存档时需二次确认，避免误覆盖
    if (this.cachedSaveData) {
      this._showConfirmOverlay();
      return;
    }

    this._startLoading();
  }

  /**
   * 点击"继续游戏"：读取缓存存档并跳转对应章节
   * 无存档时按钮为禁用态，不会进入此回调
   * @private
   */
  _onContinueClick() {
    if (this.transitioning) return;
    const saveData = this.cachedSaveData;
    if (!saveData) return;

    this.transitioning = true;
    this.sceneManager.change(saveData.chapter, { saveData });
  }

  /**
   * 点击"操作说明"：弹出 MenuOverlay 展示手机/平板横屏操作指引
   * @private
   */
  _onHelpClick() {
    // 已有覆盖层打开时不重复弹出
    if (this.activeOverlay) return;

    const overlay = new MenuOverlay({
      container: this.container,
      onClose: () => { this.activeOverlay = null; },
    });
    overlay.show();
    this.activeOverlay = overlay;
  }

  /**
   * 点击"设置"：弹出 SettingsPanel
   * SettingsPanel 自管理 Overlay 生命周期，此处仅调用 show
   * @private
   */
  _onSettingsClick() {
    // 已有覆盖层打开时不重复弹出
    if (this.activeOverlay) return;
    this.settingsPanel.show();
  }

  // ==================== 存档检测 ====================

  /**
   * 刷新继续游戏按钮的文本与禁用状态
   * 读取 slot1 存档，有则显示"第X章·章节名 进度%"，无则置灰
   * @private
   */
  _refreshContinueButton() {
    const saveData = this.saveSystem.load('slot1');
    this.cachedSaveData = saveData;

    // 无有效存档，置灰并提示
    if (!saveData) {
      this.continueButton.setDisabled(true);
      this.continueButton.setLabel('继续游戏（无存档）');
      return;
    }

    // 查找章节显示名，找不到时回退显示原始 id 避免空白
    const chapter = CHAPTERS.find((ch) => ch.id === saveData.chapter);
    const displayName = chapter ? chapter.name : saveData.chapter;
    const progress = this.saveSystem.getProgress('slot1');

    this.continueButton.setLabel(`继续游戏  ${displayName} ${progress}%`);
    this.continueButton.setDisabled(false);
  }

  // ==================== 确认覆盖层 ====================

  /**
   * 显示存档覆盖确认覆盖层
   * 提示已有存档信息，提供"确认开始"与"取消"两个操作
   * @private
   */
  _showConfirmOverlay() {
    const content = this._buildConfirmContent();
    const overlay = new Overlay({
      container: this.container,
      dismissible: true,
      onClose: () => { this.activeOverlay = null; },
    });
    overlay.mount(content);
    this.activeOverlay = overlay;
  }

  /**
   * 构建确认覆盖层内容面板
   * @returns {HTMLElement}
   * @private
   */
  _buildConfirmContent() {
    const panel = document.createElement('div');
    panel.setAttribute('data-confirm-overlay', '');
    panel.style.cssText = `
      display: block; width: 400px; max-width: 90vw;
      background: #1e293b; border-radius: 16px; padding: 28px 32px;
      color: #f1f5f9; font-family: inherit; font-size: 15px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4); text-align: center;
    `;

    // 取缓存的存档信息展示，确保与按钮显示一致
    const saveData = this.cachedSaveData;
    const chapter = CHAPTERS.find((ch) => ch.id === saveData.chapter);
    const displayName = chapter ? chapter.name : saveData.chapter;
    const progress = this.saveSystem.getProgress('slot1');

    const title = document.createElement('h3');
    title.textContent = '检测到已有存档';
    title.style.cssText = 'margin: 0 0 12px 0; font-size: 20px;';
    panel.appendChild(title);

    const desc = document.createElement('p');
    desc.textContent = `当前存档：${displayName}（进度 ${progress}%）。开始新游戏将覆盖该存档，确定继续吗？`;
    desc.style.cssText = 'margin: 0 0 20px 0; color: #cbd5e1; line-height: 1.6;';
    panel.appendChild(desc);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 12px; justify-content: center;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    applyButtonStyle(cancelBtn, { variant: 'secondary', size: 'sm' });
    cancelBtn.addEventListener('click', () => this._closeActiveOverlay());
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确认开始';
    applyButtonStyle(confirmBtn, { variant: 'danger', size: 'sm' });
    confirmBtn.addEventListener('click', () => {
      this._closeActiveOverlay();
      this._startLoading();
    });
    actions.appendChild(confirmBtn);

    panel.appendChild(actions);
    return panel;
  }

  // ==================== 加载条 ====================

  /**
   * 显示加载条覆盖层，1.2s 后切换到序章场景
   * 加载期间禁止遮罩点击关闭，确保流程完整
   * @private
   */
  _startLoading() {
    this.transitioning = true;

    const content = this._buildLoadingContent();
    const overlay = new Overlay({
      container: this.container,
      dismissible: false,
      onClose: null,
    });
    overlay.mount(content);
    this.activeOverlay = overlay;

    // 1.2s 后切换到序章；用定时器而非 animationend 以保证可靠性
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      this.sceneManager.change('prologue');
    }, LOADING_DURATION);
  }

  /**
   * 构建加载条内容：提示文字 + 进度条（CSS 动画驱动）
   * @returns {HTMLElement}
   * @private
   */
  _buildLoadingContent() {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-loading-overlay', '');
    wrapper.style.cssText = `
      display: flex; flex-direction: column; align-items: center; gap: 16px;
      padding: 40px 60px;
    `;

    const text = document.createElement('div');
    text.textContent = '正在加载...';
    text.style.cssText = 'color: #f1f5f9; font-size: 18px; font-family: inherit;';
    wrapper.appendChild(text);

    // 进度条轨道
    const track = document.createElement('div');
    track.style.cssText = `
      width: 280px; height: 8px; border-radius: 4px;
      background: rgba(255,255,255,0.15); overflow: hidden;
    `;

    // 进度条填充，通过 CSS animation 在 1.2s 内从 0% 增长到 100%
    const fill = document.createElement('div');
    fill.style.cssText = `
      height: 100%; width: 0%; border-radius: 4px;
      background: linear-gradient(90deg, #bb6b38, #efb45f);
      animation: menu-loading-fill ${LOADING_DURATION}ms linear forwards;
    `;

    // 确保 keyframes 已注入文档（仅注入一次）
    this._ensureLoadingKeyframes();

    track.appendChild(fill);
    wrapper.appendChild(track);
    return wrapper;
  }

  /**
   * 确保加载条动画的 keyframes 样式已注入 document.head
   * 通过 id 检测避免重复注入
   * @private
   */
  _ensureLoadingKeyframes() {
    if (document.getElementById(LOADING_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = LOADING_STYLE_ID;
    style.textContent = `
      @keyframes menu-loading-fill {
        from { width: 0%; }
        to { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  // ==================== 覆盖层管理 ====================

  /**
   * 关闭当前活动覆盖层（确认 / 加载 / 操作说明）
   * 先清空引用再关闭，避免回调中引用已失效的状态
   * @private
   */
  _closeActiveOverlay() {
    if (!this.activeOverlay) return;
    const overlay = this.activeOverlay;
    this.activeOverlay = null;
    // Overlay 和 MenuOverlay 均提供 close 方法
    if (overlay.close) {
      overlay.close();
    }
  }
}
