#!/bin/sh
# CI 일반 사용자로 서명된 Ubuntu 패키지 목록을 받아 작업 디렉터리에만 풀어 쓴다.
set -eu
cache="$PWD/.cache/midi-renderer"
mkdir -p "$cache"
work=$(mktemp -d "$cache/run.XXXXXX")
root="$work/root"
mkdir -p "$work/lists/partial" "$work/archives/partial" "$root"
apt_lists="Dir::State::lists=$work/lists"
apt_archives="Dir::Cache::archives=$work/archives"
# 이미지의 시스템 캐시 정리 hook은 일반 사용자가 /var/cache를 수정하려 하므로 읽지 않는다.
printf 'Dir::Etc::Parts "/dev/null";\n' > "$work/apt.conf"
APT_CONFIG="$work/apt.conf" LC_ALL=C apt-get -o "$apt_lists" -o "$apt_archives" update
APT_CONFIG="$work/apt.conf" LC_ALL=C apt-get -o "$apt_lists" -o "$apt_archives" -s --no-install-recommends \
  install fluidsynth=2.2.5-1 fluid-soundfont-gm=3.1-5.3 > "$work/plan.txt"
awk '/^Inst / { for (i=3; i<=NF; i++) if ($i ~ /^\(/) { sub(/^\(/,"",$i); print $2 "=" $i; break } }' \
  "$work/plan.txt" > "$work/packages.txt"
set --
while IFS= read -r package; do set -- "$@" "$package"; done < "$work/packages.txt"
[ "$#" -gt 0 ]
APT_CONFIG="$work/apt.conf" LC_ALL=C apt-cache -o "$apt_lists" show "$@" > "$work/metadata.txt"
awk -F ': ' '$1 == "Package" {package=$2; version=""; arch=""} $1 == "Version" {version=$2} $1 == "Architecture" {arch=$2} $1 == "SHA256" {print package "|" version "|" arch "|" $2}' \
  "$work/metadata.txt" > "$work/checksums.txt"
(cd "$work/archives" && APT_CONFIG="$work/apt.conf" LC_ALL=C apt-get -o "$apt_lists" -o "$apt_archives" download "$@")
count=0
for file in "$work"/archives/*.deb; do
  package=$(dpkg-deb -f "$file" Package)
  version=$(dpkg-deb -f "$file" Version)
  arch=$(dpkg-deb -f "$file" Architecture)
  expected=$(awk -F '|' -v package="$package" -v version="$version" -v arch="$arch" '$1 == package && $2 == version && $3 == arch {print $4; exit}' "$work/checksums.txt")
  [ -n "$expected" ]
  printf '%s  %s\n' "$expected" "$file" | sha256sum -c - >/dev/null
  dpkg-deb -x "$file" "$root"
  count=$((count+1))
done
[ "$count" -eq "$#" ]
cat > "$root/fluidsynth-wrapper" <<'EOF'
#!/bin/sh
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LD_LIBRARY_PATH="$root/usr/lib/x86_64-linux-gnu/pulseaudio:$root/usr/lib/x86_64-linux-gnu:$root/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
exec "$root/usr/bin/fluidsynth" "$@"
EOF
chmod +x "$root/fluidsynth-wrapper"
MIDI_TEST_FLUIDSYNTH="$root/fluidsynth-wrapper"
MIDI_TEST_SOUNDFONT="$root/usr/share/sounds/sf2/FluidR3_GM.sf2"
export MIDI_TEST_FLUIDSYNTH MIDI_TEST_SOUNDFONT
printf '%s  %s\n' 74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0 "$MIDI_TEST_SOUNDFONT" | sha256sum -c -
"$MIDI_TEST_FLUIDSYNTH" --version
