"""곡 추천 PoC 학습·평가 실행. 자세한 사용법은 `ssaplash_ai/recommend/run.py`와 `docs/recommend-poc.md`.

AI/ 에서: `uv run python scripts/run_recommend_poc.py --synthetic --stage P0 --out runs/recommend/p0`
"""

from ssaplash_ai.recommend.run import main

if __name__ == "__main__":
    raise SystemExit(main())
