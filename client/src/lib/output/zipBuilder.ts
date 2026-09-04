import JSZip from 'jszip';
import { buildOutputEntries, type ConvertedIcon, type OutputOptions } from './outputEntries';

export type { ConvertedIcon } from './outputEntries';

export async function buildOutputZip(
  icons: ConvertedIcon[],
  options?: OutputOptions,
): Promise<Blob> {
  const zip = new JSZip();

  for (const entry of buildOutputEntries(icons, options)) {
    zip.file(entry.path, entry.bytes);
  }

  return zip.generateAsync({ type: 'blob' });
}
