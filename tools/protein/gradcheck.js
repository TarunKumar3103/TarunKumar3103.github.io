const { makeProteinSim } = require('../src/protein-sim.js');
const D = require('./trxA.json');
const ca = D.ca.slice(2);
const sim = makeProteinSim(ca, { T: 0.5 });
// a disturbed structure, so every term is away from its minimum
let s = 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
for (let i = 0; i < sim.x.length; i++) sim.x[i] += rnd() * 1.2;
const X = new Float64Array(sim.x);
sim._energyAt(X);           // rebuild the neighbour list for this structure
sim.x.set(X); sim._forces();
const F = new Float64Array(sim.f);
let worst = 0, scale = 0;
for (let k = 0; k < X.length; k += 7) {
  const h = 1e-5, Xp = new Float64Array(X), Xm = new Float64Array(X);
  Xp[k] += h; Xm[k] -= h;
  const num = -(sim._energyAt(Xp) - sim._energyAt(Xm)) / (2 * h);
  worst = Math.max(worst, Math.abs(num - F[k])); scale = Math.max(scale, Math.abs(F[k]));
}
console.log('largest force', scale.toFixed(3), 'worst mismatch vs numerical gradient', worst.toExponential(2));
