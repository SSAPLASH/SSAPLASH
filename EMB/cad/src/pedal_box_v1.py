"""
페달 박스 v1 — Feather + LiPo + 불 들어오는 전원 버튼 + 풋스위치 케이블 2가닥 (GND·A0·A1 핀헤더 + 점퍼 하우징)

x=0 USB 벽(바깥) → +x 케이블 벽. 뚜껑은 스틱과 같은 슬라이드 + 딸깍 (+x 로 연다), M2 나사 1개로 추가 잠금.
벨크로는 칸을 지나지 않게 바닥 양옆 귀의 슬롯으로 받는다.
"""
import build123d as bd
from cadgen import model

from stick_v5 import (BATT_GAP, BATT_H, BATT_L, BATT_W, FEATHER_H, FEATHER_L, FEATHER_W, FLOOR as _STICK_FLOOR, HOLE_D,
                      HOLE_INSET, LID_HW0, LID_HW1, LID_T, LED_X_FROM_USB, LED_Y, PCB_T, PILOT_D, POST_D,
                      SLIDE_CLR, USB_Z_ABOVE_PCB, WALL_SIDE, add_latches, box, box_center, cyl_z, labelled, on_bed,
                      prism_x)

FS_CABLE_D = 4.5                          # ※ 풋스위치 케이블 피복
MICRO_PLUG = (10.5, 7.0)                  # ※ 마이크로5핀 수 머리 (폭, 높이)

# 핀헤더: Feather 16핀 줄(-y)의 GND·A0·A1 에 직선 핀헤더 + 점퍼 3핀 하우징
HEADER_STACK_H = 17.0                     # ※ 보드 윗면 → 하우징 윗면
HEADER_LID_GAP = 2.0                      # 하우징 윗면 ↔ 뚜껑 밑면 (이상)
HDR_PITCH = 2.54
HDR_X0_FROM_USB = 6.35                    # ※ 16핀 줄 첫 핀(RST) x: 줄이 판 가운데라고 봄
HDR_PINS = (3, 4, 5)                      # RST, 3V, AREF, GND, A0, A1 … 의 GND·A0·A1

# 전원 버튼: 불 들어오는 버튼, 받침 기둥 위
BTN_HEAD_D, BTN_H, BTN_BODY = 10.0, 9.5, (6.5, 5.6)   # 머리 Ø, 전체 높이, 몸통 (x, y)
BTN_HEAD_T = 2.0                          # ※ 머리 두께
BTN_HOLE_D = 10.5
BTN_DROP = 1.0                            # 머리 윗면이 뚜껑 윗면보다 낮은 양
BTN_SEAT = 1.5                            # 기둥 윗면 홈 깊이 (몸통 자리)

FLOOR = 2.2                               # 고무발 자리 1.0 을 파도 1.2 남게
WALL_END = 1.6
END_GAP = 16.0                            # Feather 뒤: 버튼 기둥 · 케이블 묶는 자리 · 잠금 나사
CAV_W = 31.0
OUT_W = CAV_W + 2 * WALL_SIDE
PCB_Z0 = FLOOR + BATT_H + BATT_GAP
PCB_Z1 = PCB_Z0 + PCB_T
USB_Z = PCB_Z1 + USB_Z_ABOVE_PCB
Z_TOP = max(PCB_Z0 + FEATHER_H + 0.5, PCB_Z1 + HEADER_STACK_H + HEADER_LID_GAP)   # 하우징 위 2mm
OUT_H = Z_TOP + LID_T

X_CAV0 = WALL_END
X_F0 = X_CAV0 + 1.0
X_F1 = X_F0 + FEATHER_L
X_CAV1 = X_F1 + END_GAP
X_END = X_CAV1 + WALL_END

