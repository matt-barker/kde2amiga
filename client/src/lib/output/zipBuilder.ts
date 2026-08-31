import JSZip from 'jszip';

/**
 * The five AmigaOS default-icon fallback slots (`ENVARC:Sys/def_*.info`).
 * Deliberately NOT `IconKind` from ../newicons/diskObject: that type models the
 * DiskObject type byte, which has eight legal values (device, kickstart and
 * appicon besides these five). The two sets coincide today but mean different
 * things, and widening IconKind must not widen this.
 */
export type DefaultIconRole = 'drawer' | 'disk' | 'tool' | 'project' | 'trashcan';

export interface ConvertedIcon {
  name: string;
  infoBytes: Uint8Array;
  role?: DefaultIconRole;
}

const README_TEXT = `kde2amiga converted icons
==========================

Each <name>.info file can be copied next to its matching drawer/file on your
Amiga and used immediately.

If any icons here were tagged as system-wide defaults, they're under Sys/
(e.g. Sys/def_drawer.info). To make them take effect immediately, copy the
contents of Sys/ to BOTH of these locations:

  ENVARC:Sys/   (persists across reboots)
  ENV:Sys/      (the live copy Workbench and Directory Opus 5 read right now)

Copying to ENVARC:Sys/ alone will only take effect after your next reboot.
`;

export async function buildOutputZip(icons: ConvertedIcon[]): Promise<Blob> {
  const zip = new JSZip();

  for (const icon of icons) {
    zip.file(`${icon.name}.info`, icon.infoBytes);
    if (icon.role) {
      zip.file(`Sys/def_${icon.role}.info`, icon.infoBytes);
    }
  }

  zip.file('README.txt', README_TEXT);

  return zip.generateAsync({ type: 'blob' });
}
