import { buildOutputEntries, type ConvertedIcon, type OutputOptions } from './outputEntries';
import { buildLhaArchive } from './lha/lhaWriter';

/**
 * Packs the converted icons as an LHA archive.
 *
 * LHA rather than only zip because AmigaOS has no unzip in the box, while LhA is on
 * essentially every Amiga and Directory Opus 5 reads it directly — so this is the
 * archive that can be unpacked on the target without fetching a tool first.
 */
export function buildOutputLha(icons: ConvertedIcon[], options?: OutputOptions): Blob {
  const archive = buildLhaArchive(buildOutputEntries(icons, options));
  return new Blob([archive as BlobPart], { type: 'application/x-lzh-compressed' });
}
