"""
에어드럼 센서 스틱 v5 — CAD_v5_가이드 rev.2 + 사람이 정한 변경

버트(x=0) → 팁(x=TOTAL_L), z 위(뚜껑 쪽), +y = Feather 12핀·JST 쪽, -y = 16핀 쪽
  [그립 위/아래 반쪽: 암 머리 · 선 접는 칸 · LRA · 수 머리 · 이음 loft]
  (반쪽끼리 스냅 핀) ← 턱으로 물림 → [SPIGOT + 박스: Feather / DRV·배터리 + 코] ← M2 볼트+너트 → [앞부분]

가이드와 달라진 점 (사람이 결정):
  이음 loft 는 그립에 붙는다 (그립 186 → 196). SPIGOT 은 원통 대신 둥근 사각형(통로 14 × 8.5, MT527 아래로 LRA 선)이고
  나사 대신 둘레 턱으로 물린다. 납작면은 없다.
"""
import math

import build123d as bd
from cadgen import model

# ── 부품 (※ 표시는 실측 전 기본값) ────────────────────────
FEATHER_L, FEATHER_W, FEATHER_W_WIRE, FEATHER_H = 50.8, 22.9, 25.5, 7.2
PCB_T, HOLE_INSET, HOLE_D = 1.6, 2.54, 2.5
USB_Z_ABOVE_PCB = 1.5                     # ※
BATT_L, BATT_W, BATT_H, BATT_GAP = 35.0, 12.0, 6.0, 1.0   # ※ YJ601235
DRV_L, DRV_W, DRV_H, DRV_GAP = 25.6, 17.8, 3.5, 2.5       # ※ 배선 납땜 상태
CAP_D, CAP_H = 6.3, 5.9                   # ※
USER_BTN = (4.2, 2.8, 1.9)                # ※ Feather USER 버튼 (x, y, 높이)
USER_X_FROM_USB, USER_Y = 29.9, -5.6      # Adafruit Rev C .brd SW2
BLE_X_FROM_USB, BLE_Y, BLE_H = (35.0, 50.0), (-7.7, 7.8), 2.2   # ※ BLE 모듈 영역
JST_PLUG = (6.0, 4.5, 7.0)                # (폭, 높이, 길이). 보드 위에 올라앉는다
LED_X_FROM_USB, LED_Y = 19.5, -5.2        # Adafruit Rev C .brd
RESET_HOLE = True
RESET_X_FROM_USB, RESET_Y = 11.1, -5.2    # Adafruit Rev C .brd
LRA_D, LRA_H = 8.0, 3.2                   # ※
LRA_X = 130.0                             # ※ 잡아보고 정한다

EXT_F_HEAD = (13.0, 8.0, 40.0)            # ※ 암 머리 (폭, 높이, 길이)
EXT_M_HEAD = (13.0, 8.0, 40.0)            # ※ 수 머리 (금속 혀 제외한 몸통)
EXT_M_TONGUE = 6.5
EXT_CABLE_D = 5.0                         # ※
EXT_TOTAL_L = 200.0                       # ※ 끝에서 끝 (20cm, 도착 후 실측)
EXT_F_MOUTH = (9.0, 3.5)                  # ※
MT527_BODY = (10.9, 6.2, 27.0)            # (폭, 높이, 길이※). 고리는 잘라서 쓰므로 모델에 없음
MT527_MICRO = 6.5

# ── 치수 ────────────────────────────────────────────────
TOTAL_L = 406.0                           # ※ 5A 스틱 실측
PRINT_MAX = 250.0                         # ※ 프린터 판
GRIP_L = 120.0 + (TOTAL_L - 340.0)        # 그립 원통 길이 (186)
GRIP_OD = 18.2
TRANS_L = 10.0
FLOOR = 1.2
WALL_SIDE = 2.0
WALL_FRONT = 2.4                          # 코 뿌리 보강 (1.2 는 출력물에서 뜯김)
WALL_BACK = 1.6                           # 뚜껑 끝 멈춤
BACK_GAP = 14.0                           # ※ 뒷벽 → USB 끝
LID_T = 1.6
BUTT_WALL = 1.6
POCKET_CLR = 0.2                          # 머리 포켓 틈

CAV_W = 31.0                              # DRV 17.8 + 칸막이 0.6 + 배터리 12 + 여유
OUT_W = CAV_W + 2 * WALL_SIDE
WIRE_SIDE_EXTRA = 1.0                     # +y(배터리 커넥터·Bat·En 줄) 쪽 칸만 넓힘. 박스·뚜껑·레일도 +y 만
CAV_Y0, CAV_Y1 = -CAV_W / 2, CAV_W / 2 + WIRE_SIDE_EXTRA
OUT_Y0, OUT_Y1 = CAV_Y0 - WALL_SIDE, CAV_Y1 + WALL_SIDE
PCB_Z0 = FLOOR + max(DRV_H + DRV_GAP, BATT_H + BATT_GAP)
PCB_Z1 = PCB_Z0 + PCB_T
Z_TOP = PCB_Z0 + FEATHER_H + 0.5          # 칸 윗면 = 뚜껑 안쪽 면
OUT_H = Z_TOP + LID_T
USB_Z = PCB_Z1 + USB_Z_ABOVE_PCB
Z_AX = USB_Z                              # 손잡이 축 = USB 축
SHAFT_Z = OUT_H / 2                       # 앞부분 축 = 박스 높이 가운데

X_GRIP_END = GRIP_L + TRANS_L             # 그립 끝 = 박스 뒷면 (196)
GRIP_TRANS_L = 25.0                       # 이음 곡선 loft 길이 (앞 캡과 같은 곡선)
X_TRANS0 = X_GRIP_END - GRIP_TRANS_L      # 그립 원통 끝 = 이음 시작 (171)
X_BOX0 = X_GRIP_END
X_CAV0 = X_BOX0 + WALL_BACK
X_FEATHER0 = X_CAV0 + BACK_GAP
X_FEATHER1 = X_FEATHER0 + FEATHER_L
X_CAV1 = X_FEATHER1 + 1.0
X_BOX_END = X_CAV1 + WALL_FRONT

