import { useEffect, useMemo, useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import { SelectedIconList } from './components/SelectedIconList';
import type { IconGroup, IconVariant } from './lib/theme/themeParser';
import { defaultAssignment, type IconAssignment } from './lib/theme/assignment';
import {
  DEFAULT_JOB_CONFIG,
  runConversionJob,
  type JobConfig,
  type JobIconInput,
} from './lib/pipeline/convertJob';
import { buildPreviews, type IconPreview } from './lib/pipeline/preview';
import { buildOutputZip } from './lib/output/zipBuilder';
import { ARCHIVE_BASE_NAME } from './lib/output/outputEntries';
import { buildOutputLha } from './lib/output/lhaBuilder';
import './App.css';

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
  const [config, setConfig] = useState<JobConfig>(DEFAULT_JOB_CONFIG);
  // Both archives are built from one conversion run and held as object URLs together, so
  // they are always the same icons and are revoked as a pair.
  const [downloads, setDownloads] = useState<{ zip: string; lha: string } | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Bumped on every theme load so previews built for the previous theme can never be
  // mistaken for the new one's — see previewSignature below.
  const [themeSerial, setThemeSerial] = useState(0);

  // Looked up by zipPath rather than re-flattening `groups` on every selection change —
  // themes can hold hundreds of thousands of variants (see IconGallery's windowing note).
  const variantByZipPath = useMemo(() => {
    const map = new Map<string, IconVariant>();
    for (const group of groups) {
      for (const variant of group.variants) map.set(variant.zipPath, variant);
    }
    return map;
  }, [groups]);

  // Derived from the selection, not by re-scanning every variant in the theme: this runs
  // on every selection change, and it is O(selection) rather than O(272k).
  const selectedVariants = useMemo(
    () =>
      Array.from(selected, (zipPath) => variantByZipPath.get(zipPath)).filter(
        (variant): variant is IconVariant => variant !== undefined,
      ),
    [selected, variantByZipPath],
  );

  /**
   * Identifies the inputs a preview batch was built from.
   *
   * Every preview depends on the whole batch (the palette is shared) and on the whole
   * config, so a preview is valid only while *nothing* about either has changed. Rather
   * than clearing `previews` at each site that could invalidate them — and inevitably
   * missing one, which is how a stale preview survived both a failed build and a grown
   * selection — the stored batch carries the signature it was built for, and previews
   * render only while that still matches. Anything that changes the signature clears the
   * previews by construction, with no clearing site to forget.
   *
   * `themeSerial` is in here because zipPaths are archive-relative: a new theme can reuse
   * the previous one's exact paths, and without it an identical selection in a different
   * theme would produce an identical signature and show the old theme's pictures.
   *
   * The whole config goes in rather than a hand-picked list of its fields. The list was
   * the thing that could rot, and did: `backgroundColor` was added to JobConfig and never
   * added here, so changing the colour edges are baked against left the previous batch's
   * pictures on screen until the rebuild landed. Stringifying the object cannot forget a
   * field. Two configs never collide; at worst a differing key order costs one rebuild,
   * which fails in the safe direction — towards showing nothing rather than the wrong
   * thing.
   *
   * The selection goes in *in order*, not sorted. `buildSharedPalette` concatenates the
   * batch's pixels in the order it is handed them and median-cuts the result, so the same
   * set of icons in a different order is not guaranteed to yield the same palette. A
   * sorted signature would call those two batches identical and could show previews built
   * under one ordering while conversion used the other — which is exactly the
   * preview/output divergence this branch's Global Constraint forbids. Worst case an
   * order change costs one extra rebuild; that is the cheap side of the trade.
   */
  const previewSignature = useMemo(
    () =>
      JSON.stringify([themeSerial, config, Array.from(selected)]),
    [themeSerial, config, selected],
  );

  const [previewBatch, setPreviewBatch] = useState<{
    signature: string;
    map: Map<string, IconPreview>;
  }>(() => ({ signature: '', map: EMPTY_PREVIEWS }));

  const visiblePreviews =
    previewBatch.signature === previewSignature ? previewBatch.map : EMPTY_PREVIEWS;

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
          setPreviewBatch({
            signature: previewSignature,
            map: new Map(built.map((p) => [p.zipPath, p])),
          });
        })
        // A failed build stores nothing, so `previewBatch` keeps a signature that no
        // longer matches and nothing is rendered — the failure shows as absence, never
        // as the previous batch's pictures.
        .catch((err) => console.warn('Preview build failed:', err));
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [zip, selectedVariants, config, previewSignature]);

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
  }

  // Removal goes through the same handler a gallery tick does, so the one-variant-per-name
  // rule and the assignment seeding stay on a single path. The row's assignment is left
  // behind deliberately: re-adding the icon then restores the type the user had chosen
  // for it rather than starting over from the inferred default.
  function handleRemove(zipPath: string) {
    const next = new Set(selected);
    next.delete(zipPath);
    handleSelectionChange(next);
  }

  /**
   * Releases both archive URLs together.
   *
   * They are only ever created as a pair, so releasing one without the other would leak
   * the survivor for the lifetime of the page — and an icon batch is megabytes.
   */
  function revokeDownloads() {
    if (!downloads) return;
    URL.revokeObjectURL(downloads.zip);
    URL.revokeObjectURL(downloads.lha);
  }

  function handleThemeLoaded(loadedZip: JSZip, loadedGroups: IconGroup[]) {
    setZip(loadedZip);
    setGroups(loadedGroups);
    setThemeSerial((serial) => serial + 1);
    setSelected(new Set());
    // zipPaths are archive-relative, so a new theme can reuse the exact paths of the
    // last one — carrying assignments forward would silently mislabel a different icon.
    setAssignments(new Map());
    revokeDownloads();
    setDownloads(null);
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
      const converted = await runConversionJob(zip, inputs, config, (done, total) =>
        setProgress({ done, total }),
      );
      // Packing is cheap next to the conversion above, so both formats are built now and
      // the user picks afterwards rather than before.
      const [zipBlob, lhaBlob] = [await buildOutputZip(converted), buildOutputLha(converted)];
      revokeDownloads();
      setDownloads({
        zip: URL.createObjectURL(zipBlob),
        lha: URL.createObjectURL(lhaBlob),
      });
    } catch (err) {
      setError(`Conversion failed: ${(err as Error).message}`);
    } finally {
      setConverting(false);
      setProgress(null);
    }
  }

  return (
    <div className="app">
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
            onRemove={handleRemove}
            previews={visiblePreviews}
          />
          <JobConfigForm
            config={config}
            onChange={setConfig}
          />
          <div className="actions">
            <button
              type="button"
              className="actions__convert"
              onClick={handleConvert}
              disabled={selected.size === 0 || converting}
            >
              {converting ? 'Converting…' : `Convert ${selected.size} icon${selected.size === 1 ? '' : 's'}`}
            </button>
            {converting && progress && progress.total > 0 && (
              <p>Converting {progress.done} of {progress.total}…</p>
            )}
            {downloads && (
              <>
                <a
                  className="actions__download"
                  href={downloads.zip}
                  download={`${ARCHIVE_BASE_NAME}.zip`}
                >
                  Download Zip
                </a>
                {/*
                  LHA is the one an Amiga can open unaided: AmigaOS ships no unzip, while
                  LhA is on essentially every machine and Directory Opus 5 reads it directly.
                  Both archives unpack into a drawer of this same name — see ARCHIVE_BASE_NAME,
                  which is the one place to rename either download.
                */}
                <a
                  className="actions__download"
                  href={downloads.lha}
                  download={`${ARCHIVE_BASE_NAME}.lha`}
                >
                  Download LHA
                </a>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="app__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
