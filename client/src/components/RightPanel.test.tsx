import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Right-panel controls.
 *
 * The panel is a thin read/write layer over the store, so what is worth
 * testing here is the wiring: that a control writes the field it claims to,
 * that the value it displays is the one the export will actually use, and
 * that the copy next to it stays true once the setting changes.
 */

import { RightPanel } from './RightPanel.js';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { createObject, rectangleRing } from '../model/defaults.js';

beforeEach(() => {
  referenceStore.setState({
    hoops: [],
    palettes: [],
    presets: [],
    settings: null,
    server: null,
    status: 'idle',
    error: null,
  });
  useDesignStore.getState().newDesign();
  useDesignStore.setState({
    sectionOverlap: 0,
    sectionMarks: false,
    dirty: false,
    optimizeColors: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('multi-hoop joins', () => {
  it('starts at the exactly-adjacent cut with no crosses', () => {
    render(<RightPanel />);

    const overlap = screen.getByTestId('section-overlap') as HTMLInputElement;
    const marks = screen.getByTestId('section-marks') as HTMLInputElement;

    expect(overlap.value).toBe('0');
    expect(marks.checked).toBe(false);
    expect(screen.getByTestId('multihoop-section')).toHaveTextContent(
      'With no overlap the two files meet exactly on the cut.',
    );
    expect(screen.getByTestId('multihoop-section')).toHaveTextContent(
      'No alignment marks are sewn.',
    );
  });

  it('writes the overlap to the store and updates the explanation', () => {
    render(<RightPanel />);

    fireEvent.change(screen.getByTestId('section-overlap'), { target: { value: '7' } });

    expect(useDesignStore.getState().sectionOverlap).toBe(7);
    expect(screen.getByTestId('multihoop-section')).toHaveTextContent(
      'Both hoopings will sew 7 mm of every join',
    );
  });

  it('turns registration crosses on from the checkbox', () => {
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('section-marks'));

    expect(useDesignStore.getState().sectionMarks).toBe(true);
    expect(screen.getByTestId('multihoop-section')).toHaveTextContent(
      'A cross goes into each half of every join',
    );
  });

  it('shows the clamped number the export will really use', () => {
    render(<RightPanel />);

    // Out of range on the way in; the store refuses it, so the box must
    // show the refused-to-be value rather than the one typed.
    fireEvent.change(screen.getByTestId('section-overlap'), { target: { value: '-40' } });
    expect((screen.getByTestId('section-overlap') as HTMLInputElement).value).toBe('0');
    expect(useDesignStore.getState().sectionOverlap).toBe(0);
  });

  it('names Export sections as the thing these settings drive', () => {
    render(<RightPanel />);

    expect(screen.getByTestId('multihoop-section')).toHaveTextContent('Export sections');
  });

  it('does not mark the document dirty when only the join settings move', () => {
    render(<RightPanel />);

    fireEvent.change(screen.getByTestId('section-overlap'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('section-marks'));

    expect(useDesignStore.getState().dirty).toBe(false);
  });
});

describe('shape tools', () => {
  function addTwo() {
    const a = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 1);
    const b = createObject('fill', [rectangleRing(5, 0, 10, 10)], 1, 2);
    useDesignStore.getState().addObject(a);
    useDesignStore.getState().addObject(b);
    return { a, b };
  }

  it('disables the boolean buttons until two shapes are selected', () => {
    const { a } = addTwo();
    useDesignStore.setState({ selection: [a.id] });
    render(<RightPanel />);

    expect(screen.getByTestId('shape-weld')).toBeDisabled();
    expect(screen.getByTestId('shape-combine')).toBeDisabled();
    expect(screen.getByTestId('shape-subtract')).toBeDisabled();
    expect(screen.getByTestId('shape-intersect')).toBeDisabled();
    // The one-shape tools stay available.
    expect(screen.getByTestId('offset-apply')).not.toBeDisabled();
  });

  it('welds two selected shapes and reports what happened', () => {
    const { a, b } = addTwo();
    useDesignStore.setState({ selection: [a.id, b.id] });
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('shape-weld'));

    expect(useDesignStore.getState().design.objects).toHaveLength(1);
    expect(screen.getByTestId('shape-message')).toHaveTextContent('Welded');
  });

  it('creates an offset copy using the distance field', () => {
    const { a } = addTwo();
    useDesignStore.setState({ selection: [a.id] });
    render(<RightPanel />);

    fireEvent.change(screen.getByTestId('offset-distance'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('offset-apply'));

    expect(useDesignStore.getState().design.objects).toHaveLength(3);
    expect(screen.getByTestId('shape-message')).toHaveTextContent('offset');
  });

  it('creates a border run from the border field', () => {
    const { a } = addTwo();
    useDesignStore.setState({ selection: [a.id] });
    render(<RightPanel />);

    fireEvent.change(screen.getByTestId('border-distance'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('border-apply'));

    const runs = useDesignStore.getState().design.objects.filter((o) => o.type === 'run');
    expect(runs).toHaveLength(1);
  });

  it('centres everything in the hoop', () => {
    addTwo();
    render(<RightPanel />);
    useDesignStore.setState({ selection: [] });

    fireEvent.click(screen.getByTestId('center-all'));
    expect(screen.getByTestId('shape-message')).toHaveTextContent('Centred');
  });
});

describe('applique controls', () => {
  function addPatch() {
    const a = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 1);
    useDesignStore.getState().addObject(a);
    useDesignStore.setState({ selection: [a.id] });
    return a;
  }

  const stored = () => useDesignStore.getState().design.objects[0]!.params.applique;

  it('turns an ordinary fill into a patch with the standard passes', () => {
    addPatch();
    render(<RightPanel />);

    expect(screen.queryByTestId('applique-mode')).toBeNull();
    fireEvent.click(screen.getByTestId('applique-enabled'));

    expect(stored()?.enabled).toBe(true);
    expect(stored()?.placement).toBe(true);
    expect(stored()?.tack).toBe('zigzag');
    expect(stored()?.finish).toBe('satin');
    expect(stored()?.fill).toBe(false);
    expect(screen.getByTestId('applique-mode')).toHaveValue('full');
  });

  it('shows the partial-edge fields only for a partial patch', () => {
    const a = addPatch();
    useDesignStore.getState().updateParams(a.id, {
      applique: {
        enabled: true,
        mode: 'full',
        placement: true,
        tack: 'zigzag',
        tackWidth: 4,
        tackSpacing: 1,
        finish: 'satin',
        finishWidth: 4,
        finishSpacing: 0.4,
        finishOffset: 0,
        fill: false,
        start: 0,
        length: 1,
      },
    });
    render(<RightPanel />);

    expect(screen.queryByTestId('applique-start')).toBeNull();
    fireEvent.change(screen.getByTestId('applique-mode'), { target: { value: 'partial' } });

    expect(stored()?.mode).toBe('partial');
    expect(screen.getByTestId('applique-start')).toHaveValue(0);
    expect(screen.getByTestId('applique-length')).toHaveValue(100);
  });

  it('writes the finish width the generator will use', () => {
    addPatch();
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId('applique-enabled'));

    fireEvent.change(screen.getByTestId('applique-finish-width'), { target: { value: '6.5' } });

    expect(stored()?.finishWidth).toBe(6.5);
    expect(screen.getByTestId('applique-finish-width')).toHaveValue(6.5);
  });

  it('explains a width the engine would refuse', () => {
    addPatch();
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId('applique-enabled'));

    fireEvent.change(screen.getByTestId('applique-tack-width'), { target: { value: '0' } });

    expect(screen.getByTestId('applique-problem')).toHaveTextContent('Tack width');
  });

  it('keeps the settings when the patch is switched off', () => {
    addPatch();
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId('applique-enabled'));
    fireEvent.change(screen.getByTestId('applique-finish-width'), { target: { value: '7' } });

    fireEvent.click(screen.getByTestId('applique-enabled'));

    expect(stored()?.enabled).toBe(false);
    expect(stored()?.finishWidth).toBe(7);
    expect(screen.queryByTestId('applique-mode')).toBeNull();
  });
});

