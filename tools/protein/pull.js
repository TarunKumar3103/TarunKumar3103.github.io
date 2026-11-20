const { makeProteinSim } = require('../src/protein-sim.js');
const ca = require('./trxA.json').ca.slice(2);
for (const [who, idx] of [['N-terminal end (Asp3)', 0], ['C-terminal end (Ala109)', 106], ['middle (Lys58)', 55]]) {
  const sim = makeProteinSim(ca, { T: 0.7, seed: 4 });
  sim.step(4000);
  // drag the residue steadily 45 angstroms out from the centre over about 2 seconds of page time
  const c = [0, 0, 0]; for (let i = 0; i < sim.N; i++) for (let a = 0; a < 3; a++) c[a] += sim.x[3 * i + a] / sim.N;
  const p0 = [sim.x[3 * idx], sim.x[3 * idx + 1], sim.x[3 * idx + 2]], dir = p0.map((v, a) => v - c[a]), L = Math.hypot(...dir);
  sim.pull.i = idx;
  for (let k = 1; k <= 30; k++) { const r = L + 60 * k / 30; sim.pull.x = c[0] + dir[0] / L * r; sim.pull.y = c[1] + dir[1] / L * r; sim.pull.z = c[2] + dir[2] / L * r; sim.step(1000); }
  const q1 = sim.measure(), e1 = sim.entanglements().filter((e) => e.side === 'N' && e.i >= 30 && e.i <= 36 && e.j >= 70 && e.j <= 76).length;
  sim.pull.i = -1;
  let s = 0, back = null; while (s < 300000) { sim.step(1000); s += 1000; if (sim.measure() > 0.8) { back = s; break; } }
  const e2 = sim.entanglements().some((e) => e.side === 'N' && e.i >= 30 && e.i <= 36 && e.j >= 70 && e.j <= 76);
  console.log(`${who}: after pulling Q ${q1.toFixed(2)}, native threading ${e1 ? 'still there' : 'gone'}; let go -> Q>0.8 after ${back === null ? '>300k' : back} steps, threading ${e2 ? 'back' : 'not back'}`);
}
