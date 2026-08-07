const WIDTH = 1280;
const HEIGHT = 720;
const FLOOR = { left: 48, top: 92, right: 1232, bottom: 674 };
const PLAYER_SPEED = 235;

const canvas = document.querySelector('#sceneCanvas');
const ctx = canvas.getContext('2d');
const statusValue = document.querySelector('#statusValue');
const toast = document.querySelector('#toast');
const dialogueCard = document.querySelector('#dialogueCard');
const demoButton = document.querySelector('#demoButton');
const closeDialogue = document.querySelector('#closeDialogue');

const gooseImage = new Image();
// 预览页支持直接从文件系统打开，因此资源路径相对 HTML 文件而不是依赖 import.meta.url。
gooseImage.src = 'assets/characters/gxe/gxe_idle_sheet.png';

const state = {
  time: 0,
  lastTime: performance.now(),
  player: { x: 235, y: 560 },
  moveTarget: null,
  boss: { x: 635, y: 326, direction: 1 },
  keys: new Set(),
  dialogueOpen: false,
  toastTimer: null,
};

const covers = [
  { type: 'table', x: 405, y: 470, label: '桌底', width: 178, height: 98 },
  { type: 'barrel', x: 700, y: 492, label: '木桶', width: 72, height: 72 },
  { type: 'curtain', x: 890, y: 364, label: '门帘', width: 94, height: 142 },
];

const gooseTable = { x: 1050, y: 188 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fillStyle, strokeStyle = null) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
  if (strokeStyle) {
    context.strokeStyle = strokeStyle;
    context.stroke();
  }
}

function drawLabel(text, x, y, options = {}) {
  const {
    color = '#f8e8cc',
    background = 'rgba(28, 18, 16, 0.74)',
    font = '600 13px Microsoft YaHei, sans-serif',
    paddingX = 8,
    paddingY = 5,
    align = 'center',
  } = options;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 24;
  let boxX = x - boxWidth / 2;
  if (align === 'left') boxX = x;
  if (align === 'right') boxX = x - boxWidth;
  fillRoundedRect(ctx, boxX, y - boxHeight / 2, boxWidth, boxHeight, 8, background, 'rgba(255, 237, 204, 0.14)');
  ctx.fillStyle = color;
  ctx.fillText(text, align === 'left' ? boxX + paddingX : align === 'right' ? boxX + boxWidth - paddingX : x, y + 0.5);
  ctx.restore();
}

function drawBackground() {
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, '#2c1715');
  background.addColorStop(0.18, '#5b2f22');
  background.addColorStop(1, '#251614');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 顶部墙体：让“上方”明确是店内深处，而不是天空或可攀爬的墙。
  fillRoundedRect(ctx, 28, 22, WIDTH - 56, 78, 16, '#321b19', 'rgba(255, 221, 173, 0.14)');
  ctx.fillStyle = '#8a4a2a';
  ctx.fillRect(30, 88, WIDTH - 60, 8);
  ctx.fillStyle = 'rgba(255, 214, 147, 0.08)';
  ctx.fillRect(30, 96, WIDTH - 60, 4);
  drawLabel('烧鹅店 · 后厨深处', WIDTH / 2, 59, {
    color: '#f6c96b',
    background: 'rgba(91, 47, 34, 0.8)',
    font: '700 16px Microsoft YaHei, sans-serif',
    paddingX: 14,
  });

  // 地面平面与网格：用地砖和阴影表达空间纵深。
  const floorGradient = ctx.createLinearGradient(0, FLOOR.top, 0, FLOOR.bottom);
  floorGradient.addColorStop(0, '#8b5336');
  floorGradient.addColorStop(0.52, '#75432f');
  floorGradient.addColorStop(1, '#563125');
  fillRoundedRect(ctx, FLOOR.left, FLOOR.top, FLOOR.right - FLOOR.left, FLOOR.bottom - FLOOR.top, 18, floorGradient, 'rgba(255, 227, 180, 0.18)');

  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, FLOOR.left, FLOOR.top, FLOOR.right - FLOOR.left, FLOOR.bottom - FLOOR.top, 18);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 226, 180, 0.10)';
  ctx.lineWidth = 1;
  for (let x = FLOOR.left; x <= FLOOR.right; x += 76) {
    ctx.beginPath();
    ctx.moveTo(x, FLOOR.top);
    ctx.lineTo(x, FLOOR.bottom);
    ctx.stroke();
  }
  for (let y = FLOOR.top; y <= FLOOR.bottom; y += 58) {
    ctx.beginPath();
    ctx.moveTo(FLOOR.left, y);
    ctx.lineTo(FLOOR.right, y);
    ctx.stroke();
  }
  ctx.restore();

  // 左侧出餐台与右侧挂架，说明这是可行走的平面房间。
  drawServiceCounter();
  drawRightShelf();

  // 出口与向店内的方向提示。
  fillRoundedRect(ctx, 65, 612, 176, 48, 12, 'rgba(25, 16, 14, 0.55)', 'rgba(255, 210, 122, 0.28)');
  ctx.fillStyle = '#f6c96b';
  ctx.font = '700 14px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('出口 / 回到街上', 153, 633);
  ctx.fillStyle = '#c9b195';
  ctx.font = '12px Microsoft YaHei, sans-serif';
  ctx.fillText('↓ 向下离开店内', 153, 651);

  ctx.save();
  ctx.strokeStyle = 'rgba(246, 201, 107, 0.62)';
  ctx.fillStyle = 'rgba(246, 201, 107, 0.62)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2, 118);
  ctx.lineTo(WIDTH / 2, 146);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(WIDTH / 2 - 6, 140);
  ctx.lineTo(WIDTH / 2, 148);
  ctx.lineTo(WIDTH / 2 + 6, 140);
  ctx.fill();
  ctx.restore();
  drawLabel('↑ 店内深处', WIDTH / 2, 118, { color: '#f6c96b', background: 'rgba(42, 23, 21, 0.72)', font: '600 12px Microsoft YaHei, sans-serif' });
}

