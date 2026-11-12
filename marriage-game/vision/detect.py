"""Find playing cards laid flat in a photo and cut each one out, upright.

Cards should lie apart (small gaps) on a darker, plain surface. Each card is
found as a light, roughly card-shaped region, then perspective-corrected to a
CARD_W x CARD_H portrait image for the classifier.
"""
import cv2
import numpy as np

CARD_W, CARD_H = 200, 300
WORK_SIZE = 1600  # longest side used for detection; crops come from the full photo
CARD_RATIO = (0.5, 0.9)  # short side / long side; a poker card is about 0.71, tilt makes it lower
MIN_FILL = 0.85  # contour area / outline area; lower means overlapping cards
MIN_SOLIDITY = 0.93  # contour area / convex hull area; overlapping cards make a dented outline
MIN_AREA_RATIO = 0.0006  # smallest card, as a share of the work image
MIN_AREA_PIXELS = 400  # ...but never smaller than this, so specks are not cards
EDGE_MARGIN = 0.004  # a card this close to the photo edge is cut off (share of the longer side)


def order_corners(points):
    """Return corners as top-left, top-right, bottom-right, bottom-left."""
    points = np.asarray(points, dtype=np.float32)
    centre = points.mean(axis=0)
    # Clockwise around the centre (image y points down), so ties in x+y or x-y at 45 degrees cannot repeat a corner.
    ordered = points[np.argsort(np.arctan2(points[:, 1] - centre[1], points[:, 0] - centre[0]))]
    start = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -start, axis=0).astype(np.float32)


def warp_card(image, corners, size=(CARD_W, CARD_H)):
    """Cut a card out of the photo as an upright image of size (width, height); portrait by default."""
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if width > height:  # card lies sideways: turn it a quarter so it ends up portrait
        corners = np.array([tr, br, bl, tl], dtype=np.float32)
    out_w, out_h = size
    target = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners.astype(np.float32), target)
    return cv2.warpPerspective(image, matrix, (out_w, out_h))


def _masks(gray):
    """Two ways to separate cards from the table; the one that finds more cards wins."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    filled = np.zeros_like(edges)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    filled = cv2.erode(filled, np.ones((3, 3), np.uint8), iterations=2)
    return [otsu, filled]


def _quad_shape(contour):
    """Corners, short/long side ratio and fill, measured on the card's own 4-corner outline (works under tilt)."""
    approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
    if len(approx) == 4 and cv2.isContourConvex(approx):
        corners = order_corners(approx.reshape(-1, 2))
    else:
        corners = order_corners(cv2.boxPoints(cv2.minAreaRect(contour)))
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    polygon = cv2.contourArea(corners.reshape(-1, 1, 2))
    if min(width, height) == 0 or polygon == 0:
        return corners, 0.0, 0.0
    return corners, min(width, height) / max(width, height), cv2.contourArea(contour) / polygon


def _touches_edge(contour, shape, margin):
    x, y, w, h = cv2.boundingRect(contour)
    return x <= margin or y <= margin or x + w >= shape[1] - margin or y + h >= shape[0] - margin


def _card_quads(mask, min_area, max_area, margin):
    """Card outlines in a mask, plus how many card-sized shapes were cut off by the photo edge."""
    quads, at_edge = [], 0
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue
        hull = cv2.contourArea(cv2.convexHull(contour))
        if hull == 0 or area / hull < MIN_SOLIDITY:  # overlapping cards (or a hand, a fold) make a dented outline
            continue
        if _touches_edge(contour, mask.shape, margin):  # only convex shapes count as a cut-off card
            at_edge += 1
            continue
        corners, ratio, fill = _quad_shape(contour)
        if not CARD_RATIO[0] <= ratio <= CARD_RATIO[1] or fill < MIN_FILL:
            continue
        quads.append(corners)
    return quads, at_edge


def _tilt_degrees(quads):
    """The photo's tilt: the median angle of the cards' edges, wrapped to -45..45 degrees (0 when the rows are level)."""
    angles = []
    for q in quads:
        edge = q[1] - q[0]
        angles.append((np.degrees(np.arctan2(edge[1], edge[0])) + 45) % 90 - 45)
    return float(np.median(angles))


def _reading_order(quads):
    """Sort cards in rows, top to bottom, then left to right, in the frame turned level by the photo's tilt."""
    if not quads:
        return quads
    tilt = np.radians(_tilt_degrees(quads))
    level = np.array([[np.cos(tilt), np.sin(tilt)], [-np.sin(tilt), np.cos(tilt)]])  # turns the photo by -tilt
    centres = [level @ q.mean(axis=0) for q in quads]
    heights = [np.linalg.norm(q[3] - q[0]) for q in quads]
    row_gap = float(np.median(heights)) / 2
    order = sorted(range(len(quads)), key=lambda i: centres[i][1])
    rows, current, last_y = [], [], None
    for i in order:
        y = centres[i][1]
        if last_y is not None and y - last_y > row_gap:
            rows.append(current)
            current = []
        current.append(i)
        last_y = y
    rows.append(current)
    return [quads[i] for row in rows for i in sorted(row, key=lambda i: centres[i][0])]


def find_cards_with_edges(image, min_area_ratio=MIN_AREA_RATIO, max_area_ratio=0.25):
    """Return (cards, ignored_at_edge). cards: [{'corners', 'crop'}] in reading order."""
    height, width = image.shape[:2]
    scale = min(1.0, WORK_SIZE / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    total = gray.shape[0] * gray.shape[1]
    margin = max(2.0, EDGE_MARGIN * max(gray.shape))
    min_area = max(MIN_AREA_PIXELS, min_area_ratio * total)
    best, best_edge = [], 0
    for mask in _masks(gray):
        quads, at_edge = _card_quads(mask, min_area, max_area_ratio * total, margin)
        if len(quads) > len(best) or (len(quads) == len(best) and at_edge > best_edge):
            best, best_edge = quads, at_edge
    cards = []
    for quad in _reading_order(best):
        corners = quad / scale
        cards.append({'corners': corners, 'crop': warp_card(image, corners)})
    return cards, best_edge


def find_cards(image, min_area_ratio=MIN_AREA_RATIO, max_area_ratio=0.25):
    """Return [{'corners': 4x2 array in photo pixels, 'crop': CARD_H x CARD_W x 3 image}]."""
    return find_cards_with_edges(image, min_area_ratio, max_area_ratio)[0]
