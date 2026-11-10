"""스틱 v5 검사 (가이드 6장). 모든 겹침 < 0.3 mm3"""
import itertools
import math

import build123d as bd
from cadgen.geometry import closest_points

import stick_v5 as s

PETG_G_PER_CM3 = 1.27
LIMIT = 0.3

printed = {"grip_bottom": s.grip_bottom().shape, "grip_top": s.grip_top().shape, "box": s.stick_box().shape,
           "lid_L": s.lid_L().shape, "lid_R": s.lid_R().shape, "shaft": s.shaft().shape}
dummies = {n: shape for n, shape, _ in s.dummy_parts()}
posts = None
bad = []


def overlap(a, b):
    r = a & b
    return sum(x.volume for x in r.solids()) if r is not None else 0.0


def report(label, v):
    flag = "OK" if v < LIMIT else "<-- 초과"
    if v >= LIMIT:
        bad.append(label)
    print(f"  {label:32s} {v:8.3f} mm3  {flag}")


print("== 전자부품 x 출력부품 ==")
housing = [v for k, v in printed.items() if k != "lid_R"]
for name, shape in dummies.items():
    report(name, sum(overlap(shape, p) for p in housing))

print("== 전자부품끼리 ==")
posts = [s.cyl_z(s.FLOOR, s.PCB_Z0, s.POST_D / 2, x, y) for x, y in s.feather_holes()]
report("battery x drv", overlap(dummies["battery"], dummies["drv2605l"]))
report("battery x 나사기둥", sum(overlap(dummies["battery"], p) for p in posts))
report("drv x 나사기둥", sum(overlap(dummies["drv2605l"], p) for p in posts))
for n in ("mt527", "jst_plug", "ble_module"):
    report(f"user_btn x {n}", overlap(dummies["user_btn"], dummies[n]))
report("ble_module x jst_plug", overlap(dummies["ble_module"], dummies["jst_plug"]))
report("jst_plug x cap", overlap(dummies["jst_plug"], dummies["cap_220uF"]))
report("jst_plug x mt527", overlap(dummies["jst_plug"], dummies["mt527"]))
report("cap x mt527", overlap(dummies["cap_220uF"], dummies["mt527"]))
for n in ("ext_m_head", "mt527", "ext_cable"):
    report(f"lra x {n}", overlap(dummies["lra"], dummies[n]))
for n in ("lra", "ext_m_head", "mt527", "ext_cable", "ext_f_head"):
    report(f"lra_wire x {n}", overlap(dummies["lra_wire"], dummies[n]))

print("== 선 접는 칸 x 핀 구멍·LRA ==")
print(f"  남는 길이 {s.SLACK_L:.1f} mm (EXT_TOTAL_L {s.EXT_TOTAL_L:.0f} - 경로 {s.PATH_L:.1f}) → "
      f"{'접는 칸 있음' if s.FOLD else '접는 칸 없음 (≤ 25, 일자 선 홈)'}")
if s.FOLD:
    fold = s.fold_chamber()
    for x, y in s.ALIGN_PINS:
        report(f"접는 칸 x 핀 구멍 ({x:.0f}, {y:+.1f})", overlap(fold, s.align_hole(x, y)))
    report("접는 칸 x LRA 홈", overlap(fold, s.lra_groove()))
    next_hole = min(x - s.ALIGN_D / 2 - 0.8 for x, _ in s.ALIGN_PINS if x > s.FOLD_X0)
    fold_margin = next_hole - s.FOLD_X1
    print(f"  다음 핀 구멍(벽 0.8 포함)까지 여유 {fold_margin:.2f} mm → EXT_TOTAL_L 상한 약 {s.EXT_TOTAL_L + 2 * fold_margin:.1f}")
else:
    cab = f"선 {s.EXT_CABLE_D:.1f} x {s.EXT_CABLE_H:.1f}"
    print(f"  가정: 남는 길이 {s.SLACK_L:.1f} 은 일자 선 홈(Ø{2 * s.CABLE_GROOVE_R:.1f}, {cab}) 안에서 휘어 흡수 → 접는 칸 없음")
    groove_l = s.X_M0 - s.X_F1
    print(f"  일자 선 홈 x {s.X_F1:.1f}–{s.X_M0:.1f} (길이 {groove_l:.1f}, 목 칸 포함), 홈 Ø{2 * s.CABLE_GROOVE_R:.1f} / {cab}")

slack_ok = 1.0 - 1e-6 <= s.SLACK_L <= 1.5 + 1e-6               # 11/10 실측: 여유 1.0
if not slack_ok:
    bad.append("연장선 남는 길이 1.0 ~ 1.5")
print(f"  남는 길이 {s.SLACK_L:+.2f} (기준 1.0 ~ 1.5)  {'OK' if slack_ok else '<-- 범위 밖'}")
print(f"  그립 원통 {s.GRIP_L:.1f} (단축 {s.GRIP_SHORTEN}), 그립 끝 = 박스 뒷면 x {s.X_GRIP_END:.1f}, TOTAL_L {s.TOTAL_L}")

print("== 틈 ≥ 1.0 ==")
ml, mw, mh = s.MT527_BODY[2], s.MT527_BODY[0], s.MT527_BODY[1]
mt_body = s.box(s.X_MT0, s.X_MT0 + ml, -mw / 2, mw / 2, s.Z_AX - mh / 2, s.Z_AX + mh / 2)
for label, a in (("JST ↔ MT527 몸통", dummies["jst_plug"]),):
    g = closest_points(a, mt_body).distance
    ok = g >= 1.0 - 1e-6
    if not ok:
        bad.append(label)
    print(f"  {label:20s} {g:6.2f} mm  {'OK' if ok else '<-- 1.0 미만'}")

print(f"  참고: JST ↔ 마이크로 플러그      {closest_points(dummies['jst_plug'], dummies['mt527']).distance:6.2f} mm (더미 폭 ±3.5, 보드 배치로 정해짐)")
print(f"  참고: 배터리 선 ↔ MT527 몸통    {closest_points(dummies['batt_lead'], mt_body).distance:6.2f} mm")