NOSE_D, NOSE_L = 12.0, 15.0
NOSE_CLR = 0.3                            # 코 ↔ 앞부분 구멍 한쪽 틈
NOSE_TIP_C = 1.0                          # 코 끝 모따기, 앞부분 구멍 입구 모따기
NOSE_ROOT_R = 1.0                         # 코 뿌리 (앞벽 바깥면) 둥글림
NOSE_SLOT_R = 0.5                         # 누름 기둥 홈이 코를 자른 모서리
X_NOSE1 = X_BOX_END + NOSE_L
SHAFT_D0, SHAFT_D1, TIP_D = 15.0, 9.5, 10.5
PIN_X = X_BOX_END + NOSE_L / 2
BOLT_HOLE_D = 2.2                         # M2 관통
BOLT_L = 20.0
NUT_POCKET_AF = 4.1
NUT_AF, NUT_T = 4.0, 1.6
NUT_SEAT_Y = SHAFT_D0 / 2                 # 너트·볼트 머리 받침면 |y| (코 구멍과 벽 1.35)
HEAD_D = 4.4                              # 볼트 머리 자리 (M2 머리 Ø3.8)
CAP_L = 25.0                              # 앞 캡 길이
BOX_R_BOT, BOX_R_TOP = 2.0, 1.0           # 박스 긴 모서리 R (아래, 위: 레일 턱 유지). 앞 캡·그립 이음 시작 단면도 같음

# 충전 경로: Feather ← 마이크로 ← MT527 ← 수 머리 ← 선 ← 암 머리 ← 버트
X_MT0 = X_FEATHER0 - 1.0 - MT527_BODY[2]  # MT527 C면
X_M1 = X_MT0
X_M0 = X_M1 - EXT_M_HEAD[2]
X_F0 = BUTT_WALL
X_F1 = X_F0 + EXT_F_HEAD[2]
PATH_L = X_MT0                            # 가이드 2-4: 버트 끝면 → MT527 C면
SLACK_L = EXT_TOTAL_L - PATH_L
FOLD = SLACK_L > 25.0                     # 이하면 접는 칸 없이 일자 선 홈 안에서 휘어 흡수
FOLD_L = SLACK_L / 2
CABLE_GROOVE_R = (EXT_CABLE_D + 0.6) / 2
FOLD_R = GRIP_OD / 2 - 1.0                # 접는 칸 반지름 (벽 1.0)
FOLD_X0 = X_F1 + 6.9                      # 앞쪽 나사·핀 자리 뒤에서 시작
FOLD_X1 = FOLD_X0 + FOLD_L + 2 * EXT_CABLE_D   # 양 끝 R(EXT_CABLE_D) 몫 포함

# SPIGOT: MT527 을 따라가는 둥근 사각형, 턱으로 물림
SPIGOT_L = 11.9                           # 수 머리 앞면과 SPIGOT 뒷면 틈 0.5
SPIGOT_WALL = 1.5
SPIGOT_R = 2.0
SPIGOT_IN = (14.0, 8.5)                   # 통로 (폭, 높이): MT527 아래로 진동모터 선이 지나간다
SPIGOT_IN_TOP = Z_AX + MT527_BODY[1] / 2 + 0.5   # 통로 천장 = MT527 윗면 + 0.5
Z_SPIGOT = SPIGOT_IN_TOP - SPIGOT_IN[1] / 2      # 통로·SPIGOT 중심: 늘어난 높이는 전부 아래로
SPIGOT_OUT = (SPIGOT_IN[0] + 2 * SPIGOT_WALL, SPIGOT_IN[1] + 2 * SPIGOT_WALL)
SPIGOT_IN_R = SPIGOT_R - SPIGOT_WALL      # 안쪽 모서리를 같은 중심으로 둥글려 벽을 일정하게
RIDGE_H, RIDGE_W = 0.8, 1.5
RIDGE_X0 = 185.0                          # 이음 곡선이 박스 높이로 내려오기 전: 턱 홈 윗벽 1.0 이상
FIT_CLR = 0.15                            # SPIGOT · 턱 ↔ 그립 홈 틈
X_SPIGOT0 = X_BOX0 - SPIGOT_L

# LRA
LRA_R = (LRA_D + 0.4) / 2
LRA_WALL = 0.7
LRA_TOP = Z_AX + ((GRIP_OD / 2) ** 2 - LRA_R ** 2) ** 0.5 - LRA_WALL
LRA_WIRE = (2.5, 1.3)                     # Ø1.2 두 가닥 나란히 (폭, 두께)
LRA_WIRE_CLR = 0.2                        # 선 홈 틈
LRA_DROP_X = LRA_X + LRA_D / 2            # 내려가는 구간 x 시작: x 140 핀 구멍 앞
LRA_DROP_Y = -4.05                        # 내려가는 구간 안쪽 면 y: 연장선 홈(R2.8) 옆

# 그립 결합: C자 클립 링이 조이고, 일자 정렬 핀(필라멘트 1.75 조각)이 맞춘다
ALIGN_D, ALIGN_DEPTH = 1.9, 3.5           # 정렬 핀 구멍: 반쪽마다 나누는 면에서 일자로
ALIGN_Y = 5.5
# 턱 쪽 한 쌍: x ≤ 189 는 SPIGOT 홈(|y| 9.45) 바깥이 그립 밖이라 불가. 턱 앞, 박스 쪽 넓은 구간에 둔다
ALIGN_RIDGE = (193.0, 12.5)
ALIGN_X = (45.0, 98.0, 120.0, 140.0) if FOLD else (45.0, 70.0, 98.0, 120.0, 140.0)   # x 70: 접는 칸 자리. x 98: 클립 홈(105) 과 떨어지게
ALIGN_PINS = tuple((x, y) for x in ALIGN_X for y in (-ALIGN_Y, ALIGN_Y)) + \
    ((ALIGN_RIDGE[0], -ALIGN_RIDGE[1]), ALIGN_RIDGE)
