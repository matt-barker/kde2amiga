import { describe, it, expect } from 'vitest';
import { buildInstallerScript, INSTALLER_SCRIPT_NAME } from './installerScript';
import { targetsByDrawer } from './workbenchTargets';

const script = (paths: string[], hasDefaults = true) =>
  buildInstallerScript({ hasDefaults, drawers: targetsByDrawer(paths) });

describe('buildInstallerScript', () => {
  it('names itself, so the Installer window is not called "Unnamed"', () => {
    expect(script([])).toContain(`(set @app-name "${INSTALLER_SCRIPT_NAME}")`);
  });

  it('offers both halves, defaulted to both, when there is something in each', () => {
    const text = script(['SYS:Prefs/Font']);
    expect(text).toContain('(askoptions');
    expect(text).toContain('"System default icons (ENVARC:Sys)"');
    expect(text).toContain('"Workbench icons"');
    expect(text).toContain('(default 3)');
  });

  /**
   * ENVARC: survives a reboot and ENV: is what Workbench is reading now. Writing only
   * the first leaves the user staring at their old icons and concluding it failed.
   */
  it('copies the default icons into both ENVARC:Sys and ENV:Sys', () => {
    const text = script([]);
    expect(text).toContain('(dest "ENVARC:Sys")');
    expect(text).toContain('(dest "ENV:Sys")');
  });

  it('emits one copy block per assigned drawer and no others', () => {
    const text = script(['SYS:Prefs/Font', 'SYS:Prefs/Asl', 'SYS:WBStartup/DefIcons']);

    expect(text).toContain('(dest "SYS:Prefs")');
    expect(text).toContain('(dest "SYS:WBStartup")');
    expect(text).not.toContain('(dest "SYS:Tools")');
  });

  /**
   * The backup is the only thing standing between a user and an unrecoverable overwrite,
   * so it has to happen before the copy, not merely somewhere in the same script.
   */
  it('backs up an existing icon before overwriting it', () => {
    const text = script(['SYS:Prefs/Font']);

    const backup = text.indexOf('kde2amiga-backup');
    const copy = text.indexOf('(dest "SYS:Prefs")');
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(copy);
    expect(text).toContain('(exists (tackon');
  });

  /**
   * Neither `MakeDir` nor Installer's `makedir` is documented to create intermediate
   * drawers, and the backup branch is two levels below the drawer the user picked. One
   * call for the whole branch would abort the install with the original already gone.
   */
  it('creates every level of the backup branch, not just the deepest', () => {
    const lines = script(['SYS:Prefs/Font']).split('\n').map((line) => line.trim());

    for (const level of ['SYS', 'Prefs']) {
      const at = lines.indexOf(`(set #here (tackon #here "${level}"))`);
      expect(at).toBeGreaterThan(-1);
      expect(lines[at + 1]).toBe('(makedir #here)');
    }
  });

  /**
   * An archive of nothing but Workbench replacements has no `Sys/` drawer, so a script
   * that still set bit 0 would offer to install defaults it does not carry and copy an
   * absent drawer.
   */
  it('installs the Workbench half outright when the archive carries no defaults', () => {
    const text = script(['SYS:Prefs/Font'], false);

    expect(text).toContain('(set #what 2)');
    expect(text).not.toContain('askoptions');
    expect(text).not.toContain('ENVARC:Sys');
    expect(text).toContain('(dest "SYS:Prefs")');
  });

  /**
   * `askoptions` comes back 0 when the user unticks both. Neither guard would fire and
   * the closing `exit` would still report icons installed.
   */
  it('stops rather than claiming success when nothing is ticked', () => {
    expect(script(['SYS:Prefs/Font'])).toContain('(if (= #what 0) (abort ');
  });

  /**
   * Told to someone who unticked "Workbench icons", the warning claims stock settings
   * were installed over changes that were in fact left alone.
   */
  it('keeps the machine-specific warning inside the Workbench guard', () => {
    const text = script(['SYS:Tools/HDToolBox']);
    expect(text.indexOf('HDToolBox')).toBeGreaterThan(text.indexOf('(if (IN #what 1)'));
  });

  it('does not offer Workbench icons when no target is assigned', () => {
    const text = script([]);
    expect(text).not.toContain('"Workbench icons"');
    expect(text).not.toContain('askdir');
  });

  it('warns about a machine-specific target only when one is being installed', () => {
    expect(script(['SYS:Tools/HDToolBox'])).toContain('HDToolBox');
    expect(script(['SYS:Prefs/Font'])).not.toContain('HDToolBox');
  });

  /**
   * AmigaDOS reads ISO-8859-1 and treats CR as part of an argument rather than as
   * whitespace, so a smart quote or a CRLF pasted in here reaches the Amiga as a broken
   * command. Cheaper to pin than to debug on hardware.
   */
  it('stays plain ASCII with LF endings', () => {
    const text = script(['SYS:Prefs/Font', 'SYS:Tools/HDToolBox']);
    expect(text).not.toContain('\r');
    expect([...text].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });
});