print("== JST 플러그 ↔ 뚜껑 ≥ 0.5 ==")
for n in ("lid_L", "lid_R"):
    g = closest_points(dummies["jst_plug"], printed[n]).distance
    ok = g >= 0.5 - 1e-6
    if not ok:
        bad.append(f"JST ↔ {n}")
    print(f"  JST 윗면 ↔ {n} 밑면  {g:6.2f} mm  {'OK' if ok else '<-- 0.5 미만'}")

print("== 출력부품끼리 (조립 위치) ==")
for (na, a), (nb, b) in itertools.combinations(printed.items(), 2):
    if {na, nb} == {"lid_L", "lid_R"}:
        continue
    report(f"{na} x {nb}", overlap(a, b))
grips = ("grip_bottom", "grip_top")
report("정렬 핀 x 그립 위·아래", sum(overlap(p, printed[g]) for p in s.placed_align_pins() for g in grips))
report("클립 링(끼운 상태) x 그립 위·아래", sum(overlap(p, printed[g]) for p in s.placed_clips() for g in grips))

print("== 수치 ==")
# 바깥 = 그립 외형의 여집합. 거리 = 실제 벽 두께
outside = s.box(-10, s.X_GRIP_END, -40, 40, -30, 50) - s.grip_outer()


def wall(shape):
    return closest_points(shape, outside).distance


print(f"  박스 폭 x 높이               {s.OUT_Y1 - s.OUT_Y0:.1f} (y {s.OUT_Y0:.1f}–{s.OUT_Y1:.1f}) x {s.OUT_H:.1f}")
print(f"  Z_AX(=USB_Z), 박스 바닥 대비  {s.Z_AX:.2f},  SHAFT_Z {s.SHAFT_Z:.2f}")
print(f"  경로 길이 (버트→MT527 C면)    {s.PATH_L:.1f}")
print(f"  연장선 남는 길이              {s.SLACK_L:.1f}  " +
      (f"(접는 길이 {s.FOLD_L:.1f}, 접는 칸 x {s.FOLD_X0:.1f}–{s.FOLD_X1:.1f})" if s.FOLD else "(접는 칸 없음)"))
print(f"  금속 혀까지 친 남는 길이       {s.SLACK_L - s.EXT_M_TONGUE + s.X_F0:.1f}")
print(f"  배터리 선 경로                {s.BATT_LEAD_L:.1f} (≤ 60)")

walls = {
    "수 머리 몸체 → 그립 바깥": wall(dummies["ext_m_head"]),
    "수 머리 포켓 → 그립 바깥": wall(s.m_pocket()),
    # 버트 끝면으로 열린 포켓 (11/10): 열린 끝면은 빼고 옆벽만. 입구 C0.3 구간은 아래 참고로 따로
    "암 머리 포켓 → 그립 바깥": closest_points(s.f_pocket() & s.box(s.POCKET_MOUTH_C, s.X_GRIP_END, -40, 40, -30, 50),
                                         s.box(0, s.X_GRIP_END, -40, 40, -30, 50) - s.grip_outer()).distance,
    **({"접는 칸 → 그립 바깥": wall(s.fold_chamber())} if s.FOLD else {}),
    "SPIGOT 포켓·턱 홈 → 그립 바깥": wall(s.spigot_pocket()),
}
# SPIGOT 포켓 예외 0.9: 가장 얇은 곳은 그립 끝면 위쪽(박스 높이 17.5 - 포켓 윗면 16.55 = 0.95).
# 끼움이 뻑뻑한 문제가 있어 FIT_CLR 0.15 를 줄이지 않기로 함. 이전 출력에서 이 자리는 문제없었음 (11/5 결정)
wall_min = {"SPIGOT 포켓·턱 홈 → 그립 바깥": 0.9}
for k, v in walls.items():
    lim = wall_min.get(k, 1.0)
    ok = v >= lim - 1e-6
    if not ok:
        bad.append(k)
    print(f"  {k:30s} {v:6.2f} mm  {'OK' if ok else f'<-- {lim} 미만'}{f' (예외 기준 {lim})' if k in wall_min else ''}")
mouth_wall = closest_points(s.f_pocket() & s.box(0, s.POCKET_MOUTH_C, -40, 40, -30, 50),
                            s.box(0, s.X_GRIP_END, -40, 40, -30, 50) - s.grip_outer()).distance
print(f"  참고: 암 머리 포켓 입구 C{s.POCKET_MOUTH_C} 모서리 벽 {mouth_wall:.2f} mm (끝면 모서리 0.3 구간만)")
print(f"  SPIGOT 벽 (설계값)             {s.SPIGOT_WALL:.2f} mm, 바깥 {s.SPIGOT_OUT[0]:.1f} x {s.SPIGOT_OUT[1]:.1f}")
print(f"  수 머리 끝 ↔ SPIGOT 시작 (x)   {s.X_SPIGOT0 - s.X_M1:.2f} mm (양수 = SPIGOT 안에 수 머리 없음)")
assert s.X_SPIGOT0 >= s.X_M1
x_r1 = s.RIDGE_X0 + s.RIDGE_W + s.FIT_CLR
print(f"  턱 홈 x {s.RIDGE_X0 - s.FIT_CLR:.2f}–{x_r1:.2f} (이음 곡선 {s.X_TRANS0:.0f}–{s.X_GRIP_END:.0f})")
print("== LRA 직사각 홈 ==")
hw = s.LRA_W / 2
groove_zone = s.box(s.LRA_X0, s.LRA_X1, -hw, hw, s.LRA_BOT, s.Z_AX)
xb = s.X_GRIP_END
print(f"  grip_bottom 홈 x {s.LRA_X0:.1f}–{s.LRA_X1:.1f} (길이 {s.LRA_L:.1f}) = 박스 뒷면에서 {xb - s.LRA_X1:.1f}–{xb - s.LRA_X0:.1f}, "
      f"폭 y ±{hw:.2f}, 깊이 z {s.LRA_BOT:.2f}–{s.Z_AX:.2f} ({s.Z_AX - s.LRA_BOT:.2f}, 전 구간 같음)")
top_cut = overlap(printed["grip_top"], groove_zone)
print(f"  grip_top 에 모터 홈 없음: 홈 자리의 grip_top {top_cut:.3f} mm3")
if top_cut > 1e-3:
    bad.append("grip_top 이 모터 홈 자리에 있음")