BATT_X0 = X_F0 + 5.1                      # 나사 기둥 뒤, 안테나 구간(USB 반대쪽 10) 앞
BTN_X, BTN_Y = X_F1 + 5.0, 0.0            # 기둥이 Feather 끝·케이블 사이, 구멍이 잠금 나사와 떨어지게
BTN_TOP = OUT_H - BTN_DROP
BTN_Z0 = BTN_TOP - BTN_H                  # 버튼 밑면 = 기둥 홈 바닥
HDR_Y = -(FEATHER_W / 2 - 1.27)
HDR_XS = [X_F0 + HDR_X0_FROM_USB + i * HDR_PITCH for i in HDR_PINS]
CABLE_Y, CABLE_Z = 8.0, FLOOR + 5.0
TIE_X, TIE_Y, TIE_D = X_CAV1 - 3.5, 13.0, 3.0
LOCK_X = X_CAV1 - 1.0
EAR_W, SLOT_L, SLOT_W = 6.0, 20.0, 3.0
EAR_X = (X_END - SLOT_L - 4.0) / 2
FOOT_D, FOOT_H = 8.0, 1.0

PETG = "#5b5fc7"
PETG2 = "#8e92e8"


def holes():
    hy = FEATHER_W / 2 - HOLE_INSET
    return [(x, y) for x in (X_F0 + HOLE_INSET, X_F1 - HOLE_INSET) for y in (-hy, hy)]


