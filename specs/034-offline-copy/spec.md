# Slice 34: The app keeps working without internet

Opening the hosted page and then losing the network used to break the app: the data engine (36 MB) and the file readers are fetched only
when a file is first opened, so a connection that went away after the page loaded stopped the profiling worker.

- The hosted page registers a small service worker (`sw.js`, built from `src/sw/sw.template.js`) that keeps the **app's own files** and
  nothing else: the page, its scripts, the engine and the readers. It never sees a file you open, and it does not handle any request to
  another site.
- A few seconds after the page loads, the page asks it to fetch the files of the engine this browser runs (about 46 MB, once) while
  there is a network. After that the page, and every kind of file, work with the network off, including a fresh visit.
- The page is fetched first so an update arrives; its copy is only for when there is no network. A new version waits until the tabs of the
  old one are closed, and old copies are removed when it starts.
- The shield's monitor shows it: "Works without internet" says whether the files are saved, and "Saved in browser" counts cookies,
  storage and databases (always 0) apart from the cached app files. None of your data is kept.
- A copy that runs from a folder (the offline zip, 127.0.0.1) registers nothing and the zip does not contain `sw.js`; tests ask for the
  copy with `?cache`.
