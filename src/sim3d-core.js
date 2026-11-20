/* Robot cell in 3D with a Franka Emika Panda (kinematics, masses and meshes from MuJoCo Menagerie,
   Apache-2.0). The seven joints are torque-limited motors under computed-torque control with gravity
   compensation, using the arm's own link masses and inertias; an iterative inverse-kinematics solver
   turns tool targets into joint targets. Boxes are rigid bodies in cannon-es; the arm's links push them
   as kinematic colliders. A planner stacks and unstacks the boxes when nobody is steering.
   Runs in the browser (window.RobotCell3D) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RobotCell3D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const hyp = Math.hypot;
  const D2R = Math.PI / 180;
  const G = 9.81;

  // ---------- geometry of the cell (metres; y is up, the table top is y = 0) ----------
  const GEOM = {
    heading: 90, span: 120,            // the arm faces the viewer (+z) and works in a 120° wedge around that heading
    ring: 0.5, padAz: 90, slotAz: [36, 63, 117, 144],
    rMin: 0.3, rMax: 0.72, yMin: 0.012, yMax: 0.52,
    tcp: 0.1034,                       // flange-mounted hand: TCP sits 103.4 mm past the hand frame
    palmAbove: 0.037, tipBelow: 0.009, // the hand's underside and the fingertips, relative to the TCP
    openMax: 0.081, openMin: 0.001,    // gap between the finger pads
    table: { x0: -0.75, x1: 0.75, z0: -0.22, z1: 0.74 }, tableH: 0.75, // bench top, arm mounted near the back edge
  };
  const BOX_SIZES = [0.066, 0.056, 0.047, 0.039];
  const BOX_DENSITY = 300;
  const DT = 1 / 120;
  const WN = 16, ZETA = 0.9, FRICTION = 0.6;
  // Franka Emika Panda datasheet: 87 N·m and 2.175 rad/s on joints 1-4, 12 N·m and 2.61 rad/s on joints 5-7
  const JOINTS = [87, 87, 87, 87, 12, 12, 12].map((t, i) => ({ name: `Joint ${i + 1}`, maxTorque: t, wMax: i < 4 ? 2.175 : 2.61 }));
  const ARMATURE = 0.1;
  // motion parameters, sized to 4-7 cm boxes
  const P = {
    safeH: 0.2, clearEmpty: 0.085, clearHeld: 0.06, approachGap: 0.04, blend: 0.012, placeGap: 0.002, retreat: 0.1,
    vApproach: 0.7, vDrop: 0.45, vPick: 0.07, vLift: 0.4, vTransfer: 0.65, vPlace: 0.06, vRetreat: 0.35,
    hoverFloor: 0.17, hoverEmpty: 0.07, hoverHeld: 0.045, hoverReach: 0.13,
    graspXZ: 0.02, graspBelow: 0.035, graspAbove: 0.006, movedAbort: 0.015,
    settleSpeed: 0.02, towerXZ: 0.025, stackGap: 0.012, spotClear: 0.05, roomClear: 0.02,
  };

  const CAT = { GROUND: 1, ARM: 2, BOX: 4 };
  const polar = (az, r) => ({ x: r * Math.cos(az), z: r * Math.sin(az) });
  const TH_MIN = (GEOM.heading - GEOM.span / 2) * D2R, TH_MAX = (GEOM.heading + GEOM.span / 2) * D2R;
  const inSector = (th, m) => { th = wrap(th); m = m || 0; return th >= TH_MIN + m && th <= TH_MAX - m; };
  // an azimuth outside the wedge goes to the nearer edge, so the arm stops there instead of swinging round
  function thOK(th) {
    th = wrap(th);
    if (th >= TH_MIN && th <= TH_MAX) return th;
    return Math.abs(wrap(th - TH_MIN)) < Math.abs(wrap(th - TH_MAX)) ? TH_MIN : TH_MAX;
  }
  const onTable = (x, z, m) => x > GEOM.table.x0 + m && x < GEOM.table.x1 - m && z > GEOM.table.z0 + m && z < GEOM.table.z1 - m;
  const toWorld = (p, th) => ({ x: p.r * Math.cos(th), y: p.y, z: p.r * Math.sin(th) });

  // ---------- 3x3 matrices (row-major arrays) and 3-vectors ----------
  function mm(A, B) {
    return [
      A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
      A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
      A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8]];
  }
  const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const mtv = (A, v) => [A[0] * v[0] + A[3] * v[1] + A[6] * v[2], A[1] * v[0] + A[4] * v[1] + A[7] * v[2], A[2] * v[0] + A[5] * v[1] + A[8] * v[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const col = (R, j) => [R[j], R[3 + j], R[6 + j]];
  function quatToM(w, x, y, z) {
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }
  // do two oriented boxes overlap? centres a, b; axes are the columns of A, B; half-extents ea, eb (separating-axis test)
  function obbOverlap(a, A, ea, b, B, eb) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], R = [[], [], []], AR = [[], [], []], t = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) { R[i][j] = A[i] * B[j] + A[3 + i] * B[3 + j] + A[6 + i] * B[6 + j]; AR[i][j] = Math.abs(R[i][j]) + 1e-9; }
      t[i] = d[0] * A[i] + d[1] * A[3 + i] + d[2] * A[6 + i];
    }
    for (let i = 0; i < 3; i++) if (Math.abs(t[i]) > ea[i] + eb[0] * AR[i][0] + eb[1] * AR[i][1] + eb[2] * AR[i][2]) return false;
    for (let j = 0; j < 3; j++) if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > ea[0] * AR[0][j] + ea[1] * AR[1][j] + ea[2] * AR[2][j] + eb[j]) return false;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ea[i1] * AR[i2][j] + ea[i2] * AR[i1][j] + eb[j1] * AR[i][j2] + eb[j2] * AR[i][j1]) return false;
    }
    return true;
  }
  function rotAxis(a, t) {
    const c = Math.cos(t), s = Math.sin(t), C = 1 - c, x = a[0], y = a[1], z = a[2];
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
      y * x * C + z * s, c + y * y * C, y * z * C - x * s,
      z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  function mToQuat(R) { // returns [x, y, z, w]
    const t = R[0] + R[4] + R[8];
    if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s, 0.25 * s]; }
    if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; return [0.25 * s, (R[1] + R[3]) / s, (R[2] + R[6]) / s, (R[7] - R[5]) / s]; }
    if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; return [(R[1] + R[3]) / s, 0.25 * s, (R[5] + R[7]) / s, (R[2] - R[6]) / s]; }
    const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; return [(R[2] + R[6]) / s, (R[5] + R[7]) / s, 0.25 * s, (R[3] - R[1]) / s];
  }
  // hand orientation for a top-down grasp: approach axis straight down, fingers closing along azimuth ba
  function downR(ba) {
    const y = [Math.cos(ba), 0, Math.sin(ba)], z = [0, -1, 0], x = cross(y, z);
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  }

  // ---------- the arm's kinematic tree ----------
  // MuJoCo is z-up; the cell is y-up, so the base frame is turned -90° about x.
  const BASE_MJ = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  function makeArm(KIN, headingDeg) {
    const heading = (headingDeg === undefined ? GEOM.heading : headingDeg) * D2R;
    const c = Math.cos(-heading), s = Math.sin(-heading);
    const BASE_R = mm([c, 0, s, 0, 1, 0, -s, 0, c], BASE_MJ); // arm azimuth = heading - joint 1
    const bodies = KIN.bodies.map((b) => ({
      name: b.name, parent: b.parent, pos: b.pos, R0: quatToM(b.quat[0], b.quat[1], b.quat[2], b.quat[3]),
      joint: b.joint || null, mass: b.mass || 0, com: b.com || [0, 0, 0],
      I: b.inertia ? [].concat(b.inertia[0], b.inertia[1], b.inertia[2]) : [0, 0, 0, 0, 0, 0, 0, 0, 0],
      box: b.box || null,
    }));
    const hinge = [], limits = [];
    bodies.forEach((b, i) => { if (b.joint && b.joint.type === 'hinge') { hinge.push(i); limits.push(b.joint.range); } });
    const hand = bodies.findIndex((b) => b.name === 'hand');
    function fk(q, d) {
      const n = bodies.length, Pp = new Array(n), Rr = new Array(n), axes = [], origins = [];
      let h = 0;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        let p, r;
        if (b.parent < 0) { p = [0, 0, 0]; r = mm(BASE_R, b.R0); }
        else { const pp = Pp[b.parent], pr = Rr[b.parent], o = mv(pr, b.pos); p = [pp[0] + o[0], pp[1] + o[1], pp[2] + o[2]]; r = mm(pr, b.R0); }
        if (b.joint) {
          if (b.joint.type === 'hinge') { axes.push(mv(r, b.joint.axis)); origins.push(p); r = mm(r, rotAxis(b.joint.axis, q[h++])); }
          else { const a = mv(r, b.joint.axis); p = [p[0] + a[0] * d, p[1] + a[1] * d, p[2] + a[2] * d]; }
        }
        Pp[i] = p; Rr[i] = r;
      }
      const Rt = Rr[hand], ph = Pp[hand], z = col(Rt, 2);
      return { P: Pp, R: Rr, axes, origins, tcp: [ph[0] + z[0] * GEOM.tcp, ph[1] + z[1] * GEOM.tcp, ph[2] + z[2] * GEOM.tcp], Rt };
    }
    // gravity torque each joint must hold, and the inertia it sees (diagonal of the mass matrix)
    function loads(F, payload) {
      const n = bodies.length, g = [0, 0, 0, 0, 0, 0, 0], M = [0, 0, 0, 0, 0, 0, 0];
      const coms = bodies.map((b, k) => { const c = mv(F.R[k], b.com); return [F.P[k][0] + c[0], F.P[k][1] + c[1], F.P[k][2] + c[2]]; });
      for (let j = 0; j < 7; j++) {
        const a = F.axes[j], o = F.origins[j];
        let gj = 0, Mj = ARMATURE;
        for (let k = hinge[j]; k < n; k++) {
          const b = bodies[k]; if (!b.mass) continue;
          const v = cross(a, [coms[k][0] - o[0], coms[k][1] - o[1], coms[k][2] - o[2]]);
          const u = mtv(F.R[k], a), Iu = mv(b.I, u);
          gj += b.mass * G * v[1];
          Mj += b.mass * dot(v, v) + dot(u, Iu);
        }
        if (payload) {
          const v = cross(a, [F.tcp[0] - o[0], F.tcp[1] - o[1], F.tcp[2] - o[2]]);
          gj += payload * G * v[1]; Mj += payload * dot(v, v);
        }
        g[j] = gj; M[j] = Mj;
      }
      return { g, M };
    }
    return { bodies, hinge, limits, hand, fk, loads, heading };
  }

  // ---------- inverse kinematics: damped least squares with a posture task in the null space ----------
  function solve6(A, rhs) { // Gaussian elimination with partial pivoting on a 6x6 system, rhs is a list of 6-vectors
    const n = 6, a = A.slice(), r = rhs.map((v) => v.slice());
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let i = c + 1; i < n; i++) if (Math.abs(a[i * n + c]) > Math.abs(a[p * n + c])) p = i;
      if (p !== c) {
        for (let k = 0; k < n; k++) { const t = a[c * n + k]; a[c * n + k] = a[p * n + k]; a[p * n + k] = t; }
        for (const v of r) { const t = v[c]; v[c] = v[p]; v[p] = t; }
      }
      const piv = a[c * n + c] || 1e-12;
      for (let i = c + 1; i < n; i++) {
        const f = a[i * n + c] / piv; if (!f) continue;
        for (let k = c; k < n; k++) a[i * n + k] -= f * a[c * n + k];
        for (const v of r) v[i] -= f * v[c];
      }
    }
    for (const v of r) for (let i = n - 1; i >= 0; i--) {
      let s = v[i]; for (let k = i + 1; k < n; k++) s -= a[i * n + k] * v[k];
      v[i] = s / (a[i * n + i] || 1e-12);
    }
    return r;
  }
  const W_ORI = 0.35, LAMBDA2 = 4e-4, K_POSTURE = 0.08;
  function solveIK(arm, target, prev, iters, flip) {
    const q = prev.slice();
    let ep = 1, eo = 1;
    const rest = [wrap(arm.heading - target.th), -0.25, 0, -2.3, 0, 2.05, 0.785];
    for (let it = 0; it < iters; it++) {
      const F = arm.fk(q, 0), R = F.Rt;
      const x = col(R, 0), y = col(R, 1), z = col(R, 2);
      let yd = [Math.cos(target.ba), 0, Math.sin(target.ba)];
      if ((dot(y, yd) < 0) !== !!flip) yd = [-yd[0], 0, -yd[2]]; // a parallel gripper is the same turned half a turn
      const zd = [0, -1, 0], xd = cross(yd, zd);
      const c1 = cross(x, xd), c2 = cross(y, yd), c3 = cross(z, zd);
      const o = [(c1[0] + c2[0] + c3[0]) / 2, (c1[1] + c2[1] + c3[1]) / 2, (c1[2] + c2[2] + c3[2]) / 2];
      const e = [target.p[0] - F.tcp[0], target.p[1] - F.tcp[1], target.p[2] - F.tcp[2], o[0] * W_ORI, o[1] * W_ORI, o[2] * W_ORI];
      ep = hyp(e[0], e[1], e[2]); eo = hyp(o[0], o[1], o[2]);
      if (ep < 2e-5 && eo < 2e-4) break;
      const J = new Array(42);
      for (let c = 0; c < 7; c++) {
        const a = F.axes[c], og = F.origins[c], v = cross(a, [F.tcp[0] - og[0], F.tcp[1] - og[1], F.tcp[2] - og[2]]);
        J[c] = v[0]; J[7 + c] = v[1]; J[14 + c] = v[2]; J[21 + c] = a[0] * W_ORI; J[28 + c] = a[1] * W_ORI; J[35 + c] = a[2] * W_ORI;
      }
      const A = new Array(36);
      for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) {
        let s = 0; for (let c = 0; c < 7; c++) s += J[i * 7 + c] * J[k * 7 + c];
        A[i * 6 + k] = s + (i === k ? LAMBDA2 : 0);
      }
      const z0 = q.map((qi, i) => K_POSTURE * (rest[i] - qi));
      const Jz = [0, 1, 2, 3, 4, 5].map((i) => { let s = 0; for (let c = 0; c < 7; c++) s += J[i * 7 + c] * z0[c]; return s; });
      const [y1, y2] = solve6(A, [e, Jz]);
      for (let c = 0; c < 7; c++) {
        let d1 = 0, d2 = 0;
        for (let i = 0; i < 6; i++) { d1 += J[i * 7 + c] * y1[i]; d2 += J[i * 7 + c] * y2[i]; }
        q[c] = clamp(q[c] + d1 + z0[c] - d2, arm.limits[c][0] + 0.01, arm.limits[c][1] - 0.01);
      }
    }
    return { q, ep, eo, reachable: ep < 0.004 && eo < 0.03 };
  }

  function create(CANNON, opts) {
    opts = opts || {};
    const KIN = opts.kin || (typeof window !== 'undefined' && window.PANDA_KIN);
    if (!KIN) throw new Error('RobotCell3D needs the arm description (opts.kin)');
    const arm = makeArm(KIN, GEOM.heading);
    const V3 = (x, y, z) => new CANNON.Vec3(x, y, z);
    const world = new CANNON.World({ gravity: V3(0, -G, 0), allowSleep: true });
    // island-split Gauss-Seidel: a plain GS solve makes a resting stack creep; split islands settle and sleep
    const gs = new CANNON.GSSolver();
    gs.iterations = 24; gs.tolerance = 1e-4;
    world.solver = new CANNON.SplitSolver(gs);
    world.defaultContactMaterial.friction = 0.6;
    world.defaultContactMaterial.restitution = 0;
    world.defaultContactMaterial.contactEquationStiffness = 5e7;
    world.defaultContactMaterial.contactEquationRelaxation = 3;
    world.broadphase = new CANNON.NaiveBroadphase();

    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), collisionFilterGroup: CAT.GROUND, collisionFilterMask: CAT.BOX });
    ground.quaternion.setFromAxisAngle(V3(1, 0, 0), -Math.PI / 2);
    world.addBody(ground);

    // ---------- boxes ----------
    const padP = polar(GEOM.padAz * D2R, GEOM.ring);
    const slotP = GEOM.slotAz.map((a) => polar(a * D2R, GEOM.ring));
    const boxes = BOX_SIZES.map((s, i) => {
      const body = new CANNON.Body({
        mass: BOX_DENSITY * s * s * s, shape: new CANNON.Box(V3(s / 2, s / 2, s / 2)),
        position: V3(slotP[i].x, s / 2, slotP[i].z),
        collisionFilterGroup: CAT.BOX, collisionFilterMask: CAT.GROUND | CAT.ARM | CAT.BOX,
        allowSleep: true, sleepSpeedLimit: 0.05, sleepTimeLimit: 0.25, linearDamping: 0.01, angularDamping: 0.05,
      });
      body.quaternion.setFromAxisAngle(V3(0, 1, 0), -GEOM.slotAz[i] * D2R);
      world.addBody(body);
      return { id: 'b' + (i + 1), size: s, mass: body.mass, body, slot: i };
    });
    const boxById = new Map(boxes.map((b) => [b.id, b]));

    // ---------- arm colliders (kinematic boxes in each link's frame) ----------
    // fingers get boxes cut to the pads (the pads stand 2.5 mm proud of the finger body)
    const FINGER_BOX = { center: [0, 0.01225, 0.0285], quat: [1, 0, 0, 0], half: [0.0095, 0.01175, 0.0255] };
    const colliders = [];
    arm.bodies.forEach((b, i) => {
      const spec = /finger/.test(b.name) ? FINGER_BOX : b.box;
      if (!spec) return;
      const body = new CANNON.Body({ type: CANNON.Body.KINEMATIC, mass: 0, shape: new CANNON.Box(V3(spec.half[0], spec.half[1], spec.half[2])),
        collisionFilterGroup: CAT.ARM, collisionFilterMask: CAT.BOX, allowSleep: false, sleepSpeedLimit: 0 });
      world.addBody(body);
      colliders.push({ link: i, body, c: spec.center, R: quatToM(spec.quat[0], spec.quat[1], spec.quat[2], spec.quat[3]) });
    });
    const armBodies = new Set(colliders.map((c) => c.body));

    // ---------- state ----------
    const home = { th: GEOM.heading * D2R, r: 0.42, y: 0.3 };
    const opening = (open) => clamp((open - GEOM.openMin) / 2, 0, 0.04);
    // finger azimuth the wrist sits at naturally, relative to the arm's heading (joint 7 near the middle of its range)
    const NOMINAL = (() => {
      const F = arm.fk([0, -0.25, 0, -2.3, 0, 2.05, 0.785], 0), y = col(F.Rt, 1);
      return wrap(Math.atan2(y[2], y[0]) - arm.heading);
    })();
    const state = {
      q: [wrap(arm.heading - home.th), -0.25, 0, -2.3, 0, 2.05, 0.785], qd: [0, 0, 0, 0, 0, 0, 0], tau: [0, 0, 0, 0, 0, 0, 0],
      qDes: null, qdDes: [0, 0, 0, 0, 0, 0, 0], qddDes: [0, 0, 0, 0, 0, 0, 0],
      // w is the finger azimuth minus its natural value for the arm's heading (th + NOMINAL)
      cmd: { th: home.th, r: home.r, y: home.y, w: 0 },
      goal: { th: home.th, r: home.r, y: home.y, w: 0 },
      speed: 0.6, cmdV: 0, reachable: true, ikErr: 0,
      open: GEOM.openMax, openTarget: GEOM.openMax, closing: false,
      held: null, rel: null,
      // holdManual: autopilot was switched off on purpose, so it stays off until switched back on
      mode: 'auto', time: 0, lastInput: -1e9, holdManual: false,
      path: null, phaseLabel: 'Idle', placed: 0, stepMs: 0,
      pressing: false, touchdown: false, acc: 0, tcpSpeed: 0, wVel: 0, notice: '', noticeT: -9,
      // what the hand pressed on, what it touched down on in the current move, and a box that blocked a pick
      pressedOn: null, touchOn: null, blocker: null,
    };
    const tcpTarget = (c) => ({ p: [c.r * Math.cos(c.th), c.y, c.r * Math.sin(c.th)], ba: c.th + NOMINAL + c.w, th: c.th });
    state.q = solveIK(arm, tcpTarget(state.cmd), state.q, 200).q;
    state.qDes = state.q.slice();

    // ---------- frames ----------
    let F = arm.fk(state.q, opening(state.open));
    const armF = () => F;
    const fingerAxis = (Fr) => col(Fr.Rt, 1);
    const tcpOf = (Fr) => ({ x: Fr.tcp[0], y: Fr.tcp[1], z: Fr.tcp[2] });
    const quatOf = (R) => { const q = mToQuat(R); return new CANNON.Quaternion(q[0], q[1], q[2], q[3]); };

    // ---------- kinematic driving ----------
    const Qa = new CANNON.Quaternion(), Qb = new CANNON.Quaternion();
    const driveBody = (b, p, q, dt) => {
      b.velocity.set((p[0] - b.position.x) / dt, (p[1] - b.position.y) / dt, (p[2] - b.position.z) / dt);
      Qa.copy(q); Qb.copy(b.quaternion); Qb.conjugate(Qb);
      const dq = Qa.mult(Qb);
      if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
      b.angularVelocity.set(2 * dq.x / dt, 2 * dq.y / dt, 2 * dq.z / dt);
      b.__p = p; b.__q = q;
    };
    const snapBody = (b) => { if (b.__p) { b.position.set(b.__p[0], b.__p[1], b.__p[2]); b.quaternion.copy(b.__q); } };
    function placeColliders(Fr, dt) {
      for (const c of colliders) {
        const R = Fr.R[c.link], o = mv(R, c.c), P0 = Fr.P[c.link];
        const p = [P0[0] + o[0], P0[1] + o[1], P0[2] + o[2]], q = quatOf(mm(R, c.R));
        if (dt) driveBody(c.body, p, q, dt);
        else { c.body.position.set(p[0], p[1], p[2]); c.body.quaternion.copy(q); }
      }
      if (state.held && state.rel) {
        const Qt = quatOf(Fr.Rt), hq = Qt.mult(state.rel.q), hv = Qt.vmult(state.rel.p);
        const hp = [Fr.tcp[0] + hv.x, Fr.tcp[1] + hv.y, Fr.tcp[2] + hv.z];
        if (dt) driveBody(state.held.body, hp, hq, dt);
        else { state.held.body.position.set(hp[0], hp[1], hp[2]); state.held.body.quaternion.copy(hq); }
      }
    }
    placeColliders(F, 0);

    // ---------- box inspection ----------
    function boxInfo(b) {
      const p = b.body.position, q = b.body.quaternion;
      const ax = [q.vmult(V3(1, 0, 0)), q.vmult(V3(0, 1, 0)), q.vmult(V3(0, 0, 1))];
      let up = 0;
      for (let i = 1; i < 3; i++) if (Math.abs(ax[i].y) > Math.abs(ax[up].y)) up = i;
      const h = b.size / 2;
      const ext = h * (Math.abs(ax[0].y) + Math.abs(ax[1].y) + Math.abs(ax[2].y));
      const side = ax[(up + 1) % 3];
      const v = b.body.velocity, w = b.body.angularVelocity;
      return { b, x: p.x, y: p.y, z: p.z, h, top: p.y + ext, bottom: p.y - ext, yaw: Math.atan2(side.z, side.x),
        upright: Math.abs(ax[up].y) > 0.985, speed: hyp(v.x, v.y, v.z) + hyp(w.x, w.y, w.z) * h,
        th: Math.atan2(p.z, p.x), r: hyp(p.x, p.z) };
    }
    const infos = () => boxes.map(boxInfo);
    const faceAligned = (yaw, beta) => beta + wrap(4 * (yaw - beta)) / 4; // nearest angle to beta that lines up with a box face

    // ---------- command trajectory in cylindrical space ----------
    function setGoal(g, speed) {
      if (g.th !== undefined) state.goal.th = thOK(g.th);
      if (g.r !== undefined) state.goal.r = clamp(g.r, GEOM.rMin, GEOM.rMax);
      if (g.y !== undefined) state.goal.y = clamp(g.y, GEOM.yMin, GEOM.yMax);
      if (g.w !== undefined) state.goal.w = clamp(g.w, -Math.PI / 2, Math.PI / 2);
      if (speed) state.speed = speed;
    }
    function cylDist(a, b) { const rm = (a.r + b.r) / 2; return hyp(rm * (b.th - a.th), b.r - a.r, b.y - a.y); }
    // the arm, or the box it holds, pushing down on a resting box: a real cell would feel this as a force spike.
    // Returns the body pressed on, so a stop can say what it ran into.
    function detectPressing() {
      const hb = state.held ? state.held.body : null;
      for (const ce of world.contacts) {
        const aArm = armBodies.has(ce.bi) || ce.bi === hb, bArm = armBodies.has(ce.bj) || ce.bj === hb;
        if (aArm === bArm) continue;
        const ny = aArm ? ce.ni.y : -ce.ni.y;
        if (ny < -0.6) return aArm ? ce.bj : ce.bi;
      }
      return null;
    }
    function stepCommand(dt) {
      const c = state.cmd, g = state.goal;
      if (state.pressing && g.y < c.y + 0.0005) {
        if (!state.touchdown) state.touchOn = state.pressedOn;
        c.y = Math.max(c.y, F.tcp[1]) + 0.0015; g.y = c.y; state.cmdV = 0; state.touchdown = true;
      }
      const dist = cylDist(c, g), aMax = state.mode === 'manual' ? 3.0 : 2.0;
      const cw = toWorld({ r: c.r, y: c.y }, c.th);
      const lag = hyp(F.tcp[0] - cw.x, F.tcp[1] - cw.y, F.tcp[2] - cw.z);
      const throttle = clamp(1 - (lag - 0.012) / 0.025, 0.05, 1);
      let v = Math.min(Math.sqrt(2 * aMax * dist), clamp(state.speed * throttle, state.cmdV - aMax * dt, state.cmdV + aMax * dt));
      if (dist < 1e-6) { v = 0; c.th = g.th; c.r = g.r; c.y = g.y; }
      else { const s = Math.min(1, (v * dt) / dist); c.th += (g.th - c.th) * s; c.r += (g.r - c.r) * s; c.y += (g.y - c.y) * s; }
      state.cmdV = v;
      // the wrist turns with a smooth speed profile too (accelerate, cruise at 3 rad/s, brake)
      const dw = g.w - c.w, aW = 10;
      let vw = Math.min(Math.sqrt(2 * aW * Math.abs(dw)), 3, Math.abs(state.wVel) + aW * dt);
      if (Math.abs(dw) < 1e-6) { vw = 0; c.w = g.w; } else c.w += Math.sign(dw) * Math.min(Math.abs(dw), vw * dt);
      state.wVel = vw;
    }

    // ---------- joint dynamics ----------
    function jointDynamics(dt) {
      const L = arm.loads(F, state.held ? state.held.mass : 0);
      for (let i = 0; i < 7; i++) {
        const e = state.qDes[i] - state.q[i], ed = state.qdDes[i] - state.qd[i];
        // computed torque: feedforward acceleration and friction, PD on the error, gravity compensation
        let tau = L.M[i] * (state.qddDes[i] + WN * WN * e + 2 * ZETA * WN * ed) + FRICTION * state.qdDes[i] + L.g[i];
        tau = clamp(tau, -JOINTS[i].maxTorque, JOINTS[i].maxTorque);
        const acc = (tau - L.g[i] - FRICTION * state.qd[i]) / L.M[i];
        state.qd[i] = clamp(state.qd[i] + acc * dt, -JOINTS[i].wMax, JOINTS[i].wMax);
        const lim = arm.limits[i];
        state.q[i] += state.qd[i] * dt;
        if (state.q[i] < lim[0]) { state.q[i] = lim[0]; state.qd[i] = 0; } else if (state.q[i] > lim[1]) { state.q[i] = lim[1]; state.qd[i] = 0; }
        state.tau[i] = tau;
      }
    }

    // ---------- gripper ----------
    function graspCandidate(Fr) {
      const ax = fingerAxis(Fr), beta = Math.atan2(ax[2], ax[0]);
      let best = null;
      for (const i of infos()) {
        if (i.b === state.held || !i.upright) continue;
        const dxz = hyp(i.x - Fr.tcp[0], i.z - Fr.tcp[2]);
        if (dxz > P.graspXZ) continue;
        if (Fr.tcp[1] < i.top - P.graspBelow || Fr.tcp[1] > i.top + P.graspAbove) continue;
        const ext = i.h * (Math.abs(Math.cos(i.yaw - beta)) + Math.abs(Math.sin(i.yaw - beta)));
        if (2 * ext > state.open + 0.002) continue;
        if (!best || dxz < best.d) best = { i, ext, d: dxz };
      }
      return best;
    }
    function attach(b, Fr) {
      const body = b.body;
      body.type = CANNON.Body.KINEMATIC; body.mass = 0; body.updateMassProperties();
      body.collisionFilterMask = CAT.BOX;
      body.allowSleep = false; body.sleepSpeedLimit = 0; body.wakeUp();
      const Qt = quatOf(Fr.Rt), qi = Qt.inverse();
      const dp = V3(body.position.x - Fr.tcp[0], body.position.y - Fr.tcp[1], body.position.z - Fr.tcp[2]);
      state.rel = { p: qi.vmult(dp), q: qi.mult(body.quaternion) };
      state.held = b;
    }
    function detach() {
      const b = state.held; if (!b) return;
      const body = b.body;
      body.type = CANNON.Body.DYNAMIC; body.mass = b.mass; body.updateMassProperties();
      body.collisionFilterMask = CAT.GROUND | CAT.ARM | CAT.BOX;
      body.allowSleep = true; body.sleepSpeedLimit = 0.05; body.wakeUp();
      state.held = null; state.rel = null;
    }
    function updateGripper(dt) {
      if (state.closing) {
        if (!state.held) {
          const c = graspCandidate(F);
          const target = c ? 2 * c.ext + 0.0015 : GEOM.openMin;
          state.open = Math.max(target, state.open - 0.1 * dt);
          if (c && state.open <= target + 1e-4) attach(c.i.b, F);
        }
      } else {
        if (state.held) detach();
        const t = clamp(state.openTarget, GEOM.openMin, GEOM.openMax);
        state.open += clamp(t - state.open, -0.1 * dt, 0.12 * dt);
      }
    }

    // ---------- planner ----------
    const AP = { mode: 'stack', seq: [], t: 0, box: null, dest: null, cool: new Map(), hold: 0, idle: 0, since: 0, flipped: false, settle: 0 };
    const sizesDesc = BOX_SIZES.slice().sort((a, b) => b - a);
    function towerAt(list) {
      const near = list.filter((i) => hyp(i.x - padP.x, i.z - padP.z) < P.towerXZ && i.upright && i.speed < 0.03).sort((a, b) => a.y - b.y);
      const members = []; let top = 0;
      for (const i of near) { if (Math.abs(i.bottom - top) < P.stackGap) { members.push(i); top = i.top; } }
      return { members, top };
    }
    const towerValid = (t) => t.members.every((m, k) => Math.abs(m.b.size - sizesDesc[k]) < 1e-6);
    function isFree(i, list) {
      return !list.some((o) => o !== i && Math.abs(o.bottom - i.top) < P.stackGap && hyp(o.x - i.x, o.z - i.z) < i.h + o.h - 0.004);
    }
    function maxTop(list, except) { let m = 0; for (const i of list) if (i.b !== except && i.top > m) m = i.top; return m; }
    function floorSpot(item, list) {
      const cand = [GEOM.slotAz[item.b.slot]].concat(GEOM.slotAz).map((a) => ({ az: a, r: GEOM.ring }));
      for (const r of [GEOM.ring, 0.38, 0.62]) for (let a = GEOM.heading - GEOM.span / 2 + 5; a <= GEOM.heading + GEOM.span / 2 - 5; a += 9) cand.push({ az: a, r });
      for (const cnd of cand) {
        const p = polar(cnd.az * D2R, cnd.r);
        if (hyp(p.x - padP.x, p.z - padP.z) < 0.13) continue;
        if (list.every((o) => o === item || o.b === item.b || hyp(o.x - p.x, o.z - p.z) > item.h + o.h + P.spotClear)) return { x: p.x, z: p.z, align: cnd.az * D2R };
      }
      return null;
    }
    const cyl = (x, z) => ({ th: Math.atan2(z, x), r: hyp(x, z) });
    const pickDepth = (i) => Math.min(0.02, 0.32 * i.b.size);
    const pickOpen = (b) => Math.min(GEOM.openMax, b.size + 0.025);
    // Where would the hand and fingers sit at the bottom of this pick, and which other box would they run into?
    // The links from the wrist out are posed by the tool target alone, so their colliders can be tested before moving.
    function gripBlocker(i, w) {
      const c = cyl(i.x, i.z), tgt = tcpTarget({ th: c.th, r: c.r, y: i.top - pickDepth(i), w });
      const seed = [wrap(arm.heading - c.th), -0.25, 0, -2.3, 0, 2.05, 0.785];
      let ik = solveIK(arm, tgt, seed, 120);
      if (!ik.reachable) { const alt = solveIK(arm, tgt, seed, 120, true); if (alt.reachable) ik = alt; }
      if (!ik.reachable) return { unreachable: true, box: null };
      const Fg = arm.fk(ik.q, opening(pickOpen(i.b))), M = 0.003; // 3 mm to spare
      const others = infos().filter((o) => o.b !== i.b && o.b !== state.held);
      for (const cl of colliders) {
        if (cl.link < arm.hand - 1) continue; // link 7, the hand and the fingers
        const R = Fg.R[cl.link], P0 = Fg.P[cl.link], o = mv(R, cl.c), he = cl.body.shapes[0].halfExtents;
        const ca = [P0[0] + o[0], P0[1] + o[1], P0[2] + o[2]], A = mm(R, cl.R), ea = [he.x, he.y, he.z];
        for (const ob of others) {
          const p = ob.b.body.position, q = ob.b.body.quaternion, eb = [ob.h + M, ob.h + M, ob.h + M];
          if (obbOverlap(ca, A, ea, [p.x, p.y, p.z], quatToM(q.w, q.x, q.y, q.z), eb)) return { unreachable: false, box: ob.b };
        }
      }
      return { unreachable: false, box: null };
    }
    // The fingers can close on either pair of faces: try the smaller turn of the wrist first, then the other one.
    // Returns the wrist offset to use, or null with the box that is in the way.
    function chooseGrip(i) {
      const c = cyl(i.x, i.z), w0 = wrap(4 * (i.yaw - c.th - NOMINAL)) / 4;
      let first = null;
      for (const w of [w0, w0 > 0 ? w0 - Math.PI / 2 : w0 + Math.PI / 2]) {
        const g = gripBlocker(i, w);
        if (!g.unreachable && !g.box) return { w, blocker: null };
        if (!first || (!first.box && g.box)) first = g;
      }
      return { w: null, blocker: first.box };
    }
    function pickPlan(i, wGrip) {
      const list = infos(), c = cyl(i.x, i.z);
      // line the fingers up with a pair of faces: the one chosen by chooseGrip, else the nearest
      const w = wGrip !== undefined && wGrip !== null ? wGrip : wrap(4 * (i.yaw - c.th - NOMINAL)) / 4;
      const depth = pickDepth(i);
      const H = Math.max(P.safeH, maxTop(list, null) + P.clearEmpty, F.tcp[1]);
      const seq = [];
      if (state.cmd.y < H - 0.01) seq.push({ move: { y: H }, v: P.vLift });
      seq.push({ move: { th: c.th, r: c.r, y: H, w }, v: P.vApproach, label: 'Approach' });
      if (H > i.top + P.approachGap + 0.03) seq.push({ move: { y: i.top + P.approachGap }, v: P.vDrop, blend: P.blend, guard: 'pick', label: 'Descend' });
      seq.push({ move: { th: c.th, r: c.r, y: i.top - depth }, v: P.vPick, final: true, guard: 'pick', label: 'Descend' });
      seq.push({ close: true, label: 'Grasp' });
      return seq;
    }
    // highest surface under a footprint, read from every box
    function supportTop(x, z, half, except) {
      let top = 0;
      for (const i of infos()) {
        if (i.b === except) continue;
        const reach = half + i.h * 1.15;
        if (Math.abs(i.x - x) < reach && Math.abs(i.z - z) < reach && i.top > top) top = i.top;
      }
      return top;
    }
    function placePlan(dest) {
      const b = state.held, list = infos().filter((i) => i.b !== b);
      dest.base = supportTop(dest.x, dest.z, b.size * 0.45, b);
      const y = fingerAxis(F), baNow = Math.atan2(y[2], y[0]);
      const rel = wrap(4 * (boxInfo(b).yaw - baNow)) / 4;          // box yaw relative to the fingers, mod 90°
      // the hand ends at the destination's heading; pick the wrist offset that squares the box up, within ±45°
      let c = cyl(dest.x, dest.z), w = 0, off = [0, 0, 0];
      for (let k = 0; k < 2; k++) {                                 // the box hangs a little off the TCP, so refine once
        w = wrap(4 * (dest.align - rel - c.th - NOMINAL)) / 4;
        const turn = (c.th - state.cmd.th) + (w - state.cmd.w);      // how far the hand turns on the way
        off = mv(downR(baNow + turn), [state.rel.p.x, state.rel.p.y, state.rel.p.z]);
        c = cyl(dest.x - off[0], dest.z - off[2]);
      }
      const yPlace = dest.base + P.placeGap + b.size / 2 - off[1];
      const H = Math.min(GEOM.yMax, Math.max(P.safeH, maxTop(list, null) + b.size + P.clearHeld, state.cmd.y + 0.04));
      return [
        { move: { y: H }, v: P.vLift, label: 'Lift' },
        { move: { th: c.th, r: c.r, y: H, w }, v: P.vTransfer, label: 'Transfer' },
        { move: { y: yPlace + P.approachGap }, v: P.vDrop, blend: P.blend, guard: 'place', label: 'Place' },
        { move: { th: c.th, r: c.r, y: yPlace }, v: P.vPlace, final: true, guard: 'place', label: 'Place' },
        { open: Math.min(GEOM.openMax, b.size + 0.025), label: 'Release' },
        { move: { y: Math.min(yPlace + P.retreat, GEOM.yMax) }, v: P.vRetreat, label: 'Retreat' },
      ];
    }
    function arrived(fine) {
      const g = state.goal, gw = toWorld({ r: g.r, y: g.y }, g.th);
      const err = hyp(F.tcp[0] - gw.x, F.tcp[1] - gw.y, F.tcp[2] - gw.z);
      let still = 0; for (let i = 0; i < 7; i++) still = Math.max(still, Math.abs(state.qd[i]));
      if (cylDist(state.cmd, state.goal) > 1e-4 || Math.abs(state.goal.w - state.cmd.w) > 0.01) return false;
      if (!fine) return err < 0.015 && still < 0.35;
      const ax = fingerAxis(F), ba = Math.atan2(ax[2], ax[0]);
      return err < 0.0025 && still < 0.03 && Math.abs(wrap(2 * (ba - state.cmd.th - NOMINAL - state.cmd.w))) < 0.03;
    }
    function runSeq(dt) {
      const s = AP.seq[0];
      if (!s) return 'done';
      if (!s.started) {
        s.started = true; AP.t = 0; state.touchdown = false; state.touchOn = null;
        if (s.label) state.phaseLabel = s.label;
        if (s.move) setGoal(s.move, s.v);
        if (s.close) state.closing = true;
        if (s.open !== undefined) { state.closing = false; state.openTarget = s.open; }
      }
      AP.t += dt;
      if (s.move) {
        // AP.why records why a sequence failed: touched something on the way down, never arrived, or could not grip
        if (s.guard && state.touchdown) {
          if (s.guard === 'pick') { AP.why = 'touch'; return 'fail'; }
          while (AP.seq.length && AP.seq[0].move) AP.seq.shift(); // touched down early: release here
        }
        else if (s.blend && cylDist(state.cmd, state.goal) < s.blend) AP.seq.shift();
        else if (arrived(s.final)) AP.seq.shift();
        else if (AP.t > 10) { AP.why = 'stuck'; return 'fail'; }
      }
      else if (s.close) { if (state.held) AP.seq.shift(); else if (AP.t > 1.6) { AP.why = 'grip'; return 'fail'; } }
      else if (s.open !== undefined) { if (AP.t > 0.4) AP.seq.shift(); }
      return AP.seq.length ? 'busy' : 'done';
    }
    function chooseTask() {
      const list = infos(), tower = towerAt(list);
      AP.cool.forEach((t, id) => { if (state.time > t) AP.cool.delete(id); });
      const done = (AP.mode === 'stack' && tower.members.length === boxes.length) ||
        (AP.mode === 'scatter' && tower.members.length === 0 && list.every((i) => i.bottom < 0.01));
      if (done) { AP.mode = AP.mode === 'stack' ? 'scatter' : 'stack'; AP.hold = 1.4; return null; }
      if (AP.mode === 'stack' && !towerValid(tower)) AP.mode = 'scatter';
      if (AP.mode === 'stack') {
        const c = list.filter((i) => !tower.members.includes(i) && i.upright && isFree(i, list) && !AP.cool.has(i.b.id) && i.speed < 0.03 &&
          i.r > GEOM.rMin && i.r < GEOM.rMax && inSector(i.th)).sort((a, b) => b.h - a.h)[0];
        if (c) return { box: c, dest: { x: padP.x, z: padP.z, align: GEOM.padAz * D2R } };
      } else {
        const top = tower.members[tower.members.length - 1];
        if (top && isFree(top, list) && !AP.cool.has(top.b.id)) { const d = floorSpot(top, list); if (d) return { box: top, dest: d }; }
        const stray = list.find((i) => !tower.members.includes(i) && i.bottom > 0.01 && i.upright && isFree(i, list) && !AP.cool.has(i.b.id));
        if (stray) { const d = floorSpot(stray, list); if (d) return { box: stray, dest: d }; }
      }
      return null;
    }
    function abortTask() {
      if (AP.box) AP.cool.set(AP.box.id, state.time + 6);
      state.closing = false; state.openTarget = GEOM.openMax * 0.8;
      AP.seq = [{ move: { y: Math.min(state.cmd.y + 0.1, GEOM.yMax) }, v: P.vRetreat, label: 'Retreat' }];
      AP.box = null; AP.dest = null; state.path = null; AP.phase = 'retreat';
    }
    function setPath(seq) {
      const pts = [toWorld({ r: state.cmd.r, y: state.cmd.y }, state.cmd.th)];
      let c = { th: state.cmd.th, r: state.cmd.r, y: state.cmd.y };
      for (const s of seq) {
        if (!s.move) continue;
        const n = { th: s.move.th !== undefined ? thOK(s.move.th) : c.th, r: s.move.r !== undefined ? s.move.r : c.r, y: s.move.y !== undefined ? s.move.y : c.y };
        const steps = Math.max(1, Math.ceil(Math.abs(n.th - c.th) / 0.06));
        for (let k = 1; k <= steps; k++) { const t = k / steps; pts.push(toWorld({ r: c.r + (n.r - c.r) * t, y: c.y + (n.y - c.y) * t }, c.th + (n.th - c.th) * t)); }
        c = n;
      }
      state.path = pts;
    }
    function autopilot(dt) {
      AP.since += dt;
      if (AP.since > 45) { AP.since = 0; reset(); return; }
      if (AP.hold > 0) { AP.hold -= dt; state.phaseLabel = 'Hold'; setGoal({ th: home.th, r: home.r, y: home.y, w: 0 }, 0.5); return; }
      if (!AP.phase || AP.phase === 'idle') {
        if (infos().some((i) => i.b !== state.held && i.speed > P.settleSpeed) && AP.settle < 2) { AP.settle += dt; state.phaseLabel = 'Settling'; return; }
        AP.settle = 0;
        const task = chooseTask();
        if (!task) {
          if (AP.hold > 0) return;
          state.phaseLabel = 'Waiting'; AP.idle += dt;
          setGoal({ th: home.th, r: home.r, y: home.y }, 0.5);
          if (AP.idle > 3 && !AP.flipped) { AP.flipped = true; AP.mode = AP.mode === 'stack' ? 'scatter' : 'stack'; }
          if (AP.idle > 8) reset();
          return;
        }
        // a box the hand cannot get around either way waits out a cool-down while the planner tries another
        const grip = chooseGrip(task.box);
        if (grip.w === null) { AP.cool.set(task.box.b.id, state.time + 6); return; }
        AP.idle = 0; AP.flipped = false;
        AP.box = task.box.b; AP.dest = task.dest; AP.pickInfo = { x: task.box.x, z: task.box.z };
        state.openTarget = pickOpen(task.box.b);
        AP.seq = pickPlan(task.box, grip.w); setPath(AP.seq);
        AP.phase = 'pick';
      }
      if (AP.phase === 'pick') {
        const i = boxInfo(AP.box);
        if (!state.held && hyp(i.x - AP.pickInfo.x, i.z - AP.pickInfo.z) > P.movedAbort) { abortTask(); return; }
        const r = runSeq(dt);
        if (r === 'fail') { abortTask(); return; }
        if (r === 'done') {
          if (state.held !== AP.box) { abortTask(); return; }
          AP.seq = placePlan(AP.dest); setPath(AP.seq); AP.phase = 'place';
        }
      } else if (AP.phase === 'place') {
        const r = runSeq(dt);
        if (r === 'fail') { state.closing = false; abortTask(); return; }
        if (AP.seq.length && AP.seq[0].open !== undefined && AP.seq[0].started && !AP.counted) { AP.counted = true; state.placed++; AP.since = 0; }
        if (r === 'done') { AP.counted = false; AP.box = null; state.path = null; AP.phase = 'idle'; }
      } else if (AP.phase === 'retreat') {
        const r = runSeq(dt);
        if (r !== 'busy') { AP.phase = 'idle'; state.openTarget = GEOM.openMax; }
      }
    }

    // ---------- assisted manual actions ----------
    const MAN = { seq: [], active: false, box: null };
    const BLOCKED = "Can't reach it, another box is in the way";
    function manualStep(dt) {
      if (MAN.active) {
        AP.seq = MAN.seq;
        const r = runSeq(dt);
        if (r === 'fail') {
          // say what stopped it: the hand came down on another box, could not close on this one, or never got there
          MAN.active = false;
          const hit = AP.why === 'touch' ? boxes.find((b) => b.body === state.touchOn) : null;
          if (hit && hit !== MAN.box) note(BLOCKED, hit);
          else if (AP.why === 'grip' || AP.why === 'touch') note("Couldn't get a grip on that box");
          else note("Couldn't reach that spot");
        }
        else if (r === 'done') { MAN.active = false; state.phaseLabel = state.held ? 'Holding' : 'Steering'; }
        return;
      }
      // a visitor who took over by clicking gets autopilot back after eight idle seconds
      if (!state.holdManual && state.time - state.lastInput > 8) resumeAuto();
    }
    // a short message for the visitor; blocker is the box to point at, if one is to blame
    function note(msg, blocker) { state.notice = msg; state.noticeT = state.time; state.blocker = blocker || null; return false; }
    function touch() { state.lastInput = state.time; if (state.mode !== 'manual') { state.mode = 'manual'; AP.phase = 'idle'; AP.seq = []; state.path = null; } }
    function hover(x, z) {
      touch();
      if (MAN.active) return;
      let floor = P.hoverFloor;
      for (const i of infos()) if (i.b !== state.held && hyp(i.x - x, i.z - z) < P.hoverReach) floor = Math.max(floor, i.top + (state.held ? state.held.size + P.hoverHeld : P.hoverEmpty));
      const c = cyl(x, z);
      setGoal({ th: c.th, r: clamp(c.r, GEOM.rMin, GEOM.rMax), y: floor }, 1.0);
      state.phaseLabel = state.held ? 'Holding' : 'Steering';
    }
    function reachable(x, z, margin) {
      const c = cyl(x, z);
      return c.r > GEOM.rMin + margin && c.r < GEOM.rMax - margin && inSector(c.th, 0.02);
    }
    function pickBox(id) {
      touch();
      const b = boxById.get(id); if (!b) return false;
      if (state.held) return note('Put the held box down first');
      const i = boxInfo(b), list = infos();
      if (!i.upright) return note("That box is tilted, so the gripper can't hold it");
      if (!isFree(i, list)) return note('Take the top box first');
      if (!reachable(i.x, i.z, 0.01)) return note('That box is out of reach');
      // check the hand fits around it before moving, turning the grip a quarter turn if one side is blocked
      const grip = chooseGrip(i);
      if (grip.w === null) return grip.blocker ? note(BLOCKED, grip.blocker) : note('That box is out of reach');
      state.closing = false;
      state.openTarget = pickOpen(b);
      MAN.seq = pickPlan(i, grip.w); MAN.box = b; MAN.active = true; setPath(MAN.seq);
      return true;
    }
    function placeAt(x, z, onId) {
      touch();
      if (!state.held) return false;
      const list = infos().filter((i) => i.b !== state.held);
      let px = x, pz = z, base = 0;
      if (onId) {
        const t = boxById.get(onId), ti = t && boxInfo(t);
        if (!ti) return false;
        if (!ti.upright) return note("That box is tilted, so nothing can go on it");
        if (!isFree(ti, infos())) return note('That box has something on it');
        px = ti.x; pz = ti.z; base = ti.top;
      } else if (list.some((o) => hyp(o.x - x, o.z - z) < o.h + state.held.size / 2 + P.roomClear)) return note('No room there');
      if (!reachable(px, pz, 0.02)) return note('Out of reach');
      if (base + state.held.size + 0.12 > GEOM.yMax) return note('Too high to stack');
      const align = onId ? boxInfo(boxById.get(onId)).yaw : Math.atan2(pz, px);
      MAN.seq = placePlan({ x: px, z: pz, align }); MAN.active = true; setPath(MAN.seq);
      return true;
    }
    function toggleGrip() {
      touch(); MAN.active = false;
      if (state.closing || state.held) { state.closing = false; state.openTarget = GEOM.openMax; }
      else state.closing = true;
    }
    function resumeAuto() {
      state.mode = 'auto'; MAN.active = false; AP.seq = []; AP.phase = 'idle'; AP.hold = 0;
      state.notice = ''; state.noticeT = -9; state.blocker = null; // a manual-mode notice no longer applies
      if (state.held) {
        const list = infos(), rest = list.filter((i) => i.b !== state.held), tower = towerAt(rest);
        const fits = towerValid(tower) && Math.abs(state.held.size - sizesDesc[tower.members.length]) < 1e-6;
        AP.mode = 'stack';
        const dest = fits ? { x: padP.x, z: padP.z, align: GEOM.padAz * D2R } : floorSpot(boxInfo(state.held), list);
        if (dest) { AP.box = state.held; AP.dest = dest; AP.seq = placePlan(dest); setPath(AP.seq); AP.phase = 'place'; }
        else state.closing = false;
      } else { state.closing = false; state.openTarget = GEOM.openMax; }
    }
    // the Autopilot switch: off holds manual control until it is switched on again
    function setAuto(on) {
      if (on) { state.holdManual = false; resumeAuto(); }
      else { touch(); state.holdManual = true; }
    }
    function reset() {
      state.resets = (state.resets || 0) + 1;
      if (state.held) { state.closing = false; detach(); }
      boxes.forEach((b, i) => {
        b.body.position.set(slotP[i].x, b.size / 2, slotP[i].z);
        b.body.quaternion.setFromAxisAngle(V3(0, 1, 0), -GEOM.slotAz[i] * D2R);
        b.body.velocity.set(0, 0, 0); b.body.angularVelocity.set(0, 0, 0); b.body.wakeUp();
      });
      AP.mode = 'stack'; AP.cool.clear(); AP.hold = 0; AP.seq = []; AP.phase = 'idle'; AP.since = 0; AP.idle = 0;
      state.path = null; MAN.active = false; state.openTarget = GEOM.openMax;
      // a reset puts the boxes back but leaves autopilot as the visitor set it
      if (state.holdManual) { state.mode = 'manual'; state.lastInput = state.time; } else state.mode = 'auto';
    }

    // ---------- main step ----------
    function step(frameDt) {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      state.acc = Math.min(state.acc + frameDt, 6 * DT);
      const n = Math.floor(state.acc / DT + 1e-9);
      state.acc -= n * DT;
      for (let k = 0; k < n; k++) {
        if (state.mode === 'auto') autopilot(DT); else manualStep(DT);
        stepCommand(DT);
        const tgt = tcpTarget(state.cmd);
        let ik = solveIK(arm, tgt, state.qDes, 3);
        if (!ik.reachable && state.time - (state.reseedT || -1) > 0.25) {
          // tracking ran into a joint limit: solve again from the natural posture and keep the better answer
          state.reseedT = state.time;
          const seed = [wrap(arm.heading - tgt.th), -0.25, 0, -2.3, 0, 2.05, 0.785];
          for (const flip of [false, true]) {
            const alt = solveIK(arm, tgt, seed, 80, flip);
            if (alt.ep + 0.1 * alt.eo < ik.ep + 0.1 * ik.eo - 1e-4) ik = alt;
          }
        }
        for (let i = 0; i < 7; i++) {
          const v = clamp((ik.q[i] - state.qDes[i]) / DT, -JOINTS[i].wMax, JOINTS[i].wMax);
          // the IK lands a little differently each step; smooth the acceleration feedforward so torques read cleanly
          state.qddDes[i] += 0.3 * (clamp((v - state.qdDes[i]) / DT, -20, 20) - state.qddDes[i]);
          state.qdDes[i] = v; state.qDes[i] = ik.q[i];
        }
        state.reachable = ik.reachable; state.ikErr = ik.ep;
        jointDynamics(DT);
        F = arm.fk(state.q, opening(state.open));
        const tcp = F.tcp;
        if (state.tcpPrev) state.tcpSpeed = state.tcpSpeed * 0.9 + 0.1 * hyp(tcp[0] - state.tcpPrev[0], tcp[1] - state.tcpPrev[1], tcp[2] - state.tcpPrev[2]) / DT;
        state.tcpPrev = tcp;
        updateGripper(DT);
        F = arm.fk(state.q, opening(state.open));
        placeColliders(F, DT);
        world.step(DT);
        for (const c of colliders) snapBody(c.body);
        if (state.held) snapBody(state.held.body);
        state.pressedOn = detectPressing(); state.pressing = !!state.pressedOn;
        state.time += DT;
        // a box that ends up off the table resets the cell
        if (boxes.some((b) => b !== state.held && (!onTable(b.body.position.x, b.body.position.z, 0.01) || b.body.position.y < -0.05))) reset();
      }
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      state.stepMs = state.stepMs * 0.9 + (t1 - t0) * 0.1;
    }

    function telemetry() {
      return {
        mode: state.mode, hold: state.holdManual,
        phase: state.time - state.noticeT < 2.5 ? state.notice : state.phaseLabel, notice: state.time - state.noticeT < 2.5,
        blocker: state.time - state.noticeT < 2.5 && state.blocker ? state.blocker.id : null,
        joints: JOINTS.map((J, i) => ({ name: J.name, angle: state.q[i] * 180 / Math.PI, torque: state.tau[i], load: Math.min(1, Math.abs(state.tau[i]) / J.maxTorque) })),
        grip: { open: state.open, closing: state.closing, held: !!state.held },
        payload: state.held ? state.held.mass : 0,
        tcp: tcpOf(F), speed: state.tcpSpeed || 0,
        placed: state.placed, stepMs: state.stepMs, reachable: state.reachable,
      };
    }

    return {
      GEOM, JOINTS, arm, world, boxes, colliders, state, armF, opening, toWorld, boxInfo, infos, inSector, onTable, TH_MIN, TH_MAX,
      step, hover, pickBox, placeAt, toggleGrip, setAuto, reset, telemetry, padP, slotP, NOMINAL,
      _ap: AP, _man: MAN, _grip: chooseGrip, _pickPlan: pickPlan,
    };
  }

  return { create, GEOM, JOINTS, makeArm, solveIK, mToQuat };
});
