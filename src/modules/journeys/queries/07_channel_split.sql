-- StarRocks. CONDITIONAL: only when a delivery RATE dropped. Do not run speculatively.
SELECT merchant_id, communication_id, channel,
       sum(ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)) AS attempted,
       sum(ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0))     AS delivered
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND merchant_id IN (:flagged_merchants)
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3
