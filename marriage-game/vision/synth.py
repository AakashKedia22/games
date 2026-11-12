"""Synthetic photos for training: card faces in piles, strip fans and rotated fans, on random backgrounds.

Angles follow corner_models: a card at angle phi is turned phi degrees clockwise in the image.
Each index gets a label (box, angle, code) only when it is mostly visible and inside the photo.

The dataset classes at the bottom need torch; the scene maker does not, so it runs without it.
"""
import glob
import json
import os

import cv2
import numpy as np

from backgrounds import add_distractors, lighting, random_background
from cards_render import FACE_H, FACE_W, mirror_box, render_face
from classes import CODES
from corner_models import CROP_SIZE, index_crop, orient_vector, to_classifier_batch, turn
from geometry import CARD_ASPECT

try:  # torch is only needed by the dataset classes below
    from torch.utils.data import Dataset, IterableDataset
except ImportError:
    Dataset = IterableDataset = object

CARD_HEIGHT_PX = (200, 380)
BACKGROUND_DIR = 'vision/datasets/backgrounds'  # your empty-rug photos, if any
GROUP_SHARES = {'single': 0.15, 'pile': 0.35, 'strip': 0.25, 'fan': 0.25}
GROUP_SIZES = {'pile': (2, 4), 'strip': (5, 16), 'fan': (3, 10)}
MAX_PER_CODE = 3        # no more than this many copies of one code in a scene
MIN_VISIBLE = 0.65      # an index is labelled when this share of it is the top card's
MIN_INSIDE = 0.9        # ...and this share of it is inside the photo
PAD = 12                # pixels around a card's drawing area, for its shadow
SHUFFLE_BUFFER = 512


def _rot(degrees):
    """Rotation matrix for a clockwise turn in image coordinates (y down)."""
    radians = np.radians(degrees)
    return np.array([[np.cos(radians), -np.sin(radians)], [np.sin(radians), np.cos(radians)]])


def load_faces(deck_dir='vision/datasets/deck'):
    """[(code, face BGR, top-left box, bottom-right box)] from every captured deck folder (may be empty).
    A deck folder holds faces/<code>.png and boxes.json; the bottom-right box is stored for the 180-degree turned face."""
    faces = []
    if not os.path.isdir(deck_dir):
        return faces
    for name in sorted(os.listdir(deck_dir)):
        folder = os.path.join(deck_dir, name)
        boxes_path = os.path.join(folder, 'boxes.json')
        faces_dir = os.path.join(folder, 'faces')
        if not (os.path.isfile(boxes_path) and os.path.isdir(faces_dir)):
            continue
        with open(boxes_path) as handle:
            boxes = json.load(handle)
        for file in sorted(glob.glob(os.path.join(faces_dir, '*.png'))):
            key = os.path.splitext(os.path.basename(file))[0]
            code = key.split('_')[0]
            if key not in boxes or code not in CODES:
                continue
            face = cv2.imread(file, cv2.IMREAD_COLOR)
            if face is None:
                continue
            tl = tuple(int(v) for v in boxes[key]['tl'])
            rotated = boxes[key]['br']
            height, width = face.shape[:2]
            br = (width - rotated[2], height - rotated[3], width - rotated[0], height - rotated[1])
            faces.append((code, face, tl, br))
    return faces


def _group_by_code(faces):
    by_code = {}
    for code, face, tl, br in faces:
        by_code.setdefault(code, []).append((code, face, tl, br))
    return by_code


def _pick_face(rng, code, by_code, rendered_share):
    """(face, top-left box, bottom-right box): a captured face of this code, or a rendered one."""
    options = by_code.get(code, [])
    if options and rng.random() >= rendered_share:
        _, face, tl, br = options[int(rng.integers(len(options)))]
        return face, tl, br
    face, tl = render_face(code, rng)
    return face, tl, mirror_box(tl)


