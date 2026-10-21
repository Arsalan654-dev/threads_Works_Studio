import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageTraceDialog } from './ImageTraceDialog.js';
import { useDesignStore } from '../store/designStore.js';
import { referenceStore } from '../store/referenceStore.js';
import { decodeImageAsset } from '../image/decodeImage.js';

vi.mock('../image/decodeImage.js', () => ({
  decodeImageAsset: vi.fn(),
}));

function sourceImage() {
  const width = 20;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const left = x < 10;
      data[o] = left ? 220 : 30;
      data[o + 1] = left ? 30 : 60;
      data[o + 2] = left ? 40 : 200;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

beforeEach(() => {
  referenceStore.setState({ settings: null });
  useDesignStore.getState().newDesign();
  vi.mocked(decodeImageAsset).mockResolvedValue({
    raster: sourceImage(),
    dataUrl: 'data:image/png;base64,AAAA',
    name: 'shirt.png',
    width: 20,
    height: 10,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function pickImage(): Promise<void> {
  const input = screen.getByTestId('trace-file');
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array([1])], 'shirt.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(screen.getByTestId('trace-choice')).toBeTruthy());
}

describe('image to embroidery dialog', () => {
  it('asks whether to auto-generate, then asks for the finished size', async () => {
    const notify = vi.fn();
    render(<ImageTraceDialog onClose={() => {}} notify={notify} />);
    await pickImage();

    // The clear source image is shown, not a quantized mesh.
    expect(screen.getByTestId('trace-preview')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    // No decision means no action.
    expect(screen.getByTestId('trace-apply')).toBeDisabled();

    fireEvent.click(screen.getByTestId('trace-auto-yes'));

    expect(screen.getByTestId('trace-width')).toBeInTheDocument();
    expect(screen.getByTestId('trace-height')).toBeInTheDocument();
    expect(screen.getByTestId('trace-apply')).toBeEnabled();
  });

  it('auto-stitches the picture in its colours and keeps the source as a guide', async () => {
    const notify = vi.fn();
    const onClose = vi.fn();
    render(<ImageTraceDialog onClose={onClose} notify={notify} />);
    await pickImage();

    fireEvent.click(screen.getByTestId('trace-auto-yes'));
    fireEvent.change(screen.getByTestId('trace-width'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('trace-apply'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Auto-stitched'));

    const design = useDesignStore.getState().design;
    expect(design.objects.length).toBeGreaterThan(0);
    expect(design.threadPalette.length).toBeGreaterThan(1);
    expect(design.referenceImage?.name).toBe('shirt.png');
    expect(design.referenceImage?.visible).toBe(true);
    // The generated art and the guide occupy the same box.
    expect(design.referenceImage?.width).toBeCloseTo(40, 1);
  });

  it('places a clear tracing guide without creating stitches', async () => {
    const notify = vi.fn();
    const onClose = vi.fn();
    render(<ImageTraceDialog onClose={onClose} notify={notify} />);
    await pickImage();

    fireEvent.click(screen.getByTestId('trace-auto-no'));
    fireEvent.change(screen.getByTestId('trace-width'), { target: { value: '60' } });
    fireEvent.click(screen.getByTestId('trace-apply'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Reference image placed'));

    const design = useDesignStore.getState().design;
    expect(design.objects).toHaveLength(0);
    expect(design.referenceImage?.name).toBe('shirt.png');
    expect(design.referenceImage?.width).toBeCloseTo(60, 1);
    expect(design.referenceImage?.height).toBeCloseTo(30, 1);
    expect(design.referenceImage?.opacity).toBeGreaterThan(0.5);
  });
});
