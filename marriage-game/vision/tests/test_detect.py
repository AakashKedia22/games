import cv2
import numpy as np

from detect import CARD_H, CARD_W, find_cards, order_corners


def table(width=1600, height=1200, seed=0):
    """A dark green, slightly noisy table."""
    rng = np.random.default_rng(seed)
    image = np.zeros((height, width, 3), np.uint8)
    image[:] = (40, 70, 30)
    noise = rng.integers(0, 12, size=image.shape, dtype=np.uint8)
    return cv2.add(image, noise)


def draw_card(image, centre, size=(120, 170), angle=0.0, label='A'):
    """White card with a dark corner label, rotated about its centre."""
    rect = (centre, size, angle)
    box = cv2.boxPoints(rect).astype(np.int32)
    cv2.fillPoly(image, [box], (235, 235, 235))
    cv2.putText(image, label, (int(centre[0] - 20), int(centre[1] + 10)), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 3)
    return box


def test_order_corners():
    points = [[10, 90], [90, 90], [10, 10], [90, 10]]
    assert order_corners(points).tolist() == [[10, 10], [90, 10], [90, 90], [10, 90]]


def test_finds_thirty_cards_in_reading_order():
    image = table()
    centres = []
    for row in range(5):
        for col in range(6):
            centre = (150 + col * 240, 140 + row * 230)
            centres.append(centre)
            draw_card(image, centre, angle=(row * 6 + col) % 7 - 3, label=str(row * 6 + col))
    cards = find_cards(image)
    assert len(cards) == 30
    found = [card['corners'].mean(axis=0) for card in cards]
    for expected, got in zip(centres, found):
        assert abs(expected[0] - got[0]) < 8 and abs(expected[1] - got[1]) < 8
    assert all(card['crop'].shape == (CARD_H, CARD_W, 3) for card in cards)
    # The crop is the card itself: mostly white.
    assert all(card['crop'].mean() > 180 for card in cards)


def test_sideways_card_comes_out_portrait():
    image = table(800, 600)
    draw_card(image, (400, 300), size=(170, 120))
    cards = find_cards(image)
    assert len(cards) == 1
    assert cards[0]['crop'].shape == (CARD_H, CARD_W, 3)


def test_overlapping_cards_are_skipped():
    image = table(800, 600)
    draw_card(image, (200, 300))
    draw_card(image, (500, 300))
    draw_card(image, (560, 330), angle=25)  # overlaps the second card
    cards = find_cards(image)
    assert len(cards) == 1
    assert abs(cards[0]['corners'].mean(axis=0)[0] - 200) < 8


def test_large_photo_is_scaled_for_detection_but_cropped_at_full_size():
    image = table(4000, 3000)
    draw_card(image, (1000, 1500), size=(300, 425))
    draw_card(image, (3000, 1500), size=(300, 425), angle=10)
    cards = find_cards(image)
    assert len(cards) == 2
    assert abs(cards[1]['corners'].mean(axis=0)[0] - 3000) < 15


def test_empty_table():
    assert find_cards(table(640, 480)) == []


def test_cards_at_any_rotation_give_clean_upright_crops():
    """Corner ordering must stay valid at every angle, including near 45 degrees where sums/differences tie."""
    for angle in range(0, 360, 7):
        image = table(600, 600)
        draw_card(image, (300, 300), size=(150, 215), angle=float(angle))
        cards = find_cards(image)
        assert len(cards) == 1, angle
        crop = cards[0]['crop']
        assert crop.shape == (CARD_H, CARD_W, 3)
        assert crop.mean() > 200, angle  # a bad corner order would smear in the dark table
    for angle in (44.0, 45.0, 46.0):
        corners = order_corners(cv2.boxPoints(((100, 100), (120, 170), angle)))
        assert len({tuple(np.round(p, 2)) for p in corners}) == 4, angle


def test_crop_is_not_mirrored():
    """A marker in a card's top-left corner stays on the left, whatever the card's tilt."""
    for angle in (0.0, 20.0, -25.0):
        image = table(600, 600)
        box = draw_card(image, (300, 300), size=(150, 215), angle=angle)
        tl = order_corners(box)[0]
        centre = np.array([300.0, 300.0])
        marker = tl + (centre - tl) * 0.2
        cv2.circle(image, tuple(int(v) for v in marker), 12, (0, 0, 220), -1)
        crop = find_cards(image)[0]['crop']
        red = (crop[:, :, 2] > 180) & (crop[:, :, 1] < 80)
        ys, xs = np.nonzero(red)
        assert len(xs) > 50
        assert xs.mean() < CARD_W / 2 and ys.mean() < CARD_H / 2


def test_reading_order_with_uneven_rows():
    """Two rows whose cards sit at slightly different heights still read left to right, row by row."""
    image = table(1000, 700)
    layout = [(150, 160), (350, 130), (550, 175), (750, 150), (200, 450), (400, 480), (600, 430), (800, 465)]
    for x, y in layout:
        draw_card(image, (x, y), size=(120, 170))
    got = [tuple(card['corners'].mean(axis=0).round()) for card in find_cards(image)]
    assert [round(x / 50) for x, _ in got] == [round(x / 50) for x, _ in layout]
    assert [y < 330 for _, y in got] == [True] * 4 + [False] * 4
