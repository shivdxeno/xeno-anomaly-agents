-- DEV MySQL (mcp__db-mcp__query_mysql_dev). None of the devrev_* tables exist in prod —
-- running this against prod dies with "table doesn't exist".
-- One call: account + workspace DON per merchant, and the pod's on-call owner DON.
SELECT 'merchant'                                                        AS kind,
       CAST(mid.id AS CHAR)                                              AS key_col,
       m.merchant_name                                                   AS name,
       m.account_name                                                    AS account_name,
       MAX(JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.account.id')))            AS account_don,
       MAX(JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.rev_org.id')))            AS rev_org_don
  FROM (:merchant_id_rows) mid                       -- SELECT <id> UNION SELECT <id> ...
  LEFT JOIN zenmaster_new.devrev_account_mappings m
         ON FIND_IN_SET(mid.id, m.merchant_ids)      -- merchant_id column is NULL on every row
  LEFT JOIN zenmaster_new.devrev_tickets t
         ON JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.account.display_name')) = m.merchant_name
 GROUP BY 1, 2, 3, 4
UNION ALL
SELECT 'owner', p.pod, LOWER(o.L1),
       MAX(JSON_UNQUOTE(JSON_EXTRACT(t2.data,'$.owned_by[0].id'))), NULL, NULL
  FROM zenmaster_new.devrev_pod_mappings p
  JOIN zenmaster_new.devrev_on_call_schedule o
    ON o.pod = p.pod AND o.endTime > NOW()           -- live rota rows carry endTime 9999-01-01
  LEFT JOIN zenmaster_new.devrev_tickets t2
    ON LOWER(JSON_UNQUOTE(JSON_EXTRACT(t2.data,'$.owned_by[0].email'))) = LOWER(o.L1)
 WHERE FIND_IN_SET(:product_module_lower, REPLACE(LOWER(p.modules), ', ', ',')) > 0
 GROUP BY 1, 2, 3
