-- PROD MySQL (mcp__db-mcp__query_mysql), database zenmaster_new. Names only, never metrics.
-- 45ms for eight ids on a primary-key IN lookup.
SELECT id, name, status, parent_account_id
  FROM merchant
 WHERE id IN (:merchant_ids)
