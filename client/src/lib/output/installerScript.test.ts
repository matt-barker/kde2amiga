import { describe, it, expect } from 'vitest';
import {
  INSTALLER_SCRIPT,
  INSTALLER_SCRIPT_NAME,
  INSTALLER_DEFAULT_TOOL,
  SYS_DRAWER,
} from './installerScript';

describe('the Install Default Icons script', () => {
  /**
   * Both destinations, for the reason the README already gives: ENVARC:Sys survives a
   * reboot but is not read live, and ENV:Sys is read live but is rebuilt from ENVARC on
   * every boot. Writing only one of them either does nothing now or nothing later.
   */
  it('copies the Sys drawer to both ENVARC:Sys and ENV:Sys', () => {
    expect(INSTALLER_SCRIPT).toMatch(/Copy\s+Sys\/#\?\.info\s+TO\s+ENVARC:Sys/);
    expect(INSTALLER_SCRIPT).toMatch(/Copy\s+Sys\/#\?\.info\s+TO\s+ENV:Sys/);
  });

  /**
   * IconX sets the current directory to the drawer holding the script, so the source is
   * relative and the archive can be unpacked anywhere. An absolute source would only
   * work for a user who unpacked into the one drawer we happened to guess.
   */
  it('names its source relative to the drawer it sits in', () => {
    for (const line of INSTALLER_SCRIPT.split('\n')) {
      if (!line.startsWith('Copy')) continue;
      expect(line).not.toMatch(/Copy\s+\w+:/);
    }
  });

  it('creates the destination drawers rather than assuming they exist', () => {
    expect(INSTALLER_SCRIPT).toMatch(/If NOT EXISTS ENVARC:Sys[\s\S]*?MakeDir ENVARC:Sys/);
    expect(INSTALLER_SCRIPT).toMatch(/If NOT EXISTS ENV:Sys[\s\S]*?MakeDir ENV:Sys/);
  });

  /**
   * IconX closes its window the moment the script ends, so without a pause the user
   * sees a flash and no confirmation that anything happened.
   */
  it('holds the window open at the end', () => {
    expect(INSTALLER_SCRIPT.trimEnd().split('\n').pop()).toMatch(/^Ask /);
  });

  it('tells the user the change is not visible until a reboot', () => {
    expect(INSTALLER_SCRIPT).toMatch(/reboot/i);
  });

  /**
   * AmigaDOS reads ISO-8859-1 and needs CR-free lines; a stray character from a smart
   * quote would land as mojibake mid-command.
   */
  it('is plain ASCII with LF line endings', () => {
    expect(INSTALLER_SCRIPT).not.toMatch(/\r/);
    for (let i = 0; i < INSTALLER_SCRIPT.length; i++) {
      expect(INSTALLER_SCRIPT.charCodeAt(i)).toBeLessThan(128);
    }
  });

  it('is named so Workbench pairs it with Install Default Icons.info', () => {
    expect(INSTALLER_SCRIPT_NAME).toBe('Install Default Icons');
  });

  it('runs through IconX, the tool AmigaOS ships for scripts started from Workbench', () => {
    expect(INSTALLER_DEFAULT_TOOL).toBe('IconX');
  });

  /**
   * The drawer name is shared with the archive layout rather than written out twice:
   * a script copying from Sys/ while the builder wrote to System/ fails silently on
   * the Amiga and nowhere else.
   */
  it('copies from the same drawer the archive layout writes to', () => {
    expect(INSTALLER_SCRIPT).toContain(`${SYS_DRAWER}/#?.info`);
  });
});
