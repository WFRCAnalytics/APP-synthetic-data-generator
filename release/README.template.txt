Synthetic Data Generator - offline copy
Version {{APP_VERSION}} (writes spec file version {{SPEC_VERSION}}), built {{DATE}}
Wasatch Front Regional Council

WHAT THIS IS
  The same app as the web page, in a folder. It runs on your computer with no internet. Your
  files are read and the fake files are made inside your browser; nothing is sent anywhere.

HOW TO OPEN IT (about 2 minutes)
  Browsers will not run this app straight from a file, so a small launcher is part of the folder. It
  shows the app to your browser from this folder, on this computer only. It needs nothing installed.

  Windows
    1. Unzip the whole download (right-click, Extract All). Keep the folders together.
    2. Double-click start.cmd. A window opens and then your browser opens the app.
       Leave the window open while you work.
    3. When you are done, close the window.

  macOS or Linux
    1. Unzip the whole download.
    2. In a terminal, run:  ./start.sh      (it needs python3, which these systems normally have)
    3. Your browser opens the app. Press Ctrl+C in the terminal when you are done.

  If the browser does not open, copy the line that starts with "URL:" into the address bar.

BROWSERS
  Current Chrome or Edge is the main target. Firefox and Safari work where the web page works.

WHAT THE LAUNCHER DOES
  It is the only extra step, and it is small. It serves the files in the "site" folder to this
  computer (address 127.0.0.1) and to nobody else. It makes no connection to the internet, writes
  no file and changes no setting. Closing its window stops it. The code is in start.ps1 (Windows)
  and start.sh (macOS and Linux); both are plain text you can read.

IF IT DOES NOT START
  - Windows says the script is blocked: your organization's policy prevents running scripts.
    Ask your IT team to allow start.ps1 from this folder, or use the web page instead.
  - "No free port": another copy is already running. Close it and try again.
  - You double-clicked site\APP-synthetic-data-generator\index.html: the page will tell you to use
    start.cmd (or start.sh) instead.

CHECK THAT NOTHING LEAVES YOUR COMPUTER
  - The page header shows a counter of network requests. During a whole session it should show
    0 outside this site.
  - Open the browser's developer tools (F12), the Network tab, and work as usual: every request
    goes to 127.0.0.1, which is this computer.
  - Disconnect from the network before you start, if you like. The app works the same.

CHECK THAT THE FILES ARE THE ONES RELEASED
  CHECKSUMS.sha256 lists a fingerprint (SHA-256) for every file.
  Windows (PowerShell, in this folder):
      Get-FileHash -Algorithm SHA256 start.ps1
    and compare with the line for start.ps1 in CHECKSUMS.sha256.
  macOS or Linux (in this folder):
      shasum -a 256 -c CHECKSUMS.sha256

VERSION
  The page header shows the same version as this file. Spec files saved by this version have
  spec_version {{SPEC_VERSION}}; use a release that writes that version to read them back.
  There is no automatic update: to get a newer version, download its zip.

LICENCES
  See LICENSES.md. The app is MIT licensed. The WFRC logos are not covered by that licence.
