"""Find playing cards laid flat in a photo and cut each one out, upright.

Cards should lie apart (small gaps) on a darker, plain surface. Each card is
found as a light, roughly card-shaped region, then perspective-corrected to a
CARD_W x CARD_H portrait image for the classifier.
"""
import cv2
import numpy as np

CARD_W, CARD_H = 200, 300
WORK_SIZE = 1600  # longest side used for detection; crops come from the full photo
CARD_RATIO = (0.55, 0.85)  # short side / long side; a poker card is about 0.71
MIN_FILL = 0.85  # contour area / bounding-rectangle area; lower means overlapping cards


def order_corners(points):
    """Return corners as top-left, top-right, bottom-right, bottom-left."""
    points = np.asarray(points, dtype=np.float32)
    centre = points.mean(axis=0)
    # Clockwise around the centre (image y points down), so ties in x+y or x-y at 45 degrees cannot repeat a corner.
    ordered = points[np.argsort(np.arctan2(points[:, 1] - centre[1], points[:, 0] - centre[0]))]
    start = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -start, axis=0).astype(np.float32)


def warp_card(image, corners):
    """Cut a card out of the photo as an upright CARD_W x CARD_H image."""
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if width > height:  # card lies sideways: turn it a quarter so it ends up portrait
        corners = np.array([tr, br, bl, tl], dtype=np.float32)
    target = np.array([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners.astype(np.float32), target)
    return cv2.warpPerspective(image, matrix, (CARD_W, CARD_H))


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


def _card_quads(mask, min_area, max_area):
    quads = []
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue
        rect = cv2.minAreaRect(contour)
        (_, _), (w, h), _ = rect
        if w == 0 or h == 0:
            continue
        ratio = min(w, h) / max(w, h)
        if not CARD_RATIO[0] <= ratio <= CARD_RATIO[1]:
            continue
        if area / (w * h) < MIN_FILL:
            continue
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        points = approx.reshape(-1, 2) if len(approx) == 4 else cv2.boxPoints(rect)
        quads.append(order_corners(points))
    return quads


def _reading_order(quads):
    """Sort cards in rows, top to bottom, then left to right."""
    if not quads:
        return quads
    centres = [q.mean(axis=0) for q in quads]
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


def find_cards(image, min_area_ratio=0.002, max_area_ratio=0.25):
    """Return [{'corners': 4x2 array in photo pixels, 'crop': CARD_H x CARD_W x 3 image}]."""
    height, width = image.shape[:2]
    scale = min(1.0, WORK_SIZE / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    total = gray.shape[0] * gray.shape[1]
    best = []
    for mask in _masks(gray):
        quads = _card_quads(mask, min_area_ratio * total, max_area_ratio * total)
        if len(quads) > len(best):
            best = quads
    cards = []
    for quad in _reading_order(best):
        corners = quad / scale
        cards.append({'corners': corners, 'crop': warp_card(image, corners)})
    return cards
