import { WB_DRAWER, type WorkbenchTarget } from './workbenchTargets';

/**
 * The drawer inside the archive that holds the `def_*.info` copies.
 *
 * Shared with `buildOutputEntries` rather than written out in both places: the script
 * copies from this drawer and the layout writes to it, and a disagreement between the
 * two shows up only on the Amiga, as an installer that quietly copies nothing.
 */
export const SYS_DRAWER = 'Sys';

/**
 * The script's filename. Workbench pairs a file with `<name>.info`, so the icon's path
 * is this plus the suffix — spaces and all, which AmigaDOS allows.
 *
 * Renamed from "Install Default Icons" when the script learned to install Workbench
 * icons too, because a name that describes half of what a script does is worse than a
 * vague one.
 */
export const INSTALLER_SCRIPT_NAME = 'Install kde2amiga Icons';

/**
 * `do_DefaultTool` for the script's icon.
 *
 * Workbench resolves a relative default tool against the drawer the icon sits in before
 * falling back to `C:`, which is what lets the bundled `Installer` beside this script run
 * it on a machine that has no Installer of its own. `SYS:System/Installer` exists on
 * 3.2.3, but it is not in `C:` and not on every machine.
 */
export const INSTALLER_DEFAULT_TOOL = 'Installer';

/** The bundled Installer 43.3 executable, shipped byte-identical per licence clause B.1. */
export const INSTALLER_BINARY_NAME = 'Installer';

/** Escom's licence, which clause B.5 requires travel with the binary. */
export const INSTALLER_LICENSE_NAME = 'Installer.license';

/** Where replaced icons are kept, below whichever drawer the user picks. */
const BACKUP_DRAWER = 'kde2amiga-backup';

export interface InstallerScriptOptions {
  /** Whether any `def_*` icon was assigned, i.e. whether `Sys/` exists in the archive. */
  hasDefaults: boolean;
  /** Assigned targets keyed by archive drawer, from `targetsByDrawer`. */
  drawers: Map<string, WorkbenchTarget[]>;
}

/**
 * Builds the Installer 43.3 script for one archive.
 *
 * Generated rather than constant because the choices it offers have to match what is
 * actually in the archive: an option to install Workbench icons, in a download that
 * contains none, copies an absent drawer and reports success.
 *
 * Kept to plain ASCII and LF endings on purpose. AmigaDOS reads ISO-8859-1, so a smart
 * quote would reach the Amiga as mojibake mid-command, and a CR would be read as part of
 * an argument rather than as whitespace. Every string below comes from the catalogue,
 * which is ASCII by construction — no user text ever reaches this file.
 */
export function buildInstallerScript(options: InstallerScriptOptions): string {
  const { hasDefaults, drawers } = options;
  const hasTargets = drawers.size > 0;

  const lines: string[] = [
    `; ${INSTALLER_SCRIPT_NAME}`,
    ';',
    '; Written by kde2amiga. Double-click the icon beside this file.',
    ';',
    '; Installer and Installer project icon',
    '; (c) Copyright 1995-96 Escom AG.  All Rights Reserved.',
    '; Reproduced and distributed under license from Escom AG.',
    '',
    `(set @app-name "${INSTALLER_SCRIPT_NAME}")`,
    '(set @default-dest "")',
    '',
  ];

  lines.push(...choiceBlock(hasDefaults, hasTargets));
  if (hasDefaults) lines.push(...defaultsBlock());
  if (hasTargets) lines.push(...targetsBlock(drawers));

  lines.push(
    '(exit "Icons installed. Anything already drawn on screen keeps its old look"',
    '      " until the next reboot.")',
    '',
  );

  return lines.join('\n');
}

