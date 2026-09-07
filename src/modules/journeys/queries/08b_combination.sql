-- StarRocks. REQUIRED once you know which journeys print: fills the TriggerId column and
-- names which content variant broke. Group by all three — combination ids are reused across
-- journeys and are channel-scoped, so dropping a companion column merges unrelated variants.
SELECT communication_id, combination_id, channel,
       sum(CASE WHEN sent_date >= :obs_start
                THEN ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)
                ELSE 0 END)                                              AS obs_att,
       sum(CASE WHEN sent_date <  :obs_start
                THEN ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)
                ELSE 0 END)                                              AS base_att,
       sum(CASE WHEN sent_date >= :obs_start
                THEN ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0)
                ELSE 0 END)                                              AS obs_del,
       sum(CASE WHEN sent_date <  :obs_start
                THEN ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0)
                ELSE 0 END)                                              AS base_del,
       sum(ifnull(fill_failed,0))                                        AS fill_failed,
       sum(ifnull(send_failed,0))                                        AS send_failed
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND merchant_id IN (:flagged_merchants)   -- ALWAYS scope; never platform-wide
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1, 2, 3
HAVING sum(ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)) >= 5000
 ORDER BY 1, 2
 LIMIT 150
