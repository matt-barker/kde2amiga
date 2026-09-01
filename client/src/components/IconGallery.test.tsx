import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconGallery } from './IconGallery';
import type { IconVariant } from '../lib/theme/themeParser';

const icons: IconVariant[] = [
  { name: 'folder', category: 'places', sizePx: 0, format: 'svg', zipPath: 'scalable/places/folder.svg' },
  { name: 'firefox', category: 'apps', sizePx: 0, format: 'svg', zipPath: 'scalable/apps/firefox.svg' },
];

describe('IconGallery', () => {
  it('renders one checkbox per icon, labeled with name and category', () => {
    render(<IconGallery icons={icons} selected={new Set()} onSelectionChange={vi.fn()} />);
    expect(screen.getByLabelText(/folder \(places\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/firefox \(apps\)/i)).toBeInTheDocument();
  });

  it('calls onSelectionChange with the toggled icon added to the selection', () => {
    const onSelectionChange = vi.fn();
    render(<IconGallery icons={icons} selected={new Set()} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['scalable/places/folder.svg']));
  });

  it('calls onSelectionChange with the icon removed when unchecking an already-selected icon', () => {
    const onSelectionChange = vi.fn();
    render(
      <IconGallery
        icons={icons}
        selected={new Set(['scalable/places/folder.svg'])}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/folder \(places\)/i));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });
});
