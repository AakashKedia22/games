"""Count cards from corner-index detections. Pure numpy: no torch, no OpenCV.

Units: the card height is 1. A detection is a dict with
  'centre'  (x, y) of the index box, in photo pixels
  'box'     (x0, y0, x1, y1) of the index box, in photo pixels
  'score'   detector score
  'probs'   53 class probabilities, in classes.CODES order
  'code'    the most likely card code
  'phi'     index angle in degrees (0 = upright, clockwise positive; see corner_models)
"""
import json
import math
import os
from itertools import combinations

import numpy as np

from classes import CODES, JOKER, MAX_COPIES

# Defaults measured on the test deck; geometry.json from deck capture overrides the card ones.
CARD_ASPECT = 0.70        # width / height
INDEX_CX = 0.115          # index-box centre from the card's left edge, in card heights
INDEX_CY = 0.14           # ... from the top edge
INDEX_H = 0.22            # index-box height (rank + pip), in card heights
JOKER_CY = 0.20           # printed joker: 'JOKER' written vertically
JOKER_H = 0.34
MERGE_TOL = 0.12          # centres closer than this (card heights) can be one card
AMBIGUOUS_TOL = 0.08      # a merge between 0.08 and 0.12 is flagged Check
CALIBRATE_GAP = 0.40      # calibration pairs: centres this close (card heights) with the height as first estimated
CALIBRATE_RATIO = (0.7, 1.6)  # accepted card-height corrections: the first estimate may be 40 % low or 30 % high
RELAXED_TOL = 0.25        # used only to bring a code back under the copy limit
OPPOSITE_DOT = -0.8       # up vectors this opposite (about 37 degrees of slack)
CROSS_CODE_TOL = 0.08     # two different codes may merge only this tightly and only if one is in the other's top 3
LOW_DETECT_SCORE = 0.6    # detections below this are flagged Check
MIN_DETECT_SCORE = 0.4    # below this they are dropped
INDEX_ASPECT = 0.40       # index width / height (rank + pip); the printed joker is narrower
JOKER_ASPECT = 0.20
ORIENT_SLACK = 6.0         # degrees: "near 0, 90, 180 or 270", where a box side is the index length to within 4 percent

GEOMETRY_FILE_KEYS = ('card_aspect', 'index_cx', 'index_cy', 'index_h', 'joker_cy', 'joker_h')


def default_geometry():
    return {
        'card_aspect': CARD_ASPECT, 'index_cx': INDEX_CX, 'index_cy': INDEX_CY, 'index_h': INDEX_H,
        'joker_cy': JOKER_CY, 'joker_h': JOKER_H, 'merge_tol': MERGE_TOL, 'ambiguous_tol': AMBIGUOUS_TOL,
        'relaxed_tol': RELAXED_TOL, 'opposite_dot': OPPOSITE_DOT, 'cross_code_tol': CROSS_CODE_TOL,
        'low_score': LOW_DETECT_SCORE, 'min_score': MIN_DETECT_SCORE, 'max_copies': MAX_COPIES,
    }


def load_geometry(path=None):
    """The constants above, with the card keys overridden by geometry.json when that file exists."""
    geo = default_geometry()
    if path and os.path.exists(path):
        with open(path) as handle:
            data = json.load(handle)
        for key in GEOMETRY_FILE_KEYS:
            if key in data:
                geo[key] = float(data[key])
    return geo


def _vectors(phi_deg):
    """(r, u): the card's right and up directions in image coordinates (y down)."""
    phi = math.radians(phi_deg)
    return np.array([math.cos(phi), math.sin(phi)]), np.array([math.sin(phi), -math.cos(phi)])


def _index_offset(code, geo):
    """(cx, cy): the card centre relative to its index centre, in card heights, in the card's own frame."""
    cy_index = geo['joker_cy'] if code == JOKER else geo['index_cy']
    return geo['card_aspect'] / 2 - geo['index_cx'], 0.5 - cy_index


