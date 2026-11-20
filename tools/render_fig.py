# Renders a still of one AlphaFold model with the page's own cartoon renderer, for the research figures.
# python3 render_fig.py <key> <first> <last> <theme> <out> [views|quat] [fill] [w h]
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
a, b = first - C['offset'], last - C['offset'] + 1
d = dict(key=key, label=key, name=C['name'], organism=C['organism'], entry=C['entry'], offset=first, seq=C['seq'][a:b], plddt=C['plddt'][a:b],
         ss=C['ss'][a:b], ca=C['ca'][a:b], ents=[], rep=None, T=[0.7, 1.4], view=[0, 0, 0, 1], cap='')
html = open(ROOT / 'dist' / 'index.html').read()
i = html.index('window.PROTEIN_DATA = '); j = html.index(';\n', i)
html = html[:i] + 'window.PROTEIN_DATA = ' + json.dumps([d]) + html[j:]
open(ROOT / 'dist' / 'render.html', 'w').write(html)
bg = '#ffffff' if theme == 'light' else '#121215'
CSS = f''':root, :root[data-theme] {{ --bg: {bg}; }} body {{ background: {bg}; }}
.pr-menu, .pr-state, .pr-legend, .pr-controls, .pr-term, .pr-tip {{ visibility: hidden !important; }}
.pr-box {{ width: {W}px !important; height: {H}px !important; }} .pr-stage {{ border-radius: 0; }}'''
if mode == 'views':
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
        await page.goto((ROOT / 'dist' / 'render.html').as_uri() + '#protein')
        await page.wait_for_function('() => window.__protein && window.__protein.ready()', timeout=30000)
        await page.evaluate("() => document.dispatchEvent(new Event('themechange'))")
        ims = []
        for name, q in views:
            await page.evaluate(f'() => window.__protein.pose({json.dumps(q)}, {fill})'); await page.wait_for_timeout(400)
            await page.locator('.pr-stage').screenshot(path='/tmp/r.png')
            im = Image.open('/tmp/r.png').convert('RGB')
            if mode == 'views':
                im = im.resize((im.width // 4, im.height // 4)); ImageDraw.Draw(im).text((6, 6), name, fill=(200, 0, 0))
            ims.append(im)
        await br.close()
        if mode == 'views':
            cw, ch = ims[0].size; cols = 4
            g = Image.new('RGB', (cw * cols, ch * ((len(ims) + cols - 1) // cols)), 'white')
            for k, im in enumerate(ims): g.paste(im, ((k % cols) * cw, (k // cols) * ch))
            g.save(out)
            print(json.dumps(views))
        else:
            ims[0].save(out); print('saved', out, ims[0].size)
asyncio.run(main())
