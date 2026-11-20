/* A coarse-grained protein that folds itself: one bead per residue (its C-alpha atom), held together
   by a structure-based model built from the AlphaFold structure (bonds, angles, dihedrals, attraction
   between residues that touch in the native fold, and plain repulsion between all others), moved by
   Langevin dynamics at a chosen temperature. Runs in a Web Worker on the page, or in Node for tuning.
   Units: angstroms and the depth of one native contact. */
function makeProteinSim(native, opts) {
  'use strict';
  const o = Object.assign({ Kb: 100, Kth: 20, K1: 1, K3: 0.5, eps: 1, sigNN: 4, cut: 8, Kcom: 3, dt: 0.012, gamma: 0.1, T: 0.7, seed: 1 }, opts || {});
  const N = native.length;
  const X0 = new Float64Array(3 * N);
  for (let i = 0; i < N; i++) { X0[3 * i] = native[i][0]; X0[3 * i + 1] = native[i][1]; X0[3 * i + 2] = native[i][2]; }
  const x = new Float64Array(X0), v = new Float64Array(3 * N), f = new Float64Array(3 * N);
  const com0 = [0, 0, 0];
  for (let i = 0; i < N; i++) { com0[0] += X0[3 * i] / N; com0[1] += X0[3 * i + 1] / N; com0[2] += X0[3 * i + 2] / N; }
  const d3 = (a, b, X) => Math.hypot(X[3 * a] - X[3 * b], X[3 * a + 1] - X[3 * b + 1], X[3 * a + 2] - X[3 * b + 2]);

  // ---------- the native geometry the model remembers
  const r0 = new Float64Array(N - 1), th0 = new Float64Array(N - 2), ph0 = new Float64Array(N - 3);
  for (let i = 0; i < N - 1; i++) r0[i] = d3(i, i + 1, X0);
  for (let i = 0; i < N - 2; i++) th0[i] = angle(X0, i, i + 1, i + 2);
  for (let i = 0; i < N - 3; i++) ph0[i] = dihedral(X0, i, i + 1, i + 2, i + 3);
  const ci = [], cj = [], cs2 = [];
  const isNative = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = i + 4; j < N; j++) {
    const d = d3(i, j, X0);
    if (d < o.cut) { ci.push(i); cj.push(j); cs2.push(d * d); isNative[i * N + j] = 1; }
  }
  const NC = ci.length;
  const perRes = new Float64Array(N);
  for (let k = 0; k < NC; k++) { perRes[ci[k]]++; perRes[cj[k]]++; }

  // ---------- small helpers
  function angle(X, a, b, c) {
    const ux = X[3 * a] - X[3 * b], uy = X[3 * a + 1] - X[3 * b + 1], uz = X[3 * a + 2] - X[3 * b + 2];
    const wx = X[3 * c] - X[3 * b], wy = X[3 * c + 1] - X[3 * b + 1], wz = X[3 * c + 2] - X[3 * b + 2];
    const cs = (ux * wx + uy * wy + uz * wz) / Math.sqrt((ux * ux + uy * uy + uz * uz) * (wx * wx + wy * wy + wz * wz));
    return Math.acos(Math.max(-1, Math.min(1, cs)));
  }
  function dihedral(X, a, b, c, d) {
    const Fx = X[3 * a] - X[3 * b], Fy = X[3 * a + 1] - X[3 * b + 1], Fz = X[3 * a + 2] - X[3 * b + 2];
    const Gx = X[3 * b] - X[3 * c], Gy = X[3 * b + 1] - X[3 * c + 1], Gz = X[3 * b + 2] - X[3 * c + 2];
    const Hx = X[3 * d] - X[3 * c], Hy = X[3 * d + 1] - X[3 * c + 1], Hz = X[3 * d + 2] - X[3 * c + 2];
    const Ax = Fy * Gz - Fz * Gy, Ay = Fz * Gx - Fx * Gz, Az = Fx * Gy - Fy * Gx;
    const Bx = Hy * Gz - Hz * Gy, By = Hz * Gx - Hx * Gz, Bz = Hx * Gy - Hy * Gx;
    const gl = Math.sqrt(Gx * Gx + Gy * Gy + Gz * Gz);
    const cx = By * Az - Bz * Ay, cy = Bz * Ax - Bx * Az, cz = Bx * Ay - By * Ax;   // B x A
    return Math.atan2((cx * Gx + cy * Gy + cz * Gz) / gl, Ax * Bx + Ay * By + Az * Bz);
  }
  let seed = o.seed >>> 0 || 1, spare = null;
  function gauss() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, w, s;
    do {
      seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; u = seed / 4294967296 * 2 - 1;
      seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; w = seed / 4294967296 * 2 - 1;
      s = u * u + w * w;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s); spare = w * m; return u * m;
  }

  // ---------- neighbour list for the repulsion between residues that are not native partners
  const CUT_NN = 6.2, SKIN = 1.6;
  let nl = new Int32Array(0), nlCount = 0;
  const xAtList = new Float64Array(3 * N);
  function buildList() {
    const out = [], r2 = (CUT_NN + SKIN) * (CUT_NN + SKIN);
    for (let i = 0; i < N; i++) for (let j = i + 4; j < N; j++) {
      if (isNative[i * N + j]) continue;
      const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
      if (dx * dx + dy * dy + dz * dz < r2) out.push(i, j);
    }
    nl = Int32Array.from(out); nlCount = out.length / 2; xAtList.set(x);
  }
  function listStale() {
    let m = 0;
    for (let i = 0; i < 3 * N; i += 3) { const dx = x[i] - xAtList[i], dy = x[i + 1] - xAtList[i + 1], dz = x[i + 2] - xAtList[i + 2]; m = Math.max(m, dx * dx + dy * dy + dz * dz); }
    return m > (SKIN / 2) * (SKIN / 2);
  }

  // ---------- forces
  const pull = { i: -1, x: 0, y: 0, z: 0, k: 2.5, max: 32 };
  function forces() {
    f.fill(0);
    let E = 0;
    // bonds
    for (let i = 0; i < N - 1; i++) {
      const a = 3 * i, b = a + 3;
      const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dr = r - r0[i], g = -2 * o.Kb * dr / r;
      E += o.Kb * dr * dr;
      f[a] += g * dx; f[a + 1] += g * dy; f[a + 2] += g * dz; f[b] -= g * dx; f[b + 1] -= g * dy; f[b + 2] -= g * dz;
    }
    // angles
    for (let i = 0; i < N - 2; i++) {
      const a = 3 * i, b = a + 3, c = a + 6;
      const ux = x[a] - x[b], uy = x[a + 1] - x[b + 1], uz = x[a + 2] - x[b + 2];
      const wx = x[c] - x[b], wy = x[c + 1] - x[b + 1], wz = x[c + 2] - x[b + 2];
      const uu = ux * ux + uy * uy + uz * uz, ww = wx * wx + wy * wy + wz * wz, lu = Math.sqrt(uu), lw = Math.sqrt(ww);
      let cs = (ux * wx + uy * wy + uz * wz) / (lu * lw); cs = Math.max(-0.999999, Math.min(0.999999, cs));
      const th = Math.acos(cs), sn = Math.sqrt(1 - cs * cs), dth = th - th0[i];
      E += o.Kth * dth * dth;
      const k = 2 * o.Kth * dth / sn;   // -dU/dθ * dθ/dcos = 2K dθ / sin θ
      const fax = k * (wx / (lu * lw) - cs * ux / uu), fay = k * (wy / (lu * lw) - cs * uy / uu), faz = k * (wz / (lu * lw) - cs * uz / uu);
      const fcx = k * (ux / (lu * lw) - cs * wx / ww), fcy = k * (uy / (lu * lw) - cs * wy / ww), fcz = k * (uz / (lu * lw) - cs * wz / ww);
      f[a] += fax; f[a + 1] += fay; f[a + 2] += faz; f[c] += fcx; f[c + 1] += fcy; f[c + 2] += fcz;
      f[b] -= fax + fcx; f[b + 1] -= fay + fcy; f[b + 2] -= faz + fcz;
    }
    // dihedrals (Blondel and Karplus, 1996)
    for (let i = 0; i < N - 3; i++) {
      const a = 3 * i, b = a + 3, c = a + 6, d = a + 9;
      const Fx = x[a] - x[b], Fy = x[a + 1] - x[b + 1], Fz = x[a + 2] - x[b + 2];
      const Gx = x[b] - x[c], Gy = x[b + 1] - x[c + 1], Gz = x[b + 2] - x[c + 2];
      const Hx = x[d] - x[c], Hy = x[d + 1] - x[c + 1], Hz = x[d + 2] - x[c + 2];
      const Ax = Fy * Gz - Fz * Gy, Ay = Fz * Gx - Fx * Gz, Az = Fx * Gy - Fy * Gx;
      const Bx = Hy * Gz - Hz * Gy, By = Hz * Gx - Hx * Gz, Bz = Hx * Gy - Hy * Gx;
      const A2 = Ax * Ax + Ay * Ay + Az * Az, B2 = Bx * Bx + By * By + Bz * Bz, gl = Math.sqrt(Gx * Gx + Gy * Gy + Gz * Gz);
      if (A2 < 1e-8 || B2 < 1e-8) continue;
      const cx = By * Az - Bz * Ay, cy = Bz * Ax - Bx * Az, cz = Bx * Ay - By * Ax;
      const ph = Math.atan2((cx * Gx + cy * Gy + cz * Gz) / gl, Ax * Bx + Ay * By + Az * Bz), dp = ph - ph0[i];
      E += o.K1 * (1 - Math.cos(dp)) + o.K3 * (1 - Math.cos(3 * dp));
      const dU = o.K1 * Math.sin(dp) + 3 * o.K3 * Math.sin(3 * dp);
      const FG = Fx * Gx + Fy * Gy + Fz * Gz, HG = Hx * Gx + Hy * Gy + Hz * Gz;
      const pa = -gl / A2, pd = gl / B2, qa = FG / (A2 * gl), qb = HG / (B2 * gl);
      // dφ/dr for each atom
      const dax = pa * Ax, day = pa * Ay, daz = pa * Az, ddx = pd * Bx, ddy = pd * By, ddz = pd * Bz;
      const dbx = -dax + qa * Ax - qb * Bx, dby = -day + qa * Ay - qb * By, dbz = -daz + qa * Az - qb * Bz;
      const dcx = qb * Bx - qa * Ax - ddx, dcy = qb * By - qa * Ay - ddy, dcz = qb * Bz - qa * Az - ddz;
      f[a] -= dU * dax; f[a + 1] -= dU * day; f[a + 2] -= dU * daz;
      f[b] -= dU * dbx; f[b + 1] -= dU * dby; f[b + 2] -= dU * dbz;
      f[c] -= dU * dcx; f[c + 1] -= dU * dcy; f[c + 2] -= dU * dcz;
      f[d] -= dU * ddx; f[d + 1] -= dU * ddy; f[d + 2] -= dU * ddz;
    }
    // native contacts: eps [5 (s/r)^12 - 6 (s/r)^10], deepest (-eps) at the native distance
    for (let k = 0; k < NC; k++) {
      const a = 3 * ci[k], b = 3 * cj[k];
      const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], r2 = dx * dx + dy * dy + dz * dz;
      const s2 = cs2[k] / r2, s10 = s2 * s2 * s2 * s2 * s2, s12 = s10 * s2;
      E += o.eps * (5 * s12 - 6 * s10);
      const g = 60 * o.eps * (s12 - s10) / r2;   // -dU/dr / r
      f[a] += g * dx; f[a + 1] += g * dy; f[a + 2] += g * dz; f[b] -= g * dx; f[b + 1] -= g * dy; f[b + 2] -= g * dz;
    }
    // everyone else just keeps their distance
    const sg2 = o.sigNN * o.sigNN, c2 = CUT_NN * CUT_NN;
    for (let p = 0; p < nlCount; p++) {
      const a = 3 * nl[2 * p], b = 3 * nl[2 * p + 1];
      const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > c2) continue;
      const s2 = sg2 / r2, s12 = s2 * s2 * s2 * s2 * s2 * s2;
      E += o.eps * s12;
      const g = 12 * o.eps * s12 / r2;
      f[a] += g * dx; f[a + 1] += g * dy; f[a + 2] += g * dz; f[b] -= g * dx; f[b + 1] -= g * dy; f[b + 2] -= g * dz;
    }
    // the protein is held lightly by its centre, like a molecule in an optical trap, so a pull stretches it
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < 3 * N; i += 3) { mx += x[i]; my += x[i + 1]; mz += x[i + 2]; }
    mx = mx / N - com0[0]; my = my / N - com0[1]; mz = mz / N - com0[2];
    E += 0.5 * o.Kcom * (mx * mx + my * my + mz * mz);
    const tx = -o.Kcom * mx / N, ty = -o.Kcom * my / N, tz = -o.Kcom * mz / N;
    for (let i = 0; i < 3 * N; i += 3) { f[i] += tx; f[i + 1] += ty; f[i + 2] += tz; }
    // a hand pulling on one residue
    if (pull.i >= 0) {
      const a = 3 * pull.i;
      let gx = pull.k * (pull.x - x[a]), gy = pull.k * (pull.y - x[a + 1]), gz = pull.k * (pull.z - x[a + 2]);
      const m = Math.hypot(gx, gy, gz);
      if (m > pull.max) { gx *= pull.max / m; gy *= pull.max / m; gz *= pull.max / m; }
      f[a] += gx; f[a + 1] += gy; f[a + 2] += gz;
    }
    return E;
  }

  // ---------- Langevin dynamics, BAOAB splitting
  let energy = 0;
  buildList(); energy = forces();
  function step(n) {
    const dt = o.dt, h = dt / 2, c1 = Math.exp(-o.gamma * dt), c2 = Math.sqrt((1 - c1 * c1) * o.T);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 3 * N; i++) { v[i] += h * f[i]; x[i] += h * v[i]; v[i] = c1 * v[i] + c2 * gauss(); x[i] += h * v[i]; }
      if (listStale()) buildList();
      energy = forces();
      for (let i = 0; i < 3 * N; i++) v[i] += h * f[i];
    }
  }

  // ---------- how folded it is
  const qRes = new Float64Array(N);
  function measure() {
    let formed = 0;
    qRes.fill(0);
    for (let k = 0; k < NC; k++) {
      const a = 3 * ci[k], b = 3 * cj[k];
      const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
      if (dx * dx + dy * dy + dz * dz < 1.44 * cs2[k]) { formed++; qRes[ci[k]]++; qRes[cj[k]]++; }
    }
    for (let i = 0; i < N; i++) qRes[i] = perRes[i] ? qRes[i] / perRes[i] : 1;
    return formed / NC;
  }
  // Gauss linking number between the loop closed by contact (i, j) and the chain from t0 to t1
  function linking(X, i, j, t0, t1) {
    let G = 0;
    for (let s = i; s <= j; s++) {
      const a = s, b = s === j ? i : s + 1;
      const Rx = (X[3 * a] + X[3 * b]) / 2, Ry = (X[3 * a + 1] + X[3 * b + 1]) / 2, Rz = (X[3 * a + 2] + X[3 * b + 2]) / 2;
      const lx = X[3 * b] - X[3 * a], ly = X[3 * b + 1] - X[3 * a + 1], lz = X[3 * b + 2] - X[3 * a + 2];
      for (let k = t0; k < t1; k++) {
        const c = 3 * k, e = c + 3;
        const rx = Rx - (X[c] + X[e]) / 2, ry = Ry - (X[c + 1] + X[e + 1]) / 2, rz = Rz - (X[c + 2] + X[e + 2]) / 2;
        const tx = X[e] - X[c], ty = X[e + 1] - X[c + 1], tz = X[e + 2] - X[c + 2];
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
        G += (rx * (ly * tz - lz * ty) + ry * (lz * tx - lx * tz) + rz * (lx * ty - ly * tx)) / (r * r * r);
      }
    }
    return G / (4 * Math.PI);
  }
  // every loop closed right now (a formed native contact) that a terminal segment passes through
  function entanglements(X) {
    X = X || x;
    const out = [];
    for (let k = 0; k < NC; k++) {
      const i = ci[k], j = cj[k];
      if (j - i < 10) continue;
      const a = 3 * i, b = 3 * j;
      const dx = X[a] - X[b], dy = X[a + 1] - X[b + 1], dz = X[a + 2] - X[b + 2];
      if (dx * dx + dy * dy + dz * dz > 1.44 * cs2[k]) continue;
      if (i - 5 >= 4) { const g = linking(X, i, j, 0, i - 5); if (Math.abs(g) >= 0.6) out.push({ i, j, side: 'N', g }); }
      if (j + 5 <= N - 5) { const g = linking(X, i, j, j + 5, N - 1); if (Math.abs(g) >= 0.6) out.push({ i, j, side: 'C', g }); }
    }
    return out;
  }

  return {
    N, x, v, f, X0, pull, opts: o, NC,
    contacts: { ci, cj },
    step, measure, qRes, entanglements, linking,
    energy: () => energy,
    kinetic: () => { let k = 0; for (let i = 0; i < 3 * N; i++) k += v[i] * v[i]; return k / 2; },
    reset() { x.set(X0); v.fill(0); buildList(); energy = forces(); },
    setT(T) { o.T = T; },
    _forces: forces, _energyAt(X) { const keep = new Float64Array(x); x.set(X); buildList(); const e = forces(); x.set(keep); buildList(); forces(); return e; },
  };
}
/* Between the physics and the picture: each frame, line the chain up with the native structure (Horn's
   quaternion method) so it never tumbles out of view, smooth how folded each residue is, and decide which
   threaded loop to show and whether it is the native one or a misfold. */
