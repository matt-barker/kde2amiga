import JSZip from 'jszip';
import { buildOutputEntries, type ConvertedIcon } from './outputEntries';

export type { ConvertedIcon } from './outputEntries';

export async function buildOutputZip(icons: ConvertedIcon[]): Promise<Blob> {
  const zip = new JSZip();

  for (const entry of buildOutputEntries(icons)) {
    zip.file(entry.path, entry.bytes);
  }

  return zip.generateAsync({ type: 'blob' });
}
