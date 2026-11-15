# 번개 테마용 연속 그림 생성기: 스틱 자리에서 방전이 헤드 면을 타고 가장자리로 달리고, 일부는 공중으로 튄다.
# 심벌은 가장자리에서 바깥 공중으로 뻗는 방전(rimout)과 튀어 나가는 불꽃(sparks)을 더해 사방으로 튀는 모양이다.
# 가지 치는 꺾은선을 3차원으로 만들고(중점 변위), 세 번의 방전이 같은 길을 조금씩 달리 타며 깜빡이게 한다.
# 선을 그린 뒤 흐림으로 얇은 흰 중심과 푸른 빛무리를 만든다. 검은 바탕의 밝은 그림이고, 저장할 때 build.py가 투명 바탕으로 바꾼다.
import math, numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
from common import smooth, frame_times, N, FR, SS

def jag(rng, p0, p1, disp, depth):
    pts = [np.array(p0, float), np.array(p1, float)]
    for _ in range(depth):
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            L = np.linalg.norm(b - a)
            out.append((a + b) / 2 + rng.normal(0, 1, 3) * L * disp); out.append(b)
        pts = out
    return np.array(pts)

def tree(rng, p0, p1, cfg, level=0, inten=1.0, s0=0.0):
    # 반환: (점열, 세기, 시작 거리) 목록. 시작 거리는 방전이 자라는 순서를 정한다
    main = jag(rng, p0, p1, cfg['disp'], cfg['depth'] - level)
    seg = np.linalg.norm(np.diff(main, axis=0), axis=1); cum = np.concatenate([[0], np.cumsum(seg)]) + s0
    out = [(main, inten, cum)]
    if level < cfg['levels']:
        nb = rng.poisson(cfg['branch'] * (0.6 ** level))
        for _ in range(nb):
            i = rng.integers(1, len(main) - 1)
            d = main[min(i + 1, len(main) - 1)] - main[i - 1]; d = d / (np.linalg.norm(d) + 1e-9)
            d = d + rng.normal(0, cfg['fork'], 3); d = d / np.linalg.norm(d)
            L = np.linalg.norm(np.array(p1) - np.array(p0)) * rng.uniform(0.2, 0.55)
            out += tree(rng, main[i], main[i] + d * L, cfg, level + 1, inten * cfg['dim'], cum[i])
    return out

