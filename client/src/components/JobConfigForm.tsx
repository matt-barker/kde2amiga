import type { JobConfig } from '../lib/pipeline/convertJob';
import type { SelectedStateEffect } from '../lib/image/selectedState';
import './JobConfigForm.css';

const EFFECTS: SelectedStateEffect[] = ['invert', 'brighten', 'darken', 'tint', 'glowSurround'];

/**
 * The standard AmigaOS Workbench grey, and the default backdrop to smooth edges against.
 *
 * Sampled from a 3.2.3 Workbench screenshot rather than assumed. It is also what
 * GlowIcons themselves are drawn against — their opaque grey drop shadows only resolve
 * on this colour, which is why switching this off has to be possible at all.
 */
const WORKBENCH_GREY: [number, number, number] = [0xab, 0xab, 0xab];

const toHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export function JobConfigForm(props: { config: JobConfig; onChange: (config: JobConfig) => void }) {
  const { config, onChange } = props;

  return (
    <div className="config">
      <div className="config__field">
        <label htmlFor="output-size">Output size (px)</label>
        <input
          id="output-size"
          type="number"
          min="1"
          max="222"
          value={config.outputSizePx}
          onChange={(e) => {
            const next = Number(e.target.value);
            // The NewIcons header encodes width + 33 in a single byte, and BinaryWriter.writeString
            // masks with & 0xff, so width + 33 must stay <= 255, i.e. width <= 222.
            if (Number.isFinite(next) && next > 0) {
              onChange({ ...config, outputSizePx: Math.min(next, 222) });
            }
          }}
        />
      </div>

      <div className="config__field">
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
      </div>

      <div className="config__field">
        <label htmlFor="flatten-edges">Smooth edges against a background</label>
        <input
          id="flatten-edges"
          type="checkbox"
          checked={config.backgroundColor !== undefined}
          onChange={(e) =>
            onChange({
              ...config,
              // Off means no colour at all, not black: baking any colour in assumes a
              // backdrop, and on a patterned or non-grey one the result is a fringe.
              backgroundColor: e.target.checked ? WORKBENCH_GREY : undefined,
            })
          }
        />
      </div>

      <div className="config__field">
        <label htmlFor="background-colour">Background colour</label>
        <input
          id="background-colour"
          type="color"
          disabled={config.backgroundColor === undefined}
          value={toHex(config.backgroundColor ?? WORKBENCH_GREY)}
          onChange={(e) => onChange({ ...config, backgroundColor: fromHex(e.target.value) })}
        />
      </div>

      <div className="config__field">
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
    </div>
  );
}
