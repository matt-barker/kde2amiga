import { useEffect, useMemo, useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import { SelectedIconList, type IconAssignment } from './components/SelectedIconList';
import type { IconGroup } from './lib/theme/themeParser';
import { inferIconKind } from './lib/theme/iconKind';
import { runConversionJob, type JobConfig, type JobIconInput } from './lib/pipeline/convertJob';

const DEFAULT_CONFIG: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

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

  // Seed a kind for anything newly selected; never clobber a kind the user has set.
  useEffect(() => {
    setAssignments((current) => {
      const next = new Map(current);
      let changed = false;
      for (const variant of selectedVariants) {
        if (!next.has(variant.zipPath)) {
          next.set(variant.zipPath, { kind: inferIconKind(variant.name, variant.category) });
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedVariants]);

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
            onSelectionChange={setSelected}
          />
          <SelectedIconList
            variants={selectedVariants}
            assignments={assignments}
            onAssignmentChange={(zipPath, assignment) =>
              setAssignments((current) => new Map(current).set(zipPath, assignment))
            }
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
