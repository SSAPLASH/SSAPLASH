# 물 테마 연속 그림: 얇은 물막을 입자 수만 개로 두고, 막 → 그물(가닥) → 방울 순서로 찢어지게 한 뒤
# 밀도를 임계값으로 잘라 이어진 액체처럼 칠한다. 결과는 검은 바탕의 밝은 그림이고, 저장할 때 build.py가 투명 바탕으로 바꾼다.
import math, numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from common import smooth, Noise, splat, frame_times, N, FR, SS, G

def build(cfg, seed):
    rng = np.random.default_rng(seed)
    M = cfg['M']
    i = np.arange(M) + 0.5
    r = np.sqrt(i / M) * cfg['r0']; th = i * 2.39996323
    u = r * np.cos(th) + rng.normal(0, 0.003, M); v = r * np.sin(th) + rng.normal(0, 0.003, M)
    # 구멍 씨앗: 막이 여기서부터 뚫려 경계선(가닥)으로 모인다
    K1 = cfg['holes']
    a = rng.uniform(0, 2 * np.pi, K1); rr = np.sqrt(rng.uniform(0, 1, K1)) * 1.02
    hs = np.stack([rr * np.cos(a), rr * np.sin(a)], 1)
    _, idx = cKDTree(hs).query(np.stack([u, v], 1), k=2)
    s1 = hs[idx[:, 0]]; s2 = hs[idx[:, 1]]
    e = s2 - s1; e /= np.linalg.norm(e, axis=1, keepdims=True) + 1e-9
    mid = (s1 + s2) / 2
    dist = (u - mid[:, 0]) * e[:, 0] + (v - mid[:, 1]) * e[:, 1]
    u1 = u - dist * e[:, 0] * cfg['lig']; v1 = v - dist * e[:, 1] * cfg['lig']
    hole_r = rng.uniform(0, 1, K1)[idx[:, 0]]
    # 방울 씨앗: 가닥 위의 점 일부. 가닥이 여기로 뭉친다
    K2 = cfg['beads']
    bi = rng.choice(M, K2, replace=False)
    bp = np.stack([u1[bi], v1[bi]], 1)
    _, b = cKDTree(bp).query(np.stack([u1, v1], 1), k=1)
    mass = np.bincount(b, minlength=K2).astype(float)
    bead_r = rng.uniform(0, 1, K2)
    bead_size = np.exp(rng.normal(-0.12, cfg.get('bead_var', 0.5), K2)).clip(0.4, 2.6)
    nz = [Noise(rng, f) for f in (cfg['feat'], cfg['feat'] * 0.38, 0.22, 0.22, 0.5)]
    stick = np.array(cfg['stick']) + rng.normal(0, 0.05, 2)
    return dict(rng=rng, u=u, v=v, u1=u1, v1=v1, b=b, bp=bp, mass=mass, hole_r=hole_r, bead_r=bead_r, bead_size=bead_size, nz=nz, stick=stick)

def field(cfg, st, u, v):
    n1, n2, n3, n4, n5 = (f(u, v) for f in st['nz'])
    r = np.hypot(u, v)
    mode = (np.clip(r, 0, 1) ** cfg['modep']) if cfg.get('edge_mode') else np.cos(np.clip(r / 0.99, 0, 1) * np.pi / 2) ** cfg['modep']
    jet = cfg['base'] + cfg['jet'] * n1 ** cfg['jetp'] + cfg['fine'] * n2
    du = u - st['stick'][0]; dv = v - st['stick'][1]; d = np.hypot(du, dv) + 1e-6
    crown = np.exp(-((d - cfg['crown_r']) / cfg['crown_w']) ** 2)
    vz = cfg['V'] * (mode * jet + cfg['crown'] * crown * (0.6 + 0.8 * n2))
    out = cfg['spread'] * (0.4 + 0.9 * n5) + cfg['flare'] * n1 ** cfg['jetp']
    vx = u * out + (n3 - 0.5) * cfg['lat'] + du / d * crown * cfg['crown_out']
    vy = v * out + (n4 - 0.5) * cfg['lat'] + dv / d * crown * cfg['crown_out']
    return vx, vy, vz

