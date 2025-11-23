# AI训练指南

## 安装依赖

```bash
pip install -r requirements.txt
```

## 开始训练

```bash
python train_agent.py --episodes 100 --headless
```

参数：
- `--episodes`: 训练回合数（默认100）
- `--headless`: 无头模式，不显示浏览器（更快）
- `--max-steps`: 每回合最大步数（默认10000）

## 训练输出

- `dqn_model_final.pth`: 最终模型
- `training_stats.json`: 训练统计（包含最佳存活天数）


## macOS注意事项

如果遇到ChromeDriver安全提示，运行：
```bash
xattr -d com.apple.quarantine $(which chromedriver)
```

或在系统偏好设置中允许运行。

