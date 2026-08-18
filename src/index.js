import { spawn } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} from '@discordjs/voice';

import { GuildQueue } from './queue.js';
import { assertPublicHttpUrl } from './url-policy.js';

const token = process.env.DISCORD_TOKEN;
const testGuildId = process.env.DISCORD_GUILD_ID || null;
const maxQueueLength = Number.parseInt(process.env.MAX_QUEUE_LENGTH || '50', 10);

if (!token) throw new Error('DISCORD_TOKEN is required.');
if (!ffmpegPath) throw new Error('ffmpeg-static did not provide a compatible FFmpeg binary.');
if (!Number.isInteger(maxQueueLength) || maxQueueLength < 1 || maxQueueLength > 250) {
  throw new Error('MAX_QUEUE_LENGTH must be an integer from 1 to 250.');
}

const commandDefinitions = [
  new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel.'),
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Queue a direct public audio URL.')
    .addStringOption((option) => option.setName('url').setDescription('Public HTTP/HTTPS audio URL').setRequired(true))
    .addStringOption((option) => option.setName('name').setDescription('Optional display name').setMaxLength(100)),
  new SlashCommandBuilder().setName('queue').setDescription('Show the current server queue.'),
  new SlashCommandBuilder().setName('now').setDescription('Show the currently playing track.'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue.'),
  new SlashCommandBuilder().setName('leave').setDescription('Stop playback and leave voice.')
].map((command) => command.setDMPermission(false));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const guildStates = new Map();
const userCooldowns = new Map();

function stopFfmpeg(state) {
  if (state.ffmpeg && !state.ffmpeg.killed) state.ffmpeg.kill('SIGKILL');
  state.ffmpeg = null;
}

function trackLabel(track) {
  return track?.name || track?.url || 'Unknown track';
}

function makeGuildState(guildId) {
  const queue = new GuildQueue(maxQueueLength);
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
  });

  const state = {
    guildId,
    queue,
    player,
    connection: null,
    ffmpeg: null
  };

  player.on(AudioPlayerStatus.Idle, () => {
    stopFfmpeg(state);
    const next = queue.finishCurrent();
    if (next) playCurrent(state).catch((error) => {
      console.error(`[${guildId}] Failed to advance queue:`, error);
      player.stop(true);
    });
  });

  player.on('error', (error) => {
    console.error(`[${guildId}] Audio player error:`, error);
    stopFfmpeg(state);
    player.stop(true);
  });

  return state;
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) guildStates.set(guildId, makeGuildState(guildId));
  return guildStates.get(guildId);
}

async function playCurrent(state) {
  const track = state.queue.current;
  if (!track) return;
  if (!state.connection) throw new Error('Voice connection is not available.');

  stopFfmpeg(state);

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-i', track.url,
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-f', 's16le',
    'pipe:1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  state.ffmpeg = ffmpeg;
  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', (chunk) => console.warn(`[${state.guildId}] ffmpeg: ${chunk.trim()}`));
  ffmpeg.on('error', (error) => {
    console.error(`[${state.guildId}] FFmpeg failed:`, error);
    state.player.stop(true);
  });
  ffmpeg.on('close', (code) => {
    if (code && code !== 0 && state.player.state.status !== AudioPlayerStatus.Idle) {
      state.player.stop(true);
    }
  });

  const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
  state.player.play(resource);
}

