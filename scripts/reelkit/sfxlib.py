"""Synthesized SFX (no external assets) + a tiny mixer. All functions return float arrays at SR."""
import numpy as np
SR = 44100
rng = np.random.default_rng(5)
def tt(d): return np.arange(int(d * SR)) / SR
def tick():
    t = tt(0.05); return np.sin(2*np.pi*2400*t)*np.exp(-t*90) + 0.4*np.sin(2*np.pi*900*t)*np.exp(-t*120)
def pop():
    t = tt(0.14); f = 480 + 900*(t/0.14); return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*28)
def whoosh(d=0.7, up=True):
    t = tt(d); n = rng.standard_normal(len(t)); k = int(SR*0.004); n = np.convolve(n, np.ones(k)/k, mode="same")
    a = np.sin(np.pi*(t/d))**2; f = np.linspace(300, 2500, len(t)) if up else np.linspace(2500, 300, len(t))
    return n*a*0.9*(0.5+0.5*np.sin(2*np.pi*f*t/4000))
def riser(d=2.0):
    t = tt(d); f = 220 + 1400*(t/d)**2; s = np.sin(2*np.pi*np.cumsum(f)/SR)*(t/d); return s*(0.6+0.4*np.sin(2*np.pi*(6+20*t/d)*t))*0.7
def impact():
    t = tt(0.9); return np.sin(2*np.pi*(140*np.exp(-t*6))*t)*np.exp(-t*7)*1.1 + rng.standard_normal(len(t))*np.exp(-t*18)*0.7
def yelp():
    t = tt(0.8); f = 1100*np.exp(-t*1.4)+120+40*np.sin(2*np.pi*9*t)
    return (np.sin(2*np.pi*np.cumsum(f)/SR)+0.4*np.sin(2*np.pi*np.cumsum(2*f)/SR))*np.minimum(1, t*60)*np.exp(-t*2.5)*0.7
def boing():
    t = tt(0.55); f = 180+520*np.abs(np.sin(2*np.pi*3.2*t))*np.exp(-t*3); return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*5)*0.6
def splash():
    t = tt(0.5); n = rng.standard_normal(len(t)); k = int(SR*0.002); n = np.convolve(n, np.ones(k)/k, mode="same"); return n*np.exp(-t*9)*0.8
def clink():
    t = tt(0.35); return (np.sin(2*np.pi*2900*t)+0.6*np.sin(2*np.pi*4100*t))*np.exp(-t*18)*0.5
def thud():
    t = tt(0.07); return np.sin(2*np.pi*110*t)*np.exp(-t*45)
def ding():
    t = tt(0.9); return (np.sin(2*np.pi*1320*t)+0.4*np.sin(2*np.pi*1980*t))*np.exp(-t*5)*0.6
def honk():
    t = tt(0.5); return np.sign(np.sin(2*np.pi*330*t))*0.35*np.minimum(1, t*40)*np.exp(-t*3)
def sneeze():
    t = tt(0.6); return rng.standard_normal(len(t))*np.exp(-((t-0.35)**2)*90)*0.6
def sad_trombone():
    out = np.zeros(int(1.6*SR)); notes = [(311, 0.0, .35), (294, .35, .35), (277, .7, .3), (261, 1.0, .5)]
    for f, a, d in notes:
        t = tt(d); seg = (np.sin(2*np.pi*f*t)+0.5*np.sin(2*np.pi*2*f*t))*np.minimum(1, t*50)*np.exp(-t*2.2)*0.4
        i = int(a*SR); m = min(len(seg), len(out)-i); out[i:i+m] += seg[:m]
    return out
LIB = dict(tick=tick, pop=pop, whoosh=lambda: whoosh(0.7, True), whoosh_out=lambda: whoosh(0.7, False), riser=riser, impact=impact,
           yelp=yelp, boing=boing, splash=splash, clink=clink, thud=thud, ding=ding, honk=honk, sneeze=sneeze, sad=sad_trombone)

class Mix:
    def __init__(self, dur):
        self.N = int(dur*SR); self.a = np.zeros(self.N)
    def add(self, sig, t0, g=1.0):
        i = int(t0*SR)
        if i < 0 or i >= self.N: return
        seg = sig[:self.N-i]; self.a[i:i+len(seg)] += seg*g
    def sfx(self, name, t0, g=0.5): self.add(LIB[name](), t0, g)
