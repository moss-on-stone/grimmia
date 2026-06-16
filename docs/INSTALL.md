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
Because the app isn't notarized, macOS blocks the **first** launch. You'll see
one of two different-looking warnings — **both mean the same thing** (the app
just isn't signed with a paid Apple certificate) and both are easy to get past.
Find the message you got below.

> ℹ️ **Whichever warning you see, you only do this once.** After the first
> successful open, IA Desktop launches normally with no warnings.

---

#### ⚠️ Message A — *"IA Desktop.app" is damaged and can't be opened. You should move it to the Bin.*

This is the one you'll usually get when you **downloaded the app with a browser**
(Firefox, Chrome, Safari), especially on **macOS Sequoia (15) or newer**. The app
is **not** actually damaged — macOS shows this wording for any unsigned app that
arrived with a download "quarantine" flag, and (unlike the other message) it does
**not** offer an "Open Anyway" button. Do **not** click *Move to Bin*.

**Fix it (copy–paste one line into Terminal):**

1. Click **Cancel** on the dialog.
2. Open the **Terminal** app (press ⌘-Space, type *Terminal*, Enter).
3. Paste this line and press Return (it removes the download quarantine flag):

   ```bash
   xattr -dr com.apple.quarantine "/Applications/IA Desktop.app"
   ```

   - If you haven't moved it to Applications yet, point at wherever it is, e.g.
     `xattr -dr com.apple.quarantine ~/Downloads/"IA Desktop.app"`.
   - It prints nothing on success — that's normal.
4. Now open **IA Desktop** normally (double-click). It launches without the
   warning.

---

#### ⚠️ Message B — *Apple could not verify "IA Desktop" is free of malware* (or *"…can't be opened because it is from an unidentified developer"*)

This milder warning gives you a way through in the UI — no Terminal needed.

**macOS Sequoia (15) or newer**
1. Open **IA Desktop** from Applications. You'll see the warning — click **Done**.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the **Security** section. You'll see *"IA Desktop was blocked…"* —
   click **Open Anyway**.
4. Confirm with **Open Anyway** and enter your password / Touch ID.

**macOS Sonoma (14) or older**
1. In Applications, **right-click** (or Control-click) **IA Desktop** → **Open**.
2. In the dialog, click **Open** again.

> If Message B's *"Open Anyway"* doesn't appear, or the app still won't launch,
> use the Terminal one-liner from **Message A** above — it fixes both cases.

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
