"""
에어드럼 센서 스틱 v0.4 — 전부 3D 출력하는 스틱 (34cm), build123d 버전

버트(x=0) → 팁(x=340), z 위(뚜껑 쪽), 박스 칸 바닥 안쪽 = z FLOOR
  [끝면 USB-C 구멍] [원통 손잡이: C 암 머리 · 배터리 · LRA(손가락 자리)]
  [비스듬한 이음] [박스: 바닥 DRV + 위 Feather] [코] ← 끼움 → [앞부분 (M2 핀 고정)]

원본 stick_v4.py (manifold3d) 치수를 그대로 옮기고, 출력용으로 하나만 바꿨다:
  PRINT_FOOT — 박스 바닥을 손잡이 원통 바닥과 같은 높이까지 내려 박스 바닥을 베드에 평평하게 놓는다.
"""
import build123d as bd
from cadgen import model

# ── 부품 (※ 표시는 실측 필요) ────────────────────────────
FEATHER_L, FEATHER_W, FEATHER_W_WIRE, FEATHER_H = 50.8, 22.9, 25.5, 7.2
PCB_T, HOLE_INSET, HOLE_D = 1.6, 2.54, 2.5
USB_Z_ABOVE_PCB = 1.5                     # ※
BATT_L, BATT_W, BATT_H = 36.0, 12.0, 6.0
DRV_L, DRV_W, DRV_H = 25.6, 17.8, 3.5     # ※ 세로 배치
CAP_D, CAP_H = 6.3, 5.9
SW_L, SW_W, SW_H, SW_LEVER = 11.64, 4.05, 5.82, 1.6
TACT, TACT_Y = 6.0, 9.5                   # ※ 배터리 커넥터 반대쪽
LED_X_FROM_USB, LED_Y = 30.0, -5.0        # ※ NeoPixel (보드 USB 끝에서 거리)
LRA_D, LRA_H = 8.0, 3.2                   # ※
MICRO_HEAD = (10.5, 7.0, 16.0)            # ※ 마이크로5핀 수 머리 (w, h, l)
CF_HEAD = (12.0, 7.0, 20.0)               # ※ USB-C 암 머리 (w, h, l)
CABLE_D = 3.5                             # ※ 연장 케이블 굵기

# ── 치수 ────────────────────────────────────────────────
TOTAL_L = 340.0
WALL = FLOOR = LID_T = 1.2
LIP, LIP_CLR = 1.2, 0.15
WIRE_MARGIN = 2.0
BACK_GAP = 12.0

HANDLE_L = 120.0
HANDLE_ID = 15.8
HANDLE_OD = HANDLE_ID + 2 * WALL          # 18.2
TRANS_L = 10.0

CAV_W = FEATHER_W_WIRE + 2 * WIRE_MARGIN  # 29.5
PCB_Z0 = FLOOR + DRV_H + 1.0
PCB_Z1 = PCB_Z0 + PCB_T
CAV_H = (PCB_Z0 + FEATHER_H) - FLOOR + 0.5
Z_TOP = FLOOR + CAV_H
OUT_W = CAV_W + 2 * WALL                  # 31.9
OUT_H = Z_TOP + LID_T                     # 14.6
Z_AX = OUT_H / 2                          # 스틱 축 높이
USB_Z = PCB_Z1 + USB_Z_ABOVE_PCB
Z_BED = Z_AX - HANDLE_OD / 2              # 손잡이 원통 바닥 (-1.8)
PRINT_FOOT = True                         # 박스 바닥을 Z_BED 까지 내림 (출력 시 박스 바닥이 베드에 닿음)
Z_BOX0 = Z_BED if PRINT_FOOT else 0.0

X_TRANS1 = HANDLE_L + TRANS_L
X_CAV0 = X_TRANS1
X_FEATHER0 = X_CAV0 + BACK_GAP
X_FEATHER1 = X_FEATHER0 + FEATHER_L
X_CAV1 = X_FEATHER1 + 1.0
X_BOX_END = X_CAV1 + WALL
DRV_X0 = X_FEATHER0 + 1.0
SW_X0 = DRV_X0 + 7.0
CAP_XY = (X_CAV0 + 4.5, -(CAV_W / 2 - CAP_D / 2 - 0.6))
TACT_X = X_CAV0 + BACK_GAP / 2 + 0.5

NOSE_D, NOSE_L = 12.0, 15.0
X_NOSE1 = X_BOX_END + NOSE_L
SHAFT_D0, SHAFT_D1, TIP_D = 15.0, 9.5, 10.5

