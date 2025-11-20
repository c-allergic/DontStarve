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
        
        // 图片资源
        this.images = {};
        this.loadImages();
        
        this.state = {
            time: 0, day: 1,
            player: {
                x: 0, y: 0, // 从原点开始，无限世界
                health: 100, hunger: 100, sanity: 100,
                // 新增 gold, pinecone
                inventory: { twig:0, flint:0, wood:0, stone:0, grass:0, berry:0, meat:0, bigmeat:0, gold:0, pinecone:0 },
                tools: { 
                    axe: false, 
                    pickaxe: false, 
                    spear: false,
                    axeDurability: 0,  // 工具耐久度
                    pickaxeDurability: 0,
                    spearDurability: 0
                },
                dir: 1,
                isPaused: false  // 游戏暂停状态
            },
            entities: [],
            camera: { x: 0, y: 0 },
            isBloodMoon: false,
            darknessTimer: 0, // 记录在黑暗中的时间
            baseX: 0, baseY: 0, // 基地坐标（床的位置）
            hasBase: false, // 是否有基地
            chunks: {}, // 已生成的区块 { "chunkX,chunkY": true }
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
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
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
            'beacon': 'cartoon/lighthouse.png'
        };
        
        let loaded = 0;
        const total = Object.keys(imageMap).length;
        
        Object.entries(imageMap).forEach(([key, path]) => {
            const img = new Image();
            img.onload = () => {
                loaded++;
                if (loaded === total) {
                    console.log('所有图片加载完成');
                }
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
            if (e.code === 'Space') this.interact();
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
            this.handleClick(e.clientX - rect.left, e.clientY - rect.top);
        });
    }

    updateCursor() {
        const cam = this.state.camera;
        const worldX = this.mouse.x + cam.x;
        const worldY = this.mouse.y + cam.y;
        const hovered = this.state.entities.some(e => Math.hypot(e.x - worldX, e.y - worldY) < 40);
        this.canvas.style.cursor = hovered ? 'pointer' : 'crosshair';
    }

    handleClick(mx, my) {
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
            rabbit: 1
        };
        
        // 在区块内生成资源
        for (let type in resourcesPerChunk) {
            const count = resourcesPerChunk[type];
            for (let i = 0; i < count; i++) {
                // 在区块范围内随机生成
                const offsetX = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                const offsetY = (Math.random() - 0.5) * CHUNK_SIZE * TILE_SIZE * 0.8;
                this.spawnEntity(type, centerX + offsetX, centerY + offsetY);
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
            'tree': { width: 2, height: 2 },
            'tower': { width: 2, height: 2 }, // 防御塔也占2x2
            'campfire': { width: 1, height: 1 },
            'bed': { width: 1, height: 1 },
            'beacon': { width: 1, height: 1 }
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
                
                if (attempts >= maxAttempts) return; // 找不到空位，放弃生成
                
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
                    return;
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
        if(type === 'boss_wolf') hp = 1000;  // 狼王血量上调 
        if(type === 'nightling') hp = 60;
        if(type === 'tower') hp = 350;

        this.state.entities.push({
            type: type, x: x, y: y, 
            life: hp, maxLife: hp,
            id: Math.random().toString(36).slice(2, 11),
            offset: Math.random() * Math.PI * 2,
            dir: 1, attackTimer: 0,
            growthTimer: 0,
            range: type==='tower'?320:undefined,
            atk: type==='tower'?35:undefined,
            cooldown: 0,
            vx: 0, vy: 0, damage: 0, ttl: 0
        });
    }

    loop() {
        this.update();
        this.draw();
        requestAnimationFrame(this.loop);
    }

    update() {
        // 如果游戏暂停（成就弹窗或面板打开），不更新游戏逻辑和时间
        if (this.state.player.isPaused || this.ui.craftOpen || this.ui.inventoryOpen || this.ui.achievementsOpen) return;
        
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
        } else if (weather === 'fog') {
            speed *= (0.80 - weatherIntensity * 0.1); // 雾天减速：80%-70%
        } else if (weather === 'thunderstorm') {
            speed *= (0.70 - weatherIntensity * 0.1); // 雷暴大幅减速：70%-60%
        }

        // 移除边界限制，实现无限世界
        if (this.keys['KeyW'] || this.keys['ArrowUp']) { p.y -= speed; moved = true; }
        if (this.keys['KeyS'] || this.keys['ArrowDown']) { p.y += speed; moved = true; }
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) { p.x -= speed; p.dir = -1; moved = true; }
        if (this.keys['KeyD'] || this.keys['ArrowRight']) { p.x += speed; p.dir = 1; moved = true; }
        
        // 动态加载区块
        this.loadChunksAroundPlayer();

        this.state.camera.x = p.x - this.width / 2;
        this.state.camera.y = p.y - this.height / 2;

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
            this.checkAchievements();
            this.log(`第 ${this.state.day} 天`);
            this.respawnResources();
        }

        // 天气系统更新
        this.updateWeather();

        const hungerDrain = moved ? 0.015 : 0.005; 
        p.hunger = Math.max(0, p.hunger - hungerDrain);

        const nearFire = this.checkNearFire();

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
                p.health -= 10; // 巨额伤害
                this.log("查理攻击了你！", true);
                this.shakeCamera(20);
                this.state.darknessTimer = 0; // 重置，如果不生火会继续挨打
            }
            
            // 黑暗中理智依然会掉
            p.sanity = Math.max(0, p.sanity - 0.05);
        } else {
            this.state.darknessTimer = 0; // 有光，重置计时器
            if (cycle === 'dusk' && !nearFire) p.sanity = Math.max(0, p.sanity - 0.01);
            else if(p.sanity < 100) p.sanity = Math.min(100, p.sanity + 0.08);
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
                e.life -= 0.025; // 减少耐久度衰减，让火烧得更久
                if(e.life <= 0) { 
                    const grid = this.worldToGrid(e.x, e.y);
                    this.freeGrid(grid.gx, grid.gy);
                    this.state.entities.splice(idx, 1); 
                    this.log("火灭了！", true); 
                }
            }
            else if (e.type === 'sapling') {
                // 树苗成长逻辑
                e.growthTimer++;
                if(e.growthTimer > 1200) { // 约20秒长成
                    const grid = this.worldToGrid(e.x, e.y);
                    this.state.entities.splice(idx, 1);
                    // 不需要重新占用网格，因为树苗和树都占用同一格
                    this.spawnEntity('tree', e.x, e.y); // 原地变成树
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
                    e.x += Math.cos(angle) * 3.5 * speedMultiplier; 
                    e.y += Math.sin(angle) * 3.5 * speedMultiplier; 
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
            else if (e.type === 'nightling') {
                const dist = Math.hypot(p.x - e.x, p.y - e.y);
                const angle = Math.atan2(p.y - e.y, p.x - e.x);
                // 更新速度向量，供防御塔预判
                e.vx = Math.cos(angle) * 2.6;
                e.vy = Math.sin(angle) * 2.6;
                e.x += e.vx; e.y += e.vy; e.dir = Math.cos(angle)>0?1:-1;
                if (dist < 55) {
                    e.attackTimer++;
                    if (e.attackTimer > 50) { p.health -= 8; this.shakeCamera(6); e.attackTimer = 0; }
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
                    if (e.attackTimer > 60) { p.health -= 25; this.log("狼王撕咬！", true); this.shakeCamera(10); e.attackTimer = 0; }  // 攻击力从15增加到25
                }
                if (this.getCycle() !== 'night') { this.state.entities.splice(idx, 1); this.log("狼王消失了。"); }
            }
            else if (e.type === 'tower') {
                e.cooldown = Math.max(0, e.cooldown - 1);
                const targets = this.state.entities.filter(t => (t.type==='nightling' || t.type==='boss_wolf'));
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
                e.ttl--; if (e.ttl <= 0) { this.state.entities.splice(idx,1); return; }
                e.x += e.vx; e.y += e.vy;
                const hitIdx = this.state.entities.findIndex(t => (t.type==='nightling' || t.type==='boss_wolf') && Math.hypot(t.x - e.x, t.y - e.y) < 16);
                if (hitIdx >= 0) {
                    const t = this.state.entities[hitIdx];
                    t.life -= e.damage;
                    if (t.life <= 0) {
                        if (t.type === 'nightling') { this.state.entities.splice(hitIdx,1); this.state.player.inventory.meat++; }
                        else if (t.type === 'boss_wolf') { this.state.entities.splice(hitIdx,1); this.state.player.inventory.bigmeat++; this.state.player.inventory.gold += 2; this.log("防御塔击杀狼王！", false); }
                    }
                    this.state.entities.splice(idx,1);
                }
            }
        });

        this.updateUI();
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
        const refreshTypes = ['tree', 'rock', 'bush', 'grass', 'flint', 'stick', 'rabbit'];
        
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

    interact() {
        const p = this.state.player;
        let target = null, minDist = 100;
        this.state.entities.forEach((e, index) => {
            const dist = Math.hypot(e.x - p.x, e.y - p.y);
            if (dist < minDist) { target = { e, index }; minDist = dist; }
        });
        if (target) this.gather(target.e, target.index);
    }

    gather(entity, index) {
        const p = this.state.player;
        const inv = p.inventory;
        const tools = p.tools;

        // 伤害计算：长矛30，工具10，空手5
        let damage = 5;
        let toolUsed = null;
        if (tools.spear && tools.spearDurability > 0) {
            damage = 30;
            toolUsed = 'spear';
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

        if (entity.type === 'boss_wolf') {
            entity.life -= damage;
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
                inv.meat++; 
                this.state.achievements.killedNightlings++;
                this.state.achievements.totalMeat++;
                this.checkAchievements();
                this.log("击杀夜怪：小肉"); 
                
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
        
        if (entity.type === 'rabbit') {
            // 兔子血量低，直接死
            this.state.entities.splice(index, 1); 
            inv.meat++; 
            this.state.achievements.totalMeat++;
            this.checkAchievements();
            this.log("猎杀: 小肉");
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
                entity.life -= 25; 
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
                entity.life -= 25;
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
        else if (item === 'campfire') { 
            if (inv.wood >= 3 && inv.stone >= 2) { 
                inv.wood -= 3; inv.stone -= 2; 
                this.spawnEntity('campfire', this.state.player.x + 50, this.state.player.y); 
                achievements.builtCampfires++;
                this.checkAchievements();
                this.log("建造: 营火"); 
            } 
        }
        else if (item === 'tower') {
            if (inv.wood >= 8 && inv.stone >= 6 && inv.gold >= 2) {
                inv.wood -= 8; inv.stone -= 6; inv.gold -= 2; 
                this.spawnEntity('tower', this.state.player.x + 60, this.state.player.y); 
                achievements.builtTowers++;
                this.checkAchievements();
                this.log("建造: 防御塔");
            } else {
                this.log("材料不足: 木材x8, 石头x6, 金块x2");
            }
        }
        else if (item === 'bed') {
            if (inv.wood >= 6 && inv.grass >= 8) {
                inv.wood -= 6; inv.grass -= 8;
                this.spawnEntity('bed', this.state.player.x + 60, this.state.player.y);
                // 设置基地位置
                this.state.baseX = this.state.player.x + 60;
                this.state.baseY = this.state.player.y;
                this.state.hasBase = true;
                this.log("建造: 床 🛏️ (基地标记)");
            } else {
                this.log("材料不足: 木材x6, 干草x8");
            }
        }
        else if (item === 'beacon') {
            if (inv.stone >= 10 && inv.gold >= 5) {
                inv.stone -= 10; inv.gold -= 5;
                this.spawnEntity('beacon', this.state.player.x + 60, this.state.player.y);
                // 灯塔也可以作为基地标记
                if (!this.state.hasBase) {
                    this.state.baseX = this.state.player.x + 60;
                    this.state.baseY = this.state.player.y;
                    this.state.hasBase = true;
                }
                this.log("建造: 灯塔 🗼 (基地指引)");
            } else {
                this.log("材料不足: 石头x10, 金块x5");
            }
        }
        this.renderInventory(); this.updateUI();
    }

    eat(type) {
        const p = this.state.player;
        if (type === 'berry' && p.inventory.berry > 0) { p.inventory.berry--; p.hunger = Math.min(100, p.hunger + 10); p.health = Math.min(100, p.health + 2); this.log("吃了浆果"); } 
        else if (type === 'meat' && p.inventory.meat > 0) { p.inventory.meat--; p.hunger = Math.min(100, p.hunger + 25); p.health = Math.min(100, p.health + 5); p.sanity = Math.min(100, p.sanity + 5); this.log("吃了小肉"); } 
        else if (type === 'bigmeat' && p.inventory.bigmeat > 0) { p.inventory.bigmeat--; p.hunger = Math.min(100, p.hunger + 50); p.health = Math.min(100, p.health + 50); p.sanity = Math.min(100, p.sanity + 50); this.log("大肉真香！"); }
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
                
                // 多层光柱效果 - 更激进
                // 外层光柱 - 最大范围
                const outerGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, 350);
                outerGrad.addColorStop(0, `rgba(255, 255, 255, ${0.4 * lightIntensity})`);
                outerGrad.addColorStop(0.2, `rgba(255, 255, 200, ${0.3 * lightIntensity})`);
                outerGrad.addColorStop(0.5, `rgba(255, 255, 150, ${0.2 * lightIntensity})`);
                outerGrad.addColorStop(1, 'rgba(255, 255, 100, 0)');
                ctx.fillStyle = outerGrad;
                ctx.fillRect(-350, -390, 700, 700);
                
                // 中层光柱 - 中等强度
                const midGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, 250);
                midGrad.addColorStop(0, `rgba(255, 255, 180, ${0.6 * lightIntensity})`);
                midGrad.addColorStop(0.3, `rgba(255, 255, 160, ${0.4 * lightIntensity})`);
                midGrad.addColorStop(1, 'rgba(255, 255, 120, 0)');
                ctx.fillStyle = midGrad;
                ctx.fillRect(-250, -290, 500, 500);
                
                // 内层光柱 - 最亮核心
                const innerGrad = ctx.createRadialGradient(0, -40, 0, 0, -40, 150);
                innerGrad.addColorStop(0, `rgba(255, 255, 200, ${0.8 * lightIntensity})`);
                innerGrad.addColorStop(0.5, `rgba(255, 255, 180, ${0.5 * lightIntensity})`);
                innerGrad.addColorStop(1, 'rgba(255, 255, 150, 0)');
                ctx.fillStyle = innerGrad;
                ctx.fillRect(-150, -190, 300, 300);
                
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

        if(p.tools.spear) { ctx.translate(p.dir*20, -10); ctx.rotate(p.dir*0.5); ctx.font="35px Segoe UI Emoji"; ctx.fillText("⚔️",0,0); }
        else if(p.tools.axe) { ctx.translate(p.dir*20, -10); ctx.rotate(p.dir*0.5); ctx.font="30px Segoe UI Emoji"; ctx.fillText("🪓",0,0); }
        else if(p.tools.pickaxe) { ctx.translate(p.dir*20, -10); ctx.rotate(p.dir*0.5); ctx.font="30px Segoe UI Emoji"; ctx.fillText("⛏",0,0); }
        
        ctx.restore();

        this.drawWeatherEffects();
        this.drawLighting(cam);
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
        // 提高天气特效可见度
        ctx.globalAlpha = Math.min(0.7, 0.4 + weather.intensity * 0.3);
        
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
                // 雾天效果：基于距离的可见度，越远越模糊
                // 这个效果在drawLighting中实现，这里只绘制动态雾气团
                if (this.weatherParticles.length > 0 && this.weatherParticles[0].t) {
                    const time = (Date.now() - this.weatherParticles[0].t) / 1000;
                    const fogCount = 8;
                    ctx.globalAlpha = 0.2 * weather.intensity;
                    for (let i = 0; i < fogCount; i++) {
                        const angle = (i / fogCount) * Math.PI * 2 + time * 0.05;
                        const radius = Math.max(this.width, this.height) * 0.2;
                        const x = this.width/2 + Math.cos(angle) * radius * (0.5 + Math.sin(time + i) * 0.2);
                        const y = this.height/2 + Math.sin(angle) * radius * (0.5 + Math.cos(time + i) * 0.2);
                        const size = 120 + Math.sin(time * 0.3 + i) * 30;
                        
                        const fogGradient = ctx.createRadialGradient(x, y, 0, x, y, size);
                        fogGradient.addColorStop(0, `rgba(200, 200, 210, ${0.3 * weather.intensity})`);
                        fogGradient.addColorStop(1, 'rgba(180, 180, 190, 0)');
                        
                        ctx.fillStyle = fogGradient;
                        ctx.beginPath();
                        ctx.arc(x, y, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                break;
                
            case 'thunderstorm':
                // 雷暴的可见度效果在drawLighting中实现，这里只绘制雨滴和闪电
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

        // 雾天和雷暴的可见度效果
        let fogVisibility = false;
        let fogIntensity = 0;
        if (weather === 'fog' || weather === 'thunderstorm') {
            fogVisibility = true;
            fogIntensity = this.state.weather.intensity;
        }

        if (alpha > 0 || fogVisibility) {
            const lCtx = this.lightCtx;
            lCtx.clearRect(0, 0, this.width, this.height);
            
            if (alpha > 0) {
                lCtx.globalCompositeOperation = 'source-over'; 
                lCtx.fillStyle = `rgba(${color},${alpha})`; 
                lCtx.fillRect(0, 0, this.width, this.height);
            }
            
            // 雾天/雷暴：距离遮罩效果 - 使用混合模式实现可见度渐变
            if (fogVisibility) {
                // 先绘制一层半透明覆盖层
                lCtx.globalCompositeOperation = 'source-over';
                const playerScreenX = p.x - cam.x;
                const playerScreenY = p.y - cam.y;
                
                // 创建一个从玩家中心向外逐渐变白的遮罩
                // 可见半径：大幅减少可见范围，让雾更浓
                const baseVisibility = 100 - fogIntensity * 40; // 基础可见范围：100-60像素（原来150-100）
                const maxRadius = Math.max(this.width, this.height) * 1.2;
                
                // 使用径向渐变创建距离遮罩
                const fogGradient = lCtx.createRadialGradient(
                    playerScreenX, playerScreenY, baseVisibility * 0.4, // 中心更小
                    playerScreenX, playerScreenY, maxRadius
                );
                
                // 根据天气强度调整雾的浓度 - 大幅增强
                const minFogAlpha = 0.6 + fogIntensity * 0.3; // 从0.4增加到0.6
                const maxFogAlpha = 0.85 + fogIntensity * 0.15; // 从0.7增加到0.85
                
                if (weather === 'fog') {
                    fogGradient.addColorStop(0, 'rgba(200, 200, 210, 0)'); // 中心清晰
                    fogGradient.addColorStop(0.2, `rgba(190, 190, 200, ${minFogAlpha * 0.4})`); // 更快变浓
                    fogGradient.addColorStop(0.5, `rgba(180, 180, 190, ${minFogAlpha * 0.8})`); // 更快变浓
                    fogGradient.addColorStop(1, `rgba(160, 160, 180, ${maxFogAlpha})`); // 边缘完全模糊
                } else if (weather === 'thunderstorm') {
                    fogGradient.addColorStop(0, 'rgba(100, 100, 120, 0)'); // 中心较清晰
                    fogGradient.addColorStop(0.2, `rgba(80, 80, 100, ${minFogAlpha * 0.5})`);
                    fogGradient.addColorStop(0.5, `rgba(60, 60, 80, ${minFogAlpha * 0.9})`);
                    fogGradient.addColorStop(1, `rgba(40, 40, 60, ${maxFogAlpha})`); // 边缘完全黑暗
                }
                
                lCtx.fillStyle = fogGradient;
                lCtx.fillRect(0, 0, this.width, this.height);
            }
            
            lCtx.globalCompositeOperation = 'destination-out';
            
            const sanityScale = Math.max(0.4, p.sanity / 100);
            let g = lCtx.createRadialGradient(p.x-cam.x, p.y-cam.y, 15, p.x-cam.x, p.y-cam.y, 70*sanityScale);
            g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            lCtx.fillStyle = g; lCtx.beginPath(); lCtx.arc(p.x-cam.x, p.y-cam.y, 80, 0, Math.PI*2); lCtx.fill();

            this.state.entities.forEach(e => {
                if(e.type === 'campfire') {
                    const r = e.life * 2.2 + Math.random() * 5;
                    let fireG = lCtx.createRadialGradient(e.x-cam.x, e.y-cam.y, 20, e.x-cam.x, e.y-cam.y, r);
                    fireG.addColorStop(0, 'rgba(0,0,0,1)'); fireG.addColorStop(1, 'rgba(0,0,0,0)');
                    lCtx.fillStyle = fireG; lCtx.beginPath(); lCtx.arc(e.x-cam.x, e.y-cam.y, r, 0, Math.PI*2); lCtx.fill();
                }
                else if(e.type === 'tower') {
                    // 防御塔照亮功能 - 金色光环
                    const towerRange = 180; // 照亮范围
                    const towerG = lCtx.createRadialGradient(e.x-cam.x, e.y-cam.y, 30, e.x-cam.x, e.y-cam.y, towerRange);
                    towerG.addColorStop(0, 'rgba(0,0,0,1)');
                    towerG.addColorStop(0.7, 'rgba(0,0,0,0.8)');
                    towerG.addColorStop(1, 'rgba(0,0,0,0)');
                    lCtx.fillStyle = towerG; 
                    lCtx.beginPath(); 
                    lCtx.arc(e.x-cam.x, e.y-cam.y, towerRange, 0, Math.PI*2); 
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
                // 雨水会熄灭营火，大幅加快熄灭速度
                this.state.entities.forEach(e => {
                    if (e.type === 'campfire') {
                        e.life = Math.max(0, e.life - (0.04 + intensity * 0.03)); // 从0.02增强到0.04-0.07
                    }
                });
                // 下雨大幅降低理智
                p.sanity = Math.max(0, p.sanity - (0.04 + intensity * 0.02)); // 从0.02增强到0.04-0.06
                break;
                
            case 'fog':
                // 雾天大幅降低理智
                p.sanity = Math.max(0, p.sanity - (0.03 + intensity * 0.02)); // 从0.01增强到0.03-0.05
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
                // 雷暴会极快熄灭营火
                this.state.entities.forEach(e => {
                    if (e.type === 'campfire') {
                        e.life = Math.max(0, e.life - (0.08 + intensity * 0.05)); // 从0.05增强到0.08-0.13
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
        // 检查营火照明
        const nearCampfire = this.state.entities.some(e=>e.type==='campfire'&&Math.hypot(e.x-p.x,e.y-p.y)<e.life*2.5);
        // 检查防御塔照明（180像素范围）
        const nearTower = this.state.entities.some(e=>e.type==='tower'&&Math.hypot(e.x-p.x,e.y-p.y)<180);
        return nearCampfire || nearTower;
    }
    shakeCamera(amount) { this.state.camera.x += (Math.random()-0.5)*amount; this.state.camera.y += (Math.random()-0.5)*amount; }
    
    updateUI() {
        const p = this.state.player;
        document.getElementById('bar-health').style.width = Math.min(100, p.health) + '%';
        document.getElementById('bar-hunger').style.width = Math.min(100, p.hunger) + '%';
        document.getElementById('bar-sanity').style.width = Math.min(100, p.sanity) + '%';
        document.getElementById('day-counter').innerText = `存活天数: ${this.state.day}`;
        document.getElementById('clock-face').style.transform = `rotate(-${(this.state.time/DAY_LENGTH)*360}deg)`;
        
        // 更新基地指引UI
        this.updateBaseCompass();
        
        // 更新天气显示和效果提示
        const weatherNames = { 'clear': '晴朗', 'rain': '雨天', 'fog': '雾天', 'snow': '雪天', 'thunderstorm': '雷暴' };
        const weatherEffects = { 
            'clear': '', 
            'rain': '💧 理智-  营火易熄', 
            'fog': '🌫️ 视野↓  理智-  塔射程↓', 
            'snow': '❄️ 移速↓  饥饿++',
            'thunderstorm': '⚡ 理智--  营火快熄' 
        };
        
        const wi = document.getElementById('weather-info');
        const we = document.getElementById('weather-effects');
        if (wi) { 
            wi.innerHTML = `<span class="game-icon icon-weather-${this.state.weather.type}"></span> ${weatherNames[this.state.weather.type] || '晴朗'}`; 
            wi.style.display = 'block'; 
        }
        if (we) {
            we.innerText = weatherEffects[this.state.weather.type] || '';
            we.style.display = this.state.weather.type !== 'clear' ? 'block' : 'none';
        }
        
        // 更新天气覆盖层类名
        const weatherOverlay = document.getElementById('weather-overlay');
        if (weatherOverlay) {
            weatherOverlay.className = 'weather-overlay ' + this.state.weather.type;
        }
        if(p.health < 30) document.getElementById('game-wrapper').style.boxShadow = `inset 0 0 60px rgba(139,0,0,${Math.abs(Math.sin(Date.now()/300))})`;
        else document.getElementById('game-wrapper').style.boxShadow = 'none';
        const inv = p.inventory;
        // 按钮状态更新
        document.getElementById('craft-axe').disabled = !(inv.twig >=2 && inv.flint >=2);
        document.getElementById('craft-pickaxe').disabled = !(inv.twig >=2 && inv.flint >=2);
        document.getElementById('craft-fire').disabled = !(inv.wood >=3 && inv.stone >=2);
        document.getElementById('craft-spear').disabled = !(inv.wood >=1 && inv.gold >=1);
        const towerBtn = document.getElementById('craft-tower'); if (towerBtn) towerBtn.disabled = !(inv.wood >=8 && inv.stone >=6 && inv.gold >=2);
        const bedBtn = document.getElementById('craft-bed'); if (bedBtn) bedBtn.disabled = !(inv.wood >=6 && inv.grass >=8);
        const beaconBtn = document.getElementById('craft-beacon'); if (beaconBtn) beaconBtn.disabled = !(inv.stone >=10 && inv.gold >=5);
        
        // 更新工具耐久度显示
        const tools = p.tools;
        const axeDurabilityEl = document.getElementById('tool-axe-durability');
        const pickaxeDurabilityEl = document.getElementById('tool-pickaxe-durability');
        const spearDurabilityEl = document.getElementById('tool-spear-durability');
        if (axeDurabilityEl) axeDurabilityEl.innerText = tools.axe ? tools.axeDurability : 0;
        if (pickaxeDurabilityEl) pickaxeDurabilityEl.innerText = tools.pickaxe ? tools.pickaxeDurability : 0;
        if (spearDurabilityEl) spearDurabilityEl.innerText = tools.spear ? tools.spearDurability : 0;
        
        // 如果背包打开，更新背包中的数据
        if (this.ui.inventoryOpen) {
            this.renderInventory();
        }
        
        // 如果成就面板打开，更新成就数据
        if (this.ui.achievementsOpen) {
            this.updateAchievementsUI();
        }
        
        // 更新基地指引UI
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
        
        // 更新背包面板中的数值
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
        
        // 更新食物按钮状态
        document.getElementById('eat-berry').disabled = inv.berry <= 0;
        document.getElementById('eat-meat').disabled = inv.meat <= 0;
        document.getElementById('eat-bigmeat').disabled = inv.bigmeat <= 0;
        document.getElementById('action-plant').disabled = inv.pinecone <= 0;
    }
    
    toggleInventory() {
        this.ui.inventoryOpen = !this.ui.inventoryOpen;
        const panel = document.getElementById('inventory-panel');
        panel.style.display = this.ui.inventoryOpen ? 'block' : 'none';
        
        if (this.ui.inventoryOpen) {
            this.renderInventory();
        }
        // 面板打开时暂停游戏计时（在update中已处理）
    }
    
    toggleAchievements() {
        this.ui.achievementsOpen = !this.ui.achievementsOpen;
        const panel = document.getElementById('achievements-panel');
        panel.style.display = this.ui.achievementsOpen ? 'block' : 'none';
        
        if (this.ui.achievementsOpen) {
            this.updateAchievementsUI();
        }
        // 面板打开时暂停游戏计时（在update中已处理）
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
        // 面板打开时暂停游戏计时（在update中已处理）
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