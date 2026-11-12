"""Read photos for recognition: JPEG/PNG/WebP with OpenCV, HEIC through macOS sips."""
import os
import subprocess
import tempfile

# Refuse photos that decode to more than ~130 megapixels (a small PNG can hide billions of pixels).
# Must be set before OpenCV is imported.
os.environ.setdefault('OPENCV_IO_MAX_IMAGE_PIXELS', str(1 << 27))

import cv2  # noqa: E402

HEIC_EXT = ('.heic', '.heif')


def load_photo(path):
    """BGR uint8 image. HEIC/HEIF converted with macOS sips into a TemporaryDirectory, then cv2.imread
    (applies EXIF rotation). Raises ValueError('Could not read the photo.') on failure; if sips is
    missing raises ValueError('HEIC needs macOS sips; convert the photo to JPEG first.')."""
    if str(path).lower().endswith(HEIC_EXT):
        with tempfile.TemporaryDirectory() as folder:
            converted = os.path.join(folder, 'photo.jpg')
            try:
                subprocess.run(['sips', '-s', 'format', 'jpeg', path, '--out', converted],
                               check=True, capture_output=True, timeout=60)
            except FileNotFoundError:
                raise ValueError('HEIC needs macOS sips; convert the photo to JPEG first.')
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                raise ValueError('Could not read the photo.')
            return _imread(converted)
    return _imread(path)


def _imread(path):
    try:
        image = cv2.imread(path, cv2.IMREAD_COLOR)  # also applies the photo's EXIF rotation
    except cv2.error:  # e.g. over the pixel limit set above
        image = None
    if image is None:
        raise ValueError('Could not read the photo.')
    return image


def resize_long(image, side):
    """Return (resized, scale) with the longer side == side (INTER_AREA when shrinking, INTER_LINEAR when growing)."""
    height, width = image.shape[:2]
    scale = side / max(height, width)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    return cv2.resize(image, size, interpolation=interpolation), scale
