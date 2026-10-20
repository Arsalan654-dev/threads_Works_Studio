import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toolbar } from './Toolbar.js';
import { useDesignStore } from '../store/designStore.js';
import { createObject, rectangleRing } from '../model/defaults.js';

beforeEach(() => {
  useDesignStore.getState().newDesign();
  useDesignStore.setState({ continuingId: null, tool: 'select', selection: [] });
});

describe('Continue Digitizing', () => {
  it('is disabled until exactly one object is selected', () => {
    render(<Toolbar />);
    expect(screen.getByTestId('continue-digitizing')).toBeDisabled();

    const first = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 0);
    const second = createObject('fill', [rectangleRing(20, 0, 10, 10)], 0, 1);
    useDesignStore.getState().addObject(first);
    useDesignStore.getState().addObject(second);
    useDesignStore.getState().setSelection([first.id, second.id]);

    expect(screen.getByTestId('continue-digitizing')).toBeDisabled();
  });

  it('starts resuming the selected outline', () => {
    const object = createObject('fill', [rectangleRing(0, 0, 10, 10)], 0, 0);
    useDesignStore.getState().addObject(object);
    render(<Toolbar />);

    fireEvent.click(screen.getByTestId('continue-digitizing'));

    expect(useDesignStore.getState().continuingId).toBe(object.id);
    expect(useDesignStore.getState().tool).toBe('complexFill');
    expect(screen.getByTestId('continue-digitizing')).toBeDisabled();
    expect(screen.getByTestId('continue-digitizing')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Resuming the outline/)).toBeInTheDocument();
  });

  it('shows the normal tool hint when not resuming', () => {
    render(<Toolbar />);
    expect(screen.getByText(/Click to select/)).toBeInTheDocument();
  });
});
