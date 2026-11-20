// How often does a hard pull leave thioredoxin unable to settle by itself? node pullstuck.js seed0 n
const { makeProteinDriver } = require('../src/protein-sim.js');
const P = require('../src/protein-data.json').find((d) => d.key === 'trx');
const [s0, n] = [+process.argv[2], +process.argv[3]];
const out = [];
for (let seed = s0; seed < s0 + n; seed++) {
  const drv = makeProteinDriver({ ca: P.ca, opts: { T: 0.7, seed }, ents: P.ents, rep: P.rep });
  let fr = drv.tick(0);
  const p0 = [fr.pos[3 * 55], fr.pos[3 * 55 + 1], fr.pos[3 * 55 + 2]];
  for (let k = 1; k <= 60; k++) { drv.setPull(55, [p0[0] + 0.9 * k, p0[1] + 0.36 * k, p0[2]]); fr = drv.tick(200); }   // drag about 60 A over ~1 s of physics
  drv.setPull(-1);
  let t = 0, ok = 0, hit = null, last = null;
  while (t < 360000) {
    fr = drv.tick(200); t += 200;
    if (t % 1000 === 0) { const e = fr.ent; last = [fr.Q.toFixed(2), e ? `${e.i}-${e.j}${e.side}${e.native ? '' : '!'}` : 'none'];
      if (fr.Q > 0.86 && e && e.native) { if (++ok >= 3) { hit = t; break; } } else ok = 0; }
  }
  out.push(hit === null ? `stuck(${last.join(' ')})` : Math.round(hit / 1000) + 'k');
}
console.log(out.join(' '));
