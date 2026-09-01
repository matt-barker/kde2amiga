import { useEffect, useRef } from 'react';
import type { IconVariant } from '../lib/theme/themeParser';
import type { IconKind } from '../lib/newicons/diskObject';
import type { DefaultIconRole } from '../lib/output/zipBuilder';
import { defaultAssignment, type IconAssignment } from '../lib/theme/assignment';
import type { IconPreview } from '../lib/pipeline/preview';
import { WORKBENCH_GREY } from './IconTile';
import './SelectedIconList.css';

const KINDS: IconKind[] = ['drawer', 'project', 'tool', 'disk', 'trashcan'];

/** The five kinds that are also legal ENVARC:Sys/def_*.info slots. */
const ROLE_FOR_KIND: Record<IconKind, DefaultIconRole> = {
  drawer: 'drawer',
  project: 'project',
  tool: 'tool',
  disk: 'disk',
  trashcan: 'trashcan',
};

function PreviewCanvas(props: { image: ImageData; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, props.image.width, props.image.height);
    context.putImageData(props.image, 0, 0);
  }, [props.image]);

  return (
    <canvas
      ref={ref}
      width={props.image.width}
      height={props.image.height}
      aria-label={props.label}
      role="img"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export function SelectedIconList(props: {
  variants: IconVariant[];
  assignments: Map<string, IconAssignment>;
  onAssignmentChange: (zipPath: string, assignment: IconAssignment) => void;
  previews?: Map<string, IconPreview>;
}) {
  const { variants, assignments, onAssignmentChange, previews } = props;

  if (variants.length === 0) return null;

  return (
    <section className="selected">
      <h2 className="selected__heading">{`Selected icons (${variants.length})`}</h2>

      <table className="selected__table">
        <thead>
          <tr>
            <th scope="col">Preview</th>
            <th scope="col">Icon</th>
            <th scope="col">Type</th>
            <th scope="col">System default</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => {
            const assignment = assignments.get(variant.zipPath) ?? defaultAssignment(variant);
            const kindId = `kind-${variant.zipPath}`;
            const roleId = `role-${variant.zipPath}`;
            const preview = previews?.get(variant.zipPath);
            const role = ROLE_FOR_KIND[assignment.kind];

            return (
              <tr key={variant.zipPath}>
                <td className="selected__previews">
                  {/*
                    * The grey is set here rather than in the stylesheet because it is a
                    * conversion value, not a styling choice: soft edges are baked against
                    * it, so it has to track JobConfig's backgroundColor default.
                    */}
                  <div style={preview ? { backgroundColor: WORKBENCH_GREY } : undefined}>
                    {preview ? (
                      <>
                        <PreviewCanvas image={preview.normal} label={`Normal state for ${variant.name}`} />
                        <PreviewCanvas image={preview.selected} label={`Selected state for ${variant.name}`} />
                      </>
                    ) : (
                      // Placeholder rather than an empty cell: previews are debounced, and
                      // a collapsing column made every row jump sideways as they landed.
                      <span className="selected__pending">rendering…</span>
                    )}
                  </div>
                </td>

                <td className="selected__name">
                  <span>{variant.name}</span>
                  <small>
                    {`${variant.category} ${variant.sizePx === 0 ? 'scalable' : variant.sizePx}`}
                  </small>
                </td>

                <td>
                  {/*
                    The column header carries the visible meaning, so each row's own label
                    is for assistive tech only — it still has to name the icon, because a
                    bare "Type" repeated down twenty rows identifies nothing.
                  */}
                  <label className="visually-hidden" htmlFor={kindId}>
                    {`Type for ${variant.name}`}
                  </label>
                  <select
                    id={kindId}
                    value={assignment.kind}
                    onChange={(event) =>
                      onAssignmentChange(variant.zipPath, {
                        ...assignment,
                        kind: event.target.value as IconKind,
                        // Keep the role consistent with the kind it mirrors.
                        role: assignment.role
                          ? ROLE_FOR_KIND[event.target.value as IconKind]
                          : undefined,
                      })
                    }
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="selected__role">
                  <input
                    id={roleId}
                    type="checkbox"
                    checked={assignment.role !== undefined}
                    /*
                      The label names the *slot*, not the icon. There are five default
                      slots on AmigaOS and one icon fills each; "use as system default
                      for folder-music" named the icon and so said nothing at all. The
                      accessible name still carries the icon name, because two rows of
                      the same kind would otherwise share one label.
                    */
                    aria-label={`Use ${variant.name} as the system default ${assignment.kind} icon`}
                    onChange={(event) =>
                      onAssignmentChange(variant.zipPath, {
                        // Spread, like the kind handler above: rebuilding the object field by
                        // field would silently drop any third field added to IconAssignment later.
                        ...assignment,
                        role: event.target.checked ? ROLE_FOR_KIND[assignment.kind] : undefined,
                      })
                    }
                  />
                  <label htmlFor={roleId} aria-hidden="true">
                    {`def_${role}`}
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="selected__note">
        A ticked row is also written to <code>Sys/def_*.info</code>, the icon AmigaOS
        falls back to for everything of that type. One icon per slot.
      </p>
    </section>
  );
}
