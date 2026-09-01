import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SelectedIconList, type IconAssignment } from './SelectedIconList';
import type { IconVariant } from '../lib/theme/themeParser';

const folder: IconVariant = {
  name: 'folder', category: 'places', sizePx: 32, format: 'svg', zipPath: 'a/places/32/folder.svg',
};
const readme: IconVariant = {
  name: 'text-x-generic', category: 'mimetypes', sizePx: 32, format: 'svg', zipPath: 'a/mimetypes/32/text-x-generic.svg',
};

afterEach(cleanup);

describe('SelectedIconList', () => {
  it('shows the inferred kind for each selected icon', () => {
    const assignments = new Map<string, IconAssignment>([
      [folder.zipPath, { kind: 'drawer' }],
      [readme.zipPath, { kind: 'project' }],
    ]);
    render(
      <SelectedIconList variants={[folder, readme]} assignments={assignments} onAssignmentChange={() => {}} />,
    );

    expect(screen.getByLabelText(/type for folder/i)).toHaveValue('drawer');
    expect(screen.getByLabelText(/type for text-x-generic/i)).toHaveValue('project');
  });

  it('reports a changed kind', () => {
    const onAssignmentChange = vi.fn();
    const assignments = new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]]);
    render(
      <SelectedIconList variants={[folder]} assignments={assignments} onAssignmentChange={onAssignmentChange} />,
    );

    fireEvent.change(screen.getByLabelText(/type for folder/i), { target: { value: 'trashcan' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'trashcan' });
  });

  it('reports a default-icon role when tagged', () => {
    const onAssignmentChange = vi.fn();
    const assignments = new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]]);
    render(
      <SelectedIconList variants={[folder]} assignments={assignments} onAssignmentChange={onAssignmentChange} />,
    );

    fireEvent.click(screen.getByLabelText(/system default for folder/i));

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'drawer', role: 'drawer' });
  });
});
