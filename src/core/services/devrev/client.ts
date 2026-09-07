import { callTool } from '../../mcp/client';
import { logger } from '../../utils/logger';

/**
 * DevRev is reached through its MCP server, not its REST API — same reason as the stores: the
 * server holds the token and the audit.
 *
 * ⚑ THESE TOOL NAMES MUST BE CONFIRMED BEFORE THE FIRST RUN. Run `yarn mcp:tools` and check
 * each one against what the server actually exposes. A name that does not exist fails loudly
 * on the first call, which is the right failure — but finding out at 09:30 unattended is not.
 */
export const devrevTools = {
  listTickets: 'devrev_list_tickets',
  createTicket: 'devrev_create_ticket',
  addComment: 'devrev_add_timeline_comment',
  updateWork: 'devrev_update_work',
};

const asJson = (text: string): Record<string, unknown> => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
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

/**
 * ONE call, filtered on `created_by` only. Do NOT pass a `tags` filter: the tag does not
 * exist in the org and this endpoint rejects a plain-string tag with `unexpected_id_type`.
 *
 * The service account is SHARED — humans file test tickets as the same identity — so every
 * row whose title does not start with the agent's prefix is discarded here. With tags gone,
 * that discard is the only thing separating the agent's tickets from anything else the
 * account created.
 */
export const listAgentTickets = async (agentName: string): Promise<Array<TDevrevTicket>> => {
  const text = await callTool('devrev', devrevTools.listTickets, {
    created_by: [process.env.DEVREV_SERVICE_ACCOUNT_DON],
    limit: 200,
  });
  const payload = asJson(text);
  const works = (payload.works ?? payload.tickets ?? []) as Array<Record<string, unknown>>;
  const prefix = `[${agentName}]`;

  if (works.length >= 200) {
    logger.warn('devrev returned 200+ tickets — the recovery rule is not running');
  }

  return works
    .filter((w) => String(w.title ?? '').startsWith(prefix))
    .map((w) => {
      const stage = (w.stage ?? {}) as Record<string, unknown>;
      const state = (stage.state ?? {}) as Record<string, unknown>;

      return {
        id: String(w.id ?? ''),
        displayId: String(w.display_id ?? ''),
        title: String(w.title ?? ''),
        body: String(w.body ?? ''),
        stage: String(stage.name ?? ''),
        createdDate: String(w.created_date ?? '').slice(0, 10),
        closedDate: state.is_final === true ? String(w.modified_date ?? '').slice(0, 10) : null,
      };
    });
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
 * present — without it every `tnt__*` key hard-fails with `field_not_in_schema`, which is why
 * the agent's earlier tickets had a blank Product module. There is no `tags` key and there
 * must not be one: the tag does not exist and passing it 400s the create.
 */
export const createTicket = async (
  input: TCreateTicketInput,
): Promise<{ id: string; displayId: string }> => {
  const args: Record<string, unknown> = {
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
    args.account = input.accountDon;
  }

  if (input.revOrgDon !== null) {
    args.rev_org = input.revOrgDon;
  }

  if (input.ownerDon !== null) {
    args.owned_by = [input.ownerDon];
  }

  const payload = asJson(await callTool('devrev', devrevTools.createTicket, args));
  const work = (payload.work ?? payload.ticket ?? payload) as Record<string, unknown>;

  return { id: String(work.id ?? ''), displayId: String(work.display_id ?? '') };
};

/** visibility MUST be internal. An external entry is a customer-facing message. */
export const addInternalComment = async (workId: string, body: string): Promise<void> => {
  await callTool('devrev', devrevTools.addComment, {
    object: workId,
    type: 'timeline_comment',
    body,
    visibility: 'internal',
  });
};

export const resolveTicket = async (workId: string, stage: string): Promise<void> => {
  await callTool('devrev', devrevTools.updateWork, { id: workId, stage: { name: stage } });
};
