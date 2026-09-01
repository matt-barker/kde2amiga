import { useEffect, useMemo, useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import { SelectedIconList } from './components/SelectedIconList';
import type { IconGroup, IconVariant } from './lib/theme/themeParser';
import { defaultAssignment, type IconAssignment } from './lib/theme/assignment';
import { runConversionJob, type JobConfig, type JobIconInput } from './lib/pipeline/convertJob';
import { buildPreviews, type IconPreview } from './lib/pipeline/preview';

const DEFAULT_CONFIG: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

// A single shared instance so it doesn't cause a fresh Map identity every render.
const EMPTY_PREVIEWS: Map<string, IconPreview> = new Map();

/**
 * Drops any previously selected sibling when a new variant of the same icon name is picked.
 *
 * `zipBuilder` writes one `${name}.info` per converted icon, and every variant inside an
 * IconGroup shares that name — so two selected siblings do not produce two files, they
 * produce one, whichever the loop wrote last. The gallery deliberately makes every variant
 * independently tickable so `apps/folder-wine` can be compared against `places/folder-wine`;
 * the point of that comparison is to *choose*, so choosing the second replaces the first
 * rather than erroring or inventing a disambiguated filename the Amiga would read as two
 * unrelated icons.
 *
 * Newly added paths win over already-selected ones: a fresh click must never be the thing
 * that gets silently dropped.
 */
function enforceOneVariantPerName(
  nextSelected: Set<string>,
  previousSelected: Set<string>,
  variantByZipPath: Map<string, IconVariant>,
): Set<string> {
  const result = new Set(nextSelected);
  const keptByName = new Map<string, string>();

  const alreadySelected: string[] = [];
  const newlySelected: string[] = [];
  for (const zipPath of nextSelected) {
    (previousSelected.has(zipPath) ? alreadySelected : newlySelected).push(zipPath);
  }

  for (const zipPath of [...alreadySelected, ...newlySelected]) {
    // A zipPath with no known variant can't collide by name; leave it untouched.
    const name = variantByZipPath.get(zipPath)?.name;
    if (name === undefined) continue;
    const previous = keptByName.get(name);
    if (previous !== undefined) result.delete(previous);
    keptByName.set(name, zipPath);
  }

  return result;
}

/**
 * Finds default-icon roles claimed by more than one icon.
 *
 * `zipBuilder` writes `Sys/def_${role}.info`, so two icons tagged as the same system
 * default silently collapse into one file. Unlike the name collision above there is no
 * sensible auto-resolution — two icons both claiming to be *the* default drawer is a
 * genuine user error — so conversion is blocked and the conflict named instead.
 */
function findRoleConflicts(inputs: JobIconInput[]): Map<string, string[]> {
  const namesByRole = new Map<string, string[]>();
  for (const input of inputs) {
    if (!input.role) continue;
    const names = namesByRole.get(input.role) ?? [];
    names.push(input.icon.name);
    namesByRole.set(input.role, names);
  }
  for (const [role, names] of namesByRole) {
    if (names.length < 2) namesByRole.delete(role);
  }
  return namesByRole;
}

export default function App() {
  const [zip, setZip] = useState<JSZip | null>(null);
  const [groups, setGroups] = useState<IconGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Map<string, IconAssignment>>(new Map());
  const [config, setConfig] = useState<JobConfig>(DEFAULT_CONFIG);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const selectedVariants = useMemo(
    () => groups.flatMap((g) => g.variants).filter((v) => selected.has(v.zipPath)),
    [groups, selected],
  );

  const [previews, setPreviews] = useState<Map<string, IconPreview>>(new Map());
  // Derived rather than set from the effect below: when there's nothing selected the
  // previews are empty by definition, so there's no async work to synchronize and no
  // need to route it through setState-in-effect (a react(set-state-in-effect) lint
  // advisory this plan deliberately keeps out).
  const visiblePreviews = zip && selectedVariants.length > 0 ? previews : EMPTY_PREVIEWS;

  // Debounced: the shared palette makes every preview depend on the whole selection,
  // so each change invalidates all of them. Recomputing on every keystroke-fast
  // selection change would be wasteful.
  useEffect(() => {
    if (!zip || selectedVariants.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      buildPreviews(zip, selectedVariants, config)
        .then((built) => {
          if (cancelled) return;
          setPreviews(new Map(built.map((p) => [p.zipPath, p])));
        })
        .catch((err) => console.warn('Preview build failed:', err));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [zip, selectedVariants, config]);

  // Looked up by zipPath rather than re-flattening `groups` on every selection change —
  // themes can hold hundreds of thousands of variants (see IconGallery's windowing note).
  const variantByZipPath = useMemo(() => {
    const map = new Map<string, IconVariant>();
    for (const group of groups) {
      for (const variant of group.variants) map.set(variant.zipPath, variant);
    }
    return map;
  }, [groups]);

  // Selection only ever changes through this handler (IconGallery's toggle always
  // routes back through onSelectionChange, and a fresh theme load replaces `selected`
  // wholesale in handleThemeLoaded below) — so seeding the assignment here, right where
  // the selection itself changes, covers every case without a separate effect watching
  // for it. Only zipPaths newly present are seeded; anything already in `assignments`
  // (a user override, or one seeded earlier) is left untouched.
  function handleSelectionChange(requestedSelection: Set<string>) {
    const nextSelected = enforceOneVariantPerName(requestedSelection, selected, variantByZipPath);
    setSelected(nextSelected);
    setAssignments((current) => {
      const next = new Map(current);
      let changed = false;
      for (const zipPath of nextSelected) {
        if (!next.has(zipPath)) {
          const variant = variantByZipPath.get(zipPath);
          if (!variant) continue;
          next.set(zipPath, defaultAssignment(variant));
          changed = true;
        }
      }
      return changed ? next : current;
    });
    // The preview-build effect only runs (and replaces `previews`) while the selection
    // is non-empty — see its early return above. Left uncleared here, a stale entry
    // built under a now-superseded config could survive a deselect and be shown again,
    // wrongly, the instant its zipPath is reselected, for as long as the next debounce
    // takes to resolve. Clearing it here, in the callback that owns this transition,
    // keeps that impossible without routing state-setting through the effect.
    if (nextSelected.size === 0) setPreviews(new Map());
  }

  function handleThemeLoaded(loadedZip: JSZip, loadedGroups: IconGroup[]) {
    setZip(loadedZip);
    setGroups(loadedGroups);
    setSelected(new Set());
    // zipPaths are archive-relative, so a new theme can reuse the exact paths of the
    // last one — carrying assignments forward would silently mislabel a different icon.
    setAssignments(new Map());
    // Same reasoning as handleSelectionChange: a new theme resets selection to empty
    // directly (not via that handler), so it must clear stale previews itself too —
    // otherwise a reused zipPath in the new theme could momentarily show the old
    // theme's preview image.
    setPreviews(new Map());
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setError(null);
  }

  async function handleConvert() {
    if (!zip) return;

    const inputs: JobIconInput[] = selectedVariants.map((variant) => {
      const assignment = assignments.get(variant.zipPath) ?? defaultAssignment(variant);
      return { icon: variant, kind: assignment.kind, role: assignment.role };
    });

    const conflicts = findRoleConflicts(inputs);
    if (conflicts.size > 0) {
      const described = Array.from(conflicts, ([role, names]) =>
        `def_${role} is claimed by ${names.join(', ')}`,
      ).join('; ');
      setError(
        `Only one icon can be the system default for each role. ${described}. ` +
          'Untick "Use as system default" on all but one of them.',
      );
      return;
    }

    setConverting(true);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const blob = await runConversionJob(zip, inputs, config, (done, total) => setProgress({ done, total }));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(`Conversion failed: ${(err as Error).message}`);
    } finally {
      setConverting(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <h1>kde2amiga</h1>
      <ThemeLoader onThemeLoaded={handleThemeLoaded} />
      {zip && groups.length > 0 && (
        <>
          <IconGallery
            zip={zip}
            groups={groups}
            selected={selected}
            onSelectionChange={handleSelectionChange}
          />
          <SelectedIconList
            variants={selectedVariants}
            assignments={assignments}
            onAssignmentChange={(zipPath, assignment) =>
              setAssignments((current) => new Map(current).set(zipPath, assignment))
            }
            previews={visiblePreviews}
          />
          <JobConfigForm
            config={config}
            onChange={(next) => {
              setConfig(next);
              // Every cached preview was built under the old config's palette/effect,
              // so all of them are invalid the instant config changes — regardless of
              // whether anything is currently selected. Cleared here, at the source of
              // the change, rather than in the build effect (see handleSelectionChange).
              setPreviews(new Map());
            }}
          />
          <button type="button" onClick={handleConvert} disabled={selected.size === 0 || converting}>
            {converting ? 'Converting…' : 'Convert'}
          </button>
          {converting && progress && progress.total > 0 && (
            <p>Converting {progress.done} of {progress.total}…</p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {downloadUrl && (
        <a href={downloadUrl} download="kde2amiga-icons.zip">
          Download
        </a>
      )}
    </div>
  );
}
