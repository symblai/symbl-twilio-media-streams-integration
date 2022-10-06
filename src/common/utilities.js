function getName(phoneNumber) {
  const agentPhone = process.env.AGENT_PHONE;

  return phoneNumber
    ? phoneNumber.trim() === agentPhone
      ? "Agent"
      : "Customer"
    : "Unknown Caller";
}

module.exports = {
  getName,
};
