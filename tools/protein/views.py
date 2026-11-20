# Candidate orientations for one protein, as quaternions, printed as JSON: principal axes in different screen directions, with tilts.
import json, math, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
import numpy as np
sys.path.insert(0, str(ROOT / 'tools' / 'protein'))
from build_data import quat_from_matrix, rx, ry
key = sys.argv[1]
D = {d['key']: d for d in json.load(open(ROOT / 'src' / 'protein-data.json'))}[key]
X = np.array(D['ca']); X = X - X.mean(0)
w, V = np.linalg.eigh(np.cov(X.T))
e = [V[:, 2], V[:, 1], V[:, 0]]
out = []
def rz(a): c, s = math.cos(a), math.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
for name, rows in [('long-x', [e[0], e[1], e[2]]), ('long-y', [e[1], e[0], -e[2]]), ('long-z', [e[1], e[2], e[0]])]:
    B = np.array(rows)
    if np.linalg.det(B) < 0: B[2] = -B[2]
    for tx, ty in [(0.25, -0.45), (-0.35, 0.5), (0.6, 0.9), (0.15, 2.6)]:
        R = rx(tx) @ ry(ty) @ B
        out.append([f'{name} {tx},{ty}', quat_from_matrix(R.tolist())])
print(json.dumps(out))
