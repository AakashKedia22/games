# Plan v4b: fill a player's cards from a phone photo

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game` (v4a committed as `0538d5b`).

## How it works

1. A player lays their 30 cards flat and apart on a dark cloth and taps **📷 Photo** in the card picker.
2. The phone re-encodes the photo as a JPEG (this also handles iPhone HEIC) and uploads it to the game server on the laptop over Wi-Fi. Nothing leaves the local network.
3. The server passes it to a long-running Python worker (`vision/recognize.py`). The worker:
   - finds each card with OpenCV (`vision/detect.py`)
   - straightens each card into an upright crop
   - classifies all the crops at once with an EfficientNet-B0 model exported to ONNX
4. The phone shows a **check screen**:
   - a thumbnail of every detected card with its label
   - low-confidence cards marked "Check"
   - tap a card to fix it, or to mark it "Not a card"
5. **Use N cards** fills the picker, and v4a scores the hand.
6. With "Keep these photos" ticked, each confirmed crop is saved under `data/vision/samples/<card>/` and is used the next time the model is retrained.

The model comes from training (`vision/train.py`). The recipe is adapted from ajojotank/Playing-Card-Recognition-with-EfficientNet-B0 (MIT), trained on the Kaggle "Cards Image Dataset-Classification" plus the user's own saved samples. Until a model exists, the photo button shows "Card recognition is not set up…" and manual entry keeps working.

## Already done (do NOT modify)

All written and tested (Python: 10 tests including a tiny end-to-end training run; Node: 7 new server tests; client: 5 tests; plus a real Node → Python worker run on a 30-card synthetic photo):

- `vision/`:
  - `detect.py`, `classes.py`, `recognize.py`, `train.py`, `pytest.ini`
  - `requirements.txt` (runtime + tests), `requirements-train.txt` (PyTorch)
  - `tests/`
- `server/vision.mjs`:
  - `createRecognizer`, `recognizePhoto`, `saveSamples`, `readBody`, `visionPaths`, `MAX_PHOTO_BYTES`
  - tests in `server/vision.test.mjs`
- `src/recognition.js` (+ test), `src/PhotoReview.js`
- `src/CardPicker.js`: now has the photo button and the check screen. No App.js change is needed.

---

## Phase 1: `server.mjs` routes

1.1 Add the import after the sessions import:
```js
import { MAX_PHOTO_BYTES, createRecognizer, readBody, recognizePhoto, saveSamples, visionPaths } from './server/vision.mjs';
```

1.2 After `const sessions = loadSessions(DATA_FILE);` add:
```js
const VISION = visionPaths(__dirname);
const recognizer = createRecognizer(VISION);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
```

1.3 In the request handler, directly after the `/health` block (before `/api/info`), add:
```js
  if (requestPath === '/api/vision' && req.method === 'GET') {
    sendJson(res, 200, { available: recognizer.available() });
    return;
  }
  if (requestPath === '/api/recognize' && req.method === 'POST') {
    readBody(req, MAX_PHOTO_BYTES)
      .then(photo => recognizePhoto(recognizer, VISION, photo, req.headers['content-type']))
      .catch(error => ({ status: error.status || 400, body: { error: error.message } }))
      .then(({ status, body }) => sendJson(res, status, body));
    return;
  }
  if (requestPath === '/api/training-samples' && req.method === 'POST') {
    readBody(req, 1024 * 1024)
      .then(raw => ({ status: 200, body: { saved: saveSamples(VISION, JSON.parse(raw.toString('utf8') || '{}').samples) } }))
      .catch(error => ({ status: error.status || 400, body: { error: 'Could not save the samples.' } }))
      .then(({ status, body }) => sendJson(res, status, body));
    return;
  }
```

1.4 In the `server.listen` callback, after the `Data:` log line, add:
```js
  console.log(`  Cards:   ${recognizer.available() ? 'photo recognition ready' : 'photo recognition not set up (see README)'}`);
```

## Phase 2: `package.json` scripts and `.gitignore`

2.1 Add these scripts (keep the existing ones):
```json
    "vision:setup": "uv venv vision/.venv --python 3.12 && uv pip install --python vision/.venv/bin/python -r vision/requirements.txt",
    "vision:setup-train": "uv pip install --python vision/.venv/bin/python -r vision/requirements-train.txt",
    "vision:test": "cd vision && .venv/bin/python -m pytest -q",
    "vision:train": "vision/.venv/bin/python vision/train.py"
