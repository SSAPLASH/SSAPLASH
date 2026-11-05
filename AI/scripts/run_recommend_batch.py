"""곡 추천 R3 후보 배치 실행. 자세한 사용법은 `ssaplash_ai/recommend/batch.py`와 `docs/recommend-poc.md`.

AI/ 에서: `uv run python scripts/run_recommend_batch.py --synthetic --stage P0`
"""

from ssaplash_ai.recommend.batch import main

if __name__ == "__main__":
    raise SystemExit(main())
