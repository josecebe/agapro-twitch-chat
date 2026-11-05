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

- **Language:** English is the default. Use `language: 'es'` for Spanish, or select **Language → Chat language** in StreamElements.
- **Message spacing:** `messageGapPx` sets the space between messages; `replyGapPx` sets the space below reply headers. Use `0` for no additional gap.
- **Message lifetime:** `messageLifetimeSeconds: 0` keeps messages until they leave the display or are removed. Set a positive value to expire them after that many seconds.
- **GIFs:** `showTwitchGifs: true` displays images. With `false`, they appear as a `GIF` label.
- **Fonts:** local font families must be installed on the OBS computer. Use the Google Font settings to load an online font instead.

To keep local configuration changes across builds, also update the root `config.js`: rebuilding replaces `dist/local/config.js` with that file.

### Preview and connection status

Open `demo.html` to preview sample messages, or enable `demo: true` in local configuration. In StreamElements, enable **Demo mode**. Disable the demo to return to live chat.

Open `diagnostics.html` or enable `debug: true` to display connection status and errors. In StreamElements, enable **Show diagnostics**. Disable diagnostics before broadcasting so the panel is not visible in your scene.

In Streamlabs, set `demo: true` or `debug: true` in the JS configuration to preview sample messages or inspect connection status. Set them back to `false` for normal use.

## 6. Rebuild after editing the widget

Run `npm run build` after changing the widget source, then refresh the OBS source or copy the updated files into StreamElements or Streamlabs again. To keep Streamlabs configuration edits across builds, also update the root `config.js`.

Styles are edited in `src/styles.scss`. To rebuild only the development stylesheet, run `npm run build:css`; to rebuild it automatically while editing, run `npm run watch:css`.