function makeProteinDriver(init) {
  'use strict';
  const sim = makeProteinSim(init.ca, init.opts);
  const N = sim.N, x = sim.x, X0 = sim.X0;
  const c0 = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) c0[a] += X0[3 * i + a] / N;
  const B = new Float64Array(3 * N);
  for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) B[3 * i + a] = X0[3 * i + a] - c0[a];
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], cx = c0.slice(), frozen = false;
  const qs = new Float64Array(N).fill(1);
  const nativeSign = new Map((init.ents || []).map((e) => [e[0] + ',' + e[1] + ',' + e[2], Math.sign(e[3])]));
  const rep = init.rep || null;
  const nd = (i, j) => Math.hypot(X0[3 * i] - X0[3 * j], X0[3 * i + 1] - X0[3 * j + 1], X0[3 * i + 2] - X0[3 * j + 2]);
  let frame = 0, scan = [], shown = null, miss = 0, unseen = 0;

  function jacobiTop(M) {   // eigenvector of the largest eigenvalue of a symmetric 4x4 matrix
    const a = M.map((r) => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let sweep = 0; sweep < 24; sweep++) {
      let off = 0;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
      if (off < 1e-18) break;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 4; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    let best = 0;
    for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k;
    return [V[0][best], V[1][best], V[2][best], V[3][best]];
  }
  function align() {
    cx = [0, 0, 0];
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) cx[a] += x[3 * i + a] / N;
    let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
    for (let i = 0; i < N; i++) {
      const ax = x[3 * i] - cx[0], ay = x[3 * i + 1] - cx[1], az = x[3 * i + 2] - cx[2], bx = B[3 * i], by = B[3 * i + 1], bz = B[3 * i + 2];
      Sxx += ax * bx; Sxy += ax * by; Sxz += ax * bz; Syx += ay * bx; Syy += ay * by; Syz += ay * bz; Szx += az * bx; Szy += az * by; Szz += az * bz;
    }
    const [w, qx, qy, qz] = jacobiTop([
      [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
      [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
      [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
      [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]]);
    R = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - w * qz), 2 * (qx * qz + w * qy),
      2 * (qx * qy + w * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - w * qx),
      2 * (qx * qz - w * qy), 2 * (qy * qz + w * qx), 1 - 2 * (qx * qx + qy * qy)];
  }
  const keyOf = (e) => e.i + ',' + e.j + ',' + e.side;
  const isNative = (e) => nativeSign.get(keyOf(e)) === Math.sign(e.g);
  function pickShown() {
    if (!scan.length) return null;
    const r = rep && scan.find((e) => e.i === rep[0] && e.j === rep[1] && e.side === rep[2] && Math.sign(e.g) === Math.sign(rep[3]));
    if (r) return r;
    const nat = scan.filter(isNative), pool = nat.length ? nat : scan;
    return pool.reduce((a, b) => (Math.abs(b.g) > Math.abs(a.g) ? b : a));
  }
  function tick(steps) {
    if (steps > 0) sim.step(steps);
    if (!frozen) align();
    const pos = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {
      const dx = x[3 * i] - cx[0], dy = x[3 * i + 1] - cx[1], dz = x[3 * i + 2] - cx[2];
      pos[3 * i] = R[0] * dx + R[1] * dy + R[2] * dz; pos[3 * i + 1] = R[3] * dx + R[4] * dy + R[5] * dz; pos[3 * i + 2] = R[6] * dx + R[7] * dy + R[8] * dz;
    }
    const Q = sim.measure();
    for (let i = 0; i < N; i++) qs[i] += (sim.qRes[i] - qs[i]) * 0.12;
    frame++;
    if (frame % 12 === 1) {
      scan = sim.entanglements();
      const best = pickShown(), sameAsShown = shown && scan.some((e) => e.i === shown.i && e.j === shown.j && e.side === shown.side);
      unseen = shown && !sameAsShown ? unseen + 1 : 0;
      if (shown && unseen >= 2) { shown = null; unseen = 0; }   // missing from two scans in a row: the loop has opened
      if (best && (!shown || (rep && best.i === rep[0] && best.j === rep[1] && best.side === rep[2] && !(shown.i === rep[0] && shown.j === rep[1])))) { shown = best; miss = 0; unseen = 0; }
    }
    if (shown) {   // keep the loop on screen current, and let it go only once it has really opened, not on one breath
      const d = Math.hypot(x[3 * shown.i] - x[3 * shown.j], x[3 * shown.i + 1] - x[3 * shown.j + 1], x[3 * shown.i + 2] - x[3 * shown.j + 2]);
      const g = shown.side === 'N' ? sim.linking(x, shown.i, shown.j, 0, shown.i - 5) : sim.linking(x, shown.i, shown.j, shown.j + 5, N - 1);
      if (d > 1.35 * nd(shown.i, shown.j) || Math.abs(g) < 0.45) { if (++miss > 12) { shown = null; scan = []; miss = 0; } }
      else { miss = 0; shown = { i: shown.i, j: shown.j, side: shown.side, g }; }
    }
    return { pos, q: Float32Array.from(qs), Q, T: sim.opts.T, ent: shown && { i: shown.i, j: shown.j, side: shown.side, g: shown.g, native: isNative(shown) }, pulling: sim.pull.i };
  }
  function setPull(i, p) {   // p is in the picture's frame; the physics wants it in its own
    if (i < 0) { sim.pull.i = -1; frozen = false; return; }
    frozen = true;
    sim.pull.i = i;
    sim.pull.x = R[0] * p[0] + R[3] * p[1] + R[6] * p[2] + cx[0];
    sim.pull.y = R[1] * p[0] + R[4] * p[1] + R[7] * p[2] + cx[1];
    sim.pull.z = R[2] * p[0] + R[5] * p[1] + R[8] * p[2] + cx[2];
  }
  return { N, tick, setPull, setT: (T) => sim.setT(T), reset: () => { sim.reset(); qs.fill(1); scan = []; shown = null; frame = 0; }, sim };
}
// in a Web Worker, the page talks to the driver by message
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof importScripts === 'function') {
  let drv = null, gen = 0;   // gen tells the page which protein a frame belongs to, so frames from one it has left are dropped
  self.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'init') { drv = makeProteinDriver(m.init); gen = m.gen || 0; const fr = drv.tick(0); self.postMessage({ type: 'frame', fr, gen }, [fr.pos.buffer, fr.q.buffer]); return; }
    if (!drv) return;
    if (m.type === 'tick') { const t = Date.now(), fr = drv.tick(m.steps); fr.ms = Date.now() - t; self.postMessage({ type: 'frame', fr, gen }, [fr.pos.buffer, fr.q.buffer]); }
    else if (m.type === 'T') drv.setT(m.T);
    else if (m.type === 'pull') drv.setPull(m.i, m.p);
    else if (m.type === 'reset') drv.reset();
  };
}
if (typeof module !== 'undefined') module.exports = { makeProteinSim, makeProteinDriver };
