# Backgrounds for Paseo

Choose one of six bundled landscapes or a direct HTTPS image URL. Tune image strength, interface background opacity, blur, brightness, fit and placement. Preview locally, save to the connected host, or discard your changes.

Open **Backgrounds** in the sidebar or host plugin settings. The Command Center includes **Open background settings** and **Toggle background**. New installs start with the background off.

Tested with the unmodified Paseo **0.13.0-beta.1** macOS desktop application and its corresponding Web client. The public `app.paseo.sh` client was still v0.12.0 during verification and needs a client update before it can use the v0.13 plugin API. Native mobile is outside this plugin's scope. Windows and Linux use the same renderer implementation but have not been tested in this release.

```sh
paseo plugin add git:MinLeeV5/paseo-background-plugins --ref v0.1.0
```

Saved preferences are shared by clients connected to the same host. Unsaved previews affect only the current window. HTTPS images are loaded by each client; local file upload is not included.

The plugin adapts selected layout surfaces with a browser image layer and scoped CSS. Paseo source files remain untouched. Menus, controls, editors, terminals and embedded websites retain their own backgrounds. This does not make the operating system window transparent. Internal layout changes in future Paseo versions may require an adapter update.

See the [README](README.md) for installation and verification details. Bundled artwork and plugin code are MIT licensed.
