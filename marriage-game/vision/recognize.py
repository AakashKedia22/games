"""Long-running card recognition worker for the Node server.

Reads one JSON request per line on stdin: {"id": "<hex>", "path": "<photo path>"}.
Writes one JSON reply per line on stdout:
  {"id", "cards": [{"id", "code", "confidence", "alternatives", "thumb", "corners", "check", "reasons"}],
   "ignoredAtEdge": 0}
  or {"id", "error"}.
Each card's upright index crop is saved as <pending_dir>/<card id>.jpg, so a corrected label can later be
kept as a training sample.

Usage: python recognize.py <corners.onnx> <cards.onnx> <labels.json> <pending_dir>
"""
import base64
import json
import math
import os
import sys

# Refuse photos that decode to more than ~130 megapixels. Set before OpenCV is imported (photo_io does it too).
os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS', str(1 << 27))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

from classes import CODES  # noqa: E402
from corner_models import DETECT_SIDE, index_crop, to_classifier_batch, upright  # noqa: E402
from geometry import MIN_DETECT_SCORE, card_quad, group_cards, load_geometry  # noqa: E402
from photo_io import load_photo, resize_long  # noqa: E402

THUMB_SIZE = (80, 120)
THUMB_JPEG_QUALITY = 70


def softmax(logits):
    shifted = logits - logits.max(axis=1, keepdims=True)
    exps = np.exp(shifted)
    return exps / exps.sum(axis=1, keepdims=True)


def thumbnail(upright_crop):
    """The upright index on a white THUMB_SIZE card, as a JPEG data URL."""
    canvas = np.full((THUMB_SIZE[1], THUMB_SIZE[0], 3), 255, np.uint8)
    side = THUMB_SIZE[0]
    top = (THUMB_SIZE[1] - side) // 2
    canvas[top:top + side] = cv2.resize(upright_crop, (side, side), interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode('.jpg', canvas, [cv2.IMWRITE_JPEG_QUALITY, THUMB_JPEG_QUALITY])
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.tobytes()).decode('ascii') if ok else ''


def _onnx_detector(path):
    """detect(rgb float CHW 0..1) -> (boxes, scores) from corners.onnx (outputs boxes, labels, scores)."""
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    name = session.get_inputs()[0].name

    def detect(rgb_chw):
        boxes, _labels, scores = session.run(None, {name: rgb_chw})
        return boxes, scores
    return detect


def _onnx_classifier(path):
    """classify(batch) -> (logits, orient) from cards.onnx."""
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    name = session.get_inputs()[0].name

    def classify(batch):
        logits, orient = session.run(None, {name: batch})
        return logits, orient
    return classify


class Recognizer:
    def __init__(self, detector_path, model_path, labels_path, pending_dir, detector=None, classifier=None, geometry=None):
        self.detect = detector if detector is not None else _onnx_detector(detector_path)
        self.classify = classifier if classifier is not None else _onnx_classifier(model_path)
        with open(labels_path) as handle:
            self.labels = json.load(handle)
        if geometry is None:
            geometry = load_geometry(os.path.join(os.path.dirname(model_path), 'geometry.json'))
        self.geometry = geometry
        self.pending_dir = pending_dir
        os.makedirs(pending_dir, exist_ok=True)

    def find_indexes(self, image):
        """Index detections in full-resolution photo pixels: [{'centre', 'box', 'score', 'probs', 'code', 'phi'}]."""
        small, scale = resize_long(image, DETECT_SIDE)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        boxes, scores = self.detect(np.ascontiguousarray(rgb.transpose(2, 0, 1)))
        boxes = np.asarray(boxes, np.float32).reshape(-1, 4)
        scores = np.asarray(scores, np.float32).reshape(-1)
        keep = scores >= MIN_DETECT_SCORE
        boxes = boxes[keep] / scale
        scores = scores[keep]
        if not len(boxes):
            return []
        crops = [index_crop(image, box)[0] for box in boxes]
        turned = [cv2.rotate(crop, cv2.ROTATE_180) for crop in crops]
        logits, orient = self.classify(to_classifier_batch(crops + turned))
        count = len(crops)
        probs = (softmax(np.asarray(logits)[:count]) + softmax(np.asarray(logits)[count:])) / 2
        orient = np.asarray(orient, np.float32)
        detections = []
        for k, box in enumerate(boxes):
            # Turning the crop by 180 degrees negates the orientation vector, so the difference doubles it.
            vector = orient[k] - orient[count + k]
            detections.append({
                'centre': ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2),
                'box': tuple(float(v) for v in box),
                'score': float(scores[k]),
                'probs': probs[k],
                'code': CODES[int(np.argmax(probs[k]))],
                'phi': math.degrees(math.atan2(float(vector[1]), float(vector[0]))),
            })
        return detections

    def recognize_photo(self, request_id, path):
        image = load_photo(path)
        detections = self.find_indexes(image)
        if not detections:
            return {'cards': [], 'ignoredAtEdge': 0, 'overlay': {'detections': [], 'cards': []}}
        cards = group_cards(detections, self.geometry)
        replies = []
        for index, card in enumerate(cards):
            card_id = f'{request_id}-{index}'
            probs = card['probs']
            ranked = np.argsort(-probs)[:3]
            code = card['code']
            best = max(card['members'], key=lambda member: detections[member]['score'])
            crop, _ = index_crop(image, detections[best]['box'])
            upright_crop = upright(crop, detections[best]['phi'])
            cv2.imwrite(os.path.join(self.pending_dir, card_id + '.jpg'), upright_crop)
            corners = card_quad(card, card['hpx'], self.geometry)
            replies.append({
                'id': card_id,
                'code': code,
                'confidence': round(float(probs[CODES.index(code)]), 4),
                'alternatives': [{'code': CODES[k], 'confidence': round(float(probs[k]), 4)} for k in ranked[1:3]],
                'thumb': thumbnail(upright_crop),
                'corners': [[round(float(x), 1), round(float(y), 1)] for x, y in corners],
                'check': bool(card['check']),
                'reasons': list(card['reasons']),
            })
        overlay = {
            'detections': [{'box': detection['box'], 'score': detection['score'], 'code': detection['code'],
                            'phi': detection['phi'], 'centre': [float(v) for v in detection['centre']],
                            'card': next(k for k, card in enumerate(cards) if index in card['members'])}
                           for index, detection in enumerate(detections)],
            'cards': [{'centre': [float(v) for v in card['centre']], 'phi': card['phi'], 'hpx': card['hpx'],
                       'members': list(card['members']), 'check': card['check'], 'code': card['code']} for card in cards],
        }
        return {'cards': replies, 'ignoredAtEdge': 0, 'overlay': overlay}


def main():
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    recognizer = Recognizer(*sys.argv[1:5])
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = str(request['id'])
            result = recognizer.recognize_photo(request_id, request['path'])
            reply = {'id': request_id, 'cards': result['cards'], 'ignoredAtEdge': result['ignoredAtEdge']}
        except Exception as error:  # report every failure to the server instead of dying
            reply = {'id': request_id, 'error': str(error)}
        print(json.dumps(reply), flush=True)


if __name__ == '__main__':
    main()
