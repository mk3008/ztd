from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "public" / "brand"
GIF_PATH = OUT_DIR / "ashiba-migration-generate.gif"
PREVIEW_DIR = ROOT / "tmp" / "promo"
PNG_PATH = PREVIEW_DIR / "ashiba-migration-generate-final.png"

WIDTH = 1200
HEIGHT = 675
PADDING = 36
TERM_X = 54
TERM_Y = 94
TERM_W = WIDTH - TERM_X * 2
TERM_H = HEIGHT - TERM_Y - 48
HEADER_H = 44
LINE_H = 26
MAX_LINES = 16

BG = (9, 14, 26)
TERM_BG = (17, 24, 39)
TERM_BORDER = (54, 65, 86)
TITLE = (236, 244, 255)
MUTED = (145, 159, 184)
BLUE = (96, 165, 250)
GREEN = (74, 222, 128)
YELLOW = (250, 204, 21)
PURPLE = (167, 139, 250)
RED = (248, 113, 113)
WHITE = (226, 232, 240)
COMMENT = (148, 163, 184)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


FONT_PATH = r"C:\Windows\Fonts\JetBrainsMonoNerdFont-Regular.ttf"
FONT_BOLD_PATH = r"C:\Windows\Fonts\JetBrainsMonoNerdFont-Bold.ttf"
UI_FONT = font(FONT_BOLD_PATH, 43)
SUB_FONT = font(FONT_PATH, 22)
MONO = font(FONT_PATH, 20)
MONO_BOLD = font(FONT_BOLD_PATH, 20)
BADGE_FONT = font(FONT_BOLD_PATH, 17)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_badge(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, color: tuple[int, int, int]) -> int:
    pad_x = 13
    pad_y = 6
    bbox = draw.textbbox((0, 0), text, font=BADGE_FONT)
    w = bbox[2] - bbox[0] + pad_x * 2
    h = bbox[3] - bbox[1] + pad_y * 2
    rounded(draw, (x, y, x + w, y + h), 14, (color[0] // 5, color[1] // 5, color[2] // 5), color, 1)
    draw.text((x + pad_x, y + pad_y - 1), text, font=BADGE_FONT, fill=color)
    return x + w + 10


def wrap_line(text: str, max_chars: int = 92) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    current = text
    while len(current) > max_chars:
        cut = current.rfind(" ", 0, max_chars)
        if cut < 20:
            cut = max_chars
        chunks.append(current[:cut])
        current = current[cut:].lstrip()
    if current:
        chunks.append(current)
    return chunks


def expand_lines(lines: list[tuple[str, tuple[int, int, int] | None]]) -> list[tuple[str, tuple[int, int, int] | None]]:
    expanded: list[tuple[str, tuple[int, int, int] | None]] = []
    for text, color in lines:
        wrapped = wrap_line(text)
        expanded.extend((line, color) for line in wrapped)
    return expanded[-MAX_LINES:]


def draw_frame(title: str, subtitle: str, badges: list[tuple[str, tuple[int, int, int]]], lines: list[tuple[str, tuple[int, int, int] | None]]) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((PADDING, 24), title, font=UI_FONT, fill=TITLE)
    draw.text((PADDING, 72), subtitle, font=SUB_FONT, fill=MUTED)

    rounded(draw, (TERM_X, TERM_Y, TERM_X + TERM_W, TERM_Y + TERM_H), 18, TERM_BG, TERM_BORDER, 1)
    draw.rounded_rectangle((TERM_X, TERM_Y, TERM_X + TERM_W, TERM_Y + HEADER_H), radius=18, fill=(24, 32, 50), outline=None)
    draw.rectangle((TERM_X, TERM_Y + HEADER_H - 16, TERM_X + TERM_W, TERM_Y + HEADER_H), fill=(24, 32, 50))
    x = TERM_X + 22
    for badge, color in badges:
        x = draw_badge(draw, x, TERM_Y + 10, badge, color)

    y = TERM_Y + HEADER_H + 24
    for text, color in expand_lines(lines):
        fill = color or WHITE
        text_font = MONO_BOLD if text.startswith("$") or text.startswith("+") or text.startswith("-") else MONO
        draw.text((TERM_X + 28, y), text, font=text_font, fill=fill)
        y += LINE_H

    return image


def step(title: str, subtitle: str, badges: list[tuple[str, tuple[int, int, int]]], lines: list[tuple[str, tuple[int, int, int] | None]], hold: int = 4) -> list[Image.Image]:
    frame = draw_frame(title, subtitle, badges, lines)
    return [frame.copy() for _ in range(hold)]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    frames: list[Image.Image] = []
    frames += step(
        "Ashiba migration review",
        "Compare committed DDL with local DDL, then write reviewable migration SQL.",
        [("git DDL source", BLUE), ("review artifact", PURPLE)],
        [
            ("$ git log --oneline -1 main -- db/ddl", BLUE),
            ("a18f2c1 baseline users DDL", WHITE),
            ("", None),
            ("$ sed -n '1,80p' db/ddl/public.sql", BLUE),
            ("create table public.users (", WHITE),
            ("    user_id bigserial primary key", WHITE),
            ("  , email text not null", WHITE),
            ("  , display_name text", WHITE),
            ("  , login_count integer not null default 0", WHITE),
            (");", WHITE),
        ],
    )
    frames += step(
        "Change local DDL",
        "The local schema is the desired shape. The committed branch stays the old shape.",
        [("edit", YELLOW), ("db/ddl/public.sql", BLUE)],
        [
            ("$ code db/ddl/public.sql", BLUE),
            ("", None),
            ("-  , display_name text", RED),
            ("+  , nickname text", GREEN),
            ("+  , status text not null default 'active'", GREEN),
            ("", None),
            ("$ git diff -- db/ddl/public.sql", BLUE),
            ("local DDL now describes the next schema", COMMENT),
        ],
    )
    frames += step(
        "Generate migration SQL",
        "Use the branch DDL as from, and the working-tree DDL directory as to.",
        [("from main:db/ddl", BLUE), ("to db/ddl", GREEN)],
        [
            ("$ npx ashiba ddl migration generate \\", BLUE),
            ("    --from-git main:db/ddl \\", WHITE),
            ("    --to-dir db/ddl \\", WHITE),
            ("    --out tmp/ddl/migration.sql \\", WHITE),
            ("    --no-drop-tables --no-drop-columns --no-drop-constraints", WHITE),
            ("", None),
            ("DDL migration generate", GREEN),
            ("- from: main:db/ddl", WHITE),
            ("- to: db\\ddl", WHITE),
            ("- sql: tmp\\ddl\\migration.sql", WHITE),
            ("- from files: 1", WHITE),
            ("- to files: 1", WHITE),
        ],
    )
    frames += step(
        "Review the generated artifact",
        "Ashiba writes SQL for review. Applying it is still owned by your migration process.",
        [("tmp/ddl/migration.sql", GREEN), ("review before apply", YELLOW)],
        [
            ("$ sed -n '1,120p' tmp/ddl/migration.sql", BLUE),
            ("alter table public.users", WHITE),
            ("    rename column display_name to nickname;", WHITE),
            ("", None),
            ("alter table public.users", WHITE),
            ("    add column status text not null default 'active';", WHITE),
            ("", None),
            ("# commit the DDL and migration artifact together", COMMENT),
            ("$ git status --short", BLUE),
            (" M db/ddl/public.sql", WHITE),
            ("?? tmp/ddl/migration.sql", WHITE),
        ],
    )
    frames += step(
        "Migration ownership stays yours",
        "Ashiba compares DDL and prepares the review artifact. It does not deploy your database.",
        [("done", GREEN), ("SQL-first", BLUE)],
        [
            ("$ npx ashiba ddl migration generate --from-git main:db/ddl --to-dir db/ddl --out tmp/ddl/migration.sql", BLUE),
            ("", None),
            ("reviewable migration SQL created", GREEN),
            ("from: committed DDL branch", WHITE),
            ("to: local desired DDL", WHITE),
            ("out: tmp/ddl/migration.sql", WHITE),
            ("", None),
            ("DDL remains visible. Migration apply remains explicit.", COMMENT),
        ],
        hold=7,
    )

    frames[0].save(
        GIF_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=520,
        optimize=False,
    )
    frames[-1].save(PNG_PATH)
    print(f"Wrote {GIF_PATH}")
    print(f"Wrote {PNG_PATH}")


if __name__ == "__main__":
    main()
