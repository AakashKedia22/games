"""Rendered card faces for training. The index box is measured from the ink actually drawn, so it is exact.

A face is FACE_W x FACE_H (560 x 800), upright. Its top-left index is drawn at the card's top-left, and
its bottom-right index is the same patch rotated 180 degrees.
"""
import functools
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from classes import JOKER

FACE_H = 800
FACE_W = 560
INDEX_CX = 0.115   # index centre from the left edge, in face heights (0.115 * H)
INDEX_TOP = 0.035  # index top from the top edge, in face heights
RANK_H = 0.11      # rank text height, in face heights
PIP_H = 0.07       # index suit pip height
INDEX_GAP = 0.012
JOKER_H = 0.34     # the vertical 'JOKER' stack
INDEX_MAX_W = 0.13 # widest rank index, as a share of the face width (printed indices are condensed)
INDEX_JITTER = 0.012  # index position jitter, in face heights (keeps every index inside the corner)
ART_FIELD = (150, 240)  # picture-card field brightness; keeps the card average light, like printed cards

# macOS system fonts; only the ones that exist are used. They draw local training images only.
_SUPPLEMENTAL = '/System/Library/Fonts/Supplemental'
_SYSTEM = '/System/Library/Fonts'
FONTS = [
    os.path.join(_SUPPLEMENTAL, 'Arial.ttf'), os.path.join(_SUPPLEMENTAL, 'Arial Bold.ttf'),
    os.path.join(_SUPPLEMENTAL, 'Arial Narrow.ttf'), os.path.join(_SUPPLEMENTAL, 'Times New Roman.ttf'),
    os.path.join(_SUPPLEMENTAL, 'Georgia.ttf'), os.path.join(_SUPPLEMENTAL, 'Courier New Bold.ttf'),
    os.path.join(_SUPPLEMENTAL, 'Verdana.ttf'), os.path.join(_SUPPLEMENTAL, 'Tahoma.ttf'),
    os.path.join(_SUPPLEMENTAL, 'Trebuchet MS.ttf'), os.path.join(_SYSTEM, 'Helvetica.ttc'),
    os.path.join(_SYSTEM, 'Avenir.ttc'), os.path.join(_SYSTEM, 'Courier.ttc'),
]
AVAILABLE_FONTS = [path for path in FONTS if os.path.exists(path)]

# Pip centres as fractions of the card's width and height, by rank count.
_COLUMNS = (0.32, 0.68)
PIP_LAYOUT = {
    2: [(0.5, 0.22), (0.5, 0.78)],
    3: [(0.5, 0.22), (0.5, 0.5), (0.5, 0.78)],
    4: [(x, y) for x in _COLUMNS for y in (0.22, 0.78)],
    5: [(x, y) for x in _COLUMNS for y in (0.22, 0.78)] + [(0.5, 0.5)],
    6: [(x, y) for x in _COLUMNS for y in (0.22, 0.5, 0.78)],
    7: [(x, y) for x in _COLUMNS for y in (0.22, 0.5, 0.78)] + [(0.5, 0.36)],
    8: [(x, y) for x in _COLUMNS for y in (0.22, 0.5, 0.78)] + [(0.5, 0.36), (0.5, 0.64)],
    9: [(x, y) for x in _COLUMNS for y in (0.2, 0.4, 0.6, 0.8)] + [(0.5, 0.5)],
    10: [(x, y) for x in _COLUMNS for y in (0.2, 0.4, 0.6, 0.8)] + [(0.5, 0.3), (0.5, 0.7)],
}
ART_COLOURS = [(0, 215, 255), (40, 40, 200), (110, 110, 110), (160, 80, 30), (80, 160, 60)]  # BGR: yellow, red, grey, blue, green


def _font(path, size):
    if path is None:
        return ImageFont.load_default(size=size)
    return ImageFont.truetype(path, size)


def _tight(mask, height):
    """Crop a uint8 mask to its ink, then scale it to the given height (aspect kept)."""
    ys, xs = np.nonzero(mask > 127)
    cropped = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    width = max(1, round(cropped.shape[1] * height / cropped.shape[0]))
    return cv2.resize(cropped, (width, max(1, int(round(height)))), interpolation=cv2.INTER_AREA)


@functools.lru_cache(maxsize=2048)
def _text_ink_cached(text, font_path, height, max_width):
    return _text_ink_raw(text, font_path, height, max_width)


def _text_ink(text, font_path, height, max_width=None):
    """Glyph ink for a rank or a letter, cached by its rounded size (faces reuse the same few sizes)."""
    return _text_ink_cached(text, font_path, int(round(height)), None if max_width is None else int(round(max_width)))


