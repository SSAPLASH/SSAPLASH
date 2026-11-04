"""겹침 검사 + 출력 무게 (원본 stick_v4.py 의 검사와 같은 기준)"""
import itertools

from stick_v4 import (dummy_parts, handle_body, lid_body, shaft_body, stick_handle, stick_lid, stick_shaft,
                      HANDLE_OD, LRA_R, LRA_TOP, Z_AX)

PETG_G_PER_CM3 = 1.27

printed = {"handle": stick_handle().shape, "lid": stick_lid().shape, "shaft": stick_shaft().shape}


def overlap(a, b):
    r = a & b
    return sum(s.volume for s in r.solids()) if r is not None else 0.0


print("== 출력 부품끼리 ==")
for (na, a), (nb, b) in itertools.combinations(printed.items(), 2):
    print(f"  {na:6s} x {nb:6s} {overlap(a, b):7.3f} mm3")

print("== 전자부품 x 하우징 ==")
bad = []
for name, shape, _ in dummy_parts():
    v = sum(overlap(shape, p) for p in printed.values())
    flag = "OK" if v < 0.3 else "<-- 확인"
    if v >= 0.3:
        bad.append(name)
    print(f"  {name:12s} {v:7.3f} mm3  {flag}")

print("== 출력 무게 (채움 100% 상한, PETG) ==")
for n, p in printed.items():
    print(f"  {n:6s} {p.volume / 1000 * PETG_G_PER_CM3:5.1f} g")

edge_wall = Z_AX + ((HANDLE_OD / 2) ** 2 - LRA_R ** 2) ** 0.5 - LRA_TOP
print(f"LRA 자리 윗벽: 가장자리 {edge_wall:.2f} mm, 가운데 {Z_AX + HANDLE_OD / 2 - LRA_TOP:.2f} mm")
print("handle solids:", len(printed["handle"].solids()), " lid:", len(printed["lid"].solids()),
      " shaft:", len(printed["shaft"].solids()))
assert not bad, bad
