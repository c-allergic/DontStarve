#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
饥荒游戏强化学习训练脚本
使用PPO算法训练代理，目标是存活尽可能多的天数
"""

import numpy as np
import json
import time
import random
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
from torch.distributions import Categorical

class GameEnvironment:
    """游戏环境封装"""
    def __init__(self, headless=False):
        self.driver = None
        self.headless = headless
        self.action_space_size = 16  # 动作空间大小（新增交互动作）
        self.state_size = 43  # 状态空间大小（27基础 + 16感知特征：8种最近实体的相对位置）
        self.last_state = None
        self.last_day = 1
        self.last_health = 100
        self.last_hunger = 100
        self.last_sanity = 100
        # 【新增】好奇心奖励：跟踪每个episode中已执行过的动作
        self.tried_actions = set()
        
    def start(self):
        """启动浏览器和游戏"""
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument('--headless')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        # 允许运行未签名的ChromeDriver（macOS安全设置）
        chrome_options.add_argument('--disable-blink-features=AutomationControlled')
        chrome_options.add_experimental_option('excludeSwitches', ['enable-logging'])
        
        import os
        # 使用webdriver-manager自动下载和管理ChromeDriver
        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
        except Exception as e:
            print(f"使用webdriver-manager失败: {e}")
            print("尝试使用系统PATH中的chromedriver...")
            # 如果webdriver-manager失败，尝试直接使用系统PATH中的chromedriver
            self.driver = webdriver.Chrome(options=chrome_options)
        # 获取index.html的绝对路径
        script_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(script_dir, 'index.html')
        self.driver.get(f'file://{html_path}')
        # 等待游戏加载（使用WebDriverWait替代time.sleep）
        try:
            WebDriverWait(self.driver, 5).until(
                lambda d: d.execute_script("return typeof game !== 'undefined' && game.state !== undefined")
            )
        except:
            pass  # 如果等待超时，继续执行
        
        # 注入JavaScript来获取游戏状态
        self._inject_state_getter()
        
        # 【关键修复】禁用成就弹窗暂停机制
        self.driver.execute_script("""
            // 覆盖成就弹窗函数，禁止暂停游戏
            if (typeof game !== 'undefined') {
                const originalShowPopup = game.showAchievementPopup;
                game.showAchievementPopup = function(name, desc) {
                    console.log('AI获得成就(已屏蔽弹窗): ' + name);
                    // 强制不暂停，让游戏继续
                    if (game.state && game.state.player) {
                        game.state.player.isPaused = false;
                    }
                    // 清空待显示的成就
                    if (game.pendingAchievements) {
                        game.pendingAchievements = [];
                    }
                };
                
                // 确保当前未暂停
                if (game.state && game.state.player) {
                    game.state.player.isPaused = false;
                }
            }
        """)
        
    def _inject_state_getter(self):
        """注入JavaScript代码来获取游戏状态，并屏蔽游戏的自动重置功能"""
        
        # 1. 【核心修复】屏蔽 alert 和 location.reload
        # 这段代码必须最先执行，防止 Agent 死后游戏自己刷新页面导致 Python 失联
        self.driver.execute_script("""
            // 屏蔽弹窗，防止阻塞
            window.alert = function(msg) { 
                console.log('被屏蔽的弹窗:', msg); 
            };
            
            // 屏蔽确认框，默认返回 true
            window.confirm = function(msg) { 
                console.log('被屏蔽的确认:', msg); 
                return true; 
            };
            
            // 【关键】屏蔽页面刷新！让游戏停留在死亡画面，由 Python 来决定何时 reset
            const originalReload = window.location.reload;
            window.location.reload = function() { 
                console.log('游戏试图刷新页面，已被拦截'); 
            };
            
            // 再次确保 game 对象存在时覆盖其内部逻辑
            if (typeof game !== 'undefined') {
                // 覆盖 clearSave 防止它调用 reload
                const originalClearSave = game.clearSave;
                game.clearSave = function() { 
                    console.log('拦截 clearSave'); 
                    localStorage.removeItem('dst_v7_save');
                    // 不调用 location.reload()
                };
            }
        """)
        
        # 2. 注入原来的获取状态逻辑
        js_code = """
        window.getGameState = function() {
            if (typeof game === 'undefined' || !game.state) {
                return null;
            }
            const p = game.state.player;
            const entities = game.state.entities;
            
            // 辅助函数：找最近的特定类型实体，返回归一化的相对坐标和距离
            function findNearest(type) {
                let minDist = 99999;
                let dx = 0, dy = 0, dist = 1.0;
                entities.forEach(e => {
                    if (e.type === type) {
                        const d = Math.hypot(e.x - p.x, e.y - p.y);
                        if (d < minDist) {
                            minDist = d;
                            dx = (e.x - p.x) / 1000.0; // 归一化相对坐标（除以1000）
                            dy = (e.y - p.y) / 1000.0;
                            dist = Math.min(d / 500.0, 1.0); // 归一化距离（500像素内为1.0）
                        }
                    }
                });
                // 如果没找到，返回远距离标记
                if (minDist >= 99999) {
                    return [1.0, 1.0, 1.0]; // [dx, dy, dist] 都设为1.0表示很远
                }
                return [dx, dy, dist];
            }
            
            const state = {
                health: p.health,
                hunger: p.hunger,
                sanity: p.sanity,
                day: game.state.day,
                time: game.state.time,
                x: p.x,
                y: p.y,
                inventory: p.inventory,
                tools: {
                    axe: p.tools.axe ? 1 : 0,
                    pickaxe: p.tools.pickaxe ? 1 : 0,
                    spear: p.tools.spear ? 1 : 0,
                    bow: p.tools.bow ? 1 : 0,
                    rod: p.tools.rod ? 1 : 0,
                    armor: p.tools.armor ? 1 : 0
                },
                biome: game.state.currentBiome,
                isResting: game.state.isResting ? 1 : 0,
                isFishing: game.state.isFishing ? 1 : 0,
                // 【新增】感知层：最近的资源实体（相对位置和距离）
                nearest_tree: findNearest('tree'),
                nearest_bush: findNearest('bush'),
                nearest_rock: findNearest('rock'),
                nearest_flint: findNearest('flint'),
                nearest_stick: findNearest('stick'),  // 【关键】地上的树枝（制作工具必需）
                nearest_grass: findNearest('grass'),  // 【关键】地上的草（制作营火必需）
                nearest_rabbit: findNearest('rabbit'),
                nearest_pond: findNearest('pond')
            };
            return state;
        };
        
        window.executeAction = function(action) {
            if (typeof game === 'undefined') return false;
            const p = game.state.player;
            
            // 动作映射：
            // 0-3: 移动 (W, S, A, D)
            // 4: 无动作
            // 5: 制作斧头
            // 6: 制作矿镐
            // 7: 制作长矛
            // 8: 制作弓箭
            // 9: 制作鱼竿
            // 10: 制作营火
            // 11: 吃浆果
            // 12: 吃小肉
            // 13: 种植松果
            // 14: 休息（如果有床）
            // 15: 【新增】交互/采集最近的实体
            
            switch(action) {
                case 0: // W - 上
                    if (!game.keys['KeyW']) {
                        const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' });
                        game.keys['KeyW'] = true;
                        window.dispatchEvent(event);
                    }
                    break;
                case 1: // S - 下
                    if (!game.keys['KeyS']) {
                        const event = new KeyboardEvent('keydown', { code: 'KeyS', key: 's' });
                        game.keys['KeyS'] = true;
                        window.dispatchEvent(event);
                    }
                    break;
                case 2: // A - 左
                    if (!game.keys['KeyA']) {
                        const event = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' });
                        game.keys['KeyA'] = true;
                        window.dispatchEvent(event);
                    }
                    break;
                case 3: // D - 右
                    if (!game.keys['KeyD']) {
                        const event = new KeyboardEvent('keydown', { code: 'KeyD', key: 'd' });
                        game.keys['KeyD'] = true;
                        window.dispatchEvent(event);
                    }
                    break;
                case 5: // 制作斧头
                    if (p.inventory.twig >= 2 && p.inventory.flint >= 2) {
                        game.craft('axe');
                    }
                    break;
                case 6: // 制作矿镐
                    if (p.inventory.twig >= 2 && p.inventory.flint >= 2) {
                        game.craft('pickaxe');
                    }
                    break;
                case 7: // 制作长矛
                    if (p.inventory.wood >= 1 && p.inventory.gold >= 1) {
                        game.craft('spear');
                    }
                    break;
                case 8: // 制作弓箭
                    if (p.inventory.wood >= 2 && p.inventory.spiderSilk >= 3) {
                        game.craft('bow');
                    }
                    break;
                case 9: // 制作鱼竿
                    if (p.inventory.twig >= 2 && p.inventory.rope >= 1) {
                        game.craft('rod');
                    }
                    break;
                case 10: // 制作营火
                    if (p.inventory.wood >= 3 && p.inventory.stone >= 2) {
                        game.craft('campfire');
                    }
                    break;
                case 11: // 吃浆果
                    if (p.inventory.berry > 0) {
                        game.eat('berry');
                    }
                    break;
                case 12: // 吃小肉
                    if (p.inventory.meat > 0) {
                        game.eat('meat');
                    }
                    break;
                case 13: // 种植松果
                    if (p.inventory.pinecone > 0) {
                        game.plantSapling();
                    }
                    break;
                case 14: // 休息
                    // 需要找到床并交互，这里简化处理
                    break;
                case 15: // 【新增】交互/采集最近的实体
                    // 寻找距离小于60像素的最近实体并调用gather
                    let target = null;
                    let minDist = 60; // 交互范围
                    let targetIndex = -1;
                    
                    game.state.entities.forEach((e, index) => {
                        const dist = Math.hypot(e.x - p.x, e.y - p.y);
                        if (dist < minDist) {
                            target = e;
                            targetIndex = index;
                            minDist = dist;
                        }
                    });
                    
                    if (target && targetIndex >= 0) {
                        // 调用游戏的gather函数进行采集/交互
                        game.gather(target, targetIndex);
                    }
                    break;
            }
            return true;
        };
        """
        self.driver.execute_script(js_code)
    
    def get_state(self):
        """获取当前游戏状态"""
        try:
            state_dict = self.driver.execute_script("return window.getGameState();")
            if state_dict is None:
                return None
            
            # 构建状态向量
            state = np.array([
                # 基础属性（7维）
                state_dict['health'] / 100.0,  # 归一化生命值
                state_dict['hunger'] / 100.0,  # 归一化饱食度
                state_dict['sanity'] / 100.0,  # 归一化理智值
                state_dict['day'] / 100.0,  # 归一化天数（假设最多100天）
                (state_dict['time'] % 7200) / 7200.0,  # 一天内的时间进度
                state_dict['x'] / 10000.0,  # 归一化位置（粗略）
                state_dict['y'] / 10000.0,
                # 工具状态（6维）
                state_dict['tools']['axe'],
                state_dict['tools']['pickaxe'],
                state_dict['tools']['spear'],
                state_dict['tools']['bow'],
                state_dict['tools']['rod'],
                state_dict['tools']['armor'],
                # 资源数量（归一化，8维）
                min(state_dict['inventory']['twig'] / 20.0, 1.0),
                min(state_dict['inventory']['flint'] / 20.0, 1.0),
                min(state_dict['inventory']['wood'] / 20.0, 1.0),
                min(state_dict['inventory']['stone'] / 20.0, 1.0),
                min(state_dict['inventory']['grass'] / 20.0, 1.0),
                min(state_dict['inventory']['berry'] / 20.0, 1.0),
                min(state_dict['inventory']['meat'] / 10.0, 1.0),
                min(state_dict['inventory']['gold'] / 10.0, 1.0),
                # 生物群系编码（one-hot，4维）
                1.0 if state_dict['biome'] == 'grassland' else 0.0,
                1.0 if state_dict['biome'] == 'forest' else 0.0,
                1.0 if state_dict['biome'] == 'rocky' else 0.0,
                1.0 if state_dict['biome'] == 'badlands' else 0.0,
                # 状态标志（2维）
                state_dict['isResting'],
                state_dict['isFishing'],
                # 【新增】感知层：最近的资源实体（16维：8种实体 × 2坐标）
                # 每种实体返回 [dx, dy, dist]，我们只取 dx 和 dy（相对位置）
                state_dict['nearest_tree'][0],   # 最近树的相对x
                state_dict['nearest_tree'][1],   # 最近树的相对y
                state_dict['nearest_bush'][0],   # 最近浆果丛的相对x
                state_dict['nearest_bush'][1],   # 最近浆果丛的相对y
                state_dict['nearest_rock'][0],   # 最近石头的相对x
                state_dict['nearest_rock'][1],   # 最近石头的相对y
                state_dict['nearest_flint'][0],  # 最近燧石的相对x
                state_dict['nearest_flint'][1],  # 最近燧石的相对y
                state_dict['nearest_stick'][0],  # 【关键】最近树枝的相对x（制作工具必需）
                state_dict['nearest_stick'][1],  # 【关键】最近树枝的相对y
                state_dict['nearest_grass'][0],  # 【关键】最近草的相对x（制作营火必需）
                state_dict['nearest_grass'][1],  # 【关键】最近草的相对y
                state_dict['nearest_rabbit'][0], # 最近兔子的相对x
                state_dict['nearest_rabbit'][1], # 最近兔子的相对y
                state_dict['nearest_pond'][0],   # 最近鱼塘的相对x
                state_dict['nearest_pond'][1]    # 最近鱼塘的相对y
            ], dtype=np.float32)
            
            # 验证状态维度
            if len(state) != self.state_size:
                print(f"警告: 状态维度不匹配! 期望 {self.state_size}, 实际 {len(state)}")
                print(f"状态向量内容: {state}")
                # 如果维度不匹配，截断或填充
                if len(state) > self.state_size:
                    state = state[:self.state_size]
                else:
                    state = np.pad(state, (0, self.state_size - len(state)), 'constant', constant_values=0.0)
            
            # 更新最后状态
            self.last_state = state
            self.last_state_dict = state_dict  # 保存原始字典用于奖励计算
            self.last_day = state_dict['day']
            self.last_health = state_dict['health']
            self.last_hunger = state_dict['hunger']
            self.last_sanity = state_dict['sanity']
            
            return state
        except Exception as e:
            print(f"获取状态失败: {e}")
            return self.last_state if self.last_state is not None else np.zeros(self.state_size, dtype=np.float32)
    
    def step(self, action):
        """执行动作（修复移动逻辑）"""
        try:
            # 1. 按下按键 / 执行动作
            self.driver.execute_script(f"window.executeAction({action});")
            
            # 2. 【关键修复】保持按键按下状态，运行游戏逻辑！
            # 之前的代码是先松开再跑逻辑，导致Agent寸步难行
            self.driver.execute_script("""
                if (typeof game !== 'undefined') {
                    // 确保不暂停（每步都检查，防止被暂停）
                    if (game.state && game.state.player) {
                        game.state.player.isPaused = false;
                    }
                    
                    // 【关键】游戏逻辑推进 10 帧 (约0.16秒)
                    // 在这期间，按键一直保持按下，Agent 才会移动
                    // 手动调用update()来推进游戏状态和时间
                    for(let i = 0; i < 10; i++) {
                        if (game.update) {
                            // 确保在update前解除暂停
                            if (game.state && game.state.player) {
                                game.state.player.isPaused = false;
                            }
                            game.update();
                        }
                    }
                }
            """)
            
            # 3. 动作结束，如果是移动指令，现在才松开按键
            if action < 4:  # 0,1,2,3 是移动
                key_map = {0: 'KeyW', 1: 'KeyS', 2: 'KeyA', 3: 'KeyD'}
                self.driver.execute_script(f"game.keys['{key_map[action]}'] = false;")
            
        except Exception as e:
            print(f"执行动作失败: {e}")
        
        # 获取新状态
        next_state = self.get_state()
        if next_state is None:
            next_state = self.last_state if self.last_state is not None else np.zeros(self.state_size, dtype=np.float32)
        
        # 【关键】检查游戏是否真的还在运行（防止页面刷新导致失联）
        try:
            game_alive = self.driver.execute_script("return typeof game !== 'undefined' && game.state !== undefined;")
            if not game_alive:
                print("⚠️ 警告：游戏对象丢失，可能页面已刷新！")
                done = True  # 强制结束
                return next_state, -100.0, done  # 给予惩罚
        except Exception as e:
            # 如果JS调用失败，说明页面可能已刷新
            print(f"⚠️ 警告：无法访问游戏对象: {e}")
            done = True
            return next_state, -100.0, done
        
        # 计算奖励（传入当前动作以支持好奇心奖励）
        reward = self._calculate_reward(action)
        
        # 检查是否结束（死亡）
        done = self.last_health <= 0
        
        # 【调试】如果死亡，打印信息
        if done:
            step_count = getattr(self, '_step_count', 0)
            print(f"💀 Agent死亡！存活天数: {self.last_day}, 步数: {step_count}")
        
        return next_state, reward, done
    
    def _calculate_reward(self, action=None):
        """计算奖励"""
        reward = 0.0
        
        # 【新增】好奇心奖励：鼓励尝试新动作
        if action is not None:
            if action not in self.tried_actions:
                # 这是一个新动作，给予好奇心奖励
                curiosity_reward = 0.5  # 好奇心奖励值
                reward += curiosity_reward
                self.tried_actions.add(action)
                # 动作名称映射（用于调试输出）
                action_names = {
                    0: '上移', 1: '下移', 2: '左移', 3: '右移',
                    4: '无动作', 5: '制作斧头', 6: '制作矿镐', 7: '制作长矛',
                    8: '制作弓箭', 9: '制作鱼竿', 10: '制作营火',
                    11: '吃浆果', 12: '吃小肉', 13: '种植松果',
                    14: '休息', 15: '交互/采集'
                }
                action_name = action_names.get(action, f'动作{action}')
        
        # 存活奖励（每步小奖励，提高以鼓励存活）
        reward += 0.1  # 从0.01提高到0.1，提高10倍
        
        # 天数增加奖励（大幅提高）
        if hasattr(self, 'prev_day'):
            if self.last_day > self.prev_day:
                reward += 50.0  # 每过一天奖励50分（从10提高到50）
                print(f"🎉 过了一天！当前第{self.last_day}天 (+50奖励)")
        self.prev_day = self.last_day
        
        # 生命值变化
        if hasattr(self, 'prev_health'):
            health_diff = self.last_health - self.prev_health
            reward += health_diff * 0.1  # 生命值增加是好事
            if self.last_health <= 0:
                reward -= 100.0  # 死亡惩罚
        self.prev_health = self.last_health
        
        # 饱食度变化
        if hasattr(self, 'prev_hunger'):
            hunger_diff = self.last_hunger - self.prev_hunger
            if hunger_diff > 0:
                reward += hunger_diff * 0.05  # 饱食度增加是好事
            elif hunger_diff < -5:  # 饱食度大幅下降
                reward -= 0.5
        self.prev_hunger = self.last_hunger
        
        # 【新增】资源获取奖励（鼓励采集）
        if hasattr(self, 'last_state_dict') and self.last_state_dict:
            inv = self.last_state_dict.get('inventory', {})
            tools = self.last_state_dict.get('tools', {})
            
            # 【新增】工具制作奖励（鼓励制作工具）
            if hasattr(self, 'prev_tools') and self.prev_tools:
                prev_tools = self.prev_tools
                # 检测工具制作（大幅提高奖励，让Agent更容易学会制作工具）
                tool_rewards = {
                    'pickaxe': 5.0,  # 制作矿镐奖励（重要工具，大幅提高）
                    'axe': 5.0,      # 制作斧头奖励（提高，与pickaxe同等重要）
                    'spear': 6.0,    # 制作长矛奖励（战斗工具，最高）
                    'bow': 5.0,      # 制作弓箭奖励（提高）
                    'rod': 4.0       # 制作鱼竿奖励（提高）
                }
                
                for tool_name, tool_reward in tool_rewards.items():
                    if tools.get(tool_name, 0) and not prev_tools.get(tool_name, 0):
                        reward += tool_reward
                        print(f"🎉 奖励：制作了{tool_name} (+{tool_reward})")  # 调试用，可以看到制作工具
                
                self.prev_tools = tools.copy() if tools else {}
            else:
                # 第一次，初始化prev_tools
                self.prev_tools = tools.copy() if tools else {}
            
            if hasattr(self, 'prev_inventory') and self.prev_inventory:
                prev_inv = self.prev_inventory
                
                # 资源增加奖励
                resource_rewards = {
                    'berry': 1,  # 浆果很重要
                    'meat': 1,  # 肉更重要
                    'twig': 1,  # 基础材料
                    'flint': 1,
                    'wood': 1,
                    'stone': 1,  # 提高石头奖励（从0.03到0.04，鼓励挖矿）
                    'grass': 1,
                    'gold': 1     # 金块奖励（稀有资源）
                }
                
                for resource, reward_mult in resource_rewards.items():
                    if resource in inv and resource in prev_inv:
                        if inv[resource] > prev_inv[resource]:
                            reward += (inv[resource] - prev_inv[resource]) * reward_mult
                
                self.prev_inventory = inv.copy() if inv else {}
            else:
                # 第一次，初始化prev_inventory
                self.prev_inventory = inv.copy() if inv else {}
        
        # 理智值变化
        if hasattr(self, 'prev_sanity'):
            sanity_diff = self.last_sanity - self.prev_sanity
            reward += sanity_diff * 0.05  # 理智值增加是好事
        self.prev_sanity = self.last_sanity
        
        return reward
    
    def reset(self):
        """重置游戏（彻底修复版）"""
        # 【新增】重置好奇心奖励：清空已尝试的动作集合
        self.tried_actions = set()
        
        try:
            # 1. 【关键】清空存档，防止加载上局的"僵尸/暂停"状态
            self.driver.execute_script("localStorage.clear();")
            
            # 2. 刷新页面
            self.driver.refresh()
            
            # 3. 等待游戏加载
            try:
                WebDriverWait(self.driver, 5).until(
                    lambda d: d.execute_script("return typeof game !== 'undefined' && game.state !== undefined")
                )
            except:
                pass
            
            # 4. 重新注入逻辑
            self._inject_state_getter()
            
            # 5. 覆盖弹窗函数，防止未来被暂停，并确保游戏主循环运行
            self.driver.execute_script("""
                if (typeof game !== 'undefined') {
                    // 覆盖成就弹窗
                    game.showAchievementPopup = function(name, desc) {
                        console.log('AI获得成就: ' + name);
                        if (game.state && game.state.player) game.state.player.isPaused = false;
                        if (game.pendingAchievements) game.pendingAchievements = [];
                    };
                    
                    // 确保当前未暂停
                    if (game.state && game.state.player) {
                        game.state.player.isPaused = false;
                    }
                    
                    // 【关键】确保游戏主循环在运行
                    // 游戏主循环负责时间推进，如果主循环停止，时间不会推进
                    // 检查主循环是否在运行，如果没有则重新启动
                    if (typeof requestAnimationFrame !== 'undefined') {
                        // 标记主循环正在运行
                        game._loopRunning = true;
                        // 如果主循环停止了，重新启动
                        if (!game._loopActive) {
                            game._loopActive = true;
                            game.loop();
                        }
                    }
                }
            """)
            
        except Exception as e:
            print(f"重置游戏失败: {e}")
        
        # 重置统计变量
        self.last_day = 1
        self.last_health = 100
        self.last_hunger = 100
        self.last_sanity = 100
        self.prev_day = 1
        self.prev_health = 100
        self.prev_hunger = 100
        self.prev_sanity = 100
        self.prev_inventory = {}
        self.prev_tools = {}
        self.last_state_dict = None
        self._step_count = 0  # 重置步数计数器
        
        return self.get_state()
    
    def close(self):
        """关闭浏览器"""
        if self.driver:
            self.driver.quit()
class ActorCritic(nn.Module):
    """PPO 的 Actor-Critic 网络：共享底层，分别输出策略和状态价值"""
    def __init__(self, state_size, action_size, hidden_size=128):
        super(ActorCritic, self).__init__()
        self.fc1 = nn.Linear(state_size, hidden_size)
        self.fc2 = nn.Linear(hidden_size, hidden_size)
        self.policy_head = nn.Linear(hidden_size, action_size)
        self.value_head = nn.Linear(hidden_size, 1)

    def forward(self, x):
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        logits = self.policy_head(x)
        value = self.value_head(x)
        return logits, value


class PPOAgent:
    """离散动作空间的 PPO 算法"""
    def __init__(
        self,
        state_size,
        action_size,
        lr=3e-4,
        gamma=0.99,
        lam=0.95,
        clip_eps=0.2,
        K_epochs=4,
        batch_size=64,
        entropy_coef=0.01,
        value_coef=0.5,
    ):
        self.state_size = state_size
        self.action_size = action_size
        self.gamma = gamma
        self.lam = lam
        self.clip_eps = clip_eps
        self.K_epochs = K_epochs
        self.batch_size = batch_size
        self.entropy_coef = entropy_coef
        self.value_coef = value_coef

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"使用设备: {self.device}")

        self.policy = ActorCritic(state_size, action_size).to(self.device)
        self.optimizer = optim.Adam(self.policy.parameters(), lr=lr)

        # on-policy 轨迹缓存
        self.states = []
        self.actions = []
        self.rewards = []
        self.dones = []
        self.logprobs = []
        self.values = []

    def clear_memory(self):
        self.states.clear()
        self.actions.clear()
        self.rewards.clear()
        self.dones.clear()
        self.logprobs.clear()
        self.values.clear()

    def select_action(self, state):
        """根据当前策略选取动作，并缓存轨迹信息"""
        state_tensor = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        with torch.no_grad():
            logits, value = self.policy(state_tensor)
            dist = Categorical(logits=logits)
            action = dist.sample()
            logprob = dist.log_prob(action)

        action_int = int(action.item())
        self.states.append(state)
        self.actions.append(action_int)
        self.logprobs.append(float(logprob.item()))
        self.values.append(float(value.item()))
        return action_int

    def store_outcome(self, reward, done):
        self.rewards.append(float(reward))
        self.dones.append(float(done))

    def update(self):
        """使用当前 episode 的轨迹进行 PPO 更新"""
        if len(self.rewards) == 0:
            return None

        # 转成张量
        states = torch.FloatTensor(np.array(self.states)).to(self.device)
        actions = torch.LongTensor(self.actions).to(self.device)
        old_logprobs = torch.FloatTensor(self.logprobs).to(self.device)
        rewards = torch.FloatTensor(self.rewards).to(self.device)
        dones = torch.FloatTensor(self.dones).to(self.device)
        values = torch.FloatTensor(self.values).to(self.device)

        # 计算 GAE 优势函数和回报
        advantages = torch.zeros_like(rewards).to(self.device)
        returns = torch.zeros_like(rewards).to(self.device)

        next_advantage = 0.0
        next_value = 0.0  # 截断为 0（大部分情况下 episode 以 done 结束）

        for t in reversed(range(len(rewards))):
            mask = 1.0 - dones[t]
            delta = rewards[t] + self.gamma * next_value * mask - values[t]
            next_advantage = delta + self.gamma * self.lam * mask * next_advantage
            advantages[t] = next_advantage
            next_value = values[t]

        returns = advantages + values
        # 归一化优势
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        # PPO 多轮更新
        total_loss = 0.0
        n = len(rewards)
        idxs = np.arange(n)

        for _ in range(self.K_epochs):
            np.random.shuffle(idxs)
            for start in range(0, n, self.batch_size):
                end = start + self.batch_size
                batch_idx = idxs[start:end]
                b_states = states[batch_idx]
                b_actions = actions[batch_idx]
                b_old_logprobs = old_logprobs[batch_idx]
                b_advantages = advantages[batch_idx]
                b_returns = returns[batch_idx]

                logits, state_values = self.policy(b_states)
                dist = Categorical(logits=logits)
                logprobs = dist.log_prob(b_actions)
                entropy = dist.entropy().mean()

                ratios = torch.exp(logprobs - b_old_logprobs)
                surr1 = ratios * b_advantages
                surr2 = torch.clamp(ratios, 1.0 - self.clip_eps, 1.0 + self.clip_eps) * b_advantages
                policy_loss = -torch.min(surr1, surr2).mean()

                value_loss = F.mse_loss(state_values.squeeze(-1), b_returns)
                loss = policy_loss + self.value_coef * value_loss - self.entropy_coef * entropy

                self.optimizer.zero_grad()
                loss.backward()
                self.optimizer.step()

                total_loss += loss.item()

        self.clear_memory()
        return total_loss / max(1, (self.K_epochs * (n // self.batch_size + 1)))


def train_ppo(episodes=100, max_steps=10000, headless=True):
    """使用 PPO 算法训练代理"""
    print("【PPO】初始化游戏环境...")
    env = GameEnvironment(headless=headless)
    env.start()
    
    print("【PPO】初始化PPO代理...")
    agent = PPOAgent(env.state_size, env.action_space_size)
    
    # 训练统计
    scores = []
    max_days = []
    
    print(f"【PPO】开始训练，共{episodes}个回合...")
    
    for episode in range(episodes):
        state = env.reset()
        agent.clear_memory()
        total_reward = 0.0
        steps = 0
        max_day_in_episode = 1
        
        for step in range(max_steps):
            # 选择动作（PPO 策略）
            action = agent.select_action(state)
            
            # 执行动作
            next_state, reward, done = env.step(action)
            agent.store_outcome(reward, done)
            
            state = next_state
            total_reward += reward
            steps += 1
            max_day_in_episode = max(max_day_in_episode, env.last_day)
            
            if done:
                break
        
        # 使用整条轨迹做一次 PPO 更新
        loss = agent.update()
        
        scores.append(total_reward)
        max_days.append(max_day_in_episode)
        
        # 统计信息
        avg_score = np.mean(scores[-10:]) if len(scores) >= 10 else np.mean(scores) if scores else 0
        avg_days = np.mean(max_days[-10:]) if len(max_days) >= 10 else np.mean(max_days) if max_days else 0
        best_days = max(max_days) if max_days else 0
        
        progress_indicator = ""
        if episode > 0 and len(max_days) > 1 and max_day_in_episode > max_days[-2]:
            progress_indicator = " ⬆️"
        elif episode > 0 and len(max_days) > 1 and max_day_in_episode < max_days[-2]:
            progress_indicator = " ⬇️"
        
        # 【调试】检查游戏状态（如果步数异常多，说明可能卡住了）
        debug_info = ""
        if steps >= 5000:
            try:
                game_state = env.driver.execute_script("""
                    if (typeof game !== 'undefined' && game.state) {
                        return {
                            day: game.state.day,
                            time: game.state.time,
                            isPaused: game.state.player.isPaused,
                            health: game.state.player.health,
                            hunger: game.state.player.hunger
                        };
                    }
                    return null;
                """)
                if game_state:
                    debug_info = (f" | 游戏时间:{game_state['time']}/{7200} | 暂停:{game_state['isPaused']} | "
                                  f"生命:{game_state['health']:.0f} | 饱食:{game_state['hunger']:.0f}")
            except:
                pass
        
        print(f"【PPO】回合 {episode+1}/{episodes} | "
              f"存活天数: {max_day_in_episode}{progress_indicator} | "
              f"总奖励: {total_reward:.2f} | "
              f"步数: {steps} | "
              f"平均存活: {avg_days:.2f} | "
              f"最佳: {best_days}{debug_info}")
        
        # 保存模型
        if episode % 20 == 0 and episode > 0:
            torch.save(agent.policy.state_dict(), f'ppo_model_episode_{episode}.pth')
            print(f"【PPO】模型已保存: ppo_model_episode_{episode}.pth")
        
        # 每回合保存统计数据（用于实时可视化）
        stats = {
            'scores': list(scores),
            'max_days': list(max_days),
            'best_days': max(max_days) if max_days else 0,
            'avg_days': np.mean(max_days) if max_days else 0
        }
        with open('training_stats.json', 'w') as f:
            json.dump(stats, f, indent=2)
    
    # 保存最终模型
    torch.save(agent.policy.state_dict(), 'ppo_model_final.pth')
    print("【PPO】训练完成！最终模型已保存: ppo_model_final.pth")
    
    # 保存训练统计
    stats = {
        'scores': scores,
        'max_days': max_days,
        'best_days': max(max_days) if max_days else 0,
        'avg_days': np.mean(max_days) if max_days else 0
    }
    with open('training_stats.json', 'w') as f:
        json.dump(stats, f, indent=2)
    print(f"【PPO】训练统计已保存: training_stats.json")
    print(f"【PPO】最佳存活天数: {stats['best_days']}")
    print(f"【PPO】平均存活天数: {stats['avg_days']:.2f}")
    
    env.close()

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='训练饥荒游戏AI代理')
    parser.add_argument('--episodes', type=int, default=100, help='训练回合数')
    parser.add_argument('--headless', action='store_true', help='无头模式（不显示浏览器）')
    parser.add_argument('--max-steps', type=int, default=10000, help='每回合最大步数')
    
    args = parser.parse_args()
    
    print("使用 PPO 算法进行训练...")
    train_ppo(episodes=args.episodes, max_steps=args.max_steps, headless=args.headless)

