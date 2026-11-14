# 연속 그림 생성기 공통부: 그림 크기, 부드러운 계단, 잡음, 입자를 그림에 뿌리기, 프레임 시간표.
import numpy as np
from scipy import ndimage as ndi

FR, SS = 384, 2
N = FR * SS
G = 55.0  # 중력(헤드 반지름/초^2). 14인치 스네어 반지름 기준 실제 값

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

class Noise:
    def __init__(self, rng, feat):
        n = 256
        g = ndi.gaussian_filter(rng.standard_normal((n, n)), feat * 85 / 2.0, mode='wrap')
        self.g = g.ravel().argsort().argsort().reshape(n, n) / (n * n - 1.0)
        self.n = n
    def __call__(self, u, v):
        n = self.n
        c = np.stack([(v * 0.4 + 0.5) * (n - 1), (u * 0.4 + 0.5) * (n - 1)])
        return ndi.map_coordinates(self.g, c, order=1, mode='wrap')

def splat(sx, sy, w):
    x0 = np.floor(sx).astype(np.int64); y0 = np.floor(sy).astype(np.int64)
    fx = sx - x0; fy = sy - y0
    out = np.zeros(N * N)
    for dx, dy, ww in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi = x0 + dx; yi = y0 + dy
        ok = (xi >= 0) & (xi < N) & (yi >= 0) & (yi < N)
        out += np.bincount((yi[ok] * N + xi[ok]), weights=(w * ww)[ok], minlength=N * N)
    return out.reshape(N, N)

def frame_times(cfg):
    n = cfg['frames']
    return cfg['dur'] * (np.arange(n) / (n - 1)) ** cfg['tpow']
