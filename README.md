# Kingshot Command learned skills

This branch is only the update feed for Kingshot Command's **Update** button (Teacher page).
It has nothing to do with the website on the main branch.

- `latest.json` – what the app checks: newest version, its zip and the zip's SHA-256
- `kingshot-app-X.Y.Z.zip` – app code for the one-click app update (the "app" entry in latest.json)
- `kingshot-setup-X.Y.Z.exe` – full installer, used by the Update button when an update changes Python/Qt
- `kingshot-skills-N.zip` – a skill pack (pack.json + screen templates), made from Teacher lessons

Every pack is checked by the app before it is used, and **Undo last update** puts the previous one back.
