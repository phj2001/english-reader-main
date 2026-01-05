import React, { useEffect, useState } from 'react';
import { useDraggable } from '../hooks/useDraggable';
import { useResizable } from '../hooks/useResizable';

interface TranslationPopupProps {
  initialX: number;
  initialY: number;
  text: string;
  translation: string;
  onClose: () => void;
  // External layout state management could be passed here if persistence is needed across unmounts,
  // but for simplicity we keep local state or accept initial props.
  // We'll trust the parent to pass the correct initial position.
}

export const TranslationPopup: React.FC<TranslationPopupProps> = ({ initialX, initialY, text, translation, onClose }) => {
    // Local layout state for immediate feedback
    const [layout, setLayout] = useState({ x: initialX, y: initialY, width: 384, height: 300 }); // height is sort of initial guess or min

    const { handleDragStart } = useDraggable(layout, setLayout);
    const { handleResizeStart } = useResizable(setLayout);
    
    // Sync if props change significantly (optional, but mainly we trust internal state)
    // Actually, usually we want the popup to stay where it is dragged, so we don't reset on prop change unless text changes drastically or it's a new instance.
    
    return (
         <div 
            className="fixed z-50 bg-gray-900/95 backdrop-blur-md text-white shadow-2xl rounded-xl flex flex-col animate-in fade-in zoom-in-95 duration-200"
            style={{ 
              left: layout.x,
              top: layout.y,
              width: layout.width,
              height: layout.height, 
              // maxHeight: 'none', // Controlled by height now
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()} 
         >
            {/* Draggable Header */}
            <div 
                className="flex items-center justify-between px-5 py-3 border-b border-gray-700 cursor-move select-none"
                onMouseDown={(e) => handleDragStart(e, layout)}
            >
               <div className="flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <span className="text-sm font-medium text-gray-300">AI 翻译</span>
               </div>
               
               <button 
                 onClick={onClose}
                 className="text-gray-400 hover:text-white transition-colors"
                 onMouseDown={(e) => e.stopPropagation()}
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5">
                <p className="text-gray-300 text-sm italic mb-4 border-l-2 border-blue-500 pl-3 leading-relaxed opacity-80 select-text">
                "{text}"
                </p>

                <div className="text-base leading-relaxed font-light select-text">
                {translation === "翻译中..." ? (
                    <span className="animate-pulse flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                        翻译中...
                    </span>
                ) : (
                    translation
                )}
                </div>
            </div>

            {/* Resize Handle (Bottom Right) */}
            <div 
                className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-end justify-end p-1"
                onMouseDown={(e) => handleResizeStart(e, layout)}
            >
                <div className="w-2 h-2 bg-gray-500 rounded-full opacity-50"></div>
            </div>
         </div>
  );
};
