import { describe, it, expect, vi, afterEach } from 'vitest';
// fireEvent rather than user-event: the latter is not a dependency here, and every
// other component test in this codebase drives selects the same way.
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { SelectedIconList } from './SelectedIconList';
import { WORKBENCH_GREY } from './IconTile';
import type { IconAssignment } from '../lib/theme/assignment';
import type { IconVariant } from '../lib/theme/themeParser';
import type { IconPreview } from '../lib/pipeline/preview';
import { DEFAULT_ICON_SLOTS } from '../lib/output/defaultIconSlots';

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
      <SelectedIconList variants={[folder, readme]} assignments={assignments} onAssignmentChange={() => {}} onRemove={() => {}} />,
    );

    expect(screen.getByLabelText(/type for folder/i)).toHaveValue('drawer');
    expect(screen.getByLabelText(/type for text-x-generic/i)).toHaveValue('project');
  });

  it('reports a changed kind', () => {
    const onAssignmentChange = vi.fn();
    const assignments = new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]]);
    render(
      <SelectedIconList variants={[folder]} assignments={assignments} onAssignmentChange={onAssignmentChange} onRemove={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText(/type for folder/i), { target: { value: 'trashcan' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'trashcan' });
  });

  const slotSelect = (name: string) => screen.getByLabelText(new RegExp(`default slot for ${name}`, 'i'));

  it('leaves an untagged icon claiming no slot', () => {
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={() => {}} onRemove={() => {}}
      />,
    );
    expect(slotSelect('folder')).toHaveValue('');
  });

  it('reports a default-icon role when a slot is picked', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );

    fireEvent.change(slotSelect('folder'), { target: { value: 'drawer' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'drawer', role: 'drawer' });
  });

  /**
   * Every destination now stamps its own type byte, so choosing a slot never touches
   * `kind` — the cross-forcing this used to require (a type-fallback slot had to agree
   * with the type byte, because icon.library finds it *by* that byte) is gone: each
   * destination writes a copy typed and named for itself.
   */
  it('leaves the icon kind alone when a slot is picked', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[readme]}
        assignments={new Map<string, IconAssignment>([[readme.zipPath, { kind: 'project' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );

    fireEvent.change(slotSelect('text-x-generic'), { target: { value: 'trashcan' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(readme.zipPath, { kind: 'project', role: 'trashcan' });
  });

  it('clears the role, but not the kind, when the slot is set back to none', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer', role: 'drawer' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );

    fireEvent.change(slotSelect('folder'), { target: { value: '' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'drawer', role: undefined });
  });

  /**
   * The retargeting this replaced moved a type-fallback slot along with the type byte,
   * because the two used to have to agree. Now each destination is typed for itself, so
   * retyping an icon leaves whatever slot it claims exactly where it was.
   */
  it('leaves the slot alone when the type changes', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer', role: 'drawer' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/type for folder/i), { target: { value: 'disk' } });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, { kind: 'disk', role: 'drawer' });
  });

  it('offers every slot in the catalogue, named for the file it writes', () => {
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={() => {}} onRemove={() => {}}
      />,
    );

    for (const slot of DEFAULT_ICON_SLOTS) {
      expect(slotSelect('folder')).toContainHTML(`value="${slot.role}"`);
    }
    // The cryptic ones are unreadable without a gloss: def_i and def_h name nothing.
    expect(screen.getByRole('option', { name: /def_h\b.*header/i })).toBeInTheDocument();
  });

  /**
   * Thirty-three options in one flat list buries the five slots most users want behind
   * two dozen file types they will never tag.
   */
  it('separates the type fallbacks from the DefIcons file types', () => {
    const { container } = render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={() => {}} onRemove={() => {}}
      />,
    );

    const groups = [...container.querySelectorAll('optgroup')].map((g) => g.label);
    // Two slot groups plus the five Workbench-icon drawer groups now share the row.
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.join(' ')).toMatch(/file type/i);
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
        onAssignmentChange={() => {}} onRemove={() => {}}
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

describe('removing a row', () => {
  it('offers a remove button naming the icon it drops', () => {
    render(
      <SelectedIconList
        variants={[folder, readme]}
        assignments={new Map()}
        onAssignmentChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /remove folder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove text-x-generic/i })).toBeInTheDocument();
  });

  it('reports the zip path of the row whose button was pressed', () => {
    // The zipPath, not the name: two rows can share a name across categories, and the
    // selection App holds is keyed by path.
    const onRemove = vi.fn();
    render(
      <SelectedIconList
        variants={[folder, readme]}
        assignments={new Map()}
        onAssignmentChange={() => {}}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove text-x-generic/i }));
    expect(onRemove).toHaveBeenCalledWith(readme.zipPath);
  });
});

describe('the Workbench icon column', () => {
  it('offers every target, grouped by the drawer it lives in', () => {
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={() => {}} onRemove={() => {}}
      />,
    );
    const select = screen.getByLabelText(`Workbench icon for ${folder.name}`);

    expect(select).toHaveValue('');
    expect(within(select).getByRole('group', { name: 'SYS:Prefs' })).toBeInTheDocument();
  });

  it('reports the chosen target as a path', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'drawer' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(`Workbench icon for ${folder.name}`), {
      target: { value: 'SYS:Prefs/Font' },
    });

    expect(onAssignmentChange).toHaveBeenCalledWith(folder.zipPath, {
      kind: 'drawer',
      target: 'SYS:Prefs/Font',
    });
  });

  /**
   * The Type dropdown governs the standalone icon only — each destination stamps its own
   * type byte now. Choosing a target must therefore leave `kind` exactly as it was; the
   * cross-forcing this replaced is what made that impossible when an icon filled two
   * destinations wanting different types.
   */
  it('leaves the icon type alone when a target is chosen', () => {
    const onAssignmentChange = vi.fn();
    render(
      <SelectedIconList
        variants={[folder]}
        assignments={new Map<string, IconAssignment>([[folder.zipPath, { kind: 'project' }]])}
        onAssignmentChange={onAssignmentChange} onRemove={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(`Workbench icon for ${folder.name}`), {
      target: { value: 'SYS:System/Shell' },
    });

    expect(onAssignmentChange.mock.calls[0][1].kind).toBe('project');
  });
});