if abs(s.LRA_X0 - (s.X_F1 + 10.4)) > 1e-6 or abs(s.LRA_L - 24.0) > 1e-6 or abs(s.LRA_W - 8.6) > 1e-6:   # 11/10 C–모터–C
    bad.append("LRA 홈 위치·크기")
gv = s.lra_groove().bounding_box()
print(f"  모델 홈 상자 x {gv.min.X:.2f}–{gv.max.X:.2f} y {gv.min.Y:.2f}–{gv.max.Y:.2f} z {gv.min.Z:.2f}–{gv.max.Z:.2f}")
print(f"  암 머리 포켓 끝 x {s.X_F1 + s.POCKET_CLR:.1f} → 홈 시작까지 벽 {s.LRA_X0 - s.X_F1 - s.POCKET_CLR:.2f}")
print(f"  모터 x {s.LRA_X - s.LRA_D / 2:.1f}–{s.LRA_X + s.LRA_D / 2:.1f} (버트 쪽 끝면과 {s.LRA_END_CLR}, 박스 뒷면에서 가운데 {xb - s.LRA_X:.1f}), "
      f"접은 선 x {s.LRA_STACK_X0:.1f}–{s.LRA_RISE_X:.1f} 두 겹 {2 * s.LRA_WIRE[1]:.1f}: 같은 바닥면 z {s.LRA_BOT:.2f}")
g = wall(groove_zone)
ok = g >= s.LRA_WALL - 1e-3
if not ok:
    bad.append("LRA 홈 → 그립 바깥")
print(f"  홈 밑 최소 벽 (모서리)          {g:.2f} mm (≥ {s.LRA_WALL})  {'OK' if ok else '<-- 부족'}")
print(f"  홈 밑 가운데 벽                 {s.LRA_BOT - (s.Z_AX - s.GRIP_OD / 2):.2f} mm")
cab = dummies["ext_cable"].bounding_box()
lra_top = s.LRA_BOT + s.LRA_H
g = cab.min.Z - lra_top
if g < 0.5:
    bad.append("LRA ↔ 연장선")
print(f"  모터 홈 구간: 모터 윗면 z {lra_top:.2f} ↔ 연장선 밑면 z {cab.min.Z:.2f} (선 {s.EXT_CABLE_D} x {s.EXT_CABLE_H}) "
      f"높이 {g:.2f} mm (≥ 0.5)  {'OK' if g >= 0.5 else '<-- 부족'}")
print(f"    연장선 홈 Ø{s.CABLE_GROOVE_D} 밑면 z {s.Z_AX - s.CABLE_GROOVE_R:.2f} ↔ 모터 윗면 {s.Z_AX - s.CABLE_GROOVE_R - lra_top:.2f} mm "
      f"(이 구간 연장선 밑은 모터 홈으로 열려 있음)")
zone = s.box(s.LRA_X0, s.LRA_X1, -50, 50, -50, 50)
cg = s.cyl_x(s.LRA_X0, s.LRA_X1, s.CABLE_GROOVE_R) & s.box(s.LRA_X0, s.LRA_X1, -50, 50, s.Z_AX, 50)
print(f"    연장선 홈 → 바깥 벽 (모터 홈 구간, grip_top) {wall(cg):.2f} mm, "
      f"연장선 ↔ grip_top {closest_points(dummies['ext_cable'] & zone, printed['grip_top']).distance:.2f}, "
      f"옆 (y) 틈 {s.CABLE_GROOVE_R - s.EXT_CABLE_D / 2:.2f}")
report("LRA 홈 x 암 머리 포켓", overlap(s.lra_groove(), s.f_pocket()))
report("LRA 홈 x 정렬 핀 구멍", sum(overlap(s.lra_groove(), s.align_hole(x, y)) for x, y in s.ALIGN_PINS))
report("LRA 홈 x 클립 홈", sum(overlap(s.lra_groove(), s.clip_groove(x)) for x in s.CLIP_X))
in_range = [f"핀 {x:.1f}" for x, _ in s.ALIGN_PINS if s.LRA_X0 - s.ALIGN_D / 2 <= x <= s.LRA_X1 + s.ALIGN_D / 2] +     [f"클립 {x:.1f}" for x in s.CLIP_X if not (x + s.CLIP_GROOVE_W / 2 < s.LRA_X0 or x - s.CLIP_GROOVE_W / 2 > s.LRA_X1)] +     [f"드라이버 홈 {x:.1f}" for x in s.PRY_X if not (x + s.PRY_W / 2 < s.LRA_X0 or x - s.PRY_W / 2 > s.LRA_X1)]
if in_range:
    bad.append("LRA 홈 x 범위 안 " + ", ".join(in_range))
print(f"  홈 x 범위 안 핀·클립·드라이버 홈: {', '.join(in_range) if in_range else '없음'}")
print(f"  정렬 핀 {[(x, y) for x, y in s.ALIGN_PINS]}, 클립 x {s.CLIP_X}, 드라이버 홈 x {s.PRY_X}")
# LRA 선 길이 (선 가운데 기준 근사): 모터 → 홈 박스 쪽 끝면 → 올라가 → 연장선 홈 밑 → 수 머리 밑 → 박스 뒷면
w, t = s.LRA_WIRE
wire_l = (xb - s.LRA_X) + (s.LRA_RUN_Z0 - s.LRA_BOT) + abs(s.LRA_PASS_Z0 - s.LRA_RUN_Z0)
print(f"  참고: LRA 선 경로 (모터 가운데 → 박스 뒷면) 약 {wire_l:.0f} mm → 닿는 거리 L 135 / R 170 에서 남는 {135 - wire_l:.0f} / {170 - wire_l:.0f} mm 를 접어 붙임")
if wire_l > 135:
    print(f"    L: 모터를 홈 안에서 박스 쪽으로 {wire_l - 135:.0f} mm 이상 옮겨 붙인다 (홈 안 여유 {s.LRA_STACK_X0 - s.LRA_X0:.0f}~)")

print("== 통로 (SPIGOT·뒷벽) ==")
ps_z0, ps_z1 = s.SPIGOT_IN_TOP - s.SPIGOT_IN[1], s.SPIGOT_IN_TOP
print(f"  통로 {s.SPIGOT_IN[0]:.1f} x {s.SPIGOT_IN[1]:.1f}, y ±{s.SPIGOT_IN[0] / 2:.1f}, z {ps_z0:.2f}–{ps_z1:.2f} "
      f"(중심 {s.Z_SPIGOT:.2f}, Z_AX {s.Z_AX:.2f})")
