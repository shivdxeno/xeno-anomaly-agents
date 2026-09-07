/**
 * The connector tool each DevRev action maps to. Only names live here — this repo makes no
 * calls; `yarn plan` writes them into the plan and the agent executes them.
 *
 * ⚑ CONFIRM THESE AGAINST THE CONNECTOR'S OWN TOOL LIST BEFORE THE FIRST RUN. A name that
 * does not exist fails on the first call, and 09:30 unattended is the worst time to find out.
 */
export const devrevTools = {
  listTickets: 'list_tickets',
  createTicket: 'create_ticket',
  addComment: 'add_timeline_comment',
  updateWork: 'update_work',
};

/** Slack's connector tool for posting the report. Same caveat as above. */
export const slackTools = { sendMessage: 'send_message' };
