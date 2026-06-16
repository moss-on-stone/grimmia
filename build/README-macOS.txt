IA Desktop — How to install on macOS
=====================================

IA Desktop is free and open-source, but it is NOT signed with a paid Apple
Developer ID. That's normal for small independent apps. macOS will show an
"unknown developer / could not verify" warning the FIRST time you open it.
The app is safe; you only need to approve it once.

1. INSTALL
   - Drag the "IA Desktop" icon onto the "Applications" folder (in this window).
   - Eject this disk image when done.

2. OPEN IT THE FIRST TIME

   On macOS Sequoia (15) or newer:
     a. Open IA Desktop from Applications. You'll see the warning — click "Done".
     b. Open  System Settings > Privacy & Security.
     c. Scroll to the "Security" section and click "Open Anyway".
     d. Confirm with "Open Anyway" and enter your password / Touch ID.

   On macOS Sonoma (14) or older:
     a. In Applications, right-click (Control-click) "IA Desktop" > "Open".
     b. Click "Open" again in the dialog.

   You only do this once. After that, open it normally.

STILL STUCK?  (e.g. "is damaged and can't be opened")
   Open the Terminal app and run this one line, then try again:

     xattr -dr com.apple.quarantine "/Applications/IA Desktop.app"

WHY THIS WARNING?
   Apple flags apps that aren't signed with a paid certificate. Signing costs
   money + an annual developer account; this project stays free by shipping
   unsigned. The source code is public if you'd rather build it yourself.
