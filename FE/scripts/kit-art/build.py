"""실물 드럼 그림 만들기: 원본 이미지 → 조각 이미지(WebP) + 자리 표(src/domain/kit/kitArt.ts).

앱이 실행 중에 부르는 코드가 아니다. 원본 그림이 바뀌었을 때 개발자가 한 번 돌린다.
  python FE/scripts/kit-art/build.py        (Pillow · numpy · scipy 필요)
원본은 source/ 에 둔다(용량이 커서 저장소에 올리지 않는다). 영역은 regions.json 에 적는다.
확인용 그림은 out/ 에 나온다.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
FE = HERE.parents[1]
SPRITES = FE / "src" / "components" / "drum" / "acoustic"
TABLE = FE / "src" / "domain" / "kit" / "kitArt.ts"
KIT_W = 760  # 킷 단위: 내용 범위의 폭
ART_W = 160  # 그림 단위: 조각 상자의 폭
VIEW_NOTE = {"persp": "원근 그림(큰 킷)", "top": "위에서 본 그림(작은 킷)"}


def cutout(a):
    """한 가지 색 배경을 빼 투명하게 만든다. 그림자와 검은 통은 검정으로 남는다."""
    edge = np.concatenate([a[:40].reshape(-1, 3), a[-40:].reshape(-1, 3), a[:, :40].reshape(-1, 3), a[:, -40:].reshape(-1, 3)])
    bg = np.median(edge, 0)
    t = np.clip((np.abs(a - bg).max(2) - 5) / 12, 0, 1)
    alpha = t * t * (3 - 2 * t)
    col = np.clip((a - (bg + 6)) / (255 - (bg + 6)), 0, 1) ** 0.92
    # 원본에 그려진 하늘색 빛(스네어 테두리)을 지운다. 타격 표시는 화면이 그린다.
    # 밝은 곳(테두리 금속)은 은색으로 남기고, 어둡게 번진 빛은 투명하게 한다
    r, g, b = col[..., 0], col[..., 1], col[..., 2]
    w = np.clip((np.minimum(g, b) - r - 0.10) / 0.16, 0, 1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    keep = np.clip((lum - 0.22) / 0.3, 0, 1)
    col = col * (1 - w[..., None]) + (lum * w)[..., None]
    alpha = alpha * (1 - w * (1 - keep))
    return col, alpha


def cutout_texture(a):
    """무늬가 있는 어두운 바닥에서 물체만 남긴다: 밝은 곳·색이 있는 곳·아주 어두운 곳을 물체로 보고 안쪽 구멍을 메운다."""
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = a.max(2) - a.min(2)
    m = (lum > 64) | (sat > 36) | (lum < 8)
    m = ndi.binary_opening(m, iterations=1)  # 바닥 무늬의 점 잡음
    m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=4))
    m = ndi.binary_erosion(m, iterations=1)
    return a / 255, ndi.gaussian_filter(m.astype(np.float32), 1.2)


def shape_mask(spec, size):
    """손으로 적은 영역(타원·사각형·다각형)을 합친 마스크."""
    im = Image.new("L", size, 0)
    d = ImageDraw.Draw(im)
    if "ellipse" in spec:
        cx, cy, rx, ry = spec["ellipse"]
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    for rect in spec.get("rects", [spec["rect"]] if "rect" in spec else []):
        d.rectangle(rect, fill=255)
    if "polygon" in spec:
        d.polygon([tuple(p) for p in spec["polygon"]], fill=255)
    return np.asarray(im) > 0


def white_of(mask, a):
    """드럼 헤드의 흰 면. 헤드 무늬의 어두운 점은 메운다."""
    return ndi.binary_fill_holes(mask & (a.min(2) > 150) & (a.max(2) - a.min(2) < 45))


def gold_of(mask, a):
    return mask & (a[..., 0] > 110) & (a[..., 0] - a[..., 2] > 45)


def largest(m):
    lab, n = ndi.label(m)
    return m if n <= 1 else lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))


def disc_mask(parent, a):
    """심벌 원판: 그 덩어리의 금색 면. 가운데 너트처럼 금색에 둘러싸인 곳도 넣는다."""
    m = largest(ndi.binary_fill_holes(ndi.binary_closing(gold_of(parent, a), iterations=6)))
    return ndi.binary_dilation(m, iterations=2) & parent


def bbox(mask):
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def head_of(kind, mask, a):
    """헤드 타원(중심 x·y, 반지름 가로·세로, 원본 픽셀). kind가 없으면 그 조각의 상자."""
    if isinstance(kind, list):
        return [float(v) for v in kind]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if kind == "gold":  # 심벌 원판
        m = mask & (r > 150) & (r - b > 70)
    elif kind == "hoop":  # 킥 앞면의 금색 테
        m = mask & (r > 140) & (r - b > 60) & (g > 80)
    elif kind == "white":  # 드럼 헤드: 넓은 흰 면(가는 크롬은 깎아 낸다)
        m = ndi.binary_dilation(largest(ndi.binary_erosion(white_of(mask, a), iterations=8)), iterations=8)
    else:
        m = mask
    x0, y0, x1, y1 = bbox(m)
    return [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2]


def split_components(spec, a, alpha):
    """조각이 서로 떨어져 있는 그림: 이어진 덩어리 하나가 조각 하나다. 한 덩어리 안에서 나눌 것만 영역으로 적는다."""
    H, W = alpha.shape
    lab, _ = ndi.label(ndi.binary_closing(alpha > 0.5, iterations=6))
    grow = ndi.grey_dilation(lab, size=(5, 5))  # 가장자리의 반투명 픽셀까지 그 조각에 넣는다
    pieces = spec["pieces"]
    masks = {}
    for p in pieces:
        if "seed" in p:
            sx, sy = p["seed"]
            assert lab[sy, sx] > 0, f"{p['name']}: seed가 물체 위에 있지 않다"
            masks[p["name"]] = grow == lab[sy, sx]
    whole = dict(masks)  # 떼어 내기 전의 덩어리(헤드를 찾을 때 쓴다)
    for p in pieces:
        if "partOf" in p:
            parent = whole[p["partOf"]]
            masks[p["name"]] = disc_mask(parent, a) if p.get("disc") else parent & shape_mask(p, (W, H))
            whole[p["name"]] = masks[p["name"]]
    for p in pieces:
        for other in p.get("minus", []):
            masks[p["name"]] = masks[p["name"]] & ~masks[other]
    return masks, whole


def split_regions(spec, a, alpha):
    """조각이 붙어 있거나 겹친 그림(위에서 본 그림): 심벌 원판 → 손으로 적은 사각형 → 드럼 헤드 둘레 순으로 주인을 정하고,
    남은 픽셀(스탠드 등)은 가장 가까운 조각에 준다. 이 그림의 조각은 화면에서 자리를 옮기지 않아 다시 놓으면 원본과 같다."""
    H, W = alpha.shape
    solid = alpha > 0.5
    pieces = [p for p in spec["pieces"] if "shape" in p]
    gold_lab, _ = ndi.label(ndi.binary_fill_holes(ndi.binary_closing(gold_of(solid, a), iterations=4)))
    white_lab, _ = ndi.label(ndi.binary_erosion(white_of(solid, a), iterations=4))
    owner = np.zeros((H, W), np.int32)  # 0 = 주인 없음, i + 1 = pieces[i]
    discs = {}
    for i, p in enumerate(pieces):  # 심벌 원판이 맨 위다
        if p["shape"] == "cymbal":
            sx, sy = p["seed"]
            assert gold_lab[sy, sx] > 0, f"{p['name']}: seed가 원판 위에 있지 않다"
            discs[p["name"]] = ndi.binary_dilation(gold_lab == gold_lab[sy, sx], iterations=2) & solid
            owner[discs[p["name"]]] = i + 1
    for i, p in enumerate(pieces):
        if "rects" in p or "rect" in p:
            owner[shape_mask(p, (W, H)) & solid & (owner == 0)] = i + 1
    for i, p in enumerate(pieces):  # 드럼: 헤드에서 테두리·통만큼 넓힌다
        if p["shape"] == "drum":
            sx, sy = p["seed"]
            assert white_lab[sy, sx] > 0, f"{p['name']}: seed가 헤드 위에 있지 않다"
            body = ndi.binary_dilation(white_lab == white_lab[sy, sx], iterations=spec.get("drumGrow", 34)) & solid
            owner[body & (owner == 0)] = i + 1
    near = ndi.distance_transform_edt(owner == 0, return_distances=False, return_indices=True)
    rest = solid & (owner == 0)
    owner[rest] = owner[near[0][rest], near[1][rest]]
    masks, whole = {}, {}
    for i, p in enumerate(pieces):
        whole[p["name"]] = owner == i + 1
        masks[p["name"]] = whole[p["name"]] & ~discs.get(p["name"], np.zeros_like(solid))
    for p in spec["pieces"]:
        if p.get("top"):
            masks[p["name"]] = whole[p["name"]] = discs[p["partOf"]]
    return masks, whole


def r1(v):
    return round(float(v), 1)


def build(view, spec):
    a = np.asarray(Image.open(HERE / spec["source"]).convert("RGB")).astype(np.float32)
    textured = spec.get("background") == "texture"
    col, alpha = cutout_texture(a) if textured else cutout(a)
    masks, whole = split_regions(spec, a, alpha) if textured else split_components(spec, a, alpha)
    H, W = alpha.shape
    pieces = spec["pieces"]

    out_dir = SPRITES / view
    out_dir.mkdir(parents=True, exist_ok=True)
    (HERE / "out").mkdir(exist_ok=True)
    cx0, cy0, cx1, cy1 = spec["content"]
    k = KIT_W / (cx1 - cx0)
    rgba = np.dstack([col * 255, alpha * 255])
    boxes = {}
    for p in pieces:
        m = masks[p["name"]]
        assert m.any(), f"{p['name']}: 조각이 비었다"
        soft = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
        x0, y0, x1, y1 = bbox(m)
        x0, y0, x1, y1 = max(x0 - 2, 0), max(y0 - 2, 0), min(x1 + 2, W), min(y1 + 2, H)
        boxes[p["name"]] = (x0, y0, x1, y1)
        piece = rgba[y0:y1, x0:x1].copy()
        piece[..., 3] *= soft[y0:y1, x0:x1]
        im = Image.fromarray(piece.round().astype(np.uint8), "RGBA")
        im = im.resize((round((x1 - x0) * spec["scale"]), round((y1 - y0) * spec["scale"])), Image.LANCZOS)
        im.save(out_dir / f"{p['name']}.webp", quality=90, method=6)

    rows, heads = [], []
    for p in pieces:
        if "shape" not in p:
            continue  # 원판 조각은 받침 항목에 붙는다
        x0, y0, x1, y1 = boxes[p["name"]]
        u = ART_W / (x1 - x0)
        hx, hy, hrx, hry = head_of(p.get("head"), whole[p["name"]], a)
        heads.append((hx, hy, hrx, hry))
        head = {"cx": r1((hx - x0) * u), "cy": r1((hy - y0) * u), "rx": r1(hrx * u), "ry": r1(hry * u)}
        ring = {"cx": head["cx"], "cy": head["cy"], "rx": r1(head["rx"] * 1.09), "ry": r1(head["ry"] * 1.12)}
        box_h = r1((y1 - y0) * u)
        if p["shape"] == "kick":
            label_y = head["cy"] - head["ry"] * 0.5
        elif p["shape"] == "pedal":
            label_y = box_h + 12
        else:
            label_y = head["cy"] + head["ry"] + 14
        row = {
            "pad": p["pad"],
            "shape": p["shape"],
            "sprite": p["name"],
            "boxH": box_h,
            "head": head,
            "ring": ring,
            "label": {"x": head["cx"], "y": r1(label_y)},
            "judge": {"x": head["cx"], "y": r1(max(8, head["cy"] - head["ry"] - 10))},
            "badge": {"x": head["cx"], "y": r1(max(10, head["cy"] - head["ry"] - 14))},
            "kit": {"left": r1((x0 - cx0) * k), "top": r1((y0 - cy0) * k), "w": r1((x1 - x0) * k)},
        }
        top = next((t for t in pieces if t.get("top") and t.get("partOf") == p["name"]), None)
        if top:
            tx0, ty0, tx1, ty1 = boxes[top["name"]]
            row["top"] = {"sprite": top["name"], "x": r1((tx0 - x0) * u), "y": r1((ty0 - y0) * u), "w": r1((tx1 - tx0) * u), "h": r1((ty1 - ty0) * u)}
            if "closeDy" in top:
                row["top"]["closeDy"] = r1(top["closeDy"] * u)
        rows.append(row)

    # 확인용: 조각을 제자리에 다시 놓은 그림 위에 헤드 타원을 그린다
    check = Image.new("RGB", (W, H), (0, 0, 0))
    full = Image.fromarray(rgba.round().astype(np.uint8), "RGBA")
    for p in pieces:
        x0, y0, x1, y1 = boxes[p["name"]]
        piece = full.crop((x0, y0, x1, y1))
        keep = Image.fromarray((masks[p["name"]][y0:y1, x0:x1] * 255).astype(np.uint8))
        check.paste(piece, (x0, y0), Image.composite(piece.getchannel("A"), Image.new("L", piece.size, 0), keep))
    d = ImageDraw.Draw(check)
    for hx, hy, hrx, hry in heads:
        d.ellipse([hx - hrx, hy - hry, hx + hrx, hy + hry], outline=(255, 60, 60), width=max(3, W // 600))
    s = min(1.0, 1024 / max(W, H))
    check.resize((round(W * s), round(H * s)), Image.LANCZOS).save(HERE / "out" / f"{view}-check.jpg", quality=85)
    return {"box": {"w": KIT_W, "h": r1((cy1 - cy0) * k)}, "pads": rows}


def ts(value, level=1):
    """표를 TypeScript 리터럴로 적는다(값만 든 객체는 한 줄)."""
    pad = "  " * level
    end = "  " * (level - 1)
    if isinstance(value, dict):
        if all(not isinstance(v, (dict, list)) for v in value.values()):
            return "{ " + ", ".join(f"{key}: {ts(v)}" for key, v in value.items()) + " }"
        return "{\n" + "".join(f"{pad}{key}: {ts(v, level + 1)},\n" for key, v in value.items()) + end + "}"
    if isinstance(value, list):
        return "[\n" + "".join(f"{pad}{ts(v, level + 1)},\n" for v in value) + end + "]"
    if isinstance(value, str):
        return "'" + value + "'"
    return repr(value)


HEADER = """// 실물 드럼 그림의 패드별 자리 표. FE/scripts/kit-art/build.py가 만든다 — 손으로 고치지 않는다.
// 단위: head·ring·label·judge·badge·top은 조각 상자의 폭을 160으로 본 "그림 단위"(Pad가 쓰는 폭 160 기준과 같다),
// kit·box는 킷 단위(킷 폭 760)다. 이미지 파일은 components/drum/acoustic이 sprite 이름으로 찾는다.
import type { PadShape } from '../drumKit';
import type { PadId } from '../pads';

