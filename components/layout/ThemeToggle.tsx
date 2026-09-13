// The app is light only. The script pins the attribute so anything that once
// keyed on it (and a browser that saved "dark" earlier) renders light.
export function ThemeScript() {
  const js = `document.documentElement.setAttribute('data-theme','light');`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
