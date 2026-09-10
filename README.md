# Push Flap — publish with GitHub Pages

**Live site: https://neiljpat.github.io/push-flap/**

This is the complete game, ready to host. No installation, server, API key, or build step is required.

## Publish from your browser

1. Unzip this download on your computer.
2. Sign in to GitHub and create a new repository named `push-flap`. Choose **Public** for GitHub Pages hosting on GitHub Free. You can initialize the repository with a README.
3. In the repository, choose **Add file → Upload files**. Drag the files and folders from INSIDE the extracted `push-flap` folder into the upload area. Upload the game files themselves, not the ZIP or its containing folder. Commit the changes to `main`.
4. Confirm `index.html`, `app.js`, `engine.js`, and `style.css` are at the top level of the repository, alongside the `assets` and `vendor` folders.
5. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**. Choose **main** and **/(root)**, then **Save**.
6. Wait for deployment to finish. The Pages settings screen will show a **Visit site** link. The normal address is `https://YOUR-USERNAME.github.io/push-flap/` — for this repository, https://neiljpat.github.io/push-flap/.
7. Open the HTTPS address on your phone or computer. Choose **Enable camera**, allow camera access, and follow the two-position calibration. You can also play with taps or Space.

The website will be public and playable without ChatGPT. A public repository also makes its source code visible. Camera frames stay on the player's device; they are never recorded or uploaded. Each device keeps its own best scores.

## Camera and gameplay

Place the front camera near the floor, pointing toward your face. During setup, hold the high and low positions as instructed. The bird follows your calibrated head height. Tracking loss freezes play until your face returns. The camera mode needs browser camera permission and an HTTPS site. Test on your actual phone after publishing; live-camera testing was not performed during development.

Keyboard: Space or Arrow Up to flap in tap mode; P to pause; R to restart.

## Updating the game

Upload changed files into the same repository and commit them to the publishing branch. GitHub Pages publishes those changes automatically. Keep the `assets` and `vendor` folders intact: they contain the bird artwork and the local head-tracking runtime.

## Included software

The original game source and original generated bird sprite are included. MediaPipe Tasks Vision 0.10.32 and the version 1 BlazeFace short-range float16 model are bundled locally; their Apache license is in `vendor/LICENSE`.

## Official instructions

- GitHub Pages publishing setup: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- GitHub Pages HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Browser camera access: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
