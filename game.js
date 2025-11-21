/**
 * 饥荒 Web 版 - V7.0 黄金时代
 * 1. 查理机制修复：黑暗中必死，与理智无关
 * 2. 新资源：金块 (挖矿获取)
 * 3. 新武器：长矛 (高伤害)
 * 4. 种植系统：松果 -> 树苗 -> 树
 */

const TILE_SIZE = 50;
const WORLD_SIZE = 60; // 初始世界大小（已废弃，改用无限世界）
const CHUNK_SIZE = 20; // 区块大小（20x20格子）
const ZOOM_SCALE = 1.5; // 整体缩放因子，放大1.5倍 
const DAY_LENGTH = 7200; // 120秒一天（增加白天时间）

const COLORS = {
    ground: '#2d3a25',
    ground_boss: '#2c0e0e',
    grass: '#7cb342',
    gold: '#ffd700',
    grid: 'rgba(255, 255, 255, 0.08)'
};

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        
        this.resize();
        this.keys = {};
        this.messageTimer = 0;
        this.mouse = { x: 0, y: 0 };
        this.ui = { craftOpen: false, inventoryOpen: false, achievementsOpen: false };
        this.pendingAchievements = null; // 待显示的成就列表
        this.weatherParticles = [];
        this.bloodParticles = []; // 新增：血滴粒子系统
        this.windParticles = []; // 新增：突进风粒子系统
        
        // 图片资源
        this.images = {};
        this.loadImages();
        
        this.state = {
            time: 0, day: 1,
            player: {
                x: 0, y: 0, // 从原点开始，无限世界
                health: 100, hunger: 100, sanity: 100,
                // 新增 gold, pinecone, spiderSilk, 二级材料
                inventory: { 
                    twig:0, flint:0, wood:0, stone:0, grass:0, berry:0, meat:0, bigmeat:0, gold:0, pinecone:0, rottenmeat:0, spiderSilk:0,
                    // 新增物品
                    arrow: 0,       // 箭矢 (消耗品)
                    rope: 0,        // 绳索 (压缩材料)
                    fat: 0,         // 羊油 (稀有掉落)
                    wool: 0,        // 羊毛 (稀有掉落)
                    fabric: 0       // 编织布 (高级材料)
                },
                tools: { 
                    axe: false, 
                    pickaxe: false, 
                    spear: false,
                    bow: false,  // 新增：弓箭
                    // 新增护甲状态
                    armor: false,       
                    armorDurability: 0,
                    axeDurability: 0,  // 工具耐久度
                    pickaxeDurability: 0,
                    spearDurability: 0,
                    bowDurability: 0  // 弓箭耐久度
                },
                dir: 1,
                isPaused: false,  // 游戏暂停状态
                dashCooldown: 0,  // 突进冷却时间（帧数）
                isDashing: false,  // 是否正在突进
                dashProgress: 0,  // 突进进度（0-1）
                dashStartX: 0,  // 突进起始X
                dashStartY: 0,  // 突进起始Y
                dashTargetX: 0,  // 突进目标X
                dashTargetY: 0,  // 突进目标Y
                dashDirection: { x: 0, y: 0 }  // 突进方向
            },
            entities: [],
            camera: { x: 0, y: 0 },
            isBloodMoon: false,
            darknessTimer: 0, // 记录在黑暗中的时间
            baseX: 0, baseY: 0, // 基地坐标（床的位置）
            hasBase: false, // 是否有基地
            chunks: {}, // 已生成的区块 { "chunkX,chunkY": true }
            spiderPoisonTimer: 0, // 蜘蛛中毒debuff计时器（300帧=5秒）
            lastKilledByBow: false, // 最后是否用弓箭击杀
            weather: {
                type: 'clear', // clear, rain, fog, snow, thunderstorm
                duration: 0,
                intensity: 1.0
            },
            achievements: {
                // 生存成就
                survivedDays: 0,
                maxDays: 0,
                // 资源成就
                totalWood: 0,
                totalStone: 0,
                totalGold: 0,
                // 战斗成就
                killedNightlings: 0,
                killedBossWolves: 0,
                killedWolves: 0,
                // 建造成就
                builtCampfires: 0,
                builtTowers: 0,
                // 其他
                plantedTrees: 0,
                totalMeat: 0
            }
        };

        this.bindEvents();
        this.loadGame();
        // 初始化成就系统
        this.checkAchievements();
        // 初始化音乐系统
        this.initMusic();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }
    
    // --- 新增：初始化音乐系统 ---
    initMusic() {
        this.bgm = document.getElementById('bgm');
        if (this.bgm) {
            // 设置音乐音量（0-1之间，0.3表示30%音量）
            this.bgm.volume = 0.3;
            // 尝试播放音乐（需要用户交互后才能自动播放）
            this.bgm.play().catch(err => {
                // 浏览器要求用户交互后才能播放，这里静默处理
                console.log('音乐将在用户交互后播放');
            });
        }
    }
    
    // --- 新增：播放/暂停音乐 ---
    toggleMusic() {
        if (this.bgm) {
            const musicBtn = document.getElementById('music-toggle');
            if (this.bgm.paused) {
                this.bgm.play().catch(err => console.log('无法播放音乐'));
                if (musicBtn) musicBtn.innerText = '🔊 音乐';
            } else {
                this.bgm.pause();
                if (musicBtn) musicBtn.innerText = '🔇 音乐';
            }
        }
    }
    
    loadImages() {
        const imageMap = {
            'stick': 'cartoon/branch.png',
            'flint': 'cartoon/flint.png',
            'rabbit': 'cartoon/rabbit.png',
            'tree': 'cartoon/tree.png',
            'rock': 'cartoon/stone.png',
            'bush': 'cartoon/berry.png',
            'campfire': 'cartoon/bonfire.png',
            'tower': 'cartoon/defensetower.png',
            'player': 'cartoon/girl.png',
            'boss_wolf': 'cartoon/wolfboss.png',
            'beacon': 'cartoon/lighthouse.png',
            // --- 新增映射 ---
            'wolf': 'cartoon/wolfboss.png', // 复用狼王图片
            'rottenmeat': 'cartoon/meat.png', // 复用小肉图片
            'spider': 'cartoon/spider.png' // 蜘蛛图片
        };
        
        let loaded = 0;
        const total = Object.keys(imageMap).length;
        
        Object.entries(imageMap).forEach(([key, path]) => {
            const img = new Image();
            img.onload = () => {
                loaded++;
                if (loaded === total) console.log('所有图片加载完成');
            };
            img.onerror = () => {
                console.warn(`图片加载失败: ${path}`);
                loaded++;
            };
            img.src = path;
            this.images[key] = img;
        });
    }

    resize() {
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;
        this.lightCanvas.width = this.width;
        this.lightCanvas.height = this.height;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
    }

    bindEvents() {
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (e.code === 'KeyE') {
                e.preventDefault();
                this.toggleInventory();
            }
            if (e.code === 'KeyH') {
                e.preventDefault();
                this.toggleCraftPanel();
            }
            if (e.code === 'KeyT') {
                e.preventDefault();
                this.toggleAchievements();
            }
        });
        window.addEventListener('keyup', e => {
            this.keys[e.code] = false;
            // 删除空格互动功能，改为dash功能
        });
        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('mousemove', e => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
            this.updateCursor();
        });

        this.canvas.addEventListener('mousedown', e => {
            const rect = this.canvas.getBoundingClientRect();
            const isRightClick = e.button === 2 || e.which === 3; // 右键点击
            this.handleClick(e.clientX - rect.left, e.clientY - rect.top, isRightClick);
        });
        
        // 阻止右键菜单
        this.canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
        });
    }

    updateCursor() {
        const cam = this.state.camera;
        const worldX = this.mouse.x + cam.x;
        const worldY = this.mouse.y + cam.y;
        const hovered = this.state.entities.some(e => Math.hypot(e.x - worldX, e.y - worldY) < 40);
        this.canvas.style.cursor = hovered ? 'pointer' : 'crosshair';
    }

    handleClick(mx, my, isRightClick = false) {
        // 如果点击在面板区域，不处理游戏交互，而是关闭面板
        const craftingPanel = document.getElementById('crafting-panel');
        const inventoryPanel = document.getElementById('inventory-panel');
        const achievementsPanel = document.getElementById('achievements-panel');
        
        const clickRect = { x: mx, y: my };
        
        // 检查是否点击在任意面板内
        let clickedOnPanel = false;
        [craftingPanel, inventoryPanel, achievementsPanel].forEach(panel => {
            if (panel && panel.style.display === 'block') {
                const rect = panel.getBoundingClientRect();
                const canvasRect = this.canvas.getBoundingClientRect();
                const panelX = rect.left - canvasRect.left;
                const panelY = rect.top - canvasRect.top;
                
                if (clickRect.x >= panelX && clickRect.x <= panelX + rect.width &&
                    clickRect.y >= panelY && clickRect.y <= panelY + rect.height) {
                    clickedOnPanel = true;
                }
            }
        });
        
        // 如果点击在面板外的空白区域，关闭所有面板
        if (!clickedOnPanel && (this.ui.craftOpen || this.ui.inventoryOpen || this.ui.achievementsOpen)) {
            this.closeAllPanels();
            return;
        }
        
        // 如果面板打开，不处理游戏交互
        if (this.ui.craftOpen || this.ui.inventoryOpen || this.ui.achievementsOpen) {
            return;
        }
        
        const cam = this.state.camera;
        const worldX = mx + cam.x;
        const worldY = my + cam.y;
        const p = this.state.player;
        const tools = p.tools;

        // --- 新增：右键点击使用弓箭射击 ---
        if (isRightClick && tools.bow && tools.bowDurability > 0) {
            this.shootBow(worldX, worldY);
            return;
        }

        let target = null;
        let minDist = 50;
        this.state.entities.forEach((e, index) => {
            const dist = Math.hypot(e.x - worldX, e.y - worldY);
            if (dist < minDist) { target = { e, index }; minDist = dist; }
        });

        if (target) {
            if (Math.hypot(target.e.x - p.x, target.e.y - p.y) < 150) {
                this.gather(target.e, target.index);
            } else {
                this.log("距离太远");
            }
        }
    }
    
    // --- 新增：弓箭射击方法（改版：需要弹药）---
    shootBow(targetX, targetY) {
        const p = this.state.player;
        const tools = p.tools;
        const inv = p.inventory;
        
        if (!tools.bow || tools.bowDurability <= 0) {
            this.log("没有弓箭或弓箭已损坏！");
            return;
        }
        
        // 1. 检查弹药
        if ((inv.arrow || 0) <= 0) {
            this.log("没有箭矢了！需要制作 (树枝+燧石)", true);
            return;
        }
        
        // 计算射击距离和角度
        const distance = Math.hypot(targetX - p.x, targetY - p.y);
        const maxRange = 600; // 最大射程600像素
        
        if (distance > maxRange) {
            this.log(`射程太远！最大射程：${Math.floor(maxRange / 50)}格`);
            return;
        }
        
        // 计算射击角度
        const angle = Math.atan2(targetY - p.y, targetX - p.x);
        const projectileSpeed = 12; // 速度稍降（从15降到12）
        
        // 2. 消耗弹药
        inv.arrow--; 
        this.renderInventory();
        
        // 创建箭矢实体（削弱版）
        const arrow = {
            type: 'arrow',
            x: p.x,
            y: p.y,
            vx: Math.cos(angle) * projectileSpeed,
            vy: Math.sin(angle) * projectileSpeed,
            ttl: 120, // 射程缩短 (2秒，从180降到120)
            maxRange: maxRange, // 最大射程
            startX: p.x, // 起始位置
            startY: p.y,
            damage: 18, // 伤害降低 (从25降到18)
            id: Math.random().toString(36).slice(2),
            life: 1,
            maxLife: 1,
            dir: Math.cos(angle) > 0 ? 1 : -1,
            offset: 0,
            attackTimer: 0,
            growthTimer: 0,
            shooter: 'player' // 标记这是玩家射出的箭
        };
        
        this.state.entities.push(arrow);
        
        // 消耗弓箭耐久度（每次射击消耗1点，80点耐久度可以发射80次）
        tools.bowDurability--;
        if (tools.bowDurability <= 0) {
            tools.bow = false;
            tools.bowDurability = 0; // 确保不会变成负数
            this.log("弓箭损坏了！", true);
        }
    }

    initWorld() {
        this.state.entities = [];
        // 使用网格占用表避免重叠
        this.gridOccupied = new Set();
        
        // 初始化区块系统
        if (!this.state.chunks) {
            this.state.chunks = {};
        }
        if (this.state.baseX === undefined) {
            this.state.baseX = 0;
            this.state.baseY = 0;
            this.state.hasBase = false;
        }
        
        // 生成初始区块（玩家周围）
        this.loadChunksAroundPlayer();
        this.log("无限世界已生成。注意：黑暗中极其危险！");
    }
    
    // 网格坐标转换
    worldToGrid(x, y) {
        return {
            gx: Math.floor(x / TILE_SIZE),
            gy: Math.floor(y / TILE_SIZE)
        };
    }
    
    gridToWorld(gx, gy) {
        return {
            x: gx * TILE_SIZE + TILE_SIZE / 2,
            y: gy * TILE_SIZE + TILE_SIZE / 2
        };
    }
    
    // 世界坐标转区块坐标
    worldToChunk(x, y) {
        return {
            cx: Math.floor(x / (CHUNK_SIZE * TILE_SIZE)),
            cy: Math.floor(y / (CHUNK_SIZE * TILE_SIZE))
        };
    }
    
    getChunkKey(cx, cy) {
        return `${cx},${cy}`;
    }
    
    getGridKey(gx, gy) {
        return `${gx},${gy}`;
    }
    
    // 加载玩家周围的区块
    loadChunksAroundPlayer() {
        const p = this.state.player;
        const playerChunk = this.worldToChunk(p.x, p.y);
        const loadRange = 2; // 加载周围2个区块范围
        
        // 确保已生成区块的记录存在
        if (!this.state.chunks) {
            this.state.chunks = {};
        }
        
        // 遍历需要加载的区块
        for (let dx = -loadRange; dx <= loadRange; dx++) {
            for (let dy = -loadRange; dy <= loadRange; dy++) {
                const cx = playerChunk.cx + dx;
                const cy = playerChunk.cy + dy;
                const chunkKey = this.getChunkKey(cx, cy);
                
                // 如果区块未生成，则生成资源
                if (!this.state.chunks[chunkKey]) {
                    this.generateChunk(cx, cy);
                    this.state.chunks[chunkKey] = true;
                }
            }
        }
    }
    
    // 生成区块资源
    generateChunk(cx, cy) {
        // 每个区块生成一定数量的资源
        const baseX = cx * CHUNK_SIZE * TILE_SIZE;
        const baseY = cy * CHUNK_SIZE * TILE_SIZE;
        
        // 计算区块中心，在中心附近生成资源
        const centerX = baseX + (CHUNK_SIZE * TILE_SIZE) / 2;
        const centerY = baseY + (CHUNK_SIZE * TILE_SIZE) / 2;
        
        // 为每个区块生成资源（数量根据区块大小调整）
        const resourcesPerChunk = {
            tree: 8,
            rock: 5,
            bush: 4,
            grass: 6,
            flint: 3,
            stick: 5,
            rabbit: 1,
            spider: 0.8, // 新增：每个区块0.8只蜘蛛（平均每个区块不到1只）
            wolf: 0.5, // 每个区块0.5只狼（平均每两个区块一只）
            sheep: 0.6 // 每个区块约0.6只绵羊
        };
        
        // 在区块内生成资源
        for (let type in resourcesPerChunk) {
            const count = resourcesPerChunk[type];
            // 对于小数（如0.5, 0.8），使用概率生成
            if (count < 1) {
                if (Math.random() < count) {
                    // 按概率生成（蜘蛛、狼等）
                    const offsetX = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                    const offsetY = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                    this.spawnEntity(type, centerX + offsetX, centerY + offsetY);
                }
            } else {
                // 整数数量，直接生成
                for (let i = 0; i < count; i++) {
                    // 在区块范围内随机生成
                    const offsetX = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                    const offsetY = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                    this.spawnEntity(type, centerX + offsetX, centerY + offsetY);
                }
            }
        }
    }
    
    isGridOccupied(gx, gy) {
        if (!this.gridOccupied) this.gridOccupied = new Set();
        return this.gridOccupied.has(this.getGridKey(gx, gy));
    }
    
    // 检查多个格子是否被占用（用于树木等占多格的实体）
    isGridAreaOccupied(gx, gy, width = 1, height = 1) {
        for (let dx = 0; dx < width; dx++) {
            for (let dy = 0; dy < height; dy++) {
                if (this.isGridOccupied(gx + dx, gy + dy)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    occupyGrid(gx, gy) {
        if (!this.gridOccupied) this.gridOccupied = new Set();
        this.gridOccupied.add(this.getGridKey(gx, gy));
    }
    
    // 占用多个格子（用于树木等占多格的实体）
    occupyGridArea(gx, gy, width = 1, height = 1) {
        if (!this.gridOccupied) this.gridOccupied = new Set();
        for (let dx = 0; dx < width; dx++) {
            for (let dy = 0; dy < height; dy++) {
                this.gridOccupied.add(this.getGridKey(gx + dx, gy + dy));
            }
        }
    }
    
    freeGrid(gx, gy) {
        if (!this.gridOccupied) this.gridOccupied = new Set();
        this.gridOccupied.delete(this.getGridKey(gx, gy));
    }
    
    // 释放多个格子
    freeGridArea(gx, gy, width = 1, height = 1) {
        if (!this.gridOccupied) this.gridOccupied = new Set();
        for (let dx = 0; dx < width; dx++) {
            for (let dy = 0; dy < height; dy++) {
                this.gridOccupied.delete(this.getGridKey(gx + dx, gy + dy));
            }
        }
    }

    spawnEntity(type, x, y) {
        // 所有实体都需要网格对齐，确保整齐排列
        const needsGrid = ['campfire', 'tower', 'sapling', 'tree', 'rock', 'bush', 'flint', 'stick', 'grass', 'bed', 'beacon'];
        
        // 定义占用的格子大小（树木占2x2格）
        const gridSize = {
            'tree': { width: 2, height: 3 },
            'tower': { width: 2, height: 3 }, // 防御塔也占2x2
            'campfire': { width: 1, height: 1 },
            'bed': { width: 2, height: 2 },
            'beacon': { width: 2, height: 3 } // 灯塔占2x2格
        };
        
        const size = gridSize[type] || { width: 1, height: 1 };
        
        if (x === undefined) {
            // 随机生成位置 - 无限世界版本
            let gx, gy, attempts = 0;
            const maxAttempts = 200; // 增加尝试次数，因为树木需要更多空间
            
            if (needsGrid.includes(type)) {
                // 需要网格对齐且不重叠
                const playerChunk = this.worldToChunk(this.state.player.x, this.state.player.y);
                const chunkRange = 3;
                
                do {
                    // 在玩家周围的区块中随机选择
                    const chunkX = playerChunk.cx + Math.floor(Math.random() * (chunkRange * 2 + 1)) - chunkRange;
                    const chunkY = playerChunk.cy + Math.floor(Math.random() * (chunkRange * 2 + 1)) - chunkRange;
                    
                    // 在区块内随机选择格子（考虑实体大小）
                    gx = chunkX * CHUNK_SIZE + Math.floor(Math.random() * (CHUNK_SIZE - size.width + 1));
                    gy = chunkY * CHUNK_SIZE + Math.floor(Math.random() * (CHUNK_SIZE - size.height + 1));
                    attempts++;
                } while (this.isGridAreaOccupied(gx, gy, size.width, size.height) && attempts < maxAttempts);
                
                if (attempts >= maxAttempts) return false; // 找不到空位，放弃生成，返回false
                
                // 使用左上角格子计算世界坐标
                const pos = this.gridToWorld(gx, gy);
                // 对于占多格的实体，中心应该在占用区域的中心
                if (size.width > 1 || size.height > 1) {
                    const centerPos = this.gridToWorld(gx + (size.width - 1) / 2, gy + (size.height - 1) / 2);
                    x = centerPos.x;
                    y = centerPos.y;
                } else {
                    x = pos.x;
                    y = pos.y;
                }
                this.occupyGridArea(gx, gy, size.width, size.height);
            } else {
                // 其他实体：在玩家周围随机位置
                const range = CHUNK_SIZE * TILE_SIZE * 3;
                x = this.state.player.x + (Math.random() - 0.5) * range;
                y = this.state.player.y + (Math.random() - 0.5) * range;
        }
        } else {
            // 指定位置，如果需要网格对齐则对齐到最近网格
            if (needsGrid.includes(type)) {
                const grid = this.worldToGrid(x, y);
                // 检查整个区域是否被占用
                if (this.isGridAreaOccupied(grid.gx, grid.gy, size.width, size.height)) {
                    this.log("此处已有建筑！");
                    return false; // 返回false表示生成失败
                }
                // 使用左上角格子
                const pos = this.gridToWorld(grid.gx, grid.gy);
                // 对于占多格的实体，调整到中心
                if (size.width > 1 || size.height > 1) {
                    const centerPos = this.gridToWorld(grid.gx + (size.width - 1) / 2, grid.gy + (size.height - 1) / 2);
                    x = centerPos.x;
                    y = centerPos.y;
                } else {
                    x = pos.x;
                    y = pos.y;
                }
                this.occupyGridArea(grid.gx, grid.gy, size.width, size.height);
            }
        }
        
        let hp = 100;
        if(type === 'boss_wolf') hp = 1000;
        if(type === 'wolf') hp = 150; // 新增：普通狼血量
        if(type === 'nightling') hp = 60;
        if(type === 'tower') hp = 350;
        if(type === 'spider') hp = 20; // 蜘蛛血量：两击死亡（工具10伤害×2，弓箭25伤害只需1击，长矛30伤害只需1击）
        if(type === 'sheep') hp = 50;

        this.state.entities.push({
            type: type, x: x, y: y, 
            life: hp, maxLife: hp,
            id: Math.random().toString(36).slice(2, 11),
            offset: Math.random() * Math.PI * 2,
            dir: 1, attackTimer: 0,
            growthTimer: 0,
            isHostile: false, // 新增：用于标记中立生物是否被激怒
            range: type==='tower'?320:undefined,
            atk: type==='tower'?35:undefined,
            cooldown: 0,
            vx: 0, vy: 0, damage: 0, ttl: 0
        });
        
        return true; // 成功生成，返回true
    }

    loop() {
        this.update();
        this.draw();
        requestAnimationFrame(this.loop);
    }

    update() {
        // 如果游戏完全暂停（成就弹窗），不更新任何内容
        if (this.state.player.isPaused) return;
        
        const p = this.state.player;
        let speed = 5;
        let moved = false;

        // Weather effects on player movement - 增强影响
        const weather = this.state.weather.type;
        const weatherIntensity = this.state.weather.intensity || 1.0;
        if (weather === 'snow') {
            speed *= (0.65 - weatherIntensity * 0.1); // 雪天大幅减速：65%-55%
        } else if (weather === 'rain') {
            speed *= (0.85 - weatherIntensity * 0.1); // 雨天轻微减速：85%-75%
        } else if (weather === 'thunderstorm') {
            speed *= (0.70 - weatherIntensity * 0.1); // 雷暴大幅减速：70%-60%
        }
        
        // --- 理智值低于40时，移动速度降低 ---
        if (p.sanity < 40) {
            const sanityPenalty = (40 - p.sanity) / 40; // 0-1之间的惩罚系数
            speed *= (1 - sanityPenalty * 0.4); // 最多降低40%移动速度
        }

        // 移除边界限制，实现无限世界
        // 允许在打开面板时移动（只暂停游戏逻辑，不停移动）
        
        // 更新突进冷却时间
        if (p.dashCooldown > 0) {
            p.dashCooldown--;
        }
        
        // 处理突进功能（空格键）
        if (this.keys['Space'] && p.dashCooldown <= 0 && !p.isDashing) {
            // 计算突进方向（基于最后移动方向或玩家朝向）
            let dashX = 0, dashY = 0;
            if (this.keys['KeyW'] || this.keys['ArrowUp']) dashY = -1;
            if (this.keys['KeyS'] || this.keys['ArrowDown']) dashY = 1;
            if (this.keys['KeyA'] || this.keys['ArrowLeft']) dashX = -1;
            if (this.keys['KeyD'] || this.keys['ArrowRight']) dashX = 1;
            
            // 如果没有移动方向，使用玩家朝向
            if (dashX === 0 && dashY === 0) {
                dashX = p.dir;
            }
            
            // 归一化方向向量
            const length = Math.hypot(dashX, dashY);
            if (length > 0) {
                dashX /= length;
                dashY /= length;
            }
            
            // 设置突进动画参数
            const dashDistance = 100;
            p.isDashing = true;
            p.dashProgress = 0;
            p.dashStartX = p.x;
            p.dashStartY = p.y;
            p.dashTargetX = p.x + dashX * dashDistance;
            p.dashTargetY = p.y + dashY * dashDistance;
            p.dashDirection = { x: dashX, y: dashY };
            
            // 创建风粒子效果
            this.createWindEffect(p.x, p.y, -dashX, -dashY);
            
            // 设置冷却时间（2秒 = 120帧，60fps）
            p.dashCooldown = 120;
            
            // 防止连续触发
            this.keys['Space'] = false;
        }
        
        // 更新突进动画
        if (p.isDashing) {
            const dashDuration = 10; // 突进持续时间（10帧，约0.17秒）
            p.dashProgress += 1 / dashDuration;
            
            if (p.dashProgress >= 1) {
                // 突进完成
                p.x = p.dashTargetX;
                p.y = p.dashTargetY;
                p.isDashing = false;
                p.dashProgress = 0;
                // 视觉反馈：相机震动
                this.shakeCamera(3);
                this.log("突进！", false);
            } else {
                // 使用缓动函数实现平滑动画（ease-out）
                const easeOut = 1 - Math.pow(1 - p.dashProgress, 3);
                p.x = p.dashStartX + (p.dashTargetX - p.dashStartX) * easeOut;
                p.y = p.dashStartY + (p.dashTargetY - p.dashStartY) * easeOut;
                
                // 在突进过程中持续创建风粒子
                this.createWindEffect(p.x, p.y, -p.dashDirection.x, -p.dashDirection.y);
            }
        }
        
        if (this.keys['KeyW'] || this.keys['ArrowUp']) { p.y -= speed; moved = true; }
        if (this.keys['KeyS'] || this.keys['ArrowDown']) { p.y += speed; moved = true; }
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) { p.x -= speed; p.dir = -1; moved = true; }
        if (this.keys['KeyD'] || this.keys['ArrowRight']) { p.x += speed; p.dir = 1; moved = true; }
        
        // 动态加载区块
        this.loadChunksAroundPlayer();

        this.state.camera.x = p.x - this.width / 2;
        this.state.camera.y = p.y - this.height / 2;

        // 游戏逻辑继续运行，即使面板打开（只有成就弹窗会完全暂停）
        this.state.time++;
        
        const cycle = this.getCycle();
        const nightlings = this.state.entities.filter(e=>e.type==='nightling').length;
        
        // 根据天数动态调整夜怪数量和生成概率
        const day = this.state.day;
        const maxNightlings = Math.min(1 + Math.floor(day / 4), 5); // 第一天1只，随天数增加，上限5只（进一步减少）
        const spawnChance = Math.min(0.005 + (day * 0.0015), 0.02); // 第一天0.5%，随天数增加，上限2%（大幅降低生成频率）
        
        if(cycle==='night' && nightlings < maxNightlings && Math.random() < spawnChance) {
            const angle = Math.random() * Math.PI * 2;
            const r = 450 + Math.random()*100;
            this.spawnEntity('nightling', p.x + Math.cos(angle)*r, p.y + Math.sin(angle)*r);
        }
        if (this.state.day % 5 === 0 && cycle === 'night') {
            if (!this.state.isBloodMoon) {
                this.state.isBloodMoon = true;
                this.log("血月降临！狼王出现了！", true);
                const angle = Math.random() * Math.PI * 2;
                this.spawnEntity('boss_wolf', p.x + Math.cos(angle)*400, p.y + Math.sin(angle)*400);
                this.shakeCamera(20);
            }
        } else {
            this.state.isBloodMoon = false;
        }

        if (this.state.time >= DAY_LENGTH) {
            this.state.time = 0;
            this.state.day++;
            this.state.achievements.survivedDays++;
            this.state.achievements.maxDays = Math.max(this.state.achievements.maxDays, this.state.day);
            
            // --- 新增：三天内必须建造基地，否则迷失失败 ---
            if (this.state.day >= 3 && !this.state.hasBase) {
                const maxDays = this.state.achievements.maxDays;
                alert(`你迷失了...\n在荒野中游荡了3天，却始终没有找到家的方向。\n存活天数: ${this.state.day} 天\n最长存活记录: ${maxDays} 天`);
                this.clearSave();
                return;
            }
            
            // 第二天和第三天提示建造基地
            if (this.state.day === 2 && !this.state.hasBase) {
                this.log("警告：你还没有建立基地！第3天前必须建造床或灯塔，否则会迷失！", true);
            }
            
            this.checkAchievements();
            this.log(`第 ${this.state.day} 天`);
            this.respawnResources();
        }

        // 天气系统更新
        this.updateWeather();

        const hungerDrain = moved ? 0.015 : 0.005; 
        p.hunger = Math.max(0, p.hunger - hungerDrain);
        
        // --- 蜘蛛中毒debuff处理 ---
        if (this.state.spiderPoisonTimer > 0) {
            this.state.spiderPoisonTimer--;
            // 每秒掉3点理智（每60帧掉3点，即每帧掉0.05）
            p.sanity = Math.max(0, p.sanity - 0.05);
            // 每20帧提示一次（约0.33秒）
            if (this.state.spiderPoisonTimer % 20 === 0) {
                const secondsLeft = Math.ceil(this.state.spiderPoisonTimer / 60);
                if (secondsLeft > 0) {
                    this.log(`中毒中...理智持续下降 (剩余${secondsLeft}秒)`, true);
                }
            }
            // debuff结束后提示
            if (this.state.spiderPoisonTimer === 0) {
                this.log("毒素效果消失了");
            }
        }

        const nearFire = this.checkNearFire();
        const nearBase = this.checkNearBase();

        // --- 修正后的查理逻辑 ---
        if (cycle === 'night' && !nearFire) {
            // 在黑暗中累积时间
            this.state.darknessTimer++;
            
            // 视觉警告
            if (this.state.darknessTimer > 30) { // 0.5秒后开始警告
                if(this.state.time % 10 === 0) this.log("太黑了！要被攻击了！", true);
            }

            // 1.5秒后必被攻击 (90帧)
            if (this.state.darknessTimer > 90) {
                this.takeDamage(10); // 巨额伤害
                this.log("查理攻击了你！", true);
                this.shakeCamera(30);
                this.state.darknessTimer = 0; // 重置，如果不生火会继续挨打
            }
            
            // 黑暗中理智依然会掉
            p.sanity = Math.max(0, p.sanity - 0.1);
        } else {
            this.state.darknessTimer = 0; // 有光，重置计时器
            
            const weather = this.state.weather.type;
            
            // --- 新增：远离基地的理智衰减（白天和黄昏）---
            if (this.state.hasBase && !nearBase) {
                if (cycle === 'dusk') {
                    // 黄昏时远离基地，理智衰减（降低下降速度）
                    p.sanity = Math.max(0, p.sanity - 0.03); // 从0.05降低到0.03
                    if (this.state.time % 60 === 0) { // 每1秒提示一次
                        this.log("远离基地让你感到不安...", true);
                    }
                } else if (cycle === 'day' && weather === 'clear') {
                    // 晴天时远离基地，理智缓慢下降
                    p.sanity = Math.max(0, p.sanity - 0.01);
                    if (this.state.time % 120 === 0) { // 每2秒提示一次
                        this.log("远离基地让你感到孤独...");
                    }
                }
            }
            
            // --- 黄昏时既没有火也没有基地，理智缓慢下降（降低下降速度）---
            if (cycle === 'dusk' && !nearFire && !nearBase) {
                p.sanity = Math.max(0, p.sanity - 0.005); // 从0.01降低到0.005
            }
            
            // --- 理智值恢复：只有在靠近火或基地时才恢复 ---
            if (p.sanity < 100 && (nearFire || nearBase)) {
                p.sanity = Math.min(100, p.sanity + 0.08);
            }
            // 远离火和基地时，理智值不会自动回复
        }

        if (p.hunger <= 0) p.health -= 0.03;
        if (p.sanity <= 0) p.health -= 0.04;

        if (p.health <= 0) {
            const maxDays = this.state.achievements.maxDays;
            alert(`你死了。\n存活天数: ${this.state.day} 天\n最长存活记录: ${maxDays} 天`);
            this.clearSave();
        }

        // 实体更新
        this.state.entities.forEach((e, idx) => {
            if(e.type === 'campfire') {
                // 如果有保护装置(isProtected)，检查保护时间
                if (e.isProtected) {
                    // 初始化保护时间计时器（如果还没有）
                    if (e.protectionTimer === undefined) {
                        e.protectionTimer = 1800; // 30秒保护时间（1800帧）
                    }
                    
                    // 在保护时间内不掉耐久
                    if (e.protectionTimer > 0) {
                        e.protectionTimer--;
                    } else {
                        // 保护时间结束后，燃烧速度减半
                        e.life -= 0.012;
                    }
                } else {
                    // 没有保护装置，正常燃烧
                    e.life -= 0.025;
                }
                
                if(e.life <= 0) { 
                    const grid = this.worldToGrid(e.x, e.y);
                    this.freeGrid(grid.gx, grid.gy);
                    this.state.entities.splice(idx, 1); 
                    this.log("火灭了！", true); 
                }
            }
            else if (e.type === 'sheep') {
                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                if (dist < 120) {
                    // 玩家靠近时逃跑
                    const angle = Math.atan2(e.y - p.y, e.x - p.x);
                    e.x += Math.cos(angle) * 1.5; 
                    e.y += Math.sin(angle) * 1.5;
                    e.dir = Math.cos(angle)>0?1:-1;
                } else {
                    // 闲逛
                    if(Math.random() < 0.01) { 
                        e.vx=(Math.random()-0.5) * 0.5; 
                        e.vy=(Math.random()-0.5) * 0.5; 
                        e.dir=e.vx>0?1:-1; 
                    }
                    if(e.vx) { e.x+=e.vx; e.y+=e.vy; if(Math.random() < 0.02) e.vx=0; }
                }
            }
            else if (e.type === 'sapling') {
                // 树苗成长逻辑
                e.growthTimer++;
                if(e.growthTimer > 1200) { // 约20秒长成
                    // 先尝试生成树，如果成功再删除树苗
                    const success = this.spawnEntity('tree', e.x, e.y);
                    if (success) {
                        // 生成成功，删除树苗
                        const grid = this.worldToGrid(e.x, e.y);
                        this.freeGrid(grid.gx, grid.gy); // 释放树苗占用的网格
                        this.state.entities.splice(idx, 1);
                    } else {
                        // 生成失败（可能因为网格占用），保持当前状态，每帧都会尝试
                        // 不重置计时器，让它继续尝试，直到成功或周围空间被清理
                    }
                }
            }
            else if (e.type === 'rabbit') {
                const weather = this.state.weather.type;
                let speedMultiplier = 1.0;
                let activityMultiplier = 1.0;

                if (weather === 'rain' || weather === 'snow' || weather === 'thunderstorm') {
                    speedMultiplier = 0.5;
                    activityMultiplier = 0.3;
                } else if (weather === 'fog') {
                    speedMultiplier = 0.7;
                }

                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                if (dist < 150) {
                    const angle = Math.atan2(e.y - p.y, e.x - p.x);
                    e.x += Math.cos(angle) * 3.8 * speedMultiplier; 
                    e.y += Math.sin(angle) * 3.8 * speedMultiplier; 
                    e.dir = Math.cos(angle)>0?1:-1;
                } else {
                    if(Math.random() < 0.02 * activityMultiplier) { 
                        e.vx=(Math.random()-0.5) * 2 * speedMultiplier; 
                        e.vy=(Math.random()-0.5) * 2 * speedMultiplier; 
                        e.dir=e.vx>0?1:-1; 
                    }
                    if(e.vx) { 
                        e.x+=e.vx; e.y+=e.vy; 
                        if(Math.random() < 0.05) e.vx=0; 
                    }
                }
                    // 移除边界限制，允许在无限世界移动
                    // e.x = Math.max(0, Math.min(WORLD_SIZE*TILE_SIZE, e.x)); 
                    // e.y = Math.max(0, Math.min(WORLD_SIZE*TILE_SIZE, e.y));
            }
            else if (e.type === 'spider') {
                // 蜘蛛AI：类似兔子，中立生物，但被攻击后会反击
                const weather = this.state.weather.type;
                let speedMultiplier = 1.0;
                let activityMultiplier = 1.0;

                if (weather === 'rain' || weather === 'snow' || weather === 'thunderstorm') {
                    speedMultiplier = 0.4;
                    activityMultiplier = 0.2;
                } else if (weather === 'fog') {
                    speedMultiplier = 0.6;
                }

                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                
                // 如果玩家在附近且蜘蛛已受伤，反击玩家
                if (dist < 80 && e.life < e.maxLife) {
                    // 被攻击后反击
                    e.attackTimer = (e.attackTimer || 0) + 1;
                    if (e.attackTimer > 30) { // 每0.5秒攻击一次
                        // 蜘蛛反击：造成中毒debuff
                        this.state.spiderPoisonTimer = 300; // 5秒 = 300帧
                        this.state.lastKilledByBow = false; // 标记不是弓箭击杀
                        p.sanity = Math.max(0, p.sanity - 3); // 立即扣3点理智
                        this.log("蜘蛛咬了你！你中毒了！", true);
                        this.shakeCamera(3);
                        e.attackTimer = 0;
                    }
                    // 追向玩家
                    const angle = Math.atan2(p.y - e.y, p.x - e.x);
                    e.x += Math.cos(angle) * 2.8 * speedMultiplier;
                    e.y += Math.sin(angle) * 2.8 * speedMultiplier;
                    e.dir = Math.cos(angle)>0?1:-1;
                } else if (dist < 120) {
                    // 正常时逃离玩家
                    const angle = Math.atan2(e.y - p.y, e.x - p.x);
                    e.x += Math.cos(angle) * 2.5 * speedMultiplier; 
                    e.y += Math.sin(angle) * 2.5 * speedMultiplier; 
                    e.dir = Math.cos(angle)>0?1:-1;
                } else {
                    // 游荡
                    if(Math.random() < 0.015 * activityMultiplier) { 
                        e.vx=(Math.random()-0.5) * 1.5 * speedMultiplier; 
                        e.vy=(Math.random()-0.5) * 1.5 * speedMultiplier; 
                        e.dir=e.vx>0?1:-1; 
                    }
                    if(e.vx) { 
                        e.x+=e.vx; e.y+=e.vy; 
                        if(Math.random() < 0.04) e.vx=0; 
                    }
                }
            }
            else if (e.type === 'wolf') {
                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                
                // AI逻辑：如果被激怒(isHostile)则追击，否则游荡
                if (e.isHostile) {
                    // 追击模式
                    const angle = Math.atan2(p.y - e.y, p.x - e.x);
                    e.vx = Math.cos(angle) * 3.8; // 速度稍快
                    e.vy = Math.sin(angle) * 3.8;
                    e.x += e.vx; e.y += e.vy; e.dir = Math.cos(angle)>0?1:-1;
                    
                    // 攻击玩家
                    if (dist < 50) {
                        e.attackTimer++;
                        if (e.attackTimer > 40) { // 攻速
                            this.takeDamage(15); // 伤害
                            this.log("被狼咬伤！", true);
                            e.attackTimer = 0; 
                        }
                    }
                } else {
                    // 中立游荡模式
                    if(Math.random() < 0.01) { 
                        e.vx=(Math.random()-0.5) * 1.5; 
                        e.vy=(Math.random()-0.5) * 1.5; 
                        e.dir=e.vx>0?1:-1; 
                    }
                    e.x += e.vx; e.y += e.vy;
                    
                    // 稍微避让玩家（保持距离）
                    if (dist < 80) {
                        const angle = Math.atan2(e.y - p.y, e.x - p.x);
                        e.x += Math.cos(angle) * 1;
                        e.y += Math.sin(angle) * 1;
                    }
                }
            }
            else if (e.type === 'nightling') {
                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                const angle = Math.atan2(p.y - e.y, p.x - e.x);
                // 更新速度向量，供防御塔预判
                e.vx = Math.cos(angle) * 2.6;
                e.vy = Math.sin(angle) * 2.6;
                e.x += e.vx; e.y += e.vy; e.dir = Math.cos(angle)>0?1:-1;
                if (dist < 55) {
                    e.attackTimer++;
                    if (e.attackTimer > 50) { this.takeDamage(8); e.attackTimer = 0; }
                }
                if (this.getCycle() !== 'night') { this.state.entities.splice(idx, 1); }
            }
            else if (e.type === 'boss_wolf') {
                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                const angle = Math.atan2(p.y - e.y, p.x - e.x);
                // 更新速度向量 - 降低移动速度
                e.vx = Math.cos(angle) * 1.8;  // 从3.2降低到1.8
                e.vy = Math.sin(angle) * 1.8;
                e.x += e.vx; e.y += e.vy; e.dir = Math.cos(angle)>0?1:-1;
                if (dist < 60) {
                    e.attackTimer++;
                    if (e.attackTimer > 60) { this.takeDamage(25); this.log("狼王撕咬！", true); e.attackTimer = 0; }  // 攻击力从15增加到25
                }
                if (this.getCycle() !== 'night') { this.state.entities.splice(idx, 1); this.log("狼王消失了。"); }
            }
            else if (e.type === 'tower') {
                e.cooldown = Math.max(0, e.cooldown - 1);
                // 防御塔攻击所有敌对生物：夜怪、狼王、以及被激怒的狼
                const targets = this.state.entities.filter(t => 
                    t.type==='nightling' || 
                    t.type==='boss_wolf' || 
                    (t.type==='wolf' && t.isHostile)
                );
                let nearest = null, dmin = Infinity;
                
                // 动态计算射程，受天气影响
                let currentRange = e.range || 320;
                if (this.state.weather.type === 'fog') {
                    currentRange *= (0.7 + 0.3 * (1 - this.state.weather.intensity));
                }

                targets.forEach(t => {
                    const d = Math.hypot(t.x - e.x, t.y - e.y);
                    if (d < dmin && d < currentRange) { dmin = d; nearest = t; }
                });
                if (nearest && e.cooldown === 0) {
                    // 计算精准射击角度，考虑目标移动
                    const targetVelX = nearest.vx || 0;
                    const targetVelY = nearest.vy || 0;
                    const distance = dmin;
                    const projectileSpeed = 12; // 增加箭矢速度
                    const predictionTime = distance / projectileSpeed;
                    
                    const predictedX = nearest.x + targetVelX * predictionTime * 0.5; // 半预测，平衡精度和自然感
                    const predictedY = nearest.y + targetVelY * predictionTime * 0.5;
                    
                    const ang = Math.atan2(predictedY - e.y, predictedX - e.x);
                    
                    const proj = { 
                        type:'arrow', 
                        x:e.x, 
                        y:e.y, 
                        vx:Math.cos(ang)*projectileSpeed, 
                        vy:Math.sin(ang)*projectileSpeed, 
                        ttl:120, // 增加箭矢持续时间
                        damage:e.atk||35, // 增加伤害
                        id:Math.random().toString(36).slice(2), 
                        life:1, 
                        maxLife:1, 
                        dir:1, 
                        offset:0, 
                        attackTimer:0, 
                        growthTimer:0 
                    };
                    this.state.entities.push(proj);
                    e.cooldown = 25; // 减少冷却时间
                }
            }
            else if (e.type === 'arrow') {
                e.ttl--; 
                // 检查是否超过最大射程
                if (e.ttl <= 0 || (e.maxRange && e.startX !== undefined && e.startY !== undefined && Math.hypot(e.x - e.startX, e.y - e.startY) > e.maxRange)) { 
                    this.state.entities.splice(idx,1); 
                    return; 
                }
                e.x += e.vx; e.y += e.vy;
                // 检查是否击中任何可攻击的实体（包括蜘蛛、兔子、狼、绵羊等）
                const hitIdx = this.state.entities.findIndex(t => {
                    if (t === e) return false; // 不击中自己
                    const dist = Math.hypot(t.x - e.x, t.y - e.y);
                    return dist < 16 && (
                        t.type === 'nightling' || 
                        t.type === 'boss_wolf' || 
                        t.type === 'wolf' || // 修复：弓箭可以攻击所有狼，不管是否被激怒
                        t.type === 'spider' ||
                        t.type === 'rabbit' ||
                        t.type === 'sheep' // 修复：弓箭可以攻击绵羊
                    );
                });
                if (hitIdx >= 0) {
                    const t = this.state.entities[hitIdx];
                    const p = this.state.player;
                    t.life -= e.damage;
                    
                    // 新增：创建血滴特效
                    this.createBloodEffect(t.x, t.y);
                    
                    if (t.life <= 0) {
                        // 根据武器类型决定理智值下降（弓箭降低理智值下降）
                        const isPlayerArrow = e.shooter === 'player';
                        let sanityLoss = 0;
                        
                        if (t.type === 'nightling') { 
                            this.state.entities.splice(hitIdx,1); 
                            this.state.player.inventory.rottenmeat = (this.state.player.inventory.rottenmeat || 0) + 1;
                            this.state.achievements.killedNightlings++;
                        } else if (t.type === 'boss_wolf') { 
                            this.state.entities.splice(hitIdx,1); 
                            this.state.player.inventory.bigmeat++; 
                            this.state.player.inventory.gold += 2; 
                            this.state.achievements.killedBossWolves++;
                            if (isPlayerArrow) {
                                sanityLoss = 10; // 弓箭击杀狼王理智下降较少
                            }
                            this.log(isPlayerArrow ? "弓箭击杀狼王！获得大肉&金块！" : "防御塔击杀狼王！", false); 
                        } else if (t.type === 'wolf') {
                            if (t.gx !== undefined) this.freeArea(t.gx, t.gy, t.w || 1, t.h || 1);
                            this.state.entities.splice(hitIdx,1); 
                            this.state.player.inventory.meat += 2;
                            if (!this.state.achievements.killedWolves) this.state.achievements.killedWolves = 0;
                            this.state.achievements.killedWolves++;
                            this.state.achievements.totalMeat += 2;
                            if (isPlayerArrow) {
                                sanityLoss = 15; // 弓箭击杀狼理智下降较少
                            }
                            this.log(isPlayerArrow ? "弓箭击杀狼：获得小肉x2" : "防御塔击杀狼！获得小肉x2");
                        } else if (t.type === 'spider') {
                            this.state.entities.splice(hitIdx,1);
                            this.state.player.inventory.spiderSilk = (this.state.player.inventory.spiderSilk || 0) + 2;
                            sanityLoss = 3; // 弓箭击杀蜘蛛理智下降最少
                            this.state.lastKilledByBow = true; // 标记是弓箭击杀
                            
                            // 如果弓箭击杀，且已有中毒debuff，减少中毒时间
                            if (isPlayerArrow && this.state.spiderPoisonTimer > 0) {
                                this.state.spiderPoisonTimer = Math.floor(this.state.spiderPoisonTimer / 2);
                                this.log("弓箭击杀蜘蛛：获得蜘蛛丝x2 (远距离击杀让毒素减轻了)");
                            } else {
                                this.log("弓箭击杀蜘蛛：获得蜘蛛丝x2");
                            }
                        } else if (t.type === 'rabbit') {
                            this.state.entities.splice(hitIdx,1);
                            this.state.player.inventory.meat++;
                            this.state.achievements.totalMeat++;
                            sanityLoss = 5; // 弓箭击杀兔子理智下降较少
                            this.log("弓箭击杀兔子：获得小肉x1");
                        } else if (t.type === 'sheep') {
                            // 箭矢击中绵羊的处理
                            const inv = this.state.player.inventory;
                            this.state.entities.splice(hitIdx,1);
                            inv.meat += 2; 
                            inv.fat = (inv.fat || 0) + 1; // 必掉羊油
                            inv.wool = (inv.wool || 0) + 2; // 必掉羊毛
                            sanityLoss = 8; // 弓箭击杀绵羊理智下降
                            this.log("弓箭击杀绵羊：获得肉x2, 羊油x1, 羊毛x2");
                        }
                        
                        if (isPlayerArrow && sanityLoss > 0) {
                            p.sanity = Math.max(0, p.sanity - sanityLoss);
                        }
                        
                        this.checkAchievements();
                    }
                    this.state.entities.splice(idx,1);
                }
            }
        });

        // 更新血滴粒子
        this.updateBloodParticles();
        
        // 更新风粒子
        this.updateWindParticles();

        this.updateUI();
    }

    // --- 新增：创建血滴特效 ---
    createBloodEffect(x, y) {
        // 创建5-8个血滴粒子
        const count = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            this.bloodParticles.push({
                x: x + (Math.random() - 0.5) * 20,
                y: y + (Math.random() - 0.5) * 20,
                vx: (Math.random() - 0.5) * 3,
                vy: (Math.random() - 0.5) * 3 - 1, // 向上飞溅
                life: 30 + Math.floor(Math.random() * 20), // 30-50帧生命周期
                maxLife: 30 + Math.floor(Math.random() * 20),
                size: 3 + Math.random() * 3 // 3-6像素大小
            });
        }
    }
    
    // --- 新增：更新血滴粒子 ---
    updateBloodParticles() {
        for (let i = this.bloodParticles.length - 1; i >= 0; i--) {
            const p = this.bloodParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.2; // 重力效果
            p.life--;
            
            if (p.life <= 0) {
                this.bloodParticles.splice(i, 1);
            }
        }
    }
    
    // --- 新增：创建风粒子效果 ---
    createWindEffect(x, y, dirX, dirY) {
        // 在玩家身后创建风粒子
        const particleCount = 8;
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 0.8; // 稍微随机角度
            const speed = 2 + Math.random() * 3;
            const offsetX = (Math.random() - 0.5) * 30;
            const offsetY = (Math.random() - 0.5) * 30;
            
            this.windParticles.push({
                x: x + offsetX,
                y: y + offsetY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 15 + Math.floor(Math.random() * 10), // 15-25帧生命周期
                maxLife: 15 + Math.floor(Math.random() * 10),
                size: 2 + Math.random() * 3, // 2-5像素大小
                alpha: 0.6 + Math.random() * 0.4 // 0.6-1.0透明度
            });
        }
    }
    
    // --- 新增：更新风粒子 ---
    updateWindParticles() {
        for (let i = this.windParticles.length - 1; i >= 0; i--) {
            const p = this.windParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.95; // 逐渐减速
            p.vy *= 0.95;
            p.life--;
            
            if (p.life <= 0) {
                this.windParticles.splice(i, 1);
            }
        }
    }

    respawnResources() {
        const p = this.state.player;
        const entities = this.state.entities;
        
        // 统计当前各种资源的数量
        const counts = {
            tree: entities.filter(e => e.type === 'tree').length,
            rock: entities.filter(e => e.type === 'rock').length,
            bush: entities.filter(e => e.type === 'bush').length,
            grass: entities.filter(e => e.type === 'grass').length,
            flint: entities.filter(e => e.type === 'flint').length,
            stick: entities.filter(e => e.type === 'stick').length,
            rabbit: entities.filter(e => e.type === 'rabbit').length
        };
        
        // 定义每种资源的目标数量和最大数量
        const targets = {
            tree: 80,    // 目标数量
            rock: 50,
            bush: 40,
            grass: 70,
            flint: 40,
            stick: 50,
            rabbit: 15
        };
        
        const maxCounts = {
            tree: 120,
            rock: 80,
            bush: 60,
            grass: 100,
            flint: 60,
            stick: 80,
            rabbit: 25
        };
        
        // 智能刷新：只在资源不足时刷新，并在玩家附近区域刷新
        const refreshRadius = 800; // 刷新半径（玩家附近）
        const refreshTypes = ['tree', 'rock', 'bush', 'grass', 'flint', 'stick', 'rabbit', 'wolf'];
        
        refreshTypes.forEach(type => {
            const current = counts[type];
            const target = targets[type];
            const max = maxCounts[type];
            
            // 如果当前数量低于目标，且未达到最大数量
            if (current < target && current < max) {
                const need = Math.min(target - current, max - current);
                const refreshCount = Math.ceil(need * 0.3); // 每次刷新30%的缺口
                
                for (let i = 0; i < refreshCount; i++) {
                    // 在玩家附近随机位置刷新
                    const angle = Math.random() * Math.PI * 2;
                    const distance = 200 + Math.random() * refreshRadius;
                    const spawnX = p.x + Math.cos(angle) * distance;
                    const spawnY = p.y + Math.sin(angle) * distance;
                    
                    // 确保在边界内
                    // 无限世界，不需要边界限制
                    const validX = spawnX;
                    const validY = spawnY;
                    
                    this.spawnEntity(type, validX, validY);
                }
            }
        });
    }

    // interact() 方法已删除，改为dash功能

    // 新增：受伤处理方法（支持护甲减伤）
    takeDamage(amount) {
        const p = this.state.player;
        let finalDamage = amount;
        
        // 护甲减伤逻辑
        if (p.tools.armor && p.tools.armorDurability > 0) {
            finalDamage = Math.floor(amount * 0.6); // 减伤40%
            p.tools.armorDurability -= 1; // 消耗耐久
            
            if (p.tools.armorDurability <= 0) {
                p.tools.armor = false;
                this.log("编织护甲破碎了！", true);
            }
        }
        
        p.health -= finalDamage;
        this.shakeCamera(5);
    }

    gather(entity, index) {
        const p = this.state.player;
        const inv = p.inventory;
        const tools = p.tools;

        // 伤害计算：长矛30，弓箭25（远程），工具10，空手5
        let damage = 5;
        let toolUsed = null;
        
        // 如果是火堆、床、灯塔等可交互建筑，不需要武器，直接处理
        if (entity.type === 'campfire' || entity.type === 'bed' || entity.type === 'beacon' || entity.type === 'tower') {
            // 这些建筑不需要武器，直接处理
        } else if (tools.spear && tools.spearDurability > 0) {
            damage = 30;
            toolUsed = 'spear';
        } else if (tools.bow && tools.bowDurability > 0) {
            // 弓箭不能近战攻击，需要通过射击
            // 但只有在没有其他工具时才提示
            if (!tools.spear && !tools.axe && !tools.pickaxe) {
                return this.log("弓箭需要远程射击！右键点击目标");
            }
            // 如果有其他工具，使用其他工具
            if (tools.axe && tools.axeDurability > 0) {
                damage = 10;
                toolUsed = 'axe';
            } else if (tools.pickaxe && tools.pickaxeDurability > 0) {
                damage = 10;
                toolUsed = 'pickaxe';
            }
        } else if (tools.axe && tools.axeDurability > 0) {
            damage = 10;
            toolUsed = 'axe';
        } else if (tools.pickaxe && tools.pickaxeDurability > 0) {
            damage = 10;
            toolUsed = 'pickaxe';
        }
        
        // 如果工具耐久度为0，视为没有工具
        if (toolUsed && tools[toolUsed + 'Durability'] <= 0) {
            toolUsed = null;
            damage = 5;
        }
        
        // --- 理智值低于40时，攻击伤害降低 ---
        if (p.sanity < 40) {
            const sanityPenalty = (40 - p.sanity) / 40; // 0-1之间的惩罚系数
            damage = Math.floor(damage * (1 - sanityPenalty * 0.3)); // 最多降低30%伤害
        }

        if (entity.type === 'boss_wolf') {
            entity.life -= damage;
            // 新增：创建血滴特效
            this.createBloodEffect(entity.x, entity.y);
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 30; entity.y += Math.sin(angle) * 30;
            this.shakeCamera(5);
            if (entity.life <= 0) {
                this.state.entities.splice(index, 1); 
                inv.bigmeat++; 
                inv.gold+=2; 
                this.state.achievements.killedBossWolves++;
                this.state.achievements.totalGold += 2;
                this.state.achievements.totalMeat++;
                this.checkAchievements();
                this.log("击杀狼王！获得大肉&金块！", false);
                
                // 如果使用长矛，消耗耐久
                if (toolUsed === 'spear') {
                    p.tools.spearDurability -= 5; // 狼王消耗更多耐久
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
            } else {
                // 攻击时消耗耐久
                if (toolUsed === 'spear') {
                    p.tools.spearDurability--;
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
                this.log(tools.spear ? "长矛刺击！" : "攻击力太低了！建议造长矛！");
            }
            return;
        }
        if (entity.type === 'nightling') {
            entity.life -= damage;
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 20; entity.y += Math.sin(angle) * 20;
            if (entity.life <= 0) { 
                this.state.entities.splice(index, 1); 
                inv.rottenmeat = (inv.rottenmeat || 0) + 1; // 改为掉落腐肉
                this.state.achievements.killedNightlings++;
                this.checkAchievements();
                this.log("击杀夜怪：获得腐肉 (有毒)"); 
                
                // 如果使用长矛，消耗耐久
                if (toolUsed === 'spear') {
                    p.tools.spearDurability--;
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
            }
            return;
        }
        
        // --- 新增：狼 (Wolf) 的战斗逻辑 ---
        if (entity.type === 'wolf') {
            entity.life -= damage;
            // 新增：创建血滴特效
            this.createBloodEffect(entity.x, entity.y);
            entity.isHostile = true; // 重点：攻击后变敌对
            
            // 击退效果
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 15; entity.y += Math.sin(angle) * 15;
            
            if (entity.life <= 0) {
                // 释放网格占用（如果有）
                if (entity.gx !== undefined) this.freeArea(entity.gx, entity.gy, entity.w || 1, entity.h || 1);
                
                this.state.entities.splice(index, 1);
                inv.meat += 2; // 掉落2块肉
                
                // 成就统计
                this.state.achievements.totalMeat += 2;
                if (!this.state.achievements.killedWolves) this.state.achievements.killedWolves = 0;
                this.state.achievements.killedWolves++;
                this.checkAchievements();
                
                // 惩罚：击杀中立生物扣理智 - 根据武器类型决定
                let sanityLoss = 25; // 默认徒手或工具
                if (toolUsed === 'spear') {
                    sanityLoss = 20; // 长矛稍低
                } else if (toolUsed === 'bow') {
                    sanityLoss = 15; // 弓箭最低（距离远，看不清楚）
                }
                p.sanity = Math.max(0, p.sanity - sanityLoss); 
                this.log(toolUsed === 'bow' ? "弓箭击杀狼：获得小肉x2 (理智 -15)" : "击杀狼：获得小肉x2 (理智 -" + sanityLoss + ")", true);
                this.shakeCamera(5);
                
                // 工具耐久消耗逻辑
                if (toolUsed === 'spear') {
                    p.tools.spearDurability--;
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
            } else {
                this.log("你激怒了这只狼！", true);
            }
            return;
        }

        // --- 修改：夜怪 (Nightling) 掉落改为腐肉 ---
        if (entity.type === 'nightling') {
            entity.life -= damage;
            // 新增：创建血滴特效
            this.createBloodEffect(entity.x, entity.y);
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 20; entity.y += Math.sin(angle) * 20;
            if (entity.life <= 0) { 
                this.state.entities.splice(index, 1); 
                inv.rottenmeat++; // 修改：掉落腐肉
                this.state.achievements.killedNightlings++;
                this.checkAchievements();
                this.log("击杀夜怪：获得腐肉 (有毒)"); // 修改提示
                
                if (toolUsed === 'spear') {
                    p.tools.spearDurability--;
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
            }
            return;
        }
        
        // --- 修改：兔子 (Rabbit) 击杀扣理智 ---
        if (entity.type === 'rabbit') {
            this.state.entities.splice(index, 1); 
            inv.meat++; 
            
            // 新增：杀害弱小生物扣理智 - 根据使用的武器决定扣理智值
            let sanityLoss = 10; // 默认徒手或工具
            if (toolUsed === 'spear') {
                sanityLoss = 8; // 长矛稍低
            } else if (toolUsed === 'bow') {
                sanityLoss = 5; // 弓箭最低（距离远，看不清楚）
            }
            p.sanity = Math.max(0, p.sanity - sanityLoss); 
            this.state.achievements.totalMeat++;
            this.checkAchievements();
            this.log(toolUsed === 'bow' ? "射杀兔子 (理智 -5)" : "猎杀兔子 (理智 -" + sanityLoss + ")");
            return;
        }
        
        // --- 新增：绵羊 (Sheep) 战斗逻辑 ---
        if (entity.type === 'sheep') {
            entity.life -= damage;
            this.createBloodEffect(entity.x, entity.y);
            // 击退
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 12; entity.y += Math.sin(angle) * 12;
            if (entity.life <= 0) {
                this.state.entities.splice(index, 1);
                inv.meat += 2; 
                inv.fat = (inv.fat || 0) + 1; // 必掉羊油
                inv.wool = (inv.wool || 0) + 2; // 必掉羊毛
                // 击杀绵羊扣理智值
                let sanityLoss = 10; // 默认徒手或工具
                if (toolUsed === 'spear') {
                    sanityLoss = 8; // 长矛稍低
                } else if (toolUsed === 'bow') {
                    sanityLoss = 8; // 弓箭（已在箭矢击中逻辑中处理）
                }
                p.sanity = Math.max(0, p.sanity - sanityLoss);
                this.log(toolUsed === 'bow' ? "击杀绵羊：获得肉x2, 羊油x1, 羊毛x2 (理智 -8)" : "击杀绵羊：获得肉x2, 羊油x1, 羊毛x2 (理智 -" + sanityLoss + ")");
            }
            return;
        }
        
        // --- 新增：蜘蛛 (Spider) 战斗逻辑 ---
        if (entity.type === 'spider') {
            entity.life -= damage;
            // 新增：创建血滴特效
            this.createBloodEffect(entity.x, entity.y);
            const angle = Math.atan2(entity.y - p.y, entity.x - p.x);
            entity.x += Math.cos(angle) * 10; entity.y += Math.sin(angle) * 10;
            
            if (entity.life <= 0) {
                // 蜘蛛被击杀
                this.state.entities.splice(index, 1);
                inv.spiderSilk = (inv.spiderSilk || 0) + 2; // 掉落2个蜘蛛丝
                
                // 击杀蜘蛛扣理智 - 根据使用的武器决定扣理智值
                let sanityLoss = 8; // 默认徒手或工具
                if (toolUsed === 'spear') {
                    sanityLoss = 6;
                } else if (toolUsed === 'bow') {
                    sanityLoss = 3; // 弓箭最低（距离远，看不清楚）
                    this.state.lastKilledByBow = true; // 标记是弓箭击杀
                }
                p.sanity = Math.max(0, p.sanity - sanityLoss);
                this.log(toolUsed === 'bow' ? "射杀蜘蛛：获得蜘蛛丝x2 (理智 -3)" : "击杀蜘蛛：获得蜘蛛丝x2 (理智 -" + sanityLoss + ")");
                
                // 如果弓箭击杀，中毒debuff减少
                if (toolUsed === 'bow' && this.state.spiderPoisonTimer > 0) {
                    // 弓箭击杀可以减少中毒时间（减半）
                    this.state.spiderPoisonTimer = Math.floor(this.state.spiderPoisonTimer / 2);
                    this.log("远距离击杀让毒素减轻了", false);
                }
                
                // 工具耐久消耗
                if (toolUsed === 'spear') {
                    p.tools.spearDurability--;
                    if (p.tools.spearDurability <= 0) {
                        p.tools.spear = false;
                        this.log("长矛损坏了！", true);
                    }
                }
            } else {
                // 蜘蛛被攻击但未死，反击玩家
                this.log("攻击蜘蛛！", false);
                // 如果被攻击，蜘蛛会反击（在update中处理）
            }
            return;
        }

        switch(entity.type) {
            case 'stick': 
                const stickGrid = this.worldToGrid(entity.x, entity.y);
                this.freeGrid(stickGrid.gx, stickGrid.gy);
                this.state.entities.splice(index, 1); inv.twig++; this.log("拾取: 树枝"); 
                break;
            case 'flint': 
                const flintGrid = this.worldToGrid(entity.x, entity.y);
                this.freeGrid(flintGrid.gx, flintGrid.gy);
                this.state.entities.splice(index, 1); inv.flint++; this.log("拾取: 燧石"); 
                break;
            case 'grass': 
                const grassGrid = this.worldToGrid(entity.x, entity.y);
                this.freeGrid(grassGrid.gx, grassGrid.gy);
                this.state.entities.splice(index, 1); inv.grass++; this.log("拾取: 干草"); 
                break;
            case 'bush': 
                const bushGrid = this.worldToGrid(entity.x, entity.y);
                this.freeGrid(bushGrid.gx, bushGrid.gy);
                this.state.entities.splice(index, 1); inv.berry++; this.log("采集: 浆果"); 
                break;
            case 'sapling': this.log("它还在生长..."); break; // 不能采集树苗
            case 'tree': 
                if(!p.tools.axe || p.tools.axeDurability <= 0) return this.log("需要斧头");
                // --- 理智值低于40时，砍树速度降低 ---
                let treeDamage = 25;
                if (p.sanity < 40) {
                    const sanityPenalty = (40 - p.sanity) / 40;
                    treeDamage = Math.floor(25 * (1 - sanityPenalty * 0.3)); // 最多降低30%效率
                }
                entity.life -= treeDamage; 
                if(entity.life <= 0) { 
                    const treeGrid = this.worldToGrid(entity.x, entity.y);
                    this.freeGrid(treeGrid.gx, treeGrid.gy);
                    this.state.entities.splice(index, 1); inv.wood += 3; 
                    inv.pinecone += 1; // 必掉松果
                    if(Math.random()>0.6) inv.twig++;
                    
                    // 消耗工具耐久（每次砍树消耗2点）
                    p.tools.axeDurability -= 2;
                    if (p.tools.axeDurability <= 0) {
                        p.tools.axe = false;
                        this.log("斧头损坏了！", true);
                    }
                    
                    this.state.achievements.totalWood += 3;
                    this.checkAchievements();
                    this.log("获得: 木材 & 松果");
                }
                break;
            case 'rock':
                if(!p.tools.pickaxe || p.tools.pickaxeDurability <= 0) return this.log("需要矿镐");
                // --- 理智值低于40时，挖矿速度降低 ---
                let rockDamage = 25;
                if (p.sanity < 40) {
                    const sanityPenalty = (40 - p.sanity) / 40;
                    rockDamage = Math.floor(25 * (1 - sanityPenalty * 0.3)); // 最多降低30%效率
                }
                entity.life -= rockDamage;
                if(entity.life <= 0) { 
                    const rockGrid = this.worldToGrid(entity.x, entity.y);
                    this.freeGrid(rockGrid.gx, rockGrid.gy);
                    this.state.entities.splice(index, 1); inv.stone += 2; inv.flint += 1; 
                    
                    // 消耗工具耐久（每次挖矿消耗2点）
                    p.tools.pickaxeDurability -= 2;
                    if (p.tools.pickaxeDurability <= 0) {
                        p.tools.pickaxe = false;
                        this.log("矿镐损坏了！", true);
                    }
                    
                    if (Math.random() > 0.7) { // 30% 几率掉金块
                        inv.gold += 1;
                        this.state.achievements.totalGold++;
                        this.checkAchievements();
                        this.log("获得: 石头 & 金块✨");
                    } else {
                        this.log("获得: 石头");
                    }
                    this.state.achievements.totalStone += 2;
                    this.checkAchievements();
                }
                break;
            case 'campfire':
                if(inv.wood > 0) { entity.life = Math.min(100, entity.life+40); inv.wood--; this.log("添加燃料(木材)"); }
                else if (inv.grass > 0) { entity.life = Math.min(100, entity.life+15); inv.grass--; this.log("添加燃料(干草)"); }
                else if (inv.twig > 0) { entity.life = Math.min(100, entity.life+10); inv.twig--; this.log("添加燃料(树枝)"); }
                else this.log("没有燃料！");
                break;
        }
        this.renderInventory();
    }

    // 种植功能
    plantSapling() {
        const p = this.state.player;
        if (p.inventory.pinecone > 0) {
            p.inventory.pinecone--;
            // 在玩家脚下生成树苗
            this.spawnEntity('sapling', p.x, p.y + 20);
            this.state.achievements.plantedTrees++;
            this.checkAchievements();
            this.log("种植了松果 🌱");
            this.renderInventory();
        } else {
            this.log("没有松果！");
        }
    }

    craft(item) {
        const inv = this.state.player.inventory;
        const tools = this.state.player.tools;
        const achievements = this.state.achievements;
        
        if (item === 'axe') { 
            if (inv.twig >= 2 && inv.flint >= 2) { 
                inv.twig -= 2; inv.flint -= 2; 
                tools.axe = true; 
                tools.axeDurability = 30; // 斧头耐久度30（降低）
                this.log("制作: 斧头 (耐久: 30)"); 
            } 
        } 
        else if (item === 'pickaxe') { 
            if (inv.twig >= 2 && inv.flint >= 2) { 
                inv.twig -= 2; inv.flint -= 2; 
                tools.pickaxe = true; 
                tools.pickaxeDurability = 30; // 矿镐耐久度30（降低）
                this.log("制作: 矿镐 (耐久: 30)"); 
            } 
        } 
        else if (item === 'spear') { 
            if (inv.wood >= 1 && inv.gold >= 1) { 
                inv.wood -= 1; inv.gold -= 1; 
                tools.spear = true; 
                tools.spearDurability = 100; // 长矛耐久度100
                this.log("制作: 战斗长矛⚔️ (耐久: 100)"); 
            }
            else this.log("材料不足: 木材x1, 金块x1");
        }
        else if (item === 'bow') {
            if (inv.wood >= 2 && (inv.spiderSilk || 0) >= 3) {
                inv.wood -= 2;
                inv.spiderSilk -= 3;
                tools.bow = true;
                tools.bowDurability = 80; // 弓箭耐久度80
                this.log("制作: 弓箭🏹 (耐久: 80)");
            } else {
                this.log("材料不足: 木材x2, 蜘蛛丝x3");
            }
        }
        else if (item === 'campfire') { 
            if (inv.wood >= 3 && inv.stone >= 2) { 
                // 先尝试生成，成功后再扣除材料
                const success = this.spawnEntity('campfire', this.state.player.x + 50, this.state.player.y);
                if (success) {
                    inv.wood -= 3; inv.stone -= 2; 
                    achievements.builtCampfires++;
                    this.checkAchievements();
                    this.log("建造: 营火"); 
                } else {
                    // 生成失败，位置被占用，材料不扣除
                    this.log("建造失败：位置已被占用！请换个位置。", true);
                }
            } else {
                this.log("材料不足: 木材x3, 石头x2");
            }
        }
        else if (item === 'tower') {
            if (inv.wood >= 8 && inv.stone >= 6 && inv.gold >= 2) {
                // 先尝试生成，成功后再扣除材料
                const success = this.spawnEntity('tower', this.state.player.x + 60, this.state.player.y);
                if (success) {
                    inv.wood -= 8; inv.stone -= 6; inv.gold -= 2; 
                    achievements.builtTowers++;
                    this.checkAchievements();
                    this.log("建造: 防御塔");
                } else {
                    // 生成失败，位置被占用，材料不扣除
                    this.log("建造失败：位置已被占用！请换个位置。", true);
                }
            } else {
                this.log("材料不足: 木材x8, 石头x6, 金块x2");
            }
        }
        else if (item === 'bed') {
            if (inv.wood >= 6 && inv.grass >= 8) {
                // 先尝试生成，成功后再扣除材料
                const success = this.spawnEntity('bed', this.state.player.x + 60, this.state.player.y);
                if (success) {
                    inv.wood -= 6; inv.grass -= 8;
                    // 设置基地位置
                    this.state.baseX = this.state.player.x + 60;
                    this.state.baseY = this.state.player.y;
                    this.state.hasBase = true;
                    this.log("建造: 床 🛏️ (基地标记)");
                } else {
                    // 生成失败，位置被占用，材料不扣除
                    this.log("建造失败：位置已被占用！请换个位置。", true);
                }
            } else {
                this.log("材料不足: 木材x6, 干草x8");
            }
        }
        else if (item === 'beacon') {
            if (inv.stone >= 10 && inv.gold >= 5) {
                // 先尝试生成，成功后再扣除材料
                const success = this.spawnEntity('beacon', this.state.player.x + 60, this.state.player.y);
                if (success) {
                    inv.stone -= 10; inv.gold -= 5;
                    // 灯塔也可以作为基地标记
                    if (!this.state.hasBase) {
                        this.state.baseX = this.state.player.x + 60;
                        this.state.baseY = this.state.player.y;
                        this.state.hasBase = true;
                    }
                    this.log("建造: 灯塔 🗼 (基地指引)");
                } else {
                    // 生成失败，位置被占用，材料不扣除
                    this.log("建造失败：位置已被占用！请换个位置。", true);
                }
            } else {
                this.log("材料不足: 石头x10, 金块x5");
            }
        }
        // 1. 箭矢 (弹药)
        else if (item === 'arrow') {
            if (inv.twig >= 1 && inv.flint >= 1) {
                inv.twig -= 1; inv.flint -= 1;
                inv.arrow = (inv.arrow || 0) + 4; // 一次造4支
                this.log("制作: 箭矢 x4");
            } else { 
                this.log("材料不足: 树枝x1, 燧石x1"); 
            }
        }
        // 2. 绳索 (消耗大量干草)
        else if (item === 'rope') {
            if (inv.grass >= 6) {
                inv.grass -= 6;
                inv.rope = (inv.rope || 0) + 1;
                this.log("制作: 绳索 (消耗6干草)");
            } else { 
                this.log("材料不足: 干草x6"); 
            }
        }
        // 3. 编织布 (高难度二级材料)
        else if (item === 'fabric') {
            if ((inv.rope||0) >= 2 && (inv.wool||0) >= 2) {
                inv.rope -= 2; inv.wool -= 2;
                inv.fabric = (inv.fabric || 0) + 1;
                this.log("制作: 编织布");
            } else { 
                this.log("材料不足: 绳索x2, 羊毛x2"); 
            }
        }
        // 4. 营火挡风板 (功能建筑)
        else if (item === 'windshield') {
            if ((inv.fabric||0) >= 1 && (inv.fat||0) >= 1 && inv.stone >= 2) {
                const p = this.state.player;
                const nearbyCampfire = this.state.entities.find(e => e.type === 'campfire' && Math.hypot(e.x - p.x, e.y - p.y) < 100);
                if (nearbyCampfire) {
                    if (!nearbyCampfire.isProtected) {
                        inv.fabric -= 1; inv.fat -= 1; inv.stone -= 2;
                        nearbyCampfire.isProtected = true;
                        nearbyCampfire.protectionTimer = 1800; // 30秒保护时间
                        nearbyCampfire.life = Math.min(100, nearbyCampfire.life + 20); 
                        this.log("营火升级成功！30秒内不会掉耐久，之后燃烧速度减半。");
                    } else { 
                        this.log("该营火已有挡风板！"); 
                    }
                } else { 
                    this.log("请靠近营火后制作！"); 
                }
            } else { 
                this.log("材料不足: 编织布x1, 羊油x1, 石头x2"); 
            }
        }
        // 5. 编织护甲 (装备)
        else if (item === 'armor') {
            if ((inv.fabric||0) >= 3 && (inv.fat||0) >= 1) {
                inv.fabric -= 3; inv.fat -= 1;
                tools.armor = true;
                tools.armorDurability = 150;
                this.log("制作: 编织护甲 (减伤40%)");
            } else { 
                this.log("材料不足: 编织布x3, 羊油x1"); 
            }
        }
        this.renderInventory(); this.updateUI();
    }

    eat(type) {
        const p = this.state.player;
        if (type === 'berry' && p.inventory.berry > 0) { 
            p.inventory.berry--; 
            p.hunger = Math.min(100, p.hunger + 10); 
            p.health = Math.min(100, p.health + 2); 
            this.log("吃了浆果"); 
        } 
        else if (type === 'meat' && p.inventory.meat > 0) { 
            p.inventory.meat--; 
            p.hunger = Math.min(100, p.hunger + 25); 
            p.health = Math.min(100, p.health + 5); 
            p.sanity = Math.min(100, p.sanity + 5); 
            this.log("吃了小肉"); 
        } 
        else if (type === 'bigmeat' && p.inventory.bigmeat > 0) { 
            p.inventory.bigmeat--; 
            p.hunger = Math.min(100, p.hunger + 50); 
            p.health = Math.min(100, p.health + 50); 
            p.sanity = Math.min(100, p.sanity + 50); 
            this.log("大肉真香！"); 
        }
        // --- 新增：腐肉逻辑 ---
        else if (type === 'rottenmeat' && p.inventory.rottenmeat > 0) {
            p.inventory.rottenmeat--;
            p.hunger = Math.min(100, p.hunger + 10); // 加一点饱食度
            p.health = Math.max(0, p.health - 5);     // 扣血
            p.sanity = Math.max(0, p.sanity - 15);    // 大幅扣理智
            this.log("呕...吃了腐肉 (理智-15 生命-5)", true);
        }
        this.renderInventory();
    }

    draw() {
        const ctx = this.ctx;
        const cam = this.state.camera;
        ctx.fillStyle = this.state.isBloodMoon ? COLORS.ground_boss : COLORS.ground;
        ctx.fillRect(0, 0, this.width, this.height);
        
        // 绘制网格线
        this.drawGrid(ctx, cam);
        
        ctx.font = "32px 'Segoe UI Emoji'"; 
        
        this.state.entities.forEach(e => {
            if(e.x < cam.x - 60 || e.x > cam.x + this.width + 60 || e.y < cam.y - 60 || e.y > cam.y + this.height + 60) return;
            const dx = e.x - cam.x, dy = e.y - cam.y;
            ctx.save(); ctx.translate(dx, dy);
            const breathe = Math.sin(Date.now()/250 + e.offset) * 2;

            if(e.type === 'stick') { 
                const img = this.images['stick'];
                if (img && img.complete) {
                    const size = 40 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.font="28px Segoe UI Emoji"; ctx.fillText("🌿",0,0);
                }
            }
            else if(e.type === 'grass') { ctx.font="28px Segoe UI Emoji"; ctx.fillText("🌾",0,0); }
            else if(e.type === 'sapling') { ctx.font="20px Segoe UI Emoji"; ctx.fillText("🌱",0,0); } // 树苗
            else if(e.type === 'flint') { 
                const img = this.images['flint'];
                if (img && img.complete) {
                    // 燧石更小，约25像素
                    const size = 25 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.shadowBlur=10; ctx.shadowColor="white"; ctx.fillStyle="#ecf0f1"; ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(6,3); ctx.lineTo(0,8); ctx.lineTo(-6,3); ctx.fill(); ctx.shadowBlur=0;
                }
            }
            else if(e.type === 'rabbit') { 
                ctx.scale(e.dir,1);
                ctx.font="30px Segoe UI Emoji"; ctx.fillText("🐇",0,0);
            }
            else if(e.type === 'spider') {
                const img = this.images['spider'];
                if (img && img.complete) {
                    // 蜘蛛图标，缩放合适大小
                    const size = 45 * ZOOM_SCALE;
                    ctx.scale(e.dir, 1);
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    // 备用emoji
                    ctx.scale(e.dir, 1);
                    ctx.font="28px Segoe UI Emoji"; 
                    ctx.fillText("🕷️",0,0);
                }
            }
            else if(e.type === 'boss_wolf') { 
                // 血条显示（在变换之前绘制）
                ctx.restore(); // 先恢复，以便使用绝对坐标
                ctx.save();
                ctx.fillStyle = "red"; 
                ctx.fillRect(dx - 40, dy - 60, 80, 6); 
                ctx.fillStyle = "#00ff00"; 
                ctx.fillRect(dx - 40, dy - 60, 80 * (e.life/e.maxLife), 6);
                ctx.restore();
                ctx.save();
                ctx.translate(dx, dy);
                
                const img = this.images['boss_wolf'];
                if (img && img.complete) {
                    // 狼王图标，缩放合适大小
                    const size = 80 * ZOOM_SCALE;
                    ctx.scale(e.dir, 1);
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    // 备用emoji
                    ctx.scale(e.dir, 1); 
                    ctx.font = "80px Segoe UI Emoji"; 
                    ctx.fillText("🐺", 0, 0);
                }
            }
            else if(e.type === 'wolf') { 
                // 血条显示（在变换之前绘制）
                ctx.restore(); // 先恢复，以便使用绝对坐标
                ctx.save();
                if (e.life < e.maxLife) { // 只显示受伤时的血条
                    ctx.fillStyle = "red"; 
                    ctx.fillRect(dx - 30, dy - 45, 60, 5); 
                    ctx.fillStyle = "#00ff00"; 
                    ctx.fillRect(dx - 30, dy - 45, 60 * (e.life/e.maxLife), 5);
                }
                ctx.restore();
                ctx.save();
                ctx.translate(dx, dy);
                
                // 如果是敌对状态，添加红色发光效果
                if (e.isHostile) {
                    ctx.shadowColor = "red";
                    ctx.shadowBlur = 15;
                }

                const img = this.images['wolf']; // 复用狼的图片
                if (img && img.complete) {
                    // 普通狼设置得比狼王小 (狼王是80，这里设为50)
                    const size = 50 * ZOOM_SCALE; 
                    ctx.scale(e.dir, 1);
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.scale(e.dir, 1); 
                    ctx.font = "40px Segoe UI Emoji"; 
                    ctx.fillText("🐺", 0, 0);
                }
                ctx.restore();
            }
            else if(e.type === 'tree') { 
                const img = this.images['tree'];
                if (img && img.complete) {
                    const scale = 1 + breathe/100;
                    // 树木占2x2格子，放大后约150x150像素
                    const size = 100 * ZOOM_SCALE * scale;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.fillStyle="#3e2723"; ctx.fillRect(-8,-10,16,25); ctx.fillStyle="#2e7d32"; ctx.beginPath(); ctx.arc(0,-30,35+breathe/3,0,Math.PI*2); ctx.fill();
                }
            }
            else if(e.type === 'rock') { 
                const img = this.images['rock'];
                if (img && img.complete) {
                    // 石头占用一格，放大后约75x75像素
                    const size = 50 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.fillStyle="#7f8c8d"; ctx.beginPath(); ctx.arc(0,0,22,0,Math.PI*2); ctx.fill();
                }
            }
            else if(e.type === 'bush') { 
                const img = this.images['bush'];
                if (img && img.complete) {
                    // 浆果丛较小，约40像素
                    const size = 40 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    ctx.fillStyle="#8e44ad"; ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill(); ctx.font="20px Segoe UI Emoji"; ctx.fillText("🍒",0,-5);
                }
            }
            else if(e.type === 'campfire') {
                const img = this.images['campfire'];
                if (img && img.complete) {
                    const fireSize = e.life/100;
                    const size = 60 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                const fireSize=e.life/100; ctx.font=`${20+fireSize*30}px Segoe UI Emoji`; ctx.fillText("🔥",0,-5);
                }
                ctx.fillStyle='#3e2723'; ctx.fillRect(-15,15,30,6);
                ctx.fillStyle='black'; ctx.fillRect(-20,-50,40,6); ctx.fillStyle=e.life>50?'#2ecc71':(e.life>20?'#f1c40f':'#e74c3c'); ctx.fillRect(-19,-49,38*(e.life/100),4);
                // 绘制营火保护罩
                if (e.isProtected) {
                    ctx.strokeStyle = '#7f8c8d';
                    ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(0, 10, 25, 0, Math.PI*2); ctx.stroke();
                }
            }
            else if(e.type === 'sheep') {
                ctx.scale(e.dir, 1);
                ctx.font = "40px Segoe UI Emoji";
                ctx.fillText("🐑", 0, 0);
            }
            else if(e.type === 'tower') {
                const img = this.images['tower'];
                if (img && img.complete) {
                    // 防御塔放大
                    const w = 70 * ZOOM_SCALE;
                    const h = 90 * ZOOM_SCALE;
                    ctx.drawImage(img, -w/2, -h/2, w, h);
                } else {
                ctx.fillStyle = '#5d4037'; ctx.fillRect(-13,-35,26,55);
                ctx.fillStyle = '#8d6e63'; ctx.fillRect(-16,-40,32,6);
                ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.moveTo(0,-52); ctx.lineTo(-10,-40); ctx.lineTo(10,-40); ctx.closePath(); ctx.fill();
                }
            }
            else if(e.type === 'bed') {
                // 床的绘制
                ctx.fillStyle = '#8d6e63'; 
                ctx.fillRect(-30, -10, 60, 15); // 床板
                ctx.fillStyle = '#6d4c41'; 
                ctx.fillRect(-32, -12, 5, 25); // 床头
                ctx.fillRect(27, -12, 5, 25); // 床尾
                ctx.fillStyle = '#d7c6a3'; 
                ctx.fillRect(-28, -8, 56, 8); // 床单
                ctx.font = '30px Segoe UI Emoji'; 
                ctx.fillText('🛏️', 0, -5);
            }
            else if(e.type === 'beacon') {
                // 先绘制光柱效果（在图片下方，更激进更亮眼）
                const pulse = Math.sin(Date.now() / 250) * 0.4 + 0.6; // 更强的脉冲
                const lightIntensity = 0.7 * pulse; // 更高的强度
                
                // 多层光柱效果 - 增强亮度范围
                // 外层光柱 - 最大范围（从350增加到550）
                const outerRange = 550;
                const outerGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, outerRange);
                outerGrad.addColorStop(0, `rgba(255, 255, 255, ${0.4 * lightIntensity})`);
                outerGrad.addColorStop(0.2, `rgba(255, 255, 200, ${0.3 * lightIntensity})`);
                outerGrad.addColorStop(0.5, `rgba(255, 255, 150, ${0.2 * lightIntensity})`);
                outerGrad.addColorStop(1, 'rgba(255, 255, 100, 0)');
                ctx.fillStyle = outerGrad;
                ctx.fillRect(-outerRange, -outerRange - 40, outerRange * 2, outerRange * 2);
                
                // 中层光柱 - 中等强度（从250增加到400）
                const midRange = 400;
                const midGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, midRange);
                midGrad.addColorStop(0, `rgba(255, 255, 180, ${0.6 * lightIntensity})`);
                midGrad.addColorStop(0.3, `rgba(255, 255, 160, ${0.4 * lightIntensity})`);
                midGrad.addColorStop(1, 'rgba(255, 255, 120, 0)');
                ctx.fillStyle = midGrad;
                ctx.fillRect(-midRange, -midRange - 40, midRange * 2, midRange * 2);
                
                // 内层光柱 - 最亮核心（从150增加到250）
                const innerRange = 250;
                const innerGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, innerRange);
                innerGrad.addColorStop(0, `rgba(255, 255, 200, ${0.8 * lightIntensity})`);
                innerGrad.addColorStop(0.5, `rgba(255, 255, 180, ${0.5 * lightIntensity})`);
                innerGrad.addColorStop(1, 'rgba(255, 255, 150, 0)');
                ctx.fillStyle = innerGrad;
                ctx.fillRect(-innerRange, -innerRange - 40, innerRange * 2, innerRange * 2);
                
                // 绘制灯塔图片
                const img = this.images['beacon'];
                if (img && img.complete) {
                    const size = 70 * ZOOM_SCALE;
                    ctx.drawImage(img, -size/2, -size/2, size, size);
                } else {
                    // 备用：绘制简单灯塔
                    const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;
                    ctx.fillStyle = '#5d4037';
                    ctx.fillRect(-15, -50, 30, 80);
                    ctx.fillStyle = '#8d6e63';
                    ctx.fillRect(-18, -53, 36, 8);
                    ctx.fillStyle = '#d4af37';
                    ctx.beginPath();
                    ctx.arc(0, -50, 12, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = `rgba(255, 255, 200, ${pulse})`;
                    ctx.beginPath();
                    ctx.arc(0, -50, 8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.font = '35px Segoe UI Emoji';
                    ctx.fillText('🗼', 0, -40);
                }
            }
            else if(e.type === 'arrow') {
                const ang = Math.atan2(e.vy, e.vx);
                ctx.rotate(ang);
                ctx.fillStyle = '#c0c0c0'; ctx.fillRect(-8,-2,16,4);
                ctx.fillStyle = '#8b0000'; ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(14,-4); ctx.lineTo(14,4); ctx.closePath(); ctx.fill();
            }
            else if(e.type === 'nightling') {
                ctx.scale(e.dir,1);
                ctx.fillStyle = '#0f1525'; ctx.beginPath(); ctx.arc(0,-8,18,0,Math.PI*2); ctx.fill();
                ctx.fillStyle = '#ff4444'; ctx.beginPath(); ctx.arc(-6,-10,3,0,Math.PI*2); ctx.arc(6,-10,3,0,Math.PI*2); ctx.fill();
                ctx.fillStyle = '#2c3e50'; ctx.fillRect(-10,8,20,6);
            }
            ctx.restore();
        });

        // Player
        const p = this.state.player;
        ctx.save(); ctx.translate(p.x - cam.x, p.y - cam.y);
        
        // 阴影
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, 24, 16, 5, 0, 0, Math.PI*2); ctx.fill();
        
        ctx.scale(p.dir,1);
        
        // 使用girl图片
        const playerImg = this.images['player'];
        if (playerImg && playerImg.complete) {
            // 人物放大，更清晰可见
            const size = 70 * ZOOM_SCALE;
            ctx.drawImage(playerImg, -size/2, -size/2, size, size);
        } else {
            // 备用：绘制简单角色
        // 身体 - 更精致的渐变和轮廓
        const bodyGrad = ctx.createLinearGradient(0,-22,0,20);
        bodyGrad.addColorStop(0, '#4a4a4a');
        bodyGrad.addColorStop(0.5, p.health < 30 ? '#a83232' : '#c87c3c');
        bodyGrad.addColorStop(1, p.health < 30 ? '#8e2b23' : '#a56e2b');
        
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.ellipse(0, -2, 14, 20, 0, 0, Math.PI*2);
        ctx.fill();
        
        // 身体轮廓
        ctx.strokeStyle = '#2c1a0f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -2, 14, 20, 0, 0, Math.PI*2);
        ctx.stroke();
        
        // 头部
        ctx.fillStyle = '#ffedd5';
        ctx.beginPath();
        ctx.arc(0, -32, 12, 0, Math.PI*2);
        ctx.fill();
        
        // 头发
        ctx.fillStyle = '#2c1a0f';
        ctx.beginPath();
        ctx.moveTo(-12,-38);
        ctx.quadraticCurveTo(0,-48,12,-38);
        ctx.lineTo(12,-34);
        ctx.quadraticCurveTo(0,-44,-12,-34);
        ctx.closePath();
        ctx.fill();
        
        // 眼睛 - 添加眼白和瞳孔，让表情更生动
        // 眼白
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-5, -32, 2.5, 0, Math.PI*2);
        ctx.arc(5, -32, 2.5, 0, Math.PI*2);
        ctx.fill();
        
        // 瞳孔
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath();
        ctx.arc(-5, -32, 1.5, 0, Math.PI*2);
        ctx.arc(5, -32, 1.5, 0, Math.PI*2);
        ctx.fill();
        
        // 眉毛
        ctx.strokeStyle = '#2c1a0f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (p.health < 30) {
            // 受伤时眉毛呈八字形
            ctx.moveTo(-8, -36);
            ctx.lineTo(-3, -34);
            ctx.moveTo(3, -34);
            ctx.lineTo(8, -36);
        } else {
            // 正常时眉毛自然弯曲
            ctx.moveTo(-7, -35);
            ctx.quadraticCurveTo(-5, -36, -3, -35);
            ctx.moveTo(3, -35);
            ctx.quadraticCurveTo(5, -36, 7, -35);
        }
        ctx.stroke();
        
        // 嘴巴 - 改进为更自然的表情
        ctx.strokeStyle = '#8d6e63';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // 根据健康状态显示不同表情
        if (p.health < 30) {
            // 受伤时显示担忧表情
            ctx.moveTo(-3, -26);
            ctx.lineTo(3, -26);
        } else {
            // 正常时显示温和的微笑
            ctx.moveTo(-3, -27);
            ctx.quadraticCurveTo(0, -25, 3, -27);
        }
        ctx.stroke();
        
        // 手臂
        ctx.strokeStyle = '#2c1a0f';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-12, -8);
        ctx.lineTo(-20, 4);
        ctx.moveTo(12, -8);
        ctx.lineTo(20, 4);
        ctx.stroke();
        
        // 腿部
        ctx.fillStyle = '#3e2723';
        ctx.beginPath();
        ctx.ellipse(-6, 18, 5, 8, 0, 0, Math.PI*2);
        ctx.ellipse(6, 18, 5, 8, 0, 0, Math.PI*2);
        ctx.fill();
        }

        // 只在持有长矛时显示武器图标（斧头和镐子不显示，但仍可用于砍树和挖矿）
        if(p.tools.spear) { ctx.translate(p.dir*20, -10); ctx.rotate(p.dir*0.5); ctx.font="35px Segoe UI Emoji"; ctx.fillText("⚔️",0,0); }
        
        ctx.restore();

        this.drawWeatherEffects();
        this.drawBloodParticles(cam);
        this.drawWindParticles(cam);
        this.drawLighting(cam);
    }
    
    // --- 新增：绘制血滴粒子 ---
    drawBloodParticles(cam) {
        const ctx = this.ctx;
        ctx.save();
        
        this.bloodParticles.forEach(p => {
            const alpha = p.life / p.maxLife;
            const x = p.x - cam.x;
            const y = p.y - cam.y;
            
            // 只绘制在屏幕内的粒子
            if (x > -50 && x < this.canvas.width + 50 && y > -50 && y < this.canvas.height + 50) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#8b0000'; // 深红色
                ctx.beginPath();
                ctx.arc(x, y, p.size, 0, Math.PI * 2);
                ctx.fill();
                
                // 添加一些随机的小血滴
                if (Math.random() > 0.7) {
                    ctx.fillStyle = '#cc0000'; // 亮红色
                    ctx.beginPath();
                    ctx.arc(x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 5, p.size * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
        
        ctx.globalAlpha = 1;
        ctx.restore();
    }
    
    // --- 新增：绘制风粒子 ---
    drawWindParticles(cam) {
        const ctx = this.ctx;
        ctx.save();
        
        this.windParticles.forEach(p => {
            const alpha = (p.life / p.maxLife) * p.alpha;
            const x = p.x - cam.x;
            const y = p.y - cam.y;
            
            // 只绘制在屏幕内的粒子
            if (x > -50 && x < this.canvas.width + 50 && y > -50 && y < this.canvas.height + 50) {
                ctx.globalAlpha = alpha;
                
                // 绘制风粒子（使用半透明的白色/灰色，类似风的效果）
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, p.size);
                gradient.addColorStop(0, `rgba(200, 220, 255, ${alpha})`);
                gradient.addColorStop(0.5, `rgba(180, 200, 240, ${alpha * 0.5})`);
                gradient.addColorStop(1, `rgba(160, 180, 220, 0)`);
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, p.size, 0, Math.PI * 2);
                ctx.fill();
                
                // 添加一些线条效果，模拟风的流动
                if (Math.random() > 0.7) {
                    ctx.strokeStyle = `rgba(200, 220, 255, ${alpha * 0.5})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x - p.vx * 2, y - p.vy * 2);
                    ctx.stroke();
                }
            }
        });
        
        ctx.globalAlpha = 1;
        ctx.restore();
    }
    
    drawGrid(ctx, cam) {
        ctx.save();
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        
        // 计算可见区域的网格范围
        const startX = Math.floor(cam.x / TILE_SIZE);
        const startY = Math.floor(cam.y / TILE_SIZE);
        const endX = Math.ceil((cam.x + this.width) / TILE_SIZE);
        const endY = Math.ceil((cam.y + this.height) / TILE_SIZE);
        
        // 绘制垂直线
        for (let x = startX; x <= endX; x++) {
            const screenX = x * TILE_SIZE - cam.x;
            ctx.beginPath();
            ctx.moveTo(screenX, 0);
            ctx.lineTo(screenX, this.height);
            ctx.stroke();
        }
        
        // 绘制水平线
        for (let y = startY; y <= endY; y++) {
            const screenY = y * TILE_SIZE - cam.y;
            ctx.beginPath();
            ctx.moveTo(0, screenY);
            ctx.lineTo(this.width, screenY);
            ctx.stroke();
        }
        
        ctx.restore();
    }

    drawWeatherEffects() {
        const ctx = this.ctx;
        const weather = this.state.weather;
        
        if (weather.type === 'clear') return;
        
        ctx.save();
        // 基础透明度
        ctx.globalAlpha = Math.min(0.8, 0.5 + weather.intensity * 0.4);
        
        switch (weather.type) {
            case 'rain':
                ctx.strokeStyle = 'rgba(100, 150, 200, 0.9)';
                ctx.lineWidth = 2;
                for (let i = 0; i < this.weatherParticles.length; i++) {
                    const p = this.weatherParticles[i];
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - 2, p.y + p.l);
                    ctx.stroke();
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.y > this.height) { p.y = -10; p.x = Math.random() * this.width; }
                    if (p.x < -10) p.x = this.width + 10;
                }
                break;
                
            case 'snow':
                ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
                for (let i = 0; i < this.weatherParticles.length; i++) {
                    const p = this.weatherParticles[i];
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fill();
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.y > this.height) { p.y = -5; p.x = Math.random() * this.width; }
                    if (p.x < -10) p.x = this.width + 10;
                    if (p.x > this.width + 10) p.x = -10;
                }
                break;
                
            case 'fog':
                // --- 美化版：流动云雾层 ---
                if (this.weatherParticles.length > 0 && this.weatherParticles[0].t) {
                    const now = Date.now();
                    const time = (now - this.weatherParticles[0].t) / 3000; // 极慢速流动
                    const fogCount = 12; // 雾团数量
                    
                    // 使用叠加模式让雾气重叠处更白、更浓
                    ctx.globalCompositeOperation = 'source-over';
                    
                    for (let i = 0; i < fogCount; i++) {
                        // 计算每个雾团的动态位置
                        // 引入多个正弦波叠加，打破规律感
                        const noiseX = Math.sin(time * 0.7 + i * 1.1);
                        const noiseY = Math.cos(time * 0.5 + i * 1.7);
                        
                        const angle = (i / fogCount) * Math.PI * 2 + time * 0.2;
                        const baseRadius = Math.max(this.width, this.height) * 0.6;
                        const radius = baseRadius + noiseX * 100; // 半径也有呼吸感
                        
                        const x = this.width/2 + Math.cos(angle) * radius + noiseX * 50;
                        const y = this.height/2 + Math.sin(angle) * radius * 0.7 + noiseY * 50;
                        
                        const size = 300 + Math.sin(time + i) * 100; // 大小随时间变化
                        
                        const fogGradient = ctx.createRadialGradient(x, y, 0, x, y, size);
                        
                        // 雾气颜色：使用冷灰蓝色调，边缘完全透明
                        const alpha = 0.12 * weather.intensity;
                        fogGradient.addColorStop(0, `rgba(225, 230, 240, ${alpha})`);
                        fogGradient.addColorStop(0.5, `rgba(210, 215, 230, ${alpha * 0.6})`);
                        fogGradient.addColorStop(1, 'rgba(200, 200, 210, 0)');
                        
                        ctx.fillStyle = fogGradient;
                        ctx.beginPath();
                        ctx.arc(x, y, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                break;
                
            case 'thunderstorm':
                ctx.globalAlpha = 0.8;
                ctx.strokeStyle = 'rgba(80, 100, 150, 1.0)';
                ctx.lineWidth = 2;
                for (let i = 0; i < this.weatherParticles.length; i++) {
                    const p = this.weatherParticles[i];
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - 3, p.y + p.l);
                    ctx.stroke();
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.y > this.height) { p.y = -10; p.x = Math.random() * this.width; }
                    if (p.x < -10) p.x = this.width + 10;
                }
                if (Math.random() < 0.02 * this.state.weather.intensity) {
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
                    ctx.fillRect(0, 0, this.width, this.height);
                }
                break;
        }
        
        ctx.restore();
    }

    drawLighting(cam) {
        const cycle = this.getCycle();
        const weather = this.state.weather.type;
        const p = this.state.player;
        
        let alpha = 0, color = "0,0,0";
        if (this.state.isBloodMoon) { alpha = 0.85; color = "40, 0, 0"; } 
        else { if (cycle === 'dusk') alpha = 0.35; if (cycle === 'night') alpha = 0.96; }

        let fogVisibility = false;
        let fogIntensity = 0;
        if (weather === 'fog' || weather === 'thunderstorm') {
            fogVisibility = true;
            fogIntensity = this.state.weather.intensity;
        }
        
        // --- 理智值低于60时，屏幕可见度降低（类似雾天效果） ---
        let sanityFogVisibility = false;
        let sanityFogIntensity = 0;
        if (p.sanity < 60) {
            sanityFogVisibility = true;
            // 理智值越低，可见度越低（60-0映射到0.3-0.8的强度）
            sanityFogIntensity = 0.3 + (60 - p.sanity) / 60 * 0.5;
        }

        if (alpha > 0 || fogVisibility || sanityFogVisibility) {
            const lCtx = this.lightCtx;
            lCtx.clearRect(0, 0, this.width, this.height);
            
            // 1. 绘制基础环境光 (夜晚/黄昏)
            if (alpha > 0) {
                lCtx.globalCompositeOperation = 'source-over'; 
                lCtx.fillStyle = `rgba(${color},${alpha})`; 
                lCtx.fillRect(0, 0, this.width, this.height);
            }
            
            // 2. 雾天/雷暴：高阶动态遮罩 (核心美化部分)
            if (fogVisibility) {
                lCtx.globalCompositeOperation = 'source-over';
                const playerScreenX = p.x - cam.x;
                const playerScreenY = p.y - cam.y;
                
                const now = Date.now();
                // --- 动态扰动逻辑 ---
                // 呼吸效果：视野半径随时间缓慢缩放 (周期约3秒)
                const breathe = Math.sin(now / 1500) * 25; 
                // 漂移效果：视野中心随风轻微移动，不再死板地居中 (模拟雾在动)
                const driftX = Math.cos(now / 2300) * 30;
                const driftY = Math.sin(now / 2700) * 20;

                // 基础可见半径 (天气越强半径越小)
                const baseRadius = Math.max(60, 180 * (1 - fogIntensity * 0.65));
                // 加上呼吸变化的最终半径
                const actualRadius = baseRadius + breathe;
                
                // 加上漂移的中心点
                const centerX = playerScreenX + driftX;
                const centerY = playerScreenY + driftY;
                
                // 创建大范围径向渐变
                // 从中心(0.1倍半径)到外部(3.5倍半径)，过渡非常柔和
                const fogGradient = lCtx.createRadialGradient(
                    centerX, centerY, actualRadius * 0.1, 
                    centerX, centerY, actualRadius * 3.5
                );
                
                // 雾的颜色和浓度
                const maxFogAlpha = 0.92 + fogIntensity * 0.08; // 最高不透明度
                const fogRgb = weather === 'thunderstorm' ? '30, 35, 45' : '210, 215, 225'; // 雷暴暗蓝灰，雾天天灰白

                // 设置渐变点：使用非线性插值让中心区域看起来"透气"，边缘"厚重"
                fogGradient.addColorStop(0, `rgba(${fogRgb}, 0)`);        // 核心完全透明
                fogGradient.addColorStop(0.2, `rgba(${fogRgb}, 0.1)`);    // 稍微有一点点雾
                fogGradient.addColorStop(0.4, `rgba(${fogRgb}, 0.4)`);    // 开始变浓
                fogGradient.addColorStop(0.7, `rgba(${fogRgb}, 0.8)`);    // 远处很浓
                fogGradient.addColorStop(1, `rgba(${fogRgb}, ${maxFogAlpha})`); // 边缘不可见
                
                lCtx.fillStyle = fogGradient;
                lCtx.fillRect(0, 0, this.width, this.height);
            }
            
            // 2.5. 理智值低时的可见度降低效果
            if (sanityFogVisibility) {
                lCtx.globalCompositeOperation = 'source-over';
                const playerScreenX = p.x - cam.x;
                const playerScreenY = p.y - cam.y;
                
                const now = Date.now();
                // 轻微的呼吸效果
                const breathe = Math.sin(now / 2000) * 15;
                // 轻微的漂移效果
                const driftX = Math.cos(now / 3000) * 20;
                const driftY = Math.sin(now / 3500) * 15;
                
                // 基础可见半径（理智值越低，半径越小）
                const baseRadius = Math.max(80, 200 * (1 - sanityFogIntensity * 0.5));
                const actualRadius = baseRadius + breathe;
                
                const centerX = playerScreenX + driftX;
                const centerY = playerScreenY + driftY;
                
                // 创建径向渐变（使用暗紫色调，表示精神不稳定）
                const sanityFogGradient = lCtx.createRadialGradient(
                    centerX, centerY, actualRadius * 0.1,
                    centerX, centerY, actualRadius * 3.0
                );
                
                // 理智值低时的颜色：暗紫色调
                const maxSanityFogAlpha = 0.5 + sanityFogIntensity * 0.3; // 0.5-0.8的不透明度
                const sanityFogRgb = '80, 60, 100'; // 暗紫色
                
                sanityFogGradient.addColorStop(0, `rgba(${sanityFogRgb}, 0)`);
                sanityFogGradient.addColorStop(0.2, `rgba(${sanityFogRgb}, ${0.1 * sanityFogIntensity})`);
                sanityFogGradient.addColorStop(0.4, `rgba(${sanityFogRgb}, ${0.3 * sanityFogIntensity})`);
                sanityFogGradient.addColorStop(0.7, `rgba(${sanityFogRgb}, ${0.6 * sanityFogIntensity})`);
                sanityFogGradient.addColorStop(1, `rgba(${sanityFogRgb}, ${maxSanityFogAlpha})`);
                
                lCtx.fillStyle = sanityFogGradient;
                lCtx.fillRect(0, 0, this.width, this.height);
            }
            
            // 3. 光源穿透逻辑 (挖空遮罩)
            lCtx.globalCompositeOperation = 'destination-out';
            
            // 玩家自带的微弱心理光环 (也加上一点呼吸感)
            const breatheSanity = Math.sin(Date.now() / 1000) * 2;
            const sanityScale = Math.max(0.4, p.sanity / 100);
            let g = lCtx.createRadialGradient(p.x-cam.x, p.y-cam.y, 10, p.x-cam.x, p.y-cam.y, 65 * sanityScale + breatheSanity);
            g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            lCtx.fillStyle = g; lCtx.beginPath(); lCtx.arc(p.x-cam.x, p.y-cam.y, 80, 0, Math.PI*2); lCtx.fill();

            // 实体光源 (火堆、塔、灯塔)
            this.state.entities.forEach(e => {
                if(e.type === 'campfire') {
                    // 火光闪烁 - 增加照亮范围
                    const r = e.life * 3.5 + Math.random() * 8; // 从2.2增加到3.5，随机值从5增加到8
                    let fireG = lCtx.createRadialGradient(e.x-cam.x, e.y-cam.y, 15, e.x-cam.x, e.y-cam.y, r);
                    fireG.addColorStop(0, 'rgba(0,0,0,1)'); fireG.addColorStop(1, 'rgba(0,0,0,0)');
                    lCtx.fillStyle = fireG; lCtx.beginPath(); lCtx.arc(e.x-cam.x, e.y-cam.y, r, 0, Math.PI*2); lCtx.fill();
                }
                else if(e.type === 'tower') {
                    const towerRange = 180;
                    const towerG = lCtx.createRadialGradient(e.x-cam.x, e.y-cam.y, 30, e.x-cam.x, e.y-cam.y, towerRange);
                    towerG.addColorStop(0, 'rgba(0,0,0,1)');
                    towerG.addColorStop(0.7, 'rgba(0,0,0,0.8)'); // 塔的光稍微硬一点
                    towerG.addColorStop(1, 'rgba(0,0,0,0)');
                    lCtx.fillStyle = towerG; 
                    lCtx.beginPath(); 
                    lCtx.arc(e.x-cam.x, e.y-cam.y, towerRange, 0, Math.PI*2); 
                    lCtx.fill();
                }
                else if(e.type === 'beacon') {
                    // 灯塔强力穿透 - 增强亮度范围
                    const beaconRange = 550; // 从350增加到550
                    const beaconG = lCtx.createRadialGradient(e.x-cam.x, e.y-cam.y, 40, e.x-cam.x, e.y-cam.y, beaconRange);
                    beaconG.addColorStop(0, 'rgba(0,0,0,1)');
                    beaconG.addColorStop(1, 'rgba(0,0,0,0)');
                    lCtx.fillStyle = beaconG;
                    lCtx.beginPath();
                    lCtx.arc(e.x-cam.x, e.y-cam.y, beaconRange, 0, Math.PI*2);
                    lCtx.fill();
                }
            });
            this.ctx.drawImage(this.lightCanvas, 0, 0);
        }
    }

    getCycle() { const p = this.state.time/DAY_LENGTH; if(p<0.5)return 'day'; if(p<0.65)return 'dusk'; return 'night'; }

    updateWeather() {
        const weather = this.state.weather;
        
        // 减少天气持续时间
        if (weather.duration > 0) {
            weather.duration--;
        }
        
        // 天气变化的概率 - 每半天检查一次
        const halfDay = DAY_LENGTH / 2; // 1800帧 = 30秒
        if (weather.duration <= 0) {
            const cycle = this.getCycle();
            let newWeather = 'clear';
            let duration = halfDay; // 默认至少半天
            let intensity = 1.0;
            
            // 根据时间周期决定天气概率
            if (cycle === 'day') {
                const rand = Math.random();
                if (rand < 0.2) {
                    newWeather = 'rain';
                    duration = halfDay + Math.random() * halfDay; // 0.5-1天
                    intensity = 0.5 + Math.random() * 0.5;
                } else if (rand < 0.35) {
                    newWeather = 'fog';
                    duration = halfDay + Math.random() * halfDay * 0.8;
                    intensity = 0.3 + Math.random() * 0.4;
                }
            } else if (cycle === 'night') {
                const rand = Math.random();
                if (rand < 0.15) {
                    newWeather = 'thunderstorm';
                    duration = halfDay * 0.5 + Math.random() * halfDay * 0.8;
                    intensity = 0.7 + Math.random() * 0.3;
                } else if (rand < 0.3) {
                    newWeather = 'fog';
                    duration = halfDay + Math.random() * halfDay * 0.5;
                    intensity = 0.4 + Math.random() * 0.3;
                }
            } else if (cycle === 'dusk') {
                const rand = Math.random();
                if (rand < 0.25) {
                    newWeather = 'fog';
                    duration = halfDay * 0.6 + Math.random() * halfDay * 0.8;
                    intensity = 0.3 + Math.random() * 0.3;
                }
            }
            
            // 冬季天气（每10天一个季节循环）
            if (this.state.day % 10 >= 7) { // 冬季
                if (Math.random() < 0.4) {
                    newWeather = 'snow';
                    duration = halfDay + Math.random() * DAY_LENGTH; // 0.5-1.5天
                    intensity = 0.4 + Math.random() * 0.6;
                }
            }
            
            if (newWeather !== weather.type) {
                weather.type = newWeather;
                weather.duration = duration;
                weather.intensity = intensity;
                this.initWeatherParticles();
                
                // 天气变化的提示信息
                const weatherNames = {
                    'clear': '天气转晴',
                    'rain': '开始下雨',
                    'fog': '起雾了',
                    'snow': '下雪了',
                    'thunderstorm': '雷暴来袭！'
                };
                this.log(weatherNames[newWeather], newWeather === 'thunderstorm');
            }
        }
        
        // 应用天气效果
        this.applyWeatherEffects();
    }

    initWeatherParticles() {
        this.weatherParticles = [];
        const w = this.width, h = this.height;
        const n = Math.max(60, Math.floor(120 * this.state.weather.intensity));
        switch (this.state.weather.type) {
            case 'rain':
                for (let i = 0; i < n; i++) this.weatherParticles.push({ x: Math.random()*w, y: Math.random()*h, vx: -2, vy: 8 + Math.random()*4, l: 10 + Math.random()*8 });
                break;
            case 'snow':
                for (let i = 0; i < n; i++) this.weatherParticles.push({ x: Math.random()*w, y: Math.random()*h, vx: (Math.random()-0.5), vy: 1 + Math.random()*1.5, r: 1 + Math.random()*2 });
                break;
            case 'thunderstorm':
                for (let i = 0; i < Math.floor(n*1.5); i++) this.weatherParticles.push({ x: Math.random()*w, y: Math.random()*h, vx: -3, vy: 10 + Math.random()*6, l: 12 + Math.random()*10 });
                break;
            case 'fog':
                this.weatherParticles.push({ t: Date.now() });
                break;
        }
    }

    applyWeatherEffects() {
        const weather = this.state.weather;
        const p = this.state.player;
        const intensity = weather.intensity || 1.0;
        
        switch (weather.type) {
            case 'rain':
                // 雨水会熄灭营火，大幅加快熄灭速度（但挡风板可以保护）
                this.state.entities.forEach(e => {
                    if (e.type === 'campfire') {
                        // 检查挡风板保护
                        if (e.isProtected && e.protectionTimer !== undefined && e.protectionTimer > 0) {
                            // 在保护时间内，不受雨水影响
                            // 不扣血
                        } else if (e.isProtected) {
                            // 有挡风板但保护时间已过，受到较少影响（减半）
                            e.life = Math.max(0, e.life - (0.02 + intensity * 0.015)); // 减半伤害
                        } else {
                            // 没有挡风板，正常受到雨水影响
                            e.life = Math.max(0, e.life - (0.04 + intensity * 0.03)); // 从0.02增强到0.04-0.07
                        }
                    }
                });
                // 下雨降低理智（降低下降速度）
                p.sanity = Math.max(0, p.sanity - (0.015 + intensity * 0.01)); // 从0.04-0.06降低到0.015-0.025
                break;
                
            case 'fog':
                // 雾天降低理智（降低下降速度）
                p.sanity = Math.max(0, p.sanity - (0.012 + intensity * 0.008)); // 从0.03-0.05降低到0.012-0.02
                // 雾天防御塔精度降低已经在 tower 更新逻辑中处理
                break;
                
            case 'snow':
                // 雪天饥饿消耗大幅增加
                p.hunger = Math.max(0, p.hunger - (0.02 + intensity * 0.01)); // 从0.01增强到0.02-0.03
                // 雪天营火持续时间更长（需要更多燃料，这个保持不变）
                this.state.entities.forEach(e => {
                    if (e.type === 'campfire') {
                        e.life = Math.min(e.maxLife || 100, e.life + 0.005 * intensity);
                    }
                });
                break;
                
            case 'thunderstorm':
                // 雷暴天气极度危险，大幅降低理智
                p.sanity = Math.max(0, p.sanity - (0.06 + intensity * 0.04)); // 从0.03增强到0.06-0.10
                // 雷暴会极快熄灭营火（但挡风板可以保护）
                this.state.entities.forEach(e => {
                    if (e.type === 'campfire') {
                        // 检查挡风板保护
                        if (e.isProtected && e.protectionTimer !== undefined && e.protectionTimer > 0) {
                            // 在保护时间内，不受雷暴影响
                            // 不扣血
                        } else if (e.isProtected) {
                            // 有挡风板但保护时间已过，受到较少影响（减半）
                            e.life = Math.max(0, e.life - (0.04 + intensity * 0.025)); // 减半伤害
                        } else {
                            // 没有挡风板，正常受到雷暴影响
                            e.life = Math.max(0, e.life - (0.08 + intensity * 0.05)); // 从0.05增强到0.08-0.13
                        }
                    }
                });
                // 偶尔有闪电效果
                if (Math.random() < 0.015 * intensity) {
                    this.shakeCamera(12 + intensity * 3);
                }
                break;
        }
    }
    checkNearFire() { 
        const p=this.state.player; 
        // 检查营火照明 - 理智值恢复范围（比照明范围小，确保真正靠近）
        const nearCampfire = this.state.entities.some(e=>e.type==='campfire'&&e.life>0&&Math.hypot(e.x-p.x,e.y-p.y)<200); // 200像素范围内才算靠近营火
        // 检查防御塔照明（150像素范围，比照明范围小）
        const nearTower = this.state.entities.some(e=>e.type==='tower'&&Math.hypot(e.x-p.x,e.y-p.y)<150);
        // 检查灯塔照明（450像素范围，比照明范围小）
        const nearBeacon = this.state.entities.some(e=>e.type==='beacon'&&Math.hypot(e.x-p.x,e.y-p.y)<450);
        return nearCampfire || nearTower || nearBeacon;
    }
    
    checkNearBase() {
        const p = this.state.player;
        if (!this.state.hasBase || this.state.baseX === undefined || this.state.baseY === undefined) {
            return false;
        }
        const baseDistance = Math.hypot(p.x - this.state.baseX, p.y - this.state.baseY);
        return baseDistance < 50 * TILE_SIZE; // 基地50格范围内算靠近（2500像素）
    }
    shakeCamera(amount) { this.state.camera.x += (Math.random()-0.5)*amount; this.state.camera.y += (Math.random()-0.5)*amount; }
    
    updateUI() {
        const p = this.state.player;
        // 更新三维状态条
        document.getElementById('bar-health').style.width = Math.min(100, p.health) + '%';
        document.getElementById('bar-hunger').style.width = Math.min(100, p.hunger) + '%';
        document.getElementById('bar-sanity').style.width = Math.min(100, p.sanity) + '%';
        
        // --- 修改点 1：优化存活天数显示 ---
        // 显示当前是第几天
        document.getElementById('day-counter').innerText = `第 ${this.state.day} 天`;
        
        // 更新时钟旋转角度
        document.getElementById('clock-face').style.transform = `rotate(-${(this.state.time/DAY_LENGTH)*360}deg)`;
        
        // 更新基地指引UI
        this.updateBaseCompass();
        
        // --- 修改点 2：详细列出所有天气效果 ---
        const weatherNames = { 'clear': '晴朗', 'rain': '雨天', 'fog': '雾天', 'snow': '雪天', 'thunderstorm': '雷暴' };
        
        // 在这里把所有的正面(Buff)和负面(Debuff)效果都写清楚
        const weatherEffects = { 
            'clear': '✨ 视野清晰  适宜探索', 
            'rain': '💧 移速↓  理智↓  营火易熄', 
            'fog': '🌫️ 视野↓↓  理智↓  塔射程↓', 
            'snow': '❄️ 移速↓↓  饥饿消耗↑',
            'thunderstorm': '⚡ 移速↓  理智↓↓  营火极易熄' 
        };
        
        const wi = document.getElementById('weather-info');
        const we = document.getElementById('weather-effects');
        
        if (wi) { 
            wi.innerHTML = `<span class="game-icon icon-weather-${this.state.weather.type}"></span> ${weatherNames[this.state.weather.type] || '晴朗'}`; 
            wi.style.display = 'block'; 
        }
        
        if (we) {
            we.innerText = weatherEffects[this.state.weather.type] || '';
            we.style.display = 'block'; // 始终显示，让玩家随时了解状态
            
            // --- 修改点 3：根据天气好坏改变提示框颜色 ---
            if (this.state.weather.type === 'clear') {
                // 晴天显示为安心的绿色
                we.style.color = '#aaddaa';
                we.style.borderColor = 'rgba(100, 200, 100, 0.5)';
                we.style.background = 'rgba(100, 200, 100, 0.15)';
            } else {
                // 恶劣天气显示为警示的橙色
                we.style.color = '#ffaa00';
                we.style.borderColor = 'rgba(255, 165, 0, 0.6)';
                we.style.background = 'rgba(255, 165, 0, 0.25)';
            }
        }
        
        // 更新天气覆盖层（视觉滤镜）
        const weatherOverlay = document.getElementById('weather-overlay');
        if (weatherOverlay) {
            weatherOverlay.className = 'weather-overlay ' + this.state.weather.type;
        }
        
        // 濒死红屏特效
        if(p.health < 30) document.getElementById('game-wrapper').style.boxShadow = `inset 0 0 60px rgba(139,0,0,${Math.abs(Math.sin(Date.now()/300))})`;
        else document.getElementById('game-wrapper').style.boxShadow = 'none';
        
        const inv = p.inventory;
        // 制作按钮状态更新（材料不足变灰）
        document.getElementById('craft-axe').disabled = !(inv.twig >=2 && inv.flint >=2);
        document.getElementById('craft-pickaxe').disabled = !(inv.twig >=2 && inv.flint >=2);
        document.getElementById('craft-fire').disabled = !(inv.wood >=3 && inv.stone >=2);
        document.getElementById('craft-spear').disabled = !(inv.wood >=1 && inv.gold >=1);
        document.getElementById('craft-bow').disabled = !(inv.wood >=2 && (inv.spiderSilk || 0) >= 3);
        
        const towerBtn = document.getElementById('craft-tower'); if (towerBtn) towerBtn.disabled = !(inv.wood >=8 && inv.stone >=6 && inv.gold >=2);
        const bedBtn = document.getElementById('craft-bed'); if (bedBtn) bedBtn.disabled = !(inv.wood >=6 && inv.grass >=8);
        const beaconBtn = document.getElementById('craft-beacon'); if (beaconBtn) beaconBtn.disabled = !(inv.stone >=10 && inv.gold >=5);
        
        // 更新新按钮的禁用状态
        const ropeBtn = document.getElementById('craft-rope');
        if(ropeBtn) ropeBtn.disabled = !(inv.grass >= 6);
        const fabricBtn = document.getElementById('craft-fabric');
        if(fabricBtn) fabricBtn.disabled = !((inv.rope||0) >= 2 && (inv.wool||0) >= 2);
        const wsBtn = document.getElementById('craft-windshield');
        if(wsBtn) wsBtn.disabled = !((inv.fabric||0) >= 1 && (inv.fat||0) >= 1 && inv.stone >= 2);
        const armorBtn = document.getElementById('craft-armor');
        if(armorBtn) armorBtn.disabled = !((inv.fabric||0) >= 3 && (inv.fat||0) >= 1);
        const arrowBtn = document.getElementById('craft-arrow');
        if(arrowBtn) arrowBtn.disabled = !(inv.twig >= 1 && inv.flint >= 1);
        
        // 更新工具耐久度显示
        const tools = p.tools;
        const axeDurabilityEl = document.getElementById('tool-axe-durability');
        const pickaxeDurabilityEl = document.getElementById('tool-pickaxe-durability');
        const spearDurabilityEl = document.getElementById('tool-spear-durability');
        const bowDurabilityEl = document.getElementById('tool-bow-durability');
        const armorDurabilityEl = document.getElementById('tool-armor-durability');
        if (axeDurabilityEl) axeDurabilityEl.innerText = tools.axe ? tools.axeDurability : 0;
        if (pickaxeDurabilityEl) pickaxeDurabilityEl.innerText = tools.pickaxe ? tools.pickaxeDurability : 0;
        if (spearDurabilityEl) spearDurabilityEl.innerText = tools.spear ? tools.spearDurability : 0;
        if (bowDurabilityEl) bowDurabilityEl.innerText = tools.bow ? tools.bowDurability : 0;
        if (armorDurabilityEl) armorDurabilityEl.innerText = tools.armor ? tools.armorDurability : 0;
        
        // 如果背包打开，实时更新背包数据
        if (this.ui.inventoryOpen) {
            this.renderInventory();
        }
        
        // 如果成就面板打开，实时更新成就数据
        if (this.ui.achievementsOpen) {
            this.updateAchievementsUI();
        }
        
        // 实时更新指南针距离
        this.updateBaseCompass();
    }
    
    updateBaseCompass() {
        const compass = document.getElementById('base-compass');
        const arrow = document.getElementById('compass-arrow');
        const distanceText = document.getElementById('base-distance');
        
        if (!this.state.hasBase || (this.state.baseX === undefined && this.state.baseY === undefined)) {
            if (compass) compass.style.display = 'none';
            return;
        }
        
        const p = this.state.player;
        const baseX = this.state.baseX || 0;
        const baseY = this.state.baseY || 0;
        
        // 计算距离和方向
        const dx = baseX - p.x;
        const dy = baseY - p.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // 判断方向：上北下南左西右东
        let direction = '';
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        // 优先判断主要方向
        if (absDy > absDx) {
            // 垂直方向为主
            if (dy < 0) {
                direction = '北'; // 基地在玩家上方（屏幕坐标系）
            } else {
                direction = '南'; // 基地在玩家下方
            }
        } else {
            // 水平方向为主
            if (dx > 0) {
                direction = '东'; // 基地在玩家右侧
            } else {
                direction = '西'; // 基地在玩家左侧
            }
        }
        
        // 显示指南针
        if (compass) compass.style.display = 'block';
        if (arrow) {
            // 显示方向文字而不是箭头
            arrow.innerText = direction;
            arrow.style.transform = 'none'; // 不旋转
            arrow.style.border = 'none'; // 移除箭头样式
            arrow.style.width = 'auto';
            arrow.style.height = 'auto';
            arrow.style.fontSize = '32px';
            arrow.style.color = 'var(--gold)';
            arrow.style.fontWeight = 'bold';
            arrow.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        }
        if (distanceText) {
            // 转换为格子距离显示
            const tiles = Math.floor(distance / TILE_SIZE);
            distanceText.innerText = `${tiles}格`;
        }
    }

    renderInventory() {
        const inv = this.state.player.inventory;
        
        // 更新原有文本
        document.getElementById('inv-twig').innerText = inv.twig;
        document.getElementById('inv-grass').innerText = inv.grass;
        document.getElementById('inv-flint').innerText = inv.flint;
        document.getElementById('inv-wood').innerText = inv.wood;
        document.getElementById('inv-stone').innerText = inv.stone;
        document.getElementById('inv-gold').innerText = inv.gold;
        document.getElementById('inv-berry').innerText = inv.berry;
        document.getElementById('inv-meat').innerText = inv.meat;
        document.getElementById('inv-bigmeat').innerText = inv.bigmeat;
        document.getElementById('inv-pinecone').innerText = inv.pinecone;
        
        // --- 新增：更新腐肉数量 ---
        const rottenEl = document.getElementById('inv-rottenmeat');
        if(rottenEl) rottenEl.innerText = inv.rottenmeat;
        
        // --- 新增：更新蜘蛛丝数量 ---
        const spiderSilkEl = document.getElementById('inv-spiderSilk');
        if(spiderSilkEl) spiderSilkEl.innerText = inv.spiderSilk || 0;
        
        // --- 新增：更新二级材料数量 ---
        document.getElementById('inv-arrow').innerText = inv.arrow || 0;
        document.getElementById('inv-rope').innerText = inv.rope || 0;
        document.getElementById('inv-wool').innerText = inv.wool || 0;
        document.getElementById('inv-fat').innerText = inv.fat || 0;
        document.getElementById('inv-fabric').innerText = inv.fabric || 0;
        
        // 更新原有按钮状态
        document.getElementById('eat-berry').disabled = inv.berry <= 0;
        document.getElementById('eat-meat').disabled = inv.meat <= 0;
        document.getElementById('eat-bigmeat').disabled = inv.bigmeat <= 0;
        document.getElementById('action-plant').disabled = inv.pinecone <= 0;

        // --- 新增：更新腐肉按钮状态 ---
        const eatRottenBtn = document.getElementById('eat-rottenmeat');
        if(eatRottenBtn) eatRottenBtn.disabled = inv.rottenmeat <= 0;
    }
    
    toggleInventory() {
        this.ui.inventoryOpen = !this.ui.inventoryOpen;
        const panel = document.getElementById('inventory-panel');
        panel.style.display = this.ui.inventoryOpen ? 'block' : 'none';
        
        if (this.ui.inventoryOpen) {
            this.renderInventory();
        }
        // 面板打开时游戏逻辑继续运行
    }
    
    toggleAchievements() {
        this.ui.achievementsOpen = !this.ui.achievementsOpen;
        const panel = document.getElementById('achievements-panel');
        panel.style.display = this.ui.achievementsOpen ? 'block' : 'none';
        
        if (this.ui.achievementsOpen) {
            this.updateAchievementsUI();
        }
        // 面板打开时游戏逻辑继续运行
    }
    
    closeAllPanels() {
        // 关闭所有面板
        if (this.ui.craftOpen) {
            this.ui.craftOpen = false;
            document.getElementById('crafting-panel').style.display = 'none';
        }
        if (this.ui.inventoryOpen) {
            this.ui.inventoryOpen = false;
            document.getElementById('inventory-panel').style.display = 'none';
        }
        if (this.ui.achievementsOpen) {
            this.ui.achievementsOpen = false;
            document.getElementById('achievements-panel').style.display = 'none';
        }
    }

    log(msg, danger=false) {
        const el = document.getElementById('message-log');
        el.innerText = msg;
        el.style.color = danger ? '#ff4444' : '#ffffff';
        el.style.opacity = 1;
        clearTimeout(this.messageTimer);
        this.messageTimer = setTimeout(() => el.style.opacity = 0, 3000);
    }

    checkAchievements() {
        const ach = this.state.achievements;
        const unlocked = [];
        
        // 生存成就
        if (ach.maxDays >= 3 && !ach.unlocked_survivor3) {
            ach.unlocked_survivor3 = true;
            unlocked.push({ name: "初出茅庐", desc: "存活3天" });
        }
        if (ach.maxDays >= 7 && !ach.unlocked_survivor7) {
            ach.unlocked_survivor7 = true;
            unlocked.push({ name: "生存专家", desc: "存活7天" });
        }
        if (ach.maxDays >= 15 && !ach.unlocked_survivor15) {
            ach.unlocked_survivor15 = true;
            unlocked.push({ name: "生存大师", desc: "存活15天" });
        }
        
        // 资源成就
        if (ach.totalWood >= 100 && !ach.unlocked_wood100) {
            ach.unlocked_wood100 = true;
            unlocked.push({ name: "伐木工", desc: "收集100木材" });
        }
        if (ach.totalStone >= 50 && !ach.unlocked_stone50) {
            ach.unlocked_stone50 = true;
            unlocked.push({ name: "矿工", desc: "收集50石头" });
        }
        if (ach.totalGold >= 10 && !ach.unlocked_gold10) {
            ach.unlocked_gold10 = true;
            unlocked.push({ name: "淘金者", desc: "收集10金块" });
        }
        
        // 战斗成就
        if (ach.killedNightlings >= 10 && !ach.unlocked_kill10) {
            ach.unlocked_kill10 = true;
            unlocked.push({ name: "夜怪杀手", desc: "击杀10只夜怪" });
        }
        if (ach.killedBossWolves >= 1 && !ach.unlocked_boss1) {
            ach.unlocked_boss1 = true;
            unlocked.push({ name: "狼王终结者", desc: "击杀1只狼王" });
        }
        
        // 建造成就
        if (ach.builtCampfires >= 5 && !ach.unlocked_campfire5) {
            ach.unlocked_campfire5 = true;
            unlocked.push({ name: "篝火大师", desc: "建造5个营火" });
        }
        if (ach.builtTowers >= 3 && !ach.unlocked_tower3) {
            ach.unlocked_tower3 = true;
            unlocked.push({ name: "防御专家", desc: "建造3座防御塔" });
        }
        
        // 其他成就
        if (ach.plantedTrees >= 10 && !ach.unlocked_plant10) {
            ach.unlocked_plant10 = true;
            unlocked.push({ name: "园丁", desc: "种植10棵树" });
        }
        if (ach.totalMeat >= 20 && !ach.unlocked_meat20) {
            ach.unlocked_meat20 = true;
            unlocked.push({ name: "猎人", desc: "获得20块肉" });
        }
        
        // 显示解锁的成就（暂停游戏并显示弹窗）
        if (unlocked.length > 0) {
            // 暂停游戏
            this.state.player.isPaused = true;
            
            // 显示第一个解锁的成就弹窗
            const ach = unlocked[0];
            this.showAchievementPopup(ach.name, ach.desc);
            
            // 如果有多个成就，依次显示
            if (unlocked.length > 1) {
                this.pendingAchievements = unlocked.slice(1);
            }
        }
        
        // 更新成就UI
        this.updateAchievementsUI();
    }
    
    showAchievementPopup(name, desc) {
        const popup = document.getElementById('achievement-popup');
        const popupName = document.getElementById('achievement-popup-name');
        const popupDesc = document.getElementById('achievement-popup-desc');
        
        if (popup && popupName && popupDesc) {
            popupName.innerText = name;
            popupDesc.innerText = desc;
            popup.style.display = 'flex';
            popup.style.pointerEvents = 'auto'; // 确保弹窗可以接收点击事件
            // 暂停游戏
            this.state.player.isPaused = true;
        }
    }
    
    closeAchievementPopup() {
        const popup = document.getElementById('achievement-popup');
        if (popup) {
            popup.style.display = 'none';
            popup.style.pointerEvents = 'none'; // 隐藏时禁用指针事件
        }
        
        // 如果有待显示的成就，继续显示
        if (this.pendingAchievements && this.pendingAchievements.length > 0) {
            const ach = this.pendingAchievements.shift();
            this.showAchievementPopup(ach.name, ach.desc);
        } else {
            // 恢复游戏
            this.state.player.isPaused = false;
            this.pendingAchievements = null;
        }
    }
    
    updateAchievementsUI() {
        const ach = this.state.achievements;
        const list = document.getElementById('achievements-list');
        if (!list) return;
        
        const achievements = [
            { id: 'survivor3', name: '初出茅庐', desc: '存活3天', unlocked: ach.unlocked_survivor3, progress: `${ach.maxDays}/3` },
            { id: 'survivor7', name: '生存专家', desc: '存活7天', unlocked: ach.unlocked_survivor7, progress: `${ach.maxDays}/7` },
            { id: 'survivor15', name: '生存大师', desc: '存活15天', unlocked: ach.unlocked_survivor15, progress: `${ach.maxDays}/15` },
            { id: 'wood100', name: '伐木工', desc: '收集100木材', unlocked: ach.unlocked_wood100, progress: `${ach.totalWood}/100` },
            { id: 'stone50', name: '矿工', desc: '收集50石头', unlocked: ach.unlocked_stone50, progress: `${ach.totalStone}/50` },
            { id: 'gold10', name: '淘金者', desc: '收集10金块', unlocked: ach.unlocked_gold10, progress: `${ach.totalGold}/10` },
            { id: 'kill10', name: '夜怪杀手', desc: '击杀10只夜怪', unlocked: ach.unlocked_kill10, progress: `${ach.killedNightlings}/10` },
            { id: 'boss1', name: '狼王终结者', desc: '击杀1只狼王', unlocked: ach.unlocked_boss1, progress: `${ach.killedBossWolves}/1` },
            { id: 'campfire5', name: '篝火大师', desc: '建造5个营火', unlocked: ach.unlocked_campfire5, progress: `${ach.builtCampfires}/5` },
            { id: 'tower3', name: '防御专家', desc: '建造3座防御塔', unlocked: ach.unlocked_tower3, progress: `${ach.builtTowers}/3` },
            { id: 'plant10', name: '园丁', desc: '种植10棵树', unlocked: ach.unlocked_plant10, progress: `${ach.plantedTrees}/10` },
            { id: 'meat20', name: '猎人', desc: '获得20块肉', unlocked: ach.unlocked_meat20, progress: `${ach.totalMeat}/20` },
        ];
        
        list.innerHTML = achievements.map(a => `
            <div class="achievement-item ${a.unlocked ? 'unlocked' : ''}">
                <div class="achievement-icon">${a.unlocked ? '🏆' : '🔒'}</div>
                <div class="achievement-info">
                    <div class="achievement-name">${a.name}</div>
                    <div class="achievement-desc">${a.desc}</div>
                    <div class="achievement-progress">${a.progress}</div>
                </div>
            </div>
        `).join('');
    }
    
    saveGame() { 
        localStorage.setItem('dst_v7_save', JSON.stringify(this.state)); 
        this.log("进度已保存"); 
    }
    
    toggleCraftPanel() {
        this.ui.craftOpen = !this.ui.craftOpen;
        const panel = document.getElementById('crafting-panel');
        panel.style.display = this.ui.craftOpen ? 'block' : 'none';
        // 面板打开时游戏逻辑继续运行
    }
    loadGame() { 
        const s = localStorage.getItem('dst_v7_save'); 
        if(s) { 
            try { 
                const loaded = JSON.parse(s);
                // 合并状态，确保新字段（如成就）被初始化
                this.state = {
                    ...this.state, 
                    ...loaded,
                    achievements: {
                        ...this.state.achievements,
                        ...(loaded.achievements || {})
                    },
                    player: {
                        ...this.state.player,
                        ...loaded.player,
                        tools: {
                            ...this.state.player.tools,
                            ...(loaded.player?.tools || {})
                        }
                    }
                };
                this.log("读取存档中..."); 
            } catch(e) { 
                this.initWorld(); 
            } 
        } else {
            this.initWorld(); 
        }
    }
    clearSave() { if(confirm("确定要删除存档并重置吗？")) { localStorage.removeItem('dst_v7_save'); location.reload(); } }
}

const game = new Game();