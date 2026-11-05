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
    report("접는 칸 x LRA 자리", overlap(fold, s.cyl_z(s.Z_AX, s.LRA_TOP, s.LRA_R, s.LRA_X, 0)))
    next_hole = min(x - s.ALIGN_D / 2 - 0.8 for x, _ in s.ALIGN_PINS if x > s.FOLD_X0)
    fold_margin = next_hole - s.FOLD_X1
    print(f"  다음 핀 구멍(벽 0.8 포함)까지 여유 {fold_margin:.2f} mm → EXT_TOTAL_L 상한 약 {s.EXT_TOTAL_L + 2 * fold_margin:.1f}")
else:
    groove_l = s.X_M0 - s.X_F1
    print(f"  일자 선 홈 x {s.X_F1:.1f}–{s.X_M0:.1f} (길이 {groove_l:.1f}), 홈 Ø{2 * s.CABLE_GROOVE_R:.1f} / 선 Ø{s.EXT_CABLE_D:.1f}")

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
    "암 머리 포켓 → 그립 바깥": wall(s.f_pocket()),
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
print(f"  SPIGOT 벽 (설계값)             {s.SPIGOT_WALL:.2f} mm, 바깥 {s.SPIGOT_OUT[0]:.1f} x {s.SPIGOT_OUT[1]:.1f}")
print(f"  수 머리 끝 ↔ SPIGOT 시작 (x)   {s.X_SPIGOT0 - s.X_M1:.2f} mm (양수 = SPIGOT 안에 수 머리 없음)")
assert s.X_SPIGOT0 >= s.X_M1
x_r1 = s.RIDGE_X0 + s.RIDGE_W + s.FIT_CLR
print(f"  턱 홈 x {s.RIDGE_X0 - s.FIT_CLR:.2f}–{x_r1:.2f} (이음 곡선 {s.X_TRANS0:.0f}–{s.X_GRIP_END:.0f})")
print(f"  LRA 윗벽 가장자리             {s.Z_AX + ((s.GRIP_OD / 2) ** 2 - s.LRA_R ** 2) ** 0.5 - s.LRA_TOP:.2f} mm")
print(f"  LRA 바닥 ↔ 연장선 홈          {(s.LRA_TOP - s.LRA_H) - (s.Z_AX + s.EXT_CABLE_D / 2):.2f} mm (≥ 0.5)")

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
groove = s.lra_wire_path(s.LRA_WIRE_CLR) & s.box(-1, s.X_GRIP_END, -50, 50, -50, 50)
g = wall(groove)
if g < 1.0 - 1e-6:
    bad.append("LRA 선 홈 벽")
print(f"  LRA 선 홈 → 그립 바깥          {g:.2f} mm (≥ 1.0)")

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
print(f"  너트 받침 y {s.NUT_SEAT_Y:.2f} (코 구멍과 벽 {s.NUT_SEAT_Y - (s.NOSE_D + 0.3) / 2:.2f}), 너트 y {nut_bb.min.Y:.2f}–{nut_bb.max.Y:.2f}, "
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
ok = g_cyl >= s.NOSE_CLR - 1e-3 and g_root >= 0.15
if not ok:
    bad.append("코 ↔ 앞부분 틈")
print(f"  코 원통 ↔ 앞부분 구멍 틈 {g_cyl:.2f} mm, 뿌리 R ↔ 입구 모따기 틈 {g_root:.2f} mm (45° 방향)  {'OK' if ok else '<-- 부족'}")
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
cavities = {"입구": s.box(-1, s.BUTT_WALL + 0.01, -5, 5, s.Z_AX - 2.5, s.Z_AX + 2.5), "암 머리 포켓": s.f_pocket(),
            "선 홈": s.cyl_x(s.X_F1, s.X_M0, s.CABLE_GROOVE_R), "수 머리 포켓": s.m_pocket(),
            "SPIGOT 홈": s.spigot_pocket(), "LRA 자리": s.cyl_z(s.Z_AX, s.LRA_TOP, s.LRA_R, s.LRA_X, 0),
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
    ok = under[k] >= 4.5 - 1e-6
    if not ok:
        bad.append(f"클립 홈 x {x:.0f} 아래 벽")
    pin = min((closest_points(g, s.align_hole(px, py)).distance, px) for px, py in s.ALIGN_PINS)
    pin_ov = sum(overlap(g, s.align_hole(px, py)) for px, py in s.ALIGN_PINS)
    if pin_ov > 1e-6:
        bad.append(f"클립 홈 x {x:.0f} x 정렬 핀 구멍")
    notch = min(closest_points(g, n).distance for n in notches)
    print(f"  x {x:.0f} (x {x0:.1f}–{x1:.1f}): 홈 바닥 Ø{s.CLIP_GROOVE_DIA:.1f} 아래 벽 {under[k]:.2f} ({k})  "
          f"{'OK' if ok else '<-- 4.5 미만'} | 옆 핀 구멍(x {pin[1]:.0f}) {pin[0]:.2f} 겹침 {pin_ov:.3f}, 드라이버 홈 {notch:.2f}")
    if not (x1 < s.LRA_X - 5 or x0 > s.LRA_X + 5) or x0 < s.X_F1 or x1 > s.X_M0:
        bad.append(f"클립 홈 x {x:.0f} 위치")
        print(f"    <-- LRA(x {s.LRA_X - 5:.0f}–{s.LRA_X + 5:.0f}) 또는 머리 포켓(x <{s.X_F1:.1f}, >{s.X_M0:.1f}) 구간")
ring = s.clip_ring().shape
rb = ring.bounding_box()
print(f"  링: 안지름 {s.CLIP_ID:.1f} (홈 바닥 -0.2), 두께 {s.CLIP_T}, 폭 {rb.size.Z:.2f}, 바깥 Ø{s.CLIP_ID + 2 * s.CLIP_T:.1f} "
      f"(그립 Ø{s.GRIP_OD}), 둘레 {s.CLIP_ARC:.0f}°, 열린 끝 R{s.CLIP_END_R}, 무게 {ring.volume / 1000 * PETG_G_PER_CM3:.2f} g")
gap_chord = s.CLIP_ID * math.sin(math.radians((360 - s.CLIP_ARC) / 2))
print(f"    열린 폭(안쪽 현) {gap_chord:.1f} → 옆에서 끼우려면 {s.CLIP_GROOVE_DIA - gap_chord:.1f} 더 벌림")

print("== 이음 구간 (x 171~) 반쪽 틈 ==")
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

print("FAIL: " + ", ".join(bad) if bad else "PASS")
assert not bad, bad
