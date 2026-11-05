"""곡 추천 PoC의 방법들(설계 문서 부록 B.6). 모두 같은 인터페이스(`Recommender`)를 따른다."""

from ssaplash_ai.recommend.models.base import Recommender, ScoreRecommender
from ssaplash_ai.recommend.models.cooccur import CoPlay
from ssaplash_ai.recommend.models.itemknn import SimilarToRecent
from ssaplash_ai.recommend.models.lightgcn import LightGCN
from ssaplash_ai.recommend.models.node2vec import Node2Vec
from ssaplash_ai.recommend.models.popularity import Popularity
from ssaplash_ai.recommend.models.rerank import Reranked
from ssaplash_ai.recommend.models.rules import R1Rules

__all__ = [
    "CoPlay",
    "LightGCN",
    "Node2Vec",
    "Popularity",
    "R1Rules",
    "Recommender",
    "Reranked",
    "ScoreRecommender",
    "SimilarToRecent",
]
