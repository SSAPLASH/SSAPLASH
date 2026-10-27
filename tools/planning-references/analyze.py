import sys, pickle, os, numpy as np, pandas as pd
raw, cache, out = sys.argv[1], sys.argv[2], sys.argv[3]
if os.path.exists(cache):
    df = pickle.load(open(cache, "rb"))
else:
    df = pd.read_excel(raw); pickle.dump(df, open(cache, "wb"))
f = open(out, "w", encoding="utf-8")
def p(*a): print(*a, file=f)
w = df["WT"].astype(float)
AGE = {1:"15~19세",2:"20대",3:"30대",4:"40대",5:"50대",6:"60대",7:"70세 이상"}
df["age"] = df["DM2"].map(AGE)
FIELDS = {1:"문학",2:"미술",3:"서양음악",4:"전통예술",5:"연극",6:"뮤지컬",7:"무용",8:"영화",9:"대중음악/연예"}
def wrate(mask, base=None):
    base = pd.Series(True, index=df.index) if base is None else base
    return 100*w[mask & base].sum()/w[base].sum()
def by_age(mask, base=None):
    base = pd.Series(True, index=df.index) if base is None else base
    return {a: round(wrate(mask & (df.age==a), base & (df.age==a)),2) for a in AGE.values()}
p("N =", len(df), " weighted sum =", round(w.sum()))
p("unweighted age counts:", df.age.value_counts().to_dict())
p("\n## 분야별 깔때기 (전체, 가중 %)")
p("분야\t직접관람(횟수>0)\t매체관람 경험\t직접참여 경험\t교육 경험\t관람의향\t참여의향\t교육의향\t지출늘리고싶음")
for k,v in FIELDS.items():
    view = df[f"Q1_1_{k}_N"].fillna(0).astype(float) > 0
    media = df[f"Q4_1_{k}"] == 1
    part = df[f"Q6_1_{k}"] == 1
    edu = df[f"Q9_1_{k}"] == 1
    vi = df[f"Q1_3_{k}"] == 1; pi = df[f"Q6_3_{k}"] == 1; ei = df[f"Q9_3_{k}"] == 1; sp = df[f"Q18_7_{k}"] == 1
    p(f"{v}\t{wrate(view):.1f}\t{wrate(media):.1f}\t{wrate(part):.1f}\t{wrate(edu):.1f}\t{wrate(vi):.1f}\t{wrate(pi):.1f}\t{wrate(ei):.1f}\t{wrate(sp):.1f}")
p("\n## 서양음악 연령대별")
for name, col in [("직접관람", None), ("매체관람", "Q4_1_3"), ("직접참여", "Q6_1_3"), ("교육경험", "Q9_1_3"), ("관람의향", "Q1_3_3"), ("참여의향", "Q6_3_3"), ("교육의향", "Q9_3_3"), ("동호회", "Q14_1_3"), ("지출확대의향", "Q18_7_3")]:
    mask = (df["Q1_1_3_N"].fillna(0).astype(float) > 0) if col is None else (df[col] == 1)
    p(name, by_age(mask))
p("\n## 대중음악/연예 연령대별")
for name, col in [("직접관람", None), ("매체관람", "Q4_1_9"), ("직접참여", "Q6_1_9"), ("교육경험", "Q9_1_9"), ("참여의향", "Q6_3_9"), ("교육의향", "Q9_3_9")]:
    mask = (df["Q1_1_9_N"].fillna(0).astype(float) > 0) if col is None else (df[col] == 1)
    p(name, by_age(mask))
p("\n## 음악(서양음악 OR 대중음악) 합산 연령대별")
for name, cols in [("관람(직접or매체)", None), ("직접참여", ["Q6_1_3","Q6_1_9"]), ("교육경험", ["Q9_1_3","Q9_1_9"]), ("참여의향", ["Q6_3_3","Q6_3_9"]), ("교육의향", ["Q9_3_3","Q9_3_9"])]:
    if cols is None:
        mask = (df["Q1_1_3_N"].fillna(0)>0)|(df["Q1_1_9_N"].fillna(0)>0)|(df["Q4_1_3"]==1)|(df["Q4_1_9"]==1)
    else:
        mask = (df[cols[0]]==1)|(df[cols[1]]==1)
    p(name, "전체=%.2f"%wrate(mask), by_age(mask))