def cyl_x_at(x0, x1, r, y, z):
    c = bd.Cylinder(r, x1 - x0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return c.moved(bd.Location((x0, y, z), (0, 90, 0)))


def base_body():
    body = box(0, X_END, -OUT_W / 2, OUT_W / 2, 0, OUT_H)
    body += box(EAR_X, EAR_X + SLOT_L + 4, -OUT_W / 2 - EAR_W, OUT_W / 2 + EAR_W, 0, FLOOR)   # 벨크로 귀
    body -= box(X_CAV0, X_CAV1, -CAV_W / 2, CAV_W / 2, FLOOR, Z_TOP + 0.01)
    g0, g1 = LID_HW0 + SLIDE_CLR, LID_HW1 + SLIDE_CLR
    body -= prism_x(X_CAV0, X_END + 1, [(-g0, Z_TOP), (g0, Z_TOP), (g1, OUT_H), (g1, OUT_H + 1),
                                        (-g1, OUT_H + 1), (-g1, OUT_H)])
    for s in (-1, 1):                                           # 벨크로 슬롯
        yc = s * (OUT_W / 2 + EAR_W / 2 + 0.4)
        body -= box(EAR_X + 2, EAR_X + 2 + SLOT_L, yc - SLOT_W / 2, yc + SLOT_W / 2, -1, FLOOR + 1)

    # USB 마이크로 구멍 (젠더 없이 바로)
    w, h = MICRO_PLUG
    body -= box(-1, X_CAV0 + 0.01, -w / 2 - 0.3, w / 2 + 0.3, USB_Z - h / 2 - 0.3, USB_Z + h / 2 + 0.3)

    # 케이블 입구 2개
    r = (FS_CABLE_D + 0.4) / 2
    for s in (-1, 1):
        body -= cyl_x_at(X_CAV1 - 0.01, X_END + 1, r, s * CABLE_Y, CABLE_Z)
    # K / H 음각 (케이블 벽 바깥)
    for ch, y in (("K", CABLE_Y), ("H", -CABLE_Y)):
        t = bd.Text(ch, font_size=4.0 / 0.72)
        pl = bd.Plane(origin=(X_END, y, CABLE_Z + r + 2.4), x_dir=(0, 1, 0), z_dir=(-1, 0, 0))
        body -= bd.extrude(pl * t, 0.4)

    for x, y in holes():
        body += cyl_z(FLOOR - 0.01, PCB_Z0, POST_D / 2, x, y)
    for x, y in holes():
        body -= cyl_z(PCB_Z0 - 5.0, PCB_Z0 + 0.01, PILOT_D / 2, x, y)

    # 배터리 턱
    bx1 = BATT_X0 + BATT_L
    body += box(bx1 + 0.2, bx1 + 1.0, -BATT_W / 2, BATT_W / 2, FLOOR - 0.01, FLOOR + 1.5)
    for s in (-1, 1):
        y0 = s * (BATT_W / 2 + 0.1)
        y1 = y0 + s * 0.6
        body += box(BATT_X0 + 1, bx1 - 1, min(y0, y1), max(y0, y1), FLOOR - 0.01, FLOOR + 1.5)

    # 버튼 받침 기둥: 윗면 홈에 몸통이 앉고, 속은 다리·선 자리, 아래 -x 쪽 창으로 선이 나간다
    bx, by = BTN_BODY
    body += box(BTN_X - bx / 2 - 1.2, BTN_X + bx / 2 + 1.2, BTN_Y - by / 2 - 1.2, BTN_Y + by / 2 + 1.2,
                FLOOR - 0.01, BTN_Z0 + BTN_SEAT)
    body -= box(BTN_X - bx / 2 - 0.1, BTN_X + bx / 2 + 0.1, BTN_Y - by / 2 - 0.1, BTN_Y + by / 2 + 0.1,
                BTN_Z0, BTN_Z0 + BTN_SEAT + 0.01)
    body -= box(BTN_X - 2.0, BTN_X + 2.0, BTN_Y - 1.8, BTN_Y + 1.8, FLOOR + 1.0, BTN_Z0 + 0.01)
    body -= box(BTN_X - bx / 2 - 2, BTN_X, BTN_Y - 1.5, BTN_Y + 1.5, FLOOR + 1.0, FLOOR + 6.0)

    # 케이블 타이 기둥 (당겨도 납땜이 안 뜯기게)
    for s in (-1, 1):
        body += cyl_z(FLOOR - 0.01, CABLE_Z + 3.0, TIE_D / 2, TIE_X, s * TIE_Y)

    # 추가 잠금 M2 보스
    body += cyl_z(FLOOR - 0.01, Z_TOP, 2.25, LOCK_X, 0) & box(X_CAV1 - 4, X_CAV1 + 0.5, -3, 3, 0, Z_TOP)
    body -= cyl_z(Z_TOP - 5.0, Z_TOP + 0.01, PILOT_D / 2, LOCK_X, 0)

    # 바닥 밑면 고무발 자리
    for x in (6.0, X_END - 6.0):
        for y in (-OUT_W / 2 + 6.0, OUT_W / 2 - 6.0):
            body -= cyl_z(-0.01, FOOT_H, FOOT_D / 2, x, y)
    return body


def lid_body():
    lid = prism_x(X_CAV0 + 0.1, X_END, [(-LID_HW0, Z_TOP), (LID_HW0, Z_TOP), (LID_HW1, OUT_H), (-LID_HW1, OUT_H)])
    z0, z1 = Z_TOP - 1, OUT_H + 1
    # 버튼 구멍. 머리가 뚜껑 밑면 위로 올라와 있으니, 뚜껑을 +x 로 열 때 머리가 지나는 밑면 홈 (-x 끝까지)
    r = BTN_HOLE_D / 2
    lid -= cyl_z(z0, z1, r, BTN_X, BTN_Y)
    lid -= box(X_CAV0 - 1, BTN_X, BTN_Y - r, BTN_Y + r, z0, BTN_TOP + 0.3)

    lid = add_latches(lid, X_CAV1, Z_TOP, OUT_H)

    ell = bd.Ellipse(2.5, 4.0).moved(bd.Location((X_F0 + LED_X_FROM_USB, LED_Y)))
    lid -= bd.extrude(bd.Plane.XY.offset(Z_TOP - 1) * ell, OUT_H - 0.6 - (Z_TOP - 1))

    lid -= cyl_z(z0, z1, 1.1, LOCK_X, 0)                        # 잠금 나사
    lid -= bd.Cone(1.1, 2.0, 0.9, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)).moved(
        bd.Location((LOCK_X, 0, OUT_H - 0.9)))
    return lid


