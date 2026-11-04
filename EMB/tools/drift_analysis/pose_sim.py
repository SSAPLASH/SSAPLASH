"""펌웨어 pose.c를 그대로 옮긴 재생기. raw CSV(t_us,seg,gx..az, LSB)를 넣으면 방위각 흐름을 본다."""
import csv, sys, numpy as np
GY=0.070; AC=0.000488*9.80665; G=9.80665
def qmul(a,b):
    return np.array([a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],
                     a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],
                     a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],
                     a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]])
def rot(q,v):
    r=qmul(qmul(q,np.r_[0,v]),q*np.array([1,-1,-1,-1])); return r[1:]
def load(f):
    d=np.array([[float(x[k]) for k in ('t_us','seg','gx','gy','gz','ax','ay','az')] for x in csv.DictReader(open(f))])
    return d
def run(d, bias, tip=(1,0,0), kp=2.5, gate_ms2=1.5, gate_dps=200, acc_every=5, bias_track=None):
    tip=np.array(tip,float); tip/=np.linalg.norm(tip)
    a0=d[:200,5:8].mean(0)*AC; u=a0/np.linalg.norm(a0)
    q=np.array([1+u[2],u[1],-u[0],0]); q/=np.linalg.norm(q)
    b=np.array(bias,float).copy()
    out=[]; tprev=None; k=0
    w0=rot(q,tip); azref=np.degrees(np.arctan2(w0[1],w0[0]))
    still=0; acc_b=np.zeros(3); nb=0
    for row in d:
        t=row[0]; graw=row[2:5]*GY; g=graw-b; a=row[5:8]*AC
        dt=(t-tprev)*1e-6 if tprev is not None else 0.0006; tprev=t
        if bias_track:   # 정지 중 바이어스 재추정
            gm=np.linalg.norm(g); am=abs(np.linalg.norm(a)-G)
            if gm<bias_track['dps'] and am<bias_track['ms2']: still+=1
            else: still=0
            if still>bias_track['n']: b+= bias_track['alpha']*(graw-b)
        w=np.radians(g); k+=1
        if k>=acc_every:
            k=0; n=np.linalg.norm(a); gm=np.linalg.norm(g)
            if abs(n-G)<gate_ms2 and gm<gate_dps:
                um=a/n; ue=rot(q*np.array([1,-1,-1,-1]),np.array([0,0,1.]))
                w=w+kp*np.cross(um,ue)
        q=q+0.5*qmul(q,np.r_[0,w])*dt; q/=np.linalg.norm(q)
        wv=rot(q,tip); el=np.degrees(np.arcsin(np.clip(wv[2],-1,1)))
        az=-(np.degrees(np.arctan2(wv[1],wv[0]))-azref); az=(az+180)%360-180
        out.append((t,row[1],el,az,np.linalg.norm(row[2:5]*GY)))
    return np.array(out)
