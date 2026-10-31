// Knowledge-Graph physics — pure functions over {n, edges, pos, fixed, alpha, k},
// kept out of graph.js so the layout can be measured off-DOM.
//
//   seedLayout   one-shot Fruchterman–Reingold to give the live sim a sane start
//   stepSim      one tick of the live simulation (shared by seed + rAF loop)
//   ringLayout   fallback placement for ranges above MAX_LIVE

export const W = 800, H = 520, PAD = 28;

// Long-range repulsion is capped past DMAX: FR's 1/d push is unbounded, so
// disconnected clusters (words in different topics share no edge) otherwise fly
// apart until they jam into the walls. Capping lets clusters separate at medium
// range while gravity keeps the whole cloud centered and on-screen.
export const DMAX = 300;

// Gravity has to be measured against the crowd's push, not picked as a small
// constant. Pairwise repulsion is k²/d with k² = W·H/n, so the total push on a
// node is ~W·H/d whatever n is. A fixed pull of 0.03·distance loses that contest
// by two orders of magnitude, and every node without an edge to hold it ends up
// clamped against a wall. GRAVITY is the pull, as a multiple of W·H/R², that
// balances the crowd at the rim of the drawable area. Each axis gets its own
// pull (the canvas is wider than tall), so the cloud fills an ellipse instead of
// a circle with empty margins left and right. At 0.7 no node ends up on a wall
// for any demo-vault range from 7 to 150 nodes, and the layout still covers most
// of the canvas; 0.5 left some pinned, 1.0 crowded the middle. Re-measure with
// tools/bench-knowledge-layout.mjs after touching the forces.
export const GRAVITY = 0.7;
const RX = W / 2 - PAD, RY = H / 2 - PAD;
const GX = (GRAVITY * W * H) / (RX * RX), GY = (GRAVITY * W * H) / (RY * RY);

// One-shot Fruchterman–Reingold, used only to SEED the live sim with a sane
// starting layout (a cold start from random positions looks chaotic).
export function seedLayout(n, edges, iterations = 120) {
  const pos = Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * W * 0.5 + W / 2,
    y: (Math.random() - 0.5) * H * 0.5 + H / 2,
  }));
  const sim = { n, edges, pos, fixed: new Set(), alpha: 1, k: Math.sqrt((W * H) / Math.max(1, n)) };
  for (let i = 0; i < iterations; i++) { stepSim(sim); sim.alpha *= 0.99; }
  return pos;
}

// A single tick of the live simulation. `fixed` nodes (the one you're dragging)
// don't move; `alpha` is the temperature we reheat on drag.
export function stepSim(sim) {
  const { pos, edges, fixed, n, k } = sim;
  const disp = pos.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
      let d = Math.hypot(dx, dy) || 0.01;
      if (d > DMAX) continue;
      const rep = (k * k) / d, ux = dx / d, uy = dy / d;
      disp[i].x += ux * rep; disp[i].y += uy * rep;
      disp[j].x -= ux * rep; disp[j].y -= uy * rep;
    }
  for (const e of edges) {
    let dx = pos[e.a].x - pos[e.b].x, dy = pos[e.a].y - pos[e.b].y;
    let d = Math.hypot(dx, dy) || 0.01;
    const att = (d * d) / k, ux = dx / d, uy = dy / d;
    disp[e.a].x -= ux * att; disp[e.a].y -= uy * att;
    disp[e.b].x += ux * att; disp[e.b].y += uy * att;
  }
  const max = 12 * sim.alpha + 1;
  for (let i = 0; i < n; i++) {
    if (fixed.has(i)) continue;
    disp[i].x += (W / 2 - pos[i].x) * GX; // gravity keeps the cloud centered
    disp[i].y += (H / 2 - pos[i].y) * GY;
    const sp = Math.hypot(disp[i].x, disp[i].y) || 0.01;
    const s = (Math.min(sp, max) / sp) * sim.alpha; // cooling → smaller steps → settles
    pos[i].x = Math.max(PAD, Math.min(W - PAD, pos[i].x + disp[i].x * s)); // clamp = safety net
    pos[i].y = Math.max(PAD, Math.min(H - PAD, pos[i].y + disp[i].y * s));
  }
}

export function ringLayout(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: W / 2 + Math.cos(a) * (W / 2 - PAD), y: H / 2 + Math.sin(a) * (H / 2 - PAD) };
  });
}
