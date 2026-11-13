#!/usr/bin/env python3
"""임시 Nginx와 가짜 OAuth 값으로 콜백 로그·프록시 동작을 검사한다."""
import http.client
import json
import pathlib
import socket
import ssl
import subprocess
import tempfile
import time
import uuid

from test_upload_limits import IMAGE, MOCK_IMAGE, docker

ROOT = pathlib.Path(__file__).resolve().parent
MOCK = r'''from http.server import BaseHTTPRequestHandler, HTTPServer
import json
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  data=json.dumps({"path":self.path,"host":self.headers.get("Host"),"real_ip":self.headers.get("X-Real-IP"),"forwarded_for":self.headers.get("X-Forwarded-For"),"proto":self.headers.get("X-Forwarded-Proto")}).encode()
  self.send_response(200); self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
 def log_message(self,*args): pass
HTTPServer(("0.0.0.0",8080),Handler).serve_forever()
'''


def request(port, path, secure=True, headers=None):
    if secure:
        conn = http.client.HTTPSConnection("127.0.0.1", port, timeout=10, context=ssl._create_unverified_context())
    else:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", path, headers=headers or {})
    response = conn.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    conn.close()
    return result


def main():
    suffix = uuid.uuid4().hex[:12]
    network, mock, nginx = ["oauth-log-" + x + "-" + suffix for x in ("net", "mock", "nginx")]
    code, state, referer = "dummy-oauth-code-92", "dummy-oauth-state-92", "dummy-referer-92"
    with tempfile.TemporaryDirectory(prefix="oauth-log-") as temp:
        temp = pathlib.Path(temp)
        (temp / "mock.py").write_text(MOCK, encoding="utf-8")
        try:
            docker("network", "create", network)
            docker("run", "-d", "--name", mock, "--network", network, "--network-alias", "api", "--entrypoint", "sleep", MOCK_IMAGE, "infinity")
            docker("cp", str(temp / "mock.py"), mock + ":/mock.py")
            docker("exec", mock, "mkdir", "-p", "/tmp/letsencrypt/live/k15a307.p.ssafy.io")
            docker("exec", mock, "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", "/tmp/letsencrypt/live/k15a307.p.ssafy.io/privkey.pem", "-out", "/tmp/letsencrypt/live/k15a307.p.ssafy.io/fullchain.pem")
            docker("cp", mock + ":/tmp/letsencrypt", str(temp))
            docker("exec", "-d", mock, "python", "/mock.py")
            docker("run", "-d", "--name", nginx, "--network", network, "-p", "127.0.0.1::443", "-p", "127.0.0.1::80", "--entrypoint", "sleep", IMAGE, "infinity")
            docker("cp", str(ROOT / "default.conf"), nginx + ":/etc/nginx/conf.d/default.conf")
            docker("cp", str(temp / "letsencrypt"), nginx + ":/etc/letsencrypt")
            print(docker("exec", nginx, "nginx", "-t").strip())
            # sleep 컨테이너에서 exec한 Nginx의 stdout은 docker logs로 수집되지 않는다.
            # 설정의 로그 목적지만 임시 파일로 바꿔 같은 형식의 접근·오류 로그를 직접 확인한다.
            docker("exec", nginx, "sed", "-i", "s@/var/log/nginx/access.log@/tmp/access.log@g", "/etc/nginx/conf.d/default.conf")
            docker("exec", nginx, "sed", "-i", "s@/var/log/nginx/error.log@/tmp/error.log@g", "/etc/nginx/nginx.conf")
            docker("exec", nginx, "nginx", "-t")
            docker("exec", "-d", nginx, "nginx", "-g", "daemon off;")
            https_port = int(docker("port", nginx, "443/tcp").strip().rsplit(":", 1)[1])
            http_port = int(docker("port", nginx, "80/tcp").strip().rsplit(":", 1)[1])
            for _ in range(50):
                try:
                    with socket.create_connection(("127.0.0.1", https_port), timeout=1): break
                except OSError: time.sleep(.1)
            else: raise RuntimeError("nginx 시작 실패")
            for provider in ("google", "ssafy", "Google", "unknown"):
                path = f"/api/auth/{provider}/callback?code={code}&state={state}"
                status, headers, _ = request(http_port, path, False, {"Host": "example.test", "Referer": referer})
                assert status == 301 and headers.get("Location") == "https://example.test" + path, (status, headers)
                assert headers.get("Referrer-Policy") == "no-referrer", headers
                status, headers, body = request(https_port, path, headers={"Host": "example.test", "Referer": referer})
                received = json.loads(body)
                assert status == 200 and received["path"] == path, (status, received)
                assert received["host"] == "example.test" and received["proto"] == "https" and received["real_ip"] and received["forwarded_for"], received
                assert headers.get("Referrer-Policy") == "no-referrer" and headers.get("X-Frame-Options") == "DENY", headers
            status, headers, _ = request(https_port, "/api/probe?ordinary=1", headers={"Referer": "https://example.test/api/auth/google/callback?code=" + code})
            assert status == 200 and headers.get("Referrer-Policy") == "strict-origin-when-cross-origin", (status, headers)
            docker("stop", mock)
            for provider in ("google", "ssafy", "Google", "unknown"):
                status, headers, _ = request(https_port, f"/api/auth/{provider}/callback?code={code}&state={state}", headers={"Referer": referer})
                assert status == 502 and headers.get("Referrer-Policy") == "no-referrer", (status, headers)
            status, _, _ = request(https_port, "/api/probe-error")
            assert status == 502, status
            logs = docker("exec", nginx, "cat", "/tmp/access.log")
            errors = docker("exec", nginx, "cat", "/tmp/error.log")
            assert "/api/probe?ordinary=1" in logs and "/api/probe-error" in errors, (logs, errors)
            logs += errors
            assert not any(secret in logs for secret in (code, state, referer)), logs
            print("PASS HTTP 리다이렉트, HTTPS 프록시·보안 헤더, 콜백 성공·오류 및 일반 접근 로그")
        finally:
            for name in (nginx, mock): subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if __name__ == "__main__": main()