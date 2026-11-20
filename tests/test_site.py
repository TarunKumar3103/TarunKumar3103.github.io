import asyncio, functools, http.server, json, os, pathlib, shutil, threading
from playwright.async_api import async_playwright
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[1]
THREE = (ROOT / 'vendor' / 'three.min.js').read_text()   # the page loads three.js r128 from cdnjs; tests serve this copy
ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
SITE = 'https://tarunkumar3103.github.io/'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
# dist/ is served over HTTP as the host serves it, since the page fetches the robot model from models/
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_address[1]}/index.html'
CHROME = os.environ.get('CHROME') or shutil.which('google-chrome')   # None: Playwright's own Chromium
def ok(cond, what, extra=''): print('ok  ' if cond else 'FAIL', what, extra)
BOXED_IN = """(both) => {
  const c = __cell, D2R = Math.PI / 180, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const byId = (id) => c.boxes.find((b) => b.id === id);
  const put = (id, x, z, yaw) => { const b = byId(id), body = b.body; body.position.set(x, b.size / 2 + 0.0005, z);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -yaw); body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0); body.wakeUp(); };
  const th = 100 * D2R, r = 0.42, tx = r * Math.cos(th), tz = r * Math.sin(th);
  put('b4', tx, tz, 0); for (let i = 0; i < 30; i++) c.step(1 / 60);
  const i = c.boxInfo(byId('b4')), w0 = wrap(4 * (i.yaw - th - c.NOMINAL)) / 4, ba = th + c.NOMINAL + w0;
  const u = [Math.cos(ba), Math.sin(ba)], v = [-Math.sin(ba), Math.cos(ba)];
  put('b1', tx + u[0] * 0.0725, tz + u[1] * 0.0725, -ba); put('b2', tx + v[0] * 0.0675, tz + v[1] * 0.0675, -ba);
  for (let k = 0; k < 90; k++) c.step(1 / 60);
  const b = c.boxInfo(byId('b4')); return __cellScreen(b.x, b.top, b.z);
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 860}, color_scheme='light')
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
        await page.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
        await page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await page.goto(URL)
        await page.wait_for_function('() => window.__map && window.__map.state().started', timeout=30000)
        ok(await page.evaluate("() => !window.__armReady"), 'the home page does not load the robot at all')
        await page.evaluate("() => { location.hash = '#cell'; }")
        await page.wait_for_function('() => window.__armReady && window.__armReady()', timeout=60000)
        ev = page.evaluate
        ok(await ev("() => document.getElementById('robot-demo').open && location.hash === '#cell'"), 'the robot cell opens in its dialog')
        sw = lambda: ev("() => [document.getElementById('ap-toggle').getAttribute('aria-checked'), document.getElementById('ap-state').textContent]")
        cap = lambda: ev("() => [document.getElementById('ap-note').textContent, document.getElementById('ap-note').classList.contains('is-notice')]")

        # robot cell: switch, picking, placing
        ok(await sw() == ['true', 'On'] and (await cap())[0].startswith('Click a box'), 'starts on autopilot with the caption under the cell', await cap())
        await page.click('#ap-toggle'); await page.wait_for_timeout(200)
        ok(await sw() == ['false', 'Off'] and await ev('() => __cell.state.holdManual'), 'the switch turns autopilot off and holds it')
        pt = await ev("() => { const i = __cell.boxInfo(__cell.boxes[1]); return __cellScreen(i.x, i.top, i.z); }")
        await page.mouse.click(pt['x'], pt['y'])
        await ev("() => { for (let i = 0; i < 60 * 8 && !(__cell.state.held && !__cell._man.active); i++) __cell.step(1 / 60); }")
        ok(await ev("() => __cell.state.held && __cell.state.held.id") == 'b2', 'clicking a box picks it up')
        tgt = await ev("() => __cellScreen(0.258, 0, 0.369)")
        await page.mouse.click(tgt['x'], tgt['y'])
        await ev("() => { for (let i = 0; i < 60 * 8 && (__cell.state.held || __cell._man.active); i++) __cell.step(1 / 60); }")
        land = await ev("() => { const i = __cell.boxInfo(__cell.boxes[1]); return [+i.x.toFixed(3), +i.z.toFixed(3), i.upright]; }")
        ok(abs(land[0] - 0.258) < 0.01 and abs(land[1] - 0.369) < 0.01 and land[2], 'clicking the bench puts it down there', land)
        # a boxed-in box: the notice replaces the caption, in amber, then the caption returns
        pt = await ev(BOXED_IN, True)
        pre = await ev("(pt) => ({ els: document.elementsFromPoint(pt.x, pt.y).slice(0, 2).map(e => e.id || e.className), mode: __cell.state.mode, hold: __cell.state.holdManual, man: __cell._man.active, held: __cell.state.held && __cell.state.held.id, t: +__cell.state.time.toFixed(2) })", pt)
        await page.mouse.click(pt['x'], pt['y']); await page.wait_for_timeout(250)
        c1 = await cap()
        if not c1[1]:
            post = await ev("() => ({ mode: __cell.state.mode, man: __cell._man.active, box: __cell._man.box && __cell._man.box.id, notice: __cell.state.notice, noticeAge: +(__cell.state.time - __cell.state.noticeT).toFixed(2), t: +__cell.state.time.toFixed(2) })")
            print('     before click', json.dumps(pre), 'pt', json.dumps(pt)); print('     after click', json.dumps(post))
        ok(c1 == ["Can't reach it, another box is in the way", True], 'a blocked pick explains itself in the caption', c1)
        await ev("() => { for (let i = 0; i < 60 * 3; i++) __cell.step(1 / 60); }"); await page.wait_for_timeout(300)
        ok((await cap())[0].startswith('Click a box') and not (await cap())[1], 'and the caption comes back after it')
        # keyboard: tabbing to the cell shows the keys
        await page.focus('#ap-toggle'); await page.keyboard.press('Shift+Tab'); await page.wait_for_timeout(250)
        ok(await ev('() => document.activeElement.id') == 'stage' and 'Arrow keys' in (await cap())[0], 'tabbing to the cell shows the keys in the caption')
        await page.click('#ap-toggle'); await page.wait_for_timeout(200)
        ok(await sw() == ['true', 'On'], 'switching back on resumes autopilot')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
        t1 = await ev('() => __cell.state.time'); await page.wait_for_timeout(800); t2 = await ev('() => __cell.state.time')
        st = await ev("() => [document.getElementById('robot-demo').open, location.hash]")
        ok(not st[0] and st[1] == '#p-cell' and t1 == t2, 'Escape closes the dialog and the arm stops', [st, t1, t2])

        # theme: header flip, saved choice, footer three-way switch
        await page.click('#theme-flip'); await page.wait_for_timeout(300)
        th = await ev("() => [document.documentElement.dataset.theme, localStorage.getItem('tk-theme'), document.getElementById('theme-flip').getAttribute('aria-label'), getComputedStyle(document.body).backgroundColor]")
        ok(th[0] == 'dark' and th[1] == 'dark' and 'light' in th[2] and th[3] == 'rgb(11, 11, 13)', 'the header button switches to dark and remembers it', th)
        await page.reload(); await page.wait_for_function('() => window.__map && window.__map.state().started', timeout=30000)
        ok(await ev("() => document.documentElement.dataset.theme") == 'dark', 'dark survives a reload')
        await page.click('[data-theme-set="system"]'); await page.wait_for_timeout(300)
        th = await ev("() => [document.documentElement.dataset.theme, localStorage.getItem('tk-theme'), document.querySelector('[data-theme-set=system]').getAttribute('aria-pressed')]")
        ok(th == ['light', None, 'true'], 'System follows the computer (light here) and forgets the saved choice', th)

        # no search: the site is small enough to browse
        await page.keyboard.press('Control+k'); await page.wait_for_timeout(200)
        await page.keyboard.press('/'); await page.wait_for_timeout(150)
        st = await ev("() => [document.querySelectorAll('[data-open-search], #cmdk, .cmdk').length, document.querySelectorAll('.tools .icon-btn').length, document.querySelectorAll('.dock .icon-btn').length]")
        ok(st == [0, 1, 1], 'there is no search button or palette, and Ctrl+K and / do nothing', st)
        await ev("() => { location.hash = '#p-ferrite'; }"); await page.wait_for_timeout(700)
        try: await page.wait_for_function("() => { const t = document.getElementById('p-ferrite').getBoundingClientRect().top; return t >= 0 && t < 120; }", timeout=3000)
        except Exception: pass
        st = await ev("() => [[...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).map(p => p.dataset.page), Math.round(document.getElementById('p-ferrite').getBoundingClientRect().top)]")
        ok(st[0] == ['projects'] and 0 <= st[1] < 120, 'a link to #p-ferrite opens Ferrite on the Projects page', st)

        # pages and links
        await page.click('[data-page="projects"] [data-open-robot]'); await page.wait_for_timeout(900)
        t1 = await ev('() => __cell.state.time'); await page.wait_for_timeout(1000); t2 = await ev('() => __cell.state.time')
        st = await ev("() => [document.getElementById('robot-demo').open, location.hash, [...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).map(p => p.dataset.page)]")
        ok(st[0] and st[2] == ['projects'] and t2 > t1, 'Live demo opens the arm in a dialog over the page you are on, and it runs', [st, t1, t2])
        await page.click('#robot-demo [data-close]'); await page.wait_for_timeout(300)
        t1 = await ev('() => __cell.state.time'); await page.wait_for_timeout(800); t2 = await ev('() => __cell.state.time')
        ok(not await ev("() => document.getElementById('robot-demo').open") and t1 == t2, 'its close button closes it and the arm stops')
        await page.click('.site-nav a[data-nav="research"]'); await page.wait_for_timeout(500)
        st = await ev("() => [document.title, document.querySelector('[data-nav=research]').getAttribute('aria-current'), [...document.querySelectorAll('[data-page=research] canvas[data-viz]')].every(c => c.width > 0)]")
        ok(st[0] == 'Research | Tarun Kumar' and st[1] == 'page' and st[2], 'Research opens, is marked current, drawings painted', st)
        await ev("() => { location.hash = '#r-cvae'; }"); await page.wait_for_timeout(900)
        ok(0 <= await ev("() => document.getElementById('r-cvae').getBoundingClientRect().top") < 120, 'a link to #r-cvae lands on that entry')
        await page.click('.id'); await page.wait_for_timeout(500)
        ok(await ev("() => !document.querySelector('[data-page=home]').hidden && document.title === 'Tarun Kumar'"), 'the name goes back home')
        # dock: hidden at the top, there after scrolling, and back to top works
        await ev("() => window.scrollTo(0, 0)"); await page.wait_for_timeout(300)
        hid = await ev("() => getComputedStyle(document.querySelector('.dock')).visibility")
        await ev("() => window.scrollTo(0, 1600)"); await page.wait_for_timeout(400)
        vis = await ev("() => getComputedStyle(document.querySelector('.dock')).visibility")
        await page.click('#to-top'); await page.wait_for_timeout(1200)
        ok(hid == 'hidden' and vis == 'visible' and await ev('() => window.scrollY') < 5, 'the dock appears after scrolling and goes back to the top', [hid, vis])
        # the map at the top of the home page
        await page.wait_for_function('() => window.__map.done()', timeout=15000)
        st = await ev("() => [window.__map.counts(), window.__map.done(), parseFloat(getComputedStyle(document.querySelector('.map-name')).fontSize), [...document.querySelectorAll('.map-hub')].length]")
        ok(st[0] == {'hubs': 8, 'items': 38, 'links': 16} and st[1] and st[2] <= 32 and st[3] == 8, 'the map has eight groups and 38 items, with my name shrunk in the middle', st)
        box = await page.locator('.map-stage').bounding_box()
        q0 = await ev('() => window.__map.state().q')
        cols = await ev("() => [[...new Set([...document.querySelectorAll('.map-hub')].map(b => getComputedStyle(b).color))], getComputedStyle(document.body).color, ['exp', 'res', 'pap', 'proj', 'comp', 'skill', 'edu', 'cert'].map(k => getComputedStyle(document.documentElement).getPropertyValue('--c-' + k).trim())]")
        ok(cols[0] == [cols[1]] and len(set(cols[2])) == 8 and cols[2][0] == '#e5484d' and cols[2][1] == '#30a46c', 'each group has its own colour (Experience red, Research green) and the words stay black', cols)
        await page.mouse.move(box['x'] + 40, box['y'] + box['height'] * 0.9); await page.mouse.down()
        await page.mouse.move(box['x'] + 260, box['y'] + box['height'] * 0.85, steps=8); await page.wait_for_timeout(250)
        faint = float(await ev("() => getComputedStyle(document.querySelector('.map-core')).opacity"))
        await page.mouse.up(); await page.wait_for_timeout(200)
        q1 = await ev('() => window.__map.state().q')
        ok(q0 != q1 and await ev('() => window.__map.state().sel') is None and faint < 0.3, 'dragging turns the map and fades my name out of the way', faint)
        await page.wait_for_function("() => parseFloat(getComputedStyle(document.querySelector('.map-core')).opacity) > 0.9", timeout=8000)
        ok(True, 'my name comes back once the map settles')
        await page.locator('.map-hub', has_text='Research').click(); await page.wait_for_timeout(1000)
        st = await ev("() => [!document.getElementById('map-card').hidden, document.getElementById('mc-t').textContent, document.querySelectorAll('#map-card .mc-item').length, window.__map.state().sel, window.__map.point('res').z, [...document.querySelectorAll('.map-hub')].find(b => b.textContent.startsWith('Research')).getAttribute('aria-expanded')]")
        ok(st[0] and st[1] == 'Research' and st[2] == 5 and st[3] == 'res' and st[4] > 0.95 and st[5] == 'true', 'choosing Research turns it to the front and lists its five projects', st)
        ok(float(await ev("() => getComputedStyle(document.querySelector('.map-core')).opacity")) < 0.05, 'my name is out of the way while a group is open')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(250)
        st = await ev("() => [document.getElementById('map-card').hidden, document.activeElement.className, document.activeElement.textContent]")
        ok(st[0] and st[1] == 'map-hub' and st[2].startswith('Research'), 'Escape closes the card and returns to the Research label', st)
        await page.keyboard.press('Enter'); await page.wait_for_timeout(400)
        ok(await ev("() => document.activeElement.id === 'mc-t' && !document.getElementById('map-card').hidden"), 'Enter on a label opens the card and moves focus into it')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
        # the map holds what the home page used to list: each group with its logos and pictures, each item in full
        await page.locator('.map-hub', has_text='Experience').click(); await page.wait_for_timeout(900)
        items = await ev("""() => [...document.querySelectorAll('#map-card .mc-item')].map(b => [b.dataset.node, b.matches('button.card.row-exp') && !!b.querySelector('.mark.logo') && getComputedStyle(b.querySelector('.mark.logo')).backgroundImage.startsWith('url("data:image/png'), !!b.querySelector('.row-when')])""")
        ok(len(items) == 10 and all(i[1] and i[2] for i in items) and len({i[0] for i in items}) == 9, 'the Experience group lists all ten roles as the home page did: logo, role, place and dates', [i[0] for i in items])
        lay = await ev("() => { const c = document.getElementById('map-card').getBoundingClientRect(), s = document.querySelector('.map-stage').getBoundingClientRect(), L = window.__map.layout(), W = document.documentElement.clientWidth; return [Math.round(c.width), Math.round(s.left + L.cx - L.R), Math.round(W - c.right), Math.round(L.R), Math.round(c.left - (s.left + L.cx + L.R))]; }")
        ok(lay[0] >= 580 and abs(lay[1] - lay[2]) <= 2 and lay[1] > 60 and lay[3] >= 170 and lay[4] >= 60, 'the card is wide, and the sphere sits as far from the left edge as the card does from the right', lay)
        await ev("() => window.__map.open('comp')"); await page.wait_for_timeout(700)
        st = await ev("() => [document.getElementById('map-card').offsetWidth, [...document.querySelectorAll('#map-card .mc-item')].map(t => Math.round(t.getBoundingClientRect().top))]")
        per = 3 if st[0] >= 680 else 2
        ok(len(st[1]) == 5 and all(st[1][i] == st[1][i - i % per] for i in range(5)) and st[1][per] > st[1][0], f'the competitions are tiles, {per} to a row at this width', st)
        await ev("() => window.__map.open('cert')"); await page.wait_for_timeout(700)
        st = await ev("""() => [...document.querySelectorAll('#map-card .mc-item'), ...document.querySelectorAll('#certifications li')].map(r => { const m = r.querySelector('.mark.logo'); return [r.dataset.node || r.id, m ? [...m.classList].find(c => c.startsWith('logo-')) : null, !!m && getComputedStyle(m).backgroundImage.startsWith('url("data:image/png')]; })""")
        ok([x[1] for x in st] == ['logo-anthropic', 'logo-anthropic', 'logo-canvas'] * 2 and all(x[2] for x in st), 'certifications show their issuer: Anthropic twice, Canvas for the bootcamp, in the card and on the Experience page', st)
        await ev("() => [...document.querySelectorAll('.map-hub')].find(b => b.textContent.startsWith('Experience')).click()"); await page.wait_for_timeout(900)
        await page.click('#map-card .mc-item[data-node="x-ncems"]'); await page.wait_for_timeout(700)
        st = await ev("() => { const d = document.querySelector('#map-card .mc-detail'); return [d.hidden, d.querySelector('.row-t').textContent, d.querySelectorAll('li').length, !document.querySelector('#map-card .mc-back').hidden, document.querySelector('#map-card .mc-more').getAttribute('href'), window.__map.state().mark, d.querySelectorAll('[id]').length, !!d.querySelector('.mark.logo-ncems')]; }")
        ok(not st[0] and st[1].startswith('Research Intern') and st[2] >= 3 and st[3] and st[4] == '#x-ncems' and st[5] == 'x-ncems' and st[6] == 0 and st[7], 'choosing a role shows everything the Experience page says about it, with its logo', st)
        await page.click('#map-card .mc-back'); await page.wait_for_timeout(300)
        ok(await ev("() => !document.querySelector('#map-card .mc-list').hidden && document.activeElement.dataset.node === 'x-ncems'"), 'the back arrow returns to the list, on the same role')
        await page.locator('#map-card .mc-item[data-node="x-nittany"]').nth(1).click(); await page.wait_for_timeout(500)
        st = await ev("() => [[...document.querySelectorAll('#map-card .mc-detail .row-t')].map(e => e.textContent), document.querySelector('#map-card .mc-more').getAttribute('href'), window.__map.state().mark]")
        ok(st == [['Machine Learning Intern'], '#x-nittany', 'x-nittany'], 'each Nittany AI Alliance internship opens on its own', st)
        await page.click('#map-card .mc-back'); await page.wait_for_timeout(300)
        ok(await ev("() => document.activeElement.dataset.src === 'x-nittany'"), 'and the back arrow returns to that same row')
        await ev("() => window.__map.open('x-nittany')"); await page.wait_for_timeout(600)
        st = await ev("() => [...document.querySelectorAll('#map-card .mc-detail .row-t')].map(e => e.textContent)")
        ok(st == ['Advanced Machine Learning Intern', 'Machine Learning Intern'], "the Nittany AI Alliance's point on the map shows both internships", st)
        await page.click('#map-card .mc-back'); await page.wait_for_timeout(300)
        await page.click('#map-card .mc-item[data-node="x-ncems"]'); await page.wait_for_timeout(500)
        await page.click('#map-card .mc-more'); await page.wait_for_timeout(900)
        st = await ev("() => [location.hash, [...document.querySelectorAll('[data-page]')].filter(p => !p.hidden).map(p => p.dataset.page), Math.round(document.getElementById('x-ncems').getBoundingClientRect().top)]")
        ok(st[0] == '#x-ncems' and st[1] == ['experience'] and 0 <= st[2] < 120, 'and its link opens that role on the Experience page', st)
        await ev("() => { location.hash = '#home'; }"); await page.wait_for_timeout(900)
        secs = await ev("() => { const p = document.querySelector('.why-t'); return [[...document.querySelectorAll('[data-page=home] .sec h2')].map(h => h.textContent), Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)), p.textContent.slice(0, 8), !!document.querySelector('[data-page=home] .comp-tiles')]; }")
        ok(secs[0] == ['Why I built it', 'Connect'] and 3 <= secs[1] <= 4 and secs[2] == 'At NCEMS' and not secs[3], 'below the protein, a short why in four lines, then Connect; no repeated sections or competition tiles', secs)
        await page.locator('.map-hub', has_text='Research').click(); await page.wait_for_timeout(1000)
        th = await ev("""() => [...document.querySelectorAll('#map-card .mc-item')].map(b => { const m = b.querySelector('.thumb'); if (!m) return 'none'; const c = m.querySelector('canvas');
          return [c ? (c.width !== 300 ? 'drawn' : 'blank') : (getComputedStyle(m).backgroundImage.startsWith('url("data:image/webp') ? 'figure' : 'other'), Math.round(m.getBoundingClientRect().width), b.querySelectorAll('.tag').length]; })""")
        ok([t[0] for t in th] == ['drawn', 'figure', 'figure', 'figure', 'figure'] and all(t[1] >= 150 and t[2] == 3 for t in th), 'each research project is listed as on the old home page, with a large picture and its tags', th)
        await page.click('#map-card .mc-item[data-node="r-cvae"]'); await page.wait_for_timeout(500)
        await page.click('#map-card .mc-detail .fig-img'); await page.wait_for_timeout(400)
        fb = await ev("() => [document.getElementById('figbox').open, document.querySelector('.figbox-img').className]")
        ok(fb[0] and fb[1].endswith('fig-vae'), 'a figure in the card opens larger, like on the Research page', fb)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        await page.locator('.map-hub', has_text='Projects').click(); await page.wait_for_timeout(900)
        st = await ev("() => [[...document.querySelectorAll('#map-card .mc-item')].map(e => e.dataset.node), [...document.querySelectorAll('#map-card .proj .thumb-lg')].map(t => Math.round(t.getBoundingClientRect().width))]")
        ok(st[0] == ['p-gemma', 'p-ferrite', 'p-ncle', 'p-cell', 'p-social', 'p-iphone', 'p-robot', 'p-pride', 'p-local'] and len(st[1]) == 7 and min(st[1]) >= 150, 'Projects lists the seven project cards with their pictures, then the two smaller ones', st)
        st = await ev("""() => [...document.querySelectorAll('#map-card .thumb-img')].map(t => [t.closest('[data-node]').dataset.node, getComputedStyle(t).backgroundImage.startsWith('url("data:image/webp')])""")
        ok([x[0] for x in st] == ['p-gemma', 'p-ferrite', 'p-ncle', 'p-social', 'p-iphone'] and all(x[1] for x in st), 'the Gemma banner, the two renders and the two app screenshots show as pictures', st)
        st = await ev("""() => ['p-social', 'p-iphone'].map(n => { const a = document.querySelector(`#map-card .mc-item[data-node="${n}"] a.btn-sm`); if (!a) return [n, null, false]; a.scrollIntoView({block: 'center'}); const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [n, a.href, !!hit && a.contains(hit)]; })""")
        ok(st[0][1] is None and st[1][1] == 'https://merry-biscochitos-b3dcb8.netlify.app/' and st[1][2], "Snapgram has no live link for now, and the iPhone card's live link sits above the clickable card", st)
        st = await ev("() => [...document.querySelectorAll('#p-social .btns a')].map(a => a.href)")
        ok(st == ['https://github.com/TarunKumar3103/Social-Media-Application'], 'the Snapgram entry on the Projects page links only the code', st)
        await page.click('#map-card .mc-item[data-node="p-cell"] [data-open-robot]'); await page.wait_for_timeout(900)
        ok(await ev("() => document.getElementById('robot-demo').open && document.querySelector('#map-card .mc-detail').hidden"), "the robot cell's Live demo button works right in the list")
        await page.click('#robot-demo [data-close]'); await page.wait_for_timeout(300)
        await ev("() => { location.hash = '#home'; }"); await page.wait_for_timeout(900)
        await page.click('#map-card .mc-item[data-node="p-cell"]'); await page.wait_for_timeout(500)
        await page.click('#map-card .mc-detail [data-open-robot]'); await page.wait_for_timeout(900)
        ok(await ev("() => document.getElementById('robot-demo').open"), "the robot cell's Live demo works from the card")
        await page.click('#robot-demo [data-close]'); await page.wait_for_timeout(300)
        await ev("() => { location.hash = '#home'; }"); await page.wait_for_timeout(900)
        await page.locator('.map-hub', has_text='Projects').click(); await page.wait_for_timeout(900)
        box = await page.locator('.map-stage').bounding_box()
        await page.mouse.click(box['x'] + 30, box['y'] + box['height'] - 30); await page.wait_for_timeout(300)
        ok(await ev("() => document.getElementById('map-card').hidden && window.__map.state().sel === null"), 'clicking empty space closes the card')
        rm = await b.new_context(viewport={'width': 1280, 'height': 860}, reduced_motion='reduce')
        rp = await rm.new_page()
        await rp.route('**/three.min.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=THREE))
        await rp.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await rp.goto(URL); await rp.wait_for_function('() => window.__map && window.__map.state().started', timeout=20000)
        await rp.wait_for_timeout(1200)
        st = await rp.evaluate('() => [window.__map.done(), window.__map.state().spin]')
        ok(st[0] and st[1] < 0.001, 'with reduced motion the map appears whole and stays still', st)
        await rm.close()

        # the proteins under the map
        await ev("() => { location.hash = '#protein'; }"); await page.wait_for_timeout(900)
        await page.wait_for_function('() => window.__protein && window.__protein.ready()', timeout=30000)
        st = await ev('() => window.__protein.state()')
        menu = await ev("() => [...document.querySelectorAll('.pr-menu [role=radio]')].map(b => [b.textContent, b.getAttribute('aria-checked')])")
        ok([m[0] for m in menu] == ['Thioredoxin', 'Ubiquitin', 'Myoglobin', 'GFP'] and menu[0][1] == 'true', 'a menu over the picture lists four proteins, thioredoxin first', menu)
        title = await ev("() => document.querySelector('.pr-title').textContent")
        ok(st['worker'] and st['key'] == 'trx' and not st['sim'] and st['ent'] and (st['ent']['i'], st['ent']['j']) == (33, 73) and st['status'] == 'Folded: As AlphaFold predicted it'
           and title == 'Coarse-grained simulation' and 'thioredoxin' in st['caption'] and 'Drag to turn it, grab the chain to pull on it, or turn on the heat' in st['caption'],
           'it starts still, as AlphaFold predicted it, under the title and a caption naming it and what to do', [st['key'], st['status'], title, st['caption']])
        # the protein sits in a box: a black bar on top with the menu and the state, a black one below with the title and caption;
        # the site's header is a black bar too
        lay = await ev("""() => { const cs = (s) => getComputedStyle(document.querySelector(s)), r = (s) => document.querySelector(s).getBoundingClientRect(), bar = r('.pr-bar'), box = r('.pr-box'), foot = r('.pr-foot');
          return { bar: cs('.pr-bar').backgroundColor, foot: cs('.pr-foot').backgroundColor, title: cs('.pr-title').color, menu: cs('.pr-menu [aria-checked=true]').color,
            menuIn: r('.pr-menu').top >= bar.top - 1 && r('.pr-menu').bottom <= bar.bottom + 1 && r('.pr-menu').left - bar.left < 30,
            stateIn: r('.pr-state').top >= bar.top - 1 && r('.pr-state').bottom <= bar.bottom + 1 && bar.right - r('.pr-state').right < 30,
            order: bar.bottom <= box.top + 1 && box.bottom <= foot.top + 1, stateSize: parseFloat(cs('.pr-state-d').fontSize), controls: box.bottom - r('.pr-controls').bottom,
            header: cs('.site-header').backgroundColor, name: cs('.id-name').color, nav: cs('.site-nav a').color }; }""")
        ok(lay['bar'] == lay['foot'] == lay['header'] == 'rgb(0, 0, 0)' and lay['title'] == lay['menu'] == lay['name'] == 'rgb(255, 255, 255)' and lay['menuIn'] and lay['stateIn'] and lay['order']
           and lay['stateSize'] <= 13 and lay['controls'] < 16, 'the protein sits in a box between black bars, menu and state on top, title and caption below; the header is black with white text', lay)
        # about three quarters of the space: the chain spans well under the stage's height
        span = await ev("""() => { const P = window.__protein, N = P.state().N, H = document.querySelector('.pr-stage').getBoundingClientRect().height; let lo = 1e9, hi = -1e9;
          for (let i = 0; i < N; i++) { const p = P.screen(i); lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } return (hi - lo) / H; }""")
        ok(0.45 < span < 0.82, 'the protein takes about three quarters of the height, not all of it', round(span, 2))
        sb = await page.locator('.pr-stage').bounding_box()
        await page.mouse.move(sb['x'] + 30, sb['y'] + sb['height'] - 60); await page.wait_for_timeout(500)
        pt = await ev('() => window.__protein.screen(55)')
        await page.mouse.move(sb['x'] + pt['x'], sb['y'] + pt['y']); await page.wait_for_timeout(300)
        tip = await ev("() => { const t = document.querySelector('.pr-tip'); return t.hidden ? '' : t.textContent; }")
        ok('AlphaFold confidence' in tip, 'hovering a residue names it with its AlphaFold confidence', tip)
        await page.mouse.down()
        for k in range(1, 11):
            await page.mouse.move(sb['x'] + pt['x'] + 25 * k, sb['y'] + pt['y'] - 10 * k); await page.wait_for_timeout(100)
        await page.wait_for_timeout(500)
        st = await ev('() => window.__protein.state()')
        ok(st['pulling'] >= 0 and st['status'].startswith('Pulling'), 'grabbing the chain pulls on that residue', [st['pulling'], st['status']])
        await page.mouse.up(); await page.wait_for_timeout(500)
        ok((await ev('() => window.__protein.state()'))['pulling'] == -1, 'letting go releases it')
        await page.click('#pr-heat'); await page.mouse.move(5, 5)
        await page.wait_for_function('() => window.__protein.state().Q < 0.45', timeout=30000)
        st = await ev('() => window.__protein.state()')
        ok(st['heat'] and st['T'] > 1 and await ev("() => document.getElementById('pr-heat').getAttribute('aria-checked')") == 'true', 'turning on the heat melts it', [round(st['Q'], 2), st['status']])
        # like a visitor would: melt it all the way, let it cool, and heat it again if it settled into a misfold
        async def melt_and_cool(folded, first=False):
            for attempt in range(3):
                if not first or attempt:
                    await page.click('#pr-heat'); await page.mouse.move(5, 5)
                await page.wait_for_function('() => window.__protein.state().Q < 0.25', timeout=60000)
                await page.click('#pr-heat'); await page.mouse.move(5, 5)
                try:
                    await page.wait_for_function(folded, timeout=60000); return attempt + 1
                except Exception:
                    st = await ev('() => window.__protein.state()'); print('     cycle', attempt + 1, 'ended as', st['status'], round(st['Q'], 2))
            return 0
        n = await melt_and_cool('() => { const s = window.__protein.state(); return !s.sim || (s.Q > 0.85 && s.ent && s.ent.native); }', first=True)
        ok(n > 0, 'turning it off lets it fold back, threaded as in the native structure', f'{n} heat cycle(s)')
        # switching protein
        await page.click('.pr-menu [role=radio]:nth-child(3)'); await page.mouse.move(5, 5)
        await page.wait_for_function("() => window.__protein.ready() && window.__protein.state().key === 'mb'", timeout=20000)
        st = await ev('() => window.__protein.state()')
        ok(st['N'] == 154 and not st['sim'] and not st['heat'] and st['ent'] is None and 'myoglobin' in st['caption'] and st['status'] == 'Folded: As AlphaFold predicted it'
           and await ev("() => document.querySelector('.pr-menu [role=radio]:nth-child(3)').getAttribute('aria-checked')") == 'true',
           'the menu switches to myoglobin, shown still with its own caption', [st['key'], st['N'], st['caption'][:60]])
        await page.click('#pr-heat'); await page.mouse.move(5, 5)
        await page.wait_for_function('() => window.__protein.state().Q < 0.4', timeout=40000)
        st = await ev('() => window.__protein.state()')
        ok(abs(st['T'] - 1.35) < 1e-6 and st['status'].startswith(('Heating', 'Melted')), 'myoglobin melts at its own temperature', [st['T'], st['status']])
        n = await melt_and_cool('() => { const s = window.__protein.state(); return !s.sim || s.Q > 0.85; }', first=True)
        ok(n > 0, 'and folds back when it cools', f'{n} heat cycle(s)')
        await page.focus('.pr-menu [role=radio][aria-checked=true]'); await page.keyboard.press('ArrowRight')
        await page.wait_for_function("() => window.__protein.ready() && window.__protein.state().key === 'gfp'", timeout=20000)
        st = await ev('() => window.__protein.state()')
        ok(st['N'] == 230 and await ev("() => document.activeElement.textContent") == 'GFP', 'the arrow keys move along the menu, to GFP', [st['key'], st['N']])
        cr = await ev("""() => { const c = document.getElementById('pr-credit'); return [c.textContent, [...c.querySelectorAll('a')].map(a => a.href)]; }""")
        ok('AF-P42212-F1' in cr[0] and cr[1] == ['https://alphafold.ebi.ac.uk/entry/P42212', 'https://creativecommons.org/licenses/by/4.0/'], "the credit under the simulation follows the protein, linking its AlphaFold entry and the licence", cr)
        cr = await ev("""() => ({ foot: document.querySelector('.site-footer').innerText.trim(), themes: document.querySelectorAll('.site-footer [data-theme-set]').length,
          tim: [...document.querySelectorAll('#r-entanglement figcaption .credit a')].map(a => a.href)[0], mbp: [...document.querySelectorAll('#p-ncle figcaption .credit a')].map(a => a.href)[0],
          panda: [...document.querySelectorAll('#p-cell li a')].map(a => a.textContent) })""")
        ok(cr['foot'] == '' and cr['themes'] == 3 and cr['tim'].endswith('/P0A858') and cr['mbp'].endswith('/P0AEX9') and cr['panda'] == ['MuJoCo Menagerie', 'Apache 2.0'],
           'the footer keeps only the theme switch; each AlphaFold figure credits its model, and the robot cell credits Menagerie', cr)
        await page.click('.pr-menu [role=radio]:nth-child(1)'); await page.wait_for_timeout(400)

        # the roles added from LinkedIn and the clubs, with their logos, on the Experience page
        roles = await ev("""() => [...document.querySelectorAll('#positions > li')].map(li => [li.id, li.querySelector('.row-t').textContent, getComputedStyle(li.querySelector('.mark')).backgroundImage.startsWith('url("data:image/png')])""")
        want = [['x-nittany-adv', 'Advanced Machine Learning Intern'], ['x-nittany', 'Machine Learning Intern'], ['x-hrc', 'Software Engineer'], ['x-gddc', 'Game Developer']]
        ok(len(roles) == 10 and [r[:2] for r in roles[6:]] == want and all(r[2] for r in roles), 'the Experience page lists ten roles, the four new ones last, each with a logo', [r[:2] for r in roles[6:]])
        # research figures on the research page, and larger on a click
        await ev("() => { location.hash = '#r-cvae'; }"); await page.wait_for_timeout(900)
        figs = await ev("() => [...document.querySelectorAll('.entry-fig .fig-img')].map(b => [b.closest('article').id, getComputedStyle(b).backgroundImage.startsWith('url(\"data:image/webp'), Math.round(b.getBoundingClientRect().width)])")
        ok([f[0] for f in figs] == ['r-crossmodal', 'r-entanglement', 'r-cvae', 'r-litrag'] and all(f[1] and f[2] > 250 for f in figs), 'the research page shows the four figures', figs)
        await page.click('#r-cvae .fig-img'); await page.wait_for_timeout(400)
        fb = await ev("() => [document.getElementById('figbox').open, document.querySelector('.figbox-img').className, Math.round(document.querySelector('.figbox-img').getBoundingClientRect().width), document.querySelector('.figbox-cap').textContent.slice(0, 30)]")
        ok(fb[0] and fb[1].endswith('fig-vae') and fb[2] > 900 and fb[3].startswith('A variational autoencoder'), 'clicking a figure opens it larger with its caption', fb)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        ok(not await ev("() => document.getElementById('figbox').open"), 'Escape closes it')
        await ev("() => { location.hash = '#home'; }"); await page.wait_for_timeout(900)

        # links to other sites open in a new tab and leave this page where it was
        stub = lambda r: r.fulfill(status=200, content_type='text/html', body='<title>stub</title>')
        await ctx.route('https://www.linkedin.com/**', stub); await ctx.route('https://github.com/**', stub)
        bad = await ev("() => [...document.querySelectorAll('a[href^=\"http\"]')].filter(a => a.target !== '_blank' || !/noopener/.test(a.rel)).map(a => a.href)")
        ok(not bad, 'every link to another site opens in a new tab', bad)
        here = await ev('() => location.href')
        async with ctx.expect_page() as pg:
            await page.click('.socials a[href*="linkedin"]')
        nw = await pg.value; await nw.wait_for_load_state()
        ok(nw.url.startswith('https://www.linkedin.com/') and await ev('() => location.href') == here, 'LinkedIn opens in a new tab and this page stays put', nw.url)
        await nw.close()
        # PerturbationAtlas #1 is mentioned, never linked, on its page and in the map's card
        st = await ev("() => { const li = document.getElementById('o-patlas'); return [li.matches('.card.row-log'), li.querySelectorAll('a').length, document.querySelectorAll('a[href*=PerturbationAtlas]').length]; }")
        ok(st == [True, 0, 0], 'PerturbationAtlas #1 is listed without a link anywhere on the site', st)
        await ev("() => { location.hash = '#home'; }"); await page.wait_for_timeout(900)
        await page.locator('.map-hub', has_text='Papers').click(); await page.wait_for_timeout(900)
        await page.click('#map-card .mc-item[data-node="o-patlas"]'); await page.wait_for_timeout(500)
        st = await ev("() => [document.querySelector('#map-card .mc-more').getAttribute('href'), document.querySelector('#map-card .mc-more').textContent, document.querySelector('#map-card .mc-detail').textContent.includes('PerturbationAtlas'), document.querySelectorAll('#map-card .mc-detail a').length]")
        ok(st[0] == '#o-patlas' and st[1] == 'Open on the Research page' and st[2] and st[3] == 0, "in the map's card it opens its row and points to the Research page, not GitHub", st)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)

        # progress tracks span the text column: first dot at its left edge, last at its right, evenly spaced, filled to the current step
        await ev("() => { location.hash = '#research'; }"); await page.wait_for_timeout(700)
        tr = await ev("""() => [...document.querySelectorAll('[data-page=research] .track')].map(t => {
          const b = t.closest('.entry-body').getBoundingClientRect(), L = [...t.children].map(li => li.getBoundingClientRect()), n = L.length;
          const c = L.map((r, i) => i === 0 ? r.left + 6 : i === n - 1 ? r.right - 6 : r.left + r.width / 2);
          const gaps = c.slice(1).map((x, i) => x - c[i]), now = [...t.children].findIndex(li => li.classList.contains('now'));
          return { left: Math.round(L[0].left - b.left), right: Math.round(b.right - L[n - 1].right), spread: Math.round(Math.max(...gaps) - Math.min(...gaps)),
                   fill: Math.round(parseFloat(getComputedStyle(t, '::after').width) - (c[now] - c[0])), clear: L.every((r, i) => i === 0 || r.left >= L[i - 1].right + 8), width: Math.round(b.width) }; })""")
        ok(len(tr) == 5 and all(abs(x['left']) <= 1 and abs(x['right']) <= 1 and x['spread'] <= 1 and abs(x['fill']) <= 1 and x['clear'] for x in tr),
           'each progress track runs the width of its text, dots evenly spaced and filled up to the current step', tr)

        # the resume: first in the top bar, its own page, and the PDF beside the page
        st = await ev("() => [...document.querySelectorAll('.site-nav a')].map(a => a.dataset.nav)")
        ok(st == ['resume', 'research', 'projects', 'experience'], 'Resume comes first in the top bar, ahead of Research', st)
        await page.click('.site-nav a[data-nav="resume"]'); await page.wait_for_timeout(600)
        st = await ev("""() => { const pg = document.querySelector('[data-page=resume]'), img = pg.querySelector('.cv-sheet img'), a = pg.querySelector('.cv-btns a');
          return [document.title, location.hash, !pg.hidden, img.complete && img.naturalWidth, Math.round(img.getBoundingClientRect().width), a.getAttribute('href'), a.target]; }""")
        ok(st[0] == 'Resume | Tarun Kumar' and st[1] == '#resume' and st[2] and st[3] >= 1600 and st[4] >= 600 and st[5] == 'https://drive.google.com/file/d/1Rt1joG4-UaYsHWgOiLSGYVh0AZm84njM/view' and st[6] == '_blank',
           'Resume opens its own page showing the resume, with the PDF on Google Drive a click away in a new tab', st)
        st = await ev("() => [...document.querySelectorAll('.socials a')].map(a => [a.textContent.trim(), a.getAttribute('href'), a.target])")
        ok(len(st) == 3 and st[2] == ['Resume', 'https://drive.google.com/file/d/1Rt1joG4-UaYsHWgOiLSGYVh0AZm84njM/view', '_blank'], 'Connect has a Resume label beside GitHub and LinkedIn that opens the PDF on Google Drive in a new tab', st)

        # the link preview LinkedIn shows: the tags at the top of the page, the picture, and a page small enough to be read
        st = await ev("""async () => { const m = Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name="twitter:card"]')]
            .map(e => [e.getAttribute('property') || e.getAttribute('name'), e.content]));
          return [m, (await fetch('og-image.png')).status, document.head.innerHTML.indexOf('og:image'), !!document.getElementById('arm-data')]; }""")
        size = (ROOT / 'dist' / 'index.html').stat().st_size
        with Image.open(ROOT / 'dist' / 'og-image.png') as im: dims = im.size
        m = st[0]
        ok(m.get('og:url') == SITE and m.get('og:image') == SITE + 'og-image.png' and m.get('og:title', '').startswith('Tarun Kumar') and m.get('og:description')
           and (m.get('og:image:width'), m.get('og:image:height')) == ('1200', '630') and dims == (1200, 630) and m.get('twitter:card') == 'summary_large_image'
           and st[1] == 200 and 0 < st[2] < 3000, 'the page has link-preview tags near the top of its head, pointing to a 1200 x 630 picture that is there', [m, st[1:3], dims])
        ok(size < 3_000_000 and not st[3], 'the page is small enough for LinkedIn to preview (under 3 MiB), with the robot model fetched separately', f'{size:,} bytes')
        print('errors:', errs or 'none')
        await b.close()
asyncio.run(main())