def make_group(rng, kind, codes, step=None, flip_prob=0.3):
    """The cards of one group, in the group's own frame: units of card height, x right, y down, angles clockwise.
    step is the spacing as a share of the card width (pile and strip); default is random from the plan.
    Returns [{'code', 'pos' (x, y), 'angle' (degrees), 'flip' (turned 180 degrees)}] in drawing order:
    the first card is drawn first, so it lies underneath."""
    n = len(codes)
    width = CARD_ASPECT
    if kind == 'single':
        positions = [np.zeros(2)]
        angles = [float(rng.uniform(-6, 6))]
        order = [0]
    elif kind == 'pile':
        spacing = step * width if step is not None else rng.uniform(0.12, 0.45) * width
        positions = [np.array([(k - (n - 1) / 2) * spacing, rng.uniform(-0.06, 0.06)]) for k in range(n)]
        angles = [float(rng.uniform(-4, 4)) for _ in range(n)]
        order = list(range(n)) if rng.random() < 0.5 else list(range(n))[::-1]  # which side is on top
    elif kind == 'strip':
        spacing = step * width if step is not None else rng.uniform(0.14, 0.30) * width
        positions = [np.array([(k - (n - 1) / 2) * spacing, rng.uniform(-0.03, 0.03)]) for k in range(n)]
        angles = [float(a) for a in np.cumsum([0.0] + [rng.uniform(-1, 4) for _ in range(n - 1)])]
        order = list(range(n))  # each card is over the one before it, so the index on the left shows
    elif kind == 'fan':
        step_deg = float(rng.uniform(4, 12))
        pivot = float(rng.uniform(0.3, 0.8))  # the pivot is this far below the card centres, in card heights
        angles = [(k - (n - 1) / 2) * step_deg for k in range(n)]
        positions = [_rot(angle) @ np.array([0.0, -pivot]) for angle in angles]
        order = list(range(n))[::-1]  # the left-most card ends on top, as in a hand held in a fan
    else:
        raise ValueError(f'unknown group kind {kind!r}')
    flips = rng.random(n) < flip_prob
    return [{'code': codes[k], 'pos': positions[k], 'angle': angles[k], 'flip': bool(flips[k])} for k in order]


def _pick_kind(rng):
    kinds = list(GROUP_SHARES)
    shares = np.array([GROUP_SHARES[kind] for kind in kinds])
    return kinds[int(rng.choice(len(kinds), p=shares / shares.sum()))]


def _choose_codes(rng, kind, counts):
    """Codes for a group, keeping every code at MAX_PER_CODE or fewer in the scene. Piles are mostly one code."""
    if kind == 'single':
        size = 1
    else:
        low, high = GROUP_SIZES[kind]
        size = int(rng.integers(low, high + 1))
    codes = []
    if kind == 'pile' and rng.random() < 0.6:
        options = [code for code in CODES if counts.get(code, 0) < MAX_PER_CODE]
        if not options:
            return []
        code = options[int(rng.integers(len(options)))]
        codes = [code] * min(size, MAX_PER_CODE - counts.get(code, 0))
    else:
        for _ in range(size):
            options = [code for code in CODES if counts.get(code, 0) + codes.count(code) < MAX_PER_CODE]
            if not options:
                break
            codes.append(options[int(rng.integers(len(options)))])
    for code in codes:
        counts[code] = counts.get(code, 0) + 1
    return codes


def _group_rotation(rng):
    roll = rng.random()
    if roll < 0.6:
        return float(rng.uniform(-25, 25))
    if roll < 0.75:
        return 180 + float(rng.uniform(-25, 25))
    return float(rng.uniform(0, 360))