def _text_ink_raw(text, font_path, height, max_width=None):
    font = _font(font_path, 200)
    canvas = Image.new('L', (400, 300), 0)
    ImageDraw.Draw(canvas).text((40, 30), text, font=font, fill=255)
    ink = _tight(np.array(canvas), height)
    if max_width is not None and ink.shape[1] > max_width:  # condensed, like printed indices, so "10" stays in the corner
        ink = cv2.resize(ink, (int(max_width), ink.shape[0]), interpolation=cv2.INTER_AREA)
    return ink


@functools.lru_cache(maxsize=512)
def _pip_ink_cached(suit, height):
    return _pip_ink_raw(suit, height)


def _pip_ink(suit, height):
    """Suit pip ink, cached by its rounded height."""
    return _pip_ink_cached(suit, int(round(height)))


def _pip_ink_raw(suit, height):
    canvas = np.zeros((300, 300), np.uint8)
    c, s = 150.0, 100.0

    def poly(points):
        cv2.fillPoly(canvas, [np.round(np.array(points)).astype(np.int32)], 255)

    def disc(x, y, radius):
        cv2.circle(canvas, (int(round(x)), int(round(y))), int(round(radius)), 255, -1)

    if suit == 'D':
        poly([(c, c - s), (c + 0.62 * s, c), (c, c + s), (c - 0.62 * s, c)])
    elif suit == 'H':
        disc(c - 0.52 * s, c - 0.2 * s, 0.52 * s)
        disc(c + 0.52 * s, c - 0.2 * s, 0.52 * s)
        poly([(c - 1.0 * s, c - 0.2 * s), (c + 1.0 * s, c - 0.2 * s), (c, c + s)])
    elif suit == 'S':
        disc(c - 0.52 * s, c + 0.2 * s, 0.52 * s)
        disc(c + 0.52 * s, c + 0.2 * s, 0.52 * s)
        poly([(c - 1.0 * s, c + 0.2 * s), (c + 1.0 * s, c + 0.2 * s), (c, c - s)])
        poly([(c - 0.12 * s, c + 0.3 * s), (c + 0.12 * s, c + 0.3 * s), (c + 0.45 * s, c + s), (c - 0.45 * s, c + s)])
    else:  # clubs
        disc(c, c - 0.5 * s, 0.45 * s)
        disc(c - 0.5 * s, c + 0.1 * s, 0.45 * s)
        disc(c + 0.5 * s, c + 0.1 * s, 0.45 * s)
        poly([(c - 0.12 * s, c + 0.2 * s), (c + 0.12 * s, c + 0.2 * s), (c + 0.42 * s, c + s), (c - 0.42 * s, c + s)])
    return _tight(canvas, height)


