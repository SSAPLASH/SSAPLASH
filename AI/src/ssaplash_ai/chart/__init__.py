"""서비스 추론 모듈. 원곡 → 드럼 트랙·반주 → 채보 JSON, MusicXML 드럼 악보 → 채보 JSON.

모델은 벤치마크 어댑터(`bench.separators`·`bench.transcribers`)를 그대로 씀.
의존 방향: cli → separation·transcription·music_check·sheet → bench. bench는 chart를 모름.
"""