def _place(rng, cards, rotation, height_px, size, placed):
    """A random centre for the group that does not overlap an earlier group by more than 10 % of the radius."""
    w, h = size
    mean = np.mean([card['pos'] for card in cards], axis=0)
    radius = (max(np.linalg.norm(card['pos'] - mean) for card in cards) + 0.6) * height_px
    for _ in range(50):
        centre = np.array([rng.uniform(0.05 * w, 0.95 * w), rng.uniform(0.05 * h, 0.95 * h)])
        if all(radius + other_radius - np.linalg.norm(centre - other) <= 0.1 * min(radius, other_radius)
               for other, other_radius in placed):
            return centre, radius
    return None, radius


def _rounded_mask(width, height, radius):
    mask = np.zeros((height, width), np.float32)
    radius = int(max(1, min(radius, width // 2, height // 2)))
    cv2.rectangle(mask, (radius, 0), (width - 1 - radius, height - 1), 1.0, -1)
    cv2.rectangle(mask, (0, radius), (width - 1, height - 1 - radius), 1.0, -1)
    for cx, cy in ((radius, radius), (width - 1 - radius, radius), (radius, height - 1 - radius),
                   (width - 1 - radius, height - 1 - radius)):
        cv2.circle(mask, (cx, cy), radius, 1.0, -1)
    return mask


def _draw_card(image, owner, card_id, face, boxes, centre, rotation, height_px, rng):
    """Composite one card (with its shadow) onto the scene. Returns its index polygons in scene pixels."""
    scale = height_px / FACE_H
    width_px, height_px_small = max(2, int(round(FACE_W * scale))), max(2, int(round(FACE_H * scale)))
    small = cv2.resize(face, (width_px, height_px_small), interpolation=cv2.INTER_AREA)
    rot = _rot(rotation)
    matrix = np.hstack([rot, (np.asarray(centre, float) - rot @ np.array([width_px / 2, height_px_small / 2]))[:, None]])
    corners = np.array([[0, 0], [width_px, 0], [width_px, height_px_small], [0, height_px_small]], float)
    scene = corners @ matrix[:, :2].T + matrix[:, 2]
    x0 = max(0, int(np.floor(scene[:, 0].min())) - PAD)
    y0 = max(0, int(np.floor(scene[:, 1].min())) - PAD)
    x1 = min(image.shape[1], int(np.ceil(scene[:, 0].max())) + PAD)
    y1 = min(image.shape[0], int(np.ceil(scene[:, 1].max())) + PAD)
    if x1 <= x0 or y1 <= y0:
        return None
    local = matrix.copy()
    local[:, 2] -= (x0, y0)
    size = (x1 - x0, y1 - y0)
    mask = _rounded_mask(width_px, height_px_small, 0.05 * height_px)
    card = cv2.warpAffine(small, local, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    alpha = cv2.warpAffine(mask, local, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    shifted = local.copy()
    shifted[:, 2] += rng.uniform(2, 8, 2)  # drop shadow
    shadow = cv2.GaussianBlur(cv2.warpAffine(mask, shifted, size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                             borderValue=0), (0, 0), 2.5)
    region = image[y0:y1, x0:x1].astype(np.float32)
    region *= (1 - shadow * (1 - rng.uniform(0.65, 0.85)))[..., None]
    card = card.astype(np.float32) * rng.uniform(0.9, 1.05)
    region = region * (1 - alpha[..., None]) + card * alpha[..., None]
    image[y0:y1, x0:x1] = np.clip(region, 0, 255).astype(np.uint8)
    owner_region = owner[y0:y1, x0:x1]
    owner_region[alpha > 0.5] = card_id
    polygons = {}
    for key, (bx0, by0, bx1, by1) in boxes.items():
        face_box = np.array([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], float) * scale
        polygons[key] = face_box @ matrix[:, :2].T + matrix[:, 2]
    return polygons


def _visibility(polygon, owner, card_id):
    """(share of the polygon that is this card's top surface, share of the polygon inside the photo)."""
    height, width = owner.shape
    xs, ys = polygon[:, 0], polygon[:, 1]
    x0, y0 = max(0, int(np.floor(xs.min()))), max(0, int(np.floor(ys.min())))
    x1, y1 = min(width, int(np.ceil(xs.max())) + 1), min(height, int(np.ceil(ys.max())) + 1)
    if x1 <= x0 or y1 <= y0:
        return 0.0, 0.0
    mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(mask, [np.round(polygon - (x0, y0)).astype(np.int32)], 1)
    inside = int(mask.sum())
    if inside == 0:
        return 0.0, 0.0
    visible = np.count_nonzero((mask > 0) & (owner[y0:y1, x0:x1] == card_id))
    area = cv2.contourArea(polygon.astype(np.float32))
    return visible / inside, min(1.0, inside / area) if area > 0 else 0.0


def render_groups(rng, groups, size, height_px, by_code, rendered_share, perspective=True, photo_dir=BACKGROUND_DIR):
    """Draw placed groups on a random background, then apply the photo effects and make the labels.
    groups: [{'cards': make_group(...), 'centre': (x, y) in pixels, 'rotation': degrees}].
    perspective=False skips the whole-photo perspective jitter (tests check exact positions with it off)."""
    w, h = size
    image = random_background(rng, w, h, photo_dir=photo_dir)
    owner = np.full((h, w), -1, np.int16)
    drawn = []
    for group in groups:
        rot = _rot(group['rotation'])
        mean = np.mean([card['pos'] for card in group['cards']], axis=0)
        for card in group['cards']:
            centre = np.asarray(group['centre'], float) + rot @ (card['pos'] - mean) * height_px
            rotation = card['angle'] + group['rotation'] + (180 if card['flip'] else 0)
            face, tl, br = _pick_face(rng, card['code'], by_code, rendered_share)
            card_id = len(drawn)
            polygons = _draw_card(image, owner, card_id, face, {'tl': tl, 'br': br}, centre, rotation,
                                  height_px * rng.uniform(0.97, 1.03), rng)
            if polygons is not None:
                drawn.append({'code': card['code'], 'id': card_id, 'rotation': rotation, 'polygons': polygons})

    image = add_distractors(rng, image, owner)
    image = lighting(rng, image)
    matrix = np.eye(3, dtype=np.float32)
    if perspective:  # the whole photo is tilted a little: corners move by at most 3 %
        src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        dst = (src + rng.uniform(-0.03, 0.03, (4, 2)).astype(np.float32) * [w, h]).astype(np.float32)
        matrix = cv2.getPerspectiveTransform(src, dst)
        image = cv2.warpPerspective(image, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        owner = cv2.warpPerspective(owner, matrix, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=-1)

    annotations = []
    for card in drawn:
        for corner, phi in (('tl', card['rotation']), ('br', card['rotation'] + 180)):
            polygon = cv2.perspectiveTransform(card['polygons'][corner].reshape(-1, 1, 2).astype(np.float32), matrix).reshape(-1, 2)
            visible, inside = _visibility(polygon, owner, card['id'])
            if visible < MIN_VISIBLE or inside < MIN_INSIDE:
                continue
            x0, y0 = np.clip(polygon.min(axis=0), 0, [w, h])
            x1, y1 = np.clip(polygon.max(axis=0), 0, [w, h])
            annotations.append({'code': card['code'], 'box': [float(x0), float(y0), float(x1), float(y1)],
                                'phi': float(phi % 360), 'visible': round(float(visible), 3), 'card': card['id'],
                                'corner': corner})

    image = np.ascontiguousarray(image)
    sigma = float(rng.uniform(0, 1.4))
    if sigma > 0.2:
        image = cv2.GaussianBlur(image, (0, 0), sigma)
    grain = rng.standard_normal(image.shape[:2], dtype=np.float32) * np.float32(rng.uniform(0, 6))
    noisy = image.astype(np.float32) + grain[..., None]
    noisy *= rng.uniform(0.9, 1.1, 3).astype(np.float32)  # white balance per channel
    image = np.clip(noisy, 0, 255).astype(np.uint8)
    ok, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, int(rng.uniform(55, 95))])
    if ok:
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    return image, annotations


def make_scene(rng, faces, size=(1600, 1200), rendered_share=None, photo_dir=BACKGROUND_DIR):
    """(BGR image, annotations) for a random scene. Annotations: {'code', 'box' [x0, y0, x1, y1], 'phi' degrees,
    'visible', 'card', 'corner' ('tl' or 'br')}. Without captured faces every face is rendered."""
    if rendered_share is None:
        rendered_share = 0.3 if faces else 1.0
    by_code = _group_by_code(faces)
    height_px = float(rng.uniform(*CARD_HEIGHT_PX))
    counts, placed, groups = {}, [], []
    for _ in range(int(rng.integers(2, 8))):
        kind = _pick_kind(rng)
        codes = _choose_codes(rng, kind, counts)
        if not codes:
            continue
        cards = make_group(rng, kind, codes)
        rotation = _group_rotation(rng)
        centre, radius = _place(rng, cards, rotation, height_px, size, placed)
        if centre is None:
            continue
        placed.append((centre, radius))
        groups.append({'cards': cards, 'centre': centre, 'rotation': rotation})
    return render_groups(rng, groups, size, height_px, by_code, rendered_share, photo_dir=photo_dir)


def augment_crop(crop, rng):
    """Colour jitter (brightness, contrast, saturation, hue) and a random Gaussian blur, on a BGR uint8 crop."""
    out = crop.astype(np.float32) * rng.uniform(0.7, 1.3)
    mean = out.mean()
    out = (out - mean) * rng.uniform(0.7, 1.3) + mean
    gray = out.mean(axis=2, keepdims=True)
    out = (out - gray) * rng.uniform(0.7, 1.3) + gray
    out = np.clip(out, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV)
    hsv[:, :, 0] = (hsv[:, :, 0].astype(np.int32) + int(round(rng.uniform(-0.03, 0.03) * 180))) % 180
    out = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    if rng.random() < 0.5:
        out = cv2.GaussianBlur(out, (0, 0), float(rng.uniform(0.1, 1.0)))
    return out


def _angle_error(predicted, target):
    return abs((predicted - target + 180) % 360 - 180)


def fixed_crops(faces, count, seed, photo_dir=BACKGROUND_DIR):
    """(crops uint8 N x 128 x 128 x 3, code indexes, angles in degrees) from scenes with a fixed seed. No augmentation."""
    rng = np.random.default_rng(seed)
    crops, labels, angles = [], [], []
    while len(crops) < count:
        image, annotations = make_scene(rng, faces, photo_dir=photo_dir)
        for annotation in annotations:
            crop, _ = index_crop(image, annotation['box'])
            crops.append(crop)
            labels.append(CODES.index(annotation['code']))
            angles.append(annotation['phi'])
            if len(crops) == count:
                break
    return np.stack(crops), np.array(labels), np.array(angles)


def classifier_tensor(crop):
    import torch

    return torch.from_numpy(to_classifier_batch([crop])[0])


# Dataset classes (map-style and iterable) for the torch DataLoader. They are module-level so that worker
# processes can import them.
class DetectorScenes(Dataset):
    """Scenes cut to random crops with their index boxes: (tensor 3 x crop x crop RGB 0..1, {'boxes', 'labels'})."""

    def __init__(self, faces, length, seed=0, crop=640, size=(1600, 1200), photo_dir=BACKGROUND_DIR):
        self.faces = faces
        self.length = length
        self.seed = seed
        self.crop = crop
        self.size = size
        self.photo_dir = photo_dir

    def __len__(self):
        return self.length

    def __getitem__(self, index):
        import torch

        rng = np.random.default_rng(self.seed + index)
        scale = float(rng.uniform(0.8, 1.25))
        image, annotations = make_scene(rng, self.faces, size=self.size, photo_dir=self.photo_dir)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
        boxes = np.array([annotation['box'] for annotation in annotations], np.float32).reshape(-1, 4) * scale
        height, width = image.shape[:2]
        left = int(rng.integers(0, max(1, width - self.crop + 1)))
        top = int(rng.integers(0, max(1, height - self.crop + 1)))
        crop_image = image[top:top + self.crop, left:left + self.crop]
        boxes = boxes - np.array([left, top, left, top], np.float32)
        clipped = np.clip(boxes, 0, self.crop)
        area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        kept_area = (clipped[:, 2] - clipped[:, 0]) * (clipped[:, 3] - clipped[:, 1])
        keep = (area > 0) & (kept_area >= 0.6 * area)
        boxes = clipped[keep].astype(np.float32).reshape(-1, 4)
        rgb = cv2.cvtColor(np.ascontiguousarray(crop_image), cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb.transpose(2, 0, 1).astype(np.float32) / 255.0)
        return tensor, {'boxes': torch.from_numpy(boxes), 'labels': torch.ones(len(boxes), dtype=torch.int64)}


class IndexCrops(IterableDataset):
    """Index crops from endless scenes: (tensor 3 x 128 x 128, code index, cos phi, sin phi, has_angle = 1)."""

    def __init__(self, faces, seed=0, train=True, photo_dir=BACKGROUND_DIR):
        self.faces = faces
        self.seed = seed
        self.train = train
        self.photo_dir = photo_dir

    def __iter__(self):
        import torch

        info = torch.utils.data.get_worker_info()
        worker = info.id if info is not None else 0
        rng = np.random.default_rng(self.seed + 1000 * worker)
        buffer = []
        while True:
            image, annotations = make_scene(rng, self.faces, photo_dir=self.photo_dir)
            for annotation in annotations:
                crop, _ = index_crop(image, annotation['box'], rng if self.train else None)
                if self.train:
                    crop = augment_crop(crop, rng)
                cos, sin = orient_vector(annotation['phi'])
                item = (crop, CODES.index(annotation['code']), cos, sin)
                if len(buffer) < SHUFFLE_BUFFER:
                    buffer.append(item)
                    continue
                slot = int(rng.integers(len(buffer)))
                out, buffer[slot] = buffer[slot], item
                yield self._tensor(out)

    @staticmethod
    def _tensor(item):
        import torch

        crop, label, cos, sin = item
        return classifier_tensor(crop), torch.tensor(label), torch.tensor(cos, dtype=torch.float32), \
            torch.tensor(sin, dtype=torch.float32), torch.tensor(1.0)


class SampleCrops(Dataset):
    """Confirmed crops the app saved (data/vision/samples/<code>/*.jpg), upright, turned by a random angle.
    Items match IndexCrops."""

    def __init__(self, folder, seed=0):
        self.seed = seed
        self.files = []
        for index, code in enumerate(CODES):
            for path in sorted(glob.glob(os.path.join(folder, code, '*.jpg'))):
                self.files.append((path, index))

    def __len__(self):
        return len(self.files)

    def __getitem__(self, index):
        import torch

        rng = np.random.default_rng(self.seed + index)
        path, label = self.files[index]
        crop = cv2.imread(path, cv2.IMREAD_COLOR)
        if crop is None:
            crop = np.full((CROP_SIZE, CROP_SIZE, 3), 128, np.uint8)
        if crop.shape[:2] != (CROP_SIZE, CROP_SIZE):
            crop = cv2.resize(crop, (CROP_SIZE, CROP_SIZE), interpolation=cv2.INTER_AREA)
        phi = float(rng.uniform(0, 360))
        crop = augment_crop(turn(crop, phi), rng)
        cos, sin = orient_vector(phi)
        return classifier_tensor(crop), torch.tensor(label), torch.tensor(cos, dtype=torch.float32), \
            torch.tensor(sin, dtype=torch.float32), torch.tensor(1.0)
