"""Train the card classifier and export it for offline recognition.

Recipe adapted from ajojotank/Playing-Card-Recognition-with-EfficientNet-B0 (MIT
licence): a timm EfficientNet-B0 with a new 53-class head. Added here: a held-out
test split, augmentation for phone photos, best-checkpoint selection, your own
corrected photo crops as extra training data, and ONNX export.

Data:
  --data     <dir>/{train,valid,test}/<class folder>/*.jpg
             (the Kaggle "Cards Image Dataset-Classification" layout; folder names
             like 'ace of clubs' or 'joker')
  --samples  <dir>/<card code>/*.jpg, crops saved by the app when players confirm
             a photo; added to training and repeated --sample-repeat times

Output (--out): cards.onnx, labels.json, metrics.json, best.pt
"""
import argparse
import json
import os
import random

import torch
import timm
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

from classes import CODES, code_from_folder

INPUT_SIZE = 224
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png')


def collect(folder, repeat=1):
    """[(image path, label index)] from <folder>/<class folder>/*; unknown folders are skipped."""
    items = []
    if not folder or not os.path.isdir(folder):
        return items
    for name in sorted(os.listdir(folder)):
        code = code_from_folder(name)
        path = os.path.join(folder, name)
        if code is None or not os.path.isdir(path):
            continue
        for file in sorted(os.listdir(path)):
            if file.lower().endswith(IMAGE_EXTENSIONS):
                items.extend([(os.path.join(path, file), CODES.index(code))] * repeat)
    return items


class CardImages(Dataset):
    def __init__(self, items, transform):
        self.items = items
        self.transform = transform

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        path, label = self.items[index]
        return self.transform(Image.open(path).convert('RGB')), label


class RandomHalfTurn:
    """Cards are often photographed upside down."""
    def __call__(self, image):
        return image.rotate(180) if random.random() < 0.5 else image


def build_transforms():
    train = transforms.Compose([
        transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
        RandomHalfTurn(),
        transforms.RandomAffine(degrees=8, translate=(0.05, 0.05), scale=(0.9, 1.05)),
        transforms.RandomPerspective(distortion_scale=0.15, p=0.3),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.03),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    evaluate = transforms.Compose([
        transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    return train, evaluate


def pick_device(name):
    if name != 'auto':
        return torch.device(name)
    if torch.backends.mps.is_available():
        return torch.device('mps')
    return torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def accuracy(model, loader, device):
    if loader is None:
        return None
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for images, labels in loader:
            predictions = model(images.to(device)).argmax(dim=1).cpu()
            correct += (predictions == labels).sum().item()
            total += labels.numel()
    return correct / total if total else None


def export_onnx(model, out_dir):
    model = model.eval().cpu()
    dummy = torch.randn(2, 3, INPUT_SIZE, INPUT_SIZE)
    path = os.path.join(out_dir, 'cards.onnx')
    options = dict(input_names=['image'], output_names=['logits'],
                   dynamic_axes={'image': {0: 'batch'}, 'logits': {0: 'batch'}}, opset_version=17)
    try:
        torch.onnx.export(model, dummy, path, dynamo=False, **options)
    except TypeError:  # older torch without the dynamo switch
        torch.onnx.export(model, dummy, path, **options)
    # Check the exported model gives the same answers as PyTorch.
    import numpy as np
    import onnxruntime as ort
    session = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    exported = session.run(None, {'image': dummy.numpy()})[0]
    with torch.no_grad():
        expected = model(dummy).numpy()
    if not np.allclose(exported, expected, atol=1e-3):
        raise RuntimeError('ONNX export does not match the PyTorch model.')
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data', default='vision/datasets/cards')
    parser.add_argument('--samples', default='data/vision/samples')
    parser.add_argument('--out', default='vision/models')
    parser.add_argument('--epochs', type=int, default=12)
    parser.add_argument('--batch', type=int, default=32)
    parser.add_argument('--lr', type=float, default=3e-4)
    parser.add_argument('--sample-repeat', type=int, default=5)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--device', default='auto')
    parser.add_argument('--no-pretrained', action='store_true', help='skip ImageNet weights (tests only)')
    args = parser.parse_args(argv)

    train_items = collect(os.path.join(args.data, 'train')) + collect(args.samples, args.sample_repeat)
    valid_items = collect(os.path.join(args.data, 'valid'))
    test_items = collect(os.path.join(args.data, 'test'))
    if not train_items:
        parser.error(f'No training images found under {args.data}/train or {args.samples}.')
    print(f'Images: {len(train_items)} train, {len(valid_items)} valid, {len(test_items)} test', flush=True)

    train_tf, eval_tf = build_transforms()
    loader = lambda items, tf, shuffle: DataLoader(CardImages(items, tf), batch_size=args.batch, shuffle=shuffle,
                                                   num_workers=args.workers) if items else None
    train_loader = loader(train_items, train_tf, True)
    valid_loader = loader(valid_items, eval_tf, False)
    test_loader = loader(test_items, eval_tf, False)

    device = pick_device(args.device)
    model = timm.create_model('efficientnet_b0', pretrained=not args.no_pretrained, num_classes=len(CODES)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    os.makedirs(args.out, exist_ok=True)
    best_path = os.path.join(args.out, 'best.pt')
    best = float('-inf')  # loss-based scores (no validation set) are negative and can be below -1
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        for images, labels in train_loader:
            optimizer.zero_grad()
            loss = loss_fn(model(images.to(device)), labels.to(device))
            loss.backward()
            optimizer.step()
            running += loss.item() * labels.numel()
        scheduler.step()
        valid = accuracy(model, valid_loader, device)
        score = valid if valid is not None else -running
        print(f'epoch {epoch}/{args.epochs}  loss {running / len(train_items):.4f}  valid {valid if valid is None else f"{valid:.2%}"}', flush=True)
        if score > best:
            best = score
            torch.save(model.state_dict(), best_path)

    model.load_state_dict(torch.load(best_path, map_location=device))
    metrics = {
        'valid_accuracy': accuracy(model, valid_loader, device),
        'test_accuracy': accuracy(model, test_loader, device),
        'train_images': len(train_items),
        'epochs': args.epochs,
    }
    print(f'test accuracy: {metrics["test_accuracy"]}', flush=True)
    onnx_path = export_onnx(model, args.out)
    with open(os.path.join(args.out, 'labels.json'), 'w') as handle:
        json.dump(CODES, handle)
    with open(os.path.join(args.out, 'metrics.json'), 'w') as handle:
        json.dump(metrics, handle, indent=2)
    print(f'Saved {onnx_path}', flush=True)
    return metrics


if __name__ == '__main__':
    main()
