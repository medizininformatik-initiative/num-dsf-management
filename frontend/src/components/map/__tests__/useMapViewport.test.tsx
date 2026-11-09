/**
 * useMapViewport.test.tsx – Pan and wheel gestures move the zoom layer
 * directly and commit the view to React state only when the gesture ends.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useMapViewport, viewTransform } from '../useMapViewport';

// jsdom has no PointerEvent; a MouseEvent with a pointerId is enough here.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

let renders = 0;
let latest: ReturnType<typeof useMapViewport> | null = null;

function Harness() {
  renders++;
  const viewport = useMapViewport();
  latest = viewport;
  return (
    <svg ref={viewport.svgRef} data-testid="svg" {...viewport.pointerHandlers}>
      <g ref={viewport.layerRef} data-testid="layer" />
    </svg>
  );
}

function flushFrames() {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

afterEach(() => {
  vi.useRealTimers();
  renders = 0;
  latest = null;
});

describe('useMapViewport', () => {
  it('pans the layer per frame and commits once on pointer up', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    const { getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    const layer = getByTestId('layer');
    const start = renders;

    fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100 - i * 10, clientY: 100 });
      flushFrames();
    }
    // The drag flag renders once; the moves themselves render nothing.
    expect(renders - start).toBe(1);
    expect(layer.style.transform).toBe('translate(-50px, 0px) scale(1)');
    expect(latest!.view.tx).toBe(0);

    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(latest!.view).toEqual({ k: 1, tx: -50, ty: 0 });
    expect(layer.style.transform).toBe(viewTransform(latest!.view));
  });

  it('zooms on wheel without rendering and commits after a pause', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    const { getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    const layer = getByTestId('layer');
    const start = renders;

    fireEvent.wheel(svg, { deltaY: -200, clientX: 0, clientY: 0 });
    flushFrames();
    fireEvent.wheel(svg, { deltaY: -200, clientX: 0, clientY: 0 });
    flushFrames();
    expect(renders).toBe(start);
    expect(layer.style.transform).toMatch(/scale\(2\.7/);
    expect(Number(layer.style.getPropertyValue('--map-inv'))).toBeCloseTo(1 / 2.718, 2);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(renders).toBe(start + 1);
    expect(latest!.view.k).toBeCloseTo(Math.E, 3);
  });

  it('zooms from the live view when a button follows a wheel gesture', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    const { getByTestId } = render(<Harness />);
    fireEvent.wheel(getByTestId('svg'), { deltaY: -200, clientX: 0, clientY: 0 });
    act(() => latest!.zoomIn());
    expect(latest!.view.k).toBeCloseTo(Math.exp(0.5) * 1.5, 3);
  });
});
