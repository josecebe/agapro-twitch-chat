# Templates

Each template owns a folder. The build discovers these folders and generates the runtime registry, stylesheets and StreamElements selector from the same catalog.

```text
src/templates/
  registry.mjs
  classic/
    config.json
    style.scss
  bubble-chat/
    config.json
    style.scss
    presentation.mjs
```

To add a template:

1. Create a folder whose name matches its stable `id`.
2. Add `config.json` with `id`, `name`, optional numeric `order`, and its own settings and CSS variables.
3. Add `style.scss`, scoped to `#chat[data-template='your-id']`. Shared message nodes and classes are defined by the renderer.
4. Optionally add `presentation.mjs`. Its default export receives this template's config and returns presentation hooks.
5. Run `npm run build`. The template appears in the selector and all platform bundles automatically. `npm run watch:css` also regenerates development CSS and the template bundle when template files change.

Example config:

```json
{
    "id": "minimal",
    "name": "Minimal",
    "order": 20,
    "variables": {
        "--minimal-radius": "8px"
    }
}
```

`variables` become scoped CSS custom properties. `settings` holds private values consumed by that template's presentation factory. `presentation` can configure `glyphSpacing` and `paintActionText`; both default to `true`. Exactly one template has `default: true`, which supplies the fallback for unknown IDs.

The optional factory can implement:

- `authorColor(row, color, { hasUserColor })`: decorate the author's shared row and return its text color. `hasUserColor` distinguishes a valid Twitch color from the shared fallback, even when their color values happen to match.
- `styleBody(node)`: decorate the shared message body after its content is rendered.
- `paintAuthor(node, paint)`: return `undefined` to use the common text-paint renderer, an empty string to handle clearing a paint, or a background string when the template renders the paint itself. Image failures are still handled by the shared renderer.

Channels, filters, fonts, message limits, media settings and other user controls belong to the shared `config.js`. Template configs never merge into that object. Private template settings do not generate additional StreamElements control groups. No template registers chat connections, handles events or replaces the HTML structure.

`styles.css` and `templates.js` at the project root are generated development files. Standalone exports embed their contents and need no additional template files at runtime.
