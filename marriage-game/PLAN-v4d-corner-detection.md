# Plan v4d: read the corner index of each card (rank + suit), so real photos with overlapping cards work

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game`. The v4b and v4c changes are in the working tree and not committed. **Don't commit. Don't touch `/Users/shreyaagarwal/aakashk_personal/projects/begum-chor`.** The test photos and their truth files stay out of the repo.

## Why the current pipeline fails, and what I checked

The current detector looks for each card's outline, then classifies the whole card. It found **0/30** cards in both real photos:

- **IMG_4641** (light rug with cream hexagon lines):
  - 9 identical pairs laid overlapping;
  - a JK 3♠ 5♠ fan;
  - a 9-card rotated fan where the other cards show only their bottom-right index, upside down.
- **IMG_4638** (dark rug with cream hexagon lines, the player's leg at the bottom edge):
  - five groups of 3, offset sideways, each showing its top-left index;
  - a 15-card strip fan where each strip is about ¼ of a card wide and shows only the top-left index.

The hexagon lines join the cards into one blob. Overlaps hide the card outlines. The only thing that is reliably visible is the **corner index**.

What I measured in `vision/.venv` (torch 2.15, torchvision 0.29.2, MPS available; no files written):

| Model | Train, MPS | Inference at 1600×1200 | Notes |
|---|---|---|---|
| Stock `fasterrcnn_mobilenet_v3_large_fpn` | 1.39 s/iter (batch 4, 1600 px) | — | Features at stride 32 only (25×25 for a 800 px input). Too coarse for indices about 20×45 px. |
| **mobilenet_v3_large + FPN on `returned_layers=[2,3,4]`** (stride 8/16/32) | **1.21 s/iter (batch 8, 640×640 crops)** | **0.5 s torch CPU, 0.62 s onnxruntime CPU** | Exports to ONNX (opset 17, `dynamo=False`) with dynamic height and width. |
| `fasterrcnn_resnet50_fpn` | 3.07 s/iter (batch 8, 640) | — | ~2.5× slower to train. |
| `fasterrcnn_resnet50_fpn_v2` | out of memory | — | MPS ran out of memory at batch 4, 1600 px. |

- **Pathological timing (risk, not chased):** one run took 475 s CPU inference with the stride-8 mobilenet model. That model had diverged random weights after 5 SGD steps; a fresh model took 0.5 s. If the trained model is ever slow on CPU, check for NaN weights and the score threshold first.
- Cached weights: no torchvision weights in `~/.cache/torch`. timm `efficientnet_b0.ra_in1k` is in the HF cache. Training downloads the ImageNet mobilenet_v3_large weights once (~22 MB, BSD).
- `/usr/bin/sips` exists, so HEIC can be converted.
- **Ground truth for IMG_4638 is not confirmed:** the coordinator read it from the photo; the user hasn't confirmed it.

---

## Decisions

1. **Two stages, both ONNX, both permissively licensed:**
   - **Stage A, detector:** one class ("corner index"). torchvision Faster R-CNN on a mobilenet_v3_large FPN with stride-8/16/32 levels and small anchors (BSD).
   - **Stage B, index classifier:** timm EfficientNet-B0 (Apache-2.0) on a 128×128 crop of each detection, with two heads:
     - 53-class card code;
     - `(cos φ, sin φ)` of the index's "up" direction.
   - **Why two stages:** the detector only has to learn one generic, very regular pattern. It doesn't need 53 classes with few examples each. The classifier then reads a sharp crop taken from the full-resolution photo.
   - **Why the orientation head:**
     - It tells a 6 from an upside-down 9, by where the pip sits relative to the digit.
     - Counting needs it.
   - **Why not the alternatives:**
     - YOLOv8/ultralytics is AGPL, so excluded.
     - ssdlite320 is too low-resolution.
     - ResNet50 is 2.5× slower to train.
     - Pure OpenCV ink blobs get confused by face-card art and the hexagon lines.
2. **Counting = geometric grouping of index detections.**
   - Each detection predicts where its card's centre is: from its position, its up direction, and the photo's card size.
   - Two detections of the same code are **one card** only if both hold:
     - their up directions are roughly opposite (dot < −0.8);
     - their predicted centres agree within 0.12 card heights.
   - Same-orientation detections never merge. So `5H 5H 5H` strips count 3, and `3H 3H` pairs count 2.
   - Details are in Phase 3.
3. **Training data: synthetic scenes made from card faces.** The faces come from:
   - **(c) the user's own deck capture (strongly recommended).** Five photos, about 5 minutes. These are the exact printed glyphs of the deck in use.
   - **(b) faces rendered from macOS system fonts plus drawn pips.** This adds variety and lets training run before any capture.
   - **Confirmed review crops** saved by the app (`data/vision/samples/`). These now teach the classifier.
   - **(a) The Kaggle gpiosenka dataset is dropped.**
     - Its images are 224×224 whole cards in many deck styles, so a corner index is about 20 px.
     - There are no index boxes.
     - Its listed licence is CC0. I didn't re-verify that offline; it doesn't matter, because it isn't used.
4. **HEIC** (only for evaluation and deck capture on the laptop): convert with macOS `sips`. pillow-heif is not used: its wheels bundle LGPL/GPL codecs (libheif/libde265/x265). The server still accepts only JPEG/PNG/WebP. The phone already re-encodes to JPEG (`prepareUpload`).
5. **`detect.py` (outline detector) is kept, but only for deck capture.** Deck capture uses a plain dark cloth with the cards apart, where it works. It is removed from the recognition path. `ignoredAtEdge` is always 0; the field stays for protocol compatibility.
6. **Protocol is unchanged except for one additive field.** Each card gets a `check: boolean` field. The client shows "Check" when `check` is true, or when confidence is below 0.6. `corners` becomes the card's estimated outline.
7. **Thumbnails:** the upright index crop (rotated by the predicted angle), padded to 80×120. This is what the user needs in order to verify the card.

---

## Phase 0: file map

| File | Action |
|---|---|
| `vision/photo_io.py` | **new**: `load_photo(path)` (HEIC via sips), `resize_long(image, side)` |
| `vision/geometry.py` | **new**: card geometry constants, scale estimate, centre prediction, grouping, copy limit, reading order (numpy only) |
| `vision/corner_models.py` | **new**: `build_detector`, `IndexNet`, `index_crop`, `CROP_SIZE`, preprocessing shared by training and inference (torch imports only inside the functions that need them) |
| `vision/cards_render.py` | **new**: rendered card faces with exact index boxes |
| `vision/backgrounds.py` | **new**: procedural backgrounds (hexagon rugs etc.) and distractors |
| `vision/synth.py` | **new**: scene synthesis (piles, strip fans, rotated fans), visibility labels |
| `vision/capture_deck.py` | **new**: deck capture → faces + index boxes + `geometry.json` |
| `vision/train.py` | **replace**: trains detector + classifier, exports `corners.onnx`, `cards.onnx`, `labels.json`, `geometry.json`, `metrics.json` |
| `vision/recognize.py` | **rewrite** the `Recognizer` internals; keep the JSON-lines protocol |
| `vision/evaluate.py` | **new** |
| `vision/detect.py` | add a `size=(CARD_W, CARD_H)` parameter to `warp_card`; no other change |
| `vision/classes.py` | add `MAX_COPIES = 3` |
| `vision/tests/` | new `test_geometry.py`, `test_synth.py`, `test_capture.py`, `test_evaluate.py`, `test_photo_io.py`; rewrite `test_recognize.py` and `test_train.py`; keep `test_detect.py` and `test_classes.py` |
| `server/vision.mjs` (+ test) | add the `detector` path |
| `src/recognition.js` (+ test) | honour `card.check` |
| `src/CardPicker.js` (+ test if text changes) | new "no cards" message |
| `package.json` | add the `vision:capture` and `vision:evaluate` scripts |
| `README.md` | rewrite the "Card recognition" section |

Model files in `vision/models/`:
- `corners.onnx`: the detector;
- `cards.onnx`: the index classifier (same filename as before, so `visionPaths().model` is unchanged);
- `labels.json`;
- `geometry.json`;
- `metrics.json`.

---

## Phase 1: `vision/photo_io.py`

```python
HEIC_EXT = ('.heic', '.heif')
def load_photo(path):
    """BGR uint8 image. HEIC/HEIF converted with macOS sips into a TemporaryDirectory, then cv2.imread
    (applies EXIF rotation). Raises ValueError('Could not read the photo.') on failure; if sips is
    missing raises ValueError('HEIC needs macOS sips; convert the photo to JPEG first.')."""
    # sips command: ['sips', '-s', 'format', 'jpeg', path, '--out', tmp_jpg], check=True, capture_output=True, timeout=60