function choiceBlock(hasDefaults: boolean, hasTargets: boolean): string[] {
  if (!hasTargets) return ['(set #what 1)', ''];
  if (!hasDefaults) return ['(set #what 2)', ''];

  return [
    '(set #what (askoptions',
    '  (prompt "What would you like to install?")',
    '  (help "System default icons fill in for files and drawers that have no icon"',
    '        " of their own. Workbench icons replace the icons in Prefs, Tools and the"',
    '        " other system drawers. Replaced icons are backed up first.")',
    '  (choices "System default icons (ENVARC:Sys)"',
    '           "Workbench icons")',
    '  (default 3)))',
    '',
    // Only askoptions can come back with nothing ticked. Without this the script falls
    // straight past both guards to the closing (exit ...) and reports installing icons
    // it never touched.
    '(if (= #what 0) (abort "Nothing selected, so nothing was installed."))',
    '',
  ];
}

/**
 * Named separately in the script because we cannot carry a correct value for it: the
 * SCSI device differs from machine to machine, so the icon ships with the stock name and
 * the user is told which one to check.
 *
 * Indented for, and emitted inside, the Workbench guard. Told to a user who unticked
 * "Workbench icons" it would claim stock settings were installed over changes that were
 * in fact left alone, which is worse than saying nothing.
 */
function warning(drawers: Map<string, WorkbenchTarget[]>): string[] {
  const flagged = [...drawers.values()].flat().filter((target) => target.machineSpecific);
  if (flagged.length === 0) return [];

  return [
    '    (message "One of these icons carries settings that differ between machines:\\n\\n"',
    `             "  ${flagged.map((t) => t.name).join(', ')}\\n\\n"`,
    '             "The stock settings are installed. If you had changed them, restore"',
    '             " them from the backup after installing.")',
    '',
  ];
}

function defaultsBlock(): string[] {
  return [
    // Bit 0 of the askoptions mask, and equally true of the 1 set outright when the
    // archive has no Workbench targets to offer.
    '(if (IN #what 0)',
    '  (',
    '    (makedir "ENVARC:Sys")',
    '    (makedir "ENV:Sys")',
    `    (copyfiles (source "${SYS_DRAWER}") (dest "ENVARC:Sys") (pattern "#?.info"))`,
    `    (copyfiles (source "${SYS_DRAWER}") (dest "ENV:Sys") (pattern "#?.info"))`,
    '  )',
    ')',
    '',
  ];
}

function targetsBlock(drawers: Map<string, WorkbenchTarget[]>): string[] {
  const lines = [
    '(if (IN #what 1)',
    '  (',
    ...warning(drawers),
    '    (set #backup (askdir',
    '      (prompt "Where should the icons being replaced be kept?")',
    '      (help "Every icon this replaces is copied here first, so you can put the"',
    '            " originals back.")',
    '      (default "SYS:Storage")))',
    `    (set #backup (tackon #backup "${BACKUP_DRAWER}"))`,
    '    (makedir #backup)',
    '',
  ];

  for (const [archiveDrawer, targets] of drawers) {
    // `Wb/SYS/Prefs` -> destination `SYS:Prefs`, backup subdrawer `SYS/Prefs`.
    const branch = archiveDrawer.slice(`${WB_DRAWER}/`.length);
    const [root, ...rest] = branch.split('/');
    const destination = `${root}:${rest.join('/')}`;

    lines.push(
      `    ; ${destination} (${targets.length} icon${targets.length === 1 ? '' : 's'})`,
      '    (set #here #backup)',
    );

    // One `makedir` per level rather than one for the whole branch. AmigaDOS `MakeDir`
    // does not create intermediate drawers and Installer's `makedir` is not documented
    // to either, and this is the drawer holding the only copy of the icon about to be
    // overwritten — a failure here aborts the install with the user's original gone.
    for (const level of branch.split('/')) {
      lines.push(`    (set #here (tackon #here "${level}"))`, '    (makedir #here)');
    }

    lines.push(
      `    (foreach "${archiveDrawer}" "#?.info"`,
      `      (if (exists (tackon "${destination}" @each-name))`,
      `        (copyfiles (source (tackon "${destination}" @each-name)) (dest #here))))`,
      `    (copyfiles (source "${archiveDrawer}") (dest "${destination}") (pattern "#?.info"))`,
      '',
    );
  }

  lines.push('  )', ')', '');
  return lines;
}
