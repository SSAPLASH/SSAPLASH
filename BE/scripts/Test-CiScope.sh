#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/scripts"
cp "$script_dir/CiScope.sh" "$tmp/scripts/CiScope.sh"
cat > "$tmp/gradlew" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$CI_CAPTURE"
EOF
chmod +x "$tmp/gradlew"
cd "$tmp"
export CI_CAPTURE="$tmp/args"

check() {
    source=$1; branch=$2; target=$3; expected=$4
    export CI_PIPELINE_SOURCE="$source" CI_COMMIT_BRANCH="$branch" CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target"
    actual=$(sh scripts/CiScope.sh mode)
    [ "$actual" = "$expected" ] || { echo "expected $expected, got $actual" >&2; exit 1; }
    sh scripts/CiScope.sh test >/dev/null
    grep -Fxq test "$CI_CAPTURE"
    if [ "$expected" = FULL ]; then
        ! grep -Fxq -- --tests "$CI_CAPTURE"
        ! grep -Fxq bootJar "$CI_CAPTURE"
    else
        [ "$(grep -Fxc -- --tests "$CI_CAPTURE")" -eq 13 ]
        grep -Fxq bootJar "$CI_CAPTURE"
        grep -Fxq 'com.ssafy.airdrum.auth.AccessTokenServiceTest' "$CI_CAPTURE"
        grep -Fxq 'com.ssafy.airdrum.play.PlayPayloadTest' "$CI_CAPTURE"
    fi
    printf 'PASS %s %s %s: %s\n' "$source" "$branch" "$target" "$actual"
}
check merge_request_event feature develop-BE FAST
check merge_request_event feature main FULL
check merge_request_event feature develop-FE FAST
check push develop-BE '' FAST
check push main '' FULL
check web main '' FULL
printf '%s\n' 'PASS FAST 13개 필터 및 FULL 무필터'