function drawServiceCounter() {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 8;
  fillRoundedRect(ctx, 70, 156, 194, 244, 14, '#5a3024', 'rgba(255, 223, 179, 0.15)');
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#b16e45';
  ctx.fillRect(78, 166, 178, 10);
  ctx.fillStyle = 'rgba(255, 234, 196, 0.12)';
  for (let y = 206; y < 370; y += 43) ctx.fillRect(88, y, 158, 2);
  ctx.fillStyle = '#e7ba6e';
  ctx.font = '700 13px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('出餐台', 167, 191);
  ctx.fillStyle = '#c79f7b';
  ctx.font = '11px Microsoft YaHei, sans-serif';
  ctx.fillText('不可穿越 · 可绕行', 167, 382);
  ctx.restore();
}

function drawRightShelf() {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 8;
  fillRoundedRect(ctx, 1056, 290, 142, 220, 14, '#543025', 'rgba(255, 223, 179, 0.14)');
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#9e603d';
  ctx.fillRect(1064, 306, 126, 8);
  ctx.fillRect(1064, 374, 126, 8);
  ctx.fillRect(1064, 442, 126, 8);
  for (const y of [338, 406, 474]) {
    ctx.fillStyle = '#d18b43';
    ctx.beginPath();
    ctx.arc(1090, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e4bd68';
    ctx.beginPath();
    ctx.arc(1148, y, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  drawLabel('调料架', 1127, 528, { color: '#c8a889', background: 'rgba(39, 21, 19, 0.68)', font: '600 12px Microsoft YaHei, sans-serif' });
  ctx.restore();
}

function drawVisionCone() {
  const { x, y, direction } = state.boss;
  const pulse = 0.5 + Math.sin(state.time * 2.4) * 0.08;
  const start = direction > 0 ? -0.58 : Math.PI - 0.58;
  const end = direction > 0 ? 0.58 : Math.PI + 0.58;

  ctx.save();
  ctx.fillStyle = `rgba(224, 76, 50, ${0.12 + pulse * 0.12})`;
  ctx.strokeStyle = 'rgba(246, 119, 79, 0.45)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, 218, start, end);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawLabel('老板警戒区', direction > 0 ? x + 150 : x - 150, y - 80, {
    color: '#ffb19a',
    background: 'rgba(104, 35, 28, 0.64)',
    font: '600 12px Microsoft YaHei, sans-serif',
  });
}

function drawCover(cover) {
  const { x, y } = cover;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 10;

  if (cover.type === 'table') {
    fillRoundedRect(ctx, x - cover.width / 2, y - cover.height / 2, cover.width, cover.height, 12, '#583022', 'rgba(255, 217, 157, 0.24)');
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#a6643f';
    fillRoundedRect(ctx, x - cover.width / 2 + 8, y - cover.height / 2 + 8, cover.width - 16, 26, 8, '#a6643f');
    ctx.fillStyle = 'rgba(28, 14, 13, 0.5)';
    ctx.fillRect(x - 64, y - 4, 128, 26);
    ctx.fillStyle = '#d09a65';
    ctx.font = '600 11px Microsoft YaHei, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('桌底 · 可藏', x, y + 42);
  } else if (cover.type === 'barrel') {
    ctx.fillStyle = '#713d29';
    ctx.beginPath();
    ctx.arc(x, y, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#b87546';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(44, 19, 16, 0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 28, y - 10);
    ctx.lineTo(x + 28, y - 10);
    ctx.moveTo(x - 28, y + 10);
    ctx.lineTo(x + 28, y + 10);
    ctx.stroke();
    drawLabel('木桶 · 可藏', x, y + 58, { color: '#d09a65', background: 'rgba(57, 27, 23, 0.75)', font: '600 11px Microsoft YaHei, sans-serif' });
  } else {
    fillRoundedRect(ctx, x - 47, y - 71, 94, 142, 10, '#762f36', 'rgba(255, 205, 172, 0.2)');
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 216, 174, 0.25)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + i * 18, y - 66);
      ctx.lineTo(x + i * 18, y + 66);
      ctx.stroke();
    }
    drawLabel('门帘 · 可藏', x, y + 92, { color: '#e2b08e', background: 'rgba(77, 27, 32, 0.78)', font: '600 11px Microsoft YaHei, sans-serif' });
  }
  ctx.restore();
}

