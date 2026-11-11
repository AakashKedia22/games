import json

import cv2
import numpy as np
import pytest

pytest.importorskip('torch')
pytest.importorskip('timm')

import onnxruntime as ort  # noqa: E402

import train  # noqa: E402
from classes import CODES  # noqa: E402


def fake_dataset(root):
    """A few coloured 'cards' per class in the Kaggle folder layout."""
    rng = np.random.default_rng(0)
    for split, count in (('train', 4), ('valid', 2), ('test', 2)):
        for name in ('ace of spades', 'ten of hearts', 'joker', 'not a card folder'):
            folder = root / split / name
            folder.mkdir(parents=True)
            for i in range(count):
                image = np.full((224, 224, 3), rng.integers(0, 255, size=3), np.uint8)
                cv2.imwrite(str(folder / f'{i}.jpg'), image)


def test_collect_maps_folders_and_repeats_samples(tmp_path):
    fake_dataset(tmp_path / 'cards')
    items = train.collect(str(tmp_path / 'cards' / 'train'))
    assert sorted({label for _, label in items}) == sorted(CODES.index(code) for code in ('AS', '10H', 'JK'))
    samples = tmp_path / 'samples' / '7D'
    samples.mkdir(parents=True)
    cv2.imwrite(str(samples / 'a.jpg'), np.zeros((300, 200, 3), np.uint8))
    assert train.collect(str(tmp_path / 'samples'), repeat=3) == [(str(samples / 'a.jpg'), CODES.index('7D'))] * 3
    assert train.collect(str(tmp_path / 'missing')) == []


def test_tiny_training_run_exports_a_working_model(tmp_path):
    fake_dataset(tmp_path / 'cards')
    out = tmp_path / 'models'
    metrics = train.main([
        '--data', str(tmp_path / 'cards'), '--samples', str(tmp_path / 'none'), '--out', str(out),
        '--epochs', '1', '--batch', '8', '--workers', '0', '--device', 'cpu', '--no-pretrained',
    ])
    assert set(metrics) == {'valid_accuracy', 'test_accuracy', 'train_images', 'epochs'}
    assert json.loads((out / 'labels.json').read_text()) == CODES
    session = ort.InferenceSession(str(out / 'cards.onnx'), providers=['CPUExecutionProvider'])
    logits = session.run(None, {'image': np.zeros((3, 3, 224, 224), np.float32)})[0]
    assert logits.shape == (3, len(CODES))


def test_training_without_a_validation_set_still_saves_a_checkpoint(tmp_path):
    """Only your own saved samples, no Kaggle folders: the best checkpoint is picked by training loss."""
    samples = tmp_path / 'samples'
    rng = np.random.default_rng(0)
    for code in ('7D', 'AS'):
        (samples / code).mkdir(parents=True)
        for i in range(3):
            cv2.imwrite(str(samples / code / f'{i}.jpg'), np.full((300, 200, 3), rng.integers(0, 255, size=3), np.uint8))
    out = tmp_path / 'models'
    metrics = train.main([
        '--data', str(tmp_path / 'missing'), '--samples', str(samples), '--out', str(out), '--sample-repeat', '1',
        '--epochs', '2', '--batch', '4', '--workers', '0', '--device', 'cpu', '--no-pretrained',
    ])
    assert metrics['valid_accuracy'] is None and metrics['test_accuracy'] is None
    assert (out / 'best.pt').exists() and (out / 'cards.onnx').exists()
