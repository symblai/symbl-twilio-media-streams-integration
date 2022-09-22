const uuid = require('uuid').v4;
const trackers = require('./trackers');

console.log('Symbl SDK Initialized.');
class SymblConnectionHelper {

    constructor({speaker, handlers}) {
        this.connection = undefined;
        this.speaker = speaker;
        this.handlers = handlers;
        this._hash = uuid();
        const {SDK} = require('@symblai/symbl-js');
        this.sdk = new SDK();
        console.log('Cache', this.sdk.cache.cacheStore.store);
        (async () => {
            return this.sdk.init({
                appId: process.env.SYMBL_APP_ID,
                appSecret: process.env.SYMBL_APP_SECRET
            });
        })();

    }

    /**
     * Start the connection
     * @param id
     * @param speaker
     * @param insightTypes
     * @param config
     * @return {Promise<void>}
     */
    async startConnection(id, {speaker, insightTypes, config} = {}) {
        this.speaker = speaker;
        this.connection = await this.sdk.startRealtimeRequest({
            id,
            basePath: 'https://api-labs.symbl.ai',
            insightTypes: insightTypes || ["action_item", "question", "follow_up"],
            config: {
                meetingTitle: 'My Test Meeting',
                confidenceThreshold: 0.7,
                timezoneOffset: 480, // Offset in minutes from UTC
                languageCode: "en-US",
                sampleRateHertz: 8000,
                encoding: 'MULAW',
                sentiment: true,
                trackers: {
                    // enableAllTrackers: true,
                    interimResults: true
                },
                customVocabularyStrength: [
                    {text: 'Brittany'},
                    {text: 'Toshish'},
                    {text: 'QR Code'},
                    {text: 'Sunday'}
                ],
                "redaction": {
                    // Enable identification of PII/PCI information
                    "identifyContent": true, // By default false
                    // Enable redaction of PII/PCI information
                    "redactContent": false, // By default false
                    // Use custom string "[PII_PCI_ENTITY]" to replace PII/PCI information with
                    "redactionString": "*****" // By default ****
                },
                ...config
            },
            trackers,
            speaker: this.speaker,
            handlers: {
                'onSpeechDetected': this.onSpeechDetected.bind(this),
                'onMessageResponse': this.onMessage.bind(this),
                'onInsightResponse': this.onInsight.bind(this)
            }
        });
        return this.connection;
    }

    sendAudio(data, encoding = 'none') {
        if (encoding !== 'none') {
            const buffer = Buffer.from(data, encoding);
            this.connection.sendAudio(buffer);
        } else {
            this.connection.sendAudio(data);
        }
    }

    onSpeechDetected(data) {
        if (this.handlers && this.handlers.onSpeechDetected) {
            setTimeout(() => {
                this.handlers.onSpeechDetected(data, {speaker: this.speaker, connection: this.connection});
            }, 0);
        }
    }

    onMessage(data) {
        if (this.handlers && this.handlers.onMessage) {
            setTimeout(() => {
                this.handlers.onMessage(data, {speaker: this.speaker, connection: this.connection});
            }, 0);
        }
    }

    onInsight(data) {
        if (this.handlers && this.handlers.onInsight) {
            setTimeout(() => {
                this.handlers.onInsight(data, {speaker: this.speaker, connection: this.connection});
            }, 0);
        }
    }

    async stopConnection() {
        return this.connection.stop();
    }


    get hash() {
        return this._hash;
    }
}

module.exports = SymblConnectionHelper;
