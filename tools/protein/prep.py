# Builds per-protein data (trimmed chain, 3-state secondary structure) from the AlphaFold DB extracts in af_new.json.
import json, re, sys
P = json.load(open('af_new.json'))
META = {
  'P0CG47': dict(key='ubq', gene='UBB', name='Ubiquitin', organism='Homo sapiens', first=1, last=76),
  'P02185': dict(key='mb', gene='MB', name='Myoglobin', organism='Physeter macrocephalus', first=1, last=154),
  'P42212': dict(key='gfp', gene='GFP', name='Green fluorescent protein', organism='Aequorea victoria', first=2, last=231),
  'P0A858': dict(key='tim', gene='tpiA', name='Triosephosphate isomerase', organism='Escherichia coli (strain K12)', first=1, last=255),
  'P0AEX9': dict(key='mbp', gene='malE', name='Maltose-binding protein', organism='Escherichia coli (strain K12)', first=1, last=396),
}
def ss3(s8):
    # DSSP 8-state to the cartoon's 3 states: alpha and pi helices, plus 3-10 helices of 4 or more, are helices;
    # strands are strands; everything else is coil. Then drop helices shorter than 4 and strands shorter than 2.
    s = list(s8)
    out = ['C'] * len(s)
    for m in re.finditer(r'[HGI]+', s8):
        run = m.group(0)
        if 'H' in run or 'I' in run or len(run) >= 4:
            for k in range(m.start(), m.end()):
                out[k] = 'H' if (s[k] in 'HI' or len(run) >= 4 or True) else 'C'
    for k, c in enumerate(s):
        if c == 'E': out[k] = 'E'
    t = ''.join(out)
    t = re.sub(r'(?<![H])H{1,3}(?![H])', lambda m: 'C' * len(m.group(0)), t)
    t = re.sub(r'(?<![E])E(?![E])', 'C', t)
    return t
def clean(t):
    t = re.sub(r'(?<![H])H{1,3}(?![H])', lambda m: 'C' * len(m.group(0)), t)
    return re.sub(r'(?<![E])E(?![E])', 'C', t)
out = {}
for pid, p in P.items():
    m = META[pid]
    a, b = m['first'] - p['start'], m['last'] - p['start'] + 1
    d = dict(entry=f'AF-{pid}-F1', version=p['version'], uniprot=pid, gene=m['gene'], name=m['name'], organism=m['organism'],
             offset=m['first'], seq=p['seq'][a:b], plddt=p['plddt'][a:b], ss=clean(ss3(p['ss8'])[a:b]), ca=p['ca'][a:b])
    out[m['key']] = d
    print(m['key'], len(d['seq']), d['ss'])
json.dump(out, open('cands.json', 'w'))
