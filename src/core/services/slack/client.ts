import { callTool } from '../../mcp/client';

/**
 * ⚑ CONFIRM WITH `yarn mcp:tools` BEFORE THE FIRST RUN.
 */
export const slackTools = { postMessage: 'slack_send_message' };

export type TPostedMessage = { ts: string; permalink: string };

/**
 * The renderer emits standard markdown on purpose — this transport converts it. Hand-written
 * Slack `mrkdwn` arrives with literal asterisks and visible angle brackets.
 */
export const postMessage = async (channel: string, text: string): Promise<TPostedMessage> => {
  const raw = await callTool('slack', slackTools.postMessage, { channel_id: channel, text });
  let ts = '';

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;

    ts = String(payload.ts ?? '');
  } catch {
    ts = '';
  }

  return {
    ts,
    permalink:
      ts === '' ? '' : `https://xenohq.slack.com/archives/${channel}/p${ts.replace('.', '')}`,
  };
};
