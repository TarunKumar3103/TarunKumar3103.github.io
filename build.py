# Builds dist/index.html: one self-contained page with the arm model, physics and scripts inline.
import base64, json, pathlib, shutil
root = pathlib.Path(__file__).parent
vendor = root / 'vendor'                # third-party code and data: arm model and kinematics, cannon-es, three.js RoomEnvironment
src = root / 'src'
t = (src / 'index.template.html').read_text()
kin_js = 'window.PANDA_KIN = ' + json.dumps(json.loads((vendor / 'panda-kin.json').read_text()), separators=(',', ':')) + ';'
room = '/* RoomEnvironment from three.js r128 examples (MIT License, three.js authors), after model-viewer */\n' + \
    (vendor / 'RoomEnvironment.js').read_text()
arm_b64 = base64.b64encode((vendor / 'panda.bin').read_bytes()).decode()
arm_b64 = '\n'.join(arm_b64[i:i + 4096] for i in range(0, len(arm_b64), 4096))
def uri(name):
    f = root / 'assets' / name
    return 'data:image/jpeg;base64,' + base64.b64encode(f.read_bytes()).decode() if f.exists() else ''
styles = (src / 'styles.css').read_text().replace('{{STILL_LIGHT}}', uri('still-light.jpg')).replace('{{STILL_DARK}}', uri('still-dark.jpg'))
styles = styles.replace('{{PR_STILL_LIGHT}}', uri('protein-still-light.jpg')).replace('{{PR_STILL_DARK}}', uri('protein-still-dark.jpg'))
# research figures, each defined once in the stylesheet and shown wherever its class is used
def webp(name):
    f = root / 'assets' / (f'{name}.webp' if name.startswith('proj-') else f'fig-{name}.webp')
    return 'data:image/webp;base64,' + base64.b64encode(f.read_bytes()).decode()
for key, name in [('VAE', 'vae'), ('LITRAG', 'litrag'), ('SEMI', 'semi'), ('TIM_LIGHT', 'tim-light'), ('TIM_DARK', 'tim-dark')] + [('PROJ_' + k.upper().replace('-', '_'), 'proj-' + k) for k in ['gemma', 'iphone', 'social', 'ncle-light', 'ncle-dark', 'ferrite-light', 'ferrite-dark']]:
    assert styles.count('{{FIG_' + key + '}}') == 1, key
    styles = styles.replace('{{FIG_' + key + '}}', webp(name))
# organisation logos, each defined once in the stylesheet
for name in ['ai4research', 'pennstate', 'ncems', 'adnoc', 'biorob', 'cil', 'nittanyai', 'hrc', 'gddc', 'anthropic', 'canvas', 'github', 'linkedin']:
    f = root / 'assets' / 'logos' / f'{name}.png'
    styles = styles.replace('{{LOGO_' + name.upper() + '}}', 'data:image/png;base64,' + base64.b64encode(f.read_bytes()).decode())
# the resume: the Resume page shows it as a sharp image rendered from the PDF (whose shared copy is on Google Drive),
# redrawn whenever the PDF is newer than the image (so updating the resume means replacing the PDF)
cv = root / 'assets' / 'Tarun_Kumar_Resume.pdf'
cv_img = root / 'assets' / 'resume-page.webp'
if not cv_img.exists() or cv_img.stat().st_mtime < cv.stat().st_mtime:
    import pymupdf
    from PIL import Image
    cv_doc = pymupdf.open(cv)
    assert cv_doc.page_count == 1, 'the Resume page shows one page; show the others too before using a longer resume'
    pix = cv_doc[0].get_pixmap(matrix=pymupdf.Matrix(8 / 3, 8 / 3), colorspace=pymupdf.csGRAY, alpha=False)
    Image.frombytes('L', (pix.width, pix.height), pix.samples).save(cv_img, 'WEBP', lossless=True, method=6)
assert t.count('{{RESUME_IMG}}') == 1
t = t.replace('{{RESUME_IMG}}', 'data:image/webp;base64,' + base64.b64encode(cv_img.read_bytes()).decode())
parts = [('{{ARMDATA}}', arm_b64), ('{{STYLES}}', styles), ('{{ROOMENV}}', room), ('{{CANNON}}', (vendor / 'cannon.min.js').read_text()),
         ('{{KIN}}', kin_js), ('{{SIM}}', (src / 'sim3d-core.js').read_text()), ('{{MAP}}', (src / 'map.js').read_text()),
         ('{{PROTEIN_SIM}}', (src / 'protein-sim.js').read_text()),
         ('{{PROTEIN}}', 'window.PROTEIN_DATA = ' + (src / 'protein-data.json').read_text().strip() + ';\n' + (src / 'protein.js').read_text()),
         ('{{APP}}', (src / 'app.js').read_text())]
for key, body in parts:
    low = body.lower()
    assert '</script' not in low and '<!--' not in low and '<script' not in low, key
    assert t.count(key) == 1, key
    t = t.replace(key, body)
assert '{{' not in t
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'index.html').write_text(t)
(root / 'dist' / 'models').mkdir(parents=True, exist_ok=True)
shutil.copyfile(vendor / 'LICENSE-franka-panda.txt', root / 'dist' / 'models' / 'LICENSE.txt')
(root / 'dist' / 'Tarun_Kumar_Resume.pdf').unlink(missing_ok=True)   # the PDF itself lives on Google Drive, linked from the page
print('built', len(t), 'bytes')