for b in (s.X_BOX0 + 0.3, s.X_CAV0 - 0.3):                     # 뒷벽 안 단면도 통로 크기
    sec = printed["box"] & s.box(b - 0.05, b + 0.05, -s.SPIGOT_IN[0] / 2 - 0.5, s.SPIGOT_IN[0] / 2 + 0.5, ps_z0 - 0.5, ps_z1 + 0.5)
    hole = 15.0 * 9.5 - sec.volume / 0.1
    print(f"  x {b:.1f} 통로 넓이 {hole:.1f} mm2 (14 x 8.5 R0.5 = {14 * 8.5 - (4 - math.pi) * 0.25:.1f})")
for n, a in (("MT527 몸통", mt_body), ("연장선 수 머리", dummies["ext_m_head"])):
    g = closest_points(a, printed["box"]).distance
    ok = g >= 0.5 - 1e-6
    if not ok:
        bad.append(f"{n} ↔ 통로")
    print(f"  {n} ↔ 박스(통로)            {g:5.2f} mm  {'OK' if ok else '<-- 0.5 미만'}")
mb = mt_body.bounding_box()
print(f"    MT527 둘레: 위 {ps_z1 - mb.max.Z:.2f} 아래 {mb.min.Z - ps_z0:.2f} 옆 {s.SPIGOT_IN[0] / 2 - mb.max.Y:.2f}")
wire = dummies["lra_wire"]
in_pass = wire & s.box(s.X_SPIGOT0, s.X_CAV0, -50, 50, -50, 50)
wb = in_pass.bounding_box()
print(f"  LRA 선 (통로 안) y {wb.min.Y:.2f}–{wb.max.Y:.2f} z {wb.min.Z:.2f}–{wb.max.Z:.2f}: "
      f"MT527 와 {closest_points(wire, dummies['mt527']).distance:.2f}, 수 머리와 {closest_points(wire, dummies['ext_m_head']).distance:.2f}, "
      f"박스와 {closest_points(wire, printed['box']).distance:.2f} mm")
for n in ("mt527", "ext_m_head"):
    if overlap(wire, dummies[n]) >= 1e-3:
        bad.append(f"LRA 선 x {n}")
groove = s.lra_wire_slot() & s.box(-1, s.X_GRIP_END, -50, 50, -50, 50)
g = wall(groove)
if g < 1.0 - 1e-6:
    bad.append("LRA 선 홈 벽")
print(f"  LRA 선 홈 → 그립 바깥          {g:.2f} mm (≥ 1.0)")
gb_ = groove.bounding_box()
print(f"  LRA 선 홈 (grip_bottom, 연장선 홈 밑) x {gb_.min.X:.1f}–{s.X_GRIP_END:.1f}, y ±{gb_.max.Y:.2f}, "
      f"z {gb_.min.Z:.2f}–{gb_.max.Z:.2f} (선 {w} x {t}, 틈 {s.LRA_WIRE_CLR}), 선 z {s.LRA_RUN_Z0:.2f}–{s.LRA_RUN_Z0 + t:.2f}")
print(f"  LRA 선 ↔ 연장선 {closest_points(wire, dummies['ext_cable']).distance:.2f}, ↔ 수 머리(목 포함) "
      f"{closest_points(wire, dummies['ext_m_head']).distance:.2f} mm")
top_wire = overlap(groove, printed["grip_top"] + printed["grip_bottom"])
if top_wire > 1e-3:
    bad.append("LRA 선 홈 자리에 그립")
print(f"  LRA 선 홈 자리의 그립 (위·아래) {top_wire:.3f} mm3 (선 홈은 전부 z < Z_AX: z 최대 {gb_.max.Z:.2f} < {s.Z_AX:.2f})")

print("== USER 버튼 누름 ==")
post = s.press_post()
btn, ble = dummies["user_btn"], dummies["ble_module"]
g = closest_points(post, btn).distance
print(f"  누름 기둥 아랫면 z {s.PRESS_Z0:.2f}, 버튼 윗면 z {s.PCB_Z1 + s.USER_BTN[2]:.2f} → 틈 {g:.2f} mm")
ble_top = s.PCB_Z1 + s.BLE_H
print(f"  BLE 윗면 z {ble_top:.2f}: 기둥이 {ble_top - s.PRESS_Z0:.2f} 낮음 → 45° 면으로 탭을 밀어 올림")
# 뚜껑을 닫는 쪽(-x)으로 밀어 넣는 동안: 기둥이 지나는 x 마다 검사
worst_box, worst_flex, worst_rest = 0.0, 0.0, 0.0
others = [v for k, v in dummies.items() if k not in ("ble_module",)]
dx = 0.0
while s.USER_X + dx <= s.X_NOSE1 + s.PRESS_D:
    p0 = post.moved(bd.Location((dx, 0, 0)))
    p1 = post.moved(bd.Location((dx, 0, s.PRESS_FLEX)))
    worst_box = max(worst_box, overlap(p0, printed["box"]))
    worst_rest = max(worst_rest, sum(overlap(p0, o) for o in others) if dx > 0 else 0.0)
    worst_flex = max(worst_flex, overlap(p1, ble))
    dx += 0.5
for label, v in (("기둥 x 박스 (앞벽 홈)", worst_box), ("기둥 x BLE 외 부품", worst_rest),
                 (f"기둥 {s.PRESS_FLEX} 휨 x BLE", worst_flex)):
    report(label, v)
print(f"  {s.PRESS_FLEX} 휨일 때 기둥 ↔ BLE 윗면 {s.PRESS_Z0 + s.PRESS_FLEX - ble_top:.2f} mm, "
      f"앞벽·코 홈 바닥 z {s.PRESS_Z0 - s.PRESS_SLOT_CLR:.2f}")
print(f"  기둥 ↔ 박스 최소 (닫힘)        {closest_points(post, printed['box']).distance:.2f} mm, "
      f"코 홈 ↔ 볼트 구멍 {s.PRESS_Z0 - s.PRESS_SLOT_CLR - (s.SHAFT_Z + s.BOLT_HOLE_D / 2):.2f} mm")

