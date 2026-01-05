import { useState, useRef, useEffect } from 'react';

interface LocalLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useDraggable(initialLayout: LocalLayout | null, setLocalLayout: (layout: LocalLayout) => void) {
    const dragRef = useRef<{startX: number, startY: number, initialLayout: LocalLayout} | null>(null);

    const handleDragStart = (e: React.MouseEvent, currentLayout: LocalLayout) => {
        if (e.button !== 0) return;
        e.preventDefault();
        
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialLayout: currentLayout
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!dragRef.current) return;
            const deltaX = moveEvent.clientX - dragRef.current.startX;
            const deltaY = moveEvent.clientY - dragRef.current.startY;
            
            setLocalLayout({
                ...dragRef.current.initialLayout,
                x: dragRef.current.initialLayout.x + deltaX,
                y: dragRef.current.initialLayout.y + deltaY,
            });
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            dragRef.current = null;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return { handleDragStart };
}
