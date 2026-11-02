import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NewMessage } from 'teleproto/events';
import { Singleton } from './singleton.js';


const DEFAULT_BOT = process.env.MUSIC_BOT ?? '';
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Thin, non-interactive wrapper around the Telegram music bot.
 *
 * Design notes:
 * - All bot replies are routed through one NewMessage handler.
 * - Each pending request has a timeout so a missed reply never hangs the caller.
 * - Only one list-request and one audio-request can be in flight at a time;
 *   callers must serialize (e.g. await each downloadFirstMatch in a loop).
 */
export class MusicService extends Singleton {
  #client;
  #botUsername;
  #botPeerId = null;
  #connectPromise = null;
  #connected = false;

  #pendingList = null;   // { resolve, reject, timer, token }
  #pendingAudio = null;  // { resolve, reject, timer }

  constructor(botUsername, client) {
    super();
    this.#botUsername = botUsername || DEFAULT_BOT;
    this.#client = client;
  }

  async connect() {
    if (this.#connected) return;
    if (!this.#connectPromise) {
      this.#connectPromise = (async () => {
        await this.#client.connect();
        this.#client.addEventHandler(
          (event) => this.#onMessage(event),
          new NewMessage({}),
        );
        this.#connected = true;
        // teleproto adds an abort listener per downloadMedia call; harmless
        // but noisy. Silence the warning.
        try { require('node:events').setMaxListeners(0); } catch { }
      })().catch((err) => { this.#connectPromise = null; throw err; });
    }
    return this.#connectPromise;
  }

  async disconnect() {
    if (this.#connected) {
      await this.#client.disconnect();
      this.#connected = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Message routing
  // ─────────────────────────────────────────────────────────────

  #onMessage(event) {
    const message = event.message;
    if (!message || message.out) return;

    // Only react to messages that come from the bot we care about.
    const sender =
      message.sender?.username ??
      message.peerId?.userId?.toString?.() ??
      null;
    if (
      sender &&
      typeof sender === 'string' &&
      sender.toLowerCase() !== this.#botUsername.toLowerCase() &&
      message.peerId?.userId !== this.#botPeerId
    ) {
      return;
    }

    // 1. Pending list — any inline-keyboard reply from the bot
    if (
      this.#pendingList &&
      message.replyMarkup?.className === 'ReplyInlineMarkup' &&
      message.replyMarkup.rows?.length > 0
    ) {
      const pending = this.#pendingList;
      this.#pendingList = null;
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }

    // 2. Pending audio — any document reply from the bot
    if (
      this.#pendingAudio &&
      message.media?.className === 'MessageMediaDocument'
    ) {
      const pending = this.#pendingAudio;
      this.#pendingAudio = null;
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  }

  #rejectPending(slot, reason) {
    const pending = this[slot];
    if (!pending) return;
    this[slot] = null;
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }

  // ─────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────

  async search(query, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    await this.connect();

    // If a previous list wait is somehow still pending, fail it loudly.
    this.#rejectPending('#pendingList', 'Superseded by new search()');

    const listPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pendingList) {
          this.#pendingList = null;
          reject(new Error(`List timeout after ${timeoutMs}ms for "${query}"`));
        }
      }, timeoutMs)

    });

    try {
      await this.#client.sendMessage(this.#botUsername, { message: query });
      const listMessage = await listPromise;

      const choices = [];
      for (const [rowIndex, row] of (listMessage.replyMarkup?.rows ?? []).entries()) {
        for (const [btnIndex, btn] of (row.buttons ?? []).entries()) {
          if (
            btn.type?.className === 'InlineButtonTypeCallback' &&
            !btn.text.includes('More tracks') &&
            btn.text !== '🔍'
          ) {
            choices.push({ title: btn.text, rowIndex, btnIndex });
          }
        }
      }

      return { message: listMessage, choices };
    } catch (err) {
      this.#rejectPending('#pendingList', err.message);
      throw err;
    }
  }

  async requestTrack(listMessage, { rowIndex, btnIndex }, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#rejectPending('#pendingAudio', 'Superseded by new requestTrack()');

    const audioPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pendingAudio) {
          this.#pendingAudio = null;
          reject(new Error(`Audio timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.#pendingAudio = { resolve, reject, timer };
    });

    try {
      await listMessage.click({ i: rowIndex, j: btnIndex });
      return await audioPromise;
    } catch (err) {
      this.#rejectPending('#pendingAudio', err.message);
      throw err;
    }
  }

  static filenameFor(audioMessage) {
    const doc = audioMessage.media.document;
    let fileName = 'track.mp3';

    if (doc.attributes) {
      for (const attr of doc.attributes) {
        if (attr.className === 'DocumentAttributeAudio' && attr.title) {
          const artist = attr.performer || 'Unknown';
          fileName = `${artist} - ${attr.title}.mp3`;
        }
        if (attr.className === 'DocumentAttributeFilename') {
          fileName = attr.fileName;
        }
      }
    }
    return fileName.replace(/[/\\?%*:|"<>]/g, '-');
  }

  /**
   * End-to-end: search → pick first result → request → download to `destDir`.
   *
   * @param {string} query
   * @param {string} destDir
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   * @param {boolean} [opts.skipFirstIf]  predicate to skip bad candidates, e.g. (title) => title.includes('Remix')
   * @returns {Promise<{ filePath: string, fileName: string, choice: string } | null>}
   */
  async downloadFirstMatch(query, destDir, opts = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, skipFirstIf } = opts;

    await fs.mkdir(destDir, { recursive: true });

    const { message, choices } = await this.search(query, { timeoutMs });

    // Pick the first usable candidate (allow caller to skip junk matches)
    const candidate =
      choices.find((c) => (skipFirstIf ? !skipFirstIf(c.title) : true)) ?? choices[0];
    if (!candidate) return null;

    const audioMessage = await this.requestTrack(message, candidate, { timeoutMs });

    const fileName = MusicService.filenameFor(audioMessage);
    const filePath = path.join(destDir, fileName);

    // downloadMedia can leak abort listeners if reused; pass a fresh signal
    const controller = new AbortController();
    const buffer = await this.#client.downloadMedia(audioMessage, {
      signal: controller.signal,
    });
    await fs.writeFile(filePath, buffer);

    return { filePath, fileName, choice: candidate.title };
  }
}