CLIP_X = (60.0, 105.0)                    # 클립 링 홈 가운데: LRA(130±5)·머리 포켓 구간 밖
CLIP_GROOVE_W, CLIP_GROOVE_D = 7.2, 1.5
CLIP_GROOVE_DIA = GRIP_OD - 2 * CLIP_GROOVE_D    # 홈 바닥 지름 15.2
CLIP_ID = CLIP_GROOVE_DIA - 0.2           # 링 안지름: 0.1 조여서 끼움
CLIP_T, CLIP_W = 1.5, 7.0                 # 링 두께(반경), 폭. 바깥 Ø18.0 ≈ 그립
CLIP_ARC = 235.0                          # 남기는 둘레 각
CLIP_END_R = 1.0
PRY_X = (110.0, 160.0) if FOLD else (70.0, 160.0)   # 드라이버 홈. 접는 칸이 있으면 x 70 은 그 벽(1.0)을 뚫는다
PRY_W, PRY_DEPTH, PRY_H = 4.0, 1.0, 2.0

# 박스 안 배치
BATT_X0 = X_FEATHER0 + 5.1
BATT_Y0 = CAV_W / 2 - 0.2 - BATT_W
DRV_X0 = X_FEATHER0 + 5.1
DRV_Y0 = -CAV_W / 2 + 0.2
LIP_H = 1.5
ANTENNA_X0 = X_FEATHER1 - 10.0
POST_D, PILOT_D = 4.5, 1.6
USER_X = X_FEATHER0 + USER_X_FROM_USB
BLE_X = (X_FEATHER0 + BLE_X_FROM_USB[0], X_FEATHER0 + BLE_X_FROM_USB[1])
CAP_XY = (X_CAV0 + 4.5, 11.0)
JST_X, JST_Y = X_FEATHER0 + 10.8, 6.5     # 플러그 중심 = 소켓 중심 (USB 끝에서 10.8, Rev C .brd)
JST_X0 = JST_X - JST_PLUG[2] / 2          # 플러그 뒷면: 선이 나오는 쪽

# 뚜껑
SLIDE_CLR = 0.2                           # ※
LID_HW0 = 16.2                            # 뚜껑 아랫면 반폭 (혀)
LID_HW1 = LID_HW0 - LID_T                 # 45°
TAB_X, TAB_Y, TAB_SLIT = 9.0, 7.0, 0.6    # 탭 가운데 = USER 버튼
LATCH_Y0, LATCH_Y1 = 12.2, 14.0           # 걸쇠 |y| 범위: Feather 폭 바깥, 레일 턱(14.8) 안쪽
LATCH_L = 14.0                            # 외팔보 길이
HOOK_H, HOOK_FLAT, HOOK_CLR = 0.6, 0.2, 0.05   # 갈고리 높이, 끝 평면, 앞벽과 틈
TAB_DROP = 1.0
PRESS_D = 2.5
PRESS_GAP = 0.2                           # 누름 기둥 아랫면 ↔ USER 버튼 윗면
PRESS_Z0 = PCB_Z1 + USER_BTN[2] + PRESS_GAP
PRESS_FLAT = 0.5                          # 기둥 아랫면 x 폭. 그 위로 ±x 45°
PRESS_FLEX = 0.5                          # 뚜껑 밀 때 탭이 휘는 양 (검사용)
PRESS_SLOT_CLR = 0.3                      # 앞벽 홈 ↔ 누름 기둥

PETG = "#5b5fc7"
PETG2 = "#8e92e8"


# ── 도형 도우미 ─────────────────────────────────────────
def box(x0, x1, y0, y1, z0, z1):
    return bd.Box(x1 - x0, y1 - y0, z1 - z0, align=bd.Align.MIN).moved(bd.Location((x0, y0, z0)))


