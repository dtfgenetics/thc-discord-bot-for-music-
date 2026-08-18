# THC Discord Music Bot

This repository is now the **canonical implementation** for the DTF/THC community music bot. The similarly named `dtfgenetics/thc-music-bot-for-discod` repository is a duplicate pointer and must not receive separate production code.

## What this version does

- Slash-command Discord bot.
- Anyone in the active voice channel can use the playback controls.
- Per-server queue.
- `/join`, `/play`, `/queue`, `/now`, `/skip`, `/stop`, and `/leave` commands.
- Bot joins the caller's voice channel and keeps playback state scoped to that Discord server.
- Public HTTP/HTTPS audio URLs only in this first implementation.
- Rejects localhost, private-network, link-local, and loopback destinations before FFmpeg receives a URL.
- Queue length and lightweight command-rate limits reduce accidental/abusive flooding.

## Audio-source rule

This bot does **not** contain a scraper, downloader, DRM bypass, or service-specific resolver. `/play` accepts a direct public audio URL that the server/user is authorized to stream. A future resolver may be added only after its provider terms, licensing, security, and reliability are reviewed.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Give the bot `View Channel`, `Connect`, and `Speak` access in the servers/channels where it should operate.
3. Copy `.env.example` values into your hosting environment. Never commit the bot token.
4. Install dependencies with `npm install`.
5. Start with `npm start`.

`DISCORD_GUILD_ID` is optional. When supplied, commands are registered to that single guild for rapid testing. Without it, the bot registers global application commands.

## Hosting

The runtime needs Node.js, outbound HTTPS/DNS access, and FFmpeg. This repo includes `ffmpeg-static` so a separate system FFmpeg install is not required for the supported platform package.

## Security boundaries

- Secrets are environment-only.
- Users must be in a voice channel to control playback.
- If the bot is already connected, controls must come from that same voice channel.
- URLs are resolved and checked before playback to reduce SSRF risk.
- The browser/web stack is not involved; Discord interaction payloads are handled by discord.js.

## Status

`implementation-alpha` — actual bot code, queue logic, URL policy, tests, and CI are committed. Live deployment still requires a Discord application token and a persistent Node host.