function drawGooseTable() {
  const { x, y } = gooseTable;
  const pulse = 0.5 + Math.sin(state.time * 3.2) * 0.5;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 10;
  fillRoundedRect(ctx, x - 92, y - 34, 184, 68, 12, '#5a3022', 'rgba(255, 224, 167, 0.28)');
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = `rgba(246, 201, 107, ${0.16 + pulse * 0.16})`;
  ctx.beginPath();
  ctx.arc(x, y, 69 + pulse * 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d88a27';
  ctx.beginPath();
  ctx.ellipse(x, y, 34, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd979';
  ctx.beginPath();
  ctx.ellipse(x - 8, y - 7, 13, 5, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f6c96b';
  ctx.font = '700 13px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('烧鹅台 · 互动', x, y + 58);
  ctx.restore();
}

function drawBoss() {
  const { x, y, direction } = state.boss;
  const active = Math.hypot(state.player.x - x, state.player.y - y) < 110;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.36)';
  ctx.shadowBlur = 13;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#2b1715';
  ctx.beginPath();
  ctx.ellipse(x, y + 29, 38, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 简化 NPC 占位：红围裙 + 厨师帽，后续可替换为正式角色序列帧。
  ctx.fillStyle = '#b43d2e';
  ctx.beginPath();
  ctx.ellipse(x, y + 13, 27, 31, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0bd8d';
  ctx.beginPath();
  ctx.arc(x, y - 16, 23, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff5df';
  ctx.beginPath();
  ctx.ellipse(x, y - 39, 31, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 22, y - 50, 44, 13);
  ctx.fillStyle = '#30201e';
  const eyeShift = direction > 0 ? 7 : -7;
  ctx.beginPath();
  ctx.arc(x + eyeShift - 7, y - 18, 3, 0, Math.PI * 2);
  ctx.arc(x + eyeShift + 5, y - 18, 3, 0, Math.PI * 2);
  ctx.fill();

  if (active || state.dialogueOpen) {
    ctx.strokeStyle = '#f6c96b';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(x, y - 4, 48 + Math.sin(state.time * 4) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawLabel(active ? '老板 · 可对话' : '老板', x, y - 78, {
    color: active ? '#f6c96b' : '#f2c3a0',
    background: active ? 'rgba(92, 56, 24, 0.88)' : 'rgba(61, 29, 25, 0.74)',
    font: '700 12px Microsoft YaHei, sans-serif',
  });
  ctx.restore();
}

function drawGooseFallback() {
  const { x, y } = state.player;
  ctx.fillStyle = '#c6762d';
  ctx.beginPath();
  ctx.ellipse(x, y - 20, 30, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d68b34';
  ctx.beginPath();
  ctx.arc(x + 7, y - 60, 21, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2bd3b';
  ctx.beginPath();
  ctx.ellipse(x + 28, y - 58, 17, 8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const { x, y } = state.player;
  ctx.save();
  ctx.fillStyle = 'rgba(24, 13, 12, 0.38)';
  ctx.beginPath();
  ctx.ellipse(x, y + 7, 37, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  if (gooseImage.complete && gooseImage.naturalWidth > 0) {
    ctx.drawImage(gooseImage, 0, 0, 256, 256, x - 43, y - 80, 86, 86);
  } else {
    drawGooseFallback();
  }

  ctx.strokeStyle = '#8fe0bd';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 25, 45 + Math.sin(state.time * 3) * 2, 0, Math.PI * 2);
  ctx.stroke();
  drawLabel('莞小鹅 · 玩家', x, y + 43, { color: '#b9f2d0', background: 'rgba(20, 57, 45, 0.82)', font: '700 12px Microsoft YaHei, sans-serif' });
  ctx.restore();
}

function drawPlayerPath() {
  if (!state.moveTarget) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(185, 242, 208, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 8]);
  ctx.beginPath();
  ctx.moveTo(state.player.x, state.player.y);
  ctx.lineTo(state.moveTarget.x, state.moveTarget.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(185, 242, 208, 0.78)';
  ctx.beginPath();
  ctx.arc(state.moveTarget.x, state.moveTarget.y, 6 + Math.sin(state.time * 4) * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawScene() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  drawVisionCone();
  drawGooseTable();
  for (const cover of covers) drawCover(cover);
  drawBoss();
  drawPlayerPath();
  drawPlayer();
}

function updateStatus() {
  const nearBoss = Math.hypot(state.player.x - state.boss.x, state.player.y - state.boss.y) < 110;
  const nearTable = Math.hypot(state.player.x - gooseTable.x, state.player.y - gooseTable.y) < 105;
  const nearCover = covers.some((cover) => Math.hypot(state.player.x - cover.x, state.player.y - cover.y) < 78);

  if (nearBoss) {
    statusValue.innerHTML = '<strong>可与老板对话</strong><br />点击老板打开对话示例';
  } else if (nearTable) {
    statusValue.innerHTML = '<strong>可互动</strong><br />抵达烧鹅台后偷尝';
  } else if (nearCover) {
    statusValue.innerHTML = '<strong>已接近掩体</strong><br />这里可以藏好';
  } else {
    statusValue.innerHTML = '<strong>未被发现</strong><br />靠近老板或烧鹅台可互动';
  }
}

function update(deltaTime) {
  state.time += deltaTime;
  if (!state.dialogueOpen) {
    let axisX = 0;
    let axisY = 0;
    if (state.keys.has('a') || state.keys.has('arrowleft')) axisX -= 1;
    if (state.keys.has('d') || state.keys.has('arrowright')) axisX += 1;
    if (state.keys.has('w') || state.keys.has('arrowup')) axisY -= 1;
    if (state.keys.has('s') || state.keys.has('arrowdown')) axisY += 1;

    const magnitude = Math.hypot(axisX, axisY);
    if (magnitude > 0) {
      state.moveTarget = null;
      state.player.x += (axisX / magnitude) * PLAYER_SPEED * deltaTime;
      state.player.y += (axisY / magnitude) * PLAYER_SPEED * deltaTime;
    } else if (state.moveTarget) {
      const dx = state.moveTarget.x - state.player.x;
      const dy = state.moveTarget.y - state.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 4) {
        state.moveTarget = null;
      } else {
        const distanceThisFrame = Math.min(distance, PLAYER_SPEED * deltaTime);
        state.player.x += (dx / distance) * distanceThisFrame;
        state.player.y += (dy / distance) * distanceThisFrame;
      }
    }

    state.player.x = clamp(state.player.x, FLOOR.left + 38, FLOOR.right - 38);
    state.player.y = clamp(state.player.y, FLOOR.top + 56, FLOOR.bottom - 32);
  }
  updateStatus();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1900);
}

function setDialogue(open) {
  state.dialogueOpen = open;
  dialogueCard.hidden = !open;
  demoButton.hidden = open;
  if (open) {
    state.moveTarget = null;
    showToast('对话层出现，移动已锁定');
  } else {
    showToast('回到地图，继续潜行');
  }
  updateStatus();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
  };
}

canvas.addEventListener('pointerdown', (event) => {
  if (state.dialogueOpen) return;
  const point = canvasPoint(event);
  const distanceToBoss = Math.hypot(point.x - state.boss.x, point.y - state.boss.y);
  const distanceToTable = Math.hypot(point.x - gooseTable.x, point.y - gooseTable.y);

  if (distanceToBoss < 72) {
    setDialogue(true);
    return;
  }
  if (distanceToTable < 78) {
    showToast('烧鹅台是目标互动点：抵达后可偷尝');
    return;
  }

  state.moveTarget = {
    x: clamp(point.x, FLOOR.left + 38, FLOOR.right - 38),
    y: clamp(point.y, FLOOR.top + 56, FLOOR.bottom - 32),
  };
  showToast('已设定移动目标');
});

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    event.preventDefault();
    state.keys.add(key);
  }
  if ((key === 'e' || key === ' ') && !state.dialogueOpen) {
    const nearBoss = Math.hypot(state.player.x - state.boss.x, state.player.y - state.boss.y) < 110;
    if (nearBoss) setDialogue(true);
  }
  if (key === 'escape' && state.dialogueOpen) setDialogue(false);
});

window.addEventListener('keyup', (event) => {
  state.keys.delete(event.key.toLowerCase());
});

demoButton.addEventListener('click', () => setDialogue(true));
closeDialogue.addEventListener('click', () => setDialogue(false));

function frame(now) {
  const deltaTime = Math.min((now - state.lastTime) / 1000, 0.05);
  state.lastTime = now;
  update(deltaTime);
  drawScene();
  window.requestAnimationFrame(frame);
}

window.requestAnimationFrame(frame);
