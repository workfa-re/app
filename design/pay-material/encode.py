"""Lossless logo tracing, flat compositing and delivery checks for the 3D film."""
import argparse
from io import BytesIO
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image

WIDTH, HEIGHT, FPS, FRAMES = 1024, 768, 12, 240
BACKGROUNDS = {"light": 244, "dark": 9}


def trace(source: Path, output: Path):
    image = Image.open(source).convert("RGBA")
    image = image.crop(image.getbbox())
    alpha = image.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    edges = {}

    def inside(x, y):
        return 0 <= x < width and 0 <= y < height and pixels[x, y] >= 128

    for y in range(height):
        for x in range(width):
            if not inside(x, y):
                continue
            candidates = []
            if not inside(x, y - 1):
                candidates.append(((x, y), (x + 1, y)))
            if not inside(x + 1, y):
                candidates.append(((x + 1, y), (x + 1, y + 1)))
            if not inside(x, y + 1):
                candidates.append(((x + 1, y + 1), (x, y + 1)))
            if not inside(x - 1, y):
                candidates.append(((x, y + 1), (x, y)))
            for start, end in candidates:
                edges.setdefault(start, []).append(end)

    contours = []
    while edges:
        start = next(iter(edges))
        point, loop = start, []
        while True:
            loop.append(point)
            adjacent = edges[point]
            following = adjacent.pop()
            if not adjacent:
                del edges[point]
            point = following
            if point == start:
                break
            if len(loop) > 100_000:
                raise ValueError("The original mark has an unclosed outline")
        simplified = []
        for index, point in enumerate(loop):
            before, after = loop[index - 1], loop[(index + 1) % len(loop)]
            if ((point[0] - before[0]) * (after[1] - point[1])
                    != (point[1] - before[1]) * (after[0] - point[0])):
                simplified.append(point)
        if len(simplified) >= 3:
            contours.append([[(x - width / 2) / width, (height / 2 - y) / width]
                             for x, y in simplified])
    output.write_text(json.dumps({"source": "public/brand/workfare-mark-light.png",
                                  "source_dimensions": [width, height],
                                  "alpha_threshold": 128, "contours": contours}))


def composite(path: Path, theme: str):
    image = Image.open(path).convert("RGBA")
    if image.size != (WIDTH, HEIGHT):
        raise ValueError("Unexpected render dimensions")
    tone = BACKGROUNDS[theme]
    plate = Image.new("RGBA", image.size, (tone, tone, tone, 255))
    plate.alpha_composite(image)
    return plate.convert("RGB")


def save_poster(image: Image.Image, output: Path):
    temporary = output.with_name(output.stem + ".partial.webp")
    image.save(temporary, format="WEBP", lossless=True, exact=True, method=6)
    temporary.replace(output)


def ffmpeg_decode(ffmpeg: str, video: Path, width=WIDTH, height=HEIGHT, first=False):
    command = [ffmpeg, "-v", "error", "-i", str(video)]
    if first:
        command += ["-frames:v", "1"]
    command += ["-vf", f"scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    return subprocess.check_output(command)


def encode(frame_dir: Path, theme: str, output: Path, ffmpeg: str):
    target = output / f"workfare-pay-material-v5-{theme}.mp4"
    temporary = target.with_name(target.stem + ".partial.mp4")
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}",
               "-r", str(FPS), "-i", "pipe:0", "-an",
               "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
               "-c:v", "libx264", "-preset", "slow", "-crf", "19",
               "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
               "-g", str(FRAMES), "-keyint_min", str(FRAMES),
               "-movflags", "+faststart", "-colorspace", "bt709",
               "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
               str(temporary)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame in range(FRAMES):
            # These are mathematically identical rigid-object poses. No image
            # interpolation, optical flow, generated in-between frame or crossfade.
            pose = min(frame, FRAMES - frame)
            image = composite(frame_dir / f"frame-{pose:03d}.png", theme)
            process.stdin.write(image.tobytes())
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("Video encoding failed")
    except BaseException:
        process.kill()
        process.wait()
        raise
    if temporary.stat().st_size > 5_000_000:
        raise ValueError("The delivery exceeds the five-megabyte budget")
    temporary.replace(target)
    decoded = np.frombuffer(ffmpeg_decode(ffmpeg, target, first=True), dtype=np.uint8).reshape(HEIGHT, WIDTH, 3)
    poster_path = target.with_suffix(".webp")
    save_poster(Image.fromarray(decoded), poster_path)
    poster = np.asarray(Image.open(poster_path).convert("RGB"))
    small = np.frombuffer(ffmpeg_decode(ffmpeg, target, 256, 192), dtype=np.uint8).reshape(-1, 192, 256, 3).astype(np.int16)
    if len(small) != FRAMES:
        raise ValueError("Unexpected decoded frame count")
    steps = np.abs(small[1:] - small[:-1]).mean(axis=(1, 2, 3))
    first_vs_five = float(np.abs(small[FPS * 5] - small[0]).mean())
    seam = float(np.abs(small[-1] - small[0]).mean())
    if first_vs_five <= .5:
        raise ValueError("The film does not have sufficient visible motion")
    if seam > max(1.5, float(steps.max()) * 1.25):
        raise ValueError("Unexpected discontinuity at the loop boundary")
    error = int(np.abs(poster.astype(np.int16) - decoded.astype(np.int16)).max())
    if error:
        raise ValueError("The poster does not match the decoded first frame")
    report = {"theme": theme, "dimensions": [WIDTH, HEIGHT], "native_fps": FPS,
              "frames": FRAMES, "duration_seconds": FRAMES / FPS,
              "unique_rendered_poses": FRAMES // 2 + 1, "bytes": target.stat().st_size,
              "five_second_motion_mae_255": first_vs_five, "loop_seam_mae_255": seam,
              "max_internal_step_mae_255": float(steps.max()),
              "median_internal_step_mae_255": float(np.median(steps)),
              "poster_vs_decoded_first_max_diff": error,
              "decoded_corner_rgb": decoded[0, 0].tolist(), "audio": False,
              "motion": "analytic rigid cosine translation/rotation; fixed camera and studio lights"}
    (output / f"workfare-pay-material-v5-{theme}-qa.json").write_text(json.dumps(report, indent=2))
    print("WORKFARE_ENCODED " + json.dumps(report), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["trace", "poster", "encode"])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--frames", type=Path)
    parser.add_argument("--theme", choices=["light", "dark"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    if args.operation == "trace":
        trace(args.source, args.output)
    elif args.operation == "poster":
        save_poster(composite(args.source, args.theme), args.output)
    else:
        encode(args.frames, args.theme, args.output, args.ffmpeg)
