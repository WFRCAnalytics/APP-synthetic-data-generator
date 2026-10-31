// Brand typefaces (Poppins body, Inter headings, Fira Code monospace), self-hosted.
//
// The reference Scoresheet app loads these from the Google Fonts CDN at runtime. This app must not
// make third-party requests (constitution Principle I; research.md R15), so the same families come
// from the @fontsource packages and are bundled as same-origin assets. tokens.css only names the
// families, so it is unchanged. Only the Latin subset is bundled (the app is English-only for v1).

import "@fontsource/poppins/latin-300.css";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/fira-code/latin-400.css";
import "@fontsource/fira-code/latin-500.css";
