"""Capture your own deck from five photos: its real card faces and index boxes, for training.

usage: capture_deck.py --deck NAME S=photo H=photo D=photo C=photo JK=photo [--out vision/datasets/deck]

Photo rules: each suit photo has its 13 cards of that suit laid apart, A,2,...,10,J,Q,K in reading
order (rows of 5, 5, 3), on a plain dark cloth. The JK photo has 1 to 3 jokers.

Writes <out>/<deck>/faces/<code>.png (JK_1.png, JK_2.png, ...), boxes.json, geometry.json and
check.jpg (a contact sheet with every index box, to look at once).
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

from cards_render import FACE_H, FACE_W
from classes import JOKER, RANKS, SUITS
from detect import find_cards_with_edges, warp_card
from geometry import INDEX_CX, INDEX_CY, INDEX_H, JOKER_CY, JOKER_H
from photo_io import load_photo

PHOTO_KEYS = tuple(SUITS) + (JOKER,)
SUIT_CARDS = 13
CHECK_CELL = (140, 200)


def _sheet_label(name):
    return name.split('_')[0]


def _write_problem(image, cards, path):
    """Outline each detected card with its reading-order number, so the player can see what went wrong."""
    scale = min(1.0, 1600 / max(image.shape[:2]))
    canvas = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image.copy()
    for number, card in enumerate(cards, start=1):
        corners = (card['corners'] * scale).astype(np.int32)
        cv2.polylines(canvas, [corners], True, (0, 200, 0), 4)
        centre = corners.mean(axis=0).astype(int)
        cv2.putText(canvas, str(number), (int(centre[0]) - 20, int(centre[1]) + 15), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 4)
    cv2.imwrite(path, canvas)


def capture_photo(image, key, problem_path=None):
    """[(code, face)] for one photo, in reading order. Suit photos need exactly 13 cards; the joker photo needs at least 1.
    Raises ValueError (and writes problem_path with the numbered outlines, when given) if the count is wrong."""
    cards, _ = find_cards_with_edges(image)
    if key == JOKER:
        ok = len(cards) >= 1
        expected = 'at least 1'
    else:
        ok = len(cards) == SUIT_CARDS
        expected = str(SUIT_CARDS)
    if not ok:
        if problem_path:
            _write_problem(image, cards, problem_path)
        message = f'{key} photo: found {len(cards)} cards, expected {expected}.'
        message += (f' Lay them apart on a dark plain cloth; see {os.path.basename(problem_path)}.' if problem_path
                    else ' Lay them apart on a dark plain cloth.')
        raise ValueError(message)
    faces = []
    for index, card in enumerate(cards):
        face = warp_card(image, card['corners'], size=(FACE_W, FACE_H))
        code = JOKER if key == JOKER else RANKS[index] + key
        faces.append((code, face))
    return faces


def find_index_box(face, joker=False):
    """The index box (x0, y0, x1, y1) in a card face's top-left corner, from the ink there; None if it fails the size check."""
    height, width = face.shape[:2]
    region = face[:int(0.55 * height), :int(0.20 * width)] if joker else face[:int(0.38 * height), :int(0.24 * width)]
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    ink = ((gray < 140) | ((hsv[:, :, 1] > 90) & (hsv[:, :, 2] < 235))).astype(np.uint8) * 255
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    min_area = 0.00005 * height * width
    max_top = (0.50 if joker else 0.30) * height
    boxes = []
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if area >= min_area and x < 0.16 * width and y < max_top:
            boxes.append((int(x), int(y), int(x + w), int(y + h)))
    if not boxes:
        return None
    x0 = min(box[0] for box in boxes)
    y0 = min(box[1] for box in boxes)
    x1 = max(box[2] for box in boxes)
    y1 = max(box[3] for box in boxes)
    low, high = (0.20, 0.60) if joker else (0.12, 0.35)
    if not (low * height <= y1 - y0 <= high * height and 0.04 * width <= x1 - x0 <= 0.25 * width):
        return None
    return (x0, y0, x1, y1)


def _median_box(boxes):
    return tuple(int(round(value)) for value in np.median(np.array(boxes, dtype=float), axis=0))


def measure(faces):
    """[(name, code, face, tl_box, br_box)] for every captured face. br_box is in the 180-degree rotated face,
    and a box that cannot be read takes the median box of the faces of the same kind (suit or joker)."""
    records = []
    for name, code, face in faces:
        joker = code == JOKER
        tl = find_index_box(face, joker)
        br = find_index_box(cv2.rotate(face, cv2.ROTATE_180), joker)
        records.append([name, code, face, tl, br, joker])
    for joker in (False, True):
        group = [record for record in records if record[5] == joker]
        for slot, index in (('tl', 3), ('br', 4)):
            known = [record[index] for record in group if record[index] is not None]
            for record in group:
                if record[index] is None:
                    if not known:
                        raise ValueError(f'{record[0]}: no index box found in the photo.')
                    record[index] = _median_box(known)
                    print(f'{record[0]}: index box from the deck median ({slot})', flush=True)
    return [tuple(record[:5]) for record in records]