def dummy_parts():
    hw = FEATHER_W / 2
    feather = box(X_F0, X_F1, -hw, hw, PCB_Z0, PCB_Z1) + \
        box(X_F0 + 6, X_F1 - 6, -hw + 4, hw - 4, PCB_Z1, PCB_Z0 + FEATHER_H)
    for hx, hy in holes():
        feather -= cyl_z(-5, 30, HOLE_D / 2, hx, hy)
    bx, by = BTN_BODY
    button = box(BTN_X - bx / 2, BTN_X + bx / 2, BTN_Y - by / 2, BTN_Y + by / 2, BTN_Z0, BTN_TOP - BTN_HEAD_T + 0.01) + \
        cyl_z(BTN_TOP - BTN_HEAD_T, BTN_TOP, BTN_HEAD_D / 2, BTN_X, BTN_Y)
    p = HDR_PITCH
    header = box(HDR_XS[0] - p / 2, HDR_XS[-1] + p / 2, HDR_Y - p / 2, HDR_Y + p / 2, PCB_Z1, PCB_Z1 + HEADER_STACK_H)
    parts = [
        ("feather", feather, "#2a9d74"),
        ("battery", box(BATT_X0, BATT_X0 + BATT_L, -BATT_W / 2, BATT_W / 2, FLOOR, FLOOR + BATT_H), "#e0a030"),
        ("power_button", button, "#d0d0d0"),
        ("header_jumper", header, "#222222"),
    ]
    r = FS_CABLE_D / 2
    for name, s in (("kick", 1), ("hihat", -1)):
        parts.append((f"cable_{name}", cyl_x_at(X_CAV1 - 6.0, X_END + 15, r, s * CABLE_Y, CABLE_Z), "#888888"))
    return parts


@model
def pedal_base():
    return labelled(base_body(), "base", PETG)


@model
def pedal_lid():
    return labelled(lid_body(), "lid", PETG2)


@model
def pedal_box_v1_assembly():
    inside = [labelled(s, n, c) for n, s, c in dummy_parts()]
    return bd.Compound(children=[pedal_base().shape, pedal_lid().shape, bd.Compound(children=inside, label="electronics")],
                       label="pedal_box_v1")


@model
def pedal_box_v1_base():
    """바닥을 베드에. 고무발 자리는 얕아서 서포트 없음."""
    return labelled(on_bed(base_body(), False), "base", PETG)


@model
def pedal_box_v1_lid():
    """겉면을 베드에."""
    return labelled(on_bed(lid_body(), True), "lid", PETG2)


if __name__ == "__main__":
    pedal_box_v1_assembly()
    pedal_box_v1_base()
    pedal_box_v1_lid()
    import itertools
    base, lid = pedal_base().shape, pedal_lid().shape
    ov = lambda a, b: sum(s.volume for s in (a & b).solids()) if (a & b) is not None else 0.0
    print("base solids", len(base.solids()), "lid solids", len(lid.solids()))
    print("size", base.bounding_box().size, "lid x base", round(ov(base, lid), 3))
    parts = dummy_parts()
    for n, s, _ in parts:
        print(f"  {n:12s} x housing {ov(s, base) + ov(s, lid):.3f}")
    for (na, a, _), (nb, b, _) in itertools.combinations(parts, 2):
        print(f"  {na:12s} x {nb:12s} {ov(a, b):.3f}")
    print("slot/foot floor left", FLOOR - FOOT_H, " battery end", BATT_X0 + BATT_L, " antenna start", X_F1 - 10)
    hdr = dict((n, s) for n, s, _ in parts)["header_jumper"]
    from cadgen.geometry import closest_points
    print(f"header top z {PCB_Z1 + HEADER_STACK_H:.2f} / lid underside {Z_TOP:.2f} -> gap "
          f"{closest_points(hdr, lid).distance:.2f} (>= {HEADER_LID_GAP}), pins x {[round(x, 2) for x in HDR_XS]} y {HDR_Y:.2f}")
    btn = dict((n, s) for n, s, _ in parts)["power_button"]
    print(f"button top z {BTN_TOP:.2f} / lid top {OUT_H:.2f} (drop {OUT_H - BTN_TOP:.2f}), bottom z {BTN_Z0:.2f}, "
          f"button-lid gap {closest_points(btn, lid).distance:.2f}, button-base gap {closest_points(btn, base).distance:.2f}")
    worst = 0.0
    for dx in [i * 0.5 for i in range(int((X_END - X_CAV0) / 0.5) + 1)]:   # 뚜껑을 +x 로 여는 동안
        worst = max(worst, ov(btn, lid.moved(bd.Location((dx, 0, 0)))))
    print(f"lid slide-open x button worst overlap {worst:.3f}")
    print("box size", round(X_END, 1), OUT_W + 0, round(OUT_H, 2))
    print("mass g", round(base.volume / 1000 * 1.27, 1), round(lid.volume / 1000 * 1.27, 1))
