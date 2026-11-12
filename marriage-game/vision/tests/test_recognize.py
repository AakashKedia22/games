import json
import os
import subprocess
import sys

import cv2
import numpy as np
import onnx
from onnx import TensorProto, helper

from classes import CODES, code_from_folder
from tests.test_detect import draw_card, table

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Three index boxes in the detector's 1600 x 1200 frame.
STAND_IN_BOXES = [[200, 200, 300, 350], [600, 200, 700, 350], [1000, 200, 1100, 350]]


def stand_in_detector(path):
    """Detector with the real model's inputs and outputs: a fixed answer, three boxes at score 0.9."""
    boxes = np.array(STAND_IN_BOXES, np.float32)
    graph = helper.make_graph(
        [
            helper.make_node('Constant', [], ['boxes'], value=helper.make_tensor('b', TensorProto.FLOAT, [3, 4], boxes.flatten().tolist())),
            helper.make_node('Constant', [], ['labels'], value=helper.make_tensor('l', TensorProto.INT64, [3], [1, 1, 1])),
            helper.make_node('Constant', [], ['scores'], value=helper.make_tensor('s', TensorProto.FLOAT, [3], [0.9, 0.9, 0.9])),
        ],
        'detector',
        [helper.make_tensor_value_info('image', TensorProto.FLOAT, [3, None, None])],
        [helper.make_tensor_value_info('boxes', TensorProto.FLOAT, [3, 4]),
         helper.make_tensor_value_info('labels', TensorProto.INT64, [3]),
         helper.make_tensor_value_info('scores', TensorProto.FLOAT, [3])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
    model.ir_version = 8
    onnx.save(model, path)


def stand_in_classifier(path):
    """Classifier with the real model's inputs and outputs: average colour -> 53 logits and a 2-value orientation."""
    rng = np.random.default_rng(1)
    logits_weights = helper.make_tensor('W', TensorProto.FLOAT, [3, len(CODES)], rng.normal(size=3 * len(CODES)).astype(np.float32).tolist())
    orient_weights = helper.make_tensor('V', TensorProto.FLOAT, [3, 2], rng.normal(size=6).astype(np.float32).tolist())
    graph = helper.make_graph(
        [
            helper.make_node('GlobalAveragePool', ['image'], ['pooled']),
            helper.make_node('Flatten', ['pooled'], ['flat']),
            helper.make_node('MatMul', ['flat', 'W'], ['logits']),
            helper.make_node('MatMul', ['flat', 'V'], ['orient']),
        ],
        'classifier',
        [helper.make_tensor_value_info('image', TensorProto.FLOAT, ['batch', 3, 128, 128])],
        [helper.make_tensor_value_info('logits', TensorProto.FLOAT, ['batch', len(CODES)]),
         helper.make_tensor_value_info('orient', TensorProto.FLOAT, ['batch', 2])],
        [logits_weights, orient_weights],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
    model.ir_version = 8
    onnx.save(model, path)


def stand_in_models(tmp_path):
    detector, classifier, labels = tmp_path / 'corners.onnx', tmp_path / 'cards.onnx', tmp_path / 'labels.json'
    stand_in_detector(str(detector))
    stand_in_classifier(str(classifier))
    labels.write_text(json.dumps(CODES))
    return str(detector), str(classifier), str(labels)


def test_code_from_folder():
    assert code_from_folder('ace of clubs') == 'AC'
    assert code_from_folder('ten of hearts') == '10H'
    assert code_from_folder('queen of spades') == 'QS'
    assert code_from_folder('joker') == 'JK'
    assert code_from_folder('7D') == '7D'
    assert code_from_folder('backs') is None
    assert len(CODES) == 53 and len(set(CODES)) == 53


def test_worker_round_trip(tmp_path):
    detector, classifier, labels = stand_in_models(tmp_path)
    pending = tmp_path / 'pending'
    photo = table(1200, 900)
    for i in range(3):
        draw_card(photo, (250 + i * 350, 450))
    photo_path = tmp_path / 'photo.jpg'
    cv2.imwrite(str(photo_path), photo)

    worker = subprocess.Popen(
        [sys.executable, os.path.join(HERE, 'recognize.py'), detector, classifier, labels, str(pending)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=HERE,
    )
    try:
        assert json.loads(worker.stdout.readline()) == {'ready': True}
        worker.stdin.write(json.dumps({'id': 'abc123', 'path': str(photo_path)}) + '\n')
        worker.stdin.write(json.dumps({'id': 'bad1', 'path': str(tmp_path / 'missing.jpg')}) + '\n')
        worker.stdin.flush()
        reply = json.loads(worker.stdout.readline())
        failure = json.loads(worker.stdout.readline())
    finally:
        worker.stdin.close()
        worker.wait(timeout=30)

    assert reply['id'] == 'abc123'
    assert reply['ignoredAtEdge'] == 0
    assert 'overlay' not in reply
    assert sorted(card['id'] for card in reply['cards']) == ['abc123-0', 'abc123-1', 'abc123-2']
    for card in reply['cards']:
        assert card['code'] in CODES
        assert 0 < card['confidence'] <= 1
        assert len(card['alternatives']) == 2
        assert isinstance(card['check'], bool)
        assert card['thumb'].startswith('data:image/jpeg;base64,')
        assert len(card['corners']) == 4
        assert (pending / (card['id'] + '.jpg')).exists()
    assert failure == {'id': 'bad1', 'error': 'Could not read the photo.'}


def test_huge_photo_is_refused_not_decoded(tmp_path):
    """A tiny PNG that decodes to ~400 megapixels must not be loaded into memory."""
    import struct
    import zlib

    width = height = 20000
    compressor = zlib.compressobj(9)
    data = b''.join(compressor.compress(b'\x00' + b'\x00' * width) for _ in range(height)) + compressor.flush()

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)) + chunk(b'IDAT', data) + chunk(b'IEND', b'')
    bomb = tmp_path / 'bomb.png'
    bomb.write_bytes(png)
    detector, classifier, labels = stand_in_models(tmp_path)
    code = (
        'import sys, recognize\n'
        'try:\n'
        '    recognize.Recognizer(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]).recognize_photo("x", sys.argv[1])\n'
        'except ValueError as error:\n'
        '    print(error)\n'
    )
    result = subprocess.run([sys.executable, '-c', code, str(bomb), detector, classifier, labels, str(tmp_path / 'p')],
                            cwd=HERE, capture_output=True, text=True, timeout=120)
    assert result.stdout.strip() == 'Could not read the photo.', result.stderr
