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


def tiny_model(path):
    """Stand-in classifier with the real model's input and output shapes:
    average colour -> 53 logits."""
    rng = np.random.default_rng(1)
    weights = helper.make_tensor('W', TensorProto.FLOAT, [3, len(CODES)], rng.normal(size=3 * len(CODES)).astype(np.float32).tolist())
    graph = helper.make_graph(
        [
            helper.make_node('GlobalAveragePool', ['image'], ['pooled']),
            helper.make_node('Flatten', ['pooled'], ['flat']),
            helper.make_node('MatMul', ['flat', 'W'], ['logits']),
        ],
        'tiny',
        [helper.make_tensor_value_info('image', TensorProto.FLOAT, ['batch', 3, 224, 224])],
        [helper.make_tensor_value_info('logits', TensorProto.FLOAT, ['batch', len(CODES)])],
        [weights],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 13)])
    model.ir_version = 8
    onnx.save(model, path)


def test_code_from_folder():
    assert code_from_folder('ace of clubs') == 'AC'
    assert code_from_folder('ten of hearts') == '10H'
    assert code_from_folder('queen of spades') == 'QS'
    assert code_from_folder('joker') == 'JK'
    assert code_from_folder('7D') == '7D'
    assert code_from_folder('backs') is None
    assert len(CODES) == 53 and len(set(CODES)) == 53


def test_worker_round_trip(tmp_path):
    model, labels, pending = tmp_path / 'model.onnx', tmp_path / 'labels.json', tmp_path / 'pending'
    tiny_model(str(model))
    labels.write_text(json.dumps(CODES))
    photo = table(1200, 900)
    for i in range(3):
        draw_card(photo, (250 + i * 350, 450))
    photo_path = tmp_path / 'photo.jpg'
    cv2.imwrite(str(photo_path), photo)

    worker = subprocess.Popen(
        [sys.executable, os.path.join(HERE, 'recognize.py'), str(model), str(labels), str(pending)],
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
        worker.wait(timeout=10)

    assert reply['id'] == 'abc123'
    assert [card['id'] for card in reply['cards']] == ['abc123-0', 'abc123-1', 'abc123-2']
    for card in reply['cards']:
        assert card['code'] in CODES
        assert 0 < card['confidence'] <= 1
        assert len(card['alternatives']) == 2
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
    model, labels = tmp_path / 'model.onnx', tmp_path / 'labels.json'
    tiny_model(str(model))
    labels.write_text(json.dumps(CODES))
    code = (
        'import sys, recognize\n'
        'try:\n'
        '    recognize.Recognizer(sys.argv[2], sys.argv[3], sys.argv[4]).recognize("x", sys.argv[1])\n'
        'except ValueError as error:\n'
        '    print(error)\n'
    )
    result = subprocess.run([sys.executable, '-c', code, str(bomb), str(model), str(labels), str(tmp_path / 'p')],
                            cwd=HERE, capture_output=True, text=True, timeout=60)
    assert result.stdout.strip() == 'Could not read the photo.', result.stderr
