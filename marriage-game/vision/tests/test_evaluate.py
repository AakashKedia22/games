import json

import cv2
import numpy as np

import evaluate


def test_compare_is_a_multiset_comparison():
    assert evaluate.compare(['3H', '3H', 'JK'], ['3H', 'JK', 'JK']) == {'correct': 2, 'missing': ['3H'], 'extra': ['JK']}


class FakeRecognizer:
    """Stands in for the ONNX recognizer: 3 cards, one of them wrong and flagged, with overlay data."""

    def __init__(self, *args, **kwargs):
        pass

    def recognize_photo(self, request_id, path):
        cards = [{'code': '3H', 'check': False}, {'code': 'JK', 'check': True}, {'code': 'JK', 'check': True}]
        overlay = {
            'detections': [
                {'box': [10, 10, 60, 90], 'score': 0.9, 'code': '3H', 'phi': 0.0, 'centre': [35, 50], 'card': 0},
                {'box': [100, 10, 150, 90], 'score': 0.8, 'code': 'JK', 'phi': 90.0, 'centre': [125, 50], 'card': 1},
                {'box': [200, 10, 250, 90], 'score': 0.7, 'code': 'JK', 'phi': 0.0, 'centre': [225, 50], 'card': 2},
            ],
            'cards': [
                {'centre': [35, 50], 'phi': 0.0, 'hpx': 80.0, 'members': [0], 'check': False, 'code': '3H'},
                {'centre': [125, 50], 'phi': 90.0, 'hpx': 80.0, 'members': [1], 'check': True, 'code': 'JK'},
                {'centre': [225, 50], 'phi': 0.0, 'hpx': 80.0, 'members': [2], 'check': True, 'code': 'JK'},
            ],
        }
        return {'cards': cards, 'ignoredAtEdge': 0, 'overlay': overlay}


def test_main_prints_the_summary_and_writes_the_overlay(tmp_path, monkeypatch, capsys):
    photo = tmp_path / 'IMG_9999.jpg'
    cv2.imwrite(str(photo), np.full((120, 300, 3), 200, np.uint8))
    truth = tmp_path / 'IMG_9999.truth.json'
    truth.write_text(json.dumps({'photo': 'IMG_9999.jpg', 'cards': ['3H', '3H', 'JK']}))
    models = tmp_path / 'models'
    models.mkdir()
    for name in ('corners.onnx', 'cards.onnx', 'labels.json'):
        (models / name).write_bytes(b'stand-in')
    monkeypatch.setattr(evaluate, 'Recognizer', FakeRecognizer)
    out = tmp_path / 'out'

    results = evaluate.main(['--models', str(models), '--out', str(out), str(truth)])

    text = capsys.readouterr().out
    assert 'IMG_9999: found 3 / expected 3, correct 2, checks 2 (1 on mistakes)' in text
    assert '  missing: 3H' in text
    assert '  extra:   JK' in text
    assert 'TOTAL: correct 2 / 3 over 1 photos' in text
    assert (out / 'IMG_9999.overlay.jpg').exists()
    assert results[0]['correct'] == 2 and results[0]['fully_correct'] is False
