import type { IconKind } from '../newicons/diskObject';

/**
 * A named icon in the Workbench tree that a converted icon can replace.
 *
 * Every field below was read from the corresponding `.info` on an AmigaOS 3.2.3 install
 * rather than inferred from the file's name, because the names lie: `SYS:System/Shell`
 * looks like a tool and is a project icon whose default tool is the only thing that makes
 * it work, and there is no `Shell` executable on disk at all.
 */
export interface WorkbenchTarget {
  /** The assign this branch hangs off, colon included. */
  root: string;
  /** Path below the root; '' would mean the root drawer itself. */
  drawer: string;
  /** The file whose `.info` is replaced, without the suffix. */
  name: string;
  /** The type byte the replacement must carry. */
  kind: IconKind;
  /**
   * `do_DefaultTool` the replacement must keep.
   *
   * Only project icons have one. Dropping it does not degrade the icon, it disables it:
   * a project icon with no default tool has nothing to run.
   */
  defaultTool?: string;
  /**
   * Live ToolTypes the replacement must keep, verbatim and in order.
   *
   * Bracketed entries such as `(PUBSCREEN=<public screen name>)` are documentation shown
   * in the Information window, not settings, and are deliberately not carried.
   */
  toolTypes?: readonly string[];
  /**
   * Set when a carried value differs between machines, so the installer can say so.
   *
   * Only `SYS:Tools/HDToolBox`, whose `SCSI_DEVICE_NAME` names the actual controller.
   */
  machineSpecific?: true;
  /** Short gloss for the dropdown; the optgroup already carries the drawer. */
  description: string;
}

/** A target's identity: `SYS:Prefs/Font`. Stored in assignments, shown in errors. */
export type WorkbenchTargetPath = string;

export function targetPath(target: WorkbenchTarget): WorkbenchTargetPath {
  return `${target.root}${target.drawer}/${target.name}`;
}

/**
 * The drawer inside the archive that mirrors the Workbench tree.
 *
 * Shared with `buildOutputEntries` and the script generator rather than written out in
 * each: the layout writes to it and the script copies from it, and a disagreement shows
 * up only on the Amiga, as an installer that quietly copies nothing.
 */
export const WB_DRAWER = 'Wb';

/** The drawer inside the archive holding this target's replacement icon. */
export function archiveDrawerFor(target: WorkbenchTarget): string {
  // The colon is illegal in zip and LHA paths on most hosts, so the root loses it here
  // and the generated Installer script puts it back.
  return `${WB_DRAWER}/${target.root.replace(':', '')}/${target.drawer}`;
}

/**
 * Every target we offer, in the order the UI lists them.
 *
 * The list of files comes from `docs/icons_locations/`; the kinds and metadata were read
 * from those files' own `.info`s on a 3.2.3 install. Offering a target the installed OS
 * does not have would write an icon nothing ever draws, which looks like success and is
 * not — the same trap `defaultIconSlots` records.
 */
