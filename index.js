require("dotenv").config();
const express = require("express");
const expressWebSocket = require("express-ws");
const websocketStream = require("websocket-stream/stream");
const SymblConnectionHelper = require('./symbl/SymblConnectionHelper');
const TwilioClient = require("twilio");
const uuid = require('uuid').v4;
const urlencoded = require('body-parser').urlencoded;
const {sdk} = require("symbl-node");
// const twilioClient = new TwilioClient(accountSid, authToken);
const app = express();
// extend express app with app.ws()
expressWebSocket(app, null, {
    perMessageDeflate: false,
});

app.use(urlencoded({extended: false}));

const mode = process.env.MODE || 'receive_call';
const webHookDomain = process.env.WEBHOOK_DOMAIN;

const VoiceResponse = TwilioClient.twiml.VoiceResponse;

(async () => {
    return sdk.init({
        appId: process.env.SYMBL_APP_ID,
        appSecret: process.env.SYMBL_APP_SECRET
    });
})();
console.log('Symbl SDK Initialized.');


console.log('App is starting with config: \n', JSON.stringify({
    mode,
    webHookDomain
}, null, 2));

// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
// const client = require('twilio')(accountSid, authToken);

// Responds with Twilio instructions to begin the stream
app.post("/twiml", (request, response) => {
    console.log('Incoming Call detected.');
    const {From} = request.body;

    if (mode === 'receive_call') {
        console.log('Receiving Call from : ', From);
        const twimlResponse = new VoiceResponse();
        twimlResponse.connect()
            .stream({
                url: `wss://${webHookDomain}/media`, // Replace with your WebHook URL
            });
        response.type('text/xml');
        response.send(twimlResponse.toString());
    } else if (mode === 'conference') {
        // Conference: caller 1 -> Common Number <- caller 2

        console.log('Joining in Conference : ', From);
        const twimlResponse = new VoiceResponse();

        const conferenceName = "Twilio-Symbl Test Conference";

        console.log('Starting Media stream. Track Mode: ');
        twimlResponse.connect()
            .stream({
                url: `wss://${webHookDomain}/media`, // Replace with your WebHook URL
                track: 'inbound_track'
            }).parameter({name: 'from', value: From});
        // Quick Conference, no beeps or music. Start/Stop as participants dial-in/hang up.
        twimlResponse.dial().conference({
            startConferenceOnEnter: true,
            endConferenceOnExit: true,
            beep: false,
            waitUrl: `http://${webHookDomain}`
        }, conferenceName);
        response.type('text/xml');
        response.send(twimlResponse.toString());
        console.log('TwiML Response Sent: ', twimlResponse.toString());

    }
});


let id = undefined;

// Media stream websocket endpoint
app.ws("/media", async (ws, req) => {
    // Audio Stream coming from Twilio
    const mediaStream = websocketStream(ws);
    let callSid;
    // const client = new TwilioClient();
    let from;
    let symblConnectionHelper;
    let connection;
    let speaker;

    if (!id) {
        id = uuid();
    }

    mediaStream.on('data', async (data) => {
        const msg = JSON.parse(data.toString("utf8"));
        // console.log(msg);
        if (msg.event === "start") {
            callSid = msg.start.callSid;
            console.log(`Captured call ${callSid}`);

            from = msg.start.customParameters.from;
            console.log('Twilio Media Stream connected for: ', from);

            speaker = { // Optional, if not specified, will simply not send an email in the end.
                userId: 'john@example.com', /*from ? `${from}` : 'john@example.com',*/ // Update with valid email. If this is not email id, email will not be sent.
                name: from ? `${from}` : 'John'
            };

            const handlers = {
                'onSpeechDetected': (data) => {
                    // For live transcription
                    if (data) {
                        const {punctuated} = data;
                        console.log(`Live: ${punctuated && punctuated.transcript}`);
                    }
                },
                'onMessage': (data) => {
                    // When a processed message is available
                    console.log('onMessage', JSON.stringify(data));
                },
                'onInsight': (data) => {
                    // When an insight is detected
                    console.log('onInsight', JSON.stringify(data));
                }
            };

            symblConnectionHelper = new SymblConnectionHelper({sdk, speaker, handlers});

            console.log('Symbl: Starting Connection.', speaker);
            connection = await symblConnectionHelper.startConnection(id, {speaker});
            console.log('Symbl: Connection Started.', speaker, connection.connectionId);
        } else if (msg.event === 'media') {
            if (connection) {
                symblConnectionHelper.sendAudio(msg.media.payload, 'base64');
            }
        }
    });

    mediaStream.on("close", async () => {
        const conversationData = await connection.stop();
        console.log('Symbl: Connection Stopped.', speaker);
        console.log('Symbl: Conversation ID: ', conversationData.conversationId);
        console.log('Symbl: Conversation ID: ', conversationData.summaryUrl);
    });
});

const listener = app.listen(3000, () => {
    console.log("Your app is listening on port " + listener.address().port);
});