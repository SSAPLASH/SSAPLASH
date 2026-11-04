#!/usr/bin/env python3
"""실제 Nginx 설정의 업로드 경계를 임시 Docker 서버로 검사한다."""
import http.client
import json
import pathlib
import socket
import ssl
import subprocess
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parent
IMAGE = "nginx:1.27-alpine"
MOCK_IMAGE = "python:3.11-slim"
M = 1024 * 1024
K = 1024
CASES = [
    ("POST", "/api/v1/songs/midi", 1088*K, "MIDI_TOO_LARGE", "multipart"),
    ("POST", "/api/v1/admin/songs/midi", 1088*K, "MIDI_TOO_LARGE", "multipart"),
    ("PUT", "/api/v1/admin/songs/42/charts/midi", 1088*K, "MIDI_TOO_LARGE", "multipart"),
    ("PUT", "/api/v1/songs/42/cover", 2112*K, "COVER_TOO_LARGE", "multipart"),
    ("PUT", "/api/v1/admin/songs/42/cover", 2112*K, "COVER_TOO_LARGE", "multipart"),
    ("PUT", "/api/v1/admin/songs/42/accompaniment", 51*M, "ACCOMPANIMENT_TOO_LARGE", "multipart"),
    ("POST", "/api/v1/plays", 5*M, "PLAY_UPLOAD_TOO_LARGE", "json"),
    ("POST", "/api/v1/recordings", 5*M, "RECORDING_TOO_LARGE", "json"),
    ("POST", "/api/v1/sheets", 51*M, "SHEET_TOO_LARGE", "multipart"),
    ("POST", "/api/v1/songs/audio", 51*M, None, "multipart"),
    ("POST", "/api/v1/plays/42/raw", 21*M, None, "multipart"),
    ("PUT", "/airdrum-tmp-audio/worker-staging/42", 128*M, None, "binary"),
    ("POST", "/api/v1/ordinary", M, None, "json"),
]
MOCK = r'''from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, threading
class Handler(BaseHTTPRequestHandler):
 def handle_request(self):
  size=int(self.headers.get("Content-Length", "0")); remaining=size
  while remaining:
   part=self.rfile.read(min(65536,remaining))
   if not part: break
   remaining-=len(part)
  body=json.dumps({"method":self.command,"path":self.path,"length":size-remaining,"auth":self.headers.get("Authorization")}).encode()
  self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
 def do_POST(self): self.handle_request()
 def do_PUT(self): self.handle_request()
 def log_message(self,*args): pass
threading.Thread(target=ThreadingHTTPServer(("0.0.0.0",8333),Handler).serve_forever,daemon=True).start()
ThreadingHTTPServer(("0.0.0.0",8080),Handler).serve_forever()
'''

def docker(*args, capture=True):
    return subprocess.run(["docker", *args], check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.STDOUT if capture else None).stdout

def body_parts(size, kind):
    if kind == "multipart":
        start = b'--testboundary\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
        end = b'\r\n--testboundary--\r\n'
    elif kind == "json":
        start, end = b'{"payload":"', b'"}'
    else:
        start, end = b'', b''
    yield start
    remaining = size - len(start) - len(end)
    if remaining < 0: raise ValueError("요청 크기가 본문 형식보다 작습니다")
    chunk = b'a' * 65536
    while remaining:
        n = min(remaining, len(chunk)); yield chunk[:n]; remaining -= n
    yield end

def request(port, method, path, size, kind, extra=None, reject=False):
    context = ssl._create_unverified_context()
    conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=120, context=context)
    conn.putrequest(method, path)
    conn.putheader("Content-Length", str(size))
    conn.putheader("Content-Type", "multipart/form-data; boundary=testboundary" if kind == "multipart" else "application/json" if kind == "json" else "application/octet-stream")
    conn.putheader("Authorization", "Bearer dummy-test-token")
    for key, value in (extra or {}).items(): conn.putheader(key, value)
    conn.endheaders()
    # 초과 요청은 Nginx가 Content-Length 헤더만으로 즉시 거절하므로 본문을 보내지 않는다.
    if not reject:
        for part in body_parts(size, kind):
            if part: conn.send(part)
    response = conn.getresponse(); data = response.read()
    result=(response.status, response.getheader("Content-Type", ""), data)
    conn.close()
    return result

