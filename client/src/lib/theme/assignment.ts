import type { IconKind } from '../newicons/diskObject';
import type { DefaultIconRole } from '../output/zipBuilder';
import type { IconVariant } from './themeParser';
import { inferIconKind } from './iconKind';

/** What the user has decided a selected icon should become on the Amiga. */
export interface IconAssignment {
  kind: IconKind;
  /** Set only when this icon is also to be installed as an `ENVARC:Sys/def_*.info`. */
  role?: DefaultIconRole;
}

/**
 * The assignment a variant starts with before the user touches anything.
 *
 * Single source of truth on purpose: App seeds `assignments` with this when a variant is
 * first selected, and both App and SelectedIconList fall back to it for a zipPath that
 * somehow has no entry. Those two fallbacks used to be independent `{ kind: 'project' }`
 * literals — the exact hardcoded default this branch set out to retire, silently
 * disagreeing with the inferred kind shown in the UI.
 */
export function defaultAssignment(variant: IconVariant): IconAssignment {
  return { kind: inferIconKind(variant.name, variant.category) };
}
