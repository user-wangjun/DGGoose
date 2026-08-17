/**
 * 观赏互动点数据（对应 PRD §5 F8）
 *
 * 工业园区与 DGUT 校园各 3 个发光互动点，点击弹出台词气泡。
 * 结构: { id, scene, name, text, x, y }
 * - id: 互动点唯一标识
 * - scene: 所属场景（ch4 工业园区 / ch5 DGUT）
 * - name: 互动点名称
 * - text: 触发台词
 * - x/y: 互动点在正式园区底图中的画布逻辑坐标
 */
export const HOTSPOTS = [
  // ==================== 工业园区（第四章） ====================
  {
    id: 'industrial_smart_workshop',
    scene: 'ch4',
    name: '智能车间',
    text: '科技兴国——机械臂的每一次起落，都是智慧的舞蹈。',
    x: 250,
    y: 315,
  },
  {
    id: 'industrial_drone_pad',
    scene: 'ch4',
    name: '无人机坪',
    text: '无人机掠过厂房上空，东莞的天空也在起飞。',
    x: 548,
    y: 132,
  },
  {
    id: 'industrial_worker_silhouette',
    scene: 'ch4',
    name: '设备区',
    text: '工业工人把每一道工序做得稳、做得精，机器和双手在这里协同运转。',
    x: 840,
    y: 575,
  },

  // ==================== DGUT 校园（第五章） ====================
  {
    id: 'campus_library',
    scene: 'ch5',
    name: '图书馆',
    text: '教育兴邦——笔尖沙沙响，是城市的心跳。',
    // 对应收紧后的图书馆中央入口与前方大台阶。
    x: 520,
    y: 470,
  },
  {
    id: 'campus_study_window',
    scene: 'ch5',
    name: '自习室窗',
    text: '深夜的灯还亮着，少年的梦还醒着。',
    // 对应右侧相邻教学/自习楼的连续玻璃窗带前步道，避免把观察点放到建筑实体内部。
    x: 1060,
    y: 480,
  },
  {
    id: 'campus_path',
    scene: 'ch5',
    name: '校道',
    text: '学长说："毕业后去造芯片，把知识变成产品。"',
    // 对应图书馆前场从南侧广场通向入口的中央步道。
    x: 640,
    y: 520,
  },
];

/**
 * 按场景筛选互动点
 * @param {string} scene - 场景 id（如 'ch4'）
 * @returns {Array} 该场景的互动点数组
 */
export function getHotspotsByScene(scene) {
  return HOTSPOTS.filter((spot) => spot.scene === scene);
}