def cyl_x(x0, x1, r, y=0.0, z=None):
    c = bd.Cylinder(r, x1 - x0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return c.moved(bd.Location((x0, y, Z_AX if z is None else z), (0, 90, 0)))


def cyl_y(x, z, r, length):
    return bd.Cylinder(r, length).moved(bd.Location((x, 0, z), (90, 0, 0)))


def cyl_z(z0, z1, r, x, y):
    c = bd.Cylinder(r, z1 - z0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    return c.moved(bd.Location((x, y, z0)))


def yz_plane(x, z=0.0):
    return bd.Plane(origin=(x, 0, z), x_dir=(0, 1, 0), z_dir=(1, 0, 0))


def prism_x(x0, x1, pts):
    """(y, z) 다각형을 x 방향으로 민다"""
    return bd.extrude(yz_plane(x0) * bd.Polygon(*pts, align=None), x1 - x0)


def rrect_x(x0, x1, w, h, r, z=None):
    """x 방향 둥근 사각 기둥 (폭 y, 높이 z)"""
    return bd.extrude(yz_plane(x0, Z_AX if z is None else z) * bd.RectangleRounded(w, h, r), x1 - x0)


def box_center(cx, cy, size, z0, z1):
    return box(cx - size / 2, cx + size / 2, cy - size / 2, cy + size / 2, z0, z1)


def labelled(shape, label, color):
    shape.label = label
    shape.color = color
    return shape


# ── 그립 ────────────────────────────────────────────────
def smooth_loft(x_rect, x_round, d, z_round):
    """박스 외곽(x_rect) → Ø d 원(x_round, 축 높이 z_round).
    단면 변화가 smoothstep 이라 양 끝 기울기 0: 박스 옆면·원통과 접선으로 이어진다. 앞 캡·그립 이음 공용"""
    w0, h0, yc0, zc0 = OUT_Y1 - OUT_Y0, OUT_H, (OUT_Y0 + OUT_Y1) / 2, OUT_H / 2
    secs = []
    for i in range(9):
        t = i / 8
        k = 3 * t * t - 2 * t ** 3
        w, h = w0 + (d - w0) * k, h0 + (d - h0) * k
        rb, rt = (min(r0 + (d / 2 - r0) * k, min(w, h) / 2 - 0.05) for r0 in (BOX_R_BOT, BOX_R_TOP))
        secs.append(yz_plane(x_rect + (x_round - x_rect) * t, zc0 + (z_round - zc0) * k) *
                    rect_2r(w, h, rb, rt).moved(bd.Location((yc0 * (1 - k), 0))))
    return bd.loft(secs)


def rect_2r(w, h, rb, rt):
    """아래 두 모서리 rb, 위 두 모서리 rt 인 사각형 (평면 y = 위)"""
    f = bd.Rectangle(w, h)
    f = bd.fillet(f.vertices().group_by(bd.Axis.Y)[0], rb)
    return bd.fillet(f.vertices().group_by(bd.Axis.Y)[-1], rt)


def grip_outer():
    return cyl_x(0, X_TRANS0 + 0.01, GRIP_OD / 2) + smooth_loft(X_GRIP_END, X_TRANS0, GRIP_OD, Z_AX)


def fold_chamber():
    c = cyl_x(FOLD_X0, FOLD_X1, FOLD_R)
    return bd.fillet(c.edges(), EXT_CABLE_D)                   # U자 꺾임 끝: R(EXT_CABLE_D)


def spigot_pocket():
    w, h = SPIGOT_OUT
    f = FIT_CLR
    p = rrect_x(X_SPIGOT0 - f, X_GRIP_END + 0.01, w + 2 * f, h + 2 * f, SPIGOT_R + f, Z_SPIGOT)
    p += rrect_x(RIDGE_X0 - f, RIDGE_X0 + RIDGE_W + f, w + 2 * (RIDGE_H + f), h + 2 * (RIDGE_H + f),
                 SPIGOT_R + RIDGE_H + f, Z_SPIGOT)
    return p


def lra_wire_path(c):
    """LRA 앞 → 위에서 -y 로 비켜 → 연장선 홈 옆으로 내려가 → 가운데로 → 수 머리 밑 → 통로 바닥 → 칸.
    c = 둘레 틈 (0 이면 선 더미)"""
    w, t = LRA_WIRE
    x0, x1 = LRA_DROP_X - c, LRA_DROP_X + w + c
    yd = LRA_DROP_Y
    z_hi = LRA_TOP - LRA_H + 0.03                               # LRA 바닥 높이로 나온다
    z_lo = Z_AX - EXT_M_HEAD[1] / 2 - t - 0.05                  # 수 머리 밑
    z_ps = SPIGOT_IN_TOP - SPIGOT_IN[1] + 0.05                  # 통로 바닥 위
    x_step = X_M1 + 0.2                                         # 수 머리 앞면 ↔ SPIGOT 사이에서 0.4 올라탄다
    return (box(x0, x1, yd - t - c, w / 2 + c, z_hi - c, z_hi + t + c)
            + box(x0, x1, yd - t - c, yd + c, z_lo - c, z_hi + t + c)
            + box(x0, x1, yd - t - c, w / 2 + c, z_lo - c, z_lo + t + c)
            + box(x0, x_step + 0.1, -w / 2 - c, w / 2 + c, z_lo - c, z_lo + t + c)
            + box(x_step - 0.1, X_CAV0 + 2.0, -w / 2 - c, w / 2 + c, z_ps - c, z_ps + t + c))


def f_pocket():
    w, h, l = EXT_F_HEAD
    c = POCKET_CLR
    return box(X_F0, X_F1 + c, -w / 2 - c, w / 2 + c, Z_AX - h / 2 - c, Z_AX + h / 2 + c)


def m_pocket():
    w, h, _ = EXT_M_HEAD
    c = POCKET_CLR
    return box(X_M0 - c, X_SPIGOT0, -w / 2 - c, w / 2 + c, Z_AX - h / 2 - c, Z_AX + h / 2 + c)


def grip_body():
    """나누기 전 그립: 부품에 맞춘 포켓과 홈"""
    body = grip_outer()
    mw, mh = EXT_F_MOUTH
    body -= box(-1, BUTT_WALL + 0.01, -mw / 2 - 0.2, mw / 2 + 0.2, Z_AX - mh / 2 - 0.2, Z_AX + mh / 2 + 0.2)
    body -= f_pocket()                                          # 뒷끝이 턱: 선 홈이 더 좁다
    body -= cyl_x(X_F1, X_M0, CABLE_GROOVE_R)
    if FOLD:
        body -= fold_chamber()
    body -= m_pocket()
    body -= spigot_pocket()
    body -= lra_wire_path(LRA_WIRE_CLR) & box(-1, X_GRIP_END + 0.01, -50, 50, -50, 50)   # LRA 선 홈 (위·아래 반쪽)
    for x, y in ALIGN_PINS:
        body -= align_hole(x, y)
    for x in CLIP_X:
        body -= clip_groove(x)
    for x in PRY_X:                                             # 나누는 면에 걸친 드라이버 홈
        for sy in (-1, 1):
            y0 = GRIP_OD / 2 - PRY_DEPTH
            body -= box(x - PRY_W / 2, x + PRY_W / 2, *sorted((sy * y0, sy * (GRIP_OD / 2 + 1))),
                        Z_AX - PRY_H / 2, Z_AX + PRY_H / 2)
    return body


def align_hole(x, y):
    """나누는 면 위아래로 일자 구멍 (언더컷 없음)"""
    return cyl_z(Z_AX - ALIGN_DEPTH, Z_AX + ALIGN_DEPTH, ALIGN_D / 2, x, y)


def clip_groove(x):
    """그립 겉면 둘레 홈"""
    x0, x1 = x - CLIP_GROOVE_W / 2, x + CLIP_GROOVE_W / 2
    return cyl_x(x0, x1, GRIP_OD / 2 + 1) - cyl_x(x0 - 1, x1 + 1, CLIP_GROOVE_DIA / 2)


def clip_ring_body(inner_d=CLIP_ID):
    """축 z, 바닥 z 0. 열린 쪽 가운데 +y. 열린 끝의 폭 방향 모서리 R CLIP_END_R"""
    ri, ro = inner_d / 2, inner_d / 2 + CLIP_T
    ring = bd.Cylinder(ro, CLIP_W, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)) - \
        bd.Cylinder(ri, CLIP_W, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    half = math.radians((360 - CLIP_ARC) / 2)
    far = ro * 3
    gap = bd.Polygon((0, 0), (far * math.sin(-half), far * math.cos(half)), (far * math.sin(half), far * math.cos(half)),
                     align=None)
    ring -= bd.extrude(gap, CLIP_W, dir=(0, 0, 1))
    ends = [e for e in ring.edges() if abs(e.length - CLIP_T) < 1e-3]   # 열린 끝 네 모서리 (반경 방향)
    return bd.fillet(ends, CLIP_END_R)


def split_box(lower):
    z0, z1 = (-50, Z_AX) if lower else (Z_AX, 50)
    return box(-5, X_GRIP_END + 5, -50, 50, z0, z1)


def grip_bottom_body():
    return grip_body() & split_box(True)


def grip_top_body():
    body = grip_body() & split_box(False)
    body -= cyl_z(Z_AX, LRA_TOP, LRA_R, LRA_X, 0)               # LRA 자리
    return body


# ── 박스 ────────────────────────────────────────────────
def feather_holes():
    hy = FEATHER_W / 2 - HOLE_INSET
    return [(x, y) for x in (X_FEATHER0 + HOLE_INSET, X_FEATHER1 - HOLE_INSET) for y in (-hy, hy)]


def lid_slot(x0, x1):
    """뚜껑이 지나는 자리: 45° 도브테일 홈 + 위로 터짐"""
    g0, g1 = LID_HW0 + SLIDE_CLR, LID_HW1 + SLIDE_CLR
    e = WIRE_SIDE_EXTRA
    return prism_x(x0, x1, [(-g0, Z_TOP), (g0 + e, Z_TOP), (g1 + e, OUT_H), (g1 + e, OUT_H + 1), (-g1, OUT_H + 1),
                            (-g1, OUT_H)])


def press_slot():
    """누름 기둥이 뚜껑과 함께 앞벽·코 위를 지나는 홈 (조립하면 앞부분이 덮는다)"""
    c = PRESS_SLOT_CLR
    return box(X_CAV1 - 0.01, X_NOSE1 + 0.01, USER_Y - PRESS_D / 2 - c, USER_Y + PRESS_D / 2 + c,
               PRESS_Z0 - c, Z_TOP + 0.01)


def nose_body():
    """뿌리 R NOSE_ROOT_R, 끝 모따기 NOSE_TIP_C. 누름 기둥 홈을 파고 그 x 방향 모서리를 R NOSE_SLOT_R"""
    r, x0, x1 = NOSE_D / 2, X_BOX_END - 0.5, X_NOSE1
    rr, c = NOSE_ROOT_R, NOSE_TIP_C
    p = lambda x, rad: bd.Vector(x, 0, SHAFT_Z + rad)
    a = math.radians(45)
    edges = [bd.Edge.make_line(p(x0, 0), p(x0, r + rr)), bd.Edge.make_line(p(x0, r + rr), p(X_BOX_END, r + rr)),
             bd.Edge.make_three_point_arc(p(X_BOX_END, r + rr),
                                          p(X_BOX_END + rr - rr * math.cos(a), r + rr - rr * math.sin(a)),
                                          p(X_BOX_END + rr, r)),
             bd.Edge.make_line(p(X_BOX_END + rr, r), p(x1 - c, r)), bd.Edge.make_line(p(x1 - c, r), p(x1, r - c)),
             bd.Edge.make_line(p(x1, r - c), p(x1, 0)), bd.Edge.make_line(p(x1, 0), p(x0, 0))]
    nose = bd.revolve(bd.Face(bd.Wire(edges)), bd.Axis((0, 0, SHAFT_Z), (1, 0, 0)))
    nose -= press_slot()
    on_skin = lambda e: abs(math.hypot(e.center().Y, e.center().Z - SHAFT_Z) - r) < 0.01    # 볼록 모서리만
    cut = [e for e in nose.edges()
           if e.geom_type == bd.GeomType.LINE and abs(e.tangent_at(0).X) > 0.999 and e.center().Y < -3 and on_skin(e)]
    assert len(cut) == 2, len(cut)
    return bd.fillet(cut, NOSE_SLOT_R)


def box_body():
    shell = box(X_BOX0, X_BOX_END, OUT_Y0, OUT_Y1, 0, OUT_H)
    shell = bd.fillet(shell.edges().filter_by(bd.Axis.X).group_by(bd.Axis.Z)[0], BOX_R_BOT)
    shell = bd.fillet(shell.edges().filter_by(bd.Axis.X).group_by(bd.Axis.Z)[-1], BOX_R_TOP)
    assert SHAFT_Z + NOSE_D / 2 < Z_TOP                         # 코 윗면이 뚜껑 아래: 뚜껑이 +x 로 빠진다
    nose = nose_body()
    w, h = SPIGOT_OUT
    spigot = rrect_x(X_SPIGOT0, X_BOX0 + 0.01, w, h, SPIGOT_R, Z_SPIGOT)
    ridge = rrect_x(RIDGE_X0, RIDGE_X0 + RIDGE_W, w + 2 * RIDGE_H, h + 2 * RIDGE_H, SPIGOT_R + RIDGE_H, Z_SPIGOT)
    body = shell + nose + spigot + ridge

    body -= box(X_CAV0, X_CAV1, CAV_Y0, CAV_Y1, FLOOR, Z_TOP + 0.01)          # 칸
    body -= lid_slot(X_CAV0, X_BOX_END + 1)
    # 통로 (SPIGOT·뒷벽): MT527 위 0.5, 아래는 LRA 선 자리
    body -= rrect_x(X_SPIGOT0 - 1, X_CAV0 + 0.01, SPIGOT_IN[0], SPIGOT_IN[1], SPIGOT_IN_R, Z_SPIGOT)
    body -= press_slot() & box(X_CAV1 - 0.01, X_BOX_END, -50, 50, -50, 50)   # 앞벽 부분 (코는 nose_body 에서)

    for x, y in feather_holes():                                # Feather 기둥 (M2×6 셀프탭)
        body += cyl_z(FLOOR - 0.01, PCB_Z0, POST_D / 2, x, y)
    for x, y in feather_holes():
        body -= cyl_z(PCB_Z0 - 5.0, PCB_Z0 + 0.01, PILOT_D / 2, x, y)

    # 배터리 턱: 앞·칸막이·뒤 일부. 선은 뒤쪽 +y 로 나간다
    bx1 = BATT_X0 + BATT_L
    by0 = BATT_Y0
    body += box(bx1 + 0.2, bx1 + 1.0, by0, by0 + BATT_W, FLOOR - 0.01, FLOOR + LIP_H)
    body += box(BATT_X0, bx1, by0 - 0.7, by0 - 0.1, FLOOR - 0.01, FLOOR + LIP_H)    # 칸막이
    # DRV 멈춤턱
    dx1 = DRV_X0 + DRV_L
    body += box(dx1 + 0.2, dx1 + 1.0, -13.0, -1.0, FLOOR - 0.01, FLOOR + 2.0)
    body += box(DRV_X0 - 1.0, DRV_X0 - 0.2, -5.0, -1.0, FLOOR - 0.01, FLOOR + 2.0)

    body -= cyl_y(PIN_X, SHAFT_Z, BOLT_HOLE_D / 2, 30)          # M2 볼트 관통
    return body


# ── 뚜껑 ────────────────────────────────────────────────
def add_latches(lid, x_wall, z_top, out_h):
    """앞(+x) 끝 U슬릿 외팔보 + 갈고리. 닫을 때 앞벽을 넘어가 벽 안쪽(x_wall)에 걸린다. 스틱·페달 공용"""
    s = TAB_SLIT
    z0, z1 = z_top - 1, out_h + 1
    x0, x1 = x_wall - LATCH_L, x_wall + s
    h = HOOK_H
    xh = x_wall - HOOK_CLR
    x_back = xh - 2 * h - HOOK_FLAT
    pts = [(xh, -(z_top + 0.01)), (xh, -z_top), (xh - h, -(z_top - h)), (xh - h - HOOK_FLAT, -(z_top - h)),
           (x_back, -z_top), (x_back, -(z_top + 0.01))]
    for y0, y1 in ((LATCH_Y0, LATCH_Y1), (-LATCH_Y1, -LATCH_Y0)):
        lid -= box(x0, x1, y0 - s, y0, z0, z1)                  # 긴 슬릿 2개
        lid -= box(x0, x1, y1, y1 + s, z0, z1)
        lid -= box(x_wall, x1, y0, y1, z0, z1)                  # 끝 슬릿 (U)
        pl = bd.Plane(origin=(0, y0, 0), x_dir=(1, 0, 0), z_dir=(0, 1, 0))
        lid += bd.extrude(pl * bd.Polygon(*pts, align=None), y1 - y0)
    return lid


def press_post():
    """Ø PRESS_D 누름 기둥. ±x 면 45°: 뚜껑을 밀 때 BLE 모듈을 타고 넘는다"""
    z0, z1, a = PRESS_Z0, Z_TOP + 0.01, PRESS_FLAT / 2
    r = PRESS_D / 2
    pl = bd.Plane(origin=(USER_X, USER_Y + r + 1, 0), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
    wedge = bd.extrude(pl * bd.Polygon((-a, z0), (a, z0), (a + z1 - z0, z1), (-a - (z1 - z0), z1), align=None),
                       2 * r + 2)
    return cyl_z(z0, z1, r, USER_X, USER_Y) & wedge


def lid_body(side):
    x0 = X_CAV0 + 0.1
    e = WIRE_SIDE_EXTRA
    lid = prism_x(x0, X_BOX_END, [(-LID_HW0, Z_TOP), (LID_HW0 + e, Z_TOP), (LID_HW1 + e, OUT_H), (-LID_HW1, OUT_H)])

    # USER 버튼 누름 탭: U자 슬릿, +x 쪽이 경첩. 윗면 TAB_DROP 낮게
    hx, hy, s = TAB_X / 2, TAB_Y / 2, TAB_SLIT
    cx, cy = USER_X, USER_Y
    z0, z1 = Z_TOP - 1, OUT_H + 1
    lid -= box(cx - hx, cx + hx, cy - hy, cy + hy, OUT_H - TAB_DROP, z1)
    lid -= box(cx - hx - s, cx + hx, cy - hy - s, cy - hy, z0, z1)
    lid -= box(cx - hx - s, cx + hx, cy + hy, cy + hy + s, z0, z1)
    lid -= box(cx - hx - s, cx - hx, cy - hy - s, cy + hy + s, z0, z1)
    lid += press_post()

    lid = add_latches(lid, X_CAV1, Z_TOP, OUT_H)

    # LED 창: 겉면 0.6 남김
    ell = bd.Ellipse(2.5, 4.0).moved(bd.Location((X_FEATHER0 + LED_X_FROM_USB, LED_Y)))
    lid -= bd.extrude(bd.Plane.XY.offset(Z_TOP - 1) * ell, OUT_H - 0.6 - (Z_TOP - 1))
    if RESET_HOLE:
        lid -= cyl_z(z0, z1, 1.0, X_FEATHER0 + RESET_X_FROM_USB, RESET_Y)

    # 화살표 + L / R 음각
    arrow = bd.Polygon((0, -2.5), (5, -2.5), (5, -4.5), (10, 0), (5, 4.5), (5, 2.5), (0, 2.5), align=None)
    lid -= bd.extrude(bd.Plane.XY.offset(OUT_H - 0.4) * arrow.moved(bd.Location((USER_X + TAB_X / 2 + 2, 0))), 0.5)
    letter = bd.Text(side, font_size=6.0 / 0.72).moved(bd.Location((X_FEATHER0 + 10, 7.0)))
    lid -= bd.extrude(bd.Plane.XY.offset(OUT_H - 0.4) * letter, 0.5)
    return lid


# ── 앞부분 (M2 볼트 + 너트) ─────────────────────────────
def hex_y(y_face, depth, af):
    """+y 쪽 면에서 -y 로 들어가는 육각 기둥. 꼭짓점이 ±z 라 눕혀 출력해도 천장이 선다"""
    r = af / 2 / math.cos(math.radians(30))
    pts = [(r * math.sin(math.radians(60 * k)), r * math.cos(math.radians(60 * k))) for k in range(6)]
    pl = bd.Plane(origin=(PIN_X, y_face, SHAFT_Z), x_dir=(1, 0, 0), z_dir=(0, -1, 0))
    return bd.extrude(pl * bd.Polygon(*pts, align=None), depth, dir=(0, -1, 0))


def front_cap():
    return smooth_loft(X_BOX_END, X_BOX_END + CAP_L, SHAFT_D0, SHAFT_Z)


def shaft_body():
    x_cone = X_BOX_END + CAP_L
    cone = bd.Cone(SHAFT_D0 / 2, SHAFT_D1 / 2, TOTAL_L - TIP_D / 2 + 0.5 - x_cone,
                   align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)).moved(
        bd.Location((x_cone - 0.01, 0, SHAFT_Z), (0, 90, 0)))
    tip = bd.scale(bd.Sphere(TIP_D / 2), (1.3, 1, 1)).moved(bd.Location((TOTAL_L - TIP_D / 2 * 1.3, 0, SHAFT_Z)))
    shaft = front_cap() + cone + tip
    rb = NOSE_D / 2 + NOSE_CLR
    shaft -= cyl_x(X_BOX_END - 0.01, X_NOSE1 + 0.3, rb, z=SHAFT_Z)                    # 코 자리
    c = NOSE_TIP_C                                              # 입구 모따기: 코 뿌리 R 도 비켜 간다
    shaft -= bd.Cone(rb + c + 0.01, rb, c + 0.01, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)).moved(
        bd.Location((X_BOX_END - 0.01, 0, SHAFT_Z), (0, 90, 0)))
    shaft -= cyl_y(PIN_X, SHAFT_Z, BOLT_HOLE_D / 2, 60)
    shaft -= hex_y(30, 30 - NUT_SEAT_Y, NUT_POCKET_AF)          # +y: 겉면 → 너트 받침까지 육각 통로
    shaft -= bd.Cylinder(HEAD_D / 2, 30, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN)).moved(
        bd.Location((PIN_X, -NUT_SEAT_Y, SHAFT_Z), (90, 0, 0)))  # -y: 볼트 머리 통로
    return shaft


