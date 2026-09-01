import { useEffect, useMemo, useRef, useState } from 'react';
import type JSZip from 'jszip';
import { pickBestVariant, type IconGroup } from '../lib/theme/themeParser';
import { IconTile } from './IconTile';
import './IconGallery.css';

/**
 * Card footprint, and the unit the column count is derived from. Wide enough for the
 * 48px preview plus the longest category/size caption ("preferences scalable") without
 * the caption wrapping into a second line and pushing the card past ROW_HEIGHT.
 */
export const CARD_WIDTH_PX = 132;

/** Fixed, and the windowing arithmetic below depends on it staying fixed. */
export const ROW_HEIGHT = 152;

const VIEWPORT_HEIGHT = 600;
const OVERSCAN = 2;

export function IconGallery(props: {
  zip: JSZip;
  groups: IconGroup[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}) {
  const { zip, groups, selected, onSelectionChange } = props;
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [columns, setColumns] = useState(1);
  const [openName, setOpenName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Undebounced on purpose, and a deliberate deviation from spec §3's "debounced
  // substring match": the filter is a single linear pass over `matches` with no I/O, no
  // decode and no allocation per group beyond the result array, and the spec itself
  // sanctions a linear filter per keystroke. Debouncing would add a moving part and a
  // visible lag to a keystroke that is already cheap. Revisit only if profiling on a
  // 272k-variant theme says otherwise.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => group.name.toLowerCase().includes(needle));
  }, [groups, query]);

  // One pass over the whole theme per load, not per render: `pickBestVariant` is
  // O(variants in the group), so this is O(all variants) once — around 13k for a real
  // KDE theme — rather than that much work on every keystroke and every scroll tick.
  const bestByName = useMemo(() => {
    const map = new Map<string, ReturnType<typeof pickBestVariant>>();
    for (const group of groups) map.set(group.name, pickBestVariant(group));
    return map;
  }, [groups]);

  // Recomputed on width change rather than read during render: `clientWidth` is layout
  // state, and reading it in render would tear on the first paint.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () =>
      setColumns(Math.max(1, Math.floor(element.clientWidth / CARD_WIDTH_PX)));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Hand-rolled fixed-height windowing. A theme can hold hundreds of thousands of
  // groups; mounting them all would lock the tab, and each mounted tile also holds
  // an object URL.
  //
  // `firstRow` is clamped to `rowCount - visibleRows` (never below 0). Without that
  // upper clamp, scrolling deep into an unfiltered list and then narrowing the search
  // would leave `firstRow` pointing past the end of the now-shorter list — `scrollTop`
  // is DOM state the filter doesn't reset, so the window would go blank instead of
  // showing the filtered results.
  const rowCount = Math.ceil(matches.length / columns);
  const visibleRows = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const maxFirstRow = Math.max(0, rowCount - visibleRows);
  const firstRow = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, maxFirstRow));
  const lastRow = Math.min(rowCount, firstRow + visibleRows);

  const rows = [];
  for (let row = firstRow; row < lastRow; row++) {
    rows.push({ row, groups: matches.slice(row * columns, row * columns + columns) });
  }

  const openGroup = useMemo(
    () => (openName === null ? null : (groups.find((g) => g.name === openName) ?? null)),
    [groups, openName],
  );

  // Escape closes the picker. Bound on the document rather than the dialog so it works
  // without the overlay having taken focus first.
  useEffect(() => {
    if (openName === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenName(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openName]);

  function toggle(zipPath: string) {
    const next = new Set(selected);
    if (next.has(zipPath)) next.delete(zipPath);
    else next.add(zipPath);
    onSelectionChange(next);
  }

  return (
    <div className="gallery">
      <div className="gallery__search">
        <label htmlFor="icon-search">Search icons</label>
        <input
          id="icon-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p>{`${matches.length} of ${groups.length} icons`}</p>
      </div>

      <div
        ref={scrollRef}
        data-testid="gallery-scroll"
        className="gallery__scroll"
        style={{ height: VIEWPORT_HEIGHT }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: rowCount * ROW_HEIGHT, position: 'relative' }}>
          {rows.map(({ row, groups: rowGroups }) => (
            // Rows stay a fixed ROW_HEIGHT tall, which is what `top: row * ROW_HEIGHT`
            // depends on. That is also why choosing a different variant opens a panel
            // rather than expanding the card in place: a variable-height row would
            // break this arithmetic outright.
            <div
              key={row}
              className="gallery__row"
              style={{
                top: row * ROW_HEIGHT,
                height: ROW_HEIGHT,
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
              }}
            >
              {rowGroups.map((group) => {
                // A set shows whichever of its variants is currently selected, falling
                // back to the computed best. Without this the card would keep
                // advertising the default after the user picked something else from
                // the panel, while conversion used the override.
                const shown =
                  group.variants.find((variant) => selected.has(variant.zipPath)) ??
                  bestByName.get(group.name) ??
                  group.variants[0];

                return (
                  <div key={group.name} className="gallery__card">
                    <IconTile
                      zip={zip}
                      variant={shown}
                      checked={selected.has(shown.zipPath)}
                      onToggle={toggle}
                      showName
                    />
                    {group.variants.length > 1 && (
                      <button
                        type="button"
                        className="gallery__variants"
                        onClick={() => setOpenName(group.name)}
                      >
                        {`${group.variants.length} variants`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {openGroup && (
        // A centred overlay rather than a panel below the grid. The scroll container is
        // 600px tall, so a panel after it opened off the bottom of the window: clicking
        // "7 variants" looked like it did nothing at all.
        <div
          className="gallery__backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpenName(null);
          }}
        >
          <div className="gallery__picker" role="dialog" aria-label={`Variants of ${openGroup.name}`}>
            <div className="gallery__picker-head">
              <strong>{openGroup.name}</strong>
              <button type="button" onClick={() => setOpenName(null)}>
                Close
              </button>
            </div>
            <div className="gallery__picker-grid">
              {openGroup.variants.map((variant) => (
                <IconTile
                  key={variant.zipPath}
                  zip={zip}
                  variant={variant}
                  checked={selected.has(variant.zipPath)}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
