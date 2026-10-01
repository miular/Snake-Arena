# 参与贡献

欢迎提交游戏规则、网页、文档和策略方面的改进。涉及规则或接口的改动，请同步更新 `RULES.md` 或 `BOT_PROTOCOL.md`。

## 开发环境

- Node.js 20 或更新版本
- 不需要安装 npm 依赖

运行规则与功能测试：

```powershell
node --test
```

## 提交一条策略

1. 阅读 `RULES.md`、`BOT_PROTOCOL.md` 和 `AI_PROMPT.md`。
2. 将策略保存在 `bots/` 下的新 `.js` 文件中；不要覆盖内置策略。
3. 在本地运行配对评测，例如：

   ```powershell
   node src/evaluate.js --candidate bots/my-bot.js --against bots/balanced.js --seeds 20
   ```

4. PR 描述中注明策略版本、对手、局数、评测命令和结果。若修改了策略，再用新的种子进行最终复核。

评测会在本地生成报告、回放和快照，这些运行产物不应提交。请只运行自己编写或审查过的选手程序；当前比赛器不是操作系统沙箱。
