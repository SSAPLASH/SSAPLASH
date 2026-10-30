"""tests/worker 공용. worker_helpers를 import할 수 있게 이 폴더를 sys.path에 넣음."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
