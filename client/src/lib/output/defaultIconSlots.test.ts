import { describe, it, expect } from 'vitest';
import { DEFAULT_ICON_SLOTS, slotForRole, type DefaultIconRole } from './defaultIconSlots';

/**
 * The exact `def_*.info` files present in ENVARC:Sys on the target machine
 * (A1200 / OS 3.2.3), captured from a `list ENVARC:Sys` there. This is the
 * oracle for the DefIcons half of the catalogue: a slot we offer that the OS
 * does not consult writes a file nothing will ever read.
 *
 * Note `RAM` and `cd0` — DefIcons filenames are matched case-insensitively by
 * AmigaDOS, but we mirror what shipped so a listing of ENVARC:Sys after an
 * install still looks like the one before it.
 */
const OBSERVED_ON_HARDWARE = [
  'adf', 'amigaguide', 'archive', 'ascii', 'asm', 'c', 'cd0', 'cpp',
  'diskarchive', 'font', 'h', 'i', 'iff', 'key', 'kickstart', 'mp3',
  'music', 'officedocs', 'pdf', 'picture', 'prefs', 'rad', 'RAM', 'rexx',
  'script', 'sound', 'src', 'tool', 'video',
];

/** The icon.library fallbacks, keyed off the DiskObject type byte rather than a datatype. */
const TYPE_FALLBACKS = ['drawer', 'disk', 'tool', 'project', 'trashcan'];

const rolesOf = (group: string) =>
  DEFAULT_ICON_SLOTS.filter((slot) => slot.group === group).map((slot) => slot.role);

describe('DEFAULT_ICON_SLOTS', () => {
  it('covers every def_ slot observed in ENVARC:Sys on the target machine', () => {
    const roles = new Set(DEFAULT_ICON_SLOTS.map((slot) => slot.role));
    for (const observed of OBSERVED_ON_HARDWARE) expect(roles).toContain(observed);
  });

  it('offers the five icon.library type fallbacks', () => {
    expect(rolesOf('type').slice().sort()).toEqual(TYPE_FALLBACKS.slice().sort());
  });

  /**
   * `def_tool` appears both in the ENVARC:Sys listing and among the type fallbacks, but
   * it is one file at one path, so it gets one catalogue entry - filed under the type
   * fallbacks, the older and stricter of the two meanings. Listing it twice would let
   * two different icons each claim "their" def_tool and have one silently overwrite
   * the other in the archive.
   */
  it('files an observed name that is also a type fallback under the type fallbacks only', () => {
    expect(rolesOf('deficons').slice().sort()).toEqual(
      OBSERVED_ON_HARDWARE.filter((role) => !TYPE_FALLBACKS.includes(role)).sort(),
    );
  });

  it('never lists the same slot twice', () => {
    const roles = DEFAULT_ICON_SLOTS.map((slot) => slot.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('gives each type fallback the DiskObject type its name promises', () => {
    for (const role of TYPE_FALLBACKS) {
      expect(slotForRole(role as DefaultIconRole).kind).toBe(role);
    }
  });

  /**
   * DefIcons matches by datatype, not by type byte, so the icons standing in for
   * file types are ordinary project icons. A def_picture.info carrying type 2
   * would make Workbench treat every picture as a drawer.
   */
  it('makes every DefIcons slot a project icon', () => {
    for (const slot of DEFAULT_ICON_SLOTS.filter((s) => s.group === 'deficons')) {
      expect(slot.kind).toBe('project');
    }
  });

  it('describes the cryptic slots so the UI can say what they are for', () => {
    expect(slotForRole('h').description).toMatch(/header/i);
    expect(slotForRole('rad').description).toMatch(/recoverable ram/i);
  });
});

describe('slotForRole', () => {
  it('finds a slot by its role name', () => {
    expect(slotForRole('picture').role).toBe('picture');
  });

  it('throws for a name that is not a slot, rather than returning undefined', () => {
    expect(() => slotForRole('nonsense' as DefaultIconRole)).toThrow(/nonsense/);
  });
});