def build(cfg, seed):
    rng = np.random.default_rng(seed)
    stick = np.array([cfg['stick'][0] + rng.normal(0, 0.05), cfg['stick'][1] + rng.normal(0, 0.05), 0.0])
    strokes = []
    for si in range(cfg['strokes']):
        paths = []
        na = cfg['surf'] if si == 0 else max(2, cfg['surf'] - 2 * si)
        a0 = rng.uniform(0, 2 * np.pi)
        for j in range(na):   # 헤드 면을 타는 방전: 스틱 → 가장자리
            a = a0 + (j + rng.uniform(-0.3, 0.3)) * 2 * np.pi / na
            end = np.array([math.cos(a) * cfg['rim'], math.sin(a) * cfg['rim'], rng.uniform(0, 0.05)])
            paths += tree(rng, stick, end, dict(cfg, disp=cfg['disp'] * 0.8), 0, 1.0)
        nair = cfg['air'] if si == 0 else max(1, cfg['air'] - si)
        for j in range(nair):  # 공중으로 튀는 방전
            a = rng.uniform(0, 2 * np.pi); rr = rng.uniform(0.2, 1.0)
            start = stick if rng.uniform() < 0.5 else np.array([math.cos(a) * rr, math.sin(a) * rr, 0.0])
            b = rng.uniform(0, 2 * np.pi); out = rng.uniform(0.2, cfg['air_out'])
            end = start + np.array([math.cos(b) * out, math.sin(b) * out, rng.uniform(cfg['air_h'] * 0.45, cfg['air_h'])])
            paths += tree(rng, start, end, cfg, 0, 0.9)
        nrim = cfg.get('rimout', 0) if si == 0 else max(0, cfg.get('rimout', 0) - 3 * si)
        b0 = rng.uniform(0, 2 * np.pi)
        for j in range(nrim):  # 가장자리에서 바깥 공중으로 뻗는 방전(심벌)
            a = b0 + (j + rng.uniform(-0.35, 0.35)) * 2 * np.pi / nrim
            start = np.array([math.cos(a) * cfg['rim'], math.sin(a) * cfg['rim'], 0.0])
            b = a + rng.normal(0, 0.3); out = rng.uniform(0.35, 1.0) * cfg['rim_len']
            end = start + np.array([math.cos(b) * out, math.sin(b) * out, rng.uniform(0.1, 1.0) * cfg['rim_h']])
            # 스틱에서 먼 가장자리일수록 늦게 붙도록 시작 거리를 준다
            paths += tree(rng, start, end, cfg, 0, 0.95, float(np.linalg.norm(start - stick)))
        strokes.append(dict(paths=paths, t0=cfg['times'][si] + (rng.uniform(-0.008, 0.008) if si else 0), amp=cfg['amps'][si],
                            fl=rng.uniform(0, 100)))
    st = dict(strokes=strokes, rng=rng, stick=stick)
    n = cfg.get('sparks', 0)
    if n:  # 가장자리에서 튀어 나가는 불꽃: 방전마다 한 무리씩
        a = rng.uniform(0, 2 * np.pi, n); sp = cfg['sp_out'] * np.exp(rng.normal(0, 0.45, n)).clip(0.3, 2.4)
        ta = a + rng.normal(0, 0.3, n); si = rng.choice(len(strokes), n, p=np.array(cfg['amps']) / sum(cfg['amps']))
        st['sparks'] = dict(x=np.cos(a) * cfg['rim'], y=np.sin(a) * cfg['rim'], vx=np.cos(ta) * sp, vy=np.sin(ta) * sp,
                            vz=cfg['sp_up'] * rng.uniform(0.1, 1.0, n), k=rng.uniform(3.0, 6.5, n),
                            t0=np.array([strokes[i]['t0'] for i in si]) + rng.uniform(0.0, 0.02, n),
                            life=rng.uniform(0.35, 1.0, n) * cfg['sp_life'], w=rng.uniform(0.4, 1.0, n))
    return st

def proj(cfg, P):
    px = N / cfg['span']; x, y, z = P[:, 0], P[:, 1], P[:, 2]
    if cfg.get('front'):
        f = 1 + cfg['persp'] * z
        return N / 2 + x * f * px, N * cfg['cy'] + y * f * px
    se, ce = math.sin(math.radians(cfg['elev'])), math.cos(math.radians(cfg['elev']))
    return N / 2 + x * px, N * cfg['cy'] + y * se * px - z * ce * px

