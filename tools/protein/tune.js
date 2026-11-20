const { makeProteinSim } = require('../src/protein-sim.js');
const ca = require('./trxA.json').ca.slice(2);
const mode = process.argv[2];
if (mode === 'speed') {
  const sim = makeProteinSim(ca, { T: 0.6 });
  sim.step(2000);
  const t = process.hrtime.bigint(); sim.step(20000); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log('steps per ms', (20000 / ms).toFixed(1), '| steps per 60 Hz frame within 8 ms:', Math.round(8 * 20000 / ms));
}
if (mode === 'melt') {
  for (const T of (process.argv[3] || '0.4,0.6,0.8,0.9,1.0,1.1,1.2').split(',').map(Number)) {
    const sim = makeProteinSim(ca, { T, seed: 7 });
    let qs = [];
    for (let b = 0; b < 60; b++) { sim.step(2000); qs.push(sim.measure()); }
    const tail = qs.slice(30);
    console.log('T', T, 'Q mean', (tail.reduce((a, b) => a + b, 0) / tail.length).toFixed(2), 'min', Math.min(...tail).toFixed(2), 'trace', qs.filter((_, i) => i % 6 === 0).map((q) => q.toFixed(2)).join(' '));
  }
}
if (mode === 'refold') {
  const [Thot, Tcold, gamma, dt] = (process.argv[3] || '1.4,0.6,0.1,0.012').split(',').map(Number);
  for (let seed = 1; seed <= 6; seed++) {
    const sim = makeProteinSim(ca, { T: Thot, seed, gamma, dt });
    let s = 0;
    while (sim.measure() > 0.15 && s < 400000) { sim.step(1000); s += 1000; }
    const meltSteps = s;
    sim.setT(Tcold); s = 0;
    let hit = null;
    while (s < 600000) { sim.step(1000); s += 1000; if (sim.measure() > 0.8) { hit = s; break; } }
    const ents = sim.entanglements();
    const native = ents.some((e) => e.side === 'N' && e.i >= 30 && e.i <= 36 && e.j >= 70 && e.j <= 76);
    console.log(`seed ${seed}: melted in ${meltSteps} steps, refolded (Q>0.8) in ${hit === null ? '>600k' : hit} steps, Q now ${sim.measure().toFixed(2)}, threading: ${native ? 'native' : ents.length ? 'other ' + ents.slice(0, 2).map((e) => e.i + '-' + e.j + e.side).join(',') : 'none'}`);
  }
}
