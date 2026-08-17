import { CHAPTERS } from '../data/chapters.js';
import { applyButtonStyle } from './ButtonTheme.js';

/** 槽位类型显示名映射 */
const SLOT_TYPE_LABELS = {
  auto: '自动存档',
  manual: '手动存档',
};

/**
 * 将时间戳格式化为 MM-DD HH:MM 简短显示
 * @param {number|null} timestamp - 毫秒时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * 根据章节 ID 查找章节显示名
 * @param {string} chapterId - 章节标识
 * @returns {string} 章节名，未找到时返回"未知章节"
 */
function getChapterName(chapterId) {
  const chapter = CHAPTERS.find((ch) => ch.id === chapterId);
  return chapter ? chapter.name : '未知章节';
}

/**
 * 存档面板 UI 组件（对应 PRD §5 F11 存档系统）
 * 渲染3个存档槽位卡片，支持载入/覆盖写入/删除操作，删除需二次确认。
 * 通过注入的 SaveSystem 实例读写存档数据，操作完成后回调通知调用方。
 */
export class SavePanel {
  /**
   * 创建存档面板实例
   * @param {Object} options - 配置项
   * @param {HTMLElement} options.container - 挂载容器
   * @param {SaveSystem} options.saveSystem - 存档系统实例
   * @param {Function} options.onLoad - 载入存档回调，参数为槽位标识和存档数据
   * @param {Function} options.onSave - 覆盖写入回调，参数为槽位标识
   * @param {Function} options.onClose - 关闭面板回调
   */
  constructor({ container, saveSystem, onLoad, onSave, onClose }) {
    this.container = container;
    this.saveSystem = saveSystem;
    this.onLoad = onLoad || null;
    this.onSave = onSave || null;
    this.onClose = onClose || null;
    this.element = null;
    this.slotCards = new Map();
    /** 记录每个槽位是否处于删除确认态，避免误触 */
    this.confirmingDelete = new Set();
  }

  /**
   * 创建面板 DOM 并返回根元素
   * @returns {HTMLElement}
   */
  create() {
    this.element = document.createElement('div');
    this.element.setAttribute('data-save-panel', '');
    this._applyPanelStyles();

    // 标题栏
    const header = this._createHeader();
    this.element.appendChild(header);

    // 槽位列表区域
    const slotList = document.createElement('div');
    slotList.setAttribute('data-slot-list', '');
    slotList.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

    const slots = this.saveSystem.listSlots();
    for (const slotInfo of slots) {
      const card = this._createSlotCard(slotInfo);
      this.slotCards.set(slotInfo.slot, card);
      slotList.appendChild(card);
    }

    this.element.appendChild(slotList);
    return this.element;
  }

  /**
   * 刷新所有槽位卡片的显示状态
   * 在存档写入/删除后调用，保持 UI 与数据同步
   */
  refresh() {
    const slots = this.saveSystem.listSlots();
    for (const slotInfo of slots) {
      const card = this.slotCards.get(slotInfo.slot);
      if (card) {
        this._updateSlotCard(card, slotInfo);
      }
    }
  }

  /**
   * 显示面板（添加到容器）
   */
  show() {
    if (!this.element) {
      this.create();
    }
    if (this.element.parentNode !== this.container) {
      this.container.appendChild(this.element);
    }
    this.refresh();
    this.element.style.display = 'flex';
  }

