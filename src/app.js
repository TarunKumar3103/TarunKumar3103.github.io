/* Page script for the single-column site: the 3D robot cell on the page, the theme (light, dark or the system's),
   the drawings on the cards and page switching. */
(function () {
  'use strict';
  const C = {
    bg: '#0b1016', scene: '#0d1218', ink: '#e8edf3', muted: '#8f9bab', line: '#263140',
    robot: '#f2b632', signal: '#6aa8ff', ok: '#5fc58f', warn: '#f0a33a', hot: '#ef6352',
  };
  const FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';
  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const reduceMotion = mq('(prefers-reduced-motion: reduce)');
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // =================================================================== robot cell
  // The arm is a Franka Emika Panda: meshes, link frames, masses and inertias from MuJoCo Menagerie (Apache-2.0).
  const fromBase64 = (s) => {
    const raw = atob(s.replace(/\s+/g, '')), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  };
  async function loadArmMeshes(T, url) {
    let buf;
    const inline = document.getElementById('arm-data');
    if (inline && inline.textContent.length > 1000) {
      await new Promise((r) => setTimeout(r, 0)); // let the first frame paint before decoding
      buf = fromBase64(inline.textContent);
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      buf = /\.json$/.test(url) ? fromBase64((await res.json()).data) : await res.arrayBuffer();
    }
    const n = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    const base = 4 + n, parts = [];
    for (const p of header.parts) {
      const q = new Int16Array(buf, base + p.pos, p.verts * 3), nq = new Int8Array(buf, base + p.nrm, p.verts * 3);
      const idx = p.idx32 ? new Uint32Array(buf, base + p.idx, p.tris * 3) : new Uint16Array(buf, base + p.idx, p.tris * 3);
      const pos = new Float32Array(p.verts * 3), nrm = new Float32Array(p.verts * 3);
      for (let i = 0; i < p.verts; i++) {
        let nx = nq[i * 3], ny = nq[i * 3 + 1], nz = nq[i * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = p.min[k] + ((q[i * 3 + k] + 32768) / 65535) * (p.max[k] - p.min[k]);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.BufferAttribute(nrm, 3));
      g.setIndex(new T.BufferAttribute(p.idx32 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      g.computeBoundingSphere();
      parts.push({ link: p.link, mat: p.mat, geometry: g });
    }
    return { parts, materials: header.materials };
  }

  function startCell() {
    const stage = document.getElementById('stage');
    let canvas = document.getElementById('cell-canvas');
    if (!stage || !canvas) return null;
    // without 3D graphics the stage shows a still of the cell and says why
    const fail = (msg) => {
      stage.classList.add('cell-off'); stage.classList.remove('cell-wait');
      if (stage.parentElement) stage.parentElement.classList.add('is-off');
      const old = stage.querySelector('.cell-still-note'); if (old) old.remove();
      const note = document.createElement('p'); note.className = 'cell-still-note'; note.textContent = msg;
      stage.appendChild(note);
      return null;
    };
    if (!window.THREE || !window.CANNON || !window.RobotCell3D || !window.PANDA_KIN) return fail('The 3D engine did not load, so this is a still of the robot cell. Reload the page to try again.');
    const T = window.THREE;
    // try the nicest settings first, then plainer ones; a canvas that refused once gets swapped for a fresh one
    let renderer = null, glError = '';
    for (const opts of [{ antialias: true, powerPreference: 'high-performance' }, { antialias: false }, { antialias: false, powerPreference: 'low-power' }]) {
      const onErr = (e) => { glError = e.statusMessage || glError; };
      canvas.addEventListener('webglcontextcreationerror', onErr);
      try { renderer = new T.WebGLRenderer(Object.assign({ canvas, alpha: true }, opts)); } catch (e) { renderer = null; }
      canvas.removeEventListener('webglcontextcreationerror', onErr);
      if (renderer) break;
      const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); canvas = fresh;
    }
    if (!renderer) {
      if (window.console) console.warn('[robot cell] WebGL is unavailable:', glError || 'no reason given');
      return fail('This browser has 3D graphics (WebGL) turned off, so you are seeing a still of the robot cell. In Chrome, turn on "Use graphics acceleration when available" in Settings under System, then relaunch.');
    }
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.setClearColor(0x000000, 0); // see-through: the page's own background is the backdrop
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const lin = (hex) => new T.Color(hex).convertSRGBToLinear();

    const cell = window.RobotCell3D.create(window.CANNON, { kin: window.PANDA_KIN });
    const G = cell.GEOM, D2R = Math.PI / 180, FLOOR = -G.tableH;

    const scene = new T.Scene();
    // three r128 mixes fog in after tone mapping, so the fog takes the page's display colour and the far floor melts into the page
    const SCENE_THEME = {
      light: { bg: '#ffffff', grid: '#cfcfd6', gridOpacity: 0.85, shadow: 0.14 },
      dark: { bg: '#0b0b0d', grid: '#34343c', gridOpacity: 0.9, shadow: 0.5 },
    };
    const themeNow = () => SCENE_THEME[document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'];
    scene.fog = new T.Fog(new T.Color(themeNow().bg), 3, 7);
    // soft studio reflections for the arm's painted shells
    if (T.RoomEnvironment) {
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    // ---------- camera ----------
    // straight on: the camera sits on the arm's centre line, facing it across the bench
    const camera = new T.PerspectiveCamera(26, 1, 0.02, 30);
    const view = { az: Math.PI / 2, el: 0.29, dist: 2.85, fit: 1, target: new T.Vector3(0, 0.14, 0.19) };
    // below this aspect the camera backs off; the bench's outer corners may crop, never the boxes
    const FIT_ASPECT = 1.1, FIT_POW = 1;
    function placeCamera() {
      const d = view.dist * view.fit, ce = Math.cos(view.el);
      scene.fog.near = d * 1.15; scene.fog.far = d * 3.2;
      camera.position.set(view.target.x + d * ce * Math.cos(view.az), view.target.y + d * Math.sin(view.el), view.target.z + d * ce * Math.sin(view.az));
      camera.lookAt(view.target);
    }

    // ---------- lights ----------
    scene.add(new T.HemisphereLight(0xdfe7f2, 0x2a231b, 0.25));
    const key = new T.DirectionalLight(0xfff3e4, 1.6);
    key.position.set(-1.4, 3.2, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    // wide enough that the bench's shadow on the floor is never cut off
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 1.5, bottom: -1.5, near: 0.5, far: 9 });
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.006;
    key.shadow.radius = 3;
    scene.add(key);
    const rim = new T.DirectionalLight(0x9cb6ff, 0.6);
    rim.position.set(1.6, 1.4, -2.2);
    scene.add(rim);

    // ---------- floor, table and cell markings ----------
    function canvasTex(cv, repeat) {
      const t = new T.CanvasTexture(cv);
      t.encoding = T.sRGBEncoding; t.anisotropy = aniso;
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); }
      return t;
    }
    // the floor is the page itself: a fine grid that fades out towards its edges, and a shadow catcher under the bench
    function gridCanvas() {
      const N = 2048, cells = 24, cv = document.createElement('canvas'); cv.width = cv.height = N;
      const g = cv.getContext('2d');
      g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k <= cells; k++) { const p = Math.round((k * N) / cells); g.moveTo(p, 0); g.lineTo(p, N); g.moveTo(0, p); g.lineTo(N, p); }
      g.stroke();
      g.globalCompositeOperation = 'destination-in';
      const fade = g.createRadialGradient(N / 2, N / 2, N * 0.1, N / 2, N / 2, N * 0.5);
      fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fade; g.fillRect(0, 0, N, N);
      return cv;
    }
    const gridTex = new T.CanvasTexture(gridCanvas()); gridTex.anisotropy = aniso;
    const gridMat = new T.MeshBasicMaterial({ map: gridTex, transparent: true, depthWrite: false, toneMapped: false });
    const grid = new T.Mesh(new T.PlaneGeometry(6, 6), gridMat);
    grid.rotation.x = -Math.PI / 2; grid.position.set(0, FLOOR + 0.001, 0.35); grid.renderOrder = -1; scene.add(grid);
    const shadowMat = new T.ShadowMaterial({ opacity: 0.14 });
    const shadowFloor = new T.Mesh(new T.PlaneGeometry(8, 8), shadowMat);
    shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.position.set(0, FLOOR, 0.35); shadowFloor.receiveShadow = true; scene.add(shadowFloor);
    // follow the page's theme: fog, grid lines and how dark the shadows read
    function applySceneTheme() {
      const th = themeNow();
      scene.fog.color.set(th.bg);
      gridMat.color.copy(lin(th.grid)); gridMat.opacity = th.gridOpacity;
      shadowMat.opacity = th.shadow;
    }
    applySceneTheme();

    // work bench: dark phenolic top on an aluminium frame, the arm bolted near the back edge
    const TB = G.table, TW = TB.x1 - TB.x0, TD = TB.z1 - TB.z0, TCX = (TB.x0 + TB.x1) / 2, TCZ = (TB.z0 + TB.z1) / 2, TOP = 0.03;
    const alu = new T.MeshStandardMaterial({ color: lin('#aab2bb'), roughness: 0.34, metalness: 0.85 });
    const tableTop = new T.Mesh(new T.BoxGeometry(TW, TOP, TD), new T.MeshStandardMaterial({ color: lin('#191e25'), roughness: 0.66, metalness: 0.05, envMapIntensity: 0.22 }));
    tableTop.position.set(TCX, -TOP / 2, TCZ); tableTop.receiveShadow = true; tableTop.castShadow = true; scene.add(tableTop);
    const benchFrame = new T.Mesh(new T.BoxGeometry(TW + 0.012, 0.05, TD + 0.012), alu);
    benchFrame.position.set(TCX, -TOP - 0.025, TCZ); benchFrame.castShadow = true; benchFrame.receiveShadow = true; scene.add(benchFrame);
    const legH = -FLOOR - TOP - 0.05;
    for (const lx of [TB.x0 + 0.045, TB.x1 - 0.045]) for (const lz of [TB.z0 + 0.045, TB.z1 - 0.045]) {
      const leg = new T.Mesh(new T.BoxGeometry(0.045, legH, 0.045), alu);
      leg.position.set(lx, FLOOR + legH / 2, lz); leg.castShadow = true; scene.add(leg);
    }
    for (const [w, d, x, z] of [[TW - 0.09, 0.03, TCX, TB.z0 + 0.045], [TW - 0.09, 0.03, TCX, TB.z1 - 0.045], [0.03, TD - 0.09, TB.x0 + 0.045, TCZ], [0.03, TD - 0.09, TB.x1 - 0.045, TCZ]]) {
      const rail = new T.Mesh(new T.BoxGeometry(w, 0.03, d), alu);
      rail.position.set(x, FLOOR + 0.13, z); rail.castShadow = true; scene.add(rail);
    }

    function decalCanvas() {
      const Nw = 2048, Nh = Math.round(2048 * TD / TW), M = Nw / TW, cv = document.createElement('canvas'); cv.width = Nw; cv.height = Nh;
      const g = cv.getContext('2d');
      const Pt = (x, z) => [(x - TB.x0) * M, (z - TB.z0) * M];
      const [ox, oz] = Pt(0, 0); // the arm's base
      const stripes = (x0, y0, w, h, sw) => { for (let x = x0 - h; x < x0 + w + h; x += sw * 2) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + sw, y0); g.lineTo(x + sw + h, y0 + h); g.lineTo(x + h, y0 + h); g.fill(); } };
      // hazard tape round the edge of the bench
      const i1 = 0.018 * M, i2 = 0.04 * M;
      g.save(); g.beginPath(); g.rect(i1, i1, Nw - 2 * i1, Nh - 2 * i1); g.rect(i2, i2, Nw - 2 * i2, Nh - 2 * i2); g.clip('evenodd');
      g.fillStyle = 'rgba(16,18,22,0.95)'; g.fillRect(0, 0, Nw, Nh);
      g.fillStyle = 'rgba(242,182,50,0.8)'; stripes(0, 0, Nw, Nh, 0.018 * M);
      g.restore();
      // mounting plate under the arm
      const mp = 0.13 * M;
      g.fillStyle = 'rgba(70,80,94,0.35)'; g.fillRect(ox - mp, oz - mp, 2 * mp, 2 * mp);
      g.fillStyle = 'rgba(150,160,172,0.6)';
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.arc(ox + sx * mp * 0.82, oz + sy * mp * 0.82, 0.007 * M, 0, 7); g.fill(); }
      // the wedge the tool can reach: shaded, outlined in dashes
      const a0 = G.heading * D2R - (G.span / 2) * D2R, a1 = G.heading * D2R + (G.span / 2) * D2R;
      g.beginPath(); g.arc(ox, oz, G.rMax * M, a0, a1); g.arc(ox, oz, G.rMin * M, a1, a0, true); g.closePath();
      g.fillStyle = 'rgba(106,168,255,0.06)'; g.fill();
      g.setLineDash([0.016 * M, 0.02 * M]); g.lineWidth = 0.0035 * M; g.strokeStyle = 'rgba(106,168,255,0.42)'; g.stroke();
      g.setLineDash([]);
      // home slots: painted corner marks
      for (const az of G.slotAz) {
        const a = az * D2R, [cx, cy] = Pt(G.ring * Math.cos(a), G.ring * Math.sin(a));
        g.save(); g.translate(cx, cy); g.rotate(a);
        const h = 0.048 * M, l = 0.018 * M;
        g.strokeStyle = 'rgba(165,177,193,0.55)'; g.lineWidth = 0.004 * M; g.lineCap = 'square';
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.moveTo(sx * h - sx * l, sy * h); g.lineTo(sx * h, sy * h); g.lineTo(sx * h, sy * h - sy * l); g.stroke(); }
        g.restore();
      }
      // the stacking pad
      const a = G.padAz * D2R, [cx, cy] = Pt(G.ring * Math.cos(a), G.ring * Math.sin(a));
      g.save(); g.translate(cx, cy); g.rotate(a);
      const fo = 0.065 * M, fi = 0.046 * M;
      g.save(); g.beginPath(); g.rect(-fo, -fo, 2 * fo, 2 * fo); g.rect(-fi, -fi, 2 * fi, 2 * fi); g.clip('evenodd');
      g.fillStyle = '#121418'; g.fillRect(-fo, -fo, 2 * fo, 2 * fo);
      g.fillStyle = 'rgba(242,182,50,0.92)'; stripes(-fo, -fo, 2 * fo, 2 * fo, 0.011 * M);
      g.restore();
      g.strokeStyle = 'rgba(242,182,50,0.55)'; g.lineWidth = 0.0025 * M;
      g.beginPath(); g.moveTo(-0.014 * M, 0); g.lineTo(0.014 * M, 0); g.moveTo(0, -0.014 * M); g.lineTo(0, 0.014 * M); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(165,177,193,0.8)'; g.font = `600 ${0.019 * M}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('Stack pad', cx, cy + 0.08 * M);
      return cv;
    }
    let decalTex = canvasTex(decalCanvas());
    const decal = new T.Mesh(new T.PlaneGeometry(TW, TD), new T.MeshStandardMaterial({ map: decalTex, transparent: true, roughness: 0.7, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 0.3 }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(TCX, 0.0004, TCZ); decal.receiveShadow = true; scene.add(decal);

    // ---------- the arm ----------
    const links = cell.arm.bodies.map((b) => {
      const grp = new T.Group(); grp.matrixAutoUpdate = false; grp.name = b.name; scene.add(grp); return grp;
    });
    const armMats = {
      white: new T.MeshPhysicalMaterial({ color: lin('#f3f3f1'), roughness: 0.36, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 0.85 }),
      off_white: new T.MeshPhysicalMaterial({ color: lin('#dfe3e6'), roughness: 0.42, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.8 }),
      black: new T.MeshStandardMaterial({ color: lin('#2b2e33'), roughness: 0.5, metalness: 0.15, envMapIntensity: 0.7 }),
      green: new T.MeshStandardMaterial({ color: lin('#2f7d4a'), emissive: lin('#3ddc84'), emissiveIntensity: 0.9, roughness: 0.4 }),
      light_blue: new T.MeshStandardMaterial({ color: lin('#0a8ac7'), emissive: lin('#2aa8ff'), emissiveIntensity: 0.6, roughness: 0.35 }),
    };
    let armReady = false;
    const armNote = document.createElement('p'); armNote.className = 'cell-msg cell-loading'; armNote.textContent = 'Loading the robot…';
    stage.appendChild(armNote);
    const modelUrl = (document.querySelector('meta[name="arm-model"]') || {}).content || 'models/panda.json';
    loadArmMeshes(T, modelUrl).then(({ parts }) => {
      for (const p of parts) {
        const mat = armMats[p.mat] || armMats.white;
        const targets = p.link === 'finger' ? links.filter((g) => /finger/.test(g.name)) : links.filter((g) => g.name === p.link);
        for (const grp of targets) { const m = new T.Mesh(p.geometry, mat); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      }
      armReady = true; armNote.remove(); wake();
      requestAnimationFrame(() => stage.classList.remove('cell-wait'));   // the live arm takes over from the still
    }).catch((err) => { armNote.textContent = `The arm model did not load (${(err && err.message) || 'unknown error'}). Reload the page to try again.`; });

    // ---------- boxes ----------
    const labelCanvases = [];
    function cardCanvas(b, i, top) {
      const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
      const g = cv.getContext('2d'), r = rng(17 + i * 7 + (top ? 3 : 0));
      g.fillStyle = '#a77848'; g.fillRect(0, 0, N, N);
      for (let k = 0; k < 1400; k++) { g.fillStyle = r() < 0.55 ? 'rgba(70,44,18,0.09)' : 'rgba(255,232,196,0.07)'; g.fillRect(r() * N, r() * N, 1 + r() * 3, 1 + r() * 1.5); }
      g.fillStyle = 'rgba(70,44,18,0.05)'; for (let y = 0; y < N; y += 6) g.fillRect(0, y, N, 2);
      g.strokeStyle = 'rgba(60,36,14,0.45)'; g.lineWidth = 8; g.strokeRect(0, 0, N, N);
      if (top) {
        g.fillStyle = 'rgba(58,36,14,0.55)'; g.fillRect(N / 2 - 1.5, 0, 3, N);
        g.fillStyle = 'rgba(214,184,134,0.94)'; g.fillRect(N * 0.39, 0, N * 0.22, N);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(N * 0.39, 0, N * 0.04, N);
      } else drawLabel(g, N, b, i);
      return cv;
    }
    function drawLabel(g, N, b, i) {
      const lw = N * 0.66, lh = N * 0.34, lx = (N - lw) / 2, ly = N * 0.5;
      g.fillStyle = '#efe7d8'; g.fillRect(lx, ly, lw, lh);
      g.fillStyle = '#2b2116'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.font = `800 ${N * 0.13}px ${FONT}`; g.fillText(`B${i + 1}`, lx + N * 0.05, ly + lh * 0.47);
      g.font = `600 ${N * 0.085}px ${FONT}`; g.fillText(`${Math.round(b.mass * 1000)} g`, lx + N * 0.05, ly + lh * 0.84);
      const r = rng(91 + i);
      for (let x = lx + lw * 0.64; x < lx + lw - N * 0.04; x += 3 + Math.floor(r() * 3)) g.fillRect(x, ly + lh * 0.18, 1 + Math.floor(r() * 2.5), lh * 0.62);
      g.strokeStyle = 'rgba(40,28,14,0.75)'; g.lineWidth = 5; g.lineCap = 'round';
      for (const dx of [0, 24]) {
        const x = N * 0.16 + dx, y0 = N * 0.36, y1 = N * 0.15;
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.moveTo(x - 9, y1 + 10); g.lineTo(x, y1); g.lineTo(x + 9, y1 + 10); g.stroke();
      }
    }
    const boxMeshes = cell.boxes.map((b, i) => {
      const side = canvasTex(cardCanvas(b, i, false)), top = canvasTex(cardCanvas(b, i, true));
      labelCanvases.push({ b, i, tex: side });
      const sm = new T.MeshStandardMaterial({ map: side, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 });
      const tm = new T.MeshStandardMaterial({ map: top, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 });
      const m = new T.Mesh(new T.BoxGeometry(b.size, b.size, b.size), [sm, sm, tm, tm, sm, sm]);
      m.castShadow = true; m.receiveShadow = true; m.userData.box = b; scene.add(m);
      return m;
    });

    // ---------- overlays: plan, target, trail, pointer ----------
    const flat = (hex, op) => new T.MeshBasicMaterial({ color: lin(hex), transparent: true, opacity: op, side: T.DoubleSide, depthWrite: false, toneMapped: false });
    const pathLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: lin(C.signal), dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    pathLine.frustumCulled = false; pathLine.visible = false; scene.add(pathLine);
    let pathRef = null;
    function syncPath() {
      const p = cell.state.path;
      if (p === pathRef) return;
      pathRef = p;
      if (!p || p.length < 2) { pathLine.visible = false; return; }
      pathLine.geometry.dispose();
      pathLine.geometry = new T.BufferGeometry().setFromPoints(p.map((q) => new T.Vector3(q.x, q.y, q.z)));
      pathLine.computeLineDistances(); pathLine.visible = true;
    }
    const goal = new T.Group(); scene.add(goal);
    const goalRing = new T.Mesh(new T.RingGeometry(0.011, 0.014, 40), flat(C.signal, 0.95)); goalRing.rotation.x = -Math.PI / 2; goal.add(goalRing);
    const footRing = new T.Mesh(new T.RingGeometry(0.017, 0.02, 48), flat(C.signal, 0.6)); footRing.rotation.x = -Math.PI / 2; scene.add(footRing);
    const dropMat = new T.LineBasicMaterial({ color: lin(C.signal), transparent: true, opacity: 0.35, toneMapped: false });
    const drop = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, 1, 0)]), dropMat); drop.frustumCulled = false; scene.add(drop);
    function syncGoal() {
      const g = cell.state.goal, w = cell.toWorld({ r: g.r, y: g.y }, g.th), c = lin(cell.state.reachable ? C.signal : C.warn);
      goal.position.set(w.x, w.y, w.z); footRing.position.set(w.x, 0.0015, w.z);
      drop.position.set(w.x, 0.0015, w.z); drop.scale.set(1, Math.max(0.005, w.y - 0.0015), 1);
      goalRing.material.color.copy(c); footRing.material.color.copy(c); dropMat.color.copy(c);
    }
    // the gripper's recent path, fading out by transparency so it reads over the bench and the floor alike
    const TRAIL = 110, trailPos = new Float32Array(TRAIL * 3), trailCol = new Float32Array(TRAIL * 4);
    const trailGeo = new T.BufferGeometry();
    trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('color', new T.BufferAttribute(trailCol, 4));
    const trail = new T.Line(trailGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    trail.frustumCulled = false; scene.add(trail);
    let trailN = 0;
    const cB = lin(C.robot);
    function syncTrail(reset) {
      if (reset) trailN = 0;
      const t = cell.armF().tcp;
      if (trailN === TRAIL) trailPos.copyWithin(0, 3); else trailN++;
      trailPos.set([t[0], t[1], t[2]], (trailN - 1) * 3);
      for (let i = 0; i < trailN; i++) trailCol.set([cB.r, cB.g, cB.b, Math.pow(i / Math.max(1, trailN - 1), 1.6) * 0.85], i * 4);
      trailGeo.setDrawRange(0, trailN);
      trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
    }
    const reticle = new T.Group(); reticle.visible = false; scene.add(reticle);
    const retMat = flat(C.ink, 0.8), inkC = lin(C.ink);
    const retRing = new T.Mesh(new T.RingGeometry(0.02, 0.024, 48), retMat); retRing.rotation.x = -Math.PI / 2; reticle.add(retRing);
    const tickPts = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tickPts.push(new T.Vector3(dx * 0.028, 0, dz * 0.028), new T.Vector3(dx * 0.042, 0, dz * 0.042));
    const retTicks = new T.LineBasicMaterial({ color: lin(C.ink), transparent: true, opacity: 0.8, toneMapped: false });
    reticle.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(tickPts), retTicks));
    const hoverBox = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: lin(C.signal), transparent: true, opacity: 1, depthTest: false, toneMapped: false }));
    hoverBox.visible = false; hoverBox.renderOrder = 5; scene.add(hoverBox);
    // the box that kept the gripper from a pick, outlined in amber while the message about it shows
    const blockBox = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: lin(C.warn), transparent: true, opacity: 1, depthTest: false, toneMapped: false }));
    blockBox.visible = false; blockBox.renderOrder = 6; scene.add(blockBox);

    // ---------- per-frame sync ----------
    const warnC = lin(C.warn);
    let hover = null;
    function sync() {
      const F = cell.armF();
      for (let i = 0; i < links.length; i++) {
        const R = F.R[i], p = F.P[i];
        links[i].matrix.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
        links[i].matrixWorldNeedsUpdate = true;
      }
      for (const m of boxMeshes) {
        const b = m.userData.box.body;
        m.position.set(b.position.x, b.position.y, b.position.z);
        m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      }
      syncPath(); syncGoal(); syncTrail(false);
      if (hover && hover.floor && !hover.box) {
        reticle.visible = true; reticle.position.set(hover.floor.x, 0.002, hover.floor.z);
        const rr = Math.hypot(hover.floor.x, hover.floor.z), inside = cell.inSector(Math.atan2(hover.floor.z, hover.floor.x)) && rr > G.rMin && rr < G.rMax;
        retMat.color.copy(inside ? inkC : warnC); retTicks.color.copy(inside ? inkC : warnC);
      }
      else reticle.visible = false;
      if (hover && hover.box) {
        const m = boxMeshes.find((bm) => bm.userData.box === hover.box);
        hoverBox.visible = true; hoverBox.position.copy(m.position); hoverBox.quaternion.copy(m.quaternion); hoverBox.scale.setScalar(hover.box.size * 1.08);
      } else hoverBox.visible = false;
      const st = cell.state, blocker = st.blocker && st.time - st.noticeT < 2.5 ? boxMeshes.find((bm) => bm.userData.box === st.blocker) : null;
      blockBox.visible = !!blocker;
      if (blocker) { blockBox.position.copy(blocker.position); blockBox.quaternion.copy(blocker.quaternion); blockBox.scale.setScalar(st.blocker.size * 1.1); }
      if (stillMode) blockBox.visible = false;
      if (stillMode) { pathLine.visible = goal.visible = footRing.visible = drop.visible = trail.visible = reticle.visible = hoverBox.visible = false; }
    }
    let stillMode = false;

    // ---------- input ----------
    const ray = new T.Raycaster(), ndc = new T.Vector2(), floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0), hitP = new T.Vector3();
    function probe(cx, cy) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // the box in the gripper never catches a click, so you can click through it to the table or the box below
      const hits = ray.intersectObjects(boxMeshes, false).filter((h) => h.object.userData.box !== cell.state.held);
      const box = hits.length ? hits[0].object.userData.box : null;
      const onTable = ray.ray.intersectPlane(floorPlane, hitP) && cell.onTable(hitP.x, hitP.z, 0.03);
      return { box, floor: onTable ? { x: hitP.x, z: hitP.z } : null };
    }
    function act(h) {
      const st = cell.state;
      if (h.box) {
        if (st.held) { if (h.box !== st.held) cell.placeAt(0, 0, h.box.id); }
        else cell.pickBox(h.box.id);
      } else if (h.floor) {
        if (st.held) cell.placeAt(h.floor.x, h.floor.z);
        else cell.hover(h.floor.x, h.floor.z);
      }
      kb = null;
      updateControls();
    }
    // a tap or click acts; a press that turns into a scroll does not
    const ptr = { down: false, moved: false, x0: 0, y0: 0, id: -1 };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      Object.assign(ptr, { down: true, moved: false, x0: e.clientX, y0: e.clientY, id: e.pointerId });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (ptr.down && e.pointerId === ptr.id && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > 7) ptr.moved = true;
      if (e.pointerType !== 'mouse') return;
      hover = probe(e.clientX, e.clientY);
      stage.classList.toggle('over-box', !!hover.box);
      if (cell.state.mode === 'manual' && hover.floor && !cell._man.active) cell.hover(hover.floor.x, hover.floor.z);
      wake();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!ptr.down || e.pointerId !== ptr.id) return;
      ptr.down = false;
      if (!ptr.moved) { act(probe(e.clientX, e.clientY)); wake(); }
    });
    canvas.addEventListener('pointercancel', () => { ptr.down = false; });
    canvas.addEventListener('pointerleave', () => { hover = null; stage.classList.remove('over-box'); wake(); });
    let kb = null;
    stage.addEventListener('keydown', (e) => {
      const st = cell.state, k = e.key;
      const arrows = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (!kb || st.mode === 'auto') { const t = cell.armF().tcp; kb = { x: t[0], z: t[2] }; }
      if (arrows[k]) {
        const s = e.shiftKey ? 0.06 : 0.02, [ax, ay] = arrows[k];
        const fx = -Math.cos(view.az), fz = -Math.sin(view.az), rx = Math.sin(view.az), rz = -Math.cos(view.az);
        kb.x += (rx * ax + fx * ay) * s; kb.z += (rz * ax + fz * ay) * s;
        cell.hover(kb.x, kb.z);
      } else if (k === 'Enter') {
        if (st.held) cell.placeAt(kb.x, kb.z);
        else {
          let best = null, bd = 0.08;
          for (const i of cell.infos()) { const d = Math.hypot(i.x - kb.x, i.z - kb.z); if (d < bd) { bd = d; best = i; } }
          if (best) cell.pickBox(best.b.id); else cell.toggleGrip();
        }
      } else if (k === ' ') cell.toggleGrip();
      else return;
      e.preventDefault(); updateControls(); wake();
    });

    // ---------- the Autopilot switch ----------
    // Switching it off holds manual control. Clicking the scene while it is on also takes over,
    // and the switch then turns itself back on after eight idle seconds.
    const toggle = document.getElementById('ap-toggle'), stateText = document.getElementById('ap-state'), note = document.getElementById('ap-note');
    const coarse = mq('(pointer: coarse)');
    const HINT = coarse ? 'Tap a box to pick it up, then tap where it should go.' : 'Click a box to pick it up, then click where it should go.';
    const KEYS = 'Arrow keys move the gripper. Enter picks up or puts down a box. Space opens or closes the gripper.';
    let keyFocus = false, shownMode = '', shownNote = null;
    stage.addEventListener('focus', () => { keyFocus = stage.matches(':focus-visible'); updateControls(); });
    stage.addEventListener('blur', () => { keyFocus = false; updateControls(); });
    function updateControls() {
      const t = cell.telemetry();
      if (toggle && t.mode !== shownMode) {
        shownMode = t.mode;
        const on = t.mode === 'auto';
        toggle.setAttribute('aria-checked', String(on));
        if (stateText) stateText.textContent = on ? 'On' : 'Off';
      }
      if (!note) return;
      const text = t.notice ? t.phase : keyFocus ? KEYS : HINT;
      if (text !== shownNote) {
        shownNote = text;
        note.textContent = text;
        note.classList.toggle('is-notice', !!t.notice);
      }
    }
    if (toggle) toggle.addEventListener('click', () => {
      cell.setAuto(cell.state.mode !== 'auto');
      kb = null; hover = null; updateControls(); wake();
    });

    // ---------- sizing ----------
    // the cell stays centred; on narrow screens the camera steps back so the whole bench still fits across
    function resize() {
      const r = stage.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const w = Math.round(r.width), h = Math.round(r.height);
      renderer.setPixelRatio(Math.max(1, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(4.2e6 / (w * h)))));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      view.fit = camera.aspect < FIT_ASPECT ? Math.pow(FIT_ASPECT / camera.aspect, FIT_POW) : 1;
      camera.updateProjectionMatrix();
      placeCamera();
      draw();
    }

    // ---------- loop ----------
    let running = !reduceMotion, onPage = true, inView = true, raf = 0, last = 0, uiT = 0;
    function draw() { sync(); renderer.render(scene, camera); }
    function frame(now) {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      if (running && armReady) cell.step(dt);
      draw();
      if (now - uiT > 110) { uiT = now; updateControls(); }
      if (running && onPage && inView) raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf && onPage) { last = 0; raf = requestAnimationFrame(frame); } }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { inView = es[0].isIntersecting; if (inView) wake(); }, { threshold: 0.02 }).observe(stage);
    }
    if ('ResizeObserver' in window) new ResizeObserver(() => resize()).observe(stage);
    else window.addEventListener('resize', resize);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); running = false; fail('The graphics card stopped answering, so this is a still of the robot cell. Reload the page to restart it.'); });
    document.addEventListener('themechange', () => { applySceneTheme(); draw(); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        for (const L of labelCanvases) { const g = L.tex.image.getContext('2d'); drawLabel(g, L.tex.image.width, L.b, L.i); L.tex.needsUpdate = true; }
        const old = decalTex; decal.material.map = decalTex = canvasTex(decalCanvas()); decal.material.needsUpdate = true; old.dispose();
        wake();
      });
    }
    resize();
    syncTrail(true);
    updateControls();
    if (reduceMotion) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'play'; b.textContent = 'Run the simulation';
      b.addEventListener('click', () => { running = true; b.remove(); wake(); });
      stage.appendChild(b);
      draw();
    } else wake();
    window.__cell = cell;
    window.__cellScreen = (x, y, z) => {
      const v = new T.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    };
    window.__cellView = view;
    window.__cellRefit = () => resize();
    window.__cellCamFov = (f) => { camera.fov = f; };
    // for making the fallback still: hide the overlays and read back one frame
    // the canvas is see-through, so a still is laid over the page colour it will sit on
    window.__cellSnapshot = (type, quality, bg) => {
      stillMode = true; draw();
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const g = out.getContext('2d'), W = out.width, Hh = out.height;
      g.drawImage(canvas, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      const fx = g.createLinearGradient(0, 0, W, 0); fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.08, '#000'); fx.addColorStop(0.92, '#000'); fx.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fx; g.fillRect(0, 0, W, Hh);
      const fy = g.createLinearGradient(0, 0, 0, Hh); fy.addColorStop(0.84, '#000'); fy.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fy; g.fillRect(0, 0, W, Hh);
      g.globalCompositeOperation = 'destination-over'; g.fillStyle = bg || themeNow().bg; g.fillRect(0, 0, W, Hh);
      stillMode = false; draw();
      return out.toDataURL(type || 'image/png', quality);
    };
    window.__armReady = () => armReady;
    return {
      setActive(on) {
        onPage = on;
        if (on) { resize(); wake(); }
        else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      },
    };
  }

  // =================================================================== drawings on the cards
  // Colours come from the page's theme at paint time, so each drawing repaints when the theme changes.
  function palette() {
    const s = getComputedStyle(document.documentElement), v = (n) => s.getPropertyValue(n).trim();
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      dark, bg: v('--viz-bg'), ink: v('--ink'), muted: v('--muted'), faint: v('--faint'), line: v('--line'), strong: v('--line-strong'),
      accent: '#f2b632', blue: dark ? '#7aa7ff' : '#2f6fde', green: dark ? '#5fc58f' : '#2f9d62', red: dark ? '#ef6f66' : '#d6453d', pink: dark ? '#e889ab' : '#c9558a',
    };
  }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function setupCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }
  const VIZ = {
    // Ferrite against Redis at four pipeline depths
    // the desk robot: square face, LED eyes, pan-and-tilt neck
    deskbot(cv, K) {
      const { ctx, w, h } = setupCanvas(cv);
      ctx.fillStyle = K.bg; ctx.fillRect(0, 0, w, h);
      const s = Math.min(w / 320, h / 180) * 0.92;
      ctx.save(); ctx.translate(w / 2 - 160 * s, h / 2 - 90 * s); ctx.scale(s, s);
      ctx.fillStyle = K.strong; ctx.fillRect(40, 158, 240, 3);
      ctx.fillStyle = K.dark ? '#2b3542' : '#c4cad2'; ctx.beginPath(); ctx.ellipse(160, 154, 58, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = K.dark ? '#3b4554' : '#9aa3ad'; ctx.fillRect(150, 112, 20, 42);
      ctx.fillStyle = K.accent; ctx.fillRect(140, 104, 40, 12);
      ctx.save(); ctx.translate(160, 62); ctx.rotate(-0.12);
      ctx.fillStyle = K.dark ? '#d9dee5' : '#e6e9ed'; rr(ctx, -62, -48, 124, 96, 14); ctx.fill();
      if (!K.dark) { ctx.strokeStyle = K.strong; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = '#0d1218'; rr(ctx, -50, -36, 100, 72, 8); ctx.fill();
      for (const ex of [-22, 22]) {
        const g = ctx.createRadialGradient(ex, -4, 1, ex, -4, 16);
        g.addColorStop(0, '#cfe4ff'); g.addColorStop(0.4, '#6aa8ff'); g.addColorStop(1, 'rgba(106,168,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ex, -4, 16, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = '#6aa8ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 14, 9, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.fillStyle = K.dark ? '#3b4554' : '#9aa3ad'; ctx.fillRect(62, -10, 14, 18);
      ctx.restore();
      const beam = ctx.createLinearGradient(236, 56, 316, 40);
      beam.addColorStop(0, 'rgba(242,182,50,0.45)'); beam.addColorStop(1, 'rgba(242,182,50,0)');
      ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(234, 50); ctx.lineTo(320, 18); ctx.lineTo(320, 86); ctx.closePath(); ctx.fill();
      ctx.restore();
    },
    // an asteroid on its way to Earth (space stays dark in either theme)
    // No Free Check's 2×2: attack success by the evidence in context
    factorial(cv, K) {
      const { ctx, w, h } = setupCanvas(cv);
      ctx.fillStyle = K.bg; ctx.fillRect(0, 0, w, h);
      const cells = [[0.997, K.red], [0.627, K.dark ? '#f0a33a' : '#d9822b'], [0.327, K.dark ? '#e3c25a' : '#c79a12'], [0.010, K.green]];
      const pad = 12, gap = 6, cw = (w - pad * 2 - gap) / 2, ch = (h - pad * 2 - gap) / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      cells.forEach(([v, col], i) => {
        const x = pad + (i % 2) * (cw + gap), y = pad + Math.floor(i / 2) * (ch + gap);
        ctx.fillStyle = hexA(col, K.dark ? 0.22 : 0.16); rr(ctx, x, y, cw, ch, 7); ctx.fill();
        ctx.fillStyle = col; ctx.font = `680 ${Math.round(Math.min(cw * 0.24, ch * 0.4))}px ${FONT}`;
        ctx.fillText(v.toFixed(3), x + cw / 2, y + ch / 2 + 1);
      });
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },
    // the coding agent: a patch in an editor, lines removed and added, and a passing test run
  };
  function paintVisuals(root) {
    const K = palette();
    (root || document).querySelectorAll('canvas[data-viz]').forEach((cv) => {
      if (!cv.offsetParent) return; // on a page that is not showing
      const f = VIZ[cv.dataset.viz];
      if (f) { try { f(cv, K); } catch (e) { /* a decorative drawing failing should not break the page */ } }
    });
  }

  window.__paintVisuals = paintVisuals;   // the map's card draws its small pictures with these too

  // =================================================================== theme
  // Light, dark, or whatever the system says. The choice is kept in this browser; "system" keeps nothing.
  const THEME_KEY = 'tk-theme';
  function themePref() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; } }
  function applyTheme(pref) {
    const dark = pref === 'dark' || (pref === 'system' && mq('(prefers-color-scheme: dark)'));
    const root = document.documentElement, was = root.getAttribute('data-theme');
    root.setAttribute('data-theme', dark ? 'dark' : 'light'); root.setAttribute('data-theme-pref', pref);
    const flip = document.getElementById('theme-flip');
    if (flip) flip.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === pref)));
    if (was !== root.getAttribute('data-theme')) document.dispatchEvent(new CustomEvent('themechange'));
  }
  function setTheme(pref) {
    try { if (pref === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, pref); } catch (e) { /* not saved, still applied */ }
    applyTheme(pref);
  }

  // =================================================================== pages
  // Each top-bar item is its own page. The hash names the page (#research), or an item on one (#r-cvae).
  const TITLES = { home: 'Tarun Kumar', resume: 'Resume | Tarun Kumar', research: 'Research | Tarun Kumar', projects: 'Projects | Tarun Kumar', experience: 'Experience | Tarun Kumar' };
  let current = null, cellApi = null;
  function resolve(hash) {
    let id = (hash || '').replace(/^#/, '');
    try { id = decodeURIComponent(id); } catch (e) { /* keep it raw */ }
    if (!id || id === 'home' || id === 'top') return { page: 'home', target: null };
    if (TITLES[id]) return { page: id, target: null };
    const elx = document.getElementById(id);
    if (elx) { const pg = elx.closest('[data-page]'); return { page: pg ? pg.dataset.page : current || 'home', target: elx }; }
    return { page: 'home', target: null };
  }
  function show(page, target, first) {
    const changed = page !== current;
    if (changed) {
      document.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== page; });
      document.querySelectorAll('[data-nav]').forEach((a) => {
        if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      document.title = TITLES[page];
      current = page;
      paintVisuals(document.querySelector(`[data-page="${page}"]`));
    }
    if (target) {
      // a new page lands on the item at once; within a page, it glides there
      requestAnimationFrame(() => {
        if (first || reduceMotion || changed) jumpTo(target);
        else target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    } else if (!first) {
      jumpTop();
      const h = changed && document.querySelector(`[data-page="${page}"] h1`);
      if (h) h.focus({ preventScroll: true });
    }
  }
  // a page switch lands at the top at once, whatever the smooth-scroll setting
  function jumpTop() {
    const de = document.documentElement, prev = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); de.style.scrollBehavior = prev;
  }
  function jumpTo(el) {
    const de = document.documentElement, prev = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto'; el.scrollIntoView({ block: 'start' }); de.style.scrollBehavior = prev;
  }
  function onHash(first) {
    // #cell is the robot's live demo: its project entry behind, the cell in a dialog in front
    if (location.hash === '#cell') { show('projects', document.getElementById('p-cell'), first); openRobot(); return; }
    const r = resolve(location.hash); show(r.page, r.target, first);
  }
  // The robot cell opens in a dialog. It is heavy to start, so it starts the first time someone opens it,
  // showing a still of itself until the arm has loaded, and it stops whenever the dialog closes.
  let robotStarted = false;
  function openRobot() {
    const demo = document.getElementById('robot-demo');
    if (!demo) return;
    if (!demo.open) { try { demo.showModal(); } catch (e) { demo.setAttribute('open', ''); } }
    if (!robotStarted) { robotStarted = true; cellApi = startCell(); }
    if (cellApi) cellApi.setActive(true);
  }

  // =================================================================== init
  function init() {
    applyTheme(themePref());
    if (window.matchMedia) {
      const m = window.matchMedia('(prefers-color-scheme: dark)'), follow = () => { if (themePref() === 'system') applyTheme('system'); };
      if (m.addEventListener) m.addEventListener('change', follow); else if (m.addListener) m.addListener(follow);
    }
    const flip = document.getElementById('theme-flip');
    if (flip) flip.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
    document.addEventListener('themechange', () => paintVisuals(document.querySelector(`[data-page="${current}"]`)));
    const demo = document.getElementById('robot-demo');
    if (demo) {
      const close = () => { if (demo.open) demo.close(); };
      demo.addEventListener('close', () => { if (cellApi) cellApi.setActive(false); if (location.hash === '#cell') history.replaceState(null, '', '#p-cell'); });
      demo.querySelector('[data-close]').addEventListener('click', close);
      demo.addEventListener('click', (e) => { if (e.target === demo) close(); });   // a click on the backdrop
    }
    // the robot's demo and the figures are reached from the pages and from copies in the map's card, so one listener serves all
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-open-robot]')) openRobot(); });   // over whatever page you are on
    // a figure opens larger, with its caption, over the page
    const figbox = document.getElementById('figbox');
    if (figbox && typeof figbox.showModal === 'function') {
      const img = figbox.querySelector('.figbox-img'), cap = figbox.querySelector('.figbox-cap');
      document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.fig-img');
        if (!b) return;
        const which = [...b.classList].find((c) => c.startsWith('fig-') && c !== 'fig-img'), fc = b.closest('figure') && b.closest('figure').querySelector('figcaption');
        img.className = 'figbox-img ' + which;   // the figure's own class, so it follows the theme like the original
        img.style.setProperty('--ar', b.style.getPropertyValue('--ar') || '4 / 3');
        img.setAttribute('aria-label', (b.getAttribute('aria-label') || '').replace(/^Enlarge (the )?/, ''));
        cap.innerHTML = fc ? fc.innerHTML : '';
        figbox.showModal();
      });
      figbox.querySelector('[data-close]').addEventListener('click', () => figbox.close());
      figbox.addEventListener('click', (e) => { if (e.target === figbox) figbox.close(); });   // a click on the backdrop
    }
    onHash(true);
    window.addEventListener('hashchange', () => onHash(false));
    // clicking the tab you are already on goes back to its top
    document.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
      if (a.dataset.nav === current && location.hash === a.getAttribute('href')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); }
    }));
    const dock = document.querySelector('.dock'), top = document.getElementById('to-top');
    if (dock) {
      const onScroll = () => dock.classList.toggle('scrolled', window.scrollY > 480);
      window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    }
    if (top) top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => paintVisuals(document.querySelector(`[data-page="${current}"]`)), 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => paintVisuals(document.querySelector(`[data-page="${current}"]`)));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
