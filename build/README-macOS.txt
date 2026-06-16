IA Desktop — How to install on macOS
=====================================

IA Desktop is free and open-source, but it is NOT signed with a paid Apple
Developer ID. That's normal for small independent apps. macOS will show a
warning the FIRST time you open it. The app is safe; you only approve it once.

1. INSTALL
   - Drag the "IA Desktop" icon onto the "Applications" folder (in this window).
   - Eject this disk image when done.

2. OPEN IT THE FIRST TIME

   macOS shows one of TWO different-looking warnings. Both mean the same thing
   (the app just isn't signed) and both are easy to get past. Find yours below.
   You only do this once — after that, the app opens normally.

   ----------------------------------------------------------------------------
   MESSAGE A:  ' "IA Desktop.app" is damaged and can't be opened.
                 You should move it to the Bin. '

   You'll usually get THIS one if you downloaded the app with a browser
   (Firefox/Chrome/Safari), especially on macOS Sequoia (15) or newer. The app
   is NOT really damaged, and this dialog has NO "Open Anyway" button.
   Do NOT click "Move to Bin".

   Fix it:
     a. Click "Cancel".
     b. Open the Terminal app (press Cmd-Space, type Terminal, press Return).
     c. Paste this ONE line and press Return (it clears the download flag):

          xattr -dr com.apple.quarantine "/Applications/IA Desktop.app"

        (It prints nothing on success — that's fine.)
     d. Double-click IA Desktop. It opens without the warning.
   ----------------------------------------------------------------------------
   MESSAGE B:  'Apple could not verify "IA Desktop" is free of malware'
               (or "...from an unidentified developer")

   This milder warning lets you through without the Terminal:

   On macOS Sequoia (15) or newer:
     a. Open IA Desktop from Applications. You'll see the warning — click "Done".
     b. Open  System Settings > Privacy & Security.
     c. Scroll to the "Security" section and click "Open Anyway".
     d. Confirm with "Open Anyway" and enter your password / Touch ID.

   On macOS Sonoma (14) or older:
     a. In Applications, right-click (Control-click) "IA Desktop" > "Open".
     b. Click "Open" again in the dialog.

   If "Open Anyway" never appears, use the Terminal line from MESSAGE A — it
   fixes both cases.
   ----------------------------------------------------------------------------

WHY THIS WARNING?
   Apple flags apps that aren't signed with a paid certificate. Signing costs
   money + an annual developer account; this project stays free by shipping
   unsigned. The source code is public if you'd rather build it yourself.
