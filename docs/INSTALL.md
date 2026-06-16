# Installing IA Desktop

IA Desktop is **open-source and free**, but it is **not signed with a paid
Apple Developer ID or a Windows code-signing certificate**. That's normal for
small independent apps — it just means your operating system shows an extra
"unknown developer" warning the first time you open it. The app is safe; you
only need to approve it **once**.

This page has the exact steps for **macOS** and **Windows**.

---

## macOS

### 1. Install
1. Open the downloaded **`.dmg`** file.
   - Apple Silicon (M1/M2/M3/M4) Macs: use the **`…-arm64.dmg`**.
   - Older Intel Macs: use the **`…-x64.dmg`**.
2. In the window that appears, **drag the IA Desktop icon onto the Applications
   folder**.
3. Eject the disk image (drag it to the Trash / click the ⏏ next to it).

### 2. Open it the first time
Because the app isn't notarized, macOS blocks the first launch with a message
like *"Apple could not verify 'IA Desktop' is free of malware."* Choose the path
that matches your macOS version:

**macOS Sequoia (15) or newer**
1. Open **IA Desktop** from your Applications folder. You'll see the warning —
   click **Done**.
2. Open  **System Settings → Privacy & Security**.
3. Scroll down to the **Security** section. You'll see *"IA Desktop was blocked…"*
   — click **Open Anyway**.
4. Confirm with **Open Anyway** and enter your password / Touch ID.

**macOS Sonoma (14) or older**
1. In Applications, **right-click** (or Control-click) **IA Desktop** and choose
   **Open**.
2. In the dialog, click **Open** again.

You only do this once. After that, open IA Desktop normally.

### Still stuck? (Terminal one-liner)
If the app won't open at all (e.g. *"is damaged and can't be opened"*), remove
the download quarantine flag and try again:

```bash
xattr -dr com.apple.quarantine "/Applications/IA Desktop.app"
```

---

## Windows

### 1. Install
1. Run the downloaded **`IA Desktop Setup <version>.exe`**.
2. Windows SmartScreen may show **"Windows protected your PC."** This appears for
   any app without a paid certificate. Click **More info**, then **Run anyway**.
3. Follow the installer — you can pick the install folder. It creates Start-menu
   and desktop shortcuts.

### 2. Open it
Launch **IA Desktop** from the Start menu or the desktop shortcut. No further
warnings after the first run.

---

## Why the warning appears

Apple (Gatekeeper) and Microsoft (SmartScreen) flag apps that aren't signed with
a paid developer certificate. Signing/notarizing costs money and an annual
developer account; this project ships unsigned so it can stay free. The source
code is public, so you can read or build it yourself if you prefer — see the
project README for build instructions.