describe('sequencing controls', () => {
  function add(x: number, colorIndex: number, order: number) {
    const obj = createObject('fill', [rectangleRing(x, 0, 10, 10)], colorIndex, order);
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  it('is off by default and cannot reorder an empty design', () => {
    render(<RightPanel />);

    expect(screen.getByTestId('sequencing-section')).toBeInTheDocument();
    expect(screen.getByTestId('optimize-colors')).not.toBeChecked();
    expect(screen.getByTestId('auto-sequence')).toBeDisabled();
  });

  it('turns automatic thread sorting on', () => {
    add(0, 0, 0);
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('optimize-colors'));

    expect(useDesignStore.getState().optimizeColors).toBe(true);
    expect(screen.getByTestId('optimize-colors')).toBeChecked();
  });

  it('reorders the objects and says how many moved', () => {
    const a = add(0, 0, 0);
    const b = add(50, 0, 1);
    const c = add(10, 0, 2);
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('auto-sequence'));

    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([a.id, c.id, b.id]);
    expect(screen.getByTestId('sequence-message')).toHaveTextContent('Reordered 2 objects');
  });

  it('reports honestly when the order is already shortest', () => {
    add(0, 0, 0);
    add(10, 0, 1);
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('auto-sequence'));

    expect(screen.getByTestId('sequence-message')).toHaveTextContent(
      'Already in the shortest order',
    );
  });

  it('keeps the current thread first when optimise is on', () => {
    const a = add(0, 0, 0);
    const b = add(10, 1, 1);
    const c = add(50, 0, 2);
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('optimize-colors'));
    fireEvent.click(screen.getByTestId('auto-sequence'));

    expect(useDesignStore.getState().design.objects.map((o) => o.id)).toEqual([a.id, c.id, b.id]);
  });
});

