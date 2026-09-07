-- StarRocks. CONDITIONAL: only when split_group looks wrong.
-- A-Control is a ZERO-SEND holdout: exclude it before judging anything, or a healthy A/B
-- test reads as a dead arm.
SELECT merchant_id, communication_id, split_group,
       sum(ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)) AS attempted,
       sum(ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0))     AS delivered
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND merchant_id IN (:flagged_merchants)
   AND split_group <> 'A-Control'
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3
