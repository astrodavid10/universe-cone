// The story's steps. Titles, detail lines and the scale notes are the dome captions verbatim (cone.json
// steps[k].caption, trueScale); the body text, evidence tiers and "next" labels are the web's own.
// Tiers follow the kit README's "Real or schematic" table.

export type Tier = "MEASURED" | "MODELED" | "SCHEMATIC";

export interface Step {
  k: number;
  id: string;
  /** Short name for the step strip. */
  short: string;
  title: string;
  detail: string;
  body: string;
  tiers: Tier[];
  next: string;
}

export const STORY_NOTE = "Time is stretched so every era shows (not to scale)";
export const TRUE_NOTE = "True scale: time runs evenly, and the width follows the real expansion of space";

export const STEPS: Step[] = [
  {
    k: 0, id: "intro", short: "Start",
    title: "The history of the universe as a cone",
    detail: "13.8 billion years, from the Big Bang at the tip to today at the wide end",
    body: "Time runs along the cone and its width shows the size of the universe. Press play to build it "
      + "era by era, or step through at your own pace. Drag to turn it; pinch or scroll to zoom.",
    tiers: [],
    next: "Begin",
  },
  {
    k: 1, id: "bigbang", short: "Big Bang",
    title: "The Big Bang",
    detail: "13.8 billion years ago, space begins to expand",
    body: "Everything we can see today was packed into a hot, dense state, and space itself began to "
      + "stretch. It is still stretching. The universe was a glowing plasma too hot for atoms to hold together.",
    tiers: ["MODELED", "SCHEMATIC"],
    next: "First light",
  },
  {
    k: 2, id: "firstlight", short: "First light",
    title: "The first light",
    detail: "380,000 years in, the glow we still see as the cosmic microwave background",
    body: "Once the universe cooled enough for atoms to form, light could finally travel freely. That "
      + "light is still arriving, stretched into microwaves. The disc is the real map of it made by ESA's "
      + "Planck satellite. Tap it to learn more.",
    tiers: ["MEASURED"],
    next: "The dark ages",
  },
  {
    k: 3, id: "darkages", short: "Dark ages",
    title: "The dark ages",
    detail: "Hydrogen gas fills space, with no stars yet to light it",
    body: "For a hundred million years and more, the universe was dark: cooling hydrogen and helium gas, "
      + "slowly pulled into clumps by gravity. The violet haze stands for that neutral gas.",
    tiers: ["MODELED", "SCHEMATIC"],
    next: "First stars",
  },
  {
    k: 4, id: "firststars", short: "First stars",
    title: "First stars and reionization",
    detail: "Ultraviolet light from the first galaxies burns away the hydrogen fog",
    body: "About 200 million years after the Big Bang the first stars ignited. Their ultraviolet light "
      + "stripped hydrogen atoms apart, opening bubbles of clear space that grew and merged until, "
      + "about a billion years in, the fog was gone.",
    tiers: ["MODELED", "SCHEMATIC"],
    next: "Galaxies grow",
  },
  {
    k: 5, id: "galaxies", short: "Galaxies",
    title: "Galaxies grow",
    detail: "Star formation peaks about 10 billion years ago, and galaxies settle into today",
    body: "Galaxies merged and grew. Stars formed fastest around 10 billion years ago, and the pace has "
      + "slowed ever since. Every picture is a real galaxy, but a nearby one standing in for its era. "
      + "Tap one to see which.",
    tiers: ["MEASURED", "SCHEMATIC"],
    next: "Looking back",
  },
  {
    k: 6, id: "lookback", short: "Look back",
    title: "Looking back in time",
    detail: "Light from the first galaxies arrives stretched from ultraviolet to infrared",
    body: "This light left a galaxy about 330 million years after the Big Bang. As space expanded during "
      + "its 13-billion-year trip, its waves stretched with it, from ultraviolet to infrared. That is why "
      + "an infrared telescope like JWST can see the first galaxies.",
    tiers: ["MODELED"],
    next: "The true scale",
  },
  {
    k: 7, id: "truescale", short: "True scale",
    title: "The true scale of time",
    detail: "Each white ring is one billion years, and the first stars and galaxies are all in the tip",
    body: "Until now, time was stretched so the early eras had room. Here it runs evenly, and the width "
      + "follows how much space has really expanded. Everything in steps 1 to 4 happened in the narrow tip.",
    tiers: ["MODELED"],
    next: "Start again",
  },
];
