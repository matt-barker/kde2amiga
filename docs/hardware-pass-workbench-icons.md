# Hardware pass: Workbench icon targets

Everything below was built without an Amiga in the loop. The metadata baked into the
replacement icons was read from the Amiberry A4000 image, not from the A1200, so item 6
gates the rest: if 3.2.3 ships different values there, the wrong ones are being shipped to
everyone.

Unpack `kde2amiga-icons.lha` into RAM: and work from there, so a mistake costs a reboot
rather than a restore.

- [ ] **1. The script icon runs, with the binary a drawer down.** Double-click
      `Install kde2amiga Icons`. Expected: the Installer opens with the window titled
      "Install kde2amiga Icons". The default tool is now `C/Installer` rather than a bare
      `Installer`, because the binary moved out of the archive root — where it sat beside
      the script reading like the thing to double-click. That makes this item test two
      things at once: that Workbench resolves a relative default tool against the icon's
      own drawer at all, and that it follows one through a subdirectory. If it reports
      "Installer not found", the second half is what failed, and the fix is either to put
      the binary back in the root or to give the icon an absolute path — see
      `INSTALLER_DEFAULT_TOOL` in `client/src/lib/output/installerScript.ts`.
- [ ] **2. The script is valid 43.3.** `Installer.guide` is not redistributed, so the
      three choices below are the only record of what the script offers: work through
      System default icons only, Workbench icons only, and both together. Expected: no
      "Script error" requester, and the drawer list on the confirmation page matches what
      was assigned.
- [ ] **3. Backup round-trips, twice.** Note `SYS:Prefs/Font.info`'s look, install, confirm
      it changed, then copy the backup back from `SYS:Storage/kde2amiga-backup/SYS/Prefs`.
      Expected: the original icon returns, tooltypes intact — check with Icons/Information.
      Then do it again without restoring in between: install, install a second time
      (another theme, or the same archive), and only then restore. Expected: the *stock*
      icon comes back, not the one the first run installed. The backup copy is guarded on
      the backup not already existing precisely because `copyfiles` overwrites in silence,
      and a second run that backed up our own icon over the original would leave the stock
      icon nowhere on the machine.
- [ ] **3a. Replaced icons need re-arranging.** Nothing in the archive can carry an icon's
      saved position or a drawer's window geometry across a replacement, so both are lost.
      Install several `SYS:Prefs` targets at once. Expected: the confirmation page says so
      before anything is overwritten, the drawer opens with the icons unpositioned, and
      Icons/Snapshot makes an arrangement stick.
- [ ] **3c. The defaults are backed up too, on a machine that already had some.** The
      defaults half used to overwrite `ENVARC:Sys` with no backup at all, which on this
      machine means the installed GlowIcons `def_*.info` set is what it destroyed. Install
      the defaults, then check `SYS:Storage/kde2amiga-backup/ENVARC/Sys` holds the *old*
      `def_` icons — only the ones the archive carries a replacement for, since the script
      walks the archive's `Sys/` drawer, not `ENVARC:Sys`. Restore with
      `Copy SYS:Storage/kde2amiga-backup/ENVARC/Sys/#?.info TO ENVARC:Sys` and reboot.
      Expected: the GlowIcons defaults are back. Note that `ENV:Sys` is deliberately not
      backed up — it is rebuilt from `ENVARC:` at boot — so a restore without a reboot
      leaves the RAM copy still holding ours, which is what the reboot is for. Run it once
      more against a machine that has *no* `ENVARC:Sys` at all (rename it first) to confirm
      the empty case installs cleanly rather than aborting on an absent drawer.
- [ ] **4. WBStartup survives a boot, for more than one icon.** All six WBStartup targets
      carry `DONOTWAIT`; nine targets in all carry it, the other three being
      `SYS:System/Mounter`, `SYS:System/RexxMast` and `SYS:Utilities/Clock`. A regression
      in any one of them passes unnoticed if only one is ever checked, so all nine must be
      checked before release — install at least two WBStartup icons (for example
      `DefIcons` and `AsyncWB`) alongside each other, then reboot. Expected: the machine
      reaches Workbench and both replaced programs still run. `Mounter` and `RexxMast` are
      startup-relevant too and need the same check even though they sit outside WBStartup:
      whatever launches them stalls the same way if `DONOTWAIT` was lost. `Clock` is the
      cheap one — replace it, reboot, and confirm it appears without blocking. If
      `DONOTWAIT` was lost on any one of them, Workbench's startup sequence stalls on
      that item and every WBStartup program listed after it never launches; hold both
      mouse buttons at boot to skip WBStartup and restore that icon from the backup.
- [ ] **5. Shell still opens.** Install `SYS:System/Shell`, double-click it. Expected: a
      shell window titled AmigaShell, sized as before. A window that opens and closes, or
      does not open, means the default tool or `WINDOW=` was lost.
- [ ] **6. The metadata table matches the A1200.** For each of the fifteen targets in the
      spec's §2 table, open Icons/Information on the *original* icon and compare the
      default tool and tooltypes. Any difference means the spec's table is wrong for real
      3.2.3 and must be corrected before release.
- [ ] **7. `HDToolBox`'s machine-specific warning and its replacement both check out.**
      This is the archive's only `machineSpecific` target: its `SCSI_DEVICE_NAME`,
      `SCSI_MAX_ADDRESS`, `SCSI_MAX_LUN` and `XT_NAME` were read off the Amiberry A4000
      image, not this machine, and the installer ships them anyway with a warning rather
      than leaving the target out. Install `SYS:Tools/HDToolBox` and check three things:
      before it asks where to keep the backup, the installer shows a message naming
      HDToolBox and warning that its settings differ between machines; afterwards,
      Icons/Information on the new `HDToolBox` icon still lists those four ToolTypes; and,
      the check that actually matters, double-clicking it opens HDToolBox and it lists
      this machine's real SCSI device and drive, not an empty list or the wrong
      controller. Expected failure: an empty or wrong device list, meaning the stock
      values do not suit this machine's controller. Restore from
      `SYS:Storage/kde2amiga-backup/SYS/Tools` if so.
