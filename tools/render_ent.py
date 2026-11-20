# Like render_fig.py, but with the protein's native entanglements, so the threaded loop is drawn (for the NCEMS project picture).
# python3 render_ent.py <key> <first> <last> <theme> <out> [views|quat] [fill] [w h]; ENTS and REP below are 0-based in the trimmed chain
import asyncio, sys, json, re, subprocess, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'protein'))
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
from build_data import view
THREE = open(ROOT / 'vendor' / 'three.min.js').read()
ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
key, first, last, theme, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
mode = sys.argv[6] if len(sys.argv) > 6 else 'views'
fill = float(sys.argv[7]) if len(sys.argv) > 7 else 0.95
W, H = (int(sys.argv[8]), int(sys.argv[9])) if len(sys.argv) > 9 else (800, 600)
C = json.load(open(ROOT / 'tools' / 'protein' / 'cands.json'))[key]
ENTS = [[13, 229, 'C', -1.23], [13, 230, 'C', -1.23], [14, 229, 'C', -1.21], [15, 229, 'C', -1.17], [63, 95, 'C', -0.91], [63, 96, 'C', -0.83], [66, 96, 'C', -0.85], [117, 216, 'C', 0.71]]
REP = [63, 95, 'C', -0.91]   # residues 90-122, threaded by the C-terminal chain
PLAN = json.load(open(ROOT / 'tools' / 'mbp-plan.json'))
ROLE = {'light': {'rest': [180, 186, 196], 'loop': [124, 58, 237], 'thread': [249, 115, 22]},
        'dark': {'rest': [92, 96, 106], 'loop': [167, 139, 250], 'thread': [251, 146, 60]}}[theme]
PAINT = [ROLE[r] for r in PLAN['paint']]
a, b = first - C['offset'], last - C['offset'] + 1
d = dict(key=key, label=key, name=C['name'], organism=C['organism'], entry=C['entry'], offset=first, seq=C['seq'][a:b], plddt=C['plddt'][a:b],
         ss=C['ss'][a:b], ca=C['ca'][a:b], ents=ENTS, rep=REP, T=[0.7, 1.4], view=[0, 0, 0, 1], cap='', paint=PAINT)
html = open(ROOT / 'dist' / 'index.html').read()
i = html.index('window.PROTEIN_DATA = '); j = html.index(';\n', i)
html = html[:i] + 'window.PROTEIN_DATA = ' + json.dumps([d]) + html[j:]
line = 'afColor(resVal[i] + (resVal[i + 1] - resVal[i]) * u, sc, 0);'
assert html.count(line) == 1
lin = "const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };"
html = html.replace(line, '{ ' + lin + ' const p0 = D.paint[i], p1 = D.paint[Math.min(N - 1, i + 1)]; for (let q = 0; q < 3; q++) sc[q] = lin(p0[q] + (p1[q] - p0[q]) * smooth(0.35, 0.65, u)); }')
open(ROOT / 'dist' / 'render-ent.html', 'w').write(html)
bg = '#ffffff' if theme == 'light' else '#121215'
CSS = f''':root, :root[data-theme] {{ --bg: {bg}; }} body {{ background: {bg}; }}
.pr-menu, .pr-state, .pr-legend, .pr-controls, .pr-term, .pr-tip {{ visibility: hidden !important; }}
.pr-box {{ width: {W}px !important; height: {H}px !important; }} .pr-stage {{ border-radius: 0; }}'''
if mode == 'plan':
    views = [(n, q) for n, q in PLAN['views']]
elif mode == 'views':
    X = C['ca'][a:b]
    views = []
    for axes in ('long-x', 'long-y'):
        for tx, ty in [(0.25, -0.45), (-0.35, 0.5), (0.6, 0.9), (0.15, 2.6), (-0.2, 3.6), (0.5, -1.4)]:
            views.append((f'{axes} {tx},{ty}', view(X, tx, ty, axes)))
else:
    views = [('chosen', json.loads(mode))]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
        ctx = await br.new_context(viewport={'width': W + 80, 'height': H + 400}, device_scale_factor=2, reduced_motion='reduce', color_scheme=theme)
        page = await ctx.new_page()
        await page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await page.add_init_script(f"try{{localStorage.setItem('theme','{theme}')}}catch(e){{}}")
        await page.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = " + json.dumps(CSS) + "; document.head.appendChild(s); });")
        await page.goto((ROOT / 'dist' / 'render-ent.html').as_uri() + '#protein')
        await page.wait_for_function('() => window.__protein && window.__protein.ready()', timeout=30000)
        await page.evaluate("() => document.dispatchEvent(new Event('themechange'))")
        ims = []
        for name, q in views:
            await page.evaluate(f'() => window.__protein.pose({json.dumps(q)}, {fill})'); await page.wait_for_timeout(400)
            await page.locator('.pr-stage').screenshot(path='/tmp/r.png')
            im = Image.open('/tmp/r.png').convert('RGB')
            if mode in ('views', 'plan'):
                im = im.resize((im.width // 4, im.height // 4)); ImageDraw.Draw(im).text((6, 6), name, fill=(200, 0, 0))
            ims.append(im)
        await br.close()
        if mode in ('views', 'plan'):
            cw, ch = ims[0].size; cols = 4
            g = Image.new('RGB', (cw * cols, ch * ((len(ims) + cols - 1) // cols)), 'white')
            for k, im in enumerate(ims): g.paste(im, ((k % cols) * cw, (k // cols) * ch))
            g.save(out)
            print(json.dumps(views))
        else:
            ims[0].save(out); print('saved', out, ims[0].size)
asyncio.run(main())
