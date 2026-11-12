"""Shared model code for the photo pipeline: the index detector, the index classifier, crops and angles.

torch and torchvision are imported only inside the functions that need them, so the recognition
worker runs with onnxruntime alone.

Angle convention (used everywhere): phi = 0 means the card's index is upright; phi is positive
clockwise in the image. The index's up vector is u = (sin phi, -cos phi) in image coordinates
(y down), and its right vector is r = (cos phi, sin phi). The classifier's orientation head predicts
(cos phi, sin phi).
"""
import math

import cv2
import numpy as np

from classes import CODES

DETECT_SIDE = 1600          # photo long side fed to the detector at inference (and synthetic scene size)
TRAIN_CROP = 640            # detector training crop
CROP_SIZE = 128             # classifier input
CROP_CONTEXT = 1.3          # crop side = CROP_CONTEXT * max(box w, box h)
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
ORIENT_DIM = 2


def build_detector(pretrained=True, train_size=TRAIN_CROP):
    """Faster R-CNN on a MobileNetV3-Large FPN with stride 8/16/32 levels and small anchors; one class (index)."""
    from torchvision.models import MobileNet_V3_Large_Weights
    from torchvision.models.detection import FasterRCNN
    from torchvision.models.detection.anchor_utils import AnchorGenerator
    from torchvision.models.detection.backbone_utils import mobilenet_backbone
    from torchvision.ops import MultiScaleRoIAlign

    backbone = mobilenet_backbone(
        backbone_name='mobilenet_v3_large',
        weights=MobileNet_V3_Large_Weights.IMAGENET1K_V1 if pretrained else None,
        fpn=True, trainable_layers=6, returned_layers=[2, 3, 4])  # feature maps '0' (s8), '1' (s16), '2' (s32), 'pool'
    anchors = AnchorGenerator(sizes=((16,), (32,), (64,), (128,)), aspect_ratios=((0.5, 1.0, 2.0),) * 4)
    return FasterRCNN(
        backbone, num_classes=2, rpn_anchor_generator=anchors,
        box_roi_pool=MultiScaleRoIAlign(['0', '1', '2'], 7, 2),
        min_size=train_size, max_size=train_size,
        box_detections_per_img=300, box_nms_thresh=0.3, box_score_thresh=0.05,
        rpn_pre_nms_top_n_test=3000, rpn_post_nms_top_n_test=1000)


def set_detect_size(model, side=DETECT_SIDE):
    """Inference and export resize photos to the same sizes: short side 1200, long side DETECT_SIDE at most."""
    model.transform.min_size = (1200,)
    model.transform.max_size = side


def export_detector(model, path):
    """ONNX with inputs 'image' [3, h, w] (RGB, 0..1; the model normalises) and outputs boxes, labels, scores."""
    import torch

    model = model.eval().cpu()
    set_detect_size(model)
    dummy = torch.rand(3, 1200, 1600)
    torch.onnx.export(model, ([dummy],), path, dynamo=False, opset_version=17,
                      input_names=['image'], output_names=['boxes', 'labels', 'scores'],
                      dynamic_axes={'image': {1: 'h', 2: 'w'}})
    return path


def build_index_net(pretrained=True):
    """EfficientNet-B0 with two heads on the 128x128 index crop: card code (53 logits) and orientation (cos, sin)."""
    import timm
    from torch import nn

    class IndexNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.body = timm.create_model('efficientnet_b0', pretrained=pretrained, num_classes=0)
            self.cls = nn.Linear(1280, len(CODES))
            self.orient = nn.Linear(1280, ORIENT_DIM)

        def forward(self, x):
            features = self.body(x)
            return self.cls(features), self.orient(features)

    return IndexNet()


def index_crop(image, box, rng=None):
    """A square CROP_SIZE x CROP_SIZE crop around an index box, and its side length in photo pixels.
    With rng (training only): the side is scaled by U(0.9, 1.2) and the centre moved by up to 8 % of the side."""
    x0, y0, x1, y1 = (float(v) for v in box)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = CROP_CONTEXT * max(x1 - x0, y1 - y0)
    if rng is not None:
        side *= rng.uniform(0.9, 1.2)
        cx += rng.uniform(-0.08, 0.08) * side
        cy += rng.uniform(-0.08, 0.08) * side
    scale = CROP_SIZE / side
    matrix = np.array([[scale, 0, -(cx - side / 2) * scale],
                       [0, scale, -(cy - side / 2) * scale]], dtype=np.float32)
    crop = cv2.warpAffine(image, matrix, (CROP_SIZE, CROP_SIZE), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)
    return crop, side


def to_classifier_batch(crops):
    """BGR crops -> normalised NCHW float32 batch."""
    if not len(crops):
        return np.zeros((0, 3, CROP_SIZE, CROP_SIZE), np.float32)
    mean = np.array(MEAN, np.float32)
    std = np.array(STD, np.float32)
    batch = []
    for crop in crops:
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        batch.append(((rgb.astype(np.float32) / 255.0 - mean) / std).transpose(2, 0, 1))
    return np.stack(batch).astype(np.float32)


def turn(crop, degrees):
    """Turn the picture clockwise by `degrees` (the same rotation a card with angle phi has)."""
    height, width = crop.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), -degrees, 1.0)  # OpenCV turns counter-clockwise for +angle
    return cv2.warpAffine(crop, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def upright(crop, phi_deg):
    """Undo a card's rotation: the index of a crop at angle phi comes out upright."""
    return turn(crop, -phi_deg)


def orient_vector(phi_deg):
    """The orientation-head target for an angle: (cos phi, sin phi)."""
    phi = math.radians(phi_deg)
    return math.cos(phi), math.sin(phi)


def angle_of(orient):
    """Angle in degrees from an orientation-head output (cos, sin), in (-180, 180]."""
    return math.degrees(math.atan2(float(orient[1]), float(orient[0])))
