import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SelectedIconList } from './SelectedIconList';
import { WORKBENCH_GREY } from './IconTile';
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

    // The label names the slot the icon fills, not the icon — but the accessible name
    // still carries the icon's name, so two drawer rows stay tellable apart.
    fireEvent.click(screen.getByLabelText(/use folder as the system default drawer icon/i));

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'drawer', role: 'drawer' });
  });

  it('labels the default-slot checkbox with the file it writes, not the icon name', () => {
    const assignments = new Map<string, IconAssignment>([
      [folder.zipPath, { kind: 'drawer' }],
      [readme.zipPath, { kind: 'project' }],
    ]);
    render(
      <SelectedIconList variants={[folder, readme]} assignments={assignments} onAssignmentChange={() => {}} />,
    );

    // There are five system-default slots and one icon fills each, so the label has to
    // name the slot. "Use as system default for folder-music" named the icon, which
    // told the user nothing about what ticking it would do.
    expect(screen.getByText('def_drawer')).toBeInTheDocument();
    expect(screen.getByText('def_project')).toBeInTheDocument();
  });

  it('moves the slot label when the type changes', () => {
    const assignments = new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]]);
    const { rerender } = render(
      <SelectedIconList variants={[folder]} assignments={assignments} onAssignmentChange={() => {}} />,
    );
    expect(screen.getByText('def_drawer')).toBeInTheDocument();

    rerender(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'disk', role: 'disk' }]])}
        onAssignmentChange={() => {}}
      />,
    );

    // The slot is derived from the type rather than stored separately, so retyping an
    // icon as a disk must retarget its default slot too — otherwise a ticked row would
    // keep claiming def_drawer while writing a disk icon into it.
    expect(screen.getByText('def_disk')).toBeInTheDocument();
    expect(screen.queryByText('def_drawer')).not.toBeInTheDocument();
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

    const normal = screen.getByLabelText(/normal state for folder/i);
    const selected = screen.getByLabelText(/selected state for folder/i);
    expect(normal).toBeInTheDocument();
    expect(selected).toBeInTheDocument();

    // The ground is one continuous field behind both canvases, not a tile on each.
    // Converted icons carry edges baked against the Workbench grey, so they only read
    // correctly on it — but per-canvas tiles put a visible boundary around every icon,
    // which is exactly what the Workbench itself does not have. On hardware the grey
    // is continuous and those boundaries vanish.
    expect(normal).not.toHaveStyle({ backgroundColor: WORKBENCH_GREY });
    expect(normal.parentElement).toHaveStyle({ backgroundColor: WORKBENCH_GREY });
    expect(normal.parentElement).toBe(selected.parentElement);
  });

  it('grounds previews on the same grey the conversion bakes edges against', () => {
    // JobConfig's backgroundColor default is [0xab, 0xab, 0xab]; a preview drawn on a
    // different grey shows a fringe the Amiga will not.
    expect(WORKBENCH_GREY.toLowerCase()).toBe('#ababab');
  });
});
