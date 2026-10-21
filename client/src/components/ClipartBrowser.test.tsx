import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClipartBrowser } from './ClipartBrowser.js';
import { ArtworkDialog } from './ArtworkDialog.js';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { createObject, rectangleRing } from '../model/defaults.js';

beforeEach(() => {
  referenceStore.setState({ settings: null });
  useDesignStore.getState().newDesign();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clipart browser', () => {
  it('searches and filters the built-in catalogue', () => {
    render(<ClipartBrowser onClose={() => {}} notify={() => {}} />);

    fireEvent.change(screen.getByTestId('clipart-search'), { target: { value: 'heart' } });
    expect(screen.getByTestId('clipart-heart')).toBeTruthy();
    expect(screen.queryByTestId('clipart-star')).toBeNull();

    fireEvent.change(screen.getByTestId('clipart-search'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('clipart-category'), { target: { value: 'Nature' } });
    expect(screen.getByTestId('clipart-leaf')).toBeTruthy();
    expect(screen.queryByTestId('clipart-heart')).toBeNull();
  });

  it('inserts an editable fill centred in the hoop', () => {
    const notify = vi.fn();
    render(<ClipartBrowser onClose={() => {}} notify={notify} />);

    fireEvent.click(screen.getByTestId('clipart-star'));
    fireEvent.click(screen.getByTestId('clipart-add'));

    const state = useDesignStore.getState();
    expect(state.design.objects).toHaveLength(1);
    const object = state.design.objects[0]!;
    expect(object.name).toBe('Five-point star');
    expect(object.type).toBe('fill');
    expect(object.path.rings.length).toBeGreaterThan(0);
    expect(object.machine).toBe(1);

    const xs = object.path.rings.flatMap((ring) => ring.map((point) => point.x));
    const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(centre).toBeCloseTo(state.design.width / 2, 1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Added Five-point star'));
  });
});

describe('artwork dialog', () => {
  it('shows raster-only controls for PNG and print-only options for sheets', () => {
    useDesignStore.getState().addObject(createObject('fill', [rectangleRing(20, 20, 20, 20)]));
    render(<ArtworkDialog onClose={() => {}} notify={() => {}} />);

    fireEvent.click(screen.getByTestId('artwork-format-png'));
    expect(screen.getByText(/Resolution \(DPI\)/)).toBeTruthy();
    expect(screen.queryByText(/Placement scale/)).toBeNull();

    fireEvent.click(screen.getByTestId('artwork-format-print'));
    expect(screen.getByText(/Placement scale/)).toBeTruthy();
    expect(screen.getByTestId('artwork-legend')).toBeTruthy();

    fireEvent.click(screen.getByTestId('artwork-format-svg'));
    expect(screen.queryByTestId('artwork-scale')).toBeNull();
    expect(screen.getByTestId('artwork-svg-hint').textContent).toMatch(/millimetre/i);
  });
});
