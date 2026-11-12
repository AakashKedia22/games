import subprocess

import cv2
import numpy as np
import pytest

import photo_io
from photo_io import load_photo, resize_long


def test_jpeg_loads_as_bgr(tmp_path):
    path = tmp_path / 'photo.jpg'
    cv2.imwrite(str(path), np.full((120, 160, 3), (10, 20, 30), np.uint8))
    image = load_photo(str(path))
    assert image.shape == (120, 160, 3)
    assert image.dtype == np.uint8


def test_missing_file_is_a_read_error(tmp_path):
    with pytest.raises(ValueError, match='Could not read the photo.'):
        load_photo(str(tmp_path / 'missing.jpg'))


def test_heic_is_converted_with_sips(tmp_path, monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        cv2.imwrite(command[command.index('--out') + 1], np.full((90, 60, 3), 200, np.uint8))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(photo_io.subprocess, 'run', fake_run)
    source = tmp_path / 'IMG_1.HEIC'
    source.write_bytes(b'not really heic')
    image = load_photo(str(source))
    assert image.shape == (90, 60, 3)
    assert calls[0][:4] == ['sips', '-s', 'format', 'jpeg']
    assert calls[0][4] == str(source)


def test_heic_without_sips_says_so(tmp_path, monkeypatch):
    def no_sips(command, **kwargs):
        raise FileNotFoundError('sips')

    monkeypatch.setattr(photo_io.subprocess, 'run', no_sips)
    source = tmp_path / 'IMG_2.heic'
    source.write_bytes(b'x')
    with pytest.raises(ValueError, match='HEIC needs macOS sips'):
        load_photo(str(source))


def test_resize_long_sets_the_longer_side():
    shrunk, scale = resize_long(np.zeros((1200, 3000, 3), np.uint8), 1600)
    assert shrunk.shape[:2] == (640, 1600)
    assert scale == pytest.approx(1600 / 3000)
    grown, scale = resize_long(np.zeros((300, 400, 3), np.uint8), 1600)
    assert grown.shape[:2] == (1200, 1600)
    assert scale == pytest.approx(4.0)
