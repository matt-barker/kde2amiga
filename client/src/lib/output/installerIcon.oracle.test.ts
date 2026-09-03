// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInstallerIcon, INSTALLER_ICON_SIZE } from './installerIcon';

/**
 * Reads the installer icon back with ImageMagick's `wbinfo` coder — a decoder written by
 * someone else, from the format documentation rather than from our encoder.
 *
 * It earns its place because of what `defaultTool` does to the file. The DefaultTool
 * string is inserted between the images and the ToolTypes array, so getting its position
 * or its length prefix wrong leaves every later offset adrift: a reader would take the
 * string's length field for the ToolTypes count and find no `IM1=` lines at all. Our own
 * decoder is a port of one reference and shares our assumptions; this one does not, and
 * a NewIcons frame appearing here is proof the ToolTypes were still found after it.
 *
 * Not a substitute for the A1200 — AmigaOS is stricter than either decoder — but it
 * catches the whole class of offset bug without one.
 */
const MAGICK = '/usr/bin/magick';

function frames(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'kde2amiga-installer-'));
  const path = join(dir, 'installer.info');
  writeFileSync(path, buildInstallerIcon());
  return execFileSync(MAGICK, ['identify', '-format', '%w %h %k\\n', path], { encoding: 'utf8' })
    .trim()
    .split('\n');
}

describe('the installer icon, read by ImageMagick', () => {
  beforeAll(() => {
    if (!existsSync(MAGICK)) {
      throw new Error(`${MAGICK} not found; install ImageMagick rather than skipping.`);
    }
  });

  /**
   * Four: the 1-bit classic pair icon.library falls back to, then the NewIcons pair
   * carried in the ToolTypes. Only the last two can be reached past the DefaultTool.
   */
  it('finds both the classic and the NewIcons image pairs', () => {
    expect(frames()).toHaveLength(4);
  });

  it('reads every frame at the size the glyph is drawn', () => {
    for (const frame of frames()) {
      const [width, height] = frame.split(' ');
      expect([width, height]).toEqual([`${INSTALLER_ICON_SIZE}`, `${INSTALLER_ICON_SIZE}`]);
    }
  });

  /**
   * The classic pair is a single bitplane and comes back flat; the NewIcons pair carries
   * the real artwork. NewIcons frames that came back flat too would mean ImageMagick had
   * found no usable ToolTypes past the DefaultTool and fallen through to the planar image.
   */
  it('reads the NewIcons frames in colour, not as the flat planar fallback', () => {
    const [classicNormal, classicSelected, normal, selected] = frames().map((frame) =>
      Number(frame.split(' ')[2]),
    );

    expect(classicNormal).toBeLessThanOrEqual(2);
    expect(classicSelected).toBeLessThanOrEqual(2);
    expect(normal).toBeGreaterThan(2);
    // Both states index one shared palette, so a third-party reader has to see the same
    // number of colours in each. A mismatch would mean the two states had drifted apart.
    expect(selected).toBe(normal);
  });
});
