const twiloService = require("../services/twilio.service");

async function twilioCallIncoming(req, res, next) {
  try {
    res.json(await twiloService.twilioCallIncoming());
  } catch (err) {
    console.error(`Error while twilo incoming call`, err.message);
    next(err);
  }
}

async function twilioStatusChanged(req, res, next) {
  try {
    res.json(await twiloService.twilioStatusChanged());
  } catch (err) {
    console.error(`Error while twilo status change`, err.message);
    next(err);
  }
}

module.exports = {
  twilioCallIncoming,
  twilioStatusChanged,
};
