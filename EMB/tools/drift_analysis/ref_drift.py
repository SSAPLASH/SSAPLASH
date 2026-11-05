"""기준점 타격으로 방위각 밀림(°/분) 계산 (S15P31A307-234)

측정 방법: 정면 보정 → 1분마다 기준점을 같은 자세로 양손 5번씩, 그 사이엔 자유 연주 → ble_latency.html [CSV 저장]
쓰는 법: python ref_drift.py data/ref_hits_1104_before.csv [시작 초]
  예) python ref_drift.py data/ref_hits_1104_after.csv 100   (처음 기준점은 스틱을 반대 손에 들어 제외)
기준점 묶음 = 4초 안에 5번, 방위각 표준편차 6°·고도각 8° 미만, 고도각 40° 미만인 연속 타격
"""
import csv, sys, statistics as st

def groups(h, max_el=40):
    out, i = [], 0
    while i <= len(h) - 5:
        w = h[i:i + 5]
        az = [w[0][2] + (x[2] - w[0][2] + 180) % 360 - 180 for x in w]     # ±180 경계를 넘어도 이어지게
        if w[-1][0] - w[0][0] < 4 and st.pstdev(az) < 6 and st.pstdev(x[1] for x in w) < 8 and st.mean(x[1] for x in w) < max_el:
            out.append((w[0][0], st.mean(x[1] for x in w), st.mean(az))); i += 5
        else:
            i += 1
    # 기준점은 약 1분 간격, 같은 자세(고도각 비슷): 앞 기준점에서 35~85초 뒤 묶음 중
    # 첫 기준점과 고도각이 가장 비슷하고 60초에 가까운 것 (자유 연주 중 우연히 걸린 묶음 제외)
    if not out: return []
    keep = [out[0]]
    while True:
        c = [g for g in out if 35 < g[0] - keep[-1][0] < 85]
        if not c: break
        keep.append(min(c, key=lambda g: abs(g[1] - out[0][1]) + 0.2 * abs(g[0] - keep[-1][0] - 60)))
    return keep

def unwrap(a):
    o = [a[0]]
    for x in a[1:]:
        d = x - o[-1]
        d = (d + 180) % 360 - 180
        o.append(o[-1] + d)
    return o

rows = [r for r in csv.reader(open(sys.argv[1], encoding='utf-8')) if r and r[0] == 'hit']
t0 = float(rows[0][8])
t_from = float(sys.argv[2]) if len(sys.argv) > 2 else 0
for role, name in (('0', '왼손'), ('1', '오른손')):
    h = [((float(r[8]) - t0) / 1000, float(r[4]), float(r[5])) for r in rows if r[9] == role]
    g = [x for x in groups([x for x in h if x[0] >= t_from])]
    if len(g) < 2: print(name, '기준점 묶음 부족', len(g)); continue
    az = unwrap([x[2] for x in g])
    rate = (az[-1] - az[0]) / ((g[-1][0] - g[0][0]) / 60)
    print(f'{name}: 기준점 {len(g)}회, ' + ' '.join(f'{x[0]/60:.1f}분 {a:.0f}°' for x, a in zip(g, az)))
    print(f'  → {az[-1]-az[0]:+.1f}° / {(g[-1][0]-g[0][0])/60:.1f}분 = {rate:+.1f}°/분')
