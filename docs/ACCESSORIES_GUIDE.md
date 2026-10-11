# SVGTuber Modular Accessories & Dressing Room Guide

SVGTuber supports **modular external accessories**—standalone SVG files that attach directly to your avatar's rigged skeleton in real time.

Instead of permanently embedding every prop, hat, pair of glasses, or expression effect into your main avatar SVG file, you can draw them as separate SVGs and position, scale, anchor, and toggle them on the fly across different avatars.

---

## 🎩 What Can Be an Accessory?

Accessories can be any self-contained SVG graphic:
- **Headwear & Eyewear:** Hats, beanies, crowns, sunglasses, monocles, cat/fox ears.
- **Costumes & Props:** Capes, scarves, microphones, handheld game controllers, bubble tea.
- **Dynamic Expression Props:** Sweat drops, blush overlays, anger veins, tears, sparkly eyes.
- **Companions & Floating Pets:** Floating mascots or stream chat familiars anchored to your shoulders or head.

---

## 📁 Where to Place Accessories

Place your `.svg` accessory files into an `accessories/` folder:
- Next to your avatar: `<avatar_directory>/accessories/*.svg`
- Or in the project root: `./accessories/*.svg` (or `testdata/accessories/`)

SVGTuber automatically scans this directory on startup and lists all available SVG files in the Studio dashboard.

---

## 🪞 Using the Studio Dressing Room

SVGTuber features a built-in **interactive Dressing Room modal** for visual calibration:

1. Open the Studio dashboard (`http://localhost:7420/studio`).
2. Scroll to the **Accessories & Props** section.
3. Click **Add Accessory** (or click the 👗 **Dressing Room** button on any configured accessory).
4. In the Dressing Room modal:
   - **Direct Dragging:** Click and drag the accessory directly on top of your avatar preview to position it.
   - **Mouse Wheel Scaling:** Scroll your mouse wheel over the accessory to scale it up or down smoothly.
   - **Keyboard Arrow Nudging:** Use the Arrow keys on your keyboard for 1-pixel precision nudges (`Shift + Arrow` for 10-pixel jumps).
   - **Target Anchor:** Choose which avatar layer the accessory attaches to (e.g., `layer_head`, `Head`, `Body`). When your avatar tilts, rolls, or breathes, the accessory tracks that layer's exact transforms and pivots.
   - **Stacking Order:** Set whether the accessory renders in `Front` (foreground, e.g. sunglasses/hat) or in `Back` (background, e.g. wings/cape behind the character).
   - **Expression Trigger:** Choose whether the accessory is **Always Visible** or only appears when a specific expression is triggered (e.g., `blush`, `sweat`, `angry`).
   - Click **Save Accessory** to persist the changes.

---

## 🎭 Expression-Triggered Accessories

Accessories can be tied to avatar expressions so they appear only when triggered:

- **Built-in & Discovered Expressions:** Select any expression discovered in your avatar rig (such as `blush`, `sweat`, `wink`, `isSweat`, `isBlush`).
- **Custom Expression Triggers:** You can type any custom expression identifier into the dropdown. Triggering that expression via Stream Deck, hotkeys, or API will instantly show the accessory.
- **Directives Inside Accessories:** Accessory SVGs can contain their own animation directives!
  For example, a `sweat_drop.svg` can declare:
  ```xml
  <svg id="sweat_drop" [Expression {name: sweat}] [Show {when: isSweat}] [Bounce {height: 4; squash: 0.05}]>
    ...
  </svg>
  ```
  SVGTuber will automatically parse and register `sweat` into Studio's expression triggers, broadcast its hotkey, and animate it with bouncy physics when active.

---

## 👤 Per-Avatar Anchoring & Isolation

Every avatar has unique proportions, head heights, and layer names. SVGTuber saves all accessory placements, scales, and target anchors **per avatar**:

- Switching avatars in Studio (`/api/avatar/select`) automatically switches to that specific avatar's configured accessories.
- Calibrating a hat on `chibi_avatar.svg` will not alter or misalign glasses calibrated on `tall_avatar.svg`.
- **Intelligent Anchor Fallbacks:** The overlay engine automatically matches target layers across different authoring software:
  - **Inkscape:** `#layer_head`, `inkscape:label="Head"`
  - **Vectorcraft:** `data-name="Head [Follow ...]"`
  - **Adobe Illustrator:** `#Head`
  - Even if target layers vary between avatars, the accessory maintains its anchor tracking cleanly.

---

## 🌐 REST API Endpoints

Accessories can be managed or automated remotely via REST:

| Endpoint | Method | Description |
|---|---|---|
| `/api/accessories?avatar=<name>` | `GET` | Get available accessory files and current configured accessories (optional `?avatar=` filters by avatar). |
| `/api/accessories/update?avatar=<name>` | `POST` | Add or update an accessory configuration (ID, file, target, X, Y, scale, rotation, order, expression). |
| `/api/accessories/toggle?avatar=<name>` | `POST` | Toggle an accessory on or off (`{"id": "cool_shades"}`). |
| `/api/accessories/remove?avatar=<name>` | `POST` / `DELETE` | Remove an accessory from the avatar (`{"id": "cool_shades"}`). |
| `/accessories/<file.svg>` | `GET` | Serves the raw accessory SVG file with proper caching headers. |
