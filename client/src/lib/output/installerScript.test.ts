import { describe, it, expect } from 'vitest';
import { buildInstallerScript, INSTALLER_SCRIPT_NAME, BACKUP_DRAWER } from './installerScript';
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
   * The whole safety property, and the one that was silently false: `copyfiles`
   * overwrites without asking, so a backup taken whenever the destination exists means
   * the second install copies the *first* install's icon over the stock original. The
   * user's real icons are then gone from the machine, with a backup drawer that still
   * looks full. Anyone re-running to add a drawer, retrying after an abort, or trying a
   * second theme hits it.
   */
  it('never overwrites a backup it already took, so a second run keeps the originals', () => {
    const lines = script(['SYS:Prefs/Font']).split('\n').map((line) => line.trim());

    const at = lines.findIndex((line) => line.startsWith('(foreach "Wb/SYS/Prefs"'));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe('(if (AND (exists (tackon "SYS:Prefs" @each-name))');
    expect(lines[at + 2]).toBe('(NOT (exists (tackon #here @each-name))))');
    expect(lines[at + 3]).toBe(
      '(copyfiles (source (tackon "SYS:Prefs" @each-name)) (dest #here))))',
    );
  });

  /**
   * The half that had no backup at all. Installing the defaults writes over whatever
   * `def_*.info` set the machine already had — a GlowIcons or NewIcons install, most
   * likely — and until this it did so irreversibly, while the Workbench half beside it
   * took backups of everything it touched.
   *
   * Guarded the same way as that half, for the same reason: `copyfiles` overwrites in
   * silence, so a second run must not copy the first run's icons over the stock ones and
   * leave a backup drawer that still looks full.
   */
  it('backs up the def_ icons already in ENVARC:Sys before overwriting them', () => {
    const lines = script([]).split('\n').map((line) => line.trim());

    const at = lines.findIndex((line) => line.startsWith('(foreach "Sys"'));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe('(if (AND (exists (tackon "ENVARC:Sys" @each-name))');
    expect(lines[at + 2]).toBe('(NOT (exists (tackon #here @each-name))))');
    expect(lines[at + 3]).toBe(
      '(copyfiles (source (tackon "ENVARC:Sys" @each-name)) (dest #here))))',
    );
  });

  it('takes that backup before it copies the new defaults in', () => {
    const text = script([]);

    expect(text.indexOf('(source (tackon "ENVARC:Sys"')).toBeLessThan(
      text.indexOf('(dest "ENVARC:Sys")'),
    );
  });

  /**
   * Mirrored under ENVARC/, not ENV/. `ENV:` is the RAM copy the startup-sequence
   * rebuilds from `ENVARC:` at every boot, so an `ENV:Sys` icon is never the only copy
   * of anything and backing it up would age into a stale duplicate of the drawer beside
   * it. Restoring `ENVARC:Sys` and rebooting is the honest round trip, and it is what
   * the README tells the user to do.
   */
  it('mirrors the defaults backup under ENVARC/Sys, level by level', () => {
    const lines = script([]).split('\n').map((line) => line.trim());

    for (const level of ['ENVARC', 'Sys']) {
      const at = lines.indexOf(`(set #here (tackon #here "${level}"))`);
      expect(at).toBeGreaterThan(-1);
      expect(lines[at + 1]).toBe('(makedir #here)');
    }
    expect(lines).not.toContain('(set #here (tackon #here "ENV"))');
  });

  /**
   * The askdir used to live inside the Workbench guard, because that was the only half
   * that backed anything up. A defaults-only archive would now reach the backup step
   * with `#backup` unset and write the user's originals into a drawer named nothing.
   */
  it('asks where the backup goes even when only default icons are installed', () => {
    const text = script([]);

    expect(text).toContain('(askdir');
    expect(text.indexOf('(askdir')).toBeLessThan(text.indexOf('(if (IN #what 0)'));
  });

  /**
   * One requester, not one per half. The user picks a place for "the icons being
   * replaced", and being asked the same question twice for one install reads as though
   * the first answer did not take.
   */
  it('asks for the backup drawer exactly once when installing both halves', () => {
    expect(script(['SYS:Prefs/Font']).match(/\(askdir/g)).toHaveLength(1);
  });

  /**
   * Spec §6: "A confirmation page lists the drawers about to change and names any
   * machineSpecific target among them." Without it the user answers an askdir and then
   * watches twenty icons get overwritten with no statement of what was about to happen.
   */
  it('lists the drawers about to change, before anything is copied', () => {
    const text = script(['SYS:Prefs/Font', 'SYS:Prefs/Asl', 'SYS:WBStartup/DefIcons']);

    expect(text).toContain('(message "These Workbench drawers are about to change:');
    expect(text).toContain('"  SYS:Prefs  (2 icons)\\n"');
    expect(text).toContain('"  SYS:WBStartup  (1 icon)\\n"');
    expect(text).not.toContain('SYS:Tools  (');

    const page = text.indexOf('These Workbench drawers are about to change');
    expect(page).toBeLessThan(text.indexOf('(askdir'));
    expect(page).toBeLessThan(text.indexOf('(copyfiles (source "Wb/'));
  });

  /**
   * `askdir` asks for a parent, but what the user gets is a new drawer inside it. Left
   * unsaid, someone aiming the backup at an existing drawer expects the icons to land
   * there loose, and cannot find them afterwards.
   */
  it('says the backup drawer will be created inside the chosen directory', () => {
    const text = script(['SYS:Prefs/Font']);
    // `(default` also appears in the earlier askoptions, so anchor the end after the askdir.
    const at = text.indexOf('(askdir');
    const prompt = text.slice(at, text.indexOf('(default', at));

    expect(prompt).toContain(BACKUP_DRAWER);
    expect(prompt).toMatch(/will be created/i);
  });

  /**
   * The Installer cannot read the original icon's coordinates out of the file it is
   * about to overwrite, so this cannot be fixed — only said out loud. A user who
   * replaces a whole Prefs drawer and finds it scrambled has no other way to learn that
   * it was expected, or that Snapshot is the fix.
   */
  it('warns on that page that positions and window geometry are lost', () => {
    const text = script(['SYS:Prefs/Font']);

    expect(text).toContain('lose their positions in the drawer');
    expect(text).toContain('window size and position');
    expect(text).toContain('Icons/Snapshot');
  });

  /**
   * Folded into the confirmation page rather than emitted beside it: two requesters back
   * to back read as two questions, and the second one arrives after the user has already
   * agreed to proceed.
   */
  it('names a machine-specific target on that same page, not in a second message', () => {
    const text = script(['SYS:Tools/HDToolBox']);

    expect(text.match(/\(message /g)).toHaveLength(1);
    expect(text).toContain('"  HDToolBox\\n\\n"');
  });

  /**
   * The destination is what the catalogue states, not what is left after slicing `Wb/`
   * off an archive path. Re-deriving it gave one string two owners, and got it wrong for
   * a target in a root drawer.
   */
  it('reads each destination off the catalogue rather than off the archive path', () => {
    const text = script(['SYS:Utilities/Clock']);

    expect(text).toContain('(copyfiles (source "Wb/SYS/Utilities") (dest "SYS:Utilities")');
    expect(text).not.toContain('SYS:Utilities/');
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
    expect(text).not.toContain('Wb/');
  });

  it('warns about a machine-specific target only when one is being installed', () => {
    expect(script(['SYS:Tools/HDToolBox'])).toContain('HDToolBox');
    expect(script(['SYS:Prefs/Font'])).not.toContain('HDToolBox');
  });

  /**
   * IconX and the Installer both set the current directory to the drawer holding the
   * script, so a relative source works wherever the archive was unpacked and an absolute
   * one only works for the drawer we happened to guess. This regression shows up nowhere
   * but on hardware, as an installer that copies nothing and reports success.
   *
   * Quoted literals only: the backup step's `(source (tackon "SYS:Prefs" @each-name))` is
   * reading the machine, not the archive, and is absolute on purpose.
   */
  it('names its copy sources relative to the drawer the script sits in', () => {
    const text = script(['SYS:Prefs/Font', 'SYS:WBStartup/DefIcons']);
    const sources = [...text.matchAll(/\(source "([^"]+)"\)/g)].map((m) => m[1]);

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source).not.toContain(':');
  });

  /**
   * `ENVARC:Sys` and `ENV:Sys` do not exist on a machine that has never had a def_ icon
   * installed, and `copyfiles` into an absent drawer is an error, not a mkdir.
   */
  it('creates the destination drawers rather than assuming they exist', () => {
    const text = script([]);

    for (const drawer of ['ENVARC:Sys', 'ENV:Sys']) {
      const made = text.indexOf(`(makedir "${drawer}")`);
      expect(made).toBeGreaterThan(-1);
      expect(made).toBeLessThan(text.indexOf(`(dest "${drawer}")`));
    }
  });

  /**
   * Icons already drawn on screen keep their old look until Workbench redraws them, so a
   * user who installs and sees nothing change concludes it failed.
   */
  it('tells the user the change is not fully visible until a reboot', () => {
    expect(script(['SYS:Prefs/Font'])).toMatch(/reboot/i);
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
