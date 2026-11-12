"""Score the recognizer on real photos against truth lists, and draw overlays to check the boxes by eye.

usage: evaluate.py [--models vision/models] [--out data/vision/eval/out] [--strict] CASE [CASE ...]
CASE = truth.json  (the photo is its "photo" key; a relative path is taken from the truth file's folder)
     | photo:truth.json
A truth file is {"photo": "~/Downloads/IMG_4641.HEIC", "cards": ["3H", "3H", "JK", ...]}.

Prints, per photo, how many cards were found and how many match the truth, then a total.
With --strict the exit code is 1 when any photo is not fully correct.
"""
import argparse
import json
import os
import sys
import tempfile
from collections import Counter

import cv2
import numpy as np

from classes import CODES
from photo_io import load_photo
from recognize import Recognizer

OVERLAY_LONG_SIDE = 1600


def _code_order(code):
    return CODES.index(code) if code in CODES else len(CODES)


def compare(expected, got):
    """{'correct', 'missing', 'extra'}: a multiset comparison, with the lists in CODES order."""
    expected_counts, got_counts = Counter(expected), Counter(got)
    return {
        'correct': sum((expected_counts & got_counts).values()),
        'missing': sorted((expected_counts - got_counts).elements(), key=_code_order),
        'extra': sorted((got_counts - expected_counts).elements(), key=_code_order),
    }


def load_case(case):
    """(photo path, truth codes, photo name) for a CASE argument."""
    if ':' in case and not os.path.exists(case):
        photo, truth_path = case.rsplit(':', 1)
        photo = os.path.expanduser(photo)
    else:
        truth_path = case
        photo = None
    with open(truth_path) as handle:
        truth = json.load(handle)
    if photo is None:
        photo = os.path.expanduser(truth['photo'])
        if not os.path.isabs(photo):
            photo = os.path.join(os.path.dirname(os.path.abspath(truth_path)), photo)
    return photo, list(truth['cards']), os.path.splitext(os.path.basename(photo))[0]


def draw_overlay(image, overlay, truth_codes, out_path):
    """The photo at OVERLAY_LONG_SIDE with each index box (green: its card is one of the truth, red: not),
    its code and score, its orientation arrow, a line joining the two indices of a merged card, a dot at each
    card centre, and a circle around each card marked Check."""
    height, width = image.shape[:2]
    scale = min(1.0, OVERLAY_LONG_SIDE / max(height, width))
    canvas = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image.copy()
    remaining = Counter(truth_codes)
    card_matches = []
    for card in overlay['cards']:
        matches = remaining[card['code']] > 0
        if matches:
            remaining[card['code']] -= 1
        card_matches.append(matches)

    def point(xy):
        return int(round(xy[0] * scale)), int(round(xy[1] * scale))

    for detection in overlay['detections']:
        colour = (0, 180, 0) if card_matches[detection['card']] else (0, 0, 230)
        x0, y0, x1, y1 = (v * scale for v in detection['box'])
        cv2.rectangle(canvas, (int(x0), int(y0)), (int(x1), int(y1)), colour, 2)
        cv2.putText(canvas, f"{detection['code']} {detection['score']:.2f}", (int(x0), max(12, int(y0) - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1)
        angle = np.radians(detection['phi'])
        centre = point(detection['centre'])
        length = 0.5 * overlay['cards'][detection['card']]['hpx'] * scale
        tip = (int(centre[0] + np.sin(angle) * length), int(centre[1] - np.cos(angle) * length))
        cv2.arrowedLine(canvas, centre, tip, colour, 2, tipLength=0.3)

    for card in overlay['cards']:
        members = [overlay['detections'][index] for index in card['members']]
        if len(members) == 2:
            cv2.line(canvas, point(members[0]['centre']), point(members[1]['centre']), (255, 0, 255), 2)
        centre = point(card['centre'])
        cv2.circle(canvas, centre, 5, (255, 255, 0), -1)
        if card['check']:
            cv2.circle(canvas, centre, int(0.6 * card['hpx'] * scale), (0, 140, 255), 3)
    cv2.imwrite(out_path, canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return out_path


def run_case(recognizer, photo, truth_codes, name, out_dir):
    reply = recognizer.recognize_photo('eval', photo)
    cards = reply['cards']
    result = compare(truth_codes, [card['code'] for card in cards])
    checks = [card for card in cards if card['check']]
    # Flagged cards whose code is left over after matching are the mistakes that were flagged.
    leftover = Counter(result['extra'])
    mistake_checks = 0
    for card in checks:
        if leftover[card['code']] > 0:
            leftover[card['code']] -= 1
            mistake_checks += 1
    print(f'{name}: found {len(cards)} / expected {len(truth_codes)}, correct {result["correct"]}, '
          f'checks {len(checks)} ({mistake_checks} on mistakes)', flush=True)
    print(f'  missing: {" ".join(result["missing"]) or "-"}', flush=True)
    print(f'  extra:   {" ".join(result["extra"]) or "-"}', flush=True)
    if reply.get('overlay') is not None:
        draw_overlay(load_photo(photo), reply['overlay'], truth_codes, os.path.join(out_dir, f'{name}.overlay.jpg'))
    return {'name': name, 'found': len(cards), 'expected': len(truth_codes), 'correct': result['correct'],
            'missing': result['missing'], 'extra': result['extra'], 'checks': len(checks),
            'mistake_checks': mistake_checks,
            'fully_correct': not result['missing'] and not result['extra']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--models', default='vision/models')
    parser.add_argument('--out', default='data/vision/eval/out')
    parser.add_argument('--strict', action='store_true', help='exit 1 unless every photo is fully correct')
    parser.add_argument('cases', nargs='+', metavar='CASE')
    args = parser.parse_args(argv)
    corners = os.path.join(args.models, 'corners.onnx')
    cards = os.path.join(args.models, 'cards.onnx')
    labels = os.path.join(args.models, 'labels.json')
    for path in (corners, cards, labels):
        if not os.path.exists(path):
            parser.error(f'missing {path}: train the models first (npm run vision:train)')
    os.makedirs(args.out, exist_ok=True)

    results = []
    with tempfile.TemporaryDirectory() as pending:
        recognizer = Recognizer(corners, cards, labels, pending)
        for case in args.cases:
            photo, truth_codes, name = load_case(case)
            results.append(run_case(recognizer, photo, truth_codes, name, args.out))
    total_correct = sum(result['correct'] for result in results)
    total_expected = sum(result['expected'] for result in results)
    print(f'TOTAL: correct {total_correct} / {total_expected} over {len(results)} photos', flush=True)
    return results


if __name__ == '__main__':
    argv = sys.argv[1:]
    results = main(argv)
    sys.exit(1 if '--strict' in argv and not all(result['fully_correct'] for result in results) else 0)
