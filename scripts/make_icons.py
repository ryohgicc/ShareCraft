#!/usr/bin/env python3
"""Generate simple gradient PNG icons for ShareCraft."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

SIZES = [16, 32, 48, 128]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rect background with diagonal gradient.
    radius = max(2, size // 5)
    top_left = (99, 102, 241)   # indigo-500
    bottom_right = (37, 99, 235)  # blue-600

    # Render gradient by drawing per-pixel within the rounded mask.
    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    grad = Image.new("RGB", (size, size))
    for y in range(size):
        for x in range(size):
            t = (x + y) / max(1, (2 * (size - 1)))
            grad.putpixel((x, y), lerp(top_left, bottom_right, t))

    img.paste(grad, (0, 0), mask)

    # Draw a stylized sparkle / star glyph in the center.
    cx, cy = size / 2, size / 2
    arm = size * 0.34
    thin = max(1, size // 16)
    color = (255, 255, 255, 255)

    # Vertical and horizontal arms (diamond shapes via polygons).
    def diamond(cx, cy, length, width):
        return [
            (cx, cy - length),
            (cx + width, cy),
            (cx, cy + length),
            (cx - width, cy),
        ]

    width = max(1, size // 10)
    draw.polygon(diamond(cx, cy, arm, width), fill=color)
    # Rotate 90: horizontal
    draw.polygon(
        [
            (cx - arm, cy),
            (cx, cy + width),
            (cx + arm, cy),
            (cx, cy - width),
        ],
        fill=color,
    )

    # Diagonals (smaller).
    if size >= 32:
        diag = arm * 0.7
        dwidth = max(1, width // 2)
        # 45 degrees
        from math import cos, sin, radians
        for angle in (45, 135):
            a = radians(angle)
            ux, uy = cos(a), sin(a)
            px, py = -uy, ux  # perpendicular
            pts = [
                (cx + ux * diag, cy + uy * diag),
                (cx + px * dwidth, cy + py * dwidth),
                (cx - ux * diag, cy - uy * diag),
                (cx - px * dwidth, cy - py * dwidth),
            ]
            draw.polygon(pts, fill=color)

    return img


def main():
    for size in SIZES:
        img = render(size)
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        img.save(path, "PNG")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
