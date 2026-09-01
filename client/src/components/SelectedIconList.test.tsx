import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SelectedIconList } from './SelectedIconList';
import type { IconAssignment } from '../lib/theme/assignment';
import type { IconVariant } from '../lib/theme/themeParser';
import type { IconPreview } from '../lib/pipeline/preview';

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

  it('draws the normal and selected previews on a Workbench-grey ground', () => {
    const preview: IconPreview = {
      zipPath: folder.zipPath,
      width: 2,
      height: 2,
      normal: new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2),
      selected: new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2),
    };
    const assignments = new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]]);

    render(
      <SelectedIconList
        variants={[folder]}
        assignments={assignments}
        onAssignmentChange={() => {}}
        previews={new Map([[folder.zipPath, preview]])}
      />,
    );

    expect(screen.getByLabelText(/normal state for folder/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/selected state for folder/i)).toBeInTheDocument();
  });
});
