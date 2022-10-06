async function twilioCallIncoming() {
  return "Twilio call incoming";
}

async function twilioStatusChanged() {
  return "Twilio status changed";
}

module.exports = {
  twilioCallIncoming,
  twilioStatusChanged,
};
