#!/usr/bin/env python3
"""MLflow의 모델 버전을 브라우저가 내려받는 정적 경로(/models)로 게시한다.

사용 (서버에서):
  docker compose -p infra exec mlflow publish-model publish <모델 이름> <MLflow 모델 버전>
  docker compose -p infra exec mlflow publish-model rollback <모델 이름> [<게시된 버전>]
  docker compose -p infra exec mlflow publish-model list

게시 구조:
  /models/manifest.json                  모델별 현재 버전과 전체 버전 목록 (캐시하지 않는다)
  /models/<모델 이름>/<버전>/...         모델 파일 (버전 폴더는 바뀌지 않는다)
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile

MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
MANIFEST = os.path.join(MODELS_DIR, "manifest.json")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
VERSION_RE = re.compile(r"^[0-9]{1,9}$")


def fail(message):
    print(f"오류: {message}", file=sys.stderr)
    sys.exit(1)


def check_name(name):
    # 경로로 쓰이므로 허용한 문자만 받는다. 경로 이동 문자열을 막는다.
    if not NAME_RE.match(name) or ".." in name:
        fail("모델 이름은 영문 소문자·숫자·점·하이픈·밑줄만 쓸 수 있습니다.")


def check_version(version):
    if not VERSION_RE.match(version):
        fail("버전은 숫자만 쓸 수 있습니다.")


def load_manifest():
    if not os.path.exists(MANIFEST):
        return {"updated": None, "models": []}
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def save_manifest(data):
    data["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    os.makedirs(MODELS_DIR, exist_ok=True)
    # 임시 파일에 쓰고 바꿔서 읽는 쪽이 쓰다 만 파일을 보지 않게 한다.
    fd, tmp = tempfile.mkstemp(dir=MODELS_DIR, prefix=".manifest-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, MANIFEST)


def find_model(data, name):
    for model in data["models"]:
        if model["name"] == name:
            return model
    return None


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def publish(args):
    check_name(args.name)
    check_version(args.version)
    import mlflow  # 게시할 때만 필요해서 늦게 불러온다.

    dest = os.path.join(MODELS_DIR, args.name, args.version)
    if os.path.exists(dest):
        # 버전 폴더는 한 번 만들면 바꾸지 않는다. 같은 버전을 다시 게시하지 않는다.
        fail(f"이미 게시된 버전입니다: {args.name} {args.version}")

    with tempfile.TemporaryDirectory() as tmp:
        local = mlflow.artifacts.download_artifacts(
            artifact_uri=f"models:/{args.name}/{args.version}", dst_path=tmp)
        files = []
        os.makedirs(dest)
        try:
            for root, _dirs, names in os.walk(local):
                for fname in sorted(names):
                    if fname.startswith("."):
                        continue
                    src = os.path.join(root, fname)
                    rel = os.path.relpath(src, local).replace(os.sep, "/")
                    target = os.path.join(dest, rel)
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    shutil.copy2(src, target)
                    os.chmod(target, 0o644)
                    files.append({"path": rel, "sha256": sha256_of(target), "size": os.path.getsize(target)})
        except Exception:
            shutil.rmtree(dest, ignore_errors=True)
            raise

    if not files:
        shutil.rmtree(dest, ignore_errors=True)
        fail("게시할 모델 파일이 없습니다.")

    data = load_manifest()
    model = find_model(data, args.name)
    if model is None:
        model = {"name": args.name, "current": None, "versions": []}
        data["models"].append(model)
    model["versions"].append({
        "version": args.version,
        "publishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "files": sorted(files, key=lambda x: x["path"]),
        "mlflow": {"modelName": args.name, "modelVersion": args.version},
    })
    if not args.no_activate:
        model["current"] = args.version
    save_manifest(data)
    state = "현재 버전으로 설정" if not args.no_activate else "게시만 함(현재 버전은 그대로)"
    print(f"게시 완료: {args.name} {args.version} ({len(files)}개 파일, {state})")


def rollback(args):
    check_name(args.name)
    data = load_manifest()
    model = find_model(data, args.name)
    if model is None or not model["versions"]:
        fail(f"게시된 모델이 없습니다: {args.name}")
    published = [v["version"] for v in model["versions"]]
    if args.version:
        check_version(args.version)
        if args.version not in published:
            fail(f"게시되지 않은 버전입니다: {args.version} (게시된 버전: {', '.join(published)})")
        target = args.version
    else:
        # 인자가 없으면 현재 버전 바로 앞에 게시된 버전으로 되돌린다.
        if model["current"] not in published or published.index(model["current"]) == 0:
            fail("되돌릴 이전 버전이 없습니다. 게시된 버전을 직접 지정하세요.")
        target = published[published.index(model["current"]) - 1]
    previous = model["current"]
    model["current"] = target
    save_manifest(data)
    print(f"롤백 완료: {args.name} {previous} -> {target}")


def list_models(_args):
    data = load_manifest()
    if not data["models"]:
        print("게시된 모델이 없습니다.")
        return
    for model in data["models"]:
        versions = ", ".join(v["version"] for v in model["versions"])
        print(f"{model['name']}: 현재 {model['current']} / 게시된 버전 {versions}")


def main():
    parser = argparse.ArgumentParser(description="MLflow 모델을 /models로 게시한다.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("publish", help="MLflow 모델 버전을 게시한다")
    p.add_argument("name")
    p.add_argument("version")
    p.add_argument("--no-activate", action="store_true", help="게시만 하고 현재 버전은 바꾸지 않는다")
    p.set_defaults(func=publish)

    p = sub.add_parser("rollback", help="현재 버전을 이전 게시 버전으로 되돌린다")
    p.add_argument("name")
    p.add_argument("version", nargs="?")
    p.set_defaults(func=rollback)

    p = sub.add_parser("list", help="게시된 모델을 보여 준다")
    p.set_defaults(func=list_models)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
