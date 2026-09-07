const apiBase = 'https://slack.com/api';

const token = (): string => {
  const value = process.env.SLACK_BOT_TOKEN;

  if (value === undefined || value === '') {
    throw new Error('BLOCKED: SLACK_BOT_TOKEN is not set — see .env.example');
  }

  return value;
};

export type TPostedMessage = { ts: string; permalink: string };

/**
 * `chat.postMessage` with `mrkdwn: true` converts the standard markdown the renderer emits.
 * The renderer writes `**bold**` and `[label](url)` on purpose — hand-written Slack `mrkdwn`
 * arrives with literal asterisks and visible angle brackets.
 */
export const postMessage = async (channel: string, text: string): Promise<TPostedMessage> => {
  const response = await fetch(`${apiBase}/chat.postMessage`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ channel, text, mrkdwn: true, unfurl_links: false }),
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (payload.ok !== true) {
    throw new Error(`slack chat.postMessage failed: ${JSON.stringify(payload)}`);
  }

  const ts = String(payload.ts);

  return { ts, permalink: `https://xenohq.slack.com/archives/${channel}/p${ts.replace('.', '')}` };
};
