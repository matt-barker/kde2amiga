import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import JSZip from 'jszip';
import { IconGallery, CARD_WIDTH_PX, ROW_HEIGHT } from './IconGallery';
import { triggerResizeObservers } from '../test/installResizeObserver';
import type { IconGroup } from '../lib/theme/themeParser';

function groups(): IconGroup[] {
  return [
    {
      // The real `folder-wine` shape: places/ owns the deeper ladder but tops out at a
      // simplified 22px glyph, while apps/ has a single detailed 48px drawing. The
      // gallery's size floor should land on apps/48.
      name: 'folder-wine',
      variants: [
        { name: 'folder-wine', category: 'apps', sizePx: 48, format: 'svg', zipPath: 'a/apps/48/folder-wine.svg' },
        { name: 'folder-wine', category: 'places', sizePx: 22, format: 'svg', zipPath: 'a/places/22/folder-wine.svg' },
        { name: 'folder-wine', category: 'places', sizePx: 16, format: 'svg', zipPath: 'a/places/16/folder-wine.svg' },
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

/**
 * jsdom lays nothing out, so every element reports a width of 0 and the gallery would
 * fall back to a single column. Pinning `clientWidth` on the scroll container lets a
 * test choose the column count the component will derive.
 */
function withContainerWidth(container: HTMLElement, width: number): HTMLElement {
  const scroller = container.querySelector<HTMLElement>('[data-testid="gallery-scroll"]')!;
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: width });
  return scroller;
}

function cardFor(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.icon-tile__name' }).closest('.gallery__card')!;
}

afterEach(cleanup);

describe('IconGallery', () => {
  it('shows one card per icon set rather than one per variant', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    // Three variants of folder-wine plus one of network, but two sets — so two cards.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(cardFor('folder-wine')).toBeInTheDocument();
    expect(cardFor('network')).toBeInTheDocument();
  });

  it('shows the best variant of a set, applying the size floor', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    // places/ has the deeper ladder, but its best is a 22px glyph and a 48px drawing
    // exists — so the detailed one is what the user is offered by default.
    expect(within(cardFor('folder-wine')).getByText('apps 48')).toBeInTheDocument();
    expect(within(cardFor('folder-wine')).queryByText('places 22')).not.toBeInTheDocument();
  });

  it('puts the icon name underneath the preview, not beside it', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    const card = cardFor('folder-wine');
    const tile = card.querySelector('.icon-tile')!;
    const children = Array.from(tile.children).map((el) => el.className);

    // Preview swatch first, then the name, then the category/size caption. This is the
    // whole point of the layout change: reading order down the card, not across it.
    // The checkbox leads in the DOM (it labels the whole tile) and is placed over the
    // swatch's corner by CSS, so it does not sit between the preview and its caption.
    expect(children).toEqual([
      'icon-tile__check',
      'icon-tile__swatch',
      'icon-tile__name',
      'icon-tile__meta',
    ]);
  });

  it('offers a variant picker only for sets with more than one variant', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    expect(within(cardFor('folder-wine')).getByRole('button', { name: '3 variants' })).toBeInTheDocument();
    expect(within(cardFor('network')).queryByRole('button', { name: /variant/ })).not.toBeInTheDocument();
  });

  it('lists every variant of a set when the picker is opened', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    fireEvent.click(within(cardFor('folder-wine')).getByRole('button', { name: '3 variants' }));

    const dialog = screen.getByRole('dialog', { name: /folder-wine/ });
    expect(within(dialog).getByText('apps 48')).toBeInTheDocument();
    expect(within(dialog).getByText('places 22')).toBeInTheDocument();
    expect(within(dialog).getByText('places 16')).toBeInTheDocument();
  });

  it('selects a non-default variant chosen from the picker', () => {
    const gs = groups();
    const onSelectionChange = vi.fn();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={onSelectionChange} />);

    fireEvent.click(within(cardFor('folder-wine')).getByRole('button', { name: '3 variants' }));
    const dialog = screen.getByRole('dialog', { name: /folder-wine/ });
    fireEvent.click(within(dialog).getByText('places 22').closest('label')!.querySelector('input')!);

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['a/places/22/folder-wine.svg']));
  });

  it('shows the picked variant on the card once it is selected', () => {
    const gs = groups();
    render(
      <IconGallery
        zip={zipFor(gs)}
        groups={gs}
        selected={new Set(['a/places/22/folder-wine.svg'])}
        onSelectionChange={() => {}}
      />,
    );

    // Overriding the default has to be visible on the grid itself, otherwise the card
    // would keep advertising apps/48 while places/22 is what conversion would use.
    expect(within(cardFor('folder-wine')).getByText('places 22')).toBeInTheDocument();
    expect(within(cardFor('folder-wine')).getByRole('checkbox')).toBeChecked();
  });

  it('closes the picker', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    fireEvent.click(within(cardFor('folder-wine')).getByRole('button', { name: '3 variants' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects the card itself by its shown variant', () => {
    const gs = groups();
    const onSelectionChange = vi.fn();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={onSelectionChange} />);

    fireEvent.click(within(cardFor('folder-wine')).getByRole('checkbox'));

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['a/apps/48/folder-wine.svg']));
  });

  it('filters sets by name as you search', () => {
    const gs = groups();
    render(<IconGallery zip={zipFor(gs)} groups={gs} selected={new Set()} onSelectionChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'network' } });

    expect(cardFor('network')).toBeInTheDocument();
    expect(screen.queryByText('folder-wine', { selector: '.icon-tile__name' })).not.toBeInTheDocument();
  });

  it('derives its grid column count from the container width', () => {
    const many: IconGroup[] = Array.from({ length: 40 }, (_, i) => ({
      name: `icon-${i}`,
      variants: [
        { name: `icon-${i}`, category: 'apps', sizePx: 48, format: 'svg', zipPath: `a/apps/48/icon-${i}.svg` },
      ],
    }));

    const { container } = render(
      <IconGallery zip={zipFor([])} groups={many} selected={new Set()} onSelectionChange={() => {}} />,
    );
    withContainerWidth(container, CARD_WIDTH_PX * 6);
    act(() => triggerResizeObservers());

    const row = container.querySelector<HTMLElement>('.gallery__row')!;
    expect(row).toHaveStyle({ gridTemplateColumns: `repeat(6, 1fr)` });
  });

  it('mounts only the visible window of a large theme', () => {
    const many: IconGroup[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `icon-${i}`,
      variants: [
        { name: `icon-${i}`, category: 'apps', sizePx: 48, format: 'svg', zipPath: `a/apps/48/icon-${i}.svg` },
      ],
    }));

    render(<IconGallery zip={zipFor(many.slice(0, 1))} groups={many} selected={new Set()} onSelectionChange={() => {}} />);

    // Virtualized, and the bound is the exact window rather than a loose ceiling: a
    // loose "< 200" would sit quietly through a regression that mounted an order of
    // magnitude too much. jsdom reports a width of 0, so the column count falls back
    // to 1 and the window is ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2 rows of
    // one card each.
    const visibleRows = Math.ceil(600 / ROW_HEIGHT) + 2 * 2;
    expect(screen.getAllByRole('checkbox')).toHaveLength(visibleRows);
  });

  it('keeps showing filtered results after scrolling deep into the unfiltered list', () => {
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

    const scroller = container.querySelector<HTMLElement>('[data-testid="gallery-scroll"]')!;
    fireEvent.scroll(scroller, { target: { scrollTop: 3000 * ROW_HEIGHT } });

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'special' } });

    // Without clamping the window's start row to the filtered list's length, the window
    // would still point at row ~2996 of a 1-row list and render nothing.
    expect(cardFor('special-target')).toBeInTheDocument();
  });
});
