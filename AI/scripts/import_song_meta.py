"""공용 곡 메타데이터 초안(CSV)을 PoC 입력 `song_meta.csv`로 변환한다. 자세한 규칙은 `ssaplash_ai/recommend/meta_import.py`.

AI/ 에서: `uv run python scripts/import_song_meta.py --draft 초안.csv --catalog catalog.csv --out data/recommend/x/song_meta.csv`
"""

from ssaplash_ai.recommend.meta_import import main

if __name__ == "__main__":
    raise SystemExit(main())
