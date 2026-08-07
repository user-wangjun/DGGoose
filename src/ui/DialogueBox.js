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
    // 注入箭头闪烁动画 keyframes（仅注入一次）
    this._injectKeyframes();

    this.element = document.createElement('div');
    this.element.setAttribute('data-dialogue-box', '');
    this.element.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 7000;
      padding: 16px 24px; background: rgba(0,0,0,0.75);
      color: #fff; font-family: inherit; display: none;
      border-top: 2px solid rgba(255,255,255,0.15);
      user-select: none; cursor: pointer; pointer-events: auto;
    `;

    // 说话人名称
    this.nameElement = document.createElement('div');
    this.nameElement.style.cssText = `
      font-size: 14px; color: #fbbf24; margin-bottom: 4px; font-weight: bold;
    `;

    // 对话文本
    this.textElement = document.createElement('div');
    this.textElement.style.cssText = `
      font-size: 18px; line-height: 1.6; min-height: 28px;
    `;

    // 继续提示箭头
    this.arrowElement = document.createElement('div');
    this.arrowElement.style.cssText = `
      position: absolute; right: 24px; bottom: 16px;
      font-size: 20px; color: rgba(255,255,255,0.5);
      animation: dialogue-arrow-blink 1s ease-in-out infinite;
    `;
    this.arrowElement.textContent = '▼';
    this.arrowElement.style.display = 'none';

    this.element.appendChild(this.nameElement);
    this.element.appendChild(this.textElement);
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
    this.leftPortraitEl.style.cssText = `
      position: fixed; left: 5%; bottom: 80px; z-index: 6500;
      width: 200px; height: 300px;
      display: none;
      transition: filter 0.3s ease, opacity 0.3s ease;
      pointer-events: none;
    `;
    this.leftPortraitImg = document.createElement('img');
    this.leftPortraitImg.style.cssText = `
      width: 100%; height: 100%;
      object-fit: contain; object-position: bottom center;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
    `;
    // 设置左侧立绘为莞小鹅
    const gxePortrait = this.portraitMap[GXE_CHARACTER];
    if (gxePortrait) {
      this.leftPortraitImg.src = gxePortrait;
    }
    this.leftPortraitEl.appendChild(this.leftPortraitImg);
    this.container.appendChild(this.leftPortraitEl);

    // 右侧立绘（NPC）
    this.rightPortraitEl = document.createElement('div');
    this.rightPortraitEl.setAttribute('data-portrait-right', '');
    this.rightPortraitEl.style.cssText = `
      position: fixed; right: 5%; bottom: 80px; z-index: 6500;
      width: 200px; height: 300px;
      display: none;
      transition: filter 0.3s ease, opacity 0.3s ease;
      pointer-events: none;
    `;
    this.rightPortraitImg = document.createElement('img');
    this.rightPortraitImg.style.cssText = `
      width: 100%; height: 100%;
      object-fit: contain; object-position: bottom center;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
      transform: scaleX(-1);
    `;
    this.rightPortraitEl.appendChild(this.rightPortraitImg);
    this.container.appendChild(this.rightPortraitEl);
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
    const hasRightPortrait = this.portraitMap[who] && !isNarrator && !isGxeSpeaking;

    // 更新右侧立绘图片（如果当前说话人是新的NPC）
    if (hasRightPortrait && who !== this.currentRightCharacter) {
      this.rightPortraitImg.src = this.portraitMap[who];
      this.currentRightCharacter = who;
    }

    // 右侧立绘显示/隐藏
    if (isNarrator) {
      // 旁白：如果有已出场的NPC则保持显示（暗化），否则隐藏
      if (this.currentRightCharacter) {
        this.rightPortraitEl.style.display = 'block';
      } else {
        this.rightPortraitEl.style.display = 'none';
      }
    } else if (hasRightPortrait || this.currentRightCharacter) {
      // 有NPC立绘（当前说话或记住的上一个）
      this.rightPortraitEl.style.display = 'block';
    } else {
      // 映射表中找不到的角色，右侧隐藏
      this.rightPortraitEl.style.display = 'none';
    }

    // 明暗状态切换
    if (isGxeSpeaking) {
      // 莞小鹅说话：左亮右暗
      this.leftPortraitEl.removeAttribute('data-portrait-dim');
      this.leftPortraitEl.style.filter = 'brightness(1) saturate(1)';
      this.leftPortraitEl.style.opacity = '1';
      if (this.currentRightCharacter) {
        this.rightPortraitEl.setAttribute('data-portrait-dim', '');
        this.rightPortraitEl.style.filter = 'brightness(0.4) saturate(0.5)';
        this.rightPortraitEl.style.opacity = '0.7';
      }
    } else if (isNarrator) {
      // 旁白：左右都暗化
      this.leftPortraitEl.setAttribute('data-portrait-dim', '');
      this.leftPortraitEl.style.filter = 'brightness(0.4) saturate(0.5)';
      this.leftPortraitEl.style.opacity = '0.7';
      if (this.currentRightCharacter) {
        this.rightPortraitEl.setAttribute('data-portrait-dim', '');
        this.rightPortraitEl.style.filter = 'brightness(0.4) saturate(0.5)';
        this.rightPortraitEl.style.opacity = '0.7';
      }
    } else {
      // NPC说话：右亮左暗
      this.leftPortraitEl.setAttribute('data-portrait-dim', '');
      this.leftPortraitEl.style.filter = 'brightness(0.4) saturate(0.5)';
      this.leftPortraitEl.style.opacity = '0.7';
      if (hasRightPortrait) {
        this.rightPortraitEl.removeAttribute('data-portrait-dim');
        this.rightPortraitEl.style.filter = 'brightness(1) saturate(1)';
        this.rightPortraitEl.style.opacity = '1';
      }
    }
  }

  /**
   * 显示对话框并开始对话
   * 对话期间锁定移动输入，防止角色在剧情中移动
   * @param {Array} lines - 对话行数组
   */
  show(lines) {
    this.runner.start(lines);
    this.visible = true;
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
  _render() {
    const current = this.runner.getCurrent();
    if (!current) {
      // 对话结束，隐藏对话框
      this.hide();
      this.eventBus.emit(EVENT.DIALOGUE_NEXT, { finished: true });
      return;
    }

    this.nameElement.textContent = current.who;
    this.textElement.textContent = current.displayedTxt;
    // 每两个新增字符触发一次轻量打字机音效，避免逐字播放造成音频堆积。
    if (
      current.displayedTxt.length > this._lastRenderedTextLength
      && !current.isComplete
      && current.displayedTxt.length % 2 === 0
    ) {
      this.eventBus.emit(EVENT.SFX_PLAY, { name: 'typewriter' });
    }
    this._lastRenderedTextLength = current.displayedTxt.length;
    // 补全后显示继续箭头
    this.arrowElement.style.display = current.isComplete ? 'block' : 'none';
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
   * @private
   */
  _onInteract(action) {
    if (action !== 'interact') return;
    if (!this.visible) return;
    this.runner.advance();
    this._render();
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
    if (document.getElementById('dialogue-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'dialogue-keyframes';
    style.textContent = `
      @keyframes dialogue-arrow-blink {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.8; }
      }
    `;
    document.head.appendChild(style);
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
    if (this.leftPortraitEl && this.leftPortraitEl.parentNode) {
      this.leftPortraitEl.parentNode.removeChild(this.leftPortraitEl);
      this.leftPortraitEl = null;
    }
    if (this.rightPortraitEl && this.rightPortraitEl.parentNode) {
      this.rightPortraitEl.parentNode.removeChild(this.rightPortraitEl);
      this.rightPortraitEl = null;
    }
    this.container = null;
    this.runner = null;
    this.eventBus = null;
    this.input = null;
  }
}
