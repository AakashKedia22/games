import json

import numpy as np
import pytest

pytest.importorskip('torch')
pytest.importorskip('timm')

import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402

import train  # noqa: E402
from classes import CODES  # noqa: E402
from corner_models import build_detector  # noqa: E402


def test_detector_returns_losses_in_train_mode():
    model = build_detector(pretrained=False, train_size=320)
    model.train()
    image = torch.rand(3, 320, 320)
    target = {'boxes': torch.tensor([[50.0, 60.0, 110.0, 160.0]]), 'labels': torch.tensor([1])}
    losses = model([image], [target])
    assert isinstance(losses, dict)
    assert 'loss_classifier' in losses and 'loss_box_reg' in losses


def test_tiny_training_run_exports_both_models_that_run(tmp_path):
    out = tmp_path / 'models'
    nothing = str(tmp_path / 'none')
    metrics = train.main([
        '--decks', nothing, '--backgrounds', nothing, '--samples', nothing, '--out', str(out),
        '--det-iters', '2', '--det-batch', '2', '--crop', '320', '--cls-steps', '2', '--cls-batch', '4',
        '--val-scenes', '1', '--val-crops', '16', '--workers', '0', '--device', 'cpu', '--no-pretrained',
        '--eval-dir', nothing,
    ])
    assert json.loads((out / 'labels.json').read_text()) == CODES
    assert (out / 'geometry.json').exists() and (out / 'metrics.json').exists()
    assert metrics['cls_steps'] == 2 and metrics['captured_faces'] == 0

    cards = ort.InferenceSession(str(out / 'cards.onnx'), providers=['CPUExecutionProvider'])
    logits, orient = cards.run(None, {'image': np.zeros((3, 3, 128, 128), np.float32)})
    assert logits.shape == (3, len(CODES))
    assert orient.shape == (3, 2)

    corners = ort.InferenceSession(str(out / 'corners.onnx'), providers=['CPUExecutionProvider'])
    boxes, labels, scores = corners.run(None, {'image': np.random.default_rng(0).random((3, 320, 320), dtype=np.float32)})
    assert boxes.ndim == 2 and boxes.shape[1] == 4
    assert len(labels) == len(scores) == len(boxes)


def test_classifier_export_check_scales_with_the_output_size(tmp_path):
    """A network whose logits are large (as after a short run) still exports: float32 noise is not a mismatch."""
    model = train.build_index_net(pretrained=False)
    with torch.no_grad():
        model.cls.weight.mul_(400)  # logits of the order of 100, like an unsettled short run
    path = train.export_classifier(model, str(tmp_path / 'cards.onnx'))
    assert (tmp_path / 'cards.onnx').exists() and path