def frame(cfg, st, t):
    core = Image.new('F', (N, N), 0.0); dr = ImageDraw.Draw(core)
    for s in st['strokes']:
        age = t - s['t0']
        if age < 0 or age > cfg['life']: continue
        grow = age / cfg['t_grow'] * cfg['reach']                        # 방전이 자라난 거리
        fl = 0.55 + 0.45 * math.sin(s['fl'] + age * 190) * math.sin(s['fl'] * 1.7 + age * 77)   # 깜빡임
        env = s['amp'] * (1 - smooth(cfg['life'] * 0.25, cfg['life'], age)) * max(0.15, fl)
        for pts, inten, cum in s['paths']:
            sx, sy = proj(cfg, pts)
            for i in range(len(pts) - 1):
                if cum[i] > grow: break
                v = env * inten
                if v < 0.02: continue
                dr.line([(sx[i], sy[i]), (sx[i + 1], sy[i + 1])], fill=float(v), width=4 if inten > 0.7 else (2 if inten > 0.4 else 1))
    q = st.get('sparks')
    if q:
        def pos(tt):
            age = np.clip(tt - q['t0'], 0, None); D = (1 - np.exp(-q['k'] * age)) / q['k']
            P = np.stack([q['x'] + q['vx'] * D, q['y'] + q['vy'] * D, (q['vz'] + cfg['sp_grav'] / q['k']) * D - cfg['sp_grav'] * age / q['k']], 1)
            return proj(cfg, P), age
        (ax, ay), age = pos(t); (bx, by), _ = pos(t - cfg['sp_expo'])
        heat = np.clip(1 - age / q['life'], 0, 1)
        edge = np.minimum(np.minimum(ax, N - ax), np.minimum(ay, N - ay)) / N
        v = q['w'] * heat ** 0.8 * (age > 0) * np.clip(edge / 0.07, 0, 1) * cfg['sp_amp']
        for i in np.nonzero(v > 0.03)[0]:
            dr.line([(ax[i], ay[i]), (bx[i], by[i])], fill=float(v[i]), width=2)
    c = np.array(core)
    thin = ndi.gaussian_filter(c, 1.1)
    glow = ndi.gaussian_filter(c, 5.0) * cfg['glow'] + ndi.gaussian_filter(c, 16.0) * cfg['halo']
    # 스틱 자리의 섬광
    px = N / cfg['span']; sx, sy = proj(cfg, st['stick'][None, :])
    yy, xx = np.mgrid[0:N, 0:N]
    e = 1.0 if cfg.get('front') else math.sin(math.radians(cfg['elev']))
    d2 = ((xx - sx[0]) / (0.5 * px)) ** 2 + ((yy - sy[0]) / (0.5 * px * e)) ** 2
    flash = np.exp(-d2 * 2.2) * cfg['flash'] * sum(s['amp'] * math.exp(-max(0.0, t - s['t0']) / 0.03) for s in st['strokes'] if t >= s['t0'])
    white = thin * cfg['core'] + flash * 0.6
    col = glow + flash
    rgb = white[..., None] * np.array([1.0, 1.0, 1.0]) + col[..., None] * np.array(cfg['tint'])
    rgb = rgb.reshape(FR, SS, FR, SS, 3).mean((1, 3))
    return np.clip(1 - np.exp(-rgb * cfg['expo']), 0, 1)

DRUM = dict(stick=[0.08, 0.05], strokes=3, times=[0.0, 0.085, 0.19], amps=[1.0, 0.75, 0.5], life=0.17, t_grow=0.022, reach=2.6,
    surf=6, air=4, rim=1.0, air_h=1.5, air_out=0.9, disp=0.135, depth=6, levels=2, branch=2.0, fork=0.7, dim=0.5,
    core=3.4, glow=3.4, halo=3.0, flash=1.1, tint=[0.30, 0.74, 1.0], expo=1.7,
    frames=36, dur=0.36, tpow=1.3, span=3.6, elev=44, cy=0.66)
# 심벌: 면을 타는 방전은 줄이고, 가장자리에서 바깥으로 뻗는 방전과 튀는 불꽃을 더했다
CYMBAL = dict(DRUM, stick=[0.5, 0.25], surf=5, air=2, air_h=1.0, air_out=0.9, rimout=13, rim_len=0.9, rim_h=0.9,
    sparks=220, sp_out=8.5, sp_up=6.0, sp_grav=30.0, sp_expo=0.009, sp_life=0.22, sp_amp=1.0,
    elev=44, dur=0.36, times=[0.0, 0.075, 0.165], span=4.2, cy=0.62)
FRONT = dict(DRUM, stick=[0.0, 0.05], front=True, persp=0.45, surf=8, air=5, air_h=1.1, air_out=1.2, span=4.4, cy=0.50)
CFGS = dict(side=DRUM, cymbal=CYMBAL, front=FRONT)


def frames(cfg, seed):
    """설정과 씨앗으로 프레임 목록(높이×너비×3, 0~1)을 만든다."""
    st = build(cfg, seed)
    return [frame(cfg, st, t) for t in frame_times(cfg)]
