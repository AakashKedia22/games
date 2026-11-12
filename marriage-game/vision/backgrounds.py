"""Procedural backgrounds, distractors and lighting for synthetic photos (rugs, cloth, skin, shadows).

Images are BGR uint8. Every function takes an rng (numpy Generator) so a seed gives the same picture.
"""
import glob
import os

import cv2
import numpy as np

PALETTE = [  # base colours, BGR: light brown, dark brown, grey, green, maroon
    ((120, 140, 165), 20), ((40, 50, 65), 15), ((150, 150, 150), 20), ((60, 110, 60), 20), ((50, 30, 110), 15),
]
SKIN = ((130, 160, 205), 30)
STYLE_WEIGHTS = {'hexagon': 0.35, 'plain': 0.20, 'photo': 0.20, 'blotch': 0.15, 'stripes': 0.10}


def _jitter(rng, colour, spread):
    return np.clip(np.array(colour, np.float32) + rng.uniform(-spread, spread, 3), 0, 255)


def _base(rng):
    colour, spread = PALETTE[int(rng.integers(len(PALETTE)))]
    return _jitter(rng, colour, spread)


def _fabric_noise(rng, image, sigma):
    """Grain of the given strength, the same on all three colours (as on a real cloth photo)."""
    grain = rng.standard_normal(image.shape[:2], dtype=np.float32) * np.float32(sigma)
    noisy = np.clip(image.astype(np.float32) + grain[..., None], 0, 255).astype(np.uint8)
    return np.ascontiguousarray(noisy)


