import { GAME } from '../config.js';
import { CHAPTERS } from '../data/chapters.js';
import { ChapterMap } from '../ui/ChapterMap.js';
import { Toast } from '../ui/Toast.js';
import { Button } from '../ui/Button.js';

/**
 * 创建章节选择场景（对应 PRD §5 F4）
 *
 * 场景职责：
 * 1. onEnter 时从 SaveSystem 读取存档，结合 BadgeSystem 推断章节解锁/完成状态
 * 2. Canvas 层绘制渐变背景与流动光效装饰
 * 3. DOM 层渲染 ChapterMap 组件（横向时间轴）与返回按钮
 * 4. onExit 时清理所有 DOM 元素与组件引用
 *
 * 解锁规则：
 * - 序章始终解锁
 * - 完成上一章 → 解锁下一章
 * - 通关后（终章完成）全解锁，支持"重新出发"重玩任意章节
 *
 * @param {Object} deps - 依赖注入
 * @param {SaveSystem} deps.saveSystem - 存档系统，读取存档推断进度
 * @param {BadgeSystem} deps.badgeSystem - 印记系统，查询印记解锁状态
 * @param {SceneManager} deps.sceneManager - 场景管理器，用于切换场景
 * @param {HTMLElement} deps.uiRoot - UI 挂载根容器（#ui-root）
 * @returns {Object} 场景对象，实现 { onEnter, update, draw, onExit } 接口
 */