print(f"  걸쇠 갈고리 {s.HOOK_H} (45° 양쪽), |y| {s.LATCH_Y0}–{s.LATCH_Y1}, 길이 {s.LATCH_L}, 앞벽 틈 {s.HOOK_CLR}")
assert s.LATCH_Y0 > s.FEATHER_W / 2 and s.LATCH_Y1 < s.LID_HW1 + s.SLIDE_CLR
nut_bb = dummies["m2_nut"].bounding_box()
assert abs(nut_bb.min.Y - s.NUT_SEAT_Y) < 0.01
y_end = -s.NUT_SEAT_Y + s.BOLT_L
print(f"  너트 받침 y {s.NUT_SEAT_Y:.2f} (코 구멍과 벽 {s.NUT_SEAT_Y - s.NOSE_D / 2 - s.NOSE_CLR:.2f}), 너트 y {nut_bb.min.Y:.2f}–{nut_bb.max.Y:.2f}, "
      f"M2×{s.BOLT_L:.0f} 끝 y {y_end:.1f} (너트 밖 {y_end - (s.NUT_SEAT_Y + s.NUT_T):.1f}, 육각 통로 안)")
sh = printed["shaft"]
face = sh & s.box(s.X_BOX_END, s.X_BOX_END + 0.05, -40, 40, -40, 40)
fb = face.bounding_box()
print(f"  앞 캡 뒷면 y {fb.min.Y:.2f}–{fb.max.Y:.2f}, z {fb.min.Z:.2f}–{fb.max.Z:.2f}  (박스 앞면 y {s.OUT_Y0:.1f}–{s.OUT_Y1:.1f}, z 0–{s.OUT_H:.1f}), "
      f"박스와 거리 {closest_points(sh, printed['box']).distance:.2f}")
print(f"  코 윗면 z {s.SHAFT_Z + s.NOSE_D / 2:.2f} < 뚜껑 밑면 {s.Z_TOP:.2f}")

print("== 코 ↔ 앞부분, 앞벽 ==")
nose = s.nose_body()
print(f"  앞벽 {s.WALL_FRONT} (x {s.X_CAV1:.1f}–{s.X_BOX_END:.1f}), 코 x {s.X_BOX_END:.1f}–{s.X_NOSE1:.1f}, 볼트 x {s.PIN_X:.1f}, "
      f"앞부분 길이 {printed['shaft'].bounding_box().size.X:.1f} (끝 x {printed['shaft'].bounding_box().max.X:.1f} = TOTAL_L {s.TOTAL_L})")
print(f"  코 Ø{s.NOSE_D} / 구멍 Ø{s.NOSE_D + 2 * s.NOSE_CLR} (한쪽 {s.NOSE_CLR}), 코 끝 모따기 {s.NOSE_TIP_C}, 입구 모따기 {s.NOSE_TIP_C}, "
      f"뿌리 R{s.NOSE_ROOT_R}, 홈 모서리 R{s.NOSE_SLOT_R}")
x_cyl = s.X_BOX_END + s.NOSE_ROOT_R
g_cyl = closest_points(nose & s.box(x_cyl, s.X_NOSE1 + 1, -50, 50, -50, 50), printed["shaft"]).distance
g_root = closest_points(nose & s.box(s.X_BOX_END, x_cyl, -50, 50, -50, 50), printed["shaft"]).distance
# 입구 모따기와 뿌리 R 이 같은 1.0 이라 끝점에서 45° 틈 = NOSE_CLR / √2 (반경 방향은 NOSE_CLR). 모따기·R 유지 (11/9 결정)
root_min = s.NOSE_CLR / math.sqrt(2)
ok = g_cyl >= s.NOSE_CLR - 1e-3 and g_root >= root_min - 1e-3
if not ok:
    bad.append("코 ↔ 앞부분 틈")
print(f"  코 원통 ↔ 앞부분 구멍 틈 {g_cyl:.2f} mm, 뿌리 R ↔ 입구 모따기 틈 {g_root:.3f} mm (45° 방향, ≥ {root_min:.3f})  {'OK' if ok else '<-- 부족'}")
plain = s.cyl_x(s.X_BOX_END, s.X_NOSE1, s.NOSE_D / 2, z=s.SHAFT_Z) - s.press_slot()
print(f"  코 홈 모서리 R{s.NOSE_SLOT_R}: 모서리 2개 둥글림 (모델 assert). 코 부피 (뿌리 R·끝 모따기·홈 R 반영) "
      f"{(nose & s.box(s.X_BOX_END, s.X_NOSE1, -50, 50, -50, 50)).volume:.0f} / 그냥 원통-홈 {plain.volume:.0f} mm3")
lb = printed["lid_L"].bounding_box()
print(f"  뚜껑 x {lb.min.X:.1f}–{lb.max.X:.1f} (박스 앞면 {s.X_BOX_END:.1f}), 걸쇠 기준 앞벽 안쪽 x {s.X_CAV1:.1f} "
      f"(갈고리 x {s.X_CAV1 - s.HOOK_CLR:.2f}), lid_slot 끝 x {s.X_BOX_END + 1:.1f}")

print("== 배터리 선 ↔ +y 벽 ≥ 4.5 ==")
for n in ("batt_lead", "jst_plug"):
    g = s.CAV_Y1 - dummies[n].bounding_box().max.Y
    ok = g >= 4.5 - 1e-6
    if n == "batt_lead" and not ok:
        bad.append("배터리 선 ↔ +y 벽")
    print(f"  {n:10s} y 최대 {dummies[n].bounding_box().max.Y:5.2f} → 벽 {s.CAV_Y1:.1f} 까지 {g:5.2f} mm  "
          f"{'OK' if ok else '<-- 4.5 미만'}{'' if n == 'batt_lead' else ' (참고)'}")

print("== 핀 구멍 벽 ≥ 0.8 ==")
cavities = {"입구": s.box(-1, s.BUTT_WALL + 0.01, -5, 5, s.Z_AX - 2.5, s.Z_AX + 2.5), "암 머리 몸통 포켓": s.f_body_pocket(),
            "암 머리 목 칸": s.f_neck_pocket(), "수 머리 목 칸": s.m_neck_pocket(),
            "선 홈": s.cyl_x(s.X_F1, s.X_M0, s.CABLE_GROOVE_R), "수 머리 몸통 포켓": s.m_body_pocket(),
            "SPIGOT 홈": s.spigot_pocket(), "LRA 홈": s.lra_groove(),
            "LRA 선 홈": groove}
