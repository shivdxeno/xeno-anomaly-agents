-- StarRocks. Window sanity: catches a pipeline gap masquerading as an anomaly.
-- sent_date is a datetime, so day grouping needs to_date().
SELECT to_date(sent_date)                                                AS day,
       sum(ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)) AS attempted,
       sum(ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0))     AS delivered
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1
 ORDER BY 1
