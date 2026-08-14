import { EVENT } from '../config.js';

/**
 * 对话框 UI 组件（对应 PRD §5 F3 + Task 2.2）
 * 底部半透明对话框，展示说话人名称、逐字文本与继续提示箭头。
 * 支持左右双立绘显示，说话方高亮、非说话方暗化（视觉小说风格）。
 * 点击/空格推进对话；长按跳过整段；表情标签通过 EventBus 触发角色帧切换。
 * 对话期间锁定移动输入，防止角色在剧情中乱跑。
 */

/** 长按判定时长（毫秒）：持续按住超过此值触发跳过 */
const LONG_PRESS_DURATION = 600;

/** 首次跳过确认提示文本 */
const SKIP_CONFIRM_TEXT = '再次长按确认跳过全部对话';

/** 莞小鹅角色名（左侧立绘固定角色） */
const GXE_CHARACTER = '莞小鹅';

/** 旁白角色名（旁白时右侧立绘隐藏） */
const NARRATOR_CHARACTER = '旁白';

/** 系统提示使用独立纸签样式，并隐藏所有角色立绘。 */
const SYSTEM_CHARACTERS = new Set(['系统', '提示']);

export class DialogueBox {
  /**
   * @param {Object} deps - 依赖注入
   * @param {HTMLElement} deps.container - 挂载容器（通常为 #ui-root）
   * @param {DialogueRunner} deps.runner - 对话运行器实例
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {InputManager} deps.input - 输入管理器（用于锁定移动与空格推进）
   * @param {Object<string, string>} [deps.portraitMap] - 立绘资源映射表 { 角色名: 图片路径 }
   */
  constructor({ container, runner, eventBus, input, portraitMap }) {
    this.container = container;
    this.runner = runner;
    this.eventBus = eventBus;
    this.input = input;
    this.portraitMap = portraitMap || null;
    this.element = null;
    this.contentElement = null;
    this.nameElement = null;
    this.textElement = null;
    this.arrowElement = null;
    // 立绘相关
    this.leftPortraitEl = null;
    this.rightPortraitEl = null;
    this.leftPortraitImg = null;
    this.rightPortraitImg = null;
    /** 当前右侧显示的NPC角色名（用于记住上一个NPC） */
    this.currentRightCharacter = null;
    this.visible = false;
    this._inputLocked = false;
    this._longPressTimer = null;
    this._skipConfirmShown = false;
    /** 上一帧已渲染的文字长度，用于节流打字机音效 */
    this._lastRenderedTextLength = 0;
    this._onInteract = this._onInteract.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._tagHandler = null;
  }

