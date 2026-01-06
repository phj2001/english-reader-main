"""
Detailed test of PaddleOCR output structure
"""
import numpy as np
import cv2
from paddleocr import PaddleOCR

# Create a test image with clear text
img = np.zeros((200, 600, 3), dtype=np.uint8)
img.fill(255)
cv2.putText(img, 'Hello World Test!', (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3)
cv2.putText(img, 'Second line here', (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3)
cv2.imwrite('debug_test.png', img)

print("=" * 60)
print("Initializing PaddleOCR...")
engine = PaddleOCR(use_angle_cls=True, lang='en')

print("Running OCR on test image...")
result = engine.ocr(img)

print("=" * 60)
print(f"result type: {type(result)}")
print(f"result length: {len(result) if result else 0}")

if result and len(result) > 0:
    raw_data = result[0]
    print(f"\nresult[0] type: {type(raw_data)}")
    print(f"result[0] class name: {raw_data.__class__.__name__}")
    
    # Check if it's a dict-like object
    print("\n--- Checking dict-like access ---")
    if hasattr(raw_data, '__getitem__'):
        print("Has __getitem__")
        test_keys = ['dt_polys', 'rec_texts', 'rec_scores', 'rec_text', 'rec_score', 'texts', 'boxes']
        for key in test_keys:
            try:
                val = raw_data[key]
                if val is not None:
                    print(f"  raw_data['{key}'] = {type(val)}, len={len(val) if hasattr(val, '__len__') else 'N/A'}")
                    if hasattr(val, '__len__') and len(val) > 0:
                        print(f"    First item: {val[0]}")
            except Exception as e:
                print(f"  raw_data['{key}'] -> Error: {e}")
    
    # Check with hasattr
    print("\n--- Checking attributes with hasattr ---")
    test_attrs = ['dt_polys', 'rec_texts', 'rec_scores', 'rec_text', 'rec_score']
    for attr in test_attrs:
        has = hasattr(raw_data, attr)
        print(f"  hasattr('{attr}'): {has}")
        if has:
            try:
                val = getattr(raw_data, attr)
                print(f"    Value type: {type(val)}, len={len(val) if hasattr(val, '__len__') else 'N/A'}")
            except Exception as e:
                print(f"    getattr error: {e}")
    
    # List ALL attributes via dir()
    print("\n--- All non-underscore attributes from dir() ---")
    try:
        public_attrs = [a for a in dir(raw_data) if not a.startswith('_')]
        print(f"Attrs: {public_attrs}")
    except Exception as e:
        print(f"dir() error: {e}")
    
    # If it's actually a list, check structure
    if isinstance(raw_data, list):
        print("\n--- result[0] IS A LIST ---")
        print(f"Length: {len(raw_data)}")
        if len(raw_data) > 0:
            print(f"First item type: {type(raw_data[0])}")
            print(f"First item: {raw_data[0]}")

print("\n" + "=" * 60)
print("Done!")
