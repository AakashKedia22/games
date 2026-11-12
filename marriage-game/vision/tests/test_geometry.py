import json
import math

import numpy as np
import pytest

import geometry as g
from classes import CODES

H = 300.0  # card height in photo pixels for these tests
W = g.CARD_ASPECT * H


def index_at(centre, phi, code='3H', Hpx=H):
    """Where the index box centre sits for a card centred at `centre` with up angle `phi`. Inverse of card_centre."""
    geo = g.default_geometry()
    r, u = g._vectors(phi)
    cx, cy = g._index_offset(code, geo)
    return np.asarray(centre, float) - r * cx * Hpx + u * cy * Hpx


def det(code, pos, phi, Hpx=H, others=None, score=0.9):
    """A detection with a box of index size, and probabilities 0.9 on the code, 0.05 on each of two others."""
    tall = g.INDEX_H * Hpx
    wide = 0.45 * tall
    if abs(phi % 180 - 90) <= 20:
        w, h = tall, wide
    else:
        w, h = wide, tall
    x, y = pos
    if others is None:
        others = [c for c in CODES if c != code][:2]
    probs = np.zeros(len(CODES))
    probs[CODES.index(code)] = 0.9
    for other in others:
        probs[CODES.index(other)] = 0.05
    return {'centre': (x, y), 'box': (x - w / 2, y - h / 2, x + w / 2, y + h / 2), 'score': score,
            'probs': probs, 'code': code, 'phi': phi}


GEO = g.default_geometry()


def test_one_card_with_both_indices_is_one_card():
    centre = (1000.0, 1000.0)
    dets = [det('3H', index_at(centre, 0), 0), det('3H', index_at(centre, 180), 180)]
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 1
    assert len(cards[0]['members']) == 2
    assert cards[0]['check'] is False
    np.testing.assert_allclose(cards[0]['centre'], centre, atol=1)


def test_identical_pair_offset_is_two_cards():
    c1 = (1000.0, 1000.0)
    c2 = (c1[0] + 0.3 * W, c1[1])
    dets = [det('3H', index_at(c1, 0), 0), det('3H', index_at(c1, 180), 180),
            det('3H', index_at(c2, 0), 0), det('3H', index_at(c2, 180), 180)]
    assert len(g.group_cards(dets, GEO)) == 2


def test_identical_pair_with_one_top_left_index_missing_is_two_cards():
    c1 = (1000.0, 1000.0)
    c2 = (c1[0] + 0.3 * W, c1[1])
    dets = [det('3H', index_at(c1, 0), 0), det('3H', index_at(c1, 180), 180), det('3H', index_at(c2, 180), 180)]
    assert len(g.group_cards(dets, GEO)) == 2


def test_strip_of_three_identical_cards_is_three_cards():
    dets = []
    for k in range(3):
        centre = (1000.0 + k * 0.25 * W, 1000.0)
        dets.append(det('5H', index_at(centre, 0, '5H'), 0))
    top = (1000.0 + 2 * 0.25 * W, 1000.0)
    dets.append(det('5H', index_at(top, 180, '5H'), 180))
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 3


def test_two_opposite_cards_three_heights_apart_are_two_cards():
    centre = (1000.0, 1000.0)
    far = (1000.0, 1000.0 + 3 * H)
    dets = [det('7C', index_at(centre, 0, '7C'), 0), det('7C', index_at(far, 180, '7C'), 180)]
    assert len(g.group_cards(dets, GEO)) == 2


def test_rotated_fan_of_nine_is_nine_cards():
    pivot = np.array([1000.0, 1000.0 + 0.8 * H])
    dets = []
    for k in range(9):
        phi = -40.0 + 10.0 * k
        rot = np.array([[math.cos(math.radians(phi)), -math.sin(math.radians(phi))],
                        [math.sin(math.radians(phi)), math.cos(math.radians(phi))]])
        centre = pivot + rot @ np.array([0.0, -0.8 * H])
        code = CODES[k]
        if phi == 0:
            dets.append(det(code, index_at(centre, 0, code), 0))
        dets.append(det(code, index_at(centre, 180 + phi, code), 180 + phi))
    assert len(dets) == 10
    assert len(g.group_cards(dets, GEO)) == 9


def test_strip_fan_of_fifteen_different_cards_is_fifteen_cards():
    dets = [det(CODES[k], index_at((500.0 + k * 0.25 * W, 500.0), 0, CODES[k]), 0) for k in range(15)]
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 15
    assert all(card['check'] is False for card in cards)


def test_more_than_three_copies_are_flagged():
    dets = [det('7C', index_at((200.0 + k * 600.0, 300.0), 0, '7C'), 0) for k in range(4)]
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 4
    for card in cards:
        assert card['check'] is True
        assert 'copies' in card['reasons']


def test_relaxed_merge_brings_a_code_back_under_the_copy_limit():
    a = det('7C', index_at((1000.0, 500.0), 0, '7C'), 0)
    b = det('7C', index_at((1000.0, 500.0 + 0.2 * H), 180, '7C'), 180)
    others = [det('7C', index_at((200.0, 1200.0), 0, '7C'), 0), det('7C', index_at((1600.0, 1200.0), 0, '7C'), 0)]
    cards = g.group_cards([a, b] + others, GEO)
    assert len(cards) == 3
    merged = [card for card in cards if len(card['members']) == 2]
    assert len(merged) == 1 and merged[0]['check'] is True


def test_cross_code_misread_merges_and_is_flagged():
    centre = (1000.0, 1000.0)
    nine = det('9D', index_at(centre, 0, '9D'), 0, others=['6D', 'AS'])
    six = det('6D', index_at(centre, 180, '6D'), 180, others=['9D', 'AS'])
    cards = g.group_cards([nine, six], GEO)
    assert len(cards) == 1
    assert cards[0]['check'] is True
    assert 'ambiguous' in cards[0]['reasons']


