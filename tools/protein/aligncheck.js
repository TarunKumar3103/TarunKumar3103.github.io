const { makeProteinDriver } = require('../src/protein-sim.js');
const d = require('../src/protein-data.json');
const drv = makeProteinDriver({ ca: d.ca, opts: { T: 0.7 }, ents: d.ents, rep: d.rep });
// spin the whole molecule by a random rotation: the driver must undo it exactly
const x = drv.sim.x, N = drv.N, th = 1.1, ax = [0.3, -0.8, 0.52], l = Math.hypot(...ax), u = ax.map((v) => v / l);
const c = Math.cos(th), s = Math.sin(th), K = [[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]];
const Rm = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + s * K[i][j] + (1 - c) * [0, 1, 2].reduce((acc, k) => acc + K[i][k] * K[k][j], 0)));
for (let i = 0; i < N; i++) { const p = [x[3 * i] + 5, x[3 * i + 1] - 7, x[3 * i + 2] + 2]; for (let a = 0; a < 3; a++) x[3 * i + a] = Rm[a][0] * p[0] + Rm[a][1] * p[1] + Rm[a][2] * p[2]; }
const fr = drv.tick(0);
const c0 = [0, 0, 0]; for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) c0[a] += d.ca[i][a] / N;
let rms = 0; for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) rms += (fr.pos[3 * i + a] - (d.ca[i][a] - c0[a])) ** 2;
console.log('alignment error after a random rotation and shift (A, RMS):', Math.sqrt(rms / N).toExponential(2));
console.log('first frame: Q', fr.Q.toFixed(2), 'threading shown', JSON.stringify(fr.ent));
// a few seconds of page time at rest
let t = Date.now(); for (let k = 0; k < 240; k++) drv.tick(260); const ms = (Date.now() - t) / 240;
const f2 = drv.tick(260);
console.log('per frame with 260 steps: %s ms; Q %s; threading %s', ms.toFixed(1), f2.Q.toFixed(2), JSON.stringify(f2.ent && { i: f2.ent.i, j: f2.ent.j, side: f2.ent.side, native: f2.ent.native }));
