# 음원 형식 테스트 파일

모든 파일은 FFmpeg `n8.1.3-24-g92611900bb`의 440 Hz 사인파 1초와 단색 화면으로 직접 생성했다. 외부 음원은 사용하지 않았다. AAC·ALAC MPEG-4, 표지 이미지가 포함된 AAC, Ogg Opus는 허용하고 Ogg Vorbis·WebM Opus·실제 비디오 혼합·비디오 전용 파일은 거절한다.

이 디렉터리에서 재생성하는 명령은 다음과 같다. 생성 과정의 `cover.jpg`는 fixture가 아니다.

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -c:a aac sample-aac.m4a
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -c:a alac sample-alac.m4a
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -c:a libopus sample-opus.opus
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -c:a libvorbis sample-vorbis.ogg
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -c:a libopus sample-webm.webm
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -f lavfi -i 'color=c=black:s=32x32:r=1:d=1' -map 0:a -map 1:v -c:a aac -c:v mpeg4 -shortest sample-video.mp4
ffmpeg -f lavfi -i 'color=c=black:s=32x32:r=1:d=1' -c:v mpeg4 sample-video-only.mp4
ffmpeg -f lavfi -i 'color=c=blue:s=32x32' -frames:v 1 cover.jpg
ffmpeg -i sample-aac.m4a -i cover.jpg -map 0:a -map 1:v -c copy -disposition:v:0 attached_pic sample-cover.m4a
```
