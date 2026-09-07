-- StarRocks. Journey grain: THE detector. A merchant total averages its journeys and the
-- average hides a dead one, so nothing is concluded from query 01 alone.
-- The 300 is a QUERY limit, not the output cap: read 300 candidates, print at most 20.
SELECT merchant_id,
       communication_id,
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
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1, 2
HAVING base_days >= 5                                       -- floor scales with base_days
   AND base_attempted >= 1000 * base_days
 ORDER BY base_attempted DESC
 LIMIT 300
