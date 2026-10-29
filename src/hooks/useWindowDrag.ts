import React, { useRef, useCallback } from 'react';

export function useWindowDrag(target: 'overlay' | 'settings') {
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      const targetEl = e.target as HTMLElement | null;
      if (targetEl) {
        if (targetEl.closest('button, input, textarea, select, a, [data-no-drag="true"]')) {
          return;
        }
      }

      isDraggingRef.current = true;
      lastPosRef.current = { x: e.screenX, y: e.screenY };

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const deltaX = moveEvent.screenX - lastPosRef.current.x;
        const deltaY = moveEvent.screenY - lastPosRef.current.y;
        lastPosRef.current = { x: moveEvent.screenX, y: moveEvent.screenY };

        if (deltaX !== 0 || deltaY !== 0) {
          window.cluely?.dragWindowMove?.(target, deltaX, deltaY);
        }
      };

      const onMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('blur', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onMouseUp);
    },
    [target]
  );

  return { onMouseDown };
}
