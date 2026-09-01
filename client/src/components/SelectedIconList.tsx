import type { IconVariant } from '../lib/theme/themeParser';
import type { IconKind } from '../lib/newicons/diskObject';
import type { DefaultIconRole } from '../lib/output/zipBuilder';

export interface IconAssignment {
  kind: IconKind;
  role?: DefaultIconRole;
}

const KINDS: IconKind[] = ['drawer', 'project', 'tool', 'disk', 'trashcan'];

/** The five kinds that are also legal ENVARC:Sys/def_*.info slots. */
const ROLE_FOR_KIND: Record<IconKind, DefaultIconRole> = {
  drawer: 'drawer',
  project: 'project',
  tool: 'tool',
  disk: 'disk',
  trashcan: 'trashcan',
};

export function SelectedIconList(props: {
  variants: IconVariant[];
  assignments: Map<string, IconAssignment>;
  onAssignmentChange: (zipPath: string, assignment: IconAssignment) => void;
}) {
  const { variants, assignments, onAssignmentChange } = props;

  return (
    <ul>
      {variants.map((variant) => {
        const assignment = assignments.get(variant.zipPath) ?? { kind: 'project' as IconKind };
        const kindId = `kind-${variant.zipPath}`;
        const roleId = `role-${variant.zipPath}`;

        return (
          <li key={variant.zipPath}>
            <span>{variant.name}</span>

            <label htmlFor={kindId}>{`Type for ${variant.name}`}</label>
            <select
              id={kindId}
              value={assignment.kind}
              onChange={(event) =>
                onAssignmentChange(variant.zipPath, {
                  ...assignment,
                  kind: event.target.value as IconKind,
                  // Keep the role consistent with the kind it mirrors.
                  role: assignment.role ? ROLE_FOR_KIND[event.target.value as IconKind] : undefined,
                })
              }
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>

            <label htmlFor={roleId}>{`Use as system default for ${variant.name}`}</label>
            <input
              id={roleId}
              type="checkbox"
              checked={assignment.role !== undefined}
              onChange={(event) =>
                onAssignmentChange(variant.zipPath, {
                  kind: assignment.kind,
                  role: event.target.checked ? ROLE_FOR_KIND[assignment.kind] : undefined,
                })
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
