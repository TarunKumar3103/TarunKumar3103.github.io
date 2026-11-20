"""Draws the link-preview picture, assets/og-image.png (1200 x 630), that LinkedIn and other sites show for the page.

The sphere is the home page's own map, drawn by map.js in the built page; my name and role sit beside it.
Run it after build.py whenever the map, the name or the role changes, then run build.py again so dist/ gets
the new picture. It needs Playwright and Pillow (see README), and draws in Archivo from vendor/fonts.
"""
import asyncio, base64, io, os, pathlib, shutil, sys
from playwright.async_api import async_playwright
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'og-image.png'
W, H = 1200, 630
URL = (ROOT / 'dist' / 'index.html').as_uri()
THREE = (ROOT / 'vendor' / 'three.min.js').read_text()
FONT = base64.b64encode((ROOT / 'vendor' / 'fonts' / 'archivo-latin-standard-normal.woff2').read_bytes()).decode()
FONT_CSS = ("@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 100 900; font-stretch: 62% 125%; "
            f"src: url(data:font/woff2;base64,{FONT}) format('woff2'); }}")
CHROME = os.environ.get('CHROME') or shutil.which('google-chrome')
ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

# only the map stays, moved to the right; the name moves out of the sphere to the left, larger, to read at thumbnail size
CSS = """
.site-header, .site-footer, .skip, .map-hint, .map-core { display: none !important; }
html { background: var(--bg); }
html, body { overflow: hidden !important; }
body { visibility: hidden; }
#map, .og-text, .og-url { visibility: visible; }
#map { position: fixed !important; top: 0; bottom: 0; left: 500px; right: 0; margin: 0 !important; z-index: 50; background: var(--bg); }
#map .map-stage { height: 100vh !important; margin: 0 !important; }
.og-text { position: fixed; z-index: 60; left: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; color: var(--ink); }
.og-name { margin: 0; font-size: 116px; font-weight: 660; font-stretch: 110%; letter-spacing: -0.035em; line-height: 0.9; }
.og-role { margin: 30px 0 0; font-size: 30px; line-height: 1.2; color: var(--muted); letter-spacing: -0.005em; }
.og-url { position: fixed; z-index: 60; left: 80px; bottom: 44px; margin: 0; font-size: 21px; color: var(--faint); }
"""
TEXT = """() => { const d = document.createElement('div'); d.className = 'og-text';
  d.innerHTML = '<p class="og-name">Tarun<br>Kumar</p><p class="og-role">ML researcher and engineer</p>';
  const u = document.createElement('p'); u.className = 'og-url'; u.textContent = 'tarunkumar.pages.dev';
  document.body.append(d, u); }"""


async def render(theme, out):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=ARGS)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2, color_scheme=theme, reduced_motion='reduce')
        page = await ctx.new_page()
        await page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=FONT_CSS))
        await page.goto(URL)
        await page.wait_for_function('() => window.__map && window.__map.state().started', timeout=30000)
        await page.add_style_tag(content=CSS)
        await page.evaluate(TEXT)
        await page.evaluate('() => document.fonts.ready')
        await page.wait_for_timeout(1200)   # the map redraws for its new size
        png = await page.screenshot(type='png')
        await b.close()
    Image.open(io.BytesIO(png)).convert('RGB').resize((W, H), Image.LANCZOS).save(out, 'PNG', optimize=True)
    print('wrote', out.relative_to(ROOT) if out.is_relative_to(ROOT) else out, out.stat().st_size, 'bytes')


if __name__ == '__main__':
    theme = sys.argv[1] if len(sys.argv) > 1 else 'light'
    out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else OUT
    asyncio.run(render(theme, out))
