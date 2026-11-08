import { THEME_KEY } from "./theme-key";

// Light or dark, set before the page paints so a dark page never flashes
// white: the pick kept by ThemeButton, else the device's setting.
export function ThemeScript() {
  const js = `(function(){var t='light';try{var s=localStorage.getItem('${THEME_KEY}');t=s==='dark'||s==='light'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}document.documentElement.setAttribute('data-theme',t)})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
