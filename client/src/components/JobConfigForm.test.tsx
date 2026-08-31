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

  it('clamps an output size above 256, since the NewIcons header only has one byte for it', () => {
    const onChange = vi.fn();
    render(<JobConfigForm config={baseConfig} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/output size/i), { target: { value: '9999' } });
    expect(onChange).toHaveBeenCalledWith({ ...baseConfig, outputSizePx: 256 });
  });
});