  /**
   * 创建 DOM 元素并挂载事件监听
   */
  mount() {
    // 注入正式纸张边框、响应式布局与箭头动画（仅注入一次）
    this._injectKeyframes();

    this.element = document.createElement('div');
    this.element.setAttribute('data-dialogue-box', '');
    this.element.setAttribute('data-dialogue-mode', 'character');
    this.element.setAttribute('data-dialogue-speaker', '');
    this.element.style.cssText = `
      position: fixed; left: clamp(8px, 2.2vw, 32px); right: clamp(8px, 2.2vw, 32px);
      bottom: max(10px, env(safe-area-inset-bottom, 0px)); z-index: 7000;
      height: clamp(164px, 26vh, 232px); max-height: calc(100vh - 20px);
      padding: clamp(13px, 1.9vw, 26px) clamp(18px, 4.2vw, 56px) clamp(14px, 1.8vw, 24px);
      box-sizing: border-box; overflow: visible; isolation: isolate;
      background:
        radial-gradient(circle at 16% 8%, rgba(255, 255, 255, 0.76), transparent 27%),
        repeating-linear-gradient(7deg, rgba(128, 77, 38, 0.045) 0 1px, transparent 1px 7px),
        linear-gradient(145deg, #fff3d5 0%, #f9dfb1 54%, #f1c98f 100%);
      color: #4a2a1b; font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
      display: none; border: 3px solid #6d4127; border-radius: 22px 22px 18px 18px;
      box-shadow:
        0 0 0 2px rgba(255, 232, 170, 0.72),
        0 13px 0 rgba(89, 48, 27, 0.2),
        0 20px 34px rgba(48, 25, 13, 0.34),
        inset 0 1px 0 rgba(255, 255, 255, 0.82);
      user-select: none; cursor: pointer; pointer-events: auto; touch-action: manipulation;
    `;

    this.contentElement = document.createElement('div');
    this.contentElement.setAttribute('data-dialogue-content', '');
    this.contentElement.style.cssText = `
      position: relative; z-index: 2; display: flex; flex-direction: column;
      align-items: flex-start; width: 100%; height: 100%; min-height: 0;
    `;

    // 说话人名称
    this.nameElement = document.createElement('div');
    this.nameElement.setAttribute('data-dialogue-name', '');
    this.nameElement.style.cssText = `
      flex: 0 0 auto; max-width: min(100%, 72vw); margin: 0 0 8px;
      padding: clamp(5px, 0.7vw, 9px) clamp(14px, 1.4vw, 22px);
      box-sizing: border-box; border: 2px solid #6d4127;
      border-radius: 11px 13px 13px 4px;
      background: linear-gradient(135deg, #9d3f35 0%, #bd5540 62%, #d87b4b 100%);
      color: #fff4d5; font-size: clamp(13px, 1.45vw, 19px); line-height: 1.12;
      font-weight: 800; letter-spacing: 0.08em; text-shadow: 0 1px 1px rgba(81, 35, 20, 0.65);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      box-shadow: 3px 4px 0 rgba(98, 48, 27, 0.18), inset 0 1px 0 rgba(255, 244, 214, 0.5);
    `;

    // 对话文本
    this.textElement = document.createElement('div');
    this.textElement.setAttribute('data-dialogue-text', '');
    this.textElement.style.cssText = `
      flex: 1 1 auto; width: 100%; min-height: 0; max-width: min(100%, 1120px);
      box-sizing: border-box; padding: 2px clamp(34px, 4vw, 64px) 2px 4px;
      color: #4a2a1b; font-size: clamp(15px, 1.7vw, 23px); line-height: 1.58;
      letter-spacing: 0.035em; white-space: pre-wrap; overflow-wrap: anywhere;
      word-break: break-word; overflow-x: hidden; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(139, 81, 42, 0.6) transparent;
    `;

    // 继续提示箭头
    this.arrowElement = document.createElement('div');
    this.arrowElement.setAttribute('data-dialogue-arrow', '');
    this.arrowElement.setAttribute('aria-label', '点击继续');
    this.arrowElement.style.cssText = `
      position: absolute; right: clamp(13px, 2vw, 28px); bottom: clamp(11px, 1.6vw, 22px);
      z-index: 4; width: clamp(27px, 3vw, 40px); height: clamp(27px, 3vw, 40px);
      display: none; align-items: center; justify-content: center;
      box-sizing: border-box; border: 2px solid #a86c28; border-radius: 50%;
      background: rgba(255, 241, 190, 0.72); color: #a86c28;
      font-family: Georgia, serif; font-size: clamp(18px, 2vw, 27px); font-weight: 900;
      line-height: 1; text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
      animation: dialogue-arrow-pulse 1.15s ease-in-out infinite;
      pointer-events: none;
    `;
    this.arrowElement.textContent = '⌄';

    this.contentElement.appendChild(this.nameElement);
    this.contentElement.appendChild(this.textElement);
    this.element.appendChild(this.contentElement);
    this.element.appendChild(this.arrowElement);
    this.container.appendChild(this.element);

    // 如果配置了立绘映射表，创建左右立绘
    if (this.portraitMap) {
      this._createPortraits();
    }

    // 点击与长按事件
    this.element.addEventListener('click', this._onClick);
    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointerleave', this._onPointerLeave);

    // 监听输入管理器的 interact 动作（空格键）
    if (this.input) {
      this.input.onAction(this._onInteract);
    }

    // 监听标签事件，转发供外部切角色帧
    this._tagHandler = (data) => {
      this.eventBus.emit('dialogue:tag:ui', data);
    };
    this.eventBus.on(EVENT.DIALOGUE_TAG, this._tagHandler);
  }

