import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobConfigForm } from './JobConfigForm';
import type { JobConfig } from '../lib/pipeline/convertJob';

const baseConfig: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

describe('JobConfigForm', () => {
  it('renders the current output size and max colours as the chosen presets', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/output size/i)).toHaveValue('32');
    expect(screen.getByLabelText(/max colours/i)).toHaveValue('16');
  });

  it('calls onChange with an updated selected-state effect', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/selected-state effect/i), { target: { value: 'darken' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, selectedEffect: 'darken' });
  });

  it('labels each effect in prose rather than in its camelCase identifier', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    const options = screen.getByLabelText(/selected-state effect/i).querySelectorAll('option');
    expect(Array.from(options, (o) => o.textContent)).toEqual([
      'Invert', 'Brighten', 'Darken', 'Tint', 'Glow Surround',
    ]);
  });
});

/*
 * The two numeric fields are offered as presets because the useful values are a short,
 * known ladder — and because the format's own ceilings (34 palette entries, 222px of
 * width) sit inside the range a bare number input invites you to type.
 */
describe('preset pickers', () => {
  it('offers the icon size ladder, and Custom for anything else', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    const options = screen.getByLabelText(/output size/i).querySelectorAll('option');
    expect(Array.from(options, (o) => o.textContent)).toEqual(['24', '32', '48', '64', '128', 'Custom']);
  });

  it('offers the colour-count ladder, and Custom for anything else', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    const options = screen.getByLabelText(/max colours/i).querySelectorAll('option');
    expect(Array.from(options, (o) => o.textContent)).toEqual(['4', '6', '8', '12', '16', '24', '32', 'Custom']);
  });

  it('calls onChange with a picked size preset as a number', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '64' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 64 });
  });

  it('calls onChange with a picked colour preset as a number', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/max colours/i), { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, maxColors: 8 });
  });

  it('hides the number fields until Custom is picked', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/custom size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/custom colours/i)).not.toBeInTheDocument();
  });

  it('reveals a number field when Custom is picked, without changing the value yet', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: 'custom' } });
    expect(screen.getByLabelText(/custom size/i)).toHaveValue(32);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes a typed custom size through', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText(/custom size/i), { target: { value: '96' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 96 });
  });

  it('passes a typed custom colour count through', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/max colours/i), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText(/custom colours/i), { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, maxColors: 20 });
  });

  it('shows a value that matches no preset as Custom, with the field already open', () => {
    // Configs outlive the dropdown — one can arrive from a previous session's default or
    // from a value typed before the presets existed, and it must still be visible.
    render(<JobConfigForm config={{ ...baseConfig, outputSizePx: 37, maxColors: 21 }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/output size/i)).toHaveValue('custom');
    expect(screen.getByLabelText(/custom size/i)).toHaveValue(37);
    expect(screen.getByLabelText(/max colours/i)).toHaveValue('custom');
    expect(screen.getByLabelText(/custom colours/i)).toHaveValue(21);
  });

  it('ignores an emptied custom field instead of propagating zero', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={{ ...baseConfig, outputSizePx: 37 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/custom size/i), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps a custom size above 222, since the NewIcons header only has one byte for width + 33', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={{ ...baseConfig, outputSizePx: 37 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/custom size/i), { target: { value: '9999' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ outputSizePx: 222 }));
  });
});

describe('background flattening', () => {
  it('is on by default, showing the Workbench grey it will bake against', () => {
    render(<JobConfigForm config={{ ...baseConfig, backgroundColor: [0xab, 0xab, 0xab] }} onChange={() => {}} />);
    expect(screen.getByLabelText(/smooth edges against/i)).toBeChecked();
    expect(screen.getByLabelText(/background colour/i)).toHaveValue('#ababab');
  });

  it('drops the background colour entirely when switched off', () => {
    // Undefined rather than a colour: on a patterned or non-grey backdrop the baked
    // pixels read as a fringe, so the honest option has to be no flattening at all.
    const onChange = vi.fn();
    render(<JobConfigForm config={{ ...baseConfig, backgroundColor: [0xab, 0xab, 0xab] }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/smooth edges against/i));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backgroundColor: undefined }));
  });

  it('passes a newly picked colour through as an rgb triple', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={{ ...baseConfig, backgroundColor: [0xab, 0xab, 0xab] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/background colour/i), { target: { value: '#67043b' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backgroundColor: [0x67, 0x04, 0x3b] }));
  });

  it('restores the Workbench grey when switched back on', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={{ ...baseConfig, backgroundColor: undefined }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/smooth edges against/i));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backgroundColor: [0xab, 0xab, 0xab] }));
  });
});

describe('glow surround colour', () => {
  const glowConfig: JobConfig = { ...baseConfig, selectedEffect: 'glowSurround', glowColor: [255, 255, 255] };

  it('is offered only while Glow Surround is the chosen effect', () => {
    const { rerender } = render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/glow colour/i)).not.toBeInTheDocument();
    rerender(<JobConfigForm config={glowConfig} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/glow colour/i)).toHaveValue('#ffffff');
  });

  it('passes a newly picked glow colour through as an rgb triple', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={glowConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/glow colour/i), { target: { value: '#00ff88' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ glowColor: [0x00, 0xff, 0x88] }));
  });

  it('seeds white when the effect is first switched to Glow Surround', () => {
    // Without this the picker would show white while conversion still used the icon's
    // own brightest colour — the control would be describing something it did not set.
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/selected-state effect/i), { target: { value: 'glowSurround' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedEffect: 'glowSurround', glowColor: [255, 255, 255] }),
    );
  });
});
