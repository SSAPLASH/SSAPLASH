"""패키지가 설치되고 import 되는지 확인하는 최소 테스트."""

import ssaplash_ai


def test_패키지_버전이_있다():
    assert ssaplash_ai.__version__