def hexagon_rug(rng, w, h):
    """A rug with cream hexagon lines (IMG_4641 and IMG_4638 style): the lines join cards into one blob."""
    image = np.empty((h, w, 3), np.float32)
    image[:] = _base(rng)
    blotch = cv2.resize(rng.normal(0, 1, (4, 4)).astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    image *= (1 + 0.04 * blotch)[..., None]
    image = np.clip(image, 0, 255).astype(np.uint8)

    radius = float(rng.uniform(60, 240))
    angle = float(rng.uniform(0, np.pi / 3))
    thickness = int(rng.integers(2, 13))
    spacing_x, spacing_y = np.sqrt(3) * radius, 1.5 * radius
    centre = np.array([w / 2, h / 2]) + rng.uniform(-radius, radius, 2)
    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    reach = int(max(w, h) / radius) + 3
    corners = np.array([30 + 60 * k for k in range(6)]) * np.pi / 180
    for i in range(-reach, reach + 1):
        for j in range(-reach, reach + 1):
            local = np.array([i * spacing_x + (j % 2) * spacing_x / 2, j * spacing_y])
            cx, cy = centre + rotation @ local
            if not (-radius <= cx <= w + radius and -radius <= cy <= h + radius):
                continue
            points = np.stack([cx + radius * np.cos(corners), cy + radius * np.sin(corners)], axis=1)
            colour = (int(rng.uniform(170, 215)), int(rng.uniform(205, 235)), int(rng.uniform(215, 245)))  # cream, BGR
            cv2.polylines(image, [np.round(points).astype(np.int32)], True, colour, thickness, lineType=cv2.LINE_AA)
    return _fabric_noise(rng, image, rng.uniform(3, 10))


def plain_noise(rng, w, h):
    return _fabric_noise(rng, np.broadcast_to(_base(rng).astype(np.uint8), (h, w, 3)), rng.uniform(2, 6))


def blotchy(rng, w, h):
    """Blurred multi-scale noise with wood-like streaks."""
    field = np.zeros((h, w), np.float32)
    for size, weight in ((8, 1.0), (32, 0.6), (128, 0.4)):
        layer = rng.normal(0, 1, (max(2, h // size), max(2, w // size))).astype(np.float32)
        field += weight * cv2.resize(layer, (w, h), interpolation=cv2.INTER_CUBIC)
    streaks = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (1, 0), sigmaX=0.5, sigmaY=12)
    field = field / (np.abs(field).max() + 1e-6) * 0.5 + streaks / (np.abs(streaks).max() + 1e-6) * 0.5
    base = _base(rng)
    image = base[None, None, :] * (1 + 0.25 * field[..., None])
    return _fabric_noise(rng, np.clip(image, 0, 255).astype(np.uint8), 2.0)


def stripes(rng, w, h):
    """Stripes or a checker of two close colours."""
    first = _base(rng)
    second = np.clip(first + rng.uniform(-25, 25, 3), 0, 255)
    period = int(rng.integers(20, 81))
    yy, xx = np.mgrid[0:h, 0:w]
    if rng.random() < 0.5:
        mask = ((xx // period) % 2 == 0)
    else:
        mask = (((xx // period) + (yy // period)) % 2 == 0)
    image = np.where(mask[..., None], first[None, None, :], second[None, None, :]).astype(np.uint8)
    return _fabric_noise(rng, image, 2.0)


def user_photo(rng, w, h, photo_dir):
    """A random crop, scale and flip of one of the user's empty-rug photos, or None if there are none."""
    files = sorted(glob.glob(os.path.join(photo_dir, '*.jpg')) + glob.glob(os.path.join(photo_dir, '*.jpeg'))
                   + glob.glob(os.path.join(photo_dir, '*.png')))
    if not files:
        return None
    source = cv2.imread(files[int(rng.integers(len(files)))], cv2.IMREAD_COLOR)
    if source is None:
        return None
    scale = max(float(rng.uniform(0.5, 1.5)), (h + 1) / source.shape[0], (w + 1) / source.shape[1])
    source = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    y = int(rng.integers(0, source.shape[0] - h + 1))
    x = int(rng.integers(0, source.shape[1] - w + 1))
    image = source[y:y + h, x:x + w].copy()
    if rng.random() < 0.5:
        image = cv2.flip(image, 1)
    return image


def random_background(rng, w, h, photo_dir='vision/datasets/backgrounds', style=None):
    """One background picture of size w x h. Without user photos their weight goes to the hexagon rug."""
    weights = dict(STYLE_WEIGHTS)
    has_photos = bool(glob.glob(os.path.join(photo_dir, '*.jpg')) + glob.glob(os.path.join(photo_dir, '*.jpeg'))
                      + glob.glob(os.path.join(photo_dir, '*.png')))
    if not has_photos:
        weights['hexagon'] += weights.pop('photo')
    if style is None:
        names = list(weights)
        style = names[int(rng.choice(len(names), p=np.array([weights[n] for n in names]) / sum(weights.values())))]
    if style == 'photo':
        image = user_photo(rng, w, h, photo_dir)
        if image is not None:
            return image
        style = 'hexagon'
    return {'hexagon': hexagon_rug, 'plain': plain_noise, 'blotch': blotchy, 'stripes': stripes}[style](rng, w, h)


def _edge_point(rng, w, h):
    side = int(rng.integers(4))
    if side == 0:
        return (int(rng.uniform(0, w)), 0)
    if side == 1:
        return (int(rng.uniform(0, w)), h)
    if side == 2:
        return (0, int(rng.uniform(0, h)))
    return (w, int(rng.uniform(0, h)))


def _roi(centre, reach, w, h):
    """Clipped box (x0, y0, x1, y1) of the given reach around a centre."""
    x, y = int(centre[0]), int(centre[1])
    return max(0, x - reach), max(0, y - reach), min(w, x + reach + 1), min(h, y + reach + 1)


def add_distractors(rng, image, owner=None):
    """Skin (a hand or arm) and a dark cloth edge entering from the photo's edges, as in IMG_4638 and IMG_4641.
    Pixels they cover get owner -1 when an owner map is given, so they count as not a card."""
    h, w = image.shape[:2]
    for _ in range(int(rng.integers(0, 3))):
        centre = _edge_point(rng, w, h)
        axes = (int(rng.uniform(60, 160)), int(rng.uniform(30, 90)))
        angle = float(rng.uniform(0, 180))
        x0, y0, x1, y1 = _roi(centre, max(axes), w, h)
        if x1 <= x0 or y1 <= y0:
            continue
        mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.ellipse(mask, (centre[0] - x0, centre[1] - y0), axes, angle, 0, 360, 255, -1)
        region = mask > 0
        colour = _jitter(rng, *SKIN)
        texture = rng.normal(0, 6, region.shape).astype(np.float32)
        skin = np.clip(colour[None, None, :] + texture[..., None], 0, 255).astype(np.uint8)
        image[y0:y1, x0:x1][region] = skin[region]
        for _ in range(int(rng.integers(3, 12))):  # dark hair-like strokes
            start = (int(rng.uniform(0, w)), int(rng.uniform(0, h)))
            end = (start[0] + int(rng.uniform(-40, 40)), start[1] + int(rng.uniform(-40, 40)))
            cv2.line(image, start, end, (30, 30, 35), 1)
        if owner is not None:
            owner[y0:y1, x0:x1][region] = -1
    if rng.random() < 0.5:
        centre = _edge_point(rng, w, h)
        axes = (int(rng.uniform(120, 260)), int(rng.uniform(80, 180)))
        angle = float(rng.uniform(0, 180))
        x0, y0, x1, y1 = _roi(centre, max(axes) + 75, w, h)  # three blur sigmas of margin
        if x1 > x0 and y1 > y0:
            mask = np.zeros((y1 - y0, x1 - x0), np.float32)
            cv2.ellipse(mask, (centre[0] - x0, centre[1] - y0), axes, angle, 0, 360, 1.0, -1)
            mask = cv2.GaussianBlur(mask, (0, 0), 25)
            cloth = _jitter(rng, (60, 30, 90), 20)
            alpha = (mask * 0.85)[..., None]
            patch = image[y0:y1, x0:x1].astype(np.float32)
            image[y0:y1, x0:x1] = np.clip(patch * (1 - alpha) + cloth[None, None, :] * alpha, 0, 255).astype(np.uint8)
            if owner is not None:
                owner[y0:y1, x0:x1][mask > 0.6] = -1
    return image


LIGHT_STEP = 8  # the light map is worked out at 1/8 size and stretched; it is smooth, so this is exact enough


def lighting(rng, image):
    """A linear or radial light gradient (x0.7-1.15) and one soft shadow (x0.6-0.85)."""
    h, w = image.shape[:2]
    small_w, small_h = max(2, w // LIGHT_STEP), max(2, h // LIGHT_STEP)
    yy, xx = np.mgrid[0:small_h, 0:small_w].astype(np.float32)
    xx *= w / small_w
    yy *= h / small_h
    if rng.random() < 0.5:
        angle = rng.uniform(0, 2 * np.pi)
        proj = (xx - w / 2) * np.cos(angle) + (yy - h / 2) * np.sin(angle)
        proj = proj / (np.abs(proj).max() + 1e-6)
        gradient = 0.925 + 0.225 * proj
    else:
        centre = (rng.uniform(0, w), rng.uniform(0, h))
        dist = np.hypot(xx - centre[0], yy - centre[1]) / max(w, h)
        gradient = 1.15 - rng.uniform(0.3, 0.6) * dist
    gradient = np.clip(gradient, 0.7, 1.15)
    shadow = np.zeros((small_h, small_w), np.float32)
    points = np.stack([rng.uniform(0, small_w, 4), rng.uniform(0, small_h, 4)], axis=1).astype(np.int32)
    cv2.fillPoly(shadow, [points], 1.0)
    shadow = cv2.GaussianBlur(shadow, (0, 0), 20 / LIGHT_STEP)
    shade = 1 - shadow * (1 - rng.uniform(0.6, 0.85))
    light = cv2.resize((gradient * shade).astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
    result = image.astype(np.float32) * light[..., None]
    return np.clip(result, 0, 255).astype(np.uint8)