# ── 전자부품 더미 ───────────────────────────────────────
LEAD_W = 1.5
LEAD_LOW_Y = (4.6, 6.1)                   # 배터리 쪽 아래 구간: Feather 기둥(y 6.66~) 안쪽


def batt_lead():
    """플러그 뒷면 → -x 로 보드 끝을 넘어 → 내려가 → 배터리 뒷면. +y 벽에서 떨어져 지나간다"""
    x_up, z0 = X_FEATHER0 - 3.0, 4.0
    ya, yb = JST_Y - LEAD_W / 2, JST_Y + LEAD_W / 2
    return (box(x_up, JST_X0, ya, yb, PCB_Z1, PCB_Z1 + LEAD_W)
            + box(x_up, x_up + LEAD_W, ya, yb, z0, PCB_Z1 + LEAD_W)
            + box(x_up, BATT_X0, *LEAD_LOW_Y, z0, z0 + LEAD_W))


BATT_LEAD_L = (JST_X0 - (X_FEATHER0 - 3.0)) + (PCB_Z1 + LEAD_W - 4.0) + (BATT_X0 - (X_FEATHER0 - 3.0))


def bolt_dummy():
    y0 = -NUT_SEAT_Y
    shank = bd.Cylinder(1.0, BOLT_L).moved(bd.Location((PIN_X, y0 + BOLT_L / 2, SHAFT_Z), (90, 0, 0)))
    head = bd.Cylinder(1.9, 1.6).moved(bd.Location((PIN_X, y0 - 0.8, SHAFT_Z), (90, 0, 0)))
    return shank + head


