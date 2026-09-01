import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobConfigForm } from './JobConfigForm';
import type { JobConfig } from '../lib/pipeline/convertJob';

const baseConfig: JobConfig = { outputSizePx: 32, maxColors: 16, selectedEffect: 'invert' };

describe('JobConfigForm', () => {
  it('renders the current output size and max colors', () => {
    render(<JobConfigForm config={baseConfig} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/output size/i)).toHaveValue(32);
    expect(screen.getByLabelText(/max colors/i)).toHaveValue(16);
  });

  it('calls onChange with an updated selected-state effect', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/selected-state effect/i), { target: { value: 'glowSurround' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, selectedEffect: 'glowSurround' });
  });

  it('calls onChange with an updated output size as a number', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '64' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 64 });
  });

  it('ignores an emptied numeric field instead of propagating zero', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/max colors/i), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps an output size above 222, since the NewIcons header only has one byte for width + 33', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '9999' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 222 });
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
