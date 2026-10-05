/**
 * useMapViewport.ts – Zoom and pan state of the network map SVG. The view is
 * applied by GeoMap as one CSS transform on the content group, so every change
 * (buttons, keys, wheel, focusing a selection) eases on the motion tokens as a
 * single continuous movement; while the user drags, the transition is off so
 * the map follows the pointer 1:1. Wheel zoom keeps the point under the cursor
 * fixed. A click that ends a drag is swallowed so panning never deselects.
 * Under Reduce Motion the global stylesheet drops transform transitions, so
 * the view changes instantly.
 * Dependencies: react, mapGeometry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIT_VIEW,
  MAP_HEIGHT,
  MAP_WIDTH,
  clampView,
  focusView,
  zoomAround,
  type MapView,
} from './mapGeometry';

const ZOOM_STEP = 1.5;
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: MapView;
  scale: number; // SVG units per screen pixel
  moved: boolean;
}

export function useMapViewport() {
  // A callback ref tracked in state, so listeners re-attach when the SVG
  // remounts (e.g. after the "no matches" state).
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const attachSvg = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    setSvgEl(el);
  }, []);
  // Screen pixels per SVG unit at zoom 1 (the viewBox "meet" scale).
  const [pixelScale, setPixelScale] = useState(1);
  const [view, setViewState] = useState<MapView>(FIT_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const setView = useCallback((next: MapView) => setViewState(clampView(next)), []);

  /** SVG units per screen pixel (1 without layout, e.g. in jsdom). */
  const unitsPerPixel = useCallback((): number => {
    const ctm = svgRef.current?.getScreenCTM?.();
    return ctm && ctm.a ? 1 / ctm.a : 1;
  }, []);

  /** Client coordinates → SVG viewBox coordinates (centre without layout). */
  const clientToSvg = useCallback((clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') {
      return [MAP_WIDTH / 2, MAP_HEIGHT / 2];
    }
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  const zoomBy = useCallback((factor: number, around?: [number, number]) => {
    const [px, py] = around ?? [MAP_WIDTH / 2, MAP_HEIGHT / 2];
    setViewState((v) => zoomAround(v, factor, px, py));
  }, []);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const reset = useCallback(() => setViewState(FIT_VIEW), []);
  /** Centres (x, y), zooming in to at least minZoom; shiftPx moves the target
   *  sideways on screen (e.g. beside a sheet floating over the map). */
  const focusOn = useCallback(
    (x: number, y: number, minZoom: number, shiftPx = 0) => {
      setViewState((v) => {
        const k = Math.max(v.k, minZoom);
        const shift = shiftPx / pixelScale;
        return focusView(x - shift / k, y, k);
      });
    },
    [pixelScale],
  );
  const panBy = useCallback((dx: number, dy: number) => {
    setViewState((v) => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }, []);

  // Wheel / trackpad zoom around the cursor; needs a non-passive listener to
  // keep the page from scrolling.
  useEffect(() => {
    if (!svgEl) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      zoomBy(factor, clientToSvg(event.clientX, event.clientY));
    }
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
  }, [svgEl, zoomBy, clientToSvg]);

  // Follow the SVG's rendered size so markers can keep a fixed screen size.
  useEffect(() => {
    if (!svgEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setPixelScale(Math.min(width / MAP_WIDTH, height / MAP_HEIGHT));
      }
    });
    observer.observe(svgEl);
    return () => observer.disconnect();
  }, [svgEl]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: view,
        scale: unitsPerPixel(),
        moved: false,
      };
    },
    [view, unitsPerPixel],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setViewState(
      clampView({
        ...drag.origin,
        tx: drag.origin.tx + dx * drag.scale,
        ty: drag.origin.ty + dy * drag.scale,
      }),
    );
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      suppressClickRef.current = true;
      setDragging(false);
    }
  }, []);

  /** True (once) when the click being handled ends a drag. */
  const consumeDragClick = useCallback((): boolean => {
    const was = suppressClickRef.current;
    suppressClickRef.current = false;
    return was;
  }, []);

  return {
    svgRef: attachSvg,
    view,
    pixelScale,
    dragging,
    setView,
    zoomIn,
    zoomOut,
    reset,
    focusOn,
    panBy,
    consumeDragClick,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
