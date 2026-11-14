# 불 테마용 연속 그림 생성기: 헤드에서 불길이 한 번 터져 올라, 혀처럼 갈라지며 떠오르다 식는다.
# 화면 위에서 직접 계산한다: 불길의 겉모양(높이·폭·떠오름)에 위로 흐르는 잡음을 더해 혀 모양으로 찢고,
# 그 값을 색 띠(검정 → 붉은색 → 주황 → 노랑 → 흰색)에 대응시킨다. 검은 바탕의 밝은 그림이고, 저장할 때 build.py가 투명 바탕으로 바꾼다.
import math, numpy as np
from scipy import ndimage as ndi
from common import smooth, frame_times, N, FR, SS

class Noise3:
    def __init__(self, rng, shape=(48, 128, 128), sig=2.6):
        g = ndi.gaussian_filter(rng.standard_normal(shape), sig, mode='wrap')
        self.g = (g - g.mean()) / (g.std() * 3.2) + 0.5   # 대략 0~1
        self.shape = shape
    def __call__(self, a, b, c):
        a, b, c = np.broadcast_arrays(np.asarray(a, float), np.asarray(b, float), np.asarray(c, float))
        return ndi.map_coordinates(self.g, np.stack([c, b, a]), order=1, mode='grid-wrap')
    def fbm(self, a, b, c):
        return (self(a, b, c) + 0.5 * self(a * 2.1 + 31, b * 2.1 + 17, c * 1.7 + 5) + 0.25 * self(a * 4.3 + 7, b * 4.3 + 53, c * 2.9 + 11)) / 1.75

def grid(cfg):
    px = N / cfg['span']
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
    return (xx - N / 2) / px, (N * cfg['cy'] - yy) / px   # X: 오른쪽 +, Y: 위 +, 단위는 헤드 반지름

def ramp(I):
    r = smooth(0.08, 0.50, I) * 1.0 + smooth(1.2, 2.6, I) * 0.25
    g = smooth(0.28, 1.00, I) * 0.78 + smooth(1.1, 2.4, I) * 0.3
    b = smooth(0.72, 1.8, I) * 0.52 + smooth(1.5, 2.8, I) * 0.45
    return np.stack([r, g * 0.92, b * 0.75], -1)

def side(cfg, st, t):
    X, Y = st['X'], st['Y']; nz = st['nz']; e = cfg['e']
    # 흔들림: 높이에 따라 좌우로 굽는다
    sway = (nz(X * 6 + 9, Y * 9 - t * 50, t * 30 + 3) - 0.5) * cfg['sway'] * np.clip(Y + 0.3, 0, 2)
    Xw = X + sway
    Xc = np.clip(Xw, -1, 1)
    half = e * np.sqrt(1 - Xc * Xc)
    h = Y + half                                             # 헤드 앞 가장자리에서 잰 높이(밑동·흐름 기준)
    top = np.clip(Y - half, 0, None)                         # 헤드 뒤 가장자리 위로 솟은 높이(불길 길이 기준)
    grow = 1 - math.exp(-t / cfg['t_grow'])
    H = cfg['H'] * grow + cfg['rise'] * t                     # 불길 꼭대기 높이
    W = cfg['W0'] + (cfg['W1'] - cfg['W0']) * float(smooth(0, cfg['dur'], t))
    jets = nz(Xw * cfg['jet_f'] + st['ph'][0], t * 25 + 7, st['ph'][1])   # 자리마다 불길 높이가 다르다
    prof = np.clip(1 - np.abs(Xw / W) ** cfg['shape_p'], 0, 1) ** cfg['shape_q']
    if cfg.get('edge_mode'):
        prof = prof * (0.45 + 0.9 * np.abs(Xw / W) ** 1.5)    # 심벌: 가장자리 쪽이 높다
    Hx = H * prof * (0.45 + 1.1 * jets) + 1e-4
    # 헤드 면 위는 불길이 깔려 있다. 보는 쪽(앞)일수록 지나는 불길이 얇아 덜 밝다
    depth = cfg['thin'] + (1 - cfg['thin']) * smooth(0, 2 * half + 0.35, h)
    body = np.clip(1 - top / Hx, 0, 1) * depth * smooth(-0.05, 0.04, h) * (prof > 0)
    # 연료가 다 타면 밑동부터 꺼지며 떠오른다
    lift = cfg['lift'] * max(0.0, t - cfg['t_lift'])
    if lift > 0:
        cut = lift * (0.3 + 1.4 * nz.fbm(Xw * 12 + 3, h * 6 - t * 40, t * 20 + 9.0))
        body = body * smooth(cut - 0.25, cut + 0.45, h)
    # 위로 흐르는 잡음으로 혀 모양을 만든다. 꼭대기와 가장자리일수록 많이 찢긴다
    turb = nz.fbm(Xw * cfg['fx'], (h - cfg['flow'] * t) * cfg['fy'], t * cfg['ft'])
    streak = nz(Xw * cfg['fx'] * 2.6 + 40, (h - cfg['flow'] * 1.4 * t) * cfg['fy'] * 0.5, t * cfg['ft'] + 20)
    F = body * cfg['body'] + (turb - 0.5) * cfg['tear'] * (0.35 + 1.0 * (1 - body)) * smooth(0.0, 0.14, body)
    heat = 1 - float(smooth(cfg['t_cool'], cfg['dur'], t))
    I = np.clip(F, 0, None) ** cfg['gamma'] * cfg['gain'] * (0.7 + 0.6 * streak) * (0.25 + 0.75 * heat) * (heat ** 0.5)
    # 불이 붙는 순간 헤드 면 전체가 번쩍인다
    disc = np.clip(1 - (Xw * Xw + (Y / e) ** 2), 0, 1) ** 0.5 * math.exp(-t / cfg['t_flash']) * cfg['flash'] * (0.6 + 0.8 * turb)
    return I + disc