def project(cfg, x, y, z):
    px = N / cfg['span']
    if cfg.get('persp'):
        f = 1 + cfg['persp'] * z; x = x * f; y = y * f
    se, ce = math.sin(math.radians(cfg['elev'])), math.cos(math.radians(cfg['elev']))
    return N / 2 + x * px, N * cfg['cy'] + y * se * px - z * ce * px

def ballistic(cfg, u, v, vx, vy, vz, t, k):
    D = (1 - np.exp(-k * t)) / k
    if cfg.get('front'):  # 정면으로 선 헤드: 중력이 화면 아래(y)로 작용한다
        return u + vx * D, v + vy * D + G * (t - D) / k, vz * D
    return u + vx * D, v + vy * D, (vz + G / k) * D - G * t / k

def land_w(cfg, x, y, z):
    if cfg.get('front'):
        return np.clip(1 - (y - 1.1) / 0.5, 0, 1)
    inside = (x * x + y * y) < 1.0
    return np.where(inside, np.clip(1 + z / 0.05, 0, 1), np.clip(1 + (z + 0.2) / 0.35, 0, 1))

def render_frame(cfg, st, t):
    px = N / cfg['span']
    gfade = 1 - float(smooth(cfg['dur'] * cfg.get('fade0', 0.8), cfg['dur'], t))
    u, v, u1, v1, b = st['u'], st['v'], st['u1'], st['v1'], st['b']
    t1 = cfg['t1'] + st['hole_r'] * cfg['t1j']
    c1 = smooth(t1, t1 + cfg['d1'], t)
    t2b = cfg['t2'] + st['bead_r'] * cfg['t2j']
    c2b = smooth(t2b, t2b + cfg['d2'], t)
    c2 = c2b[b]
    ue = u + c1 * (u1 - u); ve = v + c1 * (v1 - v)
    ue = ue + c2 * (st['bp'][b, 0] - ue); ve = ve + c2 * (st['bp'][b, 1] - ve)
    vx, vy, vz = field(cfg, st, ue, ve)
    x, y, z = ballistic(cfg, ue, ve, vx, vy, vz, t, cfg['k'])
    w = land_w(cfg, x, y, z) * (1 - c2) * gfade * smooth(0, 0.004, t)
    sx, sy = project(cfg, x, y, z)
    dens0 = cfg['M'] / (math.pi * (cfg['r0'] * px) ** 2 * math.sin(math.radians(cfg['elev'])))
    F = ndi.gaussian_filter(splat(sx, sy, w), cfg['sig']) / (dens0 * cfg['T'])
    # 방울: 질량의 세제곱근에 비례한 반지름으로 직접 그린다
    bu, bv = st['bp'][:, 0], st['bp'][:, 1]
    bvx, bvy, bvz = field(cfg, st, bu, bv)
    bx, by, bz = ballistic(cfg, bu, bv, bvx, bvy, bvz, t, cfg['k'])
    bw = land_w(cfg, bx, by, bz) * c2b * gfade
    bx2, by2, bz2 = ballistic(cfg, bu, bv, bvx, bvy, bvz, t + 0.004, cfg['k'])
    ex, ey = project(cfg, bx2, by2, bz2)
    bsx, bsy = project(cfg, bx, by, bz)
    m = st['mass']; rb = cfg['rb'] * np.clip((m / (m.mean() + 1e-9)) ** (1 / 3), 0.45, 2.4) * st['bead_size']
    B = np.zeros((N, N))
    for j in np.nonzero((bw > 0.02) & (m > 0))[0]:
        R = rb[j] * (0.55 + 0.45 * bw[j]); s = R / 1.5
        cx, cy = bsx[j], bsy[j]
        dx, dy = ex[j] - cx, ey[j] - cy; sp = math.hypot(dx, dy)
        L = 1 + min(1.5, sp * cfg['streak'] / (2 * R)); ca, sa = (dx / sp, dy / sp) if sp > 1e-6 else (1.0, 0.0)
        pad = int(R * 3 * L) + 2
        x0, x1 = int(cx) - pad, int(cx) + pad + 1; y0, y1 = int(cy) - pad, int(cy) + pad + 1
        if x0 < 0 or y0 < 0 or x1 > N or y1 > N: continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        al = (xx - cx) * ca + (yy - cy) * sa; ac = -(xx - cx) * sa + (yy - cy) * ca
        B[y0:y1, x0:x1] += 3.08 * bw[j] * np.exp(-((al / L) ** 2 + (ac * L ** 0.35) ** 2) / (2 * s * s))
    F = F + B
    # 물안개: 임계값 없이 더하는 잔 입자
    ms = st['mist']
    kk = ms['k']; D = (1 - np.exp(-kk * t)) / kk
    mx = ms['u'] + ms['vx'] * D; my = ms['v'] + ms['vy'] * D; mz = (ms['vz'] + G * 0.5 / kk) * D - G * 0.5 * t / kk
    if cfg.get('front'): my = my + G * 0.5 * (t - D) / kk; mz = ms['vz'] * D
    mw = ms['w'] * smooth(0.0, 0.02, t) * (1 - smooth(ms['life'] * 0.45, ms['life'], t)) * (1.0 if cfg.get('front') else np.clip(1 + mz / 0.05, 0, 1))
    msx, msy = project(cfg, mx, my, mz)
    mist = splat(msx, msy, mw)
    return F, mist

