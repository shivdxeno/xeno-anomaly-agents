import { logger } from '../../utils/logger';

const apiBase = 'https://api.devrev.ai';

const token = (): string => {
  const value = process.env.DEVREV_TOKEN;

  if (value === undefined || value === '') {
    throw new Error('BLOCKED: DEVREV_TOKEN is not set — see .env.example');
  }

  return value;
};

const call = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { authorization: token(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`devrev ${path} ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as Record<string, unknown>;
};

export type TDevrevTicket = {
  id: string;
  displayId: string;
  title: string;
  body: string;
  stage: string;
  createdDate: string;
  closedDate: string | null;
};

const titlePrefixFor = (agentName: string): string => `[${agentName}]`;

/**
 * ONE call, filtered on `created_by` only. Do NOT pass `tags`: the tag does not exist in the
 * org, and this endpoint rejects a plain-string tag filter with `unexpected_id_type` anyway.
 *
 * The service account is SHARED — humans file test tickets as the same identity — so every
 * row whose title does not start with the agent's prefix is discarded here. That discard is
 * the only thing separating the agent's tickets from anything else the account created.
 */
export const listAgentTickets = async (agentName: string): Promise<Array<TDevrevTicket>> => {
  const result = await call('/works.list', {
    type: ['ticket'],
    created_by: [process.env.DEVREV_SERVICE_ACCOUNT_DON],
    limit: 200,
  });
  const works = (result.works ?? []) as Array<Record<string, any>>;
  const prefix = titlePrefixFor(agentName);

  if (works.length >= 200) {
    logger.warn('devrev returned 200+ tickets — the recovery rule is not running');
  }

  return works
    .filter((w) => String(w.title ?? '').startsWith(prefix))
    .map((w) => ({
      id: String(w.id),
      displayId: String(w.display_id ?? ''),
      title: String(w.title ?? ''),
      body: String(w.body ?? ''),
      stage: String(w.stage?.name ?? ''),
      createdDate: String(w.created_date ?? '').slice(0, 10),
      closedDate:
        w.stage?.state?.is_final === true ? String(w.modified_date ?? '').slice(0, 10) : null,
    }));
};

export type TCreateTicketInput = {
  title: string;
  body: string;
  severity: string;
  productModule: string;
  accountDon: string | null;
  revOrgDon: string | null;
  ownerDon: string | null;
};

/**
 * `custom_schema_spec: { tenant_fragment: true }` is MANDATORY whenever custom_fields is
 * present — without it every `tnt__*` key hard-fails with `field_not_in_schema`. There is no
 * `tags` key and there must not be one: the tag does not exist and passing it 400s the create.
 */
export const createTicket = async (
  input: TCreateTicketInput,
): Promise<{ id: string; displayId: string }> => {
  const body: Record<string, unknown> = {
    type: 'ticket',
    title: input.title,
    body: input.body,
    severity: input.severity,
    applies_to_part: process.env.DEVREV_APPLIES_TO_PART,
    reported_by: [process.env.DEVREV_REPORTED_BY_DON],
    fields: {
      needs_response: false,
      custom_schema_spec: { tenant_fragment: true },
      custom_fields: {
        tnt__product_module: input.productModule,
        tnt__request_type: 'Something is not working as expected',
      },
    },
  };

  // A field that did not resolve is omitted, never guessed. A ticket with a missing account is
  // still a ticket somebody works; a finding with no ticket is a finding nobody owns.
  if (input.accountDon !== null) {
    body.account = input.accountDon;
  }

  if (input.revOrgDon !== null) {
    body.rev_org = input.revOrgDon;
  }

  if (input.ownerDon !== null) {
    body.owned_by = [input.ownerDon];
  }

  const result = await call('/works.create', body);
  const work = (result.work ?? {}) as Record<string, unknown>;

  return { id: String(work.id), displayId: String(work.display_id ?? '') };
};

/** visibility MUST be internal. An external entry is a customer-facing message. */
export const addInternalComment = async (workId: string, body: string): Promise<void> => {
  await call('/timeline-entries.create', {
    object: workId,
    type: 'timeline_comment',
    body,
    visibility: 'internal',
  });
};

export const resolveTicket = async (workId: string, stage: string): Promise<void> => {
  await call('/works.update', { id: workId, stage: { name: stage } });
};