def dummy_parts():
    hw = FEATHER_W / 2
    feather = box(X_FEATHER0, X_FEATHER1, -hw, hw, PCB_Z0, PCB_Z1)     # 판. 위 부품은 따로 (USER·BLE·JST)
    for hx, hy in feather_holes():
        feather -= cyl_z(-5, 30, HOLE_D / 2, hx, hy)
    mw, mh, ml = MT527_BODY
    mt527 = box(X_MT0, X_MT0 + ml, -mw / 2, mw / 2, Z_AX - mh / 2, Z_AX + mh / 2) + \
        box(X_MT0 + ml, X_MT0 + ml + MT527_MICRO, -3.5, 3.5, Z_AX - 0.9, Z_AX + 0.9)
    fw, fh, _ = EXT_F_HEAD
    jw, jh, jl = JST_PLUG
    bx, by, bh = USER_BTN
    return [
        ("feather", feather, "#2a9d74"),
        ("user_btn", box(USER_X - bx / 2, USER_X + bx / 2, USER_Y - by / 2, USER_Y + by / 2, PCB_Z1, PCB_Z1 + bh),
         "#333333"),
        ("ble_module", box(*BLE_X, *BLE_Y, PCB_Z1, PCB_Z1 + BLE_H), "#b8b8b8"),
        ("drv2605l", box(DRV_X0, DRV_X0 + DRV_L, DRV_Y0, DRV_Y0 + DRV_W, FLOOR, FLOOR + DRV_H), "#3a7bd5"),
        ("battery", box(BATT_X0, BATT_X0 + BATT_L, BATT_Y0, BATT_Y0 + BATT_W, FLOOR, FLOOR + BATT_H), "#e0a030"),
        ("cap_220uF", cyl_z(FLOOR, FLOOR + CAP_H, CAP_D / 2, *CAP_XY), "#c0392b"),
        ("jst_plug", box(JST_X0, JST_X0 + jl, JST_Y - jw / 2, JST_Y + jw / 2, PCB_Z1, PCB_Z1 + jh), "#dddddd"),
        ("batt_lead", batt_lead(), "#cc3333"),
        ("mt527", mt527, "#aaaaaa"),
        ("ext_m_head", box(X_M0, X_M1, -fw / 2, fw / 2, Z_AX - fh / 2, Z_AX + fh / 2), "#555555"),
        ("ext_cable", cyl_x(X_F1, X_M0, EXT_CABLE_D / 2), "#888888"),
        ("ext_f_head", box(X_F0, X_F1, -fw / 2, fw / 2, Z_AX - fh / 2, Z_AX + fh / 2), "#444444"),
        ("lra", cyl_z(LRA_TOP - LRA_H, LRA_TOP, LRA_D / 2, LRA_X, 0), "#e07a50"),
        ("lra_wire", lra_wire_path(0), "#d04040"),
        ("m2_bolt", bolt_dummy(), "#999999"),
        ("m2_nut", hex_y(NUT_SEAT_Y + NUT_T, NUT_T, NUT_AF), "#999999"),
    ]


