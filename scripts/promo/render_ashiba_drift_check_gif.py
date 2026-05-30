from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "public" / "brand"
PREVIEW_DIR = ROOT / "tmp" / "promo"
GIF_PATH = OUT_DIR / "ashiba-drift-check.gif"
PNG_PATH = PREVIEW_DIR / "ashiba-drift-check-final.png"

WIDTH = 1200
HEIGHT = 675
MARGIN = 34
TERM_X = 56
TERM_Y = 94
TERM_W = WIDTH - TERM_X * 2
TERM_H = HEIGHT - TERM_Y - 54
HEADER_H = 44
PADDING_X = 28
PADDING_Y = 22
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
SHADOW = (0, 0, 0)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


FONT_PATH = r"C:\Windows\Fonts\JetBrainsMonoNerdFont-Regular.ttf"
FONT_BOLD_PATH = r"C:\Windows\Fonts\JetBrainsMonoNerdFont-Bold.ttf"
UI_FONT = font(FONT_BOLD_PATH, 44)
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
        current = "  " + current[cut:].lstrip()
    chunks.append(current)
    return chunks


def visible_lines(lines: list[tuple[str, tuple[int, int, int], bool]]) -> list[tuple[str, tuple[int, int, int], bool]]:
    expanded: list[tuple[str, tuple[int, int, int], bool]] = []
    for text, color, bold in lines:
        for part in wrap_line(text):
            expanded.append((part, color, bold))
    return expanded[-MAX_LINES:]


def draw_frame(lines: list[tuple[str, tuple[int, int, int], bool]], cursor: bool = False) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    for i in range(0, HEIGHT, 3):
        shade = int(10 + i / HEIGHT * 9)
        draw.line((0, i, WIDTH, i), fill=(shade, shade + 4, shade + 13))

    draw.text((MARGIN, 24), "Ashiba", font=UI_FONT, fill=BLUE)
    draw.text((MARGIN + 178, 38), "Drift check scenario", font=SUB_FONT, fill=TITLE)
    x = WIDTH - 450
    x = draw_badge(draw, x, 35, "DDL changed", YELLOW)
    x = draw_badge(draw, x, 35, "Passive detection", GREEN)

    shadow_box = (TERM_X + 8, TERM_Y + 10, TERM_X + TERM_W + 8, TERM_Y + TERM_H + 10)
    rounded(draw, shadow_box, 20, SHADOW)
    rounded(draw, (TERM_X, TERM_Y, TERM_X + TERM_W, TERM_Y + TERM_H), 20, TERM_BG, TERM_BORDER, 1)
    rounded(draw, (TERM_X, TERM_Y, TERM_X + TERM_W, TERM_Y + HEADER_H), 20, (27, 36, 55))
    draw.rectangle((TERM_X, TERM_Y + HEADER_H - 20, TERM_X + TERM_W, TERM_Y + HEADER_H), fill=(27, 36, 55))

    dot_y = TERM_Y + 18
    for idx, color in enumerate([(248, 113, 113), (251, 191, 36), (52, 211, 153)]):
        draw.ellipse((TERM_X + 22 + idx * 24, dot_y, TERM_X + 36 + idx * 24, dot_y + 14), fill=color)
    draw.text((TERM_X + 112, TERM_Y + 14), "ashiba-drift-check", font=MONO_BOLD, fill=COMMENT)

    y = TERM_Y + HEADER_H + PADDING_Y
    for text, color, bold in visible_lines(lines):
        draw.text((TERM_X + PADDING_X, y), text, font=MONO_BOLD if bold else MONO, fill=color)
        y += LINE_H
    if cursor:
        draw.rectangle((TERM_X + PADDING_X, y + 4, TERM_X + PADDING_X + 12, y + 24), fill=GREEN)

    draw.text((MARGIN, HEIGHT - 36), "DDL drift  ->  test fails  ->  check explains  ->  human/AI repairs  ->  green again", font=SUB_FONT, fill=MUTED)
    return img


def add_pause(frames: list[Image.Image], durations: list[int], lines, ms: int):
    frames.append(draw_frame(lines, cursor=True))
    durations.append(ms)


def type_command(frames: list[Image.Image], durations: list[int], lines, command: str):
    prefix = "$ "
    for end in range(0, len(command) + 1, 3):
        frames.append(draw_frame(lines + [(prefix + command[:end], GREEN, True)], cursor=True))
        durations.append(45)
    lines.append((prefix + command, GREEN, True))
    frames.append(draw_frame(lines, cursor=False))
    durations.append(260)


