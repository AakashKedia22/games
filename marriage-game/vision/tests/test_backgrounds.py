import numpy as np
import pytest

import backgrounds


def test_hexagon_background_has_cream_lines_in_a_sensible_share():
    rng = np.random.default_rng(0)
    image = backgrounds.hexagon_rug(rng, 800, 600)
    assert image.shape == (600, 800, 3) and image.dtype == np.uint8
    blue, green, red = (image[:, :, channel].astype(int) for channel in range(3))
    cream = (blue >= 160) & (green >= 195) & (red >= 205)
    assert 0.02 <= cream.mean() <= 0.30


@pytest.mark.parametrize('style', ['hexagon', 'plain', 'blotch', 'stripes'])
def test_every_style_gives_a_picture_of_the_right_size(style):
    rng = np.random.default_rng(1)
    image = backgrounds.random_background(rng, 320, 240, photo_dir='/nonexistent', style=style)
    assert image.shape == (240, 320, 3) and image.dtype == np.uint8
    assert image.flags['C_CONTIGUOUS']


def test_without_user_photos_the_photo_style_falls_back_to_the_rug():
    rng = np.random.default_rng(2)
    image = backgrounds.random_background(rng, 320, 240, photo_dir='/nonexistent', style='photo')
    assert image.shape == (240, 320, 3)


def test_distractors_and_lighting_keep_the_picture_and_mark_covered_pixels():
    rng = np.random.default_rng(3)
    image = backgrounds.hexagon_rug(rng, 400, 300)
    owner = np.full((300, 400), 7, np.int16)
    out = backgrounds.add_distractors(rng, image.copy(), owner)
    assert out.shape == image.shape
    assert (owner == -1).any() or np.array_equal(out, image)
    lit = backgrounds.lighting(rng, image)
    assert lit.shape == image.shape and lit.dtype == np.uint8
