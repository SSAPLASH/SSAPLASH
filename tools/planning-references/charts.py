"""2023 국민문화예술활동조사 원시자료 → 기획발표용 차트 6장.
사용법: python -I charts.py <raw.pkl> <출력 폴더>
"""
import sys, pickle, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm

cache, outdir = sys.argv[1], sys.argv[2]
df = pickle.load(open(cache, "rb")).copy()

# 한글 폰트
for name in ["Malgun Gothic", "NanumGothic", "Apple SD Gothic Neo"]:
    if any(f.name == name for f in fm.fontManager.ttflist):
        plt.rcParams["font.family"] = name
        break
plt.rcParams["axes.unicode_minus"] = False

C_MAIN, C_SUB, C_ACC, C_GRAY, C_TXT = "#1F3A5F", "#9DB4CE", "#E4572E", "#C9CED6", "#222222"
SRC = "출처: 문화체육관광부, 2023 국민문화예술활동조사 원시자료 (만 15세 이상 10,182명, 가중치 적용) · 분석: 팀 자체"

w = df["WT"].astype(float)
AGE = {1: "15~19세", 2: "20대", 3: "30대", 4: "40대", 5: "50대", 6: "60대", 7: "70세 이상"}
df["age"] = df["DM2"].map(AGE)
ages = list(AGE.values())


def wrate(mask, base=None):
    base = pd.Series(True, index=df.index) if base is None else base
    return 100 * w[mask & base].sum() / w[base].sum()


def by_age(mask, base=None):
    base = pd.Series(True, index=df.index) if base is None else base
    return [wrate(mask & (df.age == a), base & (df.age == a)) for a in ages]


def wmedian(x, ww):
    m = x.notna()
    x, ww = x[m], ww[m]
    o = np.argsort(x.values)
    cs = np.cumsum(ww.values[o])
    return x.values[o][np.searchsorted(cs, cs[-1] / 2)]


def style(ax, title, sub=None):
    ax.set_title(title, fontsize=17, fontweight="bold", color=C_TXT, loc="left", pad=18)
    if sub:
        ax.text(0, 1.02, sub, transform=ax.transAxes, fontsize=11, color="#555555")
    for s in ["top", "right", "left"]:
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(C_GRAY)
    ax.tick_params(colors="#444444", labelsize=11)
    ax.yaxis.grid(True, color="#EEEEEE")
    ax.set_axisbelow(True)


def footer(fig, extra=None):
    fig.text(0.01, 0.01, SRC + (("  |  " + extra) if extra else ""), fontsize=8.5, color="#777777")


def save(fig, name):
    fig.savefig(f"{outdir}/{name}", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# 1. 음악 깔때기 --------------------------------------------------------------
view = (df["Q1_1_3_N"].fillna(0) > 0) | (df["Q1_1_9_N"].fillna(0) > 0) | (df["Q4_1_3"] == 1) | (df["Q4_1_9"] == 1)
intent = (df["Q6_3_3"] == 1) | (df["Q6_3_9"] == 1)
edu = (df["Q9_1_3"] == 1) | (df["Q9_1_9"] == 1)
part = (df["Q6_1_3"] == 1) | (df["Q6_1_9"] == 1)
vals = [wrate(view), wrate(intent), wrate(edu), wrate(part)]
labels = ["음악을 듣는다\n(직접·매체 관람)", "직접 해보고 싶다\n(1년 내 참여 의향)", "배운 적 있다\n(지난 1년 교육 경험)", "직접 한다\n(연주·공연 참여)"]
fig, ax = plt.subplots(figsize=(11, 6))
bars = ax.bar(labels, vals, color=[C_SUB, C_MAIN, C_MAIN, C_ACC], width=0.6)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width() / 2, v + 1.2, f"{v:.1f}%", ha="center", fontsize=15, fontweight="bold", color=C_TXT)
ax.set_ylim(0, 62)
ax.set_ylabel("응답자 비율 (%)", fontsize=11)
style(ax, "음악, 듣는 사람은 2명 중 1명 · 직접 하는 사람은 100명 중 2명", "서양음악 + 대중음악 합산, 만 15세 이상 전체")
ax.annotate("", xy=(3, 8), xytext=(0, 48), arrowprops=dict(arrowstyle="->", color=C_ACC, lw=2, connectionstyle="arc3,rad=-0.25"))
ax.text(1.5, 40, "약 30배 격차", color=C_ACC, fontsize=13, fontweight="bold", ha="center")
footer(fig)
save(fig, "01_음악_관람vs참여_깔때기.png")

