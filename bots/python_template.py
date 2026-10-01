"""Optional Python entry: usable after Python is installed on the host."""

import json
import sys


def choose_direction(observation):
    me = next(s for s in observation["board"]["snakes"] if s["id"] == observation["you"])
    # Replace this with your strategy. The engine rejects a 180-degree reversal.
    return me["direction"]


for line in sys.stdin:
    try:
        state = json.loads(line)
        answer = {"direction": choose_direction(state)}
        print(json.dumps(answer), flush=True)
    except Exception as error:
        print(f"Bot error: {error}", file=sys.stderr, flush=True)
        print('{"direction":"UP"}', flush=True)