def _index_unit(det, geo):
    return geo['joker_h'] if det['code'] == JOKER else geo['index_h']


def _index_length(det):
    """The index's length along its own up axis, in photo pixels. Near 0/90/180/270 degrees it is a side of the box;
    at other angles the box is the bounding box of the turned index, so the length is solved from both its sides."""
    x0, y0, x1, y1 = det['box']
    phi = det['phi'] % 180
    if min(phi, 180 - phi) <= ORIENT_SLACK:
        return y1 - y0
    if abs(phi - 90) <= ORIENT_SLACK:
        return x1 - x0
    aspect = JOKER_ASPECT if det['code'] == JOKER else INDEX_ASPECT
    angle = math.radians(phi)
    return ((x1 - x0) + (y1 - y0)) / ((1 + aspect) * (abs(math.cos(angle)) + abs(math.sin(angle))))


def estimate_card_height(dets, geo):
    """Card height in photo pixels from the index sizes, or None without detections."""
    if not dets:
        return None
    return float(np.median([_index_length(det) / _index_unit(det, geo) for det in dets]))


def card_centre(det, Hpx, geo):
    """Where this index says its card's centre is, in photo pixels."""
    r, u = _vectors(det['phi'])
    cx, cy = _index_offset(det['code'], geo)
    return np.asarray(det['centre'], dtype=float) + r * cx * Hpx - u * cy * Hpx


def calibrate(dets, Hpx, geo):
    """Correct the card height from pairs of indices that belong to one card (same code, opposite up)."""
    ratios = []
    for a, b in combinations(dets, 2):
        if a['code'] != b['code'] or float(np.dot(_vectors(a['phi'])[1], _vectors(b['phi'])[1])) >= geo['opposite_dot']:
            continue
        gap = np.linalg.norm(card_centre(a, Hpx, geo) - card_centre(b, Hpx, geo))
        if gap >= CALIBRATE_GAP * Hpx:
            continue
        cx, cy = _index_offset(a['code'], geo)
        expected = Hpx * math.hypot(2 * cx, 2 * cy)
        ratio = np.linalg.norm(np.asarray(b['centre'], float) - np.asarray(a['centre'], float)) / expected
        if CALIBRATE_RATIO[0] <= ratio <= CALIBRATE_RATIO[1]:
            ratios.append(ratio)
    return Hpx * float(np.median(ratios)) if ratios else Hpx


def _top_codes(probs):
    return {CODES[k] for k in np.argsort(-np.asarray(probs))[:3]}


def _card(members, dets, centres, Hpx, reasons=()):
    probs = sum(np.asarray(dets[m]['probs'], float) for m in members)
    probs = probs / probs.sum()
    best = max(members, key=lambda m: dets[m]['score'])
    return {
        'code': CODES[int(np.argmax(probs))] if len(members) > 1 else dets[members[0]]['code'],
        'probs': probs,
        'members': list(members),
        'centre': np.mean([centres[m] for m in members], axis=0),
        'phi': dets[best]['phi'],
        'hpx': Hpx,
        'check': bool(reasons),
        'reasons': list(dict.fromkeys(reasons)),
    }


def _merge_cards(first, second, dets, centres, Hpx, reasons):
    return _card(first['members'] + second['members'], dets, centres, Hpx, reasons)


def _limit_copies(cards, dets, centres, Hpx, geo):
    """Keep each code at most max_copies cards: merge the cheapest opposite single pair within relaxed_tol,
    else flag every card of that code as 'copies'."""
    for code in CODES:
        while sum(card['code'] == code for card in cards) > geo['max_copies']:
            singles = [i for i, card in enumerate(cards) if card['code'] == code and len(card['members']) == 1]
            best = None
            for a, b in combinations(singles, 2):
                pa, pb = cards[a], cards[b]
                if float(np.dot(_vectors(pa['phi'])[1], _vectors(pb['phi'])[1])) >= geo['opposite_dot']:
                    continue
                cost = np.linalg.norm(pa['centre'] - pb['centre']) / Hpx
                if cost < geo['relaxed_tol'] and (best is None or cost < best[0]):
                    best = (cost, a, b)
            if best is None:
                for card in cards:
                    if card['code'] == code:
                        card['reasons'] = list(dict.fromkeys(card['reasons'] + ['copies']))
                        card['check'] = True
                break
            _, a, b = best
            merged = _merge_cards(cards[a], cards[b], dets, centres, Hpx, ['copies', 'ambiguous'])
            cards = [card for i, card in enumerate(cards) if i not in (a, b)] + [merged]
    return cards