R_IN = HANDLE_ID / 2
CF_X0 = WALL
BATT_X0 = CF_X0 + CF_HEAD[2] + 1.0
_half = (R_IN ** 2 - (BATT_W / 2) ** 2) ** 0.5
BATT_Z0 = Z_AX - _half + 0.3
LRA_X = 92.0
LRA_R = (LRA_D + 0.4) / 2
LRA_WALL = 0.7                            # 손잡이 윗벽 최소 두께 (LRA 자리 가장자리)
LRA_TOP = Z_AX + ((HANDLE_OD / 2) ** 2 - LRA_R ** 2) ** 0.5 - LRA_WALL   # 자리 천장 (평면)

PIN_X = X_BOX_END + NOSE_L / 2
SNAP_X = (X_CAV0 + 20, X_FEATHER1 - 6)

PETG = "#5b5fc7"


# ── 도형 도우미 ─────────────────────────────────────────
def box(x0, x1, y0, y1, z0, z1):
    return bd.Box(x1 - x0, y1 - y0, z1 - z0, align=bd.Align.MIN).moved(bd.Location((x0, y0, z0)))


def cyl_x(x0, x1, r, y=0.0, z=Z_AX):
    c = bd.Cylinder(r, x1 - x0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return c.moved(bd.Location((x0, y, z), (0, 90, 0)))


def cyl_y(x, z, r, length):
    return bd.Cylinder(r, length).moved(bd.Location((x, 0, z), (90, 0, 0)))


def cyl_z(z0, z1, r, x, y):
    c = bd.Cylinder(r, z1 - z0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return c.moved(bd.Location((x, y, z0)))


def sphere(r, x, y, z):
    return bd.Sphere(r).moved(bd.Location((x, y, z)))


def yz_plane(x, z=0.0):
    return bd.Plane(origin=(x, 0, z), x_dir=(0, 1, 0), z_dir=(1, 0, 0))


# ── 부품 ────────────────────────────────────────────────
def handle_body():
    """손잡이 + 이음 + 박스 + 코 (한 덩어리)"""
    tube = cyl_x(0, HANDLE_L + 0.01, HANDLE_OD / 2)
    box_h = OUT_H - Z_BOX0
    z_mid = (OUT_H + Z_BOX0) / 2
    trans = bd.loft([
        yz_plane(HANDLE_L, Z_AX) * bd.Circle(HANDLE_OD / 2),
        yz_plane(X_TRANS1, z_mid) * bd.Rectangle(OUT_W, box_h),
    ], ruled=True)
    shell = box(X_TRANS1, X_BOX_END, -OUT_W / 2, OUT_W / 2, Z_BOX0, OUT_H)
    nose = cyl_x(X_BOX_END - 0.5, X_NOSE1, NOSE_D / 2)
    body = tube + trans + shell + nose

    body -= box(X_CAV0, X_CAV1, -CAV_W / 2, CAV_W / 2, FLOOR, 50)            # 박스 칸
    body -= box(X_TRANS1 - 0.6, X_BOX_END + 1, -OUT_W, OUT_W, Z_TOP, 50)      # 뚜껑 자리
    body -= cyl_x(WALL, HANDLE_L, R_IN)                                       # 손잡이 속
    # 이음 구간 통로: 천장을 뚜껑 선(Z_TOP)에서 잘라 이음 윗면이 뚫리지 않게
    body -= cyl_x(HANDLE_L - 0.01, X_CAV0 + 1, R_IN) & box(HANDLE_L - 1, X_CAV0 + 2, -R_IN - 1, R_IN + 1, -10, Z_TOP)

    cw, ch, _ = CF_HEAD                                                       # 끝면 USB-C 구멍
    body -= box(-1, WALL + 0.5, -cw / 2 - 0.3, cw / 2 + 0.3, Z_AX - ch / 2 - 0.3, Z_AX + ch / 2 + 0.3)
    rail_clip = cyl_x(BATT_X0, BATT_X0 + BATT_L, R_IN + 0.1)                  # 배터리 받침 2줄
    for y in (-3.5, 3.5):
        body += box(BATT_X0, BATT_X0 + BATT_L, y - 0.6, y + 0.6, Z_AX - R_IN - 0.5, BATT_Z0) & rail_clip
    # LRA 자리: 손잡이 윗벽 안쪽을 평평하게 파서 얇게 (가장자리 LRA_WALL, 가운데 약 1.7)
    body -= cyl_z(LRA_TOP - 4.0, LRA_TOP, LRA_R, LRA_X, 0)

    for y in (-6.0, 6.0):                                                     # Feather 앞쪽 받침
        body += box(DRV_X0 + DRV_L + 1.0, X_FEATHER1, y - 0.6, y + 0.6, FLOOR - 0.01, PCB_Z0)
    body += box(DRV_X0 + DRV_L + 0.3, DRV_X0 + DRV_L + 1.0, -4, 4, FLOOR - 0.01, FLOOR + 2.0)  # DRV 멈춤턱
    body -= box(SW_X0 + 2.5, SW_X0 + SW_L - 2.5, CAV_W / 2 - 1, OUT_W / 2 + 1,               # 스위치 레버 구멍
                FLOOR + SW_W / 2 - 1.1, FLOOR + SW_W / 2 + 1.1)
    for x in SNAP_X:                                                          # 뚜껑 스냅 홈
        for s in (-1, 1):
            body -= sphere(0.75, x, s * (CAV_W / 2), Z_TOP - LIP / 2)
    body -= cyl_y(PIN_X, Z_AX, 0.85, 30)                                     # M2 셀프탭 구멍
    return body


def lid_body():
    c = LIP_CLR
    lid = box(X_TRANS1, X_BOX_END, -OUT_W / 2, OUT_W / 2, Z_TOP, OUT_H)
    lip = box(X_CAV0 + c, X_CAV1 - c, -CAV_W / 2 + c, CAV_W / 2 - c, Z_TOP - LIP, Z_TOP + 0.01) - \
        box(X_CAV0 + c + 1.0, X_CAV1 - c - 1.0, -CAV_W / 2 + c + 1.0, CAV_W / 2 - c - 1.0, 0, 50)
    lip -= box(X_CAV0 - 1, X_FEATHER0 + 1, -CAV_W, CAV_W, 0, 50)             # 손잡이 쪽 끝은 비움 (케이블)
    lid += lip
    for x in SNAP_X:
        for s in (-1, 1):
            lid += sphere(0.6, x, s * (CAV_W / 2 - c - 0.25), Z_TOP - LIP / 2)
    for hx in (X_FEATHER0 + HOLE_INSET, X_FEATHER1 - HOLE_INSET):             # Feather 고정 기둥 + 핀
        for hy in (-(FEATHER_W / 2 - HOLE_INSET), FEATHER_W / 2 - HOLE_INSET):
            lid += cyl_z(PCB_Z1 + 0.1, Z_TOP + 0.01, 2.0, hx, hy)
            lid += cyl_z(PCB_Z1 - 1.4, PCB_Z1 + 0.2, HOLE_D / 2 - 0.25, hx, hy)
    lid -= cyl_z(Z_TOP - 1, OUT_H + 1, 1.9, TACT_X, TACT_Y)                   # 택트 누름 구멍
    ring = box(TACT_X - 3.9, TACT_X + 3.9, TACT_Y - 3.9, TACT_Y + 3.9, Z_TOP - 1.8, Z_TOP + 0.01) - \
        box(TACT_X - 3.15, TACT_X + 3.15, TACT_Y - 3.15, TACT_Y + 3.15, 0, 50)
    lid += ring & box(X_CAV0 + c, X_CAV1 - c, -CAV_W / 2 + c, CAV_W / 2 - c, 0, 50)
    lid -= cyl_z(Z_TOP - 1, OUT_H - 0.6, 2.5, X_FEATHER0 + LED_X_FROM_USB, LED_Y)  # LED 창 (0.6 남김)
    arrow = bd.Polygon((0, -2.5), (5, -2.5), (5, -4.5), (10, 0), (5, 4.5), (5, 2.5), (0, 2.5), align=None)
    lid -= bd.extrude(bd.Plane.XY.offset(OUT_H - 0.4) * arrow.moved(bd.Location((X_FEATHER1 - 18, 0))), 0.5)
    return lid


def shaft_body():
    sleeve = cyl_x(X_BOX_END + 0.2, X_NOSE1 + 0.5, SHAFT_D0 / 2)
    body_len = TOTAL_L - X_NOSE1 - TIP_D / 2
    cone = bd.Cone(SHAFT_D0 / 2, SHAFT_D1 / 2, body_len,
                   align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)).moved(
        bd.Location((X_NOSE1 + 0.5, 0, Z_AX), (0, 90, 0)))
    tip = bd.scale(bd.Sphere(TIP_D / 2), (1.3, 1, 1)).moved(bd.Location((TOTAL_L - TIP_D / 2 * 1.3, 0, Z_AX)))
    shaft = sleeve + cone + tip
    shaft -= cyl_x(X_BOX_END, X_NOSE1 + 0.3, (NOSE_D + 0.3) / 2)
    shaft -= cyl_y(PIN_X, Z_AX, 1.15, 30)
    return shaft


def dummy_parts():
    hw = FEATHER_W / 2
    mw, mh, ml = MICRO_HEAD
    cw, ch, cl = CF_HEAD
    feather = box(X_FEATHER0, X_FEATHER1, -hw, hw, PCB_Z0, PCB_Z1) + \
        box(X_FEATHER0 + 6, X_FEATHER1 - 6, -hw + 4, hw - 4, PCB_Z1, PCB_Z0 + FEATHER_H)
    for hx in (X_FEATHER0 + HOLE_INSET, X_FEATHER1 - HOLE_INSET):
        for hy in (-(hw - HOLE_INSET), hw - HOLE_INSET):
            feather -= cyl_z(-5, 30, HOLE_D / 2, hx, hy)
    return [
        ("feather", feather, "#2a9d74"),
        ("drv2605l", box(DRV_X0, DRV_X0 + DRV_L, -DRV_W / 2, DRV_W / 2, FLOOR, FLOOR + DRV_H), "#3a7bd5"),
        ("slide_switch", box(SW_X0, SW_X0 + SW_L, CAV_W / 2 - (SW_H - SW_LEVER), CAV_W / 2, FLOOR, FLOOR + SW_W), "#222222"),
        ("cap_220uF", cyl_z(FLOOR, FLOOR + CAP_H, CAP_D / 2, CAP_XY[0], CAP_XY[1]), "#c0392b"),
        ("tact", box(TACT_X - 3, TACT_X + 3, TACT_Y - 3, TACT_Y + 3, Z_TOP - 3.1, Z_TOP), "#333333"),
        ("micro_head", box(X_FEATHER0 - 0.2 - ml, X_FEATHER0 - 0.2, -mw / 2, mw / 2, USB_Z - mh / 2, USB_Z + mh / 2), "#aaaaaa"),
        ("cable", cyl_x(BATT_X0, X_CAV0, CABLE_D / 2, z=BATT_Z0 + BATT_H + 0.3 + CABLE_D / 2), "#888888"),
        ("battery", box(BATT_X0, BATT_X0 + BATT_L, -BATT_W / 2, BATT_W / 2, BATT_Z0, BATT_Z0 + BATT_H), "#e0a030"),
        ("usbc_head", box(CF_X0 - 1.2, CF_X0 - 1.2 + cl, -cw / 2, cw / 2, Z_AX - ch / 2, Z_AX + ch / 2), "#444444"),
        ("lra", cyl_z(LRA_TOP - LRA_H, LRA_TOP, LRA_D / 2, LRA_X, 0), "#e07a50"),
    ]


def labelled(shape, label, color):
    shape.label = label
    shape.color = color
    return shape


# ── 모델: 조립 위치 그대로 ─────────────────────────────
@model
def stick_handle():
    body = handle_body()
    bb = body.bounding_box()
    assert abs(bb.size.Z - HANDLE_OD) < 0.05, bb.size              # 박스 바닥이 원통 바닥과 같은 높이
    assert abs(bb.min.Z - Z_BED) < 0.05, bb.min
    return labelled(body, "handle", PETG)


@model
def stick_lid():
    return labelled(lid_body(), "lid", "#8e92e8")


@model
def stick_shaft():
    body = shaft_body()
    assert abs(body.bounding_box().max.X - TOTAL_L) < 0.05, body.bounding_box().max
    return labelled(body, "shaft", "#c9b48a")


@model
def stick_assembly():
    printed = [stick_handle().shape, stick_lid().shape, stick_shaft().shape]
    inside = [labelled(s, n, c) for n, s, c in dummy_parts()]
    electronics = bd.Compound(children=inside, label="electronics")
    asm = bd.Compound(children=printed + [electronics], label="stick_v4")
    assert abs(asm.bounding_box().size.X - TOTAL_L) < 0.1
    return asm


# ── 모델: 출력 방향 (베드 = z 0) ──────────────────────
@model
def print_handle():
    """박스 바닥을 베드에. 손잡이 원통 아래만 서포트."""
    return labelled(handle_body().moved(bd.Location((0, 0, -Z_BED))), "handle", PETG)


@model
def print_lid():
    """겉면(화살표)을 베드에, 기둥이 위로."""
    lid = lid_body().moved(bd.Location((0, 0, 0), (180, 0, 0)))
    lid = lid.moved(bd.Location((0, 0, -lid.bounding_box().min.Z)))
    return labelled(lid, "lid", "#8e92e8")


@model
def print_shaft():
    """눕혀서 (결이 길이 방향)."""
    s = shaft_body()
    s = s.moved(bd.Location((0, 0, -s.bounding_box().min.Z)))
    return labelled(s, "shaft", "#c9b48a")


if __name__ == "__main__":
    stick_assembly()
    print_handle()
    print_lid()
    print_shaft()
