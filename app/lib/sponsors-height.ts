/** The sponsors panel's height depends on how many sponsors there are and how
 * their names wrap, which the prerendered page cannot know. So this device
 * remembers the height the panel last had, with the window width it had it
 * at, and a head script (root.tsx) hands it to the placeholder as
 * `--sponsors-h` before the first paint. Its own module so root.tsx does not
 * pull the panel in. */
const KEY = "thedao:sponsors-height";

export const SPONSORS_SCRIPT =
  "if(location.pathname==='/')try{var s=JSON.parse(localStorage.getItem(" +
  JSON.stringify(KEY) +
  "));if(s[0]===innerWidth&&s[1]>0)document.documentElement.style.setProperty('--sponsors-h',s[1]+'px')}catch(e){}";

export function rememberSponsorsHeight(width: number, height: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify([width, height]));
  } catch { /* storage off: the placeholder keeps its own height */ }
}
