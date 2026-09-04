import { describe, it, expect } from 'vitest';
import {
  WORKBENCH_TARGETS,
  archiveBranchFor,
  archiveDrawerFor,
  targetDestination,
  targetForPath,
  targetPath,
  targetsByDrawer,
  type WorkbenchTarget,
} from './workbenchTargets';

describe('WORKBENCH_TARGETS', () => {
  it('covers every drawer in docs/icons_locations', () => {
    expect(new Set(WORKBENCH_TARGETS.map((t) => t.drawer))).toEqual(
      new Set(['Prefs', 'System', 'Tools', 'Utilities', 'WBStartup']),
    );
    expect(WORKBENCH_TARGETS).toHaveLength(49);
  });

  it('gives every target a unique path', () => {
    const paths = WORKBENCH_TARGETS.map(targetPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  /**
   * These four were read off the .info files on a 3.2.3 install, and two of them
   * contradict what the name suggests: Shell and Help are project icons, not tools.
   * Guessing them from the name is exactly the mistake this catalogue exists to avoid,
   * so the corrections are pinned rather than trusted to stay put.
   */
  it('takes each type byte from the real icon rather than the name', () => {
    expect(targetForPath('SYS:System/Shell').kind).toBe('project');
    expect(targetForPath('SYS:System/Help').kind).toBe('project');
    expect(targetForPath('SYS:Prefs/Presets').kind).toBe('drawer');
    expect(targetForPath('SYS:Tools/Commodities').kind).toBe('drawer');
  });

  /**
   * A project icon is nothing without its default tool: there is no `Shell` executable
   * at all on a 3.2.3 install, so this string is the entire reason double-clicking the
   * icon opens a shell.
   */
  it('keeps the default tool and arguments that make Shell work', () => {
    const shell = targetForPath('SYS:System/Shell');
    expect(shell.defaultTool).toBe('SYS:System/CLI');
    expect(shell.toolTypes).toEqual([
      'WINDOW=CON:0///130/AmigaShell/CLOSE/ICONIFY',
      'STACK=4096',
      'FROM=S:Shell-Startup',
    ]);
  });

  it('keeps DONOTWAIT on every WBStartup target, so Workbench does not block on them', () => {
    const startup = WORKBENCH_TARGETS.filter((t) => t.drawer === 'WBStartup');
    expect(startup).toHaveLength(6);
    for (const target of startup) {
      expect(target.toolTypes).toContain('DONOTWAIT');
    }
  });

  /**
   * The emulated machine reports uaehf.device here. Carrying that would be wrong on
   * every real Amiga, so the stock value is carried and the target is flagged instead.
   */
  it('carries the stock SCSI device for HDToolBox, and flags it as machine-specific', () => {
    const hd = targetForPath('SYS:Tools/HDToolBox');
    expect(hd.toolTypes?.[0]).toBe('SCSI_DEVICE_NAME=scsi.device');
    expect(hd.machineSpecific).toBe(true);
    expect(WORKBENCH_TARGETS.filter((t) => t.machineSpecific)).toHaveLength(1);
  });

  it('carries no bracketed documentation ToolTypes', () => {
    for (const target of WORKBENCH_TARGETS) {
      for (const toolType of target.toolTypes ?? []) {
        expect(toolType.trimStart().startsWith('(')).toBe(false);
      }
    }
  });

  it('throws on a path that is not in the catalogue', () => {
    expect(() => targetForPath('SYS:Prefs/Nonsense')).toThrow(/not a Workbench target/i);
  });

  it('maps a target to the drawer it occupies inside the archive', () => {
    expect(archiveDrawerFor(targetForPath('SYS:Prefs/Font'))).toBe('Wb/SYS/Prefs');
  });

  it('names the Amiga drawer a replacement is copied into', () => {
    expect(targetDestination(targetForPath('SYS:Prefs/Font'))).toBe('SYS:Prefs');
  });

  /**
   * `drawer: ''` is what the interface offers for a target sitting in the root drawer,
   * and nothing in the catalogue uses it yet — so it was quietly broken everywhere:
   * `SYS:/Name` for the path, a trailing slash on the archive drawer, and a `makedir` of
   * the empty string in the generated script. A promise the interface makes is either
   * kept or withdrawn.
   */
  it('handles a target in a root drawer, which the interface says is allowed', () => {
    const target: WorkbenchTarget = {
      root: 'SYS:',
      drawer: '',
      name: 'Disk',
      kind: 'project',
      description: 'The volume icon itself',
    };

    expect(targetPath(target)).toBe('SYS:Disk');
    expect(targetDestination(target)).toBe('SYS:');
    expect(archiveBranchFor(target)).toEqual(['SYS']);
    expect(archiveDrawerFor(target)).toBe('Wb/SYS');
  });

  it('groups selected paths by archive drawer, in catalogue order', () => {
    const grouped = targetsByDrawer([
      'SYS:WBStartup/DefIcons',
      'SYS:Prefs/Font',
      'SYS:Prefs/Asl',
    ]);

    expect([...grouped.keys()]).toEqual(['Wb/SYS/Prefs', 'Wb/SYS/WBStartup']);
    expect(grouped.get('Wb/SYS/Prefs')?.map((t) => t.name)).toEqual(['Asl', 'Font']);
  });
});
