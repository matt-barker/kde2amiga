import { describe, it, expect } from 'vitest';
import { buildInstallerIcon, INSTALLER_ICON_SIZE } from './installerIcon';
import { decodeInfoFileForTest } from '../newicons/diskObjectDecoderForTest';
import { INSTALLER_SCRIPT_NAME } from './installerScript';

const decoded = () => decodeInfoFileForTest(buildInstallerIcon());

describe('buildInstallerIcon', () => {
  it('is a project icon, so Workbench runs its default tool on the file beside it', () => {
    expect(decoded().type).toBe(4);
  });

  it('carries Installer as its default tool, so double-clicking runs the script', () => {
    expect(decoded().defaultTool).toBe('Installer');
  });

  it('names the application, so the Installer window is not titled "Unnamed"', () => {
    expect(decoded().toolTypes[0]).toBe(`APPNAME=${INSTALLER_SCRIPT_NAME}`);
  });

  it('is square, at the size the glyph is drawn', () => {
    expect(decoded().width).toBe(INSTALLER_ICON_SIZE);
    expect(decoded().height).toBe(INSTALLER_ICON_SIZE);
    expect(decoded().normal.pixels.length).toBe(INSTALLER_ICON_SIZE ** 2);
  });

  /**
   * A NewIcons `.info` carries a palette per image state, but the rest of the pipeline
   * gives both states one shared palette (see `prepareIcon`) because that is what has
   * been verified on hardware. The installer icon is built by hand rather than through
   * that pipeline, so it has to be held to the same rule deliberately.
   */
  it('gives both states the same palette', () => {
    const icon = decoded();
    expect(icon.selected.palette).toEqual(icon.normal.palette);
  });

  it('draws something, rather than a blank canvas', () => {
    const drawn = new Set(decoded().normal.pixels.filter((index) => index !== 0));
    expect(drawn.size).toBeGreaterThan(1);
  });

  /**
   * Index 0 is the transparency hole. An icon whose corners are opaque wears a square
   * backdrop on the Workbench screen.
   */
  it('leaves its corners transparent', () => {
    const { pixels } = decoded().normal;
    const size = INSTALLER_ICON_SIZE;
    for (const corner of [0, size - 1, size * (size - 1), size * size - 1]) {
      expect(pixels[corner]).toBe(0);
    }
  });

  /**
   * The selected state has to be visibly different or the icon looks dead when clicked.
   * This glyph is hand-authored with its own pre-inverted palette rather than run through
   * the conversion pipeline, so it does not track whichever effect the job config picks.
   */
  it('shows an inverted selected state over the same shape', () => {
    const icon = decoded();
    const palette = icon.normal.palette;

    expect(icon.selected.pixels).not.toEqual(icon.normal.pixels);

    for (let i = 0; i < icon.normal.pixels.length; i++) {
      const normalIndex = icon.normal.pixels[i];
      if (normalIndex === 0) {
        // Transparency must stay transparent: an inverted hole is an opaque blob.
        expect(icon.selected.pixels[i]).toBe(0);
        continue;
      }
      const [r, g, b] = palette[normalIndex];
      expect(palette[icon.selected.pixels[i]]).toEqual([255 - r, 255 - g, 255 - b]);
    }
  });
});
