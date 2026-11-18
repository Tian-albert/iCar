# -*- coding: utf-8 -*-
"""
iCar 车记本 60 秒演示视频自动组装流水线
=====================================
输入：video/scenes.json（7 分镜文案 + 素材路径 + 字幕样式）
输出：video/output/icar_demo.mp4（1080x1920 竖屏，含 TTS 配音 + 硬字幕）

流程（每个分镜）：
  1. edge-tts 合成配音 -> video/audio/sceneN.mp3
  2. 配音时长 = 视频片段时长（自动适配，图片/视频素材会缩放/循环/裁剪）
  3. 叠加标题与逐句字幕（按标点切句，按字数分配时间轴）
  4. 全部片段拼接 -> 结尾二维码定格 -> 导出成片

用法：
  python make_video.py                 # 全量重做（重新合成配音）
  python make_video.py --keep-audio    # 复用已合成的配音（改文案重剪时用）
  python make_video.py --dry-run       # 只检查文案/素材/配音时长，不渲染

依赖：pip install -r requirements.txt（ffmpeg 由 imageio-ffmpeg 随 moviepy 自动提供）
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import sys
import textwrap
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SCENES_JSON = BASE_DIR / "scenes.json"
AUDIO_DIR = BASE_DIR / "audio"
OUTPUT_DIR = BASE_DIR / "output"

# 画布与导出参数（微信视频号/抖音竖屏）
WIDTH, HEIGHT = 1080, 1920
FPS = 30
CROSSFADE = 0.35            # 分镜间重叠转场（秒），0 表示硬切
BG_COLOR = (17, 17, 17)     # 纯黑背景，凸显小程序截图
KEN_BURNS = False           # 静态图缓慢推近；开启渲染约慢 5-8 倍
TAIL_HOLD = 3.0             # 结尾二维码定格时长（不含口播）

# TTS：音色/语速。成片偏短就把 RATE 调小（如 +0%），偏长调大（如 +18%）
VOICE = "zh-CN-YunxiNeural"
RATE = "+8%"
VOLUME = "+0%"

# 字幕排版（1080x1920 实测安全区）
TITLE_FONT_SIZE = 64
SUB_FONT_SIZE = 54
TITLE_MARGIN = 200          # 标题距顶部
SUB_MARGIN = 260            # 字幕距底部
TITLE_WRAP = 13             # 标题每行最大字数
SUB_WRAP = 15               # 字幕每行最大字数

# 中文字体候选（依次探测，Windows 优先微软雅黑 Bold）
FONT_CANDIDATES = ["msyhbd.ttc", "msyh.ttc", "simhei.ttf", "arialbd.ttf", "arial.ttf"]
_FONT: str | None = None


# ---------------------------------------------------------------- 基础工具
def die(msg: str) -> None:
    print(f"[错误] {msg}", file=sys.stderr)
    sys.exit(1)


def check_deps() -> None:
    try:
        import edge_tts  # noqa: F401
        import imageio_ffmpeg  # noqa: F401
        import moviepy  # noqa: F401
        from PIL import ImageFont  # noqa: F401
    except ImportError as e:
        die(f"缺少依赖 {e.name}，请先执行: pip install -r requirements.txt")


def resolve_font() -> str:
    """返回第一个可用的系统字体文件名（PIL 按名搜索 C:\\Windows\\Fonts）。"""
    global _FONT
    if _FONT:
        return _FONT
    from PIL import ImageFont
    for name in FONT_CANDIDATES:
        try:
            ImageFont.truetype(name, 24)
            _FONT = name
            return name
        except OSError:
            continue
    die("找不到可用字体（微软雅黑/黑体/Arial），请检查系统字体目录")


def strip_markers(text: str) -> str:
    """去掉文案里的舞台指示（圆括号内容），只留口播正文。"""
    return re.sub(r"[（(][^）)]*[）)]", "", text).strip()


def wrap_cjk(text: str, width: int) -> str:
    """中文按字数折行（textwrap 不认 CJK，手动按字符切）。"""
    return "\n".join(textwrap.wrap(text, width=width,
                                   break_long_words=True,
                                   break_on_hyphens=False) or [text])


# ---------------------------------------------------------------- 分镜加载与校验
def load_scenes() -> list[dict]:
    if not SCENES_JSON.exists():
        die(f"找不到 {SCENES_JSON}，请把 7 分镜文案填入该文件")
    scenes = json.loads(SCENES_JSON.read_text(encoding="utf-8"))

    if not isinstance(scenes, list) or not scenes:
        die("scenes.json 应为非空数组，每个元素是一个分镜")

    problems = []
    for i, sc in enumerate(scenes, 1):
        if not sc.get("voiceover"):
            problems.append(f"分镜{i}: 缺少 voiceover（口播文案）")
        src = sc.get("source")
        if src:
            if not (BASE_DIR / src).exists():
                problems.append(f"分镜{i}: 素材不存在 {BASE_DIR / src}")
        elif sc.get("kind") in {"screen", "tail"}:
            problems.append(f"分镜{i}: kind={sc['kind']} 必须提供 source（素材路径）")
    if problems:
        die("scenes.json 校验失败:\n  " + "\n  ".join(problems))

    chars = sum(len(strip_markers(s["voiceover"])) for s in scenes)
    print(f"[OK] 读入 {len(scenes)} 个分镜，口播共 {chars} 字")
    return scenes


# ---------------------------------------------------------------- TTS 合成
async def synth_audio(scenes: list[dict], keep: bool) -> None:
    """逐分镜合成配音；keep=True 时跳过已存在的 mp3。"""
    import edge_tts

    AUDIO_DIR.mkdir(exist_ok=True)
    for i, sc in enumerate(scenes, 1):
        mp3 = AUDIO_DIR / f"scene{i}.mp3"
        text = strip_markers(sc["voiceover"])
        if keep and mp3.exists():
            print(f"[TTS] 分镜{i} 复用 {mp3.name}")
            continue
        print(f"[TTS] 分镜{i} 合成中: {text[:24]}…")
        await edge_tts.Communicate(
            text, VOICE, rate=RATE, volume=VOLUME
        ).save(str(mp3))
    print(f"[OK] 配音合成完成 -> {AUDIO_DIR}")


def audio_duration(i: int) -> float:
    """取第 i 个分镜配音时长（秒）。"""
    from moviepy import AudioFileClip

    mp3 = AUDIO_DIR / f"scene{i}.mp3"
    if not mp3.exists():
        die(f"配音缺失: {mp3}，请去掉 --keep-audio 重新合成")
    with AudioFileClip(str(mp3)) as a:
        return float(a.duration)


# ---------------------------------------------------------------- 字幕时间轴
def split_sentences(text: str) -> list[str]:
    """按中英标点切句；无标点则整段一句。"""
    parts = re.split(r"(?<=[。！？!?；;，,])", strip_markers(text))
    return [p.strip() for p in parts if p.strip()] or [strip_markers(text)]


def sentence_timings(text: str, total: float) -> list[tuple[float, float, str]]:
    """按字数为每句分配起止时间。返回 [(start, end, 句子), ...]"""
    sents = split_sentences(text)
    weights = [len(s) for s in sents]
    scale = total / sum(weights)
    out, cursor = [], 0.0
    for s, w in zip(sents, weights):
        out.append((cursor, cursor + w * scale, s))
        cursor += w * scale
    return out


# ---------------------------------------------------------------- 文字层（PIL 预渲染）
def text_layer(text: str, size: int, color: str, wrap: int,
               top: float | None = None, bottom: float | None = None):
    """把一段文字画成整幅 RGBA 透明层（只渲染一次，避免逐帧排版）。"""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(resolve_font(), size)
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    body = wrap_cjk(text, wrap)
    spacing = int(size * 0.32)
    bbox = draw.multiline_textbbox((0, 0), body, font=font, spacing=spacing,
                                   align="center", stroke_width=3)
    height = bbox[3] - bbox[1]
    y = top if top is not None else HEIGHT - (bottom or 0) - height
    draw.multiline_text((WIDTH / 2, y), body, font=font, fill=color,
                        anchor="ma", align="center", spacing=spacing,
                        stroke_width=3, stroke_fill="black")
    return layer


# ---------------------------------------------------------------- 视频片段构建
def to_canvas(clip, dur: float):
    """任意 clip 居中放到 1080x1920 纯色画布上（moviepy 2.x 无 on_color）。"""
    from moviepy import CompositeVideoClip

    return CompositeVideoClip(
        [clip.with_position("center")],
        size=(WIDTH, HEIGHT), bg_color=BG_COLOR,
    ).with_duration(dur)


def base_frame(sc: dict):
    """静态素材 -> 单张 1080x1920 RGBA 底图（等比例适配 + 纯色补边）。"""
    from PIL import Image

    canvas = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    src = sc.get("source")
    if not src:
        return canvas.convert("RGBA")

    img = Image.open(BASE_DIR / src).convert("RGBA")
    if sc.get("kind") == "tail":          # 二维码：固定占屏宽 62%
        w = int(WIDTH * 0.62)
        img = img.resize((w, int(img.height * w / img.width)), Image.LANCZOS)
    else:                                  # 手机截图：按短边撑满、长边留白
        scale = min(WIDTH / img.width, HEIGHT / img.height)
        img = img.resize((int(img.width * scale), int(img.height * scale)),
                         Image.LANCZOS)
    canvas.paste(img, ((WIDTH - img.width) // 2, (HEIGHT - img.height) // 2), img)
    return canvas.convert("RGBA")


def scene_segments(text: str, audio_dur: float, pad: float, dur: float):
    """把分镜切成 (起, 止, 字幕或 None) 的连续片段。"""
    segs = [(0.0, pad, None)] if pad > 0 else []
    for st, en, sent in sentence_timings(text, audio_dur):
        segs.append((st + pad, en + pad, sent))
    tail_start = pad + audio_dur
    if dur - tail_start > 0.01:
        segs.append((tail_start, dur, None))
    return [(st, max(en, st + 0.2), s) for st, en, s in segs]


def build_scene(i: int, sc: dict, audio_dur: float):
    """组装单个分镜：素材 + 标题 + 逐句字幕 + 配音。"""
    import numpy as np
    from moviepy import (AudioFileClip, CompositeVideoClip, ImageClip,
                         VideoFileClip, concatenate_videoclips, vfx)
    from PIL import Image

    text = strip_markers(sc["voiceover"])
    pad = float(sc.get("pad", 0.35))      # 口播前后留白
    dur = audio_dur + pad * 2
    if sc.get("kind") == "tail":
        dur += TAIL_HOLD                  # 讲完后二维码继续定格

    src = BASE_DIR / sc["source"] if sc.get("source") else None
    is_video = bool(src) and src.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}
    segs = scene_segments(text, audio_dur, pad, dur)
    title_layer = (text_layer(sc["title"], TITLE_FONT_SIZE, "white", TITLE_WRAP,
                              top=TITLE_MARGIN)
                   if sc.get("title") else None)

    if is_video:                           # 录屏：视频底 + 预渲染文字层
        base = VideoFileClip(str(src)).without_audio()
        if base.duration >= dur:
            base = base.subclipped(0, dur)
        else:
            base = base.with_effects([vfx.Loop(duration=dur)])
        factor = min(WIDTH / base.w, HEIGHT / base.h)
        layers = [to_canvas(base.resized(factor), dur)]
        if title_layer is not None:
            layers.append(ImageClip(np.array(title_layer), transparent=True)
                          .with_duration(dur))
        for st, en, sent in segs:
            if sent:
                layer = text_layer(sent, SUB_FONT_SIZE, "#FFE066", SUB_WRAP,
                                   bottom=SUB_MARGIN)
                layers.append(ImageClip(np.array(layer), transparent=True)
                              .with_start(st).with_duration(en - st))
        video = CompositeVideoClip(layers, size=(WIDTH, HEIGHT)).with_duration(dur)
    else:                                  # 静态图：PIL 预合成整帧，单层播放
        canvas = base_frame(sc)
        frames = []
        for st, en, sent in segs:
            frame = canvas
            if title_layer is not None:
                frame = Image.alpha_composite(frame, title_layer)
            if sent:
                frame = Image.alpha_composite(
                    frame, text_layer(sent, SUB_FONT_SIZE, "#FFE066",
                                      SUB_WRAP, bottom=SUB_MARGIN))
            frames.append(ImageClip(np.array(frame.convert("RGB")))
                          .with_duration(en - st))
        video = concatenate_videoclips(frames, method="chain")
        if KEN_BURNS:                      # 可选：整段缓慢推近
            video = video.with_effects(
                [vfx.Resize(lambda t: 1 + 0.06 * t / max(dur, 0.1))])
            video = to_canvas(video, dur)

    video = video.with_audio(
        AudioFileClip(str(AUDIO_DIR / f"scene{i}.mp3")).with_start(pad)
    )
    print(f"[剪辑] 分镜{i} {dur:.1f}s | {text[:20]}…")
    return video


# ---------------------------------------------------------------- 主流程
def main() -> None:
    ap = argparse.ArgumentParser(description="iCar 演示视频自动组装")
    ap.add_argument("--keep-audio", action="store_true",
                    help="复用已有配音，不重新合成")
    ap.add_argument("--dry-run", action="store_true",
                    help="只校验 scenes.json / 素材 / 配音时长，不渲染")
    args = ap.parse_args()

    check_deps()
    scenes = load_scenes()
    have_audio = all((AUDIO_DIR / f"scene{i}.mp3").exists()
                     for i in range(1, len(scenes) + 1))

    if args.dry_run:
        total = 0.0
        for i, sc in enumerate(scenes, 1):
            if have_audio:
                d = audio_duration(i)
                total += d
                extra = f"配音 {d:.1f}s"
            else:
                extra = "配音未合成"
            print(f"  分镜{i}: {sc.get('title', '(无标题)')} | "
                  f"素材 {sc.get('source') or '纯色底'} | {extra}")
        if have_audio:
            pads = sum(float(s.get("pad", 0.35)) * 2 for s in scenes)
            est = total + pads - CROSSFADE * (len(scenes) - 1)
            hint = "（偏长，可调大 RATE 或删句）" if est > 61 else "（偏短，可调小 RATE）" if est < 55 else ""
            print(f"[OK] dry-run 通过：口播 {total:.1f}s + 留白，预计成片约 {est:.1f}s {hint}")
        else:
            print("[OK] dry-run 通过（配音未合成，时长待定）")
        return

    if not args.keep_audio and AUDIO_DIR.exists():
        shutil.rmtree(AUDIO_DIR)
    asyncio.run(synth_audio(scenes, keep=args.keep_audio))
    OUTPUT_DIR.mkdir(exist_ok=True)

    clips = [build_scene(i, sc, audio_duration(i))
             for i, sc in enumerate(scenes, 1)]

    from moviepy import concatenate_videoclips

    if CROSSFADE > 0 and len(clips) > 1:
        final = concatenate_videoclips(clips, method="compose",
                                       padding=-CROSSFADE)
    else:
        final = concatenate_videoclips(clips, method="compose")
    print(f"[剪辑] 总时长 {final.duration:.1f}s（含转场与留白）")

    out = OUTPUT_DIR / "icar_demo.mp4"
    final.write_videofile(
        str(out),
        fps=FPS, codec="libx264", audio_codec="aac",
        audio_bitrate="192k", preset="veryfast",
        ffmpeg_params=["-pix_fmt", "yuv420p", "-crf", "20"],
        threads=0,
    )
    final.close()
    print(f"[完成] 成片 -> {out}")
    print(f"        大小 {out.stat().st_size / 1e6:.1f} MB，"
          f"时长 {final.duration:.1f}s，可直接上传视频号/小红书")


if __name__ == "__main__":
    main()