def _paste(face, ink, x, y, colour):
    """Blend a colour onto the face through a uint8 ink mask whose top-left corner is at (x, y)."""
    h, w = ink.shape
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(face.shape[1], x + w), min(face.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    alpha = (ink[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32) / 255.0)[..., None]
    region = face[y0:y1, x0:x1].astype(np.float32)
    face[y0:y1, x0:x1] = np.clip(region * (1 - alpha) + np.array(colour, np.float32) * alpha, 0, 255).astype(np.uint8)


def _index_patch(text_or_letters, suit, font_path, scale):
    """The ink of one index: rank over suit pip, or the vertical letters of JOKER."""
    gap = INDEX_GAP * FACE_H
    if text_or_letters == JOKER:
        letter_h = (JOKER_H * FACE_H * scale - 4 * gap) / 5
        letters = [_text_ink(letter, font_path, letter_h) for letter in 'JOKER']
        width = max(letter.shape[1] for letter in letters)
        height = sum(letter.shape[0] for letter in letters) + int(round(gap)) * (len(letters) - 1)
        patch = np.zeros((height, width), np.uint8)
        y = 0
        for letter in letters:
            x = (width - letter.shape[1]) // 2
            patch[y:y + letter.shape[0], x:x + letter.shape[1]] = letter
            y += letter.shape[0] + int(round(gap))
        return patch
    rank_ink = _text_ink(text_or_letters, font_path, RANK_H * FACE_H * scale, max_width=INDEX_MAX_W * FACE_W)
    pip_ink = _pip_ink(suit, PIP_H * FACE_H * scale)
    width = max(rank_ink.shape[1], pip_ink.shape[1])
    top = rank_ink.shape[0] + int(round(gap))
    patch = np.zeros((top + pip_ink.shape[0], width), np.uint8)
    rank_x = (width - rank_ink.shape[1]) // 2
    pip_x = (width - pip_ink.shape[1]) // 2
    patch[0:rank_ink.shape[0], rank_x:rank_x + rank_ink.shape[1]] = rank_ink
    patch[top:, pip_x:pip_x + pip_ink.shape[1]] = pip_ink
    return patch


def _draw_art(face, rng, x0, y0, x1, y1, base):
    """Random picture-card art: a coloured field with blobs and lines, and a thin frame."""
    field = tuple(int(v) for v in rng.integers(ART_FIELD[0], ART_FIELD[1], 3))
    cv2.rectangle(face, (x0, y0), (x1, y1), field, -1)
    for _ in range(int(rng.integers(3, 7))):
        centre = (int(rng.integers(x0, x1)), int(rng.integers(y0, y1)))
        axes = (int(rng.integers(10, max(11, (x1 - x0) // 3))), int(rng.integers(10, max(11, (y1 - y0) // 4))))
        colour = ART_COLOURS[int(rng.integers(len(ART_COLOURS)))]
        cv2.ellipse(face, centre, axes, float(rng.uniform(0, 180)), 0, 360, colour, -1)
    for _ in range(int(rng.integers(2, 5))):
        start = (int(rng.integers(x0, x1)), int(rng.integers(y0, y1)))
        end = (int(rng.integers(x0, x1)), int(rng.integers(y0, y1)))
        colour = ART_COLOURS[int(rng.integers(len(ART_COLOURS)))]
        cv2.line(face, start, end, colour, int(rng.integers(3, 10)))
    cv2.rectangle(face, (x0 + 6, y0 + 6), (x1 - 6, y1 - 6), (20, 20, 20), 2)


def mirror_box(box):
    """The same box in a face rotated 180 degrees."""
    x0, y0, x1, y1 = box
    return (FACE_W - x1, FACE_H - y1, FACE_W - x0, FACE_H - y0)


def render_face(code, rng):
    """(face BGR uint8 FACE_H x FACE_W, top-left index box (x0, y0, x1, y1)) for one card code."""
    base = int(rng.integers(230, 253))
    face = np.full((FACE_H, FACE_W, 3), base, np.uint8)
    rank, suit = (code, 'J') if code == JOKER else (code[:-1], code[-1])
    red = suit in 'HD' if code != JOKER else bool(rng.integers(2))
    colour_base = (40, 40, 200) if red else (25, 25, 25)
    colour = tuple(int(v) for v in np.clip(np.array(colour_base) + rng.uniform(-20, 20, 3), 0, 255))
    font_path = AVAILABLE_FONTS[int(rng.integers(len(AVAILABLE_FONTS)))] if AVAILABLE_FONTS else None

    if code == JOKER:
        _draw_art(face, rng, int(0.25 * FACE_W), int(0.3 * FACE_H), int(0.75 * FACE_W), int(0.7 * FACE_H), base)
    elif rank in ('J', 'Q', 'K'):
        _draw_art(face, rng, int(0.18 * FACE_W), int(0.12 * FACE_H), int(0.82 * FACE_W), int(0.88 * FACE_H), base)
    else:
        suit_colour = colour
        if rank == 'A':
            pip = _pip_ink(suit, 0.28 * FACE_H)
            _paste(face, pip, int(0.5 * FACE_W - pip.shape[1] / 2), int(0.5 * FACE_H - pip.shape[0] / 2), suit_colour)
        else:
            for fx, fy in PIP_LAYOUT[int(rank)]:
                pip = _pip_ink(suit, 0.085 * FACE_H * float(rng.uniform(0.95, 1.05)))
                _paste(face, pip, int(fx * FACE_W - pip.shape[1] / 2), int(fy * FACE_H - pip.shape[0] / 2), suit_colour)

    # Keep the corners clean so the indices are the only ink there (art may reach into them).
    cv2.rectangle(face, (0, 0), (int(0.26 * FACE_W), int(0.27 * FACE_H)), (base, base, base), -1)
    cv2.rectangle(face, (FACE_W - int(0.26 * FACE_W), FACE_H - int(0.27 * FACE_H)), (FACE_W, FACE_H), (base, base, base), -1)

    scale = float(rng.uniform(0.87, 1.15))
    patch = _index_patch(JOKER if code == JOKER else rank, suit, font_path, scale)
    jitter_x = rng.uniform(-INDEX_JITTER, INDEX_JITTER) * FACE_H
    jitter_y = rng.uniform(-INDEX_JITTER, INDEX_JITTER) * FACE_H
    x = int(round(INDEX_CX * FACE_H - patch.shape[1] / 2 + jitter_x))
    y = int(round(INDEX_TOP * FACE_H + jitter_y))
    _paste(face, patch, x, y, colour)
    # The bottom-right index is the top-left patch turned 180 degrees, in the mirrored place.
    _paste(face, patch[::-1, ::-1], FACE_W - x - patch.shape[1], FACE_H - y - patch.shape[0], colour)
    tl_box = (x, y, x + patch.shape[1], y + patch.shape[0])

    grain = rng.integers(0, 5, face.shape, dtype=np.uint8)  # speckle of 0..4, centred on 2 below
    face = cv2.subtract(cv2.add(face, grain), np.full(face.shape, 2, np.uint8))
    return face, tl_box
