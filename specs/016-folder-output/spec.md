# Feature Specification: Save everything at once

**Status**: Complete

After a run, the Generate screen offers "Download all (zip)" in every browser: one zip with the fake file, the spec and the README for
agents. Chrome and Edge also offer "Save to a folder", which writes the same three files into a folder the person picks (files with the
same names are replaced) and says where they went.

- **FR-001**: The zip MUST hold exactly the three files, byte-identical to the separate downloads, and be the same bytes for the same files.
- **FR-002**: Nothing leaves the device; the folder button appears only where the browser can write to a chosen folder.
- **FR-003**: Closing the folder picker writes nothing and shows no error.