# ── 모델: 조립 위치 ─────────────────────────────────────
@model
def grip_bottom():
    return labelled(grip_bottom_body(), "grip_bottom", PETG)


@model
def grip_top():
    return labelled(grip_top_body(), "grip_top", PETG2)


@model
def stick_box():
    return labelled(box_body(), "box", PETG)


@model
def lid_L():
    return labelled(lid_body("L"), "lid_L", PETG2)


@model
def lid_R():
    return labelled(lid_body("R"), "lid_R", PETG2)


@model
def shaft():
    body = shaft_body()
    assert abs(body.bounding_box().max.X - TOTAL_L) < 0.05, body.bounding_box().max
    return labelled(body, "shaft", "#c9b48a")


@model
def clip_ring():
    return labelled(clip_ring_body(), "clip_ring", "#e8e8e8")


def placed_clips():
    """끼운 상태(안지름 = 홈 바닥)로 홈에. 열린 쪽이 위(+z): 260° 가 나누는 면 양쪽을 감싼다"""
    ring = clip_ring_body(CLIP_GROOVE_DIA).moved(bd.Location((0, 0, -CLIP_W / 2)))
    ring = ring.rotate(bd.Axis.Y, 90).rotate(bd.Axis.X, 90)
    return [labelled(ring.moved(bd.Location((x, 0, Z_AX))), f"clip_ring_{i}", "#e8e8e8") for i, x in enumerate(CLIP_X)]


