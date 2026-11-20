// node refold2.js <key> <Thot> <Tcold> <seed0> <nseeds> [meltQ]
// Melt until Q < meltQ, then cool, and count steps until Q stays above 0.86 (the page's "folded again" test).
const { makeProteinSim } = require('../src/protein-sim.js');
const [key, Thot, Tcold, s0, ns, meltQ] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], +(process.argv[7] || 0.4)];
const P = require('../src/protein-data.json').find((d) => d.key === key);
const out = [];
for (let seed = s0; seed < s0 + ns; seed++) {
  const sim = makeProteinSim(P.ca, { T: Thot, seed });
  let s = 0; while (sim.measure() > meltQ && s < 300000) { sim.step(500); s += 500; }
  sim.setT(Tcold);
  let t = 0, ok = 0, hit = null, qs = [];
  while (t < 1200000) { sim.step(1000); t += 1000; const q = sim.measure(); if (t % 50000 === 0) qs.push(q.toFixed(2)); if (q > 0.86) { if (++ok >= 3) { hit = t; break; } } else ok = 0; }
  out.push(`${key} Tc ${Tcold} seed ${seed}: melt ${s}, calm at ${hit === null ? '>1.2M (Q ' + sim.measure().toFixed(2) + ' trace ' + qs.slice(-8).join(' ') + ')' : hit}`);
}
console.log(out.join('\n'));