  /**
   * 创建左右立绘容器
   * 左侧固定为莞小鹅，右侧为当前NPC说话人
   * @private
   */
  _createPortraits() {
    // 左侧立绘（莞小鹅）
    this.leftPortraitEl = document.createElement('div');
    this.leftPortraitEl.setAttribute('data-portrait-left', '');
    this.leftPortraitEl.setAttribute('data-portrait-state', 'hidden');
    this.leftPortraitEl.style.cssText = `
      position: absolute; left: clamp(12px, 2.4vw, 40px); bottom: calc(100% - 6px);
      z-index: 3; width: clamp(104px, 16vw, 210px); height: clamp(128px, 28vh, 280px);
      display: none; transition: filter 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
    `;
    // 设置左侧立绘为莞小鹅
    const gxePortrait = this.portraitMap[GXE_CHARACTER];
    if (gxePortrait) {
      this.leftPortraitImg = document.createElement('img');
      this.leftPortraitImg.alt = GXE_CHARACTER;
      this.leftPortraitImg.draggable = false;
      this.leftPortraitImg.decoding = 'async';
      this.leftPortraitImg.style.cssText = `
        display: block; width: 100%; height: 100%; object-fit: contain;
        object-position: bottom center; filter: drop-shadow(0 5px 7px rgba(76, 38, 19, 0.3));
      `;
      this.leftPortraitImg.src = gxePortrait;
      this.leftPortraitEl.appendChild(this.leftPortraitImg);
    } else {
      // 没有莞小鹅头像时直接隐藏该侧，不创建可见的空头像框。
      this.leftPortraitEl.setAttribute('data-portrait-empty', 'true');
    }
    this.element.appendChild(this.leftPortraitEl);

    // 右侧立绘（NPC）
    this.rightPortraitEl = document.createElement('div');
    this.rightPortraitEl.setAttribute('data-portrait-right', '');
    this.rightPortraitEl.setAttribute('data-portrait-state', 'hidden');
    this.rightPortraitEl.style.cssText = `
      position: absolute; right: clamp(12px, 2.4vw, 40px); bottom: calc(100% - 6px);
      z-index: 3; width: clamp(104px, 16vw, 210px); height: clamp(128px, 28vh, 280px);
      display: none; transition: filter 0.3s ease, opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
    `;
    this.rightPortraitImg = document.createElement('img');
    this.rightPortraitImg.alt = '当前对话角色';
    this.rightPortraitImg.draggable = false;
    this.rightPortraitImg.decoding = 'async';
    this.rightPortraitImg.style.cssText = `
      display: block; width: 100%; height: 100%; object-fit: contain;
      object-position: bottom center; filter: drop-shadow(0 5px 7px rgba(76, 38, 19, 0.3));
      /*
       * NPC 对话立绘均按正面/三分之四参考图生成。
       * 不做水平翻转，避免 DGUT 校徽和穿着者左右胸位被镜像。
       */
      transform: none;
    `;
    this.rightPortraitEl.appendChild(this.rightPortraitImg);
    this.element.appendChild(this.rightPortraitEl);
  }

