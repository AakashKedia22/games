"""Train the card recognizer on synthetic photos and export it for the recognition worker.

Two networks, both trained on scenes made from card faces (synth.py):
  * the index detector (corners.onnx): finds each card's corner index (torchvision Faster R-CNN, MobileNetV3 FPN);
  * the index classifier (cards.onnx): reads the card code and the index's angle (EfficientNet-B0).

Faces come from your deck capture (vision/datasets/deck, see capture_deck.py) when present, and from
rendered faces otherwise. Confirmed photo crops in data/vision/samples are added to the classifier.

Output (--out, default vision/models): corners.onnx, cards.onnx, labels.json, geometry.json, metrics.json,
plus detector.pt and index.pt (the PyTorch weights, used by --skip-detector).
"""
import argparse
import glob
import json
import math
import os

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import DataLoader
from torchvision.ops import box_iou

import synth
from classes import CODES
from corner_models import (CROP_SIZE, TRAIN_CROP, build_detector, build_index_net, export_detector, angle_of,
                           set_detect_size, to_classifier_batch)
from geometry import MIN_DETECT_SCORE, default_geometry

DETECTOR_WARMUP = 200
VALIDATION_SEED = 10_000_000
CLASSIFIER_VALIDATION_SEED = 20_000_000
CHECK_SCORE = MIN_DETECT_SCORE + 0.1  # export check compares boxes at least this confident
SAMPLE_SHARE = 0.1  # share of each classifier batch taken from the confirmed photo crops


def collate_scenes(batch):
    return tuple(zip(*batch))


def pick_device(name):
    if name != 'auto':
        return torch.device(name)
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def detector_lr(iteration, total, base):
    """Linear warm-up over DETECTOR_WARMUP iterations, then cosine down to zero."""
    if iteration < DETECTOR_WARMUP:
        return base * (iteration + 1) / DETECTOR_WARMUP
    progress = (iteration - DETECTOR_WARMUP) / max(1, total - DETECTOR_WARMUP)
    return base * 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))


def scene_tensor(image):
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return torch.from_numpy(rgb.transpose(2, 0, 1).astype(np.float32) / 255.0)


def match_detections(boxes, scores, truth):
    """(true positives, false positives) at IoU 0.5, greedy by score."""
    if len(boxes) == 0:
        return 0, 0
    if len(truth) == 0:
        return 0, len(boxes)
    overlap = box_iou(torch.as_tensor(boxes, dtype=torch.float32), torch.as_tensor(truth, dtype=torch.float32)).numpy()
    used = np.zeros(len(truth), bool)
    true_positives = 0
    for index in np.argsort(-scores):
        candidates = np.where(~used, overlap[index], -1.0)
        best = int(np.argmax(candidates))
        if candidates[best] >= 0.5:
            used[best] = True
            true_positives += 1
    return true_positives, len(boxes) - true_positives


def detector_scores(model, device, faces, count, photo_dir):
    """Recall and precision of the detector on fixed full-size scenes (IoU 0.5, score >= MIN_DETECT_SCORE)."""
    set_detect_size(model)
    model.eval()
    true_positives = false_positives = truth_total = 0
    with torch.no_grad():
        for index in range(count):
            rng = np.random.default_rng(VALIDATION_SEED + index)
            image, annotations = synth.make_scene(rng, faces, photo_dir=photo_dir)
            output = model([scene_tensor(image).to(device)])[0]
            keep = output['scores'].cpu().numpy() >= MIN_DETECT_SCORE
            boxes = output['boxes'].cpu().numpy()[keep]
            scores = output['scores'].cpu().numpy()[keep]
            truth = np.array([annotation['box'] for annotation in annotations], np.float32).reshape(-1, 4)
            hits, misses = match_detections(boxes, scores, truth)
            true_positives += hits
            false_positives += misses
            truth_total += len(truth)
    recall = true_positives / truth_total if truth_total else 0.0
    predicted = true_positives + false_positives
    precision = true_positives / predicted if predicted else 0.0
    return recall, precision


