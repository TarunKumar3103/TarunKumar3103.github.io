# Writes src/protein-data.json: the proteins the home page can show, in menu order.
import json, math, pathlib
import numpy as np
root = str(pathlib.Path(__file__).resolve().parents[2])   # the repository
trx = json.load(open(f'{root}/tools/protein/trx-data.json'))
C = json.load(open(f'{root}/tools/protein/cands.json'))

def quat_from_matrix(R):
    m = R; t = m[0][0] + m[1][1] + m[2][2]
    if t > 0:
        s = math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s
    else:
        s = math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4
    return [round(v, 5) for v in (x, y, z, w)]

def rx(a): c, s = math.cos(a), math.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a): c, s = math.cos(a), math.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def view(ca, tilt_x, tilt_y, axes='long-x'):
    # principal axes of the chain onto the screen (the longest along x or y), then a tilt so it reads in depth
    X = np.array(ca); X = X - X.mean(0)
    w, V = np.linalg.eigh(np.cov(X.T))
    e = [V[:, 2], V[:, 1], V[:, 0]]
    B = np.array({'long-x': [e[0], e[1], e[2]], 'long-y': [e[1], e[0], -e[2]]}[axes])
    if np.linalg.det(B) < 0: B[2] = -B[2]
    R = rx(tilt_x) @ ry(tilt_y) @ B
    return quat_from_matrix(R.tolist())

def euler_xyz(a, b, c):   # three.js default order XYZ
    return quat_from_matrix((rx(a) @ ry(b) @ np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])).tolist())

if __name__ == '__main__':
    out = []
    t = dict(trx)
    t.update(key='trx', label='Thioredoxin', T=[0.7, 1.4], view=euler_xyz(0.35, -0.6, 0),
             cap='AlphaFold&rsquo;s model of thioredoxin 1 from <i>E. coli</i>, whose N-terminal strand threads one of its own loops.')
    out.append(t)
    specs = [
      ('ubq', 'Ubiquitin', [0.7, 1.4], 'AlphaFold&rsquo;s model of human ubiquitin, the tag cells attach to proteins to mark them for destruction.', (0.15, 2.6, 'long-x')),
      ('mb', 'Myoglobin', [0.55, 1.35], 'AlphaFold&rsquo;s model of sperm whale myoglobin, which stores oxygen in muscle and was the first protein structure ever solved.', (0.15, 2.6, 'long-y')),
      ('gfp', 'GFP', [0.85, 1.6], 'AlphaFold&rsquo;s model of green fluorescent protein from the jellyfish <i>Aequorea victoria</i>, used to light up cells.', (0.15, 2.6, 'long-y')),
    ]
    for key, label, T, cap, (ax, ay, axes) in specs:
        c = C[key]
        d = dict(key=key, label=label, entry=c['entry'], version=c['version'], uniprot=c['uniprot'], gene=c['gene'], name=c['name'], organism=c['organism'],
                 offset=c['offset'], seq=c['seq'], plddt=c['plddt'], ss=c['ss'], ca=[[round(v, 2) for v in p] for p in c['ca']],
                 ents=[], rep=None, T=T, view=view(c['ca'], ax, ay, axes), cap=cap)
        out.append(d)
    for d in out:
        assert len(d['seq']) == len(d['plddt']) == len(d['ss']) == len(d['ca']), d['key']
        print(d['key'], len(d['seq']), d['T'], d['view'], d['entry'])
    json.dump(out, open(f'{root}/src/protein-data.json', 'w'), separators=(',', ':'))
    print('bytes', len(json.dumps(out, separators=(',', ':'))))
