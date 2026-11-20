# Tarun Kumar — portfolio

My personal site: research, projects and experience, with a live protein-folding simulation and a robot-arm demo. Live at https://tarunkumar.pages.dev.

It is one page (`dist/index.html`) with its pictures and scripts inlined. Beside it, `dist/models/panda.bin` is the robot model, fetched only when the robot demo opens, and `dist/og-image.png` is the picture LinkedIn and other sites show for a link to the site. Any static host can serve `dist/`.

## Layout

| Path | What it holds |
|---|---|
| `src/` | The page: `index.template.html`, `styles.css`, and the scripts (`app.js` for pages and drawings, `map.js` for the sphere map, `protein.js` and `protein-sim.js` for the folding simulation, `sim3d-core.js` for the robot cell's physics) |
| `assets/` | Pictures and logos, the resume PDF and the picture of it rendered for the Resume page, and the link-preview picture |
| `vendor/` | Third-party code and data: the Franka Emika Panda model and kinematics (MuJoCo Menagerie), cannon-es, three.js's RoomEnvironment, a copy of three.js r128 used only by the tests, and the Archivo font the link-preview picture is drawn in |
| `build.py` | Puts it all together into `dist/` |
| `dist/` | The built site, ready to publish as is |
| `tests/test_site.py` | Browser checks of the built page (Playwright) |
| `tools/` | Scripts that made the protein data, the figure renders and the link-preview picture |

## Build

```sh
python3 build.py
```

This writes `dist/index.html`, `dist/models/` (the robot model and its licence) and `dist/og-image.png`. It needs nothing beyond Python 3, except when the resume changes (below).

The build stops if the page passes 3,000,000 bytes, because LinkedIn shows no preview at all for a page over 3 MiB. If that happens, move something large out of the page into its own file, the way the robot model is.

## Link preview

LinkedIn, Slack and other sites read the `og:` tags at the top of the page and show `assets/og-image.png`: my name beside the home page's sphere map. To redraw it after changing the map, my name or my role:

```sh
python3 build.py && python3 tools/render_og.py && python3 build.py
```

LinkedIn keeps the preview it fetched before. After a change goes live, paste https://tarunkumar.pages.dev into LinkedIn's [Post Inspector](https://www.linkedin.com/post-inspector/) to make it fetch the page again. If the site moves to another address, change `SITE` in `build.py`.

## Update the resume

1. Replace `assets/Tarun_Kumar_Resume.pdf` with the new one (keep the name).
2. Run `pip install -r requirements.txt` once, then `python3 build.py`. The build sees the PDF is newer than its picture and redraws the Resume page.
3. Upload the same PDF to the Google Drive copy as a new version (right-click it, then File information, then Manage versions). The site's Resume buttons link there, and the link stays the same.

## Test

```sh
pip install playwright && playwright install chromium
python3 tests/test_site.py
```

The checks serve `dist/` on a local port, as the host does, and each prints `ok` or `FAIL`. Set `CHROME` to a Chrome binary to use it instead of Playwright's Chromium.

## Publish

Commit the source together with the rebuilt `dist/`. The host serves `dist/` with no build step, so the live site updates on every push.

## Credits

- Protein structures: AlphaFold DB models, CC BY 4.0, credited next to each on the page.
- Robot model: Franka Emika Panda from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie), Apache 2.0 (`vendor/LICENSE-franka-panda.txt`, also served as `models/LICENSE.txt`).
- [cannon-es](https://github.com/pmndrs/cannon-es) and [three.js](https://threejs.org), MIT.
- [Archivo](https://github.com/Omnibus-Type/Archivo), SIL Open Font License 1.1 (`vendor/fonts/LICENSE-archivo.txt`).
- The SEMI figure is from İnce et al., 2025, cited on the page.