async function connectToMemberVoice(interaction, state) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new Error('Join a voice channel first.');

  const existingChannelId = state.connection?.joinConfig?.channelId;
  if (existingChannelId && existingChannelId !== channel.id) {
    throw new Error('The bot is already active in another voice channel in this server. Join that channel to control it.');
  }

  if (state.connection?.state?.status === VoiceConnectionStatus.Ready) return channel;

  if (state.connection) {
    try { state.connection.destroy(); } catch { /* already destroyed */ }
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: true
  });

  state.connection = connection;
  connection.subscribe(state.player);
  connection.on('stateChange', (_oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Destroyed && state.connection === connection) {
      state.connection = null;
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  return channel;
}

function assertSameVoiceChannel(interaction, state) {
  const memberChannelId = interaction.member?.voice?.channelId;
  if (!memberChannelId) throw new Error('Join the active voice channel first.');
  const botChannelId = state.connection?.joinConfig?.channelId;
  if (botChannelId && botChannelId !== memberChannelId) {
    throw new Error('Join the same voice channel as the bot to use playback controls.');
  }
}

function enforceCooldown(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const now = Date.now();
  const previous = userCooldowns.get(key) || 0;
  if (now - previous < 750) throw new Error('Please wait a moment before sending another music command.');
  userCooldowns.set(key, now);
}

function formatQueue(state) {
  const snapshot = state.queue.snapshot();
  const lines = [];
  lines.push(snapshot.current ? `Now: ${trackLabel(snapshot.current)}` : 'Now: nothing playing');
  if (snapshot.waiting.length === 0) lines.push('Queue: empty');
  else {
    lines.push('Queue:');
    snapshot.waiting.slice(0, 10).forEach((track, index) => lines.push(`${index + 1}. ${trackLabel(track)}`));
    if (snapshot.waiting.length > 10) lines.push(`…and ${snapshot.waiting.length - 10} more`);
  }
  return lines.join('\n');
}

client.once('ready', async () => {
  const commands = commandDefinitions.map((command) => command.toJSON());
  if (testGuildId) {
    const guild = await client.guilds.fetch(testGuildId);
    await guild.commands.set(commands);
    console.log(`Registered ${commands.length} commands in test guild ${testGuildId}.`);
  } else {
    await client.application.commands.set(commands);
    console.log(`Registered ${commands.length} global commands.`);
  }
  console.log(`THC Music Bot logged in as ${client.user.tag}.`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: 'Music commands are server-only.', ephemeral: true });
    return;
  }

  const state = getGuildState(interaction.guildId);

  try {
    enforceCooldown(interaction);

    switch (interaction.commandName) {
      case 'join': {
        const channel = await connectToMemberVoice(interaction, state);
        await interaction.reply(`Joined **${channel.name}**.`);
        break;
      }
      case 'play': {
        const channel = await connectToMemberVoice(interaction, state);
        const rawUrl = interaction.options.getString('url', true);
        const safeUrl = await assertPublicHttpUrl(rawUrl);
        const name = interaction.options.getString('name')?.trim() || safeUrl.hostname;
        const track = {
          url: safeUrl.href,
          name,
          requestedBy: interaction.user.id,
          requestedAt: new Date().toISOString()
        };
        state.queue.enqueue(track);
        if (!state.queue.current) {
          state.queue.startNext();
          await playCurrent(state);
        }
        await interaction.reply(`Queued **${name}** in **${channel.name}**.`);
        break;
      }
      case 'queue':
        await interaction.reply(formatQueue(state));
        break;
      case 'now':
        await interaction.reply(state.queue.current ? `Now playing: **${trackLabel(state.queue.current)}**` : 'Nothing is playing.');
        break;
      case 'skip':
        assertSameVoiceChannel(interaction, state);
        if (!state.queue.current) throw new Error('Nothing is playing.');
        state.player.stop(true);
        await interaction.reply('Skipped.');
        break;
      case 'stop':
        assertSameVoiceChannel(interaction, state);
        state.queue.clear();
        stopFfmpeg(state);
        state.player.stop(true);
        await interaction.reply('Playback stopped and the queue was cleared.');
        break;
      case 'leave':
        assertSameVoiceChannel(interaction, state);
        state.queue.clear();
        stopFfmpeg(state);
        state.player.stop(true);
        state.connection?.destroy();
        state.connection = null;
        await interaction.reply('Left the voice channel and cleared the queue.');
        break;
      default:
        await interaction.reply({ content: 'Unknown music command.', ephemeral: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Command failed.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

client.login(token);
