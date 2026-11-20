/* The proteins on the home page, each as AlphaFold predicted it, folding live. The physics runs in a Web
   Worker (protein-sim.js); this file draws the chain the way AlphaFold's viewer does, as cartoon ribbons
   coloured on AlphaFold's confidence scale, rebuilt from the moving chain every frame. Here the colour says
   how much of each part's native structure is in place. A menu over the picture switches the protein. */
(function () {
  'use strict';
  const root = document.getElementById('protein');
  if (!root) return;
  const LIST = window.PROTEIN_DATA;
  const stage = root.querySelector('.pr-stage');
  const canvas = stage.querySelector('canvas');
  const menu = root.querySelector('.pr-menu');
  const stateEl = root.querySelector('.pr-state'), stateT = stateEl.querySelector('.pr-state-t'), stateD = stateEl.querySelector('.pr-state-d');
  const capEl = document.getElementById('pr-cap'), creditEl = document.getElementById('pr-credit');
  const heatBtn = document.getElementById('pr-heat');
  const heatState = heatBtn.querySelector('.ap-state');
  const resetBtn = document.getElementById('pr-reset');
  const tip = root.querySelector('.pr-tip');
  const termN = root.querySelector('.pr-term-n'), termC = root.querySelector('.pr-term-c');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const AA = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val' };
  let cur = 0, D = LIST[0], N = 0, OFF = 0, T_COLD = 0.7, T_HOT = 1.4;
  const resName = (i) => AA[D.seq[i]] + (i + OFF);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ACTIONS = ' <span class="pr-do">Drag to turn it, grab the chain to pull on it, or turn on the heat.</span>';

  // the menu, one entry per protein
  LIST.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = p.label;
    b.setAttribute('aria-checked', String(i === 0)); b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener('click', () => { if (!root.classList.contains('is-off')) select(i); });
    menu.appendChild(b);
  });
  menu.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d || root.classList.contains('is-off')) return;
    e.preventDefault();
    const i = (cur + d + LIST.length) % LIST.length;
    select(i); menu.children[i].focus();
  });
  function words() {
    capEl.innerHTML = D.cap + (root.classList.contains('is-off') ? '' : ACTIONS);
    // the AlphaFold DB licence (CC BY 4.0) asks for credit wherever a model is shown
    if (creditEl) creditEl.innerHTML = `Simulated from AlphaFold DB model <a href="https://alphafold.ebi.ac.uk/entry/${D.uniprot}" target="_blank" rel="noopener noreferrer">${D.entry}</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.`;
    canvas.setAttribute('aria-label', `${D.name} drawn as ribbons, coloured blue where its native structure holds and orange where it has come apart.`);
  }

  function still(msg) {
    stage.classList.add('pr-off'); root.classList.add('is-off');
    const p = document.createElement('p'); p.className = 'pr-note'; p.textContent = msg; stage.appendChild(p);
    words();
    window.__protein = { ready: () => true, state: () => ({ off: true }) };
  }
  const T3 = window.THREE;
  if (!T3) return still('The 3D engine did not load, so this is a still of the protein. Reload the page to try again.');
  let renderer = null;
  try { renderer = new T3.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
  if (!renderer || !renderer.getContext()) return still('This browser has 3D graphics turned off, so this is a still of the protein, folded as AlphaFold predicted it.');

  // ------------------------------------------------------------------ the physics, off the main thread
  const simEl = document.getElementById('protein-sim');
  const initMsg = () => ({ ca: D.ca, opts: { T: T_COLD }, ents: D.ents, rep: D.rep });
  let worker = null, local = null, inFlight = false, latest = null, fresh = false, steps = 120, frames = 0, gen = 0;
  // The physics keeps to wall-clock time: about 12,000 steps a second however fast the page draws, as long as each
  // batch takes at most most of a frame in the worker. A slow screen then shows the same folding, in fewer pictures.
  const RATE = 12000;
  let msPerStep = 0.05, sent = 0, lastTick = 0;
  function plan(dt) { return Math.round(Math.max(20, Math.min(RATE * dt / 1000, Math.min(60, Math.max(8, dt * 0.8)) / msPerStep, 2000))); }
  function tune(ms) { if (typeof ms !== 'number') return; steps = Math.round(Math.max(30, Math.min(200, steps * Math.max(0.8, Math.min(1.12, 4 / Math.max(0.5, ms)))))); }
  function startLocal() {
    worker = null;
    if (typeof window.makeProteinDriver !== 'function') return;
    local = window.makeProteinDriver(initMsg()); latest = local.tick(0); fresh = true; inFlight = false; steps = 60;
  }
  try {
    worker = new Worker(URL.createObjectURL(new Blob([simEl.textContent], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      if (e.data.type !== 'frame' || e.data.gen !== gen) return;
      latest = e.data.fr; fresh = true; inFlight = false; frames++;
      if (typeof latest.ms === 'number' && sent > 40) msPerStep += (Math.max(0.004, latest.ms / sent) - msPerStep) * 0.3;
    };
    worker.onerror = () => startLocal();
  } catch (e) { worker = null; }
  function boot() {   // start the physics over for the protein now shown
    gen++; latest = null; fresh = false; inFlight = false;
    if (worker) { worker.postMessage({ type: 'init', init: initMsg(), gen }); inFlight = true; sent = 0; lastTick = 0; }
    else startLocal();
  }
  function send(m) {
    if (worker) worker.postMessage(m);
    else if (local) { if (m.type === 'T') local.setT(m.T); else if (m.type === 'pull') local.setPull(m.i, m.p); else if (m.type === 'reset') local.reset(); }
  }
  function advance() {
    if (worker) {
      if (inFlight) return;
      const now = performance.now(), dt = lastTick ? Math.min(250, now - lastTick) : 16;
      lastTick = now; steps = sent = plan(dt);
      worker.postMessage({ type: 'tick', steps }); inFlight = true;
    }
    else if (local) { const t = performance.now(); latest = local.tick(steps); fresh = true; frames++; tune(performance.now() - t); }
  }

  // ------------------------------------------------------------------ scene
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T3.sRGBEncoding;
  renderer.toneMapping = T3.NoToneMapping;
  const scene = new T3.Scene();
  const camera = new T3.PerspectiveCamera(24, 1, 1, 4000);
  if (T3.RoomEnvironment) { const pm = new T3.PMREMGenerator(renderer); scene.environment = pm.fromScene(new T3.RoomEnvironment(), 0.04).texture; pm.dispose(); }
  const key = new T3.DirectionalLight(0xffffff, 0.92); key.position.set(-0.55, 0.75, 1);
  const fill = new T3.DirectionalLight(0xffffff, 0.2); fill.position.set(0.8, -0.35, 0.6);
  const hemi = new T3.HemisphereLight(0xffffff, 0xd6d8e2, 0.2);
  camera.add(key, fill); scene.add(camera, hemi);
  scene.fog = new T3.Fog(0xffffff, 60, 200);
  const group = new T3.Group(); scene.add(group);

  // ------------------------------------------------------------------ the cartoon
  const S = 8, K = 14;
  let M = 0, RV = 0, vPos, vNor, vCol, SS = '', lastOfStrand, order, shade, resVal, ctrl, SP, ST, GN;
  const sc = new Float32Array(3);
  const mat = new T3.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, envMapIntensity: 0.32 });
  const mesh = new T3.Mesh(new T3.BufferGeometry(), mat); mesh.frustumCulled = false; group.add(mesh);
  const SHAPE = { H: [2.5, 0.5, 0.42], E: [2.15, 0.5, 0.42], C: [0.62, 0.62, 1] };   // width, thickness, squareness of the cross-section
  const cosK = [], sinK = [];
  for (let k = 0; k < K; k++) { const a = (2 * Math.PI * k) / K; cosK.push(Math.cos(a)); sinK.push(Math.sin(a)); }

  // the loop a strand threads: a translucent film across it, the contact that closes it, and where the strand passes through
  let fPos = new Float32Array(3);
  // a stencil lets each pixel of the film be painted once, so the folds of a loop that is not flat do not streak
  const filmMat = new T3.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0, side: T3.DoubleSide, depthWrite: false, fog: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: T3.NotEqualStencilFunc, stencilZPass: T3.ReplaceStencilOp });
  const film = new T3.Mesh(new T3.BufferGeometry(), filmMat); film.frustumCulled = false; film.renderOrder = 2; group.add(film);
  const rodMat = new T3.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0 });
  const rod = new T3.Mesh(new T3.CylinderGeometry(0.22, 0.22, 1, 10, 1, true), rodMat); group.add(rod);
  const pierceMat = new T3.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false });
  const pierce = new T3.Mesh(new T3.SphereGeometry(0.75, 20, 14), pierceMat); pierce.renderOrder = 4; group.add(pierce);
  const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T3.CanvasTexture(c); })();
  const halo = new T3.Sprite(new T3.SpriteMaterial({ map: haloTex, color: 0x8b5cf6, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  halo.scale.set(6, 6, 1); halo.renderOrder = 3; group.add(halo);
  // a grabbed residue and the spring to the pointer
  const grabMat = new T3.MeshBasicMaterial({ color: 0x18181b, transparent: true, opacity: 0.9, depthTest: false });
  const grabDot = new T3.Mesh(new T3.SphereGeometry(0.85, 18, 12), grabMat); grabDot.visible = false; grabDot.renderOrder = 5; group.add(grabDot);
  const bandGeo = new T3.BufferGeometry(); bandGeo.setAttribute('position', new T3.BufferAttribute(new Float32Array(6), 3));
  const band = new T3.Line(bandGeo, new T3.LineBasicMaterial({ color: 0x18181b, transparent: true, opacity: 0.55, depthTest: false })); band.visible = false; band.renderOrder = 5; group.add(band);

  // AlphaFold's confidence colours: very high, confident, low, very low
  const AF = [[255, 125, 69], [255, 219, 19], [101, 203, 243], [0, 83, 214]].map((c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }));
  function afColor(v, out, o) {   // v on AlphaFold's 0 to 100 scale, with a short blend at each band edge
    const s1 = smooth(47, 53, v), s2 = smooth(67, 73, v), s3 = smooth(87, 93, v);
    for (let a = 0; a < 3; a++) out[o + a] = AF[0][a] + (AF[1][a] - AF[0][a]) * s1 + (AF[2][a] - AF[1][a]) * s2 + (AF[3][a] - AF[2][a]) * s3;
  }

  // everything that depends on the chain: its length, its native shape, the buffers the ribbon is built in
  let NATIVE, disp, dq, ONES, REST_ENT = null, nativeR = 1, needBuild = true, snapDist = true;
  function setup() {
    N = D.ca.length; OFF = D.offset; T_COLD = D.T ? D.T[0] : 0.7; T_HOT = D.T ? D.T[1] : 1.4;
    M = (N - 1) * S + 1; RV = M * K;
    const g = new T3.BufferGeometry();
    vPos = new Float32Array((RV + 2 * (K + 1)) * 3); vNor = new Float32Array(vPos.length); vCol = new Float32Array(vPos.length);
    g.setAttribute('position', new T3.BufferAttribute(vPos, 3).setUsage(T3.DynamicDrawUsage));
    g.setAttribute('normal', new T3.BufferAttribute(vNor, 3).setUsage(T3.DynamicDrawUsage));
    g.setAttribute('color', new T3.BufferAttribute(vCol, 3).setUsage(T3.DynamicDrawUsage));
    const idx = [];
    for (let r = 0; r < M - 1; r++) for (let k = 0; k < K; k++) {
      const a = r * K + k, b = r * K + (k + 1) % K, c = a + K, d = b + K;
      idx.push(a, c, b, b, c, d);
    }
    for (const [cap, ring, flip] of [[RV, 0, true], [RV + K + 1, (M - 1) * K, false]]) {
      for (let k = 0; k < K; k++) { const a = cap + 1 + k, b = cap + 1 + (k + 1) % K; if (flip) idx.push(cap, b, a); else idx.push(cap, a, b); }
      void ring;
    }
    g.setIndex(idx);
    mesh.geometry.dispose(); mesh.geometry = g;
    const fg = new T3.BufferGeometry(); fPos = new Float32Array((N * S + 12) * 3);
    fg.setAttribute('position', new T3.BufferAttribute(fPos, 3).setUsage(T3.DynamicDrawUsage));
    film.geometry.dispose(); film.geometry = fg;
    SS = D.ss; lastOfStrand = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (SS[i] === 'E' && SS[i + 1] !== 'E') lastOfStrand[i] = 1;
    order = new Float32Array(N).fill(1); shade = new Float32Array(N).fill(1); resVal = new Float32Array(N);
    ctrl = new Float32Array(3 * (N + 2)); SP = new Float32Array(3 * M); ST = new Float32Array(3 * M); GN = new Float32Array(3 * N);
    NATIVE = new Float32Array(3 * N);
    const c = [0, 0, 0]; for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) c[a] += D.ca[i][a] / N;
    nativeR = 1;
    for (let i = 0; i < N; i++) { for (let a = 0; a < 3; a++) NATIVE[3 * i + a] = D.ca[i][a] - c[a]; nativeR = Math.max(nativeR, Math.hypot(NATIVE[3 * i], NATIVE[3 * i + 1], NATIVE[3 * i + 2])); }
    disp = new Float32Array(NATIVE); dq = new Float32Array(N).fill(1); ONES = new Float32Array(N).fill(1);
    REST_ENT = D.rep ? { i: D.rep[0], j: D.rep[1], side: D.rep[2], g: D.rep[3], native: true } : null;
    updateShade(NATIVE, 1);
    entA = 0; entShown = null; pierceHas = false; pierceMiss = 0;
    film.visible = rod.visible = pierce.visible = halo.visible = false;
    termN.hidden = termC.hidden = true;
    group.quaternion.set(D.view[0], D.view[1], D.view[2], D.view[3]);
    needBuild = true; snapDist = true; qShow = 1; said = ''; saidSr = '';
  }

  function buildCartoon(P, q) {
    // control points with a phantom point past each end
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) ctrl[3 * (i + 1) + a] = P[3 * i + a];
    for (let a = 0; a < 3; a++) { ctrl[a] = 2 * P[a] - P[3 + a]; ctrl[3 * (N + 1) + a] = 2 * P[3 * (N - 1) + a] - P[3 * (N - 2) + a]; }
    // Catmull-Rom through every C-alpha
    for (let i = 0; i < N - 1; i++) {
      for (let s = 0; s < S || (i === N - 2 && s === S); s++) {
        const t = s / S, m = i * S + s, t2 = t * t, t3 = t2 * t;
        for (let a = 0; a < 3; a++) {
          const p0 = ctrl[3 * i + a], p1 = ctrl[3 * (i + 1) + a], p2 = ctrl[3 * (i + 2) + a], p3 = ctrl[3 * (i + 3) + a];
          SP[3 * m + a] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
          ST[3 * m + a] = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2);
        }
      }
    }
    // the ribbon faces along the chain's curvature: outward on helices, out of the sheet on strands
    for (let i = 0; i < N; i++) {
      const a = Math.max(1, Math.min(N - 2, i));
      let gx = P[3 * (a - 1)] + P[3 * (a + 1)] - 2 * P[3 * a], gy = P[3 * (a - 1) + 1] + P[3 * (a + 1) + 1] - 2 * P[3 * a + 1], gz = P[3 * (a - 1) + 2] + P[3 * (a + 1) + 2] - 2 * P[3 * a + 2];
      const l = Math.hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
      if (i > 0 && SS[i] !== 'H' && gx * GN[3 * (i - 1)] + gy * GN[3 * (i - 1) + 1] + gz * GN[3 * (i - 1) + 2] < 0) { gx = -gx; gy = -gy; gz = -gz; }
      GN[3 * i] = gx; GN[3 * i + 1] = gy; GN[3 * i + 2] = gz;
    }
    // how ordered each residue is right now decides whether it is still a ribbon or has melted into a tube
    for (let i = 0; i < N; i++) {
      order[i] += (smooth(0.35, 0.82, q[i]) - order[i]) * 0.25;
      resVal[i] = Math.min(D.plddt[i], 30 + 70 * q[i]);   // on AlphaFold's 0 to 100 scale
    }
    let px = 0, py = 1, pz = 0;
    for (let m = 0; m < M; m++) {
      const i = Math.min(N - 2, Math.floor(m / S)), t = m / S - i, u = smooth(0, 1, t);
      // tangent, then the guide normal blended between residues and squared up against it
      let tx = ST[3 * m], ty = ST[3 * m + 1], tz = ST[3 * m + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let nx = GN[3 * i] * (1 - t) + GN[3 * (i + 1)] * t, ny = GN[3 * i + 1] * (1 - t) + GN[3 * (i + 1) + 1] * t, nz = GN[3 * i + 2] * (1 - t) + GN[3 * (i + 1) + 2] * t;
      let dd = nx * tx + ny * ty + nz * tz; nx -= dd * tx; ny -= dd * ty; nz -= dd * tz;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-4) { dd = px * tx + py * ty + pz * tz; nx = px - dd * tx; ny = py - dd * ty; nz = pz - dd * tz; nl = Math.hypot(nx, ny, nz) || 1; }
      nx /= nl; ny /= nl; nz /= nl;
      if (nx * px + ny * py + nz * pz < 0 && SS[i] !== 'H') { nx = -nx; ny = -ny; nz = -nz; }
      px = nx; py = ny; pz = nz;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      // cross-section size and shape
      const A = SHAPE[SS[i]], Bn = SHAPE[SS[i + 1]] || A, C = SHAPE.C;
      const oA = order[i], oB = order[i + 1];
      const w0 = C[0] + (A[0] - C[0]) * oA, w1 = C[0] + (Bn[0] - C[0]) * oB;
      const h0 = C[1] + (A[1] - C[1]) * oA, h1 = C[1] + (Bn[1] - C[1]) * oB, e0 = C[2] + (A[2] - C[2]) * oA, e1 = C[2] + (Bn[2] - C[2]) * oB;
      let w, h = h0 + (h1 - h0) * u, ex = e0 + (e1 - e0) * u;
      if (lastOfStrand[i] && oA > 0.05) {   // the arrowhead: wide at the last strand residue, to a point at the next
        w = Math.max(C[0], C[0] + (3.3 - C[0]) * (1 - t) * oA); h = h0; ex = e0;
      } else w = w0 + (w1 - w0) * u;
      // colour along the sample: blend the score between its two residues, then read the colour off the scale,
      // so a folded part next to an unfolded one passes through yellow and light blue, never through purple
      afColor(resVal[i] + (resVal[i + 1] - resVal[i]) * u, sc, 0);
      const sh = shade[i] + (shade[i + 1] - shade[i]) * u, cr = sc[0] * sh, cg = sc[1] * sh, cb = sc[2] * sh;
      const cx = SP[3 * m], cy = SP[3 * m + 1], cz = SP[3 * m + 2], hw = w / 2, hh = h / 2, pe = 2 - ex;
      for (let k = 0; k < K; k++) {
        const c = cosK[k], s = sinK[k], ac = Math.abs(c), as = Math.abs(s);
        const ox = Math.sign(c) * Math.pow(ac, ex) * hw, oy = Math.sign(s) * Math.pow(as, ex) * hh;
        let qx = Math.sign(c) * Math.pow(ac, pe) / hw, qy = Math.sign(s) * Math.pow(as, pe) / hh;
        const ql = Math.hypot(qx, qy) || 1; qx /= ql; qy /= ql;
        const v = 3 * (m * K + k);
        vPos[v] = cx + ox * bx + oy * nx; vPos[v + 1] = cy + ox * by + oy * ny; vPos[v + 2] = cz + ox * bz + oy * nz;
        vNor[v] = qx * bx + qy * nx; vNor[v + 1] = qx * by + qy * ny; vNor[v + 2] = qx * bz + qy * nz;
        vCol[v] = cr; vCol[v + 1] = cg; vCol[v + 2] = cb;
      }
    }
    // end caps
    for (const [cap, m, sign] of [[RV, 0, -1], [RV + K + 1, M - 1, 1]]) {
      let tx = ST[3 * m], ty = ST[3 * m + 1], tz = ST[3 * m + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx *= sign / tl; ty *= sign / tl; tz *= sign / tl;
      const c = 3 * cap, r0 = 3 * (m * K);
      vPos[c] = SP[3 * m]; vPos[c + 1] = SP[3 * m + 1]; vPos[c + 2] = SP[3 * m + 2];
      vNor[c] = tx; vNor[c + 1] = ty; vNor[c + 2] = tz;
      for (let a = 0; a < 3; a++) vCol[c + a] = vCol[r0 + a];
      for (let k = 0; k < K; k++) { const d = 3 * (cap + 1 + k), s = 3 * (m * K + k); for (let a = 0; a < 3; a++) { vPos[d + a] = vPos[s + a]; vNor[d + a] = a === 0 ? tx : a === 1 ? ty : tz; vCol[d + a] = vCol[s + a]; } }
    }
    const g = mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = true;
    g.boundingSphere = null;
  }
  // a soft darkening where the chain is buried, like ambient occlusion
  function updateShade(P, rate) {
    for (let i = 0; i < N; i++) {
      let n = 0;
      for (let j = 0; j < N; j++) { if (Math.abs(i - j) < 3) continue; const dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2]; if (dx * dx + dy * dy + dz * dz < 100) n++; }
      shade[i] += ((1 - 0.3 * smooth(7, 20, n)) - shade[i]) * rate;
    }
  }

  // ------------------------------------------------------------------ the threaded loop
  let entA = 0, entShown = null, pierceMiss = 0, pierceHas = false;
  const V3 = () => new T3.Vector3();
  const va = V3(), vb = V3(), vc = V3();
  function updateFilm(ent, dt) {
    const want = ent ? 1 : 0;
    entA += (want - entA) * (reduce.matches ? 1 : 1 - Math.exp(-dt / 220));
    if (ent) entShown = ent;
    const e = entShown;
    filmMat.opacity = 0.16 * entA; rodMat.opacity = 0.85 * entA; pierceMat.opacity = entA; halo.material.opacity = 0.9 * entA;
    if (!e || entA < 0.01) { film.visible = rod.visible = pierce.visible = halo.visible = false; return; }
    film.visible = rod.visible = true;
    // the loop: the spline from residue i to j, closed straight across by their contact
    const a = e.i * S, b = e.j * S, pts = [];
    for (let m = a; m <= b; m++) pts.push([SP[3 * m], SP[3 * m + 1], SP[3 * m + 2]]);
    const last = pts[pts.length - 1], first = pts[0];
    for (let k = 1; k < 6; k++) { const t = k / 6; pts.push([last[0] + (first[0] - last[0]) * t, last[1] + (first[1] - last[1]) * t, last[2] + (first[2] - last[2]) * t]); }
    const c = [0, 0, 0]; for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
    fPos.fill(0);
    let o = 0; const tris = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      if (o + 9 > fPos.length) break;
      fPos.set(c, o); fPos.set(p, o + 3); fPos.set(q, o + 6); o += 9; tris.push([c, p, q]);
    }
    const fg = film.geometry;
    fg.setDrawRange(0, o / 3); fg.attributes.position.needsUpdate = true; fg.boundingSphere = null;
    // the rod across the closing contact
    va.set(first[0], first[1], first[2]); vb.set(last[0], last[1], last[2]);
    rod.position.copy(va).add(vb).multiplyScalar(0.5);
    vc.copy(vb).sub(va); const len = vc.length(); rod.scale.set(1, len, 1); rod.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), vc.normalize());
    // where the threading strand passes through the film
    const t0 = e.side === 'N' ? 0 : (e.j + 5) * S, t1 = e.side === 'N' ? Math.max(0, (e.i - 5) * S) : M - 1;
    let hit = null;
    for (let m = t0; m < t1 && !hit; m++) {
      const p = [SP[3 * m], SP[3 * m + 1], SP[3 * m + 2]], d = [SP[3 * m + 3] - p[0], SP[3 * m + 4] - p[1], SP[3 * m + 5] - p[2]];
      for (const [A, B, C] of tris) { const t = segTri(p, d, A, B, C); if (t !== null) { hit = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]; break; } }
    }
    // the crossing can slip past the fan for a frame or two when the loop folds over; hold the last one meanwhile
    if (hit) { pierceMiss = 0; if (!pierceHas) pierce.position.set(hit[0], hit[1], hit[2]); else pierce.position.lerp(tmpV.set(hit[0], hit[1], hit[2]), 0.35); pierceHas = true; }
    else if (++pierceMiss > 40) pierceHas = false;
    pierce.visible = halo.visible = pierceHas;
    halo.position.copy(pierce.position);
  }
  function segTri(p, d, A, B, C) {   // Moller-Trumbore, for a segment p + t d with t in [0, 1]
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(a) < 1e-9) return null;
    const f = 1 / a, s = [p[0] - A[0], p[1] - A[1], p[2] - A[2]], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) return null;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]); if (v < 0 || u + v > 1) return null;
    const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]); return t >= 0 && t <= 1 ? t : null;
  }

  // ------------------------------------------------------------------ theme
  let inkHex = '#18181b';
  function applyTheme() {
    const cs = getComputedStyle(document.documentElement), dark = document.documentElement.getAttribute('data-theme') === 'dark';
    scene.fog.color.set(getComputedStyle(root.querySelector('.pr-frame') || stage).backgroundColor || cs.getPropertyValue('--bg').trim() || '#ffffff');   // fade into the box's own background
    inkHex = cs.getPropertyValue('--ink').trim() || '#18181b';
    grabMat.color.set(inkHex); band.material.color.set(inkHex);
    filmMat.color.set(dark ? '#a78bfa' : '#8b5cf6'); rodMat.color.set(dark ? '#c4b5fd' : '#7c3aed'); halo.material.color.set(dark ? '#c4b5fd' : '#8b5cf6');
    hemi.groundColor.set(dark ? '#3a3a46' : '#d6d8e2'); hemi.intensity = dark ? 0.3 : 0.2; key.intensity = dark ? 1.02 : 0.92;
    kick();
  }
  document.addEventListener('themechange', applyTheme);

  // ------------------------------------------------------------------ size and framing
  // The protein fills about four fifths of the picture's height, leaving room below it for the key and the controls.
  let W = 1, H = 1, dist = 120, FILL = 0.8;
  function resize() {
    const r = stage.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix(); snapDist = true; kick();
  }
  function frameDistance(rCur) {   // far enough that the whole chain fits, horizontally and vertically
    const r = Math.max(nativeR, rCur), vf = (camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    return (r * 0.96) / (FILL * Math.sin(Math.min(vf, hf)));
  }

  // ------------------------------------------------------------------ pointer: drag to turn, grab the chain to pull
  const ray = new T3.Raycaster(), ndc = new T3.Vector2(), plane = new T3.Plane(), hitP = new T3.Vector3(), tmpV = new T3.Vector3();
  let drag = null, hoverRes = -1, pointerIn = false, lastUser = -1e9, vyaw = 0, vpitch = 0, pendingPull = null, held = false;
  function residueAt(e) {
    const r = stage.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(mesh, false);
    if (hits.length) {
      const f = hits[0].faceIndex, ringFaces = (M - 1) * K * 2;
      if (f >= ringFaces) return f < ringFaces + K ? 0 : N - 1;
      return Math.max(0, Math.min(N - 1, Math.round(Math.floor(f / (2 * K)) / S)));
    }
    // a near miss on a thin loop still counts: take the closest residue on screen, nearest the viewer first
    const px = e.clientX - r.left, py = e.clientY - r.top, reach = e.pointerType === 'touch' ? 22 : 14;
    let best = -1, bd = reach * reach, bz = Infinity;
    for (let i = 0; i < N; i++) {
      resWorld(i, tmpP); const z = tmpP.distanceTo(camera.position); tmpP.project(camera);
      const dx = (tmpP.x + 1) / 2 * r.width - px, dy = (1 - tmpP.y) / 2 * r.height - py, d = dx * dx + dy * dy;
      if (d < bd || (d < reach * reach && Math.abs(d - bd) < 30 && z < bz)) { bd = d; best = i; bz = z; }
    }
    return best;
  }
  const tmpP = new T3.Vector3();
  function resWorld(i, out) { out.set(disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]); return group.localToWorld(out); }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !latest) return;
    lastUser = performance.now();
    const i = residueAt(e);
    if (i >= 0) {
      drag = { kind: 'pull', id: e.pointerId, i }; wakeSim();
      resWorld(i, hitP); camera.getWorldDirection(tmpV); plane.setFromNormalAndCoplanarPoint(tmpV, hitP);
      stage.classList.add('is-pulling'); tip.hidden = true;
    } else drag = { kind: 'turn', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* fine without capture */ }
    vyaw = vpitch = 0; kick();
  });
  stage.addEventListener('pointermove', (e) => {
    pointerIn = e.pointerType === 'mouse';
    if (pointerIn) lastUser = Math.max(lastUser, performance.now() - 6000);   // someone looking counts as being here
    if (drag && e.pointerId === drag.id) {
      lastUser = performance.now();
      if (drag.kind === 'turn') {
        const dx = e.clientX - drag.x, dy = e.pointerType === 'mouse' ? e.clientY - drag.y : 0, dt = Math.max(1, performance.now() - drag.t);
        turn(dx * 0.008, dy * 0.008); vyaw = 0.7 * vyaw + 0.3 * (dx * 0.008) / dt; vpitch = 0.7 * vpitch + 0.3 * (dy * 0.008) / dt;
        drag.x = e.clientX; drag.y = e.clientY; drag.t = performance.now();
      } else {
        const r = stage.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hitP)) { group.worldToLocal(tmpV.copy(hitP)); pendingPull = [tmpV.x, tmpV.y, tmpV.z]; }
      }
      kick(); return;
    }
    if (e.pointerType !== 'mouse' || !latest) return;
    const i = residueAt(e);
    if (i !== hoverRes) { hoverRes = i; stage.classList.toggle('is-over', i >= 0); }
    if (i >= 0) {
      const r = stage.getBoundingClientRect();
      tip.textContent = `${resName(i)}, AlphaFold confidence ${Math.round(D.plddt[i])}`;
      tip.hidden = false; tip.style.transform = `translate(${Math.round(e.clientX - r.left + 14)}px, ${Math.round(e.clientY - r.top + 12)}px)`;
    } else tip.hidden = true;
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.kind === 'pull') { send({ type: 'pull', i: -1 }); stage.classList.remove('is-pulling'); grabDot.visible = band.visible = false; pendingPull = null; }
    else if (performance.now() - drag.t > 90) vyaw = vpitch = 0;
    drag = null; lastUser = performance.now();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', () => { pointerIn = false; hoverRes = -1; tip.hidden = true; stage.classList.remove('is-over'); });
  const qa = new T3.Quaternion(), X = new T3.Vector3(1, 0, 0), Y = new T3.Vector3(0, 1, 0);
  function turn(yaw, pitch) {
    group.quaternion.premultiply(qa.setFromAxisAngle(Y, yaw));
    if (pitch) group.quaternion.premultiply(qa.setFromAxisAngle(X, pitch));
  }
  stage.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return; e.preventDefault(); lastUser = performance.now();
    if (reduce.matches) turn(k[0] * 0.3, k[1] * 0.3); else { vyaw = k[0] * 0.0016; vpitch = k[1] * 0.0016; }
    kick();
  });

  // ------------------------------------------------------------------ heat and reset
  // At rest the protein is shown still, exactly as AlphaFold predicted it, and the physics sleeps. It wakes when
  // someone heats or grabs the protein, and sleeps again once the protein has folded back.
  let heat = false, simOn = false, settleAt = 0;
  // A protein that has settled into a misfold (after a hard pull, say) rests too, shown as it is, once nothing has
  // changed for half a minute; heating or grabbing it wakes the physics again.
  let paused = false, stillQ = 1, stillKey = '', stillSince = 0;
  function wakeSim() { paused = false; stillSince = performance.now(); if (!simOn) { simOn = true; settleAt = 0; lastTick = 0; kick(); } }
  function showHeat(on) { heat = on; heatBtn.setAttribute('aria-checked', String(on)); heatState.textContent = on ? 'On' : 'Off'; }
  function setHeat(on) {
    showHeat(on); paused = false; stillSince = performance.now();
    send({ type: 'T', T: on ? T_HOT : T_COLD });
    lastUser = performance.now();
    if (on) wakeSim();
    kick();
  }
  heatBtn.addEventListener('click', () => setHeat(!heat));
  resetBtn.addEventListener('click', () => { setHeat(false); send({ type: 'reset' }); simOn = false; settleAt = 0; kick(); });

  // ------------------------------------------------------------------ switching protein
  function select(i) {
    if (i === cur) return;
    cur = i; D = LIST[i];
    [...menu.children].forEach((b, k) => { b.setAttribute('aria-checked', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    if (drag) { stage.classList.remove('is-pulling'); grabDot.visible = band.visible = false; drag = null; }
    pendingPull = null; hoverRes = -1; tip.hidden = true; stage.classList.remove('is-over');
    showHeat(false); simOn = false; settleAt = 0; paused = false; vyaw = vpitch = 0;
    setup(); boot(); words();
    lastUser = performance.now(); kick();
  }

  // ------------------------------------------------------------------ the state, small, over the picture
  let said = '', saidSr = '', qShow = 1;
  const srEl = document.getElementById('pr-said');
  const BAND = ['#ff7d45', '#ffdb13', '#65cbf3', '#0053d6'];
  function describe(Qnow, e, dt) {
    qShow += (Qnow - qShow) * (1 - Math.exp(-dt / 350));
    const Q = qShow, pct = Math.round(Q * 100);   // the words follow a steadied value, so the number and the state agree
    const tail = (x) => (x.side === 'N' ? 'N-terminal strand' : 'C-terminal tail');
    const threadedOK = REST_ENT ? !!(e && e.native) : !(e && !e.native);
    let t, d, sr;
    if (!simOn) { t = 'Folded'; d = 'As AlphaFold predicted it'; sr = `${D.name}, folded as AlphaFold predicted it.`; }
    else if (drag && drag.kind === 'pull') { t = `Pulling ${resName(drag.i)}`; d = `${pct}% of native contacts`; sr = 'Pulling on the chain.'; }
    else if (heat && Q > 0.3) { t = 'Heating'; d = `${pct}% of native contacts left`; sr = 'Heating: it is unfolding.'; }
    else if (heat) { t = 'Melted'; d = e ? `Its ${tail(e)} is still caught in a loop` : `${pct}% of native contacts left`; sr = 'Melted.'; }
    else if (Q < 0.8) { t = 'Folding back'; d = `${pct}% of native contacts`; sr = 'Folding back.'; }
    else if (threadedOK) { t = 'Folded again'; d = REST_ENT ? 'Its loop is threaded again' : `${pct}% of native contacts`; sr = 'Folded again.'; }
    else if (e) { t = 'Misfolded'; d = `Its ${tail(e)} threads the wrong loop. Heat it to free it.`; sr = 'Misfolded: a strand threads the wrong loop. Heat it to free it.'; }
    else { t = 'Folded'; d = 'Its loop is not threaded yet'; sr = 'Folded, but not threaded yet.'; }
    const s = t + '|' + d;
    if (s !== said) {
      said = s; stateT.textContent = t; stateD.textContent = d;
      stateEl.style.setProperty('--dot', BAND[Q >= 6 / 7 ? 3 : Q >= 4 / 7 ? 2 : Q >= 2 / 7 ? 1 : 0]);
    }
    if (sr !== saidSr) { saidSr = sr; if (srEl) srEl.textContent = sr; }
  }

  // ------------------------------------------------------------------ the loop
  // What is drawn follows the physics through a smoothing filter, so the jitter of single steps never shows:
  // the protein loosens and folds as one slow movement.
  let raf = 0, running = false, last = 0, shadeTick = 0, rendered = 0;
  const tmpA = new T3.Vector3();
  function placeTerm(el, i, j) {
    const P = disp;
    tmpA.set(P[3 * i] + (P[3 * i] - P[3 * j]) * 0.9, P[3 * i + 1] + (P[3 * i + 1] - P[3 * j + 1]) * 0.9, P[3 * i + 2] + (P[3 * i + 2] - P[3 * j + 2]) * 0.9);
    group.localToWorld(tmpA); tmpA.project(camera);
    const sx = Math.max(12, Math.min(W - 12, (tmpA.x + 1) / 2 * W)), sy = Math.max(12, Math.min(H - 12, (1 - tmpA.y) / 2 * H));
    el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
    el.hidden = false;
  }
  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(48, now - (last || now)); last = now;
    if (simOn && !paused) advance();
    if (simOn && latest && fresh) {
      fresh = false;
      if (pendingPull && drag && drag.kind === 'pull') { send({ type: 'pull', i: drag.i, p: pendingPull }); pendingPull = null; }
      // back to sleep once it has stayed folded for a moment, threaded as in the native structure
      const e = latest.ent, threadedOK = REST_ENT ? !!(e && e.native) : !(e && !e.native);
      const calm = !heat && !(drag && drag.kind === 'pull') && latest.Q > 0.86 && threadedOK;
      if (!calm) settleAt = 0;
      else if (!settleAt) settleAt = now;
      else if (now - settleAt > 1500) { simOn = false; settleAt = 0; send({ type: 'reset' }); }
      // only a dead end rests: folded, but threaded wrong (or not threaded at all where the native fold is), and unchanged
      // for half a minute. A protein still folding back, however slowly, keeps going.
      const k2 = e ? e.i + ',' + e.j + e.side : '-', deadEnd = latest.Q > 0.8 && !threadedOK;
      if (heat || (drag && drag.kind === 'pull') || !deadEnd || k2 !== stillKey || Math.abs(latest.Q - stillQ) > 0.06) { stillKey = k2; stillQ = latest.Q; stillSince = now; }
      else if (now - stillSince > 30000) paused = true;
    }
    const tgt = simOn && latest ? latest.pos : NATIVE, tq = simOn && latest ? latest.q : ONES;
    const k = reduce.matches ? 1 : 1 - Math.exp(-dt / (drag && drag.kind === 'pull' ? 90 : simOn ? 220 : 380));
    let moved = 0;
    for (let i = 0; i < 3 * N; i++) { const d = tgt[i] - disp[i]; disp[i] += d * k; if (Math.abs(d) > moved) moved = Math.abs(d); }
    for (let i = 0; i < N; i++) { const d = tq[i] - dq[i]; dq[i] += d * k; if (Math.abs(d) * 20 > moved) moved = Math.abs(d) * 20; }
    const ent = simOn && latest ? latest.ent : REST_ENT;
    if (moved > 0.004 || needBuild || snapDist || Math.abs((ent ? 1 : 0) - entA) > 0.004) {
      needBuild = false;
      if (++shadeTick % 6 === 1) updateShade(disp, 0.3);
      buildCartoon(disp, dq);
      updateFilm(ent, dt);
      // frame on most of the chain, so one loose end does not pull the camera back
      const rs = []; for (let i = 0; i < N; i++) rs.push(Math.hypot(disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]));
      rs.sort((a, b) => a - b);
      const want = frameDistance(rs[Math.floor(0.96 * (N - 1))] * 1.06);
      dist += (want - dist) * (reduce.matches || snapDist ? 1 : 1 - Math.exp(-dt / 600));
      snapDist = false;
    }
    describe(simOn && latest ? latest.Q : 1, ent, dt);
    if (drag && drag.kind === 'pull') {
      grabDot.visible = band.visible = true;
      const i = drag.i; grabDot.position.set(disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]);
      const bp = band.geometry.attributes.position; bp.setXYZ(0, disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]);
      group.worldToLocal(tmpV.copy(hitP)); bp.setXYZ(1, tmpV.x, tmpV.y, tmpV.z); bp.needsUpdate = true;
    }
    // turning: the visitor's drag, its glide, and a slow drift when nobody is here
    if (!drag && !held) {
      if (Math.abs(vyaw) + Math.abs(vpitch) > 1e-6) { turn(vyaw * dt, vpitch * dt); const kk = Math.exp(-dt / 320); vyaw *= kk; vpitch *= kk; }
      else if (!reduce.matches && !pointerIn) turn(0.00011 * dt, 0);
    }
    camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
    scene.fog.near = dist - nativeR * 0.4; scene.fog.far = dist + nativeR * 2.6;
    placeTerm(termN, 0, 2); placeTerm(termC, N - 1, N - 3);
    renderer.render(scene, camera);
    rendered++;
    if (running) raf = requestAnimationFrame(frame);
  }
  function kick() { if (running && !raf) raf = requestAnimationFrame(frame); }
  function setRunning(on) { if (on === running) return; running = on; last = 0; lastTick = 0; if (on) { resize(); kick(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  setup();
  boot();
  words();
  applyTheme();
  resize();
  new ResizeObserver(resize).observe(stage);
  let seen = false;
  new IntersectionObserver((es) => { seen = es[0].isIntersecting; setRunning(seen && !document.hidden); }, { threshold: 0.02 }).observe(stage);
  document.addEventListener('visibilitychange', () => setRunning(seen && !document.hidden));

  // for the page's tests, and for rendering stills of a protein
  window.__protein = {
    ready: () => !!latest && rendered > 2,
    state: () => ({ key: D.key, Q: simOn && latest ? latest.Q : 1, T: latest ? latest.T : T_COLD, ent: simOn && latest ? latest.ent : REST_ENT, heat, sim: simOn, paused, steps, worker: !!worker, frames, running, pulling: latest ? latest.pulling : -1,
      status: stateT.textContent + ': ' + stateD.textContent, caption: capEl.textContent, N }),
    select: (i) => select(i),
    pick: (x, y) => { const r = stage.getBoundingClientRect(); return residueAt({ clientX: r.left + x, clientY: r.top + y }); },
    screen: (i) => { resWorld(i, tmpA); tmpA.project(camera); return { x: (tmpA.x + 1) / 2 * W, y: (1 - tmpA.y) / 2 * H }; },
    pose: (q, f) => { held = true; if (q) group.quaternion.set(q[0], q[1], q[2], q[3]); if (f) FILL = f; snapDist = true; kick(); },
  };
})();