  /**
   * 更新立绘的显示状态（明暗+右侧立绘图片）
   * @param {string} who - 当前说话人
   * @private
   */
  _updatePortraits(who) {
    if (!this.portraitMap || !this.leftPortraitEl) return;

    const isGxeSpeaking = who === GXE_CHARACTER;
    const isNarrator = who === NARRATOR_CHARACTER;
    const isSystem = SYSTEM_CHARACTERS.has(who);
    const portraitUrl = this.portraitMap[who];
    const hasRightPortrait = Boolean(portraitUrl && !isNarrator && !isSystem && !isGxeSpeaking);

    // 更新右侧立绘图片（如果当前说话人是新的NPC）
    if (hasRightPortrait && who !== this.currentRightCharacter) {
      this.rightPortraitImg.src = portraitUrl;
      this.rightPortraitImg.alt = who;
      this.currentRightCharacter = who;
      this.rightPortraitEl.removeAttribute('data-portrait-empty');
    }

    const hasStoredPortrait = Boolean(
      this.currentRightCharacter
      && this.rightPortraitImg.getAttribute('src')
      && this.portraitMap[this.currentRightCharacter],
    );

    // 旁白和系统提示不借用上一位 NPC 的头像；未知角色也安全隐藏右侧。
    const shouldShowRight = hasRightPortrait || (isGxeSpeaking && hasStoredPortrait);
    this.rightPortraitEl.style.display = shouldShowRight ? 'block' : 'none';
    if (!shouldShowRight) {
      this.rightPortraitEl.setAttribute('data-portrait-state', 'hidden');
    }

    // 系统提示没有角色立绘；旁白保留莞小鹅作为低亮度的叙事锚点。
    const shouldShowLeft = Boolean(this.leftPortraitImg) && !isSystem;
    this.leftPortraitEl.style.display = shouldShowLeft ? 'block' : 'none';

    // 明暗状态切换
    if (isGxeSpeaking) {
      // 莞小鹅说话：左亮右暗
      this._setPortraitState(this.leftPortraitEl, 'active');
      if (hasStoredPortrait) this._setPortraitState(this.rightPortraitEl, 'dim');
    } else if (isNarrator) {
      // 旁白：只保留低亮度的莞小鹅，右侧不出现上一位 NPC 的旧头像。
      this._setPortraitState(this.leftPortraitEl, 'dim');
      this._setPortraitState(this.rightPortraitEl, 'hidden');
    } else if (isSystem) {
      this._setPortraitState(this.leftPortraitEl, 'hidden');
      this._setPortraitState(this.rightPortraitEl, 'hidden');
    } else {
      // NPC说话：右亮左暗
      this._setPortraitState(this.leftPortraitEl, 'dim');
      if (hasRightPortrait) {
        this._setPortraitState(this.rightPortraitEl, 'active');
      } else {
        this._setPortraitState(this.rightPortraitEl, 'hidden');
      }
    }
  }

  /** 设置立绘的可读状态，同时保留旧测试使用的 data-portrait-dim 契约。 */
  _setPortraitState(element, state) {
    if (!element) return;
    element.setAttribute('data-portrait-state', state);
    if (state === 'active') {
      element.removeAttribute('data-portrait-dim');
      element.style.filter = 'brightness(1) saturate(1)';
      element.style.opacity = '1';
      element.style.transform = 'translateY(-2px) scale(1.02)';
      return;
    }
    if (state === 'dim') {
      element.setAttribute('data-portrait-dim', '');
      element.style.filter = 'brightness(0.48) saturate(0.58)';
      element.style.opacity = '0.72';
      element.style.transform = 'translateY(0) scale(0.98)';
      return;
    }
    element.removeAttribute('data-portrait-dim');
    element.style.filter = 'none';
    element.style.opacity = '0';
    element.style.transform = 'translateY(4px) scale(0.96)';
  }

  /**
   * 显示对话框并开始对话
   * 对话期间锁定移动输入，防止角色在剧情中移动
   * @param {Array} lines - 对话行数组
   */
  show(lines) {
    this.runner.start(lines);
    this.visible = true;
    this.currentRightCharacter = null;
    if (this.rightPortraitImg) {
      this.rightPortraitImg.removeAttribute('src');
      this.rightPortraitEl?.setAttribute('data-portrait-empty', 'true');
    }
    this._skipConfirmShown = false;
    this._lastRenderedTextLength = 0;
    this.element.style.display = 'block';
    // 显示左侧立绘
    if (this.leftPortraitEl) {
      this.leftPortraitEl.style.display = 'block';
    }
    // 立即渲染一次，更新立绘状态和文本
    this._render();
    this._lockInput();
  }

  /** 返回对话框显示状态与逐字游标，供场景离开前写入自动存档。 */
  getSaveState() {
    return {
      visible: this.visible,
      runner: this.runner.getSaveState(),
      currentRightCharacter: this.currentRightCharacter,
    };
  }