def same_boxes(first, second, tolerance=1.0):
    """True when both sets have the same count and every box in one has a box in the other within tolerance pixels.
    Set-based on purpose: boxes with (near-)equal scores can come out in a different order."""
    if len(first) != len(second):
        return False
    if not len(first):
        return True
    gap = np.abs(first[:, None, :] - second[None, :, :]).max(axis=2)
    return bool((gap.min(axis=1) <= tolerance).all() and (gap.min(axis=0) <= tolerance).all())


def check_detector_export(model, path, faces, photo_dir):
    """The ONNX detector must find the same boxes as PyTorch on one scene (same count, within one pixel)."""
    import onnxruntime as ort

    set_detect_size(model)
    model.eval()
    image, _ = synth.make_scene(np.random.default_rng(VALIDATION_SEED - 1), faces, photo_dir=photo_dir)
    tensor = scene_tensor(image)
    with torch.no_grad():
        result = model([tensor])[0]
    expected, expected_scores = result['boxes'].numpy(), result['scores'].numpy()
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    got, _, got_scores = session.run(None, {'image': tensor.numpy()})
    # Only boxes the worker would keep count (a box scoring near the 0.05 cut-off may differ by float noise).
    got = np.asarray(got, np.float32).reshape(-1, 4)[np.asarray(got_scores).reshape(-1) >= CHECK_SCORE]
    expected = np.asarray(expected, np.float32).reshape(-1, 4)[expected_scores >= CHECK_SCORE]
    if not same_boxes(got, expected):
        raise RuntimeError('ONNX detector does not match the PyTorch model.')


def train_detector(args, faces, device, out_dir):
    model = build_detector(pretrained=not args.no_pretrained, train_size=args.crop).to(device)
    model.train()
    params = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.SGD(params, lr=args.det_lr, momentum=0.9, weight_decay=1e-4)
    scenes = synth.DetectorScenes(faces, length=args.det_iters * args.det_batch, seed=1, crop=args.crop,
                                  photo_dir=args.backgrounds)
    loader = DataLoader(scenes, batch_size=args.det_batch, shuffle=False, num_workers=args.workers,
                        collate_fn=collate_scenes, persistent_workers=args.workers > 0)
    iteration = 0
    for images, targets in loader:
        if iteration >= args.det_iters:
            break
        lr = detector_lr(iteration, args.det_iters, args.det_lr)
        for group in optimizer.param_groups:
            group['lr'] = lr
        images = [image.to(device) for image in images]
        targets = [{key: value.to(device) for key, value in target.items()} for target in targets]
        losses = model(images, targets)
        loss = sum(losses.values())
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if iteration % 50 == 0:
            print(f'detector {iteration}/{args.det_iters}  loss {loss.item():.4f}  lr {lr:.5f}', flush=True)
        iteration += 1
        if iteration % 500 == 0:  # a crash later in the run keeps the detector (--skip-detector needs detector.pt)
            torch.save(model.state_dict(), os.path.join(out_dir, 'detector.pt'))

    torch.save(model.state_dict(), os.path.join(out_dir, 'detector.pt'))
    export_detector(model, os.path.join(out_dir, 'corners.onnx'))
    check_detector_export(model, os.path.join(out_dir, 'corners.onnx'), faces, args.backgrounds)
    recall, precision = detector_scores(model.to(device), device, faces, args.val_scenes, args.backgrounds)
    print(f'detector: recall {recall:.3f}, precision {precision:.3f} on {args.val_scenes} scenes', flush=True)
    return {'det_recall': recall, 'det_precision': precision, 'det_iters': args.det_iters}


def sample_items(samples, rng, count):
    indexes = rng.integers(0, len(samples), count)
    items = [samples[int(index)] for index in indexes]
    return [torch.stack([item[k] for item in items]) for k in range(5)]


def classifier_scores(model, device, crops, labels, angles):
    """(accuracy, median angle error in degrees) on fixed crops."""
    model.eval()
    correct = 0
    errors = []
    with torch.no_grad():
        for start in range(0, len(crops), 256):
            batch = torch.from_numpy(to_classifier_batch(crops[start:start + 256])).to(device)
            logits, orient = model(batch)
            predicted = logits.argmax(dim=1).cpu().numpy()
            correct += int((predicted == labels[start:start + 256]).sum())
            for vector, phi in zip(orient.cpu().numpy(), angles[start:start + 256]):
                errors.append(abs((angle_of(vector) - float(phi) + 180) % 360 - 180))
    accuracy = correct / len(crops)
    return accuracy, float(np.median(errors)) if errors else 0.0


