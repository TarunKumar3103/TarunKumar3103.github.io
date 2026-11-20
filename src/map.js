/* The map at the top of the home page: my work as points on a sphere. My name starts in the middle,
   shrinks, and lines grow out to seven groups with their items around them. Drag to turn it, choose a
   point to list what is there. Drawn on a 2D canvas; the labels are real HTML, so they stay sharp and
   the groups can be reached by keyboard. */
(function () {
  'use strict';
  const root = document.getElementById('map');
  if (!root) return;
  const stage = root.querySelector('.map-stage');
  const canvas = stage.querySelector('canvas');
  const g = canvas.getContext('2d');
  const core = stage.querySelector('.map-core');
  const layer = stage.querySelector('.map-labels');
  const card = document.getElementById('map-card');
  const cardT = document.getElementById('mc-t');
  const cardD = card.querySelector('.mc-d');
  const cardList = card.querySelector('.mc-list');
  const cardMore = card.querySelector('.mc-more');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hint = root.querySelector('.map-hint');
  if (hint && window.matchMedia('(hover: none)').matches) hint.textContent = 'Swipe sideways to turn the map. Tap a point to see what’s in it.';

  // ------------------------------------------------------------------ what is on the map
  // Group directions are laid out so the groups that share the most links sit next to each other.
  const HUBS = [
    { id: 'exp', t: 'Experience', d: 'Research in Penn State labs, internships at ADNOC Gas and the Nittany AI Alliance, and two student clubs.', page: '#experience', more: 'Open the Experience page', dir: [-0.4729, 0.4355, 0.766] },
    { id: 'res', t: 'Research', d: 'Five research projects, from LLM reasoning to proteomics.', page: '#research', more: 'Open the Research page', dir: [-0.7142, -0.624, 0.3171] },
    { id: 'pap', t: 'Papers and open source', d: 'Papers under review and in preparation, and pull requests to lab tools.', page: '#publications', more: 'See every paper and pull request', dir: [0.4731, -0.4209, 0.774] },
    { id: 'proj', t: 'Projects', d: 'Things I build, from a coding agent and a database to web apps and a research pipeline.', page: '#projects', more: 'Open the Projects page', dir: [0.7143, 0.6299, 0.305] },
    { id: 'comp', t: 'Competitions', d: 'Kaggle competitions, with how I approached each.', page: '#competitions', more: 'See how I approached each', dir: [0.6054, 0.1938, -0.772] },
    { id: 'skill', t: 'Skills', d: 'What I work with.', page: '#skills', more: 'See every skill', dir: [0.4007, -0.8647, -0.3029] },
    { id: 'edu', t: 'Education', d: 'Computer Science and Mathematics at Penn State.', page: '#education', more: 'See education', dir: [-0.4008, 0.8588, -0.3192] },
    { id: 'cert', t: 'Certifications', d: 'Two Anthropic courses and a machine learning bootcamp.', page: '#certifications', more: 'See certifications', dir: [-0.6057, -0.2084, -0.7679] },
  ];
  // s: label on the sphere; t, o, w: title, line and date in the card; h: where it links;
  // src: the entries on the other pages whose details the card shows (the item's own id when left out);
  // also: other groups the item belongs to, with the link and entry to use there.
  const LEAVES = [
    { id: 'x-ncems', hub: 'exp', s: 'NCEMS', t: 'Research Intern, Machine Learning and Bioinformatics', o: 'NSF National Synthesis Center (NCEMS), O’Brien Lab', w: 'March 2026 – Present', h: '#x-ncems' },
    { id: 'x-ai4r', hub: 'exp', s: 'AI4Research Lab', t: 'Undergraduate Researcher', o: 'AI4Research Lab, with Prof. Wenpeng Yin', w: 'January 2026 – Present', h: '#x-ai4r' },
    { id: 'x-cil', hub: 'exp', s: 'Multimodal RAG', t: 'Undergraduate Researcher, Multimodal RAG Systems', o: 'Collaboration and Innovation Lab, with He (Albert) Zhang', w: 'October 2025 – Present', h: '#x-cil' },
    { id: 'x-writing', hub: 'exp', s: 'AI in student writing', t: 'Research Assistant, AI in Student Writing', o: 'Collaboration and Innovation Lab, with Jiyoon Kim', w: 'October 2025 – January 2026', h: '#x-writing' },
    { id: 'x-biorob', hub: 'exp', s: 'BioRob-InFL', t: 'Research Assistant, Robotics Simulation', o: 'BioRob-InFL Lab, with Prof. Bo Cheng', w: 'September – December 2025', h: '#x-biorob' },
    { id: 'x-adnoc', hub: 'exp', s: 'ADNOC Gas', t: 'Software Development Intern', o: 'ADNOC Gas, Abu Dhabi', w: 'June – August 2025', h: '#x-adnoc' },
    { id: 'x-nittany', hub: 'exp', src: ['x-nittany-adv', 'x-nittany'], s: 'Nittany AI Alliance', t: 'Machine Learning Intern, then Advanced Machine Learning Intern', o: 'Nittany AI Alliance, Penn State', w: 'August 2024 – May 2025', h: '#x-nittany-adv' },
    { id: 'x-hrc', hub: 'exp', s: 'Humanoid Robotics Club', t: 'Software Engineer', o: 'Humanoid Robotics Club, Penn State', w: 'September – December 2024', h: '#x-hrc' },
    { id: 'x-gddc', hub: 'exp', s: 'Game development club', t: 'Game Developer', o: 'Game Design and Development Club, Penn State', w: 'September – December 2024', h: '#x-gddc' },

    { id: 'r-nofreecheck', hub: 'res', viz: 'factorial', also: [{ hub: 'pap', h: '#publications' }], s: 'No Free Check', t: 'No Free Check', o: 'When a language model can catch a corrupted value in its own reasoning.', w: 'Under review', h: '#r-nofreecheck' },
    { id: 'r-crossmodal', hub: 'res', s: 'Multimodal LLMs', t: 'Extending LLMs to new modalities', o: 'Reproducing a method that connects new modalities to LLMs, and evaluating models on LiDAR, radar and CT.', w: 'In progress', h: '#r-crossmodal' },
    { id: 'r-entanglement', hub: 'res', s: 'Protein entanglement', t: 'Proteome-scale protein entanglement', o: 'Entanglement detection across 555,846 AlphaFold structures. Thioredoxin, just below the map, shows one live.', w: 'NCEMS', h: '#r-entanglement' },
    { id: 'r-cvae', hub: 'res', s: 'Batch correction', t: 'Batch-effect correction for proteomics', o: 'An adversarial autoencoder that removes batch effects and keeps the biology.', w: 'NCEMS', h: '#r-cvae' },
    { id: 'r-litrag', hub: 'res', s: 'LitRAG', t: 'LitRAG and a review of generative-AI tools in HCI', o: 'Multimodal retrieval for reading research, and a review of 80 papers.', w: 'First author', h: '#r-litrag' },

    { id: 'o-convergent', hub: 'pap', s: 'Convergent Design Responses', t: 'Convergent Design Responses, Persistent Problems', o: 'A systematic review of 80 generative-AI systems papers in HCI. First author.', w: 'In preparation', h: '#o-convergent' },
    { id: 'o-ncle', hub: 'pap', s: 'NCLEdetector #1', t: 'obrien-lab-psu/NCLEdetector #1', o: 'Hungarian-algorithm matching, a cutoff for new organisms and a divide-by-zero guard.', w: 'Merged', h: 'https://github.com/obrien-lab-psu/NCLEdetector/pull/1' },
    { id: 'o-patlas', hub: 'pap', s: 'PerturbationAtlas #1', t: 'NCEMS/PerturbationAtlas #1', o: 'Fixes for problems found while processing a 24-dataset training set.', w: 'In review', h: '#o-patlas' },

    { id: 'p-gemma', hub: 'proj', also: [{ hub: 'comp', h: '#c-gemma', src: ['c-gemma'] }], s: 'Gemma 4 agent', t: 'Gemma 4 coding agent', o: 'Fixes GitHub issues and tests them in Docker. QLoRA and RL raised tasks solved by 12%.', w: 'Kaggle, final submission Dec 2', h: '#p-gemma' },
    { id: 'p-ferrite', hub: 'proj', s: 'Ferrite', t: 'Ferrite', o: 'A Redis-compatible database in C++20, up to 1.83 times Redis throughput.', w: 'C++20', h: '#p-ferrite' },
    { id: 'p-ncle', hub: 'proj', s: 'Protein simulations', t: 'Coarse-grained protein simulations', o: 'Coarse-grained simulations of how proteins refold, for an NCEMS rapid-fire project.', w: 'NCEMS rapid-fire project', h: '#p-ncle' },
    { id: 'p-cell', hub: 'proj', s: 'Robot cell', t: 'The robot cell', o: 'A Panda arm that stacks boxes, with seven-joint inverse kinematics. Opens as a live demo.', w: 'three.js and cannon-es', h: '#cell' },
    { id: 'p-social', hub: 'proj', s: 'Snapgram', t: 'Snapgram', o: 'A full-stack social media app in React and TypeScript, on Appwrite.', w: 'React and TypeScript', h: '#p-social' },
    { id: 'p-iphone', hub: 'proj', s: 'iPhone site replica', t: 'iPhone website replica', o: 'Apple\u2019s iPhone 15 Pro page rebuilt, with a 3D model of the phone in three.js.', w: 'My first frontend project', h: '#p-iphone' },
    { id: 'p-robot', hub: 'proj', s: 'Desk robot', t: 'Desk robot', o: 'An ESP32-S3 desk companion I soldered and wired myself.', w: 'Hardware, in progress', h: '#p-robot' },
    { id: 'p-pride', hub: 'proj', s: 'PRIDE sample finder', t: 'PRIDE control-sample finder', o: 'Screens about 10,000 proteomics projects to recommend control datasets.', w: 'NCEMS tool', h: '#p-pride' },
    { id: 'p-local', hub: 'proj', s: 'Local AI tools', t: 'Local AI tools', o: 'On-device transcription and notes, and LoRA fine-tuning with MLX.', w: 'Apple Silicon', h: '#p-local' },

    { id: 'c-namellm', hub: 'comp', s: 'Name That LLM', t: 'Name That LLM', o: 'Which of 18 language models wrote a passage.', w: 'Kaggle, running', h: '#c-namellm' },
    { id: 'c-squares', hub: 'comp', s: 'Squares in Squares', t: 'Squares in Squares', o: 'Packing unit squares into the smallest square, for n up to 1,000.', w: 'Kaggle, running', h: '#c-squares' },
    { id: 'c-nfl', hub: 'comp', s: 'NFL Big Data Bowl', t: 'NFL Big Data Bowl 2027', o: 'What Combine tracking data says about NFL play.', w: 'Kaggle, writeup due Jan 6', h: '#c-nfl' },
    { id: 'c-biohub', hub: 'comp', s: 'Biohub Cell Tracking', t: 'Biohub Cell Tracking', o: 'Traced the lost score to linking cells between frames, from 0.861 to 0.882.', w: 'Kaggle, Summer 2026', h: '#c-biohub' },

    { id: 's-lang', hub: 'skill', s: 'Languages', t: 'Languages', tags: ['Python', 'C++', 'C', 'Java', 'JavaScript', 'TypeScript', 'SQL', 'Bash'], h: '#skills' },
    { id: 's-ml', hub: 'skill', s: 'ML and data', t: 'ML and data', tags: ['PyTorch', 'Transformers', 'vLLM', 'LoRA and QLoRA', 'scikit-learn', 'pandas', 'NumPy', 'Optuna', 'RAG'], h: '#skills' },
    { id: 's-sys', hub: 'skill', s: 'Systems and backend', t: 'Systems and backend', tags: ['Linux', 'Multithreading', 'TCP/IP', 'FastAPI', 'PostgreSQL', 'Redis', 'React', 'Next.js'], h: '#skills' },
    { id: 's-infra', hub: 'skill', s: 'Infrastructure', t: 'Infrastructure', tags: ['Docker', 'Apptainer', 'HPC with SLURM', 'Git', 'Azure', 'GCP', 'Power BI'], h: '#skills' },

    { id: 'e-psu', hub: 'edu', s: 'Penn State', t: 'B.S. in Computer Science and Mathematics', o: 'The Pennsylvania State University. GPA 3.91, Dean’s List.', w: 'August 2024 – May 2028', h: '#e-psu' },

    { id: 'k-mcp', hub: 'cert', s: 'Model Context Protocol', t: 'Introduction to Model Context Protocol', o: 'Anthropic', w: 'Issued May 2026', h: '#k-mcp' },
    { id: 'k-fluency', hub: 'cert', s: 'AI Fluency', t: 'AI Fluency: Framework and Foundations', o: 'Anthropic', w: 'Issued May 2026', h: '#k-fluency' },
    { id: 'k-nittany', hub: 'cert', s: 'Nittany AI bootcamp', t: 'Nittany AI Machine Learning Bootcamp 2024', o: 'Canvas Credentials (Badgr)', w: 'Issued January 2025', h: '#k-nittany' },
  ];
  // work that came out of the same place
  const RELATED = [['x-nittany', 'k-nittany'], ['x-ncems', 'r-entanglement'], ['x-ncems', 'r-cvae'], ['x-ncems', 'o-ncle'], ['x-ncems', 'o-patlas'], ['x-ncems', 'p-pride'], ['x-ncems', 'p-ncle'], ['r-entanglement', 'p-ncle'],
    ['x-ai4r', 'r-crossmodal'], ['x-cil', 'r-litrag'], ['x-cil', 'r-nofreecheck'], ['x-cil', 'o-convergent'], ['r-litrag', 'o-convergent'], ['e-psu', 'k-nittany']];

  // ------------------------------------------------------------------ vectors and rotations
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const qAxis = (ax, ang) => { const s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s]; };
  const qMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  function qRot(q, v, out) {
    const w = q[0], x = q[1], y = q[2], z = q[3];
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    out[0] = v[0] + w * tx + (y * tz - z * ty); out[1] = v[1] + w * ty + (z * tx - x * tz); out[2] = v[2] + w * tz + (x * ty - y * tx);
    return out;
  }
  function qSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((c) => -c); d = -d; }
    if (d > 0.9995) return qNorm(a.map((c, i) => c + (b[i] - c) * t));
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((c, i) => c * wa + b[i] * wb);
  }
  function arcPoints(a, b, n) {   // points along the great circle from a to b
    const th = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))), s = Math.sin(th), pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (s < 1e-5) { pts.push(a.slice()); continue; }
      const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
      pts.push(norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]));
    }
    return pts;
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeBack = (t) => { const c = 1.7; return t <= 0 ? 0 : 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  // ------------------------------------------------------------------ build the graph
  const hubs = HUBS.map((h, i) => Object.assign({}, h, { kind: 'hub', i, p0: norm(h.dir), own: [], members: [], longs: [] }));
  const hubOf = Object.fromEntries(hubs.map((h) => [h.id, h]));
  const leaves = LEAVES.map((n) => Object.assign({}, n, { kind: 'leaf', longs: [] }));
  const leafOf = Object.fromEntries(leaves.map((n) => [n.id, n]));
  for (const n of leaves) {
    n.hubNode = hubOf[n.hub]; n.hubNode.own.push(n); n.hubNode.members.push(n);
    for (const a of n.also || []) hubOf[a.hub].members.push(n);
  }
  for (const h of hubs) {   // each group's own items sit on a ring around it
    const n = h.own.length, th = n === 1 ? 0.3 : Math.min(0.56, 0.3 + 0.036 * n), c = Math.cos(th), s = Math.sin(th);
    let u = cross([0, 1, 0], h.p0); if (Math.hypot(u[0], u[1], u[2]) < 0.2) u = cross([1, 0, 0], h.p0); u = norm(u);
    const w = cross(h.p0, u);
    h.own.forEach((lf, k) => {
      const ph = 0.5 + (2 * Math.PI * k) / n, cp = Math.cos(ph) * s, sp = Math.sin(ph) * s;
      lf.k = k;
      lf.p0 = norm([h.p0[0] * c + cp * u[0] + sp * w[0], h.p0[1] * c + cp * u[1] + sp * w[1], h.p0[2] * c + cp * u[2] + sp * w[2]]);
    });
  }
  const nodes = hubs.concat(leaves);
  for (const n of nodes) { n.v = [0, 0, 0]; n.sx = 0; n.sy = 0; n.k = 1; n.alpha = 0; n.la = 0; }
  const SHORT = leaves.map((n) => (n.short = { a: n.hubNode, b: n, pts: arcPoints(n.hubNode.p0, n.p0, 10) }));
  const LONG = [];
  for (const n of leaves) for (const a of n.also || []) { const L = { a: n, b: hubOf[a.hub], member: true }; LONG.push(L); n.longs.push(L); hubOf[a.hub].longs.push(L); }
  for (const [x, y] of RELATED) { const L = { a: leafOf[x], b: leafOf[y] }; LONG.push(L); L.a.longs.push(L); L.b.longs.push(L); }
  for (const L of LONG) L.pts = arcPoints(L.a.p0, L.b.p0, 34);
  // the sphere's surface: evenly spread dots, each fading in at its own moment
  const DOTS = [];
  { const N = 540, ga = Math.PI * (3 - Math.sqrt(5)); let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) { const y = 1 - ((i + 0.5) * 2) / N, r = Math.sqrt(1 - y * y), t = i * ga; DOTS.push({ p0: [Math.cos(t) * r, y, Math.sin(t) * r], d: rnd() * 700 }); } }

  // ------------------------------------------------------------------ state
  const D = 3.6, K = 1 / 1.041, PX = 0.0058, SPIN = 0.0001;   // camera distance in radii, rim fit, radians per pixel and per ms
  const T = { hold: 550, shrink: 850, spokes: 900, hubGap: 90, spokeDur: 600, leaves: 1500, leafGap: 45, leafDur: 450, dots: 1150, dotsDur: 650, longs: 2600, longDur: 700, spin: 2500, end: 3400 };
  const S = { q: [1, 0, 0, 0], vx: 0, vy: 0, spin: 0, t0: null, sel: null, mark: null, centered: false, focus: null,
    open: 0, coreA: 1, it: 0, mini: -1, quietAt: 0, coreW: 0, coreH: 0, inside: false, idleUntil: 0, w: 0, h: 0, dpr: 1, cx: 0, cy: 0, R: 100, last: 0, running: false, raf: 0 };
  let hotPick = null, hotLabel = null, hotCard = null, hotKey = null, drag = null, C = null;
  const hot = () => hotCard || hotKey || hotLabel || hotPick;
  const tmp = [0, 0, 0];

  // ------------------------------------------------------------------ labels
  for (const h of hubs) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'map-hub'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'map-card');
    b.style.setProperty('--c', `var(--c-${h.id})`); b.style.setProperty('--t', `var(--t-${h.id})`);
    const tpl = document.getElementById('mc-tpl-' + h.id), count = tpl ? tpl.content.querySelectorAll('.mc-item').length : h.members.length;   // as many as the card lists
    b.append(h.t); const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = `, ${count} ${count === 1 ? 'item' : 'items'}`; b.append(sr);
    b.addEventListener('click', () => choose(h, true));
    b.addEventListener('pointerenter', () => { hotLabel = h; });
    b.addEventListener('pointerleave', () => { if (hotLabel === h) hotLabel = null; });
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { hotKey = h; if (S.sel !== h.id) focusOn(h); } });
    b.addEventListener('blur', () => { if (hotKey === h) hotKey = null; });
    layer.appendChild(b); h.el = b;
  }
  for (const n of leaves) { const s = document.createElement('span'); s.className = 'map-leaf'; s.setAttribute('aria-hidden', 'true'); s.textContent = n.s; s.style.setProperty('--t', `var(--t-${n.hub})`); layer.appendChild(s); n.el = s; }
  let sized = false;
  function measure() { for (const n of nodes) { n.lw = n.el.offsetWidth; n.lh = n.el.offsetHeight; } sized = true; }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sized = false; });

  // ------------------------------------------------------------------ colours from the theme
  function hex(c) { c = c.trim().replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); const n = parseInt(c, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function readColors() {
    const cs = getComputedStyle(document.documentElement), v = (k) => hex(cs.getPropertyValue(k));
    C = { ink: v('--ink'), muted: v('--muted'), faint: v('--faint'), line: v('--line-strong'), accent: v('--accent'), soft: v('--accent-soft'), bg: v('--bg'), cat: {} };
    for (const h of hubs) C.cat[h.id] = { dot: v(`--c-${h.id}`), ink: v(`--t-${h.id}`) };
  }
  const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const catOf = (n) => C.cat[(n.kind === 'hub' ? n : n.hubNode).id];
  document.addEventListener('themechange', () => { readColors(); kick(); });

  // ------------------------------------------------------------------ size and layout
  // On wider screens the stage runs nearly the width of the window. Closed, the sphere sits in the middle of the
  // page. Open, it moves left and the card fills the right, with the same gap from the window's left edge to the
  // sphere as from the card to the window's right edge.
  const NARROW = window.matchMedia('(max-width: 719px)');   // the card is a sheet along the bottom
  const geo = { mid: 0, colW: 1, R1: 0, cx1: 0, cw: 0, ri: 0, cardL: 0 };
  function plan() {
    const r = stage.getBoundingClientRect(), col = root.getBoundingClientRect();
    geo.colW = col.width; geo.mid = col.left - r.left + col.width / 2;
    if (NARROW.matches) { card.style.width = card.style.right = ''; geo.cardL = S.w; return; }
    const pageW = document.documentElement.clientWidth, pageL = -r.left, pageR = pageW - r.left;
    const R0 = Math.min(col.width * 0.33, S.h * 0.4, 280), GAP = 84, CW_MIN = 440, CW_MAX = 880, R_MIN = 110;   // GAP: room for labels between sphere and card
    let E = Math.max(28, Math.min(200, pageW * 0.08)), R1 = Math.min(R0, S.h * 0.3);   // E: the gap at each side of the window
    const fit = () => pageW - 2 * E - GAP - 2 * R1;
    let cw = fit();
    if (cw < CW_MIN) { R1 = Math.max(R_MIN, (pageW - 2 * E - GAP - CW_MIN) / 2); cw = fit(); }   // short of room: a smaller sphere,
    if (cw < CW_MIN) { E = Math.max(24, (pageW - GAP - 2 * R1 - CW_MIN) / 2); cw = fit(); }        // then narrower gaps
    if (cw > CW_MAX) { E += (cw - CW_MAX) / 2; cw = CW_MAX; }                                     // plenty: wider gaps, both sides alike
    geo.R1 = R1; geo.cx1 = pageL + E + R1; geo.cw = Math.round(cw);
    geo.ri = Math.max(0, Math.round(S.w - (pageR - E))); geo.cardL = S.w - geo.ri - geo.cw;
    card.style.width = geo.cw + 'px'; card.style.right = geo.ri + 'px';
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    S.w = Math.max(1, r.width); S.h = Math.max(1, r.height); S.dpr = Math.min(2, window.devicePixelRatio || 1);
    plan();
    canvas.width = Math.round(S.w * S.dpr); canvas.height = Math.round(S.h * S.dpr);
    sized = false; coreBig = null; kick();
  }
  window.addEventListener('resize', resize);   // the window can change without the stage changing size
  function layout(e) {   // e: how far the card is open, 0 to 1
    const narrow = NARROW.matches, mid = geo.mid, R0 = Math.min(geo.colW * (narrow ? 0.39 : 0.33), S.h * 0.4, 280);
    if (!narrow) {
      S.R = R0 + (geo.R1 - R0) * e; S.cx = mid + (geo.cx1 - mid) * e; S.cy = S.h / 2;
    } else {
      const ch = card.hidden ? S.h * 0.5 : card.offsetHeight, free = Math.max(S.h * 0.3, S.h - ch - 16), R1 = Math.min(R0, free * 0.42);
      S.R = R0 + (R1 - R0) * e; S.cx = mid; S.cy = S.h / 2 + (free / 2 - S.h / 2) * e;
    }
  }
  function project(v, out) {   // out: [x, y, scale]
    const p = D / (D - v[2]);
    out[0] = S.cx + v[0] * S.R * p * K; out[1] = S.cy - v[1] * S.R * p * K; out[2] = p;
    return out;
  }

  // ------------------------------------------------------------------ turning
  function turn(ay, ax) { S.q = qNorm(qMul(qMul(qAxis([0, 1, 0], ay), qAxis([1, 0, 0], ax)), S.q)); }
  function focusOn(n) {   // bring a point round to face the viewer
    const v = qRot(S.q, n.p0, [0, 0, 0]), d = Math.max(-1, Math.min(1, v[2]));
    S.centered = true; S.vx = S.vy = 0;
    if (d > 0.9999) return kick();
    let ax = cross(v, [0, 0, 1]); const l = Math.hypot(ax[0], ax[1], ax[2]);
    ax = l < 1e-6 ? [0, 1, 0] : [ax[0] / l, ax[1] / l, ax[2] / l];
    const to = qNorm(qMul(qAxis(ax, Math.acos(d)), S.q));
    if (reduce.matches) { S.q = to; S.focus = null; } else S.focus = { from: S.q.slice(), to, t0: performance.now(), dur: 720 };
    kick();
  }

  // ------------------------------------------------------------------ the card
  // A group lists its items as the home page used to: logos, pictures, tags (a <template> per group in the page).
  // An item shows everything the site says about it: its entry on the Research, Projects or Experience page,
  // copied in, so each thing is written once.
  const back = card.querySelector('.mc-back');
  const detail = card.querySelector('.mc-detail');
  const PAGE_OF = { x: 'Experience', e: 'Experience', k: 'Experience', r: 'Research', o: 'Research', p: 'Projects', c: 'Projects' };
  let openItem = null, openEl = null;   // the item on show, and the card in the list it was opened from
  function srcOf(n, h) {   // the page entries for an item, as listed in this group
    const a = h && n.hub !== h.id && (n.also || []).find((x) => x.hub === h.id);
    return ((a && a.src) || n.src || [n.id]).map((id) => document.getElementById(id)).filter(Boolean);
  }
  function copyOf(el) {   // a page entry, made to sit in the card: no ids, headings one level down, dates under the role
    const d = document.createElement('div');
    d.className = (el.className ? el.className + ' ' : '') + 'mc-src';
    d.innerHTML = el.innerHTML;
    for (const x of d.querySelectorAll('[id]')) x.removeAttribute('id');
    for (const x of d.querySelectorAll('[aria-labelledby], [aria-describedby]')) { x.removeAttribute('aria-labelledby'); x.removeAttribute('aria-describedby'); }
    for (const h2 of d.querySelectorAll('h2')) { const h3 = document.createElement('h3'); h3.className = h2.className; h3.innerHTML = h2.innerHTML; h2.replaceWith(h3); }
    const when = d.querySelector(':scope > .row-when'), main = d.querySelector(':scope > .row-main');
    if (when && main) (main.querySelector(':scope > .row-l') || main.querySelector(':scope > .row-o') || main.lastElementChild).after(when);
    return d;
  }
  const paint = (el) => { if (window.__paintVisuals) window.__paintVisuals(el); };
  function listItems(h) {
    cardList.textContent = '';
    const tpl = document.getElementById('mc-tpl-' + h.id);
    if (tpl) { cardList.append(tpl.content.cloneNode(true)); return; }
    const grid = document.createElement('div'); grid.className = 'mc-tiles mc-tiles-2';   // skills: each area with what I use in it
    for (const n of h.members) {
      const el = document.createElement('div'); el.className = 'card tile mc-item mc-skill'; el.dataset.node = n.id;
      const t = document.createElement('h3'); t.className = 'tile-t'; t.textContent = n.t;
      const p = document.createElement('p'); p.className = 'tags';
      for (const tg of n.tags || []) { const s2 = document.createElement('span'); s2.className = 'tag'; s2.textContent = tg; p.append(s2); }
      el.append(t, p); grid.append(el);
    }
    cardList.append(grid);
  }
  // the list's cards light up their points on the map, and open their item
  const itemEl = (t) => { const el = t && t.closest ? t.closest('[data-node]') : null; return el && cardList.contains(el) ? el : null; };
  cardList.addEventListener('pointerover', (e) => { const el = itemEl(e.target); hotCard = el ? leafOf[el.dataset.node] || null : null; });
  cardList.addEventListener('pointerleave', () => { hotCard = null; });
  cardList.addEventListener('focusin', (e) => { const el = itemEl(e.target); if (el) hotCard = leafOf[el.dataset.node] || null; });
  cardList.addEventListener('focusout', (e) => { if (!itemEl(e.relatedTarget)) hotCard = null; });
  cardList.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-robot], a[href]')) return;   // the live demo and links do their own thing
    const el = itemEl(e.target), h = hubOf[S.sel], n = el && leafOf[el.dataset.node];
    if (!n || !h || n.tags || !e.target.closest('button')) return;
    hotCard = null; S.mark = n; openEl = el;
    showItem(h, n, true, el.dataset.src ? el.dataset.src.split(' ') : null);
    focusOn(n);
  });
  function reveal(el) {   // scroll the list, and only the list, so an item is in view
    const r = el.getBoundingClientRect(), c = cardList.getBoundingClientRect();
    if (r.top < c.top) cardList.scrollTop += r.top - c.top - 6;
    else if (r.bottom > c.bottom) cardList.scrollTop += Math.min(r.bottom - c.bottom + 6, r.top - c.top - 6);
  }
  function setMore(href, text) {
    const out = /^https?:/.test(href);
    cardMore.href = href; cardMore.textContent = text;
    if (out) { cardMore.target = '_blank'; cardMore.rel = 'noopener noreferrer'; } else { cardMore.removeAttribute('target'); cardMore.removeAttribute('rel'); }
  }
  function showGroup(h, moveFocus) {
    const was = openItem, from = openEl; openItem = null; openEl = null;
    back.hidden = true; cardD.hidden = false; cardList.hidden = false; detail.hidden = true; detail.textContent = '';
    setMore(h.page, h.more);
    let el = from && cardList.contains(from) ? from : was && cardList.querySelector(`[data-node="${was.id}"]`);
    if (!el) return;
    reveal(el);
    if (!el.matches('button')) el = el.querySelector('button.mc-open') || el;
    if (moveFocus) el.focus({ preventScroll: true });
  }
  function showItem(h, n, moveFocus, ids) {
    openItem = n;
    back.hidden = false; back.setAttribute('aria-label', `Back to ${h.t}`);
    cardD.hidden = true; cardList.hidden = true; detail.hidden = false; detail.textContent = '';
    const els = ids ? ids.map((id) => document.getElementById(id)).filter(Boolean) : srcOf(n, h);
    for (const el of els) detail.append(copyOf(el));
    if (!els.length) {   // nothing on another page: what the map knows
      const d = document.createElement('div'); d.className = 'mc-src';
      d.innerHTML = '<h3 class="mc-src-t"></h3><p class="mc-io"></p><p class="mc-iw"></p>';
      d.querySelector('h3').textContent = n.t; d.querySelector('.mc-io').textContent = n.o || ''; d.querySelector('.mc-iw').textContent = n.w || '';
      detail.append(d);
    }
    const ext = /^https?:/.test(n.h);
    if (ext) setMore(n.h, 'Open on GitHub');
    else if (els.length) setMore('#' + els[0].id, `Open on the ${PAGE_OF[els[0].id[0]] || h.t} page`);
    else setMore(h.page, h.more);
    detail.scrollTop = 0;
    paint(detail);
    if (moveFocus) back.focus({ preventScroll: true });
  }
  function choose(n, viaButton) {
    const h = n.kind === 'hub' ? n : n.hubNode;
    openCard(h, n.kind === 'leaf' ? n : null, viaButton && document.activeElement === h.el && h.el.matches(':focus-visible'));
    focusOn(n);
  }
  function openCard(h, mark, moveFocus) {
    const fresh = S.sel !== h.id;
    S.sel = h.id; S.mark = mark;
    for (const x of hubs) x.el.setAttribute('aria-expanded', String(x === h));
    if (fresh) {
      cardT.textContent = h.t; cardD.textContent = h.d;
      card.style.setProperty('--c', `var(--c-${h.id})`); card.style.setProperty('--t', `var(--t-${h.id})`);
      listItems(h);
      if (card.hidden) { card.hidden = false; if (!reduce.matches) { card.classList.remove('is-in'); void card.offsetWidth; card.classList.add('is-in'); } }
    }
    if (fresh || !openItem) requestAnimationFrame(() => paint(cardList));   // the small drawings need the card on screen to size themselves
    openEl = null;
    if (mark && !mark.tags) showItem(h, mark, false);
    else showGroup(h, false);
    for (const el of cardList.querySelectorAll('[data-node]')) el.classList.toggle('is-mark', !!mark && el.dataset.node === mark.id);
    if (mark && mark.tags) { const el = cardList.querySelector(`[data-node="${mark.id}"]`); if (el) reveal(el); }
    if (moveFocus) cardT.focus({ preventScroll: true });
    kick();
  }
  function closeCard(returnFocus) {
    if (!S.sel) return;
    const h = hubOf[S.sel];
    S.sel = null; S.mark = null; S.centered = false; hotCard = null; openItem = null; openEl = null;
    card.hidden = true; card.classList.remove('is-in'); detail.textContent = '';
    for (const x of hubs) x.el.setAttribute('aria-expanded', 'false');
    if (returnFocus && h) h.el.focus({ preventScroll: true });
    kick();
  }
  back.addEventListener('click', () => { const h = hubOf[S.sel]; if (!h) return; S.mark = null; showGroup(h, true); paint(cardList); kick(); });
  cardMore.addEventListener('click', () => { if (!/^https?:/.test(cardMore.getAttribute('href'))) closeCard(false); });
  card.querySelector('.mc-x').addEventListener('click', () => closeCard(true));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sel) { e.preventDefault(); closeCard(true); return; }
    if (card.contains(e.target)) return;
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k || !stage.contains(e.target)) return;
    e.preventDefault(); S.focus = null; S.centered = false;
    if (reduce.matches) turn(k[0] * 0.35, k[1] * 0.35); else { S.vx = k[0] * 0.0011; S.vy = k[1] * 0.0011; }
    S.idleUntil = performance.now() + 4000; kick();
  });

  // ------------------------------------------------------------------ pointer
  function pick(mx, my) {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      if (n.alpha < 0.2 || n.v[2] < -0.3) continue;
      const r = n.kind === 'hub' ? 15 : 11, d = Math.hypot(n.sx - mx, n.sy - my) - n.v[2] * 3;
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  }
  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || card.contains(e.target)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), moved: false, touch: e.pointerType !== 'mouse', onHub: !!e.target.closest('.map-hub') };
    S.vx = S.vy = 0;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now(), dt = Math.max(1, now - drag.lt);
    if (!drag.moved && Math.hypot(e.clientX - drag.x, (drag.touch ? 0 : e.clientY - drag.y)) > 5) {
      drag.moved = true; S.focus = null; S.centered = false; stage.classList.add('is-dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* the pointer may already be gone */ }
    }
    if (drag.moved) {
      const dx = e.clientX - drag.lx, dy = drag.touch ? 0 : e.clientY - drag.ly;
      turn(dx * PX, dy * PX);
      S.vx = 0.75 * S.vx + 0.25 * (dx * PX) / dt; S.vy = 0.75 * S.vy + 0.25 * (dy * PX) / dt;
      kick();
    }
    drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; stage.classList.remove('is-dragging');
    S.idleUntil = performance.now() + 2500;
    if (d.moved) { if (performance.now() - d.lt > 90) S.vx = S.vy = 0; kick(); return; }
    S.vx = S.vy = 0;
    if (cancelled || d.onHub) return;   // a label's own click handler takes it from here
    const [mx, my] = local(e), n = pick(mx, my);
    if (n) choose(n, false); else if (S.sel) closeCard(false);
  }
  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    S.inside = true;
    if (card.contains(e.target)) { hotPick = null; stage.classList.remove('is-over'); return; }
    const [mx, my] = local(e), n = pick(mx, my);
    if (n !== hotPick) { hotPick = n; stage.classList.toggle('is-over', !!n); kick(); }
  });
  stage.addEventListener('pointerleave', () => { S.inside = false; hotPick = null; stage.classList.remove('is-over'); S.idleUntil = performance.now() + 1200; });

  // ------------------------------------------------------------------ drawing
  const P = [0, 0, 0], Q = [0, 0, 0], V = [0, 0, 0];
  const depthA = (z) => 0.22 + 0.78 * smooth(-0.6, 0.45, z);
  function lit() {   // what to light up and which items get a label
    const ns = new Set(), ls = new Set(), tags = new Set();
    const links = (n, label) => { for (const L of n.longs) { ls.add(L); for (const m of [L.a, L.b]) { ns.add(m); if (label && m.kind === 'leaf') tags.add(m); } } };
    const hub = (h) => { ns.add(h); for (const m of h.members) { ns.add(m); tags.add(m); links(m, false); if (m.hubNode === h) ls.add(m.short); } for (const L of h.longs) ls.add(L); };
    const leaf = (n) => { ns.add(n); tags.add(n); ns.add(n.hubNode); ls.add(n.short); links(n, true); };
    if (S.sel) hub(hubOf[S.sel]);
    const n = hot();
    if (n) (n.kind === 'hub' ? hub : leaf)(n);
    if (S.mark) leaf(S.mark);
    return { ns, ls, tags, any: !!(S.sel || n) };
  }
  function strokePts(pts, upto, colA, colB, alpha, width, dash) {   // a line along the sphere: fainter where it runs behind, shading from one group's colour to the other's
    const n = pts.length - 1, reach = upto * n, last = Math.max(1, Math.floor(reach)), frac = reach - Math.floor(reach);
    const steps = colB ? 4 : 1, buckets = [];
    for (let i = 0; i < 4 * steps; i++) buckets.push([]);
    let prev = project(qRot(S.q, pts[0], V), [0, 0, 0]), pz = V[2];
    const end = Math.min(last + (frac > 0 ? 1 : 0), n);
    for (let i = 1; i <= end; i++) {
      qRot(S.q, pts[i], V); let cur = project(V, [0, 0, 0]); const z = V[2];
      if (i === last + 1) cur = [prev[0] + (cur[0] - prev[0]) * frac, prev[1] + (cur[1] - prev[1]) * frac];
      const b = Math.min(3, Math.floor(depthA((pz + z) / 2) * 4)), c = steps > 1 ? Math.min(steps - 1, Math.floor(((i - 0.5) / n) * steps)) : 0;
      buckets[b * steps + c].push(prev[0], prev[1], cur[0], cur[1]);
      prev = cur; pz = z;
    }
    g.lineWidth = width; g.setLineDash(dash || []);
    for (let k = 0; k < buckets.length; k++) {
      const seg = buckets[k]; if (!seg.length) continue;
      const b = Math.floor(k / steps), c = k % steps;
      g.strokeStyle = rgba(steps > 1 ? mix(colA, colB, (c + 0.5) / steps) : colA, alpha * ((b + 0.75) / 4));
      g.beginPath();
      for (let i = 0; i < seg.length; i += 4) { g.moveTo(seg[i], seg[i + 1]); g.lineTo(seg[i + 2], seg[i + 3]); }
      g.stroke();
    }
    g.setLineDash([]);
  }
  function draw() {
    const it = S.t0 === null ? -1 : S.it;
    const at = (start, dur) => (it < 0 ? 0 : clamp01((it - start) / dur));
    const L = lit(), dim = L.any ? 0.32 : 1;
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.w, S.h);
    for (const n of nodes) { qRot(S.q, n.p0, n.v); project(n.v, P); n.sx = P[0]; n.sy = P[1]; n.k = P[2]; }

    // the rim and the surface
    const surf = at(T.dots, T.dotsDur + 700);
    if (surf > 0) {
      g.strokeStyle = rgba(C.line, 0.55 * surf); g.lineWidth = 1;
      g.beginPath(); g.arc(S.cx, S.cy, S.R, 0, Math.PI * 2); g.stroke();
      const buckets = [[], [], [], [], []];
      for (const d of DOTS) {
        const a = it < 0 ? 0 : clamp01((it - T.dots - d.d) / T.dotsDur); if (a <= 0) continue;
        qRot(S.q, d.p0, V); project(V, P);
        const f = smooth(-1, 1, V[2]), b = Math.min(4, Math.floor(f * 5));
        buckets[b].push(P[0], P[1], (0.55 + 0.75 * f) * P[2], a);
      }
      for (let b = 0; b < 5; b++) {
        const arr = buckets[b]; if (!arr.length) continue;
        g.fillStyle = rgba(C.faint, (0.13 + 0.42 * (b / 4)) * surf);
        g.beginPath();
        for (let i = 0; i < arr.length; i += 4) { if (arr[i + 3] < 0.5) continue; g.moveTo(arr[i] + arr[i + 2], arr[i + 1]); g.arc(arr[i], arr[i + 1], arr[i + 2], 0, Math.PI * 2); }
        g.fill();
      }
    }
    // spokes from the middle out to each group
    for (const h of hubs) {
      const grow = easeOut(at(T.spokes + h.i * T.hubGap, T.spokeDur)); if (grow <= 0) continue;
      Q[0] = h.v[0] * grow; Q[1] = h.v[1] * grow; Q[2] = h.v[2] * grow; project(Q, P);
      const on = L.ns.has(h);
      g.strokeStyle = rgba(C.cat[h.id].dot, (on ? 0.85 : 0.36 * dim) * depthA(h.v[2] * 0.6));
      g.lineWidth = on ? 1.4 : 1;
      g.beginPath(); g.moveTo(S.cx, S.cy); g.lineTo(P[0], P[1]); g.stroke();
    }
    // group to item
    for (const s of SHORT) {
      const n = s.b, h = s.a, grow = easeOut(at(T.leaves + h.i * T.hubGap + n.k * T.leafGap, T.leafDur)); if (grow <= 0) continue;
      const on = L.ls.has(s);
      strokePts(s.pts, grow, C.cat[h.id].dot, null, on ? 0.95 : 0.52 * dim, on ? 1.5 : 1.1);
    }
    // links between groups
    const la = at(T.longs, T.longDur);
    if (la > 0) for (const l of LONG) {
      const on = L.ls.has(l), ca = catOf(l.a).dot, cb = catOf(l.b).dot;
      if (on) strokePts(l.pts, 1, ca, cb, 0.9 * la, 1.4);
      else strokePts(l.pts, la, ca, cb, 0.42 * dim, 1, [2, 4]);
    }
    // points, back to front
    const order = nodes.slice().sort((a, b) => a.v[2] - b.v[2]);
    for (const n of order) {
      const pop = n.kind === 'hub'
        ? easeBack(at(T.spokes + n.i * T.hubGap + T.spokeDur * 0.8, 320))
        : easeBack(at(T.leaves + n.hubNode.i * T.hubGap + n.k * T.leafGap + T.leafDur * 0.8, 260));
      n.alpha = Math.min(1, pop);
      if (pop <= 0) continue;
      const on = L.ns.has(n), sel = n.kind === 'hub' && S.sel === n.id, marked = S.mark === n || (hot() === n);
      const a = depthA(n.v[2]) * (L.any && !on ? 0.45 : 1);
      const sc = n.k * pop, c = catOf(n).dot;
      if (n.kind === 'hub') {
        if (sel) { g.fillStyle = rgba(c, 0.22 * a); g.beginPath(); g.arc(n.sx, n.sy, 15 * sc, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = rgba(c, a);
        g.beginPath(); g.arc(n.sx, n.sy, (sel ? 6.2 : 5.6) * sc, 0, Math.PI * 2); g.fill();
        if (sel || marked) { g.strokeStyle = rgba(sel ? C.ink : c, a); g.lineWidth = 1.5; g.beginPath(); g.arc(n.sx, n.sy, (sel ? 6.2 : 9.5) * sc, 0, Math.PI * 2); g.stroke(); }
      } else {
        const r = (marked ? 4.8 : on ? 3.5 : 3.2) * sc;
        g.fillStyle = marked || on ? rgba(c, a) : rgba(C.bg, a);
        g.beginPath(); g.arc(n.sx, n.sy, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = rgba(marked ? C.ink : c, a); g.lineWidth = marked ? 1.5 : 1.3; g.stroke();
      }
    }
    return L;
  }

  // ------------------------------------------------------------------ labels follow their points, without landing on each other
  const SIDES = { r: 'lud', l: 'rud', u: 'drl', d: 'url' };
  function labels(L, dt) {
    if (!sized) measure();
    const ease = reduce.matches ? 1 : 1 - Math.exp(-dt / 110), e = easeInOut(clamp01(S.open));
    const narrow = NARROW.matches;
    const maxX = narrow ? S.w - 4 : S.w - 4 - (S.w - geo.cardL + 10) * e;
    const maxY = narrow ? S.h - 4 - (card.offsetHeight + 10) * e : S.h - 4;
    const placed = [];
    const fits = (x, y, w, h) => { for (const r of placed) if (x < r[0] + r[2] + 4 && x + w + 4 > r[0] && y < r[1] + r[3] + 2 && y + h + 2 > r[1]) return false; return true; };
    function spot(n, side, gap) {
      let x, y;
      if (side === 'r') { x = n.sx + gap; y = n.sy - n.lh / 2; } else if (side === 'l') { x = n.sx - gap - n.lw; y = n.sy - n.lh / 2; }
      else if (side === 'u') { x = n.sx - n.lw / 2; y = n.sy - gap - n.lh; } else { x = n.sx - n.lw / 2; y = n.sy + gap; }
      return [Math.max(4, Math.min(maxX - n.lw, x)), Math.max(4, Math.min(maxY - n.lh, y))];
    }
    function place(n, pref, gap, must) {
      const order = [n.side, pref].concat(SIDES[pref].split('')).filter((v, i, a) => v && a.indexOf(v) === i);
      for (const sd of order) { const p = spot(n, sd, gap); if (fits(p[0], p[1], n.lw, n.lh)) { placed.push([p[0], p[1], n.lw, n.lh]); n.side = sd; return p; } }
      if (!must) return null;
      const p = spot(n, pref, gap); placed.push([p[0], p[1], n.lw, n.lh]); n.side = pref; return p;
    }
    const show = (n, p, target) => {
      n.la += (target - n.la) * ease;
      if (n.la < 0.02 || !p) { if (n.el.style.visibility !== 'hidden') n.el.style.visibility = 'hidden'; if (!p) n.la = Math.min(n.la, target); return; }
      n.el.style.visibility = 'visible'; n.el.style.opacity = n.la.toFixed(3);
      n.el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
    };
    const hubSide = (h) => { const dx = h.sx - S.cx; return Math.abs(dx) < 24 ? 'd' : dx > 0 ? 'r' : 'l'; };
    const hubTarget = (h) => h.alpha * (0.3 + 0.7 * smooth(-0.55, 0.3, h.v[2])) * (L.any && !L.ns.has(h) ? 0.55 : 1);
    const front = hubs.filter((h) => h.v[2] > -0.25).sort((a, b) => b.v[2] - a.v[2]);
    const back = hubs.filter((h) => h.v[2] <= -0.25);
    for (const h of front) { h.el.style.zIndex = String(20 + Math.round(h.v[2] * 10)); show(h, place(h, hubSide(h), 11 * h.k, true), hubTarget(h)); }
    const hn = hot();
    const want = leaves.filter((n) => L.tags.has(n) && n.alpha > 0 && n.v[2] > -0.5)
      .sort((a, b) => ((b === hn || b === S.mark) - (a === hn || a === S.mark)) || (b.v[2] - a.v[2]));
    const shown = new Set();
    for (const n of want) {
      const dx = n.sx - n.hubNode.sx, dy = n.sy - n.hubNode.sy;
      const p = place(n, Math.abs(dx) < 10 ? (dy < 0 ? 'u' : 'd') : dx > 0 ? 'r' : 'l', 8 * n.k, false);
      n.el.classList.toggle('is-hot', hn === n || S.mark === n);
      n.el.style.zIndex = String(10 + Math.round(n.v[2] * 4));
      if (p) { shown.add(n); show(n, p, n.alpha * (0.4 + 0.6 * smooth(-0.45, 0.25, n.v[2]))); }
    }
    for (const n of leaves) if (!shown.has(n)) show(n, null, 0);
    for (const h of back) { h.el.style.zIndex = String(2); show(h, place(h, hubSide(h), 11 * h.k, false), hubTarget(h)); }   // far-side names give way
  }

  // my name and role shrink by different amounts, so the role stays readable once small
  const nameEl = core.querySelector('.map-name'), roleEl = core.querySelector('.map-role');
  let coreBig = null;
  function sizeCore(m) {
    if (!coreBig) {
      nameEl.style.fontSize = roleEl.style.fontSize = roleEl.style.marginTop = '';
      const a = getComputedStyle(nameEl), b = getComputedStyle(roleEl);
      coreBig = { n: parseFloat(a.fontSize), r: parseFloat(b.fontSize), g: parseFloat(b.marginTop) };
    }
    const B = coreBig, n1 = Math.max(22, Math.min(30, B.n * 0.42)), r1 = Math.max(12.5, Math.min(14, B.r * 0.74)), g1 = 3;
    nameEl.style.fontSize = (B.n + (n1 - B.n) * m).toFixed(2) + 'px';
    roleEl.style.fontSize = (B.r + (r1 - B.r) * m).toFixed(2) + 'px';
    roleEl.style.marginTop = (B.g + (g1 - B.g) * m).toFixed(2) + 'px';
    S.coreW = core.offsetWidth; S.coreH = core.offsetHeight;
  }

  // ------------------------------------------------------------------ the loop
  function frame(now) {
    S.raf = 0;
    if (!S.running) return;
    if (S.t0 === null) { S.t0 = now; S.it = reduce.matches ? 1e7 : 0; }
    const dt = Math.min(48, now - (S.last || now)); S.last = now;
    S.it += Math.min(dt, 34);   // the intro moves with drawn frames, so a busy moment pauses it instead of skipping it
    const it = S.it;
    // motion
    if (S.focus) {
      const t = clamp01((now - S.focus.t0) / S.focus.dur);
      S.q = qSlerp(S.focus.from, S.focus.to, easeInOut(t));
      if (t >= 1) S.focus = null;
    } else if (!drag) {
      if (Math.abs(S.vx) + Math.abs(S.vy) > 1e-6) { turn(S.vx * dt, S.vy * dt); const k = Math.exp(-dt / 330); S.vx *= k; S.vy *= k; } else { S.vx = S.vy = 0; }
      const may = !reduce.matches && !S.sel && !S.centered && !S.inside && now > S.idleUntil && it > T.spin && !root.contains(document.activeElement);
      S.spin += ((may ? 1 : 0) - S.spin) * (1 - Math.exp(-dt / (may ? 900 : 110)));   // eases in, but stops almost at once so a label holds still to be clicked
      if (S.spin > 0.001) turn(SPIN * S.spin * dt, 0);
    }
    const k = reduce.matches ? 1 : 1 - Math.exp(-dt / 150);
    S.open += ((S.sel ? 1 : 0) - S.open) * k;
    // my name steps back while the map turns or a point is chosen, so it never sits over what you are looking at
    const moving = (drag && drag.moved) || Math.abs(S.vx) + Math.abs(S.vy) > 2e-5 || !!S.focus;
    if (moving) S.quietAt = now + 1400;
    const hn = hot(), covered = !!hn && Math.abs(hn.sx - S.cx) < S.coreW / 2 + 12 && Math.abs(hn.sy - S.cy) < S.coreH / 2 + 12;
    const coreT = S.sel || S.centered ? 0 : moving || now < S.quietAt ? 0.12 : covered ? 0.15 : 1;
    S.coreA += (coreT - S.coreA) * (reduce.matches ? 1 : 1 - Math.exp(-dt / (coreT < S.coreA ? 80 : 320)));
    layout(easeInOut(clamp01(S.open)));
    // my name: full size, then smaller in the middle
    const mini = easeInOut(clamp01((it - T.hold) / T.shrink));
    if (mini !== S.mini || !coreBig) { S.mini = mini; sizeCore(mini); }
    core.style.transform = `translate(${S.cx.toFixed(1)}px, ${S.cy.toFixed(1)}px) translate(-50%, -50%)`;
    core.style.opacity = S.coreA.toFixed(3);
    const L = draw();
    labels(L, dt);
    if (!S.settled && it > T.end) { S.settled = true; document.dispatchEvent(new CustomEvent('mapsettled')); }
    if (S.running) S.raf = requestAnimationFrame(frame);
  }
  function kick() { if (S.running && !S.raf) S.raf = requestAnimationFrame(frame); }
  function setRunning(on) {
    if (on === S.running) return;
    S.running = on; S.last = 0;
    if (on) kick(); else if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  }

  readColors();
  resize();
  new ResizeObserver(resize).observe(stage);
  let seen = false;
  new IntersectionObserver((es) => { seen = es[0].isIntersecting; setRunning(seen && !document.hidden); }, { threshold: 0.01 }).observe(stage);
  document.addEventListener('visibilitychange', () => setRunning(seen && !document.hidden));

  // for the page's tests
  window.__map = {
    state: () => ({ sel: S.sel, open: S.open, started: S.t0 !== null, running: S.running, spin: S.spin, mark: S.mark && S.mark.id, core: S.coreA, q: S.q.slice() }),
    point: (id) => { const n = hubOf[id] || leafOf[id]; return n && { x: n.sx, y: n.sy, z: n.v[2], a: n.alpha }; },
    open: (id) => { const n = hubOf[id] || leafOf[id]; if (n) choose(n, false); },   // as if its point were clicked
    layout: () => ({ cx: S.cx, R: S.R, w: S.w }),
    done: () => S.t0 !== null && S.it > T.end,
    counts: () => ({ hubs: hubs.length, items: leaves.length, links: LONG.length }),
  };
})();