  /**
   * 恢复对话框，不重新 start 对话，也不发出 DIALOGUE_NEXT，避免继续游戏时
   * 把尚未读完的剧情误判成已完成。
   * @param {Object} state - getSaveState 返回的状态
   */
  restoreSaveState(state) {
    if (!state?.visible) {
      this.hide();
      return;
    }

    this.runner.restoreSaveState(state.runner);
    const current = this.runner.getCurrent();
    if (!current) {
      this.hide();
      return;
    }

    this.visible = true;
    this.currentRightCharacter = state.currentRightCharacter || null;
    if (this.rightPortraitImg && this.currentRightCharacter && this.portraitMap?.[this.currentRightCharacter]) {
      this.rightPortraitImg.src = this.portraitMap[this.currentRightCharacter];
      this.rightPortraitImg.alt = this.currentRightCharacter;
      this.rightPortraitEl?.removeAttribute('data-portrait-empty');
    }
    this._skipConfirmShown = false;
    this._lastRenderedTextLength = current.displayedTxt.length;
    if (this.element) this.element.style.display = 'block';
    this._render({ emitCompletion: false, emitTypewriter: false });
    this._lockInput();
  }

  /**
   * 隐藏对话框并解锁移动输入
   */
  hide() {
    this.visible = false;
    this.element.style.display = 'none';
    // 隐藏立绘
    if (this.leftPortraitEl) {
      this.leftPortraitEl.style.display = 'none';
    }
    if (this.rightPortraitEl) {
      this.rightPortraitEl.style.display = 'none';
    }
    if (this.element) {
      this.element.setAttribute('data-dialogue-mode', 'hidden');
      this.element.setAttribute('data-dialogue-speaker', '');
    }
    this.currentRightCharacter = null;
    this._skipConfirmShown = false;
    this._lastRenderedTextLength = 0;
    this._cancelLongPress();
    this._unlockInput();
    this.runner.reset();
  }

  /**
   * 每帧更新：推进逐字显示、刷新 UI
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    if (!this.visible) return;

    this.runner.update(deltaTime);
    this._render();
  }

  /**
   * 渲染当前对话状态到 DOM
   * @private
   */
  _render({ emitCompletion = true, emitTypewriter = true } = {}) {
    const current = this.runner.getCurrent();
    if (!current) {
      // 对话结束，隐藏对话框
      this.hide();
      if (emitCompletion) {
        this.eventBus.emit(EVENT.DIALOGUE_NEXT, { finished: true });
      }
      return;
    }

    this.nameElement.textContent = current.who;
    this.textElement.textContent = current.displayedTxt;
    this._setDialogueMode(current.who);
    // 每两个新增字符触发一次轻量打字机音效，避免逐字播放造成音频堆积。
    if (emitTypewriter &&
      current.displayedTxt.length > this._lastRenderedTextLength
      && !current.isComplete
      && current.displayedTxt.length % 2 === 0
    ) {
      this.eventBus.emit(EVENT.SFX_PLAY, { name: 'typewriter' });
    }
    this._lastRenderedTextLength = current.displayedTxt.length;
    // 补全后显示继续箭头
    this.arrowElement.style.display = current.isComplete ? 'flex' : 'none';
    // 更新立绘状态
    this._updatePortraits(current.who);
  }

  /**
   * 点击推进对话
   * @private
   */
  _onClick() {
    if (!this.visible) return;
    // 如果正在显示跳过确认，点击则取消确认
    if (this._skipConfirmShown) {
      this._skipConfirmShown = false;
      return;
    }
    this.runner.advance();
    this._render();
  }

  /**
   * 空格键推进对话
   * @param {string} action - 动作名
   * @returns {boolean|undefined} 对话可见时消费 interact，阻止同一按键触发场景动作
   * @private
   */
  _onInteract(action) {
    if (action !== 'interact') return;
    if (!this.visible) return;
    this.runner.advance();
    this._render();
    return true;
  }

  /**
   * 长按检测开始
   * @private
   */
  _onPointerDown() {
    if (!this.visible) return;
    this._cancelLongPress();
    this._longPressTimer = setTimeout(() => {
      this._handleLongPress();
    }, LONG_PRESS_DURATION);
  }

