import json

import cv2
import numpy as np
import pytest

import capture_deck
from cards_render import FACE_H, FACE_W, render_face
from classes import JOKER, RANKS
from tests.test_detect import table

# Card centres for 13 cards in rows of 5, 5 and 3 (reading order), on a 1600 x 1200 table.
ROWS = [[480 + col * 230 for col in range(5)], [480 + col * 230 for col in range(5)], [710, 940, 1170]]
ROW_Y = [230, 520, 810]
SMALL = (120, 170)


def place(image, face, centre):
    small = cv2.resize(face, SMALL, interpolation=cv2.INTER_AREA)
    x, y = centre
    image[y - SMALL[1] // 2:y - SMALL[1] // 2 + SMALL[1], x - SMALL[0] // 2:x - SMALL[0] // 2 + SMALL[0]] = small


def suit_photo(suit, count=13, seed=0):
    rng = np.random.default_rng(seed)
    image = table(1600, 1200)
    centres = [(x, ROW_Y[row]) for row, xs in enumerate(ROWS) for x in xs][:count]
    for rank, centre in zip(RANKS, centres):
        face, _ = render_face(rank + suit, rng)
        place(image, face, centre)
    return image


def test_thirteen_suit_faces_come_out_in_order_with_their_index_boxes():
    faces = capture_deck.capture_photo(suit_photo('S'), 'S')
    assert [code for code, _ in faces] == [rank + 'S' for rank in RANKS]
    for code, face in faces:
        assert face.shape == (FACE_H, FACE_W, 3)
        box = capture_deck.find_index_box(face)
        assert box is not None, code
        x0, y0, x1, y1 = box
        assert x0 < 0.16 * FACE_W and y0 < 0.3 * FACE_H, code


def test_a_twelve_card_photo_is_refused_and_numbered(tmp_path):
    problem = tmp_path / 'problem_S.jpg'
    with pytest.raises(ValueError, match='found 12'):
        capture_deck.capture_photo(suit_photo('S', count=12), 'S', problem_path=str(problem))
    assert problem.exists()


def test_joker_photo_takes_one_or_more_jokers():
    rng = np.random.default_rng(3)
    image = table(1600, 1200)
    for centre in ((400, 400), (900, 400)):
        face, _ = render_face(JOKER, rng)
        place(image, face, centre)
    faces = capture_deck.capture_photo(image, JOKER)
    assert [code for code, _ in faces] == [JOKER, JOKER]
    assert capture_deck.find_index_box(faces[0][1], joker=True) is not None


def test_capture_deck_writes_faces_boxes_geometry_and_contact_sheet(tmp_path):
    photos = {}
    for key in ('S', 'H', 'D', 'C'):
        path = tmp_path / f'{key}.jpg'
        cv2.imwrite(str(path), suit_photo(key, seed=len(photos)))
        photos[key] = str(path)
    joker_image = table(1600, 1200)
    rng = np.random.default_rng(9)
    place(joker_image, render_face(JOKER, rng)[0], (600, 500))
    cv2.imwrite(str(tmp_path / 'JK.jpg'), joker_image)
    photos['JK'] = str(tmp_path / 'JK.jpg')

    out = tmp_path / 'deck'
    args = ['--deck', 'test', '--out', str(out)] + [f'{key}={photos[key]}' for key in ('S', 'H', 'D', 'C', 'JK')]
    capture_deck.main(args)

    deck = out / 'test'
    assert len(list((deck / 'faces').glob('*.png'))) == 4 * 13 + 1
    boxes = json.loads((deck / 'boxes.json').read_text())
    assert 'AS' in boxes and 'KC' in boxes and 'JK_1' in boxes
    assert set(boxes['AS']) == {'tl', 'br'}
    geometry = json.loads((deck / 'geometry.json').read_text())
    assert geometry['card_aspect'] == pytest.approx(FACE_W / FACE_H)
    assert 0.1 < geometry['index_h'] < 0.35
    assert (deck / 'check.jpg').exists()
