"""Software-only CCTV / image flood analysis (uploaded images and recorded videos).

Pipeline (OpenCV):
  * Road region prior: lower 45% of frame (camera looking down a street).
  * Water segmentation: low-saturation, low-texture, brown/grey/reflective pixels
    (HSV thresholds + local variance) with morphological cleanup.
  * Specular reflection ratio (bright low-saturation blobs inside water) supports detection.
  * Vehicle / obstacle blobs: contour analysis on edges (YOLOv8 used instead when the
    optional `ultralytics` package and weights are available).
  * Depth ESTIMATE: heuristic from water coverage of the road region and the fraction of
    detected vehicle blobs whose lower part is occluded by water. Always labelled ESTIMATE.
"""
from __future__ import annotations

import os

import cv2
import numpy as np

_YOLO = None


def _yolo():
    global _YOLO
    if _YOLO is None:
        try:
            from ultralytics import YOLO  # optional
            _YOLO = YOLO(os.environ.get("FS_YOLO_WEIGHTS", "yolov8n.pt"))
        except Exception:
            _YOLO = False
    return _YOLO


def analyse_frame(img: np.ndarray) -> dict:
    h, w = img.shape[:2]
    scale = 640 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
        h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mean = cv2.blur(gray, (9, 9))
    var = cv2.blur(gray * gray, (9, 9)) - mean * mean
    hch, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    brownish = ((hch >= 5) & (hch <= 30) & (s >= 40) & (s <= 170) & (v >= 50))
    greyish = (s < 45) & (v >= 60) & (v <= 235)
    # standing water is far smoother than asphalt texture; grey water needs a stricter smoothness test
    water = ((brownish & (var < 220)) | (greyish & (var < 45))).astype(np.uint8)
    road_mask = np.zeros_like(water)
    road_mask[int(h * 0.55):, :] = 1
    water &= road_mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    water = cv2.morphologyEx(water, cv2.MORPH_OPEN, k)
    water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, k)
    road_px = road_mask.sum()
    coverage = float(water.sum() / max(road_px, 1))
    specular = float(((v > 225) & (s < 30) & (water > 0)).sum() / max(water.sum(), 1))

    vehicles = []
    y = _yolo()
    if y:
        try:
            res = y(img, verbose=False)[0]
            for b in res.boxes:
                cls = res.names[int(b.cls)]
                if cls in ("car", "bus", "truck", "motorcycle", "bicycle", "person"):
                    x1, y1, x2, y2 = [int(v) for v in b.xyxy[0]]
                    vehicles.append({"label": cls, "box": [x1, y1, x2, y2], "confidence": round(float(b.conf), 2)})
        except Exception:
            vehicles = []
    detector = "YOLOv8" if y and vehicles is not None and _YOLO else "OpenCV contour heuristic"
    if not y:
        edges = cv2.Canny(img, 60, 160)
        edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
        cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            x, yy, ww, hh = cv2.boundingRect(c)
            area = ww * hh
            if area > 0.01 * h * w and area < 0.25 * h * w and 0.6 < ww / max(hh, 1) < 4 and yy + hh > h * 0.45:
                vehicles.append({"label": "vehicle/obstacle (heuristic)", "box": [x, yy, x + ww, yy + hh], "confidence": 0.4})
        vehicles = vehicles[:12]
    submerged = 0
    for vh in vehicles:
        x1, y1, x2, y2 = vh["box"]
        band = water[max(y2 - (y2 - y1) // 4, 0): y2, max(x1, 0): x2]
        vh["lower_part_in_water"] = bool(band.size and band.mean() > 0.5)
        submerged += vh["lower_part_in_water"]
    stranded = submerged
    # depth estimate (heuristic, ESTIMATE only)
    if coverage < 0.08:
        depth, band = 0.0, "0 cm (no significant water)"
    elif coverage < 0.25:
        depth, band = 0.05, "0–10 cm (ankle-deep)"
    elif coverage < 0.5:
        depth, band = 0.2, "10–30 cm (knee-deep; unsafe for two-wheelers)"
    elif coverage < 0.75:
        depth, band = 0.4, "30–50 cm (unsafe for cars)"
    else:
        depth, band = 0.6, "> 50 cm (impassable)"
    if vehicles and submerged / len(vehicles) > 0.5:
        depth = max(depth, 0.35)
        band = "≥ 30 cm (vehicle wheels submerged)"
    blocked = coverage > 0.6 or (stranded >= 2)
    passability = ("IMPASSABLE" if depth >= 0.5 else "EMERGENCY_VEHICLES_ONLY" if depth >= 0.3
                   else "UNSAFE_LIGHT_VEHICLES" if depth >= 0.15 else "PASSABLE_WITH_CAUTION" if depth > 0 else "PASSABLE")
    severity = ("CRITICAL" if depth >= 0.5 else "HIGH" if depth >= 0.3 else "MODERATE" if depth >= 0.1 else "LOW")
    traffic = "HEAVY" if len(vehicles) >= 6 else "MODERATE" if len(vehicles) >= 3 else "LIGHT"
    conf = float(np.clip(0.45 + 0.4 * abs(coverage - 0.3) + 0.1 * min(specular * 5, 1), 0.3, 0.85))
    return {
        "water_detected": coverage >= 0.08, "water_coverage_pct": round(coverage * 100, 1),
        "reflection_ratio": round(specular, 3), "flooded_road": coverage >= 0.3,
        "vehicles_detected": len(vehicles), "stranded_vehicles": stranded, "road_blocked": blocked,
        "traffic": traffic, "passability": passability, "severity": severity,
        "estimated_depth_m": depth, "estimated_depth_band": band, "confidence": round(conf, 2),
        "detector": detector, "detections": vehicles,
        "is_estimate": True, "data_label": "USER_REPORTED_DATA",
        "disclaimer": "Depth and severity are computer-vision ESTIMATES from uploaded media, not measurements.",
    }


def analyse_image_bytes(data: bytes) -> dict:
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    r = analyse_frame(img)
    r["mask_preview"] = None
    return r


def analyse_video_file(path: str, max_frames: int = 24) -> dict:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("Could not open video")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    idxs = np.linspace(0, max(total - 1, 0), min(max_frames, total)).astype(int)
    frames = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, fr = cap.read()
        if not ok:
            continue
        r = analyse_frame(fr)
        frames.append({"t_sec": round(i / fps, 1), **{k: r[k] for k in ("water_coverage_pct", "estimated_depth_m", "severity",
                                                                          "vehicles_detected", "stranded_vehicles", "road_blocked")}})
    cap.release()
    if not frames:
        raise ValueError("No readable frames")
    worst = max(frames, key=lambda f: f["estimated_depth_m"])
    cov = [f["water_coverage_pct"] for f in frames]
    trend = "RISING" if cov[-1] - cov[0] > 10 else "RECEDING" if cov[0] - cov[-1] > 10 else "STABLE"
    return {"frames_analysed": len(frames), "duration_sec": round(total / fps, 1), "timeline": frames,
            "max_estimated_depth_m": worst["estimated_depth_m"], "severity": worst["severity"],
            "water_trend": trend, "road_blocked_any": any(f["road_blocked"] for f in frames),
            "max_vehicles": max(f["vehicles_detected"] for f in frames),
            "is_estimate": True, "data_label": "USER_REPORTED_DATA",
            "disclaimer": "Frame-sampled computer-vision ESTIMATES from recorded video; not live CCTV, not measurements."}


def make_sample_image(kind: str = "flooded") -> bytes:
    """Deterministic synthetic street image for demos/tests (no real CCTV)."""
    h, w = 360, 640
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = (190, 170, 150)  # sky
    cv2.rectangle(img, (0, 120), (w, 200), (90, 90, 100), -1)  # buildings
    for x in range(0, w, 80):
        cv2.rectangle(img, (x + 5, 60 + (x % 3) * 15), (x + 70, 200), (70 + x % 40, 80, 95), -1)
    cv2.rectangle(img, (0, 200), (w, h), (95, 95, 95), -1)  # road
    rng = np.random.default_rng(3)
    noise = rng.normal(0, 26, (h - 200, w, 1)).repeat(3, axis=2)
    img[200:] = np.clip(img[200:] + noise, 0, 255).astype(np.uint8)
    for x in range(0, w, 90):
        cv2.line(img, (x, 300), (x + 45, 300), (230, 230, 230), 4)  # lane markings
    if kind == "flooded":
        water = np.zeros((h - 170, w, 3), np.uint8)
        water[:] = (70, 110, 140)  # muddy brown (BGR)
        img[170:] = water
        for i in range(12):
            cv2.ellipse(img, (40 + i * 50, 250 + (i % 3) * 30), (30, 4), 0, 0, 360, (240, 240, 240), -1)
        for x in (120, 360):
            cv2.rectangle(img, (x, 190), (x + 150, 240), (30, 30, 160), -1)
    return cv2.imencode(".jpg", img)[1].tobytes()
