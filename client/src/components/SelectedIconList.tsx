import { useEffect, useRef } from 'react';
import type { IconVariant } from '../lib/theme/themeParser';
import type { IconKind } from '../lib/newicons/diskObject';
import { DEFAULT_ICON_SLOTS, type DefaultIconRole } from '../lib/output/defaultIconSlots';
import {
  WORKBENCH_TARGETS,
  targetPath,
  type WorkbenchTargetPath,
} from '../lib/output/workbenchTargets';
import { defaultAssignment, type IconAssignment } from '../lib/theme/assignment';
import type { IconPreview } from '../lib/pipeline/preview';
import { WORKBENCH_GREY, toHex, type Rgb } from '../lib/image/rgb';
import './SelectedIconList.css';

const KINDS: IconKind[] = ['drawer', 'project', 'tool', 'disk', 'trashcan'];

/**
 * Thirty-three slots in one flat list would bury the five most people want behind two
 * dozen file types they will never tag, so the dropdown keeps the two families apart.
 */
const SLOT_GROUPS = [
  { group: 'type', label: 'Fallback by icon type' },
  { group: 'deficons', label: 'Fallback by file type (DefIcons)' },
] as const;

/**
 * Targets grouped for the dropdown, in catalogue order.
 *
 * Built once rather than per row: forty-nine entries across five groups, rebuilt for
 * every selected icon on every render, is work for nothing.
 */
const TARGET_GROUPS = WORKBENCH_TARGETS.reduce((groups, target) => {
  const label = `${target.root}${target.drawer}`;
  const existing = groups.get(label);
  if (existing) existing.push(target);
  else groups.set(label, [target]);
  return groups;
}, new Map<string, typeof WORKBENCH_TARGETS[number][]>());

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
  onRemove: (zipPath: string) => void;
  previews?: Map<string, IconPreview>;
  /** The colour conversion is baking soft edges against, or undefined when it is not. */
  backgroundColor?: Rgb;
}) {
  const { variants, assignments, onAssignmentChange, onRemove, previews, backgroundColor } = props;

  // Workbench grey when nothing is being baked in: the previews still have to sit on
  // something, and the desktop they are headed for is that grey.
  const ground = backgroundColor ? toHex(backgroundColor) : WORKBENCH_GREY;

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
            <th scope="col">Workbench icon</th>
            {/*
              The column exists for layout, but its heading would only ever read
              "Remove" above a row of identical crosses — the buttons name themselves.
            */}
            <th scope="col"><span className="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => {
            const assignment = assignments.get(variant.zipPath) ?? defaultAssignment(variant);
            const kindId = `kind-${variant.zipPath}`;
            const roleId = `role-${variant.zipPath}`;
            const targetId = `target-${variant.zipPath}`;
            const preview = previews?.get(variant.zipPath);

            return (
              <tr key={variant.zipPath}>
                <td className="selected__previews">
                  {/*
                    * Set here rather than in the stylesheet because it is a conversion
                    * value, not a styling choice: soft edges are baked against this exact
                    * colour, so the preview is only honest when shown on it.
                    */}
                  <div style={preview ? { backgroundColor: ground } : undefined}>
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
                    onChange={(event) => {
                      const kind = event.target.value as IconKind;
                      onAssignmentChange(variant.zipPath, { ...assignment, kind });
                    }}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="selected__role">
                  {/*
                    The label names the *slot*, not the icon: one icon fills each slot,
                    so "use as system default for folder-music" named the icon and said
                    nothing about what picking it would do. The accessible name still
                    carries the icon name, because two rows would otherwise share a label.
                  */}
                  <label className="visually-hidden" htmlFor={roleId}>
                    {`System default slot for ${variant.name}`}
                  </label>
                  <select
                    id={roleId}
                    value={assignment.role ?? ''}
                    onChange={(event) => {
                      const role = event.target.value === '' ? undefined : (event.target.value as DefaultIconRole);
                      onAssignmentChange(variant.zipPath, { ...assignment, role });
                    }}
                  >
                    <option value="">none</option>
                    {SLOT_GROUPS.map(({ group, label }) => (
                      <optgroup key={group} label={label}>
                        {DEFAULT_ICON_SLOTS.filter((slot) => slot.group === group).map((slot) => (
                          <option key={slot.role} value={slot.role}>
                            {`def_${slot.role} — ${slot.description}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>

                <td className="selected__target">
                  {/*
                    Names the *target*, as the slot dropdown beside it does: one icon
                    replaces each Workbench icon, so naming the KDE icon here would say
                    nothing about what picking a value does.
                  */}
                  <label className="visually-hidden" htmlFor={targetId}>
                    {`Workbench icon for ${variant.name}`}
                  </label>
                  <select
                    id={targetId}
                    value={assignment.target ?? ''}
                    onChange={(event) => {
                      const target =
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as WorkbenchTargetPath);
                      onAssignmentChange(variant.zipPath, { ...assignment, target });
                    }}
                  >
                    <option value="">none</option>
                    {[...TARGET_GROUPS].map(([label, targets]) => (
                      <optgroup key={label} label={label}>
                        {targets.map((target) => (
                          <option key={targetPath(target)} value={targetPath(target)}>
                            {`${target.name} — ${target.description}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>

                <td className="selected__remove">
                  <button
                    type="button"
                    /*
                      The cross is decoration; the accessible name has to say which icon
                      goes, since twenty rows of "Remove" identify nothing.
                    */
                    aria-label={`Remove ${variant.name}`}
                    onClick={() => onRemove(variant.zipPath)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="selected__note">
        A row with a slot picked is also written to <code>Sys/def_*.info</code>, the icon
        AmigaOS falls back to when a file or drawer has none of its own. One icon per
        slot. The archive then carries an <code>Install Default Icons</code> script that
        copies them into place. A row with a Workbench icon picked also replaces that icon
        on your Amiga — the installer copies the original into a backup drawer first.
      </p>
    </section>
  );
}
