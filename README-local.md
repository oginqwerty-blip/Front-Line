# Front-Line Local Match

## Static backup

The current single-browser version was copied to:

`backups/front-line-static-complete-2026-06-28`

Open that folder's `index.html` if you want the preserved offline version.

## Local server

Double-click `start-front-line-local.bat`.

The terminal will print URLs such as:

- `http://127.0.0.1:8787/`
- `http://192.168.x.x:8787/`

Use `127.0.0.1` on this PC. On the second PC or phone, open the `192.168.x.x` URL while connected to the same Wi-Fi/LAN.

## Room play

The browser automatically adds a room code to the URL:

`?room=ABC123`

Share the full room URL with the second device.

The first browser in the room is assigned `North`.
The second browser in the room is assigned `South`.
Additional browsers are shown as `Spectator`.

The screen still shows the detected IP address, but seat assignment uses a browser ID so it works better online.

## Turn-end sync

The current local server keeps one shared match state.

Each browser receives the latest state from the server.
The browser sends its state to the server only when:

- `New Game` starts
- `End Turn` is pressed

During a turn, the opponent will not see each card movement immediately. The board updates on the other device after the current player ends their turn.

If the server was already running before this feature was added, close the `Front-Line Server` terminal window and start `start-front-line-local.bat` again.

## Online deployment

The app can run on Node hosting services.

Start command:

`npm start`

The server reads the port from `PORT`, which services such as Render usually provide automatically.

After deployment, open the generated URL. The page will add a room code automatically. Share that full URL with the second phone.