if s.FOLD:
    cavities["접는 칸"] = s.fold_chamber()
notches = [s.box(x - s.PRY_W / 2, x + s.PRY_W / 2, *sorted((sy * (s.GRIP_OD / 2 - s.PRY_DEPTH), sy * (s.GRIP_OD / 2 + 1))),
                 s.Z_AX - s.PRY_H / 2, s.Z_AX + s.PRY_H / 2) for x in s.PRY_X for sy in (-1, 1)]
cavities["드라이버 홈"] = notches[0]
for n in notches[1:]:
    cavities["드라이버 홈"] = cavities["드라이버 홈"] + n
clips = s.clip_groove(s.CLIP_X[0])
for x in s.CLIP_X[1:]:
    clips = clips + s.clip_groove(x)
cavities["클립 홈"] = clips
for x, y in s.ALIGN_PINS:
    h = s.align_hole(x, y)
    d = {k: closest_points(h, c).distance for k, c in cavities.items()}
    k = min(d, key=d.get)
    out = min(wall(h), s.X_GRIP_END - (x + s.ALIGN_D / 2))           # 그립 끝면(박스와 맞닿음)까지 포함
    ok = d[k] >= 0.8 - 1e-6 and out >= 0.8 - 1e-6
    if not ok:
        bad.append(f"핀 구멍 ({x:.0f}, {y:+.1f}) 벽")
    print(f"  ({x:5.0f}, {y:+.1f})  안쪽 {d[k]:5.2f} ({k})  바깥 {out:5.2f}  {'OK' if ok else '<-- 0.8 미만'}")
for x in s.PRY_X:
    notch = s.box(x - s.PRY_W / 2, x + s.PRY_W / 2, s.GRIP_OD / 2 - s.PRY_DEPTH, s.GRIP_OD / 2, s.Z_AX - 1, s.Z_AX + 1)
    near = {k: closest_points(notch, c).distance for k, c in cavities.items() if k != "드라이버 홈"}
    near["핀 구멍"] = min(closest_points(notch, s.align_hole(px, py)).distance for px, py in s.ALIGN_PINS)
    k = min(near, key=near.get)
    ok = near[k] >= 0.8 - 1e-6
    if not ok:
        bad.append(f"드라이버 홈 x {x:.0f} 벽")
    print(f"  드라이버 홈 x {x:.0f} → 가장 가까운 {k} {near[k]:.2f} mm  {'OK' if ok else '<-- 0.8 미만'}")
print(f"  정렬 핀 구멍 Ø{s.ALIGN_D} x 깊이 {s.ALIGN_DEPTH} (반쪽마다), 필라멘트 Ø1.75 → 틈 {(s.ALIGN_D - 1.75) / 2:.3f}, "
      f"조각 길이 ≤ {2 * s.ALIGN_DEPTH:.1f}")

print("== 클립 링 홈: 홈 바닥 아래 벽 ≥ 4.5 ==")
inner = {k: c for k, c in cavities.items() if k not in ("클립 홈", "드라이버 홈")}
for x in s.CLIP_X:
    g = s.clip_groove(x)
    x0, x1 = x - s.CLIP_GROOVE_W / 2, x + s.CLIP_GROOVE_W / 2
    slab = s.box(x0, x1, -50, 50, -50, 50)
    under = {}
    for k, c in inner.items():
        part = c & slab
        if part is not None and part.volume > 1e-6:
            under[k] = closest_points(g, part).distance
    k = min(under, key=under.get)
    # 예외: LRA 홈·머리 포켓을 피하면 클립 자리는 LRA 선 홈 구간뿐 → 그 쪽(아래)만 1.8 (11/9 결정)
    #       목 칸 위는 걸려도 됨 (11/10 지시) → 같은 1.8
    lim = 1.8 if k in ("LRA 선 홈", "암 머리 목 칸", "수 머리 목 칸") else 4.5
    ok = under[k] >= lim - 1e-6
    if not ok:
        bad.append(f"클립 홈 x {x:.0f} 아래 벽")
    pin = min((closest_points(g, s.align_hole(px, py)).distance, px) for px, py in s.ALIGN_PINS)
    pin_ov = sum(overlap(g, s.align_hole(px, py)) for px, py in s.ALIGN_PINS)
    if pin_ov > 1e-6:
        bad.append(f"클립 홈 x {x:.0f} x 정렬 핀 구멍")
    notch = min(closest_points(g, n).distance for n in notches)
    print(f"  x {x:.0f} (x {x0:.1f}–{x1:.1f}): 홈 바닥 Ø{s.CLIP_GROOVE_DIA:.1f} 아래 벽 {under[k]:.2f} ({k})  "
          f"{'OK' if ok else f'<-- {lim} 미만'}{' (예외 기준 1.8)' if lim != 4.5 else ''} | 옆 핀 구멍(x {pin[1]:.0f}) {pin[0]:.2f} 겹침 {pin_ov:.3f}, 드라이버 홈 {notch:.2f}")
    if not (x1 < s.LRA_X0 or x0 > s.LRA_X1) or x0 < s.X_F1 + s.POCKET_CLR or x1 > s.X_M0 - s.POCKET_CLR:
        bad.append(f"클립 홈 x {x:.0f} 위치")
        print(f"    <-- LRA 홈(x {s.LRA_X0:.1f}–{s.LRA_X1:.1f}) 또는 머리 몸통 포켓(x <{s.X_F1 + s.POCKET_CLR:.1f}, "
              f">{s.X_M0 - s.POCKET_CLR:.1f}) 구간")
ring = s.clip_ring().shape
rb = ring.bounding_box()
print(f"  링: 안지름 {s.CLIP_ID:.1f} (홈 바닥 -0.2), 두께 {s.CLIP_T}, 폭 {rb.size.Z:.2f}, 바깥 Ø{s.CLIP_ID + 2 * s.CLIP_T:.1f} "
      f"(그립 Ø{s.GRIP_OD}), 둘레 {s.CLIP_ARC:.0f}°, 열린 끝 R{s.CLIP_END_R}, 무게 {ring.volume / 1000 * PETG_G_PER_CM3:.2f} g")
