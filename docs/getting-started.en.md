# Installation and usage

## Load the source version

1. Download and extract the source, or clone `https://github.com/leeguandong/bookmark-house.git`.
2. Open `chrome://extensions`, enable Developer mode, and choose Load unpacked.
3. Select the repository's `extension/` subdirectory.
4. Pin the icon to the toolbar. Open a regular webpage, save it, then use Open my collection to enter the manager.

Only Chrome 109+ is needed to load the source version. Node.js, Python and npm dependencies are for development checks.

## Choose a language

The first launch follows the browser language. Choose English or 简体中文 in the manager's top bar or save popup. The choice is remembered on this device and updates the extension's native context menu. Your saved content and custom folder or topic names are never translated.

## Save and revisit

Use the toolbar, a webpage or link context menu, or the default keyboard shortcut (`Alt+Shift+S` on Windows / Linux; `Command+Shift+S` on macOS). Customize shortcuts at `chrome://extensions/shortcuts`.

In the manager you can paste a URL or shared text containing a link, or drop an address-bar URL or webpage link. Dragging an entire Chrome tab is not supported.

Cards display available covers, excerpts and notes by save date. Search, star, edit, delete or mark them as read. Extraction depends on the webpage and may require keeping the original page open or granting access to its site.

## Native bookmarks

Expand Bookmark library to browse Chrome's real folders. Drop a card onto a folder to move it, or right-click a folder for actions. Changes affect native bookmarks and may sync according to Chrome's settings.

A webpage card and a native bookmark of the same URL are separate copies. Deleting one keeps the other. Organization plans are previewed before you apply them.

## Updates and migration

Update files in the original source directory, reload the extension at `chrome://extensions`, then refresh the manager. Do not uninstall the original extension first: uninstalling removes that extension ID's local data.

Before changing directories or installation sources, export web-collection JSON from the original installation and check the import in the new one. Different extension IDs do not automatically share local card data. Native bookmarks remain managed by Chrome.

## Recovery and backup

Trash is viewed and restored by source. A pre-cleanup recovery backup is retained before permanent clearing until a later backup replaces it or local extension data is removed. Export important content separately.

Backups may contain private information. Keep them in a location you control and never commit them to the source repository. See Privacy inside the extension for the full English data policy.
