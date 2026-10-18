# Builds data.js: scene starts, narration offsets, and captions aligned to Kokoro's audio.
import json, re, difflib, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
DOC = (ROOT / '../../docs/DEMO-VIDEO.md').read_text()
STARTS = [0, 27, 48, 78, 128, 170, 191, 219, 240, 260, 291]
END = 319
LEAD = [0.8] + [0.7] * 10
norm = lambda w: re.sub(r'[^a-z0-9]', '', w.lower())
caps = []
for s in re.split(r'\n### ', DOC)[1:]:
    n = int(s.split('.')[0])
    text = ' '.join(re.search(r'\*\*VO:\*\* "(.*?)"\n', s, re.S).group(1).split())
    orig = text.split(' ')
    ww = json.load(open(ROOT / f'../voice/words/{n:02d}.json'))
    off = STARTS[n - 1] + LEAD[n - 1]
    a = [norm(w) for w in orig]; b = [norm(w['text']) for w in ww]
    times = [None] * len(orig)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size): times[blk.a + k] = (ww[blk.b + k]['start'], ww[blk.b + k]['end'])
    # fill gaps by interpolation between known neighbours
    known = [i for i, t in enumerate(times) if t]
    for i in range(len(orig)):
        if times[i]: continue
        lo = max([k for k in known if k < i], default=None); hi = min([k for k in known if k > i], default=None)
        t0 = times[lo][1] if lo is not None else 0; t1 = times[hi][0] if hi is not None else ww[-1]['end']
        span = (hi if hi is not None else len(orig)) - (lo if lo is not None else -1)
        f = (i - (lo if lo is not None else -1)) / span
        t = t0 + (t1 - t0) * f; times[i] = (t, t + 0.25)
    chunk = []
    for i, w in enumerate(orig):
        chunk.append(i)
        brk = re.search(r'[.?!:;,]$', w) and len(chunk) >= 3
        if brk or len(chunk) >= 8 or i == len(orig) - 1:
            st = times[chunk[0]][0] + off; en = times[chunk[-1]][1] + off
            caps.append([round(st, 2), round(en + 0.15, 2), ' '.join(orig[j] for j in chunk)]); chunk = []
for i in range(len(caps) - 1):
    caps[i][1] = min(caps[i][1], caps[i + 1][0] - 0.02)
(ROOT / 'data.js').write_text('window.HIVE = ' + json.dumps({'starts': STARTS, 'end': END, 'lead': LEAD, 'captions': caps}) + ';\n')
print(len(caps), 'captions; last', caps[-1])
