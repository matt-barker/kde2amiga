import type { JobConfig } from '../lib/pipeline/convertJob';
import type { SelectedStateEffect } from '../lib/image/selectedState';

const EFFECTS: SelectedStateEffect[] = ['invert', 'brighten', 'darken', 'tint', 'glowSurround'];

export function JobConfigForm(props: { config: JobConfig; onChange: (config: JobConfig) => void }) {
  const { config, onChange } = props;

  return (
    <div>
      <label htmlFor="output-size">Output size (px)</label>
      <input
        id="output-size"
        type="number"
        value={config.outputSizePx}
        onChange={(e) => onChange({ ...config, outputSizePx: Number(e.target.value) })}
      />

      <label htmlFor="max-colors">Max colors</label>
      <input
        id="max-colors"
        type="number"
        value={config.maxColors}
        onChange={(e) => onChange({ ...config, maxColors: Number(e.target.value) })}
      />

      <label htmlFor="selected-effect">Selected-state effect</label>
      <select
        id="selected-effect"
        value={config.selectedEffect}
        onChange={(e) => onChange({ ...config, selectedEffect: e.target.value as SelectedStateEffect })}
      >
        {EFFECTS.map((effect) => (
          <option key={effect} value={effect}>
            {effect}
          </option>
        ))}
      </select>
    </div>
  );
}
