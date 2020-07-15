import uuid from 'uuid/v4';

import {
    MIDI_AUDIO_BUFFER_SIZE,
    MIDI_DEFAULT_PATCH_URL,
    MIDI_AUDIO_S16LSB,
    MAX_I16,
} from './constants';

import LibTiMidity from './LibTiMidity';
import EventHandler from './EventHandler';

let isFirstInstance = true;

export default class MidiPlayer {
    /**
     * @class MidiPlayer
     * @param {object} [configuration]
     * @param {function} [configuration.eventLogger = undefined] The function that receives event payloads.
     * @param {boolean} [configuration.logging = false] Turns ON or OFF logging to the console.
     * @param {string} [configuration.patchUrl = https://cdn.jsdelivr.net/npm/midi-instrument-patches@latest/] The public path where MIDI instrument patches can be found.
     * @param {number} [configuration.volume = 80] Set playback volume when initializing the player.
     * @property {object} context The AudioContext instance.
     * @property {function} eventLogger The function that is called to emit events.
     * @property {boolean} logging Whether console logging is ON or OFF.
     * @property {boolean} isFirstInstance Whether this is the first instance of the Midi Player or 
     * @property {arrayBuffer} midiFileArray A typed array that represents the content of the MIDI.
     * @property {*} midiFileBuffer The buffer with the MIDI data.
     * @property {string} patchUrl The URL used to load MIDI instrument patches.
     * @property {string} playerId ID of this instance of Midi Player.
     * @property {number} sampleRate The sample rate of the AudioContext.
     * @property {object} source The source that plays the audio signal.
     * @property {number} startTime The time when MIDI playback started.
     * @property {number} stream The MIDI stream.
     * @property {number} volume Playback volume.
     * @property {*} waveBuffer The buffer with the MIDI data converted to WAV.
not.
     *
     * @return {object} A `MidiPlayer` instance.
     * @example
     * import MidiPlayer from 'web-midi-player';
     *
     * const eventLogger = (payload) => {
     *   console.log('Received event:', payload.event);
     * }
     *
     * const midiPlayer = new MidiPlayer({ eventLogger });
     */
    constructor({
        eventLogger = undefined,
        logging = false,
        patchUrl = MIDI_DEFAULT_PATCH_URL,
        volume = 80,
    } = {}) {
        try {
            const playerId = uuid();
            this.playerId = playerId;
            this.eventHandler = new EventHandler({
                eventLogger,
                logging,
                playerId,
            });
        } catch (error) {
            console.error('Fatal error. Could not initialize event handler.');
            return;
        }

        try {
            this.eventLogger = eventLogger;
            this.logging = logging;
            this.patchUrl = patchUrl;
            this.volume = volume;
            this.startTime = 0;

            LibTiMidity.init(isFirstInstance);

            this.isFirstInstance = isFirstInstance;
            if (isFirstInstance) {
                isFirstInstance = false;
            }

            this.eventHandler.emitInit();
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not initialize instance of MidiPlayer.',
                error,
            });
        }
    }

    /**
     * Formats the name of a MIDI for display purposes.
     * @param {String} name Name of the MIDI song.
     * @return {String}
     */
    static formatMidiName(name) {
        return name ? ` '${name}'` : '';
    }

    /**
     * Loads instrument patches for a list of MIDI input.
     *
     * Please note that you can not use `parameters.items.arrayBuffer` and `parameters.items.url` concurrently.
     * @param {object} parameters
     * @param {object} [parameters.items] An array.
     * @param {arrayBuffer} [parameters.items.arrayBuffer] An array buffer containing MIDI data to play.
     * @param {string} [parameters.items.url] The URL where the MIDI file to play is located.
     * @param {object} [parameters.audioContext] An instance of the Web Audio API AudioContext interface.
     * @return {boolean} Whether instrument patches were successfully preloaded or not.
     * @example
     * const name1 = 'My MIDI file from URL';
     * const url = 'media/file.midi';
     * const name2 = 'My MIDI file from ArrayBuffer';
     * const arrayBuffer = new ArrayBuffer();
     *
     * midiPlayer.preload({
     *   items: [
     *     { url, name: name1 },
     *     { arrayBuffer, name: name2 }
     *   ]
     * });
     */
    async preload({ items = [], audioContext } = {}) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const { url, arrayBuffer } = item;

            const initialized = this.initAudioContext({ audioContext });

            if (!initialized) {
                return false;
            }

            if (!this.isSourceValid({ url, arrayBuffer })) {
                return false;
            }

            const data = await this.getSource({ url, arrayBuffer });

            if (!data) {
                return false;
            }

            this.midiFileArray = new Int8Array(data);
            this.handleStream();
            await this.getInstrumentPatches();
        }
    }

    /**
     * Starts playback of MIDI input.
     *
     * Please note that you can not use `input.arrayBuffer` and `input.url` concurrently.
     * @param {object} input
     * @param {arrayBuffer} [input.arrayBuffer] An array buffer containing MIDI data to play.
     * @param {string} [input.url] The URL where the MIDI file to play is located.
     * @param {string} [input.name] A human-friendly name for the song.
     * @param {object} [input.audioContext] An instance of the Web Audio API AudioContext interface.
     * @return {boolean} Whether playback was successfully initiated or not.
     * @example
     * const name1 = 'My MIDI file from URL';
     * const url = 'media/file.midi';
     * midiPlayer.play({ url, name: name1 });
     *
     * const name2 = 'My MIDI file from ArrayBuffer';
     * const arrayBuffer = new ArrayBuffer();
     * midiPlayer.play({ arrayBuffer, name: name2 });
     */
    async play({ arrayBuffer, url, name, audioContext } = {}) {
        this.stop();

        const initialized = this.initAudioContext({ audioContext });

        if (!initialized) {
            return false;
        }

        if (!this.isSourceValid({ url, arrayBuffer })) {
            return false;
        }

        this.eventHandler.emitLoadFile({
            message: `Loading${MidiPlayer.formatMidiName(name)}...`,
        });

        const data = await this.getSource({ url, arrayBuffer });

        if (!data) {
            return false;
        }

        const loaded = await this.loadSong({ arrayBuffer: data });

        if (loaded) {
            return this.initPlayback();
        }
    }

    initAudioContext({ audioContext }) {
        try {
            // AudioContext must be fired close to the touch/click event initiated by the user to work in Safari
            this.context =
                audioContext ||
                new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.context.sampleRate;
            return true;
        } catch (error) {
            this.eventHandler.emitError({
                message: `Could not set AudioContext.`,
                error,
            });
            return false;
        }
    }

    isSourceValid({ arrayBuffer, url }) {
        if (!arrayBuffer && !url) {
            this.eventHandler.emitError({
                message:
                    "Unknown source. URL or array buffer can't be both undefined to start playback.",
            });
            return false;
        }

        if (arrayBuffer && url) {
            this.eventHandler.emitError({
                message:
                    'Ambiguous source. MIDI data must originate either from a URL or an array buffer to start playback. Not both.',
            });
            return false;
        }

        return true;
    }

    async getSource({ arrayBuffer, url }) {
        if (arrayBuffer) {
            return arrayBuffer;
        }

        try {
            const response = await fetch(url);
            if (response.status !== 200) {
                this.eventHandler.emitError({
                    message: `Could not retrieve MIDI${MidiPlayer.formatMidiName(
                        name
                    )}.`,
                    error: `Status code: ${response.status}.`,
                });

                return false;
            }

            return response.arrayBuffer();
        } catch (error) {
            this.eventHandler.emitError({
                message: `Could not retrieve MIDI${MidiPlayer.formatMidiName(
                    name
                )}.`,
                error,
            });
            return null;
        }
    }

    async loadSong({ arrayBuffer }) {
        this.midiFileArray = new Int8Array(arrayBuffer);

        try {
            const options = this.handleStream();
            await this.getInstrumentPatches();

            // we need to reload the MIDI once the instrument patches have been loaded
            this.stream = LibTiMidity.call(
                'mid_istream_open_mem',
                'number',
                ['number', 'number', 'number'],
                [this.midiFileBuffer, this.midiFileArray.length, false]
            );

            this.song = LibTiMidity.call(
                'mid_song_load',
                'number',
                ['number', 'number'],
                [this.stream, options]
            );

            LibTiMidity.call(
                'mid_istream_close',
                'number',
                ['number'],
                [this.stream]
            );
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not load song.',
                error,
            });
            return false;
        }

        return true;
    }

    handleStream() {
        this.midiFileBuffer = LibTiMidity._malloc(this.midiFileArray.length);

        LibTiMidity.writeArrayToMemory(this.midiFileArray, this.midiFileBuffer);
        LibTiMidity.call('mid_init', 'number', [], []);

        this.stream = LibTiMidity.call(
            'mid_istream_open_mem',
            'number',
            ['number', 'number', 'number'],
            [this.midiFileBuffer, this.midiFileArray.length, false]
        );

        const options = LibTiMidity.call(
            'mid_create_options',
            'number',
            ['number', 'number', 'number', 'number'],
            [this.sampleRate, MIDI_AUDIO_S16LSB, 1, MIDI_AUDIO_BUFFER_SIZE * 2]
        );

        this.song = LibTiMidity.call(
            'mid_song_load',
            'number',
            ['number', 'number'],
            [this.stream, options]
        );

        LibTiMidity.call(
            'mid_istream_close',
            'number',
            ['number'],
            [this.stream]
        );

        return options;
    }

    async getInstrumentPatches() {
        const missingPatchCount = LibTiMidity.call(
            'mid_song_get_num_missing_instruments',
            'number',
            ['number'],
            [this.song]
        );

        if (missingPatchCount > 0) {
            this.eventHandler.emitLoadPatch({
                message: `Loading ${missingPatchCount} instrument patches...`,
            });

            for (let i = 0; i < missingPatchCount; i++) {
                const missingPatch = LibTiMidity.call(
                    'mid_song_get_missing_instrument',
                    'string',
                    ['number', 'number'],
                    [this.song, i]
                );

                try {
                    await LibTiMidity.loadPatchFromUrl(
                        this.patchUrl,
                        missingPatch
                    );
                } catch (error) {
                    this.eventHandler.emitError({
                        message: `Could not retrieve missing instrument patch ${
                            missingPatch ? `'${missingPatch}'` : `#${i}`
                        }.`,
                        error,
                    });
                    return false;
                }
            }
        }
    }

    initPlayback = () => {
        LibTiMidity.call('mid_song_start', 'void', ['number'], [this.song]);

        try {
            this.connectSource();
            this.waveBuffer = LibTiMidity._malloc(MIDI_AUDIO_BUFFER_SIZE * 2);
            this.startTime = this.context.currentTime;
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not initialize playback.',
                error,
            });
            return;
        }

        this.eventHandler.emitPlay({ time: 0 });
    };

    // creates script processor with auto buffer size and a single output channel
    connectSource = () => {
        // Warning! This feature has been marked as deprecated: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createScriptProcessor
        // See issue: https://github.com/yvesgurcan/web-midi-player/issues/29
        // However, the replacement "AudioWorklet" is still experimental (https://caniuse.com/#search=audioworklet)
        this.source = this.context.createScriptProcessor(
            MIDI_AUDIO_BUFFER_SIZE,
            0,
            1
        );

        // event handler for next buffer full of audio data
        this.source.onaudioprocess = (event) => this.handleOutput(event);

        this.createGainNode();
    };

    createGainNode() {
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = this.volume / 100;

        // connects the gain node (controls volume) to the context's destination (the speakers)
        this.gainNode.connect(this.context.destination);

        // connects the source to the gain node
        this.source.connect(this.gainNode);
    }

    handleOutput({ outputBuffer }) {
        try {
            const time = this.context.currentTime - this.startTime;

            this.eventHandler.emitPlay({ time });

            // collect new wave data from LibTiMidity into waveBuffer
            const readWaveBytes = LibTiMidity.call(
                'mid_song_read_wave',
                'number',
                ['number', 'number', 'number', 'number'],
                [this.song, this.waveBuffer, MIDI_AUDIO_BUFFER_SIZE * 2, false]
            );

            if (readWaveBytes === 0) {
                this.stop();
                this.eventHandler.emitEnd({ time });
                return;
            }

            // loop through the samples
            for (let i = 0; i < MIDI_AUDIO_BUFFER_SIZE; i++) {
                if (i < readWaveBytes) {
                    // converts PCM data from sint16 in C to number in JavaScript (range: -1.0 .. +1.0)
                    // this is where the data is converted to waveform audio signal
                    outputBuffer.getChannelData(0)[i] =
                        LibTiMidity.getValue(this.waveBuffer + 2 * i, 'i16') /
                        MAX_I16;
                } else {
                    // fill end of buffer with zeroes, may happen at the end of a piece
                    outputBuffer.getChannelData(0)[i] = 0;
                }
            }
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not process audio.',
                error,
            });
        }
    }

    /**
     * Pauses playback of MIDI input.
     * @param {undefined}
     * @return {boolean} Whether playback was successfully paused or not.
     * @example
     * midiPlayer.pause();
     */
    pause() {
        try {
            let time = 0;
            if (this.context) {
                this.context.suspend();
                time = this.context.currentTime - this.startTime;
            }
            this.eventHandler.emitPause({ time });
            return true;
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not pause playback.',
                error,
            });

            return false;
        }
    }

    /**
     * Resumes playback of MIDI input.
     * @param {undefined}
     * @return {boolean} Whether playback was successfully ressumed or not.
     * @example
     * midiPlayer.resume();
     */
    resume() {
        try {
            let time = 0;
            if (this.context) {
                this.context.resume();
                time = this.context.currentTime - this.startTime;
            }
            this.eventHandler.emitResume({
                time,
            });
            return true;
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not resume playback.',
                error,
            });

            return false;
        }
    }

    /**
     * Stops playback of MIDI input.
     * @param {undefined}
     * @return {boolean} Whether playback was successfully stopped or not.
     * @example
     * midiPlayer.stop();
     */
    stop() {
        try {
            if (this.source) {
                this.context.close();
                this.disconnectSource();
                this.freeMemory();
                LibTiMidity.call('mid_exit', 'void', [], []);
                this.song = 0;
            }

            this.startTime = 0;

            this.eventHandler.emitStop();

            return true;
        } catch (error) {
            this.eventHandler.emitError({
                message: 'Could not stop playback.',
                error,
            });

            return false;
        }
    }

    /**
     * Gets the current volume of the playback.
     * @function
     * @param {undefined}
     * @return {number} The current volume.
     * @example
     * const volume = midiPlayer.getVolume();
     */
    getVolume() {
        return this.volume;
    }

    /**
     * Sets the current volume of the playback.
     * @function
     * @param {object} input
     * @param {number} input.volume The new value for the volume (also known as gain). Typically, a whole number between 0 and 100 but can actually be negative, greater, or even a decimal number.
     * @example
     * midiPlayer.setVolume({ volume: 80 });
     */
    setVolume({ volume }) {
        if (Number.isNaN(parseFloat(volume))) {
            this.eventHandler.emitError({
                message: `Volume must be parsable into a number. Got '${volume}' instead.`,
            });
            return;
        }

        this.volume = volume;
        this.gainNode.gain.value = volume / 100;
    }

    freeMemory() {
        LibTiMidity._free(this.waveBuffer);
        LibTiMidity._free(this.midiFileBuffer);
        LibTiMidity.call('mid_song_free', 'void', ['number'], [this.song]);
    }

    // terminate playback
    disconnectSource() {
        this.source.disconnect();
        this.source = null;
    }

    /**
     * Send custom payloads to the event logger.
     * @function
     * @param {object} payload
     * @param {string} [payload.event] The name of the event.
     * @param {string} [payload.message] A message that described the event.
     * @example
     * const event = 'MIDI_CUSTOM_EVENT';
     * const message = 'Something happened.';
     * midiPlayer.emitEvent({ event, message });
     */
    emitEvent = (payload) => this.eventHandler.emitEvent(payload);

    /**
     * Updates the configuration of the logger.
     * @param {object} [configuration]
     * @param {function} [configuration.eventLogger = undefined] The function that receives event payloads.
     * @param {boolean} [configuration.logging = false] Turns ON or OFF logging to the console.
     * @example
     *  const eventLogger = (payload) => {
     *   console.log('Received event:', payload.event);
     * }
     * midiPlayer.setLogger({ eventLogger });
     */
    setLogger({ eventLogger = undefined, logging = false }) {
        this.eventLogger = eventLogger;
        this.logging = logging;
        this.eventHandler.setLogger({ eventLogger, logging });
    }
}
