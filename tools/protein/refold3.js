// node refold3.js <key> <protocol> <seed0> <nseeds> [meltQ]
// Uses the page's driver and its "folded again" test: Q > 0.86 with the native threading back (or no wrong threading).
const { makeProteinDriver } = require('../src/protein-sim.js');
const [key, proto, s0, ns, meltQ] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5], +(process.argv[6] || 0.3)];
const P = require('../src/protein-data.json').find((d) => d.key === key);
const [Tc, Th] = P.T;
const res = [];
for (let seed = s0; seed < s0 + ns; seed++) {
  const drv = makeProteinDriver({ ca: P.ca, opts: { T: Th, seed }, ents: P.ents, rep: P.rep });
  let fr = drv.tick(0), s = 0;
  while (fr.Q > meltQ && s < 300000) { fr = drv.tick(200); s += 200; }
  let t = 0, ok = 0, hit = null;
  const Tof = (t) => {
    if (proto === 'quench') return Tc;
    const m = proto.match(/^exp([\d.]+)_(\d+)$/); if (m) { const T0 = +m[1], tau = +m[2]; return Tc + (T0 - Tc) * Math.exp(-t / tau); }
    const h = proto.match(/^hold([\d.]+)_(\d+)$/); if (h) return t < +h[2] ? +h[1] : Tc;
    throw new Error('protocol');
  };
  while (t < 600000) {
    drv.setT(Tof(t)); fr = drv.tick(200); t += 200;
    const e = fr.ent, threaded = P.rep ? !!(e && e.native) : !(e && !e.native);
    if (t % 1000 === 0) { if (fr.Q > 0.86 && threaded && Tof(t) < Tc + 0.02) { if (++ok >= 3) { hit = t; break; } } else ok = 0; }
  }
  res.push(hit === null ? Infinity : hit);
}
const fin = res.filter(Number.isFinite).sort((a, b) => a - b);
console.log(key, proto, 'melt<' + meltQ, 'times', res.map((x) => (Number.isFinite(x) ? Math.round(x / 1000) + 'k' : 'stuck')).join(' '), '| median', fin.length ? Math.round(fin[Math.floor(fin.length / 2)] / 1000) + 'k' : '-', 'stuck', res.length - fin.length);
