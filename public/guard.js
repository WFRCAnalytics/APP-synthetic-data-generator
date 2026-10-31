// Shown instead of a blank page when the app is opened straight from a file (specs/004 FR-008).
//
// Browsers refuse to start the app's scripts and workers for a page opened from disk, so without this the
// analyst would see an empty page. This is a plain script (not a module), which browsers do run from disk.
// On a served page (the web site, or the launcher in the offline release) it does nothing. It makes no
// request, holds no data and uses no inline code, so the content policy is unchanged.
(function () {
  if (location.protocol !== "file:") return;

  var root = document.getElementById("root") || document.body;
  var box = document.createElement("main");
  box.id = "offline-guard";
  box.setAttribute("role", "alert");
  box.style.cssText = "max-width:40rem;margin:3rem auto;padding:0 1rem;font:16px/1.5 system-ui,sans-serif;";

  function add(tag, text) {
    var el = document.createElement(tag);
    el.textContent = text;
    box.appendChild(el);
    return el;
  }

  add("h1", "This page cannot run from a file");
  add("p", "Browsers do not let a page opened straight from a folder start the app's background workers and WebAssembly, so it would stay blank. Nothing is wrong with your download.");
  add("p", "Open it with the launcher in the folder you unzipped instead:");
  var list = document.createElement("ul");
  ["Windows: double-click start.cmd.", "macOS or Linux: run ./start.sh in a terminal."].forEach(function (line) {
    var item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  });
  box.appendChild(list);
  add("p", "The launcher shows the app to your browser from this folder, on this computer only; nothing is sent anywhere. README.txt in the same folder explains it in one page.");

  root.appendChild(box);
})();
