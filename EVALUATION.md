# 策略迭代与自动评测

这套命令行评测器让新策略先挑战 `bots/balanced.js`（均衡选手），晋级后继续挑战上一版冠军。它运行的是策略程序之间的比赛；AI 模型负责修改自己的 `bots/*.js`，可反复调用评测命令分析结果。评测器本身不会调用模型 API 或自动改写策略。

在项目根目录打开终端。项目只需 Node.js 20+，不用安装依赖。

## 一轮迭代

1. 将模型写出的程序存为 `bots/my_bot.js`，先确认符合 [BOT_PROTOCOL.md](BOT_PROTOCOL.md)。最好让每版使用不同文件名，例如 `bots/my_bot_v01.js`。
2. 用固定训练种子快速调试：

   ```powershell
   node src/evaluate.js --candidate bots/my_bot_v01.js --against baseline --seeds 10 --turns 500 --label my_bot_v01
   ```

   尚无冠军时，省略 `--against` 也会选均衡选手；有冠军后，默认对手是当前冠军。训练种子默认从 `20270000` 起，可用 `--seed-base` 复现其他训练局。
3. 查看终端中的独胜率、平均最终分、死亡次数、吃苹果次数和错误数。完整逐局结果见 `evaluations/reports/`；最多两场败局回放存于 `replays/`，可以在网页的“历史回放”中查看。报告每局的 `replay` 字段记录对应文件。
4. 让模型分析失败局面并修改策略，然后继续第 2 步。每个种子都会让候选策略分别占据两个出发位置，各打一场。
5. 满意后执行正式晋级检查：

   ```powershell
   node src/evaluate.js --candidate bots/my_bot_v01.js --label my_bot_v01 --promote
   ```

   正式检查使用新生成的种子，每组两个位置，默认 40 组、每场完整 500 回合。第一次晋级需对均衡选手达到至少 70% **独胜率**、平均最终分领先且没有程序错误。有冠军后，需对当前冠军达到至少 60% 独胜率，还需对均衡选手达到至少 70% 独胜率；两组都要平均最终分领先、零程序错误。平局不计入独胜。没达标也会保存报告，但不会替换冠军。
6. 晋级版本会登记到 `evaluations/champion.json`，编号 `v001`、`v002`……。下一版默认挑战当前冠军，也可以用 `--against v001` 对战历史冠军；旧版代码快照保存在 `evaluations/snapshots/`，无需依赖后来修改的原文件。

## 其他评测命令

```powershell
# 随机新种子，先进行非晋级摸底
node src/evaluate.js --candidate bots/my_bot_v02.js --against champion --suite fresh --seeds 20

# 对战一个指定的本地策略文件
node src/evaluate.js --candidate bots/my_bot_v02.js --against bots/greedy.js --seeds 10

# 查看全部参数
node src/evaluate.js --help
```

也可以运行 `npm.cmd run evaluate -- --candidate bots/my_bot_v02.js --against baseline`。网页原有的四蛇比赛和锦标赛仍可用于最终多人对战；两蛇评测是迭代筛选，不等于四蛇最终名次。

## 公平性与记录

- 同一组种子的两局交换双方位置；报告保存种子、位置、逐局结果和双方源码哈希，方便复现。随机种子不会消除所有运气，接近门槛时应增加样本。
- 比赛前会为策略及其字面量相对 `.js` 依赖创建内容快照，比赛后校验快照。建议候选程序放在 `bots/` 内，不使用动态加载文件或外部 npm 包；这样报告才能对应到完整策略代码。
- 将最终测试的种子留到**停止改代码之后**再运行。模型每次看见某组随机测试结果后，这组结果就不再适合当作独立的最终检验。
- 本地比赛器限制响应时间，但策略程序不是操作系统沙箱。只运行自己编写或审查过的代码。
