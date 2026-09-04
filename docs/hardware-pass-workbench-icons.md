# Hardware pass: Workbench icon targets

Everything below was built without an Amiga in the loop. The metadata baked into the
replacement icons was read from the Amiberry A4000 image, not from the A1200, so item 6
gates the rest: if 3.2.3 ships different values there, the wrong ones are being shipped to
everyone.

Unpack `kde2amiga-icons.lha` into RAM: and work from there, so a mistake costs a reboot
rather than a restore.

- [ ] **1. The script icon runs.** Double-click `Install kde2amiga Icons`. Expected: the
      Installer opens with the window titled "Install kde2amiga Icons". If it reports
      "Installer not found", Workbench is not resolving a relative default tool against
      the icon's own drawer, and the icon needs an absolute path or the binary needs to
      go somewhere on the path.
- [ ] **2. The script is valid 43.3.** `Installer.guide` is not redistributed, so the
      three choices below are the only record of what the script offers: work through
      System default icons only, Workbench icons only, and both together. Expected: no
      "Script error" requester, and the drawer list on the confirmation page matches what
      was assigned.
- [ ] **3. Backup round-trips.** Note `SYS:Prefs/Font.info`'s look, install, confirm it
      changed, then copy the backup back from `SYS:Storage/kde2amiga-backup/SYS/Prefs`.
      Expected: the original icon returns, tooltypes intact — check with Icons/Information.
- [ ] **4. WBStartup survives a boot, for more than one icon.** All nine WBStartup targets
      carry `DONOTWAIT`, and a regression in any one of them passes unnoticed if only one
      is ever checked, so every WBStartup icon in the archive must be checked before
      release — install at least two (for example `DefIcons` and `RexxMast`) alongside
      each other, then reboot. Expected: the machine reaches Workbench and both replaced
      programs still run. If `DONOTWAIT` was lost on any one of them, Workbench's startup
      sequence stalls on that item and every WBStartup program listed after it never
      launches; hold both mouse buttons at boot to skip WBStartup and restore that icon
      from the backup.
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
