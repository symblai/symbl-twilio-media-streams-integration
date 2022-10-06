require("dotenv").config();
const express = require("express");
const expressWebSocket = require("express-ws");
const websocketStream = require("websocket-stream/stream");
const SymblConnectionHelper = require("./symbl/SymblConnectionHelper");
const TwilioClient = require("twilio");
const uuid = require("uuid").v4;
const urlencoded = require("body-parser").urlencoded;

// const twilioClient = new TwilioClient(accountSid, authToken);
const app = express();

// extend express app with app.ws()
expressWebSocket(app, null, {
  perMessageDeflate: false,
});

app.use(urlencoded({ extended: false }));

const mode = process.env.MODE || "receive_call";
const webHookDomain = process.env.WEBHOOK_DOMAIN;

const agentPhone = process.env.AGENT_PHONE;
const customerPhone = process.env.CUSTOMER_PHONE;

const VoiceResponse = TwilioClient.twiml.VoiceResponse;

console.log(
  "App is starting with config: \n",
  JSON.stringify(
    {
      mode,
      webHookDomain,
    },
    null,
    2
  )
);

const participantConnections = {};
const streamConnections = {};
const streamParticipants = {};

// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
// const client = require('twilio')(accountSid, authToken);

// Responds with Twilio instructions to begin the stream
app.post("/twilio/twiml", (request, response) => {
  console.log("Incoming Call detected.");
  const { From } = request.body;

  if (mode === "receive_call") {
    console.log("Receiving Call from : ", From);
    const twimlResponse = new VoiceResponse();
    twimlResponse.connect().stream({
      url: `wss://${webHookDomain}/twilio/media`, // Replace with your WebHook URL
    });
    response.type("text/xml");
    response.send(twimlResponse.toString());
  } else if (mode === "conference") {
    // Conference: caller 1 -> Common Number <- caller 2

    console.log("Joining in Conference : ", From);
    const twimlResponse = new VoiceResponse();

    const conferenceName = "Twilio-Symbl Test Conference";

    console.log("Starting Media stream. Track Mode: ");
    twimlResponse
      .connect()
      .stream({
        url: `wss://${webHookDomain}/twilio/media`, // Replace with your WebHook URL
        track: "inbound_track",
      })
      .parameter({ name: "from", value: From });
    // Quick Conference, no beeps or music. Start/Stop as participants dial-in/hang up.
    twimlResponse.dial().conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: false,
        waitUrl: `https://${webHookDomain}`,
      },
      conferenceName
    );
    response.type("text/xml");
    response.send(twimlResponse.toString());
    console.log("TwiML Response Sent: ", twimlResponse.toString());
  }
});

app.post("/twilio/statuschange", async (request, response) => {
  const { From, CallStatus } = request.body;
  console.log(`Call status Changed for ${From} to '${CallStatus}'`);
  const connection = participantConnections[From];
  if (CallStatus === "completed") {
    delete participantConnections[From];
    console.log("Removed from participantConnections", participantConnections);
    subscribeConnection.send(
      JSON.stringify({
        type: "connection_stopped",
        speaker: {
          userId: `${From.trim()}`,
          name: getName(From),
        },
        connectionId: connection.connectionId,
        conversationId: connection.conversationId,
      })
    );
  }

  if (Object.keys(participantConnections).length <= 0) {
    id = undefined;
    const conversationData = await connection.stop();
    console.log("Symbl: Connection Stopped.", From);
    // console.log('Symbl: Conversation ID: ', conversationData.conversationId);
    // console.log('Symbl: Conversation ID: ', conversationData.summaryUrl);
  }
});

const getName = (phoneNumber) => {
  return phoneNumber
    ? phoneNumber.trim() === agentPhone
      ? "Agent"
      : "Customer"
    : "Unknown Caller";
};

let id = undefined;
let subscribeConnection = undefined;

// Media stream websocket endpoint
app.ws("/twilio/media", async (ws, req) => {
  // Audio Stream coming from Twilio
  const mediaStream = websocketStream(ws);

  mediaStream.on("data", async (data) => {
    let callSid;
    // const client = new TwilioClient();
    let from;

    let speaker;

    if (!id) {
      id = uuid();
    }
    const msg = JSON.parse(data.toString("utf8"));
    if (msg.event !== "media") {
      console.log(msg);
    }
    if (msg.event === "start") {
      callSid = msg.start.callSid;
      console.log(`Captured call ${callSid}`);

      from = msg.start.customParameters.from.trim();
      console.log("Twilio Media Stream connected for: ", from);

      speaker = {
        // Optional, if not specified, will simply not send an email in the end.
        userId: `${from}` /*from ? `${from}` : 'john@example.com',*/, // Update with valid email. If this is not email id, email will not be sent.
        name: getName(from),
      };

      const handlers = {
        onSpeechDetected: (data) => {
          // For live transcription
          if (data) {
            const { punctuated, user } = data;
            console.log(`${user.name}: ${punctuated && punctuated.transcript}`);
          }
        },
        onInsight: (data) => {
          // When an insight is detected
          console.log("onInsight", JSON.stringify(data));
        },
        onMessage: (data) => {
          // When an insight is detected
          console.log("onMessage", JSON.stringify(data));
        },
      };

      const symblConnectionHelper = new SymblConnectionHelper({
        speaker,
        handlers,
      });

      console.log("Symbl: Starting Connection.", speaker);
      const connection = await symblConnectionHelper.startConnection(id, {
        speaker,
      });
      connection.from = from;
      const conversationId = connection.conversationId;
      if (subscribeConnection && subscribeConnection.readyState === 1) {
        subscribeConnection.send(
          JSON.stringify({
            type: "connection_started",
            speaker,
            connectionId: id,
            conversationId,
          })
        );
      }
      console.log(
        "Symbl: Connection Started.",
        speaker,
        connection.connectionId
      );
      console.log("Symbl: Conversation ID:", conversationId);
      participantConnections[from] = connection;
      streamConnections[msg.streamSid] = connection;
      streamParticipants[msg.streamSid] = from;
      console.log("Added to participantConnections", participantConnections);
      console.log("Added to streamConnections", streamConnections);
      console.log("Added to streamParticipants", streamParticipants);
    } else if (msg.event === "media") {
      // console.log(msg)
      const connection = streamConnections[msg.streamSid];
      if (connection) {
        const buffer = Buffer.from(msg.media.payload, "base64");
        connection.sendAudio(buffer);
      }
    } else if (msg.event === "stop") {
      const connection = streamConnections[msg.streamSid];
      if (connection) {
        console.log("Symbl: Connection is stopping.", connection);
        connection.stop();
        console.log("Symbl: Connection stopped.", connection);
      }
      delete streamConnections[msg.streamSid];
      delete streamParticipants[msg.streamSid];
      console.log("Removed from streamConnections", streamConnections);
      console.log("Removed from streamParticipants", streamParticipants);
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
  console.log("New connection received.");
  if (Object.keys(participantConnections).length > 0) {
    Object.keys(participantConnections).forEach((from) => {
      subscribeConnection.send(
        JSON.stringify({
          type: "connection_exists",
          speaker: {
            userId: `${from}`,
            name: getName(from),
          },
          connectionId: participantConnections[from].connectionId,
          conversationId: participantConnections[from].conversationId,
        })
      );
    });
  }
});

const listener = app.listen(3000, () => {
  console.log("Your app is listening on port " + listener.address().port);
});