p("\n## 과거 교육 경험 Q7(유아·아동) Q8(청소년) 연령대별 '있다' %")
p("Q7", by_age(df.Q7==1)); p("Q8", by_age(df.Q8==1))
p("\n## Q11 문화행사 참여시 가장 큰 어려움 (전체 / 20대 / 30대 / 20~30대)")
LBL11 = {1:"비용이 많이 든다",2:"시간이 좀처럼 나지 않는다",3:"관심 있는 프로그램이 없다",4:"교통이 불편하다",5:"시설이 불편하다",6:"관련정보가 부족하다",7:"함께 갈 사람이 없다",8:"주변에 이용 공간이 없다",9:"기타"}
for label, base in [("전체", df.Q11.notna()), ("20대", df.Q11.notna()&(df.age=="20대")), ("30대", df.Q11.notna()&(df.age=="30대")), ("20~30대", df.Q11.notna()&df.age.isin(["20대","30대"]))]:
    p(label, "n=", int(base.sum()), {LBL11[k]: round(wrate(df.Q11==k, base),1) for k in LBL11})
p("\n## Q17 시간적 여건 (1~3 부족 %) / Q19 비용 인식 (1~3 부족 %)")
p("Q17 부족", "전체=%.1f"%wrate(df.Q17.isin([1,2,3]), df.Q17.notna()), by_age(df.Q17.isin([1,2,3]), df.Q17.notna()))
p("Q19 부족", "전체=%.1f"%wrate(df.Q19.isin([1,2,3]), df.Q19.notna()), by_age(df.Q19.isin([1,2,3]), df.Q19.notna()))
p("\n## Q20 적정 월 평균 문화예술 지출 (단위 확인용 기술통계)")
q20 = df.Q20.astype(float)
p(q20.describe().to_string())
def wmedian(x, ww):
    m = x.notna(); x, ww = x[m], ww[m]; o = np.argsort(x.values); cs = np.cumsum(ww.values[o]); return x.values[o][np.searchsorted(cs, cs[-1]/2)]
def wmean(x, ww):
    m = x.notna(); return (x[m]*ww[m]).sum()/ww[m].sum()
p("가중 평균", round(wmean(q20, w),1), "가중 중앙값", wmedian(q20, w))
for a in AGE.values():
    m = df.age==a; p(a, "평균", round(wmean(q20[m], w[m]),1), "중앙값", wmedian(q20[m], w[m]))
p("분포(가중%):", {b: round(wrate((q20>=lo)&(q20<hi), q20.notna()),1) for b,(lo,hi) in {"<3만":(0,3),"3~5만":(3,5),"5~10만":(5,10),"10~15만":(10,15),"15~20만":(15,20),"20만+":(20,1e9)}.items()})
p("\n## Q18 서양음악 교육비 (Q18_4_3_N) 지출자 기술통계 / 월평균 합계 Q18_6_10_N")
e = df["Q18_4_3_N"].astype(float); p("교육비>0 비율 %.2f"%wrate(e.fillna(0)>0)); p(e[e>0].describe().to_string())
t = df["Q18_6_10_N"].astype(float); p("월평균 합계 가중평균", round(wmean(t, w),1), "중앙값", wmedian(t, w))
p("\n## 주택유형(APT 1주택 2아파트)별 서양음악 교육경험/참여/의향")
for name, col in [("교육경험","Q9_1_3"),("직접참여","Q6_1_3"),("교육의향","Q9_3_3"),("참여의향","Q6_3_3")]:
    p(name, {"주택": round(wrate(df[col]==1, df.APT==1),2), "아파트": round(wrate(df[col]==1, df.APT==2),2)})
p("APT 분포", {"주택": round(wrate(df.APT==1),1), "아파트": round(wrate(df.APT==2),1)})
p("\n## 1인가구(DM4==1) 비율 연령대별, 1인가구 vs 다인가구 서양음악 교육의향")
p("1인가구 비율", by_age(df.DM4==1))
p("교육의향 1인", round(wrate(df.Q9_3_3==1, df.DM4==1),2), "다인", round(wrate(df.Q9_3_3==1, df.DM4!=1),2))
p("\n## 교육 의향 있는데 경험 없는 사람 (서양음악) 연령대별 %")
gap = (df.Q9_3_3==1)&(df.Q9_1_3!=1); p("의향有·경험無", "전체=%.2f"%wrate(gap), by_age(gap))
p("의향 있는 사람 중 경험 없는 비율", "전체=%.1f"%wrate(df.Q9_1_3!=1, df.Q9_3_3==1), by_age(df.Q9_1_3!=1, df.Q9_3_3==1))
p("\n## 동호회 서양음악 성격 (Q14_2_3) 1창작 2감상 (동호회 참여자 중)")
b = df.Q14_1_3==1; p("동호회 참여 %.2f"%wrate(b), {"창작": round(wrate(df.Q14_2_3==1,b),1), "감상": round(wrate(df.Q14_2_3==2,b),1)})
p("\n## 교육 만족도 Q9_2_3 (서양음악 교육 경험자) 평균, 5~7 만족 %")
b = df.Q9_1_3==1; s = df.Q9_2_3.astype(float); p("n=", int(b.sum()), "가중평균", round(wmean(s[b], w[b]),2), "만족(5~7)%", round(wrate(s.isin([5,6,7]), b),1))
f.close()
