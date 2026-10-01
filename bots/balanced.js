import { headRisk, moves, nearestApple, nextCell, openArea, serve } from "./common.js";

serve((observation) => {
  const options = moves(observation);
  const me = observation.board.snakes.find((snake) => snake.id === observation.you);
  const value = (direction) => {
    const cell = nextCell(me.body[0], direction, observation.board);
    return openArea(cell, observation) * 0.2 - nearestApple(cell, observation) * 3 -
      (headRisk(cell, observation) ? 35 : 0);
  };
  return options.sort((a, b) => value(b) - value(a))[0] ?? me.direction;
});
