import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import * as controller from './credits.controller';
import { CreditNoteListQuery, CreditNoteReverseBody, CreditNoteSettleBody, CreditNoteSummaryQuery } from './credits.validation';

// M-18 credits — modules.md. Notes are only ever created by claims.decide (via
// credits.service.issueInTx); there is deliberately no POST /. The statement PDF
// (GET /statement.pdf) waits for the evidence/PDF module — the app prints its own for now.
export async function registerCreditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: CreditNoteListQuery }>('/', { preHandler: [requireAuth, requirePermission('credits.read')], schema: { querystring: CreditNoteListQuery } }, controller.list);
  app.get<{ Querystring: CreditNoteSummaryQuery }>('/summary', { preHandler: [requireAuth, requirePermission('credits.read')], schema: { querystring: CreditNoteSummaryQuery } }, controller.summary);
  app.get<{ Params: { no: string } }>('/:no', { preHandler: [requireAuth, requirePermission('credits.read')] }, controller.getByNo);

  app.post<{ Params: { no: string }; Body: CreditNoteSettleBody }>(
    '/:no/settle',
    { preHandler: [requireAuth, requirePermission('credits.adjust')], schema: { body: CreditNoteSettleBody } },
    controller.settle,
  );
  app.post<{ Params: { no: string }; Body: CreditNoteReverseBody }>(
    '/:no/reverse',
    { preHandler: [requireAuth, requirePermission('credits.adjust')], schema: { body: CreditNoteReverseBody } },
    controller.reverse,
  );
}
