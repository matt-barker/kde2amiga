import { useState } from 'react';
import type { JobConfig } from '../lib/pipeline/convertJob';
import type { SelectedStateEffect } from '../lib/image/selectedState';
import './JobConfigForm.css';

/** Prose labels; the values themselves stay the identifiers the pipeline switches on. */
const EFFECT_LABELS: Record<SelectedStateEffect, string> = {
  invert: 'Invert',
  brighten: 'Brighten',
  darken: 'Darken',
  tint: 'Tint',
  glowSurround: 'Glow Surround',
};

/**
 * The sizes worth offering, stopping at 128.
 *
 * The NewIcons header encodes width + 33 in a single byte, so 222px is the hard ceiling;
 * 256 would be silently clamped, and a dropdown that quietly delivers something other
 * than what it says is worse than one that never offers it. Anything between the rungs
 * is still reachable through Custom.
 */
const SIZE_PRESETS = [24, 32, 48, 64, 128];

/**
 * The colour counts worth offering, stopping at 32.
 *
 * A NewIcons palette has to fit on the first ToolType line, which caps it at 34 entries
 * — see paletteLimits.ts. Offering 64 or 256 would advertise colours the format cannot
 * store. 32 is the last power of two under the cap; Custom reaches the remaining two.
 */
const COLOR_PRESETS = [4, 6, 8, 12, 16, 24, 32];

/** Largest width the single-byte `width + 33` header field can carry. */
const MAX_OUTPUT_SIZE_PX = 222;

/**
 * The standard AmigaOS Workbench grey, and the default backdrop to smooth edges against.
 *
 * Sampled from a 3.2.3 Workbench screenshot rather than assumed. It is also what
 * GlowIcons themselves are drawn against — their opaque grey drop shadows only resolve
 * on this colour, which is why switching this off has to be possible at all.
 */
const WORKBENCH_GREY: [number, number, number] = [0xab, 0xab, 0xab];

/** What the glow was before it was configurable: a white halo, as GlowIcons draws it. */
const GLOW_WHITE: [number, number, number] = [0xff, 0xff, 0xff];

const CUSTOM = 'custom';

const toHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * A dropdown of known-good values, with a number field behind a Custom entry.
 *
 * Both numeric settings have the same shape: a short ladder of values that are actually
 * useful, a format ceiling well below what a bare number input invites you to type, and
 * a long tail of legal-but-unusual values that still has to be reachable.
 *
 * Custom is sticky once chosen. Deriving it from the value alone would close the field
 * the moment someone typed a number that happened to be a preset — losing the cursor
 * mid-edit — so a value off the ladder forces Custom open, but choosing Custom keeps it
 * open regardless.
 */
function PresetNumberField(props: {
  id: string;
  label: string;
  customLabel: string;
  presets: number[];
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const { id, label, customLabel, presets, value, max, onChange } = props;
  const [customChosen, setCustomChosen] = useState(false);
  const isCustom = customChosen || !presets.includes(value);

  return (
    <>
      <div className="config__field">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={isCustom ? CUSTOM : String(value)}
          onChange={(event) => {
            const picked = event.target.value;
            setCustomChosen(picked === CUSTOM);
            // Switching to Custom only opens the field; it keeps whatever value is
            // already set, so nothing changes under the user until they type.
            if (picked !== CUSTOM) onChange(Number(picked));
          }}
        >
          {presets.map((preset) => (
            <option key={preset} value={String(preset)}>
              {preset}
            </option>
          ))}
          <option value={CUSTOM}>Custom</option>
        </select>
      </div>

      {isCustom && (
        <div className="config__field">
          <label htmlFor={`${id}-custom`}>{customLabel}</label>
          <input
            id={`${id}-custom`}
            type="number"
            min="1"
            max={max}
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              // An emptied field reads as 0; propagating it would make the icon vanish.
              if (!Number.isFinite(next) || next <= 0) return;
              onChange(max === undefined ? next : Math.min(next, max));
            }}
          />
        </div>
      )}
    </>
  );
}

export function JobConfigForm(props: { config: JobConfig; onChange: (config: JobConfig) => void }) {
  const { config, onChange } = props;

  return (
    <div className="config">
      <PresetNumberField
        id="output-size"
        label="Output Size (px)"
        customLabel="Custom Size (px)"
        presets={SIZE_PRESETS}
        value={config.outputSizePx}
        max={MAX_OUTPUT_SIZE_PX}
        onChange={(outputSizePx) => onChange({ ...config, outputSizePx })}
      />

      <PresetNumberField
        id="max-colors"
        label="Max Colours"
        customLabel="Custom Colours"
        presets={COLOR_PRESETS}
        value={config.maxColors}
        onChange={(maxColors) => onChange({ ...config, maxColors })}
      />

      <div className="config__field">
        <label htmlFor="flatten-edges">Smooth Edges Against a Background</label>
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
        <label htmlFor="background-colour">Background Colour</label>
        <input
          id="background-colour"
          type="color"
          disabled={config.backgroundColor === undefined}
          value={toHex(config.backgroundColor ?? WORKBENCH_GREY)}
          onChange={(e) => onChange({ ...config, backgroundColor: fromHex(e.target.value) })}
        />
      </div>

      <div className="config__field">
        <label htmlFor="selected-effect">Selected-State Effect</label>
        <select
          id="selected-effect"
          value={config.selectedEffect}
          onChange={(e) => {
            const selectedEffect = e.target.value as SelectedStateEffect;
            const next: JobConfig = { ...config, selectedEffect };
            /*
             * An unset glowColor does not mean white — it means "the brightest entry in
             * this icon's own palette", which is where the glow came from before it was
             * configurable. Seeding it here rather than defaulting it in the picker keeps
             * the control honest: what it shows is what conversion draws.
             */
            if (selectedEffect === 'glowSurround' && next.glowColor === undefined) {
              next.glowColor = GLOW_WHITE;
            }
            onChange(next);
          }}
        >
          {(Object.keys(EFFECT_LABELS) as SelectedStateEffect[]).map((effect) => (
            <option key={effect} value={effect}>
              {EFFECT_LABELS[effect]}
            </option>
          ))}
        </select>
      </div>

      {config.selectedEffect === 'glowSurround' && (
        <div className="config__field">
          <label htmlFor="glow-colour">Glow Colour</label>
          <input
            id="glow-colour"
            type="color"
            value={toHex(config.glowColor ?? GLOW_WHITE)}
            onChange={(e) => onChange({ ...config, glowColor: fromHex(e.target.value) })}
          />
        </div>
      )}
    </div>
  );
}
