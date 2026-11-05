"""LLM 총평 후보 모델 비교표와 MLflow 기록 (설계 v0.6, U19).

실제 코드는 `ssaplash_ai.coach_eval.narrative_compare`에 있다. 같은 사실을 후보 모델마다 여러 번 쓰게 해서
가드레일 통과율, 첫 시도 통과율, 걸린 시간을 표로 만들고 문장 전체를 남긴다. 한국어 자연스러움은 사람이 읽어서 정한다.

모델 서버(Ollama 또는 OpenAI 호환)가 같은 서버에서 떠 있어야 한다. 외부 서비스·유료 API는 부르지 않는다.

  uv run python scripts/eval_narrative.py --url http://127.0.0.1:11435 --api ollama \\
      --model exaone3.5:2.4b --model qwen3:4b --model gemma3:4b --repeats 5 \\
      --out data/results/narrative-compare.md --mlflow
"""

from __future__ import annotations

import sys

from ssaplash_ai.coach_eval.narrative_compare import main

if __name__ == "__main__":
    sys.exit(main())
