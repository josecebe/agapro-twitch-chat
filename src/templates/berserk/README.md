# Berserk

The template owns its layout, presentation hooks and asset preparation. It shares
the widget's chat engine and user controls, without importing Bubble Chat.

## Assets and build

Run `npm run build` after changing any asset. `npm run watch:css` also watches the
template assets. No separate preparation commands are needed.

- `assets/tip.png` and `assets/hilt.png` keep their aspect ratios. Their widths are
  calculated from the actual PNG dimensions and `--berserk-sword-height`.
- `assets/blade.png` fills the space between the caps and stretches with the nick.
- `assets/texture.png` supplies the message background, without a color tint.
- Each folder in `assets/bubbles/` supplies one bubble style. Folder names may
  contain letters, numbers, hyphens and underscores.

Add `assets/bubbles/your-style/bubble.svg`, then build. The build regenerates
`bubble-top.svg`, `bubble-bottom.svg`, `bubble-left.svg` and `bubble-right.svg`.
The cuts use the proportions of the original 1920×1080 design: 122 units at each
side, 128 at the top and 99 at the bottom. SVGs of other sizes scale these cuts
proportionally. The master SVG is authoritative; edit it rather than its cuts.
A folder with four manually prepared pieces and no master SVG is also supported.

Local and self-contained exports embed the assets; hosted StreamElements exports
publish the images separately. `_bubble.scss`, `_sword.scss` and
`_texture.scss` are generated intermediates, ignored by Git. Preparation writes
only changed files so watch mode does not loop.

## Appearance

Each new message selects a different base from the previous message and one of
four CSS orientations: normal, horizontal, vertical or both. With one base,
consecutive messages use different orientations. Emote refreshes and resizing
keep the chosen base, orientation and texture crop.

The assembled mask uses fixed corners, vertically stretched sides and
horizontally stretched top/bottom edges. `--berserk-bubble-edge-scale` controls
their thickness. Eight SVG edge/corner masks and an opaque centre are combined
using standard CSS `mask-image`, supported in Firefox and Chromium. One continuous
texture sits under the whole mask. Each message
selects a random crop at native resolution, without tiling; only a panel larger
than the texture stretches the oversized dimension.

The panel fits its message text or media independently of the sword. Its padding
is configured separately through `--berserk-message-padding-top`,
`--berserk-message-padding-inline` and `--berserk-message-padding-bottom`.
Nicknames stay on one line without truncation; the complete sword may extend
past the chat container. Message panels still wrap to the available chat width.
The shared `chatMaxWidthPx` setting caps the whole chat container, including its
padding, at 525 pixels by default; it does not constrain the sword.
The browser/OBS source viewport remains the outer rendering limit.

The shared **Background opacity** control (`messageBackgroundOpacity`, 0–1)
controls the texture and its shadow together. Text, emotes and the sword remain
opaque. **Background color** applies to solid-background templates and does not
tint this texture.

Highlighted messages overlay the shared animated color gradient on the same
texture and mask. Only the gradient moves; the native texture crop stays fixed.
First-message background color takes priority when both notices apply, and
reduced motion keeps the highlight static.

`--berserk-shape-shadow` supplies the same single shadow for the complete sword
and the complete bubble. The bubble has one decorative outer layer to let the
shadow extend beyond the mask; individual mask pieces have no shadows.

## Blood disappearance

Select **Appearance / Message removal effect / Blood burst** or set
`moderationAnimation: 'blood'`. Moderated and expired messages disappear
immediately and emit decorative red droplets from the message panel. Drops
scatter, fall with gravity and fade in roughly a second. The effect retains no
message text or images, shares one bounded canvas and animation loop, and respects
`enableAnimations` and reduced motion. Dust and None remain available.