def geometry_from(records):
    """Card geometry from the measured top-left boxes (fractions of the face height), as geometry.json.
    records: [(name, code, face, tl_box, br_box)]."""
    numbers = [record[3] for record in records if record[1] != JOKER]
    jokers = [record[3] for record in records if record[1] == JOKER]
    geometry = {'card_aspect': FACE_W / FACE_H}
    centres_x = [(box[0] + box[2]) / 2 / FACE_H for box in numbers]
    centres_y = [(box[1] + box[3]) / 2 / FACE_H for box in numbers]
    heights = [(box[3] - box[1]) / FACE_H for box in numbers]
    geometry['index_cx'] = float(np.median(centres_x)) if numbers else INDEX_CX
    geometry['index_cy'] = float(np.median(centres_y)) if numbers else INDEX_CY
    geometry['index_h'] = float(np.median(heights)) if numbers else INDEX_H
    if jokers:
        geometry['joker_cy'] = float(np.median([(box[1] + box[3]) / 2 / FACE_H for box in jokers]))
        geometry['joker_h'] = float(np.median([(box[3] - box[1]) / FACE_H for box in jokers]))
    else:
        geometry['joker_cy'] = JOKER_CY
        geometry['joker_h'] = JOKER_H
    return geometry


def contact_sheet(records, columns=13):
    """Every face at 140 x 200 with its index box drawn and its code underneath."""
    cell_w, cell_h = CHECK_CELL
    cells = []
    for name, code, face, tl, _ in records:
        small = cv2.resize(face, CHECK_CELL, interpolation=cv2.INTER_AREA)
        scale_x, scale_y = cell_w / FACE_W, cell_h / FACE_H
        if tl is not None:
            x0, y0, x1, y1 = tl
            cv2.rectangle(small, (int(x0 * scale_x), int(y0 * scale_y)), (int(x1 * scale_x), int(y1 * scale_y)), (0, 200, 0), 2)
        cell = np.full((cell_h + 24, cell_w, 3), 255, np.uint8)
        cell[:cell_h] = small
        cv2.putText(cell, _sheet_label(name), (4, cell_h + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 200), 2)
        cells.append(cell)
    rows = math.ceil(len(cells) / columns)
    sheet = np.full((rows * (cell_h + 24), columns * cell_w, 3), 255, np.uint8)
    for index, cell in enumerate(cells):
        row, column = divmod(index, columns)
        sheet[row * (cell_h + 24):(row + 1) * (cell_h + 24), column * cell_w:(column + 1) * cell_w] = cell
    return sheet


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--deck', required=True, help='name for this deck, e.g. main')
    parser.add_argument('--out', default='vision/datasets/deck')
    parser.add_argument('photos', nargs='+', metavar='KEY=PHOTO', help='S= H= D= C= JK= photo paths')
    args = parser.parse_args(argv)
    photos = {}
    for item in args.photos:
        key, _, path = item.partition('=')
        if key not in PHOTO_KEYS or not path:
            parser.error(f'expected KEY=PHOTO with KEY one of {", ".join(PHOTO_KEYS)}, got {item!r}')
        photos[key] = path
    missing = [key for key in PHOTO_KEYS if key not in photos]
    if missing:
        parser.error(f'missing photo(s): {", ".join(missing)}')

    deck_dir = os.path.join(args.out, args.deck)
    faces_dir = os.path.join(deck_dir, 'faces')
    os.makedirs(faces_dir, exist_ok=True)
    faces = []
    try:
        for key in PHOTO_KEYS:
            image = load_photo(photos[key])
            captured = capture_photo(image, key, problem_path=os.path.join(deck_dir, f'problem_{key}.jpg'))
            for index, (code, face) in enumerate(captured, start=1):
                name = f'JK_{index}' if code == JOKER else code
                cv2.imwrite(os.path.join(faces_dir, name + '.png'), face)
                faces.append((name, code, face))
            print(f'{key}: {len(captured)} cards', flush=True)
        records = measure(faces)
    except ValueError as error:
        sys.exit(str(error))

    boxes = {name: {'tl': list(tl), 'br': list(br)} for name, _, _, tl, br in records}
    with open(os.path.join(deck_dir, 'boxes.json'), 'w') as handle:
        json.dump(boxes, handle, indent=2)
    with open(os.path.join(deck_dir, 'geometry.json'), 'w') as handle:
        json.dump(geometry_from(records), handle, indent=2)
    cv2.imwrite(os.path.join(deck_dir, 'check.jpg'), contact_sheet(records))
    print(f'Saved {len(records)} faces to {faces_dir}. Look at {os.path.join(deck_dir, "check.jpg")}.', flush=True)
    return deck_dir


if __name__ == '__main__':
    main()