def resize_long(image, side):
    """Return (resized, scale) with the longer side == side (INTER_AREA when shrinking, INTER_LINEAR when growing)."""
```

`recognize.py` uses `load_photo` in place of `cv2.imread`. Keep the `OPENCV_IO_MAX_IMAGE_PIXELS` guard at the top of `recognize.py`, before cv2 is imported, and also at the top of `photo_io.py`.

---

## Phase 2: `vision/corner_models.py`

Constants:
```python
DETECT_SIDE = 1600          # photo long side fed to the detector at inference (and synthetic scene size)
TRAIN_CROP = 640            # detector training crop
CROP_SIZE = 128             # classifier input
CROP_CONTEXT = 1.3          # crop side = CROP_CONTEXT * max(box w, box h)
MEAN = (0.485, 0.456, 0.406); STD = (0.229, 0.224, 0.225)
```

### `build_detector(pretrained=True, train_size=TRAIN_CROP)`

```python
from torchvision.models import MobileNet_V3_Large_Weights
from torchvision.models.detection import FasterRCNN
from torchvision.models.detection.backbone_utils import mobilenet_backbone
from torchvision.models.detection.anchor_utils import AnchorGenerator
from torchvision.ops import MultiScaleRoIAlign
backbone = mobilenet_backbone(backbone_name='mobilenet_v3_large',
    weights=MobileNet_V3_Large_Weights.IMAGENET1K_V1 if pretrained else None,
    fpn=True, trainable_layers=6, returned_layers=[2, 3, 4])      # feature maps '0'(s8) '1'(s16) '2'(s32) + 'pool'
anchors = AnchorGenerator(sizes=((16,), (32,), (64,), (128,)), aspect_ratios=((0.5, 1.0, 2.0),) * 4)
model = FasterRCNN(backbone, num_classes=2, rpn_anchor_generator=anchors,
    box_roi_pool=MultiScaleRoIAlign(['0', '1', '2'], 7, 2),
    min_size=train_size, max_size=train_size,
    box_detections_per_img=300, box_nms_thresh=0.3, box_score_thresh=0.05,
    rpn_pre_nms_top_n_test=3000, rpn_post_nms_top_n_test=1000)
```

For export, set `model.transform.min_size = (1200,)` and `model.transform.max_size = DETECT_SIDE`. Export with:

```python
torch.onnx.export(model, ([x],), path, dynamo=False, opset_version=17,
    input_names=['image'], output_names=['boxes', 'labels', 'scores'],
    dynamic_axes={'image': {1: 'h', 2: 'w'}})
