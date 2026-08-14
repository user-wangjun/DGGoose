"""Build transparent runtime sheets from the approved independent action frames.

The source action frames intentionally stay in docs/character-action-frames as
reviewable deliverables. Runtime sheets are derived per action group so no
different actions are mixed into the same image.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "docs" / "character-action-frames"
RUNTIME_ROOT = PROJECT_ROOT / "assets" / "characters" / "actions"
FRAME_SIZE = 384
BACKGROUND_DISTANCE = 18
EDGE_DISTANCE = 54


def _distance(color: tuple[int, int, int], background: tuple[int, int, int]) -> int:
    return max(abs(color[index] - background[index]) for index in range(3))


def _remove_connected_background(image: Image.Image) -> Image.Image:
    """Remove the flat pale background without deleting enclosed cream details."""

    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    background = pixels[0, 0]
    background_mask = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def near_background(x: int, y: int) -> bool:
        return _distance(pixels[x, y], background) <= BACKGROUND_DISTANCE

    for x in range(width):
        if near_background(x, 0):
            queue.append((x, 0))
        if near_background(x, height - 1):
            queue.append((x, height - 1))
    for y in range(height):
        if near_background(0, y):
            queue.append((0, y))
        if near_background(width - 1, y):
            queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if background_mask[index] or not near_background(x, y):
            continue
        background_mask[index] = 1
        for next_x, next_y in (
            (x - 1, y),
            (x + 1, y),
            (x, y - 1),
            (x, y + 1),
        ):
            if 0 <= next_x < width and 0 <= next_y < height:
                next_index = next_y * width + next_x
                if not background_mask[next_index] and near_background(next_x, next_y):
                    queue.append((next_x, next_y))

    alpha = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if background_mask[index]:
                continue

            value = 255
            if _distance(pixels[x, y], background) <= EDGE_DISTANCE:
                touches_background = False
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    for next_y in range(max(0, y - 1), min(height, y + 2)):
                        if background_mask[next_y * width + next_x]:
                            touches_background = True
                            break
                    if touches_background:
                        break
                if touches_background:
                    distance = _distance(pixels[x, y], background)
                    value = max(0, min(255, round((distance - 8) * 255 / (EDGE_DISTANCE - 8))))
            alpha[index] = value

    rgba = Image.new("RGBA", (width, height))
    rgba.putdata([
        (pixels[x, y][0], pixels[x, y][1], pixels[x, y][2], alpha[y * width + x])
        for y in range(height)
        for x in range(width)
    ])
    return rgba


def _normalise_transparent_rgb(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    image.putdata([
        pixel if pixel[3] else (0, 0, 0, 0)
        for pixel in image.getdata()
    ])
    return image


def build_group(group: dict) -> dict:
    name = group["name"]
    frame_count = int(group["frameCount"])
    source_dir = SOURCE_ROOT / group["framesDir"]
    frames = []
    for index in range(1, frame_count + 1):
        frame_path = source_dir / f"{name}_{index:02d}.png"
        if not frame_path.exists():
            raise FileNotFoundError(frame_path)
        source = Image.open(frame_path)
        frame = _remove_connected_background(source).resize(
            (FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS
        )
        frames.append(_normalise_transparent_rgb(frame))

    character_dir = "gxe" if group["character"] == "莞小鹅" else "boss"
    output_dir = RUNTIME_ROOT / character_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (FRAME_SIZE * frame_count, FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * FRAME_SIZE, 0))
    sheet = _normalise_transparent_rgb(sheet)
    output_path = output_dir / f"{name}_sheet.png"
    sheet.save(output_path, optimize=True)
    return {
        "name": name,
        "character": group["character"],
        "sheet": f"{character_dir}/{output_path.name}",
        "frameCount": frame_count,
        "frameSize": f"{FRAME_SIZE}x{FRAME_SIZE}",
    }


def main() -> None:
    source_manifest = json.loads(
        (SOURCE_ROOT / "action-manifest.json").read_text(encoding="utf-8")
    )["characterActionResources"]
    runtime_groups = [build_group(group) for group in source_manifest["groups"]]
    print(json.dumps({"groups": runtime_groups, "totalFrames": sum(group["frameCount"] for group in runtime_groups)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