export interface ArtEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArtPoint {
  x: number;
  y: number;
}

export interface KitArtPad {
  pad: PadId;
  /** 타격 모션 종류를 정한다 */
  shape: PadShape;
  /** 조각 이미지 이름 */
  sprite: string;
  /** 조각 상자의 높이(폭은 160) */
  boxH: number;
  /** 헤드 타원: 누름 영역·번쩍임·이펙트 자리·자유 틀 크기 맞춤의 기준 */
  head: ArtEllipse;
  /** 상태 링·코칭 링 */
  ring: ArtEllipse;
  label: ArtPoint;
  judge: ArtPoint;
  badge: ArtPoint;
  /** 고정 배치에서 조각 상자의 왼쪽 위와 폭(킷 단위) */
  kit: { left: number; top: number; w: number };
  /** 심벌만: 흔들리는 원판 조각과 받침 상자 안에서의 자리. closeDy는 원근 그림의 하이햇만 — 닫힐 때 내려가는 거리 */
  top?: { sprite: string; x: number; y: number; w: number; h: number; closeDy?: number };
}

export interface KitArt {
  /** 킷 상자(킷 단위) */
  box: { w: number; h: number };
  /** 그리는 순서(뒤 → 앞) */
  pads: readonly KitArtPad[];
}
"""

FOOTER = """
/** 패드의 자리 항목. 그 그림에 없는 패드면 undefined */
export function kitArtPad(art: KitArt, pad: PadId): KitArtPad | undefined {
  return art.pads.find((p) => p.pad === pad);
}
"""

if __name__ == "__main__":
    spec = json.loads((HERE / "regions.json").read_text(encoding="utf-8"))
    body = ""
    for view, s in spec.items():
        art = build(view, s)
        body += f"\n/** {VIEW_NOTE[view]} */\nexport const KIT_ART_{view.upper()}: KitArt = {ts(art)};\n"
        print(view, art["box"], [p["sprite"] for p in art["pads"]])
    TABLE.write_text(HEADER + body + FOOTER, encoding="utf-8", newline="\n")
