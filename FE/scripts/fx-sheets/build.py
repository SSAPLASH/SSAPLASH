# 타격 이펙트 연속 그림 12장을 만든다. 사용법은 README.md.
# 같은 설정으로 24장을 384px로 그린 뒤 256px로 줄여 6열로 붙이고, 검은 바탕을 투명으로 바꿔 WebP로 저장한다.
# 이펙트 캔버스는 킷 위에 겹친 투명한 층이라, 검은 바탕 그대로 더하기 합성하면 검은 사각형이 킷을 가린다.
import argparse, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import water, fire, bolt  # noqa: E402

FRAMES, FRAME_PX, COLS = 24, 256, 6
# 묶음 id → (모듈, 설정 이름, 씨앗). 씨앗을 바꾸면 모양이 달라진다
SHEETS = {
    'water-side-a': (water, 'side', 7), 'water-side-b': (water, 'side', 21), 'water-cymbal': (water, 'cymbal', 3), 'water-front': (water, 'front', 5),
    'fire-side-a': (fire, 'side', 11), 'fire-side-b': (fire, 'side', 23), 'fire-cymbal': (fire, 'cymbal', 4), 'fire-front': (fire, 'front', 9),
    'bolt-side-a': (bolt, 'side', 5), 'bolt-side-b': (bolt, 'side', 13), 'bolt-cymbal': (bolt, 'cymbal', 2), 'bolt-front': (bolt, 'front', 8),
}
VERSION = 'v1'


def build(sheet_id, out_dir):
    mod, name, seed = SHEETS[sheet_id]
    cfg = dict(mod.CFGS[name], frames=FRAMES)
    big = Image.new('RGB', (COLS * FRAME_PX, math.ceil(FRAMES / COLS) * FRAME_PX))
    for i, im in enumerate(mod.frames(cfg, seed)):
        tile = Image.fromarray((im * 255).astype(np.uint8)).resize((FRAME_PX, FRAME_PX), Image.LANCZOS)
        big.paste(tile, ((i % COLS) * FRAME_PX, (i // COLS) * FRAME_PX))
    path = os.path.join(out_dir, f'{sheet_id}.{VERSION}.webp')
    # 가장 밝은 채널을 알파로 삼고 색을 그만큼 되돌린다(알파를 곱하면 원래 밝기가 된다).
    # 아주 어두운 곳은 투명으로 잘라 내고, 어두운 곳의 색은 흐린 그림에서 구해 잡음을 줄인다(용량이 절반쯤 된다)
    rgb = np.asarray(big, dtype=np.float64) / 255
    a = rgb.max(-1)
    col = np.where(a[..., None] > 1 / 255, rgb / np.maximum(a[..., None], 1e-6), 0)
    soft = np.stack([ndi.gaussian_filter(rgb[..., c], 2.0) for c in range(3)], -1)
    sa = soft.max(-1)
    w = np.clip(a / 0.25, 0, 1)[..., None]
    col = w * col + (1 - w) * np.where(sa[..., None] > 1e-3, soft / np.maximum(sa[..., None], 1e-6), 0)
    a = np.clip((a - 0.04) / 0.96, 0, 1)
    col = np.where(a[..., None] > 0, col, 0)
    rgba = (np.dstack([np.clip(col, 0, 1), a]) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgba).save(path, quality=84, alpha_quality=60, method=6)
    print(f'{path}  길이 {round(cfg["dur"] * 1000)}ms  지수 {cfg["tpow"]}  span {cfg["span"]}  cy {cfg["cy"]}')


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*', help='만들 묶음 id. 비우면 12장 모두')
    ap.add_argument('--out', default=os.path.join(here, '..', '..', 'public', 'fx'))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for sid in args.ids or SHEETS:
        build(sid, args.out)
