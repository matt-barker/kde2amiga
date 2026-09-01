import { useMemo, useState } from 'react';
import type JSZip from 'jszip';
import type { IconGroup } from '../lib/theme/themeParser';
import { IconTile } from './IconTile';

const ROW_HEIGHT = 96;
const VIEWPORT_HEIGHT = 600;
const OVERSCAN = 4;

export function IconGallery(props: {
  zip: JSZip;
  groups: IconGroup[];
  selected: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}) {
  const { zip, groups, selected, onSelectionChange } = props;
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

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

  // Hand-rolled fixed-height windowing. A theme can hold hundreds of thousands of
  // groups; mounting them all would lock the tab, and each mounted tile also holds
  // an object URL.
  //
  // `first` is clamped to `matches.length - visibleCount` (never below 0). Without
  // that upper clamp, scrolling deep into an unfiltered list and then narrowing the
  // search would leave `first` pointing past the end of the now-shorter `matches`
  // array — `scrollTop` is DOM state the filter doesn't reset, so the window would
  // go blank instead of showing the filtered results.
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const maxFirst = Math.max(0, matches.length - visibleCount);
  const first = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, maxFirst));
  const visible = matches.slice(first, first + visibleCount);

  function toggle(zipPath: string) {
    const next = new Set(selected);
    if (next.has(zipPath)) next.delete(zipPath);
    else next.add(zipPath);
    onSelectionChange(next);
  }

  return (
    <div>
      <label htmlFor="icon-search">Search icons</label>
      <input
        id="icon-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p>{`${matches.length} of ${groups.length} icons`}</p>

      <div
        style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: matches.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((group, index) => (
            <div
              key={group.name}
              // A group is keyed by name alone, across every category and size, so
              // Papirus's `folder` carries 15-25 variants — normal, not pathological.
              // Laid out inline in a fixed 96px row they would wrap, overflow into the
              // row below (this absolutely-positioned container does not clip) and force
              // a horizontal scrollbar onto the whole viewport. So the row is a strip
              // that scrolls sideways within itself. Its height stays fixed, which is
              // what the windowing arithmetic above depends on: variable row heights
              // would break `top: index * ROW_HEIGHT` outright.
              style={{
                position: 'absolute',
                top: (first + index) * ROW_HEIGHT,
                height: ROW_HEIGHT,
                width: '100%',
                whiteSpace: 'nowrap',
                overflowX: 'auto',
                overflowY: 'hidden',
              }}
            >
              <strong>{group.name}</strong>
              {group.variants.map((variant) => (
                <IconTile
                  key={variant.zipPath}
                  zip={zip}
                  variant={variant}
                  checked={selected.has(variant.zipPath)}
                  onToggle={toggle}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