describe('separate pull compensation', () => {
  function addSatin() {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 8)], 0, 1);
    useDesignStore.getState().addObject(obj);
    useDesignStore.getState().updateParams(obj.id, {
      stitchType: 'satin',
      pullCompensation: 0.4,
    });
    return obj;
  }

  const stored = () => useDesignStore.getState().design.objects[0]!.params.separatePullCompensation;

  it('stays out of the way of a plain fill', () => {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 8)], 0, 1);
    useDesignStore.getState().addObject(obj);
    render(<RightPanel />);

    expect(screen.queryByTestId('separate-pull')).toBeNull();
  });

  it('seeds both sides from the uniform value when turned on', () => {
    const obj = addSatin();
    render(<RightPanel />);

    fireEvent.click(screen.getByTestId('separate-pull'));

    expect(stored()).toEqual({ left: 0.4, right: 0.4 });
    expect(screen.getByTestId('pull-left')).toHaveValue(0.4);
    expect(screen.getByTestId('pull-right')).toHaveValue(0.4);
    expect(useDesignStore.getState().design.objects[0]!.id).toBe(obj.id);
  });

  it('writes each side independently', () => {
    addSatin();
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId('separate-pull'));

    fireEvent.change(screen.getByTestId('pull-left'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByTestId('pull-right'), { target: { value: '0.1' } });

    expect(stored()).toEqual({ left: 0.9, right: 0.1 });
  });

  it('returns to the uniform value when switched off', () => {
    addSatin();
    render(<RightPanel />);
    fireEvent.click(screen.getByTestId('separate-pull'));
    fireEvent.change(screen.getByTestId('pull-left'), { target: { value: '0.9' } });

    fireEvent.click(screen.getByTestId('separate-pull'));

    expect(stored()).toBeNull();
    expect(screen.queryByTestId('pull-left')).toBeNull();
    // The uniform value itself was not rewritten by the toggle.
    expect(useDesignStore.getState().design.objects[0]!.params.pullCompensation).toBe(0.4);
  });
});

describe('redwork controls', () => {
  function addFill() {
    const obj = createObject('fill', [rectangleRing(0, 0, 20, 20)], 0, 1);
    useDesignStore.getState().addObject(obj);
    return obj;
  }

  const stored = () => useDesignStore.getState().design.objects[0]!;

  it('cannot convert without a selection', () => {
    render(<RightPanel />);

    expect(screen.getByTestId('redwork-section')).toBeInTheDocument();
    expect(screen.getByTestId('redwork-apply')).toBeDisabled();
  });

  it('writes the chosen style and measurements', () => {
    addFill();
    render(<RightPanel />);

    fireEvent.change(screen.getByTestId('redwork-style'), { target: { value: 'stem' } });
    fireEvent.change(screen.getByTestId('redwork-width'), { target: { value: '1.6' } });
    fireEvent.change(screen.getByTestId('redwork-stitch'), { target: { value: '2.2' } });
    fireEvent.change(screen.getByTestId('redwork-color'), { target: { value: '#1a7f37' } });
    fireEvent.click(screen.getByTestId('redwork-apply'));

    expect(stored().params.redwork).toEqual({
      enabled: true,
      style: 'stem',
      widthMm: 1.6,
      stitchMm: 2.2,
    });
    const thread = useDesignStore.getState().design.threadPalette[stored().colorIndex];
    expect(thread?.hex).toBe('#1a7f37');
    expect(screen.getByTestId('redwork-message')).toHaveTextContent('Sewing 1 object as redwork');
    expect(screen.getByTestId('redwork-remove')).toBeInTheDocument();
  });

  it('offers removal only while redwork is active and restores the fill', () => {
    addFill();
    render(<RightPanel />);
    expect(screen.queryByTestId('redwork-remove')).toBeNull();

    fireEvent.click(screen.getByTestId('redwork-apply'));
    fireEvent.click(screen.getByTestId('redwork-remove'));

    expect(stored().params.redwork).toBeNull();
    expect(screen.getByTestId('redwork-message')).toHaveTextContent('Redwork removed');
    expect(screen.queryByTestId('redwork-remove')).toBeNull();
  });

  it('only enables the stem width for the stem style', () => {
    addFill();
    render(<RightPanel />);

    expect(screen.getByTestId('redwork-width')).toBeDisabled();
    fireEvent.change(screen.getByTestId('redwork-style'), { target: { value: 'stem' } });
    expect(screen.getByTestId('redwork-width')).toBeEnabled();
  });
});
