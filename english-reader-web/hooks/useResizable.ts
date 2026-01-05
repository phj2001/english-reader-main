import { useRef } from 'react';

interface LocalLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useResizable(setLocalLayout: (layout: LocalLayout) => void) {
    const resizeRef = useRef<{startX: number, startY: number, initialLayout: LocalLayout} | null>(null);

    const handleResizeStart = (e: React.MouseEvent, currentLayout: LocalLayout) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        resizeRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialLayout: currentLayout
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!resizeRef.current) return;
            const deltaX = moveEvent.clientX - resizeRef.current.startX;
            const deltaY = moveEvent.clientY - resizeRef.current.startY;
            
            setLocalLayout({
                ...resizeRef.current.initialLayout,
                width: Math.max(200, resizeRef.current.initialLayout.width + deltaX),
                height: Math.max(150, resizeRef.current.initialLayout.height + deltaY)
            });
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            resizeRef.current = null;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return { handleResizeStart };
}
