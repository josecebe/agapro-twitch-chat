# Agapro Twitch Chat Widget

A transparent Twitch chat widget for OBS, StreamElements, and Streamlabs.

Ready-to-use files are included in `dist/`. You can install them directly; rebuild only when updating the widget or its root configuration.

## 1. Build

Install **Node.js 20.19 or later**, then run these commands from the project folder:

```sh
npm ci
npm run build
```

On Windows, you can open `build.cmd` instead. It installs missing dependencies and builds all versions.

The results are:

- `dist/local/` for an OBS local browser source.
- `dist/streamelements/` for a StreamElements Custom Widget.
- `dist/streamlabs/` for a Streamlabs Custom Widget.

Node.js is only needed to build. Using the widget requires an Internet connection.

## 2. Install in OBS

1. Open `dist/local/config.js` in a text editor.
2. Set `sources` to your Twitch channel login, without `@` or `#`:

    ```js
    sources: [
        { provider: 'twitch', channel: 'your_twitch_login' }
    ],
    ```

3. In OBS, add a **Browser** source.
4. Enable **Local file** and select `dist/local/index.html`.
5. Start with **450 px width**, **800 px height**, and **30 FPS**, then adjust the size and position for your scene.
6. Send a message in your Twitch channel to check that it appears.

Keep `index.html` and `config.js` together when moving the widget folder.

To show multiple channels, add another entry to `sources`. Set `enabled: false` on an entry to disable it.

## 3. Install in StreamElements

1. Add a **Custom Widget** to your overlay and open its editor.
2. Copy the contents of each file into the matching tab:

    | File in `dist/streamelements/` | Editor tab |
    | ------------------------------ | ---------- |
    | `index.html`                   | HTML       |
    | `style.css`                    | CSS        |
    | `index.js`                     | JS         |
    | `fields.json`                  | Fields     |
    | `data.json`                    | Data       |

3. Open the widget settings. Under **Channels → Channel source**, select:
    - **Associated overlay channel** to use the overlay's channel.
    - **Custom channels** to enter one or more Twitch logins, separated by commas.
4. Adjust the appearance and save the widget and overlay.
5. Add the overlay URL as a **Browser** source in OBS.

## 4. Install in Streamlabs

