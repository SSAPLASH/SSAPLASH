"""오디오 LLM 하나로 마디마다 하이햇·라이드 판정 (11/09, 설계 CHART-003-audio-llm-cymbal, S15P31A307-325).

cases.jsonl의 마디 wav를 모델에 들려주고 H(하이햇)·R(라이드)·N(둘 다 아님) 중 한 글자를 묻는다.
첫 답 토큰 위치의 H·R·N 토큰 확률을 합 1로 맞춰 answers_<백엔드>_<오디오>.jsonl에 한 줄씩 덧붙임.
이미 답한 마디는 건너뜀(끊겨도 다시 실행하면 이어 감). 정답 파일은 읽지 않음.
백엔드마다 모델 카드·공식 저장소 예제의 불러오기·입력 방식을 따름. 생성은 탐욕(do_sample=False).

  python scripts/cymrole_audio_llm.py --backend qwen3omni --cases <폴더> --audio mix drums --subset <폴더>/pilot.txt --out <폴더>/answers
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

QUESTION = (
    "This audio clip is one bar from a rock or pop song. Listen to the drums. "
    "Which cymbal is the drummer playing repeatedly to keep time in this bar? "
    "Answer with exactly one letter: H if it is the hi-hat, R if it is the ride cymbal, N if neither is heard."
)
LETTERS = ("H", "R", "N")
MAX_NEW = 8
TOPK = 200  # 첫 토큰 확률 상위 몇 개에서 H·R·N 토큰을 찾을지


def letter_of(tok: str) -> str | None:
    s = tok.strip().strip("\"'*.:()[]`").upper()
    return s if s in LETTERS else None


def letter_probs(logits, decode_one) -> tuple[dict[str, float], float]:
    """첫 답 위치 로짓(1차원)에서 H·R·N 토큰 확률. 공백이 붙은 토큰도 같은 글자로 합침. (합 1 확률, 원래 질량)."""
    import torch

    p = torch.softmax(logits.float().reshape(-1), dim=-1)
    top = torch.topk(p, min(TOPK, p.numel()))
    acc = dict.fromkeys(LETTERS, 0.0)
    for v, i in zip(top.values.tolist(), top.indices.tolist(), strict=True):
        lab = letter_of(decode_one(int(i)))
        if lab is not None:
            acc[lab] += float(v)
    mass = sum(acc.values())
    return ({k: v / mass for k, v in acc.items()} if mass > 0 else acc), mass


def letter_from_text(text: str) -> str | None:
    """확률을 못 얻었을 때 답 글에서 판정. 첫 글자, 아니면 낱말."""
    t = text.strip()
    if t and letter_of(t.split()[0]) is not None:
        return letter_of(t.split()[0])
    low = t.lower()
    if re.search(r"\bride\b", low):
        return "R"
    if re.search(r"hi-?\s?hat", low):
        return "H"
    if re.search(r"\b(neither|none)\b", low):
        return "N"
    return None


def first_text_step(steps, decode_one):
    """직접 만든 생성 루프에서 기록한 (로짓, 고른 토큰) 중 글자가 처음 나온 단계의 로짓."""
    for logits, tok in steps:
        if decode_one(int(tok)).strip():
            return logits
    return None


# ---------------------------------------------------------------- 백엔드
class Backend:
    """load()로 모델을 올리고 ask(wav 경로)가 (첫 답 위치 로짓 또는 None, 답 글, 토큰 하나 디코드 함수)를 돌려줌."""

    repo_id = ""

    def __init__(self, args):
        self.args = args

    def snapshot(self, repo_id: str | None = None) -> str:
        from huggingface_hub import snapshot_download

        return snapshot_download(repo_id or self.repo_id)

    def load(self) -> None:
        raise NotImplementedError

    def ask(self, wav: str):
        raise NotImplementedError


def _gen_first_logits(out):
    """generate(return_dict_in_generate) 결과의 첫 생성 위치 로짓. output_logits가 있으면 처리 전 로짓."""
    seq = getattr(out, "logits", None) or getattr(out, "scores", None)
    return seq[0][0] if seq else None


class Qwen3Omni(Backend):
    repo_id = "Qwen/Qwen3-Omni-30B-A3B-Instruct"

    def load(self):
        import torch
        from transformers import Qwen3OmniMoeForConditionalGeneration, Qwen3OmniMoeProcessor

        self.torch = torch
        self.model = Qwen3OmniMoeForConditionalGeneration.from_pretrained(
            self.repo_id, dtype="auto", device_map="auto", attn_implementation=self.args.attn
        )
        self.model.disable_talker()  # 음성 출력 끔
        self.warned = False
        self.warned_shape = False
        self.proc = Qwen3OmniMoeProcessor.from_pretrained(self.repo_id)

    def ask(self, wav):
        from qwen_omni_utils import process_mm_info

        conv = [
            {
                "role": "user",
                "content": [{"type": "audio", "audio": wav}, {"type": "text", "text": QUESTION}],
            }
        ]
        text = self.proc.apply_chat_template(conv, add_generation_prompt=True, tokenize=False)
        audios, images, videos = process_mm_info(conv, use_audio_in_video=False)
        inputs = self.proc(text=text, audio=audios, images=images, videos=videos, return_tensors="pt",
                           padding=True, use_audio_in_video=False)  # fmt: skip
        inputs = inputs.to(self.model.device).to(self.model.dtype)
        with self.torch.no_grad():
            # 모델 카드 배치 예제와 같은 인자 + 첫 토큰 점수. thinker_ 접두 인자가 안 먹히면
            # 카드 인자만으로 다시 생성하고 점수는 아래 thinker forward로 구함
            card = dict(
                return_audio=False, use_audio_in_video=False, thinker_return_dict_in_generate=True
            )
            # 11/10 서버: 카드 예제는 (글, 소리) 둘을 돌려준다고 보고 둘로 나눠 받지만, 서버 transformers는
            # 소리를 끄면 생성 결과 하나만 돌려줘서 나눠 받다가 결과의 항목 이름이 들어갔음. 둘 다 받게 함
            try:
                out = self.model.generate(
                    **inputs, **card, thinker_output_scores=True,
                    thinker_max_new_tokens=MAX_NEW, thinker_do_sample=False,
                )  # fmt: skip
            except (TypeError, ValueError) as e:
                if not self.warned:
                    print(f"[llm] qwen3omni 점수 인자 거절, 카드 인자로 다시: {e}", flush=True)
                    self.warned = True
                out = self.model.generate(**inputs, **card, thinker_max_new_tokens=MAX_NEW)
            text_ids = out[0] if isinstance(out, tuple) else out
            seqs = getattr(
                text_ids, "sequences", text_ids
            )  # 결과 묶음이면 sequences, 텐서면 그대로
            logits = _gen_first_logits(text_ids)
            if logits is None:  # 점수가 안 넘어오면 thinker 한 번 forward
                logits = self.model.thinker(**inputs).logits[0, -1]
        if not self.warned_shape:
            print(f"[llm] qwen3omni 생성 결과 {type(out).__name__}, 점수 {'있음' if _gen_first_logits(text_ids) is not None else '없음, forward로 구함'}", flush=True)  # fmt: skip
            self.warned_shape = True
        n = inputs["input_ids"].shape[1]
        ans = self.proc.batch_decode(seqs[:, n:], skip_special_tokens=True,
                                     clean_up_tokenization_spaces=False)[0]  # fmt: skip
        return logits, ans, lambda i: self.proc.tokenizer.decode([i])


class _HFGenerate(Backend):
    """processor 입력을 model.generate로 넘기는 모델 공통."""

    def generate(self, inputs, n_prompt, decode_batch, decode_one):
        with self.torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=MAX_NEW, do_sample=False, output_scores=True,
                                      output_logits=True, return_dict_in_generate=True)  # fmt: skip
        ans = decode_batch(out.sequences[:, n_prompt:])[0]
        return _gen_first_logits(out), ans, decode_one


class Voxtral(_HFGenerate):
    repo_id = "mistralai/Voxtral-Small-24B-2507"

    def load(self):
        import torch
        from transformers import AutoProcessor, VoxtralForConditionalGeneration

        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(self.repo_id)
        self.model = VoxtralForConditionalGeneration.from_pretrained(
            self.repo_id, torch_dtype=torch.bfloat16, device_map="cuda"
        )

    def ask(self, wav):
        conv = [
            {
                "role": "user",
                "content": [{"type": "audio", "path": wav}, {"type": "text", "text": QUESTION}],
            }
        ]
        inputs = self.proc.apply_chat_template(conv).to("cuda", dtype=self.torch.bfloat16)
        return self.generate(
            inputs, inputs.input_ids.shape[1],
            lambda s: self.proc.batch_decode(s, skip_special_tokens=True),
            lambda i: self.proc.tokenizer.decode([i]),
        )  # fmt: skip


class AFNext(_HFGenerate):
    repo_id = "nvidia/audio-flamingo-next-hf"

    def load(self):
        import torch
        import transformers
        from transformers import AutoModel, AutoProcessor

        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(self.repo_id)
        # 11/09 서버: AutoModel이 언어 모델 머리 없는 MusicFlamingoModel을 올려 generate가 없었음.
        # 모델 카드가 말하는 생성용 클래스를 먼저 찾고, 없으면 같은 계열 생성용 클래스
        names = ("AudioFlamingoNextForConditionalGeneration", "MusicFlamingoForConditionalGeneration",
                 "AudioFlamingo3ForConditionalGeneration")  # fmt: skip
        cls = next((getattr(transformers, n) for n in names if hasattr(transformers, n)), AutoModel)
        print(f"[llm] afnext 모델 클래스 {cls.__name__}", flush=True)
        self.model = cls.from_pretrained(
            self.repo_id, torch_dtype=torch.bfloat16, device_map="auto"
        ).eval()

    def ask(self, wav):
        conv = [
            [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": QUESTION}, {"type": "audio", "path": wav}],
                }
            ]
        ]
        batch = self.proc.apply_chat_template(conv, tokenize=True, add_generation_prompt=True,
                                              return_dict=True).to(self.model.device)  # fmt: skip
        if "input_features" in batch:
            batch["input_features"] = batch["input_features"].to(self.model.dtype)
        return self.generate(
            batch, batch["input_ids"].shape[1],
            lambda s: self.proc.batch_decode(s, skip_special_tokens=True, clean_up_tokenization_spaces=False),
            lambda i: self.proc.tokenizer.decode([i]),
        )  # fmt: skip


class Nemotron(_HFGenerate):
    repo_id = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16"

    def load(self):
        import torch
        from transformers import AutoModel, AutoProcessor

        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(self.repo_id, trust_remote_code=True)
        # 11/09 서버: 설정 기본값이 flash_attention_2라 flash-attn이 없는 환경에서 불러오기 실패. sdpa로 바꿈
        self.model = AutoModel.from_pretrained(self.repo_id, trust_remote_code=True, torch_dtype=torch.bfloat16,
                                               device_map="cuda", attn_implementation="sdpa").eval()  # fmt: skip

    def ask(self, wav):
        import soundfile as sf

        audio, sr = sf.read(wav, dtype="float32")
        conv = [
            {"role": "user", "content": [{"type": "audio"}, {"type": "text", "text": QUESTION}]}
        ]
        prompt = self.proc.apply_chat_template(conv, tokenize=False, add_generation_prompt=True,
                                               enable_thinking=False)  # fmt: skip
        inputs = self.proc(
            text=[prompt], audio=[audio], audio_kwargs={"sampling_rate": sr}, return_tensors="pt"
        )
        inputs = {k: (v.to("cuda") if hasattr(v, "to") else v) for k, v in inputs.items()}
        return self.generate(
            inputs, inputs["input_ids"].shape[1],
            lambda s: self.proc.tokenizer.batch_decode(s, skip_special_tokens=True),
            lambda i: self.proc.tokenizer.decode([i]),
        )  # fmt: skip


class MossMusic(_HFGenerate):
    """공식 저장소(OpenMOSS/MOSS-Music) infer.py 방식. --repo에 저장소 경로."""

    repo_id = "OpenMOSS-Team/MOSS-Music-8B-Instruct"

    def load(self):
        import torch

        sys.path.insert(0, str(self.args.repo))
        from src.modeling_moss_music import MossMusicModel
        from src.processing_moss_music import MossMusicProcessor

        self.torch = torch
        path = self.snapshot()
        self.model = MossMusicModel.from_pretrained(path, trust_remote_code=True, torch_dtype="auto",
                                                    device_map="cuda:0").eval()  # fmt: skip
        self.proc = MossMusicProcessor.from_pretrained(
            path, trust_remote_code=True, enable_time_marker=True
        )

    def ask(self, wav):
        # 저장소 load_audio(torchaudio.load)와 같은 결과(모노 1차원 numpy, mel_sr)를 soundfile로 만듦.
        # torchaudio 2.9의 load는 ffmpeg 공유 라이브러리가 필요한데 서버에는 정적 ffmpeg만 있음
        import soundfile as sf
        import torchaudio

        raw, sr = sf.read(wav, dtype="float32")
        raw = raw.mean(axis=1) if raw.ndim == 2 else raw
        if sr != self.proc.config.mel_sr:
            t = torchaudio.functional.resample(
                self.torch.from_numpy(raw), sr, self.proc.config.mel_sr
            )
            raw = t.numpy()
        inputs = self.proc(text=QUESTION, audios=[raw], return_tensors="pt").to(self.model.device)
        if inputs.get("audio_data") is not None:
            inputs["audio_data"] = inputs["audio_data"].to(self.model.dtype)
        inputs["audio_input_mask"] = inputs["input_ids"] == self.proc.audio_token_id
        return self.generate(
            inputs, inputs["input_ids"].shape[1],
            lambda s: [self.proc.decode(s[0], skip_special_tokens=True)],
            lambda i: self.proc.decode([i]),
        )  # fmt: skip


class StepAudio2Mini(Backend):
    """공식 저장소(stepfun-ai/Step-Audio2) stepaudio2.py의 StepAudio2.__call__과 같은 입력, 점수만 더 받음."""

    repo_id = "stepfun-ai/Step-Audio-2-mini"

    def load(self):
        import torch

        sys.path.insert(0, str(self.args.repo))
        from stepaudio2 import StepAudio2

        self.torch = torch
        self.m = StepAudio2(self.snapshot())

    def ask(self, wav):
        from transformers import GenerationConfig

        m, torch = self.m, self.torch
        messages = [
            {"role": "system", "content": "You are an expert in audio analysis, please analyze the audio content and answer the questions accurately."},
            {"role": "human", "content": [{"type": "audio", "audio": wav}, {"type": "text", "text": QUESTION}]},
            {"role": "assistant", "content": None},
        ]  # fmt: skip
        msgs, mels = m.apply_chat_template(messages)
        ids = []
        for msg in msgs:
            if isinstance(msg, str):
                ids.append(
                    m.llm_tokenizer(text=msg, return_tensors="pt", padding=True)["input_ids"]
                )
            else:
                ids.append(torch.tensor([msg], dtype=torch.int32))
        prompt = torch.cat(ids, dim=-1).cuda()
        from utils import padding_mels

        mels_t, mel_lens = padding_mels(mels)
        cfg = GenerationConfig(max_new_tokens=MAX_NEW, pad_token_id=m.llm_tokenizer.pad_token_id,
                               eos_token_id=m.eos_token_id, do_sample=False, output_scores=True,
                               output_logits=True, return_dict_in_generate=True)  # fmt: skip
        with torch.no_grad():
            out = m.llm.generate(input_ids=prompt, wavs=mels_t.cuda(), wav_lens=mel_lens.cuda(),
                                 attention_mask=torch.ones_like(prompt), generation_config=cfg,
                                 tokenizer=m.llm_tokenizer)  # fmt: skip
        toks = [
            i for i in out.sequences[0, prompt.shape[-1] :].tolist() if i < 151688
        ]  # 151688부터 음성 토큰
        return (
            _gen_first_logits(out),
            m.llm_tokenizer.decode(toks),
            lambda i: m.llm_tokenizer.decode([i]),
        )


class KimiAudio7B(Backend):
    """공식 저장소(MoonshotAI/Kimi-Audio) KimiAudio.generate(output_type='text'). 글 로짓은 샘플러를 감싸 기록."""

    repo_id = "moonshotai/Kimi-Audio-7B-Instruct"

    def load(self):
        sys.path.insert(0, str(self.args.repo))
        import kimia_infer.utils.sampler as ks
        from kimia_infer.api.kimia import KimiAudio

        self.steps: list = []
        orig = ks.KimiASampler.sample_text_logits
        rec = self.steps

        def sample_text_logits(sampler, logits, recent_tokens=None):
            tok = orig(sampler, logits, recent_tokens=recent_tokens)
            lg = logits[:, -1] if logits.dim() == 3 else logits
            rec.append((lg[0].float().cpu(), int(tok.reshape(-1)[0])))
            return tok

        ks.KimiASampler.sample_text_logits = sample_text_logits
        self.m = KimiAudio(model_path=self.snapshot(), load_detokenizer=False)
        self.offset = self.m.kimia_token_offset
        self.special = {self.m.extra_tokens.kimia_text_eos, self.m.extra_tokens.kimia_text_blank}

    def ask(self, wav):
        self.steps.clear()
        msgs = [{"role": "user", "message_type": "text", "content": QUESTION},
                {"role": "user", "message_type": "audio", "content": wav}]  # fmt: skip
        _, text = self.m.generate(msgs, output_type="text", text_temperature=0.0, text_top_k=5,
                                  max_new_tokens=32)  # fmt: skip
        tok = self.m.prompt_manager.text_tokenizer

        def decode_one(i):
            return "" if i >= self.offset or i in self.special else tok.decode([i])

        return first_text_step(self.steps, decode_one), text, decode_one


class MiMoAudio7B(Backend):
    """공식 저장소(XiaomiMiMo/MiMo-Audio) audio_understanding_sft. 글 샘플러를 탐욕·기록용으로 바꿈."""

    repo_id = "XiaomiMiMo/MiMo-Audio-7B-Instruct"

    def load(self):
        sys.path.insert(0, str(self.args.repo))
        from src.mimo_audio.mimo_audio import MimoAudio
        from src.mimo_audio.modeling_mimo_audio import MiMoSampler

        self.steps: list = []
        rec = self.steps

        class Recording(MiMoSampler):
            def sample(self, scores, removed_tokens=None):
                raw = scores[0].float().cpu().clone()
                tok = super().sample(scores, removed_tokens=removed_tokens)
                rec.append((raw, int(tok.reshape(-1)[0])))
                return tok

        self.m = MimoAudio(self.snapshot(), self.snapshot("XiaomiMiMo/MiMo-Audio-Tokenizer"))
        self.m.task_sampler_configs["audio_understanding"]["global"] = Recording(do_sample=False, temperature=1.0,
                                                                                  top_p=1.0)  # fmt: skip

    def ask(self, wav):
        self.steps.clear()
        text = self.m.audio_understanding_sft(wav, QUESTION, thinking=False)

        def decode_one(i):
            return self.m.tokenizer.decode([i], skip_special_tokens=True)

        return first_text_step(self.steps, decode_one), str(text), decode_one


class GeminiGMS(Backend):
    """GMS 프록시로 Gemini 3.8 Flash interactions API 호출 (11/10 사용자 지시, 로컬 실행).

    interactions API는 토큰 확률을 주지 않아서 글자와 0~100 확신도를 같이 답하게 함.
    고른 글자에 확신도, 나머지 두 글자에 남은 몫을 반씩 줌. 이 모델은 생각 끄기(minimal)를 받지 않아 low로 둠.
    키는 환경 변수 GMS_KEY, 없으면 AI/.env의 GMS_KEY 줄에서 읽고 화면에 찍지 않음.
    """

    URL = "https://gms.ssafy.io/gmsapi/generativelanguage.googleapis.com/v1beta/interactions"
    MODEL = "gemini-3.8-flash"
    PROMPT = (
        "This audio clip is one bar from a rock or pop song. Listen to the drums. Which cymbal is the drummer "
        "playing repeatedly to keep time in this bar? Reply with one letter (H = hi-hat, R = ride cymbal, "
        "N = neither heard), a space, and your confidence from 0 to 100. Example: R 70"
    )

    def load(self):
        import os

        key = os.environ.get("GMS_KEY")
        if not key:
            env = Path(__file__).resolve().parents[1] / ".env"
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("GMS_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
        if not key:
            raise SystemExit("GMS_KEY가 없음 (환경 변수 또는 AI/.env)")
        self.key = key
        self.usage = {"input": 0, "thought": 0, "output": 0, "calls": 0}

    def call(self, wav: str) -> dict:
        import base64
        import urllib.error
        import urllib.request

        body = {
            "model": self.MODEL,
            "input": [
                {"type": "text", "text": self.PROMPT},
                {
                    "type": "audio",
                    "data": base64.b64encode(Path(wav).read_bytes()).decode(),
                    "mime_type": "audio/wav",
                },
            ],
            "generation_config": {"thinking_level": "low", "max_output_tokens": 1024},
        }
        data = json.dumps(body).encode()
        for attempt in range(5):  # 429·5xx는 기다렸다 다시
            req = urllib.request.Request(
                self.URL,
                data=data,
                headers={"Content-Type": "application/json", "x-goog-api-key": self.key},
            )
            try:
                return json.loads(urllib.request.urlopen(req, timeout=120).read())
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(5 * 2**attempt)
                    continue
                raise SystemExit(f"GMS HTTP {e.code}: {e.read().decode()[:300]}") from e
            except urllib.error.URLError:
                if attempt < 4:
                    time.sleep(5 * 2**attempt)
                    continue
                raise
        raise SystemExit("GMS 호출 실패")

    def ask(self, wav):
        r = self.call(wav)
        u = r.get("usage") or {}
        self.usage["input"] += int(u.get("total_input_tokens", 0))
        self.usage["thought"] += int(u.get("total_thought_tokens", 0))
        self.usage["output"] += int(u.get("total_output_tokens", 0))
        self.usage["calls"] += 1
        # 마디마다 답 파일에 남겨 끊겨도 사용량 합계를 낼 수 있게 함
        self.last_usage = {
            "input": int(u.get("total_input_tokens", 0)),
            "thought": int(u.get("total_thought_tokens", 0)),
            "output": int(u.get("total_output_tokens", 0)),
            "status": r.get("status"),
        }
        text = "".join(
            c.get("text", "")
            for st in (r.get("steps") or [])
            if st.get("type") == "model_output"
            for c in st.get("content", [])
            if c.get("type") == "text"
        )
        return stated_probs(text), text, None


def stated_probs(text: str) -> dict[str, float] | None:
    """'R 70' 꼴 답을 확률로. 고른 글자에 확신도, 나머지 둘에 남은 몫을 반씩. 형식이 안 맞으면 None."""
    m = re.match(r"\s*([HRN])\b\W*(\d{1,3})", text.strip().upper())
    if not m:
        return None
    c = min(100, int(m.group(2))) / 100
    return {k: (c if k == m.group(1) else (1 - c) / 2) for k in LETTERS}


BACKENDS = {
    "qwen3omni": Qwen3Omni,
    "nemotron": Nemotron,
    "voxtral": Voxtral,
    "afnext": AFNext,
    "mossmusic": MossMusic,
    "mimoaudio": MiMoAudio7B,
    "stepaudio2": StepAudio2Mini,
    "kimiaudio": KimiAudio7B,
    "gemini": GeminiGMS,
}


class Fake(Backend):
    """테스트용 가짜 백엔드. 파일 이름 길이로 정해진 로짓을 냄."""

    def load(self):
        pass

    def ask(self, wav):
        import torch

        k = len(Path(wav).name) % 3
        logits = torch.full((5,), -5.0)
        logits[k] = 3.0
        names = ["H", " R", "N", "x", "y"]
        return logits, names[k].strip(), lambda i: names[i]


BACKENDS["fake"] = Fake


# ---------------------------------------------------------------- 실행
def answer_row(cid: str, logits, text: str, decode_one, sec: float) -> dict:
    src = "logits"
    if isinstance(logits, dict):  # 모델이 말로 밝힌 확신도로 만든 확률 (gemini)
        p, mass, src = logits, 1.0, "stated"
    elif logits is not None:
        p, mass = letter_probs(logits, decode_one)
    else:
        p, mass = dict.fromkeys(LETTERS, 0.0), 0.0
    if mass <= 0:
        lab = letter_from_text(text)
        p = {k: float(k == lab) for k in LETTERS} if lab else dict.fromkeys(LETTERS, 1 / 3)
        src = "text" if lab else "none"
    choice = max(LETTERS, key=lambda k: p[k])
    return {"case_id": cid, "p": p, "choice": choice, "p_mass": round(mass, 4), "p_source": src,
            "raw": text[:200], "sec": round(sec, 3)}  # fmt: skip


def run(args) -> int:
    cases = [
        json.loads(x)
        for x in (args.cases / "cases.jsonl").read_text(encoding="utf-8").splitlines()
        if x.strip()
    ]
    if args.subset is not None:
        keep = {
            x.strip() for x in args.subset.read_text(encoding="utf-8").splitlines() if x.strip()
        }
        cases = [c for c in cases if c["case_id"] in keep]
    if args.limit:
        cases = cases[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)
    be = None
    for audio in args.audio:  # 한 번 불러온 모델로 오디오 종류를 차례로
        be = run_audio(args, cases, audio, be)
    return 0


def run_audio(args, cases: list[dict], audio: str, be):
    name = f"{args.backend}_{audio}"
    out = args.out / f"answers_{name}.jsonl"
    done = set()
    if out.is_file():
        done = {
            json.loads(x)["case_id"]
            for x in out.read_text(encoding="utf-8").splitlines()
            if x.strip()
        }
    todo = [c for c in cases if c["case_id"] not in done]
    print(f"[llm] {name}: 전체 {len(cases)}, 이미 답함 {len(done)}, 남음 {len(todo)}", flush=True)
    if not todo:
        return be
    load_sec = 0.0
    if be is None:
        be = BACKENDS[args.backend](args)
        t0 = time.time()
        be.load()
        load_sec = time.time() - t0
        print(f"[llm] {name}: 불러오기 {load_sec:.0f}초", flush=True)
    times = []
    with out.open("a", encoding="utf-8") as fh:
        for k, c in enumerate(todo):
            wav = str((args.cases / c[f"audio_{audio}"]).resolve())
            t = time.time()
            logits, text, decode_one = be.ask(wav)
            sec = time.time() - t
            times.append(sec)
            row = answer_row(c["case_id"], logits, text, decode_one, sec)
            if getattr(be, "last_usage", None) is not None:  # API 백엔드의 이 마디 토큰 수
                row["usage"] = be.last_usage
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
            if k + 1 == 10 or (k + 1) % 50 == 0:
                print(
                    f"[llm] {name}: {k + 1}/{len(todo)}, 마디당 {sum(times) / len(times):.2f}초",
                    flush=True,
                )
    meta = {"name": name, "load_sec": round(load_sec, 1), "n": len(times),
            "sec_per_bar": round(sum(times) / max(1, len(times)), 3), "peak_gpu_gb": peak_gpu_gb(),
            "usage": getattr(be, "usage", None)}  # fmt: skip
    (args.out / f"meta_{name}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[llm] {name}: 끝 {meta}", flush=True)
    return be


def peak_gpu_gb() -> float | None:
    try:
        import torch

        return (
            round(torch.cuda.max_memory_allocated() / 1e9, 1) if torch.cuda.is_available() else None
        )
    except Exception:  # noqa: BLE001  # torch가 없는 환경
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--backend", choices=sorted(BACKENDS), required=True)
    ap.add_argument("--cases", type=Path, required=True, help="cases.jsonl·clips가 있는 폴더")
    ap.add_argument("--audio", nargs="+", choices=("mix", "drums"), required=True)
    ap.add_argument("--subset", type=Path, default=None, help="case_id 목록 파일. 없으면 전체")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--repo",
        type=Path,
        default=None,
        help="공식 저장소 경로 (mossmusic·stepaudio2·kimiaudio·mimoaudio)",
    )
    ap.add_argument("--attn", default="sdpa", help="Qwen3-Omni attention 구현")
    ap.add_argument("--limit", type=int, default=0)
    return run(ap.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