def test_card_height_estimate_and_calibration():
    coords = [(500.0, 400.0), (900.0, 400.0), (1300.0, 400.0)]
    upright = []
    for k, centre in enumerate(coords):
        code = CODES[k]
        upright.append(det(code, index_at(centre, 0, code), 0))
        upright.append(det(code, index_at(centre, 180, code), 180))
    assert g.estimate_card_height(upright, GEO) == pytest.approx(H, rel=0.02)

    # The layout is 10 % bigger than the index boxes say: calibration corrects the card height.
    scaled = []
    for k, centre in enumerate(coords):
        code = CODES[k]
        scaled.append(det(code, index_at(centre, 0, code, Hpx=1.1 * H), 0))
        scaled.append(det(code, index_at(centre, 180, code, Hpx=1.1 * H), 180))
    estimate = g.estimate_card_height(scaled, GEO)
    assert estimate == pytest.approx(H, rel=0.02)
    assert g.calibrate(scaled, estimate, GEO) == pytest.approx(1.1 * H, rel=0.02)


def test_card_quad_and_reading_order():
    centre = np.array([500.0, 400.0])
    card = {'centre': centre, 'phi': 0.0}
    quad = g.card_quad(card, H, GEO)
    assert quad.shape == (4, 2)
    np.testing.assert_allclose(quad.mean(axis=0), centre, atol=1)
    assert quad[0][0] < centre[0] and quad[0][1] < centre[1]  # top-left first

    spots = [(x, y) for y in (900.0, 300.0) for x in (1300.0, 300.0, 800.0)]  # shuffled on purpose
    dets = [det(CODES[k], index_at(spot, 0, CODES[k]), 0) for k, spot in enumerate(spots)]
    cards = g.group_cards(dets, GEO)
    got = [tuple(np.round(card['centre']).astype(int)) for card in cards]
    expected = [(300, 300), (800, 300), (1300, 300), (300, 900), (800, 900), (1300, 900)]
    assert got == expected


def test_geometry_json_overrides_the_card_constants(tmp_path):
    path = tmp_path / 'geometry.json'
    path.write_text(json.dumps({'index_h': 0.25, 'joker_h': 0.4}))
    loaded = g.load_geometry(str(path))
    assert loaded['index_h'] == 0.25 and loaded['joker_h'] == 0.4
    assert loaded['card_aspect'] == g.CARD_ASPECT
    assert g.load_geometry(str(tmp_path / 'missing.json')) == g.default_geometry()


def tilted_det(code, centre, phi, Hpx=H):
    """A detection whose box is the bounding box of the index turned by phi (what the detector is trained on)."""
    geo = g.default_geometry()
    tall = geo['index_h'] * Hpx
    wide = g.INDEX_ASPECT * tall
    angle = math.radians(phi)
    bw = wide * abs(math.cos(angle)) + tall * abs(math.sin(angle))
    bh = wide * abs(math.sin(angle)) + tall * abs(math.cos(angle))
    x, y = index_at(centre, phi, code, Hpx)
    probs = np.zeros(len(CODES))
    probs[CODES.index(code)] = 1.0
    return {'centre': (x, y), 'box': (x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2), 'score': 0.9,
            'probs': probs, 'code': code, 'phi': phi}


@pytest.mark.parametrize('phi', [0, 25, 32, 45, 58, 70, 110, 135, 150, 200, 300])
def test_card_height_from_a_tilted_index_box(phi):
    assert g.estimate_card_height([tilted_det('6C', (800.0, 600.0), phi)], GEO) == pytest.approx(H, rel=0.02)


@pytest.mark.parametrize('phi', [32, 45, 120, 328])
def test_a_tilted_card_with_both_indices_is_one_card(phi):
    centre = (900.0, 700.0)
    dets = [tilted_det('6C', centre, phi), tilted_det('6C', centre, phi + 180)]
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 1 and len(cards[0]['members']) == 2


def test_both_indices_merge_when_the_index_boxes_understate_the_card_height_by_a_third():
    """Index boxes 30 % small (the card is bigger than the default index size says) still calibrate and merge."""
    scale = 1.4
    dets = []
    for k, centre in enumerate([(500.0, 400.0), (1000.0, 800.0)]):
        code = CODES[k]
        dets.append(det(code, index_at(centre, 0, code, Hpx=scale * H), 0))
        dets.append(det(code, index_at(centre, 180, code, Hpx=scale * H), 180))
    cards = g.group_cards(dets, GEO)
    assert len(cards) == 2 and all(len(card['members']) == 2 for card in cards)


def test_synthetic_scenes_with_perfect_detections_are_counted_exactly():
    """End to end on synth.make_scene: ground-truth boxes, angles and codes in, the true cards out (piles and fans included)."""
    import synth

    for seed in range(6):
        image, annotations = synth.make_scene(np.random.default_rng(seed), [])
        truth = {}
        for annotation in annotations:
            truth[annotation['card']] = annotation['code']
        dets = []
        for annotation in annotations:
            x0, y0, x1, y1 = annotation['box']
            probs = np.zeros(len(CODES))
            probs[CODES.index(annotation['code'])] = 1.0
            dets.append({'centre': ((x0 + x1) / 2, (y0 + y1) / 2), 'box': (x0, y0, x1, y1), 'score': 0.95,
                         'probs': probs, 'code': annotation['code'], 'phi': annotation['phi']})
        cards = g.group_cards(dets, GEO)
        assert sorted(card['code'] for card in cards) == sorted(truth.values()), seed