  /**
   * 隐藏面板（从容器移除）
   */
  hide() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }

  /**
   * 销毁面板，清理引用
   */
  destroy() {
    this.hide();
    this.slotCards.clear();
    this.confirmingDelete.clear();
    this.element = null;
    this.container = null;
    this.saveSystem = null;
    this.onLoad = null;
    this.onSave = null;
    this.onClose = null;
  }

  /**
   * 应用面板整体样式
   * @private
   */
  _applyPanelStyles() {
    this.element.style.cssText = `
      display: flex; flex-direction: column;
      width: 520px; max-height: 85vh; overflow-y: auto;
      background: #1e1b2e; border-radius: 12px; padding: 24px;
      font-family: inherit; color: #e5e7eb;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); pointer-events: auto;
    `;
  }

  /**
   * 创建标题栏（含关闭按钮）
   * @returns {HTMLElement}
   * @private
   */
  _createHeader() {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px;
    `;

    const title = document.createElement('h2');
    title.textContent = '存档管理';
    title.style.cssText = 'margin: 0; font-size: 22px; color: #fff;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'x';
    closeBtn.setAttribute('aria-label', '关闭存档管理');
    closeBtn.style.cssText = 'min-width: 40px; width: 40px; padding: 0; font-size: 20px;';
    applyButtonStyle(closeBtn, { variant: 'ghost', size: 'sm' });
    closeBtn.addEventListener('click', () => {
      if (this.onClose) this.onClose();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    return header;
  }

  /**
   * 创建单个槽位卡片
   * @param {Object} slotInfo - 槽位状态信息
   * @returns {HTMLElement}
   * @private
   */
  _createSlotCard(slotInfo) {
    const card = document.createElement('div');
    card.setAttribute('data-slot-card', slotInfo.slot);
    card.style.cssText = `
      background: #2a2640; border-radius: 8px; padding: 16px;
      border: 1px solid #3d3859; transition: border-color 0.2s;
    `;

    this._updateSlotCard(card, slotInfo);
    return card;
  }

  /**
   * 更新槽位卡片内容（首次创建和刷新时共用）
   * @param {HTMLElement} card - 卡片元素
   * @param {Object} slotInfo - 槽位状态信息
   * @private
   */
  _updateSlotCard(card, slotInfo) {
    // 重置删除确认态
    this.confirmingDelete.delete(slotInfo.slot);
    card.innerHTML = '';

    const progress = this.saveSystem.getProgress(slotInfo.slot);

    // 类型标签行
    const typeLabel = document.createElement('span');
    typeLabel.textContent = SLOT_TYPE_LABELS[slotInfo.type] || '存档';
    typeLabel.style.cssText = `
      display: inline-block; font-size: 12px; padding: 2px 8px;
      border-radius: 4px; margin-bottom: 8px;
      background: ${slotInfo.type === 'auto' ? '#a95f38' : '#3d4d4b'};
      color: #fff;
    `;
    card.appendChild(typeLabel);

    // 章节名
    const chapterName = document.createElement('div');
    chapterName.textContent = slotInfo.hasSave ? getChapterName(slotInfo.chapter) : '空槽位';
    chapterName.style.cssText = 'font-size: 16px; color: #e5e7eb; margin-bottom: 8px;';
    card.appendChild(chapterName);

    // 进度条
    const progressBar = this._createProgressBar(progress);
    card.appendChild(progressBar);

    // 时间戳
    const timestamp = document.createElement('div');
    timestamp.textContent = `存档时间: ${formatTimestamp(slotInfo.timestamp)}`;
    timestamp.style.cssText = 'font-size: 12px; color: #9ca3af; margin: 8px 0 12px;';
    card.appendChild(timestamp);

    // 操作按钮区
    const actions = this._createActions(slotInfo);
    card.appendChild(actions);
  }

  /**
   * 创建进度条
   * @param {number} progress - 0-100 百分比
   * @returns {HTMLElement}
   * @private
   */
  _createProgressBar(progress) {
    const container = document.createElement('div');
    container.style.cssText = `
      width: 100%; height: 8px; background: #1e1b2e;
      border-radius: 4px; overflow: hidden;
    `;

    const fill = document.createElement('div');
    fill.style.cssText = `
      height: 100%; width: ${progress}%;
      background: linear-gradient(90deg, #bb6b38, #efb45f);
      border-radius: 4px; transition: width 0.3s ease;
    `;

    container.appendChild(fill);
    return container;
  }

  /**
   * 创建操作按钮区
   * 载入按钮仅在有存档时可用，覆盖写入仅手动槽位可用，
   * 删除按钮点击后进入二次确认态
   * @param {Object} slotInfo - 槽位状态信息
   * @returns {HTMLElement}
   * @private
   */
  _createActions(slotInfo) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px;';

    // 载入按钮：有存档才可点击
    const loadBtn = this._createButton('从此槽位开始', 'primary', () => {
      if (this.onLoad) this.onLoad(slotInfo.slot);
    }, !slotInfo.hasSave);
    actions.appendChild(loadBtn);

    // 覆盖写入按钮：仅手动槽位可用
    const saveBtn = this._createButton('覆盖写入', 'secondary', () => {
      if (this.onSave) this.onSave(slotInfo.slot);
    }, slotInfo.type === 'auto');
    actions.appendChild(saveBtn);

    // 删除按钮：有存档才显示，点击进入二次确认
    if (slotInfo.hasSave) {
      const deleteBtn = this._createButton('删除存档', 'danger', () => {
        this._enterDeleteConfirm(actions, slotInfo);
      }, false);
      actions.appendChild(deleteBtn);
    }

    return actions;
  }

  /**
   * 进入删除二次确认态
   * 将按钮区替换为"确认删除"和"取消"，防止误删存档
   * @param {HTMLElement} actions - 原按钮区容器
   * @param {Object} slotInfo - 槽位状态信息
   * @private
   */
  _enterDeleteConfirm(actions, slotInfo) {
    this.confirmingDelete.add(slotInfo.slot);
    actions.innerHTML = '';

    const confirmLabel = document.createElement('span');
    confirmLabel.textContent = '确认删除此存档？';
    confirmLabel.style.cssText = 'font-size: 13px; color: #fca5a5; align-self: center;';
    actions.appendChild(confirmLabel);

    const confirmBtn = this._createButton('确认删除', 'danger', () => {
      this.saveSystem.deleteSlot(slotInfo.slot);
      this.refresh();
    }, false);
    actions.appendChild(confirmBtn);

    const cancelBtn = this._createButton('取消', 'secondary', () => {
      this.refresh();
    }, false);
    actions.appendChild(cancelBtn);
  }

  /**
   * 创建通用按钮（内联样式，保持与 Button 组件视觉一致）
   * @param {string} label - 按钮文本
   * @param {string} variant - 样式变体：primary/secondary/danger
   * @param {Function} onClick - 点击回调
   * @param {boolean} disabled - 是否禁用
   * @returns {HTMLButtonElement}
   * @private
   */
  _createButton(label, variant, onClick, disabled) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = disabled;
    applyButtonStyle(btn, { variant, size: 'sm' });

    if (!disabled) {
      btn.addEventListener('click', onClick);
    }
    return btn;
  }
}
