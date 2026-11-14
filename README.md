# Neon Drift: Slipstream

A three.js remake of [Neon Drift](https://github.com/laozhej/neon-drift) — the same three-sector bullet-hell campaign, rebuilt in 3D around a new mechanic: **graze bullets to charge the drive, then drift straight through them.**

[English](#english) · [简体中文](#简体中文)

## English

### Play

```
npm install
npm start
```

Then open <http://127.0.0.1:4173>. Needs Node 22 or newer and a browser with WebGL 2.

Or skip all of that: **`Neon Drift Slipstream.html`** is the whole game in one file — styles, three.js and the game inlined. Double-click it, no server or install needed.

`npm run build` regenerates that file and also writes `dist/` (one HTML file, one stylesheet, one script) for static hosting.

### What carried over, and what is new

Kept from the original: the 480 × 720 playfield and its tuning, three sectors with three-phase bosses (Dreadnought, Mirror Warden, Helix Crown), five flight classes with separate records, power / nova / shield supplies, graze scoring, focus mode, three-slot key rebinding, mouse steering, and the English / 中文 interface.

New in this version:

| | |
| --- | --- |
| **Flux and Drift** | Every graze fills the FLUX gauge. One segment buys a drift: a short invulnerable dash. Every bullet the ship brushes on the way becomes a homing shard that flies back at the enemy. Convert eight or more in one dash (a *slipstream*) and part of the cost is refunded. |
| **Overdrive** | A full gauge (three segments) adds 30 % gun damage until you spend it. Hoard or dash — your call. |
| **Chain** | Grazes, kills and conversions build a score multiplier up to ×8. It decays when you play safe and resets when you are hit. |
| **Wisps** | The second power level adds two drones: seekers when loose, straight bolts when focused. |
| **New hostiles** | *Lancers* park and fire telegraphed beams. *Blooms* burst into a slow pinwheel that is best crossed with a drift. *Darts* are fast popcorn. |
| **New patterns** | Bullets can curve, bounce off the walls, split and re-aim; bosses use all of it. Cancelled bullets fall to you as score motes. |
| **3D presentation** | A camera that leans in behind the ship, a different world under the glass lane in each sector, bosses that surface from the depth, a warp between sectors. A *Flat* camera option looks straight down, like the original. |
| **Sound** | Everything is synthesized in the browser: effects, and a step-sequenced soundtrack per sector that picks up for bosses. |
| **Gamepad** | Stick or d-pad to fly, A fire, X drift, B nova, shoulders focus, Start pause. |

### Airframes

Pick one on the title screen (or with the up and down arrows). All three fly the same campaign.

| Airframe | How it plays |
| --- | --- |
| **Vector** | The all-rounder. Twin guns that widen with power; wisps seek when loose and fire straight when focused. |
| **Halberd** | The heavy. Slower, with every barrel pointing forward and straight-firing wisps. Its drift is longer and rams for nearly three times the damage. Shorter graze reach, slower flux. |
| **Mirage** | The skirmisher. Faster, with a wide fan from the first shot and wisps that always seek. Longer graze reach, quicker flux and stronger shards, but each shot is light. |

Records are kept per flight class, not per airframe.

### Controls

| Default | Action |
| --- | --- |
| Arrows / WASD | Move |
| Z / Space / left mouse (hold) | Fire |
| Shift (hold) | Focus: slow down, tighten the guns, show the graze ring |
| C / V / right mouse | Drift (spends one FLUX segment) |
| X / B / middle mouse | Nova: clear the screen |
| Esc / P | Pause |
| M | Mute |

Everything can be rebound under **Settings**, along with mouse steering, auto-fire, graphics quality, camera, screen shake, language and volume. Two sliders set the light: **Glow** is the halo around ships and bullets (zero turns it off), **Brightness** is the exposure of the whole picture. Only the bright dot at the centre of the ship can be hit.

### Flight classes

| Class | What changes |
| --- | --- |
| Easy | 5 lives, 3 novas, a shield; slower bullets, faster flux, score ×0.75 |
| Normal | The reference campaign |
| Hard | Wider fans, denser rings, faster fire, score ×1.5 |
| Lunatic | Boss crossfire, tighter gaps, 2 lives, score ×2 |
| Extreme | Fallen enemies fire a last echo, 1 nova, score ×3 |

### For development

```
npm test              # simulation, bindings, storage and translation tests (Node)
npm run test:browser  # end-to-end run in headless Chrome or Edge
npm run build         # single-file edition + dist/
```

- `src/sim/` is the game itself: a fixed-step (120 Hz), seeded, DOM-free simulation. The same code runs in the browser and under `node --test`, where a bot flies the whole campaign on every class.
- `src/render/` draws a simulation state with three.js; nothing in it feeds back into gameplay.
- `src/main.js`, `hud.js`, `input.js`, `audio.js`, `i18n.js`, `storage.js` are the shell around the two.
- Tuning lives in `src/sim/config.js`, the airframes in `src/sim/ships.js`, the campaign in `src/sim/sectors.js`, boss patterns in `src/sim/bosses.js`.
- `tests/browser/look.mjs` is a small aid that drives the running game and saves screenshots to `output/look/`.

Practice flags: add `?sector=2` (or `3`) to the address to start at a later sector, and `?god` to make the ship untouchable. Practice flights do not save records.

## 简体中文

[Neon Drift](https://github.com/laozhej/neon-drift) 的 three.js 重制版：保留原作的三区域弹幕战役，并围绕一个新机制重新设计——**擦弹为引擎充能，然后直接漂移穿过弹幕。**

### 开始游戏

```
npm install
npm start
```

然后打开 <http://127.0.0.1:4173>。需要 Node 22 或更高版本，以及支持 WebGL 2 的浏览器。

也可以完全跳过以上步骤：**`Neon Drift Slipstream.html`** 是单文件版本，样式、three.js 与游戏代码全部内联，双击即可游玩，无需服务器或安装。

`npm run build` 会重新生成该文件，并在 `dist/` 输出用于静态托管的版本（一个 HTML、一个样式表、一个脚本）。

### 保留与新增

保留自原作：480 × 720 的游戏区域与数值、三个区域与三阶段首领（无畏舰、镜面守卫、螺旋王冠）、五种难度及各自的最高分、火力 / 新星 / 护盾补给、擦弹得分、聚焦模式、三槽位按键自定义、鼠标操控，以及中英文界面。

新增内容：

- **光流与漂移**：每次擦弹都会积累光流。消耗一格即可漂移——一次短暂的无敌冲刺，途中擦过的每颗子弹都会转化为追踪碎片飞向敌人。一次漂移转化八颗以上（光流连斩）会返还部分消耗。
- **超载**：光流全满（三格）时火力 +30%，直到你使用漂移。
- **连锁**：擦弹、击毁与转化会累积得分倍率，最高 ×8；被击中则清零。
- **僚机**：火力二级后获得两架僚机，散开时发射追踪弹，聚焦时发射直线弹。
- **新敌人**：会发射预警光束的「枪骑兵」、被击毁后绽放风车弹幕的「花苞」、高速突击的「飞镖」。
- **新弹幕**：子弹可以转弯、在墙面反弹、分裂、二次瞄准；被消除的子弹会化作得分光点飞向你。
- **3D 表现**：倾斜于机体后方的动态镜头、每个区域不同的场景、从深处浮现的首领、区域之间的跃迁。设置中可切换为与原版一致的俯视镜头。
- **音频**：音效与每个区域的背景音乐全部由浏览器实时合成。
- **手柄**：摇杆或十字键移动，A 射击，X 漂移，B 新星，肩键聚焦，Start 暂停。

### 机体

在标题画面选择（也可用上下方向键切换），三种机体飞行同一场战役：

- **矢量 Vector**：均衡型。双联机炮随火力展开；僚机散开时追踪，聚焦时直射。
- **长戟 Halberd**：重型。速度较慢，所有炮口与僚机都直指前方；漂移距离更长，冲撞伤害接近三倍；擦弹范围较小，充能较慢。
- **幻影 Mirage**：游击型。速度更快，一开始就是宽幅扇形火力，僚机始终追踪；擦弹范围更大、充能更快、碎片更强，但单发伤害较低。

最高分按难度记录，不区分机体。

### 默认操作

| 按键 | 功能 |
| --- | --- |
| 方向键 / WASD | 移动 |
| Z / 空格 / 鼠标左键（按住） | 射击 |
| Shift（按住） | 聚焦：低速移动、收束火力、显示擦弹范围 |
| C / V / 鼠标右键 | 漂移（消耗一格光流） |
| X / B / 鼠标中键 | 新星：清屏 |
| Esc / P | 暂停 |
| M | 静音 |

所有按键都可以在「设置」中修改，同时可调整鼠标操控、自动射击、画质、镜头、画面震动、语言与音量。两个滑块控制光效：「辉光」是机体与子弹周围的光晕（调到零即关闭），「亮度」调节整体画面。只有机体中心的亮点会受伤。

### 开发

```
npm test              # 模拟、按键、存档与翻译测试（Node）
npm run test:browser  # 在无界面 Chrome / Edge 中进行端到端测试
npm run build         # 生成单文件版本与 dist/
```

`src/sim/` 是与渲染无关的固定步长（120 Hz）模拟，浏览器与 Node 测试运行同一份代码；`src/render/` 用 three.js 绘制模拟状态。数值在 `src/sim/config.js`，机体在 `src/sim/ships.js`，关卡在 `src/sim/sectors.js`，首领弹幕在 `src/sim/bosses.js`。

练习参数：在地址后加 `?sector=2`（或 `3`）可从后面的区域开始，加 `?god` 可无敌。练习飞行不会保存纪录。
