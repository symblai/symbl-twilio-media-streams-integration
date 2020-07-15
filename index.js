require("dotenv").config();
const express = require("express");
const expressWebSocket = require("express-ws");
const Transform = require("stream").Transform;
const websocketStream = require("websocket-stream/stream");
const WaveFile = require("wavefile").WaveFile;
const SymblService = require('./symbl-service');
const TwilioClient = require("twilio");
const uuid = require('uuid').v4;
const urlencoded = require('body-parser').urlencoded;

const app = express();
// extend express app with app.ws()
expressWebSocket(app, null, {
    perMessageDeflate: false,
});

app.use(urlencoded({ extended: false }));

// Responds with Twilio instructions to begin the stream
app.post("/twiml", (request, response) => {
    const MODERATOR = ''; // Moderator's phone number

    const twiml = new TwilioClient.twiml.VoiceResponse();

    // Start with a <Dial> verb
    const dial = twiml.dial();
    // If the caller is our MODERATOR, then start the conference when they
    // join and end the conference when they leave
    console.log(request.body)
    if (request.body.From === MODERATOR) {
        dial.conference('My conference', {
            startConferenceOnEnter: true,
            endConferenceOnExit: true,
        });
        // const r = new TwilioClient.twiml.VoiceResponse();
        twiml.start()
            .stream({
                url: 'wss://0aec1ac13b0d.ngrok.io/media', // Replace with your WebHook URL
                // track: "both_tracks"
            })

    } else {
        // Otherwise have the caller join as a regular participant
        dial.conference('My conference', {
            startConferenceOnEnter: false,
        });

    }
    response.type('text/xml');
    response.send(twiml.toString());
    // Render the response as XML in reply to the webhook request



    // response.setHeader("Content-Type", "application/xml");
    // response.render("twiml", { host: request.hostname, layout: false });
});


// Media stream websocket endpoint
app.ws("/media", (ws, req) => {
    // Audio Stream coming from Twilio
    const mediaStream = websocketStream(ws);
    let callSid;
    // const client = new TwilioClient();

    const audioStream = new Transform({
        transform: (chunk, encoding, callback) => {
            const msg = JSON.parse(chunk.toString("utf8"));
            console.log(msg);
            if (msg.event === "start") {
                callSid = msg.start.callSid;
                console.log(`Captured call ${callSid}`);
            }
            // Only process media messages
            if (msg.event !== "media") return callback();
            // This is mulaw
            return callback(null, Buffer.from(msg.media.payload, "base64"));
        },
    });
    const pcmStream = new Transform({
        transform: (chunk, encoding, callback) => {
            const wav = new WaveFile();
            wav.fromScratch(1, 8000, "8m", chunk);
            wav.fromMuLaw();
            return callback(null, Buffer.from(wav.data.samples));
        },
    });

    const symblService = new SymblService();

    symblService.init().then(async () => {
        console.log('Symbl Initialized.');
        const id = uuid();
        console.log('Connection Id: ', id);
        const connection = await symblService.startConnection(id, {
            speaker: { // Optional, if not specified, will simply not send an email in the end.
                userId: 'toshish@symbl.ai', // Update with valid email
                name: 'Toshish'
            },
        });

        console.log('Symbl Connection Started Initialized.', connection.connectionId);

        // Pipe our streams together
        mediaStream.pipe(audioStream).pipe(pcmStream);

        mediaStream.on('data', (data) => {
            console.log(data);
            connection.sendAudio(data);
        })



        mediaStream.on("close", () => {
            connection.stop();
            console.log('Symbl Connection Stopped.', connection.connectionId);
        });
    })

});

const listener = app.listen(3000, () => {
    console.log("Your app is listening on port " + listener.address().port);
});


// const resp = new TwilioClient.twiml.VoiceResponse()
// resp.start()
//     .stream({
//         name: 'Symbl Test Stream',
//         url: 'wss://0aec1ac13b0d.ngrok.io/media'
//     });
// resp.dial('+19517725054')
// resp.type("text/xml");
// resp.end(resp.toString());