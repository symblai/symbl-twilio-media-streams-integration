require("dotenv").config();
const express = require("express");
const expressWebSocket = require("express-ws");
const websocketStream = require("websocket-stream/stream");
const SymblConnectionHelper = require('./symbl/SymblConnectionHelper');
const TwilioClient = require("twilio");
const uuid = require('uuid').v4;
const urlencoded = require('body-parser').urlencoded;

// const twilioClient = new TwilioClient(accountSid, authToken);
const app = express();
// extend express app with app.ws()
expressWebSocket(app, null, {
    perMessageDeflate: false,
});

app.use(urlencoded({extended: false}));

const mode = process.env.MODE || 'receive_call';
const webHookDomain = process.env.WEBHOOK_DOMAIN;

const agentPhone = process.env.AGENT_PHONE
const customerPhone = process.env.CUSTOMER_PHONE

const VoiceResponse = TwilioClient.twiml.VoiceResponse;


console.log('App is starting with config: \n', JSON.stringify({
    mode,
    webHookDomain
}, null, 2));

const participantConnections = {}


// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
// const client = require('twilio')(accountSid, authToken);

// Responds with Twilio instructions to begin the stream
app.post("/twilio/twiml", (request, response) => {
    console.log('Incoming Call detected.');
    const {From} = request.body;

    if (mode === 'receive_call') {
        console.log('Receiving Call from : ', From);
        const twimlResponse = new VoiceResponse();
        twimlResponse.connect()
            .stream({
                url: `wss://${webHookDomain}/twilio/media`, // Replace with your WebHook URL
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
                url: `wss://${webHookDomain}/twilio/media`, // Replace with your WebHook URL
                track: 'inbound_track'
            }).parameter({name: 'from', value: From});
        // Quick Conference, no beeps or music. Start/Stop as participants dial-in/hang up.
        twimlResponse.dial().conference({
            startConferenceOnEnter: true,
            endConferenceOnExit: true,
            beep: false,
            waitUrl: `https://${webHookDomain}`
        }, conferenceName);
        response.type('text/xml');
        response.send(twimlResponse.toString());
        console.log('TwiML Response Sent: ', twimlResponse.toString());

    }
});

app.post("/twilio/statuschange", async (request, response) => {
    const {From, CallStatus} = request.body;
    console.log(`Call status Changed for ${From} to '${CallStatus}'`);
    const connection = participantConnections[From];
    if (CallStatus === 'completed') {
        delete participantConnections[From]
        subscribeConnection.send(JSON.stringify({
            type: 'connection_stopped',
            speaker: {
                userId: `${From.trim()}`,
                name: getName(From)
            },
            connectionId: connection.connectionId,
            conversationId: connection.conversationId
        }));

    }

    if (Object.keys(participantConnections).length <= 0) {
        id = undefined;
        const conversationData = await connection.stop();
        console.log('Symbl: Connection Stopped.', From);
        console.log('Symbl: Conversation ID: ', conversationData.conversationId);
        console.log('Symbl: Conversation ID: ', conversationData.summaryUrl);
    }

});

const getName = (phoneNumber) => {
    return phoneNumber ? phoneNumber.trim() === agentPhone ? 'Agent' : 'Customer' : 'Unknown Caller';
}

let id = undefined;
let subscribeConnection = undefined;
let conversationId = undefined;

// Media stream websocket endpoint
app.ws("/twilio/media", async (ws, req) => {
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

            from = msg.start.customParameters.from.trim();
            console.log('Twilio Media Stream connected for: ', from);

            speaker = { // Optional, if not specified, will simply not send an email in the end.
                userId: `${from}`, /*from ? `${from}` : 'john@example.com',*/ // Update with valid email. If this is not email id, email will not be sent.
                name: getName(from)
            };

            const handlers = {
                'onSpeechDetected': (data) => {
                    // For live transcription
                    if (data) {
                        const {punctuated} = data;
                        console.log(`${speaker.name}: ${punctuated && punctuated.transcript}`);
                    }
                },
                'onInsight': (data) => {
                    // When an insight is detected
                    console.log('onInsight', JSON.stringify(data));
                }
            };

            symblConnectionHelper = new SymblConnectionHelper({speaker, handlers});

            console.log('Symbl: Starting Connection.', speaker);
            connection = await symblConnectionHelper.startConnection(id, {speaker});
            conversationId = connection.conversationId;
            if (subscribeConnection && subscribeConnection.readyState === 1) {
                subscribeConnection.send(JSON.stringify({
                    type: 'connection_started',
                    speaker,
                    connectionId: id,
                    conversationId: conversationId
                }));
            }
            console.log('Symbl: Connection Started.', speaker, connection.connectionId);
            console.log('Symbl: Conversation ID:', connection.conversationId);
            participantConnections[from] = connection;
        } else if (msg.event === 'media') {
            if (connection) {
                symblConnectionHelper.sendAudio(msg.media.payload, 'base64');
            }
        }
    });

    mediaStream.on("close", async () => {


        // if (subscribeConnection && subscribeConnection.readyState === 1) {
        //     subscribeConnection.send(JSON.stringify({
        //         speaker,
        //         connectionId: id,
        //         conversationId: conversationId
        //     }));
        // }
    });
});

app.ws("/symbl/updates", async (ws, req) => {
    subscribeConnection = ws;
    console.log('New connection received.');
    if (Object.keys(participantConnections).length > 0) {
        Object.keys(participantConnections).forEach(from => {
            subscribeConnection.send(JSON.stringify({
                type: 'connection_exists',
                speaker: {
                    userId: `${from}`,
                    name: getName(from)
                },
                connectionId: participantConnections[from].connectionId,
                conversationId: participantConnections[from].conversationId
            }));
        });
    }
});

const listener = app.listen(3000, () => {
    console.log("Your app is listening on port " + listener.address().port);
});