def placed_align_pins():
    """필라멘트 1.75 조각 (길이 = 구멍 합 - 0.4)"""
    l = 2 * ALIGN_DEPTH - 0.4
    return [labelled(cyl_z(Z_AX - l / 2, Z_AX + l / 2, 1.75 / 2, x, y), f"align_pin_{i}", "#f0f0f0")
            for i, (x, y) in enumerate(ALIGN_PINS)]


@model
def stick_v5_assembly():
    printed = [grip_bottom().shape, grip_top().shape, stick_box().shape, lid_L().shape, shaft().shape] + \
        placed_clips() + placed_align_pins()
    inside = [labelled(s, n, c) for n, s, c in dummy_parts()]
    asm = bd.Compound(children=printed + [bd.Compound(children=inside, label="electronics")], label="stick_v5")
    assert abs(asm.bounding_box().size.X - TOTAL_L) < 0.1
    return asm


def cut_section(x):
    """x 에서 자른 앞쪽 (렌더용)"""
    keep = box(x, TOTAL_L + 5, -50, 50, -50, 50)
    parts = [(grip_bottom_body(), "grip_bottom", PETG), (grip_top_body(), "grip_top", PETG2),
             (box_body(), "box", PETG), (lid_body("L"), "lid", PETG2)] + \
        [(s, n, c) for n, s, c in dummy_parts()]
    out = []
    for s, n, c in parts:
        cut = s & keep
        if cut is not None and cut.volume > 0.001:
            out.append(labelled(cut, n, c))
    return bd.Compound(children=out, label="section")


@model
def section_box():
    return cut_section(USER_X)


@model
def section_grip():
    return cut_section(LRA_X)


# ── 모델: 출력 방향 (베드 = z 0) ────────────────────────
def on_bed(shape, flip):
    if flip:
        shape = shape.moved(bd.Location((0, 0, 0), (180, 0, 0)))
    return shape.moved(bd.Location((0, 0, -shape.bounding_box().min.Z)))


@model
def stick_v5_grip_bottom():
    """나누는 면을 베드에."""
    return labelled(on_bed(grip_bottom_body(), True), "grip_bottom", PETG)


@model
def stick_v5_grip_top():
    """나누는 면을 베드에."""
    return labelled(on_bed(grip_top_body(), False), "grip_top", PETG2)


@model
def stick_v5_box():
    """바닥을 베드에. SPIGOT 아래만 서포트."""
    return labelled(on_bed(box_body(), False), "box", PETG)


@model
def stick_v5_lid_L():
    """겉면을 베드에."""
    return labelled(on_bed(lid_body("L"), True), "lid_L", PETG2)


@model
def stick_v5_lid_R():
    """겉면을 베드에."""
    return labelled(on_bed(lid_body("R"), True), "lid_R", PETG2)


@model
def stick_v5_shaft():
    """눕혀서 (결이 길이 방향)."""
    return labelled(on_bed(shaft_body(), False), "shaft", "#c9b48a")


@model
def stick_v5_clip_ring():
    """눕혀서 (축이 세로, 옆면이 베드). 2개 출력."""
    return labelled(clip_ring_body(), "clip_ring", "#e8e8e8")


if __name__ == "__main__":
    stick_v5_assembly()
    stick_v5_grip_bottom()
    stick_v5_grip_top()
    stick_v5_box()
    stick_v5_lid_L()
    stick_v5_lid_R()
    stick_v5_shaft()
    stick_v5_clip_ring()
    section_box()
    section_grip()
