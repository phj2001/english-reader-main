
import os
import cv2
import numpy as np

class OCRService:
    def __init__(self):
        """Initialize OCR with PP-StructureV3 for proper layout analysis and paragraph detection."""
        print("Initializing PP-StructureV3 for layout analysis... This might take a moment.")
        self.engine = None
        self.use_structure = False
        
        try:
            from paddleocr import PPStructureV3
            self.engine = PPStructureV3(lang='en')
            self.use_structure = True
            print("PP-StructureV3 initialized successfully - paragraph detection enabled!")
        except Exception as e:
            print(f"PP-StructureV3 initialization failed: {e}")
            print("Falling back to basic PaddleOCR...")
            try:
                from paddleocr import PaddleOCR
                self.engine = PaddleOCR(use_angle_cls=True, lang='en')
                print("PaddleOCR (basic) initialized successfully.")
            except Exception as e2:
                print(f"Failed to initialize any OCR engine: {e2}")
                self.engine = None

    def parse_image(self, file_bytes: bytes) -> str:
        """
        Parse image bytes and return text with proper paragraph formatting.
        Uses PP-StructureV3 for layout analysis when available.
        """
        if not self.engine:
            return "OCR Engine not initialized."

        try:
            # Convert bytes to numpy array (opencv format)
            nparr = np.frombuffer(file_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                return "Failed to decode image."

            if self.use_structure:
                return self._parse_with_structure(img)
            else:
                return self._parse_with_basic_ocr(img)

        except Exception as e:
            print(f"OCR Error: {e}")
            import traceback
            traceback.print_exc()
            return f"Error during OCR processing: {str(e)}"

    def _parse_with_structure(self, img) -> str:
        """
        Parse image using PP-StructureV3 for proper paragraph detection.
        Each LayoutBlock represents a paragraph with proper text content.
        Uses unique markers to preserve paragraph boundaries through spaCy processing.
        """
        print("DEBUG: Using PP-StructureV3 for layout analysis")
        
        # Run structure analysis
        result = self.engine.predict(img)
        
        if not result:
            return ""
        
        # Get the first result (single image)
        page_result = result[0]
        
        # Extract paragraphs from parsing_res_list
        parsing_list = page_result.get('parsing_res_list', [])
        
        print(f"DEBUG: Found {len(parsing_list)} layout blocks")
        
        paragraphs = []
        for i, block in enumerate(parsing_list):
            # Get block label (type)
            label = getattr(block, 'label', None) or getattr(block, 'type', 'unknown')
            
            # Get content
            content = getattr(block, 'content', None)
            
            if content:
                # Clean up the content - PP-StructureV3 may concatenate lines without spaces
                content = content.strip()
                if content:
                    paragraphs.append(content)
                    print(f"DEBUG: Block {i+1} ({label}): {content[:80]}...")
        
        # Join paragraphs with UNIQUE MARKER that won't be destroyed by spaCy
        # Using a marker that's unlikely to appear in natural text
        raw_text = " <<<PARAGRAPH_BREAK>>> ".join(paragraphs)
        
        # Post-process: Split on paragraph markers (K), L), M), 1), 2), A), etc.)
        final_text = self._split_on_paragraph_markers(raw_text)
        
        print(f"DEBUG: Final text length: {len(final_text)} chars")
        print(f"DEBUG: Paragraph markers count: {final_text.count('<<<PARAGRAPH_BREAK>>>')}")
        
        return final_text
    
    def _split_on_paragraph_markers(self, text: str) -> str:
        """
        Add paragraph breaks before paragraph markers like K), L), M), N), 1), 2), etc.
        Uses unique <<<PARAGRAPH_BREAK>>> marker for robust processing.
        """
        import re
        
        # Pattern: letter or number followed by ) at the start of what looks like a paragraph
        # Matches: K), L), M), N), 1), 2), A), B), etc.
        # The marker should be followed by a capital letter (start of sentence)
        
        # Insert a paragraph break before each paragraph marker
        # Pattern: not at start, followed by letter/number + ) + space + uppercase letter
        result = re.sub(
            r'(?<!^)(?<!<<<PARAGRAPH_BREAK>>> )([A-Z])\)\s*(?=[A-Z])',  # K), L), M), N) format
            r' <<<PARAGRAPH_BREAK>>> \1) ',
            text
        )
        
        # Also handle numbered format: 1), 2), 3), etc.
        result = re.sub(
            r'(?<!^)(?<!<<<PARAGRAPH_BREAK>>> )(\d{1,2})\)\s*(?=[A-Z])',
            r' <<<PARAGRAPH_BREAK>>> \1) ',
            result
        )
        
        print(f"DEBUG: Applied paragraph marker splitting")
        print(f"DEBUG: Total paragraph markers after splitting: {result.count('<<<PARAGRAPH_BREAK>>>')}")
        
        return result

    def _parse_with_basic_ocr(self, img) -> str:
        """
        Fallback parsing using basic PaddleOCR without layout analysis.
        Uses enhanced heuristic paragraph detection based on line spacing and indentation.
        """
        print("DEBUG: Using basic PaddleOCR (fallback)")
        
        result = self.engine.ocr(img)
        
        if not result or result[0] is None:
            return ""

        raw_data = result[0]
        
        # Extract text from OCRResult format
        if hasattr(raw_data, '__getitem__'):
            try:
                rec_texts = raw_data['rec_texts']
                dt_polys = raw_data['dt_polys']
                rec_scores = raw_data.get('rec_scores', [0.99] * len(rec_texts))
            except (KeyError, TypeError):
                # Fallback for list format
                if isinstance(raw_data, list):
                    rec_texts = []
                    dt_polys = []
                    rec_scores = []
                    for item in raw_data:
                        if isinstance(item, (list, tuple)) and len(item) >= 2:
                            dt_polys.append(item[0])
                            if isinstance(item[1], tuple):
                                rec_texts.append(item[1][0])
                                rec_scores.append(item[1][1])
                            else:
                                rec_texts.append(str(item[1]))
                                rec_scores.append(0.99)
                else:
                    return ""
        else:
            return ""
        
        if not rec_texts:
            return ""
        
        # Build line data with coordinates
        line_data = []
        for i, (box, text) in enumerate(zip(dt_polys, rec_texts)):
            if hasattr(box, 'tolist'):
                box = box.tolist()
            if isinstance(box, list) and len(box) >= 4:
                y_coords = [p[1] for p in box if isinstance(p, list) and len(p) >= 2]
                x_coords = [p[0] for p in box if isinstance(p, list) and len(p) >= 2]
                if y_coords and x_coords:
                    top_y = min(y_coords)
                    bottom_y = max(y_coords)
                    left_x = min(x_coords)
                    right_x = max(x_coords)
                    line_data.append({
                        'text': str(text),
                        'top_y': top_y,
                        'bottom_y': bottom_y,
                        'left_x': left_x,
                        'right_x': right_x,
                        'line_height': bottom_y - top_y,
                        'width': right_x - left_x
                    })
        
        if not line_data:
            return " ".join(rec_texts)
        
        # Sort by Y coordinate
        line_data.sort(key=lambda x: x['top_y'])
        
        # Calculate statistics for paragraph detection
        gaps = []
        for i in range(1, len(line_data)):
            gap = line_data[i]['top_y'] - line_data[i-1]['bottom_y']
            gaps.append(gap)
        
        if not gaps:
            return line_data[0]['text']
        
        sorted_gaps = sorted(gaps)
        median_gap = sorted_gaps[len(sorted_gaps) // 2]
        avg_line_height = sum(d['line_height'] for d in line_data) / len(line_data)
        
        # Improved paragraph threshold: more aggressive detection
        # Use 1.2x median gap OR median + 40% of line height, whichever is larger
        paragraph_threshold = max(median_gap * 1.2, median_gap + avg_line_height * 0.4)
        
        print(f"DEBUG: Median gap: {median_gap:.1f}, Avg line height: {avg_line_height:.1f}, Threshold: {paragraph_threshold:.1f}")
        
        # Detect left margin for indentation detection
        left_margins = [d['left_x'] for d in line_data]
        min_margin = min(left_margins)
        
        # Build paragraphs with enhanced detection
        paragraphs = []
        current_paragraph = [line_data[0]['text']]
        
        for i in range(1, len(line_data)):
            gap = line_data[i]['top_y'] - line_data[i-1]['bottom_y']
            
            # Check for indentation change (new paragraph indicator)
            indent_change = abs(line_data[i]['left_x'] - line_data[i-1]['left_x']) > avg_line_height * 0.5
            
            # Check if first line is indented (common paragraph start)
            is_indented = (line_data[i]['left_x'] - min_margin) > avg_line_height * 0.3
            
            # Paragraph break conditions:
            # 1. Gap exceeds threshold
            # 2. Significant indentation change
            # 3. Current line is indented (potential paragraph start)
            if gap > paragraph_threshold or indent_change or (is_indented and gap > median_gap * 0.8):
                paragraphs.append(" ".join(current_paragraph))
                current_paragraph = [line_data[i]['text']]
                print(f"DEBUG: Paragraph break detected at line {i} (gap: {gap:.1f}, indent_change: {indent_change}, indented: {is_indented})")
            else:
                current_paragraph.append(line_data[i]['text'])
        
        if current_paragraph:
            paragraphs.append(" ".join(current_paragraph))
        
        # Use unique marker for paragraph separation
        result_text = " <<<PARAGRAPH_BREAK>>> ".join(paragraphs)
        
        print(f"DEBUG: Detected {len(paragraphs)} paragraphs")
        print(f"DEBUG: Paragraph markers: {result_text.count('<<<PARAGRAPH_BREAK>>>')}")
        
        return result_text


