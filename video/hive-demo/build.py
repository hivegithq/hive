# Assembles index.html from src/ plus data.js, and places every audio clip.
import json, pathlib, subprocess
R = pathlib.Path(__file__).resolve().parent
subprocess.run(['python3', str(R / 'gen_data.py')], check=True)
data = (R / 'data.js').read_text()
H = json.loads(data[data.index('=') + 1:].strip().rstrip(';'))
ST, END, LEAD = H['starts'], H['end'], H['lead']
scenes = (R / 'src/scenes.html').read_text()
for n in range(1, 12):
    s = 0 if n == 1 else ST[n - 1] - 0.7
    e = ST[n] if n < 11 else END
    scenes = scenes.replace(f'@@S{n}@@', f'{s:g}').replace(f'@@D{n}@@', f'{e - s:g}')
scenes = scenes.replace('@@END@@', str(END))
V = lambda n, t: round(ST[n - 1] + LEAD[n - 1] + t, 2)
audio = [f'<audio id="bed" src="audio/bed.wav" data-start="0" data-duration="{END}" data-track-index="20" data-volume="0.16"></audio>']
for n in range(1, 12):
    audio.append(f'<audio id="vo{n}" src="audio/scene-{n:02d}.wav" data-start="{V(n, 0)}" data-track-index="10" data-volume="1"></audio>')
sfx = []
sfx += [('tick', 1.6, .5), ('swarm', 1.0, .55), ('tone', 6.2, .7)]
sfx += [('whoosh', ST[n - 1] - 0.7, .5) for n in range(2, 12)]
sfx += [('whoosh', t - 0.25, .4) for t in (V(1, 12.2), V(1, 15.2), V(1, 18.3), V(1, 20.7))]
sfx += [('tick', V(4, 28.9 + k * 0.42) + 0.4, .45) for k in range(6)] + [('tone', V(4, 31.3), .7)]
sfx += [('tick', V(5, w), .35) for w in (2.7, 5.4, 6.5)] + [('tick', V(5, 17.8), .5), ('tone', V(5, 18.6), .6)]
sfx += [('tick', V(6, 7.1), .5), ('tick', V(8, 9.5), .3), ('tick', V(8, 10.4), .3), ('tick', V(8, 11.3), .3)]
sfx += [('swarm', ST[9] - 0.8, .5), ('tone', V(10, 9.4), .6), ('tick', V(11, 16.9), .6)]
for i, (k, t, v) in enumerate(sfx):
    dur = {'tick': 0.2, 'tone': 1.2, 'whoosh': 0.7, 'swarm': 12}[k]
    audio.append(f'<audio id="sfx{i}" src="audio/{k}.wav" data-start="{round(t, 2)}" data-duration="{dur}" data-track-index="{11 + i % 6}" data-volume="{v}"></audio>')
html = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Hive demo</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
{(R / 'src/style.css').read_text()}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{END}">
{scenes}
    {chr(10).join('    ' + a for a in audio)}
    </div>
    <script>
{data}
    </script>
    <script>
{(R / 'src/main.js').read_text()}
    </script>
  </body>
</html>
'''
(R / 'index.html').write_text(html)
print('index.html', len(html), 'bytes;', len(audio), 'audio clips; end', END)
