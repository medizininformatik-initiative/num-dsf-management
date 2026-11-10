/**
 * helpScrollSpy.ts – which table-of-contents entry of the help page is current
 * for a scroll position. A section counts once its top has passed the reading
 * line below the sticky header; at the very end of the page the last section
 * wins, because the short last sections can never reach the line.
 * Dependencies: none.
 */

export interface SectionTop {
  id: string;
  /** Distance of the section's top edge from the scroll container's top edge. */
  top: number;
}

/**
 * @param sections in document order
 * @param line     reading line, from the container top (sticky header height + margin)
 * @param atBottom the container is scrolled to its end
 */
export function pickActiveSection(
  sections: SectionTop[],
  line: number,
  atBottom: boolean,
): string | null {
  if (sections.length === 0) return null;
  if (atBottom) return sections[sections.length - 1].id;
  let active = sections[0].id;
  for (const s of sections) {
    if (s.top <= line) active = s.id;
    else break;
  }
  return active;
}
