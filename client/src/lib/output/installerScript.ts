import {
  archiveBranchFor,
  archiveDrawerFor,
  targetDestination,
  type WorkbenchTarget,
} from './workbenchTargets';

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
export const BACKUP_DRAWER = 'kde2amiga-backup';

/**
 * The drawer `askdir` offers first.
 *
 * Exported so the archive's README can name the whole backup path concretely. The README
 * is what someone reaches for when an install has gone wrong, on a machine with no text
 * search, and "wherever you told the installer to put it" is not an answer at that point.
 */
export const BACKUP_DEFAULT_DIR = 'SYS:Storage';

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
 * Lays out one Installer `(message ...)`, whose arguments are concatenated as written.
 *
 * The parts arrive already quoted, because each one carries its own `\\n` escapes and
 * spacing; this only decides where they sit on the page.
 */
function messageBlock(indent: string, parts: string[]): string[] {
  const pad = ' '.repeat(indent.length + '(message '.length);
  return parts.map((part, i) => {
    const head = i === 0 ? `${indent}(message ` : pad;
    return `${head}${part}${i === parts.length - 1 ? ')' : ''}`;
  });
}

/**
 * The page the user reads before anything is overwritten.
 *
 * Required by the spec: it lists the drawers about to change and names any
 * machine-specific target among them. Both live in one `(message ...)` rather than two
 * back to back, because a second requester after "Proceed" reads as a second question
 * rather than as the rest of the first answer.
 *
 * Indented for, and emitted inside, the Workbench guard, ahead of the askdir. Told to a
 * user who unticked "Workbench icons" it would claim stock settings were installed over
 * changes that were in fact left alone, which is worse than saying nothing.
 */
function confirmationPage(drawers: Map<string, WorkbenchTarget[]>): string[] {
  const parts = ['"These Workbench drawers are about to change:\\n\\n"'];

  for (const targets of drawers.values()) {
    const count = `${targets.length} icon${targets.length === 1 ? '' : 's'}`;
    parts.push(`"  ${targetDestination(targets[0])}  (${count})\\n"`);
  }

  parts.push(
    '"\\nEach icon replaced is copied to the backup drawer you pick on the next"',
    '" page, so you can put the originals back.\\n\\n"',
    // Nothing in the archive can carry these across: the Installer cannot read the
    // coordinates out of the icon it is about to overwrite, so the user is told instead
    // of being left to find a scrambled Prefs drawer and wonder what else broke.
    '"Replaced icons lose their positions in the drawer, and replaced drawers lose"',
    '" their window size and position. Re-arrange them and use Icons/Snapshot once"',
    '" you are happy.\\n"',
  );

  const flagged = [...drawers.values()].flat().filter((target) => target.machineSpecific);
  if (flagged.length > 0) {
    parts.push(
      '"\\nThese icons carry settings that differ between machines:\\n\\n"',
      `"  ${flagged.map((t) => t.name).join(', ')}\\n\\n"`,
      '"The stock settings are installed. If you had changed them, restore them from"',
      '" the backup after installing.\\n"',
    );
  }

  return [...messageBlock('    ', parts), ''];
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
    ...confirmationPage(drawers),
    '    (set #backup (askdir',
    '      (prompt "Where should the icons being replaced be kept?"',
    // askdir asks for a parent but hands back a drawer inside it, so say so: aimed at an
    // existing drawer, the originals are not where the user just pointed.
    `            "\\n\\nA new drawer called ${BACKUP_DRAWER} will be created here.")`,
    '      (help "Every icon this replaces is copied here first, so you can put the"',
    '            " originals back.")',
    `      (default "${BACKUP_DEFAULT_DIR}")))`,
    `    (set #backup (tackon #backup "${BACKUP_DRAWER}"))`,
    '    (makedir #backup)',
    '',
  ];

  // Every target in a group shares a root and a drawer — that pair is what the group was
  // keyed on — so the first one speaks for all of them. Both paths are read off the
  // catalogue rather than sliced back out of the archive path: the destination is what
  // the catalogue states, and re-deriving it would give the same string two owners.
  for (const targets of drawers.values()) {
    const destination = targetDestination(targets[0]);
    const archiveDrawer = archiveDrawerFor(targets[0]);

    lines.push(
      `    ; ${destination} (${targets.length} icon${targets.length === 1 ? '' : 's'})`,
      '    (set #here #backup)',
    );

    // One `makedir` per level rather than one for the whole branch. AmigaDOS `MakeDir`
    // does not create intermediate drawers and Installer's `makedir` is not documented
    // to either, and this is the drawer holding the only copy of the icon about to be
    // overwritten — a failure here aborts the install with the user's original gone.
    for (const level of archiveBranchFor(targets[0])) {
      lines.push(`    (set #here (tackon #here "${level}"))`, '    (makedir #here)');
    }

    lines.push(
      // The second condition is what makes a re-run safe. `copyfiles` overwrites without
      // asking, so backing up whenever the destination exists means run 2 finds run 1's
      // icon at that path and copies it over the stock original — which is then gone from
      // the machine entirely, with the backup drawer still looking like it worked. A
      // second theme, a retry after an abort, or adding one more drawer all do it.
      `    (foreach "${archiveDrawer}" "#?.info"`,
      `      (if (AND (exists (tackon "${destination}" @each-name))`,
      '               (NOT (exists (tackon #here @each-name))))',
      `        (copyfiles (source (tackon "${destination}" @each-name)) (dest #here))))`,
      `    (copyfiles (source "${archiveDrawer}") (dest "${destination}") (pattern "#?.info"))`,
      '',
    );
  }

  lines.push('  )', ')', '');
  return lines;
}