def output_lines(frames: list[Image.Image], durations: list[int], lines, output: list[tuple[str, tuple[int, int, int], bool]], last_ms: int = 700):
    for line in output:
        lines.append(line)
        frames.append(draw_frame(lines, cursor=False))
        durations.append(250)
    durations[-1] = last_ms


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    lines: list[tuple[str, tuple[int, int, int], bool]] = [
        ("# Starter is already created. Now change the DDL.", COMMENT, False),
    ]
    frames: list[Image.Image] = []
    durations: list[int] = []

    add_pause(frames, durations, lines, 700)

    type_command(frames, durations, lines, "type db\\ddl\\public.sql")
    output_lines(frames, durations, lines, [
        ("create table public.users (", WHITE, False),
        ("    user_id bigserial primary key,", WHITE, False),
        ("    email text not null,", WHITE, False),
        ("    display_name text", WHITE, False),
        (");", WHITE, False),
    ])

    type_command(frames, durations, lines, "code db\\ddl\\public.sql")
    output_lines(frames, durations, lines, [
        ("# Human/AI edits the DDL source:", COMMENT, False),
        ("- rename display_name -> nickname", YELLOW, False),
        ("- add status text not null default 'active'", YELLOW, False),
    ])

    type_command(frames, durations, lines, "npx vitest run")
    output_lines(frames, durations, lines, [
        ("FAIL  src/features/users-list/queries/list/tests/list.boundary.ztd.test.ts", RED, True),
        ("Mapping drift: SQL/DDL no longer matches generated mapper expectations.", RED, False),
        ("Expected column: display_name", COMMENT, False),
        ("Actual DDL column: nickname", COMMENT, False),
    ], last_ms=950)

    type_command(frames, durations, lines, "npx ashiba check")
    output_lines(frames, durations, lines, [
        ("Ashiba check: failed", RED, True),
        ("[error] ASHIBA_PROJECT_FEATURE_TESTS_FAILED", RED, True),
        ("file: src/features/users-list/queries/list", WHITE, False),
        ("detail: visible SQL: .../list.sql", WHITE, False),
        ("detail: editable mapper boundary: .../query.ts", WHITE, False),
        ("next: human/AI updates SQL and boundary first; then refresh generated tests.", BLUE, False),
    ], last_ms=1100)

    type_command(frames, durations, lines, "code src\\features\\users-list\\queries\\list\\list.sql")
    output_lines(frames, durations, lines, [
        ("# Human/AI repairs visible SQL:", COMMENT, False),
        ("select user_id, email, nickname, status", YELLOW, False),
        ("from public.users", YELLOW, False),
    ], last_ms=650)

    type_command(frames, durations, lines, "code src\\features\\users-list\\queries\\list\\query.ts")
    output_lines(frames, durations, lines, [
        ("# Human/AI repairs editable mapper boundary:", COMMENT, False),
        ("UserListRow { user_id, email, nickname, status }", YELLOW, False),
    ], last_ms=650)

    type_command(frames, durations, lines, "npx ashiba feature tests check users-list --query list --fix")
    output_lines(frames, durations, lines, [
        ("Feature tests check passed", GREEN, True),
        ("fixed: .../tests/generated/mapping.cases.ts", GREEN, False),
        ("fixed: .../tests/generated/analysis.json", GREEN, False),
    ], last_ms=950)

    type_command(frames, durations, lines, "npx ashiba check")
    output_lines(frames, durations, lines, [
        ("Ashiba check: ok", GREEN, True),
        ("- contract: ok", GREEN, False),
        ("- generated mapper: ok", GREEN, False),
        ("- DDL diagnostics: ok", GREEN, False),
    ], last_ms=850)

    type_command(frames, durations, lines, "npx vitest run")
    output_lines(frames, durations, lines, [
        ("RUN  v4.1.7  ./ashiba-demo", PURPLE, False),
        ("✓ ZTD mapper test: SQL row -> TypeScript DTO", GREEN, True),
        ("Test Files  2 passed (2)", GREEN, True),
        ("Tests       3 passed (3)", GREEN, True),
        ("Drift was detected, repaired, and proven by tests.", BLUE, True),
    ], last_ms=1200)

    add_pause(frames, durations, lines, 4800)

    frames[-1].save(PNG_PATH, optimize=True)
    frames[0].save(
        GIF_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        optimize=True,
        disposal=2,
    )
    print(GIF_PATH.resolve())
    print(PNG_PATH.resolve())


if __name__ == "__main__":
    main()
