-- StarRocks. Merchant grain: triage order for MERCHANTS AFFECTED.
-- ifnull not nvl; `delivered` and `read` are reserved words and must be backticked.
SELECT merchant_id,
       sum(CASE WHEN sent_date >= :obs_start
                THEN ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)
                ELSE 0 END)                                              AS obs_attempted,
       sum(CASE WHEN sent_date <  :obs_start
                THEN ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)
                ELSE 0 END)                                              AS base_attempted,
       sum(CASE WHEN sent_date >= :obs_start
                THEN ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0)
                ELSE 0 END)                                              AS obs_delivered,
       sum(CASE WHEN sent_date <  :obs_start
                THEN ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0)
                ELSE 0 END)                                              AS base_delivered,
       count(DISTINCT CASE WHEN sent_date < :obs_start THEN to_date(sent_date) END) AS base_days
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND sent_date >= :base_start AND sent_date < :obs_end   -- bound BOTH sides: year-3023 rows
 GROUP BY 1
 ORDER BY base_attempted DESC
 LIMIT 300