```

- `x` is a float tensor of shape `[3, 1200, 1600]` with values in 0..1 (RGB). The model normalises internally.
- I verified this export and dynamic-size run.

### `class IndexNet(nn.Module)`

- `self.body = timm.create_model('efficientnet_b0', pretrained=pretrained, num_classes=0)` (1280 features).
- `self.cls = nn.Linear(1280, 53)` and `self.orient = nn.Linear(1280, 2)`.
- `forward(x)` returns `(logits, orient)`.
- Export: input `image [batch, 3, 128, 128]`; outputs `logits`, `orient`; batch axis dynamic; check against PyTorch with `atol=1e-3`, as `train.py` does today.

### `index_crop(image, box, rng=None) -> (crop uint8 128x128x3, side)`

- Square centred on the box centre, side = `CROP_CONTEXT * max(w, h)`.
- If `rng` is given (training only): side ×U(0.9, 1.2), and the centre jitters by ±0.08·side.
- Taken with `cv2.warpAffine` (scale + translate), `borderMode=cv2.BORDER_REPLICATE`, output 128×128.

### Other helpers

- `to_classifier_batch(crops)`: BGR→RGB, /255, normalise, NCHW float32.
- `angle_of(orient)`: φ in degrees = `atan2(sin, cos)`.
- **Angle convention (used everywhere):** φ = 0 means the index is upright. φ is positive clockwise in the image. The index's up vector is `u = (sin φ, −cos φ)` in image coordinates (y down). Its right vector is `r = (−u_y, u_x)` = `(cos φ, sin φ)`.

---

## Phase 3: `vision/geometry.py` (the counting logic; pure numpy)

### Constants

Card height is 1. These are the defaults, measured on this deck from IMG_4638. `geometry.json` from deck capture overrides them.

```python
CARD_ASPECT = 0.70        # width / height
INDEX_CX = 0.115          # index-box centre from the card's left edge, in card heights
INDEX_CY = 0.14           # ... from the top edge
INDEX_H = 0.22            # index-box height (rank + pip), in card heights
JOKER_CY = 0.20; JOKER_H = 0.34   # printed joker: 'JOKER' written vertically
MERGE_TOL = 0.12          # centres closer than this (card heights) can be one card
AMBIGUOUS_TOL = 0.08      # a merge between 0.08 and 0.12 is flagged Check
RELAXED_TOL = 0.25        # used only to bring a code back under the copy limit
OPPOSITE_DOT = -0.8       # up vectors this opposite (about 37 degrees of slack)
CROSS_CODE_TOL = 0.08     # two different codes may merge only this tightly and only if one is in the other's top 3
LOW_DETECT_SCORE = 0.6    # detections below this are flagged Check
MIN_DETECT_SCORE = 0.4    # below this they are dropped
MAX_COPIES = 3
```

`load_geometry(path)` returns a dict of these constants, overridden by the JSON keys `card_aspect`, `index_cx`, `index_cy`, `index_h`, `joker_cy`, `joker_h` when the file exists.

### Detection input

A detection is a dict:
- `centre` (x, y in photo px), `box` (x0, y0, x1, y1), `score`;
- `probs` (np.array of 53), `code` (argmax label), `phi` (degrees).

### 3.1 `estimate_card_height(dets, geo)`

- Look at non-joker detections whose φ is within 20° of a multiple of 90°:
  - φ near 0 or 180: index length L = box height;
  - φ near 90 or 270: L = box width.
- Hpx = median(L) / `index_h`.
- If there are none, use median(max(w, h)) / `index_h`.
- If there are no detections at all, return None.

### 3.2 `card_centre(det, Hpx, geo)`

```
u = (sin φ, −cos φ); r = (cos φ, sin φ)
cx = geo.card_aspect/2 − geo.index_cx ;  cy = 0.5 − (joker_cy if code=='JK' else index_cy)
centre = p + r·cx·Hpx − u·cy·Hpx
```

This is the same formula for the top-left index and the bottom-right index (the bottom-right one is just the 180°-rotated copy). So both indices of one card predict the same centre.

### 3.3 `calibrate(dets, Hpx, geo)`

1. For every same-code pair with dot(u_i, u_j) < OPPOSITE_DOT, compute the ratio |p_j − p_i| / |expected|, where |expected| = Hpx·hypot(card_aspect − 2·index_cx, 1 − 2·cy).
2. Keep the ratios between 0.8 and 1.25, and only for pairs whose centres (§3.2) agree within 2·MERGE_TOL.
3. If at least one ratio is kept, Hpx *= median(ratios).

Do this once.

### 3.4 `group_cards(dets, geo) -> list of cards`

Each card is `{'code', 'probs', 'members': [det indices], 'centre', 'phi', 'check': bool, 'reasons': [..]}`.

1. Drop detections with score < MIN_DETECT_SCORE.
2. Run §3.1 and §3.3, then compute the centres.
3. **Candidate pairs (i < j):**
   - opposite: dot(u_i, u_j) < OPPOSITE_DOT;
   - cost = |c_i − c_j| / Hpx;
   - same code: valid if cost < MERGE_TOL;
   - different codes: valid if cost < CROSS_CODE_TOL **and** (code_j is in the top 3 of probs_i, or code_i is in the top 3 of probs_j).
4. **Matching:** greedy over the candidates sorted by cost, ascending. Accept a pair if neither detection is used yet; each detection joins at most one pair.
   - A merged card's probs = normalised (probs_i + probs_j); code = argmax.
   - Flag `check` (reason `'ambiguous'`) when any of these holds:
     - AMBIGUOUS_TOL ≤ cost;
     - it was a cross-code merge;
     - either detection had ≥ 2 valid candidates.
5. Every unused detection becomes a 1-member card (no flag just for being seen at one corner only).
6. **Copy limit.** While some code has more than MAX_COPIES cards:
   - Among its 1-member cards, find opposite pairs with cost < RELAXED_TOL. Merge the cheapest one and flag both reasons `'copies'` and `'ambiguous'`.
   - If there is no such pair, flag every card of that code (reason `'copies'`) and stop for that code. The client then drops the extras and shows its existing "Over the copy limit" line.
7. A card is flagged `'low-score'` if any member's score < LOW_DETECT_SCORE.
8. `card_quad(card, Hpx, geo)` gives the 4 corners of the estimated card outline, from its centre, φ and size: `±(aspect/2)·Hpx·r ± 0.5·Hpx·u`. The order is tl, tr, br, bl in the card's own frame.
9. Return the cards in reading order by centre, using the same row logic as `detect._reading_order` (row gap = Hpx/2). Implement it locally on the centres.

### 3.5 Ambiguity cases, and how the review screen shows them

| Case | What happens | Screen |
|---|---|---|
| Full card, both corners visible | merged into 1 | normal |
| Identical pair, both bottom-right corners visible, lower top-left hidden | top-left 1 + bottom-right 1 merge; bottom-right 2 is alone → 2 | normal |
| Identical pair placed exactly so that card A's top-left and card B's bottom-right look like one card | **under-count by 1** (cannot be told from the geometry) | only flagged if the cost is ≥ 0.08; the user adds the missing card with the picker (the "Using 29 of 30" warning shows) |
| A corner misread (6 vs 9) | cross-code merge if tight; otherwise 2 cards | Check |
| More than 3 of a code | relaxed merge, else flagged | Check, plus "Over the copy limit" |
| Low detector score (partly covered index) | kept | Check |

---

## Phase 4: card faces

### 4.1 `vision/cards_render.py`

**Face size.** `FACE_H = 800` and `FACE_W = 560`.

**`render_face(code, rng) -> (face BGR uint8 800x560, index_box_tl (x0,y0,x1,y1))`**
- Off-white background (230–252), with fine speckle noise.
- Index:
  - rank text: `ImageFont.truetype` with a random font from `FONTS`, height ≈ 0.11·H;
  - pip drawn below it, height ≈ 0.07·H;
  - centred at x = 0.115·H, top at y ≈ 0.035·H.
  - Jitter: position ±0.02·H, size ±15%.
- Colours: red (H/D) is about BGR (40, 40, 200) ± 25; black (S/C) is (25, 25, 25) ± 15.
- Bottom-right index: paste the same patch rotated 180°.
- Centre of the card:
  - number cards: rank-count pips on a standard layout grid;
  - J/Q/K: a random "art" rectangle (0.18–0.82·W, 0.12–0.88·H) with coloured blobs and lines (yellow, red, black, blue), plus a thin frame;
  - **JK**: "JOKER" written vertically, letter by letter, as the index (box height ≈ 0.34·H), with random art in the middle.
- The index box is computed from the ink actually drawn (bounding box of the non-background pixels of the index patch).

**Fonts.** `FONTS` lists macOS fonts, skipping missing files:
- `/System/Library/Fonts/Supplemental/`: `Arial.ttf`, `Arial Bold.ttf`, `Arial Narrow.ttf`, `Times New Roman.ttf`, `Georgia.ttf`, `Courier New Bold.ttf`, `Verdana.ttf`, `Tahoma.ttf`, `Trebuchet MS.ttf`;
- `/System/Library/Fonts/`: `Helvetica.ttc`, `Avenir.ttc`, `Courier.ttc`;
- fallback `ImageFont.load_default(size=...)`.

**Pips.** Pips are drawn with `cv2.fillPoly` and circles:
- diamond: a 4-point rhombus;
- heart: two circles plus a triangle;
- spade: an upside-down heart plus a stem triangle;
- club: three circles plus a stem.

### 4.2 `vision/capture_deck.py` (user action; reuses `detect.find_cards`)

```
usage: capture_deck.py --deck NAME S=photo H=photo D=photo C=photo JK=photo [--out vision/datasets/deck]
```

**Photo rules.** Each suit photo has 13 cards of one suit laid **A,2,…,10,J,Q,K in reading order** (rows of 5, 5, 3), apart from each other, on a plain dark cloth. The JK photo has 1–3 jokers.

**For each photo:**
1. `load_photo`, then `detect.find_cards_with_edges(image)`. The JK photo needs at least 1 card; every suit photo needs exactly 13.
2. If the count is wrong, write `<out>/<deck>/problem_<key>.jpg` (outlines numbered in reading order) and stop with: `S photo: found 12 cards, expected 13. Lay them apart on a dark plain cloth; see problem_S.jpg`.
3. For each card, warp it from the full-resolution photo with `warp_card(image, corners, size=(560, 800))`.
4. Save `<out>/<deck>/faces/<code>.png`. For JK, save `JK_1.png`, `JK_2.png`, …

**`find_index_box(face, joker=False)`**
1. Region: `face[0:0.38H, 0:0.24W]`; for the joker, `[0:0.55H, 0:0.20W]`.
2. Ink mask: `(gray < 140) | ((S > 90) & (V < 235))` in HSV, then a 2×2 morphological open.
3. Connected components with area ≥ 0.00005·H·W, bbox x0 < 0.16·W and y0 < 0.30·H (0.50·H for the joker).
4. Take the union of their bounding boxes.
5. Sanity check:
   - height in [0.12, 0.35]·H (joker [0.20, 0.60]·H);
   - width in [0.04, 0.25]·W.
6. If it fails the check, use the median box of the cards that passed (non-joker), and print `<code>: index box from the deck median`.
7. Do this for the top-left index, and for the bottom-right index on the face rotated 180°.
8. Save `boxes.json`: `{code_or_file: {"tl": [...], "br": [...]}}`, with the bottom-right box in the coordinates of the rotated face.

**`geometry.json`** in `<out>/<deck>/` holds the medians over the number cards:
- `card_aspect = W/H` (0.70 for these faces; the warp fixes the size, so keep the default);
- `index_cx`, `index_cy`, `index_h`: box centre and height, divided by H;
- `joker_cy` and `joker_h` from the joker boxes.

**`check.jpg`** is a contact sheet: every face at 140×200, its index box drawn, and its code written underneath. The user looks at it once.

---

## Phase 5: `vision/backgrounds.py`

```python
def random_background(rng, w, h, photo_dir='vision/datasets/backgrounds'):
```

Pick one style (if there are no user photos, their weight goes to hexagon rug):

| Style | Weight | Details |
|---|---|---|
| hexagon rug | 0.35 | Base colour from a palette: light brown (120,140,165)±20, dark brown (40,50,65)±15, grey, green, maroon, all BGR. Cream lines (170–215, 205–235, 215–245) BGR, thickness 2–12 px, hexagon radius 60–240 px, random rotation and offset. Fabric noise: Gaussian σ 3–10 plus a blurred low-frequency blotch. |
| plain + noise | 0.20 | |
| user photos | 0.20 | random crop, scale ×0.5–1.5, flip, from `vision/datasets/backgrounds/*.jpg` |
| blotchy texture | 0.15 | blurred multi-scale noise, wood-like stretched streaks |
| stripes / checker | 0.10 | |

**`add_distractors(rng, image)`:**
- 0–2 skin-coloured textured ellipses entering from an edge: BGR around (130,160,205)±30, plus hair-like dark strokes.
- 0–1 dark cloth blob at an edge (purple/maroon, soft gradient), as in the top-left of IMG_4641.

**`lighting(rng, image)`:**
- a linear or radial multiplicative gradient, 0.7–1.15;
- a random soft shadow polygon (×0.6–0.85).

---

## Phase 6: `vision/synth.py` (scenes and labels)

```python
def load_faces(deck_dir='vision/datasets/deck') -> list of (code, face, tl_box, br_box) from every deck folder (may be empty)
def make_scene(rng, faces, size=(1600, 1200), rendered_share=None) -> (image BGR, anns)
# anns: [{'code', 'box': [x0,y0,x1,y1], 'phi': deg, 'visible': float, 'card': card id}]
```

**Faces.** Each card picks a face:
- if captured faces exist: a captured face with p = 0.7, else `render_face`;
- with no captures: always rendered.

**Card scale.** One card height H per scene, H ~ U(200, 380) px, with ±3% per card.

**Groups.** 2–7 groups per scene. Codes are drawn from the 53 so that no code appears more than 3 times in a scene. Group types:

| Type | Share | Layout |
|---|---|---|
| single | 0.15 | one card |
| pile | 0.35 | 2–4 cards. All the same code with p = 0.6 (identical pairs and triples). Step along the card's right axis U(0.12, 0.45)·W; perpendicular jitter ±0.06·H; per-card angle jitter ±4°. Stacking direction left-on-top or right-on-top at random. |
| strip fan (IMG_4638) | 0.25 | 5–16 cards. Step U(0.14, 0.30)·W; angle increment U(−1, 4)° per card; perpendicular jitter ±0.03·H. |
| rotated fan (IMG_4641) | 0.25 | 3–10 cards, rotating about a pivot U(0.3, 0.8)·H below the card centres; angle step U(4, 12)°. |

Within a group, each card is flipped 180° with p = 0.3.

**Group rotation:** 60% U(−25, 25)°, 15% 180 ± 25°, 25% U(0, 360)°.

**Placement:** each group is placed at random. Reject a placement if its bounding circle overlaps an existing group's by more than 10% of the radius; up to 50 tries, then skip the group.

**Drawing.** Cards are drawn in order with `cv2.warpAffine`:
- rounded-corner alpha mask (radius 0.05·H);
- drop shadow (blurred mask, offset 2–8 px, darkening ×0.65–0.85);
- per-card brightness ×0.9–1.05.

An owner map (int16, −1 = background) records the top card at each pixel (alpha > 0.5).

**Labels:**
- Both index boxes of each card are transformed into polygons.
- `visible` = fraction of the polygon's pixels whose owner is this card.
- Keep an annotation when `visible ≥ 0.65` and at least 90% of the polygon is inside the image.
- The box is the polygon's axis-aligned bounding box.
- φ = the card's rotation (for the bottom-right index, card rotation + 180), normalised to [0, 360).

**After drawing:**
- `add_distractors`, `lighting`;
- a mild whole-scene perspective jitter (corners moved ≤ 3%), applied to the polygons too;
- Gaussian blur σ U(0, 1.4); noise σ U(0, 6);
- white balance ×U(0.9, 1.1) per channel;
- JPEG round trip at quality U(55, 95).

**Datasets** (torch is imported only inside the class bodies, so `make_scene` tests run without torch):
- `DetectorScenes(Dataset)`:
  - `__getitem__(i)` uses `rng = np.random.default_rng(seed + i)`;
  - scene scale jitter ×U(0.8, 1.25);
  - a random 640×640 crop;
  - keep boxes with at least 60% of their area inside the crop, clipped to it;
  - returns `(tensor 3×640×640 in 0..1 RGB, {'boxes': float32 [N,4], 'labels': int64 ones})`;
  - empty crops are allowed: torchvision accepts `boxes` of shape [0, 4].
- `IndexCrops(IterableDataset)`:
  - generates scenes forever (per-worker seeds from `get_worker_info`);
  - for each annotation, `index_crop(image, box, rng)` yields `(tensor, code index, cos φ, sin φ, has_angle=1)`;
  - local shuffle buffer of 512.
- `SampleCrops(Dataset)`:
  - reads `data/vision/samples/<code>/*.jpg` (the upright crops the app saves);
  - applies a random rotation φ ~ U(0, 360) with a replicate border;
  - returns `has_angle = 1` with that φ.
  - The angle label is right if the saved crop really was upright. To be safe, use `has_angle=0` when the folder file name doesn't start with `u-`. The new worker saves `u-` crops; see Phase 8.

---

## Phase 7: `vision/train.py` (replaces the Kaggle trainer)

**Arguments:**

| Flag | Default |
|---|---|
| `--decks` | `vision/datasets/deck` |
| `--backgrounds` | `vision/datasets/backgrounds` |
| `--samples` | `data/vision/samples` |
| `--out` | `vision/models` |
| `--det-iters` | 2000 |
| `--det-batch` | 8 |
| `--det-lr` | 0.02 |
| `--cls-steps` | 4000 |
| `--cls-batch` | 64 |
| `--cls-lr` | 1e-3 |
| `--val-scenes` | 60 |
| `--workers` | 4 |
| `--device` | auto (mps > cuda > cpu) |
| `--crop` | 640 |
| `--no-pretrained` | |
| `--skip-detector` | reuse an existing `corners.onnx` and `detector.pt`; only retrain the classifier, which is the quick path after saving samples |

**Steps:**
1. Load the faces and print `Faces: N captured (decks: …), rendered on the fly`. If there are none captured, print a warning: `No deck capture found: accuracy on real photos will be lower. See README "Capture your deck".`
2. **Detector:**
   - SGD, momentum 0.9, weight decay 1e-4;
   - linear warmup over 200 iterations, then cosine to 0;
   - log every 50 iterations;
   - `DataLoader(DetectorScenes(...), batch_size, shuffle=False, num_workers, collate_fn=lambda b: tuple(zip(*b)), persistent_workers=workers > 0)`.
   - About 1.2 s/iter on M3, so **about 40 min** at the defaults.
   - At the end, save `detector.pt` and export `corners.onnx` (Phase 2), checking ONNX boxes against PyTorch on one validation scene (`atol=1.0` px, same count).
3. **Detector validation:**
   - Run `val-scenes` scenes (seed 10_000_000 + i) at full 1600×1200 through the PyTorch model in eval mode.
   - Recall and precision at IoU 0.5, score ≥ MIN_DETECT_SCORE.
   - Print them and store them in metrics.
4. **Classifier:**
   - AdamW, weight decay 1e-4, cosine schedule;
   - batches mix `IndexCrops` with `SampleCrops` (about 10% when samples exist; repeat the samples to make the share);
   - loss = CE(label_smoothing = 0.05) + 0.5·mean_over_has_angle(1 − cos_sim(normalize(orient), target));
   - augmentation: ColorJitter(0.3, 0.3, 0.3, 0.03) and a random Gaussian blur.
   - Every 500 steps, report validation accuracy on 3000 fixed crops (seed 20_000_000) and the median angle error.
   - Keep the best `index.pt` and export `cards.onnx`.
   - About **10–15 min**.
5. **Write the outputs:**
   - `labels.json` (CODES);
   - `geometry.json` (from the first deck's `geometry.json`, else the defaults);
   - `metrics.json`: `{det_recall, det_precision, cls_accuracy, angle_error_deg, det_iters, cls_steps, captured_faces}`.
6. If `data/vision/eval/*.truth.json` exist, run `evaluate.main([...])` on them at the end and print the summary.

Total is **about 55 min** on the M3. `--det-iters 1200 --cls-steps 3000` takes about 30 min.

---

## Phase 8: `vision/recognize.py` (worker)

**Usage:** `python recognize.py <corners.onnx> <cards.onnx> <labels.json> <pending_dir>`. `geometry.json` is read from `dirname(cards.onnx)` if it is there.

**Protocol is unchanged:**
- startup line `{"ready": true}`;
- each request `{id, path}`;
- each reply `{id, cards, ignoredAtEdge: 0}` or `{id, error}`.

**`Recognizer.recognize_photo(request_id, path)`:**
1. `image = load_photo(path)`; `small, s = resize_long(image, DETECT_SIDE)`.
2. Run the detector on the RGB float CHW 0..1 input to get boxes, scores. Keep score ≥ MIN_DETECT_SCORE and scale the boxes by 1/s to full-resolution coordinates.
3. Take crops with `index_crop(image, box)`, plus each crop rotated 180°. Run the classifier once on the batch of 2N.
4. Per detection:
   - probs = (softmax(l₀) + softmax(l₁₈₀)) / 2;
   - u = normalize(o₀ − o₁₈₀), because rotating the crop 180° negates the orientation vector;
   - φ = atan2.
5. `group_cards(dets, geo)`.
6. For each card k:
   - id `f'{request_id}-{k}'`;
   - code, confidence = probs[code] (rounded to 4 places), alternatives = the next 2;
   - `check` = bool(card.check), `reasons` = list;
   - corners = `card_quad`.
   - Best member = highest score. Its crop is rotated upright by −φ (`cv2.getRotationMatrix2D` about the centre) at 128×128.
   - Save it to `<pending>/<id>.jpg`. `saveSamples` moves it to `samples/<code>/<id>.jpg`. To mark it as upright for training, `SampleCrops` treats all files saved after v4d as upright. **Simplification:** treat every sample as upright (`has_angle=1`), because v4d is the first version that saves samples and `data/vision/` doesn't exist yet. Drop the `u-` prefix idea in Phase 6.
   - thumb = the upright crop pasted centred onto white 80×120, JPEG q70 data URL.
7. Return `{'cards': [...], 'ignoredAtEdge': 0}`.

**For tests:** `Recognizer.__init__(..., detector=None, classifier=None)` accepts injected callables: `detector(rgb_float_chw) -> (boxes, scores)` and `classifier(batch) -> (logits, orient)`. The defaults wrap the ONNX sessions.

---

## Phase 9: `vision/evaluate.py`

```
usage: evaluate.py [--models vision/models] [--out data/vision/eval/out] [--strict] CASE [CASE ...]
CASE = truth.json  (photo taken from its "photo" key; relative paths resolved from the truth file's folder)
     | photo:truth.json
```

**Functions:**
- `compare(expected, got) -> {'correct': n, 'missing': [...], 'extra': [...]}`: multiset comparison with `collections.Counter`; lists sorted in CODES order.
- `main(argv)`: for each case, run `Recognizer.recognize_photo`, using a temporary pending dir, and print:

```
IMG_4641: found 30 / expected 30, correct 29, checks 3 (2 on mistakes)
  missing: 3H
  extra:   3D
```

Then a total line: `TOTAL: correct 57 / 60 over 2 photos`.

**Overlay image:** `<out>/<stem>.overlay.jpg`, 1600 px long side:
- each detection box (green if its card's code is in the truth with copies left, red otherwise);
- the label `code score`;
- an orientation arrow along u;
- a line joining the two members of a merged card;
- a dot at each card centre;
- check cards circled in orange.

**Exit code:** 1 with `--strict` when any case isn't fully correct; else 0. `main` returns the list of per-case results, for tests and for `train.py`.

---

## Phase 10: server, client, scripts

### `server/vision.mjs`
- `visionPaths` adds `detector: path.join(root, 'vision', 'models', 'corners.onnx')`.
- `available()` also checks `paths.detector`.
- Spawn args become `[paths.script, paths.detector, paths.model, paths.labels, paths.pending]`.
- `server/vision.test.mjs` line 64: change the expected args to match, and add `detector` to the test `PATHS`. Keep the `photoExtension('image/heic') === null` and 415 tests unchanged.

### `src/recognition.js`
- `startReview` adds `check: card.check === true`.
- `needsCheck`: `!card.removed && !card.confirmed && (card.check || card.confidence < LOW_CONFIDENCE || !parseCard(card.chosen))`.
- `recognition.test.js`: add a test where a card with `confidence: 0.95, check: true` needs a check, and stops needing one after `setChoice`.

### `src/CardPicker.js`
- The no-cards message becomes `'No cards found. Make sure each card's corner (rank and suit) is visible, fill the frame and try again.'`
- The test at `CardPicker.test.js:78` still matches `'No cards found'`.

### `src/PhotoReview.js`
- No change needed. The `ignoredAtEdge` note simply never shows.
- Optional: change the note to "Cards marked “Check” were hard to read or may be counted twice."

### `package.json` scripts (add)
```json
"vision:capture": "vision/.venv/bin/python vision/capture_deck.py",
"vision:evaluate": "vision/.venv/bin/python vision/evaluate.py",
```
`vision:setup`, `vision:setup-train`, `vision:train` and `vision:test` are unchanged.

### `.gitignore`
Already ignores `/vision/datasets`, `/vision/models` and `/data`. Add `/vision/datasets/backgrounds` only if the user wants it spelled out (it is already covered).

### Requirements
- `requirements.txt` is unchanged: runtime needs opencv, onnxruntime, numpy, pillow and pytest only.
- `requirements-train.txt` is unchanged (torch, torchvision, timm).

---

## Phase 11: tests (fast; no trained model)

### `tests/test_geometry.py`
Build detections by hand: helper `det(code, centre, phi, Hpx=300)` gives a box of index size (INDEX_H·Hpx tall, 0.45 of that wide, swapped near 90°), score 0.9, and one-hot probs with 0.9 on the code and 0.05 on two others. Positions are computed from the geometry constants, so the tests follow any change to them.

| # | Test | Expected |
|---|---|---|
| 1 | One card at φ = 0: its top-left index and its bottom-right index (φ = 180, at the opposite corner) | 1 card, 2 members, `check` False |
| 2 | `3H` pair, offset 0.3·W along x, 4 indices | 2 cards |
| 3 | Same pair, second card's top-left index left out (3 detections) | 2 cards |
| 4 | `5H ×3` strip, step 0.25·W: three top-left indices + the top card's bottom-right | 3 cards |
| 5 | Two `7C` at φ 0 and φ 180, 3 card heights apart | 2 cards |
| 6 | Rotated fan: 9 cards, φ = −40…+40, pivot below; the top card has both indices, the others only bottom-right | 9 cards |
| 7 | IMG_4638-style strip fan: 15 different codes, top-left only, step 0.25·W | 15 cards |
| 8 | Copy limit: four `7C` top-left indices far apart, same φ | 4 cards, all `check` with `'copies'` in reasons |
| 9 | Relaxed merge: two opposite `7C` with centre gap 0.2·H, plus two separate `7C` | 3 cards; the merged one `check` |
| 10 | Cross-code: `9D` and `6D` opposite at exact geometry, `6D` in the `9D` top 3 | 1 card, `check` True |
| 11 | `estimate_card_height` on upright detections | Hpx within 2% of 300; `calibrate` with a 10% scaled layout corrects it |
| 12 | `card_quad` | 4 points; centre within 1 px; reading order of a 2×3 grid of single cards is row by row |

### `tests/test_synth.py`
- `render_face` for all 53 codes (seed 0):
  - shape (800, 560, 3);
  - the top-left box lies inside `[0, 0.25W] × [0, 0.6H]`;
  - the mean ink inside the box is darker than the card mean.
- `make_scene(rng(0), [], size=(800, 600))`:
  - at least 1 annotation;
  - every box is inside the image;
  - every annotation has `visible ≥ 0.65`;
  - the same seed gives an identical image (`np.array_equal`).
- A forced strip-fan group (expose `make_group(rng, kind, ...)`) of 10 cards gives 10 top-left labels.

### Other new tests
- **`tests/test_backgrounds.py`:** a hexagon background (forced style) is 600×800×3 uint8, and the share of cream-line pixels is between 2% and 30%.
- **`tests/test_capture.py`:**
  - Draw 13 rendered faces (spades A..K) apart on the dark `table()` from `test_detect` (scaled to 120×170 via `warp`).
  - Run `capture_photo(image, 'S')`: 13 faces with codes `AS…KS` in order, and each `find_index_box` result in the top-left region.
  - A 12-card photo raises `ValueError` mentioning `found 12`.
- **`tests/test_photo_io.py`:**
  - a JPEG loads;
  - for HEIC, monkeypatch `subprocess.run` to write a JPEG to the `--out` path and assert that `sips -s format jpeg` was called;
  - a missing file raises `ValueError`.
- **`tests/test_evaluate.py`:** `compare(['3H','3H','JK'], ['3H','JK','JK']) == {'correct': 2, 'missing': ['3H'], 'extra': ['JK']}`. Then `main` on a synthetic case using an injected fake Recognizer (monkeypatch) prints `found` and writes the overlay.

### Rewritten tests
- **`tests/test_recognize.py`:**
  - Tiny ONNX stand-ins built with `onnx.helper`:
    - detector: a graph with input `image [3, h, w]` → `Shape`-independent `Constant` outputs: 3 boxes in the 1600-scale frame, labels, scores 0.9;
    - classifier: `GlobalAveragePool → Flatten → MatMul` → logits [batch, 53], plus a second `MatMul` → orient [batch, 2].
  - Worker round trip:
    - ready line;
    - reply with `ignoredAtEdge == 0`;
    - card ids `abc123-k`;
    - each card has `code` in CODES, `0 < confidence ≤ 1`, 2 alternatives, `check` is a bool, `thumb` is a JPEG data URL, 4 `corners`, and a pending jpg exists;
    - a missing file gives `{'id': 'bad1', 'error': 'Could not read the photo.'}`.
  - Keep the PNG-bomb test (update the argv to the 4 model args).
- **`tests/test_train.py`** (`importorskip('torch')`, `importorskip('timm')`):
  - `build_detector(pretrained=False)` in train mode on one 320×320 image with one box returns a dict of losses;
  - `train.main(['--decks', tmp/'none', '--samples', tmp/'none', '--out', out, '--det-iters', '2', '--det-batch', '2', '--crop', '320', '--cls-steps', '2', '--cls-batch', '4', '--val-scenes', '1', '--workers', '0', '--device', 'cpu', '--no-pretrained'])` writes `corners.onnx`, `cards.onnx`, `labels.json` == CODES, and `geometry.json`;
  - both ONNX files run in onnxruntime: the classifier gives logits (3, 53) and orient (3, 2); the detector gives boxes of shape (N, 4).
  - In this test, swap the classifier validation-crop count for a `--val-crops 16` argument (add that argument, default 3000).

Keep `test_detect.py` (all 13 tests) and `test_classes.py` unchanged.

### Expected results
- `npm run vision:test`: everything passes (≈ 40 tests). `test_train.py` takes about 30–60 s on CPU, and is skipped without torch.
- `CI=true npm test`: all suites pass.
- `npm run test:server`: all pass.
- `CI=true npm run build`: "Compiled successfully."

---

## Phase 12: README "Card recognition (photo)" (rewrite)

1. **Install:** `npm run vision:setup && npm run vision:setup-train`.
2. **Capture your deck** (once, about 5 minutes; this greatly improves accuracy):
   - On a plain dark cloth or towel (not the rug), lay all 13 spades apart, A to K, in rows of 5, 5, 3. Photograph from above.
   - Repeat for hearts, diamonds and clubs, then one photo of the jokers.
   - AirDrop the photos to the Mac (HEIC is fine).
   - Run `npm run vision:capture -- --deck main S=~/Downloads/IMG_1.HEIC H=… D=… C=… JK=…`.
   - Open `vision/datasets/deck/main/check.jpg` and make sure every label is right.
   - If the house decks have different designs, capture each one with its own `--deck` name.
3. **Optional:** photograph your empty rug or table 3–5 times and put the photos in `vision/datasets/backgrounds/`.
4. **Train:** `npm run vision:train` (about 55 min on an M3). It writes `vision/models/{corners.onnx, cards.onnx, labels.json, geometry.json, metrics.json}`. Restart the server afterwards.
5. **Check it on real photos:**
   - Put truth files in `data/vision/eval/` (format: `{"photo": "/path/IMG.HEIC", "cards": [...]}`).
   - Run `npm run vision:evaluate -- data/vision/eval/IMG_4641.truth.json data/vision/eval/IMG_4638.truth.json`.
   - Look at the overlays in `data/vision/eval/out/`.
6. **Taking a photo:**
   - any background is fine;
   - overlap and fan cards as usual, but keep every card's corner index (rank and suit) visible;
   - fill the frame and avoid glare.
7. **Improving it:** keep "Keep these photos" ticked. Confirmed crops go to `data/vision/samples/`. `npm run vision:train -- --skip-detector` retrains just the classifier in about 15 min.
8. **Licences:**
   - torchvision (BSD-3), timm (Apache-2.0), mobilenet_v3 / EfficientNet ImageNet weights (BSD / Apache);
   - no Kaggle data, no AGPL code;
   - system fonts are used only to render local training images.

---

## User actions (exact commands)

1. **Once:** `npm run vision:setup && npm run vision:setup-train`.
2. **Deck capture:** take the 5 photos described above, then:
   `npm run vision:capture -- --deck main S=<spades photo> H=<hearts photo> D=<diamonds photo> C=<clubs photo> JK=<jokers photo>`
   Then check `vision/datasets/deck/main/check.jpg`.
3. **Optional:** put 3–5 photos of the empty rug in `vision/datasets/backgrounds/`.
4. **Copy the truth files:**
   `mkdir -p data/vision/eval && cp <scratchpad>/photos/IMG_4641.truth.json <scratchpad>/photos/IMG_4638.truth.json data/vision/eval/`
   - `<scratchpad>` = `/private/tmp/claude-501/-Users-shreyaagarwal-aakashk-personal-projects-marriage-game/21938fd6-49c5-4a59-9da9-456f098923a6/scratchpad`.
   - Their `"photo"` keys point at `~/Downloads/IMG_4641.HEIC` and `IMG_4638.HEIC`.
   - **Confirm the IMG_4638 truth list first**: Claude read it from the photo.
5. **Train:** `npm run vision:train` (about 55 min).
6. **Evaluate:** `npm run vision:evaluate -- data/vision/eval/IMG_4641.truth.json data/vision/eval/IMG_4638.truth.json`.

## Acceptance targets

**IMG_4641 and IMG_4638, with deck capture:**
- **Target:** at least 28/30 correct per photo, and the found count within ±1 of 30.
- Every wrong card is either marked "Check" or shows up as "Using N of 30".
- **Ideal:** 30/30 on both.
- Hardest cards:
  - IMG_4641: the upside-down indices in the 9-card fan (9♦ vs 6♦), and the partly hidden lower cards of the pairs.
  - IMG_4638: the 15 narrow strips.

**Without deck capture (rendered faces only):** expect roughly 20–27/30. Do the capture.

**If the results fall short:**
1. **Missed indices (red or absent in the overlay):**
   - add rug photos to `vision/datasets/backgrounds/`;
   - run `npm run vision:train -- --det-iters 3000`.
2. **Misread codes:**
   - use the app on 3–5 real hands with "Keep these photos" ticked;
   - then run `npm run vision:train -- --skip-detector`.
3. **Miscounted pairs:**
   - the overlay shows the merge lines;
   - tune `MERGE_TOL` / `OPPOSITE_DOT` in `geometry.py`, or recapture the deck so `geometry.json` is exact.
4. **Last resort:** annotate 5–10 real photos for detector fine-tuning (not in this plan).

## Risks

- **Detector CPU speed.** The 0.6 s ONNX time was measured untrained. One 475 s CPU run came from a diverged model.
  - If inference is slow, check for NaN weights.
  - Keep `box_score_thresh` at 0.05 and `rpn_post_nms_top_n_test` at 1000.
  - The worker timeout is 60 s.
- **The synthetic-to-real gap** is the main accuracy risk. Deck capture and saved samples are how to close it.
- **Training time** depends on DataLoader workers producing scenes fast enough (about 50–100 ms per scene). Use `--workers 4`.

## Assumptions to confirm with the user

1. All three decks in play have the same design. If not, capture each one.
2. The user will do the deck capture: 5 photos on a dark plain cloth.
3. About 1 hour of training is acceptable; there is a 30-minute option.
4. Kaggle is dropped. The old whole-card classifier and the `vision/datasets/cards` path are removed.
5. HEIC is handled only on the Mac (via sips) for evaluation and capture. The phone upload path keeps converting to JPEG.
6. When an identical pair lines up exactly like the two corners of one card, it may count as 1. The user fixes this with the picker, prompted by the "Using 29 of 30" warning.
7. The IMG_4638 truth list needs the user's confirmation.

### Critical Files for Implementation
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/vision/geometry.py (new: grouping and counting)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/vision/synth.py (new: scenes and labels)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/vision/train.py (replace)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/vision/recognize.py (worker rewrite)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/vision.mjs (detector path and args) and /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/recognition.js (`check` flag)