# 2. 서양음악 교육 경험 연령대별 ----------------------------------------------
vals = by_age(df["Q9_1_3"] == 1)
fig, ax = plt.subplots(figsize=(11, 6))
cols = [C_ACC if a == "20대" else (C_MAIN if a == "30대" else C_SUB) for a in ages]
bars = ax.bar(ages, vals, color=cols, width=0.62)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.15, f"{v:.1f}%", ha="center", fontsize=13, fontweight="bold", color=C_TXT)
ax.set_ylim(0, 9)
ax.set_ylabel("지난 1년 교육 경험 (%)", fontsize=11)
style(ax, "악기(서양음악)를 배우는 성인은 20대도 18명 중 1명", "지난 1년간 서양음악 분야 문화예술교육 경험 비율, 연령대별")
ax.text(1, 7.2, "20대 5.6%\n→ 18명 중 1명", color=C_ACC, fontsize=12, fontweight="bold", ha="center")
footer(fig)
save(fig, "02_서양음악_교육경험_연령대별.png")

# 3. 어릴 때 vs 지금 (20대·30대) ----------------------------------------------
groups = ["20대", "30대"]
q7 = [wrate(df.Q7 == 1, df.age == g) for g in groups]
q8 = [wrate(df.Q8 == 1, df.age == g) for g in groups]
anynow = [wrate(df[[f"Q9_1_{k}" for k in range(1, 10)]].eq(1).any(axis=1), df.age == g) for g in groups]
fig, ax = plt.subplots(figsize=(11, 6))
x = np.arange(3)
wd = 0.36
for i, g in enumerate(groups):
    v = [q7[i], q8[i], anynow[i]]
    bars = ax.bar(x + (i - 0.5) * wd, v, wd, color=[C_MAIN, C_SUB][i], label=g)
    for b, val in zip(bars, v):
        ax.text(b.get_x() + b.get_width() / 2, val + 0.8, f"{val:.1f}%", ha="center", fontsize=12, fontweight="bold", color=C_TXT)
ax.set_xticks(x)
ax.set_xticklabels(["유아·아동기\n문화예술교육 경험", "청소년기\n문화예술교육 경험", "지금 (지난 1년)\n문화예술교육 경험"])
ax.set_ylim(0, 55)
ax.legend(frameon=False, fontsize=12)
ax.set_ylabel("응답자 비율 (%)", fontsize=11)
style(ax, "어릴 땐 절반이 배웠지만, 어른이 되면 배움이 끊긴다", "20·30대 응답자의 생애 단계별 문화예술교육(전 분야) 경험 비율")
footer(fig, "유아·청소년기는 과거 회상 응답")
save(fig, "03_어릴때vs지금_교육경험.png")

# 4. 가장 큰 어려움 20대 vs 30대 ----------------------------------------------
LBL = {1: "비용이 많이 든다", 2: "시간이 나지 않는다", 3: "관심 있는 프로그램이 없다", 6: "관련 정보가 부족하다",
       8: "주변에 이용 공간이 없다", 4: "교통이 불편하다", 5: "시설이 불편하다", 7: "함께 갈 사람이 없다"}
keys = list(LBL.keys())
v20 = [wrate(df.Q11 == k, df.age == "20대") for k in keys]
v30 = [wrate(df.Q11 == k, df.age == "30대") for k in keys]
vall = [wrate(df.Q11 == k) for k in keys]
fig, ax = plt.subplots(figsize=(11, 6.5))
y = np.arange(len(keys))
h = 0.27
ax.barh(y + h, vall, h, color=C_GRAY, label="전체")
ax.barh(y, v20, h, color=C_ACC, label="20대")
ax.barh(y - h, v30, h, color=C_MAIN, label="30대")
for yy, a, b, c in zip(y, vall, v20, v30):
    ax.text(a + 0.4, yy + h, f"{a:.1f}", va="center", fontsize=10, color="#666666")
    ax.text(b + 0.4, yy, f"{b:.1f}", va="center", fontsize=10, color=C_ACC, fontweight="bold")
    ax.text(c + 0.4, yy - h, f"{c:.1f}", va="center", fontsize=10, color=C_MAIN, fontweight="bold")
