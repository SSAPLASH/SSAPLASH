"""v5 + 페달 v1 출력 파일을 전부 다시 쓴다. 실행 위치: EMB/cad"""
import pedal_box_v1 as p
import stick_v5 as s

for fn in (s.stick_v5_grip_bottom, s.stick_v5_grip_top, s.stick_v5_box, s.stick_v5_lid_L, s.stick_v5_lid_R,
           s.stick_v5_shaft, s.stick_v5_clip_ring, s.stick_v5_assembly, p.pedal_box_v1_base, p.pedal_box_v1_lid, p.pedal_box_v1_assembly):
    name = fn.__name__
    fn().export(f"STL/{name}.stl", f"3MF/{name}.3mf", f"STEP/{name}.step")
    print("wrote", name)
