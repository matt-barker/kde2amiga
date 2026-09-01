import { useEffect, useMemo, useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import { SelectedIconList, type IconAssignment } from './components/SelectedIconList';
import type { IconGroup, IconVariant } from './lib/theme/themeParser';
import { inferIconKind } from './lib/theme/iconKind';
import { runConversionJob, type JobConfig, type JobIconInput } from './lib/pipeline/convertJob';
import { buildPreviews, type IconPreview } from './lib/pipeline/preview';

const DEFAULT_CONFIG: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

// A single shared instance so it doesn't cause a fresh Map identity every render.
const EMPTY_PREVIEWS: Map<string, IconPreview> = new Map();

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
  function handleSelectionChange(nextSelected: Set<string>) {
    setSelected(nextSelected);
    setAssignments((current) => {
      const next = new Map(current);
      let changed = false;
      for (const zipPath of nextSelected) {
        if (!next.has(zipPath)) {
          const variant = variantByZipPath.get(zipPath);
          if (!variant) continue;
          next.set(zipPath, { kind: inferIconKind(variant.name, variant.category) });
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  function handleThemeLoaded(loadedZip: JSZip, loadedGroups: IconGroup[]) {
    setZip(loadedZip);
    setGroups(loadedGroups);
    setSelected(new Set());
    // zipPaths are archive-relative, so a new theme can reuse the exact paths of the
    // last one — carrying assignments forward would silently mislabel a different icon.
    setAssignments(new Map());
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setError(null);
  }

  async function handleConvert() {
    if (!zip) return;
    setConverting(true);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const inputs: JobIconInput[] = selectedVariants.map((variant) => {
        const assignment = assignments.get(variant.zipPath) ?? { kind: 'project' as const };
        return { icon: variant, kind: assignment.kind, role: assignment.role };
      });

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
          <JobConfigForm config={config} onChange={setConfig} />
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
