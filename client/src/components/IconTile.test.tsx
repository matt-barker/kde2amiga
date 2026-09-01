import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import JSZip from 'jszip';
import { IconTile, WORKBENCH_GREY } from './IconTile';
import type { IconVariant } from '../lib/theme/themeParser';

const variant: IconVariant = {
  name: 'folder',
  category: 'places',
  sizePx: 32,
  format: 'svg',
  zipPath: 't/places/32/folder.svg',
};

const otherVariant: IconVariant = {
  name: 'folder-open',
  category: 'places',
  sizePx: 32,
  format: 'svg',
  zipPath: 't/places/32/folder-open.svg',
};

function zipWithIcon(): JSZip {
  const zip = new JSZip();
  zip.file(variant.zipPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>');
  zip.file(otherVariant.zipPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>');
  return zip;
}

afterEach(cleanup);

describe('IconTile', () => {
  it('renders the icon on a Workbench-grey ground, labelled by category and size', async () => {
    render(<IconTile zip={zipWithIcon()} variant={variant} checked={false} onToggle={() => {}} />);

    const img = await screen.findByRole('img', { name: /folder/i });
    expect(img).toBeInTheDocument();
    // The grey ground is what makes a near-white symbolic glyph visibly wrong.
    expect(img.parentElement).toHaveStyle({ backgroundColor: WORKBENCH_GREY });
    expect(screen.getByText('places 32')).toBeInTheDocument();
  });

  it('revokes its object URL on unmount so 272k icons never accumulate', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = render(
      <IconTile zip={zipWithIcon()} variant={variant} checked={false} onToggle={() => {}} />,
    );
    await screen.findByRole('img', { name: /folder/i });

    unmount();

    await waitFor(() => expect(revoke).toHaveBeenCalled());
  });

  it('revokes the previous object URL when the variant changes, not only on unmount', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const zip = zipWithIcon();

    const { rerender } = render(
      <IconTile zip={zip} variant={variant} checked={false} onToggle={() => {}} />,
    );
    await screen.findByRole('img', { name: /folder/i });
    expect(createSpy).toHaveBeenCalledTimes(1);
    const firstUrl = createSpy.mock.results[0].value as string;

    rerender(<IconTile zip={zip} variant={otherVariant} checked={false} onToggle={() => {}} />);
    await screen.findByRole('img', { name: /folder-open/i });

    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
  });

  it('reports its zipPath when toggled', async () => {
    const onToggle = vi.fn();
    render(<IconTile zip={zipWithIcon()} variant={variant} checked={false} onToggle={onToggle} />);

    (await screen.findByRole('checkbox')).click();

    expect(onToggle).toHaveBeenCalledWith('t/places/32/folder.svg');
  });

  it('shows a visible failed state when the zip has no entry at the variant path', async () => {
    const emptyZip = new JSZip();

    render(<IconTile zip={emptyZip} variant={variant} checked={false} onToggle={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/folder failed to load/i);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a visible failed state when the zip entry fails to decompress, without an unhandled rejection', async () => {
    // A minimal stand-in for JSZip: only the shape IconTile actually calls
    // (`zip.file(path)?.async('blob')`) needs to exist, and here it rejects to
    // simulate a corrupted entry.
    const brokenZip = {
      file: () => ({ async: () => Promise.reject(new Error('corrupt entry')) }),
    } as unknown as JSZip;

    render(<IconTile zip={brokenZip} variant={variant} checked={false} onToggle={() => {}} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/folder failed to load/i);
  });

  it('shows a visible failed state when the loaded bytes fail to render as an image', async () => {
    render(<IconTile zip={zipWithIcon()} variant={variant} checked={false} onToggle={() => {}} />);

    const img = await screen.findByRole('img', { name: /folder/i });
    fireEvent.error(img);

    expect(await screen.findByRole('alert')).toHaveTextContent(/folder failed to load/i);
  });
});