def shade(cfg, F, mist):
    m = smooth(0.82, 1.18, F)
    h = np.clip((F - 1.0) / cfg['thick'], 0, 1)
    Fs = ndi.gaussian_filter(np.minimum(F, 1.0 + cfg['thick'] * 1.5), 1.2)
    gy, gx = np.gradient(Fs)
    nzc = cfg['nz']
    inv = 1 / np.sqrt(gx * gx + gy * gy + nzc * nzc)
    nx, ny, nzz = -gx * inv, -gy * inv, nzc * inv
    L = np.array([-0.45, -0.75, 0.48]); L = L / np.linalg.norm(L)
    Hh = L + np.array([0, 0, 1.0]); Hh = Hh / np.linalg.norm(Hh)
    spec = np.clip(nx * Hh[0] + ny * Hh[1] + nzz * Hh[2], 0, 1) ** cfg['shine']
    L2 = np.array([0.6, 0.5, 0.62]); H2 = L2 + np.array([0, 0, 1.0]); H2 = H2 / np.linalg.norm(H2)
    spec2 = np.clip(nx * H2[0] + ny * H2[1] + nzz * H2[2], 0, 1) ** (cfg['shine'] * 0.6)
    # 가장자리·작은 방울은 밝게, 넓은 막의 안쪽은 어둡게(유리 같은 역광 느낌)
    mb = ndi.gaussian_filter(m, cfg['edge_sig'])
    rim = 1 - smooth(0.42, 0.97, mb)
    lum = m * (cfg['fill'] + cfg['fill_h'] * h + cfg['rim'] * rim + cfg['spec'] * spec + cfg['spec'] * 0.35 * spec2)
    fine = ndi.gaussian_filter(mist, 1.1) * cfg['mist_a']
    haze = ndi.gaussian_filter(mist, 9.0) * cfg['haze_a']
    lum = lum + fine
    bloom = ndi.gaussian_filter(lum, 7.0) * cfg['bloom'] + ndi.gaussian_filter(lum, 22.0) * cfg['bloom'] * 0.6 + haze
    # 내려 줄이기(2배 과표본 → 1배)
    def down(a): return a.reshape(FR, SS, FR, SS).mean((1, 3))
    lum = down(lum); bloom = down(bloom)
    core = np.clip(lum, 0, 1.6)
    tint = np.array(cfg['tint']); white = np.array([1.0, 1.0, 1.0])
    k = np.clip(core, 0, 1)[..., None] ** 0.7
    rgb = core[..., None] * (tint * (1 - k) + white * k) + bloom[..., None] * np.array(cfg['glow'])
    rgb = 1 - np.exp(-rgb * cfg['expo'])  # 부드러운 톤 압축
    return np.clip(rgb, 0, 1)

