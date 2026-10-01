import { headRisk, moves, nextCell, serve } from "./common.js";

serve((observation) => {
  const options = moves(observation);
  const me = observation.board.snakes.find((snake) => snake.id === observation.you);
  const safe = options.filter((direction) =>
    !headRisk(nextCell(me.body[0], direction, observation.board), observation));
  const choices = safe.length ? safe : options;
  const hash = observation.turn * 17 + me.body[0][0] * 31 + me.body[0][1] * 43;
  return choices[hash % choices.length] ?? me.direction;
});
