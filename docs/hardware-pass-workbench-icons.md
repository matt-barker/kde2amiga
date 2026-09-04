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
- [ ] **2. The script is valid 43.3.** Work through both options. Expected: no
      "Script error" requester, and the drawer list on the confirmation page matches what
      was assigned.
- [ ] **3. Backup round-trips.** Note `SYS:Prefs/Font.info`'s look, install, confirm it
      changed, then copy the backup back from `SYS:Storage/kde2amiga-backup/SYS/Prefs`.
      Expected: the original icon returns, tooltypes intact — check with Icons/Information.
- [ ] **4. WBStartup survives a boot.** Install a WBStartup target, reboot. Expected: the
      machine reaches Workbench and the replaced program still runs. A stall here means
      `DONOTWAIT` did not survive; hold both mouse buttons at boot to skip WBStartup and
      restore from the backup.
- [ ] **5. Shell still opens.** Install `SYS:System/Shell`, double-click it. Expected: a
      shell window titled AmigaShell, sized as before. A window that opens and closes, or
      does not open, means the default tool or `WINDOW=` was lost.
- [ ] **6. The metadata table matches the A1200.** For each of the fifteen targets in the
      spec's §2 table, open Icons/Information on the *original* icon and compare the
      default tool and tooltypes. Any difference means the spec's table is wrong for real
      3.2.3 and must be corrected before release.