def make_mist(cfg, st):
    rng = st['rng']; n = cfg['mist_n']
    a = rng.uniform(0, 2 * np.pi, n); r = np.sqrt(rng.uniform(0, 1, n)) * 0.9
    u = r * np.cos(a); v = r * np.sin(a)
    vx, vy, vz = field(cfg, st, u, v)
    sp = rng.uniform(0.7, 1.7, n)
    st['mist'] = dict(u=u, v=v, vx=vx * 1.6 + rng.normal(0, 1.4, n), vy=vy * 1.6 + rng.normal(0, 1.4, n),
                      vz=vz * sp + rng.uniform(1, 5, n), k=rng.uniform(4, 11, n), w=rng.uniform(0.3, 1.0, n) ** 2,
                      life=rng.uniform(0.25, 0.6, n) * cfg['dur'] / 0.62)

DRUM = dict(
    M=140000, r0=0.93, holes=230, beads=900, lig=0.93, feat=0.11, stick=[0.08, 0.05],
    modep=0.75, base=0.30, jet=1.0, jetp=2.4, fine=0.22, V=14.5, crown=0.42, crown_r=0.2, crown_w=0.07, crown_out=2.2,
    spread=1.3, flare=1.5, lat=1.6, edge_sig=3.2, k=1.1, span=3.8, elev=44, cy=0.66,
    t1=0.012, t1j=0.06, d1=0.08, t2=0.07, t2j=0.14, d2=0.10,
    sig=1.7, T=0.30, rb=4.2, thick=2.2, nz=0.55, shine=26, fill=0.05, fill_h=0.06, rim=1.2, spec=2.2,
    mist_n=3200, mist_a=3.0, haze_a=1.8, bloom=0.42, tint=[0.42, 0.74, 1.0], glow=[0.30, 0.62, 1.0], expo=1.6,
    frames=36, dur=0.64, tpow=1.5, streak=1.0,
)
# 심벌: 얇은 물막이 가장자리에서 가는 물보라로 털려 나간다
# 자주 치는 작은 패드라 드럼보다 덜 튀게 한다(솟는 높이·퍼지는 거리를 첫 판의 75%로, 방울·물안개 수도 줄였다)
CYMBAL = dict(DRUM, M=90000, holes=420, beads=850, feat=0.07, stick=[0.5, 0.3], edge_mode=True, modep=1.3,
    base=0.25, jet=0.9, jetp=2.0, fine=0.3, V=7.9, crown=0.5, crown_r=0.14, crown_w=0.06, crown_out=1.95,
    spread=2.55, flare=1.65, lat=1.65, elev=44, t1=0.004, t1j=0.03, d1=0.05, t2=0.035, t2j=0.09, d2=0.07,
    rb=3.1, bead_var=0.45, mist_n=3200, mist_a=3.4, dur=0.52, span=3.8, cy=0.62)
# 킥: 정면으로 선 헤드에서 물막이 앞으로 터져 나와 아래로 떨어진다
KICK = dict(DRUM, M=110000, holes=150, beads=1500, bead_var=0.6, front=True, persp=0.5, elev=90, span=3.6, cy=0.46,
    V=5.0, base=0.35, jet=1.0, crown=0.3, crown_out=1.6, spread=2.6, flare=2.4, lat=2.0, stick=[0.0, 0.1],
    t1=0.004, t1j=0.03, d1=0.05, t2=0.022, t2j=0.07, d2=0.06, rb=3.4, dur=0.52, fade0=0.6, mist_a=3.2)
CFGS = dict(side=DRUM, cymbal=CYMBAL, front=KICK)


def frames(cfg, seed):
    """설정과 씨앗으로 프레임 목록(높이×너비×3, 0~1)을 만든다."""
    st = build(cfg, seed); make_mist(cfg, st)
    return [shade(cfg, *render_frame(cfg, st, t)) for t in frame_times(cfg)]