1. Open the [Streamlabs Custom Widget editor](https://streamlabs.com/dashboard#/widgets/customwidget).
2. Open **Custom Code → Edit Custom Code** and copy each file into its matching tab:

    | File in `dist/streamlabs/` | Editor tab |
    | -------------------------- | ---------- |
    | `index.html`               | HTML       |
    | `style.css`                | CSS        |
    | `index.js`                 | JS         |

3. At the top of the JS tab, set `config.sources` to your Twitch channel login(s), and adjust the other settings there. The build copies defaults from the root `config.js`.
4. Save, then add the Custom Widget URL as a Browser source in OBS or add the Custom Widget source in Streamlabs Desktop.

This version connects directly to Twitch, including moderation and Shared Chat, using the same chat engine as the local version. Channels are entered explicitly in `sources`, for example `sources: [{ provider: 'twitch', channel: 'your_twitch_login' }]`. Settings live in the JS configuration; the Custom Fields tab is not used. No StreamElements Fields/Data files are needed.

See the [Streamlabs Custom Widget guide](https://support.streamlabs.com/hc/en-us/articles/46771000147739-How-to-Get-Started-with-Streamlabs-Custom-Widgets) for editor and browser-source setup.

## 5. Use and customize

For the local version, edit `dist/local/config.js`, save it, and use **Refresh cache of current page** in the OBS source properties.

For StreamElements, change the widget settings and save the overlay.

For Streamlabs, edit the readable `config` object at the top of the JS tab and save the widget.

You can adjust fonts, text/emote/badge sizes, colors, backgrounds, shadows, message limits, spacing, replies, GIFs, and 7TV effects. In local configuration, use `true` and `false` without quotes.

- **Style template:** `template: 'classic'` (the default) preserves the existing appearance and all your appearance settings. Select **Appearance → Style template → Bubble Chat** in StreamElements, or set `template: 'bubble-chat'` in local/Streamlabs configuration, for the built-in Animal Crossing bubble style: colored name pills, rounded translucent black message backgrounds, Aclonica usernames and Arial Black messages. **Text size** (`fontSizePx`) controls the username and message size in both templates; reply text scales proportionally. In Bubble Chat, **Background color and opacity** controls the text bubble background, including full transparency, without changing the name pill. Ordinary text bubbles fit their content and can grow to the full available width for long messages. First messages and Channel Points messages always fill the available width; name pills keep their natural width. **First-message color and opacity** sets the first-message bubble background when **First-message background** is enabled. Message spacing uses `messageGapPx` in both templates. Local and Google Font controls for the general font, usernames, and message text work in both templates, including inheritance from the general font when a role is empty. Interline spacing, reply spacing, badge size and emote size also use the shared settings. Emote-only bubbles enlarge emotes relative to the configured emote size, and long messages have no theme-specific height limit. All **Typography** controls are shared: size, fonts, bold usernames/mentions, localized logins, message color/opacity and text shadow; switching back to Classic restores those controls' values. Channels, filters, replies, moderation and other chat behavior remain shared. Both templates use the same HTML and chat engine.

- **Language:** English is the default. Use `language: 'es'` for Spanish, or select **Language → Chat language** in StreamElements.
- **Message spacing:** `messageGapPx` sets the space between messages; `replyGapPx` sets the space below reply headers. Use `0` for no additional gap.
- **Message lifetime:** `messageLifetimeSeconds: 0` keeps messages until they leave the display or are removed. Set a positive value to expire them after that many seconds.
- **Line height:** `messageLineHeight` is a multiplier of the visible letter height of the message font (tallest ascender to lowest descender): `1` makes consecutive lines practically touch, `2` doubles that spacing, and so on up to `3`. Emotes and emoji taller than the text can overlap slightly at `1`.
- **Shared Chat channel icon:** while a Twitch Shared Chat session is active, every message shows its origin channel's avatar as the first badge, so you can tell which streamer's chat it came from. It appears even when badges are hidden. Turn it off with **Badges, icons and paints → Shared Chat: show origin channel icon first** or `showSharedChatIcon: false`.
- **Nick gradients:** enable **Typography → Gradient for normal Twitch nick colors**, or set `usernameGradient: true`, to shade the normal nick color from a slightly lighter top through its original color in the middle to a darker bottom. Bubble Chat applies it to the name pill and keeps the letters white; Classic applies it to the nickname text. Mentions and the "reply to" user use the same gradient as plain text. Equipped 7TV paints take priority. Disabled by default.
- **Highlighted messages:** Twitch highlighted messages use the same animated pastel background in both templates. Classic displays it in a box with the same border and corners as first messages. Reduced-motion settings keep the gradient static.
- **GIFs:** `showTwitchGifs: true` displays images. With `false`, they appear as a `GIF` label.
- **Fonts:** local font families must be installed on the OBS computer. Use the Google Font settings to load an online font instead.

To keep local configuration changes across builds, also update the root `config.js`: rebuilding replaces `dist/local/config.js` with that file.

### Preview and connection status

Open `demo.html` to preview sample messages, or enable `demo: true` in local configuration. In StreamElements, enable **Demo mode**. Disable the demo to return to live chat.

Open `diagnostics.html` or enable `debug: true` to display connection status and errors. In StreamElements, enable **Show diagnostics**. Disable diagnostics before broadcasting so the panel is not visible in your scene.

In Streamlabs, set `demo: true` or `debug: true` in the JS configuration to preview sample messages or inspect connection status. Set them back to `false` for normal use.

## 6. Rebuild after editing the widget

Run `npm run build` after changing the widget source, then refresh the OBS source or copy the updated files into StreamElements or Streamlabs again. To keep Streamlabs configuration edits across builds, also update the root `config.js`.

Shared styles are edited in `src/styles.scss`; each template owns its stylesheet under `src/templates/`. Run `npm run build:css` to regenerate the development stylesheet and template bundle, or `npm run watch:css` to regenerate them while editing.

### Theme implementation

Each template has its own `src/templates/<id>/config.json` and `style.scss`, plus an optional `presentation.mjs`. The build discovers templates and generates registration, CSS and the StreamElements selector automatically. `src/templates/registry.mjs` resolves IDs through a map; the shared renderer contains no per-template branches. Template configuration stays separate from shared user settings and chat behavior. Shared highlighted-message backgrounds live in `src/styles/_highlight.scss`.

See [the template guide](src/templates/README.md) for the folder format and presentation hooks.
