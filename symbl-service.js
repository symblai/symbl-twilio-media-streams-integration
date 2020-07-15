const {sdk} = require("symbl-node"); // to generate our pre-signed URL

class SymblConnectionHelper {

    constructor() {
        this.connection = undefined;
        this.speaker = undefined;
    }

    async init() {
        return sdk.init({
            appId: process.env.SYMBL_APP_ID,
            appSecret: process.env.SYMBL_APP_SECRET
        });
    }

    async startConnection(id, {speaker}) {
        this.speaker = speaker;
        this.connection = await sdk.startRealtimeRequest({
            id,
            insightTypes: ["action_item", "question"],
            config: {
                meetingTitle: 'My Test Meeting',
                confidenceThreshold: 0.7,
                timezoneOffset: 480, // Offset in minutes from UTC
                languageCode: "en-US",
                sampleRateHertz: 8000,
                encoding: 'MULAW'
            },
            speaker,
            handlers: {
                'onSpeechDetected': this.onSpeechDetected,
                'onMessageResponse': this.onMessage,
                'onInsightResponse': this.onInsight
            }
        });
        return this.connection;
    }

    onSpeechDetected(data) {
        console.log(JSON.stringify(data));
        // For live transcription
        if (data) {
            const {punctuated} = data;
            console.log('Live: ', punctuated && punctuated.transcript);
        }
    }

    onMessage(data) {
        // When a processed message is available
        console.log('onMessageResponse', JSON.stringify(data));
    }

    onInsight(data) {
        // When an insight is detected
        console.log('onInsightResponse', JSON.stringify(data));
    }

}
module.exports = SymblConnectionHelper;
