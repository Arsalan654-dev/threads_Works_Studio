import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhotoStitchDialog } from './PhotoStitchDialog.js';
import { useDesignStore } from '../store/designStore.js';
import { decodeImageAsset } from '../image/decodeImage.js';

vi.mock('../image/decodeImage.js', () => ({
  decodeImageAsset: vi.fn(),
}));

/** Two solid colour blocks side by side, 20 x 10 pixels. */
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
  useDesignStore.getState().newDesign();
  vi.mocked(decodeImageAsset).mockResolvedValue({
    raster: sourceImage(),
    dataUrl: 'data:image/png;base64,AAAA',
    name: 'photo.png',
    width: 20,
    height: 10,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function pickImage(): Promise<void> {
  fireEvent.change(screen.getByTestId('photo-file'), {
    target: { files: [new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(screen.getByTestId('photo-apply')).toBeEnabled());
}

describe('photo stitch dialog', () => {
  it('keeps the source behind the mosaic by default', async () => {
    const notify = vi.fn();
    const onClose = vi.fn();
    render(<PhotoStitchDialog onClose={onClose} notify={notify} />);
    await pickImage();

    fireEvent.click(screen.getByTestId('photo-apply'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const design = useDesignStore.getState().design;
    expect(design.objects.length).toBeGreaterThan(0);
    expect(design.referenceImage?.name).toBe('photo.png');
    expect(design.referenceImage?.opacity).toBeCloseTo(0.28);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('source is kept'));
  });

  it('can replace the design without keeping a guide', async () => {
    const notify = vi.fn();
    const onClose = vi.fn();
    render(<PhotoStitchDialog onClose={onClose} notify={notify} />);
    await pickImage();

    fireEvent.click(screen.getByTestId('photo-keep-reference'));
    fireEvent.click(screen.getByTestId('photo-apply'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useDesignStore.getState().design.referenceImage).toBeNull();
  });
});