```

2.2 Append to `.gitignore`:
```
# card recognition: environment, dataset and trained model stay local
/vision/.venv
/vision/datasets
/vision/models
__pycache__/
.pytest_cache/
```

## Phase 3: `src/App.css` — append (write exactly)

```css
/* ---- v4b: photo recognition ---- */
.card-picker-actions { display: flex; gap: 6px; }
.photo-btn { display: inline-flex; align-items: center; justify-content: center; margin: 0; cursor: pointer; }
.photo-btn.is-busy { opacity: .6; pointer-events: none; }
.photo-review { display: grid; gap: 8px; }
.photo-review-head { margin: 0; }
.check-count { color: var(--danger); font-weight: 600; }
.photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; }
.photo-card {
  position: relative;
  display: grid;
  gap: 2px;
  justify-items: center;
  margin: 0;
  padding: 3px;
  background: white;
  color: var(--ink);
  border: 2px solid #cbd8ce;
  border-radius: 8px;
}
.photo-card img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 4px; }
.photo-card.check { border-color: var(--danger); }
.photo-card.active { border-color: var(--green); box-shadow: 0 0 0 2px var(--green); }
.photo-card.removed img { opacity: .3; }
.photo-label { font-size: .85rem; font-weight: 700; }
.photo-label.red { color: #c0392b; }
.check-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--danger);
  color: white;
  font-size: .6rem;
  font-weight: 700;
}
.card-chooser { display: grid; gap: 8px; padding: 8px; background: #f8faf6; border: 1px solid var(--line); border-radius: 8px; }
.chooser-guesses { display: flex; flex-wrap: wrap; gap: 6px; }
.card-chip.selected { background: var(--green); color: white; border-color: var(--green); }
.remove-chip { color: var(--danger); }
.keep-samples { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
.photo-actions { display: flex; gap: 8px; }
.photo-actions button { margin: 0; }

@media (max-width: 700px) {
  .photo-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .photo-actions button { flex: 1 1 0; }
}
```

## Phase 4: README — add a "Card recognition (photo)" section

Write it in plain steps:
1. **Install** (once, needs internet): `npm run vision:setup`, then for training also `npm run vision:setup-train`. Needs `uv` (https://docs.astral.sh/uv/). It downloads Python 3.12 into `vision/.venv`.
2. **Get the dataset** (once):
   - Sign in to Kaggle and download "Cards Image Dataset-Classification" (https://www.kaggle.com/datasets/gpiosenka/cards-image-datasetclassification).
   - Unzip it so you have `vision/datasets/cards/train`, `valid` and `test`.
   - Check the dataset's licence on that page.
3. **Train**: `npm run vision:train`. It uses the Mac GPU (MPS), takes about 15–30 minutes, and prints test accuracy at the end. It writes `vision/models/cards.onnx`, `labels.json` and `metrics.json`. Restart the server afterwards.
4. **Taking a good photo**:
   - all 30 cards face up, not touching, on a dark plain cloth
   - even light, no glare
   - phone held flat above the cards, cards filling the frame
5. **Improving it**: keep "Keep these photos" ticked. Corrected cards are saved in `data/vision/samples/`, and re-running `npm run vision:train` includes them, which teaches the model your own decks. Do this especially for the printed jokers.
6. **Tests**: `npm run vision:test`.
7. **Credit**: the training recipe is adapted from ajojotank/Playing-Card-Recognition-with-EfficientNet-B0 (MIT licence, © 2024 Joash Paul).

Also add to the features list: **Photo entry**: photograph a player's cards, check the detected cards, and the hand is scored. Recognition runs offline on the laptop. Add `vision/`, `server/vision.mjs`, `src/recognition.js` and `src/PhotoReview.js` to the project structure.

## Phase 5: Verification

1. `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm test` must pass all suites (report counts; expect 10 suites).
2. `npm run test:server` must pass (expect 21).
3. `CI=true npm run build` must say "Compiled successfully." with no warnings.
4. `npm run vision:setup` then `npm run vision:test`. The runtime tests must pass. `test_train.py` is skipped unless the training packages are installed; that is expected. Report the pytest summary line.
5. Start `PORT=3101 node server.mjs` in the background:
   - `curl -s localhost:3101/api/vision` should print `{"available":false}`, because there is no model yet.
   - `curl -s -X POST -H 'Content-Type: image/jpeg' --data-binary @/dev/null localhost:3101/api/recognize` should return the "not set up" error with HTTP 503 (use `-w '%{http_code}'`).
   - Stop the server.
6. Do not commit. Do not modify the files listed under "Already done". Do not touch begum-chor. Do not delete PLAN files or `data/`.
