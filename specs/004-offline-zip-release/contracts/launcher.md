# Contract: launcher

Files: `start.cmd` (Windows wrapper), `start.ps1`, `start.sh`. They behave the same.

## Behaviour

- Serves the `site/` folder next to it, and only that folder, at `http://127.0.0.1:<port>/`
  (the app is at `/APP-synthetic-data-generator/`). GET and HEAD only; anything else is 405;
  a path outside `site/` (including `..`) or a missing file is 404. Other methods get 405.
- Meant for this computer only. `start.sh` binds `127.0.0.1`, so another computer or another address of
  this machine is refused at the connection. `start.ps1` registers `127.0.0.1` with Windows' HTTP
  service, which may accept a connection on other addresses; it then answers every request that does
  not come from the loopback address with 403, and a request for another host name with the
  service's own 400, so no file is ever served. The end-to-end test accepts either outcome and fails
  if a page is served.
- Port: the first free port from 8731 upward (or `--port N`, which fails if taken).
- Sends `Cache-Control: no-store`, and a correct type for `.js`, `.mjs`, `.wasm`, `.css`, `.json`,
  `.png`, `.woff`, `.svg`, `.txt`.
- Makes no outbound connection and writes no file.
- Prints one line `URL: http://127.0.0.1:<port>/APP-synthetic-data-generator/`, opens the default
  browser at it (skipped with `--no-open`), then prints `Press Ctrl+C or close this window to stop.`

## Options

| Option | Meaning |
|--------|---------|
| `--no-open` | do not start a browser (used by tests) |
| `--port N` | use this port or fail |

## Exit codes

0 stopped normally; 2 no free port or the port is taken; 3 `site/` not found next to the script;
4 python3 missing (`start.sh` only, with the message that names the Windows launcher and the
hosted site).

## Not done

No installer, no service, no start at login, no firewall change, no administrator rights.
