import { useState } from 'react';
import type JSZip from 'jszip';
import { ThemeLoader } from './components/ThemeLoader';
import { IconGallery } from './components/IconGallery';
import { JobConfigForm } from './components/JobConfigForm';
import type { ThemeIcon } from './lib/theme/themeParser';
import { runConversionJob, type JobConfig, type JobIconInput } from './lib/pipeline/convertJob';

const DEFAULT_CONFIG: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

export default function App() {
  const [zip, setZip] = useState<JSZip | null>(null);
  const [icons, setIcons] = useState<ThemeIcon[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<JobConfig>(DEFAULT_CONFIG);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  function handleThemeLoaded(loadedZip: JSZip, loadedIcons: ThemeIcon[]) {
    setZip(loadedZip);
    setIcons(loadedIcons);
    setSelected(new Set());
    setDownloadUrl(null);
  }

  async function handleConvert() {
    if (!zip) return;
    setConverting(true);
    try {
      const inputs: JobIconInput[] = icons
        .filter((icon) => selected.has(`${icon.category}/${icon.name}`))
        .map((icon) => ({ icon, kind: 'project' as const }));

      const blob = await runConversionJob(zip, inputs, config);
      setDownloadUrl(URL.createObjectURL(blob));
    } finally {
      setConverting(false);
    }
  }

  return (
    <div>
      <h1>kde2amiga</h1>
      <ThemeLoader onThemeLoaded={handleThemeLoaded} />
      {icons.length > 0 && (
        <>
          <IconGallery icons={icons} selected={selected} onSelectionChange={setSelected} />
          <JobConfigForm config={config} onChange={setConfig} />
          <button type="button" onClick={handleConvert} disabled={selected.size === 0 || converting}>
            Convert
          </button>
        </>
      )}
      {downloadUrl && (
        <a href={downloadUrl} download="kde2amiga-icons.zip">
          Download
        </a>
      )}
    </div>
  );
}
