/**
 * useMapViewport.ts – Zoom and pan state of the network map SVG. The view is
 * applied as one CSS transform on the content group, so every change
 * (buttons, keys, wheel, focusing a selection) eases on the motion tokens as a
 * single continuous movement; while the user drags, the transition is off so
 * the map follows the pointer 1:1. Wheel zoom keeps the point under the cursor
 * fixed. A click that ends a drag is swallowed so panning never deselects.
 * Under Reduce Motion the global stylesheet drops transform transitions, so
 * the view changes instantly.
 *
 * Gestures do not go through React: drag and wheel update a live view held in
 * a ref and write it to the zoom layer (its transform and the --map-inv
 * counter-scale variable that markers read) once per animation frame. The
 * view is committed to React state when the gesture ends (pointer up, or a
 * short pause after the last wheel event), so the map re-renders once per
 * gesture instead of once per frame. Buttons, keys and focusing commit
 * directly.
 * Dependencies: react, mapGeometry.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
/** Quiet time after the last wheel event before the view is committed. */
const WHEEL_COMMIT_MS = 160;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: MapView;
  scale: number; // SVG units per screen pixel
  moved: boolean;
}

/** The zoom layer's CSS transform for a view. */
export function viewTransform(v: MapView): string {
  return `translate(${v.tx}px, ${v.ty}px) scale(${v.k})`;
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
  const layerRef = useRef<SVGGElement | null>(null);
  // Screen pixels per SVG unit at zoom 1 (the viewBox "meet" scale).
  const [pixelScale, setPixelScale] = useState(1);
  const pixelScaleRef = useRef(1);
  pixelScaleRef.current = pixelScale;
  const [view, setViewState] = useState<MapView>(FIT_VIEW);
  const liveRef = useRef<MapView>(FIT_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const frameRef = useRef(0);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Writes a view straight to the zoom layer, bypassing React. */
  const paint = useCallback((v: MapView) => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.style.transform = viewTransform(v);
    layer.style.setProperty('--map-inv', String(1 / (v.k * pixelScaleRef.current)));
  }, []);

  /** Updates the live view and paints it on the next animation frame. */
  const setLive = useCallback(
    (v: MapView) => {
      liveRef.current = v;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        paint(liveRef.current);
      });
    },
    [paint],
  );

  const commit = useCallback((next: MapView) => {
    if (wheelTimerRef.current) {
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
    liveRef.current = next;
    setViewState(next);
  }, []);

  // React owns the committed view; keep the layer in sync with it (also
  // after a commit that equals the previous render, which React would skip).
  useLayoutEffect(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    paint(view);
  }, [view, pixelScale, paint]);

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  const setView = useCallback((next: MapView) => commit(clampView(next)), [commit]);

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

  const zoomBy = useCallback(
    (factor: number, around?: [number, number]) => {
      const [px, py] = around ?? [MAP_WIDTH / 2, MAP_HEIGHT / 2];
      commit(zoomAround(liveRef.current, factor, px, py));
    },
    [commit],
  );

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const reset = useCallback(() => commit(FIT_VIEW), [commit]);
  /** Centres (x, y), zooming in to at least minZoom; shiftPx moves the target
   *  sideways on screen (e.g. beside a sheet floating over the map). */
  const focusOn = useCallback(
    (x: number, y: number, minZoom: number, shiftPx = 0) => {
      const k = Math.max(liveRef.current.k, minZoom);
      const shift = shiftPx / pixelScaleRef.current;
      commit(focusView(x - shift / k, y, k));
    },
    [commit],
  );
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = liveRef.current;
      commit(clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    },
    [commit],
  );

  // Wheel / trackpad zoom around the cursor; needs a non-passive listener to
  // keep the page from scrolling. Painted per frame, committed after a pause.
  useEffect(() => {
    if (!svgEl) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      const [px, py] = clientToSvg(event.clientX, event.clientY);
      setLive(zoomAround(liveRef.current, factor, px, py));
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        wheelTimerRef.current = null;
        setViewState(liveRef.current);
      }, WHEEL_COMMIT_MS);
    }
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    return () => svgEl.removeEventListener('wheel', onWheel);
  }, [svgEl, clientToSvg, setLive]);

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
        origin: liveRef.current,
        scale: unitsPerPixel(),
        moved: false,
      };
    },
    [unitsPerPixel],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
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
      setLive(
        clampView({
          ...drag.origin,
          tx: drag.origin.tx + dx * drag.scale,
          ty: drag.origin.ty + dy * drag.scale,
        }),
      );
    },
    [setLive],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      if (drag.moved) {
        suppressClickRef.current = true;
        setDragging(false);
        commit(liveRef.current);
      }
    },
    [commit],
  );

  /** True (once) when the click being handled ends a drag. */
  const consumeDragClick = useCallback((): boolean => {
    const was = suppressClickRef.current;
    suppressClickRef.current = false;
    return was;
  }, []);

  return {
    svgRef: attachSvg,
    layerRef,
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