gap_chord = s.CLIP_ID * math.sin(math.radians((360 - s.CLIP_ARC) / 2))
print(f"    열린 폭(안쪽 현) {gap_chord:.1f} → 옆에서 끼우려면 {s.CLIP_GROOVE_DIA - gap_chord:.1f} 더 벌림")

print("== 클립–모터–클립 배치 · 키 (11/10) ==")
hg = s.CLIP_GROOVE_W / 2
ga, gb = (s.CLIP_X[0] - hg, s.CLIP_X[0] + hg), (s.CLIP_X[1] - hg, s.CLIP_X[1] + hg)
f_end, m_start = s.X_F1 + s.POCKET_CLR, s.X_M0 - s.POCKET_CLR
pin_x0 = min(x - s.ALIGN_D / 2 for x, _ in s.ALIGN_PINS if x > ga[1])
gaps = {"암 머리 몸통 포켓 끝 → 링 A": ga[0] - f_end, "링 A → 모터 홈": s.LRA_X0 - ga[1],
        "모터 홈 → 링 B": gb[0] - s.LRA_X1, "링 B → 정렬 핀 구멍(97.5)": pin_x0 - gb[1],
        "링 B → 수 머리 목 칸": s.M_NECK_X[0] - gb[1], "링 B → 수 머리 몸통 포켓": m_start - gb[1]}
print(f"  링 A 홈 x {ga[0]:.1f}–{ga[1]:.1f} | 모터 홈 x {s.LRA_X0:.1f}–{s.LRA_X1:.1f} | 링 B 홈 x {gb[0]:.1f}–{gb[1]:.1f}")
print(f"  모터 x {s.LRA_X - s.LRA_D / 2:.1f}–{s.LRA_X + s.LRA_D / 2:.1f}, 선 올라가는 x {s.LRA_RISE_X:.1f}")
print(f"  링 A 홈 아래: 암 머리 목 칸 x {s.F_NECK_X[0]:.1f}–{s.F_NECK_X[1]:.1f} (링 A 홈과 겹치는 x "
      f"{max(ga[0], s.F_NECK_X[0]):.1f}–{min(ga[1], s.F_NECK_X[1]):.1f}), 그 뒤 선 홈")
for k, v in gaps.items():
    lim = 2.0 if "모터" in k else 0.0
    ok = v >= lim - 1e-6
    if not ok:
        bad.append(k)
    print(f"  {k:26s} {v:6.2f} mm (≥ {lim})  {'OK' if ok else '<-- 부족'}")
ring_b = s.placed_clips()
for i, x in enumerate(s.CLIP_X):
    key = s.clip_key(x)
    d = closest_points(ring_b[i], key).distance
    print(f"  키 x {x:.0f}: 각 {s.CLIP_KEY_ARC:.1f}° (링 빈 자리 {360 - s.CLIP_ARC:.0f}° - 틈 {s.CLIP_KEY_GAP_DEG:.2f}° x 2), "
          f"끝 R{s.CLIP_KEY_R}, 바깥 Ø{2 * key.bounding_box().max.Z - 2 * s.Z_AX:.2f} (그립 Ø{s.GRIP_OD}), 링 끝 ↔ 키 최소 틈 {d:.2f} mm "
          f"(바깥 둘레 {s.CLIP_KEY_GAP:.2f}), 겹침 {overlap(ring_b[i], key):.3f}")
    if d < 0.2 - 1e-6:
        bad.append(f"링 {i} ↔ 키 틈")

print(f"== 이음 구간 (x {s.X_TRANS0:.0f}~) 반쪽 틈 ==")
x_t = s.X_TRANS0
slab = s.box(x_t, s.X_GRIP_END, -50, 50, -50, 50)
top_t, bot_t = printed["grip_top"] & slab, printed["grip_bottom"] & slab
face = printed["grip_bottom"] & s.box(x_t, s.X_GRIP_END, -50, 50, s.Z_AX - 0.01, s.Z_AX)
print(f"  x {x_t:.0f}–{s.X_GRIP_END:.0f}: 위·아래 반쪽 틈 {closest_points(top_t, bot_t).distance:.2f} mm, "
      f"나누는 면 맞닿는 넓이 {face.volume / 0.01:.0f} mm2")
print(f"  잡는 것: 정렬 핀 x {s.ALIGN_RIDGE[0]:.0f} (y ±{s.ALIGN_RIDGE[1]}), SPIGOT 턱 x {s.RIDGE_X0:.1f}. "
      f"가장 가까운 클립 링 끝 x {max(s.CLIP_X) + s.CLIP_GROOVE_W / 2:.1f} → 이음 시작까지 {x_t - max(s.CLIP_X) - s.CLIP_GROOVE_W / 2:.1f} mm")

print("== 출력물 길이 / 무게 (채움 100% 상한, PETG) ==")
for n, p in printed.items():
    bb = p.bounding_box()
    flag = "OK" if bb.size.X <= s.PRINT_MAX else "<-- 초과"
    if bb.size.X > s.PRINT_MAX:
        bad.append(n + " 길이")
    print(f"  {n:12s} L {bb.size.X:6.1f}  {bb.size.Y:5.1f} x {bb.size.Z:5.1f}  "
          f"{p.volume / 1000 * PETG_G_PER_CM3:5.1f} g  {flag}")

print("== 솔리드 개수 ==")
printed["clip_ring"] = s.clip_ring().shape
for n, p in printed.items():
    c = len(p.solids())
    if c != 1:
        bad.append(n + " 솔리드")
    print(f"  {n:12s} {c}")

print("== 버트 끝면 (11/10 벽 제거) ==")
fh = dummies["ext_f_head"].bounding_box()
gb = printed["grip_bottom"].bounding_box()
print(f"  암 머리 앞면 x {fh.min.X:.2f} = 그립 버트 끝면 x {gb.min.X:.2f}, 포켓 x {s.X_F0:.1f}–{s.X_F1 + s.POCKET_CLR:.1f} "
      f"(입구 C{s.POCKET_MOUTH_C}), 안쪽 턱 x {s.X_F1 + s.POCKET_CLR:.1f}")
if abs(fh.min.X - gb.min.X) > 1e-6:
    bad.append("암 머리 앞면 ≠ 버트 끝면")
