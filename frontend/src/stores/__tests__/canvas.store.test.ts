/**
 * canvas.store.test.ts — pure test for the canvas store: which DSF instance is
 * currently active on the entity graph.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findEntityRow, useCanvasStore } from '../canvas.store';

describe('useCanvasStore', () => {
  it('updates the active instance id', () => {
    useCanvasStore.getState().setActiveInstance('inst-42');
    expect(useCanvasStore.getState().activeInstanceId).toBe('inst-42');
  });

  it('replaces the active instance on a second call', () => {
    useCanvasStore.getState().setActiveInstance('inst-1');
    useCanvasStore.getState().setActiveInstance('inst-2');
    expect(useCanvasStore.getState().activeInstanceId).toBe('inst-2');
  });
});

describe('useCanvasStore highlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    useCanvasStore.getState().highlightEntity(null);
    vi.useRealTimers();
  });

  it('auto-clears the highlight after 1800ms', () => {
    useCanvasStore.getState().highlightEntity('contacts');
    expect(useCanvasStore.getState().highlightedEntity).toBe('contacts');
    vi.advanceTimersByTime(1800);
    expect(useCanvasStore.getState().highlightedEntity).toBeNull();
  });

  it('a new highlight cancels the previous timer', () => {
    useCanvasStore.getState().highlightEntity('contacts');
    vi.advanceTimersByTime(1000); // first timer would fire at 1800
    useCanvasStore.getState().highlightEntity('endpoints');
    // The first timer must NOT clear the newer highlight at its original 1800.
    vi.advanceTimersByTime(800);
    expect(useCanvasStore.getState().highlightedEntity).toBe('endpoints');
    // The newer timer clears it 1800ms after the second call.
    vi.advanceTimersByTime(1000);
    expect(useCanvasStore.getState().highlightedEntity).toBeNull();
  });
});

describe('useCanvasStore row targets and relations', () => {
  afterEach(() => {
    useCanvasStore.getState().highlightEntity(null);
    useCanvasStore.getState().setActiveRelation(null);
    document.body.innerHTML = '';
  });

  it('keeps the row key with the highlight and clears both together', () => {
    vi.useFakeTimers();
    useCanvasStore.getState().highlightEntity('endpoints', 'fhir.ukm.example.de');
    expect(useCanvasStore.getState().highlightedKey).toBe('fhir.ukm.example.de');
    vi.advanceTimersByTime(1800);
    expect(useCanvasStore.getState().highlightedEntity).toBeNull();
    expect(useCanvasStore.getState().highlightedKey).toBeNull();
    vi.useRealTimers();
  });

  it('stores the active relation for the overlay', () => {
    const relation = { sourceId: 'fk-1', target: 'endpoints' as const, targetKey: 'ep' };
    useCanvasStore.getState().setActiveRelation(relation);
    expect(useCanvasStore.getState().activeRelation).toEqual(relation);
  });

  it('finds a row by entity and key, including keys with special characters', () => {
    document.body.innerHTML =
      '<div data-entity-row="endpoints:fhir.ukm.example.de"></div>' +
      '<div data-entity-row="contacts:a&quot;b"></div>';
    expect(findEntityRow('endpoints', 'fhir.ukm.example.de')).not.toBeNull();
    expect(findEntityRow('contacts', 'a"b')).not.toBeNull();
    expect(findEntityRow('endpoints', 'missing')).toBeNull();
  });
});
