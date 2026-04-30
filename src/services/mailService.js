const { AgentMailClient } = require('agentmail');
const { MAIL_KEY, INBOX_ID } = require('../config/constants');

const sendWeatherMail = async (report, city) => {
  const client = new AgentMailClient({ apiKey: MAIL_KEY });
  try {
    await client.inboxes.messages.send(INBOX_ID, {
      to: 'aaryan.gupta@daffodilsw.com',
      subject: `Weather report for city ${city}`,
      text: report
    });
    console.log(`Email successfully sent for city: ${city}`);
    return "Report sent successfully!";
  } catch (error) {
    console.error(`Error in mailService: ${error.message}`);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = { sendWeatherMail };