ax.set_yticks(y)
ax.set_yticklabels([LBL[k] for k in keys])
ax.invert_yaxis()
ax.set_xlim(0, 32)
ax.set_xlabel("응답 비율 (%)", fontsize=11)
ax.legend(frameon=False, fontsize=11, loc="lower right")
style(ax, "20대는 '비용', 30대는 '시간'이 가장 큰 벽", "문화행사 참여 시 가장 큰 어려움 (단일 응답)")
ax.yaxis.grid(False)
ax.xaxis.grid(True, color="#EEEEEE")
footer(fig)
save(fig, "04_참여_어려움_20대vs30대.png")

# 5. 배우고 싶지만 못 배운 비율 ------------------------------------------------
vals = by_age(df.Q9_1_3 != 1, df.Q9_3_3 == 1)
tot = wrate(df.Q9_1_3 != 1, df.Q9_3_3 == 1)
fig, ax = plt.subplots(figsize=(11, 6))
cols = [C_ACC if a in ("20대", "30대") else C_SUB for a in ages]
bars = ax.bar(ages, vals, color=cols, width=0.62)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width() / 2, v + 1.5, f"{v:.0f}%", ha="center", fontsize=13, fontweight="bold", color=C_TXT)
ax.axhline(tot, color=C_MAIN, ls="--", lw=1.5)
ax.text(6.45, tot + 1.5, f"전체 {tot:.0f}%", color=C_MAIN, fontsize=11, ha="right", fontweight="bold")
ax.set_ylim(0, 100)
ax.set_ylabel("의향자 중 미경험 비율 (%)", fontsize=11)
style(ax, "배우고 싶은 사람 3명 중 2명은 지난 1년간 배우지 못했다", "서양음악 교육 의향이 있는 응답자 중, 지난 1년간 교육 경험이 없는 비율")
footer(fig, "의향자 표본이 적음(전체 160명, 연령대별 10~36명) → 발표에는 전체 64%만 인용 권장")
save(fig, "05_배우고싶지만_못배운비율.png")

# 6. 적정 지출 vs 드럼 학원비 --------------------------------------------------
q20 = df.Q20.astype(float)
med_all = wmedian(q20, w) / 10000
med20 = wmedian(q20[df.age == "20대"], w[df.age == "20대"]) / 10000
med30 = wmedian(q20[df.age == "30대"], w[df.age == "30대"]) / 10000
labels = ["전체 응답자\n적정 지출 (중앙값)", "20대\n적정 지출 (중앙값)", "30대\n적정 지출 (중앙값)", "드럼 학원 취미반\n(주 1회, 시장가)"]
vals = [med_all, med20, med30, 17.5]
fig, ax = plt.subplots(figsize=(11, 6))
bars = ax.bar(labels, vals, color=[C_SUB, C_MAIN, C_MAIN, C_ACC], width=0.6)
texts = [f"{med_all:.0f}만 원", f"{med20:.0f}만 원", f"{med30:.1f}만 원", "15~20만 원"]
for b, v, t in zip(bars, vals, texts):
    ax.text(b.get_x() + b.get_width() / 2, v + 0.5, t, ha="center", fontsize=14, fontweight="bold", color=C_TXT)
ax.errorbar(3, 17.5, yerr=2.5, color="white", capsize=8, lw=2)
ax.set_ylim(0, 23)
ax.set_ylabel("월 지출 (만 원)", fontsize=11)
style(ax, "사람들이 생각하는 적정 문화예술 지출은 월 3~5만 원, 드럼 학원은 그 4배", "'문화예술 향유에 적절하다고 생각하는 1인 월평균 지출' vs 드럼 학원 수강료")
footer(fig, "학원비: 숨고·학원 공시가 조사 (2025)")
save(fig, "06_적정지출vs드럼학원비.png")

print("done")