def _reading_order(cards, Hpx):
    """Rows top to bottom (row gap = half a card height), then left to right, as detect._reading_order does."""
    if not cards:
        return cards
    centres = [card['centre'] for card in cards]
    order = sorted(range(len(cards)), key=lambda i: centres[i][1])
    rows, current, last_y = [], [], None
    for i in order:
        y = centres[i][1]
        if last_y is not None and y - last_y > Hpx / 2:
            rows.append(current)
            current = []
        current.append(i)
        last_y = y
    rows.append(current)
    return [cards[i] for row in rows for i in sorted(row, key=lambda i: centres[i][0])]


def group_cards(dets, geo):
    """Group index detections into cards, in reading order. Each card:
    {'code', 'probs', 'members' (indices into the kept detections), 'centre', 'phi', 'hpx', 'check', 'reasons'}."""
    dets = [dict(det, centre=np.asarray(det['centre'], float)) for det in dets if det['score'] >= geo['min_score']]
    Hpx = estimate_card_height(dets, geo) if dets else None
    if Hpx is None:
        return []
    Hpx = calibrate(dets, Hpx, geo)
    centres = [card_centre(det, Hpx, geo) for det in dets]
    ups = [_vectors(det['phi'])[1] for det in dets]

    candidates = []
    valid = [0] * len(dets)
    for i, j in combinations(range(len(dets)), 2):
        if float(np.dot(ups[i], ups[j])) >= geo['opposite_dot']:
            continue
        cost = float(np.linalg.norm(centres[i] - centres[j])) / Hpx
        same = dets[i]['code'] == dets[j]['code']
        if same:
            ok = cost < geo['merge_tol']
        else:
            ok = cost < geo['cross_code_tol'] and (
                dets[j]['code'] in _top_codes(dets[i]['probs']) or dets[i]['code'] in _top_codes(dets[j]['probs']))
        if ok:
            candidates.append((cost, i, j, same))
            valid[i] += 1
            valid[j] += 1
    candidates.sort(key=lambda item: item[0])

    used = set()
    cards = []
    for cost, i, j, same in candidates:
        if i in used or j in used:
            continue
        used.update((i, j))
        reasons = []
        if geo['ambiguous_tol'] <= cost or not same or valid[i] >= 2 or valid[j] >= 2:
            reasons.append('ambiguous')
        cards.append(_card([i, j], dets, centres, Hpx, reasons))
    for k in range(len(dets)):
        if k not in used:
            cards.append(_card([k], dets, centres, Hpx))

    cards = _limit_copies(cards, dets, centres, Hpx, geo)
    for card in cards:
        if any(dets[m]['score'] < geo['low_score'] for m in card['members']):
            card['reasons'] = list(dict.fromkeys(card['reasons'] + ['low-score']))
        card['check'] = bool(card['reasons'])
    return _reading_order(cards, Hpx)


def card_quad(card, Hpx, geo):
    """The four corners of the card's estimated outline, in photo pixels: top-left, top-right, bottom-right, bottom-left."""
    r, u = _vectors(card['phi'])
    half_w = geo['card_aspect'] / 2 * Hpx * r
    half_h = 0.5 * Hpx * u
    centre = np.asarray(card['centre'], float)
    return np.array([centre - half_w + half_h, centre + half_w + half_h,
                     centre + half_w - half_h, centre - half_w - half_h])