def train_classifier(args, faces, device, out_dir, sample_dir):
    model = build_index_net(pretrained=not args.no_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.cls_lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, args.cls_steps))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    crops_loader = DataLoader(synth.IndexCrops(faces, seed=3, train=True, photo_dir=args.backgrounds),
                              batch_size=args.cls_batch, num_workers=args.workers)
    batches = iter(crops_loader)
    samples = synth.SampleCrops(sample_dir, seed=5) if sample_dir else None
    samples = samples if samples is not None and len(samples) else None
    if samples is not None:
        print(f'Classifier: adding {len(samples)} confirmed crops ({SAMPLE_SHARE:.0%} of each batch)', flush=True)
    sample_rng = np.random.default_rng(7)
    val_crops, val_labels, val_angles = synth.fixed_crops(faces, args.val_crops, CLASSIFIER_VALIDATION_SEED,
                                                          photo_dir=args.backgrounds)
    best_accuracy, best_error = -1.0, None
    best_path = os.path.join(out_dir, 'index.pt')
    for step in range(1, args.cls_steps + 1):
        model.train()
        images, labels, cos, sin, has_angle = next(batches)
        if samples is not None:
            count = max(1, round(SAMPLE_SHARE * args.cls_batch))
            extra = sample_items(samples, sample_rng, count)
            images = torch.cat([extra[0], images[count:]])
            labels = torch.cat([extra[1], labels[count:]])
            cos = torch.cat([extra[2], cos[count:]])
            sin = torch.cat([extra[3], sin[count:]])
            has_angle = torch.cat([extra[4], has_angle[count:]])
        images, labels = images.to(device), labels.to(device)
        target = torch.stack([cos, sin], dim=1).to(device)
        has_angle = has_angle.to(device)
        logits, orient = model(images)
        cosine = F.cosine_similarity(orient, target, dim=1)
        angle_loss = ((1 - cosine) * has_angle).sum() / has_angle.sum().clamp(min=1)
        loss = loss_fn(logits, labels) + 0.5 * angle_loss
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        scheduler.step()
        if step % 50 == 0:
            print(f'classifier {step}/{args.cls_steps}  loss {loss.item():.4f}', flush=True)
        if step % 500 == 0 or step == args.cls_steps:
            accuracy, error = classifier_scores(model, device, val_crops, val_labels, val_angles)
            print(f'classifier {step}/{args.cls_steps}  validation accuracy {accuracy:.2%}  angle error {error:.1f} deg', flush=True)
            if accuracy > best_accuracy:
                best_accuracy, best_error = accuracy, error
                torch.save(model.state_dict(), best_path)

    model.load_state_dict(torch.load(best_path, map_location=device))
    export_classifier(model, os.path.join(out_dir, 'cards.onnx'))
    return {'cls_accuracy': best_accuracy, 'angle_error_deg': best_error, 'cls_steps': args.cls_steps}


def export_classifier(model, path):
    import onnxruntime as ort

    model = model.eval().cpu()
    dummy = torch.randn(2, 3, CROP_SIZE, CROP_SIZE)
    torch.onnx.export(model, dummy, path, dynamo=False, opset_version=17, input_names=['image'],
                      output_names=['logits', 'orient'],
                      dynamic_axes={'image': {0: 'batch'}, 'logits': {0: 'batch'}, 'orient': {0: 'batch'}})
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    logits, orient = session.run(None, {'image': dummy.numpy()})
    with torch.no_grad():
        expected_logits, expected_orient = model(dummy)
    # Tolerance scaled by the output size: float32 noise alone exceeds an absolute 1e-3 once a network's activations
    # are large (an early-stopped or short run). A wrong export is off by the size of the output itself.
    for got, want in ((logits, expected_logits.numpy()), (orient, expected_orient.numpy())):
        if np.abs(got - want).max() > 0.02 * (1 + np.abs(want).max()):
            raise RuntimeError('ONNX classifier does not match the PyTorch model.')
    return path


