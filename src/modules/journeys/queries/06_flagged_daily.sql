-- StarRocks. Daily series for flagged journeys only. Supplies `Started`, `last_seen` (which
-- decides Still happening and therefore the section) AND the series the print bar requires:
-- a baseline mean is not a baseline, and one blast inside it manufactures a collapse.
SELECT communication_id,
       to_date(sent_date)                                                AS day,
       sum(ifnull(vendor_hits,0)+ifnull(invalid_credentials,0)+ifnull(xeno_bounced,0)) AS attempted,
       sum(ifnull(`delivered`,0)+ifnull(`read`,0)+ifnull(clicked,0))     AS delivered
  FROM xeno_sql_zenmaster_new.commlog_aggregate
 WHERE communication_type = '1'
   AND merchant_id IN (:flagged_merchants)
   AND communication_id IN (:flagged_journeys)
   AND sent_date >= :base_start AND sent_date < :obs_end
 GROUP BY 1, 2
 ORDER BY 1, 2
