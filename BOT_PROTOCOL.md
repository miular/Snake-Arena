# 选手程序协议

每名选手对应一个独立常驻进程。比赛器每回合向其**标准输入**写入一行 UTF-8 JSON；选手必须向**标准输出**写入一行 UTF-8 JSON。调试信息应写入标准错误。参赛程序可以在自己的进程内保存跨回合状态，但一场新比赛会启动新进程。

输入示例：

```json
{"turn":42,"maxTurns":500,"board":{"width":20,"height":20,"apples":[[7,4],[12,9]],"snakes":[{"id":"snake-1","name":"模型 A","body":[[3,4],[2,4]],"direction":"RIGHT","score":2,"deaths":0,"applesEaten":2},{"id":"snake-2","name":"模型 B","body":[[10,9]],"direction":"UP","score":0,"deaths":1,"applesEaten":1}]},"you":"snake-1"}
```

其中 `body[0]` 是蛇头。已死亡、尚未重生的蛇有空的 `body`。`applesEaten` 是本场比赛累计吃到的苹果数，`score` 是碰撞重置后的当前分数。所有坐标和蛇身均为公开信息；程序不会收到游戏引擎的随机数状态。

输出示例：

```json
{"direction":"UP"}
```

方向是棋盘上的绝对方向。每条输入必须恰好有一条输出；不要在标准输出打印说明文字、日志或多余空行。响应必须在时限内完成。游戏会把无效方向和 180 度掉头视为沿原方向继续移动。

`roster.json` 中每项的 `command` 是可执行文件，`args` 是参数数组。`command` 为 `node` 时，比赛器会使用当前 Node.js 可执行文件；其他命令直接启动对应程序，不经过 shell。所有相对路径以项目根目录为起点。