mouth = s.box(-0.5, 0.0, -50, 50, -50, 50) & (printed["grip_bottom"] + printed["grip_top"])
print(f"  끝면 앞(x<0)에 남은 그립 {mouth.volume if mouth is not None else 0:.3f} mm3")

print("== LED 창 · 리셋 구멍 ==")
lx, ly = s.X_FEATHER0 + s.LED_X_FROM_USB, s.LED_Y
rx, ry = s.X_FEATHER0 + s.RESET_X_FROM_USB, s.RESET_Y
probe = s.cyl_z(s.Z_TOP - 2, s.OUT_H + 2, s.LED_HOLE_D / 2 - 0.05, lx, ly)
through = overlap(probe, printed["lid_L"])
if through > 1e-6:
    bad.append("LED 창 관통 안 됨")
print(f"  LED x {lx:.1f} y {ly:.1f}: 타원 포켓 5x8 (겉면 0.6) + 관통 Ø{s.LED_HOLE_D} 겉면 C{s.LED_HOLE_C}, 관통 확인 {through:.3f} mm3 (0 = 뚫림)")
print(f"  리셋 구멍 x {rx:.1f} (Ø2.0): LED 와 {abs(lx - rx):.1f} mm. 표시 링 없음 (11/10 삭제)")
slit_x = s.USER_X - s.TAB_X / 2 - s.TAB_SLIT
print(f"  (삭제 이유) Ø9.5–10.5 링을 넣으면 바깥 반지름 5.25 ↔ USER 탭 슬릿 x {slit_x:.1f} (LED 에서 {slit_x - lx:.2f}): "
      f"벽 {slit_x - lx - 5.25:.2f} mm")
import pedal_box_v1 as p
pl = p.pedal_lid().shape
plx, ply = p.X_F0 + s.LED_X_FROM_USB, s.LED_Y
through = overlap(s.cyl_z(p.Z_TOP - 2, p.OUT_H + 2, s.LED_HOLE_D / 2 - 0.05, plx, ply), pl)
if through > 1e-6:
    bad.append("페달 LED 창 관통 안 됨")
print(f"  페달 뚜껑 LED x {plx:.1f} y {ply:.1f}: 관통 Ø{s.LED_HOLE_D} + C{s.LED_HOLE_C}, 관통 확인 {through:.3f} mm3 (0 = 뚫림), "
      f"뚜껑 솔리드 {len(pl.solids())}")
if len(pl.solids()) != 1:
    bad.append("페달 뚜껑 솔리드")

print("== 머리 포켓 · 턱 x 위치 (11/10 실측 계단식) ==")
c = s.POCKET_CLR
fw_, fh_, fl_ = s.EXT_F_HEAD
mw_, mh_, ml_ = s.EXT_M_HEAD
print(f"  암 머리: 몸통 포켓 x {s.X_F0:.1f}–{s.X_F1 + c:.1f} ({fw_ + 2 * c:.1f} y x {fh_ + 2 * c:.1f} z) → 턱 x {s.F_NECK_X[0]:.1f} → "
      f"목 칸 Ø{s.EXT_F_NECK[0] + 2 * c:.1f} x {s.F_NECK_X[0]:.1f}–{s.F_NECK_X[1]:.1f} → 선 홈 Ø{s.CABLE_GROOVE_D}")
print(f"           몸통 {fl_} x {fw_} x {fh_}, 앞면 x {s.X_F0:.1f} (버트 끝면), 뒷면 X_F1 {s.X_F1:.1f}, 턱 폭 y "
      f"{(fw_ + 2 * c) / 2 - (s.EXT_F_NECK[0] / 2 + c):.2f} (한쪽)")
print(f"  수 머리: 선 홈 → 목 칸 Ø{s.EXT_M_NECK[0] + 2 * c:.1f} x {s.M_NECK_X[0]:.1f}–{s.M_NECK_X[1]:.1f} → 턱 x {s.M_NECK_X[1]:.1f} → "
      f"몸통 포켓 x {s.X_M0 - c:.1f}–{s.X_SPIGOT0:.1f} ({mw_ + 2 * c:.1f} y x {mh_ + 2 * c:.1f} z)")
print(f"           몸통 {ml_} x {mw_} x {mh_}, 뒷면 X_M0 {s.X_M0:.1f}, 앞면 X_M1 {s.X_M1:.1f} = MT527 C면, 턱 폭 y "
      f"{(mw_ + 2 * c) / 2 - (s.EXT_M_NECK[0] / 2 + c):.2f} (한쪽)")
for n, a in (("암 머리 몸통", s.box(s.X_F0, s.X_F1, -fw_ / 2, fw_ / 2, s.Z_AX - fh_ / 2, s.Z_AX + fh_ / 2)),
             ("수 머리 몸통", s.box(s.X_M0, s.X_M1, -mw_ / 2, mw_ / 2, s.Z_AX - mh_ / 2, s.Z_AX + mh_ / 2))):
    pushed = a.moved(bd.Location((0.25 if n.startswith("암") else -0.25, 0, 0)))   # 틈 0.2 넘게 밀면 턱에 걸려야 함
    v = sum(overlap(pushed, printed[g]) for g in grips)
    if v < 1e-3:
        bad.append(f"{n} 턱 안 걸림")
    print(f"  {n} 을 {'+' if n.startswith('암') else '-'}x 로 0.25 밀면 턱과 겹침 {v:.3f} mm3 (> 0 = 턱에 걸림)")
print(f"  연장선 (실측 {s.EXT_CABLE_D} x {s.EXT_CABLE_H}) x {s.X_F1 + s.EXT_F_NECK[1]:.1f}–{s.X_M0 - s.EXT_M_NECK[1]:.1f}, "
      f"홈 Ø{s.CABLE_GROOVE_D}: 옆 틈 {s.CABLE_GROOVE_R - s.EXT_CABLE_D / 2:.2f}, 위아래 틈 {s.CABLE_GROOVE_R - s.EXT_CABLE_H / 2:.2f}")
print(f"  연장선 여유 {s.SLACK_L:.2f} mm (EXT_TOTAL_L {s.EXT_TOTAL_L} - 버트 끝면→MT527 C면 {s.PATH_L:.1f})")

print("FAIL: " + ", ".join(bad) if bad else "PASS")
assert not bad, bad
