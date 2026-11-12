import cv2
import numpy as np
import pytest

import geometry as g
import synth
from cards_render import FACE_H, FACE_W, render_face
from classes import CODES
from corner_models import index_crop, upright


def test_rendered_faces_have_their_index_in_the_top_left_corner():
    rng = np.random.default_rng(0)
    for code in CODES:
        face, box = render_face(code, rng)
        assert face.shape == (FACE_H, FACE_W, 3), code
        x0, y0, x1, y1 = box
        assert 0 <= x0 < x1 <= 0.25 * FACE_W and 0 <= y0 < y1 <= 0.6 * FACE_H, code
        ink = face[y0:y1, x0:x1].mean()
        assert ink < face.mean(), code


def test_scene_labels_are_inside_the_photo_and_mostly_visible():
    rng = np.random.default_rng(0)
    image, annotations = synth.make_scene(rng, [], size=(800, 600))
    assert image.shape == (600, 800, 3) and image.dtype == np.uint8
    assert len(annotations) >= 1
    for annotation in annotations:
        x0, y0, x1, y1 = annotation['box']
        assert 0 <= x0 < x1 <= 800 and 0 <= y0 < y1 <= 600
        assert annotation['visible'] >= 0.65
        assert 0 <= annotation['phi'] < 360
        assert annotation['code'] in CODES


def test_same_seed_gives_the_same_scene():
    first, labels_a = synth.make_scene(np.random.default_rng(7), [], size=(800, 600))
    second, labels_b = synth.make_scene(np.random.default_rng(7), [], size=(800, 600))
    assert np.array_equal(first, second)
    assert labels_a == labels_b


def test_forced_strip_fan_of_ten_gives_ten_top_left_labels():
    rng = np.random.default_rng(4)
    codes = CODES[:10]
    cards = synth.make_group(rng, 'strip', codes, step=0.25, flip_prob=0.0)
    assert len(cards) == 10
    group = {'cards': cards, 'centre': (800.0, 600.0), 'rotation': 0.0}
    _, annotations = synth.render_groups(rng, [group], (1600, 1200), 200.0, {}, rendered_share=1.0)
    top_left = [a for a in annotations if a['corner'] == 'tl']
    assert len(top_left) == 10
    assert sorted(a['code'] for a in top_left) == sorted(codes)


def test_labelled_index_sits_where_the_geometry_says_for_its_angle():
    """The synthetic labels and geometry.card_centre use the same angle convention: the index of a card at
    angle phi is at centre - r*cx*H + u*cy*H, with r = (cos, sin) and u = (sin, -cos)."""
    rng = np.random.default_rng(5)
    height = 200.0
    geo = g.default_geometry()
    for rotation in (30.0, 90.0, 200.0):
        cards = synth.make_group(rng, 'single', ['7C'], flip_prob=0.0)
        centre = np.array([800.0, 600.0])
        group = {'cards': cards, 'centre': centre, 'rotation': rotation}
        _, annotations = synth.render_groups(rng, [group], (1600, 1200), height, {}, rendered_share=1.0, perspective=False)
        tl = [a for a in annotations if a['corner'] == 'tl']
        assert len(tl) == 1, rotation
        phi = np.radians(tl[0]['phi'])
        r = np.array([np.cos(phi), np.sin(phi)])
        u = np.array([np.sin(phi), -np.cos(phi)])
        cx, cy = g._index_offset('7C', geo)
        expected = centre - r * cx * height + u * cy * height
        box = np.array(tl[0]['box'])
        got = np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
        # The rendered index is a little off the nominal index centre, and cards are scaled +-3 %.
        assert np.linalg.norm(got - expected) < 0.08 * height, (rotation, got, expected)


def test_upright_undoes_a_turn_and_the_opposite_turn_does_not():
    """A crop turned by phi and then passed through upright(phi) comes back to the original picture.
    Turning it the other way (a sign mistake) would leave it visibly wrong."""
    rng = np.random.default_rng(2)
    face, box = render_face('7H', rng)
    padded = cv2.copyMakeBorder(face, 200, 200, 200, 200, cv2.BORDER_REPLICATE)
    crop, _ = index_crop(padded, (box[0] + 200, box[1] + 200, box[2] + 200, box[3] + 200))
    turned = synth.turn(crop, 90)
    restored = upright(turned, 90)
    mistake = synth.turn(turned, 90)
    good = np.abs(restored.astype(int) - crop.astype(int)).mean()
    bad = np.abs(mistake.astype(int) - crop.astype(int)).mean()
    assert good < 8
    assert bad > 2 * good


def test_fixed_crops_are_reproducible():
    faces = []
    a = synth.fixed_crops(faces, 8, seed=123)
    b = synth.fixed_crops(faces, 8, seed=123)
    assert a[0].shape == (8, 128, 128, 3)
    assert np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1]) and np.array_equal(a[2], b[2])


def test_augment_keeps_the_crop_shape_and_type():
    rng = np.random.default_rng(0)
    crop = np.full((128, 128, 3), 200, np.uint8)
    out = synth.augment_crop(crop, rng)
    assert out.shape == crop.shape and out.dtype == np.uint8


@pytest.mark.parametrize('kind', ['pile', 'fan'])
def test_group_members_are_drawn_in_order_and_counted(kind):
    rng = np.random.default_rng(6)
    codes = ['AS', 'AS', 'AS'] if kind == 'pile' else ['AS', '2S', '3S']
    cards = synth.make_group(rng, kind, codes)
    assert sorted(card['code'] for card in cards) == sorted(codes)
