"""
Test to simulate what ocr_service.py does
"""
import numpy as np
import cv2
from paddleocr import PaddleOCR

# Create a test image
img = np.zeros((200, 600, 3), dtype=np.uint8)
img.fill(255)
cv2.putText(img, 'Hello World Test!', (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3)

print("Initializing PaddleOCR...")
engine = PaddleOCR(use_angle_cls=True, lang='en')

print("Running OCR...")
result = engine.ocr(img)

print(f"Result type: {type(result)}, len: {len(result)}")

if result and result[0] is not None:
    raw_data = result[0]
    print(f"raw_data type: {type(raw_data)}")
    
    # Exactly mimic the ocr_service.py logic
    extracted_lines = None
    
    # Check if list with standard structure
    if isinstance(raw_data, list):
        print("raw_data is a list")
        if len(raw_data) > 0 and isinstance(raw_data[0], (list, tuple)) and len(raw_data[0]) >= 2:
            item = raw_data[0]
            if isinstance(item[1], tuple) and len(item[1]) >= 2:
                extracted_lines = raw_data
                print("Standard line format detected")
    
    # Try dict access for PaddleX OCRResult
    if extracted_lines is None:
        print("Trying dict access for PaddleX format...")
        components = {'dt_polys': None, 'rec_texts': None, 'rec_scores': None}
        
        if hasattr(raw_data, '__getitem__'):
            print("Has __getitem__, trying dict access")
            for key in components.keys():
                try:
                    val = raw_data[key]
                    print(f"  Accessing '{key}': got {type(val)}")
                    if val is not None:
                        if hasattr(val, 'tolist'):
                            val = val.tolist()
                        components[key] = val
                        print(f"  SUCCESS: {key} has {len(val) if hasattr(val, '__len__') else 'N/A'} items")
                except (KeyError, IndexError, TypeError) as e:
                    print(f"  FAILED '{key}': {type(e).__name__}: {e}")
        
        print(f"\nComponents after dict access:")
        for k, v in components.items():
            print(f"  {k}: {type(v)}, len={len(v) if v else 0}")
        
        # Reconstruct lines
        if components['rec_texts'] and isinstance(components['rec_texts'], list):
            texts = components['rec_texts']
            boxes = components['dt_polys']
            scores = components['rec_scores']
            
            count = len(texts)
            print(f"\nReconstructing {count} lines...")
            
            if boxes is None or len(boxes) != count:
                boxes = [[[0, i*20], [100, i*20], [100, i*20+15], [0, i*20+15]] for i in range(count)]
            
            if scores is None or len(scores) != count:
                scores = [0.99] * count
            
            extracted_lines = []
            for i in range(count):
                extracted_lines.append([boxes[i], (texts[i], scores[i])])
            
            print(f"Extracted {len(extracted_lines)} lines")
    
    # Final text extraction
    if extracted_lines:
        print("\n=== FINAL OUTPUT ===")
        for line in extracted_lines:
            box, (text, score) = line
            print(f"  Text: '{text}' (score: {score:.2f})")
    else:
        print("\nNO LINES EXTRACTED!")
else:
    print("Result is empty or None")