  /**
   * 指针释放时取消长按计时
   * @private
   */
  _onPointerUp() {
    this._cancelLongPress();
  }

  /**
   * 指针离开时取消长按计时
   * @private
   */
  _onPointerLeave() {
    this._cancelLongPress();
  }

  /**
   * 处理长按触发：首次显示确认提示，二次确认后跳过全部
   * @private
   */
  _handleLongPress() {
    if (!this._skipConfirmShown) {
      // 首次长按：显示确认提示
      this._skipConfirmShown = true;
      this.nameElement.textContent = '提示';
      this.textElement.textContent = SKIP_CONFIRM_TEXT;
      this._setDialogueMode('提示');
      this._updatePortraits('提示');
      this.arrowElement.style.display = 'none';
      return;
    }

    // 二次确认：跳过全部对话
    this.runner.skipAll();
    this.eventBus.emit(EVENT.DIALOGUE_SKIP, { skipped: true });
    this.hide();
    this.eventBus.emit(EVENT.DIALOGUE_NEXT, { finished: true });
  }

  /**
   * 取消长按计时器
   * @private
   */
  _cancelLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  /**
   * 锁定移动输入
   * 通过设置 InputManager 的摇杆向量为零并标记锁定状态
   * @private
   */
  _lockInput() {
    if (!this.input || this._inputLocked) return;
    this._inputLocked = true;
    // 清零摇杆向量，防止对话开始时角色继续移动
    if (this.input.setJoystickVector) {
      this.input.setJoystickVector(0, 0);
    }
  }

  /**
   * 解锁移动输入
   * @private
   */
  _unlockInput() {
    this._inputLocked = false;
  }

