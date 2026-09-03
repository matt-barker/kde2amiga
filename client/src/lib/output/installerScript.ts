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
 */
export const INSTALLER_SCRIPT_NAME = 'Install Default Icons';

/**
 * `do_DefaultTool` for the script's icon. IconX ships in `C:` on AmigaOS 3.x and is the
 * standard way to make an AmigaDOS script double-clickable: it opens a console window,
 * `Execute`s the script in the drawer the icon sits in, and closes when it returns.
 *
 * Because IconX uses `Execute`, the script does not need its `s` protection bit set —
 * which matters, since neither the zip nor the LHA writer carries Amiga protection bits.
 */
export const INSTALLER_DEFAULT_TOOL = 'IconX';

/**
 * Kept to plain ASCII and LF endings on purpose. AmigaDOS reads ISO-8859-1, so a smart
 * quote pasted in here would reach the Amiga as mojibake in the middle of a command,
 * and a CR would be read as part of the argument rather than as whitespace.
 */
export const INSTALLER_SCRIPT = `; Install Default Icons
;
; Written by kde2amiga. Double-click the icon beside this file, or from a Shell:
;   execute "${INSTALLER_SCRIPT_NAME}"

FailAt 21

Echo "Installing default icons ..."

If NOT EXISTS ENVARC:Sys
  MakeDir ENVARC:Sys
EndIf

If NOT EXISTS ENV:Sys
  MakeDir ENV:Sys
EndIf

Copy ${SYS_DRAWER}/#?.info TO ENVARC:Sys CLONE
Copy ${SYS_DRAWER}/#?.info TO ENV:Sys CLONE

Echo ""
Echo "Done. ENVARC:Sys keeps them across reboots, ENV:Sys is the live copy."
Echo "Icons already on screen keep their old look until the next reboot."
Ask "Press RETURN to close this window"
`;
