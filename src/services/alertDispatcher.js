const RESET = '\x1b[0m';
const BOLD_RED = '\x1b[1m\x1b[31m';
const BOLD_YELLOW = '\x1b[1m\x1b[33m';
const BOLD_WHITE = '\x1b[1m\x1b[37m';
const BG_RED = '\x1b[41m\x1b[37m';

function mockSendSMS(phone, message) {
  const line = '═'.repeat(60);
  console.log(`\n${BG_RED} !!! OUTBOUND SMS DISPATCH !!! ${RESET}`);
  console.log(`${BOLD_RED}${line}${RESET}`);
  console.log(`${BOLD_YELLOW}To:${RESET} ${phone}`);
  console.log(`${BOLD_YELLOW}Body:${RESET} ${BOLD_WHITE}${message}${RESET}`);
  console.log(`${BOLD_RED}${line}${RESET}\n`);
}

function dispatchTicket(ticket) {
  if (ticket.severity === 'High') {
    const message = `[DRAINPULSE ALERT] ${ticket.severity} severity ticket opened for ${ticket.locationName} (${ticket.nodeId}). Notes: ${ticket.notes || 'N/A'}. Time: ${new Date(ticket.createdAt).toISOString()}`;
    mockSendSMS('+254-DISPATCHER', message);
  }
}

module.exports = { dispatchTicket, mockSendSMS };