def main():
    suffix = uuid.uuid4().hex[:12]
    network, mock, nginx = ["upload-173-"+x+"-"+suffix for x in ("net","mock","nginx")]
    with tempfile.TemporaryDirectory(prefix="upload-173-") as temp:
        temp = pathlib.Path(temp); mock_file = temp / "mock.py"; mock_file.write_text(MOCK, encoding="utf-8")
        try:
            docker("network", "create", network)
            docker("run", "-d", "--name", mock, "--network", network, "--network-alias", "api", "--network-alias", "seaweedfs", "--entrypoint", "sleep", MOCK_IMAGE, "infinity")
            docker("cp", str(mock_file), mock+":/mock.py")
            docker("exec", mock, "mkdir", "-p", "/tmp/letsencrypt/live/k15a307.p.ssafy.io")
            docker("exec", mock, "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", "/tmp/letsencrypt/live/k15a307.p.ssafy.io/privkey.pem", "-out", "/tmp/letsencrypt/live/k15a307.p.ssafy.io/fullchain.pem")
            docker("cp", mock+":/tmp/letsencrypt", str(temp))
            docker("exec", "-d", mock, "python", "/mock.py")
            docker("run", "-d", "--name", nginx, "--network", network, "-p", "127.0.0.1::443", "-p", "127.0.0.1::80", "--entrypoint", "sleep", IMAGE, "infinity")
            docker("cp", str(ROOT / "default.conf"), nginx+":/etc/nginx/conf.d/default.conf")
            docker("cp", str(temp / "letsencrypt"), nginx+":/etc/letsencrypt")
            print(docker("exec", nginx, "nginx", "-t").strip())
            docker("exec", "-d", nginx, "nginx", "-g", "daemon off;")
            port=int(docker("port", nginx, "443/tcp").strip().rsplit(":",1)[1])
            for _ in range(50):
                try:
                    with socket.create_connection(("127.0.0.1",port),timeout=1): break
                except OSError: time.sleep(.1)
            else: raise RuntimeError("nginx 시작 실패")
            http_port=int(docker("port", nginx, "80/tcp").strip().rsplit(":",1)[1])
            plain=http.client.HTTPConnection("127.0.0.1",http_port,timeout=10)
            plain.request("GET","/internal/v1/chart-jobs/test")
            response=plain.getresponse(); assert response.status == 404,("HTTP internal",response.status)
            response.read(); plain.close()
            status, _, _ = request(port,"POST","/internal/v1/chart-jobs/test",16,"json",{"X-Forwarded-For":"222.107.238.74"},reject=True)
            assert status == 403, ("internal original deny",status)
            status, _, _ = request(port,"POST","/internal/v1/coach-narratives/test",16,"json",{"X-Forwarded-For":"222.107.238.74"},reject=True)
            assert status == 403, ("coach-narratives original deny",status)
            status, _, _ = request(port,"POST","/internal/other",16,"json",reject=True)
            assert status == 404, ("other internal",status)
            print("PASS 원본 internal 차단 및 X-Forwarded-For 위조 거부")
            for method,path,limit,code,kind in CASES:
                for delta in (0,1):
                    status, content_type, body = request(port,method,path+"?probe=1",limit+delta,kind,reject=(delta==1))
                    if delta == 0:
                        assert status == 200,(path,limit,status,body[:200])
                        received=json.loads(body)
                        assert received == {"method":method,"path":path+"?probe=1","length":limit,"auth":"Bearer dummy-test-token"},(path,received)
                    else:
                        assert status == 413,(path,limit+1,status,body[:200])
                        if code:
                            assert content_type.startswith("application/problem+json"),(path,content_type)
                            assert json.loads(body)["code"] == code,(path,body[:200])
                print(f"PASS {method} {path} {limit} / {limit+1}")
            variant=(ROOT / "default.conf").read_text(encoding="utf-8").replace("allow 222.107.238.74;", "allow all;")
            variant_file=temp / "allow-test.conf"; variant_file.write_text(variant,encoding="utf-8",newline="\n")
            docker("cp",str(variant_file),nginx+":/etc/nginx/conf.d/default.conf")
            docker("exec",nginx,"nginx","-t"); docker("exec",nginx,"nginx","-s","reload")
            for _ in range(50):
                status,_,_ = request(port,"POST","/internal/v1/chart-jobs/test",16,"json")
                if status == 200: break
                time.sleep(.1)
            else: raise RuntimeError("검사용 internal 설정 적용 실패")
            for delta in (0,1):
                status,_,_ = request(port,"POST","/internal/v1/chart-jobs/test",8*M+delta,"json",reject=(delta==1))
                assert status == (200 if delta == 0 else 413),("internal limit",status)
            print("PASS 내부 경로 8 MiB 경계 (테스트 복제본에서만 allow all)")
            for delta in (0,1):
                status,_,_ = request(port,"POST","/internal/v1/coach-narratives/test",64*1024+delta,"json",reject=(delta==1))
                assert status == (200 if delta == 0 else 413),("coach-narratives limit",status)
            print("PASS 총평 작업 경로 64 KiB 경계 (테스트 복제본에서만 allow all)")
        finally:
            for name in (nginx,mock): subprocess.run(["docker","rm","-f",name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            subprocess.run(["docker","network","rm",network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__ == "__main__": main()
