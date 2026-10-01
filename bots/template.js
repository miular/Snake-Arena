import { moves, serve } from "./common.js";

// Replace this decision function with a strategy written by your AI model.
serve((observation) => {
  const me = observation.board.snakes.find((snake) => snake.id === observation.you);
  return moves(observation)[0] ?? me.direction;
});
