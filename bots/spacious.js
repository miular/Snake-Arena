import { headRisk, moves, nextCell, openArea, serve } from "./common.js";

serve((observation) => {
  const options = moves(observation);
  const me = observation.board.snakes.find((snake) => snake.id === observation.you);
  return options.sort((a, b) => {
    const ca = nextCell(me.body[0], a, observation.board);
    const cb = nextCell(me.body[0], b, observation.board);
    return (openArea(cb, observation) - (headRisk(cb, observation) ? 30 : 0)) -
      (openArea(ca, observation) - (headRisk(ca, observation) ? 30 : 0));
  })[0] ?? me.direction;
});
