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
        min="1"
        max="256"
        value={config.outputSizePx}
        onChange={(e) => {
          const next = Number(e.target.value);
          // The NewIcons header encodes width + 33 in a single byte, so anything above
          // 256 would corrupt it.
          if (Number.isFinite(next) && next > 0) {
            onChange({ ...config, outputSizePx: Math.min(next, 256) });
          }
        }}
      />

      <label htmlFor="max-colors">Max colors</label>
      <input
        id="max-colors"
        type="number"
        min="1"
        value={config.maxColors}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next > 0) onChange({ ...config, maxColors: next });
        }}
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