export const WORKBENCH_TARGETS: readonly WorkbenchTarget[] = [

  // Prefs
  { root: 'SYS:', drawer: 'Prefs', name: 'Asl', kind: 'tool', description: 'File requester' },
  { root: 'SYS:', drawer: 'Prefs', name: 'DefaultIcons', kind: 'tool', description: 'DefIcons settings' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Font', kind: 'tool', description: 'System fonts' },
  { root: 'SYS:', drawer: 'Prefs', name: 'IControl', kind: 'tool', description: 'Interface behaviour' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Input', kind: 'tool', description: 'Keyboard and mouse' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Locale', kind: 'tool', description: 'Language and country' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Overscan', kind: 'tool', description: 'Display overscan' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Palette', kind: 'tool', description: 'Workbench colours' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Pointer', kind: 'tool', toolTypes: ['NOREMAP'], description: 'Mouse pointer' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Presets', kind: 'drawer', description: 'Saved preference presets' },
  { root: 'SYS:', drawer: 'Prefs', name: 'PrinterGfx', kind: 'tool', description: 'Printer graphics' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Printer', kind: 'tool', description: 'Printer' },
  { root: 'SYS:', drawer: 'Prefs', name: 'PrinterPS', kind: 'tool', description: 'PostScript printer' },
  { root: 'SYS:', drawer: 'Prefs', name: 'ReAction', kind: 'tool', description: 'ReAction GUI' },
  { root: 'SYS:', drawer: 'Prefs', name: 'ScreenMode', kind: 'tool', description: 'Screen mode' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Serial', kind: 'tool', description: 'Serial port' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Sound', kind: 'tool', description: 'System sounds' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Time', kind: 'tool', description: 'Clock and date' },
  { root: 'SYS:', drawer: 'Prefs', name: 'WBPattern', kind: 'tool', description: 'Workbench backdrop' },
  { root: 'SYS:', drawer: 'Prefs', name: 'Workbench', kind: 'tool', description: 'Workbench behaviour' },

  // System
  { root: 'SYS:', drawer: 'System', name: 'Find', kind: 'tool', description: 'File search' },
  { root: 'SYS:', drawer: 'System', name: 'FixFonts', kind: 'tool', description: 'Font list rebuild' },
  { root: 'SYS:', drawer: 'System', name: 'Format', kind: 'tool', toolTypes: ['TRASHCAN=YES'], description: 'Disk formatting' },
  { root: 'SYS:', drawer: 'System', name: 'Help', kind: 'project', defaultTool: 'C:IconX', description: 'AmigaGuide help' },
  { root: 'SYS:', drawer: 'System', name: 'Intellifont', kind: 'tool', description: 'Outline font installer' },
  { root: 'SYS:', drawer: 'System', name: 'Mounter', kind: 'tool', toolTypes: ['DEVICE=scsi.device', 'DONOTWAIT'], description: 'Device mounting' },
  { root: 'SYS:', drawer: 'System', name: 'NoFastMem', kind: 'tool', description: 'Fast RAM disable' },
  { root: 'SYS:', drawer: 'System', name: 'RexxMast', kind: 'tool', toolTypes: ['DONOTWAIT'], description: 'ARexx server' },
  { root: 'SYS:', drawer: 'System', name: 'Shell', kind: 'project', defaultTool: 'SYS:System/CLI', toolTypes: ['WINDOW=CON:0///130/AmigaShell/CLOSE/ICONIFY', 'STACK=4096', 'FROM=S:Shell-Startup'], description: 'AmigaShell' },

  // Tools
  { root: 'SYS:', drawer: 'Tools', name: 'Calculator', kind: 'tool', description: 'Calculator' },
  { root: 'SYS:', drawer: 'Tools', name: 'CMD', kind: 'tool', toolTypes: ['DEVICE=parallel', 'FILE=ram:CMD_file', 'SKIP=FALSE', 'MULTIPLE=FALSE', 'NOTIFY=FALSE'], description: 'Printer-to-file redirection' },
  { root: 'SYS:', drawer: 'Tools', name: 'Commodities', kind: 'drawer', description: 'Commodities drawer' },
  { root: 'SYS:', drawer: 'Tools', name: 'GraphicDump', kind: 'tool', description: 'Screen dump to printer' },
  { root: 'SYS:', drawer: 'Tools', name: 'HDToolBox', kind: 'tool', toolTypes: ['SCSI_DEVICE_NAME=scsi.device', 'SCSI_MAX_ADDRESS=6', 'SCSI_MAX_LUN=7', 'XT_NAME=  XT'], machineSpecific: true, description: 'Hard disk partitioning' },
  { root: 'SYS:', drawer: 'Tools', name: 'IconEdit', kind: 'tool', description: 'Icon editor' },
  { root: 'SYS:', drawer: 'Tools', name: 'InitPrinter', kind: 'tool', description: 'Printer initialisation' },
  { root: 'SYS:', drawer: 'Tools', name: 'KeyShow', kind: 'tool', description: 'Keyboard map viewer' },
  { root: 'SYS:', drawer: 'Tools', name: 'PrepCard', kind: 'tool', description: 'PCMCIA card setup' },
  { root: 'SYS:', drawer: 'Tools', name: 'PrintFiles', kind: 'tool', description: 'Print a file' },
  { root: 'SYS:', drawer: 'Tools', name: 'ShowConfig', kind: 'tool', description: 'Hardware summary' },
  { root: 'SYS:', drawer: 'Tools', name: 'TextEdit', kind: 'tool', description: 'Text editor' },

  // Utilities
  { root: 'SYS:', drawer: 'Utilities', name: 'Clock', kind: 'tool', toolTypes: ['DONOTWAIT', 'SECONDS', 'DATE', 'LEFT=0', 'TOP=0', 'FORMAT=0'], description: 'Clock' },
  { root: 'SYS:', drawer: 'Utilities', name: 'MultiView', kind: 'tool', description: 'Multi-format file viewer' },

  // WBStartup
  { root: 'SYS:', drawer: 'WBStartup', name: 'AssignWedge', kind: 'tool', toolTypes: ['STARTPRI=30', 'DONOTWAIT'], description: 'Missing-assign requester' },
  { root: 'SYS:', drawer: 'WBStartup', name: 'AsyncWB', kind: 'tool', toolTypes: ['DONOTWAIT', 'NOHISTORY'], description: 'Asynchronous Workbench' },
  { root: 'SYS:', drawer: 'WBStartup', name: 'AutoArrangeIcons', kind: 'tool', toolTypes: ['REXX', 'DONOTPROMPT', 'DONOTWAIT'], description: 'Icon auto-arrange' },
  { root: 'SYS:', drawer: 'WBStartup', name: 'DefIcons', kind: 'tool', toolTypes: ['DONOTWAIT'], description: 'Default icons by datatype' },
  { root: 'SYS:', drawer: 'WBStartup', name: 'MenuTools', kind: 'tool', toolTypes: ['REXX', 'DONOTPROMPT', 'STARTPRI=-1', 'DONOTWAIT'], description: 'Workbench tools menu' },
  { root: 'SYS:', drawer: 'WBStartup', name: 'RAWBInfo', kind: 'tool', toolTypes: ['DONOTWAIT'], description: 'Replacement Information window' },
];

const BY_PATH = new Map<WorkbenchTargetPath, WorkbenchTarget>(
  WORKBENCH_TARGETS.map((target) => [targetPath(target), target]),
);

/**
 * Throws rather than returning undefined, for the reason `slotForRole` does: every
 * caller holds a path that came out of the catalogue and would only go on to read
 * `.kind` off nothing. An unknown path means a stale assignment, and failing loudly
 * beats writing an icon into a drawer that does not exist.
 */
export function targetForPath(path: WorkbenchTargetPath): WorkbenchTarget {
  const target = BY_PATH.get(path);
  if (!target) throw new Error(`Not a Workbench target: ${path}`);
  return target;
}

/**
 * Groups assigned paths by the archive drawer they land in.
 *
 * Iterates the catalogue rather than the argument so the result is in catalogue order
 * whatever order the assignments arrived in — the generated script is compared against
 * expectations in tests, and a script whose blocks reorder with the user's clicking is
 * not something anyone can review.
 */
export function targetsByDrawer(
  paths: Iterable<WorkbenchTargetPath>,
): Map<string, WorkbenchTarget[]> {
  const wanted = new Set(paths);
  const grouped = new Map<string, WorkbenchTarget[]>();

  for (const target of WORKBENCH_TARGETS) {
    if (!wanted.has(targetPath(target))) continue;
    const drawer = archiveDrawerFor(target);
    const existing = grouped.get(drawer);
    if (existing) existing.push(target);
    else grouped.set(drawer, [target]);
  }

  return grouped;
}
