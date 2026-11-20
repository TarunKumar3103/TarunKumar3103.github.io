# Tarun Kumar — portfolio

My personal site: research, projects and experience, with a live protein-folding simulation and a robot-arm demo. It is one self-contained page (`dist/index.html`) with every image, model and script inlined, so any static host can serve it.

## Layout

| Path | What it holds |
|---|---|
| `src/` | The page: `index.template.html`, `styles.css`, and the scripts (`app.js` for pages and drawings, `map.js` for the sphere map, `protein.js` and `protein-sim.js` for the folding simulation, `sim3d-core.js` for the robot cell's physics) |
| `assets/` | Pictures and logos, the resume PDF and the picture of it rendered for the Resume page |
| `vendor/` | Third-party code and data: the Franka Emika Panda model and kinematics (MuJoCo Menagerie), cannon-es, three.js's RoomEnvironment, and a copy of three.js r128 used only by the tests |
| `build.py` | Puts it all together into `dist/` |
| `dist/` | The built site, ready to publish as is |
| `tests/test_site.py` | Browser checks of the built page (Playwright) |
| `tools/` | Scripts that made the protein data and the figure renders |

## Build

```sh
python3 build.py
```

This writes `dist/index.html` and `dist/models/LICENSE.txt`. It needs nothing beyond Python 3, except when the resume changes (below).

## Update the resume

1. Replace `assets/Tarun_Kumar_Resume.pdf` with the new one (keep the name).
2. Run `pip install -r requirements.txt` once, then `python3 build.py`. The build sees the PDF is newer than its picture and redraws the Resume page.
3. Upload the same PDF to the Google Drive copy as a new version (right-click it, then File information, then Manage versions). The site's Resume buttons link there, and the link stays the same.

## Test

```sh
pip install playwright && playwright install chromium
python3 tests/test_site.py
```

Each check prints `ok` or `FAIL`. Set `CHROME` to a Chrome binary to use it instead of Playwright's Chromium.

## Publish

Commit the source together with the rebuilt `dist/`. The host serves `dist/` with no build step, so the live site updates on every push.

## Credits

- Protein structures: AlphaFold DB models, CC BY 4.0, credited next to each on the page.
- Robot model: Franka Emika Panda from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie), Apache 2.0 (`vendor/LICENSE-franka-panda.txt`, also served as `models/LICENSE.txt`).
- [cannon-es](https://github.com/pmndrs/cannon-es) and [three.js](https://threejs.org), MIT.
- The SEMI figure is from İnce et al., 2025, cited on the page.
