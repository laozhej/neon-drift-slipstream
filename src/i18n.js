// English text is the key. Anything missing from the Chinese table falls back to
// English, so a new string is never blank.
const ZH = {
  // Top bar and common
  'SOUND ON': '声音 开', 'SOUND OFF': '声音 关', 'SETTINGS': '设置', 'FULLSCREEN': '全屏', 'PAUSE': '暂停',
  'Switch language': '切换语言', 'Mute or unmute': '静音 / 取消静音', 'Open settings': '打开设置', 'Toggle fullscreen': '切换全屏',

  // Title
  'A THREE.JS REBUILD · V1.0': 'THREE.JS 重制版 · V1.0',
  'SLIPSTREAM': '光 流',
  'Graze the light. Drift through it.': '擦过光幕，穿越其间。',
  'Three sectors. Three bosses. Every bullet you brush charges the drive — spend it to cut straight through the storm.':
    '三个区域，三场首领战。擦过的每一颗子弹都会为引擎充能——用它直接切开弹幕。',
  'FLIGHT CLASS': '飞行难度', 'AIRFRAME': '机体', 'STEER WITH': '操控方式', 'KEYBOARD': '键盘', 'MOUSE': '鼠标',
  'INITIATE FLIGHT': '开始飞行', 'BEST': '最高分', 'BEST {score}': '最高分 {score}',
  'EASY': '简单', 'NORMAL': '普通', 'HARD': '困难', 'LUNATIC': '狂乱', 'EXTREME': '极限',
  'VECTOR': '矢量', 'HALBERD': '长戟', 'MIRAGE': '幻影',
  'All-rounder — twin guns that widen with power. Wisps seek when loose and lock forward when focused.': '均衡型 —— 双联机炮随火力展开。僚机散开时追踪，聚焦时锁定前方。',
  'Heavy — slow, with every barrel pointing forward. Its long drift rams for nearly triple damage.': '重型 —— 速度较慢，所有炮口直指前方。漂移距离更长，冲撞伤害接近三倍。',
  'Skirmisher — fast, with a wide fan and seeker wisps. Longer graze reach, quicker flux, stronger shards.': '游击型 —— 速度快，宽幅扇形火力与追踪僚机。擦弹范围更大，充能更快，碎片更强。',
  'Starlight Cruise — 5 lives, 3 novas and a shield. Slower shots, faster flux.': '星光巡航 —— 5 条生命、3 枚新星与一层护盾。敌弹更慢，充能更快。',
  'Neon Drift — the reference campaign. Find your rhythm.': '霓虹漂移 —— 标准战役。找到你的节奏。',
  'Razor Current — wider fans, denser rings, a faster pulse.': '锋刃激流 —— 更宽的扇形、更密的环形、更快的节拍。',
  'Prism Storm — boss crossfire and tighter corridors.': '棱镜风暴 —— 首领交叉火力，通道更窄。',
  'Event Horizon — relentless patterns; fallen enemies leave a final echo.': '事件视界 —— 毫不停歇的弹幕；被击毁的敌人会留下最后的回响。',
  'FLIGHT MANUAL': '飞行手册',
  'MOVE': '移动', 'FIRE': '射击', 'FOCUS': '聚焦', 'DRIFT': '漂移', 'NOVA': '新星',
  'Steer your ship': '操控机体', 'Move the mouse to steer': '移动鼠标操控机体',
  'Hold to fire': '按住射击',
  'Slow down, tighten the guns, see the graze ring': '低速移动，收束火力，显示擦弹范围',
  'Spend one FLUX: dash through bullets and turn them into homing shards': '消耗一格光流：冲刺穿过弹幕，并把子弹转化为追踪碎片',
  'Clear the screen in an emergency': '紧急清屏',
  'Only the bright core of your ship takes damage. Fly close — every graze charges FLUX.': '只有机体中心的亮点会受伤。贴近飞行——每次擦弹都会积累光流。',

  // HUD
  'SCORE': '得分', 'CHAIN': '连锁', 'FLUX': '光流', 'OVERDRIVE': '超载', 'LIVES': '生命', 'POWER': '火力', 'SHIELD': '护盾',
  'GRAZE': '擦弹', 'MAX': '满', 'READY': '就绪', 'NONE': '无', 'DRIFT {key}': '漂移 {key}', 'NEXT SECTOR': '下一区域',
  '{count} lives': '{count} 条生命', '{count} novas': '{count} 枚新星',

  // Sectors, sections and bosses
  'SECTOR 01': '区域 01', 'SECTOR 02': '区域 02', 'SECTOR 03': '区域 03',
  'OUTER ORBIT': '外层轨道', 'PRISM REEF': '棱镜礁', 'SOLAR FORGE': '太阳熔炉',
  'DREADNOUGHT': '无畏舰', 'MIRROR WARDEN': '镜面守卫', 'HELIX CROWN': '螺旋王冠',
  '01 · OUTER ORBIT': '01 · 外层轨道', '02 · SIGNAL INTERFERENCE': '02 · 信号干扰', '03 · NEON CURRENT': '03 · 霓虹激流',
  'WARNING · HOSTILE CORE': '警告 · 敌方核心',
  '01 · GLASS TIDE': '01 · 玻璃潮汐', '02 · MIRROR FIELD': '02 · 镜面力场', '03 · SHATTERED LIGHT': '03 · 碎光',
  'WARNING · MIRROR WARDEN': '警告 · 镜面守卫',
  '01 · EMBER TRAIL': '01 · 余烬航迹', '02 · FUSION CHAMBER': '02 · 聚变舱', '03 · CROWN GATE': '03 · 王冠之门',
  'WARNING · HELIX CROWN': '警告 · 螺旋王冠',
  '{label} / {name}': '{label} / {name}',
  'WARNING / {boss}': '警告 / {boss}', 'Signal acquired. Hold your line.': '已锁定信号。稳住航线。',
  'PHASE 0{n} / {name}': '阶段 0{n} / {name}',
  '{label} CLEAR': '{label} 已肃清', 'NEXT / {name}': '下一站 / {name}',
  'VECTOR LOCK': '矢量锁定', 'PULSE BLOOM': '脉冲绽放', 'EVENT HORIZON': '事件视界',
  'MIRROR FAN': '镜面扇形', 'CRYSTAL RAIN': '水晶雨', 'REFRACTION': '折射',
  'SOLAR FLARE': '太阳耀斑', 'ORBITAL CROWN': '轨道王冠', 'HELIX STORM': '螺旋风暴',
  'Aimed fans and wing rails · keep moving': '瞄准扇形与翼侧光轨 · 保持移动',
  'Expanding rings · find the opening': '扩散环形 · 寻找缺口',
  'Curving spirals · drift through the arms': '弯曲螺旋 · 漂移穿过旋臂',
  'Twin fans rebound off the walls': '双扇形弹幕会在墙面反弹',
  'Falling curtains · follow the open lane': '坠落弹幕 · 跟随开放通道',
  'Rings and splitting prisms · find the opening': '环形与分裂棱镜 · 寻找缺口',
  'Sweeping arcs and a flare beam · stay wide': '横扫弧线与耀斑光束 · 保持距离',
  'Orbiting emitters · watch both sides': '环绕发射器 · 注意两侧',
  'Twin spirals · breathe between pulses': '双螺旋 · 在脉冲间隙喘息',

  // Supplies
  'POWER UP': '火力提升', 'Wisps online': '僚机上线', 'Spread widened': '弹道加宽', 'Weapon at maximum': '武器已达上限',
  'Weapon at maximum · bonus score': '武器已满 · 奖励分数',
  'NOVA STOCK': '新星补给', 'One nova added': '新星 +1', 'Stock full · bonus score': '库存已满 · 奖励分数',
  'SHIELD ONLINE': '护盾启动', 'One-hit guard': '抵挡一次伤害', 'Already shielded · bonus score': '护盾已启动 · 奖励分数',
  'FLUX CELL': '光流电池', 'One drift charged': '漂移 +1', 'Gauge full · bonus score': '光流已满 · 奖励分数',

  // Hints and floaters
  'FLUX READY — press {key} to DRIFT through bullets': '光流就绪 —— 按 {key} 漂移穿过弹幕',
  'OVERDRIVE — the gauge is full: guns +30% until you drift': '超载 —— 光流已满：漂移之前火力 +30%',
  'BEAM INCOMING — leave the line, or drift across it': '光束来袭 —— 离开射线，或漂移穿过',
  'SLIPSTREAM ×{count}': '光流连斩 ×{count}',
  'Graze bullets to charge FLUX': '擦弹积累光流',

  // Pause
  'PAUSED': '已暂停',
  'Your flight is paused. The stars can wait.': '飞行已暂停。星辰可以等待。',
  'Focus lost. Your flight is safe here.': '窗口失去焦点。你的飞行已安全暂停。',
  'Settings open. Resume when you’re ready.': '设置已打开。准备好后继续。',
  'RESUME': '继续飞行', 'RESTART': '重新开始', 'QUIT TO TITLE': '返回标题',

  // Results
  'EXPEDITION CLEAR / TRANSMISSION COMPLETE': '远征完成 / 传输结束',
  'SIGNAL LOST / FLIGHT ENDED': '信号丢失 / 飞行结束',
  'A new dawn.': '新的黎明。', 'One more flight.': '再飞一次。',
  'Three sectors liberated. The Helix Crown falls silent.': '三个区域已解放。螺旋王冠归于沉寂。',
  'Every flight brings you closer. Find your line.': '每次飞行都让你更进一步。找到你的航线。',
  'FINAL SCORE': '最终得分', 'NEW PERSONAL BEST': '新的个人纪录', 'FLIGHT RECORDED': '飞行已记录', 'PRACTICE FLIGHT': '练习飞行',
  '{ship} · {difficulty} · SCORE ×{multiplier}': '{ship} · {difficulty} · 得分 ×{multiplier}',
  'HOSTILES DOWN': '击毁敌机', 'GRAZES': '擦弹次数', 'DRIFTS': '漂移次数', 'BULLETS CONVERTED': '转化子弹',
  'BEST SLIPSTREAM': '最佳连斩', 'MAX CHAIN': '最高连锁', 'SECTORS CLEAR': '肃清区域', 'FLIGHT TIME': '飞行时间',
  'FLY AGAIN': '再次飞行', 'TITLE': '标题画面',

  // Settings
  'CONTROLS': '操作', 'DISPLAY': '显示', 'AUDIO': '音频', 'AUTO-FIRE': '自动射击', 'ON': '开', 'OFF': '关',
  'Move up': '上移', 'Move down': '下移', 'Move left': '左移', 'Move right': '右移', 'Fire': '射击', 'Focus': '聚焦',
  'Drift': '漂移', 'Nova': '新星', 'Pause': '暂停', 'Mute': '静音',
  'Click a slot, then press a key or mouse button. Backspace clears, Esc cancels.': '点击一个槽位，然后按下按键或鼠标键。退格键清除，Esc 取消。',
  'PRESS…': '请按键…', 'RESET CONTROLS': '恢复默认操作',
  'Pause needs at least one binding.': '暂停至少需要保留一个按键。',
  'Controls saved on this device.': '操作设置已保存在此设备。',
  'Gamepad: stick to fly · A fire · X drift · B nova · shoulders focus · Start pause': '手柄：摇杆移动 · A 射击 · X 漂移 · B 新星 · 肩键聚焦 · Start 暂停',
  'GRAPHICS': '画质', 'HIGH': '高', 'MEDIUM': '中', 'LOW': '低',
  'CAMERA': '镜头', 'DYNAMIC': '动态', 'FLAT': '俯视',
  'SCREEN SHAKE': '画面震动', 'GLOW': '辉光', 'BRIGHTNESS': '亮度',
  'Glow is the halo around ships and bullets. Brightness is the whole picture.': '辉光是机体与子弹周围的光晕；亮度调节整体画面。', 'MUSIC': '音乐', 'EFFECTS': '音效', 'LANGUAGE': '语言', 'CLOSE': '关闭',
  'Dynamic leans the camera behind the ship. Flat looks straight down, like the original.': '动态镜头会倾斜于机体后方；俯视镜头垂直向下，与原版一致。',
  'LMB': '左键', 'MMB': '中键', 'RMB': '右键',
  'Neon Drift: Slipstream — a three.js bullet-hell shooter. Graze to charge, drift to cut through.': '霓虹漂移：光流 —— three.js 弹幕射击游戏。擦弹充能，漂移破阵。',
};

const TABLES = { en: null, zh: ZH };
let language = 'en';

export const LANGUAGES = Object.freeze(['en', 'zh']);
export const getLanguage = () => language;
export function setLanguage(next) {
  language = LANGUAGES.includes(next) ? next : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  return language;
}

export function detectLanguage() {
  const preferred = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

// Placeholder values are translated too, so a banner can carry a sector name.
export function t(text, vars = null) {
  if (text == null) return '';
  let result = TABLES[language]?.[text] ?? text;
  if (vars) {
    result = result.replace(/\{(\w+)\}/g, (match, name) => {
      if (!(name in vars)) return match;
      const value = vars[name];
      return typeof value === 'string' ? (TABLES[language]?.[value] ?? value) : String(value);
    });
  }
  return result;
}

// Static markup carries its English text in data-i18n attributes.
export function translateDocument(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel));
  for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = t('Neon Drift: Slipstream — a three.js bullet-hell shooter. Graze to charge, drift to cut through.');
}

export const hasTranslation = (text, lang = 'zh') => Boolean(TABLES[lang]?.[text]);
