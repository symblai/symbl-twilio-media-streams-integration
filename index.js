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

let participants = 0;

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
        participants = participants + 1;
        console.log('Joining in Conference : ', From);
        const twimlResponse = new VoiceResponse();

        const conferenceName = "Twilio-Symbl Test Conference";

        console.log('Starting Media stream. Track Mode: ', trackMode);
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
                userId: 'toshish@symbl.ai', /*from ? `${from}` : 'john@example.com',*/ // Update with valid email. If this is not email id, email will not be sent.
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
            connection = await symblConnectionHelper.startConnection(id);
            console.log('Symbl: Connection Started.', speaker, connection.connectionId);
        } else if (msg.event === 'media') {
            if (connection) {
                symblConnectionHelper.sendAudio(msg.media.payload, 'base64');
            }
        }
    });

    mediaStream.on("close", () => {
        connection.stop();
        console.log('Symbl: Connection Stopped.', speaker, connection.connectionId);
    });


    //
    // const audioStream = new Transform({
    //     transform: (chunk, encoding, callback) => {
    //         const msg = JSON.parse(chunk.toString("utf8"));
    //         // console.log(msg);
    //         if (msg.event === "start") {
    //             callSid = msg.start.callSid;
    //             console.log(`Captured call ${callSid}`);
    //
    //             from = msg.start.customParameters.from;
    //             console.log('Twilio Media Stream connected for: ', from);
    //         }
    //         // Only process media messages
    //         if (msg.event !== "media") return callback();
    //         // console.log(msg);
    //
    //         // This is mulaw
    //         return callback(null, JSON.stringify({
    //             track: msg.media.track,
    //             payload: msg.media.payload
    //         }));
    //     },
    // });
    //
    //
    //
    // console.log('Starting Symbl Connection.', from);
    // connection = await symblService.startConnection(id, {
    //     speaker: { // Optional, if not specified, will simply not send an email in the end.
    //         userId: from ? `${from}` : 'john@example.com', // Update with valid email.
    //         name: from ? `${from}` : 'John'
    //     },
    // });
    //
    // console.log('Symbl Connection Started.', connection.connectionId);
    //
    // mediaStream
    //     .pipe(audioStream)
    //     .on('data', (data) => {
    //         const json = JSON.parse(data);
    //         const {payload} = json;
    //         const buffer = Buffer.from(payload, "base64");
    //         // console.log(data);
    //         connection.sendAudio(buffer);
    //     })


    // Pipe our streams together
    // mediaStream.on('data', (data) => {
    //     const msg = JSON.parse(data.toString("utf8"));
    //     // console.log(msg);
    //     if (msg.event === "start") {
    //         callSid = msg.start.callSid;
    //         console.log(`Captured call ${callSid}`);
    //     }
    //     // Only process media messages
    //     if (msg.event !== "media") return ;
    //     console.log(msg);
    //     if (msg.media.track === 'outbound') {
    //         // Speaker 1 (John)
    //         connection.sendAudio(Buffer.from(msg.media.payload, "base64"));
    //     } else if (msg.media.track === 'inbound') {
    //         // Speaker 2 (Mary)
    //         if (secondConnection) {
    //             connection.sendAudio(Buffer.from(msg.media.payload, "base64"));
    //         }
    //     }
    // });


});

const listener = app.listen(3000, () => {
    console.log("Your app is listening on port " + listener.address().port);
});