def write_geometry(decks, out_dir):
    """geometry.json from the first deck capture that has one, else the defaults."""
    geometry = default_geometry()
    for path in sorted(glob.glob(os.path.join(decks, '*', 'geometry.json'))):
        with open(path) as handle:
            captured = json.load(handle)
        for key in ('card_aspect', 'index_cx', 'index_cy', 'index_h', 'joker_cy', 'joker_h'):
            if key in captured:
                geometry[key] = float(captured[key])
        break
    with open(os.path.join(out_dir, 'geometry.json'), 'w') as handle:
        json.dump({key: geometry[key] for key in ('card_aspect', 'index_cx', 'index_cy', 'index_h', 'joker_cy', 'joker_h')},
                  handle, indent=2)


def parse(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--decks', default='vision/datasets/deck', help='deck captures (capture_deck.py output)')
    parser.add_argument('--backgrounds', default='vision/datasets/backgrounds', help='your empty-rug photos (optional)')
    parser.add_argument('--samples', default='data/vision/samples', help='confirmed photo crops saved by the app')
    parser.add_argument('--out', default='vision/models')
    parser.add_argument('--det-iters', type=int, default=2000)
    parser.add_argument('--det-batch', type=int, default=8)
    parser.add_argument('--det-lr', type=float, default=0.02)
    parser.add_argument('--cls-steps', type=int, default=4000)
    parser.add_argument('--cls-batch', type=int, default=64)
    parser.add_argument('--cls-lr', type=float, default=1e-3)
    parser.add_argument('--val-scenes', type=int, default=60)
    parser.add_argument('--val-crops', type=int, default=3000)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--device', default='auto')
    parser.add_argument('--crop', type=int, default=TRAIN_CROP, help='detector training crop size')
    parser.add_argument('--no-pretrained', action='store_true', help='skip ImageNet weights (tests only)')
    parser.add_argument('--skip-detector', action='store_true',
                        help='reuse detector.pt and corners.onnx; retrain only the classifier')
    parser.add_argument('--eval-dir', default='data/vision/eval', help='truth files to evaluate at the end, if any')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse(argv)
    os.makedirs(args.out, exist_ok=True)
    faces = synth.load_faces(args.decks)
    decks = sorted(os.path.basename(os.path.dirname(path)) for path in glob.glob(os.path.join(args.decks, '*', 'boxes.json')))
    if faces:
        print(f'Faces: {len(faces)} captured (decks: {", ".join(decks)}), rendered on the fly', flush=True)
    else:
        print('No deck capture found: accuracy on real photos will be lower. See README "Capture your deck".', flush=True)
    device = pick_device(args.device)
    print(f'Device: {device}', flush=True)
    detector_path = os.path.join(args.out, 'corners.onnx')
    if args.skip_detector:
        if not (os.path.exists(detector_path) and os.path.exists(os.path.join(args.out, 'detector.pt'))):
            raise SystemExit('--skip-detector needs corners.onnx and detector.pt from an earlier run.')
        previous = {}
        metrics_path = os.path.join(args.out, 'metrics.json')
        if os.path.exists(metrics_path):
            with open(metrics_path) as handle:
                previous = json.load(handle)
        detector_metrics = {key: previous[key] for key in ('det_recall', 'det_precision', 'det_iters') if key in previous}
    else:
        detector_metrics = train_detector(args, faces, device, args.out)

    classifier_metrics = train_classifier(args, faces, device, args.out, args.samples)

    with open(os.path.join(args.out, 'labels.json'), 'w') as handle:
        json.dump(CODES, handle)
    write_geometry(args.decks, args.out)
    metrics = {**detector_metrics, **classifier_metrics, 'captured_faces': len(faces)}
    with open(os.path.join(args.out, 'metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
    print(f'Saved {args.out}: corners.onnx, cards.onnx, labels.json, geometry.json, metrics.json', flush=True)

    truth_files = sorted(glob.glob(os.path.join(args.eval_dir, '*.truth.json')))
    if truth_files:
        import evaluate
        evaluate.main(['--models', args.out] + truth_files)
    return metrics


if __name__ == '__main__':
    main()
