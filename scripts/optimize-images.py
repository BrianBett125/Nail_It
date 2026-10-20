#!/usr/bin/env python3
"""Turns the original photos into the WebP files the pages use, within a size budget each.

    python3 scripts/optimize-images.py SOURCE_DIR assets

SOURCE_DIR holds the originals (sparks.jpg, hammer.jpg, architechture.jpg, database.jpg, Stock.jpg,
storage.jpg). The originals are not kept in the repository: they weigh 7 MB. They are in the git history
before the Phase 5 commit (`git show 0536918:assets/sparks.jpg > sparks.jpg`).

Each target says how wide it may be and how many kilobytes it may weigh. The quality is lowered one step at
a time until the file fits, so the result is the best quality inside the budget, and the script fails
loudly if even the lowest quality does not fit. Needs Pillow with WebP support.
"""
import os
import sys

from PIL import Image

# (source file, output file, max width, budget in KB)
TARGETS = [
    ("sparks.jpg", "sparks-1600.webp", 1600, 200),        # home page hero
    ("sparks.jpg", "sparks-800.webp", 800, 80),           # the same on phones
    ("hammer.jpg", "hammer-900.webp", 900, 150),          # sign-in card background
    ("architechture.jpg", "architecture-1600.webp", 1600, 150),  # about page background
    ("architechture.jpg", "architecture-800.webp", 800, 70),
    ("database.jpg", "database.webp", 640, 40),           # home page feature pictures
    ("Stock.jpg", "stock.webp", 640, 40),
    ("storage.jpg", "storage.webp", 640, 40),
]
QUALITIES = [80, 72, 65, 58, 50, 42, 35, 28]


def build(source_dir, out_dir):
    failures = []
    for source, output, max_width, budget_kb in TARGETS:
        image = Image.open(os.path.join(source_dir, source)).convert("RGB")
        if image.width > max_width:
            height = round(image.height * max_width / image.width)
            image = image.resize((max_width, height), Image.LANCZOS)
        target = os.path.join(out_dir, output)
        for quality in QUALITIES:
            image.save(target, "WEBP", quality=quality, method=6)
            size_kb = os.path.getsize(target) / 1024
            if size_kb <= budget_kb:
                print(f"{output}: {image.width}x{image.height}, quality {quality}, {size_kb:.0f} KB (budget {budget_kb})")
                break
        else:
            failures.append(f"{output}: {size_kb:.0f} KB at the lowest quality, budget {budget_kb} KB")
    return failures


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    problems = build(sys.argv[1], sys.argv[2])
    if problems:
        sys.exit("OVER BUDGET:\n" + "\n".join(problems))
