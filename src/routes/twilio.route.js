const express = require("express");
const twilioController = require("../controllers/twilio.controller");

const router = express.Router();

router.post("/incoming", twilioController.twilioCallIncoming);

router.post("/statuschanged", twilioController.twilioStatusChanged);

module.exports = router;