export function createChapterSelectScene({ saveSystem, badgeSystem, sceneManager, uiRoot }) {
  /** @type {ChapterMap|null} */
  let chapterMap = null;
  /** @type {Toast|null} */
  let toast = null;
  /** @type {Button|null} */
  let backButton = null;
  /** @type {HTMLElement|null} 场景容器，承载所有 DOM 元素便于统一清理 */
  let sceneContainer = null;
  /** 背景动画累计时间，用于绘制流动光效 */
  let bgAnimTime = 0;

  /**
   * 从存档与印记系统推断章节解锁/完成状态及抉择记录
   *
   * 完成判定：优先从 BadgeSystem 查询（印记解锁 = 章节完成），
   * 再从 SaveSystem 各槽位的 badges 字段补充（覆盖 BadgeSystem 未记录的情况）。
   * 解锁判定：序章始终解锁；完成上一章 → 解锁下一章；终章完成 → 全解锁。
   * 抉择记录：从 SaveSystem 各槽位的 choice 字段收集（M5 §5.7）。
   *
   * @returns {{ unlockedChapters: string[], completedChapters: string[], choices: string[] }}
   */
  function determineChapterStates() {
    const completedChapters = [];
    const choices = [];

    // 优先从 BadgeSystem 判断章节完成（印记解锁 = 章节完成）
    for (const chapter of CHAPTERS) {
      if (badgeSystem.isUnlocked(chapter.badge)) {
        completedChapters.push(chapter.id);
      }
    }

    // 补充从 SaveSystem 存档数据中读取（处理 BadgeSystem 未同步的情况）
    const slots = saveSystem.listSlots();
    for (const slot of slots) {
      if (!slot.hasSave) continue;

      const saveData = saveSystem.load(slot.slot);
      if (!saveData || !Array.isArray(saveData.badges)) continue;

      for (const chapter of CHAPTERS) {
        const badgeInSave = saveData.badges.includes(chapter.badge);
        const alreadyRecorded = completedChapters.includes(chapter.id);
        if (badgeInSave && !alreadyRecorded) {
          completedChapters.push(chapter.id);
        }
      }

      // 收集抉择记录（M5 §5.7）：存档中 choice 字段记录了"留下"的场景 id
      if (saveData.choice && !choices.includes(saveData.choice)) {
        choices.push(saveData.choice);
      }
    }

    // 确定已解锁章节：序章始终解锁，其余需上一章完成
    const unlockedChapters = [CHAPTERS[0].id];
    for (let i = 1; i < CHAPTERS.length; i++) {
      if (completedChapters.includes(CHAPTERS[i - 1].id)) {
        unlockedChapters.push(CHAPTERS[i].id);
      }
    }

    // 通关后全解锁（终章完成 → 解锁全部章节，支持"重新出发"）
    const finaleId = CHAPTERS[CHAPTERS.length - 1].id;
    if (completedChapters.includes(finaleId)) {
      for (const chapter of CHAPTERS) {
        if (!unlockedChapters.includes(chapter.id)) {
          unlockedChapters.push(chapter.id);
        }
      }
    }

    return { unlockedChapters, completedChapters, choices };
  }

  /**
   * "进入章节"回调
   * 通过 SceneManager 切换到对应章节场景；场景未注册时给出友好提示
   * @param {string} chapterId - 章节 id，同时作为场景名
   */
  function handleEnterChapter(chapterId) {
    if (sceneManager.has(chapterId)) {
      sceneManager.change(chapterId, { chapterId });
      return;
    }
    // 章节场景尚未实现（M3 阶段），给出友好提示
    toast.show('该章节即将开放，敬请期待');
  }

  /**
   * 绘制流动光点装饰
   * 使用正弦函数生成水平流动的光点，增强时间轴场景的氛围感
   * @param {CanvasRenderingContext2D} ctx
   */
  function drawFlowingLights(ctx) {
    const centerY = GAME.HEIGHT * 0.5;
    const lightCount = 12;

    for (let i = 0; i < lightCount; i++) {
      // 每个光点的水平位置随时间偏移，形成从左到右的流动效果
      const phase = (i / lightCount) * Math.PI * 2;
      const x = ((bgAnimTime * 30 + i * (GAME.WIDTH / lightCount)) % (GAME.WIDTH + 100)) - 50;
      const y = centerY + Math.sin(bgAnimTime * 0.8 + phase) * 120;
      const radius = 2 + Math.sin(bgAnimTime * 1.5 + phase) * 1;
      const alpha = 0.15 + Math.sin(bgAnimTime + phase) * 0.1;

      ctx.fillStyle = `rgba(129, 140, 248, ${Math.max(0, alpha)})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return {
    /**
     * 场景进入：读取存档 → 构建 DOM → 挂载到 uiRoot
     * @param {*} _params - 预留参数，暂未使用
     */
    onEnter(_params) {
      bgAnimTime = 0;

      // 创建场景容器（承载所有 DOM 元素，便于 onExit 统一清理）
      sceneContainer = document.createElement('div');
      sceneContainer.setAttribute('data-chapter-select-scene', '');
      sceneContainer.style.cssText = `
        position: fixed; inset: 0; z-index: 10;
        pointer-events: none;
        display: flex; flex-direction: column;
      `;

      // ---- 顶部栏：标题 + 返回按钮 ----
      const header = document.createElement('div');
      header.style.cssText = `
        pointer-events: auto;
        display: flex; align-items: center; justify-content: space-between;
        padding: 20px 32px;
      `;

      const title = document.createElement('h1');
      title.textContent = '章节选择';
      title.style.cssText = `
        margin: 0; font-size: 28px; color: #f0f0f0;
        font-family: -apple-system, "Microsoft YaHei", sans-serif;
        text-shadow: 0 2px 8px rgba(0,0,0,0.5);
      `;
      header.appendChild(title);

      // 返回按钮：优先使用 SceneManager.back() 回到上一场景
      backButton = new Button({
        label: '返回',
        onClick: () => {
          // 有历史栈时返回上一场景（通常为主菜单）
          if (sceneManager.back()) return;
          // 无历史栈时回退到主菜单（若已注册）
          if (sceneManager.has('mainMenu')) {
            sceneManager.change('mainMenu');
          }
        },
        variant: 'secondary',
      });
      header.appendChild(backButton.create());

      sceneContainer.appendChild(header);

      // ---- 章节地图区域（居中展示，可横向滚动） ----
      const mapWrapper = document.createElement('div');
      mapWrapper.style.cssText = `
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow-x: auto; overflow-y: hidden; padding: 0 16px 32px;
      `;

      // Toast 实例（供 ChapterMap 锁定节点提示使用）
      toast = new Toast({ container: sceneContainer, duration: 2000 });

      // 创建章节地图组件
      chapterMap = new ChapterMap({
        container: mapWrapper,
        badgeSystem,
        toast,
        onEnterChapter: handleEnterChapter,
      });
      chapterMap.create();

      // 从存档推断状态并应用到地图（含抉择记录，M5 §5.7）
      const { unlockedChapters, completedChapters, choices } = determineChapterStates();
      chapterMap.setState(unlockedChapters, completedChapters, choices);

      sceneContainer.appendChild(mapWrapper);

      // 挂载到 UI 根容器
      uiRoot.appendChild(sceneContainer);
    },

    /**
     * 每帧更新：累加背景动画时间
     * @param {number} dt - 帧间隔（秒）
     */
    update(dt) {
      bgAnimTime += dt;
    },

    /**
     * Canvas 层绘制：渐变背景 + 流动光效装饰
     * @param {CanvasRenderingContext2D} ctx
     */
    draw(ctx) {
      // ctx 可能为 null（纯逻辑测试），场景自行判断是否绘制
      if (!ctx) return;

      // 深色渐变背景，营造时间轴场景氛围
      const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(0.5, '#1e1b2e');
      gradient.addColorStop(1, '#0f172a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 流动光效装饰
      drawFlowingLights(ctx);
    },

    /**
     * 场景退出：清理所有 DOM 元素与组件引用
     * 销毁顺序：子组件 → Toast → 按钮 → 容器
     */
    onExit() {
      if (chapterMap) {
        chapterMap.destroy();
        chapterMap = null;
      }
      if (backButton) {
        backButton.destroy();
        backButton = null;
      }
      if (toast) {
        toast.destroy();
        toast = null;
      }
      if (sceneContainer && sceneContainer.parentNode) {
        sceneContainer.parentNode.removeChild(sceneContainer);
      }
      sceneContainer = null;
    },
  };
}
