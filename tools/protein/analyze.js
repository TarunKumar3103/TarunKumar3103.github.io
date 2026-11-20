// node analyze.js <key> ents|melt|refold [args]
const { makeProteinSim } = require('../src/protein-sim.js');
const key = process.argv[2], mode = process.argv[3];
const C = require('./cands.json');
const P = key === 'trx' ? require('../src/protein-data.json') : C[key];
const ca = P.ca;
if (mode === 'ents') {
  const sim = makeProteinSim(ca, {});
  const e = sim.entanglements();
  console.log(key, 'N', ca.length, 'contacts', sim.NC, 'per residue', (2 * sim.NC / ca.length).toFixed(2), 'native entanglements', e.length);
  const byLoop = {};
  for (const x of e) { const k = x.side; (byLoop[k] = byLoop[k] || []).push(x); }
  for (const s of ['N', 'C']) {
    const L = (byLoop[s] || []).sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
    console.log(' side', s, L.length, L.slice(0, 12).map((x) => `${x.i + P.offset}-${x.j + P.offset}(${x.g.toFixed(2)})`).join(' '));
  }
}
if (mode === 'melt') {
  const Ts = (process.argv[4] || '0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3').split(',').map(Number);
  for (const T of Ts) {
    const sim = makeProteinSim(ca, { T, seed: 7 });
    const qs = [];
    for (let b = 0; b < 50; b++) { sim.step(2000); qs.push(sim.measure()); }
    const tail = qs.slice(20);
    console.log(key, 'T', T, 'Q mean', (tail.reduce((a, b) => a + b, 0) / tail.length).toFixed(2), 'min', Math.min(...tail).toFixed(2), 'trace', qs.filter((_, i) => i % 5 === 0).map((q) => q.toFixed(2)).join(' '));
  }
}
if (mode === 'refold') {
  const [Thot, Tcold] = (process.argv[4] || '1.4,0.7').split(',').map(Number);
  const seeds = +(process.argv[5] || 5);
  const sim0 = makeProteinSim(ca, {});
  const nat = sim0.entanglements();
  for (let seed = 1; seed <= seeds; seed++) {
    const sim = makeProteinSim(ca, { T: Thot, seed });
    let s = 0;
    while (sim.measure() > 0.15 && s < 400000) { sim.step(500); s += 500; }
    const meltSteps = s;
    sim.setT(Tcold); s = 0;
    let hit = null;
    while (s < 900000) { sim.step(1000); s += 1000; if (sim.measure() > 0.8) { hit = s; break; } }
    const ents = sim.entanglements();
    const natKeys = new Set(nat.map((e) => e.i + ',' + e.j + ',' + e.side + ',' + Math.sign(e.g)));
    const nNat = ents.filter((e) => natKeys.has(e.i + ',' + e.j + ',' + e.side + ',' + Math.sign(e.g))).length;
    console.log(`${key} seed ${seed}: melted in ${meltSteps}, refold Q>0.8 in ${hit === null ? '>900k' : hit}, Q ${sim.measure().toFixed(2)}, ents now ${ents.length} (native ${nNat} of ${nat.length})`);
  }
}
if (mode === 'speed') {
  const sim = makeProteinSim(ca, { T: 0.7 });
  sim.step(2000);
  const t = process.hrtime.bigint(); sim.step(20000); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(key, 'steps per ms', (20000 / ms).toFixed(1));
}
