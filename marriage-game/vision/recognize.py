"""Long-running card recognition worker for the Node server.

Reads one JSON request per line on stdin: {"id": "<hex>", "path": "<photo path>"}.
Writes one JSON reply per line on stdout:
  {"id", "cards": [{"id", "code", "confidence", "alternatives", "thumb", "corners"}]}
  or {"id", "error"}.
Each card's full-size crop is saved as <pending_dir>/<card id>.jpg so a corrected
label can later be kept as a training sample.

Usage: python recognize.py <model.onnx> <labels.json> <pending_dir>
"""
import base64
import json
import os
import sys

# Refuse photos that decode to more than ~130 megapixels (a small PNG can hide billions of pixels).
# Must be set before OpenCV is imported.
os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS', str(1 << 27))

import cv2
import numpy as np
import onnxruntime as ort

from detect import find_cards

INPUT_SIZE = 224
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
THUMB_SIZE = (80, 120)


def preprocess(crops):
    """BGR card crops -> normalised NCHW float batch."""
    batch = []
    for crop in crops:
        rgb = cv2.cvtColor(cv2.resize(crop, (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        batch.append(((rgb.astype(np.float32) / 255.0 - MEAN) / STD).transpose(2, 0, 1))
    return np.stack(batch).astype(np.float32)


def softmax(logits):
    shifted = np.exp(logits - logits.max(axis=1, keepdims=True))
    return shifted / shifted.sum(axis=1, keepdims=True)


def thumbnail(crop):
    ok, buffer = cv2.imencode('.jpg', cv2.resize(crop, THUMB_SIZE, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 70])
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.tobytes()).decode('ascii') if ok else ''


class Recognizer:
    def __init__(self, model_path, labels_path, pending_dir):
        self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
        self.input_name = self.session.get_inputs()[0].name
        with open(labels_path) as handle:
            self.labels = json.load(handle)
        self.pending_dir = pending_dir
        os.makedirs(pending_dir, exist_ok=True)

    def recognize(self, request_id, path):
        try:
            image = cv2.imread(path, cv2.IMREAD_COLOR)  # also applies the photo's EXIF rotation
        except cv2.error:  # e.g. over the pixel limit set above
            image = None
        if image is None:
            raise ValueError('Could not read the photo.')
        found = find_cards(image)
        if not found:
            return []
        probabilities = softmax(self.session.run(None, {self.input_name: preprocess([card['crop'] for card in found])})[0])
        cards = []
        for index, card in enumerate(found):
            ranked = np.argsort(-probabilities[index])[:3]
            card_id = f'{request_id}-{index}'
            cv2.imwrite(os.path.join(self.pending_dir, card_id + '.jpg'), card['crop'])
            cards.append({
                'id': card_id,
                'code': self.labels[int(ranked[0])],
                'confidence': round(float(probabilities[index][ranked[0]]), 4),
                'alternatives': [
                    {'code': self.labels[int(k)], 'confidence': round(float(probabilities[index][k]), 4)} for k in ranked[1:]
                ],
                'thumb': thumbnail(card['crop']),
                'corners': [[round(float(x), 1), round(float(y), 1)] for x, y in card['corners']],
            })
        return cards


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    recognizer = Recognizer(*sys.argv[1:4])
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = str(request['id'])
            reply = {'id': request_id, 'cards': recognizer.recognize(request_id, request['path'])}
        except Exception as error:  # report every failure to the server instead of dying
            reply = {'id': request_id, 'error': str(error)}
        print(json.dumps(reply), flush=True)


if __name__ == '__main__':
    main()
