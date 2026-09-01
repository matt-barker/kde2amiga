import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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

function zipWithIcon(): JSZip {
  const zip = new JSZip();
  zip.file(variant.zipPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"/>');
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

  it('reports its zipPath when toggled', async () => {
    const onToggle = vi.fn();
    render(<IconTile zip={zipWithIcon()} variant={variant} checked={false} onToggle={onToggle} />);

    (await screen.findByRole('checkbox')).click();

    expect(onToggle).toHaveBeenCalledWith('t/places/32/folder.svg');
  });
});