def front(cfg, st, t):
    X, Y = st['X'], st['Y']; nz = st['nz']
    r = np.hypot(X, Y); th = np.arctan2(Y, X)
    up = 0.5 + 0.5 * np.sin(th)                                # 위쪽일수록 불길이 길다
    grow = 1 - math.exp(-t / cfg['t_grow'])
    a = th * cfg['jet_f']
    jets = nz(np.cos(th) * cfg['jet_f'] * 4 + st['ph'][0], np.sin(th) * cfg['jet_f'] * 4 + st['ph'][1], t * 25)
    H = (cfg['H'] * grow + cfg['rise'] * t) * (cfg['side'] + (1 - cfg['side']) * up ** 1.3) * (0.4 + 1.2 * jets) + 1e-4
    lift = cfg['lift'] * max(0.0, t - cfg['t_lift'])
    r0 = cfg['r0'] + lift * (0.4 + 0.6 * up)
    hh = r - r0
    body = np.clip(1 - np.clip(hh, 0, None) / H, 0, 1) * smooth(-0.22, 0.02, hh)
    tc = nz.fbm(X * cfg['fx'] + 5, (Y - cfg['flow'] * 0.6 * t) * cfg['fx'] * 0.7, t * cfg['ft'])
    tp = nz.fbm(np.cos(th) * 30 + (hh - cfg['flow'] * t) * cfg['fy'] * 0.3 + 3, np.sin(th) * 30 + 40, (hh - cfg['flow'] * t) * cfg['fy'] + t * cfg['ft'])
    turb = 0.5 * tc + 0.5 * tp
    F = body * cfg['body'] + (turb - 0.5) * cfg['tear'] * (0.5 + 1.0 * (1 - body)) * smooth(0.0, 0.14, body)
    heat = 1 - float(smooth(cfg['t_cool'], cfg['dur'], t))
    I = np.clip(F, 0, None) ** cfg['gamma'] * cfg['gain'] * (0.25 + 0.75 * heat) * (heat ** 0.5)
    disc = np.clip(1 - (r / cfg['r0']) ** 2, 0, 1) ** 0.4 * math.exp(-t / cfg['t_flash']) * cfg['flash'] * (0.2 + 1.6 * tc)
    return I + disc

def shade(cfg, I):
    I = ndi.gaussian_filter(I, 1.0)
    rgb = ramp(I)
    lum = rgb.mean(-1)
    bloom = ndi.gaussian_filter(lum, 9.0) * cfg['bloom'] + ndi.gaussian_filter(lum, 28.0) * cfg['bloom'] * 0.8
    rgb = rgb + bloom[..., None] * np.array([1.0, 0.42, 0.10])
    rgb = rgb.reshape(FR, SS, FR, SS, 3).mean((1, 3))
    return np.clip(1 - np.exp(-rgb * cfg['expo']), 0, 1)

DRUM = dict(view='side', e=0.70, thin=0.2, H=1.05, rise=1.2, t_grow=0.045, W0=1.06, W1=0.8, shape_p=2.6, shape_q=0.55, jet_f=5.0,
    sway=0.10, lift=4.6, t_lift=0.14, flow=6.0, fx=24.0, fy=11.0, ft=30.0, body=1.0, tear=1.45, gamma=1.3, gain=2.0,
    t_cool=0.16, t_flash=0.035, flash=1.0, bloom=0.5, expo=1.5, frames=36, dur=0.50, tpow=1.5, span=3.6, cy=0.68)
CYMBAL = dict(DRUM, edge_mode=True, jet_f=9.0, H=0.6, rise=0.9, W0=1.1, W1=1.0, lift=4.2, t_lift=0.10, gain=2.0, dur=0.44, span=4.2, cy=0.64)
FRONT = dict(DRUM, view='front', r0=0.9, H=0.30, rise=0.55, side=0.35, jet_f=1.0, lift=0.9, t_lift=0.12, flow=3.0, fx=22.0, fy=26.0,
    tear=1.5, gain=1.7, gamma=1.4, flash=1.1, t_flash=0.05, t_cool=0.12, dur=0.44, span=3.6, cy=0.56)
CFGS = dict(side=DRUM, cymbal=CYMBAL, front=FRONT)

def build(cfg, seed):
    rng = np.random.default_rng(seed)
    X, Y = grid(cfg)
    return dict(X=X, Y=Y, nz=Noise3(rng), ph=rng.uniform(0, 100, 4))

def frame(cfg, st, t):
    return shade(cfg, side(cfg, st, t) if cfg['view'] == 'side' else front(cfg, st, t))


def frames(cfg, seed):
    """설정과 씨앗으로 프레임 목록(높이×너비×3, 0~1)을 만든다."""
    st = build(cfg, seed)
    return [frame(cfg, st, t) for t in frame_times(cfg)]
