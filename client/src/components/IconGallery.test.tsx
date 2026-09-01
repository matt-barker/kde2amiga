import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import JSZip from 'jszip';
import { IconGallery } from './IconGallery';
import type { IconGroup } from '../lib/theme/themeParser';

function groups(): IconGroup[] {
  return [
    {
      name: 'folder-wine',
      variants: [
        { name: 'folder-wine', category: 'apps', sizePx: 48, format: 'svg', zipPath: 'a/apps/48/folder-wine.svg' },
        { name: 'folder-wine', category: 'places', sizePx: 22, format: 'svg', zipPath: 'a/places/22/folder-wine.svg' },
      ],
    },
    {
      name: 'network',
      variants: [
        { name: 'network', category: 'apps', sizePx: 48, format: 'svg', zipPath: 'a/apps/48/network.svg' },
      ],
    },
  ];
}

function zipFor(gs: IconGroup[]): JSZip {
  const zip = new JSZip();
  for (const g of gs) for (const v of g.variants) zip.file(v.zipPath, '<svg/>');
  return zip;
}

afterEach(cleanup);

describe('IconGallery', () => {
  it('shows every variant of a name together on one row', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    expect(screen.getByText('folder-wine')).toBeInTheDocument();
    // Both variants of the name are offered side by side, so the colour one is choosable.
    // Scoped to the folder-wine row: the fixture's `network` group also has an
    // "apps 48" variant, and both groups mount (the viewport window comfortably
    // fits both), so an unscoped query would be ambiguous.
    const row = screen.getByText('folder-wine').closest('div')!;
    expect(within(row).getByText('apps 48')).toBeInTheDocument();
    expect(within(row).getByText('places 22')).toBeInTheDocument();
  });

  it('filters groups by name as you search', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'network' } });

    expect(screen.getByText('network')).toBeInTheDocument();
    expect(screen.queryByText('folder-wine')).not.toBeInTheDocument();
  });

  it('selects an individual variant by zipPath', () => {
    const gs = groups();
    const onSelectionChange = vi.fn();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['a/apps/48/folder-wine.svg']));
  });

  it('mounts only the visible window of a large theme', () => {
    const many: IconGroup[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `icon-${i}`,
      variants: [
        { name: `icon-${i}`, category: 'apps', sizePx: 48, format: 'svg', zipPath: `a/apps/48/icon-${i}.svg` },
      ],
    }));

    render(<IconGallery zip={zipFor(many.slice(0, 1))} groups={many} selected={new Set()} onSelectionChange={() => {}} />);

    // Virtualized: far fewer rows in the DOM than groups in the theme.
    expect(screen.getAllByRole('checkbox').length).toBeLessThan(200);
  });

  it('keeps showing filtered results after scrolling deep into the unfiltered list', () => {
    // 5000 generic groups, plus one distinctively-named group at the end that a
    // search can isolate down to a single match.
    const many: IconGroup[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `icon-${i}`,
      variants: [
        { name: `icon-${i}`, category: 'apps', sizePx: 48, format: 'svg', zipPath: `a/apps/48/icon-${i}.svg` },
      ],
    }));
    many.push({
      name: 'special-target',
      variants: [
        { name: 'special-target', category: 'apps', sizePx: 48, format: 'svg', zipPath: 'a/apps/48/special-target.svg' },
      ],
    });

    const { container } = render(
      <IconGallery zip={zipFor([])} groups={many} selected={new Set()} onSelectionChange={() => {}} />,
    );

    // Scroll well past the top of the unfiltered 5001-row list (row height 96px,
    // matching IconGallery's ROW_HEIGHT constant), so the window's start index sits
    // deep in the list before the search below shrinks `matches` out from under it.
    const scrollContainer = container.querySelector<HTMLElement>('div[style*="overflow-y"]');
    expect(scrollContainer).not.toBeNull();
    fireEvent.scroll(scrollContainer!, { target: { scrollTop: 3000 * 96 } });

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'special' } });

    // Without clamping the window's start index to the filtered list's length, the
    // window would still point at index ~2996 of a 1-item `matches` array and render
    // nothing here, even though the filtered result exists.
    expect(screen.getByText('special-target')).toBeInTheDocument();
  });
});