  /**
   * 注入箭头闪烁动画 keyframes（全局注入一次）
   * @private
   */
  _injectKeyframes() {
    if (document.getElementById('dialogue-formal-styles')) return;
    const style = document.createElement('style');
    style.id = 'dialogue-formal-styles';
    style.textContent = `
      [data-dialogue-box]::before {
        content: ""; position: absolute; inset: 7px; z-index: 0;
        border: 1px solid rgba(112, 63, 35, 0.42); border-radius: 15px 15px 12px 12px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.66);
        pointer-events: none;
      }
      [data-dialogue-box]::after {
        content: ""; position: absolute; left: clamp(28px, 5vw, 78px); top: -9px;
        width: clamp(82px, 10vw, 132px); height: 15px; z-index: 4;
        border: 2px solid #8c562c; border-radius: 5px;
        background: linear-gradient(90deg, rgba(255, 238, 181, 0.9), rgba(249, 203, 112, 0.86));
        box-shadow: 2px 2px 0 rgba(103, 52, 26, 0.18); transform: rotate(-1.6deg);
        pointer-events: none;
      }
      [data-dialogue-box][data-dialogue-mode="narrator"] {
        background:
          repeating-linear-gradient(7deg, rgba(128, 77, 38, 0.04) 0 1px, transparent 1px 7px),
          linear-gradient(145deg, #f8f0dd 0%, #ead9b7 100%);
      }
      [data-dialogue-box][data-dialogue-mode="narrator"] [data-dialogue-name] {
        border-color: #8d7047; background: linear-gradient(135deg, #806b4f, #a58b61);
        color: #fff8e7;
      }
      [data-dialogue-box][data-dialogue-mode="system"] {
        background:
          repeating-linear-gradient(-8deg, rgba(125, 91, 59, 0.035) 0 1px, transparent 1px 7px),
          linear-gradient(145deg, #f5ead2 0%, #e8ceb0 100%);
      }
      [data-dialogue-box][data-dialogue-mode="system"] [data-dialogue-name] {
        border-color: #806248; background: linear-gradient(135deg, #6d5d4b, #95816a);
      }
      [data-dialogue-box][data-dialogue-mode="narrator"] [data-dialogue-text],
      [data-dialogue-box][data-dialogue-mode="system"] [data-dialogue-text] {
        color: #5b4534;
      }
      [data-dialogue-box] [data-dialogue-text]::-webkit-scrollbar { width: 7px; }
      [data-dialogue-box] [data-dialogue-text]::-webkit-scrollbar-thumb {
        border-radius: 999px; background: rgba(139, 81, 42, 0.48);
      }
      [data-dialogue-box] [data-dialogue-arrow] { transform-origin: 50% 55%; }
      [data-dialogue-box] [data-portrait-state="active"] { filter: brightness(1) saturate(1); }
      [data-dialogue-box] [data-portrait-state="dim"] { filter: brightness(0.48) saturate(0.58); }
      @keyframes dialogue-arrow-pulse {
        0%, 100% { opacity: 0.62; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(4px); }
      }
      @media (max-height: 460px) and (orientation: landscape) {
        [data-dialogue-box] {
          height: clamp(142px, 38vh, 176px) !important;
          padding: 11px 18px 13px !important;
          border-radius: 18px 18px 15px 15px !important;
        }
        [data-dialogue-box]::before { inset: 5px; border-radius: 12px; }
        [data-dialogue-box]::after { top: -7px; height: 12px; }
        [data-dialogue-box] [data-dialogue-name] {
          margin-bottom: 5px !important; padding: 4px 11px !important;
          font-size: clamp(12px, 1.8vw, 16px) !important;
        }
        [data-dialogue-box] [data-dialogue-text] {
          padding-right: 34px !important; font-size: clamp(13px, 2.35vw, 18px) !important;
          line-height: 1.45 !important;
        }
        [data-dialogue-box] [data-portrait-left],
        [data-dialogue-box] [data-portrait-right] {
          width: clamp(96px, 15vw, 145px) !important;
          height: clamp(116px, 31vh, 148px) !important;
          bottom: calc(100% - 5px) !important;
        }
        [data-dialogue-box] [data-dialogue-arrow] {
          right: 12px !important; bottom: 10px !important; width: 27px !important;
          height: 27px !important; font-size: 19px !important;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-dialogue-box] [data-dialogue-arrow] { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  /** 将说话方映射为 CSS 模式，确保角色对白、旁白和提示有清晰区分。 */
  _setDialogueMode(who) {
    if (!this.element) return;
    let mode = 'unknown';
    if (who === GXE_CHARACTER) mode = 'gxe';
    else if (who === NARRATOR_CHARACTER) mode = 'narrator';
    else if (SYSTEM_CHARACTERS.has(who)) mode = 'system';
    else if (this.portraitMap?.[who]) mode = 'npc';
    this.element.setAttribute('data-dialogue-mode', mode);
    this.element.setAttribute('data-dialogue-speaker', who || '');
  }

  /**
   * 销毁组件，清理资源
   */
  destroy() {
    this._cancelLongPress();
    if (this.input) {
      this.input.offAction(this._onInteract);
    }
    if (this._tagHandler && this.eventBus) {
      this.eventBus.off(EVENT.DIALOGUE_TAG, this._tagHandler);
      this._tagHandler = null;
    }
    if (this.element) {
      this.element.removeEventListener('click', this._onClick);
      this.element.removeEventListener('pointerdown', this._onPointerDown);
      this.element.removeEventListener('pointerup', this._onPointerUp);
      this.element.removeEventListener('pointerleave', this._onPointerLeave);
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    }
    // 清理立绘元素
    if (this.leftPortraitEl) {
      if (this.leftPortraitEl.parentNode) {
        this.leftPortraitEl.parentNode.removeChild(this.leftPortraitEl);
      }
      this.leftPortraitEl = null;
    }
    if (this.rightPortraitEl) {
      if (this.rightPortraitEl.parentNode) {
        this.rightPortraitEl.parentNode.removeChild(this.rightPortraitEl);
      }
      this.rightPortraitEl = null;
    }
    this.leftPortraitImg = null;
    this.rightPortraitImg = null;
    this.container = null;
    this.runner = null;
    this.eventBus = null;
    this.input = null;
    this.contentElement = null;
    this.nameElement = null;
    this.textElement = null;
    this.arrowElement = null;
  }
}
